import { describe, expect, it } from "vitest";
import {
  analyzeDrawingMaterial, barBlankLength, estimateBlank, formatKg, parseDimensionText, prismAllowance, roundAllowance,
  standardUp, ROUND_BAR_SIZES, FLAT_THICKNESS_SIZES,
} from "./blank-weight";
import type { DrawingExtract } from "./capture-batch-types";

const PI4 = Math.PI / 4;
/** kg z mm³ a g/cm³ */
const kg = (mm3: number, rho: number) => (mm3 * rho) / 1e6;

describe("parseDimensionText", () => {
  it.each([
    ["Ø65x120", { shape: "kulatina", d: 65, l: 120 }],
    ["ø 65 h6 x 120 mm", { shape: "kulatina", d: 65, l: 120 }],
    ["⌀65×120", { shape: "kulatina", d: 65, l: 120 }],
    ["D65x120", { shape: "kulatina", d: 65, l: 120 }],
    ["Ø65, L=120", { shape: "kulatina", d: 65, l: 120 }],
    ["Ø65 +0,1/-0,05 x 120 ±0,2", { shape: "kulatina", d: 65, l: 120 }],
    ["Ø12,5 x 40", { shape: "kulatina", d: 12.5, l: 40 }],
    ["Ø80 x Ø50 x 100", { shape: "kulatina", d: 80, l: 100 }],
    ["M8x1,25, Ø20 x 35", { shape: "kulatina", d: 20, l: 35 }],
    ["kulatina 50 délka 200", { shape: "kulatina", d: 50, l: 200 }],
    ["120 x 80 x 30", { shape: "hranol", l: 120, w: 80, h: 30 }],
    ["30×120×80 mm", { shape: "hranol", l: 120, w: 80, h: 30 }],
    ["R25, 120 x 80 x 30", { shape: "hranol", l: 120, w: 80, h: 30 }],
    ["Obrys 250×120×45, Ø40", { shape: "hranol", l: 250, w: 120, h: 45 }],
    ["tl. 10 – 250 x 400", { shape: "plech", t: 10, l: 400, w: 250 }],
    ["plech tl. 3 mm 200x300", { shape: "plech", t: 3, l: 300, w: 200 }],
    ["3 x 200 x 300", { shape: "plech", t: 3, l: 300, w: 200 }],
    ["t=5, 150 x 80", { shape: "plech", t: 5, l: 150, w: 80 }],
    ["□40 x 100", { shape: "ctyrhran", a: 40, l: 100 }],
    ["4hr 40 x 100", { shape: "ctyrhran", a: 40, l: 100 }],
    ["6hr 24 x 50", { shape: "sestihran", s: 24, l: 50 }],
    ["SW 17 x 30", { shape: "sestihran", s: 17, l: 30 }],
    ["TR 60x5 x 200", { shape: "trubka", d: 60, dInner: 50, l: 200 }],
    ["Ø80/Ø50 x 100", { shape: "trubka", d: 80, dInner: 50, l: 100 }],
    ["Ø80/50x100", { shape: "trubka", d: 80, dInner: 50, l: 100 }],
    ["250, 120, 45 a další", { shape: "obalovy", l: 250, w: 120, h: 45 }],
  ])("%s", (text, expected) => {
    expect(parseDimensionText(text)).toEqual(expect.objectContaining(expected));
  });

  it("dva rozměry bez tvaru = neurčeno", () => {
    expect(parseDimensionText("65 x 120").shape).toBe("neurceno");
    expect(parseDimensionText("").shape).toBe("neurceno");
    expect(parseDimensionText(null).dims).toEqual([]);
  });

  it("dims = 3 největší sestupně", () => {
    expect(parseDimensionText("30 x 120 x 80").dims).toEqual([120, 80, 30]);
  });
});

describe("přídavky a hutní rozměry", () => {
  it("přídavek na průměr a hranol dle velikosti", () => {
    // tabulka 2/3/4/5/8/12, ale nejméně 5 % Ø (120 → 6, 250 → 13, 400 → 20)
    expect([10, 30, 65, 100, 120, 250, 400].map(roundAllowance)).toEqual([2, 3, 4, 5, 6, 13, 20]);
    expect([20, 60, 150, 300, 800].map(prismAllowance)).toEqual([3, 4, 5, 8, 10]);
  });
  it("zaokrouhlení na běžný rozměr", () => {
    expect(standardUp(69, ROUND_BAR_SIZES)).toBe(70);
    expect(standardUp(70, ROUND_BAR_SIZES)).toBe(70);
    expect(standardUp(34, FLAT_THICKNESS_SIZES)).toBe(35);
    expect(standardUp(613, ROUND_BAR_SIZES)).toBe(620); // nad tabulkou po 10 mm
  });
  it("délka tyče: L + 2× čelo + řez 2 (+ upnutí 10 u krátkých) → na 5 mm", () => {
    expect(barBlankLength(120, 65)).toBe(130); // 120 + 2×2,5 + 2 = 127 → 130
    expect(barBlankLength(40, 30)).toBe(45); //   40 + 2×1,5 + 2 = 45
    expect(barBlankLength(10, 60)).toBe(30); //   10 + 2×2,5 + 2 + 10 (upnutí, Ø ≤ 80) = 27 → 30
    expect(barBlankLength(10, 200)).toBe(20); //  Ø200 bez upnutí (nad Ø80): 10 + 2×4 + 2 = 20
  });
});

describe("estimateBlank — polotovar a hmotnost (ruční kontrolní výpočty)", () => {
  it("kulatina Ø65×120, ocel: Ø70 × 130 ≈ 3,9 kg", () => {
    // Ø 65 + 4 = 69 → tyč Ø70; L 120 + 7 = 127 → 130; V = π/4·70²·130 = 500 299 mm³; × 7,85 = 3,927 kg
    const e = estimateBlank({ dimensions: "Ø65x120", materialGroup: "bezna_ocel" });
    expect(e.blankShape).toBe("kulatina");
    expect(e.blankDims).toEqual({ d: 70, l: 130 });
    expect(e.blankWeightKg).toBeCloseTo(kg(PI4 * 70 ** 2 * 130, 7.85), 3);
    expect(e.blankWeightKg).toBeCloseTo(3.927, 3);
    expect(e.description).toBe("kulatina Ø70 × 130 mm ≈ 3,9 kg, ocel 7,85 g/cm³");
    expect(e.warnings).toEqual([]);
  });

  it("hranol 120×80×30, ocel: plochá tyč 125 × 90 × 35 ≈ 3,09 kg", () => {
    // 30 + 4 = 34 → 35; 80 + 4 = 84 → šířka 90; 120 + 5 = 125; V = 393 750 mm³ × 7,85 = 3,091 kg
    const e = estimateBlank({ dimensions: "120 x 80 x 30", materialGroup: "bezna_ocel" });
    expect(e.blankShape).toBe("plocha_tyc");
    expect(e.blankDims).toEqual({ l: 125, w: 90, h: 35 });
    expect(e.blankWeightKg).toBeCloseTo(3.091, 3);
    expect(e.blankDimsText).toBe("125 × 90 × 35");
  });

  it("velký hranol 400×300×20 → přířez z desky 410 × 310 × 25 ≈ 24,9 kg", () => {
    // 20 + 3 = 23 → 25; 300 + 8 = 308 → 310 (nad 200 → na 5 mm); 400 + 8 = 408 → 410; V = 3 177 500 mm³
    const e = estimateBlank({ dimensions: "400 x 300 x 20", materialGroup: "bezna_ocel" });
    expect(e.blankShape).toBe("prirez");
    expect(e.blankDims).toEqual({ l: 410, w: 310, h: 25 });
    expect(e.blankWeightKg).toBeCloseTo(24.943, 3);
  });

  it("plech tl. 10 – 250×400: laser, okraj 3 mm na stranu → 260 × 410 ≈ 8,37 kg", () => {
    // 250 + 6 = 256 → 260; 400 + 6 = 406 → 410; V = 10 · 260 · 410 = 1 066 000 mm³ × 7,85 = 8,368 kg
    const e = estimateBlank({ dimensions: "tl. 10 – 250 x 400", materialGroup: "bezna_ocel" });
    expect(e.blankShape).toBe("plech");
    expect(e.blankDims).toEqual({ t: 10, l: 410, w: 260 });
    expect(e.blankWeightKg).toBeCloseTo(8.368, 3);
    expect(e.blankDimsText).toBe("tl. 10 × 260 × 410");
  });

  it("čtyřhran □40×100: □45 × 105 ≈ 1,67 kg", () => {
    // 40 + 4 = 44 → □45; 100 + 2×1,5 + 2 = 105; V = 45²·105 = 212 625 mm³ × 7,85 = 1,669 kg
    const e = estimateBlank({ dimensions: "□40 x 100", materialGroup: "bezna_ocel" });
    expect(e.blankDims).toEqual({ a: 45, l: 105 });
    expect(e.blankWeightKg).toBeCloseTo(1.669, 3);
  });

  it("3 čísla se dvěma stejnými → čtyřhran (100×50×50 → □55 × 105 ≈ 2,49 kg)", () => {
    // 50 + 4 = 54 → □55; 100 + 5 = 105; V = 55²·105 = 317 625 mm³ × 7,85 = 2,493 kg
    const e = estimateBlank({ dimensions: "100 x 50 x 50", materialGroup: "bezna_ocel" });
    expect(e.blankShape).toBe("ctyrhran");
    expect(e.blankWeightKg).toBeCloseTo(2.493, 3);
  });

  it("šestihran 24×50: SW24 × 55 ≈ 0,215 kg", () => {
    // plocha = √3/2 · 24² = 498,83 mm²; L 50 + 5 = 55; V = 27 436 mm³ × 7,85 = 0,215 kg
    const e = estimateBlank({ dimensions: "6hr 24 x 50", materialGroup: "bezna_ocel" });
    expect(e.blankDims).toEqual({ s: 24, l: 55 });
    expect(e.blankWeightKg).toBeCloseTo(0.215, 3);
    expect(e.description).toBe("šestihran 24 × 55 mm ≈ 0,22 kg, ocel 7,85 g/cm³");
  });

  it("trubka TR 60×5 × 200: Ø65/Ø46 × 210 ≈ 2,73 kg", () => {
    // vnitřní 60 − 2·5 = 50; vnější 60 + 4 = 64 → 65; díra 50 − 4 = 46; L 200 + 7 = 207 → 210
    // V = π/4·(65² − 46²)·210 = 347 846 mm³ × 7,85 = 2,731 kg
    const e = estimateBlank({ dimensions: "TR 60x5 x 200", materialGroup: "bezna_ocel" });
    expect(e.blankShape).toBe("trubka");
    expect(e.blankDims).toEqual({ d: 65, dInner: 46, l: 210 });
    expect(e.blankWeightKg).toBeCloseTo(kg(PI4 * (65 ** 2 - 46 ** 2) * 210, 7.85), 3);
  });

  it("malá díra (Ø40/Ø10) → z plné kulatiny Ø45 × 55", () => {
    // V = π/4·45²·55 = 87 473 mm³ × 7,85 = 0,687 kg
    const e = estimateBlank({ dimensions: "Ø40/Ø10 x 50", materialGroup: "bezna_ocel" });
    expect(e.blankShape).toBe("kulatina");
    expect(e.blankWeightKg).toBeCloseTo(0.687, 3);
    expect(e.allowanceNote).toContain("z plné kulatiny");
  });

  it("hliník Ø100×200: Ø105 × 210 ≈ 4,91 kg (2,70 g/cm³)", () => {
    // V = π/4·105²·210 = 1 818 398 mm³ × 2,70 = 4,910 kg
    const e = estimateBlank({ dimensions: "Ø100x200", materialGroup: "hlinik" });
    expect(e.blankWeightKg).toBeCloseTo(4.91, 2);
    expect(e.description).toContain("hliník 2,70 g/cm³");
  });

  it("mosaz Ø30×40 s hustotou podskupiny 8,5: Ø35 × 45 ≈ 0,368 kg", () => {
    // V = π/4·35²·45 = 43 295 mm³ × 8,5 = 0,368 kg
    const e = estimateBlank({ dimensions: "Ø30x40", materialGroup: "barevne_kovy", density: 8.5, densityLabel: "mosaz" });
    expect(e.blankWeightKg).toBeCloseTo(0.368, 3);
    expect(e.description).toBe("kulatina Ø35 × 45 mm ≈ 0,37 kg, mosaz 8,50 g/cm³");
  });

  it("tenký kotouč Ø200×10 → výpalek z plechu tl. 15 × Ø210 ≈ 4,08 kg", () => {
    // tl. 10 + 3 = 13 → 15; Ø 200 + 10 = 210; V = π/4·210²·15 = 519 541 mm³ × 7,85 = 4,078 kg
    const e = estimateBlank({ dimensions: "Ø200 x 10", materialGroup: "bezna_ocel" });
    expect(e.blankShape).toBe("plech");
    expect(e.blankDims).toEqual({ d: 210, t: 15 });
    expect(e.blankDimsText).toBe("tl. 15 × Ø210");
    expect(e.blankWeightKg).toBeCloseTo(kg(PI4 * 210 ** 2 * 15, 7.85), 3);
  });

  it("slinutý karbid: téměř na čisto (Ø10×50 → Ø11 × 52 ≈ 0,072 kg při 14,5 g/cm³)", () => {
    // V = π/4·11²·52 = 4 941,7 mm³ × 14,5 = 0,0717 kg
    const e = estimateBlank({ dimensions: "Ø10x50", materialGroup: "slinuty_karbid" });
    expect(e.blankDims).toEqual({ d: 11, l: 52 });
    expect(e.blankWeightKg).toBeCloseTo(0.072, 3);
  });

  it("hrubý odhad dílu jen bez hmotnosti na výkresu (Ø65×120: 0,75 obrysu ≈ 2,34 kg)", () => {
    // obrys π/4·65²·120 = 398 197 mm³; × 0,75 × 7,85 = 2,344 kg; rozpětí 0,55–0,9 → 1,719–2,813 kg
    const e = estimateBlank({ dimensions: "Ø65x120", materialGroup: "bezna_ocel" });
    expect(e.partWeightSource).toBe("odhad");
    expect(e.partWeightKg).toBeCloseTo(2.344, 3);
    expect(e.partWeightRangeKg?.[0]).toBeCloseTo(1.719, 3);
    expect(e.partWeightRangeKg?.[1]).toBeCloseTo(2.813, 3);
    expect(e.partDescription).toBe("díl ≈ 2,3 kg (odhad 1,7–2,8 kg)");
    expect(e.utilization).toBeCloseTo(0.6, 2);
  });

  it("hmotnost z výkresu má přednost (zdroj „vykres“)", () => {
    const e = estimateBlank({ dimensions: "Ø65x120", materialGroup: "bezna_ocel", drawingWeightKg: 2.5 });
    expect(e.partWeightKg).toBe(2.5);
    expect(e.partWeightSource).toBe("vykres");
    expect(e.partWeightRangeKg).toBeNull();
    expect(e.partDescription).toBe("díl 2,5 kg (výkres)");
  });

  it("varování: hmotnost z výkresu větší než polotovar / podezřele malá", () => {
    expect(estimateBlank({ dimensions: "Ø65x120", materialGroup: "bezna_ocel", drawingWeightKg: 10 }).warnings.join(" ")).toContain("větší než odhad polotovaru");
    expect(estimateBlank({ dimensions: "Ø65x120", materialGroup: "bezna_ocel", drawingWeightKg: 0.05 }).warnings.join(" ")).toContain("gramy");
  });

  it("jen hmotnost dílu bez rozměrů → polotovar ≈ díl / 0,6", () => {
    const e = estimateBlank({ dimensions: "", materialGroup: "bezna_ocel", drawingWeightKg: 3 });
    expect(e.blankWeightKg).toBe(5);
    expect(e.blankShape).toBeNull();
    expect(e.description).toBe("polotovar ≈ 5,0 kg (odhad z hmotnosti dílu)");
  });

  it("počet kusů → celková hmotnost polotovaru", () => {
    expect(estimateBlank({ dimensions: "Ø65x120", materialGroup: "bezna_ocel", quantity: 4 }).totalBlankWeightKg).toBeCloseTo(15.708, 3); // 3,927 kg × 4
  });

  it("název „Hřídel“ + 120×65×65 → kulatina Ø70 × 130", () => {
    const e = estimateBlank({ dimensions: "120 x 65 x 65", materialGroup: "bezna_ocel", title: "Hřídel" });
    expect(e.blankShape).toBe("kulatina");
    expect(e.blankDims).toEqual({ d: 70, l: 130 });
  });

  it("kulatina bez délky / neurčené rozměry → bez hmotnosti s varováním", () => {
    const a = estimateBlank({ dimensions: "Ø65", materialGroup: "bezna_ocel" });
    expect(a.blankWeightKg).toBeNull();
    expect(a.warnings.join(" ")).toContain("Chybí délka");
    const b = estimateBlank({ dimensions: "65 x 120", materialGroup: "bezna_ocel" });
    expect(b.blankWeightKg).toBeNull();
    expect(b.warnings.join(" ")).toContain("nelze určit tvar");
  });

  it("neurčený materiál → hustota oceli s varováním; obalový kvádr s varováním", () => {
    const e = estimateBlank({ dimensions: "250, 120, 45" });
    expect(e.density).toBe(7.85);
    expect(e.warnings.join(" ")).toContain("Materiál neurčen");
    expect(e.warnings.join(" ")).toContain("obalového kvádru");
  });

  it("formatKg", () => {
    expect([0.005, 0.38, 3.927, 24.94, 125.4].map(formatKg)).toEqual(["0,005", "0,38", "3,9", "24,9", "125"]);
  });
});

describe("analyzeDrawingMaterial — vytěžený výkres → sloupce DB", () => {
  const drawing: DrawingExtract = {
    drawingNumber: "MN-2026-117", revision: "B", title: "Razník", material: "1.2379 (X153CrMoV12)",
    dimensions: "Ø65 h6 x 120", weightKg: 0, generalTolerance: "ISO 2768-mK", tightestTolerance: "h6", surface: "Ra 0,4",
    heatTreatment: "Kalit vakuově 60-62 HRC, 3× popustit", surfaceTreatment: "TiAlN povlak",
    quantity: 4, customerName: "", drawingDate: "2026-10-01", sheet: "1/1", scale: "1:1",
    notes: "Nekótované hrany sražené 0,5x45°. Po kalení brousit funkční plochy.", summary: "", confidence: 0.9, needsClarification: [],
  };

  it("nástrojová ocel, kalení, povlak, polotovar, odhad dílu", () => {
    const a = analyzeDrawingMaterial(drawing);
    expect(a.material.group).toBe("nastrojova_ocel");
    expect(a.columns).toEqual({
      material_group: "nastrojova_ocel",
      material_designation: "1.2379 / X153CrMoV12",
      material_condition: null,
      // díl: π/4·65²·120 · 0,75 · 7,7 g/cm³ = 2,300 kg (odhad)
      weight_kg: 2.3,
      // polotovar: π/4·70²·130 = 500 299 mm³ · 7,7 = 3,852 kg
      blank_weight_kg: 3.852,
      blank_dims: "Ø70 × 130 mm",
      blank_shape: "kulatina",
      heat_treatment: "Kalit vakuově 60-62 HRC, 3× popustit",
      surface_treatment: "TiAlN povlak",
      hardness: "60-62 HRC",
      drawing_notes: "Nekótované hrany sražené 0,5x45°. Po kalení brousit funkční plochy.",
      weight_source: "odhad",
    });
    expect(a.treatments.heat.map((h) => h.kind)).toEqual(["kaleni", "popousteni"]);
    expect(a.treatments.surface.map((s) => s.kind)).toEqual(["povlak", "brouseni_povrchu"]);
    expect(a.blank.totalBlankWeightKg).toBeCloseTo(15.408, 3);
    expect(a.summary).toContain("Nástrojová ocel (1.2379 / X153CrMoV12)");
    expect(a.summary).toContain("kulatina Ø70 × 130 mm ≈ 3,9 kg, nástrojová ocel 7,70 g/cm³");
  });

  it("hmotnost z výkresu → weight_source „vykres“; +QT je stav materiálu, ne operace TZ", () => {
    const a = analyzeDrawingMaterial({ material: "42CrMo4+QT", dimensions: "Ø50x300", weightKg: 4.1, heatTreatment: "", surfaceTreatment: "", notes: "" });
    expect(a.columns.weight_kg).toBe(4.1);
    expect(a.columns.weight_source).toBe("vykres");
    expect(a.columns.material_group).toBe("zuslechtena_ocel");
    expect(a.columns.material_condition).toBe("zušlechtěno (+QT)");
    expect(a.columns.heat_treatment).toBeNull();
    expect(a.columns.drawing_notes).toBeNull();
    expect(a.summary).toContain("stav zušlechtěno (+QT)");
  });

  it("úpravy jen v poznámce se zapíšou normalizovaně", () => {
    const a = analyzeDrawingMaterial({ material: "S235JR", dimensions: "tl. 5, 200 x 150", notes: "Žárově zinkovat. Nekalit." });
    expect(a.columns.surface_treatment).toBe("zinkování (žárové)");
    expect(a.columns.heat_treatment).toBeNull();
    expect(a.columns.blank_shape).toBe("plech");
  });

  it("prázdný výkres → nic nevymýšlí", () => {
    const a = analyzeDrawingMaterial({});
    expect(a.columns).toEqual({
      material_group: null, material_designation: null, material_condition: null, weight_kg: null, blank_weight_kg: null, blank_dims: null,
      blank_shape: null, heat_treatment: null, surface_treatment: null, hardness: null, drawing_notes: null, weight_source: null,
    });
  });

  it("AI skupina jako záloha, když materiál chybí", () => {
    const a = analyzeDrawingMaterial({ material: "", materialGroup: "hlinik", dimensions: "Ø40x100" });
    expect(a.columns.material_group).toBe("hlinik");
    expect(a.blank.density).toBe(2.7);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Opravy po recenzi technologa (čísla nálezů v názvech)
// ═════════════════════════════════════════════════════════════════════════

describe("recenze 1 — hutní zápis s rozměrovou normou ČSN 42 5xxx", () => {
  it("PLO 50 x 20 – 120 ČSN 42 5522 → plochá tyč 120 × 50 × 20 ≈ 0,94 kg (norma není rozměr)", () => {
    // V = 120 · 50 · 20 = 120 000 mm³ × 7,85 = 0,942 kg
    const e = estimateBlank({ dimensions: "PLO 50 x 20 – 120 ČSN 42 5522", materialGroup: "bezna_ocel" });
    expect(e.blankShape).toBe("plocha_tyc");
    expect(e.blankDims).toEqual({ l: 120, w: 50, h: 20 });
    expect(e.blankWeightKg).toBeCloseTo(0.942, 3);
    expect(e.blankGiven).toBe(true);
  });
  it("P 10 – 250 x 400 ČSN 42 5310 → přířez plechu tl. 10 × 250 × 400 ≈ 7,85 kg", () => {
    // V = 10 · 250 · 400 = 1 000 000 mm³ × 7,85 = 7,85 kg
    const e = estimateBlank({ dimensions: "P 10 – 250 x 400 ČSN 42 5310", materialGroup: "bezna_ocel" });
    expect(e.blankShape).toBe("plech");
    expect(e.blankDims).toEqual({ t: 10, l: 400, w: 250 });
    expect(e.blankWeightKg).toBeCloseTo(7.85, 3);
  });
  it.each([
    ["KR 70 ČSN 42 5510 – 130", "kulatina", { d: 70, l: 130 }, kg(PI4 * 70 ** 2 * 130, 7.85)],
    ["6HR 24 ČSN 42 5540 - 50", "sestihran", { s: 24, l: 50 }, kg((Math.sqrt(3) / 2) * 24 ** 2 * 50, 7.85)],
    ["TR Ø60x5 ČSN 42 5715 - 200", "trubka", { d: 60, dInner: 50, l: 200 }, kg(PI4 * (60 ** 2 - 50 ** 2) * 200, 7.85)],
  ])("%s → délka za normou se najde, bez přídavků", (text, shape, dims, w) => {
    const e = estimateBlank({ dimensions: text, materialGroup: "bezna_ocel" });
    expect(e.blankShape).toBe(shape);
    expect(e.blankDims).toEqual(dims);
    expect(e.blankWeightKg).toBeCloseTo(w, 3);
  });
  it("ISO 2768-mK / DIN / EN čísla se neberou jako rozměr", () => {
    expect(parseDimensionText("Ø65 x 120, ISO 2768-mK").dims).toEqual([120, 65]);
    expect(parseDimensionText("KR 50 DIN 1013 - 100")).toEqual(expect.objectContaining({ shape: "kulatina", d: 50, l: 100, blankGiven: true }));
  });
  it("kontrola věrohodnosti: rozměr nad 6 m / hmotnost nad 2 t se nezapisuje, jen varuje", () => {
    const a = estimateBlank({ dimensions: "9000 x 50 x 50", materialGroup: "bezna_ocel" });
    expect(a.blankWeightKg).toBeNull();
    expect(a.blankDimsText).toBeNull();
    expect(a.partWeightKg).toBeNull();
    expect(a.warnings.join(" ")).toContain("nevěrohodné");
    const b = estimateBlank({ dimensions: "3000 x 1500 x 200", materialGroup: "bezna_ocel" });
    expect(b.blankWeightKg).toBeNull();
    expect(b.warnings.join(" ")).toContain("nad 2 t");
  });
});

describe("recenze 2 — holá zkratka materiálu", () => {
  it("„Al“ 120×80×30 → hliník 2,70: plochá tyč 125 × 90 × 35 ≈ 1,06 kg (ne 3,09 kg jako ocel)", () => {
    // V = 125 · 90 · 35 = 393 750 mm³ × 2,70 = 1,063 kg
    const a = analyzeDrawingMaterial({ material: "Al", dimensions: "120 x 80 x 30" });
    expect(a.columns.material_group).toBe("hlinik");
    expect(a.columns.blank_weight_kg).toBeCloseTo(1.063, 3);
    expect(a.blank.warnings.join(" ")).not.toContain("Materiál neurčen");
  });
  it("„Ti“ → titan 4,5 g/cm³", () => {
    expect(analyzeDrawingMaterial({ material: "Ti", dimensions: "Ø30x50" }).blank.density).toBe(4.5);
  });
});

describe("recenze 3 — plech / deska s kótou díry", () => {
  it.each([
    // laser (tl. ≤ 12) okraj 3 mm: 256 → 260, 406 → 410 → 10·260·410 = 1 066 000 mm³ → 8,368 kg
    ["tl. 10 – 250 x 400, 4× Ø12", { t: 10, l: 410, w: 260 }, 8.368],
    // tl. 3: 206 → 210, 306 → 310 → 3·210·310 = 195 300 mm³ → 1,533 kg
    ["Plech tl. 3, 200x300, otvory Ø8", { t: 3, l: 310, w: 210 }, 1.533],
    // tl. 20 plazma okraj 5: 90 × 130 → 20·90·130 = 234 000 mm³ → 1,837 kg
    ["120 x 80, tl. 20, Ø30 H7", { t: 20, l: 130, w: 90 }, 1.837],
  ])("%s → plech, Ø je díra", (text, dims, w) => {
    const e = estimateBlank({ dimensions: text, materialGroup: "bezna_ocel" });
    expect(e.part.shape).toBe("plech");
    expect(e.blankShape).toBe("plech");
    expect(e.blankDims).toEqual(dims);
    expect(e.blankWeightKg).toBeCloseTo(w, 3);
  });
  it("kotouč z plechu „Ø300, tl. 10“ zůstane rotační (bez obrysu obdélníku)", () => {
    expect(parseDimensionText("Ø300, tl. 10")).toEqual(expect.objectContaining({ shape: "kulatina", d: 300, l: 10 }));
  });
});

describe("recenze 4 — rozměr, který už je polotovar, nedostane přídavek podruhé", () => {
  it.each(["polotovar Ø70 x 130", "Ø 70 x 130 (polotovar)", "Rohteil Ø70x130", "KR 70 - 130"])("%s → Ø70 × 130 ≈ 3,93 kg", (text) => {
    // π/4·70²·130 = 500 299 mm³ × 7,85 = 3,927 kg
    const e = estimateBlank({ dimensions: text, materialGroup: "bezna_ocel" });
    expect(e.blankDims).toEqual({ d: 70, l: 130 });
    expect(e.blankWeightKg).toBeCloseTo(3.927, 3);
    expect(e.blankGiven).toBe(true);
    expect(e.partWeightKg).toBeNull(); // obrys dílu neznáme
  });
  it("zvlášť pole blankDimensions: polotovar z něj, hmotnost dílu z rozměrů dílu", () => {
    const e = estimateBlank({ dimensions: "Ø65x120", blankDimensions: "Ø70x130", materialGroup: "bezna_ocel" });
    expect(e.blankDims).toEqual({ d: 70, l: 130 });
    expect(e.partWeightKg).toBeCloseTo(2.344, 3); // 0,75 · π/4·65²·120 · 7,85
    const a = analyzeDrawingMaterial({ material: "C45", dimensions: "Ø60x100", blankDimensions: "KR 65 - 110" });
    expect(a.columns.blank_dims).toBe("Ø65 × 110 mm");
  });
});

describe("recenze 5 — SW na rotačním dílu", () => {
  it("„Ø40 x 80, vnitřní šestihran SW10“ → kulatina Ø45 × 85 ≈ 1,06 kg", () => {
    // 40 + 3 = 43 → 45; 80 + 3 + 2 = 85; π/4·45²·85 = 135 186 mm³ × 7,85 = 1,061 kg
    const e = estimateBlank({ dimensions: "Ø40 x 80, vnitřní šestihran SW10", materialGroup: "bezna_ocel" });
    expect(e.blankShape).toBe("kulatina");
    expect(e.blankDims).toEqual({ d: 45, l: 85 });
    expect(e.blankWeightKg).toBeCloseTo(1.061, 3);
  });
  it("„Ø30 x 60, SW 27“ (klíčové plochy) → kulatina; „SW 17 x 30“ zůstane šestihran", () => {
    expect(parseDimensionText("Ø30 x 60, SW 27")).toEqual(expect.objectContaining({ shape: "kulatina", d: 30, l: 60 }));
    expect(parseDimensionText("Innensechskant SW 8, Ø20x40")).toEqual(expect.objectContaining({ shape: "kulatina", d: 20, l: 40 }));
    expect(parseDimensionText("SW 17 x 30").shape).toBe("sestihran");
  });
});

describe("recenze 6 — příruby a kotouče", () => {
  it("Ø300 × 20 → výpalek tl. 25 × Ø310 ≈ 14,8 kg (ne tyč Ø310 × 40, 23,7 kg)", () => {
    // tl. 20 + 3 = 23 → 25; Ø 310; π/4·310²·25 = 1 886 919 mm³ × 7,85 = 14,812 kg
    const e = estimateBlank({ dimensions: "Ø300 x 20", materialGroup: "bezna_ocel" });
    expect(e.blankShape).toBe("plech");
    expect(e.blankDimsText).toBe("tl. 25 × Ø310");
    expect(e.blankWeightKg).toBeCloseTo(kg(PI4 * 310 ** 2 * 25, 7.85), 3);
    expect(e.description).toContain("výpalek z plechu tl. 25 × Ø310 mm ≈ 14,8 kg");
  });
  it("příruba Ø300/Ø200 × 20 → mezikruží tl. 25 × Ø310/Ø190", () => {
    const e = estimateBlank({ dimensions: "Ø300/Ø200 x 20", materialGroup: "bezna_ocel" });
    expect(e.blankDims).toEqual({ d: 310, dInner: 190, t: 25 });
    expect(e.blankWeightKg).toBeCloseTo(kg(PI4 * (310 ** 2 - 190 ** 2) * 25, 7.85), 3);
  });
  it("upnutí +10 mm jen do Ø80; nad Ø80 krátký díl bez upnutí", () => {
    // Ø60×8: 8 + 2×2,5 + 2 + 10 = 25; Ø120×10: 10 + 2×2,5 + 2 = 17 → 20
    expect(estimateBlank({ dimensions: "Ø60 x 8", materialGroup: "bezna_ocel" }).blankDims).toEqual({ d: 65, l: 25 });
    expect(estimateBlank({ dimensions: "Ø120 x 10", materialGroup: "bezna_ocel" }).blankDims).toEqual({ d: 130, l: 20 });
  });
  it("tyč nad Ø300 → varování (výkovek)", () => {
    expect(estimateBlank({ dimensions: "Ø350 x 400", materialGroup: "bezna_ocel" }).warnings.join(" ")).toContain("neskladuje");
  });
});

describe("recenze 7 — tlustý plech: okraj podle technologie řezu + frézování tloušťky", () => {
  it("tl. 40 – 300 × 400 → plamen okraj 8, tl. 40 + 3 → 45: 45 × 320 × 420 ≈ 47,5 kg (dřív 57,3)", () => {
    // 300 + 16 = 316 → 320; 400 + 16 = 416 → 420; V = 45·320·420 = 6 048 000 mm³ × 7,85 = 47,477 kg
    const e = estimateBlank({ dimensions: "tl. 40 – 300 x 400", materialGroup: "bezna_ocel" });
    expect(e.blankDims).toEqual({ t: 45, l: 420, w: 320 });
    expect(e.blankWeightKg).toBeCloseTo(47.477, 3);
  });
  it("tl. 60 → 65 × 320 × 420 ≈ 68,6 kg (dřív 102,9); tl. 20 plazma okraj 5", () => {
    // 60 + 3 = 63 → 65; 300 + 20 = 320; V = 65·320·420 = 8 736 000 mm³ × 7,85 = 68,578 kg
    expect(estimateBlank({ dimensions: "tl. 60 – 300 x 400", materialGroup: "bezna_ocel" }).blankWeightKg).toBeCloseTo(68.578, 3);
    expect(estimateBlank({ dimensions: "tl. 20 – 200 x 300", materialGroup: "bezna_ocel" }).blankDims).toEqual({ t: 20, l: 310, w: 210 });
  });
});

describe("recenze 8 / 9 — stav dodání materiálu ≠ operace tepelného zpracování", () => {
  it.each([
    ["ČSN 15 142.7", "zušlechtěno na střední pevnost (.7)"],
    ["12 050.6", "zušlechtěno na dolní pevnost (.6)"],
    ["EN AW-6082 T6", "vytvrzeno (T6)"],
    ["16MnCr5+A", "žíháno na měkko (+A)"],
    ["42CrMo4+QT", "zušlechtěno (+QT)"],
    ["C45+N", "normalizačně žíháno (+N)"],
  ])("%s → material_condition, heat_treatment prázdné", (material, cond) => {
    const a = analyzeDrawingMaterial({ material, dimensions: "Ø50x100" });
    expect(a.columns.material_condition).toBe(cond);
    expect(a.columns.heat_treatment).toBeNull();
    expect(a.treatments.heat).toEqual([]);
  });
  it("12 050.6 se přeřadí do zušlechtěných; operace v textu materiálu se zachová", () => {
    expect(analyzeDrawingMaterial({ material: "12 050.6" }).columns.material_group).toBe("zuslechtena_ocel");
    const c = analyzeDrawingMaterial({ material: "16MnCr5 cementovat 0,8 mm" });
    expect(c.columns.heat_treatment).toBe("cementace, hloubka 0,8 mm");
  });
});

describe("recenze 16 — drobnosti v rozměrech", () => {
  it("„D 65 x 120“ → kulatina; „Ø60x5x200“ → trubka Ø60 stěna 5", () => {
    expect(parseDimensionText("D 65 x 120")).toEqual(expect.objectContaining({ shape: "kulatina", d: 65, l: 120 }));
    expect(parseDimensionText("Ø60x5x200")).toEqual(expect.objectContaining({ shape: "trubka", d: 60, dInner: 50, l: 200 }));
  });
});

describe("recenze 15 — přídavek u velkých tyčí nejméně 5 % Ø", () => {
  it("Ø120 → +6 → Ø130 (ne Ø125 se 2,5 mm na stranu)", () => {
    expect(estimateBlank({ dimensions: "Ø120x200", materialGroup: "bezna_ocel" }).blankDims).toEqual({ d: 130, l: 210 });
  });
});

describe("recenze 17 — odlitky", () => {
  it("ocelolitina GS-45 → polotovar = odlitek ≈ díl / 0,85, bez tyče", () => {
    // díl ≈ 250·120·45 · 0,65 · 7,85 = 6,888 kg; / 0,85 = 8,104 kg
    const a = analyzeDrawingMaterial({ material: "GS-45", dimensions: "250x120x45" });
    expect(a.columns.blank_shape).toBe("odlitek");
    expect(a.columns.blank_dims).toBeNull();
    expect(a.columns.weight_kg).toBeCloseTo(6.888, 3);
    expect(a.columns.blank_weight_kg).toBeCloseTo(8.104, 3);
  });
  it("litina + „odlitek“ v názvu a hmotnost z výkresu → 6 / 0,85 = 7,06 kg", () => {
    const a = analyzeDrawingMaterial({ material: "EN-GJS-500-7", dimensions: "250x120x45", title: "Odlitek skříně", weightKg: 6 });
    expect(a.columns.blank_shape).toBe("odlitek");
    expect(a.columns.blank_weight_kg).toBeCloseTo(7.059, 3);
  });
  it("litina bez slova odlitek → kontislitá tyč s varováním", () => {
    const a = analyzeDrawingMaterial({ material: "EN-GJL-250", dimensions: "250x120x45" });
    expect(a.columns.blank_shape).toBe("plocha_tyc"); // 260 × 130 × 50 (kontislitá litina se běžně dodává)
    expect(a.blank.warnings.join(" ")).toContain("odlitek");
  });
});
