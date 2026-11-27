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
      // kolo 6: pomocné čáry poloh děr vedou na osu díry (bod kóty ve středu díry), ne odjinud se shodnou souřadnicí
      hdim("top", top(0, 15), top(15, 15)), // X díry 1 od levé hrany
      hdim("top", top(15, 15), top(85, 45)), // řetěz k díře 2
      vdim("top", top(15, 0), top(15, 15)), // Y díry 1
      vdim("top", top(15, 15), top(85, 45)), // Y díry 2
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

describe("bod 18 (kolo 6) – směr kóty a pomocná čára na osu díry", () => {
  // repro S/w22/ver6/draw/p18/b2.txt: deska 100×60×20 jen s kótou 100, vodorovnou 60 v horním pohledu (= osa X) a vodorovnou
  // 20 v předním pohledu (= osa X); texty listu nesou i texty těchto kót (withAnnotations) – dřív je fallback „hodnotou“
  // započetl jako šířku Y 60 a výšku Z 20 → „velikosti 4/4“, --strict exit 0
  it("celkový rozměr: kóta jiného směru (osy modelu) ho nesplní ani svým textem", () => {
    const d = doc([plate(), hole("Díra 1", 15, 15)]);
    const anns = [hdim("top", top(0, 0), top(100, 0)), hdim("top", top(20, 30), top(80, 30)), hdim("front", front(40, 5), front(60, 5)), dia(top(15, 15), 4)];
    const texts = [{ s: "100", layer: "dim" }, { s: "60", layer: "dim" }, { s: "20", layer: "dim" }, { s: "Ø8", layer: "dim" }];
    const r = checkSheet({ doc: d, views: VIEWS, annotations: anns, dimensions: "smart", texts });
    expect(r.items.filter((q) => q.id.startsWith("overall:")).map((q) => [q.id, q.status])).toEqual([["overall:0", "ok"], ["overall:1", "missing"], ["overall:2", "missing"]]);
    expect(dimCheckLine(r)).toContain("chybí: 60 (šířka Y) (celkové rozměry); 20 (výška Z) (celkové rozměry)");
    // se svislou 60 (horní = Y) a svislou 20 (přední = Z) jsou splněné
    const ok = checkSheet({ doc: d, views: VIEWS, annotations: [...anns, vdim("top", top(0, 0), top(0, 60)), vdim("front", front(0, 0), front(0, 20))], dimensions: "smart", texts: [...texts, { s: "60", layer: "dim" }, { s: "20", layer: "dim" }] });
    expect(ok.items.filter((q) => q.id.startsWith("overall:")).every((q) => q.status === "ok")).toBe(true);
    // zapečená kóta celkového rozměru (jen text, bez poznámky listu) se hodnotou páruje dál
    const baked = checkSheet({ doc: d, views: VIEWS, annotations: [hdim("top", top(0, 0), top(100, 0))], dimensions: "smart", texts: [{ s: "100", layer: "dim" }, { s: "60", layer: "dim" }, { s: "20", layer: "dim" }] });
    expect(baked.items.filter((q) => q.id.startsWith("overall:")).every((q) => q.status === "ok")).toBe(true);
  });
  // repro S/w22/ver6/draw/p18/a.txt: kóta „15“ z [0; 45] do [15; 45] splnila „poloha Díra 1 – X 15“ (díra je na [15; 15])
  it("poloha díry jen kótou, jejíž pomocná čára vede na osu díry – ne kótou se shodnou souřadnicí jinde", () => {
    const d = doc([plate(), hole("Díra 1", 15, 15), hole("Díra 2", 85, 45)]);
    const px = (r: ReturnType<typeof checkSheet>) => r.items.find((q) => q.id.startsWith(`holepos:${d.features[1].id}`) && q.axis === 0)!.status;
    expect(px(checkSheet({ doc: d, views: VIEWS, annotations: [...overall(), hdim("top", top(0, 45), top(15, 45))], dimensions: "smart" }))).toBe("missing");
    expect(px(checkSheet({ doc: d, views: VIEWS, annotations: [...overall(), hdim("top", top(15, 30), top(100, 30))], dimensions: "smart" }))).toBe("missing");
    // bod kóty ve středu díry, na kružnici, nebo v pohledu z boku na čáře osy díry (přední pohled, Z v desce)
    expect(px(checkSheet({ doc: d, views: VIEWS, annotations: [...overall(), hdim("top", top(0, 15), top(15, 15))], dimensions: "smart" }))).toBe("ok");
    expect(px(checkSheet({ doc: d, views: VIEWS, annotations: [...overall(), hdim("top", top(0, 11), top(15, 11))], dimensions: "smart" }))).toBe("ok");
    expect(px(checkSheet({ doc: d, views: VIEWS, annotations: [...overall(), hdim("front", front(0, 10), front(15, 10))], dimensions: "smart" }))).toBe("ok");
  });
});

describe("bod 18 (kolo 6) – pomocná čára ke kótovací čáře přes osu díry", () => {
  // pomocná čára vede od bodu kóty ke kótovací čáře; prochází-li osou díry, poloha díry je okótovaná – kótovací čára na
  // druhé straně ne
  const TOP1: CheckView = { ...TOP, s: 1 };
  const one = doc([plate(), hole("Díra 1", 15, 15)]);
  const vd = (x: number, offset: number): DrawingAnnotation => ({ id: id(), view: "top", type: "dim", kind: "vertical", a: top(x, 0), b: top(x, 15), offset });
  const y1 = (d: CadDoc, r: ReturnType<typeof checkSheet>) => r.items.find((q) => q.id.startsWith(`holepos:${d.features[1].id}`) && q.axis === 1)!.status;
  it("bod kóty na pravé hraně: kótovací čára vlevo (pomocná čára přes Díru 1) splní Y Díry 1; vpravo ne", () => {
    expect(y1(one, checkSheet({ doc: one, views: [FRONT, TOP1], annotations: [...overall(), vd(100, -110)], dimensions: "smart" }))).toBe("ok");
    expect(y1(one, checkSheet({ doc: one, views: [FRONT, TOP1], annotations: [...overall(), vd(100, 15)], dimensions: "smart" }))).toBe("missing");
  });
  // díry v řadě (Chytré kóty kótují řadu jednou – tahák pro agenty, Díra 4 – Y 10): kóta s bodem ve středu jiné díry na téže
  // osové čáře splní polohu obou; bod jinde se shodnou souřadnicí (repro p18/a.txt) ne
  it("řada děr: bod kóty ve středu Díry 2 (stejné Y) splní Y Díry 1 i bez polohy kótovací čáry", () => {
    const two = doc([plate(), hole("Díra 1", 15, 15), hole("Díra 2", 60, 15)]);
    expect(y1(two, checkSheet({ doc: two, views: VIEWS, annotations: [...overall(), vd(60, 15)], dimensions: "smart" }))).toBe("ok");
    expect(y1(two, checkSheet({ doc: two, views: VIEWS, annotations: [...overall(), vd(40, 15)], dimensions: "smart" }))).toBe("missing");
  });
});

describe("bod 18 – funkční prvky, základny, tolerance", () => {
  const anns = (suffix?: string) => [
    ...overall(),
    hdim("top", top(0, 15), top(15, 15)),
    vdim("top", top(15, 0), top(15, 15)),
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
    const tight = [...anns("H7").slice(0, 3), hdim("top", top(0, 15), top(15, 15), "±0,01"), vdim("top", top(15, 0), top(15, 15)), dia(top(15, 15), 4, "H7")];
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
    const chain = [...overall(), hdim("top", top(15, 15), top(85, 45)), vdim("top", top(15, 15), top(85, 45)), callout(top(15, 15), 4, ["2× Ø8 skrz"])];
    const r = checkSheet({ doc: { ...base, functional: marks }, views: VIEWS, annotations: chain, dimensions: "smart" });
    const px = r.items.find((q) => q.id.startsWith(`holepos:${base.features[2].id}`) && q.axis === 0)!;
    expect([px.status, px.why, px.datum?.label]).toEqual(["partial", "kóta polohy není od základny A", "A"]);
    const fromA = checkSheet({ doc: { ...base, functional: marks }, views: VIEWS, annotations: [...chain, hdim("top", top(0, 45), top(85, 45))], dimensions: "smart" });
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

/**
 * Fáze 2, kolo 4 (cad-agent-journey krok 6): výchozí díra kruhového pole na roztečné kružnici. Chytré kóty kreslí u pole
 * roztečnou kružnici „Ø50“ a „6× … rovnoměrně“ (střed pole poloha / osy souměrnosti), ne kótu „X 25“ k výchozí díře – ta
 * by byla zdvojená (= Ø50 / 2). Kontrola dřív roztečnou kružnici jako polohu nepoznala → „chybí: poloha Díra 2 – X 25“.
 * Teď ji přijme JEN tehdy, když geometrie polohu opravdu určuje: Ø = 2 × vzdálenost díry od středu pole, střed kružnice
 * = střed pole v pohledu podél osy pole, poloha středu na téže ose je na listu a díra leží na přímce středem rovnoběžné
 * s kontrolovanou osou (natočenou díru by určoval ještě úhel).
 */
describe("bod 18 – kruhové pole: roztečná kružnice jako poloha výchozí díry", () => {
  const seedAt = (x: number, y: number) => {
    const bore = F({ name: "Díra 1", type: "hole", position: [50, 30, 20], axis: "Z", flip: false, diameter: 20, depth: 0, cbDiameter: 0, cbDepth: 0, kind: "simple" });
    const seed = hole("Díra 2", x, y, 6.6);
    const pat = F({ name: "Pole 1", type: "pattern", kind: "circular", featureId: seed.id, count: 6, angle: 360, axis: "Z", center: [50, 30, 20] });
    return { d: doc([plate(), bore, seed, pat]), seed };
  };
  const axes = () => [centerline(top(-5, 30), top(105, 30)), centerline(top(50, -5), top(50, 65))];
  const calls = (sx: number, sy: number, pcd: number) => [callout(top(50, 30), 10, ["Ø20 skrz"]), callout(top(sx, sy), 3.3, ["6× Ø6,6 skrz rovnoměrně"]), callout(top(50, 30), pcd / 2, [`Ø${pcd}`])];
  const pos = (r: ReturnType<typeof checkSheet>, label: string) => r.items.find((q) => q.label === label)!;

  it("Ø40 se středem v ose pole + osy souměrnosti → poloha Díra 2 – X 70 splněná (roztečná kružnice), Y 30 osou; žádné ⚠", () => {
    const { d } = seedAt(70, 30);
    const r = checkSheet({ doc: d, views: VIEWS, annotations: [...overall(), ...axes(), ...calls(70, 30, 40)], dimensions: "smart" });
    expect([pos(r, "poloha Díra 2 – X 70").status, pos(r, "poloha Díra 2 – X 70").why]).toEqual(["ok", "roztečná kružnice Ø40"]);
    expect(pos(r, "poloha Díra 2 – Y 30").status).toBe("ok");
    expect(r.pos.ok).toBe(r.pos.total);
    expect(dimCheckLine(r)).not.toContain("chybí: poloha Díra 2");
  });
  it("bez roztečné kružnice, s jiným Ø nebo se středem mimo osu pole → poloha X 70 dál chybí (žádná falešná zelená)", () => {
    const { d } = seedAt(70, 30);
    const none = checkSheet({ doc: d, views: VIEWS, annotations: [...overall(), ...axes(), ...calls(70, 30, 40).slice(0, 2)], dimensions: "smart" });
    expect(pos(none, "poloha Díra 2 – X 70").status).toBe("missing");
    expect(dimCheckLine(none)).toContain("chybí: poloha Díra 2 – X 70");
    const wrong = checkSheet({ doc: d, views: VIEWS, annotations: [...overall(), ...axes(), ...calls(70, 30, 50)], dimensions: "smart" });
    expect(pos(wrong, "poloha Díra 2 – X 70").status).toBe("missing");
    const off = checkSheet({ doc: d, views: VIEWS, annotations: [...overall(), ...axes(), ...calls(70, 30, 40).slice(0, 2), callout(top(55, 30), 20, ["Ø40"])], dimensions: "smart" });
    expect(pos(off, "poloha Díra 2 – X 70").status).toBe("missing");
  });
  it("poloha středu pole na ose X na listu není (bez svislé osy souměrnosti a bez kóty k X 50) → X 70 chybí", () => {
    const { d } = seedAt(70, 30);
    const r = checkSheet({ doc: d, views: VIEWS, annotations: [...overall(), axes()[0], ...calls(70, 30, 40)], dimensions: "smart" });
    expect(pos(r, "poloha Díra 2 – X 70").status).toBe("missing");
    expect(pos(r, "poloha Díra 1 – X 50").status).toBe("missing");
  });
  it("výchozí díra natočená mimo osy středu (30°) → roztečná kružnice samotná nestačí, X ani Y nesplní", () => {
    const x = 50 + 20 * Math.cos(Math.PI / 6);
    const y = 30 + 20 * Math.sin(Math.PI / 6);
    const { d } = seedAt(x, y);
    const r = checkSheet({ doc: d, views: VIEWS, annotations: [...overall(), ...axes(), ...calls(x, y, 40)], dimensions: "smart" });
    const seedPos = r.items.filter((q) => q.kind === "pos" && q.source === "Díra 2");
    expect(seedPos.length).toBe(2);
    expect(seedPos.every((q) => q.status === "missing")).toBe(true);
  });
});
