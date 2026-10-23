import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { normalizeDrawing } from "./capture-batch";
import {
  cleanHeatStep, dimsTextFromHints, initialSpecState, materialDifference, mergeSpecPatch, missingHardness, recomputeSpecEstimate,
  sanitizeSpecState, specChips, specColumns, specExtractFields, specForMaterial, specSources, specViewFromRow, tubeDimsText,
  type DrawingSpecState,
} from "./drawing-spec";

const FIX = path.join(__dirname, "__fixtures__/capture/batch");
const fixture = (name: string) => normalizeDrawing(JSON.parse(readFileSync(path.join(FIX, `${name}.json`), "utf8")));

const ai = (over: Record<string, unknown> = {}) => normalizeDrawing({
  drawingNumber: "VK-1", title: "Razník", material: "1.2379", dimensions: "Ø32 × 120 mm", confidence: 0.9, ...over,
});

describe("normalizeDrawing — materiál a úpravy z AI", () => {
  it("kroky TZ / PÚ s hodnotami a výslovným stavem", () => {
    const d = fixture("vykres-g18a");
    expect(d.materialGroup).toBe("nastrojova_ocel");
    expect(d.heatStatus).toBe("uvedeno");
    expect(d.heatSteps).toEqual([
      { kind: "kaleni", value: "58±2", unit: "HRC", depthMm: "", note: "vakuově" },
      { kind: "nitridace", value: "700", unit: "HV", depthMm: "0,1", note: "" },
    ]);
    expect(d.surfaceStatus).toBe("uvedeno");
    expect(d.surfaceSteps).toEqual([{ kind: "cerneni", spec: "", thicknessUm: "" }]);
    expect(d.drawingNotes).toHaveLength(4);
    expect(d.overallDims).toEqual([120, 32, 32]);
    expect(d.shapeHint).toBe("kulatina");
  });

  it("„bez“ = výkres přečten a úprava není; chybějící / nečitelné = „nezjisteno“", () => {
    const b = fixture("vykres-g18b");
    expect([b.heatStatus, b.surfaceStatus]).toEqual(["bez", "bez"]);
    expect(b.heatSteps).toEqual([]);
    const n = ai({ heatStatus: "nezjisteno", surfaceStatus: "??" });
    expect([n.heatStatus, n.surfaceStatus]).toEqual(["nezjisteno", "nezjisteno"]);
  });

  it("rozpor: stav „bez“, ale kroky uvedené → uvedeno; „uvedeno“ bez kroků → nezjisteno", () => {
    const d = ai({ heatStatus: "bez", heatSteps: [{ kind: "kaleni", value: "55", unit: "HRC", depthMm: "", note: "" }], surfaceStatus: "uvedeno", surfaceSteps: [] });
    expect(d.heatStatus).toBe("uvedeno");
    expect(d.surfaceStatus).toBe("nezjisteno");
  });

  it("hodnota s jednotkou v textu, desetinná tečka, neznámý druh podle poznámky", () => {
    expect(cleanHeatStep({ kind: "x", value: "62 HRC", unit: "", note: "kalit vakuově" })).toEqual({ kind: "kaleni", value: "62", unit: "HRC", depthMm: "", note: "kalit vakuově" });
    expect(cleanHeatStep({ kind: "nitridace", value: "600 HV1", depthMm: "0.3 mm" })).toEqual({ kind: "nitridace", value: "600", unit: "HV", depthMm: "0,3", note: "HV1" });
    expect(cleanHeatStep({ kind: "neco", value: "1" })).toBeNull();
  });

  it("starší vytěžení bez kroků: rozpozná se z textu TZ / PÚ i z poznámek", () => {
    const legacy = fixture("vykres");
    expect(legacy.heatSteps?.[0]).toMatchObject({ kind: "kaleni", unit: "HRC" });
    const t = normalizeDrawing({ material: "C45", heatTreatment: "kalit 58+2 HRC", surfaceTreatment: "galvanicky zinkováno Fe/Zn 8 µm" });
    expect(t.heatSteps).toEqual([{ kind: "kaleni", value: "58+2", unit: "HRC", depthMm: "", note: "" }]); // zápis jako na výkresu
    expect(t.surfaceSteps?.[0]).toMatchObject({ kind: "galvanicky_zinek", thicknessUm: "8" });
    expect(normalizeDrawing({ heatTreatment: "bez TZ", surfaceTreatment: "bez povrchové úpravy" })).toMatchObject({ heatStatus: "bez", surfaceStatus: "bez" });
    expect(normalizeDrawing({ material: "C45" })).toMatchObject({ heatStatus: "nezjisteno", surfaceStatus: "nezjisteno" });
    const fromNotes = normalizeDrawing({ material: "16MnCr5", notes: "Cementovat Eht 0,8+0,3; kalit 58-62 HRC; černit" });
    expect(fromNotes.heatSteps?.map((s) => s.kind)).toEqual(["cementace", "kaleni"]);
    expect(fromNotes.surfaceSteps?.map((s) => s.kind)).toEqual(["cerneni"]);
    expect(fromNotes.drawingNotes).toEqual(["Cementovat Eht 0,8+0,3", "kalit 58-62 HRC", "černit"]);
  });

  it("skupina materiálu: jednoznačné označení má přednost, AI je záloha", () => {
    expect(ai({ materialGroup: "" }).materialGroup).toBe("nastrojova_ocel");
    expect(ai({ materialGroup: "hlinik" }).materialGroup).toBe("nastrojova_ocel");
    expect(ai({ material: "", materialGroup: "nerez" }).materialGroup).toBe("nerez");
    expect(ai({ material: "42CrMo4+QT", materialGroup: "" }).materialGroup).toBe("zuslechtena_ocel");
    expect(ai({ material: "", materialGroup: "" }).materialGroup).toBe("");
  });
});

describe("initialSpecState / odhad polotovaru", () => {
  it("rotační díl z 1.2379: polotovar kulatina ≈ odhad, hmotnost dílu odhad", () => {
    const d = fixture("vykres-g18a");
    const s = initialSpecState(d, { aiUsed: true });
    expect(s.blankShape).toBe("kulatina");
    expect(s.blankDims).toMatch(/^Ø\d+ × \d+ mm$/);
    expect(Number(s.blankWeightKg.replace(",", "."))).toBeGreaterThan(0.8);
    expect(s.weightSource).toBe("odhad");
    expect(s.heatSteps).toHaveLength(2);
    expect(s.notes.split("\n")).toHaveLength(4);
    expect(s.manual).toEqual([]);
  });

  it("hmotnost z výkresu zůstává „z výkresu“, deska → plochá tyč / přířez", () => {
    const s = initialSpecState(fixture("vykres-g18b"), { aiUsed: true });
    expect([s.weightKg, s.weightSource]).toEqual(["2,6", "vykres"]);
    expect(["plocha_tyc", "prirez"]).toContain(s.blankShape);
    expect([s.heatStatus, s.surfaceStatus]).toEqual(["bez", "bez"]);
  });

  it("bez AI: vše „Nezjištěno — doplň“", () => {
    const s = initialSpecState(fixture("vykres-g18a"), { aiUsed: false });
    expect(s.heatStatus).toBe("uvedeno"); // kroky přišly z výkresu (fixture), stav podle nich
    const empty = initialSpecState({ material: "", dimensions: "", weightKg: 0, heatTreatment: "", surfaceTreatment: "", notes: "", title: "", quantity: 0 }, { aiUsed: false });
    expect([empty.heatStatus, empty.surfaceStatus, empty.materialGroup, empty.blankWeightKg]).toEqual(["nezjisteno", "nezjisteno", "", ""]);
  });

  it("rozměry ze 3 největších a tvaru", () => {
    expect(dimsTextFromHints([120, 32, 32], "kulatina")).toBe("Ø32 x 120");
    expect(dimsTextFromHints([310, 310, 25], "kulatina")).toBe("Ø310 x 25");
    expect(dimsTextFromHints([400, 250, 10], "plech")).toBe("tl. 10 x 250 x 400");
    expect(dimsTextFromHints([125, 90, 30], "")).toBe("125 x 90 x 30");
    const d = normalizeDrawing({ material: "C45", dimensions: "", overallDims: [32, 120, 32], shapeHint: "kulatina", title: "Čep" });
    expect(initialSpecState(d, { aiUsed: true }).blankShape).toBe("kulatina");
  });

  it("změna skupiny mění hustotu; ručně upravený polotovar se nepřepočítá", () => {
    const d = fixture("vykres-g18b");
    const s = initialSpecState(d, { aiUsed: true });
    const ctx = { material: d.material, dimensions: d.dimensions, title: d.title, quantity: "" };
    const alu = recomputeSpecEstimate({ ...s, materialGroup: "hlinik" }, ctx);
    expect(Number(alu.blankWeightKg.replace(",", "."))).toBeLessThan(Number(s.blankWeightKg.replace(",", ".")) / 2);
    const manual = recomputeSpecEstimate({ ...s, materialGroup: "hlinik", blankWeightKg: "9", manual: ["blank"] }, ctx);
    expect(manual.blankWeightKg).toBe("9");
  });
});

describe("sanitizeSpecState", () => {
  it("chybí = null (platí návrh AI), neplatná hmotnost = chyba, kroky uklizené", () => {
    expect(sanitizeSpecState(undefined)).toBeNull();
    expect(sanitizeSpecState({ weightKg: "abc" })).toBe("Výkres: neplatná hmotnost dílu.");
    const s = sanitizeSpecState({
      materialGroup: "xx", weightKg: "1,5", heatStatus: "uvedeno", heatSteps: [{ kind: "kaleni", value: "55", unit: "hrc" }, { kind: "zzz" }],
      surfaceStatus: "uvedeno", surfaceSteps: [], notes: " a \r\n\r\n b ", manual: ["heat", "heat", "x"],
    }) as DrawingSpecState;
    expect(s.materialGroup).toBe("");
    expect([s.weightKg, s.weightSource]).toEqual(["1,5", "rucne"]);
    expect(s.heatSteps).toEqual([{ kind: "kaleni", value: "55", unit: "HRC", depthMm: "", note: "" }]);
    expect(s.surfaceStatus).toBe("nezjisteno");
    expect(s.notes).toBe("a\nb");
    expect(s.manual).toEqual(["heat"]);
  });
});

describe("sloupce, zdroje a pravidlo nepřepisování", () => {
  const spec = initialSpecState(fixture("vykres-g18a"), { aiUsed: true });
  const cols = specColumns(spec, "1.2379");

  it("specColumns", () => {
    expect(cols).toMatchObject({
      material_group: "nastrojova_ocel", material_designation: "1.2379", heat_status: "uvedeno", surface_status: "uvedeno",
      heat_treatment: "kalení 58±2 HRC (vakuově); nitridace 700 HV, hloubka 0,1 mm", surface_treatment: "černění",
      hardness: "58±2 HRC", weight_source: "odhad", blank_shape: "kulatina",
    });
    expect(cols.drawing_notes?.split("\n")).toHaveLength(4);
    const bez = specColumns(initialSpecState(fixture("vykres-g18b"), { aiUsed: true }), "S235JR");
    expect(bez).toMatchObject({ heat_status: "bez", heat_steps: null, heat_treatment: null, surface_status: "bez", weight_kg: 2.6, weight_source: "vykres" });
    expect(specExtractFields(bez)).toMatchObject({ heatStatus: "bez", surfaceStatus: "bez", weightKg: 2.6, drawingNotes: ["Obecné tolerance ISO 2768-m", "Odjehlit"] });
  });

  it("zdroje: ruční sekce, ruční hmotnost, změněný materiál", () => {
    expect(specSources(spec, false)).toMatchObject({ heat: "ai", weight: "ai", material_designation: "ai" });
    const s = specSources({ ...spec, manual: ["heat"], weightSource: "rucne" }, true);
    expect(s).toMatchObject({ heat: "rucne", weight: "rucne", material_designation: "rucne", surface: "ai" });
  });

  it("prázdný řádek se doplní celý, se zdroji", () => {
    const m = mergeSpecPatch({}, cols, specSources(spec, false));
    expect(m.patch).toMatchObject({ material_group: "nastrojova_ocel", heat_status: "uvedeno", surface_treatment: "černění" });
    expect(m.patch.spec_sources).toMatchObject({ heat: "ai", surface: "ai", blank: "ai" });
    expect(m.kept).toEqual([]);
  });

  it("AI hodnota se nahradí, ruční zůstane (nahradí ji jen nová ruční)", () => {
    const row = {
      material_group: "bezna_ocel", heat_status: "bez", heat_steps: null, heat_treatment: null,
      surface_status: "uvedeno", surface_steps: [{ kind: "zinkovani", spec: "", thicknessUm: "" }], surface_treatment: "zinkování",
      weight_kg: 5, weight_source: "rucne",
      spec_sources: { material_group: "ai", heat: "rucne", surface: "ai", weight: "rucne" },
    };
    const m = mergeSpecPatch(row, cols, specSources(spec, false));
    expect(m.patch.material_group).toBe("nastrojova_ocel");
    expect(m.patch.surface_treatment).toBe("černění");
    expect(m.patch).not.toHaveProperty("heat_status");
    expect(m.patch).not.toHaveProperty("weight_kg");
    expect(m.kept.sort()).toEqual(["heat", "weight"]);
    const human = mergeSpecPatch(row, cols, specSources({ ...spec, manual: ["heat"] }, false));
    expect(human.patch.heat_status).toBe("uvedeno");
    expect((human.patch.spec_sources as Record<string, string>).heat).toBe("rucne");
  });

  it("starší vyplněná hodnota bez zdroje = ruční; prázdné nové hodnoty nic nemažou", () => {
    const m = mergeSpecPatch({ heat_treatment: "kalit 60 HRC", material_group: null }, cols, specSources(spec, false));
    expect(m.patch).not.toHaveProperty("heat_treatment");
    expect(m.kept).toContain("heat");
    const empty = specColumns({ ...spec, materialGroup: "", heatSteps: [], heatStatus: "nezjisteno", notes: "" }, "");
    const keep = mergeSpecPatch({ material_group: "nerez", heat_status: "bez", drawing_notes: "x", spec_sources: { material_group: "ai", heat: "ai", notes: "ai" } }, empty, {});
    expect(keep.patch).not.toHaveProperty("material_group");
    expect(keep.patch).not.toHaveProperty("heat_status");
    expect(keep.patch).not.toHaveProperty("drawing_notes");
  });

  it("„nezjištěno“ doplní jen prázdnou úpravu", () => {
    const empty = specColumns({ ...spec, heatSteps: [], heatStatus: "nezjisteno", surfaceSteps: [], surfaceStatus: "nezjisteno" }, "");
    expect(mergeSpecPatch({}, empty, {}).patch).toMatchObject({ heat_status: "nezjisteno", surface_status: "nezjisteno" });
    expect(mergeSpecPatch({ heat_status: "bez", spec_sources: { heat: "ai" } }, empty, {}).patch).not.toHaveProperty("heat_status");
  });

  it("stejné hodnoty: žádná změna řádku", () => {
    const first = mergeSpecPatch({}, cols, specSources(spec, false)).patch;
    expect(mergeSpecPatch(first, cols, specSources(spec, false)).patch).toEqual({});
  });
});

describe("štítky (specChips)", () => {
  const view = (over: Record<string, unknown>) => specViewFromRow({ ...over });

  it("skupina, polotovar, kroky TZ a PÚ", () => {
    const spec = initialSpecState(fixture("vykres-g18a"), { aiUsed: true });
    const row = mergeSpecPatch({}, specColumns(spec, "1.2379"), {}).patch;
    const chips = specChips(specViewFromRow(row));
    expect(chips.map((c) => c.label)).toEqual([
      "Nástr. ocel", expect.stringMatching(/^≈ \d+,\d+ kg\/ks polotovar$/), "Kaleno 58±2 HRC", "Nitridace 700 HV, 0,1 mm", "Černění",
    ]);
    expect(chips[0].title).toContain("Nástrojová ocel");
  });

  it("hmotnost z výkresu, bez TZ / bez PÚ tlumeně, nezjištěno oranžově", () => {
    const chips = specChips(view({ material_group: "bezna_ocel", weight_kg: 2.6, weight_source: "vykres", heat_status: "bez", surface_status: "nezjisteno" }));
    expect(chips.map((c) => [c.label, c.tone])).toEqual([
      ["Ocel", "group"], ["2,6 kg díl", "weight"], ["bez TZ", "none"], ["PÚ nezjištěno", "unknown"],
    ]);
    expect(chips.find((c) => c.tone === "unknown")?.className).toContain("amber");
  });

  it("odhad hmotnosti dílu bez polotovaru = „≈ X kg díl“; s polotovarem jen polotovar (na 1 ks)", () => {
    expect(specChips(view({ weight_kg: 0.5, weight_source: "odhad" })).map((c) => c.label)).toEqual(["≈ 0,50 kg díl"]);
    expect(specChips(view({ weight_kg: 0.5, weight_source: "odhad", blank_weight_kg: 0.9 })).map((c) => c.label)).toEqual(["≈ 0,90 kg/ks polotovar (ocel?)"]);
  });

  it("starší řádek jen s textem úprav; prázdný řádek nic; compact = jen skupina", () => {
    expect(specChips(view({ heat_treatment: "Kalit na 55 HRC", surface_treatment: "zinkovat" })).map((c) => c.label)).toEqual(["Kaleno 55 HRC", "Zinkování"]);
    expect(specViewFromRow({ material: "C45" })).toBeNull();
    expect(specChips(null)).toEqual([]);
    expect(specChips(view({ material_group: "nerez", heat_status: "bez" }), { compact: true }).map((c) => c.label)).toEqual(["Nerez"]);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Opravy po kontrole Kroku B (doménová + správnost)
// ═════════════════════════════════════════════════════════════════════════

describe("záloha z textu: pole TZ + PÚ spolu, poznámky, výslovné „bez“", () => {
  const kinds = (d: ReturnType<typeof normalizeDrawing>) => [d.heatStatus, (d.heatSteps ?? []).map((s) => s.kind), d.surfaceStatus, (d.surfaceSteps ?? []).map((s) => s.kind)];

  it("úprava zapsaná do „špatného“ pole se neztratí", () => {
    expect(kinds(normalizeDrawing({ material: "C45", surfaceTreatment: "nitridovat 700 HV, černit" }))).toEqual(["uvedeno", ["nitridace"], "uvedeno", ["cerneni"]]);
    expect(kinds(normalizeDrawing({ material: "C45", heatTreatment: "kalit 58 HRC, černit" }))).toEqual(["uvedeno", ["kaleni"], "uvedeno", ["cerneni"]]);
    expect(kinds(normalizeDrawing({ material: "C45", surfaceTreatment: "kaleno 55 HRC, zinkováno" }))).toEqual(["uvedeno", ["kaleni"], "uvedeno", ["zinkovani"]]);
    expect(kinds(normalizeDrawing({ material: "C45", surfaceTreatment: "nitridováno" }))).toEqual(["uvedeno", ["nitridace"], "nezjisteno", []]);
  });

  it("„Bez povrchové úpravy“ / „TZ: žádné“ v poznámkách nebo poli = „bez“", () => {
    expect(normalizeDrawing({ material: "C45", notes: "Odjehlit; Bez povrchové úpravy" }).surfaceStatus).toBe("bez");
    expect(normalizeDrawing({ material: "C45", notes: "TZ: žádné" }).heatStatus).toBe("bez");
    expect(normalizeDrawing({ material: "C45", heatTreatment: "žádné", surfaceTreatment: "none" })).toMatchObject({ heatStatus: "bez", surfaceStatus: "bez" });
  });

  it("zápis tvrdosti jako na výkresu („58±2“, ne „56-60“); „fosfátovat Zn“ není galvanický zinek", () => {
    const d = normalizeDrawing({ material: "1.2379", heatTreatment: "kaleno 58±2 HRC, nitridováno 700 HV", surfaceTreatment: "fosfátovat Zn" });
    expect(d.heatSteps?.map((s) => [s.kind, s.value, s.unit])).toEqual([["kaleni", "58±2", "HRC"], ["nitridace", "700", "HV"]]);
    expect(d.surfaceSteps?.map((s) => s.kind)).toEqual(["fosfatovani"]);
    expect(specChips(specViewFromRow({ material_group: "bezna_ocel", surface_status: "uvedeno", surface_steps: d.surfaceSteps })).map((c) => c.label)).toContain("Fosfát Zn");
    expect(normalizeDrawing({ heatTreatment: "min. 55 HRC" }).heatSteps?.[0]).toMatchObject({ value: "min. 55", unit: "HRC" });
    // starší řádek jen s textem: štítek drží zápis výkresu
    expect(specChips(specViewFromRow({ heat_treatment: "kalit 58±2 HRC" })).map((c) => c.label)).toEqual(["Kaleno 58±2 HRC"]);
  });

  it("AI „bez TZ“ × kalení v poznámkách → „nezjištěno“ + dotaz, nižší jistota (kontrola se otevře)", () => {
    const d = normalizeDrawing({ material: "C45", heatStatus: "bez", surfaceStatus: "bez", drawingNotes: ["Kalit 58 HRC"], confidence: 0.95 });
    expect(d.heatStatus).toBe("nezjisteno");
    expect(d.heatSteps).toEqual([]);
    expect(d.surfaceStatus).toBe("bez");
    expect(d.needsClarification.some((t) => /bez TZ.*kalení 58 HRC/.test(t))).toBe(true);
    expect(d.confidence).toBeLessThanOrEqual(0.8);
    const weld = normalizeDrawing({ material: "S235JR", heatStatus: "bez", drawingNotes: ["Svařit, žíhat ke snížení pnutí"] });
    expect(weld.heatStatus).toBe("nezjisteno");
    // stav dodání materiálu v poznámkách (+QT) není rozpor
    const qt = normalizeDrawing({ material: "42CrMo4+QT", heatStatus: "bez", drawingNotes: ["Materiál 42CrMo4+QT"], confidence: 0.95 });
    expect([qt.heatStatus, qt.needsClarification, qt.confidence]).toEqual(["bez", [], 0.95]);
  });

  it("volný text stavu: nejistota ≠ „bez“", () => {
    for (const s of ["not readable", "not legible", "unclear", "n/a"]) expect(normalizeDrawing({ heatStatus: s }).heatStatus).toBe("nezjisteno");
    expect(normalizeDrawing({ heatStatus: "normal" }).heatStatus).toBe("nezjisteno");
    for (const s of ["none", "no", "žádné", "bez TZ"]) expect(normalizeDrawing({ heatStatus: s }).heatStatus).toBe("bez");
  });

  it("rozměry s jednotkou, hmotnost v gramech / tunách", () => {
    expect(normalizeDrawing({ overallDims: ["120,5", "80 mm", 30] }).overallDims).toEqual([120.5, 80, 30]);
    expect(normalizeDrawing({ weightKg: "930 g" }).weightKg).toBe(0.93);
    expect(normalizeDrawing({ weightKg: "1,2 t" }).weightKg).toBe(1200);
    expect(normalizeDrawing({ weightKg: "2,6 kg" }).weightKg).toBe(2.6);
  });
});

describe("materiál: označení doslova, další skupiny, rozdíl objednávka × výkres", () => {
  const spec = initialSpecState(fixture("vykres-g18a"), { aiUsed: true });

  it("material_designation = text z výkresu", () => {
    expect(specColumns(spec, "Docol 1200M").material_designation).toBe("Docol 1200M");
    expect(specColumns(spec, "ČSN 41 9436").material_designation).toBe("ČSN 41 9436");
  });

  it("přesné trubky E235+N / E355 a ETG 100 = běžná ocel", () => {
    expect(ai({ material: "E355+SR", materialGroup: "" }).materialGroup).toBe("bezna_ocel");
    expect(ai({ material: "E235+N", materialGroup: "" }).materialGroup).toBe("bezna_ocel");
    expect(ai({ material: "ETG 100", materialGroup: "" }).materialGroup).toBe("bezna_ocel");
  });

  it("materialDifference / specForMaterial: platí objednávka", () => {
    expect(materialDifference("42CrMo4", "C45")).toBe("group");
    expect(materialDifference("42CrMo4", "42CrMo4+QT")).toBeNull();
    expect(materialDifference("1.2379", " 1.2379 ")).toBeNull();
    expect(materialDifference("", "C45")).toBeNull();
    expect(materialDifference("S235JR", "11 373")).toBe("sameGroup");
    const s = initialSpecState(normalizeDrawing({ material: "C45", dimensions: "Ø40 x 100", heatStatus: "bez", surfaceStatus: "bez" }), { aiUsed: true });
    const al = specForMaterial(s, "EN AW-6082", { dimensions: "Ø40 x 100", title: "", quantity: "" });
    expect(al.materialGroup).toBe("hlinik");
    expect(Number(al.blankWeightKg.replace(",", "."))).toBeLessThan(Number(s.blankWeightKg.replace(",", ".")) / 2);
    expect(specForMaterial({ ...s, manual: ["material_group"] }, "EN AW-6082", { dimensions: "Ø40 x 100", title: "", quantity: "" }).materialGroup).toBe("bezna_ocel");
  });

  it("trubka podle AI: „Ø60 x Ø40 x 100“ není plná kulatina", () => {
    expect(tubeDimsText("Ø60 x Ø40 x 100", "trubka")).toBe("Ø60/Ø40 x 100");
    expect(tubeDimsText("Ø60 x Ø40 x 100", "kulatina")).toBe("Ø60 x Ø40 x 100");
    const full = initialSpecState(normalizeDrawing({ material: "C45", dimensions: "Ø60 x Ø40 x 100" }), { aiUsed: true });
    const tube = initialSpecState(normalizeDrawing({ material: "C45", dimensions: "Ø60 x Ø40 x 100", shapeHint: "trubka" }), { aiUsed: true });
    expect(tube.blankShape).toBe("trubka");
    expect(Number(tube.blankWeightKg.replace(",", "."))).toBeLessThan(Number(full.blankWeightKg.replace(",", ".")) * 0.8);
  });
});

describe("mergeSpecPatch: revize, odhad hmotnosti, pořadí klíčů jsonb, ruční „Nezjištěno“", () => {
  const spec = initialSpecState(fixture("vykres-g18a"), { aiUsed: true });
  const cols = specColumns(spec, "1.2379");
  const aiRow = () => ({ ...mergeSpecPatch({}, cols, specSources(spec, false)).patch });

  it("starší revize (fillOnly): AI hodnoty novější revize zůstávají, prázdné se doplní", () => {
    const rowB = { ...aiRow(), drawing_notes: null };
    const older = specColumns({ ...spec, heatSteps: [], heatStatus: "bez", surfaceSteps: [], surfaceStatus: "bez" }, "1.2379");
    const m = mergeSpecPatch(rowB, older, specSources(spec, false), { fillOnly: true });
    expect(m.patch).not.toHaveProperty("heat_status");
    expect(m.patch).not.toHaveProperty("surface_status");
    expect(m.patch.drawing_notes).toBe(cols.drawing_notes);
    expect(m.changed).toEqual(["notes"]);
    // ruční úprava v kontrole platí i pro starší revizi
    expect(mergeSpecPatch(rowB, older, { heat: "rucne" }, { fillOnly: true }).patch.heat_status).toBe("bez");
  });

  it("odhad hmotnosti nenahradí hmotnost z výkresu (ani AI-zdrojovou)", () => {
    const row = { weight_kg: 2.6, weight_source: "vykres", spec_sources: { weight: "ai" } };
    const est = specColumns({ ...spec, weightKg: "1,837", weightSource: "odhad" }, "1.2379");
    expect(mergeSpecPatch(row, est, {}).patch).not.toHaveProperty("weight_kg");
    // novější odhad nahradí starší odhad; ruční zadání nahradí cokoli
    expect(mergeSpecPatch({ weight_kg: 1, weight_source: "odhad", spec_sources: { weight: "ai" } }, est, {}).patch.weight_kg).toBe(1.837);
    expect(mergeSpecPatch(row, specColumns({ ...spec, weightKg: "3", weightSource: "rucne" }, ""), { weight: "rucne" }).patch.weight_kg).toBe(3);
  });

  it("jsonb vrátí klíče kroků v jiném pořadí → stejné hodnoty = žádná změna ani „zůstalo ručně“", () => {
    const first = aiRow();
    const dbOrder = (steps: unknown) => (steps as Record<string, unknown>[]).map((s) => Object.fromEntries(Object.keys(s).sort().map((k) => [k, s[k]])));
    const fromDb = { ...first, heat_steps: dbOrder(first.heat_steps), surface_steps: dbOrder(first.surface_steps) };
    expect(mergeSpecPatch(fromDb, cols, specSources(spec, false))).toEqual({ patch: {}, changed: [], kept: [] });
    const manual = { ...fromDb, spec_sources: { ...(first.spec_sources as object), heat: "rucne" } };
    expect(mergeSpecPatch(manual, cols, specSources(spec, false)).kept).toEqual([]);
  });

  it("ruční „Nezjištěno“ / smazaná hmotnost smaže hodnotu z AI (ruční hodnotu ne)", () => {
    const row = aiRow();
    const cleared = specColumns({ ...spec, heatSteps: [], heatStatus: "nezjisteno", weightKg: "", weightSource: "", manual: ["heat", "weight"] }, "1.2379");
    const src = specSources({ ...spec, manual: ["heat", "weight"] }, false);
    const m = mergeSpecPatch(row, cleared, src);
    expect(m.patch).toMatchObject({ heat_status: "nezjisteno", heat_steps: null, heat_treatment: null, hardness: null, weight_kg: null, weight_source: null });
    expect(m.changed.sort()).toEqual(["heat", "weight"]);
    expect((m.patch.spec_sources as Record<string, string>).heat).toBe("rucne");
    // bez ručního zásahu prázdné nic nemaže; ruční hodnotu „nezjištěno“ z AI nesmaže
    expect(mergeSpecPatch(row, cleared, {}).patch).not.toHaveProperty("heat_status");
    const human = { ...row, spec_sources: { ...(row.spec_sources as object), heat: "rucne" } };
    expect(mergeSpecPatch(human, cleared, src).patch).not.toHaveProperty("heat_steps");
  });

  it("job_files.weightKg = jen uvedená hmotnost (odhad zvlášť)", () => {
    expect(specExtractFields(cols)).toMatchObject({ weightKg: 0, weightSource: "odhad", partWeightSource: "odhad" });
    expect((specExtractFields(cols).partWeightKg as number) > 0).toBe(true);
    const stated = specColumns({ ...spec, weightKg: "2,6", weightSource: "vykres" }, "1.2379");
    expect(specExtractFields(stated)).toMatchObject({ weightKg: 2.6, partWeightKg: 2.6 });
  });
});

describe("štítky: detaily, které mění cenu; chybějící tvrdost; neznámý materiál", () => {
  const view = (over: Record<string, unknown>) => specViewFromRow({ material_group: "bezna_ocel", heat_status: "uvedeno", surface_status: "uvedeno", ...over });
  const labels = (over: Record<string, unknown>) => specChips(view(over)).map((c) => c.label);

  it("hloubka vrstvy i vedle tvrdosti; tvrdý elox, DLC, RAL, fosfát Mn", () => {
    expect(labels({ heat_steps: [{ kind: "cementace", value: "58", unit: "HRC", depthMm: "0,8", note: "" }] })).toContain("Cementováno 58 HRC, 0,8 mm");
    expect(labels({ heat_steps: [{ kind: "nitridace", value: "700", unit: "HV", depthMm: "0,3", note: "" }] })).toContain("Nitridace 700 HV, 0,3 mm");
    expect(labels({ heat_steps: [{ kind: "kaleni", value: "58", unit: "HRC", depthMm: "2", note: "" }] })).toContain("Kaleno 58 HRC");
    expect(labels({ surface_steps: [{ kind: "eloxovani", spec: "tvrdý, černý", thicknessUm: "50" }] })).toContain("Tvrdý elox 50 µm");
    expect(labels({ surface_steps: [{ kind: "povlak", spec: "DLC", thicknessUm: "" }] })).toContain("DLC");
    expect(labels({ surface_steps: [{ kind: "praskove_lakovani", spec: "RAL 9005", thicknessUm: "" }] })).toContain("Práškový lak RAL 9005");
    expect(labels({ surface_steps: [{ kind: "fosfatovani", spec: "manganový", thicknessUm: "" }] })).toContain("Fosfát Mn");
  });

  it("kalení bez hodnoty: „Kaleno ? HRC“ oranžově, missingHardness", () => {
    const chips = specChips(view({ heat_steps: [{ kind: "kaleni", value: "", unit: "", depthMm: "", note: "" }] }));
    const k = chips.find((c) => c.key === "heat-0");
    expect([k?.label, k?.tone]).toEqual(["Kaleno ? HRC", "unknown"]);
    expect(k?.className).toContain("amber");
    expect(missingHardness([{ kind: "kaleni", value: "" }])).toBe(true);
    expect(missingHardness([{ kind: "nitridace", value: "" }, { kind: "kaleni", value: "58" }])).toBe(false);
  });

  it("neznámý materiál: „Materiál ?“ a polotovar „(ocel?)“; stav dodání +QT u skupiny", () => {
    const u = specChips(specViewFromRow({ heat_status: "bez", surface_status: "bez", blank_weight_kg: 1.1 })).map((c) => c.label);
    expect(u[0]).toBe("Materiál ?");
    expect(u[1]).toMatch(/^≈ 1,1\d? kg\/ks polotovar \(ocel\?\)$/);
    expect(labels({ material_group: "zuslechtena_ocel", material_condition: "zušlechtěno (+QT)", heat_status: "bez" })[0]).toMatch(/\+QT$/);
  });
});
