import "server-only";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { fetchSupplierQuote } from "@/lib/data/purchasing";
import {
  PURCHASE_ORDER_STATUS_META, canChangePurchaseOrderStatus, cleanPurchaseItems, resolveSupplierQuoteTotal,
  supplierQuoteInputToRow, type PurchaseItemRowInput,
} from "@/lib/jobs/purchasing";
import type { SupplierQuoteInput } from "@/lib/jobs/purchasing-types";
import {
  cleanText, describeChanges, diffJob, fetchPaged, fieldEventMessage, isUuid, todayIso, type JobChange,
} from "@/lib/jobs/mapping";
import { docNumbersEqual, matchParty } from "@/lib/jobs/matching";
import { composeAddress, normalizeCountry, normalizeDic, normalizeIco } from "@/lib/jobs/customers";
import { czDate } from "@/lib/pdf/types";
import type { CustomerMatchCandidate, ExtractedParty } from "@/lib/jobs/capture-types";
import type { PurchaseOrderStatus } from "@/lib/supabase/database.types";
import { COMPANY } from "@/lib/company";

/**
 * Jádra nákupu (nabídky dodavatelů, vítěz, objednávky vydané) — sdílí server actions Nákupu
 * (oprávnění „margins" hlídají ony) a dávkové focení. Oprávnění tu NEhlídá nikdo. Do historie
 * zakázky nikdy nejdou nákupní ceny.
 */

type Row = Record<string, unknown>;

export function quoteLabel(name: string, number: string | null | undefined): string {
  return `${name || "dodavatele"}${number ? ` č. ${number}` : ""}`;
}

async function supplierName(db: JobsDb, id: string | null | undefined): Promise<string | null> {
  if (!isUuid(id)) return null;
  const { data } = await db.from("suppliers").select("id, name").eq("id", id).maybeSingle();
  return (data as { name: string } | null)?.name ?? null;
}

async function replaceQuoteItems(db: JobsDb, quoteId: string, rows: PurchaseItemRowInput[]): Promise<string | null> {
  const { error: delErr } = await db.from("supplier_quote_items").delete().eq("supplier_quote_id", quoteId);
  if (delErr) return delErr.message;
  if (!rows.length) return null;
  const { error } = await db.from("supplier_quote_items").insert(rows.map((r) => ({ ...r, supplier_quote_id: quoteId })) as never);
  return error ? error.message : null;
}

/** Dodavatelé jako kandidáti párování (IČO, DIČ, název, e-mail). */
export async function loadSupplierCandidates(db: JobsDb): Promise<CustomerMatchCandidate[]> {
  const { data } = await fetchPaged<{ id: string; name: string; ico: string | null; dic: string | null; email: string | null }>(
    (from, to) => db.from("suppliers").select("id, name, ico, dic, email").order("name").order("id").range(from, to),
    20_000,
  );
  return data.map((r) => ({
    id: r.id, name: r.name, ico: r.ico ?? null, dic: r.dic ?? null, email: r.email ?? null,
    contactEmails: [], customerNumber: null, supplierNumberAtCustomer: null,
  }));
}

/** Strana dokladu je naše firma (AI zaměnila strany) — nikdy ji nezakládat jako dodavatele. */
export function isOurParty(party: Pick<ExtractedParty, "ico" | "name">): boolean {
  const digits = (v: string) => (v ?? "").replace(/\D/g, "");
  const norm = (v: string) => (v ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
  if (digits(COMPANY.ico) && digits(party.ico) === digits(COMPANY.ico)) return true;
  return Boolean(norm(party.name)) && norm(party.name) === norm(COMPANY.name);
}

/** Dodavatel podle IČO / DIČ / názvu (shoda ≥ 80), jinak se založí do adresáře. Naše firma → null. */
export async function findOrCreateSupplierByParty(
  db: JobsDb,
  party: ExtractedParty,
  candidates?: CustomerMatchCandidate[],
): Promise<{ id: string; name: string; created: boolean } | null> {
  if (isOurParty(party)) return null;
  const suppliers = candidates ?? await loadSupplierCandidates(db);
  const hit = matchParty(party, suppliers);
  if (hit && hit.score >= 80) return { id: hit.id, name: suppliers.find((s) => s.id === hit.id)?.name ?? party.name, created: false };
  if (!party.name.trim()) return null;
  const insert: Row = {
    name: party.name.trim().slice(0, 300),
    ico: normalizeIco(party.ico),
    dic: normalizeDic(party.dic),
    email: party.email.trim().toLowerCase() || null,
    phone: party.phone.trim() || null,
    contact_person: party.contactPerson.trim() || null,
    country: normalizeCountry(party.country),
    address: composeAddress(party),
  };
  const { data, error } = await db.from("suppliers").insert(insert as never).select("id, name").single();
  if (error || !data) {
    console.error(`[purchasing] Založení dodavatele selhalo: ${error?.message ?? "bez odpovědi"}`);
    return null;
  }
  return { id: (data as { id: string }).id, name: (data as { name: string }).name, created: true };
}

export interface InsertSupplierQuoteOptions {
  /** Relace focení + doklad (idempotence: opakování vrátí existující nabídku). */
  captureId?: string | null;
  captureDocId?: string | null;
  /** Bez vlastní události v historii. */
  silent?: boolean;
}

/** Založí nabídku dodavatele s položkami (při chybě položek se nabídka smaže). */
export async function insertSupplierQuote(
  db: JobsDb,
  userId: string,
  jobId: string,
  input: SupplierQuoteInput,
  opts: InsertSupplierQuoteOptions = {},
): Promise<{ ok: true; id: string; created: boolean } | { ok: false; error: string }> {
  if (!isUuid(jobId)) return { ok: false, error: "Zakázka nenalezena." };
  const conv = supplierQuoteInputToRow(input, { today: todayIso() });
  if ("error" in conv) return { ok: false, error: conv.error };
  const items = cleanPurchaseItems(input?.items, { allowEmpty: true });
  if ("error" in items) return { ok: false, error: items.error };
  const total = resolveSupplierQuoteTotal(input.total, items.rows);
  if (!items.rows.length && total === null && !opts.captureId) return { ok: false, error: "Zadej položky nebo celkovou cenu nabídky." };
  const captureId = opts.captureId && isUuid(opts.captureId) ? opts.captureId.toLowerCase() : null;
  const captureDocId = captureId ? cleanText(opts.captureDocId, 40) : null;

  const { data: job } = await db.from("orders").select("id").eq("id", jobId).maybeSingle();
  if (!job) return { ok: false, error: "Zakázka nenalezena." };
  if (captureId && captureDocId) {
    const { data: existing } = await db
      .from("supplier_quotes").select("id").eq("capture_id", captureId).eq("capture_doc_id", captureDocId).maybeSingle();
    if (existing) return { ok: true, id: (existing as { id: string }).id, created: false };
  }
  const row = conv.row;
  let name = (row.supplier_name as string | null) ?? "";
  if (row.supplier_id) {
    const found = await supplierName(db, row.supplier_id as string);
    if (!found) return { ok: false, error: "Dodavatel nenalezen." };
    name = found;
  }
  if (row.file_id) {
    const { data: f } = await db.from("job_files").select("id").eq("id", row.file_id as string).eq("job_id", jobId).maybeSingle();
    if (!f) return { ok: false, error: "Dokument nepatří k této zakázce." };
  }
  const insert: Row = { ...row, job_id: jobId, total, selected: false, created_by: userId };
  if (captureId && captureDocId) {
    insert.capture_id = captureId;
    insert.capture_doc_id = captureDocId;
  }
  const { data: created, error } = await db.from("supplier_quotes").insert(insert as never).select("id").single();
  if (error || !created) {
    if (captureId && captureDocId) {
      const { data: again } = await db
        .from("supplier_quotes").select("id").eq("capture_id", captureId).eq("capture_doc_id", captureDocId).maybeSingle();
      if (again) return { ok: true, id: (again as { id: string }).id, created: false };
    }
    return { ok: false, error: error?.message ?? "Nabídku se nepodařilo uložit." };
  }
  const id = (created as { id: string }).id;
  const itemErr = await replaceQuoteItems(db, id, items.rows);
  if (itemErr) {
    await db.from("supplier_quotes").delete().eq("id", id);
    return { ok: false, error: itemErr };
  }
  if (!opts.silent) {
    const delivery = row.delivery_date as string | null;
    await logJobEvent(db, {
      jobId, type: "quote",
      message: `Přidána nabídka dodavatele ${quoteLabel(name, row.number as string | null)}${delivery ? ` — termín dodání ${czDate(delivery)}` : ""}`,
      data: {
        supplierQuoteId: id, supplierId: row.supplier_id ?? null, number: row.number ?? null, itemCount: items.rows.length, source: row.source,
        ...(captureId ? { captureId, docId: captureDocId } : {}),
      },
      actorId: userId,
    });
  }
  return { ok: true, id, created: true };
}

async function logChanges(db: JobsDb, userId: string, jobId: string, changes: JobChange[], refs: Record<string, string>, extra: Row) {
  if (!changes.length) return;
  const views = describeChanges(changes, refs).map((v) =>
    v.sensitive ? { field: v.field, label: v.label, from: null, to: null, fromText: "", toText: "", sensitive: true } : v,
  );
  await logJobEvent(db, { jobId, type: "field", message: fieldEventMessage(views), data: { changes: views, ...extra }, actorId: userId });
}

/**
 * Vítězná nabídka dodavatele: ostatní nabídky zakázky odznačí a do zakázky propíše dodavatele
 * (když chybí), plánovaný nákup (= cena nabídky) a slíbený termín (když chybí).
 */
export async function selectWinningQuoteCore(db: JobsDb, userId: string, quoteId: string): Promise<{ ok: true; jobId: string } | { ok: false; error: string }> {
  const quote = await fetchSupplierQuote(db, quoteId);
  if (!quote) return { ok: false, error: "Nabídka dodavatele nenalezena." };
  const { data: jobData } = await db.from("orders").select("id, supplier_id, purchase_cost, supplier_promised_date").eq("id", quote.jobId).maybeSingle();
  const job = jobData as Row | null;
  if (!job) return { ok: false, error: "Zakázka nenalezena." };

  if (!quote.selected) {
    const { error: unErr } = await db
      .from("supplier_quotes").update({ selected: false } as never).eq("job_id", quote.jobId).eq("selected", true).neq("id", quoteId);
    if (unErr) return { ok: false, error: unErr.message };
    const { error } = await db.from("supplier_quotes").update({ selected: true } as never).eq("id", quoteId);
    if (error) return { ok: false, error: error.message };
    await logJobEvent(db, {
      jobId: quote.jobId, type: "quote",
      message: `Vybrána vítězná nabídka dodavatele ${quoteLabel(quote.supplierName, quote.number)}`,
      data: { supplierQuoteId: quoteId, action: "selected", supplierId: quote.supplier?.id ?? null },
      actorId: userId,
    });
  }

  const patch: Row = {};
  if (!job.supplier_id && quote.supplier) patch.supplier_id = quote.supplier.id;
  if (quote.total !== null) patch.purchase_cost = quote.total;
  if (!job.supplier_promised_date && quote.deliveryDate) patch.supplier_promised_date = quote.deliveryDate;
  const changes = diffJob(job, patch);
  if (changes.length) {
    const update: Row = {};
    for (const ch of changes) update[ch.field] = patch[ch.field];
    const { error } = await db.from("orders").update(update as never).eq("id", quote.jobId);
    if (error) return { ok: false, error: error.message };
    const refs: Record<string, string> = quote.supplier ? { [quote.supplier.id]: quote.supplier.name } : {};
    await logChanges(db, userId, quote.jobId, changes, refs, { supplierQuoteId: quoteId });
  }
  return { ok: true, jobId: quote.jobId };
}

export interface PurchaseOrderRef { id: string; jobId: string; number: string; status: PurchaseOrderStatus; fileId: string | null; supplierId: string | null }

/** Objednávka vydaná podle čísla (OV-2026-014), volitelně jen u zakázky. */
export async function findPurchaseOrderByNumber(db: JobsDb, number: string, jobId?: string | null): Promise<PurchaseOrderRef | null> {
  const n = (number ?? "").trim();
  if (!n) return null;
  let q = db.from("purchase_orders").select("id, job_id, number, status, file_id, supplier_id").not("number", "is", null).order("created_at", { ascending: false }).limit(500);
  if (jobId && isUuid(jobId)) q = q.eq("job_id", jobId);
  const { data } = await q;
  const rows = (data ?? []) as { id: string; job_id: string; number: string; status: PurchaseOrderStatus; file_id: string | null; supplier_id: string | null }[];
  const hit = rows.find((r) => docNumbersEqual(r.number, n));
  return hit ? { id: hit.id, jobId: hit.job_id, number: hit.number, status: hit.status, fileId: hit.file_id, supplierId: hit.supplier_id } : null;
}

const STATUS_RANK: Record<PurchaseOrderStatus, number> = { navrh: 0, vystavena: 1, odeslana: 2, potvrzena: 3, dodana: 4, zrusena: -1 };

/** Posun objednávky vydané jen dopředu (potvrzena / dodana) + událost bez cen. */
export async function advancePurchaseOrderStatus(
  db: JobsDb,
  userId: string,
  po: PurchaseOrderRef,
  to: "potvrzena" | "dodana",
  note: string,
  extra: Row = {},
): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
  if (STATUS_RANK[po.status] < 0 || STATUS_RANK[po.status] >= STATUS_RANK[to]) return { ok: true, changed: false };
  if (!canChangePurchaseOrderStatus(po.status, to)) return { ok: true, changed: false };
  const row: Row = { status: to };
  if (to === "potvrzena" || to === "dodana") {
    // odeslání nemuselo jít přes aplikaci
    if (po.status === "vystavena") row.sent_at = new Date().toISOString();
  }
  const { error } = await db.from("purchase_orders").update(row as never).eq("id", po.id);
  if (error) return { ok: false, error: error.message };
  const label = (s: PurchaseOrderStatus) => PURCHASE_ORDER_STATUS_META[s]?.label ?? s;
  await logJobEvent(db, {
    jobId: po.jobId, type: "field",
    message: `Objednávka ${po.number}: ${label(po.status)} → ${label(to)} (${note})`,
    data: { purchaseOrderId: po.id, number: po.number, statusFrom: po.status, statusTo: to, fields: ["status"], ...extra },
    actorId: userId,
  });
  return { ok: true, changed: true };
}
