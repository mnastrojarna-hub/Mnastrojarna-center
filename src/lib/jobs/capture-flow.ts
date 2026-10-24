import "server-only";
import { createOperatorClient } from "@/lib/supabase/server";
import { aiActor, withChangeNote } from "@/lib/supabase/actor-headers";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { stageRank, isJobStage } from "@/lib/jobs/stages";
import { advancePurchaseOrderStatus, findPurchaseOrderByNumber, receivePurchaseItems, type PurchaseOrderRef } from "@/lib/jobs/purchasing-store";
import { purchaseDeliveryAdvances, type StageRuleOperation } from "@/lib/jobs/purchasing";
import { pragueToday } from "@/lib/jobs/flow-status";
import {
  deliveryUpdates, isOrderRevision, orderChanges, orderedShare, quoteMismatch, receiptUpdates,
  type DeliveryItem, type OrderChange, type QuoteForCheck, type StoredOrder,
} from "@/lib/jobs/capture-flow-rules";
import type { ExtractedBusinessDoc, ExtractedItem, ExtractedParty } from "@/lib/jobs/capture-types";
import type { FlowProposal, JobStage, OrderMismatch, PurchaseOrderStatus } from "@/lib/supabase/database.types";
import {
  deriveHandoffKind, loadHandoffContext, productionHandoffCore, stepInputFromOperation, type HandoffActor,
} from "@/lib/jobs/production-handoff-store";
import { isStepStartable } from "@/lib/jobs/production";
import { matchParty } from "@/lib/jobs/matching";
import { cleanDate } from "@/lib/jobs/mapping";
import { shortDay } from "@/lib/jobs/production-suggest";
import type { HandoffInput, HandoffStepInput } from "@/lib/jobs/production-handoff-types";

/**
 * Foto dokladu → podrobné stavy toku a „kdo to udělal" (spec 2.8). Autor jde v hlavičce
 * klienta (x-actor-*): ručně = účet, který fotil (via foto); plná automatika = ✨ AI (capture)
 * za účet, který fotil. Stav se posouvá jen dopředu, vyplňují se jen prázdná pole, negativní
 * konce (storno) jen jako návrh. Ve zprávách událostí nikdy nejsou ceny.
 */

type Row = Record<string, unknown>;

const num = (v: unknown): number => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Kontext pro plnou automatiku: stejný uživatel, ale zápisy jako ✨ AI (capture) za jeho účet. */
export async function autoCaptureCtx<C extends { db: JobsDb; user: { id: string } }>(c: C, auto: boolean | undefined): Promise<C> {
  if (!auto) return c;
  const db = await createOperatorClient({ actor: aiActor(c.user.id, "capture", "foto") });
  return { ...c, db };
}

// ── Stav zakázky po focení ──────────────────────────────────
interface FlowRow {
  status: string;
  items_count: number;
  items_delivered: number;
  items_partial: number;
  partial_delivery_at: string | null;
}

async function flowRow(db: JobsDb, jobId: string): Promise<FlowRow | null> {
  const { data } = await db.from("orders").select("status, items_count, items_delivered, items_partial, partial_delivery_at").eq("id", jobId).maybeSingle();
  return (data as FlowRow | null) ?? null;
}

/** Evidované částečné dodání (něco dodáno, ale ne vše) — faktura ani DL pak zakázku za „Dodáno" neposune. */
export function isPartialDelivery(r: Pick<FlowRow, "status" | "items_count" | "items_delivered" | "items_partial" | "partial_delivery_at">): boolean {
  const count = num(r.items_count);
  const delivered = num(r.items_delivered);
  if (count > 0) return delivered < count && (delivered > 0 || num(r.items_partial) > 0);
  return Boolean(r.partial_delivery_at) && isJobStage(r.status) && stageRank(r.status) < stageRank("dodano_zakaznikovi");
}

/**
 * Smí focení posunout zakázku na `to`? (2.7, 2.8)
 *  • „Dodáno zákazníkovi" a dál jen bez evidovaného částečného dodání;
 *  • „Dodáno k nám" jen podle pravidla nákupu (materiál ani kooperace uprostřed postupu ne).
 */
export async function captureStageGuard(db: JobsDb, jobId: string, to: JobStage): Promise<{ ok: true } | { ok: false; warning: string }> {
  if (stageRank(to) >= stageRank("dodano_zakaznikovi")) {
    const r = await flowRow(db, jobId);
    if (r && isPartialDelivery(r) && stageRank(isJobStage(r.status) ? r.status : "poptavka") < stageRank("dodano_zakaznikovi")) {
      return { ok: false, warning: "Dodáno zatím jen částečně — stav zakázky se posune, až bude dodáno vše." };
    }
    return { ok: true };
  }
  if (to === "dodano_k_nam") {
    const [{ data: opsData }, { data: poData }] = await Promise.all([
      db.from("job_operations").select("id, position, status, in_house, purchase_order_id").eq("job_id", jobId),
      db.from("purchase_orders").select("id, status").eq("job_id", jobId),
    ]);
    const ops = ((opsData ?? []) as { id: string; position: number; status: string; in_house: boolean; purchase_order_id: string | null }[])
      .map((o): StageRuleOperation => ({ id: o.id, position: o.position, status: o.status, inHouse: o.in_house, purchaseOrderId: o.purchase_order_id }));
    const orders = (poData ?? []) as { id: string; status: PurchaseOrderStatus }[];
    if (!ops.length) {
      const pending = orders.filter((o) => o.status !== "dodana" && o.status !== "zrusena").length;
      return pending ? { ok: false, warning: `Čeká se ještě na ${pending} ${pending === 1 ? "objednávku" : pending < 5 ? "objednávky" : "objednávek"} u dodavatelů — stav zakázky zůstává.` } : { ok: true };
    }
    const delivered = orders.find((o) => o.status === "dodana");
    if (!delivered) return { ok: false, warning: "Zakázka má výrobní postup — „Dodáno k nám“ nastane po dodání kooperace na konci postupu." };
    const rule = purchaseDeliveryAdvances({ deliveredPoId: delivered.id, orders, operations: ops });
    return rule.advance ? { ok: true } : { ok: false, warning: "Stav zakázky zůstává — zbývají výrobní operace (materiál ani kooperace uprostřed postupu ho neposouvá)." };
  }
  return { ok: true };
}

// ── Objednávka zákazníka: revize, rozpor, storno ────────────
async function storedOrder(db: JobsDb, jobId: string): Promise<StoredOrder | null> {
  const [{ data: job }, { data: items }] = await Promise.all([
    db.from("orders").select("order_status, customer_order_number, customer_required_date, value").eq("id", jobId).maybeSingle(),
    db.from("order_items").select("id, drawing_number, name, quantity, revision, unit").eq("order_id", jobId).order("position"),
  ]);
  if (!job) return null;
  const j = job as Row;
  return {
    orderStatus: (j.order_status as string | null) ?? null,
    customerOrderNumber: (j.customer_order_number as string | null) ?? null,
    customerRequiredDate: (j.customer_required_date as string | null) ?? null,
    value: j.value === null || j.value === undefined ? null : num(j.value),
    items: ((items ?? []) as Row[]).map((r) => ({
      id: String(r.id), drawingNumber: (r.drawing_number as string | null) ?? null, name: (r.name as string | null) ?? null,
      quantity: num(r.quantity), revision: (r.revision as string | null) ?? null, unit: (r.unit as string | null) ?? null,
    })),
  };
}

/**
 * Je vyfocená objednávka zákazníka změnou už evidované objednávky (stejné číslo)? Pak se
 * položky NEpřepisují — vznikne revize s rozdílem (registerPhotoOrderRevision).
 */
export async function photoOrderRevision(db: JobsDb, jobId: string, docOrderNumber: string | null | undefined, doc: Pick<ExtractedBusinessDoc, "items" | "requiredDeliveryDate" | "totalWithoutVat">): Promise<{ revision: boolean; changes: OrderChange[] }> {
  const job = await storedOrder(db, jobId);
  if (!job || !isOrderRevision(job, docOrderNumber)) return { revision: false, changes: [] };
  return { revision: true, changes: orderChanges(doc, job) };
}

/** Nová revize objednávky z fotky (RPC flow_register_order_change; potvrzená → Aktualizovaná). */
export async function registerPhotoOrderRevision(
  db: JobsDb, jobId: string,
  input: { changes: OrderChange[]; fileId?: string | null; customerOrderNumber?: string | null; documentNumber?: string | null },
): Promise<{ ok: true; revision: number | null } | { ok: false; error: string }> {
  if (!input.changes.length) return { ok: true, revision: null };
  const note = `Změna objednávky z vyfoceného dokladu${input.documentNumber ? ` ${input.documentNumber}` : ""}`;
  const rpc = db.rpc("flow_register_order_change", {
    p_job: jobId, p_note: note, p_file: input.fileId ?? null, p_changes: input.changes,
    p_customer_order_number: input.customerOrderNumber ?? null,
  });
  const { data, error } = await withChangeNote(rpc, note);
  if (error) return { ok: false, error: error.message };
  return { ok: true, revision: Number(data) || null };
}

/**
 * AI kontrola objednávky proti přijaté / odeslané nabídce (součet ±1 %, množství, položky,
 * termín vs. dodací lhůta). Rozdíl → objednávka „Rozpor s nabídkou" (jen z „Doručená").
 */
export async function checkPhotoOrderMismatch(
  db: JobsDb, jobId: string, doc: Pick<ExtractedBusinessDoc, "items" | "totalWithoutVat" | "requiredDeliveryDate" | "documentDate">,
): Promise<{ mismatch: OrderMismatch["items"] | null; hint: string | null }> {
  const { data: job } = await db.from("orders").select("order_status").eq("id", jobId).maybeSingle();
  if ((job as Row | null)?.order_status !== "dorucena") return { mismatch: null, hint: null };
  const { data: qs } = await db.from("quotes").select("id, number, status, revision, archived, total, lead_time_days")
    .eq("job_id", jobId).in("status", ["prijato", "odeslano"]).order("revision", { ascending: false });
  const quotes = (qs ?? []) as Row[];
  const q = quotes.find((x) => x.status === "prijato") ?? quotes.find((x) => !x.archived) ?? null;
  if (!q) return { mismatch: null, hint: null };
  const { data: qi } = await db.from("quote_items").select("drawing_number, name, quantity").eq("quote_id", q.id as string).order("position");
  const quote: QuoteForCheck = {
    number: String(q.number ?? ""),
    total: q.total === null || q.total === undefined ? null : num(q.total),
    leadTimeDays: q.lead_time_days === null || q.lead_time_days === undefined ? null : num(q.lead_time_days),
    items: ((qi ?? []) as Row[]).map((r) => ({ drawingNumber: (r.drawing_number as string | null) ?? null, name: (r.name as string | null) ?? null, quantity: num(r.quantity) })),
  };
  const items = quoteMismatch(doc, quote, pragueToday());
  if (!items.length) return { mismatch: null, hint: null };
  const value: OrderMismatch = { items, source: "ai", detected_at: new Date().toISOString(), fix_requested_at: null, resolved: null };
  const note = `AI porovnala objednávku s nabídkou ${quote.number}`;
  const upd = db.from("orders").update({ order_status: "rozpor", order_mismatch: value } as never).eq("id", jobId).eq("order_status", "dorucena");
  const { error } = await withChangeNote(upd, note);
  if (error) return { mismatch: null, hint: null };
  const share = orderedShare(items, quote.items.length);
  return { mismatch: items, hint: `Objednávka se liší od nabídky ${quote.number} (${items.length} ${items.length === 1 ? "rozdíl" : items.length < 5 ? "rozdíly" : "rozdílů"})${share ? ` · ${share}` : ""} — vyřeš rozpor.` };
}

/** Návrh změny od AI z fotky (např. storno) — rozhodne člověk s právem (1.9). Existující návrh se nepřepíše. */
export async function proposeFromCapture(db: JobsDb, jobId: string, proposal: Omit<FlowProposal, "kind" | "agent">): Promise<boolean> {
  const value: FlowProposal = { ...proposal, kind: "ai", agent: "capture" };
  const { data } = await db.from("orders").update({ flow_proposal: value } as never).eq("id", jobId).is("flow_proposal", null).select("id");
  return Boolean((data ?? []).length);
}

// ── Naše doklady: nabídka odeslána, potvrzení odesláno ──────
/** Vyfocená naše nabídka = odeslaná (sent_via foto); DB posune zakázku na „Nabídka". */
export async function markQuoteSentByPhoto(db: JobsDb, quoteId: string, date?: string | null): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
  const sentAt = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00Z`).toISOString() : new Date().toISOString();
  const upd = db.from("quotes").update({ status: "odeslano", sent_at: sentAt, sent_via: "foto" } as never)
    .eq("id", quoteId).in("status", ["navrh_ai", "ke_schvaleni"]);
  const { data, error } = await withChangeNote(upd, "podle vyfocené nabídky").select("id");
  if (error) return { ok: false, error: /schválení/.test(error.message) ? "Nabídka čeká na schválení — jako odeslanou ji označ až po schválení." : error.message };
  return { ok: true, changed: Boolean((data ?? []).length) };
}

/**
 * Vyfocené NAŠE potvrzení objednávky = potvrzení odesláno (via foto, revize = aktuální).
 * Doručená / v rozporu → Potvrzená; aktualizovaná → změna potvrzena (RPC) a pak odesláno.
 */
export async function confirmOrderByPhoto(db: JobsDb, jobId: string): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
  const { data } = await db.from("orders").select("order_status, order_revision, order_mismatch").eq("id", jobId).maybeSingle();
  const job = data as Row | null;
  if (!job) return { ok: false, error: "Zakázka nenalezena." };
  const status = (job.order_status as string | null) ?? null;
  if (!status || status === "stornovana") return { ok: true, changed: false };
  const note = "podle vyfoceného potvrzení objednávky";
  if (status === "aktualizovana") {
    const { error } = await withChangeNote(db.rpc("flow_decide_order_change", { p_job: jobId, p_accept: true, p_note: note }), note);
    if (error) return { ok: false, error: error.message };
  }
  const now = new Date().toISOString();
  const patch: Row = {
    confirmation_sent_at: now, confirmation_sent_via: "foto", confirmation_sent_revision: Math.max(1, num(job.order_revision)),
  };
  if (status === "dorucena" || status === "rozpor") {
    patch.order_status = "potvrzena";
    const prev = job.order_mismatch as OrderMismatch | null;
    if (status === "rozpor" && prev) patch.order_mismatch = { ...prev, resolved: { decision: "prijato_jak_je", at: now, by: null } };
  }
  const { error } = await withChangeNote(db.from("orders").update(patch as never).eq("id", jobId), note);
  if (error) return { ok: false, error: error.message };
  return { ok: true, changed: true };
}

// ── Dodání zákazníkovi z našeho DL ──────────────────────────
/**
 * Náš dodací list → dodané množství po položkách (+ z dokladu, max. objednané). DB přepočte
 * agregáty a při 100 % posune zakázku na „Dodáno zákazníkovi". Událost bez cen.
 */
export async function recordPhotoDelivery(
  db: JobsDb, userId: string, jobId: string, docItems: ExtractedItem[], opts: { documentNumber?: string | null; extra?: Row } = {},
): Promise<{ recorded: number; lines: string[]; unmatched: string[]; complete: boolean; partial: boolean }> {
  const { data } = await db.from("order_items").select("id, drawing_number, name, quantity, delivered_quantity, delivery_closed, unit").eq("order_id", jobId).order("position");
  const items: DeliveryItem[] = ((data ?? []) as Row[]).map((r) => ({
    id: String(r.id), drawingNumber: (r.drawing_number as string | null) ?? null, name: (r.name as string | null) ?? null,
    quantity: num(r.quantity), deliveredQuantity: num(r.delivered_quantity), deliveryClosed: Boolean(r.delivery_closed), unit: (r.unit as string | null) ?? null,
  }));
  const empty = { recorded: 0, lines: [], unmatched: [], complete: false, partial: false };
  if (!items.length || !docItems.length) return empty;
  const { updates, unmatched } = deliveryUpdates(docItems, items);
  const note = `podle vyfoceného dodacího listu${opts.documentNumber ? ` ${opts.documentNumber}` : ""}`;
  const lines: string[] = [];
  for (const u of updates) {
    const upd = db.from("order_items").update({ delivered_quantity: u.delivered } as never).eq("id", u.itemId).eq("order_id", jobId);
    const { error } = await withChangeNote(upd, note);
    if (error) continue;
    const it = items.find((x) => x.id === u.itemId)!;
    it.deliveredQuantity = u.delivered;
    lines.push(`${u.label} ${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 3 }).format(u.delivered)}/${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 3 }).format(it.quantity)} ${u.unit}`);
  }
  const done = items.filter((it) => it.deliveryClosed || it.deliveredQuantity + 1e-9 >= it.quantity).length;
  const any = items.some((it) => it.deliveredQuantity > 0);
  if (lines.length) {
    await logJobEvent(db, {
      jobId, type: "field",
      message: `Dodáno (${note}): ${lines.join("; ")} · ${done} z ${items.length} ${items.length === 1 ? "položky" : "položek"}`.slice(0, 1900),
      data: { delivery: true, items: updates.map((u) => ({ itemId: u.itemId, from: u.before, to: u.delivered })), ...(opts.extra ?? {}) },
      actorId: userId, entity: "delivery",
    });
  }
  return { recorded: lines.length, lines, unmatched, complete: done === items.length, partial: any && done < items.length };
}

// ── Převzetí od dodavatele z DL dodavatele ──────────────────
/**
 * DL dodavatele → převzaté množství po položkách objednávky (párování podle čísla výkresu);
 * převzato vše → objednávka Dodána a dopady do zakázky podle 2.7 (advancePurchaseOrderStatus).
 * DL bez položek / bez protějšků = dodáno celé (jako dnes).
 */
export async function receiveSupplierDlByPhoto(
  db: JobsDb, userId: string, po: PurchaseOrderRef, docItems: ExtractedItem[], extra: Row = {},
): Promise<{ ok: true; summary: string | null; stage?: JobStage; hint?: string } | { ok: false; error: string }> {
  if (po.status === "zrusena" || po.status === "dodana" || po.status === "navrh") return { ok: true, summary: null };
  const { data } = await db.from("purchase_order_items").select("id, drawing_number, name, quantity, received_quantity, receipt_closed").eq("purchase_order_id", po.id).order("position");
  const items = ((data ?? []) as Row[]).map((r) => ({
    id: String(r.id), drawingNumber: (r.drawing_number as string | null) ?? null, name: (r.name as string | null) ?? null,
    quantity: num(r.quantity), receivedQuantity: num(r.received_quantity), receiptClosed: Boolean(r.receipt_closed),
  }));
  const updates = items.length && docItems.length ? receiptUpdates(docItems, items) : [];
  if (!updates.length) {
    const r = await advancePurchaseOrderStatus(db, userId, po, "dodana", "podle vyfoceného dodacího listu", extra);
    if (!r.ok) return r;
    return { ok: true, summary: r.changed ? `objednávka ${po.number} → dodaná` : null, ...(r.stage ? { stage: r.stage } : {}), ...(r.hint ? { hint: r.hint } : {}) };
  }
  const res = await receivePurchaseItems(db, po.id, updates.map((u) => ({ itemId: u.itemId, received: u.received })));
  if (!res.ok) return res;
  if (res.changed) {
    await logJobEvent(db, {
      jobId: po.jobId, type: "field",
      message: `Objednávka ${po.number}: převzato ${res.done}/${res.total} ${res.total === 1 ? "položky" : "položek"} podle vyfoceného dodacího listu — ${res.lines.join("; ")}`.slice(0, 1900),
      data: { purchaseOrderId: po.id, number: po.number, receipt: true, fields: ["received_quantity"], ...extra },
      actorId: userId, entity: "purchase_order", entityId: po.id,
    });
  }
  if (!res.complete) return { ok: true, summary: `objednávka ${po.number}: převzato ${res.done}/${res.total} položek`, hint: "Od dodavatele přišla jen část — objednávka čeká na zbytek." };
  const r = await advancePurchaseOrderStatus(db, userId, po, "dodana", "podle vyfoceného dodacího listu", extra);
  if (!r.ok) return r;
  return { ok: true, summary: `objednávka ${po.number} → dodaná`, ...(r.stage ? { stage: r.stage } : {}), ...(r.hint ? { hint: r.hint } : {}) };
}

// ── Potvrzení dodavatele → předání do výroby (B.4) ──────────
/** Co z vyfoceného dokladu předání potřebuje (potvrzení dodavatele k naší objednávce). */
export interface CaptureHandoffDoc {
  /** Naše číslo objednávky (OV-…) na potvrzení dodavatele. */
  customerOrderNumber?: string | null;
  /** Termín, který dodavatel potvrdil. */
  promisedDeliveryDate?: string | null;
  documentNumber?: string | null;
  supplier?: ExtractedParty | null;
}

export const CAPTURE_HANDOFF_WAITING = "Zakázka čeká na předání do výroby — chybí kdo nebo termín.";

/** Kdo předává z focení: účet, který fotil (plná automatika = ✨ AI za něj — autora nese klient db). */
export function captureHandoffActor(
  c: { user: { id: string; fullName: string; role?: string }; margins: boolean; access?: { can: (f: "mail_all") => boolean } },
  auto?: boolean,
): HandoffActor {
  const mailAll = c.access ? c.access.can("mail_all") : c.user.role === "super_admin";
  return { id: c.user.id, fullName: c.user.fullName, margins: c.margins, mailAll, via: auto ? "ai" : "foto" };
}

const OPEN_PO_STATUSES: PurchaseOrderStatus[] = ["navrh", "vystavena", "odeslana", "potvrzena"];

/**
 * Focení / e-mail chce zakázku „Ve výrobě" (potvrzení dodavatele) — nikdy přímý zápis stavu, vždy přes
 * předání do výroby (kdo + termín, RPC production_apply):
 *  1. plán připravený (běžící krok, nebo první čekající spustitelný) → předání bez nových kroků;
 *  2. potvrzení s naším číslem objednávky (OV-…) → krok té objednávky (nebo nový „Výroba"), kdo = dodavatel
 *     objednávky, termín = potvrzený, objednávka se použije (žádná druhá);
 *  3. bez čísla, ale zakázka má otevřenou objednávku stejného dodavatele → jako 2;
 *  4. nic nesedí → jen při kontrole člověkem („Uložit" = souhlas): krok u dodavatele z dokladu, „objednáno
 *     mimo systém" — AI NIKDY nevystaví objednávku; v plné automatice → 5;
 *  5. jinak stav zůstává + upozornění „Zakázka čeká na předání do výroby".
 */
export async function captureProductionHandoff(
  db: JobsDb,
  actor: HandoffActor,
  jobId: string,
  doc: CaptureHandoffDoc | null,
  consent: "review" | "auto",
): Promise<{ moved: boolean; stage?: JobStage; warning?: string; note?: string }> {
  const ctx = await loadHandoffContext(db, jobId);
  if (!ctx) return { moved: false, warning: "Zakázka nenalezena." };
  if (ctx.job.status === "ve_vyrobe") return { moved: false };
  const derived = deriveHandoffKind(ctx.job.status, ctx.ops);
  if ("error" in derived) return { moved: false, warning: `${derived.error} Stav zakázky zůstává.` };
  if (derived.kind !== "predani") return { moved: false };

  const live = ctx.ops.filter((o) => o.status !== "preskoceno");
  const running = live.find((o) => o.status === "probiha" || o.status === "problem") ?? null;
  const firstWaiting = live.find((o) => o.status === "ceka") ?? null;
  const date = cleanDate(doc?.promisedDeliveryDate ?? null);
  let steps: HandoffStepInput[] | null = null;
  let who: string | null = null;
  let due: string | null = null;

  // 2 + 3: naše objednávka podle čísla, jinak otevřená objednávka téhož dodavatele
  let po = doc?.customerOrderNumber ? await findPurchaseOrderByNumber(db, doc.customerOrderNumber, jobId) : null;
  if (po && (po.status === "zrusena" || po.jobId !== jobId)) po = null;
  let ctxPo = po ? ctx.purchaseOrders.find((p) => p.id === po!.id) ?? null : null;
  if (!ctxPo && !po && doc?.supplier && (doc.supplier.name.trim() || doc.supplier.ico.trim())) {
    const open = ctx.purchaseOrders.filter((p) => OPEN_PO_STATUSES.includes(p.status) && p.supplierId);
    const cands = open.map((p) => {
      const s = ctx.suppliers.get(p.supplierId as string);
      return { id: p.id, name: s?.name ?? p.supplierName, ico: s?.ico ?? null, dic: null, email: s?.email ?? null, contactEmails: [], customerNumber: null, supplierNumberAtCustomer: null };
    });
    const hit = cands.length ? matchParty(doc.supplier, cands) : null;
    if (hit && hit.score >= 80) ctxPo = open.find((p) => p.id === hit.id) ?? null;
  }

  // připravený krok spustí focení jen bez nové objednávky: u nás, „objednáno jinak", nebo s platnou objednávkou
  // (krok se zrušenou objednávkou / „objedná se při předání" by vystavil novou — to AI nikdy nedělá, B.4)
  const waitingPo = firstWaiting?.purchaseOrderId && firstWaiting.purchaseOrder && firstWaiting.purchaseOrder.status !== "zrusena"
    ? firstWaiting.purchaseOrderId : null;
  const waitingSafe = Boolean(firstWaiting && (firstWaiting.inHouse || firstWaiting.poMode === "neobjednavat" || waitingPo));
  if (running) {
    steps = [];                                                     // 1: krok už běží
  } else if (firstWaiting && waitingSafe && isStepStartable(firstWaiting) && (!ctxPo || firstWaiting.purchaseOrderId === ctxPo.id)) {
    steps = [stepInputFromOperation(firstWaiting, {                 // 1: připravený plán
      start: true,
      po: firstWaiting.inHouse ? { mode: null }
        : waitingPo ? { mode: "existujici", existingId: waitingPo }
          : { mode: "neobjednavat", noneReason: firstWaiting.poNoneReason ?? "Objednáno jinak" },
    })];
    who = firstWaiting.location;
    due = firstWaiting.plannedEnd;
  } else if (ctxPo && OPEN_PO_STATUSES.includes(ctxPo.status)) {
    const end = date ?? ctxPo.confirmedDate ?? ctxPo.requiredDate;
    const linkedOp = live.find((o) => o.status === "ceka" && o.purchaseOrderId === ctxPo!.id) ?? null;
    const supplierWho = ctxPo.supplierId ? { type: "supplier" as const, id: ctxPo.supplierId, name: ctxPo.supplierName } : null;
    if (end && supplierWho) {
      const over: Partial<HandoffStepInput> = {
        start: true, who: supplierWho, plannedEnd: end, deadlineSource: date ? "potvrzeni_dodavatele" : linkedOp?.deadlineSource ?? "potvrzeni_dodavatele",
        whoSource: "objednavka", po: { mode: "existujici", existingId: ctxPo.id },
      };
      steps = linkedOp ? [stepInputFromOperation(linkedOp, over)] : [{
        kind: "vyroba", who: supplierWho, plannedEnd: end, endsAtCustomerDate: false, deadlineAgreed: false,
        deadlineSource: "potvrzeni_dodavatele", whoSource: "objednavka", start: true, po: { mode: "existujici", existingId: ctxPo.id },
      }];
      who = ctxPo.supplierName;
      due = end;
    }
  } else if (consent === "review" && doc?.supplier && doc.supplier.name.trim() && date) {
    // 4: nic nesedí — jen se souhlasem člověka (AI objednávku nevystavuje)
    const cands = [...ctx.suppliers.values()].map((s) => ({ id: s.id, name: s.name, ico: s.ico, dic: null, email: s.email, contactEmails: [], customerNumber: null, supplierNumberAtCustomer: null }));
    const hit = cands.length ? matchParty(doc.supplier, cands) : null;
    const sup = hit && hit.score >= 80 ? ctx.suppliers.get(hit.id) ?? null : null;
    steps = [{
      kind: "vyroba", who: sup ? { type: "supplier", id: sup.id, name: sup.name } : { type: "free", name: doc.supplier.name.trim().slice(0, 300) },
      plannedEnd: date, endsAtCustomerDate: false, deadlineAgreed: false, deadlineSource: "potvrzeni_dodavatele", whoSource: "ai", start: !firstWaiting,
      po: { mode: "neobjednavat", noneReason: `Objednáno mimo systém — potvrzení dodavatele${doc.documentNumber ? ` ${doc.documentNumber}` : ""}`.slice(0, 500) },
    }];
    who = sup?.name ?? doc.supplier.name.trim();
    due = date;
  }
  if (!steps) return { moved: false, warning: CAPTURE_HANDOFF_WAITING };

  const input: HandoffInput = {
    token: crypto.randomUUID(), kind: "predani", expectedStage: ctx.job.status, expectedRouteVersion: ctx.routeVersion,
    steps, acceptLate: true, note: "podle vyfoceného potvrzení dodavatele",
  };
  const res = await productionHandoffCore(db, actor, jobId, input, { source: "capture", ctx });
  if (!res.ok) return { moved: false, warning: `${CAPTURE_HANDOFF_WAITING} (${res.error})` };
  return {
    moved: res.result.stage === "ve_vyrobe", stage: res.result.stage,
    note: who || due ? `Předáno do výroby: ${[who, due ? `do ${shortDay(due)}` : null].filter(Boolean).join(" · ")}` : "Předáno do výroby",
  };
}
