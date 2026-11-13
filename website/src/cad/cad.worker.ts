/// <reference lib="webworker" />
/* CAD jádro ve web workeru: OpenCascade (WASM) + replicad. UI zůstává plynulé i při složitých operacích. */
import { setLang, tr, type CadLang } from "./i18n";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc, buildShape, faceInfo, type BuildProgress } from "./build";
import { drawingDoc } from "./drawing-doc";
import { drawingModelShapes } from "./drawing-models";
import { makeDrawing, type DrawingMeta, type DrawingOptions } from "./drawing";
import { makeSmartDrawing } from "./drawing-dims";
import { cachedBody, findCylFace, interference, mateFaceInfo, partEntry, shapeOfDoc } from "./asm-kernel";
import { compareTransferables, compareWithReference, type CompareOptions, type ReferenceFile } from "./compare";
import { exportShape } from "./formats/export";
import { entityInfo, measureEntities, shapeFor, vertexPositions, type EntRef, type ShapeSrc } from "./inspect";
import { refInfo, resolvePlaneDef } from "./ref-resolve";
import { stampPicks } from "./pick-sigs";
import { datumDisplay, type DatumDisplay } from "./feat/refs-more";
import type { PlaneDef, Ref } from "./refs";
import type { CadDoc, ComponentSource, ExportFormat, Feature, MeshData } from "./types";
import { blobId, putBlobAs } from "./blobs";
import { perfMark, setPerfSink } from "./perf-log";
import { splitStepAssembly } from "./formats/step-assembly";
import { isFatalKernelError } from "./kernel-errors";

let ready: Promise<void> | null = null;
let body: r.Shape3D | null = null;
let drawCache: { key: string; body: r.Shape3D } | null = null;

function init() {
  if (!ready) {
    ready = (opencascade as unknown as (o: object) => Promise<unknown>)({
      print: () => undefined,
      printErr: () => undefined,
    }).then((oc) => {
      r.setOC(oc as never);
    });
    ready.catch(() => (ready = null));
  }
  return ready;
}

type Req =
  | { id: number; op: "init" }
  | { id: number; op: "build"; doc: CadDoc }
  | { id: number; op: "topology"; doc: CadDoc }
  | { id: number; op: "face"; index: number }
  | { id: number; op: "export"; format: ExportFormat; doc: CadDoc }
  | { id: number; op: "asmParts"; parts: { key: string; source: ComponentSource }[] }
  | { id: number; op: "asmFace"; key: string; index: number }
  | { id: number; op: "lang"; lang: CadLang }
  | { id: number; op: "interference"; doc: CadDoc }
  | { id: number; op: "compare"; doc: CadDoc; file: ReferenceFile; opts?: CompareOptions }
  | { id: number; op: "mateFace"; key: string; index: number }
  | { id: number; op: "cylFace"; key: string; radius: number }
  | { id: number; op: "inspect"; src: ShapeSrc; ref: EntRef; density?: number }
  | { id: number; op: "measureEnt"; a: { src: ShapeSrc; ref: EntRef }; b: { src: ShapeSrc; ref: EntRef } | null }
  | { id: number; op: "drawing"; doc: CadDoc; meta: DrawingMeta; opts?: Partial<DrawingOptions> }
  | { id: number; op: "refInfo"; doc: CadDoc; ref: Ref }
  | { id: number; op: "planeDef"; doc: CadDoc; def: PlaneDef }
  | { id: number; op: "datumGfx"; doc: CadDoc }
  | { id: number; op: "pickSigs"; doc: CadDoc; feature: Feature }
  | { id: number; op: "stepSplit"; bytes: Uint8Array; fileName: string };

/** Kontext řešení odkazů nad posledním postaveným tělesem a aktuálním dokumentem. */
function refCtx(doc: CadDoc) {
  const sketches = new Map(doc.features.filter((f): f is Extract<typeof f, { type: "sketch" }> => f.type === "sketch").map((f) => [f.id, f]));
  return { body, sketches, features: doc.features };
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;
setPerfSink((e) => ctx.postMessage({ perf: e }));
/** jádro po pádu WASM (nedostatek paměti, abort) – každý další požadavek se odmítne, UI spustí nové jádro */
let fatal: string | null = null;

/** průběh stavby do UI: právě počítaný prvek (zpráva bez `ok` – odpověď na požadavek přijde až po dokončení) */
const progressTo = (id: number) => (p: BuildProgress) => ctx.postMessage({ id, progress: p });

ctx.onmessage = async (e: MessageEvent<Req & { blobs?: Record<string, Uint8Array> }>) => {
  const m = e.data;
  // data importovaných souborů posílá UI jen poprvé (odkazy mnblob: v dokumentu)
  if (m.blobs) for (const [k, v] of Object.entries(m.blobs)) putBlobAs(k, v);
  if (fatal) return ctx.postMessage({ id: m.id, ok: false, error: fatal, fatal: true });
  try {
    await init();
    switch (m.op) {
      case "init":
        ctx.postMessage({ id: m.id, ok: true });
        break;
      case "lang":
        setLang(m.lang);
        ctx.postMessage({ id: m.id, ok: true });
        break;
      case "build": {
        const res = await buildDoc(m.doc, { onProgress: progressTo(m.id) });
        body?.delete?.();
        body = res.body;
        const { body: _b, ...plain } = res;
        void _b;
        if (!plain.vertices && body) {
          try {
            plain.vertices = vertexPositions(body);
          } catch {
            /* bez vrcholů */
          }
        }
        const t = plain.mesh ? [plain.mesh.vertices.buffer, plain.mesh.normals.buffer, plain.mesh.triangles.buffer, plain.mesh.faceGroups.buffer, plain.mesh.lines.buffer, plain.mesh.edgeGroups.buffer] : [];
        ctx.postMessage({ id: m.id, ok: true, result: plain, at: Date.now() }, t as Transferable[]);
        break;
      }
      case "face":
        ctx.postMessage({ id: m.id, ok: true, result: body ? faceInfo(body, m.index) : null });
        break;
      case "refInfo":
        ctx.postMessage({ id: m.id, ok: true, result: refInfo(refCtx(m.doc), m.ref) });
        break;
      case "datumGfx": {
        // pomocné osy / body / souřadné systémy k vykreslení (neřešitelné se přeskočí – chybu ukáže historie)
        const out: { id: string; gfx: DatumDisplay }[] = [];
        const rc = refCtx(m.doc);
        for (const f of m.doc.features) {
          if (f.suppressed || (f.type !== "datumAxis" && f.type !== "datumPoint" && f.type !== "csys")) continue;
          try {
            const g = datumDisplay(rc, f);
            if (g) out.push({ id: f.id, gfx: g });
          } catch {
            /* přeskočit */
          }
        }
        ctx.postMessage({ id: m.id, ok: true, result: out });
        break;
      }
      case "pickSigs": {
        // výběr hran/ploch prvku nad tělesem PŘED prvkem (`doc` je oříznutý před prvek): znovunalezení podle otisků + otisky nových indexů
        const { bodies } = await buildShape(m.doc, Infinity, { preferActive: true });
        const b = bodies[0]?.shape;
        ctx.postMessage({ id: m.id, ok: true, result: b ? stampPicks(m.feature, b) : null });
        break;
      }
      case "planeDef": {
        try {
          ctx.postMessage({ id: m.id, ok: true, result: { plane: resolvePlaneDef(refCtx(m.doc), m.def) } });
        } catch (e) {
          ctx.postMessage({ id: m.id, ok: true, result: { plane: null, error: e instanceof Error ? e.message : String(e) } });
        }
        break;
      }
      case "stepSplit": {
        // sestava STEP → díly (každý svůj malý STEP); data dílů si jádro ponechá (UI je už nemusí posílat zpět)
        const t0 = Date.now();
        const split = splitStepAssembly(m.bytes, (done, total) => ctx.postMessage({ id: m.id, progress: { phase: "feature", index: done - 1, total, name: m.fileName } }));
        if (!split) {
          ctx.postMessage({ id: m.id, ok: true, result: null });
          break;
        }
        perfMark("kernel.step.split", Date.now() - t0, { index: split.ms.index, tree: split.ms.tree, extract: split.ms.extract, parts: split.parts.length, instances: split.leafInstances });
        const t: Transferable[] = [];
        const parts = split.parts.map((p) => {
          const id = blobId(p.bytes);
          putBlobAs(id, p.bytes);
          const copy = p.bytes.slice();
          t.push(copy.buffer);
          return { ...p, id, bytes: copy };
        });
        ctx.postMessage({ id: m.id, ok: true, result: { ...split, parts } }, t);
        break;
      }
      case "asmParts": {
        const out = [];
        const t: Transferable[] = [];
        const req = m as typeof m & { offset?: number; total?: number };
        for (const [i, p] of m.parts.entries()) {
          ctx.postMessage({ id: m.id, progress: { phase: "feature", index: (req.offset ?? 0) + i, total: req.total ?? m.parts.length, name: p.source.kind === "file" ? p.source.fileName : p.source.doc.name } });
          const tp = Date.now();
          const e = await partEntry(p.key, p.source);
          if (Date.now() - tp > 50) perfMark("kernel.part", Date.now() - tp, { name: p.source.kind === "file" ? p.source.fileName : p.source.doc.name, triangles: (e.result.mesh?.triangles.length ?? 0) / 3 });
          if (!e.result.vertices && e.body) {
            try {
              e.result.vertices = vertexPositions(e.body);
            } catch {
              /* bez vrcholů */
            }
          }
          const res = { ...e.result, mesh: e.result.mesh ? copyMesh(e.result.mesh) : null, vertices: e.result.vertices?.slice() };
          if (res.mesh) t.push(res.mesh.vertices.buffer, res.mesh.normals.buffer, res.mesh.triangles.buffer, res.mesh.faceGroups.buffer, res.mesh.lines.buffer, res.mesh.edgeGroups.buffer);
          out.push({ key: p.key, result: res });
        }
        ctx.postMessage({ id: m.id, ok: true, result: out, at: Date.now() }, t);
        break;
      }
      case "asmFace": {
        const b = cachedBody(m.key);
        ctx.postMessage({ id: m.id, ok: true, result: b ? faceInfo(b, m.index) : null });
        break;
      }
      case "topology": {
        // sestavení + inspekce všech ploch a hran v jednom kroku: mezi sestavením a inspekcí nemůže přijít jiné sestavení (jiná záložka)
        const res = await buildDoc(m.doc, { onProgress: progressTo(m.id) });
        const sh = res.body;
        if (!sh || !res.metrics) {
          ctx.postMessage({ id: m.id, ok: true, result: null });
          break;
        }
        const faces = [];
        for (let i = 0; i < res.metrics.faces; i++) {
          try {
            const info = entityInfo(sh, { kind: "face", index: i });
            faces.push({ index: i, planar: info.surface === "PLANE", normal: info.normal, center: info.center, area: info.area, surface: info.surface });
          } catch {
            faces.push({ index: i, planar: false });
          }
        }
        const edges = [];
        for (let i = 0; i < res.metrics.edges; i++) {
          try {
            const info = entityInfo(sh, { kind: "edge", index: i });
            edges.push({ index: i, curve: info.curve ?? info.title, dir: info.dir, center: info.center ?? info.mid ?? info.point, radius: info.radius, length: info.length });
          } catch {
            edges.push({ index: i });
          }
        }
        body?.delete?.();
        body = sh;
        ctx.postMessage({ id: m.id, ok: true, result: { faces, edges, bbox: res.metrics.bbox, metrics: res.metrics, bodies: res.bodies } });
        break;
      }
      case "inspect": {
        const sh = shapeFor(m.src, body, cachedBody);
        if (!sh) throw new Error(tr("Těleso není k dispozici."));
        const info = entityInfo(sh, m.ref, m.density);
        if (m.src.kind === "comp") sh.delete?.();
        ctx.postMessage({ id: m.id, ok: true, result: info });
        break;
      }
      case "measureEnt": {
        const sa = shapeFor(m.a.src, body, cachedBody);
        const sb = m.b ? shapeFor(m.b.src, body, cachedBody) : null;
        if (!sa) throw new Error(tr("Těleso není k dispozici."));
        const res = measureEntities(sa, m.a.ref, sb, m.b?.ref ?? null);
        if (m.a.src.kind === "comp") sa.delete?.();
        if (sb && m.b?.src.kind === "comp") sb.delete?.();
        ctx.postMessage({ id: m.id, ok: true, result: res });
        break;
      }
      case "interference":
        ctx.postMessage({ id: m.id, ok: true, result: await interference(m.doc) });
        break;
      case "compare": {
        // porovnání s referenčním modelem: těleso dokumentu (z mezipaměti stavby) proti souboru STEP / BREP / STL
        const res = await buildDoc(m.doc, { onProgress: progressTo(m.id) });
        if (!res.body) throw new Error(tr("Model je prázdný."));
        try {
          const out = await compareWithReference(res.body, m.file, m.opts, (s) => ctx.postMessage({ id: m.id, progress: { index: s.index, total: s.total, name: s.name, phase: "feature" } }));
          ctx.postMessage({ id: m.id, ok: true, result: out }, compareTransferables(out));
        } finally {
          res.body.delete?.();
        }
        break;
      }
      case "mateFace":
        ctx.postMessage({ id: m.id, ok: true, result: mateFaceInfo(m.key, m.index) });
        break;
      case "cylFace":
        ctx.postMessage({ id: m.id, ok: true, result: findCylFace(m.key, m.radius) });
        break;
      case "export": {
        const b = await shapeOfDoc(m.doc);
        if (!b) throw new Error(tr("Model je prázdný."));
        const buf = await exportShape(b, m.format, m.doc.name);
        ctx.postMessage({ id: m.id, ok: true, result: buf }, [buf]);
        break;
      }
      case "drawing": {
        // těleso se přestaví jen při změně geometrie (razítko, název, materiál, poznámky těleso nemění – ty jsou rychlé)
        // závity se kreslí zjednodušeně (kružnice + označení) – modelované šroubovice se pro výkres potlačí (jejich přesná projekce trvá minuty)
        const dd = drawingDoc(m.doc);
        const key = JSON.stringify({ f: dd.features, v: dd.variables, c: dd.configs, a: dd.activeConfig, b: dd.bodies, k: dd.kind, comp: dd.components, mates: dd.mates });
        // další modely na listu (komponenty sestavy, vložené dokumenty) – vlastní tělesa z mezipaměti
        const extra = await drawingModelShapes(m.doc, m.opts?.models);
        if (drawCache?.key !== key) {
          const b = await shapeOfDoc(dd);
          if (!b) throw new Error(tr("Model je prázdný."));
          drawCache?.body.delete?.();
          drawCache = { key, body: b };
        }
        // Chytré kóty: list bez zapečených kót (s místem navíc) + plán kót podle prvků jako upravitelné poznámky (cad/drawing-dims.ts)
        const smart = m.opts?.dimensions === "smart" && dd.kind !== "assembly";
        ctx.postMessage({ id: m.id, ok: true, result: smart ? makeSmartDrawing(drawCache.body, m.doc, m.meta, m.opts, extra) : makeDrawing(drawCache.body, m.meta, m.opts, extra) });
        break;
      }
    }
  } catch (err) {
    // pád WASM (nedostatek paměti, abort, přístup mimo paměť): jádro je nepoužitelné – UI ho ukončí a spustí nové
    if (isFatalKernelError(err)) {
      fatal = err instanceof Error ? err.message : String(err);
      return ctx.postMessage({ id: m.id, ok: false, error: fatal, fatal: true });
    }
    ctx.postMessage({ id: m.id, ok: false, error: err instanceof Error ? err.message : tr("Chyba CAD jádra.") });
  }
};

/** kopie sítě – originál zůstává v mezipaměti workeru, kopie se předá (transfer) do UI */
function copyMesh(m: MeshData): MeshData {
  return {
    vertices: m.vertices.slice(),
    normals: m.normals.slice(),
    triangles: m.triangles.slice(),
    faceGroups: m.faceGroups.slice(),
    lines: m.lines.slice(),
    edgeGroups: m.edgeGroups.slice(),
  };
}
