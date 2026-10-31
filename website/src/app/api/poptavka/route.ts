import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { TEAM } from "@/content/site";
import { aresLookup } from "@/lib/ares";
import {
  ALLOWED_EXT,
  MAX_UPLOAD_BYTES,
  formatConfirmationEmail,
  formatLeadEmail,
  isValidCzIco,
  scoreLead,
  validateLead,
  type LeadInput,
} from "@/lib/lead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Jednoduchý rate-limit v paměti instance (best effort proti spamu).
const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 6;
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (limited(ip)) return NextResponse.json({ ok: false, error: "Příliš mnoho požadavků. Zkuste to prosím později." }, { status: 429 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatný požadavek nebo příliš velké přílohy." }, { status: 400 });
  }

  // Antispam: honeypot + minimální doba vyplnění
  const startedAt = Number(str(form, "_t"));
  if (str(form, "website") || (startedAt && Date.now() - startedAt < 3000)) {
    return NextResponse.json({ ok: true }); // tiché zahození botů
  }

  const lead: LeadInput = {
    needs: form.getAll("needs").map(String).slice(0, 12),
    budget: str(form, "budget"),
    quantity: str(form, "quantity"),
    deadline: str(form, "deadline"),
    material: str(form, "material").slice(0, 200),
    description: str(form, "description").slice(0, 5000),
    dataLink: str(form, "dataLink").slice(0, 500),
    ico: str(form, "ico").replace(/\s/g, "").toUpperCase(),
    company: str(form, "company").slice(0, 200),
    name: str(form, "name").slice(0, 120),
    position: str(form, "position").slice(0, 120),
    email: str(form, "email").slice(0, 200),
    phone: str(form, "phone").slice(0, 30),
    gdpr: str(form, "gdpr") === "on" || str(form, "gdpr") === "true",
    nda: str(form, "nda") === "on" || str(form, "nda") === "true",
    source: str(form, "source").slice(0, 200),
    cad: str(form, "cad").slice(0, 300),
  };

  const errors = validateLead(lead);
  const files = form.getAll("files").filter((x): x is File => typeof x === "object" && x !== null && "arrayBuffer" in x && (x as File).size > 0);
  const total = files.reduce((a, f) => a + f.size, 0);
  if (total > MAX_UPLOAD_BYTES) errors.files = "Přílohy jsou větší než 4 MB – vložte prosím odkaz na úložiště.";
  if (files.some((f) => !ALLOWED_EXT.includes(f.name.split(".").pop()?.toLowerCase() ?? ""))) errors.files = "Nepodporovaný typ souboru.";
  if (Object.keys(errors).length) return NextResponse.json({ ok: false, errors }, { status: 422 });

  const company = isValidCzIco(lead.ico) ? await aresLookup(lead.ico) : null;
  const score = scoreLead(lead, { company, attachments: files.length });
  const mail = formatLeadEmail(lead, score, company, files.map((f) => ({ name: f.name, size: f.size })));
  const attachments = await Promise.all(files.map(async (f) => ({ filename: f.name, content: Buffer.from(await f.arrayBuffer()) })));

  const smtpHost = process.env.SMTP_HOST;
  const webhook = process.env.LEAD_WEBHOOK_URL;
  const to = process.env.LEAD_TO || TEAM.map((t) => t.email).slice(0, 2).join(",");
  const contact = TEAM[1];
  let delivered = false;
  const problems: string[] = [];

  if (smtpHost) {
    try {
      const port = Number(process.env.SMTP_PORT || 465);
      const transport = nodemailer.createTransport({
        host: smtpHost,
        port,
        secure: port === 465,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      });
      const from = process.env.SMTP_FROM || process.env.SMTP_USER || "web@mnastrojarna.cz";
      await transport.sendMail({ from, to, replyTo: `${lead.name} <${lead.email}>`, subject: mail.subject, text: mail.text, html: mail.html, attachments });
      delivered = true;
      // potvrzení zákazníkovi (neblokující chyba)
      const conf = formatConfirmationEmail(lead, contact);
      await transport.sendMail({ from, to: lead.email, replyTo: contact.email, subject: conf.subject, text: conf.text }).catch(() => undefined);
    } catch (e) {
      problems.push(`smtp: ${(e as Error).message}`);
    }
  }

  if (webhook) {
    try {
      const r = await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json", ...(process.env.LEAD_WEBHOOK_SECRET ? { authorization: `Bearer ${process.env.LEAD_WEBHOOK_SECRET}` } : {}) },
        body: JSON.stringify({ lead, score, company, files: files.map((f) => ({ name: f.name, size: f.size })), receivedAt: new Date().toISOString() }),
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) delivered = true;
      else problems.push(`webhook: HTTP ${r.status}`);
    } catch (e) {
      problems.push(`webhook: ${(e as Error).message}`);
    }
  }

  if (!smtpHost && !webhook) {
    if (process.env.NODE_ENV !== "production") {
      console.info("[poptavka] (dev, bez SMTP) ", mail.subject, "\n", mail.text);
      return NextResponse.json({ ok: true, dev: true });
    }
    problems.push("Není nastaven SMTP_HOST ani LEAD_WEBHOOK_URL.");
  }

  if (!delivered) {
    console.error("[poptavka] doručení selhalo:", problems.join(" | "));
    return NextResponse.json(
      { ok: false, error: `Poptávku se nepodařilo odeslat. Napište nám prosím přímo na ${contact.email}.` },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true });
}
