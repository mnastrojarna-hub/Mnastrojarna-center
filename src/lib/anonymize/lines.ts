/**
 * Skládání textových položek do řádků (spec §2.2 krok 3) + mapa znaků řádku zpět na položky
 * a geometrie podřetězců (i u natočeného textu). Čistý modul.
 */

import { Encodings, Font, FontNames } from "@pdf-lib/standard-fonts";
import type { Box, LineSpan, Quad, TextItem, TextLine, Zone } from "./types";

/** Metriky Helvetica (AFM, ≈ Arial — nejčastější písmo výkresů) pro šířky podřetězců. */
let helv: Font | null = null;
function afmWidth(ch: string): number | null {
  try {
    helv ??= Font.load(FontNames.Helvetica);
    const cp = ch.codePointAt(0) ?? 0;
    if (!Encodings.WinAnsi.canEncodeUnicodeCodePoint(cp)) return null;
    const g = Encodings.WinAnsi.encodeUnicodeCodePoint(cp);
    const w = helv.getWidthOfGlyph(g.name);
    return typeof w === "number" && w > 0 ? w / 1000 : null;
  } catch {
    return null;
  }
}

const DEG = Math.PI / 180;

/** Geometrie položky ve směru textu: počátek účaří, směr, délka, výška písma. */
export interface ItemFrame {
  ox: number;
  oy: number;
  /** Jednotkový směr textu (viewport, y dolů). */
  dx: number;
  dy: number;
  adv: number;
  em: number;
}

export function itemFrame(it: TextItem): ItemFrame {
  const a = (it.rot || 0) * DEG;
  const dx = Math.cos(a);
  const dy = -Math.sin(a);
  if (typeof it.ox === "number" && typeof it.oy === "number" && typeof it.adv === "number") {
    return { ox: it.ox, oy: it.oy, dx, dy, adv: it.adv, em: Math.max(it.fontSize, 0.1) };
  }
  // osový obal → odhad (vodorovně: účaří = spodek)
  if (Math.abs(it.rot || 0) < 1) return { ox: it.x, oy: it.y + it.h, dx: 1, dy: 0, adv: it.w, em: Math.max(it.fontSize || it.h, 0.1) };
  return { ox: it.x, oy: it.y + it.h, dx, dy, adv: Math.max(it.w, it.h), em: Math.max(it.fontSize, 0.1) };
}

/** Relativní šířky znaků (přibližně Helvetica/ISO písmo) pro rozdělení položky na podřetězce. */
export function charWeight(ch: string): number {
  const afm = afmWidth(ch);
  if (afm !== null) return afm;
  if (ch === " ") return 0.28;
  if ("iljtfrI.,:;!|'`".includes(ch)) return 0.3;
  if ("mwMW".includes(ch)) return 0.85;
  if (/[A-ZÀ-Ý]/.test(ch)) return 0.68;
  if (/\d/.test(ch)) return 0.56;
  if (/[　-鿿]/.test(ch)) return 1;
  return 0.54;
}

/** Podíl šířky [0..1] před znakem `i` v řetězci. */
export function advanceFraction(str: string, i: number): number {
  const chars = Array.from(str);
  if (!chars.length) return 0;
  let total = 0;
  let before = 0;
  for (let k = 0; k < chars.length; k++) {
    const w = charWeight(chars[k]);
    if (k < i) before += w;
    total += w;
  }
  return total > 0 ? Math.min(1, before / total) : 0;
}

/** Index znaku (UTF-16) → index kódového bodu. */
function cpIndex(str: string, utf16: number): number {
  return Array.from(str.slice(0, utf16)).length;
}

/**
 * Čtyřúhelník podřetězce položky [from, to) v bodech (viewport). Rezerva po stranách: u celé položky
 * `padChars` průměrných znaků; u podřetězce těsně — vedle mezery 80 % její šířky, uvnitř slova 0,15 em,
 * na okraji položky půl znaku (popisek „Kreslil:" vedle jména zůstane celý). Výška od 0,3 em pod
 * účařím po 1,0 em nad ním.
 */
export function substringQuad(it: TextItem, from: number, to: number, padChars = 1): Quad {
  const f = itemFrame(it);
  const chars = Array.from(it.str);
  const n = chars.length || 1;
  const a = cpIndex(it.str, Math.max(0, from));
  const b = cpIndex(it.str, Math.max(from, to));
  const avg = f.adv / n;
  const fa = advanceFraction(it.str, a) * f.adv;
  const fb = advanceFraction(it.str, b) * f.adv;
  const whole = a === 0 && b >= n;
  const total = chars.reduce((s, c) => s + charWeight(c), 0) || 1;
  const unit = f.adv / total; // body na jednotku šířky
  const reserve = (side: "l" | "r"): number => {
    if (whole || padChars === 0) return avg * padChars;
    const i = side === "l" ? a - 1 : b;
    if (i < 0 || i >= n) return 0.5 * avg;
    const ch = chars[i];
    return /\s/.test(ch) ? 0.8 * charWeight(ch) * unit : 0.15 * f.em;
  };
  const u0 = Math.max(-avg * Math.max(1, padChars), fa - reserve("l"));
  const u1 = Math.min(f.adv + avg * Math.max(1, padChars), fb + reserve("r"));
  const ux = f.dx, uy = f.dy;
  // „nahoru" = kolmo na směr textu (proti směru y)
  const nx = uy, ny = -ux;
  const down = 0.3 * f.em, up = 1.0 * f.em;
  const P = (u: number, v: number): [number, number] => [f.ox + ux * u + nx * v, f.oy + uy * u + ny * v];
  const p1 = P(u0, up), p2 = P(u1, up), p3 = P(u1, -down), p4 = P(u0, -down);
  return [p1[0], p1[1], p2[0], p2[1], p3[0], p3[1], p4[0], p4[1]];
}

export function quadBox(q: readonly number[]): Box {
  const xs = [q[0], q[2], q[4], q[6]];
  const ys = [q[1], q[3], q[5], q[7]];
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function unionBox(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

interface Open {
  items: TextItem[];
  frame: ItemFrame;
  rot: number;
  /** Souřadnice konce poslední položky ve směru textu. */
  uEnd: number;
  v: number;
  em: number;
}

/**
 * Položky se stejným účařím (|Δ| < 0,3 em, stejná rotace) a mezerou < 0,3 em se spojí do řádku.
 * Mezera ≥ 0,15 em mezi položkami = mezera v textu řádku.
 */
export function buildLines(items: readonly TextItem[], page: number, zoneOf: (box: Box) => Zone, opts: { gapEm?: number } = {}): TextLine[] {
  const gapEm = opts.gapEm ?? 0.3;
  const usable = items.filter((it) => it.page === page && it.str && it.str.trim().length > 0);
  // projekce do směru textu: u (podél), v (kolmo — účaří)
  const proj = usable.map((it) => {
    const f = itemFrame(it);
    const u = f.ox * f.dx + f.oy * f.dy;
    const v = -f.ox * f.dy + f.oy * f.dx;
    return { it, f, u, v, rot: Math.round(it.rot || 0) };
  });
  proj.sort((a, b) => a.rot - b.rot || a.v - b.v || a.u - b.u);
  const open: Open[] = [];
  const done: Open[] = [];
  for (const p of proj) {
    // řádky daleko nad aktuálním účařím už nic nedostanou (setříděno podle rotace a v)
    for (let k = open.length - 1; k >= 0; k--) {
      if (open[k].rot !== p.rot || p.v - open[k].v > 2 * Math.max(open[k].em, p.f.em)) open.splice(k, 1);
    }
    let best: Open | null = null;
    let bestGap = Infinity;
    for (const o of open) {
      if (o.rot !== p.rot) continue;
      const em = Math.max(o.em, p.f.em);
      if (Math.abs(o.v - p.v) >= 0.3 * em) continue;
      const gap = p.u - o.uEnd;
      if (gap < -0.5 * em || gap >= gapEm * em) continue;
      if (Math.abs(gap) < bestGap) {
        best = o;
        bestGap = Math.abs(gap);
      }
    }
    if (best) {
      best.items.push(p.it);
      best.uEnd = Math.max(best.uEnd, p.u + p.f.adv);
      best.em = Math.max(best.em, p.f.em);
    } else {
      const o: Open = { items: [p.it], frame: p.f, rot: p.rot, uEnd: p.u + p.f.adv, v: p.v, em: p.f.em };
      open.push(o);
      done.push(o);
    }
  }
  // stabilní pořadí: shora dolů, zleva doprava (podle obalu)
  const lines = done.map((o) => {
    const sorted = [...o.items].sort((a, b) => {
      const fa = itemFrame(a), fb = itemFrame(b);
      return (fa.ox * fa.dx + fa.oy * fa.dy) - (fb.ox * fb.dx + fb.oy * fb.dy);
    });
    let text = "";
    const spans: LineSpan[] = [];
    let box: Box | null = null;
    let prevEnd: number | null = null;
    for (const it of sorted) {
      const f = itemFrame(it);
      const u = f.ox * f.dx + f.oy * f.dy;
      if (prevEnd !== null && text && !/\s$/.test(text) && !/^\s/.test(it.str) && u - prevEnd >= 0.15 * Math.max(o.em, f.em)) text += " ";
      const start = text.length;
      text += it.str;
      spans.push({ itemId: it.id, start, end: text.length, offset: 0 });
      prevEnd = u + f.adv;
      const b: Box = { x: it.x, y: it.y, w: it.w, h: it.h };
      box = box ? unionBox(box, b) : b;
    }
    return { text, spans, box: box ?? { x: 0, y: 0, w: 0, h: 0 }, fontSize: o.em, rot: o.rot };
  });
  lines.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  return lines.map((l, i) => ({ id: `p${page}:L${i + 1}`, page, ...l, zone: zoneOf(l.box) }));
}

/** Rozsah znaků řádku → části položek (itemId + rozsah v textu položky). */
export function lineRangeToItems(line: TextLine, start: number, end: number): { itemId: string; from: number; to: number; whole: boolean }[] {
  const out: { itemId: string; from: number; to: number; whole: boolean }[] = [];
  for (const s of line.spans) {
    const a = Math.max(start, s.start);
    const b = Math.min(end, s.end);
    if (b <= a) continue;
    const from = a - s.start + s.offset;
    const to = b - s.start + s.offset;
    out.push({ itemId: s.itemId, from, to, whole: from <= s.offset && to >= s.end - s.start + s.offset });
  }
  return out;
}
