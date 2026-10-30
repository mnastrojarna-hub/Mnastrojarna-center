/**
 * Naše faktura zakázky — čisté pomocné funkce sdílené serverem (vystavení, odeslání) i kartou
 * (Doklady ▾, přehled faktury, dialog „Vystavit fakturu").
 */

/** Vystavená NAŠE faktura z aplikace (PDF z řady FV) — ne faktura dodavatele, ne nahraný / vyfocený soubor. */
export function isOwnInvoiceFile(f: { kind: string; archived?: boolean; issuer?: string | null; origin?: string | null }): boolean {
  return f.kind === "faktura" && !f.archived && f.issuer !== "dodavatel" && f.origin === "generated";
}

/** Poslední naše vystavená faktura zakázky (PDF z aplikace). */
export function ownInvoiceFile<T extends { kind: string; archived?: boolean; issuer?: string | null; origin?: string | null; createdAt: string }>(
  files: readonly T[],
): T | null {
  return [...files].filter(isOwnInvoiceFile).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

/** Číslo z naší řady faktur (next_doc_number('FV') → FV-2026-001). */
export const FV_SERIES = /^FV-\d{4}-\d{3,}$/;

/**
 * Smí zakázka dostat fakturu? Jen po dodání VŠEHO (dílčí faktura na dodané kusy zatím není — faktura
 * by účtovala i nedodané zboží). „Uzavřít s menším množstvím" počítá jako dodané.
 */
export type InvoiceDeliveryState = "none" | "partial" | "complete";

export const INVOICE_NEEDS_DELIVERY = "Fakturu vystavíš po dodání — nejdřív „Zapsat dodání a dodací list“.";
export const INVOICE_NEEDS_FULL_DELIVERY =
  "Fakturu vystavíš, až bude dodáno vše — dílčí faktura na část dodávky zatím nejde. Dodej zbytek, nebo položku uzavři s menším množstvím.";

export function invoiceDeliveryError(state: InvoiceDeliveryState): string | null {
  if (state === "complete") return null;
  return state === "partial" ? INVOICE_NEEDS_FULL_DELIVERY : INVOICE_NEEDS_DELIVERY;
}
