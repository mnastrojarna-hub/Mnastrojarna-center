/**
 * Pružinové materiály (čisté funkce): modul ve smyku G, modul pružnosti E, hustota a minimální pevnost v tahu Rm podle průměru
 * drátu d. Hodnoty G / E / ρ podle EN 13906-1 tab. 2 (patentovaný drát EN 10270-1, olejem kalený EN 10270-2, nerez EN 10270-3).
 * Rm(d) = DOLNÍ mez pásma pevnosti z tabulek norem drátů, mezi body tabulky log-log interpolace (mimo rozsah krajní hodnota
 * prodloužená stejným sklonem) – orientační hodnota pro výpočet dovoleného napětí, ne náhrada atestu drátu.
 */
import { tr } from "../i18n";

export type SpringMaterialId = "SH" | "DH" | "VDSiCr" | "1.4310" | "51CrV4";
export type SpringMaterial = {
  id: SpringMaterialId;
  /** krátký popis (česky; v rozhraní `materialLabel`) */
  label: string;
  standard: string;
  /** modul ve smyku [N/mm²] */
  G: number;
  /** modul pružnosti [N/mm²] */
  E: number;
  /** hustota [kg/dm³ = g/cm³] */
  rho: number;
  /** body [d mm, Rm min N/mm²] */
  rm: [number, number][];
  /** jen pro talířové pružiny (pás / plech) */
  disc?: boolean;
};

// EN 10270-1 (patentovaný tažený drát) – třídy SH a DH mají stejné pásmo pevnosti, DH je navíc pro dynamické zatížení
const RM_SH: [number, number][] = [
  [0.3, 2660], [0.5, 2480], [0.8, 2310], [1, 2230], [1.5, 2080], [2, 1980], [2.5, 1900], [3, 1840], [4, 1710], [5, 1630],
  [6, 1570], [8, 1460], [10, 1390], [12, 1330], [15, 1270], [20, 1180],
];
// EN 10270-2 (olejem kalený a popuštěný drát) VDSiCr
const RM_VDSICR: [number, number][] = [[0.5, 2080], [1, 2080], [2, 2030], [3, 1980], [4, 1910], [5, 1860], [6, 1810], [8, 1760], [10, 1720], [12, 1670]];
// EN 10270-3 (korozivzdorný drát) 1.4310 (X10CrNi18-8), provedení NS
const RM_14310: [number, number][] = [[0.3, 2200], [0.5, 2150], [1, 1930], [1.5, 1800], [2, 1720], [3, 1570], [4, 1480], [5, 1420], [6, 1360], [8, 1280], [10, 1200], [12, 1150]];

export const SPRING_MATERIALS: Record<SpringMaterialId, SpringMaterial> = {
  SH: { id: "SH", label: "patentovaný drát SH (EN 10270-1)", standard: "EN 10270-1", G: 81500, E: 206000, rho: 7.85, rm: RM_SH },
  DH: { id: "DH", label: "patentovaný drát DH (EN 10270-1)", standard: "EN 10270-1", G: 81500, E: 206000, rho: 7.85, rm: RM_SH },
  VDSiCr: { id: "VDSiCr", label: "olejem kalený VDSiCr (EN 10270-2)", standard: "EN 10270-2", G: 79500, E: 206000, rho: 7.85, rm: RM_VDSICR },
  "1.4310": { id: "1.4310", label: "nerez 1.4310 (EN 10270-3)", standard: "EN 10270-3", G: 70000, E: 185000, rho: 7.9, rm: RM_14310 },
  // talířové pružiny DIN 2093: ocel 51CrV4 (EN 10089 / EN 10132-4), μ = 0,3; Rm jen orientačně (kalená 42–52 HRC)
  "51CrV4": { id: "51CrV4", label: "pružinová ocel 51CrV4 (EN 10132-4)", standard: "EN 10132-4", G: 78500, E: 206000, rho: 7.85, rm: [[1, 1600], [10, 1600]], disc: true },
};

export const MATERIAL_IDS = Object.keys(SPRING_MATERIALS) as SpringMaterialId[];
/** materiály pro drátové pružiny (bez 51CrV4) */
export const WIRE_MATERIALS: SpringMaterialId[] = ["SH", "DH", "VDSiCr", "1.4310"];

/** Materiál podle id (tolerantně: „sh“, „dh“, „vdsicr“, „1.4310“, „nerez“, „14310“) – jinak SH. */
export function springMaterial(id: unknown): SpringMaterial {
  const s = String(id ?? "").trim().toLowerCase().replace(/[\s_-]/g, "");
  const hit = MATERIAL_IDS.find((k) => k.toLowerCase().replace(/[.\s_-]/g, "") === s.replace(/\./g, ""));
  if (hit) return SPRING_MATERIALS[hit];
  if (/^(nerez|stainless|edelstahl|inox|x10crni)/.test(s)) return SPRING_MATERIALS["1.4310"];
  if (/^(oil|olej|ol|siCr|otd)/i.test(s)) return SPRING_MATERIALS.VDSiCr;
  return SPRING_MATERIALS.SH;
}
/** id materiálu z textu (null = neznámý) */
export function materialIdOf(word: string): SpringMaterialId | null {
  const s = word.trim().toLowerCase().replace(/[\s_-]/g, "").replace(/\./g, "");
  const hit = MATERIAL_IDS.find((k) => k.toLowerCase().replace(/[.\s_-]/g, "") === s);
  if (hit) return hit;
  if (/^(nerez|stainless|edelstahl|inox|x10crni188?)$/.test(s)) return "1.4310";
  return null;
}

/** Rm min [N/mm²] pro drát průměru d (log-log interpolace v tabulce materiálu). */
export function rmOf(m: SpringMaterial, d: number): number {
  const t = m.rm;
  if (!(d > 0)) return t[0][1];
  if (t.length === 1) return t[0][1];
  let i = 0;
  while (i < t.length - 2 && d > t[i + 1][0]) i++;
  const [d0, r0] = t[i];
  const [d1, r1] = t[i + 1];
  if (r0 === r1) return r0;
  const k = Math.log(r1 / r0) / Math.log(d1 / d0);
  return r0 * Math.pow(d / d0, k);
}

/** popisek materiálu v jazyce rozhraní (doslovné klíče kvůli překladům) */
export function materialLabel(m: SpringMaterial | SpringMaterialId): string {
  const id = typeof m === "string" ? m : m.id;
  switch (id) {
    case "SH": return tr("patentovaný drát SH (EN 10270-1)");
    case "DH": return tr("patentovaný drát DH (EN 10270-1)");
    case "VDSiCr": return tr("olejem kalený VDSiCr (EN 10270-2)");
    case "1.4310": return tr("nerez 1.4310 (EN 10270-3)");
    default: return tr("pružinová ocel 51CrV4 (EN 10132-4)");
  }
}
