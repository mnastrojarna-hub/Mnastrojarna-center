import type { Vec3 } from "@/cad/types";

/** jednotkový vektor (null = nulový / neplatný); bez „−0“ v polích formuláře */
export function unitVec(v: Vec3): Vec3 | null {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (!(l > 1e-12) || !v.every(Number.isFinite)) return null;
  return v.map((c) => Math.round((c / l) * 1e9) / 1e9 || 0) as Vec3;
}
