/**
 * Výkres – pomocný pohled (skutečná délka šikmé plochy 30°), zalomený a natočený řez (šrafované oblasti), částečný řez,
 * přerušený pohled (zkrácení, skutečná délka kót), trojúhelníky revizí se zónami a tabulka revizí v SVG / DXF / DWG / PDF,
 * úchylky uložení ISO 286 a Tabulka uložení. Jádro OCCT (replicad) v Node.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { DwgReader } from "@node-projects/acad-ts";
import { annotationGeometry, annToSheet, makeDrawing, sheetToAnn, viewExtent, withAnnotations, type DrawingResult, type PlacedView, type ViewEnt } from "./drawing";
import { breakLines, clipBreaks, clipToPolygon, closedSpline, compress1, decompress1, neighborCam, normBrks, projQ, type Brk } from "./drawing-views";
import { drawingToDwg } from "./formats/dwg";
import { drawingToPdf } from "./pdf";
import type { DrawingAnnotation, Vec2, Vec3 } from "./types";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

const meta = { name: "Díl", material: "Ocel", number: "MN-7", author: "Test", revision: "B" };
const T30 = Math.tan(Math.PI / 6);
/** hranol s šikmou plochou 30° vpravo nahoře: profil v XZ vytažený o 40 v +Y; šikmá plocha 60/cos30 × 40 */
const wedge = () => {
  const prof: Vec3[] = [[0, 0, 0], [100, 0, 0], [100, 0, 50 - 60 * T30], [40, 0, 50], [0, 0, 50]];
  return r.basicFaceExtrusion(r.makePolygon(prof as [number, number, number][]), new r.Vector([0, 40, 0])) as unknown as r.Shape3D;
};
const lineLens = (ents: ViewEnt[] | undefined) => (ents ?? []).filter((e): e is Extract<ViewEnt, { t: "line" }> => e.t === "line").map((e) => Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]));
const view = (d: DrawingResult, k: string) => d.views.find((v) => v.key === k)!;
const L30 = 60 / Math.cos(Math.PI / 6);
/** rohy šikmé plochy v pohledu `k`: vrcholy čar na listu (výsledek HLR), které odpovídají průmětu rohů; vzdálenosti v mm modelu */
function faceInView(d: DrawingResult, k: string) {
  const v = view(d, k);
  const corners: Vec3[] = [[40, 0, 50], [100, 0, 50 - 60 * T30], [100, 40, 50 - 60 * T30], [40, 40, 50]];
  const pts = d.polys.filter((p) => p.layer === "visible").flatMap((p) => p.pts);
  const found = corners.map((c) => {
    const q = annToSheet(d.views, k, projQ(v.cam!, c));
    return pts.find((p) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-3) ?? null;
  });
  const dist = (i: number, j: number) => Math.hypot(found[i]![0] - found[j]![0], found[i]![1] - found[j]![1]) / v.s;
  return { found, dist };
}

describe("pomocný pohled (ISO 128-30)", () => {
  it("kamera sousedního pohledu: směr šipky = obraz směru k pozorovateli rodiče", () => {
    const front = { d: [0, -1, 0] as Vec3, x: [1, 0, 0] as Vec3 };
    const n: Vec3 = [Math.sin(Math.PI / 6), 0, Math.cos(Math.PI / 6)];
    const { cam, arrow } = neighborCam(front, n);
    expect(cam.d[0]).toBeCloseTo(0.5, 9);
    // šipka míří z venku na plochu (vlevo dolů na listu)
    expect(arrow[0]).toBeLessThan(0);
    expect(arrow[1]).toBeGreaterThan(0);
    // obraz směru −Y (k pozorovateli předního pohledu) v pomocném pohledu = směr šipky
    const up = [cam.d[1] * cam.x[2] - cam.d[2] * cam.x[1], cam.d[2] * cam.x[0] - cam.d[0] * cam.x[2], cam.d[0] * cam.x[1] - cam.d[1] * cam.x[0]];
    const img = [front.d[0] * cam.x[0] + front.d[1] * cam.x[1] + front.d[2] * cam.x[2], -(front.d[0] * up[0] + front.d[1] * up[1] + front.d[2] * up[2])];
    expect(img[0]).toBeCloseTo(arrow[0], 9);
    expect(img[1]).toBeCloseTo(arrow[1], 9);
    expect(() => neighborCam(front, [0, 1, 0])).toThrow(/shodný se směrem/);
  });

  it("šikmá plocha 30° z hrany v předním pohledu: skutečná délka 69,28 × 40, šipka a POHLED B", () => {
    const shape = wedge();
    // hrana šikmé plochy v předním pohledu (u = x, v = −z)
    const edge: [Vec2, Vec2] = [[40, -50], [100, -(50 - 60 * T30)]];
    const d = makeDrawing(shape, meta, { views: { front: true, top: true, left: false, right: false, back: false, bottom: false, iso: false }, aux: [{ id: "a1", label: "B", parent: "front", edge }], dimensions: "none" });
    expect(d.warnings).toEqual([]);
    const aux = view(d, "aux:B");
    expect(aux).toBeTruthy();
    // rohy šikmé plochy jsou vrcholy čar pomocného pohledu a tvoří obdélník ve skutečné velikosti 69,28 × 40
    const f = faceInView(d, "aux:B");
    expect(f.found.every(Boolean)).toBe(true);
    expect(f.dist(0, 1)).toBeCloseTo(L30, 3);
    expect(f.dist(2, 3)).toBeCloseTo(L30, 3);
    expect(f.dist(1, 2)).toBeCloseTo(40, 3);
    expect(f.dist(0, 2)).toBeCloseTo(Math.hypot(L30, 40), 3); // pravé úhly
    expect(lineLens(aux.ents).some((l) => Math.abs(l - 40) < 0.01)).toBe(true);
    // v horním pohledu je táž plocha zkrácená (60 × 40)
    const t = faceInView(d, "top");
    expect(t.found.every(Boolean)).toBe(true);
    expect(t.dist(0, 1)).toBeCloseTo(60, 3);
    const texts = d.texts.map((t) => t.s);
    expect(texts).toContain("POHLED B");
    expect(d.texts.filter((t) => t.s === "B" && t.size === 5).length).toBe(1); // písmeno u šipky
    expect(d.extraViews?.[0]).toMatchObject({ key: "aux:B", kind: "aux", parent: "front" });
    // pomocný pohled leží mimo hlavní pohled (zarovnaně ve směru šipky)
    const fv = view(d, "front");
    const box = (v: PlacedView) => ({ x0: v.px, y0: v.py, x1: v.px + v.w * v.s, y1: v.py + v.h * v.s });
    const a = box(aux);
    const b = box(fv);
    expect(a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1).toBe(true);
  }, 60_000);

  it("pomocný pohled podle plochy (F…) a podle směru vybere rodiče sám", () => {
    const shape = wedge();
    const i = shape.faces.findIndex((fc) => {
      if (fc.geomType !== "PLANE") return false;
      const n = fc.normalAt(fc.center);
      return Math.abs(n.x - 0.5) < 1e-6 && Math.abs(n.z - Math.cos(Math.PI / 6)) < 1e-6;
    });
    expect(i).toBeGreaterThanOrEqual(0);
    const d = makeDrawing(shape, meta, { views: { front: true, top: true, left: true, right: false, back: false, bottom: false, iso: false }, aux: [{ id: "a1", label: "C", face: i + 1 }, { id: "a2", label: "D", dir: [0.5, 0, Math.cos(Math.PI / 6)] }], dimensions: "none" });
    expect(d.warnings).toEqual([]);
    for (const k of ["aux:C", "aux:D"]) {
      const f = faceInView(d, k);
      expect(f.found.every(Boolean)).toBe(true);
      expect(f.dist(0, 1)).toBeCloseTo(L30, 3);
    }
    expect(d.extraViews?.map((x) => x.parent)).toEqual(["front", "front"]);
    const bad = makeDrawing(shape, meta, { aux: [{ id: "x", label: "E", face: 999 }], dimensions: "none" });
    expect(bad.warnings.join(" ")).toMatch(/Pohled E:/);
  }, 60_000);
});

/** deska 120 × 60 × 20 se třemi dírami v různých řadách (Ø10, Ø12, Ø8) */
const plate3 = () => {
  let s = r.makeBox([-60, -30, 0], [60, 30, 20]) as r.Shape3D;
  for (const [x, y, d] of [[-40, -10, 10], [0, 10, 12], [40, -10, 8]]) s = s.cut(r.makeCylinder(d / 2, 40, [x, y, -10], [0, 0, 1]));
  return s;
};
/** úseky průsečíku vodorovné přímky (obraz pohledu) s obrysy řezu: [od, do] seřazené */
function rowSpans(loops: Vec2[][], y: number): [number, number][] {
  const xs: number[] = [];
  for (const l of loops)
    for (let i = 1; i < l.length; i++) {
      const p = l[i - 1];
      const q = l[i];
      if ((p[1] <= y && q[1] > y) || (q[1] <= y && p[1] > y)) xs.push(p[0] + ((y - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
    }
  xs.sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 1e-6) out.push([xs[i], xs[i + 1]]);
  // sousední úseky (skok řezu) spojit
  const merged: [number, number][] = [];
  for (const s of out) {
    const m = merged[merged.length - 1];
    if (m && s[0] - m[1] < 1e-6) m[1] = s[1];
    else merged.push([...s]);
  }
  return merged;
}

describe("řez lomenou čarou (ISO 128-44)", () => {
  it("zalomený řez přes tři díry: šrafované oblasti 15 + 29 + 30 + 16 mm, mezery Ø10 / Ø12 / Ø8, bez čar skoků", async () => {
    const shape = plate3();
    // horní pohled: u = x, v = −y
    const pts: Vec2[] = [[-70, 10], [-20, 10], [-20, -10], [20, -10], [20, 10], [70, 10]];
    const { cutSection } = await import("./drawing-views");
    const { projectView } = await import("./drawing");
    const top = projectView(shape, "top", { d: [0, 0, 1], x: [1, 0, 0] }, false);
    const cs = cutSection(shape, { id: "c", label: "B", parent: "top", kind: "stepped", pts }, top, false, projectView);
    // řez vidí pozorovatel v −Y (šipky nahoru v horním pohledu = směr +Y)
    expect(cs.view.cam.d[1]).toBeCloseTo(-1, 9);
    expect(cs.arrow[1]).toBeCloseTo(-1, 9);
    const yMid = cs.view.y0 + cs.view.h / 2;
    const spans = rowSpans(cs.loops, yMid);
    const lens = spans.map(([a, b]) => Math.round((b - a) * 1000) / 1000).sort((a, b) => a - b);
    expect(lens).toEqual([15, 16, 29, 30]);
    const gaps = spans.slice(1).map((s, i) => Math.round((s[0] - spans[i][1]) * 1000) / 1000);
    expect([...gaps].sort((a, b) => a - b)).toEqual([8, 10, 12]);
    // čáry skoků (x = −20 a 20 v řezu) se nekreslí – žádná svislá čára přes celou výšku v místě skoku
    const jog = cs.view.polys.filter((pl) => pl.pts.length === 2 && pl.pts.every((p) => Math.abs(Math.abs(p[0]) - 20) < 1e-3) && Math.abs(pl.pts[0][1] - pl.pts[1][1]) > 19);
    expect(jog).toEqual([]);
    // na listu: ŘEZ B–B, šrafy, čára řezu s písmeny a šipkami v horním pohledu
    const d = makeDrawing(shape, meta, { views: { front: true, top: true, left: false, right: false, back: false, bottom: false, iso: false }, cuts: [{ id: "c", label: "B", parent: "top", kind: "stepped", pts }], dimensions: "none" });
    expect(d.warnings).toEqual([]);
    expect(d.texts.map((t) => t.s)).toEqual(expect.arrayContaining(["ŘEZ B–B"]));
    expect(d.texts.filter((t) => t.s === "B" && t.size === 5).length).toBe(2);
    expect(d.polys.filter((p) => p.layer === "hatch").length).toBeGreaterThan(20);
    expect(d.polys.filter((p) => p.layer === "cut" && p.width === 0.5).length).toBe(2 + 2 * 4); // konce + 4 zlomy
  }, 90_000);

  it("natočený řez příruby: rameno 120° otočené do roviny – díry Ø8 a středová Ø20 na obou stranách", async () => {
    let shape = r.makeCylinder(50, 10, [0, 0, 0], [0, 0, 1]) as r.Shape3D;
    shape = shape.cut(r.makeCylinder(10, 30, [0, 0, -10], [0, 0, 1]));
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3;
      shape = shape.cut(r.makeCylinder(4, 30, [35 * Math.cos(a), 35 * Math.sin(a), -10], [0, 0, 1]));
    }
    const { cutSection } = await import("./drawing-views");
    const { projectView } = await import("./drawing");
    const top = projectView(shape, "top", { d: [0, 0, 1], x: [1, 0, 0] }, false);
    const a120: Vec2 = [60 * Math.cos((2 * Math.PI) / 3), -60 * Math.sin((2 * Math.PI) / 3)];
    const cs = cutSection(shape, { id: "c", label: "C", parent: "top", kind: "aligned", pts: [[60, 0], [0, 0], a120] }, top, false, projectView);
    const spans = rowSpans(cs.loops, cs.view.y0 + cs.view.h / 2);
    const lens = spans.map(([a, b]) => Math.round((b - a) * 1000) / 1000).sort((a, b) => a - b);
    expect(lens).toEqual([11, 11, 21, 21]);
    const gaps = spans.slice(1).map((s, i) => Math.round((s[0] - spans[i][1]) * 1000) / 1000);
    expect(gaps).toEqual([8, 20, 8]);
    expect(cs.arrows?.length).toBe(2);
    expect(() => cutSection(shape, { id: "c", label: "C", parent: "top", kind: "aligned", pts: [[60, 0], [0, 0]] }, top, false, projectView)).toThrow(/3 body/);
  }, 90_000);
});

describe("částečný řez", () => {
  it("skrytá slepá díra se v oblasti ukáže: hrany díry viditelné, šrafy, hranice od ruky", () => {
    let shape = r.makeBox([-50, -30, 0], [50, 30, 40]) as r.Shape3D;
    shape = shape.cut(r.makeCylinder(10, 30, [0, 0, 10], [0, 0, 1])); // díra shora hloubky 30
    const region: Vec2[] = [[-25, -45], [25, -45], [25, -5], [-25, -5]];
    const base = makeDrawing(shape, meta, { views: { front: true, top: false, left: false, right: false, back: false, bottom: false, iso: false }, dimensions: "none" });
    const d = makeDrawing(shape, meta, { views: { front: true, top: false, left: false, right: false, back: false, bottom: false, iso: false }, brokenOut: [{ id: "b", view: "front", pts: region, depth: 30, spline: true }], dimensions: "none" });
    expect(d.warnings).toEqual([]);
    const hole = (v: PlacedView) => (v.ents ?? []).filter((e) => e.t === "line" && Math.abs(e.a[0] - e.b[0]) < 1e-6 && Math.abs(Math.abs(e.a[0]) - 10) < 1e-3 && !e.hidden);
    expect(hole(view(base, "front")).length).toBe(0);
    expect(hole(view(d, "front")).length).toBe(2);
    expect(d.polys.filter((p) => p.layer === "hatch").length).toBeGreaterThan(5);
    expect(d.polys.some((p) => p.layer === "thin" && p.pts.length > 30)).toBe(true); // hladká hranice
    expect(closedSpline(region).length).toBe(40);
  }, 60_000);
});

describe("přerušený pohled", () => {
  it("zobrazení souřadnic: zkrácení, inverze, ořez čar v mezeře", () => {
    const b: Brk[] = normBrks([{ axis: 0, a: 50, b: 250, g: 10 }]);
    expect(compress1(20, b, 0)).toBe(20);
    expect(compress1(300, b, 0)).toBe(110);
    expect(compress1(150, b, 0)).toBeCloseTo(55, 9);
    for (const x of [0, 49, 50, 100, 250, 251, 300]) expect(decompress1(compress1(x, b, 0), b, 0)).toBeCloseTo(x, 9);
    const parts = clipBreaks([[0, 0], [300, 0], [300, 10]], b);
    expect(parts).toEqual([[[0, 0], [50, 0]], [[250, 0], [300, 0], [300, 10]]]);
    expect(normBrks([{ axis: 0, a: 10, b: 30, g: 1 }, { axis: 0, a: 20, b: 50, g: 2 }])).toEqual([{ axis: 0, a: 10, b: 50, g: 2 }]);
    expect(breakLines([0, 0], [0, 40], "zigzag").length).toBe(6);
    expect(breakLines([0, 0], [0, 40], "wave").length).toBeGreaterThan(30);
    expect(clipToPolygon([[-10, 0], [10, 0]], [[-5, -5], [5, -5], [5, 5], [-5, 5]], true)).toEqual([[[-5, 0], [5, 0]]]);
  });

  it("hřídel 300 mm přerušená mezi 50 a 250: kratší na listu, kóta 300 a kóta přes přerušení drží skutečnou délku", () => {
    const shaft = r.makeCylinder(10, 300, [0, 0, 0], [1, 0, 0]) as r.Shape3D;
    const opts = { views: { front: true, top: true, left: false, right: false, back: false, bottom: false, iso: false }, scale: 1, sheet: "A4" as const, dimensions: "overall" as const, breaks: [{ id: "k", view: "front", axis: "x" as const, from: 50, to: 250, gap: 8, style: "zigzag" as const }] };
    const d = makeDrawing(shaft, meta, opts);
    expect(d.warnings).toEqual([]);
    const f = view(d, "front");
    const t = view(d, "top");
    expect(f.brk?.length).toBe(1);
    expect(t.brk?.length).toBe(1); // stejné přerušení i v horním pohledu (promítací čáry)
    expect(f.w).toBeCloseTo(108, 6); // 300 − 200 + mezera 8 mm (měřítko 1:1)
    expect(viewExtent(f).x1 - viewExtent(f).x0).toBeCloseTo(300, 6);
    expect(d.texts.map((x) => x.s)).toContain("300");
    expect(d.polys.filter((p) => p.layer === "thin").length).toBeGreaterThanOrEqual(4); // 2 × 2 čáry přerušení
    // ruční kóta přes přerušení: hodnota 300, na listu 108 mm
    const ann: DrawingAnnotation = { id: "d1", view: "front", type: "dim", kind: "horizontal", a: [0, 10], b: [300, 10], offset: 12 };
    const g = annotationGeometry(d, [ann]);
    expect(g.texts[0].s).toBe("300");
    const A = annToSheet(d.views, "front", [0, 10]);
    const B = annToSheet(d.views, "front", [300, 10]);
    expect(B[0] - A[0]).toBeCloseTo(108, 6);
    expect(sheetToAnn(f, B)[0]).toBeCloseTo(300, 6);
    const half = makeDrawing(shaft, meta, { ...opts, breaks: [{ id: "x", view: "front", axis: "x", from: 400, to: 500 }] });
    expect(half.warnings.join(" ")).toMatch(/mimo pohled/);
  }, 60_000);
});

describe("revize, zóny a uložení", () => {
  const plate = () => r.makeBox([-40, -25, 0], [40, 25, 20]).cut(r.makeCylinder(20, 40, [0, 0, -10], [0, 0, 1])) as r.Shape3D;
  const font = (n: string) => {
    const b = fs.readFileSync(path.resolve(__dirname, "../../public/fonts", n));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };

  it("tabulka revizí se zónou, trojúhelník revize u kóty – SVG, DXF, DWG i PDF", async () => {
    const revisions = [{ rev: "A", date: "1.11.2026", note: "První vydání" }, { rev: "B", date: "13.11.2026", note: "Díra Ø40 H7", author: "JN" }];
    const d = makeDrawing(plate(), { ...meta, revisions }, { zones: true, dimensions: "none", fitTable: true });
    expect(d.zones).toMatchObject({ cols: 6, rows: 4 }); // A4 na šířku
    expect(d.texts.map((t) => t.s)).toEqual(expect.arrayContaining(["Zóna", "Popis změny", "První vydání", "1", "6", "A", "D"]));
    const dim: DrawingAnnotation = { id: "d1", view: "top", type: "dim", kind: "diameter", c: [0, 0], r: 20, ang: 45, offset: 8, suffix: "H7", rev: "B" };
    const out = withAnnotations(d, [dim]);
    const texts = out.texts.map((t) => t.s);
    expect(texts).toEqual(expect.arrayContaining(["Ø40H7", "(+0,025/0)", "B", "Tabulka uložení (ISO 286)", "+0,025", "40,025", "40,000"]));
    // zóna trojúhelníku revize B v tabulce revizí
    const zoneTxt = out.texts.filter((t) => /^[A-D][1-6]$/.test(t.s) && !d.texts.some((x) => x.s === t.s && x.x === t.x && x.y === t.y));
    expect(zoneTxt.length).toBe(1);
    expect(out.svg).toContain("Díra Ø40 H7");
    expect(out.svg).toContain(">Zóna<");
    expect(out.dxf).toContain("Z\\U+00F3na");
    expect(out.dxf).toContain("Tabulka ulo\\U+017Een\\U+00ED (ISO 286)");
    const dwg = await drawingToDwg(out, { version: "R2018" });
    const tx = ([...DwgReader.readFromStream(dwg).entities!] as unknown as { objectName: string; value?: string }[]).filter((e) => e.objectName === "TEXT").map((e) => e.value ?? "");
    expect(tx).toEqual(expect.arrayContaining(["Zóna", "První vydání", "Díra Ø40 H7", "(+0,025/0)", zoneTxt[0].s]));
    const pdf = await drawingToPdf({ ...out, title: "Díl" }, { regular: font("Roboto-Regular.ttf"), bold: font("Roboto-Bold.ttf") });
    expect(pdf.size).toBeGreaterThan(10_000);
    // revize bez trojúhelníků
    const hidden = withAnnotations(makeDrawing(plate(), { ...meta, revisions: revisions.map((x) => ({ ...x, marks: false })) }, { dimensions: "none" }), [dim]);
    expect(hidden.texts.filter((t) => t.s === "B" && t.size === 2.4)).toEqual([]);
  }, 90_000);

  it("úchylky: jen značka / mezní rozměry podle listu i kóty, uložení H7/g6 dvojicí", () => {
    const d = makeDrawing(plate(), meta, { dimensions: "none", fitShow: "limits" });
    const base: DrawingAnnotation = { id: "d1", view: "top", type: "dim", kind: "diameter", c: [0, 0], r: 20, ang: 45, offset: 8, suffix: "H7" };
    expect(annotationGeometry(d, [base]).texts.map((t) => t.s)).toEqual(["Ø40H7", "(40,025/40,000)"]);
    expect(annotationGeometry(d, [{ ...base, tolShow: "code" }]).texts.map((t) => t.s)).toEqual(["Ø40H7"]);
    expect(annotationGeometry({ ...d, fitShow: undefined }, [{ ...base, suffix: " H7/g6" }]).texts.map((t) => t.s)).toEqual(["Ø40 H7/g6", "(+0,025/0 · −0,009/−0,025)"]);
    // přípona, která není uložení, se nemění
    expect(annotationGeometry(d, [{ ...base, suffix: " ±0,1" }]).texts.map((t) => t.s)).toEqual(["Ø40 ±0,1"]);
    // úchylky se nepřekryjí s jiným textem listu: výchozí místo za popiskem je obsazené → náhradní poloha (nad sebou / pod čarou)
    const dd = makeDrawing(plate(), meta, { dimensions: "none" });
    const g0 = annotationGeometry(dd, [base]);
    const A = g0.texts[1];
    const free = withAnnotations(dd, [base]).texts.find((t) => t.s === "(+0,025/0)")!;
    expect([free.x, free.y]).toEqual([A.x, A.y]);
    const blocked = withAnnotations({ ...dd, texts: [...dd.texts, { x: A.x + 2, y: A.y, s: "XXXXXXXX", size: 3.5 }] }, [base]);
    const moved = blocked.texts.filter((t) => t.s === "(+0,025/0)" || t.s === "+0,025" || t.s === "0");
    expect(moved.length).toBeGreaterThan(0);
    expect(moved.every((t) => t.x !== A.x || t.y !== A.y)).toBe(true);
  }, 30_000);
});
