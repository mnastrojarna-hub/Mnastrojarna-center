import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc, buildShape } from "../build";
import { emptyDoc, type CadDoc, type Feature, type SketchEntity, type Vec2 } from "../types";
import { lastPartingInfo, partingProfile } from "./draft-parting";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

type DraftF = Extract<Feature, { type: "draft" }>;
const BOX: Feature = { id: "A", name: "A", type: "box", size: [60, 40, 30], position: [0, 0, 0], centered: false, mode: "new" };
const doc = (features: Feature[]): CadDoc => ({ ...emptyDoc("t"), features });
const k = Math.tan((3 * Math.PI) / 180);
/** ∫₀ᴴ (a − ca·k·t)(b − cb·k·t) dt – průřez zmenšující se od dělicí roviny */
const frustum = (a: number, b: number, H: number, ca = 2, cb = 2) => a * b * H - ((ca * b + cb * a) * k * H * H) / 2 + (ca * cb * k * k * H ** 3) / 3;

const sketch = (id: string, plane: "XY" | "XZ" | "YZ", offset: number, entities: SketchEntity[]): Feature => ({ id, name: id, type: "sketch", plane: { kind: "base", name: plane, offset }, entities });
const line = (id: string, a: Vec2, b: Vec2): SketchEntity => ({ id, type: "line", a, b });
const draft = (p: Partial<DraftF>): DraftF => ({ id: "d", name: "d", type: "draft", angle: 3, faces: [], plane: "XY", offset: 0, ...p });

async function build(features: Feature[]) {
  const res = await buildDoc(doc(features));
  const bad = res.status.filter((s) => !s.ok);
  if (bad.length) throw new Error(bad.map((b) => b.error).join("; "));
  return { vol: res.metrics!.volume, faces: res.body!.faces.length, body: res.body!, bbox: res.metrics!.bbox, valid: res.metrics!.valid, warning: res.status[res.status.length - 1].warning };
}
async function errorOf(features: Feature[]) {
  const res = await buildDoc(doc(features));
  return res.status.find((s) => !s.ok)?.error ?? "";
}
/** indexy bočních ploch kvádru (normála ⟂ Z) */
async function sides(features: Feature[]) {
  const body = (await buildShape(doc(features))).body!;
  return body.faces.map((f, i) => ({ f, i })).filter(({ f }) => f.geomType === "PLANE" && Math.abs(f.normalAt().z) < 1e-9).map(({ i }) => i);
}
/** vzdálenost bodu od tělesa (0 = na povrchu nebo uvnitř; vnitřek pozná BRepExtrema jen u solidu, ne u složeného tvaru) */
function dist(s: r.Shape3D, p: [number, number, number]) {
  const oc = r.getOC() as any;
  let best = Infinity;
  for (const solid of s.solids) {
    const q = new oc.BRepExtrema_DistShapeShape();
    q.LoadS1(solid.wrapped);
    q.LoadS2(r.makeVertex(p).wrapped);
    q.Perform(new oc.Message_ProgressRange());
    const v = q.InnerSolution() ? 0 : q.Value();
    q.delete();
    best = Math.min(best, v);
  }
  return best;
}

describe("profil dělicí čáry (čistá logika)", () => {
  it("seřazení, svislé skoky, prodloužení konců za těleso", () => {
    const { segs, jumps } = partingProfile([[60, 20], [30, 20], [30, 10], [0, 10]], 0, 60, 1e-6);
    expect(jumps).toBe(1);
    expect(segs.length).toBe(2); // konce se prodlouží za těleso ve směru krajních úseků (sloučí se s nimi)
    expect(segs[0]).toMatchObject({ v0: 10, h1: 30, v1: 10 });
    expect(segs[1]).toMatchObject({ h0: 30, v0: 20, v1: 20 });
    expect(segs[0].h0).toBeLessThan(0);
    expect(segs[1].h1).toBeGreaterThan(60);
    // šikmá čára kratší než těleso: prodlouží se ve svém směru (bez zlomu uvnitř tělesa)
    const sl = partingProfile([[10, 10], [50, 20]], 0, 60, 1e-6);
    expect(sl.segs.length).toBe(1);
    expect(sl.segs[0].v0).toBeCloseTo(10 + (sl.segs[0].h0 - 10) / 4, 9);
    expect(sl.segs[0].v1).toBeCloseTo(10 + (sl.segs[0].h1 - 10) / 4, 9);
  });
  it("křivka, která se vrací, je chyba", () => {
    expect(() => partingProfile([[0, 0], [30, 5], [20, 10]], 0, 60, 1e-6)).toThrow(/vrací/);
  });
});

describe("úkos s dělicí křivkou", () => {
  it("rovinná dělicí křivka (skica XY ve výšce 10): obě strany se zužují od dělicí roviny", async () => {
    const base = [BOX, sketch("S", "XY", 10, [line("e1", [0, 0], [60, 0])])];
    const faces = await sides(base);
    expect(faces.length).toBe(4);
    const res = await build([...base, draft({ faces, partingSketchId: "S", pull: { kind: "axis", axis: "Z" } })]);
    expect(res.valid).toBe(true);
    expect(lastPartingInfo?.mode).toBe("plane");
    // nejširší v dělicí rovině, nahoře (20 nad) i dole (10 pod) užší
    expect(res.bbox[0][0]).toBeCloseTo(0, 4);
    expect(res.bbox[1][0]).toBeCloseTo(60, 4);
    const top = res.body.faces.find((f) => f.geomType === "PLANE" && Math.abs(f.center.z - 30) < 1e-6)!;
    expect(top.boundingBox.bounds[1][0] - top.boundingBox.bounds[0][0]).toBeCloseTo(60 - 2 * 20 * k, 4);
    const bottom = res.body.faces.find((f) => f.geomType === "PLANE" && Math.abs(f.center.z) < 1e-6)!;
    expect(bottom.boundingBox.bounds[1][0] - bottom.boundingBox.bounds[0][0]).toBeCloseTo(60 - 2 * 10 * k, 4);
    expect(res.vol).toBeCloseTo(frustum(60, 40, 20) + frustum(60, 40, 10), 2);
    expect(res.faces).toBe(10); // horní, spodní + 4 boční nad a 4 pod dělicí rovinou
  });

  it("šikmá přímá dělicí čára (skica v nárysu): dělicí čára zůstane na místě, nad ní úkos dovnitř", async () => {
    const base = [BOX, sketch("S", "XZ", 0, [line("e1", [0, 10], [60, 20])])];
    const faces = await sides(base);
    const res = await build([...base, draft({ faces, partingSketchId: "S", pull: { kind: "axis", axis: "Z" } })]);
    expect(res.valid).toBe(true);
    expect(lastPartingInfo).toMatchObject({ mode: "profile", jumps: 0, curved: false });
    // body dělicí čáry na přední ploše leží stále na povrchu
    for (const x of [5, 30, 55]) expect(dist(res.body, [x, 0, 10 + x / 6])).toBeLessThan(1e-4);
    // 10 mm nad dělicí čárou je přední plocha zkosená dovnitř o ≈ 10·tg 3°
    expect(dist(res.body, [30, 10 * k * 0.9, 25])).toBeGreaterThan(1e-3);
    expect(dist(res.body, [30, 10 * k * 1.1, 25])).toBe(0);
    expect(res.bbox[0][1]).toBeCloseTo(0, 4); // nejširší v dělicí čáře
    expect(res.warning ?? "").toBe(""); // jediný přímý úsek = přesně, bez upozornění
  });

  it("stupňovitý úkos (skok 10 → 20 v x = 30): každý úsek od své roviny, spojené stupni", async () => {
    // uzavřená lomená čára (tak ji vytvoří text „čára …“) – uzavírací úsek se pro dělicí čáru vynechá
    const step = sketch("S", "XZ", 0, [{ id: "e1", type: "polyline", points: [[0, 10], [30, 10], [30, 20], [60, 20]], closed: true }]);
    const base = [BOX, step];
    const faces = await sides(base);
    const res = await build([...base, draft({ faces, partingSketchId: "S", step: true, pull: { kind: "axis", axis: "Z" } })]);
    expect(res.valid).toBe(true);
    expect(lastPartingInfo).toMatchObject({ mode: "profile", jumps: 1 });
    // sloupec 30 mm: zkosené jsou přední, zadní a čelní stěna (vnitřní řez x = 30 ne)
    const col = (h: number) => frustum(30, 40, h, 1, 2);
    expect(res.vol).toBeCloseTo(2 * (col(20) + col(10)), 1);
    // stupňová plocha v rovině x = 30
    const stepFaces = res.body.faces.filter((f) => f.geomType === "PLANE" && Math.abs(f.center.x - 30) < 1e-6);
    expect(stepFaces.length).toBeGreaterThan(0);
    // dělicí čára na přední ploše v obou úsecích zůstala na povrchu
    expect(dist(res.body, [15, 0, 10])).toBeLessThan(1e-4);
    expect(dist(res.body, [45, 0, 20])).toBeLessThan(1e-4);
    // stejná křivka bez „stupňovitý“: vodorovné úseky = stejný výsledek, svislý skok ohlášen
    const plain = await build([...base, draft({ faces, partingSketchId: "S", pull: { kind: "axis", axis: "Z" } })]);
    expect(plain.vol).toBeCloseTo(res.vol, 3);
    expect(plain.warning).toMatch(/Svislé úseky/);
  });

  it("zakřivená dělicí křivka (oblouk): rovinné úseky, upozornění „přibližně“", async () => {
    const arc = sketch("S", "XZ", 0, [{ id: "e1", type: "arc", a: [0, 12], b: [30, 18], c: [60, 12] }]);
    const base = [BOX, arc];
    const faces = await sides(base);
    const res = await build([...base, draft({ faces, partingSketchId: "S", pull: { kind: "axis", axis: "Z" } })]);
    expect(res.valid).toBe(true);
    expect(res.warning).toMatch(/přibližně/);
    expect(lastPartingInfo?.curved).toBe(true);
    expect(res.vol).toBeLessThan(60 * 40 * 30);
  });

  it("chyby: chybí skica, šikmá rovina skici, bez ploch", async () => {
    const base = [BOX, sketch("S", "XY", 10, [line("e1", [0, 0], [60, 0])])];
    const faces = await sides(base);
    expect(await errorOf([...base, draft({ faces, partingSketchId: "nic" })])).toMatch(/skicu dělicí křivky/);
    expect(await errorOf([...base, draft({ faces: [], partingSketchId: "S" })])).toMatch(/Vyberte plochy/);
    const tilted: Feature = { id: "T", name: "T", type: "sketch", plane: { kind: "custom", origin: [0, 0, 10], normal: [0, 0.5, 1], xDir: [1, 0, 0] }, entities: [line("e1", [0, 0], [60, 0])] };
    expect(await errorOf([BOX, tilted, draft({ faces, partingSketchId: "T", pull: { kind: "axis", axis: "Z" } })])).toMatch(/kolmá na směr tahu/);
  });
});
