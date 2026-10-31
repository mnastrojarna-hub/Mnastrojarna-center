import "server-only";
import { createAdminClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { checkFeature, getAccess } from "@/lib/auth/session";
import { userActor } from "@/lib/supabase/actor-headers";
import type { JobsDb } from "@/lib/jobs/events";
import { getVisibleEmailRow } from "@/lib/data/mail";
import { isUuidLike } from "@/lib/email/visibility";
import { loadEmailAttachment } from "@/lib/email/attachments";
import { fakeGroupFor } from "@/lib/ai/fake-capture";
import { logAudit } from "@/lib/audit";
import { supplierInvoicePerms } from "@/lib/supplier-invoices/access";
import { recordInvoiceDocument } from "@/lib/supplier-invoices/record";
import { recordResultMessage, rejectTypeMessage, type RecordInvoiceResult } from "@/lib/supplier-invoices/record-types";
import { dateText, formatMoney } from "@/components/supplier-invoices/format";

/**
 * Pošta → „Zapsat fakturu dodavatele" → stránka Zanést fakturu s přílohou e-mailu předvybranou:
 * kandidáti (PDF / obrázky bez log a podpisů) a zápis jedné přílohy stejnou cestou jako nahraný soubor.
 */

const NOT_FOUND = "E-mail nenalezen (nebo k němu nemáš přístup).";
const MIN_INLINE_IMAGE = 15 * 1024;
const FILE_RE = /\.(pdf|png|jpe?g|webp|heic|heif)$/i;

export interface EmailInvoiceAttachment {
  id: string;
  filename: string;
  mimeType: string | null;
  size: number | null;
  /** PDF / obrázek faktury (ostatní přílohy jen pro přehled — zanést nejdou). */
  usable: boolean;
}

export interface EmailInvoiceSource {
  emailId: string;
  subject: string | null;
  from: string | null;
  receivedAt: string | null;
  attachments: EmailInvoiceAttachment[];
  /** Předvybraná příloha (první PDF, jinak největší obrázek). */
  preselectedId: string | null;
}

function usable(a: { filename: string | null; mime_type: string | null; size_bytes: number | null }): boolean {
  const mime = (a.mime_type ?? "").toLowerCase();
  const name = a.filename ?? "";
  if (mime.startsWith("image/") && (a.size_bytes ?? 0) > 0 && (a.size_bytes ?? 0) < MIN_INLINE_IMAGE) return false; // logo / podpis
  if (mime === "application/pdf" || /^image\/(jpe?g|png|webp|hei[cf])$/.test(mime)) return true;
  return (!mime || mime === "application/octet-stream") && FILE_RE.test(name);
}

const isPdf = (a: EmailInvoiceAttachment) => (a.mimeType ?? "").toLowerCase() === "application/pdf" || /\.pdf$/i.test(a.filename);

type EmailRow = { id: string; subject: string | null; from_name: string | null; from_email: string | null; received_at: string | null; supplier_id: string | null };

/** Přílohy e-mailu pro „Zanést fakturu" (null = e-mail neexistuje / nesmím ho vidět). */
export async function emailInvoiceSource(emailId: string): Promise<EmailInvoiceSource | null> {
  if (!isSupabaseConfigured() || !isUuidLike(emailId)) return null;
  const found = await getVisibleEmailRow<EmailRow>(emailId, "id, subject, from_name, from_email, received_at, supplier_id");
  if (!found) return null;
  const db = createAdminClient() as unknown as JobsDb;
  const { data } = await db.from("email_attachments").select("id, filename, mime_type, size_bytes").eq("email_id", emailId).order("filename").limit(50);
  const attachments = ((data ?? []) as { id: string; filename: string | null; mime_type: string | null; size_bytes: number | null }[])
    .map((a) => ({ id: a.id, filename: (a.filename ?? "").trim() || "příloha", mimeType: a.mime_type, size: a.size_bytes, usable: usable(a) }));
  const ok = attachments.filter((a) => a.usable);
  const pick = ok.find(isPdf) ?? [...ok].sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0] ?? null;
  const e = found.row;
  return {
    emailId, subject: e.subject, receivedAt: e.received_at,
    from: [e.from_name, e.from_email ? `<${e.from_email}>` : null].filter(Boolean).join(" ") || null,
    attachments, preselectedId: pick?.id ?? null,
  };
}

/** Zapíše jednu přílohu e-mailu jako fakturu dodavatele (stejná pravidla jako nahraný soubor). */
export async function recordInvoiceFromEmailAttachment(input: { emailId: unknown; attachmentId: unknown; force?: unknown }): Promise<(RecordInvoiceResult & { message: string }) | { ok: false; error: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  const access = await checkFeature("supplier_invoices_upload");
  if ("error" in access) return { ok: false, error: access.error };
  const emailId = String(input?.emailId ?? "");
  const attachmentId = String(input?.attachmentId ?? "");
  if (!isUuidLike(emailId) || !isUuidLike(attachmentId)) return { ok: false, error: NOT_FOUND };
  const found = await getVisibleEmailRow<EmailRow>(emailId, "id, subject, from_name, from_email, received_at, supplier_id");
  if (!found) return { ok: false, error: NOT_FOUND };
  const user = access.user;
  const perms = supplierInvoicePerms((await getAccess()).can);
  const actor = userActor(user);
  const db = createAdminClient({ actor }) as unknown as JobsDb;
  const { data: att } = await db.from("email_attachments").select("id, email_id, filename, mime_type, size_bytes").eq("id", attachmentId).maybeSingle();
  const a = att as { id: string; email_id: string; filename: string | null; mime_type: string | null; size_bytes: number | null } | null;
  if (!a || a.email_id !== emailId) return { ok: false, error: "Příloha nenalezena." };
  if (!usable(a)) return { ok: false, error: rejectTypeMessage(a.filename ?? "příloha") };
  const loaded = await loadEmailAttachment(a.id);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const filename = (a.filename ?? "").trim() || loaded.file.filename || "faktura.pdf";
  const res = await recordInvoiceDocument({
    file: { bytes: new Uint8Array(loaded.file.content), filename, mimeType: a.mime_type ?? loaded.file.contentType },
    source: "email", actor: { ...actor, id: user.id }, db, canOpen: perms.view && perms.amounts, force: input?.force === true,
    emailId, captureKey: `email:${a.id}`, supplierHintId: found.row.supplier_id, fakeGroup: fakeGroupFor("faktura_dodavatel", [filename]),
  });
  if (!res.ok) return res;
  if (res.kind === "recorded") {
    await logAudit({ action: "email_supplier_invoice_recorded", entity: "emails", entityId: emailId, diff: { attachmentId: a.id, ai: res.aiFilled }, actor });
  }
  return { ...res, message: recordResultMessage(res, { money: (n, c) => formatMoney(n, c), date: (d) => dateText(d) }) };
}
