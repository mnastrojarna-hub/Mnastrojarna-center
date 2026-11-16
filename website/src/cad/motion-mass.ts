/**
 * Hmotnostní vlastnosti dílů pro dynamickou pohybovou studii (cad/motion-dynamic.ts): objem, těžiště a tenzor setrvačnosti z uzavřené
 * trojúhelníkové sítě tělesa (síť ze stavby v jádře, souřadnice dílu) a jejich přenos do souřadnic komponenty / tuhé skupiny.
 *
 * Síť: součet čtyřstěnů (počátek, a, b, c) se znaménkovým objemem v = a·(b×c)/6; těžiště Σ v·(a+b+c)/4; kovariance
 * ∫x·xᵀ dV čtyřstěnu = v/20·(a·aᵀ + b·bᵀ + c·cᵀ + s·sᵀ), s = a+b+c (Tonon 2004, kanonický čtyřstěn). Tenzor k těžišti
 * I = tr(C)·E − C, C = ∫(x−t)(x−t)ᵀ dV. Hmotnost se bere z PŘESNÉHO objemu jádra × hustota (síť dodá jen rozložení – těžiště a tvar
 * tenzoru). Jednotky: mm, kg, kg·mm². Čisté funkce bez jádra.
 */
import type { Vec3 } from "./types";

/** 3×3 po řádcích */
export type M3 = [number, number, number, number, number, number, number, number, number];
/** Hmotnostní vlastnosti v souřadnicích dílu / komponenty: hmotnost [kg], těžiště [mm], tenzor setrvačnosti k těžišti [kg·mm²]. */
export type MassProps = { mass: number; com: Vec3; I: M3 };
/** odkud je hmotnost: z objemu × hustoty, zadaná ručně, náhradní (díl nešel změřit) */
export type MassSource = "volume" | "manual" | "default";
export type CompInertia = MassProps & { source: MassSource };

const ZERO3: M3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];

/** Objem, těžiště a tenzor setrvačnosti (na jednotkovou hustotu: kg = mm³) z uzavřené sítě. null = síť bez objemu. */
export function meshMassProps(vertices: ArrayLike<number>, triangles: ArrayLike<number>): { volume: number; com: Vec3; I: M3 } | null {
  let V = 0;
  const m1: Vec3 = [0, 0, 0];
  const C = [0, 0, 0, 0, 0, 0]; // xx yy zz xy xz yz
  const P = (i: number): Vec3 => [vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2]];
  for (let t = 0; t + 2 < triangles.length; t += 3) {
    const a = P(triangles[t]);
    const b = P(triangles[t + 1]);
    const c = P(triangles[t + 2]);
    const v = (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    if (!v) continue;
    V += v;
    const s: Vec3 = [a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]];
    for (let k = 0; k < 3; k++) m1[k] += (v * s[k]) / 4;
    const k20 = v / 20;
    const sq = (i: number, j: number) => a[i] * a[j] + b[i] * b[j] + c[i] * c[j] + s[i] * s[j];
    C[0] += k20 * sq(0, 0);
    C[1] += k20 * sq(1, 1);
    C[2] += k20 * sq(2, 2);
    C[3] += k20 * sq(0, 1);
    C[4] += k20 * sq(0, 2);
    C[5] += k20 * sq(1, 2);
  }
  // síť s obrácenými normálami (opačná orientace všech trojúhelníků) – stejné rozložení se záporným znaménkem
  if (V < 0) {
    V = -V;
    for (let k = 0; k < 3; k++) m1[k] = -m1[k];
    for (let k = 0; k < 6; k++) C[k] = -C[k];
  }
  if (!(V > 1e-12)) return null;
  const com: Vec3 = [m1[0] / V, m1[1] / V, m1[2] / V];
  // kovariance k těžišti: C − V·t·tᵀ
  const cxx = C[0] - V * com[0] * com[0];
  const cyy = C[1] - V * com[1] * com[1];
  const czz = C[2] - V * com[2] * com[2];
  const cxy = C[3] - V * com[0] * com[1];
  const cxz = C[4] - V * com[0] * com[2];
  const cyz = C[5] - V * com[1] * com[2];
  const tr = cxx + cyy + czz;
  return { volume: V, com, I: [tr - cxx, -cxy, -cxz, -cxy, tr - cyy, -cyz, -cxz, -cyz, tr - czz] };
}

/** Kvádr (obálka) jako náhrada, když díl nemá síť: hmotnost `mass`, střed a tenzor kvádru. */
export function boxMassProps(mass: number, bbox: [Vec3, Vec3]): MassProps {
  const [lo, hi] = bbox;
  const d = [0, 1, 2].map((k) => Math.max(0, hi[k] - lo[k]));
  const com: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const k = mass / 12;
  return { mass, com, I: [k * (d[1] ** 2 + d[2] ** 2), 0, 0, 0, k * (d[0] ** 2 + d[2] ** 2), 0, 0, 0, k * (d[0] ** 2 + d[1] ** 2)] };
}

/** Hmotnostní vlastnosti dílu: přesný objem jádra × hustota [g/cm³], rozložení ze sítě (jinak obálka). */
export function partMassProps(o: { volume: number; density: number; bbox?: [Vec3, Vec3]; vertices?: ArrayLike<number>; triangles?: ArrayLike<number> }): MassProps | null {
  const mass = (Math.max(0, o.volume) / 1e6) * o.density;
  if (!(mass > 0)) return null;
  const mp = o.vertices && o.triangles ? meshMassProps(o.vertices, o.triangles) : null;
  if (mp) {
    const k = mass / mp.volume;
    return { mass, com: mp.com, I: mp.I.map((v) => v * k) as M3 };
  }
  return o.bbox ? boxMassProps(mass, o.bbox) : { mass, com: [0, 0, 0], I: ZERO3 };
}

const mul = (A: M3, B: M3): M3 => {
  const r = [...ZERO3] as M3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  return r;
};
const tr3 = (A: M3): M3 => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];

/** Hmotnostní vlastnosti přenesené tuhou transformací x' = R·x + p (R po řádcích). */
export function transformMass(mp: MassProps, R: ArrayLike<number>, p: Vec3): MassProps {
  const Rm = Array.from(R).slice(0, 9) as M3;
  const c = mp.com;
  const com: Vec3 = [0, 1, 2].map((i) => Rm[i * 3] * c[0] + Rm[i * 3 + 1] * c[1] + Rm[i * 3 + 2] * c[2] + p[i]) as Vec3;
  return { mass: mp.mass, com, I: mul(mul(Rm, mp.I), tr3(Rm)) };
}

/** Součet hmotnostních vlastností (ve stejných souřadnicích): Steinerova věta k společnému těžišti. */
export function sumMass(list: MassProps[]): MassProps | null {
  const m = list.reduce((s, x) => s + x.mass, 0);
  if (!(m > 0)) return null;
  const com: Vec3 = [0, 1, 2].map((k) => list.reduce((s, x) => s + x.mass * x.com[k], 0) / m) as Vec3;
  const I = [...ZERO3] as M3;
  for (const x of list) {
    const d = [x.com[0] - com[0], x.com[1] - com[1], x.com[2] - com[2]];
    const d2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) I[i * 3 + j] += x.I[i * 3 + j] + x.mass * ((i === j ? d2 : 0) - d[i] * d[j]);
  }
  return { mass: m, com, I };
}

/** Ručně zadaná hmotnost: rozložení (těžiště, tvar tenzoru) zůstává, hmotnost a tenzor se přeškálují. */
export function withMass(mp: MassProps | null, mass: number): MassProps {
  if (!mp || !(mp.mass > 0)) return { mass, com: mp?.com ?? [0, 0, 0], I: [...ZERO3] as M3 };
  const k = mass / mp.mass;
  return { mass, com: mp.com, I: mp.I.map((v) => v * k) as M3 };
}
