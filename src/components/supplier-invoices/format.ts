// Formátování částek a dat ve Fakturách dodavatelů (klient i server).
import { formatMoney, longDate } from "@/components/jobs/detail/detail-helpers";

export { formatMoney, longDate };

/** „12 500,00" bez měny (do polí). */
export function amountInput(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return n.toLocaleString("cs-CZ", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).replace(/ /g, " ");
}

/** „29. 10. 2026" nebo „—". */
export function dateText(iso: string | null | undefined): string {
  return longDate(iso ?? null) ?? "—";
}
