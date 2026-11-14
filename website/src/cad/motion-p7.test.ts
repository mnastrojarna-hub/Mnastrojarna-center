/**
 * P7 jako test (vlna 14, balík A3 motion-clash): střižný nástroj ze sondy návrhu – 57 komponent (desky se sraženými hranami, závitové
 * díry, šrouby ISO 4762 se závitem, sloupky, kolíky, střižníky, pružiny), 61 vazeb (zámky, souososti, Vzdálenost jako motor, dvě
 * Meze vzdálenosti), lineární motor 175 → 115 mm ve 40 krocích bez kolizí a s kolizemi.
 *
 * Kontrakt A3: výsledky přírůstkové kontroly kolizí = plná kontrola (stejná funkce bez mezipaměti dvojic) v každém kroku,
 * `pohyb … kroky 40 kolize` ≤ 45 s a ≤ 1,5 GB, vedené desky jen podél osy (dřív drift 808 mm), ⚠ motion.conflict s kroky.
 * Čas se měří jako procesorový čas vlákna jádra (process.cpuUsage – výpočet je jednovláknový, sdílený stroj ho nezkreslí; zdi se
 * vypisují); paměť = špička RSS procesu testu (VmHWM) a růst haldy WASM během pohybu.
 *
 * Běží přes NEZMĚNĚNÝ cad.worker.ts ve stejném vlákně (falešný `self`, jako sondy návrhu a A4), proto stejné operace jádra
 * (topologie pro `srazit`, stavba dílů, plochy vazeb, kolize) jako v aplikaci. Plná kontrola všech 41 kroků trvá ~110 s – v běžné
 * sadě se kontrolují kroky, ve kterých se mění sada kolizí, plus krajní a dva kroky beze změny; `P7_FULL=1` = všech 41 kroků.
 */
import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import { parseAgentText, selectEdges, selectFaces, type AgentOp } from "./agent";
import { freeName } from "./agent-edit";
import { applyAsmCmd, compFaces, type AsmEnv, type PartFaces } from "./asm-agent";
import { motionCached } from "./asm-agent-kin";
import { emptyAssembly, partComponent } from "./assembly";
import { clearInterferenceCache, interference } from "./asm-kernel";
import { makeFromText } from "./library";
import type { PartFace } from "./mates";
import { motionIssues, motionSummary, poseDoc, type MotionResult } from "./motion";
import { emptyDoc, type AsmComponent, type BuildResult, type CadDoc, type Feature } from "./types";

const FULL = !!process.env.P7_FULL;

/* ───── nezměněný worker jádra ve stejném vlákně: falešný DedicatedWorkerGlobalScope ───── */
type Msg = { id: number; ok?: boolean; result?: unknown; error?: string; progress?: unknown; perf?: unknown };
const pending = new Map<number, { res: (v: unknown) => void; rej: (e: Error) => void }>();
let seq = 0;
let post: (data: unknown) => Promise<void>;
function call<T>(msg: Record<string, unknown>): Promise<T> {
  const id = ++seq;
  return new Promise<T>((res, rej) => {
    pending.set(id, { res: res as (v: unknown) => void, rej });
    void post({ id, ...msg });
  });
}
const kernel = {
  topology: (doc: CadDoc) => call<{ faces: never[]; edges: never[]; bbox: never } | null>({ op: "topology", doc }),
  asmParts: (parts: { key: string; source: AsmComponent["source"] }[]) => call<{ key: string; result: BuildResult }[]>({ op: "asmParts", parts }),
  mateFace: (key: string, index: number) => call<PartFace | null>({ op: "mateFace", key, index }),
  mateEnt: (key: string, index: number, ent: "edge" | "vertex" | "mesh") => call<PartFace | null>({ op: "mateEnt", key, index, ent }),
  cylFace: (key: string, radius: number) => call<number>({ op: "cylFace", key, radius }),
  interference: (doc: CadDoc) => call<{ a: string; b: string; volume: number }[]>({ op: "interference", doc }),
};
const heapMB = () => {
  const o = r.getOC() as unknown as { HEAPU8?: Uint8Array; wasmMemory?: { buffer: ArrayBuffer } };
  return (o.HEAPU8?.length ?? o.wasmMemory!.buffer.byteLength) / 1048576;
};
const peakRssMB = () => {
  try {
    return Number(/VmHWM:\s+(\d+)/.exec(fs.readFileSync("/proc/self/status", "utf8"))![1]) / 1024;
  } catch {
    return process.memoryUsage().rss / 1048576;
  }
};

beforeAll(async () => {
  const g = globalThis as unknown as { self?: { postMessage: (m: Msg) => void; onmessage?: (e: { data: unknown }) => Promise<void> } };
  g.self = {
    postMessage: (m: Msg) => {
      if (m.perf || m.progress) return;
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.res(m.result);
      else p.rej(new Error(m.error));
    },
  };
  await import("./cad.worker");
  post = (data) => g.self!.onmessage!({ data });
  await call({ op: "init" });
}, 120_000);

/* ───── běh textových příkazů (jen druhy, které P7 používá) ───── */
type Tab = { doc: CadDoc };
const tabs: Tab[] = [];
let active = -1;
const asmCache = new Map<string, BuildResult>();
const env = (): AsmEnv => ({
  parts: async (list) => {
    const need = list.filter((p) => !asmCache.has(p.key));
    if (need.length) for (const x of await kernel.asmParts(need)) asmCache.set(x.key, x.result);
    return list.map((p) => ({ key: p.key, result: asmCache.get(p.key) ?? null }));
  },
  mateFace: kernel.mateFace,
  mateEnt: kernel.mateEnt,
  cylFace: kernel.cylFace,
  interference: kernel.interference,
  geo: new Map<string, PartFace>(),
  faceLists: new Map<string, PartFaces>(),
  stack: [],
});
let ENV: AsmEnv;
const log: string[] = [];
async function run(text: string): Promise<void> {
  const prog = parseAgentText(text);
  expect(prog.errors, text.slice(0, 200)).toEqual([]);
  let d: CadDoc = tabs[active]?.doc ?? emptyDoc("Nový díl");
  const commit = () => {
    if (tabs[active]) tabs[active].doc = d;
  };
  const newTab = (doc: CadDoc) => {
    commit();
    d = doc;
    tabs.push({ doc });
    active = tabs.length - 1;
  };
  for (const op of prog.ops as AgentOp[]) {
    switch (op.k) {
      case "new":
        newTab(op.assembly ? emptyAssembly(op.name) : emptyDoc(op.name));
        break;
      case "feature": {
        const f = { ...op.feature, name: freeName(d.features, op.feature) } as Feature & { mode?: string };
        if (f.mode === "$auto") f.mode = d.features.some((x) => ["box", "cylinder", "extrude", "revolve", "tube"].includes(x.type)) ? "add" : "new";
        d = { ...d, features: [...d.features, f as Feature] };
        break;
      }
      case "select": {
        const t = await kernel.topology(d);
        expect(t, `L${op.line}`).not.toBeNull();
        const f = { ...op.feature } as Feature & { edges?: unknown; faces?: unknown };
        if (f.type === "shell") f.faces = selectFaces(op.rule, t!.faces, t!.bbox);
        else f.edges = selectEdges(op.rule, t!.edges, t!.bbox);
        d = { ...d, features: [...d.features, f as Feature] };
        break;
      }
      case "library": {
        const made = makeFromText(op.query);
        expect(made, op.query).toBeTruthy();
        newTab(made!.doc);
        break;
      }
      case "insert": {
        const src = tabs.find((t) => t.doc.kind !== "assembly" && t.doc.name.toLowerCase() === op.tab.toLowerCase())?.doc;
        expect(src, op.tab).toBeTruthy();
        d = { ...d, components: [...(d.components ?? []), partComponent(JSON.parse(JSON.stringify(src)), { position: op.at ?? [0, 0, 0], rotation: op.rotation ?? [0, 0, 0] }, op.fixed ? { fixed: true } : {})] };
        break;
      }
      case "asm": {
        const res = await applyAsmCmd(d, op.cmd, ENV);
        d = res.doc;
        for (const l of res.log) log.push(`L${op.line} ${l}`);
        break;
      }
      default:
        throw new Error(`P7: nečekaný příkaz ${op.k}`);
    }
  }
  commit();
}
const asmDoc = () => tabs.find((t) => t.doc.kind === "assembly")!.doc;

/* ───── P7: geometrie nástroje (shodná se sondou návrhu scratchpad/w14/probe a A3 p7a3) ───── */
const PIL: [number, number][] = [[20, 20], [280, 20], [20, 180], [280, 180]];
const MSCR: [number, number][] = [[70, 55], [110, 55], [150, 55], [190, 55], [230, 55], [70, 145], [110, 145], [150, 145], [190, 145], [230, 145], [60, 100], [240, 100]];
const USCR: [number, number][] = [...Array.from({ length: 8 }, (_, i) => [45 + i * 30, 30] as [number, number]), ...Array.from({ length: 8 }, (_, i) => [45 + i * 30, 170] as [number, number])];
const PUN: [number, number][] = [[100, 85], [150, 85], [200, 85], [100, 115], [150, 115], [200, 115]];
const PINB: [number, number][] = [[40, 100], [260, 100], [150, 30], [150, 170]];
const SPR: [number, number][] = [[60, 70], [240, 70], [60, 130], [240, 130]];
const at = (pts: [number, number][], z: number) => pts.map(([x, y]) => `v ${x} ${y} ${z}`).join(" ");
function p7Lines(): string[] {
  const L: string[] = [];
  L.push("nový díl Spodní deska", "kvádr 300 200 40", `díra 24 skrz ${at(PIL, 40)}`, `díra 8,5 hloubka 25 ${at(MSCR, 40)} závit M10`, `díra 8 hloubka 20 ${at(PINB, 40)}`, "srazit 1");
  L.push("nový díl Matrice", "kvádr 200 120 30", `díra 11 skrz ${at(MSCR.map(([x, y]) => [x - 50, y - 40]), 30)}`, `díra 20,4 skrz ${at(PUN.map(([x, y]) => [x - 50, y - 40]), 30)}`, "srazit 0,5");
  L.push("normálie M10x50", "normálie kolík 8x40", "normálie sloupek 25x160", "nový díl Doraz", "válec 30 60", "srazit 1");
  L.push("nový díl Horní deska", "kvádr 300 200 35", `díra 24,2 skrz ${at(PIL, 35)}`, `díra 11 skrz ${at(USCR, 35)}`, "srazit 1");
  L.push("nový díl Kotevní deska", "kvádr 300 200 25", `díra 24,2 skrz ${at(PIL, 25)}`, `díra 8,5 skrz ${at(USCR, 25)} závit M10`, `díra 20 skrz ${at(PUN, 25)}`, `díra 8 skrz ${at(PINB, 25)}`, "srazit 1");
  L.push("nový díl Stírací deska", "kvádr 300 200 20", `díra 24,4 skrz ${at(PIL, 20)}`, `díra 20,5 skrz ${at(PUN, 20)}`, `díra 21 skrz ${at(SPR, 20)}`, "srazit 1");
  L.push("nový díl Střižník", "válec 20 90", "srazit 0,5");
  L.push("normálie M10x60", "normálie pružina 20x2,5x50");
  L.push("nová sestava Střižný nástroj", 'vložit "Spodní deska" ukotvit', 'vložit "Matrice" v 50 40 40');
  for (const [x, y] of MSCR) L.push(`vložit "Šroub M10×50 ISO 4762" v ${x} ${y} 70`);
  for (const [x, y] of PIL) L.push(`vložit "Vodicí sloupek Ø24×160" v ${x} ${y} 0`);
  for (const [x, y] of PINB) L.push(`vložit "Kolík Ø8×40 ISO 8734" v ${x} ${y} 20`);
  L.push('vložit "Doraz" v 15 100 40', 'vložit "Doraz" v 285 100 40');
  L.push('vložit "Horní deska" v 0 0 175', 'vložit "Kotevní deska" v 0 0 150', 'vložit "Stírací deska" v 0 0 80');
  for (const [x, y] of USCR) L.push(`vložit "Šroub M10×60 ISO 4762" v ${x} ${y} 210`);
  for (const [x, y] of PUN) L.push(`vložit "Střižník" v ${x} ${y} 85`);
  for (const [x, y] of PINB) L.push(`vložit "Kolík Ø8×40 ISO 8734" v ${x} ${y} 150`);
  for (const [x, y] of SPR) L.push(`vložit "Pružina 20×2,5×50" v ${x} ${y} 100`);
  return L;
}
async function p7Mates(): Promise<{ lines: string[]; drive: number }> {
  const a = asmDoc();
  const comps = a.components!;
  const idx = (name: string, k = 0) => comps.map((c, i) => ({ c, i })).filter((x) => x.c.name === name)[k].i + 1;
  const fOf = async (comp: string, dia: number, pts: [number, number][]) => {
    const c = comps.find((x) => x.name === comp)!;
    const { rows } = await compFaces(a, c.id, ENV);
    return pts.map(([x, y]) => {
      const row = rows.find((q) => q.kind === "cylinder" && Math.abs(2 * (q.radius ?? 0) - dia) < 0.01 && Math.hypot(q.origin[0] - x, q.origin[1] - y) < 0.05);
      expect(row, `Ø${dia} v ${x},${y} dílu ${comp}`).toBeTruthy();
      return row!.face + 1;
    });
  };
  const fB = await fOf("Spodní deska", 24, PIL);
  const fU = await fOf("Horní deska", 24.2, PIL);
  const fS = await fOf("Stírací deska", 24.4, PIL);
  const M: string[] = [];
  const mate = (s: string) => M.push(`sestava vazba ${s}`);
  const pil = (i: number) => `"#${idx("Vodicí sloupek Ø24×160", i)}" Ø24`;
  mate('zámek "Matrice" "Spodní deska"');
  for (let i = 0; i < 4; i++) mate(`souosost ${pil(i)} "Spodní deska" F${fB[i]}`);
  for (let i = 0; i < MSCR.length; i++) mate(`zámek "#${idx("Šroub M10×50 ISO 4762", i)}" "Spodní deska"`);
  for (let i = 0; i < 4; i++) mate(`zámek "#${idx("Kolík Ø8×40 ISO 8734", i)}" "Spodní deska"`);
  mate(`zámek "#${idx("Doraz", 0)}" "Spodní deska"`);
  mate(`zámek "#${idx("Doraz", 1)}" "Spodní deska"`);
  mate(`souosost "Horní deska" F${fU[0]} ${pil(0)}`);
  mate(`souosost "Horní deska" F${fU[3]} ${pil(3)}`);
  mate('vzdálenost "Horní deska" spodní "Spodní deska" horní 175');
  const drive = M.length;
  mate('zámek "Kotevní deska" "Horní deska"');
  for (let i = 0; i < USCR.length; i++) mate(`zámek "#${idx("Šroub M10×60 ISO 4762", i)}" "Horní deska"`);
  for (let i = 0; i < PUN.length; i++) mate(`zámek "#${idx("Střižník", i)}" "Kotevní deska"`);
  for (let i = 0; i < 4; i++) mate(`zámek "#${idx("Kolík Ø8×40 ISO 8734", 4 + i)}" "Kotevní deska"`);
  for (let i = 0; i < 4; i++) mate(`zámek "#${idx("Pružina 20×2,5×50", i)}" "Kotevní deska"`);
  mate(`souosost "Stírací deska" F${fS[0]} ${pil(0)}`);
  mate(`souosost "Stírací deska" F${fS[3]} ${pil(3)}`);
  mate('mez vzdálenosti "Stírací deska" horní "Kotevní deska" spodní 20..50');
  mate('mez vzdálenosti "Stírací deska" spodní "Matrice" horní 0..200');
  return { lines: M, drive };
}
/** rozsah polohy (max − min) přes kroky pro všechny instance dílu `name` */
const spanOf = (res: MotionResult, name: string) => {
  const ids = asmDoc().components!.filter((c) => c.name === name).map((c) => c.id);
  const out = [0, 0, 0];
  for (const id of ids) {
    const ps = res.steps.map((s) => s.place[id].position);
    for (let k = 0; k < 3; k++) out[k] = Math.max(out[k], Math.max(...ps.map((p) => p[k])) - Math.min(...ps.map((p) => p[k])));
  }
  return out;
};

describe("P7 – střižný nástroj 57 komponent, pohyb 40 kroků s kolizemi", () => {
  let drive = 0;
  it("sestava: 57 komponent, 61 vazeb splněno", async () => {
    ENV = env();
    clearInterferenceCache();
    await run(p7Lines().join("\n"));
    expect(asmDoc().components!.length).toBe(57);
    const m = await p7Mates();
    drive = m.drive;
    expect(m.lines.length).toBe(61);
    log.length = 0;
    await run(m.lines.join("\n"));
    expect(log.filter((l) => /^L\d+ ✓ vazba/.test(l)).length).toBe(61);
    expect(log.filter((l) => /✗|⚠/.test(l))).toEqual([]);
  }, 300_000);

  it("pohyb bez kolizí: vedené desky jen podél osy, sloupky stojí; ⚠ motion.conflict kroky 27–40 v pořadí vazeb", async () => {
    log.length = 0;
    await run(`pohyb motor lineární vazba ${drive} 175..115 kroky 40`);
    const res = motionCached(asmDoc())!;
    expect(res.steps.length).toBe(41);
    for (const name of ["Horní deska", "Kotevní deska", "Stírací deska", "Střižník", "Pružina 20×2,5×50", "Šroub M10×60 ISO 4762"]) {
      const sp = spanOf(res, name);
      expect(sp[0] + sp[1], name).toBeLessThan(1e-4); // dřív 808 mm
    }
    expect(spanOf(res, "Horní deska")[2]).toBeCloseTo(53.333, 3);
    expect(spanOf(res, "Stírací deska")[2]).toBeCloseTo(16.667, 3);
    expect(spanOf(res, "Vodicí sloupek Ø24×160")).toEqual([0, 0, 0]);
    expect(res.timing).toMatchObject({ vars: 36, groups: 2 });
    expect(res.conflictSteps).toBe(14);
    const issues = motionIssues(res, asmDoc());
    expect(issues.map((x) => x.steps)).toEqual([[27, 40], [27, 40], [27, 40]]);
    expect(motionSummary(res, asmDoc()).filter((l) => l.includes("motion.conflict"))).toEqual([
      " ⚠ motion.conflict pohyb porušuje vazbu „Vzdálenost Horní deska → Spodní deska“ v kroku 27–40 (t = 1.35–2 s)",
      " ⚠ motion.conflict pohyb porušuje vazbu „Mez vzdálenosti Stírací deska → Kotevní deska“ v kroku 27–40 (t = 1.35–2 s)",
      " ⚠ motion.conflict pohyb porušuje vazbu „Mez vzdálenosti Stírací deska → Matrice“ v kroku 27–40 (t = 1.35–2 s)",
    ]);
  }, 120_000);

  let col: MotionResult;
  it("pohyb s kolizemi: ≤ 45 s procesorového času, ≤ 1,5 GB RSS, halda WASM stálá", async () => {
    log.length = 0;
    const h0 = heapMB();
    const cpu0 = process.cpuUsage();
    const t0 = performance.now();
    await run("pohyb kolize");
    const wall = (performance.now() - t0) / 1000;
    const c = process.cpuUsage(cpu0);
    const cpu = (c.user + c.system) / 1e6;
    col = motionCached(asmDoc())!;
    const peak = peakRssMB();
    console.log(`P7 pohyb 40 kroků s kolizemi: ${cpu.toFixed(1)} s CPU, ${wall.toFixed(1)} s zeď, špička RSS ${peak.toFixed(0)} MB, halda WASM ${h0.toFixed(0)} → ${heapMB().toFixed(0)} MB; ${JSON.stringify(col.timing?.clash)}`);
    expect(col.steps.length).toBe(41);
    expect(col.collisionsChecked).toBe(true);
    expect(cpu).toBeLessThan(45);
    expect(peak).toBeLessThan(1536);
    expect(heapMB() - h0).toBeLessThan(50);
    expect(col.timing!.clash!.reused).toBeGreaterThan(col.timing!.clash!.exact); // dvojice uvnitř tuhých skupin se znovupoužijí
    // kolize po krocích (šrouby v závitech, kolíky s přesahem, střižníky v matrici a stírací desce podle zdvihu)
    const per = col.steps.map((s) => (s.clashes ?? []).length);
    expect(per).toEqual([...Array(21).fill(54), ...Array(6).fill(66), ...Array(5).fill(67), ...Array(5).fill(73), ...Array(4).fill(75)]);
    expect(col.collision).toMatchObject({ step: 0 });
  }, 300_000);

  it(`kroky s kolizemi = plná kontrola (bez mezipaměti dvojic)${FULL ? " – všech 41 kroků" : " – kroky se změnou sady kolizí, krajní a dva beze změny"}`, async () => {
    const per = col.steps.map((s) => (s.clashes ?? []).length);
    const sample = FULL ? col.steps.map((s) => s.i) : [...new Set([0, 1, 10, 40, ...col.steps.filter((s) => s.i > 0 && per[s.i] !== per[s.i - 1]).map((s) => s.i)])].sort((a, b) => a - b);
    expect(sample.length).toBeGreaterThanOrEqual(FULL ? 41 : 8);
    for (const i of sample) {
      const s = col.steps[i];
      const full = await interference(poseDoc(asmDoc(), s.place), 1e-3, { full: true });
      const key = (list: { a: string; b: string; volume: number }[]) => list.map((c) => `${c.a}|${c.b}|${c.volume}`).sort();
      expect(key(s.clashes ?? []), `krok ${i}`).toEqual(key(full)); // stejné dvojice i bitově stejné objemy
    }
  }, 600_000);
});
