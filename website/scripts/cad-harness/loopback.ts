// Loopback kernel for the acceptance harness (same technique as the w14 probes P2/P7/P11): the UNCHANGED web worker
// src/cad/cad.worker.ts runs in plain Node behind a fake `self`, and a minimal op loop applies parsed text commands to
// documents held in "tabs". It does not depend on the future headless engine (src/cad/engine/*); it only replays what
// cad-app.tsx runAgentText does for the op kinds the synthetic tool uses. Everything else is reported as an error line.
// Bundled by bundle.mjs and driven by synth-tool.mjs, bench-motion.mjs and bench-strict.mjs.
import "./loopback-self";
import "@/cad/cad.worker";
import fs from "node:fs";
import path from "node:path";
import * as r from "replicad";
import { parseAgentText, selectEdges, selectFaces, docStatusText, type AgentOp } from "@/cad/agent";
import { applyAsmCmd, compFaces, ensureBuilt, type AsmEnv, type PartFaces } from "@/cad/asm-agent";
import type { TabInfo } from "@/cad/agent-asm";
import { applySketchOp } from "@/cad/agent-sketch";
import { applyDrawingCmd, type DrawingExtras } from "@/cad/drawing-agent";
import { emptyAssembly, partComponent, sourceKey, computeBom, flattenAssembly } from "@/cad/assembly";
import { emptyDoc, uid, type AsmComponent, type BuildResult, type CadDoc, type Feature } from "@/cad/types";
import { freeName } from "@/cad/agent-edit";
import { makeFromText } from "@/cad/library";
import { buildShape, registerTextFont } from "@/cad/build";
import { motionCached } from "@/cad/asm-agent-kin";
import { MATERIALS, massKg } from "@/lib/mesh-metrics";
import type { PartFace } from "@/cad/mates";
import { listeners } from "./loopback-self";

type Msg = { id: number; ok?: boolean; result?: unknown; error?: string; progress?: unknown; perf?: unknown };
let seq = 0;
const pending = new Map<number, { res: (v: unknown) => void; rej: (e: Error) => void }>();
listeners.add((m: Msg) => {
  if (m.perf || m.progress) return;
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  if (m.ok) p.res(m.result);
  else p.rej(new Error(m.error));
});
const self = (globalThis as unknown as { self: { onmessage: (e: { data: unknown }) => Promise<void> } }).self;
function call<T>(msg: Record<string, unknown>): Promise<T> {
  const id = ++seq;
  return new Promise<T>((res, rej) => {
    pending.set(id, { res: res as (v: unknown) => void, rej });
    void self.onmessage({ data: { id, ...msg } });
  });
}

export type Clash = { a: string; b: string; volume: number };
/** kernel calls (same message protocol as client.ts) */
export const kernel = {
  build: (doc: CadDoc) => call<BuildResult>({ op: "build", doc }),
  topology: (doc: CadDoc) => call<{ faces: never[]; edges: never[]; bbox: never } | null>({ op: "topology", doc }),
  asmParts: (parts: { key: string; source: AsmComponent["source"] }[]) => call<{ key: string; result: BuildResult }[]>({ op: "asmParts", parts }),
  mateFace: (key: string, index: number) => call<PartFace | null>({ op: "mateFace", key, index }),
  mateEnt: (key: string, index: number, ent: "edge" | "vertex" | "mesh") => call<PartFace | null>({ op: "mateEnt", key, index, ent }),
  cylFace: (key: string, radius: number) => call<number>({ op: "cylFace", key, radius }),
  interference: (doc: CadDoc) => call<Clash[]>({ op: "interference", doc }),
  drawing: (doc: CadDoc, meta: unknown, opts: unknown) => call<never>({ op: "drawing", doc, meta, opts }),
};

/**
 * OCCT WASM heap in MB – the memory V8 resourceLimits do not see. replicad-opencascadejs 1.x does not export HEAPU8 on
 * the module object, only `wasmMemory` (measured: HEAPU8 undefined, wasmMemory.buffer 100 MB after init).
 */
export function heapMB(): number {
  try {
    const oc = r.getOC() as unknown as { HEAPU8?: Uint8Array; wasmMemory?: { buffer: ArrayBuffer } };
    const bytes = oc?.HEAPU8?.length ?? oc?.wasmMemory?.buffer.byteLength ?? 0;
    return bytes / 1048576;
  } catch {
    return 0;
  }
}
export const rssMB = () => process.memoryUsage().rss / 1048576;

let inited: Promise<number> | null = null;
/** OCCT init in the loopback worker + the text font (build.ts would fetch /fonts/Roboto-Bold.ttf from `location`) */
export function init(web: string): Promise<number> {
  if (!inited)
    inited = (async () => {
      const t0 = Date.now();
      await call({ op: "init" });
      const ttf = fs.readFileSync(path.join(web, "public", "fonts", "Roboto-Bold.ttf"));
      await registerTextFont(ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength) as ArrayBuffer);
      return Date.now() - t0;
    })();
  return inited;
}

export type LogLine = { line: number; text: string };
export type OpTiming = { line: number; op: string; ms: number; rssMB: number; heapMB: number };
export type InterferenceCall = { ms: number; pairs: number; rssMB: number; heapMB: number };
export type RunOptions = {
  /** strict-mode simulation (design 5.3): build the part after every geometry op, evaluate drawing sheets per block */
  strict?: boolean;
  /**
   * how strict mode builds after a geometry op: "full" = the worker's `build` (status + mesh + metrics, what the app and
   * probe P11 do), "shape" = buildShape only (per-feature status ✓/⚠/✗ and validity signature, no tessellation)
   */
  strictBuild?: "full" | "shape";
  /** evaluate all drawing sheets once at the end of the run (what an export of all sheets costs) */
  drawingsAtEnd?: boolean;
  /** skip `pohyb …` (motion) ops – bench-strict default, bench-motion runs them separately */
  skipMotion?: boolean;
  /** skip `výkres …` / `kótovat` ops (sheets with helical springs take minutes of hidden-line projection) */
  skipDrawings?: boolean;
  /** called after every op (bench progress / memory guard) */
  onOp?: (t: OpTiming) => void;
};
/**
 * `warnings` = lines a strict run of the engine would stop on, by op kind: ⚠ / `!` lines, and the face-rule notes
 * "(vybrána F2 z 5 vyhovujících)" that design 5.2 row 13 turns into ⚠ select.ambiguous (counted as "select.ambiguous").
 * The static screw × thread clashes become ℹ clash.thread there, so the loopback's own clash line is not counted.
 * `warnLines` = those lines (line 0 = sheet evaluation at the end of the run).
 */
export type RunResult = { log: LogLine[]; errors: number; warnings: Record<string, number>; warnLines: LogLine[]; timing: OpTiming[]; ms: number };
/** a mate face picked by a rule among several matching faces (agent-asm.ts pickFace note) */
export const AMBIGUOUS_PICK = /\bz \d+ vyhovujících\b/;

const GEOMETRY_OPS = new Set(["feature", "features", "select", "entities", "constraints", "dims"]);
const opName = (op: AgentOp) => {
  if (op.k === "asm") {
    const c = op.cmd as { k: string; kind?: string; cmd?: { op?: string } };
    return `asm:${c.k}${c.kind ? ":" + c.kind : ""}${c.cmd?.op ? ":" + c.cmd.op : ""}`;
  }
  if (op.k === "drawingCmd") return `drawing:${(op.cmd as { k: string }).k}`;
  return op.k;
};

/** One loopback session: documents in tabs plus the assembly caches the app keeps in React refs. */
export class Session {
  tabs: { id: string; doc: CadDoc }[] = [];
  active = "";
  asmCache = new Map<string, BuildResult>();
  geo = new Map<string, PartFace>();
  faceLists = new Map<string, PartFaces>();
  mateStatus = new Map<string, Record<string, unknown>>();
  interferenceCalls: InterferenceCall[] = [];
  clash: Clash[] | null = null;
  private seq = 0;

  env(): AsmEnv {
    return {
      parts: async (list) => {
        const need = list.filter((p) => !this.asmCache.has(p.key));
        if (need.length) for (const x of await kernel.asmParts(need)) this.asmCache.set(x.key, x.result);
        return list.map((p) => ({ key: p.key, result: this.asmCache.get(p.key) ?? null }));
      },
      mateFace: kernel.mateFace,
      mateEnt: kernel.mateEnt,
      cylFace: kernel.cylFace,
      interference: async (d) => {
        const t = Date.now();
        const res = await kernel.interference(d);
        this.interferenceCalls.push({ ms: Date.now() - t, pairs: res.length, rssMB: rssMB(), heapMB: heapMB() });
        return res;
      },
      geo: this.geo as never,
      faceLists: this.faceLists,
      stack: [],
      tabs: {
        list: (): TabInfo[] => this.tabs.map((t) => ({ id: t.id, title: t.doc.name, kind: t.doc.kind === "assembly" ? "assembly" : "part", active: t.id === this.active })),
        activate: async (id) => {
          this.active = id;
          return this.tabs.find((t) => t.id === id)!.doc;
        },
        close: async (id) => {
          this.tabs.splice(
            this.tabs.findIndex((t) => t.id === id),
            1,
          );
          this.active = this.tabs[this.tabs.length - 1]?.id ?? "";
          return this.tabs.find((t) => t.id === this.active)?.doc ?? emptyDoc("Nový díl");
        },
      },
    };
  }

  doc(name: string): CadDoc | null {
    const key = name.toLowerCase();
    return this.tabs.find((t) => t.doc.name.toLowerCase() === key)?.doc ?? null;
  }
  assembly(): CadDoc | null {
    return [...this.tabs].reverse().find((t) => t.doc.kind === "assembly")?.doc ?? null;
  }
  private partInfo = (c: AsmComponent) => {
    const res = this.asmCache.get(sourceKey(c.source));
    const mt = MATERIALS.find((x) => x.id === (c.source.kind === "part" ? c.source.doc.material : "ocel")) ?? MATERIALS[0];
    return { material: mt.label, massKg: res?.metrics ? massKg(res.metrics.volume, mt.density) : undefined };
  };
  extras(d: CadDoc): DrawingExtras {
    if (d.kind !== "assembly") return {};
    const bom = computeBom(d, this.partInfo);
    return { bom: bom.map((x) => ({ pos: x.pos, name: x.name, number: x.number, qty: x.qty, material: x.material, massKg: x.massKg })), massKg: bom.reduce((s, x) => s + (x.massKg ?? 0) * x.qty, 0) };
  }

  /** run text commands like the console does; documents persist in the session between runs */
  async run(text: string, o: RunOptions = {}): Promise<RunResult> {
    const T0 = Date.now();
    const prog = parseAgentText(text);
    const log: LogLine[] = prog.errors.map((e) => ({ line: e.line, text: `✗ ${e.message}${e.text ? ` ← „${e.text}“` : ""}` }));
    let errors = prog.errors.length;
    const timing: OpTiming[] = [];
    let d: CadDoc = this.tabs.find((t) => t.id === this.active)?.doc ?? emptyDoc("Nový díl");
    const commit = () => {
      const t = this.tabs.find((x) => x.id === this.active);
      if (t) t.doc = d;
    };
    const newTab = (doc: CadDoc) => {
      commit();
      d = doc;
      const id = `t${++this.seq}`;
      this.tabs.push({ id, doc: d });
      this.active = id;
    };
    const SOLID = new Set(["extrude", "revolve", "box", "cylinder", "sphere", "cone", "tube", "import", "sweep", "loft", "spring", "thicken", "text", "ext"]);
    const hasSolid = () => d.features.some((f) => SOLID.has(f.type) && !f.suppressed);
    const lastSketch = () => [...d.features].reverse().find((f) => f.type === "sketch");
    const prepare = (f0: Feature): Feature => {
      const f = { ...f0, name: freeName(d.features, f0) } as Feature & { sketchId?: string; mode?: string };
      if (f.sketchId === "$last") {
        const sk = lastSketch();
        if (!sk) throw new Error("no sketch for $last");
        f.sketchId = sk.id;
      }
      if (f.mode === "$auto" || (f.mode === "add" && !hasSolid())) f.mode = hasSolid() ? "add" : "new";
      if (d.features.some((x) => x.id === f.id)) f.id = uid();
      return f as Feature;
    };
    const compute = (doc: CadDoc, meta: unknown, opts: unknown) => kernel.drawing(doc, meta, opts);
    const drawStatus = parseAgentText("výkres stav").ops[0];
    const drawStatusAll = parseAgentText("výkres stav vše").ops[0];
    const warnings: Record<string, number> = {};
    const warnLines: LogLine[] = [];
    const evalSheets = async (all: boolean) => {
      if (!d.drawings?.length) return;
      const op = all ? drawStatusAll : drawStatus;
      if (op?.k !== "drawingCmd") return;
      const res = await applyDrawingCmd(d, op.cmd, compute as never, { extras: () => this.extras(d) });
      for (const l of res.log)
        if (/^[⚠!✗]/.test(l)) {
          log.push({ line: 0, text: l });
          if (!l.startsWith("✗")) {
            warnings["drawing:eval"] = (warnings["drawing:eval"] ?? 0) + 1;
            warnLines.push({ line: 0, text: l });
          }
        }
    };
    const ops = prog.ops as AgentOp[];
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      const push = (s: string) => {
        log.push({ line: op.line, text: s });
        const kind = /^[⚠!]/.test(s) && op.k !== "clash" ? opName(op) : AMBIGUOUS_PICK.test(s) ? "select.ambiguous" : null;
        if (kind) {
          warnings[kind] = (warnings[kind] ?? 0) + 1;
          warnLines.push({ line: op.line, text: s });
        }
      };
      const t0 = Date.now();
      try {
        switch (op.k) {
          case "new":
            newTab(op.assembly ? emptyAssembly(op.name) : emptyDoc(op.name));
            push(`✓ new ${op.assembly ? "assembly" : "part"} "${op.name}"`);
            break;
          case "meta":
            d = { ...d, ...op.patch };
            break;
          case "features":
            d = { ...d, features: [...d.features, ...op.features.map(prepare)] };
            break;
          case "feature": {
            if (op.fillTop) throw new Error("loopback: give the z coordinate (surface lookup needs the app)");
            d = { ...d, features: [...d.features, prepare(op.feature)] };
            break;
          }
          case "entities":
          case "constraints":
          case "dims": {
            const feats = [...d.features];
            for (const l of applySketchOp(feats, op, null)) if (l.startsWith("✗")) push(l);
            d = { ...d, features: feats };
            break;
          }
          case "select": {
            const f = prepare(op.feature) as Feature & { edges?: unknown; faces?: unknown };
            const t = await kernel.topology(d);
            if (!t) throw new Error("no solid for the edge/face rule");
            const idx = f.type === "shell" ? selectFaces(op.rule, t.faces, t.bbox) : selectEdges(op.rule, t.edges, t.bbox);
            if (!idx.length) throw new Error(`no entity matches the rule "${op.rule.join(" ")}"`);
            if (f.type === "shell") f.faces = idx;
            else f.edges = idx;
            d = { ...d, features: [...d.features, f as Feature] };
            break;
          }
          case "library": {
            const made = makeFromText(op.query);
            if (!made) throw new Error(`library does not know "${op.query}"`);
            if (d.kind === "assembly") d = { ...d, components: [...(d.components ?? []), partComponent(made.doc, { position: op.at ?? [0, 0, 0] }, { group: "Normálie", number: made.doc.props?.number })] };
            else newTab(made.doc);
            push(`✓ library "${made.doc.name}"`);
            break;
          }
          case "insert": {
            if (d.kind !== "assembly") throw new Error("vložit: the open document is not an assembly");
            commit();
            const key = op.tab.toLowerCase();
            const src = this.tabs.find((t) => t.doc.kind !== "assembly" && t.doc.name.toLowerCase() === key)?.doc;
            if (!src) throw new Error(`part "${op.tab}" is not among the tabs`);
            d = { ...d, components: [...(d.components ?? []), partComponent(JSON.parse(JSON.stringify(src)) as CadDoc, { position: op.at, rotation: op.rotation }, op.fixed ? { fixed: true } : {})] };
            break;
          }
          case "asm": {
            const c = op.cmd as { k: string };
            if (o.skipMotion && c.k === "motion") {
              push("ℹ motion skipped");
              break;
            }
            commit();
            const res = await applyAsmCmd(d, op.cmd, this.env());
            if (res.newTab) newTab(res.doc);
            else if (res.switched) d = res.doc;
            else d = res.doc;
            if (res.mateStatus) this.mateStatus.set(d.name, res.mateStatus as Record<string, unknown>);
            for (const l of res.log) push(l);
            break;
          }
          case "clash": {
            if (d.kind !== "assembly") throw new Error("kolize: not an assembly");
            this.clash = await this.env().interference!(d);
            push(this.clash.length ? `⚠ clashes ${this.clash.length}` : "✓ clashes 0");
            break;
          }
          case "drawingCmd": {
            if (o.skipDrawings) {
              push("ℹ drawing skipped");
              break;
            }
            const cmd = op.cmd as { k: string; op?: string };
            // strict: a sheet switch closes the block of the previous sheet
            if (o.strict && cmd.k === "sheet" && cmd.op !== "rename" && cmd.op !== "delete") await evalSheets(false);
            const res = await applyDrawingCmd(d, op.cmd, compute as never, { extras: () => this.extras(d), tabs: () => this.tabs.map((t) => ({ title: t.doc.name, doc: t.doc })) });
            d = res.doc;
            for (const l of res.log) push(l);
            const next = ops[i + 1];
            if (o.strict && next?.k !== "drawingCmd") await evalSheets(false);
            break;
          }
          case "status": {
            const res = await kernel.build(d).catch(() => null);
            push(docStatusText(d, res));
            break;
          }
          case "measure":
            push("ℹ measure skipped in the loopback (needs the engine)");
            break;
          case "drawing":
            push("ℹ drawing tab (no UI)");
            break;
          default:
            throw new Error(`loopback does not run op "${op.k}"`);
        }
        if (o.strict && GEOMETRY_OPS.has(op.k) && d.kind !== "assembly") {
          const res = o.strictBuild === "shape" ? await buildShape(d) : await kernel.build(d);
          const bad = res.status.find((s) => s.ok === false);
          if (bad) push(`✗ build: ${bad.error}`);
          const last = d.features[d.features.length - 1];
          const warn = res.status.find((s) => s.id === last?.id && s.warning);
          if (warn) push(`⚠ build: ${last.name}: ${warn.warning}`);
        }
      } catch (e) {
        push(`✗ ${(e as Error).message}`);
      }
      const t: OpTiming = { line: op.line, op: opName(op), ms: Date.now() - t0, rssMB: rssMB(), heapMB: heapMB() };
      timing.push(t);
      o.onOp?.(t);
    }
    commit();
    if (o.drawingsAtEnd) {
      for (const t of this.tabs) {
        if (!t.doc.drawings?.length) continue;
        d = t.doc;
        await evalSheets(true);
      }
    }
    errors += log.filter((l) => l.text.startsWith("✗")).length - prog.errors.length;
    return { log, errors, warnings, warnLines, timing, ms: Date.now() - T0 };
  }

  /** faces of one top-level component in assembly coordinates (what `sestava plochy` prints) */
  async compFaces(asm: CadDoc, compId: string) {
    return compFaces(asm, compId, this.env());
  }
  /** build all leaves of the assembly (Σ needs them) */
  async ensureLeaves(asm: CadDoc) {
    await ensureBuilt(this.env(), flattenAssembly(asm));
  }
  /** volume of every part (kernel metrics of the assembly cache) by part key */
  partVolume(c: AsmComponent): number | null {
    return this.asmCache.get(sourceKey(c.source))?.metrics?.volume ?? null;
  }
  motion(asm: CadDoc) {
    return motionCached(asm);
  }
}
