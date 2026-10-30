// Překlad enum kódů z DB na české popisky pro UI.
import type {
  EmailCategory, PriorityLevel, JobStage, QuoteStatus, QuoteState, ApprovalType,
} from "@/lib/supabase/database.types";
import { STAGES, STAGE_ORDER } from "@/lib/jobs/stages";
import { QUOTE_STATES, isQuoteState } from "@/lib/jobs/flow-status";

export const emailCategoryLabel: Record<EmailCategory, string> = {
  poptavka: "Poptávka",
  objednavka: "Objednávka",
  nabidka_dodavatele: "Nabídka dodavatele",
  potvrzeni_objednavky: "Potvrzení objednávky",
  faktura: "Faktura",
  upominka: "Upomínka",
  reklamace: "Reklamace",
  technicka_dokumentace: "Technická dokumentace",
  spam: "Spam",
  ostatni: "Ostatní",
  k_zakazce: "K zakázce",
};

export const priorityLabel: Record<PriorityLevel, string> = {
  nizka: "Nízká",
  stredni: "Střední",
  vysoka: "Vysoká",
};

/** Popisky stavů zakázky (zdroj pravdy: lib/jobs/stages). */
export const orderStatusLabel: Record<JobStage, string> = Object.fromEntries(
  STAGE_ORDER.map((s) => [s, STAGES[s].label]),
) as Record<JobStage, string>;

/**
 * Stav nabídky ze staršího sloupce status (bez quotes.state) — jediná definice stavů nabídky je
 * QUOTE_STATES (lib/jobs/flow-status). navrh_ai / ke_schvaleni bez dalších údajů = „Čeká na schválení“
 * (AI nabídku i nabídku čekající na schválení musí zkontrolovat člověk).
 */
const STATUS_TO_STATE: Record<QuoteStatus, QuoteState> = {
  navrh_ai: "ke_schvaleni",
  ke_schvaleni: "ke_schvaleni",
  odeslano: "odeslana",
  prijato: "prijata",
  zamitnuto: "zamitnuta",
};

/** Stav nabídky: přednost má quotes.state; jinak odvození ze status (+ archiv). */
export function quoteStateFromStatus(status: string | null | undefined, opts: { state?: string | null; archived?: boolean } = {}): QuoteState | null {
  if (isQuoteState(opts.state)) return opts.state;
  if (opts.archived && status !== "prijato" && status !== "zamitnuto") return "archivovana";
  if (status && status in STATUS_TO_STATE) return STATUS_TO_STATE[status as QuoteStatus];
  return null;
}

/** Popisek stavu nabídky podle staršího status (výpisy bez quotes.state, AI asistent). */
export const quoteStatusLabel: Record<QuoteStatus, string> = {
  navrh_ai: QUOTE_STATES[STATUS_TO_STATE.navrh_ai].label,
  ke_schvaleni: QUOTE_STATES[STATUS_TO_STATE.ke_schvaleni].label,
  odeslano: QUOTE_STATES[STATUS_TO_STATE.odeslano].label,
  prijato: QUOTE_STATES[STATUS_TO_STATE.prijato].label,
  zamitnuto: QUOTE_STATES[STATUS_TO_STATE.zamitnuto].label,
};

export const approvalTypeLabel: Record<ApprovalType, string> = {
  email_reply: "E-mail odpověď",
  quote: "Nabídka",
  // = popisek modulu automatiky („Poptávky dodavatelům")
  supplier_request: "Poptávka dodavateli",
  purchase_order: "Objednávka dodavateli",
  supplier_invoice: "Faktura dodavatele",
  categorization: "Kategorizace",
  order_match: "Párování objednávky",
  reminder: "Upomínka",
};
