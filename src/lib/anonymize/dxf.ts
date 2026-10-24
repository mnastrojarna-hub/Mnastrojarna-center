/**
 * Anonymizace DXF (ASCII) — spec §3.4. Tokenizer párů (kód, hodnota) nad bajty (kódová stránka
 * $DWGCODEPAGE, od R2007 UTF-8), projdou se VŠECHNY řetězcové kódy v HEADER, TABLES, BLOCKS, ENTITIES
 * a OBJECTS. Hodnoty textů / atributů / vlastností se zásahem se smažou (podřetězec, u formátovaného
 * textu celá hodnota), entity IMAGE se odstraní, názvy (hladiny, bloky, styly) se NEpřejmenovávají
 * (termín v názvu → review). Výchozí stav DXF ve v1 je vždy `review` (grafika v razítku).
 * Čistý modul (bez nativních závislostí).
 */

import { isSuspiciousLiteral, ruleLine, containsTerm, type RuleContext } from "./rules";

export interface DxfResult {
  ok: boolean;
  bytes: Uint8Array | null;
  /** Počet změněných / smazaných hodnot. */
  redacted: number;
  removedImages: number;
  warnings: { code: "dxf_layer_term" | "dxf_graphics" | "step_suspicious"; message: string }[];
  texts: { category: string; text: string }[];
  unsupported?: string;
  /** Kontrola po zápisu: geometrie beze změny, žádný literál s termínem / zásahem. */
  verified: boolean;
  problems: string[];
}

const NAME_CODES = new Set([2, 5, 6, 7, 8, 9, 1001, 1003, 1005]);
function isStringCode(c: number): boolean {
  return (c >= 1 && c <= 9) || (c >= 300 && c <= 309) || c === 999 || (c >= 1000 && c <= 1009) || c === 100 || c === 102 || c === 410 || c === 470;
}
/** Kódy, jejichž hodnotu smíme vyprázdnit (ne odkazy / názvy / řídicí). */
function isBlankable(code: number, inProps: boolean, inPlot: boolean): boolean {
  if (inProps) return code !== 5 && code !== 100 && code !== 102 && ((code >= 1 && code <= 9) || (code >= 300 && code <= 309) || code === 1000);
  if (inPlot && (code === 1 || code === 2 || code === 4 || code === 6 || code === 7)) return true;
  return code === 1 || code === 3 || code === 4 || (code >= 300 && code <= 309) || code === 999 || code === 1000 || code === 470;
}

const HEADER_BLANK = new Set(["$LASTSAVEDBY", "$PROJECTNAME", "$HYPERLINKBASE", "$STYLESHEET"]);
/** Entity s obrazem / vloženým objektem / binární proxy grafikou — odstraní se celé. */
const DROP_ENTITIES = new Set(["IMAGE", "OLE2FRAME", "OLEFRAME", "ACAD_PROXY_ENTITY"]);
/** Ve výstupu nesmí zůstat (kontrola po zápisu). */
const FORBIDDEN_DXF = new Set(["THUMBNAILIMAGE", "OLE2FRAME", "OLEFRAME", "ACAD_PROXY_ENTITY", "ACAD_PROXY_OBJECT", "IMAGE"]);

const CODEPAGES: Record<string, string> = {
  ANSI_1250: "windows-1250", ANSI_1251: "windows-1251", ANSI_1252: "windows-1252", ANSI_1253: "windows-1253",
  ANSI_1254: "windows-1254", ANSI_1257: "windows-1257", DOS850: "ibm850", DOS852: "ibm852", DOS866: "ibm866", ANSI_874: "windows-874",
};

interface Pair {
  code: number;
  /** Hodnota jako „latin1" řetězec bajtů (1:1 s originálem). */
  raw: string;
  /** Vyřadit z výstupu (odstraněná entita / komentář). */
  drop?: boolean;
}

function singleByteCodec(label: string): { decode(s: string): string; encode(s: string): string | null } {
  let dec: TextDecoder;
  try {
    dec = new TextDecoder(label);
  } catch {
    dec = new TextDecoder("windows-1252");
  }
  const table: string[] = [];
  const rev = new Map<string, number>();
  for (let b = 0; b < 256; b++) {
    const ch = dec.decode(new Uint8Array([b]));
    table.push(ch);
    if (!rev.has(ch)) rev.set(ch, b);
  }
  return {
    decode: (s) => Array.from(s, (c) => table[c.charCodeAt(0) & 0xff]).join(""),
    encode: (s) => {
      let out = "";
      for (const c of s) {
        const b = rev.get(c);
        if (b === undefined) return null;
        out += String.fromCharCode(b);
      }
      return out;
    },
  };
}

function utf8Codec() {
  return {
    decode: (s: string) => new TextDecoder("utf-8").decode(Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff)),
    encode: (s: string) => Array.from(new TextEncoder().encode(s), (b) => String.fromCharCode(b)).join(""),
  };
}

/** Dekódování \U+XXXX, %%c/%%d/%%p a formátovacích kódů MTEXT pro detekci. */
export function dxfPlainText(s: string): string {
  return s
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\M\+\d([0-9A-Fa-f]{4})/g, " ")
    .replace(/%%[cC]/g, "Ø").replace(/%%[dD]/g, "°").replace(/%%[pP]/g, "±").replace(/%%[uUoOkK]/g, "")
    .replace(/\\[PpNnX~]/g, " ")
    .replace(/\\[ACcFfHhQqTtWw][^;\\{}]*;/g, "")
    .replace(/\\[LlOoKk]/g, "")
    .replace(/\\S([^;]*)[#^/]([^;]*);/g, "$1/$2")
    .replace(/[{}]/g, "")
    .replace(/\\\\/g, "\\");
}

function hasFormatting(s: string): boolean {
  return /\\[A-Za-z~\\{}]|%%|[{}]/.test(s);
}

export function parseDxfPairs(text: string): { pairs: Pair[]; eol: string } | null {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  if (lines.length % 2 !== 0) return null;
  const pairs: Pair[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isInteger(code)) return null;
    pairs.push({ code, raw: lines[i + 1] });
  }
  return { pairs, eol };
}

function serialize(pairs: Pair[], eol: string): string {
  const out: string[] = [];
  for (const p of pairs) {
    if (p.drop) continue;
    out.push(String(p.code).padStart(3, " "), p.raw);
  }
  return out.join(eol) + eol;
}

function toLatin1(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
}

function fromLatin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

export function anonymizeDxf(bytes: Uint8Array, ctx: RuleContext): DxfResult {
  const res: DxfResult = { ok: false, bytes: null, redacted: 0, removedImages: 0, warnings: [], texts: [], verified: false, problems: [] };
  const head = toLatin1(bytes.subarray(0, 32));
  if (head.startsWith("AutoCAD Binary DXF")) {
    res.unsupported = "Binární DXF nelze anonymizovat — ulož výkres jako ASCII DXF nebo PDF.";
    return res;
  }
  const parsed = parseDxfPairs(toLatin1(bytes));
  if (!parsed) {
    res.unsupported = "Soubor DXF nejde přečíst (poškozený nebo neznámý formát).";
    return res;
  }
  const { pairs, eol } = parsed;

  // kódování: $ACADVER ≥ AC1021 → UTF-8, jinak $DWGCODEPAGE
  let acadver = "", codepage = "";
  for (let i = 0; i + 1 < pairs.length; i++) {
    if (pairs[i].code === 9 && pairs[i].raw.trim() === "$ACADVER") acadver = pairs[i + 1].raw.trim();
    if (pairs[i].code === 9 && pairs[i].raw.trim() === "$DWGCODEPAGE") codepage = pairs[i + 1].raw.trim().toUpperCase();
    if (pairs[i].code === 0 && pairs[i].raw.trim() === "ENDSEC" && acadver) break;
  }
  const verNum = Number(acadver.replace(/^AC/, "")) || 0;
  const codec = verNum >= 1021 ? utf8Codec() : singleByteCodec(CODEPAGES[codepage] ?? "windows-1252");

  // průchod: sekce, entity, příznaky
  let section = "";
  let entity = "";
  let headerVar = "";
  let inProps = false;
  let inPlot = false;
  let dropEntity = false;
  let dropSection = false;
  let binaryLeft = false;
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    const v = p.raw.trim();
    // náhled celého výkresu (bitmapa i s razítkem) — celá sekce THUMBNAILIMAGE pryč
    if (dropSection) {
      p.drop = true;
      if (p.code === 0 && v === "ENDSEC") { dropSection = false; section = ""; }
      continue;
    }
    if (p.code === 0 && v === "SECTION" && pairs[i + 1]?.code === 2 && pairs[i + 1].raw.trim() === "THUMBNAILIMAGE") {
      dropSection = true;
      p.drop = true;
      res.removedImages++;
      continue;
    }
    if (p.code === 0) {
      dropEntity = false;
      entity = v;
      inProps = false;
      inPlot = v === "PLOTSETTINGS" || v === "LAYOUT";
      if (v === "SECTION") section = "";
      // obrázky, vložené OLE objekty (logo, razítko z Wordu…) a proxy entity s binární grafikou
      if ((section === "ENTITIES" || section === "BLOCKS") && DROP_ENTITIES.has(v)) {
        dropEntity = true;
        res.removedImages++;
      }
      if (section === "OBJECTS" && v === "ACAD_PROXY_OBJECT") {
        dropEntity = true;
        res.removedImages++;
      }
      if (dropEntity) p.drop = true;
      continue;
    }
    if (dropEntity) { p.drop = true; continue; }
    if (p.code >= 310 && p.code <= 319) binaryLeft = true;
    if (p.code === 2 && entity === "SECTION") section = v;
    if (section === "HEADER" && p.code === 9) { headerVar = v; continue; }
    if (!isStringCode(p.code)) continue;
    if (entity === "XRECORD" && p.code === 1 && v === "DWGPROPS COOKIE") { inProps = true; continue; }
    const plain = codec.decode(p.raw);
    const text = dxfPlainText(plain);
    if (!text.trim()) continue;
    if (p.code === 999) { // komentář pryč (může nést cokoli)
      p.drop = true;
      res.redacted++;
      continue;
    }
    if (section === "HEADER" && HEADER_BLANK.has(headerVar)) {
      if (plain.trim()) { res.texts.push({ category: "meta", text: plain }); p.raw = ""; res.redacted++; }
      continue;
    }
    const blankable = isBlankable(p.code, inProps, inPlot);
    if (inProps && blankable) {
      res.texts.push({ category: "meta", text }); p.raw = ""; res.redacted++;
      continue;
    }
    const r = ruleLine(text, "title_block", ctx);
    const hit = r.hits.length > 0;
    if (!hit) continue;
    if (!blankable || (NAME_CODES.has(p.code) && !inPlot)) {
      // název hladiny / bloku / stylu s termínem → v1 nepřejmenováváme (rozbilo by odkazy) → review
      res.warnings.push({ code: "dxf_layer_term", message: "Název hladiny, bloku nebo stylu obsahuje údaj o firmě — v1 se nepřejmenovává, zkontroluj." });
      continue;
    }
    res.redacted++;
    for (const h of r.hits) res.texts.push({ category: h.category, text: text.slice(h.start, h.end) });
    if (hasFormatting(plain) || plain !== text) {
      p.raw = "";
      continue;
    }
    // podřetězec (popisek „Kreslil:" zůstane)
    let kept = "";
    let last = 0;
    for (const h of [...r.hits].sort((a, b) => a.start - b.start)) {
      if (h.start > last) kept += text.slice(last, h.start);
      last = Math.max(last, h.end);
    }
    kept += text.slice(last);
    kept = kept.replace(/\s{2,}/g, " ").trim();
    const enc = codec.encode(kept);
    p.raw = enc ?? "";
  }

  const out = serialize(pairs, eol);
  res.bytes = fromLatin1(out);

  // kontrola: znovu naparsovat, žádný literál s termínem / zásahem, geometrie beze změny
  const again = parseDxfPairs(out);
  if (!again) {
    res.problems.push("výstup DXF nejde znovu přečíst");
  } else {
    const numeric = (ps: Pair[]) => ps.filter((x) => !x.drop && !isStringCode(x.code)).map((x) => `${x.code}:${x.raw.trim()}`);
    if (numeric(pairs).join("|") !== numeric(again.pairs).join("|")) res.problems.push("geometrie DXF se změnila");
    let sec = "", ent = "";
    for (const p of again.pairs) {
      if (p.code === 0) {
        ent = p.raw.trim();
        if ((sec === "ENTITIES" || sec === "BLOCKS" || sec === "OBJECTS") && FORBIDDEN_DXF.has(ent)) res.problems.push(`zůstal vložený obraz / objekt (${ent})`);
        continue;
      }
      if (p.code === 2 && ent === "SECTION") {
        sec = p.raw.trim();
        if (FORBIDDEN_DXF.has(sec)) res.problems.push(`zůstal náhled výkresu (${sec})`);
      }
      if (!isStringCode(p.code) || NAME_CODES.has(p.code)) continue;
      const t = dxfPlainText(codec.decode(p.raw));
      if (!t.trim()) continue;
      if (containsTerm(t, ctx.terms) || ruleLine(t, "title_block", ctx).hits.length) {
        res.problems.push(`zbyl citlivý text (${sec || "?"})`);
        break;
      }
      if (isSuspiciousLiteral(t)) {
        res.warnings.push({ code: "step_suspicious", message: "V DXF zůstal podezřelý text (e-mail, doména, právní forma) — zkontroluj." });
      }
    }
  }
  if (binaryLeft) res.warnings.push({ code: "dxf_graphics", message: "DXF obsahuje binární data (proxy grafika, XDATA) — zkontroluj." });
  res.warnings.push({ code: "dxf_graphics", message: "DXF: zkontroluj logo a grafiku v razítku (v1 vždy ke kontrole)." });
  res.verified = res.problems.length === 0;
  res.ok = true;
  return res;
}
