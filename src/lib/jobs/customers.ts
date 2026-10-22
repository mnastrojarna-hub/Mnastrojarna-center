import "server-only";
import type { JobsDb } from "@/lib/jobs/events";
import { fetchPaged } from "@/lib/jobs/mapping";

/**
 * Dohledání / založení zákazníka pro zakázku (ruční zadání i čtení dokladů).
 * Pořadí shody: IČO (jen číslice) → DIČ → název (bez ohledu na velikost písmen).
 */

export interface CustomerLookupInput {
  name: string;
  ico?: string;
  dic?: string;
  email?: string;
  phone?: string;
  street?: string;
  city?: string;
  zip?: string;
  country?: string;
  contactPerson?: string;
  supplierNumberAtCustomer?: string;
  ownerId?: string | null;
}

export interface CustomerLookupRow {
  id: string;
  name: string;
  ico: string | null;
  dic: string | null;
}

/** IČO jen číslice (bez úvodních nul pro porovnání řeší compareIco). */
export function normalizeIco(v: string | null | undefined): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length >= 5 && d.length <= 12 ? d : null;
}

function icoKey(v: string | null | undefined): string | null {
  const d = normalizeIco(v);
  return d ? d.replace(/^0+/, "") || "0" : null;
}

/** DIČ: velká písmena, bez mezer a oddělovačů (CZ 123 45 678 → CZ12345678). */
export function normalizeDic(v: string | null | undefined): string | null {
  const s = String(v ?? "").toUpperCase().replace(/[\s.\-/]/g, "");
  return /^[A-Z]{0,3}\d{5,14}$/.test(s) ? s : null;
}

/** Název pro porovnání: malá písmena, jednotné mezery a „s. r. o." = „s.r.o.". */
export function normalizeCustomerName(v: string | null | undefined): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/\s*,\s*/g, " ")
    .replace(/\s*\.\s*/g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

const COUNTRY_ALIASES: Record<string, string> = {
  "cesko": "CZ", "ceska republika": "CZ", "czech republic": "CZ", "czechia": "CZ", "cr": "CZ",
  "slovensko": "SK", "slovakia": "SK", "slovenska republika": "SK",
  "nemecko": "DE", "germany": "DE", "deutschland": "DE",
  "rakousko": "AT", "austria": "AT", "osterreich": "AT",
  "polsko": "PL", "poland": "PL", "polska": "PL",
  "madarsko": "HU", "hungary": "HU",
  "italie": "IT", "italy": "IT",
  "francie": "FR", "france": "FR",
  "nizozemsko": "NL", "netherlands": "NL",
  "svycarsko": "CH", "switzerland": "CH",
};

/** Země jako kód ISO (CZ výchozí); neznámý název zůstane, jak je. */
export function normalizeCountry(v: string | null | undefined): string {
  const raw = String(v ?? "").trim();
  if (!raw) return "CZ";
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  const key = raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ");
  return COUNTRY_ALIASES[key] ?? raw.slice(0, 60);
}

/** Najde shodu v seznamu zákazníků (čistá logika). */
export function matchCustomer(
  rows: CustomerLookupRow[],
  input: Pick<CustomerLookupInput, "name" | "ico" | "dic">,
): { id: string; by: "ico" | "dic" | "name" } | null {
  const ico = icoKey(input.ico);
  if (ico) {
    const hit = rows.find((r) => icoKey(r.ico) === ico);
    if (hit) return { id: hit.id, by: "ico" };
  }
  const dic = normalizeDic(input.dic);
  if (dic) {
    const hit = rows.find((r) => normalizeDic(r.dic) === dic);
    if (hit) return { id: hit.id, by: "dic" };
  }
  const name = normalizeCustomerName(input.name);
  if (name) {
    const hit = rows.find((r) => {
      if (normalizeCustomerName(r.name) !== name) return false;
      // stejný název, ale jiné IČO = jiná firma
      const theirs = icoKey(r.ico);
      return !(ico && theirs && theirs !== ico);
    });
    if (hit) return { id: hit.id, by: "name" };
  }
  return null;
}

function clean(v: string | null | undefined, max = 300): string | null {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/** Sloupce zákazníka ze vstupu (prázdné vynechá). */
export function customerColumns(input: CustomerLookupInput): Record<string, string> {
  const cols: Record<string, string | null> = {
    ico: normalizeIco(input.ico),
    dic: normalizeDic(input.dic),
    email: clean(input.email, 200)?.toLowerCase() ?? null,
    phone: clean(input.phone, 60),
    street: clean(input.street),
    city: clean(input.city, 120),
    zip: clean(input.zip, 20),
    contact_person: clean(input.contactPerson, 200),
    supplier_number_at_customer: clean(input.supplierNumberAtCustomer, 120),
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(cols)) if (v) out[k] = v;
  return out;
}

/** Složená adresa do starého sloupce address („Ulice 1, 110 00 Praha"). */
export function composeAddress(input: Pick<CustomerLookupInput, "street" | "city" | "zip">): string | null {
  const cityLine = [clean(input.zip, 20), clean(input.city, 120)].filter(Boolean).join(" ");
  const parts = [clean(input.street), cityLine].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/**
 * Dohledá zákazníka (IČO → DIČ → název), u nalezeného doplní chybějící údaje,
 * jinak založí nového (customer_number přidělí DB). null = chyba / chybí název.
 */
export async function findOrCreateCustomer(
  db: JobsDb,
  input: CustomerLookupInput,
): Promise<{ id: string; created: boolean } | null> {
  try {
    const name = clean(input.name, 300);
    const { data: rows, error } = await fetchPaged<CustomerLookupRow>(
      (from, to) => db.from("customers").select("id, name, ico, dic").order("created_at").order("id").range(from, to),
      50_000,
    );
    if (error) {
      console.error(`[jobs:customer] Hledání zákazníka selhalo: ${error.message}`);
      return null;
    }
    const match = matchCustomer(rows, { name: name ?? "", ico: input.ico, dic: input.dic });
    const cols = customerColumns(input);

    if (match) {
      // doplnit jen prázdná pole — nic existujícího se nepřepisuje
      const { data: current } = await db
        .from("customers")
        .select("id, ico, dic, email, phone, street, city, zip, contact_person, supplier_number_at_customer")
        .eq("id", match.id)
        .maybeSingle();
      const cur = (current ?? {}) as Record<string, unknown>;
      const fill: Record<string, string> = {};
      for (const [k, v] of Object.entries(cols)) {
        const existing = cur[k];
        if (existing === null || existing === undefined || existing === "") fill[k] = v;
      }
      if (Object.keys(fill).length && current) {
        const { error: upErr } = await db.from("customers").update(fill as never).eq("id", match.id);
        if (upErr) console.error(`[jobs:customer] Doplnění údajů selhalo: ${upErr.message}`);
      }
      return { id: match.id, created: false };
    }

    if (!name) return null;
    const insert: Record<string, unknown> = {
      name,
      ...cols,
      country: normalizeCountry(input.country),
      address: composeAddress(input),
      owner_id: isUuid(input.ownerId) ? input.ownerId : null,
    };
    const { data: created, error: insErr } = await db
      .from("customers")
      .insert(insert as never)
      .select("id")
      .single();
    if (insErr || !created) {
      console.error(`[jobs:customer] Založení zákazníka selhalo: ${insErr?.message ?? "bez odpovědi"}`);
      return null;
    }
    return { id: (created as { id: string }).id, created: true };
  } catch (err) {
    console.error(`[jobs:customer] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
