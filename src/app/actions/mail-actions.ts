"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { checkFeature, getAccess } from "@/lib/auth/session";
import { userActor } from "@/lib/supabase/actor-headers";
import { logAudit } from "@/lib/audit";
import { getVisibleEmailRow } from "@/lib/data/mail";
import { isUuidLike } from "@/lib/email/visibility";
import { hasStrongSignal } from "@/lib/email/job-match";
import { matchDecisionForEmail, processEmailForJobs, supplierInvoicesFromMail, unlinkThread, type MailJobActor } from "@/lib/email/job-link-store";
import { createJobFromEmail } from "@/app/actions/mail";
import { setThreadJobAction } from "@/app/actions/mail-jobs";

/**
 * Pošta E — hlavní akce zprávy podle kategorie (src/lib/email/mail-actions.ts): „Zpracovat objednávku"
 * (spárovat se zakázkou stejnými pravidly jako automatika, jinak založit), „Zapsat fakturu dodavatele"
 * (přílohy do Faktur dodavatelů — nikdy zakázka) a „Oddělit z vlákna" (zpráva, která do vlákna nepatří).
 * „Vytvořit nabídku" = createJobFromEmail (zakázka ve stavu poptávka) + editor nabídky na kartě zakázky.
 */

type Fail = { ok: false; error: string };
const NOT_FOUND = "E-mail nenalezen (nebo k němu nemáš přístup).";

async function actor(user: { id: string }): Promise<MailJobActor> {
  const ctx = userActor(user);
  return { db: (await createOperatorClient({ actor: ctx })) as unknown as SupabaseClient, actorId: user.id, kind: "user", ctx };
}

export interface OrderChoice { jobId: string; number: string; title: string; reason: string | null }

export type ProcessOrderResult =
  | { ok: true; mode: "existing" | "linked" | "created"; jobId: string; number?: string; reason?: string | null }
  | { ok: true; mode: "choose"; choices: OrderChoice[] }
  | Fail;

/**
 * „Zpracovat objednávku": už přiřazená → její zakázka; jistá shoda (naše číslo nabídky / zakázky,
 * objednávka zákazníka, vlákno) → přiřadit vlákno; jen slabší shoda (firma) → nabídnout výběr; nic →
 * založit zakázku (stav Objednávka). Nikdy podle samotného předmětu.
 */
export async function processOrderFromEmailAction(emailId: string): Promise<ProcessOrderResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  const access = await checkFeature("orders");
  if ("error" in access) return { ok: false, error: access.error };
  if (!isUuidLike(emailId)) return { ok: false, error: NOT_FOUND };
  const found = await getVisibleEmailRow<{ id: string; order_id: string | null; thread_id: string | null }>(emailId, "id, order_id, thread_id");
  if (!found) return { ok: false, error: NOT_FOUND };
  const a = await actor(access.user);
  if (found.row.order_id) {
    const { data } = await a.db.from("orders").select("number").eq("id", found.row.order_id).maybeSingle();
    return { ok: true, mode: "existing", jobId: found.row.order_id, number: (data as { number: string } | null)?.number };
  }
  const m = await matchDecisionForEmail(a.db, emailId);
  const d = m?.decision;
  if (d && found.row.thread_id && (d.kind === "link" || d.kind === "suggest") && d.candidate.open && hasStrongSignal(d.candidate)) {
    const r = await setThreadJobAction(found.row.thread_id, d.candidate.jobId);
    if (!r.ok) return { ok: false, error: r.error ?? "Objednávku se nepodařilo přiřadit." };
    await logAudit({ action: "email_order_processed", entity: "emails", entityId: emailId, diff: { mode: "linked", jobId: d.candidate.jobId, reasons: d.candidate.reasons } });
    return { ok: true, mode: "linked", jobId: r.jobId ?? d.candidate.jobId, number: r.jobNumber ?? d.candidate.number, reason: d.candidate.reasons[0] ?? null };
  }
  const weak = d && d.kind !== "none" ? d.candidates.filter((c) => c.open && c.score >= 0.3).slice(0, 3) : [];
  if (weak.length) {
    return { ok: true, mode: "choose", choices: weak.map((c) => ({ jobId: c.jobId, number: c.number, title: c.title, reason: c.reasons[0] ?? null })) };
  }
  const c = await createJobFromEmail(emailId);
  if (!c.ok || !c.id) return { ok: false, error: c.error ?? "Zakázku se nepodařilo založit." };
  await logAudit({ action: "email_order_processed", entity: "emails", entityId: emailId, diff: { mode: c.existed ? "existing" : "created", jobId: c.id } });
  return { ok: true, mode: c.existed ? "existing" : "created", jobId: c.id, number: c.number };
}

export type InvoiceFromEmailResult =
  | { ok: true; created: number; existing: number; noFiles?: boolean; canView: boolean }
  | Fail;

/** „Zapsat fakturu dodavatele": PDF / obrázky z e-mailu do Faktur dodavatelů (idempotentně; bez příloh → ruční nahrání). */
export async function recordSupplierInvoiceFromEmailAction(emailId: string): Promise<InvoiceFromEmailResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  const access = await checkFeature("supplier_invoices_upload");
  if ("error" in access) return { ok: false, error: access.error };
  if (!isUuidLike(emailId)) return { ok: false, error: NOT_FOUND };
  type Row = { id: string; supplier_id: string | null; order_id: string | null; from_name: string | null; from_email: string | null; thread_id: string | null };
  const found = await getVisibleEmailRow<Row>(emailId, "id, supplier_id, order_id, from_name, from_email, thread_id");
  if (!found) return { ok: false, error: NOT_FOUND };
  const { can } = await getAccess();
  const canView = can("supplier_invoices");
  const a = await actor(access.user);
  const { count } = await a.db.from("email_attachments").select("id", { count: "exact", head: true }).eq("email_id", emailId);
  if (!count) return { ok: true, created: 0, existing: 0, noFiles: true, canView };
  const r = await supplierInvoicesFromMail(a, found.row);
  if (!r.created && !r.existing) {
    return { ok: false, error: "V příloze e-mailu není faktura (PDF nebo obrázek), nebo se ji nepodařilo uložit — nahraj ji ručně přes Nahrát fakturu." };
  }
  await logAudit({ action: "email_supplier_invoice_recorded", entity: "emails", entityId: emailId, diff: r });
  revalidatePath("/supplier-invoices");
  return { ok: true, ...r, canView };
}

/**
 * „Oddělit z vlákna": zpráva, která do vlákna nepatří (jen podobný předmět), dostane vlastní vlákno.
 * Přiřazení k zakázce zděděné jen z vlákna (ne ruční) se u ní zruší a zpráva se posoudí znovu (návrh);
 * ruční přiřazení zůstává.
 */
export async function splitFromThreadAction(emailId: string): Promise<{ ok: true; threadId: string; unlinked: boolean } | Fail> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  const access = await checkFeature("mail");
  if ("error" in access) return { ok: false, error: access.error };
  if (!isUuidLike(emailId)) return { ok: false, error: NOT_FOUND };
  type Row = { id: string; thread_id: string | null; mailbox_id: string | null; message_id: string | null; order_id: string | null; job_link_source: string | null; job_link_actor: string | null; subject: string | null };
  const found = await getVisibleEmailRow<Row>(emailId, "id, thread_id, mailbox_id, message_id, order_id, job_link_source, job_link_actor, subject");
  if (!found?.row.thread_id) return { ok: false, error: NOT_FOUND };
  const e = found.row;
  const a = await actor(access.user);
  const { count } = await a.db.from("emails").select("id", { count: "exact", head: true }).eq("thread_id", e.thread_id).neq("id", e.id);
  if (!count) return { ok: false, error: "Zpráva je ve vlákně sama." };
  const tid = `m:${e.mailbox_id ?? "-"}:${(e.message_id ?? "").trim() || e.id}:o${Date.now().toString(36)}`;
  const { error } = await a.db.from("emails").update({ thread_id: tid }).eq("id", e.id);
  if (error) return { ok: false, error: error.message };
  await a.db.from("email_job_suggestions").update({ thread_id: tid }).eq("email_id", e.id).eq("status", "pending");
  // předání kolegovi platí i pro oddělenou zprávu
  const { data: shares } = await a.db.from("email_shares").select("shared_by, shared_with, note, mailbox_id, created_at, read_at").eq("thread_id", e.thread_id);
  if ((shares ?? []).length) {
    await a.db.from("email_shares").insert(((shares ?? []) as Record<string, unknown>[]).map((s) => ({ ...s, email_id: e.id, thread_id: tid })));
  }
  let unlinked = false;
  if (e.order_id && e.job_link_actor !== "user" && ["thread", "thread_subject"].includes(e.job_link_source ?? "")) {
    const r = await unlinkThread(a, tid, e.order_id, e.subject ?? "");
    unlinked = r.ok && r.unlinked > 0;
    if (unlinked) {
      await a.db.from("emails").update({ job_match_at: null }).eq("id", e.id);
      await processEmailForJobs(a, e.id, { backfill: true }).catch(() => undefined);
    }
  }
  await logAudit({ action: "email_thread_split", entity: "emails", entityId: e.id, diff: { from: e.thread_id, to: tid, unlinked } });
  revalidatePath("/inbox");
  return { ok: true, threadId: tid, unlinked };
}
