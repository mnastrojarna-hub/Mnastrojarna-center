/**
 * Anonymizace STEP (ISO 10303-21) — spec §3.4, M16. Streamovaně po entitách, dekódování \X2\…\X0\,
 * \X\HH, \S\c. (1) Hlavička FILE_NAME: název = základ bez cesty a termínů, autor / organizace /
 * autorizace ''. (2) Entity osob, organizací, adres, přiřazení, souborů a vlastností Company/Author…
 * se vymažou celé (řetězce ''). (3) Všechny ostatní literály projdou pravidly, termíny a cestami.
 * (4) Ověření výstupu: žádný literál s termínem, zásahem ani podezřelým řetězcem → jinak review.
 * Čistý modul.
 */

import { containsTerm, isSuspiciousLiteral, ruleLine, type RuleContext } from "./rules";

export interface StepResult {
  ok: boolean;
  bytes: Uint8Array | null;
  redacted: number;
  texts: { category: string; text: string }[];
  /** PRODUCT id (číslo dílu) obsahuje termín → review. */
  termInKeep: boolean;
  suspicious: boolean;
  problems: string[];
  unsupported?: string;
}

const BLANK_ENTITY_RE = /^(PERSON|ORGANIZATION|PERSONAL_ADDRESS|ORGANIZATIONAL_ADDRESS|ADDRESS|PERSON_AND_ORGANIZATION|PERSON_AND_ORGANIZATION_ROLE|ORGANIZATION_ROLE|PERSON_ROLE|APPROVAL_PERSON_ORGANIZATION|DOCUMENT_FILE|EXTERNAL_SOURCE|APPLIED_[A-Z_]*ASSIGNMENT|CC_DESIGN_[A-Z_]*ASSIGNMENT|DATE_AND_PERSON_ORGANIZATION)$/;
const PROP_ENTITY_RE = /^(DESCRIPTIVE_REPRESENTATION_ITEM|PROPERTY_DEFINITION|GENERAL_PROPERTY|ID_ATTRIBUTE|NAME_ATTRIBUTE|DESCRIPTION_ATTRIBUTE)$/;
const PROP_NAME_RE = /^(company|firma|organi[sz]ation|organisation|drawn ?by|drawnby|author|autor|designer|created ?by|checked ?by|approved ?by|path|file|filename|file ?name|cesta|soubor|kreslil|konstruoval|schválil|engineer|owner|vlastník|customer|zákazník|supplier|address|adresa|email|e-mail|phone|telefon|lastsavedby|last saved by)$/i;

/** Dekóduje řetězec STEP (bez apostrofů na okrajích). */
export function decodeStepString(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s.startsWith("''", i)) { out += "'"; i += 2; continue; }
    if (s.startsWith("\\\\", i)) { out += "\\"; i += 2; continue; }
    if (s.startsWith("\\X2\\", i)) {
      const end = s.indexOf("\\X0\\", i + 4);
      if (end > 0) {
        const hex = s.slice(i + 4, end);
        for (let k = 0; k + 4 <= hex.length; k += 4) out += String.fromCharCode(parseInt(hex.slice(k, k + 4), 16));
        i = end + 4;
        continue;
      }
    }
    if (s.startsWith("\\X4\\", i)) {
      const end = s.indexOf("\\X0\\", i + 4);
      if (end > 0) {
        const hex = s.slice(i + 4, end);
        for (let k = 0; k + 8 <= hex.length; k += 8) out += String.fromCodePoint(parseInt(hex.slice(k, k + 8), 16));
        i = end + 4;
        continue;
      }
    }
    const x = /^\\X\\([0-9A-Fa-f]{2})/.exec(s.slice(i, i + 6));
    if (x) { out += String.fromCharCode(parseInt(x[1], 16)); i += 5; continue; }
    if (s.startsWith("\\S\\", i) && i + 3 < s.length) { out += String.fromCharCode(s.charCodeAt(i + 3) + 128); i += 4; continue; }
    if (s.startsWith("\\P", i) && s[i + 3] === "\\") { i += 4; continue; }
    out += s[i];
    i++;
  }
  return out;
}

/** Zakóduje text do řetězce STEP (ASCII + \X2\ pro ostatní). */
export function encodeStepString(t: string): string {
  let out = "";
  let wide = "";
  const flush = () => {
    if (wide) { out += `\\X2\\${wide}\\X0\\`; wide = ""; }
  };
  for (const ch of t) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x20 && cp < 0x7f) {
      flush();
      out += ch === "'" ? "''" : ch === "\\" ? "\\\\" : ch;
    } else if (cp <= 0xffff) {
      wide += cp.toString(16).toUpperCase().padStart(4, "0");
    } else {
      flush();
      out += `\\X4\\${cp.toString(16).toUpperCase().padStart(8, "0")}\\X0\\`;
    }
  }
  flush();
  return out;
}

interface Tok {
  kind: "str" | "comment" | "other";
  text: string;
}

/** Rozdělí soubor na řetězce, komentáře a ostatní (řetězce i komentáře mohou obsahovat ; a ( ). */
export function tokenizeStep(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let buf = "";
  const flush = () => { if (buf) { toks.push({ kind: "other", text: buf }); buf = ""; } };
  while (i < src.length) {
    const c = src[i];
    if (c === "'") {
      flush();
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === "'" && src[j + 1] === "'") { j += 2; continue; }
        if (src[j] === "'") break;
        j++;
      }
      toks.push({ kind: "str", text: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      flush();
      const end = src.indexOf("*/", i + 2);
      const j = end < 0 ? src.length : end + 2;
      toks.push({ kind: "comment", text: src.slice(i, j) });
      i = j;
      continue;
    }
    buf += c;
    i++;
  }
  flush();
  return toks;
}

function basename(p: string): string {
  const s = p.replace(/\\/g, "/");
  return s.slice(s.lastIndexOf("/") + 1);
}

export function anonymizeStep(bytes: Uint8Array, ctx: RuleContext): StepResult {
  const res: StepResult = { ok: false, bytes: null, redacted: 0, texts: [], termInKeep: false, suspicious: false, problems: [] };
  const src = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (!/ISO-10303-21\s*;/.test(src.slice(0, 2000))) {
    res.unsupported = "Soubor není STEP (ISO 10303-21) v textové podobě.";
    return res;
  }
  const toks = tokenizeStep(src);

  // kontext každého řetězce: sekce, entita (všechny typy u komplexní entity), index argumentu
  let section = "";
  let entityTypes: string[] = [];
  let depth = 0;
  let argIndex = 0;
  let headerEntity = "";
  let propName = "";
  const out: string[] = [];
  for (let t = 0; t < toks.length; t++) {
    const tok = toks[t];
    if (tok.kind === "comment") {
      res.redacted++;
      out.push(" ");
      continue;
    }
    if (tok.kind === "other") {
      const text = tok.text;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === ";") {
          if (depth === 0) { entityTypes = []; headerEntity = ""; propName = ""; argIndex = 0; }
        } else if (ch === "(") {
          if (depth === 0) argIndex = 0;
          depth++;
        } else if (ch === ")") {
          depth = Math.max(0, depth - 1);
        } else if (ch === "," && depth === 1) {
          argIndex++;
        }
      }
      const kw = text.match(/\b(HEADER|DATA|ENDSEC)\s*;/g);
      if (kw) {
        const last = kw[kw.length - 1].replace(/\s*;/, "");
        section = last === "ENDSEC" ? "" : last;
      }
      for (const m of text.matchAll(/([A-Z][A-Z0-9_]*)\s*\(/g)) {
        entityTypes.push(m[1]);
        if (section === "HEADER" && !headerEntity) headerEntity = m[1];
      }
      out.push(text);
      continue;
    }

    // řetězec
    const raw = tok.text;
    const val = decodeStepString(raw);
    const put = (s: string) => out.push(`'${s}'`);
    if (!val) { put(raw); continue; }

    if (section === "HEADER") {
      if (headerEntity === "FILE_NAME") {
        if (argIndex === 0) {
          const base = basename(val);
          const clean = containsTerm(base, ctx.terms) || ruleLine(base, "title_block", ctx).hits.length ? "" : base;
          if (clean !== val) { res.redacted++; res.texts.push({ category: "path", text: val }); }
          put(encodeStepString(clean));
          continue;
        }
        if (argIndex === 2 || argIndex === 3 || argIndex === 6) { // autor, organizace, autorizace
          res.redacted++;
          res.texts.push({ category: argIndex === 3 ? "company" : "person", text: val });
          put("");
          continue;
        }
      }
    } else if (section === "DATA") {
      const types = entityTypes;
      if (types.some((x) => BLANK_ENTITY_RE.test(x))) {
        res.redacted++;
        res.texts.push({ category: "other", text: val });
        put("");
        continue;
      }
      if (types.some((x) => PROP_ENTITY_RE.test(x))) {
        if (argIndex === 0) propName = val.trim();
        if (PROP_NAME_RE.test(propName)) {
          res.redacted++;
          res.texts.push({ category: "other", text: val });
          put("");
          continue;
        }
      }
      if (types[0] === "PRODUCT" && argIndex === 0) {
        // id = číslo dílu: zůstává; s termínem → review (M7)
        if (containsTerm(val, ctx.terms)) res.termInKeep = true;
        put(raw);
        continue;
      }
    }

    // ostatní literály: pravidla, termíny, cesty
    const r = ruleLine(val, "title_block", ctx);
    if (!r.hits.length) { put(raw); continue; }
    res.redacted++;
    for (const h of r.hits) res.texts.push({ category: h.category, text: val.slice(h.start, h.end) });
    if (r.hits.some((h) => h.wholeItem)) { put(""); continue; }
    let kept = "";
    let last = 0;
    for (const h of [...r.hits].sort((a, b) => a.start - b.start)) {
      if (h.start > last) kept += val.slice(last, h.start);
      last = Math.max(last, h.end);
    }
    kept += val.slice(last);
    put(encodeStepString(kept.replace(/\s{2,}/g, " ").trim()));
  }

  const result = out.join("");
  res.bytes = new TextEncoder().encode(result);

  // ověření výstupu
  let sec = "";
  let types: string[] = [];
  let d = 0;
  let arg = 0;
  for (const tok of tokenizeStep(result)) {
    if (tok.kind === "comment") { res.problems.push("zůstal komentář"); continue; }
    if (tok.kind === "other") {
      for (const ch of tok.text) {
        if (ch === ";" && d === 0) { types = []; arg = 0; }
        else if (ch === "(") { if (d === 0) arg = 0; d++; }
        else if (ch === ")") d = Math.max(0, d - 1);
        else if (ch === "," && d === 1) arg++;
      }
      const kw = tok.text.match(/\b(HEADER|DATA|ENDSEC)\s*;/g);
      if (kw) { const l = kw[kw.length - 1].replace(/\s*;/, ""); sec = l === "ENDSEC" ? "" : l; }
      for (const m of tok.text.matchAll(/([A-Z][A-Z0-9_]*)\s*\(/g)) types.push(m[1]);
      continue;
    }
    const v = decodeStepString(tok.text);
    if (!v.trim()) continue;
    const isProductId = sec === "DATA" && types[0] === "PRODUCT" && arg === 0;
    if (!isProductId && (containsTerm(v, ctx.terms) || ruleLine(v, "title_block", ctx).hits.length)) res.problems.push("zbyl citlivý literál");
    if (isSuspiciousLiteral(v, ctx.keepTerms)) res.suspicious = true;
  }
  res.ok = true;
  return res;
}
