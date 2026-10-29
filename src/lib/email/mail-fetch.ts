import "server-only";
import type { ImapFlow, MailboxObject } from "imapflow";
import { parseEmailFile } from "@/lib/email/parse";
import { connectWithFallback, imapLogin, pop3Login, type Credentials, type NetOptions } from "@/lib/email/mail-connect";
import type { MailEndpoint, ResolvedEndpoint } from "@/lib/email/mail-config";
import type { Pop3Client } from "@/lib/email/pop3";
import type { RawEmail } from "@/lib/email/ingest";
import { attachmentsFromStructure, listAttachments, readHeaders, type BodyStructureNode } from "@/lib/email/mime-parts";
import { parseMessageIds } from "@/lib/email/threading";
import { detectSentFolder } from "@/lib/email/mail-append";

/**
 * Stahování CELÉ schránky po dávkách s kurzorem (IMAP UID / POP3 UIDL) — nic se na serveru nemaže
 * ani neoznačuje (IMAP EXAMINE + BODY.PEEK, POP3 bez DELE).
 *
 * Pořadí v každé dávce: nejdřív nové zprávy (UID > lastUid, od nejstarší), pak starší pošta od
 * nejnovější dolů (UID < backfillBelow) — při prvním stažení tak uživatel hned vidí čerstvou poštu
 * a starší se dotahuje, dokud `remaining` neklesne na 0. IMAP: INBOX i složka Odeslané (SPECIAL-USE
 * \Sent). Stav se ukládá po každé dávce (přerušení = nic se nestáhne dvakrát ani se neztratí).
 */

export interface ImapFolderState {
  uidValidity: string;
  /** Nejvyšší UID, od kterého výš je vše stažené (nové zprávy jsou nad ním). */
  lastUid: number;
  /** Nejnižší stažené UID ze starší pošty; zprávy pod ním ještě čekají (1 / chybí-li starší = hotovo). */
  backfillBelow?: number;
  /** Cesta složky (u Odeslaných). */
  path?: string;
}
export interface Pop3SyncState {
  /** UIDL zpráv, které už jsou zpracované. */
  seen: string[];
  /** Stahuje se celá schránka (starší stav: starší zprávy byly jen označené jako viděné). */
  full?: boolean;
}
export interface MailSyncState {
  /** INBOX (klíč z dřívějška). */
  imap?: ImapFolderState;
  /** Složka Odeslané na serveru. */
  imapSent?: ImapFolderState | { none: true };
  pop3?: Pop3SyncState;
  [key: string]: unknown;
}

export interface FetchBatch {
  folder: "INBOX" | "Sent";
  direction: "in" | "out";
  emails: RawEmail[];
  /** Stav po zpracování prvních `n` zpráv z `emails`. */
  stateAfter: (n: number) => MailSyncState;
  /** Zprávy ve složce, které po této dávce ještě čekají. */
  remaining: number;
  /** Zpráv ve složce celkem. */
  total: number;
}

export interface FetchSummary {
  state: MailSyncState;
  endpoint: MailEndpoint;
  /** Uložený server nefungoval, pomohl ověřený server poskytovatele → uložit do schránky. */
  healed: boolean;
  /** Zpráv na serveru (INBOX + Odeslané). */
  total: number;
  /** Kolik ještě čeká (časový limit) — stáhne se při dalším volání. */
  remaining: number;
  fetched: number;
  /** Zpracováno všech dávek do konce (nezastavil časový limit). */
  complete: boolean;
}

const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_POP3_BYTES = 2 * 1024 * 1024;
const MAX_BODY = 12000;

// ── Plánovače (čisté funkce, testy v mail-fetch.test.ts) ───
export interface ImapPlan {
  pick: number[];
  remaining: number;
  /** Stav složky po zpracování prvních n z `pick`. */
  stateAfter: (n: number) => ImapFolderState;
  /** Nový začátek (první stažení / změněná UIDVALIDITY). */
  reset: boolean;
}

/**
 * Co stáhnout ze složky (UID na serveru `uids`, libovolné pořadí): nové (> lastUid, vzestupně) a pak
 * starší (< backfillBelow, sestupně), celkem nejvýš `limit`. Starší stav bez `backfillBelow`
 * (dřív se stahovalo jen nejnovějších N) → dotáhne se i starší pošta (duplicity hlídá Message-ID).
 */
export function planImapChunk(uids: readonly number[], prev: ImapFolderState | undefined, uidValidity: string, limit: number): ImapPlan {
  const sorted = [...new Set(uids)].filter((u) => Number.isFinite(u) && u > 0).sort((a, b) => a - b);
  const max = sorted.at(-1) ?? 0;
  const reset = !prev || prev.uidValidity !== uidValidity;
  const base: ImapFolderState = reset
    ? { uidValidity, lastUid: max, backfillBelow: max + 1, ...(prev?.path ? { path: prev.path } : {}) }
    : { ...prev!, backfillBelow: prev!.backfillBelow ?? prev!.lastUid + 1 };
  const fresh = sorted.filter((u) => u > base.lastUid);
  const older = sorted.filter((u) => u < base.backfillBelow!).reverse();
  const n = Math.max(0, Math.floor(limit));
  const pickFresh = fresh.slice(0, n);
  const pickOlder = older.slice(0, Math.max(0, n - pickFresh.length));
  const pick = [...pickFresh, ...pickOlder];
  return {
    pick,
    reset,
    remaining: fresh.length + older.length - pick.length,
    stateAfter: (k) => {
      const done = pick.slice(0, Math.max(0, k));
      const doneFresh = done.filter((u) => u > base.lastUid);
      const doneOlder = done.filter((u) => u < base.backfillBelow!);
      return {
        ...base,
        lastUid: doneFresh.length ? Math.max(base.lastUid, ...doneFresh) : base.lastUid,
        backfillBelow: doneOlder.length ? Math.min(base.backfillBelow!, ...doneOlder) : base.backfillBelow,
      };
    },
  };
}

export interface Pop3Plan {
  /** Zprávy ke stažení v této dávce (od nejnovější). */
  pick: { n: number; uid: string }[];
  /** UIDL označené jako viděné bez ohledu na dávku (zpracované dřív a stále na serveru). */
  baseSeen: string[];
  /** Zprávy, které se do dávky nevešly. */
  remaining: number;
}

/**
 * Co stáhnout z POP3: všechny dosud nezpracované zprávy od nejnovější, po `limit`. Seznam viděných
 * UIDL se prořezává JEN o zprávy, které už na serveru nejsou (nikdy podle počtu). Starší stav bez
 * `full` (dřív se staré zprávy jen označily jako viděné) → stáhne se celá schránka znovu (duplicity
 * hlídá Message-ID).
 */
export function planPop3(list: { n: number; uid: string }[], state: MailSyncState, limit: number): Pop3Plan {
  const sorted = list.slice().sort((a, b) => a.n - b.n);
  const onServer = new Set(sorted.map((m) => m.uid));
  const prevSeen = state.pop3?.full ? state.pop3.seen ?? [] : [];
  const kept = [...new Set(prevSeen)].filter((u) => onServer.has(u));
  const seen = new Set(kept);
  const fresh = sorted.filter((m) => !seen.has(m.uid)).reverse();
  const pick = fresh.slice(0, Math.max(0, limit));
  return { pick, baseSeen: kept, remaining: fresh.length - pick.length };
}

/** Hlavička v 8bitovém UTF-8 přečtená jako latin1 („novÃ¡") → správné znaky. */
export function fixUtf8Mojibake(s: string): string {
  if (!/[Â-ô][\u0080-¿]/.test(s)) return s;
  const fixed = Buffer.from(s, "latin1").toString("utf8");
  return fixed.includes("�") ? s : fixed;
}

function bodyOf(source: Buffer | undefined, name: string): { body: string; parsed?: RawEmail } {
  if (!source) return { body: "" };
  const parsed = parseEmailFile(name, source);
  return parsed.ok && parsed.email ? { body: parsed.email.body, parsed: parsed.email } : { body: "" };
}

/** Hlavičky pro vlákna, kopie a pravidla třídění. */
function headerExtras(source: Buffer | undefined): Pick<RawEmail, "inReplyTo" | "references" | "ccEmail" | "headers"> {
  if (!source) return {};
  const h = readHeaders(source);
  const refs = parseMessageIds(h["references"]);
  const irt = parseMessageIds(h["in-reply-to"])[0];
  const cc = (h["cc"] ?? "").match(/[^\s<>",;]+@[^\s<>",;]+/g);
  return {
    ...(irt ? { inReplyTo: irt } : {}),
    ...(refs.length ? { references: refs } : {}),
    ...(cc?.length ? { ccEmail: [...new Set(cc.map((a) => a.toLowerCase()))].join(", ") } : {}),
    headers: {
      "list-unsubscribe": h["list-unsubscribe"], precedence: h["precedence"], "auto-submitted": h["auto-submitted"],
      "x-spam-flag": h["x-spam-flag"], "x-spam-status": h["x-spam-status"],
    },
  };
}

type Addr = { name?: string; address?: string };
const addrList = (list: Addr[] | undefined) => (list ?? []).map((a) => a.address).filter((a): a is string => Boolean(a)).join(", ");

async function fetchImapChunk(
  client: ImapFlow,
  folderPath: string,
  folder: "INBOX" | "Sent",
  prev: ImapFolderState | undefined,
  limit: number,
): Promise<{ plan: ImapPlan; emails: RawEmail[]; total: number; uidValidity: string }> {
  const lock = await client.getMailboxLock(folderPath, { readOnly: true });
  try {
    const mb = client.mailbox as MailboxObject;
    const uidValidity = String(mb.uidValidity ?? "");
    const total = mb.exists ?? 0;
    const uids = total ? (((await client.search({ all: true }, { uid: true })) || []) as number[]) : [];
    const plan = planImapChunk(uids, prev, uidValidity, limit);
    const rows: RawEmail[] = [];
    if (plan.pick.length) {
      const byUid = new Map<number, RawEmail>();
      for await (const msg of client.fetch(
        plan.pick.join(","),
        { uid: true, envelope: true, internalDate: true, size: true, bodyStructure: true, source: { maxLength: MAX_SOURCE_BYTES } },
        { uid: true },
      )) {
        const env = msg.envelope;
        const fromAddr = env?.from?.[0];
        const { body } = bodyOf(msg.source, "zprava.eml");
        const date = env?.date ?? (msg.internalDate instanceof Date ? msg.internalDate : msg.internalDate ? new Date(msg.internalDate) : new Date());
        const truncated = Boolean(msg.size && msg.source && msg.size > msg.source.length);
        const fromStructure = msg.bodyStructure ? attachmentsFromStructure(msg.bodyStructure as unknown as BodyStructureNode) : null;
        const attachments = fromStructure ?? (msg.source ? listAttachments(msg.source, truncated) : []);
        const extras = headerExtras(msg.source);
        byUid.set(msg.uid, {
          messageId: env?.messageId || `imap-${folder}-${uidValidity}-${msg.uid}`,
          fromName: fromAddr?.name || fromAddr?.address || "",
          fromEmail: fromAddr?.address || "",
          subject: env?.subject || "",
          body: body.slice(0, MAX_BODY),
          receivedAt: (Number.isNaN(date.getTime()) ? new Date() : date).toISOString(),
          toEmail: addrList(env?.to) || undefined,
          ...extras,
          ...(env?.inReplyTo && !extras.inReplyTo ? { inReplyTo: env.inReplyTo } : {}),
          ...(!extras.ccEmail && env?.cc?.length ? { ccEmail: addrList(env.cc) } : {}),
          imapFolder: folderPath,
          imapUid: msg.uid,
          imapUidValidity: uidValidity,
          attachments,
          direction: folder === "Sent" ? "out" : "in",
        });
      }
      // v pořadí plánu (nové vzestupně, starší sestupně); zprávu, kterou server mezitím smazal, přeskočit
      const at: number[] = [];
      plan.pick.forEach((u, i) => {
        const e = byUid.get(u);
        if (e) { rows.push(e); at.push(i); }
      });
      if (rows.length !== plan.pick.length) {
        // stav po n zprávách = po poslední vyřízené pozici plánu (smazané zprávy se přeskočí)
        const stateAfter = (n: number) => plan.stateAfter(n <= 0 ? 0 : n >= rows.length ? plan.pick.length : at[n - 1] + 1);
        return { plan: { ...plan, stateAfter }, emails: rows, total, uidValidity };
      }
    }
    return { plan, emails: rows, total, uidValidity };
  } finally {
    lock.release();
  }
}

async function pop3Chunk(client: Pop3Client, state: MailSyncState, limit: number): Promise<{ batch: FetchBatch }> {
  const { count: total } = await client.stat();
  let list: { n: number; uid: string }[];
  try {
    list = await client.uidl();
  } catch {
    list = Array.from({ length: total }, (_, i) => ({ n: i + 1, uid: `n${i + 1}` })); // bez UIDL: duplicity hlídá Message-ID
  }
  const { pick, baseSeen, remaining } = planPop3(list, state, limit);
  const emails: RawEmail[] = [];
  for (const m of pick) {
    const raw = await client.retr(m.n);
    const truncated = raw.length > MAX_POP3_BYTES;
    const src = truncated ? raw.subarray(0, MAX_POP3_BYTES) : raw;
    const { parsed } = bodyOf(src, `pop3-${m.uid}.eml`);
    const hasId = /^message-id:/im.test(src.subarray(0, 64 * 1024).toString("latin1"));
    const h = readHeaders(src);
    emails.push({
      // tvar Message-ID beze změny (bez <>) — jinak by se dřív stažené zprávy uložily podruhé
      messageId: parsed && hasId ? parsed.messageId : `pop3-${m.uid}`,
      fromName: fixUtf8Mojibake(parsed?.fromName ?? ""),
      fromEmail: parsed?.fromEmail ?? "",
      subject: fixUtf8Mojibake(parsed?.subject ?? ""),
      body: (parsed?.body ?? "").slice(0, MAX_BODY),
      receivedAt: parsed?.receivedAt ?? new Date().toISOString(),
      toEmail: (h["to"] ?? "").match(/[^\s<>",;]+@[^\s<>",;]+/g)?.join(", ") || undefined,
      ...headerExtras(src),
      attachments: listAttachments(src, truncated),
      source: truncated ? undefined : src,
      direction: "in",
    });
  }
  const seenAfter = (n: number) => [...baseSeen, ...pick.slice(0, Math.max(0, n)).map((m) => m.uid)];
  return {
    batch: {
      folder: "INBOX",
      direction: "in",
      emails,
      remaining,
      total,
      stateAfter: (n) => ({ ...state, pop3: { seen: seenAfter(n), full: true } }),
    },
  };
}

export interface SyncIncomingOptions extends NetOptions {
  /** Velikost dávky (zpráv). */
  chunk: number;
  /** Epoch ms: po tomto okamžiku další dávku nezačínat. */
  stopAt: number;
  /** Max. zpráv celkem za toto volání (živé stahování: malé dávky). */
  maxMessages?: number;
  budgetMs?: number;
  /** Stahovat i složku Odeslané (IMAP). Výchozí ano. */
  sent?: boolean;
}

/**
 * Stáhne schránku po dávkách: `handle` dávku zpracuje (uloží) a vrátí, kolik zpráv od začátku dávky
 * vyřídil (< délka = došel čas). Pokračuje, dokud zbývá čas a na serveru čeká pošta.
 */
export async function syncIncoming(
  incoming: ResolvedEndpoint,
  email: string,
  state: MailSyncState,
  opts: SyncIncomingOptions,
  handle: (batch: FetchBatch) => Promise<number>,
): Promise<FetchSummary> {
  const connect = async (ep: MailEndpoint, auth: Credentials) => {
    if (ep.protocol === "pop3") {
      const { client } = await pop3Login(ep, auth, { ...opts, keepOpen: true });
      return { kind: "pop3" as const, client: client! };
    }
    const { client } = await imapLogin(ep, auth, { ...opts, keepOpen: true });
    return { kind: "imap" as const, client: client! };
  };
  const { result, endpoint, healed } = await connectWithFallback(incoming, email, connect, { budgetMs: opts.budgetMs, ca: opts.ca });
  let cur: MailSyncState = { ...state };
  let fetched = 0;
  let complete = true;
  const left = () => (opts.maxMessages ?? Infinity) - fetched;
  const timeUp = () => Date.now() > opts.stopAt || left() <= 0;

  if (result.kind === "pop3") {
    let total = 0;
    let remaining = 0;
    try {
      for (;;) {
        const { batch } = await pop3Chunk(result.client, cur, Math.min(opts.chunk, left()));
        total = batch.total;
        remaining = batch.remaining + batch.emails.length;
        if (!batch.emails.length) { remaining = batch.remaining; break; }
        const n = await handle(batch);
        fetched += batch.emails.length;
        cur = batch.stateAfter(n);
        remaining = batch.remaining + (batch.emails.length - n);
        if (n < batch.emails.length) { complete = false; break; }
        if (!batch.remaining) break;
        if (timeUp()) { complete = false; break; }
      }
    } finally {
      await result.client.quit();
    }
    return { state: cur, endpoint, healed, total, remaining, fetched, complete: complete && remaining === 0 };
  }

  const client = result.client;
  let total = 0;
  let remaining = 0;
  try {
    // složky: INBOX, pak Odeslané (SPECIAL-USE \Sent, jinak podle jména)
    const folders: { key: "imap" | "imapSent"; folder: "INBOX" | "Sent"; path: string }[] = [{ key: "imap", folder: "INBOX", path: "INBOX" }];
    if (opts.sent !== false) {
      const prevSent = cur.imapSent as ImapFolderState | undefined;
      try {
        const f = await detectSentFolder(client);
        if (f) folders.push({ key: "imapSent", folder: "Sent", path: f.path });
        else cur.imapSent = { none: true };
        if (f && prevSent && "path" in prevSent && prevSent.path !== f.path) delete cur.imapSent; // jiná složka = znovu
      } catch {
        // LIST nefunguje → jen INBOX
      }
    }
    for (const f of folders) {
      let folderRemaining = 0;
      let folderTotal = 0;
      for (;;) {
        if (timeUp()) { complete = false; break; }
        const prev = f.key === "imap" ? cur.imap : ((cur.imapSent && "uidValidity" in cur.imapSent) ? cur.imapSent : undefined);
        const { plan, emails, total: t, uidValidity } = await fetchImapChunk(client, f.path, f.folder, prev, Math.min(opts.chunk, left()));
        folderTotal = t;
        const withPath = (s: ImapFolderState): ImapFolderState => (f.key === "imapSent" ? { ...s, path: f.path } : s);
        if (!emails.length) {
          folderRemaining = 0;
          const st = withPath(plan.stateAfter(0));
          cur = { ...cur, [f.key]: { ...st, uidValidity, backfillBelow: plan.remaining ? st.backfillBelow : Math.min(st.backfillBelow ?? 1, 1) } };
          break;
        }
        const batch: FetchBatch = {
          folder: f.folder,
          direction: f.folder === "Sent" ? "out" : "in",
          emails,
          remaining: plan.remaining,
          total: t,
          stateAfter: (n) => ({ ...cur, [f.key]: withPath(plan.stateAfter(n)) }),
        };
        const n = await handle(batch);
        fetched += emails.length;
        cur = batch.stateAfter(n);
        folderRemaining = plan.remaining + (emails.length - n);
        if (n < emails.length) { complete = false; break; }
        if (!plan.remaining) break;
      }
      total += folderTotal;
      remaining += folderRemaining;
      if (!complete) {
        // zbylé složky se nestihly — jejich zprávy čekají (počet neznámý → aspoň celkový počet ze stavu)
        break;
      }
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
  return { state: cur, endpoint, healed, total, remaining, fetched, complete: complete && remaining === 0 };
}

/**
 * Jedna dávka z INBOXu (globální IMAP účet bez schránky, testy): zprávy v pořadí plánu, stav po
 * zpracování prvních n, kolik ještě čeká a kolik je na serveru.
 */
export async function fetchIncoming(
  incoming: ResolvedEndpoint,
  email: string,
  state: MailSyncState,
  limit: number,
  opts: NetOptions & { budgetMs?: number } = {},
): Promise<FetchBatch & { endpoint: MailEndpoint; healed: boolean }> {
  const connect = async (ep: MailEndpoint, auth: Credentials) => {
    if (ep.protocol === "pop3") {
      const { client } = await pop3Login(ep, auth, { ...opts, keepOpen: true });
      return { kind: "pop3" as const, client: client! };
    }
    const { client } = await imapLogin(ep, auth, { ...opts, keepOpen: true });
    return { kind: "imap" as const, client: client! };
  };
  const { result, endpoint, healed } = await connectWithFallback(incoming, email, connect, { budgetMs: opts.budgetMs, ca: opts.ca });
  if (result.kind === "pop3") {
    try {
      return { ...(await pop3Chunk(result.client, state, limit)).batch, endpoint, healed };
    } finally {
      await result.client.quit();
    }
  }
  try {
    const { plan, emails, total } = await fetchImapChunk(result.client, "INBOX", "INBOX", state.imap, limit);
    return {
      folder: "INBOX", direction: "in", emails, total, remaining: plan.remaining,
      stateAfter: (n) => ({ ...state, imap: plan.stateAfter(n) }), endpoint, healed,
    };
  } finally {
    await result.client.logout().catch(() => result.client.close());
  }
}

/** Message-ID k porovnání (bez <>, malá písmena). */
export function normMessageId(v: string | null | undefined): string {
  return (v ?? "").trim().replace(/^<|>$/g, "").trim().toLowerCase();
}

/** Náhradní Message-ID ze stahování (zpráva bez hlavičky Message-ID): `imap-<složka>-<uidvalidity>-<uid>`. */
export function isSyntheticMessageId(v: string | null | undefined): boolean {
  return /^imap-/.test(v ?? "");
}

export interface ImapMessageRef {
  folder: string;
  uid: number | null;
  /** UIDVALIDITY složky při stažení (starší řádky: neznámá → rozhoduje Message-ID). */
  uidValidity?: string | null;
  /** Message-ID uložené zprávy — zpráva na serveru se s ním MUSÍ shodovat. */
  messageId: string | null;
}

export type ImapMessageResult =
  | { ok: true; source: Buffer; uid: number; uidValidity: string }
  | { ok: false; reason: "missing" | "changed" };

/**
 * Zdroj uložené zprávy ze serveru — jen TÉŽE zprávy: UID platí jen se stejnou UIDVALIDITY a obálka
 * musí mít stejné Message-ID (jiná schránka / přečíslovaná složka by jinak vrátila cizí e-mail).
 * Když UID nesedí, zpráva se ve složce dohledá podle hlavičky Message-ID.
 */
export async function fetchImapMessage(incoming: ResolvedEndpoint, email: string, ref: ImapMessageRef, opts: NetOptions = {}): Promise<ImapMessageResult> {
  const { result } = await connectWithFallback(incoming, email, async (ep, auth) => (await imapLogin(ep, auth, { ...opts, keepOpen: true })).client!, { budgetMs: 15_000, ca: opts.ca });
  const client = result;
  const want = normMessageId(ref.messageId);
  const synthetic = isSyntheticMessageId(ref.messageId);
  try {
    const lock = await client.getMailboxLock(ref.folder || "INBOX", { readOnly: true });
    try {
      const uidValidity = String((client.mailbox as MailboxObject).uidValidity ?? "");
      const sameValidity = !ref.uidValidity || ref.uidValidity === uidValidity;
      const matches = (envId: string | undefined) => (synthetic ? !envId && sameValidity && Boolean(ref.uidValidity) : Boolean(want) && normMessageId(envId) === want);
      if (ref.uid && sameValidity) {
        const msg = await client.fetchOne(String(ref.uid), { uid: true, envelope: true, source: true }, { uid: true });
        if (msg && msg.source && matches(msg.envelope?.messageId)) return { ok: true, source: msg.source, uid: msg.uid, uidValidity };
      }
      if (!want || synthetic) return { ok: false, reason: "changed" };
      const found = ((await client.search({ header: { "message-id": ref.messageId!.trim() } }, { uid: true })) || []) as number[];
      for (const uid of found.slice(0, 5)) {
        const msg = await client.fetchOne(String(uid), { uid: true, envelope: true, source: true }, { uid: true });
        if (msg && msg.source && matches(msg.envelope?.messageId)) return { ok: true, source: msg.source, uid: msg.uid, uidValidity };
      }
      return { ok: false, reason: ref.uid ? "changed" : "missing" };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
}
