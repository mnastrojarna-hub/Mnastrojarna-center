import type {
  MaterialCostInput, MaterialCostResult, MaterialGroup, MaterialInfo,
} from "./types";

/**
 * Databáze materiálů: hustoty, ceny za kg, obrobitelnost, dostupnost.
 * Slouží jako výchozí katalog — ceny lze přepsat v DB (tabulka materials).
 */

const M = (
  key: string, label: string, group: MaterialGroup, densityKgDm3: number,
  pricePerKg: number, machinability: number, aliases: string[],
  opts?: { special?: boolean; availability?: MaterialInfo["availability"] },
): MaterialInfo => ({
  key, label, group, densityKgDm3, pricePerKg, machinability,
  aliases: [key.toLowerCase(), label.toLowerCase(), ...aliases.map((a) => a.toLowerCase())],
  special: opts?.special ?? false,
  availability: opts?.availability ?? "bezna",
});

export const MATERIALS: MaterialInfo[] = [
  // Konstrukční oceli
  M("11373", "Ocel 11 373 (S235JR)", "konstrukcni_ocel", 7.85, 32, 1.0, ["s235", "s235jr", "1.0038", "11 373"]),
  M("11523", "Ocel 11 523 (S355J2)", "konstrukcni_ocel", 7.85, 35, 1.05, ["s355", "s355j2", "1.0577", "11 523"]),
  M("12050", "Ocel 12 050 (C45)", "konstrukcni_ocel", 7.85, 38, 1.0, ["c45", "1.0503", "12 050", "12050.1"]),
  M("11109", "Automatová ocel 11 109 (11SMn30)", "automatova_ocel", 7.85, 40, 0.8, ["11smn30", "1.0715", "11 109"]),
  // Legované / zušlechťovací
  M("15142", "Ocel 15 142 (42CrMo4)", "legovana_ocel", 7.85, 48, 1.2, ["42crmo4", "1.7225", "15 142"]),
  M("14220", "Ocel 14 220 (16MnCr5)", "legovana_ocel", 7.85, 45, 1.15, ["16mncr5", "1.7131", "14 220"]),
  // Nástrojové oceli
  M("19312", "Nástrojová ocel 19 312 (90MnCrV8)", "nastrojova_ocel", 7.85, 95, 1.4, ["90mncrv8", "1.2842", "19 312"], { special: true }),
  M("19552", "Nástrojová ocel 19 552 (X37CrMoV5-1)", "nastrojova_ocel", 7.80, 145, 1.5, ["1.2343", "h11", "19 552"], { special: true }),
  M("19573", "Nástrojová ocel 19 573 (X153CrMoV12)", "nastrojova_ocel", 7.70, 160, 1.7, ["1.2379", "d2", "19 573"], { special: true }),
  M("19830", "Rychlořezná ocel 19 830 (HS6-5-2)", "nastrojova_ocel", 8.10, 380, 2.0, ["1.3343", "hss", "19 830"], { special: true, availability: "omezena" }),
  // Nerez
  M("17240", "Nerez 17 240 (1.4301 / AISI 304)", "nerez", 7.90, 95, 1.5, ["1.4301", "aisi 304", "304", "17 240", "x5crni18-10"]),
  M("17349", "Nerez 17 349 (1.4404 / AISI 316L)", "nerez", 8.00, 125, 1.6, ["1.4404", "aisi 316l", "316l", "316", "17 349"]),
  M("17029", "Nerez kalitelná 17 029 (1.4034)", "nerez", 7.70, 110, 1.5, ["1.4034", "17 029"], { special: true }),
  // Litina
  M("422425", "Litina šedá (GG25 / EN-GJL-250)", "litina", 7.20, 45, 0.9, ["gg25", "gjl-250", "en-gjl-250", "42 2425"]),
  // Hliník
  M("alu_6082", "Hliník EN AW-6082 (AlSi1MgMn)", "hlinik", 2.70, 120, 0.45, ["6082", "en aw-6082", "alsi1mgmn", "424400"]),
  M("alu_7075", "Hliník EN AW-7075 (AlZnMgCu)", "hlinik", 2.81, 190, 0.5, ["7075", "en aw-7075", "alznmgcu"], { special: true }),
  M("alu_2017", "Hliník EN AW-2017 (dural)", "hlinik", 2.79, 160, 0.5, ["2017", "en aw-2017", "dural"]),
  // Barevné kovy
  M("ms58", "Mosaz Ms58 (CuZn39Pb3)", "mosaz", 8.50, 220, 0.4, ["cuzn39pb3", "2.0401", "ms 58", "mosaz"]),
  M("cu_etp", "Měď Cu-ETP", "med", 8.94, 280, 0.6, ["cu-etp", "e-cu", "med", "měď"], { availability: "omezena" }),
  M("cusn8", "Bronz CuSn8", "bronz", 8.80, 350, 0.7, ["bronz", "cusn8", "2.1030"], { availability: "omezena" }),
  // Titan
  M("ti_gr5", "Titan Grade 5 (Ti6Al4V)", "titan", 4.43, 1400, 2.5, ["ti6al4v", "titan", "3.7165", "grade 5"], { special: true, availability: "specialni" }),
  // Plasty
  M("pom", "Plast POM-C", "plast", 1.41, 110, 0.3, ["pom-c", "delrin", "ertacetal"]),
  M("pa6", "Plast PA6", "plast", 1.14, 95, 0.3, ["silon", "polyamid", "pa 6"]),
  M("peek", "Plast PEEK", "plast", 1.31, 2200, 0.5, ["peek"], { special: true, availability: "specialni" }),
];

/** Fallback pro nerozpoznaný materiál — běžná konstrukční ocel. */
export const DEFAULT_MATERIAL = MATERIALS[2]; // 12050 / C45

const norm = (s: string) => s.toLowerCase().replace(/[\s_]+/g, " ").trim();

/** Najde materiál podle libovolného označení (ČSN / W.Nr. / EN / obchodní název). */
export function findMaterial(name?: string | null, catalog: MaterialInfo[] = MATERIALS): { material: MaterialInfo; matched: boolean } {
  const fallback = catalog.find((m) => m.key === DEFAULT_MATERIAL.key) ?? catalog[0] ?? DEFAULT_MATERIAL;
  if (!name || !name.trim()) return { material: fallback, matched: false };
  const n = norm(name);
  const compact = n.replace(/[\s.]/g, "");
  for (const m of catalog) {
    for (const a of m.aliases) {
      const ac = a.replace(/[\s.]/g, "");
      if (n === a || compact === ac) return { material: m, matched: true };
    }
  }
  // částečná shoda (alias obsažen v zadání) — od nejdelších aliasů
  const all = catalog.flatMap((m) => m.aliases.map((a) => ({ a, m })))
    .filter(({ a }) => a.length >= 3)
    .sort((x, y) => y.a.length - x.a.length);
  for (const { a, m } of all) {
    if (n.includes(a) || compact.includes(a.replace(/[\s.]/g, ""))) return { material: m, matched: true };
  }
  return { material: fallback, matched: false };
}

/**
 * Náklad na materiál: hmotnost × cena/kg + přirážky
 * (malé množství, speciální materiál, certifikace, dostupnost) + doprava.
 */
export function materialCost(input: MaterialCostInput): MaterialCostResult {
  const { material, blankWeightKg, quantity, params } = input;
  const totalKg = blankWeightKg * Math.max(1, quantity);
  const basePerPiece = blankWeightKg * material.pricePerKg;

  let surcharges = 0;
  const notes: string[] = [];
  if (totalKg < 25) {
    surcharges += params.smallQtySurchargePct;
    notes.push(`malé množství materiálu (${totalKg.toFixed(1)} kg) +${params.smallQtySurchargePct} %`);
  }
  if (material.special) {
    surcharges += params.specialMaterialSurchargePct;
    notes.push(`speciální materiál +${params.specialMaterialSurchargePct} %`);
  }
  if (input.certificateRequired) {
    surcharges += params.certificationSurchargePct;
    notes.push(`materiálový certifikát +${params.certificationSurchargePct} %`);
  }
  if (material.availability !== "bezna") {
    surcharges += params.scarceMaterialSurchargePct;
    notes.push(`${material.availability === "specialni" ? "speciálně objednávaný" : "hůře dostupný"} materiál +${params.scarceMaterialSurchargePct} %`);
  }

  const withSurcharge = basePerPiece * (1 + surcharges / 100);
  const transportPerOrder = params.materialTransport;
  const costPerPiece = withSurcharge + transportPerOrder / Math.max(1, quantity);
  return {
    pricePerKg: material.pricePerKg,
    basePerPiece: round2(basePerPiece),
    surchargesPercent: surcharges,
    surchargeNotes: notes,
    transportPerOrder,
    costPerPiece: round2(costPerPiece),
    costTotal: round2(costPerPiece * Math.max(1, quantity)),
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
