import "server-only";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { fetchSupplierQuote } from "@/lib/data/purchasing";
import {
  PURCHASE_ORDER_STATUS_META, canChangePurchaseOrderStatus, cleanPurchaseItems, isItemReceived, purchaseDeliveryAdvances,
  resolveSupplierQuoteTotal, supplierQuoteInputToRow, type PurchaseItemRowInput, type StageRuleOperation,
} from "@/lib/jobs/purchasing";
import type { PurchaseReceiptInput, SupplierQuoteInput } from "@/lib/jobs/purchasing-types";
import { OPERATION_KINDS, OPERATION_STATUSES } from "@/lib/jobs/operations";
import { isForward, isJobStage } from "@/lib/jobs/stages";
import { withChangeNote } from "@/lib/supabase/actor-headers";
import type { JobStage } from "@/lib/supabase/database.types";
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

/** Posun objednávky vydané jen dopředu (potvrzena / dodana) + událost bez cen; dodaná → dopady do zakázky (2.7). */
export async function advancePurchaseOrderStatus(
  db: JobsDb,
  userId: string,
  po: PurchaseOrderRef,
  to: "potvrzena" | "dodana",
  note: string,
  extra: Row = {},
): Promise<{ ok: true; changed: boolean; stage?: JobStage; hint?: string } | { ok: false; error: string }> {
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
  if (to !== "dodana") return { ok: true, changed: true };
  const eff = await applyPurchaseDelivered(db, userId, { id: po.id, jobId: po.jobId, number: po.number }, { note, markItems: true });
  return { ok: true, changed: true, ...(eff.stage ? { stage: eff.stage } : {}), ...(eff.hint ? { hint: eff.hint } : {}) };
}

// ── Převzetí od dodavatele (2.7) ────────────────────────────
interface PoItemRow {
  id: string;
  quantity: number | string;
  received_quantity: number | string | null;
  receipt_closed: boolean | null;
  name: string | null;
  drawing_number: string | null;
  unit: string | null;
}

function n(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function plural(count: number, one: string, few: string, many: string): string {
  return count === 1 ? one : count >= 2 && count <= 4 ? few : many;
}

async function loadPoItems(db: JobsDb, poId: string): Promise<PoItemRow[]> {
  const { data } = await db
    .from("purchase_order_items")
    .select("id, quantity, received_quantity, receipt_closed, name, drawing_number, unit")
    .eq("purchase_order_id", poId)
    .order("position");
  return (data ?? []) as PoItemRow[];
}

/**
 * Zapíše převzaté množství po položkách (celkem, ne přírůstek) a případné uzavření s menším
 * množstvím. Vrací, zda je převzato vše (pak má volající objednávku posunout na „dodana").
 * Kdo převzal doplní DB (received_changed_by) z hlavičky autora.
 */
export async function receivePurchaseItems(
  db: JobsDb,
  poId: string,
  receipts: PurchaseReceiptInput[],
): Promise<{ ok: true; complete: boolean; done: number; total: number; changed: number; lines: string[] } | { ok: false; error: string }> {
  const items = await loadPoItems(db, poId);
  if (!items.length) return { ok: false, error: "Objednávka nemá položky — zapiš ji jako dodanou celou." };
  const byId = new Map(items.map((it) => [it.id, it]));
  let changed = 0;
  const lines: string[] = [];
  for (const r of receipts) {
    const it = byId.get(r.itemId);
    if (!it) return { ok: false, error: "Položka nepatří k této objednávce." };
    const qty = Number(r.received);
    if (!Number.isFinite(qty) || qty < 0 || qty > 1e9) return { ok: false, error: "Převzaté množství musí být číslo 0 a víc." };
    const close = Boolean(r.close);
    const reason = cleanText(r.closeReason, 300);
    if (close && !reason) return { ok: false, error: "U uzavření s menším množstvím napiš důvod (např. zmetky)." };
    const before = n(it.received_quantity);
    const wasClosed = Boolean(it.receipt_closed);
    if (Math.abs(before - qty) < 1e-9 && wasClosed === close) continue;
    const row: Row = { received_quantity: Math.round(qty * 1000) / 1000, receipt_closed: close, receipt_closed_reason: close ? reason : null };
    const { error } = await db.from("purchase_order_items").update(row as never).eq("id", it.id).eq("purchase_order_id", poId);
    if (error) return { ok: false, error: error.message };
    it.received_quantity = row.received_quantity as number;
    it.receipt_closed = close;
    changed += 1;
    const label = it.drawing_number || it.name || "položka";
    lines.push(`${label} ${row.received_quantity}/${n(it.quantity)} ${it.unit || "ks"}${close ? ` (uzavřeno: ${reason})` : ""}`);
  }
  const done = items.filter((it) => isItemReceived({ quantity: n(it.quantity), receivedQuantity: n(it.received_quantity), receiptClosed: Boolean(it.receipt_closed) })).length;
  return { ok: true, complete: done === items.length, done, total: items.length, changed, lines };
}

/**
 * Dopady dodané objednávky dodavateli (2.7, M6):
 *  • navázaná výrobní operace → „hotovo";
 *  • zakázka do „Dodáno k nám" jen podle purchaseDeliveryAdvances (bez operací: vše dodáno;
 *    s operacemi: hotovo vše a poslední je kooperace; materiál stav neposouvá).
 * markItems = dopsat plné množství u položek, které ještě nejsou převzaté celé (ruční „Dodáno k nám" = přišlo vše).
 * Stavovou událost zakázky zapíše DB (autor z hlavičky, poznámka z x-change-note).
 */
export async function applyPurchaseDelivered(
  db: JobsDb,
  userId: string,
  po: { id: string; jobId: string; number: string },
  opts: { note?: string; markItems?: boolean } = {},
): Promise<{ stage?: JobStage; hint?: string; operationsDone: number }> {
  if (opts.markItems) {
    const items = await loadPoItems(db, po.id);
    for (const it of items) {
      if (it.receipt_closed || n(it.received_quantity) + 1e-9 >= n(it.quantity)) continue;
      await db.from("purchase_order_items").update({ received_quantity: n(it.quantity) } as never).eq("id", it.id);
    }
  }

  const { data: opsData } = await db
    .from("job_operations")
    .select("id, position, status, in_house, purchase_order_id, kind, title")
    .eq("job_id", po.jobId)
    .order("position");
  const ops = (opsData ?? []) as { id: string; position: number; status: string; in_house: boolean; purchase_order_id: string | null; kind: string; title: string | null }[];
  let operationsDone = 0;
  for (const op of ops) {
    if (op.purchase_order_id !== po.id || op.status === "hotovo" || op.status === "preskoceno") continue;
    const { data: upd } = await db.from("job_operations").update({ status: "hotovo" } as never).eq("id", op.id).eq("status", op.status).select("id");
    if (!((upd ?? []) as unknown[]).length) continue;
    operationsDone += 1;
    const name = op.title?.trim() || OPERATION_KINDS[op.kind as keyof typeof OPERATION_KINDS]?.label || "operace";
    await logJobEvent(db, {
      jobId: po.jobId, type: "field",
      message: `Výroba: ${name} → ${OPERATION_STATUSES.hotovo.label} (objednávka ${po.number} dodána)`,
      data: { production: "status", operationId: op.id, from: op.status, to: "hotovo", purchaseOrderId: po.id, auto: true },
      actorId: userId, entity: "operation", entityId: op.id,
    });
    op.status = "hotovo";
  }

  const { data: jobData } = await db.from("orders").select("id, status").eq("id", po.jobId).maybeSingle();
  const status = (jobData as { status: string } | null)?.status;
  if (!status || !isJobStage(status)) return { operationsDone };
  if (!isForward(status, "dodano_k_nam")) {
    return { operationsDone, ...(["pozastaveno", "reklamace"].includes(status) ? { hint: "Zakázka je ve zvláštním stavu — posuň ji ručně." } : {}) };
  }
  const { data: poData } = await db.from("purchase_orders").select("id, status").eq("job_id", po.jobId);
  const orders = (poData ?? []) as { id: string; status: PurchaseOrderStatus }[];
  const rule = purchaseDeliveryAdvances({
    deliveredPoId: po.id,
    orders,
    operations: ops.map((o): StageRuleOperation => ({ id: o.id, position: o.position, status: o.status, inHouse: o.in_house, purchaseOrderId: o.purchase_order_id })),
  });
  if (rule.advance) {
    const note = opts.note?.trim() || `objednávka ${po.number} dodána`;
    const { error } = await withChangeNote(
      db.from("orders").update({ status: "dodano_k_nam" } as never).eq("id", po.jobId).eq("status", status),
      note,
    );
    if (error) return { operationsDone, hint: `Stav zakázky se nepodařilo posunout: ${error.message}` };
    return { operationsDone, stage: "dodano_k_nam", hint: "Zakázka přesunuta do stavu Dodáno k nám." };
  }
  if (rule.reason === "ceka_objednavky") {
    return { operationsDone, hint: `Čeká se ještě na ${rule.pendingOrders} ${plural(rule.pendingOrders, "objednávku", "objednávky", "objednávek")} — stav zakázky zůstává.` };
  }
  if (rule.reason === "material") return { operationsDone, hint: "Materiál převzat — stav zakázky se nemění (pokračuje výroba)." };
  return { operationsDone, hint: operationsDone ? "Kooperace hotová — výroba pokračuje dalšími operacemi." : "Stav zakázky zůstává — zbývají výrobní operace." };
}
