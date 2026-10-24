// Datový model PDF „Objednávka" — naše objednávka vydaná dodavateli (kooperace, nákup).
import type { DocItem, PartyInfo } from "./types";

export interface PurchaseOrderData {
  /** Číslo objednávky (OV-2026-004). */
  number: string;
  /** Datum objednávky (RRRR-MM-DD). */
  issueDate: string;
  currency: string;
  /** Odběratel = my (Mnástrojárna). */
  buyer: PartyInfo;
  /** Dodavatel (kooperant). */
  supplier: PartyInfo;
  /** Kontaktní osoba dodavatele. */
  supplierContact?: string;
  /** Položky s nákupními cenami (prodejní ceny sem NIKDY nepatří). */
  items: DocItem[];
  /** Požadovaný termín dodání (velký odznak). */
  requiredDate?: string;
  /** Naše číslo zakázky (Z-2026-014). */
  jobNumber?: string;
  /** Dle nabídky dodavatele č. … ze dne … */
  supplierQuoteNumber?: string;
  supplierQuoteDate?: string;
  /** Číslo potvrzení u dodavatele a potvrzený termín (po potvrzení). */
  supplierReference?: string;
  confirmedDate?: string;
  /** Dodací adresa (víceřádková přes „\n" nebo čárky). */
  deliveryAddress?: string;
  deliveryTerms?: string;
  paymentTerms?: string;
  note?: string;
  /** Vyřizuje / vystavil (já) + kontakt. */
  contactPerson?: string;
  contactEmail?: string;
  contactPhone?: string;
  /** Do kolika pracovních dnů potvrdit (výchozí 2). */
  confirmWithinDays?: number;
  /** Úvodní text; undefined = výchozí, "" = bez úvodu. */
  intro?: string;
  /** Text v souhrnu pod cenou (např. přenesená daňová povinnost). */
  totalsHint?: string;
  /** Změna objednávky: revize ≥ 2 → v hlavičce „Změna č. {revize} · ze dne {revisionDate}". */
  revision?: number;
  revisionDate?: string;
  /** Pokyn k provedení (3. bod pokynů); undefined = „Vyrábějte dle výkresové dokumentace…" u položek s výkresem. */
  workInstruction?: string;
}
