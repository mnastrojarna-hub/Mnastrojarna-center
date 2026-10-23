"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { userActor, withChangeNote } from "@/lib/supabase/actor-headers";
import { checkFeature, getAccess } from "@/lib/auth/session";
import type { CurrentUser } from "@/lib/data/current-user";
import { getJob } from "@/lib/data/jobs";
import { registerJobFileCore } from "@/lib/jobs/job-files-store";
import { logAudit } from "@/lib/audit";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { isForward, isJobStage } from "@/lib/jobs/stages";
import type { JobStage } from "@/lib/supabase/database.types";
import { cleanText, isUuid, jobFilePath, translateDbError } from "@/lib/jobs/mapping";
import {
  DOCUMENT_KIND_LABEL, documentEmailHtml, draftDocumentEmail, firstEmail, isDocumentEmailKind, issuedEventMessage,
  parseEmailList, sentEventMessage, type DocumentEmailInput, type DocumentEmailKind,
} from "@/lib/jobs/document-emails";
import {
  buildConfirmationDoc, buildDeliveryNoteDoc, buildInvoiceDoc, buildQuoteDoc, confirmationNumber, dateOnly,
  pdfFileName, pickPricedItems, relevantQuote, unpricedCount,
} from "@/lib/pdf/job-docs";
import { renderConfirmationPdf, renderDeliveryNotePdf, renderInvoicePdf, renderQuotePdf } from "@/lib/pdf/render";
import { addDaysIso, computeTotals, plural, todayIso, type DocItem } from "@/lib/pdf/types";
import { spdVariableSymbol } from "@/lib/pdf/qr";
import { sendMail } from "@/lib/email/send";
import { COMPANY } from "@/lib/company";
import { refreshCompanyFromSettings } from "@/lib/company-server";
import type { ActionResult, JobDetail, JobQuote } from "@/lib/jobs/types";

/**
 * Doklady ze zakázky: PDF (nabídka, potvrzení, dodací list, faktura) se vygeneruje
 * z karty zakázky, uloží do Dokumentů zakázky (stejný název = nová verze, stará jde
 * do archivu) a jde odeslat zákazníkovi e-mailem z mé schránky.
 * Data jdou servisním klíčem → oprávnění hlídá každá akce sama.
 */

export type JobDocumentKind = "nabidka" | "potvrzeni" | "dodaci_list" | "faktura";

const KINDS: JobDocumentKind[] = ["nabidka", "potvrzeni", "dodaci_list", "faktura"];
const BUCKET = "job-files";
const NOT_FOUND = "Zakázka nenalezena.";
const FILE_NOT_FOUND = "Dokument nenalezen.";
/** Větší přílohu většina poštovních serverů odmítne. */
const MAX_ATTACHMENT = 20 * 1024 * 1024;
const MAX_RECIPIENTS = 20;

function isDocKind(v: unknown): v is JobDocumentKind {
  return typeof v === "string" && (KINDS as string[]).includes(v);
}

function fail(err: unknown): { ok: false; error: string } {
  if (typeof err === "string") return { ok: false, error: translateDbError(err) };
  return { ok: false, error: err instanceof Error ? translateDbError(err.message) : "Neočekávaná chyba." };
}

async function begin(): Promise<{ db: JobsDb; user: CurrentUser } | { error: string }> {
  if (!isSupabaseConfigured()) return { error: "Supabase není nakonfigurováno." };
  const access = await checkFeature("documents");
  if ("error" in access) return { error: access.error };
  const db = await createOperatorClient({ actor: userActor(access.user) });
  return { db, user: access.user };
}

function revalidateDocs(jobId: string) {
  for (const p of ["/orders", "/documents", "/quotes", "/confirmations", "/pricing", "/inquiries"]) revalidatePath(p);
  revalidatePath(`/orders/${jobId}`);
}

function myName(user: CurrentUser): string | undefined {
  return (user.fullName || "").trim() || (user.email || "").trim() || undefined;
}

function unpricedError(n: number, kind: JobDocumentKind): string {
  const what = kind === "faktura" ? "fakturu" : kind === "nabidka" ? "nabídku" : "potvrzení";
  return `${n} ${plural(n, "položka nemá", "položky nemají", "položek nemá")} cenu — doplň ceny v Nacenění, nebo ${what} přesto vystav.`;
}

/** Další číslo dokladu z číselné řady (DL-2026-001, FV-2026-001). */
async function nextDocNumber(db: JobsDb, prefix: string): Promise<string | null> {
  const { data, error } = await db.rpc("next_doc_number", { p_prefix: prefix } as never);
  if (error) console.error(`[job-documents] Číslo dokladu ${prefix} se nepodařilo přidělit: ${error.message}`);
  return typeof data === "string" && data ? data : null;
}

function quoteOf(job: JobDetail, quoteId?: string | null): JobQuote | undefined {
  if (quoteId) return job.quotes.find((q) => q.id === quoteId);
  return relevantQuote(job);
}

/** Faktura do evidence faktur + jednotného archivu dokladů (best-effort). */
async function recordInvoice(
  db: JobsDb,
  job: JobDetail,
  inv: { number: string; variableSymbol: string; issueDate: string; taxableDate: string; dueDate: string; currency: string; items: DocItem[]; note?: string },
  storagePath: string,
  userId: string,
): Promise<void> {
  try {
    const totals = computeTotals(inv.items);
    const main = [...totals.breakdown].sort((a, b) => b.base - a.base)[0];
    const row = {
      number: inv.number,
      order_id: job.id,
      customer_id: job.customer?.id ?? null,
      variable_symbol: inv.variableSymbol,
      issue_date: inv.issueDate,
      taxable_date: inv.taxableDate,
      due_date: inv.dueDate,
      currency: inv.currency || "CZK",
      subtotal: totals.subtotal,
      vat_rate: main?.rate ?? 0,
      vat_amount: totals.vatTotal,
      total: totals.total,
      note: inv.note ?? null,
      storage_path: storagePath,
      owner_id: job.owner?.id ?? userId,
    };
    const { data: existing } = await db.from("invoices").select("id").eq("number", inv.number).maybeSingle();
    let invoiceId = (existing as { id: string } | null)?.id ?? null;
    if (invoiceId) {
      const { error } = await db.from("invoices").update(row as never).eq("id", invoiceId);
      if (error) console.error(`[job-documents] Aktualizace faktury selhala: ${error.message}`);
      await db.from("invoice_items").delete().eq("invoice_id", invoiceId);
    } else {
      const { data, error } = await db.from("invoices").insert({ ...row, status: "vystavena" } as never).select("id").single();
      if (error) console.error(`[job-documents] Zápis faktury selhal: ${error.message}`);
      invoiceId = (data as { id: string } | null)?.id ?? null;
    }
    if (!invoiceId) return;
    if (inv.items.length) {
      const { error } = await db.from("invoice_items").insert(
        inv.items.map((it, i) => ({
          invoice_id: invoiceId,
          description: it.drawingNumber ? `${it.description} (výkres ${it.drawingNumber})` : it.description,
          quantity: it.quantity,
          unit: it.unit || "ks",
          unit_price: it.unitPrice,
          vat_rate: it.vatRate,
          position: i,
        })) as never,
      );
      if (error) console.error(`[job-documents] Položky faktury se nepodařilo uložit: ${error.message}`);
    }
    const { error: docErr } = await db.from("documents").insert({
      doc_type: "faktura",
      number: inv.number,
      title: `Faktura ${inv.number}${job.title ? ` — ${job.title}` : ""}`.slice(0, 300),
      customer_id: job.customer?.id ?? null,
      order_id: job.id,
      invoice_id: invoiceId,
      storage_path: storagePath,
      total: totals.total,
      created_by: userId,
    } as never);
    if (docErr) console.error(`[job-documents] Zápis do archivu dokladů selhal: ${docErr.message}`);
  } catch (err) {
    console.error(`[job-documents] Evidence faktury selhala: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Stav zakázky dopředu jedním zápisem; událost s autorem zapíše DB (poznámka v hlavičce). */
async function advanceStage(db: JobsDb, jobId: string, from: JobStage, to: JobStage, note: string): Promise<void> {
  if (!isForward(from, to)) return;
  const q = db.from("orders").update({ status: to } as never).eq("id", jobId).eq("status", from);
  const { error } = await withChangeNote(q, note);
  if (error) console.error(`[job-documents] Posun do „${to}" selhal: ${error.message}`);
}

/** Fakta dokladů zakázky (revize objednávky, dodání) pro vystavení a odeslání. */
async function docFacts(db: JobsDb, jobId: string) {
  const { data } = await db.from("orders")
    .select("status, order_status, order_revision, items_count, items_delivered, items_partial, partial_delivery_at")
    .eq("id", jobId).maybeSingle();
  const r = (data ?? {}) as {
    status?: string; order_status?: string | null; order_revision?: number | null; items_count?: number | null;
    items_delivered?: number | null; items_partial?: number | null; partial_delivery_at?: string | null;
  };
  const count = Number(r.items_count) || 0;
  const delivered = Number(r.items_delivered) || 0;
  const partial = (count > 0 && (delivered > 0 || (Number(r.items_partial) || 0) > 0) && delivered < count)
    || (count === 0 && Boolean(r.partial_delivery_at));
  return {
    stage: isJobStage(r.status) ? r.status : null,
    orderStatus: r.order_status ?? null,
    orderRevision: Math.max(1, Number(r.order_revision) || 1),
    /** Dodáno jen částečně — faktura stav neposouvá (M5). */
    partialDelivery: partial,
  };
}

/** Otisk obsahu dokladu (data PDF, ne PDF samotné — to nese čas vytvoření). */
function docFingerprint(kind: JobDocumentKind, data: unknown, extra: Record<string, unknown>): string {
  return `g:${createHash("sha256").update(JSON.stringify({ kind, data, ...extra })).digest("hex")}`;
}

/**
 * Vygeneruje PDF doklad ze zakázky, uloží ho do Dokumentů zakázky (verzuje)
 * a vrátí id souboru. Nabídka vyžaduje quoteId (jinak poslední aktuální nabídka).
 * Nabídka, potvrzení a faktura s položkami bez ceny vrátí chybu s `unpriced` — UI nabídne
 * „Přesto vystavit" (opts.force). S opts.reuse (dialogy „Odeslat…") vrátí beze změny obsahu
 * (otisk) poslední vystavený soubor — otevření dialogu nezakládá nové verze ani historii;
 * výslovné „Vystavit" dál zakládá novou verzi.
 */
export async function generateJobDocument(
  jobId: string,
  kind: JobDocumentKind,
  opts?: { quoteId?: string; note?: string; force?: boolean; reuse?: boolean },
): Promise<ActionResult<{ fileId: string; number: string; filename: string; version: number; unpriced: number }>> {
  if (!isDocKind(kind)) return fail("Neznámý druh dokladu.");
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  if (opts?.quoteId !== undefined && opts.quoteId !== "" && !isUuid(opts.quoteId)) return fail("Nabídka nenalezena.");
  const c = await begin();
  if ("error" in c) return fail(c.error);
  const { db, user } = c;
  const note = cleanText(opts?.note, 2000) ?? undefined;
  const force = opts?.force === true;
  const preparedBy = myName(user);

  try {
    const job = await getJob(jobId);
    if (!job) return fail(NOT_FOUND);

    let number: string;
    let render: () => Promise<Buffer>;
    let fpData: unknown;
    let quote: JobQuote | undefined;
    let invoice: Parameters<typeof recordInvoice>[2] | null = null;

    if (kind === "nabidka") {
      quote = quoteOf(job, opts?.quoteId || null);
      if (!quote) {
        return fail(opts?.quoteId ? "Nabídka k této zakázce nepatří." : "Zakázka zatím nemá nabídku — vytvoř ji v záložce Nabídky.");
      }
      const data = await buildQuoteDoc(job, quote, { preparedBy });
      if (note) data.note = note;
      const missing = unpricedCount(data.items);
      if (missing && !force) return { ok: false, error: unpricedError(missing, kind), unpriced: missing };
      number = data.number;
      fpData = data;
      render = () => renderQuotePdf(data);
    } else if (kind === "potvrzeni") {
      const data = await buildConfirmationDoc(job, { preparedBy, note });
      const missing = unpricedCount(data.items);
      if (missing && !force) return { ok: false, error: unpricedError(missing, kind), unpriced: missing };
      number = data.number;
      fpData = data;
      render = () => renderConfirmationPdf(data);
    } else if (kind === "dodaci_list") {
      const existing = (job.deliveryNoteNumber ?? "").trim();
      const allocated = existing || (await nextDocNumber(db, "DL"));
      if (!allocated) return fail("Nepodařilo se přidělit číslo dodacího listu.");
      if (!existing) {
        const { error } = await db.from("orders").update({ delivery_note_number: allocated } as never).eq("id", jobId);
        if (error) return fail(error.message);
        job.deliveryNoteNumber = allocated;
      }
      number = allocated;
      const data = await buildDeliveryNoteDoc(job, { number, preparedBy, note });
      fpData = data;
      render = () => renderDeliveryNotePdf(data);
    } else {
      // ceny zkontrolovat dřív, než se spotřebuje číslo z řady
      const missing = unpricedCount(pickPricedItems(job));
      if (missing && !force) return { ok: false, error: unpricedError(missing, kind), unpriced: missing };
      const existing = (job.invoiceNumber ?? "").trim();
      const allocated = existing || (await nextDocNumber(db, "FV"));
      if (!allocated) return fail("Nepodařilo se přidělit číslo faktury.");
      if (!existing) {
        const { error } = await db.from("orders").update({ invoice_number: allocated } as never).eq("id", jobId);
        if (error) return fail(error.message);
        job.invoiceNumber = allocated;
      }
      number = allocated;
      const data = await buildInvoiceDoc(job, { number, preparedBy, note });
      invoice = {
        number, variableSymbol: data.variableSymbol, issueDate: data.issueDate, taxableDate: data.taxableDate,
        dueDate: data.dueDate, currency: data.currency, items: data.items, note,
      };
      fpData = data;
      render = () => renderInvoicePdf(data);
    }

    const filename = pdfFileName(kind, number);
    const facts = await docFacts(db, jobId);
    const orderRevision = kind === "potvrzeni" ? facts.orderRevision : null;
    const fingerprint = docFingerprint(kind, fpData, { orderRevision, quoteId: quote?.id ?? null, filename });
    // stejný obsah jako poslední vystavený doklad → žádná nová verze ani událost
    if (opts?.reuse === true) {
      const { data: same } = await db.from("job_files")
        .select("id, filename, version")
        .eq("job_id", jobId).eq("kind", kind).eq("archived", false).eq("content_sha256", fingerprint)
        .order("version", { ascending: false }).limit(1);
      const reuse = ((same ?? []) as { id: string; filename: string; version: number | null }[])[0];
      if (reuse) {
        return { ok: true, fileId: reuse.id, number, filename: reuse.filename, version: reuse.version ?? 1, unpriced: 0 };
      }
    }
    const pdf = await render();

    // PDF do úložiště zakázky
    const path = jobFilePath(jobId, crypto.randomUUID(), filename);
    const { error: upErr } = await db.storage
      .from(BUCKET)
      .upload(path, pdf, { contentType: "application/pdf", upsert: false });
    if (upErr) return fail(`PDF se nepodařilo uložit: ${upErr.message}`);

    // náš doklad: origin generated + vystavitel my (potvrzení → „vystaveno“ k revizi objednávky); jedna událost níže
    const reg = await registerJobFileCore(db, user.id, {
      jobId,
      path,
      filename,
      mimeType: "application/pdf",
      size: pdf.length,
      kind,
      title: `${DOCUMENT_KIND_LABEL[kind]} ${number}`,
      quoteId: quote?.id,
      note,
      silent: true,
      origin: "generated",
      issuer: "my",
      orderRevision,
      contentSha256: fingerprint,
    });
    if (!reg.ok || !reg.file) {
      try {
        await db.storage.from(BUCKET).remove([path]);
      } catch {
        // úklid je best-effort
      }
      return fail(reg.error ?? "Dokument se nepodařilo uložit k zakázce.");
    }
    const file = reg.file;

    if (quote) {
      const { error } = await db.from("quotes").update({ storage_path: path } as never).eq("id", quote.id);
      if (error) console.error(`[job-documents] Uložení PDF k nabídce selhalo: ${error.message}`);
    }
    if (invoice) await recordInvoice(db, job, invoice, path, user.id);

    const partialInvoice = kind === "faktura" && facts.partialDelivery;
    // historie jen přibývá: vlastní událost „Vystaveno …“ (registrace výše je tichá)
    await logJobEvent(db, {
      jobId, type: "file", entity: "file", entityId: file.id, actorId: user.id,
      message: issuedEventMessage(kind, number, file.version, { orderRevision, partial: partialInvoice }),
      data: {
        fileId: file.id, kind, filename, version: file.version, number, action: "issued",
        ...(orderRevision ? { orderRevision } : {}), ...(partialInvoice ? { partialDelivery: true } : {}),
      },
    });

    // faktura posune zakázku, jen když je dodáno vše (při dílčí dodávce stav zůstává — M5)
    const stageNow = facts.stage ?? job.stage;
    if (kind === "faktura" && !partialInvoice && isForward(stageNow, "fakturovano")) {
      await advanceStage(db, jobId, stageNow, "fakturovano", `vystavena faktura ${number}`);
    }

    await logAudit({
      action: "document_issued", entity: "job_files", entityId: file.id,
      diff: { jobId, kind, number, version: file.version, forced: force || undefined },
    });
    revalidateDocs(jobId);
    return { ok: true, fileId: file.id, number, filename, version: file.version, unpriced: 0 };
  } catch (err) {
    return fail(err);
  }
}

interface FileForMail {
  id: string;
  job_id: string;
  kind: string;
  filename: string;
  mime_type: string | null;
  storage_path: string | null;
  quote_id: string | null;
  size_bytes: number | string | null;
}

/** Číslo dokladu k souboru (pro historii a e-mail). */
async function docNumberForFile(
  db: JobsDb,
  kind: DocumentEmailKind,
  file: { quote_id: string | null },
  job: { number: string | null; invoice_number: string | null; delivery_note_number: string | null },
): Promise<string | null> {
  if (kind === "nabidka" && file.quote_id) {
    const { data } = await db.from("quotes").select("number").eq("id", file.quote_id).maybeSingle();
    return (data as { number: string | null } | null)?.number ?? null;
  }
  if (kind === "potvrzeni") return job.number ? confirmationNumber(job.number) : null;
  if (kind === "dodaci_list") return job.delivery_note_number ?? null;
  if (kind === "faktura") return job.invoice_number ?? null;
  return null;
}

/** Odešle uložený doklad zákazníkovi e-mailem (s PDF v příloze) z mé schránky. */
export async function sendJobDocument(
  jobId: string,
  fileId: string,
  mail: { to: string; cc?: string; subject: string; body: string },
): Promise<ActionResult<{ sent: boolean; emailId: string }>> {
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  if (!isUuid(fileId)) return fail(FILE_NOT_FOUND);
  if (!mail || typeof mail !== "object") return fail("Chybí údaje e-mailu.");
  const to = parseEmailList(mail.to);
  const cc = parseEmailList(mail.cc);
  if (to.invalid.length || cc.invalid.length) return fail(`Neplatná e-mailová adresa: ${[...to.invalid, ...cc.invalid][0]}`);
  if (!to.valid.length) return fail("Vyplň, komu e-mail půjde.");
  if (to.valid.length + cc.valid.length > MAX_RECIPIENTS) return fail(`Najednou lze poslat nejvýš ${MAX_RECIPIENTS} adresátům.`);
  const subject = cleanText(String(mail.subject ?? "").replace(/[\r\n]+/g, " "), 300);
  if (!subject) return fail("Doplň předmět e-mailu.");
  const body = String(mail.body ?? "").replace(/\r\n/g, "\n").slice(0, 20_000);

  const c = await begin();
  if ("error" in c) return fail(c.error);
  const { db, user } = c;

  try {
    const { data: fileData, error: fileErr } = await db
      .from("job_files")
      .select("id, job_id, kind, filename, mime_type, storage_path, quote_id, size_bytes")
      .eq("id", fileId)
      .maybeSingle();
    if (fileErr) return fail(fileErr.message);
    const file = fileData as FileForMail | null;
    if (!file || file.job_id !== jobId.toLowerCase() || !file.storage_path) return fail(FILE_NOT_FOUND);

    const { data: jobData, error: jobErr } = await db
      .from("orders")
      .select("id, number, status, order_status, invoice_number, delivery_note_number")
      .eq("id", jobId)
      .maybeSingle();
    if (jobErr) return fail(jobErr.message);
    const job = jobData as {
      id: string; number: string | null; status: string; order_status: string | null; invoice_number: string | null; delivery_note_number: string | null;
    } | null;
    if (!job) return fail(NOT_FOUND);

    // nabídku posílá zákazníkovi jen člověk s právem na marže (přechod → odeslaná, transitionFeature)
    if (file.kind === "nabidka" && !(await getAccess()).can("margins")) {
      return fail("Nabídku zákazníkovi odesílá obchodník nebo admin — předej ji ke schválení.");
    }
    // nabídku, která čeká na schválení (AI, žádost, limit), nejde odeslat — kontrola dřív, než e-mail odejde
    if (file.kind === "nabidka" && file.quote_id) {
      const { data: qd } = await db.from("quotes").select("status, approval_required, approved_by").eq("id", file.quote_id).maybeSingle();
      const q = qd as { status: string; approval_required: boolean | null; approved_by: string | null } | null;
      if (q && q.approval_required && !q.approved_by && q.status !== "odeslano" && q.status !== "prijato" && q.status !== "zamitnuto") {
        return fail("Nabídka čeká na schválení — odeslat ji lze až po schválení.");
      }
    }

    if (Number(file.size_bytes ?? 0) > MAX_ATTACHMENT) return fail("Soubor je pro přílohu e-mailu příliš velký (max. 20 MB).");
    const { data: blob, error: dlErr } = await db.storage.from(BUCKET).download(file.storage_path);
    if (dlErr || !blob) return fail(`Soubor se nepodařilo načíst z úložiště${dlErr?.message ? `: ${dlErr.message}` : "."}`);
    const content = Buffer.from(await (blob as Blob).arrayBuffer());
    if (content.length > MAX_ATTACHMENT) return fail("Soubor je pro přílohu e-mailu příliš velký (max. 20 MB).");

    await refreshCompanyFromSettings();
    const html = documentEmailHtml(body, {
      companyName: COMPANY.name, slogan: COMPANY.slogan, web: COMPANY.web, accent: COMPANY.colors.red,
    });
    const res = await sendMail({
      to: to.valid.join(", "),
      cc: cc.valid.length ? cc.valid.join(", ") : undefined,
      subject,
      text: body,
      html,
      attachments: [{ filename: file.filename, content, contentType: file.mime_type || "application/pdf" }],
      from: { ownerId: user.id },
      jobId,
      senderId: user.id,
    });
    if (!res.sent) return fail(res.reason ?? "E-mail se nepodařilo odeslat.");

    // ── co odeslání znamená pro zakázku ──
    const kind: DocumentEmailKind = isDocumentEmailKind(file.kind) ? file.kind : "ostatni";
    if (kind === "nabidka" && file.quote_id) {
      // odeslání nabídky = fakt e-mailu (jediná událost níže, 3.4 „bez duplicit"); stav nabídky
      // se zapíše tady, posun zakázky na „Nabídka odeslaná" a sent_via dorovná DB. Přijatá ani
      // zamítnutá nabídka se opětovným posláním PDF nevrací na „Odeslaná".
      const { error } = await db
        .from("quotes")
        .update({ status: "odeslano", sent_at: new Date().toISOString(), sent_via: "email" } as never)
        .eq("id", file.quote_id)
        .in("status", ["navrh_ai", "ke_schvaleni", "odeslano"]);
      if (error) console.error(`[job-documents] Označení nabídky jako odeslané selhalo: ${error.message}`);
    }
    // potvrzení: objednávku potvrdí DB z události e-mailu níže (podle revize odeslaného souboru);
    // zakázka bez dokladu objednávky (starší data) se posune sama zde
    if (kind === "potvrzeni" && !job.order_status && isJobStage(job.status) && isForward(job.status, "potvrzeno")) {
      await advanceStage(db, jobId, job.status, "potvrzeno", "potvrzení objednávky odesláno e-mailem");
    }
    if (kind === "faktura" && job.invoice_number) {
      const { error } = await db
        .from("invoices")
        .update({ status: "odeslana" } as never)
        .eq("number", job.invoice_number)
        .eq("status", "vystavena");
      if (error) console.error(`[job-documents] Stav faktury se nepodařilo změnit: ${error.message}`);
    }

    const number = await docNumberForFile(db, kind, file, job);
    const toText = to.valid.join(", ");
    await logJobEvent(db, {
      jobId,
      type: "email",
      message: sentEventMessage(kind, number ?? (kind === "ostatni" ? file.filename : null), toText),
      data: {
        fileId, kind, number, to: to.valid, cc: cc.valid, subject,
        ...(res.emailId ? { emailId: res.emailId } : {}),
      },
      actorId: user.id,
    });
    await logAudit({
      action: "document_sent", entity: "job_files", entityId: fileId,
      diff: { jobId, kind, number, to: to.valid, cc: cc.valid, subject },
    });
    revalidateDocs(jobId);
    revalidatePath("/sent");
    return { ok: true, sent: true, emailId: res.emailId };
  } catch (err) {
    return fail(err);
  }
}

/** Výchozí předmět a text e-mailu k dokladu (zákazník, čísla, termín). */
export async function draftJobDocumentEmail(
  jobId: string,
  fileId: string,
): Promise<ActionResult<{ to: string; subject: string; body: string; filename: string; kind: DocumentEmailKind }>> {
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  if (!isUuid(fileId)) return fail(FILE_NOT_FOUND);
  const c = await begin();
  if ("error" in c) return fail(c.error);
  const { db, user } = c;

  try {
    const job = await getJob(jobId);
    if (!job) return fail(NOT_FOUND);
    const file = job.files.find((f) => f.id === fileId.toLowerCase());
    if (!file) return fail(FILE_NOT_FOUND);
    const kind: DocumentEmailKind = isDocumentEmailKind(file.kind) ? file.kind : "ostatni";

    await refreshCompanyFromSettings();
    const { data: me } = await db.from("profiles").select("phone, position, email").eq("id", user.id).maybeSingle();
    const profile = (me ?? {}) as { phone?: string | null; position?: string | null; email?: string | null };

    const input: DocumentEmailInput = {
      kind,
      jobNumber: job.number,
      jobTitle: job.title,
      customerOrderNumber: job.customerOrderNumber,
      customerOrderDate: dateOnly(job.orderDate) ?? null,
      customerInquiryNumber: job.customerInquiryNumber,
      currency: job.currency,
      filename: file.filename,
      sender: { name: myName(user), position: profile.position, phone: profile.phone, email: profile.email ?? user.email },
      company: { name: COMPANY.name, web: COMPANY.web, phone: COMPANY.phone, email: COMPANY.email },
    };

    if (kind === "nabidka") {
      const quote = quoteOf(job, file.quoteId);
      input.number = quote?.number ?? null;
      input.validUntil = dateOnly(quote?.validUntil) ?? null;
      input.leadTimeDays = quote?.leadTimeDays ?? null;
      input.jobTitle = quote?.title || job.title;
    } else if (kind === "potvrzeni") {
      input.number = confirmationNumber(job.number);
      input.deliveryDate = dateOnly(job.dueDate ?? job.customerRequiredDate) ?? null;
      input.quoteNumber = relevantQuote(job)?.number ?? null;
    } else if (kind === "dodaci_list") {
      input.number = job.deliveryNoteNumber;
      input.deliveryDate = dateOnly(job.dueDate) ?? null;
    } else if (kind === "faktura") {
      input.number = job.invoiceNumber;
      type InvoiceRow = { due_date: string | null; total: number | string | null; variable_symbol: string | null; currency: string | null };
      let invoice: InvoiceRow | null = null;
      if (job.invoiceNumber) {
        const { data } = await db
          .from("invoices")
          .select("due_date, total, variable_symbol, currency")
          .eq("number", job.invoiceNumber)
          .maybeSingle();
        invoice = (data as InvoiceRow | null) ?? null;
      }
      const issued = dateOnly(file.createdAt) ?? todayIso();
      input.dueDate = invoice?.due_date ?? addDaysIso(issued, Math.max(0, job.customerDetail?.paymentTermsDays ?? 14));
      const total = invoice?.total !== null && invoice?.total !== undefined ? Number(invoice.total) : computeTotals(pickPricedItems(job)).total;
      input.amount = Number.isFinite(total) ? total : null;
      input.currency = invoice?.currency || job.currency;
      input.variableSymbol = invoice?.variable_symbol || spdVariableSymbol(job.invoiceNumber ?? undefined) || null;
    }

    let to = firstEmail(job.customerContactEmail, job.customerDetail?.email);
    if (!to && job.customer?.id) {
      const { data: contacts } = await db
        .from("customer_contacts")
        .select("email, is_primary")
        .eq("customer_id", job.customer.id)
        .order("is_primary", { ascending: false })
        .limit(10);
      to = firstEmail(...((contacts ?? []) as { email: string | null }[]).map((r) => r.email));
    }

    const draft = draftDocumentEmail(input);
    return { ok: true, to: to ?? "", subject: draft.subject, body: draft.body, filename: file.filename, kind };
  } catch (err) {
    return fail(err);
  }
}
