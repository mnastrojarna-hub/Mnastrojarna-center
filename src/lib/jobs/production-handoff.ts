// Předání do výroby — čistá doménová logika (bez DB, použitelná v klientu i na serveru).
// Spec: production-handoff-design.md §A (kroky, termíny, validace, zdraví postupu), §B.1 (záměr
// přesunu stavu), §E.1/E.4 (skupiny objednávek, blokace automatického odeslání).
import { DEADLINE_STATE_META, OPERATION_KINDS, isOperationKind, type DeadlineState, type OperationKind, type OperationStatus } from "@/lib/jobs/operations";
import { CLOSED_STAGES, stageRank } from "@/lib/jobs/stages";
import { addWorkingDays, isWorkingDay } from "@/lib/jobs/purchasing";
import { cleanDate } from "@/lib/jobs/mapping";
import { hasWho, sortOperations, stepLabel } from "@/lib/jobs/production";
import { operationFamily, shortDay } from "@/lib/jobs/production-suggest";
import type { JobStage, PurchaseOrderStatus } from "@/lib/supabase/database.types";
import {
  HANDOFF_ERROR_CODES,
  type DeadlineSource, type HandoffErrorCode, type HandoffIssue, type HandoffKind, type HandoffStepInput,
  type PerformerRole, type StepWho, type WhoSource,
} from "@/lib/jobs/production-handoff-types";

export const MAX_HANDOFF_STEPS = 12;

// ── Malé pomocníky ──────────────────────────────────────────
function dayNo(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Kalendářní dny z `a` do `b`. */
export function calendarDaysBetween(a: string, b: string): number {
  return dayNo(b) - dayNo(a);
}

/** Pracovní dny z `a` do `b` (b > a kladné, b < a záporné; víkendy a svátky ČR se nepočítají). */
export function workingDaysBetween(a: string, b: string): number {
  if (a === b) return 0;
  const sign = b > a ? 1 : -1;
  let n = 0;
  let cur = a;
  for (let guard = 0; guard < 3660 && cur !== b; guard++) {
    cur = nextCalendar(cur, sign);
    if (isWorkingDay(cur)) n += 1;
  }
  return sign * n;
}

function nextCalendar(iso: string, sign: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + sign)).toISOString().slice(0, 10);
}

/** „1 den" / „2 dny" / „5 dní". */
export function daysText(n: number): string {
  const a = Math.abs(n);
  return `${a} ${a === 1 ? "den" : a >= 2 && a <= 4 ? "dny" : "dní"}`;
}

function whoName(who: StepWho): string | null {
  if (who.type === "u_nas") return "U nás";
  if (who.type === "supplier") return (who.name ?? "").trim() || null;
  if (who.type === "free") return who.name.trim() || null;
  return null;
}

export function stepHasWho(who: StepWho | null | undefined): boolean {
  if (!who) return false;
  if (who.type === "u_nas") return true;
  if (who.type === "supplier") return Boolean(who.id);
  if (who.type === "free") return Boolean(who.name.trim());
  return false;
}

// ── Záměr přesunu stavu (B.1) ───────────────────────────────
export type StageMoveIntent =
  | { kind: "none" }
  /** → ve_vyrobe z 3–4 / pozastaveno / reklamace (rework=false), z 6–8 (rework=true). */
  | { kind: "predani"; rework: boolean }
  /** → ve_vyrobe z 0–2 (zákazník neobjednal) nebo z uzavřené zakázky. */
  | { kind: "blocked"; code: "NO_CUSTOMER_ORDER" | "CLOSED" }
  /** ve_vyrobe → 6+ s otevřenými kroky. */
  | { kind: "ukonceni"; target: JobStage }
  /** 3–4 → 6+ bez hotového kroku a bez dodané objednávky. */
  | { kind: "zaznam"; target: JobStage }
  /** ve_vyrobe → 0–4. */
  | { kind: "zpet" };

/**
 * Co potřebuje přesun stavu zakázky kolem výroby. Odchod z výroby do vedlejších stavů
 * (pozastaveno, reklamace, nerealizováno, zrušeno) nic nevyžaduje.
 */
export function stageMoveIntent(
  from: JobStage,
  to: JobStage,
  f: { openSteps: number; doneSteps: number; deliveredPurchaseOrders: number },
): StageMoveIntent {
  if (from === to) return { kind: "none" };
  const rf = stageRank(from);
  const rt = stageRank(to);
  if (to === "ve_vyrobe") {
    if (from === "nerealizovano" || from === "zruseno" || from === "dokonceno") return { kind: "blocked", code: "CLOSED" };
    if (rf >= 0 && rf <= 2) return { kind: "blocked", code: "NO_CUSTOMER_ORDER" };
    if (rf === 3 || rf === 4 || from === "pozastaveno" || from === "reklamace") return { kind: "predani", rework: false };
    if (rf >= 6 && rf <= 8) return { kind: "predani", rework: true };
    return { kind: "none" };
  }
  if (from === "ve_vyrobe") {
    if (rt >= 6) return f.openSteps > 0 ? { kind: "ukonceni", target: to } : { kind: "none" };
    if (rt >= 0 && rt <= 4) return { kind: "zpet" };
    return { kind: "none" };
  }
  if ((rf === 3 || rf === 4) && rt >= 6 && f.doneSteps === 0 && f.deliveredPurchaseOrders === 0) return { kind: "zaznam", target: to };
  return { kind: "none" };
}

/** Kód chyby předání z chyby DB / PostgREST (hint), jinak null. */
export function handoffErrorCode(err: { hint?: string | null; code?: string | null; message?: string | null } | null | undefined): HandoffErrorCode | null {
  const hint = (err?.hint ?? "").trim();
  if ((HANDOFF_ERROR_CODES as string[]).includes(hint)) return hint as HandoffErrorCode;
  if (err?.code === "42501") return "FORBIDDEN";
  return null;
}

// ── Kdo krok dělá z pohledu zakázky ─────────────────────────
type RoleOp = { id: string; kind: OperationKind; status?: OperationStatus; inHouse: boolean; supplier?: { id: string } | null; supplierId?: string | null; supplierName?: string | null };

/** „u nás" / „dodavatel" (kompletní dodávka nebo jediný krok) / „částečný dodavatel"; bez kdo → null. */
export function performerRole(op: RoleOp, route: { id: string; status?: OperationStatus }[]): PerformerRole | null {
  if (op.inHouse) return "u nás";
  if (!hasWho(op)) return null;
  const live = route.filter((o) => o.status !== "preskoceno");
  if (op.kind === "kompletni_dodavka" || (live.length <= 1)) return "dodavatel";
  return "částečný dodavatel";
}

/** Stav termínu nového / upraveného kroku (určuje server; klient ho neposílá). */
export function deadlineStateFor(step: {
  who: StepWho;
  deadlineAgreed?: boolean;
  deadlineSource?: DeadlineSource | null;
  purchaseOrderStatus?: PurchaseOrderStatus | null;
}): DeadlineState {
  if (step.who.type === "u_nas") return "plan";
  if (step.deadlineAgreed) return "dohodnuto";
  if (step.deadlineSource === "potvrzeni_dodavatele" || step.purchaseOrderStatus === "potvrzena" || step.purchaseOrderStatus === "dodana") return "potvrzeno";
  if (step.purchaseOrderStatus === "odeslana") return "pozadovano";
  return "odhad";
}

// ── Texty termínu (A.4) ─────────────────────────────────────
export interface DeadlineOp {
  plannedEnd: string | null;
  endsAtCustomerDate?: boolean;
  deadlineState?: DeadlineState | null;
  deadlineSource?: DeadlineSource | null;
  inHouse: boolean;
  /** Kde se krok dělá (firma / „U nás"); „—" nebo null = firma nevybraná. */
  location: string | null;
  status?: OperationStatus;
  /** Kdo termín zapsal (u „dohodnuto"). */
  deadlineChangedBy?: { name: string } | null;
  deadlineChangedAt?: string | null;
  purchaseOrder?: { number: string | null; status: PurchaseOrderStatus | null; confirmedDate?: string | null } | null;
  /** Lhůta z nabídky / dodavatele (do popisku odhadu). */
  leadTimeDays?: number | null;
  /** Změna termínu už odešla dodavateli (zmena_ceka). */
  changeSent?: boolean;
}

export interface DeadlineContext {
  /** Konečný termín (zákazník) a odkud je. */
  finalDate?: { date: string | null; source: "due_date" | "customer_required_date" | null } | null;
  today: string;
}

function leadWords(days: number | null | undefined): string {
  if (!days || days <= 0) return "";
  const d = Math.round(days);
  if (d >= 7 && d % 7 === 0) { const w = d / 7; return `${w} ${w === 1 ? "týden" : w < 5 ? "týdny" : "týdnů"}`; }
  return daysText(d);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name.trim();
  return `${parts[0].charAt(0)}. ${parts.slice(1).join(" ")}`;
}

function firm(op: DeadlineOp): string | null {
  const s = (op.location ?? "").trim();
  return s && s !== "—" ? s : null;
}

/**
 * Dlouhý popis termínu kroku — vždy řekne, zda jde o mezitermín nebo konečný termín (zákazník),
 * jak je jistý a s kým je dohodnutý. Nikdy neříká „dohodnuto", když to nikdo nedohodl.
 */
export function deadlineText(op: DeadlineOp, ctx: DeadlineContext): string | null {
  const end = cleanDate(op.plannedEnd);
  if (!end) return null;
  const who = firm(op);
  const day = shortDay(end);
  const state = op.deadlineState ?? (op.inHouse ? "plan" : "odhad");
  const po = op.purchaseOrder ?? null;
  const unsentPo = po && po.number && (po.status === "navrh" || po.status === "vystavena") ? ` · objednávka ${po.number} čeká na odeslání` : "";

  if (op.endsAtCustomerDate) {
    const unconfirmed = ctx.finalDate?.source === "customer_required_date";
    const head = `Konečný termín (zákazník) ${day} — ${unconfirmed ? "požadavek zákazníka, zatím nepotvrzený" : "dohodnuto se zákazníkem"}`;
    if (op.inHouse) return `${head} · u nás: plán dílny${unsentPo}`;
    const confirmed = cleanDate(po?.confirmedDate);
    let tail = "";
    if (who) {
      if (confirmed && confirmed > end) tail = ` · ${who}: potvrdil až ${shortDay(confirmed)} (o ${daysText(calendarDaysBetween(end, confirmed))} později)`;
      else if (state === "potvrzeno") tail = ` · ${who}: potvrzeno ${shortDay(confirmed ?? end)}`;
      else if (state === "pozadovano" || state === "zmena_ceka") tail = ` · ${who}: požadováno, čeká na potvrzení`;
      else if (state === "dohodnuto") tail = ` · ${who}: dohodnuto`;
      else tail = " · odhad";
    } else {
      tail = " · firma zatím nevybrána";
    }
    return `${head}${tail}${unsentPo}`;
  }

  if (!who && !op.inHouse) return `Termín ${day} — odhad, firma zatím nevybrána`;
  const name = who ?? "u nás";
  switch (state) {
    case "plan":
      return `Mezitermín ${day} — plán dílny (u nás)`;
    case "dohodnuto": {
      const by = op.deadlineChangedBy?.name ? initials(op.deadlineChangedBy.name) : null;
      const at = op.deadlineChangedAt ? shortDay(op.deadlineChangedAt.slice(0, 10)) : null;
      const stamp = [by, at].filter(Boolean).join(", ");
      return `Mezitermín ${day} — dohodnuto s ${name}${stamp ? ` (${stamp})` : ""}${unsentPo}`;
    }
    case "pozadovano":
      return `Mezitermín ${day} — požadováno v objednávce ${po?.number ?? "—"}, čeká na potvrzení ${name}`;
    case "potvrzeno": {
      const at = op.deadlineChangedAt ? shortDay(op.deadlineChangedAt.slice(0, 10)) : null;
      const ref = [po?.number, at].filter(Boolean).join(", ");
      return `Mezitermín ${day} — potvrdil ${name}${ref ? ` (${ref})` : ""}`;
    }
    case "zmena_ceka":
      return op.changeSent
        ? `Mezitermín ${day} — změna poslána ${name}, čeká na potvrzení`
        : `Mezitermín ${day} — změna čeká na odeslání ${name}`;
    case "odhad":
    default: {
      const lead = leadWords(op.leadTimeDays);
      if (op.deadlineSource === "nabidka_dodavatele") {
        return `Mezitermín ${day} — odhad z nabídky ${name}${lead ? ` (${lead})` : ""}, zatím nedohodnuto${unsentPo}`;
      }
      if (op.deadlineSource === "lhuta_dodavatele") {
        return `Mezitermín ${day} — odhad (obvyklá lhůta ${name}${lead ? ` ${lead}` : ""}), zatím nedohodnuto${unsentPo}`;
      }
      return `Mezitermín ${day} — odhad, zatím nedohodnuto${unsentPo}`;
    }
  }
}

export type PillTone = "grey" | "green" | "amber" | "red";

/** Krátký štítek termínu: „mezitermín 13. 11. · Hrubý · odhad" / „konečný 20. 11. · zákazník". */
export function deadlinePill(op: DeadlineOp, ctx: DeadlineContext): { text: string; tone: PillTone } | null {
  const end = cleanDate(op.plannedEnd);
  if (!end) return null;
  const done = op.status === "hotovo" || op.status === "preskoceno";
  if (!done && end < ctx.today) {
    return { text: `${daysText(calendarDaysBetween(end, ctx.today))} po termínu (${shortDay(end)})`, tone: "red" };
  }
  const state = op.deadlineState ?? (op.inHouse ? "plan" : "odhad");
  if (op.endsAtCustomerDate) {
    const unconfirmed = ctx.finalDate?.source === "customer_required_date";
    return { text: `konečný ${shortDay(end)} · ${unconfirmed ? "požadavek zákazníka" : "zákazník"}`, tone: unconfirmed ? "amber" : "green" };
  }
  const who = firm(op) ?? (op.inHouse ? "u nás" : null);
  const meta = DEADLINE_STATE_META[state];
  return { text: [`mezitermín ${shortDay(end)}`, who, meta.label].filter(Boolean).join(" · "), tone: meta.tone };
}

// ── Řádek knihy (H.6) ───────────────────────────────────────
export interface ProductionRowJob {
  stage: JobStage;
  productionStep?: string | null;
  productionLocation?: string | null;
  productionTotal?: number;
  productionStepNo?: number | null;
  productionStepKindNo?: number | null;
  productionStepTitle?: string | null;
  productionDue?: string | null;
  productionDueFinal?: boolean | null;
  productionDueState?: DeadlineState | null;
  productionPoStatus?: PurchaseOrderStatus | null;
}

export interface ProductionRowText {
  kind: "krok" | "plan" | "legacy" | "done" | "none";
  text: string | null;
  overdue: boolean;
  /** Štítek stavu termínu („odhad" šedě / „potvrzeno" zeleně). */
  pill: { label: string; tone: PillTone } | null;
  /** Oranžová tečka „Objednávka neodeslána". */
  dot: { title: string } | null;
}

/**
 * Text řádku knihy: „Krok 2/3 · Tepelné zpracování · TepKal · do 12. 11.";
 * po termínu „… · 2 dny po termínu"; konečný „… · do 20. 11. (konečný)";
 * před výrobou „Plán: Krok 1/2 · Výroba 1 · Novák"; bez kdo/termínu „Chybí kdo a termín".
 */
export function productionRowText(job: ProductionRowJob, today: string): ProductionRowText {
  const none: ProductionRowText = { kind: "none", text: null, overdue: false, pill: null, dot: null };
  const step = job.productionStep ?? null;
  const rank = stageRank(job.stage);
  if (step === "hotovo") return { ...none, kind: "done", text: "Výroba hotová" };
  if (!step || !isOperationKind(step)) {
    return job.stage === "ve_vyrobe" ? { ...none, kind: "legacy", text: "Chybí kdo a termín" } : none;
  }
  const total = Math.max(0, job.productionTotal ?? 0);
  const title = (job.productionStepTitle ?? "").trim();
  const label = title || (step === "vyroba" ? (total > 1 && job.productionStepKindNo ? `Výroba ${job.productionStepKindNo}` : "Výroba") : OPERATION_KINDS[step].label);
  const location = (job.productionLocation ?? "").trim() || null;
  const due = cleanDate(job.productionDue);
  const counter = job.productionStepNo && total ? `Krok ${job.productionStepNo}/${total} · ` : "";
  const dot = job.productionPoStatus === "navrh" || job.productionPoStatus === "vystavena" ? { title: "Objednávka neodeslána" } : null;
  const pillState = job.productionDueState ?? null;
  const pill = pillState ? { label: DEADLINE_STATE_META[pillState].label, tone: DEADLINE_STATE_META[pillState].tone } : null;
  if (job.stage === "ve_vyrobe" && (!location || !due)) {
    return { kind: "legacy", text: `${counter}${label} · Chybí kdo a termín`, overdue: false, pill: null, dot };
  }
  const base = `${counter}${label}${location ? ` · ${location}` : ""}`;
  if (rank >= 0 && rank < 5 || job.stage === "pozastaveno" || job.stage === "reklamace") {
    return { kind: "plan", text: `Plán: ${base}`, overdue: false, pill: null, dot };
  }
  if (!due) return { kind: "krok", text: base, overdue: false, pill, dot };
  if (due < today) {
    return { kind: "krok", text: `${base} · ${daysText(calendarDaysBetween(due, today))} po termínu`, overdue: true, pill, dot };
  }
  return { kind: "krok", text: `${base} · do ${shortDay(due)}${job.productionDueFinal ? " (konečný)" : ""}`, overdue: false, pill, dot };
}

// ── Validace předání (A.5) ──────────────────────────────────
export interface HandoffValidationStep extends HandoffStepInput {
  /** Stav existujícího kroku (běží → termín v minulosti je jen varování). */
  status?: OperationStatus | null;
}

export interface HandoffValidationState {
  kind: HandoffKind;
  steps: HandoffValidationStep[];
  finalDate?: { date: string; confirmed: boolean } | null;
  updateCustomerDate?: boolean;
  acceptLate?: boolean;
}

export interface HandoffValidationContext {
  today: string;
  stage: JobStage;
  dueDate: string | null;
  customerRequiredDate: string | null;
  maxToleratedDate?: string | null;
  /** Díly zakázky (kontrola dílů bez kroku). */
  items?: { id: string; drawingNumber: string | null; name?: string | null }[];
  /** Ostatní kroky postupu mimo dialog (hotové, běžící, naplánované). */
  otherSteps?: { kind: OperationKind; status: OperationStatus; orderItemIds?: string[] | null }[];
  /** Otevřené objednávky zakázky; linked = už navázaná na krok. */
  openPurchaseOrders?: { id: string; number: string; supplierId: string | null; supplierName: string; linked: boolean }[];
  /** Index kroku (0…) → nabídka je na jiné množství. */
  quantityMismatch?: Record<number, { quoted: number; ordered: number; unit: string }>;
  /** Konec kroku před prvním krokem dialogu (běžící krok) — kroky jdou po sobě i přes něj. */
  previousEnd?: { date: string; label: string } | null;
}

function isIso(v: unknown): v is string {
  return typeof v === "string" && cleanDate(v) === v;
}

function ordersNow(s: HandoffStepInput): boolean {
  return s.po.mode === "vystavit" || s.po.mode === "existujici" || Boolean(s.po.orderNow);
}

/** Krok teď vystavuje NOVOU objednávku (ne použití existující). */
function ordersNew(s: HandoffStepInput): boolean {
  return s.po.mode === "vystavit" || (Boolean(s.po.orderNow) && s.po.mode !== "existujici");
}

function scopesOverlap(a: string[] | null | undefined, b: string[] | null | undefined): boolean {
  if (!a || !b) return true;
  const set = new Set(a);
  return b.some((x) => set.has(x));
}

/**
 * Kontrola předání do výroby — stejná v dialogu i na serveru. Chyby nepustí dál, varování
 * s `acceptLate` potřebují „Vím o tom — termín se zákazníkem domluvím.".
 */
export function validateHandoff(state: HandoffValidationState, ctx: HandoffValidationContext): HandoffIssue[] {
  const issues: HandoffIssue[] = [];
  const push = (i: HandoffIssue) => issues.push(i);
  const steps = state.steps;
  const k = state.kind;
  const rank = stageRank(ctx.stage);
  const withDates = k !== "zpet" && k !== "ukonceni";

  if (k === "predani" && rank >= 0 && rank <= 2) {
    push({ code: "no_customer_order", level: "error", message: "Zákazník ještě neobjednal — nejdřív zapiš objednávku zákazníka." });
  } else if (rank >= 0 && rank <= 2 && steps.some(ordersNew)) {
    // = RPC: objednávku dodavateli (plán „Objednat hned") jde vystavit až po objednávce zákazníka
    push({ code: "no_customer_order", level: "error", message: "Objednat u dodavatele lze až po objednávce zákazníka." });
  }
  if (steps.length > MAX_HANDOFF_STEPS) {
    push({ code: "too_many", level: "error", message: `Najednou lze předat nejvýš ${MAX_HANDOFF_STEPS} kroků.` });
  }

  // konečný termín (zákazník)
  // = RPC: nepotvrzené datum z dialogu se zapíše jen jako požadavek zákazníka, a to jen když žádný není
  const finalDate = (state.finalDate?.confirmed ? cleanDate(state.finalDate.date) : null)
    ?? cleanDate(ctx.dueDate) ?? cleanDate(ctx.customerRequiredDate) ?? cleanDate(state.finalDate?.date);
  const confirmedFinal = Boolean(cleanDate(ctx.dueDate)) || Boolean(state.finalDate?.confirmed && cleanDate(state.finalDate?.date));
  const finalIdx = steps.findIndex((s) => s.endsAtCustomerDate);
  const finalStep = finalIdx >= 0 ? steps[finalIdx] : null;
  let effectiveFinal = finalDate;
  if (state.updateCustomerDate && finalStep && isIso(finalStep.plannedEnd)) effectiveFinal = finalStep.plannedEnd;
  if (withDates && k !== "zaznam") {
    if (!finalDate) push({ code: "final_missing", level: "error", message: "Doplň konečný termín (zákazník)." });
    else if (!confirmedFinal) push({ code: "final_unconfirmed", level: "info", message: "Konečný termín je zatím jen požadavek zákazníka — potvrdí ho obchodník." });
    if (effectiveFinal && effectiveFinal < ctx.today) {
      push({ code: "final_past", level: "warning", acceptLate: true, message: `Konečný termín (zákazník) ${shortDay(effectiveFinal)} už uplynul.` });
    }
  }

  let starts = 0;
  // existující objednávky, které tohle předání použije (už nejsou „volné" — vedle nich smí vzniknout nová)
  const reused = new Set(steps.map((s) => (s.po.mode === "existujici" ? s.po.existingId : null)).filter((x): x is string => Boolean(x)));
  steps.forEach((s, i) => {
    const n = i + 1;
    const running = s.status === "probiha" || s.status === "problem";
    if (s.start) starts += 1;
    // kdo
    if (!stepHasWho(s.who) && (s.start || s.done || running || ordersNow(s))) {
      push({ code: "who_missing", level: "error", step: n, message: `Krok ${n}: vyber, kdo to dělá (firma z adresáře, firma mimo adresář, nebo „U nás“).` });
    }
    // termín
    if (!withDates) return;
    if (s.plannedEnd === null || s.plannedEnd === undefined || s.plannedEnd === "") {
      push({ code: "deadline_missing", level: "error", step: n, message: `Krok ${n}: doplň termín.` });
    } else if (!isIso(s.plannedEnd)) {
      push({ code: "deadline_invalid", level: "error", step: n, message: `Krok ${n}: neplatné datum (čekám RRRR-MM-DD).` });
    } else {
      const end = s.plannedEnd;
      if (k !== "zaznam" && end < ctx.today) {
        if (running) {
          push({
            code: "deadline_past", level: "warning", step: n,
            message: `Krok ${n} už běží a je ${daysText(calendarDaysBetween(end, ctx.today))} po termínu (${shortDay(end)}) — doplň nový termín, pokud ho znáš.`,
          });
        } else {
          push({ code: "deadline_past", level: "error", step: n, message: `Krok ${n}: termín ${shortDay(end)} je v minulosti.` });
        }
      }
      if (isIso(s.plannedStart) && s.plannedStart > end) {
        push({ code: "start_after_end", level: "error", step: n, message: `Krok ${n}: začátek je po termínu.` });
      }
      if (!isWorkingDay(end)) {
        push({ code: "non_working_day", level: "warning", step: n, message: `Krok ${n}: termín ${shortDay(end)} připadá na víkend nebo svátek.` });
      }
      if (i > 0) {
        const prev = steps[i - 1];
        if (isIso(prev.plannedEnd) && end < prev.plannedEnd) {
          const overlap = scopesOverlap(prev.orderItemIds, s.orderItemIds);
          push({
            code: "deadline_order", level: overlap ? "error" : "warning", step: n,
            message: `Krok ${n} končí ${shortDay(end)} — dřív než krok ${n - 1} (${shortDay(prev.plannedEnd)}). Kroky jdou po sobě.`,
          });
        }
      } else if (ctx.previousEnd && isIso(ctx.previousEnd.date) && end < ctx.previousEnd.date && k !== "zaznam") {
        push({
          code: "deadline_order", level: "warning", step: n,
          message: `Krok ${n} končí ${shortDay(end)} — dřív než předchozí krok ${ctx.previousEnd.label} (${shortDay(ctx.previousEnd.date)}). Kroky jdou po sobě — posuň termín.`,
        });
      }
      // poslední krok hlásí „Výroba skončí … po konečném termínu" níže (jedno varování, ne dvě)
      if (effectiveFinal && !s.endsAtCustomerDate && k !== "zaznam" && i < steps.length - 1 && end > effectiveFinal) {
        push({
          code: "interim_after_final", level: "warning", acceptLate: true, step: n,
          message: `Krok ${n}: mezitermín ${shortDay(end)} je až po konečném termínu (zákazník) ${shortDay(effectiveFinal)}`,
        });
      }
      if (s.endsAtCustomerDate && finalDate && end !== finalDate && !state.updateCustomerDate) {
        push({
          code: "final_mismatch", level: "error", step: n,
          message: `Krok ${n}: konečný termín musí být stejný jako konečný termín (zákazník) ${shortDay(finalDate)} — nebo zaškrtni „Změnit i konečný termín zákazníkovi na ${shortDay(end)}“ (jen obchodník/admin).`,
        });
      }
    }
    // objednávka a díly
    if (s.po.mode === "neobjednavat" && !(s.po.noneReason ?? "").trim()) {
      push({ code: "po_reason_missing", level: "error", step: n, message: `Krok ${n}: napiš, jak je objednáno (jinak se vystaví objednávka).` });
    }
    if (s.who.type === "supplier" && ordersNew(s)) {
      const dup = (ctx.openPurchaseOrders ?? []).find((p) => !p.linked && !reused.has(p.id) && p.supplierId && p.supplierId === (s.who as { id: string }).id);
      if (dup) {
        push({ code: "po_duplicate", level: "error", step: n, message: `${dup.supplierName} už má k zakázce objednávku ${dup.number} — použij ji, nebo ji nejdřív zruš.` });
      }
    }
    if (Array.isArray(s.orderItemIds) && s.orderItemIds.length === 0) {
      push({ code: "item_scope_empty", level: "error", step: n, message: `Krok ${n}: vyber aspoň jeden díl.` });
    }
    const qm = ctx.quantityMismatch?.[i];
    if (qm) {
      push({
        code: "quantity_mismatch", level: "warning", step: n,
        message: `Nabídka je na ${qm.quoted} ${qm.unit}, objednáváš ${qm.ordered} ${qm.unit} — cena za kus se může lišit.`,
      });
    }
  });

  if (starts > 1) push({ code: "start_multiple", level: "error", message: "Najednou může začít jen jeden krok." });
  if (finalIdx >= 0 && finalIdx !== steps.length - 1) {
    push({ code: "final_not_last", level: "error", step: finalIdx + 1, message: "Konečný termín (zákazník) může mít jen poslední krok." });
  }

  // konec výroby vs. konečný termín
  const last = steps[steps.length - 1];
  if (withDates && k !== "zaznam" && last && isIso(last.plannedEnd) && effectiveFinal) {
    if (last.plannedEnd > effectiveFinal) {
      const max = cleanDate(ctx.maxToleratedDate);
      push({
        code: "last_after_final", level: "warning", acceptLate: true, step: steps.length,
        message: `Výroba skončí ${shortDay(last.plannedEnd)} — ${daysText(calendarDaysBetween(effectiveFinal, last.plannedEnd))} po konečném termínu (zákazník) ${shortDay(effectiveFinal)}${max ? `; max. tolerovaný ${shortDay(max)}` : ""} — domluv nový termín se zákazníkem.`,
      });
    } else if (last.plannedEnd === effectiveFinal && !last.endsAtCustomerDate) {
      push({ code: "no_buffer", level: "warning", step: steps.length, message: "Poslední krok končí v den dodání zákazníkovi — nezbývá čas na dopravu." });
    }
  }

  // díly bez výrobního kroku
  if ((k === "predani" || k === "plan") && ctx.items?.length) {
    const machining = [
      ...steps.map((s) => ({ kind: s.kind, orderItemIds: s.orderItemIds ?? null })),
      ...(ctx.otherSteps ?? []).filter((o) => o.status !== "preskoceno").map((o) => ({ kind: o.kind, orderItemIds: o.orderItemIds ?? null })),
    ].filter((s) => ["obrabeni", "komplet"].includes(operationFamily(s.kind)));
    if (machining.length) {
      const covered = machining.some((s) => !s.orderItemIds) ? null : new Set(machining.flatMap((s) => s.orderItemIds ?? []));
      if (covered) {
        for (const it of ctx.items) {
          if (!covered.has(it.id)) {
            push({ code: "items_unassigned", level: "warning", message: `Díl ${it.drawingNumber || it.name || "bez čísla"} není v žádném kroku výroby.` });
          }
        }
      }
    }
  }
  return issues;
}

/** Jde předání odeslat? Bez chyb a (bez varování „pozdě" nebo zaškrtnuté „Vím o tom"). */
export function canSubmitHandoff(issues: HandoffIssue[], acceptLate: boolean): boolean {
  if (issues.some((i) => i.level === "error")) return false;
  return acceptLate || !issues.some((i) => i.acceptLate);
}

// ── Zdraví postupu a přeplánování (A.7) ─────────────────────
export interface RouteOp {
  id: string;
  kind: OperationKind;
  title?: string | null;
  status: OperationStatus;
  position: number;
  createdAt?: string;
  plannedEnd: string | null;
  endsAtCustomerDate?: boolean;
  orderItemIds?: string[] | null;
  deadlineState?: DeadlineState | null;
}

export interface RouteHealthIssue {
  code: "final_changed" | "route_late" | "overlap" | "step_overdue";
  /** Text štítku (null = jen varování v záložce Výroba). */
  chip: string | null;
  message: string;
  days?: number;
  step?: number;
  operationId?: string;
}

const OPEN: OperationStatus[] = ["ceka", "probiha", "problem"];

/** Konečný termín se změnil / postup končí po termínu / kroky se překrývají / aktuální krok po termínu. */
export function routeHealth(
  ops: RouteOp[],
  job: { dueDate: string | null; customerRequiredDate?: string | null },
  today: string,
): RouteHealthIssue[] {
  const out: RouteHealthIssue[] = [];
  const sorted = sortOperations(ops);
  const live = sorted.filter((o) => o.status !== "preskoceno");
  const open = live.filter((o) => OPEN.includes(o.status));
  const due = cleanDate(job.dueDate);
  const target = due ?? cleanDate(job.customerRequiredDate);
  const fin = live.find((o) => o.endsAtCustomerDate);
  if (fin && due && cleanDate(fin.plannedEnd) && fin.plannedEnd !== due && OPEN.includes(fin.status)) {
    out.push({
      code: "final_changed", chip: "Konečný termín se změnil — přeplánuj výrobu",
      message: `Konečný termín (zákazník) se změnil na ${shortDay(due)} — přeplánuj výrobu.`, operationId: fin.id,
    });
  }
  const ends = open.map((o) => cleanDate(o.plannedEnd)).filter((x): x is string => Boolean(x));
  const end = ends.length ? ends.reduce((a, b) => (b > a ? b : a)) : null;
  if (end && target && end > target) {
    const d = calendarDaysBetween(target, end);
    out.push({
      code: "route_late", chip: `Ohrožen konečný termín (o ${daysText(d)})`, days: d,
      message: `Výroba skončí po konečném termínu (zákazník) — o ${daysText(d)}.`,
    });
  }
  for (let i = 1; i < live.length; i++) {
    const a = live[i - 1];
    const b = live[i];
    if (!OPEN.includes(b.status)) continue;
    const ea = cleanDate(a.plannedEnd);
    const eb = cleanDate(b.plannedEnd);
    if (ea && eb && eb < ea && a.status !== "hotovo") {
      out.push({
        code: "overlap", chip: null, step: i + 1, operationId: b.id,
        message: `Krok ${i + 1} začíná dřív, než skončí krok ${i} — zkontroluj termíny.`,
      });
    }
  }
  const cur = live.find((o) => o.status === "probiha" || o.status === "problem") ?? live.find((o) => o.status === "ceka");
  const ce = cleanDate(cur?.plannedEnd);
  if (cur && ce && ce < today) {
    const d = calendarDaysBetween(ce, today);
    out.push({ code: "step_overdue", chip: null, days: d, operationId: cur.id, message: `Aktuální krok je ${daysText(d)} po termínu (${shortDay(ce)}).` });
  }
  return out;
}

export interface ReplanProposal {
  id: string;
  label: string;
  from: string | null;
  to: string | null;
  changed: boolean;
  /** Termín byl potvrzený / dohodnutý s dodavatelem — změna se mu pošle. */
  highlight: boolean;
  note: string | null;
}

/**
 * Návrh posunutých termínů: změněný krok dostane nové datum, další otevřené kroky se posunou
 * o rozdíl a drží svou délku v pracovních dnech; krok s konečným termínem jde za termínem zákazníka.
 * Nic se neukládá — uživatel návrh potvrdí v dialogu.
 */
export function replanRoute(
  ops: RouteOp[],
  change: { operationId: string; plannedEnd: string } | { dueDate: string },
): ReplanProposal[] {
  const sorted = sortOperations(ops);
  const live = sorted.filter((o) => o.status !== "preskoceno");
  const newEnd = new Map<string, string | null>();
  if ("dueDate" in change) {
    for (const o of live) if (o.endsAtCustomerDate && OPEN.includes(o.status)) newEnd.set(o.id, change.dueDate);
  } else {
    const idx = live.findIndex((o) => o.id === change.operationId);
    if (idx >= 0) {
      newEnd.set(live[idx].id, change.plannedEnd);
      let prevOld = cleanDate(live[idx].plannedEnd);
      let prevNew = change.plannedEnd;
      for (const o of live.slice(idx + 1)) {
        if (!OPEN.includes(o.status)) continue;
        const old = cleanDate(o.plannedEnd);
        if (o.endsAtCustomerDate) { newEnd.set(o.id, old); prevOld = old; prevNew = old ?? prevNew; continue; }
        // krok bez data se přeskočí (nic nenese); bez staršího předchůdce není od čeho měřit → kotva beze změny
        if (!old) continue;
        if (!prevOld) { prevOld = old; prevNew = old; continue; }
        const to = addWorkingDays(prevNew, workingDaysBetween(prevOld, old));
        newEnd.set(o.id, to);
        prevOld = old;
        prevNew = to;
      }
    }
  }
  return live.map((o) => {
    const from = cleanDate(o.plannedEnd);
    const to = newEnd.has(o.id) ? (newEnd.get(o.id) ?? null) : from;
    const changed = to !== from;
    const highlight = changed && (o.deadlineState === "potvrzeno" || o.deadlineState === "dohodnuto");
    return {
      id: o.id, label: stepLabel(o, live), from, to, changed, highlight,
      note: highlight ? "termín byl potvrzený dodavatelem — změna se mu pošle" : null,
    };
  });
}

// ── Objednávky: skupiny a automatické odeslání (E.1, E.4) ───
export interface PoGroupStep {
  key: string;
  who: StepWho;
  /** Krok teď vystavuje objednávku. */
  ordersNow: boolean;
  /** „Jedna objednávka i pro další krok" (výchozí ano). */
  sharedWithNext?: boolean;
}

export interface PoGroup {
  key: string;
  who: StepWho;
  stepKeys: string[];
}

function sameFirm(a: StepWho, b: StepWho): boolean {
  if (a.type === "supplier" && b.type === "supplier") return a.id === b.id;
  if (a.type === "free" && b.type === "free") return a.name.trim().toLowerCase() === b.name.trim().toLowerCase() && Boolean(a.name.trim());
  return false;
}

/** Souvislé kroky stejné firmy předané najednou = jedna objednávka (A,A → 1; A,B,A → 3). */
export function groupPurchaseOrders(steps: PoGroupStep[]): PoGroup[] {
  const groups: PoGroup[] = [];
  let open: { group: PoGroup; shareNext: boolean } | null = null;
  for (const s of steps) {
    if (!s.ordersNow || (s.who.type !== "supplier" && s.who.type !== "free")) { open = null; continue; }
    if (open && open.shareNext && sameFirm(open.group.who, s.who)) {
      open.group.stepKeys.push(s.key);
      open.shareNext = s.sharedWithNext !== false;
      continue;
    }
    const g: PoGroup = { key: `po:${s.key}`, who: s.who, stepKeys: [s.key] };
    groups.push(g);
    open = { group: g, shareNext: s.sharedWithNext !== false };
  }
  return groups;
}

/** Proč objednávku nejde poslat automaticky (plná automatika posílá jen „bezpečné"). */
export function autoSendBlockers(input: {
  unpricedItems: number;
  quoteExpired: boolean;
  partialCoverage: boolean;
  whoSource: WhoSource | null | undefined;
  supplierEmail: string | null | undefined;
  senderUsable: boolean;
  /**
   * Existuje k dílům srovnatelně levnější nabídka jiné firmy? undefined = neznámo (staré volání → „dražší");
   * false = „dražší" by lhalo: firma bez nabídky / podle historie / nabídka bez srovnatelné ceny.
   */
  cheaperQuote?: boolean;
  /** Krok má nabídku vybrané firmy (jen pro text, když není levnější). */
  hasQuote?: boolean;
}): string[] {
  const out: string[] = [];
  const n = input.unpricedItems;
  if (n > 0) out.push(`${n} ${n === 1 ? "položka" : n < 5 ? "položky" : "položek"} bez ceny`);
  if (input.quoteExpired) out.push("nabídka vypršela");
  if (input.partialCoverage) out.push("nabídka pokrývá jen část dílů");
  if (!input.whoSource || !["nejlevnejsi_nabidka", "objednavka"].includes(input.whoSource)) {
    const ws = input.whoSource ?? null;
    if (input.cheaperQuote !== false) out.push("ručně zvolená dražší firma");
    else if (ws === "nabidka") out.push("nabídka bez srovnatelné ceny — porovnej ručně");
    else if (ws === "posledni_vykres" || ws === "posledni_operace" || ws === "technologie") out.push("firma podle historie (bez nabídky)");
    else out.push(input.hasQuote ? "ručně zvolená firma" : "firma bez nabídky (zvolená ručně)");
  }
  if (!(input.supplierEmail ?? "").trim()) out.push("dodavatel nemá v adresáři e-mail");
  if (!input.senderUsable) out.push("nemáš nastavenou schránku pro odesílání");
  return out;
}

/** Uzavřená zakázka (předání nejde). */
export function isClosedForHandoff(stage: JobStage): boolean {
  return CLOSED_STAGES.includes(stage);
}

/** Popis kroku do souhrnu („Výroba 1 · Kovoobrábění Hrubý · mezitermín 13. 11. (odhad)"). */
export function stepSummaryText(input: {
  label: string;
  who: StepWho;
  role?: PerformerRole | null;
  plannedEnd: string | null;
  endsAtCustomerDate: boolean;
  deadlineState?: DeadlineState | null;
}): string {
  const name = whoName(input.who);
  const who = name ? `${name}${input.role === "částečný dodavatel" ? " (částečný dodavatel)" : ""}` : null;
  const date = input.plannedEnd
    ? input.endsAtCustomerDate
      ? `konečný termín (zákazník) ${shortDay(input.plannedEnd)}`
      : `mezitermín ${shortDay(input.plannedEnd)}${input.deadlineState ? ` (${DEADLINE_STATE_META[input.deadlineState].label})` : ""}`
    : null;
  return [input.label, who, date].filter(Boolean).join(" · ");
}
