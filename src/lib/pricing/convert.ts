import type { PriceBreakdown } from "./types";
import { blankTypeLabel } from "./blank";

/**
 * Výstup nacenění v jednotném tvaru (sdíleném s AI odhadem).
 * Deterministická kalkulace se na něj převádí, takže systém naceňuje
 * plnohodnotně i bez AI klíče; AI výsledek má stejnou strukturu.
 */
export interface PriceOperationV2 {
  name: string;
  machine: string;
  machine_minutes: number;      // sériový čas / ks
  setup_minutes: number;        // na dávku
  programming_minutes: number;  // na dávku
  first_piece_minutes: number;  // na dávku
  inspection_minutes: number;   // / ks
  cost_per_piece: number;
  cooperation: boolean;
}

export interface PriceEstimateV2 {
  material: string;
  blank_type: string;
  blank_dimensions: string;
  blank_weight_kg: number;
  part_weight_kg: number;
  removed_weight_kg: number;
  material_utilization_percent: number;
  material_cost_per_piece: number;
  material_surcharge_note: string;
  operations: PriceOperationV2[];
  complexity_coefficient: number;
  scrap_risk_percent: number;
  time_per_piece_min: number;
  time_total_min: number;
  handling_minutes: number;
  transport_cost: number;
  surface_treatment_cost: number;
  heat_treatment_cost: number;
  cooperation_cost_per_piece: number;
  labor_rate_per_hour: number;
  production_cost_per_piece: number;
  margin_percent: number;
  strategy_level: number;
  unit_price: number;
  total_price: number;
  lead_time_days: number;
  lead_time_mode: "expres" | "rychly" | "standard" | "dlouhy";
  expedite_surcharge_percent: number;
  historical_used: boolean;
  historical_note: string;
  price_stability_note: string;
  confidence: number;
  reasoning: string;
  needs_clarification: string[];
}

export function breakdownToEstimate(b: PriceBreakdown): PriceEstimateV2 {
  const avgRate = b.operations.filter((o) => !o.cooperation);
  const rate = avgRate.length ? Math.round(avgRate.reduce((s, o) => s + o.ratePerHour, 0) / avgRate.length) : 0;
  return {
    material: b.material.label,
    blank_type: blankTypeLabel(b.blank.type),
    blank_dimensions: b.blank.dimensions,
    blank_weight_kg: b.blank.weightKg,
    part_weight_kg: b.blank.partWeightKg,
    removed_weight_kg: b.blank.wasteKg,
    material_utilization_percent: b.blank.utilizationPercent,
    material_cost_per_piece: b.materialCost.costPerPiece,
    material_surcharge_note: b.materialCost.surchargeNotes.join(", "),
    operations: b.operations.map((o) => ({
      name: o.cooperation ? o.name : `${o.name} — ${o.machine}`,
      machine: o.machine,
      machine_minutes: o.minutesPerPiece,
      setup_minutes: o.setupMinutes,
      programming_minutes: o.programmingMinutes,
      first_piece_minutes: o.firstPieceMinutes,
      inspection_minutes: o.inspectionMinutesPerPiece,
      cost_per_piece: o.costPerPiece,
      cooperation: o.cooperation,
    })),
    complexity_coefficient: b.complexity.coefficient,
    scrap_risk_percent: b.complexity.scrapRiskPercent,
    time_per_piece_min: b.timePerPieceMin,
    time_total_min: b.timeTotalMin,
    handling_minutes: Math.round(b.handlingMinutesPerPiece),
    transport_cost: b.transportPerPiece * b.quantity,
    surface_treatment_cost: b.surfaceTreatmentCost,
    heat_treatment_cost: b.heatTreatmentCost,
    cooperation_cost_per_piece: b.cooperationCostPerPiece,
    labor_rate_per_hour: rate,
    production_cost_per_piece: b.costPerPiece,
    margin_percent: b.marginPercent,
    strategy_level: b.strategy.level,
    unit_price: b.unitPrice,
    total_price: b.totalPrice,
    lead_time_days: b.leadTime.days,
    lead_time_mode: b.leadTime.mode,
    expedite_surcharge_percent: b.leadTime.surchargePercent,
    historical_used: Boolean(b.smoothing?.referencePrice),
    historical_note: b.smoothing?.note ?? "",
    price_stability_note: b.smoothing?.adjusted ? b.smoothing.note : "",
    confidence: b.confidence,
    reasoning: b.reasoning.join("\n"),
    needs_clarification: b.needsClarification,
  };
}

/** Kompaktní textový souhrn baseline kalkulace pro prompt AI. */
export function breakdownPromptSummary(b: PriceBreakdown): string {
  const ops = b.operations
    .map((o) => o.cooperation
      ? `  - ${o.name}: kooperace ${o.costPerPiece} Kč/ks`
      : `  - ${o.name} (${o.machine}, ${o.ratePerHour} Kč/h): ${o.minutesPerPiece} min/ks, seřízení ${o.setupMinutes} min, programování ${o.programmingMinutes} min, 1. kus ${o.firstPieceMinutes} min, kontrola ${o.inspectionMinutesPerPiece} min/ks → ${o.costPerPiece} Kč/ks`)
    .join("\n");
  return [
    `BASELINE (deterministická kalkulace — vyjdi z ní, uprav jen s odůvodněním):`,
    `Materiál: ${b.material.label}, ${b.material.pricePerKg} Kč/kg, obrobitelnost ×${b.material.machinability}`,
    `Polotovar: ${blankTypeLabel(b.blank.type)} ${b.blank.dimensions}, ${b.blank.weightKg} kg (díl ${b.blank.partWeightKg} kg, odpad ${b.blank.wasteKg} kg, využití ${b.blank.utilizationPercent} %)`,
    `Materiál/ks: ${b.materialCost.costPerPiece} Kč${b.materialCost.surchargeNotes.length ? ` (${b.materialCost.surchargeNotes.join(", ")})` : ""}`,
    `Operace:\n${ops}`,
    `Složitost: ×${b.complexity.coefficient}, zmetkovitost ${b.complexity.scrapRiskPercent} %, měření ${b.complexity.measurementDifficulty}`,
    `Sériovost: ${b.series.label}, čas/ks ${b.timePerPieceMin} min, fixní ${b.timeFixedMin} min, celkem ${b.timeTotalMin} min`,
    `Náklady/ks: ${b.costPerPiece} Kč (materiál ${b.materialCost.costPerPiece} + stroj ${b.machiningCostPerPiece} + fixní ${b.fixedCostPerPiece} + kontrola ${b.inspectionCostPerPiece} + manipulace ${b.handlingCostPerPiece} + balení ${b.packingCostPerPiece} + kooperace ${b.cooperationCostPerPiece} + doprava ${b.transportPerPiece})`,
    `Strategie: úroveň ${b.strategy.level}/10 → marže ${b.marginPercent} %${b.strategy.adjustments.length ? ` (${b.strategy.adjustments.join("; ")})` : ""}`,
    `Termín: ${b.leadTime.days} dní (${b.leadTime.mode})${b.leadTime.surchargePercent ? `, přirážka za zkrácení ${b.leadTime.surchargePercent} %` : ""}`,
    b.smoothing ? `Vyhlazení vs. historie: ${b.smoothing.note}` : "",
    `Výsledek baseline: ${b.unitPrice} Kč/ks, celkem ${b.totalPrice} Kč, jistota ${Math.round(b.confidence * 100)} %`,
    b.needsClarification.length ? `K doplnění: ${b.needsClarification.join("; ")}` : "",
  ].filter(Boolean).join("\n");
}
