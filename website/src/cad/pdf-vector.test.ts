import { describe, expect, it } from "vitest";
import { PDF_ENTITY_MAX, extractPdfPaths, pdfPathsToEntities, type Mat, type PdfPath } from "./pdf-vector";
import { PDFJS_VERSION } from "./pdfjs";
import { PT_MM } from "./sketch-underlay";
import type { SketchEntity, Vec2 } from "./types";

/** kódy operátorů pdf.js (stabilní napříč verzemi; test s opravdovým PDF níže bere tabulku z knihovny) */
const OPS = { save: 10, restore: 11, transform: 12, stroke: 20, closeStroke: 21, fill: 22, eoFill: 23, fillStroke: 24, eoFillStroke: 25, closeFillStroke: 26, closeEOFillStroke: 27, endPath: 28, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75, beginGroup: 76, endGroup: 77, beginAnnotation: 80, endAnnotation: 81, constructPath: 91 };
const M = 0;
const L = 1;
const C = 2;
const Q = 3;
const Z = 4;
const path = (paint: number, data: number[]) => [paint, [new Float32Array(data)], new Float32Array(4)];
const list = (ops: [number, unknown][]) => ({ fnArray: ops.map((o) => o[0]), argsArray: ops.map((o) => o[1]) });
/** stránka 200 × 100 bodů: počátek PDF vlevo dole → stránka s počátkem vlevo nahoře */
const VIEW: Mat = [1, 0, 0, -1, 0, 100];
/** bod stránky → mm skici: 1 bod = 1 mm, osa Y nahoru, počátek v levém dolním rohu stránky */
const toSketch = (p: Vec2): Vec2 => [p[0], 100 - p[1]];
const types = (es: SketchEntity[]) => es.map((e) => e.type);
/** Bézierův čtvrtoblouk kružnice (střed c, poloměr r) od úhlu a0 [°] o 90° proti směru hodin */
const quarter = (c: Vec2, r: number, a0: number): number[] => {
  const k = 0.5522847498 * r;
  const t = (a0 * Math.PI) / 180;
  const p = (ang: number, rad = r): Vec2 => [c[0] + rad * Math.cos(ang), c[1] + rad * Math.sin(ang)];
  const s = p(t);
  const e = p(t + Math.PI / 2);
  return [C, s[0] - k * Math.sin(t), s[1] + k * Math.cos(t), e[0] + k * Math.sin(t + Math.PI / 2), e[1] - k * Math.cos(t + Math.PI / 2), e[0], e[1]];
};

describe("cesty stránky PDF z operátorů pdf.js (extractPdfPaths)", () => {
  it("úsečka, obdélník (uzavřená cesta) a Bézierova křivka v souřadnicích stránky (osa Y dolů)", () => {
    const paths = extractPdfPaths(list([[OPS.constructPath, path(OPS.stroke, [M, 10, 20, L, 60, 20])], [OPS.constructPath, path(OPS.stroke, [M, 0, 0, L, 30, 0, L, 30, 10, L, 0, 10, Z])], [OPS.constructPath, path(OPS.stroke, [M, 0, 0, C, 10, 30, 20, 30, 30, 0])]]), OPS, VIEW);
    expect(paths).toHaveLength(3);
    expect(paths[0]).toEqual({ start: [10, 80], segs: [{ k: "L", b: [60, 80] }], closed: false, stroke: true, fill: false });
    expect(paths[1].closed).toBe(true);
    expect(paths[1].segs.map((s) => s.b)).toEqual([[30, 100], [30, 90], [0, 90]]);
    expect(paths[2].segs[0]).toEqual({ k: "C", c1: [10, 70], c2: [20, 70], b: [30, 100] });
  });
  it("transformace: cm, uložení / obnovení stavu a matice vnořeného formuláře", () => {
    const line = path(OPS.stroke, [M, 0, 0, L, 10, 0]);
    const paths = extractPdfPaths(
      list([
        [OPS.save, null],
        [OPS.transform, [2, 0, 0, 2, 5, 5]], // měřítko 2× a posun
        [OPS.constructPath, line],
        [OPS.paintFormXObjectBegin, [[0, 1, -1, 0, 10, 0], null]], // formulář otočený o 90° a posunutý
        [OPS.constructPath, line],
        [OPS.paintFormXObjectEnd, []],
        [OPS.restore, null],
        [OPS.constructPath, line],
      ]),
      OPS,
      [1, 0, 0, 1, 0, 0],
    );
    expect(paths.map((p) => [p.start, p.segs[0].b])).toEqual([
      [[5, 5], [25, 5]],
      [[25, 5], [25, 25]], // (0,0) → (10,0) → ×2 +5; (10,0) → (10,10) → ×2 +5
      [[0, 0], [10, 0]],
    ]);
  });
  it("ořezové cesty se vynechají; výplň a obrys se rozlišují; „zavřít a obtáhnout“ cestu uzavírá", () => {
    const tri = [M, 0, 0, L, 10, 0, L, 5, 8];
    const paths = extractPdfPaths(list([[OPS.constructPath, path(OPS.endPath, tri)], [OPS.constructPath, path(OPS.fill, tri)], [OPS.constructPath, path(OPS.fillStroke, tri)], [OPS.constructPath, path(OPS.closeStroke, tri)], [OPS.constructPath, [OPS.stroke, [null], null]]]), OPS);
    expect(paths.map((p) => [p.stroke, p.fill, p.closed])).toEqual([[false, true, false], [true, true, false], [true, false, true]]);
  });
  it("více dílčích cest v jednom operátoru, kvadratická křivka, úsek po uzavření pokračuje od začátku", () => {
    const paths = extractPdfPaths(list([[OPS.constructPath, path(OPS.stroke, [M, 0, 0, L, 10, 0, M, 20, 0, L, 30, 0, L, 30, 10, Z, L, 20, -10, M, 50, 50, Q, 60, 60, 70, 50])]]), OPS, [1, 0, 0, 1, 0, 0]);
    expect(paths).toHaveLength(4);
    expect(paths[1]).toMatchObject({ start: [20, 0], closed: true });
    expect(paths[2]).toMatchObject({ start: [20, 0], segs: [{ k: "L", b: [20, -10] }], closed: false });
    const q = paths[3].segs[0] as { k: "C"; c1: Vec2; c2: Vec2; b: Vec2 };
    expect(q.k).toBe("C");
    expect(q.c1[0]).toBeCloseTo(50 + (2 * 10) / 3, 9);
    expect(q.c1[1]).toBeCloseTo(50 + (2 * 10) / 3, 9);
    expect(q.c2[0]).toBeCloseTo(70 - (2 * 10) / 3, 9);
    expect(q.b).toEqual([70, 50]);
  });
});

describe("entity skici z cest PDF (pdfPathsToEntities)", () => {
  const P = (start: Vec2, segs: PdfPath["segs"], closed = false, stroke = true): PdfPath => ({ start, segs, closed, stroke, fill: !stroke });
  const ident = (p: Vec2): Vec2 => p;
  it("jedna úsečka → úsečka, více navazujících → lomená čára, uzavřený obdélník → uzavřená lomená čára se 4 body", () => {
    const r = pdfPathsToEntities([P([0, 0], [{ k: "L", b: [10, 0] }]), P([0, 5], [{ k: "L", b: [10, 5] }, { k: "L", b: [10, 15] }]), P([20, 0], [{ k: "L", b: [50, 0] }, { k: "L", b: [50, 10] }, { k: "L", b: [20, 10] }], true)], ident);
    expect(types(r.entities)).toEqual(["line", "polyline", "polyline"]);
    expect(r.entities[0]).toMatchObject({ a: [0, 0], b: [10, 0] });
    expect(r.entities[1]).toMatchObject({ points: [[0, 5], [10, 5], [10, 15]], closed: false });
    expect(r.entities[2]).toMatchObject({ points: [[20, 0], [50, 0], [50, 10], [20, 10]], closed: true });
    expect(r).toMatchObject({ found: 3, paths: 3 });
  });
  it("čtyři Bézierovy čtvrtoblouky = kružnice; dva = oblouk se správným středem, poloměrem a směrem", () => {
    const circle = extractPdfPaths(list([[OPS.constructPath, path(OPS.stroke, [M, 70, 40, ...quarter([50, 40], 20, 0), ...quarter([50, 40], 20, 90), ...quarter([50, 40], 20, 180), ...quarter([50, 40], 20, 270), Z])]]), OPS, VIEW);
    const rc = pdfPathsToEntities(circle, toSketch);
    expect(rc.entities).toHaveLength(1);
    expect(rc.entities[0]).toMatchObject({ type: "circle", r: 20 });
    const c = rc.entities[0] as Extract<SketchEntity, { type: "circle" }>;
    expect([c.cx, c.cy]).toEqual([50, 40]);
    // půlkruh od 0° do 180° (v PDF proti směru hodin) – ve skice má osa Y stejný smysl, bod uprostřed je nahoře
    const half = extractPdfPaths(list([[OPS.constructPath, path(OPS.stroke, [M, 70, 40, ...quarter([50, 40], 20, 0), ...quarter([50, 40], 20, 90)])]]), OPS, VIEW);
    const ra = pdfPathsToEntities(half, toSketch);
    expect(types(ra.entities)).toEqual(["arc"]);
    const arc = ra.entities[0] as Extract<SketchEntity, { type: "arc" }>;
    expect(arc.a).toEqual([70, 40]);
    expect(arc.c).toEqual([30, 40]);
    expect(arc.b[0]).toBeCloseTo(50, 3);
    expect(arc.b[1]).toBeCloseTo(60, 3);
  });
  it("obrys se zaoblením: úsečky a oblouk v jedné cestě dají úsečky / lomené čáry a oblouk", () => {
    // └ tvar s rohem R10: (0,30) → (0,10) ⌒ (10,0) → (40,0)
    const k = 0.5522847498 * 10;
    const r = pdfPathsToEntities([P([0, 30], [{ k: "L", b: [0, 10] }, { k: "C", c1: [0, 10 - k], c2: [10 - k, 0], b: [10, 0] }, { k: "L", b: [40, 0] }])], ident);
    expect(types(r.entities)).toEqual(["line", "arc", "line"]);
    const arc = r.entities[1] as Extract<SketchEntity, { type: "arc" }>;
    expect(arc.a).toEqual([0, 10]);
    expect(arc.c).toEqual([10, 0]);
    expect(Math.hypot(arc.b[0] - 10, arc.b[1] - 10)).toBeCloseTo(10, 3); // bod oblouku leží na kružnici se středem [10; 10]
  });
  it("Bézierova křivka s řídicími body na tětivě je úsečka; obecná křivka je spline přes její body", () => {
    const r = pdfPathsToEntities([P([0, 0], [{ k: "C", c1: [10, 0], c2: [20, 0], b: [30, 0] }]), P([0, 10], [{ k: "C", c1: [10, 40], c2: [20, -20], b: [30, 10] }])], ident);
    expect(types(r.entities)).toEqual(["line", "spline"]);
    const sp = r.entities[1] as Extract<SketchEntity, { type: "spline" }>;
    expect(sp.points[0]).toEqual([0, 10]);
    expect(sp.points[sp.points.length - 1]).toEqual([30, 10]);
    expect(sp.points.length).toBeGreaterThanOrEqual(5);
    // body spline leží na křivce: v polovině je Bézier v bodě [15; 10]
    expect(sp.points[(sp.points.length - 1) / 2]).toEqual([15, 10]);
  });
  it("hladce navazující křivky tvoří jeden spline, křivky s ostrým zlomem dva", () => {
    const smooth = pdfPathsToEntities([P([0, 0], [{ k: "C", c1: [5, 10], c2: [15, 10], b: [20, 0] }, { k: "C", c1: [25, -10], c2: [35, -8], b: [40, 5] }])], ident);
    expect(types(smooth.entities)).toEqual(["spline"]);
    const sharp = pdfPathsToEntities([P([0, 0], [{ k: "C", c1: [5, 10], c2: [15, 10], b: [20, 0] }, { k: "C", c1: [25, 10], c2: [35, 12], b: [40, 5] }])], ident);
    expect(types(sharp.entities)).toEqual(["spline", "spline"]);
  });
  it("shodné čáry kreslené víckrát se vloží jednou; kratší než minLen se vynechají", () => {
    const r = pdfPathsToEntities([P([0, 0], [{ k: "L", b: [10, 0] }]), P([10, 0], [{ k: "L", b: [0, 0] }]), P([0, 0], [{ k: "L", b: [10, 0] }]), P([5, 5], [{ k: "L", b: [5.001, 5] }])], ident);
    expect(r.entities).toHaveLength(1);
  });
  it("vyplněné cesty se berou jen na vyžádání, nebo když stránka žádné obrysy nemá", () => {
    const stroke = P([0, 0], [{ k: "L", b: [10, 0] }]);
    const fill = P([0, 5], [{ k: "L", b: [10, 5] }, { k: "L", b: [5, 9] }], true, false);
    expect(pdfPathsToEntities([stroke, fill], ident).entities).toHaveLength(1);
    expect(pdfPathsToEntities([stroke, fill], ident, { fills: true }).entities).toHaveLength(2);
    expect(types(pdfPathsToEntities([fill], ident).entities)).toEqual(["polyline"]);
  });
  it("nad limit zůstanou nejdelší čáry a hlásí se celkový počet", () => {
    const many = Array.from({ length: 30 }, (_, i) => P([0, i], [{ k: "L", b: [i + 1, i] }]));
    const r = pdfPathsToEntities(many, ident, { max: 5 });
    expect(r.found).toBe(30);
    expect(r.entities.map((e) => (e as { b: Vec2 }).b[0]).sort((a, b) => a - b)).toEqual([26, 27, 28, 29, 30]);
    expect(PDF_ENTITY_MAX).toBeGreaterThanOrEqual(1000);
  });
  it("měřítko a natočení podkladu: kružnice zůstane kružnicí s přepočteným poloměrem", () => {
    const circle = extractPdfPaths(list([[OPS.constructPath, path(OPS.stroke, [M, 70, 40, ...quarter([50, 40], 20, 0), ...quarter([50, 40], 20, 90), ...quarter([50, 40], 20, 180), ...quarter([50, 40], 20, 270), Z])]]), OPS, VIEW);
    const t = (30 * Math.PI) / 180;
    const map = (p: Vec2): Vec2 => { const x = p[0] * 2.5; const y = -p[1] * 2.5; return [x * Math.cos(t) - y * Math.sin(t) + 7, x * Math.sin(t) + y * Math.cos(t) - 3]; };
    const r = pdfPathsToEntities(circle, map);
    expect(r.entities[0]).toMatchObject({ type: "circle", r: 50 });
  });
});

describe("opravdové PDF: jsPDF → pdf.js → entity skici", () => {
  it("verze pdf.js v aplikaci odpovídá nainstalovanému balíčku (soubory v public/vendor se jmenují podle ní)", async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    expect(pdfjs.version).toBe(PDFJS_VERSION);
  });
  it("úsečky, obdélník, kružnice a křivka z PDF v mm (1 bod = 25,4/72 mm), text se nepřevádí", async () => {
    const { jsPDF } = await import("jspdf");
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
    doc.setLineWidth(0.3);
    doc.line(20, 20, 120, 20);
    doc.line(120, 20, 120, 80);
    doc.rect(30, 100, 50, 30);
    doc.circle(200, 60, 25);
    doc.lines([[10, 10], [20, -5], [5, 5, 15, 15, 30, 0]], 150, 150);
    doc.text("Rozmer 100", 40, 15);
    const task = pdfjs.getDocument({ data: new Uint8Array(doc.output("arraybuffer")), verbosity: 0 });
    const pdf = await task.promise;
    expect(pdf.numPages).toBe(1);
    const page = await pdf.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    expect(vp.width * PT_MM).toBeCloseTo(297, 1);
    const ops = await page.getOperatorList();
    const paths = extractPdfPaths(ops, pdfjs.OPS as unknown as Record<string, number>, vp.transform as Mat);
    expect(paths).toHaveLength(5);
    expect(paths.every((p) => p.stroke)).toBe(true);
    // stránka (body, osa Y dolů) → mm s počátkem vlevo nahoře a osou Y nahoru, jako to dělá podklad skici
    const r = pdfPathsToEntities(paths, (p) => [p[0] * PT_MM, -p[1] * PT_MM]);
    expect(types(r.entities)).toEqual(["line", "line", "polyline", "circle", "polyline", "spline"]);
    const [l1, l2, rect, circ, pl, sp] = r.entities as [Extract<SketchEntity, { type: "line" }>, Extract<SketchEntity, { type: "line" }>, Extract<SketchEntity, { type: "polyline" }>, Extract<SketchEntity, { type: "circle" }>, Extract<SketchEntity, { type: "polyline" }>, Extract<SketchEntity, { type: "spline" }>];
    const near = (p: Vec2, q: Vec2) => { expect(p[0]).toBeCloseTo(q[0], 2); expect(p[1]).toBeCloseTo(q[1], 2); };
    near(l1.a, [20, -20]);
    near(l1.b, [120, -20]);
    near(l2.b, [120, -80]);
    expect(rect.closed).toBe(true);
    expect(rect.points).toHaveLength(4);
    near(rect.points[0], [30, -100]);
    near(rect.points[2], [80, -130]);
    near([circ.cx, circ.cy], [200, -60]);
    expect(circ.r).toBeCloseTo(25, 2);
    near(pl.points[0], [150, -150]);
    near(pl.points[2], [180, -155]);
    near(sp.points[0], [180, -155]);
    near(sp.points[sp.points.length - 1], [210, -155]);
    await task.destroy();
  }, 30000);
});
