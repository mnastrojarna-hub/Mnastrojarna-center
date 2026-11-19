/**
 * React Workspace aplikace (engine-port.ts) nad falešnou aplikací se stejnou logikou záložek jako cad-app.tsx (surový seznam
 * záložek drží historii aktivní záložky z doby jejího otevření, `snapshotTabs` ji doplní; `openDocInTab` přepíše prázdnou
 * aktivní záložku, smí-li). Smlouva B2 po recenzi: dokument dřívějšího běhu se nikdy nepřepíše, `vložit` vidí aktuální díl
 * a název, stav vazeb a kolizí je podle id dokumentu – stejně jako MemoryWorkspace (CLI, serve).
 */
import { describe, expect, it } from "vitest";
import type { TabInfo } from "@/cad/agent-asm";
import { docHasContent, docTabKind } from "@/cad/draft/doc";
import { memoryFileSink, memoryFileSource, type EngineHost } from "@/cad/engine/host";
import type { KernelApi } from "@/cad/engine/kernel";
import { MemoryWorkspace } from "@/cad/engine/memory-workspace";
import { formatConsole } from "@/cad/engine/protocol";
import { runScript } from "@/cad/engine/run";
import type { Workspace } from "@/cad/engine/workspace";
import type { MateStatus } from "@/cad/mates";
import { emptyDoc, uid, type BuildResult, type CadDoc, type ComponentSource } from "@/cad/types";
import { makeAppWorkspace, type AppPortDeps, type PortTab } from "./engine-port";

type Hist = PortTab["hist"];
type Entry = PortTab & { docId: string };

/** aplikace bez Reactu: tytéž přechody záložek jako cad-app.tsx (activateTab, openDocInTab, closeTab, snapshotTabs) */
class FakeApp {
  list: Entry[] = [];
  tabId = uid();
  hist: Hist = { past: [], present: emptyDoc(), future: [] };
  docId = uid();
  shown: { mates?: Record<string, MateStatus>; clash?: unknown } = {};
  cache = new Map<string, BuildResult>();
  constructor(private readonly raw = false) {}
  private fallback = (): Entry[] => [{ id: this.tabId, kind: docTabKind(this.hist.present), title: this.hist.present.name, hist: this.hist, docId: this.docId }];
  snapshot(): Entry[] {
    const base = this.list.length ? this.list : this.fallback();
    return base.map((t) => (t.id === this.tabId ? { ...t, hist: this.hist, docId: this.docId, title: this.hist.present.name, kind: docTabKind(this.hist.present) } : t));
  }
  commit = (d: CadDoc) => {
    this.hist = { past: [...this.hist.past, this.hist.present], present: d, future: [] };
  };
  openDocInTab = (d: CadDoc, o: { reuse?: boolean; docId?: string }): string => {
    if (o.reuse !== false && !docHasContent(this.hist.present)) {
      this.docId = o.docId ?? uid();
      this.commit(d);
      this.list = this.list.length ? this.list.map((t) => (t.id === this.tabId ? { ...t, title: d.name, docId: this.docId } : t)) : [{ id: this.tabId, kind: docTabKind(d), title: d.name, hist: this.hist, docId: this.docId }];
      return this.tabId;
    }
    const e: Entry = { id: uid(), kind: docTabKind(d), title: d.name, hist: { past: [], present: d, future: [] }, docId: o.docId ?? uid() };
    this.list = [...this.snapshot(), e];
    this.hist = e.hist;
    this.docId = e.docId;
    this.tabId = e.id;
    return e.id;
  };
  activateTab = (id: string) => {
    const snap = this.snapshot();
    const t = snap.find((x) => x.id === id);
    if (!t) return;
    this.list = snap;
    this.hist = t.hist;
    this.docId = t.docId;
    this.tabId = id;
  };
  deps = (): AppPortDeps => ({
    hist: () => this.hist,
    // `raw` = chyba před opravou: surový seznam (historie aktivní záložky z doby otevření)
    docTabs: () => (this.raw ? this.list : this.snapshot()),
    docKey: (id) => (id === undefined || id === this.tabId ? this.docId : (this.snapshot().find((t) => t.id === id)?.docId ?? "")),
    tabList: (): TabInfo[] => this.snapshot().map((t) => ({ id: t.id, title: t.title, kind: t.kind, active: t.id === this.tabId })),
    tabId: () => this.tabId,
    commit: this.commit,
    openDocInTab: this.openDocInTab,
    activateTab: this.activateTab,
    closeTab: () => undefined,
    histStep: () => 0,
    freshName: (b) => b,
    settle: async () => undefined,
    asm: {
      cache: this.cache,
      geo: new Map(),
      faceLists: new Map(),
      stack: () => [],
      setStack: () => undefined,
      setMateStatus: (m) => void (this.shown.mates = m),
      setClash: (c) => void (this.shown.clash = c),
      kernelGeneration: () => 1,
      cleared: () => undefined,
    },
  });
}

const result = (d: CadDoc): BuildResult =>
  ({ status: d.features.map((f) => ({ id: f.id, ok: true })), mesh: null, metrics: d.features.length ? { volume: 1000 * d.features.length, area: 600, bbox: [[0, 0, 0], [10, 10, 10 * d.features.length]], faces: 6, edges: 12, valid: true, solids: 1 } : null, ms: 1 }) as unknown as BuildResult;
const kernel = {
  generation: () => 1,
  build: async (d: CadDoc) => result(d),
  asmParts: async (parts: { key: string; source: ComponentSource }[]) => parts.map((p) => ({ key: p.key, result: result(p.source.kind === "part" ? p.source.doc : emptyDoc()) })),
  interference: async (d: CadDoc) => (d.name === "A" ? [{ a: d.components![0].id, b: d.components![1].id, volume: 16000 }] : []),
} as unknown as KernelApi;
const host: EngineHost = { kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() };
const titles = (ws: Workspace) => ws.tabs().map((t) => t.title);
/** tentýž skript (běhy) v aplikaci a v MemoryWorkspace: protokoly konzole a záložky musí být stejné */
async function both(runs: string[]) {
  const app = new FakeApp();
  const aws = makeAppWorkspace(app.deps);
  const mws = new MemoryWorkspace();
  const a: string[] = [];
  const m: string[] = [];
  for (const t of runs) {
    a.push(formatConsole(await runScript(aws, t, host)));
    m.push(formatConsole(await runScript(mws, t, host)));
  }
  const norm = (x: string[]) => x.map((o) => o.replace(/zkontrolováno [\d:]+/g, "zkontrolováno ?").replace(/\bid [a-z0-9]{1,9}\]/g, "id #]"));
  return { app, aws, mws, a: norm(a), m: norm(m) };
}

describe("engine-port: dokumenty dřívějších běhů nikdy nepřepíší záložku (5.2 č. 14, zpráva B1)", () => {
  it("prázdná sestava z běhu 1, nový díl v běhu 2 → záložky S i A (jako MemoryWorkspace)", async () => {
    const r = await both(['nová sestava "S"', 'nový díl "A"\nkvádr 1 1 1', "záložky"]);
    expect(titles(r.aws)).toEqual(["S", "A"]);
    expect(titles(r.mws)).toEqual(["S", "A"]);
    expect(r.a).toEqual(r.m);
  });
  it("prázdný díl z běhu 1, nová sestava v běhu 2 → záložky A i S", async () => {
    const r = await both(['nový díl "A"', 'nová sestava "S"']);
    expect(titles(r.aws)).toEqual(["A", "S"]);
    expect(titles(r.mws)).toEqual(["A", "S"]);
  });
  it("úvodní prázdný díl aplikace se znovu použije (jedna záložka), prázdná sestava uživatele ne", async () => {
    const r = await both(['nový díl "A"\nkvádr 1 1 1']);
    expect(titles(r.aws)).toEqual(["A"]);
    const app = new FakeApp();
    app.hist = { past: [], present: { ...emptyDoc("Sestava"), kind: "assembly" }, future: [] };
    const ws = makeAppWorkspace(app.deps);
    await runScript(ws, 'nový díl "B"\nkvádr 1 1 1', host);
    expect(titles(ws)).toEqual(["Sestava", "B"]);
  });
});

describe("engine-port: vložit / názvy dílů z aktuálního dokumentu záložky (snímek s živou historií)", () => {
  it("díl změněný v dřívějším běhu se vloží aktuální (kvádr + válec), ne stav z otevření záložky", async () => {
    const r = await both(["nový díl A\nkvádr 10 10 10", "válec 5 30", 'nová sestava S\nvložit "A"']);
    expect(r.aws.present().components?.[0].source).toMatchObject({ kind: "part", doc: { features: [{ type: "box" }, { type: "cylinder" }] } });
    expect(r.a).toEqual(r.m);
  });
  it("díl přejmenovaný v dřívějším běhu: vložit novým názvem, starý název = ✗ se seznamem aktuálních názvů", async () => {
    const r = await both(["nový díl A\nkvádr 1 1 1", 'název "B"', 'nová sestava S\nvložit "B"\nvložit "A"']);
    expect(r.a[2]).toMatch(/✓ komponenta „B“ vložena do sestavy/);
    expect(r.a[2]).toMatch(/✗ řádek 3: díl „A“ není mezi otevřenými záložkami – otevřené díly: B/);
    expect(r.a).toEqual(r.m);
  });
  it("bez snímku (surový seznam záložek, chyba před opravou) by se vložila zastaralá kopie – test to rozliší", async () => {
    const app = new FakeApp(true);
    const ws = makeAppWorkspace(app.deps);
    await runScript(ws, "nový díl A\nkvádr 10 10 10", host);
    await runScript(ws, "nový díl X\nkvádr 1 1 1", host); // záznam A v seznamu má teď historii z doby přepnutí
    await runScript(ws, 'záložka "A"\nválec 5 30', host);
    await runScript(ws, 'nová sestava S\nvložit "A"', host);
    expect((ws.present().components?.[0].source as { doc: CadDoc }).doc.features).toHaveLength(1); // zastaralé
    const fixed = new FakeApp(false);
    const ws2 = makeAppWorkspace(fixed.deps);
    for (const t of ["nový díl A\nkvádr 10 10 10", "nový díl X\nkvádr 1 1 1", 'záložka "A"\nválec 5 30', 'nová sestava S\nvložit "A"']) await runScript(ws2, t, host);
    expect((ws2.present().components?.[0].source as { doc: CadDoc }).doc.features).toHaveLength(2);
  });
});

describe("engine-port: stav vazeb a kolizí podle id dokumentu (zrcadlo do zobrazení aplikace)", () => {
  const ASM2 = 'nový díl Blok\nkvádr 40 40 40\nnová sestava A\nvložit "Blok" ukotvit\nvložit "Blok" v 30 0 0\nnová sestava B\nvložit "Blok" ukotvit\nvložit "Blok" v 100 0 0';
  it("kolize A se nepřenese na B; přejmenování A stav zachová; aplikace = MemoryWorkspace", async () => {
    const r = await both([ASM2, 'záložka "A"\nkolize', 'záložka "B"\nstav', 'záložka "A"\nnázev "A2"\nstav']);
    expect(r.a[2]).toMatch(/^Kolize: nezkontrolováno/m);
    expect(r.a[3]).toMatch(/^Kolize: 1 – Blok × Blok/m);
    expect(r.a).toEqual(r.m);
    expect(r.app.shown.clash).toMatchObject({ res: [{ volume: 16000 }] }); // panel Kolize ukazuje poslední kontrolu
  });
  it("tlačítko Kolize / přepočet vazeb aplikace: zápis pod klíčem zobrazeného dokumentu, smazání zrcadlí null", async () => {
    const app = new FakeApp();
    const ws = makeAppWorkspace(app.deps);
    ws.asm.mateStatus.set(ws.docKey(), { m1: "ok" });
    expect(app.shown.mates).toEqual({ m1: "ok" });
    ws.asm.clash.set(ws.docKey(), { res: [], at: "10:00", comps: 2 });
    expect(app.shown.clash).toEqual({ res: [], at: "10:00", comps: 2 });
    expect(ws.asm.clash.delete(ws.docKey())).toBe(true);
    expect(app.shown.clash).toBeNull();
    expect(ws.asm.mateStatus.get("jiný dokument")).toBeUndefined();
  });
  it("stav dokumentu jiné (nezobrazené) záložky se do zobrazení nezrcadlí – souhrny běhu (řádky D) počítají i sestavy v pozadí", async () => {
    const app = new FakeApp();
    const ws = makeAppWorkspace(app.deps);
    await runScript(ws, ASM2, host); // zobrazená je sestava B
    const keyA = ws.docKey(ws.tabs().find((t) => t.title === "A")!.id);
    app.shown = {};
    ws.asm.clash.set(keyA, { res: [], at: "10:00", comps: 2 });
    ws.asm.mateStatus.set(keyA, { m1: "ok" });
    expect(app.shown).toEqual({}); // panel Kolize a seznam vazeb sestavy B beze změny
    expect(ws.asm.clash.get(keyA)).toMatchObject({ comps: 2 }); // stav pod klíčem A uložen
    ws.asm.clash.set(ws.docKey(), { res: [], at: "11:00", comps: 2 }); // zobrazený dokument se zrcadlí dál
    expect(app.shown.clash).toEqual({ res: [], at: "11:00", comps: 2 });
    ws.asm.clash.set("nový dokument běhu bez záložky", { res: [], at: "12:00", comps: 1 }); // záložka teprve vznikne → zrcadlí se
    expect(app.shown.clash).toEqual({ res: [], at: "12:00", comps: 1 });
  });
});

describe("přepnutí záložky, které se nepromítne (5.2 č. 22, balík B4)", () => {
  it("settle → false = ✗ tab.settle-timeout na řádku operace, ne tiché pokračování nad jiným dokumentem", async () => {
    const app = new FakeApp();
    const deps = () => ({ ...app.deps(), settle: async () => false });
    const ws = makeAppWorkspace(deps);
    const r = await runScript(ws, "nový díl A\nkvádr 1 1 1\nnový díl B\nkvádr 2 2 2", host);
    expect(r.entries.filter((e) => e.level === "error").map((e) => `${e.line} ${e.code}`), JSON.stringify(r.entries)).toContain("3 tab.settle-timeout");
  });
});

/* ───────── vlna E, balík runs: opakovaný běh a stručný protokol v aplikaci (engine/runs.ts, engine/run-protocol.ts) ───────── */
const THREE = 'nový díl "Deska"\nkvádr 100 50 10\nnový díl "Čep"\nválec 5 30\nnová sestava "S"\nvložit "Deska" v 0 0 0\nvložit "Čep" v 20 20 10';

describe("aplikace: opakovaný běh téhož skriptu = stejné záložky (jako MemoryWorkspace)", () => {
  it("3 dokumenty dvakrát → Deska, Čep, S; ℹ doc.reused v konzoli; aplikace = MemoryWorkspace", async () => {
    const r = await both([THREE, THREE]);
    expect(titles(r.aws)).toEqual(["Deska", "Čep", "S"]);
    expect(titles(r.mws)).toEqual(["Deska", "Čep", "S"]);
    expect(r.a[1]).toMatch(/✓ nová sestava „S“ – znovu použitá záložka z dřívějšího běhu\nℹ řádek 5: záložka „S“ z dřívějšího běhu použita znovu/);
    expect(r.a).toEqual(r.m);
    // sestava 2. běhu: dvě komponenty z dílů 2. běhu (findPart bere převzatou záložku jako dokument běhu)
    expect(r.aws.present().components?.map((c) => c.name)).toEqual(["Deska", "Čep"]);
  });
  it("obnovení stránky (nový port nad obnovenými záložkami se stejnými id): záložky běhů z sessionStorage → pořád 3 záložky", async () => {
    const store = new Map<string, string>();
    const g = globalThis as { sessionStorage?: unknown };
    const had = g.sessionStorage;
    g.sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    try {
      const app = new FakeApp();
      await runScript(makeAppWorkspace(app.deps), THREE, host);
      expect(JSON.parse(store.get("mn-cad-run-tabs") ?? "[]")).toHaveLength(3); // jen id záložek, žádná data dokumentu
      const r = await runScript(makeAppWorkspace(app.deps), THREE, host); // „po obnovení“: nový port, stejné záložky
      expect(titles(makeAppWorkspace(app.deps))).toEqual(["Deska", "Čep", "S"]);
      expect(r.entries.filter((e) => e.code === "doc.reused")).toHaveLength(3);
      // bez sessionStorage (jiná karta prohlížeče): záložky se nepřevezmou – nová záložka a ℹ doc.name-taken, nikdy tiše
      store.clear();
      const r2 = await runScript(makeAppWorkspace(app.deps), 'nový díl "Deska"\nkvádr 1 1 1', host);
      expect(r2.entries.filter((e) => e.code === "doc.name-taken")).toHaveLength(1);
    } finally {
      g.sessionStorage = had;
    }
  });
  it("záložka otevřená mimo běh se nepřepíše (nová záložka + ℹ doc.name-taken); `znovu` ji převezme; `nový` = nová záložka", async () => {
    const app = new FakeApp();
    const ws = makeAppWorkspace(app.deps);
    app.openDocInTab({ ...emptyDoc("U"), features: [{ id: "u1", name: "Kvádr 1", type: "box", size: [5, 5, 5], position: [0, 0, 0], centered: false, mode: "new" }] as CadDoc["features"] }, {});
    const r1 = await runScript(ws, 'nový díl "U"\nkvádr 1 1 1', host);
    expect(titles(ws)).toEqual(["U", "U"]);
    expect(r1.entries.filter((e) => e.code === "doc.name-taken")).toHaveLength(1);
    await runScript(ws, 'nový díl "U" nový\nkvádr 1 1 1', host);
    expect(titles(ws)).toEqual(["U", "U", "U"]);
    const app2 = new FakeApp();
    const ws2 = makeAppWorkspace(app2.deps);
    app2.openDocInTab({ ...emptyDoc("V"), features: [{ id: "v1", name: "Kvádr 1", type: "box", size: [5, 5, 5], position: [0, 0, 0], centered: false, mode: "new" }] as CadDoc["features"] }, {});
    const r2 = await runScript(ws2, 'nový díl "V" znovu\nkvádr 1 1 1', host);
    expect(titles(ws2)).toEqual(["V"]);
    expect(r2.entries.filter((e) => e.code === "doc.reused")).toHaveLength(1);
    expect(ws2.present().features.map((f) => f.id)).not.toContain("v1");
  });
});

describe("aplikace: stručný protokol (window.mncad.run protocol short) = CLI --formats none", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { setHostAssets } = await import("@/cad/host-assets");
  const { makeKernelClient } = await import("@/cad/kernel-client");
  const { inProcessTransport } = await import("@/cad/kernel-inprocess");
  const { engineRun, finishRun } = await import("@/cad/cli/job");
  const { scriptLines } = await import("@/cad/cli/watchdog");
  const { ReportBuilder, finalizeReport } = await import("@/cad/engine/protocol");
  const { formatRun, runReport } = await import("@/cad/engine/run-protocol");
  const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.resolve(__dirname, "../../../public/fonts", name))).buffer });
  const real = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await real.init();
  const realHost = (): EngineHost => ({ kernel: real, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });
  const noHooks = { opStart: () => undefined, opEnd: () => undefined };
  const cli = async (script: string) => {
    const ws = new MemoryWorkspace();
    const h = realHost();
    const rb = new ReportBuilder({ lang: "cs", lines: scriptLines(script), strict: false });
    await engineRun(ws, script, h, rb, { strict: false, open: [] }, noHooks);
    const fin = await finishRun(ws, h, rb, { formats: "none", allDocs: false, noOutputOnError: false, share: false, strict: false }, noHooks);
    return finalizeReport(rb.finish({ docs: fin.docs, files: [] })).protocol;
  };
  const strip = (s: string) => s.replace(/ t=[\d.]+/g, "").replace(/ slow=\S+/g, "").replace(/ mem=\d+MB/g, "");
  it("skripty 1–3 dokumentů, s chybou, se stavem a kolizemi, prázdná sestava, přísný režim: protokol prohlížeče = CLI", async () => {
    const scripts = [THREE, `${THREE}\nkolize\nstav`, "nový díl A\nkvádr 10 10 10\nzaoblit 50 hrany svislé\nnový díl B\nválec 5 10", 'nová sestava "E"', 'přísně\nnový díl P\nkvádr 10 10 10\ndíra 3 hloubka 2 v 5 5\nblbost'];
    for (const script of scripts) {
      const app = new FakeApp();
      const web = formatRun(await runReport(makeAppWorkspace(app.deps), script, realHost()), { protocol: "short" });
      expect(strip(web), script).toBe(strip(await cli(script)));
      expect(web.length).toBeLessThanOrEqual(2048);
    }
  }, 600_000);
  it("opakovaný běh v aplikaci: řádky D a objemy obou běhů stejné", async () => {
    const app = new FakeApp();
    const ws = makeAppWorkspace(app.deps);
    const d1 = formatRun(await runReport(ws, THREE, realHost()), { protocol: "full" }).split("\n").filter((l) => l.startsWith("D "));
    const d2 = formatRun(await runReport(ws, THREE, realHost()), { protocol: "full" }).split("\n").filter((l) => l.startsWith("D "));
    expect(d1).toHaveLength(3);
    expect(d1[0]).toBe('D "Deska" part feat=1/0/0 V=50cm3 m=0.392kg bbox=100x50x10');
    expect(d2).toEqual(d1);
    expect(titles(ws)).toEqual(["Deska", "Čep", "S"]);
  }, 240_000);
});

/* ───────── zápis se promítne až po vykreslení (React): přepnutí záložky hned po zápisu ho nesmí zahodit ───────── */
/**
 * Aplikace jako React: `commit` (setHist s funkcí) a přepnutí záložky (`activateTab`) se ve stavu projeví až „vykreslením“
 * (`settle`); přepnutí si ale snímek záložek bere hned ze stavu před vykreslením – jako cad-app.tsx `snapshotTabs(histRef)`.
 */
function lazyDeps(app: FakeApp): () => AppPortDeps {
  const queue: (() => void)[] = [];
  const render = () => {
    for (const f of queue.splice(0)) f();
  };
  return () => ({
    ...app.deps(),
    commit: (d) => void queue.push(() => app.commit(d)),
    activateTab: (id) => {
      const snap = app.snapshot(); // snímek ze stavu před vykreslením (aktivní záložka s historií z posledního vykreslení)
      queue.push(() => {
        const t = snap.find((x) => x.id === id);
        if (!t) return;
        app.list = snap;
        app.hist = t.hist;
        app.docId = t.docId;
        app.tabId = id;
      });
    },
    settle: async (ok) => {
      render();
      return ok();
    },
  });
}
const featsOf = (app: FakeApp, title: string) => app.snapshot().find((t) => t.title === title)?.hist.present.features.map((f) => f.type);

describe("zápis do záložky před přepnutím (aplikace vykresluje až po běhu operace)", () => {
  it("`záložka \"B1\"` hned po úpravě dílu A1 – úprava A1 zůstane (dřív se tiše zahodila)", async () => {
    const app = new FakeApp();
    const ws = makeAppWorkspace(lazyDeps(app));
    await runScript(ws, 'nový díl "A1"\nkvádr 10 10 10\nnový díl "B1"\nkvádr 5 5 5', host);
    const r = await runScript(ws, 'záložka "A1"\nválec 5 30\nzáložka "B1"', host);
    expect(r.counts.errors).toBe(0);
    expect(featsOf(app, "A1")).toEqual(["box", "cylinder"]);
    expect(app.hist.present.name).toBe("B1");
  });
  it("opakovaný běh se změněným obsahem: převzatá záložka R1 má nový obsah, i když hned následuje další dokument", async () => {
    const app = new FakeApp();
    const ws = makeAppWorkspace(lazyDeps(app));
    await runScript(ws, 'nový díl "R1"\nkvádr 10 10 10\nnový díl "R2"\nkvádr 5 5 5', host);
    const r = await runScript(ws, 'nový díl "R1"\nkvádr 20 20 20\nválec 3 30\nnový díl "R2"\nkvádr 6 6 6\nnová sestava "S"\nvložit "R1"\nvložit "R2"', host);
    expect(r.counts.errors).toBe(0);
    expect(titles(ws)).toEqual(["R1", "R2", "S"]);
    expect(featsOf(app, "R1")).toEqual(["box", "cylinder"]);
    const box = app.snapshot().find((t) => t.title === "R1")!.hist.present.features[0] as { size: number[] };
    expect(box.size).toEqual([20, 20, 20]);
    expect((app.snapshot().find((t) => t.title === "R2")!.hist.present.features[0] as { size: number[] }).size).toEqual([6, 6, 6]);
  });
});
