// Kontrakt pro „Vyfoť doklad → AI vyplní zakázku" (čtení dokladu, párování, výsledek).
import type { JobStage, JobFileKind } from "@/lib/supabase/database.types";

/** Druh obchodního dokladu rozpoznaný na fotce / v PDF. */
export type CaptureDocKind =
  | "poptavka" | "nabidka" | "objednavka" | "potvrzeni" | "dodaci_list" | "faktura" | "vykres" | "ostatni";

/** Kdo doklad vystavil (rozhoduje o významu čísel a o posunu stavu). */
export type DocIssuer = "zakaznik" | "my" | "dodavatel" | "neznamy";

export interface ExtractedParty {
  name: string;
  ico: string;
  dic: string;
  street: string;
  city: string;
  zip: string;
  country: string;
  email: string;
  phone: string;
  contactPerson: string;
}

export interface ExtractedItem {
  drawingNumber: string;
  revision: string;
  name: string;
  description: string;
  material: string;
  quantity: number;
  unit: string;
  /** Cena / MJ bez DPH (0 = neuvedeno). */
  unitPrice: number;
  /** Termín u položky (RRRR-MM-DD, prázdné = neuvedeno). */
  deliveryDate: string;
}

/** Jednotka strukturované dodací lhůty z AI. */
export type ExtractedLeadUnit = "dny" | "pracovni_dny" | "tydny" | "mesice";
/** Od čeho dodací lhůta běží („jine" = od něčeho jiného, např. zaplacení zálohy — lhůta se nepoužije). */
export type ExtractedLeadFrom = "objednavka" | "potvrzeni" | "podklady" | "jine";

/**
 * Strukturovaná DODACÍ / výrobní lhůta z nabídky (naší i dodavatelské) a potvrzení — nikdy platnost nabídky,
 * splatnost, záruka, skonto ani reklamační lhůta. value 0 = jen text (čte se jako dodací pole).
 */
export interface ExtractedLeadTime {
  /** Počet jednotek (u rozpětí horní mez), 0 = neuvedeno. */
  value: number;
  unit: ExtractedLeadUnit;
  from: ExtractedLeadFrom | null;
  /** Doslovný úsek dokladu („4 týdny od objednávky"). */
  text: string;
}

/** Výstup AI čtení dokladu. Prázdný řetězec / 0 = na dokladu neuvedeno. */
export interface ExtractedBusinessDoc {
  docKind: CaptureDocKind;
  issuer: DocIssuer;
  /** Číslo dokladu dle vystavitele. */
  documentNumber: string;
  /** Datum dokladu RRRR-MM-DD. */
  documentDate: string;
  /** Odběratel = náš zákazník. */
  customer: ExtractedParty;
  /** Dodavatel / kooperant (u dokladů od dodavatele). */
  supplier: ExtractedParty;
  customerOrderNumber: string;
  customerInquiryNumber: string;
  /** Naše číslo nabídky, na které se doklad odkazuje (NAB-2026-031). */
  ourQuoteNumber: string;
  /** Naše číslo zakázky (Z-2026-014). */
  ourJobNumber: string;
  ourOrderConfirmationNumber: string;
  /** „Číslo dodavatele" — pod jakým číslem nás zákazník vede. */
  supplierNumberAtCustomer: string;
  /** Požadovaný termín dodání (zákazník). */
  requiredDeliveryDate: string;
  /** Slíbený / potvrzený termín (my nebo dodavatel). */
  promisedDeliveryDate: string;
  items: ExtractedItem[];
  totalWithoutVat: number;
  currency: string;
  paymentTerms: string;
  deliveryTerms: string;
  /** Strukturovaná dodací lhůta (nabídka, potvrzení), null = neuvedena. */
  deliveryLeadTime: ExtractedLeadTime | null;
  note: string;
  summary: string;
  confidence: number;
  needsClarification: string[];
  /** Adresy s účelem („faktury zasílejte na …") → e-maily podle účelu u zákazníka / dodavatele. */
  roleEmails?: ExtractedRoleEmail[];
}

export interface ExtractedRoleEmail {
  party: "customer" | "supplier";
  role: "fakturace" | "nakup" | "dodaci_listy" | "nabidky" | "komunikace";
  email: string;
}

/** Zakázka jako kandidát pro párování dokladu (načítá datová vrstva, páruje čistá logika). */
export interface JobMatchCandidate {
  id: string;
  number: string;
  title: string;
  stage: JobStage;
  createdAt: string;
  customerId: string | null;
  customerName: string | null;
  customerIco: string | null;
  customerDic: string | null;
  /** E-maily zákazníka a kontaktů (pro párování podle domény). */
  customerEmails: string[];
  customerOrderNumber: string | null;
  customerInquiryNumber: string | null;
  /** Čísla všech nabídek zakázky (i archivovaných verzí). */
  quoteNumbers: string[];
  /** Čísla výkresů z položek zakázky a nabídek. */
  drawingNumbers: string[];
}

/** Zákazník jako kandidát pro párování. */
export interface CustomerMatchCandidate {
  id: string;
  name: string;
  ico: string | null;
  dic: string | null;
  email: string | null;
  /** E-maily kontaktních osob. */
  contactEmails: string[];
  customerNumber: string | null;
  supplierNumberAtCustomer: string | null;
}

/** Kandidát párování (zobrazí se uživateli jako „možná patří k…"). */
export interface CaptureAlternative {
  jobId: string;
  jobNumber: string;
  title: string;
  customerName: string | null;
  score: number;
  reason: string;
}

/** Výsledek nahrání dokladu do Knihy zakázek. */
export interface CaptureResult {
  ok: boolean;
  error?: string;
  jobId?: string;
  jobNumber?: string;
  /** Nově založená zakázka (nic nesedělo). */
  created: boolean;
  /** Lidsky čitelný důvod párování („podle čísla nabídky NAB-2026-031"). */
  matchedBy?: string;
  matchScore?: number;
  customerId?: string;
  customerName?: string;
  customerCreated?: boolean;
  fileId?: string;
  fileKind?: JobFileKind;
  docKind?: CaptureDocKind;
  /** false = AI pro uživatele není povolené / nastavené → vyplní se ručně. */
  aiUsed: boolean;
  /** Doplněná pole (české popisky). */
  filled: string[];
  stageFrom?: JobStage;
  stageTo?: JobStage;
  itemsAdded?: number;
  confidence?: number;
  summary?: string;
  needsClarification?: string[];
  alternatives?: CaptureAlternative[];
  /** Vystavitel dokladu (po kontrole člověkem). */
  issuer?: DocIssuer;
  /** Popisek druhu dokladu („Objednávka zákazníka"). */
  docLabel?: string;
  /** Všechny uložené stránky dokladu (první = hlavní dokument). */
  fileIds?: string[];
  /** Doplněné existující položky. */
  itemsMerged?: number;
  /** Uloženo bez kontroly (režim plné automatiky). */
  autoApplied?: boolean;
  /** Dílčí problémy, které uložení neshodily (např. nepřiložená stránka). */
  warnings?: string[];
  /** Co doklad udělal s podrobnými stavy (revize objednávky, rozpor, dodáno částečně…). */
  flowNotes?: string[];
  /** Doklad šel do Faktur dodavatelů (ne do zakázky); id jen s právem na faktury dodavatelů. */
  supplierInvoice?: { id: string | null };
}

/** Mapování druhu dokladu na druh souboru zakázky. */
export const DOC_KIND_TO_FILE_KIND: Record<CaptureDocKind, JobFileKind> = {
  poptavka: "poptavka",
  nabidka: "nabidka",
  objednavka: "objednavka",
  potvrzeni: "potvrzeni",
  dodaci_list: "dodaci_list",
  faktura: "faktura",
  vykres: "vykres",
  ostatni: "ostatni",
};

export const DOC_KIND_LABEL: Record<CaptureDocKind, string> = {
  poptavka: "Poptávka",
  nabidka: "Nabídka",
  objednavka: "Objednávka",
  potvrzeni: "Potvrzení objednávky",
  dodaci_list: "Dodací list",
  faktura: "Faktura",
  vykres: "Výkres",
  ostatni: "Jiný doklad",
};
