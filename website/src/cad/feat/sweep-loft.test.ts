import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc } from "../build";
import { emptyDoc, type CadDoc, type Feature, type SketchPlane, type Vec3 } from "../types";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

type SweepF = Extract<Feature, { type: "sweep" }>;
type LoftF = Extract<Feature, { type: "loft" }>;

const XY = (offset = 0): SketchPlane => ({ kind: "base", name: "XY", offset });
const XZ: SketchPlane = { kind: "base", name: "XZ", offset: 0 };
const sketch = (id: string, plane: SketchPlane, entities: Extract<Feature, { type: "sketch" }>["entities"]): Feature => ({ id, name: id, type: "sketch", plane, entities });
const circle = (id: string, rad: number, plane: SketchPlane = XY(), cx = 0, cy = 0) => sketch(id, plane, [{ id: "c", type: "circle", cx, cy, r: rad }]);
const rect = (id: string, w: number, h: number, plane: SketchPlane = XY(), cx = 0, cy = 0) => sketch(id, plane, [{ id: "r", type: "rect", cx, cy, w, h, r: 0, angle: 0 }]);
/** úsečka ve skice XZ: (x, z) → svět (x, 0, z) */
const lineXZ = (id: string, a: [number, number], b: [number, number]) => sketch(id, XZ, [{ id: "l", type: "line", a, b }]);
/** dráha z testu jádra: úsečka 50 + čtvrtoblouk R30 + úsečka 50 (délka 50 + 15π + 50) */
const bentPath = (id = "p") => sketch(id, XZ, [
  { id: "l1", type: "line", a: [0, 0], b: [0, 50] },
  { id: "a1", type: "arc", a: [0, 50], b: [8.7868, 71.2132], c: [30, 80] },
  { id: "l2", type: "line", a: [80, 80], b: [30, 80] },
]);
const BENT_LEN = 50 + (Math.PI / 2) * 30 + 50;
const sweep = (o: Partial<SweepF> = {}): Feature => ({ id: "sw", name: "Tažení", type: "sweep", profileId: "s", pathId: "p", mode: "new", frenet: false, ...o });
const loft = (o: Partial<LoftF> = {}): Feature => ({ id: "lf", name: "Šablonování", type: "loft", sketchIds: ["a", "b"], ruled: true, mode: "new", ...o });
const doc = (features: Feature[]): CadDoc => ({ ...emptyDoc("t"), features });

const build = async (features: Feature[]) => {
  const res = await buildDoc(doc(features));
  return { res, v: res.metrics?.volume ?? 0, bad: res.status.filter((s) => !s.ok), body: res.body };
};
const vol = async (features: Feature[]) => {
  const { v, bad } = await build(features);
  if (bad.length) throw new Error(bad.map((b) => b.error).join("; "));
  return v;
};
const err = async (features: Feature[]) => {
  const { bad } = await build(features);
  return bad.map((b) => b.error ?? "").join("; ");
};
const within = (v: number, expected: number, rel: number) => expect(Math.abs(v - expected) / expected).toBeLessThanOrEqual(rel);
const A5 = Math.PI * 25;

describe("tažení – základ", () => {
  it("kruh r5 po přímce 100: objem πr²·L (Frenet i korigovaný)", async () => {
    const v1 = await vol([circle("s", 5), lineXZ("p", [0, 0], [0, 100]), sweep({ frenet: true })]);
    expect(v1).toBeCloseTo(A5 * 100, 0);
    const v2 = await vol([circle("s", 5), lineXZ("p", [0, 0], [0, 100]), sweep({ frenet: false })]);
    expect(v2).toBeCloseTo(A5 * 100, 0);
  });
  it("zachované chování: dráha úsečka + oblouk + úsečka", async () => {
    const v = await vol([bentPath(), circle("s", 5), sweep({ frenet: true })]);
    expect(v).toBeCloseTo(A5 * BENT_LEN, -1);
  });
  it("profil s otvorem (trubka) a tenká stěna čtverce", async () => {
    const tube = await vol([sketch("s", XY(), [{ id: "c", type: "circle", cx: 0, cy: 0, r: 10 }, { id: "c2", type: "circle", cx: 0, cy: 0, r: 6 }]), lineXZ("p", [0, 0], [0, 100]), sweep()]);
    expect(tube).toBeCloseTo(Math.PI * (100 - 36) * 100, -1);
    const thin = await vol([rect("s", 20, 20), lineXZ("p", [0, 0], [0, 100]), sweep({ thin: { side: "in", t1: 2 } })]);
    expect(thin).toBeCloseTo((400 - 256) * 100, 0);
  });
  it("kruhový profil bez skici (circleRadius) – přímka i zakřivená dráha, tenká stěna = mezikruží", async () => {
    const v = await vol([lineXZ("p", [0, 0], [0, 100]), sweep({ profileId: "", circleRadius: 5 })]);
    expect(v).toBeCloseTo(A5 * 100, 0);
    const bent = await vol([bentPath(), sweep({ profileId: "", circleRadius: 5, frenet: true })]);
    expect(bent).toBeCloseTo(A5 * BENT_LEN, -1);
    const ring = await vol([lineXZ("p", [0, 0], [0, 100]), sweep({ profileId: "", circleRadius: 5, thin: { side: "one", t1: 2 } })]);
    expect(ring).toBeCloseTo(Math.PI * (49 - 25) * 100, 0);
  });
  it("vodicí křivka (auxiliarySpine) rovnoběžná s dráhou nemění objem", async () => {
    const v = await vol([circle("s", 5), lineXZ("p", [0, 0], [0, 100]), lineXZ("g", [20, 0], [20, 100]), sweep({ guideId: "g" })]);
    expect(v).toBeCloseTo(A5 * 100, 0);
    const bent = await vol([bentPath(), sketch("g", XZ, [{ id: "l1", type: "line", a: [-10, 0], b: [-10, 50] }, { id: "a1", type: "arc", a: [-10, 50], b: [1.716, 78.284], c: [30, 90] }, { id: "l2", type: "line", a: [30, 90], b: [80, 90] }]), circle("s", 5), sweep({ guideId: "g" })]);
    within(bent, A5 * BENT_LEN, 0.03);
  });
  it("přechod v rozích: pravoúhlý (přesně A·L), zaoblený (větší), transformovaný (staví)", async () => {
    const corner = (transition: SweepF["transition"]) => vol([circle("s", 5), sketch("p", XZ, [{ id: "l1", type: "line", a: [0, 0], b: [0, 50] }, { id: "l2", type: "line", a: [0, 50], b: [50, 50] }]), sweep({ transition })]);
    const right = await corner("right");
    expect(right).toBeCloseTo(A5 * 100, 0);
    // zaoblený roh: válce useknuté kolmo v rohu (− čtvrtina Steinmetzova průniku) + čtvrtina koule r5
    const round = await corner("round");
    within(round, A5 * 100 - (16 * 125) / 3 / 4 + ((4 / 3) * Math.PI * 125) / 4, 0.005);
    expect(round).not.toBeCloseTo(right, 0);
    // transformovaný přechod je určen pro hladké dráhy (v ostrém rohu jádro vrací zdegenerovaný tvar – jen že staví)
    expect(await corner("transformed")).toBeGreaterThan(0);
    within(await vol([bentPath(), circle("s", 5), sweep({ transition: "transformed" })]), A5 * BENT_LEN, 0.001);
  });
});

describe("tažení – kroucení, měřítko, pevná orientace", () => {
  it("kroucení 90° zachová objem (±1 %) a profil je skutečně natočený", async () => {
    const { v, bad, res } = await build([rect("s", 20, 10), lineXZ("p", [0, 0], [0, 100]), sweep({ twist: 90 })]);
    expect(bad).toEqual([]);
    within(v, 20 * 10 * 100, 0.01);
    const bb = res.metrics!.bbox;
    expect(bb[1][0] - bb[0][0]).toBeGreaterThan(20.5); // při 45° je šířka 21,2
    expect(bb[1][1] - bb[0][1]).toBeGreaterThan(19); // na konci je profil otočený o 90°
  });
  it("jedna otáčka (twistTurns) zachová objem, kroucení po zakřivené dráze sleduje dráhu", async () => {
    within(await vol([rect("s", 20, 10), lineXZ("p", [0, 0], [0, 100]), sweep({ twistTurns: 1 })]), 20000, 0.01);
    const { v, bad, res } = await build([bentPath(), rect("s", 10, 6), sweep({ twist: 180 })]);
    expect(bad).toEqual([]);
    within(v, 60 * BENT_LEN, 0.03);
    const bb = res.metrics!.bbox; // konec dráhy je v (80, 0, 80), profil 10×6 natočený o 180° (obálka B-spline ploch je mírně větší)
    expect(Math.abs(bb[1][0] - 80)).toBeLessThan(1.5);
    expect(Math.abs(bb[1][2] - 85)).toBeLessThan(1.5);
    expect(Math.abs(bb[0][0] + 5)).toBeLessThan(1.5);
  });
  it("měřítko na konci 0,5: komolý kužel", async () => {
    const v = await vol([circle("s", 10), lineXZ("p", [0, 0], [0, 60]), sweep({ scaleEnd: 0.5 })]);
    within(v, (Math.PI * 60 * (100 + 50 + 25)) / 3, 0.01);
  });
  it("měřítko 2× + kroucení 90° zároveň (komolé těleso), i s otvorem", async () => {
    const v = await vol([rect("s", 20, 10), lineXZ("p", [0, 0], [0, 100]), sweep({ scaleEnd: 2, twist: 90 })]);
    within(v, (100 / 3) * (200 + 800 + 400), 0.015);
    const hollow = await vol([sketch("s", XY(), [{ id: "r", type: "rect", cx: 0, cy: 0, w: 20, h: 20, r: 0, angle: 0 }, { id: "c", type: "circle", cx: 0, cy: 0, r: 5 }]), lineXZ("p", [0, 0], [0, 100]), sweep({ twist: 45 })]);
    within(hollow, (400 - A5) * 100, 0.01);
  });
  it("pevná orientace profilu (keepNormal): šikmý válec = A·výška; lomená dráha = A·(50 + 50·cos 45°)", async () => {
    const v = await vol([circle("s", 5), lineXZ("p", [0, 0], [50, 100]), sweep({ keepNormal: true })]);
    within(v, A5 * 100, 0.01);
    const bent = sketch("p", XZ, [{ id: "l1", type: "line", a: [0, 0], b: [0, 50] }, { id: "l2", type: "line", a: [0, 50], b: [50 * Math.SQRT1_2, 50 + 50 * Math.SQRT1_2] }]);
    const fixed = await vol([circle("s", 5), bent, sweep({ keepNormal: true })]);
    within(fixed, A5 * (50 + 50 * Math.SQRT1_2), 0.01);
    const rotating = await vol([circle("s", 5), bent, sweep()]);
    within(rotating, A5 * 100, 0.01);
    // pevná orientace + kroucení (řezy): objem šikmého válce zůstává
    within(await vol([rect("s", 20, 10), lineXZ("p", [0, 0], [50, 100]), sweep({ keepNormal: true, twist: 90 })]), 200 * 100, 0.01);
  });
  it("tažení je nástrojový prvek – lineární pole zdvojnásobí objem", async () => {
    const v = await vol([circle("s", 5), lineXZ("p", [0, 0], [0, 100]), sweep({ twist: 30 }), { id: "pat", name: "Pole", type: "pattern", kind: "linear", featureId: "sw", count: 2, spacing: 50, direction: [1, 0, 0] }]);
    within(v, 2 * A5 * 100, 0.01);
  });
});

describe("tažení – chybové hlášky", () => {
  it("chybějící profil, stejná skica, neplatné hodnoty", async () => {
    expect(await err([lineXZ("p", [0, 0], [0, 100]), sweep({ profileId: "" })])).toMatch(/Chybí skica profilu/);
    expect(await err([circle("s", 5), sweep({ pathId: "" })])).toMatch(/Chybí skica dráhy/);
    expect(await err([circle("s", 5), sweep({ pathId: "s" })])).toMatch(/dvě různé skici/);
    expect(await err([lineXZ("p", [0, 0], [0, 100]), sweep({ profileId: "", circleRadius: 0 })])).toMatch(/kladný/);
    expect(await err([lineXZ("p", [0, 0], [0, 100]), sweep({ profileId: "", circleRadius: 5, thin: { side: "in", t1: 6 } })])).toMatch(/větší než poloměr/);
    expect(await err([circle("s", 5), lineXZ("p", [0, 0], [0, 100]), sweep({ scaleEnd: 0 })])).toMatch(/kladné/);
    expect(await err([circle("s", 5), lineXZ("p", [0, 0], [0, 100]), sweep({ guideId: "p" })])).toMatch(/jiná skica než dráha/);
    expect(await err([lineXZ("s", [0, 0], [0, 10]), lineXZ("p", [0, 0], [0, 100]), sweep()])).toMatch(/uzavřený profil/);
  });
});

describe("šablonování – základ", () => {
  it("zachované chování: čtverec 40 → čtverec 20 (komolý jehlan), otvory při stejném počtu", async () => {
    const v = await vol([rect("a", 40, 40), rect("b", 20, 20, XY(50)), loft()]);
    expect(v).toBeCloseTo((50 / 3) * (1600 + 400 + 800), 0);
    const hollow = await vol([
      sketch("a", XY(), [{ id: "r", type: "rect", cx: 0, cy: 0, w: 40, h: 40, r: 0, angle: 0 }, { id: "c", type: "circle", cx: 0, cy: 0, r: 5 }]),
      sketch("b", XY(50), [{ id: "r", type: "rect", cx: 0, cy: 0, w: 20, h: 20, r: 0, angle: 0 }, { id: "c", type: "circle", cx: 0, cy: 0, r: 5 }]),
      loft(),
    ]);
    expect(hollow).toBeCloseTo((50 / 3) * (1600 + 400 + 800) - A5 * 50, 0);
  });
  it("šablonování do bodu: kužel πr²h/3 (konec i začátek), dvojkužel", async () => {
    const cone = await vol([circle("a", 10), loft({ sketchIds: ["a"], endPoint: { kind: "xyz", p: [0, 0, 30] } })]);
    expect(cone).toBeCloseTo((Math.PI * 100 * 30) / 3, 0);
    const cone2 = await vol([circle("a", 10), loft({ sketchIds: ["a"], startPoint: { kind: "xyz", p: [0, 0, -30] } })]);
    expect(cone2).toBeCloseTo((Math.PI * 100 * 30) / 3, 0);
    const both = await vol([circle("a", 10), loft({ sketchIds: ["a"], startPoint: { kind: "xyz", p: [0, 0, -30] }, endPoint: { kind: "xyz", p: [0, 0, 30] } })]);
    expect(both).toBeCloseTo((2 * Math.PI * 100 * 30) / 3, 0);
    const pyramid = await vol([rect("a", 40, 40), rect("b", 20, 20, XY(50)), loft({ endPoint: { kind: "xyz", p: [0, 0, 100] } })]);
    expect(pyramid).toBeCloseTo((50 / 3) * (1600 + 400 + 800) + (400 * 50) / 3, 0);
  });
  it("bod z odkazu na těleso (vrchol kvádru) – asociativní šablonování do bodu", async () => {
    const base: Feature[] = [{ id: "bx", name: "Kvádr", type: "box", size: [20, 20, 10], position: [-10, -10, 40], centered: false, mode: "new" }];
    const { body } = await build(base);
    const v = await vol([...base, circle("a", 10), loft({ sketchIds: ["a"], endPoint: { kind: "xyz", p: [0, 0, 40] }, mode: "add" })]);
    expect(body).toBeTruthy();
    expect(v).toBeCloseTo(20 * 20 * 10 + (Math.PI * 100 * 40) / 3, 0);
  });
  it("tenká stěna: dvě kružnice → trubka", async () => {
    const v = await vol([circle("a", 10), circle("b", 10, XY(50)), loft({ thin: { side: "in", t1: 2 } })]);
    expect(v).toBeCloseTo(Math.PI * (100 - 64) * 50, 0);
    // otevřený profil (lomená čára) s tenkou stěnou na střed: pásek šířky 2 s půlkruhovými konci
    const poly: Extract<Feature, { type: "sketch" }>["entities"] = [{ id: "l", type: "polyline", closed: false, points: [[-10, 0], [0, 0], [10, 5]] }];
    const open = await vol([sketch("a", XZ, poly), sketch("b", { kind: "base", name: "XZ", offset: -40 }, poly), loft({ thin: { side: "mid", t1: 2 } })]);
    expect(open).toBeCloseTo(((10 + Math.hypot(10, 5)) * 2 + Math.PI) * 40, 0);
  });
});

/** Čtvercové profily 10×10 kolmo na kružnici o poloměru R (uzavřený prstenec). */
const ringSquares = (n: number, R = 40): Feature[] =>
  Array.from({ length: n }, (_, k) => {
    const a = (2 * Math.PI * k) / n;
    const origin: Vec3 = [R * Math.cos(a), R * Math.sin(a), 0];
    const normal: Vec3 = [-Math.sin(a), Math.cos(a), 0];
    const xDir: Vec3 = [Math.cos(a), Math.sin(a), 0];
    return rect(`q${k}`, 10, 10, { kind: "custom", origin, normal, xDir });
  });

describe("šablonování – uzavřené, okrajové podmínky, křivky", () => {
  it("uzavřené šablonování 12 čtverců po kružnici: prstenec bez čel (Pappus ±3 %)", async () => {
    const sks = ringSquares(12);
    const ids = sks.map((s) => s.id);
    const { v, bad, body } = await build([...sks, loft({ sketchIds: ids, ruled: false, closed: true })]);
    expect(bad).toEqual([]);
    within(v, 100 * 2 * Math.PI * 40, 0.05); // hladká aproximace kružnice 12 řezy
    expect(body!.faces.filter((f) => f.geomType === "PLANE").length).toBe(0);
    const ruled = await build([...sks, loft({ sketchIds: ids, ruled: true, closed: true })]);
    expect(ruled.bad).toEqual([]);
    expect(ruled.body!.faces.length).toBe(48);
    within(ruled.v, 100 * 12 * 2 * 40 * Math.sin(Math.PI / 12), 0.05); // přímkové plochy mezi natočenými čtverci ≈ 12úhelníkový prstenec
  });
  it("okrajová podmínka kolmo (startLen 10, přímkové): hranol 10 + komolý jehlan 40", async () => {
    const v = await vol([rect("a", 40, 40), rect("b", 20, 20, XY(50)), loft({ startCond: "normal", startLen: 10 })]);
    expect(v).toBeCloseTo(1600 * 10 + (40 / 3) * (1600 + 400 + 800), 0);
    const both = await vol([rect("a", 40, 40), rect("b", 20, 20, XY(50)), loft({ startCond: "normal", startLen: 10, endCond: "normal", endLen: 5 })]);
    expect(both).toBeCloseTo(1600 * 10 + (35 / 3) * (1600 + 400 + 800) + 400 * 5, 0);
    const def = await vol([rect("a", 40, 40), rect("b", 20, 20, XY(50)), loft({ startCond: "normal" })]); // výchozí 10 % vzdálenosti = 5 mm
    expect(def).toBeCloseTo(1600 * 5 + (45 / 3) * (1600 + 400 + 800), 0);
  });
  it("okrajová podmínka směr (vektor 1;0;1): šikmý hranol + komolý jehlan", async () => {
    const v = await vol([rect("a", 40, 40), rect("b", 20, 20, XY(50)), loft({ startCond: "direction", startDir: { kind: "vector", v: [1, 0, 1] }, startLen: 10 })]);
    const h = 10 * Math.SQRT1_2;
    expect(v).toBeCloseTo(1600 * h + ((50 - h) / 3) * (1600 + 400 + 800), 0);
  });
  it("osová křivka (přímka): dvě kružnice → komolý kužel přes MakePipeShell", async () => {
    const v = await vol([circle("a", 5), circle("b", 10, XY(100)), lineXZ("c", [0, 0], [0, 100]), loft({ centerlineId: "c" })]);
    within(v, (Math.PI * 100 * (25 + 50 + 100)) / 3, 0.02);
  });
  it("osová křivka (oblouk): profily kolmo na konce oblouku", async () => {
    // čtvrtkružnice R=50 v rovině XZ od (0,0) nahoru a doprava do (50,50); start tečna +Z, konec tečna +X
    const arc = sketch("c", XZ, [{ id: "a", type: "arc", a: [0, 0], b: [50 - 50 * Math.SQRT1_2, 50 * Math.SQRT1_2], c: [50, 50] }]);
    const end = circle("b", 5, { kind: "custom", origin: [50, 0, 50], normal: [1, 0, 0], xDir: [0, 1, 0] });
    const v = await vol([circle("a", 5), end, arc, loft({ centerlineId: "c" })]);
    within(v, A5 * (Math.PI / 2) * 50, 0.03);
  });
  it("vodicí křivka bez osové křivky: rovnoběžná přímka nemění komolý kužel", async () => {
    const v = await vol([circle("a", 5), circle("b", 10, XY(100)), lineXZ("g", [30, 0], [30, 100]), loft({ guideIds: ["g"] })]);
    within(v, (Math.PI * 100 * (25 + 50 + 100)) / 3, 0.02);
  });
  it("šablonování je nástrojový prvek (pole) a funguje v režimu Odebrat", async () => {
    const v = await vol([rect("a", 10, 10), rect("b", 10, 10, XY(20)), loft(), { id: "pat", name: "Pole", type: "pattern", kind: "linear", featureId: "lf", count: 3, spacing: 30, direction: [1, 0, 0] }]);
    expect(v).toBeCloseTo(3 * 100 * 20, 0);
    const cut = await vol([{ id: "bx", name: "K", type: "box", size: [60, 60, 20], position: [-30, -30, 0], centered: false, mode: "new" }, circle("a", 10), circle("b", 10, XY(20)), loft({ mode: "cut" })]);
    expect(cut).toBeCloseTo(60 * 60 * 20 - Math.PI * 100 * 20, 0);
  });
});

describe("šablonování – chybové hlášky", () => {
  it("málo profilů, uzavřené se dvěma, kombinace s bodem, chybějící skica", async () => {
    expect(await err([circle("a", 10), loft({ sketchIds: ["a"] })])).toMatch(/alespoň dvě skici/);
    expect(await err([circle("a", 10), circle("b", 10, XY(10)), loft({ closed: true })])).toMatch(/alespoň tři profily/);
    expect(await err([...ringSquares(3), loft({ sketchIds: ["q0", "q1", "q2"], closed: true, endPoint: { kind: "xyz", p: [0, 0, 0] } })])).toMatch(/nelze kombinovat/);
    expect(await err([circle("a", 10), loft({ sketchIds: ["a", ""] })])).toMatch(/Chybí skica 2/);
    expect(await err([circle("a", 10), loft({ sketchIds: ["a", "a"] })])).toMatch(/jiná skica/);
    expect(await err([circle("a", 10), circle("b", 10, XY(10)), loft({ centerlineId: "a" })])).toMatch(/jiná skica než profily/);
    expect(await err([circle("a", 10), circle("b", 10, XY(10)), loft({ endPoint: { kind: "vertex", index: -1 } })])).toMatch(/vyžaduje těleso|Vyberte/);
  });
});


