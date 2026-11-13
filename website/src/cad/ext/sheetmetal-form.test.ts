import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildShape } from "../build";
import { countSub, isValidShape } from "../check";
import { newExtFeature } from "../defaults";
import { emptyDoc, type CadDoc, type Feature, type Vec3 } from "../types";
import "./index";
import { bendAllowance, bendTable, flatLayout, flatToDxf, flatToSvg, type EdgeGeom, type FaceGeom } from "./sheetmetal-flat";
import { filletPath, formPoints, formSection, pointOnPlane, shellLoop, toolAxes } from "./sheetmetal-form-geom";
import { crossBreakRise } from "./sheetmetal-form";
import { makeDrawing } from "../drawing";
import { formNotesOfDoc } from "../drawing-doc";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

const T = 2;
const RB = 1;
const K = 0.44;
const PLATE = 120 * 80 * T;

/** deska 120 × 80 na XY, tloušťka 2 nad skicou (z ∈ [0, 2]), horní plocha z = 2 */
function plateDoc(rr = 0): CadDoc {
  const doc = emptyDoc("Plech");
  const sk: Feature = { id: "s1", name: "Obrys", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [{ id: "e1", type: "rect", cx: 0, cy: 0, w: 120, h: 80, r: rr, angle: 0 }] };
  doc.features.push(sk);
  const base = newExtFeature(doc, "sheet.base", {});
  if (base.type === "ext") base.data = { ...base.data, sketchId: "s1", direction: "normal", t: T, r: RB, k: K };
  doc.features.push(base);
  return doc;
}
function addTool(doc: CadDoc, ext: string, data: Record<string, unknown>) {
  const f = newExtFeature(doc, ext, {});
  if (f.type === "ext") f.data = { ...f.data, ...data };
  doc.features.push(f);
  return f;
}
const pathSketch = (id: string, entities: unknown[], offset = T): Feature => ({ id, name: "Dráha", type: "sketch", plane: { kind: "base", name: "XY", offset }, entities }) as Feature;

async function build(doc: CadDoc) {
  const res = await buildShape(doc);
  expect(res.status.map((s) => s.error ?? "ok")).toEqual(res.status.map(() => "ok"));
  const body = res.body!;
  expect(isValidShape(body)).toBe(true);
  expect(countSub(body, "SOLID")).toBe(1);
  return body;
}
const vol = (s: r.Shape3D) => r.measureVolume(s);
const bb = (s: r.Shape3D) => s.boundingBox.bounds as [Vec3, Vec3];
/** objem materiálu tělesa v kvádru */
const inBox = (s: r.Shape3D, a: Vec3, b: Vec3) => {
  try {
    return r.measureVolume(s.clone().intersect(r.makeBox(a, b)));
  } catch {
    return 0;
  }
};
const boxVol = (a: Vec3, b: Vec3) => (b[0] - a[0]) * (b[1] - a[1]) * (b[2] - a[2]);

describe("tvářecí nástroje – 2D řez a umístění", () => {
  it("ekvidistanta: soustředné oblouky R / R + t a tečné body", () => {
    const p = filletPath([[0, 4], [10, 4], [14, 0], [20, 0]], 1, 2);
    expect(p.fits).toBe(true);
    const arcs = p.top.filter((s) => s.kind === "arc");
    expect(arcs).toHaveLength(2);
    expect(p.botStart).toEqual([0, 2]);
    expect(p.botEnd[1]).toBeCloseTo(-2, 9);
    // konvexní roh nahoře: horní oblouk R + t = 3, spodní R = 1 (stejný střed)
    const top = p.top.find((s) => s.kind === "arc")!;
    const bot = p.bottom.find((s) => s.kind === "arc")!;
    const rad = (s: typeof top, c: [number, number]) => Math.hypot(s.a[0] - c[0], s.a[1] - c[1]);
    // střed prvního zaoblení leží o R + t pod horní plochou
    const c: [number, number] = [top.a[0], 4 - 3];
    expect(rad(top, c)).toBeCloseTo(3, 9);
    expect(rad(bot, c)).toBeCloseTo(1, 9);
    expect(shellLoop(p).length).toBeGreaterThan(6);
  });
  it("automatický poloměr se zmenší, zadaný příliš velký a malý nástroj jsou chyby", () => {
    const s = formSection("dimple", { diameter: 12, height: 2, wallAngle: 60 }, 2, 2);
    expect(s.R).toBeGreaterThan(0);
    expect(s.R).toBeLessThan(2);
    expect(() => formSection("dimple", { diameter: 12, height: 2, wallAngle: 60, radius: 3 }, 2, 2)).toThrow(/nevejde/);
    expect(() => formSection("dimple", { diameter: 4, height: 5, wallAngle: 45 }, 2, 2)).toThrow(/malý/);
    expect(() => formSection("bridge", { length: 6, width: 8, height: 4, wallAngle: 45 }, 2, 1)).toThrow(/krátká/);
  });
  it("osy nástroje, body na rovině plochy a zápis bodů", () => {
    const a = toolAxes([0, 0, 1], 0);
    expect(a.u).toEqual([1, 0, 0]);
    expect(a.v[1]).toBeCloseTo(1, 12);
    const b = toolAxes([0, 0, 1], 90);
    expect(b.u[1]).toBeCloseTo(1, 12);
    expect(b.v[0]).toBeCloseTo(-1, 12);
    expect(pointOnPlane([5, 6], [0, 0, 2], [0, 0, 1])).toEqual([5, 6, 2]);
    expect(pointOnPlane([5, 6], [0, 43, 0], [0, 1, 0])).toEqual([5, 43, 6]);
    expect(pointOnPlane([5, 6, 9], [0, 0, 2], [0, 0, 1])).toEqual([5, 6, 2]);
    expect(formPoints([10, 20])).toEqual([[10, 20]]);
    expect(formPoints([[1, 2], [3, 4, 5]])).toEqual([[1, 2], [3, 4, 5]]);
    expect(() => formPoints([1, 2, 3, 4])).toThrow();
  });
});

describe("tvářecí nástroje – jádro", () => {
  it("prolis: skořepina tloušťky plechu, výška, dutina pod ním, počet ploch", async () => {
    const doc = plateDoc();
    addTool(doc, "sheet.dimple", { points: [[0, 0]], diameter: 16, height: 3, wallAngle: 60 });
    const body = await build(doc);
    const [mn, mx] = bb(body);
    expect(mx[2]).toBeCloseTo(T + 3, 6);
    expect(mn[2]).toBeCloseTo(0, 6);
    // deska 6 ploch + horní (2 anuloidy, kužel, víčko) + spodní totéž
    expect(body.faces.length).toBe(14);
    expect(body.faces.filter((f) => f.geomType === "TORUS")).toHaveLength(4);
    expect(body.faces.filter((f) => f.geomType === "CONE")).toHaveLength(2);
    // pod víčkem dutina (spodní plocha víčka je v z = 2 + 3 − 2 = 3), víčko plné
    expect(inBox(body, [-1, -1, -1], [1, 1, 2.9])).toBeCloseTo(0, 6);
    expect(inBox(body, [-1, -1, 3.05], [1, 1, 4.95])).toBeCloseTo(boxVol([-1, -1, 3.05], [1, 1, 4.95]), 4);
    expect(vol(body)).toBeGreaterThan(PLATE);
    expect(vol(body)).toBeLessThan(PLATE + 150);
  }, 120_000);

  it("prolis dolů a ostré rohy", async () => {
    const doc = plateDoc();
    addTool(doc, "sheet.dimple", { points: [[0, 0]], diameter: 16, height: 3, direction: "down", rounded: false });
    const body = await build(doc);
    const [mn, mx] = bb(body);
    expect(mn[2]).toBeCloseTo(-3, 6);
    expect(mx[2]).toBeCloseTo(T, 6);
    // ostré vnitřní rohy: vnější plochy zaoblené poloměrem t, vnitřní ostré → jen 2 anuloidy
    expect(body.faces.filter((f) => f.geomType === "TORUS")).toHaveLength(2);
  }, 120_000);

  it("žaluzie: prostřih otevřený, stříška nad dutinou, uzavřené konce", async () => {
    const doc = plateDoc();
    addTool(doc, "sheet.louvre", { points: [[0, 0]], length: 40, width: 8, height: 4 });
    const body = await build(doc);
    expect(bb(body)[1][2]).toBeCloseTo(T + 4, 6);
    // otevřená strana vlevo (+Y): štěrbina y ∈ [4, 4,2] skrz
    expect(inBox(body, [-15, 4.03, -1], [15, 4.17, 8])).toBeCloseTo(0, 6);
    // pod rovnou částí stříšky (spodní plocha z = 4, zaoblení začíná u y ≈ 1,24) je volno až po spodek plechu
    expect(inBox(body, [-15, 1.5, 0.1], [15, 3.9, 3.9])).toBeCloseTo(0, 6);
    // konce uzavřené plnými čely tloušťky t (x ∈ [18, 20])
    expect(inBox(body, [18.2, 0.5, 0.5], [19.8, 3.5, 3.5])).toBeCloseTo(boxVol([18.2, 0.5, 0.5], [19.8, 3.5, 3.5]), 4);
    // otevřená vpravo: štěrbina u −Y
    const doc2 = plateDoc();
    addTool(doc2, "sheet.louvre", { points: [[0, 0]], open: "right" });
    const b2 = await build(doc2);
    expect(inBox(b2, [-15, -4.17, -1], [15, -4.03, 8])).toBeCloseTo(0, 6);
    expect(inBox(b2, [-15, 4.03, 0.2], [15, 4.17, 1.8])).toBeGreaterThan(1);
  }, 120_000);

  it("žaluzie ve třech bodech, natočená o 90°, dolů", async () => {
    const doc = plateDoc();
    addTool(doc, "sheet.louvre", { points: [[-30, 0], [0, 0], [30, 0]], rotation: 90, direction: "down" });
    const body = await build(doc);
    const [mn] = bb(body);
    expect(mn[2]).toBeCloseTo(-4, 6);
    // natočení 90°: délka podél Y, otevřená strana (vlevo od +Y) = −X → štěrbina x ∈ [x0 − 4,2; x0 − 4]
    for (const x0 of [-30, 0, 30]) expect(inBox(body, [x0 - 4.17, -15, -8], [x0 - 4.03, 15, 3])).toBeCloseTo(0, 6);
  }, 120_000);

  it("výstřih (jazýček): otevřený ze tří stran, pod jazýčkem volno", async () => {
    const doc = plateDoc();
    addTool(doc, "sheet.lance", { points: [[0, 0]], length: 20, width: 10, height: 3, wallAngle: 45 });
    const body = await build(doc);
    expect(bb(body)[1][2]).toBeCloseTo(T + 3, 6);
    expect(inBox(body, [10.03, -4, -1], [10.17, 4, 8])).toBeCloseTo(0, 6); // otevřený konec (+X)
    expect(inBox(body, [-5, 5.03, -1], [9, 5.17, 8])).toBeCloseTo(0, 6); // boky
    expect(inBox(body, [-5, -5.17, -1], [9, -5.03, 8])).toBeCloseTo(0, 6);
    expect(inBox(body, [0, -4, 0.1], [9, 4, 2.9])).toBeCloseTo(0, 6); // pod jazýčkem
    expect(inBox(body, [0, -4, 3.1], [9, 4, 4.9])).toBeCloseTo(boxVol([0, -4, 3.1], [9, 4, 4.9]), 4); // jazýček
    // u ohybu (−X) je jazýček spojený s plechem
    expect(inBox(body, [-12, -4, 0.1], [-11, 4, 1.9])).toBeCloseTo(boxVol([-12, -4, 0.1], [-11, 4, 1.9]), 4);
  }, 120_000);

  it("můstek a vodítko desky: boky otevřené, konce spojené, mezera pro desku", async () => {
    const doc = plateDoc();
    addTool(doc, "sheet.bridge", { points: [[0, 0]], length: 30, width: 8, height: 3, wallAngle: 45 });
    const body = await build(doc);
    expect(bb(body)[1][2]).toBeCloseTo(T + 3, 6);
    expect(inBox(body, [-14, 4.03, -1], [14, 4.17, 8])).toBeCloseTo(0, 6);
    expect(inBox(body, [-14, -4.17, -1], [14, -4.03, 8])).toBeCloseTo(0, 6);
    expect(inBox(body, [-5, -3, 0.1], [5, 3, 2.9])).toBeCloseTo(0, 6);
    const doc2 = plateDoc();
    addTool(doc2, "sheet.cardguide", { points: [[0, 0]], length: 25, width: 6, slot: 1.6 });
    const b2 = await build(doc2);
    expect(bb(b2)[1][2]).toBeCloseTo(T + 1.6 + T, 6);
    // mezera mezi rovinou plechu a spodkem můstku = 1,6 mm
    expect(inBox(b2, [-3, -2, T + 0.05], [3, 2, T + 1.55])).toBeCloseTo(0, 6);
    expect(inBox(b2, [-3, -2, T + 1.65], [3, 2, T + 3.55])).toBeCloseTo(boxVol([-3, -2, T + 1.65], [3, 2, T + 3.55]), 4);
  }, 120_000);

  it("lem díry: otvor skrz, svislý límec dané výšky", async () => {
    const doc = plateDoc();
    addTool(doc, "sheet.collar", { points: [[10, 5]], diameter: 10, height: 4 });
    const body = await build(doc);
    expect(bb(body)[1][2]).toBeCloseTo(T + 4, 6);
    const hole = r.makeCylinder(4.95, 20, [10, 5, -5], [0, 0, 1]);
    expect(r.measureVolume(body.clone().intersect(hole))).toBeCloseTo(0, 6);
    // stěna límce r ∈ [5, 7] nad zaoblením
    expect(inBox(body, [15.2, 4.7, 4.5], [16.8, 5.3, 5.8])).toBeCloseTo(boxVol([15.2, 4.7, 4.5], [16.8, 5.3, 5.8]), 4);
    expect(body.faces.filter((f) => f.geomType === "CYLINDRE")).toHaveLength(2); // vnější a vnitřní stěna límce
  }, 120_000);

  it("okraj nástroje u hrany plechu nepřečnívá; žebro s ostrým rohem mimo plech je chyba", async () => {
    // prolis Ø12: stopa ≈ 6,6, výřez 7,1, okraj až 7,6 – střed 52,6 od středu → výřez končí 0,3 před hranou, okraj by přečníval
    const doc = plateDoc();
    addTool(doc, "sheet.dimple", { points: [[52.6, 0]], diameter: 12, height: 2 });
    const body = await build(doc);
    expect(bb(body)[1][0]).toBeCloseTo(60, 6);
    expect(bb(body)[0][0]).toBeCloseTo(-60, 6);
    // trojúhelníková dráha s ostrým rohem: pokos tvarované oblasti uvnitř plechu (okraj a výřez se ořežou), u hrany ✗
    const tri = (x: number) => {
      const d = plateDoc();
      d.features.push(pathSketch("s2", [{ id: "p", type: "polyline", points: [[x, -20], [0, -20], [0, 12]], closed: true }]));
      addTool(d, "sheet.bead", { sketchId: "s2", width: 6, height: 2 });
      return d;
    };
    const inside = await build(tri(-46));
    expect(bb(inside)[0][0]).toBeCloseTo(-60, 6);
    const res = await buildShape(tri(-54));
    expect(res.status[3].error).toMatch(/neleží celý/);
  }, 120_000);

  it("chyby: přes okraj plechu, překryv nástrojů, bez bodu", async () => {
    const off = plateDoc();
    addTool(off, "sheet.dimple", { points: [[57, 0]] });
    expect((await buildShape(off)).status[2].error).toMatch(/neleží celý/);
    const ov = plateDoc();
    addTool(ov, "sheet.dimple", { points: [[0, 0], [10, 0]] });
    expect((await buildShape(ov)).status[2].error).toMatch(/překrývají/);
    const none = plateDoc();
    addTool(none, "sheet.louvre", {});
    expect((await buildShape(none)).status[2].error).toMatch(/bod umístění/);
  }, 120_000);

  it("žebro podél úsečky, lomené čáry, oblouku a kružnice", async () => {
    const cases: [unknown[], number][] = [
      [[{ id: "l", type: "line", a: [-40, 0], b: [40, 0] }], 1],
      [[{ id: "p", type: "polyline", points: [[-40, -20], [30, -20], [30, 25]], closed: false }], 1],
      [[{ id: "l", type: "line", a: [-40, -20], b: [0, -20] }, { id: "a", type: "arc", a: [0, -20], b: [20 * Math.SQRT1_2, -20 * Math.SQRT1_2], c: [20, 0] }], 1],
      [[{ id: "c", type: "circle", cx: 0, cy: 0, r: 25 }], 1],
    ];
    for (const [ents] of cases) {
      const doc = plateDoc();
      doc.features.push(pathSketch("s2", ents));
      addTool(doc, "sheet.bead", { sketchId: "s2", width: 8, height: 2, wallAngle: 60 });
      const body = await build(doc);
      expect(bb(body)[1][2]).toBeCloseTo(T + 2, 6);
      expect(vol(body)).toBeGreaterThan(PLATE);
    }
    // přímé žebro: dutina pod ním, zaoblené konce, hřbet plný
    const doc = plateDoc();
    doc.features.push(pathSketch("s2", [{ id: "l", type: "line", a: [-40, 0], b: [40, 0] }]));
    addTool(doc, "sheet.bead", { sketchId: "s2", width: 8, height: 3, wallAngle: 60 });
    const body = await build(doc);
    // rovná část hřbetu |y| < 0,54 (zaoblení R + t = 3 mm odebere 1,73 mm z poloviční šířky 2,27 mm)
    expect(inBox(body, [-38, -0.4, -1], [38, 0.4, 2.95])).toBeCloseTo(0, 6);
    expect(inBox(body, [-38, -0.4, 3.05], [38, 0.4, 4.95])).toBeCloseTo(boxVol([-38, -0.4, 3.05], [38, 0.4, 4.95]), 3);
    expect(body.faces.some((f) => f.geomType === "TORUS" || f.geomType === "CONE" || f.geomType === "SPHERE")).toBe(true);
    expect(bb(body)[1][2]).toBeCloseTo(T + 3, 6);
  }, 200_000);

  it("nástroj na boční přírubě (vybraná plocha, 3D bod)", async () => {
    const doc = plateDoc();
    const base = (await buildShape(doc)).body!;
    const ei = base.edges.findIndex((e) => e.geomType === "LINE" && Math.abs(e.startPoint.y - 40) < 1e-6 && Math.abs(e.endPoint.y - 40) < 1e-6 && Math.abs(e.startPoint.z - T) < 1e-6 && Math.abs(e.endPoint.z - T) < 1e-6);
    const fl = newExtFeature(doc, "sheet.flange", { edges: [ei] });
    if (fl.type === "ext") fl.data = { ...fl.data, length: 30, angle: 90 };
    doc.features.push(fl);
    const b1 = (await buildShape(doc)).body!;
    const fo = b1.faces.findIndex((f) => f.geomType === "PLANE" && f.normalAt(f.center).y > 0.999 && Math.abs(f.center.y - (40 + RB + T)) < 1e-6);
    expect(fo).toBeGreaterThanOrEqual(0);
    addTool(doc, "sheet.dimple", { face: [fo], points: [[0, 43, 18]], diameter: 10, height: 2 });
    const body = await build(doc);
    expect(bb(body)[1][1]).toBeCloseTo(40 + RB + T + 2, 6);
  }, 120_000);
});

describe("křížový zlom", () => {
  it("skutečný zlom po úhlopříčkách: 4 + 4 trojúhelníkové plošky, výška vyklenutí, objem zachován", async () => {
    const doc = plateDoc();
    addTool(doc, "sheet.crossbreak", { angle: 1.5 });
    const body = await build(doc);
    const rise = crossBreakRise(40, 1.5);
    expect(rise).toBeCloseTo(40 * Math.tan((1.5 * Math.PI) / 180), 12);
    expect(bb(body)[1][2]).toBeCloseTo(T + rise, 6);
    expect(body.faces.length).toBe(12);
    expect(vol(body)).toBeCloseTo(PLATE, 3);
    // hrana úhlopříčky z rohu do vrcholu
    const diag = body.edges.some((e) => e.geomType === "LINE" && Math.hypot(e.startPoint.x, e.startPoint.y) < 1e-6 !== Math.hypot(e.endPoint.x, e.endPoint.y) < 1e-6 && Math.abs(Math.abs(e.startPoint.x) + Math.abs(e.endPoint.x) - 60) < 1e-6 && Math.max(e.startPoint.z, e.endPoint.z) > T + rise - 1e-6);
    expect(diag).toBe(true);
    const down = plateDoc();
    addTool(down, "sheet.crossbreak", { angle: 2, direction: "down" });
    const b2 = await build(down);
    expect(bb(b2)[0][2]).toBeCloseTo(-crossBreakRise(40, 2), 6);
  }, 120_000);

  it("výkres: úhlopříčky jako hrany v půdorysu, poznámka KŘÍŽOVÝ ZLOM v patičce", async () => {
    const doc = plateDoc();
    addTool(doc, "sheet.crossbreak", { angle: 1.5 });
    const body = await build(doc);
    const notes = formNotesOfDoc(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/^KŘÍŽOVÝ ZLOM 1,5° nahoru \(Křížový zlom/);
    const d = makeDrawing(body, { name: "Panel", material: "Ocel", formNotes: notes }, { views: { front: true, top: true, iso: false, left: false, right: false, back: false, bottom: false } });
    expect(d.texts.map((x) => x.s).join("\n")).toContain("KŘÍŽOVÝ ZLOM 1,5° nahoru");
    // půdorys: kromě obrysu i úhlopříčky (čáry, které nejsou vodorovné ani svislé)
    const top = d.views.find((v) => v.key === "top")!;
    expect(top).toBeTruthy();
    const diag = d.polys.filter((p) => p.pts.length === 2 && Math.abs(p.pts[0][0] - p.pts[1][0]) > 1 && Math.abs(p.pts[0][1] - p.pts[1][1]) > 1);
    expect(diag.length).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it("panel se zaoblenými rohy je chyba; s otvorem se zlom otvoru vyhne", async () => {
    const round = plateDoc(5);
    addTool(round, "sheet.crossbreak", {});
    expect((await buildShape(round)).status[2].error).toMatch(/rovné hrany/);
    const holes = plateDoc();
    addTool(holes, "sheet.collar", { points: [[30, 20]] });
    addTool(holes, "sheet.crossbreak", {});
    const body = await build(holes);
    expect(bb(body)[1][2]).toBeGreaterThan(T + 1);
    // nástroj za křížovým zlomem se položí na plošku zlomu, na které leží bod
    const after = plateDoc();
    addTool(after, "sheet.crossbreak", {});
    addTool(after, "sheet.dimple", { points: [[-35, 0]], diameter: 12, height: 2 });
    const b3 = await build(after);
    const rise = crossBreakRise(40, 1.5);
    // ploška u levé kratší strany: sklon atan(rise / 60); prolis nad ní o hloubku 2
    const zFacet = T + rise * (1 - 25 / 60);
    expect(inBox(b3, [-36, -1, zFacet + 1.2], [-34, 1, zFacet + 1.8])).toBeGreaterThan(0.5);
  }, 120_000);
});

describe("rozvin: stopa nástrojů ve vrstvě FORM a tabulka", () => {
  const kernelResolvers = (doc: CadDoc) => {
    const cache = new Map<number, r.Shape3D | null>();
    const get = async (fi: number) => {
      if (!cache.has(fi)) cache.set(fi, (await buildShape(doc, fi - 1)).body);
      return cache.get(fi);
    };
    return {
      edge: async (fi: number, ei: number): Promise<EdgeGeom | null> => {
        const e = (await get(fi))?.edges[ei];
        return e ? { a: [e.startPoint.x, e.startPoint.y, e.startPoint.z], b: [e.endPoint.x, e.endPoint.y, e.endPoint.z] } : null;
      },
      face: async (fi: number, fx: number): Promise<FaceGeom | null> => {
        const f = (await get(fi))?.faces[fx];
        if (!f) return null;
        const n = f.normalAt(f.center);
        return { origin: [f.center.x, f.center.y, f.center.z], normal: [n.x, n.y, n.z] };
      },
    };
  };

  it("nástroje na základu i na přírubě, žebro, křížový zlom → DXF/SVG/tabulka", async () => {
    const doc = plateDoc();
    const base = (await buildShape(doc)).body!;
    const ei = base.edges.findIndex((e) => e.geomType === "LINE" && Math.abs(e.startPoint.y - 40) < 1e-6 && Math.abs(e.endPoint.y - 40) < 1e-6 && Math.abs(e.startPoint.z - T) < 1e-6 && Math.abs(e.endPoint.z - T) < 1e-6);
    const fl = newExtFeature(doc, "sheet.flange", { edges: [ei] });
    if (fl.type === "ext") fl.data = { ...fl.data, length: 30, angle: 90 };
    doc.features.push(fl);
    addTool(doc, "sheet.dimple", { points: [[-40, -20], [-40, 10]] });
    addTool(doc, "sheet.louvre", { points: [[0, -10]], rotation: 90 });
    addTool(doc, "sheet.collar", { points: [[40, -20]] });
    doc.features.push(pathSketch("s2", [{ id: "l", type: "line", a: [20, 15], b: [50, 15] }]));
    addTool(doc, "sheet.bead", { sketchId: "s2" });
    addTool(doc, "sheet.crossbreak", { angle: 1.5 });
    const b1 = (await buildShape(doc)).body!;
    const fo = b1.faces.findIndex((f) => f.geomType === "PLANE" && f.normalAt(f.center).y > 0.999 && Math.abs(f.center.y - (40 + RB + T)) < 1e-6);
    addTool(doc, "sheet.dimple", { face: [fo], points: [[0, 43, 18]], diameter: 10, height: 2 });
    const res = await buildShape(doc);
    expect(res.status.every((s) => s.ok)).toBe(true);
    const kr = kernelResolvers(doc);
    const lay = await flatLayout(doc, kr.edge, doc.features.length, kr.face);
    const ba = bendAllowance(90, RB, T, K);
    expect(lay.bbox[1][1] - lay.bbox[0][1]).toBeCloseTo(80 + ba + 30, 4); // tvarování rozvin nemění
    expect(lay.forms.map((f) => f.tool)).toEqual(["dimple", "louvre", "collar", "bead", "crossbreak", "dimple"]);
    const dim = lay.forms[0];
    expect(dim.centers).toEqual([[-40, -20], [-40, 10]]);
    expect(dim.dir).toBe("up");
    const cb = lay.forms[4];
    expect(cb.lines).toHaveLength(2);
    expect(cb.lines[0][0]).toEqual([-60, -40]);
    expect(cb.lines[0][1]).toEqual([60, 40]);
    // nástroj na přírubě: v rozvinu na pásu příruby (y = 40 + BA + (18 − 3)), z pohledu základu dolů
    const onFlange = lay.forms[5];
    expect(onFlange.centers[0][0]).toBeCloseTo(0, 6);
    expect(onFlange.centers[0][1]).toBeCloseTo(40 + ba + 15, 4);
    expect(onFlange.dir).toBe("down");
    // stopa prolisu = kružnice poloměru tvarované oblasti
    const sec = formSection("dimple", { diameter: 12, height: Math.max(1.5, T), wallAngle: 60 }, T, RB);
    const arc = dim.segs.find((s) => s.kind === "arc")!;
    expect(Math.hypot(arc.a[0] + 40, arc.a[1] + 20)).toBeCloseTo(sec.s1, 6);
    // lem díry: orientační předděr
    expect(lay.forms[2].note).toMatch(/předděr/);
    const dxf = flatToDxf(lay, "Test");
    expect(dxf).toMatch(/\n2\nFORM\n70\n0\n62\n3\n/);
    const formEnts = dxf.split("\n").filter((l, i, a) => l === "FORM" && a[i - 1] === "8").length;
    expect(formEnts).toBeGreaterThan(30);
    expect(dxf).toContain("K\\U+0158\\U+00CD\\U+017D"); // KŘÍŽ
    expect(dxf).toContain("T1 PROLIS");
    const svg = flatToSvg(lay, "Test");
    expect(svg).toContain('data-form="crossbreak"');
    expect(svg).toContain("KŘÍŽOVÝ ZLOM");
    const table = bendTable(lay);
    expect(table).toContain("Tvarování");
    expect(table).toMatch(/T1: Prolis \(důlek\).*2 ks/);
    expect(table).toMatch(/Z1: KŘÍŽOVÝ ZLOM 1,5°, nahoru/);
    // 3D rozvin (prvek Rozvinout) zůstane rovný – tvarování se nerozvíjí
    addTool(doc, "sheet.unfold", {});
    const flat = await buildShape(doc);
    expect(flat.status[flat.status.length - 1].ok).toBe(true);
    expect(bb(flat.body!)[1][2] - bb(flat.body!)[0][2]).toBeCloseTo(T, 6);
  }, 300_000);

  it("rozvin bez jádra: výchozí horní plocha a uložená poloha plochy (faceGeom)", async () => {
    const doc = plateDoc();
    addTool(doc, "sheet.lance", { points: [[10, 10]] });
    addTool(doc, "sheet.bridge", { face: [5], faceGeom: { origin: [0, 0, 2], normal: [0, 0, 1] }, points: [[-30, -20]], rotation: 90 });
    const lay = await flatLayout(doc, () => null);
    expect(lay.forms.map((f) => f.centers[0])).toEqual([[10, 10], [-30, -20]]);
    // výstřih: 3 štěrbiny + obrys (4 úsečky)
    expect(lay.forms[0].segs.filter((s) => s.kind === "line")).toHaveLength(7);
    // bez polohy plochy (plocha číslem, bez resolveru) → varování, nástroj vynechán
    const doc2 = plateDoc();
    addTool(doc2, "sheet.dimple", { face: [3], points: [[0, 0]] });
    const lay2 = await flatLayout(doc2, () => null);
    expect(lay2.forms).toHaveLength(0);
    expect(lay2.warnings.join(" ")).toMatch(/polohu plochy/);
  });
});
