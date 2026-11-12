/**
 * Regresní hodnoty z testu na výkresu 604200.001 (oběžné kolo, 12. 11. 2026) a více těles v dílu.
 * - díra „skrz“ vrtá od zadaného bodu jen ve směru vrtání (BUG1 = 313,594 cm³, model B = 4 338,09 cm³; dřív 4 260,66),
 * - model A (profil se 148 entitami, 16 šikmých otvorů, 36 drážek Hirth) = 4 324,95 cm³ a doběhne v řádu sekund
 *   (kopie nástroje pole se spojí a odečtou jednou operací),
 * - průběh stavby po prvcích a čas každého prvku,
 * - více těles: rozdělit, kopie, sloučit, nové těleso, cílové těleso prvku.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { bodiesAt } from "./bodies";
import { buildDoc, buildShape, clearBuildCache, type BuildProgress } from "./build";
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

const fixture = (name: string): CadDoc => JSON.parse(fs.readFileSync(path.resolve(__dirname, "fixtures", name), "utf8")) as CadDoc;
const cm3 = (mm3: number) => mm3 / 1000;
const doc = (features: Feature[]): CadDoc => ({ ...emptyDoc("Test"), features });
const XY = { kind: "base", name: "XY", offset: 0 } as const;

describe("díra skrz – jen ve směru vrtání", () => {
  // prstenec Ø100/Ø60 × 80 s vnitřním vybráním Ø80 mezi z = 20 a 60; díra Ø6 skrz z bodu [35, 0, 20] dolů
  const ring: Feature[] = [
    { id: "s", name: "Profil", type: "sketch", plane: { kind: "base", name: "XZ", offset: 0 }, entities: [{ id: "p", type: "polyline", closed: true, points: [[30, 0], [50, 0], [50, 80], [30, 80], [30, 60], [40, 60], [40, 20], [30, 20]] }] },
    { id: "r", name: "Rotace", type: "revolve", sketchId: "s", angle: 360, axis: "y", mode: "new" },
  ];
  const hole = (extra: Partial<Extract<Feature, { type: "hole" }>> = {}): Feature => ({ id: "h", name: "Díra", type: "hole", position: [35, 0, 20], axis: "Z", flip: false, diameter: 6, depth: 0, cbDiameter: 0, cbDepth: 0, ...extra });

  it("BUG1: díra skrz od z = 20 dolů = 313,594 cm³ (horní příruba zůstane celá)", async () => {
    const base = await buildDoc(doc(ring));
    expect(cm3(base.metrics!.volume)).toBeCloseTo(314.159, 2);
    const res = await buildDoc(doc([...ring, hole()]));
    expect(res.status.every((s) => s.ok)).toBe(true);
    expect(cm3(res.metrics!.volume)).toBeCloseTo(313.594, 2);
  });
  it("bothWays: oběma směry skrz celé těleso (dolní i horní příruba)", async () => {
    const res = await buildDoc(doc([...ring, hole({ bothWays: true })]));
    expect(cm3(res.metrics!.volume)).toBeCloseTo(314.159 - 2 * 0.5655, 2);
  });
  it("opačný směr (flip): vrtá nahoru – jen horní příruba", async () => {
    const res = await buildDoc(doc([...ring, hole({ position: [35, 0, 60], flip: true })]));
    expect(cm3(res.metrics!.volume)).toBeCloseTo(313.594, 2);
  });
  it("díra mimo materiál ve směru vrtání těleso nezmění → ⚠, ne tichý úspěch", async () => {
    const res = await buildDoc(doc([...ring, hole({ position: [35, 0, 0] })]));
    const s = res.status.find((x) => x.id === "h")!;
    expect(s.ok).toBe(true);
    expect(s.warning).toMatch(/těleso nezměnil/);
    expect(cm3(res.metrics!.volume)).toBeCloseTo(314.159, 2);
  });
  it("slepá díra do šikmé plochy má čistý nástup (krátký přesah nad bodem), ale neřeže protější stěnu", async () => {
    const res = await buildDoc(doc([...ring, hole({ depth: 10 })]));
    // válec Ø6 × 10 + kuželová špička 118°
    const tip = (Math.PI * 9 * (3 / Math.tan((118 * Math.PI) / 360))) / 3;
    expect(res.metrics!.volume).toBeCloseTo(314159.27 - (Math.PI * 9 * 10 + tip), 0);
  });
});

describe("oběžné kolo 604200.001", () => {
  it("model B (z kót): otvory Ø13 skrz od z = 29 jen dolů → 4 338,09 cm³ (dřív 4 260,66)", async () => {
    const res = await buildDoc(fixture("impeller-B.mncad.json"));
    expect(res.status.filter((s) => !s.ok)).toEqual([]);
    expect(cm3(res.metrics!.volume)).toBeCloseTo(4338.09, 1);
    const [a, b] = res.metrics!.bbox;
    expect(b[0] - a[0]).toBeCloseTo(430, 1);
    expect(b[2] - a[2]).toBeCloseTo(168.59, 1);
  }, 180_000);

  it("model A (profil, 16 šikmých otvorů, 36 drážek Hirth): 4 324,95 cm³, platné těleso, průběh po prvcích, do 60 s", async () => {
    const d = fixture("impeller-A.mncad.json");
    const seen: BuildProgress[] = [];
    const t0 = Date.now();
    const res = await buildDoc(d, { onProgress: (p) => seen.push(p) });
    const sec = (Date.now() - t0) / 1000;
    expect(res.status.filter((s) => !s.ok)).toEqual([]);
    expect(cm3(res.metrics!.volume)).toBeCloseTo(4324.95, 1);
    expect(res.metrics!.solids).toBe(1);
    expect(res.metrics!.faces).toBe(636);
    expect(res.metrics!.edges).toBe(1461); // stejná topologie jako postupné operace (kopie nástroje jdou do jedné operace jako seznam)
    // průběh: každý prvek jednou, v pořadí, nakonec síť
    expect(seen.filter((p) => p.phase === "feature").map((p) => p.index)).toEqual(d.features.map((_, i) => i));
    expect(seen[seen.length - 1]).toMatchObject({ phase: "mesh", total: d.features.length });
    // čas prvku je u pole a rotace vyplněn
    const ms = new Map(res.status.map((s) => [s.id, s.ms]));
    expect(ms.get(d.features.find((f) => f.type === "revolve")!.id)).toBeGreaterThan(0);
    expect(d.features.filter((f) => f.type === "pattern").every((f) => (ms.get(f.id) ?? 0) > 0)).toBe(true);
    console.log(`model A: ${sec.toFixed(1)} s · ` + res.status.filter((s) => s.ms).map((s) => `${d.features.find((f) => f.id === s.id)!.name} ${((s.ms ?? 0) / 1000).toFixed(1)} s`).join(", "));
    expect(sec).toBeLessThan(60);
  }, 240_000);
});

describe("více těles v dílu", () => {
  const box = (id: string, size: [number, number, number], position: [number, number, number], extra: Partial<Feature> = {}): Feature => ({ id, name: id, type: "box", size, position, centered: false, mode: "add", ...extra }) as Feature;

  it("rozdělit na tělesa: dvě tělesa, součet objemů, kladná strana zůstává aktivní", async () => {
    const d = doc([box("b", [100, 60, 20], [0, 0, 0], { mode: "new" }), { id: "sp", name: "Rozdělit", type: "splitBodies", plane: "YZ", offset: 40 }]);
    const res = await buildDoc(d);
    expect(res.status.every((s) => s.ok)).toBe(true);
    expect(res.bodies?.map((b) => [b.name, b.active, Math.round(b.volume)])).toEqual([["Těleso 1", true, 72000], ["Těleso 2", false, 48000]]);
    expect(res.metrics!.solids).toBe(2);
    expect(res.metrics!.volume).toBeCloseTo(120000, 3);
    // plochy aktivního tělesa jsou ve složeném tvaru první
    expect(res.bodies![0]).toMatchObject({ faceStart: 0, faceCount: 6, edgeStart: 0, edgeCount: 12 });
    expect(res.bodies![1]).toMatchObject({ faceStart: 6, faceCount: 6, edgeStart: 12, edgeCount: 12 });
    expect(res.metrics!.faces).toBe(12);
    expect(bodiesAt(d)).toEqual({ names: ["Těleso 1", "Těleso 2"], active: "Těleso 1", started: true });
  });

  it("prvek bez `body` pracuje s aktivním tělesem; s `body` přepne na jiné", async () => {
    const d = doc([
      box("b", [100, 60, 20], [0, 0, 0], { mode: "new" }),
      { id: "sp", name: "Rozdělit", type: "splitBodies", plane: "YZ", offset: 40, nameB: "Levá" },
      { id: "h1", name: "Díra v pravé", type: "hole", position: [70, 30, 20], axis: "Z", flip: false, diameter: 10, depth: 0, cbDiameter: 0, cbDepth: 0 },
      { id: "h2", name: "Díra v levé", type: "hole", position: [20, 30, 20], axis: "Z", flip: false, diameter: 10, depth: 0, cbDiameter: 0, cbDepth: 0, body: "Levá" },
      box("x", [10, 10, 10], [10, 10, 20]),
    ]);
    const res = await buildDoc(d);
    expect(res.status.filter((s) => !s.ok || s.warning)).toEqual([]);
    const hole = Math.PI * 25 * 20;
    const byName = new Map(res.bodies!.map((b) => [b.name, b]));
    expect(byName.get("Těleso 1")!.volume).toBeCloseTo(72000 - hole, 0);
    expect(byName.get("Levá")!.volume).toBeCloseTo(48000 - hole + 1000, 0); // díra + kvádr přidaný do naposledy aktivního tělesa
    expect(res.bodies![0].name).toBe("Levá");
    expect(bodiesAt(d).active).toBe("Levá");
  });

  it("kopie tělesa s posunutím a sloučení: odečíst kopii od originálu", async () => {
    const d = doc([
      box("b", [40, 40, 40], [0, 0, 0], { mode: "new" }),
      { id: "cp", name: "Kopie", type: "copyBody", source: "", translate: [20, 20, 20], newName: "Nástroj" },
      { id: "cb", name: "Odečíst", type: "combine", target: "Těleso 1", tool: "Nástroj", op: "cut", keepTool: false },
    ]);
    const res = await buildDoc(d);
    expect(res.status.filter((s) => !s.ok || s.warning)).toEqual([]);
    expect(res.bodies?.map((b) => b.name)).toEqual(["Těleso 1"]);
    expect(res.metrics!.volume).toBeCloseTo(64000 - 8000, 2);
    // ponechat nástroj: zůstanou dvě tělesa, která se překrývají jen dotykem
    const keep = await buildDoc(doc([...d.features.slice(0, 2), { ...d.features[2], keepTool: true } as Feature]));
    expect(keep.bodies?.map((b) => [b.name, Math.round(b.volume)])).toEqual([["Těleso 1", 56000], ["Nástroj", 64000]]);
    // sjednocení a průnik
    const add = await buildDoc(doc([...d.features.slice(0, 2), { ...d.features[2], op: "add" } as Feature]));
    expect(add.metrics!.volume).toBeCloseTo(2 * 64000 - 8000, 2);
    const inter = await buildDoc(doc([...d.features.slice(0, 2), { ...d.features[2], op: "intersect" } as Feature]));
    expect(inter.metrics!.volume).toBeCloseTo(8000, 2);
  });

  it("operace „Nové těleso“ s názvem založí samostatné těleso, i když se s prvním překrývá", async () => {
    const d = doc([box("a", [40, 40, 40], [0, 0, 0], { mode: "new" }), box("b", [40, 40, 40], [20, 0, 0], { mode: "new", body: "Těleso 2" })]);
    const res = await buildDoc(d);
    expect(res.status.every((s) => s.ok)).toBe(true);
    expect(res.bodies?.map((b) => [b.name, b.active, Math.round(b.volume)])).toEqual([["Těleso 2", true, 64000], ["Těleso 1", false, 64000]]);
    // bez názvu tělesa zůstává dřívější chování: „new“ u existujícího tělesa se sjednotí
    const old = await buildDoc(doc([box("a", [40, 40, 40], [0, 0, 0], { mode: "new" }), box("b", [40, 40, 40], [20, 0, 0], { mode: "new" })]));
    expect(old.bodies?.length).toBe(1);
    expect(old.metrics!.volume).toBeCloseTo(96000, 2);
  });

  it("chyby jsou srozumitelné: neexistující těleso, stejné cílové a nástrojové, rovina mimo těleso", async () => {
    const b = box("b", [40, 40, 40], [0, 0, 0], { mode: "new" });
    const err = async (f: Feature) => (await buildDoc(doc([b, f]))).status.find((s) => s.id === f.id)?.error ?? "";
    expect(await err({ id: "c", name: "c", type: "combine", target: "Těleso 1", tool: "Těleso 9", op: "add", keepTool: false })).toMatch(/Těleso „Těleso 9“ v dílu není/);
    expect(await err({ id: "c", name: "c", type: "combine", target: "Těleso 1", tool: "Těleso 1", op: "add", keepTool: false })).toMatch(/dvě různá tělesa/);
    expect(await err({ id: "c", name: "c", type: "combine", target: "", tool: "", op: "add", keepTool: false })).toMatch(/Vyberte nástrojové těleso/);
    expect(await err({ id: "s", name: "s", type: "splitBodies", plane: "XY", offset: 100 })).toMatch(/Rovina těleso nerozdělí/);
    expect(await err({ id: "k", name: "k", type: "copyBody", source: "Nic", translate: [0, 0, 0] })).toMatch(/Těleso „Nic“ v dílu není/);
    expect(await err({ ...box("x", [5, 5, 5], [0, 0, 40]), body: "Jiné" } as Feature)).toMatch(/Těleso „Jiné“ v dílu není – zvolte existující těleso, nebo operaci „Nové těleso“/);
  });

  it("preferované aktivní těleso dokumentu (activeBody) je ve výsledku první", async () => {
    const d: CadDoc = { ...doc([box("b", [100, 60, 20], [0, 0, 0], { mode: "new" }), { id: "sp", name: "Rozdělit", type: "splitBodies", plane: "YZ", offset: 40 }]), activeBody: "Těleso 2" };
    const res = await buildDoc(d);
    expect(res.bodies?.map((b) => [b.name, b.active])).toEqual([["Těleso 2", true], ["Těleso 1", false]]);
  });
});

describe("mezipaměť stavby – další stavba naváže na poslední shodný stav historie", () => {
  const base: Feature[] = [
    { id: "b", name: "Kvádr", type: "box", size: [100, 60, 20], position: [0, 0, 0], centered: false, mode: "new" },
    { id: "h1", name: "Díra 1", type: "hole", position: [20, 30, 20], axis: "Z", flip: false, diameter: 8, depth: 0, cbDiameter: 0, cbDepth: 0 },
    { id: "h2", name: "Díra 2", type: "hole", position: [50, 30, 20], axis: "Z", flip: false, diameter: 8, depth: 10, cbDiameter: 0, cbDepth: 0 },
  ];
  const h3: Feature = { id: "h3", name: "Díra 3", type: "hole", position: [80, 30, 20], axis: "Z", flip: false, diameter: 6, depth: 0, cbDiameter: 0, cbDepth: 0 };
  const progressOf = async (d: CadDoc, until = Infinity) => {
    const seen: number[] = [];
    const res = await buildShape(d, until, { onProgress: (p) => p.phase === "feature" && seen.push(p.index) });
    return { seen, res };
  };
  const vol = (res: { body: r.Shape3D | null }) => r.measureVolume(res.body!);

  it("přidaný prvek na konci: počítá se jen on, výsledek je stejný jako bez mezipaměti", async () => {
    clearBuildCache();
    const first = await progressOf(doc(base));
    expect(first.seen).toEqual([0, 1, 2]);
    const second = await progressOf(doc([...base, h3]));
    expect(second.seen).toEqual([3]);
    expect(second.res.status.map((s) => s.id)).toEqual(["b", "h1", "h2", "h3"]);
    expect(second.res.status.every((s) => s.ok)).toBe(true);
    const fresh = await buildShape(doc([...base, h3]), Infinity, { noCache: true });
    expect(vol(second.res)).toBeCloseTo(vol(fresh), 6);
    expect(second.res.body!.faces.length).toBe(fresh.body!.faces.length);
  });
  it("stejný dokument podruhé: žádný prvek se nepočítá; návrat v historii (untilIndex) také ne", async () => {
    clearBuildCache();
    await progressOf(doc([...base, h3]));
    const again = await progressOf(doc([...base, h3]));
    expect(again.seen).toEqual([]);
    expect(again.res.status).toHaveLength(4);
    const back = await progressOf(doc([...base, h3]), 1);
    expect(back.seen).toEqual([]);
    expect(back.res.status.map((s) => s.id)).toEqual(["b", "h1"]);
    expect(vol(back.res)).toBeCloseTo(100 * 60 * 20 - Math.PI * 16 * 20, 3);
  });
  it("změna prvku uprostřed: přepočítá se od něj dál; změna proměnné zneplatní vše", async () => {
    clearBuildCache();
    await progressOf(doc([...base, h3]));
    const edited = base.map((f) => (f.id === "h2" ? { ...f, depth: 15 } : f)) as Feature[];
    const mid = await progressOf(doc([...edited, h3]));
    expect(mid.seen).toEqual([2, 3]);
    const fresh = await buildShape(doc([...edited, h3]), Infinity, { noCache: true });
    expect(vol(mid.res)).toBeCloseTo(vol(fresh), 6);
    const withVar = await progressOf({ ...doc([...edited, h3]), variables: [{ name: "a", expr: "5" }] } as CadDoc);
    expect(withVar.seen).toEqual([0, 1, 2, 3]);
  });
  it("uložený stav přežije prvek, který původní těleso spotřebuje (transformace) a chybu prvku", async () => {
    clearBuildCache();
    const move: Feature = { id: "t", name: "Posun", type: "transform", translate: [10, 0, 0], rotate: [0, 0, 0], scale: 1 } as unknown as Feature;
    const bad: Feature = { id: "x", name: "Špatná díra", type: "hole", position: [0, 0, 0], axis: "Z", flip: false, diameter: -1, depth: 0, cbDiameter: 0, cbDepth: 0 };
    const a = await progressOf(doc([...base, move, bad]));
    expect(a.res.status.map((s) => s.ok)).toEqual([true, true, true, true, false]);
    const b = await progressOf(doc([...base, move, bad, h3]));
    expect(b.seen).toEqual([5]);
    expect(b.res.status.map((s) => s.ok)).toEqual([true, true, true, true, false, true]);
    const c = await progressOf(doc([...base, move]));
    expect(c.seen).toEqual([]);
    expect(c.res.body!.boundingBox.bounds[0][0]).toBeCloseTo(10, 6);
  });
  it("oběžné kolo: přidání díry k hotovému modelu B trvá zlomek první stavby", async () => {
    clearBuildCache();
    const d = fixture("impeller-B.mncad.json");
    const t0 = performance.now();
    await buildDoc(d);
    const first = performance.now() - t0;
    const t1 = performance.now();
    const res = await buildDoc({ ...d, features: [...d.features, { id: "nh", name: "Díra navíc", type: "hole", position: [0, 62.6, 29], axis: "Z", flip: false, diameter: 5, depth: 8, cbDiameter: 0, cbDepth: 0 }] });
    const second = performance.now() - t1;
    expect(res.status[res.status.length - 1]).toMatchObject({ id: "nh", ok: true });
    console.log(`model B: první stavba ${(first / 1000).toFixed(1)} s, s další dírou ${(second / 1000).toFixed(1)} s`);
    expect(second).toBeLessThan(first);
  }, 240_000);
});
