import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc, registerTextFont } from "../build";
import { refInfo } from "../ref-resolve";
import { emptyDoc, type CadDoc, type Feature, type Vec3 } from "../types";
import { checkDatumOrder } from "./refs-more";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
  const font = readFileSync(path.resolve(__dirname, "../../../public/fonts/Roboto-Bold.ttf"));
  await registerTextFont(font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength) as ArrayBuffer);
}, 60_000);

type Shape = r.Shape3D;
const doc = (features: Feature[]): CadDoc => ({ ...emptyDoc("t"), features });
const box = (id: string, size: Vec3, position: Vec3, mode: "new" | "add" = "add", extra: Partial<Extract<Feature, { type: "box" }>> = {}): Feature => ({ id, name: id, type: "box", size, position, centered: false, mode, ...extra });
const datum = (id: string, origin: Vec3, normal: Vec3, xDir: Vec3 = [1, 0, 0]): Feature => ({ id, name: id, type: "datum", origin, normal, xDir, size: 50 });
const xyz = (p: Vec3) => ({ kind: "xyz" as const, p });

/** Postaví dokument; první chybný prvek vyhodí chybu (text chyby = česká hláška stavitele). */
async function run(d: CadDoc) {
  const res = await buildDoc(d);
  const bad = res.status.filter((s) => !s.ok);
  if (bad.length) throw new Error(bad.map((b) => b.error).join("; "));
  return { res, body: res.body!, vol: res.metrics!.volume, bbox: res.metrics!.bbox };
}
const vol = async (d: CadDoc) => (await run(d)).vol;
const com = (s: Shape): Vec3 => r.measureShapeVolumeProperties(s).centerOfMass as Vec3;
const near = (a: Vec3, b: Vec3, tol = 0.05) => a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(tol));
/** Chyba stavby musí obsahovat text. */
async function failsWith(d: CadDoc, text: string) {
  const res = await buildDoc(d);
  const bad = res.status.find((s) => !s.ok);
  expect(bad, "očekávána chyba stavby").toBeTruthy();
  expect(bad!.error).toContain(text);
}
const planeFace = (body: Shape, pred: (c: Vec3) => boolean) => body.faces.findIndex((f) => f.geomType === "PLANE" && pred([f.center.x, f.center.y, f.center.z]));
const circleEdge = (body: Shape, pred: (c: Vec3) => boolean) => body.edges.findIndex((e) => e.geomType === "CIRCLE" && pred([e.startPoint.x, e.startPoint.y, e.startPoint.z]));

const BOX = 60 * 40 * 20;
const base = [box("A", [60, 40, 20], [0, 0, 0], "new")];
/** střed horní plochy kvádru A (30, 20, 20) odvozeným bodem */
const topCenter = { kind: "derived" as const, op: "mid" as const, args: [xyz([0, 0, 20]), xyz([60, 40, 20])] };

describe("primitiva – poloha odkazem a osa směrem", () => {
  it("válec: poloha = střed horní plochy (odvozený bod), osa Z", async () => {
    const d = doc([...base, { id: "c", name: "c", type: "cylinder", radius: 5, height: 10, position: [0, 0, 0], axis: "Z", mode: "add", positionRef: topCenter }]);
    const { vol: v, bbox } = await run(d);
    expect(v).toBeCloseTo(BOX + Math.PI * 25 * 10, 0);
    expect(bbox[1][2]).toBeCloseTo(30, 4);
  });
  it("válec: osa vektorem (1;1;0) – těžiště leží na ose", async () => {
    const { body, vol: v } = await run(doc([{ id: "c", name: "c", type: "cylinder", radius: 5, height: 40, position: [0, 0, 0], axis: "Z", mode: "new", dirDef: { kind: "vector", v: [1, 1, 0] } }]));
    expect(v).toBeCloseTo(Math.PI * 25 * 40, 0);
    near(com(body), [20 / Math.SQRT2, 20 / Math.SQRT2, 0]);
  });
  it("kvádr: poloha odkazem + střed, osa dvěma body", async () => {
    const d = doc([...base, box("B", [10, 10, 10], [0, 0, 0], "add", { centered: true, positionRef: topCenter })]);
    expect(await vol(d)).toBeCloseTo(BOX + 10 * 10 * 5, 0);
    const { body } = await run(doc([box("B", [10, 10, 30], [0, 0, 0], "new", { dirDef: { kind: "twoPoints", a: xyz([0, 0, 0]), b: xyz([10, 0, 0]) } })]));
    near(com(body), [15, 5, -5]); // lokální Z → +X: kvádr 10×10×30 leží podél X, lokální X → −Z
  });
  it("kužel: osa směrem hrany (tečna/směr) – těžiště v 1/4 výšky", async () => {
    const { body, vol: v } = await run(doc([{ id: "k", name: "k", type: "cone", radius1: 10, radius2: 0, height: 30, position: [0, 0, 0], axis: "Z", mode: "new", dirDef: { kind: "twoPoints", a: xyz([5, 5, 5]), b: xyz([6, 5, 5]) } }]));
    expect(v).toBeCloseTo((Math.PI * 100 * 30) / 3, 0);
    near(com(body), [7.5, 0, 0]);
  });
  it("trubka: poloha = počátek souřadnic, osa Y", async () => {
    const { body, vol: v } = await run(doc([{ id: "t", name: "t", type: "tube", outer: 40, inner: 30, height: 50, position: [9, 9, 9], axis: "Z", mode: "new", positionRef: { kind: "csys" }, dirDef: { kind: "axis", axis: "Y" } }]));
    expect(v).toBeCloseTo(Math.PI * (400 - 225) * 50, 0);
    near(com(body), [0, 25, 0]);
  });
  it("koule: střed mezi dvěma body", async () => {
    const { body } = await run(doc([{ id: "s", name: "s", type: "sphere", radius: 5, position: [0, 0, 0], mode: "new", positionRef: { kind: "derived", op: "between", args: [xyz([0, 0, 0]), xyz([20, 0, 0])], v: 0.25 } }]));
    near(com(body), [5, 0, 0]);
  });
  it("poloha odkazem na skutečný vrchol a střed kružnice tělesa", async () => {
    const built = await run(doc([...base, { id: "c0", name: "c0", type: "cylinder", radius: 8, height: 10, position: [30, 20, 20], axis: "Z", mode: "add" }]));
    const top = circleEdge(built.body, (p) => Math.abs(p[2] - 30) < 1e-6);
    expect(top).toBeGreaterThanOrEqual(0);
    const d = doc([...base, { id: "c0", name: "c0", type: "cylinder", radius: 8, height: 10, position: [30, 20, 20], axis: "Z", mode: "add" }, { id: "c1", name: "c1", type: "cylinder", radius: 3, height: 5, position: [0, 0, 0], axis: "Z", mode: "add", positionRef: { kind: "edge", index: top, at: "center" } }]);
    expect(await vol(d)).toBeCloseTo(BOX + Math.PI * 64 * 10 + Math.PI * 9 * 5, 0);
  });
  it("prázdný odkaz polohy dá srozumitelnou chybu; nástroj se uloží pro pole", async () => {
    await failsWith(doc([...base, { id: "c", name: "c", type: "cylinder", radius: 5, height: 10, position: [0, 0, 0], axis: "Z", mode: "add", positionRef: { kind: "vertex", index: -1 } }]), "Vyberte vrchol");
    const d = doc([...base, { id: "c", name: "c", type: "cylinder", radius: 5, height: 10, position: [0, 0, 0], axis: "Z", mode: "cut", positionRef: xyz([10, 10, 10]), dirDef: { kind: "axis", axis: "Z" } }, { id: "p", name: "p", type: "pattern", kind: "linear", featureId: "c", count: 3, spacing: 15, direction: [1, 0, 0] }]);
    expect(await vol(d)).toBeCloseTo(BOX - 3 * Math.PI * 25 * 10, 0);
  });
});

describe("pružina, závit, text", () => {
  it("pružina: poloha odkazem a osa X – těžiště uprostřed délky na ose", async () => {
    const { body } = await run(doc([{ id: "s", name: "s", type: "spring", radius: 10, pitch: 5, turns: 8, wire: 2, position: [0, 0, 0], axis: "Z", mode: "new", positionRef: xyz([0, 50, 0]), dirDef: { kind: "axis", axis: "X" } }]));
    near(com(body), [20, 50, 0], 0.6);
  });
  it("modelovaný závit: začátek ve středu kružnice, osa válcové plochy", async () => {
    const cyl: Feature = { id: "c", name: "c", type: "cylinder", radius: 10, height: 30, position: [5, 5, 0], axis: "Z", mode: "new" };
    const { body, vol: v0 } = await run(doc([cyl]));
    const bottom = circleEdge(body, (p) => Math.abs(p[2]) < 1e-6);
    const side = body.faces.findIndex((f) => f.geomType === "CYLINDRE");
    const v = await vol(doc([cyl, { id: "t", name: "t", type: "thread", designation: "M20", position: [0, 0, 0], axis: "X", length: 20, modeled: true, positionRef: { kind: "edge", index: bottom, at: "center" }, dirDef: { kind: "edge", ref: { kind: "face", index: side } } }]));
    expect(v).toBeLessThan(v0);
    expect(v).toBeGreaterThan(v0 * 0.85);
  });
  it("text: rovina definicí a střed odkazem (průmět bodu do roviny)", async () => {
    const txt: Feature = { id: "x", name: "x", type: "text", text: "AB", height: 8, depth: 1, plane: { kind: "base", name: "XY", offset: 0 }, position: [0, 0], angle: 0, mode: "add", planeDef: { kind: "base", name: "XY", offset: 20 }, positionRef: xyz([30, 20, 99]) };
    const { body, bbox, vol: v } = await run(doc([...base, txt]));
    expect(v).toBeGreaterThan(BOX);
    expect(bbox[1][2]).toBeCloseTo(21, 4);
    const c = com(body.cut(r.makeBox([0, 0, 0], [60, 40, 20])));
    near(c, [30, 20, 20.5], 0.6);
  });
});

describe("transformace odkazy", () => {
  const cube = [box("A", [10, 10, 10], [0, 0, 0], "new")];
  it("posun z bodu do bodu", async () => {
    const { bbox } = await run(doc([...cube, { id: "t", name: "t", type: "transform", translate: [0, 0, 0], rotateAxis: "Z", rotateAngle: 0, scale: 1, translateRef: { a: xyz([0, 0, 0]), b: xyz([5, 7, 9]) } }]));
    near(bbox[0], [5, 7, 9]);
  });
  it("měřítko kolem středu odkazem", async () => {
    const { bbox } = await run(doc([...cube, { id: "t", name: "t", type: "transform", translate: [0, 0, 0], rotateAxis: "Z", rotateAngle: 0, scale: 2, centerRef: xyz([10, 10, 10]) }]));
    near(bbox[0], [-10, -10, -10]);
    near(bbox[1], [10, 10, 10]);
  });
  it("otočení kolem osy dvěma body a kolem osy válcové plochy", async () => {
    const { bbox } = await run(doc([...cube, { id: "t", name: "t", type: "transform", translate: [0, 0, 0], rotateAxis: "Z", rotateAngle: 90, scale: 1, rotateAxisDef: { kind: "twoPoints", a: xyz([10, 0, 0]), b: xyz([10, 0, 1]) } }]));
    near(bbox[0], [0, -10, 0]);
    near(bbox[1], [10, 0, 10]);
    const cyl: Feature = { id: "c", name: "c", type: "cylinder", radius: 2, height: 10, position: [20, 0, 0], axis: "Z", mode: "add" };
    const { body } = await run(doc([...cube, cyl]));
    const side = body.faces.findIndex((f) => f.geomType === "CYLINDRE");
    const r2 = await run(doc([...cube, cyl, { id: "t", name: "t", type: "transform", translate: [0, 0, 0], rotateAxis: "Z", rotateAngle: 180, scale: 1, rotateAxisDef: { kind: "cylFace", ref: { kind: "face", index: side } } }]));
    near(r2.bbox[0], [18, -10, 0]); // kostka 0..10 otočená o 180° kolem osy x=20 → 30..40 (válec r=2 zůstává na 18..22)
    near(r2.bbox[1], [40, 2, 10]);
  });
});

describe("Vytáhnout/Zatlačit – ukončení", () => {
  async function top() {
    const { body } = await run(doc(base));
    const i = planeFace(body, (c) => Math.abs(c[2] - 20) < 1e-6);
    expect(i).toBeGreaterThanOrEqual(0);
    return i;
  }
  it("k ploše (pomocná rovina), odsazeně od plochy, k vrcholu – oběma směry", async () => {
    const i = await top();
    const pp = (extent: Extract<Feature, { type: "pushPull" }>["extent"]): Feature => ({ id: "p", name: "p", type: "pushPull", faces: [i], distance: 5, extent });
    expect(await vol(doc([...base, datum("d", [0, 0, 35], [0, 0, 1]), pp({ kind: "toFace", ref: { kind: "datum", featureId: "d" } })]))).toBeCloseTo(60 * 40 * 35, 0);
    expect(await vol(doc([...base, datum("d", [0, 0, 35], [0, 0, 1]), pp({ kind: "offsetFromFace", ref: { kind: "datum", featureId: "d" }, d: -5 })]))).toBeCloseTo(60 * 40 * 30, 0);
    expect(await vol(doc([...base, pp({ kind: "toVertex", ref: xyz([0, 0, 27]) })]))).toBeCloseTo(60 * 40 * 27, 0);
    expect(await vol(doc([...base, pp({ kind: "toVertex", ref: xyz([99, 99, 12]) })]))).toBeCloseTo(60 * 40 * 12, 0);
    expect(await vol(doc([...base, pp({ kind: "blind", d: 3 })]))).toBeCloseTo(60 * 40 * 23, 0);
  });
  it("k ploše šikmé roviny: vzdálenost se měří ve středu plochy podél normály", async () => {
    const i = await top();
    // rovina nakloněná kolem osy Y: ve středu (30, 20) má z = 30
    const n: Vec3 = [Math.sin(Math.PI / 12), 0, Math.cos(Math.PI / 12)];
    const v = await vol(doc([...base, datum("d", [30, 20, 30], n), { id: "p", name: "p", type: "pushPull", faces: [i], distance: 5, extent: { kind: "toFace", ref: { kind: "datum", featureId: "d" } } }]));
    expect(v).toBeCloseTo(60 * 40 * 30, 0);
  });
  it("dvě plochy s různou vzdáleností k téže rovině; chyby", async () => {
    const two = [box("A", [10, 10, 20], [0, 0, 0], "new"), box("B", [10, 10, 30], [20, 0, 0])];
    const { body } = await run(doc(two));
    const ta = planeFace(body, (c) => Math.abs(c[2] - 20) < 1e-6 && c[0] < 15);
    const tb = planeFace(body, (c) => Math.abs(c[2] - 30) < 1e-6 && c[0] > 15);
    const v = await vol(doc([...two, datum("d", [0, 0, 40], [0, 0, 1]), { id: "p", name: "p", type: "pushPull", faces: [ta, tb], distance: 5, extent: { kind: "toFace", ref: { kind: "datum", featureId: "d" } } }]));
    expect(v).toBeCloseTo(2 * 10 * 10 * 40, 0);
    const i = await top();
    await failsWith(doc([...base, datum("d", [0, 0, 35], [1, 0, 0]), { id: "p", name: "p", type: "pushPull", faces: [i], distance: 5, extent: { kind: "toFace", ref: { kind: "datum", featureId: "d" } } }]), "rovnoběžná");
    await failsWith(doc([...base, { id: "p", name: "p", type: "pushPull", faces: [i], distance: 5, extent: { kind: "throughAll" } }]), "K vrcholu");
    await failsWith(doc([...base, { id: "p", name: "p", type: "pushPull", faces: [i], distance: 5, extent: { kind: "toFace", ref: { kind: "face", index: -1 } } }]), "Vyberte plochu");
  });
});

describe("pomocná osa", () => {
  it("průsečnice dvou rovin + použití jako osa otočení transformace a rotace skici", async () => {
    const cube = box("A", [10, 10, 10], [0, 0, 0], "new");
    const axis: Feature = { id: "ax", name: "Osa 1", type: "datumAxis", def: { kind: "twoPlanes", a: { kind: "datum", featureId: "d1" }, b: { kind: "datum", featureId: "d2" } }, length: 50 };
    const planes = [datum("d1", [10, 5, 0], [1, 0, 0], [0, 1, 0]), datum("d2", [3, 0, 7], [0, 1, 0])];
    const d = doc([cube, ...planes, axis]);
    const info = refInfo({ body: null, sketches: new Map(), features: d.features }, { kind: "datumAxis", featureId: "ax" });
    expect(info.error).toBeUndefined();
    expect(Math.abs(info.geo!.dir![2])).toBeCloseTo(1, 6);
    expect(info.geo!.point![0]).toBeCloseTo(10, 6);
    expect(info.geo!.point![1]).toBeCloseTo(0, 6);
    const { bbox, vol: v } = await run(doc([cube, ...planes, axis, { id: "t", name: "t", type: "transform", translate: [0, 0, 0], rotateAxis: "Z", rotateAngle: 90, scale: 1, rotateAxisDef: { kind: "datumAxis", featureId: "ax" } }]));
    expect(v).toBeCloseTo(1000, 3);
    expect(Math.abs(bbox[0][1] + 10) < 0.01 || Math.abs(bbox[1][1] - 10) < 0.01).toBe(true); // o 90° kolem x=10,y=0 (směr osy může být ±Z)
    expect(bbox[0][0]).toBeCloseTo(0, 3);
    expect(bbox[1][0]).toBeCloseTo(10, 3);
    // rotace skici kolem pomocné osy (globální Y) – mezikruží 20..30 × výška 10
    const sk: Feature = { id: "s", name: "s", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [{ id: "r", type: "rect", cx: 25, cy: 5, w: 10, h: 10, r: 0, angle: 0 }] };
    const yAxis: Feature = { id: "ay", name: "Osa Y", type: "datumAxis", def: { kind: "global", axis: "Y" }, length: 50 };
    const rv = await vol(doc([sk, yAxis, { id: "rv", name: "rv", type: "revolve", sketchId: "s", angle: 360, axis: "y", mode: "new", axisDef: { kind: "datumAxis", featureId: "ay" } }]));
    expect(rv).toBeCloseTo(Math.PI * (900 - 400) * 10, 0);
  });
  it("osa hranou / válcovou plochou / dvěma body / pomocnou rovinou + chyby", async () => {
    const { body } = await run(doc([...base, { id: "c", name: "c", type: "cylinder", radius: 5, height: 10, position: [30, 20, 20], axis: "Z", mode: "add" }]));
    const side = body.faces.findIndex((f) => f.geomType === "CYLINDRE");
    const lineEdge = body.edges.findIndex((e) => e.geomType === "LINE");
    const feats: Feature[] = [...base, { id: "c", name: "c", type: "cylinder", radius: 5, height: 10, position: [30, 20, 20], axis: "Z", mode: "add" }, datum("d", [0, 0, 5], [0, 0, 1])];
    const mk = (id: string, def: Extract<Feature, { type: "datumAxis" }>["def"]): Feature => ({ id, name: id, type: "datumAxis", def, length: 20 });
    const d = doc([...feats, mk("a1", { kind: "cylFace", ref: { kind: "face", index: side } }), mk("a2", { kind: "edge", ref: { kind: "edge", index: lineEdge } }), mk("a3", { kind: "twoPoints", a: xyz([0, 0, 0]), b: xyz([1, 2, 3]) }), mk("a4", { kind: "datum", featureId: "d" })]);
    const { res } = await run(d);
    expect(res.status.every((s) => s.ok)).toBe(true);
    const ctx = { body, sketches: new Map(), features: d.features };
    const a1 = refInfo(ctx, { kind: "datumAxis", featureId: "a1" }).geo!;
    expect(a1.point![0]).toBeCloseTo(30, 5);
    expect(Math.abs(a1.dir![2])).toBeCloseTo(1, 6);
    expect(refInfo(ctx, { kind: "datumAxis", featureId: "a2" }).error).toBeUndefined();
    near(refInfo(ctx, { kind: "datumAxis", featureId: "a3" }).geo!.dir!, [1 / Math.sqrt(14), 2 / Math.sqrt(14), 3 / Math.sqrt(14)], 1e-6);
    near(refInfo(ctx, { kind: "datumAxis", featureId: "a4" }).geo!.dir!, [0, 0, 1], 1e-9);
    await failsWith(doc([...feats, mk("bad", { kind: "twoPlanes", a: { kind: "datum", featureId: "d" }, b: { kind: "datum", featureId: "d" } })]), "rovnoběžné");
    await failsWith(doc([...feats, mk("bad", { kind: "sketchLine", entityId: "x" })]), "Zvolte osu modelem");
    await failsWith(doc([...feats, mk("bad", { kind: "edge", ref: { kind: "edge", index: -1 } })]), "Vyberte hranu");
    await failsWith(doc([...feats, { id: "t", name: "t", type: "transform", translate: [0, 0, 0], rotateAxis: "Z", rotateAngle: 10, scale: 1, rotateAxisDef: { kind: "datumAxis", featureId: "zzz" } }]), "neexistuje");
  });
});

describe("pomocný bod", () => {
  it("poloha díry pomocným bodem (střed horní plochy) a válce pomocným bodem (střed kružnice)", async () => {
    const pt: Feature = { id: "pt", name: "Bod 1", type: "datumPoint", ref: topCenter };
    const v = await vol(doc([...base, pt, { id: "h", name: "h", type: "hole", position: [0, 0, 0], axis: "Z", flip: false, diameter: 10, depth: 0, cbDiameter: 0, cbDepth: 0, points: [{ kind: "datumPoint", featureId: "pt" }] }]));
    expect(v).toBeCloseTo(BOX - Math.PI * 25 * 20, 0);
    const cyl: Feature = { id: "c0", name: "c0", type: "cylinder", radius: 8, height: 10, position: [30, 20, 20], axis: "Z", mode: "add" };
    const { body } = await run(doc([...base, cyl]));
    const top = circleEdge(body, (p) => Math.abs(p[2] - 30) < 1e-6);
    const pt2: Feature = { id: "pt", name: "Bod 1", type: "datumPoint", ref: { kind: "edge", index: top, at: "center" } };
    const v2 = await vol(doc([...base, cyl, pt2, { id: "c1", name: "c1", type: "cylinder", radius: 3, height: 5, position: [0, 0, 0], axis: "Z", mode: "add", positionRef: { kind: "datumPoint", featureId: "pt" } }]));
    expect(v2).toBeCloseTo(BOX + Math.PI * 64 * 10 + Math.PI * 9 * 5, 0);
  });
  it("vrchol, průsečík hrany s rovinou, odsazený bod; chyby pořadí a cyklu", async () => {
    const { body } = await run(doc(base));
    const vtx = 0;
    const lineEdge = body.edges.findIndex((e) => e.geomType === "LINE" && Math.abs(e.startPoint.z - e.endPoint.z) > 1); // svislá hrana
    const feats: Feature[] = [...base, datum("d", [0, 0, 7], [0, 0, 1])];
    const d = doc([...feats, { id: "p1", name: "p1", type: "datumPoint", ref: { kind: "vertex", index: vtx } }, { id: "p2", name: "p2", type: "datumPoint", ref: { kind: "derived", op: "intersect", args: [{ kind: "edge", index: lineEdge }, { kind: "datum", featureId: "d" }] } }, { id: "p3", name: "p3", type: "datumPoint", ref: { kind: "derived", op: "offset", args: [{ kind: "datumPoint", featureId: "p2" }, { kind: "edge", index: lineEdge }], v: 2 } }]);
    const { res } = await run(d);
    expect(res.status.every((s) => s.ok)).toBe(true);
    const ctx = { body, sketches: new Map(), features: d.features };
    expect(refInfo(ctx, { kind: "datumPoint", featureId: "p2" }).geo!.point![2]).toBeCloseTo(7, 6);
    expect(Math.abs(refInfo(ctx, { kind: "datumPoint", featureId: "p3" }).geo!.point![2] - 7)).toBeCloseTo(2, 6);
    // pořadí: bod až za prvkem, který ho používá
    await failsWith(doc([...base, { id: "c", name: "c", type: "cylinder", radius: 5, height: 10, position: [0, 0, 0], axis: "Z", mode: "add", positionRef: { kind: "datumPoint", featureId: "pt" } }, { id: "pt", name: "Bod 1", type: "datumPoint", ref: topCenter }]), "před prvkem");
    expect(() => checkDatumOrder({ id: "x", name: "x", type: "datumPoint", ref: { kind: "datumPoint", featureId: "x" } }, { features: [{ id: "x", name: "x", type: "datumPoint", ref: xyz([0, 0, 0]) }], index: 0 })).toThrow("před prvkem");
    // cyklus v odkazech přes refInfo (bez pořadí)
    const cyc: Feature[] = [{ id: "a", name: "a", type: "datumPoint", ref: { kind: "datumPoint", featureId: "b" } }, { id: "b", name: "b", type: "datumPoint", ref: { kind: "datumPoint", featureId: "a" } }];
    expect(refInfo({ body: null, sketches: new Map(), features: cyc }, { kind: "datumPoint", featureId: "a" }).error).toContain("cyklický");
    await failsWith(doc([...base, { id: "pt", name: "pt", type: "datumPoint", ref: { kind: "vertex", index: -1 } }]), "Vyberte vrchol");
  });
});

describe("souřadný systém", () => {
  it("počátek odkazem, Z dvěma body, X se ortogonalizuje; použití jako rovina skici a osa", async () => {
    const cs: Feature = { id: "cs", name: "CS 1", type: "csys", origin: topCenter, zDir: { kind: "twoPoints", a: xyz([0, 0, 0]), b: xyz([0, 0, 5]) }, xDir: { kind: "vector", v: [1, 0, 1] }, size: 30 };
    const d = doc([...base, cs]);
    const { res } = await run(d);
    expect(res.status.every((s) => s.ok)).toBe(true);
    const ctx = { body: null, sketches: new Map(), features: d.features };
    const p = refInfo(ctx, { kind: "datumPoint", featureId: "cs" }).geo!;
    near(p.point!, [30, 20, 20], 1e-6);
    near(p.plane!.xDir, [1, 0, 0], 1e-6); // X ortogonalizovaná vůči Z
    near(refInfo(ctx, { kind: "datumAxis", featureId: "cs" }).geo!.dir!, [0, 0, 1], 1e-9);
    // skica v rovině XY souřadného systému → vysunutí 5 nahoru
    const sk: Feature = { id: "s", name: "s", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [{ id: "c", type: "circle", cx: 0, cy: 0, r: 4 }], planeDef: { kind: "face", ref: { kind: "datumPoint", featureId: "cs" } } };
    const { bbox, vol: v } = await run(doc([...base, cs, sk, { id: "e", name: "e", type: "extrude", sketchId: "s", distance: 5, symmetric: false, reverse: false, mode: "add" }]));
    expect(v).toBeCloseTo(BOX + Math.PI * 16 * 5, 0);
    expect(bbox[1][2]).toBeCloseTo(25, 4);
    await failsWith(doc([...base, { ...cs, xDir: { kind: "axis", axis: "Z" } } as Feature]), "rovnoběžná s osou Z");
    await failsWith(doc([...base, { ...cs, origin: { kind: "face", index: -1 } } as Feature]), "Vyberte plochu");
  });
});
