import "server-only";
import nodemailer from "nodemailer";
import { getSetting } from "@/lib/settings";
import { COMPANY } from "@/lib/company";

export interface SendResult {
  sent: boolean;
  reason?: string;
}

async function getSmtp() {
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
  const s = await getSmtp();
  if (!s.host || !s.user || !s.password) {
    return { sent: false, reason: "SMTP není nakonfigurováno (Nastavení → Integrace)." };
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
      from: `"${COMPANY.name}" <${s.user}>`,
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
