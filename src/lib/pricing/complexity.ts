import type { ComplexityInput, ComplexityResult } from "./types";

/**
 * Koeficient složitosti dílu (1,0–2,5) z počtu operací, upnutí, nástrojů,
 * přesných a geometrických tolerancí, závitů, kapes, otvorů, obrobitelnosti,
 * obtížnosti měření a rizika zmetkovitosti.
 */
export function complexityCoefficient(input: ComplexityInput): ComplexityResult {
  const notes: string[] = [];
  let c = 1.0;

  // Operace, upnutí, nástroje
  if (input.operationCount > 2) {
    const add = (input.operationCount - 2) * 0.05;
    c += add; notes.push(`${input.operationCount} operací (+${pct(add)})`);
  }
  if (input.setupCount > 1) {
    const add = (input.setupCount - 1) * 0.06;
    c += add; notes.push(`${input.setupCount} upnutí (+${pct(add)})`);
  }
  if (input.toolCountEstimate > 8) {
    const add = Math.min(0.2, (input.toolCountEstimate - 8) * 0.02);
    c += add; notes.push(`~${input.toolCountEstimate} nástrojů (+${pct(add)})`);
  }

  // Přesné tolerance (váženě dle těsnosti)
  const t = input.tolerances;
  const tolAdd = t.t005 * 0.08 + t.t01 * 0.04 + t.t04 * 0.015 + t.t1 * 0.004;
  if (tolAdd > 0) {
    c += Math.min(0.6, tolAdd);
    notes.push(`přesné rozměry ≤0,005: ${t.t005} · ≤0,01: ${t.t01} · ≤0,04: ${t.t04} · ≤0,1: ${t.t1} (+${pct(Math.min(0.6, tolAdd))})`);
  }
  if (input.geomToleranceCount > 0) {
    const add = Math.min(0.25, input.geomToleranceCount * 0.03);
    c += add; notes.push(`${input.geomToleranceCount}× geometrická tolerance (+${pct(add)})`);
  }

  // Prvky
  if (input.threadCount > 0) {
    const add = Math.min(0.15, input.threadCount * 0.012);
    c += add; notes.push(`${input.threadCount}× závit (+${pct(add)})`);
  }
  if (input.pocketCount > 0) {
    const add = Math.min(0.2, input.pocketCount * 0.02);
    c += add; notes.push(`${input.pocketCount}× kapsa (+${pct(add)})`);
  }
  if (input.holeCount > 6) {
    const add = Math.min(0.12, (input.holeCount - 6) * 0.005);
    c += add; notes.push(`${input.holeCount}× otvor (+${pct(add)})`);
  }

  // Obrobitelnost materiálu
  if (input.machinability > 1.2) {
    const add = Math.min(0.3, (input.machinability - 1) * 0.25);
    c += add; notes.push(`hůře obrobitelný materiál (+${pct(add)})`);
  }

  // Tepelka zvyšuje riziko (deformace, rozměry po kalení)
  if (input.hasHeatTreatment) { c += 0.08; notes.push("tepelné zpracování (+8 %)"); }
  if (input.hasTightSurfaceFinish) { c += 0.06; notes.push("jemná jakost povrchu (+6 %)"); }

  const coefficient = Math.min(2.5, Math.max(1.0, round2(c)));

  // Obtížnost měření a riziko zmetkovitosti odvozené z tolerancí
  const precisionScore = t.t005 * 3 + t.t01 * 1.5 + input.geomToleranceCount;
  const measurementDifficulty = precisionScore >= 8 ? "vysoka" : precisionScore >= 3 ? "stredni" : "nizka";
  const scrapRiskPercent = Math.min(15, round2(
    2
    + t.t005 * 1.2 + t.t01 * 0.5 + input.geomToleranceCount * 0.4
    + (input.hasHeatTreatment ? 2 : 0)
    + (input.machinability > 1.5 ? 1.5 : 0),
  ));

  return { coefficient, scrapRiskPercent, measurementDifficulty, notes };
}

/** Odhad počtu upnutí z operací a prvků. */
export function estimateSetups(operationCount: number, pocketCount: number, hasMillingAndTurning: boolean): number {
  let setups = Math.max(1, Math.min(4, Math.ceil(operationCount / 2)));
  if (pocketCount > 2) setups = Math.max(setups, 2);
  if (hasMillingAndTurning) setups = Math.max(setups, 2);
  return setups;
}

/** Odhad počtu nástrojů z prvků dílu. */
export function estimateTools(input: { holeCount: number; threadCount: number; pocketCount: number; operationCount: number }): number {
  return Math.min(30, 4 + input.operationCount * 2 + Math.ceil(input.holeCount / 3) + input.threadCount + input.pocketCount);
}

const pct = (x: number) => `${Math.round(x * 100)} %`;
const round2 = (n: number) => Math.round(n * 100) / 100;
