/** Report porovnání s referencí (compare-report.ts): seznam oblastí, popisy, text a CSV – bez jádra. */
import { describe, expect, it } from "vitest";
import type { CompareResult, DiffRegion } from "./compare";
import { alignText, compareReportCsv, compareReportText, fmt, regionHint, regionList, sideText, surfacesText } from "./compare-report";
import { clearMissing, missingKeys, setLang } from "./i18n";

const region = (side: DiffRegion["side"], volume: number, center: [number, number, number], surfaces: DiffRegion["surfaces"]): DiffRegion => ({
  side,
  volume,
  area: 100,
  bbox: [
    [center[0] - 5, center[1] - 5, center[2] - 2],
    [center[0] + 5, center[1] + 5, center[2] + 2],
  ],
  size: [10, 10, 4],
  center,
  centroid: center,
  faces: 3,
  surfaces,
});

const groove = region("extra", 123_393.75, [0, 0, -6.7], [{ kind: "torus", R: 195.35, r: 8, n: 1 }, { kind: "plane", n: 1 }]);
const holes = Array.from({ length: 3 }, (_, i) => region("missing", 7_600 + i, [62.6, i * 10, 0], [{ kind: "cylinder", r: 6.5, n: 1 }, { kind: "plane", n: 2 }]));

const res = (): CompareResult => ({
  model: { volume: 4_338_095, area: 451_343, bbox: [[-210, -210, -55.59], [210, 210, 113]], faces: 120, solids: 1 },
  reference: { volume: 4_336_000, area: 450_000, bbox: [[-210, -210, -55.59], [210, 210, 113]], faces: 110, solids: 1, valid: true, format: "step", fileName: "604200001.stp" },
  transform: { rot: [0, 0, 0], m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0], mode: "none", identity: true },
  volumeDiff: 2_095,
  extra: { volume: 123_393.75 + 0.4, regions: [groove], more: { count: 0, volume: 0 }, noise: { count: 1, volume: 0.4 }, ms: 10 },
  missing: { volume: 22_803, regions: holes, more: { count: 2, volume: 0.6 }, noise: { count: 0, volume: 0 }, ms: 10 },
  residual: 0.01,
  map: {
    mesh: { vertices: new Float32Array(0), normals: new Float32Array(0), triangles: new Uint32Array(0), faceGroups: new Int32Array(0), lines: new Float32Array(0), edgeGroups: new Int32Array(0) },
    distances: new Float32Array(0),
    stats: { count: 10, max: 28.9, maxOut: 8, maxIn: -28.9, mean: 1, rms: 2, within: 0.8, withinArea: 0.874, area: 451_343, worst: 3 },
    meshTolerance: 0.025,
    accuracy: 0.05,
    step: 3,
    capped: false,
    refTriangles: 1000,
  },
  ghost: null,
  warnings: ["Pozor; test \"uvozovek\""],
  ms: { import: 1, align: 1, reference: 1, booleans: 1, map: 1, total: 5 },
});

describe("report porovnání s referencí", () => {
  it("regionList: obě strany v jednom seznamu od největší, čísla od 1", () => {
    const list = regionList(res());
    expect(list.map((g) => g.n)).toEqual([1, 2, 3, 4]);
    expect(list[0].side).toBe("extra");
    expect(list.slice(1).map((g) => g.volume)).toEqual([7_602, 7_601, 7_600]);
    expect(regionList({ extra: null, missing: null })).toEqual([]);
  });

  it("popisy: plochy, strana a význam oblasti", () => {
    expect(surfacesText(groove.surfaces)).toBe("anuloid R195,35/r8,00 · rovina");
    expect(surfacesText(holes[0].surfaces)).toBe("válec Ø13,00 · 2× rovina");
    expect(surfacesText([{ kind: "sphere", r: 2, n: 1 }, { kind: "cone", n: 3 }, { kind: "other", n: 1 }])).toBe("koule Ø4,00 · 3× kužel · obecná plocha");
    expect(sideText("extra")).toBe("navíc v modelu");
    expect(sideText("missing")).toBe("chybí v modelu");
    expect(regionHint(groove)).toBe("v modelu chybí drážka / zápich R8,00");
    expect(regionHint(holes[0])).toMatch(/model má navíc díru \/ vybrání Ø13,00/);
    expect(regionHint(region("extra", 1, [0, 0, 0], [{ kind: "plane", n: 6 }]))).toMatch(/chybí vybrání/);
    expect(regionHint(region("missing", 1, [0, 0, 0], [{ kind: "plane", n: 6 }]))).toMatch(/výstupek/);
  });

  it("fmt: desetinná čárka, bez záporné nuly", () => {
    expect(fmt(1.23456, 3)).toBe("1,235");
    expect(fmt(-0.0001, 2)).toBe("0,00");
    expect(fmt(-2.5, 1)).toBe("-2,5");
    expect(fmt(NaN, 1)).toBe("");
  });

  it("alignText: režim, otočení a posun", () => {
    expect(alignText(res())).toBe("jak je v souboru – bez přesunu");
    const t = { rot: [270, 0, 0] as [number, number, number], m: [], t: [0, 50, -30] as [number, number, number], mode: "center" as const, identity: false };
    expect(alignText({ transform: t })).toBe("středy obalových kvádrů, otočení X 270° Y 0° Z 0°, posun 0,000 / 50,000 / -30,000 mm");
  });

  it("CSV: BOM, oddělovač ;, desetinná čárka, uvozovky, tabulka oblastí", () => {
    const csv = compareReportCsv(res(), { model: "Kolo B", tolerance: 0.1, date: "13. 11. 2026" });
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe("Porovnání s referenčním modelem;13. 11. 2026");
    expect(lines).toContain("Reference;604200001.stp");
    expect(lines).toContain("Rozdíl objemů model − reference [cm³];2,095");
    expect(lines).toContain("Materiál navíc v modelu (model − reference) [cm³];123,394");
    expect(lines).toContain("Numerický šum [cm³];0,000 (1 těles)");
    expect(lines).toContain("Plocha v toleranci [%];87,4");
    expect(lines).toContain('Upozornění;"Pozor; test ""uvozovek"""');
    const head = lines.findIndex((l) => l.startsWith("Č.;"));
    expect(head).toBeGreaterThan(0);
    expect(lines[head].split(";").length).toBe(11);
    const rows = lines.slice(head + 1).filter(Boolean);
    expect(rows.length).toBe(5); // 4 oblasti + „dalších 2“
    expect(rows[0].split(";")).toEqual(["1", "navíc v modelu", "123,394", "10,000", "10,000", "4,000", "0,000", "0,000", "-6,700", "anuloid R195,35/r8,00 · rovina", "v modelu chybí drážka / zápich R8,00"]);
    expect(rows[4]).toMatch(/^…;chybí v modelu;0,001;.*dalších 2 oblastí/);
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("text: souhrn a jeden řádek na oblast; bez booleovských operací jen poznámka", () => {
    const txt = compareReportText(res(), { model: "Kolo B", tolerance: 0.1 });
    expect(txt).toMatch(/^POROVNÁNÍ S REFERENČNÍM MODELEM\n/);
    expect(txt).toContain("Reference: 604200001.stp (STEP)");
    expect(txt).toContain("Rozdíl objemů (model − reference): 2,095 cm³");
    expect(txt).toContain("Rozdílové oblasti (4):");
    expect(txt).toContain("1. navíc v modelu: 123,394 cm³ · rozměr 10,00 × 10,00 × 4,00 mm · střed [0,00; 0,00; -6,70]");
    expect(txt).toContain("… a dalších 2 oblastí (chybí v modelu), celkem 0,001 cm³");
    expect(txt).toContain("v toleranci 87,4 % plochy, přesnost ±0,050 mm");
    const none = compareReportText({ ...res(), extra: null, missing: null, map: null, warnings: [] }, { model: "x", tolerance: 0.1 });
    expect(none).toContain("Rozdílová tělesa se nepočítala.");
    expect(none).toContain("Žádné rozdílové oblasti nad prahem šumu.");
  });

  it("angličtina: přeložené popisy a desetinná tečka v textu; CSV čísla zůstávají s čárkou", () => {
    setLang("en");
    clearMissing();
    try {
      expect(regionHint(groove)).toBe("model lacks a groove / undercut R8.00");
      expect(surfacesText(holes[0].surfaces)).toBe("cylinder Ø13.00 · 2× plane");
      expect(fmt(-2.5, 1)).toBe("-2.5");
      const txt = compareReportText(res(), { model: "Wheel B", tolerance: 0.1 });
      expect(txt).toContain("Volume difference (model − reference): 2.095 cm³");
      expect(txt).toMatch(/^COMPARISON WITH THE REFERENCE MODEL\n/);
      const csv = compareReportCsv(res(), { model: "Wheel B", tolerance: 0.1 });
      expect(csv).toContain("Volume difference model − reference [cm³];2,095");
      expect(csv).toContain("1;extra in model;123,394;10,000;10,000;4,000;0,000;0,000;-6,700;torus R195.35/r8.00 · plane;model lacks a groove / undercut R8.00");
      expect(missingKeys()).toEqual([]);
    } finally {
      setLang("cs");
    }
  });
});
