/**
 * Výběr oknem ve 2D – skica, 2D výkres (draft) a výkres dílu / sestavy. Čistá geometrie a pravidla bez UI
 * (UI: `components/cad/box-select-2d-ui.tsx`; 3D model má vlastní modul).
 *
 * Pravidla (stejná ve všech 2D prostředích):
 * - stisk levého tlačítka a tažení o ≥ `CLICK_PX` px = okno, menší posun = klik;
 * - zleva doprava = **okno** (vybere se jen to, co leží celé uvnitř), zprava doleva = **křížení** (uvnitř nebo protnuté);
 * - modifikátory okna: bez = nahradí výběr, Ctrl (⌘) nebo Shift = přidá, Ctrl+Shift nebo Alt = odebere;
 *   klik: bez = nahradí, Ctrl / Shift = přepne (přidá / odebere tu jednu), Ctrl+Shift / Alt = odebere;
 * - `accumulate` (výzva „Vyberte objekty“ příkazu 2D výkresu, fáze výběru nástroje skici): bez modifikátoru se přidává
 *   – výzva sbírá výběr postupně jako v AutoCADu, nahrazení by další okno smazalo předchozí.
 */

export type P2 = readonly [number, number];
/** obdélník (x0 ≤ x1, y0 ≤ y1) */
export type Rect2 = { x0: number; y0: number; x1: number; y1: number };
export type BoxMode = "replace" | "add" | "remove";
export type ClickMode = BoxMode | "toggle";
export type BoxMods = { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean };

/** posun menší než tolik px je klik, ne okno */
export const CLICK_PX = 5;
/** dotyk: dlouhý stisk (ms) jedním prstem na místě, potom tažení = okno */
export const HOLD_MS = 500;
/** dotyk: posun prstu (px), do kterého se stisk ještě počítá jako „na místě“ */
export const HOLD_SLOP_PX = 8;

export const rectFrom = (a: P2, b: P2): Rect2 => ({ x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) });
/** tažení zprava doleva (na obrazovce i v souřadnicích s osou x doprava) = křížení */
export const isCrossing = (from: P2, to: P2): boolean => to[0] < from[0];
/** posun ukazatele od stisku je tažení (ne klik) */
export const isDrag = (from: P2, to: P2, px = CLICK_PX): boolean => Math.hypot(to[0] - from[0], to[1] - from[1]) >= px;

const ctrlOf = (m: BoxMods) => !!(m.ctrlKey || m.metaKey);
const removing = (m: BoxMods) => !!m.altKey || (ctrlOf(m) && !!m.shiftKey);

/** režim okna podle modifikátorů (u více událostí – stisk a puštění – se modifikátory sčítají) */
export function boxMode(mods: BoxMods | BoxMods[], accumulate = false): BoxMode {
  const m = merge(mods);
  if (removing(m)) return "remove";
  if (ctrlOf(m) || m.shiftKey) return "add";
  return accumulate ? "add" : "replace";
}

/** režim kliku na jednu entitu podle modifikátorů */
export function clickMode(mods: BoxMods | BoxMods[], accumulate = false): ClickMode {
  const m = merge(mods);
  if (removing(m)) return "remove";
  if (ctrlOf(m) || m.shiftKey) return "toggle";
  return accumulate ? "add" : "replace";
}

function merge(mods: BoxMods | BoxMods[]): BoxMods {
  const list = Array.isArray(mods) ? mods : [mods];
  return { ctrlKey: list.some((m) => m.ctrlKey), metaKey: list.some((m) => m.metaKey), shiftKey: list.some((m) => m.shiftKey), altKey: list.some((m) => m.altKey) };
}

/** nový výběr: `cur` upravený o `ids` v režimu `mode` (pořadí: dosavadní, pak nové) */
export function mergeSelection(cur: readonly string[], ids: readonly string[], mode: ClickMode): string[] {
  if (mode === "replace") return [...new Set(ids)];
  const set = new Set(cur);
  if (mode === "toggle") {
    // klik s Ctrl / Shift: vybraná se odebere, nevybraná přidá
    const allIn = ids.length > 0 && ids.every((id) => set.has(id));
    for (const id of ids) {
      if (allIn) set.delete(id);
      else set.add(id);
    }
    return [...set];
  }
  for (const id of ids) {
    if (mode === "remove") set.delete(id);
    else set.add(id);
  }
  return [...set];
}

// ---------------------------------------------------------------- geometrie

export const ptIn = (p: P2, r: Rect2): boolean => p[0] >= r.x0 && p[0] <= r.x1 && p[1] >= r.y0 && p[1] <= r.y1;
export const rectInside = (inner: Rect2, r: Rect2): boolean => inner.x0 >= r.x0 && inner.x1 <= r.x1 && inner.y0 >= r.y0 && inner.y1 <= r.y1;
export const rectsTouch = (a: Rect2, b: Rect2): boolean => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;

/** úsečka a–b zasahuje do obdélníku (protíná hranici nebo leží uvnitř) – ořez Liang–Barsky */
export function segTouchesRect(a: P2, b: P2, r: Rect2): boolean {
  if (ptIn(a, r) || ptIn(b, r)) return true;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-300) return q >= 0;
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
  return clip(-dx, a[0] - r.x0) && clip(dx, r.x1 - a[0]) && clip(-dy, a[1] - r.y0) && clip(dy, r.y1 - a[1]) && t0 <= t1;
}

/** lomená čára celá uvnitř (všechny vrcholy – obdélník je konvexní, úseky mezi nimi tedy taky) */
export const polyInside = (pts: readonly P2[], r: Rect2): boolean => pts.length > 0 && pts.every((p) => ptIn(p, r));
/** lomená čára zasahuje do obdélníku (vrchol uvnitř nebo úsek protíná hranici) */
export function polyTouches(pts: readonly P2[], r: Rect2): boolean {
  if (pts.length === 1) return ptIn(pts[0], r);
  for (let i = 1; i < pts.length; i++) if (segTouchesRect(pts[i - 1], pts[i], r)) return true;
  return false;
}

export function boundsOf(pts: Iterable<P2>): Rect2 | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[0] > x1) x1 = p[0];
    if (p[1] > y1) y1 = p[1];
  }
  return x0 <= x1 ? { x0, y0, x1, y1 } : null;
}

/**
 * Tvar pro výběr oknem: lomené čáry (vzorkované křivky), samostatné body a obdélníky (texty). Prázdný tvar se nevybere.
 * `bbox` = obálka (nepovinná – dopočítá se), slouží k rychlému vyřazení.
 */
export type BoxShape = { id: string; polys?: readonly (readonly P2[])[]; pts?: readonly P2[]; rects?: readonly Rect2[]; bbox?: Rect2 | null };

export function shapeBounds(s: BoxShape): Rect2 | null {
  if (s.bbox !== undefined) return s.bbox;
  const all: P2[] = [];
  for (const pl of s.polys ?? []) all.push(...pl);
  all.push(...(s.pts ?? []));
  for (const q of s.rects ?? []) all.push([q.x0, q.y0], [q.x1, q.y1]);
  return boundsOf(all);
}

/** okno: tvar celý uvnitř; křížení: tvar uvnitř nebo protnutý hranicí okna */
export function shapeHit(s: BoxShape, r: Rect2, crossing: boolean): boolean {
  const bb = shapeBounds(s);
  if (!bb || !rectsTouch(bb, r)) return false;
  if (rectInside(bb, r)) return true;
  if (!crossing) return false;
  for (const pl of s.polys ?? []) if (polyTouches(pl, r)) return true;
  for (const p of s.pts ?? []) if (ptIn(p, r)) return true;
  for (const q of s.rects ?? []) if (rectsTouch(q, r)) return true;
  return false;
}

/** id tvarů vybraných oknem / křížením (v pořadí tvarů) */
export function selectShapes(shapes: readonly BoxShape[], r: Rect2, crossing: boolean): string[] {
  const out: string[] = [];
  for (const s of shapes) if (shapeHit(s, r, crossing)) out.push(s.id);
  return out;
}

/** vzdálenost bodu od tvaru (0 uvnitř obdélníku textu) – výběr kliknutím */
export function shapeDist(s: BoxShape, p: P2): number {
  let best = Infinity;
  const seg = (a: P2, b: P2) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const L = dx * dx + dy * dy;
    const t = L > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  for (const pl of s.polys ?? []) {
    if (pl.length === 1) best = Math.min(best, Math.hypot(p[0] - pl[0][0], p[1] - pl[0][1]));
    for (let i = 1; i < pl.length; i++) best = Math.min(best, seg(pl[i - 1], pl[i]));
  }
  for (const q of s.pts ?? []) best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1]));
  for (const q of s.rects ?? []) best = Math.min(best, Math.hypot(Math.max(q.x0 - p[0], 0, p[0] - q.x1), Math.max(q.y0 - p[1], 0, p[1] - q.y1)));
  return best;
}

/** nejbližší tvar do vzdálenosti `tol` (u shody později přidaný – je nahoře) */
export function pickShape(shapes: readonly BoxShape[], p: P2, tol: number): string | null {
  let best: string | null = null;
  let bd = Infinity;
  for (const s of shapes) {
    const bb = shapeBounds(s);
    if (!bb || p[0] < bb.x0 - tol || p[0] > bb.x1 + tol || p[1] < bb.y0 - tol || p[1] > bb.y1 + tol) continue;
    const d = shapeDist(s, p);
    if (d <= tol && d <= bd) {
      bd = d;
      best = s.id;
    }
  }
  return best;
}

// ---------------------------------------------------------------- dotyk

/**
 * Dlouhý stisk prstem: „wait“ = ještě se čeká, „hold“ = prst držel na místě ≥ HOLD_MS (další tažení kreslí okno),
 * „moved“ = prst se pohnul dřív (běžný posun pohledu).
 */
export function holdPhase(down: P2, downT: number, now: P2, nowT: number, ms = HOLD_MS, slop = HOLD_SLOP_PX): "wait" | "hold" | "moved" {
  if (Math.hypot(now[0] - down[0], now[1] - down[1]) > slop) return "moved";
  return nowT - downT >= ms ? "hold" : "wait";
}

/** poklepání: druhý stisk do `DBL_MS` ms a do `DBL_PX` px od prvního (stejné pravidlo pro plátno i rozšíření) */
export const DBL_MS = 350;
export const DBL_PX = 6;
export const isDoubleClick = (first: P2, firstT: number, now: P2, nowT: number, ms = DBL_MS, px = DBL_PX): boolean =>
  nowT - firstT < ms && Math.hypot(now[0] - first[0], now[1] - first[1]) < px;

// ---------------------------------------------------------------- skica

/**
 * Skica: id entit v okně tažené z `from` do `to` (mm skici, osa x doprava – směr určuje okno / křížení).
 * Křivky podle vzorkované dráhy (`paths`, jako ji skicář kreslí), bod skici podle polohy.
 */
export function sketchBoxIds(entities: readonly { id: string; type: string; p?: readonly [number, number] }[], paths: ReadonlyMap<string, { pts: readonly P2[] }>, from: P2, to: P2): string[] {
  const shapes: BoxShape[] = [];
  for (const e of entities) {
    if (e.type === "point" && e.p) shapes.push({ id: e.id, pts: [e.p] });
    else {
      const pts = paths.get(e.id)?.pts;
      if (pts?.length) shapes.push({ id: e.id, polys: [pts] });
    }
  }
  return selectShapes(shapes, rectFrom(from, to), isCrossing(from, to));
}
