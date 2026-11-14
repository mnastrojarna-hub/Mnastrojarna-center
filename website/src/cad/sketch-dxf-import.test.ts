/** Import DXF do otevřené skice (w13 chyba 16): jednotky, posun počátku, filtr hladin, nová id, hlášení. */
import { describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import { arcGeom } from "./sketch";
import { dxfForSketch, dxfImportMessage, entitiesBbox, fmtMm } from "./sketch-dxf-import";

/** DXF R12: úsečky na hladině OBRYS, kružnice na OSY, text (přeskočí se); `units` = $INSUNITS (bez = neuvedeno) */
const dxf = (units?: number) =>
  [
    "0", "SECTION", "2", "HEADER", ...(units !== undefined ? ["9", "$INSUNITS", "70", String(units)] : []), "0", "ENDSEC",
    "0", "SECTION", "2", "ENTITIES",
    "0", "LINE", "8", "OBRYS", "10", "10", "20", "5", "11", "60", "21", "5",
    "0", "LINE", "8", "OBRYS", "10", "60", "20", "5", "11", "60", "21", "35",
    "0", "CIRCLE", "8", "OSY", "10", "35", "20", "20", "40", "5",
    "0", "TEXT", "8", "TEXT", "10", "0", "20", "0", "1", "Popis",
    "0", "ENDSEC", "0", "EOF",
  ].join("\n");

describe("Import DXF do skici", () => {
  it("souřadnice v mm, hladiny s počty, přeskočený text", () => {
    const r = dxfForSketch(dxf(4));
    expect(r.entities.map((e) => e.type)).toEqual(["line", "line", "circle"]);
    expect(r.fileUnit).toBe("mm");
    expect(r.layers).toEqual([{ name: "OBRYS", count: 2 }, { name: "OSY", count: 1 }]);
    expect(r.skipped).toEqual({ TEXT: 1 });
    expect(r.bbox).toEqual([[10, 5], [60, 35]]);
  });
  it("jednotky: soubor v palcích → mm; vynucené cm přepočítají soubor bez jednotek", () => {
    const inch = dxfForSketch(dxf(1));
    expect(inch.fileUnit).toBe("in");
    expect(inch.bbox![1][0]).toBeCloseTo(60 * 25.4, 6);
    const none = dxfForSketch(dxf());
    expect(none.fileUnit).toBeNull();
    expect(none.bbox).toEqual([[10, 5], [60, 35]]); // bez jednotek = mm
    const cm = dxfForSketch(dxf(), { unit: "cm" });
    expect(cm.bbox).toEqual([[100, 50], [600, 350]]);
    const c = cm.entities.find((e) => e.type === "circle");
    expect(c && c.type === "circle" && c.r).toBe(50);
    // vynucené mm u souboru v palcích = čísla ze souboru bez převodu
    expect(dxfForSketch(dxf(1), { unit: "mm" }).bbox).toEqual([[10, 5], [60, 35]]);
  });
  it("posun počátku: levý dolní roh do počátku a ruční posun", () => {
    expect(dxfForSketch(dxf(4), { toOrigin: true }).bbox).toEqual([[0, 0], [50, 30]]);
    expect(dxfForSketch(dxf(4), { toOrigin: true, offset: [5, -5] }).bbox).toEqual([[5, -5], [55, 25]]);
    expect(dxfForSketch(dxf(4), { offset: [1, 2] }).bbox).toEqual([[11, 7], [61, 37]]);
  });
  it("filtr hladin a nová id při každém importu (dvojí import = dvě sady entit)", () => {
    const only = dxfForSketch(dxf(4), { layers: ["OSY"] });
    expect(only.entities.map((e) => e.type)).toEqual(["circle"]);
    expect(only.total).toBe(3);
    const a = dxfForSketch(dxf(4));
    const b = dxfForSketch(dxf(4));
    expect(new Set([...a.entities, ...b.entities].map((e) => e.id)).size).toBe(6);
  });
  it("hlášení: počet entit, hladin, rozměr a přeskočené typy", () => {
    const r = dxfForSketch(dxf(4));
    expect(dxfImportMessage("obrys.dxf", r, 2)).toBe("Do skici přidáno entit: 3 z „obrys.dxf“ (hladiny: 2) · 50 × 30 mm. Přeskočeno: TEXT ×1. Ctrl+Z import vrátí.");
  });
  it("binární DWG místo DXF = srozumitelná chyba", () => {
    expect(() => dxfForSketch("AC1032 binární data")).toThrow(/DWG/);
  });
});

/** jeden ARC (střed 100,100, r 10, 0° → 270°) – nález kontroly: obálka jen ze tří bodů oblouku */
const arc270 = ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "4", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES", "0", "ARC", "8", "0", "10", "100", "20", "100", "40", "10", "50", "0", "51", "270", "0", "ENDSEC", "0", "EOF"].join("\n");

describe("Import DXF do skici – obálka oblouků a formát čísel (nález kontroly)", () => {
  it("oblouk přes krajní body kružnice: skutečná obálka 20 × 20, ne 17,07 × 17,07", () => {
    const r = dxfForSketch(arc270);
    expect(r.bbox![0][0]).toBeCloseTo(90, 9);
    expect(r.bbox![0][1]).toBeCloseTo(90, 9);
    expect(r.bbox![1][0]).toBeCloseTo(110, 9);
    expect(r.bbox![1][1]).toBeCloseTo(110, 9);
  });
  it("levý dolní roh do počátku: oblouk leží celý v 0…20 (nepřesahuje do záporných X)", () => {
    const r = dxfForSketch(arc270, { toOrigin: true });
    const e = r.entities[0];
    if (e.type !== "arc") throw new Error("čekán oblouk");
    const g = arcGeom(e.a, e.b, e.c)!;
    expect(g.c[0]).toBeCloseTo(10, 9);
    expect(g.c[1]).toBeCloseTo(10, 9);
    expect(g.r).toBeCloseTo(10, 9);
    expect(r.bbox![0][0]).toBeCloseTo(0, 9);
    expect(r.bbox![0][1]).toBeCloseTo(0, 9);
    // zaokrouhlovací šum (−1e-14) se v souhrnu neukáže jako „-0“
    expect(fmtMm(r.bbox![0][0])).toBe("0");
    expect(fmtMm(-1e-14)).toBe("0");
  });
  it("oblouk bez krajního bodu kružnice (0° → 60°) = obálka z koncových bodů; oblouk ve směru hodin", () => {
    const b = entitiesBbox([{ id: "x", type: "arc", a: [10, 0], b: [Math.cos(Math.PI / 6) * 10, 5], c: [5, Math.sin(Math.PI / 3) * 10] }])!;
    expect(b[0][0]).toBeCloseTo(5, 9);
    expect(b[1][0]).toBeCloseTo(10, 9);
    expect(b[1][1]).toBeCloseTo(Math.sin(Math.PI / 3) * 10, 9);
    // 90° → 0° po směru hodin přes 45°: horní pravá čtvrtina (bez 180°/270°)
    const cw = entitiesBbox([{ id: "y", type: "arc", a: [0, 10], b: [Math.SQRT1_2 * 10, Math.SQRT1_2 * 10], c: [10, 0] }])!;
    expect(cw[0][0]).toBeCloseTo(0, 9);
    expect(cw[0][1]).toBeCloseTo(0, 9);
    expect(cw[1][0]).toBeCloseTo(10, 9);
    expect(cw[1][1]).toBeCloseTo(10, 9);
  });
  it("hlášení po importu formátuje rozměr jako dialog (čeština: desetinná čárka)", () => {
    const r = dxfForSketch(dxf(1));
    expect(dxfImportMessage("p.dxf", dxfForSketch(dxf(4), { unit: "cm", layers: ["OSY"] }), 1)).toContain("· 100 × 100 mm.");
    const half = dxfForSketch(dxf(4), { layers: ["OSY"], unit: "in" }); // kružnice r 5 in → Ø 254 mm
    expect(dxfImportMessage("p.dxf", half, 1)).toContain("· 254 × 254 mm.");
    const odd = { ...r, bbox: [[0, 0], [17.0711, 2.5]] as [[number, number], [number, number]] };
    expect(dxfImportMessage("p.dxf", odd, 1)).toContain("· 17,07 × 2,5 mm.");
    setLang("en");
    try {
      expect(dxfImportMessage("p.dxf", odd, 1)).toContain("17.07 × 2.5 mm");
    } finally {
      setLang("cs");
    }
  });
});
