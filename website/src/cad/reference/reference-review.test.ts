/**
 * Předloha – regresní testy nálezů revize (vygenerované výkresy, žádná data zákazníka): vlastnosti podřízených entit
 * náhradní grafiky (hladina / typ čáry / tloušťka), tenké a pomocné čáry mimo obrys tělesa, značka středu normálie
 * mimo díry, měřítko pohledu bez kót, rámeček listu z čar, neviditelné entity v DXF R12, DIMLFAC kóty v poznámce
 * importu, kontrola kót s virtuálním rohem a se zastaralým výsledkem, výběr listu u výkresu více dílů, značky výsledků,
 * zadaný pohled N.M a měřítko, přirozené zápisy příkazů, razítko AutoCAD Mechanical, sloupce kusovníku.
 */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import "../draft/index";
import { setLang } from "../i18n";
import { makeDrawing, type DrawingOptions } from "../drawing";
import { draftFromFile, draftToDxfFile } from "../draft/io/files";
import { draftToR12 } from "../draft/io/r12";
import { proxyToEntities } from "../draft/io/proxy";
import type { DraftEntity, DraftModel, Vec2 } from "../draft/model";
import type { CadDoc } from "../types";
import { checkDims, compareGeo, modelGeo, refGeo, type ModelEnt } from "./compare";
import { extractReference, viewGeometry } from "./extract";
import { flatten, lineClass } from "./geom";
import { parseReferenceLine } from "./parse";
import { runReferenceCmd, type RefEnv } from "./run";
import { titleOf } from "./sheets";
import { compareMark, extractLines, statusLines } from "./text";
import { PLAN_C, plateReference } from "./__fixtures__/plate-ref";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
  setLang("cs");
}, 60_000);

type S = r.Shape3D;
const H4: Vec2[] = [[-45, -25], [45, -25], [-45, 25], [45, 25]];
/** deska 120 × 80 × 20 (střed v počátku), díry Ø8 v (±45, ±25), středová díra; `cham` = sražení svislých hran */
const plate = (o: { cham?: number; center?: number; extra?: Vec2[] } = {}): S => {
  let s = r.makeBox([-60, -40, 0], [60, 40, 20]) as S;
  if (o.cham) s = s.chamfer(o.cham, (e) => e.inDirection("Z")) as S;
  s = s.cut(r.makeCylinder((o.center ?? 20) / 2, 40, [0, 0, -10], [0, 0, 1]));
  for (const [x, y] of H4) s = s.cut(r.makeCylinder(4, 40, [x, y, -10], [0, 0, 1]));
  for (const [x, y] of o.extra ?? []) s = s.cut(r.makeCylinder(6, 40, [x, y, -10], [0, 0, 1]));
  return s;
};
const VIEWS: Partial<DrawingOptions> = { views: { front: true, top: true, left: true, right: true, back: true, bottom: true, iso: false }, hidden: true, dimensions: "none", centerLines: false, balloons: false, scale: 1 };
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const reread = (m: DraftModel, name = "x.dxf") => draftFromFile(name, draftToDxfFile(m).data);
const doc0 = (name = "Deska A"): CadDoc => ({ app: "mnastrojarna-cad", version: 2, name, material: "ocel", features: [{ id: "b", name: "Kvádr", type: "box", size: [120, 80, 20] } as never] });
const envOf = (files: Map<string, Uint8Array>, shape: () => S): RefEnv => ({
  drawing: async (_d, meta, opts) => makeDrawing(shape(), meta as never, opts as Partial<DrawingOptions>) as never,
  file: (n) => {
    for (const [k, v] of files) if (k.toLowerCase() === n.toLowerCase() || k.replace(/\.[^.]+$/, "").toLowerCase() === n.toLowerCase()) return { name: k, bytes: v };
    return null;
  },
  attached: () => [...files.keys()].join(", "),
  load: { worker: false },
});
const run = async (doc: CadDoc, env: RefEnv, lines: string) => {
  const log: string[] = [];
  for (const l of lines.split("\n")) {
    const c = parseReferenceLine(l)!;
    const res = await runReferenceCmd(c, doc, env);
    if (res.doc) doc = res.doc;
    log.push(...res.log);
  }
  return { doc, log };
};

describe("náhradní grafika: hladina, typ čáry a tloušťka podřízených entit (AutoCAD Mechanical)", () => {
  it("SubentLayer / SubentLineType jsou indexy do tabulek výkresu, SubentLineWeight setiny mm; bez tabulek hladina 0", () => {
    const tables = { layers: ["0", "AM_0", "AM_4", "AM_7", "AM_9"], linetypes: ["Continuous", "CENTER2", undefined, "ByBlock"] };
    const C = (x: number, y: number, rad: number) => ({ graphicsType: 2, center: { x, y, z: 0 }, radius: rad, normal: { x: 0, y: 0, z: 1 } });
    const geoms = [
      { graphicsType: 16, value: 2 }, { graphicsType: 18, value: 32767 }, { graphicsType: 23, value: 4294967295 }, { graphicsType: 4, center: { x: 0, y: 0, z: 0 }, radius: 4, normal: { x: 0, y: 0, z: 1 }, startVectorDirection: { x: 1, y: 0, z: 0 }, sweepAngle: 5.5 },
      { graphicsType: 16, value: 1 }, C(0, 0, 3.3),
      { graphicsType: 16, value: 3 }, { graphicsType: 18, value: 1 }, { graphicsType: 6, points: [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }] },
      { graphicsType: 16, value: 4 }, { graphicsType: 18, value: 32766 }, { graphicsType: 23, value: 0 }, C(0, 0, 1),
      { graphicsType: 16, value: 99 }, { graphicsType: 23, value: 50 }, C(5, 5, 2),
    ];
    const e = proxyToEntities(geoms, new TextDecoder(), tables).entities as unknown as { type: string; layer: string; linetype?: string; lineweight?: unknown; r?: number }[];
    expect(e.map((x) => [x.type, x.layer, x.linetype ?? "", x.lineweight ?? ""])).toEqual([
      ["arc", "AM_4", "", ""],
      ["circle", "AM_0", "", ""],
      ["line", "AM_7", "CENTER2", ""],
      ["circle", "AM_9", "ByBlock", 0],
      ["circle", "0", "ByBlock", 0.5],
    ]);
    expect(proxyToEntities(geoms, new TextDecoder()).entities.every((x) => (x as { layer: string }).layer === "0")).toBe(true);
  });
});

/** model s normálií závitu (STDPART2D) v anonymním bloku: obrys / ¾ závitu / osy / značka středu Ø2 na AM_9 */
function stdPartModel(): DraftModel {
  const m = clone(plateReference());
  const L = (name: string, lw: number | "Default", lt = "Continuous") => ({ name, color: 7, linetype: lt, lineweight: lw, on: true, frozen: false, locked: false, plot: true });
  m.layers.push(L("AM_0", 0.4), L("AM_4", 0.2), L("AM_5", 0.2), L("AM_7", 0.2, "CENTER"), L("AM_9", 0), L("TENKA", 0.18), L("BEZ", "Default"));
  const [cx, cy] = PLAN_C;
  const c: Vec2 = [cx + 30, cy + 10];
  const id = (n: number) => `s${n}`;
  m.blocks!.push({
    name: "*U900",
    base: [0, 0],
    anonymous: true,
    entities: [
      { id: id(1), type: "circle", layer: "AM_0", c, r: 3.3235 },
      { id: id(2), type: "arc", layer: "AM_4", c, r: 4, a0: 0, a1: 315 },
      { id: id(3), type: "line", layer: "AM_7", a: [c[0] - 6, c[1]], b: [c[0] + 6, c[1]] },
      { id: id(4), type: "circle", layer: "AM_9", c, r: 1 },
    ] as unknown as DraftEntity[],
  } as never);
  m.entities.push({ id: "s0", type: "insert", layer: "AM_0", block: "*U900", p: [0, 0], sx: 1, sy: 1, rot: 0, ext: { dxf: "STDPART2D", acm: { cls: "STDPART2D", h: "900", type: "FEAT/ITHREAD/THRGH", branch: "/AMSTD/DIN/FEAT/ITHREAD/THRGH/X/T", std: "DIN", view: "T", desig: "DIN 13 T1 - M8" } } } as unknown as DraftEntity);
  // úhlopříčka rovinné plochy (tenká čára výslovnou tloušťkou), čára bez tloušťky (výchozí)
  m.entities.push({ id: "s5", type: "line", layer: "TENKA", a: [cx - 60, cy - 40], b: [cx - 50, cy - 30] } as unknown as DraftEntity);
  m.entities.push({ id: "s6", type: "line", layer: "BEZ", a: [cx - 60, cy + 40], b: [cx - 50, cy + 30] } as unknown as DraftEntity);
  m.entities.push({ id: "s7", type: "line", layer: "AM_5", a: [cx + 60, cy - 40], b: [cx + 50, cy - 30] } as unknown as DraftEntity);
  return m;
}

describe("druh čáry: tenké a pomocné čáry nejsou hranami tělesa; normálie bez značky středu Ø2", () => {
  it("lineClass: hladiny anotací, tloušťka pod 0,7 × obrysu, hladina 0 v bloku podle vložení", () => {
    const m = stdPartModel();
    const cls = (id: string) => lineClass(m, m.entities.find((e) => e.id === id)!);
    expect(cls("s5")).toBe("thin"); // 0,18 mm < 0,7 × 0,5 mm (OBRYS)
    expect(cls("s6")).toBe("contour"); // výchozí tloušťka = neznámá → obrys
    expect(cls("s7")).toBe("thin"); // AM_5
    const ln = (layer: string) => ({ id: "x", type: "line", layer, a: [0, 0], b: [1, 0] }) as unknown as DraftEntity;
    expect(lineClass(m, ln("KOTY"))).toBe("thin");
    expect(lineClass(m, ln("0"), { layer: "OSY" })).toBe("center");
    const g = flatten(m, {}).geom.filter((x) => x.acm === "STDPART2D");
    // obrys jádra = obrys, ¾ závitu = tenká (i u skrytého závitu), osa = osa, značka středu (AM_9, 0 mm) = tenká
    expect(g.map((x) => [x.layer, x.lt, x.thread])).toEqual([["AM_0", "contour", true], ["AM_4", "thin", true], ["AM_7", "center", true], ["AM_9", "thin", true]]);
  });

  it("výtah děr: normálie závitu bez Ø2 značky středu; pohled bez tenkých čar (rozměr obrysu)", () => {
    const ex = extractReference(stdPartModel(), { name: "x.dxf", format: "dxf" });
    const h = ex.holes.find((x) => x.kind === "thread")!;
    expect(h.dias).toEqual([6.647, 8]);
    expect(extractLines(ex, "holes").find((l) => /závit/.test(l))).not.toMatch(/Ø2\//);
    // pohled půdorysu je pořád 120 × 80 (tenké úhlopříčky ani osy ho nezvětší)
    expect(ex.views.map((v) => [v.w, v.h])).toEqual([[120, 80], [120, 20]]);
  });
});

/** předloha v měřítku listu (geometrie × 0,5, DIMLFAC 2 u každé kóty, razítko 1:2) – export SolidWorks / Inventor */
function paperScale(): DraftModel {
  const m = clone(plateReference());
  const [cx, cy] = PLAN_C;
  const S = (p: Vec2): Vec2 => [cx + (p[0] - cx) * 0.5, cy + (p[1] - cy) * 0.5];
  for (const e of m.entities as unknown as Record<string, unknown>[]) {
    if (e.type === "insert" || e.layer === "TAB" || e.layer === "POZN") continue;
    for (const k of ["a", "b", "c", "p", "p1", "p2", "line", "chord", "far", "textPos"]) if (Array.isArray(e[k])) e[k] = S(e[k] as Vec2);
    if (typeof e.r === "number") e.r = (e.r as number) * 0.5;
    if (e.type === "dimension") e.overrides = { ...((e.overrides as object) ?? {}), dimlfac: 2 };
    if (Array.isArray(e.attribs)) continue;
  }
  const t = m.entities.find((e) => e.type === "insert" && (e as { attribs?: unknown[] }).attribs) as unknown as { attribs: { tag: string; value: string }[] };
  t.attribs.find((a) => a.tag === "MERITKO")!.value = "1:2";
  return m;
}

describe("měřítko pohledu bez použitelné kóty, DIMLFAC kóty v poznámce importu", () => {
  it("pohled bez kót dostane měřítko z kót listu; porovnání nárysu 100 %; žádné falešné „text ≠ geometrie“", async () => {
    const back = reread(paperScale(), "deska-paper.dxf");
    expect(back.note.dimText?.map((d) => d.shown)).toEqual(["19.8"]);
    const ex = extractReference(back.model, { name: "p.dxf", format: "dxf" });
    expect(ex.views.map((v) => [v.geomScale, v.scaleFrom, Math.round(v.w / v.geomScale), Math.round(v.h / v.geomScale)])).toEqual([
      [0.5, "dims", 120, 80],
      [0.5, "sheet-dims", 120, 20],
    ]);
    const files = new Map([["deska-paper.dxf", draftToDxfFile(paperScale()).data]]);
    const env = envOf(files, () => plate());
    const { log } = await run(doc0(), env, 'předloha "deska-paper"\nporovnat předloha pohled přední\nporovnat předloha pohled přední 1.2 měřítko 1:2');
    expect(log.find((l) => /porovnání pohled přední × předloha 1\.2/.test(l))).toMatch(/^✓ .*pokryta modelem 100 %, model pokryt předlohou 100 %/);
    expect(log.some((l) => /zadané příkazem: 0,5 jednotek/.test(l))).toBe(true);
    expect(log.some((l) => /zadaný ručně – bez kontroly velikosti/.test(l))).toBe(true);
  }, 60_000);
});

/** rámeček listu a vnitřní rámeček z čar (bez bloku formátu); `n` listů vedle sebe po 500 mm */
function linesSheets(n: number): DraftModel {
  const base = clone(plateReference());
  const border = base.blocks!.find((b) => b.name === "A3")!;
  const one = base.entities.filter((e) => !(e.type === "insert" && (e as { block: string }).block === "A3"));
  const ents: DraftEntity[] = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const dx = i * 500;
    const mv = (p: Vec2): Vec2 => [p[0] + dx, p[1]];
    for (const e of [...border.entities, ...one]) {
      const c = clone(e) as unknown as Record<string, unknown>;
      c.id = `k${++k}`;
      for (const f of ["a", "b", "c", "p", "p1", "p2", "line", "chord", "far", "textPos"]) if (Array.isArray(c[f])) c[f] = mv(c[f] as Vec2);
      if (Array.isArray(c.attribs)) for (const a of c.attribs as { p: Vec2 }[]) a.p = mv(a.p);
      ents.push(c as unknown as DraftEntity);
    }
  }
  return { ...base, entities: ents, seq: k + 10 };
}

describe("listy s rámečkem z čar", () => {
  it("jeden list A3 (vnější i vnitřní rámeček z čar), dva listy vedle sebe = dva listy, pohledy a kusovník na každém", () => {
    const one = extractReference(reread(linesSheets(1)).model, { name: "l.dxf", format: "dxf" });
    expect(one.sheets.map((s) => [s.size, s.source, s.scale])).toEqual([["A3", "rect", "1:1"]]);
    expect(one.views.map((v) => [v.id, v.w, v.h])).toEqual([["1.1", 120, 80], ["1.2", 120, 20]]);
    const two = extractReference(reread(linesSheets(2)).model, { name: "l2.dxf", format: "dxf" });
    expect(two.sheets.map((s) => [s.n, s.size])).toEqual([[1, "A3"], [2, "A3"]]);
    expect(two.views.map((v) => [v.id, v.w, v.h])).toEqual([["1.1", 120, 80], ["1.2", 120, 20], ["2.1", 120, 80], ["2.2", 120, 20]]);
    expect(two.boms.map((b) => [b.sheet, b.rows.length])).toEqual([[1, 1], [2, 1]]);
  });
});

describe("DXF R12: neviditelné entity", () => {
  it("se nezapíšou (R12 nemá příznak viditelnosti) a export to řekne", () => {
    const m = clone(plateReference());
    m.entities.push({ id: "i1", type: "line", layer: "OBRYS", a: [20000, 20000], b: [20010, 20000], ext: { invisible: true } } as unknown as DraftEntity);
    m.entities.push({ id: "i2", type: "text", layer: "OBRYS", p: [30, 30], h: 2.5, s: "!GENTITLE-TEST", ext: { invisible: true } } as unknown as DraftEntity);
    const out = draftToR12(m);
    expect(out.text).not.toMatch(/GENTITLE-TEST/);
    expect(out.text).not.toMatch(/\r\n20000(\.0+)?\r\n/);
    expect(out.warnings.some((w) => /2 neviditelných entit se nezapsalo/.test(w))).toBe(true);
  });
});

/** deska se sraženými rohy 5×45° v půdorysu a souřadnicovými kótami od virtuálního rohu */
function ordinateRef(): DraftModel {
  const m = clone(plateReference());
  const [cx, cy] = PLAN_C;
  const x0 = cx - 60;
  const y0 = cy - 40;
  // obrys půdorysu (4 čáry) a lineární kóty půdorysu pryč; nárys (y 120–140) zůstane
  m.entities = m.entities.filter((e) => {
    const x = e as unknown as { type: string; a?: Vec2; b?: Vec2; kind?: string; p1?: Vec2; layer: string };
    if (x.type === "line" && x.layer === "OBRYS") return Math.min(x.a![1], x.b![1]) < y0 - 1e-6;
    return !(x.type === "dimension" && x.kind === "linear" && x.p1![1] >= y0 - 1e-6);
  });
  const c = 5;
  const P: Vec2[] = [[x0 + c, y0], [x0 + 120 - c, y0], [x0 + 120, y0 + c], [x0 + 120, y0 + 80 - c], [x0 + 120 - c, y0 + 80], [x0 + c, y0 + 80], [x0, y0 + 80 - c], [x0, y0 + c]];
  let k = 0;
  P.forEach((p, i) => m.entities.push({ id: `o${++k}`, type: "line", layer: "OBRYS", a: p, b: P[(i + 1) % P.length] } as unknown as DraftEntity));
  const ord = (x: boolean, v: number) => m.entities.push({ id: `o${++k}`, type: "dimension", layer: "KOTY", kind: "ordinate", origin: [x0, y0], p1: x ? [x0 + v, y0 + (v === 120 ? 0 : 15)] : [x0 + (v === 80 ? 0 : 15), y0 + v], p2: x ? [x0 + v, y0 - 15] : [x0 - 15, y0 + v], ...(x ? { xAxis: true } : {}) } as unknown as DraftEntity);
  for (const v of [15, 105, 120]) ord(true, v);
  for (const v of [15, 65, 80]) ord(false, v);
  m.seq = (m.seq ?? 0) + k + 1;
  return m;
}

describe("kontrola kót: virtuální roh, značky výsledku, rozpor předlohy, zastaralé výsledky", () => {
  it("souřadnicové kóty od virtuálního rohu sražené desky se změří (✓), hlavička ✓ až když se změří vše", () => {
    const b = reread(ordinateRef());
    const ex = extractReference(b.model, { name: "o.dxf", format: "dxf" });
    const v = ex.views.find((x) => x.id === "1.1")!;
    const top = modelGeo(makeDrawing(plate({ cham: 5 }), { name: "D", material: "S" }, VIEWS).views.find((x) => x.key === "top")!.ents as ModelEnt[]);
    const cmp = compareGeo(refGeo(viewGeometry(b.model, ex, "1.1"), v), top, { view: "top", refView: "1.1" })!;
    expect([cmp.coverage, cmp.modelCoverage]).toEqual([100, 100]);
    const rs = checkDims(ex.dims.filter((d) => d.view === "1.1"), v, top, cmp.align);
    const ord = rs.filter((x) => x.dim.kind === "ordinate");
    expect(ord.map((x) => [x.dim.value, x.ok, x.model])).toEqual([[15, true, 15], [105, true, 105], [120, true, 120], [15, true, 15], [65, true, 65], [80, true, 80]]);
    expect(ord.every((x) => /virtuálním rohu/.test(x.note ?? ""))).toBe(true);
    expect(rs.every((x) => x.how !== "none")).toBe(true);
  });

  it("výkres dvou dílů: kontroluje se jen list, který modelu odpovídá; rozpor předlohy 19.8 × 20 = ✗; zastaralé po změně modelu", async () => {
    // druhý list: tentýž výkres posunutý o 500 mm, díl B se středovou dírou Ø16
    const m = linesSheets(2);
    const [cx, cy] = PLAN_C;
    for (const e of m.entities as unknown as Record<string, unknown>[]) {
      if (e.type === "circle" && e.r === 10 && Math.abs((e.c as Vec2)[0] - cx - 500) < 1e-6) e.r = 8;
      if (e.type === "dimension" && e.kind === "diameter" && e.text === "<> H7" && (e.chord as Vec2)[0] > 500) {
        e.chord = [cx + 500 + 5.656854, cy + 5.656854];
        e.far = [cx + 500 - 5.656854, cy - 5.656854];
      }
    }
    const files = new Map([["dva.dxf", draftToDxfFile(m).data]]);
    let shape = plate();
    const env = envOf(files, () => shape);
    const a = await run(doc0(), env, 'předloha "dva.dxf"\npředloha kontrola kót');
    expect(a.log.filter((l) => /kontrola kót předlohy 2\./.test(l))).toEqual([]);
    expect(a.log.some((l) => /„Ø16 H7“/.test(l))).toBe(false);
    expect(a.log.some((l) => /^· kontrolován list 1 .*listů 2 se nekontrolovaly/.test(l))).toBe(true);
    expect(a.log.find((l) => /^✗ kóta .*19\.8/.test(l))).toMatch(/^✗ kóta \w+ „19\.8“ .*předloha si odporuje/);
    expect(a.doc.reference?.checks?.dims).toMatchObject({ ok: 6, bad: 1, skipped: 0, sheet: 1 });
    // kontrola listu 2 jen na požádání
    const b = await run(a.doc, env, "kontrola kót list 2");
    expect(b.log.some((l) => /^✗ kóta \w+ „Ø16 H7“ .*model 20/.test(l))).toBe(true);
    // porovnání a kontrola platí jen pro model, se kterým proběhly
    const c = await run(b.doc, env, "porovnat předloha pohled horní 1.1\npředloha stav");
    expect(c.log.find((l) => /poslední porovnání/.test(l))).toMatch(/^✓ /);
    shape = plate({ center: 30 });
    const changed: CadDoc = { ...c.doc, features: [...c.doc.features, { id: "h", name: "Díra", type: "hole" } as never] };
    const d = await run(changed, env, "předloha stav");
    expect(d.log.find((l) => /poslední porovnání/.test(l))).toMatch(/^⚠ .*ZASTARALÉ/);
    expect(d.log.find((l) => /poslední kontrola kót/.test(l))).toMatch(/^⚠ .*ZASTARALÉ/);
  }, 120_000);

  it("model s dírami navíc: porovnání ✗ (ne ⚠), i když je předloha pokrytá celá", async () => {
    expect(compareMark({ coverage: 100, modelCoverage: 65.1 })).toBe("✗");
    expect(compareMark({ coverage: 95, modelCoverage: 92 })).toBe("⚠");
    expect(compareMark({ coverage: 100, modelCoverage: 99.6 })).toBe("✓");
    const files = new Map([["deska.dxf", draftToDxfFile(plateReference()).data]]);
    const env = envOf(files, () => plate({ extra: [[-25, 0], [25, 0], [0, 25], [0, -25]] }));
    const { log } = await run(doc0(), env, 'předloha "deska.dxf"\nporovnat předloha pohled horní');
    expect(log.find((l) => /porovnání pohled horní/.test(l))).toMatch(/^✗ .*předloha pokryta modelem 100 %, model pokryt předlohou \d/);
    expect(log.filter((l) => /^· navíc v modelu/.test(l)).length).toBe(4);
  }, 60_000);

  it("kontrola kót bez předlohy: vysvětlí rozdíl proti kontrole kót výkresu (výkres stav)", async () => {
    await expect(runReferenceCmd(parseReferenceLine("kontrola kót")!, doc0(), envOf(new Map(), () => plate()))).rejects.toThrow(/výkres stav – řádek „Kontrola kót“/);
    expect(parseReferenceLine("Maßprüfung")).toEqual({ kind: "checkDims" });
  });
});

describe("zápisy příkazů a výtah", () => {
  it("přirozené zápisy CS / EN / DE, název bez přípony, třetí slovo není data souboru", () => {
    expect(parseReferenceLine('předloha "deska-12.dxf" stav')).toEqual({ kind: "load", name: "deska-12.dxf" });
    expect(parseReferenceLine('předloha "deska-12"')).toEqual({ kind: "load", name: "deska-12" });
    expect(parseReferenceLine("reference check dimensions")).toEqual({ kind: "checkDims" });
    expect(parseReferenceLine("předloha kontrola kót pohled horní")).toEqual({ kind: "checkDims", view: "top" });
    expect(parseReferenceLine("kontrola kót předlohy")).toEqual({ kind: "checkDims" });
    expect(parseReferenceLine("vorlage maße prüfen blatt 2")).toEqual({ kind: "checkDims", sheet: 2 });
    expect(parseReferenceLine("dimension check")).toEqual({ kind: "checkDims" });
    expect(parseReferenceLine("compare reference top view")).toEqual({ kind: "compare", view: "top" });
    expect(parseReferenceLine("porovnat s předlohou pohled horní měřítko 1:2 se skrytými")).toEqual({ kind: "compare", view: "top", scale: 0.5, hidden: true });
    expect(parseReferenceLine("compare with reference view front scale 2:1")).toEqual({ kind: "compare", view: "front", scale: 2 });
    expect(parseReferenceLine("vergleichen mit vorlage ansicht oben")).toEqual({ kind: "compare", view: "top" });
    expect(() => parseReferenceLine('předloha "deska-12.dxf" kontrola')).toThrow(/za názvem souboru smí být jen data souboru/);
    expect(() => parseReferenceLine("porovnat předloha pohled horní měřítko x")).toThrow(/měřítko: 1:2/);
    // jiné příkazy „porovnat / kontrola …“ (porovnání s referenčním STEP) nepatří předloze
    expect(parseReferenceLine('porovnat "ref.step"')).toBeNull();
  });

  it("razítko AutoCAD Mechanical: název z GEN-TITLE-DES1 / DES2, GEN-TITLE-NAME = kreslil", () => {
    const t = titleOf({ id: "t", type: "insert", layer: "0", block: "FAM-SEST", attribs: [{ tag: "GEN-TITLE-NAME", value: "J. Novák" }, { tag: "GEN-TITLE-DES2", value: "SESTAVA X" }, { tag: "GEN-TITLE-NR", value: "RD-100" }] } as never, 1);
    expect([t.name, t.author, t.number]).toEqual(["SESTAVA X", "J. Novák", "RD-100"]);
    const d = titleOf({ id: "t", type: "insert", layer: "0", block: "X", attribs: [{ tag: "GEN-TITLE-DES2", value: "B" }, { tag: "GEN-TITLE-DES1", value: "A" }] } as never, 1);
    expect(d.name).toBe("A");
  });

  it("stav v EN / DE: číslo výkresu přeložené (dřív „č.“ bez překladu)", () => {
    const ex = extractReference(reread(plateReference()).model, { name: "d.dxf", format: "dxf" });
    const st = { info: { name: "d.dxf", format: "dxf" as const, bytes: 1000, id: "x", summary: {} }, model: reread(plateReference()).model, extract: ex, note: "" };
    try {
      setLang("en");
      expect(statusLines(st).find((l) => /RD-001/.test(l))).toMatch(/, drawing no\. RD-001/);
      setLang("de");
      expect(statusLines(st).find((l) => /RD-001/.test(l))).toMatch(/, Zeichnungsnr\. RD-001/);
    } finally {
      setLang("cs");
    }
  });

  it("kusovník: sloupce v pořadí hlavičky předlohy (i hmotnost a poznámka)", () => {
    const ex = extractReference(reread(plateReference()).model, { name: "d.dxf", format: "dxf" });
    ex.boms[0].header = ["Poz", "Ks", "Název", "Hmotnost", "Materiál", "Rozměr", "Pozn."];
    ex.boms[0].rows[0].cells = { ...ex.boms[0].rows[0].cells, Hmotnost: "1,5 kg", "Pozn.": "kalit" };
    expect(extractLines(ex, "bom")).toEqual(["kusovník (list 1): Poz | Ks | Název | Hmotnost | Materiál | Rozměr | Pozn.", "1 | 1 | DESKA | 1,5 kg | S235JR | 20*80*125 | kalit"]);
  });
});
