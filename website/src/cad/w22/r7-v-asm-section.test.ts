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
import { makeDrawing, type DrawingResult } from "../drawing";
import { SECTION_HATCH_PATTERNS, sectionHatch, sectionHatchPlan, solidComponentKeys } from "../drawing-section-hatch";
import { CAP_PATTERNS } from "../section-cap";

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

  // vědomá změna (kolo 7b, nález oponenta): místo 4 vzorů podle pořadí tělesa 8 vzorů čel 3D okna (CAP_PATTERNS) a výběr
  // podle sousedství komponent – test starých 4 vzorů (45/135 × 1/1,6) nahrazen shodou se vzory 3D okna
  it("vzory: tytéž jako čela řezu ve 3D okně (8 vzorů, sousední v seznamu se liší úhlem), první = výchozí 45°", () => {
    expect(SECTION_HATCH_PATTERNS.length).toBe(CAP_PATTERNS.length);
    expect(SECTION_HATCH_PATTERNS.length).toBe(8);
    expect(sectionHatch(0)).toEqual({ angle: 45, factor: 1 });
    expect(sectionHatch(1)).toEqual({ angle: 135, factor: 1 });
    expect(sectionHatch(8)).toEqual(sectionHatch(0));
    expect(new Set(SECTION_HATCH_PATTERNS.map((p) => `${p.angle}/${p.factor}`)).size).toBe(8);
  });

  const sq = (x: number, y: number, w = 10): [number, number][][] => [[[x, y], [x + w, y], [x + w, y + w], [x, y + w]]];
  it("sousedství: komponenta 4 se dotýká komponent 0 a 1 → jiný vzor než obě (dřív k a k + 4 stejný vzor)", () => {
    const loops = [sq(0, 0), sq(10, 0), sq(20, 0), sq(30, 0), sq(0, 10)];
    const plan = sectionHatchPlan(loops, [0, 1, 2, 3, 4], ["c1:0", "c2:0", "c3:0", "c4:0", "c5:0"]);
    for (const [a, b] of [[0, 1], [1, 2], [2, 3], [4, 0], [4, 1]]) expect(plan[a]).not.toBe(plan[b]);
    expect(plan[0]).toBe(0);
    // devět navzájem se dotýkajících komponent (mřížka 3 × 3): každá sousedí s až 8 dalšími – ani tehdy žádní dva sousedé
    // se stejným vzorem, kde to osm vzorů dovolí (střed má 8 sousedů → dostane vzor, který žádný soused nemá, pokud existuje)
    const grid = [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => sq(i * 10, j * 10)));
    const keys = grid.map((_, i) => `c${i}:0`);
    const p9 = sectionHatchPlan(grid, grid.map((_, i) => i), keys);
    const nb = (a: number, b: number) => a !== b && Math.abs(Math.floor(a / 3) - Math.floor(b / 3)) <= 1 && Math.abs((a % 3) - (b % 3)) <= 1;
    let clashes = 0;
    for (let a = 0; a < 9; a++) for (let b = a + 1; b < 9; b++) if (nb(a, b) && p9[a] === p9[b]) clashes++;
    expect(clashes).toBe(0);
  });

  it("jedna komponenta s více tělesy (svařenec) = jeden vzor; přiřazení tělesa komponentě podle obálky výskytu", () => {
    const keys = solidComponentKeys(
      [[[0, 0, 0], [20, 30, 20]], [[20, 0, 0], [40, 30, 20]], [[40, 0, 0], [80, 30, 20]], [[200, 0, 0], [210, 5, 5]]],
      [{ pos: 1, bbox: [[0, 0, 0], [40, 30, 20]] }, { pos: 2, bbox: [[40, 0, 0], [80, 30, 20]] }],
    );
    expect(keys).toEqual(["c1:0", "c1:0", "c2:0", "s3"]);
    const plan = sectionHatchPlan([sq(0, 0, 20), sq(20, 0, 20), sq(40, 0, 40)], [0, 1, 2], keys);
    expect(plan[0]).toBe(plan[1]);
    expect(plan[2]).not.toBe(plan[0]);
    // dva výskyty téhož dílu vedle sebe jsou dvě komponenty (různé vzory)
    const k2 = solidComponentKeys([[[0, 0, 0], [10, 10, 10]], [[10, 0, 0], [20, 10, 10]]], [{ pos: 3, bbox: [[0, 0, 0], [20, 10, 10]], boxes: [[[0, 0, 0], [10, 10, 10]], [[10, 0, 0], [20, 10, 10]]] }]);
    expect(k2).toEqual(["c3:0", "c3:1"]);
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

  it("sestava: komponenta ze dvou těles (deska A z poloviny 20 + 20 mm) má v řezu jeden vzor, deska B jiný (dřív A střídavě)", { timeout: 120_000 }, () => {
    const three = r.makeCompound([r.makeBox([0, 0, 0], [20, 30, 20]), r.makeBox([20, 0, 0], [40, 30, 20]), r.makeBox([40, 0, 0], [80, 30, 20])] as never) as unknown as r.Shape3D;
    const comps = [{ pos: 1, name: "Deska A", bbox: [[0, 0, 0], [40, 30, 20]] }, { pos: 2, name: "Deska B", bbox: [[40, 0, 0], [80, 30, 20]] }];
    const d = makeDrawing(three, { name: "Řez sestavy", material: "", bom: [{ pos: 1, name: "Deska A", number: "", qty: 1, material: "" }, { pos: 2, name: "Deska B", number: "", qty: 1, material: "" }], components: comps } as never, SECTION);
    const h = hatchAngles(d);
    expect(h.a.length).toBeGreaterThan(5);
    expect(h.b.length).toBeGreaterThan(5);
    expect(new Set(h.a)).toEqual(new Set([135]));
    expect(new Set(h.b)).toEqual(new Set([45]));
  });

  it("sestava bez tabulky kusovníku (jen komponenty pro pozice) má šrafy po komponentách taky (dřív jen s kusovníkem)", { timeout: 120_000 }, () => {
    const comps = [{ pos: 1, name: "Deska A", bbox: [[0, 0, 0], [40, 30, 20]] }, { pos: 2, name: "Deska B", bbox: [[40, 0, 0], [80, 30, 20]] }];
    const d = makeDrawing(two(), { name: "Řez sestavy", material: "", components: comps } as never, SECTION);
    const h = hatchAngles(d);
    expect(new Set(h.a)).toEqual(new Set([135]));
    expect(new Set(h.b)).toEqual(new Set([45]));
  });
});
