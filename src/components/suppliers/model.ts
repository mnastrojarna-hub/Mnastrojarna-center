import { CLOSED_STAGES, isJobStage } from "@/lib/jobs/stages";
import { cleanNumber, searchNormalize } from "@/lib/jobs/mapping";

/**
 * Dodavatelé — view-modely, formulář (štítky technologií a materiálů, hvězdičky)
 * a filtry. Čistá logika bez DB a Reactu (testy v model.test.ts).
 */

export interface SupplierView {
  id: string;
  name: string;
  ico: string | null;
  dic: string | null;
  address: string | null;
  country: string;
  email: string | null;
  phone: string | null;
  contactPerson: string | null;
  website: string | null;
  technologies: string[];
  materials: string[];
  certifications: string[];
  leadDays: number | null;
  /** Hodnocení 1–5, null = nehodnoceno. */
  rating: number | null;
  note: string | null;
  /** Zakázky, kde je dodavatelem (rozpracované / všechny). */
  activeJobs: number;
  totalJobs: number;
  createdAt: string;
}

export interface SupplierRow {
  id: string;
  name: string;
  ico?: string | null;
  dic?: string | null;
  address?: string | null;
  country?: string | null;
  email?: string | null;
  phone?: string | null;
  contact_person?: string | null;
  website?: string | null;
  technologies?: string[] | null;
  materials?: string[] | null;
  certifications?: string[] | null;
  lead_days?: number | string | null;
  rating?: number | string | null;
  note?: string | null;
  created_at?: string | null;
  jobs?: { status: string }[] | null;
}

export const SUPPLIER_SELECT = [
  "id, name, ico, dic, address, country, email, phone, contact_person, website",
  "technologies, materials, certifications, lead_days, rating, note, created_at",
  "jobs:orders!supplier_id(status)",
].join(", ");

function text(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s ? s : null;
}

export function clampRating(v: unknown): number | null {
  const n = cleanNumber(v);
  if (n === null || n <= 0) return null;
  return Math.min(5, Math.max(1, Math.round(n)));
}

export function rowToSupplierView(r: SupplierRow): SupplierView {
  const jobs = r.jobs ?? [];
  const lead = cleanNumber(r.lead_days);
  return {
    id: r.id,
    name: r.name,
    ico: text(r.ico),
    dic: text(r.dic),
    address: text(r.address),
    country: text(r.country) ?? "CZ",
    email: text(r.email),
    phone: text(r.phone),
    contactPerson: text(r.contact_person),
    website: text(r.website),
    technologies: normalizeTags(r.technologies ?? []),
    materials: normalizeTags(r.materials ?? []),
    certifications: normalizeTags(r.certifications ?? []),
    leadDays: lead === null ? null : Math.round(lead),
    rating: clampRating(r.rating),
    note: text(r.note),
    activeJobs: jobs.filter((j) => !CLOSED_STAGES.includes(isJobStage(j.status) ? j.status : "poptavka")).length,
    totalJobs: jobs.length,
    createdAt: r.created_at ?? "",
  };
}

// ── Štítky (technologie, materiály, certifikace) ─────────────
export const MAX_TAGS = 40;
export const MAX_TAG_LENGTH = 60;

/** Ořízne, odstraní prázdné a duplicity (bez ohledu na velikost písmen). */
export function normalizeTags(list: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const s = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TAG_LENGTH);
    if (!s) continue;
    const key = s.toLocaleLowerCase("cs");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** Text „Kalení, frézování; 5osé" → štítky (čárka, středník, nový řádek). */
export function parseTags(input: string): string[] {
  return normalizeTags(input.split(/[,;\n]+/));
}

/** Přidá štítky z rozepsaného textu (může jich být víc oddělených čárkou). */
export function addTags(list: readonly string[], input: string): string[] {
  return normalizeTags([...list, ...parseTags(input)]);
}

export function removeTag(list: readonly string[], tag: string): string[] {
  return list.filter((t) => t !== tag);
}

/** Návrhy pro našeptávač — štítky ostatních dodavatelů seřazené podle četnosti. */
export function tagSuggestions(suppliers: readonly SupplierView[], key: "technologies" | "materials" | "certifications"): string[] {
  const counts = new Map<string, { label: string; n: number }>();
  for (const s of suppliers) {
    for (const t of s[key]) {
      const k = t.toLocaleLowerCase("cs");
      const cur = counts.get(k);
      if (cur) cur.n++;
      else counts.set(k, { label: t, n: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, "cs")).map((x) => x.label);
}

// ── Formulář ────────────────────────────────────────────────
export interface SupplierFormValues {
  name: string;
  ico: string;
  dic: string;
  address: string;
  country: string;
  email: string;
  phone: string;
  contactPerson: string;
  website: string;
  technologies: string[];
  materials: string[];
  certifications: string[];
  leadDays: string;
  /** 0 = nehodnoceno, jinak 1–5. */
  rating: number;
  note: string;
}

export type SupplierField = keyof SupplierFormValues;

export const EMPTY_SUPPLIER_FORM: SupplierFormValues = {
  name: "", ico: "", dic: "", address: "", country: "CZ", email: "", phone: "", contactPerson: "", website: "",
  technologies: [], materials: [], certifications: [], leadDays: "", rating: 0, note: "",
};

export function supplierFormFromView(s: SupplierView): SupplierFormValues {
  return {
    name: s.name,
    ico: s.ico ?? "",
    dic: s.dic ?? "",
    address: s.address ?? "",
    country: s.country || "CZ",
    email: s.email ?? "",
    phone: s.phone ?? "",
    contactPerson: s.contactPerson ?? "",
    website: s.website ?? "",
    technologies: [...s.technologies],
    materials: [...s.materials],
    certifications: [...s.certifications],
    leadDays: s.leadDays === null ? "" : String(s.leadDays),
    rating: s.rating ?? 0,
    note: s.note ?? "",
  };
}

/** Dodací lhůta ve dnech (0–730) nebo null; NaN = neplatné. */
export function parseLeadDays(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const n = cleanNumber(s);
  if (n === null || !Number.isInteger(n) || n < 0 || n > 730) return Number.NaN;
  return n;
}

export function validateSupplierForm(v: SupplierFormValues): Partial<Record<SupplierField, string>> {
  const errors: Partial<Record<SupplierField, string>> = {};
  const name = v.name.trim();
  if (name.length < 2) errors.name = "Zadej název dodavatele (aspoň 2 znaky).";
  else if (name.length > 300) errors.name = "Název je moc dlouhý (max. 300 znaků).";
  const ico = v.ico.replace(/\s/g, "");
  if (ico && !/^\d{5,12}$/.test(ico)) errors.ico = "IČO má jen číslice (obvykle 8).";
  if (v.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) errors.email = "Tohle nevypadá jako e-mail.";
  if (Number.isNaN(parseLeadDays(v.leadDays))) errors.leadDays = "Celý počet dní 0–730.";
  if (!Number.isInteger(v.rating) || v.rating < 0 || v.rating > 5) errors.rating = "Hodnocení 1–5 hvězdiček.";
  return errors;
}

// ── Filtry seznamu ──────────────────────────────────────────
export function supplierHaystack(s: SupplierView): string {
  return searchNormalize([
    s.name, s.ico, s.dic, s.address, s.contactPerson, s.email, s.phone,
    ...s.technologies, ...s.materials, ...s.certifications,
  ].filter(Boolean).join(" "));
}

export function filterSuppliers(
  list: SupplierView[],
  opts: { q?: string; technology?: string | null; minRating?: number },
): SupplierView[] {
  const tokens = searchNormalize(opts.q ?? "").split(/\s+/).filter(Boolean);
  const tech = opts.technology ? opts.technology.toLocaleLowerCase("cs") : null;
  return list.filter((s) => {
    if (tech && !s.technologies.some((t) => t.toLocaleLowerCase("cs") === tech)) return false;
    if (opts.minRating && (s.rating ?? 0) < opts.minRating) return false;
    if (!tokens.length) return true;
    const h = supplierHaystack(s);
    return tokens.every((t) => h.includes(t));
  });
}

/** Barva štítku technologie — stálá podle textu (stejná technologie = stejná barva). */
const TAG_TONES = [
  "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
  "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300",
  "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300",
  "bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300",
  "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-300",
  "bg-lime-100 text-lime-800 dark:bg-lime-500/15 dark:text-lime-300",
];

export function tagTone(tag: string): string {
  const key = searchNormalize(tag);
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return TAG_TONES[h % TAG_TONES.length];
}
