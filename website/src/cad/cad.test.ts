import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc, buildShape, faceInfo } from "./build";
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
    expect(d.sheet).toBe("A4");
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
