/**
 * Vyřešená poloha a osa primitiv (válec, kužel, trubka, závit, pružina…) zadaných odkazem (`positionRef`, `dirDef`).
 * Stavba (feat/refs-more.ts) zapíše výsledek každého takového prvku; výkres (drawing-dims.ts, drawing-prim.ts) a kontrola kót
 * (dim-check.ts) z něj čtou, kde prvek skutečně je – odkaz samotný (F3, E5) bez tělesa vyřešit nejdou.
 * Prvek bez odkazu (čísla + osa X / Y / Z nebo vektor) se spočítá přímo. Čisté funkce bez jádra.
 */
import type { Direction, Ref } from "./refs";
import type { Axis, Vec3 } from "./types";

export type Placement = { position: Vec3; dir: Vec3 };
type Placed = { id: string; position: Vec3; axis?: Axis; positionRef?: Ref; dirDef?: Direction };

const AXV: Record<Axis, Vec3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
/** poslední stavba (v tomto vlákně) – podle id prvku; prvek se při každé stavbě zapíše znovu, při chybě se smaže */
const placed = new Map<string, Placement>();

/** Zápis ze stavby (vyřešený odkaz). */
export function recordPlacement(id: string, p: Placement | null): void {
  if (p) placed.set(id, { position: [...p.position] as Vec3, dir: unit(p.dir) });
  else placed.delete(id);
}

/** Poloha a jednotkový směr osy prvku; `null` = odkaz, který ještě žádná stavba nevyřešila. */
export function placementOf(f: Placed): Placement | null {
  const direct = !f.positionRef && (!f.dirDef || f.dirDef.kind === "axis" || f.dirDef.kind === "vector");
  if (direct) {
    const d = f.dirDef;
    const dir = d?.kind === "vector" ? unit(d.v) : d?.kind === "axis" ? AXV[d.axis] : AXV[f.axis ?? "Z"];
    return { position: f.position, dir };
  }
  return placed.get(f.id) ?? null;
}
