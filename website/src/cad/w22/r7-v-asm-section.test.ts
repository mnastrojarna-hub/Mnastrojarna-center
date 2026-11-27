/**
 * Kolo 7, čela řezu (CAD-M1-OPRAVY.md „Co zbývá“: „Řez ve 2D výkresu sestavy“): řez A–A ve výkresu sestavy šrafoval všechny
 * komponenty stejně (45°, jedna rozteč) – sousední díly splynuly, na rozdíl od čel řezu ve 3D okně. Teď má každá komponenta
 * sestavy (těleso složeného tvaru) vlastní vzor podle ISO 128-50: směr 45° / 135° a rozteč ×1 / ×1,6 se střídají. Výkres dílu
 * (bez kusovníku) šrafuje beze změny 45°. Na 260ff8b test padá (obě komponenty 45°).
 */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { makeDrawing, solidHatch, type DrawingResult } from "../drawing";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

const SECTION = { views: { front: true, top: false, left: false, right: false, back: false, bottom: false, iso: false }, dimensions: "none" as const, sheet: "A3" as const, scale: 1, section: { plane: "XZ" as const, offset: 15, kind: "full" as const } };

/** úhly šraf (°, 0–180) v řezu podle polohy středu čáry v obraze pohledu (x < 40 = deska A, x > 40 = deska B) */
function hatchAngles(d: DrawingResult): { a: number[]; b: number[]; lenA: number[]; lenB: number[] } {
  const v = d.views.find((x) => x.key === "section")!;
  const img = (q: [number, number]): [number, number] => [(q[0] - v.px) / v.s + v.x0, (q[1] - v.py) / v.s + v.y0];
  const out = { a: [] as number[], b: [] as number[], lenA: [] as number[], lenB: [] as number[] };
  for (const p of d.polys.filter((q) => q.layer === "hatch")) {
    const p0 = p.pts[0], p1 = p.pts[p.pts.length - 1];
    const ang = ((Math.atan2(-(p1[1] - p0[1]), p1[0] - p0[0]) * 180) / Math.PI + 180) % 180;
    const mid = img([(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2]);
    (mid[0] < 40 ? out.a : out.b).push(Math.round(ang));
  }
  return out;
}

describe("kolo 7: řez ve výkresu sestavy – šrafy po komponentách (ISO 128-50)", () => {
  const two = () => r.makeCompound([r.makeBox([0, 0, 0], [40, 30, 20]), r.makeBox([40, 0, 0], [80, 30, 20])] as never) as unknown as r.Shape3D;

  it("vzory: sousední tělesa se liší směrem, každé druhé i roztečí", () => {
    expect(solidHatch(0)).toEqual({ angle: 45, factor: 1 });
    expect(solidHatch(1)).toEqual({ angle: 135, factor: 1 });
    expect(solidHatch(2)).toEqual({ angle: 45, factor: 1.6 });
    expect(solidHatch(3)).toEqual({ angle: 135, factor: 1.6 });
  });

  // úhel v souřadnicích listu (osa y listu dolů): výchozí šrafa ISO 45° vychází jako 135°, kolmá na ni 45°
  it("výkres dílu (bez kusovníku): šrafy beze změny – jeden směr i u dílu se dvěma tělesy", { timeout: 120_000 }, () => {
    const d = makeDrawing(two(), { name: "Díl", material: "" }, SECTION);
    const h = hatchAngles(d);
    expect(h.a.length + h.b.length).toBeGreaterThan(10);
    expect(new Set([...h.a, ...h.b])).toEqual(new Set([135]));
  });

  it("sestava (kusovník na listu): deska A výchozí šrafy, sousední deska B kolmo na ně", { timeout: 120_000 }, () => {
    const d = makeDrawing(two(), { name: "Řez sestavy", material: "", bom: [{ pos: 1, name: "Deska A", number: "", qty: 1, material: "" }, { pos: 2, name: "Deska B", number: "", qty: 1, material: "" }] } as never, SECTION);
    const h = hatchAngles(d);
    expect(h.a.length).toBeGreaterThan(5);
    expect(h.b.length).toBeGreaterThan(5);
    expect(new Set(h.a)).toEqual(new Set([135]));
    expect(new Set(h.b)).toEqual(new Set([45]));
  });
});
