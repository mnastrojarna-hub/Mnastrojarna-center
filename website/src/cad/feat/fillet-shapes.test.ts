import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc, buildShape } from "../build";
import { isValidShape } from "../check";
import { emptyDoc, type CadDoc, type Feature, type Vec3 } from "../types";
import { conicRegionArea, lastSetbackReport } from "./fillet-shapes";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

type FilletF = Extract<Feature, { type: "fillet" }>;
const BOX: Feature = { id: "A", name: "A", type: "box", size: [60, 40, 20], position: [0, 0, 0], centered: false, mode: "new" };
const BOX_VOL = 60 * 40 * 20;
const doc = (features: Feature[]): CadDoc => ({ ...emptyDoc("t"), features });
const fil = (p: Partial<FilletF>): FilletF => ({ id: "f", name: "f", type: "fillet", radius: 2, edges: "all", ...p });
const near = (a: number, b: number, t = 1e-6) => Math.abs(a - b) < t;

async function build(features: Feature[]) {
  const res = await buildDoc(doc(features));
  const bad = res.status.filter((s) => !s.ok);
  if (bad.length) throw new Error(bad.map((b) => b.error).join("; "));
  return { vol: res.metrics!.volume, faces: res.body!.faces.length, body: res.body!, valid: res.metrics!.valid, warning: res.status[res.status.length - 1].warning };
}
async function errorOf(features: Feature[]) {
  const res = await buildDoc(doc(features));
  return res.status.find((s) => !s.ok)?.error ?? "";
}
async function shapeOf(features: Feature[]) {
  return (await buildShape(doc(features))).body!;
}
const edgeWhere = (s: r.Shape3D, pred: (a: r.Vector, b: r.Vector) => boolean) => s.edges.findIndex((e) => pred(e.startPoint, e.endPoint));
const unit = (v: r.Vector): Vec3 => {
  const l = Math.hypot(v.x, v.y, v.z);
  return [v.x / l, v.y / l, v.z / l];
};
const angleDeg = (a: Vec3, b: Vec3) => (Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI;

describe("eliptické / kuželosečkové zaoblení", () => {
  let box: r.Shape3D;
  /** horní přední hrana (y = 0, z = 20) */
  let topFront = -1;
  beforeAll(async () => {
    box = await shapeOf([BOX]);
    topFront = edgeWhere(box, (a, b) => near(a.z, 20) && near(b.z, 20) && near(a.y, 0) && near(b.y, 0));
  });

  it("přímá hrana: odebraný průřez = D1·D2·(1 − π/4), D1 na horní ploše", async () => {
    const { vol, faces, body, valid } = await build([BOX, fil({ kind: "conic", radius: 4, r2: 2, edges: [topFront] })]);
    const area = 4 * 2 * (1 - Math.PI / 4);
    expect(vol).toBeCloseTo(BOX_VOL - area * 60, 2);
    expect(conicRegionArea(4, 2, 90, Math.SQRT1_2)).toBeCloseTo(area, 4);
    expect(faces).toBe(7);
    expect(valid).toBe(true);
    // D1 = 4 na horní ploše: horní plocha začíná v y = 4, přední plocha končí v z = 18
    const top = body.faces.find((f) => f.geomType === "PLANE" && near(f.center.z, 20))!;
    expect(top.boundingBox.bounds[0][1]).toBeCloseTo(4, 4);
    const front = body.faces.find((f) => f.geomType === "PLANE" && near(f.center.y, 0))!;
    expect(front.boundingBox.bounds[1][2]).toBeCloseTo(18, 4);
    // eliptický průřez je tečný k oběma plochám: normála plochy zaoblení u hran = normály rovin
    const conic = body.faces.find((f) => f.geomType !== "PLANE")!;
    expect(angleDeg(unit(conic.normalAt([30, 4, 20])), [0, 0, 1])).toBeLessThan(0.05);
    expect(angleDeg(unit(conic.normalAt([30, 0, 18])), [0, 1, 0])).toBeLessThan(0.05);
  });

  it("D1 na zvolené ploše (faceRefs = přední plocha) prohodí strany", async () => {
    const front = box.faces.findIndex((f) => f.geomType === "PLANE" && near(f.center.y, 0));
    const { body } = await build([BOX, fil({ kind: "conic", radius: 4, r2: 2, edges: [topFront], faceRefs: [{ kind: "face", index: front }] })]);
    const top = body.faces.find((f) => f.geomType === "PLANE" && near(f.center.z, 20))!;
    expect(top.boundingBox.bounds[0][1]).toBeCloseTo(2, 4);
  });

  it("kuželosečka rho = 0,5 (parabola): odebraný průřez = D1·D2/6", async () => {
    const { vol } = await build([BOX, fil({ kind: "conic", radius: 4, r2: 3, rho: 0.5, edges: [topFront] })]);
    expect(vol).toBeCloseTo(BOX_VOL - (4 * 3 * 60) / 6, 2);
    expect(conicRegionArea(4, 3, 90, 1)).toBeCloseTo(2, 4);
  });

  it("kruhová hrana válce: rotace průřezu, objem podle Pappovy věty", async () => {
    const cyl: Feature = { id: "C", name: "C", type: "cylinder", radius: 20, height: 20, position: [0, 0, 0], axis: "Z", mode: "new" };
    const s = await shapeOf([cyl]);
    const top = s.edges.findIndex((e) => e.geomType === "CIRCLE" && near(e.startPoint.z, 20));
    const { vol, valid, warning } = await build([cyl, fil({ kind: "conic", radius: 4, r2: 2, edges: [top] })]);
    const d1 = 4;
    const d2 = 2;
    const A = d1 * d2 * (1 - Math.PI / 4);
    const xBar = (d1 * (5 / 6 - Math.PI / 4)) / (1 - Math.PI / 4); // těžiště odebrané oblasti od hrany směrem do horní plochy
    const removed = A * 2 * Math.PI * (20 - xBar);
    expect(vol).toBeCloseTo(Math.PI * 400 * 20 - removed, 1);
    expect(valid).toBe(true);
    expect(warning ?? "").not.toMatch(/přibližně/);
  });

  it("vnitřní kruhová hrana (čep na desce): přidaný materiál podle Pappovy věty", async () => {
    const plate: Feature = { id: "P", name: "P", type: "box", size: [80, 80, 10], position: [-40, -40, 0], centered: false, mode: "new" };
    const boss: Feature = { id: "C", name: "C", type: "cylinder", radius: 15, height: 20, position: [0, 0, 10], axis: "Z", mode: "add" };
    const s = await shapeOf([plate, boss]);
    const base = s.edges.findIndex((e) => e.geomType === "CIRCLE" && near(e.startPoint.z, 10));
    expect(base).toBeGreaterThanOrEqual(0);
    const v0 = r.measureVolume(s);
    const { vol, valid, warning } = await build([plate, boss, fil({ kind: "conic", radius: 4, r2: 2, edges: [base] })]);
    const A = 4 * 2 * (1 - Math.PI / 4);
    const xBar = (4 * (5 / 6 - Math.PI / 4)) / (1 - Math.PI / 4); // D1 po desce směrem od čepu
    expect(vol - v0).toBeCloseTo(A * 2 * Math.PI * (15 + xBar), 1);
    expect(valid).toBe(true);
    expect(warning ?? "").not.toMatch(/přibližně/);
  });

  it("vnitřní hrana (L profil): materiál se přidá, průřez D1·D2·(1 − π/4)", async () => {
    const step: Feature = { id: "B", name: "B", type: "box", size: [60, 20, 20], position: [0, 20, 20], centered: false, mode: "add" };
    const s = await shapeOf([BOX, step]);
    // vnitřní hrana: y = 20, z = 20, podél X
    const inner = edgeWhere(s, (a, b) => near(a.y, 20) && near(b.y, 20) && near(a.z, 20) && near(b.z, 20) && Math.abs(a.x - b.x) > 59);
    expect(inner).toBeGreaterThanOrEqual(0);
    const v0 = BOX_VOL + 60 * 20 * 20;
    const { vol, valid } = await build([BOX, step, fil({ kind: "conic", radius: 5, r2: 3, edges: [inner] })]);
    expect(vol).toBeCloseTo(v0 + 5 * 3 * (1 - Math.PI / 4) * 60, 2);
    expect(valid).toBe(true);
  });

  it("obecná hrana (elipsa šikmého řezu válce): šablonování průřezů, upozornění „přibližně“", async () => {
    const cyl: Feature = { id: "C", name: "C", type: "cylinder", radius: 20, height: 40, position: [0, 0, 0], axis: "Z", mode: "new" };
    const cut: Feature = { id: "S", name: "S", type: "split", plane: "XY", offset: 0, keep: "negative", planeDef: { kind: "custom", origin: [0, 0, 30], normal: [0.3, 0, 1], xDir: [1, 0, -0.3] } };
    const s = await shapeOf([cyl, cut]);
    const ell = s.edges.findIndex((e) => e.geomType !== "LINE" && e.geomType !== "CIRCLE" && e.boundingBox.bounds[1][2] > 25);
    expect(ell).toBeGreaterThanOrEqual(0);
    const v0 = r.measureVolume(s);
    const { vol, warning, valid } = await build([cyl, cut, fil({ kind: "conic", radius: 3, r2: 2, edges: [ell] })]);
    const L = s.edges[ell].length;
    const removed = 3 * 2 * (1 - Math.PI / 4) * L; // přibližně (hrana je zakřivená, úhel ploch se mění)
    expect(v0 - vol).toBeGreaterThan(removed * 0.75);
    expect(v0 - vol).toBeLessThan(removed * 1.35);
    expect(valid).toBe(true);
    expect(warning).toMatch(/přibližně/);
  });

  it("chyby: záporná vzdálenost, rho mimo (0, 1)", async () => {
    expect(await errorOf([BOX, fil({ kind: "conic", radius: 4, r2: -1, edges: [topFront] })])).toMatch(/D1 i D2/);
    expect(await errorOf([BOX, fil({ kind: "conic", radius: 4, r2: 2, rho: 1.2, edges: [topFront] })])).toMatch(/rho/);
  });
});

describe("setback – zaoblení zastavené před vrcholem s hladkou záplatou", () => {
  let box: r.Shape3D;
  let corner: number[] = [];
  beforeAll(async () => {
    box = await shapeOf([BOX]);
    // tři hrany z rohu (0, 0, 0)
    const at0 = (v: r.Vector) => Math.hypot(v.x, v.y, v.z) < 1e-6;
    corner = box.edges.map((e, i) => (at0(e.startPoint) || at0(e.endPoint) ? i : -1)).filter((i) => i >= 0);
  });

  it("roh kvádru se třemi zaobleními: platné těleso, záplata G1 k zaoblením i plochám", async () => {
    const dflt = await build([BOX, fil({ radius: 3, edges: corner })]);
    const sb = await build([BOX, fil({ kind: "setback", radius: 3, setback: 6, edges: corner })]);
    expect(sb.valid).toBe(true);
    expect(lastSetbackReport.corners).toBe(1);
    expect(lastSetbackReport.g1).toBeLessThan(0.005); // rad
    expect(sb.faces).toBe(dflt.faces); // 6 rovin + 3 zaoblení + 1 záplata (místo koule)
    // objem: rozšířená záplata ubere víc než výchozí kulový roh, ale jen v oblasti rohu (krychle setbacku)
    expect(sb.vol).toBeLessThan(dflt.vol);
    expect(sb.vol).toBeGreaterThan(dflt.vol - 6 ** 3);
    expect(sb.vol).toBeLessThan(BOX_VOL);
    // tečná spojitost: normála záplaty = normála zaoblení na konci zaoblení (rovina x = 6) a normála roviny z = 0 na hraniční křivce
    const patch = sb.body.faces.find((f) => f.geomType === "BSPLINE_SURFACE" || f.geomType === "BEZIER_SURFACE")!;
    expect(patch).toBeTruthy();
    const cylX = sb.body.faces.find((f) => f.geomType === "CYLINDRE" && f.boundingBox.bounds[1][0] > 50)!;
    for (const t of [0.2, 0.5, 0.8]) {
      const a = (t * Math.PI) / 2;
      const p: Vec3 = [6, 3 - 3 * Math.cos(a), 3 - 3 * Math.sin(a)]; // průřez zaoblení hrany X v rovině x = 6
      expect(angleDeg(unit(patch.normalAt(p)), unit(cylX.normalAt(p)))).toBeLessThan(0.5);
    }
    // hraniční křivka na ploše z = 0 vede z (6, 3) do (3, 6) – uprostřed je bod kruhového oblouku se středem (6, 6)
    const mid: Vec3 = [6 - 3 * Math.SQRT1_2, 6 - 3 * Math.SQRT1_2, 0];
    expect(angleDeg(unit(patch.normalAt(mid)), [0, 0, 1])).toBeLessThan(0.5);
    expect(isValidShape(sb.body)).toBe(true);
  });

  it("větší setback ubere víc; setback = poloměr ≈ výchozí kulový roh", async () => {
    const dflt = await build([BOX, fil({ radius: 3, edges: corner })]);
    const s3 = await build([BOX, fil({ kind: "setback", radius: 3, edges: corner })]); // výchozí setback = poloměr
    const s6 = await build([BOX, fil({ kind: "setback", radius: 3, setback: 6, edges: corner })]);
    const s9 = await build([BOX, fil({ kind: "setback", radius: 3, setback: 9, edges: corner })]);
    // N-stranná záplata (MakeFilling) nahradí kulový osmiúhelník – odchylka objemu do 2 % objemu rohu r³
    expect(Math.abs(s3.vol - dflt.vol)).toBeLessThan(0.02 * 3 ** 3);
    expect(s9.vol).toBeLessThan(s6.vol);
    expect(s6.vol).toBeLessThan(s3.vol);
  });

  it("setback pro jednotlivý vrchol (odkaz na bod) přebije výchozí hodnotu", async () => {
    const one = await build([BOX, fil({ kind: "setback", radius: 3, setback: 3, setbacks: [{ at: { kind: "xyz", p: [0, 0, 0] }, d: 8 }], edges: corner })]);
    const s8 = await build([BOX, fil({ kind: "setback", radius: 3, setback: 8, edges: corner })]);
    expect(one.vol).toBeCloseTo(s8.vol, 3);
  });

  it("dva rohy (celá horní plocha + svislé hrany)", async () => {
    // horní obvod a čtyři svislé hrany: 4 rohy se 3 hranami
    const top = box.edges.map((e, i) => (near(e.startPoint.z, 20) && near(e.endPoint.z, 20) ? i : -1)).filter((i) => i >= 0);
    const vert = box.edges.map((e, i) => (Math.abs(e.startPoint.z - e.endPoint.z) > 19 ? i : -1)).filter((i) => i >= 0);
    const res = await build([BOX, fil({ kind: "setback", radius: 2, setback: 5, edges: [...top, ...vert] })]);
    expect(res.valid).toBe(true);
    expect(lastSetbackReport.corners).toBe(4);
  });

  it("všechny hrany kvádru: 8 rohů se záplatou, stejný počet ploch jako běžné zaoblení", async () => {
    const all = await build([BOX, fil({ kind: "setback", radius: 3, setback: 6 })]);
    expect(all.valid).toBe(true);
    expect(lastSetbackReport.corners).toBe(8);
    expect(lastSetbackReport.g1).toBeLessThan(0.005);
    const dflt = await build([BOX, fil({ radius: 3 })]);
    expect(all.faces).toBe(dflt.faces);
    expect(all.vol).toBeLessThan(dflt.vol);
    expect(all.vol).toBeGreaterThan(dflt.vol - 8 * 6 ** 3);
  }, 60_000);

  it("upozornění a chyby: bez rohu, setback menší než poloměr, delší než hrana", async () => {
    const two = await build([BOX, fil({ kind: "setback", radius: 3, setback: 6, edges: corner.slice(0, 2) })]);
    expect(two.warning).toMatch(/aspoň 3 hrany/);
    expect(await errorOf([BOX, fil({ kind: "setback", radius: 3, setback: 2, edges: corner })])).toMatch(/příliš malý/);
    expect(await errorOf([BOX, fil({ kind: "setback", radius: 3, setback: 25, edges: corner })])).toMatch(/delší než hrana/);
  });
});
