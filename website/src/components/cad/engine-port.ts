/**
 * Engine v aplikaci (CAD-HEADLESS-NAVRH.md kap. 2.4, balík B2): React implementace pracovního prostoru (`Workspace`) nad
 * záložkami a historií cad-app.tsx a hostitel (`EngineHost`) s háčky UI. `runAgentText` aplikace =
 * `formatConsole(await runScript(port.ws, text, port.host, { inPlace }))` – stejná smyčka jako CLI a `mncad serve`.
 *
 * Stav aplikace se čte vždy čerstvý přes `get()` (funkce cad-app se mění s každým vykreslením). Záložky se čtou jako
 * snímek s živou historií aktivní záložky (`snapshotTabs` v cad-app) – `vložit`, `výkres model` a seznam dílů vidí aktuální
 * dokument a název, ne stav z doby otevření záložky. Mezipaměti dílů a ploch (`ws.asm.cache/geo/faceLists`) jsou
 * mezipaměti aplikace (sdílí je 3D okno). Stav vazeb a kolize jsou podle klíče dokumentu (`docKey` = id dokumentu
 * záložky, přejmenování ho nemění) jako v `MemoryWorkspace`; zápis se zrcadlí do stavu aplikace (seznam vazeb, panel
 * Kolize) a tlačítko Kolize / přepočet vazeb v aplikaci zapisují pod klíčem zobrazeného dokumentu (cad-app.tsx).
 *
 * Nový dokument běhu použije prázdnou záložku jen tehdy, je-li to prázdný díl, do kterého žádný běh nezapsal (jako úvodní
 * prázdný díl `MemoryWorkspace`) – dokument dřívějšího běhu (i prázdná sestava) se nikdy nepřepíše (5.2 č. 14). Výjimkou je
 * opakovaný běh: záložku „A“, kterou založil běh dokumentem téhož původu, převezme (`namedTabs` / `claimTab`, engine/runs.ts).
 */
import type { TabInfo } from "@/cad/agent-asm";
import type { PartFaces } from "@/cad/asm-agent";
import type { MotionSignal } from "@/cad/asm-agent-kin";
import type { Interference } from "@/cad/asm-kernel";
import { embedBlobs } from "@/cad/blobs";
import type { DocKey, Workspace, AsmCaches, RunOrigin } from "@/cad/engine/workspace";
import { CodedError } from "@/cad/engine/codes";
import { safeFileName, sha256Hex, type EngineHost, type FileSink, type UiHooks } from "@/cad/engine/host";
import { appAttachments } from "@/cad/engine/attachments";
import type { KernelApi } from "@/cad/engine/kernel";
import type { MateStatus, PartFace } from "@/cad/mates";
import type { BuildResult, CadDoc } from "@/cad/types";

/** přepnutí záložky se do ~5 s nepromítlo do stavu aplikace – dřív tiše pokračovalo nad jiným dokumentem (5.2 č. 22) */
const settled = (ok: boolean | void) => {
  if (ok === false) throw new CodedError("tab.settle-timeout", [5]);
};

type Hist = { past: CadDoc[]; present: CadDoc; future: CadDoc[] };
/** záložka aplikace (jen čtené údaje) */
export type PortTab = { id: string; kind: "part" | "assembly" | "drawing" | "draft"; title: string; hist: Hist };

/** přístup k aplikaci – volá se při každém použití (vždy poslední vykreslení cad-app.tsx) */
export type AppPortDeps = {
  hist(): Hist;
  /** záznamy záložek – snímek s aktuální historií a názvem aktivní záložky (`snapshotTabs`), ne surový seznam stavu */
  docTabs(): PortTab[];
  /** id dokumentu záložky `id` (výchozí aktivní; záložka výkresu → její zdrojová záložka); neznámá záložka → "" */
  docKey(id?: string): string;
  tabList(): TabInfo[];
  tabId(): string;
  commit(d: CadDoc): void;
  /** otevře dokument; `reuse: false` = nikdy nepřepsat prázdnou aktivní záložku (dokument běhu); `docId` = id dokumentu */
  openDocInTab(d: CadDoc, o: { reuse: boolean; docId?: string }): string;
  activateTab(id: string): void;
  closeTab(id: string): void;
  /** zpět / znovu (flushSync – historie je hned aktuální) */
  histStep(dir: "undo" | "redo", n: number): number;
  freshName(base: string): string;
  /** počká, až se změna stavu promítne do refs po vykreslení (max. ~5 s); false = nepromítla se (✗ tab.settle-timeout) */
  settle(ok: () => boolean): Promise<boolean | void>;
  asm: {
    cache: Map<string, BuildResult>;
    geo: Map<string, PartFace>;
    faceLists: Map<string, PartFaces>;
    stack(): { asm: CadDoc; key: string }[];
    setStack(s: { asm: CadDoc; key: string }[]): void;
    /** zobrazit stav vazeb v seznamu vazeb aplikace (zrcadlo zápisu do `ws.asm.mateStatus`) */
    setMateStatus(m: Record<string, MateStatus>): void;
    /** zobrazit výsledek kontroly kolizí v panelu Kolize (zrcadlo zápisu do `ws.asm.clash`; null = smazán) */
    setClash(c: { res: Interference[]; at: string; comps: number } | null): void;
    /** generace jádra aplikace (`cad.generation()`) */
    kernelGeneration(): number;
    /** jádro se restartovalo a engine vyprázdnil mezipaměti sestavy – aplikace znovu načte díly zobrazené sestavy */
    cleared(): void;
  };
};

/**
 * stav podle klíče dokumentu; zápis a smazání se zrcadlí do stavu aplikace (zobrazení) – kromě dokumentu jiné, nezobrazené
 * záložky (`hidden`: souhrny dokumentů běhu – řádky D, run-summary.ts – počítají stav vazeb a kolizí i sestav v pozadí)
 */
class MirrorMap<V> extends Map<DocKey, V> {
  constructor(
    private readonly mirror: (v: V | null) => void,
    private readonly hidden: (k: DocKey) => boolean = () => false,
  ) {
    super();
  }
  override set(k: DocKey, v: V): this {
    super.set(k, v);
    if (!this.hidden?.(k)) this.mirror?.(v);
    return this;
  }
  override delete(k: DocKey): boolean {
    const had = super.delete(k);
    if (had && !this.hidden?.(k)) this.mirror?.(null);
    return had;
  }
}

const isPart = (t: { kind: string }) => t.kind === "part";
const isPartDoc = (d: CadDoc) => d.kind !== "assembly" && d.kind !== "draft";

/**
 * Záložky založené během (opakovaný běh `nový díl "A"`, engine/runs.ts) přežijí obnovení stránky: obnova záložek ze
 * šifrovaného úložiště (cad-app.tsx) jim nechá id, tady se pamatují jen ta id (žádná data dokumentu) v sessionStorage karty.
 */
const RUN_TABS_KEY = "mn-cad-run-tabs";
/** `[[id, původ]]` (dřívější zápis jen `[id]` = původ `new`) */
const loadRunTabs = (): [string, RunOrigin][] => {
  try {
    const v: unknown = JSON.parse(globalThis.sessionStorage?.getItem(RUN_TABS_KEY) ?? "[]");
    if (!Array.isArray(v)) return [];
    return v.flatMap((x): [string, RunOrigin][] => (typeof x === "string" ? [[x, "new"]] : Array.isArray(x) && typeof x[0] === "string" && (x[1] === "new" || x[1] === "open") ? [[x[0], x[1]]] : []));
  } catch {
    return [];
  }
};
const saveRunTabs = (m: Map<string, RunOrigin>) => {
  try {
    globalThis.sessionStorage?.setItem(RUN_TABS_KEY, JSON.stringify([...m].slice(-500)));
  } catch {
    /* soukromé okno / plné úložiště – platí do obnovení stránky */
  }
};

/** React `Workspace` nad funkcemi cad-app.tsx (`commit`, `openDocInTab`, `activateTab` + čekání, `closeTab`, `histStep`). */
export function makeAppWorkspace(get: () => AppPortDeps): Workspace {
  /** dokumenty tohoto běhu podle názvu (zápis do záložky se do stavu aplikace propíše až po vykreslení) */
  let made = new Map<string, CadDoc>();
  /** poslední zápis do historie aktivní záložky v běhu – konec běhu počká na jeho promítnutí (`settle`) */
  let committed: CadDoc | null = null;
  /**
   * záložky, do kterých zapsal kterýkoli běh (od otevření aplikace) – prázdnou z nich nový dokument nikdy nepřepíše
   * (5.2 č. 14; prázdná sestava z dřívějšího běhu konzole zůstane)
   */
  const runTabs = new Set<string>();
  /** záložky, které běh založil, a jejich původ (`openInTab({ origin })`) – opakovaný běh je převezme (engine/runs.ts) */
  const madeTabs = new Map<string, RunOrigin>(loadRunTabs());
  /** záložky tohoto běhu (založené nebo převzaté `claimTab`) a záložky, do kterých tento běh zapsal (řádky D) */
  let claimed = new Set<string>();
  let wrote = new Set<string>();
  let generation = 0;
  /** klíč dokumentu jiné otevřené záložky než zobrazené (nový dokument běhu bez záložky mezi nimi není) */
  const background = (k: DocKey) => k !== get().docKey() && get().docTabs().some((t) => t.kind !== "drawing" && get().docKey(t.id) === k);
  const remember = (d: CadDoc, tab: string) => {
    runTabs.add(tab);
    wrote.add(tab);
    if (d.kind !== "assembly") made.set(d.name.toLowerCase(), d);
  };
  const asm: AsmCaches = {
    get generation() {
      return generation || (generation = get().asm.kernelGeneration());
    },
    set generation(g: number) {
      const restarted = generation !== 0 && g !== generation;
      generation = g;
      if (restarted) get().asm.cleared(); // mezipaměti vyprázdnil syncKernelGeneration – 3D okno potřebuje díly znovu
    },
    get cache() {
      return get().asm.cache;
    },
    get geo() {
      return get().asm.geo;
    },
    get faceLists() {
      return get().asm.faceLists;
    },
    get stack() {
      return get().asm.stack();
    },
    set stack(s) {
      get().asm.setStack(s);
    },
    mateStatus: new MirrorMap<Record<string, MateStatus>>((m) => get().asm.setMateStatus(m ?? {}), background),
    clash: new MirrorMap<{ res: Interference[]; at: string; comps?: number }>((c) => get().asm.setClash(c ? { res: c.res, at: c.at, comps: c.comps ?? 0 } : null), background),
  };
  /**
   * Poslední zápis do historie aktivní záložky se promítne až po vykreslení. Přepnutí nebo otevření záložky bere snímek
   * záložek ze stavu PŘED vykreslením – bez počkání by zápis do opuštěné záložky zahodilo (`záložka "B"` hned po úpravě
   * dílu A, opakovaný běh `nový díl "A"` → další dokument), proto se před každým přepnutím počká na jeho promítnutí.
   */
  const settlePending = async () => {
    const d = committed;
    committed = null;
    if (d) settled(await get().settle(() => get().hist().present === d));
  };
  /**
   * `zpět` / `znovu`: krok historie se v aplikaci provede synchronně (`flushSync` v cad-app.tsx – promítne i čekající zápis
   * běhu), takže poslední zápis už nečeká na promítnutí. Bez vynulování by další přepnutí záložky čekalo na dokument, který
   * krok historie právě odvolal, a skončilo ✗ tab.settle-timeout (záložka by se nepřepnula a další příkazy by šly do jiného
   * dokumentu).
   */
  const histMove = (dir: "undo" | "redo", n: number) => {
    const moved = get().histStep(dir, n);
    committed = null;
    return { moved };
  };
  const activate = async (id: string): Promise<CadDoc> => {
    await settlePending();
    get().activateTab(id);
    settled(await get().settle(() => get().tabId() === id));
    return get().hist().present;
  };
  return {
    asm,
    beginRun() {
      made = new Map();
      committed = null;
      claimed = new Set();
      wrote = new Set();
    },
    present: () => get().hist().present,
    commit(d) {
      const g = get();
      g.commit(d);
      remember(d, g.tabId());
      committed = d;
    },
    // konec běhu: další volání API hned za sebou musí vidět poslední zápis (openInTab na svou záložku čeká sám)
    settle: settlePending,
    async openInTab(d, o = {}) {
      await settlePending(); // zápis do opouštěné záložky nejdřív do stavu aplikace (viz `settlePending`)
      const g = get();
      const before = g.tabId();
      // prázdná aktivní záložka jen tehdy, je-li to prázdný díl, do kterého žádný běh nezapsal (úvodní díl aplikace)
      const reuse = o.reuseEmpty !== false && !runTabs.has(before) && isPartDoc(g.hist().present);
      const id = g.openDocInTab(d, { reuse, ...(o.docId ? { docId: o.docId } : {}) });
      remember(d, id);
      claimed.add(id);
      if (o.origin) madeTabs.set(id, o.origin);
      else madeTabs.delete(id); // prázdná úvodní záložka znovu použitá dokumentem, který běh nezaložil
      saveRunTabs(madeTabs);
      settled(
        await get().settle(() => {
          const n = get();
          return n.tabId() === id && n.hist().present.name === d.name && n.docTabs().some((t) => t.id === id);
        }),
      );
      return { id, reused: id === before };
    },
    tabs: () => get().tabList(),
    activate,
    async close(id) {
      await settlePending();
      get().closeTab(id);
      settled(await get().settle(() => get().tabId() !== id && !get().docTabs().some((t) => t.id === id)));
      return get().hist().present;
    },
    undo: (n) => histMove("undo", n),
    redo: (n) => histMove("redo", n),
    history() {
      const h = get().hist();
      return { undo: h.past.length, redo: h.future.length };
    },
    findPart(name) {
      const key = name.toLowerCase();
      return made.get(key) ?? get().docTabs().find((t) => isPart(t) && t.title.toLowerCase() === key)?.hist.present ?? null;
    },
    partNames: () => [...new Set([...[...made.values()].map((x) => x.name), ...get().docTabs().filter(isPart).map((t) => t.title)])],
    listDocs: () => [...[...made.values()].map((x) => ({ title: x.name, doc: x })), ...get().docTabs().filter((t) => t.kind !== "drawing").map((t) => ({ title: t.title, doc: t.hist.present }))],
    freshName: (base) => get().freshName(base),
    docKey: (id) => get().docKey(id),
    docOf: (id) => get().docTabs().find((t) => t.id === id && t.kind !== "drawing")?.hist.present ?? null,
    namedTabs(name, kind) {
      const key = name.trim().toLowerCase();
      return get()
        .docTabs()
        .filter((t) => t.kind === kind && t.title.trim().toLowerCase() === key)
        .map((t) => {
          const origin = madeTabs.get(t.id);
          return { id: t.id, ...(origin ? { origin } : {}), claimed: claimed.has(t.id) };
        });
    },
    async claimTab(id, origin) {
      claimed.add(id);
      madeTabs.set(id, origin);
      saveRunTabs(madeTabs);
      return activate(id);
    },
    runDocKeys: () => [...wrote].map((t) => get().docKey(t)).filter(Boolean),
    save() {
      const tabs = get().docTabs().filter((t) => t.kind !== "drawing");
      const active = Math.max(0, tabs.findIndex((t) => t.id === get().tabId()));
      return new TextEncoder().encode(JSON.stringify({ v: 1, tabs: tabs.map((t) => embedBlobs(t.hist.present)), active }));
    },
  };
}

/** háčky aplikace pro engine (`EngineHost.ui`) a stažení souborů bez dialogu */
export type AppHostDeps = Required<Pick<UiHooks, "openSketchId" | "openDrawing" | "view" | "surfOverlay" | "api" | "clipboard" | "saved" | "selectionNote" | "partsLoaded" | "bomFlat" | "restoreKernel" | "afterRun">> & {
  asmStack(stack: { asm: CadDoc; key: string }[], doc: CadDoc): void;
  motion(sig: MotionSignal): void;
  /** stažení souboru z textových příkazů – vždy bez dialogu (uložit, export, výkres export, pohyb export csv) */
  download(name: string, data: Uint8Array, mime: string): Promise<void> | void;
};

/** hostitel enginu v aplikaci: jádro `cad` (Web Worker), stažení souborů, háčky UI */
export function makeAppHost(kernel: KernelApi, get: () => AppHostDeps): EngineHost {
  const files: FileSink = {
    async write(f) {
      const name = safeFileName(f.name);
      await get().download(name, f.data, f.mime);
      // SHA-256 jako CLI (JSON `files[].sha256` protokolu prohlížeče – engine/run-protocol.ts); stránka bez šifrování
      // (http mimo localhost nemá `crypto.subtle`) soubor stáhne dál, jen bez otisku
      const sha256 = await sha256Hex(f.data).catch(() => "");
      return { name, format: f.format, bytes: f.data.length, sha256, doc: f.doc };
    },
  };
  const ui: UiHooks = {
    openSketchId: () => get().openSketchId(),
    openDrawing: () => get().openDrawing(),
    asmStack: (s, d) => get().asmStack(s, d),
    motion: (sig) => get().motion(sig),
    view: (v) => get().view(v),
    surfOverlay: (r) => get().surfOverlay(r),
    api: (cmd, d) => get().api(cmd, d),
    clipboard: (text) => get().clipboard(text),
    saved: (d) => get().saved(d),
    selectionNote: (f) => get().selectionNote(f),
    partsLoaded: () => get().partsLoaded(),
    bomFlat: () => get().bomFlat(),
    restoreKernel: () => get().restoreKernel(),
    afterRun: () => get().afterRun(),
  };
  // vstupy příkazů (porovnat "ref.step", otevřít "díl.mncad"): soubory přiložené v konzoli / window.mncad.attach
  // předloha PDF (`předloha "výkres.pdf"`): pdf.js z /public/vendor s cestami k písmům a tabulkám znaků
  const pdfjs = async () => {
    const { loadPdfJs, pdfDocOptions } = await import("@/cad/pdfjs");
    const lib = await loadPdfJs();
    const { data: _d, ...docOptions } = pdfDocOptions(new Uint8Array(0));
    void _d;
    return { lib, docOptions };
  };
  return { kernel, files, inputs: appAttachments, ui, pdfjs, now: () => Date.now() };
}
