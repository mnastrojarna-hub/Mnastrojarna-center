import "server-only";
import nodemailer from "nodemailer";
import { getSetting } from "@/lib/settings";
import { COMPANY } from "@/lib/company";
import { refreshCompanyFromSettings } from "@/lib/company-server";
import { createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import type { MailboxConfig } from "@/lib/supabase/database.types";

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
  from?: string;
  mailboxId?: string;
  ownerId?: string | null;
}

export interface SmtpPreference {
  /** Odeslat z konkrétní schránky. */
  mailboxId?: string;
  /** Odeslat ze schránky tohoto uživatele (vlastník schránky). */
  ownerId?: string;
}

/**
 * SMTP konfigurace: 1) požadovaná schránka, 2) schránka uživatele,
 * 3) první aktivní schránka s odchozím serverem (firemní), 4) globální klíče.
 */
async function getSmtp(pref: SmtpPreference = {}): Promise<SmtpConfig> {
  if (isSupabaseConfigured() && hasServiceKey()) {
    try {
      const db = createAdminClient();
      const { data } = await db
        .from("mailboxes")
        .select("id, email, config, owner_id")
        .eq("active", true);
      const rows = ((data ?? []) as { id: string; email: string; config: MailboxConfig; owner_id: string | null }[])
        .filter((b) => b.config?.smtp_host && b.config?.smtp_user && b.config?.smtp_password);
      const box =
        (pref.mailboxId && rows.find((b) => b.id === pref.mailboxId)) ||
        (pref.ownerId && rows.find((b) => b.owner_id === pref.ownerId)) ||
        rows[0];
      if (box) {
        return {
          host: box.config.smtp_host,
          port: Number(box.config.smtp_port || 465),
          user: box.config.smtp_user,
          password: box.config.smtp_password,
          from: box.email,
          mailboxId: box.id,
          ownerId: box.owner_id,
        };
      }
    } catch {
      // spadni na globální nastavení
    }
  }
  const [host, port, user, password] = await Promise.all([
    getSetting("smtp_host"),
    getSetting("smtp_port"),
    getSetting("smtp_user"),
    getSetting("smtp_password"),
  ]);
  return { host, port: Number(port || 465), user, password };
}

export async function isSmtpConfigured(pref: SmtpPreference = {}): Promise<boolean> {
  const s = await getSmtp(pref);
  return Boolean(s.host && s.user && s.password);
}

export async function sendMail(input: {
  to: string;
  subject: string;
  text: string;
  /** Volitelná HTML verze (brandovaný e-mail). */
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
  /** Ze které schránky / čí schránky odeslat. */
  from?: SmtpPreference;
  /** Zapsat do Odeslané pošty (výchozí ano). Systémové e-maily (obnova hesla) ne. */
  log?: boolean;
  /** Zakázka, ke které e-mail patří (emails.order_id). */
  jobId?: string;
  /** Kdo e-mail odeslal (vlastník záznamu v odeslané poště). */
  senderId?: string;
}): Promise<SendResult> {
  await refreshCompanyFromSettings();
  const s = await getSmtp(input.from);
  if (!s.host || !s.user || !s.password) {
    return {
      sent: false,
      reason: "SMTP není nakonfigurováno — nastav odchozí server u schránky (Nastavení → E-mailové schránky).",
    };
  }
  if (!input.to) return { sent: false, reason: "Chybí adresát." };

  let messageId: string | undefined;
  try {
    const transport = nodemailer.createTransport({
      host: s.host,
      port: s.port,
      secure: s.port === 465,
      auth: { user: s.user, pass: s.password },
    });
    const info = await transport.sendMail({
      from: `"${COMPANY.name}" <${s.from ?? s.user}>`,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      attachments: input.attachments,
    });
    messageId = info.messageId;
  } catch (err) {
    return { sent: false, reason: err instanceof Error ? err.message : "Chyba odeslání" };
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
          from_email: s.from ?? s.user ?? null,
          to_email: input.to,
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
