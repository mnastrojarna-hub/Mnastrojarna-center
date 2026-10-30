// Karta „Technologie" v Přehledu zakázky — čistý view-model (bez Reactu a DB), testy v technology-overview.test.ts.
// Majitel 30. 10.: „políčko technologie v přehledu ukazuje strašně málo informací, strohé až zavádějící".
// Karta má na první pohled říct: po položkách (skupinách položek se stejným postupem) kroky v pořadí, kdo je
// dělá (u nás / dodavatel), stav kroku (čeká na nabídku → objednáno → ve výrobě → dodáno k nám / hotovo),
// termíny (dodavatel vs. konečný termín zákazníka, červeně při ohrožení), poznámky pro dodavatele, náklad
// (jen s právem na nákupní ceny) a jeden další krok. Jen ze stávajících dat — stejné pomocníky jako záložka
// Technologie (production-helpers, production-handoff, technology.ts), žádná druhá logika stavů.
import { DEADLINE_STATE_META, OPERATION_KINDS, type OperationKind } from "@/lib/jobs/operations";
import { hasWho, sortOperations, stepLabel } from "@/lib/jobs/production";
import { deadlinePill, deadlineText, performerRole, routeHealth, type DeadlineOp, type PillTone } from "@/lib/jobs/production-handoff";
import { leadTimeLabel, quoteKinds, quoteStepMatch, shortDay } from "@/lib/jobs/production-suggest";
import { techStateOf } from "@/lib/jobs/technology";
import { FLOW_ACTIONS, czPlural, type FlowActionKey } from "@/lib/jobs/flow-status";
import type { Feature } from "@/lib/auth/permissions";
import type { JobItem } from "@/lib/jobs/types";
import type { JobOperation } from "@/lib/jobs/production-types";
import type { PurchaseOrderView, SupplierQuoteView } from "@/lib/jobs/purchasing-types";
import type { JobStage } from "@/lib/supabase/database.types";
import {
  closedProductionView, dayLabel, isBeforeProduction, isOpenStep, lastNoteLine, poChipOf, pragueDay, whoLabel, whoOfOperation,
  type WhoValue,
} from "@/components/jobs/production/production-helpers";

/** Stav kroku jedním slovem (žebřík majitele: čeká na nabídku → objednáno → ve výrobě → dodáno k nám / hotovo). */
export type StepPhase =
  | "bez_firmy" | "ceka_na_nabidku" | "k_objednani" | "k_odeslani" | "objednano"
  | "ceka" | "ve_vyrobe" | "problem" | "castecne_dodano" | "dodano" | "hotovo" | "uzavreno";

export type StepTone = "grey" | "amber" | "lime" | "orange" | "green" | "red";

export const STEP_PHASES: Record<StepPhase, { label: string; tone: StepTone }> = {
  bez_firmy: { label: "Vybrat, kdo to dělá", tone: "amber" },
  ceka_na_nabidku: { label: "Čeká na nabídku dodavatele", tone: "amber" },
  k_objednani: { label: "K objednání", tone: "grey" },
  k_odeslani: { label: "Objednávka k odeslání", tone: "amber" },
  objednano: { label: "Objednáno", tone: "lime" },
  ceka: { label: "Čeká", tone: "grey" },
  ve_vyrobe: { label: "Ve výrobě", tone: "orange" },
  problem: { label: "Problém", tone: "red" },
  castecne_dodano: { label: "Částečně dodáno k nám", tone: "lime" },
  dodano: { label: "Dodáno k nám", tone: "green" },
  hotovo: { label: "Hotovo", tone: "green" },
  uzavreno: { label: "Uzavřeno bez ukončení", tone: "grey" },
};

/** Náklad kroku (jen s právem na nákupní ceny): z objednávky dodavateli, jinak z nabídky dodavatele. */
export interface StepCost {
  amount: number | null;
  currency: string;
  source: "objednavka" | "nabidka";
  /** Číslo objednávky / nabídky. */
  ref: string | null;
}

export interface TechStepView {
  id: string;
  /** Pořadí mezi nepřeskočenými kroky (1, 2, 3…). */
  no: number;
  kind: OperationKind;
  label: string;
  who: WhoValue;
  /** „U nás" / jméno firmy / „Nevybráno". */
  whoText: string;
  /** „částečný dodavatel" / „dodavatel" / „mimo adresář" (u nás nic). */
  whoRole: string | null;
  phase: StepPhase;
  /** Text stavu („Objednáno", „Ve výrobě od 27. 10.", „Na řadě"). */
  status: string;
  tone: StepTone;
  /** Objednávka kroku jako text („OV-2026-012 · potvrzena na 14. 11."). */
  po: string | null;
  poNumber: string | null;
  /** Termín kroku (dodavatel / dílna); červeně po termínu nebo za termínem zákazníka. */
  deadline: { text: string; tone: PillTone; title: string | null } | null;
  /** Null = bez práva na ceny, nebo nic k zobrazení. */
  cost: StepCost | null;
  /** Nabídka dodavatele na krok bez ceny (čeká se na ni). */
  quotePending: string | null;
  /** Kolik nabídek se k nevybranému kroku hodí (jen s právem na ceny). */
  quoteCount: number;
  /** Poslední řádek poznámky kroku. */
  note: string | null;
  /** Aktuální krok (běží / problém / první čekající). */
  current: boolean;
  /** Krok končí konečným termínem zákazníka (poslední krok). */
  endsAtCustomerDate: boolean;
}

export interface TechItemView {
  id: string;
  /** „PR-20 · Příruba". */
  label: string;
  quantity: number;
  unit: string;
  material: string | null;
  /** Postup technologa (celý text) — null, když chybí. */
  procedure: string | null;
  /** „Kompletně zadáno {firma}" (bez postupu). */
  completeBy: string | null;
  complete: boolean;
  supplierNote: string | null;
  delivered: number;
}

export interface TechGroupView {
  key: string;
  /** „Všechny díly (2)" / „PR-30 · Matrice" / „PR-31, PR-32". */
  title: string;
  /** Skupina pokrývá všechny položky zakázky. */
  all: boolean;
  items: TechItemView[];
  steps: TechStepView[];
  /** Zákazníkovi dodáno (ks) — null, když zatím nic. */
  delivered: { done: number; total: number; unit: string } | null;
}

export interface TechNext {
  key: FlowActionKey;
  label: string;
  /** Proč právě tohle („Kalení: TepKal ještě neposlal cenu"). */
  hint: string | null;
}

export interface TechCardView {
  /** Nic nenastaveno (žádný krok ani postup / kompletní zadání). */
  empty: boolean;
  groups: TechGroupView[];
  stepCount: number;
  /** Jména firem (bez „U nás") v pořadí kroků. */
  suppliers: string[];
  inHouse: boolean;
  skipped: number;
  /** Konečný termín zákazníka (chip v hlavičce karty). */
  final: { text: string; tone: PillTone; title: string } | null;
  /** Postup končí po termínu zákazníka (routeHealth). */
  risk: string | null;
  /** Nákup celkem z objednávek / nabídek kroků (jen s právem na ceny). */
  cost: { amount: number; currency: string; pending: number } | null;
}

export interface TechCardInput {
  stage: JobStage;
  items: JobItem[];
  ops: JobOperation[];
  /** Nabídky dodavatelů / objednávky — null = bez práva na nákup (data se nenačítají). */
  quotes: SupplierQuoteView[] | null;
  purchaseOrders: PurchaseOrderView[] | null;
  /** Konečný termín (zákazník): z předání, jinak z termínů zakázky. */
  finalDate: { date: string | null; source: "due_date" | "customer_required_date" | null } | null;
  today: string;
  canSeePrices: boolean;
  currency: string;
}

function itemLabel(it: Pick<JobItem, "drawingNumber" | "name" | "position">): string {
  const d = (it.drawingNumber ?? "").trim();
  const n = (it.name ?? "").trim();
  if (d && n) return `${d} · ${n}`;
  return d || n || `Položka ${it.position + 1}`;
}

function sameSupplier(q: SupplierQuoteView, op: JobOperation): boolean {
  if (op.supplier?.id && q.supplier?.id) return op.supplier.id === q.supplier.id;
  const a = (op.supplier?.name ?? op.supplierName ?? "").trim().toLowerCase();
  return Boolean(a) && a === q.supplierName.trim().toLowerCase();
}

/** Nabídky, které na krok sedí (stejný dodavatel; u nevybraného kroku jen podle druhu). */
function quotesForStep(op: JobOperation, quotes: SupplierQuoteView[]): SupplierQuoteView[] {
  const linked = op.supplierQuoteId ? quotes.find((q) => q.id === op.supplierQuoteId) : null;
  if (linked) return [linked];
  const named = hasWho(op) && !op.inHouse;
  return quotes
    .filter((q) => {
      const match = quoteStepMatch(quoteKinds(q).kinds, op.kind);
      return named ? sameSupplier(q, op) && match >= 1 : match >= 2;
    })
    // vítězná, pak s cenou (nejlevnější), pak čekající
    .sort((a, b) => Number(b.selected) - Number(a.selected)
      || Number(a.total === null) - Number(b.total === null)
      || (a.total ?? 0) - (b.total ?? 0));
}

function deadlineOpOf(op: JobOperation, leadTimeDays: number | null): DeadlineOp {
  return {
    plannedEnd: op.plannedEnd, endsAtCustomerDate: op.endsAtCustomerDate, deadlineState: op.deadlineState ?? null,
    deadlineSource: op.deadlineSource ?? null, inHouse: op.inHouse, location: op.location, status: op.status,
    deadlineChangedBy: op.deadlineChangedBy ?? null, deadlineChangedAt: op.deadlineChangedAt ?? null,
    purchaseOrder: op.purchaseOrder ? { number: op.purchaseOrder.number, status: op.purchaseOrder.status, confirmedDate: op.purchaseOrder.confirmedDate } : null,
    leadTimeDays,
  };
}

/** Termín kroku krátce („do 13. 11. · potvrzeno"); červeně po termínu, za termínem zákazníka nebo s pozdějším potvrzením. */
function stepDeadline(
  op: JobOperation, quote: SupplierQuoteView | null, input: TechCardInput, closed: boolean,
): TechStepView["deadline"] {
  if (op.status === "hotovo" || op.status === "preskoceno" || closed) return null;
  const ctx = { finalDate: input.finalDate, today: input.today };
  const end = pragueDay(op.plannedEnd);
  if (end) {
    const dop = deadlineOpOf(op, quote?.leadTimeDays ?? null);
    const pill = deadlinePill(dop, ctx);
    if (!pill) return null;
    let text: string;
    let tone = pill.tone;
    if (tone === "red" || op.endsAtCustomerDate) text = pill.text;
    else {
      const state = op.deadlineState ?? (op.inHouse ? "plan" : "odhad");
      text = `do ${shortDay(end)} · ${DEADLINE_STATE_META[state].label}`;
    }
    const confirmed = pragueDay(op.purchaseOrder?.confirmedDate ?? null);
    if (confirmed && confirmed > end) {
      tone = "red";
      text += ` · dodavatel potvrdil až ${shortDay(confirmed)}`;
    }
    const fin = pragueDay(input.finalDate?.date ?? null);
    if (!op.endsAtCustomerDate && fin && end > fin) {
      tone = "red";
      text += " · po termínu zákazníka";
    }
    return { text, tone, title: deadlineText(dop, ctx) };
  }
  if (quote?.deliveryDate) return { text: `dle nabídky do ${shortDay(quote.deliveryDate)}`, tone: "grey", title: null };
  if (quote?.leadTimeDays) return { text: `dle nabídky ${leadTimeLabel(quote.leadTimeDays)}`, tone: "grey", title: null };
  if (!isBeforeProduction(input.stage) && !op.inHouse) return { text: "termín chybí", tone: "amber", title: null };
  return null;
}

function phaseOf(
  op: JobOperation,
  ctx: {
    closed: boolean; current: boolean; before: boolean; po: PurchaseOrderView | null; quotes: SupplierQuoteView[]; today: string;
    /** Poptávka / nacenění / nabídka. */
    early: boolean;
    /** Firma kroku má nabídku s cenou (null = nevíme — bez práva na ceny). */
    priced: boolean | null;
  },
): { phase: StepPhase; status: string } {
  const finished = dayLabel(op.finishedAt, ctx.today);
  const started = dayLabel(op.startedAt, ctx.today);
  if (ctx.closed && isOpenStep(op)) return { phase: "uzavreno", status: STEP_PHASES.uzavreno.label };
  if (op.status === "problem") return { phase: "problem", status: STEP_PHASES.problem.label };
  if (op.status === "hotovo") {
    const phase = op.inHouse ? "hotovo" : "dodano";
    return { phase, status: `${STEP_PHASES[phase].label}${finished ? ` ${finished}` : ""}` };
  }
  const poStatus = op.purchaseOrder?.status ?? ctx.po?.status ?? null;
  if (!op.inHouse && poStatus === "dodana") return { phase: "dodano", status: STEP_PHASES.dodano.label };
  const receipt = ctx.po?.receipt;
  if (!op.inHouse && receipt && receipt.total > 0 && (receipt.partial || receipt.done > 0) && receipt.done < receipt.total) {
    return { phase: "castecne_dodano", status: `${STEP_PHASES.castecne_dodano.label} (${receipt.done}/${receipt.total} ${czPlural(receipt.total, "položka", "položky", "položek")})` };
  }
  if (op.status === "probiha") return { phase: "ve_vyrobe", status: `${op.inHouse ? "Ve výrobě u nás" : "Ve výrobě u dodavatele"}${started ? ` od ${started}` : ""}` };
  // čeká
  if (op.inHouse) return { phase: "ceka", status: ctx.current && !ctx.before ? "Na řadě" : STEP_PHASES.ceka.label };
  const pending = ctx.quotes.find((q) => q.total === null);
  if (!hasWho(op)) {
    // poptaný dodavatel je vidět u „kdo" („Poptáno: TepKal") — ne „bez dodavatele"
    if (pending) return { phase: "ceka_na_nabidku", status: STEP_PHASES.ceka_na_nabidku.label };
    const priced = ctx.quotes.filter((q) => q.total !== null).length;
    return { phase: "bez_firmy", status: priced ? `Vybrat z ${priced} ${czPlural(priced, "nabídky", "nabídek", "nabídek")}` : STEP_PHASES.bez_firmy.label };
  }
  if (poStatus === "navrh" || poStatus === "vystavena") return { phase: "k_odeslani", status: STEP_PHASES.k_odeslani.label };
  if (poStatus === "odeslana" || poStatus === "potvrzena" || op.purchaseOrderNumber || op.poMode === "neobjednavat") {
    return { phase: "objednano", status: STEP_PHASES.objednano.label };
  }
  if (poStatus === "zrusena") return { phase: "k_objednani", status: "Objednávka zrušena" };
  if (pending && sameSupplier(pending, op)) return { phase: "ceka_na_nabidku", status: STEP_PHASES.ceka_na_nabidku.label };
  // naceňuje se: objednávat se ještě nebude — stačí vědět, jestli od firmy máme cenu
  if (ctx.early && ctx.priced !== null) return { phase: "k_objednani", status: ctx.priced ? "Nabídka s cenou" : "Bez nabídky" };
  return { phase: "k_objednani", status: STEP_PHASES.k_objednani.label };
}

function stepCost(op: JobOperation, po: PurchaseOrderView | null, quote: SupplierQuoteView | null, currency: string): StepCost | null {
  if (po && po.status !== "zrusena") return { amount: Number.isFinite(po.total) ? po.total : null, currency: po.currency || currency, source: "objednavka", ref: po.number };
  if (op.inHouse || !quote) return null;
  return { amount: quote.total, currency: quote.currency || currency, source: "nabidka", ref: quote.number };
}

/** Celý view-model karty. */
export function buildTechCard(input: TechCardInput): TechCardView {
  const { items, today } = input;
  const sorted = sortOperations(input.ops);
  const live = sorted.filter((o) => o.status !== "preskoceno");
  const closed = closedProductionView(sorted, input.stage).closedOpen > 0;
  const before = isBeforeProduction(input.stage);
  const early = input.stage === "poptavka" || input.stage === "naceneni" || input.stage === "nabidka";
  const current = live.find((o) => o.status === "probiha" || o.status === "problem") ?? live.find((o) => o.status === "ceka") ?? null;
  const quotes = input.quotes ?? [];
  const pos = input.purchaseOrders ?? [];
  const itemIds = new Set(items.map((i) => i.id));

  const steps = new Map<string, TechStepView>();
  let costSum = 0;
  let costPending = 0;
  const counted = new Set<string>();
  live.forEach((op, i) => {
    const matched = quotesForStep(op, quotes);
    const quote = hasWho(op) && !op.inHouse ? matched[0] ?? null : null;
    const po = op.purchaseOrderId ? pos.find((p) => p.id === op.purchaseOrderId) ?? null : null;
    const priced = input.canSeePrices ? (quote ? quote.total !== null : false) : null;
    const { phase, status } = phaseOf(op, { closed, current: current?.id === op.id, before, po, quotes: matched, today, early, priced });
    const who = whoOfOperation(op);
    const role = performerRole(op, sorted);
    const hasPo = Boolean(op.purchaseOrder || op.purchaseOrderNumber);
    // před výrobou vznikne objednávka až předáním („až díl půjde do kroku" platí jen ve výrobě); při nacenění nic
    const chip = !hasPo && early ? null
      : !hasPo && before && hasWho(op) && !op.inHouse && op.poMode !== "neobjednavat" ? { text: "Objednávka se vystaví při předání do výroby" }
      : poChipOf(op, today);
    const cost = input.canSeePrices ? stepCost(op, po, quote, input.currency) : null;
    if (cost) {
      const key = `${cost.source}:${cost.ref ?? op.id}`;
      if (!counted.has(key)) {
        counted.add(key);
        if (cost.amount === null) costPending += 1;
        else costSum += cost.amount;
      }
    }
    const pendingQuote = matched.find((q) => q.total === null) ?? null;
    // krok bez firmy, na který se čeká s nabídkou: cena zatím chybí (do součtu „N cen chybí")
    if (input.canSeePrices && !cost && pendingQuote && phase === "ceka_na_nabidku" && !counted.has(`nabidka:${pendingQuote.number ?? pendingQuote.id}`)) {
      counted.add(`nabidka:${pendingQuote.number ?? pendingQuote.id}`);
      costPending += 1;
    }
    steps.set(op.id, {
      id: op.id, no: i + 1, kind: op.kind, label: stepLabel(op, sorted), who, whoText: whoLabel(who),
      whoRole: [role && role !== "u nás" ? role : null, who.type === "free" ? "mimo adresář" : null].filter(Boolean).join(" · ") || null,
      phase, status, tone: STEP_PHASES[phase].tone,
      po: chip?.text ?? null, poNumber: op.purchaseOrder?.number ?? op.purchaseOrderNumber ?? null,
      deadline: stepDeadline(op, quote ?? matched.find((q) => q.total !== null) ?? null, input, closed),
      cost,
      quotePending: input.canSeePrices && pendingQuote && phase !== "objednano" && phase !== "dodano" ? pendingQuote.supplierName : null,
      quoteCount: input.canSeePrices && !hasWho(op) ? matched.length : 0,
      note: lastNoteLine(op.note, 140),
      // zvýraznění „teď se dělá" jen ve výrobě (před předáním se nic neděje)
      current: current?.id === op.id && !closed && !before,
      endsAtCustomerDate: Boolean(op.endsAtCustomerDate),
    });
  });

  // skupiny položek se stejným postupem (krok bez dílů / s neznámými díly = všechny)
  const covers = (op: JobOperation, itemId: string) => {
    const ids = (op.orderItemIds ?? []).filter((x) => itemIds.has(x));
    return !ids.length || ids.includes(itemId);
  };
  const groups: TechGroupView[] = [];
  if (!items.length) {
    if (live.length) groups.push({ key: "all", title: "Celá zakázka", all: true, items: [], steps: live.map((o) => steps.get(o.id)!), delivered: null });
  } else {
    const bySig = new Map<string, JobItem[]>();
    for (const it of [...items].sort((a, b) => a.position - b.position)) {
      const sig = live.filter((o) => covers(o, it.id)).map((o) => o.id).join(",");
      bySig.set(sig, [...(bySig.get(sig) ?? []), it]);
    }
    for (const [sig, list] of bySig) {
      const all = list.length === items.length;
      const total = list.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
      const done = list.reduce((s, i) => s + Math.min(Number(i.deliveredQuantity ?? 0) || 0, Number(i.quantity) || 0), 0);
      const units = [...new Set(list.map((i) => i.unit || "ks"))];
      groups.push({
        key: sig || "none",
        title: all && items.length > 1 ? `Všechny díly (${items.length})` : list.map(itemLabel).join(", "),
        all,
        items: list.map((i) => ({
          id: i.id, label: itemLabel(i), quantity: Number(i.quantity) || 0, unit: i.unit || "ks", material: i.material ?? null,
          procedure: (i.tech?.procedure ?? "").trim() || null, complete: Boolean(i.tech?.complete),
          completeBy: i.tech?.complete ? (i.tech.completeBy ?? "").trim() || null : null,
          supplierNote: (i.tech?.supplierNote ?? "").trim() || null,
          delivered: Number(i.deliveredQuantity ?? 0) || 0,
        })),
        steps: sig ? sig.split(",").map((id) => steps.get(id)!) : [],
        delivered: done > 0 ? { done, total, unit: units.length === 1 ? units[0] : "ks" } : null,
      });
    }
  }

  const anyTech = items.some((i) => techStateOf(i.tech) !== "chybi" || (i.tech?.supplierNote ?? "").trim());
  const suppliers = [...new Set(live.filter((o) => !o.inHouse && hasWho(o)).map((o) => whoLabel(whoOfOperation(o))))];

  // konečný termín zákazníka (hlavička karty) + ohrožení celého postupu
  const finDate = pragueDay(input.finalDate?.date ?? null);
  const health = routeHealth(sorted.map((o) => ({ ...o })), {
    dueDate: input.finalDate?.source === "due_date" ? finDate : null,
    customerRequiredDate: input.finalDate?.source === "customer_required_date" ? finDate : null,
  }, today);
  const late = health.find((h) => h.code === "route_late") ?? null;
  const delivered = input.stage === "dodano_zakaznikovi" || input.stage === "fakturovano" || input.stage === "dokonceno";
  let final: TechCardView["final"] = null;
  if (finDate) {
    const unconfirmed = input.finalDate?.source === "customer_required_date";
    const overdue = !delivered && finDate < today;
    final = {
      text: `Termín zákazníka ${shortDay(finDate)}${overdue ? " · prošel" : ""}`,
      tone: overdue || late ? "red" : unconfirmed ? "amber" : "grey",
      title: unconfirmed ? "Požadavek zákazníka — zatím nepotvrzený" : "Dohodnuto se zákazníkem",
    };
  } else if (live.length && !delivered) {
    final = { text: "Termín zákazníka chybí", tone: "amber", title: "Doplň konečný termín v hlavičce zakázky" };
  }

  return {
    empty: !live.length && !anyTech,
    groups,
    stepCount: live.length,
    suppliers,
    inHouse: live.some((o) => o.inHouse),
    skipped: sorted.length - live.length,
    final,
    risk: late && !delivered ? late.message : null,
    cost: input.canSeePrices && counted.size ? { amount: costSum, currency: input.currency, pending: costPending } : null,
  };
}

/** Akce dalšího kroku z hlavičky karty, které patří technologii (výroba, dodání, ceny dodavatelů). */
const FLOW_TECH_KEYS: FlowActionKey[] = [
  "production.handoff", "production.advance", "production.replan", "production.sendPo", "production.finish",
  "delivery.record", "pricing.supplierPrice",
];

/**
 * Jeden další krok karty: přednost má další krok zakázky, když je technologický (stejné tlačítko jako v hlavičce,
 * žádná druhá logika); jinak co v technologii chybí — nastavit, poptat / zadat cenu dodavatele, doplnit kdo,
 * odeslat objednávku, předat do výroby.
 */
export function techNextAction(
  view: TechCardView,
  ctx: { stage: JobStage; flowNext: { key: FlowActionKey; label: string } | null; can: (f: Feature) => boolean },
): TechNext | null {
  const allowed = (key: FlowActionKey, label: string, hint: string | null = null): TechNext | null =>
    ctx.can(FLOW_ACTIONS[key].feature) ? { key, label, hint } : null;
  const steps = view.groups.flatMap((g) => g.steps).filter((s, i, a) => a.findIndex((x) => x.id === s.id) === i);
  const stepName = (s: TechStepView) => `${s.no}. ${s.label}`;

  if (view.empty) return allowed("production.plan", "Nastavit technologii");
  if (ctx.flowNext && FLOW_TECH_KEYS.includes(ctx.flowNext.key)) {
    const s = steps.find((x) => x.current) ?? null;
    return allowed(ctx.flowNext.key, ctx.flowNext.label, s ? `${stepName(s)} · ${s.whoText} — ${s.status.toLowerCase()}` : null);
  }
  const waiting = steps.find((s) => s.phase === "ceka_na_nabidku");
  if (waiting) {
    const hint = `${stepName(waiting)}: ${waiting.quotePending ?? "dodavatel"} ještě neposlal cenu`;
    const r = allowed("pricing.supplierPrice", "Zadat cenu dodavatele", hint);
    if (r) return r;
  }
  const early = ctx.stage === "poptavka" || ctx.stage === "naceneni" || ctx.stage === "nabidka";
  const noWho = steps.find((s) => s.phase === "bez_firmy");
  if (noWho) {
    if (early && !noWho.quoteCount) {
      const r = allowed("pricing.supplierPrice", "Poptat dodavatele", `${stepName(noWho)}: zatím žádná nabídka — zapiš ji v Nákupu`);
      if (r) return r;
    }
    return allowed("production.plan", "Doplnit, kdo to dělá", `${stepName(noWho)}: firma zatím nevybraná`);
  }
  // naceňuje se a firma kroku ještě neposlala nabídku (žádná ani bez ceny) → poptat ji
  const unquoted = early ? steps.find((s) => s.phase === "k_objednani" && !s.cost && (s.who.type === "supplier" || s.who.type === "free")) : null;
  if (unquoted) {
    const r = allowed("pricing.supplierPrice", "Poptat dodavatele", `${stepName(unquoted)}: ${unquoted.whoText} — zatím bez nabídky`);
    if (r) return r;
  }
  const unsent = steps.find((s) => s.phase === "k_odeslani");
  if (unsent) {
    const r = allowed("production.sendPo", "Odeslat objednávku", `${stepName(unsent)} · ${unsent.whoText}${unsent.poNumber ? ` — ${unsent.poNumber}` : ""}`);
    if (r) return r;
  }
  const bare = view.groups.find((g) => !g.steps.length && g.items.some((i) => !i.procedure && !i.complete));
  if (bare) return allowed("production.plan", "Doplnit technologii", `${bare.title}: bez kroků a bez postupu`);
  if ((ctx.stage === "objednavka" || ctx.stage === "potvrzeno") && steps.length) return allowed("production.handoff", "Předat do výroby…");
  return null;
}

/** Krátké shrnutí do podtitulku karty („3 kroky · Novák, TepKal + u nás"). */
export function techSummary(view: TechCardView): string {
  if (view.empty) return "Technologie zatím nenastavena";
  if (!view.stepCount) return "Postup technologa po položkách — kroky výroby zatím nenaplánované";
  const who = [view.suppliers.join(", "), view.inHouse ? (view.suppliers.length ? "u nás" : "vše u nás") : null].filter(Boolean).join(" + ");
  return `${view.stepCount} ${czPlural(view.stepCount, "krok", "kroky", "kroků")}${who ? ` · ${who}` : ""}`;
}

/** Popisky druhů kroků („Frézování → Tepelné zpracování") — pro testy a náhled. */
export function routeText(group: TechGroupView): string {
  return group.steps.map((s) => s.label || OPERATION_KINDS[s.kind].label).join(" → ");
}
