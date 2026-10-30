/**
 * Anonymizace IGES (ANSI Y14.26M, pevné řádky 80 znaků: S = volný text, G = globální parametry,
 * D = adresář entit, P = parametry, T = konec). Úpravy jsou NA MÍSTĚ se stejnou délkou (mezery),
 * takže čísla řádků, ukazatele D→P i počty v T zůstanou platné:
 *  - S (start): celý volný text pryč (exportér sem píše firmu, autora, e-mail),
 *  - G: ID produktu (3, 12), název souboru (4), autor (21) a organizace (22) → mezery
 *    (název souboru „model.igs"),
 *  - D: popisky entit (sloupce 57–64 2. řádku) s termínem / zásahem pravidel → mezery,
 *  - P: Hollerith řetězce (poznámky 212, vlastnosti 406, text…) s termínem / zásahem → mezery.
 * Kontrola po zápisu: žádný řetězec s termínem / zásahem, délky řádků beze změny. Čistý modul.
 */

import { containsTerm, ruleLine, type RuleContext } from "./rules";
import { normalizeText } from "./text";

export interface IgesResult {
  bytes: Uint8Array | null;
  redacted: number;
  texts: { category: string; text: string }[];
  problems: string[];
  unsupported?: string;
}

interface Line {
  /** Posun začátku řádku v souboru. */
  start: number;
  section: string;
}

function toLatin1(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return s;
}

/** Řádky souboru s písmenem sekce ve sloupci 73. */
function linesOf(src: string): Line[] | null {
  const out: Line[] = [];
  let i = 0;
  while (i < src.length) {
    let j = src.indexOf("\n", i);
    if (j < 0) j = src.length;
    const raw = src.slice(i, j).replace(/\r$/, "");
    if (raw.trim()) {
      if (raw.length < 73) return null;
      const sec = raw[72];
      if (!"SGDPTC".includes(sec)) return null;
      out.push({ start: i, section: sec });
    }
    i = j + 1;
  }
  return out;
}

interface Holl {
  /** Text řetězce. */
  text: string;
  /** Pozice jednotlivých znaků v souboru. */
  pos: number[];
  /** Pořadí parametru v sekci (1..n). */
  param: number;
}

/** Hollerith řetězce a pořadí parametrů v datech sekce (sloupce 1–72, u P 1–64). */
function hollerithOf(src: string, lines: Line[], section: "G" | "P", delims: { p: string; r: string }): Holl[] {
  const chars: string[] = [];
  const pos: number[] = [];
  for (const l of lines) {
    if (l.section !== section) continue;
    const width = section === "P" ? 64 : 72;
    for (let c = 0; c < width; c++) { chars.push(src[l.start + c] ?? " "); pos.push(l.start + c); }
  }
  const out: Holl[] = [];
  let param = 1;
  let i = 0;
  let p = delims.p, r = delims.r;
  while (i < chars.length) {
    const ch = chars[i];
    if (ch === p || ch === r) { param = ch === r && section === "P" ? 1 : param + 1; i++; continue; }
    // nnnH……
    const m = /^\s*(\d+)H/.exec(chars.slice(i, i + 12).join(""));
    if (m) {
      const n = Number(m[1]);
      const from = i + m[0].length;
      const text = chars.slice(from, from + n).join("");
      out.push({ text, pos: pos.slice(from, from + n), param });
      // v G se oddělovače definují prvními dvěma parametry
      if (section === "G" && param === 1 && n === 1) p = text;
      if (section === "G" && param === 2 && n === 1) r = text;
      i = from + n;
      continue;
    }
    i++;
  }
  return out;
}

function sensitive(text: string, ctx: RuleContext): boolean {
  const t = text.trim();
  if (!t) return false;
  return containsTerm(t, ctx.terms) || ruleLine(t, "title_block", ctx).hits.length > 0;
}

/** Popisek entity má jen 8 znaků — „STROJMET" je useknutý „Strojmetal" (prefix termínu ≥ 5 znaků). */
function sensitiveLabel(label: string, ctx: RuleContext): boolean {
  if (sensitive(label, ctx)) return true;
  const c = normalizeText(label).replace(/[^\p{L}\p{N}]+/gu, "");
  return c.length >= 5 && ctx.terms.some((t) => t.compact.length > c.length && t.compact.startsWith(c));
}

export function anonymizeIges(bytes: Uint8Array, ctx: RuleContext): IgesResult {
  const res: IgesResult = { bytes: null, redacted: 0, texts: [], problems: [] };
  const src = toLatin1(bytes);
  const lines = linesOf(src);
  if (!lines || !lines.some((l) => l.section === "G") || !lines.some((l) => l.section === "D")) {
    res.unsupported = "Soubor IGES nejde přečíst (komprimovaný nebo poškozený) — exportuj model jako STEP a nahraj znovu.";
    return res;
  }
  if (lines.some((l) => l.section === "C")) {
    res.unsupported = "Komprimovaný IGES nelze anonymizovat — exportuj model jako STEP a nahraj znovu.";
    return res;
  }
  const out = src.split("");
  const blank = (positions: number[], keep = "") => {
    positions.forEach((p, k) => { out[p] = k < keep.length ? keep[k] : " "; });
  };
  // S: volný text
  for (const l of lines.filter((x) => x.section === "S")) {
    const t = src.slice(l.start, l.start + 72);
    if (t.trim()) { res.texts.push({ category: "other", text: t.trim() }); res.redacted++; }
    for (let c = 0; c < 72; c++) out[l.start + c] = " ";
  }
  // G: globální parametry
  const g = hollerithOf(src, lines, "G", { p: ",", r: ";" });
  for (const h of g) {
    if ([3, 4, 12, 21, 22].includes(h.param) && h.text.trim()) {
      res.texts.push({ category: h.param === 22 ? "company" : h.param === 21 ? "person" : "path", text: h.text.trim() });
      res.redacted++;
      blank(h.pos, h.param === 4 ? "model.igs" : h.param === 3 || h.param === 12 ? "model" : "");
    } else if (sensitive(h.text, ctx)) {
      res.texts.push({ category: "other", text: h.text.trim() });
      res.redacted++;
      blank(h.pos);
    }
  }
  const pDelims = { p: g.find((h) => h.param === 1)?.text || ",", r: g.find((h) => h.param === 2)?.text || ";" };
  // D: popisky entit (2. řádek položky, sloupce 57–64) — pro jistotu každé nečíselné 8znakové pole
  for (const l of lines.filter((x) => x.section === "D")) {
    for (let f = 0; f < 9; f++) {
      const s = l.start + f * 8;
      const field = src.slice(s, s + 8);
      if (!/[A-Za-z]/.test(field) || !sensitiveLabel(field, ctx)) continue;
      res.texts.push({ category: "other", text: field.trim() });
      res.redacted++;
      for (let c = 0; c < 8; c++) out[s + c] = " ";
    }
  }
  // P: řetězce v parametrech entit
  for (const h of hollerithOf(src, lines, "P", pDelims)) {
    if (!sensitive(h.text, ctx)) continue;
    res.texts.push({ category: "other", text: h.text.trim() });
    res.redacted++;
    blank(h.pos);
  }
  const result = out.join("");
  // kontrola: stejné řádky, žádný citlivý řetězec
  const again = linesOf(result);
  if (!again || again.length !== lines.length || result.length !== src.length) res.problems.push("struktura IGES se změnila");
  else {
    const gl = hollerithOf(result, again, "G", { p: ",", r: ";" });
    const left = [...gl, ...hollerithOf(result, again, "P", pDelims)].filter((h) => sensitive(h.text, ctx));
    if (left.length) res.problems.push("v IGES zůstal citlivý text");
    if (again.filter((l) => l.section === "S").some((l) => result.slice(l.start, l.start + 72).trim())) res.problems.push("v IGES zůstal úvodní text");
    // pojistka nezávislá na rozboru parametrů (poškozený / nestandardní soubor): termín kdekoli v datech
    const data = again.map((l) => result.slice(l.start, l.start + 72)).join("");
    if (containsTerm(data, ctx.terms) || again.some((l) => containsTerm(result.slice(l.start, l.start + 72), ctx.terms))) res.problems.push("v IGES zůstal údaj o zákazníkovi");
  }
  res.bytes = Uint8Array.from(result, (c) => c.charCodeAt(0) & 0xff);
  return res;
}
