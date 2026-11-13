/**
 * Uchopení objektů 2D výkresu (OSNAP): koncový bod, polovina, střed, kvadrant, průsečík, kolmo, tečně, nejbližší,
 * uzel, bod vložení – a pomůcky pro ORTHO a polární trasování.
 */
import { cClosest, cIntersect, cPerpFrom, cTangentFrom } from "./curves";
import { add, angleOf, dist, mul, polar, sub, unit, type Box } from "./geom";
import { entityCurves, kindOf, type KindCtx, type SnapKind } from "./kinds";
import { layerVisible } from "./layers";
import type { DraftModel, Vec2 } from "./model";
import type { SpatialIndex } from "./spatial";

export const SNAP_KINDS: SnapKind[] = ["end", "mid", "cen", "qua", "int", "per", "tan", "nea", "nod", "ins"];
/** výchozí režimy (jako OSMODE 4133 + kvadrant) */
export const DEFAULT_SNAPS: SnapKind[] = ["end", "mid", "cen", "qua", "int", "per", "nod", "ins"];

export type SnapHit = { kind: SnapKind; p: Vec2; id?: string; id2?: string };

/** pořadí přednosti při stejné vzdálenosti */
const RANK: Record<SnapKind, number> = { end: 0, int: 1, cen: 2, mid: 3, qua: 4, nod: 5, ins: 6, per: 7, tan: 8, ext: 9, app: 10, nea: 11 };

/**
 * Najde bod uchopení nejbližší kurzoru v okruhu `aperture` (světové jednotky). `base` = předchozí bod příkazu
 * (pro kolmo a tečně). Nejbližší (NEA) se použije jen tehdy, když nic jiného v okruhu není.
 */
export function findSnap(model: DraftModel, idx: SpatialIndex, cursor: Vec2, aperture: number, modes: ReadonlySet<SnapKind>, base?: Vec2 | null): SnapHit | null {
  if (!modes.size) return null;
  const box: Box = { x0: cursor[0] - aperture, y0: cursor[1] - aperture, x1: cursor[0] + aperture, y1: cursor[1] + aperture };
  const ctx: KindCtx = { model };
  const cands = idx.query(box).filter((e) => layerVisible(model, e.layer));
  let best: SnapHit | null = null;
  let bd = Infinity;
  const consider = (h: SnapHit) => {
    const d = dist(h.p, cursor);
    if (d > aperture) return;
    if (!best || d < bd - 1e-12 || (Math.abs(d - bd) <= 1e-12 && RANK[h.kind] < RANK[best.kind])) {
      best = h;
      bd = d;
    }
  };
  for (const e of cands) {
    const k = kindOf(e);
    if (!k) continue;
    for (const s of k.snaps(e, ctx)) if (modes.has(s.kind)) consider({ kind: s.kind, p: s.p, id: e.id });
  }
  if (modes.has("int")) {
    // průsečíky mezi kandidáty (omezeno na 80 nejbližších kvůli rychlosti)
    const near = cands
      .map((e) => ({ e, cs: entityCurves(e, ctx) }))
      .filter((x) => x.cs.length)
      .map((x) => ({ ...x, d: Math.min(...x.cs.map((c) => cClosest(c, cursor).d)) }))
      .filter((x) => x.d <= aperture)
      .sort((a, b) => a.d - b.d)
      .slice(0, 80);
    for (let i = 0; i < near.length; i++)
      for (let j = i; j < near.length; j++) {
        const A = near[i].cs;
        const B = near[j].cs;
        for (let a = 0; a < A.length; a++)
          for (let b = i === j ? a + 1 : 0; b < B.length; b++) {
            // sousední úseky téže křivky se protínají ve společném vrcholu – to je koncový bod, ne průsečík
            if (i === j && Math.abs((A[a].seg ?? -9) - (B[b].seg ?? -9)) === 1) continue;
            for (const p of cIntersect(A[a], B[b])) consider({ kind: "int", p, id: near[i].e.id, id2: near[j].e.id });
          }
      }
  }
  if (base && (modes.has("per") || modes.has("tan"))) {
    for (const e of cands)
      for (const c of entityCurves(e, ctx)) {
        if (modes.has("per")) for (const p of cPerpFrom(c, base)) if (c.k !== "line" || isOnLine(c, p)) consider({ kind: "per", p, id: e.id });
        if (modes.has("tan")) for (const p of cTangentFrom(c, base)) consider({ kind: "tan", p, id: e.id });
      }
  }
  if (!best && modes.has("nea")) {
    for (const e of cands)
      for (const c of entityCurves(e, ctx)) {
        const r = cClosest(c, cursor);
        consider({ kind: "nea", p: r.p, id: e.id });
      }
  }
  return best;
}

/** pata kolmice na úsečce leží v jejím rozsahu (kolmo na prodloužení se ve GUI nenabízí – AutoCAD „odložená kolmice“ ano, zde jen v textu per()) */
function isOnLine(c: { a: Vec2; b: Vec2; inf?: 0 | 1 | 2 }, p: Vec2) {
  if (c.inf === 2) return true;
  const d = sub(c.b, c.a);
  const t = ((p[0] - c.a[0]) * d[0] + (p[1] - c.a[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1] || 1);
  return c.inf === 1 ? t >= -1e-9 : t >= -1e-9 && t <= 1 + 1e-9;
}

/** ORTHO: bod p zarovnaný vodorovně / svisle k základnímu bodu */
export function orthoPoint(base: Vec2, p: Vec2): Vec2 {
  const d = sub(p, base);
  return Math.abs(d[0]) >= Math.abs(d[1]) ? [p[0], base[1]] : [base[0], p[1]];
}

/** Polární trasování: je-li směr k bodu do `tolDeg` od násobku přírůstku, bod se přichytí na ten směr. */
export function polarPoint(base: Vec2, p: Vec2, incDeg: number, tolDeg = 3): { p: Vec2; angle: number } | null {
  const d = sub(p, base);
  const L = Math.hypot(d[0], d[1]);
  if (L < 1e-12 || incDeg <= 0) return null;
  const a = (angleOf(d) * 180) / Math.PI;
  const k = Math.round(a / incDeg) * incDeg;
  if (Math.abs(a - k) > tolDeg) return null;
  const r = (k * Math.PI) / 180;
  const u: Vec2 = [Math.cos(r), Math.sin(r)];
  const proj = d[0] * u[0] + d[1] * u[1];
  return { p: add(base, mul(u, proj)), angle: ((k % 360) + 360) % 360 };
}

/** Přímé zadání vzdálenosti: bod ve vzdálenosti `d` od základu ve směru `dir`. */
export const directDistance = (base: Vec2, dir: Vec2, d: number): Vec2 => polar(base, angleOf(unit(dir)), d);

