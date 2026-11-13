import { describe, expect, it } from "vitest";
import { emptyDoc, type CadDoc, type Feature } from "../types";
import { contourArea, depositionEff, filletSize, grooveAreaFormula, grooveProfile, intermittent, PREPS, piecesArea, plugArea, prepDef, reinforcementArea, rowPositions, segmentArea, weldInfoText, weldMetal, type GrooveSpec } from "./weld-calc";
import { SYMBOL_TYPES, symbolData, symbolText, weldSymbolGeometry } from "./weld-symbol";
import { weldTable, weldTableCsv, weldTableText } from "./weld-table";
import { weldBodyNames } from "./weld-bodies";
import { bodiesAt } from "../bodies";

const spec = (o: Partial<GrooveSpec> & Pick<GrooveSpec, "prep">): GrooveSpec => {
  const d = prepDef(o.prep)!;
  return { t: 12, c: d.c, g: d.g, angle: d.angle, R: d.R, cap: 0, root: 0, backing: false, overlap: 0, ...o };
};
const tan = (deg: number) => Math.tan((deg * Math.PI) / 180);

describe("úpravy svarových ploch ISO 9692-1 – plochy průřezu", () => {
  it("V: b·t + (t−c)²·tg(α/2) – vzorec i obrys", () => {
    const s = spec({ prep: "V", t: 10, c: 1, g: 2, angle: 60 });
    const exact = 2 * 10 + 9 * 9 * tan(30);
    expect(grooveAreaFormula(s)).toBeCloseTo(exact, 9);
    expect(piecesArea(grooveProfile(s).groove)).toBeCloseTo(exact, 6);
    // s převýšením housenky 2 mm nad šířkou drážky + přesahem 1 mm na každou stranu
    const w = 2 + 2 * 9 * tan(30) + 2;
    const sc = { ...s, cap: 2, overlap: 1 };
    expect(reinforcementArea(sc)).toBeCloseTo(segmentArea(w, 2), 9);
    const p = grooveProfile(sc);
    expect(p.caps).toHaveLength(1);
    expect(contourArea(p.caps[0].piece)).toBeCloseTo(segmentArea(w, 2), 2);
  });
  it("X: b·t + 2·h²·tg(α/2), h = (t−c)/2; obě strany s housenkou", () => {
    const s = spec({ prep: "X", t: 20, c: 2, g: 2, angle: 60, cap: 1.5, overlap: 1 });
    const h = 9;
    const exact = 2 * 20 + 2 * h * h * tan(30);
    expect(grooveAreaFormula(s)).toBeCloseTo(exact, 9);
    const p = grooveProfile(s);
    expect(piecesArea(p.groove)).toBeCloseTo(exact, 6);
    expect(p.caps).toHaveLength(2);
    const w = 2 + 2 * h * tan(30) + 2;
    expect(reinforcementArea(s)).toBeCloseTo(2 * segmentArea(w, 1.5), 9);
  });
  it("½V a K: b·t + (t−c)²·tg β / 2, b·t + h²·tg β", () => {
    const hv = spec({ prep: "HV", t: 10, c: 1, g: 2, angle: 45 });
    expect(grooveAreaFormula(hv)).toBeCloseTo(20 + (81 * 1) / 2, 9);
    expect(piecesArea(grooveProfile(hv).groove)).toBeCloseTo(20 + 40.5, 6);
    const k = spec({ prep: "K", t: 16, c: 2, g: 2, angle: 45 });
    expect(grooveAreaFormula(k)).toBeCloseTo(32 + 49, 9);
    expect(piecesArea(grooveProfile(k).groove)).toBeCloseTo(81, 6);
    // ½V s mezerou 0: jen úkos
    const hv0 = spec({ prep: "HV", t: 10, c: 0, g: 0, angle: 45 });
    expect(piecesArea(grooveProfile(hv0).groove)).toBeCloseTo(50, 6);
  });
  it("U, 2U, J, 2J: oblouk R tečně navazující na bok β", () => {
    const b = (10 * Math.PI) / 180;
    const R = 6;
    const half = (H: number) => {
      const Hf = H - R * (1 - Math.sin(b));
      return ((R * R) / 2) * (Math.PI / 2 - b - Math.sin(b) * Math.cos(b)) + R * Math.cos(b) * Hf + (Hf * Hf * Math.tan(b)) / 2;
    };
    const u = spec({ prep: "U", t: 25, c: 2, g: 0, angle: 10, R });
    expect(grooveAreaFormula(u)).toBeCloseTo(2 * half(23), 9);
    expect(piecesArea(grooveProfile(u).groove) / grooveAreaFormula(u)).toBeCloseTo(1, 4);
    const uu = spec({ prep: "UU", t: 40, c: 2, g: 1, angle: 10, R });
    expect(grooveAreaFormula(uu)).toBeCloseTo(40 + 4 * half(19), 9);
    expect(piecesArea(grooveProfile(uu).groove) / grooveAreaFormula(uu)).toBeCloseTo(1, 4);
    const j = spec({ prep: "J", t: 25, c: 2, g: 0, angle: 10, R });
    expect(grooveAreaFormula(j)).toBeCloseTo(half(23), 9);
    expect(piecesArea(grooveProfile(j).groove) / grooveAreaFormula(j)).toBeCloseTo(1, 4);
    const jj = spec({ prep: "JJ", t: 40, c: 2, g: 0, angle: 10, R });
    expect(piecesArea(grooveProfile(jj).groove) / grooveAreaFormula(jj)).toBeCloseTo(1, 4);
    // mělká drážka (jen část oblouku)
    const shallow = spec({ prep: "U", t: 4, c: 2, g: 0, angle: 10, R });
    expect(piecesArea(grooveProfile(shallow).groove) / grooveAreaFormula(shallow)).toBeCloseTo(1, 4);
  });
  it("I, Y, ½Y a převýšení kořene / podložka", () => {
    expect(grooveAreaFormula(spec({ prep: "I", t: 6, g: 3, c: 0 }))).toBe(18);
    const y = spec({ prep: "Y", t: 12, c: 4, g: 1, angle: 60 });
    expect(piecesArea(grooveProfile(y).groove)).toBeCloseTo(12 + 64 * tan(30), 6);
    const hy = spec({ prep: "HY", t: 12, c: 4, g: 1, angle: 45 });
    expect(piecesArea(grooveProfile(hy).groove)).toBeCloseTo(12 + 32, 6);
    const r = spec({ prep: "V", t: 10, c: 1, g: 2, angle: 60, root: 1, overlap: 1 });
    expect(reinforcementArea(r)).toBeCloseTo(segmentArea(4, 1), 9);
    const bk = grooveProfile({ ...r, backing: true });
    expect(bk.backing).toHaveLength(4);
    expect(bk.caps).toHaveLength(0); // s podložkou bez převýšení kořene
  });
  it("každá úprava dává nepřekrývající se kusy se součtem = vzorec (výchozí rozměry)", () => {
    for (const d of PREPS) {
      const s = spec({ prep: d.v, t: 20 });
      expect(piecesArea(grooveProfile(s).groove) / grooveAreaFormula(s), d.v).toBeCloseTo(1, 3);
    }
  });
  it("chybné rozměry česky", () => {
    expect(() => grooveProfile(spec({ prep: "V", t: 10, c: 10 }))).toThrow(/Otupení/);
    expect(() => grooveProfile(spec({ prep: "I", t: 10, g: 0 }))).toThrow(/mezeru/);
    expect(() => grooveProfile(spec({ prep: "U", t: 10, R: 0 }))).toThrow(/poloměr/);
  });
});

describe("koutový, děrový, bodový, kov", () => {
  it("z = a·√2, plocha a² (90°)", () => {
    const f = filletSize(5, "a");
    expect(f.z).toBeCloseTo(5 * Math.SQRT2, 9);
    expect(f.area).toBeCloseTo(25, 9);
    const z = filletSize(6, "z");
    expect(z.a).toBeCloseTo(6 / Math.SQRT2, 9);
    expect(z.area).toBeCloseTo(18, 9);
    const obtuse = filletSize(4, "a", 120);
    expect(obtuse.z).toBeCloseTo(4 / Math.cos(Math.PI / 3), 9);
  });
  it("přerušovaný, řada bodů, otvory", () => {
    expect(intermittent(250, 50, 100)).toMatchObject({ count: 3, length: 150 });
    expect(rowPositions(3, 40)).toEqual([-40, 0, 40]);
    expect(plugArea(12)).toBeCloseTo(Math.PI * 36, 9);
    expect(plugArea(10, 30)).toBeCloseTo(20 * 10 + Math.PI * 25, 9);
  });
  it("hmotnost svarového kovu a přídavný materiál (MAG 135, η 0,9)", () => {
    const m = weldMetal(10000, 7.85, depositionEff("135"));
    expect(m.mass).toBeCloseTo(0.0785, 9);
    expect(m.filler).toBeCloseTo(0.0785 / 0.9, 9);
    expect(depositionEff("111")).toBe(0.6);
    expect(depositionEff("135", 0.8)).toBe(0.8);
    expect(weldMetal(1000, 7.85, 1, false).filler).toBe(0);
  });
});

describe("značka svaru ISO 2553", () => {
  it("všechny druhy dávají čáry; oboustranné bez identifikační čáry", () => {
    for (const t of SYMBOL_TYPES) {
      const g = weldSymbolGeometry(symbolData({ kind: t.v, size: 5, length: 100, process: "135" }), [100, 100], [80, 120]);
      expect(g.polys.length, t.v).toBeGreaterThan(3);
      expect(g.texts.some((x) => x.s === "135"), t.v).toBe(true);
    }
    const x = weldSymbolGeometry(symbolData({ kind: "X", size: 20, angle: 60 }), [0, 0], [-10, 10]);
    expect(x.polys.some((p) => p.layer === "hidden")).toBe(false);
    expect(x.texts.filter((t) => t.s === "s20")).toHaveLength(2);
    const v = weldSymbolGeometry(symbolData({ kind: "V", size: 10, angle: 60, gap: 2, rootFace: 1 }), [0, 0], [-10, 10]);
    expect(v.polys.some((p) => p.layer === "hidden")).toBe(true);
    expect(v.texts.map((t) => t.s)).toContain("60° b2 c1");
    const f = weldSymbolGeometry(symbolData({ kind: "fillet", size: 5, both: true, length: 50, count: 3, pitch: 100, allAround: true, field: true }), [0, 0], [10, 10], { flip: true });
    expect(f.texts.filter((t) => t.s === "a5")).toHaveLength(2);
    expect(f.texts.map((t) => t.s)).toContain("3×50 (100)");
    expect(symbolText(symbolData({ kind: "spot", size: 6, count: 5, pitch: 40 }))).toContain("Ø6");
  });
});

describe("tabulka svarů a tělesa svarového kovu", () => {
  const ext = (id: string, name: string, data: Record<string, unknown>): Feature => ({ id, name, type: "ext", ext: id.startsWith("b") ? "weld.bead" : id.startsWith("g") ? "weld.groove" : "weld.symbol", data } as Feature);
  it("řádky ze stavu prvků + odhad z dat, součty", () => {
    const doc: CadDoc = { ...emptyDoc("T"), features: [ext("b1", "Housenka 1", { edges: [1], a: 4, measure: "a", edgeLens: [100] }), ext("g1", "Tupý 1", { prep: "V" }), ext("s1", "Značka", { kind: "fillet", size: 3, length: 200 })] };
    const info = { kind: "groove", prep: "V", joint: "butt", size: 10, sizeLabel: "s", length: 200, count: 1, area: 72, volume: 14400, mass: 0.11304, filler: 0.1256, density: 7.85, eff: 0.9, process: "135", anchors: [] };
    const rows = weldTable(doc, [{ id: "g1", ok: true, data: { weld: info } }]);
    expect(rows).toHaveLength(3);
    expect(rows[0].volume).toBeCloseTo(16 * 100, 6); // a² · L
    expect(rows[0].estimate).toBe(true);
    expect(rows[1].estimate).toBe(false);
    expect(rows[1].mass).toBeCloseTo(0.11304, 9);
    expect(rows[2].volume).toBeCloseTo(9 * 200, 6);
    const txt = weldTableText(doc, [{ id: "g1", ok: true, data: { weld: info } }]);
    expect(txt).toMatch(/Celkem: 3 svarů/);
    expect(weldTableCsv(doc)).toContain("Celkem");
    expect(weldInfoText(info as never)).toMatch(/svarový kov/);
  });
  it("názvy těles Svar k (a podložka), statická simulace těles", () => {
    const box: Feature = { id: "x", name: "Kvádr", type: "box", size: [10, 10, 10], position: [0, 0, 0], centered: false, mode: "new" } as Feature;
    const f = [box, ext("g1", "T1", { prep: "V", backing: true }), ext("b1", "H", { separate: false }), ext("b2", "H2", { separate: true })];
    expect(weldBodyNames(f, 1)).toEqual(["Svar 1", "Podložka 1"]);
    expect(weldBodyNames(f, 2)).toEqual([]);
    expect(weldBodyNames(f, 3)).toEqual(["Svar 2"]);
    expect(bodiesAt({ features: f }).names).toEqual(["Těleso 1", "Svar 1", "Podložka 1", "Svar 2"]);
  });
});
