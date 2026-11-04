/**
 * Poctivý stav prvku: ✓ jen když je výsledek platné objemové těleso a operace se projevila.
 * Reprodukce nálezů z testu 3. 11. 2026: skořepina po zaoblení (tichý neúspěch), závit v díře (neplatná geometrie /
 * žádný úběr), forma s kanálem po spline (bez solidů), jemné stoupání M18×1,5.
 */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc } from "./build";
import { checkShape } from "./check";
import { newExtFeature, threadByName, threadLabel, ALL_THREADS } from "./defaults";
import { expectedDims } from "./dim-check";
import { drawingDoc, threadsOfDoc } from "./drawing-doc";
import { makeDrawing } from "./drawing";
import { docStatusText, parseAgentText } from "./agent";
import { emptyDoc, type CadDoc, type Feature, type SketchEntity, type SketchPlane } from "./types";
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
const id = () => `k${++n}`;
const base = (features: Feature[]): CadDoc => ({ ...emptyDoc("Test"), features });
const ext = (doc: CadDoc, e: string, data: Record<string, unknown>) => {
  const f = newExtFeature(doc, e);
  if (f.type === "ext") f.data = { ...f.data, ...data };
  return f;
};
const sk = (name: string, plane: SketchPlane, entities: SketchEntity[]): Feature => ({ id: id(), name, type: "sketch", plane, entities });
const box = (): Feature => ({ id: id(), name: "Kvádr", type: "box", size: [60, 40, 20], position: [0, 0, 0], centered: false, mode: "new" });
const tube = (): Feature => ({ id: id(), name: "Trubka", type: "tube", outer: 42, inner: 16.4, height: 30, position: [0, 0, 0], axis: "Z", mode: "new" });
const statusOf = (res: Awaited<ReturnType<typeof buildDoc>>, f: Feature) => res.status.find((s) => s.id === f.id)!;

describe("skořepina – žádný tichý úspěch", () => {
  it("skořepina, kterou jádro neprovede (otevřené zaoblené plochy), skončí chybou a těleso zůstane", { timeout: 60000 }, async () => {
    const b = box();
    const r0 = await buildDoc(base([b]));
    const topEdges = r0.body!.edges.map((e, i) => (Math.abs(e.startPoint.z - 20) < 1e-6 && Math.abs(e.endPoint.z - 20) < 1e-6 ? i : -1)).filter((i) => i >= 0);
    const fil: Feature = { id: id(), name: "Zaoblení", type: "fillet", radius: 2, edges: topEdges };
    const r1 = await buildDoc(base([b, fil]));
    // „+Z“ podle normály ve středu plochy vybere i zaoblené plochy – přesně tak vznikl nález z testu
    const faces = r1.body!.faces.map((f, i) => (f.normalAt(f.center).z > 0.99 ? i : -1)).filter((i) => i >= 0);
    const sh: Feature = { id: id(), name: "Skořepina", type: "shell", thickness: 2, faces };
    const r2 = await buildDoc(base([b, fil, sh]));
    const st = statusOf(r2, sh);
    expect(st.ok).toBe(false);
    expect(st.error).toMatch(/Skořepinu se nepodařilo/);
    expect(docStatusText(base([b, fil, sh]), r2)).toMatch(/1 ✗/);
    // jen rovinná horní plocha: jádro zvládne skořepinu tenčí než poloměr zaoblení (2 mm = R2 selže poctivě, 1 mm projde)
    const topOnly = r1.body!.faces.map((f, i) => (f.geomType === "PLANE" && f.normalAt(f.center).z > 0.99 ? i : -1)).filter((i) => i >= 0);
    const r3 = await buildDoc(base([b, fil, { ...sh, faces: topOnly }]));
    expect(statusOf(r3, sh).ok).toBe(false);
    const r4 = await buildDoc(base([b, fil, { ...sh, thickness: 1, faces: topOnly }]));
    expect(statusOf(r4, sh).ok).toBe(true);
    expect(r4.metrics!.volume).toBeLessThan(r1.metrics!.volume * 0.4);
  });
});

describe("prvek, který těleso nezměnil → ⚠", () => {
  it("odebrání mimo těleso hlásí varování, stav dokumentu ho vypíše", { timeout: 60000 }, async () => {
    const b = box();
    const far: Feature = { id: id(), name: "Koule mimo", type: "sphere", radius: 5, position: [200, 200, 200], mode: "cut" };
    const res = await buildDoc(base([b, far]));
    const st = statusOf(res, far);
    expect(st.ok).toBe(true);
    expect(st.warning).toMatch(/nezměnil/);
    const text = docStatusText(base([b, far]), res);
    expect(text).toMatch(/1 ⚠/);
    expect(text).toMatch(/⚠ Prvek těleso nezměnil/);
    expect(text).toMatch(/Geometrie: platná · 1 těleso/);
    expect(res.metrics!.valid).toBe(true);
    expect(res.metrics!.solids).toBe(1);
  });
});

describe("závit v díře tažením po šroubovici", () => {
  it("vnitřní závit M18×1,5 v díře Ø16,4: odebere materiál ven do stěny, výsledek platný, STEP se vyexportuje", { timeout: 120000 }, async () => {
    const t = tube();
    const doc = base([t]);
    const r0 = await buildDoc(doc);
    const thr = ext(doc, "surf.helixSweep", { profile: "thread60", side: "internal", depth: 0.8, radius: 8.2, pitch: 1.5, turns: 12, position: [0, 0, 5], axis: "Z", mode: "cut" });
    const res = await buildDoc(base([t, thr]));
    expect(statusOf(res, thr).ok).toBe(true);
    expect(statusOf(res, thr).warning).toBeUndefined();
    expect(res.metrics!.volume).toBeLessThan(r0.metrics!.volume - 200);
    expect(checkShape(res.body!).valid).toBe(true);
    // drážka jde ven: vnitřní poloměr materiálu zůstává 8,2, závit sahá k 9,0
    const [a, b] = res.metrics!.bbox;
    expect(b[0] - a[0]).toBeCloseTo(42, 3);
    const step = await res.body!.blobSTEP().arrayBuffer();
    expect(step.byteLength).toBeGreaterThan(10000);
  });
  it("špička profilu tečná k povrchu (dřívější nastavení z testu) už nevrací tichý úspěch – buď platný řez, nebo ⚠", { timeout: 120000 }, async () => {
    const t = tube();
    const doc = base([t]);
    const thr = ext(doc, "surf.helixSweep", { profile: "thread60", depth: 0.8, radius: 9, pitch: 1.5, turns: 12, position: [0, 0, 5], axis: "Z", mode: "cut" });
    const res = await buildDoc(base([t, thr]));
    const st = statusOf(res, thr);
    if (st.ok && !st.warning) expect(checkShape(res.body!).valid).toBe(true);
    else expect((st.error ?? st.warning) ?? "").toMatch(/geometri|nezměnil|objemové/);
  });
  it("náběh: hloubka roste od nuly během první otáčky", { timeout: 180000 }, async () => {
    const t = tube();
    const doc = base([t]);
    const plain = ext(doc, "surf.helixSweep", { profile: "thread60", side: "internal", depth: 0.8, radius: 8.2, pitch: 1.5, turns: 6, position: [0, 0, 5], axis: "Z", mode: "cut" });
    const lead = ext(doc, "surf.helixSweep", { profile: "thread60", side: "internal", depth: 0.8, radius: 8.2, pitch: 1.5, turns: 6, leadIn: 1, position: [0, 0, 5], axis: "Z", mode: "cut" });
    const r0 = await buildDoc(doc);
    const a = await buildDoc(base([t, plain]));
    const b = await buildDoc(base([t, lead]));
    expect(statusOf(b, lead).ok).toBe(true);
    const removedPlain = r0.metrics!.volume - a.metrics!.volume;
    const removedLead = r0.metrics!.volume - b.metrics!.volume;
    expect(removedLead).toBeGreaterThan(removedPlain * 0.7);
    expect(removedLead).toBeLessThan(removedPlain * 0.98);
    expect(checkShape(b.body!).valid).toBe(true);
  });
  it("vnější závit odebráním na válci funguje jako dřív", { timeout: 60000 }, async () => {
    const cyl: Feature = { id: id(), name: "Válec", type: "cylinder", radius: 10, height: 30, position: [0, 0, -5], axis: "Z", mode: "new" };
    const doc = base([cyl]);
    const thr = ext(doc, "surf.helixSweep", { profile: "thread60", depth: 1.2, radius: 10, pitch: 2, turns: 10, mode: "cut" });
    const res = await buildDoc(base([cyl, thr]));
    expect(statusOf(res, thr).ok).toBe(true);
    expect(res.metrics!.volume).toBeLessThan(Math.PI * 100 * 30 - 50);
  });
});

describe("katalogové závity – jemné stoupání", () => {
  it("M18×1,5 se najde v tabulce i z textu (x, ×, čárka), jádro = d − P; nestandardní stoupání se dopočítá", () => {
    for (const s of ["M18x1.5", "M18×1,5", "m18 x 1,5", "M18X1.5"]) {
      const t = threadByName(s)!;
      expect(t.name, s).toBe("M18×1,5");
      expect(t.pitch).toBe(1.5);
      expect(t.d).toBe(18);
      expect(t.tap).toBeCloseTo(16.5, 6);
    }
    expect(threadByName("M18")!.pitch).toBe(2.5);
    expect(threadByName("M18x1")!.tap).toBeCloseTo(17, 6);
    expect(threadByName("M18x1")!.name).toBe("M18×1");
    expect(threadByName("M17x1")).toBeUndefined();
    expect(threadByName("M18x12")).toBeUndefined();
    expect(threadLabel("m6")).toBe("M6");
    expect(ALL_THREADS.some((t) => t.name === "M18×1,5")).toBe(true);
    expect(ALL_THREADS.some((t) => t.name === "M10×1,25")).toBe(true);
  });
  it("katalogový prvek Závit M18×1,5: kosmetický i modelovaný, vnější i vnitřní", { timeout: 120000 }, async () => {
    const cyl: Feature = { id: id(), name: "Válec", type: "cylinder", radius: 9, height: 15, position: [0, 0, 0], axis: "Z", mode: "new" };
    const cos: Feature = { id: id(), name: "Závit", type: "thread", designation: "M18x1.5", position: [0, 0, 0], axis: "Z", length: 15, modeled: false };
    const r1 = await buildDoc(base([cyl, cos]));
    expect(statusOf(r1, cos).ok).toBe(true);
    expect(r1.metrics!.volume).toBeCloseTo(Math.PI * 81 * 15, 0);
    const mod: Feature = { ...cos, id: id(), modeled: true };
    const r2 = await buildDoc(base([cyl, mod]));
    expect(statusOf(r2, mod).ok).toBe(true);
    expect(r2.metrics!.volume).toBeLessThan(r1.metrics!.volume - 50);
    // vnitřní: trubka s dírou Ø16,5 (jádro) – drážky jdou ven
    const t: Feature = { id: id(), name: "Trubka", type: "tube", outer: 42, inner: 16.5, height: 15, position: [0, 0, 0], axis: "Z", mode: "new" };
    const inner: Feature = { ...cos, id: id(), modeled: true, internal: true };
    const r3 = await buildDoc(base([t, inner]));
    const r3base = await buildDoc(base([t]));
    expect(statusOf(r3, inner).ok).toBe(true);
    expect(r3.metrics!.volume).toBeLessThan(r3base.metrics!.volume - 50);
    expect(checkShape(r3.body!).valid).toBe(true);
    expect(expectedDims(base([t, inner]), r3.metrics!.bbox).map((d) => d.label)).toContain("M18×1,5 délka 15");
  });
  it("textové příkazy: závit M18×1,5 a díra se závitem M18×1,5 (jádro dopočítané)", () => {
    const p = parseAgentText("závit M18×1,5 délka 20 v 0 0 10 vnitřní\ndíra 5 závit M18x1.5 hloubka 20 v 10 10");
    expect(p.errors).toEqual([]);
    const f1 = (p.ops[0] as { feature: Feature }).feature;
    expect(f1.type).toBe("thread");
    expect(f1.type === "thread" && f1.designation).toBe("M18×1,5");
    expect(f1.type === "thread" && f1.internal).toBe(true);
    const f2 = (p.ops[1] as { feature: Feature }).feature;
    expect(f2.type === "hole" && f2.thread).toBe("M18×1,5");
    expect(f2.type === "hole" && f2.diameter).toBeCloseTo(16.5, 6);
    expect(parseAgentText("závit M17 délka 10").errors[0].message).toMatch(/M2 až M48/);
  });
  it("JSON prvek na jednom řádku lze míchat s textovými příkazy", () => {
    const p = parseAgentText('trubka 42 16.5 30\n{"type":"ext","ext":"surf.helixSweep","data":{"profile":"thread60","side":"internal","depth":0.8,"radius":8.25,"pitch":1.5,"turns":12,"mode":"cut"}}\nstav');
    expect(p.errors).toEqual([]);
    expect(p.ops.map((o) => o.k)).toEqual(["feature", "features", "status"]);
    expect(p.ops[1].line).toBe(2);
    const bad = parseAgentText('kvádr 10 10 10\n{"type":"nic"}');
    expect(bad.errors[0].line).toBe(2);
  });
});

describe("tažení po spline – forma zůstane objemovým tělesem", () => {
  it("kanál po spline odebraný z bloku: platný solid; status ✓ bez varování", { timeout: 120000 }, async () => {
    const block: Feature = { id: id(), name: "Blok", type: "box", size: [120, 100, 40], position: [-60, -50, 0], centered: false, mode: "new" };
    const sp = sk("Spline", { kind: "base", name: "XY", offset: 35 }, [{ id: id(), type: "spline", points: [[-60, 45], [-20, 30], [20, 45], [60, 30]], closed: false }]);
    const sw: Feature = { id: id(), name: "Kanál", type: "sweep", profileId: "", pathId: sp.id, mode: "cut", frenet: false, circleRadius: 3 };
    const res = await buildDoc(base([block, sp, sw]));
    expect(statusOf(res, sw).ok).toBe(true);
    expect(statusOf(res, sw).warning).toBeUndefined();
    const chk = checkShape(res.body!);
    expect(chk.valid).toBe(true);
    expect(chk.solids).toBe(1);
    expect(res.metrics!.volume).toBeLessThan(480000 - 3000);
    expect(res.metrics!.volume).toBeGreaterThan(480000 - 4500);
  });
});

describe("výkres s modelovaným závitem", () => {
  it("šroubovice se pro výkres potlačí (přesná projekce by trvala minuty) a kružnice jádra dostane označení M18×1,5", { timeout: 120000 }, async () => {
    const t = tube();
    const doc = base([t]);
    const thr = ext(doc, "surf.helixSweep", { profile: "thread60", side: "internal", depth: 0.8, radius: 8.2, pitch: 1.5, turns: 12, position: [0, 0, 5], axis: "Z", mode: "cut" });
    const full = base([t, thr]);
    const dd = drawingDoc(full);
    expect(dd.features[1].suppressed).toBe(true);
    expect(drawingDoc(doc)).toBe(doc); // bez závitu beze změny
    const threads = threadsOfDoc(full);
    expect(threads).toEqual([{ r: 8.2, label: "M18×1,5 dl. 18" }]);
    const body = (await buildDoc(dd)).body!;
    const t0 = Date.now();
    const d = makeDrawing(body, { name: "Matice", material: "Ocel", threads });
    expect(Date.now() - t0).toBeLessThan(20000);
    expect(d.texts.filter((x) => x.layer === "dim").map((x) => x.s)).toContain("M18×1,5 dl. 18");
    // katalogový modelovaný závit a závitová díra
    const cyl: Feature = { id: id(), name: "Válec", type: "cylinder", radius: 9, height: 15, position: [0, 0, 0], axis: "Z", mode: "new" };
    const mod: Feature = { id: id(), name: "Závit", type: "thread", designation: "M18x1.5", position: [0, 0, 0], axis: "Z", length: 15, modeled: true };
    expect(threadsOfDoc(base([cyl, mod]))).toEqual([{ r: 9, label: "M18×1,5 dl. 15" }]);
    expect(drawingDoc(base([cyl, mod])).features[1].suppressed).toBe(true);
    const hole: Feature = { id: id(), name: "Díra", type: "hole", position: [0, 0, 0], axis: "Z", flip: false, diameter: 5, depth: 12, cbDiameter: 0, cbDepth: 0, kind: "tapped", thread: "M6" };
    expect(threadsOfDoc(base([cyl, hole]))).toEqual([{ r: 2.5, label: "M6 hl. 12" }]);
    // katalogové označení má přednost před odvozeným ze šroubovice na téže kružnici
    const both = threadsOfDoc(base([t, thr, { ...mod, internal: true, modeled: false, length: 30 }]));
    expect(both[0]).toEqual({ r: 8.25, label: "M18×1,5 dl. 30" });
  });
});

describe("kontrola kót", () => {
  it("rotační díl: průměry a délky z profilu; délka průchozího řezu se nenabízí", () => {
    const prof = sk("Profil", { kind: "base", name: "XZ", offset: 0 }, [{ id: id(), type: "polyline", points: [[0, 0], [21, 0], [21, 100], [16.75, 100], [16.75, 123.75], [0, 123.75]], closed: true }]);
    const rev: Feature = { id: id(), name: "Rotace", type: "revolve", sketchId: prof.id, angle: 360, axis: "y", mode: "new" };
    const cutSk = sk("Řez", { kind: "base", name: "XY", offset: 0 }, [{ id: id(), type: "rect", cx: 0, cy: 30, w: 60, h: 20, r: 0, angle: 0 }]);
    const cut: Feature = { id: id(), name: "Řez", type: "extrude", sketchId: cutSk.id, distance: 60, symmetric: true, reverse: false, mode: "cut" };
    const labels = expectedDims(base([prof, rev, cutSk, cut]), [[-21, 0, -21], [21, 123.75, 21]]).map((d) => d.label);
    expect(labels).toContain("Ø42");
    expect(labels).toContain("Ø33,5");
    expect(labels).toContain("100 (délka Ø42)");
    expect(labels).toContain("23,75 (délka Ø33,5)");
    expect(labels.some((l) => l.startsWith("60 ("))).toBe(false);
  });
});
