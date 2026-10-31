/**
 * ARES (Administrativní registr ekonomických subjektů, ares.gov.cz, REST API v3) — čistá logika:
 * kontrola IČO (kontrolní číslice), převod odpovědi na údaje firmy pro adresář (název, IČO, DIČ, sídlo)
 * a výběr shody při hledání podle názvu. Síť a testovací háček: ares-server.ts. Testy: ares.test.ts.
 */

export interface AresCompany {
  /** IČO, 8 číslic. */
  ico: string;
  /** Obchodní jméno přesně podle registru. */
  name: string;
  /** DIČ (CZ…), null = registr ho neuvádí (neplátce DPH). */
  dic: string | null;
  /** Ulice a číslo („Varšavská 715/36"; bez ulice „Kamenice 66"). */
  street: string | null;
  /** Obec pro poštu („Praha 2", „Brno"). */
  city: string | null;
  /** PSČ ve tvaru „120 00". */
  zip: string | null;
  /** Kód země ISO (CZ). */
  country: string;
  /** Jednořádková adresa (ulice, PSČ obec). */
  address: string | null;
  /** Firma v registru zanikla. */
  defunct: boolean;
  /** Datum zániku RRRR-MM-DD. */
  defunctDate: string | null;
}

export interface AresSearchResult {
  total: number;
  items: AresCompany[];
}

type Row = Record<string, unknown>;

const obj = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const txt = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "");

/** Číslice IČO doplněné nulami zleva na 8 (ARES vede i stará šestimístná). null = nejde o IČO. */
export function icoDigits(v: unknown): string | null {
  const d = String(v ?? "").replace(/[\s ]/g, "").replace(/^(CZ|IČO?:?|ICO:?)/i, "");
  if (!/^\d{1,8}$/.test(d)) return null;
  const padded = d.padStart(8, "0");
  return /^0+$/.test(padded) ? null : padded;
}

/** České IČO s platnou kontrolní číslicí (vážený součet mod 11). */
export function isValidIco(v: unknown): boolean {
  const d = icoDigits(v);
  if (!d) return false;
  let sum = 0;
  for (let i = 0; i < 7; i += 1) sum += Number(d[i]) * (8 - i);
  const check = (11 - (sum % 11)) % 10;
  return check === Number(d[7]);
}

/** PSČ „12000" / 12000 → „120 00". null = není PSČ. */
export function formatZip(v: unknown): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  if (d.length !== 5) return null;
  return `${d.slice(0, 3)} ${d.slice(3)}`;
}

/** „Varšavská 715/36, Vinohrady, 12000 Praha 2" → poslední část s PSČ (PSČ a obec). */
function parsePostalLine(text: string): { zip: string; city: string } | null {
  const parts = text.split(",").map((s) => s.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const m = /^(\d{3}\s?\d{2})\s+(.+)$/.exec(parts[i]);
    if (m) return { zip: formatZip(m[1]) ?? m[1], city: m[2].trim() };
  }
  return null;
}

function houseNumber(s: Row): string {
  const cd = txt(s.cisloDomovni);
  const co = txt(s.cisloOrientacni);
  const coLetter = txt(s.cisloOrientacniPismeno);
  const evidencni = Number(s.typCisloDomovni) === 2;
  const base = cd ? (evidencni ? `č. ev. ${cd}` : cd) : "";
  const orient = co ? `${co}${coLetter}` : "";
  if (base && orient) return `${base}/${orient}`;
  return base || orient;
}

/** Sídlo z ARES → ulice, obec, PSČ, země (strukturované údaje, jinak rozbor textové adresy). */
export function aresAddress(raw: unknown): Pick<AresCompany, "street" | "city" | "zip" | "country" | "address"> {
  const s = obj(raw);
  const country = (txt(s.kodStatu) || "CZ").toUpperCase().slice(0, 2);
  const textAddr = txt(s.textovaAdresa);
  const postal = textAddr ? parsePostalLine(textAddr) : null;
  const number = houseNumber(s);
  const streetName = txt(s.nazevUlice);
  const place = txt(s.nazevCastiObce) || txt(s.nazevObce);
  let street: string | null = null;
  if (streetName) street = number ? `${streetName} ${number}` : streetName;
  else if (number && place) street = `${place} ${number}`;
  else if (textAddr) {
    const first = textAddr.split(",")[0]?.trim() ?? "";
    street = first && !/^\d{3}\s?\d{2}\s/.test(first) ? first : null;
  }
  const zip = formatZip(s.psc) ?? postal?.zip ?? null;
  const district = txt(s.nazevMestskehoObvodu);
  const obec = txt(s.nazevObce);
  // obec pro poštu: z textové adresy („Praha 2", „Brno"); jinak městský obvod Prahy, jinak obec
  const city = postal?.city || (district && obec && district.startsWith(obec) ? district : obec) || null;
  const cityLine = [zip, city].filter(Boolean).join(" ");
  const address = [street, cityLine].filter(Boolean).join(", ") || textAddr || null;
  return { street, city, zip, country, address };
}

/** Odpověď /ekonomicke-subjekty/{ico} (i položka výsledku hledání) → firma. null = neplatná data. */
export function parseAresSubject(raw: unknown): AresCompany | null {
  const r = obj(raw);
  const ico = icoDigits(r.ico);
  const name = txt(r.obchodniJmeno);
  if (!ico || !name) return null;
  const dicRaw = txt(r.dic).toUpperCase().replace(/\s/g, "");
  const dic = /^[A-Z]{2}\d{8,10}$/.test(dicRaw) ? dicRaw : null;
  const zanik = txt(r.datumZaniku);
  return {
    ico,
    name,
    dic,
    ...aresAddress(r.sidlo),
    defunct: Boolean(zanik),
    defunctDate: /^\d{4}-\d{2}-\d{2}/.test(zanik) ? zanik.slice(0, 10) : null,
  };
}

/** Odpověď POST /ekonomicke-subjekty/vyhledat → seznam firem. */
export function parseAresSearch(raw: unknown): AresSearchResult {
  const r = obj(raw);
  const list = Array.isArray(r.ekonomickeSubjekty) ? r.ekonomickeSubjekty : [];
  const items = list.map(parseAresSubject).filter((x): x is AresCompany => Boolean(x));
  const total = typeof r.pocetCelkem === "number" && Number.isFinite(r.pocetCelkem) ? r.pocetCelkem : items.length;
  return { total, items };
}

const LEGAL_FORMS = [
  "spol s r o", "spol s ro", "s r o", "sro", "a s", "as", "k s", "ks", "v o s", "vos", "z s", "zs", "o p s", "ops",
  "s p", "druzstvo", "gmbh", "co kg", "kg", "ag", "ltd", "limited", "inc", "llc", "sp z o o", "spolka akcyjna", "sa", "bv", "nv", "srl", "spa",
];

/** Název pro porovnání: bez diakritiky, interpunkce a právní formy („ČEZ, a. s." → „cez"). */
export function companyNameKey(v: unknown): string {
  let s = String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " a ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let changed = true;
  while (changed && s) {
    changed = false;
    for (const form of LEGAL_FORMS) {
      if (s === form) continue;
      if (s.endsWith(` ${form}`)) {
        s = s.slice(0, -form.length - 1).trim();
        changed = true;
      }
    }
  }
  return s;
}

/**
 * Výběr firmy z výsledku hledání podle názvu z dokladu: jistá shoda = stejný název (bez právní formy),
 * víc stejných → rozhodne PSČ / obec; jediný výsledek se podobným názvem také. Jinak `pick` null
 * a `candidates` k výběru (zaniklé firmy jen když nic jiného není).
 */
export function pickAresByName(
  items: AresCompany[],
  input: { name: string; zip?: string | null; city?: string | null },
): { pick: AresCompany | null; candidates: AresCompany[] } {
  const key = companyNameKey(input.name);
  const live = items.filter((c) => !c.defunct);
  const pool = live.length ? live : items;
  const zip = String(input.zip ?? "").replace(/\D/g, "");
  const city = companyNameKey(input.city);
  const byPlace = (list: AresCompany[]) => {
    if (list.length <= 1) return list;
    const z = zip.length === 5 ? list.filter((c) => (c.zip ?? "").replace(/\D/g, "") === zip) : [];
    if (z.length) return z;
    const ct = city ? list.filter((c) => companyNameKey(c.city).startsWith(city) || city.startsWith(companyNameKey(c.city))) : [];
    return ct.length ? ct : list;
  };
  const exact = key ? pool.filter((c) => companyNameKey(c.name) === key) : [];
  const exactPlaced = byPlace(exact);
  let pick: AresCompany | null = exactPlaced.length === 1 ? exactPlaced[0] : null;
  if (!pick && !exact.length && key && pool.length === 1) {
    const other = companyNameKey(pool[0].name);
    if (other && (other.includes(key) || key.includes(other))) pick = pool[0];
  }
  const rest = pool.filter((c) => !exact.includes(c));
  const candidates = [...exact, ...rest].slice(0, 6);
  return { pick, candidates };
}
