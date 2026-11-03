/**
 * Názvy firem nalezené PŘÍMO na výkresu (majitel 2. 11.: „výkresy, které jsou vedeny jako anonymizované,
 * mají furt v hlavičce název firmy"). V razítku často NENÍ zákazník zakázky z CRM, ale koncový zákazník,
 * OEM nebo konstrukční kancelář — jeho jméno se proto musí vzít z výkresu samotného: z právní formy
 * v razítku / rámu, ze samostatného řádku s firmou, z ochranné doložky („© …", „majetkem …") a z AI
 * (název firmy jako křivky, logo, nečitelné písmo). Nalezená jména se stanou termíny („drawing") —
 * smažou se pak KDEKOLI (druhý list, rozsypané po znacích, natočené) a hlídá je výstupní kontrola.
 * Čistý modul (bez serverových závislostí).
 */

import { firstLegalFormEnd, isTechnicalText, makeTerms, makeWordTerms, ruleLine, rulePage, stripLegalForm, stripOwnerPrefix, trailingLegalForm, type RuleContext, type Term } from "./rules";
import { mapRangeBack, normalizeText, normalizeWithMap } from "./text";
import type { TextLine, Zone } from "./types";

/** Pravidla, jejichž zásah je jméno firmy (ne hodnota pole „Projekt:", ne osoba). */
const NAME_RULES = new Set(["legal_form", "legal_form_line", "copyright_owner", "company_label"]);
export const MAX_FOUND_NAMES = 30;

/** Jméno firmy ze zasaženého úseku (bez popisku, do konce právní formy / do čárky). */
export function companyNameFromHit(value: string, rule: string): string | null {
  let v = stripOwnerPrefix(String(value ?? "").replace(/^[\s:]+/u, "")).trim();
  const le = firstLegalFormEnd(v);
  // hodnota pole bez právní formy („Projekt: Hydraulický lis HL-200") není jistě firma → jen se smaže na místě
  if (rule === "company_label" && le < 0) return null;
  v = le > 0 ? v.slice(0, le) : v.split(/[,;|]|\s[-–—]\s/u)[0];
  v = v.trim();
  const core = stripLegalForm(v);
  if (core.length < 3 || !/\p{L}{2,}/u.test(core) || isTechnicalText(core)) return null;
  if (core.split(/\s+/).length > 8) return null;
  return v;
}

/**
 * Jména firem v řádcích podle pravidel (právní forma v razítku / rámu, samostatný řádek s firmou mimo kusovník,
 * doložka). Řádky s geometrií (PDF) jdou přes pravidla stránky (sousední buňky), holé texty (DXF) po řádcích.
 */
export function discoverCompanyNames(lines: readonly (TextLine | { text: string; zone: Zone })[], ctx: RuleContext): string[] {
  if (!ctx.redact.company) return [];
  const found: { text: string; start: number; end: number; rule: string }[] = [];
  const geo = lines.length > 0 && lines.every((l) => "box" in l && "spans" in l);
  if (geo) {
    const tl = lines as readonly TextLine[];
    const byId = new Map(tl.map((l) => [l.id, l]));
    for (const h of rulePage(tl, ctx).hits) {
      const l = byId.get(h.lineId);
      if (l && (h.category === "company" || h.category === "copyright_owner")) found.push({ text: l.text, start: h.start, end: h.end, rule: h.rule });
    }
  } else {
    for (const l of lines) {
      if (!l.text || !l.text.trim()) continue;
      for (const h of ruleLine(l.text, l.zone, ctx).hits) {
        if (h.category === "company" || h.category === "copyright_owner") found.push({ text: l.text, start: h.start, end: h.end, rule: h.rule });
      }
    }
  }
  const out = new Map<string, string>();
  for (const f of found) {
    if (!NAME_RULES.has(f.rule)) continue;
    const n = companyNameFromHit(f.text.slice(f.start, f.end), f.rule);
    if (!n) continue;
    const k = normalizeText(stripLegalForm(n)).replace(/[^\p{L}\p{N}]+/gu, "");
    if (k && !out.has(k)) out.set(k, n);
    if (out.size >= MAX_FOUND_NAMES) break;
  }
  return [...out.values()];
}

/** Sloučí jména (bez duplicit podle kompaktního tvaru, bez naší firmy). */
export function mergeNames(...lists: readonly (readonly string[] | null | undefined)[]): string[] {
  const out = new Map<string, string>();
  for (const list of lists) {
    for (const raw of list ?? []) {
      const n = String(raw ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 120);
      const k = normalizeText(stripLegalForm(n)).replace(/[^\p{L}\p{N}]+/gu, "");
      if (k.length >= 3 && !out.has(k)) out.set(k, n);
    }
  }
  return [...out.values()].slice(0, MAX_FOUND_NAMES);
}

/** Kontext pravidel rozšířený o jména firem z výkresu (celý název + výrazná slova; naše firma nikdy). */
export function withCompanyNames(ctx: RuleContext, names: readonly string[]): RuleContext {
  if (!names.length || !ctx.redact.company) return ctx;
  const extra: Term[] = [...makeTerms(names, "drawing", ctx.keepTerms), ...makeWordTerms(names, "drawing", ctx.keepTerms)];
  const seen = new Set(ctx.terms.map((t) => t.compact));
  const terms = [...ctx.terms];
  for (const t of extra) {
    if (seen.has(t.compact)) continue;
    seen.add(t.compact);
    terms.push(t);
  }
  return { ...ctx, terms };
}

/**
 * Výstupní kontrola textu: co v řádku ZŮSTALO (smazané znaky nahrazené mezerou) a pořád je to název firmy
 * — termín (CRM, vlastní, z výkresu), firma podle právní formy / doložky. Vrací rozsahy znaků.
 */
export function companyLeaks(remaining: string, zone: Zone, ctx: RuleContext): { start: number; end: number }[] {
  if (!remaining.trim()) return [];
  const r = ruleLine(remaining, zone, ctx);
  return r.hits
    .filter((h) => h.category === "custom" || h.category === "company" || h.category === "copyright_owner")
    .map((h) => ({ start: h.start, end: h.end }))
    // zásah jen do bílých znaků (popisek „Firma:" bez hodnoty) není únik
    .filter((h) => /[\p{L}\p{N}]/u.test(remaining.slice(h.start, h.end)));
}

/**
 * Termín rozdělený do VÍCE po sobě jdoucích textů (DXF: prostrkaný název po písmenech „B" „R" „I" „S" „K",
 * „STROJ" + „METAL" ve dvou entitách, MTEXT rozdělený do kusů po 250 znacích; PDF: buňky na jednom účaří).
 * Bez ohledu na diakritiku, velikost písmen, mezery a spojovníky. Začátek na hranici slova v prvním textu,
 * konec na hranici slova v posledním; prázdné texty se přeskakují. Vrací rozsahy znaků v každém dotčeném
 * textu (index do `texts`). Jen výskyty přes hranici textů — termín celý v jednom textu řeší ruleLine.
 */
export function crossTextTermHits(texts: readonly string[], terms: readonly Term[], maxTexts = 24): { index: number; start: number; end: number }[] {
  const out: { index: number; start: number; end: number }[] = [];
  const usable = terms.filter((t) => t.compact.length >= 4);
  if (texts.length < 2 || !usable.length) return out;
  const longest = Math.max(...usable.map((t) => t.compact.length));
  const maps = texts.map((t) => {
    const n = normalizeWithMap(String(t ?? ""));
    let flat = "";
    const at: number[] = [];
    for (let i = 0; i < n.text.length; i++) if (/[\p{L}\p{N}]/u.test(n.text[i])) { flat += n.text[i]; at.push(i); }
    return { n, flat, at };
  });
  const seen = new Set<string>();
  const push = (h: { index: number; start: number; end: number }) => {
    const k = `${h.index}:${h.start}:${h.end}`;
    if (!seen.has(k)) { seen.add(k); out.push(h); }
  };
  const isAlnum = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
  for (let i = 0; i < texts.length; i++) {
    const a = maps[i];
    if (!a.flat) continue;
    // navazující neprázdné texty, dokud spojení nepokryje nejdelší termín
    const seq: number[] = [i];
    let joined = a.flat;
    for (let j = i + 1; j < texts.length && seq.length < maxTexts && joined.length < a.flat.length + longest; j++) {
      if (!maps[j].flat) continue;
      seq.push(j);
      joined += maps[j].flat;
    }
    if (seq.length < 2) continue;
    // offset začátku každého textu ve spojení
    const offs: number[] = [];
    let o = 0;
    for (const k of seq) { offs.push(o); o += maps[k].flat.length; }
    const where = (pos: number) => {
      let s = 0;
      while (s + 1 < seq.length && offs[s + 1] <= pos) s++;
      return s;
    };
    for (const t of usable) {
      let from = Math.max(0, a.flat.length - t.compact.length + 1);
      for (;;) {
        const pos = joined.indexOf(t.compact, from);
        if (pos < 0 || pos >= a.flat.length) break;
        from = pos + 1;
        const endPos = pos + t.compact.length; // exkluzivně
        if (endPos <= a.flat.length) continue; // celé v prvním textu
        const last = where(endPos - 1);
        const b = maps[seq[last]];
        const ns = a.at[pos];
        const ne = b.at[endPos - 1 - offs[last]] + 1;
        if (isAlnum(a.n.text[ns - 1]) || isAlnum(b.n.text[ne])) continue;
        const [s1] = mapRangeBack(a.n, texts[i], ns, a.n.text.length);
        push({ index: i, start: s1, end: texts[i].length });
        for (let k = 1; k < last; k++) push({ index: seq[k], start: 0, end: texts[seq[k]].length });
        const [, e2] = mapRangeBack(b.n, texts[seq[last]], 0, ne);
        const lastText = texts[seq[last]];
        push({ index: seq[last], start: 0, end: e2 + trailingLegalForm(lastText.slice(e2)) });
      }
    }
  }
  return out;
}
