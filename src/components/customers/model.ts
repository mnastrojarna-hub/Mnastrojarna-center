import type { JobStage } from "@/lib/supabase/database.types";
import { CLOSED_STAGES, isJobStage } from "@/lib/jobs/stages";
import { cleanNumber, one, searchNormalize } from "@/lib/jobs/mapping";

/**
 * Zákazníci (CRM) — view-modely, řádky DB → view, formulář, validace a filtry.
 * Čistá logika bez DB a Reactu (sdílí server, akce i klient; testy v model.test.ts).
 */

export interface PersonLite {
  id: string;
  name: string;
}

export interface CustomerView {
  id: string;
  /** Naše číslo zákazníka (ZK0001) — přiděluje DB. */
  customerNumber: string | null;
  name: string;
  ico: string | null;
  dic: string | null;
  street: string | null;
  city: string | null;
  zip: string | null;
  country: string;
  email: string | null;
  phone: string | null;
  contactPerson: string | null;
  website: string | null;
  paymentTermsDays: number | null;
  deliveryAddress: string | null;
  /** Naše číslo dodavatele u zákazníka (píše se na doklady). */
  supplierNumberAtCustomer: string | null;
  note: string | null;
  owner: PersonLite | null;
  /** Rozpracované zakázky (bez dokončených, nerealizovaných a zrušených). */
  activeJobs: number;
  totalJobs: number;
  /** Prodejní hodnota zakázek bez nerealizovaných a zrušených (bez DPH). */
  revenue: number;
  createdAt: string;
}

export interface ContactView {
  id: string;
  name: string;
  position: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

// ── Řádky DB ────────────────────────────────────────────────
type Embed<T> = T | T[] | null | undefined;

export interface CustomerRow {
  id: string;
  name: string;
  customer_number?: string | null;
  ico?: string | null;
  dic?: string | null;
  street?: string | null;
  city?: string | null;
  zip?: string | null;
  address?: string | null;
  country?: string | null;
  email?: string | null;
  phone?: string | null;
  contact_person?: string | null;
  website?: string | null;
  payment_terms_days?: number | string | null;
  delivery_address?: string | null;
  supplier_number_at_customer?: string | null;
  note?: string | null;
  owner_id?: string | null;
  created_at?: string | null;
  owner?: Embed<{ id: string; full_name: string | null; email?: string | null }>;
  jobs?: { status: string; value: number | string | null }[] | null;
}

export interface ContactRow {
  id: string;
  name: string;
  position?: string | null;
  email?: string | null;
  phone?: string | null;
  is_primary?: boolean | null;
}

/** Sloupce pro seznam i detail (vazby s nápovědou cizího klíče). */
export const CUSTOMER_SELECT = [
  "id, name, customer_number, ico, dic, street, city, zip, address, country, email, phone",
  "contact_person, website, payment_terms_days, delivery_address, supplier_number_at_customer",
  "note, owner_id, created_at",
  "owner:profiles!owner_id(id, full_name, email)",
  "jobs:orders!customer_id(status, value)",
].join(", ");

/** Zakázky, které se nepočítají do obratu. */
const LOST_STAGES: JobStage[] = ["nerealizovano", "zruseno"];

function text(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s ? s : null;
}

export function personLite(p: Embed<{ id: string; full_name: string | null; email?: string | null }>): PersonLite | null {
  const x = one(p);
  if (!x) return null;
  return { id: x.id, name: text(x.full_name) ?? text(x.email ?? null) ?? "Neznámý uživatel" };
}

export function rowToCustomerView(r: CustomerRow): CustomerView {
  let activeJobs = 0;
  let revenue = 0;
  const jobs = r.jobs ?? [];
  for (const j of jobs) {
    const stage = isJobStage(j.status) ? j.status : "poptavka";
    if (!CLOSED_STAGES.includes(stage)) activeJobs++;
    if (!LOST_STAGES.includes(stage)) revenue += cleanNumber(j.value) ?? 0;
  }
  const street = text(r.street);
  const city = text(r.city);
  const zip = text(r.zip);
  const days = cleanNumber(r.payment_terms_days);
  return {
    id: r.id,
    customerNumber: text(r.customer_number),
    name: r.name,
    ico: text(r.ico),
    dic: text(r.dic),
    // starší záznamy mají jen složenou adresu
    street: street ?? (!city && !zip ? text(r.address) : null),
    city,
    zip,
    country: text(r.country) ?? "CZ",
    email: text(r.email),
    phone: text(r.phone),
    contactPerson: text(r.contact_person),
    website: text(r.website),
    paymentTermsDays: days === null ? null : Math.round(days),
    deliveryAddress: text(r.delivery_address),
    supplierNumberAtCustomer: text(r.supplier_number_at_customer),
    note: text(r.note),
    owner: personLite(r.owner),
    activeJobs,
    totalJobs: jobs.length,
    revenue: Math.round(revenue * 100) / 100,
    createdAt: r.created_at ?? "",
  };
}

export function rowToContactView(r: ContactRow): ContactView {
  return {
    id: r.id,
    name: r.name,
    position: text(r.position),
    email: text(r.email),
    phone: text(r.phone),
    isPrimary: Boolean(r.is_primary),
  };
}

/** Hlavní kontakt nahoře, pak podle jména. */
export function sortContacts(list: ContactView[]): ContactView[] {
  return [...list].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name, "cs"));
}

/** „Ulice 1, 110 00 Praha" — jeden řádek adresy. */
export function addressLine(c: Pick<CustomerView, "street" | "city" | "zip">): string | null {
  const cityLine = [c.zip, c.city].filter(Boolean).join(" ");
  const parts = [c.street, cityLine].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** Odkaz na web (doplní https://). */
export function websiteHref(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(s)) return `https://${s}`;
  return null;
}

// ── Formulář ────────────────────────────────────────────────
export interface CustomerFormValues {
  name: string;
  customerNumber: string;
  ico: string;
  dic: string;
  street: string;
  city: string;
  zip: string;
  country: string;
  email: string;
  phone: string;
  contactPerson: string;
  website: string;
  paymentTermsDays: string;
  deliveryAddress: string;
  supplierNumberAtCustomer: string;
  note: string;
  /** uuid obchodníka nebo "" (bez obchodníka). */
  ownerId: string;
}

export type CustomerField = keyof CustomerFormValues;

export const EMPTY_CUSTOMER_FORM: CustomerFormValues = {
  name: "", customerNumber: "", ico: "", dic: "", street: "", city: "", zip: "", country: "CZ",
  email: "", phone: "", contactPerson: "", website: "", paymentTermsDays: "", deliveryAddress: "",
  supplierNumberAtCustomer: "", note: "", ownerId: "",
};

export function customerFormFromView(c: CustomerView): CustomerFormValues {
  return {
    name: c.name,
    customerNumber: c.customerNumber ?? "",
    ico: c.ico ?? "",
    dic: c.dic ?? "",
    street: c.street ?? "",
    city: c.city ?? "",
    zip: c.zip ?? "",
    country: c.country || "CZ",
    email: c.email ?? "",
    phone: c.phone ?? "",
    contactPerson: c.contactPerson ?? "",
    website: c.website ?? "",
    paymentTermsDays: c.paymentTermsDays === null ? "" : String(c.paymentTermsDays),
    deliveryAddress: c.deliveryAddress ?? "",
    supplierNumberAtCustomer: c.supplierNumberAtCustomer ?? "",
    note: c.note ?? "",
    ownerId: c.owner?.id ?? "",
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailLike(v: string): boolean {
  return EMAIL_RE.test(v.trim());
}

/** Splatnost ve dnech (0–365) nebo null; NaN = neplatné. */
export function parsePaymentDays(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const n = cleanNumber(s);
  if (n === null || !Number.isInteger(n) || n < 0 || n > 365) return Number.NaN;
  return n;
}

/** Chyby formuláře podle pole (prázdný objekt = v pořádku). */
export function validateCustomerForm(v: CustomerFormValues): Partial<Record<CustomerField, string>> {
  const errors: Partial<Record<CustomerField, string>> = {};
  const name = v.name.trim();
  if (name.length < 2) errors.name = "Zadej název firmy (aspoň 2 znaky).";
  else if (name.length > 300) errors.name = "Název je moc dlouhý (max. 300 znaků).";
  const ico = v.ico.replace(/\s/g, "");
  if (ico && !/^\d{5,12}$/.test(ico)) errors.ico = "IČO má jen číslice (obvykle 8).";
  if (v.email.trim() && !isEmailLike(v.email)) errors.email = "Tohle nevypadá jako e-mail.";
  if (Number.isNaN(parsePaymentDays(v.paymentTermsDays))) errors.paymentTermsDays = "Celý počet dní 0–365.";
  if (v.customerNumber.trim().length > 40) errors.customerNumber = "Číslo je moc dlouhé.";
  if (v.website.trim() && !websiteHref(v.website)) errors.website = "Zadej adresu webu (např. firma.cz).";
  return errors;
}

// ── Filtry seznamu ──────────────────────────────────────────
export type CustomerFilter = "vse" | "aktivni" | "moji" | "bez_zakazek";

export const CUSTOMER_FILTERS: { key: CustomerFilter; label: string }[] = [
  { key: "vse", label: "Všichni" },
  { key: "aktivni", label: "S rozpracovanou zakázkou" },
  { key: "moji", label: "Moji zákazníci" },
  { key: "bez_zakazek", label: "Bez zakázek" },
];

export function isCustomerFilter(v: unknown): v is CustomerFilter {
  return typeof v === "string" && CUSTOMER_FILTERS.some((f) => f.key === v);
}

export function customerHaystack(c: CustomerView): string {
  return searchNormalize([
    c.name, c.customerNumber, c.ico, c.dic, c.city, c.street, c.contactPerson, c.email, c.phone,
    c.owner?.name, c.supplierNumberAtCustomer,
  ].filter(Boolean).join(" "));
}

export function filterCustomers(
  list: CustomerView[],
  opts: { q?: string; filter?: CustomerFilter; userId?: string | null },
): CustomerView[] {
  const tokens = searchNormalize(opts.q ?? "").split(/\s+/).filter(Boolean);
  const filter = opts.filter ?? "vse";
  return list.filter((c) => {
    if (filter === "aktivni" && c.activeJobs === 0) return false;
    if (filter === "bez_zakazek" && c.totalJobs > 0) return false;
    if (filter === "moji" && (!opts.userId || c.owner?.id !== opts.userId)) return false;
    if (!tokens.length) return true;
    const h = customerHaystack(c);
    return tokens.every((t) => h.includes(t));
  });
}

/** Počty pro chipy filtru. */
export function customerFilterCounts(list: CustomerView[], userId?: string | null): Record<CustomerFilter, number> {
  return {
    vse: list.length,
    aktivni: list.filter((c) => c.activeJobs > 0).length,
    moji: userId ? list.filter((c) => c.owner?.id === userId).length : 0,
    bez_zakazek: list.filter((c) => c.totalJobs === 0).length,
  };
}

// ── Kontaktní osoby ─────────────────────────────────────────
export interface ContactFormValues {
  name: string;
  position: string;
  email: string;
  phone: string;
  isPrimary: boolean;
}

export const EMPTY_CONTACT_FORM: ContactFormValues = { name: "", position: "", email: "", phone: "", isPrimary: false };

export function contactFormFromView(c: ContactView): ContactFormValues {
  return { name: c.name, position: c.position ?? "", email: c.email ?? "", phone: c.phone ?? "", isPrimary: c.isPrimary };
}

export function validateContactForm(v: ContactFormValues): string | null {
  if (v.name.trim().length < 2) return "Zadej jméno kontaktní osoby.";
  if (v.name.trim().length > 200) return "Jméno je moc dlouhé.";
  if (v.email.trim() && !isEmailLike(v.email)) return "Tohle nevypadá jako e-mail.";
  return null;
}

/**
 * Adresa vybraná z našeptávače (pošta / adresář) → doplní prázdné jméno, pozici a telefon kontaktu.
 * Název firmy (návrh „zákazník" / „dodavatel") se za jméno osoby nebere.
 */
export function contactFromSuggestion<T extends Pick<ContactFormValues, "name" | "position" | "phone">>(
  cur: T,
  s: { name: string; email: string; kind: string; position?: string | null; phone?: string | null; company?: string | null },
): T {
  const personName = s.name !== s.email && s.kind !== "zákazník" && s.kind !== "dodavatel" && s.name !== s.company ? s.name : "";
  return {
    ...cur,
    name: cur.name.trim() || personName || cur.name,
    position: cur.position.trim() || s.position || "",
    phone: cur.phone.trim() || s.phone || "",
  };
}

/** Barevný kroužek s iniciálami — stálá barva podle jména. */
const AVATAR = [
  "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300",
  "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
];

export function avatarToneFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR[h % AVATAR.length];
}

/** Právní formy se do iniciál nepočítají („Strojmetal a.s." → „ST"). */
const LEGAL_FORMS = new Set(["sro", "as", "spol", "gmbh", "ks", "vos", "ag", "ltd", "sa", "se", "inc", "s", "r", "o", "a"]);

export function initialsOf(name: string): string {
  const parts = name
    .split(/[\s,&/\-]+/)
    .map((p) => p.replace(/[.()]/g, ""))
    .filter((p) => p && !LEGAL_FORMS.has(p.toLowerCase()));
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  const letters = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "");
  return letters.join("") || "?";
}
