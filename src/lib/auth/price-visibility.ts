import type { DocIssuerKey } from "@/lib/supabase/database.types";
import type { PurchaseOrderListItem } from "@/lib/jobs/purchasing-types";

/**
 * Viditelnost nákupní strany (#25, pravidlo 2) — čistá logika bez DB.
 * Prodejní hodnoty vidí každý aktivní uživatel; nákupní ceny, marže a nákupní doklady jen
 * s právem „margins" (obchodník, super admin). Nákupní doklad zaměstnanci NEMIZÍ — řádek
 * zůstane vidět (druh, název, datum, kdo nahrál), obsah je zamčený.
 */

export interface PriceDocFacts {
  id: string;
  kind: string;
  issuer?: DocIssuerKey | string | null;
  origin?: string | null;
}

/** Druhy, které u neznámého vystavitele mohou nést nákupní cenu (fail closed). */
const PRICE_KINDS_UNKNOWN_ISSUER = ["nabidka", "faktura", "naceneni", "potvrzeni"];
/** Od dodavatele, ale bez ceny (technická dokumentace). */
const SUPPLIER_TECH_KINDS = ["vykres", "model_3d"];

/**
 * Nákupní doklad? linked = id souborů z purchase_orders.file_id ∪ supplier_quotes.file_id.
 * Dvojče SQL job_file_is_price_doc (migrace 20261023155000).
 */
export function isPriceDocument(f: PriceDocFacts, linked: ReadonlySet<string>): boolean {
  const issuer = f.issuer ?? null;
  if (f.kind === "objednavka_vydana") return true;
  if (issuer === "dodavatel" && !SUPPLIER_TECH_KINDS.includes(f.kind)) return true;
  if (PRICE_KINDS_UNKNOWN_ISSUER.includes(f.kind) && issuer === null && f.origin !== "generated") return true;
  return linked.has(f.id);
}

/** Soubor naší nabídky zákazníkovi (druh nabídka, nevystavil ji dodavatel). */
export function isOurQuoteFile(f: { kind: string; issuer?: string | null }): boolean {
  return f.kind === "nabidka" && (f.issuer ?? null) !== "dodavatel";
}

/**
 * Řádek přehledu „Objednávky dodavatelům" pro uživatele bez práva na nákupní ceny:
 * žádná cena, žádný volný text (poznámky, podmínky, důvod zrušení), žádné PDF ani nabídka dodavatele.
 */
export function maskPurchaseOrderListItem(po: PurchaseOrderListItem): PurchaseOrderListItem {
  const stamps = po.stamps
    ? Object.fromEntries(
        Object.entries(po.stamps).map(([k, v]) => [k, v ? { ...v, note: null } : v]),
      ) as unknown as PurchaseOrderListItem["stamps"]
    : po.stamps;
  return {
    ...po,
    total: 0,
    note: null,
    paymentTerms: null,
    deliveryTerms: null,
    supplierQuote: null,
    fileId: null,
    cancelReason: po.cancelReason === undefined ? undefined : null,
    stamps,
    items: po.items.map((it) => ({ ...it, unitPrice: null, note: null, receiptClosedReason: it.receiptClosedReason === undefined ? undefined : null })),
    pricesHidden: true,
  };
}
