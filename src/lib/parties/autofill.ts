import { normalizeTags, type SupplierField, type SupplierFormValues } from "@/components/suppliers/model";
import type { CustomerField, CustomerFormValues } from "@/components/customers/model";
import { draftAddRole, emptyDraftContact, type BookDraft } from "@/lib/contacts/book-draft";
import { normEmail } from "@/lib/contacts/roles";
import type { AresCompany } from "@/lib/ares/ares";
import type { PartyAutofillData } from "@/lib/parties/autofill-types";
import type { PartyContactExtract, PartyRoleEmailExtract } from "@/lib/parties/party-extract";

/**
 * Výsledek „Vyplnit z dokladu" / „ARES" → formulář zákazníka / dodavatele a jeho kontakty.
 * Nový záznam: co AI / ARES našla, přepíše (formulář je rozpracovaný návrh). Úprava existujícího:
 * doplní jen prázdná pole — nic, co už v adresáři je, se tiše nepřepíše. Klik na „ARES" (výslovný
 * požadavek) přepíše úřední údaje vždy. Čistá logika — testy v autofill.test.ts.
 */

export type FillMode = "new" | "edit";

/** Odkud pole formuláře je (zvýraznění). */
export type FilledFrom = "ai" | "ares";

export const CUSTOMER_FIELD_LABELS: Partial<Record<CustomerField, string>> = {
  name: "název", ico: "IČO", dic: "DIČ", street: "ulice", city: "město", zip: "PSČ", country: "země",
  email: "e-mail", phone: "telefon", website: "web", paymentTermsDays: "splatnost",
  supplierNumberAtCustomer: "naše číslo dodavatele", deliveryAddress: "dodací adresa",
};

export const SUPPLIER_FIELD_LABELS: Partial<Record<SupplierField, string>> = {
  name: "název", ico: "IČO", dic: "DIČ", address: "adresa", country: "země", email: "e-mail", phone: "telefon",
  website: "web", technologies: "technologie", materials: "materiály", certifications: "certifikace",
};

/** „Ulice 1, 120 00 Praha" (jako composeAddress na serveru — tenhle modul běží v prohlížeči). */
function oneLineAddress(street: string, city: string, zip: string): string {
  const cityLine = [zip.trim(), city.trim()].filter(Boolean).join(" ");
  return [street.trim(), cityLine].filter(Boolean).join(", ");
}

type Patch<F extends string> = Partial<Record<F, string | string[]>>;

function applyPatch<V extends object, F extends keyof V & string>(
  values: V,
  patch: Patch<F>,
  mode: FillMode,
  from: (k: F) => FilledFrom,
): { values: V; filled: Partial<Record<F, FilledFrom>> } {
  const next = { ...values };
  const filled: Partial<Record<F, FilledFrom>> = {};
  for (const [k, v] of Object.entries(patch) as [F, string | string[]][]) {
    const cur = next[k];
    if (Array.isArray(v)) {
      const list = Array.isArray(cur) ? (cur as string[]) : [];
      const merged = normalizeTags([...list, ...v]);
      if (merged.length !== list.length) {
        next[k] = merged as V[F];
        filled[k] = from(k);
      }
      continue;
    }
    const value = (v ?? "").trim();
    if (!value) continue;
    const current = typeof cur === "string" ? cur.trim() : "";
    if (current === value) continue;
    if (mode === "edit" && current) continue;
    next[k] = value as V[F];
    filled[k] = from(k);
  }
  return { values: next, filled };
}

/** Výsledek dokladu → formulář zákazníka. */
export function applyToCustomerForm(values: CustomerFormValues, data: PartyAutofillData, mode: FillMode) {
  const f = data.fields;
  const patch: Patch<CustomerField> = {
    name: f.name, ico: f.ico, dic: f.dic, street: f.street, city: f.city, zip: f.zip, country: f.country,
    email: data.email, phone: data.phone, website: data.website,
    paymentTermsDays: data.paymentTermsDays ? String(data.paymentTermsDays) : "",
    supplierNumberAtCustomer: data.supplierNumberAtCustomer,
    deliveryAddress: data.deliveryAddress,
  };
  return applyPatch(values, patch, mode, (k) => (data.sources[k as keyof typeof data.sources] === "ares" ? "ares" : "ai"));
}

/** Výsledek dokladu → formulář dodavatele (adresa je jeden řádek). */
export function applyToSupplierForm(values: SupplierFormValues, data: PartyAutofillData, mode: FillMode) {
  const f = data.fields;
  const patch: Patch<SupplierField> = {
    name: f.name, ico: f.ico, dic: f.dic,
    address: oneLineAddress(f.street, f.city, f.zip),
    country: f.country, email: data.email, phone: data.phone, website: data.website,
    technologies: data.technologies, materials: data.materials, certifications: data.certifications,
  };
  const s = data.sources;
  return applyPatch(values, patch, mode, (k) => {
    if (k === "address") return s.street === "ares" || s.city === "ares" ? "ares" : "ai";
    return s[k as keyof typeof s] === "ares" ? "ares" : "ai";
  });
}

/** Klik na „ARES" / výběr kandidáta: úřední údaje z registru (přepíše je i u existujícího záznamu). */
export function applyAresToCustomerForm(values: CustomerFormValues, c: AresCompany) {
  const patch: Patch<CustomerField> = {
    name: c.name, ico: c.ico, dic: c.dic ?? "", street: c.street ?? "", city: c.city ?? "", zip: c.zip ?? "", country: c.country,
  };
  return applyPatch(values, patch, "new", () => "ares");
}

export function applyAresToSupplierForm(values: SupplierFormValues, c: AresCompany) {
  const patch: Patch<SupplierField> = {
    name: c.name, ico: c.ico, dic: c.dic ?? "", address: c.address ?? "", country: c.country,
  };
  return applyPatch(values, patch, "new", () => "ares");
}

// ── Kontaktní osoby a „Kam posílat" ─────────────────────────
const blank = (c: { name: string; position: string; email: string; phone: string }) =>
  !c.name.trim() && !c.position.trim() && !c.email.trim() && !c.phone.trim();

const nameKey = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Přečtené osoby a e-maily podle účelu → koncept adresáře v dialogu. Osoba se stejným e-mailem / jménem
 * se doplní (jen prázdná pole), jinak přibude; prázdné nové řádky zmizí. Účel ukáže na osobu, má-li
 * stejný e-mail, jinak je to samotná adresa.
 */
export function mergeContactsIntoDraft(
  draft: BookDraft,
  contacts: PartyContactExtract[],
  roleEmails: PartyRoleEmailExtract[],
): { draft: BookDraft; addedContacts: number; addedRoles: number } {
  let d: BookDraft = { ...draft, contacts: draft.contacts.filter((c) => c.id || !blank(c)) };
  let addedContacts = 0;
  for (const c of contacts) {
    const email = normEmail(c.email) ?? "";
    const hit = d.contacts.find((x) => (email && normEmail(x.email) === email) || (c.name && nameKey(x.name) === nameKey(c.name)));
    if (hit) {
      d = {
        ...d,
        contacts: d.contacts.map((x) => (x.key !== hit.key ? x : {
          ...x,
          name: x.name.trim() || c.name,
          position: x.position.trim() || c.position,
          email: x.email.trim() || email,
          phone: x.phone.trim() || c.phone,
        })),
      };
      continue;
    }
    const row = { ...emptyDraftContact(!d.contacts.some((x) => x.isPrimary)), name: c.name, position: c.position, email, phone: c.phone };
    d = { ...d, contacts: [...d.contacts, row] };
    addedContacts += 1;
  }
  let addedRoles = 0;
  for (const r of roleEmails) {
    const person = d.contacts.find((x) => normEmail(x.email) === r.email);
    const res = draftAddRole(d, r.role, person ? { contactId: person.key } : { email: r.email });
    if ("draft" in res) {
      d = res.draft;
      addedRoles += 1;
    }
  }
  if (!d.contacts.length) d = { ...d, contacts: [emptyDraftContact(true)] };
  return { draft: d, addedContacts, addedRoles };
}

/** Česká věta „Vyplněno: název, IČO, … a 2 kontakty". */
export function filledSummary(labels: string[], addedContacts: number, addedRoles: number): string {
  const parts = [...labels];
  if (addedContacts) parts.push(addedContacts === 1 ? "1 kontaktní osoba" : addedContacts < 5 ? `${addedContacts} kontaktní osoby` : `${addedContacts} kontaktních osob`);
  if (addedRoles) parts.push(addedRoles === 1 ? "1 e-mail podle účelu" : `${addedRoles} e-maily podle účelu`);
  if (!parts.length) return "Nic nového — vše už bylo vyplněné.";
  return `Vyplněno: ${parts.join(", ")}.`;
}
