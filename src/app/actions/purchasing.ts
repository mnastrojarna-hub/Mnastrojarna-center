"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { checkFeature } from "@/lib/auth/session";
import type { CurrentUser } from "@/lib/data/current-user";
import { logAudit } from "@/lib/audit";
import { COMPANY } from "@/lib/company";
import { refreshCompanyFromSettings } from "@/lib/company-server";
import { getJob } from "@/lib/data/jobs";
import {
  fetchProfileContact, fetchPurchaseOrder, fetchSupplierQuote, fetchSupplierQuotes, fetchSupplierRef,
} from "@/lib/data/purchasing";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { isJobStage } from "@/lib/jobs/stages";
import {
  cleanDate, cleanText, describeChanges, diffJob, fieldEventMessage, isUuid,
  translateDbError, type JobChange,
} from "@/lib/jobs/mapping";
import {
  PURCHASE_ORDER_STATUS_META, applyPurchasePrices, buildPurchaseOrderDraft, canChangePurchaseOrderStatus, canFillPurchasePrices,
  cleanPurchaseItems, isPurchaseOrderEditable, isPurchaseOrderStatus, issueStageHint,
  purchaseOrderEmail, purchaseOrderFileName, resolveQuoteDeliveryDate, resolveSupplierQuoteTotal, rowsTotal,
  rowToCommissionView, supplierQuoteInputToRow, validatePurchaseOrderDraft,
  type CommissionDbRow, type PurchaseItemRowInput,
} from "@/lib/jobs/purchasing";
import { ourDeliveryAddressCore, purchaseOrderMailFor, purchasePriceOnlyChanges, sendPurchaseOrderCore, storePurchaseOrderPdfCore } from "@/lib/jobs/purchase-order-docs";
import { nextStepAfterConfirmedHint, purchaseOrderSender } from "@/lib/jobs/production-handoff-store";
import { getAccess } from "@/lib/auth/session";
import { OPERATION_KINDS, isOperationKind } from "@/lib/jobs/operations";
import type {
  JobCommissionView, PurchaseItem, PurchaseOrderDraft, PurchaseOrderDraftInput, PurchaseOrderMail,
  PurchaseOrderPatch, PurchaseOrderView, PurchaseReceiptInput, SupplierQuoteInput, SupplierQuoteView,
} from "@/lib/jobs/purchasing-types";
import {
  applyPurchaseDelivered, findOrCreateSupplierByParty, insertSupplierQuote, isOurParty, receivePurchaseItems, selectWinningQuoteCore,
} from "@/lib/jobs/purchasing-store";
import { userActor } from "@/lib/supabase/actor-headers";
import { normalizeExtracted } from "@/lib/jobs/extracted-normalize";
import { czDate } from "@/lib/pdf/types";
import type { JobStage, PurchaseOrderStatus } from "@/lib/supabase/database.types";
import type { ActionResult } from "@/lib/jobs/types";

/**
 * Nákup zakázky: nabídky dodavatelů (vítězná), objednávky vydané (OV-2026-004)
 * s PDF a odesláním e-mailem, obchodník zakázky. Provizi NEpočítáme tady —
 * přepočítá ji DB trigger při každé změně objednávek / zakázky / sazby.
 * Vše jen s právem „margins" (super admin + obchodník). Do historie zakázky
 * (vidí ji všechny role) nikdy nejdou nákupní ceny.
 */

interface Ctx {
  db: JobsDb;
  user: CurrentUser;
}

type Row = Record<string, unknown>;

const JOB_NOT_FOUND = "Zakázka nenalezena.";
const QUOTE_NOT_FOUND = "Nabídka dodavatele nenalezena.";
const PO_NOT_FOUND = "Objednávka nenalezena.";

async function begin(): Promise<Ctx | { error: string }> {
  if (!isSupabaseConfigured()) return { error: "Supabase není nakonfigurováno." };
  const access = await checkFeature("margins");
  if ("error" in access) return { error: access.error };
  const db = await createOperatorClient({ actor: userActor(access.user) });
  return { db, user: access.user };
}

function fail(err: unknown): { ok: false; error: string } {
  if (typeof err === "string") return { ok: false, error: translateDbError(err) };
  return { ok: false, error: err instanceof Error ? translateDbError(err.message) : "Neočekávaná chyba." };
}

function revalidatePurchasing(jobId?: string | null) {
  revalidatePath("/orders");
  revalidatePath("/commissions");
  revalidatePath("/documents");
  revalidatePath("/");
  if (jobId) revalidatePath(`/orders/${jobId}`);
}

async function loadJob(db: JobsDb, id: string, columns: string): Promise<Row | null> {
  const { data, error } = await db.from("orders").select(columns).eq("id", id).maybeSingle();
  if (error) console.error(`[purchasing] Načtení zakázky selhalo: ${error.message}`);
  return (data as Row | null) ?? null;
}

/** Změny zakázky do historie — citlivé hodnoty (nákupní cena) bez čísel. */
async function logJobChanges(c: Ctx, jobId: string, changes: JobChange[], refs: Record<string, string>, extra: Row = {}) {
  if (!changes.length) return;
  const views = describeChanges(changes, refs).map((v) =>
    v.sensitive ? { field: v.field, label: v.label, from: null, to: null, fromText: "", toText: "", sensitive: true } : v,
  );
  await logJobEvent(c.db, {
    jobId, type: "field", message: fieldEventMessage(views), data: { changes: views, ...extra }, actorId: c.user.id,
  });
}

/** Úprava zakázky (jen skutečné změny) + záznam do historie. */
async function patchJob(c: Ctx, jobId: string, before: Row, patch: Row, refs: Record<string, string> = {}, extra: Row = {}): Promise<string | null> {
  const changes = diffJob(before, patch);
  if (!changes.length) return null;
  const update: Row = {};
  for (const ch of changes) update[ch.field] = patch[ch.field];
  const { error } = await c.db.from("orders").update(update as never).eq("id", jobId);
  if (error) return error.message;
  await logJobChanges(c, jobId, changes, refs, extra);
  return null;
}

function itemRows(items: PurchaseItem[]): PurchaseItemRowInput[] {
  return items.map((it, i) => ({
    position: i,
    drawing_number: it.drawingNumber,
    name: it.name,
    material: it.material,
    quantity: it.quantity,
    unit: it.unit,
    unit_price: it.unitPrice,
    note: it.note,
  }));
}

function quoteLabel(name: string, number: string | null | undefined): string {
  return `${name || "dodavatele"}${number ? ` č. ${number}` : ""}`;
}

async function supplierName(db: JobsDb, id: string | null | undefined): Promise<string | null> {
  if (!isUuid(id)) return null;
  const { data } = await db.from("suppliers").select("id, name").eq("id", id).maybeSingle();
  return (data as { name: string } | null)?.name ?? null;
}

async function fileBelongsToJob(db: JobsDb, fileId: string, jobId: string): Promise<boolean> {
  const { data } = await db.from("job_files").select("id").eq("id", fileId).eq("job_id", jobId).maybeSingle();
  return Boolean(data);
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Dodavatel podle názvu (bez ohledu na velikost písmen), jinak se založí do adresáře. */
async function findOrCreateSupplier(c: Ctx, name: string): Promise<{ id: string; created: boolean } | { error: string }> {
  const { data: found } = await c.db.from("suppliers").select("id, name").ilike("name", escapeLike(name)).limit(1);
  const hit = ((found ?? []) as { id: string }[])[0];
  if (hit) return { id: hit.id, created: false };
  const { data, error } = await c.db.from("suppliers").insert({ name } as never).select("id").single();
  if (error || !data) return { error: error?.message ?? "Dodavatele se nepodařilo založit." };
  await logAudit({ action: "supplier_created", entity: "suppliers", entityId: (data as { id: string }).id, diff: { name, via: "purchase_order" } });
  return { id: (data as { id: string }).id, created: true };
}

async function replaceItems(
  db: JobsDb,
  table: "supplier_quote_items" | "purchase_order_items",
  fk: "supplier_quote_id" | "purchase_order_id",
  parentId: string,
  rows: PurchaseItemRowInput[],
): Promise<string | null> {
  const { error: delErr } = await db.from(table).delete().eq(fk, parentId);
  if (delErr) return delErr.message;
  if (!rows.length) return null;
  const { error } = await db.from(table).insert(rows.map((r) => ({ ...r, [fk]: parentId })) as never);
  return error ? error.message : null;
}

/** Potvrzený termín objednávky = slíbený termín zakázky? Jen u zakázky bez postupu, nebo když objednávka patří poslednímu otevřenému kroku. */
async function promisesJobDate(db: JobsDb, jobId: string, poId: string): Promise<boolean> {
  const { data } = await db.from("job_operations").select("id, status, position, created_at, purchase_order_id").eq("job_id", jobId).order("position").order("created_at");
  const ops = (data ?? []) as { status: string; purchase_order_id: string | null }[];
  if (!ops.length) return true;
  const open = ops.filter((o) => ["ceka", "probiha", "problem"].includes(o.status));
  const last = open[open.length - 1];
  return Boolean(last && last.purchase_order_id === poId);
}

async function ourDeliveryAddress(): Promise<string> {
  return ourDeliveryAddressCore();
}

// ── Nabídky dodavatelů ──────────────────────────────────────
export async function createSupplierQuote(jobId: string, input: SupplierQuoteInput): Promise<ActionResult<{ id: string }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(JOB_NOT_FOUND);
  try {
    const res = await insertSupplierQuote(c.db, c.user.id, jobId, input);
    if (!res.ok) return fail(res.error);
    revalidatePurchasing(jobId);
    return { ok: true, id: res.id };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Nabídka dodavatele vyfocená uživatelem bez práva na marže (soubor s „čeká na zapsání do Nákupu")
 * → nabídka s položkami a cenami z přečteného dokladu. Příznak čekání se zruší.
 */
export async function importCapturedSupplierQuote(fileId: string): Promise<ActionResult<{ id: string }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(fileId)) return fail("Dokument nenalezen.");
  try {
    const { db, user } = c;
    const { data } = await db.from("job_files").select("id, job_id, ai_extracted, capture_id").eq("id", fileId).maybeSingle();
    const file = data as { id: string; job_id: string; ai_extracted: Record<string, unknown> | null; capture_id: string | null } | null;
    if (!file) return fail("Dokument nenalezen.");
    const ext = file.ai_extracted ?? {};
    if (ext.purchasingPending !== true) return fail("Nabídka už je v Nákupu zapsaná.");
    const doc = normalizeExtracted(ext);
    const ours = isOurParty(doc.supplier);
    const supplier = !ours && (doc.supplier.name.trim() || doc.supplier.ico.trim())
      ? await findOrCreateSupplierByParty(db, doc.supplier)
      : null;
    const docId = typeof ext.captureDocId === "string" ? ext.captureDocId : null;
    const res = await insertSupplierQuote(db, user.id, file.job_id, {
      supplierId: supplier?.id ?? null,
      supplierName: supplier ? undefined : (!ours && doc.supplier.name) || "Dodavatel z focení",
      number: doc.documentNumber || undefined,
      quoteDate: doc.documentDate || undefined,
      deliveryDate: doc.promisedDeliveryDate || undefined,
      currency: doc.currency || undefined,
      note: doc.note || undefined,
      fileId: file.id,
      source: "foto",
      items: doc.items.map((it) => ({
        drawingNumber: it.drawingNumber || undefined, name: it.name || it.description || undefined, material: it.material || undefined,
        quantity: it.quantity > 0 ? it.quantity : 1, unit: it.unit || "ks", unitPrice: it.unitPrice > 0 ? it.unitPrice : null,
      })),
      total: doc.totalWithoutVat > 0 ? doc.totalWithoutVat : null,
    }, { captureId: file.capture_id, captureDocId: docId });
    if (!res.ok) return fail(res.error);
    const { purchasingPending: _pending, ...rest } = ext;
    void _pending;
    await db.from("job_files").update({ ai_extracted: rest } as never).eq("id", file.id);
    revalidatePurchasing(file.job_id);
    return { ok: true, id: res.id };
  } catch (err) {
    return fail(err);
  }
}

export async function updateSupplierQuote(id: string, input: Partial<SupplierQuoteInput>): Promise<ActionResult> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(id)) return fail(QUOTE_NOT_FOUND);
  const conv = supplierQuoteInputToRow(input, { partial: true });
  if ("error" in conv) return fail(conv.error);
  let newRows: PurchaseItemRowInput[] | null = null;
  if (input.items !== undefined) {
    const items = cleanPurchaseItems(input.items, { allowEmpty: true });
    if ("error" in items) return fail(items.error);
    newRows = items.rows;
  }

  try {
    const { db, user } = c;
    const quote = await fetchSupplierQuote(db, id);
    if (!quote) return fail(QUOTE_NOT_FOUND);
    const row = conv.row;
    if (row.supplier_id && !(await supplierName(db, row.supplier_id as string))) return fail("Dodavatel nenalezen.");
    if (row.file_id && !(await fileBelongsToJob(db, row.file_id as string, quote.jobId))) return fail("Dokument nepatří k této zakázce.");
    if (input.deliveryDate !== undefined && !row.delivery_date) {
      // vymazaný termín → dopočet z dodací lhůty
      row.delivery_date = resolveQuoteDeliveryDate({
        leadTimeDays: "lead_time_days" in row ? row.lead_time_days : quote.leadTimeDays,
        quoteDate: "quote_date" in row ? row.quote_date : quote.quoteDate,
      });
    }
    if (input.total !== undefined || newRows) {
      row.total = resolveSupplierQuoteTotal(input.total, newRows ?? itemRows(quote.items));
    }
    if ("supplier_id" in row && !row.supplier_id) {
      // odpojení od adresáře → zůstane volný název (zadaný, jinak dosavadní)
      const keep = "supplier_name" in row ? (row.supplier_name as string | null) : quote.supplierName || null;
      if (!keep) return fail("Vyber dodavatele nebo vyplň jeho název.");
      row.supplier_name = keep;
    } else if (!("supplier_id" in row) && "supplier_name" in row && !row.supplier_name && !quote.supplier) {
      return fail("Vyber dodavatele nebo vyplň jeho název.");
    }

    if (Object.keys(row).length) {
      const { error } = await db.from("supplier_quotes").update(row as never).eq("id", id);
      if (error) return fail(error.message);
    }
    if (newRows) {
      const itemErr = await replaceItems(db, "supplier_quote_items", "supplier_quote_id", id, newRows);
      if (itemErr) return fail(itemErr);
    }

    // vítězná nabídka → plánovaný nákup zakázky drží krok
    if (quote.selected && "total" in row && row.total !== null && row.total !== quote.total) {
      const job = await loadJob(db, quote.jobId, "id, purchase_cost");
      if (job) {
        const err = await patchJob(c, quote.jobId, job, { purchase_cost: row.total }, {}, { supplierQuoteId: id });
        if (err) return fail(err);
      }
    }

    const supplierIdNow = "supplier_id" in row ? (row.supplier_id as string | null) : quote.supplier?.id ?? null;
    const name = (await supplierName(db, supplierIdNow)) ?? ((row.supplier_name as string | null | undefined) || quote.supplierName);
    const parts: string[] = [];
    if (newRows) parts.push(`položky (${newRows.length})`);
    if ("delivery_date" in row) parts.push(row.delivery_date ? `termín ${czDate(row.delivery_date as string)}` : "termín");
    if ("total" in row) parts.push("cena");
    const other = Object.keys(row).filter((k) => !["delivery_date", "total"].includes(k)).length;
    if (other) parts.push("údaje nabídky");
    await logJobEvent(db, {
      jobId: quote.jobId, type: "quote",
      message: `Upravena nabídka dodavatele ${quoteLabel(name, (row.number as string | undefined) ?? quote.number)}${parts.length ? `: ${parts.join(", ")}` : ""}`,
      data: { supplierQuoteId: id, action: "updated", fields: Object.keys(row), ...(newRows ? { itemCount: newRows.length } : {}) },
      actorId: user.id,
    });
    revalidatePurchasing(quote.jobId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteSupplierQuote(id: string): Promise<ActionResult> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(id)) return fail(QUOTE_NOT_FOUND);
  try {
    const { db, user } = c;
    const quote = await fetchSupplierQuote(db, id);
    if (!quote) return fail(QUOTE_NOT_FOUND);
    const { error } = await db.from("supplier_quotes").delete().eq("id", id);
    if (error) return fail(error.message);
    await logAudit({
      action: "supplier_quote_deleted", entity: "supplier_quotes", entityId: id,
      diff: { jobId: quote.jobId, supplier: quote.supplierName, number: quote.number, selected: quote.selected, total: quote.total },
    });
    await logJobEvent(db, {
      jobId: quote.jobId, type: "quote",
      message: `Smazána nabídka dodavatele ${quoteLabel(quote.supplierName, quote.number)}${quote.selected ? " (byla vítězná)" : ""}`,
      data: { supplierQuoteId: id, action: "deleted" },
      actorId: user.id,
    });
    revalidatePurchasing(quote.jobId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Vítězná nabídka dodavatele: ostatní nabídky zakázky odznačí a do zakázky propíše
 * dodavatele (když chybí), plánovaný nákup (= cena nabídky) a slíbený termín (když chybí).
 */
export async function selectWinningSupplierQuote(id: string): Promise<ActionResult> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(id)) return fail(QUOTE_NOT_FOUND);
  try {
    const res = await selectWinningQuoteCore(c.db, c.user.id, id);
    if (!res.ok) return fail(res.error);
    revalidatePurchasing(res.jobId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function unselectSupplierQuote(id: string): Promise<ActionResult> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(id)) return fail(QUOTE_NOT_FOUND);
  try {
    const quote = await fetchSupplierQuote(c.db, id);
    if (!quote) return fail(QUOTE_NOT_FOUND);
    if (!quote.selected) return { ok: true };
    const { error } = await c.db.from("supplier_quotes").update({ selected: false } as never).eq("id", id);
    if (error) return fail(error.message);
    await logJobEvent(c.db, {
      jobId: quote.jobId, type: "quote",
      message: `Zrušen výběr vítězné nabídky dodavatele ${quoteLabel(quote.supplierName, quote.number)}`,
      data: { supplierQuoteId: id, action: "unselected" },
      actorId: c.user.id,
    });
    revalidatePurchasing(quote.jobId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// ── Objednávka vydaná ───────────────────────────────────────
/**
 * Návrh objednávky (neuloží se): dodavatel + položky z vítězné / zvolené nabídky
 * dodavatele, jinak ze zakázky (nákupní ceny), termín, naše dodací adresa, podmínky.
 */
export async function draftPurchaseOrder(
  jobId: string,
  opts: { supplierQuoteId?: string; supplierId?: string } = {},
): Promise<ActionResult<{ draft: PurchaseOrderDraft }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(JOB_NOT_FOUND);
  if (opts.supplierQuoteId && !isUuid(opts.supplierQuoteId)) return fail(QUOTE_NOT_FOUND);
  if (opts.supplierId && !isUuid(opts.supplierId)) return fail("Dodavatel nenalezen.");
  try {
    const job = await getJob(jobId);
    if (!job) return fail(JOB_NOT_FOUND);
    const quotes = await fetchSupplierQuotes(c.db, jobId);

    let quote: SupplierQuoteView | null = null;
    if (opts.supplierQuoteId) {
      quote = quotes.find((q) => q.id === opts.supplierQuoteId) ?? null;
      if (!quote) return fail("Nabídka dodavatele nepatří k této zakázce.");
    } else {
      const selected = quotes.find((q) => q.selected);
      if (selected && (!opts.supplierId || selected.supplier?.id === opts.supplierId)) quote = selected;
      else if (opts.supplierId) quote = quotes.find((q) => q.supplier?.id === opts.supplierId) ?? null;
    }

    const supplierId = opts.supplierId ?? quote?.supplier?.id ?? (quote ? null : job.supplier?.id ?? null);
    const supplier = await fetchSupplierRef(c.db, supplierId);
    if (opts.supplierId && !supplier) return fail("Dodavatel nenalezen.");

    const draft = buildPurchaseOrderDraft({ job, quote, supplier, deliveryAddress: await ourDeliveryAddress() });
    return { ok: true, draft };
  } catch (err) {
    return fail(err);
  }
}

/** Vygeneruje PDF objednávky a uloží ho do Dokumentů zakázky (nová verze při replaceFileId) — jádro bez session. */
async function storePurchaseOrderPdf(c: Ctx, po: PurchaseOrderView, replaceFileId?: string | null): Promise<{ fileId: string } | { error: string }> {
  const res = await storePurchaseOrderPdfCore(c.db, { id: c.user.id, fullName: c.user.fullName }, po, { replaceFileId });
  if ("skipped" in res) return res.fileId ? { fileId: res.fileId } : { error: "PDF se nepodařilo zařadit do dokumentů." };
  return res;
}

/**
 * Vystaví objednávku dodavateli: číslo OV-RRRR-NNN, položky, PDF do Dokumentů zakázky,
 * do zakázky dodavatele a číslo objednávky (když chybí). Stav zakázky se NEmění —
 * vrací jen doporučení (hint / suggestStage). Provize se přepočte v DB.
 */
export async function issuePurchaseOrder(
  jobId: string,
  draft: PurchaseOrderDraftInput,
): Promise<ActionResult<{ id: string; number: string; fileId: string | null; pdfError?: string; hint?: string; suggestStage?: JobStage | null }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(JOB_NOT_FOUND);
  const valid = validatePurchaseOrderDraft(draft);
  if ("error" in valid) return fail(valid.error);
  const v = valid.value;

  try {
    const { db, user } = c;
    const job = await loadJob(db, jobId, "id, number, status, supplier_id, supplier_order_number");
    if (!job) return fail(JOB_NOT_FOUND);

    let supplierId = v.supplierId;
    let supplierCreated = false;
    if (supplierId) {
      if (!(await supplierName(db, supplierId))) return fail("Dodavatel nenalezen.");
    } else if (v.supplierName) {
      const found = await findOrCreateSupplier(c, v.supplierName);
      if ("error" in found) return fail(found.error);
      supplierId = found.id;
      supplierCreated = found.created;
    }
    const name = (await supplierName(db, supplierId)) ?? v.supplierName ?? "dodavatel";

    let quote: SupplierQuoteView | null = null;
    if (v.supplierQuoteId) {
      quote = await fetchSupplierQuote(db, v.supplierQuoteId);
      if (!quote || quote.jobId !== jobId) return fail("Nabídka dodavatele nepatří k této zakázce.");
    }

    const { data: number, error: numErr } = await db.rpc("next_purchase_order_number");
    if (numErr || !number) return fail(numErr?.message ?? "Nepodařilo se přidělit číslo objednávky.");
    const poNumber = String(number);

    const { data: created, error } = await db
      .from("purchase_orders")
      .insert({
        job_id: jobId,
        supplier_id: supplierId,
        supplier_quote_id: v.supplierQuoteId,
        number: poNumber,
        status: "vystavena",
        order_date: v.orderDate,
        required_date: v.requiredDate,
        currency: v.currency,
        total: v.total,
        delivery_terms: v.deliveryTerms,
        payment_terms: v.paymentTerms,
        delivery_address: v.deliveryAddress,
        note: v.note,
        created_by: user.id,
      } as never)
      .select("id")
      .single();
    if (error || !created) return fail(error?.message ?? "Objednávku se nepodařilo uložit.");
    const id = (created as { id: string }).id;
    const itemErr = await replaceItems(db, "purchase_order_items", "purchase_order_id", id, v.items);
    if (itemErr) {
      await db.from("purchase_orders").delete().eq("id", id);
      return fail(itemErr);
    }

    await logJobEvent(db, {
      jobId, type: "field",
      message: `Vystavena objednávka ${poNumber} dodavateli ${name}${v.requiredDate ? ` — požadovaný termín ${czDate(v.requiredDate)}` : ""}`,
      data: {
        purchaseOrderId: id, number: poNumber, supplierId, itemCount: v.items.length,
        requiredDate: v.requiredDate, supplierQuoteId: v.supplierQuoteId, ...(supplierCreated ? { supplierCreated: true } : {}),
      },
      actorId: user.id,
    });

    // kroky výroby, které objednávka pokrývá (jen kroky této zakázky, čekající / běžící, bez jiné objednávky)
    const opIds = Array.isArray(draft.operationIds) ? [...new Set(draft.operationIds.filter((x) => isUuid(x)).map((x) => x.toLowerCase()))].slice(0, 60) : [];
    if (opIds.length) {
      const { data: opsData } = await db.from("job_operations")
        .select("id, kind, title, status, purchase_order_id, supplier_id, in_house").eq("job_id", jobId).in("id", opIds);
      const okOps = ((opsData ?? []) as { id: string; kind: string; title: string | null; status: string; purchase_order_id: string | null; supplier_id: string | null; in_house: boolean }[])
        .filter((o) => ["ceka", "probiha", "problem"].includes(o.status) && !o.purchase_order_id && !o.in_house && (!o.supplier_id || o.supplier_id === supplierId));
      if (okOps.length !== opIds.length) console.error(`[purchasing] Objednávka ${poNumber}: ${opIds.length - okOps.length} kroků nešlo navázat (jiná zakázka / dodavatel / stav).`);
      for (const o of okOps) {
        const { error: linkErr } = await db.from("job_operations")
          .update({ purchase_order_id: id, po_mode: "existujici", ...(o.supplier_id ? {} : { supplier_id: supplierId }) } as never)
          .eq("id", o.id).is("purchase_order_id", null);
        if (linkErr) { console.error(`[purchasing] Navázání kroku na objednávku selhalo: ${linkErr.message}`); continue; }
        await logJobEvent(db, {
          jobId, type: "field", message: `Objednávka ${poNumber} přiřazena ke kroku ${o.title?.trim() || (isOperationKind(o.kind) ? OPERATION_KINDS[o.kind].label : "výroby")}`,
          data: { purchaseOrderId: id, operationId: o.id }, actorId: user.id, entity: "purchase_order", entityId: id,
        });
      }
    }

    // zakázka: dodavatel a číslo objednávky u dodavatele, pokud ještě nejsou
    const patch: Row = {};
    if (!job.supplier_id && supplierId) patch.supplier_id = supplierId;
    if (!cleanText(job.supplier_order_number)) patch.supplier_order_number = poNumber;
    const jobErr = await patchJob(c, jobId, job, patch, supplierId ? { [supplierId]: name } : {}, { purchaseOrderId: id });
    if (jobErr) console.error(`[purchasing] Úprava zakázky po vystavení objednávky selhala: ${jobErr}`);

    // objednávka z nabídky bez vybraného vítěze → nabídka je vítězná
    if (quote && !quote.selected) {
      const { data: sel } = await db.from("supplier_quotes").select("id").eq("job_id", jobId).eq("selected", true).limit(1);
      if (!((sel ?? []) as unknown[]).length) {
        const { error: selErr } = await db.from("supplier_quotes").update({ selected: true } as never).eq("id", quote.id);
        if (!selErr) {
          await logJobEvent(db, {
            jobId, type: "quote",
            message: `Nabídka dodavatele ${quoteLabel(quote.supplierName, quote.number)} označena jako vítězná (vystavena objednávka ${poNumber})`,
            data: { supplierQuoteId: quote.id, action: "selected", purchaseOrderId: id },
            actorId: user.id,
          });
        }
      }
    }

    await logAudit({
      action: "purchase_order_issued", entity: "purchase_orders", entityId: id,
      diff: { jobId, number: poNumber, supplierId, total: v.total, itemCount: v.items.length },
    });

    // PDF — selhání nevrací objednávku zpět (lze přegenerovat)
    let fileId: string | null = null;
    let pdfError: string | undefined;
    try {
      const po = await fetchPurchaseOrder(db, id);
      const stored = po ? await storePurchaseOrderPdf(c, po) : { error: PO_NOT_FOUND };
      if ("error" in stored) pdfError = stored.error;
      else fileId = stored.fileId;
    } catch (e) {
      pdfError = e instanceof Error ? e.message : "Generování PDF selhalo.";
    }
    if (pdfError) console.error(`[purchasing] PDF objednávky ${poNumber}: ${pdfError}`);

    const hint = isJobStage(job.status) ? issueStageHint(job.status) : null;
    revalidatePurchasing(jobId);
    return {
      ok: true, id, number: poNumber, fileId,
      ...(pdfError ? { pdfError } : {}),
      ...(hint ? { hint: hint.message, suggestStage: hint.suggestStage } : {}),
    };
  } catch (err) {
    return fail(err);
  }
}

function statusLabel(s: PurchaseOrderStatus): string {
  return PURCHASE_ORDER_STATUS_META[s]?.label ?? s;
}

/**
 * Úprava objednávky vydané: termíny, podmínky, poznámka, stav. Položky jen dokud
 * neodešla. Potvrzení → potvrzený termín do zakázky (slíbený termín dodavatele);
 * Dodána (všechny aktivní objednávky) → zakázka do stavu „Dodáno k nám".
 */
export async function updatePurchaseOrder(
  id: string,
  patch: PurchaseOrderPatch,
): Promise<ActionResult<{ hint?: string; fileId?: string | null; stage?: JobStage }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(id)) return fail(PO_NOT_FOUND);
  if (!patch || typeof patch !== "object") return fail("Chybí změny.");
  if (patch.status !== undefined && !isPurchaseOrderStatus(patch.status)) return fail("Neznámý stav objednávky.");

  try {
    const { db, user } = c;
    const po = await fetchPurchaseOrder(db, id);
    if (!po) return fail(PO_NOT_FOUND);

    const row: Row = {};
    for (const [key, col, max] of [
      ["deliveryTerms", "delivery_terms", 500], ["paymentTerms", "payment_terms", 500],
      ["deliveryAddress", "delivery_address", 1000], ["note", "note", 4000], ["supplierReference", "supplier_reference", 200],
    ] as const) {
      if (patch[key] !== undefined) row[col] = cleanText(patch[key], max);
    }
    for (const [key, col] of [["requiredDate", "required_date"], ["orderDate", "order_date"], ["confirmedDate", "confirmed_date"]] as const) {
      const val = patch[key];
      if (val === undefined) continue;
      const d = cleanDate(val);
      if (val !== "" && val !== null && !d) return fail("Neplatné datum.");
      if (col === "order_date" && !d) return fail("Datum objednávky je povinné.");
      row[col] = d;
    }
    if (patch.currency !== undefined) {
      const cur = String(patch.currency).trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(cur)) return fail("Neplatná měna.");
      row.currency = cur;
    }
    const required = "required_date" in row ? (row.required_date as string | null) : po.requiredDate;
    const orderDate = "order_date" in row ? (row.order_date as string) : po.orderDate;
    if (required && required < orderDate) return fail("Požadovaný termín dodání je před datem objednávky.");

    let newRows: PurchaseItemRowInput[] | null = null;
    let prices: { itemId: string; unitPrice: unknown }[] | null = null;
    if (patch.prices !== undefined && patch.prices !== null) {
      if (!Array.isArray(patch.prices) || patch.prices.length > 300 || patch.prices.some((p) => !p || !isUuid(p.itemId))) {
        return fail("Položka nepatří k objednávce.");
      }
      prices = patch.prices.map((p) => ({ itemId: p.itemId.toLowerCase(), unitPrice: p.unitPrice }));
    }
    if (patch.items !== undefined) {
      const items = cleanPurchaseItems(patch.items);
      if (!isPurchaseOrderEditable(po.status)) {
        // odeslaná / potvrzená / dodaná: projdou jen stejné položky se změněnou cenou (= doplnění ceny)
        const same = "rows" in items ? purchasePriceOnlyChanges(po.items, items.rows) : null;
        if (!same) return fail("Objednávka už odešla dodavateli — položky nelze měnit (jen doplnit cenu). Zruš ji a vystav novou.");
        prices = [...(prices ?? []), ...same];
      } else {
        if ("error" in items) return fail(items.error);
        newRows = items.rows;
        row.total = rowsTotal(newRows);
      }
    }
    // doplnění / oprava nákupní ceny položek — i po odeslání (provize se přepočte v DB)
    let priceChanges: { id: string; unitPrice: number | null }[] = [];
    if (prices && !newRows) {
      if (!canFillPurchasePrices(po.status)) return fail("Zrušené objednávce se ceny nedoplňují — nejdřív ji obnov.");
      const current = po.items.filter((it): it is typeof it & { id: string } => Boolean(it.id))
        .map((it) => ({ id: it.id, quantity: it.quantity, unitPrice: it.unitPrice }));
      const applied = applyPurchasePrices(current, prices);
      if ("error" in applied) return fail(applied.error);
      priceChanges = applied.changes;
      if (priceChanges.length) row.total = applied.total;
    }

    const from = po.status;
    const to = patch.status ?? from;
    if (to !== from) {
      if (!canChangePurchaseOrderStatus(from, to)) return fail(`Stav nelze změnit z „${statusLabel(from)}" na „${statusLabel(to)}".`);
      row.status = to;
      if (to === "zrusena") row.cancel_reason = cleanText(patch.cancelReason, 500);
      if (from === "zrusena") row.cancel_reason = null;
      if (to === "odeslana" && !po.sentAt) row.sent_at = new Date().toISOString();
      if (to === "potvrzena" && !("confirmed_date" in row) && !po.confirmedDate && po.requiredDate) {
        // bez zadaného termínu dodavatel potvrdil požadovaný
        row.confirmed_date = po.requiredDate;
      }
    }

    if (!Object.keys(row).length && !newRows && !priceChanges.length) return { ok: true };
    if (Object.keys(row).length) {
      const { error } = await db.from("purchase_orders").update(row as never).eq("id", id);
      if (error) return fail(error.message);
    }
    if (newRows) {
      const itemErr = await replaceItems(db, "purchase_order_items", "purchase_order_id", id, newRows);
      if (itemErr) return fail(itemErr);
    }
    for (const ch of priceChanges) {
      // cena položky → DB přepočte provizi zakázky (trigger na položkách; „čeká na nákupní cenu" zmizí)
      const { error } = await db.from("purchase_order_items").update({ unit_price: ch.unitPrice } as never).eq("id", ch.id).eq("purchase_order_id", id);
      if (error) return fail(error.message);
    }

    const supplier = po.supplier?.name ?? "dodavatel";
    const confirmed = "confirmed_date" in row ? (row.confirmed_date as string | null) : po.confirmedDate;
    const parts: string[] = [];
    if (to !== from) parts.push(`${statusLabel(from)} → ${statusLabel(to)}`);
    if ("confirmed_date" in row) parts.push(confirmed ? `potvrzený termín ${czDate(confirmed)}` : "potvrzený termín smazán");
    if ("supplier_reference" in row && row.supplier_reference) parts.push(`potvrzení č. ${row.supplier_reference as string}`);
    if ("required_date" in row) parts.push(row.required_date ? `požadovaný termín ${czDate(row.required_date as string)}` : "požadovaný termín smazán");
    if (newRows) parts.push(`položky (${newRows.length})`);
    if (priceChanges.length) {
      const filled = priceChanges.filter((c) => c.unitPrice !== null).length;
      parts.push(filled === priceChanges.length
        ? `doplněna nákupní cena (${priceChanges.length} ${priceChanges.length === 1 ? "položka" : priceChanges.length < 5 ? "položky" : "položek"})`
        : `upraveny nákupní ceny (${priceChanges.length})`);
    }
    if (to === "zrusena" && row.cancel_reason) parts.push(`důvod: ${row.cancel_reason as string}`);
    const rest = Object.keys(row).filter((k) => !["status", "sent_at", "confirmed_date", "supplier_reference", "required_date", "total", "cancel_reason"].includes(k));
    if (rest.length) parts.push("podmínky / poznámka");
    await logJobEvent(db, {
      jobId: po.jobId, type: "field",
      message: `Objednávka ${po.number} (${supplier}): ${parts.join(", ") || "upravena"}`,
      data: {
        purchaseOrderId: id, number: po.number,
        fields: [...Object.keys(row).filter((k) => k !== "total"), ...(priceChanges.length ? ["unit_price"] : [])],
        ...(to !== from ? { statusFrom: from, statusTo: to } : {}),
      },
      actorId: user.id,
    });

    // dopady do zakázky
    let hint: string | undefined;
    let stage: JobStage | undefined;
    const job = await loadJob(db, po.jobId, "id, status, supplier_promised_date");
    if (job) {
      // slíbený termín dodavatele = termín zakázky jen od objednávky posledního otevřeného kroku výroby
      // (nebo zakázky bez postupu) — mezioperace (kalírna uprostřed postupu) ho nepřepíše
      if (to === "potvrzena" && confirmed && (await promisesJobDate(db, po.jobId, id))) {
        const err = await patchJob(c, po.jobId, job, { supplier_promised_date: confirmed }, {}, { purchaseOrderId: id });
        if (err) return fail(err);
      }
    }
    // potvrzený termín později, než má začít / skončit další krok postupu → upozornit (krok se sám nehýbe)
    if ("confirmed_date" in row && confirmed) {
      const late = await nextStepAfterConfirmedHint(db, po.jobId, id, confirmed);
      if (late) hint = [hint, late].filter(Boolean).join(" ");
    }
    if (to === "dodana" && from !== "dodana") {
      const eff = await applyPurchaseDelivered(db, user.id, { id, jobId: po.jobId, number: po.number }, { markItems: true });
      if (eff.stage) stage = eff.stage;
      if (eff.hint) hint = [hint, eff.hint].filter(Boolean).join(" ");
    }

    // PDF přegenerovat, dokud objednávka neodešla a změnil se její obsah
    let fileId: string | null | undefined;
    const contentChanged = Boolean(newRows) || Object.keys(row).some((k) => !["status", "sent_at"].includes(k));
    if (po.fileId && contentChanged && isPurchaseOrderEditable(to)) {
      const fresh = await fetchPurchaseOrder(db, id);
      const stored = fresh ? await storePurchaseOrderPdf(c, fresh, po.fileId) : { error: PO_NOT_FOUND };
      if ("error" in stored) hint = [hint, `PDF se nepodařilo přegenerovat: ${stored.error}`].filter(Boolean).join(" ");
      else fileId = stored.fileId;
    }

    await logAudit({
      action: "purchase_order_updated", entity: "purchase_orders", entityId: id,
      diff: { jobId: po.jobId, number: po.number, ...row, ...(newRows ? { itemCount: newRows.length } : {}) },
    });
    revalidatePurchasing(po.jobId);
    return { ok: true, ...(hint ? { hint } : {}), ...(fileId !== undefined ? { fileId } : {}), ...(stage ? { stage } : {}) };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Převzetí zboží od dodavatele po položkách (celkové převzaté množství, volitelně uzavření
 * s menším množstvím + důvod). Převzato vše → objednávka „Dodána" a dopady do zakázky (2.7).
 * Kdo převzal zapíše DB do received_changed_by; do historie jdou jen množství, nikdy ceny.
 */
export async function setPurchaseReceived(
  id: string,
  receipts: PurchaseReceiptInput[],
  opts: { note?: string } = {},
): Promise<ActionResult<{ complete: boolean; done: number; total: number; hint?: string; stage?: JobStage }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(id)) return fail(PO_NOT_FOUND);
  if (!Array.isArray(receipts) || !receipts.length || receipts.length > 300) return fail("Zadej převzaté množství.");
  if (receipts.some((r) => !r || !isUuid(r.itemId))) return fail("Položka nepatří k této objednávce.");
  const note = cleanText(opts.note, 500);
  try {
    const { db, user } = c;
    const po = await fetchPurchaseOrder(db, id);
    if (!po) return fail(PO_NOT_FOUND);
    if (po.status === "zrusena") return fail("Zrušená objednávka se nepřebírá — nejdřív ji obnov.");
    if (po.status === "navrh") return fail("Objednávka je teprve návrh — vystav ji a pošli dodavateli.");
    const res = await receivePurchaseItems(db, id, receipts);
    if (!res.ok) return fail(res.error);
    if (res.changed) {
      const supplier = po.supplier?.name ?? "dodavatel";
      await logJobEvent(db, {
        jobId: po.jobId, type: "field",
        message: `Objednávka ${po.number} (${supplier}): převzato ${res.done}/${res.total} ${res.total === 1 ? "položky" : "položek"} — ${res.lines.join("; ")}${note ? ` — ${note}` : ""}`.slice(0, 1900),
        data: { purchaseOrderId: id, number: po.number, receipt: true, fields: ["received_quantity"] },
        actorId: user.id, entity: "purchase_order", entityId: id,
      });
    }
    let hint: string | undefined;
    let stage: JobStage | undefined;
    if (res.complete && po.status !== "dodana") {
      const up = await updatePurchaseOrder(id, { status: "dodana" });
      if (!up.ok) return fail(up.error ?? "Objednávku se nepodařilo označit jako dodanou.");
      hint = up.hint;
      stage = up.stage;
    } else if (!res.complete) {
      hint = `Převzato ${res.done}/${res.total} položek — objednávka čeká na zbytek.`;
    }
    revalidatePurchasing(po.jobId);
    return { ok: true, complete: res.complete, done: res.done, total: res.total, ...(hint ? { hint } : {}), ...(stage ? { stage } : {}) };
  } catch (err) {
    return fail(err);
  }
}

/** Nové PDF objednávky (další verze v Dokumentech zakázky). */
export async function regeneratePurchaseOrderPdf(id: string): Promise<ActionResult<{ fileId: string }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(id)) return fail(PO_NOT_FOUND);
  try {
    const po = await fetchPurchaseOrder(c.db, id);
    if (!po) return fail(PO_NOT_FOUND);
    const stored = await storePurchaseOrderPdf(c, po, po.fileId);
    if ("error" in stored) return fail(stored.error);
    revalidatePurchasing(po.jobId);
    return { ok: true, fileId: stored.fileId };
  } catch (err) {
    return fail(err);
  }
}

/** Návrh e-mailu s objednávkou: adresát z adresáře dodavatelů, předmět, zdvořilý text, podpis. */
export async function draftPurchaseOrderEmail(
  id: string,
): Promise<ActionResult<{ to: string; subject: string; body: string; attachmentName: string }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(id)) return fail(PO_NOT_FOUND);
  try {
    const po = await fetchPurchaseOrder(c.db, id);
    if (!po) return fail(PO_NOT_FOUND);
    await refreshCompanyFromSettings();
    const me = await fetchProfileContact(c.db, c.user.id);
    const mail = purchaseOrderEmail({
      number: po.number,
      companyName: COMPANY.name,
      supplierQuoteNumber: po.supplierQuote?.number,
      requiredDate: po.confirmedDate ?? po.requiredDate,
      senderName: me.name ?? c.user.fullName,
      senderEmail: me.email ?? c.user.email,
      senderPhone: me.phone ?? COMPANY.phone,
      companyWeb: COMPANY.web,
    });
    return { ok: true, to: po.supplier?.email ?? "", ...mail, attachmentName: purchaseOrderFileName(po.number) };
  } catch (err) {
    return fail(err);
  }
}

/** Odešle objednávku dodavateli e-mailem z mé schránky (PDF v příloze), stav → Odeslána. */
export async function sendPurchaseOrder(id: string, mail: PurchaseOrderMail): Promise<ActionResult<{ sent: boolean; emailId?: string }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(id)) return fail(PO_NOT_FOUND);
  if (!mail || typeof mail !== "object") return fail("Chybí e-mail.");
  try {
    const { db, user } = c;
    const po = await fetchPurchaseOrder(db, id);
    if (!po) return fail(PO_NOT_FOUND);
    // jádro: PDF v příloze, stav Odeslána, schránka odeslání; čekající řádek fronty („issue") vyřídí DB trigger
    const res = await sendPurchaseOrderCore(db, { id: user.id, fullName: user.fullName }, id, mail, { from: { ownerId: user.id }, kind: "issue" });
    if (!res.ok) return fail(res.error);
    revalidatePurchasing(po.jobId);
    revalidatePath("/sent");
    return { ok: true, sent: true, ...(res.emailId ? { emailId: res.emailId } : {}) };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Storno / pozastavení objednávek u dodavatelů (zakázka zrušená / pozastavená, E.6): odeslané a potvrzené
 * objednávky dostanou e-mail hned (z mé schránky); nevyslané se rovnou zruší; když e-mail neodejde,
 * čeká ve frontě ke schválení (řádek „cancel" / „hold" — DB ho sama nevyřídí).
 */
export async function notifySuppliers(
  jobId: string,
  input: { kind: "cancel" | "hold"; purchaseOrderIds: string[]; reason?: string; mails?: Record<string, Partial<PurchaseOrderMail>> },
): Promise<ActionResult<{ sent: string[]; queued: string[]; cancelled: string[]; errors: string[] }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(JOB_NOT_FOUND);
  if (!input || (input.kind !== "cancel" && input.kind !== "hold")) return fail("Neplatná akce.");
  const ids = Array.isArray(input.purchaseOrderIds) ? [...new Set(input.purchaseOrderIds.filter((x) => isUuid(x)).map((x) => x.toLowerCase()))] : [];
  if (!ids.length) return fail("Vyber objednávky.");
  const reason = cleanText(input.reason, 500) ?? (input.kind === "cancel" ? "Zákazník zakázku zrušil" : "Zakázka je pozastavená");
  try {
    const { db, user } = c;
    const { can } = await getAccess();
    const { data: jobRow } = await db.from("orders").select("id, owner_id").eq("id", jobId).maybeSingle();
    if (!jobRow) return fail(JOB_NOT_FOUND);
    const ownerId = (jobRow as { owner_id: string | null }).owner_id ?? null;
    const sent: string[] = [];
    const queued: string[] = [];
    const cancelled: string[] = [];
    const errors: string[] = [];
    for (const poId of ids) {
      const po = await fetchPurchaseOrder(db, poId);
      if (!po || po.jobId !== jobId) { errors.push("Objednávka nepatří k zakázce."); continue; }
      if (po.status === "zrusena" || po.status === "dodana") continue;
      if (isPurchaseOrderEditable(po.status)) {
        if (input.kind === "cancel") {
          const { error } = await db.from("purchase_orders").update({ status: "zrusena", cancel_reason: reason } as never).eq("id", poId);
          if (error) { errors.push(`${po.number}: ${error.message}`); continue; }
          await logJobEvent(db, { jobId, type: "field", message: `Objednávka ${po.number} zrušena — ${reason} (dodavateli ještě neodešla)`, data: { purchaseOrderId: poId, reason, statusFrom: po.status, statusTo: "zrusena" }, actorId: user.id, entity: "purchase_order", entityId: poId });
          cancelled.push(poId);
        }
        continue;
      }
      const sender = await purchaseOrderSender(db, { id: user.id, mailAll: can("mail_all") }, ownerId);
      const built = await purchaseOrderMailFor(db, po, sender.signerId, input.kind, { reason, fallbackName: user.fullName });
      const over = input.mails?.[poId] ?? {};
      const mail = { to: over.to ?? built.to, cc: over.cc, subject: over.subject ?? built.subject, body: over.body ?? built.body };
      const res = await sendPurchaseOrderCore(db, { id: user.id, fullName: user.fullName }, poId, mail, { from: sender.from, kind: input.kind, reason });
      if (res.ok) { sent.push(poId); continue; }
      // e-mail neodešel → fronta (cancel / hold), DB ho sama nevyřídí
      const { error: qErr } = await db.from("approval_queue").insert({
        type: "purchase_order", title: `${input.kind === "cancel" ? "Storno" : "Pozastavení"} objednávky ${po.number} — ${po.supplier?.name ?? "dodavatel"}`,
        summary: `${reason} · Odeslání selhalo: ${res.error}`.slice(0, 1000),
        payload: { kind: input.kind, purchaseOrderId: poId, number: po.number, to: mail.to, subject: mail.subject, body: mail.body, reason },
        target: mail.to || null, status: "pending", order_id: jobId, owner_id: ownerId ?? user.id, purchase_order_id: poId,
      } as never);
      if (qErr && !/duplicate|unique/i.test(qErr.message)) errors.push(`${po.number}: ${qErr.message}`);
      else queued.push(poId);
    }
    revalidatePurchasing(jobId);
    revalidatePath("/dashboard");
    return { ok: true, sent, queued, cancelled, errors };
  } catch (err) {
    return fail(err);
  }
}

// ── Obchodník zakázky (provize) ─────────────────────────────
/**
 * Přidělí zakázku obchodníkovi (orders.owner_id). Provizi dle jeho smlouvy
 * přepočte DB trigger; vrací aktuální záznam provize.
 */
export async function assignJobOwner(
  jobId: string,
  ownerId: string | null,
): Promise<ActionResult<{ commission: JobCommissionView | null }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  // #25: obchodníka zakázky (a tím komu patří provize) mění jen super admin
  if (c.user.role !== "super_admin") return fail("Obchodníka zakázky mění jen super admin.");
  if (!isUuid(jobId)) return fail(JOB_NOT_FOUND);
  if (ownerId !== null && ownerId !== "" && !isUuid(ownerId)) return fail("Uživatel nenalezen.");
  const owner = ownerId || null;
  try {
    const { db } = c;
    const job = await loadJob(db, jobId, "id, number, owner_id");
    if (!job) return fail(JOB_NOT_FOUND);
    const refs: Record<string, string> = {};
    for (const pid of [job.owner_id, owner]) {
      if (!isUuid(pid)) continue;
      const { data: p } = await db.from("profiles").select("id, full_name, email, active").eq("id", pid).maybeSingle();
      const prof = p as { id: string; full_name: string | null; email: string | null; active: boolean } | null;
      if (pid === owner && (!prof || prof.active === false)) return fail("Uživatel nenalezen nebo není aktivní.");
      if (prof) refs[prof.id] = (prof.full_name ?? "").trim() || (prof.email ?? "").trim() || prof.id;
    }

    const err = await patchJob(c, jobId, job, { owner_id: owner }, refs);
    if (err) return fail(err);
    if (job.owner_id !== owner) {
      await logAudit({ action: "job_owner_assigned", entity: "orders", entityId: jobId, diff: { from: job.owner_id ?? null, to: owner } });
    }

    const { data: comm } = await db.from("commission_entries").select("*").eq("order_id", jobId).maybeSingle();
    const row = comm as CommissionDbRow | null;
    revalidatePurchasing(jobId);
    return { ok: true, commission: row ? rowToCommissionView(row, refs[row.owner_id] ?? "") : null };
  } catch (err) {
    return fail(err);
  }
}
