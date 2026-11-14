/**
 * Kolize nad skutečným jádrem (OpenCascade) – balík motion-clash (vlna 14, A3):
 * - přírůstková kontrola (mezipaměť dvojic díl A × díl B × vzájemná poloha) = plná kontrola = dřívější algoritmus (replicad),
 * - šum polohy 1e-9 mm (z řešiče) nerozbije souosý šroub v závitové díře (dřívější algoritmus vrací 0 mm³),
 * - halda WASM: 500 přesných průniků ji zvětší o < 50 MB (dřív ~0,6–1 MB na průnik),
 * - umístění komponenty jen polohou (bez kopie geometrie) = dřívější řetěz rotate/translate (objem, obálka, STEP tam a zpět, síť,
 *   výkres); placed()/assemblyShape bez růstu haldy (dřív ~60–90 kB na kopii, compound replicadu navíc celý),
 * - pohybová studie s kolizemi a tuhou skupinou: dvojice uvnitř skupiny se znovupoužijí, výsledky = plná kontrola v každém kroku.
 */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { parseAgentText } from "./agent";
import type { AsmCmd } from "./agent-asm";
import { applyAsmCmd, type AsmEnv } from "./asm-agent";
import { motionRun } from "./asm-agent-kin";
import { flattenAssembly, partComponent, sourceKey } from "./assembly";
import { assemblyShape, clearInterferenceCache, findCylFace, interference, interferenceStats, mateEdgeInfo, mateFaceInfo, mateFaceMesh, mateVertexInfo, partEntry, placed, type Interference } from "./asm-kernel";
import { makeDrawing } from "./drawing";
import { entityInfo } from "./inspect";
import { makeFromText } from "./library";
import { poseDoc } from "./motion";
import type { CadDoc, Feature, Placement } from "./types";
import "./ext/index";
import "./feat/index";

type Oc = { wasmMemory?: { buffer: ArrayBuffer }; HEAPU8?: Uint8Array };
let oc: Oc;
beforeAll(async () => {
  oc = (await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  })) as Oc;
  r.setOC(oc as never);
}, 60_000);
/** velikost haldy WASM (HEAPU8.length; tento build ji vystavuje jen přes wasmMemory) */
const heapMB = () => (oc.HEAPU8?.length ?? oc.wasmMemory!.buffer.byteLength) / 1048576;

/* ───── díly: základová deska se závitovými dírami M10 a dírou pro kolík, víko s průchozími dírami, šrouby ISO 4762, kolík ───── */
const partFrom = (name: string, text: string): CadDoc => {
  const p = parseAgentText(text);
  expect(p.errors, text).toEqual([]);
  const features = p.ops.flatMap((op, i) => (op.k === "feature" ? [{ ...op.feature, name: `${op.feature.name} ${i}` } as Feature] : []));
  return { app: "mnastrojarna-cad", version: 2, name, kind: "part", material: "ocel", features } as unknown as CadDoc;
};
const XS = [30, 60, 90];
const base = partFrom("Základ", ["kvádr 120 60 20", `díra 8,5 hloubka 15 ${XS.map((x) => `v ${x} 30 20`).join(" ")} závit M10`, "díra 7,9 hloubka 10 v 15 15 20"].join("\n"));
const cover = partFrom("Víko", ["kvádr 120 60 10", `díra 11 skrz ${XS.map((x) => `v ${x} 30 10`).join(" ")}`, "díra 8,2 skrz v 15 15 10"].join("\n"));
const pin = partFrom("Kolík", "válec 8 20");
const screw = makeFromText("M10x25")!.doc;
const P = (x: number, y: number, z: number, rot: [number, number, number] = [0, 0, 0]): Placement => ({ position: [x, y, z], rotation: rot });
/** sestava: základ ukotvený, kolík s přesahem v základu, víko + 3 šrouby jako tuhá skupina posunutá o `dz` nahoru */
const dieAsm = (dz = 0, noise = 0): CadDoc => ({
  app: "mnastrojarna-cad",
  version: 2,
  name: "Přípravek",
  kind: "assembly",
  material: "ocel",
  features: [],
  components: [
    { ...partComponent(base, P(0, 0, 0), { fixed: true }), id: "zaklad" },
    { ...partComponent(pin, P(15, 15, 10)), id: "kolik" },
    { ...partComponent(cover, P(0, 0, 20 + dz)), id: "viko" },
    ...XS.map((x, i) => ({ ...partComponent(screw, P(x + (i === 1 ? noise : 0), 30, 30 + dz)), id: `sroub${i + 1}` })),
  ],
} as unknown as CadDoc);

/** dřívější algoritmus (asm-kernel před vlnou 14): replicad placed (rotate/translate) + intersect + measureVolume ve světě */
async function legacyInterference(doc: CadDoc, tolerance = 1e-3): Promise<Interference[]> {
  const items: { path: string[]; shape: r.Shape3D; box: number[][] }[] = [];
  for (const f of flattenAssembly(doc)) {
    if (f.hidden) continue;
    const e = await partEntry(f.key, f.comp.source);
    if (!e.body) continue;
    const [rx, ry, rz] = f.placement.rotation;
    let t = e.body.clone() as r.Shape3D;
    if (rz) t = t.rotate(rz, [0, 0, 0], [0, 0, 1]) as r.Shape3D;
    if (ry) t = t.rotate(ry, [0, 0, 0], [0, 1, 0]) as r.Shape3D;
    if (rx) t = t.rotate(rx, [0, 0, 0], [1, 0, 0]) as r.Shape3D;
    if (f.placement.position.some((v) => v)) t = t.translate(f.placement.position) as r.Shape3D;
    items.push({ path: f.path, shape: t, box: t.boundingBox.bounds as number[][] });
  }
  const out: Interference[] = [];
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const [a0, a1] = items[i].box;
      const [b0, b1] = items[j].box;
      if (a1[0] < b0[0] || b1[0] < a0[0] || a1[1] < b0[1] || b1[1] < a0[1] || a1[2] < b0[2] || b1[2] < a0[2]) continue;
      try {
        const x = items[i].shape.intersect(items[j].shape);
        const v = r.measureVolume(x);
        x.delete();
        if (v > tolerance) out.push({ a: items[i].path[0], b: items[j].path[0], volume: v });
      } catch {
        /* nelze určit */
      }
    }
  for (const it of items) it.shape.delete();
  return out;
}
const sig = (list: Interference[]) => list.map((c) => `${c.a}|${c.b}`).sort();
const byPair = (list: Interference[]) => new Map(list.map((c) => [`${c.a}|${c.b}`, c.volume]));

describe("kolize: přírůstková kontrola = plná kontrola = dřívější algoritmus", () => {
  it("víko se šrouby zvedané o 0…12 mm: stejné dvojice i objemy; opakovaná kontrola bez přesných průniků", async () => {
    clearInterferenceCache();
    let exactInc = 0;
    let reusedInc = 0;
    for (const dz of [0, 2, 4, 6, 8, 10, 12]) {
      const doc = dieAsm(dz);
      const inc = await interference(doc);
      exactInc += inc.stats.exact;
      reusedInc += inc.stats.reused;
      const full = await interference(doc, 1e-3, { full: true });
      const old = await legacyInterference(doc);
      expect(sig(inc), `dz ${dz}`).toEqual(sig(full));
      expect(sig(inc), `dz ${dz}`).toEqual(sig(old));
      const f = byPair(full);
      const o = byPair(old);
      for (const c of inc) {
        expect(c.volume).toBe(f.get(`${c.a}|${c.b}`)); // stejná funkce klíče → bitově stejný objem
        expect(Math.abs(c.volume - o.get(`${c.a}|${c.b}`)!) / c.volume, `${c.a}×${c.b} dz ${dz}`).toBeLessThan(1e-6);
      }
      // kolík s přesahem v základu (Ø8 v Ø7,9) je vždy; šrouby v závitech jen dokud zasahují do základu (shank 25 mm, díra 15 mm)
      expect(inc.some((c) => c.a === "zaklad" && c.b === "kolik")).toBe(true);
      expect(inc.filter((c) => c.a === "zaklad" && c.b.startsWith("sroub")).length).toBe(dz < 15 ? 3 : 0);
    }
    // dvojice uvnitř tuhé skupiny (víko × šrouby) mají stálou vzájemnou polohu → po prvním kroku jen znovupoužití
    expect(reusedInc).toBeGreaterThan(0);
    expect(exactInc).toBeLessThan(7 * 9);
    const again = await interference(dieAsm(12));
    expect(again.stats.exact).toBe(0);
    expect(again.stats.reused).toBeGreaterThan(0);
    expect(interferenceStats()).toEqual(again.stats);
  }, 240_000);

  it("šum polohy 1e-9 mm: souosý šroub v závitové díře má stejný objem průniku jako přesná poloha", async () => {
    clearInterferenceCache();
    const exact = byPair(await interference(dieAsm(0), 1e-3, { full: true })).get("zaklad|sroub2")!;
    expect(exact).toBeGreaterThan(100);
    const noisy = byPair(await interference(dieAsm(0, 1e-9), 1e-3, { full: true })).get("zaklad|sroub2");
    expect(noisy).toBe(exact); // vzájemná poloha zaokrouhlená na 1e-7 → týž výpočet
    // dřívější algoritmus počítal s polohou 1e-9 mm vedle osy (výsledek OCCT pro téměř souosé plochy je nespolehlivý – P7: 0 mm³)
    const old = byPair(await legacyInterference(dieAsm(0, 1e-9))).get("zaklad|sroub2") ?? 0;
    expect(Number.isFinite(old)).toBe(true);
  }, 120_000);

  it("stejný díl dvakrát (sdílená geometrie, B jen s polohou): objem průniku analyticky", async () => {
    clearInterferenceCache();
    const cube = partFrom("Kostka", "kvádr 10 10 10");
    const mk = (b: Placement) => ({ app: "mnastrojarna-cad", version: 2, name: "K2", kind: "assembly", material: "ocel", features: [], components: [{ ...partComponent(cube, P(0, 0, 0)), id: "k1" }, { ...partComponent(cube, b), id: "k2" }] }) as unknown as CadDoc;
    expect((await interference(mk(P(5, 0, 0))))[0].volume).toBeCloseTo(500, 6);
    // natočení 90° kolem Z kolem počátku: kostka [-10, 0] × [0, 10] → posun o 14 v X → [4, 14] → průnik 6 × 10 × 10
    expect((await interference(mk(P(14, 0, 0, [0, 0, 90]))))[0].volume).toBeCloseTo(600, 6);
    expect((await interference(mk(P(10.5, 0, 0)))).length).toBe(0);
  }, 60_000);
});

describe("umístění a paměť", () => {
  it("placed(): jedna transformace OCCT = dřívější řetěz rotate Z → Y → X → posun", async () => {
    const e = await partEntry(sourceKey({ kind: "part", doc: cover }), { kind: "part", doc: cover });
    const pl = P(12.5, -40, 7, [30, -45, 60]);
    const a = placed(e.body as r.Shape3D, pl);
    const b = (e.body as r.Shape3D).clone().rotate(60, [0, 0, 0], [0, 0, 1]).rotate(-45, [0, 0, 0], [0, 1, 0]).rotate(30, [0, 0, 0], [1, 0, 0]).translate([12.5, -40, 7]);
    expect(r.measureVolume(a)).toBeCloseTo(r.measureVolume(b), 6);
    const [ba, bb] = [a.boundingBox.bounds, b.boundingBox.bounds];
    for (let i = 0; i < 2; i++) for (let k = 0; k < 3; k++) expect(ba[i][k]).toBeCloseTo(bb[i][k], 6);
    a.delete();
    b.delete();
  });

  /** dřívější assemblyShape: kopie geometrie řetězem rotate/translate replicadu + r.makeCompound */
  async function legacyAssembly(doc: CadDoc): Promise<r.Shape3D> {
    const shapes: r.Shape3D[] = [];
    for (const c of doc.components ?? []) {
      const e = await partEntry(sourceKey(c.source), c.source);
      const [rx, ry, rz] = c.placement.rotation;
      let t = (e.body as r.Shape3D).clone();
      if (rz) t = t.rotate(rz, [0, 0, 0], [0, 0, 1]);
      if (ry) t = t.rotate(ry, [0, 0, 0], [0, 1, 0]);
      if (rx) t = t.rotate(rx, [0, 0, 0], [1, 0, 0]);
      if (c.placement.position.some((v) => v)) t = t.translate(c.placement.position);
      shapes.push(t);
    }
    return r.makeCompound(shapes) as unknown as r.Shape3D;
  }
  const turned = (): CadDoc => {
    const d = dieAsm(4);
    d.components![2] = { ...d.components![2], placement: P(130, -20, 26, [15, -30, 90]) };
    d.components![4] = { ...d.components![4], placement: P(60, 30, 34, [0, 0, 37]) };
    return d;
  };
  const sumLen = (polys: { pts: [number, number][] }[]) => polys.reduce((s, p) => s + p.pts.slice(1).reduce((a, q, i) => a + Math.hypot(q[0] - p.pts[i][0], q[1] - p.pts[i][1]), 0), 0);

  it("assemblyShape s polohou bez kopie = dřívější kopie: objem, obálka, síť, STEP tam a zpět, výkres; díl v mezipaměti beze změny", async () => {
    const doc = turned();
    const a = (await assemblyShape(doc)) as r.Shape3D;
    const b = await legacyAssembly(doc);
    expect(Math.abs(r.measureVolume(a) - r.measureVolume(b)) / r.measureVolume(b)).toBeLessThan(1e-9);
    const [ba, bb] = [a.boundingBox.bounds, b.boundingBox.bounds];
    for (let i = 0; i < 2; i++) for (let k = 0; k < 3; k++) expect(ba[i][k]).toBeCloseTo(bb[i][k], 6);
    const [ma, mb] = [a.mesh({ tolerance: 0.05, angularTolerance: 0.2 }), b.mesh({ tolerance: 0.05, angularTolerance: 0.2 })];
    expect(ma.triangles.length).toBe(mb.triangles.length);
    let dv = 0;
    for (let i = 0; i < ma.vertices.length; i++) dv = Math.max(dv, Math.abs(ma.vertices[i] - mb.vertices[i]));
    expect(dv).toBeLessThan(1e-6); // tatáž síť ve světových souřadnicích (poloha z TopLoc_Location)
    const back = (await r.importSTEP(a.blobSTEP())) as r.Shape3D;
    expect(Math.abs(r.measureVolume(back) - r.measureVolume(b)) / r.measureVolume(b)).toBeLessThan(1e-6);
    const bk = back.boundingBox.bounds;
    for (let i = 0; i < 2; i++) for (let k = 0; k < 3; k++) expect(bk[i][k]).toBeCloseTo(bb[i][k], 3);
    back.delete();
    const [da, db] = [makeDrawing(a, { name: "S", material: "ocel" }), makeDrawing(b, { name: "S", material: "ocel" })];
    expect(da.scale).toBe(db.scale);
    expect(da.polys.length).toBe(db.polys.length);
    expect(Math.abs(sumLen(da.polys as never) - sumLen(db.polys as never))).toBeLessThan(1e-3 * sumLen(db.polys as never));
    a.delete();
    b.delete();
    // díl v mezipaměti: poloha komponenty se do něj nepropsala (sdílená geometrie, poloha jen na kopii tvaru)
    const e = await partEntry(sourceKey({ kind: "part", doc: cover }), { kind: "part", doc: cover });
    const bc = (e.body as r.Shape3D).boundingBox.bounds;
    for (const [v, w] of [[bc[0][0], 0], [bc[0][2], 0], [bc[1][0], 120], [bc[1][2], 10]]) expect(v).toBeCloseTo(w, 3);
  }, 180_000);

  it("placed() s polohou bez kopie: informace o plochách, hranách a vrcholech (inspect v sestavě) = dřívější kopie", async () => {
    const e = await partEntry(sourceKey({ kind: "part", doc: base }), { kind: "part", doc: base });
    const pl = P(12.5, -40, 7, [30, -45, 60]);
    const a = placed(e.body as r.Shape3D, pl);
    const b = (e.body as r.Shape3D).clone().rotate(60, [0, 0, 0], [0, 0, 1]).rotate(-45, [0, 0, 0], [0, 1, 0]).rotate(30, [0, 0, 0], [1, 0, 0]).translate([12.5, -40, 7]);
    const near = (x: number[] | undefined, y: number[] | undefined) => (x && y ? Math.max(...x.map((v, i) => Math.abs(v - y[i]))) : x === y ? 0 : Infinity);
    for (const kind of ["face", "edge", "vertex"] as const) {
      const n = kind === "face" ? a.faces.length : kind === "edge" ? a.edges.length : 8;
      expect(n).toBeGreaterThan(5);
      for (let i = 0; i < n; i++) {
        const [x, y] = [entityInfo(a, { kind, index: i } as never), entityInfo(b, { kind, index: i } as never)];
        expect(x.title, `${kind} ${i}`).toBe(y.title);
        for (const k of ["center", "normal", "point", "dir", "mid"] as const) expect(near(x[k], y[k]), `${kind} ${i} ${k}`).toBeLessThan(1e-6);
        expect(Math.abs((x.area ?? 0) - (y.area ?? 0)) + Math.abs((x.length ?? 0) - (y.length ?? 0)) + Math.abs((x.radius ?? 0) - (y.radius ?? 0))).toBeLessThan(1e-6);
      }
    }
    a.delete();
    b.delete();
  }, 120_000);

  it("placed() a assemblyShape opakovaně: halda WASM nerůste (dřív ~60–90 kB na kopii, u assemblyShape celé těleso sestavy)", async () => {
    const e = await partEntry(sourceKey({ kind: "part", doc: screw }), { kind: "part", doc: screw });
    const body = e.body as r.Shape3D;
    for (let k = 0; k < 50; k++) placed(body, P(k, 1, 2, [0, 0, k % 7])).delete(); // zahřátí
    for (let k = 0; k < 10; k++) (await assemblyShape(turned()))!.delete();
    const h0 = heapMB();
    for (let k = 0; k < 2000; k++) placed(body, P(k * 0.1, 1, 2, [k % 11, 0, k % 7])).delete();
    const h1 = heapMB();
    for (let k = 0; k < 300; k++) (await assemblyShape(dieAsm(k * 0.01)))!.delete();
    const h2 = heapMB();
    console.log(`halda WASM: ${h0.toFixed(0)} → ${h1.toFixed(0)} MB po 2000× placed, → ${h2.toFixed(0)} MB po 300× assemblyShape`);
    expect(h1 - h0).toBeLessThan(16);
    expect(h2 - h1).toBeLessThan(16);
  }, 300_000);

  it("500 přesných průniků (plná kontrola) zvětší haldu WASM o < 50 MB", async () => {
    clearInterferenceCache();
    for (let k = 0; k < 3; k++) await interference(dieAsm(k * 0.37), 1e-3, { full: true }); // zahřátí
    const h0 = heapMB();
    let exact = 0;
    for (let k = 0; exact < 500; k++) exact += (await interference(dieAsm(0.011 * k), 1e-3, { full: true })).stats.exact;
    const grow = heapMB() - h0;
    console.log(`halda WASM: ${h0.toFixed(0)} → ${heapMB().toFixed(0)} MB po ${exact} přesných průnicích`);
    expect(exact).toBeGreaterThanOrEqual(500);
    expect(grow).toBeLessThan(50);
  }, 600_000);
});

describe("pohybová studie s kolizemi nad jádrem", () => {
  const env = (): AsmEnv => ({
    parts: async (list) => Promise.all(list.map(async (p) => ({ key: p.key, result: (await partEntry(p.key, p.source)).result }))),
    mateFace: async (k, i) => mateFaceInfo(k, i),
    mateEnt: async (k, i, e) => (e === "edge" ? mateEdgeInfo(k, i) : e === "vertex" ? mateVertexInfo(k, i) : mateFaceMesh(k, i)),
    cylFace: async (k, rr) => findCylFace(k, rr),
    interference: (d) => interference(d),
    geo: new Map(),
    faceLists: new Map(),
    stack: [],
  });
  const run = async (d: CadDoc, line: string, e: AsmEnv) => {
    const p = parseAgentText(line);
    expect(p.errors, line).toEqual([]);
    return applyAsmCmd(d, (p.ops[0] as { cmd: AsmCmd }).cmd, e);
  };
  it("zámky víka a šroubů = tuhá skupina; kroky s kolizemi = plná kontrola každého kroku, dvojice skupiny se znovupoužijí", async () => {
    clearInterferenceCache();
    const e = env();
    let d = dieAsm(0);
    for (const line of [
      ...XS.map((_, i) => `sestava vazba zámek "#${4 + i}" "Víko"`),
      'sestava vazba vzdálenost "Víko" spodní "Základ" horní 0',
      "pohyb motor lineární vazba 4 0..12 kroky 6",
      "pohyb kolize",
    ]) {
      const res = await run(d, line, e);
      expect(res.log.join("\n"), line).not.toMatch(/✗/);
      d = res.doc;
    }
    const res = await motionRun(d, e);
    expect(res.steps.length).toBe(7);
    expect(res.conflictSteps).toBe(0);
    expect(res.timing).toMatchObject({ groups: 1, vars: 6 }); // víko + 3 šrouby = jedna tuhá skupina, jedna poloha
    expect(res.timing!.clash!.reused).toBeGreaterThan(0);
    expect(res.timing!.collideMs).toBeGreaterThan(0);
    for (const s of res.steps) {
      const full = await interference(poseDoc(d, s.place), 1e-3, { full: true });
      expect((s.clashes ?? []).map((c) => `${c.a}|${c.b}|${c.volume}`).sort(), `krok ${s.i}`).toEqual(full.map((c) => `${c.a}|${c.b}|${c.volume}`).sort());
    }
    // víko jede jen v Z o 12 mm, šrouby s ním
    const v = res.steps.map((s) => s.place.viko.position);
    expect(v[6][2] - v[0][2]).toBeCloseTo(12, 6);
    expect(Math.max(...v.map((p) => Math.abs(p[0]) + Math.abs(p[1])))).toBeLessThan(1e-6);
    expect(res.steps[6].place.sroub2.position[2] - v[6][2]).toBeCloseTo(10, 7);
  }, 300_000);
});
