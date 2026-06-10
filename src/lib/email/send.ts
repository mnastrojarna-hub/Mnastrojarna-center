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
}

interface SmtpConfig {
  host?: string;
  port: number;
  user?: string;
  password?: string;
  from?: string;
}

/** SMTP konfigurace: přednost má aktivní schránka s vlastními servery, pak globální klíče. */
async function getSmtp(): Promise<SmtpConfig> {
  if (isSupabaseConfigured() && hasServiceKey()) {
    try {
      const db = createAdminClient();
      const { data } = await db
        .from("mailboxes")
        .select("email, config")
        .eq("active", true);
      const rows = (data ?? []) as { email: string; config: MailboxConfig }[];
      const box = rows.find(
        (b) => b.config?.smtp_host && b.config?.smtp_user && b.config?.smtp_password,
      );
      if (box) {
        return {
          host: box.config.smtp_host,
          port: Number(box.config.smtp_port || 465),
          user: box.config.smtp_user,
          password: box.config.smtp_password,
          from: box.email,
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

export async function isSmtpConfigured(): Promise<boolean> {
  const s = await getSmtp();
  return Boolean(s.host && s.user && s.password);
}

export async function sendMail(input: {
  to: string;
  subject: string;
  text: string;
  attachments?: { filename: string; content: Buffer }[];
}): Promise<SendResult> {
  await refreshCompanyFromSettings();
  const s = await getSmtp();
  if (!s.host || !s.user || !s.password) {
    return {
      sent: false,
      reason: "SMTP není nakonfigurováno — nastav odchozí server u schránky (Nastavení → E-mailové schránky).",
    };
  }
  if (!input.to) return { sent: false, reason: "Chybí adresát." };

  try {
    const transport = nodemailer.createTransport({
      host: s.host,
      port: s.port,
      secure: s.port === 465,
      auth: { user: s.user, pass: s.password },
    });
    await transport.sendMail({
      from: `"${COMPANY.name}" <${s.from ?? s.user}>`,
      to: input.to,
      subject: input.subject,
      text: input.text,
      attachments: input.attachments,
    });
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: err instanceof Error ? err.message : "Chyba odeslání" };
  }
}
