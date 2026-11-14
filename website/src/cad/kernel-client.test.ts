/**
 * Klient jádra nezávislý na transportu (kernel-client.ts, balík B1).
 *
 * 1. Logika klienta nad falešným transportem (bez OCCT): data importů jen poprvé na instanci, průběh dlouhých operací,
 *    zrušení, pád jádra a nová instance (generace + 1), jádro, které se nenačetlo.
 * 2. Skutečné jádro in-process (kernel-inprocess.ts → kernel-ops.ts `handleKernel`): kvádr, STEP, `exportStats`,
 *    `faceOwner`, díly sestavy, souběžné požadavky, kopie zpráv (`structuredClone`) a pád WASM → nová instance OCCT
 *    (generace + 1, mezipaměti staré instance zahozené, stavba znovu funguje).
 *    Svary (weld-kernel.ts) po nové instanci: modul OCCT se bere vždy z `getOC()`, ne z proměnné modulu. `restart: false`
 *    (vlákno běhu CLI): po pádu se nové OCCT nenačte, další požadavky hned skončí chybou pádu.
 * 3. Hranice: klient jádra a protokol nenačítají jádro (prohlížečový svazek hlavního vlákna), `client.ts` jen Web Worker;
 *    žádný modul nedrží modul OCCT (`getOC()`) v proměnné modulu.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as r from "replicad";
import { blobIdOf, putBlob } from "./blobs";
import { setLang } from "./i18n";
import { CadCancelled, isCancelled, makeKernelClient, type CadProgress, type KernelTransport, type KernelTransportEvents } from "./kernel-client";
import type { KernelEnvelope, KernelMsg } from "./kernel-protocol";
import { cachedBody } from "./asm-kernel";
import { newExtFeature } from "./defaults";
import { emptyDoc, type CadDoc, type Feature } from "./types";

/* pád WASM na požádání: `surfA` s dotazem `__fatal` vyhodí WebAssembly.RuntimeError uprostřed obsluhy (jako abort OCCT) */
vi.mock("./surf-query", async (orig) => {
  const m = await orig<typeof import("./surf-query")>();
  return {
    ...m,
    surfQuery: (body: Parameters<typeof m.surfQuery>[0], q: Parameters<typeof m.surfQuery>[1]) => {
      if ((q as { __fatal?: boolean }).__fatal) throw new WebAssembly.RuntimeError("Aborted(test fault)");
      return m.surfQuery(body, q);
    },
  };
});

/* ───────────────────────── 1. falešný transport ───────────────────────── */

type FakeInst = { n: number; posts: KernelEnvelope[]; on: KernelTransportEvents; terminated: boolean };
function fakeTransport(o: Partial<Pick<KernelTransport, "sharedBlobs" | "cancellable">> = {}) {
  const insts: FakeInst[] = [];
  const t: KernelTransport = {
    ...o,
    spawn(on) {
      const inst: FakeInst = { n: insts.length + 1, posts: [], on, terminated: false };
      insts.push(inst);
      return { post: (m) => void inst.posts.push(m), terminate: () => void (inst.terminated = true) };
    },
  };
  const last = () => insts[insts.length - 1];
  /** odpověď poslední instance na poslední požadavek s operací `op` */
  const answer = (op: string, m: KernelMsg) => {
    const req = [...last().posts].reverse().find((p) => p.op === op)!;
    last().on.message({ id: req.id, ...m });
  };
  return { t, insts, last, answer };
}
const flush = () => new Promise((res) => setTimeout(res, 0));
const doc = (name: string, features: Feature[] = []): CadDoc => ({ ...emptyDoc(name), features });
const importDoc = (ref: string): CadDoc => doc("Import", [{ id: "i1", name: "Import 1", type: "import", fileName: "a.step", format: "step", data: ref } as unknown as Feature]);

describe("klient jádra nad transportem (logika z client.ts)", () => {
  it("data importů jen poprvé na instanci; nová instance je dostane znovu; sdílené úložiště (in-process) je neposílá", async () => {
    const f = fakeTransport();
    const k = makeKernelClient(f.t);
    const ref = putBlob(new Uint8Array([1, 2, 3, 4]));
    const p1 = k.build(importDoc(ref));
    expect(f.insts).toHaveLength(1);
    expect(f.last().posts[0]).toMatchObject({ op: "build", blobs: { [blobIdOf(ref)]: new Uint8Array([1, 2, 3, 4]) } });
    f.answer("build", { ok: true, result: { status: [] } });
    await p1;
    const p2 = k.build(importDoc(ref));
    expect(f.last().posts[1].blobs).toBeUndefined();
    f.answer("build", { ok: true, result: { status: [] } });
    await p2;
    // zrušení → nová instance (generace 2) → data znovu
    const p3 = k.build(importDoc(ref));
    expect(k.cancel()).toBe(true);
    await expect(p3).rejects.toBeInstanceOf(CadCancelled);
    expect(f.insts[0].terminated).toBe(true);
    const p4 = k.build(importDoc(ref));
    expect(f.insts).toHaveLength(2);
    expect(f.last().posts[0].blobs).toBeDefined();
    f.answer("build", { ok: true, result: { status: [] } });
    await p4;
    const s = fakeTransport({ sharedBlobs: true });
    const ks = makeKernelClient(s.t);
    void ks.build(importDoc(ref));
    expect(s.last().posts[0].blobs).toBeUndefined();
    expect(s.last().posts[0]).toMatchObject({ op: "build", doc: { features: [{ data: ref }] } });
  });

  it("průběh: „start“ u dlouhé operace, prvek k z n od jádra, další čekající dlouhá operace převezme ukazatel, pak null", async () => {
    const f = fakeTransport();
    const k = makeKernelClient(f.t);
    const seen: (CadProgress | null)[] = [];
    const off = k.onProgress((p) => seen.push(p));
    const a = k.build(doc("A"));
    const b = k.drawing(doc("A"), { title: "A" } as never);
    const face = k.face(0); // krátká operace průběh nehlásí
    expect(seen.map((p) => p && [p.op, p.phase])).toEqual([["build", "start"]]);
    f.answer("build", { progress: { phase: "feature", index: 0, total: 2, name: "Kvádr 1" } });
    expect(k.progress()).toMatchObject({ op: "build", phase: "feature", index: 0, total: 2, name: "Kvádr 1" });
    f.answer("build", { ok: true, result: { status: [] }, at: Date.now() });
    await a;
    expect(k.progress()).toMatchObject({ op: "drawing", phase: "start" });
    f.answer("face", { ok: true, result: null });
    await face;
    f.answer("drawing", { ok: true, result: {} });
    await b;
    expect(k.progress()).toBeNull();
    expect(seen.at(-1)).toBeNull();
    expect(k.busy()).toBe(false);
    off();
  });

  it("chyba operace = odmítnutí s textem jádra; pád jádra (fatal) = všechny čekající odmítnuté, onRestart, generace + 1 hned", async () => {
    setLang("en");
    try {
      const f = fakeTransport();
      const k = makeKernelClient(f.t);
      expect(k.generation()).toBe(1); // ještě nic neběží: příští instance je první
      const bad = k.exportFile(doc("A"), "step");
      // nové jádro dostane jazyk rozhraní dřív než první požadavek
      expect(f.last().posts.map((p) => p.op)).toEqual(["lang", "export"]);
      expect(f.last().posts[0]).toMatchObject({ lang: "en" });
      f.answer("export", { ok: false, error: "Model is empty." });
      await expect(bad).rejects.toThrow("Model is empty.");
      expect(k.generation()).toBe(1);
      const restarts: [string, string][] = [];
      k.onRestart((reason, raw) => void restarts.push([reason, raw]));
      const p1 = k.build(doc("A"));
      const p2 = k.topology(doc("A"));
      f.answer("build", { ok: false, fatal: true, error: "Aborted(OOM)" });
      await expect(p1).rejects.toThrow(/memory|paměť/i);
      await expect(p2).rejects.toThrow(/memory|paměť/i);
      expect(restarts).toHaveLength(1);
      expect(restarts[0][1]).toBe("Aborted(OOM)");
      expect(f.insts[0].terminated).toBe(true);
      expect(k.generation()).toBe(2); // mezipaměti staré instance už neplatí
      expect(k.busy()).toBe(false);
      const p3 = k.build(doc("A"));
      expect(f.insts).toHaveLength(2);
      expect(f.last().posts.map((p) => p.op)).toEqual(["lang", "build"]);
      f.answer("build", { ok: true, result: { status: [] } });
      await p3;
      expect(k.generation()).toBe(2);
      // zpráva staré instance po pádu se zahodí (id už nečeká)
      f.insts[0].on.message({ id: 1, ok: true, result: 1 });
    } finally {
      setLang("cs");
    }
  });

  it("jádro se nenačetlo (chyba instance při init) = srozumitelná chyba, ne pád; transport bez zrušení: cancel() = false", async () => {
    const f = fakeTransport();
    const k = makeKernelClient(f.t);
    const p = k.init();
    f.last().on.error("wasm 404");
    await expect(p).rejects.toThrow(/CAD jádro se nepodařilo načíst: wasm 404/);
    expect(f.insts[0].terminated).toBe(true);
    const n = fakeTransport({ cancellable: false });
    const kn = makeKernelClient(n.t);
    const q = kn.build(doc("A"));
    expect(kn.cancel()).toBe(false);
    expect(n.last().terminated).toBe(false);
    n.answer("build", { ok: true, result: { status: [] } });
    await q;
    expect(isCancelled(new CadCancelled())).toBe(true);
  });
});

/* ───────────────────────── 2. skutečné jádro in-process ───────────────────────── */

const WASM = path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const box = (w = 40, d = 30, h = 20): Feature => ({ id: "b1", name: "Kvádr 1", type: "box", size: [w, d, h], position: [0, 0, 0], centered: false, mode: "new" }) as Feature;
const hole = (): Feature => ({ id: "h1", name: "Díra 1", type: "hole", position: [20, 15, 20], axis: "Z", flip: false, diameter: 8, depth: 0, cbDiameter: 0, cbDepth: 0 }) as Feature;

describe("jádro in-process (kernel-inprocess.ts → kernel-ops.ts)", async () => {
  const { inProcessTransport } = await import("./kernel-inprocess");
  const located: string[] = [];
  const transport = inProcessTransport({ locateFile: (file) => (located.push(file), file.endsWith(".wasm") ? WASM : file) });
  const k = makeKernelClient(transport);

  it("init s locateFile; kvádr: objem, plochy, síť (přenesené buffery) a průběh po prvcích", async () => {
    await k.init();
    expect(located).toContain("replicad_single.wasm");
    expect(k.generation()).toBe(1);
    const prog: CadProgress[] = [];
    const off = k.onProgress((p) => p && p.phase !== "start" && prog.push(p));
    const res = await k.build(doc("Kvádr", [box(), hole()]));
    off();
    expect(res.metrics?.volume).toBeCloseTo(40 * 30 * 20 - Math.PI * 16 * 20, 3);
    expect(res.metrics?.faces).toBe(7);
    expect(res.status.every((s) => s.ok)).toBe(true);
    expect(res.mesh?.triangles.length).toBeGreaterThan(0);
    expect(res.mesh?.vertices).toBeInstanceOf(Float32Array);
    expect(prog.some((p) => p.op === "build" && p.phase === "feature")).toBe(true);
    // znovu stejný dokument (mezipaměť stavby v jádře): síť je celá – jádro předalo kopii, ne svou mezipaměť
    const again = await k.build(doc("Kvádr", [box(), hole()]));
    expect(again.mesh?.triangles.length).toBe(res.mesh?.triangles.length);
  }, 120_000);

  it("STEP export a exportStats (soubor znovu načtený jádrem = model)", async () => {
    const d = doc("Kvádr", [box()]);
    const buf = new Uint8Array(await k.exportFile(d, "step"));
    expect(new TextDecoder().decode(buf.slice(0, 13))).toBe("ISO-10303-21;");
    const st = await k.exportStats(d, buf, "step");
    expect(st.model).toMatchObject({ solids: 1 });
    expect(st.model.volume).toBeCloseTo(24000, 3);
    expect(st.file.solids).toBe(1);
    expect(st.file.volume).toBeCloseTo(24000, 2);
    expect(st.file.bbox[1][0]).toBeCloseTo(40, 3);
    expect(buf.length).toBeGreaterThan(1000); // vstup klienta zůstal celý (požadavek se kopíruje, nepřenáší)
  }, 120_000);

  it("faceOwner: stěna díry → Díra 1, horní plocha → Kvádr 1", async () => {
    const d = doc("Deska", [box(), hole()]);
    const topo = await k.topology(d);
    expect(topo).not.toBeNull();
    const wall = topo!.faces.find((f) => !f.planar)!;
    const top = topo!.faces.find((f) => f.planar && f.normal && f.normal[2] > 0.99 && (f.center?.[2] ?? 0) > 19.9)!;
    const ow = await k.faceOwner(d, wall.index);
    expect(ow).toMatchObject({ featureId: "h1" });
    expect(ow!.faces).toContain(wall.index);
    expect(await k.faceOwner(d, top.index)).toMatchObject({ featureId: "b1" });
  }, 120_000);

  it("souběžné požadavky dostanou každý svou odpověď; výsledek je kopie (změna u klienta jádro neovlivní)", async () => {
    const [a, b, c] = await Promise.all([k.build(doc("A", [box(10, 10, 10)])), k.build(doc("B", [box(20, 10, 10)])), k.face(0)]);
    expect(a.metrics?.volume).toBeCloseTo(1000, 3);
    expect(b.metrics?.volume).toBeCloseTo(2000, 3);
    expect(c).not.toBeUndefined();
    a.status.length = 0;
    const a2 = await k.build(doc("A", [box(10, 10, 10)]));
    expect(a2.status).toHaveLength(1);
  }, 120_000);

  it("pád WASM uprostřed operace → čekající odmítnuté, onRestart s původní chybou, generace + 1, nové OCCT, mezipaměti zahozené", async () => {
    const part = doc("Díl", [box(30, 20, 10)]);
    const parts = await k.asmParts([{ key: "P1", source: { kind: "part", doc: part } }]);
    expect(parts[0].result.metrics?.volume).toBeCloseTo(6000, 3);
    expect(await k.mateFace("P1", 0)).not.toBeNull();
    expect(cachedBody("P1")).not.toBeNull();
    const oc1 = r.getOC();
    const restarts: string[] = [];
    k.onRestart((_reason, raw) => void restarts.push(raw));
    expect(k.generation()).toBe(1);
    // surfA bez dokumentu spadne hned po načtení jádra – dřív, než doběhne souběžná stavba (ta čeká a odmítne se s pádem)
    const crash = k.surfA({ kind: "continuity", __fatal: true } as never);
    const waiting = k.build(doc("Kvádr", [box(41)]));
    await expect(crash).rejects.toThrow(/Aborted\(test fault\)/);
    await expect(waiting).rejects.toThrow(/Aborted\(test fault\)/);
    expect(restarts).toEqual(["Aborted(test fault)"]);
    expect(k.generation()).toBe(2);
    // nová instance: OCCT znovu načtené, díly staré instance zapomenuté, stavba a export fungují
    const res = await k.build(doc("Kvádr", [box()]));
    expect(res.metrics?.volume).toBeCloseTo(24000, 3);
    expect(r.getOC()).not.toBe(oc1);
    expect(cachedBody("P1")).toBeNull();
    expect(k.generation()).toBe(2);
    const parts2 = await k.asmParts([{ key: "P1", source: { kind: "part", doc: part } }]);
    expect(parts2[0].result.metrics?.volume).toBeCloseTo(6000, 3);
    expect(await k.mateFace("P1", 0)).not.toBeNull();
    const step = new Uint8Array(await k.exportFile(doc("Kvádr", [box()]), "step"));
    expect(new TextDecoder().decode(step.slice(0, 13))).toBe("ISO-10303-21;");
  }, 180_000);

  it("svary po pádu: tupý svar V (weld.groove) se v nové instanci OCCT postaví stejně jako před pádem", async () => {
    const plate = (id: string, x: number, body?: string): Feature => ({ id, name: `Deska ${id}`, type: "box", size: [100, 200, 10], position: [x, 0, 0], centered: false, mode: "new", ...(body ? { body } : {}) }) as Feature;
    const base = doc("Svary", [plate("p1", -100), plate("p2", 2, "Těleso 2")]);
    const topo = await k.topology(base);
    // čelo první desky u mezery 2 mm (normála +X v x = 0, uprostřed tloušťky)
    const face = topo!.faces.find((f) => f.planar && f.normal && Math.abs(f.normal[0] - 1) < 1e-6 && Math.abs(f.center?.[0] ?? 9) < 1e-4 && Math.abs((f.center?.[2] ?? 9) - 5) < 1e-4)!.index;
    const g = newExtFeature(base, "weld.groove");
    if (g.type === "ext") g.data = { ...g.data, faces: [face], prep: "V", angle: 60, rootFace: 1, gap: 2, cap: 1.5 };
    const features = [...base.features, g];
    const summary = (res: Awaited<ReturnType<typeof k.build>>) => ({ status: res.status.map((s) => [s.id, s.ok, s.error ?? null]), bodies: res.bodies?.map((b) => [b.name, Math.round(b.volume)]) });
    const before = summary(await k.build(doc("Svary", features)));
    expect(before.status.map((s) => s[1])).toEqual([true, true, true]);
    expect(before.bodies?.length).toBeGreaterThanOrEqual(3); // dvě desky + svarový kov
    const oc1 = r.getOC();
    const g0 = k.generation();
    await expect(k.surfA({ kind: "continuity", __fatal: true } as never)).rejects.toThrow(/Aborted\(test fault\)/);
    expect(k.generation()).toBe(g0 + 1);
    // dřív: weld-kernel.ts držel modul OCCT staré instance → „Expected null or instance of TopoDS_Shape, got an instance of TopoDS_Shape“
    const after = summary(await k.build(doc("Svary 2", features)));
    expect(r.getOC()).not.toBe(oc1);
    expect(after).toEqual(before);
  }, 180_000);

  it("zkušební závada inject(fatal) jde přes stejnou cestu jako pád jádra (MNCAD_TEST_FAULT=fatal v CLI)", async () => {
    const restarts: string[] = [];
    k.onRestart((_r, raw) => void restarts.push(raw));
    const g = k.generation();
    transport.inject({ fatal: true, error: "Aborted(MNCAD_TEST_FAULT)" });
    expect(restarts).toContain("Aborted(MNCAD_TEST_FAULT)");
    expect(k.generation()).toBe(g + 1);
    expect(k.cancel()).toBe(false); // in-process nejde zrušit (jen hlídač vlákna)
  });

  // poslední test této části: vlastní transport (stav jádra je modulový – po něm zůstane spadlá instance)
  it("restart: false (vlákno běhu CLI): po pádu se nové OCCT nenačte, další požadavky hned skončí chybou pádu", async () => {
    const t2 = inProcessTransport({ restart: false });
    const k2 = makeKernelClient(t2);
    const ok = await k2.build(doc("Kvádr", [box()]));
    expect(ok.metrics?.volume).toBeCloseTo(24000, 3);
    const oc1 = r.getOC();
    const restarts: string[] = [];
    k2.onRestart((_r, raw) => void restarts.push(raw));
    await expect(k2.surfA({ kind: "continuity", __fatal: true } as never)).rejects.toThrow(/Aborted\(test fault\)/);
    expect(restarts).toEqual(["Aborted(test fault)"]);
    await expect(k2.build(doc("Kvádr", [box()]))).rejects.toThrow("Jádro CAD spadlo (Aborted(test fault)) a ve vlákně běhu se znovu nespouští.");
    await expect(k2.init()).rejects.toThrow(/ve vlákně běhu se znovu nespouští/);
    expect(r.getOC()).toBe(oc1); // žádné druhé OCCT ve vlákně
    expect(restarts).toHaveLength(1); // odmítnutí nejsou další pády
  }, 120_000);
});

/* ───────────────────────── 3. hranice ───────────────────────── */

/** importy hodnot (ne `import type` / `export type`) ze zdrojového textu */
function valueImports(file: string): string[] {
  const src = fs.readFileSync(path.resolve(__dirname, file), "utf8");
  const out: string[] = [];
  for (const m of src.matchAll(/^(import|export)\s+(?!type\b)([^;]*?)\s+from\s+"([^"]+)"/gm)) {
    const names = m[2].replace(/^\{|\}$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
    if (names.length && names.every((n) => n.startsWith("type "))) continue;
    out.push(m[3]);
  }
  for (const m of src.matchAll(/^import\s+"([^"]+)"/gm)) out.push(m[1]);
  return out;
}

/** zdrojové soubory (bez testů) pod `dir` */
function sourceFiles(dir: string): string[] {
  return (fs.readdirSync(dir, { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)).map((f) => path.join(dir, f));
}

describe("hranice klienta jádra", () => {
  it("žádný modul nedrží modul OCCT (getOC()) v proměnné modulu – po pádu ve vlákně se načte nová instance (resetKernel)", () => {
    const bad: string[] = [];
    for (const file of sourceFiles(path.resolve(__dirname, ".."))) {
      fs.readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (!line.includes("getOC()")) return;
          // proměnná modulu (řádek bez odsazení, ne funkce) nebo přiřazení do dříve deklarované proměnné (`ocRef = r.getOC()`)
          const topLevel = /^(export\s+)?(let|const|var)\s/.test(line) && !line.includes("=>");
          const assign = /^\s*[A-Za-z_$][\w$.]*\s*(\?\?|\|\|)?=[^=>]/.test(line);
          if (topLevel || assign) bad.push(`${path.relative(path.resolve(__dirname, ".."), file)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(bad).toEqual([]);
  });
  it("kernel-client.ts a kernel-protocol.ts nenačítají jádro (replicad, OCCT, kernel-ops) – hlavní vlákno prohlížeče zůstane lehké", () => {
    expect(valueImports("kernel-protocol.ts")).toEqual([]);
    const kc = valueImports("kernel-client.ts");
    expect(kc.sort()).toEqual(["./blobs", "./i18n", "./kernel-errors", "./perf-log"]);
  });
  it("client.ts = transport Web Worker nad kernel-client; cad.worker.ts = obal handleKernel", () => {
    expect(valueImports("client.ts").sort()).toEqual(["./kernel-client", "./kernel-client"]);
    const cw = fs.readFileSync(path.resolve(__dirname, "cad.worker.ts"), "utf8");
    expect(cw).toMatch(/new Worker|handleKernel/);
    expect(valueImports("cad.worker.ts").sort()).toEqual(["./kernel-ops", "./perf-log"]);
    expect(cw.split("\n").length).toBeLessThanOrEqual(12);
    expect(fs.readFileSync(path.resolve(__dirname, "client.ts"), "utf8")).toContain('new Worker(new URL("./cad.worker.ts", import.meta.url), { type: "module" })');
  });
});
