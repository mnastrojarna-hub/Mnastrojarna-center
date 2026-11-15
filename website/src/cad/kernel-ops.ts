/**
 * Obsluha požadavků CAD jádra (CAD-HEADLESS-NAVRH.md kap. 2.3, balík B1): OpenCascade (WASM) + replicad. Přesun `switch`
 * z `cad.worker.ts` beze změny chování – `handleKernel(req, post)` volá Web Worker v prohlížeči (`cad.worker.ts`, obal) i
 * in-process transport ve vlákně běhu CLI (`kernel-inprocess.ts`). Stav jádra (poslední postavené těleso, těleso výkresu,
 * pád WASM) je modulový: jedna instance jádra na vlákno, stejně jako jeden worker na instanci.
 */
import { setLang, tr } from "./i18n";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc, buildShape, cachedSteps, clearBuildCache, faceInfo, type BuildProgress } from "./build";
import { faceOwner } from "./face-owner";
import { resolveDoc } from "./params";
import { drawingDoc } from "./drawing-doc";
import { clearDrawingModels, drawingBody, drawingModelShapes, realPartGeom } from "./drawing-models";
import { makeDrawing, type DrawingMeta } from "./drawing";
import { makeSmartDrawing } from "./drawing-dims";
import { asmEnvelope, cachedBody, clearInterferenceCache, clearPartCache, findCylFace, interference, mateEdgeInfo, mateFaceInfo, mateFaceMesh, mateVertexInfo, partEntry, shapeOfDoc } from "./asm-kernel";
import { clearCompareCache, compareTransferables, compareWithReference } from "./compare";
import { clashDetail, clearClashDetailCache } from "./clash-detail";
import { exportShape } from "./formats/export";
import { entityInfo, measureEntities, shapeFor, vertexPositions, type ShapeSrc } from "./inspect";
import { measureQuery } from "./measure";
import { surfQuery } from "./surf-query";
import { refInfo, resolvePlaneDef } from "./ref-resolve";
import { stampPicks } from "./pick-sigs";
import { datumDisplay, type DatumDisplay } from "./feat/refs-more";
import type { CadDoc, MeshData } from "./types";
import { blobId, missingBlobs, putBlobAs } from "./blobs";
import { perfMark } from "./perf-log";
import { formNotesOfDoc, springMarksOf } from "./drawing-doc";
import { hasWelds, weldMarksOf } from "./drawing-welds";
import { springDrawTables } from "./drawing-springtable";
import { splitStepAssembly } from "./formats/step-assembly";
import { isFatalKernelError } from "./kernel-errors";
import { exportStats } from "./export-verify";
import type { KernelEnvelope, KernelPost, KernelReqOp, KernelResults } from "./kernel-protocol";

/** Volby načtení jádra: `locateFile` = kde emscripten najde `replicad_single.wasm` (jinak vedle svého modulu / svazku). */
export type KernelInit = { locateFile?: (file: string, prefix: string) => string };

let ready: Promise<void> | null = null;
let initOpts: KernelInit = {};
let body: r.Shape3D | null = null;
/** jádro po pádu WASM (nedostatek paměti, abort) – každý další požadavek se odmítne, klient spustí nové jádro */
let fatal: string | null = null;

/** Nastaví volby načtení jádra (platí pro příští načtení OCCT – první požadavek nebo nová instance po `resetKernel`). */
export function configureKernel(o: KernelInit): void {
  initOpts = { ...o };
}

function init() {
  if (!ready) {
    const { locateFile } = initOpts;
    ready = (opencascade as unknown as (o: object) => Promise<unknown>)({
      print: () => undefined,
      printErr: () => undefined,
      ...(locateFile ? { locateFile } : {}),
    }).then((oc) => {
      r.setOC(oc as never);
    });
    ready.catch(() => (ready = null));
  }
  return ready;
}

/**
 * Nová instance jádra ve stejném vlákně (in-process transport po pádu): zahodí stav i mezipaměti s tělesy staré instance
 * OCCT a příští požadavek načte OCCT znovu. Tělesa staré instance se jen zapomenou (`delete` na spadlé haldě WASM by
 * mohl znovu spadnout). Web Worker to nepotřebuje – nová instance je nový worker s novými moduly.
 */
export function resetKernel(): void {
  ready = null;
  body = null;
  fatal = null;
  clearBuildCache();
  clearPartCache();
  clearInterferenceCache();
  clearClashDetailCache();
  clearDrawingModels();
  try {
    clearCompareCache();
  } catch {
    /* reference staré instance OCCT */
  }
}

/** Kontext řešení odkazů nad posledním postaveným tělesem a aktuálním dokumentem. */
function refCtx(doc: CadDoc) {
  const sketches = new Map(doc.features.filter((f): f is Extract<typeof f, { type: "sketch" }> => f.type === "sketch").map((f) => [f.id, f]));
  return { body, sketches, features: doc.features };
}

/** odpověď na požadavek – typ výsledku hlídá mapa `KernelResults`; `at` = čas odeslání (měření přenosu v klientovi) */
function reply<K extends KernelReqOp>(post: KernelPost, m: { id: number; op: K }, result: KernelResults[K], transfer?: Transferable[], at?: number) {
  post(at === undefined ? { id: m.id, ok: true, result } : { id: m.id, ok: true, result, at }, transfer);
}

/**
 * Obslouží jeden požadavek a odpověď (průběh, výsledek, chybu) pošle přes `post`. Data importů (`blobs`) se uloží před
 * výpočtem. Pád WASM se zapamatuje: další požadavky se odmítnou s `fatal`, dokud klient nespustí novou instanci.
 */
export async function handleKernel(m: KernelEnvelope, post: KernelPost): Promise<void> {
  /** průběh stavby: právě počítaný prvek (zpráva bez `ok` – odpověď na požadavek přijde až po dokončení) */
  const progressTo = (id: number) => (p: BuildProgress) => post({ id, progress: p });
  // data importovaných souborů posílá klient jen poprvé (odkazy mnblob: v dokumentu)
  if (m.blobs) for (const [k, v] of Object.entries(m.blobs)) putBlobAs(k, v);
  if (fatal) return post({ id: m.id, ok: false, error: fatal, fatal: true });
  try {
    await init();
    switch (m.op) {
      case "init":
        reply(post, m, undefined);
        break;
      case "lang":
        setLang(m.lang);
        reply(post, m, undefined);
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
        reply(post, m, plain, t as Transferable[], Date.now());
        break;
      }
      case "face":
        reply(post, m, body ? faceInfo(body, m.index) : null);
        break;
      case "refInfo":
        reply(post, m, refInfo(refCtx(m.doc), m.ref));
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
        reply(post, m, out);
        break;
      }
      case "pickSigs": {
        // výběr hran/ploch prvku nad tělesem PŘED prvkem (`doc` je oříznutý před prvek): znovunalezení podle otisků + otisky nových indexů
        const { bodies } = await buildShape(m.doc, Infinity, { preferActive: true });
        const b = bodies[0]?.shape;
        reply(post, m, b ? stampPicks(m.feature, b) : null);
        break;
      }
      case "planeDef": {
        try {
          reply(post, m, { plane: resolvePlaneDef(refCtx(m.doc), m.def) });
        } catch (e) {
          reply(post, m, { plane: null, error: e instanceof Error ? e.message : String(e) });
        }
        break;
      }
      case "stepSplit": {
        // sestava STEP → díly (každý svůj malý STEP); data dílů si jádro ponechá (klient je už nemusí posílat zpět)
        const t0 = Date.now();
        const split = splitStepAssembly(m.bytes, (done, total) => post({ id: m.id, progress: { phase: "feature", index: done - 1, total, name: m.fileName } }));
        if (!split) {
          reply(post, m, null);
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
        reply(post, m, { ...split, parts }, t);
        break;
      }
      case "asmParts": {
        const out = [];
        const t: Transferable[] = [];
        for (const [i, p] of m.parts.entries()) {
          post({ id: m.id, progress: { phase: "feature", index: (m.offset ?? 0) + i, total: m.total ?? m.parts.length, name: p.source.kind === "file" ? p.source.fileName : p.source.doc.name } });
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
        reply(post, m, out, t, Date.now());
        break;
      }
      case "asmFace": {
        const b = cachedBody(m.key);
        reply(post, m, b ? faceInfo(b, m.index) : null);
        break;
      }
      case "check": {
        // přísný režim: výsledek prvků bez sítě a bez metrik (řetěz mezipaměti stavby – přidaný prvek se počítá sám)
        const r = await buildShape(m.doc, Infinity, { preferActive: true, onProgress: progressTo(m.id) });
        const solid = !!r.body;
        for (const b of r.bodies) if (b.shape !== r.body) b.shape.delete?.();
        r.body?.delete?.();
        reply(post, m, { status: r.status, paramErrors: r.paramErrors, solid });
        break;
      }
      case "topology": {
        // sestavení + inspekce všech ploch a hran v jednom kroku: mezi sestavením a inspekcí nemůže přijít jiné sestavení (jiná záložka)
        const res = await buildDoc(m.doc, { onProgress: progressTo(m.id) });
        const sh = res.body;
        if (!sh || !res.metrics) {
          reply(post, m, null);
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
        reply(post, m, { faces, edges, bbox: res.metrics.bbox, metrics: res.metrics, bodies: res.bodies });
        break;
      }
      case "inspect": {
        const sh = shapeFor(m.src, body, cachedBody);
        if (!sh) throw new Error(tr("Těleso není k dispozici."));
        const info = entityInfo(sh, m.ref, m.density);
        if (m.src.kind === "comp") sh.delete?.();
        reply(post, m, info);
        break;
      }
      case "faceOwner": {
        const res = await buildDoc(m.doc, { onProgress: progressTo(m.id) });
        body?.delete?.();
        body = res.body;
        let steps = cachedSteps(m.doc);
        if (!steps.length) {
          // řetěz mezipaměti dokumentu mezitím vypadl (jiný dokument, výkres) – obnovit ho stavbou (navazuje na uložené stavy)
          (await buildShape(m.doc, Infinity, { preferActive: true })).body?.delete?.();
          steps = cachedSteps(m.doc);
        }
        reply(post, m, body ? faceOwner(body, m.index, m.point, steps, resolveDoc(m.doc).doc.features) : null);
        break;
      }
      case "measureEnt": {
        const sa = shapeFor(m.a.src, body, cachedBody);
        const sb = m.b ? shapeFor(m.b.src, body, cachedBody) : null;
        if (!sa) throw new Error(tr("Těleso není k dispozici."));
        const res = measureEntities(sa, m.a.ref, sb, m.b?.ref ?? null);
        if (m.a.src.kind === "comp") sa.delete?.();
        if (sb && m.b?.src.kind === "comp") sb.delete?.();
        reply(post, m, res);
        break;
      }
      case "measure": {
        // příkaz „měřit“ / window.mncad.measure: díl se postaví (z mezipaměti) a změří atomicky – čísla F/E/V jako popisky pro výběr
        if (m.doc) {
          const res = await buildDoc(m.doc, { onProgress: progressTo(m.id) });
          body?.delete?.();
          body = res.body;
        }
        for (const s of m.sources ?? []) if (!cachedBody(s.key)) await partEntry(s.key, s.source);
        const made: r.Shape3D[] = [];
        const get = (src: ShapeSrc) => {
          const s = shapeFor(src, body, cachedBody);
          if (s && src.kind === "comp") made.push(s);
          return s;
        };
        try {
          reply(post, m, measureQuery(get, m.q, m.density));
        } finally {
          for (const s of made) s.delete?.();
        }
        break;
      }
      case "surfA": {
        if (m.doc) {
          const res = await buildDoc(m.doc, { onProgress: progressTo(m.id) });
          body?.delete?.();
          body = res.body;
        }
        reply(post, m, surfQuery(body, m.q));
        break;
      }
      case "interference":
        reply(post, m, await interference(m.doc));
        break;
      case "asmEnvelope":
        reply(post, m, await asmEnvelope(m.doc));
        break;
      case "clashDetail":
        reply(post, m, await clashDetail(m.doc, m.pairs));
        break;
      case "compare": {
        // porovnání s referenčním modelem: těleso dokumentu (z mezipaměti stavby) proti souboru STEP / BREP / STL;
        // sestava = složené těleso viditelných komponent (jako export STEP sestavy)
        const model = m.doc.kind === "assembly" ? await shapeOfDoc(m.doc) : (await buildDoc(m.doc, { onProgress: progressTo(m.id) })).body;
        if (!model) throw new Error(tr("Model je prázdný."));
        try {
          const out = await compareWithReference(model, m.file, m.opts, (s) => post({ id: m.id, progress: { index: s.index, total: s.total, name: s.name, phase: "feature" } }));
          reply(post, m, out, compareTransferables(out));
        } finally {
          model.delete?.();
        }
        break;
      }
      case "mateFace":
        reply(post, m, mateFaceInfo(m.key, m.index));
        break;
      case "mateEnt":
        // hrana / vrchol / jemná síť plochy pro pokročilé vazby sestavy (Dráha, Shodně, Vačka)
        reply(post, m, m.ent === "edge" ? mateEdgeInfo(m.key, m.index) : m.ent === "vertex" ? mateVertexInfo(m.key, m.index) : mateFaceMesh(m.key, m.index));
        break;
      case "cylFace":
        reply(post, m, findCylFace(m.key, m.radius));
        break;
      case "export": {
        const b = await shapeOfDoc(m.doc);
        if (!b) throw new Error(tr("Model je prázdný."));
        const buf = await exportShape(b, m.format, m.doc.name);
        reply(post, m, buf, [buf]);
        break;
      }
      case "exportStats":
        reply(post, m, await exportStats(m.doc, m.bytes, m.format));
        break;
      case "drawing": {
        // těleso se přestaví jen při změně geometrie (razítko, název, materiál, poznámky těleso nemění – ty jsou rychlé)
        // závity se kreslí zjednodušeně (kružnice + označení) – modelované šroubovice se pro výkres potlačí (jejich přesná projekce trvá minuty);
        // pružiny zjednodušeně podle ISO 2162-1 (obal vinutí + osy drátu), volba listu „pružiny plně“ kreslí šroubovici
        const springs = m.opts?.springs === "full" ? "full" : "simple";
        const dd = drawingDoc(m.doc, springs);
        // další modely na listu (komponenty sestavy, vložené dokumenty) – vlastní tělesa z mezipaměti
        const extra = await drawingModelShapes(m.doc, m.opts?.models, springs);
        // tělesa posledních listů v mezipaměti (export všech listů sestavy a dílů nestaví ani nepromítá sestavu znovu)
        const body = await drawingBody(dd, shapeOfDoc);
        if (!body) throw new Error(tr("Model je prázdný."));
        // Chytré kóty: list bez zapečených kót (s místem navíc) + plán kót podle prvků jako upravitelné poznámky (cad/drawing-dims.ts)
        const smart = m.opts?.dimensions === "smart" && dd.kind !== "assembly";
        // poznámky k plechu (křížový zlom) do patičky – z dokumentu, pokud je volající nedodal
        let meta: DrawingMeta = m.meta.formNotes ? m.meta : { ...m.meta, formNotes: formNotesOfDoc(m.doc) };
        // značky svarů ISO 2553 z 3D svarů (stav prvků po stavbě – mezipaměť stavby) – drawing-welds.ts
        if (!meta.welds && hasWelds(dd)) meta = { ...meta, welds: weldMarksOf(dd, (await buildShape(dd)).status) };
        // tabulka údajů pružin (EN ISO 2162-2) z prvků spring.* – drawing-springtable.ts; z dokumentu, ne z kopie pro výkres
        // (tam je tlačná pružina z tabulky nahrazená obalem vinutí ISO 2162-1)
        if (m.opts?.springTable && !meta.springData) meta = { ...meta, springData: springDrawTables(m.doc) };
        // osy drátu zjednodušených pružin (poloha odkazem je známá ze stavby výše)
        if (!meta.springs && springs === "simple") {
          const marks = springMarksOf(dd);
          if (marks.length) meta = { ...meta, springs: marks };
        }
        // Chytré kóty čtou skutečný tvar dílu – obal zjednodušené pružiny by kótovaly jako díru (drawing-models.ts)
        const geom = smart ? await realPartGeom(m.doc, springs, shapeOfDoc) : undefined;
        reply(post, m, smart ? makeSmartDrawing(body, m.doc, meta, m.opts, extra, geom) : makeDrawing(body, meta, m.opts, extra));
        break;
      }
      default: {
        // každá operace protokolu má obsluhu (kontrola překladačem); neznámá operace zůstane bez odpovědi jako dřív ve workeru
        const none: never = m;
        void none;
      }
    }
  } catch (err) {
    // pád WASM (nedostatek paměti, abort, přístup mimo paměť): jádro je nepoužitelné – klient ho ukončí a spustí nové
    if (isFatalKernelError(err)) {
      fatal = err instanceof Error ? err.message : String(err);
      return post({ id: m.id, ok: false, error: fatal, fatal: true });
    }
    post({ id: m.id, ok: false, error: err instanceof Error ? err.message : tr("Chyba CAD jádra.") });
  }
}

/** kopie sítě – originál zůstává v mezipaměti jádra, kopie se předá (transfer) klientovi */
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
