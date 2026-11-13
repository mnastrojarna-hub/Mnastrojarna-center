import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc, buildShape } from "../build";
import { checkShape } from "../check";
import { newExtFeature } from "../defaults";
import { emptyDoc, type CadDoc, type Feature, type Vec3 } from "../types";
import "./index";
import { filletSize, grooveAreaFormula, prepDef, reinforcementArea, segmentArea, type GroovePrep, type WeldInfo } from "./weld-calc";
import { weldTable, weldTableText } from "./weld-table";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

type DocResult = Awaited<ReturnType<typeof buildDoc>>;
let nid = 0;
const box = (size: Vec3, position: Vec3, extra: Partial<Feature> = {}): Feature => ({ id: `b${++nid}`, name: `Deska ${nid}`, type: "box", size, position, centered: false, mode: "new", ...extra }) as Feature;
const ext = (doc: CadDoc, id: string, data: Record<string, unknown>): Feature => {
  const f = newExtFeature(doc, id, {});
  if (f.type === "ext") f.data = { ...f.data, ...data };
  return f;
};
const docOf = (features: Feature[]): CadDoc => ({ ...emptyDoc("Svary"), features });
const ok = (res: DocResult) => expect(res.status.every((s) => s.ok), res.status.map((s) => s.error).filter(Boolean).join(" | ")).toBe(true);
const infoOf = (res: DocResult, id: string) => (res.status.find((s) => s.id === id)?.data as { weld?: WeldInfo } | undefined)?.weld;
const bodyVol = (res: DocResult, name: string) => res.bodies?.find((b) => b.name === name)?.volume ?? NaN;
/** index plochy zobrazeného modelu podle středu a normály */
function faceIndex(res: DocResult, c: Partial<Record<"x" | "y" | "z", number>>, n: Vec3): number {
  const i = res.body!.faces.findIndex((f) => {
    const cc = f.center;
    const nn = f.normalAt(f.center);
    return f.geomType === "PLANE" && Object.entries(c).every(([k, v]) => Math.abs((cc as unknown as Record<string, number>)[k] - v) < 1e-4) && Math.abs(nn.x - n[0]) + Math.abs(nn.y - n[1]) + Math.abs(nn.z - n[2]) < 1e-4;
  });
  expect(i, JSON.stringify({ c, n })).toBeGreaterThanOrEqual(0);
  return i;
}
/** index rovné hrany podle obou koncových bodů (v libovolném pořadí) */
function edgeIndex(res: DocResult, a: Vec3, b: Vec3): number {
  const near = (p: { x: number; y: number; z: number }, q: Vec3) => Math.hypot(p.x - q[0], p.y - q[1], p.z - q[2]) < 1e-4;
  const i = res.body!.edges.findIndex((e) => e.geomType === "LINE" && ((near(e.startPoint, a) && near(e.endPoint, b)) || (near(e.startPoint, b) && near(e.endPoint, a))));
  expect(i, JSON.stringify({ a, b })).toBeGreaterThanOrEqual(0);
  return i;
}
const spec = (prep: GroovePrep, o: { t: number; c?: number; g?: number; angle?: number; R?: number; cap?: number; root?: number }) => {
  const d = prepDef(prep)!;
  return { prep, t: o.t, c: o.c ?? d.c, g: o.g ?? d.g, angle: o.angle ?? d.angle, R: o.R ?? d.R, cap: o.cap ?? 1.5, root: o.root ?? 0, backing: false, overlap: 1 };
};

/** dvě desky 100 × 200 × t za sebou ve směru X s mezerou g (dvě tělesa) */
function buttPlates(t: number, g: number): CadDoc {
  return docOf([box([100, 200, t], [-100, 0, 0]), box([100, 200, t], [g, 0, 0], { body: "Těleso 2" })]);
}

describe("tupý svar s úpravou (OCCT)", () => {
  it("V 60°, otupení 1, mezera 2 na tupém spoji dvou desek: drážka do obou desek, svar = těleso Svar 1", async () => {
    const base = buttPlates(10, 2);
    const b0 = await buildDoc(base);
    ok(b0);
    const face = faceIndex(b0, { x: 0, z: 5 }, [1, 0, 0]);
    const g = ext(base, "weld.groove", { faces: [face], prep: "V", angle: 60, rootFace: 1, gap: 2, cap: 1.5 });
    const res = await buildDoc({ ...base, features: [...base.features, g] });
    ok(res);
    const s = spec("V", { t: 10, c: 1, g: 2, angle: 60 });
    const area = grooveAreaFormula(s) + reinforcementArea(s);
    expect(area).toBeCloseTo(2 * 10 + 81 * Math.tan(Math.PI / 6) + segmentArea(2 + 2 * 9 * Math.tan(Math.PI / 6) + 2, 1.5), 9);
    const w = infoOf(res, g.id)!;
    expect(w.kind).toBe("groove");
    expect(w.joint).toBe("butt");
    expect(w.length).toBeCloseTo(200, 6);
    expect(w.volume / (area * 200)).toBeCloseTo(1, 3);
    expect(w.mass).toBeCloseTo(w.volume * 7.85e-6, 9);
    expect(w.filler).toBeCloseTo(w.mass / 0.9, 9);
    expect(bodyVol(res, "Svar 1") / (area * 200)).toBeCloseTo(1, 3);
    // úkos vyříznutý z obou desek: každá ztratí polovinu trojúhelníků úkosu, mezera už v modelu je
    const bevel = (81 * Math.tan(Math.PI / 6)) / 2;
    expect(bodyVol(res, "Těleso 1")).toBeCloseTo(100 * 200 * 10 - bevel * 200, 0);
    expect(bodyVol(res, "Těleso 2")).toBeCloseTo(100 * 200 * 10 - bevel * 200, 0);
    for (const b of res.bodies ?? []) expect(b.volume, b.name).toBeGreaterThan(0);
    const { bodies } = await buildShape({ ...base, features: [...base.features, g] });
    for (const b of bodies) expect(checkShape(b.shape).valid, b.name).toBe(true);
    expect(res.status.at(-1)!.info).toMatch(/svarový kov/);
    // stejný svar zadaný horní hranou čela (strana svaru = nahoře)
    const edge = edgeIndex(b0, [0, 0, 10], [0, 200, 10]);
    const ge = ext(base, "weld.groove", { edges: [edge], prep: "V", angle: 60, rootFace: 1, gap: 2, cap: 1.5 });
    const re = await buildDoc({ ...base, features: [...base.features, ge] });
    ok(re);
    expect(infoOf(re, ge.id)!.volume / w.volume).toBeCloseTo(1, 6);
    // spodní hrana čela → svar zespodu (převýšení pod deskami)
    const low = edgeIndex(b0, [0, 0, 0], [0, 200, 0]);
    const gl = ext(base, "weld.groove", { edges: [low], prep: "V", angle: 60, rootFace: 1, gap: 2, cap: 1.5 });
    const rl = await buildDoc({ ...base, features: [...base.features, gl] });
    ok(rl);
    expect(rl.metrics!.bbox[0][2]).toBeLessThan(-1.4);
  }, 240_000);

  it("X, U, ½V, K a I: objem svarového kovu = průřez podle vzorce × délka; mezera z modelu", async () => {
    const cases: { prep: GroovePrep; t: number; g: number; c?: number; angle?: number; R?: number }[] = [
      { prep: "X", t: 20, g: 2, c: 2, angle: 60 },
      { prep: "U", t: 20, g: 0, c: 2, angle: 10, R: 6 },
      { prep: "HV", t: 12, g: 2, c: 1, angle: 45 },
      { prep: "K", t: 16, g: 2, c: 2, angle: 45 },
      { prep: "I", t: 6, g: 3 },
      { prep: "Y", t: 12, g: 1, c: 4, angle: 60 },
      { prep: "J", t: 20, g: 0, c: 2, angle: 10, R: 6 },
    ];
    for (const k of cases) {
      const base = buttPlates(k.t, k.g);
      const b0 = await buildDoc(base);
      const face = faceIndex(b0, { x: 0, z: k.t / 2 }, [1, 0, 0]);
      const g = ext(base, "weld.groove", { faces: [face], prep: k.prep, gap: k.g, ...(k.c !== undefined ? { rootFace: k.c } : {}), ...(k.angle ? { angle: k.angle } : {}), ...(k.R ? { radius: k.R } : {}) });
      const res = await buildDoc({ ...base, features: [...base.features, g] });
      ok(res);
      const s = spec(k.prep, k);
      const area = grooveAreaFormula(s) + reinforcementArea(s);
      const w = infoOf(res, g.id)!;
      expect(w.volume / (area * 200), k.prep).toBeCloseTo(1, 3);
      expect(w.area / area, k.prep).toBeCloseTo(1, 3);
      // součet objemů: desky + svar = původní desky − drážka + svar
      const groove = grooveAreaFormula(s) - k.g * k.t; // mezera už v modelu je
      const total = (res.bodies ?? []).reduce((a, b) => a + b.volume, 0);
      expect(total, k.prep).toBeCloseTo(2 * 100 * 200 * k.t - groove * 200 + area * 200, -1);
    }
  }, 300_000);

  it("T spoj dvou těles: ½V a K do stojiny (čelo stojiny na pásnici), druh spoje T", async () => {
    const base = docOf([box([100, 200, 12], [-50, 0, 0]), box([10, 200, 100], [-5, 0, 12], { body: "Těleso 2" })]);
    const b0 = await buildDoc(base);
    ok(b0);
    const face = faceIndex(b0, { x: 0, z: 12 }, [0, 0, -1]);
    for (const prep of ["HV", "K"] as GroovePrep[]) {
      const g = ext(base, "weld.groove", { faces: [face], prep, gap: 0, rootFace: 2, angle: 45, cap: 1 });
      const res = await buildDoc({ ...base, features: [...base.features, g] });
      ok(res);
      const w = infoOf(res, g.id)!;
      expect(w.joint).toBe("T");
      expect(w.t).toBeCloseTo(10, 6);
      const s = spec(prep, { t: 10, c: 2, g: 0, angle: 45, cap: 1 });
      const area = grooveAreaFormula(s) + reinforcementArea(s);
      expect(w.volume / (area * 200), prep).toBeCloseTo(1, 3);
      // úkos jen ve stojině, pásnice beze změny
      expect(bodyVol(res, "Těleso 1"), prep).toBeCloseTo(100 * 200 * 12, 0);
      expect(bodyVol(res, "Těleso 2"), prep).toBeCloseTo(10 * 100 * 200 - grooveAreaFormula(s) * 200, 0);
    }
  }, 240_000);

  it("T spoj v jednom (sloučeném) tělese: vydutá hrana koutu, ½V do stojiny, tloušťka změřená", async () => {
    const base = docOf([box([100, 200, 12], [-50, 0, 0]), box([10, 200, 100], [-5, 0, 12], { mode: "add" })]);
    const b0 = await buildDoc(base);
    ok(b0);
    const edge = edgeIndex(b0, [5, 0, 12], [5, 200, 12]);
    const g = ext(base, "weld.groove", { edges: [edge], prep: "HV", gap: 0, rootFace: 1, angle: 45, cap: 1 });
    const res = await buildDoc({ ...base, features: [...base.features, g] });
    ok(res);
    const w = infoOf(res, g.id)!;
    expect(w.t).toBeCloseTo(10, 3);
    expect(w.joint).toBe("T");
    const s = spec("HV", { t: 10, c: 1, g: 0, angle: 45, cap: 1 });
    expect(w.volume / ((grooveAreaFormula(s) + reinforcementArea(s)) * 200)).toBeCloseTo(1, 3);
    expect(bodyVol(res, "Těleso 1")).toBeCloseTo(100 * 200 * 12 + 10 * 100 * 200 - grooveAreaFormula(s) * 200, 0);
    // V do vnitřního koutu nejde
    const bad = await buildDoc({ ...base, features: [...base.features, ext(base, "weld.groove", { edges: [edge], prep: "V" })] });
    expect(bad.status.at(-1)!.ok).toBe(false);
    expect(bad.status.at(-1)!.error).toMatch(/tupý spoj dvou dílů/);
  }, 180_000);

  it("podložka = těleso Podložka 1, bez převýšení kořene; převýšení kořene s mezerou", async () => {
    const base = buttPlates(10, 2);
    const b0 = await buildDoc(base);
    const face = faceIndex(b0, { x: 0, z: 5 }, [1, 0, 0]);
    const g = ext(base, "weld.groove", { faces: [face], prep: "V", gap: 2, rootFace: 1, backing: true });
    const res = await buildDoc({ ...base, features: [...base.features, g] });
    ok(res);
    expect(bodyVol(res, "Podložka 1")).toBeCloseTo(25 * 5 * 200, 0);
    const g2 = ext(base, "weld.groove", { faces: [face], prep: "V", gap: 2, rootFace: 1, root: 1 });
    const res2 = await buildDoc({ ...base, features: [...base.features, g2] });
    ok(res2);
    expect(infoOf(res2, g2.id)!.volume - infoOf(res, g.id)!.volume).toBeCloseTo(segmentArea(4, 1) * 200, 0);
  }, 180_000);
});

describe("koutový svar – a / z, oboustranný, kolem, mezi dvěma tělesy", () => {
  it("T spoj sloučený: a5 oboustranně = 2 × a² × L, těleso Svar 1; přerušovaný", async () => {
    const base = docOf([box([100, 200, 12], [-50, 0, 0]), box([10, 200, 100], [-5, 0, 12], { mode: "add" })]);
    const b0 = await buildDoc(base);
    const edge = edgeIndex(b0, [5, 0, 12], [5, 200, 12]);
    const f = ext(base, "weld.bead", { edges: [edge], a: 5, measure: "a", both: true });
    const res = await buildDoc({ ...base, features: [...base.features, f] });
    ok(res);
    const w = infoOf(res, f.id)!;
    expect(w.z).toBeCloseTo(5 * Math.SQRT2, 9);
    expect(w.length).toBeCloseTo(400, 6);
    expect(w.volume).toBeCloseTo(2 * 25 * 200, 0);
    expect(bodyVol(res, "Svar 1")).toBeCloseTo(2 * 25 * 200, 0);
    expect(w.both).toBe(true);
    const fi = ext(base, "weld.bead", { edges: [edge], a: 4, measure: "a", intermittent: true, segLen: 50, pitch: 100 });
    const ri = await buildDoc({ ...base, features: [...base.features, fi] });
    ok(ri);
    expect(infoOf(ri, fi.id)!.length).toBeCloseTo(100, 6);
    expect(infoOf(ri, fi.id)!.count).toBe(2);
    expect(infoOf(ri, fi.id)!.volume).toBeCloseTo(16 * 100, 0);
  }, 180_000);

  it("stojina jako samostatné těleso na pásnici: kout mezi dvěma tělesy (vypouklá hrana stojiny)", async () => {
    const base = docOf([box([100, 200, 12], [-50, 0, 0]), box([10, 200, 100], [-5, 0, 12], { body: "Těleso 2" })]);
    const b0 = await buildDoc(base);
    const edge = edgeIndex(b0, [5, 0, 12], [5, 200, 12]);
    const f = ext(base, "weld.bead", { edges: [edge], a: 3, measure: "z", both: true });
    const res = await buildDoc({ ...base, features: [...base.features, f] });
    ok(res);
    const w = infoOf(res, f.id)!;
    expect(w.a).toBeCloseTo(3 / Math.SQRT2, 9);
    expect(w.volume).toBeCloseTo(2 * 4.5 * 200, 0);
    // housenky leží vně stojiny (x > 5 a x < −5) nad pásnicí
    const bb = res.metrics!.bbox;
    expect(bb[0][0]).toBeCloseTo(-50, 3);
  }, 120_000);

  it("kolem: hranol 40×40 na desce (4 hrany), válec Ø40 na desce (oblouk, Pappus)", async () => {
    const plate = box([200, 200, 10], [-100, -100, 0]);
    const post = box([40, 40, 100], [-20, -20, 10], { mode: "add" });
    const base = docOf([plate, post]);
    const b0 = await buildDoc(base);
    const edge = edgeIndex(b0, [20, -20, 10], [20, 20, 10]);
    const f = ext(base, "weld.bead", { edges: [edge], a: 4, measure: "a", allAround: true });
    const res = await buildDoc({ ...base, features: [...base.features, f] });
    ok(res);
    const w = infoOf(res, f.id)!;
    expect(w.length).toBeCloseTo(160, 6);
    expect(w.count).toBe(4);
    expect(w.allAround).toBe(true);
    // 4 hranoly + 4 výplně vnějších rohů (rotace průřezu z²/2 o 90° kolem rohové hrany, těžiště z/3 od osy)
    const z = filletSize(4, "a").z;
    expect(w.volume).toBeCloseTo(16 * 160 + 4 * ((z * z) / 2) * (Math.PI / 2) * (z / 3), 0);
    const cyl: Feature = { id: "cyl", name: "Válec", type: "cylinder", radius: 20, height: 100, position: [0, 0, 10], axis: "Z", mode: "add" } as Feature;
    const bc = docOf([plate, cyl]);
    const r0 = await buildDoc(bc);
    const ce = r0.body!.edges.findIndex((e) => e.geomType === "CIRCLE" && Math.abs(e.startPoint.z - 10) < 1e-6);
    expect(ce).toBeGreaterThanOrEqual(0);
    const fc = ext(bc, "weld.bead", { edges: [ce], a: 4, measure: "a", allAround: true });
    const rc = await buildDoc({ ...bc, features: [...bc.features, fc] });
    ok(rc);
    const wc = infoOf(rc, fc.id)!;
    // Pappus: plocha z²/2 × 2π × (R + z/3)
    expect(wc.volume / (((z * z) / 2) * 2 * Math.PI * (20 + z / 3))).toBeCloseTo(1, 3);
    expect(wc.length).toBeCloseTo(2 * Math.PI * 20, 3);
  }, 240_000);
});

describe("děrový, žlábkový a bodový svar", () => {
  it("přeplátování: 2 díry Ø12 v horním plechu 8 mm, vyplněné svarem; žlábek 30×10; body Ø6", async () => {
    const base = docOf([box([200, 100, 10], [0, 0, 0]), box([200, 100, 8], [50, 0, 10], { body: "Těleso 2" })]);
    const b0 = await buildDoc(base);
    const top = faceIndex(b0, { z: 18 }, [0, 0, 1]);
    const p = ext(base, "weld.plug", { faces: [top], d: 12, n: 2, pitch: 60 });
    const res = await buildDoc({ ...base, features: [...base.features, p] });
    ok(res);
    const w = infoOf(res, p.id)!;
    expect(w.kind).toBe("plug");
    expect(w.t).toBeCloseTo(8, 3);
    expect(w.count).toBe(2);
    const hole = Math.PI * 36 * 8;
    expect(w.volume).toBeCloseTo(2 * hole, 0);
    expect(bodyVol(res, "Těleso 2")).toBeCloseTo(200 * 100 * 8 - 2 * hole, 0);
    expect(bodyVol(res, "Těleso 1")).toBeCloseTo(200 * 100 * 10, 0);
    const sl = ext(base, "weld.plug", { faces: [top], d: 10, slot: 30, n: 1 });
    const rs = await buildDoc({ ...base, features: [...base.features, sl] });
    ok(rs);
    expect(infoOf(rs, sl.id)!.kind).toBe("slot");
    expect(infoOf(rs, sl.id)!.volume).toBeCloseTo((20 * 10 + Math.PI * 25) * 8, 0);
    const sp = ext(base, "weld.spot", { faces: [top], d: 6, n: 5, pitch: 40 });
    const rp = await buildDoc({ ...base, features: [...base.features, sp] });
    ok(rp);
    const ws = infoOf(rp, sp.id)!;
    expect(ws.count).toBe(5);
    expect(ws.mass).toBe(0);
    expect(rp.bodies?.some((b) => b.name === "Svar 1")).toBe(true);
    // příliš velká rozteč → mimo plochu
    const bad = await buildDoc({ ...base, features: [...base.features, ext(base, "weld.spot", { faces: [top], d: 6, n: 9, pitch: 40 })] });
    expect(bad.status.at(-1)!.error).toMatch(/mimo vybranou plochu/);
  }, 180_000);
});

describe("tabulka svarů ze stavu prvků, více svarů = Svar 1, Svar 2", () => {
  it("součty a názvy těles", async () => {
    const base = buttPlates(10, 2);
    const b0 = await buildDoc(base);
    const face = faceIndex(b0, { x: 0, z: 5 }, [1, 0, 0]);
    const g = ext(base, "weld.groove", { faces: [face], prep: "V", gap: 2, rootFace: 1 });
    const d1 = { ...base, features: [...base.features, g] };
    const r1 = await buildDoc(d1);
    const e = edgeIndex(r1, [-100, 0, 10], [-100, 200, 10]); // vnější hrana – bez druhého dílu → chyba housenky
    const bad = ext(d1, "weld.bead", { edges: [e], a: 3 });
    const top = r1.body!.faces.findIndex((f) => f.geomType === "PLANE" && Math.abs(f.center.z - 10) < 1e-6 && f.center.x > 10 && f.normalAt(f.center).z > 0.99);
    expect(top).toBeGreaterThanOrEqual(0);
    const sp = ext(d1, "weld.spot", { faces: [top], d: 5, n: 2, pitch: 20 });
    const doc = { ...d1, features: [...d1.features, bad, sp] };
    const res = await buildDoc(doc);
    expect(res.status.find((s) => s.id === bad.id)!.ok).toBe(false);
    expect(res.bodies?.map((b) => b.name).sort()).toEqual(["Svar 1", "Svar 3", "Těleso 1", "Těleso 2"].sort());
    const rows = weldTable(doc, res.status);
    expect(rows).toHaveLength(3);
    expect(rows[0].estimate).toBe(false);
    expect(rows[1].type).toMatch(/chyba/);
    const txt = weldTableText(doc, res.status);
    expect(txt).toMatch(/Celkem: 3 svarů/);
    expect(txt).toMatch(/svarový kov/);
  }, 180_000);
});

describe("výkres: značky svarů ISO 2553 z 3D svarů (SVG, DXF)", () => {
  it("tupý V svar a oboustranný koutový svar → značky se šipkou, velikostí a metodou", async () => {
    const { makeDrawing } = await import("../drawing");
    const { weldMarksOf, symbolOfWeld } = await import("../drawing-welds");
    const base = docOf([box([100, 200, 12], [-50, 0, 0]), box([10, 200, 100], [-5, 0, 12], { mode: "add" }), box([100, 200, 10], [-152, 0, 0], { body: "Těleso 2" })]);
    const b0 = await buildDoc(base);
    ok(b0);
    // tupý spoj: čelo desky Těleso 2 (x = −52) proti pásnici (x = −50) – mezera 2
    const face = faceIndex(b0, { x: -52, z: 5 }, [1, 0, 0]);
    const g = ext(base, "weld.groove", { faces: [face], prep: "V", gap: 2, rootFace: 1, angle: 60, process: "135" });
    const d1 = { ...base, features: [...base.features, g] };
    const r1 = await buildDoc(d1);
    ok(r1);
    // kout T: hrana stojiny v aktivním tělese (Těleso 1 je po svaru dál aktivní? – najít v modelu)
    const edge = edgeIndex(r1, [5, 0, 12], [5, 200, 12]);
    const f = ext(d1, "weld.bead", { edges: [edge], a: 5, measure: "a", both: true, process: "135" });
    const doc = { ...d1, features: [...d1.features, f] };
    const res = await buildDoc(doc);
    ok(res);
    const marks = weldMarksOf(doc, res.status);
    expect(marks).toHaveLength(2);
    expect(marks[0].sym.kind).toBe("V");
    expect(marks[0].sym.size).toBeCloseTo(10, 6);
    expect(marks[1].sym).toMatchObject({ kind: "fillet", size: 5, prefix: "a", both: true });
    expect(symbolOfWeld(infoOf(res, f.id)!).both).toBe(true);
    const { body } = await buildShape(doc);
    const dr = makeDrawing(body!, { name: "Svařenec", material: "S235", welds: marks }, { views: { front: true, top: true, left: true, right: false, back: false, bottom: false, iso: false } });
    if (process.env.WELD_SVG) (await import("node:fs")).writeFileSync(process.env.WELD_SVG, dr.svg);
    expect(dr.svg).toContain(">s10<");
    expect(dr.svg).toContain(">a5<");
    expect(dr.svg).toContain(">135<");
    expect(dr.svg).toContain("60° b2 c1");
    expect(dr.dxf).toContain("a5");
    expect(dr.dxf).toContain("s10");
    // ruční značka svaru: s hranou → šipka ke hraně, bez hrany → seznam „Svary:“ vlevo dole
    const e2 = edgeIndex(res, [50, 0, 12], [50, 200, 12]);
    const sy1 = ext(doc, "weld.symbol", { kind: "Y", size: 8, edges: [e2], process: "111" });
    const sy2 = ext(doc, "weld.symbol", { kind: "spot", size: 5, edges: [], count: 4, pitch: 30 });
    const doc2 = { ...doc, features: [...doc.features, sy1, sy2] };
    const res2 = await buildDoc(doc2);
    ok(res2);
    const marks2 = weldMarksOf(doc2, res2.status);
    expect(marks2).toHaveLength(4);
    expect(marks2[2].anchor).not.toBeNull();
    expect(marks2[3].anchor).toBeNull();
    const dr2 = makeDrawing(body!, { name: "Svařenec", material: "S235", welds: marks2 }, { views: { front: true, top: true, left: true, right: false, back: false, bottom: false, iso: false } });
    expect(dr2.svg).toContain(">s8<");
    expect(dr2.svg).toContain(">111<");
    expect(dr2.svg).toContain("Svary:");
    expect(dr2.svg).toMatch(/Ø5 4\(30\)/);
    // vypnuté značky
    const off = makeDrawing(body!, { name: "Svařenec", material: "S235", welds: marks }, { weldSymbols: false, views: { front: true, top: false, left: false, right: false, back: false, bottom: false, iso: false } });
    expect(off.svg).not.toContain(">a5<");
  }, 240_000);
});

describe("hrana / plocha zadaná bodem (textové příkazy)", () => {
  it("edgeAt a faceAt najdou nejbližší entitu napříč tělesy", async () => {
    const base = docOf([box([100, 200, 12], [-50, 0, 0]), box([10, 200, 100], [-5, 0, 12], { mode: "add" })]);
    const f = ext(base, "weld.bead", { edges: [], edgeAt: [[5, 100, 12]], a: 4, measure: "a", both: true });
    const res = await buildDoc({ ...base, features: [...base.features, f] });
    ok(res);
    expect(infoOf(res, f.id)!.length).toBeCloseTo(400, 6);
    const lap = docOf([box([200, 100, 10], [0, 0, 0]), box([200, 100, 8], [50, 0, 10], { body: "Těleso 2" })]);
    const p = ext(lap, "weld.plug", { faces: [], faceAt: [[150, 50, 18]], d: 10, n: 1 });
    const rp = await buildDoc({ ...lap, features: [...lap.features, p] });
    ok(rp);
    expect(infoOf(rp, p.id)!.volume).toBeCloseTo(Math.PI * 25 * 8, 0);
    const bad = await buildDoc({ ...lap, features: [...lap.features, ext(lap, "weld.plug", { faces: [], faceAt: [[500, 500, 500]] })] });
    expect(bad.status.at(-1)!.error).toMatch(/není žádná plocha/);
  }, 120_000);
});
