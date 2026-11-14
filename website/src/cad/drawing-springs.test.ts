/**
 * Zjednodušené pružiny na výkrese (ISO 2162-1, balík w14 drawing-perf): obal vinutí místo šroubovice (prvek Pružina, normálie,
 * Tažení po šroubovici s profilem Kruh, komponenty sestavy i podsestav), osy drátu jen podél viditelného obrysu, volba
 * `pružiny plně`, mezipaměť těles listů. Skrytí hran (HLR) šroubovice trvalo u 4 pružin sestavy A1 minuty.
 */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { normalizeFeatures, parseAgentText } from "./agent";
import { parseDrawing } from "./agent-drawing";
import { emptyAssembly, partComponent } from "./assembly";
import { shapeOfDoc } from "./asm-kernel";
import { buildShape } from "./build";
import { springEnvelope, springSolid } from "./direct";
import { makeDrawing, projectionStats, type DrawingResult, type Poly } from "./drawing";
import { annLabel } from "./drawing-marks";
import { smartDrawing } from "./drawing-dims-harness";
import { drawingDoc, drawnSpringIndices, hasDrawnSprings, isSpringEnvelope, springEnvelopeDims, springMarksOf, type SpringMark } from "./drawing-doc";
import { clearDrawingModels, drawingBody } from "./drawing-models";
import { inSpringEnvelope, mergeSpans, springWireLines, visibleSpans } from "./drawing-springs";
import { makeFromText } from "./library";
import { setLang } from "./i18n";
import { emptyDoc, type CadDoc, type Feature } from "./types";
import "./ext/index";
import "./feat/index";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

let n = 0;
const id = () => `s${++n}`;
type SpringF = Extract<Feature, { type: "spring" }>;
const spring = (o: Partial<SpringF> = {}): SpringF => ({ id: id(), name: "Pružina", type: "spring", radius: 8.75, pitch: 6, turns: 6, wire: 2.5, position: [0, 0, 0], axis: "Z", mode: "new", ...o });
const part = (name: string, features: Feature[]): CadDoc => ({ ...emptyDoc(name), features });
const box = (size: [number, number, number], position: [number, number, number]): Feature => ({ id: id(), name: "Kvádr", type: "box", size, position, centered: false, mode: "new" });
const helix = (data: Record<string, unknown>): Feature => ({ id: id(), name: "Tažení po šroubovici", type: "ext", ext: "surf.helixSweep", data: { profile: "circle", wire: 2, radius: 10, pitch: 5, turns: 4, position: [0, 0, 0], axis: { kind: "axis", axis: "Z" }, mode: "add", ...data } });
const bounds = (s: r.Shape3D) => s.boundingBox.bounds as [[number, number, number], [number, number, number]];
const center = (polys: Poly[]) => polys.filter((p) => p.layer === "center");

describe("obal vinutí (čisté funkce)", () => {
  it("rozměry obalu: vnější / vnitřní průměr přes drát, délka = stoupání × závity + průřez drátu na koncích", () => {
    const e = springEnvelopeDims({ radius: 8.75, pitch: 6, turns: 6, wire: 2.5 });
    expect(e.ro).toBeCloseTo(10, 9);
    expect(e.ri).toBeCloseTo(7.5, 9);
    const c = 2 * Math.PI * 8.75;
    const cosA = c / Math.hypot(c, 6);
    expect(e.from).toBeCloseTo(-1.25 * cosA, 9);
    expect(e.len).toBeCloseTo(36 + 2.5 * cosA, 9);
  });

  it("drawingDoc: pružina jako první materiál tělesa / nové těleso → obal; drážka po šroubovici (odebrání) a „plně“ zůstanou", () => {
    const a = spring();
    const doc = part("P", [a]);
    const dd = drawingDoc(doc);
    expect(dd).not.toBe(doc);
    expect(isSpringEnvelope(dd.features[0])).toBe(true);
    expect(isSpringEnvelope(a)).toBe(false);
    expect(dd.features.map((f) => f.id)).toEqual(doc.features.map((f) => f.id));
    expect(drawingDoc(doc, "full")).toBe(doc);
    const q = part("Q", [box([40, 40, 10], [0, 0, 0]), spring({ mode: "cut" })]);
    expect(drawingDoc(q)).toBe(q);
    expect([...drawnSpringIndices(part("S", [spring({ suppressed: true })]))]).toEqual([]);
    // obal se drží jen v kopii pro výkres – podruhé se nepřevádí
    expect(drawnSpringIndices(dd).size).toBe(0);
  });

  it("které šroubovice jsou pružiny: jen první materiál tělesa nebo nové těleso, těleso pak už jen odebírá", () => {
    const idx = (fs: Feature[]) => [...drawnSpringIndices(part("X", fs))];
    expect(idx([spring()])).toEqual([0]);
    expect(idx([spring({ mode: "add" })])).toEqual([0]); // `pružina …` jako první prvek dílu (výchozí operace přidat)
    // přidaná na existující těleso = závit / šnek / pružina srostlá s pouzdrem → přesně
    expect(idx([box([40, 40, 10], [0, 0, 0]), spring({ mode: "add" })])).toEqual([]);
    expect(idx([box([40, 40, 10], [0, 0, 0]), spring({ mode: "new" })])).toEqual([]); // nové těleso bez názvu se slučuje do aktivního
    expect(idx([box([40, 40, 10], [0, 0, 0]), spring({ mode: "new", body: "Pružina" })])).toEqual([1]);
    expect(idx([box([40, 40, 10], [0, 0, 0]), helix({ position: [0, 0, 5], radius: 10 })])).toEqual([]); // oblý závit na hřídeli
    expect(idx([helix({})])).toEqual([0]);
    expect(idx([helix({ mode: "cut" })])).toEqual([]);
    // těleso pružiny potom: odebrání (zabroušené konce) a přidání jiného tvaru (očko, rameno) ano; přesun, zaoblení, druhá pružina ne
    const cut: Feature = { ...box([40, 40, 2], [-20, -20, -2]), mode: "cut" } as Feature;
    expect(idx([spring(), cut])).toEqual([0]);
    expect(idx([spring(), { ...box([2, 2, 20], [8, -1, 36]), mode: "add" } as Feature])).toEqual([0]);
    expect(idx([spring(), { id: id(), name: "Přesun", type: "transform", translate: [5, 0, 0], rotateAxis: "Z", rotateAngle: 0, scale: 1 }])).toEqual([]);
    expect(idx([spring(), { id: id(), name: "Zaoblení", type: "fillet", edges: "all", radius: 0.2 } as Feature])).toEqual([]);
    expect(idx([spring(), spring({ mode: "add", radius: 4, wire: 1 })])).toEqual([]);
    // jiné těleso to neovlivní: deska, pružina jako nové těleso, pak zase deska
    expect(idx([{ ...box([40, 40, 10], [0, 0, 0]), body: "Deska" } as Feature, spring({ mode: "new", body: "Pružina", position: [0, 0, 10] }), { ...box([5, 5, 5], [0, 0, 0]), mode: "add", body: "Deska" } as Feature])).toEqual([1]);
    // sloučení tělesa pružiny do jiného
    expect(idx([box([40, 40, 10], [0, 0, 0]), spring({ mode: "new", body: "Pružina" }), { id: id(), name: "Sloučit", type: "combine", target: "Těleso 1", tool: "Pružina", op: "add", keepTool: false }])).toEqual([]);
  });

  it("normálie: pružiny ano, šnek ne (chod šneku je prvek Pružina přidaný na jádro)", () => {
    for (const q of ["pružina d2,5 D20 L38,5 n6", "tažná pružina d1.6 D12 L40 n12", "zkrutná pružina d2 D16 n5"]) expect(hasDrawnSprings(makeFromText(q)!.doc), q).toBe(true);
    const worm = makeFromText("šnek m2 q10 l40")!.doc;
    expect(worm.features.some((f) => f.type === "spring")).toBe(true);
    expect(hasDrawnSprings(worm)).toBe(false);
    expect(drawingDoc(worm)).toBe(worm);
  });

  it("Tažení po šroubovici s profilem Kruh → prvek Pružina s obalem (id, poloha, osa, odkaz); Závit 60° se dál potlačí", () => {
    const h1 = helix({ position: [5, 6, 7], axis: { kind: "vector", v: [0, 0, -1] } });
    const h2 = helix({ axis: "X", mode: "new", positionRef: { kind: "vertex", index: 3 } });
    const [s1] = drawingDoc(part("H1", [h1])).features;
    const [s2] = drawingDoc(part("H2", [h2])).features;
    expect(isSpringEnvelope(s1) && isSpringEnvelope(s2)).toBe(true);
    expect(s1).toMatchObject({ id: h1.id, type: "spring", radius: 10, pitch: 5, turns: 4, wire: 2, position: [5, 6, 7], axis: "Z", dirDef: { kind: "vector", v: [0, 0, -1] }, mode: "add" });
    expect(s2).toMatchObject({ id: h2.id, type: "spring", axis: "X", mode: "new", positionRef: { kind: "vertex", index: 3 } });
    expect(s2.type === "spring" && s2.dirDef).toBeFalsy();
    const h3 = helix({ mode: "cut" });
    const th = helix({ profile: "thread60", depth: 1, mode: "cut" });
    const [b, s3, s4] = drawingDoc(part("H3", [box([40, 40, 40], [-20, -20, 0]), h3, th])).features;
    expect(b.type).toBe("box");
    expect(s3).toBe(h3);
    expect(s4.suppressed).toBe(true);
  });

  it("sestava: díly komponent i podsestavy dostanou obal, díl bez pružiny zůstane týž objekt", () => {
    const spr = part("Pružina", [spring()]);
    const plate = part("Deska", [box([40, 40, 10], [0, 0, 0])]);
    const sub: CadDoc = { ...emptyAssembly("Pod"), components: [partComponent(spr, { position: [0, 0, 20] })] };
    const asm: CadDoc = { ...emptyAssembly("S"), components: [partComponent(plate), partComponent(spr, { position: [10, 0, 0] }), { ...partComponent(plate), source: { kind: "asm", doc: sub } }] };
    expect(hasDrawnSprings(asm)).toBe(true);
    expect(hasDrawnSprings({ ...emptyAssembly("X"), components: [partComponent(plate)] })).toBe(false);
    const dd = drawingDoc(asm);
    const comps = dd.components!;
    expect(comps[0]).toBe(asm.components![0]);
    const s1 = comps[1].source;
    expect(s1.kind === "part" && isSpringEnvelope(s1.doc.features[0])).toBe(true);
    const s2 = comps[2].source;
    const inner = s2.kind === "asm" ? s2.doc.components![0].source : null;
    expect(inner?.kind === "part" && isSpringEnvelope(inner.doc.features[0])).toBe(true);
    expect(drawingDoc(asm, "full")).toBe(asm);
  });

  it("osy drátu: pružina dílu a v sestavě v umístění komponenty (natočení i podsestava)", () => {
    const spr = part("Pružina", [spring({ position: [1, 2, 3] })]);
    const m = springMarksOf(drawingDoc(spr));
    expect(m).toHaveLength(1);
    const e = springEnvelopeDims(spring());
    expect(m[0].p[2]).toBeCloseTo(3 + e.from, 9);
    expect(m[0].a).toEqual([0, 0, 1]);
    expect(m[0]).toMatchObject({ r: 8.75, ro: 10, ri: 7.5 });
    // natočení 90° kolem X: osa Z → −Y
    const asm: CadDoc = { ...emptyAssembly("S"), components: [partComponent(spr, { position: [100, 0, 0], rotation: [90, 0, 0] })] };
    const ma = springMarksOf(drawingDoc(asm));
    expect(ma).toHaveLength(1);
    expect(ma[0].a[1]).toBeCloseTo(-1, 9);
    expect(ma[0].p[0]).toBeCloseTo(101, 9);
    // skrytá komponenta: bez os drátu; přesun těles po pružině: pružina se kreslí přesně (bez obalu i os)
    expect(springMarksOf(drawingDoc({ ...asm, components: asm.components!.map((c) => ({ ...c, hidden: true })) }))).toHaveLength(0);
    const moved = part("P", [spring(), { id: id(), name: "Přesun", type: "transform", translate: [5, 0, 0], rotateAxis: "Z", rotateAngle: 0, scale: 1 }]);
    expect(drawingDoc(moved)).toBe(moved);
    expect(springMarksOf(drawingDoc(moved))).toHaveLength(0);
  });

  it("viditelné úseky obrysu: jen úsečky na přímce, sloučené a oříznuté na délku pružiny", () => {
    expect(mergeSpans([[5, 8], [0, 2], [1.5, 3], [8.005, 9]], 0.01)).toEqual([[0, 3], [5, 9]]);
    const polys = [
      { layer: "visible", pts: [[-5, 10], [4, 10], [6, 10]] as [number, number][] },
      { layer: "visible", pts: [[12, 10.001], [30, 10.001]] as [number, number][] },
      { layer: "hidden", pts: [[6, 10], [12, 10]] as [number, number][] },
      { layer: "visible", pts: [[0, 0], [20, 20]] as [number, number][] },
    ];
    expect(visibleSpans(polys, [0, 10], [1, 0], 20, 0.01)).toEqual([[0, 6], [12, 20]]);
  });

  it("osy drátu se nekreslí v pohledu podél osy pružiny", () => {
    const mk: SpringMark = { p: [0, 0, 0], a: [0, 0, 1], len: 20, r: 8, ro: 9, ri: 7 };
    const id2 = (q: [number, number]) => q;
    // pohled shora (d = +Z) – osa míří k pozorovateli
    expect(springWireLines({ d: [0, 0, 1], x: [1, 0, 0] }, [{ layer: "visible", pts: [[-9, 0], [-9, -20]] }], [mk], id2)).toEqual([]);
    // přední pohled (d = −Y, x = +X; y obrazu = −z): obrys na x = −9 viditelný celý, na x = +9 jen z půlky
    const front = { d: [0, -1, 0] as [number, number, number], x: [1, 0, 0] as [number, number, number] };
    const lines = springWireLines(front, [{ layer: "visible", pts: [[-9, 0], [-9, -20]] }, { layer: "visible", pts: [[9, -10], [9, -20]] }], [mk], id2);
    expect(lines).toHaveLength(2);
    const xs = lines.map((l) => l[0][0]).sort((a, b) => a - b);
    expect(xs).toEqual([-8, 8]);
    const right = lines.find((l) => l[0][0] > 0)!;
    expect(Math.abs(right[0][1] - right[1][1])).toBeCloseTo(10, 6);
  });
});

describe("text: výkres pružiny", () => {
  it("výkres pružiny plně / zjednodušeně (CS, EN, DE) a chybné slovo = ✗", () => {
    const set = (s: string) => {
      const c = parseDrawing(s.split(/\s+/), s);
      return c?.k === "set" ? c.opts.springs : "?";
    };
    expect(set("pružiny plně")).toBe("full");
    expect(set("pružiny zjednodušeně")).toBe("simple");
    expect(set("springs full")).toBe("full");
    expect(set("federn vereinfacht")).toBe("simple");
    expect(set("A1 pohledy přední,horní pružiny plně")).toBe("full");
    expect(() => parseDrawing(["pružiny", "ano"], "pružiny ano")).toThrow(/zjednodušeně .*plně/);
    const p = parseAgentText("výkres A3 pružiny plně");
    expect(p.errors).toEqual([]);
    expect(p.ops[0]).toMatchObject({ k: "drawingCmd", cmd: { k: "set", opts: { springs: "full", sheet: "A3" } } });
  });

  it("list pojmenovaný slovem pružiny (bez uvozovek) je dál název listu – CS, EN, DE (nález recenze)", () => {
    const sheet = (s: string) => {
      const p = parseAgentText(s);
      expect(p.errors, s).toEqual([]);
      return (p.ops[0] as { cmd?: unknown }).cmd;
    };
    expect(sheet("výkres list nový Pružina")).toMatchObject({ k: "sheet", op: "new", name: "Pružina" });
    expect(sheet("výkres list nový Pružiny")).toMatchObject({ k: "sheet", op: "new", name: "Pružiny" });
    expect(sheet("výkres list nový Deska")).toMatchObject({ k: "sheet", op: "new", name: "Deska" });
    // s hodnotou za slovem je to dál volba
    expect(parseDrawing(["A1", "pohledy", "přední,horní", "pružiny", "plně"], "A1 pohledy přední,horní pružiny plně")).toMatchObject({ k: "set", opts: { springs: "full" } });
    try {
      setLang("en");
      expect(sheet("drawing sheet new Spring")).toMatchObject({ k: "sheet", op: "new", name: "Spring" });
      setLang("de");
      expect(sheet("zeichnung blatt neu Feder")).toMatchObject({ k: "sheet", op: "new", name: "Feder" });
    } finally {
      setLang("cs");
    }
  });
});

describe("obal vinutí v jádře a výkres", () => {
  it("obal sedí na skutečnou šroubovici (obalový kvádr do 0,02 mm), i s osou opačným směrem", { timeout: 120_000 }, () => {
    for (const f of [spring(), spring({ axis: "X", position: [3, 4, 5] })]) {
      const real = bounds(springSolid(f));
      const env = bounds(springEnvelope(f));
      for (let k = 0; k < 3; k++) {
        expect(Math.abs(env[0][k] - real[0][k])).toBeLessThan(0.02);
        expect(Math.abs(env[1][k] - real[1][k])).toBeLessThan(0.02);
      }
    }
  });

  it("normálie pružiny: výkres zjednodušeně – obrys, osa a osy drátu na středním průměru, rychle", { timeout: 120_000 }, async () => {
    const lib = makeFromText("pružina d2,5 D20 L38,5 n6")!.doc;
    expect(lib.features.some((f) => f.type === "spring")).toBe(true);
    const dd = drawingDoc(lib);
    const res = await buildShape(dd);
    expect(res.body).toBeTruthy();
    const t0 = Date.now();
    const d = makeDrawing(res.body!, { name: lib.name, material: "ocel", springs: springMarksOf(dd) }, { views: { front: true, top: true, left: false, right: false, back: false, bottom: false, iso: true }, dimensions: "none", scale: 1 });
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(5000);
    const front = d.views.find((v) => v.key === "front")!;
    const sx = (x: number) => front.px + (x - front.x0) * front.s;
    // osy drátu: dvě svislé čerchované čáry v x = ±8,75 (střední průměr D − d = 17,5) po celé volné délce 38,5
    const wires = center(d.polys).filter((p) => p.pts.length === 2 && Math.abs(p.pts[0][0] - p.pts[1][0]) < 1e-6 && [-8.75, 8.75].some((x) => Math.abs(p.pts[0][0] - sx(x)) < 1e-6));
    expect(wires).toHaveLength(2);
    for (const w of wires) expect(Math.abs(w.pts[0][1] - w.pts[1][1])).toBeCloseTo(38.5 * front.s, 1);
    // obrys = vnější průměr 20 × volná délka 38,5
    expect(front.w).toBeCloseTo(20, 2);
    expect(front.h).toBeCloseTo(38.5, 1);
  });

  it("sestava: pružina zakrytá deskou nemá osy drátu přes desku; obal se kreslí, šroubovice ne", { timeout: 120_000 }, async () => {
    const spr = makeFromText("pružina d2,5 D20 L38,5 n6")!.doc;
    const plate = part("Deska", [box([60, 30, 20], [-30, -40, 10])]);
    // deska před pružinou (blíž k pozorovateli předního pohledu, −Y) zakryje pružinu ve výšce z 10…30
    const asm: CadDoc = { ...emptyAssembly("S"), components: [partComponent(spr), partComponent(plate)] };
    const dd = drawingDoc(asm);
    const body = (await shapeOfDoc(dd))!;
    expect(body.faces.every((f) => f.geomType === "PLANE" || f.geomType === "CYLINDRE")).toBe(true);
    const d = makeDrawing(body, { name: "S", material: "", springs: springMarksOf(dd) }, { views: { front: true, top: false, left: false, right: false, back: false, bottom: false, iso: false }, dimensions: "none", scale: 1 });
    const front = d.views.find((v) => v.key === "front")!;
    const sx = (x: number) => front.px + (x - front.x0) * front.s;
    const sy = (z: number) => front.py + (-z - front.y0) * front.s;
    const wires = center(d.polys).filter((p) => p.pts.length === 2 && [-8.75, 8.75].some((x) => Math.abs(p.pts[0][0] - sx(x)) < 1e-6 && Math.abs(p.pts[1][0] - sx(x)) < 1e-6));
    expect(wires.length).toBeGreaterThanOrEqual(2);
    // žádný úsek osy drátu neleží za deskou (z 10…30)
    for (const w of wires) {
      const [z0, z1] = [w.pts[0][1], w.pts[1][1]].sort((a, b) => a - b);
      const lo = Math.min(sy(30), sy(10));
      const hi = Math.max(sy(30), sy(10));
      expect(z1 <= lo + 1e-6 || z0 >= hi - 1e-6).toBe(true);
    }
  });

  it("mezipaměť těles listů: týž dokument = totéž těleso (bez nové projekce), nejdéle nepoužitý ze 4+ se uvolní", { timeout: 120_000 }, async () => {
    clearDrawingModels();
    const docs = [10, 20, 30, 40, 50].map((h) => part(`D${h}`, [box([h, 10, 10], [0, 0, 0])]));
    let builds = 0;
    const build = async (d: CadDoc) => {
      builds++;
      return (await shapeOfDoc(d))!.clone() as r.Shape3D;
    };
    const a = await drawingBody(docs[0], build);
    const before = projectionStats.hlr;
    makeDrawing(a!, { name: "A", material: "" }, { dimensions: "none" });
    const hlr1 = projectionStats.hlr - before;
    expect(hlr1).toBeGreaterThan(0);
    for (const d of docs.slice(1, 4)) await drawingBody(d, build);
    const again = await drawingBody(docs[0], build);
    expect(again).toBe(a);
    makeDrawing(again!, { name: "A", material: "" }, { dimensions: "none" });
    expect(projectionStats.hlr - before).toBe(hlr1); // projekce z mezipaměti
    expect(builds).toBe(4);
    await drawingBody(docs[4], build); // 5. dokument vyřadí nejdéle nepoužitý (D20), ne právě použitý D10
    expect(await drawingBody(docs[0], build)).toBe(a);
    expect(builds).toBe(5);
    await drawingBody(docs[1], build);
    expect(builds).toBe(6);
    clearDrawingModels();
  });
});

/** šrafy listu a jejich středy v obraze pohledu (mm modelu v rovině pohledu) */
function hatchIn(d: DrawingResult, key: string) {
  const v = d.views.find((x) => x.key === key)!;
  const img = (q: [number, number]): [number, number] => [(q[0] - v.px) / v.s + v.x0, (q[1] - v.py) / v.s + v.y0];
  return d.polys.filter((p) => p.layer === "hatch").map((p) => img([(p.pts[0][0] + p.pts[p.pts.length - 1][0]) / 2, (p.pts[0][1] + p.pts[p.pts.length - 1][1]) / 2]));
}
const SECTION = { views: { front: true, top: false, left: false, right: false, back: false, bottom: false, iso: false }, dimensions: "none" as const, sheet: "A3" as const, scale: 1, section: { plane: "XZ" as const, offset: 0, kind: "full" as const } };

describe("nálezy recenze: Chytré kóty, řez, JSON", () => {
  it("Chytré kóty dílu pružiny kótují skutečný tvar – žádná díra Ø15 skrz z vnitřního válce obalu", { timeout: 120_000 }, async () => {
    const doc = part("Pružina T", [spring({ mode: "add" })]);
    expect(hasDrawnSprings(doc)).toBe(true);
    const d = await smartDrawing(doc, { sheet: "A4", views: { front: true, top: true, left: false, right: false, back: false, bottom: false, iso: true } });
    const labels = d.smart.annotations.filter((a) => a.type === "dim" || a.type === "callout").map((a) => annLabel(d.drawing.views, a));
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.filter((l) => /skrz|↧|Ø15|Ø7,5/.test(l))).toEqual([]);
    expect(labels).toContain("38,485"); // tisíciny modelu na listu (vlna 15, B7 – dřív „38,49“)
    // list se přitom kreslí zjednodušeně (obal + osy drátu)
    expect(d.drawing.polys.some((p) => p.layer === "center")).toBe(true);
  });

  it("pole envelope / drawingEnvelope z JSON model nezmění (pružina se staví jako šroubovice)", { timeout: 120_000 }, async () => {
    const raw = { type: "spring", name: "Pružina", radius: 8.75, pitch: 6, turns: 6, wire: 2.5, position: [0, 0, 0], axis: "Z", mode: "new" };
    for (const extra of [{ envelope: true }, { drawingEnvelope: "w123" }, { drawingEnvelope: true }]) {
      const { features, errors } = normalizeFeatures([{ ...raw, ...extra }]);
      expect(errors).toEqual([]);
      const doc = part("P2", features);
      expect(drawnSpringIndices(doc).has(0)).toBe(true);
      const body = (await buildShape(doc)).body!;
      expect(body.faces.some((f) => f.geomType !== "PLANE" && f.geomType !== "CYLINDRE")).toBe(true);
      expect(r.measureVolume(body)).toBeCloseTo(1629, -1);
    }
  });

  it("řez desky se pružinou v sedle (obal zasahuje do desky): deska je šrafovaná celá, kapsa zůstane, obal pružiny bez šraf", { timeout: 240_000 }, async () => {
    const plate = (): Feature => box([100, 100, 60], [-50, -50, 0]);
    const run = async (z: number | null) => {
      const doc = part("Deska", z == null ? [plate()] : [plate(), spring({ radius: 11, pitch: 4, turns: 5, wire: 2, position: [0, 0, z], mode: "new", body: "Pružina" })]);
      const dd = drawingDoc(doc);
      const body = (await buildShape(dd)).body!;
      return makeDrawing(body, { name: "D", material: "", springs: springMarksOf(dd) }, SECTION);
    };
    const over = await run(59);
    const gap = await run(62);
    const ho = hatchIn(over, "section");
    const hg = hatchIn(gap, "section");
    expect(hg.length).toBeGreaterThan(20);
    // dřív: 26 šraf při přesahu proti 62 s mezerou (deska bez šraf)
    expect(Math.abs(ho.length - hg.length)).toBeLessThanOrEqual(Math.ceil(hg.length * 0.15));
    // šrafy jen v desce (|z| ≤ 60), žádné v obalu pružiny nad deskou
    for (const h of [ho, hg]) expect(h.filter((q) => Math.abs(q[1]) > 60.5)).toEqual([]);
    // deska s druhým tělesem, které do ní zasahuje (trubka nové těleso) – deska zůstane šrafovaná
    const tubeDoc = part("Deska", [plate(), { id: id(), name: "Trubka", type: "tube", outer: 24, inner: 16, height: 20, position: [0, 0, 50], axis: "Z", mode: "new", body: "Trubka" } as unknown as Feature]);
    const tb = (await buildShape(tubeDoc)).body!;
    const ht = hatchIn(makeDrawing(tb, { name: "T", material: "" }, SECTION), "section");
    expect(ht.filter((q) => Math.abs(q[1]) < 59 && Math.abs(q[0]) < 49).length).toBeGreaterThan(hg.length * 0.6);
  });

  it("zjednodušená pružina v řezu: obal bez šraf, osy drátu na středním průměru; pouzdro kolem šrafované", { timeout: 240_000 }, async () => {
    const doc = part("Pouzdro s pružinou", [
      { id: id(), name: "Trubka", type: "tube", outer: 40, inner: 30, height: 50, position: [0, 0, 0], axis: "Z", mode: "add" } as unknown as Feature,
      spring({ radius: 6, pitch: 6, turns: 6, wire: 2.5, position: [0, 0, 5], mode: "new", body: "Pružina" }),
    ]);
    expect([...drawnSpringIndices(doc)]).toEqual([1]);
    const dd = drawingDoc(doc);
    const body = (await buildShape(dd)).body!;
    const d = makeDrawing(body, { name: "P", material: "", springs: springMarksOf(dd) }, SECTION);
    const h = hatchIn(d, "section");
    expect(h.length).toBeGreaterThan(10);
    // šrafy jen ve stěně pouzdra (15 … 20), ne v obalu pružiny (4,75 … 7,25)
    expect(h.filter((q) => Math.abs(q[0]) < 14.5)).toEqual([]);
    const v = d.views.find((x) => x.key === "section")!;
    const ux = (x: number) => v.px + (x - v.x0) * v.s;
    const wires = center(d.polys).filter((p) => p.pts.length === 2 && [-6, 6].some((x) => Math.abs(p.pts[0][0] - ux(x)) < 1e-6 && Math.abs(p.pts[1][0] - ux(x)) < 1e-6));
    expect(wires.length).toBeGreaterThanOrEqual(2);
  });

  it("řezná plocha v obalu pružiny: celá uvnitř = bez šraf, přesahující = se šrafuje", () => {
    const m: SpringMark = { p: [0, 0, 0], a: [0, 0, 1], len: 20, r: 8, ro: 9, ri: 7 };
    expect(inSpringEnvelope([[7, 0, 0], [9, 0, 0], [9, 0, 20], [7, 0, 20]], [m], 1e-3)).toBe(true);
    expect(inSpringEnvelope([[7, 0, 0], [9, 0, 0], [9, 0, 21], [7, 0, 21]], [m], 1e-3)).toBe(false);
    expect(inSpringEnvelope([[5, 0, 1], [9, 0, 1]], [m], 1e-3)).toBe(false);
    expect(inSpringEnvelope([], [m], 1e-3)).toBe(false);
  });
});
