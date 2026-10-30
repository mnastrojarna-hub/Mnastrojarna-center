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
  DOCUMENT_KIND_LABEL, INVOICE_NUMBER_PLACEHOLDER, INVOICE_VS_PLACEHOLDER, documentEmailHtml, draftDocumentEmail,
  fillInvoicePlaceholders, firstEmail, isDocumentEmailKind, issuedEventMessage, parseEmailList, sentEventMessage,
  type DocumentEmailInput, type DocumentEmailKind,
} from "@/lib/jobs/document-emails";
import {
  buildConfirmationDoc, buildInvoiceDoc, buildQuoteDoc, confirmationNumber, dateOnly,
  jobPaymentRows, pdfFileName, pickPricedItems, relevantQuote, unpricedCount,
} from "@/lib/pdf/job-docs";
import { invoiceBalance, invoicePaymentsFromRows } from "@/lib/pdf/invoice-payments";
import { renderConfirmationPdf, renderInvoicePdf, renderQuotePdf } from "@/lib/pdf/render";
import { addDaysIso, computeTotals, plural, todayIso, type DocItem } from "@/lib/pdf/types";
import { invoiceBankWarning, spdVariableSymbol } from "@/lib/pdf/qr";
import { sendMail } from "@/lib/email/send";
import { COMPANY } from "@/lib/company";
import { refreshCompanyFromSettings } from "@/lib/company-server";
import type { ActionResult, JobDetail, JobQuote } from "@/lib/jobs/types";
import {
  FLOW_QUOTE_COLUMNS, invoiceDeliveryOf, quoteApprovalBlock, quoteFactsFromRow, quoteSendBlock, quoteWasSent,
} from "@/lib/jobs/flow-status";
import { FV_SERIES, invoiceDeliveryError, isOwnInvoiceFile } from "@/lib/jobs/invoice-file";
import { quoteSnapshotSha } from "@/lib/jobs/quote-approval-store";
import { assertJobFileAccess, FILE_PRICE_SEND } from "@/lib/jobs/job-file-access";
import { deliveredRows, deliveryNoteNumberOf, undocumentedRows } from "@/lib/jobs/delivery-notes";
import { fileOfNote, issueDeliveryNote, issuedDeliveryNotes, reissueFromSnapshot } from "@/lib/jobs/delivery-notes-store";
import { documentedQuantities } from "@/lib/jobs/delivery-notes-db";

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

/** Fakturu (PDF, odeslání, návrh e-mailu) vystavuje jen role s právem na marže — i přes /documents a Doklady. */
const INVOICE_NO_RIGHT = "Fakturu vystavuje a posílá obchodník nebo super admin.";
/** Dodací list vzniká jen se zápisem dodání (jedno číslo = jedna dodávka). */
const DELIVERY_NOTE_NEEDS_DELIVERY = "Dodací list vzniká se zápisem dodání — v kartě zakázky „Zapsat dodání a dodací list“.";

async function canInvoice(): Promise<boolean> {
  const { can } = await getAccess();
  return can("margins");
}

function revalidateDocs(jobId: string) {
  for (const p of ["/orders", "/documents", "/quotes", "/confirmations", "/pricing", "/inquiries"]) revalidatePath(p);
  revalidatePath(`/orders/${jobId}`);
}

function myName(user: CurrentUser): string | undefined {
  return (user.fullName || "").trim() || (user.email || "").trim() || undefined;
}

function unpricedError(n: number, kind: JobDocumentKind): string {
  const missing = `${n} ${plural(n, "položka nemá", "položky nemají", "položek nemá")} cenu`;
  if (kind === "nabidka") return `${missing} — doplň ceny v nabídce (karta zakázky → Nabídky), nebo nabídku přesto vystav.`;
  return `${missing} — doplň ceny v kartě zakázky (záložka Položky), nebo ${kind === "faktura" ? "fakturu" : "potvrzení"} přesto vystav.`;
}

// ── Schvalování nabídek super adminem (#25) ─────────────────
const ISSUE_PENDING_STAFF = "Nabídka čeká na schválení super admina — PDF k odeslání vystavíš až po schválení. Náhled s vodoznakem otevřeš tlačítkem ‚PDF náhled‘.";
const ISSUE_PENDING_ADMIN = "Nabídka zatím není schválená — nejdřív ji schval, pak vystav PDF.";
const ISSUE_NOTE_REFUSED = "Poznámku k nabídce dopiš v úpravě nabídky — změnu pak schválí super admin.";
const SNAPSHOT_RESET = "Od schválení se změnily údaje zakázky, které jsou v nabídce (zákazník, termín nebo položky) — schválení se zrušilo a nabídku musí super admin schválit znovu.";
const SEND_STALE_PDF = "Toto PDF vzniklo před posledním schválením — vystav nové PDF nabídky a odešli ho.";
const SEND_UPLOADED_QUOTE = "Nabídku posílej z vystaveného PDF (záložka Nabídky) — nahraný soubor nabídky odešle jen super admin.";

/** Nabídka vyžaduje schválení (ne-admin autor nebo AI v režimu se schválením). */
function needsApproval(q: Pick<JobQuote, "adminApprovalRequired" | "approvalRequired">): boolean {
  return Boolean(q.adminApprovalRequired || q.approvalRequired);
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
    // jedna faktura = jeden řádek archivu dokladů (nové PDF téže faktury jen přepíše cestu)
    const { data: archived } = await db.from("documents").select("id").eq("invoice_id", invoiceId).eq("doc_type", "faktura").limit(1);
    const archivedId = ((archived ?? []) as { id: string }[])[0]?.id ?? null;
    const { error: docErr } = archivedId
      ? await db.from("documents").update({ storage_path: storagePath, total: totals.total } as never).eq("id", archivedId)
      : await db.from("documents").insert({
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
  const stage = isJobStage(r.status) ? r.status : null;
  return {
    stage,
    orderStatus: r.order_status ?? null,
    orderRevision: Math.max(1, Number(r.order_revision) || 1),
    /** Dodáno jen částečně — faktura stav neposouvá (M5). */
    partialDelivery: partial,
    /** Dodání pro fakturu: faktura z aplikace jen po dodání všeho (stejné pravidlo jako karta). */
    invoiceDelivery: invoiceDeliveryOf({
      stage: stage ?? "poptavka", itemsCount: count, itemsDelivered: delivered,
      itemsPartial: Number(r.items_partial) || 0, partialDeliveryAt: r.partial_delivery_at ?? null,
    }),
  };
}

/** Otisk obsahu dokladu (data PDF, ne PDF samotné — to nese čas vytvoření). */
function docFingerprint(kind: JobDocumentKind, data: unknown, extra: Record<string, unknown>): string {
  return `g:${createHash("sha256").update(JSON.stringify({ kind, data, ...extra })).digest("hex")}`;
}

// ── Faktura zakázky: jedna faktura, jedno číslo (A2) ─────────
type InvoiceRow = {
  id: string; order_id: string | null; storage_path: string | null;
  issue_date: string | null; taxable_date: string | null; due_date: string | null;
};
type InvoiceFileRef = { fileId: string; filename: string; version: number };

/** Co s fakturou zakázky: poslat vystavenou / vystavit (nové nebo rezervované číslo) / nejde. */
type InvoicePlan =
  | { kind: "existing"; number: string; file: InvoiceFileRef }
  | { kind: "blocked"; error: string; code: "invoiced" }
  | { kind: "issue"; reserved: string | null; row: InvoiceRow | null };

/** PDF naší faktury s tímto číslem (nejnovější verze), nebo null. */
function invoiceFileOf(job: JobDetail, number: string): InvoiceFileRef | null {
  const name = pdfFileName("faktura", number);
  const f = job.files
    .filter((x) => isOwnInvoiceFile(x) && x.filename === name)
    .sort((a, b) => (b.version ?? 1) - (a.version ?? 1) || b.createdAt.localeCompare(a.createdAt))[0];
  return f ? { fileId: f.id, filename: f.filename, version: f.version ?? 1 } : null;
}

/**
 * Faktura už je: vystavené PDF → jen poslat znovu (žádné nové datum ani verze, otevření dialogu nic
 * nemění); faktura mimo systém / cizí číslo → druhá faktura nevznikne. Číslo z řady FV bez faktury
 * = rezervace po nepovedeném vystavení → použije se znovu (žádná díra v řadě).
 */
async function planInvoice(db: JobsDb, job: JobDetail, reissue: boolean): Promise<InvoicePlan> {
  const no = (job.invoiceNumber ?? "").trim();
  if (!no) return { kind: "issue", reserved: null, row: null };
  const file = invoiceFileOf(job, no);
  if (file && !reissue) return { kind: "existing", number: no, file };
  const { data } = await db.from("invoices")
    .select("id, order_id, storage_path, issue_date, taxable_date, due_date").eq("number", no).maybeSingle();
  const row = (data as InvoiceRow | null) ?? null;
  if (row?.order_id && row.order_id !== job.id) {
    return { kind: "blocked", code: "invoiced", error: `Faktura ${no} patří jiné zakázce — oprav číslo faktury této zakázky.` };
  }
  if (row && !row.storage_path) {
    return { kind: "blocked", code: "invoiced", error: `Faktura ${no} je zapsaná jako vystavená mimo systém — PDF z aplikace k ní nevzniká. Další krok je „Zadat platbu“.` };
  }
  if (!row) {
    if (!FV_SERIES.test(no)) {
      return { kind: "blocked", code: "invoiced", error: `Zakázka už má zapsanou fakturu ${no} (mimo systém) — druhá faktura z aplikace nevznikne.` };
    }
    const { data: other } = await db.from("orders").select("id").eq("invoice_number", no).neq("id", job.id).limit(1);
    if ((other ?? []).length) {
      return { kind: "blocked", code: "invoiced", error: `Číslo faktury ${no} má i jiná zakázka — oprav číslo faktury této zakázky.` };
    }
  }
  return { kind: "issue", reserved: no, row };
}

/** Číslo faktury zakázce atomicky (zámek řádku zakázky): vítěz souběhu číslo přidělí, ostatní ho dostanou. */
async function assignInvoiceNumber(db: JobsDb, jobId: string): Promise<{ number: string; created: boolean } | null> {
  const rpc = db.rpc as unknown as (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc.call(db, "assign_invoice_number", { p_job: jobId });
  if (error) {
    console.error(`[job-documents] Číslo faktury se nepodařilo přidělit: ${error.message}`);
    return null;
  }
  const r = (data ?? {}) as { number?: unknown; created?: unknown };
  return typeof r.number === "string" && r.number ? { number: r.number, created: r.created === true } : null;
}

/** Souběžné vystavení (druhá záložka / kolega): počkat na PDF vítěze místo druhé faktury. */
async function waitForInvoiceFile(db: JobsDb, jobId: string, number: string): Promise<InvoiceFileRef | null> {
  const name = pdfFileName("faktura", number);
  for (let i = 0; i < 24; i++) {
    const { data } = await db.from("job_files").select("id, filename, version")
      .eq("job_id", jobId).eq("kind", "faktura").eq("archived", false).eq("origin", "generated").eq("filename", name)
      .order("version", { ascending: false }).limit(1);
    const f = ((data ?? []) as { id: string; filename: string; version: number | null }[])[0];
    if (f) return { fileId: f.id, filename: f.filename, version: f.version ?? 1 };
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.round((b - a) / 86_400_000)) : 0;
}

/**
 * Vygeneruje PDF doklad ze zakázky, uloží ho do Dokumentů zakázky (verzuje)
 * a vrátí id souboru. Nabídka vyžaduje quoteId (jinak poslední aktuální nabídka).
 * Nabídka, potvrzení a faktura s položkami bez ceny vrátí chybu s `unpriced` — UI nabídne
 * „Přesto vystavit" (opts.force). S opts.reuse (dialogy „Odeslat…") vrátí beze změny obsahu
 * (otisk) poslední vystavený soubor — otevření dialogu nezakládá nové verze ani historii;
 * výslovné „Vystavit" dál zakládá novou verzi.
 * Faktura: jedna na zakázku — vystavená se jen vrátí (žádné nové datum, verze ani zápis), nové PDF
 * téže faktury jen s opts.reissue (se stejným datem a splatností); vystavit jde až po dodání všeho;
 * číslo přidělí DB atomicky (souběh dvou vystavení = jedna faktura).
 */
export async function generateJobDocument(
  jobId: string,
  kind: JobDocumentKind,
  opts?: { quoteId?: string; note?: string; force?: boolean; reuse?: boolean; deliveryNoteId?: string; reissue?: boolean },
): Promise<ActionResult<{
  fileId: string; number: string; filename: string; version: number; unpriced: number; existing: boolean;
  code: "approval" | "rights" | "delivery" | "invoiced";
}>> {
  if (!isDocKind(kind)) return fail("Neznámý druh dokladu.");
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  if (opts?.quoteId !== undefined && opts.quoteId !== "" && !isUuid(opts.quoteId)) return fail("Nabídka nenalezena.");
  if (opts?.deliveryNoteId !== undefined && opts.deliveryNoteId !== "" && !isUuid(opts.deliveryNoteId)) return fail("Dodací list nenalezen.");
  const c = await begin();
  if ("error" in c) return fail(c.error);
  const { db, user } = c;
  // A2: jediná cesta k faktuře (karta → Vystavit fakturu) je pro finance — i zadní vrátka (/documents) hlídá server
  if (kind === "faktura" && !(await canInvoice())) return { ok: false, error: INVOICE_NO_RIGHT, code: "rights" };
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
    /** Nové PDF už vystavené faktury (ztracené PDF / reissue) — datum a splatnost zůstávají. */
    let invoiceReissue = false;
    /** Čas posledního schválení nabídky — znovupoužít jde jen PDF vystavené po něm. */
    let approvedAt: string | null = null;

    if (kind === "nabidka") {
      quote = quoteOf(job, opts?.quoteId || null);
      if (!quote) {
        return fail(opts?.quoteId ? "Nabídka k této zakázce nepatří." : "Zakázka zatím nemá nabídku — vytvoř ji v záložce Nabídky.");
      }
      // #25: neschválenou nabídku k odeslání nevystavíme (náhled s vodoznakem je /api/pdf/job)
      const isAdmin = user.role === "super_admin";
      if (quoteApprovalBlock({ ...quote, approvedBy: quote.approvedBy?.id ?? null })) {
        return { ok: false, error: isAdmin ? ISSUE_PENDING_ADMIN : ISSUE_PENDING_STAFF, code: "approval" };
      }
      if (note && needsApproval(quote) && !isAdmin) return { ok: false, error: ISSUE_NOTE_REFUSED, code: "approval" };
      // (odeslaná = podle stavu, ne sent_at — ten u neodeslané nabídky nic neznamená)
      if (needsApproval(quote) && !quoteWasSent({ state: quote.state, sentAt: null }) && quote.approvedBy) {
        // co jde zákazníkovi = co bylo schváleno: otisk se musí shodovat (změna zakázky po schválení)
        const { data: snap } = await db.from("quotes").select("approved_snapshot_sha, approved_at, updated_at").eq("id", quote.id).maybeSingle();
        const s = (snap ?? {}) as { approved_snapshot_sha?: string | null; approved_at?: string | null; updated_at?: string | null };
        approvedAt = s.approved_at ?? quote.approvedAt ?? null;
        if (s.approved_snapshot_sha) {
          const sha = await quoteSnapshotSha(job, quote);
          if (sha !== s.approved_snapshot_sha) {
            if (isAdmin) {
              const { error } = await db.from("quotes").update({ approved_snapshot_sha: sha } as never).eq("id", quote.id);
              if (error) return fail(error.message);
            } else {
              let reset = db.from("quotes").update({ approved_by: null } as never).eq("id", quote.id).eq("state", "schvalena");
              if (s.updated_at) reset = reset.eq("updated_at", s.updated_at);
              const { error } = await reset;
              if (error) return fail(error.message);
              await logJobEvent(db, {
                jobId, type: "quote", entity: "quote", entityId: quote.id, actorId: user.id,
                message: `Schválení nabídky ${quote.number} zrušeno — od schválení se změnily údaje zakázky.`,
                data: { quoteId: quote.id, number: quote.number, action: "approval_reset", cause: "snapshot" },
              });
              revalidateDocs(jobId);
              return { ok: false, error: SNAPSHOT_RESET, code: "approval" };
            }
          }
        }
      } else if (quote.approvedAt) {
        approvedAt = quote.approvedAt;
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
      // dodávky s vlastními DL: stáhnout vystavený DL (žádné nové číslo); DL na zbytek = „Zapsat dodání"
      const notes = await issuedDeliveryNotes(db, jobId);
      // dodáno bez DL (starší dodání, nezaškrtnuté „Vystavit dodací list", zavřená chyba DL) → DL jen
      // na zboží, které ještě žádný DL nemá — i když zakázka jiné DL už má
      const documented = notes.length ? await documentedQuantities(db, jobId) : new Map<string, number>();
      const missing = notes.length ? undocumentedRows(job.items, documented) : deliveredRows(job.items);
      if (notes.length && (opts?.deliveryNoteId || !missing.length)) {
        const pick = opts?.deliveryNoteId ? notes.find((n) => n.id === opts.deliveryNoteId!.toLowerCase()) : notes[notes.length - 1];
        if (!pick) return fail("Dodací list k této zakázce nepatří.");
        const file = await fileOfNote(db, jobId, pick.storage_path);
        if (file) return { ok: true, fileId: file.id, number: pick.number, filename: file.filename, version: file.version ?? 1, unpriced: 0 };
        // PDF se ztratilo (smazaný dokument) → nové PDF se stejným číslem ze záznamu DL
        const re = await reissueFromSnapshot(db, user.id, job, pick, preparedBy);
        revalidateDocs(jobId);
        return { ok: true, fileId: re.fileId, number: pick.number, filename: re.filename, version: re.version, unpriced: 0 };
      }
      // ne na objednané množství; uloží se jako DL dodávky (příště se jen stáhne, číslo se nemění)
      const shipped = missing;
      if (shipped.length) {
        try {
          const dn = await issueDeliveryNote(db, user.id, job, shipped, { note: note ?? null, preparedBy, catchUp: true });
          await logAudit({
            action: "document_issued", entity: "job_files", entityId: dn.fileId,
            diff: { jobId, kind: "dodaci_list", number: dn.number, version: dn.version, deliveryNoteId: dn.id, delivered: true },
          });
          revalidateDocs(jobId);
          return { ok: true, fileId: dn.fileId, number: dn.number, filename: dn.filename, version: dn.version, unpriced: 0 };
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err));
        }
      }
      // nic dodáno: DL „na celou zakázku" (vlastní číslo bez dodávky) už nevzniká — jedna cesta
      // = „Zapsat dodání a dodací list" (dodávka + DL); náhled bez uložení zůstává (/api/pdf/job)
      return { ok: false, error: DELIVERY_NOTE_NEEDS_DELIVERY, code: "delivery" };
    } else {
      const plan = await planInvoice(db, job, opts?.reissue === true);
      if (plan.kind === "existing") {
        return { ok: true, fileId: plan.file.fileId, number: plan.number, filename: plan.file.filename, version: plan.file.version, unpriced: 0, existing: true };
      }
      if (plan.kind === "blocked") return { ok: false, error: plan.error, code: plan.code };
      // nová faktura jen po dodání všeho (dílčí faktura by účtovala i nedodané kusy)
      if (!plan.row) {
        const gate = invoiceDeliveryError((await docFacts(db, jobId)).invoiceDelivery);
        if (gate) return { ok: false, error: gate, code: "delivery" };
      }
      // ceny zkontrolovat dřív, než se spotřebuje číslo z řady
      const missing = unpricedCount(pickPricedItems(job));
      if (missing && !force) return { ok: false, error: unpricedError(missing, kind), unpriced: missing };
      let allocated = plan.reserved;
      if (!allocated) {
        const assigned = await assignInvoiceNumber(db, jobId);
        if (!assigned) return fail("Nepodařilo se přidělit číslo faktury.");
        allocated = assigned.number;
        if (!assigned.created) {
          // souběh: číslo přidělilo jiné vystavení před chvílí → jeho PDF, žádná druhá faktura
          const won = await waitForInvoiceFile(db, jobId, allocated);
          if (won) return { ok: true, fileId: won.fileId, number: allocated, filename: won.filename, version: won.version, unpriced: 0, existing: true };
        }
        job.invoiceNumber = allocated;
      }
      number = allocated;
      const row = plan.row;
      invoiceReissue = Boolean(row);
      const issueDate = dateOnly(row?.issue_date) ?? undefined;
      const data = await buildInvoiceDoc(job, {
        number, preparedBy, note,
        // zálohy / platby zakázky → „Uhrazeno zálohou…", „Zbývá uhradit", QR na zbytek
        payments: await jobPaymentRows(db, jobId),
        ...(issueDate ? { issueDate, taxableDate: dateOnly(row?.taxable_date) ?? issueDate } : {}),
        ...(issueDate && row?.due_date ? { dueDays: daysBetween(issueDate, row.due_date) } : {}),
      });
      // dodávky s vlastními DL → na faktuře všechna čísla dodacích listů
      const dls = await issuedDeliveryNotes(db, jobId).catch(() => []);
      if (dls.length) data.deliveryNoteNumber = dls.map((n) => n.number).join(", ");
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
      let sameQ = db.from("job_files")
        .select("id, filename, version")
        .eq("job_id", jobId).eq("kind", kind).eq("archived", false).eq("content_sha256", fingerprint);
      // #25: PDF nabídky vystavené před posledním schválením už neplatí
      if (approvedAt) sameQ = sameQ.gte("created_at", approvedAt);
      const { data: same } = await sameQ.order("version", { ascending: false }).limit(1);
      const reuse = ((same ?? []) as { id: string; filename: string; version: number | null }[])[0];
      if (reuse) {
        return { ok: true, fileId: reuse.id, number, filename: reuse.filename, version: reuse.version ?? 1, unpriced: 0, existing: true };
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
    if (invoice) {
      await recordInvoice(db, job, invoice, path, user.id);
      // datum a splatnost → Kniha a „po splatnosti" ji hlídají; orders.* = zrcadlo invoices (PDF a
      // evidence nesou stejné datum i splatnost). Nové PDF už vystavené faktury data nemění.
      if (!invoiceReissue) {
        const { error } = await db.from("orders")
          .update({ invoice_date: invoice.issueDate, invoice_due_date: invoice.dueDate } as never).eq("id", jobId);
        if (error) console.error(`[job-documents] Datum a splatnost faktury se nezapsaly: ${error.message}`);
      }
    }

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
    return { ok: true, fileId: file.id, number, filename, version: file.version, unpriced: 0, existing: false };
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
  origin: string | null;
  issuer: string | null;
  created_at: string;
}

/** Číslo dokladu k souboru (pro historii a e-mail). */
async function docNumberForFile(
  db: JobsDb,
  kind: DocumentEmailKind,
  file: { quote_id: string | null; filename?: string | null },
  job: { number: string | null; invoice_number: string | null; delivery_note_number: string | null },
): Promise<string | null> {
  if (kind === "nabidka" && file.quote_id) {
    const { data } = await db.from("quotes").select("number").eq("id", file.quote_id).maybeSingle();
    return (data as { number: string | null } | null)?.number ?? null;
  }
  if (kind === "potvrzeni") return job.number ? confirmationNumber(job.number) : null;
  if (kind === "dodaci_list") return deliveryNoteNumberOf(file.filename) ?? job.delivery_note_number ?? null;
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
  let subject = cleanText(String(mail.subject ?? "").replace(/[\r\n]+/g, " "), 300);
  if (!subject) return fail("Doplň předmět e-mailu.");
  let body = String(mail.body ?? "").replace(/\r\n/g, "\n").slice(0, 20_000);

  const c = await begin();
  if ("error" in c) return fail(c.error);
  const { db, user } = c;

  try {
    // #25 (§4.2): nákupní doklad posílá jen obchodník / super admin; PDF nabídky čekající na schválení
    // nebo vystavené před posledním schválením neodejde (dál i podrobná pravidla naší nabídky níže)
    const access = await assertJobFileAccess(db, fileId, await getAccess(), "send");
    if (!access.ok) return fail(access.error);
    const { data: fileData, error: fileErr } = await db
      .from("job_files")
      .select("id, job_id, kind, filename, mime_type, storage_path, quote_id, size_bytes, origin, issuer, created_at")
      .eq("id", fileId)
      .maybeSingle();
    if (fileErr) return fail(fileErr.message);
    const file = fileData as FileForMail | null;
    if (!file || file.job_id !== jobId.toLowerCase() || !file.storage_path) return fail(FILE_NOT_FOUND);

    const { data: jobData, error: jobErr } = await db
      .from("orders")
      .select("id, number, status, order_status, invoice_number, delivery_note_number, owner_id, assignee_id")
      .eq("id", jobId)
      .maybeSingle();
    if (jobErr) return fail(jobErr.message);
    const job = jobData as {
      id: string; number: string | null; status: string; order_status: string | null; invoice_number: string | null; delivery_note_number: string | null;
      owner_id: string | null; assignee_id: string | null;
    } | null;
    if (!job) return fail(NOT_FOUND);

    // #25: všechno ověřit DŘÍV, než e-mail odejde
    if (file.kind === "faktura" && file.issuer !== "dodavatel" && !(await canInvoice())) return fail(INVOICE_NO_RIGHT);
    // návrh psaný před vystavením faktury nese značky čísla a VS → přidělené číslo (i kdyby je klient nedoplnil)
    if (file.kind === "faktura" && job.invoice_number) {
      subject = fillInvoicePlaceholders(subject, job.invoice_number);
      body = fillInvoicePlaceholders(body, job.invoice_number);
    }
    if (file.kind === "nabidka") {
      const { can } = await getAccess();
      const isAdmin = user.role === "super_admin";
      if (file.issuer === "dodavatel" && !file.quote_id) {
        // nabídka dodavatele = nákupní doklad (soubor navázaný na naši nabídku jde vždy větví „naše nabídka“)
        if (!can("margins")) return fail("Nákupní doklad posílá obchodník nebo super admin.");
      } else {
        // naše nabídka: jen PDF vystavené serverem k nabídce (ne nahraný / vyfocený soubor)
        if ((file.origin !== "generated" || !file.quote_id) && !isAdmin) return fail(SEND_UPLOADED_QUOTE);
        if (file.quote_id) {
          const { data: qd } = await db.from("quotes").select(`${FLOW_QUOTE_COLUMNS}, approved_at`).eq("id", file.quote_id).maybeSingle();
          if (!qd) return fail("Nabídka k tomuto PDF nenalezena.");
          const facts = quoteFactsFromRow(qd as Record<string, unknown>);
          const block = quoteSendBlock(facts, {
            can, userId: user.id, isSuperAdmin: isAdmin, jobOwnerId: job.owner_id, jobAssigneeId: job.assignee_id,
          });
          if (block) return fail(block);
          const approvedAt = (qd as { approved_at?: string | null }).approved_at ?? null;
          if (approvedAt && Date.parse(file.created_at) < Date.parse(approvedAt)) return fail(SEND_STALE_PDF);
        }
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
    if (kind === "nabidka" && file.quote_id && file.issuer !== "dodavatel") {
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
    // #25: nákupní doklad bez práva na marže ani nezačne odesílat (schválení nabídky hlídá až odeslání)
    if (file.kind === "faktura" && file.issuer !== "dodavatel" && !(await canInvoice())) return fail(INVOICE_NO_RIGHT);
    if (file.locked === "price") return fail(FILE_PRICE_SEND);
    const kind: DocumentEmailKind = isDocumentEmailKind(file.kind) ? file.kind : "ostatni";
    return await composeDocumentEmail(db, user, job, kind, file);
  } catch (err) {
    return fail(err);
  }
}

/**
 * „Vystavit fakturu": návrh e-mailu PŘED vystavením (otevření ani „Zrušit" nic nevystaví). Faktura už
 * vystavená → existing (jen poslat znovu); nejde vystavit → chyba s kódem. Číslo faktury se přidělí až
 * při vystavení — v návrhu je značka INVOICE_NUMBER_PLACEHOLDER (doplní ji klient i server při odeslání).
 */
export async function draftInvoiceEmail(
  jobId: string,
): Promise<ActionResult<{
  to: string; subject: string; body: string; filename: string; kind: DocumentEmailKind; unpriced: number;
  existing: { fileId: string; filename: string; number: string } | null; code: "rights" | "delivery" | "invoiced";
  /** Faktura by vznikla bez QR / čísla účtu (chybí bankovní spojení v Nastavení) — jen před vystavením. */
  bankWarning: string | null;
}>> {
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!(await canInvoice())) return { ok: false, error: INVOICE_NO_RIGHT, code: "rights" };
  try {
    const job = await getJob(jobId);
    if (!job) return fail(NOT_FOUND);
    const plan = await planInvoice(c.db, job, false);
    if (plan.kind === "blocked") return { ok: false, error: plan.error, code: plan.code };
    if (plan.kind === "existing") {
      const file = job.files.find((f) => f.id === plan.file.fileId);
      const draft = await composeDocumentEmail(c.db, c.user, job, "faktura", {
        filename: plan.file.filename, quoteId: null, createdAt: file?.createdAt ?? new Date().toISOString(),
      });
      if (!draft.ok) return draft;
      return { ...draft, unpriced: 0, existing: { fileId: plan.file.fileId, filename: plan.file.filename, number: plan.number } };
    }
    if (!plan.row) {
      const gate = invoiceDeliveryError((await docFacts(c.db, jobId)).invoiceDelivery);
      if (gate) return { ok: false, error: gate, code: "delivery" };
    }
    const reserved = plan.reserved;
    const draft = await composeDocumentEmail(c.db, c.user, job, "faktura", {
      filename: pdfFileName("faktura", reserved ?? "FV"), quoteId: null, createdAt: new Date().toISOString(),
    }, reserved ? undefined : { invoiceNumber: INVOICE_NUMBER_PLACEHOLDER, variableSymbol: INVOICE_VS_PLACEHOLDER });
    if (!draft.ok) return draft;
    // „PDF s QR": bez bankovního účtu / IBANu v Nastavení varovat PŘED vystavením (COMPANY načetl compose)
    const bankWarning = invoiceBankWarning({ accountNumber: COMPANY.bank.accountNumber, iban: COMPANY.bank.iban }, job.currency || "CZK");
    return {
      ...draft, filename: reserved ? draft.filename ?? "" : "Faktura_[číslo].pdf", unpriced: unpricedCount(pickPricedItems(job)), existing: null,
      bankWarning,
    };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Návrh e-mailu k nabídce ještě PŘED vystavením PDF („Schválit a odeslat“ — PDF vystaví server
 * až po schválení). Název přílohy = název, který PDF dostane.
 */
export async function draftQuoteEmail(
  jobId: string,
  quoteId: string,
): Promise<ActionResult<{ to: string; subject: string; body: string; filename: string; kind: DocumentEmailKind }>> {
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  if (!isUuid(quoteId)) return fail("Nabídka nenalezena.");
  const c = await begin();
  if ("error" in c) return fail(c.error);
  try {
    const job = await getJob(jobId);
    if (!job) return fail(NOT_FOUND);
    const quote = job.quotes.find((q) => q.id === quoteId.toLowerCase());
    if (!quote) return fail("Nabídka k této zakázce nepatří.");
    return await composeDocumentEmail(c.db, c.user, job, "nabidka", {
      filename: pdfFileName("nabidka", quote.number), quoteId: quote.id, createdAt: new Date().toISOString(),
    });
  } catch (err) {
    return fail(err);
  }
}

async function composeDocumentEmail(
  db: JobsDb, user: CurrentUser, job: JobDetail, kind: DocumentEmailKind,
  file: { filename: string; quoteId: string | null; createdAt: string },
  /** Faktura před vystavením: značky místo čísla a VS (přidělí se až při vystavení). */
  invoicePending?: { invoiceNumber: string; variableSymbol: string },
): Promise<ActionResult<{ to: string; subject: string; body: string; filename: string; kind: DocumentEmailKind }>> {
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
    // každá dodávka má vlastní DL — číslo z dokumentu, ne jediné číslo zakázky
    input.number = deliveryNoteNumberOf(file.filename) ?? job.deliveryNoteNumber;
    input.deliveryDate = dateOnly(job.dueDate) ?? null;
  } else if (kind === "faktura") {
    input.number = invoicePending?.invoiceNumber ?? job.invoiceNumber;
    type InvoiceRow = {
      issue_date: string | null; due_date: string | null; total: number | string | null; variable_symbol: string | null; currency: string | null;
    };
    let invoice: InvoiceRow | null = null;
    if (job.invoiceNumber && !invoicePending) {
      const { data } = await db
        .from("invoices")
        .select("issue_date, due_date, total, variable_symbol, currency")
        .eq("number", job.invoiceNumber)
        .maybeSingle();
      invoice = (data as InvoiceRow | null) ?? null;
    }
    const issued = dateOnly(file.createdAt) ?? todayIso();
    input.dueDate = invoice?.due_date ?? addDaysIso(issued, Math.max(0, job.customerDetail?.paymentTermsDays ?? 14));
    const items = pickPricedItems(job);
    const total = invoice?.total !== null && invoice?.total !== undefined ? Number(invoice.total) : computeTotals(items).total;
    // zálohy / platby: e-mail uvádí stejně jako PDF a QR „Zbývá uhradit"
    const { payments, settled } = invoicePaymentsFromRows(await jobPaymentRows(db, job.id), items, dateOnly(invoice?.issue_date) ?? issued);
    const { paid } = invoiceBalance(items, payments, settled);
    if (Number.isFinite(total) && (paid > 0 || settled)) {
      input.invoiceTotal = total;
      input.paidAmount = paid;
      input.amount = settled ? 0 : Math.max(0, Math.round((total - paid) * 100) / 100);
    } else {
      input.amount = Number.isFinite(total) ? total : null;
    }
    input.currency = invoice?.currency || job.currency;
    input.variableSymbol = invoicePending?.variableSymbol
      ?? (invoice?.variable_symbol || spdVariableSymbol(job.invoiceNumber ?? undefined) || null);
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
}
