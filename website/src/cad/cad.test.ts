import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc, buildShape, chainSegs, faceInfo, registerTextFont } from "./build";
import { makeDrawing, pathToPolylines } from "./drawing";
import { findLoops, nestLoops, sketchToDxf } from "./sketch";
import { emptyDoc, type CadDoc, type Feature } from "./types";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
  const font = readFileSync(path.resolve(__dirname, "../../public/fonts/Roboto-Bold.ttf"));
  await registerTextFont(font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength) as ArrayBuffer);
}, 60_000);

const doc = (features: Feature[]): CadDoc => ({ ...emptyDoc("Test"), features });
const plate: Feature[] = [
  {
    id: "s1",
    name: "Skica",
    type: "sketch",
    plane: { kind: "base", name: "XY", offset: 0 },
    entities: [
      { id: "e1", type: "rect", cx: 0, cy: 0, w: 80, h: 50, r: 0, angle: 0 },
      { id: "e2", type: "circle", cx: 0, cy: 0, r: 10 },
    ],
  },
  { id: "x1", name: "Vysunutí", type: "extrude", sketchId: "s1", distance: 20, symmetric: false, reverse: false, mode: "new" },
];

describe("skica (2D)", () => {
  it("najde profily a otvory", () => {
    const { loops } = findLoops((plate[0] as Extract<Feature, { type: "sketch" }>).entities);
    const n = nestLoops(loops);
    expect(n.map((x) => x.depth).sort()).toEqual([0, 1]);
  });
  it("poskládá smyčku z úseček a oblouku", () => {
    const { loops, openCount } = findLoops([
      { id: "a", type: "line", a: [0, 0], b: [40, 0] },
      { id: "b", type: "line", a: [40, 0], b: [40, 20] },
      { id: "c", type: "arc", a: [40, 20], b: [20, 30], c: [0, 20] },
      { id: "d", type: "line", a: [0, 0], b: [0, 20] }, // opačná orientace
    ]);
    expect(loops).toHaveLength(1);
    expect(openCount).toBe(0);
  });
  it("exportuje DXF", () => {
    const dxf = sketchToDxf([{ id: "c", type: "circle", cx: 0, cy: 0, r: 5 }, { id: "l", type: "line", a: [0, 0], b: [10, 0] }]);
    expect(dxf).toContain("CIRCLE");
    expect(dxf.trim().endsWith("EOF")).toBe(true);
  });
});

describe("modelování (OpenCascade)", () => {
  it("vysunutí desky s otvorem", async () => {
    const res = await buildDoc(doc(plate));
    expect(res.status.every((s) => s.ok)).toBe(true);
    expect(res.metrics!.volume).toBeCloseTo((80 * 50 - Math.PI * 100) * 20, 0);
    expect(res.mesh!.triangles.length).toBeGreaterThan(0);
    expect(res.mesh!.edgeGroups.length / 3).toBe(res.metrics!.edges);
  });

  it("díra skrz + kruhové pole + zaoblení + zrcadlení", async () => {
    const res = await buildDoc(
      doc([
        ...plate,
        { id: "h", name: "Díra", type: "hole", position: [30, 15, 20], axis: "Z", flip: false, diameter: 6, depth: 0, cbDiameter: 0, cbDepth: 0 },
        { id: "p", name: "Pole", type: "pattern", featureId: "h", kind: "linear", count: 3, spacing: 14, direction: [0, -1, 0] },
        { id: "f", name: "Zaoblení", type: "fillet", radius: 2, edges: "all" },
        { id: "m", name: "Zrcadlení", type: "mirror", plane: "XY", offset: 0, keepOriginal: true },
      ]),
    );
    expect(res.status.map((s) => s.ok)).toEqual([true, true, true, true, true, true]);
    expect(res.metrics!.bbox[0][2]).toBeCloseTo(-20, 3);
  });

  it("rotace profilu, primitiva a odebrání", async () => {
    const res = await buildDoc(
      doc([
        { id: "s", name: "Profil", type: "sketch", plane: { kind: "base", name: "XZ", offset: 0 }, entities: [{ id: "r", type: "rect", cx: 15, cy: 20, w: 10, h: 40, r: 0, angle: 0 }] },
        { id: "rv", name: "Rotace", type: "revolve", sketchId: "s", angle: 360, axis: "y", mode: "new" },
        { id: "c", name: "Válec", type: "cylinder", radius: 5, height: 100, position: [0, 0, -10], axis: "Z", mode: "add" },
        { id: "b", name: "Kvádr", type: "box", size: [100, 4, 100], position: [0, 0, 20], centered: true, mode: "cut" },
        { id: "k", name: "Kužel", type: "cone", radius1: 10, radius2: 0, height: 10, position: [0, 0, 90], axis: "Z", mode: "add" },
        { id: "t", name: "Trubka", type: "tube", outer: 20, inner: 12, height: 5, position: [0, 0, -15], axis: "Z", mode: "add" },
      ]),
    );
    expect(res.status.filter((s) => !s.ok)).toEqual([]);
    expect(res.metrics!.volume).toBeGreaterThan(0);
  });

  it("chybný prvek nezastaví model a vrátí srozumitelnou chybu", async () => {
    const res = await buildDoc(doc([...plate, { id: "f", name: "Zaoblení", type: "fillet", radius: 500, edges: "all" }]));
    expect(res.status[2].ok).toBe(false);
    expect(res.status[2].error).toBeTruthy();
    expect(res.metrics!.volume).toBeGreaterThan(0);
  });

  it("skořepina vybrané plochy a skica na ploše", async () => {
    const { body } = await buildShape(doc(plate));
    const topIdx = body!.faces.findIndex((f) => f.geomType === "PLANE" && Math.abs(f.center.z - 20) < 1e-6);
    const info = faceInfo(body!, topIdx)!;
    expect(info.normal[2]).toBeCloseTo(1);
    const res = await buildDoc(
      doc([
        ...plate,
        { id: "s2", name: "Skica 2", type: "sketch", plane: { kind: "custom", origin: info.origin, normal: info.normal, xDir: info.xDir }, entities: [{ id: "c", type: "circle", cx: 30, cy: 0, r: 5 }] },
        { id: "x2", name: "Vysunutí 2", type: "extrude", sketchId: "s2", distance: 10, symmetric: false, reverse: false, mode: "add" },
        { id: "sh", name: "Skořepina", type: "shell", thickness: 2, faces: [0] },
      ]),
    );
    expect(res.status.slice(0, 4).every((s) => s.ok)).toBe(true);
    expect(res.metrics!.bbox[1][2]).toBeCloseTo(30, 3);
  });

  it("STEP export → import jako prvek", async () => {
    const { body } = await buildShape(doc(plate));
    const bytes = new Uint8Array(await body!.blobSTEP().arrayBuffer());
    const res = await buildDoc(doc([{ id: "i", name: "Import", type: "import", fileName: "a.step", format: "step", data: Buffer.from(bytes).toString("base64") }]));
    expect(res.metrics!.volume).toBeCloseTo((80 * 50 - Math.PI * 100) * 20, 0);
  });

  it("výkres: SVG + DXF se 3 pohledy a razítkem", async () => {
    const { body } = await buildShape(doc(plate));
    const d = makeDrawing(body!, { name: "Deska", material: "Ocel S235", massKg: 0.5 });
    expect(d.svg).toContain("Mnástrojárna");
    expect(d.svg).toContain("80");
    expect(d.dxf).toContain("OBRYS");
    expect(JSON.stringify(d.sheet)).toContain("A4");
  });

  it("parser SVG path zvládne oblouky", () => {
    const p = pathToPolylines("M 0 0 A 10 10 0 0 1 20 0 L 20 5 Z");
    expect(p[0].length).toBeGreaterThan(5);
  });
});

describe("ukázkové modely", () => {
  it("všechny ukázky se postaví bez chyb", async () => {
    const { EXAMPLES } = await import("./defaults");
    for (const ex of EXAMPLES) {
      const res = await buildDoc(ex.make());
      expect(res.status.filter((s) => !s.ok), ex.label).toEqual([]);
      expect(res.metrics!.volume, ex.label).toBeGreaterThan(0);
    }
  }, 60_000);
});

const box = (id = "b", size: [number, number, number] = [100, 60, 40]): Feature => ({ id, name: "Kvádr", type: "box", size, position: [0, 0, 0], centered: false, mode: "new" });
const vol = async (features: Feature[], extra: Partial<CadDoc> = {}) => {
  const res = await buildDoc({ ...doc(features), ...extra });
  return { res, v: res.metrics?.volume ?? 0, bad: res.status.filter((s) => !s.ok) };
};

describe("nové prvky", () => {
  it("tažení kruhu po křivce (úsečka + oblouk + úsečka)", async () => {
    const { v, bad } = await vol([
      { id: "p", name: "Dráha", type: "sketch", plane: { kind: "base", name: "XZ", offset: 0 }, entities: [
        { id: "l1", type: "line", a: [0, 0], b: [0, 50] },
        { id: "a1", type: "arc", a: [0, 50], b: [8.7868, 71.2132], c: [30, 80] },
        { id: "l2", type: "line", a: [80, 80], b: [30, 80] }, // opačná orientace
      ] },
      { id: "s", name: "Průřez", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [{ id: "c", type: "circle", cx: 0, cy: 0, r: 5 }] },
      { id: "sw", name: "Tažení", type: "sweep", profileId: "s", pathId: "p", mode: "new", frenet: true },
    ]);
    expect(bad).toEqual([]);
    const len = 50 + (Math.PI / 2) * 30 + 50;
    expect(v).toBeCloseTo(Math.PI * 25 * len, -1);
  });

  it("tažení profilu s otvorem (trubka)", async () => {
    const { v, bad } = await vol([
      { id: "p", name: "Dráha", type: "sketch", plane: { kind: "base", name: "XZ", offset: 0 }, entities: [{ id: "l", type: "polyline", closed: false, points: [[0, 0], [0, 100]] }] },
      { id: "s", name: "Průřez", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [{ id: "c", type: "circle", cx: 0, cy: 0, r: 10 }, { id: "c2", type: "circle", cx: 0, cy: 0, r: 6 }] },
      { id: "sw", name: "Tažení", type: "sweep", profileId: "s", pathId: "p", mode: "new", frenet: false },
    ]);
    expect(bad).toEqual([]);
    expect(v).toBeCloseTo(Math.PI * (100 - 36) * 100, -1);
  });

  it("šablonování čtverec → kruh a s dutinou", async () => {
    const { v, bad } = await vol([
      { id: "a", name: "A", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [{ id: "r", type: "rect", cx: 0, cy: 0, w: 40, h: 40, r: 0, angle: 0 }] },
      { id: "b", name: "B", type: "sketch", plane: { kind: "base", name: "XY", offset: 50 }, entities: [{ id: "c", type: "rect", cx: 0, cy: 0, w: 20, h: 20, r: 0, angle: 0 }] },
      { id: "l", name: "Loft", type: "loft", sketchIds: ["a", "b"], ruled: true, mode: "new" },
    ]);
    expect(bad).toEqual([]);
    // komolý jehlan: h/3 (A1 + A2 + sqrt(A1 A2))
    expect(v).toBeCloseTo((50 / 3) * (1600 + 400 + 800), 0);
    const { EXAMPLES } = await import("./defaults");
    const funnel = await buildDoc(EXAMPLES.find((e) => e.id === "funnel")!.make());
    expect(funnel.status.filter((s) => !s.ok)).toEqual([]);
  }, 30_000);

  it("rozříznutí rovinou a transformace", async () => {
    const half = await vol([box(), { id: "sp", name: "Řez", type: "split", plane: "YZ", offset: 30, keep: "negative" }]);
    expect(half.bad).toEqual([]);
    expect(half.v).toBeCloseTo(30 * 60 * 40, 0);
    const pos = await vol([box(), { id: "sp", name: "Řez", type: "split", plane: "XY", offset: 10, keep: "positive" }]);
    expect(pos.v).toBeCloseTo(100 * 60 * 30, 0);
    const t = await vol([box(), { id: "t", name: "T", type: "transform", translate: [10, 0, 5], rotateAxis: "Z", rotateAngle: 90, scale: 2 }]);
    expect(t.bad).toEqual([]);
    expect(t.v).toBeCloseTo(100 * 60 * 40 * 8, -1);
    expect(t.res.metrics!.bbox[1][2]).toBeCloseTo(85, 3);
    const none = await vol([box(), { id: "sp", name: "Řez", type: "split", plane: "XY", offset: 100, keep: "positive" }]);
    expect(none.bad[0]?.error).toMatch(/nezůstane/);
  });

  it("úkos vybrané plochy a vysunutí s úkosem", async () => {
    const { body } = await buildShape(doc([box()]));
    const side = body!.faces.findIndex((f) => f.geomType === "PLANE" && Math.abs(f.center.x - 100) < 1e-6);
    const d = await vol([box(), { id: "d", name: "Úkos", type: "draft", angle: 5, faces: [side], plane: "XY", offset: 0 }]);
    expect(d.bad).toEqual([]);
    expect(Math.abs(d.v - 100 * 60 * 40)).toBeGreaterThan(1000);
    const ex = await vol([
      { id: "s", name: "S", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [{ id: "r", type: "rect", cx: 0, cy: 0, w: 40, h: 40, r: 0, angle: 0 }] },
      { id: "x", name: "X", type: "extrude", sketchId: "s", distance: 20, symmetric: false, reverse: false, mode: "new", draftAngle: 10 },
    ]);
    expect(ex.bad).toEqual([]);
    const top = 40 - 2 * 20 * Math.tan((10 * Math.PI) / 180);
    expect(ex.v).toBeCloseTo((20 / 3) * (1600 + top * top + 40 * top), 0);
    expect(ex.res.metrics!.bbox[1][2]).toBeCloseTo(20, 3);
    // otvor se s úkosem rozšiřuje (stěna otvoru se odklání stejně jako vnější obrys)
    const holed = await vol([
      { id: "s", name: "S", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [{ id: "r", type: "rect", cx: 0, cy: 0, w: 40, h: 40, r: 0, angle: 0 }, { id: "c", type: "circle", cx: 0, cy: 0, r: 5 }] },
      { id: "x", name: "X", type: "extrude", sketchId: "s", distance: 20, symmetric: false, reverse: false, mode: "new", draftAngle: 10 },
    ]);
    expect(holed.bad).toEqual([]);
    const r2 = 5 + 20 * Math.tan((10 * Math.PI) / 180);
    const hole = ((Math.PI * 20) / 3) * (25 + r2 * r2 + 5 * r2);
    expect(holed.v).toBeCloseTo(ex.v - hole, -1);
  });

  it("díry: závitová, kuželové zahloubení, válcové zahloubení, slepá se špičkou", async () => {
    const H = (id: string, extra: Partial<Extract<Feature, { type: "hole" }>>): Feature => ({ id, name: id, type: "hole", position: [20, 20, 40], axis: "Z", flip: false, diameter: 10, depth: 0, cbDiameter: 0, cbDepth: 0, ...extra });
    const base = 100 * 60 * 40;
    const tapped = await vol([box(), H("t", { kind: "tapped", thread: "M10" })]);
    expect(tapped.bad).toEqual([]);
    expect(base - tapped.v).toBeCloseTo(Math.PI * 4.25 * 4.25 * 40, 0);
    const cs = await vol([box(), H("c", { kind: "countersink", csDiameter: 20, csAngle: 90 })]);
    expect(cs.bad).toEqual([]);
    const coneV = (Math.PI * 5 / 3) * (100 + 25 + 50);
    expect(base - cs.v).toBeCloseTo(Math.PI * 25 * 35 + coneV, 0);
    const cb = await vol([box(), H("b", { kind: "counterbore", cbDiameter: 18, cbDepth: 6 })]);
    expect(base - cb.v).toBeCloseTo(Math.PI * 81 * 6 + Math.PI * 25 * 34, 0);
    const blind = await vol([box(), H("s", { depth: 15 })]);
    const tip = 5 / Math.tan((59 * Math.PI) / 180);
    expect(base - blind.v).toBeCloseTo(Math.PI * 25 * 15 + (Math.PI * 25 * tip) / 3, 0);
    const bad = await vol([box(), H("x", { kind: "tapped", thread: "M99" })]);
    expect(bad.bad[0].error).toMatch(/závit/);
  });

  it("pole v mřížce 3 × 2", async () => {
    const { v, bad } = await vol([
      box(),
      { id: "h", name: "D", type: "hole", position: [20, 15, 40], axis: "Z", flip: false, diameter: 6, depth: 0, cbDiameter: 0, cbDepth: 0 },
      { id: "p", name: "P", type: "pattern", featureId: "h", kind: "linear", count: 3, spacing: 30, direction: [1, 0, 0], count2: 2, spacing2: 30, direction2: [0, 1, 0] },
    ]);
    expect(bad).toEqual([]);
    expect(100 * 60 * 40 - v).toBeCloseTo(6 * Math.PI * 9 * 40, 0);
  });

  it("závit: kosmetický bez geometrie, modelovaný ubere materiál", async () => {
    const shaft: Feature = { id: "c", name: "Dřík", type: "cylinder", radius: 10, height: 60, position: [0, 0, 0], axis: "Z", mode: "new" };
    const full = Math.PI * 100 * 60;
    const cos = await vol([shaft, { id: "t", name: "Z", type: "thread", designation: "M20", position: [0, 0, 30], axis: "Z", length: 30, modeled: false }]);
    expect(cos.bad).toEqual([]);
    expect(cos.v).toBeCloseTo(full, 0);
    const mod = await vol([shaft, { id: "t", name: "Z", type: "thread", designation: "M20", position: [0, 0, 30], axis: "Z", length: 30, modeled: true }]);
    expect(mod.bad).toEqual([]);
    expect(mod.v).toBeLessThan(full - 500);
    expect(mod.v).toBeGreaterThan(full - 3000);
  });

  it("gravírovaný text a pomocná rovina", async () => {
    const t = await vol([
      box(),
      { id: "dt", name: "Rovina", type: "datum", origin: [0, 0, 40], normal: [0, 0, 1], xDir: [1, 0, 0], size: 100 },
      { id: "tx", name: "Text", type: "text", text: "MNÁ 2026", height: 10, depth: 1, plane: { kind: "base", name: "XY", offset: 40 }, position: [50, 30], angle: 0, mode: "cut" },
    ]);
    expect(t.bad).toEqual([]);
    expect(t.v).toBeLessThan(100 * 60 * 40 - 50);
    expect(t.res.metrics!.bbox[1][2]).toBeCloseTo(40, 3);
    const add = await vol([box(), { id: "tx", name: "Text", type: "text", text: "A", height: 10, depth: 2, plane: { kind: "base", name: "XY", offset: 40 }, position: [50, 30], angle: 30, mode: "add" }]);
    expect(add.res.metrics!.bbox[1][2]).toBeCloseTo(42, 3);
  });

  it("řetězení dráhy odhalí větvení", () => {
    expect(() =>
      chainSegs([
        { kind: "line", a: [0, 0], b: [10, 0] },
        { kind: "line", a: [20, 0], b: [30, 0] },
      ]),
    ).toThrow(/souvislá/);
  });
});

describe("proměnné, vazby a stavy", () => {
  it("vazby parametrů na proměnné a přepnutí stavu", async () => {
    const features: Feature[] = [box()];
    const base: Partial<CadDoc> = {
      variables: [{ name: "L", expr: "50" }, { name: "B", expr: "L/2 + 5" }],
      bindings: { "b:size.0": "L", "b:size.1": "B", "b:size.2": "=10" },
      configs: [{ id: "k", name: "Velký", values: { L: 100 }, suppressed: [] }],
    };
    const a = await vol(features, base);
    expect(a.v).toBeCloseTo(50 * 30 * 10, 3);
    const b = await vol(features, { ...base, activeConfig: "k" });
    expect(b.v).toBeCloseTo(100 * 55 * 10, 3);
    const c = await vol([box(), { id: "h", name: "D", type: "hole", position: [20, 20, 10], axis: "Z", flip: false, diameter: 6, depth: 0, cbDiameter: 0, cbDepth: 0 }], {
      ...base,
      configs: [{ id: "k", name: "Bez díry", values: {}, suppressed: ["h"] }],
      activeConfig: "k",
    });
    expect(c.v).toBeCloseTo(50 * 30 * 10, 3);
    const err = await buildDoc({ ...doc(features), ...base, bindings: { "b:size.0": "neznama*2" } });
    expect(err.paramErrors?.[0]).toMatch(/neznama/);
  });
});
