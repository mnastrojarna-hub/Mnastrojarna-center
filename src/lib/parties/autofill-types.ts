import type { AresCompany } from "@/lib/ares/ares";
import type { PartyKind } from "@/lib/contacts/roles";
import type {
  AresStatus, PartyCompanyFields, PartyContactExtract, PartyFieldSource, PartyRoleEmailExtract,
} from "@/lib/parties/party-extract";

/** Existující firma v adresáři se stejným IČO / DIČ / názvem. */
export interface PartyDuplicate {
  id: string;
  /** „ZK0012 KOVO Novák s.r.o." */
  label: string;
  by: "ico" | "dic" | "name";
}

/** Výsledek „Vyplnit z dokladu" — jen návrh pro formulář, nic se neukládá. */
export interface PartyAutofillData {
  kind: PartyKind;
  fields: PartyCompanyFields;
  sources: Partial<Record<keyof PartyCompanyFields, PartyFieldSource>>;
  email: string;
  phone: string;
  website: string;
  contacts: PartyContactExtract[];
  roleEmails: PartyRoleEmailExtract[];
  paymentTermsDays: number | null;
  supplierNumberAtCustomer: string;
  deliveryAddress: string;
  technologies: string[];
  materials: string[];
  certifications: string[];
  ares: { status: AresStatus; message: string; candidates: AresCompany[] };
  duplicate: PartyDuplicate | null;
  summary: string;
  documentKind: string;
  confidence: number;
  /** Co ověřit (AI + ARES). */
  warnings: string[];
}

export type PartyAutofillResponse = ({ ok: true } & PartyAutofillData) | { ok: false; error: string };

/** ARES podle IČO z dialogu (+ kontrola, jestli firma v adresáři už není). */
export type AresLookupResponse =
  | { ok: true; company: AresCompany; duplicate: PartyDuplicate | null }
  | { ok: false; error: string; reason?: string };
