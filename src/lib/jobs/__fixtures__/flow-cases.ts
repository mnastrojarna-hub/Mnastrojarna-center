import type { InquiryStatus, JobStage, LostReason, OrderDocStatus } from "@/lib/supabase/database.types";

/**
 * Případy pro invarianty D1/D2 (orders_stage_change) a výchozí dílčí stavy (flow_initial_*).
 * Zdroj: specifikace kap. 2.1 a 2.10 (tabulka očekávaného backfillu lokální DB).
 */

export interface SubStateCase {
  name: string;
  stage: JobStage;
  prevStage?: JobStage;
  inquiry: InquiryStatus | null;
  order: OrderDocStatus | null;
  lostReason?: LostReason | null;
  expect: { inquiry: InquiryStatus | null; order: OrderDocStatus | null };
}

export const SUB_STATE_CASES: SubStateCase[] = [
  // poptávka (rank 0)
  { name: "poptávka přijatá zůstává", stage: "poptavka", inquiry: "prijata", order: null, expect: { inquiry: "prijata", order: null } },
  { name: "poptávka čeká na podklady zůstává", stage: "poptavka", inquiry: "ceka_na_podklady", order: null, expect: { inquiry: "ceka_na_podklady", order: null } },
  { name: "bez poptávky na ranku 0 → v řešení", stage: "poptavka", inquiry: null, order: null, expect: { inquiry: "v_reseni", order: null } },
  { name: "obnovení korekcí z odmítnuté → přijatá", stage: "poptavka", prevStage: "nerealizovano", inquiry: "odmitnuta", order: null, expect: { inquiry: "prijata", order: null } },
  { name: "korekce zpět ze zpracované → v řešení", stage: "poptavka", prevStage: "nabidka", inquiry: "zpracovana", order: null, expect: { inquiry: "v_reseni", order: null } },
  { name: "korekce zpět maže objednávku", stage: "poptavka", prevStage: "objednavka", inquiry: "zpracovana", order: "dorucena", expect: { inquiry: "v_reseni", order: null } },
  // nacenění (rank 1)
  { name: "nacenění z přijaté → v řešení", stage: "naceneni", inquiry: "prijata", order: null, expect: { inquiry: "v_reseni", order: null } },
  { name: "nacenění čeká na podklady zůstává", stage: "naceneni", inquiry: "ceka_na_podklady", order: null, expect: { inquiry: "ceka_na_podklady", order: null } },
  { name: "nacenění bez poptávky → v řešení", stage: "naceneni", inquiry: null, order: null, expect: { inquiry: "v_reseni", order: null } },
  // nabídka a dál (rank ≥ 2)
  { name: "nabídka → zpracovaná", stage: "nabidka", inquiry: "v_reseni", order: null, expect: { inquiry: "zpracovana", order: null } },
  { name: "objednávka → doručená", stage: "objednavka", inquiry: "zpracovana", order: null, expect: { inquiry: "zpracovana", order: "dorucena" } },
  { name: "bez poptávky zůstává bez poptávky", stage: "objednavka", inquiry: null, order: null, expect: { inquiry: null, order: "dorucena" } },
  { name: "korekce potvrzeno → objednávka vrací doručenou", stage: "objednavka", prevStage: "potvrzeno", inquiry: "zpracovana", order: "potvrzena", expect: { inquiry: "zpracovana", order: "dorucena" } },
  { name: "obnovení ze zrušeno na objednávku", stage: "objednavka", prevStage: "zruseno", inquiry: "zpracovana", order: "stornovana", expect: { inquiry: "zpracovana", order: "dorucena" } },
  { name: "potvrzeno dorovná doručenou", stage: "potvrzeno", inquiry: "zpracovana", order: "dorucena", expect: { inquiry: "zpracovana", order: "potvrzena" } },
  { name: "potvrzeno bez objednávky → potvrzená", stage: "potvrzeno", inquiry: "zpracovana", order: null, expect: { inquiry: "zpracovana", order: "potvrzena" } },
  { name: "rozpor se nedorovná", stage: "ve_vyrobe", prevStage: "objednavka", inquiry: "zpracovana", order: "rozpor", expect: { inquiry: "zpracovana", order: "rozpor" } },
  { name: "aktualizovaná se nedorovná", stage: "dodano_zakaznikovi", prevStage: "ve_vyrobe", inquiry: "zpracovana", order: "aktualizovana", expect: { inquiry: "zpracovana", order: "aktualizovana" } },
  { name: "obnovení ze zrušeno na potvrzeno", stage: "potvrzeno", prevStage: "zruseno", inquiry: "zpracovana", order: "stornovana", expect: { inquiry: "zpracovana", order: "potvrzena" } },
  { name: "dokončeno", stage: "dokonceno", inquiry: "zpracovana", order: "potvrzena", expect: { inquiry: "zpracovana", order: "potvrzena" } },
  // speciální stavy
  { name: "nerealizováno z otevřené (náš důvod) → odmítnutá", stage: "nerealizovano", prevStage: "poptavka", inquiry: "v_reseni", order: null, lostReason: "kapacita", expect: { inquiry: "odmitnuta", order: null } },
  { name: "nerealizováno z otevřené (zákazník) → stažená", stage: "nerealizovano", prevStage: "naceneni", inquiry: "v_reseni", order: null, lostReason: "cena", expect: { inquiry: "stazena", order: null } },
  { name: "nerealizováno bez důvodu → stažená", stage: "nerealizovano", prevStage: "poptavka", inquiry: "prijata", order: null, expect: { inquiry: "stazena", order: null } },
  { name: "nerealizováno po nabídce: zpracovaná zůstává", stage: "nerealizovano", prevStage: "nabidka", inquiry: "zpracovana", order: null, expect: { inquiry: "zpracovana", order: null } },
  { name: "zrušeno s objednávkou → stornovaná", stage: "zruseno", prevStage: "potvrzeno", inquiry: "zpracovana", order: "potvrzena", expect: { inquiry: "zpracovana", order: "stornovana" } },
  { name: "zrušeno bez objednávky", stage: "zruseno", prevStage: "poptavka", inquiry: "prijata", order: null, lostReason: "duplicita", expect: { inquiry: "odmitnuta", order: null } },
  { name: "pozastaveno beze změny", stage: "pozastaveno", prevStage: "ve_vyrobe", inquiry: "zpracovana", order: "potvrzena", expect: { inquiry: "zpracovana", order: "potvrzena" } },
  { name: "reklamace beze změny", stage: "reklamace", prevStage: "dokonceno", inquiry: "zpracovana", order: "potvrzena", expect: { inquiry: "zpracovana", order: "potvrzena" } },
  { name: "pozastavená poptávka zůstává otevřená", stage: "pozastaveno", prevStage: "poptavka", inquiry: "ceka_na_podklady", order: null, expect: { inquiry: "ceka_na_podklady", order: null } },
];

export interface InitialCase {
  number: string;
  stage: JobStage;
  source: string;
  inquiryDate: string | null;
  inquiryNumber: string | null;
  orderDate: string | null;
  orderNumber: string | null;
  confirmedAt: string | null;
  inquiry: InquiryStatus | null;
  order: OrderDocStatus | null;
}

/** Demo zakázky Z-2026-101 … 116 (seed-demo.sql) → očekávaný backfill (spec 2.10). */
export const INITIAL_CASES: InitialCase[] = [
  { number: "Z-2026-101", stage: "poptavka", source: "email", inquiryDate: "2026-10-20", inquiryNumber: "POP-7781", orderDate: null, orderNumber: null, confirmedAt: null, inquiry: "prijata", order: null },
  { number: "Z-2026-102", stage: "naceneni", source: "foto", inquiryDate: "2026-10-18", inquiryNumber: "RFQ-2026-118", orderDate: null, orderNumber: null, confirmedAt: null, inquiry: "v_reseni", order: null },
  { number: "Z-2026-103", stage: "nabidka", source: "manual", inquiryDate: "2026-10-10", inquiryNumber: null, orderDate: null, orderNumber: null, confirmedAt: null, inquiry: "zpracovana", order: null },
  { number: "Z-2026-104", stage: "objednavka", source: "foto", inquiryDate: "2026-10-01", inquiryNumber: null, orderDate: "2026-10-19", orderNumber: "PO-4500021877", confirmedAt: null, inquiry: "zpracovana", order: "dorucena" },
  { number: "Z-2026-105", stage: "potvrzeno", source: "manual", inquiryDate: "2026-09-10", inquiryNumber: null, orderDate: "2026-09-20", orderNumber: "4711-2026", confirmedAt: "2026-09-21T08:00:00Z", inquiry: "zpracovana", order: "potvrzena" },
  { number: "Z-2026-110", stage: "dodano_zakaznikovi", source: "manual", inquiryDate: "2026-07-01", inquiryNumber: null, orderDate: "2026-07-28", orderNumber: "OBJ-23-9702", confirmedAt: null, inquiry: "zpracovana", order: "potvrzena" },
  { number: "Z-2026-112", stage: "dokonceno", source: "manual", inquiryDate: "2026-06-01", inquiryNumber: null, orderDate: "2026-06-10", orderNumber: "4602-2026", confirmedAt: null, inquiry: "zpracovana", order: "potvrzena" },
  { number: "Z-2026-113", stage: "pozastaveno", source: "manual", inquiryDate: "2026-09-25", inquiryNumber: null, orderDate: "2026-10-05", orderNumber: "PO-4500021901", confirmedAt: null, inquiry: "zpracovana", order: "dorucena" },
  { number: "Z-2026-114", stage: "reklamace", source: "manual", inquiryDate: "2026-07-01", inquiryNumber: null, orderDate: "2026-07-15", orderNumber: "OBJ-23-9640", confirmedAt: null, inquiry: "zpracovana", order: "potvrzena" },
  { number: "Z-2026-115", stage: "nerealizovano", source: "manual", inquiryDate: "2026-09-01", inquiryNumber: "BEN-RFQ-12", orderDate: null, orderNumber: null, confirmedAt: null, inquiry: "stazena", order: null },
  { number: "Z-2026-116", stage: "zruseno", source: "manual", inquiryDate: "2026-06-01", inquiryNumber: null, orderDate: "2026-06-18", orderNumber: "4699-2026", confirmedAt: null, inquiry: "zpracovana", order: "stornovana" },
  // bez poptávky: opakovaná objednávka bez data a čísla poptávky
  { number: "opakovaná", stage: "objednavka", source: "manual", inquiryDate: null, inquiryNumber: null, orderDate: "2026-10-01", orderNumber: "X-1", confirmedAt: null, inquiry: null, order: "dorucena" },
  { number: "ruční poptávka", stage: "poptavka", source: "manual", inquiryDate: "2026-10-01", inquiryNumber: null, orderDate: null, orderNumber: null, confirmedAt: null, inquiry: "v_reseni", order: null },
  { number: "pozastavená bez objednávky", stage: "pozastaveno", source: "email", inquiryDate: "2026-10-01", inquiryNumber: null, orderDate: null, orderNumber: null, confirmedAt: null, inquiry: "v_reseni", order: null },
];
