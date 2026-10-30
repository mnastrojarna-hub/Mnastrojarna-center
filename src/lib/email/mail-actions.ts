import type { EmailCategory } from "@/lib/data/types";

/**
 * Hlavní akce zprávy v Poště podle kategorie a stavu (čistá logika, testy v mail-actions.test.ts).
 * Majitel 30. 10.: „Založit zakázku" u faktury nebo poptávky mate — u poptávky má být „Vytvořit
 * nabídku", u faktury „Zapsat fakturu dodavatele". Jedno jasné hlavní tlačítko, zbytek v ⋯;
 * „Založit zakázku" zůstává jen jako obecná možnost v ⋯.
 */

export type MailActionKey =
  | "quote.create"          // Poptávka → zakázka ve stavu poptávka + editor nabídky
  | "quote.continue"        // Poptávka už u zakázky → záložka Nabídky
  | "order.process"         // Objednávka / potvrzení → spárovat se zakázkou (nebo založit)
  | "invoice.record"        // Faktura dodavatele → Faktury dodavatelů (přílohy)
  | "supplierQuote.record"  // Nabídka dodavatele u zakázky → záložka Nákup (cena dodavatele)
  | "job.open"
  | "job.assign"
  | "job.create";

export interface MailActionPlan {
  /** Hlavní (zelené) tlačítko; null = žádné (spam, odeslaná bez zakázky). */
  main: MailActionKey | null;
  /** Další možnosti v ⋯ (bez hlavní). */
  more: MailActionKey[];
}

export const MAIL_ACTION_LABEL: Record<MailActionKey, string> = {
  "quote.create": "Vytvořit nabídku",
  "quote.continue": "Pokračovat v nabídce",
  "order.process": "Zpracovat objednávku",
  "invoice.record": "Zapsat fakturu dodavatele",
  "supplierQuote.record": "Zapsat nabídku dodavatele",
  "job.open": "Otevřít zakázku",
  "job.assign": "Přiřadit k zakázce",
  "job.create": "Založit zakázku",
};

/** Akce, které jdou spustit rovnou z řádku seznamu (bez výběru zakázky). */
export const ROW_ACTIONS: readonly MailActionKey[] = ["quote.create", "quote.continue", "order.process", "invoice.record", "supplierQuote.record"];

export function mailActionPlan(input: {
  category: EmailCategory | string | null | undefined;
  /** Směr zprávy, ke které se akce vztahuje (detail: poslední příchozí; řádek: zobrazená zpráva). */
  direction: "in" | "out";
  jobId?: string | null;
}): MailActionPlan {
  const linked = Boolean(input.jobId);
  const c = input.category ?? "Ostatní";
  if (c === "Spam") return { main: null, more: [] };
  // odeslaná pošta: nic nezakládat, jen otevřít zakázku, je-li přiřazená
  if (input.direction === "out") return { main: linked ? "job.open" : null, more: [] };
  switch (c) {
    case "Poptávka":
      return linked ? { main: "quote.continue", more: ["job.open"] } : { main: "quote.create", more: ["job.assign", "job.create"] };
    case "Objednávka":
    case "Potvrzení objednávky":
      return linked ? { main: "job.open", more: [] } : { main: "order.process", more: ["job.assign", "job.create"] };
    case "Faktura":
      // faktura dodavatele nikdy nezakládá zakázku
      return { main: "invoice.record", more: linked ? ["job.open"] : ["job.assign"] };
    case "Nabídka dodavatele":
      return linked ? { main: "supplierQuote.record", more: ["job.open"] } : { main: "job.assign", more: [] };
    case "Upomínka":
      return linked ? { main: "job.open", more: [] } : { main: "job.assign", more: [] };
    default:
      // K zakázce, Reklamace, Technická dokumentace, Ostatní
      return linked ? { main: "job.open", more: [] } : { main: "job.assign", more: ["job.create"] };
  }
}

/** Kam vede akce bez serverového kroku (null = potřebuje server / výběr). */
export function mailActionHref(key: MailActionKey, jobId: string | null | undefined): string | null {
  if (!jobId) return null;
  switch (key) {
    case "quote.continue":
      return `/orders/${jobId}?tab=nabidky`;
    case "supplierQuote.record":
      return `/orders/${jobId}?tab=nakup`;
    case "job.open":
      return `/orders/${jobId}?tab=komunikace`;
    default:
      return null;
  }
}
