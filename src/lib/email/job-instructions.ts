import { findHardness, HEAT_KINDS, SURFACE_KINDS } from "@/lib/jobs/material-groups";
import type { HeatStep, HeatStepKind, SurfaceStep, SurfaceStepKind } from "@/lib/jobs/drawing-spec";
import { normToken } from "@/lib/email/job-match";

/**
 * Pošta B — technické a obchodní informace z e-mailu k zakázce (čistá logika, testy v
 * job-instructions.test.ts). Majitel 29. 10.: „text v mailu u zákazníka, když je tam třeba ‚ale prosím
 * kalit', tak je to nadřazený úplně všemu, včetně výkresu".
 *
 *  1. cleanMailText — bez citované historie (> …, „Dne … napsal(a):", „-----Original Message-----",
 *     hlavička přeposlání), bez podpisu a právních doložek,
 *  2. isNoiseOnly — „děkuji", „ok", „v pořádku" … = nic k zápisu,
 *  3. extractInstructions — pravidla (čeština, část němčiny / angličtiny): počet, materiál, tepelné
 *     zpracování, povrchová úprava, tvrdost, rozměry / tolerance, označení / popis, revize výkresu,
 *     termín, dodací adresa, balení, cena / podmínky, storno,
 *  4. itemPatchFor — změna položky zakázky (pokyn zákazníka z e-mailu je NADŘAZENÝ výkresu): skupina
 *     údajů dostane zdroj „rucne" (spec_sources), takže ji pozdější čtení výkresu / dávka nepřepíše
 *     (mergeSpecPatch ji ponechá a ohlásí) — precedence text e-mailu > objednávka > nabídka > výkres.
 */

export type MailChangeField =
  | "quantity" | "material" | "heat" | "surface" | "hardness" | "dimension" | "tolerance" | "marking" | "revision"
  | "deadline" | "address" | "packaging" | "price" | "terms" | "cancel";

export const MAIL_CHANGE_FIELDS: readonly MailChangeField[] = [
  "quantity", "material", "heat", "surface", "hardness", "dimension", "tolerance", "marking", "revision",
  "deadline", "address", "packaging", "price", "terms", "cancel",
];

export const FIELD_LABEL: Record<MailChangeField, string> = {
  quantity: "Počet kusů",
  material: "Materiál",
  heat: "Tepelné zpracování",
  surface: "Povrchová úprava",
  hardness: "Tvrdost",
  dimension: "Rozměry",
  tolerance: "Tolerance",
  marking: "Označení / popis",
  revision: "Revize výkresu",
  deadline: "Termín",
  address: "Dodací adresa",
  packaging: "Balení",
  price: "Cena",
  terms: "Podmínky",
  cancel: "Storno",
};

/** Pole, která mění POLOŽKU zakázky (pokyn nadřazený výkresu). Ostatní jdou do historie / poznámky. */
export const ITEM_FIELDS: readonly MailChangeField[] = ["quantity", "material", "heat", "surface", "hardness", "revision", "marking", "dimension", "tolerance"];

export function isMailChangeField(v: unknown): v is MailChangeField {
  return typeof v === "string" && (MAIL_CHANGE_FIELDS as readonly string[]).includes(v);
}

export interface MailInstruction {
  field: MailChangeField;
  /** Text do historie („Tepelné zpracování: kalení"). */
  summary: string;
  /** Nová hodnota (text). */
  value: string | null;
  /** Původní hodnota podle e-mailu („místo 20"). */
  oldValue?: string | null;
  /** Výkres, kterého se pokyn týká (je-li v téže větě). */
  drawingNumber?: string | null;
  /** Věta z e-mailu. */
  quote: string;
  quantity?: number;
  quantityFrom?: number;
  heat?: { status: "uvedeno" | "bez"; kind?: HeatStepKind; label: string; hardness?: string | null };
  surface?: { status: "uvedeno" | "bez"; kind?: SurfaceStepKind; label: string };
  material?: string;
  revision?: string;
}

// ── 1) Čištění textu ────────────────────────────────────────

export function fold(s: string | null | undefined): string {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const QUOTE_HEADER_RE = /^\s*(dne\s.+(napsal|napsala|napsal\(a\)|wrote)\s*:?\s*$|on\s.+wrote:?\s*$|am\s.+schrieb.*:?\s*$|-{2,}\s*(p[uů]vodn[ií]|original|p[rř]eposlan[aá]|forwarded|weitergeleitete)\b.*$|_{5,}\s*$)/i;
const HEADER_LINE_RE = /^\s*(od|from|odesl[aá]no|sent|datum|date|komu|to|kopie|cc|p[rř]edm[eě]t|subject|von|an|betreff|gesendet)\s*:/i;
const SIGNATURE_START_RE = /^\s*(--\s*|s\s+pozdravem|s\s+p[rř][aá]telsk[yý]m\s+pozdravem|se\s+srde[cč]n[yý]m\s+pozdravem|d[eě]kuji\s+a\s+zdrav[ií]m|zdrav[ií]m|pozdravem|best\s+regards|kind\s+regards|regards|mit\s+freundlichen\s+gr[uü](ß|ss)en|mfg|viele\s+gr[uü](ß|ss)e|sent\s+from\s+my|odesl[aá]no\s+z\s+(m[eé]ho\s+)?(iphone|androidu|mobilu|telefonu))[,.!]?\s*$/i;
const DISCLAIMER_RE = /^\s*(tento\s+e-?mail|this\s+e-?mail|upozorn[eě]n[ií]\s*:|disclaimer|confidentiality|obsah\s+t[eé]to\s+zpr[aá]vy|p[rř]ed\s+vytisknut[ií]m)/i;

/** Tělo e-mailu bez citované historie, hlavičky přeposlání, podpisu a doložek. */
export function cleanMailText(body: string | null | undefined): string {
  const lines = (body ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*>/.test(line)) continue;
    if (QUOTE_HEADER_RE.test(line)) break;
    // „Dne … <" + zalomený řádek „adresa> napsal:" (Gmail / Outlook zalamují hlavičku citace)
    if (/^\s*(dne|on|am)\s/i.test(line) && /(napsal\w*(\(a\))?|wrote|schrieb)\s*:?\s*$/i.test(lines[i + 1] ?? "")) break;
    if (HEADER_LINE_RE.test(line) && /^\s*(od|from|von)\s*:/i.test(line)) {
      const next = lines.slice(i + 1, i + 5);
      if (next.some((l) => HEADER_LINE_RE.test(l))) break; // hlavička citované / přeposlané zprávy
    }
    if (SIGNATURE_START_RE.test(line)) break;
    if (DISCLAIMER_RE.test(line)) break;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const NOISE_WORDS = new Set([
  "dobry", "den", "dekuji", "dekujeme", "diky", "dik", "moc", "mnohokrat", "predem", "ok", "okay", "oki", "dobre", "v", "poradku",
  "super", "prijato", "potvrzuji", "potvrzujeme", "prijeti", "zdravim", "pozdravem", "s", "rozumim", "beru", "na", "vedomi",
  "hezky", "pekny", "den", "vecer", "thanks", "thank", "you", "received", "hello", "hi", "dear", "regards", "danke", "vielen",
  "a", "i", "to", "je", "jsem", "jsme", "vas", "vam", "pane", "pani", "ahoj", "dobrou", "nashledanou", "fajn", "jasne", "tak",
  "za", "informaci", "informace", "zpravu", "zaslani", "odpoved", "rychlou", "ozvu", "ozveme", "se", "brzy", "mail", "email",
]);

/** Jen poděkování / potvrzení / pozdrav — nic technického. */
export function isNoiseOnly(text: string | null | undefined): boolean {
  const words = fold(text).replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const rest = words.filter((w) => !NOISE_WORDS.has(w) && !/^[a-z]$/.test(w));
  return rest.join("").length < 8;
}

// ── 2) Pravidla ─────────────────────────────────────────────

/** Věty (řádky, „. ", „!", „?", „;") — bez rozdělení desetinných čísel a dat („1.4301", „15. 11."). */
export function splitSentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[!?;])\s+|(?<![\d\s][\d])\.\s+(?=[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ])/u)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 3);
}

/**
 * Celé číslo kusů — ne část desetinného čísla, data nebo označení („1.4301", „15.11", „1/2026"):
 * před ním ani za ním nesmí být číslice přes tečku / čárku / lomítko.
 */
const NUM = "(?<![\\d.,/])(\\d{1,6}(?:[  ]\\d{3})?)(?![.,/]?\\d)";
const PCS = "(?:ks|kus[uůy]?|kusech|pcs|pc|stk|st[uü]ck)";
const PCS_RE = new RegExp(`\\d\\s*${PCS}\\b`, "iu");
const QTY_INSTEAD = new RegExp(`${NUM}\\s*${PCS}?\\s*(?:m[ií]sto|nam[ií]sto|instead\\s+of|statt|anstatt)\\s*(?:p[uů]vodn[ií]ch\\s+)?${NUM}\\s*${PCS}?`, "iu");
const QTY_INSTEAD_REV = new RegExp(`(?:m[ií]sto|nam[ií]sto|instead\\s+of|statt)\\s*(?:p[uů]vodn[ií]ch\\s+)?${NUM}\\s*${PCS}?\\s*(?:bude|budeme|chceme|chci|pot[rř]ebujeme|objedn[aá]v[aá]me|pros[ií]me|pros[ií]m|po[sš]lete|dodejte|vyrobte|jen|pouze)?\\s*(?:jen|pouze)?\\s*${NUM}\\s*${PCS}`, "iu");
const QTY_CHANGE = new RegExp(`(?:zm[eě]n\\w*|nav[yý][sš]\\w*|sn[ií][zž]\\w*|upravt\\w*|uprav\\w*|zv[yý][sš]\\w*|nov[eě]|celkem|potřebujeme|pot[rř]ebujeme\\s+celkem)\\s+(?:po[cč]et|mno[zž]stv[ií])?\\s*(?:kus[uů]\\s*)?(?:na|je|bude|:)?\\s*${NUM}\\s*${PCS}`, "iu");
/** „místo" bez jednotky je počet jen ve větě o počtu kusů („počet 30 místo 20"). */
const QTY_WORD_RE = /\b(po[cč]et\w*|kus\w*|mno[zž]stv\w*)\b/iu;

function toInt(s: string | undefined): number | null {
  if (!s) return null;
  const n = Number(s.replace(/[\s  ]/g, ""));
  return Number.isFinite(n) && n > 0 && n < 10_000_000 ? Math.round(n) : null;
}

interface HeatRule { re: RegExp; kind: HeatStepKind }
const HEAT_RULES: HeatRule[] = [
  { re: /\bindukcn\w*\s+(za)?kal/, kind: "indukcni_kaleni" },
  { re: /\bzuslecht/, kind: "zuslechteni" },
  { re: /\bcement(ovat|ovani|ace|ujte|ovany)/, kind: "cementace" },
  { re: /\bkarbonitrid/, kind: "karbonitridace" },
  { re: /\bnitrocement/, kind: "nitrocementace" },
  { re: /\bnitrid(ovat|ovani|ace|ujte|ovany)/, kind: "nitridace" },
  { re: /\b(za|pro)?kal(it|eni|te|ime|ene|eny|eno|ime)\b|\bkalen[iy]\b|\bharten\b|\bgeh[aä]rtet|\bhardened?\b|\bhardening\b/, kind: "kaleni" },
  { re: /\bpopust(it|eni|te)/, kind: "popousteni" },
  { re: /\bzihat\b|\bzihani\b|\bvyzihat/, kind: "zihani" },
];
const HEAT_NONE_RE = /\b(bez\s+(tepeln\w+\s+zpracov\w+|kalen\w*|tz\b|zakalen\w*)|nekal(it|te|ime)?\b|nezakal\w*|kalen\w*\s+(neni|nebude)\s+(potreba|treba|nutne)|(zrus\w*|vynech\w*)\s+(kalen\w*|tepeln\w+\s+zpracov\w+))/;

interface SurfaceRule { re: RegExp; kind: SurfaceStepKind }
const SURFACE_RULES: SurfaceRule[] = [
  { re: /\bgalvanick\w*\s+(po)?zin|\b(po)?zinkov\w*\s+galvanick/, kind: "galvanicky_zinek" },
  { re: /\b(po)?zinkov|\bzinek\b|\bzinkem\b|\bverzink/, kind: "zinkovani" },
  { re: /\belox/, kind: "eloxovani" },
  { re: /\bcern(it|eni|ene|ete)|\bbrunyr|\bbrunir/, kind: "cerneni" },
  { re: /\btvrdochrom/, kind: "tvrdochrom" },
  { re: /\bchromov|\bpochrom/, kind: "chromovani" },
  { re: /\bchemick\w*\s+nikl/, kind: "chemicky_nikl" },
  { re: /\bniklov|\bponiklov/, kind: "niklovani" },
  { re: /\bpraskov\w*\s+lak|\bkomaxit|\bpraskov/, kind: "praskove_lakovani" },
  { re: /\blakov|\bnalakov|\bnater/, kind: "lakovani" },
  { re: /\bfosfat/, kind: "fosfatovani" },
  { re: /\btryska|\bpiskov/, kind: "tryskani" },
  { re: /\bpasivac|\bpasivov/, kind: "pasivace" },
];
const SURFACE_NONE_RE = /\b(bez\s+(povrchov\w+\s+uprav\w*|pu\b|upravy\s+povrchu|povrch\w*\s+uprav\w*)|nepovrchov\w*|(zrus\w*|vynech\w*)\s+(povrchov\w+\s+uprav\w*|zinkovani|eloxovani|cerneni)|ohne\s+oberfl)/;

const MATERIAL_RE = /\b(?:materi[aá]l\w*|mat\.|werkstoff|material)\s*(?:[:=\-–]\s*|bude\s+|zm[eě]nit\s+na\s+|zm[eě]na\s+na\s+|nov[eě]\s+|je\s+|z\s+)?(?:(?:ocel|nerez|hlin[ií]k)\s+)?([0-9]\.[0-9]{4}(?:\+[A-Z]{1,3})?|[0-9]{2}\s?[0-9]{3}(?:\.[0-9])?|EN\s?AW-?[0-9]{4}(?:-T[0-9])?|[A-Z][A-Z0-9]{0,6}[0-9][A-Za-z0-9+.\-]{0,12}|(?:nerez|hlin[ií]k|mosaz|m[eě][dď]|bronz|POM|PA6|PE|PTFE|PEEK)\b)/iu;
const MAT = "[0-9]\\.[0-9]{4}(?:\\+[A-Z]{1,3})?|[0-9]{2}\\s?[0-9]{3}(?:\\.[0-9])?|EN\\s?AW-?[0-9]{4}(?:-T[0-9])?|[A-Z][A-Z0-9]{1,6}[0-9][A-Za-z0-9+.\\-]{0,12}";
/** „materiál 1.4301 místo 1.4305" (nový materiál první). */
const MATERIAL_X_INSTEAD_RE = new RegExp(`\\bmateri[aá]l\\w*\\s*(?:[:=]\\s*|bude\\s+|pros[ií]m\\s+)?(${MAT})\\s+(?:m[ií]sto|nam[ií]sto|instead\\s+of|statt)\\s+(?:materi[aá]lu\\s+)?(${MAT})`, "iu");
const MATERIAL_INSTEAD_RE = /\bm[ií]sto\s+(?:materi[aá]lu\s+)?([0-9]\.[0-9]{4}|[0-9]{2}\s?[0-9]{3}(?:\.[0-9])?|[A-Z][A-Z0-9]{1,6}[0-9][A-Za-z0-9+.\-]{0,12})\s+(?:bude|pou[zž]ijte|pros[ií]m|chceme|vyrobte\s+z)?\s*([0-9]\.[0-9]{4}|[0-9]{2}\s?[0-9]{3}(?:\.[0-9])?|[A-Z][A-Z0-9]{1,6}[0-9][A-Za-z0-9+.\-]{0,12})/iu;
const REVISION_RE = /\b(?:nov[aáé]\s+|platn[aáé]\s+|aktu[aá]ln[ií]\s+|posledn[ií]\s+)?(?:revize|revizi|rev\.|index|stav)\s*(?:v[yý]kresu\s+)?(?:je\s+|bude\s+|:\s*)?([A-Z]{1,2}|\d{1,3}|[A-Z]\d{1,2})\b/u;
/** „15. 11. 2026", „15.11.", „15.11" (bez tečky na konci jen když nenásleduje další číslice — ne „1.4301"). */
const DATE_RE = /(?<![\d.])(\d{1,2})\.\s?(\d{1,2})(?:\.(?:\s?(\d{4}|\d{2})(?!\d))?|(?![\d.]))/;
const DATE_RE_G = new RegExp(DATE_RE.source, "g");
const MATERIAL_RE_G = new RegExp(MATERIAL_RE.source, "giu");

/** Rozsahy (od, do) shod regexu ve větě — počet uvnitř materiálu / data se nebere. */
function spans(re: RegExp, s: string): [number, number][] {
  return [...s.matchAll(re)].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length]);
}

function overlapsAny(at: number, len: number, list: readonly [number, number][]): boolean {
  return list.some(([a, b]) => at < b && at + len > a);
}

function validDate(m: RegExpExecArray): boolean {
  const d = Number(m[1]);
  const mo = Number(m[2]);
  return d >= 1 && d <= 31 && mo >= 1 && mo <= 12;
}

/** Sloveso změny / pokynu (složené bez diakritiky). */
const CHANGE_VERB_RE = /\b(pros\w*|zmen\w*|zmn\w*|uprav\w*|oprav\w*|ma\s+byt|maji\s+byt|musi\s+byt|bude|budou|misto|namisto|nove|nova|novy|upresn\w*|zkrat\w*|prodlouz\w*|zvets\w*|zmens\w*|potrebujeme|pozadujeme|vyrobte|dodrz\w*|bitte|please|change|instead)\b/;
/** Hodnota s jednotkou rozměru / úhlu. */
const DIM_VALUE_RE = /\d+(?:[.,]\d+)?\s?(mm|cm|µm|um|m)\b|\d\s?°|[øØ⌀]\s?\d|\bR\s?\d|\bM\d{1,2}\b/u;
/** Toleranční zápis s hodnotou („±0,05", „+0,1/-0", „20 h7", „ø20H7", „IT7", „Ra 1,6"); samotné „H7" nestačí. */
const TOL_VALUE_RE = /±\s?\d|\+\/-\s?\d|[+-]\s?0[.,]\d|\d\s?[A-Za-z]{1,2}\d{1,2}\b|\bIT\s?\d{1,2}\b|\bRa\s?\d/u;

function sentenceHas(f: string, re: RegExp): boolean {
  return re.test(f);
}

const INSTEAD_WORD_RE = /\b(misto|namisto|instead\s+of|anstatt|statt)\b/;

/**
 * Dva různé druhy úpravy ve větě s „místo" („kalit místo nitridovat", „místo nitridace prosím kalit"):
 * původní = ten hned za „místo", nový = ten druhý. Jinak null (bez „místo" platí pořadí pravidel).
 */
function insteadKinds<K extends string>(f: string, rules: readonly { re: RegExp; kind: K }[]): { to: K; from: K } | null {
  const w = INSTEAD_WORD_RE.exec(f);
  if (!w) return null;
  const hits: { kind: K; at: number; end: number }[] = [];
  for (const r of rules) {
    const m = r.re.exec(f);
    if (!m) continue;
    const at = m.index;
    const end = at + m[0].length;
    if (hits.some((h) => at < h.end && end > h.at) || hits.some((h) => h.kind === r.kind)) continue;
    hits.push({ kind: r.kind, at, end });
  }
  if (hits.length !== 2) return null;
  const wEnd = w.index + w[0].length;
  const after = hits.filter((h) => h.at >= wEnd).sort((a, b) => a.at - b.at)[0];
  if (!after) return null;
  const other = hits.find((h) => h !== after)!;
  return { to: other.kind, from: after.kind };
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function plainLabel(s: string): string {
  return s.replace(/\s*\(.*\)\s*$/, "").trim();
}

function clip(s: string, max = 180): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Čísla výkresů (ze zakázky), která věta zmiňuje. */
function drawingIn(sentence: string, drawingNumbers: readonly string[]): string | null {
  const norm = normToken(sentence.replace(/[^\p{L}\p{N}\s.\-/]/gu, " ")) ?? "";
  const tokens = new Set(sentence.split(/[\s,;:()]+/).map((w) => normToken(w)).filter(Boolean) as string[]);
  for (const d of drawingNumbers) {
    const n = normToken(d);
    if (n && n.length >= 3 && (tokens.has(n) || (n.length >= 5 && norm.includes(n)))) return d;
  }
  return null;
}

function dateText(m: RegExpExecArray, now: Date): string {
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = m[3] ? Number(m[3]) : now.getFullYear();
  if (y < 100) y += 2000;
  return `${d}. ${mo}. ${y}`;
}

/**
 * Technické a obchodní změny / upřesnění z (vyčištěného) textu e-mailu. Bez šumu: poděkování,
 * potvrzení přijetí, pozdravy a citovaná historie nic nevytvoří.
 */
export function extractInstructions(
  rawText: string | null | undefined,
  opts: { drawingNumbers?: readonly string[]; cleaned?: boolean; now?: Date } = {},
): MailInstruction[] {
  const text = opts.cleaned ? (rawText ?? "") : cleanMailText(rawText);
  if (!text || isNoiseOnly(text)) return [];
  const drawings = opts.drawingNumbers ?? [];
  const now = opts.now ?? new Date();
  const out: MailInstruction[] = [];
  const seen = new Set<string>();
  const push = (i: MailInstruction) => {
    const key = `${i.field}|${fold(i.summary)}|${normToken(i.drawingNumber) ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(i);
  };

  for (const s of splitSentences(text)) {
    const f = fold(s);
    const quote = clip(s, 300);
    const dn = drawingIn(s, drawings);

    // počet kusů (ne čísla uvnitř materiálu / data; „místo" jen s jednotkou nebo ve větě o počtu)
    const blocked = [...spans(MATERIAL_RE_G, s), ...spans(DATE_RE_G, s)];
    const okQty = (m: RegExpExecArray | null, needUnit: boolean): RegExpExecArray | null => {
      if (!m) return null;
      if (needUnit && !PCS_RE.test(m[0]) && !QTY_WORD_RE.test(s)) return null;
      const nums = [...m[0].matchAll(/\d+/g)];
      if (nums.some((n) => overlapsAny((m.index ?? 0) + (n.index ?? 0), n[0].length, blocked))) return null;
      return m;
    };
    const qi = okQty(QTY_INSTEAD.exec(s), true);
    const qr = qi ? null : okQty(QTY_INSTEAD_REV.exec(s), false);
    const qc = qi || qr ? null : okQty(QTY_CHANGE.exec(s), false);
    if (qi || qr) {
      const to = toInt(qi ? qi[1] : qr![2]);
      const from = toInt(qi ? qi[2] : qr![1]);
      if (to && from && to !== from) {
        push({ field: "quantity", summary: `Počet kusů: ${to} ks (místo ${from} ks)`, value: String(to), oldValue: String(from), quantity: to, quantityFrom: from, drawingNumber: dn, quote });
      }
    } else if (qc) {
      const to = toInt(qc[1]);
      if (to) push({ field: "quantity", summary: `Počet kusů: ${to} ks`, value: String(to), quantity: to, drawingNumber: dn, quote });
    }

    // tepelné zpracování (zápor má přednost: „bez kalení", „nekalit")
    const hardness = findHardness(s)[0]?.value ?? null;
    if (sentenceHas(f, HEAT_NONE_RE)) {
      push({ field: "heat", summary: "Bez tepelného zpracování", value: "bez", drawingNumber: dn, quote, heat: { status: "bez", label: "bez tepelného zpracování" } });
    } else {
      // „kalit místo nitridovat" / „místo nitridace prosím kalit": nová a původní hodnota podle e-mailu
      const hx = insteadKinds(f, HEAT_RULES);
      const hr = hx ? { kind: hx.to } : HEAT_RULES.find((r) => r.re.test(f));
      if (hr) {
        const label = plainLabel(HEAT_KINDS[hr.kind].label).toLowerCase();
        const from = hx ? plainLabel(HEAT_KINDS[hx.from].label).toLowerCase() : null;
        push({
          field: "heat", summary: `Tepelné zpracování: ${label}${hardness ? ` ${hardness}` : ""}${from ? ` (místo ${from})` : ""}`, value: `${label}${hardness ? ` ${hardness}` : ""}`,
          ...(from ? { oldValue: from } : {}), drawingNumber: dn, quote, heat: { status: "uvedeno", kind: hr.kind, label, hardness },
        });
      } else if (hardness && /\b(tvrdost|hrc|hv|hb)\b/i.test(s)) {
        push({ field: "hardness", summary: `Tvrdost: ${hardness}`, value: hardness, drawingNumber: dn, quote });
      }
    }

    // povrchová úprava
    if (sentenceHas(f, SURFACE_NONE_RE)) {
      push({ field: "surface", summary: "Bez povrchové úpravy", value: "bez", drawingNumber: dn, quote, surface: { status: "bez", label: "bez povrchové úpravy" } });
    } else {
      const sx = insteadKinds(f, SURFACE_RULES);
      const sr = sx ? { kind: sx.to } : SURFACE_RULES.find((r) => r.re.test(f));
      if (sr) {
        const label = plainLabel(SURFACE_KINDS[sr.kind].label).toLowerCase();
        const from = sx ? plainLabel(SURFACE_KINDS[sx.from].label).toLowerCase() : null;
        push({
          field: "surface", summary: `Povrchová úprava: ${label}${from ? ` (místo ${from})` : ""}`, value: label, ...(from ? { oldValue: from } : {}),
          drawingNumber: dn, quote, surface: { status: "uvedeno", kind: sr.kind, label },
        });
      }
    }

    // materiál
    const mx = MATERIAL_X_INSTEAD_RE.exec(s);
    const mi = mx ? null : MATERIAL_INSTEAD_RE.exec(s);
    const mm = mx || mi ? null : MATERIAL_RE.exec(s);
    if (mx) {
      const to = mx[1].trim();
      push({ field: "material", summary: `Materiál: ${to} (místo ${mx[2].trim()})`, value: to, oldValue: mx[2].trim(), material: to, drawingNumber: dn, quote });
    } else if (mi) {
      const to = mi[2].trim();
      push({ field: "material", summary: `Materiál: ${to} (místo ${mi[1].trim()})`, value: to, oldValue: mi[1].trim(), material: to, drawingNumber: dn, quote });
    } else if (mm) {
      const to = mm[1].trim();
      if (!/^(je|bude|na|z)$/i.test(to)) push({ field: "material", summary: `Materiál: ${to}`, value: to, material: to, drawingNumber: dn, quote });
    }

    // revize výkresu
    if (/\b(revize|revizi|rev\.|index)\b/i.test(s) && /\b(nov|plat|aktual|posledn|zmen|vyrobte|podle|dle|je|bude|posilam|zasilam|v priloze)/.test(f)) {
      const rm = REVISION_RE.exec(s);
      if (rm) push({ field: "revision", summary: `Revize výkresu: ${rm[1]}${dn ? ` (${dn})` : ""}`, value: rm[1], revision: rm[1], drawingNumber: dn, quote });
    }

    // rozměry / tolerance: jen pokyn (sloveso změny) s hodnotou — ne „H7 jsme dostali", „rozměr tam je"
    const verb = CHANGE_VERB_RE.test(f);
    if (verb && /\d/.test(s)) {
      if (TOL_VALUE_RE.test(s) && (/\b(toleranc\w*|tolerov\w*|ulozeni|lic\w*|drsnost\w*)\b/.test(f) || /±|\+\/-|\d\s?[A-Za-z]{1,2}\d{1,2}\b/u.test(s))) {
        push({ field: "tolerance", summary: `Tolerance: ${clip(s, 140)}`, value: clip(s, 140), drawingNumber: dn, quote });
      } else if (DIM_VALUE_RE.test(s) && (/\b(rozmer\w*|delk\w*|prumer\w*|sirk\w*|vysk\w*|tloust\w*|zkrat\w*|prodlouz\w*|kot\w*|zavit\w*|radius\w*|sraz\w*)\b/.test(f) || /[øØ⌀]\s?\d/u.test(s))) {
        push({ field: "dimension", summary: `Rozměry: ${clip(s, 140)}`, value: clip(s, 140), drawingNumber: dn, quote });
      }
    }

    // označení / popis: pokyn označit (sloveso), nebo změna označení / popisu
    if (/\b(oznac(it|te|ime|ovat|ujte)|gravir(ovat|ujte|ovani)|vyrazit|vyrazte|narazit|naraz(te|it)|popsat|popiste|beschrift\w*|mark\s+with)\b/.test(f)
      || (verb && /\b(oznaceni|popis(ek|em|ky)?|stitek|stitky|etiket\w*|marking|label)\b/.test(f))) {
      push({ field: "marking", summary: `Označení / popis: ${clip(s, 140)}`, value: clip(s, 140), drawingNumber: dn, quote });
    }

    // termín
    if (/\b(termin\w*|doda\w*|dodej\w*|nejpozdeji|liefertermin|deadline|delivery date)\b/.test(f)) {
      const dm = DATE_RE.exec(s);
      if (dm && validDate(dm) && /\b(do|k|na|nejpozdeji|termin\w*|doda\w*|dodej\w*|bis|until)\b/.test(f)) {
        push({ field: "deadline", summary: `Termín: ${dateText(dm, now)}`, value: dateText(dm, now), quote });
      } else if (/\b(posun\w*|zmen\w*|uspis\w*|odloz\w*|driv\w*|pozdej\w*|urychl\w*|spech\w*)\b/.test(f)) {
        push({ field: "deadline", summary: `Termín: ${clip(s, 140)}`, value: clip(s, 140), quote });
      }
    }

    // dodací adresa
    if (/\b(dodac\w*\s+adres\w*|dorucit\s+na|dodat\s+na\s+adres\w*|doruceni\s+na|zaslat\s+na\s+adres\w*|nova\s+adresa|lieferadresse|delivery\s+address|ship\s+to)\b/.test(f)) {
      push({ field: "address", summary: `Dodací adresa: ${clip(s, 160)}`, value: clip(s, 160), quote });
    }

    // balení
    if (/\b(baleni|zabal\w*|balit|balte|palet\w*|krabic\w*|vci\b|konzervac\w*|proklad\w*|verpackung|packaging)\b/.test(f)) {
      push({ field: "packaging", summary: `Balení: ${clip(s, 160)}`, value: clip(s, 160), quote });
    }

    // cena / podmínky
    if (/\b(cena|cenu|ceny|cenou|sleva|slevu|kc\s*\/\s*ks|eur\s*\/\s*ks|preis|price)\b/.test(f) && /\d|\b(zmen|nov|uprav|sniz|navys|sleva|slevu|domluv|plati|bude|potvrz)/.test(f)) {
      push({ field: "price", summary: `Cena: ${clip(s, 160)}`, value: clip(s, 160), quote });
    } else if (/\b(splatnost\w*|platebn\w*\s+podmink\w*|zaloh\w*|incoterms?|exw|dap|fca|ddp|doprava\s+zdarma|dodaci\s+podmink\w*|zahlungsbedingung\w*|payment\s+terms)\b/.test(f)) {
      push({ field: "terms", summary: `Podmínky: ${clip(s, 160)}`, value: clip(s, 160), quote });
    }

    // storno
    if (/\b(storn\w*|zrus\w*\s+(objednavk\w*|zakazk\w*|poptavk\w*|polozk\w*|vyrob\w*)|rusime\s+objednavk\w*|odvolavame\s+objednavk\w*|objednavk\w*\s+(rusime|stornujeme|zrusit)|cancel\w*\s+(the\s+)?order)\b/.test(f)) {
      push({ field: "cancel", summary: `Storno: ${clip(s, 160)}`, value: clip(s, 160), drawingNumber: dn, quote });
    }
  }
  return out;
}

// ── 3) AI výstup → pokyn (stejný tvar jako pravidla) ────────

export interface AiInstructionRaw {
  field?: unknown;
  value?: unknown;
  old_value?: unknown;
  drawing_number?: unknown;
  quote?: unknown;
  summary?: unknown;
}

/** Normalizace odpovědi AI: neznámé pole / prázdná hodnota → pryč; strukturované hodnoty dopočítá pravidly. */
export function normalizeAiInstruction(raw: AiInstructionRaw, opts: { drawingNumbers?: readonly string[] } = {}): MailInstruction | null {
  if (!raw || typeof raw !== "object" || !isMailChangeField(raw.field)) return null;
  const field = raw.field;
  const value = typeof raw.value === "string" ? clip(raw.value, 200) : typeof raw.value === "number" ? String(raw.value) : "";
  const quote = typeof raw.quote === "string" ? clip(raw.quote, 300) : value;
  if (!value && !quote) return null;
  const dnRaw = typeof raw.drawing_number === "string" ? raw.drawing_number.trim().slice(0, 80) : "";
  const dn = dnRaw ? (opts.drawingNumbers ?? []).find((d) => normToken(d) === normToken(dnRaw)) ?? dnRaw : null;
  const oldValue = typeof raw.old_value === "string" || typeof raw.old_value === "number" ? String(raw.old_value).slice(0, 80) : null;
  // strukturované pole: projet pravidly nejdřív samotnou hodnotu AI („kalení"), pak citaci + hodnotu
  // (citace „kalit místo nitridovat" obsahuje i původní úpravu) — stejná normalizace jako bez AI
  const pick = (list: MailInstruction[]) => list.find((i) => i.field === field || (field === "hardness" && i.field === "heat"));
  const ruled = (value && field !== "quantity" && (field === "heat" || field === "surface")
    ? pick(extractInstructions(`${FIELD_LABEL[field]}: ${value}`, { cleaned: true }))
    : undefined)
    ?? pick(extractInstructions(`${quote}\n${field === "quantity" ? "" : value}`, { drawingNumbers: opts.drawingNumbers, cleaned: true }));
  if (field === "quantity") {
    const to = toInt(value.replace(/[^\d\s]/g, ""));
    if (!to) return null;
    const from = oldValue ? toInt(oldValue.replace(/[^\d\s]/g, "")) : null;
    return {
      field, value: String(to), oldValue: from ? String(from) : null, quantity: to, ...(from ? { quantityFrom: from } : {}),
      summary: from ? `Počet kusů: ${to} ks (místo ${from} ks)` : `Počet kusů: ${to} ks`, drawingNumber: dn, quote,
    };
  }
  if (ruled && (field === "heat" || field === "surface" || field === "material" || field === "revision")) {
    return { ...ruled, oldValue: ruled.oldValue ?? oldValue, drawingNumber: dn ?? ruled.drawingNumber ?? null, quote };
  }
  const summary = typeof raw.summary === "string" && raw.summary.trim() ? clip(raw.summary, 200) : `${FIELD_LABEL[field]}: ${value || quote}`;
  return { field, summary: capitalize(summary), value: value || null, oldValue, drawingNumber: dn, quote };
}

// ── 4) Změna položky (pokyn nadřazený výkresu) ──────────────

export interface ItemState {
  id: string;
  drawing_number?: string | null;
  name?: string | null;
  quantity?: number | string | null;
  material?: string | null;
  material_designation?: string | null;
  revision?: string | null;
  note?: string | null;
  heat_status?: string | null;
  heat_treatment?: string | null;
  heat_steps?: unknown;
  hardness?: string | null;
  surface_status?: string | null;
  surface_treatment?: string | null;
  surface_steps?: unknown;
  /** Zdroj skupin údajů ({heat: "ai" | "rucne", …}) — pokyn z e-mailu = „rucne" (nadřazeno výkresu). */
  spec_sources?: unknown;
}

/** Skupina spec_sources, kterou pokyn mění (heat/hardness → heat, surface, material → material_designation). */
export const SPEC_GROUP_OF_FIELD: Partial<Record<MailChangeField, "heat" | "surface" | "material_designation">> = {
  heat: "heat", hardness: "heat", surface: "surface", material: "material_designation",
};

export function sourcesObject(v: unknown): Record<string, string> {
  return v && typeof v === "object" && !Array.isArray(v) ? { ...(v as Record<string, string>) } : {};
}

/** Hodnoty z výkresu (drawings) pro zobrazení „přebito pokynem z e-mailu". */
export interface DrawingValues {
  quantity?: number | null;
  material?: string | null;
  revision?: string | null;
  heat_status?: string | null;
  heat_treatment?: string | null;
  hardness?: string | null;
  surface_status?: string | null;
  surface_treatment?: string | null;
}

export interface ItemPatch {
  patch: Record<string, unknown>;
  prev: Record<string, unknown>;
  valueNew: string;
  valuePrev: string;
  /** Hodnota výkresu, kterou pokyn přebíjí („výkres: bez TZ"); null = výkres nic neuvádí. */
  drawingValue: string | null;
}

function heatText(row: { heat_status?: string | null; heat_treatment?: string | null; hardness?: string | null } | null | undefined): string | null {
  if (!row) return null;
  if (row.heat_treatment) return `${row.heat_treatment}${row.hardness ? ` ${row.hardness}` : ""}`;
  if (row.heat_status === "bez") return "bez TZ";
  return null;
}

function surfaceText(row: { surface_status?: string | null; surface_treatment?: string | null } | null | undefined): string | null {
  if (!row) return null;
  if (row.surface_treatment) return row.surface_treatment;
  if (row.surface_status === "bez") return "bez PÚ";
  return null;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

const MAIL_NOTE_PREFIX = "Pokyn z e-mailu";

/**
 * Změna položky podle pokynu. Vrací sloupce po změně + předchozí hodnoty (vrácení jedním ťuknutím)
 * a hodnotu výkresu, kterou pokyn přebíjí. null = pokyn položku nemění (už platí / není položkové pole).
 */
export function itemPatchFor(i: MailInstruction, item: ItemState, drawing?: DrawingValues | null, dateLabel = ""): ItemPatch | null {
  const p = itemPatchCore(i, item, drawing ?? null, dateLabel);
  const group = SPEC_GROUP_OF_FIELD[i.field];
  if (!p || !group) return p;
  // pokyn zákazníka = ruční údaj: pozdější čtení výkresu (AI) ho nepřepíše, jen ohlásí „zůstalo ručně zadané"
  const cur = sourcesObject(item.spec_sources);
  return { ...p, patch: { ...p.patch, spec_sources: { ...cur, [group]: "rucne" } }, prev: { ...p.prev, spec_sources: cur } };
}

function itemPatchCore(i: MailInstruction, item: ItemState, dv: DrawingValues | null, dateLabel: string): ItemPatch | null {
  switch (i.field) {
    case "quantity": {
      if (!i.quantity) return null;
      const cur = num(item.quantity);
      if (cur === i.quantity) return null;
      return { patch: { quantity: i.quantity }, prev: { quantity: cur }, valueNew: `${i.quantity} ks`, valuePrev: cur === null ? "—" : `${cur} ks`, drawingValue: dv?.quantity ? `${dv.quantity} ks` : null };
    }
    case "material": {
      const v = (i.material ?? i.value ?? "").trim();
      if (!v) return null;
      if ((item.material ?? "").trim().toLowerCase() === v.toLowerCase()) return null;
      return {
        patch: { material: v, material_designation: v }, prev: { material: item.material ?? null, material_designation: item.material_designation ?? null },
        valueNew: v, valuePrev: item.material || "—", drawingValue: dv?.material ?? null,
      };
    }
    case "revision": {
      const v = (i.revision ?? i.value ?? "").trim();
      if (!v || (item.revision ?? "").trim().toUpperCase() === v.toUpperCase()) return null;
      return { patch: { revision: v }, prev: { revision: item.revision ?? null }, valueNew: v, valuePrev: item.revision || "—", drawingValue: dv?.revision ?? null };
    }
    case "heat":
    case "hardness": {
      const h = i.heat;
      const prev = { heat_status: item.heat_status ?? null, heat_treatment: item.heat_treatment ?? null, heat_steps: item.heat_steps ?? null, hardness: item.hardness ?? null };
      const before = heatText(item) ?? "—";
      if (i.field === "hardness" || !h) {
        const v = (i.value ?? "").trim();
        if (!v || (item.hardness ?? "") === v) return null;
        return { patch: { hardness: v }, prev: { hardness: item.hardness ?? null }, valueNew: v, valuePrev: item.hardness || "—", drawingValue: dv?.hardness ?? null };
      }
      if (h.status === "bez") {
        if (item.heat_status === "bez" && !item.heat_treatment) return null;
        return { patch: { heat_status: "bez", heat_treatment: null, heat_steps: [], hardness: null }, prev, valueNew: "bez TZ", valuePrev: before, drawingValue: heatText(dv) };
      }
      const step: HeatStep = { kind: h.kind ?? "kaleni", value: h.hardness ? h.hardness.replace(/\s*(HRC|HV\d*|HB|HRB|HRA)\s*$/i, "") : "", unit: h.hardness ? (/(HRC|HV|HB|HRB|HRA)/i.exec(h.hardness)?.[1]?.toUpperCase() as HeatStep["unit"]) ?? "" : "", depthMm: "", note: `${MAIL_NOTE_PREFIX}${dateLabel ? ` ${dateLabel}` : ""}` };
      const label = `${h.label}${h.hardness ? ` ${h.hardness}` : ""}`;
      if ((item.heat_treatment ?? "").toLowerCase() === label.toLowerCase() && item.heat_status === "uvedeno") return null;
      return {
        patch: { heat_status: "uvedeno", heat_treatment: label, heat_steps: [step], ...(h.hardness ? { hardness: h.hardness } : {}) },
        prev, valueNew: label, valuePrev: before, drawingValue: heatText(dv),
      };
    }
    case "surface": {
      const s = i.surface;
      if (!s) return null;
      const prev = { surface_status: item.surface_status ?? null, surface_treatment: item.surface_treatment ?? null, surface_steps: item.surface_steps ?? null };
      const before = surfaceText(item) ?? "—";
      if (s.status === "bez") {
        if (item.surface_status === "bez" && !item.surface_treatment) return null;
        return { patch: { surface_status: "bez", surface_treatment: null, surface_steps: [] }, prev, valueNew: "bez PÚ", valuePrev: before, drawingValue: surfaceText(dv) };
      }
      if ((item.surface_treatment ?? "").toLowerCase() === s.label.toLowerCase() && item.surface_status === "uvedeno") return null;
      const step: SurfaceStep = { kind: s.kind ?? "zinkovani", spec: "", thicknessUm: "" };
      return { patch: { surface_status: "uvedeno", surface_treatment: s.label, surface_steps: [step] }, prev, valueNew: s.label, valuePrev: before, drawingValue: surfaceText(dv) };
    }
    case "marking":
    case "dimension":
    case "tolerance": {
      const line = `${MAIL_NOTE_PREFIX}${dateLabel ? ` ${dateLabel}` : ""}: ${i.quote}`.slice(0, 600);
      const cur = (item.note ?? "").trim();
      if (cur.includes(i.quote)) return null;
      return { patch: { note: cur ? `${cur}\n${line}` : line }, prev: { note: item.note ?? null }, valueNew: i.quote, valuePrev: "—", drawingValue: null };
    }
    default:
      return null;
  }
}

/** Položky, kterých se pokyn týká; ambiguous = víc položek bez upřesnění (jen návrh, ne automaticky). */
export function targetItems<T extends ItemState>(i: MailInstruction, items: readonly T[]): { items: T[]; ambiguous: boolean } {
  if (!ITEM_FIELDS.includes(i.field)) return { items: [], ambiguous: false };
  if (i.drawingNumber) {
    const n = normToken(i.drawingNumber);
    const hit = items.filter((it) => normToken(it.drawing_number) === n);
    if (hit.length) return { items: hit, ambiguous: false };
  }
  if (items.length === 1) return { items: [items[0]], ambiguous: false };
  if (i.field === "quantity" && i.quantityFrom) {
    const hit = items.filter((it) => num(it.quantity) === i.quantityFrom);
    if (hit.length === 1) return { items: hit, ambiguous: false };
  }
  return { items: [...items], ambiguous: items.length > 1 };
}

// ── 4b) „X místo Y" a trvání změny ──────────────────────────

/** Označení materiálu pro porovnání: bez diakritiky, mezer a slov „ocel / nerez / materiál". */
function normMaterial(v: string | null | undefined): string {
  return fold(v).toUpperCase().replace(/\b(OCEL|NEREZ|MATERIAL|MAT|AKOST|JAKOST)\b\.?/g, " ").replace(/\s+/g, "").replace(/^[,.;:]+|[,.;:]+$/g, "");
}

/**
 * Stejný materiál: 1.4305 = 1.4305, 11 523 = 11523, S235 ≈ S235JR (kratší označení je začátkem delšího
 * a nepokračuje číslicí — 1.430 ≠ 1.4301, S235 ≠ S355).
 */
export function sameMaterial(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normMaterial(a);
  const y = normMaterial(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.length >= 4 && l.startsWith(s) && !/[\d.,]/.test(l[s.length] ?? "");
}

function heatKindOf(text: string | null | undefined): HeatStepKind | "bez" | null {
  const f = fold(text);
  if (!f.trim()) return null;
  if (/^\s*bez\b/.test(f) || HEAT_NONE_RE.test(f)) return "bez";
  return HEAT_RULES.find((r) => r.re.test(f))?.kind ?? null;
}

function surfaceKindOf(text: string | null | undefined): SurfaceStepKind | "bez" | null {
  const f = fold(text);
  if (!f.trim()) return null;
  if (/^\s*bez\b/.test(f) || SURFACE_NONE_RE.test(f)) return "bez";
  return SURFACE_RULES.find((r) => r.re.test(f))?.kind ?? null;
}

/** Stejná úprava: podle druhu (kalení ≈ „kalit"), jinak podle textu. */
function sameTreatment(cur: string | null, old: string, kindOf: (t: string | null | undefined) => string | null): boolean {
  if (!cur) return false;
  const a = kindOf(cur);
  const b = kindOf(old);
  if (a && b) return a === b;
  const fc = fold(cur).trim();
  const fo = fold(old).trim();
  return Boolean(fc && fo && (fc.includes(fo) || fo.includes(fc)));
}

function digitsOf(v: string | null | undefined): string {
  return (v ?? "").replace(/[^\d]/g, "");
}

/**
 * Pokyn „X místo Y": platí Y na položce (u prázdné položky hodnota výkresu)? null = pokyn žádné „místo"
 * nemá (nebo ho u pole nejde porovnat). false → jen návrh: e-mail mohl myslet jinou položku / zakázku.
 */
export function oldValueMatches(i: MailInstruction, item: ItemState, drawing?: DrawingValues | null): boolean | null {
  const old = (i.oldValue ?? "").trim();
  switch (i.field) {
    case "quantity": {
      const from = i.quantityFrom ?? (old ? toInt(old.replace(/[^\d\s]/g, "")) : null);
      if (!from) return null;
      return (num(item.quantity) ?? num(drawing?.quantity)) === from;
    }
    case "material": {
      if (!old) return null;
      const cur = [item.material, item.material_designation].filter((v): v is string => Boolean(v && v.trim()));
      if (!cur.length) return sameMaterial(drawing?.material, old);
      return cur.some((c) => sameMaterial(c, old));
    }
    case "heat":
      if (!old) return null;
      return sameTreatment(heatText(item) ?? heatText(drawing), old, heatKindOf);
    case "surface":
      if (!old) return null;
      return sameTreatment(surfaceText(item) ?? surfaceText(drawing), old, surfaceKindOf);
    case "revision": {
      if (!old) return null;
      const cur = (item.revision || drawing?.revision || "").trim().toUpperCase();
      return Boolean(cur) && cur === old.toUpperCase();
    }
    case "hardness": {
      if (!old || !digitsOf(old)) return null;
      return digitsOf(item.hardness || drawing?.hardness) === digitsOf(old);
    }
    default:
      return null;
  }
}

/** „e-mail: 1.4301 místo 1.4305, na položce je 11 523" (návrh místo automatické změny). */
export function insteadText(i: MailInstruction, current: string | null | undefined): string {
  const to = i.field === "quantity" && i.quantity ? `${i.quantity} ks` : (i.value ?? "").trim();
  const fromQ = i.field === "quantity" ? i.quantityFrom ?? toInt((i.oldValue ?? "").replace(/[^\d\s]/g, "")) : null;
  const from = fromQ ? `${fromQ} ks` : (i.oldValue ?? "").trim();
  const cur = (current ?? "").trim();
  return `e-mail: ${to} místo ${from}, ${cur && cur !== "—" ? `na položce je ${cur}` : "na položce není nic"}`;
}

/** Stejná hodnota sloupce (čísla číselně, JSON bez ohledu na pořadí klíčů, prázdné = prázdné). */
export function sameValue(a: unknown, b: unknown): boolean {
  if ((a === null || a === undefined || a === "") && (b === null || b === undefined || b === "")) return true;
  const na = typeof a === "number" || (typeof a === "string" && a.trim() !== "" && Number.isFinite(Number(a))) ? Number(a) : null;
  const nb = typeof b === "number" || (typeof b === "string" && b.trim() !== "" && Number.isFinite(Number(b))) ? Number(b) : null;
  if (na !== null && nb !== null) return na === nb;
  return stable(a) === stable(b);
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

/** Pole, která pokyn zapisuje řádkem do poznámky položky (ne do sloupce). */
export const NOTE_LINE_FIELDS: readonly MailChangeField[] = ["marking", "dimension", "tolerance"];

/** Řádek, který změna z e-mailu přidala do poznámky položky (patch.note = původní + řádek). */
export function mailNoteLine(patch: Record<string, unknown> | null | undefined, prev: Record<string, unknown> | null | undefined): string | null {
  const after = typeof patch?.note === "string" ? patch.note : "";
  if (!after.trim()) return null;
  const before = typeof prev?.note === "string" ? prev.note.trim() : "";
  const line = before && after.startsWith(before) ? after.slice(before.length).replace(/^\n+/, "") : after;
  return line.trim() ? line : null;
}

/** Poznámka bez řádku z e-mailu (vrácení — ostatní řádky, i ruční, zůstanou). */
export function noteWithoutLine(note: string | null | undefined, line: string): string | null {
  const lines = (note ?? "").split("\n");
  const at = lines.lastIndexOf(line);
  if (at >= 0) lines.splice(at, 1);
  const out = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return out || null;
}

/**
 * Platí propsaná změna z e-mailu ještě na položce? (ruční úprava / smazání položky ji nahradí → bez
 * „Vrátit"). Poznámkové pokyny platí, dokud v poznámce zůstal jejich řádek; ostatní sloupce musí sedět.
 */
export function changeHolds(
  field: string, patch: Record<string, unknown> | null | undefined, prev: Record<string, unknown> | null | undefined,
  row: Record<string, unknown> | null | undefined,
): boolean {
  if (!row || !patch) return false;
  const keys = Object.keys(patch).filter((k) => k !== "spec_sources");
  if (!keys.length) return true;
  if ((NOTE_LINE_FIELDS as readonly string[]).includes(field) && keys.length === 1 && keys[0] === "note") {
    const line = mailNoteLine(patch, prev);
    return Boolean(line && typeof row.note === "string" && row.note.split("\n").includes(line));
  }
  return keys.every((k) => sameValue(row[k], patch[k]));
}

// ── 5) Odznak pokynu ────────────────────────────────────────

/** Text štítku přebité hodnoty („Pokyn zákazníka z e-mailu 29. 10. 2026 — nadřazeno výkresu"). */
export function overrideBadgeText(dateLabel: string): string {
  return `Pokyn zákazníka z e-mailu${dateLabel ? ` ${dateLabel}` : ""} — nadřazeno výkresu`;
}

/** Datum e-mailu česky („29. 10. 2026"). */
export function mailDateLabel(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric", timeZone: "Europe/Prague" });
}

// ── 6) Položky z textu e-mailu (zakázka z e-mailu bez AI) ───

export interface MailItemHint { drawingNumber: string; quantity: number | null; name: string | null }

const DRAWING_FILE_RE = /\.(pdf|dxf|dwg|step|stp|igs|iges|tif|tiff|png|jpe?g)$/i;

/** Číslo výkresu z názvu přílohy („H-200_revB.pdf" → „H-200"); null = obecný název (scan, image). */
export function drawingNumberFromFilename(filename: string | null | undefined): string | null {
  const f = (filename ?? "").trim();
  if (!DRAWING_FILE_RE.test(f)) return null;
  let base = f.replace(/\.[a-z0-9]{1,5}$/i, "");
  base = base.replace(/[_\s-]+(rev(ize)?|r|index|idx)\.?\s?[a-z0-9]{1,3}$/i, "").replace(/[_\s]+[a-z]$/i, "");
  base = base.replace(/^(vykres|výkres|drawing|zeichnung|dwg)[_\s-]+/i, "").trim();
  if (!/\d/.test(base) || base.length < 3 || base.length > 40) return null;
  if (/^(img|image|scan|dsc|photo|foto|document|dokument|untitled)[_\s-]?\d+$/i.test(base)) return null;
  return base;
}

/** Klíč výkresu pro nové revize souboru (stejný výkres, jiná revize = nová verze dokumentu). */
export function drawingFileKey(filename: string | null | undefined): string | null {
  const n = drawingNumberFromFilename(filename);
  return n ? normToken(n) : null;
}

/** Položky z textu e-mailu: „H-200 … 20 ks", jinak výkresy z příloh + jediný počet v textu. */
export function itemHintsFromMail(text: string | null | undefined, attachmentNames: readonly string[] = []): MailItemHint[] {
  const clean = cleanMailText(text);
  const fromFiles = [...new Set(attachmentNames.map(drawingNumberFromFilename).filter((x): x is string => Boolean(x)))];
  const out: MailItemHint[] = [];
  const seen = new Set<string>();
  // řádek / věta s číslem výkresu a počtem
  for (const s of splitSentences(clean)) {
    for (const d of fromFiles) {
      if (seen.has(normToken(d)!)) continue;
      if (!drawingIn(s, [d])) continue;
      const q = new RegExp(`${NUM}\\s*${PCS}`, "iu").exec(s);
      out.push({ drawingNumber: d, quantity: q ? toInt(q[1]) : null, name: null });
      seen.add(normToken(d)!);
    }
    const m = /\b(?:v[yý]kres(?:u|em)?|drawing|zeichnung|[čc]\.\s?v\.)\s*(?:[čc]\.|[čc][ií]slo)?\s*([A-Z0-9][A-Z0-9.\-/]{2,30}[0-9][A-Z0-9.\-/]*)/iu.exec(s);
    if (m && !seen.has(normToken(m[1])!)) {
      const q = new RegExp(`${NUM}\\s*${PCS}`, "iu").exec(s);
      out.push({ drawingNumber: m[1].replace(/[.,;:]+$/, ""), quantity: q ? toInt(q[1]) : null, name: null });
      seen.add(normToken(m[1])!);
    }
  }
  for (const d of fromFiles) {
    if (seen.has(normToken(d)!)) continue;
    out.push({ drawingNumber: d, quantity: null, name: null });
    seen.add(normToken(d)!);
  }
  // jediný počet v textu → jediné položce bez počtu
  const qs = [...clean.matchAll(new RegExp(`${NUM}\\s*${PCS}\\b`, "giu"))].map((m) => toInt(m[1])).filter((n): n is number => Boolean(n));
  if (out.length === 1 && out[0].quantity === null && new Set(qs).size === 1) out[0].quantity = qs[0];
  return out.slice(0, 30);
}

