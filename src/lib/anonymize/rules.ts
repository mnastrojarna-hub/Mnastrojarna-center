/**
 * Deterministická pravidla anonymizace (čisté funkce — běží vždy, i bez AI).
 * Vstup: řádky textu (z PDF textové vrstvy, OCR fotky, DXF/STEP literály) se zónou.
 * Výstup: zásahy (rozsah znaků v řádku + kategorie), keep pole a příznaky pro review.
 *
 * Zásady (spec §2.1):
 *  - cesty, kontakty, vlastní termíny a CRM termíny se mažou KDEKOLI,
 *  - právní forma / jména osob / doložka jen v razítku, rámu a tabulce revizí (jinde jen kandidát pro AI),
 *  - technické tokeny (normy, materiály, lícování, kóty, data…) jsou výjimka jen pro „company"
 *    z právní formy a pro AI kandidáty — NIKDY neruší custom ani termíny z CRM.
 */

import { escapeRegExp, mapRangeBack, normalizeWithMap, normalizeText, type NormText } from "./text";
import type { AnonCategory, AnonWarning, Box, KeepField, LineHit, TextLine, Zone } from "./types";

// ── Diakritika: CAD písma bývají bez háčků („Cislo vykresu", „Schvalil") ──

const FOLD: Record<string, string> = {
  á: "a", č: "c", ď: "d", é: "e", ě: "e", í: "i", ň: "n", ó: "o", ř: "r", š: "s", ť: "t", ú: "u", ů: "u", ý: "y", ž: "z",
  ä: "a", ö: "o", ü: "u", ł: "l", ś: "s", ć: "c", ń: "n", ź: "z", ż: "z", ő: "o", ű: "u", è: "e", ñ: "n",
};

/** Zdroj regexu → písmena s diakritikou mimo [třídy] nahradí třídou [čc] (i velká). */
export function foldSource(src: string): string {
  let out = "";
  let inClass = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\\") { out += ch + (src[i + 1] ?? ""); i++; continue; }
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    const lo = ch.toLowerCase();
    if (!inClass && FOLD[lo]) {
      const base = FOLD[lo];
      out += `[${ch}${ch === lo ? ch.toUpperCase() : lo}${base}${base.toUpperCase()}]`;
      continue;
    }
    out += ch;
  }
  return out;
}

function folded(re: RegExp): RegExp {
  return new RegExp(foldSource(re.source), re.flags);
}

// ── Nastavení skupin ──────────────────────────────────────────

export interface RedactToggles {
  company: boolean;
  logo: boolean;
  person_drawn: boolean;
  person_checked: boolean;
  person_revisions: boolean;
  signature: boolean;
  path: boolean;
  contact: boolean;
  code: boolean;
  copyright_owner: boolean;
  copyright_whole: boolean;
  filename: boolean;
}

/**
 * Výchozí: JEN název firmy (majitel 31. 10.: „Vlastně stačí, když to smaže název firmy. Nic víc.").
 * Osoby, podpisy, logo, cesty, kontakty, kódy a doložka jsou volitelné přepínače v Nastavení.
 * (Logo s názvem jako TEXT zmizí i tak — jako text s názvem firmy.)
 */
export const DEFAULT_REDACT: RedactToggles = {
  company: true, logo: false, person_drawn: false, person_checked: false, person_revisions: false, signature: false,
  path: false, contact: false, code: false, copyright_owner: false, copyright_whole: false, filename: false,
};

/** Všechny skupiny zapnuté (dřívější výchozí; doložka celá ne) — volitelné v Nastavení, testy pravidel. */
export const ALL_REDACT: RedactToggles = {
  company: true, logo: true, person_drawn: true, person_checked: true, person_revisions: true, signature: true,
  path: true, contact: true, code: true, copyright_owner: true, copyright_whole: false, filename: true,
};

/** Jen název firmy (výchozí stav) — pro migraci / test. */
export function isCompanyOnly(t: RedactToggles): boolean {
  return (Object.keys(DEFAULT_REDACT) as (keyof RedactToggles)[]).every((k) => t[k] === DEFAULT_REDACT[k]);
}

export interface Term {
  raw: string;
  /** Normalizovaně (bez diakritiky, malá, bez právní formy). */
  norm: string;
  /** Bez mezer (rozepsané po znacích / „STROJ METAL"). */
  compact: string;
  source: "custom" | "crm" | "drawing";
  /** Jedno výrazné slovo z názvu firmy (makeWordTerms). */
  word?: boolean;
}

export interface RuleContext {
  terms: Term[];
  /** Normalizované výjimky (naše firma). */
  keepTerms: string[];
  redact: RedactToggles;
}

// ── Právní formy ──────────────────────────────────────────────

/** Formy s tečkami / smíšené — bez ohledu na velikost písmen. */
const LEGAL_DOTTED = [
  String.raw`spol\.\s?s\s?r\.\s?o\.?`, String.raw`s\.\s?r\.\s?o\.?`, String.raw`a\.\s?s\.`, String.raw`k\.\s?s\.`,
  String.raw`v\.\s?o\.\s?s\.`, String.raw`z\.\s?s\.`, String.raw`gmbh(?:\s?&\s?co\.?\s?kg)?`, String.raw`ltd\.?`,
  String.raw`inc\.`, String.raw`corp\.`, String.raw`co\.`, String.raw`s\.a\.s\.`, String.raw`s\.a\.`, String.raw`s\.r\.l\.`,
  String.raw`s\.p\.a\.`, String.raw`b\.v\.`, String.raw`n\.v\.`, String.raw`sp\.\s?z\s?o\.\s?o\.?`, String.raw`sp\.\s?j\.`,
  String.raw`kft\.?`, String.raw`zrt\.?`, String.raw`d\.o\.o\.`, String.raw`e\.\s?k\.`, String.raw`s\.l\.`, String.raw`sarl`,
  String.raw`a\/s`, String.raw`aps`, String.raw`spol\.\s?s\s?r\.o`, String.raw`s\.r\.o`,
];
/** Krátké formy bez teček — jen VELKÁ písmena (AG, KG…), aby se nechytaly jednotky (kg). */
const LEGAL_CAPS = ["AG", "KG", "SE", "AB", "Oy", "SAS", "SRL", "LLC", "PLC", "UG", "OHG", "SpA", "BV", "NV", "Inc", "Ltd", "Corp", "GmbH", "SA"];

const LEGAL_DOTTED_RE = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${LEGAL_DOTTED.join("|")})(?![\p{L}\p{N}])`, "giu");
const LEGAL_CAPS_RE = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${LEGAL_CAPS.join("|")})(?![\p{L}\p{N}])`, "gu");
const FIRMA_PREFIX_RE = /(?<![\p{L}\p{N}])(?:Fa|Fy|Firma|Firm)(?:\.?\s+|\.?\s*[:：]\s*)(?=\p{Lu})/gu;

/**
 * Popisky polí, jejichž hodnota je firma / projekt zákazníka (razítko, rám): „Zákazník:", „Customer:",
 * „Kunde:", „Odběratel:", „Firma:", „Company:", „Projekt:"… (cs, sk, de, en, pl, hu). Hodnota se maže
 * jako company; popisek zůstává.
 */
const COMPANY_LABEL_WORDS = [
  // cs / sk
  "Zákazník", "Odběratel", "Odberateľ", "Objednatel", "Objednávateľ", "Klient", "Firma", "Společnost", "Spoločnosť", "Projekt",
  "Investor", "Majitel", "Vlastník", "Dodavatel", "Výrobce",
  // de
  "Kunde", "Auftraggeber", "Besteller", "Abnehmer", "Hersteller", "Lieferant", "Eigentümer", "Bauherr",
  // en
  "Customer", "Client", "Company", "Project", "Owner", "Manufacturer", "Supplier", "Vendor",
  // pl
  "Zamawiający", "Odbiorca", "Producent", "Dostawca", "Inwestor",
  // hu
  "Megrendelő", "Vevő", "Ügyfél", "Cég", "Gyártó", "Szállító",
];
const COMPANY_LABEL_ALT = [...COMPANY_LABEL_WORDS].sort((a, b) => b.length - a.length).map((w) => escapeRegExp(w)).join("|");
/** Popisek s dvojtečkou kdekoli v řádku. */
const COMPANY_LABEL_RE = new RegExp(foldSource(String.raw`(?<![\p{L}\p{N}])(?:${COMPANY_LABEL_ALT})\.?(?![\p{L}\p{N}])\s*[:：]`), "giu");
/** Popisek na začátku řádku bez dvojtečky (hodnota začíná velkým písmenem — kontrola v kódu, flag i by \p{Lu} zrušil) nebo samotný popisek. */
const COMPANY_LABEL_START_RE = new RegExp(foldSource(String.raw`^\s*(?:${COMPANY_LABEL_ALT})\.?(?![\p{L}\p{N}])`), "iu");

/**
 * Popisky VLASTNÍKA / zákazníka (ne výrobce či dodavatele dílu): „Zákazník: ACME Forge GmbH" s právní
 * formou se maže i mimo razítko (řádek nad razítkem, poznámka). „Výrobce: SKF GmbH" mimo razítko zůstává.
 */
const OWNER_LABEL_WORDS = [
  "Zákazník", "Odběratel", "Odberateľ", "Objednatel", "Objednávateľ", "Klient", "Investor", "Majitel", "Vlastník",
  "Kunde", "Auftraggeber", "Besteller", "Abnehmer", "Eigentümer", "Bauherr",
  "Customer", "Client", "Owner",
  "Zamawiający", "Odbiorca", "Inwestor",
  "Megrendelő", "Vevő", "Ügyfél",
];
const OWNER_LABEL_RE = new RegExp(foldSource(String.raw`(?<![\p{L}\p{N}])(?:${[...OWNER_LABEL_WORDS].sort((a, b) => b.length - a.length).map((w) => escapeRegExp(w)).join("|")})\.?(?![\p{L}\p{N}])\s*[:：]`), "giu");

/** Popisek vlastníka výkresu na začátku řádku („Zákazník:", „Firma:", „Company:") — ne Výrobce / Dodavatel. */
const OWNER_ROW_START_RE = new RegExp(foldSource(String.raw`^\s*(?:${[...OWNER_LABEL_WORDS, "Firma", "Společnost", "Company", "Firm", "Unternehmen", "Projektant", "Konstruktion"].sort((a, b) => b.length - a.length).map((w) => escapeRegExp(w)).join("|")})\.?(?![\p{L}\p{N}])\s*[:：]`), "iu");
/** Řádek kusovníku (pozice na začátku nebo počet kusů) — nikdy není řádkem vlastníka. */
const BOM_ROW_RE = /^\s*\d{1,3}[.)]?\s|\b\d+(?:[.,]\d+)?\s*(?:ks|kus[ůy]?|pcs?|stk|stück|szt)\b/iu;

/**
 * Řádek VLASTNÍKA výkresu nad razítkem („Zákazník: ACME Forge GmbH", „Firma: STROJMETAL a.s.") —
 * rozšíření zóny razítka nahoru. Jen popisek vlastníka s dvojtečkou na začátku řádku; právní forma
 * sama (výrobce v kusovníku „SKF GmbH") ani popisky výrobce / dodavatele zónu nerozšíří.
 */
export function isCompanyRow(text: string): boolean {
  const t = String(text ?? "");
  if (BOM_ROW_RE.test(t)) return false;
  return OWNER_ROW_START_RE.test(t);
}

/** Obecná slova v názvech firem — samostatně nejsou termínem (normalizovaně, bez diakritiky). */
const TERM_WORD_STOP = new Set([
  "aluminium", "aluminum", "forging", "forge", "kovarna", "kovarny", "slevarna", "slevarny", "strojirny", "strojirna", "strojirenska",
  "strojirenske", "strojirensky", "strojni", "group", "gruppe", "engineering", "automotive", "holding", "servis", "service", "services",
  "industries", "industry", "industrial", "technology", "technologies", "technik", "technika", "technicke", "technical", "international",
  "systems", "system", "solutions", "components", "komponenty", "company", "works", "metal", "metals", "steel", "stahl", "plast", "plasty",
  "plastics", "production", "produkce", "vyroba", "vyrobni", "trade", "trading", "export", "import", "czech", "cesko", "ceska", "ceske",
  "europe", "europa", "invest", "werke", "werk", "maschinenbau", "manufacturing", "precision", "tools", "tool", "nastroje", "nastrojarna",
  "mechanical", "mechanika", "electric", "elektro", "elektrik", "energy", "energie", "motors", "motor", "parts", "design", "development",
  "consulting", "partners", "partner", "brothers", "druzstvo", "podnik", "akciova", "spolecnost", "obchodni", "auto", "cars", "logistics",
  "machinery", "machines", "machine", "stroje", "sluzby", "construction", "konstrukce", "montaze", "montage", "hydraulika", "hydraulics",
  "global", "world", "west", "east", "north", "south", "central", "centrum", "polska", "deutschland", "slovakia", "slovensko", "hungary",
  "magyar", "austria", "osterreich", "limited", "corporation", "incorporated", "verwaltungs", "beteiligungs", "spol", "firma", "projekt",
  "drawing", "vykres", "vykresy", "material", "materialy", "zakaznik", "customer", "group", "team", "studio", "atelier", "bureau", "office",
]);

const TRAILING_LEGAL_DOTTED_RE = new RegExp(String.raw`^[\s,]*(?:${LEGAL_DOTTED.join("|")})(?![\p{L}\p{N}])`, "iu");
const TRAILING_LEGAL_CAPS_RE = new RegExp(String.raw`^[\s,]*(?:${LEGAL_CAPS.join("|")})(?![\p{L}\p{N}])`, "u");

/** Délka právní formy na začátku `rest` (za názvem firmy), jinak 0. */
export function trailingLegalForm(rest: string): number {
  const m = TRAILING_LEGAL_DOTTED_RE.exec(rest) ?? TRAILING_LEGAL_CAPS_RE.exec(rest);
  return m ? m[0].length : 0;
}

/** Odstraní právní formu z názvu firmy (pro termíny z CRM). */
export function stripLegalForm(name: string): string {
  return name
    .replace(LEGAL_DOTTED_RE, " ")
    .replace(LEGAL_CAPS_RE, " ")
    .replace(/[,;]+\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Technické tokeny (výjimky) ────────────────────────────────

const TECH_PATTERNS: RegExp[] = [
  // normy (ne holé „EN")
  /(?<![\p{L}])(?:ČSN|CSN|DIN|ISO|EN|ASME|ANSI|JIS|GB|ASTM|BS|NF|UNI|SAE|AISI|STN|PN|VDI|VDA)\s?(?:EN\s?)?(?:ISO\s?)?\d[\d.\-:/]*(?:\s?-?\s?[fmcv][HKL]?(?![\p{L}]))?/giu,
  /(?<![\p{L}])ISO\s?2768(?:-\d)?\s?-?[fmcv][HKL]?(?![\p{L}])/giu,
  // materiály
  /(?<![\p{L}\p{N}])\d\.\d{4}(?![\p{N}])/gu,
  /(?<![\p{L}\p{N}])S\d{3}[A-Z0-9+]*/gu,
  /(?<![\p{L}])EN\s?AW-?\s?\d{4}[A-Z]?(?:\s?[-–]?\s?T\d{1,4})?/giu,
  /(?<![\p{L}\p{N}])C\d{2}E?(?![\p{L}\p{N}])/gu,
  /(?<![\p{L}\p{N}])\d{2}(?:CrMo|CrNiMo|MnCr|NiCrMo|CrV|MnB|Mn|Cr|NiCr|SiMn)\d{1,3}(?:[-+][A-Z]{1,3})?/gu,
  /(?<![\p{L}\p{N}])(?:X\d{1,3}[A-Z][A-Za-z0-9-]*|AlMg[A-Za-z0-9.]*|AlMgSi\d?|AlCu[A-Za-z0-9]*|CuZn\d*[A-Za-z0-9]*|CuSn\d*|POM(?:-C)?|PA6\d?|PE-?HD|PTFE|PEEK)/gu,
  /(?<![\p{L}\p{N}])\d{2}\s?\d{3}(?:\.\d{1,2})?(?![\p{N}])/gu, // ČSN 11 523, 19 436.4
  // závity, lícování, drsnost, geometrie
  /(?<![\p{L}\p{N}])M\d+(?:[x×]\d+(?:[.,]\d+)?)?(?:-\d[a-zA-Z]{1,2})?/gu,
  /(?<![\p{L}\p{N}])(?:Tr|G|R|Rp|Rc|NPT|UNC|UNF)\s?\d+(?:[\/x×]\d+)?(?:[.,]\d+)?(?![\p{L}])/gu,
  /[Ø⌀∅]\s?\d+(?:[.,]\d+)?(?:\s?[A-Za-z]{1,2}\d{1,2}(?![\p{N}]))?/gu,
  /(?<=[\d)]\s?)[A-Za-z]{1,2}\d{1,2}(?![\p{L}\p{N}])/gu,
  /(?<![\p{L}\p{N}])[A-Za-z]{1,2}\d{1,2}\s?\/\s?[A-Za-z]{1,2}\d{1,2}(?![\p{L}\p{N}])/gu,
  /(?<![\p{L}])(?:Ra|Rz|Rmax|Rt|Rq|Rp)\s?\d+(?:[.,]\d+)?(?![\p{L}])/gu,
  /(?<![\p{L}\p{N}])R\s?\d+(?:[.,]\d+)?(?![\p{L}])/gu,
  // rozměry a čísla
  /\d+(?:[.,]\d+)?\s?[x×]\s?\d+(?:[.,]\d+)?(?:\s?[x×]\s?\d+(?:[.,]\d+)?)?/gu,
  /[±+\-–]?\d+(?:[.,]\d+)?(?:\s?\/\s?[±+\-–]?\d+(?:[.,]\d+)?)?/gu,
  // jednotky a zkratky
  /(?<![\p{L}])(?:mm|cm|µm|um|m|°|kg|g|N|Nm|kN|MPa|N\/mm2|N\/mm²|HRC|HB|HBW|HV\d*|HRB|ks|pcs|Stk|St\.|mm²|bar|°C|min|max|ca\.?|cca|typ\.?|ref\.?)(?![\p{L}])/gu,
  // datum, měřítko, revize, list
  /\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4}/gu,
  /\d{4}-\d{2}-\d{2}/gu,
  /\d{1,2}\/\d{1,2}\/\d{2,4}/gu,
  /(?<![\p{L}\p{N}])\d+\s?:\s?\d+(?![\p{N}])/gu,
  /(?<![\p{L}])(?:Rev|Revize|Index|Ind)\.?\s?[A-Z0-9]{1,2}(?![\p{L}\p{N}])/gu,
  /(?<![\p{L}])(?:List|Sheet|Blatt|Arkusz)\.?\s?\d+(?:\s?\/\s?\d+)?/giu,
  /(?<![\p{L}])(?:A[0-4]|B[0-4])(?![\p{L}\p{N}])/gu,
  /(?<![\p{L}])(?:x|×|ø|Ø|h|H|js|JS)(?![\p{L}\p{N}])/gu,
];
/** Co zbyde po odstranění technických tokenů a smí zůstat (spojky, interpunkce, jednopísmenné). */
const TECH_REST = /^[\s.,;:/\\|()[\]{}+\-–—±×x=*°'"#%&~^_<>?!]*$/u;

/** Je text čistě technický (normy, materiály, kóty, data…)? */
export function isTechnicalText(s: string): boolean {
  let t = String(s ?? "");
  if (!t.trim()) return true;
  for (const re of TECH_PATTERNS) t = t.replace(re, " ");
  // jednoznakové zbytky (indexy revizí „B", „-")
  t = t.replace(/(?<![\p{L}\p{N}])[\p{L}](?![\p{L}\p{N}])/gu, " ");
  return TECH_REST.test(t);
}

// ── Cesty ─────────────────────────────────────────────────────

const CAD_EXT = "dwg|dxf|dwf|sldprt|sldasm|slddrw|ipt|iam|idw|ipn|catpart|catproduct|catdrawing|prt|asm|drw|par|psm|dft|step|stp|igs|iges|x_t|x_b|jt|3dm|f3d|pdf|plt|tif|tiff";
const NATIVE_CAD_EXT = "dwg|sldprt|sldasm|slddrw|ipt|iam|idw|ipn|catpart|catproduct|catdrawing|prt|asm|drw|par|psm|dft|x_t|x_b|f3d|3dm";

interface PathRule {
  re: RegExp;
  rule: string;
  /** Až do konce řádku (plot stamp). */
  toEnd?: boolean;
}

const PATH_RULES: PathRule[] = [
  { re: /(?<![\p{L}\p{N}])[A-Za-z]:[\\/]/gu, rule: "path_win", toEnd: true },
  { re: /\\\\[\w.$-]+\\/gu, rule: "path_unc", toEnd: true },
  { re: /(?<![\w.])\.\.?[\\/]\S+/gu, rule: "path_rel" },
  { re: /(?<![\w./])\/(?:home|Users|mnt|srv|net|data|projects?|opt|Volumes|media|var|tmp|usr|share|vault|nas|cad)\/\S+/giu, rule: "path_unix", toEnd: true },
  { re: /file:\/\/\/?\S+/giu, rule: "path_file", toEnd: true },
  { re: /\$\/\S+/gu, rule: "path_vault" },
  { re: /\bPDM:\/\/\S+/giu, rule: "path_pdm" },
  { re: /https?:\/\/[\w.-]*(?:sharepoint\.com|onedrive|1drv\.ms|teams\.microsoft)\S*/giu, rule: "path_cloud" },
  { re: new RegExp(String.raw`\S*[\\/]\S*\.(?:${CAD_EXT})(?![\p{L}\p{N}])`, "giu"), rule: "path_cadfile" },
  { re: new RegExp(String.raw`(?<![\p{L}\p{N}])[\p{L}\p{N}_.\-]+\.(?:${NATIVE_CAD_EXT})(?![\p{L}\p{N}])`, "giu"), rule: "path_cadname" },
];
const PATH_LABEL_RE = folded(/^\s*(?:Soubor|File|File\s?name|Filename|Datei|Dateiname|Pfad|Path|Ścieżka|Plik|Fichier|Chemin|Percorso|Ruta|Archivo|Útvonal|Fájl|Cesta|Umístění|Speicherort|Location)\s*:(?!\/\/)/iu);

// ── Kontakty ──────────────────────────────────────────────────

const TLD = "cz|sk|de|at|ch|pl|hu|com|eu|net|org|info|biz|io|it|fr|es|nl|be|uk|co\\.uk|si|hr|ro|cn|ru|us|se|dk|fi|no";
const CONTACT_RULES: { re: RegExp; rule: string; check?: (m: string) => boolean }[] = [
  { re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu, rule: "email" },
  { re: /(?<![\p{L}\p{N}])(?:https?:\/\/|www\.)\S+/giu, rule: "url" },
  { re: new RegExp(String.raw`(?<![@\p{L}\p{N}.\-])[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:${TLD})(?![\p{L}\p{N}\-])`, "giu"), rule: "domain",
    check: (m) => /[a-z]{2,}/i.test(m.split(".")[0] ?? "") },
  { re: /(?<![\p{L}])(?:tel(?:efon)?|phone|fon|fax|mobil(?:e)?|mob|gsm|telefax)\.?\s*:?\s*\+?\(?\d[\d \/().-]{6,}\d/giu, rule: "phone" },
  { re: /(?<![\p{L}\p{N}])[TFM]\s*:\s*\+?\(?\d[\d \/().-]{6,}\d/gu, rule: "phone" },
  { re: /\+\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}/gu, rule: "phone",
    check: (m) => (m.match(/\d/g)?.length ?? 0) >= 9 && !/^\+0/.test(m) },
  { re: /(?<![\p{L}])(?:IČO|IČ|ICO|IC|Reg\.?\s?No\.?|KRS|REGON|HRB|HRA|Firmenbuch|FN)\s*[:.]?\s*\d[\d ]{4,}\d/giu, rule: "ico" },
  // za popiskem nesmí hned pokračovat slovo („DICTIONARYVAR", „Dictionary…" z DXF) a číslo musí mít ≥ 6 číslic
  { re: /(?<![\p{L}])(?:DIČ|DIC|VAT(?:\s?(?:ID|No\.?|Reg\.?))?|USt-?Id(?:Nr)?\.?|UID|NIP|TVA|P\.?\s?IVA|CIF|Tax\s?ID|IČ\s?DPH)(?![\p{L}])\s*[:.]?\s*[A-Z]{0,2}\s?[\dA-Z][\dA-Z -]{6,}/giu, rule: "vat",
    check: (m) => (m.match(/\d/g)?.length ?? 0) >= 6 },
  { re: /(?<![\p{L}\p{N}])(?:CZ|SK|DE|AT|PL|HU|ATU)\d{8,10}(?![\p{N}])/gu, rule: "vat" },
];
const ADDRESS_RE = /(?<![\p{N}])(?:\d{3}\s\d{2}|(?:D-|A-|CH-|PL-)?\d{5}|\d{2}-\d{3}|\d{4})\s+\p{Lu}\p{Ll}{2,}/u;
const STREET_HINT = /(?:str\.|straße|strasse|ul\.|ulice|náměstí|nám\.|třída|tř\.|street|st\.|road|weg|gasse|platz|\d+\/\d+[a-z]?)/iu;

// ── Osoby (kotvy razítka) ─────────────────────────────────────

type PersonGroup = "person_drawn" | "person_checked";
const ANCHORS: { group: PersonGroup; words: string[] }[] = [
  {
    group: "person_drawn",
    words: [
      // cs / sk
      "Nakreslil", "Kreslil", "Kreslila", "Kreslič", "Konstruoval", "Konstruovala", "Konstruktér", "Konstrukce", "Zpracoval", "Zpracovala",
      "Vypracoval", "Vypracovala", "Technolog", "Navrhl", "Navrhla", "Projektant", "Projektoval", "Autor", "Vyhotovil",
      // de
      "Gezeichnet", "Gez", "Bearbeitet", "Bearb", "Erstellt", "Ersteller", "Konstruiert", "Konstrukteur", "Zeichner",
      // en
      "Drawn by", "Drawn", "Designed by", "Designed", "Designer", "Created by", "Drafted by", "Drafter", "Draftsman", "Engineer", "Author",
      // pl
      "Rysował", "Opracował", "Projektował", "Konstruował",
      // fr / it / es / hu
      "Dessiné par", "Dessiné", "Dessinateur", "Conçu par", "Conçu", "Disegnato", "Disegnatore", "Progettato", "Dibujado", "Dibujó", "Diseñado",
      "Rajzolta", "Rajzoló", "Tervezte", "Tervező",
      // ru / zh
      "Разраб", "Разработал", "Черт", "Чертил", "Составил", "设计", "制图", "绘图",
    ],
  },
  {
    group: "person_checked",
    words: [
      "Normalizoval", "Normalizovala", "Normalizace", "Kontroloval", "Kontrolovala", "Kontrola", "Přezkoušel", "Zkontroloval",
      "Schválil", "Schválila", "Schváleno", "Schvalil", "Revidoval",
      "Geprüft", "Gepr", "Normgeprüft", "Norm", "Freigegeben", "Freigabe", "Genehmigt",
      "Checked by", "Checked", "Approved by", "Approved", "Reviewed by", "Reviewed", "Verified", "Released by",
      "Sprawdził", "Zatwierdził", "Normalizował",
      "Vérifié", "Approuvé", "Controllato", "Approvato", "Verificato", "Revisado", "Aprobado", "Ellenőrizte", "Jóváhagyta",
      "Пров", "Проверил", "Утв", "Утвердил", "Т.контр", "Н.контр", "审核", "批准", "校对",
    ],
  },
];

function anchorRegex(words: string[]): RegExp {
  const sorted = [...words].sort((a, b) => b.length - a.length).map((w) => escapeRegExp(w).replace(/\\ /g, "\\s+"));
  return new RegExp(foldSource(String.raw`(?<![\p{L}\p{N}])(?:${sorted.join("|")})\.?(?![\p{L}\p{N}])\s*(?:[:：]|\(\s*\w{0,8}\s*\))?`), "giu");
}
const ANCHOR_RES = ANCHORS.map((a) => ({ group: a.group, re: anchorRegex(a.words) }));
const ANY_ANCHOR_RE = anchorRegex(ANCHORS.flatMap((a) => a.words));

const DATE_RE = /\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}/gu;
const INITIAL_NAME_RE = /(?<![\p{L}\p{N}])\p{Lu}\.\s?(?:\p{Lu}\.\s?)?\p{Lu}\p{Ll}{2,}(?:-\p{Lu}\p{Ll}+)?/gu;
const INITIALS_RE = /(?<![\p{L}\p{N}])\p{Lu}\.\s?\p{Lu}\.(?:\s?\p{Lu}\.)?/gu;
const REV_INITIALS_RE = /(?<![\p{L}\p{N}])\p{Lu}{2,3}(?![\p{L}\p{N}])/gu;
const REV_STOP = new Set(["REV", "IND", "ZM", "ZMĚNA", "DATUM", "DATE", "NAME", "JMÉNO", "PODPIS", "LIST", "LISTŮ", "DIN", "ISO", "ČSN", "CSN", "EN", "ECN", "ECO", "CAD", "PDF", "NC", "CNC", "OK", "NO", "NR", "NEW", "NOVÝ", "ID", "QTY", "POS", "TOL", "MAX", "MIN"]);

// ── Doložka ───────────────────────────────────────────────────

const COPYRIGHT_OWNER_RES: RegExp[] = [
  folded(/(?:©|\(c\)|copyright|urheberrecht(?:lich)?|schutzvermerk)\s*(?:\d{4}(?:\s?[-–]\s?\d{4})?\s*)?(?:by\s+)?(?:by\s+)?([^\n.,;:()]{2,80})/giu),
  folded(/(?:majetkem|vlastnictvím)\s+(?:firmy|společnosti|spol\.)?\s*([^\n.,;:()]{2,80})/giu),
  folded(/(?:eigentum|property|propriété|proprietà|własnością|tulajdona)\s+(?:der|von|of|de|di|la|firmy|des)?\s*(?:firma|company|la société|ditta)?\s*([^\n.,;:()]{2,80})/giu),
];
const COPYRIGHT_ANY = folded(/(?:©|\(c\)|copyright|urheberrecht|schutzvermerk|ISO\s?16016|majetkem|eigentum|property of|vervielfältigung|reproduction|rozmnožování|weitergabe)/iu);

// ── Podniková norma ───────────────────────────────────────────

const CUSTOMER_STANDARD_RE = folded(/(?<![\p{L}])(?:Werknorm|Werksnorm|Hausnorm|Firmennorm|Konzernnorm|podnikov(?:á|é|ou)\s+norm(?:a|y|ou)?|factory\s+standard|company\s+standard|in-house\s+standard|norma\s+zakładowa)(?![\p{L}])/iu);
const TERM_N_RE = /(?<![\p{L}\p{N}])[\p{Lu}]{2,6}\s?-?\s?N\s?\d{2,}/gu;
const STATE_N_PREFIX = new Set(["csn", "stn", "on", "pn", "din", "en", "sn", "msn", "bsn", "gostn", "isn"]);

// ── Keep pole ─────────────────────────────────────────────────

const KEEP_LABELS: { field: KeepField; re: RegExp }[] = [
  { field: "drawingNumber", re: folded(/(?<![\p{L}])(?:č(?:íslo)?\.?\s*výkresu|čís\.?\s*výkr\.?|číslo\s+výkr\.?|drawing\s*(?:no|number|nr)\.?|dwg\.?\s*(?:no|nr)\.?|zeichnungs?-?\s*(?:nr|nummer)\.?|zeichn\.?-?\s?nr\.?|part\s*(?:no|number)\.?|teile?-?\s?nr\.?|sachnummer|identnummer|nr\.?\s*rysunku|numer\s+rysunku|n°\s*de\s*plan|numero\s+disegno|número\s+de\s+plano|rajzszám)\s*[:.]?/iu) },
  { field: "revision", re: folded(/(?<![\p{L}])(?:revize|änderungsindex|revision|wydanie|indice|index)\s*[:.]?/iu) },
  { field: "material", re: folded(/(?<![\p{L}])(?:materiál|material|werkstoff|materiał|matériau|materiale|anyag|материал)\s*[:.]?/iu) },
  { field: "scale", re: folded(/(?<![\p{L}])(?:měřítko|scale|maßstab|massstab|skala|échelle|scala|escala|lépték|масштаб)\s*[:.]?/iu) },
  { field: "title", re: folded(/(?<![\p{L}])(?:název(?:\s+dílu)?|benennung|bezeichnung|title|nazwa|titre|denominazione|denominación|megnevezés|наименование)\s*[:.]?/iu) },
];

// ── Termíny ───────────────────────────────────────────────────

export function makeTerm(raw: string, source: Term["source"]): Term | null {
  const base = stripLegalForm(String(raw ?? "").replace(/[„“"'’]/g, " ")).trim();
  const norm = normalizeText(base);
  const compact = norm.replace(/[^\p{L}\p{N}]+/gu, "");
  if (compact.length < 3) return null;
  return { raw: base, norm, compact, source };
}

export function makeTerms(list: readonly (string | null | undefined)[], source: Term["source"], keepTerms: string[] = []): Term[] {
  const out: Term[] = [];
  const seen = new Set<string>();
  const keepCompact = keepTerms.map((k) => normalizeText(k).replace(/[^\p{L}\p{N}]+/gu, ""));
  for (const r of list) {
    if (!r) continue;
    const t = makeTerm(r, source);
    if (!t || seen.has(t.compact)) continue;
    // nikdy nemazat vlastní firmu (výjimky)
    if (keepCompact.some((k) => k && (t.compact === k || t.compact.includes(k) || k.includes(t.compact)))) continue;
    seen.add(t.compact);
    out.push(t);
  }
  return out;
}

/**
 * Výrazná slova z názvu firmy jako samostatné termíny: na výkresu bývá jen „STROJMETAL" nebo „ŠKODA",
 * ne celý název z CRM. Slovo ≥ 4 písmena, bez právní formy, ne obecné slovo (stoplist), ne technický
 * token a ne část naší firmy.
 */
export function makeWordTerms(names: readonly (string | null | undefined)[], source: Term["source"], keepTerms: string[] = []): Term[] {
  const out: Term[] = [];
  const keepCompact = keepTerms.map((k) => normalizeText(k).replace(/[^\p{L}\p{N}]+/gu, "")).filter((k) => k.length >= 3);
  const seen = new Set<string>();
  for (const name of names) {
    if (!name) continue;
    const base = stripLegalForm(String(name).replace(/[„“"'’]/g, " "));
    for (const word of base.split(/[^\p{L}\p{N}&]+/u)) {
      const w = word.replace(/^&+|&+$/g, "");
      const norm = normalizeText(w);
      const compact = norm.replace(/[^\p{L}\p{N}]+/gu, "");
      if (compact.length < 4 || !/\p{L}/u.test(compact) || /^\d+$/.test(compact)) continue;
      if (TERM_WORD_STOP.has(compact) || seen.has(compact)) continue;
      if (isTechnicalText(w)) continue;
      if (keepCompact.some((k) => compact === k || compact.includes(k) || k.includes(compact))) continue;
      seen.add(compact);
      out.push({ raw: w, norm, compact, source, word: true });
    }
  }
  return out;
}

interface Range {
  start: number;
  end: number;
}

/** Výskyty termínu v řádku (celá slova, normalizovaně, i rozepsané po znacích). */
export function findTermRanges(text: string, term: Term, norm?: NormText): Range[] {
  const n = norm ?? normalizeWithMap(text);
  const out: Range[] = [];
  if (!n.text) return out;
  // 1) normalizovaně, celé slovo
  const re = new RegExp(String.raw`(?<![\p{L}\p{N}])${escapeRegExp(term.norm).replace(/\\?\s+/g, "[\\s\\-_.]?")}(?![\p{L}\p{N}])`, "gu");
  for (const m of n.text.matchAll(re)) {
    const [s, e] = mapRangeBack(n, text, m.index ?? 0, (m.index ?? 0) + m[0].length);
    out.push({ start: s, end: e });
  }
  if (out.length) return out;
  // 2) bez mezer (S T R O J M E T A L / STROJ-METAL) — začátek a konec na hranici tokenu
  const chars: { c: string; i: number }[] = [];
  for (let i = 0; i < n.text.length; i++) {
    const c = n.text[i];
    if (/[\p{L}\p{N}]/u.test(c)) chars.push({ c, i });
  }
  const flat = chars.map((x) => x.c).join("");
  let from = 0;
  while (term.compact.length >= 4) {
    const at = flat.indexOf(term.compact, from);
    if (at < 0) break;
    from = at + 1;
    const ns = chars[at].i;
    const ne = chars[at + term.compact.length - 1].i + 1;
    const before = ns > 0 ? n.text[ns - 1] : " ";
    const after = ne < n.text.length ? n.text[ne] : " ";
    if (/[\p{L}\p{N}]/u.test(before) || /[\p{L}\p{N}]/u.test(after)) continue;
    const [s, e] = mapRangeBack(n, text, ns, ne);
    out.push({ start: s, end: e });
  }
  return out;
}

/** Obsahuje text některý termín (normalizovaně)? */
export function containsTerm(text: string, terms: readonly Term[]): boolean {
  const n = normalizeWithMap(text);
  return terms.some((t) => findTermRanges(text, t, n).length > 0);
}

function containsKeepTerm(text: string, keepTerms: readonly string[]): boolean {
  const c = normalizeText(text).replace(/[^\p{L}\p{N}]+/gu, "");
  return keepTerms.some((k) => {
    const kc = normalizeText(k).replace(/[^\p{L}\p{N}]+/gu, "");
    return kc.length >= 3 && c.includes(kc);
  });
}

// ── Zásahy v jednom řádku ─────────────────────────────────────

export interface RawHit {
  start: number;
  end: number;
  category: AnonCategory;
  rule: string;
  wholeItem?: boolean;
}

export interface LineRuleResult {
  hits: RawHit[];
  /** Kandidát pro AI (právní forma mimo razítko, doložka…) — nemaže se pravidlem. */
  candidate: boolean;
  customerStandard: boolean;
  /** Kotva osoby bez hodnoty v řádku → hledat souseda (vpravo / pod). */
  anchorsNeedingValue: PersonGroup[];
  /** Popisek firmy / zákazníka bez hodnoty v řádku → hodnota v sousední buňce. */
  companyLabelNeedsValue?: boolean;
}

let LABEL_STARTS_RES: RegExp[] | null = null;

/** Začátky popisků (osoba, keep pole, firma) v řádku od pozice `from`. */
function nextLabelStart(text: string, from: number): number {
  LABEL_STARTS_RES ??= [ANY_ANCHOR_RE, COMPANY_LABEL_RE, ...KEEP_LABELS.map((k) => new RegExp(k.re.source, k.re.flags.includes("g") ? k.re.flags : `${k.re.flags}g`))];
  let best = text.length;
  for (const re of LABEL_STARTS_RES) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const s = m.index ?? 0;
      if (s >= from && s < best) best = s;
    }
  }
  return best;
}

/** Je text hodnota pole firmy (sousední buňka popisku „Zákazník")? */
export function looksLikeCompanyValue(v: string, keepTerms: readonly string[]): boolean {
  const s = v.trim();
  if (!s || s.length > 80 || !/\p{L}{2,}/u.test(s)) return false;
  if (isTechnicalText(s) || containsKeepTerm(s, keepTerms)) return false;
  if (looksLikeLabelOnly(s)) return false;
  ANY_ANCHOR_RE.lastIndex = 0;
  const a = ANY_ANCHOR_RE.exec(s);
  if (a && a.index === 0) return false;
  for (const k of KEEP_LABELS) {
    const m = k.re.exec(s);
    if (m && m.index === 0) return false;
  }
  return true;
}

function trimRange(text: string, r: Range): Range | null {
  let { start, end } = r;
  while (start < end && /[\s,;:|]/u.test(text[start])) start++;
  while (end > start && /[\s,;:|]/u.test(text[end - 1])) end--;
  return end > start ? { start, end } : null;
}

/** Hodnota za kotvou osoby (bez dat a bez další kotvy). */
function personValueRanges(text: string, from: number, to: number): Range[] {
  const seg = text.slice(from, to);
  const pieces: Range[] = [];
  let last = 0;
  for (const m of seg.matchAll(DATE_RE)) {
    const s = m.index ?? 0;
    if (s > last) pieces.push({ start: from + last, end: from + s });
    last = s + m[0].length;
  }
  if (last < seg.length) pieces.push({ start: from + last, end: from + seg.length });
  const out: Range[] = [];
  for (const p of pieces) {
    const t = trimRange(text, p);
    if (!t) continue;
    const v = text.slice(t.start, t.end);
    if (!/\p{L}{2,}/u.test(v) && !/\p{Lu}\.?\s?\p{Lu}/u.test(v)) continue; // jen čísla / znaky
    if (isTechnicalText(v)) continue;
    out.push(t);
  }
  return out;
}

/** Je text jméno osoby (pro hodnotu v sousední buňce)? */
export function looksLikePersonValue(v: string): boolean {
  const s = v.replace(DATE_RE, " ").trim();
  if (!s || s.length > 60) return false;
  if (!/\p{L}{2,}|\p{Lu}\.\s?\p{Lu}/u.test(s)) return false;
  if (isTechnicalText(s)) return false;
  ANY_ANCHOR_RE.lastIndex = 0;
  if (ANY_ANCHOR_RE.test(s)) return false;
  for (const k of KEEP_LABELS) if (k.re.test(s)) return false;
  return true;
}

export function ruleLine(text: string, zone: Zone, ctx: RuleContext): LineRuleResult {
  const hits: RawHit[] = [];
  const res: LineRuleResult = { hits, candidate: false, customerStandard: false, anchorsNeedingValue: [] };
  if (!text || !text.trim()) return res;
  const strict = zone !== "body"; // razítko, rám, revize

  // 1) cesty (kdekoli; položka s cestou se maže celá)
  if (PATH_LABEL_RE.test(text)) {
    hits.push({ start: 0, end: text.length, category: "path", rule: "path_label", wholeItem: true });
  }
  for (const r of PATH_RULES) {
    for (const m of text.matchAll(r.re)) {
      const s = m.index ?? 0;
      const e = r.toEnd ? text.length : s + m[0].length;
      hits.push({ start: s, end: e, category: "path", rule: r.rule, wholeItem: true });
    }
  }

  // 2) kontakty (kdekoli)
  for (const r of CONTACT_RULES) {
    for (const m of text.matchAll(r.re)) {
      if (r.check && !r.check(m[0])) continue;
      const s = m.index ?? 0;
      hits.push({ start: s, end: s + m[0].replace(/[.,;:)]+$/u, "").length, category: "contact", rule: r.rule });
    }
  }
  if (strict && ADDRESS_RE.test(text) && (STREET_HINT.test(text) || /,/.test(text)) && !isTechnicalText(text)) {
    hits.push({ start: 0, end: text.length, category: "contact", rule: "address" });
  }

  // 3) vlastní termíny a CRM (kdekoli; výjimky je NIKDY neruší) — i s právní formou hned za názvem
  //    („STROJMETAL a.s." → celé), aby po názvu nezůstala osamělá „s.r.o."
  const norm = normalizeWithMap(text);
  for (const t of ctx.terms) {
    for (const r of findTermRanges(text, t, norm)) hits.push({ start: r.start, end: r.end + trailingLegalForm(text.slice(r.end)), category: "custom", rule: `term_${t.source}` });
  }

  // 4) právní forma (jen razítko / rám / revize; jinde kandidát pro AI)
  const legal: Range[] = [];
  for (const m of text.matchAll(LEGAL_DOTTED_RE)) legal.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  for (const m of text.matchAll(LEGAL_CAPS_RE)) {
    const s = m.index ?? 0;
    const before = text.slice(0, s);
    // před zkratkou musí být slovo s velkým písmenem (název) a ne číslo (2,5 KG)
    if (!/\p{Lu}[\p{L}\p{N}&.'-]+[\s,]*$/u.test(before) || /\d\s*$/u.test(before)) continue;
    legal.push({ start: s, end: s + m[0].length });
  }
  // „Fa. / Firma: <Název>" — hodnota začíná za předponou (předpona zůstává)
  for (const m of text.matchAll(FIRMA_PREFIX_RE)) legal.push({ start: (m.index ?? 0) + m[0].length, end: text.length });
  if (legal.length) {
    if (strict) {
      // řádek po případném popisku („Firma:", „Zákazník:") až do konce (adresa za názvem je také citlivá)
      const label = /^\s*[\p{L} .]{2,24}:\s*/u.exec(text);
      const from = label && label[0].length <= Math.min(...legal.map((l) => l.start)) ? label[0].length : 0;
      const seg = { start: from, end: text.length };
      const value = text.slice(seg.start, seg.end);
      if (!isTechnicalText(value.replace(LEGAL_DOTTED_RE, " ").replace(LEGAL_CAPS_RE, " ")) && !containsKeepTerm(value, ctx.keepTerms)) {
        hits.push({ ...seg, category: "company", rule: "legal_form" });
      }
    } else {
      res.candidate = true;
      // „Zákazník: ACME Forge GmbH" mimo razítko — popisek vlastníka + právní forma = firma (pravidlo)
      const first = Math.min(...legal.map((l) => l.start));
      for (const m of text.matchAll(OWNER_LABEL_RE)) {
        const e = (m.index ?? 0) + m[0].length;
        if (e > first) continue;
        const v = trimRange(text, { start: e, end: nextLabelStart(text, e) });
        if (!v || v.end <= first) continue;
        const value = text.slice(v.start, v.end);
        if (isTechnicalText(value.replace(LEGAL_DOTTED_RE, " ").replace(LEGAL_CAPS_RE, " ")) || containsKeepTerm(value, ctx.keepTerms)) continue;
        hits.push({ start: v.start, end: v.end, category: "company", rule: "company_label" });
      }
    }
  }

  // 4b) popisek pole s firmou / projektem zákazníka („Zákazník: STROJMETAL") — hodnota až k dalšímu popisku
  if (strict) {
    const ends: number[] = [];
    for (const m of text.matchAll(COMPANY_LABEL_RE)) ends.push((m.index ?? 0) + m[0].length);
    const sm = COMPANY_LABEL_START_RE.exec(text);
    if (sm && !ends.length) {
      const rest = text.slice(sm[0].length);
      if (!rest.trim()) res.companyLabelNeedsValue = true;
      else if (/^\s+\p{Lu}/u.test(rest)) ends.push(sm[0].length);
    }
    for (const e of ends) {
      const v = trimRange(text, { start: e, end: nextLabelStart(text, e) });
      if (!v) {
        if (!text.slice(e).trim()) res.companyLabelNeedsValue = true;
        continue;
      }
      const value = text.slice(v.start, v.end);
      if (isTechnicalText(value) || containsKeepTerm(value, ctx.keepTerms)) continue;
      hits.push({ start: v.start, end: v.end, category: "company", rule: "company_label" });
    }
  }

  // 5) osoby (kotvy razítka)
  if (strict) {
    const anchors: { s: number; e: number; group: PersonGroup }[] = [];
    for (const a of ANCHOR_RES) {
      for (const m of text.matchAll(a.re)) anchors.push({ s: m.index ?? 0, e: (m.index ?? 0) + m[0].length, group: a.group });
    }
    anchors.sort((a, b) => a.s - b.s || b.e - a.e);
    const uniq = anchors.filter((a, i) => !anchors.some((b, j) => j !== i && b.s <= a.s && b.e >= a.e && (b.e - b.s) > (a.e - a.s)));
    for (let i = 0; i < uniq.length; i++) {
      const a = uniq[i];
      const next = uniq.slice(i + 1).find((b) => b.s >= a.e);
      const to = next ? next.s : text.length;
      const values = personValueRanges(text, a.e, to);
      if (!values.length) res.anchorsNeedingValue.push(a.group);
      for (const v of values) hits.push({ start: v.start, end: v.end, category: "person", rule: a.group });
    }
    // „J. Novák", „J.N." kdekoli v razítku a revizích
    for (const m of text.matchAll(INITIAL_NAME_RE)) {
      const s = m.index ?? 0;
      hits.push({ start: s, end: s + m[0].length, category: "person", rule: zone === "revisions" ? "person_revisions" : "person_drawn" });
    }
    for (const m of text.matchAll(INITIALS_RE)) {
      const s = m.index ?? 0;
      hits.push({ start: s, end: s + m[0].length, category: "person", rule: zone === "revisions" ? "person_revisions" : "person_drawn" });
    }
    // iniciály v řádku revize (řádek s datem): „JN", „NOV" — ne index revize (první token) a ne známé zkratky
    if (zone === "revisions" && new RegExp(DATE_RE.source, "u").test(text)) {
      const first = /^\s*\S+/u.exec(text);
      for (const m of text.matchAll(REV_INITIALS_RE)) {
        const s = m.index ?? 0;
        if (first && s < first[0].length) continue;
        if (REV_STOP.has(m[0])) continue;
        hits.push({ start: s, end: s + m[0].length, category: "person", rule: "person_revisions" });
      }
    }
  }

  // 6) doložka: jen jméno vlastníka (volba: celá doložka)
  if (COPYRIGHT_ANY.test(text)) {
    if (ctx.redact.copyright_whole) {
      hits.push({ start: 0, end: text.length, category: "copyright_owner", rule: "copyright_whole" });
    } else {
      for (const re of COPYRIGHT_OWNER_RES) {
        for (const m of text.matchAll(re)) {
          const g = m[1];
          if (!g) continue;
          const gs = (m.index ?? 0) + m[0].length - g.length;
          const t = trimRange(text, { start: gs, end: gs + g.length });
          if (!t) continue;
          const owner = text.slice(t.start, t.end);
          if (!/\p{Lu}/u.test(owner) || isTechnicalText(owner) || containsKeepTerm(owner, ctx.keepTerms)) continue;
          // jen první 1–6 slov (název), ne celé souvětí doložky
          const words = owner.split(/\s+/);
          const take = words.slice(0, Math.min(words.length, 6)).join(" ");
          if (strict) hits.push({ start: t.start, end: t.start + take.length, category: "copyright_owner", rule: "copyright_owner" });
          else res.candidate = true;
        }
      }
    }
  }

  // 7) podniková norma zákazníka → review (nemaže se)
  if (CUSTOMER_STANDARD_RE.test(text)) res.customerStandard = true;
  else {
    // „<zkratka> N 123" (ŠKODA N 01 1234, STM-N 123) — ne státní normy (ČSN, STN, ON, PN…)
    for (const m of text.matchAll(TERM_N_RE)) {
      const prefix = normalizeText(m[0]).replace(/[^\p{L}]/gu, "");
      if (!STATE_N_PREFIX.has(prefix)) res.customerStandard = true;
    }
  }

  res.hits = filterToggles(dedupeHits(hits), ctx.redact);
  return res;
}

function dedupeHits(hits: RawHit[]): RawHit[] {
  const out: RawHit[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    if (h.end <= h.start) continue;
    const k = `${h.start}:${h.end}:${h.category}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(h);
  }
  return out.sort((a, b) => a.start - b.start || b.end - a.end);
}

export function filterToggles<T extends { category: AnonCategory; rule: string }>(hits: T[], t: RedactToggles): T[] {
  return hits.filter((h) => {
    switch (h.category) {
      case "company": return t.company;
      case "logo": return t.logo;
      case "signature": return t.signature;
      case "path": return t.path;
      case "contact": return t.contact;
      case "code": return t.code;
      case "copyright_owner": return t.copyright_owner || h.rule === "copyright_whole";
      case "person":
        if (h.rule === "person_checked") return t.person_checked;
        if (h.rule === "person_revisions") return t.person_revisions;
        return t.person_drawn;
      default: return true; // custom, other — nevypínatelné
    }
  });
}

// ── Celá stránka (řádky s geometrií) ──────────────────────────

export interface KeepHit {
  lineId: string;
  field: KeepField;
  start: number;
  end: number;
  value: string;
}

export interface PageRuleResult {
  hits: LineHit[];
  keep: KeepHit[];
  customerStandardLines: string[];
  /** Řádky, které posoudí AI (kandidáti mimo razítko). */
  candidateLines: string[];
  /** Keep pole obsahuje termín / zkratku firmy → review. */
  termInKeep: boolean;
  /** Varování pravidel (např. tiskárna v plot stampu smazaná s cestou). */
  warnings: AnonWarning[];
}

function overlapX(a: Box, b: Box): number {
  return Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
}
function overlapY(a: Box, b: Box): number {
  return Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
}

/** Nejbližší řádek vpravo (stejné účaří) nebo pod popiskem (ve stejné buňce). */
export function neighborLine(lines: readonly TextLine[], from: TextLine, maxRightEm = 25, maxBelowEm = 2.6): TextLine | null {
  const em = Math.max(from.fontSize, from.box.h, 0.5);
  let best: { l: TextLine; d: number } | null = null;
  for (const l of lines) {
    if (l.id === from.id || l.page !== from.page || !l.text.trim()) continue;
    const dyBase = Math.abs((l.box.y + l.box.h) - (from.box.y + from.box.h));
    const gapX = l.box.x - (from.box.x + from.box.w);
    // vpravo na stejném řádku
    if (dyBase < 0.6 * em && gapX >= -0.2 * em && gapX < maxRightEm * em) {
      const d = gapX;
      if (!best || d < best.d) best = { l, d };
      continue;
    }
    // pod (překryv ve vodorovném směru nebo začátek pod popiskem)
    const gapY = l.box.y - (from.box.y + from.box.h);
    const ox = overlapX(l.box, { ...from.box, w: Math.max(from.box.w, 8 * em) });
    if (gapY >= -0.2 * em && gapY < maxBelowEm * em && ox > 0) {
      const d = maxRightEm * em + gapY; // vpravo má přednost
      if (!best || d < best.d) best = { l, d };
    }
  }
  return best?.l ?? null;
}

/** Pravidla cest, která tvoří plot stamp (cesta / soubor CAD — ne odkaz do cloudu v poznámce). */
const STAMP_PATH_RULES = new Set(["path_win", "path_unc", "path_unix", "path_file", "path_cadfile", "path_cadname", "path_vault", "path_pdm"]);
/** Popisek mřížky rámu („A", „12") — není částí plot stampu a řetěz nepřerušuje. */
const STAMP_DATETIME_RE = /^\s*(?:\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})(?:[\sT,]+\d{1,2}:\d{2}(?::\d{2})?)?\s*$|^\s*\d{1,2}:\d{2}(?::\d{2})?\s*$/u;
const GRID_LABEL_RE = /^\s*[\p{L}\p{N}]{1,2}\s*$/u;
/** Přihlašovací jméno („jnovak", „FIRMA\jnovak") — malá písmena, bez mezer. */
const STAMP_LOGIN_RE = /^\s*(?:[\w-]+\\)?[a-z][a-z0-9._-]{2,30}\s*$/u;
/** „User: jnovak", „Uživatel: novak". */
const STAMP_USER_LABEL_RE = folded(/^\s*(?:user|uživatel|benutzer|login|autor|author)\s*[:=]\s*(?:[\w-]+\\)?[\p{L}][\p{L}\p{N}._-]{1,30}\s*$/iu);
/** Tiskárna / plotter („Plot: HP DesignJet T830", „Printed by …", „Tisk: …"). */
const STAMP_PRINTER_RE = folded(/^\s*(?:plot(?:ted)?|plotter|printed|printer|print|gedruckt|geplottet|drucker|tisk|tiskárna|vytištěno)\b[^\n]{0,50}$/iu);

export type StampPartKind = "datetime" | "login" | "printer";

/** Co je samostatná položka plot stampu (jinak null — řetěz končí). */
export function stampPartKind(text: string): StampPartKind | null {
  const t = String(text ?? "");
  if (t.length > 60) return null;
  if (STAMP_DATETIME_RE.test(t)) return "datetime";
  if (STAMP_USER_LABEL_RE.test(t)) return "login";
  if (STAMP_LOGIN_RE.test(t) && !isTechnicalText(t)) return "login";
  if (STAMP_PRINTER_RE.test(t) && !isTechnicalText(t.replace(/^\s*\S+\s*[:=]?/u, ""))) return "printer";
  return null;
}

/**
 * Ostatní části plot stampu na stejném účaří (stejné natočení a podobná výška písma), navazující
 * v řetězu s mezerou ≤ 40 em: JEN datum/čas, přihlašovací jméno nebo tiskárna (nikdy víceslovná
 * poznámka ani technický text — v žádné zóně). Řetěz končí na první jiné položce (přes ni nepokračuje);
 * popisek mřížky rámu („A", „12") řetěz nepřeruší. Další cesty plot stampu (pathIds) řetěz prodlouží.
 * Jen mimo razítko a revize (tam jsou na stejném účaří sousední buňky tabulky).
 */
export function plotStampSiblings(
  lines: readonly TextLine[], stamp: TextLine,
  opts: { maxGapEm?: number; pathIds?: ReadonlySet<string>; keepIds?: ReadonlySet<string> } = {},
): { line: TextLine; kind: StampPartKind }[] {
  const maxGapEm = opts.maxGapEm ?? 40;
  const em = Math.max(stamp.fontSize, 0.5);
  const vertical = Math.abs(Math.abs(stamp.rot) - 90) < 10;
  const along = (b: Box): [number, number] => (vertical ? [b.y, b.y + b.h] : [b.x, b.x + b.w]);
  const across = (b: Box) => (vertical ? b.x + b.w / 2 : b.y + b.h);
  const base = across(stamp.box);
  const row = lines.filter((l) => l.id !== stamp.id && l.page === stamp.page && l.rot === stamp.rot && l.text.trim()
    && Math.abs(across(l.box) - base) < (vertical ? 0.6 : 0.4) * em
    && l.fontSize >= 0.75 * em && l.fontSize <= 1.34 * em)
    .sort((a, b) => along(a.box)[0] - along(b.box)[0]);
  const out: { line: TextLine; kind: StampPartKind }[] = [];
  const [s0, s1] = along(stamp.box);
  const walk = (dir: 1 | -1) => {
    let edge = dir === 1 ? s1 : s0;
    const seq = dir === 1 ? row.filter((l) => along(l.box)[0] >= s0) : row.filter((l) => along(l.box)[1] <= s1).reverse();
    for (const l of seq) {
      const [b0, b1] = along(l.box);
      const gap = dir === 1 ? b0 - edge : edge - b1;
      if (gap > maxGapEm * em) break;
      if (GRID_LABEL_RE.test(l.text)) continue; // mřížka rámu: neodstraňuje se, řetěz nepřeruší
      if (l.zone === "title_block" || l.zone === "revisions") break;
      if (opts.pathIds?.has(l.id)) { edge = dir === 1 ? Math.max(edge, b1) : Math.min(edge, b0); continue; }
      if (opts.keepIds?.has(l.id) || isTitleAnchor(l.text)) break;
      const kind = stampPartKind(l.text);
      if (!kind) break;
      out.push({ line: l, kind });
      edge = dir === 1 ? Math.max(edge, b1) : Math.min(edge, b0);
    }
  };
  walk(1);
  walk(-1);
  return out;
}

/** Řádek přímo pod (stejná stránka a natočení, překryv vodorovně, mezera ≤ 1,2 em, podobné písmo). */
export function lineBelow(lines: readonly TextLine[], from: TextLine): TextLine | null {
  const em = Math.max(from.fontSize, from.box.h, 0.5);
  let best: { l: TextLine; d: number } | null = null;
  for (const l of lines) {
    if (l.id === from.id || l.page !== from.page || l.rot !== from.rot || !l.text.trim()) continue;
    if (Math.abs(from.rot) > 0.5) continue;
    if (l.fontSize < 0.6 * from.fontSize || l.fontSize > 1.6 * from.fontSize) continue;
    const gap = l.box.y - (from.box.y + from.box.h);
    if (gap < -0.35 * em || gap > 1.2 * em) continue;
    if (overlapX(l.box, from.box) <= 0) continue;
    if (!best || gap < best.d) best = { l, d: gap };
  }
  return best?.l ?? null;
}

interface CompactMap {
  flat: string;
  /** Index znaku v normalizovaném textu pro každý znak `flat`. */
  at: number[];
  n: NormText;
}

function compactMap(text: string): CompactMap {
  const n = normalizeWithMap(text);
  let flat = "";
  const at: number[] = [];
  for (let i = 0; i < n.text.length; i++) {
    if (/[\p{L}\p{N}]/u.test(n.text[i])) { flat += n.text[i]; at.push(i); }
  }
  return { flat, at, n };
}

/**
 * Termín rozdělený zalomením řádku: konec řádku + začátek řádku pod ním (bez ohledu na mezery,
 * spojovník, diakritiku a velikost písmen). Začátek na hranici slova v horním řádku, konec na hranici
 * slova v dolním; zásah v obou řádcích. Jen termíny, které se v žádném z řádků nenašly celé.
 */
export function crossLineTermHits(lines: readonly TextLine[], terms: readonly Term[]): { lineId: string; start: number; end: number }[] {
  const out: { lineId: string; start: number; end: number }[] = [];
  if (!terms.length) return out;
  const maps = new Map<string, CompactMap>();
  const mapOf = (l: TextLine) => {
    let m = maps.get(l.id);
    if (!m) { m = compactMap(l.text); maps.set(l.id, m); }
    return m;
  };
  for (const line of lines) {
    const below = lineBelow(lines, line);
    if (!below) continue;
    const a = mapOf(line), b = mapOf(below);
    if (!a.flat || !b.flat) continue;
    const joined = a.flat + b.flat;
    for (const t of terms) {
      if (t.compact.length < 4) continue;
      let from = Math.max(0, a.flat.length - t.compact.length + 1);
      for (;;) {
        const pos = joined.indexOf(t.compact, from);
        if (pos < 0 || pos >= a.flat.length) break;
        from = pos + 1;
        const end = pos + t.compact.length;
        if (end <= a.flat.length) continue; // celé v horním řádku — řeší ruleLine
        const ns = a.at[pos];
        const ne = b.at[end - a.flat.length - 1] + 1;
        const before = ns > 0 ? a.n.text[ns - 1] : " ";
        const after = ne < b.n.text.length ? b.n.text[ne] : " ";
        if (/[\p{L}\p{N}]/u.test(before) || /[\p{L}\p{N}]/u.test(after)) continue;
        const [s1] = mapRangeBack(a.n, line.text, ns, a.n.text.length);
        const [, e2] = mapRangeBack(b.n, below.text, 0, ne);
        out.push({ lineId: line.id, start: s1, end: line.text.length });
        out.push({ lineId: below.id, start: 0, end: e2 + trailingLegalForm(below.text.slice(e2)) });
      }
    }
  }
  return out;
}

export function rulePage(lines: readonly TextLine[], ctx: RuleContext, opts: { keepValues?: Partial<Record<KeepField, string>> } = {}): PageRuleResult {
  const out: PageRuleResult = { hits: [], keep: [], customerStandardLines: [], candidateLines: [], termInKeep: false, warnings: [] };
  const byId = new Map(lines.map((l) => [l.id, l]));
  const push = (lineId: string, h: RawHit, source: LineHit["source"] = "rule") => {
    out.hits.push({ lineId, start: h.start, end: h.end, category: h.category, rule: h.rule, source, ...(h.wholeItem ? { wholeItem: true } : {}) });
  };

  for (const line of lines) {
    const r = ruleLine(line.text, line.zone, ctx);
    for (const h of r.hits) push(line.id, h);
    if (r.customerStandard) out.customerStandardLines.push(line.id);
    if (r.candidate) out.candidateLines.push(line.id);
    // kotva bez hodnoty → soused vpravo / pod
    for (const group of r.anchorsNeedingValue) {
      const n = neighborLine(lines, line);
      if (!n || !looksLikePersonValue(n.text)) continue;
      const vals = personValueRanges(n.text, 0, n.text.length);
      for (const v of vals) {
        if (filterToggles([{ category: "person" as AnonCategory, rule: group }], ctx.redact).length) {
          push(n.id, { start: v.start, end: v.end, category: "person", rule: group });
        }
      }
    }
    // popisek firmy bez hodnoty → soused vpravo / pod (buňka razítka)
    if (r.companyLabelNeedsValue && ctx.redact.company) {
      const n = neighborLine(lines, line, 25, 3);
      if (n && looksLikeCompanyValue(n.text, ctx.keepTerms)) {
        const v = trimRange(n.text, { start: 0, end: n.text.length });
        if (v) push(n.id, { start: v.start, end: v.end, category: "company", rule: "company_label" });
      }
    }
    // keep pole (popisek → hodnota v řádku nebo soused)
    if (line.zone !== "body") {
      for (const k of KEEP_LABELS) {
        const m = k.re.exec(line.text);
        if (!m) continue;
        const after = (m.index ?? 0) + m[0].length;
        const rest = trimRange(line.text, { start: after, end: line.text.length });
        if (rest && !looksLikeLabelOnly(line.text.slice(rest.start, rest.end))) {
          out.keep.push({ lineId: line.id, field: k.field, start: rest.start, end: rest.end, value: line.text.slice(rest.start, rest.end) });
        } else {
          const n = neighborLine(lines, line, 25, 3);
          if (n && !looksLikeLabelOnly(n.text)) out.keep.push({ lineId: n.id, field: k.field, start: 0, end: n.text.length, value: n.text });
        }
      }
    }
  }

  // název firmy zalomený na dva řádky (buňka razítka „STROJ-" / „METAL", „Strojmetal Aluminium" / „Forging")
  for (const x of crossLineTermHits(lines, ctx.terms)) push(x.lineId, { start: x.start, end: x.end, category: "custom", rule: "term_xline" });

  // plot stamp složený z oddělených položek („cesta   datum   uživatel") → celý (mimo razítko a revize);
  // jen datum/čas, login a tiskárna — poznámky a technický text na stejném účaří zůstanou
  if (ctx.redact.path) {
    const stampIds = new Set(out.hits.filter((h) => h.category === "path" && STAMP_PATH_RULES.has(h.rule)).map((h) => h.lineId));
    const keepIds = new Set(out.keep.map((k) => k.lineId));
    const added = new Set<string>();
    let printers = 0;
    for (const id of stampIds) {
      const l = byId.get(id);
      if (!l || l.zone === "title_block" || l.zone === "revisions") continue;
      for (const { line: n, kind } of plotStampSiblings(lines, l, { pathIds: stampIds, keepIds })) {
        if (stampIds.has(n.id) || added.has(n.id)) continue;
        added.add(n.id);
        if (kind === "printer") printers++;
        push(n.id, { start: 0, end: n.text.length, category: "path", rule: "plot_stamp", wholeItem: true });
      }
    }
    if (printers) {
      out.warnings.push({ code: "plot_stamp", message: "S cestou na disk se smazala i tiskárna / plotter z plot stampu — zkontroluj, že nešlo o poznámku." });
    }
  }

  // známé hodnoty (číslo výkresu, revize, materiál z vytěžení výkresu)
  for (const [field, value] of Object.entries(opts.keepValues ?? {}) as [KeepField, string | undefined][]) {
    const v = (value ?? "").trim();
    if (v.length < 2) continue;
    const nv = normalizeText(v);
    for (const line of lines) {
      const n = normalizeWithMap(line.text);
      const at = n.text.indexOf(nv);
      if (at < 0) continue;
      const [s, e] = mapRangeBack(n, line.text, at, at + nv.length);
      out.keep.push({ lineId: line.id, field, start: s, end: e, value: line.text.slice(s, e) });
    }
  }

  // keep pole s termínem / zkratkou firmy → review (pole se nemaže)
  for (const k of out.keep) {
    if (k.field !== "drawingNumber" && k.field !== "title") continue;
    if (containsTerm(k.value, ctx.terms)) out.termInKeep = true;
  }
  // keep pole chrání proti zásahům company/person (ne custom/path/contact — ty se mažou vždy)
  out.hits = out.hits.filter((h) => {
    if (h.category === "custom" || h.category === "path" || h.category === "contact") return true;
    return !out.keep.some((k) => k.lineId === h.lineId && h.start < k.end && h.end > k.start
      && (k.field === "drawingNumber" || k.field === "material" || k.field === "revision" || k.field === "scale"));
  });
  // custom zásah do čísla výkresu / názvu nemaže pole (review)
  out.hits = out.hits.filter((h) => {
    if (h.category !== "custom") return true;
    const inKeep = out.keep.some((k) => k.lineId === h.lineId && h.start < k.end && h.end > k.start && (k.field === "drawingNumber" || k.field === "title"));
    if (inKeep) out.termInKeep = true;
    return !inKeep;
  });
  void byId;
  return out;
}

function looksLikeLabelOnly(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  for (const k of KEEP_LABELS) {
    const m = k.re.exec(t);
    if (m && m.index === 0 && m[0].trim().length >= t.length - 1) return true;
  }
  ANY_ANCHOR_RE.lastIndex = 0;
  const a = ANY_ANCHOR_RE.exec(t);
  return Boolean(a && a.index === 0 && a[0].trim().length >= t.length - 1);
}

/** Je řádek kotvou razítka (popisek osoby nebo keep pole)? (zóny, kvalita textové vrstvy) */
export function isTitleAnchor(text: string): boolean {
  ANY_ANCHOR_RE.lastIndex = 0;
  if (ANY_ANCHOR_RE.test(text)) return true;
  return KEEP_LABELS.some((k) => k.re.test(text));
}

const REVISION_ANCHOR_RE = folded(/(?<![\p{L}])(?:Rev|Revize|Index|Änderung|Änd|Změna|Zm\.|Modif|Modification|Revisione|Revisión|Zmiana|Módosítás|Изм)\.?(?![\p{L}])/iu);
export function isRevisionAnchor(text: string): boolean {
  return REVISION_ANCHOR_RE.test(text);
}

/** Řetězec, který nesmí zůstat ve STEP/DXF (e-mail, doména, právní forma kdekoli). */
export function isSuspiciousLiteral(text: string, keepTerms: readonly string[] = []): boolean {
  if (/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/u.test(text)) return true;
  if (new RegExp(String.raw`(?<![@\p{L}\p{N}.\-])[a-z][a-z0-9-]+\.(?:${TLD})(?![\p{L}\p{N}\-])`, "iu").test(text)) return true;
  // právní forma u NAŠÍ firmy („Výroba pro: Mnástrojárna s.r.o.") není podezřelá
  if (keepTerms.length) {
    const compact = normalizeText(text).replace(/[^\p{L}\p{N}]+/gu, "");
    if (keepTerms.some((k) => { const c = normalizeText(k).replace(/[^\p{L}\p{N}]+/gu, ""); return c.length >= 3 && compact.includes(c); })) return false;
  }
  LEGAL_DOTTED_RE.lastIndex = 0;
  if (LEGAL_DOTTED_RE.test(text)) return true;
  LEGAL_CAPS_RE.lastIndex = 0;
  for (const m of text.matchAll(LEGAL_CAPS_RE)) {
    const before = text.slice(0, m.index ?? 0);
    if (/\p{Lu}[\p{L}\p{N}&.'-]+[\s,]*$/u.test(before) && !/\d\s*$/u.test(before)) return true;
  }
  return false;
}

export { overlapY };
