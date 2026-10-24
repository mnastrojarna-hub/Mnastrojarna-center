/**
 * Normalizace textu pro porovnání termínů (bez diakritiky, malá písmena, sloučené mezery)
 * s mapou zpět na znaky originálu. Čistý modul.
 */

export interface NormText {
  /** Normalizovaný text. */
  text: string;
  /** map[i] = index znaku originálu, ze kterého vznikl znak i normalizovaného textu. */
  map: number[];
}

const MARKS = /\p{M}/gu;
const SPACE = /[\s  -​  　]/;

/** Znak → normalizovaný řetězec (může být prázdný nebo delší — ligatury, ß). */
function normChar(ch: string): string {
  if (ch === "ß") return "ss";
  if (ch === "ł" || ch === "Ł") return "l";
  if (ch === "đ" || ch === "Đ") return "d";
  if (ch === "ø" || ch === "Ø") return "o";
  return ch.normalize("NFKD").replace(MARKS, "").toLowerCase();
}

export function normalizeWithMap(input: string): NormText {
  const out: string[] = [];
  const map: number[] = [];
  let prevSpace = true;
  let idx = 0;
  for (const ch of input) {
    const at = idx;
    idx += ch.length;
    if (SPACE.test(ch)) {
      if (!prevSpace) {
        out.push(" ");
        map.push(at);
        prevSpace = true;
      }
      continue;
    }
    const n = normChar(ch);
    for (const c of n) {
      out.push(c);
      map.push(at);
    }
    if (n) prevSpace = false;
  }
  while (out.length && out[out.length - 1] === " ") {
    out.pop();
    map.pop();
  }
  return { text: out.join(""), map };
}

export function normalizeText(input: string): string {
  return normalizeWithMap(input).text;
}

/** Rozsah v normalizovaném textu → rozsah v originálu [start, end). */
export function mapRangeBack(norm: NormText, original: string, start: number, end: number): [number, number] {
  if (!norm.map.length) return [0, 0];
  const s = norm.map[Math.max(0, Math.min(start, norm.map.length - 1))];
  const lastIdx = norm.map[Math.max(0, Math.min(end - 1, norm.map.length - 1))];
  // konec = za posledním (celým) znakem originálu
  const cp = original.codePointAt(lastIdx);
  const e = lastIdx + (cp !== undefined && cp > 0xffff ? 2 : 1);
  return [s, Math.max(s, e)];
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Levenshteinova vzdálenost (s ořezem — vrátí max+1, když přesáhne). */
export function levenshtein(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** Tokeny normalizovaného textu (písmena a číslice). */
export function tokens(norm: string): string[] {
  return norm.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** sha256 hex (Web Crypto — běží v Node 18+ i v prohlížeči). */
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const buf = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
