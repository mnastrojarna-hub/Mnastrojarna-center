/** Pomocné funkce pro generátory normálií. */
import { emptyDoc, uid, type Axis, type CadDoc, type Feature, type SketchEntity, type SketchPlane, type Vec2, type Vec3 } from "../types";

export const num = (v: unknown, d = 0): number => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : d;
};
export const str = (v: unknown, d = ""): string => (v == null ? d : String(v));
export const bool = (v: unknown): boolean => v === true || v === "true" || v === 1;

export const fmt = (n: number) => (Math.round(n * 100) / 100).toString().replace(".", ",");

export function part(name: string, material: string, features: Feature[], number?: string, color?: string): CadDoc {
  return { ...emptyDoc(name), material, features, kind: "part", props: number ? { number } : undefined, color };
}

export const sketch = (name: string, plane: SketchPlane, entities: SketchEntity[], id = uid()): Extract<Feature, { type: "sketch" }> => ({ id, name, type: "sketch", plane, entities });

export const XY = (offset = 0): SketchPlane => ({ kind: "base", name: "XY", offset });
export const XZ = (offset = 0): SketchPlane => ({ kind: "base", name: "XZ", offset });

export type Mode = "new" | "add" | "cut" | "intersect";

export const cyl = (name: string, d: number, h: number, z: number, mode: Mode = "add", axis: Axis = "Z", xy: Vec2 = [0, 0]): Feature => ({
  id: uid(),
  name,
  type: "cylinder",
  radius: d / 2,
  height: h,
  position: axis === "Z" ? [xy[0], xy[1], z] : axis === "X" ? [z, xy[0], xy[1]] : [xy[0], z, xy[1]],
  axis,
  mode,
});

export const tube = (name: string, outer: number, inner: number, h: number, z: number, mode: "new" | "add" | "cut" = "add"): Feature => ({ id: uid(), name, type: "tube", outer, inner, height: h, position: [0, 0, z], axis: "Z", mode });

export const box = (name: string, size: Vec3, position: Vec3, mode: "new" | "add" | "cut" = "add", centered = true): Feature => ({ id: uid(), name, type: "box", size, position, centered, mode });

export const chamferAll = (d: number): Feature => ({ id: uid(), name: "Sražení", type: "chamfer", distance: d, edges: "all" });

/** Šestihran v rovině XY (s = otvor klíče) vysunutý od z o výšku k (nahoru). */
export function hexPrism(name: string, s: number, k: number, z: number, mode: "new" | "add" | "cut" = "add"): Feature[] {
  const sk = sketch(`${name} – profil`, XY(z), [{ id: uid(), type: "polygon", cx: 0, cy: 0, r: s / Math.sqrt(3), sides: 6, angle: 0 }]);
  return [sk, { id: uid(), name, type: "extrude", sketchId: sk.id, distance: k, symmetric: false, reverse: false, mode }];
}

/** Rotační těleso kolem osy Z z profilu (r, z) – polovina řezu. */
export function revolveProfile(name: string, profile: Vec2[], mode: "new" | "add" | "cut" = "new"): Feature[] {
  // skica v rovině XZ: x = poloměr, y = z (osa rotace = osa Y skici = globální Z)
  const sk = sketch(`${name} – profil`, XZ(0), [{ id: uid(), type: "polyline", closed: true, points: profile }]);
  return [sk, { id: uid(), name, type: "revolve", sketchId: sk.id, angle: 360, axis: "y", mode }];
}

/** Uzavřená lomená čára v XY vysunutá podél Z. */
export function extrudePoly(name: string, points: Vec2[], height: number, mode: "new" | "add" | "cut" = "new", z = 0, symmetric = false): Feature[] {
  const sk = sketch(`${name} – profil`, XY(z), [{ id: uid(), type: "polyline", closed: true, points }]);
  return [sk, { id: uid(), name, type: "extrude", sketchId: sk.id, distance: height, symmetric, reverse: false, mode }];
}

/** Drážka pro pero v díře (DIN 6885): šířka b, hloubka t2 nad poloměrem díry, podél Z. */
export function keywayCut(bore: number, b: number, t2: number, height: number, z = 0): Feature {
  return box("Drážka pro pero", [b, t2 + 1, height + 2], [0, bore / 2 + (t2 + 1) / 2 - 1, z + height / 2], "cut");
}

/** Body na kružnici. */
export function circlePts(r: number, n: number, a0 = 0, a1 = 360): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    out.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return out;
}

export const rnd = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

/** Nejbližší řádek tabulky podle číselného klíče. */
export function nearest<T extends Record<string, unknown>>(rows: T[], key: keyof T, value: number): T {
  let best = rows[0];
  for (const r of rows) if (Math.abs(Number(r[key]) - value) < Math.abs(Number(best[key]) - value)) best = r;
  return best;
}
