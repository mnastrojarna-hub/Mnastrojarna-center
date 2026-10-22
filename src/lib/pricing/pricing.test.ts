import { describe, it, expect } from "vitest";
import { findMaterial, materialCost, MATERIALS } from "./materials";
import { parseDimensions, proposeBlank } from "./blank";
import { pickMachine, normalizeTechnology, machineSizeFor, countryFactor } from "./machines";
import { complexityCoefficient } from "./complexity";
import { classifySeries, amortize } from "./series";
import { resolveStrategy, marginForLevel } from "./strategy";
import { computeLeadTime, modeForDays } from "./lead-time";
import { stabilizePrice, inflate } from "./smoothing";
import { calculatePrice } from "./engine";
import { DEFAULT_PRICING_PARAMS } from "./params";

const P = DEFAULT_PRICING_PARAMS;

describe("materials", () => {
  it("najde materiál dle ČSN, W.Nr. i EN označení", () => {
    expect(findMaterial("1.2379").material.key).toBe("19573");
    expect(findMaterial("C45").material.key).toBe("12050");
    expect(findMaterial("ocel 12 050").material.key).toBe("12050");
    expect(findMaterial("EN AW-7075").material.key).toBe("alu_7075");
    expect(findMaterial("nerez 1.4301").material.key).toBe("17240");
  });
  it("nerozpoznaný materiál → fallback s matched=false", () => {
    const r = findMaterial("unobtanium");
    expect(r.matched).toBe(false);
    expect(r.material.key).toBe("12050");
  });
  it("má hustoty v rozumném rozsahu", () => {
    for (const m of MATERIALS) {
      expect(m.densityKgDm3).toBeGreaterThan(0.9);
      expect(m.densityKgDm3).toBeLessThan(9.1);
    }
  });
  it("počítá přirážky za malé množství a speciální materiál", () => {
    const special = findMaterial("1.2379").material;
    const r = materialCost({ material: special, blankWeightKg: 2, quantity: 1, params: P });
    expect(r.surchargesPercent).toBe(P.smallQtySurchargePct + P.specialMaterialSurchargePct);
    expect(r.costPerPiece).toBeGreaterThan(r.basePerPiece);
  });
  it("velká série bez přirážky za malé množství", () => {
    const m = findMaterial("C45").material;
    const r = materialCost({ material: m, blankWeightKg: 2, quantity: 100, params: P });
    expect(r.surchargeNotes.find((n) => n.includes("malé množství"))).toBeUndefined();
  });
});

describe("blank (polotovar)", () => {
  it("parsuje kulatinu, trubku i hranol", () => {
    expect(parseDimensions("⌀50 × 120").shape).toBe("round");
    expect(parseDimensions("D50x120 mm")).toMatchObject({ shape: "round", d: 50, l: 120 });
    expect(parseDimensions("TR 60/40 x 100")).toMatchObject({ shape: "tube", d: 60, dInner: 40 });
    expect(parseDimensions("120 × 80 × 25 mm")).toMatchObject({ shape: "box", x: 120, y: 80, z: 25 });
  });
  it("navrhne kulatinu s přídavky a spočte hmotnost a využití", () => {
    const m = findMaterial("C45").material;
    const b = proposeBlank({ blankDimensions: "⌀50 × 120", material: m, finishedWeightKg: 1.2 });
    expect(b.type).toBe("kulatina");
    // ⌀54 × 126: V = π·2,7²·126/1e6 dm³ ≈ 2,885 dm³ → 22,6 kg? ne: cm! π·(27mm)²·126mm = 288 537 mm³ = 0,2885 dm³ → 2,27 kg
    expect(b.weightKg).toBeGreaterThan(2);
    expect(b.weightKg).toBeLessThan(2.6);
    expect(b.utilizationPercent).toBeGreaterThan(40);
    expect(b.utilizationPercent).toBeLessThanOrEqual(100);
    expect(b.wasteKg).toBeCloseTo(b.weightKg - b.partWeightKg, 1);
  });
  it("tenkou desku řeší jako plech/výpalek", () => {
    const m = findMaterial("S235").material;
    const b = proposeBlank({ blankDimensions: "200 x 100 x 5", material: m, technologies: ["laser"] });
    expect(["plech", "vypalek"]).toContain(b.type);
  });
  it("výkovek je tvarový polotovar s vyšším využitím", () => {
    const m = findMaterial("42CrMo4").material;
    const b = proposeBlank({ partType: "vykovek", blankDimensions: "⌀80 × 60", material: m });
    expect(b.type).toBe("vykovek");
    expect(b.utilizationPercent).toBeGreaterThanOrEqual(80);
  });
});

describe("machines", () => {
  it("normalizuje volný text technologií", () => {
    expect(normalizeTechnology("frézování 5 os")).toBe("frezovani_5os");
    expect(normalizeTechnology("soustružení")).toBe("soustruzeni");
    expect(normalizeTechnology("drátovka WEDM")).toBe("dratove_rezani");
    expect(normalizeTechnology("kalení 60 HRC")).toBe("tepelne_zpracovani");
    expect(normalizeTechnology("černění")).toBe("povrchova_uprava");
  });
  it("vybírá velikost stroje dle rozměru a zemi dle koeficientu", () => {
    expect(machineSizeFor(150)).toBe("maly");
    expect(machineSizeFor(2000)).toBe("portal");
    const cz = pickMachine("frezovani_3osy", "stredni", "CZ");
    const de = pickMachine("frezovani_3osy", "stredni", "DE");
    expect(de.ratePerHour).toBe(Math.round(cz.ratePerHour * countryFactor("DE")));
  });
});

describe("complexity", () => {
  it("jednoduchý díl ≈ 1,0; složitý díl výrazně víc", () => {
    const simple = complexityCoefficient({
      operationCount: 1, setupCount: 1, toolCountEstimate: 4,
      tolerances: { t005: 0, t01: 0, t04: 0, t1: 2 }, geomToleranceCount: 0,
      threadCount: 0, pocketCount: 0, holeCount: 2, machinability: 1,
      hasHeatTreatment: false, hasTightSurfaceFinish: false,
    });
    const complex = complexityCoefficient({
      operationCount: 5, setupCount: 4, toolCountEstimate: 18,
      tolerances: { t005: 4, t01: 6, t04: 10, t1: 20 }, geomToleranceCount: 5,
      threadCount: 8, pocketCount: 6, holeCount: 24, machinability: 1.7,
      hasHeatTreatment: true, hasTightSurfaceFinish: true,
    });
    expect(simple.coefficient).toBeLessThan(1.1);
    expect(complex.coefficient).toBeGreaterThan(1.8);
    expect(complex.coefficient).toBeLessThanOrEqual(2.5);
    expect(complex.scrapRiskPercent).toBeGreaterThan(simple.scrapRiskPercent);
    expect(complex.measurementDifficulty).toBe("vysoka");
  });
});

describe("series", () => {
  it("klasifikuje sériovost", () => {
    expect(classifySeries(1).cls).toBe("jeden_kus");
    expect(classifySeries(3).cls).toBe("prototyp");
    expect(classifySeries(30).cls).toBe("mala_serie");
    expect(classifySeries(200).cls).toBe("stredni_serie");
    expect(classifySeries(5000).cls).toBe("velka_serie");
  });
  it("amortizuje fixní náklady", () => {
    expect(amortize(1000, 100)).toBe(10);
    expect(amortize(1000, 0)).toBe(1000);
  });
});

describe("strategy", () => {
  it("úroveň 5 = výchozí marže, 1 = podnákladová, 10 = maximální", () => {
    expect(marginForLevel(5, 15)).toBe(15);
    expect(marginForLevel(1, 15)).toBeLessThan(0);
    expect(marginForLevel(10, 15)).toBeGreaterThan(40);
  });
  it("vytížená výroba posouvá úroveň nahoru, strategický zákazník dolů", () => {
    const busy = resolveStrategy({ requestedLevel: 5, baseMarginPercent: 15, context: { utilizationPercent: 95 } });
    expect(busy.level).toBe(6);
    const strat = resolveStrategy({
      requestedLevel: 5, baseMarginPercent: 15,
      context: { utilizationPercent: 70 }, customer: { businessPriority: "strategicky" },
    });
    expect(strat.level).toBe(4);
  });
  it("respektuje individuální marži zákazníka", () => {
    const r = resolveStrategy({ requestedLevel: 5, baseMarginPercent: 15, customer: { marginPercent: 22 } });
    expect(r.marginPercent).toBe(22);
  });
  it("rizikový zákazník zdražuje", () => {
    const r = resolveStrategy({ requestedLevel: 5, baseMarginPercent: 15, customer: { paymentMorale: "spatna" } });
    expect(r.level).toBe(6);
  });
});

describe("lead time", () => {
  it("klasifikuje režim dle dnů", () => {
    expect(modeForDays(10)).toBe("expres");
    expect(modeForDays(21)).toBe("rychly");
    expect(modeForDays(40)).toBe("standard");
    expect(modeForDays(90)).toBe("dlouhy");
  });
  it("kooperace a speciální materiál prodlužují, expres přirážka při zkrácení", () => {
    const base = computeLeadTime({
      totalMachineHours: 20, complexityCoefficient: 1.2, materialAvailability: "bezna",
      hasHeatTreatment: false, hasSurfaceTreatment: false, utilizationPercent: 60, params: P,
    });
    const coop = computeLeadTime({
      totalMachineHours: 20, complexityCoefficient: 1.2, materialAvailability: "specialni",
      hasHeatTreatment: true, hasSurfaceTreatment: true, utilizationPercent: 60, params: P,
    });
    expect(coop.standardDays).toBeGreaterThan(base.standardDays);
    const express = computeLeadTime({
      totalMachineHours: 60, complexityCoefficient: 1.2, materialAvailability: "bezna",
      hasHeatTreatment: false, hasSurfaceTreatment: false, utilizationPercent: 60,
      requestedMode: "expres", params: P,
    });
    if (express.mode === "expres") expect(express.surchargePercent).toBe(P.expressSurchargePct);
    expect(express.days).toBeLessThanOrEqual(express.standardDays);
  });
});

describe("smoothing (ochrana proti výkyvům)", () => {
  const now = new Date("2026-06-10");
  it("inflační přepočet historické ceny", () => {
    expect(inflate(100, "2025-06-10", 5, now)).toBeCloseTo(105, 0);
  });
  it("omezí skokové zdražení i zlevnění", () => {
    const history = [
      { unitPrice: 1000, date: "2026-01-10" },
      { unitPrice: 1050, date: "2025-09-10" },
    ];
    const up = stabilizePrice(2000, history, { inflationPctPerYear: 5, maxStepUpPct: 15, maxStepDownPct: 15, now });
    expect(up.adjusted).toBe(true);
    expect(up.price).toBeLessThan(1300);
    const down = stabilizePrice(500, history, { inflationPctPerYear: 5, maxStepUpPct: 15, maxStepDownPct: 15, now });
    expect(down.adjusted).toBe(true);
    expect(down.price).toBeGreaterThan(850);
    const ok = stabilizePrice(1080, history, { inflationPctPerYear: 5, maxStepUpPct: 15, maxStepDownPct: 15, now });
    expect(ok.adjusted).toBe(false);
    expect(ok.price).toBe(1080);
  });
  it("bez historie nic nemění", () => {
    const r = stabilizePrice(1234, [], { inflationPctPerYear: 5, maxStepUpPct: 15, maxStepDownPct: 15, now });
    expect(r.adjusted).toBe(false);
    expect(r.price).toBe(1234);
  });
});

describe("engine (kompletní kalkulace)", () => {
  const base = {
    drawingNumber: "VK-1001",
    material: "C45",
    blankDimensions: "⌀50 × 120",
    quantity: 10,
    technologies: ["soustružení", "frézování"],
    tolerancesBeforeHt: { t005: 0, t01: 2, t04: 4, t1: 6 },
    holeCount: 4, threadCount: 2, pocketCount: 0,
    params: P,
  };

  it("vrátí konzistentní kalkulaci se zdůvodněním", () => {
    const r = calculatePrice(base);
    expect(r.unitPrice).toBeGreaterThan(0);
    expect(r.totalPrice).toBeCloseTo(r.unitPrice * 10, 1);
    expect(r.costPerPiece).toBeLessThan(r.unitPrice);
    expect(r.operations.length).toBeGreaterThanOrEqual(2);
    expect(r.blank.type).toBe("kulatina");
    expect(r.reasoning.length).toBeGreaterThan(5);
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it("větší série má nižší cenu za kus (amortizace fixů)", () => {
    const one = calculatePrice({ ...base, quantity: 1 });
    const hundred = calculatePrice({ ...base, quantity: 100 });
    expect(hundred.unitPrice).toBeLessThan(one.unitPrice);
  });

  it("těsné tolerance a tepelka zdražují", () => {
    const simple = calculatePrice(base);
    const hard = calculatePrice({
      ...base,
      tolerancesBeforeHt: { t005: 3, t01: 6, t04: 8, t1: 10 },
      tolerancesAfterHt: { t005: 2, t01: 2, t04: 0, t1: 0 },
      heatTreatment: "kaleno 60±2 HRC",
      geomToleranceCount: 4,
    });
    expect(hard.unitPrice).toBeGreaterThan(simple.unitPrice);
    expect(hard.complexity.coefficient).toBeGreaterThan(simple.complexity.coefficient);
    expect(hard.heatTreatmentCost).toBeGreaterThan(0);
    expect(hard.leadTime.standardDays).toBeGreaterThan(simple.leadTime.standardDays);
  });

  it("strategie 8 dává vyšší cenu než strategie 3", () => {
    const cheap = calculatePrice({ ...base, strategyLevel: 3 });
    const premium = calculatePrice({ ...base, strategyLevel: 8 });
    expect(premium.unitPrice).toBeGreaterThan(cheap.unitPrice);
  });

  it("historie drží cenu v pásmu (vyhlazení)", () => {
    const r = calculatePrice({
      ...base,
      history: [{ unitPrice: 100, date: "2026-05-01" }],
    });
    expect(r.smoothing?.adjusted).toBe(true);
    expect(r.unitPrice).toBeLessThanOrEqual(100 * 1.16);
  });

  it("chybějící materiál a rozměry sníží confidence a vyžádá doplnění", () => {
    const r = calculatePrice({ quantity: 5, params: P });
    expect(r.confidence).toBeLessThan(0.7);
    expect(r.needsClarification.length).toBeGreaterThan(0);
    expect(r.unitPrice).toBeGreaterThan(0); // i tak vrátí použitelný odhad
  });

  it("zákaznický profil ovlivní marži", () => {
    const normal = calculatePrice(base);
    const premium = calculatePrice({ ...base, customer: { priceLevel: "premium" } });
    expect(premium.marginPercent).toBeGreaterThan(normal.marginPercent);
  });
});
