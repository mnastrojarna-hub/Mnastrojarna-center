import "server-only";
import nodemailer from "nodemailer";
import { getSetting } from "@/lib/settings";
import { COMPANY } from "@/lib/company";
import { refreshCompanyFromSettings } from "@/lib/company-server";
import { createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import type { MailboxConfig } from "@/lib/supabase/database.types";
import {
  classifyMailError, defaultTlsForPort, describeMailError, isLoopbackHost, normalizeHost, rawErrorText, resolveSmtp, tlsModesForPort,
  type TlsMode,
} from "@/lib/email/mail-config";
import { providerFallbacks, smtpTransport } from "@/lib/email/mail-connect";

export interface SendResult {
  sent: boolean;
  reason?: string;
  messageId?: string;
  /** Záznam v odeslané poště (emails, direction = out). */
  emailId?: string;
}

interface SmtpConfig {
  host?: string;
  port: number;
  user?: string;
  password?: string;
  /** Šifrování (výchozí podle portu: 465 TLS, 587/25/366 STARTTLS). */
  tls?: TlsMode;
  skipNameCheck?: boolean;
  from?: string;
  mailboxId?: string;
  ownerId?: string | null;
}

/**
 * Odkud odeslat. Každé volání to musí říct výslovně:
 * - `mailboxId` — z konkrétní schránky (odpověď na e-mail z této schránky),
 * - `ownerId` — ze schránky uživatele, který e-mail posílá (nabídky, doklady, objednávky),
 * - `system: true` — systémový e-mail (obnova hesla, pozvánka): firemní schránka bez vlastníka,
 *   jinak globální SMTP (Nastavení → API klíče a integrace).
 * Schránka uživatele / zadaná schránka bez SMTP nebo vypnutá = NEodeslat (žádná záloha na cizí adresu).
 */
export type SmtpPreference =
  | { mailboxId: string; ownerId?: string; system?: never }
  | { ownerId: string; mailboxId?: never; system?: never }
  | { system: true; mailboxId?: never; ownerId?: never };

type BoxRow = { id: string; email: string; config: MailboxConfig; owner_id: string | null; active: boolean | null };

export type SmtpPick = { ok: true; box: BoxRow | null } | { ok: false; reason: string };

const ASK_ADMIN = "doplň odchozí server (SMTP) v Nastavení → E-mailové schránky, nebo požádej admina";

/**
 * Výběr schránky pro odeslání (čistá funkce; `rows` = všechny schránky od nejstarší).
 * `box: null` = systémový e-mail bez firemní schránky → globální SMTP.
 */
export function pickSmtpMailbox(rows: BoxRow[], pref: SmtpPreference): SmtpPick {
  const usable = (b: BoxRow) => b.active !== false && Boolean(resolveSmtp(b.config, b.email));
  if (pref.mailboxId) {
    const box = rows.find((b) => b.id === pref.mailboxId);
    if (!box) return { ok: false, reason: "Schránka pro odeslání neexistuje (smazaná?) — e-mail neodešel." };
    if (box.active === false) return { ok: false, reason: `Schránka ${box.email} je vypnutá — zapni ji v Nastavení → E-mailové schránky, nebo požádej admina. E-mail neodešel.` };
    if (!usable(box)) return { ok: false, reason: `Schránka ${box.email} nemá nastavené odesílání — ${ASK_ADMIN}. E-mail neodešel.` };
    return { ok: true, box };
  }
  if (pref.ownerId) {
    const own = rows.filter((b) => b.owner_id === pref.ownerId);
    const box = own.find(usable);
    if (box) return { ok: true, box };
    if (!own.length) return { ok: false, reason: "Nemáš přiřazenou e-mailovou schránku pro odesílání — požádej admina (Nastavení → E-mailové schránky). E-mail neodešel." };
    if (own.every((b) => b.active === false)) {
      return { ok: false, reason: `Tvoje schránka ${own[0].email} je vypnutá — zapni ji v Nastavení → E-mailové schránky, nebo požádej admina. E-mail neodešel.` };
    }
    return { ok: false, reason: `Tvoje schránka nemá nastavené odesílání — ${ASK_ADMIN}. E-mail neodešel.` };
  }
  // systémový e-mail: firemní schránka (bez vlastníka, nejstarší) → globální SMTP
  return { ok: true, box: rows.find((b) => !b.owner_id && usable(b)) ?? null };
}

type SmtpLookup = { ok: true; cfg: SmtpConfig } | { ok: false; reason: string };

async function getSmtp(pref: SmtpPreference): Promise<SmtpLookup> {
  if (isSupabaseConfigured() && hasServiceKey()) {
    let rows: BoxRow[];
    try {
      const db = createAdminClient();
      const { data, error } = await db
        .from("mailboxes")
        .select("id, email, config, owner_id, active, created_at")
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      rows = (data ?? []) as BoxRow[];
    } catch (err) {
      if (!pref.system) return { ok: false, reason: `Schránku pro odeslání nelze načíst (${err instanceof Error ? err.message : "chyba databáze"}) — e-mail neodešel.` };
      rows = [];
    }
    const pick = pickSmtpMailbox(rows, pref);
    if (!pick.ok) return pick;
    const box = pick.box;
    const smtp = box ? resolveSmtp(box.config, box.email) : null;
    if (box && smtp) {
      // šifrování jen výslovně nastavené; jinak podle portu (lokální testovací server bez TLS)
      const plainLocal = !box.config?.smtp_tls && isLoopbackHost(smtp.host) && tlsModesForPort(smtp.port).length > 1;
      return {
        ok: true,
        cfg: {
          host: smtp.host,
          port: smtp.port,
          user: smtp.user,
          password: smtp.password,
          tls: plainLocal ? undefined : smtp.tls,
          skipNameCheck: smtp.skipNameCheck,
          from: box.email,
          mailboxId: box.id,
          ownerId: box.owner_id,
        },
      };
    }
    if (!pref.system) return { ok: false, reason: `Schránka pro odeslání nemá nastavené odesílání — ${ASK_ADMIN}. E-mail neodešel.` };
  }
  // systémový e-mail bez firemní schránky (nebo vývoj bez databáze): globální SMTP
  const [host, port, user, password] = await Promise.all([
    getSetting("smtp_host"),
    getSetting("smtp_port"),
    getSetting("smtp_user"),
    getSetting("smtp_password"),
  ]);
  return { ok: true, cfg: { host: host ? normalizeHost(host).host : host, port: Number(port || 465), user, password } };
}

/**
 * Transport se šifrováním podle portu (465 TLS, jinak STARTTLS povinně) a krátkými časovými
 * limity. Jen lokální testovací server (localhost, nestandardní port) smí bez TLS.
 */
async function createSmtpTransport(s: SmtpConfig) {
  const port = s.port || 465;
  const tls = s.tls ?? defaultTlsForPort(port);
  const plainLocal = isLoopbackHost(s.host ?? "") && !s.tls && tlsModesForPort(port).length > 1;
  if (plainLocal) {
    return nodemailer.createTransport({
      host: s.host, port, secure: false, auth: { user: s.user!, pass: s.password! },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000,
    });
  }
  return smtpTransport({ protocol: "smtp", host: s.host!, port, tls, skipNameCheck: s.skipNameCheck }, { user: s.user!, pass: s.password! }, { timeoutMs: 10_000 });
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
  return s.ok && Boolean(s.cfg.host && s.cfg.user && s.cfg.password);
}

export async function sendMail(input: {
  to: string;
  /** Kopie (více adres oddělených čárkou). */
  cc?: string;
  subject: string;
  text: string;
  /** Volitelná HTML verze (brandovaný e-mail). */
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
  /** Ze které schránky / čí schránky odeslat, nebo `{ system: true }` (povinné — viz SmtpPreference). */
  from: SmtpPreference;
  /** Zapsat do Odeslané pošty (výchozí ano). Systémové e-maily (obnova hesla) ne. */
  log?: boolean;
  /** Zakázka, ke které e-mail patří (emails.order_id). */
  jobId?: string;
  /** Kdo e-mail odeslal (vlastník záznamu v odeslané poště). */
  senderId?: string;
}): Promise<SendResult> {
  await refreshCompanyFromSettings();
  const lookup = await getSmtp(input.from);
  if (!lookup.ok) return { sent: false, reason: lookup.reason };
  const s = lookup.cfg;
  if (!s.host || !s.user || !s.password) {
    return {
      sent: false,
      reason: "SMTP není nakonfigurováno — nastav odchozí server u firemní schránky (Nastavení → E-mailové schránky).",
    };
  }
  if (!input.to) return { sent: false, reason: "Chybí adresát." };

  let messageId: string | undefined;
  const fromAddress = pickFromAddress([s.from, s.user, COMPANY.email]);
  if (!fromAddress) {
    return { sent: false, reason: "Chybí e-mail odesílatele — vyplň firemní e-mail v Nastavení nebo e-mail schránky." };
  }
  const message = {
    from: `"${COMPANY.name}" <${fromAddress}>`,
    to: input.to,
    cc: input.cc?.trim() || undefined,
    subject: input.subject,
    text: input.text,
    html: input.html,
    attachments: input.attachments,
  };
  const send = async (cfg: SmtpConfig) => {
    const transport = await createSmtpTransport(cfg);
    try {
      return await transport.sendMail(message);
    } finally {
      transport.close();
    }
  };
  try {
    try {
      messageId = (await send(s)).messageId;
    } catch (err) {
      // síť / certifikát (ne heslo): ověřený SMTP server poskytovatele (hosting90: smtp.hosting90.cz)
      const kind = classifyMailError(err);
      if (kind === "auth" || !s.from || isLoopbackHost(s.host ?? "")) throw err;
      let sentInfo: { messageId?: string } | null = null;
      for (const ep of await providerFallbacks(s.from, "smtp")) {
        if (ep.host === s.host && ep.port === s.port) continue;
        try {
          sentInfo = await send({ ...s, host: ep.host, port: ep.port, tls: ep.tls, skipNameCheck: false });
          break;
        } catch (e2) {
          if (classifyMailError(e2) === "auth") throw e2;
        }
      }
      if (!sentInfo) throw err;
      messageId = sentInfo.messageId;
    }
  } catch (err) {
    const tls = s.tls ?? defaultTlsForPort(s.port || 465);
    const kind = classifyMailError(err);
    return {
      sent: false,
      reason: `Odeslání selhalo — ${describeMailError(kind, { endpoint: { protocol: "smtp", host: s.host ?? "", port: s.port, tls }, raw: rawErrorText(err), user: s.user })}`,
    };
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
          message_id: messageId ?? null,
          from_name: COMPANY.name,
          from_email: pickFromAddress([s.from, s.user, COMPANY.email]) ?? null,
          to_email: input.to,
          cc_email: input.cc?.trim() || null,
          subject: input.subject,
          body_text: input.text,
          body_html: input.html ?? null,
          snippet: input.text.slice(0, 200),
          owner_id: input.senderId ?? s.ownerId ?? null,
          order_id: input.jobId ?? null,
          is_read: true,
          has_draft: false,
          received_at: new Date().toISOString(),
        } as never)
        .select("id")
        .maybeSingle();
      emailId = (data as { id: string } | null)?.id;
    } catch {
      // log odeslané pošty je best-effort
    }
  }
  return { sent: true, messageId, emailId };
}
