// Překlad enum kódů z DB na české popisky pro UI.
import type {
  EmailCategory, PriorityLevel, OrderStatus, QuoteStatus, ApprovalType,
} from "@/lib/supabase/database.types";

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

export const orderStatusLabel: Record<OrderStatus, string> = {
  prijato: "Přijato",
  naceneni: "Nacenění",
  objednano: "Objednáno",
  ve_vyrobe: "Ve výrobě",
  expedovano: "Expedováno",
  dokonceno: "Dokončeno",
  zruseno: "Zrušeno",
};

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
