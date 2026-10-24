/**
 * Ověření bez úsudku (spec §2.3 průchod 3, M4): AI vypálené dlaždice jen DOSLOVNĚ přepíše a popíše
 * grafiku; tady se deterministicky kontroluje, že v přepisu není citlivý řetězec (Levenshtein ≤ 1
 * na tokenech ≥ 4 znaky), termín ani zásah pravidla, že keep hodnoty zůstaly a že v razítku/rámu
 * není nové logo. Čistý modul.
 */

import { levenshtein, normalizeText, tokens } from "./text";
import { containsTerm, ruleLine, type RuleContext } from "./rules";
import type { Zone } from "./types";

export interface VerifyTile {
  img: number;
  zone: Zone;
  lines: string[];
  graphics: { quad: number[]; description: string; kind?: string }[];
}

/** Je grafika z přepisu únik (logo, firemní razítko, podpis, kód)? */
export function graphicLeaks(g: { description: string; kind?: string }): boolean {
  if (g.kind && (LEAK_GRAPHIC_KINDS as readonly string[]).includes(g.kind)) return true;
  return GRAPHIC_LEAK.test(String(g.description ?? ""));
}

export interface VerifyInput {
  tiles: VerifyTile[];
  /** Texty smazané v průchodu 2 (citlivé řetězce). */
  sensitive: string[];
  /** Texty, které v průchodu 2 zůstaly (jejich slova nejsou únik — „Hřídel" v cestě i v názvu dílu). */
  kept?: string[];
  ctx: RuleContext;
  /** Keep hodnoty, které musí v přepisu zůstat (číslo výkresu, revize, materiál). */
  keepValues: string[];
}

export interface VerifyLeak {
  img: number;
  /** Index řádku přepisu (nebo -1 u grafiky). */
  line: number;
  kind: "sensitive" | "term" | "rule" | "graphic";
  /** Token, který unikl (pro dohledání v řádcích průchodu 2) — jen v paměti. */
  token: string;
  quad?: number[];
}

export interface VerifyOutcome {
  clean: boolean;
  leaks: VerifyLeak[];
  missingKeep: string[];
}

/**
 * Popis grafiky, který znamená únik (logo, firemní razítko, podpis, kód) — celá slova od začátku slova
 * (i skloňování: „logem", „podpisu"). Technická slova vedle („se šipkou", „s čárami", „detail") únik
 * NERUŠÍ — logo zůstává logem. Druh grafiky (`kind`) z přepisu má přednost.
 */
const GRAPHIC_LEAK = /(?<![\p{L}])(?:log[oaeuů]\p{L}*|znak\p{L}* firmy|firemn\p{L}* znak|emblem\p{L}*|emblém\p{L}*|ochrann\p{L}* známk\p{L}*|trademark\p{L}*|firemn\p{L}* razítk\p{L}*|razítk\p{L}* firmy|razítk\p{L}* společnosti|otisk\p{L}* razítk\p{L}*|company stamp|stamp|otisk\p{L}*|podpis\p{L}*|signature\p{L}*|signiert\p{L}*|unterschrift\p{L}*|paraf\p{L}*|qr|qr[- ]?kód\p{L}*|data ?matrix|čárov\p{L}* kód\p{L}*|barcode\p{L}*|vodoznak\p{L}*|watermark\p{L}*|wordmark\p{L}*|monogram\p{L}*|firemn\p{L}* značk\p{L}*|ochrann\p{L}* značk\p{L}*)(?![\p{L}])/iu;
export const LEAK_GRAPHIC_KINDS = ["logo", "company_stamp", "signature", "code"] as const;

function sensitiveTokens(s: string): string[] {
  return tokens(normalizeText(s)).filter((t) => t.length >= 4 && !/^\d+$/.test(t));
}

/** Obsahuje řádek přepisu některý citlivý token (Levenshtein ≤ 1)? */
export function lineHasToken(line: string, sensTokens: readonly string[]): string | null {
  const lt = tokens(normalizeText(line));
  for (const s of sensTokens) {
    for (const t of lt) {
      if (t.length < 4) continue;
      if (t === s || (Math.abs(t.length - s.length) <= 1 && levenshtein(t, s, 1) <= 1)) return s;
    }
    // rozepsané / slepené („STROJMETALKLADNO")
    const flat = lt.join("");
    if (s.length >= 5 && flat.includes(s)) return s;
  }
  return null;
}

export function keepPresent(transcript: readonly string[], value: string): boolean {
  const v = normalizeText(value).replace(/[^\p{L}\p{N}]+/gu, "");
  if (v.length < 2) return true;
  const all = transcript.map((l) => normalizeText(l).replace(/[^\p{L}\p{N}]+/gu, "")).join("|");
  if (all.includes(v)) return true;
  // drobná chyba přepisu (O/0, l/1) — Levenshtein ≤ 1 vůči podřetězcům stejné délky
  if (v.length >= 5) {
    for (const part of all.split("|")) {
      for (let i = 0; i + v.length <= part.length + 1; i++) {
        if (levenshtein(part.slice(i, i + v.length), v, 1) <= 1) return true;
      }
    }
  }
  return false;
}

export function checkTranscript(input: VerifyInput): VerifyOutcome {
  // slova termínů (zákazník z CRM…) jsou únik vždy — i když se stejné slovo vyskytuje v ponechaném řádku
  const termTokens = new Set(input.ctx.terms
    .flatMap((t) => (t.word || tokens(t.norm).length === 1 ? tokens(t.norm) : []))
    .filter((t) => t.length >= 4 && !/^\d+$/.test(t)));
  const keptTokens = new Set((input.kept ?? []).flatMap((k) => tokens(normalizeText(k))).filter((t) => !termTokens.has(t)));
  const sens = [...new Set([...input.sensitive.flatMap(sensitiveTokens), ...termTokens])].filter((t) => !keptTokens.has(t));
  const leaks: VerifyLeak[] = [];
  for (const tile of input.tiles) {
    tile.lines.forEach((line, i) => {
      const tok = lineHasToken(line, sens);
      if (tok) {
        leaks.push({ img: tile.img, line: i, kind: "sensitive", token: tok });
        return;
      }
      if (containsTerm(line, input.ctx.terms)) {
        leaks.push({ img: tile.img, line: i, kind: "term", token: normalizeText(line) });
        return;
      }
      const r = ruleLine(line, tile.zone, input.ctx);
      if (r.hits.length) leaks.push({ img: tile.img, line: i, kind: "rule", token: normalizeText(line.slice(r.hits[0].start, r.hits[0].end)) });
    });
    if (tile.zone !== "body") {
      for (const g of tile.graphics) {
        if (graphicLeaks(g)) {
          leaks.push({ img: tile.img, line: -1, kind: "graphic", token: "", quad: g.quad });
        }
      }
    }
  }
  const transcript = input.tiles.flatMap((t) => t.lines);
  const missingKeep = input.keepValues.filter((v) => v.trim() && !keepPresent(transcript, v));
  return { clean: leaks.length === 0 && missingKeep.length === 0, leaks, missingKeep };
}
