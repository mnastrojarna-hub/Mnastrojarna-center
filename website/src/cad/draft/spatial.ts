/**
 * Prostorový index entit 2D výkresu (statický R-strom „packed“ – seřazení podle Hilbertovy křivky, uzly po 16).
 * Stavba 20 000 entit ≈ jednotky ms; dotaz na okno vrací kandidáty pro vykreslení, výběr a uchopení.
 * Nekonečné entity (přímka, polopřímka) jsou v seznamu `infinite` a vrací se vždy.
 */
import { entityBox, type KindCtx } from "./kinds";
import type { Box } from "./geom";
import type { DraftEntity } from "./model";

const NODE = 16;

export class SpatialIndex {
  /** obálky uzlů po úrovních: [x0,y0,x1,y1] × počet */
  private levels: Float64Array[] = [];
  private order: Int32Array = new Int32Array(0);
  readonly items: DraftEntity[];
  readonly infinite: DraftEntity[] = [];
  private boxes: Float64Array;
  readonly bounds: Box | null;

  constructor(entities: readonly DraftEntity[], ctx: KindCtx) {
    const fin: DraftEntity[] = [];
    const bx: number[] = [];
    let X0 = Infinity;
    let Y0 = Infinity;
    let X1 = -Infinity;
    let Y1 = -Infinity;
    for (const e of entities) {
      const b = entityBox(e, ctx);
      if (!b) {
        this.infinite.push(e);
        continue;
      }
      fin.push(e);
      bx.push(b.x0, b.y0, b.x1, b.y1);
      if (b.x0 < X0) X0 = b.x0;
      if (b.y0 < Y0) Y0 = b.y0;
      if (b.x1 > X1) X1 = b.x1;
      if (b.y1 > Y1) Y1 = b.y1;
    }
    this.items = fin;
    this.boxes = new Float64Array(bx);
    this.bounds = fin.length ? { x0: X0, y0: Y0, x1: X1, y1: Y1 } : null;
    const n = fin.length;
    if (!n) return;
    // Hilbertovo pořadí středů
    const W = X1 - X0 || 1;
    const H = Y1 - Y0 || 1;
    const keys = new Float64Array(n);
    const idx = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const cx = ((this.boxes[i * 4] + this.boxes[i * 4 + 2]) / 2 - X0) / W;
      const cy = ((this.boxes[i * 4 + 1] + this.boxes[i * 4 + 3]) / 2 - Y0) / H;
      keys[i] = hilbert(Math.floor(cx * 65535), Math.floor(cy * 65535));
      idx[i] = i;
    }
    idx.sort((a, b) => keys[a] - keys[b]);
    this.order = idx;
    // listy: obálky entit v pořadí
    let lvl = new Float64Array(n * 4);
    for (let i = 0; i < n; i++) lvl.set(this.boxes.subarray(idx[i] * 4, idx[i] * 4 + 4), i * 4);
    this.levels.push(lvl);
    while (lvl.length / 4 > 1) {
      const cnt = lvl.length / 4;
      const up = new Float64Array(Math.ceil(cnt / NODE) * 4);
      for (let p = 0; p * NODE < cnt; p++) {
        let a = Infinity;
        let b = Infinity;
        let c = -Infinity;
        let d = -Infinity;
        for (let k = p * NODE; k < Math.min(cnt, (p + 1) * NODE); k++) {
          if (lvl[k * 4] < a) a = lvl[k * 4];
          if (lvl[k * 4 + 1] < b) b = lvl[k * 4 + 1];
          if (lvl[k * 4 + 2] > c) c = lvl[k * 4 + 2];
          if (lvl[k * 4 + 3] > d) d = lvl[k * 4 + 3];
        }
        up[p * 4] = a;
        up[p * 4 + 1] = b;
        up[p * 4 + 2] = c;
        up[p * 4 + 3] = d;
      }
      this.levels.push(up);
      lvl = up;
    }
  }

  /** entity, jejichž obálka zasahuje do okna (+ nekonečné) */
  query(b: Box, out: DraftEntity[] = [], withInfinite = true): DraftEntity[] {
    if (this.levels.length) this.walk(this.levels.length - 1, 0, b, out);
    if (withInfinite) for (const e of this.infinite) out.push(e);
    return out;
  }
  private walk(level: number, node: number, b: Box, out: DraftEntity[]) {
    const L = this.levels[level];
    if (level === 0) {
      if (L[node * 4] <= b.x1 && L[node * 4 + 2] >= b.x0 && L[node * 4 + 1] <= b.y1 && L[node * 4 + 3] >= b.y0) out.push(this.items[this.order[node]]);
      return;
    }
    if (!(L[node * 4] <= b.x1 && L[node * 4 + 2] >= b.x0 && L[node * 4 + 1] <= b.y1 && L[node * 4 + 3] >= b.y0)) return;
    const child = this.levels[level - 1];
    const cnt = child.length / 4;
    for (let k = node * NODE; k < Math.min(cnt, (node + 1) * NODE); k++) this.walk(level - 1, k, b, out);
  }
  get size() {
    return this.items.length + this.infinite.length;
  }
}

/** Hilbertova vzdálenost bodu v mřížce 65536² */
function hilbert(x: number, y: number): number {
  let d = 0;
  for (let s = 1 << 15; s > 0; s >>= 1) {
    const rx = (x & s) > 0 ? 1 : 0;
    const ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x;
        y = s - 1 - y;
      }
      const t = x;
      x = y;
      y = t;
    }
  }
  return d;
}

/** index podle identity seznamu entit (mezipaměť) */
const cache = new WeakMap<readonly DraftEntity[], SpatialIndex>();
export function spatialIndex(list: readonly DraftEntity[], ctx: KindCtx): SpatialIndex {
  let s = cache.get(list);
  if (!s) {
    s = new SpatialIndex(list, ctx);
    cache.set(list, s);
  }
  return s;
}
