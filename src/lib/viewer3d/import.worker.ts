/**
 * Web Worker prohlížeče 3D: načtení modelu (STEP/IGES/BREP přes OpenCascade ve WebAssembly,
 * STL/OBJ/PLY, 3D PDF / U3D / PRC) a výpočet topologie (hrany, rohy, kružnice) mimo hlavní vlákno,
 * aby se stránka při otevírání velkých sestav nesekala.
 */
import { computeTopology, type PartTopology } from "./topology";
import { occtToModel } from "./occt";
import { parseObj, parsePly, parseStl } from "./formats/mesh";
import { decodePdf3D, decodePRC, decodeU3D } from "./formats/embedded3d";
import { ModelImportError, type ParsedModel } from "./types";
import { drawingToModel } from "./drawing-model";
import { loadOcct, occtAbort, readWithOcct, type OcctParams } from "./occt-runtime";
import { indexStep, typeCode, type StepIndex } from "./step-index";
import { buildUnitStep, planStepSplit, type SplitPlan } from "./step-split";
import { bakeAssembly, type ProtoTopology, type UnitResult } from "./step-assembly";
import {
  FINE, SPLIT_MIN_BYTES, SPLIT_UNSURE_MIN_BYTES, TOPOLOGY_MAX_MESH_TRIANGLES, TOPOLOGY_MAX_TRIANGLES, absoluteDeflection, estimateFacesFromBytes, fmtMb, isOutOfMemory, meshLevelNote,
  LaneTuner, partWorkerCount, tessellationFor, type Tessellation,
} from "./tessellation";
import type { LoadProgress, PartRequest, PartResponse, WorkerRequest, WorkerResponse } from "./worker-protocol";

/** Minimální typy workeru (lib „webworker" by v projektu kolidovala s typy DOM). */
interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
  importScripts?: (...urls: string[]) => void;
  navigator?: { hardwareConcurrency?: number; deviceMemory?: number };
}
declare const self: WorkerScope;

function post(msg: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

let lastProgressAt = 0;
/** Časy kroků posledního načtení (ms) — pro ladění a E2E (data-load-stats v prohlížeči). */
let stats: Record<string, number> = {};
/** Průběh (díly po 200 ms, ať se hlavní vlákno nezahltí). */
function progress(id: number, p: LoadProgress, force = false) {
  const now = Date.now();
  if (!force && now - lastProgressAt < 200) return;
  lastProgressAt = now;
  post({ id, type: "progress", ...p });
}

/** Jak dlouho smí OpenCascade číst celý soubor najednou (hlídání zaseknutého workeru). */
function monolithicBudget(bytes: number): number {
  const mb = bytes / 1024 / 1024;
  return Math.round(Math.min(20 * 60_000, 90_000 + mb * 10_000));
}

function collectTransfer(model: ParsedModel, topo: PartTopology[]): Transferable[] {
  const set = new Set<ArrayBuffer>();
  const add = (a: ArrayBufferView | null | undefined) => {
    if (a && a.buffer instanceof ArrayBuffer && a.byteLength) set.add(a.buffer);
  };
  for (const p of model.parts) {
    add(p.positions);
    add(p.normals);
    add(p.indices);
    add(p.lines);
    add(p.lineColors);
  }
  for (const c of model.drawing?.darkColors ?? []) add(c);
  for (const t of topo) {
    add(t.edgeSegments);
    add(t.segCurve);
    add(t.corners);
    add(t.triFace);
  }
  return [...set];
}

async function importModel(req: Extract<WorkerRequest, { type: "import" }>): Promise<ParsedModel> {
  const bytes = new Uint8Array(req.bytes);
  switch (req.format) {
    case "step":
    case "iges":
    case "brep": {
      // stažení + překlad OpenCascade (7,6 MB WebAssembly) může na pomalé lince trvat
      post({ id: req.id, type: "progress", stage: "engine", budgetMs: 180_000 });
      const occt = await loadOcct(req.occtJs, req.occtWasm);
      // velká STEP sestava → po dílech (paralelně, s průběhem); jinak celý soubor najednou
      let ix: StepIndex | null = null;
      if (req.format === "step" && bytes.length >= SPLIT_MIN_BYTES) {
        progress(req.id, { stage: "split", budgetMs: 180_000 }, true);
        let t = Date.now();
        ix = indexStep(bytes);
        stats.index = Date.now() - t;
        t = Date.now();
        const plan = ix ? planStepSplit(ix) : null;
        stats.plan = Date.now() - t;
        // něco ve stromu nepoznáno (tělesa mimo díly): menší soubor raději celý najednou jako dřív,
        // velký by tak neprošel → po dílech s upozorněním
        const trusted = plan && (plan.uncoveredSolids === 0 || bytes.length >= SPLIT_UNSURE_MIN_BYTES);
        if (ix && plan && trusted && plan.units.length >= 2) {
          if (plan.uncoveredSolids) plan.warnings.push(`${plan.uncoveredSolids} těles sestavy má neznámou vazbu — v modelu chybí.`);
          return importStepSplit(req, ix, plan);
        }
      }
      // malý soubor: dosavadní jemnost; velký (nejde rozdělit) → hrubší podle počtu ploch
      let tess: Tessellation = FINE;
      if (bytes.length >= SPLIT_MIN_BYTES) {
        const faceCode = ix ? typeCode(ix, "ADVANCED_FACE") : -1;
        let faces = 0;
        if (ix && faceCode > 0) for (let k = 0; k < ix.count; k++) if (ix.type[k] === faceCode) faces++;
        tess = tessellationFor(faces || estimateFacesFromBytes(bytes.length));
      }
      ix = null;
      progress(req.id, { stage: "parse", budgetMs: monolithicBudget(bytes.length) }, true);
      const params: OcctParams = { linearUnit: "millimeter", linearDeflectionType: "bounding_box_ratio", linearDeflection: tess.linearRatio, angularDeflection: tess.angular };
      const result = readWithOcct(occt, req.format, bytes, params);
      if (!result?.success || !result.meshes?.length) {
        throw new ModelImportError(
          req.format === "step"
            ? "STEP se nepodařilo načíst — soubor je poškozený nebo neobsahuje žádná tělesa (jen výkres / PMI)."
            : "Soubor se nepodařilo načíst — je poškozený nebo neobsahuje žádná tělesa.",
        );
      }
      const label = req.format === "step" ? "STEP" : req.format === "iges" ? "IGES" : "BREP";
      const model = occtToModel(result, label);
      // OpenCascade bez paměti na síť vrátí tělesa bez trojúhelníků → prázdná scéna; radši srozumitelná chyba
      if (model.parts.every((p) => p.positions.length === 0)) {
        throw new ModelImportError(`Síť modelu se nepodařilo vytvořit — model je pro prohlížeč nejspíš příliš velký (${fmtMb(bytes.length)}). Stáhni ho a otevři v CADu.`);
      }
      const note = meshLevelNote(tess.level);
      if (note) model.warnings = [...(model.warnings ?? []), note];
      return model;
    }
    case "stl":
      post({ id: req.id, type: "progress", stage: "parse", budgetMs: monolithicBudget(bytes.length) });
      return parseStl(bytes, req.name);
    case "obj":
      post({ id: req.id, type: "progress", stage: "parse", budgetMs: monolithicBudget(bytes.length) });
      return parseObj(bytes, req.name);
    case "ply":
      post({ id: req.id, type: "progress", stage: "parse", budgetMs: monolithicBudget(bytes.length) });
      return parsePly(bytes, req.name);
    case "u3d":
      post({ id: req.id, type: "progress", stage: "parse", budgetMs: monolithicBudget(bytes.length) });
      return decodeU3D(bytes);
    case "prc":
      post({ id: req.id, type: "progress", stage: "parse", budgetMs: monolithicBudget(bytes.length) });
      return decodePRC(bytes);
    case "pdf":
      post({ id: req.id, type: "progress", stage: "parse", budgetMs: monolithicBudget(bytes.length) });
      return decodePdf3D(bytes);
    case "dxf": {
      post({ id: req.id, type: "progress", stage: "parse", budgetMs: monolithicBudget(bytes.length) });
      const { parseDxf } = await import("./formats/dxf");
      return withTopology(drawingToModel(parseDxf(bytes)));
    }
    case "dwg": {
      post({ id: req.id, type: "progress", stage: "engine", budgetMs: monolithicBudget(bytes.length) });
      const { parseDwg } = await import("./formats/dwg");
      const d = await parseDwg(bytes, req.dwgWasmDir);
      return withTopology(drawingToModel(d));
    }
    default:
      throw new ModelImportError("Tento formát 3D modelu zatím neumím otevřít.");
  }
}

/** Limit na jeden díl sestavy (zaseknutý / spadlý worker se nahradí, díl se vynechá). */
function partBudget(bytes: number): number {
  return Math.round(60_000 + (bytes / 1024 / 1024) * 30_000);
}

type PartOutcome = { ok: true; value: UnitResult } | { ok: false; fatal: boolean; error: string };

/** Spuštění dílu v samostatném workeru (s hlídáním času a pádu). */
function runPart(w: Worker, req: PartRequest, budget: number): Promise<PartOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: PartOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      w.onmessage = null;
      w.onerror = null;
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, fatal: true, error: "timeout" }), budget);
    w.onmessage = (ev: MessageEvent<PartResponse>) => {
      const m = ev.data;
      if (m.id !== req.id) return;
      if (m.type === "done") finish({ ok: true, value: { parts: m.parts, topology: m.topology } });
      else finish({ ok: false, fatal: m.fatal, error: m.error });
    };
    w.onerror = (ev) => {
      ev.preventDefault?.();
      finish({ ok: false, fatal: true, error: ev.message || "worker error" });
    };
    w.postMessage(req, [req.bytes]);
  });
}

function spawnPartWorker(): Worker | null {
  try {
    if (typeof Worker === "undefined") return null;
    return new Worker(new URL("./occt-part.worker.ts", import.meta.url));
  } catch {
    return null;
  }
}

/** Velká STEP sestava: díly zvlášť (několik workerů souběžně), pak složení výskytů. */
async function importStepSplit(req: Extract<WorkerRequest, { type: "import" }>, ix: StepIndex, plan: SplitPlan): Promise<ParsedModel> {
  const tess = tessellationFor(plan.totalFaces);
  const params: OcctParams = {
    linearUnit: "millimeter",
    linearDeflectionType: "absolute_value",
    linearDeflection: absoluteDeflection(tess, plan.avgSize),
    angularDeflection: tess.angular,
  };
  const total = plan.units.length;
  const results: (UnitResult | null)[] = new Array(total).fill(null);
  // velké díly první (rovnoměrné vytížení workerů); drátová geometrie bez ploch se nečte
  const order = plan.units.map((_, i) => i).filter((i) => !plan.units[i].empty).sort((a, b) => plan.units[b].bytes - plan.units[a].bytes);
  if (!order.length) throw new ModelImportError("V souboru STEP nejsou žádná tělesa ani plochy (jen drátová geometrie / výkres).");
  let next = 0;
  let done = total - order.length;
  let failed = 0;
  let oom = false;
  const report = (force = false) => progress(req.id, { stage: "parse", done, total }, force);
  report(true);
  const heartbeat = setInterval(() => report(true), 1000);
  let seq = 0;

  const nav = self.navigator;
  const maxLanes = partWorkerCount(nav?.hardwareConcurrency, nav?.deviceMemory);
  const tuner = new LaneTuner(maxLanes);
  let target = tuner.target;
  let bytesDone = 0;
  let maxTarget = 1;
  const tParts = Date.now();
  Object.assign(stats, { units: total, occurrences: plan.occurrences, faces: plan.totalFaces });
  const lane = async (index: number): Promise<boolean> => {
    let w = spawnPartWorker();
    if (!w) return false;
    let respawns = 0;
    try {
      while (next < order.length && index < target) {
        const u = order[next++];
        const file = buildUnitStep(ix, plan.units[u]);
        const size = file.length;
        const r = await runPart(
          w,
          { id: ++seq, bytes: file.buffer as ArrayBuffer, params, occtJs: req.occtJs, occtWasm: req.occtWasm, topology: true },
          partBudget(size),
        );
        if (r.ok) results[u] = r.value.parts.length ? r.value : null;
        if (!r.ok || !r.value.parts.length) failed++;
        if (!r.ok && isOutOfMemory(r.error)) oom = true;
        if (!r.ok && r.fatal) {
          w.terminate();
          if (++respawns > 20) throw new Error("Workery OpenCascade opakovaně padají.");
          w = spawnPartWorker();
          if (!w) throw new Error("Nový worker OpenCascade se nespustil.");
        }
        bytesDone += size;
        done++;
        report();
      }
      return true;
    } finally {
      w?.terminate();
    }
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let noWorkers = false;
  const finished = () => next >= order.length || noWorkers;
  const lanes: Promise<boolean>[] = [lane(0).then((ok) => {
    if (!ok) noWorkers = true;
    return ok;
  })];
  // ladění počtu workerů podle skutečné propustnosti (viz LaneTuner)
  const controller = async () => {
    const t0 = Date.now();
    while (!finished() && done < 2 && Date.now() - t0 < 20_000) await sleep(100);
    while (!finished() && !tuner.settled) {
      const b0 = bytesDone, w0 = Date.now();
      for (let k = 0; k < 40 && !finished(); k++) await sleep(100);
      if (finished()) break;
      const nt = tuner.next((bytesDone - b0) / Math.max(1, Date.now() - w0));
      if (nt > target) {
        target = nt;
        maxTarget = Math.max(maxTarget, nt);
        lanes.push(lane(nt - 1));
        await sleep(1500); // nový worker se rozjíždí (překlad WebAssembly)
      } else target = nt;
    }
  };

  try {
    await controller();
    const started = await Promise.all(lanes);
    Object.assign(stats, { workers: target, maxWorkers: maxTarget });
    if (!started.some(Boolean)) {
      // vnořené workery nejdou (starší Safari) → díly postupně tady
      const occt = await loadOcct(req.occtJs, req.occtWasm);
      while (next < order.length) {
        const u = order[next++];
        try {
          const res = readWithOcct(occt, "step", buildUnitStep(ix, plan.units[u]), params);
          if (res?.success && res.meshes?.length) {
            const m = occtToModel(res, "STEP");
            results[u] = { parts: m.parts, topology: m.parts.map((p) => computeTopology({ positions: p.positions, indices: p.indices, faces: p.faces })) };
          } else failed++;
        } catch (e) {
          if (occtAbort) throw e;
          failed++;
        }
        done++;
        report();
      }
    }
  } finally {
    clearInterval(heartbeat);
  }
  report(true);
  stats.parts = Date.now() - tParts;
  stats.failed = failed;
  if (failed >= order.length) {
    throw new ModelImportError(
      oom
        ? `Na zobrazení modelu nestačí paměť prohlížeče (${fmtMb(ix.bytes.length)}). Stáhni ho a otevři v CADu.`
        : "STEP se nepodařilo načíst — žádný díl sestavy nejde přečíst (soubor je poškozený, nebo obsahuje jen výkres / PMI).",
    );
  }
  progress(req.id, { stage: "topology" }, true);
  const tBake = Date.now();
  const { model, topology, prototypes } = bakeAssembly(plan, results, "STEP", true, true);
  stats.bake = Date.now() - tBake;
  const warnings = model.warnings ?? [];
  if (failed) warnings.push(`${failed} ${failed === 1 ? "díl se nepodařilo" : failed < 5 ? "díly se nepodařilo" : "dílů se nepodařilo"} načíst — v modelu chybí.`);
  const note = meshLevelNote(tess.level);
  if (note) warnings.push(note);
  model.warnings = warnings.length ? warnings : undefined;
  return withTopology({ model, topology, prototypes });
}

/** Výkres má topologii z přesné geometrie (ne ze sítě) — předá se dál s modelem. */
const drawingTopo = new WeakMap<ParsedModel, PartTopology[]>();
const protoTopo = new WeakMap<ParsedModel, ProtoTopology[]>();
function withTopology(d: { model: ParsedModel; topology: PartTopology[]; prototypes?: ProtoTopology[] }): ParsedModel {
  drawingTopo.set(d.model, d.topology);
  if (d.prototypes) protoTopo.set(d.model, d.prototypes);
  return d.model;
}

function triangles(model: ParsedModel): number {
  let n = 0;
  for (const p of model.parts) n += p.indices ? p.indices.length / 3 : p.positions.length / 9;
  return n;
}

const EMPTY_TOPOLOGY = (): PartTopology => ({ edgeSegments: new Float32Array(0), curves: [], segCurve: new Uint32Array(0), corners: new Float32Array(0), triFace: new Uint32Array(0), faces: [] });

function topologies(model: ParsedModel): PartTopology[] {
  const t = drawingTopo.get(model);
  if (t) return t;
  // obrovská síť (STL / IGES o milionech trojúhelníků) → bez přesných hran (měření jen na síti)
  // síť bez ploch B-repu (STL…) se dělí na plochy podle úhlů — dražší a s mnohem víc objekty
  const brep = model.parts.some((p) => p.faces?.length);
  if (triangles(model) > (brep ? TOPOLOGY_MAX_TRIANGLES : TOPOLOGY_MAX_MESH_TRIANGLES)) {
    model.warnings = [...(model.warnings ?? []), "U velkého modelu je měření zjednodušené — hrany a středy děr se nevyhledávají."];
    return model.parts.map(EMPTY_TOPOLOGY);
  }
  return model.parts.map((p) => computeTopology({ positions: p.positions, indices: p.indices, faces: p.faces }));
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    stats = {};
    const t0 = Date.now();
    const model = req.type === "import" ? await importModel(req) : req.model;
    const t1 = Date.now();
    post({ id: req.id, type: "progress", stage: "topology" });
    const topo = topologies(model);
    const t2 = Date.now();
    post({ id: req.id, type: "done", model, topology: topo, prototypes: protoTopo.get(model), timings: { ...stats, parse: t1 - t0, topology: t2 - t1, triangles: Math.round(triangles(model)) } }, collectTransfer(model, topo));
  } catch (e) {
    const known = e instanceof ModelImportError;
    const message = e instanceof Error ? e.message : String(e);
    const size = req.type === "import" ? req.bytes.byteLength : 0;
    const oom = isOutOfMemory(message) || /OOM/i.test(occtAbort ?? "");
    post({
      id: req.id,
      type: "error",
      error: known
        ? message
        : oom
          ? `Model je pro prohlížeč příliš velký${size ? ` (${fmtMb(size)})` : ""} — nestačí paměť. Stáhni ho a otevři v CADu.`
          : `Model se nepodařilo načíst (${message}).`,
    });
  }
};
