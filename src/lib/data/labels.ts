// Překlad enum kódů z DB na české popisky pro UI.
import type {
  EmailCategory, PriorityLevel, JobStage, QuoteStatus, ApprovalType,
} from "@/lib/supabase/database.types";
import { STAGES, STAGE_ORDER } from "@/lib/jobs/stages";

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

export const quoteStatusLabel: Record<QuoteStatus, string> = {
  navrh_ai: "Návrh AI",
  ke_schvaleni: "Ke schválení",
  odeslano: "Odesláno",
  prijato: "Přijato",
  zamitnuto: "Zamítnuto",
};

export const approvalTypeLabel: Record<ApprovalType, string> = {
  email_reply: "E-mail odpověď",
  quote: "Nabídka",
  supplier_request: "Objednávka dodavateli",
  categorization: "Kategorizace",
  order_match: "Párování objednávky",
  reminder: "Upomínka",
};
