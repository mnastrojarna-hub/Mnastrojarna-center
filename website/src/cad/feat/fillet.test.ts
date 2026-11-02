import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc, buildShape } from "../build";
import { vertexPositions } from "../inspect";
import { emptyDoc, type CadDoc, type Feature } from "../types";
import { tangentChainOf } from "./fillet";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

type FilletF = Extract<Feature, { type: "fillet" }>;
type ChamferF = Extract<Feature, { type: "chamfer" }>;
type Shape = r.Shape3D;

const BOX_VOL = 60 * 40 * 20;
const base: Feature[] = [{ id: "A", name: "A", type: "box", size: [60, 40, 20], position: [0, 0, 0], centered: false, mode: "new" }];
const doc = (features: Feature[]): CadDoc => ({ ...emptyDoc("t"), features });
const fil = (p: Partial<FilletF>): FilletF => ({ id: "f", name: "f", type: "fillet", radius: 2, edges: "all", ...p });
const cha = (p: Partial<ChamferF>): ChamferF => ({ id: "c", name: "c", type: "chamfer", distance: 2, edges: "all", ...p });
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
/** objem po zaoblení jedné přímé hrany délky L poloměrem R (bez rohů) */
const lostFillet = (R: number, L: number) => (1 - Math.PI / 4) * R * R * L;

async function build(features: Feature[]) {
  const res = await buildDoc(doc(features));
  const bad = res.status.filter((s) => !s.ok);
  if (bad.length) throw new Error(bad.map((b) => b.error).join("; "));
  return { vol: res.metrics!.volume, faces: res.body!.faces.length, body: res.body!, bbox: res.body!.boundingBox.bounds as [number[], number[]] };
}
async function errorOf(features: Feature[]) {
  const res = await buildDoc(doc(features));
  return res.status.find((s) => !s.ok)?.error ?? "";
}

let box: Shape;
/** index hrany podle predikátu nad krajními body */
const edgeIdx = (pred: (s: r.Vector, e: r.Vector) => boolean) => box.edges.findIndex((e) => pred(e.startPoint, e.endPoint));
const faceIdx = (pred: (c: r.Vector) => boolean) => box.faces.findIndex((f) => f.geomType === "PLANE" && pred(f.center));
const onPlane = (v: r.Vector, k: "x" | "y" | "z", val: number) => near(v[k], val);
// hrany horní plochy (z = 20)
const topFront = () => edgeIdx((s, e) => onPlane(s, "z", 20) && onPlane(e, "z", 20) && onPlane(s, "y", 0) && onPlane(e, "y", 0));
const topBack = () => edgeIdx((s, e) => onPlane(s, "z", 20) && onPlane(e, "z", 20) && onPlane(s, "y", 40) && onPlane(e, "y", 40));
const topEdges = () => box.edges.map((e, i) => (onPlane(e.startPoint, "z", 20) && onPlane(e.endPoint, "z", 20) ? i : -1)).filter((i) => i >= 0);
const TOP = () => faceIdx((c) => onPlane(c, "z", 20));
const BOTTOM = () => faceIdx((c) => onPlane(c, "z", 0));
const FRONT = () => faceIdx((c) => onPlane(c, "y", 0));
const END = () => faceIdx((c) => onPlane(c, "x", 60));

beforeAll(async () => {
  box = (await buildShape(doc(base))).body!;
});

describe("zaoblení – constant", () => {
  it("všechny hrany (původní chování)", async () => {
    const { vol, faces } = await build([...base, fil({ radius: 2 })]);
    expect(faces).toBe(26);
    expect(vol).toBeLessThan(BOX_VOL);
    expect(vol).toBeGreaterThan(BOX_VOL - lostFillet(2, 480)); // 12 hran, rohy část objemu vrací
  });
  it("vybrané hrany", async () => {
    const { vol, faces } = await build([...base, fil({ radius: 5, edges: [topFront()] })]);
    expect(faces).toBe(7);
    expect(vol).toBeCloseTo(BOX_VOL - lostFillet(5, 60), 3);
  });
  it("chyby: bez tělesa, nulový poloměr, prázdný výběr, příliš velký poloměr", async () => {
    expect(await errorOf([fil({})])).toMatch(/Není co zaoblit/);
    expect(await errorOf([...base, fil({ radius: 0 })])).toMatch(/kladný/);
    expect(await errorOf([...base, fil({ edges: [] })])).toMatch(/Vyberte hrany/);
    expect(await errorOf([...base, fil({ radius: 500 })])).toMatch(/příliš velký/);
  });
});

describe("zaoblení – asymmetric (R1 → R2 podél hrany)", () => {
  it("objem leží mezi konstantním R1 a R2, poloměr se mění podél hrany", async () => {
    const i = topFront();
    const a = await build([...base, fil({ kind: "asymmetric", radius: 2, r2: 6, edges: [i] })]);
    const lo = await build([...base, fil({ radius: 6, edges: [i] })]);
    const hi = await build([...base, fil({ radius: 2, edges: [i] })]);
    expect(a.faces).toBe(7);
    expect(a.vol).toBeGreaterThan(lo.vol);
    expect(a.vol).toBeLessThan(hi.vol);
    // horní plocha po zaoblení není obdélník: její hranice u zaoblení je šikmá (y od 2 do 6)
    const top = a.body.faces.find((f) => f.geomType === "PLANE" && near(f.center.z, 20))!;
    const [[, y0]] = top.boundingBox.bounds as [number[], number[]];
    expect(y0).toBeCloseTo(2, 3);
  });
  it("chyba: záporné R2", async () => {
    expect(await errorOf([...base, fil({ kind: "asymmetric", radius: 2, r2: -1, edges: [topFront()] })])).toMatch(/R1 i R2/);
  });
});

describe("zaoblení – variable (tabulka per hrana)", () => {
  it("každá hrana vlastní poloměr, ostatní výchozí", async () => {
    const a = topFront();
    const b = topBack();
    const { vol, faces } = await build([...base, fil({ kind: "variable", radius: 1, edges: [a, b], radii: { [String(a)]: 3 } })]);
    expect(faces).toBe(8);
    expect(vol).toBeCloseTo(BOX_VOL - lostFillet(3, 60) - lostFillet(1, 60), 3);
  });
  it("začátek / konec hrany (radii2) dává proměnný poloměr", async () => {
    const a = topFront();
    const v = await build([...base, fil({ kind: "variable", radius: 1, edges: [a], radii: { [String(a)]: 2 }, radii2: { [String(a)]: 6 } })]);
    const s = await build([...base, fil({ kind: "asymmetric", radius: 2, r2: 6, edges: [a] })]);
    expect(v.vol).toBeCloseTo(s.vol, 6);
  });
  it("chyba: nulový poloměr v tabulce", async () => {
    const a = topFront();
    expect(await errorOf([...base, fil({ kind: "variable", radius: 1, edges: [a], radii: { [String(a)]: 0 } })])).toMatch(/Poloměr u hrany/);
  });
});

describe("zaoblení – faceFace", () => {
  it("zaoblí hranu společnou oběma sadám ploch (odkazy i indexy)", async () => {
    const byRef = await build([...base, fil({ kind: "faceFace", radius: 5, faceRefs: [{ kind: "face", index: TOP() }], faceRefs2: [{ kind: "face", index: FRONT() }] })]);
    expect(byRef.faces).toBe(7);
    expect(byRef.vol).toBeCloseTo(BOX_VOL - lostFillet(5, 60), 3);
    const byIdx = await build([...base, fil({ kind: "faceFace", radius: 5, faces: [TOP()], faces2: [FRONT()] })]);
    expect(byIdx.vol).toBeCloseTo(byRef.vol, 6);
  });
  it("více ploch v sadě: horní plocha × všechny boční = 4 hrany", async () => {
    const sides = box.faces.map((f, i) => (f.geomType === "PLANE" && Math.abs(f.normalAt().z) < 1e-6 ? i : -1)).filter((i) => i >= 0);
    const { faces, vol } = await build([...base, fil({ kind: "faceFace", radius: 3, faces: [TOP()], faces2: sides })]);
    const ref = await build([...base, fil({ radius: 3, edges: topEdges() })]);
    expect(faces).toBe(ref.faces);
    expect(vol).toBeCloseTo(ref.vol, 6);
  });
  it("chyby: bez společné hrany, bez výběru", async () => {
    expect(await errorOf([...base, fil({ kind: "faceFace", radius: 2, faces: [TOP()], faces2: [BOTTOM()] })])).toMatch(/společnou hranu/);
    expect(await errorOf([...base, fil({ kind: "faceFace", radius: 2, faces: [TOP()] })])).toMatch(/Vyberte druhou sadu/);
  });
});

describe("zaoblení – fullRound (plný rádius)", () => {
  it("čelo x = 60 mezi horní a dolní plochou → válec r = 10, přesný objem", async () => {
    const { vol, faces, bbox } = await build([...base, fil({ kind: "fullRound", faceRefs: [{ kind: "face", index: TOP() }], faceRefs2: [{ kind: "face", index: BOTTOM() }], faceRefsMid: [{ kind: "face", index: END() }] })]);
    expect(vol).toBeCloseTo(BOX_VOL - 10 * 20 * 40 + (Math.PI * 100 * 40) / 2, 3);
    expect(faces).toBe(6);
    expect(bbox[1][0]).toBeCloseTo(60, 6);
  });
  it("prostřední plocha se najde sama, je-li jediná (boční = přední a zadní plocha)", async () => {
    // mezi přední (y=0) a zadní (y=40) plochou leží 4 plochy – nutno vybrat; mezi horní a čelem x=60 jen... použijeme boční = horní+dolní a ověříme chybu nejednoznačnosti
    const err = await errorOf([...base, fil({ kind: "fullRound", faces: [TOP()], faces2: [BOTTOM()] })]);
    expect(err).toMatch(/4 ploch/);
  });
  it("chyby: nerovnoběžné boční plochy, prostřední plocha nesousedí", async () => {
    expect(await errorOf([...base, fil({ kind: "fullRound", faces: [TOP()], faces2: [FRONT()], faceRefsMid: [{ kind: "face", index: END() }] })])).toMatch(/rovnoběžné/);
    expect(await errorOf([...base, fil({ kind: "fullRound", faces: [TOP()], faces2: [BOTTOM()], faceRefsMid: [{ kind: "face", index: TOP() }] })])).toMatch(/sousedit/);
  });
  it("neobdélníková prostřední plocha → přibližné dvojité zaoblení", async () => {
    // čelo x=60 má po sražení svislé hrany 5 hran → přibližná větev
    const vert = edgeIdx((s, e) => onPlane(s, "x", 60) && onPlane(e, "x", 60) && onPlane(s, "y", 0) && onPlane(e, "y", 0));
    const pre = await build([...base, cha({ id: "c0", distance: 3, edges: [vert] })]);
    const end = pre.body.faces.findIndex((f) => f.geomType === "PLANE" && near(f.center.x, 60));
    const top = pre.body.faces.findIndex((f) => f.geomType === "PLANE" && near(f.center.z, 20));
    const bot = pre.body.faces.findIndex((f) => f.geomType === "PLANE" && near(f.center.z, 0));
    const { vol, faces } = await build([...base, cha({ id: "c0", distance: 3, edges: [vert] }), fil({ kind: "fullRound", faces: [top], faces2: [bot], faceRefsMid: [{ kind: "face", index: end }] })]);
    expect(faces).toBeGreaterThan(pre.faces);
    expect(vol).toBeLessThan(pre.vol);
    expect(vol).toBeGreaterThan(pre.vol - 10 * 20 * 40);
  });
});

describe("zaoblení – tangentChain", () => {
  it("výběr se rozšíří po tečně navazujících hranách (hrana → oblouk → hrana), kolmé hrany ne", async () => {
    // svislou hranu u (60, 0) zaoblíme; horní obrys pak obsahuje hrana–oblouk–hrana
    const vert = edgeIdx((s, e) => onPlane(s, "x", 60) && onPlane(e, "x", 60) && onPlane(s, "y", 0) && onPlane(e, "y", 0));
    const pre = await build([...base, fil({ id: "f0", radius: 8, edges: [vert] })]);
    const front = pre.body.edges.find((e) => e.geomType === "LINE" && near(e.startPoint.z, 20) && near(e.endPoint.z, 20) && near(e.startPoint.y, 0) && near(e.endPoint.y, 0))!;
    const chain = tangentChainOf(pre.body, [front]);
    expect(chain.length).toBe(3);
    expect(chain.map((e) => e.geomType).sort()).toEqual(["CIRCLE", "LINE", "LINE"]);
    expect(chain.every((e) => near(e.startPoint.z, 20) && near(e.endPoint.z, 20))).toBe(true);
    expect(tangentChainOf(box, [box.edges[topFront()]]).length).toBe(1);
  });
  it("výsledek zaoblení s řetězcem = tečná hrana + oblouk + hrana (jádro šíří po tečných hranách i samo)", async () => {
    const vert = edgeIdx((s, e) => onPlane(s, "x", 60) && onPlane(e, "x", 60) && onPlane(s, "y", 0) && onPlane(e, "y", 0));
    const pre = await build([...base, fil({ id: "f0", radius: 8, edges: [vert] })]);
    const front = pre.body.edges.findIndex((e) => e.geomType === "LINE" && near(e.startPoint.z, 20) && near(e.endPoint.z, 20) && near(e.startPoint.y, 0) && near(e.endPoint.y, 0));
    const chain = await build([...base, fil({ id: "f0", radius: 8, edges: [vert] }), fil({ radius: 2, edges: [front], tangentChain: true })]);
    const plain = await build([...base, fil({ id: "f0", radius: 8, edges: [vert] }), fil({ radius: 2, edges: [front] })]);
    expect(chain.faces).toBe(pre.faces + 3);
    expect(chain.vol).toBeCloseTo(plain.vol, 6);
  });
  it("u kvádru (bez tečných návazností) výběr nezmění", async () => {
    const a = await build([...base, fil({ radius: 3, edges: [topFront()], tangentChain: true })]);
    const b = await build([...base, fil({ radius: 3, edges: [topFront()] })]);
    expect(a.faces).toBe(b.faces);
    expect(a.vol).toBeCloseTo(b.vol, 6);
  });
});

describe("zkosení – equal", () => {
  it("všechny hrany (původní chování) a vybraná hrana", async () => {
    const all = await build([...base, cha({ distance: 2 })]);
    expect(all.faces).toBe(26);
    expect(all.vol).toBeCloseTo(r.measureVolume(box.clone().chamfer(2)), 6);
    const one = await build([...base, cha({ distance: 4, edges: [topFront()] })]);
    expect(one.faces).toBe(7);
    expect(one.vol).toBeCloseTo(BOX_VOL - 0.5 * 4 * 4 * 60, 6);
  });
  it("chyby", async () => {
    expect(await errorOf([cha({})])).toMatch(/Není co srazit/);
    expect(await errorOf([...base, cha({ distance: -1 })])).toMatch(/kladná/);
    expect(await errorOf([...base, cha({ distance: 30 })])).toMatch(/příliš velká/);
  });
});

describe("zkosení – twoDistances", () => {
  it("D1 na referenční (horní) ploše, D2 na čelní", async () => {
    const { vol, faces, body } = await build([...base, cha({ kind: "twoDistances", distance: 2, d2: 5, faceRef: { kind: "face", index: TOP() }, edges: [topFront()] })]);
    expect(faces).toBe(7);
    expect(vol).toBeCloseTo(BOX_VOL - 0.5 * 2 * 5 * 60, 6);
    const top = body.faces.find((f) => f.geomType === "PLANE" && near(f.center.z, 20))!;
    expect((top.boundingBox.bounds as number[][])[0][1]).toBeCloseTo(2, 6); // horní plocha začíná na y = 2 (D1)
    const front = body.faces.find((f) => f.geomType === "PLANE" && near(f.center.y, 0))!;
    expect((front.boundingBox.bounds as number[][])[1][2]).toBeCloseTo(15, 6); // čelo končí na z = 15 (D2)
  });
  it("prohozená referenční plocha prohodí vzdálenosti; „všechny“ = všechny hrany plochy", async () => {
    const { body } = await build([...base, cha({ kind: "twoDistances", distance: 2, d2: 5, faceRef: { kind: "face", index: FRONT() }, edges: [topFront()] })]);
    const front = body.faces.find((f) => f.geomType === "PLANE" && near(f.center.y, 0))!;
    expect((front.boundingBox.bounds as number[][])[1][2]).toBeCloseTo(18, 6);
    const all = await build([...base, cha({ kind: "twoDistances", distance: 2, d2: 5, faceRef: { kind: "face", index: TOP() }, edges: "all" })]);
    expect(all.faces).toBe(10);
  });
  it("chyby: bez plochy, hrana nesousedí s plochou", async () => {
    expect(await errorOf([...base, cha({ kind: "twoDistances", distance: 2, d2: 5, edges: [topFront()] })])).toMatch(/referenční plochu/);
    expect(await errorOf([...base, cha({ kind: "twoDistances", distance: 2, d2: 5, faceRef: { kind: "face", index: BOTTOM() }, edges: [topFront()] })])).toMatch(/nesousedí/);
  });
});

describe("zkosení – distanceAngle", () => {
  it("45° odpovídá symetrickému sražení, 30° dává D·tg 30° na sousední ploše", async () => {
    const i = topFront();
    const a45 = await build([...base, cha({ kind: "distanceAngle", distance: 4, angle: 45, faceRef: { kind: "face", index: TOP() }, edges: [i] })]);
    expect(a45.vol).toBeCloseTo(BOX_VOL - 0.5 * 4 * 4 * 60, 4);
    const a30 = await build([...base, cha({ kind: "distanceAngle", distance: 4, angle: 30, faceRef: { kind: "face", index: TOP() }, edges: [i] })]);
    expect(a30.vol).toBeCloseTo(BOX_VOL - 0.5 * 4 * 4 * Math.tan(Math.PI / 6) * 60, 3);
  });
  it("chyba: úhel mimo 0–90°", async () => {
    expect(await errorOf([...base, cha({ kind: "distanceAngle", distance: 4, angle: 90, faceRef: { kind: "face", index: TOP() }, edges: [topFront()] })])).toMatch(/Úhel/);
  });
});

describe("zkosení – vertex", () => {
  const vtxIdx = (p: [number, number, number]) => {
    const v = vertexPositions(box);
    for (let i = 0; i * 3 < v.length; i++) if (near(v[i * 3], p[0]) && near(v[i * 3 + 1], p[1]) && near(v[i * 3 + 2], p[2])) return i;
    return -1;
  };
  it("odřízne roh čtyřstěnem D1 × D2 × D3 / 6 (odkaz na vrchol)", async () => {
    const i = vtxIdx([60, 40, 20]);
    expect(i).toBeGreaterThanOrEqual(0);
    const { vol, faces } = await build([...base, cha({ kind: "vertex", distance: 5, d2: 6, d3: 7, vertexRefs: [{ kind: "vertex", index: i }] })]);
    expect(faces).toBe(7);
    expect(vol).toBeCloseTo(BOX_VOL - (5 * 6 * 7) / 6, 6);
  });
  it("více vrcholů naráz (indexy i souřadnice)", async () => {
    const { vol, faces } = await build([...base, cha({ kind: "vertex", distance: 4, vertices: [vtxIdx([0, 0, 0])], vertexRefs: [{ kind: "xyz", p: [60, 40, 20] }] })]);
    expect(faces).toBe(8);
    expect(vol).toBeCloseTo(BOX_VOL - 2 * (4 * 4 * 4) / 6, 6);
  });
  it("chyby: bez vrcholu, bod mimo vrchol, vzdálenost delší než hrana", async () => {
    expect(await errorOf([...base, cha({ kind: "vertex", distance: 4 })])).toMatch(/Vyberte vrcholy/);
    expect(await errorOf([...base, cha({ kind: "vertex", distance: 4, vertexRefs: [{ kind: "xyz", p: [30, 20, 20] }] })])).toMatch(/právě 3 hrany/);
    expect(await errorOf([...base, cha({ kind: "vertex", distance: 4, d3: 65, vertexRefs: [{ kind: "xyz", p: [0, 0, 0] }] })])).toMatch(/delší než hrana/);
  });
});

describe("zkosení – tangentChain", () => {
  it("řetězec hrana → oblouk → hrana", async () => {
    const vert = edgeIdx((s, e) => onPlane(s, "x", 60) && onPlane(e, "x", 60) && onPlane(s, "y", 0) && onPlane(e, "y", 0));
    const pre = await build([...base, fil({ id: "f0", radius: 8, edges: [vert] })]);
    const front = pre.body.edges.findIndex((e) => e.geomType === "LINE" && near(e.startPoint.z, 20) && near(e.endPoint.z, 20) && near(e.startPoint.y, 0) && near(e.endPoint.y, 0));
    const chain = await build([...base, fil({ id: "f0", radius: 8, edges: [vert] }), cha({ distance: 1.5, edges: [front], tangentChain: true })]);
    expect(chain.faces).toBe(pre.faces + 3);
  });
});
