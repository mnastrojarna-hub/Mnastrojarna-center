import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc } from "../build";
import { newExtFeature } from "../defaults";
import { emptyDoc, uid, type CadDoc, type Feature } from "../types";
import { ADV_EXT_IDS, checkShape, cylinderOf, registerAdvFont, tangentChain } from "./advanced";
import { getExt } from "./index";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
  const font = readFileSync(path.resolve(__dirname, "../../../public/fonts/Roboto-Bold.ttf"));
  await registerAdvFont(font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength) as ArrayBuffer);
}, 60_000);

const box = (id = "b", size: [number, number, number] = [60, 40, 20]): Feature => ({ id, name: "Kvádr", type: "box", size, position: [0, 0, 0], centered: false, mode: "new" });
const cyl = (id = "c"): Feature => ({ id, name: "Válec", type: "cylinder", radius: 20, height: 50, position: [0, 0, 0], axis: "Z", mode: "new" });
const doc = (features: Feature[]): CadDoc => ({ ...emptyDoc("T"), features });
const ext = (d: CadDoc, id: string, data: Record<string, unknown>): Feature => {
  const f = newExtFeature(d, id);
  if (f.type === "ext") f.data = { ...f.data, ...data };
  return f;
};
const run = async (features: Feature[]) => {
  const res = await buildDoc(doc(features));
  const last = res.status[res.status.length - 1];
  return { res, ok: last.ok, error: last.error, vol: res.metrics?.volume ?? 0, faces: res.metrics?.faces ?? 0 };
};
/** indexy hran kvádru rovnoběžných s osou Z (svislé) */
const verticalEdges = (shape: r.Shape3D) => shape.edges.map((e, i) => ({ e, i })).filter(({ e }) => Math.abs(e.tangentAt(0).z) > 0.99).map(({ i }) => i);

describe("registrace", () => {
  it("všech 18 příkazů je zaregistrováno s českým popiskem", () => {
    for (const id of ADV_EXT_IDS) expect(getExt(id)?.label, id).toBeTruthy();
    expect(ADV_EXT_IDS.length).toBe(18);
  });
});

describe("zaoblení a sražení", () => {
  it("proměnné zaoblení R1→R2 ubere objem a vytvoří zaoblené plochy", async () => {
    const base = r.makeBox([0, 0, 0], [60, 40, 20]) as r.Shape3D;
    const edges = verticalEdges(base);
    const f = ext(doc([box()]), "adv.varFillet", { edges, r1: 2, r2: 8 });
    const { ok, error, vol, faces } = await run([box(), f]);
    expect(ok, error).toBe(true);
    expect(vol).toBeLessThan(48000);
    expect(vol).toBeGreaterThan(45000);
    expect(faces).toBeGreaterThan(6);
  });
  it("plné zaoblení úzké plochy (žebro 60×4×20)", async () => {
    const rib = box("b", [60, 4, 20]);
    const base = r.makeBox([0, 0, 0], [60, 4, 20]) as r.Shape3D;
    const top = base.faces.findIndex((f) => Math.abs(f.center.z - 20) < 1e-6);
    const { ok, error, vol } = await run([rib, ext(doc([rib]), "adv.fullRound", { faces: [top] })]);
    expect(ok, error).toBe(true);
    // odebráno ≈ (4·2 − π·2²/2·0.98²…) ·60 → objem mezi 4600 a 4800 z původních 4800
    expect(vol).toBeLessThan(4800);
    expect(vol).toBeGreaterThan(4600);
  });
  it("tečný řetězec: po zaoblení rohu desky se vybere celý obvod (řetězec > 1 hrana)", async () => {
    let plate = r.makeBox([0, 0, 0], [60, 40, 10]) as r.Shape3D;
    plate = plate.fillet(5, (e) => e.inDirection("Z")) as r.Shape3D; // 4 svislé hrany → obvod horní plochy = 8 hran tečných
    const topEdges = plate.edges.filter((e) => Math.abs(e.startPoint.z - 10) < 1e-6 && Math.abs(e.endPoint.z - 10) < 1e-6);
    const chain = tangentChain(plate, [topEdges[0]]);
    expect(chain.length).toBe(8);
    const idx = plate.edges.findIndex((e) => e.isSame(topEdges[0]));
    const rawDoc: CadDoc = doc([box("b", [60, 40, 10]), { id: "f0", name: "Z", type: "fillet", radius: 5, edges: verticalEdges(r.makeBox([0, 0, 0], [60, 40, 10]) as r.Shape3D) }]);
    const f = ext(rawDoc, "adv.chainFillet", { edges: [idx], radius: 2 });
    const { ok, error, vol } = await run([...rawDoc.features, f]);
    expect(ok, error).toBe(true);
    expect(vol).toBeLessThan(24000 - 4 * 25 * 10 + 4 * Math.PI * 25 * 10 * 0.25);
  });
  it("nestejné sražení D1×D2 a D×úhel; nulové D1 je chyba", async () => {
    const base = r.makeBox([0, 0, 0], [60, 40, 20]) as r.Shape3D;
    const edges = verticalEdges(base).slice(0, 1);
    const a = await run([box(), ext(doc([box()]), "adv.chamfer2", { edges, kind: "dd", d1: 6, d2: 3 })]);
    expect(a.ok, a.error).toBe(true);
    expect(a.vol).toBeCloseTo(48000 - 0.5 * 6 * 3 * 20, 0);
    const b = await run([box(), ext(doc([box()]), "adv.chamfer2", { edges, kind: "da", d1: 6, angle: 45 })]);
    expect(b.ok, b.error).toBe(true);
    expect(b.vol).toBeCloseTo(48000 - 0.5 * 6 * 6 * 20, 0);
    const c = await run([box(), ext(doc([box()]), "adv.chamfer2", { edges, kind: "dd", d1: 0, d2: 3 })]);
    expect(c.ok).toBe(false);
    expect(c.error).toMatch(/kladná/);
  });
});

describe("pole a kopie", () => {
  it("zrcadlení prvku (díra) přes rovinu YZ zdvojnásobí odebraný objem", async () => {
    const b = box("b", [100, 40, 20]);
    const hole: Feature = { id: "h", name: "Díra", type: "cylinder", radius: 5, height: 20, position: [30, 20, 0], axis: "Z", mode: "cut" };
    const m = ext(doc([b, hole]), "adv.mirrorFeatures", { feature: "h", plane: "YZ", offset: 50 });
    const { ok, error, vol } = await run([b, hole, m]);
    expect(ok, error).toBe(true);
    expect(vol).toBeCloseTo(80000 - 2 * Math.PI * 25 * 20, 0);
  });
  it("pole podél křivky rozmístí 4 kopie čepu po úsečce", async () => {
    const b = box("b", [100, 40, 10]);
    const pin: Feature = { id: "p", name: "Čep", type: "cylinder", radius: 3, height: 10, position: [10, 20, 10], axis: "Z", mode: "add" };
    const sk: Feature = { id: "s", name: "Dráha", type: "sketch", plane: { kind: "base", name: "XY", offset: 10 }, entities: [{ id: "l", type: "line", a: [10, 20], b: [90, 20] }] };
    const pat = ext(doc([b, pin, sk]), "adv.curvePattern", { feature: "p", path: "s", count: 4, follow: true });
    const { ok, error, vol } = await run([b, pin, sk, pat]);
    expect(ok, error).toBe(true);
    expect(vol).toBeCloseTo(40000 + 4 * Math.PI * 9 * 10, 0);
  });
  it("výplňové pole: díry v mřížce uvnitř obdélníku s odstupem", async () => {
    const b = box("b", [100, 60, 10]);
    const hole: Feature = { id: "h", name: "Díra", type: "cylinder", radius: 2, height: 10, position: [10, 10, 0], axis: "Z", mode: "cut" };
    const sk: Feature = { id: "s", name: "Oblast", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [{ id: "r", type: "rect", cx: 50, cy: 30, w: 100, h: 60, r: 0, angle: 0 }] };
    const pat = ext(doc([b, hole, sk]), "adv.fillPattern", { feature: "h", region: "s", dx: 20, dy: 20, margin: 5 });
    const { ok, error, vol } = await run([b, hole, sk, pat]);
    expect(ok, error).toBe(true);
    // body 10,30,50,70,90 × 10,30,50 = 15 děr (všechny ≥ 5 mm od okraje)
    expect(vol).toBeCloseTo(60000 - 15 * Math.PI * 4 * 10, 0);
  });
  it("znovu použitý nástroj: čep přidaný jako „add“ se posunutý odebere", async () => {
    const b = box("b", [100, 40, 20]);
    const pin: Feature = { id: "p", name: "Čep", type: "cylinder", radius: 5, height: 20, position: [20, 20, 0], axis: "Z", mode: "intersect" };
    // průnik kvádru s válcem = válec (V = π·25·20); týž nástroj posunutý o 10 nahoru odebere horní polovinu
    const c = ext(doc([b, pin]), "adv.combineTool", { feature: "p", mode: "cut", offset: [0, 0, 10] });
    const { ok, error, vol } = await run([b, pin, c]);
    expect(ok, error).toBe(true);
    expect(vol).toBeCloseTo(Math.PI * 25 * 10, 0);
    const far = await run([b, pin, ext(doc([b, pin]), "adv.combineTool", { feature: "p", mode: "cut", offset: [40, 0, 0] })]);
    expect(far.vol).toBeCloseTo(Math.PI * 25 * 20, 0);
  });
  it("měřítko v bodě 2× zvětší objem 8×", async () => {
    const { ok, error, vol } = await run([box(), ext(doc([box()]), "adv.scaleAbout", { factor: 2, useCenter: true })]);
    expect(ok, error).toBe(true);
    expect(vol).toBeCloseTo(48000 * 8, 0);
  });
});

describe("pokročilé tvary", () => {
  it("zkrut: čtverec vysunutý s otočením 90° má objem profil × výška", async () => {
    const sk: Feature = { id: "s", name: "Profil", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [{ id: "r", type: "rect", cx: 0, cy: 0, w: 20, h: 20, r: 0, angle: 0 }] };
    const { ok, error, vol } = await run([sk, ext(doc([sk]), "adv.twist", { sketch: "s", height: 50, angle: 90, mode: "new" })]);
    expect(ok, error).toBe(true);
    expect(vol).toBeCloseTo(400 * 50, -2);
  });
  it("kopule na horní ploše válce přidá ≈ 2/3·π·R²·h, důlek stejně odebere", async () => {
    const base = r.makeCylinder(20, 50) as r.Shape3D;
    const top = base.faces.findIndex((f) => f.geomType === "PLANE" && f.center.z > 25);
    const a = await run([cyl(), ext(doc([cyl()]), "adv.dome", { faces: [top], height: 10, radius: 20, mode: "add" })]);
    expect(a.ok, a.error).toBe(true);
    expect(a.vol).toBeCloseTo(Math.PI * 400 * 50 + (2 / 3) * Math.PI * 400 * 10, -3);
    const b = await run([cyl(), ext(doc([cyl()]), "adv.dome", { faces: [top], height: 10, radius: 15, mode: "cut" })]);
    expect(b.ok, b.error).toBe(true);
    expect(b.vol).toBeLessThan(Math.PI * 400 * 50);
  });
  it("text na válci: gravírování ubere, reliéf přidá; prázdný text je chyba", async () => {
    const base = r.makeCylinder(20, 50) as r.Shape3D;
    const side = base.faces.findIndex((f) => f.geomType === "CYLINDRE");
    expect(cylinderOf(base.faces[side]).R).toBeCloseTo(20, 6);
    const v0 = Math.PI * 400 * 50;
    const a = await run([cyl(), ext(doc([cyl()]), "adv.textOnCyl", { faces: [side], text: "MN", size: 8, depth: 1, mode: "cut" })]);
    expect(a.ok, a.error).toBe(true);
    expect(a.vol).toBeLessThan(v0 - 5);
    const b = await run([cyl(), ext(doc([cyl()]), "adv.textOnCyl", { faces: [side], text: "MN", size: 8, depth: 1, mode: "add", along: "axis" })]);
    expect(b.ok, b.error).toBe(true);
    expect(b.vol).toBeGreaterThan(v0 + 5);
    const c = await run([cyl(), ext(doc([cyl()]), "adv.textOnCyl", { faces: [side], text: "  " })]);
    expect(c.ok).toBe(false);
    expect(c.error).toMatch(/text/i);
  }, 60_000);
  it("úkos od dělicí roviny ukosí stěny nad i pod rovinou", async () => {
    const b = box("b", [40, 40, 40]);
    const { ok, error, vol, res } = await run([b, ext(doc([b]), "adv.partingDraft", { angle: 5, plane: "XY", offset: 20 })]);
    expect(ok, error).toBe(true);
    expect(vol).toBeLessThan(64000);
    expect(vol).toBeGreaterThan(50000);
    // dělicí rovina zůstává největší průřez: šířka v z=20 = 40, nahoře i dole menší
    const bb = res.metrics!.bbox;
    expect(bb[1][0] - bb[0][0]).toBeCloseTo(40, 1);
  });
  it("lem přidá a drážka odebere objem ≈ obvod·šířka·hloubka", async () => {
    const base = r.makeBox([0, 0, 0], [60, 40, 20]) as r.Shape3D;
    const top = base.faces.findIndex((f) => Math.abs(f.center.z - 20) < 1e-6);
    const lip = await run([box(), ext(doc([box()]), "adv.lipGroove", { faces: [top], kind: "lip", width: 3, depth: 2, inset: 0 })]);
    expect(lip.ok, lip.error).toBe(true);
    const ring = (60 * 40 - 54 * 34) * 2;
    expect(lip.vol).toBeCloseTo(48000 + ring, 0);
    const gr = await run([box(), ext(doc([box()]), "adv.lipGroove", { faces: [top], kind: "groove", width: 3, depth: 2, inset: 5 })]);
    expect(gr.ok, gr.error).toBe(true);
    expect(gr.vol).toBeCloseTo(48000 - (50 * 30 - 44 * 24) * 2, 0);
  });
  it("díry v bodech skici (3 body + 1 kružnice) vrtají 4 díry; zahloubení ubere víc", async () => {
    const b = box("b", [100, 60, 10]);
    const sk: Feature = {
      id: "s",
      name: "Body",
      type: "sketch",
      plane: { kind: "base", name: "XY", offset: 10 },
      entities: [
        { id: "p1", type: "point", p: [20, 20] },
        { id: "p2", type: "point", p: [50, 20] },
        { id: "p3", type: "point", p: [80, 20] },
        { id: "c1", type: "circle", cx: 50, cy: 45, r: 7 },
      ],
    };
    const a = await run([b, sk, ext(doc([b, sk]), "adv.holesAtPoints", { sketch: "s", diameter: 6, depth: 0, cbDiameter: 0 })]);
    expect(a.ok, a.error).toBe(true);
    expect(a.vol).toBeCloseTo(60000 - 4 * Math.PI * 9 * 10, 0);
    const c = await run([b, sk, ext(doc([b, sk]), "adv.holesAtPoints", { sketch: "s", diameter: 6, depth: 0, cbDiameter: 10, cbDepth: 3 })]);
    expect(c.ok, c.error).toBe(true);
    expect(c.vol).toBeCloseTo(60000 - 4 * Math.PI * 9 * 10 - 4 * Math.PI * (25 - 9) * 3, 0);
  });
});

describe("geometrie", () => {
  it("kontrola geometrie projde u platného tělesa a nemění ho; sjednocení ploch sloučí plochy", async () => {
    const b = box();
    const a = await run([b, ext(doc([b]), "adv.check", {})]);
    expect(a.ok, a.error).toBe(true);
    expect(a.vol).toBeCloseTo(48000, 6);
    expect(checkShape(r.makeBox([0, 0, 0], [1, 1, 1]) as r.Shape3D)).toEqual([]);
    // dva slepené kvádry → 2 souplošné horní plochy → po sjednocení 6 ploch
    const b2: Feature = { id: "b2", name: "K2", type: "box", size: [60, 40, 20], position: [60, 0, 0], centered: false, mode: "add" };
    const before = await run([b, b2]);
    const after = await run([b, b2, ext(doc([b, b2]), "adv.simplify", {})]);
    expect(after.ok, after.error).toBe(true);
    expect(after.faces).toBeLessThanOrEqual(before.faces);
    expect(after.faces).toBe(6);
    expect(after.vol).toBeCloseTo(before.vol, 3);
  });
  it("prvky bez tělesa hlásí českou chybu", async () => {
    const d = doc([]);
    const res = await buildDoc({ ...d, features: [{ id: uid(), name: "x", type: "ext", ext: "adv.simplify", data: {} }] });
    expect(res.status[0].ok).toBe(false);
    expect(res.status[0].error).toMatch(/těleso/);
  });
});
