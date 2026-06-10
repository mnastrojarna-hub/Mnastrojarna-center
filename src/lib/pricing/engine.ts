import type {
  CustomerPricingProfile, HistoricalPrice, LeadTimeMode, MachineRate, MaterialInfo,
  OperationEstimate, PriceBreakdown, PricingParams, TechnologyKey, ToleranceCounts,
} from "./types";
import { findMaterial, materialCost, round2 } from "./materials";
import { parseDimensions, proposeBlank } from "./blank";
import {
  COOPERATION_TECHNOLOGIES, TECHNOLOGY_LABEL, machineSizeFor, normalizeTechnology, pickMachine,
} from "./machines";
import { complexityCoefficient, estimateSetups, estimateTools } from "./complexity";
import { amortize, classifySeries } from "./series";
import { resolveStrategy } from "./strategy";
import { computeLeadTime } from "./lead-time";
import { stabilizePrice } from "./smoothing";

/**
 * Deterministické kalkulační jádro Nacenění v2.
 * Z dat výkresu a parametrů spočítá kompletní baseline kalkulaci:
 * polotovar → materiál → operace a časy → složitost → sériovost →
 * strategie/marže → termín → vyhlazení ceny. AI ji následně rafinuje.
 */

export interface EngineInput {
  drawingNumber?: string;
  partType?: string;
  material?: string;
  blankDimensions?: string;
  blankWeightKg?: number;
  finishedWeightKg?: number;
  quantity: number;
  technologies?: string[];          // volný text z výkresu/AI
  surfaceTreatment?: string;
  heatTreatment?: string;
  surfaceQualities?: string[];      // Ra
  tolerancesBeforeHt?: Partial<ToleranceCounts>;
  tolerancesAfterHt?: Partial<ToleranceCounts>;
  geomToleranceCount?: number;
  threadCount?: number;
  holeCount?: number;
  pocketCount?: number;
  certificateRequired?: boolean;
  requestedLeadMode?: LeadTimeMode;
  strategyLevel?: number;
  customer?: CustomerPricingProfile | null;
  history?: HistoricalPrice[];
  params: PricingParams;
  /** Katalogy z DB (přepíšou výchozí statický katalog) */
  catalog?: { materials?: MaterialInfo[]; machineRates?: MachineRate[] };
}

const mergeTol = (a?: Partial<ToleranceCounts>, b?: Partial<ToleranceCounts>): ToleranceCounts => ({
  t005: (a?.t005 ?? 0) + (b?.t005 ?? 0),
  t01: (a?.t01 ?? 0) + (b?.t01 ?? 0),
  t04: (a?.t04 ?? 0) + (b?.t04 ?? 0),
  t1: (a?.t1 ?? 0) + (b?.t1 ?? 0),
});

/** Strojní čas hrubování+dokončení (min/ks) z úběru, obrobitelnosti a technologie. */
function machiningMinutes(tech: TechnologyKey, removedKg: number, machinability: number, share: number): number {
  // min/kg úběru dle technologie (frézování pomalejší než soustružení, EDM výrazně pomalejší)
  const perKg: Partial<Record<TechnologyKey, number>> = {
    soustruzeni: 8, dlouhotocne_soustruzeni: 5,
    frezovani_3osy: 12, frezovani_4osy: 13, frezovani_5os: 15,
    brouseni: 30, dratove_rezani: 60, hloubeni_edm: 90,
    laser: 2, vodni_paprsek: 4, paleni: 2, svarovani: 20, montaz: 10,
  };
  const base = (perKg[tech] ?? 12) * Math.max(0.05, removedKg) * machinability * share;
  return Math.max(2, base);
}

export function calculatePrice(input: EngineInput): PriceBreakdown {
  const p = input.params;
  const quantity = Math.max(1, Math.floor(input.quantity || 1));
  const reasoning: string[] = [];
  const needsClarification: string[] = [];
  let confidence = 0.9;

  // ── 1) Materiál ───────────────────────────────────────────
  const { material, matched } = findMaterial(input.material, input.catalog?.materials ?? undefined);
  if (!matched) {
    confidence -= 0.2;
    needsClarification.push(input.material ? `Materiál „${input.material}" není v databázi — počítám jako ${material.label}` : "Materiál neuveden");
  }
  reasoning.push(`Materiál: ${material.label} · hustota ${material.densityKgDm3} kg/dm³ · ${material.pricePerKg} Kč/kg · obrobitelnost ×${material.machinability}`);

  // ── 2) Polotovar ──────────────────────────────────────────
  const blank = proposeBlank({
    partType: input.partType,
    blankDimensions: input.blankDimensions,
    blankWeightKg: input.blankWeightKg,
    finishedWeightKg: input.finishedWeightKg,
    material,
    technologies: input.technologies,
  });
  if (blank.weightKg <= 0) {
    confidence -= 0.25;
    needsClarification.push("Rozměry/hmotnost polotovaru se nepodařilo určit");
  }
  reasoning.push(`Polotovar: ${blank.note} — ${blank.dimensions}, ${blank.weightKg} kg (díl ${blank.partWeightKg} kg, odpad ${blank.wasteKg} kg, využití ${blank.utilizationPercent} %)`);

  // ── 3) Materiálové náklady ────────────────────────────────
  const mat = materialCost({
    material, blankWeightKg: blank.weightKg, quantity,
    certificateRequired: input.certificateRequired, params: p,
  });
  reasoning.push(
    `Materiál/ks: ${mat.basePerPiece} Kč${mat.surchargesPercent ? ` + přirážky ${mat.surchargesPercent} % (${mat.surchargeNotes.join(", ")})` : ""} + doprava materiálu ${mat.transportPerOrder} Kč/zakázka → ${mat.costPerPiece} Kč/ks`,
  );

  // ── 4) Technologie a operace ──────────────────────────────
  const rawTech = (input.technologies ?? []).map(normalizeTechnology).filter((t): t is TechnologyKey => !!t);
  const techSet = [...new Set(rawTech)];
  if (input.heatTreatment && !techSet.includes("tepelne_zpracovani")) techSet.push("tepelne_zpracovani");
  if (input.surfaceTreatment && !techSet.includes("povrchova_uprava")) techSet.push("povrchova_uprava");
  if (!techSet.filter((t) => !COOPERATION_TECHNOLOGIES.includes(t)).length) {
    // Bez zadané technologie: odvodit z polotovaru
    techSet.unshift(blank.type === "kulatina" || blank.type === "trubka" ? "soustruzeni" : "frezovani_3osy");
    if ((input.pocketCount ?? 0) > 0 || (input.holeCount ?? 0) > 2) {
      if (!techSet.includes("frezovani_3osy")) techSet.push("frezovani_3osy");
    }
    reasoning.push(`Technologie odvozena z polotovaru: ${techSet.map((t) => TECHNOLOGY_LABEL[t]).join(", ")}`);
    confidence -= 0.05;
  }
  const machiningTech = techSet.filter((t) => !COOPERATION_TECHNOLOGIES.includes(t));
  const cooperationTech = techSet.filter((t) => COOPERATION_TECHNOLOGIES.includes(t));

  // ── 5) Složitost ──────────────────────────────────────────
  const tol = mergeTol(input.tolerancesBeforeHt, input.tolerancesAfterHt);
  const hasTightRa = (input.surfaceQualities ?? []).some((q) => {
    const m = q.match(/(\d+(?:[.,]\d+)?)/);
    return m ? Number(m[1].replace(",", ".")) <= 0.8 : false;
  });
  const opCount = techSet.length;
  const setups = estimateSetups(machiningTech.length, input.pocketCount ?? 0,
    machiningTech.some((t) => t.startsWith("frezovani")) && machiningTech.some((t) => t.includes("soustruzeni")));
  const tools = estimateTools({
    holeCount: input.holeCount ?? 0, threadCount: input.threadCount ?? 0,
    pocketCount: input.pocketCount ?? 0, operationCount: machiningTech.length,
  });
  const complexity = complexityCoefficient({
    operationCount: opCount,
    setupCount: setups,
    toolCountEstimate: tools,
    tolerances: tol,
    geomToleranceCount: input.geomToleranceCount ?? 0,
    threadCount: input.threadCount ?? 0,
    pocketCount: input.pocketCount ?? 0,
    holeCount: input.holeCount ?? 0,
    machinability: material.machinability,
    hasHeatTreatment: Boolean(input.heatTreatment),
    hasTightSurfaceFinish: hasTightRa,
  });
  reasoning.push(`Složitost: koeficient ×${complexity.coefficient} (${complexity.notes.join("; ") || "jednoduchý díl"}) · riziko zmetků ${complexity.scrapRiskPercent} % · měření: ${complexity.measurementDifficulty}`);

  // ── 6) Sériovost ──────────────────────────────────────────
  const series = classifySeries(quantity);
  reasoning.push(`Sériovost: ${series.label} — fixní časy (programování, seřízení, 1. kus) rozpočteny na ${quantity} ks, čas/ks ×${series.perPieceTimeFactor}`);

  // ── 7) Operace: časy a náklady ────────────────────────────
  const dims = parseDimensions(input.blankDimensions);
  const maxDim = Math.max(dims.d ?? 0, dims.l ?? 0, dims.x ?? 0, dims.y ?? 0, dims.z ?? 0);
  const size = machineSizeFor(maxDim);
  const removedKg = Math.max(0.05, blank.wasteKg);
  const share = 1 / Math.max(1, machiningTech.length);

  const featureMinutes =
    (input.holeCount ?? 0) * 1.2 + (input.threadCount ?? 0) * 2.5 + (input.pocketCount ?? 0) * 4
    + tol.t005 * 8 + tol.t01 * 4 + tol.t04 * 1.2 + tol.t1 * 0.3
    + (input.geomToleranceCount ?? 0) * 3;

  const operations: OperationEstimate[] = [];
  let machiningCostPerPiece = 0;
  let fixedCostPerPiece = 0;
  let inspectionCostPerPiece = 0;
  let timePerPieceMin = 0;
  let timeFixedMin = 0;

  for (const tech of machiningTech) {
    const machine = pickMachine(tech, size, p.countryCode, input.catalog?.machineRates ?? undefined);
    const isPrimary = tech === machiningTech[0];
    const baseMin = machiningMinutes(tech, removedKg, material.machinability, share)
      + (isPrimary ? featureMinutes : featureMinutes * 0.2);
    const minutesPerPiece = round2(baseMin * complexity.coefficient * series.perPieceTimeFactor);

    const setupMinutes = round2((20 + 15 * complexity.coefficient) * (setups / machiningTech.length));
    const programmingMinutes = tech.startsWith("frezovani") || tech === "dratove_rezani" || tech === "hloubeni_edm"
      ? round2(30 + 40 * (complexity.coefficient - 1) + 20)
      : round2(15 + 25 * (complexity.coefficient - 1));
    const firstPieceMinutes = round2(minutesPerPiece * 0.6 + 10 * complexity.coefficient);
    const inspectionMinutesPerPiece = round2(
      1.5 + tol.t005 * 2.5 + tol.t01 * 1.2 + tol.t04 * 0.3 + (complexity.measurementDifficulty === "vysoka" ? 3 : complexity.measurementDifficulty === "stredni" ? 1 : 0),
    );

    const variableCost = (minutesPerPiece / 60) * machine.ratePerHour;
    const fixedCost = amortize(
      (setupMinutes / 60) * p.setupRate + (programmingMinutes / 60) * p.programmingRate + (firstPieceMinutes / 60) * machine.ratePerHour,
      quantity,
    );
    const inspCost = (inspectionMinutesPerPiece / 60) * p.inspectionRate;

    machiningCostPerPiece += variableCost;
    fixedCostPerPiece += fixedCost;
    inspectionCostPerPiece += inspCost / Math.max(1, machiningTech.length); // kontrola se nedubluje na každou operaci plně
    timePerPieceMin += minutesPerPiece + inspectionMinutesPerPiece / machiningTech.length;
    timeFixedMin += setupMinutes + programmingMinutes + firstPieceMinutes;

    operations.push({
      technology: tech,
      name: TECHNOLOGY_LABEL[tech],
      machine: machine.label,
      ratePerHour: machine.ratePerHour,
      setupMinutes,
      programmingMinutes,
      firstPieceMinutes,
      minutesPerPiece,
      inspectionMinutesPerPiece: round2(inspectionMinutesPerPiece / machiningTech.length),
      costPerPiece: round2(variableCost + fixedCost + inspCost / machiningTech.length),
      cooperation: false,
    });
  }

  // ── 8) Kooperace (tepelka, povrch, ostatní) ───────────────
  let heatTreatmentCost = 0;
  let surfaceTreatmentCost = 0;
  let otherCooperationCost = 0;
  for (const tech of cooperationTech) {
    if (tech === "tepelne_zpracovani") {
      heatTreatmentCost = round2(Math.max(28 * blank.partWeightKg, amortize(900, quantity)));
      operations.push(coopOp(tech, `${input.heatTreatment || "kalení/žíhání"} (kooperace)`, heatTreatmentCost));
    } else if (tech === "povrchova_uprava") {
      surfaceTreatmentCost = round2(Math.max(22 * blank.partWeightKg, amortize(700, quantity)));
      operations.push(coopOp(tech, `${input.surfaceTreatment || "povrchová úprava"} (kooperace)`, surfaceTreatmentCost));
    } else {
      otherCooperationCost += round2(Math.max(30 * blank.partWeightKg, amortize(800, quantity)));
      operations.push(coopOp(tech, "Externí kooperace", otherCooperationCost));
    }
  }
  const cooperationCostPerPiece = round2(heatTreatmentCost + surfaceTreatmentCost + otherCooperationCost);
  if (cooperationCostPerPiece > 0) {
    reasoning.push(`Kooperace/ks: tepelné zpracování ${heatTreatmentCost} Kč · povrchová úprava ${surfaceTreatmentCost} Kč${otherCooperationCost ? ` · ostatní ${otherCooperationCost} Kč` : ""}`);
  }

  // ── 9) Manipulace, balení, doprava ────────────────────────
  const handlingMinutes = 3 + blank.weightKg * 0.5;
  const handlingCostPerPiece = round2((handlingMinutes / 60) * p.handlingRate);
  const packingMinutes = 2 + amortize(15, quantity);
  const packingCostPerPiece = round2((packingMinutes / 60) * p.handlingRate);
  const transportPerPiece = round2(amortize(p.transportDefault, quantity));
  timePerPieceMin += handlingMinutes + packingMinutes;

  // ── 10) Náklady celkem / ks ───────────────────────────────
  const scrapAllowancePercent = complexity.scrapRiskPercent;
  const productionCost =
    mat.costPerPiece + machiningCostPerPiece + fixedCostPerPiece + inspectionCostPerPiece
    + handlingCostPerPiece + packingCostPerPiece + cooperationCostPerPiece + transportPerPiece;
  const costPerPiece = round2(productionCost * (1 + scrapAllowancePercent / 100));
  reasoning.push(
    `Náklady/ks: materiál ${mat.costPerPiece} + obrábění ${round2(machiningCostPerPiece)} + fixní (program/seřízení/1. kus) ${round2(fixedCostPerPiece)} + kontrola ${round2(inspectionCostPerPiece)} + manipulace ${handlingCostPerPiece} + balení ${packingCostPerPiece} + kooperace ${cooperationCostPerPiece} + doprava ${transportPerPiece} = ${round2(productionCost)} Kč · rezerva na zmetky ${scrapAllowancePercent} % → ${costPerPiece} Kč/ks`,
  );

  // ── 11) Strategie a marže ─────────────────────────────────
  const strategy = resolveStrategy({
    requestedLevel: input.strategyLevel ?? p.strategyLevel,
    baseMarginPercent: p.marginPercent,
    context: { utilizationPercent: p.utilizationPercent },
    customer: input.customer,
  });
  reasoning.push(`Strategie: úroveň ${strategy.level}/10 (požadováno ${strategy.requestedLevel}) → marže ${strategy.marginPercent} %${strategy.adjustments.length ? ` · ${strategy.adjustments.join("; ")}` : ""}`);

  // ── 12) Termín dodání ─────────────────────────────────────
  const machineHoursPerOrder = (timePerPieceMin * quantity + timeFixedMin) / 60;
  const leadTime = computeLeadTime({
    totalMachineHours: machineHoursPerOrder,
    complexityCoefficient: complexity.coefficient,
    materialAvailability: material.availability,
    hasHeatTreatment: Boolean(input.heatTreatment),
    hasSurfaceTreatment: Boolean(input.surfaceTreatment),
    hasOtherCooperation: cooperationTech.includes("kooperace"),
    utilizationPercent: p.utilizationPercent,
    requestedMode: input.requestedLeadMode,
    params: p,
  });
  reasoning.push(`Termín: ${leadTime.days} dní (${leadTime.notes.join("; ")})`);

  // ── 13) Cena: marže + expres + vyhlazení ──────────────────
  let unitPrice = costPerPiece * (1 + strategy.marginPercent / 100) * (1 + leadTime.surchargePercent / 100);
  let smoothing = null;
  if (input.history?.length) {
    smoothing = stabilizePrice(unitPrice, input.history, {
      inflationPctPerYear: p.inflationPercent,
      maxStepUpPct: p.maxPriceStepPct,
      maxStepDownPct: p.maxPriceStepPct,
    });
    if (smoothing.adjusted) reasoning.push(`Vyhlazení ceny: ${smoothing.note}`);
    else reasoning.push(`Historie: ${smoothing.note}`);
    unitPrice = smoothing.price;
  }
  unitPrice = round2(unitPrice);
  const totalPrice = round2(unitPrice * quantity);
  reasoning.push(`Cena: náklady ${costPerPiece} Kč + marže ${strategy.marginPercent} %${leadTime.surchargePercent ? ` + termínová přirážka ${leadTime.surchargePercent} %` : ""} → ${unitPrice} Kč/ks · celkem ${totalPrice} Kč`);

  timePerPieceMin = round2(timePerPieceMin);
  timeFixedMin = round2(timeFixedMin);

  return {
    material,
    blank,
    materialCost: mat,
    operations,
    complexity,
    series,
    strategy,
    leadTime,
    smoothing,
    timePerPieceMin,
    timeFixedMin,
    timeTotalMin: round2(timePerPieceMin * quantity + timeFixedMin),
    machiningCostPerPiece: round2(machiningCostPerPiece),
    fixedCostPerPiece: round2(fixedCostPerPiece),
    inspectionCostPerPiece: round2(inspectionCostPerPiece),
    handlingMinutesPerPiece: round2(handlingMinutes + packingMinutes),
    handlingCostPerPiece,
    packingCostPerPiece,
    cooperationCostPerPiece,
    surfaceTreatmentCost,
    heatTreatmentCost,
    transportPerPiece,
    costPerPiece,
    marginPercent: strategy.marginPercent,
    unitPrice,
    totalPrice,
    scrapAllowancePercent,
    quantity,
    confidence: round2(Math.max(0.2, confidence)),
    reasoning,
    needsClarification,
  };
}

function coopOp(technology: TechnologyKey, name: string, costPerPiece: number): OperationEstimate {
  return {
    technology, name, machine: "Kooperace", ratePerHour: 0,
    setupMinutes: 0, programmingMinutes: 0, firstPieceMinutes: 0,
    minutesPerPiece: 0, inspectionMinutesPerPiece: 0,
    costPerPiece: round2(costPerPiece), cooperation: true,
  };
}
