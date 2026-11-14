/**
 * Výběr oknem (box select) jako v AutoCADu / SolidWorks — čistá geometrie bez three.js:
 *  - tažení zleva doprava = okno (window): vybere jen prvky celé uvnitř obdélníku,
 *  - zprava doleva = křížení (crossing): vybere vše, čeho se obdélník dotkne,
 *  - Shift = přidat k výběru, Ctrl / ⌘ = odebrat z výběru, bez klávesy = nahradit výběr.
 * Souřadnice jsou libovolné 2D (pixely obrazovky nebo mm výkresu) — jen konzistentně.
 */

/** Osově zarovnaný obdélník, vždy x0 ≤ x1, y0 ≤ y1. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type BoxMode = "window" | "crossing";
export type SelectOp = "replace" | "add" | "remove";

export function rectOf(ax: number, ay: number, bx: number, by: number): Rect {
  return { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
}

/** Obdélník z tažení: směr doprava = okno, doleva = křížení. */
export function dragBox(sx: number, sy: number, ex: number, ey: number): { rect: Rect; mode: BoxMode } {
  return { rect: rectOf(sx, sy, ex, ey), mode: ex >= sx ? "window" : "crossing" };
}

/** Klávesy při puštění tlačítka → co se s výběrem stane. */
export function selectOp(mods: { shift?: boolean; ctrl?: boolean }): SelectOp {
  if (mods.ctrl) return "remove";
  if (mods.shift) return "add";
  return "replace";
}

/** Nový výběr po výběru oknem (původní množina se nemění). */
export function applySelectOp<T>(current: Iterable<T>, hits: Iterable<T>, op: SelectOp): Set<T> {
  if (op === "replace") return new Set(hits);
  const out = new Set(current);
  for (const h of hits) {
    if (op === "add") out.add(h);
    else out.delete(h);
  }
  return out;
}

export const pointInRect = (x: number, y: number, r: Rect): boolean => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

/** Je `inner` celý uvnitř `outer`? */
export const rectInside = (inner: Rect, outer: Rect): boolean =>
  inner.x0 >= outer.x0 && inner.x1 <= outer.x1 && inner.y0 >= outer.y0 && inner.y1 <= outer.y1;

/** Překrývají se (dotyk hranou se počítá)? */
export const rectsOverlap = (a: Rect, b: Rect): boolean => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;

/** Dotkne se úsečka obdélníku? (Liang–Barsky: ořez úsečky obdélníkem.) */
export function segmentTouchesRect(ax: number, ay: number, bx: number, by: number, r: Rect): boolean {
  if (pointInRect(ax, ay, r) || pointInRect(bx, by, r)) return true;
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return clip(-dx, ax - r.x0) && clip(dx, r.x1 - ax) && clip(-dy, ay - r.y0) && clip(dy, r.y1 - ay) && t0 <= t1;
}

/** Vztah tvaru k obdélníku: 0 = mimo, 1 = dotýká se (část uvnitř), 2 = celý uvnitř. */
export type RectRelation = 0 | 1 | 2;

/**
 * Úsečky (dvojice bodů) v poli `seg` s krokem `stride` na bod (xy nebo xyz…), úsečky [from, to)
 * — vztah k obdélníku. `ox`, `oy` = posun všech bodů (rozebraná sestava).
 */
export function segmentsRelation(seg: ArrayLike<number>, from: number, to: number, r: Rect, stride = 3, ox = 0, oy = 0): RectRelation {
  if (to <= from) return 0;
  let allIn = true;
  let touch = false;
  const s2 = stride * 2;
  for (let i = from; i < to; i++) {
    const k = i * s2;
    const ax = seg[k] + ox;
    const ay = seg[k + 1] + oy;
    const bx = seg[k + stride] + ox;
    const by = seg[k + stride + 1] + oy;
    const ina = pointInRect(ax, ay, r);
    const inb = pointInRect(bx, by, r);
    if (!ina || !inb) allIn = false;
    if (!touch && (ina || inb || segmentTouchesRect(ax, ay, bx, by, r))) touch = true;
    if (touch && !allIn) return 1;
  }
  return allIn ? 2 : touch ? 1 : 0;
}

/** Lomená čára z bodů [[x, y], …] (uzavřená = i úsečka z posledního do prvního bodu). */
export function polylineRelation(points: [number, number][], r: Rect, closed = false): RectRelation {
  if (!points.length) return 0;
  if (points.length === 1) return pointInRect(points[0][0], points[0][1], r) ? 2 : 0;
  const flat: number[] = [];
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    flat.push(a[0], a[1], b[0], b[1]);
  }
  return segmentsRelation(flat, 0, n, r, 2);
}

/** Obdélník tvaru (text, obalový kvádr) vůči výběru. */
export function rectRelation(shape: Rect, r: Rect): RectRelation {
  if (rectInside(shape, r)) return 2;
  return rectsOverlap(shape, r) ? 1 : 0;
}

/** Vybrat tvar s tímto vztahem? Okno = jen celý uvnitř, křížení = cokoli, co se dotýká. */
export const boxHit = (rel: RectRelation, mode: BoxMode): boolean => (mode === "window" ? rel === 2 : rel >= 1);

/** Dotkne se trojúhelník obdélníku? (Vrchol uvnitř, hrana přes obdélník, nebo obdélník v trojúhelníku.) */
export function triangleTouchesRect(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: Rect): boolean {
  if (segmentTouchesRect(ax, ay, bx, by, r) || segmentTouchesRect(bx, by, cx, cy, r) || segmentTouchesRect(cx, cy, ax, ay, r)) return true;
  // žádná hrana obdélník neprotíná → buď je obdélník celý v trojúhelníku, nebo mimo: stačí jeden roh
  return pointInTriangle(r.x0, r.y0, ax, ay, bx, by, cx, cy);
}

export function pointInTriangle(px: number, py: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/**
 * Obalový kvádr promítnutý na obrazovku → obdélník v pixelech. `project` vrací [x, y] pixelu
 * (ortografická kamera: obraz kvádru leží v obdélníku obrazů jeho 8 rohů).
 */
export function projectedBoxRect(
  min: [number, number, number], max: [number, number, number],
  project: (x: number, y: number, z: number) => [number, number],
): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    const [x, y] = project(i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

/**
 * Skupiny (díl, podsestava) z vybraných těles: u okna jen skupiny, jejichž všechna viditelná tělesa
 * jsou uvnitř; u křížení každá skupina, které se výběr dotkl (celá).
 */
export function expandGroups(hits: Set<number>, group: (i: number) => number[], visible: (i: number) => boolean, mode: BoxMode): number[] {
  const out = new Set<number>();
  const done = new Set<number>();
  for (const h of hits) {
    if (done.has(h)) continue;
    const g = group(h).filter(visible);
    for (const i of g) done.add(i);
    if (mode === "window" && !g.every((i) => hits.has(i))) continue;
    for (const i of g) out.add(i);
  }
  return [...out];
}

// ---------------------------------------------------------------- souhrn výběru 2D výkresu

/** Druh vybíratelného prvku výkresu (blok / kóta / šrafa / odkaz = jedna skupina). */
export type DrawItemKind =
  | "line" | "polyline" | "circle" | "arc" | "ellipse" | "curve" | "point" | "text"
  | "insert" | "dimension" | "hatch" | "leader";

const KIND_WORDS: Record<DrawItemKind, [string, string, string]> = {
  line: ["úsečka", "úsečky", "úseček"],
  polyline: ["polyčára", "polyčáry", "polyčar"],
  circle: ["kružnice", "kružnice", "kružnic"],
  arc: ["oblouk", "oblouky", "oblouků"],
  ellipse: ["elipsa", "elipsy", "elips"],
  curve: ["křivka", "křivky", "křivek"],
  point: ["bod", "body", "bodů"],
  text: ["text", "texty", "textů"],
  insert: ["blok", "bloky", "bloků"],
  dimension: ["kóta", "kóty", "kót"],
  hatch: ["šrafa", "šrafy", "šraf"],
  leader: ["odkaz", "odkazy", "odkazů"],
};

const KIND_ORDER: DrawItemKind[] = ["line", "polyline", "circle", "arc", "ellipse", "curve", "insert", "dimension", "text", "hatch", "leader", "point"];

export function czPlural(n: number, words: [string, string, string]): string {
  const w = n === 1 ? words[0] : n >= 2 && n <= 4 ? words[1] : words[2];
  return `${n.toLocaleString("cs-CZ")} ${w}`;
}

export function kindLabel(kind: DrawItemKind, n: number): string {
  return czPlural(n, KIND_WORDS[kind]);
}

/** Druhy, které se počítají do délky řezu (obrys dílu) — ne kóty, texty, šrafy, odkazy ani body. */
export const CUT_KINDS: ReadonlySet<DrawItemKind> = new Set<DrawItemKind>(["line", "polyline", "circle", "arc", "ellipse", "curve", "insert"]);

/** Počty po druzích v ustáleném pořadí: [[druh, počet], …]. */
export function countByKind(kinds: Iterable<DrawItemKind>): [DrawItemKind, number][] {
  const m = new Map<DrawItemKind, number>();
  for (const k of kinds) m.set(k, (m.get(k) ?? 0) + 1);
  return KIND_ORDER.filter((k) => m.has(k)).map((k) => [k, m.get(k)!]);
}

/** Průměry kružnic → [[Ø, počet], …] od nejčastějšího (zaokrouhleno na 0,01 mm). */
export function diameterCounts(radii: Iterable<number>): [number, number][] {
  const m = new Map<number, number>();
  for (const r of radii) {
    const d = Math.round(r * 200) / 100;
    m.set(d, (m.get(d) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
}
