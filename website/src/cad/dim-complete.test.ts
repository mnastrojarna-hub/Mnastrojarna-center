/**
 * Vlna 22, bod 18 – kontrola kót pro výrobní úplnost (cad/dim-complete.ts), čisté funkce bez jádra: pohledy a kóty listu
 * jsou ručně složené (přední + horní pohled desky 100 × 60 × 20 v počátku), aby šlo přesně říct, která kóta je na listu.
 * Repro: S/w22/repro/18 (repro.txt – okno vyříznuté pomocným tělesem; repro-b.txt – bez jediné polohy díry), korpus
 * `__corpus__/79-dims-complete.txt`.
 */
import { describe, expect, it } from "vitest";
import { checkSheet, dimCheckDetail, dimCheckLine, missingItems, requirements, sheetFacts, suggestDim, tightTolerance, viewsBbox, type CheckView } from "./dim-complete";
import { dimCheckIssues } from "./drawing-dimcheck";
import { dimCheck } from "./dim-check";
import { emptyDoc, type CadDoc, type DrawingAnnotation, type Feature, type FunctionalMark, type Vec2 } from "./types";

// pohledy jako jádro výkresu: horní (x = X, y obrazu = −Y), přední (x = X, y obrazu = −Z)
const TOP: CheckView = { key: "top", x0: 0, y0: -60, w: 100, h: 60, cam: { d: [0, 0, 1], x: [1, 0, 0] } };
const FRONT: CheckView = { key: "front", x0: 0, y0: -20, w: 100, h: 20, cam: { d: [0, -1, 0], x: [1, 0, 0] } };
const VIEWS = [FRONT, TOP];

let n = 0;
const id = () => `t${++n}`;
/** souřadnice pohledu z bodu modelu (horní: [X, −Y]; přední: [X, −Z]) */
const top = (x: number, y: number): Vec2 => [x, -y];
const front = (x: number, z: number): Vec2 => [x, -z];
const hdim = (view: string, a: Vec2, b: Vec2, suffix?: string): DrawingAnnotation => ({ id: id(), view, type: "dim", kind: "horizontal", a, b, offset: 10, ...(suffix ? { suffix } : {}) });
const vdim = (view: string, a: Vec2, b: Vec2, suffix?: string): DrawingAnnotation => ({ id: id(), view, type: "dim", kind: "vertical", a, b, offset: 10, ...(suffix ? { suffix } : {}) });
const dia = (c: Vec2, r: number, suffix?: string): DrawingAnnotation => ({ id: id(), view: "top", type: "dim", kind: "diameter", c, r, ang: 45, offset: 8, ...(suffix ? { suffix } : {}) });
const callout = (c: Vec2, r: number, lines: string[], tol?: string): DrawingAnnotation => ({ id: id(), view: "top", type: "callout", tip: [c[0] + r * 0.7071, c[1] - r * 0.7071], at: [c[0] + 15, c[1] - 15], lines, circle: { c, r }, ...(tol ? { tol } : {}) });
const centerline = (a: Vec2, b: Vec2): DrawingAnnotation => ({ id: id(), view: "top", type: "centerline", a, b });

const F = (f: Record<string, unknown>) => ({ id: id(), suppressed: false, ...f }) as unknown as Feature;
const plate = () => F({ name: "Kvádr 1", type: "box", size: [100, 60, 20], position: [0, 0, 0], centered: false, mode: "new" });
const hole = (name: string, x: number, y: number, d = 8, depth = 0) => F({ name, type: "hole", position: [x, y, 20], axis: "Z", flip: false, diameter: d, depth, cbDiameter: 0, cbDepth: 0, kind: "simple" });
const doc = (features: Feature[], functional?: FunctionalMark[]): CadDoc => ({ ...emptyDoc("Deska A"), features, ...(functional ? { functional } : {}) });
/** celkové rozměry 100 / 60 (horní) a 20 (přední) */
const overall = () => [hdim("top", top(0, 0), top(100, 0)), vdim("top", top(0, 0), top(0, 60)), vdim("front", front(0, 0), front(0, 20))];

/** repro A: okno vyříznuté pomocným tělesem „Nástroj“ 30 × 20 × 40 a dvě díry Ø8 */
function reproA(): CadDoc {
  const tool = F({ name: "Kvádr 2", type: "box", size: [30, 20, 40], position: [35, 20, -10], centered: false, mode: "new", body: "Nástroj" });
  const comb = F({ name: "Sloučení 1", type: "combine", target: "Těleso 1", tool: "Nástroj", op: "cut", keepTool: false });
  return doc([plate(), tool, comb, hole("Díra 1", 15, 15), hole("Díra 2", 85, 45)]);
}

describe("bod 18 – pomocné (nástrojové) těleso", () => {
  it("výška nástroje 40 se neočekává; okno 30 × 20 a jeho poloha 35 / 20 ano; Nástroj = pomocné těleso", () => {
    const d = reproA();
    const r = requirements(d, viewsBbox(VIEWS));
    expect(r.reqs.some((q) => q.value === 40)).toBe(false);
    expect(r.reqs.filter((q) => q.kind === "size" && q.source === "Kvádr 2").map((q) => q.value).sort()).toEqual([20, 30]);
    expect(r.reqs.filter((q) => q.kind === "pos" && q.source === "Kvádr 2").map((q) => [q.axis, q.value])).toEqual([[0, 35], [1, 20]]);
    expect(r.aux).toEqual([{ name: "Nástroj", op: "cut", features: [d.features[1].id] }]);
    // dosavadní kontrola (dim-check.ts, GUI dřív) už výšku nástroje nechce taky
    expect(dimCheck(d, [[0, 0, 0], [100, 60, 20]], []).some((x) => x.value === 40)).toBe(false);
  });
  it("průnik nástrojem: prvky nástroje se neočekávají vůbec; „ponechat“ nástroj = běžné těleso", () => {
    const tool = F({ name: "Kvádr 2", type: "box", size: [30, 20, 40], position: [35, 20, -10], centered: false, mode: "new", body: "Nástroj" });
    const inter = doc([plate(), tool, F({ name: "Sloučení 1", type: "combine", target: "Těleso 1", tool: "Nástroj", op: "intersect", keepTool: false })]);
    expect(requirements(inter, viewsBbox(VIEWS)).reqs.some((q) => q.source === "Kvádr 2")).toBe(false);
    const kept = doc([plate(), tool, F({ name: "Sloučení 1", type: "combine", target: "Těleso 1", tool: "Nástroj", op: "cut", keepTool: true })]);
    expect(requirements(kept, viewsBbox(VIEWS)).aux).toEqual([]);
  });
});

describe("bod 18 – polohy a počty podle geometrie, ne podle čísla", () => {
  it("repro B: kóty jen 100 / 60 / 20 / okno 30 / Ø8 → polohy 0/6, Ø8 jen 1× z 2×, ⚠ drawing.dims-incomplete", () => {
    const d = reproA();
    const anns = [...overall(), hdim("top", top(35, 20), top(65, 20)), dia(top(15, 15), 4)];
    const r = checkSheet({ doc: d, views: VIEWS, annotations: anns, dimensions: "smart" });
    expect(r.pos).toEqual({ ok: 0, total: 6 });
    const g = r.items.find((q) => q.holes && q.kind === "size")!;
    expect([g.status, g.have, g.why]).toEqual(["partial", 1, "na listu 1× z 2×"]);
    const line = dimCheckLine(r);
    expect(line).toMatch(/^Kontrola kót: velikosti \d+\/\d+ · polohy 0\/6 – chybí: /);
    expect(line).toContain("poloha Díra 1 – X 15");
    expect(line).toContain("pomocná tělesa (nekótují se): Nástroj (odebráno)");
    expect(line).not.toMatch(/všech|kompletní/);
    const iss = dimCheckIssues(r, { withTol: true });
    expect(iss.map((i) => i.code)).toEqual(["drawing.dims-incomplete"]);
    expect(iss[0].text).toMatch(/^kóty neúplné – chybí \d+ \(velikosti \d+\/\d+, polohy 0\/6\)/);
  });
  it("polohy od hran (řetěz) + popis „2× Ø8 skrz“ + osy souměrnosti okna → velikosti i polohy splněné, žádné ⚠", () => {
    const d = reproA();
    const anns = [
      ...overall(),
      hdim("top", top(0, 5), top(15, 5)), // X díry 1 od levé hrany
      hdim("top", top(15, 5), top(85, 5)), // řetěz k díře 2
      vdim("top", top(-5, 0), top(-5, 15)), // Y díry 1
      vdim("top", top(-5, 15), top(-5, 45)), // Y díry 2
      hdim("top", top(35, 20), top(65, 20)), // okno 30
      vdim("top", top(35, 20), top(35, 40)), // okno 20
      centerline(top(50, -5), top(50, 65)), // osa souměrnosti X = 50 (střed okna)
      centerline(top(-5, 30), top(105, 30)), // osa Y = 30
      callout(top(15, 15), 4, ["2× Ø8 skrz"]),
    ];
    const r = checkSheet({ doc: d, views: VIEWS, annotations: anns, dimensions: "smart" });
    expect(missingItems(r)).toEqual([]);
    expect(r.size.ok).toBe(r.size.total);
    expect(r.pos).toEqual({ ok: 6, total: 6 });
    // ani úplná kontrola neříká „všech“ / „kompletní“ – jen co zkontrolovala
    expect(dimCheckLine(r)).toMatch(/^Kontrola kót: velikosti 6\/6 · polohy 6\/6 · pomocná tělesa .* · tolerance neověřeny \(funkční prvky nevyznačeny\)$/);
    expect(dimCheckIssues(r, { withTol: true })).toEqual([]);
  });
  it("velikost okna jako jediná kóta polohy nestačí (kóta 35–65 je velikost, ne poloha); osa souměrnosti jinde neplatí", () => {
    const d = reproA();
    const r = checkSheet({ doc: d, views: VIEWS, annotations: [...overall(), hdim("top", top(35, 20), top(65, 20)), centerline(top(40, -5), top(40, 65))], dimensions: "smart" });
    expect(r.items.find((q) => q.id.startsWith("boxpos:") && q.axis === 0)!.status).toBe("missing");
  });
  it("hloubka díry: libovolná „10“ mimo díru ji nesplní, popis díry „Ø12 ↧10“ ano", () => {
    const d = doc([plate(), hole("Díra 3", 50, 30, 12, 10)]);
    const far = checkSheet({ doc: d, views: VIEWS, annotations: [...overall(), vdim("front", front(100, 10), front(100, 20)), dia(top(50, 30), 6)], dimensions: "smart" });
    expect(far.items.find((q) => q.id.startsWith("holedepth:"))!.status).toBe("missing");
    const onHole = checkSheet({ doc: d, views: VIEWS, annotations: [...overall(), vdim("front", front(56, 10), front(56, 20)), dia(top(50, 30), 6)], dimensions: "smart" });
    expect(onHole.items.find((q) => q.id.startsWith("holedepth:"))!.status).toBe("ok");
    const call = checkSheet({ doc: d, views: VIEWS, annotations: [...overall(), callout(top(50, 30), 6, ["Ø12 ↧10"])], dimensions: "smart" });
    expect(call.items.find((q) => q.id.startsWith("holedepth:"))!.status).toBe("ok");
  });
  it("kóty zapečené v pohledu (Auto): polohy „nezkontrolováno“, nikdy ✓", () => {
    const d = reproA();
    const r = checkSheet({ doc: d, views: VIEWS, annotations: [], dimensions: "auto", texts: [{ s: "100", layer: "dim" }, { s: "60", layer: "dim" }, { s: "20", layer: "dim" }, { s: "2× Ø8", layer: "dim" }] });
    expect(r.items.filter((q) => q.kind === "pos").every((q) => q.status === "unchecked")).toBe(true);
    expect(r.pos.total).toBe(0);
    expect(dimCheckLine(r)).toContain("polohy nezkontrolovány");
    expect(r.unchecked.join(" ")).toContain("polohy prvků (kóty zapečené v pohledu");
  });
  it("tabulka děr na listu: polohy i počet děr", () => {
    const d = doc([plate(), hole("Díra 1", 15, 15), hole("Díra 2", 85, 45)]);
    const rows = [{ c: top(15, 15), view: "top", d: 8 }, { c: top(85, 45), view: "top", d: 8 }];
    const r = checkSheet({ doc: d, views: VIEWS, annotations: overall(), dimensions: "smart", holeRows: rows });
    expect(missingItems(r)).toEqual([]);
  });
});

describe("bod 18 – funkční prvky, základny, tolerance", () => {
  const anns = (suffix?: string) => [
    ...overall(),
    hdim("top", top(0, 5), top(15, 5)),
    vdim("top", top(-5, 0), top(-5, 15)),
    dia(top(15, 15), 4, suffix),
  ];
  it("funkční díra s předepsanou H7: bez tolerance ⚠ drawing.tolerance-missing, s H7 ok, jiná tolerance „liší se“", () => {
    const base = doc([plate(), hole("Díra 1", 15, 15)]);
    const mk = (tol?: string): FunctionalMark[] => [{ id: "f1", kind: "functional", feature: base.features[1].id, ...(tol ? { tol } : {}) }];
    const none = checkSheet({ doc: { ...base, functional: mk("H7") }, views: VIEWS, annotations: anns(), dimensions: "smart" });
    expect(none.tol.marked).toBe(1);
    expect(none.items.find((q) => q.holes && q.kind === "size")!.tolState).toBe("missing");
    expect(dimCheckIssues(none, { withTol: true }).map((i) => i.code)).toContain("drawing.tolerance-missing");
    const ok = checkSheet({ doc: { ...base, functional: mk("H7") }, views: VIEWS, annotations: anns("H7"), dimensions: "smart" });
    expect(ok.items.find((q) => q.holes && q.kind === "size")!.tolState).toBe("ok");
    const diff = checkSheet({ doc: { ...base, functional: mk("H7") }, views: VIEWS, annotations: anns("H9"), dimensions: "smart" });
    expect(diff.items.find((q) => q.holes && q.kind === "size")!.tolState).toBe("differs");
    expect(dimCheckLine(diff)).toContain("funkční prvky: tolerance");
  });
  it("přetolerování: přesná tolerance na nefunkční kótě = ℹ drawing.tol-nonfunctional (jen když jsou funkční prvky vyznačené)", () => {
    const base = doc([plate(), hole("Díra 1", 15, 15)]);
    const tight = [...anns("H7").slice(0, 3), hdim("top", top(0, 5), top(15, 5), "±0,01"), vdim("top", top(-5, 0), top(-5, 15)), dia(top(15, 15), 4, "H7")];
    const unmarked = checkSheet({ doc: base, views: VIEWS, annotations: tight, dimensions: "smart" });
    expect(unmarked.tol.over).toEqual([]);
    expect(dimCheckLine(unmarked)).toContain("tolerance neověřeny (funkční prvky nevyznačeny)");
    const marked = checkSheet({ doc: { ...base, functional: [{ id: "f1", kind: "functional", feature: base.features[1].id, tol: "H7" }] }, views: VIEWS, annotations: tight, dimensions: "smart" });
    // poloha díry je funkční (prvek označený celý) → ±0,01 na ní přetolerování není; Ø H7 taky ne
    expect(marked.tol.over).toEqual([]);
    const face: FunctionalMark = { id: "f1", kind: "functional", face: { index: 4 }, geom: { t: "plane", n: [0, 0, 1], c: [50, 30, 20] } };
    const other = checkSheet({ doc: { ...base, functional: [face] }, views: VIEWS, annotations: tight, dimensions: "smart" });
    expect(other.tol.over.map((o) => o.tol).sort()).toEqual(["H7", "±0,01"]);
    expect(dimCheckIssues(other).map((i) => [i.code, i.level])).toContainEqual(["drawing.tol-nonfunctional", "note"]);
  });
  it("základna A (rovina X = 0): poloha funkční díry od základny ok, řetěz od jiné díry = „kóta polohy není od základny A“", () => {
    const base = doc([plate(), hole("Díra 1", 15, 15), hole("Díra 2", 85, 45)]);
    const marks: FunctionalMark[] = [
      { id: "f1", kind: "datum", label: "A", face: { index: 0 }, geom: { t: "plane", n: [-1, 0, 0], c: [0, 30, 10] } },
      { id: "f2", kind: "functional", feature: base.features[2].id },
    ];
    const chain = [...overall(), hdim("top", top(15, 5), top(85, 5)), vdim("top", top(-5, 15), top(-5, 45)), callout(top(15, 15), 4, ["2× Ø8 skrz"])];
    const r = checkSheet({ doc: { ...base, functional: marks }, views: VIEWS, annotations: chain, dimensions: "smart" });
    const px = r.items.find((q) => q.id.startsWith(`holepos:${base.features[2].id}`) && q.axis === 0)!;
    expect([px.status, px.why, px.datum?.label]).toEqual(["partial", "kóta polohy není od základny A", "A"]);
    const fromA = checkSheet({ doc: { ...base, functional: marks }, views: VIEWS, annotations: [...chain, hdim("top", top(0, 50), top(85, 50))], dimensions: "smart" });
    expect(fromA.items.find((q) => q.id === px.id)!.status).toBe("ok");
  });
  it("funkční rovinná plocha (F) = poloha plochy na listu", () => {
    const step = F({ name: "Kvádr 2", type: "box", size: [100, 30, 5], position: [0, 0, 20], centered: false, mode: "add" });
    const d = doc([plate(), step], [{ id: "f1", kind: "functional", face: { index: 9 }, geom: { t: "plane", n: [0, 0, 1], c: [50, 15, 25] }, tol: "±0,02" }]);
    const views = [{ ...FRONT, y0: -25, h: 25 }, TOP];
    const miss = checkSheet({ doc: d, views, annotations: [hdim("top", top(0, 0), top(100, 0)), vdim("top", top(0, 0), top(0, 60))], dimensions: "smart" });
    expect(miss.items.find((q) => q.id === "mark:f1")!.status).toBe("missing");
    const ok = checkSheet({ doc: d, views, annotations: [vdim("front", front(0, 0), front(0, 25), "±0,02")], dimensions: "smart" });
    expect(ok.items.find((q) => q.id === "mark:f1")).toMatchObject({ status: "ok", tolState: "ok" });
  });
  it("přesná tolerance: H7 / h6 / ±0,02 / +0,03 0 ano; H11 / ±0,1 ne", () => {
    expect(["H7", "h6", "±0,02", "+0,03 0", "0/-0,05", "H7/g6"].map(tightTolerance)).toEqual([true, true, true, true, true, true]);
    expect(["H11", "±0,1", "", "+0,2 0"].map(tightTolerance)).toEqual([false, false, false, false]);
  });
});

describe("bod 18 – podrobný výpis a návrh kóty („Přidat kótu“)", () => {
  it("výkres kontrola kót: čísla položek, ✓ / ◐ / ✗, věta o konstruktérovi; nikdy „všech“", () => {
    const d = reproA();
    const r = checkSheet({ doc: d, views: VIEWS, annotations: [...overall(), dia(top(15, 15), 4)], dimensions: "smart" });
    const L = dimCheckDetail(r);
    expect(L[0]).toMatch(/^Kontrola kót: /);
    expect(L).toContain("Velikosti:");
    expect(L.some((l) => /^ {2}◐ \d+\. 2× Ø8 skrz \(Díra 1, Díra 2\) – na listu 1× z 2×$/.test(l))).toBe(true);
    expect(L.some((l) => /^ {2}✗ \d+\. poloha Díra 2 – X 85$/.test(l))).toBe(true);
    expect(L[L.length - 1]).toContain("úplnost výrobního výkresu potvrzuje konstruktér");
    expect(L.join("\n")).not.toMatch(/všech|kompletní/);
  });
  it("návrh: poloha díry = vodorovná kóta v horním pohledu od levé hrany k středu díry; Ø skupiny = kóta průměru", () => {
    const d = reproA();
    const r = checkSheet({ doc: d, views: VIEWS, annotations: overall(), dimensions: "smart" });
    const px = r.items.find((q) => q.label === "poloha Díra 2 – X 85")!;
    expect(suggestDim(px, VIEWS, viewsBbox(VIEWS))).toEqual({ kind: "horizontal", view: "top", p1: [0, 45], p2: [85, 45] });
    const g = r.items.find((q) => q.holes && q.kind === "size")!;
    expect(suggestDim(g, VIEWS, viewsBbox(VIEWS))).toEqual({ kind: "diameter", view: "top", c: [15, 15], r: 4 });
    const win = r.items.find((q) => q.id.startsWith("boxpos:") && q.axis === 1)!;
    expect(suggestDim(win, VIEWS, viewsBbox(VIEWS))).toMatchObject({ kind: "vertical", view: "top", p1: [50, 0], p2: [50, 20] });
  });
  it("fakta listu: vodorovná / svislá kóta → osa modelu a souřadnice konců; osa souměrnosti → souřadnice", () => {
    const f = sheetFacts(VIEWS, [hdim("top", top(0, 5), top(15, 5)), vdim("front", front(0, 0), front(0, 20)), centerline(top(50, -5), top(50, 65))]);
    expect(f.lin.map((x) => [x.k, x.c1, x.c2])).toEqual([[0, 0, 15], [2, 0, 20]]);
    expect(f.centers).toEqual([{ k: 0, c: 50 }]);
    expect(viewsBbox(VIEWS)).toEqual([[0, 0, 0], [100, 60, 20]]);
  });
});
