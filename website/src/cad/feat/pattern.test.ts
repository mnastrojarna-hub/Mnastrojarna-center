import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc } from "../build";
import { emptyDoc, type AxisDef, type CadDoc, type Feature, type Vec3 } from "../types";
import { fillPoints, tangentFaces } from "./pattern";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

type PatternF = Extract<Feature, { type: "pattern" }>;
/** Omit přes sjednocení (každý druh pole zvlášť). */
type Body<T> = T extends unknown ? Omit<T, "id" | "name" | "type"> : never;
const box = (id: string, size: Vec3, position: Vec3, mode: "new" | "add" = "add"): Feature => ({ id, name: id, type: "box", size, position, centered: false, mode });
/** válcová díra (nástroj = válec, odebrat) osou Z */
const hole = (id: string, x: number, y: number, rad = 3, h = 20): Feature => ({ id, name: id, type: "cylinder", radius: rad, height: h, position: [x, y, 0], axis: "Z", mode: "cut" });
const sketch = (id: string, entities: Extract<Feature, { type: "sketch" }>["entities"], z = 20): Feature => ({ id, name: id, type: "sketch", plane: { kind: "base", name: "XY", offset: z }, entities });
const pat = (p: Body<PatternF>): Feature => ({ id: "p", name: "p", type: "pattern", ...p } as Feature);
const doc = (features: Feature[]): CadDoc => ({ ...emptyDoc("t"), features });
const build = async (d: CadDoc) => {
  const res = await buildDoc(d);
  const bad = res.status.filter((s) => !s.ok);
  if (bad.length) throw new Error(bad.map((b) => b.error).join("; "));
  return res;
};
const vol = async (d: CadDoc) => (await build(d)).metrics!.volume;
const err = async (d: CadDoc) => (await buildDoc(d)).status.find((s) => !s.ok)?.error ?? "";
const H = (rad = 3, h = 20) => Math.PI * rad * rad * h; // objem díry
const BASE = [box("A", [60, 40, 20], [0, 0, 0], "new")];
const V0 = 60 * 40 * 20;

describe("pole – lineární", () => {
  it("směr odkazem (osa X) + vynechaný kus", async () => {
    const v = await vol(doc([...BASE, hole("h", 10, 10), pat({ featureId: "h", kind: "linear", count: 4, spacing: 10, direction: [0, 0, 0], dirDef: { kind: "axis", axis: "X" }, skip: [2] })]));
    expect(v).toBeCloseTo(V0 - 3 * H(), 0);
  });
  it("směr dvěma body (xyz) a celková délka místo kroku", async () => {
    // 3 kusy na celkové délce 40 → krok 20: x = 10, 30, 50
    const d = doc([...BASE, hole("h", 10, 10), pat({ featureId: "h", kind: "linear", count: 3, spacing: 40, spacingMode: "total", direction: [1, 0, 0], dirDef: { kind: "twoPoints", a: { kind: "xyz", p: [0, 0, 0] }, b: { kind: "xyz", p: [5, 0, 0] } } })]);
    const res = await build(d);
    expect(res.metrics!.volume).toBeCloseTo(V0 - 3 * H(), 0);
    // díra na x = 50 existuje → válcová plocha se středem x = 50
    expect(res.body!.faces.some((f) => f.geomType === "CYLINDRE" && Math.abs(f.center.x - 50) < 1e-6)).toBe(true);
  });
  it("mřížka se střídavými řadami – posunutá řada vyjede z tělesa (poloviční díra)", async () => {
    // kvádr 30 široký: řada 1 x = 5,15,25; střídavá řada 2 x = 10,20,30 (poslední půlená hranou)
    const base = [box("A", [30, 40, 20], [0, 0, 0], "new")];
    const plain = await vol(doc([...base, hole("h", 5, 10, 2), pat({ featureId: "h", kind: "linear", count: 3, spacing: 10, direction: [1, 0, 0], count2: 2, spacing2: 15, direction2: [0, 1, 0] })]));
    expect(plain).toBeCloseTo(30 * 40 * 20 - 6 * H(2), 0);
    const stag = await vol(doc([...base, hole("h", 5, 10, 2), pat({ featureId: "h", kind: "linear", count: 3, spacing: 10, direction: [1, 0, 0], count2: 2, spacing2: 15, direction2: [0, 1, 0], stagger: true })]));
    expect(stag).toBeCloseTo(30 * 40 * 20 - 5.5 * H(2), 0);
  });
  it("více zdrojových prvků naráz + jen geometrie (jedna booleovská operace)", async () => {
    const feats = [...BASE, hole("h1", 10, 10, 2), hole("h2", 10, 30, 2)];
    const a = await vol(doc([...feats, pat({ featureId: "", featureIds: ["h1", "h2"], kind: "linear", count: 3, spacing: 15, direction: [1, 0, 0] })]));
    expect(a).toBeCloseTo(V0 - 6 * H(2), 0);
    const g = await vol(doc([...feats, pat({ featureId: "h1", featureIds: ["h1", "h2"], kind: "linear", count: 3, spacing: 15, direction: [1, 0, 0], geometryOnly: true })]));
    expect(g).toBeCloseTo(a, 3);
  });
  it("chyby: chybějící zdroj, nulová rozteč, rovnoběžné směry", async () => {
    expect(await err(doc([...BASE, pat({ featureId: "x", kind: "linear", count: 3, spacing: 10, direction: [1, 0, 0] })]))).toMatch(/Vyberte prvek/);
    expect(await err(doc([...BASE, hole("h", 10, 10), pat({ featureId: "h", kind: "linear", count: 3, spacing: 0, direction: [1, 0, 0] })]))).toMatch(/Rozteč/);
    expect(await err(doc([...BASE, hole("h", 10, 10), pat({ featureId: "h", kind: "linear", count: 2, spacing: 10, direction: [1, 0, 0], count2: 2, direction2: [-1, 0, 0] })]))).toMatch(/rovnoběžný/);
  });
});

describe("pole – kruhové", () => {
  const disc = [{ id: "D", name: "D", type: "cylinder", radius: 40, height: 10, position: [0, 0, 0], axis: "Z", mode: "new" } as Feature];
  const VD = Math.PI * 1600 * 10;
  it("osa odkazem (globální Z) – 6 děr rovnoměrně", async () => {
    const v = await vol(doc([...disc, hole("h", 30, 0, 3, 10), pat({ featureId: "h", kind: "circular", count: 6, angle: 360, axis: "X", center: [99, 99, 0], axisDef: { kind: "global", axis: "Z" } })]));
    expect(v).toBeCloseTo(VD - 6 * H(3, 10), 0);
  });
  it("osa dvěma body + krok (angle/(n−1)) + symetricky + vynechání", async () => {
    const ax: AxisDef = { kind: "twoPoints", a: { kind: "xyz", p: [0, 0, 0] }, b: { kind: "xyz", p: [0, 0, 1] } };
    // 3 kusy na 90° → krok 45°: 0°, 45°, 90°
    const step = await vol(doc([...disc, hole("h", 30, 0, 3, 10), pat({ featureId: "h", kind: "circular", count: 3, angle: 90, axis: "Z", center: [0, 0, 0], axisDef: ax, equalSpacing: false })]));
    expect(step).toBeCloseTo(VD - 3 * H(3, 10), 0);
    // rovnoměrně na 90° → krok 30°: 0°, 30°, 60°
    const eq = await build(doc([...disc, hole("h", 30, 0, 3, 10), pat({ featureId: "h", kind: "circular", count: 3, angle: 90, axis: "Z", center: [0, 0, 0], axisDef: ax, equalSpacing: true })]));
    expect(eq.metrics!.volume).toBeCloseTo(VD - 3 * H(3, 10), 0);
    expect(eq.body!.faces.some((f) => f.geomType === "CYLINDRE" && Math.abs(f.center.x - 30 * Math.cos(Math.PI / 3)) < 1e-4 && Math.abs(f.center.y - 30 * Math.sin(Math.PI / 3)) < 1e-4)).toBe(true);
    // symetricky: ±45°, ±90° → 5 děr; vynechat index 1 (+45°) → 4
    const sym = await vol(doc([...disc, hole("h", 30, 0, 3, 10), pat({ featureId: "h", kind: "circular", count: 3, angle: 90, axis: "Z", center: [0, 0, 0], axisDef: ax, equalSpacing: false, symmetric: true })]));
    expect(sym).toBeCloseTo(VD - 5 * H(3, 10), 0);
    const skip = await vol(doc([...disc, hole("h", 30, 0, 3, 10), pat({ featureId: "h", kind: "circular", count: 3, angle: 90, axis: "Z", center: [0, 0, 0], axisDef: ax, equalSpacing: false, symmetric: true, skip: [1] })]));
    expect(skip).toBeCloseTo(VD - 4 * H(3, 10), 0);
  });
  it("bez natáčení kopií (radial = false) – kvádr zůstane rovnoběžný s osami", async () => {
    const tool = box("T", [10, 4, 5], [40, -2, 10]); // na kotouči, střed (45, 0, 12.5)
    // krok = 180° (2 kusy, krok = úhel/(n−1)): kopie posunutá na (−45, 0) bez otočení → stěna x = −50 zůstane rovinná a rovnoběžná s YZ
    const res = await build(doc([...disc, tool, pat({ featureId: "T", kind: "circular", count: 2, angle: 180, axis: "Z", center: [0, 0, 0], equalSpacing: false, radial: false })]));
    expect(res.body!.faces.some((f) => f.geomType === "PLANE" && Math.abs(f.center.x + 50) < 1e-6 && Math.abs(f.center.z - 12.5) < 1e-6)).toBe(true);
    expect(res.metrics!.volume).toBeCloseTo(VD + 2 * 10 * 4 * 5, 0);
  });
});

describe("pole – po křivce", () => {
  it("úsečka, pevné natočení – kusy rovnoměrně po délce", async () => {
    const d = doc([...BASE, sketch("s", [{ id: "l", type: "line", a: [10, 10], b: [50, 10] }]), hole("h", 10, 10), pat({ featureId: "h", kind: "curve", count: 5, sketchId: "s", align: "fixed" })]);
    const res = await build(d);
    expect(res.metrics!.volume).toBeCloseTo(V0 - 5 * H(), 0);
    expect(res.body!.faces.some((f) => f.geomType === "CYLINDRE" && Math.abs(f.center.x - 50) < 1e-6)).toBe(true);
  });
  it("rozteč místo rovnoměrného dělení + chyba, když se pole nevejde", async () => {
    const sk = sketch("s", [{ id: "l", type: "line", a: [10, 10], b: [50, 10] }]);
    const res = await build(doc([...BASE, sk, hole("h", 10, 10), pat({ featureId: "h", kind: "curve", count: 3, sketchId: "s", align: "fixed", spacing: 20 })]));
    expect(res.metrics!.volume).toBeCloseTo(V0 - 3 * H(), 0);
    expect(res.body!.faces.some((f) => f.geomType === "CYLINDRE" && Math.abs(f.center.x - 30) < 1e-6)).toBe(true);
    expect(await err(doc([...BASE, sk, hole("h", 10, 10), pat({ featureId: "h", kind: "curve", count: 4, sketchId: "s", align: "fixed", spacing: 20 })]))).toMatch(/nevejde/);
  });
  it("lomená čára, tečné natočení otočí kopii za rohem", async () => {
    // dráha (10,10)→(40,10)→(40,45), délka 65; 3 kusy: s = 0, 32.5, 65 → poslední v (40,45) s tečnou +Y
    const sk = sketch("s", [{ id: "pl", type: "polyline", points: [[10, 10], [40, 10], [40, 45]], closed: false }]);
    const tool = box("T", [10, 2, 5], [5, 9, 20]); // střed (10, 10, 22.5)
    const fixed = await build(doc([...BASE, sk, tool, pat({ featureId: "T", kind: "curve", count: 3, sketchId: "s", align: "fixed" })]));
    expect(fixed.metrics!.bbox[1][1]).toBeCloseTo(46, 5);
    const tan = await build(doc([...BASE, sk, tool, pat({ featureId: "T", kind: "curve", count: 3, sketchId: "s", align: "tangent" })]));
    expect(tan.metrics!.bbox[1][1]).toBeCloseTo(50, 5);
    expect(tan.metrics!.volume).toBeCloseTo(V0 + 3 * 100, 0);
  });
  it("uzavřená křivka (kružnice) – kusy po celém obvodu", async () => {
    const sk = sketch("s", [{ id: "c", type: "circle", cx: 30, cy: 20, r: 15 }]);
    const v = await vol(doc([...BASE, sk, hole("h", 45, 20, 2), pat({ featureId: "h", kind: "curve", count: 4, sketchId: "s", align: "fixed" })]));
    expect(v).toBeCloseTo(V0 - 4 * H(2), 0);
  });
});

describe("pole – podle skici a výplňové", () => {
  it("body skici: kopie v každém bodě, bod v místě zdroje se nepočítá", async () => {
    const sk = sketch("s", [{ id: "p1", type: "point", p: [10, 10] }, { id: "p2", type: "point", p: [30, 10] }, { id: "p3", type: "point", p: [50, 30] }]);
    const v = await vol(doc([...BASE, sk, hole("h", 10, 10), pat({ featureId: "h", kind: "sketch", sketchId: "s" })]));
    expect(v).toBeCloseTo(V0 - 3 * H(), 0);
    const skipped = await vol(doc([...BASE, sk, hole("h", 10, 10), pat({ featureId: "h", kind: "sketch", sketchId: "s", skip: [2] })]));
    expect(skipped).toBeCloseTo(V0 - 2 * H(), 0);
    expect(await err(doc([...BASE, sketch("e", [{ id: "l", type: "line", a: [0, 0], b: [1, 1] }]), hole("h", 10, 10), pat({ featureId: "h", kind: "sketch", sketchId: "e" })]))).toMatch(/žádné body/);
  });
  it("výplň obdélníku mřížkou s okrajem", async () => {
    // obrys x 10..50, y 10..30; rozteč 8 od zdroje (30,20), okraj 1 → x 14..46 (5) × y 12..28 (3) = 15 kusů
    const sk = sketch("s", [{ id: "r", type: "rect", cx: 30, cy: 20, w: 40, h: 20, r: 0, angle: 0 }]);
    const v = await vol(doc([...BASE, sk, hole("h", 30, 20, 2), pat({ featureId: "h", kind: "fill", sketchId: "s", spacing: 8, margin: 1, layout: "grid" })]));
    expect(v).toBeCloseTo(V0 - 15 * H(2), 0);
    expect(await err(doc([...BASE, sk, hole("h", 30, 20, 2), pat({ featureId: "h", kind: "fill", sketchId: "s", spacing: 1, margin: 0.5, layout: "grid" })]))).toMatch(/příliš mnoho/);
  });
  it("rozložení bodů výplně (2D): střídavě a kruhově", () => {
    const rect: [number, number][] = [[0, 0], [40, 0], [40, 40], [0, 40]];
    const grid = fillPoints([rect], [], [20, 20], 10, 0.5, "grid");
    expect(grid.length).toBe(9); // 10,20,30 × 10,20,30
    // střídavě: řady po 8,66 (y = 2,68 … 37,32), sudé řady x = 10,20,30 (3), liché posunuté o 5 → x = 5…35 (4): 3·3 + 2·4
    const stag = fillPoints([rect], [], [20, 20], 10, 0.5, "stagger");
    expect(stag.length).toBe(17);
    expect(stag.every((p) => p[0] >= 0.5 && p[0] <= 39.5 && p[1] >= 0.5 && p[1] <= 39.5)).toBe(true);
    // kruhově: střed + prstenec r10 (6 bodů) + prstenec r20 (13 bodů, z nich 3 příliš blízko hraně) = 17
    const circ = fillPoints([rect], [], [20, 20], 10, 0.5, "circular");
    expect(circ.length).toBe(17);
    expect(circ.every((p) => p[0] >= 0.5 && p[0] <= 39.5 && p[1] >= 0.5 && p[1] <= 39.5)).toBe(true);
  });
});

describe("skořepina", () => {
  const topIdx = async () => {
    const res = await build(doc(BASE));
    return res.body!.faces.findIndex((f) => f.geomType === "PLANE" && Math.abs(f.center.z - 20) < 1e-6);
  };
  const bottomIdx = async () => {
    const res = await build(doc(BASE));
    return res.body!.faces.findIndex((f) => f.geomType === "PLANE" && Math.abs(f.center.z) < 1e-6);
  };
  it("dovnitř (jako dosud) a ven – stěna přiroste vně původního povrchu", async () => {
    const top = await topIdx();
    const inner = await build(doc([...BASE, { id: "sh", name: "sh", type: "shell", thickness: 2, faces: [top] }]));
    expect(inner.metrics!.volume).toBeCloseTo(V0 - 56 * 36 * 18, 0);
    expect(inner.metrics!.bbox[0][0]).toBeCloseTo(0, 5);
    const outer = await build(doc([...BASE, { id: "sh", name: "sh", type: "shell", thickness: 2, faces: [top], outward: true }]));
    expect(outer.metrics!.volume).toBeCloseTo(64 * 44 * 22 - V0, 0);
    expect(outer.metrics!.bbox[0][0]).toBeCloseTo(-2, 5);
    expect(outer.metrics!.bbox[1][2]).toBeCloseTo(20, 5); // otevřená plocha zůstává v původní výšce
  });
  it("jiná tloušťka vybrané plochy (dno 5 mm při stěně 2 mm)", async () => {
    const top = await topIdx();
    const bottom = await bottomIdx();
    const v = await vol(doc([...BASE, { id: "sh", name: "sh", type: "shell", thickness: 2, faces: [top], thicknesses: { [bottom]: 5 } }]));
    expect(v).toBeCloseTo(V0 - 56 * 36 * 15, 0);
  });
});

describe("úkos", () => {
  const sideFaces = async (feats: Feature[], xs: number[]) => {
    const res = await build(doc(feats));
    return xs.map((x) => res.body!.faces.findIndex((f) => f.geomType === "PLANE" && Math.abs(f.center.x - x) < 1e-6 && Math.abs(f.center.z - 10) < 1e-6));
  };
  it("směr tahu bez neutrální roviny – rovina středem tělesa kolmo na tah", async () => {
    const res0 = await build(doc(BASE));
    const sides = res0.body!.faces.map((f, i) => ({ f, i })).filter(({ f }) => f.geomType === "PLANE" && Math.abs(f.center.z - 10) < 1e-6).map(({ i }) => i);
    expect(sides.length).toBe(4);
    const a = 5;
    const t = Math.tan((a * Math.PI) / 180);
    const res = await build(doc([...BASE, { id: "d", name: "d", type: "draft", angle: a, faces: sides, plane: "XY", offset: 0, pull: { kind: "axis", axis: "Z" } }]));
    expect(res.metrics!.volume).toBeCloseTo(V0 + (8000 / 3) * t * t, 0);
    const [lo, hi] = res.metrics!.bbox;
    expect(hi[0] - lo[0]).toBeCloseTo(60 + 20 * t, 3);
    expect(hi[1] - lo[1]).toBeCloseTo(40 + 20 * t, 3);
  });
  it("tečné řetězení – přes zaoblený roh se zkosí i sousední stěna", async () => {
    // zaoblit svislou hranu v rohu (60, 40)
    const res0 = await build(doc(BASE));
    const edge = res0.body!.edges.findIndex((e) => Math.abs(e.pointAt(0.5).x - 60) < 1e-6 && Math.abs(e.pointAt(0.5).y - 40) < 1e-6);
    expect(edge).toBeGreaterThanOrEqual(0);
    const base = [...BASE, { id: "f", name: "f", type: "fillet", radius: 5, edges: [edge] } as Feature];
    const [px] = await sideFaces(base, [60]);
    expect(px).toBeGreaterThanOrEqual(0);
    const t = Math.tan((5 * Math.PI) / 180);
    // výběr se rozšíří o zaoblení a stěnu y = 40 (3 plochy), protější stěny ne
    const body = (await build(doc(base))).body!;
    const chainIdx = tangentFaces(body, [px]);
    expect(chainIdx.length).toBe(3);
    expect(chainIdx.some((i) => body.faces[i].geomType === "CYLINDRE")).toBe(true);
    expect(chainIdx.some((i) => body.faces[i].geomType === "PLANE" && Math.abs(body.faces[i].center.y - 40) < 1e-6)).toBe(true);
    const chain = await build(doc([...base, { id: "d", name: "d", type: "draft", angle: 5, faces: [px], plane: "XY", offset: 10, tangentChain: true }]));
    expect(chain.metrics!.bbox[1][0]).toBeCloseTo(60 + 10 * t, 3);
    expect(chain.metrics!.bbox[1][1]).toBeCloseTo(40 + 10 * t, 3);
    expect(chain.metrics!.bbox[0][1]).toBeCloseTo(0, 4); // stěna y = 0 beze změny
  });
  it("chyby: bez ploch, úhel mimo rozsah", async () => {
    expect(await err(doc([...BASE, { id: "d", name: "d", type: "draft", angle: 5, faces: [], plane: "XY", offset: 0 }]))).toMatch(/Vyberte plochy/);
    expect(await err(doc([...BASE, { id: "d", name: "d", type: "draft", angle: 60, faces: [0], plane: "XY", offset: 0 }]))).toMatch(/0 a 45/);
  });
});
