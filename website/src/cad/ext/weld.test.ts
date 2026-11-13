import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc } from "../build";
import { newExtFeature } from "../defaults";
import { emptyDoc, type CadDoc, type Feature, type Vec3 } from "../types";
import "./index";
import { cutList, cutListCsv, cutListText, layoutMembers, sectionCorners, sectionOf, symbolData, weldLength, weldSymbolGeometry, weldTable } from "./weld-layout";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

const lineSketch = (id: string, pts: [number, number][], closed = false): Feature => ({
  id,
  name: "Osy",
  type: "sketch",
  plane: { kind: "base", name: "XY", offset: 0 },
  entities: [{ id: "p", type: "polyline", points: pts, closed }],
});
const docWith = (features: Feature[]): CadDoc => ({ ...emptyDoc("Svařenec"), features });
const member = (doc: CadDoc, data: Record<string, unknown>) => {
  const f = newExtFeature(doc, "weld.member", {});
  if (f.type === "ext") f.data = { ...f.data, ...data };
  return f;
};
const ext = (doc: CadDoc, id: string, data: Record<string, unknown>) => {
  const f = newExtFeature(doc, id, {});
  if (f.type === "ext") f.data = { ...f.data, ...data };
  return f;
};
const AREA_40x3 = sectionOf({ family: "shs", w: 40, h: 40, t: 3, d: 0, size: "" }).area;

describe("průřezy a rozložení (bez OCCT)", () => {
  it("plochy průřezů odpovídají vzorcům", () => {
    const exact = 40 * 40 - 34 * 34 - (4 - Math.PI) * (36 - 9);
    expect(Math.abs(AREA_40x3 - exact) / exact).toBeLessThan(0.01); // oblouky aproximované 4 úseky
    expect(sectionOf({ family: "chs", w: 0, h: 0, t: 2.6, d: 33.7, size: "" }).area).toBeCloseTo(Math.PI * (16.85 ** 2 - 14.25 ** 2), 3);
    expect(sectionOf({ family: "flat", w: 40, h: 0, t: 8, d: 0, size: "" }).area).toBe(320);
    expect(sectionOf({ family: "IPE", w: 0, h: 0, t: 0, d: 0, size: "200" }).area).toBeGreaterThan(2500);
    expect(() => sectionOf({ family: "shs", w: 40, h: 40, t: 25, d: 0, size: "" })).toThrow(/stěny/);
  });
  it("pokos 90°: obě osy končí ve vrcholu, vnější délka o půl šířky delší", () => {
    const corners = sectionCorners(sectionOf({ family: "shs", w: 40, h: 40, t: 3, d: 0, size: "" }), "center", 0);
    const lay = layoutMembers([{ a: [0, 0, 0], b: [300, 0, 0], up: [0, 0, 1] }, { a: [300, 0, 0], b: [300, 200, 0], up: [0, 0, 1] }], { mode: "mitre", gap: 0, extStart: 0, extEnd: 0, corners });
    expect(lay[0].axisLen).toBeCloseTo(300, 6);
    expect(lay[0].outerLen).toBeCloseTo(320, 6);
    expect(lay[0].angleB).toBeCloseTo(45, 6);
    expect(lay[1].outerLen).toBeCloseTo(220, 6);
    expect(lay[0].cuts).toHaveLength(1);
  });
  it("tupý spoj: první průběžný (+20), druhý zkrácený (−20)", () => {
    const corners = sectionCorners(sectionOf({ family: "shs", w: 40, h: 40, t: 3, d: 0, size: "" }), "center", 0);
    const lay = layoutMembers([{ a: [0, 0, 0], b: [300, 0, 0], up: [0, 0, 1] }, { a: [300, 0, 0], b: [300, 200, 0], up: [0, 0, 1] }], { mode: "butt", gap: 0, extStart: 0, extEnd: 0, corners });
    expect(lay[0].axisLen).toBeCloseTo(320, 6);
    expect(lay[1].axisLen).toBeCloseTo(180, 6);
    expect(lay[1].extA).toBeCloseTo(-20, 6);
  });
  it("přerušovaný svar a značka", () => {
    expect(weldLength(250, { edges: [], a: 4, intermittent: true, segLen: 50, pitch: 100, edgeLens: [] })).toBe(150);
    const g = weldSymbolGeometry(symbolData({ kind: "fillet", size: 3, length: 100, allAround: true, field: true }), [100, 100], [80, 90]);
    expect(g.texts.map((t) => t.s)).toContain("a3");
    expect(g.polys.length).toBeGreaterThan(5);
  });
});

describe("svařence (OCCT)", () => {
  it("konstrukční profil: objem = plocha × délka, výška 40 kolem osy", async () => {
    const d = docWith([lineSketch("s", [[0, 0], [500, 0]])]);
    const res = await buildDoc({ ...d, features: [...d.features, member(d, { sketchId: "s" })] });
    expect(res.status.every((s) => s.ok), res.status.map((s) => s.error).join()).toBe(true);
    expect(res.metrics!.volume).toBeCloseTo(AREA_40x3 * 500, -2);
    expect(res.metrics!.bbox[0][2]).toBeCloseTo(-20, 3);
    expect(res.metrics!.bbox[1][2]).toBeCloseTo(20, 3);
  }, 60_000);
  it("roh pokosem i tupě: objem = plocha × (300 + 200), vnější rozměr 320", async () => {
    for (const corner of ["mitre", "butt"] as const) {
      const d = docWith([lineSketch("s", [[0, 0], [300, 0], [300, 200]])]);
      const res = await buildDoc({ ...d, features: [...d.features, member(d, { sketchId: "s", corner })] });
      expect(res.status.every((s) => s.ok), corner + ": " + res.status.map((s) => s.error).join()).toBe(true);
      expect(res.metrics!.volume / (AREA_40x3 * 500)).toBeCloseTo(1, 1);
      expect(res.metrics!.bbox[1][0]).toBeCloseTo(320, 2);
      expect(res.metrics!.bbox[0][0]).toBeCloseTo(0, 2);
      expect(res.metrics!.bbox[0][1]).toBeCloseTo(-20, 2);
      expect(res.metrics!.bbox[1][1]).toBeCloseTo(200, 2);
    }
  }, 120_000);
  it("uzavřený obdélník ze 4 profilů (pokos) – jedno těleso, objem ≈ obvod × plocha", async () => {
    const d = docWith([lineSketch("s", [[0, 0], [600, 0], [600, 400], [0, 400]], true)]);
    const res = await buildDoc({ ...d, features: [...d.features, member(d, { sketchId: "s", family: "rhs", w: 60, h: 40, t: 3 })] });
    expect(res.status.every((s) => s.ok), res.status.map((s) => s.error).join()).toBe(true);
    const area = sectionOf({ family: "rhs", w: 60, h: 40, t: 3, d: 0, size: "" }).area;
    expect(res.metrics!.volume / (area * 2000)).toBeCloseTo(1, 1);
    expect(res.metrics!.bbox[1][0] - res.metrics!.bbox[0][0]).toBeCloseTo(660, 1);
  }, 120_000);
  it("rám z profilů: 12 členů, objem ≈ Σ plocha × délka, kusovník 3 skupiny", async () => {
    const d = docWith([]);
    const f = ext(d, "weld.frame", { family: "shs", w: 30, h: 30, t: 2, width: 500, depth: 400, height: 300 });
    const doc = { ...d, features: [f] };
    const res = await buildDoc(doc);
    expect(res.status[0].ok, res.status[0].error).toBe(true);
    const area = sectionOf({ family: "shs", w: 30, h: 30, t: 2, d: 0, size: "" }).area;
    const expected = area * (2 * (470 + 470 + 370 + 370) + 4 * 240);
    expect(res.metrics!.volume / expected).toBeCloseTo(1, 1);
    expect(res.metrics!.bbox[1][0]).toBeCloseTo(500, 1);
    expect(res.metrics!.bbox[1][2]).toBeCloseTo(300, 1);
    const cl = cutList(doc);
    expect(cl.rows).toHaveLength(3);
    expect(cl.rows.map((x) => x.count)).toEqual([4, 4, 4]);
    expect(cl.rows.find((x) => x.angleA === 0)!.length).toBe(240);
    expect(cutListCsv(doc)).toContain("Jäkl 30×30×2");
    expect(cutListText(doc)).toContain("Celkem na profil");
  }, 180_000);
  it("víčko přidá desku na čelo profilu", async () => {
    const d = docWith([lineSketch("s", [[0, 0], [200, 0]])]);
    const base = { ...d, features: [...d.features, member(d, { sketchId: "s" })] };
    const b0 = await buildDoc(base);
    const endFace = b0.body!.faces.findIndex((f) => f.geomType === "PLANE" && Math.abs(f.center.x - 200) < 1e-3 && Math.abs(f.normalAt(f.center).x - 1) < 1e-6);
    expect(endFace).toBeGreaterThanOrEqual(0);
    const res = await buildDoc({ ...base, features: [...base.features, ext(base, "weld.endCap", { faces: [endFace], t: 5 })] });
    expect(res.status.every((s) => s.ok), res.status.map((s) => s.error).join()).toBe(true);
    const capExact = (40 * 40 - (4 - Math.PI) * 36) * 5;
    expect(Math.abs(res.metrics!.volume - b0.metrics!.volume - capExact) / capExact).toBeLessThan(0.01);
    expect(res.metrics!.bbox[1][0]).toBeCloseTo(205, 3);
    const res2 = await buildDoc({ ...base, features: [...base.features, ext(base, "weld.endCap", { faces: [endFace], t: 5, inset: 2, cornerR: 3 })] });
    expect(res2.status.every((s) => s.ok), res2.status.map((s) => s.error).join()).toBe(true);
    expect(res2.metrics!.volume).toBeLessThan(res.metrics!.volume);
  }, 120_000);
  it("styčník v rohu L: objem = d1·d2/2 · t; housenka = a²/2 · délka", async () => {
    const d = docWith([lineSketch("s", [[0, 0], [300, 0], [300, 200]])]);
    const base = { ...d, features: [...d.features, member(d, { sketchId: "s", corner: "mitre" })] };
    const b0 = await buildDoc(base);
    const faces = b0.body!.faces;
    const f1 = faces.findIndex((f) => f.geomType === "PLANE" && Math.abs(f.center.y - 20) < 1e-3 && f.normalAt(f.center).y > 0.99 && f.center.x < 290);
    const f2 = faces.findIndex((f) => f.geomType === "PLANE" && Math.abs(f.center.x - 280) < 1e-3 && f.normalAt(f.center).x < -0.99 && f.center.y > 30);
    expect(f1).toBeGreaterThanOrEqual(0);
    expect(f2).toBeGreaterThanOrEqual(0);
    const g = await buildDoc({ ...base, features: [...base.features, ext(base, "weld.gusset", { faces: [f1, f2], d1: 60, d2: 60, t: 5, chamfer: 0 })] });
    expect(g.status.every((s) => s.ok), g.status.map((s) => s.error).join()).toBe(true);
    expect(g.metrics!.volume - b0.metrics!.volume).toBeCloseTo((60 * 60) / 2 * 5, -1);
    // vnitřní hrana rohu (x = 280, y = 20, podél z)
    const edge = b0.body!.edges.findIndex((e) => e.geomType === "LINE" && Math.abs(e.startPoint.x - 280) < 1e-3 && Math.abs(e.startPoint.y - 20) < 1e-3 && Math.abs(e.endPoint.x - 280) < 1e-3 && Math.abs(e.endPoint.y - 20) < 1e-3);
    expect(edge).toBeGreaterThanOrEqual(0);
    const E = b0.body!.edges[edge];
    const L = Math.abs(E.endPoint.z - E.startPoint.z); // rovná část vnitřní plochy = 40 − 2·(2t) = 28 (zaoblené rohy jäklu)
    expect(L).toBeCloseTo(28, 3);
    // starší zadání: a = rameno z (a×a), housenka sloučená s tělesem
    const w = await buildDoc({ ...base, features: [...base.features, ext(base, "weld.bead", { edges: [edge], a: 4, measure: "z", separate: false })] });
    expect(w.status.every((s) => s.ok), w.status.map((s) => s.error).join()).toBe(true);
    expect(w.metrics!.volume - b0.metrics!.volume).toBeCloseTo((16 / 2) * L, 0);
    // nové výchozí: a = účinná tloušťka (z = a·√2) → průřez a², svarový kov jako těleso „Svar 1“
    const wa = await buildDoc({ ...base, features: [...base.features, ext(base, "weld.bead", { edges: [edge], a: 4 })] });
    expect(wa.status.every((s) => s.ok), wa.status.map((s) => s.error).join()).toBe(true);
    expect(wa.metrics!.volume - b0.metrics!.volume).toBeCloseTo(16 * L, 0);
    expect(wa.bodies?.map((b) => b.name)).toContain("Svar 1");
    const wi = await buildDoc({ ...base, features: [...base.features, ext(base, "weld.bead", { edges: [edge], a: 4, measure: "z", intermittent: true, segLen: 10, pitch: 20 })] });
    expect(wi.status.every((s) => s.ok)).toBe(true);
    expect(wi.metrics!.volume - b0.metrics!.volume).toBeCloseTo((16 / 2) * weldLength(L, { edges: [], a: 4, intermittent: true, segLen: 10, pitch: 20, edgeLens: [] }), 0);
    // vnější (konvexní) hrana → chyba
    const outer = b0.body!.edges.findIndex((e) => e.geomType === "LINE" && Math.abs(e.startPoint.x - 320) < 1e-3 && Math.abs(e.startPoint.y + 20) < 1e-3 && Math.abs(e.endPoint.x - 320) < 1e-3 && Math.abs(e.endPoint.y + 20) < 1e-3);
    if (outer >= 0) {
      const bad = await buildDoc({ ...base, features: [...base.features, ext(base, "weld.bead", { edges: [outer], a: 4 })] });
      expect(bad.status.at(-1)!.ok).toBe(false);
      expect(bad.status.at(-1)!.error).toMatch(/vnitřní/);
    }
    // tabulka svarů z dat (délky hran z UI)
    const bf = ext(base, "weld.bead", { edges: [edge], a: 4, measure: "z", edgeLens: [40] }); // starší prvek: délky hran z formuláře v UI
    const sym = ext(base, "weld.symbol", { kind: "V", size: 6, length: 120 });
    const rows = weldTable({ ...base, features: [...base.features, bf, sym] });
    expect(rows).toHaveLength(2);
    expect(rows[0].volume).toBeCloseTo(320, 6);
    expect(rows[1].type).toContain("V svar");
  }, 180_000);
  it("deska s dírami a ořez rovinou", async () => {
    const d = docWith([]);
    const plate = ext(d, "weld.plate", { w: 200, h: 100, t: 10, nx: 2, ny: 2, hole: 13, margin: 25, mode: "new" });
    const res = await buildDoc({ ...d, features: [plate] });
    expect(res.status[0].ok, res.status[0].error).toBe(true);
    expect(res.metrics!.volume).toBeCloseTo((200 * 100 - 4 * Math.PI * 6.5 ** 2) * 10, -1);
    const trimmed = await buildDoc({ ...d, features: [plate, ext(d, "weld.trim", { plane: "YZ", offset: 50, keep: "+" })] });
    expect(trimmed.status.every((s) => s.ok)).toBe(true);
    expect(trimmed.metrics!.bbox[0][0]).toBeCloseTo(50, 3);
    expect(trimmed.metrics!.volume).toBeLessThan(res.metrics!.volume);
  }, 120_000);
  it("chyby česky: bez skici, prázdná skica, značka bez geometrie zachová těleso", async () => {
    const d = docWith([]);
    const res = await buildDoc({ ...d, features: [member(d, { sketchId: "" })] });
    expect(res.status[0].ok).toBe(false);
    expect(res.status[0].error).toMatch(/skicu/i);
    const d2 = docWith([lineSketch("s", [[0, 0], [100, 0]]), { id: "c", name: "Kružnice", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [{ id: "k", type: "circle", cx: 0, cy: 0, r: 10 }] }]);
    const res2 = await buildDoc({ ...d2, features: [...d2.features, member(d2, { sketchId: "c" })] });
    expect(res2.status.at(-1)!.error).toMatch(/úsečk/);
    const base = { ...d2, features: [...d2.features, member(d2, { sketchId: "s" })] };
    const res3 = await buildDoc({ ...base, features: [...base.features, ext(base, "weld.symbol", { kind: "fillet", size: 4 })] });
    expect(res3.status.every((s) => s.ok)).toBe(true);
    expect(res3.metrics!.volume).toBeCloseTo(AREA_40x3 * 100, -2);
  }, 120_000);
});

void ((): Vec3 => [0, 0, 0]);
