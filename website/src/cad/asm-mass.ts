/**
 * Hmotnostní vlastnosti sestavy (Nástroje › Hmotnost v sestavě): součet přes listové díly (i uvnitř podsestav) s jejich
 * materiály a umístěním – hmotnost, objem, povrch dílů, těžiště a obálka ve světových souřadnicích sestavy.
 *
 * Údaje o dílu (`PartMass`) jsou v jeho vlastních souřadnicích – změří je jádro (OCCT, `measureBody`: přesný objem
 * a těžiště) jednou pro každý zdroj; stejný díl vložený vícekrát se neměří znovu, jen se přenese maticí umístění.
 * Čistá funkce bez jádra (testy v asm-mass.test.ts).
 */
import type { Vec3 } from "./types";

/** Změřený díl ve vlastních souřadnicích (mm, mm³, mm²). `com` = těžiště (chybí-li, díl se do těžiště nezapočte). */
export type PartMass = { volume: number; area: number; com?: Vec3; bbox: [Vec3, Vec3] };

/** Listový díl sestavy: zdroj (`key`), světová matice (4×4 po sloupcích), hustota g/cm³, popisky. */
export type MassLeaf = { id: string; name: string; key: string; matrix: number[]; density: number; material: string };

export type MassRow = { id: string; name: string; material: string; density: number; volume: number; massKg: number; com: Vec3 | null };

export type AsmMass = {
  /** kg */
  massKg: number;
  /** mm³ */
  volume: number;
  /** součet povrchů dílů, mm² (ne vnější povrch sestavy) */
  area: number;
  /** těžiště sestavy (hmotnostně vážené) – null, když žádný díl nemá těžiště */
  cog: Vec3 | null;
  /** obálka ve světových souřadnicích (z obálek dílů) */
  bbox: [Vec3, Vec3] | null;
  /** započtené díly, seřazené od nejtěžšího */
  rows: MassRow[];
  /** díly, které se nepodařilo změřit (názvy) – v součtech nejsou */
  missing: string[];
};

/** bod přenesený maticí 4×4 (po sloupcích, jako placementMatrix) */
export function applyMatrix(m: number[], p: Vec3): Vec3 {
  return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
}

/** kg z objemu v mm³ a hustoty v g/cm³ */
export const massOf = (volumeMm3: number, density: number) => (volumeMm3 / 1e6) * density;

export function asmMassProps(leaves: MassLeaf[], parts: Map<string, PartMass | null | undefined>): AsmMass {
  const rows: MassRow[] = [];
  const missing: string[] = [];
  let mass = 0;
  let volume = 0;
  let area = 0;
  const mom: Vec3 = [0, 0, 0];
  let momMass = 0;
  let bbox: [Vec3, Vec3] | null = null;
  for (const l of leaves) {
    const p = parts.get(l.key);
    if (!p || !(p.volume >= 0)) {
      missing.push(l.name);
      continue;
    }
    const m = massOf(p.volume, l.density);
    const com = p.com ? applyMatrix(l.matrix, p.com) : null;
    rows.push({ id: l.id, name: l.name, material: l.material, density: l.density, volume: p.volume, massKg: m, com });
    mass += m;
    volume += p.volume;
    area += p.area;
    if (com) {
      for (let k = 0; k < 3; k++) mom[k] += m * com[k];
      momMass += m;
    }
    const [a, b] = p.bbox;
    for (const x of [a[0], b[0]]) for (const y of [a[1], b[1]]) for (const z of [a[2], b[2]]) {
      const w = applyMatrix(l.matrix, [x, y, z]);
      if (!bbox) bbox = [[...w] as Vec3, [...w] as Vec3];
      else for (let k = 0; k < 3; k++) {
        bbox[0][k] = Math.min(bbox[0][k], w[k]);
        bbox[1][k] = Math.max(bbox[1][k], w[k]);
      }
    }
  }
  rows.sort((x, y) => y.massKg - x.massKg);
  const cog = momMass > 0 ? (mom.map((v) => v / momMass) as Vec3) : null;
  return { massKg: mass, volume, area, cog, bbox, rows, missing };
}
