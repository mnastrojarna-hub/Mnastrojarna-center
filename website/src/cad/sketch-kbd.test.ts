import { describe, expect, it } from "vitest";
import { PASTE_FIX_LIMIT, PASTE_MAX_POINTS, POINT_FIX_MAX, anchorPoints, entitiesFromPoints, fitView, fixedPoint, isDynKey, maxShift, moveAnchors, parseCoordList, pointVisible, pruneRedundant, typedAnchor } from "./sketch-kbd";
import { transformEntity, xfMove, xfRotate, xfScale } from "./sketch-ops";
import { analyzeSketch, solveSketch } from "./sketch-solver";
import { parseInput } from "./sketch-tools";
import { mmToCanvas } from "./sketch-touch";
import type { SketchConstraint, SketchDim, SketchEntity, Vec2 } from "./types";

const pts = (t: string) => {
  const r = parseCoordList(t);
  if (!r.ok) throw new Error(`parse: ${r.reason}`);
  return r.points;
};

describe("seznam souřadnic ze schránky (parseCoordList)", () => {
  it("řádky X Y, středník, desetinná čárka i tečka (příklad ze zadání)", () => {
    expect(pts("0 0\n10 5\n20;0\n30,5 8")).toEqual([[0, 0], [10, 5], [20, 0], [30.5, 8]]);
  });
  it("jeden řádek s čísly po dvojicích", () => {
    const r = parseCoordList("0 0 10 5 20 0");
    expect(r).toMatchObject({ ok: true, numbers: 6, merged: 0 });
    expect(pts("0 0 10 5 20 0")).toEqual([[0, 0], [10, 5], [20, 0]]);
  });
  it("tabulátory (Excel), CRLF, záporná čísla, exponent, znaménko minus z Wordu", () => {
    expect(pts("0\t0\r\n-12,5\t+3.25\r\n1e1\t−2\r\n")).toEqual([[0, 0], [-12.5, 3.25], [10, -2]]);
  });
  it("čárka je desetinná, pokud nejde o oddělovač: „10.5,20.3“, „1,2,3,4“ a „10, 5“ jsou dvojice", () => {
    expect(pts("10.5,20.3 30.5,40")).toEqual([[10.5, 20.3], [30.5, 40]]);
    expect(pts("1,2,3,4")).toEqual([[1, 2], [3, 4]]);
    expect(pts("10, 5\n20, 7,5")).toEqual([[10, 5], [20, 7.5]]);
    expect(pts("1,5 2,5")).toEqual([[1.5, 2.5]]);
  });
  it("tabulka CSV: řádky „x,y“ bez mezery jsou dvojice (ne desetinná čísla)", () => {
    expect(pts("0,0\n10,5\n20,0\n30,5")).toEqual([[0, 0], [10, 5], [20, 0], [30, 5]]);
    // jediný řádek „10,5“ je jedno desetinné číslo → lichý počet
    expect(parseCoordList("10,5")).toMatchObject({ ok: false, reason: "odd", numbers: 1 });
  });
  it("závorky a popisky os se ignorují", () => {
    expect(pts("(0; 0) (10; 5) [20; 0]")).toEqual([[0, 0], [10, 5], [20, 0]]);
    expect(pts("X0 Y0\nX10 Y5\nx=20 y=-3,5")).toEqual([[0, 0], [10, 5], [20, -3.5]]);
  });
  it("po sobě jdoucí shodné body se sloučí, hodnoty se zaokrouhlí na 0,0001", () => {
    const r = parseCoordList("0 0\n0 0\n10.00004 5\n10 5\n20 0");
    expect(r).toMatchObject({ ok: true, numbers: 10, merged: 2 });
    if (r.ok) expect(r.points).toEqual([[0, 0], [10, 5], [20, 0]]);
  });
  it("lichý počet čísel = chyba s počtem", () => {
    expect(parseCoordList("0 0 10 5 20")).toEqual({ ok: false, reason: "odd", numbers: 5 });
  });
  it("text, který není číslo = chyba s údajem; prázdný text = empty", () => {
    expect(parseCoordList("0 0 abc 5")).toMatchObject({ ok: false, reason: "text", token: "abc", numbers: 2 });
    expect(parseCoordList("10 5mm")).toMatchObject({ ok: false, reason: "text", token: "5mm" });
    expect(parseCoordList("  \n ")).toMatchObject({ ok: false, reason: "empty" });
    expect(parseCoordList("")).toMatchObject({ ok: false, reason: "empty" });
  });
  it("příliš dlouhý seznam se odmítne", () => {
    const t = Array.from({ length: PASTE_MAX_POINTS + 1 }, (_, i) => `${i} ${i % 7}`).join("\n");
    expect(parseCoordList(t)).toMatchObject({ ok: false, reason: "many" });
  });
});

describe("entity z řady bodů (entitiesFromPoints)", () => {
  const P: Vec2[] = [[0, 0], [10, 5], [20, 0], [30.5, 8]];
  it("lomená čára: jedna entita, každý bod ukotven → plně určená", () => {
    const r = entitiesFromPoints("polyline", P, { fixed: true });
    expect(r.entities).toHaveLength(1);
    expect(r.entities[0]).toMatchObject({ type: "polyline", closed: false, points: P });
    expect(r.constraints.map((c) => [c.type, c.refs[0].k, c.value])).toEqual(P.map((p, i) => ["fixed", `p${i}`, p]));
    const an = analyzeSketch(r.entities, r.constraints, []);
    expect(an.status).toBe("full");
    expect(an.dof).toBe(0);
  });
  it("spline: plně určený; bez ukotvení zůstává volný", () => {
    const r = entitiesFromPoints("spline", P, { fixed: true });
    expect(r.entities[0].type).toBe("spline");
    expect(analyzeSketch(r.entities, r.constraints, []).status).toBe("full");
    const free = entitiesFromPoints("spline", P, { fixed: false });
    expect(free.constraints).toHaveLength(0);
    expect(analyzeSketch(free.entities, free.constraints, []).dof).toBe(8);
  });
  it("první bod zopakovaný na konci = uzavřená křivka (bez zdvojeného bodu)", () => {
    const r = entitiesFromPoints("polyline", [[0, 0], [10, 0], [10, 10], [0, 0]], { fixed: true });
    expect(r.entities[0]).toMatchObject({ closed: true, points: [[0, 0], [10, 0], [10, 10]] });
    expect(r.constraints).toHaveLength(3);
  });
  it("řetěz úseček: totožnosti mezi úsečkami, každý bod ukotven jednou → plně určeno, nic nadbytečného", () => {
    const r = entitiesFromPoints("line", P, { fixed: true });
    expect(r.entities.map((e) => e.type)).toEqual(["line", "line", "line"]);
    expect(r.constraints.filter((c) => c.type === "coincident")).toHaveLength(2);
    expect(r.constraints.filter((c) => c.type === "fixed")).toHaveLength(4);
    const an = analyzeSketch(r.entities, r.constraints, []);
    expect(an.status).toBe("full");
    expect(an.redundant).toEqual([]);
  });
  it("uzavřený řetěz úseček: poslední bod se napojí totožností na první", () => {
    const r = entitiesFromPoints("line", [[0, 0], [10, 0], [10, 10], [0, 0]], { fixed: true });
    expect(r.entities).toHaveLength(3);
    expect(r.constraints.filter((c) => c.type === "coincident")).toHaveLength(3);
    expect(r.constraints.filter((c) => c.type === "fixed")).toHaveLength(3);
    const an = analyzeSketch(r.entities, r.constraints, []);
    expect(an.status).toBe("full");
  });
  it("bez totožností (vypnuté automatické vazby) se ukotví oba konce každé úsečky", () => {
    const r = entitiesFromPoints("line", P, { fixed: true, coincident: false });
    expect(r.constraints.every((c) => c.type === "fixed")).toBe(true);
    expect(r.constraints).toHaveLength(6);
    expect(analyzeSketch(r.entities, r.constraints, []).status).toBe("full");
  });
  it("navázání na existující úsečku (startRef) a ukotvení jen vybraných bodů", () => {
    const prev: SketchEntity = { id: "L0", type: "line", a: [-10, 0], b: [0, 0] };
    const r = entitiesFromPoints("line", [[0, 0], [10, 5], [20, 0]], { fixed: [false, true, true], startRef: { e: "L0", k: "b" } });
    expect(r.constraints[0]).toMatchObject({ type: "coincident", refs: [{ e: "L0", k: "b" }, { k: "a" }] });
    expect(r.constraints.filter((c) => c.type === "fixed")).toHaveLength(2);
    expect(analyzeSketch([prev, ...r.entities], r.constraints, []).dof).toBe(4); // volná zůstává jen původní úsečka
  });
  it("méně než dva body nic nevytvoří", () => {
    expect(entitiesFromPoints("polyline", [[1, 2]], { fixed: true })).toEqual({ entities: [], constraints: [], anchor: "none" });
  });
  it("hlásí způsob ukotvení: body / celá entita / nic", () => {
    const many = (n: number): Vec2[] => Array.from({ length: n }, (_, i) => [i * 3, Math.sin(i / 5) * 20]);
    expect(entitiesFromPoints("polyline", P, { fixed: true }).anchor).toBe("points");
    expect(entitiesFromPoints("line", P, { fixed: true }).anchor).toBe("points");
    expect(entitiesFromPoints("spline", P).anchor).toBe("none");
    // dlouhá křivka: jedna vazba „Pevně“ na celou entitu (řešič by s vazbou na každém bodě byl pomalý) – i tak plně určená
    const long = entitiesFromPoints("spline", many(POINT_FIX_MAX + 20), { fixed: true });
    expect(long.anchor).toBe("entity");
    expect(long.constraints).toHaveLength(1);
    expect(long.constraints[0]).toMatchObject({ type: "fixed", refs: [{ e: long.entities[0].id, k: "self" }] });
    expect(long.constraints[0].value).toHaveLength((POINT_FIX_MAX + 20) * 2);
    const an = analyzeSketch(long.entities, long.constraints, []);
    expect(an.status).toBe("full");
    expect(an.dof).toBe(0);
    // příliš dlouhá křivka se vloží bez ukotvení
    const huge = entitiesFromPoints("polyline", many(PASTE_FIX_LIMIT + 1), { fixed: true });
    expect(huge.anchor).toBe("none");
    expect(huge.constraints).toHaveLength(0);
    expect((huge.entities[0] as { points: Vec2[] }).points).toHaveLength(PASTE_FIX_LIMIT + 1);
  });
});

describe("ukotvení křivky zadané z klávesnice (anchorPoints, typedAnchor)", () => {
  const e: Extract<SketchEntity, { type: "spline" }> = { id: "s", type: "spline", points: [[0, 0], [10, 5], [20, 0]], closed: false };
  it("ukotví jen body zadané souřadnicemi (body z myši zůstanou volné)", () => {
    const a = anchorPoints(e, [true, false, true]);
    expect(a.mode).toBe("points");
    expect(a.constraints.map((c) => [c.refs[0].k, c.value])).toEqual([["p0", [0, 0]], ["p2", [20, 0]]]);
    expect(analyzeSketch([e], a.constraints, []).dof).toBe(2);
    expect(anchorPoints(e, false)).toEqual({ constraints: [], mode: "none" });
    expect(anchorPoints(e, true).constraints).toHaveLength(3);
  });
  it("mnoho bodů, ale jen část zadaná souřadnicemi: nad limit bodových vazeb se neukotví nic (nelze ukotvit celek)", () => {
    const pts: Vec2[] = Array.from({ length: POINT_FIX_MAX + 5 }, (_, i) => [i, i % 3]);
    const big: Extract<SketchEntity, { type: "polyline" }> = { id: "b", type: "polyline", points: pts, closed: false };
    const flags = pts.map((_, i) => i > 0);
    expect(anchorPoints(big, flags).mode).toBe("none");
    expect(anchorPoints(big, flags.map((_, i) => i < POINT_FIX_MAX)).mode).toBe("points");
    expect(anchorPoints(big, true).mode).toBe("entity");
  });
  it("typedAnchor: „x;y“ a obě pole X, Y kotví vždy; „@dx;dy“ a „délka<úhel“ jen od pevného bodu; délka / jedno pole ne", () => {
    expect(typedAnchor({ input: parseInput("30;20") })).toBe(true);
    expect(typedAnchor({ input: parseInput("30,5;20") })).toBe(true);
    expect(typedAnchor({ input: parseInput("@30;20"), prevFixed: true })).toBe(true);
    expect(typedAnchor({ input: parseInput("@30;20"), prevFixed: false })).toBe(false);
    expect(typedAnchor({ input: parseInput("50<45"), prevFixed: true })).toBe(true);
    expect(typedAnchor({ input: parseInput("50<45") })).toBe(false);
    expect(typedAnchor({ input: parseInput("50") })).toBe(false);
    expect(typedAnchor({ input: null, xTyped: true, yTyped: true })).toBe(true);
    expect(typedAnchor({ input: null, xTyped: true, yTyped: false })).toBe(false);
    expect(typedAnchor({ input: null })).toBe(false);
  });
});

describe("ukotvení zadaných bodů bez nadbytečných vazeb (pruneRedundant)", () => {
  const l1: SketchEntity = { id: "l1", type: "line", a: [0, 0], b: [10, 0] };
  const l2: SketchEntity = { id: "l2", type: "line", a: [10, 0], b: [10, 8] };
  const base: SketchConstraint[] = [fixedPoint("l1", "a", [0, 0]), fixedPoint("l1", "b", [10, 0])];
  const coinc: SketchConstraint = { id: "co", type: "coincident", refs: [{ e: "l1", k: "b" }, { e: "l2", k: "a" }] };

  it("bod napojený totožností na pevný bod druhé ukotvení nedostane; svislá úsečka mezi pevnými body nedostane „svisle“", () => {
    const fa = fixedPoint("l2", "a", [10, 0]);
    const fb = fixedPoint("l2", "b", [10, 8]);
    const vert: SketchConstraint = { id: "v", type: "vertical", refs: [{ e: "l2", k: "self" }] };
    // pořadí na vstupu jako ve skicáři: napojení, směrová vazba, ukotvení
    const kept = pruneRedundant([l1, l2], base, [], [coinc, vert, fa, fb]).constraints;
    expect(kept.map((c) => c.id)).toEqual(["co", fb.id]);
    const an = analyzeSketch([l1, l2], [...base, ...kept], []);
    expect(an.status).toBe("full");
    expect(an.redundant).toEqual([]);
  });
  it("bez totožnosti (automatické vazby vypnuté) zůstane ukotvení obou konců", () => {
    const fa = fixedPoint("l2", "a", [10, 0]);
    const fb = fixedPoint("l2", "b", [10, 8]);
    const kept = pruneRedundant([l1, l2], base, [], [fa, fb]).constraints;
    expect(kept).toHaveLength(2);
    expect(analyzeSketch([l1, l2], [...base, ...kept], []).status).toBe("full");
  });
  it("první bod zadaný souřadnicemi, druhý myší: ukotví se jen první, „vodorovně“ zůstane", () => {
    const e: SketchEntity = { id: "m", type: "line", a: [5, 5], b: [25, 5] };
    const fa = fixedPoint("m", "a", [5, 5]);
    const hor: SketchConstraint = { id: "h", type: "horizontal", refs: [{ e: "m", k: "self" }] };
    const kept = pruneRedundant([e], [], [], [hor, fa]).constraints;
    expect(kept.map((c) => c.type).sort()).toEqual(["fixed", "horizontal"]);
    expect(analyzeSketch([e], kept, []).dof).toBe(1);
  });
  it("kóta, kterou pevné body dělají nadbytečnou, se nepřidá (oblouk středem: střed a začátek pevné + kóta poloměru)", () => {
    const arc: SketchEntity = { id: "a", type: "arc", a: [10, 0], b: [0, 10], c: [-10, 0] };
    const fc = fixedPoint("a", "center", [0, 0]);
    const fa = fixedPoint("a", "a", [10, 0]);
    const rad: SketchDim = { id: "r", type: "radius", refs: [{ e: "a", k: "self" }], value: 10, driving: true };
    const kept = pruneRedundant([arc], [], [], [fc, fa], [rad]);
    expect(kept.constraints).toHaveLength(2);
    expect(kept.dims).toEqual([]);
    expect(analyzeSketch([arc], kept.constraints, kept.dims).status).toBe("under"); // zbývá úhel konce oblouku
    // kóta, která nadbytečná není, zůstane: úsečka s pevným začátkem a kótou délky
    const ln: SketchEntity = { id: "m", type: "line", a: [0, 0], b: [30, 40] };
    const len: SketchDim = { id: "len", type: "length", refs: [{ e: "m", k: "self" }], value: 50, driving: true };
    const k2 = pruneRedundant([ln], [], [], [fixedPoint("m", "a", [0, 0])], [len]);
    expect(k2.dims).toEqual([len]);
    expect(k2.constraints).toHaveLength(1);
  });
  it("tři úsečky a spline zadané jen souřadnicemi = „Plně určeno“ (akceptační příklad)", () => {
    const chain = entitiesFromPoints("line", [[0, 0], [40, 0], [40, 30], [0, 30]], { fixed: true });
    const sp = entitiesFromPoints("spline", [[0, 30], [10, 45], [25, 38], [40, 30]], { fixed: true });
    const entities = [...chain.entities, ...sp.entities];
    const cons = [...chain.constraints, ...sp.constraints];
    const an = analyzeSketch(entities, cons, []);
    expect(an.status).toBe("full");
    expect(an.dof).toBe(0);
    expect([...an.states.values()].every((s) => s === "full")).toBe(true);
    // řešič s pevnými body nic neposune
    const solved = solveSketch(entities, cons, []);
    expect(solved.ok).toBe(true);
    expect(solved.entities).toEqual(entities);
  });
  it("pevný bod drží: řešič vrátí posunutý bod zpět na zadané souřadnice", () => {
    const e: SketchEntity = { id: "s", type: "spline", points: [[0, 0], [10, 5], [20, 0]], closed: false };
    const cons = [0, 1, 2].map((i) => fixedPoint("s", `p${i}`, (e as { points: Vec2[] }).points[i]));
    const moved: SketchEntity = { ...e, points: [[0, 0], [13, 9], [20, 0]] };
    const res = solveSketch([moved], cons, []);
    expect(res.ok).toBe(true);
    const out = res.entities[0] as { points: Vec2[] };
    expect(out.points[1][0]).toBeCloseTo(10, 6);
    expect(out.points[1][1]).toBeCloseTo(5, 6);
  });
});

describe("pohled po zadání bodu mimo plátno (pointVisible, fitView)", () => {
  const size = { w: 800, h: 600 };
  const view = { cx: 0, cy: 0, scale: 4 };
  it("bod uvnitř plátna je vidět, bod za okrajem a v okrajovém pásu ne", () => {
    expect(pointVisible(view, size, [0, 0])).toBe(true);
    expect(pointVisible(view, size, [90, 60])).toBe(true); // 760, 60 px
    expect(pointVisible(view, size, [99, 0])).toBe(false); // 796 px – v okrajovém pásu 24 px
    expect(pointVisible(view, size, [500, 0])).toBe(false);
    expect(pointVisible(view, size, [0, -300])).toBe(false);
  });
  it("fitView zobrazí všechny body s okrajem a zachová poměr stran", () => {
    const all: Vec2[] = [[0, 0], [500, 0], [500, 120], [-40, 60]];
    const v = fitView(all, size)!;
    expect(v.cx).toBeCloseTo(230, 9);
    expect(v.cy).toBeCloseTo(60, 9);
    expect(v.scale).toBeCloseTo(Math.min(800 / (540 * 1.5), 600 / (120 * 1.5)), 9);
    for (const p of all) expect(pointVisible(v, size, p)).toBe(true);
    // krajní body leží souměrně kolem středu plátna
    expect(mmToCanvas(v, size, [-40, 60])[0] + mmToCanvas(v, size, [500, 60])[0]).toBeCloseTo(800, 6);
  });
  it("jediný bod / body na přímce: rozumné měřítko (rozsah 50 mm), bez bodů null", () => {
    expect(fitView([], size)).toBeNull();
    const one = fitView([[100, 100]], size)!;
    expect(one).toMatchObject({ cx: 100, cy: 100 });
    expect(one.scale).toBeCloseTo(600 / 75, 9);
    const row = fitView([[0, 7], [1000, 7]], size)!;
    expect(row.scale).toBeCloseTo(800 / 1500, 9);
    expect(pointVisible(row, size, [1000, 7])).toBe(true);
  });
});

describe("opravy po kontrole: vložení z Excelu, AltGr, přesun ukotvených entit", () => {
  it("oddělovač tisíců jako pevná mezera (český Excel) nerozdělí číslo", () => {
    expect(pts("1 234,5\t1 200\n10\t20")).toEqual([[1234.5, 1200], [10, 20]]);
    expect(pts("1 234 567 2 000")).toEqual([[1234567, 2000]]);
    // obyčejná mezera a tabulátor dál oddělují čísla; pevná mezera mimo trojici číslic také
    expect(pts("1 234\n10 20")).toEqual([[1, 234], [10, 20]]);
    expect(pts("10 20")).toEqual([[10, 20]]);
  });
  it("číselné zadání: znaky přes AltGr (Ctrl+Alt) a Option, zkratky s Ctrl / Cmd ne", () => {
    const k = (key: string, m: { ctrl?: boolean; alt?: boolean; meta?: boolean; altGr?: boolean } = {}) =>
      isDynKey({ key, ctrlKey: !!m.ctrl, altKey: !!m.alt, metaKey: !!m.meta, getModifierState: (s: string) => s === "AltGraph" && !!m.altGr });
    expect(k("5")).toBe(true);
    expect(k("@", { ctrl: true, alt: true })).toBe(true); // Windows, AltGr+V na české klávesnici
    expect(k("<", { ctrl: true, alt: true, altGr: true })).toBe(true);
    expect(k("@", { alt: true })).toBe(true); // Option na Macu
    expect(k("2", { ctrl: true, alt: true, altGr: true })).toBe(true);
    expect(k("2", { ctrl: true, alt: true })).toBe(false); // Ctrl+Alt+2 bez AltGr = zkratka
    expect(k("1", { alt: true })).toBe(false);
    expect(k("-", { ctrl: true })).toBe(false); // Ctrl+− = zoom prohlížeče
    expect(k("@", { meta: true })).toBe(false);
    expect(k("a", { ctrl: true, alt: true, altGr: true })).toBe(false);
  });
  it("přesun / otočení / změna měřítka: vazba „Pevně“ jde s entitou, řešič ji nevrátí", () => {
    const line: SketchEntity = { id: "L", type: "line", a: [0, 0], b: [30, 10] };
    const pl: SketchEntity = { id: "P", type: "polyline", points: [[0, 0], [10, 0], [10, 10]], closed: false };
    const free: SketchEntity = { id: "F", type: "line", a: [100, 0], b: [100, 10] };
    const cons: SketchConstraint[] = [fixedPoint("L", "a", [0, 0]), fixedPoint("L", "b", [30, 10]), { id: "s", type: "fixed", refs: [{ e: "P", k: "self" }], value: [0, 0, 10, 0, 10, 10] }, fixedPoint("F", "a", [100, 0])];
    const ids = new Set(["L", "P"]);
    const d: Vec2 = [20, 20];
    const moved = [line, pl, free].map((e) => (ids.has(e.id) ? transformEntity(e, xfMove(d)) : e));
    // bez úpravy vazeb řešič úsečku vrátí na místo (původní chyba)
    expect(maxShift(solveSketch(moved, cons).entities, moved, ids)).toBeGreaterThan(10);
    const next = moveAnchors(cons, moved, ids);
    const res = solveSketch(moved, next);
    expect(res.ok).toBe(true);
    expect(maxShift(res.entities, moved, ids)).toBeLessThan(1e-6);
    expect(next[0].value).toEqual([20, 20]);
    expect(next[1].value).toEqual([50, 30]);
    expect(next[2].value).toEqual([20, 20, 30, 20, 30, 30]);
    expect(next[3]).toBe(cons[3]); // nevybraná entita: vazba beze změny
    const rot = [line].map((e) => transformEntity(e, xfRotate([0, 0], 90)));
    expect(moveAnchors(cons, rot, new Set(["L"]))[1].value!.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([-10, 30]);
    const sc = [line].map((e) => transformEntity(e, xfScale([0, 0], 2)));
    expect(moveAnchors(cons, sc, new Set(["L"]))[1].value).toEqual([60, 20]);
  });
});
