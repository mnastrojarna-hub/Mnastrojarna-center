import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { parseAgentText } from "./agent";
import { measureApiResult, measureLines, parseMeasure } from "./agent-measure";
import { buildDoc } from "./build";
import { setLang } from "./i18n";
import { measureQuery, type MeasureItem, type MeasureReport } from "./measure";
import { emptyDoc, type CadDoc, type Feature } from "./types";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);
afterEach(() => setLang("cs"));

/** díl z textových příkazů (první tvar = nové těleso) */
function partOf(text: string): CadDoc {
  const p = parseAgentText(text);
  expect(p.errors).toEqual([]);
  const features = p.ops.map((op) => (op.k === "feature" ? op.feature : null)).filter((f): f is Feature => !!f);
  features.forEach((f, i) => {
    const g = f as Feature & { mode?: string };
    if (g.mode === "$auto" || (i === 0 && g.mode === "add")) g.mode = i === 0 ? "new" : "add";
  });
  return { ...emptyDoc("Měření"), features };
}

let shape: r.Shape3D;
const PLATE = `kvádr 100 60 20
díra 8 skrz v 20 30 20
díra 8 skrz v 80 30 20
díra 6 hloubka 10 v 50 52 20
válec 30 15 v 50 30 20`;

/** měření z textu stejně jako příkaz `měřit …` v dílu (rule = výběr indexů ručně) */
function run(text: string, density = 7.85): MeasureReport {
  const cmd = parseMeasure(text.split(/\s+/));
  if (cmd.kind === "entities") {
    const items: MeasureItem[] = cmd.items.map((it) => ({ src: { kind: "part" }, ref: it.ref, label: it.label }));
    return measureQuery(() => shape, { kind: "entities", items }, density);
  }
  if (cmd.kind === "rule") throw new Error("rule v testu jádra není");
  return measureQuery(() => shape, { kind: cmd.kind, src: { kind: "part" }, label: cmd.kind === "body" ? "Těleso" : "" }, density);
}
/** číslo plochy F (od 1) podle podmínky */
const faceNo = (pred: (f: r.Face) => boolean) => shape.faces.findIndex(pred) + 1;

describe("měření v jádře (deska s dírami a čepem)", () => {
  beforeAll(async () => {
    const res = await buildDoc(partOf(PLATE));
    expect(res.body).toBeTruthy();
    shape = res.body!;
  }, 120_000);

  it("rovnoběžné plochy: vzdálenost = tloušťka, kolmé plochy: 90°", () => {
    const bottom = faceNo((f) => f.geomType === "PLANE" && Math.abs(f.center.z) < 1e-6);
    const top = faceNo((f) => f.geomType === "PLANE" && Math.abs(f.center.z - 20) < 1e-6 && f.center.x > 0);
    const side = faceNo((f) => f.geomType === "PLANE" && Math.abs(f.center.x) < 1e-6);
    const rep = run(`F${top} F${bottom}`);
    expect(rep.kind).toBe("pair");
    if (rep.kind !== "pair") return;
    expect(rep.pair.parallel).toBe(true);
    expect(rep.pair.planeDistance).toBeCloseTo(20, 6);
    expect(rep.pair.distance).toBeCloseTo(20, 6);
    expect(rep.pair.angle).toBeCloseTo(180, 4);
    const lines = measureLines(rep);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("vzdálenost rovin 20 mm");
    const rep2 = run(`F${top} F${side}`);
    if (rep2.kind !== "pair") throw new Error("pair");
    expect(rep2.pair.angle).toBeCloseTo(90, 4);
    expect(rep2.pair.perpendicular).toBe(true);
    expect(measureLines(rep2)[0]).toContain("úhel normál 90° (kolmé)");
  });

  it("válcová plocha díry: Ø, osa, úsek osy, díra × vnější válec", () => {
    const hole = faceNo((f) => f.geomType === "CYLINDRE" && Math.abs(f.center.x - 20) < 1e-6);
    const rep = run(`F${hole}`);
    if (rep.kind !== "entity") throw new Error("entity");
    const e = rep.entity;
    expect(e.type).toBe("CYLINDRE");
    expect(e.diameter).toBeCloseTo(8, 6);
    expect(e.hole).toBe(true);
    expect(e.axis!.dir).toEqual([0, 0, 1]);
    expect(e.axis!.origin[0]).toBeCloseTo(20, 6);
    expect(e.axis!.origin[1]).toBeCloseTo(30, 6);
    expect(e.extent!.length).toBeCloseTo(20, 6);
    const line = measureLines(rep)[0];
    expect(line).toMatch(/^F\d+: válcová plocha – díra · Ø 8 mm \(R 4\) · osa \+Z/);
    const boss = faceNo((f) => f.geomType === "CYLINDRE" && Math.abs(f.center.z - 27.5) < 1e-3);
    const rb = run(`F${boss}`);
    if (rb.kind !== "entity") throw new Error("entity");
    expect(rb.entity.hole).toBe(false);
    expect(rb.entity.diameter).toBeCloseTo(30, 6);
  });

  it("dvě díry: rozteč os, úhel os, vzdálenost středů", () => {
    const h1 = faceNo((f) => f.geomType === "CYLINDRE" && Math.abs(f.center.x - 20) < 1e-6);
    const h2 = faceNo((f) => f.geomType === "CYLINDRE" && Math.abs(f.center.x - 80) < 1e-6);
    const rep = run(`F${h1} F${h2}`);
    if (rep.kind !== "pair") throw new Error("pair");
    expect(rep.pair.axisDistance).toBeCloseTo(60, 6);
    expect(rep.pair.angle).toBeCloseTo(0, 6);
    expect(rep.pair.parallel).toBe(true);
    expect(rep.pair.centerDistance).toBeCloseTo(60, 6);
    expect(rep.pair.distance).toBeCloseTo(52, 6);
    expect(measureLines(rep)[0]).toContain("vzdálenost os 60 mm");
    // poloha díry od boční plochy: osa rovnoběžná s rovinou → vzdálenost od osy
    const side = faceNo((f) => f.geomType === "PLANE" && Math.abs(f.center.x) < 1e-6);
    const rs = run(`F${h1} F${side}`);
    if (rs.kind !== "pair") throw new Error("pair");
    expect(rs.pair.angleKind).toBe("linePlane");
    expect(rs.pair.parallel).toBe(true);
    expect(rs.pair.planeDistance).toBeCloseTo(20, 6);
    expect(rs.pair.distance).toBeCloseTo(16, 6);
  });

  it("měřit díry: průchozí a slepá, Ø, hloubka, vstup, skupiny podle průměru", () => {
    const rep = run("díry");
    if (rep.kind !== "holes") throw new Error("holes");
    expect(rep.holes).toHaveLength(3);
    const [d6, a, b] = rep.holes;
    expect(d6.diameter).toBeCloseTo(6, 6);
    expect(d6.through).toBe(false);
    expect(d6.depth).toBeCloseTo(10, 6);
    expect(d6.entry).toEqual([50, 52, 20]);
    expect(d6.drill).toEqual([0, 0, -1]);
    expect(a.diameter).toBeCloseTo(8, 6);
    expect(a.through).toBe(true);
    expect(a.length).toBeCloseTo(20, 6);
    expect(a.entry).toEqual([20, 30, 20]);
    expect(b.entry).toEqual([80, 30, 20]);
    const lines = measureLines(rep);
    expect(lines[0]).toBe("Díry: 3 – Ø 6 mm × 1, Ø 8 mm × 2");
    expect(lines).toContain("Ø 8 mm × 2:");
    expect(lines.some((l) => /D1 Ø 6 mm: vstup \[50; 52; 20\] · slepá, hloubka 10 mm · směr vrtání −Z/.test(l))).toBe(true);
    expect(lines.some((l) => /D2 Ø 8 mm: vstup \[20; 30; 20\] · skrz, délka 20 mm · osa \+Z/.test(l))).toBe(true);
  });

  it("měřit válce: vnější válec čepu s délkou a polohou", () => {
    const rep = run("válce");
    if (rep.kind !== "cylinders") throw new Error("cylinders");
    expect(rep.cylinders).toHaveLength(1);
    const c = rep.cylinders[0];
    expect(c.diameter).toBeCloseTo(30, 6);
    expect(c.length).toBeCloseTo(15, 6);
    expect(c.from).toEqual([50, 30, 20]);
    expect(c.to).toEqual([50, 30, 35]);
  });

  it("měřit těleso: obálka, objem, hmotnost, těžiště", () => {
    const rep = run("těleso");
    if (rep.kind !== "body") throw new Error("body");
    // slepá díra má hrot vrtáku 118° (kužel r 3, výška 3 / tg 59°)
    const tip = (Math.PI * 9 * (3 / Math.tan((59 * Math.PI) / 180))) / 3;
    const vol = 100 * 60 * 20 - 2 * Math.PI * 16 * 20 - Math.PI * 9 * 10 - tip + Math.PI * 225 * 15;
    expect(rep.body.volume).toBeCloseTo(vol, 1);
    expect(rep.body.size).toEqual([100, 60, 35]);
    expect(rep.body.mass).toBeCloseTo((vol / 1e6) * 7.85, 4);
    expect(rep.body.solids).toBe(1);
    const line = measureLines(rep)[0];
    expect(line).toMatch(/^Těleso: obálka 100 × 60 × 35 mm \(X 0…100, Y 0…60, Z 0…35\) · objem /);
    expect(measureApiResult(rep)).toMatchObject({ ok: true, kind: "body", volume: rep.body.volume });
  });

  it("hrana, vrchol, vrchol × bod, desetinná tečka v angličtině", () => {
    const e = shape.edges.findIndex((x) => x.geomType === "LINE" && Math.abs(x.length - 100) < 1e-6) + 1;
    const rep = run(`E${e}`);
    if (rep.kind !== "entity") throw new Error("entity");
    expect(rep.entity.length).toBeCloseTo(100, 6);
    expect(measureLines(rep)[0]).toMatch(/^E\d+: úsečka · délka 100 mm · z \[/);
    const c = shape.edges.findIndex((x) => x.geomType === "CIRCLE" && Math.abs(x.length - 6 * Math.PI) < 1e-6) + 1;
    const rc = run(`E${c}`);
    if (rc.kind !== "entity") throw new Error("entity");
    expect(rc.entity.diameter).toBeCloseTo(6, 6);
    const rv = run("V1 0 0 100");
    if (rv.kind !== "pair") throw new Error("pair");
    expect(rv.pair.distance).toBeGreaterThan(0);
    setLang("en");
    const rh = run(`E${c}`);
    expect(measureLines(rh)[0]).toContain("Ø 6 mm (R 3)");
    const rb = run("body");
    if (rb.kind !== "body") throw new Error("body");
    expect(measureLines(rb)[0]).toMatch(/\d\.\d/);
  });

  it("chybné číslo entity: hláška s platným rozsahem", () => {
    const n = shape.faces.length;
    expect(() => run("F999")).toThrow(`plocha F999 v tělese není – těleso má ${n} ploch (F1 až F${n})`);
    const ne = shape.edges.length;
    expect(() => run("E5000")).toThrow(`(E1 až E${ne})`);
    expect(() => run("V900")).toThrow(/vrchol V900 v tělese není – těleso má \d+ vrcholů \(V1 až V\d+\)/);
  });
});
