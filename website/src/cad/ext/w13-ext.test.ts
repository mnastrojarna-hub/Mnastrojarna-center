/**
 * 13. vlna, balík „ext“ – regresní testy chyb chování prvků rozšíření (18–25) nalezených při psaní mikronávodů:
 * výchozí operace Uzavřít do tělesa / Zesílit plochu, přísná Kontrola geometrie, lem Kapka, Průnik kopule, Zrcadlit prvky
 * s prvky rozšíření, Odsazená plocha bez originálu u vybraných ploch, úleva ohybu z hrany a německé slovo „senkrecht“.
 */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { parseAgentText } from "../agent";
import { applyEdit, type EditCmd } from "../agent-edit";
import { parseConstraints, parseDims } from "../agent-sketch";
import { buildDoc, buildShape } from "../build";
import { newExtFeature } from "../defaults";
import { dictOf } from "../i18n";
import { emptyDoc, type CadDoc, type Feature, type SketchEntity, type SketchPlane } from "../types";
import { checkShape, mirrorCandidates } from "./advanced";
import { getExt, hasExtTool, type ExtBuildCtx } from "./index";
import { flangeFieldState, flangeRelief } from "./sheetmetal";
import { bendAllowance, flangeGeometry, flangeNumber, flatLayout, type EdgeGeom } from "./sheetmetal-flat";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

let n = 0;
const id = () => `w${++n}`;
const XY: SketchPlane = { kind: "base", name: "XY", offset: 0 };
const sketch = (name: string, plane: SketchPlane, entities: SketchEntity[]): Feature => ({ id: id(), name, type: "sketch", plane, entities });
const rect = (w: number, h: number, cx = 0, cy = 0): SketchEntity => ({ id: id(), type: "rect", cx, cy, w, h, r: 0, angle: 0 });
const doc = (features: Feature[]): CadDoc => ({ ...emptyDoc("T"), features });
const ext = (d: CadDoc, e: string, data: Record<string, unknown> = {}): Feature => {
  const f = newExtFeature(d, e);
  if (f.type === "ext") f.data = { ...f.data, ...data };
  return f;
};
const errs = (res: { status: { ok: boolean; error?: string }[] }) => res.status.filter((s) => !s.ok).map((s) => s.error);
const box = (size: [number, number, number], position: [number, number, number] = [0, 0, 0]): Feature => ({ id: id(), name: "Kvádr", type: "box", size, position, centered: false, mode: "new" });

// ───────────── 18. Uzavřít do tělesa / Zesílit plochu: výchozí operace = Přidat (jako formulář) ─────────────
describe("18 – surf.close / surf.thicken: data a formulář se shodují", () => {
  /** kvádr 10×10×10 stranou (objem 1000) + uzavřená skořepina 40×20×10 z ploch (objem 8000) */
  const closedSurfaces = () => {
    const b = box([10, 10, 10], [100, 0, 0]);
    const sk = sketch("Deska", XY, [rect(40, 20)]);
    const top = sketch("Víko", { kind: "base", name: "XY", offset: 10 }, [rect(40, 20)]);
    const d = doc([b, sk, top]);
    return { d, list: [b, sk, top, ext(d, "surf.extrude", { sketchId: sk.id, distance: 10 }), ext(d, "surf.planar", { sketchId: sk.id }), ext(d, "surf.planar", { sketchId: top.id })], sk, b };
  };

  it("nový prvek má operaci Přidat (formulář ukazuje Přidat) a s tělesem v dílu ho zachová", async () => {
    const dataOf = (f: Feature) => (f.type === "ext" ? f.data : {});
    expect(dataOf(newExtFeature(doc([]), "surf.close")).mode).toBe("add");
    expect(dataOf(newExtFeature(doc([]), "surf.thicken")).mode).toBe("add");
    const { d, list } = closedSurfaces();
    const res = await buildDoc(doc([...list, newExtFeature(d, "surf.close")]));
    expect(errs(res)).toEqual([]);
    expect(res.metrics!.volume).toBeCloseTo(9000, 0); // dřív 8000: kvádr zmizel
  });

  it("zesílení plochy s výchozími daty kvádr také zachová", async () => {
    const { d, sk, b } = closedSurfaces();
    const res = await buildDoc(doc([b, sk, ext(d, "surf.planar", { sketchId: sk.id }), ext(d, "surf.thicken", { thickness: 5 })]));
    expect(errs(res)).toEqual([]);
    expect(res.metrics!.volume).toBeCloseTo(1000 + 4000, 0); // dřív 4000
  });

  it("starší dokument s uloženým mode „new“ se staví stejně jako dřív (nahradí tělesa) a formulář to ukáže čtvrtou volbou", async () => {
    const { d, list } = closedSurfaces();
    const res = await buildDoc(doc([...list, ext(d, "surf.close", { mode: "new" })]));
    expect(res.metrics!.volume).toBeCloseTo(8000, 0);
    const mode = getExt("surf.close")!.params!.find((p) => p.key === "mode");
    expect(mode).toMatchObject({ kind: "mode", newLabel: "Nahradit tělesa" });
    expect(getExt("surf.thicken")!.params!.find((p) => p.key === "mode")).toMatchObject({ newLabel: "Nahradit tělesa" });
  });

  it("bez tělesa v dílu dává Přidat stejný výsledek jako dřívější „new“", async () => {
    const { d, list } = closedSurfaces();
    const noBox = list.slice(1);
    const a = await buildDoc(doc([...noBox, ext(d, "surf.close", { mode: "add" })]));
    const b = await buildDoc(doc([...noBox, ext(d, "surf.close", { mode: "new" })]));
    expect(a.metrics!.volume).toBeCloseTo(8000, 0);
    expect(a.metrics!.volume).toBeCloseTo(b.metrics!.volume, 6);
  });
});

// ───────────── 19. Kontrola geometrie: parametr „Kontrolovat i geometrii ploch“ (strict) ─────────────
describe("19 – adv.check: strict = i geometrické kontroly, vypnuto = jen topologie", () => {
  /** hranol z plochy se samoprotínajícím obrysem: topologicky v pořádku, geometricky neplatný */
  const selfIntersecting = () => {
    const pts: [number, number][] = [[0, 0], [20, 0], [20, 10], [10, -5], [0, 10]];
    const w = r.assembleWire(pts.map((p, i) => r.makeLine([p[0], p[1], 0], [pts[(i + 1) % pts.length][0], pts[(i + 1) % pts.length][1], 0])));
    return r.basicFaceExtrusion(r.makeFace(w), new r.Vector([0, 0, 5])) as r.Shape3D;
  };
  const ctx = (body: r.Shape3D): ExtBuildCtx => ({ body, sketches: new Map(), doc: doc([]), index: 0, featureId: "chk", tools: new Map() });

  it("checkShape(…, false) kontroluje jen topologii", () => {
    const s = selfIntersecting();
    expect(checkShape(s, false)).toEqual([]);
    expect(checkShape(s, true).length).toBeGreaterThan(0);
    expect(checkShape(s).length).toBeGreaterThan(0); // výchozí = s geometrií (jako dřív)
  });

  it("prvek čte data.strict: zapnuto chyba s geometrií, vypnuto projde; bez klíče = zapnuto", async () => {
    const def = getExt("adv.check")!;
    const s = selfIntersecting();
    await expect(Promise.resolve().then(() => def.build!({ strict: true }, ctx(s)))).rejects.toThrow(/topologie i geometrie/);
    await expect(Promise.resolve().then(() => def.build!({}, ctx(s)))).rejects.toThrow(/není platné/);
    expect(await def.build!({ strict: false }, ctx(s))).toBe(s);
  });

  it("platné těleso projde v obou režimech a nemění se", async () => {
    const b = box([20, 20, 20]);
    for (const strict of [true, false]) {
      const res = await buildDoc(doc([b, ext(doc([b]), "adv.check", { strict })]));
      expect(errs(res)).toEqual([]);
      expect(res.metrics!.volume).toBeCloseTo(8000, 3);
    }
  });
});

// ───────────── plech: deska 100 × 60 × 2 ─────────────
const T = 2;
const K = 0.44;
async function plate(): Promise<{ d: CadDoc; body: r.Shape3D }> {
  const d = emptyDoc("Plech");
  d.features.push({ id: "s1", name: "Obrys", type: "sketch", plane: XY, entities: [{ id: "e1", type: "rect", cx: 0, cy: 0, w: 100, h: 60, r: 0, angle: 0 }] });
  const b = newExtFeature(d, "sheet.base", {});
  if (b.type === "ext") b.data = { ...b.data, sketchId: "s1", direction: "normal", t: T, r: 2, k: K };
  d.features.push(b);
  return { d, body: (await buildShape(d)).body! };
}
/** horní rovná hrana desky na y = const */
const edgeAtY = (body: r.Shape3D, y: number) => {
  const i = body.edges.findIndex((e) => e.geomType === "LINE" && Math.abs(e.startPoint.y - y) < 1e-6 && Math.abs(e.endPoint.y - y) < 1e-6 && Math.abs(e.startPoint.z - T) < 1e-6 && Math.abs(e.endPoint.z - T) < 1e-6);
  expect(i).toBeGreaterThanOrEqual(0);
  return i;
};
const resolver = (d: CadDoc) => async (fi: number, ei: number): Promise<EdgeGeom | null> => {
  const b = (await buildShape(d, fi - 1)).body;
  const e = b?.edges[ei];
  return e ? { a: [e.startPoint.x, e.startPoint.y, e.startPoint.z], b: [e.endPoint.x, e.endPoint.y, e.endPoint.z] } : null;
};
/** je v tělese materiál v malé krychli kolem bodu? */
const solidAt = (s: r.Shape3D, p: [number, number, number], h = 0.05) => r.measureVolume(s.clone().intersect(r.makeBox([p[0] - h, p[1] - h, p[2] - h], [p[0] + h, p[1] + h, p[2] + h]) as r.Shape3D)) > 1e-9;

// ───────────── 20. Lem Kapka ─────────────
describe("20 – sheet.hem Kapka: ohyb 180° + úhel uzavření, rameno šikmo k plechu", () => {
  it("geometrie: úhel 180 + φ, rameno končí těsně nad plechem; φ mimo 5–90° je chyba", () => {
    const g = flangeGeometry({ kind: "teardrop", radius: 1, closeAngle: 30 }, { t: T, r: 2, k: K }, true);
    expect(g.angle).toBe(210);
    expect(g.R).toBe(1);
    const a = (30 * Math.PI) / 180;
    expect(g.length).toBeCloseTo((1 * (1 + Math.cos(a)) - 0.1) / Math.sin(a), 9);
    expect(flangeGeometry({ kind: "open", radius: 1, length: 8 }, { t: T, r: 2, k: K }, true)).toEqual({ angle: 180, R: 1, length: 8 });
    expect(() => flangeGeometry({ kind: "teardrop", closeAngle: 120 }, { t: T, r: 2, k: K }, true)).toThrow(/5–90/);
  });

  it("kapka se staví jinak než otevřený lem: objem = deska + výseč 210° + rameno, rameno sestupuje k plechu", async () => {
    const { d, body } = await plate();
    const ei = edgeAtY(body, -30);
    const build = async (kind: string) => {
      const hem = ext(d, "sheet.hem", { edges: [ei], kind, radius: 1, length: 8, closeAngle: 30 });
      const res = await buildShape({ ...d, features: [...d.features, hem] });
      expect(res.status.map((s) => s.error ?? "ok")).toEqual(["ok", "ok", "ok"]);
      return res.body!;
    };
    const open = await build("open");
    const tear = await build("teardrop");
    const g = flangeGeometry({ kind: "teardrop", radius: 1, closeAngle: 30 }, { t: T, r: 2, k: K }, true);
    const sector = (Math.PI * ((1 + T) ** 2 - 1)) * (210 / 360);
    expect(r.measureVolume(tear)).toBeCloseTo(100 * 60 * T + 100 * (sector + g.length * T), 0);
    expect(Math.abs(r.measureVolume(tear) - r.measureVolume(open))).toBeGreaterThan(100); // dřív totožné (14856,637)
    // rámec ohybu: x = ven od hrany (svět −Y, hrana y = −30), y = nad horní plochou plechu (svět Z − T)
    // kapka: vnitřní hrana konce ramene v (−R·sin φ − L·cos φ; mezera 0,1); bod uprostřed tloušťky ramene 0,5 mm před koncem
    const a = (30 * Math.PI) / 180;
    const end: [number, number] = [-1 * Math.sin(a) - g.length * Math.cos(a), 0.1];
    const mid: [number, number] = [end[0] + 0.5 * Math.cos(a) - (T / 2) * Math.sin(a), end[1] + 0.5 * Math.sin(a) + (T / 2) * Math.cos(a)];
    const world = (q: [number, number]): [number, number, number] => [0, -30 - q[0], T + q[1]];
    expect(solidAt(tear, world(mid))).toBe(true); // materiál ramene nízko nad plechem
    expect(solidAt(open, world(mid))).toBe(false); // u otevřeného lemu je tam vzduch (rameno je vodorovně až ve výšce 2R)
    expect(solidAt(open, world([mid[0], 2 * 1 + T / 2]))).toBe(true); // otevřený lem: rameno nahoře (2R + t/2)
    expect(solidAt(tear, world([end[0], 0.05]))).toBe(false); // mezi koncem ramene a plechem zůstává mezera
  }, 60_000);

  it("rozvin kapky: úhel 210°, délka = 60 + BA(210°) + dopočtené rameno", async () => {
    const { d, body } = await plate();
    const hem = ext(d, "sheet.hem", { edges: [edgeAtY(body, -30)], kind: "teardrop", radius: 1, closeAngle: 30 });
    d.features.push(hem);
    const lay = await flatLayout(d, resolver(d));
    expect(lay.bends[0].angle).toBe(210);
    const g = flangeGeometry({ kind: "teardrop", radius: 1, closeAngle: 30 }, { t: T, r: 2, k: K }, true);
    expect(lay.bbox[1][1] - lay.bbox[0][1]).toBeCloseTo(60 + bendAllowance(210, 1, T, K) + g.length, 4);
  }, 60_000);

  it("formulář: úhel uzavření jen u kapky, délka u kapky zašedlá s dopočtenou hodnotou, poloměr u uzavřeného zašedlý", () => {
    const p = { t: T, r: 2, k: K };
    expect(flangeFieldState("sheet.hem", "closeAngle", { kind: "open" }, p).off).toBe(true);
    expect(flangeFieldState("sheet.hem", "closeAngle", { kind: "teardrop" }, p).off).toBeFalsy();
    const len = flangeFieldState("sheet.hem", "length", { kind: "teardrop", radius: 1, closeAngle: 30 }, p);
    expect(len.off).toBe(true);
    expect(len.note).toMatch(/3,53 mm/);
    expect(flangeFieldState("sheet.hem", "radius", { kind: "closed" }, p).off).toBe(true);
    expect(flangeFieldState("sheet.hem", "length", { kind: "open" }, p)).toEqual({});
  });
});

// ───────────── 21. Kopule – Průnik ─────────────
describe("21 – adv.dome Průnik: vyklenutí plochy dovnitř tělesa", () => {
  const cyl = (): Feature => ({ id: "c", name: "Válec", type: "cylinder", radius: 20, height: 50, position: [0, 0, 0], axis: "Z", mode: "new" });
  const top = () => (r.makeCylinder(20, 50) as r.Shape3D).faces.findIndex((f) => f.geomType === "PLANE" && f.center.z > 25);

  it("válec R20 × 50, kopule h = 5 Průnik: objem = π·R²·45 + 2/3·π·R²·5, vrchol v rovině plochy", async () => {
    const add = await buildDoc(doc([cyl(), ext(doc([cyl()]), "adv.dome", { faces: [top()], height: 5, radius: 0, mode: "add" })]));
    const res = await buildDoc(doc([cyl(), ext(doc([cyl()]), "adv.dome", { faces: [top()], height: 5, radius: 0, mode: "intersect" })]));
    expect(errs(res)).toEqual([]);
    const expected = Math.PI * 400 * 45 + (2 / 3) * Math.PI * 400 * 5;
    expect(Math.abs(res.metrics!.volume - expected) / expected).toBeLessThan(0.005);
    expect(res.metrics!.bbox[1][2]).toBeCloseTo(50, 3); // nic nad původní plochou
    expect(Math.abs(res.metrics!.volume - add.metrics!.volume)).toBeGreaterThan(1000); // dřív stejné jako Přidat (66984,4)
  });

  it("na čtvercové ploše se mimo kruh kopule ubere materiál jen v obrysu vybrané plochy (h hluboko)", async () => {
    const b = box([40, 40, 20]);
    const t = (r.makeBox([0, 0, 0], [40, 40, 20]) as r.Shape3D).faces.findIndex((f) => f.geomType === "PLANE" && f.center.z > 19);
    const res = await buildDoc(doc([b, ext(doc([b]), "adv.dome", { faces: [t], height: 4, radius: 0, mode: "intersect" })]));
    expect(errs(res)).toEqual([]);
    const expected = 40 * 40 * 16 + (2 / 3) * Math.PI * 400 * 4;
    expect(Math.abs(res.metrics!.volume - expected) / expected).toBeLessThan(0.005);
  });
});

// ───────────── 22. Zrcadlit prvky: rovina odkazem a prvky rozšíření ─────────────
describe("22 – adv.mirrorFeatures zrcadlí i prvky rozšíření", () => {
  const setup = () => {
    const b = box([100, 40, 20]);
    const sk = sketch("Profil", XY, [rect(10, 10, 20, 20)]);
    const tw = ext(doc([b, sk]), "adv.twist", { sketch: sk.id, height: 10, angle: 45, mode: "cut" });
    return { b, sk, tw };
  };

  it("zkrut (odebrat) zrcadlený rovinou YZ v x = 50 odebere podruhé stejný objem", async () => {
    const { b, sk, tw } = setup();
    const one = await buildDoc(doc([b, sk, tw]));
    const removed = 80000 - one.metrics!.volume;
    expect(removed).toBeGreaterThan(900);
    const m = ext(doc([b, sk, tw]), "adv.mirrorFeatures", { features: [tw.id], plane: "YZ", offset: 50 });
    const res = await buildDoc(doc([b, sk, tw, m]));
    expect(errs(res)).toEqual([]); // dřív „Vyberte dřívější prvek s tělesem“
    expect(res.metrics!.volume).toBeCloseTo(80000 - 2 * removed, 0);
  });

  it("rovina odkazem (planeDef) má přednost před základní rovinou", async () => {
    const { b, sk, tw } = setup();
    const one = await buildDoc(doc([b, sk, tw]));
    const removed = 80000 - one.metrics!.volume;
    const m = ext(doc([b, sk, tw]), "adv.mirrorFeatures", { features: [tw.id], plane: "XY", offset: 0, planeDef: { kind: "base", name: "YZ", offset: 50 } });
    const res = await buildDoc(doc([b, sk, tw, m]));
    expect(errs(res)).toEqual([]);
    expect(res.metrics!.volume).toBeCloseTo(80000 - 2 * removed, 0);
  });

  it("kopule (důlek) jako prvek rozšíření jde zrcadlit; nabídka formuláře obsahuje prvky rozšíření s nástrojovým tělesem", async () => {
    const b = box([100, 40, 20]);
    const t = (r.makeBox([0, 0, 0], [100, 40, 20]) as r.Shape3D).faces.findIndex((f) => f.geomType === "PLANE" && f.center.z > 19);
    const dome = ext(doc([b]), "adv.dome", { faces: [t], height: 5, radius: 8, mode: "cut" });
    const one = await buildDoc(doc([b, dome]));
    const removed = 80000 - one.metrics!.volume;
    const m = ext(doc([b, dome]), "adv.mirrorFeatures", { features: [dome.id], plane: "XZ", offset: 0 });
    const res = await buildDoc(doc([b, dome, m]));
    expect(errs(res)).toEqual([]);
    expect(res.metrics!.volume).toBeLessThan(80000); // důlek uprostřed + zrcadlený přes XZ (y = 0) mimo těleso
    expect(res.metrics!.volume).toBeCloseTo(80000 - removed, 0);
    const sk = sketch("S", XY, [rect(4, 4)]);
    const tw = ext(doc([b, sk]), "adv.twist", { sketch: sk.id });
    const fillet = ext(doc([b]), "adv.check", {});
    const list = mirrorCandidates(doc([b, sk, dome, tw, fillet, m]), m.id).map((f) => f.id);
    expect(list).toEqual([b.id, dome.id, tw.id]); // skica a prvek bez nástrojového tělesa (kontrola) chybí
    for (const e of ["adv.twist", "adv.dome", "adv.textOnCyl", "adv.lipGroove", "adv.holesAtPoints", "surf.helixSweep", "weld.member"]) expect(!!getExt(e)?.toolBody, e).toBe(true); // weld.member: podle dat (kontrola 5)
  });
});

// ───────────── 23. Odsazená plocha: Zachovat původní plochu i u vybraných ploch ─────────────
describe("23 – surf.offset: keepOriginal platí i pro vybrané plochy", () => {
  const twoPlates = () => {
    const a = sketch("A", XY, [rect(40, 20)]);
    const b = sketch("B", { kind: "base", name: "XY", offset: 30 }, [rect(40, 20)]);
    const d = doc([a, b]);
    return { d, list: [a, b, ext(d, "surf.planar", { sketchId: a.id }), ext(d, "surf.planar", { sketchId: b.id })] };
  };
  it("vybraná volná plocha bez zachování se nahradí odsazenou, druhá volná zůstane", async () => {
    const { d, list } = twoPlates();
    const keep = await buildDoc(doc([...list, ext(d, "surf.offset", { faces: [0], distance: 5, keepOriginal: true })]));
    const drop = await buildDoc(doc([...list, ext(d, "surf.offset", { faces: [0], distance: 5, keepOriginal: false })]));
    expect(errs(drop)).toEqual([]);
    expect(keep.metrics!.faces).toBe(3);
    expect(drop.metrics!.faces).toBe(2); // dřív 3 – originál zůstal
    expect(drop.metrics!.area).toBeCloseTo(1600, 3);
  });
  it("plocha tělesa (solidu) zůstat musí – ohlásí se varováním, ne potichu", async () => {
    const b = box([40, 20, 10]);
    const t = (r.makeBox([0, 0, 0], [40, 20, 10]) as r.Shape3D).faces.findIndex((f) => f.geomType === "PLANE" && f.center.z > 9);
    const res = await buildDoc(doc([b, ext(doc([b]), "surf.offset", { faces: [t], distance: 5, keepOriginal: false })]));
    expect(errs(res)).toEqual([]);
    expect(res.status[1].warning).toMatch(/plochu solidu odstranit nelze/);
    expect(res.body!.solids.length).toBe(1);
    expect(r.measureVolume(res.body!.solids[0])).toBeCloseTo(8000, 3); // těleso zůstalo celé
    expect(res.body!.faces.length).toBe(7); // 6 ploch kvádru + odsazená
  });
});

// ───────────── 24. Ohyb z hrany: úleva ohybu ─────────────
describe("24 – sheet.flange: úleva ohybu v obou polohách materiálu, přes celou tloušťku", () => {
  const flange = async (data: Record<string, unknown>) => {
    const { d, body } = await plate();
    const fl = ext(d, "sheet.flange", { edges: [edgeAtY(body, 30)], length: 20, angle: 90, radius: 0, ...data });
    const res = await buildShape({ ...d, features: [...d.features, fl] });
    expect(res.status.map((s) => s.error ?? "ok")).toEqual(["ok", "ok", "ok"]);
    return res.body!;
  };
  it("Ohyb vně: obdélníková úleva 4 × 5 ubere 2 zářezy přes celou tloušťku (dřív beze změny)", async () => {
    const none = r.measureVolume(await flange({ position: "bendOutside", relief: "none" }));
    const rect = await flange({ position: "bendOutside", relief: "rect", reliefWidth: 4, reliefDepth: 5 });
    expect(none - r.measureVolume(rect)).toBeCloseTo(2 * 4 * 5 * T, 2);
    expect(solidAt(rect, [-48, 27.5, 0.3])).toBe(false); // zářez i u spodní plochy plechu
    expect(solidAt(rect, [-45, 27.5, 0.3])).toBe(true);
  }, 60_000);
  it("Materiál uvnitř: pruh se odebere celý (bez zbytku ve spodní polovině) a hloubka 0 = tloušťka plechu", async () => {
    const none = await flange({ position: "materialInside", relief: "none" });
    const out = r.measureVolume(await flange({ position: "bendOutside", relief: "none" }));
    // R + t = 4 mm pruhu × 100 × 2 odebráno, ohyb stejný jako vně → rozdíl přesně 800 (dřív 581,3 – zbytek v dolní polovině tloušťky)
    expect(out - r.measureVolume(none)).toBeCloseTo(800, 2);
    const auto = await flange({ position: "materialInside", relief: "rect", reliefWidth: 4, reliefDepth: 0 });
    expect(r.measureVolume(none) - r.measureVolume(auto)).toBeCloseTo(2 * 4 * T * T, 2); // hloubka 0 → t = 2 za začátek ohybu
  }, 90_000);
  it("rozvin úlevu nekreslí – ohlásí to varováním (ne potichu)", async () => {
    const { d, body } = await plate();
    d.features.push(ext(d, "sheet.flange", { edges: [edgeAtY(body, 30)], length: 20, relief: "rect", reliefWidth: 4 }));
    const lay = await flatLayout(d, resolver(d));
    expect(lay.warnings.join(" ")).toMatch(/úleva ohybu se v rozvinu nekreslí/);
  }, 60_000);
  it("formulář: šířka a hloubka úlevy zašedlé bez druhu úlevy; hloubka vysvětlí 0 = t; záporná hloubka je chyba", () => {
    const p = { t: T, r: 2, k: K };
    expect(flangeFieldState("sheet.flange", "reliefWidth", { relief: "none" }, p).off).toBe(true);
    expect(flangeFieldState("sheet.flange", "reliefDepth", { relief: "rect" }, p)).toEqual({ note: "za začátek ohybu; 0 = tloušťka plechu (2 mm)" });
    expect(flangeRelief({ relief: "rect", reliefDepth: 0 }, 3)).toEqual({ rw: 3, rd: 3 });
    expect(flangeRelief({ relief: "none" }, 3)).toBeNull();
    expect(() => flangeRelief({ relief: "rect", reliefDepth: -1 }, 3)).toThrow(/záporná/);
  });
});

// ───────────── 25. Německý parser skici: senkrecht = kolmo ─────────────
describe("25 – DE: senkrecht = kolmo, vertikal = svisle, waagerecht = vodorovně", () => {
  it("vazby", () => {
    expect(parseConstraints("bedingung senkrecht e1 e2")[0]).toMatchObject({ type: "perpendicular" });
    expect(parseConstraints("rechtwinklig e1 e2")[0]).toMatchObject({ type: "perpendicular" });
    expect(parseConstraints("senkrecht e2.s0 e2.s1")[0]).toMatchObject({ type: "perpendicular" }); // strany obdélníku jsou úsečky
    expect(parseConstraints("vertikal e1")[0]).toMatchObject({ type: "vertical" });
    expect(parseConstraints("lotrecht e1.a e2.b")[0]).toMatchObject({ type: "vertical" });
    expect(parseConstraints("waagerecht e1")[0]).toMatchObject({ type: "horizontal" });
    expect(parseConstraints("horizontal e1")[0]).toMatchObject({ type: "horizontal" });
  });
  it("starý skript se „senkrecht“ pro svislou úsečku / dva body dostane jasnou radu místo tiché záměny", () => {
    expect(() => parseConstraints("senkrecht e1")).toThrow(/„senkrecht“ = kolmo.*„vertikal“/);
    expect(() => parseConstraints("senkrecht e1.a e2.b")).toThrow(/„vertikal“/);
  });
  it("kóty: svislá kóta je „vertikal“, „senkrecht“ dál platí (kolmá kóta neexistuje)", () => {
    expect(parseDims("bemaßung vertikal e1.a e2.b 20")[0]).toMatchObject({ type: "vertical" });
    expect(parseDims("bemaßung senkrecht e1.a e2.b 20")[0]).toMatchObject({ type: "vertical" });
  });
  it("německé texty protokolu se dají napsat zpět: svisle → vertikal, kolmo → senkrecht; nástroj skici Skalieren ≠ Maßstab výkresu", () => {
    const de = dictOf("de");
    expect(de["svisle"]).toBe("vertikal");
    expect(de["kolmo"]).toBe("senkrecht");
    expect(parseConstraints(`${de["svisle"]} e1`)[0].type).toBe("vertical");
    expect(parseConstraints(`${de["kolmo"]} e1 e2`)[0].type).toBe("perpendicular");
    expect(de["Změnit měřítko"]).toBe("Skalieren");
    expect(de["Měřítko"]).toBe("Maßstab");
    expect(dictOf("en")["Změnit měřítko"]).toBe("Scale");
  });
});

// ───────────── textové příkazy (obecný příkaz prvek) pro nové volby ─────────────
describe("textem: prvek … s novými volbami", () => {
  const featureOf = (text: string) => {
    const p = parseAgentText(text);
    expect(p.errors).toEqual([]);
    const op = p.ops.find((o) => o.k === "feature") as { feature: Feature } | undefined;
    expect(op).toBeTruthy();
    return op!.feature as Extract<Feature, { type: "ext" }>;
  };
  it("kapka, průnik kopule, strict, keepOriginal, úleva", () => {
    expect(featureOf("prvek sheet.hem edges=1 kind=teardrop radius=1 closeAngle=30").data).toMatchObject({ kind: "teardrop", radius: 1, closeAngle: 30 });
    expect(featureOf("prvek adv.dome faces=1 height=5 mode=intersect").data).toMatchObject({ mode: "intersect" });
    expect(featureOf("prvek adv.check strict=ne").data).toMatchObject({ strict: false });
    expect(featureOf("prvek surf.offset faces=1 distance=5 keepOriginal=ne").data).toMatchObject({ keepOriginal: false });
    expect(featureOf("prvek sheet.flange edges=1 relief=rect reliefWidth=4 reliefDepth=0").data).toMatchObject({ relief: "rect", reliefWidth: 4, reliefDepth: 0 });
    expect(featureOf("prvek surf.close").data).toMatchObject({ mode: "add" });
  });
});

// ───────────── nálezy kontroly (13. vlna, ext – 2. kolo) ─────────────
describe("kontrola 1 – Zrcadlit prvky „Všechny dosavadní prvky“: bez základního tělesa, původní kapsy zůstanou", () => {
  const holeAt = (x: number, y: number): Feature => ({ id: id(), name: "Díra", type: "hole", position: [x, y, 20], axis: "Z", flip: false, diameter: 8, depth: 0, cbDiameter: 0, cbDepth: 0 });
  it("zkrut (odebrat) + all: obě kapsy (dřív zrcadlený kvádr zaplnil původní kapsu)", async () => {
    const b = box([100, 40, 20]);
    const sk = sketch("Profil", XY, [rect(10, 10, 20, 20)]);
    const tw = ext(doc([b, sk]), "adv.twist", { sketch: sk.id, height: 10, angle: 45, mode: "cut" });
    const one = await buildDoc(doc([b, sk, tw]));
    const removed = 80000 - one.metrics!.volume;
    const sel = await buildDoc(doc([b, sk, tw, ext(doc([b, sk, tw]), "adv.mirrorFeatures", { features: [tw.id], plane: "YZ", offset: 50 })]));
    const all = await buildDoc(doc([b, sk, tw, ext(doc([b, sk, tw]), "adv.mirrorFeatures", { all: true, plane: "YZ", offset: 50 })]));
    expect(errs(all)).toEqual([]);
    expect(all.metrics!.volume).toBeCloseTo(80000 - 2 * removed, 0); // dřív 80000 − removed (79,05 cm³)
    expect(all.metrics!.volume).toBeCloseTo(sel.metrics!.volume, 3);
  });
  it("vestavěná díra + all: dvě díry (dřív 78,99 cm³ = jen zrcadlená)", async () => {
    const b = box([100, 40, 20]);
    const h = holeAt(20, 20);
    const all = await buildDoc(doc([b, h, ext(doc([b, h]), "adv.mirrorFeatures", { all: true, plane: "YZ", offset: 50 })]));
    expect(errs(all)).toEqual([]);
    expect(all.metrics!.volume).toBeCloseTo(80000 - 2 * Math.PI * 16 * 20, 0); // 77 989 mm³
  });
  it("základní těleso s operací Přidat (bez tělesa před ním) se také vynechá; jen základní těleso = srozumitelná chyba", async () => {
    const b: Feature = { ...box([100, 40, 20]), mode: "add" } as Feature;
    const h = holeAt(20, 20);
    const all = await buildDoc(doc([b, h, ext(doc([b, h]), "adv.mirrorFeatures", { all: true, plane: "YZ", offset: 50 })]));
    expect(all.metrics!.volume).toBeCloseTo(80000 - 2 * Math.PI * 16 * 20, 0);
    const sk = sketch("Profil", XY, [rect(10, 10, 20, 20)]);
    const tw = ext(doc([sk]), "adv.twist", { sketch: sk.id, height: 10, angle: 45, mode: "new" });
    const only = await buildDoc(doc([sk, tw, ext(doc([sk, tw]), "adv.mirrorFeatures", { all: true, plane: "YZ", offset: 50 })]));
    expect(errs(only)[0]).toMatch(/základního tělesa/);
    // výslovně vybrané základní těleso se zrcadlí dál (uživatel ho zaškrtl)
    const pick = await buildDoc(doc([sk, tw, ext(doc([sk, tw]), "adv.mirrorFeatures", { features: [tw.id], plane: "YZ", offset: 50 })]));
    expect(pick.metrics!.volume).toBeCloseTo(2000, 0);
  });
});

describe("kontrola 5 – Konstrukční profil jako samostatná tělesa nástroj neukládá, a tak se k zrcadlení nenabízí", () => {
  it("mirrorCandidates / hasExtTool podle dat prvku", () => {
    const sk = sketch("Čára", XY, [{ id: id(), type: "line", a: [0, 0], b: [100, 0] } as SketchEntity]);
    const sep = ext(doc([sk]), "weld.member", { sketchId: sk.id, separate: true });
    const one = ext(doc([sk]), "weld.member", { sketchId: sk.id, separate: false });
    const m = ext(doc([sk, sep, one]), "adv.mirrorFeatures", {});
    expect(mirrorCandidates(doc([sk, sep, one, m]), m.id).map((f) => f.id)).toEqual([one.id]);
    expect(hasExtTool(sep)).toBe(false);
    expect(hasExtTool(one)).toBe(true);
    expect(hasExtTool(ext(doc([sk]), "adv.check", {}))).toBe(false);
  });
});

describe("kontrola 6 – Zrcadlit prvky textem: features názvem, jedním id i seznamem", () => {
  const featureOf = (text: string) => {
    const p = parseAgentText(text);
    expect(p.errors).toEqual([]);
    return (p.ops.find((o) => o.k === "feature") as { feature: Extract<Feature, { type: "ext" }> }).feature;
  };
  it("parser uloží seznam (i z jedné hodnoty)", () => {
    expect(featureOf('prvek adv.mirrorFeatures features="Zkrut" plane=XZ offset=20').data.features).toEqual(["Zkrut"]);
    expect(featureOf("prvek adv.mirrorFeatures features=w12").data.features).toEqual(["w12"]);
    expect(featureOf('prvek adv.mirrorFeatures features=["Zkrut","Díra 1"]').data.features).toEqual(["Zkrut", "Díra 1"]);
    expect(getExt("adv.mirrorFeatures")!.params!.find((p) => p.key === "features")).toMatchObject({ kind: "features" });
  });
  it("upravit … features=\"Zkrut\" uloží id (stejně jako u prvku pole)", async () => {
    const b = box([100, 40, 20]);
    const sk = sketch("Profil", XY, [rect(10, 10, 20, 20)]);
    const tw = { ...ext(doc([b, sk]), "adv.twist", { sketch: sk.id, mode: "cut" }), name: "Zkrut" } as Feature;
    const m = { ...ext(doc([b, sk, tw]), "adv.mirrorFeatures", {}), name: "Zrcadlo" } as Feature;
    const p = parseAgentText('upravit "Zrcadlo" features="Zkrut"');
    expect(p.errors).toEqual([]);
    const r = await applyEdit(doc([b, sk, tw, m]), (p.ops[0] as unknown as { cmd: EditCmd }).cmd);
    expect((r.doc.features[3] as Extract<Feature, { type: "ext" }>).data.features).toEqual([tw.id]);
  });
  it("stavba přijme název prvku i jedno id jako text; neznámý název = chyba s nabídkou", async () => {
    const b = box([100, 40, 20]);
    const sk = sketch("Profil", XY, [rect(10, 10, 20, 20)]);
    const tw = { ...ext(doc([b, sk]), "adv.twist", { sketch: sk.id, height: 10, angle: 45, mode: "cut" }), name: "Zkrut" } as Feature;
    const one = await buildDoc(doc([b, sk, tw]));
    const removed = 80000 - one.metrics!.volume;
    for (const features of [["zkrut"], "Zkrut", tw.id]) {
      const res = await buildDoc(doc([b, sk, tw, ext(doc([b, sk, tw]), "adv.mirrorFeatures", { features, plane: "YZ", offset: 50 })]));
      expect(errs(res), JSON.stringify(features)).toEqual([]);
      expect(res.metrics!.volume).toBeCloseTo(80000 - 2 * removed, 0); // dřív chyba „Vyberte prvky…“ (text místo seznamu id)
    }
    const bad = await buildDoc(doc([b, sk, tw, ext(doc([b, sk, tw]), "adv.mirrorFeatures", { features: ["Neni"], plane: "YZ", offset: 50 })]));
    expect(errs(bad)[0]).toMatch(/„Neni“.*Zkrut/);
  });
});

describe("kontrola 7 – Kopule na ploše s dírou uprostřed: poloměr z vnějšího obrysu, kopule mimo materiál = chyba", () => {
  const part = () => {
    const b: Feature = { id: id(), name: "Kvádr", type: "box", size: [40, 40, 20], position: [0, 0, 0], centered: true, mode: "new" } as Feature;
    const h: Feature = { id: id(), name: "Díra", type: "hole", position: [0, 0, 10], axis: "Z", flip: false, diameter: 10, depth: 0, cbDiameter: 0, cbDepth: 0 };
    return { b, h };
  };
  const topOf = async (d: CadDoc) => (await buildShape(d)).body!.faces.findIndex((f) => f.geomType === "PLANE" && f.center.z > 9.9);
  it("Průnik: vyklenutí s R = 20 (dřív R = poloměr díry a odebrala se celá vrstva 5 mm)", async () => {
    const { b, h } = part();
    const base = doc([b, h]);
    const v0 = (await buildDoc(base)).metrics!.volume;
    expect(v0).toBeCloseTo(32000 - Math.PI * 25 * 20, 0);
    const res = await buildDoc(doc([b, h, ext(base, "adv.dome", { faces: [await topOf(base)], height: 5, radius: 0, mode: "intersect" })]));
    expect(errs(res)).toEqual([]);
    const removed = 40 * 40 * 5 - (2 / 3) * Math.PI * 400 * 5; // jako bez díry (v díře kopule skoro nic neubere)
    expect(Math.abs(v0 - res.metrics!.volume - removed) / removed).toBeLessThan(0.01); // dřív 7 607 (celá vrstva)
  });
  it("ruční poloměr menší než díra: kopule leží jen nad dírou → chyba místo tiché celé vrstvy", async () => {
    const { b, h } = part();
    const base = doc([b, h]);
    const res = await buildDoc(doc([b, h, ext(base, "adv.dome", { faces: [await topOf(base)], height: 5, radius: 4, mode: "intersect" })]));
    expect(errs(res)[0]).toMatch(/mimo materiál plochy/);
  });
});

describe("kontrola 3 – formulář lemu ukazuje u chybějící hodnoty to, s čím počítá stavba", () => {
  it("starší kapka bez closeAngle: formulář 30° (dřív 0), stavba 30°; lem bez délky 10 mm", () => {
    const p = { t: T, r: 2, k: K };
    expect(flangeNumber("sheet.hem", "closeAngle", { kind: "teardrop" }, p)).toBe(30);
    expect(flangeGeometry({ kind: "teardrop", radius: 1 }, p, true)).toEqual(flangeGeometry({ kind: "teardrop", radius: 1, closeAngle: 30 }, p, true));
    expect(flangeNumber("sheet.hem", "length", {}, p)).toBe(flangeGeometry({}, p, true).length);
    expect(flangeNumber("sheet.flange", "length", {}, p)).toBe(flangeGeometry({}, p, false).length);
    expect(flangeNumber("sheet.flange", "angle", {}, p)).toBe(90);
    expect(flangeNumber("sheet.flange", "reliefWidth", { relief: "rect" }, p)).toBe(T);
    expect(flangeNumber("sheet.flange", "reliefWidth", { reliefWidth: 4 }, p)).toBe(4);
  });
});

describe("kontrola 4 – 3D Rozvinout hlásí, co v rozvinu chybí (úleva ohybu)", () => {
  it("varování u prvku Rozvinout, ne tichý ✓", async () => {
    const { d, body } = await plate();
    d.features.push(ext(d, "sheet.flange", { edges: [edgeAtY(body, 30)], length: 20, angle: 90, radius: 0, relief: "rect", reliefWidth: 4, reliefDepth: 5 }));
    d.features.push(ext(d, "sheet.unfold", {}));
    const res = await buildShape(d);
    expect(res.status.map((s) => s.error ?? "ok")).toEqual(["ok", "ok", "ok", "ok"]);
    expect(res.status[3].warning).toMatch(/úleva ohybu se v rozvinu nekreslí/);
  }, 90_000);
});

describe("kontrola 2 – DE výkres: protokol píše „vertikal“ a parser výkresu ho přijme", () => {
  it("zeichnung maß vertikal = svislá kóta; senkrecht dál platí", () => {
    const cmd = (t: string) => {
      const p = parseAgentText(t);
      expect(p.errors).toEqual([]);
      const op = p.ops[0];
      return op.k === "drawingCmd" ? op.cmd : op;
    };
    expect(cmd("zeichnung maß vertikal ansicht vorne 100 0 100 20")).toMatchObject({ dim: { kind: "vertical" } });
    expect(cmd("zeichnung maß senkrecht ansicht vorne 100 0 100 20")).toMatchObject({ dim: { kind: "vertical" } });
    expect(cmd("zeichnung maß horizontal ansicht vorne 0 0 100 0")).toMatchObject({ dim: { kind: "horizontal" } });
    expect(dictOf("de")["svisle"]).toBe("vertikal"); // slovo protokolu (drawing-marks KIND_NAME) = slovo parseru
  });
});
