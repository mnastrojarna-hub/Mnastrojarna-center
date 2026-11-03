// Objednávka dodavateli = předání do výroby (majitel 2. 11.): „Proč, když vystavím objednávku dodavateli,
// se díl automaticky nepředá do výroby? Dodavatel by to mohl odmítnout, ale to se málokdy stane."
//  • vystavení / odeslání objednávky u zakázky před výrobou (objednávka / potvrzeno) → krok výroby s touto
//    objednávkou (kdo = dodavatel, termín z objednávky), zakázka „Ve výrobě" — bez dialogu „Předat do výroby";
//  • zakázka už ve výrobě → objednávka se naváže na odpovídající krok (jinak přibude krok);
//  • zrušení objednávky (Nákup) → krok zpět na „Vybrat, kdo to dělá" (vrácení z výroby jen nabídne).
// Kroky „U nás" se nemění. Nikdy nevystavuje ani neodesílá další objednávku.
import { randomUUID } from "node:crypto";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { OPERATION_KINDS, type OperationKind } from "@/lib/jobs/operations";
import { cleanDate } from "@/lib/jobs/mapping";
import { hasWho, stepLabel } from "@/lib/jobs/production";
import { purchaseOrderDeadline } from "@/lib/jobs/production-handoff";
import type { HandoffInput, HandoffStepInput, StepWho } from "@/lib/jobs/production-handoff-types";
import type { JobOperation } from "@/lib/jobs/production-types";
import {
  loadHandoffContext, productionHandoffCore, stepInputFromOperation, type CtxPurchaseOrder, type HandoffActor, type HandoffContext,
} from "@/lib/jobs/production-handoff-store";
import { isCompleteQuote, operationKindsOfSupplier, quoteKinds, quoteStepMatch, shortDay, suggestStepDeadline } from "@/lib/jobs/production-suggest";
import { CLOSED_STAGES, stageRank } from "@/lib/jobs/stages";
import type { JobStage } from "@/lib/supabase/database.types";

const OPEN = new Set(["ceka", "probiha", "problem"]);
const RUNNING = new Set(["probiha", "problem"]);
/** Objednávka, která „jede" (vystavená nebo odeslaná / potvrzená dodavatelem). */
const ISSUED = new Set(["vystavena", "odeslana", "potvrzena"]);

type Op = Pick<JobOperation, "id" | "kind" | "status" | "inHouse" | "supplier" | "supplierName" | "purchaseOrderId" | "orderItemIds" | "plannedEnd" | "poMode">
  & { purchaseOrder?: { status: string | null } | null };

export interface PoAutoFacts {
  stage: JobStage;
  /** Kroky zakázky v pořadí postupu. */
  ops: Op[];
  itemIds: string[];
  po: { id: string; supplierId: string | null; supplierName: string; status: string; kinds: string[]; itemIds: (string | null | undefined)[] };
}

/**
 * Co udělat s objednávkou (čistá funkce):
 *  • none    — nic (zakázka uzavřená / před objednávkou zákazníka / už dodaná, objednávka už je u kroku…);
 *  • link    — ve výrobě: navázat objednávku na čekající / běžící krok bez objednávky;
 *  • add     — ve výrobě bez odpovídajícího kroku: přidat krok (start = nic jiného není otevřené);
 *  • handoff — před výrobou: předat do výroby (spustí se první krok; `before` = dřívější čekající kroky);
 *  • plan    — před výrobou, ale dřívější krok nejde spustit sám (chybí kdo / termín / objednávka):
 *              objednávka se jen naváže na krok (nebo přibude čekající krok), předá člověk.
 */
export type PoAutoDecision =
  | { action: "none"; reason: string }
  | { action: "link"; operationId: string }
  | { action: "add"; kind: OperationKind; orderItemIds: string[] | null; start: boolean }
  | { action: "handoff"; operationId: string | null; kind: OperationKind; orderItemIds: string[] | null; before: string[] }
  | { action: "plan"; operationId: string | null; kind: OperationKind; orderItemIds: string[] | null };

function activePo(o: Op): boolean {
  return Boolean(o.purchaseOrderId) && o.purchaseOrder?.status !== "zrusena";
}

function sameFirm(o: Op, po: PoAutoFacts["po"]): boolean {
  if (o.supplier) return Boolean(po.supplierId) && o.supplier.id === po.supplierId;
  const n = (o.supplierName ?? "").trim().toLowerCase();
  return Boolean(n) && n === po.supplierName.trim().toLowerCase();
}

function isKind(k: string): k is OperationKind {
  return k in OPERATION_KINDS;
}

/** Díly objednávky (id položek zakázky); null = všechny díly zakázky (nebo nejde určit). */
export function purchaseOrderScope(itemIds: string[], poItemIds: (string | null | undefined)[]): string[] | null {
  const ids = [...new Set(poItemIds.filter((x): x is string => Boolean(x) && itemIds.includes(x as string)))];
  if (!ids.length || ids.length >= itemIds.length) return null;
  return itemIds.filter((id) => ids.includes(id));
}

/** Druh kroku objednávky: kompletní dodávka (všechny díly / nabídka na komplet), jinak operace z nabídky. */
export function purchaseOrderStepKind(kinds: string[], scope: string[] | null): OperationKind {
  const ks = kinds.filter(isKind);
  if (ks.includes("kompletni_dodavka")) return "kompletni_dodavka";
  const first = ks[0];
  if (first && (first === "tepelne_zpracovani" || first === "povrchova_uprava" || first === "kontrola" || first === "doprava" || first === "montaz")) return first;
  if (!scope) return "kompletni_dodavka";
  return first ?? "vyroba";
}

export function decidePurchaseOrderAuto(f: PoAutoFacts): PoAutoDecision {
  const { po } = f;
  if (!ISSUED.has(po.status)) return { action: "none", reason: "objednávka není vystavená" };
  if (!po.supplierId) return { action: "none", reason: "objednávka nemá dodavatele z adresáře" };
  if (CLOSED_STAGES.includes(f.stage)) return { action: "none", reason: "zakázka je uzavřená" };
  const rank = stageRank(f.stage);
  const inProduction = f.stage === "ve_vyrobe";
  // jen objednávka / potvrzeno (i „vyrábí se bez objednávky zákazníka" = stav objednávka) a ve výrobě
  if (!inProduction && rank !== 3 && rank !== 4) return { action: "none", reason: "zakázka není před výrobou ani ve výrobě" };

  const open = f.ops.filter((o) => OPEN.has(o.status));
  const linked = open.find((o) => o.purchaseOrderId === po.id) ?? null;
  const scope = purchaseOrderScope(f.itemIds, po.itemIds);
  const kinds = po.kinds.filter(isKind);
  const kind = purchaseOrderStepKind(kinds, scope);
  const overlaps = (o: Op) => !o.orderItemIds || !scope || o.orderItemIds.some((id) => scope.includes(id));
  const fits = (o: Op) => OPEN.has(o.status) && !o.inHouse && !activePo(o) && overlaps(o)
    && (sameFirm(o, po) || (!hasWho(o) && quoteStepMatch(kinds, o.kind) > 0));
  const match = linked ?? open.find((o) => fits(o) && sameFirm(o, po)) ?? open.find(fits) ?? null;

  if (inProduction) {
    if (linked) return { action: "none", reason: "objednávka už je u kroku výroby" };
    if (match) return { action: "link", operationId: match.id };
    return { action: "add", kind, orderItemIds: scope, start: open.length === 0 };
  }

  // před výrobou: dřívější čekající kroky musí jít spustit beze změny (u nás / vlastní objednávka / objednáno jinak)
  const idx = match ? open.indexOf(match) : open.length;
  const before = open.slice(0, idx);
  const ready = (o: Op) => o.status === "ceka" && Boolean(cleanDate(o.plannedEnd)) && hasWho(o)
    && (o.inHouse || activePo(o) || o.poMode === "neobjednavat");
  if (before.every(ready)) return { action: "handoff", operationId: match?.id ?? null, kind: match?.kind ?? kind, orderItemIds: match ? match.orderItemIds ?? null : scope, before: before.map((o) => o.id) };
  return { action: "plan", operationId: match?.id ?? null, kind: match?.kind ?? kind, orderItemIds: match ? match.orderItemIds ?? null : scope };
}

export interface PoAutoResult {
  /** Zakázka se tím předala do výroby. */
  moved: boolean;
  /** Objednávka je u kroku výroby (navázaná / nový krok). */
  attached: boolean;
  /** Česky pro uživatele (výsledek vystavení / odeslání). */
  message: string | null;
  operationId?: string | null;
}

const NOTHING: PoAutoResult = { moved: false, attached: false, message: null };

function poKinds(ctx: HandoffContext, po: CtxPurchaseOrder): string[] {
  const q = po.supplierQuoteId ? ctx.quotes.find((x) => x.id === po.supplierQuoteId) ?? null : null;
  if (q) return isCompleteQuote(q) ? ["kompletni_dodavka"] : quoteKinds(q).kinds;
  const sup = po.supplierId ? ctx.suppliers.get(po.supplierId) : undefined;
  return operationKindsOfSupplier(sup?.technologies ?? []);
}

/** Termín kroku s objednávkou: z objednávky (není-li v minulosti), jinak dosavadní termín kroku, jinak odhad. */
function stepDeadline(ctx: HandoffContext, po: CtxPurchaseOrder, op: JobOperation | null, isLast: boolean):
  { plannedEnd: string; deadlineSource: HandoffStepInput["deadlineSource"]; caption: string } {
  const dl = purchaseOrderDeadline(po);
  if (dl && dl.date >= ctx.today) return { plannedEnd: dl.date, deadlineSource: dl.source, caption: dl.caption };
  const own = cleanDate(op?.plannedEnd);
  if (own && own >= ctx.today) return { plannedEnd: own, deadlineSource: op?.deadlineSource ?? "rucne", caption: "termín kroku" };
  const sup = po.supplierId ? ctx.suppliers.get(po.supplierId) : undefined;
  const q = po.supplierQuoteId ? ctx.quotes.find((x) => x.id === po.supplierQuoteId) ?? null : null;
  const fin = ctx.job.dueDate ?? ctx.job.customerRequiredDate;
  const d = suggestStepDeadline({
    today: ctx.today, quote: q ? { deliveryDate: q.deliveryDate, leadTimeDays: q.leadTimeDays } : null,
    supplierLeadDays: sup?.leadDays ?? null, isLast, finalDate: fin,
  });
  return { plannedEnd: d.date, deadlineSource: d.source, caption: d.caption };
}

function poStep(ctx: HandoffContext, po: CtxPurchaseOrder, op: JobOperation | null, kind: OperationKind, orderItemIds: string[] | null, start: boolean, isLast: boolean): HandoffStepInput {
  const who: StepWho = { type: "supplier", id: po.supplierId as string, name: po.supplierName };
  const dl = stepDeadline(ctx, po, op, isLast);
  const quoteOk = po.supplierQuoteId && ctx.quotes.some((q) => q.id === po.supplierQuoteId && q.supplierId === po.supplierId) ? po.supplierQuoteId : null;
  const over: Partial<HandoffStepInput> = {
    who, whoSource: "objednavka", plannedEnd: dl.plannedEnd, deadlineSource: dl.deadlineSource ?? undefined,
    supplierQuoteId: quoteOk, start, po: { mode: "existujici", existingId: po.id },
  };
  if (op) return stepInputFromOperation(op, { ...over, ...(op.endsAtCustomerDate ? { plannedEnd: op.plannedEnd } : {}) });
  return { kind, orderItemIds, endsAtCustomerDate: false, deadlineAgreed: false, ...over } as HandoffStepInput;
}

/** Navázání objednávky na krok bez dialogu (zakázka ve výrobě / dřívější krok čeká na člověka). */
async function linkStep(db: JobsDb, ctx: HandoffContext, actorId: string | null, po: CtxPurchaseOrder, op: JobOperation): Promise<boolean> {
  const patch: Record<string, unknown> = { purchase_order_id: po.id, po_mode: "existujici" };
  if (!op.supplier && !(op.supplierName ?? "").trim()) { patch.supplier_id = po.supplierId; patch.who_source = "objednavka"; }
  const dl = purchaseOrderDeadline(po);
  if (dl && !op.endsAtCustomerDate && op.deadlineState !== "dohodnuto" && dl.date >= ctx.today) {
    patch.planned_end = dl.date;
    patch.deadline_source = dl.source;
  } else if (!cleanDate(op.plannedEnd)) {
    const d = stepDeadline(ctx, po, op, false);
    patch.planned_end = d.plannedEnd;
    patch.deadline_source = d.deadlineSource;
  }
  const { error } = await db.from("job_operations").update(patch as never).eq("id", op.id).is("purchase_order_id", null);
  if (error) {
    console.error(`[po-auto] Navázání kroku na objednávku ${po.number} selhalo: ${error.message}`);
    return false;
  }
  await logJobEvent(db, {
    jobId: ctx.job.id, type: "field",
    message: `Objednávka ${po.number} přiřazena ke kroku ${stepLabel(op, ctx.ops)} (${po.supplierName})${patch.planned_end ? ` — termín ${shortDay(patch.planned_end as string)}` : ""}`,
    data: { purchaseOrderId: po.id, operationId: op.id, auto: true }, actorId, entity: "purchase_order", entityId: po.id,
  });
  return true;
}

/**
 * Po vystavení / odeslání objednávky dodavateli: předá zakázku do výroby (nebo naváže objednávku na krok).
 * Idempotentní — objednávka u kroku ve výrobě = nic. Chyba nikdy nevrací vystavení zpět (jen zpráva).
 */
export async function autoHandoffForPurchaseOrder(db: JobsDb, actor: HandoffActor, poId: string): Promise<PoAutoResult> {
  try {
    const { data: row } = await db.from("purchase_orders").select("job_id").eq("id", poId).maybeSingle();
    const jobId = (row as { job_id: string } | null)?.job_id;
    if (!jobId) return NOTHING;
    const ctx = await loadHandoffContext(db, jobId);
    const po = ctx?.purchaseOrders.find((p) => p.id === poId) ?? null;
    if (!ctx || !po) return NOTHING;
    const live = ctx.ops.filter((o) => o.status !== "preskoceno");
    const decision = decidePurchaseOrderAuto({
      stage: ctx.job.status, ops: live, itemIds: ctx.items.map((i) => i.id),
      po: { id: po.id, supplierId: po.supplierId, supplierName: po.supplierName, status: po.status, kinds: poKinds(ctx, po), itemIds: po.items.map((i) => i.orderItemId) },
    });
    const opOf = (id: string | null) => (id ? live.find((o) => o.id === id) ?? null : null);
    const prefix = `Předáno do výroby automaticky vystavením objednávky ${po.number}`;

    if (decision.action === "none") return NOTHING;
    if (decision.action === "link") {
      const op = opOf(decision.operationId)!;
      const ok = await linkStep(db, ctx, actor.id, po, op);
      return ok ? { moved: false, attached: true, operationId: op.id, message: `Objednávka ${po.number} je u kroku ${stepLabel(op, ctx.ops)}.` } : NOTHING;
    }
    if (decision.action === "plan" && decision.operationId) {
      const op = opOf(decision.operationId)!;
      const ok = await linkStep(db, ctx, actor.id, po, op);
      return ok ? { moved: false, attached: true, operationId: op.id, message: `Objednávka ${po.number} je u kroku ${stepLabel(op, ctx.ops)} — dřívější krok čeká na předání („Předat do výroby…").` } : NOTHING;
    }

    let input: HandoffInput;
    let summaryPrefix: string | null = null;
    if (decision.action === "handoff") {
      const op = opOf(decision.operationId);
      const before = decision.before.map((id) => opOf(id)!).filter(Boolean);
      const after = live.filter((o) => o.status === "ceka" && (!op || o.id !== op.id) && !before.includes(o));
      const steps: HandoffStepInput[] = before.map((o, i) => stepInputFromOperation(o, { start: i === 0 }));
      steps.push(poStep(ctx, po, op, decision.kind, decision.orderItemIds, before.length === 0, after.length === 0));
      input = {
        token: randomUUID(), kind: "predani", expectedStage: ctx.job.status, expectedRouteVersion: ctx.routeVersion,
        steps, acceptLate: true, note: prefix,
      };
      summaryPrefix = prefix;
    } else {
      // add (ve výrobě) / plan bez kroku (před výrobou): nový krok s objednávkou
      const start = decision.action === "add" && decision.start;
      input = {
        token: randomUUID(), kind: start ? "doplneni" : "plan", expectedStage: ctx.job.status, expectedRouteVersion: ctx.routeVersion,
        steps: [poStep(ctx, po, null, decision.kind, decision.orderItemIds, start, true)], acceptLate: true,
        note: `Krok výroby přidán automaticky vystavením objednávky ${po.number}`,
      };
      summaryPrefix = `Krok přidán automaticky vystavením objednávky ${po.number}`;
    }
    const res = await productionHandoffCore(db, actor, jobId, input, { source: "automatika", ctx, summaryPrefix });
    if (!res.ok) {
      console.error(`[po-auto] ${po.number}: ${res.error}`);
      return { moved: false, attached: false, message: decision.action === "handoff" ? `Do výroby se automaticky nepředalo: ${res.error}` : null };
    }
    const target = input.steps[input.steps.length - 1];
    const opId = res.result.operationIds[res.result.operationIds.length - 1] ?? null;
    const when = target.plannedEnd ? ` · termín ${shortDay(target.plannedEnd)}` : "";
    if (res.result.stage === "ve_vyrobe" && decision.action === "handoff") {
      return { moved: true, attached: true, operationId: opId, message: `Předáno do výroby automaticky: ${OPERATION_KINDS[target.kind].label} · ${po.supplierName}${when}` };
    }
    return { moved: false, attached: true, operationId: opId, message: `Objednávka ${po.number}: přidán krok ${OPERATION_KINDS[target.kind].label} · ${po.supplierName}${when}` };
  } catch (err) {
    console.error(`[po-auto] Automatické předání po objednávce selhalo: ${err instanceof Error ? err.message : String(err)}`);
    return NOTHING;
  }
}

/**
 * Zrušená objednávka (Nákup): kroky s ní se vrátí na „Vybrat, kdo to dělá" (bez firmy, objednávky a nabídky;
 * běžící krok čeká). Vrácení z výroby se jen nabídne (nic jiného neběží ani není hotové).
 */
export async function resetStepsOfCancelledPurchaseOrder(db: JobsDb, actorId: string | null, poId: string): Promise<{ hint: string | null; offerUndo: boolean }> {
  const { data: po } = await db.from("purchase_orders").select("id, number, job_id, status").eq("id", poId).maybeSingle();
  const p = po as { id: string; number: string | null; job_id: string; status: string } | null;
  if (!p || p.status !== "zrusena") return { hint: null, offerUndo: false };
  const ctx = await loadHandoffContext(db, p.job_id);
  if (!ctx) return { hint: null, offerUndo: false };
  const mine = ctx.ops.filter((o) => o.purchaseOrderId === p.id && OPEN.has(o.status) && !o.inHouse);
  if (!mine.length) return { hint: null, offerUndo: false };
  const labels: string[] = [];
  for (const o of mine) {
    const patch: Record<string, unknown> = {
      purchase_order_id: null, supplier_id: null, supplier_name: null, supplier_quote_id: null, who_source: null, po_mode: null,
      ...(RUNNING.has(o.status) ? { status: "ceka" } : {}),
    };
    const { error } = await db.from("job_operations").update(patch as never).eq("id", o.id);
    if (error) { console.error(`[po-auto] Krok po zrušení objednávky: ${error.message}`); continue; }
    labels.push(stepLabel(o, ctx.ops));
  }
  if (!labels.length) return { hint: null, offerUndo: false };
  await logJobEvent(db, {
    jobId: ctx.job.id, type: "field",
    message: `Objednávka ${p.number ?? ""} zrušena — ${labels.join(", ")} čeká na výběr, kdo to dělá`,
    data: { purchaseOrderId: p.id, operationIds: mine.map((o) => o.id), reset: true }, actorId, entity: "purchase_order", entityId: p.id,
  });
  const others = ctx.ops.filter((o) => !mine.includes(o) && (RUNNING.has(o.status) || o.status === "hotovo"));
  const offerUndo = ctx.job.status === "ve_vyrobe" && others.length === 0 && Boolean(ctx.lastPredani);
  const hint = `Krok ${labels.join(", ")} čeká na výběr, kdo to dělá.${offerUndo ? " Nic jiného ve výrobě neběží — zakázku můžeš vrátit z výroby („Vrátit předání do výroby“)." : ""}`;
  return { hint, offerUndo };
}
