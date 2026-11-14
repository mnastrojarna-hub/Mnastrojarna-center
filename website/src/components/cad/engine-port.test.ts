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
