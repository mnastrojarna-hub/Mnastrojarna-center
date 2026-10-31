/**
 * Tykání / vykání, oslovení a tón e-mailů — čistá logika (testy v tone.test.ts).
 * Nastavení je vždy ODESÍLATELE vůči ADRESÁTOVI (Volný si s Novákem tyká, Šponer vyká).
 * Výchozí stav bez nastavení = vykání, formální tón, „Dobrý den, pane Nováku,".
 */

export type AddressForm = "ty" | "vy";
export type ToneStyle = "formalni" | "neutralni" | "pratelsky";
export type ToneSource = "manual" | "navrh" | "default";

export interface ToneSetting {
  address: AddressForm;
  tone: ToneStyle;
  /** Vlastní oslovení („Ahoj Pavle"), null = vygeneruje se ze jména. */
  salutation: string | null;
  source: ToneSource;
}

export const DEFAULT_TONE: ToneSetting = { address: "vy", tone: "formalni", salutation: null, source: "default" };

export const ADDRESS_LABEL: Record<AddressForm, string> = { ty: "Tykáme", vy: "Vykáme" };
export const TONE_LABEL: Record<ToneStyle, string> = { formalni: "formální", neutralni: "neutrální", pratelsky: "přátelský" };
export const TONE_STYLES: ToneStyle[] = ["formalni", "neutralni", "pratelsky"];

export function isAddressForm(v: unknown): v is AddressForm {
  return v === "ty" || v === "vy";
}
export function isToneStyle(v: unknown): v is ToneStyle {
  return v === "formalni" || v === "neutralni" || v === "pratelsky";
}

/** Řádek DB → nastavení (neplatné hodnoty = výchozí). */
export function toneFromRow(row: { address?: string | null; tone?: string | null; salutation?: string | null; source?: string | null } | null | undefined): ToneSetting {
  if (!row) return { ...DEFAULT_TONE };
  return {
    address: isAddressForm(row.address) ? row.address : "vy",
    tone: isToneStyle(row.tone) ? row.tone : "formalni",
    salutation: cleanSalutation(row.salutation),
    source: row.source === "navrh" ? "navrh" : "manual",
  };
}

/** Oslovení bez koncové čárky a mezer (max 120 znaků), prázdné → null. */
export function cleanSalutation(v: string | null | undefined): string | null {
  const s = String(v ?? "").replace(/\s+/g, " ").trim().replace(/[,\s]+$/, "").slice(0, 120);
  return s || null;
}

// ── Jméno → rod, křestní jméno, příjmení ───────────────────
export type Gender = "m" | "f" | "?";

export interface ParsedName {
  first: string | null;
  last: string | null;
  gender: Gender;
}

const TITLE_RE = /^(ing|mgr|bc|bca|dr|mudr|judr|phdr|rndr|paeddr|mvdr|ing\.arch|arch|doc|prof|ph\.?d|csc|drsc|dis|mba|msc|bsc|ll\.?m|dipl\.?-?ing|herr|frau|pan|paní|pani|mr|mrs|ms)\.?$/i;

/** Mužská křestní jména zakončená na -a (Honza, Jirka…) — jinak „-a" = žena. */
const MALE_A = new Set(["honza", "jirka", "míla", "mila", "kuba", "nikola", "sáva", "luca", "andrea", "ilja", "saša", "sasa", "jarda", "pepa", "franta", "tonda", "vláďa", "vlada", "láďa", "lada", "míra", "mira", "standa", "zbyňa", "kája", "kaja", "venca", "vojta", "matěja", "ota", "joshua"]);
/** Častá ženská jména bez -a / -e (Dagmar, Ester…). */
const FEMALE_OTHER = new Set(["dagmar", "ester", "miriam", "carmen", "ingrid", "rút", "ruth", "edith", "karin", "kristýn", "sharon", "ellen", "doris", "iris", "yvonne", "nicole", "michelle", "isabel", "beatrix", "agnes"]);
/** Známá česká křestní jména (aby jediné slovo bylo křestní jméno, ne příjmení). */
const KNOWN_FIRST = new Set([
  "jan", "petr", "pavel", "jiří", "jiri", "josef", "tomáš", "tomas", "martin", "jaroslav", "miroslav", "zdeněk", "zdenek", "václav", "vaclav",
  "michal", "karel", "milan", "lukáš", "lukas", "david", "jakub", "ondřej", "ondrej", "vladimír", "vladimir", "ladislav", "roman", "stanislav",
  "marek", "radek", "daniel", "aleš", "ales", "filip", "vojtěch", "vojtech", "adam", "libor", "antonín", "antonin", "matěj", "matej", "dominik",
  "patrik", "jindřich", "jindrich", "luboš", "lubos", "miloš", "milos", "igor", "viktor", "oldřich", "oldrich", "ivan", "robert", "richard",
  "jana", "marie", "eva", "hana", "anna", "lenka", "kateřina", "katerina", "lucie", "věra", "vera", "petra", "alena", "ivana", "monika",
  "zuzana", "jitka", "martina", "jaroslava", "markéta", "marketa", "barbora", "veronika", "michaela", "tereza", "kristýna", "kristyna",
  "klára", "klara", "pavla", "dana", "helena", "ludmila", "irena", "simona", "šárka", "sarka", "romana", "radka", "olga", "renata", "andrea",
  "honza", "jirka", "kuba", "klaus", "peter", "thomas", "michael", "stefan", "andreas", "markus", "frank", "john", "paul", "mark",
]);

function stripPunct(s: string): string {
  return s.replace(/^[„"'(]+|[,"'”“)]+$/g, "");
}

/** „Ing. Pavel Novák, Ph.D." → { first: Pavel, last: Novák, gender: m }. Pořadí „Novák Pavel" pozná u známých jmen. */
export function parseName(full: string | null | undefined): ParsedName {
  const raw = String(full ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[|/].*$/, " ")
    .replace(/\(.*?\)/g, " ")
    .trim();
  if (!raw || raw.includes("@")) return { first: null, last: null, gender: "?" };
  // „Novák, Pavel" → Pavel Novák
  const commaSwap = /^([^,]+),\s*([^,]+)$/.exec(raw);
  const base = commaSwap && !TITLE_RE.test(commaSwap[2].trim()) ? `${commaSwap[2]} ${commaSwap[1]}` : raw.split(",")[0];
  const words = base.split(/\s+/).map(stripPunct).filter((w) => w && !TITLE_RE.test(w) && /\p{L}/u.test(w));
  if (!words.length) return { first: null, last: null, gender: "?" };
  let first: string | null = null;
  let last: string | null = null;
  if (words.length === 1) {
    if (KNOWN_FIRST.has(words[0].toLowerCase())) first = words[0];
    else last = words[0];
  } else {
    first = words[0];
    last = words[words.length - 1];
    // „Novák Pavel" (příjmení napřed) — jen když je druhé známé křestní a první ne
    if (!KNOWN_FIRST.has(first.toLowerCase()) && KNOWN_FIRST.has(last.toLowerCase())) [first, last] = [last, first];
  }
  return { first: first ? cap(first) : null, last: last ? cap(last) : null, gender: genderOf(first, last) };
}

function cap(s: string): string {
  // „NOVÁK" → „Novák" (velkými jen celé slovo), jinak beze změny
  if (s.length > 1 && s === s.toUpperCase()) return s.charAt(0) + s.slice(1).toLowerCase();
  return s;
}

function genderOf(first: string | null, last: string | null): Gender {
  const l = (last ?? "").toLowerCase();
  const f = (first ?? "").toLowerCase();
  if (/ová$/.test(l) && l.length > 3) return "f"; // Nováková (i „Nikola Nováková")
  if (f) return isFemaleFirst(f) ? "f" : "m"; // křestní jméno rozhoduje (Pavel Skála, Jana Novotná)
  if (/á$/.test(l) && l.length > 2) return "f"; // jen příjmení: Nová, Černá, Dvorská
  return last ? "m" : "?";
}

function isFemaleFirst(f: string): boolean {
  if (MALE_A.has(f)) return false;
  if (FEMALE_OTHER.has(f)) return true;
  return /[ae]$|ie$/.test(f) && !/(ře|é)$/.test(f) && f !== "rené" && f !== "rene";
}

// ── 5. pád (vokativ) ────────────────────────────────────────
const SOFT_END = /[šžčřcjťďňx]$/i;
const EL_LE = new Set(["pavel", "karel", "havel"]);

/** Mužské jméno / příjmení v 5. pádě: Pavel → Pavle, Novák → Nováku, Petr → Petře, Tomáš → Tomáši. */
export function vocativeMale(word: string): string {
  const w = word.trim();
  if (!w) return w;
  const lower = w.toLowerCase();
  const keep = (s: string) => s;
  if (/[ýíoeiuyé]$/i.test(w)) return keep(w); // Novotný, Jiří, Ivo, René
  if (/a$/i.test(w)) return `${w.slice(0, -1)}o`; // Svoboda → Svobodo, Honza → Honzo
  if (EL_LE.has(lower)) return `${w.slice(0, -2)}le`; // Pavel → Pavle, Karel → Karle
  if (/(i|a|u)el$/i.test(w)) return `${w}i`; // Daniel → Danieli, Michael → Michaeli, Samuel → Samueli
  if (lower === "němec") return `${w.slice(0, -2)}če`;
  if (/děk$/i.test(w)) return `${w.slice(0, -3)}ďku`;
  if (/těk$/i.test(w)) return `${w.slice(0, -3)}ťku`;
  if (/něk$/i.test(w)) return `${w.slice(0, -3)}ňku`; // Zdeněk → Zdeňku, Vaněk → Vaňku
  if (/ek$/i.test(w)) return `${w.slice(0, -2)}ku`; // Marek → Marku, Jelínek → Jelínku
  if (/(k|g|h|ch)$/i.test(w)) return `${w}u`; // Novák → Nováku, Oldřich → Oldřichu
  if (/ec$/i.test(w)) return `${w}i`; // Kadlec → Kadleci
  if (/[^aeiouyáéíóúůýě]r$/i.test(w)) return `${w.slice(0, -1)}ře`; // Petr → Petře, Alexandr → Alexandře
  if (SOFT_END.test(w) || /s$/i.test(w)) return `${w}i`; // Tomáš → Tomáši, Ondřej → Ondřeji, Klaus → Klausi
  return `${w}e`; // Jan → Jane, Šponer → Šponere, Václav → Václave
}

/** Ženské křestní jméno v 5. pádě: Jana → Jano, Lucie → Lucie, Dagmar → Dagmar. */
export function vocativeFemaleFirst(word: string): string {
  const w = word.trim();
  if (/a$/i.test(w)) return `${w.slice(0, -1)}o`;
  return w;
}

/** Křestní jméno v 5. pádě podle rodu. */
export function vocativeFirst(first: string, gender: Gender): string {
  return gender === "f" ? vocativeFemaleFirst(first) : vocativeMale(first);
}

/** Příjmení v 5. pádě pro „pane / paní …" (ženská příjmení se nemění: paní Nováková). */
export function vocativeLast(last: string, gender: Gender): string {
  return gender === "f" ? last : vocativeMale(last);
}

// ── Oslovení ────────────────────────────────────────────────
/**
 * První řádek e-mailu (s čárkou): vykání formálně „Dobrý den, pane Nováku," / „Dobrý den, paní Nováková,",
 * neutrálně „Dobrý den,", tykání „Ahoj Pavle," (formální tykání „Dobrý den, Pavle,"). Vlastní oslovení má přednost.
 */
export function salutationFor(setting: Pick<ToneSetting, "address" | "tone" | "salutation">, name: string | null | undefined): string {
  const own = cleanSalutation(setting.salutation);
  if (own) return `${own},`;
  const p = parseName(name);
  if (setting.address === "ty") {
    const first = p.first ? vocativeFirst(p.first, p.gender) : null;
    if (setting.tone === "formalni") return first ? `Dobrý den, ${first},` : "Dobrý den,";
    return first ? `Ahoj ${first},` : "Ahoj,";
  }
  if (setting.tone === "neutralni" || !p.last || p.gender === "?") return "Dobrý den,";
  return `Dobrý den, ${p.gender === "f" ? "paní" : "pane"} ${vocativeLast(p.last, p.gender)},`;
}

/** Krátký popis pro UI: „Tykáme · přátelský · Ahoj Pavle,". */
export function toneSummary(setting: ToneSetting, name: string | null | undefined): string {
  return `${ADDRESS_LABEL[setting.address]} · ${TONE_LABEL[setting.tone]} · ${salutationFor(setting, name)}`;
}

/**
 * Pokyn pro AI (systémový prompt): tykání / vykání, tón a PŘESNÝ první řádek. Podpis a závěrečný pozdrav
 * dál doplňuje aplikace (prompty se nepodepisují).
 */
export function toneInstruction(setting: ToneSetting, name: string | null | undefined): string {
  const hello = salutationFor(setting, name);
  const who = (name ?? "").trim();
  const address = setting.address === "ty"
    ? "Adresátovi TYKÁŠ — piš ve 2. osobě jednotného čísla (ty, tvůj, máš, pošli, dej vědět), malými písmeny, bez „Vy/Vám/Váš“. Za firmu můžeš psát v 1. osobě množného čísla (posíláme)."
    : "Adresátovi VYKÁŠ — Vy, Vám, Váš s velkým V (zdvořilé vykání).";
  const tone = setting.tone === "pratelsky"
    ? "Tón: přátelský a osobní, ale věcný a profesionální."
    : setting.tone === "neutralni"
      ? "Tón: neutrální, věcný a stručný."
      : "Tón: formální, zdvořilý, obchodní.";
  return [
    `Adresát${who ? `: ${who}` : ""}. ${address} ${tone}`,
    `První řádek e-mailu musí být přesně „${hello}“ a za ním prázdný řádek.`,
  ].join(" ");
}

const GREETING_LINE_RE = /^\s*(dobrý den|dobry den|dobrý večer|ahoj|čau|cau|zdravím|zdravim|vážen[ýáí]|vazen[ya]|hezký den|hello|hi|dear|sehr geehrte[rs]?|guten tag|hallo)\b[^\n]*\n?/i;

/** Nahradí první řádek s pozdravem (nebo ho doplní na začátek) — návrh pak sedí k tykání / vykání. */
export function applySalutation(body: string, salutation: string): string {
  const text = String(body ?? "").replace(/^\s*\n/, "");
  const m = GREETING_LINE_RE.exec(text);
  if (m && m.index === 0) {
    const rest = text.slice(m[0].length).replace(/^\s*\n?/, "");
    return `${salutation}\n\n${rest}`;
  }
  return text.trim() ? `${salutation}\n\n${text}` : `${salutation}\n\n`;
}

/** Začíná text pozdravem? (aby se pozdrav nepřidal dvakrát). */
export function startsWithGreeting(body: string): boolean {
  const m = GREETING_LINE_RE.exec(String(body ?? "").replace(/^\s*\n/, ""));
  return Boolean(m && m.index === 0);
}

/** Několik adresátů: nastavení hlavního (Komu), různá nastavení → formální vykání bez jména. */
export function combineTones(list: ToneSetting[]): { setting: ToneSetting; mixed: boolean } {
  if (!list.length) return { setting: { ...DEFAULT_TONE }, mixed: false };
  const first = list[0];
  const same = list.every((t) => t.address === first.address && t.tone === first.tone);
  if (same) return { setting: first, mixed: false };
  return { setting: { address: "vy", tone: "neutralni", salutation: null, source: "default" }, mixed: true };
}

// ── Návrh z odeslané pošty („napsal jsi Ahoj / tě" → tykáte?) ──
export interface ToneSuggestion {
  address: AddressForm;
  /** Oslovení z poslední zprávy („Ahoj Pavle"), když tam bylo. */
  salutation: string | null;
  /** Kolik zpráv to dokládá. */
  evidence: number;
  /** Úryvek pro UI („Ahoj Pavle, posílám ti…"). */
  sample: string;
}

const TY_GREETING = /^\s*(ahoj|čau|cau|čus|cus|nazdar|zdar|zdravím tě|zdravim te|servus)\b/i;
const TY_WORDS = /(^|[^\p{L}])(tě|ti|tebe|tobě|tvůj|tvoje|tvou|tvá|tvého|tvým|tvoji|máš|můžeš|budeš|pošli|dej vědět|napiš|zavolej|jsi|víš|potřebuješ|chceš|děkuju ti)(?=$|[^\p{L}])/iu;
const VY_WORDS = /(^|[^\p{L}])(Vás|Vám|Váš|Vaše|Vaši|Vašeho|Vaším|máte|můžete|budete|pošlete|dejte vědět|napište|zavolejte|jste|potřebujete|chcete)(?=$|[^\p{L}])/u;

/** Jen vlastní text zprávy (bez citace odpovědi a podpisu). */
export function ownPart(body: string): string {
  const lines = String(body ?? "").replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const l of lines) {
    if (/^\s*>/.test(l)) break;
    if (/^\s*(-{2,}\s*$|-{3,}|_{5,}|-----\s*(original|původní))/i.test(l)) break;
    if (/^\s*(dne|on)\s.+(napsal|napsala|wrote|schrieb)/i.test(l)) break;
    if (/^\s*(od|from|von):\s/i.test(l)) break;
    out.push(l);
  }
  return out.join("\n").slice(0, 1500);
}

/**
 * Odhad tykání z mých dřívějších zpráv adresátovi (nejnovější první). Vrací návrh jen při jasných
 * signálech (pozdrav „Ahoj", tvary „tě / máš") převažujících nad vykáním; jinak null.
 */
export function suggestToneFromTexts(bodies: string[]): ToneSuggestion | null {
  let ty = 0;
  let vy = 0;
  let salutation: string | null = null;
  let sample = "";
  for (const raw of bodies.slice(0, 12)) {
    const own = ownPart(raw).trim();
    if (!own) continue;
    const firstLine = own.split("\n").find((l) => l.trim()) ?? "";
    const greetTy = TY_GREETING.test(firstLine);
    const wordsTy = TY_WORDS.test(own);
    const wordsVy = VY_WORDS.test(own);
    if (greetTy || (wordsTy && !wordsVy)) {
      ty++;
      if (!sample) sample = own.replace(/\s+/g, " ").slice(0, 90);
      if (!salutation && greetTy) salutation = cleanSalutation(firstLine.split(/[,!\n]/)[0]);
    } else if (wordsVy || /^\s*(dobrý den|vážen)/i.test(firstLine)) {
      vy++;
    }
  }
  if (ty === 0 || ty <= vy) return null;
  return { address: "ty", salutation, evidence: ty, sample };
}

// ── Šablony textů (doklady, objednávky): tykání / vykání ───
/** Vybere tvar podle oslovení: tv("Vám", "ti"). */
export function addressPicker(address: AddressForm | null | undefined): (vy: string, ty: string) => string {
  return (vy, ty) => (address === "ty" ? ty : vy);
}
