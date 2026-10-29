import "server-only";
import { randomUUID } from "node:crypto";
import { logAudit } from "@/lib/audit";
import { describeSender, isSmtpConfigured, pickSmtpMailbox, type SmtpPreference } from "@/lib/email/send";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { OPERATION_KINDS, isOperationKind, type DeadlineState, type OperationKind } from "@/lib/jobs/operations";
import { cleanDate, cleanNumber, cleanText, fetchPaged, isUuid, one, personRef, todayIso } from "@/lib/jobs/mapping";
import { pragueToday } from "@/lib/jobs/flow-status";
import { CLOSED_STAGES, isJobStage, stageRank } from "@/lib/jobs/stages";
import {
  OPERATION_SELECT, hasWho, insertPositions, rowToJobOperation, sortOperations, stepLabel, type JobOperationDbRow,
} from "@/lib/jobs/production";
import type { JobOperation } from "@/lib/jobs/production-types";
import {
  autoSendBlockers, deadlineStateFor, groupPurchaseOrders, handoffErrorCode, performerRole, routeHealth, stepHasWho, stepSummaryText,
  validateHandoff, canSubmitHandoff, type HandoffValidationStep,
} from "@/lib/jobs/production-handoff";
import {
  familyScopeOf, normalizeDrawingNumber, operationFamily, operationKindsOfSupplier, purchaseItemsForStep, quoteKinds, quoteValue,
  scopeItemsOf, shortDay, stepPurchaseOrderNote, suggestRoute, suggestStepDeadline, suggestWhoForStep,
  type RouteStepSuggestion, type SuggestHistory, type SuggestItem, type SuggestOpenPurchaseOrder, type SuggestQuote,
} from "@/lib/jobs/production-suggest";
import type {
  ApplyPurchaseItem, ApplyPurchaseOrder, ApplyStep, DeadlineSource, HandoffErrorCode, HandoffInput, HandoffIssue, HandoffKind,
  HandoffPlan, HandoffResult, HandoffStepInput, PhoneQuoteInput, ProductionApplyPayload, ProductionApplyResult, StepPlan, StepWho, WhoSource, WhoSuggestion,
} from "@/lib/jobs/production-handoff-types";
import { HANDOFF_KINDS } from "@/lib/jobs/production-handoff-types";
import { DEFAULT_PAYMENT_TERMS, addWorkingDays, deliveryTermsFor, isPurchaseOrderEditable, r2, splitItemNote, supplierNoteSegment } from "@/lib/jobs/purchasing";
import { fetchPurchaseOrder, fetchPurchaseOrders, fetchSupplierQuotes } from "@/lib/data/purchasing";
import { findOrCreateSupplierByParty, insertSupplierQuote, loadSupplierCandidates } from "@/lib/jobs/purchasing-store";
import { emptyParty } from "@/lib/jobs/extracted-normalize";
import { matchParty } from "@/lib/jobs/matching";
import {
  hasPriceRole, ourDeliveryAddressCore, purchaseOrderContactId, purchaseOrderMailFor, sendPurchaseOrderCore, storePurchaseOrderPdfCore,
  type PoMailKind,
} from "@/lib/jobs/purchase-order-docs";
import { withChangeNote, type ActorVia } from "@/lib/supabase/actor-headers";
import type { AutomationMode, JobStage, MailboxConfig, PurchaseOrderStatus } from "@/lib/supabase/database.types";
import type { PurchaseOrderView } from "@/lib/jobs/purchasing-types";

/**
 * Předání do výroby — serverové jádro (bez session; sdílí akce, focení dokladů a automatiku Nákupu).
 * Spec production-handoff-design.md §F.3, §E (objednávky), §C.7, §B.4.
 *  • loadHandoffContext   — zakázka, díly, kroky, nabídky dodavatelů, objednávky, adresář, historie;
 *  • buildHandoffPlan     — předvyplněný plán dialogu (kdo / do kdy / objednávka), ceny jen s „margins";
 *  • buildApplyPayload    — vstup dialogu → payload RPC production_apply (ceny objednávek POUZE ze serveru);
 *  • productionHandoffCore — RPC (atomicky, idempotentně) → po potvrzení PDF objednávek, e-mail ve frontě,
 *    odeslání podle režimu automatiky (výchozí „se schválením"), audit; opakování nikdy neodesílá;
 *  • ensureHandoffDocumentsCore — doplní chybějící PDF a řádky fronty (nikdy neodesílá);
 *  • sendQueuedPurchaseOrder — „Odeslat" (zabere řádek fronty, odešle, při chybě vrátí);
 *  • syncStepPurchaseOrder — změna dodavatele / termínu kroku s objednávkou (E.5).
 * Oprávnění hlídá volající (akce). Do historie zakázky nikdy nejdou ceny.
 */

type Row = Record<string, unknown>;

export type HandoffActor = { id: string | null; fullName: string; margins: boolean; mailAll: boolean; via: ActorVia };

const OPEN_PO: PurchaseOrderStatus[] = ["navrh", "vystavena", "odeslana", "potvrzena"];
const RUNNING = new Set(["probiha", "problem"]);

// ── Kontext ─────────────────────────────────────────────────
export interface CtxSupplier {
  id: string; name: string; email: string | null; address: string | null; technologies: string[];
  leadDays: number | null; rating: number | null; ico: string | null;
}

export interface CtxPurchaseOrder {
  id: string; number: string; status: PurchaseOrderStatus; supplierId: string | null; supplierName: string;
  supplierEmail: string | null; supplierQuoteId: string | null; requiredDate: string | null; confirmedDate: string | null;
  handoffId: string | null; fileId: string | null; revision: number; linked: boolean;
  items: { id: string; label: string; quantity: number; received: number; unit: string; unitPrice: number | null }[];
}

export interface HandoffContext {
  job: {
    id: string; number: string; title: string; status: JobStage; currency: string; dueDate: string | null;
    customerRequiredDate: string | null; maxToleratedDate: string | null; ownerId: string | null; customerName: string | null;
  };
  items: SuggestItem[];
  ops: JobOperation[];
  quotes: SuggestQuote[];
  purchaseOrders: CtxPurchaseOrder[];
  suppliers: Map<string, CtxSupplier>;
  history: SuggestHistory;
  routeVersion: string;
  pendingCapturedQuotes: number;
  /** Poslední nevrácené předání (kind predani) — pro „Vrátit předání do výroby". */
  lastPredani: { id: string; createdBy: string | null; createdAt: string } | null;
  today: string;
}

function num(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

async function loadHistory(db: JobsDb, jobId: string, items: SuggestItem[]): Promise<Pick<SuggestHistory, "drawings" | "operations">> {
  const out: Pick<SuggestHistory, "drawings" | "operations"> = { drawings: [], operations: [] };
  try {
    const raw = [...new Set(items.map((i) => (i.drawingNumber ?? "").trim()).filter(Boolean))].slice(0, 50);
    const norms = new Set(items.map((i) => normalizeDrawingNumber(i.drawingNumber)).filter((x): x is string => Boolean(x)));
    if (raw.length) {
      const since = new Date(Date.now() - 730 * 86_400_000).toISOString().slice(0, 10);
      const { data } = await db.from("purchase_order_items")
        .select("drawing_number, unit_price, po:purchase_orders!purchase_order_id(id, job_id, number, status, order_date, supplier_id, supplier:suppliers!supplier_id(id, name))")
        .in("drawing_number", raw).order("created_at", { ascending: false }).limit(40);
      for (const r of (data ?? []) as Row[]) {
        const po = one(r.po as Row | Row[] | null);
        if (!po || po.job_id === jobId || po.status === "zrusena" || String(po.order_date ?? "") < since) continue;
        if (!norms.has(normalizeDrawingNumber(r.drawing_number as string) ?? "")) continue;
        const sup = one(po.supplier as Row | Row[] | null);
        out.drawings!.push({
          drawingNumber: String(r.drawing_number ?? ""), supplierId: (po.supplier_id as string | null) ?? null,
          supplierName: String(sup?.name ?? ""), poNumber: String(po.number ?? ""), orderDate: String(po.order_date ?? ""),
          unitPrice: r.unit_price === null || r.unit_price === undefined ? null : num(r.unit_price), kind: null,
        });
        if (out.drawings!.length >= 20) break;
      }
    }
    const mats = new Set(items.flatMap((i) => [i.materialDesignation, i.material, i.materialGroup]).map((x) => (x ?? "").trim().toLowerCase()).filter(Boolean));
    if (mats.size) {
      const { data: opsData } = await db.from("job_operations")
        .select("kind, in_house, supplier_id, supplier_name, job_id, updated_at, supplier:suppliers!supplier_id(id, name), job:orders!job_id(number)")
        .neq("job_id", jobId).in("status", ["hotovo", "probiha"]).order("updated_at", { ascending: false }).limit(60);
      const list = (opsData ?? []) as Row[];
      const jobIds = [...new Set(list.map((o) => String(o.job_id)))];
      const matByJob = new Map<string, string | null>();
      if (jobIds.length) {
        const { data: its } = await db.from("order_items").select("order_id, material, material_designation, material_group").in("order_id", jobIds);
        for (const it of (its ?? []) as Row[]) {
          for (const m of [it.material_designation, it.material, it.material_group]) {
            const s = String(m ?? "").trim();
            if (s && mats.has(s.toLowerCase()) && !matByJob.has(String(it.order_id))) matByJob.set(String(it.order_id), s);
          }
        }
      }
      for (const o of list) {
        if (!isOperationKind(o.kind) || !matByJob.has(String(o.job_id))) continue;
        const sup = one(o.supplier as Row | Row[] | null);
        out.operations!.push({
          kind: o.kind, inHouse: Boolean(o.in_house), supplierId: (o.supplier_id as string | null) ?? null,
          supplierName: (sup?.name as string | undefined) ?? ((o.supplier_name as string | null) ?? null),
          jobNumber: String(one(o.job as Row | Row[] | null)?.number ?? ""), material: matByJob.get(String(o.job_id)) ?? null,
        });
      }
    }
  } catch (err) {
    console.error(`[handoff] Historie dodavatelů se nenačetla: ${err instanceof Error ? err.message : String(err)}`);
  }
  return out;
}

/** Vše, co předání potřebuje (servisní klient; práva hlídá volající). null = zakázka neexistuje. */
export async function loadHandoffContext(db: JobsDb, jobId: string): Promise<HandoffContext | null> {
  if (!isUuid(jobId)) return null;
  const [jobRes, itemsRes, opsRes, quotes, kindsRes, poRes, routeRes, pendingRes, handoffRes] = await Promise.all([
    db.from("orders").select("id, number, title, status, currency, due_date, customer_required_date, max_tolerated_date, owner_id, customer:customers!customer_id(name)").eq("id", jobId).maybeSingle(),
    db.from("order_items").select("id, position, drawing_number, revision, name, description, material, material_group, material_designation, quantity, unit, weight_kg, heat_treatment, surface_treatment, hardness, purchase_unit_price, supplier_note").eq("order_id", jobId).order("position"),
    db.from("job_operations").select(OPERATION_SELECT).eq("job_id", jobId).order("position").order("created_at"),
    fetchSupplierQuotes(db, jobId),
    db.from("supplier_quotes").select("id, operation_kinds").eq("job_id", jobId),
    db.from("purchase_orders").select("id, number, status, supplier_id, supplier_quote_id, required_date, confirmed_date, handoff_id, file_id, revision, supplier:suppliers!supplier_id(id, name, email), items:purchase_order_items!purchase_order_id(id, position, drawing_number, name, quantity, received_quantity, unit, unit_price)").eq("job_id", jobId).order("created_at"),
    db.rpc("production_route_version", { p_job: jobId }),
    db.from("job_files").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("archived", false).eq("ai_extracted->>purchasingPending", "true"),
    db.from("production_handoffs").select("id, kind, created_by, created_at, undone_at").eq("job_id", jobId).order("created_at", { ascending: false }).limit(50),
  ]);
  const j = jobRes.data as Row | null;
  if (!j) return null;
  const today = pragueToday();

  const { data: supData } = await fetchPaged<Row>(
    (from, to) => db.from("suppliers").select("id, name, email, address, technologies, lead_days, rating, ico").order("name").order("id").range(from, to),
    5000,
  );
  const suppliers = new Map<string, CtxSupplier>();
  for (const s of supData) {
    suppliers.set(String(s.id), {
      id: String(s.id), name: String(s.name ?? ""), email: cleanText(s.email, 300), address: cleanText(s.address, 1000),
      technologies: Array.isArray(s.technologies) ? (s.technologies as string[]) : [], leadDays: cleanNumber(s.lead_days),
      rating: cleanNumber(s.rating), ico: cleanText(s.ico, 20),
    });
  }

  const items: SuggestItem[] = ((itemsRes.data ?? []) as Row[]).map((r) => ({
    id: String(r.id), drawingNumber: cleanText(r.drawing_number, 120), name: cleanText(r.name, 500), description: cleanText(r.description, 1000),
    material: cleanText(r.material, 200), materialGroup: cleanText(r.material_group, 120), materialDesignation: cleanText(r.material_designation, 200),
    quantity: num(r.quantity) || 1, unit: cleanText(r.unit, 20) ?? "ks", weightKg: cleanNumber(r.weight_kg),
    heatTreatment: cleanText(r.heat_treatment, 500), surfaceTreatment: cleanText(r.surface_treatment, 500), hardness: cleanText(r.hardness, 200),
    purchaseUnitPrice: cleanNumber(r.purchase_unit_price), supplierNote: cleanText(r.supplier_note, 1000),
  }));
  const ops = sortOperations(((opsRes.data ?? []) as unknown as JobOperationDbRow[]).map((r) => rowToJobOperation(r, today)));
  const kinds = new Map(((kindsRes.data ?? []) as { id: string; operation_kinds: string[] | null }[]).map((r) => [r.id, r.operation_kinds]));
  const suggestQuotes: SuggestQuote[] = quotes.map((q) => {
    const sup = q.supplier ? suppliers.get(q.supplier.id) : undefined;
    return {
      id: q.id, supplierId: q.supplier?.id ?? null, supplierName: q.supplierName, number: q.number, quoteDate: q.quoteDate,
      validUntil: q.validUntil, leadTimeDays: q.leadTimeDays, deliveryDate: q.deliveryDate, currency: q.currency || "CZK",
      total: q.total, selected: q.selected, selectedBy: q.selectedStamp?.by?.name ?? q.selectedStamp?.byName ?? null,
      selectedAt: q.selectedStamp?.at ?? null, note: q.note, operationKinds: kinds.get(q.id) ?? null,
      items: q.items.map((it) => ({ drawingNumber: it.drawingNumber, name: it.name, quantity: it.quantity, unit: it.unit, unitPrice: it.unitPrice, note: it.note })),
      supplierTechnologies: sup?.technologies ?? null, supplierRating: sup?.rating ?? null, supplierLeadDays: sup?.leadDays ?? null,
      supplierEmail: sup?.email ?? q.supplier?.email ?? null,
    };
  });
  const linkedPo = new Set(ops.map((o) => o.purchaseOrderId).filter((x): x is string => Boolean(x)));
  const purchaseOrders: CtxPurchaseOrder[] = ((poRes.data ?? []) as Row[]).map((p) => {
    const sup = one(p.supplier as Row | Row[] | null);
    const its = ((p.items ?? []) as Row[]).sort((a, b) => num(a.position) - num(b.position));
    return {
      id: String(p.id), number: String(p.number ?? "—"), status: p.status as PurchaseOrderStatus,
      supplierId: (p.supplier_id as string | null) ?? null, supplierName: String(sup?.name ?? "dodavatel"),
      supplierEmail: cleanText(sup?.email, 300), supplierQuoteId: (p.supplier_quote_id as string | null) ?? null,
      requiredDate: cleanDate(p.required_date), confirmedDate: cleanDate(p.confirmed_date), handoffId: (p.handoff_id as string | null) ?? null,
      fileId: (p.file_id as string | null) ?? null, revision: num(p.revision) || 1, linked: linkedPo.has(String(p.id)),
      items: its.map((it) => ({
        id: String(it.id), label: String(it.drawing_number || it.name || "položka"), quantity: num(it.quantity),
        received: num(it.received_quantity), unit: String(it.unit || "ks"),
        unitPrice: it.unit_price === null || it.unit_price === undefined ? null : num(it.unit_price),
      })),
    };
  });
  const hist = await loadHistory(db, jobId, items);
  const handoffs = (handoffRes.data ?? []) as { id: string; kind: string; created_by: string | null; created_at: string; undone_at: string | null }[];
  const last = handoffs.find((h) => h.kind === "predani" && !h.undone_at) ?? null;
  return {
    job: {
      id: String(j.id), number: String(j.number ?? ""), title: String(j.title ?? ""), status: (isJobStage(j.status) ? j.status : "poptavka") as JobStage,
      currency: String(j.currency || "CZK"), dueDate: cleanDate(j.due_date), customerRequiredDate: cleanDate(j.customer_required_date),
      maxToleratedDate: cleanDate(j.max_tolerated_date), ownerId: (j.owner_id as string | null) ?? null,
      customerName: (one(j.customer as Row | Row[] | null)?.name as string | undefined) ?? null,
    },
    items,
    ops,
    quotes: suggestQuotes,
    purchaseOrders,
    suppliers,
    history: { ...hist, suppliers: [...suppliers.values()].filter((s) => s.technologies.length).map((s) => ({ id: s.id, name: s.name, technologies: s.technologies, leadDays: s.leadDays, rating: s.rating })) },
    routeVersion: String(routeRes.data ?? ""),
    pendingCapturedQuotes: pendingRes.count ?? 0,
    lastPredani: last ? { id: last.id, createdBy: last.created_by, createdAt: last.created_at } : null,
    today,
  };
}

// ── Druh předání ────────────────────────────────────────────
/** Druh předání z faktů (spec F.2): bez zadání → predani / doplneni / dalsi_krok; chyba = česká hláška + kód. */
export function deriveHandoffKind(stage: JobStage, ops: Pick<JobOperation, "status" | "inHouse" | "supplier" | "supplierName" | "plannedEnd">[]):
  { kind: HandoffKind } | { error: string; code: HandoffErrorCode } {
  if (CLOSED_STAGES.includes(stage)) return { error: "Uzavřenou zakázku nelze předat do výroby — nejdřív ji obnov.", code: "STAGE_CHANGED" };
  const rank = stageRank(stage);
  if (rank >= 0 && rank <= 2) return { error: "Zákazník ještě neobjednal — nejdřív zapiš objednávku zákazníka.", code: "NO_CUSTOMER_ORDER" };
  if (stage !== "ve_vyrobe") return { kind: "predani" };
  const open = ops.filter((o) => o.status === "ceka" || RUNNING.has(o.status));
  const cur = open.find((o) => RUNNING.has(o.status)) ?? open[0];
  if (!cur || !hasWho(cur) || !cleanDate(cur.plannedEnd)) return { kind: "doplneni" };
  return { kind: "dalsi_krok" };
}

// ── Pomocníci kroků ─────────────────────────────────────────
function whoOfOp(op: Pick<JobOperation, "inHouse" | "supplier" | "supplierName">): StepWho {
  if (op.inHouse) return { type: "u_nas" };
  if (op.supplier) return { type: "supplier", id: op.supplier.id, name: op.supplier.name };
  const n = (op.supplierName ?? "").trim();
  return n ? { type: "free", name: n } : { type: "none" };
}

function whoName(w: StepWho): string | null {
  if (w.type === "supplier") return (w.name ?? "").trim() || null;
  if (w.type === "free") return w.name.trim() || null;
  if (w.type === "u_nas") return "U nás";
  return null;
}

function stepKeyOf(s: HandoffStepInput, i: number): string {
  const k = (s as { key?: unknown }).key;
  return typeof k === "string" && k.trim() ? k.trim().slice(0, 80) : s.operationId ? `op:${s.operationId}` : `s${i + 1}`;
}

function isSupplierWho(w: StepWho): boolean {
  return w.type === "supplier" || w.type === "free";
}

/** Krok teď vystavuje NOVOU objednávku (server rozhoduje stejně jako validace). */
function ordersNewNow(s: HandoffStepInput, kind: HandoffKind): boolean {
  if (!isSupplierWho(s.who) || kind === "zaznam" || kind === "zpet" || kind === "ukonceni") return false;
  const mode = s.po?.mode ?? null;
  if (mode === "vystavit") return kind !== "plan" || Boolean(s.po.orderNow);
  if (mode === "pri_predani") return Boolean(s.start || s.po.orderNow);
  return false;
}

function quoteFor(ctx: HandoffContext, id: string | null | undefined): SuggestQuote | null {
  return id ? ctx.quotes.find((q) => q.id === id) ?? null : null;
}

/**
 * Nabídky, které už spotřeboval jiný krok nebo objednávka zakázky (id nabídky → „krok 1 (Výroba 1)" /
 * „objednávka OV-…"). Druhá objednávka podle stejné nabídky by cenu (náklady, marži, provizi) započítala
 * dvakrát — Výroba → Tepelné zpracování → Výroba u stejné firmy = druhé obrábění podle nové nabídky.
 * Nepočítá se krok `selfOpId`, jeho vlastní objednávka, objednávky z `keepPoIds` (krok je použije),
 * kroky se stejnou objednávkou (souvislé kroky jedné firmy) ani otevřená objednávka bez kroku (z Nákupu —
 * krok ji použije, nevystaví druhou).
 */
export function usedQuotesOf(ctx: Pick<HandoffContext, "ops" | "purchaseOrders">, opts: { selfOpId?: string | null; keepPoIds?: (string | null | undefined)[] } = {}): Record<string, string> {
  const out: Record<string, string> = {};
  const live = sortOperations(ctx.ops.filter((o) => o.status !== "preskoceno"));
  const self = opts.selfOpId ? ctx.ops.find((o) => o.id === opts.selfOpId) ?? null : null;
  const keep = new Set((opts.keepPoIds ?? []).filter((x): x is string => Boolean(x)));
  if (self?.purchaseOrderId) keep.add(self.purchaseOrderId);
  const name = (o: JobOperation) => `krok ${live.findIndex((x) => x.id === o.id) + 1} (${stepLabel(o, live)})`;
  for (const o of live) {
    if (o.id === opts.selfOpId || !o.supplierQuoteId) continue;
    if (o.purchaseOrderId && keep.has(o.purchaseOrderId)) continue;
    const po = o.purchaseOrderId ? ctx.purchaseOrders.find((p) => p.id === o.purchaseOrderId) ?? null : null;
    if (po?.status === "zrusena") continue;
    out[o.supplierQuoteId] ??= name(o);
  }
  for (const p of ctx.purchaseOrders) {
    if (p.status === "zrusena" || !p.supplierQuoteId || keep.has(p.id) || out[p.supplierQuoteId]) continue;
    if (OPEN_PO.includes(p.status) && !p.linked) continue;
    const op = live.find((o) => o.purchaseOrderId === p.id);
    out[p.supplierQuoteId] = op ? name(op) : `objednávka ${p.number}`;
  }
  return out;
}

/** Nabídka už je na jiné (nezrušené) objednávce zakázky — nová objednávka podle ní se nenacení (cena by byla dvakrát). */
export function quoteOnOtherPurchaseOrder(ctx: Pick<HandoffContext, "purchaseOrders">, quoteId: string | null | undefined, exceptPoId?: string | null): boolean {
  if (!quoteId) return false;
  return ctx.purchaseOrders.some((p) => p.status !== "zrusena" && p.supplierQuoteId === quoteId && p.id !== exceptPoId);
}

function sameSupplierQuote(q: SuggestQuote, who: StepWho): boolean {
  if (who.type === "supplier") return q.supplierId ? q.supplierId === who.id : false;
  if (who.type === "free") return !q.supplierId && q.supplierName.trim().toLowerCase() === who.name.trim().toLowerCase();
  return false;
}

function routeLabels(steps: { id: string; kind: OperationKind; title?: string | null; status?: JobOperation["status"]; position: number }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of steps) out.set(s.id, stepLabel(s, steps));
  return out;
}

// ── Plán dialogu ────────────────────────────────────────────
export interface PlanOptions {
  kind?: HandoffKind;
  operationId?: string;
  existingPurchaseOrderId?: string;
  target?: JobStage;
  margins: boolean;
  mailAll: boolean;
  actorId: string | null;
  today?: string;
  automationMode: AutomationMode;
  /** Kterou schránkou se bude posílat (null = žádná použitelná). */
  senderEmail?: string | null;
  /** Jiný postup z porovnání („Použít: kompletně u Hrubý") — klíč z plan.routes. */
  route?: string;
}

function openPoSuggestions(ctx: HandoffContext): SuggestOpenPurchaseOrder[] {
  return ctx.purchaseOrders.filter((p) => OPEN_PO.includes(p.status) && !p.linked).map((p) => {
    const q = quoteFor(ctx, p.supplierQuoteId);
    const sup = p.supplierId ? ctx.suppliers.get(p.supplierId) : undefined;
    const kinds = q ? quoteKinds(q).kinds : operationKindsOfSupplier(sup?.technologies ?? []);
    return {
      id: p.id, number: p.number, status: p.status, supplierId: p.supplierId, supplierName: p.supplierName,
      supplierQuoteId: p.supplierQuoteId, requiredDate: p.requiredDate, confirmedDate: p.confirmedDate, kinds,
    };
  });
}

interface DraftStep {
  key: string;
  operationId: string | null;
  status: JobOperation["status"] | null;
  kind: OperationKind;
  title: string | null;
  orderItemIds: string[] | null;
  who: StepWho;
  whoSource: WhoSource | null;
  supplierQuoteId: string | null;
  plannedEnd: string | null;
  deadlineSource: DeadlineSource | null;
  deadlineCaption: string | null;
  endsAtCustomerDate: boolean;
  existingPoId: string | null;
  note: string | null;
  suggestions: { primary: WhoSuggestion | null; alternatives: WhoSuggestion[] };
  done?: boolean;
}

function finalDateOf(ctx: HandoffContext): { date: string | null; source: "due_date" | "customer_required_date" | null } {
  if (ctx.job.dueDate) return { date: ctx.job.dueDate, source: "due_date" };
  if (ctx.job.customerRequiredDate) return { date: ctx.job.customerRequiredDate, source: "customer_required_date" };
  return { date: null, source: null };
}

/**
 * Předvyplněný plán předání (spec F.1 HandoffPlan): kroky, kdo (nejlevnější nabídka primárně, existující
 * objednávka se použije), termín (z nabídky / lhůty / konečného termínu), objednávka (náhled, blokace),
 * kontrola. Bez práva „margins" žádné částky.
 */
export function buildHandoffPlan(ctx: HandoffContext, opts: PlanOptions): HandoffPlan {
  const today = opts.today ?? ctx.today;
  const derived = deriveHandoffKind(ctx.job.status, ctx.ops);
  const kind: HandoffKind = opts.kind ?? ("kind" in derived ? derived.kind : "plan");
  const margins = opts.margins;
  const live = ctx.ops.filter((o) => o.status !== "preskoceno");
  const running = live.find((o) => RUNNING.has(o.status)) ?? null;
  const waiting = live.filter((o) => o.status === "ceka");
  const fin = finalDateOf(ctx);
  const openPos = openPoSuggestions(ctx);
  const rankCtx = { items: ctx.items, currency: ctx.job.currency, today };

  const suggestFor = (kindOf: OperationKind, orderItemIds: string[] | null, plannedWho: StepWho | null, onlyStep: boolean, neighbours: (string | null)[],
    usedQuotes: Record<string, string> = {}) =>
    suggestWhoForStep({
      step: { kind: kindOf, orderItemIds, plannedWho, onlyStep },
      quotes: ctx.quotes, openPurchaseOrders: openPos, history: ctx.history,
      ctx: { ...rankCtx, neighbourSupplierIds: neighbours }, canSeePrices: margins, usedQuotes,
    });

  // 1) kroky dialogu
  let routeSource: HandoffPlan["routeSource"] = "planovane";
  let routes: HandoffPlan["routes"] = [];
  let routeChips: string[] = [];
  const bases: { key: string; op: JobOperation | null; route: RouteStepSuggestion | null; done?: boolean }[] = [];
  const pickOp = opts.operationId ? live.find((o) => o.id === opts.operationId) ?? null : null;
  if (kind === "doplneni") {
    const cur = pickOp ?? running ?? waiting[0] ?? null;
    if (cur) bases.push({ key: `op:${cur.id}`, op: cur, route: null });
    else bases.push({ key: "s1", op: null, route: { kind: "vyroba", orderItemIds: null, note: null, supplierQuoteId: null, who: { type: "none" } } });
  } else if (kind === "dalsi_krok") {
    const after = running ? live.filter((o) => o.status === "ceka" && (o.position > running.position || (o.position === running.position && o.createdAt > running.createdAt))) : waiting;
    const next = pickOp && pickOp.status === "ceka" ? pickOp : after[0] ?? null;
    if (next) bases.push({ key: `op:${next.id}`, op: next, route: null });
  } else if (kind === "predani" || kind === "plan" || kind === "zaznam") {
    const rework = kind === "predani" && stageRank(ctx.job.status) >= 6;
    if (rework) {
      const lastDone = [...live].reverse().find((o) => o.status === "hotovo") ?? null;
      routeSource = "planovane";
      bases.push({
        key: "s1", op: null, route: {
          kind: "vyroba", orderItemIds: null, note: null, supplierQuoteId: null,
          who: lastDone ? whoOfOp(lastDone) : { type: "none" },
        },
      });
    } else if (waiting.length) {
      for (const o of waiting) bases.push({ key: `op:${o.id}`, op: o, route: null, done: kind === "zaznam" });
    } else {
      const sr = suggestRoute({
        items: ctx.items, quotes: ctx.quotes, currency: ctx.job.currency, today, canSeePrices: margins,
      });
      routeSource = sr.source;
      routeChips = sr.chips;
      // uživatel zvolil jiný postup z porovnání → jeho kroky (a označený jako vybraný)
      const picked = opts.route ? sr.routes.find((r) => r.key === opts.route) ?? null : null;
      routes = sr.routes.map((r) => ({
        key: r.key, label: r.label, total: margins ? r.total : null, complete: r.complete, selected: picked ? r.key === picked.key : r.selected,
      }));
      const chosen = picked?.steps ?? sr.steps;
      const list = kind === "zaznam" ? chosen.slice(0, 1) : chosen;
      list.forEach((r, i) => bases.push({ key: `s${i + 1}`, op: null, route: r, done: kind === "zaznam" }));
    }
  }

  // 2) kdo, termín, objednávka
  const drafts: DraftStep[] = [];
  let prevEnd: string | null = running?.plannedEnd ?? null;
  let prevWho: StepWho | null = running ? whoOfOp(running) : null;
  let prevConfirmed = Boolean(running && running.deadlineState === "potvrzeno");
  const usedPo = new Set<string>();
  const inDialog = new Set(bases.map((b) => b.op?.id).filter((x): x is string => Boolean(x)));
  const before = live.filter((o) => (o.status === "hotovo" || RUNNING.has(o.status)) && !inDialog.has(o.id)).length;
  bases.forEach((b, i) => {
    const kindOf = b.op?.kind ?? b.route?.kind ?? "vyroba";
    let orderItemIds = b.op ? b.op.orderItemIds ?? null : b.route?.orderItemIds ?? null;
    // krok ze šablony („Výroba → tepelné zpracování → výroba") nemá díly: kalírna / povrch jen díly s úpravou na výkresu
    if (!orderItemIds && (!b.op || b.op.status === "ceka")) orderItemIds = familyScopeOf(kindOf, ctx.items);
    const opWho = b.op ? whoOfOp(b.op) : (b.route?.who ?? { type: "none" } as StepWho);
    // nabídky spotřebované jiným krokem / objednávkou zakázky nebo dřívějším krokem dialogu — znovu se necení
    const used = usedQuotesOf(ctx, { selfOpId: b.op?.id ?? null, keepPoIds: [i === 0 ? opts.existingPurchaseOrderId : null] });
    drafts.forEach((d, j) => {
      if (d.supplierQuoteId && !used[d.supplierQuoteId]) used[d.supplierQuoteId] = `krok ${before + j + 1} (${OPERATION_KINDS[d.kind].label})`;
    });
    const sug = suggestFor(kindOf, orderItemIds, stepHasWho(opWho) ? opWho : null, bases.length === 1 && live.length <= 1,
      [prevWho?.type === "supplier" ? prevWho.id : null], used);
    let who = opWho;
    let whoSource: WhoSource | null = b.op?.whoSource ?? null;
    let quoteId: string | null = b.op?.supplierQuoteId ?? b.route?.supplierQuoteId ?? null;
    if (quoteId && used[quoteId]) {
      // krok nesl nabídku, kterou už má jiná objednávka (např. „Výroba 2" naplánovaná s nabídkou Výroby 1)
      quoteId = null;
      if (whoSource === "nejlevnejsi_nabidka" || whoSource === "nabidka") whoSource = "posledni_operace";
    }
    let existingPoId: string | null = b.op?.purchaseOrderId && b.op.purchaseOrder?.status !== "zrusena" ? b.op.purchaseOrderId : null;
    // předané existující objednávka (z dialogu vystavení v Nákupu) — první krok
    if (i === 0 && opts.existingPurchaseOrderId) {
      const po = ctx.purchaseOrders.find((p) => p.id === opts.existingPurchaseOrderId && OPEN_PO.includes(p.status));
      if (po) {
        existingPoId = po.id;
        who = po.supplierId ? { type: "supplier", id: po.supplierId, name: po.supplierName } : { type: "free", name: po.supplierName };
        whoSource = "objednavka";
        quoteId = po.supplierQuoteId;
      }
    }
    const primary = sug.primary;
    if (!stepHasWho(who) && primary && stepHasWho(primary.who)) {
      who = primary.who;
      whoSource = primary.source;
      quoteId = primary.supplierQuoteId ?? quoteId;
      if (primary.purchaseOrder && !usedPo.has(primary.purchaseOrder.id)) existingPoId = primary.purchaseOrder.id;
    } else if (stepHasWho(who) && !whoSource && b.route?.supplierQuoteId && quoteId) {
      whoSource = primary && primary.source === "nejlevnejsi_nabidka" && primary.supplierQuoteId === b.route.supplierQuoteId ? "nejlevnejsi_nabidka" : "nabidka";
    }
    // vystavená objednávka téže firmy (z Nákupu) se použije — nevystaví se druhá
    if (!existingPoId && stepHasWho(who) && primary?.source === "objednavka" && primary.purchaseOrder
      && primary.who.type === who.type && whoName(primary.who) === whoName(who) && !usedPo.has(primary.purchaseOrder.id)) {
      existingPoId = primary.purchaseOrder.id;
      whoSource = "objednavka";
      quoteId = primary.supplierQuoteId ?? quoteId;
    }
    // firma je daná (šablona, plán), ale bez nabídky: nejlepší nabídka téže firmy ke kroku (a „nejlevnější", když jí je)
    if (!existingPoId && who.type === "supplier" && !quoteFor(ctx, quoteId)) {
      const all = [sug.primary, ...sug.alternatives].filter((s): s is WhoSuggestion => Boolean(s));
      const same = all.find((s) => s.supplierQuoteId && s.who.type === "supplier" && s.who.id === who.id) ?? null;
      if (same) {
        quoteId = same.supplierQuoteId;
        const best = sug.primary?.source === "nejlevnejsi_nabidka" ? sug.primary : sug.alternatives.find((a) => a.source === "nejlevnejsi_nabidka") ?? null;
        if (best && best.supplierQuoteId === same.supplierQuoteId) whoSource = "nejlevnejsi_nabidka";
        else if (!whoSource) whoSource = "nabidka";
      }
    }
    if (existingPoId) usedPo.add(existingPoId);
    const quote = quoteFor(ctx, quoteId);
    const isLast = i === bases.length - 1 && (kind !== "dalsi_krok" || !live.some((o) => o.status === "ceka" && o.id !== b.op?.id && o.position > (b.op?.position ?? -1)));
    const sup = who.type === "supplier" ? ctx.suppliers.get(who.id) : undefined;
    let plannedEnd = cleanDate(b.op?.plannedEnd);
    let deadlineSource: DeadlineSource | null = b.op?.deadlineSource ?? null;
    let caption: string | null = plannedEnd ? (deadlineSource === "rucne" ? "zadáno ručně" : null) : null;
    if (kind === "zaznam") {
      plannedEnd = today;
      deadlineSource = "rucne";
      caption = "hotovo dne";
    } else {
      const changedHands = Boolean(prevWho && whoName(prevWho) !== whoName(who));
      // předchozí krok se posunul (dodavatel potvrdil později): čekající krok nesmí skončit dřív, než díl dorazí
      const minEnd = prevEnd ? (changedHands ? addWorkingDays(prevEnd, 1) : prevEnd) : null;
      const impossible = Boolean(plannedEnd && minEnd && plannedEnd < minEnd && b.op?.status === "ceka" && (i > 0 || running));
      if (!plannedEnd || impossible || (plannedEnd < today && !(b.op && RUNNING.has(b.op.status)))) {
        const d = suggestStepDeadline({
          today, previousEnd: prevEnd, performerChanged: changedHands,
          quote: quote && sameSupplierQuote(quote, who) ? { deliveryDate: quote.deliveryDate, leadTimeDays: quote.leadTimeDays } : null,
          supplierLeadDays: sup?.leadDays ?? null, isLast, finalDate: fin.date, inHouse: who.type === "u_nas",
        });
        plannedEnd = d.date;
        deadlineSource = d.source;
        caption = impossible && prevEnd
          ? `posunuto — předchozí krok ${prevConfirmed ? "potvrzen na" : "končí"} ${shortDay(prevEnd)} · ${d.caption}`
          : d.caption;
      }
    }
    drafts.push({
      key: b.key, operationId: b.op?.id ?? null, status: b.op?.status ?? null, kind: kindOf, title: b.op?.title ?? null,
      orderItemIds, who, whoSource, supplierQuoteId: quote && sameSupplierQuote(quote, who) ? quote.id : null,
      plannedEnd, deadlineSource, deadlineCaption: caption, endsAtCustomerDate: Boolean(b.op?.endsAtCustomerDate),
      existingPoId, note: b.op?.note ?? b.route?.note ?? null, suggestions: { primary: sug.primary, alternatives: sug.alternatives },
      done: b.done,
    });
    prevEnd = plannedEnd;
    prevWho = who;
    prevConfirmed = deadlineSource === "potvrzeni_dodavatele";
  });

  // 3) kroky plánu (vstup dialogu + náhled objednávky)
  // doplnění bez běžícího kroku (po „Přesunout bez dodavatele a termínu"): jeden dialog = kdo, termín,
  // objednávka i spuštění prvního kroku (jako předání) — ne „připraveno" a další dialog „Předat do kroku…"
  const doplneniStarts = kind === "doplneni" && !running && Boolean(drafts[0])
    && (!drafts[0].operationId || drafts[0].operationId === waiting[0]?.id);
  const startIdx = (kind === "predani" && !running) || kind === "dalsi_krok" || doplneniStarts ? 0 : -1;
  const finalRoute = [
    ...live.filter((o) => !drafts.some((d) => d.operationId === o.id)).map((o) => ({ id: o.id, kind: o.kind, title: o.title, status: o.status, position: o.position, createdAt: o.createdAt })),
    ...drafts.map((d, i) => {
      const op = d.operationId ? live.find((o) => o.id === d.operationId) : null;
      return { id: d.operationId ?? d.key, kind: d.kind, title: d.title, status: op?.status ?? ("ceka" as const), position: op?.position ?? 1000 + i, createdAt: op?.createdAt ?? "" };
    }),
  ];
  const labels = routeLabels(sortOperations(finalRoute));
  const senderUsable = Boolean(opts.senderEmail);
  const steps: StepPlan[] = drafts.map((d, i) => {
    const supplierStep = isSupplierWho(d.who);
    const existing = d.existingPoId ? ctx.purchaseOrders.find((p) => p.id === d.existingPoId) ?? null : null;
    const startNow = i === startIdx && (kind === "predani" || kind === "dalsi_krok" || kind === "doplneni") && (!d.status || d.status === "ceka");
    let poMode: StepPlan["po"]["mode"] = null;
    if (d.who.type === "u_nas") poMode = null;
    else if (kind === "zaznam") poMode = existing ? "existujici" : "neobjednavat";
    else if (existing) poMode = "existujici";
    else if (d.status && RUNNING.has(d.status)) poMode = "vystavit";
    else if (startNow) poMode = "vystavit";
    else poMode = "pri_predani";
    const q0 = quoteFor(ctx, d.supplierQuoteId);
    const coverage0 = q0 ? quoteValue(q0, scopeItemsOf(ctx.items, d.orderItemIds), ctx.items).coverage : null;
    const input: HandoffStepInput = {
      operationId: d.operationId, kind: d.kind, title: d.title, who: d.who, plannedEnd: d.plannedEnd,
      endsAtCustomerDate: d.endsAtCustomerDate, deadlineAgreed: false, deadlineSource: d.deadlineSource ?? undefined,
      whoSource: d.whoSource ?? undefined, supplierQuoteId: d.supplierQuoteId, orderItemIds: d.orderItemIds,
      start: startNow || undefined, done: d.done || undefined,
      po: {
        mode: poMode, existingId: existing?.id ?? null,
        noneReason: poMode === "neobjednavat" ? "Zapsáno zpětně" : null,
        // nabídka pokrývá jen část dílů: výchozí „Objednat i zbylé díly … bez ceny, dodavatel je nacení" (D.5)
        ...(coverage0 && coverage0.uncovered.length ? { includeUncovered: true } : {}),
      },
      note: d.note,
    };
    const ordersNow = ordersNewNow(input, kind);
    let poPreview: StepPlan["poPreview"] = null;
    if (supplierStep && (ordersNow || existing)) {
      const q = q0;
      const built = existing ? null : purchaseItemsForStep({
        step: { kind: d.kind, orderItemIds: d.orderItemIds }, items: ctx.items, quote: q, includeUncovered: input.po.includeUncovered ?? true,
        singleStepRoute: live.length + drafts.filter((x) => !x.operationId).length <= 1,
      });
      const best = d.suggestions.primary?.source === "nejlevnejsi_nabidka" ? d.suggestions.primary
        : d.suggestions.alternatives.find((a) => a.source === "nejlevnejsi_nabidka") ?? null;
      const items = existing
        ? existing.items.map((it) => ({ orderItemId: null, label: it.label, quantity: it.quantity, unit: it.unit }))
        : (built?.items ?? []).map((it) => ({ orderItemId: it.orderItemId, label: it.drawingNumber || it.name || "Položka", quantity: it.quantity, unit: it.unit ?? "ks" }));
      const unpriced = existing ? existing.items.filter((it) => it.unitPrice === null).length : (built?.items ?? []).filter((it) => it.unitPrice === null || it.unitPrice === undefined).length;
      const total = existing
        ? r2(existing.items.reduce((s, it) => s + (it.unitPrice ?? 0) * it.quantity, 0))
        : r2((built?.items ?? []).reduce((s, it) => s + (it.unitPrice ?? 0) * it.quantity, 0));
      const sup = d.who.type === "supplier" ? ctx.suppliers.get(d.who.id) : undefined;
      const coverage = q ? quoteValue(q, scopeItemsOf(ctx.items, d.orderItemIds), ctx.items).coverage : null;
      poPreview = {
        supplierName: whoName(d.who), itemCount: items.length, unpriced, total: margins ? total : null,
        currency: q?.currency || ctx.job.currency, items,
        existing: existing ? { id: existing.id, number: existing.number, status: existing.status } : null,
        blockers: existing ? [] : autoSendBlockers({
          unpricedItems: unpriced, quoteExpired: Boolean(q?.validUntil && q.validUntil < today),
          partialCoverage: Boolean(coverage && coverage.uncovered.length), whoSource: d.whoSource,
          supplierEmail: sup?.email ?? (d.who.type === "free" ? null : null), senderUsable,
          cheaperQuote: Boolean(best?.supplierQuoteId && best.supplierQuoteId !== d.supplierQuoteId), hasQuote: Boolean(q),
        }),
      };
    }
    const label = labels.get(d.operationId ?? d.key) ?? OPERATION_KINDS[d.kind].label;
    return {
      ...input,
      key: d.key,
      status: d.status,
      locked: d.status && RUNNING.has(d.status) ? "status_kind" : "none",
      label,
      performerRole: performerRole(
        { id: d.operationId ?? d.key, kind: d.kind, inHouse: d.who.type === "u_nas", supplierId: d.who.type === "supplier" ? d.who.id : null, supplierName: whoName(d.who) },
        finalRoute,
      ),
      suggestions: d.suggestions,
      deadlineCaption: d.deadlineCaption,
      deadlineState: d.plannedEnd ? deadlineStateFor({ who: d.who, deadlineSource: d.deadlineSource, purchaseOrderStatus: existing?.status ?? null }) : null,
      poPreview,
    };
  });

  // 4) kontrola předvyplněného stavu (+ běžící krok před dialogem: kroky jdou po sobě)
  const prevCtx = running && !steps.some((s) => s.operationId === running.id) && cleanDate(running.plannedEnd)
    ? { date: cleanDate(running.plannedEnd) as string, label: labels.get(running.id) ?? running.label } : null;
  const issues = validateHandoff(
    { kind, steps: steps.map((s) => ({ ...s })) },
    { ...validationContext(ctx, steps.map((s) => s.operationId ?? null), today), previousEnd: prevCtx },
  );
  // postup jako celek: zákazník posunul termín / výroba skončí po konečném termínu (i když dialog má jen další krok)
  if (kind !== "zaznam" && kind !== "zpet") {
    const projected = ctx.ops.map((o) => {
      const s = steps.find((x) => x.operationId === o.id);
      return { id: o.id, kind: o.kind, title: o.title, status: o.status, position: o.position, createdAt: o.createdAt,
        plannedEnd: s ? cleanDate(s.plannedEnd) : cleanDate(o.plannedEnd), endsAtCustomerDate: s ? Boolean(s.endsAtCustomerDate) : Boolean(o.endsAtCustomerDate) };
    });
    const hasLate = issues.some((x) => x.code === "last_after_final" || x.code === "interim_after_final");
    for (const h of routeHealth(projected, { dueDate: ctx.job.dueDate, customerRequiredDate: ctx.job.customerRequiredDate }, today)) {
      if (h.code === "final_changed" || (h.code === "route_late" && !hasLate)) {
        issues.push({ code: "route_health", level: "warning", message: h.message });
      }
    }
  }
  const cur = running ?? (kind === "dalsi_krok" || kind === "ukonceni" ? null : null);
  const curPo = cur?.purchaseOrderId ? ctx.purchaseOrders.find((p) => p.id === cur.purchaseOrderId) ?? null : null;
  const loc = (o: JobOperation) => o.location;

  // podklady pro dialog: návrhy kdo pro přidaný krok (podle druhu), adresář, díly, kontext kontroly
  const lastWho = drafts.length ? drafts[drafts.length - 1].who : running ? whoOfOp(running) : null;
  const kindSuggestions: NonNullable<HandoffPlan["client"]>["kindSuggestions"] = {};
  // přidaný krok nesmí znovu použít nabídku jiného kroku / objednávky (Výroba → TZ → Výroba u stejné firmy)
  const usedForAdded = usedQuotesOf(ctx, {});
  // další krok: „Jiný další krok" připravený krok nahradí — jeho nabídka zůstane volná
  if (kind !== "dalsi_krok") steps.forEach((s, j) => {
    if (s.supplierQuoteId && !usedForAdded[s.supplierQuoteId]) usedForAdded[s.supplierQuoteId] = `krok ${before + j + 1} (${s.label})`;
  });
  for (const k of Object.keys(OPERATION_KINDS) as OperationKind[]) {
    const ids = familyScopeOf(k, ctx.items);
    const s = suggestFor(k, ids, null, false, [lastWho?.type === "supplier" ? lastWho.id : null], usedForAdded);
    kindSuggestions[k] = { orderItemIds: ids, primary: s.primary, alternatives: s.alternatives };
  }
  const vctx = validationContext(ctx, steps.map((s) => s.operationId ?? null), today);
  const remainingFrom = running ? live.findIndex((o) => o.id === running.id) + 1 : 0;
  const client: NonNullable<HandoffPlan["client"]> = {
    today,
    suppliers: [...ctx.suppliers.values()].map((s) => ({ id: s.id, name: s.name, email: s.email, leadDays: s.leadDays })),
    items: ctx.items.map((i) => ({
      id: i.id, drawingNumber: i.drawingNumber, name: i.name, quantity: i.quantity, unit: i.unit ?? "ks",
      heatTreatment: [i.heatTreatment, i.hardness].filter(Boolean).join(" ") || null, surfaceTreatment: i.surfaceTreatment ?? null,
      supplierNote: i.supplierNote ?? null,
    })),
    otherSteps: vctx.otherSteps,
    openPurchaseOrders: vctx.openPurchaseOrders,
    previousEnd: prevCtx,
    kindSuggestions,
    routeChips,
    remaining: live.slice(Math.max(0, remainingFrom)).filter((o) => o.status === "ceka").map((o) => {
      const p = o.purchaseOrderId ? ctx.purchaseOrders.find((x) => x.id === o.purchaseOrderId) ?? null : null;
      return { id: o.id, label: labels.get(o.id) ?? o.label, location: o.location, purchaseOrder: p ? { id: p.id, number: p.number, status: p.status } : null };
    }),
    undoHandoffId: ctx.lastPredani?.id ?? null,
  };
  return {
    token: randomUUID(),
    routeVersion: ctx.routeVersion,
    jobId: ctx.job.id,
    jobNumber: ctx.job.number,
    customerName: ctx.job.customerName,
    kind,
    stage: ctx.job.status,
    target: kind === "ukonceni" || kind === "zaznam" ? (opts.target ?? "dodano_k_nam") : kind === "zpet" ? null : null,
    permissions: { canSeePrices: margins, canConfirmCustomerDate: margins, canReceive: margins, canSend: margins, canCancelSent: margins },
    finalDate: { ...fin, maxTolerated: ctx.job.maxToleratedDate },
    doneSteps: live.filter((o) => o.status === "hotovo").map((o) => ({ id: o.id, label: labels.get(o.id) ?? o.label, location: loc(o), finishedAt: o.finishedAt })),
    current: cur ? {
      id: cur.id, label: labels.get(cur.id) ?? cur.label, location: loc(cur), status: cur.status,
      purchaseOrder: curPo && margins ? {
        id: curPo.id, number: curPo.number, status: curPo.status,
        items: curPo.items.map((it) => ({ id: it.id, label: it.label, quantity: it.quantity, received: it.received, unit: it.unit })),
      } : curPo ? { id: curPo.id, number: curPo.number, status: curPo.status, items: [] } : null,
    } : null,
    steps,
    routes,
    routeSource,
    openPurchaseOrders: ctx.purchaseOrders.filter((p) => p.status === "vystavena" || p.status === "odeslana" || p.status === "potvrzena")
      .map((p) => ({ id: p.id, number: p.number, supplierName: p.supplierName, status: p.status })),
    automation: {
      mode: opts.automationMode,
      sendDefault: opts.automationMode === "full" && margins && senderUsable,
      senderEmail: opts.senderEmail ?? null,
      reason: !margins ? "Objednávku odešle obchodník nebo admin (čeká ve frontě ke schválení)."
        : !senderUsable ? "Nemáš nastavenou schránku pro odesílání — objednávka počká ve frontě." : null,
    },
    pendingCapturedQuotes: ctx.pendingCapturedQuotes,
    issues,
    client,
  };
}

function validationContext(ctx: HandoffContext, dialogOpIds: (string | null)[], today: string) {
  const inDialog = new Set(dialogOpIds.filter((x): x is string => Boolean(x)));
  return {
    today,
    stage: ctx.job.status,
    dueDate: ctx.job.dueDate,
    customerRequiredDate: ctx.job.customerRequiredDate,
    maxToleratedDate: ctx.job.maxToleratedDate,
    items: ctx.items.map((i) => ({ id: i.id, drawingNumber: i.drawingNumber, name: i.name })),
    otherSteps: ctx.ops.filter((o) => !inDialog.has(o.id)).map((o) => ({ kind: o.kind, status: o.status, orderItemIds: o.orderItemIds ?? null })),
    openPurchaseOrders: ctx.purchaseOrders.filter((p) => OPEN_PO.includes(p.status))
      .map((p) => ({ id: p.id, number: p.number, supplierId: p.supplierId, supplierName: p.supplierName, linked: p.linked })),
  };
}

// ── Vstup → payload RPC ─────────────────────────────────────
export interface PoGroupMeta {
  group: string;
  stepKeys: string[];
  supplierId: string | null;
  supplierKey: string | null;
  supplierName: string;
  supplierEmail: string | null;
  unpriced: number;
  quoteExpired: boolean;
  partialCoverage: boolean;
  whoSource: WhoSource | null;
  stepsText: string;
  requiredDate: string | null;
  /** K dílům je srovnatelně levnější nabídka jiné firmy (blokace „ručně zvolená dražší firma"). */
  cheaperQuote: boolean;
  hasQuote: boolean;
}

/** Firma bez nabídky nemá naše výkresy (posílali jsme je jen do poptávky) — připomínka ve frontě. */
export const NO_DRAWINGS_HINT = "Dodavatel nemá výkresy — pošli je";

type PayloadResult =
  | { payload: ProductionApplyPayload; groups: PoGroupMeta[]; issues: HandoffIssue[] }
  | { error: string; code: HandoffErrorCode; issues?: HandoffIssue[] };

const WHO_SOURCES: WhoSource[] = ["objednavka", "nejlevnejsi_nabidka", "nabidka", "posledni_vykres", "posledni_operace", "technologie", "rucne", "ai", "import"];
const DEADLINE_SOURCES: DeadlineSource[] = ["nabidka_dodavatele", "lhuta_dodavatele", "potvrzeni_dodavatele", "termin_zakaznika", "posledni_dodavatel", "odhad", "rucne", "ai", "import"];
const PO_MODES = ["vystavit", "existujici", "neobjednavat", "pri_predani"] as const;

function bad(message: string, code: HandoffErrorCode = "VALIDATION"): { error: string; code: HandoffErrorCode } {
  return { error: message, code };
}

/** Tvar vstupu z prohlížeče (nic nepřevzatého bez kontroly). */
export function checkHandoffInputShape(input: HandoffInput): string | null {
  if (!input || typeof input !== "object") return "Chybí údaje předání.";
  if (!isUuid(input.token)) return "Neplatný identifikátor požadavku — obnov stránku.";
  if (!HANDOFF_KINDS.includes(input.kind)) return "Neznámý druh předání.";
  if (!isJobStage(input.expectedStage)) return "Neplatný stav zakázky — obnov stránku.";
  if (typeof input.expectedRouteVersion !== "string") return "Chybí verze postupu — obnov stránku.";
  if (!Array.isArray(input.steps)) return "Chybí kroky výroby.";
  if (input.steps.length > 12) return "Najednou lze předat nejvýš 12 kroků.";
  for (const [i, s] of input.steps.entries()) {
    const n = i + 1;
    if (!s || typeof s !== "object") return `Krok ${n}: neplatná data.`;
    if (s.operationId !== undefined && s.operationId !== null && !isUuid(s.operationId)) return `Krok ${n}: neplatný krok.`;
    if (!isOperationKind(s.kind)) return `Krok ${n}: neznámý druh kroku.`;
    if (s.title !== undefined && s.title !== null && (typeof s.title !== "string" || s.title.length > 300)) return `Krok ${n}: neplatný název.`;
    const w = s.who as StepWho | undefined;
    if (!w || typeof w !== "object" || !["u_nas", "supplier", "free", "none"].includes(w.type)) return `Krok ${n}: neplatné „kdo to dělá".`;
    if (w.type === "supplier" && !isUuid(w.id)) return `Krok ${n}: neplatný dodavatel.`;
    if (w.type === "free" && (typeof w.name !== "string" || w.name.trim().length > 300)) return `Krok ${n}: neplatný název firmy.`;
    if (s.plannedEnd !== null && s.plannedEnd !== undefined && typeof s.plannedEnd !== "string") return `Krok ${n}: neplatné datum.`;
    if (s.plannedStart !== null && s.plannedStart !== undefined && !cleanDate(s.plannedStart)) return `Krok ${n}: neplatný začátek.`;
    if (s.supplierQuoteId !== undefined && s.supplierQuoteId !== null && !isUuid(s.supplierQuoteId)) return `Krok ${n}: neplatná nabídka.`;
    if (s.orderItemIds !== undefined && s.orderItemIds !== null && (!Array.isArray(s.orderItemIds) || s.orderItemIds.some((x) => !isUuid(x)))) return `Krok ${n}: neplatné díly.`;
    if (s.whoSource !== undefined && s.whoSource !== null && !WHO_SOURCES.includes(s.whoSource)) return `Krok ${n}: neplatný zdroj návrhu.`;
    if (s.deadlineSource !== undefined && s.deadlineSource !== null && !DEADLINE_SOURCES.includes(s.deadlineSource)) return `Krok ${n}: neplatný zdroj termínu.`;
    if (!s.po || typeof s.po !== "object") return `Krok ${n}: chybí objednávka kroku.`;
    if (s.po.mode !== null && s.po.mode !== undefined && !(PO_MODES as readonly string[]).includes(s.po.mode)) return `Krok ${n}: neplatný režim objednávky.`;
    if (s.po.existingId !== undefined && s.po.existingId !== null && !isUuid(s.po.existingId)) return `Krok ${n}: neplatná objednávka.`;
    if (s.po.noneReason !== undefined && s.po.noneReason !== null && (typeof s.po.noneReason !== "string" || s.po.noneReason.length > 500)) return `Krok ${n}: neplatný důvod.`;
    if (s.po.quantities !== undefined && s.po.quantities !== null) {
      if (typeof s.po.quantities !== "object") return `Krok ${n}: neplatná množství.`;
      for (const [k, v] of Object.entries(s.po.quantities)) if (!isUuid(k) || typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > 1e8) return `Krok ${n}: neplatné množství.`;
    }
    if (s.note !== undefined && s.note !== null && (typeof s.note !== "string" || s.note.length > 10_000)) return `Krok ${n}: poznámka je příliš dlouhá.`;
  }
  if (input.complete && (typeof input.complete !== "object" || !isUuid(input.complete.operationId))) return "Neplatný dokončovaný krok.";
  if (input.complete?.receipts && (!Array.isArray(input.complete.receipts) || input.complete.receipts.length > 300
      || input.complete.receipts.some((r) => !r || !isUuid(r.itemId) || typeof r.received !== "number" || !Number.isFinite(r.received) || r.received < 0))) return "Neplatné převzaté množství.";
  if (input.finish && (typeof input.finish !== "object" || !isJobStage(input.finish.target))) return "Neplatný cílový stav.";
  if (input.finish?.cancelSentPurchaseOrderIds && (!Array.isArray(input.finish.cancelSentPurchaseOrderIds) || input.finish.cancelSentPurchaseOrderIds.some((x) => !isUuid(x)))) return "Neplatné objednávky ke zrušení.";
  if (input.finalDate && (typeof input.finalDate !== "object" || !cleanDate(input.finalDate.date))) return "Neplatný konečný termín (čekám RRRR-MM-DD).";
  if (input.sendNow !== undefined && (!Array.isArray(input.sendNow) || input.sendNow.some((x) => typeof x !== "string"))) return "Neplatné odeslání.";
  if (input.undoHandoffId !== undefined && input.undoHandoffId !== null && !isUuid(input.undoHandoffId)) return "Neplatné předání.";
  if (input.note !== undefined && input.note !== null && (typeof input.note !== "string" || input.note.length > 500)) return "Poznámka je příliš dlouhá (max. 500 znaků).";
  return null;
}

/** Ověření práv k příznakům (F.6): bez „margins" nic z toho. */
export function marginsOnlyViolation(input: HandoffInput, ctx: Pick<HandoffContext, "job">): string | null {
  if (input.finalDate?.confirmed && cleanDate(input.finalDate.date) !== ctx.job.dueDate) return "Potvrzený termín zákazníkovi zapíše obchodník nebo admin.";
  if (input.updateCustomerDate) return "Konečný termín zákazníkovi mění obchodník nebo admin.";
  if (input.complete?.receipts?.length) return "Převzetí od dodavatele zapíše obchodník nebo admin.";
  if (input.sendNow?.length) return "Objednávku dodavateli odešle obchodník nebo admin.";
  if (input.finish?.cancelSentPurchaseOrderIds?.length) return "Odeslanou objednávku zruší obchodník nebo admin.";
  return null;
}

/** Poznámka položky bez materiálu, který má PDF ve vlastním řádku („Materiál: 1.2379"). */
export function noteWithoutMaterial(note: string | null, material: string | null): string | null {
  if (!note || !material) return note;
  const parts = note.split(" · ").filter((p) => p.trim() !== material.trim());
  return parts.length ? parts.join(" · ") : null;
}

function poItemsToApply(items: ReturnType<typeof purchaseItemsForStep>["items"]): ApplyPurchaseItem[] {
  return items.map((it, i) => {
    const material = cleanText(it.material, 200);
    return {
      position: i,
      drawing_number: cleanText(it.drawingNumber, 120),
      name: cleanText(it.name, 500),
      material,
      quantity: Math.max(0.001, Math.round(num(it.quantity) * 1000) / 1000),
      unit: cleanText(it.unit, 20) ?? "ks",
      unit_price: it.unitPrice === null || it.unitPrice === undefined ? null : r2(it.unitPrice),
      note: noteWithoutMaterial(cleanText(it.note, 1000), material),
      order_item_id: it.orderItemId ?? null,
    };
  });
}

function normName(s: string): string {
  return s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
}

/**
 * Vstup dialogu → payload RPC production_apply. Ceny objednávek staví server z nabídky dodavatele
 * (nikdy z prohlížeče). Firma mimo adresář s objednávkou: shoda ≥ 80 → id, jinak ji založí RPC.
 */
export async function buildApplyPayload(db: JobsDb, ctx: HandoffContext, input: HandoffInput, actor: HandoffActor,
  opts: { relaxFinal?: boolean } = {}): Promise<PayloadResult> {
  const shape = checkHandoffInputShape(input);
  if (shape) return bad(shape);
  if (!actor.margins) {
    const v = marginsOnlyViolation(input, ctx);
    if (v) return bad(v, "FORBIDDEN");
  }
  const kind = input.kind;
  const today = ctx.today;
  const live = ctx.ops.filter((o) => o.status !== "preskoceno");
  const byId = new Map(ctx.ops.map((o) => [o.id, o]));

  // existující kroky z dialogu musí patřit k zakázce
  for (const [i, s] of input.steps.entries()) {
    if (s.operationId && !byId.has(s.operationId)) return bad(`Krok ${i + 1}: mezitím se změnil — obnov stránku.`, "STEP_CHANGED");
    if (s.orderItemIds && s.orderItemIds.some((id) => !ctx.items.some((it) => it.id === id))) return bad(`Krok ${i + 1}: díly nepatří k zakázce.`);
    if (s.supplierQuoteId && !ctx.quotes.some((q) => q.id === s.supplierQuoteId)) return bad("Nabídka dodavatele nepatří k této zakázce.");
  }

  // kdo: firma z adresáře ověřená, existující objednávka ověřená (dodavatel = dodavatel objednávky)
  const steps: HandoffStepInput[] = [];
  for (const [i, s0] of input.steps.entries()) {
    const s: HandoffStepInput = { ...s0, po: { ...s0.po } };
    if (s.who.type === "supplier") {
      const sup = ctx.suppliers.get(s.who.id);
      if (!sup) return bad(`Krok ${i + 1}: dodavatel nenalezen.`);
      s.who = { type: "supplier", id: sup.id, name: sup.name };
    }
    if (s.po.mode === "existujici") {
      const po = ctx.purchaseOrders.find((p) => p.id === s.po.existingId);
      if (!po || po.status === "zrusena") return bad(`Krok ${i + 1}: objednávka nepatří k zakázce nebo je zrušená.`);
      if (s.who.type === "supplier" && po.supplierId && po.supplierId !== s.who.id) return bad(`Krok ${i + 1}: objednávka ${po.number} je u jiného dodavatele.`);
      if (!stepHasWho(s.who) || s.who.type === "free") {
        s.who = po.supplierId ? { type: "supplier", id: po.supplierId, name: po.supplierName } : s.who;
      }
    }
    if (s.who.type === "u_nas") s.po.mode = null;
    steps.push(s);
  }

  // kontrola (stejná jako v dialogu)
  const quantityMismatch: Record<number, { quoted: number; ordered: number; unit: string }> = {};
  steps.forEach((s, i) => {
    const q = quoteFor(ctx, s.supplierQuoteId);
    if (q && sameSupplierQuote(q, s.who)) {
      const v = quoteValue(q, scopeItemsOf(ctx.items, s.orderItemIds ?? null), ctx.items);
      if (v.quantityMismatch) quantityMismatch[i] = v.quantityMismatch;
    }
  });
  const vSteps: HandoffValidationStep[] = steps.map((s) => ({ ...s, status: s.operationId ? byId.get(s.operationId)?.status ?? null : null }));
  let issues = validateHandoff(
    { kind, steps: vSteps, finalDate: input.finalDate ?? null, updateCustomerDate: input.updateCustomerDate, acceptLate: input.acceptLate },
    { ...validationContext(ctx, steps.map((s) => s.operationId ?? null), today), quantityMismatch },
  );
  if (opts.relaxFinal) {
    // automatika (focení, Nákup): na konečný termín se nemá koho zeptat — jen upozornění
    issues = issues.map((x) => (x.code === "final_missing" ? { ...x, level: "warning" as const } : x));
  }
  const acceptLate = Boolean(input.acceptLate || opts.relaxFinal);
  if (!canSubmitHandoff(issues, acceptLate)) {
    const first = issues.find((x) => x.level === "error") ?? issues.find((x) => x.acceptLate);
    return { error: first?.message ?? "Předání nejde uložit — zkontroluj kroky.", code: "VALIDATION", issues };
  }

  // dokončení: jen běžící krok
  if (input.complete) {
    const op = byId.get(input.complete.operationId);
    if (!op || !RUNNING.has(op.status)) return bad("Krok mezitím změnil stav — obnov stránku.", "STEP_CHANGED");
  }

  // pozice: nové kroky za předchozí krok z dialogu (dalsi_krok: hned za aktuálním), jinak na konec
  const sorted = sortOperations(ctx.ops);
  const order: string[] = sorted.map((o) => o.id);
  const curId = input.complete?.operationId ?? live.find((o) => RUNNING.has(o.status))?.id ?? null;
  let anchor = kind === "dalsi_krok" && curId ? order.indexOf(curId) + 1 : order.length;
  const placeholders: string[] = [];
  steps.forEach((s, i) => {
    if (s.operationId) {
      anchor = Math.max(anchor, order.indexOf(s.operationId) + 1);
      return;
    }
    const ph = `new:${i}`;
    placeholders.push(ph);
    order.splice(anchor, 0, ph);
    anchor += 1;
  });
  const posOf = new Map<string, number>();
  const currentPos = new Map(sorted.map((o) => [o.id, o.position]));
  const needsRenumber = placeholders.some((ph) => order.indexOf(ph) < order.length - 1);
  const shifts: { id: string; position: number }[] = [];
  if (needsRenumber) {
    order.forEach((id, idx) => {
      posOf.set(id, idx);
      if (!id.startsWith("new:") && currentPos.get(id) !== idx) shifts.push({ id, position: idx });
    });
  } else {
    const base = insertPositions(sorted.map((o) => ({ id: o.id, position: o.position })), placeholders.length, null);
    placeholders.forEach((ph, k) => posOf.set(ph, base.positions[k]));
  }

  // konečný termín jen u posledního nepřeskočeného kroku: v payloadu nebo vložení za konečný krok → odebrat všem
  const finalOp = live.find((o) => o.endsAtCustomerDate);
  const lastLiveId = [...order].reverse().find((id) => id.startsWith("new:") || (byId.get(id)?.status !== "preskoceno")) ?? null;
  const resetFinal = steps.some((s) => s.endsAtCustomerDate) || Boolean(finalOp && lastLiveId && lastLiveId !== finalOp.id && !steps.some((s) => s.operationId === finalOp.id));

  // firmy mimo adresář s objednávkou → shoda v adresáři, jinak nový dodavatel v RPC
  const newSuppliers: NonNullable<ProductionApplyPayload["newSuppliers"]> = [];
  const resolved: { supplierId: string | null; supplierKey: string | null; supplierName: string | null }[] = [];
  let candidates: Awaited<ReturnType<typeof loadSupplierCandidates>> | null = null;
  for (const s of steps) {
    if (s.who.type === "supplier") { resolved.push({ supplierId: s.who.id, supplierKey: null, supplierName: null }); continue; }
    if (s.who.type !== "free" || !ordersNewNow(s, kind)) {
      resolved.push({ supplierId: null, supplierKey: null, supplierName: s.who.type === "free" ? s.who.name.trim() : null });
      continue;
    }
    const name = s.who.name.trim();
    const exact = [...ctx.suppliers.values()].find((x) => normName(x.name) === normName(name));
    if (exact) { resolved.push({ supplierId: exact.id, supplierKey: null, supplierName: null }); continue; }
    candidates ??= await loadSupplierCandidates(db);
    const hit = matchParty({ name, ico: "", dic: "", street: "", city: "", zip: "", country: "", email: "", phone: "", contactPerson: "" }, candidates);
    if (hit && hit.score >= 80) { resolved.push({ supplierId: hit.id, supplierKey: null, supplierName: null }); continue; }
    const key = `ns:${normName(name)}`;
    if (!newSuppliers.some((x) => x.key === key)) newSuppliers.push({ key, name: name.slice(0, 300) });
    resolved.push({ supplierId: null, supplierKey: key, supplierName: null });
  }
  const resolvedWho = (i: number): StepWho => {
    const r = resolved[i];
    if (r.supplierId) return { type: "supplier", id: r.supplierId, name: ctx.suppliers.get(r.supplierId)?.name };
    if (r.supplierKey) return { type: "free", name: r.supplierKey };
    return steps[i].who;
  };

  // objednávky: souvislé kroky stejné firmy = jedna objednávka
  const keys = steps.map((s, i) => stepKeyOf(s, i));
  const groups = groupPurchaseOrders(steps.map((s, i) => ({ key: keys[i], who: resolvedWho(i), ordersNow: ordersNewNow(s, kind), sharedWithNext: s.po.sharedWithNext })));
  const groupOfStep = new Map<string, string>();
  for (const g of groups) for (const k of g.stepKeys) groupOfStep.set(k, g.key);

  // názvy kroků v novém pořadí (do souhrnu a poznámky objednávky)
  const finalRoute = order.map((id) => {
    if (id.startsWith("new:")) {
      const i = Number(id.slice(4));
      return { id, kind: steps[i].kind, title: steps[i].title ?? null, status: "ceka" as const, position: posOf.get(id) ?? 0 };
    }
    const o = byId.get(id)!;
    const i = steps.findIndex((s) => s.operationId === id);
    return { id, kind: i >= 0 ? steps[i].kind : o.kind, title: i >= 0 && steps[i].title !== undefined ? steps[i].title ?? null : o.title, status: o.status, position: posOf.get(id) ?? o.position };
  });
  const labelOf = (i: number) => stepLabel(finalRoute.find((r) => r.id === (steps[i].operationId ?? `new:${i}`))!, finalRoute);
  const liveRoute = finalRoute.filter((r) => r.status !== "preskoceno");
  const stepNoOf = (i: number) => liveRoute.findIndex((r) => r.id === (steps[i].operationId ?? `new:${i}`)) + 1;

  const deliveryUs = await ourDeliveryAddressCore();
  const purchaseOrders: ApplyPurchaseOrder[] = [];
  const metas: PoGroupMeta[] = [];
  const singleStepRoute = liveRoute.length <= 1;
  // nabídka už nacenila jinou objednávku zakázky (nebo jinou objednávku tohoto předání): nová objednávka
  // podle ní je BEZ cen — jinak by se cena započítala dvakrát (Výroba → TZ → Výroba u stejné firmy)
  const pricedNow = new Set<string>();
  for (const g of groups) {
    const idx = g.stepKeys.map((k) => keys.indexOf(k));
    const first = idx[0];
    const last = idx[idx.length - 1];
    const s = steps[first];
    const r = resolved[first];
    const who = resolvedWho(first);
    let q = quoteFor(ctx, s.supplierQuoteId);
    if (q && r.supplierId && q.supplierId && q.supplierId !== r.supplierId) q = null;
    if (q && !r.supplierId && !sameSupplierQuote(q, steps[first].who)) q = null;
    const reusedQuote = q && (quoteOnOtherPurchaseOrder(ctx, q.id) || pricedNow.has(q.id)) ? q : null;
    if (reusedQuote) q = null;
    else if (q) pricedNow.add(q.id);
    const scope = idx.some((i) => !steps[i].orderItemIds) ? null : [...new Set(idx.flatMap((i) => steps[i].orderItemIds ?? []))];
    const quantities = Object.assign({}, ...idx.map((i) => steps[i].po.quantities ?? {})) as Record<string, number>;
    // díly mimo nabídku: výchozí „Objednat i zbylé díly … bez ceny" (D.5); bez nich jen když je udělá jiný krok
    const includeUncovered = s.po.includeUncovered ?? true;
    let built = purchaseItemsForStep({
      step: { kind: s.kind, orderItemIds: scope }, items: ctx.items, quote: q, includeUncovered, quantities, singleStepRoute,
    });
    if (built.uncovered.length) {
      const coveredElsewhere = (itemId: string) =>
        steps.some((x, j) => !idx.includes(j) && operationFamily(x.kind) === operationFamily(s.kind) && (!x.orderItemIds || x.orderItemIds.includes(itemId)))
        || ctx.ops.some((o) => o.status !== "preskoceno" && !steps.some((x) => x.operationId === o.id)
          && operationFamily(o.kind) === operationFamily(s.kind) && Array.isArray(o.orderItemIds) && o.orderItemIds.includes(itemId));
      const orphan = built.uncovered.filter((id) => !coveredElsewhere(id));
      if (orphan.length) {
        const names = orphan.map((id) => ctx.items.find((it) => it.id === id)).map((it) => it?.drawingNumber || it?.name || "díl");
        return bad(`Díl ${names.join(", ")} nemá, kdo ho vyrobí — nabídka ${q?.supplierName ?? "dodavatele"} ho nepokrývá. Objednej i zbylé díly (bez ceny), nebo pro ně přidej krok.`);
      }
    }
    if (!built.items.length && ctx.items.length) {
      built = purchaseItemsForStep({ step: { kind: s.kind, orderItemIds: scope }, items: ctx.items, quote: q, includeUncovered: true, quantities, singleStepRoute });
    }
    let items = poItemsToApply(built.items);
    if (!items.length && q?.items.length) {
      items = q.items.map((it, i) => ({
        position: i, drawing_number: cleanText(it.drawingNumber, 120), name: cleanText(it.name, 500) ?? "Položka", material: null,
        quantity: Math.max(0.001, num(it.quantity) || 1), unit: cleanText(it.unit, 20) ?? "ks",
        unit_price: it.unitPrice === null ? null : r2(it.unitPrice), note: cleanText(it.note, 1000), order_item_id: null,
      }));
    }
    if (!items.length) {
      items = [{ position: 0, drawing_number: null, name: cleanText(ctx.job.title, 500) ?? `Zakázka ${ctx.job.number}`, material: null, quantity: 1, unit: "kpl", unit_price: q?.total ?? null, note: null, order_item_id: null }];
    }
    const labels = idx.map(labelOf);
    const stepsText = labels.join(" + ");
    const stepNo = stepNoOf(first);
    const nextIdx = liveRoute.findIndex((x) => x.id === (steps[last].operationId ?? `new:${last}`)) + 1;
    const next = nextIdx > 0 && nextIdx < liveRoute.length ? liveRoute[nextIdx] : null;
    const nextStepIdx = next ? steps.findIndex((x, i) => (x.operationId ?? `new:${i}`) === next.id) : -1;
    const nextOp = next && !next.id.startsWith("new:") ? byId.get(next.id) : null;
    const nextWho: StepWho | null = nextStepIdx >= 0 ? resolvedWho(nextStepIdx) : nextOp ? whoOfOp(nextOp) : null;
    const elsewhere = Boolean(nextWho && (nextWho.type === "u_nas" || whoName(nextWho) !== whoName(who)));
    // dodavatel vidí název operace bez našeho interního číslování („Výroba", ne „Výroba 1")
    const supplierLabel = (k: OperationKind, title: string | null | undefined) => (title ?? "").trim() || OPERATION_KINDS[k].label;
    const note = stepPurchaseOrderNote({
      jobNumber: ctx.job.number, drawings: scopeItemsOf(ctx.items, scope).map((i) => i.drawingNumber),
      stepLabel: [...new Set(idx.map((i) => supplierLabel(steps[i].kind, steps[i].title)))].join(" + "), stepNo, stepCount: liveRoute.length,
      next: next ? { label: supplierLabel(next.kind, next.title), elsewhere } : null,
      kind: s.kind,
    });
    let deliveryAddress = deliveryUs;
    if (s.po.deliverTo === "dalsi_krok" && nextWho?.type === "supplier") {
      const ns = ctx.suppliers.get(nextWho.id);
      if (ns?.address) deliveryAddress = `${ns.name}\n${ns.address}`;
    }
    const requiredDate = cleanDate(steps[last].plannedEnd);
    const supName = r.supplierId ? ctx.suppliers.get(r.supplierId)?.name ?? "" : newSuppliers.find((x) => x.key === r.supplierKey)?.name ?? "";
    const email = r.supplierId ? ctx.suppliers.get(r.supplierId)?.email ?? null : null;
    const stepRef = idx.length > 1 ? `kroky ${idx.map((i) => stepNoOf(i)).join(", ")}: ${stepsText}` : `krok ${stepNo}: ${stepsText}`;
    purchaseOrders.push({
      group: g.key,
      ...(r.supplierId ? { supplierId: r.supplierId } : { supplierKey: r.supplierKey }),
      supplierQuoteId: q?.id ?? null,
      requiredDate,
      currency: (q?.currency || ctx.job.currency || "CZK").toUpperCase(),
      deliveryTerms: deliveryTermsFor(deliveryAddress),
      paymentTerms: DEFAULT_PAYMENT_TERMS,
      deliveryAddress,
      note,
      stepsLabel: stepRef,
      items,
      queue: {
        title: "",
        // firma bez nabídky nemá výkresy (dostala je jen ta, která nabízela) — připomenout
        summary: `${stepsText}${requiredDate ? ` · požadovaný termín ${shortDay(requiredDate)}` : ""}${q || reusedQuote ? "" : ` · ${NO_DRAWINGS_HINT}`}${reusedQuote ? " · cena dle nové nabídky (nabídka už je na jiné objednávce)" : ""}`,
        target: email,
        payload: { to: email ?? "", senderId: actor.id },
      },
    });
    // ověřený zdroj „kdo": nejlevnější jen když opravdu je (prohlížeči se nevěří)
    let whoSource: WhoSource | null = s.whoSource ?? null;
    const sugAll = suggestWhoForStep({
      step: { kind: s.kind, orderItemIds: s.orderItemIds ?? null }, quotes: ctx.quotes, openPurchaseOrders: [],
      ctx: { items: ctx.items, currency: ctx.job.currency, today }, canSeePrices: true,
      usedQuotes: usedQuotesOf(ctx, { selfOpId: s.operationId ?? null }),
    });
    const best = sugAll.primary?.source === "nejlevnejsi_nabidka" ? sugAll.primary : sugAll.alternatives.find((a) => a.source === "nejlevnejsi_nabidka") ?? null;
    if (whoSource === "nejlevnejsi_nabidka" || whoSource === "objednavka") {
      const ok = best && q && best.supplierQuoteId === q.id;
      whoSource = ok ? "nejlevnejsi_nabidka" : "rucne";
    }
    const coverage = q ? quoteValue(q, scopeItemsOf(ctx.items, scope), ctx.items).coverage : null;
    metas.push({
      group: g.key, stepKeys: g.stepKeys, supplierId: r.supplierId, supplierKey: r.supplierKey, supplierName: supName, supplierEmail: email,
      unpriced: items.filter((it) => it.unit_price === null).length, quoteExpired: Boolean(q?.validUntil && q.validUntil < today),
      partialCoverage: Boolean(coverage && coverage.uncovered.length) || built.uncovered.length > 0, whoSource, stepsText, requiredDate,
      cheaperQuote: Boolean(best?.supplierQuoteId && best.supplierQuoteId !== q?.id), hasQuote: Boolean(q),
    });
  }

  // kroky
  const applySteps: ApplyStep[] = steps.map((s, i) => {
    const r = resolved[i];
    const existingOp = s.operationId ? byId.get(s.operationId) : null;
    const existingPo = s.po.mode === "existujici" ? ctx.purchaseOrders.find((p) => p.id === s.po.existingId) ?? null
      : existingOp?.purchaseOrderId ? ctx.purchaseOrders.find((p) => p.id === existingOp.purchaseOrderId && p.status !== "zrusena") ?? null : null;
    const ordersNow = ordersNewNow(s, kind);
    const poMode = s.who.type === "u_nas" ? null : ordersNow ? "vystavit" : (s.po.mode ?? (isSupplierWho(s.who) ? "pri_predani" : null));
    const q = quoteFor(ctx, s.supplierQuoteId);
    const quoteOk = q && (r.supplierId ? !q.supplierId || q.supplierId === r.supplierId : sameSupplierQuote(q, s.who));
    const deadlineSource = s.deadlineSource ?? (existingOp?.deadlineSource ?? "rucne");
    const step: ApplyStep = {
      index: i + 1,
      operationId: s.operationId ?? null,
      kind: s.kind,
      inHouse: s.who.type === "u_nas",
      supplierId: r.supplierId,
      supplierKey: r.supplierKey,
      supplierName: r.supplierName,
      plannedEnd: cleanDate(s.plannedEnd),
      endsAtCustomerDate: Boolean(s.endsAtCustomerDate),
      deadlineState: deadlineStateFor({ who: s.who, deadlineAgreed: s.deadlineAgreed, deadlineSource, purchaseOrderStatus: existingPo?.status ?? null }),
      deadlineSource,
      whoSource: s.whoSource ?? (stepHasWho(s.who) ? "rucne" : null),
      // nabídka, kterou už nacenila jiná objednávka, se ke kroku s novou objednávkou nepřipíše
      supplierQuoteId: quoteOk && !(ordersNow && quoteOnOtherPurchaseOrder(ctx, q!.id, existingPo?.id)) ? q!.id : null,
      poMode: poMode as ApplyStep["poMode"],
      poNoneReason: poMode === "neobjednavat" ? cleanText(s.po.noneReason, 500) : null,
      poGroup: ordersNow ? groupOfStep.get(keys[i]) ?? null : null,
      existingPurchaseOrderId: s.po.mode === "existujici" ? s.po.existingId ?? null : null,
      start: Boolean(s.start),
      done: Boolean(s.done),
    };
    if (!s.operationId) step.position = posOf.get(`new:${i}`) ?? null;
    else if (posOf.has(s.operationId) && needsRenumber) step.position = posOf.get(s.operationId) ?? null;
    if (s.title !== undefined) step.title = cleanText(s.title, 300);
    if (s.orderItemIds !== undefined) step.orderItemIds = s.orderItemIds && s.orderItemIds.length ? s.orderItemIds : null;
    if (s.plannedStart !== undefined) step.plannedStart = cleanDate(s.plannedStart);
    if (s.note !== undefined) step.note = cleanText(s.note, 10_000);
    return step;
  });
  // shift jen u kroků, které nejsou v payloadu (jinak pozici nastaví krok)
  const stepOpIds = new Set(applySteps.map((s) => s.operationId).filter(Boolean));
  const outsideShifts = shifts.filter((x) => !stepOpIds.has(x.id));
  // vkládané pozice posunu nejdřív na dočasné (žádný unikátní index na pozici není — stačí rovnou)

  // souhrn (bez cen)
  const roles = steps.map((s, i) => performerRole(
    { id: s.operationId ?? `new:${i}`, kind: s.kind, inHouse: s.who.type === "u_nas", supplierId: resolved[i].supplierId, supplierName: whoName(s.who) },
    liveRoute,
  ));
  const prefix: Partial<Record<HandoffKind, string>> = {
    predani: "Předáno do výroby", doplneni: "Výroba doplněna", dalsi_krok: "Předáno dalšímu kroku", plan: "Postup výroby naplánován",
    zaznam: "Výroba zapsána zpětně",
  };
  const parts = steps.map((s, i) => `${stepNoOf(i)}) ${stepSummaryText({
    label: labelOf(i), who: s.who.type === "free" && resolved[i].supplierId ? resolvedWho(i) : s.who, role: roles[i],
    plannedEnd: cleanDate(s.plannedEnd), endsAtCustomerDate: Boolean(s.endsAtCustomerDate), deadlineState: applySteps[i].deadlineState,
  })}`);
  // vědomě přijatý pozdní konec výroby se zapíše do historie (kdo a o kolik)
  const lateIssue = input.acceptLate ? issues.find((x) => x.acceptLate) ?? null : null;
  const finalForLate = ctx.job.dueDate ?? ctx.job.customerRequiredDate ?? cleanDate(input.finalDate?.date) ?? null;
  const lateText = lateIssue && finalForLate ? ` · po konečném termínu (zákazník) ${shortDay(finalForLate)} — přijal ${actor.fullName || "uživatel"}` : "";
  const summary = prefix[kind] && parts.length ? `${prefix[kind]}: ${parts.join(" → ")}${lateText}`.slice(0, 1900) : prefix[kind] ?? null;

  const payload: ProductionApplyPayload = {
    note: cleanText(input.note, 500),
    summary,
    stageTo: kind === "ukonceni" || kind === "zaznam" ? input.finish?.target ?? null : null,
    finalDate: null,
    newSuppliers,
    shifts: outsideShifts,
    resetFinal,
    purchaseOrders,
    steps: applySteps,
  };
  // konečný termín (zákazník): potvrzení / změna jen s „margins" (ověřeno výše)
  const konecny = steps.find((s) => s.endsAtCustomerDate);
  if (input.updateCustomerDate && konecny && cleanDate(konecny.plannedEnd)) payload.finalDate = { date: cleanDate(konecny.plannedEnd)!, confirmed: true };
  else if (input.finalDate) payload.finalDate = { date: cleanDate(input.finalDate.date)!, confirmed: Boolean(input.finalDate.confirmed) };
  if (input.complete) {
    payload.complete = {
      operationId: input.complete.operationId,
      ...(input.complete.receipts?.length ? { receipts: input.complete.receipts } : {}),
      continueWithoutRest: Boolean(input.complete.continueWithoutRest),
      nextText: steps.length ? stepSummaryText({ label: labelOf(0), who: steps[0].who, plannedEnd: cleanDate(steps[0].plannedEnd), endsAtCustomerDate: Boolean(steps[0].endsAtCustomerDate), deadlineState: applySteps[0].deadlineState }) : null,
    };
  }
  if (kind === "ukonceni") {
    payload.finish = { skipReason: cleanText(input.finish?.skipReason, 500), cancelSentPurchaseOrderIds: input.finish?.cancelSentPurchaseOrderIds ?? [] };
  }
  if (kind === "zpet") payload.undoHandoffId = input.undoHandoffId ?? ctx.lastPredani?.id ?? null;
  return { payload, groups: metas, issues };
}

// ── Režim automatiky ────────────────────────────────────────
/** Režim modulu „purchase_order" (výchozí se schválením) — čte servisním klientem volajícího. */
export async function purchaseOrderMode(db: JobsDb): Promise<AutomationMode> {
  try {
    const { data } = await db.from("automation_settings").select("mode, enabled").eq("module", "purchase_order").maybeSingle();
    const row = data as { mode: AutomationMode; enabled: boolean | null } | null;
    if (row && row.enabled === false) return "approval";
    if (row?.mode) return row.mode;
    const { data: g } = await db.from("automation_global").select("mode").maybeSingle();
    return ((g as { mode: AutomationMode } | null)?.mode) ?? "approval";
  } catch {
    return "approval";
  }
}

type BoxRow = { id: string; email: string; config: MailboxConfig; owner_id: string | null; active: boolean | null };

/** Použitelná schránka uživatele pro odesílání (null = žádná). */
export async function usableMailbox(db: JobsDb, userId: string | null | undefined): Promise<{ id: string; email: string } | null> {
  if (!isUuid(userId)) return null;
  const { data } = await db.from("mailboxes").select("id, email, config, owner_id, active, created_at").eq("owner_id", userId).order("created_at");
  const pick = pickSmtpMailbox((data ?? []) as BoxRow[], { ownerId: userId });
  if (!pick.ok || !pick.box) return null;
  return (await isSmtpConfigured({ mailboxId: pick.box.id })) ? { id: pick.box.id, email: pick.box.email } : null;
}

/**
 * Odkud poslat objednávku — STEJNĚ pro každé odeslání (předání „Rovnou odeslat", automatika při předání,
 * schválení ve frontě, tlačítko „Odeslat" u kroku i v Nákupu, storno / změna): obchodník zakázky (s právem
 * na ceny — odpověď dodavatele bývá s cenami) má použitelnou schránku → jeho schránka (odpověď dodavatele
 * dojde jemu, požadavek majitele 4); jinak schránka toho, kdo posílá. Nikdy systémová ani schránka
 * zaměstnance. `mailAll` se už nerozhoduje (dřív jen s poštou všech schránek → nekonzistentní odesílatel).
 */
export async function purchaseOrderSender(db: JobsDb, approver: { id: string; mailAll?: boolean }, jobOwnerId: string | null):
  Promise<{ from: SmtpPreference; signerId: string; mailboxEmail: string | null }> {
  if (jobOwnerId && jobOwnerId !== approver.id && await hasPriceRole(db, jobOwnerId)) {
    const box = await usableMailbox(db, jobOwnerId);
    if (box) return { from: { mailboxId: box.id, ownerId: jobOwnerId }, signerId: jobOwnerId, mailboxEmail: box.email };
  }
  // jinak jako každý e-mail uživatele (send.ts): vlastní schránka → firemní schránka → globální SMTP;
  // nikdy osobní schránka jiného uživatele. Vlastní schránku bez odesílání send.ts odmítne (bez tiché náhrady).
  const own = await usableMailbox(db, approver.id);
  if (own) return { from: { ownerId: approver.id }, signerId: approver.id, mailboxEmail: own.email };
  const fallback = await senderAddress({ ownerId: approver.id });
  return { from: { ownerId: approver.id }, signerId: approver.id, mailboxEmail: fallback };
}

/** Adresa, ze které by send.ts e-mail opravdu odeslal (null = odeslat nejde). */
async function senderAddress(pref: SmtpPreference): Promise<string | null> {
  try {
    const d = await describeSender(pref);
    return d.ok ? d.from ?? null : null;
  } catch {
    return null;
  }
}

// ── Fronta a odeslání ───────────────────────────────────────
interface QueueRow { id: string; status: string; summary: string | null; payload: Record<string, unknown> | null; target: string | null; order_id: string | null; owner_id: string | null }

async function pendingQueueRow(db: JobsDb, poId: string, kind: PoMailKind = "issue"): Promise<QueueRow | null> {
  const { data } = await db.from("approval_queue").select("id, status, summary, payload, target, order_id, owner_id")
    .eq("purchase_order_id", poId).eq("status", "pending");
  return ((data ?? []) as QueueRow[]).find((r) => ((r.payload?.kind as string | undefined) ?? "issue") === kind) ?? null;
}

/** Zabere čekající řádek fronty (approved / auto_executed); null = nikdo nečekal (už vyřízeno). */
async function claimQueue(db: JobsDb, rowId: string, status: "approved" | "auto_executed"): Promise<boolean> {
  const { data } = await db.from("approval_queue").update({ status, resolved_at: new Date().toISOString() } as never)
    .eq("id", rowId).eq("status", "pending").select("id");
  return Boolean(((data ?? []) as unknown[]).length);
}

async function releaseQueue(db: JobsDb, row: QueueRow, reason: string): Promise<void> {
  const base = (row.summary ?? "").replace(/ · Odeslání selhalo: .*$/, "");
  await db.from("approval_queue").update({
    status: "pending", resolved_at: null, summary: `${base} · Odeslání selhalo: ${reason}`.slice(0, 1000),
  } as never).eq("id", row.id);
}

/** Doplní e-mail (předmět, text s podpisem, příloha) do čekajícího řádku fronty objednávky. */
export async function fillQueueMail(db: JobsDb, poId: string, signerId: string | null, fallback: { name?: string | null } = {}): Promise<void> {
  const row = await pendingQueueRow(db, poId, "issue");
  if (!row || row.payload?.edited) return;
  const po = await fetchPurchaseOrder(db, poId);
  if (!po) return;
  // náhled ve frontě podepsaný tím, kdo objednávku vyřizuje (zaměstnanec, který předal, ne)
  const signer = (await hasPriceRole(db, signerId)) ? signerId : (await purchaseOrderContactId(db, po)) ?? signerId;
  const mail = await purchaseOrderMailFor(db, po, signer, "issue", { fallbackName: fallback.name ?? null });
  const payload = { ...(row.payload ?? {}), kind: "issue", purchaseOrderId: po.id, number: po.number, to: mail.to, subject: mail.subject, body: mail.body, attachmentName: mail.attachmentName, ...(signer ? { senderId: signer } : {}) };
  await db.from("approval_queue").update({ payload, target: mail.to || row.target } as never).eq("id", row.id);
}

/**
 * Komu a co poslat z řádku fronty: upravený řádek (člověk opravil příjemce / text) má přednost — příjemce
 * je `target` (to, co vidí a opravuje ve frontě); neupravený se staví znovu (aktuální e-mail z adresáře,
 * podpis skutečného odesílatele), uložený příjemce jen jako záloha.
 */
export function queueMail(row: Pick<QueueRow, "payload" | "target"> | null, built: { to: string; subject: string; body: string }):
  { to: string; subject: string; body: string } {
  const p = row?.payload ?? {};
  const target = (row?.target ?? "").trim();
  const saved = String(p.to ?? "").trim();
  if (p.edited) {
    return { to: target || saved || built.to, subject: String(p.subject ?? "") || built.subject, body: String(p.body ?? "") || built.body };
  }
  return { to: built.to || target || saved, subject: built.subject, body: built.body };
}

const SENT_PO: PurchaseOrderStatus[] = ["odeslana", "potvrzena", "dodana"];

/**
 * Odeslat objednávku teď — vždy jen po vyhraném zabrání řádku fronty („issue"): čekající řádek se zabere;
 * bez něj (zamítnutý dřív, starší objednávka) se založí a zabere nový. Odeslanou objednávku znovu nepošle
 * (jen výslovně `resend`), objednávku, kterou právě posílá někdo jiný, taky ne. Při chybě (i výjimce) se
 * řádek vrátí do fronty s důvodem.
 */
export async function sendQueuedPurchaseOrder(db: JobsDb, sender: { id: string; fullName: string; mailAll: boolean }, poId: string,
  opts: { status?: "approved" | "auto_executed"; mail?: Partial<{ to: string; cc: string; subject: string; body: string }>; via?: "rucne" | "automaticky"; eventData?: Row; resend?: boolean } = {}):
  Promise<{ ok: true; emailId?: string; queueId: string | null } | { ok: false; error: string; queueId: string | null }> {
  const po = await fetchPurchaseOrder(db, poId);
  if (!po) return { ok: false, error: "Objednávka nenalezena.", queueId: null };
  if (po.status === "zrusena") return { ok: false, error: "Zrušenou objednávku nelze odeslat.", queueId: null };
  if (SENT_PO.includes(po.status) && !opts.resend) {
    return { ok: false, error: `Objednávka ${po.number} už odešla dodavateli — znovu ji pošli jen výslovně z Nákupu.`, queueId: null };
  }
  const { data: jobRow } = await db.from("orders").select("owner_id").eq("id", po.jobId).maybeSingle();
  const ownerId = (jobRow as { owner_id: string | null } | null)?.owner_id ?? null;
  let row = await pendingQueueRow(db, poId, "issue");
  if (!row) {
    if (!opts.resend) {
      const { data: busy } = await db.from("approval_queue").select("id, payload").eq("purchase_order_id", poId).in("status", ["approved", "auto_executed"]);
      if (((busy ?? []) as { payload: Row | null }[]).some((r) => ((r.payload?.kind as string | undefined) ?? "issue") === "issue")) {
        return { ok: false, error: "Objednávku mezitím odesílá / odeslal někdo jiný — obnov stránku.", queueId: null };
      }
    }
    const mail0 = await purchaseOrderMailFor(db, po, sender.id, "issue", { fallbackName: sender.fullName });
    const { data: ins, error: insErr } = await db.from("approval_queue").insert({
      type: "purchase_order", title: `Objednávka ${po.number} — ${po.supplier?.name ?? "dodavatel"}`,
      summary: `požadovaný termín ${po.requiredDate ? shortDay(po.requiredDate) : "—"}`,
      payload: { kind: "issue", purchaseOrderId: po.id, number: po.number, to: mail0.to, subject: mail0.subject, body: mail0.body, attachmentName: mail0.attachmentName, senderId: sender.id },
      target: mail0.to || null, status: "pending", order_id: po.jobId, owner_id: ownerId ?? sender.id, purchase_order_id: po.id,
    } as never).select("id, status, summary, payload, target, order_id, owner_id");
    // souběh: řádek mezitím založil jiný požadavek → zabere se ten (nebo ho už zabral on)
    row = insErr ? await pendingQueueRow(db, poId, "issue") : (((ins ?? []) as QueueRow[])[0] ?? null);
    if (!row) return { ok: false, error: "Objednávku mezitím vyřídil někdo jiný — obnov stránku.", queueId: null };
  }
  if (!(await claimQueue(db, row.id, opts.status ?? "approved"))) {
    return { ok: false, error: "Objednávku mezitím vyřídil někdo jiný — obnov stránku.", queueId: row.id };
  }
  const claimed = row;
  try {
    const who = await purchaseOrderSender(db, sender, ownerId);
    const built = await purchaseOrderMailFor(db, po, who.signerId, "issue", { fallbackName: sender.fullName });
    const fromRow = queueMail(claimed, built);
    const mail = {
      to: opts.mail?.to ?? fromRow.to,
      cc: opts.mail?.cc,
      subject: opts.mail?.subject ?? fromRow.subject,
      body: opts.mail?.body ?? fromRow.body,
    };
    // PDF musí uvádět toho, kdo opravdu posílá (potvrzení dodavatele s cenami jde jemu)
    // (sendPurchaseOrderCore si objednávku načte znovu — příloha je pak nová verze PDF)
    if (po.fileId && (await hasPriceRole(db, who.signerId)) && (await purchaseOrderContactId(db, po)) !== who.signerId) {
      const stored = await storePurchaseOrderPdfCore(db, { id: sender.id, fullName: sender.fullName }, po, { replaceFileId: po.fileId, contactId: who.signerId });
      if ("error" in stored) console.error(`[handoff] PDF objednávky ${po.number} s odesílatelem se nepřegenerovalo: ${stored.error}`);
    }
    const res = await sendPurchaseOrderCore(db, { id: sender.id, fullName: sender.fullName }, poId, mail, {
      from: who.from, via: opts.via ?? "rucne", kind: "issue", eventData: { ...(opts.eventData ?? {}), queueId: claimed.id },
      auditActor: { id: sender.id, kind: "user", via: opts.via === "automaticky" ? "automaticky" : "rucne" },
    });
    if (!res.ok) {
      await releaseQueue(db, claimed, res.error);
      return { ok: false, error: res.error, queueId: claimed.id };
    }
    return { ok: true, ...(res.emailId ? { emailId: res.emailId } : {}), queueId: claimed.id };
  } catch (err) {
    await releaseQueue(db, claimed, err instanceof Error ? err.message : String(err)).catch(() => undefined);
    throw err;
  }
}

/**
 * Vyřízení řádku fronty „Objednávka dodavateli" (schválit = odeslat; zamítnout = objednávka zůstává vystavená).
 * Vystavení jde přes sendQueuedPurchaseOrder (schránka obchodníka zakázky, podpis odesílatele); změna /
 * storno / pozastavení stejným jádrem s druhem e-mailu. Oprávnění hlídá volající.
 */
export async function resolvePurchaseOrderQueue(db: JobsDb, sender: { id: string; fullName: string; mailAll: boolean }, rowId: string,
  action: "approved" | "rejected"): Promise<{ ok: true; sent: boolean } | { ok: false; error: string }> {
  const { data } = await db.from("approval_queue").select("id, status, summary, payload, target, order_id, owner_id, purchase_order_id").eq("id", rowId).maybeSingle();
  const row = data as (QueueRow & { purchase_order_id: string | null }) | null;
  if (!row || !row.purchase_order_id) return { ok: false, error: "Položka fronty nenalezena." };
  if (row.status !== "pending") return { ok: false, error: "Položku už někdo vyřídil — obnov stránku." };
  const kind = ((row.payload?.kind as PoMailKind | undefined) ?? "issue");
  const po = await fetchPurchaseOrder(db, row.purchase_order_id);
  if (!po) return { ok: false, error: "Objednávka z této položky už neexistuje — položku zamítni." };

  if (action === "rejected") {
    const { data: upd } = await db.from("approval_queue").update({ status: "rejected", resolved_at: new Date().toISOString() } as never)
      .eq("id", rowId).eq("status", "pending").select("id");
    if (!((upd ?? []) as unknown[]).length) return { ok: false, error: "Položku už někdo vyřídil — obnov stránku." };
    const what = kind === "issue" ? "Odeslání objednávky" : kind === "change" ? "Odeslání změny objednávky" : kind === "cancel" ? "Storno objednávky" : "Pozastavení objednávky";
    await logJobEvent(db, {
      jobId: po.jobId, type: "field", message: `${what} ${po.number} zamítnuto (${sender.fullName})`,
      data: { purchaseOrderId: po.id, queueId: rowId, mailKind: kind, rejected: true }, actorId: sender.id, entity: "purchase_order", entityId: po.id,
    });
    return { ok: true, sent: false };
  }

  if (kind === "issue") {
    const r = await sendQueuedPurchaseOrder(db, sender, po.id, { status: "approved", eventData: { queueId: rowId } });
    return r.ok ? { ok: true, sent: true } : { ok: false, error: r.error };
  }
  if (!(await claimQueue(db, rowId, "approved"))) return { ok: false, error: "Položku už někdo vyřídil — obnov stránku." };
  const { data: jobRow } = await db.from("orders").select("owner_id").eq("id", po.jobId).maybeSingle();
  const who = await purchaseOrderSender(db, sender, (jobRow as { owner_id: string | null } | null)?.owner_id ?? null);
  const p = row.payload ?? {};
  const built = await purchaseOrderMailFor(db, { ...po, revision: cleanNumber(p.revision) ?? undefined }, who.signerId, kind, {
    previousRequiredDate: (p.previousRequiredDate as string | undefined) ?? null, reason: (p.reason as string | undefined) ?? null, fallbackName: sender.fullName,
  });
  const mail = queueMail(row, built);
  try {
    const res = await sendPurchaseOrderCore(db, { id: sender.id, fullName: sender.fullName }, po.id, mail, {
      from: who.from, kind, reason: (p.reason as string | undefined) ?? null, eventData: { queueId: rowId },
    });
    if (!res.ok) {
      await releaseQueue(db, row, res.error);
      return { ok: false, error: res.error };
    }
  } catch (err) {
    await releaseQueue(db, row, err instanceof Error ? err.message : String(err)).catch(() => undefined);
    throw err;
  }
  return { ok: true, sent: true };
}

/**
 * Storno objednávky u dodavatele (odeslaná objednávka, kterou server ruší — ukončení výroby, výměna
 * dodavatele): e-mail hned ze schránky podle pravidel odesílatele; když neodejde, řádek fronty „cancel"
 * (DB ho sama nevyřídí). Objednávka je po návratu vždy „Zrušena".
 */
export async function stornoPurchaseOrderCore(db: JobsDb, actor: { id: string; fullName: string; mailAll: boolean }, poId: string,
  opts: { cancelReason: string; mailReason?: string | null }): Promise<{ send: "odeslano" | "ceka_ve_fronte"; sendError?: string; number: string } | null> {
  const po = await fetchPurchaseOrder(db, poId);
  if (!po || po.status === "dodana") return null;
  const { data: jobRow } = await db.from("orders").select("owner_id").eq("id", po.jobId).maybeSingle();
  const ownerId = (jobRow as { owner_id: string | null } | null)?.owner_id ?? null;
  const sender = await purchaseOrderSender(db, { id: actor.id, mailAll: actor.mailAll }, ownerId);
  const mail = await purchaseOrderMailFor(db, po, sender.signerId, "cancel", { reason: opts.mailReason ?? null, fallbackName: actor.fullName });
  let error: string;
  try {
    const res = await sendPurchaseOrderCore(db, { id: actor.id, fullName: actor.fullName }, poId, mail, { from: sender.from, kind: "cancel", reason: opts.cancelReason });
    if (res.ok) return { send: "odeslano", number: po.number };
    error = res.error;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  await db.from("purchase_orders").update({ status: "zrusena", cancel_reason: opts.cancelReason } as never).eq("id", poId).neq("status", "zrusena");
  const { error: qErr } = await db.from("approval_queue").insert({
    type: "purchase_order", title: `Storno objednávky ${po.number} — ${po.supplier?.name ?? "dodavatel"}`,
    summary: `${opts.cancelReason} · Odeslání selhalo: ${error}`.slice(0, 1000),
    payload: { kind: "cancel", purchaseOrderId: poId, number: po.number, to: mail.to, subject: mail.subject, body: mail.body, reason: opts.mailReason ?? null },
    target: mail.to || null, status: "pending", order_id: po.jobId, owner_id: ownerId ?? actor.id, purchase_order_id: poId,
  } as never);
  if (qErr && !/duplicate|unique/i.test(qErr.message)) console.error(`[handoff] Storno ${po.number} do fronty: ${qErr.message}`);
  await logJobEvent(db, {
    jobId: po.jobId, type: "field", message: `Storno objednávky ${po.number} čeká na odeslání dodavateli (${error})`.slice(0, 500),
    data: { purchaseOrderId: poId, mailKind: "cancel", queued: true }, actorId: actor.id, entity: "purchase_order", entityId: poId,
  });
  return { send: "ceka_ve_fronte", sendError: error, number: po.number };
}

// ── Jádro předání ───────────────────────────────────────────
type RpcError = { message: string; hint?: string | null; code?: string | null; details?: string | null };

async function callApply(db: JobsDb, jobId: string, input: HandoffInput, payload: ProductionApplyPayload): Promise<{ data: ProductionApplyResult | null; error: RpcError | null }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const rpc = db.rpc("production_apply", {
      p_job: jobId, p_token: input.token, p_kind: input.kind, p_expected_stage: input.expectedStage,
      p_expected_route: input.expectedRouteVersion, p_payload: payload as never,
    });
    const { data, error } = await withChangeNote(rpc, payload.note ?? null);
    if (error && (error as RpcError).code === "40P01" && attempt === 0) continue;   // deadlock → jednou znovu
    return { data: (data as ProductionApplyResult | null) ?? null, error: (error as RpcError | null) ?? null };
  }
  return { data: null, error: { message: "Souběh — zkus to znovu." } };
}

async function stageChangedMessage(db: JobsDb, jobId: string): Promise<string> {
  const { data } = await db.from("orders").select("stage_changed_at, stager:profiles!stage_changed_by(id, full_name, email)").eq("id", jobId).maybeSingle();
  const row = data as { stage_changed_at: string | null; stager?: unknown } | null;
  const who = personRef(row?.stager as never)?.name;
  const at = row?.stage_changed_at ? new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague", hour: "2-digit", minute: "2-digit" }).format(new Date(row.stage_changed_at)) : null;
  return who ? `Zakázku mezitím změnil ${who}${at ? ` (${at})` : ""} — obnov stránku.` : "Stav zakázky se mezitím změnil — obnov stránku.";
}

export type CoreResult = { ok: true; result: HandoffResult } | { ok: false; error: string; code: HandoffErrorCode; issues?: HandoffIssue[] };

/**
 * Předání do výroby (všechny druhy): kontrola → payload → RPC production_apply (jedna transakce) →
 * po potvrzení PDF objednávek, e-mail do fronty, odeslání podle režimu (výchozí se schválením;
 * obchodník/admin může „Rovnou odeslat"; plná automatika jen bezpečné objednávky) → audit.
 * Opakování stejného tokenu (dvojklik, síť) jen doplní dokumenty — nikdy neposílá podruhé.
 */
export async function productionHandoffCore(db: JobsDb, actor: HandoffActor, jobId: string, input: HandoffInput,
  opts: { source?: "ui" | "capture" | "ai" | "automatika"; ctx?: HandoffContext } = {}): Promise<CoreResult> {
  if (!isUuid(jobId)) return { ok: false, error: "Zakázka nenalezena.", code: "VALIDATION" };
  const ctx = opts.ctx ?? await loadHandoffContext(db, jobId);
  if (!ctx) return { ok: false, error: "Zakázka nenalezena.", code: "VALIDATION" };

  // opakovaný token: výsledek prvního volání (RPC vrátí replayed) — bez nové kontroly vstupu
  const { data: prev } = await db.from("production_handoffs").select("id, job_id").eq("token", input?.token ?? "").maybeSingle();
  let built: Awaited<ReturnType<typeof buildApplyPayload>> | null = null;
  if (!prev) {
    built = await buildApplyPayload(db, ctx, input, actor, { relaxFinal: opts.source !== undefined && opts.source !== "ui" });
    if ("error" in built) return { ok: false, error: built.error, code: built.code, ...(built.issues ? { issues: built.issues } : {}) };
    // focení / AI objednávku dodavateli NIKDY nevystaví (B.4) — jen použije existující nebo „objednáno jinak"
    if ((opts.source === "capture" || opts.source === "ai") && built.payload.purchaseOrders?.length) {
      return { ok: false, error: "Z vyfoceného dokladu se objednávka dodavateli nevystavuje — předej do výroby ručně.", code: "VALIDATION" };
    }
  } else if ((prev as { job_id: string }).job_id !== jobId) {
    return { ok: false, error: "Neplatný požadavek.", code: "VALIDATION" };
  }

  const { data, error } = await callApply(db, jobId, input, built ? built.payload : {});
  if (error || !data) {
    const code = handoffErrorCode(error) ?? "VALIDATION";
    let message = error?.message ?? "Předání se nepodařilo uložit.";
    if (code === "STAGE_CHANGED" && /mezitím změnil/.test(message)) message = await stageChangedMessage(db, jobId);
    if (/uq_job_operations_final/.test(message)) message = "Konečný termín (zákazník) může mít jen poslední krok výroby.";
    return { ok: false, error: message, code, ...(built && "issues" in built ? { issues: built.issues } : {}) };
  }

  const result: HandoffResult = {
    handoffId: data.handoffId, replayed: Boolean(data.replayed), kind: data.kind ?? input.kind, stage: data.stage,
    operationIds: data.operationIds ?? [], startedOperationId: data.startedOperationId ?? null, completedOperationId: data.completedOperationId ?? null,
    purchaseOrders: [], issues: built && !("error" in built) ? built.issues.filter((x) => x.level !== "error") : [],
  };
  const author = { id: (actor.id ?? ctx.job.ownerId) as string, fullName: actor.fullName };

  if (result.replayed) {
    const docs = await ensureHandoffDocumentsCore(db, actor, jobId, result.handoffId);
    result.purchaseOrders = docs;
    return { ok: true, result };
  }

  // použitá (existující) objednávka: poznámky pro dodavatele z Technologie se do ní doplní (neodeslaná — nové PDF)
  const reusedPoIds = [...new Set((input.steps ?? []).map((s) => (s.po?.mode === "existujici" ? s.po.existingId : null)).filter((x): x is string => isUuid(x)))];
  if (reusedPoIds.length) {
    try {
      const notes = await syncPurchaseOrderSupplierNotes(db, author, jobId, { poIds: reusedPoIds });
      if (notes.sent.length) {
        result.issues.push({ code: "route_health", level: "warning", message: `Objednávka ${notes.sent.join(", ")} už odešla — poznámky pro dodavatele pošli dodavateli zvlášť.` });
      }
    } catch (err) {
      console.error(`[handoff] poznámky do objednávky: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const metas = built && !("error" in built) ? built.groups : [];
  const sendNow = new Set(actor.margins ? (input.sendNow ?? []) : []);
  const mode = (data.purchaseOrders ?? []).length ? await purchaseOrderMode(db) : "approval";
  // odkud by objednávka odešla (schránka obchodníka zakázky, jinak moje) — stejně jako sendQueuedPurchaseOrder
  const senderBox = actor.margins && actor.id && (data.purchaseOrders ?? []).length
    ? (await purchaseOrderSender(db, { id: actor.id }, ctx.job.ownerId)).mailboxEmail : null;
  for (const p of data.purchaseOrders ?? []) {
    const meta = metas.find((m) => m.group === p.group) ?? null;
    const out: HandoffResult["purchaseOrders"][number] = {
      id: p.id, number: p.number, supplierName: p.supplierName, fileId: null, pdf: "ok", send: "ceka_na_schvaleni", queueId: p.queueId ?? null,
    };
    try {
      const po = await fetchPurchaseOrder(db, p.id);
      const stored = po ? await storePurchaseOrderPdfCore(db, author, po, { onlyIfMissing: true }) : { error: "Objednávka nenalezena." };
      if ("error" in stored) { out.pdf = "chyba"; console.error(`[handoff] PDF objednávky ${p.number}: ${stored.error}`); }
      else out.fileId = stored.fileId;
    } catch (err) {
      out.pdf = "chyba";
      console.error(`[handoff] PDF objednávky ${p.number}: ${err instanceof Error ? err.message : String(err)}`);
    }
    await fillQueueMail(db, p.id, actor.id, { name: actor.fullName });

    const human = Boolean(meta && (sendNow.has(meta.group) || sendNow.has("*") || meta.stepKeys.some((k) => sendNow.has(k))));
    const blockers = meta ? autoSendBlockers({
      unpricedItems: meta.unpriced, quoteExpired: meta.quoteExpired, partialCoverage: meta.partialCoverage, whoSource: meta.whoSource,
      supplierEmail: meta.supplierEmail, senderUsable: Boolean(senderBox), cheaperQuote: meta.cheaperQuote, hasQuote: meta.hasQuote,
    }) : ["neznámá objednávka"];
    const auto = !human && mode === "full" && actor.margins && blockers.length === 0;
    if ((human || auto) && actor.id) {
      const r = await sendQueuedPurchaseOrder(db, { id: actor.id, fullName: actor.fullName, mailAll: actor.mailAll }, p.id, {
        status: human ? "approved" : "auto_executed", via: human ? "rucne" : "automaticky", eventData: { handoffId: result.handoffId, auto },
      });
      if (r.ok) out.send = "odeslano";
      else { out.send = "neodeslano"; out.sendError = r.error; }
    } else if (mode === "full") {
      const why = !actor.margins ? ["objednávku odešle obchodník nebo admin"] : blockers;
      const row = await pendingQueueRow(db, p.id, "issue");
      if (row) {
        await db.from("approval_queue").update({ summary: `${row.summary ?? ""} · Neodesláno automaticky: ${why.join(" | ")}`.slice(0, 1000) } as never).eq("id", row.id);
      }
    }
    if (out.send === "ceka_na_schvaleni" && out.queueId) {
      await logJobEvent(db, {
        jobId, type: "field", message: `Objednávka ${p.number} čeká na odeslání (schválení)`,
        data: { purchaseOrderId: p.id, queueId: out.queueId, handoffId: result.handoffId }, actorId: actor.id, entity: "purchase_order", entityId: p.id,
      });
    }
    await logAudit({
      action: "purchase_order_issued", entity: "purchase_orders", entityId: p.id,
      diff: { jobId, number: p.number, supplierId: p.supplierId, handoffId: result.handoffId, itemCount: meta ? undefined : null, auto: true },
      actor: actor.id ? { id: actor.id, kind: actor.via === "ai" || actor.via === "foto" ? "ai" : "user", via: actor.via } : null,
    });
    result.purchaseOrders.push(out);
  }
  // ukončení výroby: odeslané objednávky, které RPC zrušilo (jen s „margins"), musí dostat storno e-mailem (C.3)
  if (result.kind === "ukonceni" && actor.margins && actor.id && input.finish?.cancelSentPurchaseOrderIds?.length) {
    const stornos: NonNullable<HandoffResult["stornos"]> = [];
    for (const id of [...new Set(input.finish.cancelSentPurchaseOrderIds)]) {
      const before = ctx.purchaseOrders.find((p) => p.id === id);
      if (!before || (before.status !== "odeslana" && before.status !== "potvrzena")) continue;
      const { data: now } = await db.from("purchase_orders").select("status").eq("id", id).maybeSingle();
      if ((now as { status: string } | null)?.status !== "zrusena") continue;
      const s = await stornoPurchaseOrderCore(db, { id: actor.id, fullName: actor.fullName, mailAll: actor.mailAll }, id, {
        cancelReason: "Výroba ukončena dřív — krok přeskočen", mailReason: null,
      });
      if (s) stornos.push({ id, number: s.number, send: s.send, ...(s.sendError ? { sendError: s.sendError } : {}) });
    }
    if (stornos.length) result.stornos = stornos;
  }
  await logAudit({
    action: "production_handoff", entity: "production_handoffs", entityId: result.handoffId,
    diff: { jobId, kind: result.kind, handoffId: result.handoffId, operationIds: result.operationIds, source: opts.source ?? "ui" },
    actor: actor.id ? { id: actor.id, kind: "user", via: actor.via } : null,
  });
  return { ok: true, result };
}

/**
 * Doplní dokumenty předání (idempotentně, NIKDY neodesílá): chybějící PDF objednávek a chybějící řádky
 * fronty ke schválení u vystavených objednávek (zamítnutý řádek se neobnovuje).
 */
export async function ensureHandoffDocumentsCore(db: JobsDb, actor: HandoffActor, jobId: string, handoffId: string): Promise<HandoffResult["purchaseOrders"]> {
  const out: HandoffResult["purchaseOrders"] = [];
  if (!isUuid(handoffId)) return out;
  const { data: h } = await db.from("production_handoffs").select("id, job_id").eq("id", handoffId).maybeSingle();
  if (!h || (h as { job_id: string }).job_id !== jobId) return out;
  const { data: pos } = await db.from("purchase_orders").select("id").eq("handoff_id", handoffId).order("created_at");
  const { data: jobRow } = await db.from("orders").select("owner_id").eq("id", jobId).maybeSingle();
  const ownerId = (jobRow as { owner_id: string | null } | null)?.owner_id ?? null;
  for (const { id } of (pos ?? []) as { id: string }[]) {
    const po = await fetchPurchaseOrder(db, id);
    if (!po) continue;
    const item: HandoffResult["purchaseOrders"][number] = {
      id, number: po.number, supplierName: po.supplier?.name ?? "", fileId: po.fileId, pdf: "ok", send: "neodeslano", queueId: null,
    };
    if (po.status !== "zrusena" && !po.fileId) {
      try {
        const stored = await storePurchaseOrderPdfCore(db, { id: (actor.id ?? ownerId) as string, fullName: actor.fullName }, po, { onlyIfMissing: true });
        if ("error" in stored) item.pdf = "chyba";
        else item.fileId = stored.fileId;
      } catch {
        item.pdf = "chyba";
      }
    }
    const { data: rows } = await db.from("approval_queue").select("id, status, payload").eq("purchase_order_id", id);
    const issueRows = ((rows ?? []) as { id: string; status: string; payload: Record<string, unknown> | null }[])
      .filter((r) => ((r.payload?.kind as string | undefined) ?? "issue") === "issue");
    const pending = issueRows.find((r) => r.status === "pending");
    if (po.status === "vystavena" && !issueRows.length) {
      const mail = await purchaseOrderMailFor(db, po, actor.id, "issue", { fallbackName: actor.fullName });
      const { data: ins } = await db.from("approval_queue").insert({
        type: "purchase_order", title: `Objednávka ${po.number} — ${po.supplier?.name ?? "dodavatel"}`, summary: `požadovaný termín ${po.requiredDate ? shortDay(po.requiredDate) : "—"}`,
        payload: { kind: "issue", purchaseOrderId: id, number: po.number, to: mail.to, subject: mail.subject, body: mail.body, attachmentName: mail.attachmentName },
        target: mail.to || null, status: "pending", order_id: jobId, owner_id: ownerId ?? actor.id, purchase_order_id: id,
      } as never).select("id");
      item.queueId = ((ins ?? []) as { id: string }[])[0]?.id ?? null;
    } else if (pending) {
      item.queueId = pending.id;
      if (!pending.payload?.body) await fillQueueMail(db, id, actor.id, { name: actor.fullName });
    }
    item.send = ["odeslana", "potvrzena", "dodana"].includes(po.status) ? "odeslano" : item.queueId ? "ceka_na_schvaleni" : "neodeslano";
    out.push(item);
  }
  return out;
}

// ── Poznámky pro dodavatele → objednávka (Technologie) ──────
/**
 * Poznámky pro dodavatele (Technologie) do objednávek zakázky: neodeslaná objednávka (návrh / vystavená)
 * dostane u položky „Pozor: …", nové PDF (nová verze) a znovu sestavený e-mail ve frontě. Odeslaná se
 * nemění — vrátí se její číslo (poznámku je třeba poslat dodavateli zvlášť). Položka objednávky ↔ položka
 * zakázky: order_item_id, jinak číslo výkresu. `itemIds` = jen tyto položky zakázky, `poIds` = jen tyto objednávky.
 */
export async function syncPurchaseOrderSupplierNotes(db: JobsDb, author: { id: string | null; fullName: string }, jobId: string,
  opts: { poIds?: string[]; itemIds?: string[] } = {}): Promise<{ updated: string[]; sent: string[] }> {
  const out = { updated: [] as string[], sent: [] as string[] };
  if (!isUuid(jobId)) return out;
  const { data: itemRows } = await db.from("order_items").select("id, drawing_number, supplier_note").eq("order_id", jobId);
  const items = ((itemRows ?? []) as Row[]).map((r) => ({ id: String(r.id), drawing: normalizeDrawingNumber(cleanText(r.drawing_number, 120)), note: cleanText(r.supplier_note, 1000) }));
  if (!items.length) return out;
  const onlyItems = opts.itemIds ? new Set(opts.itemIds) : null;
  const pos = (await fetchPurchaseOrders(db, jobId))
    .filter((p) => p.status !== "zrusena" && p.status !== "dodana" && (!opts.poIds || opts.poIds.includes(p.id)));
  for (const po of pos) {
    const changes: { id: string; note: string | null }[] = [];
    for (const it of po.items) {
      if (!it.id) continue;
      const d = normalizeDrawingNumber(it.drawingNumber);
      const byDrawing = d ? items.filter((x) => x.drawing === d) : [];
      const item = (it.orderItemId ? items.find((x) => x.id === it.orderItemId) : null) ?? (byDrawing.length === 1 ? byDrawing[0] : null);
      if (!item || (onlyItems && !onlyItems.has(item.id))) continue;
      const next = [supplierNoteSegment(item.note), splitItemNote(it.note).rest].filter(Boolean).join(" · ") || null;
      if ((next ?? null) !== ((it.note ?? "").trim() || null)) changes.push({ id: it.id, note: next });
    }
    if (!changes.length) continue;
    if (!isPurchaseOrderEditable(po.status)) { out.sent.push(po.number); continue; }
    let failed = false;
    for (const c of changes) {
      const { error } = await db.from("purchase_order_items").update({ note: c.note } as never).eq("id", c.id).eq("purchase_order_id", po.id);
      if (error) { failed = true; console.error(`[notes] objednávka ${po.number}: ${error.message}`); break; }
    }
    if (failed) continue;
    out.updated.push(po.number);
    const fresh = await fetchPurchaseOrder(db, po.id);
    const signer = author.id ?? (await purchaseOrderContactId(db, po));
    if (fresh && signer) {
      try {
        const stored = await storePurchaseOrderPdfCore(db, { id: signer, fullName: author.fullName }, fresh, { replaceFileId: po.fileId });
        if ("error" in stored) console.error(`[notes] PDF objednávky ${po.number}: ${stored.error}`);
      } catch (err) {
        console.error(`[notes] PDF objednávky ${po.number}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await fillQueueMail(db, po.id, author.id, { name: author.fullName });
    await logJobEvent(db, {
      jobId, type: "field", message: `Objednávka ${po.number}: poznámky pro dodavatele doplněny (nové PDF)`,
      data: { purchaseOrderId: po.id, fields: ["item_note"], items: changes.length }, actorId: author.id, entity: "purchase_order", entityId: po.id,
    });
  }
  return out;
}

// ── Změna kroku s objednávkou (E.5) ─────────────────────────
export interface StepPoChange {
  who?: boolean;
  deadline?: boolean;
  /** Odeslaná objednávka + jiný dodavatel: stornovat a vystavit novou (jen obchodník/admin). */
  confirmReplace?: boolean;
  /** Poslat dodavateli změnu / storno hned (jinak čeká ve frontě). */
  notifySupplier?: boolean;
  /** Termín před změnou (do e-mailu „mění se z … na …"). */
  previousEnd?: string | null;
}

/** Smí se změnit, kdo krok dělá, když má krok objednávku? Kontrola PŘED zápisem kroku. */
export async function checkStepPurchaseOrderChange(db: JobsDb, actor: Pick<HandoffActor, "margins">, operationId: string,
  change: { who?: boolean; deadline?: boolean; confirmReplace?: boolean }): Promise<string | null> {
  const { data } = await db.from("job_operations").select("id, purchase_order_id").eq("id", operationId).maybeSingle();
  const poId = (data as { purchase_order_id: string | null } | null)?.purchase_order_id ?? null;
  if (!poId) return null;
  const { data: p } = await db.from("purchase_orders").select("id, number, status").eq("id", poId).maybeSingle();
  const po = p as { number: string | null; status: PurchaseOrderStatus } | null;
  if (!po || po.status === "zrusena") return null;
  if (change.who) {
    if (po.status === "dodana") return "Objednávka je dodaná — krok už nejde přeobjednat.";
    if (!actor.margins) return `Krok má objednávku ${po.number ?? ""} — dodavatele změní obchodník nebo admin.`.replace("  ", " ");
    if (!isPurchaseOrderEditable(po.status) && !change.confirmReplace) {
      return `Objednávka ${po.number ?? ""} už odešla dodavateli — změnu dodavatele potvrď (stará se stornuje a vystaví se nová).`;
    }
  }
  return null;
}

/**
 * Po změně dodavatele / termínu kroku s objednávkou (E.5): neodeslaná objednávka se upraví (dodavatel,
 * položky, požadovaný termín, nové PDF, e-mail ve frontě); odeslaná: termín → změna objednávky (revize,
 * PDF „změna N", stav kroku „změna čeká") poslaná hned nebo ve frontě; dodavatel → storno + nová objednávka.
 */
export async function syncStepPurchaseOrder(db: JobsDb, actor: HandoffActor, operationId: string, change: StepPoChange):
  Promise<{ ok: true; hint?: string } | { ok: false; error: string }> {
  const { data: opData } = await db.from("job_operations").select("id, job_id, kind, title, supplier_id, supplier_name, in_house, planned_end, purchase_order_id, supplier_quote_id, order_item_ids, status, position").eq("id", operationId).maybeSingle();
  const op = opData as Row | null;
  if (!op || !op.purchase_order_id) return { ok: true };
  const jobId = String(op.job_id);
  const po = await fetchPurchaseOrder(db, String(op.purchase_order_id));
  if (!po || po.status === "zrusena") return { ok: true };
  const author = { id: (actor.id ?? "") as string, fullName: actor.fullName };
  const hints: string[] = [];
  const { data: linkedData } = await db.from("job_operations").select("id, planned_end, position, created_at, status").eq("purchase_order_id", po.id).order("position").order("created_at");
  const linked = ((linkedData ?? []) as Row[]).filter((x) => x.status !== "preskoceno");
  const lastLinked = linked[linked.length - 1] ?? op;
  const newRequired = cleanDate(lastLinked.planned_end);

  // dodavatel
  if (change.who) {
    const newSupplier = op.in_house ? null : (op.supplier_id as string | null);
    if (newSupplier !== (po.supplier?.id ?? null)) {
      if (po.status === "dodana") return { ok: false, error: "Objednávka je dodaná — krok už nejde přeobjednat." };
      if (!actor.margins) return { ok: false, error: `Krok má objednávku ${po.number} — dodavatele změní obchodník nebo admin.` };
      if (isPurchaseOrderEditable(po.status)) {
        if (!newSupplier) {
          // krok jde k nám / k firmě mimo adresář → objednávka u původní firmy se ruší, krok ji pustí
          await db.from("purchase_orders").update({ status: "zrusena", cancel_reason: "Krok výroby změnil dodavatele" } as never).eq("id", po.id);
          await db.from("job_operations").update({ purchase_order_id: null } as never).eq("purchase_order_id", po.id);
          await logJobEvent(db, { jobId, type: "field", message: `Objednávka ${po.number} zrušena — krok dělá jiná firma`, data: { purchaseOrderId: po.id, reason: "who" }, actorId: actor.id, entity: "purchase_order", entityId: po.id });
          return { ok: true, hint: `Objednávka ${po.number} zrušena — vystav novou u nové firmy.` };
        }
        const ctx = await loadHandoffContext(db, jobId);
        if (!ctx) return { ok: false, error: "Zakázka nenalezena." };
        // nabídka nové firmy, kterou už nacenila jiná objednávka zakázky, se znovu nepočítá (položky bez ceny)
        const free = (x: SuggestQuote) => !quoteOnOtherPurchaseOrder(ctx, x.id, po.id);
        const q = ctx.quotes.find((x) => x.id === op.supplier_quote_id && x.supplierId === newSupplier && free(x))
          ?? ctx.quotes.find((x) => x.supplierId === newSupplier && free(x)) ?? null;
        const built = purchaseItemsForStep({
          step: { kind: isOperationKind(op.kind) ? op.kind : "vyroba", orderItemIds: (op.order_item_ids as string[] | null) ?? null },
          items: ctx.items, quote: q, includeUncovered: true,
        });
        const rows = poItemsToApply(built.items);
        const oldName = po.supplier?.name ?? "dodavatel";
        const newName = ctx.suppliers.get(newSupplier)?.name ?? "dodavatel";
        // výměna položek bez okna „objednávka bez položek": nejdřív nové, pak hlavička, nakonec staré pryč;
        // chyba kdekoli → vrátí se předchozí stav (volající vrátí i krok)
        const oldIds = po.items.map((it) => it.id).filter((x): x is string => Boolean(x));
        let newIds: string[] = [];
        if (rows.length) {
          const { data: ins, error: insErr } = await db.from("purchase_order_items").insert(rows.map((r) => ({ ...r, purchase_order_id: po.id })) as never).select("id");
          if (insErr) return { ok: false, error: `Položky objednávky ${po.number} se nepodařilo vyměnit: ${insErr.message}` };
          newIds = ((ins ?? []) as { id: string }[]).map((r) => r.id);
        }
        const total = rows.length ? r2(rows.reduce((s, it) => s + (it.unit_price ?? 0) * it.quantity, 0)) : po.total;
        const { error } = await db.from("purchase_orders").update({ supplier_id: newSupplier, supplier_quote_id: q?.id ?? null, total, ...(newRequired ? { required_date: newRequired } : {}) } as never).eq("id", po.id);
        if (error) {
          if (newIds.length) await db.from("purchase_order_items").delete().in("id", newIds);
          return { ok: false, error: error.message };
        }
        if (rows.length && oldIds.length) {
          const { error: delErr } = await db.from("purchase_order_items").delete().in("id", oldIds);
          if (delErr) {
            await db.from("purchase_order_items").delete().in("id", newIds);
            await db.from("purchase_orders").update({ supplier_id: po.supplier?.id ?? null, supplier_quote_id: po.supplierQuote?.id ?? null, total: po.total, required_date: po.requiredDate } as never).eq("id", po.id);
            return { ok: false, error: `Položky objednávky ${po.number} se nepodařilo vyměnit: ${delErr.message}` };
          }
        }
        await logJobEvent(db, { jobId, type: "field", message: `Objednávka ${po.number} upravena: dodavatel ${oldName} → ${newName}`, data: { purchaseOrderId: po.id, fields: ["supplier_id"] }, actorId: actor.id, entity: "purchase_order", entityId: po.id });
        const fresh = await fetchPurchaseOrder(db, po.id);
        if (fresh) {
          const stored = await storePurchaseOrderPdfCore(db, author, fresh, { replaceFileId: po.fileId });
          if ("error" in stored) hints.push(`PDF se nepodařilo přegenerovat: ${stored.error}`);
          const row = await pendingQueueRow(db, po.id, "issue");
          if (row) {
            const mail = await purchaseOrderMailFor(db, fresh, actor.id, "issue", { fallbackName: actor.fullName });
            await db.from("approval_queue").update({ target: mail.to || null, title: `Objednávka ${po.number} — ${newName}`, payload: { ...(row.payload ?? {}), to: mail.to, subject: mail.subject, body: mail.body } } as never).eq("id", row.id);
          }
        }
        return { ok: true, ...(hints.length ? { hint: hints.join(" ") } : {}) };
      }
      // odeslaná / potvrzená: storno + nová objednávka (krok už nese nového dodavatele — RPC ho jen potvrdí)
      if (!change.confirmReplace) return { ok: false, error: `Objednávka ${po.number} už odešla dodavateli — změnu dodavatele potvrď (stará se stornuje a vystaví se nová).` };
      const who: StepWho = op.in_house ? { type: "u_nas" } : newSupplier ? { type: "supplier", id: newSupplier }
        : cleanText(op.supplier_name, 300) ? { type: "free", name: String(op.supplier_name) } : { type: "none" };
      return replaceStepSupplierCore(db, actor, operationId, { who }, Boolean(change.notifySupplier ?? true));
    }
  }

  // termín
  if (change.deadline && newRequired && newRequired !== po.requiredDate) {
    if (po.status === "dodana") return { ok: true };
    if (isPurchaseOrderEditable(po.status)) {
      const { error } = await db.from("purchase_orders").update({ required_date: newRequired } as never).eq("id", po.id);
      if (error) return { ok: false, error: error.message };
      await logJobEvent(db, { jobId, type: "field", message: `Objednávka ${po.number}: požadovaný termín ${po.requiredDate ? shortDay(po.requiredDate) : "—"} → ${shortDay(newRequired)} (podle termínu kroku)`, data: { purchaseOrderId: po.id, fields: ["required_date"] }, actorId: actor.id, entity: "purchase_order", entityId: po.id });
      const fresh = await fetchPurchaseOrder(db, po.id);
      if (fresh) {
        const stored = await storePurchaseOrderPdfCore(db, author, fresh, { replaceFileId: po.fileId });
        if ("error" in stored) hints.push(`PDF se nepodařilo přegenerovat: ${stored.error}`);
        const row = await pendingQueueRow(db, po.id, "issue");
        if (row && !row.payload?.edited) {
          const mail = await purchaseOrderMailFor(db, fresh, (row.payload?.senderId as string | undefined) ?? actor.id, "issue", { fallbackName: actor.fullName });
          await db.from("approval_queue").update({ payload: { ...(row.payload ?? {}), subject: mail.subject, body: mail.body }, summary: (row.summary ?? "").replace(/požadovaný termín [^·]+/, `požadovaný termín ${shortDay(newRequired)}`) } as never).eq("id", row.id);
        }
      }
      return { ok: true, ...(hints.length ? { hint: hints.join(" ") } : {}) };
    }
    // odeslaná / potvrzená: změna objednávky (revize), krok „změna čeká". Dokud čeká neodeslaná změna,
    // další úprava termínu ji jen přepíše: stejné číslo změny a „mění se z" = termín, který dodavatel zná.
    const pendingChange = await pendingQueueRow(db, po.id, "change");
    const curRev = await currentRevision(db, po.id);
    const revision = pendingChange ? Math.max(2, cleanNumber(pendingChange.payload?.revision) ?? curRev) : curRev + 1;
    const previous = pendingChange ? (cleanDate(pendingChange.payload?.previousRequiredDate) ?? po.requiredDate) : po.requiredDate;
    const { error } = await db.from("purchase_orders").update({ required_date: newRequired, revision } as never).eq("id", po.id);
    if (error) return { ok: false, error: error.message };
    await db.from("job_operations").update({ deadline_state: "zmena_ceka" } as never).eq("purchase_order_id", po.id).in("status", ["ceka", "probiha", "problem"]);
    await logJobEvent(db, { jobId, type: "field", message: `Objednávka ${po.number} (změna ${revision}): požadovaný termín ${po.requiredDate ? shortDay(po.requiredDate) : "—"} → ${shortDay(newRequired)}`, data: { purchaseOrderId: po.id, fields: ["required_date", "revision"], revision }, actorId: actor.id, entity: "purchase_order", entityId: po.id });
    const fresh = await fetchPurchaseOrder(db, po.id);
    if (fresh) {
      const stored = await storePurchaseOrderPdfCore(db, author, fresh, { replaceFileId: po.fileId });
      if ("error" in stored) hints.push(`PDF změny se nepodařilo vytvořit: ${stored.error}`);
    }
    const freshPo = (await fetchPurchaseOrder(db, po.id)) ?? po;
    if (actor.margins && change.notifySupplier && actor.id) {
      // čekající změnu odeslání nahradí (zabere ji — nikdo ji nepošle podruhé)
      const claimed = pendingChange ? await claimQueue(db, pendingChange.id, "approved") : false;
      const { data: j } = await db.from("orders").select("owner_id").eq("id", jobId).maybeSingle();
      const sender = await purchaseOrderSender(db, { id: actor.id, mailAll: actor.mailAll }, (j as { owner_id: string | null } | null)?.owner_id ?? null);
      const mail = await purchaseOrderMailFor(db, { ...freshPo, revision }, sender.signerId, "change", { previousRequiredDate: previous, fallbackName: actor.fullName });
      const sent = await sendPurchaseOrderCore(db, author, po.id, mail, { from: sender.from, kind: "change", eventData: { revision, ...(claimed && pendingChange ? { queueId: pendingChange.id } : {}) } });
      if (sent.ok) return { ok: true, hint: `Změna objednávky ${po.number} odeslána dodavateli.` };
      if (claimed && pendingChange) await releaseQueue(db, pendingChange, sent.error);
      hints.push(`Změnu se nepodařilo odeslat (${sent.error}) — čeká ve frontě.`);
    }
    await queueChange(db, actor, jobId, { ...freshPo, revision }, previous);
    return { ok: true, hint: [`Termín se mění i v odeslané objednávce ${po.number} — změna čeká na odeslání dodavateli.`, ...hints].join(" ") };
  }
  return { ok: true };
}

async function currentRevision(db: JobsDb, poId: string): Promise<number> {
  const { data } = await db.from("purchase_orders").select("revision").eq("id", poId).maybeSingle();
  return num((data as { revision?: number } | null)?.revision) || 1;
}

/** Čekající řádek „change" (upsert: existující čekající změna dostane nový obsah). */
async function queueChange(db: JobsDb, actor: HandoffActor, jobId: string, po: PurchaseOrderView & { revision: number }, previous: string | null): Promise<void> {
  const signer = actor.margins ? actor.id : (await purchaseOrderContactId(db, po)) ?? actor.id;
  const mail = await purchaseOrderMailFor(db, po, signer, "change", { previousRequiredDate: previous, fallbackName: actor.fullName });
  const payload = { kind: "change", purchaseOrderId: po.id, number: po.number, revision: po.revision, to: mail.to, subject: mail.subject, body: mail.body, attachmentName: mail.attachmentName, previousRequiredDate: previous };
  const existing = await pendingQueueRow(db, po.id, "change");
  if (existing) {
    await db.from("approval_queue").update({ payload, target: mail.to || null, summary: `Změna ${po.revision} · požadovaný termín ${po.requiredDate ? shortDay(po.requiredDate) : "—"}` } as never).eq("id", existing.id);
    return;
  }
  const { data: j } = await db.from("orders").select("owner_id").eq("id", jobId).maybeSingle();
  await db.from("approval_queue").insert({
    type: "purchase_order", title: `Změna objednávky ${po.number} — ${po.supplier?.name ?? "dodavatel"}`,
    summary: `Změna ${po.revision} · požadovaný termín ${po.requiredDate ? shortDay(po.requiredDate) : "—"}`, payload, target: mail.to || null,
    status: "pending", order_id: jobId, owner_id: (j as { owner_id: string | null } | null)?.owner_id ?? actor.id, purchase_order_id: po.id,
  } as never);
}

/**
 * Odeslaná / potvrzená objednávka a jiný dodavatel kroku (E.5, jen obchodník / admin s potvrzením):
 *  1. jedna transakce RPC production_apply — krok dostane nového dodavatele (a termín) a u firmy se vystaví
 *     nová objednávka („Objednat hned"; čekající krok = plan, běžící = doplneni); krok k nám bez objednávky;
 *  2. teprve po potvrzení transakce storno staré objednávky (e-mailem hned, jinak ve frontě), krok k nám ji pustí.
 * Selže-li krok 1 (např. firma už má volnou objednávku z Nákupu), nezmění se nic: krok i stará objednávka zůstanou.
 * Volá se PŘED zápisem kroku (updateJobOperation), nebo po něm (stejný dodavatel — RPC ho jen potvrdí).
 */
export async function replaceStepSupplierCore(db: JobsDb, actor: HandoffActor, operationId: string,
  change: { who: StepWho; plannedEnd?: string | null }, notify: boolean): Promise<{ ok: true; hint?: string } | { ok: false; error: string }> {
  if (!actor.margins || !actor.id) return { ok: false, error: "Dodavatele u odeslané objednávky změní obchodník nebo admin." };
  const { data: opRow } = await db.from("job_operations").select("id, job_id, purchase_order_id").eq("id", operationId).maybeSingle();
  const row = opRow as { id: string; job_id: string; purchase_order_id: string | null } | null;
  if (!row) return { ok: false, error: "Krok nenalezen." };
  const ctx = await loadHandoffContext(db, row.job_id);
  if (!ctx) return { ok: false, error: "Zakázka nenalezena." };
  const cur = ctx.ops.find((o) => o.id === operationId);
  if (!cur) return { ok: false, error: "Krok nenalezen." };
  if (cur.status === "hotovo" || cur.status === "preskoceno") return { ok: false, error: "Hotový nebo přeskočený krok se nepřeobjednává." };
  const old = row.purchase_order_id ? ctx.purchaseOrders.find((p) => p.id === row.purchase_order_id) ?? null : null;
  if (!old || old.status === "zrusena") return { ok: false, error: "Krok nemá platnou objednávku." };
  if (old.status === "dodana") return { ok: false, error: "Objednávka je dodaná — krok už nejde přeobjednat." };
  const sharedWith = ctx.ops.filter((o) => o.id !== cur.id && o.purchaseOrderId === old.id && o.status !== "preskoceno" && o.status !== "hotovo");
  if (sharedWith.length) {
    return { ok: false, error: `Objednávka ${old.number} patří i ke kroku ${stepLabel(sharedWith[0], ctx.ops)} — dodavatele změň u obou kroků najednou (Předat do kroku / Přeplánovat).` };
  }
  const who = change.who;
  if (!stepHasWho(who)) return { ok: false, error: "Vyber, kdo krok udělá." };
  const supplierId = who.type === "supplier" ? who.id : null;
  if (supplierId && supplierId === old.supplierId) return { ok: true };
  const plannedEnd = change.plannedEnd !== undefined ? cleanDate(change.plannedEnd) : cleanDate(cur.plannedEnd);
  // nabídka nové firmy ke kroku (nejlepší podle stejného pořadí jako dialog), jinak bez nabídky
  let quoteId: string | null = null;
  if (supplierId) {
    const sug = suggestWhoForStep({
      step: { kind: cur.kind, orderItemIds: cur.orderItemIds ?? null }, quotes: ctx.quotes.filter((q) => q.supplierId === supplierId), openPurchaseOrders: [],
      ctx: { items: ctx.items, currency: ctx.job.currency, today: ctx.today }, canSeePrices: true,
      usedQuotes: usedQuotesOf(ctx, { selfOpId: cur.id }),
    });
    quoteId = [sug.primary, ...sug.alternatives].find((s) => s?.supplierQuoteId && s.who.type === "supplier" && s.who.id === supplierId)?.supplierQuoteId ?? null;
  }
  const input: HandoffInput = {
    token: randomUUID(), kind: cur.status === "ceka" ? "plan" : "doplneni", expectedStage: ctx.job.status, expectedRouteVersion: ctx.routeVersion,
    acceptLate: true,
    steps: [{
      operationId: cur.id, kind: cur.kind, who, plannedEnd, endsAtCustomerDate: Boolean(cur.endsAtCustomerDate),
      deadlineAgreed: false, deadlineSource: change.plannedEnd !== undefined ? "rucne" : cur.deadlineSource ?? "rucne", whoSource: "rucne",
      supplierQuoteId: quoteId, orderItemIds: cur.orderItemIds ?? null,
      po: who.type === "u_nas" ? { mode: null } : { mode: "vystavit", orderNow: true, includeUncovered: true },
    }],
  };
  const res = await productionHandoffCore(db, actor, row.job_id, input, { source: "automatika", ctx });
  if (!res.ok) return { ok: false, error: `Dodavatel se nezměnil — ${res.error}` };
  const fresh = res.result.purchaseOrders[0] ?? null;
  // krok k nám / k firmě bez nové objednávky: stará objednávka se od kroku odpojí
  if (!fresh) await db.from("job_operations").update({ purchase_order_id: null } as never).eq("id", cur.id).eq("purchase_order_id", old.id);
  const reason = `Změna dodavatele${fresh ? ` — nahrazeno ${fresh.number}` : ""}`;
  const hints: string[] = [];
  if (notify) {
    const s = await stornoPurchaseOrderCore(db, { id: actor.id, fullName: actor.fullName, mailAll: actor.mailAll }, old.id, { cancelReason: reason, mailReason: null });
    hints.push(s?.send === "odeslano"
      ? `Objednávka ${old.number} stornována u dodavatele.`
      : `Objednávka ${old.number} zrušena — storno čeká ve frontě na odeslání${s?.sendError ? ` (${s.sendError})` : ""}.`);
  } else {
    await db.from("purchase_orders").update({ status: "zrusena", cancel_reason: reason } as never).eq("id", old.id).neq("status", "zrusena");
    await logJobEvent(db, { jobId: row.job_id, type: "field", message: `Objednávka ${old.number} zrušena — ${reason} (storno dodavateli neposláno)`, data: { purchaseOrderId: old.id, reason }, actorId: actor.id, entity: "purchase_order", entityId: old.id });
    hints.push(`Objednávka ${old.number} zrušena (storno dodavateli neposláno).`);
  }
  if (fresh) hints.push(`Vystavena ${fresh.number}${fresh.send === "odeslano" ? " a odeslána" : " — čeká na odeslání"}.`);
  return { ok: true, hint: hints.join(" ") };
}

/**
 * Dodavatel potvrdil termín: končí-li jeho krok později, než stihne další čekající krok (u jiné firmy
 * + 1 pracovní den na dopravu), vrátí upozornění. Krok se sám nehýbe — „Předat do kroku…" předvyplní
 * posunutý termín (buildHandoffPlan).
 */
export async function nextStepAfterConfirmedHint(db: JobsDb, jobId: string, poId: string, confirmed: string): Promise<string | null> {
  try {
    const { data } = await db.from("job_operations").select(OPERATION_SELECT).eq("job_id", jobId).order("position").order("created_at");
    const ops = sortOperations(((data ?? []) as unknown as JobOperationDbRow[]).map((r) => rowToJobOperation(r, pragueToday())))
      .filter((o) => o.status !== "preskoceno");
    const mine = ops.filter((o) => o.purchaseOrderId === poId && (o.status === "ceka" || RUNNING.has(o.status)));
    const last = mine[mine.length - 1];
    if (!last) return null;
    const next = ops.slice(ops.indexOf(last) + 1).find((o) => o.status === "ceka");
    const end = cleanDate(next?.plannedEnd);
    if (!next || !end) return null;
    const changedHands = whoName(whoOfOp(next)) !== whoName(whoOfOp(last));
    const minEnd = changedHands ? addWorkingDays(confirmed, 1) : confirmed;
    if (end >= minEnd) return null;
    return `Dodavatel potvrdil ${shortDay(confirmed)} — další krok ${stepLabel(next, ops)}${next.location && next.location !== "—" ? ` (${next.location})` : ""} má termín ${shortDay(end)}. Posuň ho („Předat do kroku…" předvyplní nový termín).`;
  } catch {
    return null;
  }
}

/**
 * Po dodání objednávky (Nákup, focení DL, „Rovnou hotovo") je aktuální krok další čekající (C.7):
 * krok u dodavatele, plně naplánovaný (kdo + termín), plná automatika objednávek a bezpečná objednávka
 * (nejlevnější / existující, ceny, platná nabídka, e-mail, schránka) → předá se sám (✨ automatika
 * za uživatele) a objednávka se odešle; jinak jen upozornění „K předání dalšímu kroku: …".
 */
export async function autoAdvanceAfterDelivery(db: JobsDb, userId: string | null, jobId: string): Promise<{ hint?: string; advanced?: boolean }> {
  try {
    const ctx = await loadHandoffContext(db, jobId);
    if (!ctx || ctx.job.status !== "ve_vyrobe") return {};
    const live = ctx.ops.filter((o) => o.status !== "preskoceno");
    if (live.some((o) => RUNNING.has(o.status))) return {};
    const next = live.find((o) => o.status === "ceka");
    if (!next) return {};
    const label = stepLabel(next, live);
    const where = next.location && next.location !== "—" ? ` · ${next.location}` : "";
    const manual = { hint: `K předání dalšímu kroku: ${label}${where} — „Předat do kroku…".` };
    if (next.inHouse || !hasWho(next) || !cleanDate(next.plannedEnd) || !userId) return manual;
    if ((await purchaseOrderMode(db)) !== "full") return manual;
    const { data: prof } = await db.from("profiles").select("id, full_name, role, active").eq("id", userId).maybeSingle();
    const p = prof as { full_name: string | null; role: string; active: boolean } | null;
    const margins = Boolean(p?.active) && (p?.role === "super_admin" || p?.role === "obchodnik");
    if (!margins) return manual;
    const box = await purchaseOrderSender(db, { id: userId }, ctx.job.ownerId);
    const plan = buildHandoffPlan(ctx, { kind: "dalsi_krok", operationId: next.id, margins, mailAll: p?.role === "super_admin", actorId: userId, automationMode: "full", senderEmail: box.mailboxEmail });
    const step = plan.steps[0];
    if (!step || step.operationId !== next.id) return manual;
    const existing = next.purchaseOrderId && next.purchaseOrder?.status !== "zrusena" ? next.purchaseOrderId : null;
    if (!existing && (step.poPreview?.blockers.length ?? 1) > 0) return manual;
    // termín, který plán musel posunout (předchozí krok skončil později), potvrdí člověk
    if (cleanDate(step.plannedEnd) !== cleanDate(next.plannedEnd)) return manual;
    const input: HandoffInput = {
      token: randomUUID(), kind: "dalsi_krok", expectedStage: ctx.job.status, expectedRouteVersion: ctx.routeVersion,
      // díly a nabídka jako v plánu (kalírna jen díly s kalením, nabídka téže firmy) — stejná objednávka, jakou ukazuje dialog
      steps: [stepInputFromOperation(next, {
        start: true, orderItemIds: step.orderItemIds ?? null, supplierQuoteId: step.supplierQuoteId ?? next.supplierQuoteId ?? null,
        ...(step.whoSource ? { whoSource: step.whoSource } : {}),
        ...(existing ? {} : { po: { mode: "vystavit", ...(step.po.includeUncovered !== undefined ? { includeUncovered: step.po.includeUncovered } : {}) } }),
      })],
    };
    const { createOperatorClient } = await import("@/lib/supabase/server");
    const { aiActor } = await import("@/lib/supabase/actor-headers");
    const aiDb = await createOperatorClient({ actor: aiActor(userId, "automatika", "automaticky") });
    const res = await productionHandoffCore(aiDb, { id: userId, fullName: p?.full_name ?? "", margins, mailAll: p?.role === "super_admin", via: "automaticky" }, jobId, input, { source: "automatika", ctx });
    if (!res.ok) return manual;
    const po = res.result.purchaseOrders[0];
    return { advanced: true, hint: `Další krok předán automaticky: ${label}${where}${po ? ` — objednávka ${po.number}${po.send === "odeslano" ? " odeslána" : " čeká na odeslání"}` : ""}.` };
  } catch (err) {
    console.error(`[handoff] Automatické předání dalšímu kroku selhalo: ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}

/** Vstup kroku z existujícího kroku (beze změny kdo / termín / objednávka) — pro automatiku. */
export function stepInputFromOperation(op: JobOperation, over: Partial<HandoffStepInput> = {}): HandoffStepInput {
  const who = whoOfOp(op);
  const po = op.purchaseOrderId && op.purchaseOrder?.status !== "zrusena" ? op.purchaseOrderId : null;
  return {
    operationId: op.id, kind: op.kind, title: op.title ?? undefined, who, plannedEnd: op.plannedEnd,
    endsAtCustomerDate: Boolean(op.endsAtCustomerDate), deadlineAgreed: op.deadlineState === "dohodnuto",
    deadlineSource: op.deadlineSource ?? undefined, whoSource: op.whoSource ?? undefined, supplierQuoteId: op.supplierQuoteId ?? null,
    orderItemIds: op.orderItemIds ?? null,
    po: who.type === "u_nas" ? { mode: null }
      : po ? { mode: "existujici", existingId: po }
        : op.poMode === "neobjednavat" ? { mode: "neobjednavat", noneReason: op.poNoneReason ?? "Objednáno jinak" }
          : { mode: op.poMode ?? "pri_predani" },
    ...over,
  };
}

export { whoOfOp };

// ── Nabídka telefonem (dialog předání: „kdo" ručně podle nabídky, která přišla telefonem) ──
export type { PhoneQuoteInput };

/**
 * Zapíše nabídku telefonem jako nabídku dodavatele (zdroj „telefon") — dodavatel a výrobce se bere
 * vždy podle nějaké nabídky (majitel 29. 10.). Vrací návrh „kdo" pro krok (předání ho použije pro krok
 * i objednávku: cena položek se postaví na serveru z této nabídky). Ceny jen s právem na marže.
 */
export async function recordPhoneQuoteCore(db: JobsDb, actor: Pick<HandoffActor, "id" | "margins">, jobId: string, input: PhoneQuoteInput):
  Promise<{ ok: true; quoteId: string; suggestion: WhoSuggestion } | { ok: false; error: string }> {
  if (!isUuid(jobId) || !actor.id) return { ok: false, error: "Zakázka nenalezena." };
  if (!input || !isOperationKind(input.kind)) return { ok: false, error: "Neznámý druh kroku." };
  const ctx = await loadHandoffContext(db, jobId);
  if (!ctx) return { ok: false, error: "Zakázka nenalezena." };
  if (CLOSED_STAGES.includes(ctx.job.status)) return { ok: false, error: "Uzavřená zakázka — nabídku nejde zapsat." };

  // dodavatel: z adresáře, nebo podle názvu (shoda ≥ 80), jinak nový v adresáři
  let supplier: { id: string; name: string } | null = null;
  if (input.supplierId) {
    if (!isUuid(input.supplierId)) return { ok: false, error: "Dodavatel nenalezen." };
    const s = ctx.suppliers.get(input.supplierId);
    if (!s) return { ok: false, error: "Dodavatel nenalezen." };
    supplier = { id: s.id, name: s.name };
  } else {
    const name = cleanText(input.supplierName, 300);
    if (!name || name.length < 2) return { ok: false, error: "Napiš, od které firmy nabídka je." };
    const found = await findOrCreateSupplierByParty(db, { ...emptyParty(), name });
    if (!found) return { ok: false, error: "Dodavatele se nepodařilo založit." };
    supplier = { id: found.id, name: found.name };
  }

  const scopeIds = Array.isArray(input.orderItemIds) ? input.orderItemIds.filter((x) => ctx.items.some((i) => i.id === x)) : null;
  const scope = scopeIds && scopeIds.length ? ctx.items.filter((i) => scopeIds.includes(i.id)) : ctx.items;
  const positive = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? r2(v) : null);
  const lead = typeof input.leadTimeDays === "number" && Number.isFinite(input.leadTimeDays) && input.leadTimeDays > 0 ? Math.min(365, Math.round(input.leadTimeDays)) : null;
  const delivery = cleanDate(input.deliveryDate);
  // ceny: u jednoho dílu cena celkem (→ za kus), u víc dílů cena za kus u každého dílu — objednávka potřebuje
  // cenu položek (celková cena za víc dílů by v objednávce chyběla a náklady zakázky by byly 0)
  const total = actor.margins ? positive(input.price) : null;
  const perItem = new Map<string, number>();
  if (actor.margins && input.itemPrices && typeof input.itemPrices === "object") {
    for (const it of scope) {
      const p = positive((input.itemPrices as Record<string, unknown>)[it.id]);
      if (p !== null) perItem.set(it.id, p);
    }
  }
  if (scope.length > 1 && total !== null && !perItem.size) {
    return { ok: false, error: "Krok má víc dílů — napiš cenu za kus u každého dílu (objednávka potřebuje cenu položek)." };
  }
  const anyPrice = perItem.size > 0 || total !== null;
  if (!lead && !delivery && !anyPrice) return { ok: false, error: "Doplň aspoň termín (lhůtu nebo datum dodání)." };
  const note = cleanText(input.note, 900);
  // položky nabídky = díly kroku (pokrytí celé)
  const unitPriceOf = (it: SuggestItem): number | null => {
    if (perItem.has(it.id)) return perItem.get(it.id) as number;
    if (scope.length === 1 && total !== null) return r2(total / (it.quantity || 1));
    return null;
  };
  const items = scope.map((it) => ({
    drawingNumber: it.drawingNumber ?? undefined, name: it.name ?? it.description ?? undefined, material: it.materialDesignation ?? it.material ?? undefined,
    quantity: it.quantity, unit: it.unit ?? "ks", unitPrice: unitPriceOf(it),
  }));
  const allPriced = items.every((it) => it.unitPrice !== null);
  const price = anyPrice && allPriced ? r2(items.reduce((s, it) => s + (it.unitPrice ?? 0) * it.quantity, 0)) : null;
  const created = await insertSupplierQuote(db, actor.id, jobId, {
    supplierId: supplier.id, quoteDate: pragueToday(), leadTimeDays: lead, ...(delivery ? { deliveryDate: delivery } : {}),
    currency: ctx.job.currency || "CZK", note: `Nabídka telefonem${note ? `: ${note}` : ""}`, items: items as never,
    ...(price !== null ? { total: price } : {}), source: "telefon",
  }, { silent: true });
  if (!created.ok) return { ok: false, error: created.error };
  // na co je nabídka (druh kroku) — porovná se s ostatními nabídkami ke stejnému kroku
  await db.from("supplier_quotes").update({ operation_kinds: [input.kind] } as never).eq("id", created.id);
  const when = delivery ? `do ${shortDay(delivery)}` : lead ? `termín ${lead} ${lead === 1 ? "den" : lead < 5 ? "dny" : "dní"}` : null;
  await logJobEvent(db, {
    jobId, type: "quote",
    message: `Nabídka telefonem: ${supplier.name}${when ? ` — ${when}` : ""}${note ? ` · ${note}` : ""}`.slice(0, 500),
    data: { supplierQuoteId: created.id, supplierId: supplier.id, source: "telefon", kind: input.kind },
    actorId: actor.id,
  });
  // objednávka podle této nabídky — stejné pravidlo jako server při předání (náhled = skutečnost)
  const built = purchaseItemsForStep({
    step: { kind: input.kind, orderItemIds: scopeIds && scopeIds.length ? scopeIds : null }, items: ctx.items,
    quote: { items: items.map((it) => ({ ...it, drawingNumber: it.drawingNumber ?? null, name: it.name ?? null, note: null })), total: price, number: null },
    includeUncovered: true,
  });
  const priced = built.items.filter((it) => it.unitPrice !== null && it.unitPrice !== undefined);
  const suggestion: WhoSuggestion = {
    source: "nabidka", who: { type: "supplier", id: supplier.id, name: supplier.name }, supplierQuoteId: created.id, quoteNumber: null,
    purchaseOrder: null, price, currency: ctx.job.currency || "CZK", priceBasis: price !== null ? "prepocet_mnozstvi" : null, diffToBest: null,
    leadTimeDays: lead, deliveryDate: delivery, coverage: null, expired: false, quantityMismatch: false, badges: [], reason: "Nabídka telefonem",
    order: {
      itemCount: built.items.length, unpriced: built.items.length - priced.length,
      total: actor.margins && priced.length ? r2(priced.reduce((s, it) => s + (it.unitPrice ?? 0) * it.quantity, 0)) : null,
    },
  };
  return { ok: true, quoteId: created.id, suggestion };
}
