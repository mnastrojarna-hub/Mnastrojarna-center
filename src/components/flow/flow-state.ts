import {
  CONFIRMATION_STATES, DELIVERY_STATES, FLOW_ACTIONS, FULFILMENT_STATES, INQUIRY_STATES, ORDER_STATES, PRICING_STATES,
  QUOTE_STATES, approvalReasons, canApproveQuote, deliveryProgress, lostReasonLabel, productionProgress, quoteLabel, quoteUnpriced,
  waitingText, type ActionCtx, type ChangeStamp, type FlowActionKey, type FlowFacts, type FlowPhase, type FlowSnapshot,
  type PaletteKey, type Progress, type QuoteDisplayState, type QuoteFacts,
} from "@/lib/jobs/flow-status";
import type { DocIssuerKey, FlowProposal, JobFileOrigin, LostReason, OrderRevisionDecision } from "@/lib/supabase/database.types";

/**
 * Stránky obchodního toku (Poptávky, Nacenění, Nabídky, Potvrzení) — čistá logika nad
 * podrobnými stavy z lib/jobs/flow-status: výběr chipů z URL, okno uzavřených stavů
 * (stejné jako flow_counts v DB), chipy a „kdo · kdy“ řádku, akce nabídky v přehledu
 * a odkazy akcí, které se dělají v kartě zakázky. Bez Reactu a DB (testy flow-state.test.ts).
 */

export type NextStep = { key: FlowActionKey; label: string } | null;

/** „Kdo · kdy“ dílčích stavů zakázky pro řádek stránky toku. */
export interface FlowRowStamps {
  stage: ChangeStamp | null;
  inquiry: ChangeStamp | null;
  order: ChangeStamp | null;
  /** Kdo zapsal poslední změnu objednávky (revizi). */
  orderChange: ChangeStamp | null;
  confirmed: ChangeStamp | null;
  confirmationSent: ChangeStamp | null;
  lost: ChangeStamp | null;
  proposal: ChangeStamp | null;
}

/** Podrobný stav zakázky + další krok a menu pro přihlášeného (serializovatelné). */
export interface FlowJobState {
  jobId: string;
  facts: FlowFacts;
  snapshot: FlowSnapshot;
  quotes: QuoteFacts[];
  stamps: FlowRowStamps;
  next: NextStep;
  menu: FlowActionKey[];
  /** Smí rozhodnout čekající návrh (✓ / ✕). */
  canDecideProposal: boolean;
}

export interface FlowQuoteInfo {
  id: string;
  facts: QuoteFacts;
  display: QuoteDisplayState;
  stateChangedAt: string | null;
  lostReason: LostReason | null;
  rejectedReason: string | null;
  feedback: string | null;
  /** Cena konkurence — jen s právem na marže. */
  competitorPrice: number | null;
  stamps: {
    created: ChangeStamp | null;
    approvalRequested: ChangeStamp | null;
    approved: ChangeStamp | null;
    sent: ChangeStamp | null;
    accepted: ChangeStamp | null;
    rejected: ChangeStamp | null;
  };
  next: NextStep;
  menu: FlowActionKey[];
  /** Čekající návrh zakázky týkající se této nabídky. */
  proposal: { value: FlowProposal; stamp: ChangeStamp | null; canDecide: boolean } | null;
}

export interface OrderRevisionView {
  revision: number;
  decision: OrderRevisionDecision;
  note: string | null;
  customerOrderNumber: string | null;
  changes: { field: string; label: string; from: string | null; to: string | null }[];
  created: ChangeStamp;
}

/** Původ a autoři dokumentu (Dokumenty): náš doklad / od zákazníka, kdo nahrál a archivoval. */
export interface FileFlowInfo {
  origin: JobFileOrigin | null;
  issuer: DocIssuerKey | null;
  orderRevision: number | null;
  uploaded: ChangeStamp | null;
  archived: ChangeStamp | null;
}

/** Krátký popis původu dokladu („náš doklad“, „z fotky“, „od dodavatele“…). */
export function fileOriginLabel(i: Pick<FileFlowInfo, "origin" | "issuer" | "orderRevision">): string | null {
  const who = i.issuer === "zakaznik" ? "od zákazníka" : i.issuer === "dodavatel" ? "od dodavatele" : null;
  const rev = i.orderRevision && i.orderRevision > 1 ? ` · rev ${i.orderRevision}` : "";
  if (i.origin === "generated") return `náš doklad${rev}`;
  if (i.origin === "capture") return who ? `z fotky · ${who}` : "z fotky";
  if (i.origin === "email") return who ? `z e-mailu · ${who}` : "z e-mailu";
  if (i.origin === "import") return "import";
  return who;
}

// ── Výběr chipů (URL ?stav=a,b) ─────────────────────────────
export const STATE_PARAM = "stav";

/** Klíče z URL — jen povolené, bez duplicit; nic platného → výchozí výběr. */
export function parseStateParam(raw: string | string[] | undefined | null, allowed: readonly string[], fallback: readonly string[]): string[] {
  const text = Array.isArray(raw) ? raw.join(",") : raw ?? "";
  const out: string[] = [];
  for (const k of text.split(",").map((s) => s.trim())) {
    if (k && allowed.includes(k) && !out.includes(k)) out.push(k);
  }
  return out.length ? out : [...fallback];
}

/** Hodnota parametru (výchozí výběr = bez parametru). */
export function stateParamValue(selected: readonly string[], fallback: readonly string[]): string | null {
  const same = selected.length === fallback.length && fallback.every((k) => selected.includes(k));
  return same || !selected.length ? null : selected.join(",");
}

/** Uzavřené dílčí stavy se v chipech počítají jen za posledních N dní (= flow_counts). */
export const CLOSED_DAYS = 30;
export const CLOSED_JOB_KEYS: readonly string[] = ["zpracovana", "odmitnuta", "stazena", "stornovana", "dokoncena", "zaplaceno"];
export const CLOSED_QUOTE_KEYS: readonly string[] = ["prijata", "zamitnuta", "archivovana"];

/** Změna je novější než okno uzavřených stavů (bez data = starší). */
export function withinClosedWindow(at: string | null | undefined, now: number = Date.now(), days: number = CLOSED_DAYS): boolean {
  if (!at) return false;
  const t = Date.parse(at);
  return Number.isFinite(t) && t > now - Math.max(1, days) * 86_400_000;
}

// ── Chipy řádku ─────────────────────────────────────────────
/** Chip bez komponenty ikony (serializovatelný; meta dohledá FlowChip). */
export interface ChipData {
  phase: FlowPhase;
  key: string;
  label: string;
  hint?: string | null;
  progress?: Progress | null;
  ai?: boolean;
}

function lostLabel(base: string, reason: LostReason | null | undefined): string {
  return reason ? `${base} — ${lostReasonLabel(reason)}` : base;
}

/** Poptávka: „V řešení · Petr Obchodník“, „Čeká na podklady · čeká 3 dny“, „Odmítnutá — Kapacita“. */
export function inquiryChip(f: FlowFacts, s: FlowSnapshot): ChipData | null {
  if (!s.inquiry) return null;
  const m = INQUIRY_STATES[s.inquiry];
  if (s.inquiry === "odmitnuta" || s.inquiry === "stazena") return { phase: "inquiry", key: m.key, label: lostLabel(m.label, f.lostReason), hint: f.lostNote ?? null };
  const hint = s.inquiry === "ceka_na_podklady"
    ? [waitingText(s.waitingDays), f.waitingNote ?? null].filter(Boolean).join(" · ") || null   // dny první — na mobilu se ořízne poznámka
    : s.inquiry === "v_reseni" ? f.assigneeName ?? null : null;
  return { phase: "inquiry", key: m.key, label: m.label, hint };
}

/** Nacenění: „Naceňuje se (3/5)“, „Čeká na ceny dodavatelů (2)“. */
export function pricingChip(f: FlowFacts, s: FlowSnapshot): ChipData | null {
  if (!s.pricing) return null;
  const m = PRICING_STATES[s.pricing];
  const hint = s.pricing === "rozpracovano" ? `${f.itemsPriced}/${f.itemsCount}`
    : s.pricing === "ceka_na_dodavatele" ? String(f.pendingSupplierQuotes) : null;
  return { phase: "pricing", key: m.key, label: hint ? `${m.label} (${hint})` : m.label };
}

/** Aktivní nabídka zakázky: „Odeslaná · NAB-2026-031 r2 · čeká 4 dny“. */
export function quoteChip(s: FlowSnapshot): ChipData | null {
  if (!s.quote || !s.activeQuote) return null;
  const m = QUOTE_STATES[s.quote];
  const hint = [quoteLabel(s.activeQuote), s.quote === "odeslana" ? waitingText(s.waitingDays) : null].filter(Boolean).join(" · ");
  return { phase: "quote", key: m.key, label: m.label, hint, ai: s.activeQuote.aiGenerated };
}

function mismatchHint(f: FlowFacts): string | null {
  const items = f.orderMismatch?.items ?? [];
  const missing = items.filter((i) => i.kind === "chybi_polozka").length;
  if (missing > 0 && f.itemsCount > 0) return `Objednáno částečně (${Math.max(0, f.itemsCount - missing)}/${f.itemsCount})`;
  if (!items.length) return null;
  const n = items.length;
  return `${n} ${n === 1 ? "rozdíl" : n < 5 ? "rozdíly" : "rozdílů"}`;
}

/** Objednávka: doklad (rev N, rozpor) + potvrzení (✉ / bez dokladu) + plnění (výroba, částečně). */
export function orderChips(f: FlowFacts, s: FlowSnapshot): ChipData[] {
  const out: ChipData[] = [];
  if (s.order) {
    const m = ORDER_STATES[s.order];
    if (s.order === "stornovana") out.push({ phase: "order", key: m.key, label: lostLabel(m.label, f.lostReason), hint: f.lostNote ?? null });
    else if (s.order === "rozpor") {
      const fix = f.orderMismatch?.fix_requested_at ? `oprava vyžádána · ${waitingText(s.waitingDays) ?? "dnes"}` : null;
      out.push({ phase: "order", key: m.key, label: m.label, hint: [mismatchHint(f), fix].filter(Boolean).join(" · ") || null });
    } else {
      const rev = f.orderRevision > 1 ? `rev ${f.orderRevision}` : null;
      const rejected = s.order === "potvrzena" && f.orderConfirmedRevision !== null && f.orderConfirmedRevision < f.orderRevision
        ? `změna rev ${f.orderRevision} odmítnuta` : null;
      out.push({ phase: "order", key: m.key, label: rev && s.order !== "potvrzena" ? `${m.label} (${rev})` : m.label, hint: rejected });
    }
  }
  if (s.confirmation) {
    const c = CONFIRMATION_STATES[s.confirmation];
    const rev = s.confirmation === "bez_dokladu" ? `rev ${f.orderConfirmedRevision ?? f.orderRevision}` : null;
    out.push({ phase: "confirmation", key: c.key, label: c.label, hint: rev });
  }
  if (s.fulfilment) {
    const m = FULFILMENT_STATES[s.fulfilment];
    const progress = s.fulfilment === "castecne_dodana" ? deliveryProgress(f)
      : s.fulfilment === "ve_vyrobe" ? productionProgress(f) : null;
    out.push({ phase: "fulfilment", key: m.key, label: m.label, progress });
  } else if (s.delivery === "k_expedici") {
    out.push({ phase: "delivery", key: "k_expedici", label: DELIVERY_STATES.k_expedici.label });
  }
  return out;
}

// ── Akce nabídky v přehledu /quotes (řádek = jedna nabídka) ─
export interface QuoteRowInput {
  quote: QuoteFacts;
  display: QuoteDisplayState;
  hasJob: boolean;
  /** Aktivní (nearchivovaná) verze zakázky. */
  current: boolean;
}

/** Další krok a menu jedné nabídky — stejná pravidla jako nextAction / menuActions (1.12). */
export function quoteRowActions(r: QuoteRowInput, ctx: ActionCtx): { next: NextStep; menu: FlowActionKey[] } {
  const q = r.quote;
  const margins = ctx.can("margins");
  const reasons = approvalReasons(q);
  const canApprove = canApproveQuote(q, ctx, reasons);
  const ok = (k: FlowActionKey) => ctx.can(FLOW_ACTIONS[k].feature);
  const step = (k: FlowActionKey): NextStep => (ok(k) ? { key: k, label: FLOW_ACTIONS[k].label } : null);
  const st = q.state;
  let next: NextStep = null;
  const keys: FlowActionKey[] = [];
  const add = (k: FlowActionKey) => { if (!keys.includes(k)) keys.push(k); };

  const unpriced = quoteUnpriced(q);
  if (unpriced) {
    // bez ceny nejde odeslat — další krok je doplnit cenu (na kartě zakázky)
    next = r.hasJob && ok("quote.edit") ? { key: "quote.edit", label: "Doplnit cenu" } : null;
    add("quote.edit");
    if (st === "rozpracovana") add("quote.requestApproval");
    if (st !== "schvalena" && canApprove) add("quote.approve");
    if (st !== "rozpracovana") add("quote.unapprove");
  } else if (st === "rozpracovana") {
    if (margins && !q.approvalRequired && r.hasJob) next = step("quote.send");
    else if (margins && canApprove) next = r.hasJob ? step("quote.approveSend") : step("quote.approve");
    else next = step("quote.requestApproval");
    add("quote.requestApproval");
    if (canApprove) add("quote.approve");
    if (r.hasJob) { add("quote.send"); add("quote.markSent"); }
  } else if (st === "ke_schvaleni") {
    next = canApprove ? step("quote.approve") : null;
    if (canApprove) { add("quote.approve"); if (r.hasJob) add("quote.approveSend"); }
    add("quote.unapprove");
  } else if (st === "schvalena") {
    next = r.hasJob ? step("quote.send") : null;
    if (r.hasJob) { add("quote.send"); add("quote.markSent"); }
    add("quote.unapprove");
  } else if (st === "odeslana" || st === "pripominky") {
    next = r.display === "vyprsela" ? step("quote.extend") : st === "pripominky" ? step("quote.newRevision") : step("quote.accept");
    if (r.hasJob) {
      add("quote.accept");
      if (st === "odeslana") add("quote.feedback"); else add("quote.answerNoChange");
      if (r.current) add("quote.newRevision");
      add("quote.extend");
      add(margins ? "quote.reject" : "quote.propose");
    } else {
      next = null;
    }
  } else if (st === "zamitnuta") {
    if (r.hasJob) add("quote.reopen");
  }
  if (!r.hasJob && next && (next.key === "quote.accept" || next.key === "quote.newRevision" || next.key === "quote.extend")) next = null;
  const allowed = keys.filter(ok);
  const safe = allowed.filter((k) => FLOW_ACTIONS[k].intent !== "danger");
  const danger = allowed.filter((k) => FLOW_ACTIONS[k].intent === "danger");
  return { next, menu: [...safe, ...danger] };
}

// ── Akce, které se dělají v kartě zakázky (správné záložky) ─
/** Akce řešené přímo na stránkách toku (dialog / jeden zápis). */
export const INLINE_ACTIONS: readonly FlowActionKey[] = [
  "proposal.decide", "inquiry.take", "inquiry.wait", "inquiry.resume", "inquiry.decline", "inquiry.withdraw",
  "inquiry.reopen", "inquiry.propose", "quote.requestApproval", "quote.approve", "quote.approveSend", "quote.unapprove",
  "quote.send", "quote.markSent", "quote.feedback", "quote.answerNoChange", "quote.accept", "quote.reject", "quote.propose",
  "quote.reopen", "quote.newRevision", "quote.extend", "order.confirm", "order.confirmOther", "order.flagMismatch",
  "order.resolveMismatch", "order.requestFix", "order.registerChange", "order.decideChange", "order.rejectChange",
  "order.sendConfirmation", "order.cancel", "order.propose", "order.reopen",
];

/** Odkaz akce, která se dělá jinde (nacenění, výroba, dodání, faktura) — null = řeší se na místě. */
export function flowActionHref(key: FlowActionKey, jobId: string): string | null {
  switch (key) {
    case "pricing.open":
    case "quote.create":
      return `/pricing?job=${jobId}`;
    case "pricing.supplierPrice":
      return `/orders/${jobId}?tab=nakup`;
    case "quote.edit":
      return `/orders/${jobId}?tab=nabidky`;
    case "production.plan":
    case "delivery.record":
    case "delivery.closeShort":
    case "delivery.partialNote":
    case "delivery.confirmNote":
    case "payment.invoice":
    case "payment.record":
    case "payment.settle":
      return `/orders/${jobId}?tab=vyroba`;
    case "job.correct":
      return `/orders/${jobId}?akce=job.correct`;
    default:
      return INLINE_ACTIONS.includes(key) ? null : `/orders/${jobId}`;
  }
}

/** Menu stránky toku: bez „Korekce stavu…“ (patří do karty zakázky) a bez vyloučených akcí. */
export function pageMenu(menu: readonly FlowActionKey[], exclude: readonly FlowActionKey[] = []): FlowActionKey[] {
  return menu.filter((k) => k !== "job.correct" && !exclude.includes(k));
}

/** Barva primárního tlačítka podle fáze akce (plná barva odstínu fáze). */
export function actionPalette(key: FlowActionKey): PaletteKey {
  if (key.startsWith("inquiry.")) return "sky.action";
  if (key.startsWith("pricing.")) return "amber.action";
  if (key.startsWith("quote.")) return "violet.action";
  if (key === "order.confirm" || key === "order.confirmOther") return "orange.action";
  if (key.startsWith("order.")) return key === "order.resolveMismatch" ? "rose.problem" : "indigo.action";
  if (key.startsWith("production.")) return "yellow.work";
  if (key.startsWith("delivery.")) return "green.action";
  if (key.startsWith("payment.")) return "emerald.ok";
  return "ghost.proposal";
}
