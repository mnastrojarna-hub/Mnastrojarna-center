import "server-only";
import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { getSetting } from "@/lib/settings";
import { COMPANY } from "@/lib/company";
import { refreshCompanyFromSettings } from "@/lib/company-server";
import { createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import type { MailboxConfig, MailboxProvider } from "@/lib/supabase/database.types";
import {
  defaultTlsForPort, isLoopbackHost, normalizeHost, resolveSmtp, tlsModesForPort,
  type SmtpAuthMethod, type SmtpPasswordSource, type TlsMode,
} from "@/lib/email/mail-config";
import { graphError, graphToken, providerFallbacks, smtpTransport } from "@/lib/email/mail-connect";
import { describeSmtpFailure, sendWithSmtpRecovery, type SmtpTry } from "@/lib/email/smtp-recovery";
import { healSmtpPassword } from "@/lib/email/smtp-heal";
import { appendToSent, type SentCopyState } from "@/lib/email/mail-append";
import { bracketId } from "@/lib/email/threading";
import { outgoingCategory } from "@/lib/email/mail-rules";
import { signatureHtmlForApp } from "@/lib/email/signature";
import { applySignature, outgoingSignature, type InlineImage } from "@/lib/email/signature-server";
import type { EmailCategory as DbEmailCategory } from "@/lib/supabase/database.types";

/**
 * Odesílání pošty z aplikace (SMTP schránky, Microsoft Graph u schránek M365, globální SMTP).
 *
 * Odkud se posílá (pickSmtpMailbox):
 *  - uživatel (`ownerId`, volitelně `replyMailboxId` u odpovědi): jeho vlastní schránka (u odpovědi
 *    přednostně ta, kam e-mail přišel, je-li jeho) → u odpovědi schránka, kam e-mail přišel, je-li
 *    firemní (bez vlastníka) → firemní schránka → globální SMTP (Nastavení → API klíče a integrace).
 *    NIKDY z osobní schránky jiného uživatele. Má-li uživatel vlastní schránku, ale bez odesílání /
 *    vypnutou → NEodeslat a říct proč (žádné tiché odeslání z cizí adresy).
 *  - `mailboxId` — výslovně zadaná schránka (objednávka dodavateli ze schránky obchodníka zakázky),
 *  - `system: true` — systémový e-mail (obnova hesla, pozvánka): firemní schránka → globální SMTP.
 *
 * Každý odeslaný e-mail: zápis do `emails` (direction out, vlákno přes In-Reply-To / References —
 * trigger emails_thread_assign), přílohy do úložiště a kopie do složky Odeslané na serveru (IMAP
 * APPEND; selhání neshodí odeslání, jen se vrátí ve `sentCopy`).
 */

export interface SendResult {
  sent: boolean;
  reason?: string;
  messageId?: string;
  /** Záznam v odeslané poště (emails, direction = out). */
  emailId?: string;
  /** Odesláno z této adresy. */
  fromAddress?: string;
  /** Kopie ve složce Odeslané na serveru. */
  sentCopy?: SentCopyState;
  sentCopyError?: string;
}

interface SmtpConfig {
  host?: string;
  port: number;
  user?: string;
  password?: string;
  /** Odkud je heslo (vlastní SMTP × příchozí pošta × globální SMTP) — do hlášky a pro samoopravu. */
  passwordSource?: SmtpPasswordSource;
  /** Heslo příchozí pošty, liší-li se od uloženého vlastního SMTP hesla (záložní pokus). */
  incomingPassword?: string;
  /** Vynucený mechanismus AUTH (druhý pokus PLAIN ↔ LOGIN). */
  authMethod?: SmtpAuthMethod;
  /** Šifrování (výchozí podle portu: 465 TLS, 587/25/366 STARTTLS; `none` jen ručně). */
  tls?: TlsMode;
  skipNameCheck?: boolean;
  from?: string;
  mailboxId?: string;
  ownerId?: string | null;
  /** Schránka (pro kopii do Odeslaných a Graph). */
  box?: BoxRow | null;
  /** Odeslat přes Microsoft Graph (schránka M365). */
  graph?: { clientId: string; clientSecret: string; tenantId: string };
}

export type SmtpPreference =
  | { mailboxId: string; ownerId?: string; system?: never; replyMailboxId?: never }
  | { ownerId: string; replyMailboxId?: string | null; mailboxId?: never; system?: never }
  | { system: true; mailboxId?: never; ownerId?: never; replyMailboxId?: never };

type BoxRow = {
  id: string; email: string; config: MailboxConfig; owner_id: string | null; active: boolean | null;
  provider?: MailboxProvider | null; display_name?: string | null;
};

export type SmtpPick = { ok: true; box: BoxRow | null } | { ok: false; reason: string };

const FIX_OWN = "nastav ho v Můj účet → Moje e-mailová schránka (nebo požádej admina)";

function hasGraph(b: BoxRow): boolean {
  const c = b.config ?? {};
  return b.provider === "outlook" && Boolean(c.ms_graph_client_id && c.ms_graph_client_secret && c.ms_graph_tenant_id);
}

/** Umí schránka odesílat (aktivní + SMTP, nebo M365 přes Graph)? */
export function canSendFrom(b: BoxRow): boolean {
  return b.active !== false && (Boolean(resolveSmtp(b.config, b.email)) || hasGraph(b));
}

/**
 * Výběr schránky pro odeslání (čistá funkce; `rows` = všechny schránky od nejstarší).
 * `box: null` = žádná použitelná schránka → globální SMTP (je-li nastavené).
 */
export function pickSmtpMailbox(rows: BoxRow[], pref: SmtpPreference): SmtpPick {
  const usable = canSendFrom;
  if (pref.mailboxId) {
    const box = rows.find((b) => b.id === pref.mailboxId);
    if (!box) return { ok: false, reason: "Schránka pro odeslání neexistuje (smazaná?) — e-mail neodešel." };
    if (box.active === false) return { ok: false, reason: `Schránka ${box.email} je vypnutá — zapni ji v nastavení schránky, nebo požádej admina. E-mail neodešel.` };
    if (!usable(box)) return { ok: false, reason: `Schránka ${box.email} nemá nastavené odesílání (SMTP) — ${FIX_OWN}. E-mail neodešel.` };
    return { ok: true, box };
  }
  const company = rows.filter((b) => !b.owner_id);
  if (pref.ownerId) {
    const own = rows.filter((b) => b.owner_id === pref.ownerId);
    const reply = pref.replyMailboxId ? rows.find((b) => b.id === pref.replyMailboxId) : undefined;
    // 1) vlastní schránka — u odpovědi přednostně ta, kam e-mail přišel
    if (reply && reply.owner_id === pref.ownerId && usable(reply)) return { ok: true, box: reply };
    const mine = own.find(usable);
    if (mine) return { ok: true, box: mine };
    if (own.length) {
      // má vlastní schránku, ale neodesílá → neposílat potichu z jiné (firemní) adresy
      if (own.every((b) => b.active === false)) {
        return { ok: false, reason: `Tvoje schránka ${own[0].email} je vypnutá — zapni ji v Můj účet → Moje e-mailová schránka (nebo požádej admina). E-mail neodešel.` };
      }
      return { ok: false, reason: `Tvoje schránka nemá nastavené odesílání (SMTP) — ${FIX_OWN}. E-mail neodešel.` };
    }
    // 2) odpověď z firemní schránky, kam e-mail přišel (osobní schránku kolegy nikdy)
    if (reply && !reply.owner_id && usable(reply)) return { ok: true, box: reply };
    // 3) firemní schránka → 4) globální SMTP
    return { ok: true, box: company.find(usable) ?? null };
  }
  // systémový e-mail: firemní schránka (bez vlastníka, nejstarší) → globální SMTP
  return { ok: true, box: company.find(usable) ?? null };
}

type SmtpLookup = { ok: true; cfg: SmtpConfig } | { ok: false; reason: string };

async function loadBoxes(): Promise<BoxRow[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("mailboxes")
    .select("id, email, config, owner_id, active, provider, display_name, created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BoxRow[];
}

function boxConfig(box: BoxRow): SmtpConfig | null {
  if (hasGraph(box) && !resolveSmtp(box.config, box.email)) {
    const c = box.config;
    return {
      port: 0, from: box.email, mailboxId: box.id, ownerId: box.owner_id, box,
      graph: { clientId: c.ms_graph_client_id!, clientSecret: c.ms_graph_client_secret!, tenantId: c.ms_graph_tenant_id! },
    };
  }
  const smtp = resolveSmtp(box.config, box.email);
  if (!smtp) return null;
  // šifrování jen výslovně nastavené; jinak podle portu (lokální testovací server bez TLS)
  const plainLocal = !box.config?.smtp_tls && isLoopbackHost(smtp.host) && tlsModesForPort(smtp.port).length > 1;
  return {
    host: smtp.host, port: smtp.port, user: smtp.user, password: smtp.password,
    passwordSource: smtp.passwordSource, incomingPassword: smtp.incomingPassword,
    tls: plainLocal ? undefined : smtp.tls, skipNameCheck: smtp.skipNameCheck,
    from: box.email, mailboxId: box.id, ownerId: box.owner_id, box,
  };
}

async function globalSmtp(): Promise<SmtpConfig> {
  const [host, port, user, password] = await Promise.all([
    getSetting("smtp_host"), getSetting("smtp_port"), getSetting("smtp_user"), getSetting("smtp_password"),
  ]);
  return { host: host ? normalizeHost(host).host : host, port: Number(port || 465), user, password, passwordSource: "global" };
}

async function getSmtp(pref: SmtpPreference): Promise<SmtpLookup> {
  if (isSupabaseConfigured() && hasServiceKey()) {
    let rows: BoxRow[];
    try {
      rows = await loadBoxes();
    } catch (err) {
      if (!pref.system) return { ok: false, reason: `Schránku pro odeslání nelze načíst (${err instanceof Error ? err.message : "chyba databáze"}) — e-mail neodešel.` };
      rows = [];
    }
    const pick = pickSmtpMailbox(rows, pref);
    if (!pick.ok) return pick;
    if (pick.box) {
      const cfg = boxConfig(pick.box);
      if (cfg) return { ok: true, cfg };
    }
    if (pref.mailboxId) return { ok: false, reason: `Schránka pro odeslání nemá nastavené odesílání — ${FIX_OWN}. E-mail neodešel.` };
    const g = await globalSmtp();
    if (!g.host || !g.user || !g.password) {
      return {
        ok: false,
        reason: pref.system
          ? "SMTP není nakonfigurováno — nastav odchozí server u firemní schránky (Nastavení → E-mailové schránky)."
          : "Nemáš vlastní e-mailovou schránku a firemní schránka nemá odesílání — nastav si schránku v Můj účet → Moje e-mailová schránka. E-mail neodešel.",
      };
    }
    return { ok: true, cfg: g };
  }
  // vývoj bez databáze: globální SMTP
  return { ok: true, cfg: await globalSmtp() };
}

/**
 * Transport se šifrováním podle portu (465 TLS, jinak STARTTLS povinně) a krátkými časovými
 * limity. Jen lokální testovací server (localhost, nestandardní port) smí bez TLS.
 */
async function createSmtpTransport(s: SmtpConfig) {
  const port = s.port || 465;
  const tls = s.tls ?? defaultTlsForPort(port);
  const plainLocal = isLoopbackHost(s.host ?? "") && !s.tls && tlsModesForPort(port).length > 1;
  const method = s.authMethod ? { method: s.authMethod } : {};
  if (plainLocal) {
    return nodemailer.createTransport({
      host: s.host, port, secure: false, auth: { user: s.user!, pass: s.password!, ...method },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000,
    });
  }
  return smtpTransport({ protocol: "smtp", host: s.host!, port, tls, skipNameCheck: s.skipNameCheck }, { user: s.user!, pass: s.password!, ...method }, { timeoutMs: 10_000 });
}

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/**
 * Adresa odesílatele: schránka → SMTP login (bývá to e-mail) → firemní e-mail.
 * SMTP login nemusí být e-mail (např. „obchod"); server by pak zprávu odmítl.
 */
export function pickFromAddress(candidates: (string | null | undefined)[]): string | undefined {
  return candidates.map((c) => c?.trim()).find((c): c is string => Boolean(c && EMAIL_RE.test(c)));
}

export async function isSmtpConfigured(pref: SmtpPreference): Promise<boolean> {
  const s = await getSmtp(pref);
  return s.ok && Boolean(s.cfg.graph || (s.cfg.host && s.cfg.user && s.cfg.password));
}

/** Kdo a odkud by odeslal (pro UI „Odeslat z …") — bez hesel. */
export async function describeSender(pref: SmtpPreference): Promise<{ ok: boolean; from?: string; mailboxId?: string | null; reason?: string }> {
  const s = await getSmtp(pref);
  if (!s.ok) return { ok: false, reason: s.reason };
  const from = pickFromAddress([s.cfg.from, s.cfg.user, COMPANY.email]);
  return from ? { ok: true, from, mailboxId: s.cfg.mailboxId ?? null } : { ok: false, reason: "Chybí e-mail odesílatele." };
}

/**
 * Text podpisu uživatele pro schránku, ze které by zpráva odešla (návrh e-mailu v dialogu dokladu /
 * objednávky: podpis je v textu vidět a jde upravit; sendMail({ signature: { mode: "inline" } }) ho při
 * odeslání převede na grafický). Prázdný = bez podpisu (vypnutý, chyba) → volající použije svůj text.
 */
export async function senderSignatureText(userId: string | null | undefined, pref: SmtpPreference): Promise<string> {
  if (!userId || !isSupabaseConfigured() || !hasServiceKey()) return "";
  try {
    const sender = await describeSender(pref);
    return (await outgoingSignature({ userId, mailboxEmail: sender.ok ? sender.from : null })).text;
  } catch {
    return "";
  }
}

export interface OutgoingAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface SendMailInput {
  to: string;
  /** Kopie (více adres oddělených čárkou). */
  cc?: string;
  /** Skrytá kopie (do záhlaví zprávy se nedostane). */
  bcc?: string;
  subject: string;
  text: string;
  /** Volitelná HTML verze (brandovaný e-mail). */
  html?: string;
  attachments?: OutgoingAttachment[];
  /** Ze které schránky / čí schránky odeslat, nebo `{ system: true }` (povinné — viz SmtpPreference). */
  from: SmtpPreference;
  /** Zapsat do Odeslané pošty (výchozí ano). Systémové e-maily (obnova hesla) ne. */
  log?: boolean;
  /** Zakázka, ke které e-mail patří (emails.order_id). */
  jobId?: string;
  /** Kdo e-mail odeslal (vlastník záznamu v odeslané poště). */
  senderId?: string;
  /** Jméno odesílatele v hlavičce From (výchozí: jméno vlastníka schránky, u firemní název firmy). */
  fromName?: string;
  /** Odpověď: Message-ID původní zprávy (hlavička In-Reply-To). */
  inReplyTo?: string | null;
  /** Odpověď: References (nejstarší první). */
  references?: string[] | null;
  /** Kopie do složky Odeslané na serveru (výchozí ano). */
  appendToSent?: boolean;
  /** Vazby záznamu v odeslané poště. */
  customerId?: string | null;
  supplierId?: string | null;
  /**
   * Grafický podpis uživatele `userId` pro schránku, ze které zpráva odchází (Pošta → Nastavení pošty):
   * „inline" = podpis už je v textu (okno psaní, dialog dokladu) → převést na grafický s logem,
   * „append" (výchozí) = e-mail ve jménu uživatele (schválená odpověď, AI nabídka) → připojit jednou.
   * Bez podpisu v textu / vypnutý podpis = jen text. Logo jde jako vložená příloha (cid).
   */
  signature?: { userId: string; mode?: "inline" | "append" } | null;
  /** Kategorie v odeslané poště (výchozí podle předmětu, viz outgoingCategory). */
  category?: DbEmailCategory | null;
}

/** Hlavička From: „Jméno" <adresa> (uvozovky a konce řádků z jména pryč). */
export function formatFrom(name: string | null | undefined, address: string): string {
  const n = (name ?? "").replace(/[\r\n"]+/g, " ").trim();
  return n ? `"${n}" <${address}>` : address;
}

async function senderName(box: BoxRow | null | undefined, explicit?: string): Promise<string> {
  if (explicit?.trim()) return explicit.trim();
  if (box?.owner_id && isSupabaseConfigured() && hasServiceKey()) {
    try {
      const { data } = await createAdminClient().from("profiles").select("full_name").eq("id", box.owner_id).maybeSingle();
      const name = (data as { full_name: string | null } | null)?.full_name?.trim();
      if (name) return `${name} | ${COMPANY.name}`;
    } catch {
      // jméno je kosmetika
    }
  }
  return COMPANY.name;
}

/** Odeslání přes Microsoft Graph (/users/{schránka}/sendMail, kopie do Odeslané pošty dělá Microsoft). */
async function sendViaGraph(cfg: SmtpConfig, msg: {
  to: string[]; cc: string[]; bcc: string[]; subject: string; text: string; html?: string; attachments?: OutgoingAttachment[]; inline?: InlineImage[];
}) {
  const token = await graphToken(cfg.graph!);
  const rcpt = (list: string[]) => list.map((address) => ({ emailAddress: { address } }));
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.from!)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: msg.subject,
        body: msg.html ? { contentType: "HTML", content: msg.html } : { contentType: "Text", content: msg.text },
        toRecipients: rcpt(msg.to),
        ccRecipients: rcpt(msg.cc),
        bccRecipients: rcpt(msg.bcc),
        attachments: [
          ...(msg.attachments ?? []).map((a) => ({
            "@odata.type": "#microsoft.graph.fileAttachment", name: a.filename, contentType: a.contentType || "application/octet-stream",
            contentBytes: a.content.toString("base64"),
          })),
          // logo podpisu: vložená příloha (src="cid:…" v HTML)
          ...(msg.inline ?? []).map((a) => ({
            "@odata.type": "#microsoft.graph.fileAttachment", name: a.filename, contentType: a.contentType,
            contentBytes: a.content.toString("base64"), isInline: true, contentId: a.cid,
          })),
        ],
      },
      saveToSentItems: true,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw await graphError(res, "Microsoft 365 odmítl odeslání (chybí oprávnění Mail.Send?)");
}

function addresses(value: string | undefined): string[] {
  return (value ?? "").split(/[,;]/).map((a) => a.trim()).filter(Boolean);
}

const ATTACHMENT_BUCKET = "documents";

function safeName(name: string): string {
  return (name || "priloha").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").slice(0, 150) || "priloha";
}

/** Přílohy odeslaného e-mailu do úložiště (přeposlání, náhled) — best-effort. */
async function storeAttachments(emailId: string, attachments: OutgoingAttachment[]): Promise<void> {
  const db = createAdminClient();
  for (const a of attachments) {
    try {
      const path = `mail/out/${emailId}/${randomUUID()}-${safeName(a.filename)}`;
      const { error } = await db.storage.from(ATTACHMENT_BUCKET).upload(path, a.content, { contentType: a.contentType || "application/octet-stream", upsert: false });
      if (error) continue;
      await db.from("email_attachments").insert({
        email_id: emailId, filename: a.filename.slice(0, 255), mime_type: a.contentType || null, size_bytes: a.content.length, storage_path: path,
      } as never);
    } catch {
      // jedna příloha nesmí shodit ostatní
    }
  }
}

export async function sendMail(input: SendMailInput): Promise<SendResult> {
  await refreshCompanyFromSettings();
  const lookup = await getSmtp(input.from);
  if (!lookup.ok) return { sent: false, reason: lookup.reason };
  const s = lookup.cfg;
  if (!s.graph && (!s.host || !s.user || !s.password)) {
    return { sent: false, reason: "SMTP není nakonfigurováno — nastav odchozí server schránky (Můj účet → Moje e-mailová schránka, nebo Nastavení → E-mailové schránky)." };
  }
  const to = addresses(input.to);
  const cc = addresses(input.cc);
  const bcc = addresses(input.bcc);
  if (!to.length) return { sent: false, reason: "Chybí adresát." };

  const fromAddress = pickFromAddress([s.from, s.user, COMPANY.email]);
  if (!fromAddress) {
    return { sent: false, reason: "Chybí e-mail odesílatele — vyplň firemní e-mail v Nastavení nebo e-mail schránky." };
  }
  const domain = fromAddress.split("@")[1] || "mnastrojarna.local";
  const messageId = `<${randomUUID()}@${domain}>`;
  const inReplyTo = bracketId(input.inReplyTo) ?? undefined;
  const references = (input.references ?? []).map((r) => bracketId(r)).filter((r): r is string => Boolean(r));
  const name = await senderName(s.box, input.fromName);

  // Grafický podpis odesílatele pro schránku, ze které zpráva skutečně odchází (best-effort —
  // chyba podpisu odeslání nezastaví, zpráva pak odejde jen s textem)
  let text = input.text;
  let html = input.html;
  let inline: InlineImage[] = [];
  if (input.signature?.userId && isSupabaseConfigured() && hasServiceKey()) {
    try {
      const sig = await outgoingSignature({ userId: input.signature.userId, mailboxEmail: s.box?.email ?? fromAddress });
      const applied = applySignature(input.text, sig, input.signature.mode ?? "append");
      text = applied.text;
      if (applied.html) {
        html = applied.html;
        inline = applied.inline;
      }
    } catch (err) {
      console.error(`[mail:send] Podpis se nepodařilo připojit: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const attachments = [
    ...(input.attachments ?? []),
    ...inline.map((i) => ({ filename: i.filename, content: i.content, contentType: i.contentType, cid: i.cid, contentDisposition: "inline" as const })),
  ];

  // Zpráva se sestaví jednou (raw) — stejná jde přes SMTP i do složky Odeslané na serveru
  const node = new MailComposer({
    from: formatFrom(name, fromAddress),
    to: to.join(", "),
    cc: cc.length ? cc.join(", ") : undefined,
    bcc: bcc.length ? bcc.join(", ") : undefined,
    subject: input.subject,
    text,
    html,
    attachments: attachments.length ? attachments : undefined,
    messageId,
    inReplyTo,
    references: references.length ? references : undefined,
    date: new Date(),
  }).compile();
  const envelope = node.getEnvelope();
  let raw: Buffer;
  try {
    raw = await node.build();
  } catch (err) {
    return { sent: false, reason: `Zprávu se nepodařilo sestavit (${err instanceof Error ? err.message : "chyba"}).` };
  }

  const sendRaw = async (cfg: SmtpConfig) => {
    const transport = await createSmtpTransport(cfg);
    try {
      return await transport.sendMail({ envelope: { from: envelope.from || fromAddress, to: envelope.to }, raw });
    } finally {
      transport.close();
    }
  };
  if (s.graph) {
    try {
      await sendViaGraph(s, { to, cc, bcc, subject: input.subject, text, html, attachments: input.attachments, inline });
    } catch (err) {
      return { sent: false, reason: `Odeslání selhalo — ${err instanceof Error ? err.message : "Microsoft Graph chyba"}` };
    }
  } else {
    // uložené nastavení → (síť / TLS) ověřené servery poskytovatele → (odmítnuté vlastní SMTP heslo)
    // heslo příchozí pošty → druhý mechanismus AUTH; viz smtp-recovery.ts
    const port = s.port || 465;
    const first: SmtpTry = {
      host: s.host!, port, tls: s.tls ?? defaultTlsForPort(port), skipNameCheck: s.skipNameCheck,
      user: s.user!, password: s.password!, passwordSource: s.passwordSource ?? "incoming",
    };
    const explicitTls = s.tls; // lokální testovací server bez TLS: šifrování neurčovat (createSmtpTransport)
    const rec = await sendWithSmtpRecovery({
      first,
      incomingPassword: s.incomingPassword,
      fallbacks: s.from && !isLoopbackHost(s.host ?? "") ? () => providerFallbacks(s.from!, "smtp") : undefined,
      attempt: (t) => sendRaw({
        ...s, host: t.host, port: t.port, tls: t.host === first.host && t.port === first.port ? explicitTls : t.tls, skipNameCheck: t.skipNameCheck,
        password: t.password, authMethod: t.authMethod,
      }).then(() => undefined),
    });
    if (!rec.ok) {
      const owner = !s.box ? "global" : s.box.owner_id ? "own" : "company";
      return { sent: false, reason: `Odeslání selhalo — ${describeSmtpFailure(rec, { owner })}` };
    }
    if (rec.healSmtpPassword && s.mailboxId && s.passwordSource === "smtp" && s.password) {
      await healSmtpPassword(s.mailboxId, s.password, { reason: "send" });
    }
  }

  // Kopie do složky Odeslané na serveru (IMAP APPEND) — selhání jen nahlásit
  let sentCopy: SentCopyState = "skipped";
  let sentCopyError: string | undefined = s.box ? undefined : "odesláno přes globální SMTP (bez schránky)";
  if (s.box && input.appendToSent !== false) {
    const r = await appendToSent(s.box, raw).catch((e: unknown) => ({ state: "failed" as const, error: e instanceof Error ? e.message : "chyba" }));
    sentCopy = r.state;
    sentCopyError = r.error;
  } else if (input.appendToSent === false) {
    sentCopyError = undefined;
  }

  // Odeslaná pošta — best-effort (záznam nesmí shodit odeslání)
  let emailId: string | undefined;
  if (input.log !== false && isSupabaseConfigured() && hasServiceKey()) {
    try {
      const db = createAdminClient();
      const { data } = await db
        .from("emails")
        .insert({
          mailbox_id: s.mailboxId ?? null,
          direction: "out",
          message_id: s.graph ? null : messageId,
          in_reply_to: inReplyTo ?? null,
          message_refs: references.length ? references : null,
          from_name: name,
          from_email: fromAddress,
          to_email: to.join(", "),
          cc_email: cc.length ? cc.join(", ") : null,
          bcc_email: bcc.length ? bcc.join(", ") : null,
          subject: input.subject,
          body_text: text,
          // v aplikaci logo z webu (cid: znamená jen „příloha této zprávy")
          body_html: html ? signatureHtmlForApp(html) : null,
          // náhled v seznamu bez podpisu (oddělovač „-- ")
          snippet: (text.split(/\r?\n-- \r?\n/)[0] || text).replace(/\s+/g, " ").trim().slice(0, 200),
          owner_id: input.senderId ?? s.ownerId ?? null,
          order_id: input.jobId ?? null,
          customer_id: input.customerId ?? null,
          supplier_id: input.supplierId ?? null,
          category: input.category ?? outgoingCategory({ subject: input.subject, jobId: input.jobId ?? null }),
          is_read: true,
          has_draft: false,
          has_attachments: Boolean(input.attachments?.length),
          sent_copy: sentCopy,
          sent_copy_error: sentCopyError ?? null,
          received_at: new Date().toISOString(),
        } as never)
        .select("id")
        .maybeSingle();
      emailId = (data as { id: string } | null)?.id;
      if (emailId && input.attachments?.length) await storeAttachments(emailId, input.attachments);
    } catch {
      // log odeslané pošty je best-effort
    }
  }
  return { sent: true, messageId: s.graph ? undefined : messageId, emailId, fromAddress, sentCopy, sentCopyError };
}

/**
 * „Vyzkoušet odeslání": testovací e-mail ze schránky na její vlastní adresu (+ kopie do Odeslaných).
 * Do odeslané pošty aplikace se nezapisuje.
 */
export async function sendTestMail(mailboxId: string, who?: string | null): Promise<SendResult & { to?: string }> {
  let email: string | undefined;
  try {
    const { data } = await createAdminClient().from("mailboxes").select("email").eq("id", mailboxId).maybeSingle();
    email = (data as { email: string } | null)?.email;
  } catch {
    // níže
  }
  if (!email) return { sent: false, reason: "Schránka nenalezena." };
  const when = new Date().toLocaleString("cs-CZ", { timeZone: "Europe/Prague" });
  const res = await sendMail({
    to: email,
    subject: `Test odeslání z aplikace (${when})`,
    text: `Dobrý den,\n\ntento e-mail je zkouška odesílání ze schránky ${email} v aplikaci ${COMPANY.name}${who ? ` (spustil(a) ${who})` : ""}.\nKdyž ho vidíte v Přijaté poště, odesílání funguje.\n`,
    from: { mailboxId },
    log: false,
  });
  return { ...res, to: email };
}
