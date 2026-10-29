// Předání do výroby — stav dialogu (čisté funkce, bez Reactu; sdílí dialog a testy).
// Plán ze serveru (prepareProductionHandoff) → stav, který uživatel jen potvrdí nebo opraví → vstup
// submitProductionHandoff. Ceny nikdy neposíláme (server je staví z nabídky), kontrola je stejná jako na serveru.
import { OPERATION_KINDS, type OperationKind, type OperationStatus } from "@/lib/jobs/operations";
import { stepLabel } from "@/lib/jobs/production";
import { addCalendarDays, addWorkingDays } from "@/lib/jobs/purchasing";
import { canSubmitHandoff, stepHasWho, validateHandoff, type HandoffValidationStep } from "@/lib/jobs/production-handoff";
import { leadTimeLabel, money, shortDay, suggestStepDeadline } from "@/lib/jobs/production-suggest";
import type {
  DeadlineSource, HandoffInput, HandoffIssue, HandoffKind, HandoffPlan, HandoffStepInput, StepPlan, StepWho, WhoSource, WhoSuggestion,
} from "@/lib/jobs/production-handoff-types";
import type { JobStage, PurchaseOrderStatus } from "@/lib/supabase/database.types";

// ── Stav ────────────────────────────────────────────────────
export interface DraftStep {
  key: string;
  operationId: string | null;
  status: OperationStatus | null;
  locked: StepPlan["locked"];
  kind: OperationKind;
  title: string | null;
  who: StepWho;
  whoSource: WhoSource | null;
  supplierQuoteId: string | null;
  /** RRRR-MM-DD; "" = nevyplněno. */
  plannedEnd: string;
  deadlineSource: DeadlineSource | null;
  deadlineCaption: string | null;
  /** Termín předvyplnila AI (posune se, když se změní předchozí krok / firma). */
  autoDeadline: boolean;
  deadlineAgreed: boolean;
  endsAtCustomerDate: boolean;
  orderItemIds: string[] | null;
  start: boolean;
  done: boolean;
  po: HandoffStepInput["po"];
  note: string | null;
  suggestions: { primary: WhoSuggestion | null; alternatives: WhoSuggestion[] };
  /** Náhled objednávky ze serveru — platí, dokud se nezmění kdo a díly. */
  serverPreview: StepPlan["poPreview"];
  previewKey: string;
  /** Krok přidaný v dialogu (ne z plánu). */
  added: boolean;
}

export interface HandoffState {
  kind: HandoffKind;
  steps: DraftStep[];
  /** Konečný termín (zákazník) zadaný v dialogu — jen když ho zakázka nemá. */
  finalDate: { date: string; confirmed: boolean } | null;
  /** Obchodník/admin potvrzuje požadavek zákazníka jako dohodnutý. */
  confirmRequested: boolean;
  updateCustomerDate: boolean;
  acceptLate: boolean;
  /** „Rovnou odeslat dodavateli" (jen s právem na ceny). */
  sendNow: boolean;
  note: string;
  /** Další krok: připravený krok / jiný krok. */
  advance: "next" | "other";
  /** Převzetí od dodavatele: id položky objednávky → převzato celkem. */
  receipts: Record<string, number>;
  continueWithoutRest: boolean;
  finishTarget: JobStage;
  skipReason: string;
  cancelSent: string[];
  /** Poznámky pro dodavatele upravené v dialogu (id položky → text); uloží se k položce před předáním. */
  itemNotes: Record<string, string>;
}

let seq = 0;
function newKey(): string {
  seq += 1;
  return `n${Date.now().toString(36)}${seq}`;
}

export function whoKey(w: StepWho | null | undefined): string {
  if (!w) return "none";
  if (w.type === "supplier") return `s:${w.id}`;
  if (w.type === "free") return `f:${w.name.trim().toLowerCase()}`;
  return w.type;
}

export function whoName(w: StepWho | null | undefined): string | null {
  if (!w) return null;
  if (w.type === "u_nas") return "U nás";
  if (w.type === "supplier") return (w.name ?? "").trim() || null;
  if (w.type === "free") return w.name.trim() || null;
  return null;
}

function previewKeyOf(s: Pick<DraftStep, "who" | "orderItemIds" | "supplierQuoteId">): string {
  return `${whoKey(s.who)}|${(s.orderItemIds ?? []).join(",")}|${s.supplierQuoteId ?? ""}`;
}

function fromPlanStep(p: StepPlan): DraftStep {
  const d: DraftStep = {
    key: p.key, operationId: p.operationId ?? null, status: p.status, locked: p.locked, kind: p.kind, title: p.title ?? null,
    who: p.who, whoSource: p.whoSource ?? null, supplierQuoteId: p.supplierQuoteId ?? null, plannedEnd: p.plannedEnd ?? "",
    deadlineSource: p.deadlineSource ?? null, deadlineCaption: p.deadlineCaption,
    autoDeadline: Boolean(p.deadlineCaption) && p.deadlineSource !== "rucne" && p.deadlineSource !== "potvrzeni_dodavatele",
    deadlineAgreed: Boolean(p.deadlineAgreed), endsAtCustomerDate: Boolean(p.endsAtCustomerDate), orderItemIds: p.orderItemIds ?? null,
    start: Boolean(p.start), done: Boolean(p.done), po: { ...p.po }, note: p.note ?? null,
    suggestions: p.suggestions, serverPreview: p.poPreview, previewKey: "", added: false,
  };
  d.previewKey = previewKeyOf(d);
  return d;
}

/** Výchozí stav dialogu = plán serveru (vše předvyplněné, uživatel jen potvrdí). */
export function stateFromPlan(plan: HandoffPlan, opts: { target?: JobStage | null } = {}): HandoffState {
  const steps = plan.steps.map(fromPlanStep);
  const receipts: Record<string, number> = {};
  for (const it of plan.current?.purchaseOrder?.items ?? []) receipts[it.id] = it.quantity;
  return {
    kind: plan.kind,
    steps: demoteFinal(steps),
    finalDate: plan.finalDate.date ? null : { date: "", confirmed: false },
    confirmRequested: false,
    updateCustomerDate: false,
    acceptLate: false,
    // „Rovnou odeslat" je volba člověka (výchozí vypnuto); plná automatika bezpečné objednávky pošle sama
    sendNow: false,
    note: "",
    advance: "next",
    receipts,
    continueWithoutRest: false,
    finishTarget: opts.target ?? plan.target ?? "dodano_k_nam",
    skipReason: "",
    cancelSent: [],
    itemNotes: {},
  };
}

// ── Poznámky pro dodavatele (Technologie → objednávka) ─────
/** Poznámka pro dodavatele položky, jak ji dialog ukazuje (upravená, jinak uložená). */
export function itemNoteOf(plan: HandoffPlan, state: Pick<HandoffState, "itemNotes">, itemId: string): string {
  if (itemId in state.itemNotes) return state.itemNotes[itemId];
  return plan.client?.items.find((i) => i.id === itemId)?.supplierNote ?? "";
}

/** Položky kroku (rozsah kroku, jinak všechny). */
export function stepItems(plan: HandoffPlan, step: Pick<DraftStep, "orderItemIds">): NonNullable<HandoffPlan["client"]>["items"] {
  const items = plan.client?.items ?? [];
  return step.orderItemIds ? items.filter((i) => step.orderItemIds!.includes(i.id)) : items;
}

/** Změněné poznámky pro dodavatele → uložit k položkám (saveItemTechnology) před předáním. */
export function itemNotePatches(plan: HandoffPlan, state: Pick<HandoffState, "itemNotes">): { itemId: string; supplierNote: string | null }[] {
  const out: { itemId: string; supplierNote: string | null }[] = [];
  for (const [itemId, text] of Object.entries(state.itemNotes)) {
    const before = (plan.client?.items.find((i) => i.id === itemId)?.supplierNote ?? "").trim();
    const after = text.replace(/\s+/g, " ").trim();
    if (before !== after) out.push({ itemId, supplierNote: after || null });
  }
  return out;
}

// ── Přesun bez předání (hlídání předání je zatím vypnuté — majitel 29. 10.) ──
/**
 * Druhotná akce dialogu: přesunout stav „postaru" (bez kdo / termínu / ukončení kroků). Do historie se
 * zapíše, kdo to udělal; chybějící kdo a termín pak zakázka ukazuje jen jako upozornění.
 * null = dialog stav nemění (doplnění, další krok, plán) → není co přesouvat.
 */
export function plainMoveOf(
  kind: HandoffKind,
  opts: { stage?: JobStage | null; target?: JobStage | null; finishTarget?: JobStage | null },
): { to: JobStage; label: string; note: string } | null {
  if (kind === "predani") {
    if (opts.stage === "ve_vyrobe") return null;
    return { to: "ve_vyrobe", label: "Přesunout bez dodavatele a termínu", note: "Přesunuto do výroby bez dodavatele a termínu (bez předání)" };
  }
  if (kind === "ukonceni") {
    const to = opts.target ?? opts.finishTarget ?? null;
    return to ? { to, label: "Přesunout bez ukončení kroků", note: "Přesunuto bez ukončení kroků výroby" } : null;
  }
  if (kind === "zaznam") {
    const to = opts.target ?? opts.finishTarget ?? null;
    return to ? { to, label: "Přesunout bez zápisu výroby", note: "Přesunuto bez zápisu, kdo díl vyrobil" } : null;
  }
  if (kind === "zpet") {
    return opts.target ? { to: opts.target, label: "Jen přesunout stav (kroky a objednávky zůstanou)", note: "Stav vrácen bez vrácení předání (kroky a objednávky zůstaly)" } : null;
  }
  return null;
}

// ── Nabídka telefonem ───────────────────────────────────────
/** Zapsaná nabídka telefonem se stane návrhem kroku a rovnou se vybere (kdo + termín z nabídky). */
export function applyPhoneQuote(plan: HandoffPlan, state: HandoffState, i: number, sug: WhoSuggestion): HandoffState {
  const s = state.steps[i];
  if (!s) return state;
  const alternatives = [sug, ...s.suggestions.alternatives.filter((a) => a.supplierQuoteId !== sug.supplierQuoteId)];
  const withSug: HandoffState = { ...state, steps: updateStep(state, i, { suggestions: { primary: s.suggestions.primary, alternatives }, autoDeadline: true }) };
  return setStepWho(plan, withSug, i, sug.who, sug);
}

/** Konečný termín (zákazník) smí mít jen poslední krok — ostatním se odebere. */
export function demoteFinal(steps: DraftStep[]): DraftStep[] {
  return steps.map((s, i) => (s.endsAtCustomerDate && i !== steps.length - 1 ? { ...s, endsAtCustomerDate: false } : s));
}

// ── Konečný termín ──────────────────────────────────────────
/** Konečný termín (zákazník), se kterým dialog počítá (zakázky, nebo zadaný v dialogu). */
export function finalDateOf(plan: HandoffPlan, state: Pick<HandoffState, "finalDate">): string | null {
  return plan.finalDate.date ?? (state.finalDate?.date || null);
}

// ── Popisky a čísla kroků ───────────────────────────────────
const BEFORE: OperationStatus[] = ["hotovo", "probiha", "problem"];

/** „Výroba 1 / Výroba 2 / Tepelné zpracování" podle celého postupu (hotové a běžící kroky jsou před dialogem). */
export function stepLabels(plan: HandoffPlan, steps: Pick<DraftStep, "key" | "kind" | "title">[]): string[] {
  const other = plan.client?.otherSteps ?? [];
  const route: { id: string; kind: OperationKind; status: OperationStatus; position: number }[] = [];
  other.filter((o) => BEFORE.includes(o.status)).forEach((o, i) => route.push({ id: `b${i}`, kind: o.kind, status: o.status, position: route.length }));
  steps.forEach((s) => route.push({ id: `d:${s.key}`, kind: s.kind, status: "ceka", position: route.length }));
  other.filter((o) => o.status === "ceka").forEach((o, i) => route.push({ id: `a${i}`, kind: o.kind, status: o.status, position: route.length }));
  return steps.map((s) => stepLabel({ id: `d:${s.key}`, kind: s.kind, title: s.title }, route));
}

/** „Krok n/m" kroku dialogu (n = pořadí mezi nepřeskočenými kroky postupu). */
export function stepCounter(plan: HandoffPlan, steps: unknown[], i: number): string {
  const other = (plan.client?.otherSteps ?? []).filter((o) => o.status !== "preskoceno");
  const before = other.filter((o) => BEFORE.includes(o.status)).length;
  return `Krok ${before + i + 1}/${other.length + steps.length}`;
}

/** Kdo krok dělá z pohledu zakázky: „u nás" / „dodavatel" / „částečný dodavatel". */
export function roleOf(plan: HandoffPlan, steps: DraftStep[], i: number): "u nás" | "dodavatel" | "částečný dodavatel" | null {
  const s = steps[i];
  if (s.who.type === "u_nas") return "u nás";
  if (!stepHasWho(s.who)) return null;
  const total = (plan.client?.otherSteps ?? []).filter((o) => o.status !== "preskoceno").length + steps.length;
  return s.kind === "kompletni_dodavka" || total <= 1 ? "dodavatel" : "částečný dodavatel";
}

// ── Objednávka kroku ────────────────────────────────────────
/** Krok teď vystavuje NOVOU objednávku (stejně jako server). */
export function ordersNew(kind: HandoffKind, s: Pick<DraftStep, "who" | "po" | "start">): boolean {
  if ((s.who.type !== "supplier" && s.who.type !== "free") || kind === "zaznam" || kind === "zpet" || kind === "ukonceni") return false;
  if (s.po.mode === "vystavit") return kind !== "plan" || Boolean(s.po.orderNow);
  if (s.po.mode === "pri_predani") return Boolean(s.start || s.po.orderNow);
  return false;
}

export type PoLine =
  | { mode: "u_nas" }
  | { mode: "none_who" }
  | { mode: "existing"; number: string; status: PurchaseOrderStatus; supplierName: string | null }
  | { mode: "new"; supplierName: string | null; itemCount: number; unpriced: number; total: number | null; currency: string; requiredDate: string | null; blockers: string[]; email: string | null }
  | { mode: "later" }
  | { mode: "other"; reason: string };

/** Co se stane s objednávkou kroku (náhled pod krokem). */
export function poLineOf(plan: HandoffPlan, state: HandoffState, i: number): PoLine {
  const s = state.steps[i];
  if (s.who.type === "u_nas") return { mode: "u_nas" };
  if (s.who.type === "none") return { mode: "none_who" };
  if (s.po.mode === "neobjednavat") return { mode: "other", reason: s.po.noneReason ?? "" };
  if (s.po.mode === "existujici" && s.po.existingId) {
    const ex = s.serverPreview?.existing ?? null;
    const open = plan.openPurchaseOrders.find((p) => p.id === s.po.existingId);
    return { mode: "existing", number: ex?.number ?? open?.number ?? "—", status: ex?.status ?? open?.status ?? "vystavena", supplierName: whoName(s.who) };
  }
  if (!ordersNew(state.kind, s)) return { mode: "later" };
  const sameServer = s.serverPreview && s.previewKey === previewKeyOf(s) && !s.serverPreview.existing ? s.serverPreview : null;
  const sid = s.who.type === "supplier" ? s.who.id : null;
  const supplier = sid ? plan.client?.suppliers.find((x) => x.id === sid) ?? null : null;
  const items = plan.client?.items ?? [];
  const scope = s.orderItemIds ? items.filter((it) => s.orderItemIds!.includes(it.id)) : items;
  const sug = [s.suggestions.primary, ...s.suggestions.alternatives].find((x) => x && x.supplierQuoteId && x.supplierQuoteId === s.supplierQuoteId) ?? null;
  // objednávka podle návrhu = stejné pravidlo jako server (purchaseItemsForStep): ne „cena nabídky", ale ceny položek
  const order = sug?.order ?? null;
  const count = Math.max(1, scope.length);
  const total = sameServer ? sameServer.total
    : !plan.permissions.canSeePrices ? null
      : order ? order.total : sug?.price ?? null;
  return {
    mode: "new",
    supplierName: whoName(s.who),
    itemCount: sameServer ? sameServer.itemCount : order ? order.itemCount : count,
    unpriced: sameServer ? sameServer.unpriced : order ? order.unpriced : sug?.price !== null && sug?.price !== undefined ? 0 : count,
    total,
    currency: sameServer?.currency ?? sug?.currency ?? "CZK",
    requiredDate: s.plannedEnd || null,
    blockers: sameServer ? sameServer.blockers : [],
    email: supplier?.email ?? null,
  };
}

/** Kolik objednávek předání vystaví (souvislé kroky stejné firmy = jedna). */
export function newOrderCount(state: HandoffState): number {
  let n = 0;
  let prev: string | null = null;
  for (const s of state.steps) {
    if (!ordersNew(state.kind, s)) { prev = null; continue; }
    const k = whoKey(s.who);
    if (k !== prev) n += 1;
    prev = s.po.sharedWithNext === false ? null : k;
  }
  return n;
}

/**
 * Plná automatika pošle objednávky samy (obchodník / admin, použitelná schránka, žádná blokace —
 * všechny ceny, platná nabídka, celé pokrytí, nejlevnější / vystavená objednávka, e-mail dodavatele).
 */
export function autoSendsAll(plan: HandoffPlan, state: HandoffState): boolean {
  if (plan.automation.mode !== "full" || !plan.permissions.canSend || !plan.automation.senderEmail) return false;
  let any = false;
  for (let i = 0; i < state.steps.length; i++) {
    const line = poLineOf(plan, state, i);
    if (line.mode !== "new") continue;
    any = true;
    const s = state.steps[i];
    const fromServer = s.serverPreview && s.previewKey === previewKeyOf(s);
    if (!fromServer || line.blockers.length || !line.email) return false;
  }
  return any;
}

/** E-mail dodavatele první nové objednávky (popisek „Rovnou odeslat dodavateli ({email})"). */
export function firstOrderEmail(plan: HandoffPlan, state: HandoffState): { email: string | null; any: boolean } {
  for (let i = 0; i < state.steps.length; i++) {
    const line = poLineOf(plan, state, i);
    if (line.mode === "new") return { email: line.email, any: true };
  }
  return { email: null, any: false };
}

// ── Termín ──────────────────────────────────────────────────
function prevOf(plan: HandoffPlan, steps: DraftStep[], i: number): { end: string | null; who: string | null } {
  if (i > 0) return { end: steps[i - 1].plannedEnd || null, who: whoKey(steps[i - 1].who) };
  return { end: plan.client?.previousEnd?.date ?? null, who: plan.current ? `loc:${plan.current.location}` : null };
}

function quoteOfWho(s: Pick<DraftStep, "suggestions" | "supplierQuoteId">, who: StepWho): WhoSuggestion | null {
  const all = [s.suggestions.primary, ...s.suggestions.alternatives].filter((x): x is WhoSuggestion => Boolean(x));
  return all.find((x) => x.supplierQuoteId && x.supplierQuoteId === s.supplierQuoteId && whoKey(x.who) === whoKey(who))
    ?? all.find((x) => x.supplierQuoteId && whoKey(x.who) === whoKey(who)) ?? null;
}

/** Předvyplněný termín kroku (z nabídky, obvyklé lhůty, konečného termínu, jinak odhad). */
export function suggestedDeadline(plan: HandoffPlan, state: HandoffState, steps: DraftStep[], i: number): { date: string; source: DeadlineSource; caption: string } {
  const s = steps[i];
  const prev = prevOf(plan, steps, i);
  const q = quoteOfWho(s, s.who);
  const sid = s.who.type === "supplier" ? s.who.id : null;
  const sup = sid ? plan.client?.suppliers.find((x) => x.id === sid) ?? null : null;
  const prevWho = i > 0 ? prev.who : plan.current ? prev.who : null;
  const changed = Boolean(prev.end) && prevWho !== null && prevWho !== whoKey(s.who)
    && !(i === 0 && plan.current && plan.current.location === whoName(s.who));
  const d = suggestStepDeadline({
    today: plan.client?.today ?? todayOf(),
    previousEnd: prev.end,
    performerChanged: changed,
    quote: q ? { deliveryDate: q.deliveryDate, leadTimeDays: q.leadTimeDays } : null,
    supplierLeadDays: sup?.leadDays ?? null,
    isLast: i === steps.length - 1 && !(plan.client?.remaining.length && state.kind === "dalsi_krok"),
    finalDate: finalDateOf(plan, state),
    inHouse: s.who.type === "u_nas",
  });
  return { date: d.date, source: d.source, caption: d.caption };
}

function todayOf(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague" }).format(new Date());
}

/** Termíny předvyplněné AI od kroku `from` dál se přepočítají (předchozí krok / firma se změnily). */
function reflow(plan: HandoffPlan, state: HandoffState, steps: DraftStep[], from: number): DraftStep[] {
  const out = [...steps];
  for (let i = Math.max(0, from); i < out.length; i++) {
    const s = out[i];
    if (!s.autoDeadline || s.endsAtCustomerDate || s.status === "probiha" || s.status === "problem") continue;
    const d = suggestedDeadline(plan, state, out, i);
    out[i] = { ...s, plannedEnd: d.date, deadlineSource: d.source, deadlineCaption: d.caption };
  }
  return out;
}

// ── Úpravy ──────────────────────────────────────────────────
function updateStep(state: HandoffState, i: number, patch: Partial<DraftStep>): DraftStep[] {
  return state.steps.map((s, k) => (k === i ? { ...s, ...patch } : s));
}

function poAfterWho(s: DraftStep, who: StepWho, kind: HandoffKind): HandoffStepInput["po"] {
  if (who.type === "u_nas") return { mode: null };
  const keepExisting = s.po.mode === "existujici" && s.po.existingId && whoKey(s.who) === whoKey(who);
  if (keepExisting) return s.po;
  const running = s.status === "probiha" || s.status === "problem";
  const mode = kind === "zaznam" ? "neobjednavat" : s.start || running ? "vystavit" : kind === "plan" ? "vystavit" : "pri_predani";
  return {
    mode, existingId: null, noneReason: mode === "neobjednavat" ? s.po.noneReason || "Zapsáno zpětně" : null,
    orderNow: s.po.orderNow, sharedWithNext: s.po.sharedWithNext,
  };
}

/** Kdo krok dělá: návrh (nejlevnější / jiná nabídka) nebo ruční volba (firma z adresáře, mimo adresář, U nás). */
export function setStepWho(plan: HandoffPlan, state: HandoffState, i: number, who: StepWho, picked?: WhoSuggestion | null): HandoffState {
  const s = state.steps[i];
  const primary = s.suggestions.primary;
  const sug = picked ?? (primary && whoKey(primary.who) === whoKey(who) ? primary : null);
  const whoSource: WhoSource = sug ? sug.source : "rucne";
  const usesPo = sug?.purchaseOrder && sug.source === "objednavka" ? sug.purchaseOrder : null;
  let po = poAfterWho(s, who, state.kind);
  if (usesPo) po = { mode: "existujici", existingId: usesPo.id };
  const next: DraftStep = {
    ...s, who, whoSource, supplierQuoteId: sug?.supplierQuoteId ?? (whoKey(who) === whoKey(s.who) ? s.supplierQuoteId : null),
    po, deadlineAgreed: whoKey(who) === whoKey(s.who) ? s.deadlineAgreed : false,
    autoDeadline: s.autoDeadline || !s.plannedEnd,
  };
  let steps = state.steps.map((x, k) => (k === i ? next : x));
  steps = reflow(plan, state, steps, i);
  return { ...state, steps };
}

/** Ruční termín kroku (zdroj „zadáno ručně"; stav zůstává odhad, dokud není „dohodnuto"). */
export function setStepDate(plan: HandoffPlan, state: HandoffState, i: number, date: string): HandoffState {
  const s = state.steps[i];
  const fin = finalDateOf(plan, state);
  let steps = updateStep(state, i, {
    plannedEnd: date, deadlineSource: "rucne", deadlineCaption: "zadáno ručně", autoDeadline: false,
    endsAtCustomerDate: s.endsAtCustomerDate && date === fin ? true : s.endsAtCustomerDate && state.updateCustomerDate,
  });
  steps = reflow(plan, state, steps, i + 1);
  return { ...state, steps };
}

/** „+3 dny" / „+1 týden" / „+2 týdny" od předchozího kroku (nebo dneška); „= konečný termín". */
export function quickDate(plan: HandoffPlan, state: HandoffState, i: number, q: "3d" | "1w" | "2w" | "final"): string | null {
  if (q === "final") return finalDateOf(plan, state);
  const prev = prevOf(plan, state.steps, i).end;
  const today = plan.client?.today ?? todayOf();
  const base = prev && prev > today ? prev : today;
  const d = q === "3d" ? addCalendarDays(base, 3) : q === "1w" ? addCalendarDays(base, 7) : addCalendarDays(base, 14);
  return d;
}

/** „Tento krok končí konečným termínem (zákazník)" — termín = konečný termín. */
export function setEndsAtFinal(plan: HandoffPlan, state: HandoffState, i: number, on: boolean): HandoffState {
  const fin = finalDateOf(plan, state);
  const steps = state.steps.map((s, k) => {
    if (k !== i) return on ? { ...s, endsAtCustomerDate: false } : s;
    return on && fin ? { ...s, endsAtCustomerDate: true, plannedEnd: fin, deadlineSource: "termin_zakaznika" as const, deadlineCaption: "konečný termín (zákazník)", autoDeadline: false }
      : { ...s, endsAtCustomerDate: false };
  });
  return { ...state, steps };
}

/**
 * Návrhy kdo bez nabídek, které už v dialogu používá jiný krok (Výroba → TZ → Výroba u stejné firmy):
 * druhá objednávka podle stejné nabídky by cenu započítala dvakrát. Taková nabídka se změní na
 * „Stejná firma jako krok n — cena dle nové nabídky" (bez ceny) a primární je další volná nabídka.
 */
export function withoutUsedQuotes(
  plan: HandoffPlan, state: Pick<HandoffState, "steps">, sug: { primary: WhoSuggestion | null; alternatives: WhoSuggestion[] }, exceptIndex = -1,
): { primary: WhoSuggestion | null; alternatives: WhoSuggestion[] } {
  const used = new Map<string, string>();
  state.steps.forEach((s, i) => {
    if (i !== exceptIndex && s.supplierQuoteId && !used.has(s.supplierQuoteId)) used.set(s.supplierQuoteId, `${stepCounter(plan, state.steps, i).replace(/\/\d+$/, "").toLowerCase()}`);
  });
  if (!used.size) return sug;
  const demote = (s: WhoSuggestion): WhoSuggestion => ({
    ...s, source: "posledni_operace", supplierQuoteId: null, quoteNumber: null, purchaseOrder: null, price: null, priceBasis: null, diffToBest: null,
    leadTimeDays: null, deliveryDate: null, coverage: null, expired: false, quantityMismatch: false, badges: [], order: null,
    reason: `Stejná firma jako ${used.get(s.supplierQuoteId as string)} — cena dle nové nabídky`,
  });
  const isUsed = (s: WhoSuggestion | null) => Boolean(s && s.supplierQuoteId && s.source !== "objednavka" && used.has(s.supplierQuoteId));
  if (!isUsed(sug.primary) && !sug.alternatives.some(isUsed)) return sug;
  const free = sug.alternatives.filter((a) => !isUsed(a));
  const demoted = [sug.primary, ...sug.alternatives].filter((x): x is WhoSuggestion => isUsed(x)).map(demote)
    .filter((d, i, all) => all.findIndex((x) => whoKey(x.who) === whoKey(d.who)) === i)
    .filter((d) => !free.some((a) => whoKey(a.who) === whoKey(d.who)) && !(sug.primary && !isUsed(sug.primary) && whoKey(sug.primary.who) === whoKey(d.who)));
  if (!isUsed(sug.primary)) return { primary: sug.primary, alternatives: [...free, ...demoted] };
  const next = free.find((a) => a.supplierQuoteId) ?? null;
  const primary = next ?? demoted[0] ?? free[0] ?? null;
  return { primary, alternatives: [...free.filter((a) => a !== primary), ...demoted.filter((d) => d !== primary)] };
}

/** Přidat krok (na konec, nebo hned za krok `after`) — kdo předvyplní nejlevnější nabídka k druhu kroku. */
export function addStep(plan: HandoffPlan, state: HandoffState, kind: OperationKind, opts: { after?: number; start?: boolean } = {}): HandoffState {
  const ks0 = plan.client?.kindSuggestions?.[kind] ?? null;
  const ks = ks0 ? { ...ks0, ...withoutUsedQuotes(plan, state, ks0) } : null;
  const primary = ks?.primary ?? null;
  const who: StepWho = primary && stepHasWho(primary.who) ? primary.who : { type: "none" };
  const start = Boolean(opts.start);
  const s: DraftStep = {
    key: newKey(), operationId: null, status: null, locked: "none", kind, title: null, who, whoSource: primary ? primary.source : null,
    supplierQuoteId: primary?.supplierQuoteId ?? null, plannedEnd: "", deadlineSource: null, deadlineCaption: null, autoDeadline: true,
    deadlineAgreed: false, endsAtCustomerDate: false, orderItemIds: ks?.orderItemIds ?? null, start, done: state.kind === "zaznam",
    po: who.type === "u_nas" ? { mode: null }
      : primary?.purchaseOrder && primary.source === "objednavka" ? { mode: "existujici", existingId: primary.purchaseOrder.id }
        : state.kind === "zaznam" ? { mode: "neobjednavat", noneReason: "Zapsáno zpětně" }
          : { mode: start || state.kind === "plan" ? "vystavit" : "pri_predani", ...(primary?.coverage?.uncovered.length ? { includeUncovered: true } : {}) },
    note: null, suggestions: { primary, alternatives: ks?.alternatives ?? [] }, serverPreview: null, previewKey: "", added: true,
  };
  const at = opts.after === undefined ? state.steps.length : Math.min(state.steps.length, opts.after + 1);
  let steps = [...state.steps.slice(0, at), s, ...state.steps.slice(at)];
  steps = demoteFinal(steps);
  steps = reflow(plan, state, steps, at);
  return { ...state, steps };
}

export function removeStep(plan: HandoffPlan, state: HandoffState, i: number): HandoffState {
  const removed = state.steps[i];
  let steps = state.steps.filter((_, k) => k !== i);
  // začínal tenhle krok? začne první zbylý (předání vždy něco spouští)
  if (removed?.start && steps.length && (state.kind === "predani" || state.kind === "dalsi_krok" || state.kind === "doplneni")) {
    steps = steps.map((s, k) => (k === 0 ? { ...s, start: true, po: s.po.mode === "pri_predani" ? { ...s.po, mode: "vystavit" } : s.po } : s));
  }
  steps = reflow(plan, state, steps, i);
  return { ...state, steps };
}

/** Jiný druh kroku: návrhy kdo pro nový druh; firma z návrhu se vymění za nejlevnější k novému druhu. */
export function setStepKind(plan: HandoffPlan, state: HandoffState, i: number, kind: OperationKind): HandoffState {
  const s = state.steps[i];
  const ks0 = plan.client?.kindSuggestions?.[kind] ?? null;
  const ks = ks0 ? { ...ks0, ...withoutUsedQuotes(plan, state, ks0, i) } : null;
  let next: HandoffState = { ...state, steps: updateStep(state, i, { kind, ...(ks ? { suggestions: { primary: ks.primary, alternatives: ks.alternatives } } : {}) }) };
  const fromSuggestion = !s.whoSource || s.whoSource === "nejlevnejsi_nabidka" || s.whoSource === "nabidka" || s.who.type === "none";
  if (ks && fromSuggestion && !s.operationId) {
    if (ks.orderItemIds !== undefined) next = { ...next, steps: updateStep(next, i, { orderItemIds: ks.orderItemIds }) };
    if (ks.primary && stepHasWho(ks.primary.who)) next = setStepWho(plan, next, i, ks.primary.who, ks.primary);
  }
  return next;
}

export function patchStep(state: HandoffState, i: number, patch: Partial<DraftStep>): HandoffState {
  return { ...state, steps: updateStep(state, i, patch) };
}

// ── Kontrola a odeslání ─────────────────────────────────────
function inputSteps(state: HandoffState): (HandoffStepInput & { key: string })[] {
  return state.steps.map((s) => ({
    key: s.key,
    operationId: s.operationId,
    kind: s.kind,
    title: s.title,
    who: s.who.type === "free" ? { type: "free", name: s.who.name.trim() } : s.who,
    plannedEnd: s.plannedEnd || null,
    endsAtCustomerDate: s.endsAtCustomerDate,
    deadlineAgreed: s.deadlineAgreed && s.who.type !== "u_nas" && stepHasWho(s.who),
    ...(s.deadlineSource ? { deadlineSource: s.deadlineSource } : {}),
    ...(s.whoSource ? { whoSource: s.whoSource } : {}),
    supplierQuoteId: s.supplierQuoteId,
    orderItemIds: s.orderItemIds,
    ...(s.start ? { start: true } : {}),
    ...(s.done ? { done: true } : {}),
    po: s.who.type === "u_nas" ? { mode: null } : { ...s.po },
    note: s.note,
  }));
}

/** Konečný termín, který předání pošle (jen když ho zakázka nemá, nebo obchodník potvrzuje požadavek). */
function finalDateInput(plan: HandoffPlan, state: HandoffState): HandoffInput["finalDate"] {
  if (!plan.finalDate.date) {
    const d = state.finalDate?.date ?? "";
    return d ? { date: d, confirmed: Boolean(state.finalDate?.confirmed) && plan.permissions.canConfirmCustomerDate } : null;
  }
  if (plan.finalDate.source === "customer_required_date" && state.confirmRequested && plan.permissions.canConfirmCustomerDate) {
    return { date: plan.finalDate.date, confirmed: true };
  }
  return null;
}

/** Kontrola naživo (stejná pravidla jako na serveru) + varování o celém postupu z plánu. */
export function issuesOf(plan: HandoffPlan, state: HandoffState): HandoffIssue[] {
  if (state.kind === "zpet") return [];
  const c = plan.client;
  const today = c?.today ?? todayOf();
  const vsteps: HandoffValidationStep[] = inputSteps(state).map((s, i) => ({ ...s, status: state.steps[i].status }));
  const issues = validateHandoff(
    { kind: state.kind, steps: vsteps, finalDate: finalDateInput(plan, state), updateCustomerDate: state.updateCustomerDate, acceptLate: state.acceptLate },
    {
      today, stage: plan.stage,
      dueDate: plan.finalDate.source === "due_date" ? plan.finalDate.date : null,
      customerRequiredDate: plan.finalDate.source === "customer_required_date" ? plan.finalDate.date : null,
      maxToleratedDate: plan.finalDate.maxTolerated,
      items: (c?.items ?? []).map((it) => ({ id: it.id, drawingNumber: it.drawingNumber, name: it.name })),
      otherSteps: c?.otherSteps ?? [],
      openPurchaseOrders: c?.openPurchaseOrders ?? [],
      previousEnd: c?.previousEnd ?? null,
    },
  );
  for (const x of plan.issues) if (x.code === "route_health" && !issues.some((y) => y.message === x.message)) issues.push(x);
  if (state.kind === "ukonceni" && (plan.client?.remaining.length ?? 0) > 0 && !state.skipReason.trim()) {
    issues.push({ code: "po_reason_missing", level: "error", message: "Napiš, proč končíš výrobu dřív (zbylé kroky se přeskočí)." });
  }
  if (state.kind === "ukonceni") {
    for (const r of plan.client?.remaining ?? []) {
      const p = r.purchaseOrder;
      if (p && (p.status === "odeslana" || p.status === "potvrzena")) {
        if (!plan.permissions.canCancelSent) {
          issues.push({ code: "po_duplicate", level: "error", message: `Krok má odeslanou objednávku ${p.number} — ukončení udělá obchodník nebo admin.` });
        } else if (!state.cancelSent.includes(p.id)) {
          issues.push({ code: "po_duplicate", level: "error", message: `Zaškrtni „Zrušit i odeslanou objednávku ${p.number}“ — jinak výrobu ukončit nejde.` });
        }
      }
    }
  }
  if ((state.kind === "predani" || state.kind === "dalsi_krok") && !state.steps.length && !plan.current) {
    issues.push({ code: "who_missing", level: "error", message: "Přidej aspoň jeden krok výroby." });
  }
  return issues;
}

/** Jde odeslat? Bez chyb; varování „po termínu" potřebuje „Vím o tom". */
export function canSubmit(plan: HandoffPlan, state: HandoffState, issues = issuesOf(plan, state)): boolean {
  return canSubmitHandoff(issues, state.acceptLate);
}

/** Vstup submitProductionHandoff (ceny nikdy — staví je server z nabídky). */
export function inputFromState(plan: HandoffPlan, state: HandoffState): HandoffInput {
  const input: HandoffInput = {
    token: plan.token,
    kind: state.kind,
    expectedStage: plan.stage,
    expectedRouteVersion: plan.routeVersion,
    steps: state.kind === "zpet" || state.kind === "ukonceni" ? [] : inputSteps(state),
    acceptLate: state.acceptLate || undefined,
    note: state.note.trim() ? state.note.trim().slice(0, 500) : null,
  };
  const fd = finalDateInput(plan, state);
  if (fd) input.finalDate = fd;
  if (state.updateCustomerDate && plan.permissions.canConfirmCustomerDate) input.updateCustomerDate = true;
  if (state.sendNow && plan.permissions.canSend && newOrderCount(state) > 0) input.sendNow = ["*"];
  const cur = plan.current;
  const running = cur && (cur.status === "probiha" || cur.status === "problem");
  if ((state.kind === "dalsi_krok" || state.kind === "ukonceni") && cur && running) {
    const items = cur.purchaseOrder?.items ?? [];
    const receipts = plan.permissions.canReceive && items.length
      ? items.map((it) => ({ itemId: it.id, received: Math.max(0, Number(state.receipts[it.id] ?? it.received) || 0) }))
      : [];
    input.complete = {
      operationId: cur.id,
      ...(receipts.length ? { receipts } : {}),
      ...(state.continueWithoutRest ? { continueWithoutRest: true } : {}),
    };
    // „Poslat dál i bez zbytku": objednávka dalšího kroku jen na převzaté kusy (díl = číslo výkresu položky)
    if (state.kind === "dalsi_krok" && state.continueWithoutRest && receiptPartial(plan, state) && input.steps[0] && ordersNew(state.kind, state.steps[0])) {
      const quantities: Record<string, number> = {};
      for (const it of items) {
        const part = (plan.client?.items ?? []).find((x) => (x.drawingNumber || x.name || "") === it.label);
        const got = Math.max(0, Number(state.receipts[it.id] ?? it.received) || 0);
        if (part && got > 0 && (!input.steps[0].orderItemIds || input.steps[0].orderItemIds.includes(part.id))) quantities[part.id] = got;
      }
      if (Object.keys(quantities).length) input.steps[0] = { ...input.steps[0], po: { ...input.steps[0].po, quantities } };
    }
  }
  if (state.kind === "ukonceni") {
    input.finish = {
      target: state.finishTarget,
      skipReason: state.skipReason.trim() || null,
      ...(state.cancelSent.length ? { cancelSentPurchaseOrderIds: state.cancelSent } : {}),
    };
  }
  if (state.kind === "zaznam") input.finish = { target: state.finishTarget };
  if (state.kind === "zpet") input.undoHandoffId = plan.client?.undoHandoffId ?? null;
  return input;
}

/** Převzetí neúplné (něco méně než objednáno)? */
export function receiptPartial(plan: HandoffPlan, state: HandoffState): boolean {
  const items = plan.current?.purchaseOrder?.items ?? [];
  return plan.permissions.canReceive && items.some((it) => (Number(state.receipts[it.id] ?? it.received) || 0) + 1e-9 < it.quantity);
}

// ── Texty ───────────────────────────────────────────────────
export const KIND_TITLE: Record<HandoffKind, string> = {
  predani: "Předat do výroby",
  doplneni: "Doplnit předání do výroby",
  dalsi_krok: "Posunout dál",
  ukonceni: "Ukončit výrobu",
  plan: "Naplánovat postup",
  zaznam: "Zapsat výrobu",
  zpet: "Vrátit předání do výroby",
};

export function titleOf(plan: HandoffPlan, kind: HandoffKind, opts: { replan?: boolean } = {}): string {
  if (kind === "dalsi_krok") return plan.current && (plan.current.status === "probiha" || plan.current.status === "problem") ? "Posunout dál" : "Předat do kroku";
  if (kind === "plan" && opts.replan) return "Přeplánovat výrobu";
  return KIND_TITLE[kind];
}

export function submitLabel(kind: HandoffKind): string {
  switch (kind) {
    case "predani": return "Předat do výroby";
    case "doplneni": return "Uložit předání";
    case "dalsi_krok": return "Předat dalšímu kroku";
    case "ukonceni": return "Ukončit výrobu";
    case "plan": return "Uložit postup";
    case "zaznam": return "Zapsat výrobu";
    case "zpet": return "Vrátit předání";
  }
}

export function busyLabel(kind: HandoffKind): string {
  return kind === "predani" ? "Předávám…" : kind === "zpet" ? "Vracím…" : kind === "ukonceni" ? "Ukončuji…" : "Ukládám…";
}

/**
 * „Krok 1: Frézy Novák · do 19. 11. · 2 kroky · 1 objednávka" (souhrn nad tlačítkem) — kdo a do kdy je
 * vidět i na mobilu, kde je karta kroku pod okrajem obrazovky.
 */
export function summaryLine(plan: HandoffPlan, state: HandoffState): string {
  const n = state.steps.length;
  const orders = newOrderCount(state);
  const parts: string[] = [];
  const first = state.steps.find((s) => s.start) ?? state.steps[0] ?? null;
  if (first && state.kind !== "zpet" && state.kind !== "ukonceni") {
    const i = state.steps.indexOf(first);
    const who = whoName(first.who);
    const head = `${stepCounter(plan, state.steps, i).replace(/\/\d+$/, "")}: ${who ?? "kdo zatím nevybrán"}`;
    parts.push(first.plannedEnd ? `${head} · do ${shortDay(first.plannedEnd)}` : `${head} · bez termínu`);
  } else {
    if (state.kind === "predani") parts.push(plan.stage === "ve_vyrobe" ? "Zůstává ve výrobě" : "Ve výrobě od dnes");
    if (state.kind === "dalsi_krok") parts.push("Zůstává ve výrobě");
  }
  if (n) parts.push(`${n} ${n === 1 ? "krok" : n < 5 ? "kroky" : "kroků"}`);
  if (orders) parts.push(`${orders} ${orders === 1 ? "objednávka" : orders < 5 ? "objednávky" : "objednávek"}`);
  return parts.join(" · ");
}

/** Hlavní řádek návrhu: „Nejlevnější nabídka: Frézy Novák s.r.o. — 12 200 Kč, termín 3 týdny (do 13. 11.)". */
export function suggestionLine(s: WhoSuggestion, opts: { canSeePrices: boolean; date?: string | null }): string {
  const name = whoName(s.who) ?? "—";
  const price = opts.canSeePrices && s.price !== null ? money(s.price, s.currency ?? "CZK") : null;
  const lead = s.leadTimeDays ? `termín ${leadTimeLabel(s.leadTimeDays)}` : null;
  const day = opts.date ?? s.deliveryDate;
  const when = [lead, day ? `(do ${shortDay(day)})` : null].filter(Boolean).join(" ");
  const tail = [price, when || null].filter(Boolean).join(", ");
  if (s.source === "objednavka") return s.reason;
  const head = s.source === "nejlevnejsi_nabidka" ? `${s.reason}: ${name}` : name;
  return tail ? `${head} — ${tail}` : head;
}

const BADGE_TEXT: Record<WhoSuggestion["badges"][number], string> = {
  nejlevnejsi: "nejlevnější",
  nejrychlejsi: "nejrychlejší",
  vybrana: "Vybraná v Nákupu",
  vyprsela: "vypršela",
  jina_mena: "jiná měna — porovnej ručně",
  cast: "jen část dílů",
  za_kg: "za kg — porovnej ručně",
};

export function badgeText(b: WhoSuggestion["badges"][number], s?: WhoSuggestion): string {
  if (b === "jina_mena" && s?.currency) return `v ${s.currency} — porovnej ručně`;
  return BADGE_TEXT[b];
}

/** Řádek další nabídky: „Kovoobrábění Hrubý — 13 400 Kč (+1 200 Kč) · 10. 11.". */
export function alternativeLine(s: WhoSuggestion, canSeePrices: boolean): string {
  const name = whoName(s.who) ?? "—";
  const price = canSeePrices && s.price !== null ? `${money(s.price, s.currency ?? "CZK")}${s.diffToBest ? ` (+${money(s.diffToBest, s.currency ?? "CZK")})` : ""}` : null;
  const when = s.deliveryDate ? shortDay(s.deliveryDate) : s.leadTimeDays ? leadTimeLabel(s.leadTimeDays) : null;
  return [name, [price, when].filter(Boolean).join(" · ")].filter(Boolean).join(" — ");
}

/** Řádek termínu kroku v dialogu: mezitermín vs. konečný termín, s kým a jak jistý. */
export function deadlineLine(plan: HandoffPlan, state: HandoffState, i: number): string {
  const s = state.steps[i];
  const fin = finalDateOf(plan, state);
  if (s.endsAtCustomerDate) {
    const unconfirmed = plan.finalDate.source === "customer_required_date" && !state.confirmRequested;
    return `Konečný termín (zákazník)${fin ? ` ${shortDay(fin)}` : ""} — ${unconfirmed ? "požadavek zákazníka, zatím nepotvrzený" : "dohodnuto se zákazníkem"}`;
  }
  if (s.who.type === "u_nas") return "Mezitermín · plán dílny (u nás)";
  const firm = whoName(s.who);
  if (!firm) return "Termín · odhad — firma zatím nevybrána";
  if (s.deadlineSource === "potvrzeni_dodavatele") return `Mezitermín · potvrdil ${firm}`;
  if (s.deadlineAgreed) return `Mezitermín · dohodnuto s ${firm}`;
  return "Mezitermín · odhad — zatím nedohodnuto";
}

/** Výsledek předání jednou větou (oznámení po zavření). */
export function doneToast(kind: HandoffKind, target?: JobStage | null): string {
  switch (kind) {
    case "predani": return "Předáno do výroby ✓";
    case "dalsi_krok": return "Předáno dalšímu kroku ✓";
    case "ukonceni": return target === "dodano_k_nam" || !target ? "Výroba ukončena ✓ — díly jsou u nás" : "Výroba ukončena ✓";
    case "zpet": return "Předání vráceno";
    case "zaznam": return "Výroba zapsána ✓";
    case "plan": return "Postup uložen ✓";
    case "doplneni": return "Předání doplněno ✓";
  }
}

/** Druhy kroků k rychlému přidání („+ Tepelné zpracování (výkres: …)"). */
export function quickKinds(plan: HandoffPlan, state: HandoffState): { kind: OperationKind; label: string }[] {
  const has = new Set(state.steps.map((s) => s.kind));
  const out: { kind: OperationKind; label: string }[] = [];
  const items = plan.client?.items ?? [];
  const heat = [...new Set(items.map((i) => i.heatTreatment).filter((x): x is string => Boolean(x)))].join("; ");
  const surf = [...new Set(items.map((i) => i.surfaceTreatment).filter((x): x is string => Boolean(x)))].join("; ");
  if (!has.has("tepelne_zpracovani")) out.push({ kind: "tepelne_zpracovani", label: heat ? `Tepelné zpracování (výkres: ${heat})` : "Tepelné zpracování" });
  out.push({ kind: "vyroba", label: OPERATION_KINDS.vyroba.label });
  if (!has.has("povrchova_uprava")) out.push({ kind: "povrchova_uprava", label: surf ? `Povrchová úprava (${surf})` : "Povrchová úprava" });
  if (!has.has("brouseni")) out.push({ kind: "brouseni", label: OPERATION_KINDS.brouseni.label });
  return out;
}

/** Datum za `n` pracovních dní (pro testy a rychlé posuny). */
export function plusWorking(iso: string, n: number): string {
  return addWorkingDays(iso, n);
}
