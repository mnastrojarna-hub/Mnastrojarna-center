import "server-only";
import type { ImapFlow, MailboxObject } from "imapflow";
import { parseEmailFile } from "@/lib/email/parse";
import { connectWithFallback, imapLogin, pop3Login, type Credentials, type NetOptions } from "@/lib/email/mail-connect";
import type { MailEndpoint, ResolvedEndpoint } from "@/lib/email/mail-config";
import type { Pop3Client } from "@/lib/email/pop3";
import type { RawEmail } from "@/lib/email/ingest";

/**
 * Inkrementální stahování příchozí pošty (IMAP UID / POP3 UIDL) — nic se na serveru nemaže ani
 * neoznačuje (IMAP EXAMINE + BODY.PEEK, POP3 bez DELE). Vrací zprávy od nejstarší a funkci, která
 * spočítá nový stav po zpracování prvních N (časový limit = zbytek se stáhne příště).
 */

export interface ImapSyncState {
  uidValidity: string;
  lastUid: number;
}
export interface Pop3SyncState {
  /** UIDL zpráv, které už jsou zpracované (nebo starší než první stažení). */
  seen: string[];
}
export interface MailSyncState {
  imap?: ImapSyncState;
  pop3?: Pop3SyncState;
  [key: string]: unknown;
}

export interface FetchResult {
  emails: RawEmail[];
  /** Stav po zpracování prvních `n` zpráv z `emails`. */
  stateAfter: (n: number) => MailSyncState;
  /** Kolik nových zpráv zůstalo na serveru (limit dávky). */
  remaining: number;
  /** Zpráv v INBOXu celkem. */
  total: number;
  endpoint: MailEndpoint;
  /** Uložený server nefungoval, pomohl ověřený server poskytovatele → uložit do schránky. */
  healed: boolean;
}

const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_POP3_BYTES = 2 * 1024 * 1024;
const MAX_BODY = 12000;

export interface Pop3Plan {
  /** Zprávy ke stažení v této dávce (od nejstarší). */
  pick: { n: number; uid: string }[];
  /** UIDL označené jako viděné bez ohledu na dávku (zpracované dřív / starší než první stažení). */
  baseSeen: string[];
  /** Nové zprávy, které se do dávky nevešly. */
  remaining: number;
}

/**
 * Co stáhnout z POP3 (čistá funkce). Seznam viděných UIDL se prořezává JEN o zprávy, které už na
 * serveru nejsou (podle UIDL) — nikdy podle počtu (jinak by se staré zprávy ve velké schránce
 * stahovaly znovu dokola). První stažení: jen nejnovějších `limit`, ostatní se označí jako viděné
 * bez stahování.
 */
export function planPop3(list: { n: number; uid: string }[], state: MailSyncState, limit: number): Pop3Plan {
  const sorted = list.slice().sort((a, b) => a.n - b.n);
  if (!state.pop3) {
    const pick = limit > 0 ? sorted.slice(-limit) : [];
    return { pick, baseSeen: sorted.slice(0, sorted.length - pick.length).map((m) => m.uid), remaining: 0 };
  }
  const onServer = new Set(sorted.map((m) => m.uid));
  const kept = [...new Set(state.pop3.seen ?? [])].filter((u) => onServer.has(u));
  const seen = new Set(kept);
  const fresh = sorted.filter((m) => !seen.has(m.uid));
  const pick = fresh.slice(0, Math.max(0, limit));
  return { pick, baseSeen: kept, remaining: fresh.length - pick.length };
}

/** Hlavička v 8bitovém UTF-8 přečtená jako latin1 („nov\u00c3\u00a1") → správné znaky. */
export function fixUtf8Mojibake(s: string): string {
  if (!/[\u00c2-\u00f4][\u0080-\u00bf]/.test(s)) return s;
  const fixed = Buffer.from(s, "latin1").toString("utf8");
  return fixed.includes("\ufffd") ? s : fixed;
}

function bodyOf(source: Buffer | undefined, name: string): { body: string; parsed?: RawEmail } {
  if (!source) return { body: "" };
  const parsed = parseEmailFile(name, source);
  return parsed.ok && parsed.email ? { body: parsed.email.body, parsed: parsed.email } : { body: "" };
}

async function fetchImap(client: ImapFlow, state: MailSyncState, limit: number): Promise<Omit<FetchResult, "endpoint" | "healed">> {
  const lock = await client.getMailboxLock("INBOX", { readOnly: true });
  try {
    const mb = client.mailbox as MailboxObject;
    const uidValidity = String(mb.uidValidity ?? "");
    const total = mb.exists ?? 0;
    const prev = state.imap;
    const reset = !prev || prev.uidValidity !== uidValidity;
    if (!total) {
      return { emails: [], remaining: 0, total, stateAfter: () => ({ ...state, imap: { uidValidity, lastUid: reset ? 0 : prev!.lastUid } }) };
    }
    let range: string;
    let useUid: boolean;
    let remaining = 0;
    if (reset) {
      range = `${Math.max(1, total - limit + 1)}:*`; // první stažení: nejnovějších N
      useUid = false;
    } else {
      const found = ((await client.search({ uid: `${prev!.lastUid + 1}:*` }, { uid: true })) || []) as number[];
      const fresh = found.filter((u) => u > prev!.lastUid).sort((a, b) => a - b);
      remaining = Math.max(0, fresh.length - limit);
      const pick = fresh.slice(0, limit);
      if (!pick.length) return { emails: [], remaining: 0, total, stateAfter: () => ({ ...state, imap: prev! }) };
      range = pick.join(",");
      useUid = true;
    }
    const rows: { uid: number; email: RawEmail }[] = [];
    for await (const msg of client.fetch(range, { uid: true, envelope: true, internalDate: true, source: { maxLength: MAX_SOURCE_BYTES } }, { uid: useUid })) {
      const env = msg.envelope;
      const fromAddr = env?.from?.[0];
      const toAddr = env?.to?.[0];
      const { body } = bodyOf(msg.source, "zprava.eml");
      const date = env?.date ?? (msg.internalDate instanceof Date ? msg.internalDate : msg.internalDate ? new Date(msg.internalDate) : new Date());
      rows.push({
        uid: msg.uid,
        email: {
          messageId: env?.messageId || `imap-${uidValidity}-${msg.uid}`,
          fromName: fromAddr?.name || fromAddr?.address || "",
          fromEmail: fromAddr?.address || "",
          subject: env?.subject || "",
          body: body.slice(0, MAX_BODY),
          receivedAt: (Number.isNaN(date.getTime()) ? new Date() : date).toISOString(),
          toEmail: toAddr?.address || undefined,
        },
      });
    }
    rows.sort((a, b) => a.uid - b.uid);
    const base = reset ? (rows[0]?.uid ?? 1) - 1 : prev!.lastUid;
    return {
      emails: rows.map((r) => r.email),
      remaining,
      total,
      stateAfter: (n) => ({ ...state, imap: { uidValidity, lastUid: n > 0 ? rows[Math.min(n, rows.length) - 1].uid : base } }),
    };
  } finally {
    lock.release();
  }
}

async function fetchPop3(client: Pop3Client, state: MailSyncState, limit: number): Promise<Omit<FetchResult, "endpoint" | "healed">> {
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
    const src = raw.length > MAX_POP3_BYTES ? raw.subarray(0, MAX_POP3_BYTES) : raw;
    const { parsed } = bodyOf(src, `pop3-${m.uid}.eml`);
    const hasId = /^message-id:/im.test(src.subarray(0, 64 * 1024).toString("latin1"));
    emails.push({
      messageId: parsed && hasId ? parsed.messageId : `pop3-${m.uid}`,
      fromName: fixUtf8Mojibake(parsed?.fromName ?? ""),
      fromEmail: parsed?.fromEmail ?? "",
      subject: fixUtf8Mojibake(parsed?.subject ?? ""),
      body: (parsed?.body ?? "").slice(0, MAX_BODY),
      receivedAt: parsed?.receivedAt ?? new Date().toISOString(),
    });
  }
  return {
    emails,
    remaining,
    total,
    stateAfter: (n) => ({ ...state, pop3: { seen: [...baseSeen, ...pick.slice(0, Math.max(0, n)).map((m) => m.uid)] } }),
  };
}

/**
 * Stáhne nové zprávy ze schránky. Uložený server nefunguje (síť / šifrování) → zkusí ověřený
 * server poskytovatele (např. mail.<doména> → mail.hosting90.cz) a vrátí `healed`.
 */
export async function fetchIncoming(
  incoming: ResolvedEndpoint,
  email: string,
  state: MailSyncState,
  limit: number,
  opts: NetOptions & { budgetMs?: number } = {},
): Promise<FetchResult> {
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
      return { ...(await fetchPop3(result.client, state, limit)), endpoint, healed };
    } finally {
      await result.client.quit();
    }
  }
  try {
    return { ...(await fetchImap(result.client, state, limit)), endpoint, healed };
  } finally {
    await result.client.logout().catch(() => result.client.close());
  }
}
