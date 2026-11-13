/**
 * Síť velkých modelů: jemnost podle velikosti a složitosti, rychlý obalový kvádr a objem / plocha ze sítě.
 *
 * Měření na sestavě STEP 46 MB (6 820 ploch, převážně B-spline) v jádře: přesný obalový kvádr (`BRepBndLib.AddOptimal`)
 * 104 s, síť s tolerancí úhlopříčka/2000 38,8 s a 1,66 mil. trojúhelníků, přesný objem 8,5 s, plocha 11,4 s, kontrola
 * platnosti 7,7 s. Pro zobrazení stačí kvádr z řídicích bodů / sítě a objem ze sítě (chyba v řádu tolerance sítě);
 * malé modely (do `BIG_FACES` ploch) se počítají přesně jako dřív.
 */
import * as r from "replicad";
import { MESH_ANGULAR, meshTolerance } from "./fastbool";
import type { Vec3 } from "./types";

/** od kolika ploch je těleso „velké“ (rychlý kvádr, objem a plocha ze sítě, bez kontroly platnosti) */
export const BIG_FACES = 1000;
/** cílový strop počtu trojúhelníků jednoho tělesa (orientačně – jemnost se volí předem podle počtu ploch) */
export const TRIANGLE_BUDGET = 1_500_000;
/** lehké komponenty sestav (díly velké sestavy STEP): tolerance = úhlopříčka / LIGHT_DIVISOR */
export const LIGHT_DIVISOR = 800;
export const LIGHT_ANGULAR = 0.3;

/**
 * Jemnost sítě: běžné modely úhlopříčka/2000 a 0,2 rad (beze změny). Velká tělesa: tolerance roste s odmocninou počtu ploch
 * nad `BIG_FACES` (nejvýš 4×) a úhlová odchylka 0,3 rad – počet trojúhelníků pak roste zhruba lineárně s počtem ploch,
 * ne s jejich zakřivením. Lehké komponenty: úhlopříčka/800, 0,3 rad.
 */
export function meshParams(diag: number, faces: number, light = false): { tolerance: number; angular: number } {
  const base = meshTolerance(diag);
  if (light) return { tolerance: Math.max(base, (diag || 100) / LIGHT_DIVISOR), angular: LIGHT_ANGULAR };
  if (faces <= BIG_FACES) return { tolerance: base, angular: MESH_ANGULAR };
  const k = Math.min(4, Math.sqrt(faces / BIG_FACES));
  return { tolerance: base * k, angular: 0.3 };
}

/** Objem (uzavřené plochy), obsah a obalový kvádr ze sítě trojúhelníků. */
export function meshMetrics(vertices: Float32Array, triangles: Uint32Array): { volume: number; area: number; bbox: [Vec3, Vec3] } {
  let vol = 0;
  let area = 0;
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const a = triangles[i] * 3;
    const b = triangles[i + 1] * 3;
    const c = triangles[i + 2] * 3;
    const ax = vertices[a], ay = vertices[a + 1], az = vertices[a + 2];
    const bx = vertices[b] - ax, by = vertices[b + 1] - ay, bz = vertices[b + 2] - az;
    const cx = vertices[c] - ax, cy = vertices[c + 1] - ay, cz = vertices[c + 2] - az;
    const nx = by * cz - bz * cy;
    const ny = bz * cx - bx * cz;
    const nz = bx * cy - by * cx;
    area += Math.hypot(nx, ny, nz) / 2;
    // objem čtyřstěnu (počátek, a, b, c) = a · (b × c) / 6 v absolutních souřadnicích
    const bxa = vertices[b], bya = vertices[b + 1], bza = vertices[b + 2];
    const cxa = vertices[c], cya = vertices[c + 1], cza = vertices[c + 2];
    vol += (ax * (bya * cza - bza * cya) - ay * (bxa * cza - bza * cxa) + az * (bxa * cya - bya * cxa)) / 6;
  }
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < vertices.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const v = vertices[i + k];
      if (v < lo[k]) lo[k] = v;
      if (v > hi[k]) hi[k] = v;
    }
  if (!Number.isFinite(lo[0])) return { volume: 0, area: 0, bbox: [[0, 0, 0], [0, 0, 0]] };
  return { volume: Math.abs(vol), area, bbox: [lo, hi] };
}

/**
 * Rychlá úhlopříčka obalového kvádru (BRepBndLib.Add – z řídicích bodů ploch / existující sítě, bez optimalizace).
 * Kvádr je o něco větší než přesný, pro volbu jemnosti sítě to nevadí. 46 MB sestava: 0,2 s místo 104 s.
 */
export function quickDiag(shape: { wrapped: unknown }): number {
  const oc = r.getOC() as unknown as { Bnd_Box: new () => { IsVoid(): boolean; CornerMin(): P; CornerMax(): P; delete(): void }; BRepBndLib: { Add(s: unknown, b: unknown, useTri: boolean): void } };
  type P = { X(): number; Y(): number; Z(): number; delete(): void };
  const box = new oc.Bnd_Box();
  try {
    oc.BRepBndLib.Add(shape.wrapped, box, true);
    if (box.IsVoid()) return 100;
    const a = box.CornerMin();
    const b = box.CornerMax();
    const d = Math.hypot(b.X() - a.X(), b.Y() - a.Y(), b.Z() - a.Z());
    a.delete();
    b.delete();
    return d || 100;
  } finally {
    box.delete();
  }
}
