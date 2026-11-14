/**
 * Pomocník pro testy Chytrých kót (vitest s OpenCascade): textové příkazy → dokument (jako konzole, včetně výběru hran
 * pravidlem a díry „v x y“ na povrchu) → těleso → výkres → plán kót. Jen pro testy (nepoužívá ho aplikace).
 */
import { parseAgentText, selectEdges, selectFaces, topAt, type EdgeLite, type FaceLite } from "./agent";
import { applySketchOp } from "./agent-sketch";
import { buildDoc } from "./build";
import { drawingDoc, threadsOfDoc } from "./drawing-doc";
import { makeDrawing, type DrawingMeta, type DrawingOptions } from "./drawing";
import { makeSmartDrawing } from "./drawing-dims";
import { applyDrawingCmd } from "./drawing-agent";
import { entityInfo } from "./inspect";
import { emptyDoc, uid, type CadDoc, type Feature } from "./types";

const SOLID = new Set(["extrude", "revolve", "box", "cylinder", "sphere", "cone", "tube", "sweep", "loft", "thicken", "ext"]);

/** Textové příkazy → dokument (bez prohlížeče). */
export async function docFromText(text: string): Promise<CadDoc> {
  return (await runText(text)).doc;
}

/** Textové příkazy včetně příkazů výkresu (výkres …, kótovat, výkres stav) → dokument + protokol příkazů výkresu. */
export async function runText(text: string): Promise<{ doc: CadDoc; log: string[] }> {
  const log: string[] = [];
  const prog = parseAgentText(text);
  if (prog.errors.length) throw new Error(prog.errors.map((e) => `${e.line}: ${e.message}`).join("; "));
  let d: CadDoc = emptyDoc("Test");
  const lastSketch = () => [...d.features].reverse().find((f) => f.type === "sketch") as Extract<Feature, { type: "sketch" }> | undefined;
  const prepare = (f0: Feature): Feature => {
    const f = { ...f0 } as Feature & { sketchId?: string; featureId?: string; mode?: string };
    if (f.sketchId === "$last") f.sketchId = lastSketch()!.id;
    if (f.featureId === "$last") f.featureId = d.features[d.features.length - 1].id;
    const hasSolid = d.features.some((x) => SOLID.has(x.type));
    if (f.mode === "$auto" || (f.mode === "add" && !hasSolid)) f.mode = hasSolid ? "add" : "new";
    if (!f.id) f.id = uid();
    return f as Feature;
  };
  for (const op of prog.ops) {
    if (op.k === "new") d = emptyDoc(op.name);
    else if (op.k === "meta") d = { ...d, ...op.patch };
    else if (op.k === "entities") applySketchOp(d.features, op); // jako konzole: id e1…, uzavření lomených čar podle celé skici
    else if (op.k === "feature") {
      const f = prepare(op.feature);
      if (op.fillTop && f.type === "hole") {
        const r = await buildDoc(d);
        const ai = f.axis === "X" ? 0 : f.axis === "Y" ? 1 : 2;
        const [u, v] = f.axis === "X" ? [f.position[1], f.position[2]] : f.axis === "Y" ? [f.position[0], f.position[2]] : [f.position[0], f.position[1]];
        f.position[ai] = topAt(r.mesh, f.axis, u, v) ?? r.metrics!.bbox[1][ai];
      }
      d.features.push(f);
    } else if (op.k === "select") {
      const f = prepare(op.feature);
      const res = await buildDoc(d);
      const sh = res.body!;
      const edges: EdgeLite[] = [];
      for (let i = 0; i < res.metrics!.edges; i++) {
        const info = entityInfo(sh, { kind: "edge", index: i });
        edges.push({ index: i, curve: info.curve ?? info.title, dir: info.dir, center: info.center ?? info.mid ?? info.point, radius: info.radius, length: info.length });
      }
      const faces: FaceLite[] = [];
      for (let i = 0; i < res.metrics!.faces; i++) {
        const info = entityInfo(sh, { kind: "face", index: i });
        faces.push({ index: i, planar: info.surface === "PLANE", normal: info.normal, center: info.center, area: info.area, surface: info.surface });
      }
      if (f.type === "fillet" || f.type === "chamfer") f.edges = selectEdges(op.rule, edges, res.metrics!.bbox);
      else if (f.type === "shell") f.faces = selectFaces(op.rule, faces, res.metrics!.bbox);
      d.features.push(f);
    } else if (op.k === "drawingCmd") {
      const r = await applyDrawingCmd(d, op.cmd, computeDrawing);
      d = r.doc;
      log.push(...r.log);
    } else if (op.k === "drawing" || op.k === "status") continue;
    else throw new Error(`harness: operace ${op.k} není podporovaná`);
  }
  return { doc: d, log };
}

/** Dokument → výkres (bez zapečených kót, s místem pro kóty) + Chytré kóty – stejně jako jádro (worker). */
export async function smartDrawing(doc: CadDoc, opts: Partial<DrawingOptions> = {}) {
  const dd = drawingDoc(doc);
  const res = await buildDoc(dd);
  if (!res.body) throw new Error("model je prázdný");
  const meta = { name: doc.name, material: "", threads: threadsOfDoc(doc) };
  const d = makeSmartDrawing(res.body, doc, meta, { ...opts, dimensions: "smart" });
  return { doc, drawing: d, smart: d.smart, bbox: res.metrics!.bbox };
}

/** Výpočet výkresu jako jádro (worker, op „drawing“) – pro testy příkazů výkresu a jeho stavu. */
export async function computeDrawing(doc: CadDoc, meta: DrawingMeta, opts: Partial<DrawingOptions>) {
  const res = await buildDoc(drawingDoc(doc));
  if (!res.body) throw new Error("model je prázdný");
  return opts.dimensions === "smart" ? makeSmartDrawing(res.body, doc, meta, opts) : makeDrawing(res.body, meta, opts);
}
