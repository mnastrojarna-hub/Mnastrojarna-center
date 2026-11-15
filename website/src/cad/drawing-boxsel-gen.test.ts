/**
 * Výkres sestavy / dílu: vygenerované kóty celkových rozměrů a pozice (balónky) jdou vybrat klikem a oknem, Delete je skryje
 * a tažení / šipky posunou (DrawingOptions.genEdit → jádro výkresu) – nález W20-2d: v sestavě nešly vybrat vůbec.
 */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { makeDrawing, type DrawingResult } from "./drawing";
import { generatedShapes, genDelta, genEditCount, hideGenerated, isGenId, moveGenerated } from "./drawing-boxsel";
import { pickShape, rectFrom, selectShapes } from "./box-select-2d";
import type { Vec3 } from "./types";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

/** deska 100×60×10 a čep Ø20 – jako sestava v nálezu */
const shape = () => (r.makeBox([0, 0, 0], [100, 60, 10]) as r.Shape3D).fuse(r.makeCylinder(10, 30, [20, 20, 10], [0, 0, 1]));
const comps = [
  { pos: 1, name: "Deska", bbox: [[0, 0, 0], [100, 60, 10]] as [Vec3, Vec3] },
  { pos: 2, name: "Čep", bbox: [[10, 10, 10], [30, 30, 40]] as [Vec3, Vec3] },
];
const meta = { name: "S21", material: "", components: comps };
const draw = (genEdit?: { off?: string[]; move?: Record<string, [number, number]> }) => makeDrawing(shape(), meta, { dimensions: "overall", balloons: true, ...(genEdit ? { genEdit } : {}) });
const item = (d: DrawingResult, id: string) => d.generated?.find((g) => g.id === id);
const bounds = (pts: readonly (readonly [number, number])[][]) => {
  const all = pts.flat();
  return { x0: Math.min(...all.map((p) => p[0])), y0: Math.min(...all.map((p) => p[1])), x1: Math.max(...all.map((p) => p[0])), y1: Math.max(...all.map((p) => p[1])) };
};

describe("vygenerované kóty a pozice ve výběru výkresu", () => {
  it("jádro vrací kóty celkových rozměrů a balónky jako vybratelné objekty", () => {
    const d = draw();
    const ids = (d.generated ?? []).map((g) => g.id).sort();
    expect(ids).toContain("dim:front:t");
    expect(ids).toContain("dim:front:l");
    expect(ids).toContain("pos:1");
    expect(ids).toContain("pos:2");
    const dim = item(d, "dim:front:t")!;
    expect(dim.kind).toBe("dim");
    expect(dim.rects.length).toBe(1); // text „100“
    const bal = item(d, "pos:1")!;
    expect(bal.kind).toBe("balloon");
    expect(bal.polys).toHaveLength(1); // jen kroužek, bez odkazové čáry
  });

  it("klik na text kóty a na balónek je vybere; okno kolem balónku vybere jen balónek, křížení přes kótu kótu", () => {
    const d = draw();
    const shapes = generatedShapes(d);
    expect(shapes.every((s) => isGenId(s.id))).toBe(true);
    const t = item(d, "dim:front:t")!.rects[0];
    expect(pickShape(shapes, [(t[0] + t[2]) / 2, (t[1] + t[3]) / 2], 1)).toBe("gen:dim:front:t");
    const b = d.balloons!.find((x) => x.pos === 1)!;
    expect(pickShape(shapes, [b.x, b.y], 1)).toBe("gen:pos:1");
    // okno (zleva doprava) těsně kolem kroužku R4: celé uvnitř je jen balónek 1
    expect(selectShapes(shapes, rectFrom([b.x - 5, b.y - 5], [b.x + 5, b.y + 5]), false)).toEqual(["gen:pos:1"]);
    // křížení přes kótovací čáru horní kóty (malý obdélník přes střed textu) ji vybere, okno stejné velikosti ne
    const cx = (t[0] + t[2]) / 2;
    const cy = t[3] + 0.8;
    expect(selectShapes(shapes, rectFrom([cx - 1, cy - 1], [cx + 1, cy + 1]), true)).toContain("gen:dim:front:t");
    expect(selectShapes(shapes, rectFrom([cx - 1, cy - 1], [cx + 1, cy + 1]), false)).not.toContain("gen:dim:front:t");
  });

  it("Delete = skrytí: kóta i balónek z listu zmizí (i z SVG / DXF), ostatní zůstanou", () => {
    const d0 = draw();
    const n100 = d0.texts.filter((x) => x.s === "100").length;
    const ed = hideGenerated(undefined, ["gen:dim:front:t", "gen:pos:2", "annot-1"]);
    expect(ed).toEqual({ off: ["dim:front:t", "pos:2"] });
    const d = draw(ed);
    expect(d.texts.filter((x) => x.s === "100").length).toBe(n100 - 1);
    expect(d.balloons!.map((x) => x.pos)).toEqual([1]);
    expect(item(d, "dim:front:t")).toBeUndefined();
    expect(item(d, "pos:2")).toBeUndefined();
    expect(item(d, "dim:front:l")).toBeDefined();
    expect(d.dxf.length).toBeLessThan(d0.dxf.length);
    expect(genEditCount(ed)).toBe(2);
  });

  it("posun: kóta kolmo k sobě (odsazení), balónek volně – odkazová čára vede dál k bodu komponenty", () => {
    const d0 = draw();
    const ed = moveGenerated(moveGenerated(undefined, ["gen:dim:front:t", "gen:pos:1"], [7, -5]), ["gen:pos:1"], [3, 0]);
    // horní kóta jen svisle (x se zahodí), balónek se posuny sčítají
    expect(ed!.move).toEqual({ "dim:front:t": [0, -5], "pos:1": [10, -5] });
    expect(genDelta("gen:dim:front:l", [4, 9])).toEqual([4, 0]);
    expect(genDelta("gen:pos:3", [4, 9])).toEqual([4, 9]);
    const d = draw(ed);
    const a = bounds(item(d0, "dim:front:t")!.polys);
    const b = bounds(item(d, "dim:front:t")!.polys);
    expect(b.y0).toBeCloseTo(a.y0 - 5, 6); // kóta o 5 mm výš (dál od pohledu)
    expect(b.x0).toBeCloseTo(a.x0, 6);
    const p0 = d0.balloons!.find((x) => x.pos === 1)!;
    const p1 = d.balloons!.find((x) => x.pos === 1)!;
    expect([p1.x - p0.x, p1.y - p0.y].map((v) => Math.round(v * 1000) / 1000)).toEqual([10, -5]);
    // odkazová čára: konec u komponenty (tečka) zůstává, začátek je na okraji posunutého kroužku
    const leader = (dd: DrawingResult, c: { x: number; y: number }) => dd.polys.find((pl) => pl.layer === "dim" && pl.pts.length === 2 && Math.abs(Math.hypot(pl.pts[0][0] - c.x, pl.pts[0][1] - c.y) - 4) < 1e-6)!;
    const l0 = leader(d0, p0);
    const l1 = leader(d, p1);
    expect(l1.pts[1][0]).toBeCloseTo(l0.pts[1][0], 6);
    expect(l1.pts[1][1]).toBeCloseTo(l0.pts[1][1], 6);
    // přiblížení k pohledu má mez (kóta nesmí vlézt do obrysu): odsazení nejméně 2 mm
    const near = draw({ move: { "dim:front:t": [0, 50] } });
    const v = near.views.find((x) => x.key === "front")!;
    expect(bounds(item(near, "dim:front:t")!.polys).y0).toBeGreaterThanOrEqual(v.py - 2 - 2.5);
    expect(moveGenerated(undefined, ["annot-1"], [1, 1])).toBeUndefined();
  });
});
