"use client";

import { cadLocale, getLang, langMeta, missingKeys, tr } from "@/cad/i18n";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Interference } from "@/cad/asm-kernel";
import { apply3, boltStack, bomCsv, emptyAssembly, ejectorPin, eulerXYZ, explodeOffset, guideBush, guidePillar, locatingRing, mirrorComponent, moldBase, partComponent, patternComponent, placementMatrix, rotMatrix, rotationBetween, screwISO4762, sourceKey, transformPoint } from "@/cad/assembly";
import type { MateFaceInfo } from "@/cad/asm-kernel";
import { mateFromPending, measureMateIn, releaseComponent, solveMates, type FaceGeo, type MateStatus } from "@/cad/mates";
import { bodiesAt, isNewBodyMode, nextBodyName } from "@/cad/bodies";
import { makeFromText } from "@/cad/library";
import { cad, isCancelled } from "@/cad/client";
import { applyShrinkage, coolingCircuit, draftAnalysis, draftVertexColors, suggestEjectors, suggestPartingZ, type CoolingParams, type DraftResult, type EjectorSuggestion } from "@/cad/mold";
import { isUnlocked, notifyVault, persistMode, restoreSession, VAULT_EVENT, vaultGet, vaultSet, wipeStoredDocuments } from "@/cad/vault";
import { keyCombo, loadSettings, pushRecent, readRecentDoc, saveSettings, storeRecentDoc, type Settings } from "@/cad/settings";
import { EXAMPLES, FEATURE_LABEL, featureIcon, featureLabel, featureTone, newExtFeature, newFeature, nextName, planeLabel } from "@/cad/defaults";
import { extByTab, getExt, type ExtDef, type ExtTab } from "@/cad/ext/registry";
import { IMPORT_ACCEPT, prepareImport } from "@/cad/formats/import";
import { resolveDoc } from "@/cad/params";
import { sketchToDxf } from "@/cad/sketch";
import { emptyDoc, uid, type AsmComponent, type BuildResult, type CadDoc, type ExportFormat, type Feature, type FeatureType, type Mate, type MateRef, type SketchEntity, type SketchPlane, type Vec3 } from "@/cad/types";
import { AGENT_API_VERSION, AGENT_COMMANDS, docStatusText, parseAgentText, selectEdges, selectFaces, topAt, type AsmStatus, type EdgeLite, type FaceLite } from "@/cad/agent";
import { AGENT_GUIDE } from "@/cad/agent-guide";
import { collectDiagnostics, probeWebGL, type RenderFailure } from "@/cad/diagnostics";
import { openErrorText, openShareLink, parseShareHash, type ParsedShare, type SharePayload } from "@/cad/share";
import { copyText } from "@/lib/clipboard";
import { CAD_LINKS } from "@/content/cad-links";
import { SALES } from "@/content/site";
import { MATERIALS, fmtNum, massKg } from "@/lib/mesh-metrics";
import { cn } from "@/lib/cn";
import { pickSaveTarget, type SavedFile, setDirectDownload, writeSaved } from "@/lib/save-file";
import { saveFile } from "@/lib/save-file";
import { track } from "../analytics";
import { LogoMark } from "../logo";
import { CadIcon, type CadIconName, type Tone } from "./cad-icons";
import { CommandPalette, type Command } from "./command-palette";
import { getExtUi, type ExtActionApi } from "./ext";
import { LibraryDialog } from "./library-dialog";
import { MoldPanel, type DraftSetup, type SurfaceSetup } from "./mold-panel";
import { curvatureColors, wallThickness } from "@/cad/analysis";
import { SettingsDialog } from "./settings-dialog";
import { AgentConsole } from "./agent-console";
import { ShareDialog } from "./share-dialog";
import { Btn, Modal as UiModal } from "./ui";
import { StartScreen } from "./start-screen";
import type { EntityInfo, EntRef, MeasureResult, ShapeSrc } from "@/cad/inspect";
import { bomOf, dissolveSubassembly, flattenLeaves, invPlacementMatrix, makeSubassembly, matrixToPlacement, mul4 } from "./asm-flatten";
import { AsmProps, AsmTree, BomTable, MoldWizard, matePrompt, mateSelection, type PendingMate } from "./asm-panel";
import { ComputeChip, progressLabel } from "./compute-chip";
import { FILTER_LABEL, KIND_LABEL, sameSel, type MeasureGfx, type SelFilter, type SelItem } from "./selection";
import { FEATURE_TONE, Manager } from "./manager";
import { EntityProps, FeatureProps, ParamContext, type FeaturePatch } from "./props";
import { RefPickContext, selToRef, useRefPickEscape, type RefPickTarget, type Want } from "./ref-field";
import type { Ref } from "@/cad/refs";
import { ContextMenu, Dropdown, HudBar, Ribbon, type RGroup, type RMenuEntry } from "./ribbon";
import { Sketcher, setSketchSnap, sketchRibbon, useSketchSnaps, type SketchPatch, type SketchTool, type SketcherHandle } from "./sketcher";
import { ViewportBoundary, ViewportFallback } from "./viewport-fallback";
import { Viewport, type AsmView, type Datum, type DatumGfx, type Gizmo, type DisplayMode, type MouseScheme, type PickMode, type Section, type ViewName, type ViewportHandle } from "./viewport";

const DrawingWorkspace = dynamic(() => import("./drawing-workspace").then((m) => m.DrawingWorkspace), { ssr: false });

const STORE = "mn-cad-doc-v1";
type Hist = { past: CadDoc[]; present: CadDoc; future: CadDoc[] };
/** Záložka dokumentu (díl / sestava / výkres). Výkresová záložka sdílí dokument zdrojové záložky (`srcTabId`). */
type DocTab = { id: string; kind: "part" | "assembly" | "drawing"; title: string; hist: Hist; docId: string; srcTabId?: string };
const TABS_KEY = "mn-cad-tabs-v1";
type Tab = "create" | "sketch" | "surface" | "sheet" | "weld" | "asm" | "tools" | "view" | "drawing" | "data";
type AddType = Exclude<FeatureType, "sketch" | "import" | "pattern" | "ext">;
/** prvky bez geometrie (nezakládají těleso) */
const NO_BODY_TYPES = new Set<FeatureType>(["sketch", "datum", "datumAxis", "datumPoint", "csys"]);

const EXPORTS: { f: ExportFormat; label: string; ext: string; mime: string; hint: string }[] = [
  { f: "step", label: tr("STEP AP214 (.step)"), ext: "step", mime: "application/step", hint: tr("ZW3D, SolidWorks, Inventor, CATIA, Creo, CAM") },
  { f: "brep", label: tr("OpenCascade BREP (.brep)"), ext: "brep", mime: "application/octet-stream", hint: tr("přesná geometrie OCCT") },
  { f: "stl", label: tr("STL (.stl)"), ext: "stl", mime: "model/stl", hint: tr("3D tisk") },
  { f: "3mf", label: tr("3MF (.3mf)"), ext: "3mf", mime: "model/3mf", hint: tr("3D tisk s jednotkami") },
  { f: "obj", label: tr("Wavefront OBJ (.obj)"), ext: "obj", mime: "model/obj", hint: "vizualizace" },
  { f: "glb", label: tr("glTF binární (.glb)"), ext: "glb", mime: "model/gltf-binary", hint: tr("web, AR, prezentace") },
  { f: "wrl", label: tr("VRML (.wrl)"), ext: "wrl", mime: "model/vrml", hint: tr("starší prohlížeče") },
];

const BACKGROUNDS: Record<string, { label: string; css: string; dark?: boolean }> = {
  blue: { label: tr("Modrošedý přechod"), css: "linear-gradient(180deg,#9fb1c4 0%,#d3dce6 52%,#f3f5f8 100%)" },
  light: { label: tr("Světlý"), css: "radial-gradient(ellipse at center,#ffffff 0%,#eef1f4 70%,#e1e6eb 100%)" },
  dark: { label: tr("Grafit"), css: "linear-gradient(180deg,#2a3038 0%,#3b434e 60%,#4b5562 100%)", dark: true },
  white: { label: tr("Bílý (tisk)"), css: "#ffffff" },
};

const COLORS = [
  { c: "#b9c2cc", l: tr("Ocel") },
  { c: "#d6d9dd", l: tr("Hliník") },
  { c: "#c9a46a", l: tr("Mosaz") },
  { c: "#7f8a96", l: tr("Litina") },
  { c: "#4f81bd", l: tr("Modrá") },
  { c: "#e0b24a", l: tr("Žlutá") },
  { c: "#e03930", l: tr("Červená") },
  { c: "#3a3f45", l: tr("Černá") },
];

/** Uložení s dotazem na místo a název (systémový dialog „Uložit jako“, jinak dotaz na název). */
function download(name: string, data: BlobPart | (() => Promise<BlobPart> | BlobPart), type: string) {
  void saveFile(name, data, type).catch((e) => console.warn("Uložení se nezdařilo:", e));
}

function safeName(s: string) {
  return (s || "model").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").slice(0, 60);
}

const PICK_TYPES = new Set<FeatureType>(["fillet", "chamfer", "shell", "hole", "draft"]);

/** klíč geometrie dokumentu (prvky, proměnné, stavy) – stejný klíč = stejné těleso */
const geoKey = (d: CadDoc) => JSON.stringify([d.features, d.variables ?? null, d.bindings ?? null, d.configs ?? null, d.activeConfig ?? null]);

export function CadApp() {
  const [hist, setHist] = useState<Hist>(() => ({ past: [], present: emptyDoc(), future: [] }));
  /** záložky dokumentů; aktivní záložka má aktuální historii v `hist` (do záznamu se ukládá při přepnutí) */
  const [docTabs, setDocTabs] = useState<DocTab[]>([]);
  const [tabId, setTabId] = useState<string>(() => uid());
  const doc = hist.present;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editBase, setEditBase] = useState<CadDoc | null>(null);
  const [sketchId, setSketchId] = useState<string | null>(null);
  const [sketchSel, setSketchSel] = useState<string | null>(null);
  const [tool, setTool] = useState<SketchTool>("line");
  const [snapGrid, setSnapGrid] = useState(true);
  const [planePick, setPlanePick] = useState(false);
  const [tab, setTab] = useState<Tab>("create");
  const [result, setResult] = useState<BuildResult | null>(null);
  const [core, setCore] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);
  const [panels, setPanels] = useState(false);
  const [prefs, setPrefs] = useState<Settings>(loadSettings);
  const [section, setSection] = useState<Section>(null);
  const [showGrid, setShowGrid] = useState(false);
  const [measure, setMeasure] = useState(false);
  // výběr entit, inspektor, měření
  const [selFilter, setSelFilter] = useState<SelFilter>("all");
  const [selection, setSelection] = useState<SelItem[]>([]);
  /** čekající výběr do pole odkazu ve formuláři prvku (bod / hrana / plocha…) */
  const [refPick, setRefPick] = useState<RefPickTarget | null>(null);
  /** kontextová mini lišta u kurzoru po výběru entity */
  const [hud, setHud] = useState<{ x: number; y: number; item: SelItem } | null>(null);
  const lastPtr = useRef({ x: 0, y: 0 });
  const [lastPoint, setLastPoint] = useState<Vec3 | null>(null);
  const [inspect, setInspect] = useState<{ item: SelItem; info: EntityInfo } | null>(null);
  const [inspectOpen, setInspectOpen] = useState(true);
  const [measureSel, setMeasureSel] = useState<SelItem[]>([]);
  const [measureRes, setMeasureRes] = useState<MeasureResult | null>(null);
  const [gizmoOn, setGizmoOn] = useState<{ target: "component" | "body"; id: string; mode: "translate" | "rotate" } | null>(null);
  const [bodyHidden, setBodyHidden] = useState(false);
  const [bodyOpacity, setBodyOpacity] = useState(1);
  const [bomFlat, setBomFlat] = useState(true);
  const [massOpen, setMassOpen] = useState(false);
  const [drawingOpen, setDrawingOpen] = useState(false);
  /** úvodní obrazovka „Nový výkres“: po načtení souboru rovnou otevřít výkres */
  const drawAfterImport = useRef(false);
  const [appMenu, setAppMenu] = useState(false);
  const appMenuRef = useRef<HTMLDivElement>(null);
  /** úzká obrazovka (mobil): záložky dokumentů mají vlastní řádek pod lištou a seznam v dolním listu */
  const narrow = useNarrow();
  const [tabMenu, setTabMenu] = useState(false);
  const tabMenuRef = useRef<HTMLButtonElement>(null);
  const [helpMenu, setHelpMenu] = useState(false);
  /** selhání 3D okna (WebGL): místo pádu chybová obrazovka, zbytek programu funguje; glKey = nový pokus */
  const [glError, setGlError] = useState<RenderFailure | null>(null);
  const [glKey, setGlKey] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);
  /** konzole Textové příkazy (AI agenti, automatizace) */
  const [agentOpen, setAgentOpen] = useState(false);
  /** popisky entit (F1 / E2 / V3 / P1) pro výběr myší bez trefování – AI agenti, automatizace, dotyk */
  const [hintsOn, setHintsOn] = useState(false);
  /** dokument otevřený ze sdíleného odkazu (informační pruh nad pracovní plochou) */
  const [shared, setShared] = useState<{ tabId: string; from?: string; exp: number | null } | null>(null);
  /** sdílený odkaz chráněný heslem – dotaz na heslo */
  const [sharePass, setSharePass] = useState<{ parsed: ParsedShare; value: string; error?: string; busy?: boolean } | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; entries: RMenuEntry[] } | null>(null);
  const [cursor, setCursor] = useState<Vec3 | null>(null);
  // sestavy
  const [asmSel, setAsmSel] = useState<string | null>(null);
  const asmCache = useRef(new Map<string, BuildResult>());
  const [asmVer, setAsmVer] = useState(0);
  const [asmLoading, setAsmLoading] = useState(0);
  const [explode, setExplode] = useState(0);
  const [clashes, setClashes] = useState<Interference[] | null>(null);
  /** kdy a nad kolika komponentami proběhla poslední kontrola kolizí (výsledek zůstane v panelu i ve stavu) */
  const [clashInfo, setClashInfo] = useState<{ at: string; comps: number } | null>(null);
  const [mate, setMate] = useState<PendingMate | null>(null);
  /** plocha, na kterou uživatel najel v seznamu ploch vazby – zvýrazní se v modelu */
  const [mateHover, setMateHover] = useState<SelItem | null>(null);
  const [mateStatus, setMateStatus] = useState<Record<string, MateStatus>>({});
  const [boltPick, setBoltPick] = useState<{ washer: boolean; nut: boolean } | null>(null);
  const mateGeo = useRef(new Map<string, MateFaceInfo>());
  const docRef = useRef<CadDoc>(doc);
  docRef.current = doc;
  const [bomOpen, setBomOpen] = useState(false);
  const [moldOpen, setMoldOpen] = useState(false);
  const [asmStack, setAsmStack] = useState<{ asm: CadDoc; key: string }[]>([]);
  // nastavení, paleta, úvodní obrazovka, formařské nástroje
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState<null | { query?: string }>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [moldTools, setMoldTools] = useState(false);
  const [draftSetup, setDraftSetup] = useState<DraftSetup>({ on: false, pull: [0, 0, 1], minDeg: 1 });
  const [surface, setSurface] = useState<SurfaceSetup>({ mode: "none", limit: 1 });
  const [partingZ, setPartingZ] = useState<{ z: number; perimeter: number } | null>(null);
  const docId = useRef(uid());
  const lastThumb = useRef(0);
  const parentAsm = asmStack.length ? asmStack[asmStack.length - 1] : null;
  const setParentAsm = (v: null) => setAsmStack(v === null ? [] : []);
  const vp = useRef<ViewportHandle>(null);
  const sk = useRef<SketcherHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast((t) => (t === m ? null : t)), 3600);
  };
  const setPref = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    setPrefs((p) => {
      const n = { ...p, [k]: v };
      saveSettings(n);
      return n;
    });
  // přímé stažení bez dialogu (Nastavení → Soubory) – pro automatizaci a AI agenty
  useEffect(() => setDirectDownload(!prefs.askWhereToSave), [prefs.askWhereToSave]);
  const applySettings = (n: Settings) => {
    setPrefs(n);
    saveSettings(n);
    setShowGrid(n.showGrid);
    setSnapGrid(n.snapGrid);
  };

  // ---------- historie ----------
  /** neuložené změny (v režimu „neukládat“ varuje prohlížeč před zavřením karty) */
  const dirty = useRef(false);
  const commit = useCallback((next: CadDoc) => {
    dirty.current = true;
    setHist((h) => ({ past: [...h.past.slice(-80), h.present], present: next, future: [] }));
  }, []);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      const d = histRef.current.present;
      if (persistMode() === "none" && dirty.current && (d.features.length || d.components?.length)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);
  const live = useCallback((next: CadDoc) => setHist((h) => ({ ...h, present: next })), []);
  /** změna nad aktuálním stavem (funkčně) – bezpečné i pro dvě změny v jednom tiku (formulář: hloubka, hned nato název) */
  const commitWith = useCallback((fn: (d: CadDoc) => CadDoc) => {
    dirty.current = true;
    setHist((h) => {
      const next = fn(h.present);
      return next === h.present ? h : { past: [...h.past.slice(-80), h.present], present: next, future: [] };
    });
  }, []);
  const liveWith = useCallback((fn: (d: CadDoc) => CadDoc) => setHist((h) => ({ ...h, present: fn(h.present) })), []);
  const undo = () => setHist((h) => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h));
  const redo = () => setHist((h) => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h));

  const updateFeature = (id: string, patch: FeaturePatch, record = true) => {
    // funkčně nad aktuálním dokumentem: změna hloubky těsně následovaná změnou názvu se nepřepíše zastaralou kopií dokumentu
    (record ? commitWith : liveWith)((d) => ({ ...d, features: d.features.map((f) => (f.id === id ? ({ ...f, ...(typeof patch === "function" ? patch(f) : patch) } as Feature) : f)) }));
  };

  // ---------- záložky dokumentů ----------
  // funkce záložek čtou stav přes refs – jsou volané i ze zpožděných callbacků (setTimeout, nabídky), kde by uzávěr mohl být zastaralý
  const docTabsRef = useRef(docTabs);
  docTabsRef.current = docTabs;
  const tabIdRef = useRef(tabId);
  tabIdRef.current = tabId;
  const histRef = useRef(hist);
  histRef.current = hist;
  /** id záznamu, který drží dokument aktivní záložky (výkres → jeho zdrojová záložka) */
  const docEntryId = (list: DocTab[], id: string) => {
    const t = list.find((x) => x.id === id);
    return t?.kind === "drawing" && t.srcTabId ? t.srcTabId : id;
  };
  /** jediná záložka pro aktuální dokument (před obnovou / bez záznamů) */
  const fallbackTabs = (): DocTab[] => {
    const h = histRef.current;
    return [{ id: tabIdRef.current, kind: h.present.kind === "assembly" ? "assembly" : "part", title: h.present.name, hist: h, docId: docId.current }];
  };
  /** záznamy záložek s uloženou aktuální historií aktivního dokumentu */
  const snapshotTabs = (list: DocTab[]): DocTab[] => {
    const base = list.length ? list : fallbackTabs(); // před první změnou záložek není žádný záznam – aktivní dokument nesmí zmizet
    const h = histRef.current;
    const eid = docEntryId(base, tabIdRef.current);
    return base.map((t) => (t.id === eid ? { ...t, hist: h, docId: docId.current, title: h.present.name, kind: h.present.kind === "assembly" ? "assembly" : t.kind === "drawing" ? "drawing" : "part" } : t));
  };
  const resetUiForDoc = () => {
    setActiveId(null);
    setSketchId(null);
    setSketchSel(null);
    setSelection([]);
    setInspect(null);
    setMeasure(false);
    setMeasureSel([]);
    setMeasureRes(null);
    setAsmSel(null);
    setAsmStack([]);
    setPlanePick(false);
    setGizmoOn(null);
    setCtx(null);
    setHud(null);
  };
  const activateTab = (id: string, list: DocTab[] = docTabsRef.current) => {
    const snap = snapshotTabs(list);
    const target = snap.find((t) => t.id === id);
    if (!target) return;
    const entry = snap.find((t) => t.id === docEntryId(snap, id)) ?? target;
    setDocTabs(snap);
    if (docEntryId(snap, id) !== docEntryId(snap, tabIdRef.current)) {
      setHist(entry.hist);
      docId.current = entry.docId;
    }
    setTabId(id);
    resetUiForDoc();
    setDrawingOpen(target.kind === "drawing");
    setTab(entry.hist.present.kind === "assembly" ? "asm" : "create");
    setTimeout(() => vp.current?.setView("iso"), 400);
  };
  /** otevře dokument: do prázdné aktivní záložky, jinak do nové záložky */
  const openDocInTab = (d: CadDoc, opts: { docId?: string } = {}): string => {
    const kind: DocTab["kind"] = d.kind === "assembly" ? "assembly" : "part";
    const curTabs = docTabsRef.current;
    const curId = tabIdRef.current;
    const curDoc = histRef.current.present;
    const cur = curTabs.find((t) => t.id === curId);
    const reuse = !curDoc.features.length && !curDoc.components?.length && cur?.kind !== "drawing";
    let openedId = curId;
    if (reuse) {
      docId.current = opts.docId ?? uid();
      commit(d);
      setDocTabs((l) => (l.length ? l.map((t) => (t.id === curId ? { ...t, kind, title: d.name, docId: docId.current } : t)) : [{ id: curId, kind, title: d.name, hist: { past: [], present: d, future: [] }, docId: docId.current }]));
    } else {
      const entry: DocTab = { id: uid(), kind, title: d.name, hist: { past: [], present: d, future: [] }, docId: opts.docId ?? uid() };
      setDocTabs([...snapshotTabs(curTabs), entry]);
      setHist(entry.hist);
      docId.current = entry.docId;
      setTabId(entry.id);
      openedId = entry.id;
    }
    resetUiForDoc();
    setDrawingOpen(false);
    setTab(kind === "assembly" ? "asm" : "create");
    setTimeout(() => vp.current?.setView("iso"), 700);
    return openedId;
  };
  const closeTab = (id: string) => {
    if (shared && id === shared.tabId) {
      setShared(null);
      try {
        sessionStorage.removeItem("mn-cad-share");
      } catch {
        /* ignore */
      }
    }
    const all = docTabsRef.current.length ? docTabsRef.current : fallbackTabs();
    const idx = all.findIndex((t) => t.id === id);
    const snap = snapshotTabs(all).filter((t) => t.id !== id && t.srcTabId !== id);
    if (!snap.length) snap.push({ id: uid(), kind: "part", title: tr("Nový díl"), hist: { past: [], present: emptyDoc(), future: [] }, docId: uid() });
    const closingActive = id === tabIdRef.current || !snap.some((t) => t.id === tabIdRef.current);
    setDocTabs(snap);
    if (closingActive) {
      const closed = all.find((t) => t.id === id);
      const next = (closed?.kind === "drawing" && snap.find((t) => t.id === closed.srcTabId)) || snap[Math.min(Math.max(0, idx - 1), snap.length - 1)];
      const entry = snap.find((t) => t.id === docEntryId(snap, next.id)) ?? next;
      setHist(entry.hist);
      docId.current = entry.docId;
      setTabId(next.id);
      resetUiForDoc();
      setDrawingOpen(next.kind === "drawing");
      setTab(entry.hist.present.kind === "assembly" ? "asm" : "create");
    }
  };
  /** výkres jako vlastní záložka (sdílí dokument se zdrojovou záložkou) */
  const openDrawingTab = () => {
    const curTabs = docTabsRef.current;
    const curId = tabIdRef.current;
    const cur = curTabs.find((t) => t.id === curId);
    const srcId = cur?.kind === "drawing" && cur.srcTabId ? cur.srcTabId : curId;
    const existing = curTabs.find((t) => t.kind === "drawing" && t.srcTabId === srcId);
    if (existing) return activateTab(existing.id);
    const base = snapshotTabs(curTabs.length ? curTabs : fallbackTabs()); // stávající záložky zůstávají
    const entry: DocTab = { id: uid(), kind: "drawing", title: tr("Výkres – {0}", histRef.current.present.name), hist: histRef.current, docId: docId.current, srcTabId: srcId };
    setDocTabs([...base, entry]);
    setTabId(entry.id);
    resetUiForDoc();
    setDrawingOpen(true);
  };
  const openDrawingTabRef = useRef(openDrawingTab);
  openDrawingTabRef.current = openDrawingTab;
  /** dokument ze sdíleného odkazu (snímek): nová záložka + informační pruh; nic se neukládá */
  const openShared = (p: SharePayload) => {
    const id = openDocInTab(p.doc);
    setShared({ tabId: id, from: p.from, exp: p.exp });
    setStartOpen(false);
    flash(tr("Otevřen sdílený dokument „{0}“{1}.", p.doc.name, p.from ? ` od ${p.from}` : ""));
    track("cad_share_open");
    if (p.view === "drawing") setTimeout(() => openDrawingTabRef.current(), 1500);
  };
  const openSharedRef = useRef(openShared);
  openSharedRef.current = openShared;
  /**
   * Textové rozhraní (AI agenti, automatizace): provede příkazy / JSON nad otevřeným dokumentem a vrátí protokol
   * + textový stav. Prvky s pravidlem (zaoblit hrany svislé…) se vyhodnotí nad aktuálním tělesem přes jádro.
   */
  const runAgentText = async (text: string): Promise<string> => {
    const prog = parseAgentText(text);
    // Protokol v pořadí řádků vstupu: chyby čtení (řádek 8) nepředbíhají výsledky dřívějších řádků; výsledky stavby a stav až na konci.
    const entries: { line: number; text: string }[] = prog.errors.map((e) => ({ line: e.line, text: tr("✗ řádek {0}: {1}{2}", e.line, e.message, e.text ? ` ← „${e.text}“` : "") }));
    const tail: string[] = [];
    const ordered = () => [...entries].sort((a, b) => a.line - b.line).map((e) => e.text);
    let d: CadDoc = JSON.parse(JSON.stringify(histRef.current.present)) as CadDoc;
    let openNew = false;
    let changed = false;
    /** prvky přidané tímto během – jejich výsledek (✓ / ⚠ / ✗) se vypíše až po stavbě, ne při přidání */
    const added: Feature[] = [];
    const SOLID = new Set(["extrude", "revolve", "box", "cylinder", "sphere", "cone", "tube", "import", "sweep", "loft", "spring", "thicken", "text", "ext"]);
    const hasSolid = () => d.features.some((f) => SOLID.has(f.type) && !f.suppressed);
    const lastSketch = () => [...d.features].reverse().find((f) => f.type === "sketch");
    const lastFeature = () => d.features[d.features.length - 1];
    /** těleso zvolené příkazem „těleso N“ – další prvky pracují s ním (dokud nevznikne nové těleso) */
    let currentBody: string | null = null;
    /** díly vytvořené tímto během (název → dokument) – pro „vložit“ do sestavy dřív, než se záložky propíšou do stavu aplikace */
    const madeDocs = new Map<string, CadDoc>();
    /** zapíše dosavadní změny (před přechodem na jiný dokument v témže vstupu) */
    const flush = () => {
      if (!changed) return;
      if (d.kind !== "assembly") madeDocs.set(d.name.toLowerCase(), d);
      if (openNew) openDocInTab(d);
      else commit(d);
      changed = false;
    };
    /** odkaz na skicu / prvek: id, název (bez ohledu na velikost písmen) nebo `$last` */
    const refId = (v: unknown, what: "sketch" | "feature"): unknown => {
      if (typeof v !== "string" || d.features.some((x) => x.id === v)) return v;
      if (v === "$last") {
        const hit = what === "sketch" ? lastSketch() : lastFeature();
        if (!hit) throw new Error(what === "sketch" ? tr("není žádná skica – nejdřív „skica XY: …“") : tr("není žádný prvek, na který by se pole / zrcadlení vztahovalo"));
        return hit.id;
      }
      const hit = [...d.features].reverse().find((x) => (what === "feature" || x.type === "sketch") && x.name.toLowerCase() === v.toLowerCase());
      if (!hit) throw new Error(tr("„{0}“ v historii není – k dispozici: {1}", v, d.features.filter((x) => what === "feature" || x.type === "sketch").map((x) => x.name).join(", ") || "—"));
      return hit.id;
    };
    const prepare = (f0: Feature): Feature => {
      const f = { ...f0 } as Feature;
      // odkazy názvem (obecný příkaz „prvek“): skici a prvky podle názvu nebo `$last`
      const rec = f as unknown as Record<string, unknown>;
      for (const k of ["sketchId", "profileId", "pathId", "guideId"]) if (k in rec && rec[k] !== "$last") rec[k] = refId(rec[k], "sketch");
      for (const k of ["sketchIds", "profileIds", "guideIds"]) if (Array.isArray(rec[k])) rec[k] = (rec[k] as unknown[]).map((v) => refId(v, "sketch"));
      if ("featureId" in rec && rec.featureId !== "$last") rec.featureId = refId(rec.featureId, "feature");
      if (Array.isArray(rec.featureIds)) rec.featureIds = (rec.featureIds as unknown[]).map((v) => refId(v, "feature"));
      if (f.type === "ext") {
        const data = { ...(f.data ?? {}) } as Record<string, unknown>;
        for (const prm of getExt(f.ext)?.params ?? []) {
          if (prm.kind === "sketch" && data[prm.key]) data[prm.key] = refId(data[prm.key], "sketch");
          else if (prm.kind === "feature" && data[prm.key]) data[prm.key] = refId(data[prm.key], "feature");
          else if (prm.kind === "sketches" && Array.isArray(data[prm.key])) data[prm.key] = (data[prm.key] as unknown[]).map((v) => refId(v, "sketch"));
        }
        (f as { data: Record<string, unknown> }).data = data;
      }
      // více těles: „nové“ = nové těleso s dalším volným názvem; „těleso N“ = cílové těleso dalších prvků
      if (f.body === "$new") f.body = hasSolid() ? nextBodyName(bodiesAt(d).names) : undefined;
      if (f.body) {
        const bs = bodiesAt(d);
        if (bs.started && !bs.names.includes(f.body) && !isNewBodyMode(f)) throw new Error(tr("těleso „{0}“ v dílu není – tělesa: {1}", f.body, bs.names.join(", ")));
        if (isNewBodyMode(f) && !bs.names.includes(f.body)) currentBody = null;
      } else if (currentBody && !NO_BODY_TYPES.has(f.type) && f.type !== "combine" && f.type !== "copyBody") f.body = currentBody;
      const g = f as Feature & { sketchId?: string; featureId?: string; profileId?: string; mode?: string };
      if (g.sketchId === "$last" || g.profileId === "$last") {
        const sk = lastSketch();
        if (!sk) throw new Error(tr("není žádná skica – nejdřív „skica XY: …“"));
        if (g.sketchId === "$last") g.sketchId = sk.id;
        if (g.profileId === "$last") g.profileId = sk.id;
      }
      if (g.featureId === "$last") {
        const lf = lastFeature();
        if (!lf) throw new Error(tr("není žádný prvek, na který by se pole / zrcadlení vztahovalo"));
        g.featureId = lf.id;
      }
      if (g.mode === "$auto" || (g.mode === "add" && !hasSolid())) g.mode = hasSolid() ? "add" : "new";
      if (d.features.some((x) => x.id === g.id)) g.id = uid();
      return g as Feature;
    };
    const build = () => cad.build(d);
    /** plochy a hrany tělesa, na kterém bude prvek pracovat (u více těles jen cílové těleso – je ve výsledku první) */
    const topology = async (body?: string) => {
      // sestavení a inspekce ploch/hran atomicky ve workeru – dřív mohlo mezi build() a inspect() proběhnout sestavení jiné záložky
      const t = await cad.topology(body ? { ...d, activeBody: body } : d);
      if (!t) throw new Error(tr("žádné těleso – nejdřív vytvořte tvar (kvádr, vysunutí…)"));
      const act = t.bodies && t.bodies.length > 1 ? t.bodies[0] : null;
      return act ? { ...t, faces: t.faces.filter((x) => x.index < act.faceCount), edges: t.edges.filter((x) => x.index < act.edgeCount) } : t;
    };
    const lastOp = prog.ops[prog.ops.length - 1];
    try {
    for (const op of prog.ops) {
      const log = { push: (...t: string[]) => void t.forEach((x) => entries.push({ line: op.line, text: x })) };
      try {
        switch (op.k) {
          case "doc": {
            flush();
            const incoming = op.doc.features;
            d = { ...op.doc, features: [] };
            openNew = true;
            changed = true;
            for (const raw of incoming) d.features.push(prepare(raw)); // $last, režim, duplicitní id – prvek po prvku
            log.push(tr("✓ dokument „{0}“ ({1} prvků) – otevře se v nové záložce", d.name, d.features.length));
            break;
          }
          case "new":
            flush();
            currentBody = null;
            d = op.assembly ? emptyAssembly(op.name) : emptyDoc(op.name);
            openNew = true;
            changed = true;
            log.push(tr("✓ {0} „{1}“ – nová záložka", op.assembly ? tr("nová sestava") : tr("nový díl"), op.name));
            break;
          case "meta": {
            d = { ...d, ...op.patch };
            changed = true;
            if (op.patch.materialName !== undefined) {
              const cls = MATERIALS.find((x) => x.id === d.material) ?? MATERIALS[0];
              log.push(tr("✓ materiál „{0}“ = označení do razítka; hustota zůstává podle třídy „{1}“ ({2} g/cm³) – pro jinou hustotu zadejte: materiál {3}", op.patch.materialName, cls.label, cls.density, MATERIALS.map((x) => x.id).join("|")));
            } else if (op.patch.material !== undefined) {
              const cls = MATERIALS.find((x) => x.id === op.patch.material);
              log.push(tr("✓ materiál = {0}", cls ? `${cls.label} (${cls.density} g/cm³)` : op.patch.material));
            } else log.push(`✓ ${Object.entries(op.patch).map(([k, v]) => `${k === "name" ? tr("název") : tr("barva")} = ${v}`).join(", ")}`);
            break;
          }
          case "features":
            for (const raw of op.features) {
              const f = prepare(raw);
              d.features.push(f);
              added.push(f);
              log.push(tr("→ {0} ({1}) přidán – výsledek po výpočtu níže", f.name, f.type));
            }
            changed = true;
            break;
          case "feature": {
            const f = prepare(op.feature);
            if (op.fillTop) {
              const r = await build();
              if (!r.metrics) throw new Error(tr("není těleso, na jehož povrch by se prvek umístil – zadejte i souřadnici z"));
              if (f.type === "hole") {
                // povrch tělesa přímo v místě díry (podle sítě) – deska i vedle vyššího náboje; mimo těleso = obálka + upozornění
                const ai = f.axis === "X" ? 0 : f.axis === "Y" ? 1 : 2;
                const [u, v] = f.axis === "X" ? [f.position[1], f.position[2]] : f.axis === "Y" ? [f.position[0], f.position[2]] : [f.position[0], f.position[1]];
                const h = topAt(r.mesh, f.axis, u, v);
                if (h === null) log.push(tr("! řádek {0}: v místě [{1}; {2}] není povrch tělesa – díra začíná na obálce tělesa ({3})", op.line, u, v, r.metrics.bbox[1][ai]));
                f.position[ai] = h ?? r.metrics.bbox[1][ai];
              } else if (f.type === "text" && f.plane.kind === "base") {
                const h = f.plane.name === "XY" ? topAt(r.mesh, "Z", f.position[0], f.position[1]) : null;
                f.plane.offset = h ?? r.metrics.bbox[1][f.plane.name === "XY" ? 2 : f.plane.name === "XZ" ? 1 : 0];
              }
            }
            d.features.push(f);
            added.push(f);
            changed = true;
            log.push(tr("→ {0} ({1}) přidán – výsledek po výpočtu níže", f.name, f.type));
            break;
          }
          case "entities": {
            const sk = lastSketch();
            if (!sk || sk.type !== "sketch") throw new Error(tr("není žádná skica – nejdřív „skica XY: …“"));
            sk.entities.push(...op.entities);
            changed = true;
            log.push(tr("✓ {0} {1} do skici „{2}“", op.entities.length, op.entities.length === 1 ? "entita" : op.entities.length < 5 ? "entity" : "entit", sk.name));
            break;
          }
          case "body": {
            const bs = bodiesAt(d);
            if (!bs.names.includes(op.name)) throw new Error(tr("těleso „{0}“ v dílu není – tělesa: {1}", op.name, bs.names.join(", ")));
            currentBody = op.name;
            log.push(tr("✓ další prvky pracují s tělesem „{0}“", op.name));
            break;
          }
          case "library": {
            const made = makeFromText(op.query);
            if (!made) throw new Error(tr("normálii „{0}“ knihovna nezná – zkuste např. M8x30, ložisko 6204, pero 8x7x40", op.query));
            if (d.kind === "assembly") {
              d = { ...d, components: [...(d.components ?? []), partComponent(made.doc, { position: op.at ?? [0, 0, 0] }, { group: "Normálie", number: made.doc.props?.number, color: made.doc.color ?? "#b9c2cc" })] };
              changed = true;
              log.push(tr("✓ normálie „{0}“ vložena do sestavy jako komponenta", made.result.designation));
            } else {
              flush();
              currentBody = null;
              d = made.doc;
              openNew = true;
              changed = true;
              log.push(tr("✓ normálie „{0}“ – nová záložka", made.result.designation));
            }
            break;
          }
          case "insert": {
            if (d.kind !== "assembly") throw new Error(tr("vložit: otevřený dokument není sestava – nejdřív „nová sestava“"));
            const key = op.tab.toLowerCase();
            const src = madeDocs.get(key) ?? docTabsRef.current.find((t) => t.kind === "part" && t.title.toLowerCase() === key)?.hist.present;
            if (!src || src.kind === "assembly") throw new Error(tr("díl „{0}“ není mezi otevřenými záložkami – otevřené díly: {1}", op.tab, [...new Set([...madeDocs.values()].map((x) => x.name).concat(docTabsRef.current.filter((t) => t.kind === "part").map((t) => t.title)))].join(", ") || "—"));
            d = { ...d, components: [...(d.components ?? []), partComponent(JSON.parse(JSON.stringify(src)) as CadDoc, { position: op.at, rotation: op.rotation }, op.fixed ? { fixed: true } : {})] };
            changed = true;
            log.push(tr("✓ komponenta „{0}“ vložena do sestavy{1}", src.name, op.fixed ? tr(" (ukotvená)") : ""));
            break;
          }
          case "drawing":
            flush();
            setTimeout(() => openDrawingTabRef.current(), 400);
            log.push(tr("✓ výkres dokumentu se otevře v záložce"));
            break;
          case "select": {
            const f = prepare(op.feature);
            const t = await topology(f.body);
            if (op.into) {
              // obecný prvek: indexy ploch / hran podle pravidla na zadanou cestu v prvku
              const idx = op.into.kind === "faces" ? selectFaces(op.rule, t.faces, t.bbox) : selectEdges(op.rule, t.edges, t.bbox);
              if (!idx.length) throw new Error(op.into.kind === "faces" ? tr("žádná plocha neodpovídá pravidlu „{0}“ (ploch celkem {1})", op.rule.join(" "), t.faces.length) : tr("žádná hrana neodpovídá pravidlu „{0}“ (hran celkem {1})", op.rule.join(" "), t.edges.length));
              const keys = op.into.path.split(".");
              let o = f as unknown as Record<string, unknown>;
              for (const k of keys.slice(0, -1)) o = (o[k] = { ...(o[k] as Record<string, unknown>) }) as Record<string, unknown>;
              o[keys[keys.length - 1]] = idx;
              log.push(tr("→ {0} ({1}) – {2} {3} podle pravidla „{4}“ – výsledek po výpočtu níže", f.name, f.type === "ext" ? f.ext : f.type, idx.length, op.into.kind === "faces" ? tr("ploch") : tr("hran"), op.rule.join(" ")));
            } else if (f.type === "fillet" || f.type === "chamfer") {
              const idx = selectEdges(op.rule, t.edges, t.bbox);
              if (!idx.length) throw new Error(tr("žádná hrana neodpovídá pravidlu „{0}“ (hran celkem {1})", op.rule.join(" "), t.edges.length));
              f.edges = idx;
              log.push(tr("→ {0} ({1}) – {2} hran podle pravidla „{3}“ – výsledek po výpočtu níže", f.name, f.type, idx.length, op.rule.join(" ")));
            } else if (f.type === "shell") {
              const idx = selectFaces(op.rule, t.faces, t.bbox);
              if (!idx.length) throw new Error(tr("žádná plocha neodpovídá pravidlu „{0}“ (ploch celkem {1})", op.rule.join(" "), t.faces.length));
              f.faces = idx;
              log.push(tr("→ {0} (shell) – otevřeno ploch: {1} – výsledek po výpočtu níže", f.name, idx.length));
            } else throw new Error(tr("pravidlo výběru podporují zaoblení, sražení a skořepina"));
            d.features.push(f);
            added.push(f);
            changed = true;
            break;
          }
          case "clash": {
            if (d.kind !== "assembly") throw new Error(tr("kolize: otevřený dokument není sestava"));
            const res = await cad.interference(d);
            const comps = (d.components ?? []).length;
            setClashes(res);
            setClashInfo({ at: new Date().toLocaleTimeString(cadLocale()), comps });
            const name = (cid: string) => d.components?.find((c) => c.id === cid)?.name ?? cid;
            log.push(res.length ? tr("⚠ kolize: {0} – {1}", res.length, res.map((x) => `${name(x.a)} × ${name(x.b)} (${fmtNum(x.volume, 1)} mm³)`).join("; ")) : tr("✓ kolize: žádné ({0} komponent)", comps));
            break;
          }
          case "pop": {
            const f = d.features.pop();
            changed = changed || !!f;
            log.push(f ? tr("✓ odstraněn prvek „{0}“", f.name) : tr("✗ není co odstranit"));
            break;
          }
          case "view":
            vp.current?.setView(op.view as ViewName);
            log.push(tr("✓ pohled {0}", op.view));
            break;
          case "status": {
            // „stav“ na konci vstupu vypíše až závěrečný stav (jednou); uprostřed vstupu stav v tom okamžiku
            if (op === lastOp) break;
            const r = await build();
            log.push(docStatusText(d, r, openNew ? undefined : asmStatusRef.current()));
            break;
          }
        }
      } catch (e) {
        if (isCancelled(e)) throw e;
        log.push(tr("✗ řádek {0}: {1}", op.line, (e as Error).message));
      }
    }
    // Ověřovací stavba PŘED zápisem do dokumentu: zrušený výpočet tak dokument vůbec nezmění. Aplikace pak tentýž dokument
    // staví znovu už z mezipaměti jádra (bez výpočtu).
    const tBuild = Date.now();
    const res = await build().catch((e) => {
      if (isCancelled(e)) throw e;
      return null;
    });
    if (changed) {
      if (openNew) openDocInTab(d);
      else commit(d);
      setStartOpen(false);
      track("cad_agent_run");
    }
    if (res) {
      // výsledek až po výpočtu: ✓ = platné těleso a operace se projevila, ⚠ = zpracováno s výhradou, ✗ = selhalo; u delších prvků čas výpočtu
      const st = new Map(res.status.map((s) => [s.id, s]));
      const addedIds = new Set(added.map((f) => f.id));
      const took = (ms?: number) => (ms !== undefined && ms >= 100 ? ` · ${fmtNum(ms / 1000, 1)} s` : "");
      for (const f of added) {
        const s = st.get(f.id);
        tail.push(s?.ok === false ? `✗ ${f.name} (${f.type}): ${s.error ?? "chyba stavby"}` : s?.warning ? `⚠ ${f.name} (${f.type}): ${s.warning}${took(s.ms)}` : `✓ ${f.name} (${f.type})${took(s?.ms)}`);
      }
      const bad = d.features.filter((f) => !addedIds.has(f.id) && st.get(f.id)?.ok === false);
      for (const f of bad) tail.push(`✗ ${f.name}: ${st.get(f.id)?.error ?? "chyba stavby"}`);
      const total = Date.now() - tBuild;
      if (total >= 2000) tail.push(tr("Výpočet modelu: {0} s", fmtNum(total / 1000, 1)));
    } else if (added.length) tail.push(tr("✗ stavba selhala – prvky {0} nebyly ověřeny", added.map((f) => f.name).join(", ")));
    tail.push("", docStatusText(d, res, openNew ? undefined : asmStatusRef.current()));
    return [...ordered(), ...tail].join("\n");
    } catch (e) {
      if (!isCancelled(e)) throw e;
      // zrušeno tlačítkem Zrušit: nic se nezapsalo; jádro se znovu připraví nad dosavadním dokumentem
      restoreKernelRef.current();
      return [...ordered(), tr("✗ Výpočet zrušen – dokument zůstal beze změny."), "", docStatusText(histRef.current.present, null, asmStatusRef.current())].join("\n");
    }
  };
  /** po zrušeném výpočtu mimo běžnou stavbu (konzole, export, výkres) znovu postaví otevřený dokument, aby jádro mělo těleso */
  const restoreKernelRef = useRef<() => void>(() => undefined);
  const cancelRef = useRef<() => void>(() => undefined);
  const runAgentRef = useRef(runAgentText);
  runAgentRef.current = runAgentText;
  const agentStatus = async () => docStatusText(histRef.current.present, await cad.build(histRef.current.present).catch(() => null), asmStatusRef.current());
  /** diagnostika prostředí pro podporu (bez dat dokumentu) do schránky */
  const copyDiagnostics = async () => {
    const ok = await copyText(collectDiagnostics({ error: glError?.error ?? null, probe: glError?.probe ?? probeWebGL(), core, lost: glError?.lost }));
    flash(ok ? tr("Diagnostika zkopírována do schránky – vložte ji do e-mailu pro podporu.") : tr("Kopírování se nezdařilo."));
  };
  const unlockShared = async () => {
    if (!sharePass || sharePass.busy) return;
    setSharePass({ ...sharePass, busy: true, error: undefined });
    const r = await openShareLink(sharePass.parsed, sharePass.value);
    if (r.ok) {
      setSharePass(null);
      openShared(r.payload);
    } else setSharePass({ ...sharePass, busy: false, error: openErrorText(r.reason, r.exp) });
  };
  // rozložení záložek uložit i při jejich změně (ne jen při změně dokumentu)
  useEffect(() => {
    if (!loaded.current || !docTabs.length || persistMode() !== "encrypted" || !isUnlocked()) return;
    void vaultSet(TABS_KEY, JSON.stringify({ active: tabId, tabs: docTabs.map(({ id, kind, title, docId: did, srcTabId }) => ({ id, kind, title: id === tabId ? doc.name : title, docId: id === docEntryId(docTabs, tabId) ? docId.current : did, srcTabId })) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docTabs, tabId]);
  const tabStrip: DocTab[] = (docTabs.length ? docTabs : fallbackTabs()).map((t) =>
    t.id === tabId ? { ...t, title: t.kind === "drawing" ? tr("Výkres – {0}", doc.name) : doc.name } : t,
  );

  // ---------- načtení / autosave ----------
  useEffect(() => {
    cad.setLang(getLang()); // hlášky jádra a texty výkresu ve stejném jazyce jako rozhraní
    cad.init().then(
      () => setCore("ready"),
      () => setCore("error"),
    );
    const restore = async () => {
      // ochrana dokumentace (NDA): v režimu „neukládat“ se nic neobnovuje a dřívější uložené dokumenty se smažou
      if (persistMode() === "none") {
        wipeStoredDocuments();
        return;
      }
      if (!isUnlocked() && !(await restoreSession())) return; // zamčeno – odemkne se z úvodní obrazovky / nastavení
      const raw = await vaultGet(STORE);
      const d = raw ? (JSON.parse(raw) as CadDoc) : null;
      const present = d?.app === "mnastrojarna-cad" && Array.isArray(d.features) ? d : emptyDoc();
      setHist({ past: [], present, future: [] });
      // obnova záložek z minulé návštěvy (dokumenty jsou uložené v nedávných souborech)
      try {
        const meta = JSON.parse((await vaultGet(TABS_KEY)) ?? "null") as { active: string; tabs: Omit<DocTab, "hist">[] } | null;
        if (meta?.tabs?.length) {
          const list: DocTab[] = [];
          for (const t of meta.tabs) {
            const isActive = t.id === meta.active || (t.kind === "drawing" && t.srcTabId === docEntryId(meta.tabs as DocTab[], meta.active));
            if (t.id === docEntryId(meta.tabs as DocTab[], meta.active)) list.push({ ...t, hist: { past: [], present, future: [] } });
            else if (t.kind === "drawing") {
              if (meta.tabs.some((x) => x.id === t.srcTabId)) list.push({ ...t, hist: { past: [], present, future: [] } });
            } else {
              const json = await readRecentDoc(t.docId);
              // prázdné záložky se neukládají – obnoví se jako prázdný díl / sestava se stejným názvem
              const pd = json ? (JSON.parse(json) as CadDoc) : t.kind === "assembly" ? emptyAssembly(t.title) : emptyDoc(t.title);
              list.push({ ...t, hist: { past: [], present: pd, future: [] } });
            }
            void isActive;
          }
          const act = list.find((t) => t.id === meta.active) ?? list[0];
          if (act) {
            setDocTabs(list);
            setTabId(act.id);
            const entry = list.find((t) => t.id === docEntryId(list, act.id));
            if (entry) docId.current = entry.docId;
            if (act.kind === "drawing") setDrawingOpen(true);
          }
        }
      } catch {
        /* bez obnovy záložek */
      }
    };
    restore()
      .catch(() => setHist({ past: [], present: emptyDoc(), future: [] }))
      .finally(() => {
        loaded.current = true;
        // sdílený odkaz (#s=… / #r=…): část za # odložil skript stránky do sessionStorage a z adresy ji odstranil
        // (app/(cs)/cad/page.tsx) – dokument pod NDA nesmí zůstat v historii prohlížeče ani jít do měření návštěvnosti
        let hash = "";
        try {
          hash = sessionStorage.getItem("mn-cad-share") || location.hash;
        } catch {
          hash = location.hash;
        }
        const parsed = parseShareHash(hash);
        if (!parsed) return;
        if (location.hash) history.replaceState(null, "", location.pathname + location.search);
        void openShareLink(parsed).then((r) => {
          if (r.ok) openSharedRef.current(r.payload);
          else if (r.reason === "password") setSharePass({ parsed, value: "" });
          else setNotice({ title: tr("Sdílený odkaz nelze otevřít"), body: openErrorText(r.reason, r.exp) });
        });
      });
    // odemčení / vypnutí úložiště z úvodní obrazovky nebo nastavení
    const onVault = () => {
      if (persistMode() === "none") return;
      if (isUnlocked()) void restore();
    };
    window.addEventListener(VAULT_EVENT, onVault);
    loaded.current = true;
    try {
      if (loadSettings().startScreen && !sessionStorage.getItem("mn-cad-started")) setStartOpen(true);
      sessionStorage.setItem("mn-cad-started", "1");
    } catch {
      /* ignore */
    }
    track("cad_open");
    // JavaScript API pro automatizaci a AI agenty (Playwright, rozšíření prohlížeče…)
    window.mncad = {
      version: AGENT_API_VERSION,
      lang: getLang(),
      missing: () => missingKeys(),
      guide: () => AGENT_GUIDE,
      commands: () => AGENT_COMMANDS.map((c) => c.cmd),
      run: (text) => runAgentRef.current(text),
      getDocument: () => JSON.parse(JSON.stringify(histRef.current.present)) as CadDoc,
      setDocument: (doc) => runAgentRef.current(typeof doc === "string" ? doc : JSON.stringify(doc)),
      status: async () => docStatusText(histRef.current.present, await cad.build(histRef.current.present).catch(() => null), asmStatusRef.current()),
      openConsole: () => setAgentOpen(true),
      progress: () => {
        const p = cad.progress();
        return p ? { label: progressLabel(p), op: p.op, phase: p.phase, index: p.index, total: p.total, name: p.name, seconds: (Date.now() - p.startedAt) / 1000 } : null;
      },
      cancel: () => {
        const running = cad.busy();
        cancelRef.current();
        return running;
      },
      hints: (on) => {
        if (on !== undefined) setHintsOn(on);
        return sk.current?.hintList() ?? vp.current?.hintList() ?? [];
      },
      clickHint: (id, additive) => sk.current?.clickHint(id, additive) ?? vp.current?.clickHint(id, additive) ?? false,
      exportFile: async (format) => {
        const d = histRef.current.present;
        const toB64 = (u8: Uint8Array) => {
          let b = "";
          for (let i = 0; i < u8.length; i += 0x8000) b += String.fromCharCode(...u8.subarray(i, i + 0x8000));
          return btoa(b);
        };
        if (format === "mncad") {
          const u8 = new TextEncoder().encode(JSON.stringify(d, null, 1));
          return { name: `${safeName(d.name)}.mncad`, mime: "application/json", bytes: u8.length, base64: toB64(u8) };
        }
        const meta = EXPORTS.find((e) => e.f === format);
        if (!meta) throw new Error(tr("Neznámý formát „{0}“ – step, stl, brep, obj, glb, 3mf, wrl, mncad.", format));
        const buf = await cad.exportFile(d, format);
        return { name: `${safeName(d.name)}.${meta.ext}`, mime: meta.mime, bytes: buf.byteLength, base64: toB64(new Uint8Array(buf)) };
      },
    };
    return () => {
      window.removeEventListener(VAULT_EVENT, onVault);
      delete window.mncad;
    };
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => {
      try {
        // ochrana dokumentace: bez zapnutého šifrovaného úložiště se do prohlížeče nic nezapisuje
        if (persistMode() !== "encrypted" || !isUnlocked()) return;
        const json = JSON.stringify(doc);
        void vaultSet(STORE, json);
        const strip: DocTab[] = docTabs.length ? docTabs : fallbackTabs();
        void vaultSet(TABS_KEY, JSON.stringify({ active: tabId, tabs: strip.map(({ id, kind, title, docId: did, srcTabId }) => ({ id, kind, title: id === tabId ? doc.name : title, docId: id === docEntryId(strip, tabId) ? docId.current : did, srcTabId })) }));
        if (doc.features.length || doc.components?.length) {
          void storeRecentDoc(docId.current, json);
          const entry = { id: docId.current, name: doc.name, kind: (doc.kind === "assembly" ? "assembly" : "part") as "assembly" | "part", at: Date.now(), features: doc.kind === "assembly" ? (doc.components?.length ?? 0) : doc.features.length };
          const limit = loadSettings().recentLimit;
          // náhled nejvýš jednou za 10 s (snímek 3D okna zmenšený na 160×120)
          if (Date.now() - lastThumb.current > 10_000 && vp.current) {
            lastThumb.current = Date.now();
            const snap = vp.current.snapshot();
            if (snap) thumbnail(snap).then((thumb) => pushRecent({ ...entry, thumb }, limit)).catch(() => pushRecent(entry, limit));
            else void pushRecent(entry, limit);
          } else void pushRecent(entry, limit);
        }
      } catch {
        /* příliš velké / soukromý režim */
      }
    }, 600);
    return () => clearTimeout(t);
  }, [doc]);

  // ---------- přestavba modelu ----------
  const active = doc.features.find((f) => f.id === activeId) ?? null;
  const activeIndex = active ? doc.features.indexOf(active) : -1;
  const rollback = !!active && (PICK_TYPES.has(active.type) || (active.type === "ext" && !!getExt(active.ext)?.rollback));
  const buildDocView = useMemo<CadDoc>(() => {
    if (sketchId) {
      const i = doc.features.findIndex((f) => f.id === sketchId);
      return { ...doc, features: doc.features.slice(0, i) };
    }
    if (rollback) return { ...doc, features: doc.features.slice(0, activeIndex) };
    return doc;
  }, [doc, sketchId, rollback, activeIndex]);

  const inflight = useRef(false);
  const queued = useRef<CadDoc | null>(null);
  /** klíč geometrie naposledy úspěšně postaveného dokumentu – podle něj se po zrušení výpočtu pozná, že čeká jen poslední změna */
  const builtKey = useRef<string | null>(null);
  /** model není přepočítaný (výpočet zrušen a nebylo co vrátit) – stavový řádek nabídne nový výpočet */
  const [stale, setStale] = useState(false);
  const runBuild = useCallback(async (d: CadDoc) => {
    if (inflight.current) {
      queued.current = d;
      return;
    }
    inflight.current = true;
    setBusy(true);
    try {
      const res = await cad.build(d);
      setResult(res);
      setStale(false);
      builtKey.current = geoKey(d);
    } catch (e) {
      if (isCancelled(e)) {
        queued.current = null;
        // Zrušit = vrátit dokument do stavu před výpočtem: čeká-li na výpočet jen poslední změna, vrátí se zpět (Ctrl+Y ji obnoví);
        // jinak (otevřený soubor, návrat v historii) zůstane dokument tak, jak je, a model se přepočítá až na pokyn.
        const h = histRef.current;
        // naposledy úspěšně postavený stav v historii Zpět (úprava pole může zapsat víc kroků – hledá se několik kroků zpět)
        let at = -1;
        // (stavěný dokument se porovnává obsahem – potvrzení pole klávesou Enter zapíše stejný stav podruhé jako nový objekt)
        if (builtKey.current !== null && (h.present === d || geoKey(h.present) === geoKey(d))) for (let j = h.past.length - 1; j >= Math.max(0, h.past.length - 8) && at < 0; j--) if (geoKey(h.past[j]) === builtKey.current) at = j;
        if (at >= 0) {
          setHist({ past: h.past.slice(0, at), present: h.past[at], future: [...h.past.slice(at + 1), h.present, ...h.future] });
          flash(tr("Výpočet zrušen – poslední změna je vrácena (Ctrl+Y ji obnoví)."));
        } else {
          setStale(true);
          flash(tr("Výpočet zrušen – model není přepočítaný. Upravte nebo potlačte náročný prvek, nebo spusťte výpočet znovu kliknutím na stav jádra."));
        }
      } else flash((e as Error).message);
    } finally {
      inflight.current = false;
      setBusy(false);
      if (queued.current) {
        const q = queued.current;
        queued.current = null;
        runBuild(q);
      }
    }
  }, []);
  restoreKernelRef.current = () => {
    if (buildDocView.kind !== "assembly") void runBuild(buildDocView);
  };
  /** tlačítko Zrušit u běžícího výpočtu: ukončí jádro; co se stane s dokumentem, řeší ten, kdo výpočet spustil */
  const cancelCompute = useCallback(() => {
    const wasBuild = inflight.current;
    if (!cad.cancel()) return;
    // výpočet spuštěný jinde než stavbou modelu (export, výkres, kolize): jádro přišlo o těleso → připravit ho znovu
    if (!wasBuild) setTimeout(() => restoreKernelRef.current(), 200);
  }, []);
  cancelRef.current = cancelCompute;
  const isAsm = doc.kind === "assembly";
  useEffect(() => {
    if (core !== "ready") return;
    if (buildDocView.kind === "assembly") {
      setResult(null);
      return;
    }
    const t = setTimeout(() => runBuild(buildDocView), 120);
    return () => clearTimeout(t);
  }, [buildDocView, core, runBuild]);

  const resolved = useMemo(() => resolveDoc(doc), [doc]);
  // asociativní roviny skic a pomocných rovin: po stavbě promítnout vyřešené roviny do dokumentu (bez záznamu do historie)
  useEffect(() => {
    const planes = result?.resolved?.planes;
    const dts = result?.resolved?.datums;
    if (!planes && !dts) return;
    const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
    let changed = false;
    const features = doc.features.map((f) => {
      if (f.type === "sketch" && planes?.[f.id]) {
        const np = planes[f.id];
        const op = f.plane;
        const eq = np.kind === "base" && op.kind === "base" ? np.name === op.name && Math.abs(np.offset - op.offset) < 1e-6 : np.kind === "custom" && op.kind === "custom" ? same(np.origin, op.origin) && same(np.normal, op.normal) && same(np.xDir, op.xDir) : false;
        if (!eq) {
          changed = true;
          return { ...f, plane: np };
        }
      }
      if (f.type === "datum" && dts?.[f.id]) {
        const d = dts[f.id];
        if (!same(f.origin, d.origin) || !same(f.normal, d.normal) || !same(f.xDir, d.xDir)) {
          changed = true;
          return { ...f, origin: d.origin, normal: d.normal, xDir: d.xDir };
        }
      }
      return f;
    });
    if (changed) live({ ...doc, features });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  // ---------- sestava: sítě dílů (mezipaměť podle obsahu) ----------
  const leaves = useMemo(() => (isAsm ? flattenLeaves(doc) : []), [isAsm, doc]);
  const compKeys = useMemo(() => new Map(leaves.map((l) => [l.id, l.key])), [leaves]);
  useEffect(() => {
    if (core !== "ready" || !isAsm) return;
    const need = new Map<string, AsmComponent["source"]>();
    for (const l of leaves) if (!asmCache.current.has(l.key)) need.set(l.key, l.comp.source);
    if (!need.size) return;
    let alive = true;
    setAsmLoading((n) => n + 1);
    cad
      .asmParts([...need.entries()].map(([key, source]) => ({ key, source })))
      .then((res) => {
        for (const r of res) asmCache.current.set(r.key, r.result);
        if (alive) setAsmVer((v) => v + 1);
      })
      .catch((e) => flash((e as Error).message))
      .finally(() => setAsmLoading((n) => n - 1));
    return () => {
      alive = false;
    };
  }, [leaves, core, isAsm]);

  const asmViews = useMemo<AsmView[]>(() => {
    if (!isAsm) return [];
    const comps = leaves.filter((l) => !l.hidden);
    const centers = new Map<string, Vec3>();
    for (const l of comps) {
      const r = asmCache.current.get(l.key);
      const b = r?.metrics?.bbox;
      if (b) centers.set(l.id, transformPoint(matrixToPlacement(l.matrix), [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2, (b[0][2] + b[1][2]) / 2]));
    }
    const all = [...centers.values()];
    const mid: Vec3 = all.length ? ([0, 1, 2].map((k) => all.reduce((s, v) => s + v[k], 0) / all.length) as Vec3) : [0, 0, 0];
    const clashIds = new Set((clashes ?? []).flatMap((x) => [x.a, x.b]));
    const out: AsmView[] = [];
    for (const l of comps) {
      const r = asmCache.current.get(l.key);
      if (!r?.mesh) continue;
      const off = explode && centers.has(l.id) ? explodeOffset(mid, centers.get(l.id)!, explode, "Z") : [0, 0, 0];
      const m = [...l.matrix];
      m[12] += off[0];
      m[13] += off[1];
      m[14] += off[2];
      const top = (doc.components ?? []).find((c) => c.id === l.topId);
      out.push({
        id: l.id,
        topId: l.topId,
        key: l.key,
        mesh: r.mesh,
        vertices: r.vertices,
        matrix: m,
        color: l.comp.color ?? top?.color ?? "#b9c2cc",
        selected: l.topId === asmSel || l.topId === mate?.compId,
        clash: clashIds.has(l.topId) || clashIds.has(l.id),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAsm, leaves, asmVer, explode, asmSel, mate, clashes]);

  const asmPartInfo = useCallback(
    (c: AsmComponent) => {
      const r = asmCache.current.get(sourceKey(c.source));
      const matId = c.source.kind === "part" ? c.source.doc.material : (c.material ?? "ocel");
      const mt = MATERIALS.find((x) => x.id === matId);
      // do kusovníku jde označení materiálu dílu (razítko, např. „TEST – 1.2311“), třída (Ocel) jen když označení chybí
      const label = c.source.kind === "part" && c.source.doc.materialName?.trim() ? c.source.doc.materialName.trim() : (mt?.label ?? matId).split(" – ")[0];
      return { material: label, massKg: r?.metrics ? massKg(r.metrics.volume, mt?.density ?? 7.85) : undefined };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [asmVer],
  );
  const bom = useMemo(() => (isAsm ? bomOf(doc, bomFlat, asmPartInfo) : []), [isAsm, doc, asmPartInfo, bomFlat]);

  const setComp = (id: string, patch: Partial<AsmComponent>) => commit({ ...doc, components: (doc.components ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const insertComponent = (c: AsmComponent) => {
    const base = isAsm ? doc : emptyAssembly();
    commit({ ...base, components: [...(base.components ?? []), c] });
    setAsmSel(c.id);
    setTab("asm");
    setClashes(null);
  };
  const insertPart = (d: CadDoc, group = "Normálie") => {
    const b = vp.current?.bounds();
    insertComponent(partComponent(d, { position: b && (doc.components?.length ?? 0) > 0 ? [Math.round(b.center[0] + b.radius * 1.2), 0, 0] : [0, 0, 0] }, { group, number: d.props?.number, color: d.color ?? "#b9c2cc" }));
  };
  const editPartInContext = (c: AsmComponent) => {
    if (c.source.kind === "file") return flash(tr("Importovaný soubor nelze upravovat historií – lze jen umístit."));
    setAsmStack((st) => [...st, { asm: doc, key: sourceKey(c.source) }]);
    commit(c.source.kind === "asm" ? { ...c.source.doc, kind: "assembly" } : { ...c.source.doc, kind: "part" });
    setAsmSel(null);
    setTab("create");
    setTimeout(() => vp.current?.setView("iso"), 700);
  };
  const backToAssembly = () => {
    if (!parentAsm) return;
    const sub = doc.kind === "assembly";
    const comps = (parentAsm.asm.components ?? []).map((c) =>
      c.source.kind !== "file" && sourceKey(c.source) === parentAsm.key ? { ...c, source: sub ? { kind: "asm" as const, doc: { ...doc } } : { kind: "part" as const, doc: { ...doc, kind: "part" as const } } } : c,
    );
    commit({ ...parentAsm.asm, components: comps });
    setAsmStack((st) => st.slice(0, -1));
    setActiveId(null);
    setSketchId(null);
    setTab("asm");
  };
  const compMenu = (c: AsmComponent): RMenuEntry[] => [
    { id: "edit", label: tr("Upravit díl (v kontextu)"), icon: "edit", disabled: c.source.kind !== "part", onClick: () => editPartInContext(c) },
    { id: "hide", label: c.hidden ? tr("Zobrazit") : tr("Skrýt"), icon: "eye", onClick: () => setComp(c.id, { hidden: !c.hidden }) },
    { id: "iso", label: tr("Izolovat (skrýt ostatní)"), icon: "eye", onClick: () => commit({ ...doc, components: (doc.components ?? []).map((x) => ({ ...x, hidden: x.id !== c.id })) }) },
    { id: "all", label: tr("Zobrazit vše"), icon: "eye", onClick: () => commit({ ...doc, components: (doc.components ?? []).map((x) => ({ ...x, hidden: false })) }) },
    { id: "dup", label: tr("Duplikovat (+ posun X)"), icon: "copy", onClick: () => insertComponent({ ...structuredClone(c), id: uid(), placement: { ...c.placement, position: [c.placement.position[0] + 50, c.placement.position[1], c.placement.position[2]] } }) },
    { id: "fix", label: c.fixed ? tr("Uvolnit") : tr("Ukotvit"), icon: "lock", onClick: () => (c.fixed ? commit(releaseComponent(doc, c.id)) : setComp(c.id, { fixed: true })) },
    { divider: true },
    { id: "mate", label: tr("Vazba Kontakt…"), icon: "datum", tone: "ref", onClick: () => startMate(c.id, "mate") },
    { id: "export", label: tr("Uložit díl (.mncad)"), icon: "save", disabled: c.source.kind !== "part", onClick: () => c.source.kind === "part" && download(`${safeName(c.name)}.mncad`, JSON.stringify(c.source.doc, null, 1), "application/json") },
    { divider: true },
    { id: "del", label: tr("Odebrat ze sestavy"), icon: "trash", tone: "cut", kbd: "Del", onClick: () => { commit({ ...doc, components: (doc.components ?? []).filter((x) => x.id !== c.id) }); setAsmSel(null); } },
  ];
  const startMate = (compId: string, mode: PendingMate["mode"]) => {
    const c = doc.components?.find((x) => x.id === compId);
    if (c?.fixed && mode !== "dir") return flash(tr("Komponenta je ukotvená – nejdřív ji uvolněte."));
    setAsmSel(compId);
    setBoltPick(null);
    setMate((m) => (m?.mode === mode && m.compId === compId ? null : { mode, compId }));
    setMeasure(false);
  };
  // ---------- trvalé vazby: geometrie ploch a řešič ----------
  const leafOf = (ref: MateRef, d: CadDoc) => {
    const ls = isAsm && d === doc ? leaves : flattenLeaves(d);
    return ls.find((l) => l.id === (ref.leaf ?? ref.compId)) ?? null;
  };
  /** geometrie plochy v souřadnicích komponenty nejvyšší úrovně (nezávislá na jejím umístění) */
  const geoProvider = (d: CadDoc) => (ref: MateRef): FaceGeo | null => {
    const leaf = leafOf(ref, d);
    if (!leaf || ref.face < 0) return null;
    const info = mateGeo.current.get(`${leaf.key}:${ref.face}`);
    if (!info || info.kind === "other") return null;
    const top = d.components?.find((c) => c.id === ref.compId);
    if (!top) return null;
    const relPl = matrixToPlacement(mul4(invPlacementMatrix(top.placement), leaf.matrix));
    return { kind: info.kind, origin: transformPoint(relPl, info.origin), normal: apply3(rotMatrix(relPl.rotation), info.normal), radius: info.radius };
  };
  /** doplní chybějící geometrii ploch (a indexy válcových ploch u normálií) – async přes worker */
  const ensureMateGeo = async (d: CadDoc): Promise<Mate[]> => {
    const mates = (d.mates ?? []).map((m) => ({ ...m, a: { ...m.a }, b: { ...m.b } }));
    for (const m of mates) {
      for (const ref of [m.a, m.b]) {
        const leaf = leafOf(ref, d);
        if (!leaf) continue;
        if (ref.face < 0 && ref.radius) {
          try {
            const idx = await cad.cylFace(leaf.key, ref.radius);
            if (idx >= 0) ref.face = idx;
          } catch {
            /* díl se ještě staví */
          }
        }
        if (ref.face < 0) continue;
        const key = `${leaf.key}:${ref.face}`;
        if (!mateGeo.current.has(key)) {
          try {
            const info = await cad.mateFace(leaf.key, ref.face);
            if (info) mateGeo.current.set(key, info);
          } catch {
            /* díl se ještě staví */
          }
        }
      }
    }
    return mates;
  };
  const resolveMates = async (d: CadDoc, anchorId?: string | null) => {
    if (d.kind !== "assembly" || !d.mates?.length) {
      setMateStatus({});
      return;
    }
    const mates = await ensureMateGeo(d);
    const withMates = { ...d, mates };
    const r = solveMates(withMates, geoProvider(withMates), anchorId);
    setMateStatus(r.status);
    const matesChanged = JSON.stringify(mates) !== JSON.stringify(d.mates);
    if (!r.moved.length && !matesChanged) return;
    // aplikovat na aktuální dokument (uživatel mohl mezitím pokračovat) – funkčně nad nejnovějším stavem: `docRef` se obnoví až při
    // vykreslení, takže hned po commit() mimo obsluhu události (výběr plochy přes worker) by vrátil dokument ještě bez nové vazby a ta by se ztratila
    const byId = new Map(r.components.map((c) => [c.id, c.placement]));
    liveWith((cur) => (cur.kind !== "assembly" ? cur : { ...cur, mates: matesChanged ? mates : cur.mates, components: (cur.components ?? []).map((c) => (r.moved.includes(c.id) && byId.has(c.id) ? { ...c, placement: byId.get(c.id)! } : c)) }));
  };
  /** vazba: leafId = list (díl), face = index plochy v dílu */
  const onMateFace = async (leafId: string, face: number) => {
    if (!mate || face < 0) return;
    const leaf = leaves.find((l) => l.id === leafId);
    if (!leaf) return;
    let info: MateFaceInfo | null = null;
    try {
      info = await cad.mateFace(leaf.key, face);
    } catch {
      info = null;
    }
    if (!info) return flash(tr("Plochu se nepodařilo načíst."));
    if (mate.mode === "dir") {
      // směr pole komponenty z plochy v modelu: normála roviny / osa válce ve světových souřadnicích – převezme si ho panel komponenty
      if (info.kind === "other") return flash(tr("Směr lze převzít jen z rovinné nebo válcové plochy."));
      setMate({ ...mate, dir: apply3(rotMatrix(matrixToPlacement(leaf.matrix).rotation), info.normal) });
      return;
    }
    const needCyl = mate.mode === "concentric";
    if (needCyl && info.kind !== "cylinder") return flash(tr("Souosost potřebuje válcovou nebo kuželovou plochu (díra, čep, šroub)."));
    if (!needCyl && info.kind !== "plane") return flash(tr("Tato vazba potřebuje rovinnou plochu."));
    mateGeo.current.set(`${leaf.key}:${face}`, info);
    const ref: MateRef = { compId: leaf.topId, leaf: leaf.id !== leaf.topId ? leaf.id : undefined, face };
    if (!mate.a) {
      if (leaf.topId !== mate.compId) return flash(tr("Nejdřív klikněte na plochu vybrané (pohyblivé) komponenty."));
      setMate({ ...mate, a: ref });
      flash(tr("Teď klikněte na plochu cílové komponenty."));
      return;
    }
    if (leaf.topId === mate.compId) return flash(tr("Teď klikněte na plochu jiné komponenty."));
    if (mate.mode === "distance" || mate.mode === "angle") {
      // hodnota se potvrzuje až po výběru obou ploch: předvyplní se aktuálně naměřená (s ní komponenty zůstanou, kde jsou)
      setMate({ ...mate, b: ref, ...measureMateIn(doc, geoProvider(doc), mate.mode, mate.a, ref) });
      return;
    }
    finishMate({ ...mate, b: ref });
  };
  /** uloží rozpracovanou vazbu (obě plochy vybrané; u Vzdálenosti / Úhlu po potvrzení hodnoty v panelu) a přepočítá sestavu */
  const finishMate = (p: PendingMate) => {
    const m = mateFromPending(p, uid());
    if (!m) return;
    const next = { ...doc, mates: [...(doc.mates ?? []), m] };
    commit(next);
    setMate(null);
    flash(tr("Vazba uložena – přepočítá se při každém pohybu komponent."));
    void resolveMates(next);
  };
  // po postavení dílů doplnit chybějící geometrii vazeb
  useEffect(() => {
    if (!isAsm || !doc.mates?.length) return;
    const st = Object.values(mateStatus);
    if (!st.length || st.some((x) => x === "missing")) void resolveMates(doc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asmVer, isAsm, doc.mates?.length]);
  // ---------- pole, zrcadlení, šroubový spoj ----------
  const norm3 = (v: Vec3): Vec3 => {
    const l = Math.hypot(...v) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const addBoltAt = async (leafId: string, face: number, point?: Vec3) => {
    if (!boltPick) return;
    const leaf = leaves.find((l) => l.id === leafId);
    if (!leaf) return;
    let info: MateFaceInfo | null = null;
    try {
      info = await cad.mateFace(leaf.key, face);
    } catch {
      info = null;
    }
    if (!info || info.kind !== "cylinder" || !info.extent || !info.radius) return flash(tr("Klikněte na válcovou plochu díry."));
    mateGeo.current.set(`${leaf.key}:${face}`, info);
    const wp = matrixToPlacement(leaf.matrix);
    const dir = norm3(apply3(rotMatrix(wp.rotation), info.normal));
    const o = transformPoint(wp, info.origin);
    const [t0, t1] = info.extent;
    const e0: Vec3 = [o[0] + dir[0] * t0, o[1] + dir[1] * t0, o[2] + dir[2] * t0];
    const e1: Vec3 = [o[0] + dir[0] * t1, o[1] + dir[1] * t1, o[2] + dir[2] * t1];
    const dd = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const pt = point ?? e1;
    const head = dd(pt, e0) < dd(pt, e1) ? e0 : e1;
    const bottom = head === e0 ? e1 : e0;
    const out = norm3([head[0] - bottom[0], head[1] - bottom[1], head[2] - bottom[2]]);
    const stack = boltStack(info.radius * 2, t1 - t0, boltPick);
    const rotUp = eulerXYZ(rotationBetween([0, 0, 1], out));
    const rotDown = eulerXYZ(rotationBetween([0, 0, 1], [-out[0], -out[1], -out[2]]));
    const at = (p: Vec3, k: number): Vec3 => [p[0] + out[0] * k, p[1] + out[1] * k, p[2] + out[2] * k];
    const holeRef: MateRef = { compId: leaf.topId, leaf: leaf.id !== leaf.topId ? leaf.id : undefined, face };
    const comps: AsmComponent[] = [];
    const mates: Mate[] = [];
    const d = Number(stack.size.replace(/\D/g, "")) || 8;
    if (stack.washer) comps.push(partComponent(stack.washer, { position: head, rotation: rotUp }, { group: "Normálie", number: stack.washer.props?.number, color: "#9aa7b5" }));
    const screw = partComponent(stack.screw, { position: at(head, stack.washerH), rotation: rotUp }, { group: "Normálie", number: stack.screw.props?.number, color: "#3a3f45" });
    comps.push(screw);
    mates.push({ id: uid(), type: "concentric", name: `Souosost ${stack.size}`, a: { compId: screw.id, face: -1, radius: d / 2 }, b: holeRef });
    if (stack.nut) {
      if (stack.washer) comps.push(partComponent(stack.washer, { position: bottom, rotation: rotDown }, { group: "Normálie", number: stack.washer.props?.number, color: "#9aa7b5" }));
      const nut = partComponent(stack.nut, { position: at(bottom, -stack.washerH), rotation: rotDown }, { group: "Normálie", number: stack.nut.props?.number, color: "#3a3f45" });
      comps.push(nut);
      mates.push({ id: uid(), type: "concentric", name: `Souosost matice ${stack.size}`, a: { compId: nut.id, face: -1, radius: (d * 0.85) / 2 }, b: holeRef });
    }
    const next = { ...doc, components: [...(doc.components ?? []), ...comps], mates: [...(doc.mates ?? []), ...mates] };
    commit(next);
    setBoltPick(null);
    setAsmSel(screw.id);
    flash(tr("Vložen šroub {0}×{1}{2}{3} – vazba Souosost.", stack.size, stack.length, stack.washer ? tr(" s podložkou") : "", stack.nut ? tr(" a maticí") : ""));
  };
  const patternSelected = (p: Parameters<typeof patternComponent>[2]) => {
    if (!asmSel) return;
    try {
      commit(patternComponent(doc, asmSel, p));
      flash(tr("Pole: {0} komponent.", p.count));
    } catch (e) {
      flash((e as Error).message);
    }
  };
  const mirrorSelected = (plane: "XY" | "XZ" | "YZ", offset: number) => {
    if (!asmSel) return;
    try {
      commit(mirrorComponent(doc, asmSel, plane, offset));
      flash(tr("Komponenta zrcadlena (poloha a natočení; geometrie dílu se nezrcadlí)."));
    } catch (e) {
      flash((e as Error).message);
    }
  };
  // pozice (balónky) pro výkres sestavy: světové obalové kvádry komponent podle řádků kusovníku
  const balloonItems = useMemo(() => {
    if (!isAsm) return undefined;
    const out: { pos: number; name: string; bbox: [Vec3, Vec3] }[] = [];
    for (const r of bom) {
      let bb: [Vec3, Vec3] | null = null;
      for (const l of leaves) {
        if (!r.ids.includes(l.topId) || l.hidden) continue;
        const m = asmCache.current.get(l.key)?.metrics?.bbox;
        if (!m) continue;
        const pl = matrixToPlacement(l.matrix);
        for (const x of [m[0][0], m[1][0]]) for (const y of [m[0][1], m[1][1]]) for (const z of [m[0][2], m[1][2]]) {
          const w = transformPoint(pl, [x, y, z]);
          if (!bb) bb = [[...w] as Vec3, [...w] as Vec3];
          else for (let k = 0; k < 3; k++) {
            bb[0][k] = Math.min(bb[0][k], w[k]);
            bb[1][k] = Math.max(bb[1][k], w[k]);
          }
        }
      }
      if (bb) out.push({ pos: r.pos, name: r.name, bbox: bb });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAsm, bom, leaves, asmVer]);
  // ---------- výběr entit, inspektor, měření ----------
  const srcOf = (it: SelItem): ShapeSrc => {
    const cid = it.kind !== "feature" ? it.compId : undefined;
    if (isAsm && cid) {
      const l = leaves.find((x) => x.id === cid);
      if (l) return { kind: "comp", key: l.key, matrix: l.matrix };
    }
    return { kind: "part" };
  };
  const refOf = (it: SelItem): EntRef => (it.kind === "edge" && it.at && it.point ? { kind: "point", point: it.point } : it.kind === "face" || it.kind === "edge" || it.kind === "vertex" ? { kind: it.kind, index: it.index } : { kind: "body" });
  const densityOf = (it: SelItem) => {
    const cid = it.kind !== "feature" ? it.compId : undefined;
    const l = cid ? leaves.find((x) => x.id === cid) : undefined;
    const matId = l ? (l.comp.source.kind === "part" ? l.comp.source.doc.material : (l.comp.material ?? "ocel")) : doc.material;
    return MATERIALS.find((x) => x.id === matId)?.density ?? 7.85;
  };
  const runInspect = async (it: SelItem) => {
    if (it.kind === "feature") return;
    if (it.kind === "component") {
      const top = doc.components?.find((c) => c.id === (it.topId ?? it.compId)) ?? doc.components?.find((c) => it.compId.startsWith(c.id));
      const leaf = leaves.find((l) => l.id === it.compId);
      const c = top;
      if (!c) return;
      const info = asmPartInfo(leaf?.comp ?? c);
      const subLeaves = leaves.filter((l) => l.topId === c.id);
      const mass = subLeaves.reduce((sum, l) => sum + (asmPartInfo(l.comp).massKg ?? 0), 0);
      setInspect({
        item: it,
        info: {
          title: c.source.kind === "asm" ? tr("Podsestava · {0}", c.name) : tr("Komponenta · {0}", c.name),
          rows: [
            [tr("Číslo / norma"), c.number ?? "—"],
            [tr("Poloha"), c.placement.position.map((v) => fmtNum(v, 2)).join(" ; ")],
            [tr("Natočení"), c.placement.rotation.map((v) => fmtNum(v, 2) + "°").join(" ; ")],
            [tr("Materiál"), c.source.kind === "asm" ? "—" : (info.material ?? "—")],
            [tr("Hmotnost"), `${fmtNum(mass, 3)} kg`],
            [tr("Dílů"), String(subLeaves.length)],
            [tr("Zdroj"), c.source.kind === "part" ? tr("parametrický díl") : c.source.kind === "asm" ? tr("podsestava") : tr("soubor {0}", c.source.fileName)],
          ],
        },
      });
      return;
    }
    try {
      const info = await cad.inspect(srcOf(it), refOf(it), densityOf(it));
      setInspect({ item: it, info });
    } catch (e) {
      flash((e as Error).message);
    }
  };
  const runMeasure = async (items: SelItem[]) => {
    if (!items.length) return setMeasureRes(null);
    try {
      const a = { src: srcOf(items[0]), ref: refOf(items[0]) };
      const b = items[1] ? { src: srcOf(items[1]), ref: refOf(items[1]) } : null;
      setMeasureRes(await cad.measureEnt(a, b));
    } catch (e) {
      flash((e as Error).message);
    }
  };
  const startMeasureWith = (it: SelItem) => {
    setMeasure(true);
    setActiveId(null);
    setMeasureSel([it]);
    runMeasure([it]);
  };
  const onPick = (it: SelItem | null, additive: boolean) => {
    if (refPick) {
      if (!it) return;
      void deliverRef(it, refPick);
      return;
    }
    if (boltPick) {
      if (it?.kind === "face" && it.compId) void addBoltAt(it.compId, it.index, it.point);
      return;
    }
    if (mate) {
      if (it?.kind === "face" && it.compId) onMateFace(it.compId, it.index);
      return;
    }
    if (measure) {
      if (!it) return;
      const next = measureSel.length >= 2 ? [it] : [...measureSel, it];
      setMeasureSel(next);
      runMeasure(next);
      return;
    }
    if (!it) {
      setHud(null);
      if (!additive) {
        setSelection([]);
        setInspect(null);
        if (isAsm) setAsmSel(null);
      }
      return;
    }
    const next = additive ? (selection.some((x) => sameSel(x, it)) ? selection.filter((x) => !sameSel(x, it)) : [...selection, it]) : [it];
    setSelection(next);
    setHud(!additive && next.length === 1 && !isAsm && !activeId && !sketchId ? { x: lastPtr.current.x, y: lastPtr.current.y, item: next[0] } : null);
    if (isAsm && it.kind !== "feature") {
      const top = it.topId ?? it.compId;
      if (top) setAsmSel(top.split("/")[0]);
    }
    if (next.length === 1) runInspect(next[0]);
  };
  useEffect(() => {
    setSelFilter(isAsm ? "component" : "all");
    setSelection([]);
    setInspect(null);
    setGizmoOn(null);
  }, [isAsm]);

  /** položka výběru → odkaz s otiskem (přežije změnu indexů) → do čekajícího pole */
  const deliverRef = async (it: SelItem, target: RefPickTarget) => {
    const base = selToRef(it, target.want);
    if (!base) return flash(tr("Tuto entitu nelze použít – vyberte ") + (target.want === "face" || target.want === "plane" ? "plochu" : target.want === "edge" || target.want === "axis" ? "hranu" : tr("bod, hranu nebo plochu")) + ".");
    if (target.want === "vertex" && base.kind !== "vertex") return flash(tr("Vyberte vrchol (filtr Bod)."));
    if ((target.want === "face" || target.want === "plane") && base.kind !== "face") return flash(tr("Vyberte plochu."));
    if (target.want === "edge" && base.kind !== "edge") return flash(tr("Vyberte hranu."));
    let ref: Ref = base;
    try {
      const info = await cad.refInfo(doc, base);
      if (info.sig && (base.kind === "vertex" || base.kind === "edge" || base.kind === "face")) ref = { ...base, sig: info.sig };
      if (info.geo?.point) setLastPoint(info.geo.point);
    } catch {
      /* bez otisku */
    }
    target.onPick(ref);
  };
  const refFilter = (w: Want): SelFilter => (w === "vertex" ? "vertex" : w === "edge" ? "edge" : w === "face" || w === "plane" ? "face" : "all");
  const selectionRefs = useMemo<Ref[]>(
    () => selection.flatMap((x) => (x.kind === "feature" || x.compId ? [] : x.kind === "vertex" ? [{ kind: "vertex", index: x.index } as Ref] : x.kind === "edge" ? [{ kind: "edge", index: x.index } as Ref] : x.kind === "face" ? [{ kind: "face", index: x.index } as Ref] : [])),
    [selection],
  );
  useRefPickEscape(refPick, () => setRefPick(null));
  useEffect(() => setRefPick(null), [activeId]);
  useEffect(() => {
    if (activeId || sketchId || !selection.length || measure) setHud(null);
  }, [activeId, sketchId, selection.length, measure]);
  const refCtxValue = useMemo(
    () => ({ doc, target: refPick, request: setRefPick, selectionRefs, lastPoint, counts: result?.metrics ? { faces: result.metrics.faces, edges: result.metrics.edges, vertices: Math.floor((result.vertices?.length ?? 0) / 3) } : undefined }),
    [doc, refPick, selectionRefs, lastPoint, result],
  );
  const selFaces = selection.filter((x): x is Extract<SelItem, { kind: "face" }> => x.kind === "face" && !x.compId).map((x) => x.index);
  const selEdges = selection.filter((x): x is Extract<SelItem, { kind: "edge" }> => x.kind === "edge" && !x.compId).map((x) => x.index);
  /** nový prvek přímých úprav z vybraných ploch / hran */
  const addWithFaces = (type: "pushPull" | "offsetFace" | "deleteFace" | "draft" | "shell" | "thicken", faces = selFaces) => {
    if (isAsm) return flash(tr("Přímé úpravy ploch se dělají v dílu – otevřete ho (Upravit díl)."));
    if (!faces.length) return flash(tr("Vyberte plochu (filtr Plocha) a zopakujte příkaz."));
    const f = newFeature(doc, type as never, { faces } as Partial<Feature>);
    commit({ ...doc, features: [...doc.features, f] });
    beginEdit(f.id, doc);
    setSelection([]);
    track("cad_feature", { type });
  };
  const addWithEdges = (type: "fillet" | "chamfer", edges = selEdges) => {
    if (isAsm) return flash(tr("Zaoblení se dělá v dílu – otevřete ho (Upravit díl)."));
    const f = newFeature(doc, type, { edges: edges.length ? edges : [] } as Partial<Feature>);
    commit({ ...doc, features: [...doc.features, f] });
    beginEdit(f.id, doc);
    setSelection([]);
  };
  const setFaceColor = (faces: number[], color: string | null) => {
    const fc = { ...(doc.faceColors ?? {}) };
    for (const i of faces) {
      if (color) fc[i] = color;
      else delete fc[i];
    }
    commit({ ...doc, faceColors: fc });
  };

  // ---------- gizmo (přesun / otočení) ----------
  const startBodyGizmo = () => {
    if (isAsm) return;
    if (!result?.metrics) return flash(tr("Není těleso k přesunutí."));
    const last = doc.features[doc.features.length - 1];
    let id = last?.type === "transform" ? last.id : null;
    if (!id) {
      const f = newFeature(doc, "transform");
      commit({ ...doc, features: [...doc.features, f] });
      id = f.id;
    }
    setActiveId(id);
    setEditBase(doc);
    setGizmoOn({ target: "body", id, mode: "translate" });
    flash(tr("Táhněte šipkami (posun, krok 1 mm) nebo oblouky (otočení, krok 15°). R přepne posun/otočení."));
  };
  const startCompGizmo = (id: string) => {
    const c = doc.components?.find((x) => x.id === id);
    if (!c) return;
    if (c.fixed) return flash(tr("Komponenta je ukotvená – nejdřív ji uvolněte."));
    setAsmSel(id);
    setGizmoOn({ target: "component", id, mode: "translate" });
  };
  const gizmo: Gizmo = useMemo(() => {
    if (!gizmoOn) return null;
    if (gizmoOn.target === "component") {
      const c = doc.components?.find((x) => x.id === gizmoOn.id);
      if (!c) return null;
      return { id: c.id, matrix: placementMatrix(c.placement), mode: gizmoOn.mode, targets: [c.id] };
    }
    const b = result?.metrics?.bbox;
    if (!b) return null;
    const c = [0, 1, 2].map((k) => (b[0][k] + b[1][k]) / 2);
    return { id: gizmoOn.id, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, c[0], c[1], c[2], 1], mode: gizmoOn.mode, targets: ["__body__"] };
  }, [gizmoOn, doc.components, result?.metrics?.bbox]);
  const onGizmo = (delta: number[], final: boolean) => {
    if (!final || !gizmoOn) return;
    if (gizmoOn.target === "component") {
      const c = doc.components?.find((x) => x.id === gizmoOn.id);
      if (!c) return;
      const pl = matrixToPlacement(mul4(delta, placementMatrix(c.placement)));
      const nextDoc = { ...doc, components: (doc.components ?? []).map((x) => (x.id === c.id ? { ...x, placement: pl } : x)) };
      commit(nextDoc);
      if (doc.mates?.length) void resolveMates(nextDoc, c.id);
      return;
    }
    const f = doc.features.find((x) => x.id === gizmoOn.id);
    if (!f || f.type !== "transform") return;
    // rotace z delta matice → osa + úhel
    const R = [delta[0], delta[4], delta[8], delta[1], delta[5], delta[9], delta[2], delta[6], delta[10]];
    const trace = R[0] + R[4] + R[8];
    const ang = Math.acos(Math.max(-1, Math.min(1, (trace - 1) / 2)));
    const round = (v: number) => Math.round(v * 1e4) / 1e4;
    const d: Vec3 = [delta[12], delta[13], delta[14]];
    const rt = apply3(R as never, f.translate);
    if (ang < 1e-6) {
      updateFeature(f.id, { translate: [round(f.translate[0] + d[0]), round(f.translate[1] + d[1]), round(f.translate[2] + d[2])] } as Partial<Feature>);
      return;
    }
    const sn = 2 * Math.sin(ang);
    const axis: Vec3 = [(R[7] - R[5]) / sn, (R[2] - R[6]) / sn, (R[3] - R[1]) / sn];
    const k = [0, 1, 2].reduce((a, b) => (Math.abs(axis[b]) > Math.abs(axis[a]) ? b : a), 0);
    if (Math.abs(axis[k]) < 0.999) return flash(tr("Otočení kolem obecné osy nelze uložit – otáčejte po jednom oblouku."));
    const ax = (["X", "Y", "Z"] as const)[k];
    const deg = round(((axis[k] > 0 ? 1 : -1) * ang * 180) / Math.PI);
    if (f.rotateAngle && f.rotateAxis !== ax) {
      // jiná osa → nový prvek transformace navazující na předchozí
      const nf = newFeature(doc, "transform", { translate: d.map(round) as Vec3, rotateAxis: ax, rotateAngle: deg } as Partial<Feature>);
      commit({ ...doc, features: [...doc.features, nf] });
      setActiveId(nf.id);
      setGizmoOn({ ...gizmoOn, id: nf.id });
      return;
    }
    updateFeature(f.id, { translate: [round(d[0] + rt[0]), round(d[1] + rt[1]), round(d[2] + rt[2])], rotateAxis: ax, rotateAngle: round((f.rotateAngle || 0) + deg) } as Partial<Feature>);
  };
  useEffect(() => {
    if (gizmoOn?.target === "body" && activeId !== gizmoOn.id) setGizmoOn(null);
  }, [activeId, gizmoOn]);

  // ---------- kontextové nabídky podle entity ----------
  const COLOR_MENU = (apply: (c: string | null) => void, label: string): RMenuEntry[] => [
    { divider: true, label },
    ...[COLORS[6], COLORS[4], COLORS[5], COLORS[0], COLORS[7]].map((c) => ({ id: `c${c.c}`, label: `● ${c.l}`, icon: "palette" as CadIconName, onClick: () => apply(c.c) })),
    { id: "c-reset", label: tr("Výchozí barva"), icon: "palette", onClick: () => apply(null) },
  ];
  const entityMenu = (it: SelItem | null): RMenuEntry[] => {
    if (!it) return [];
    const head: RMenuEntry = { divider: true, label: tr(KIND_LABEL[it.kind]) + (it.kind === "face" || it.kind === "edge" || it.kind === "vertex" ? ` ${it.index + 1}` : "") };
    const props: RMenuEntry = { id: "props", label: tr("Vlastnosti"), icon: "info", tone: "tool", onClick: () => { setInspectOpen(true); runInspect(it); } };
    const meas: RMenuEntry = { id: "meas", label: it.kind === "vertex" ? tr("Měřit odsud") : it.kind === "edge" ? tr("Měřit délku / odsud") : tr("Měřit"), icon: "measure", tone: "tool", onClick: () => startMeasureWith(it) };
    if (it.kind === "face") {
      const faces = selection.some((x) => sameSel(x, it)) && selFaces.length ? selFaces : [it.index];
      if (isAsm) return [head, meas, props];
      return [
        head,
        { id: "sk", label: tr("Nová skica na ploše"), icon: "sketch", tone: "sketch", onClick: () => sketchOnFace(it.index) },
        { id: "pp", label: tr("Vytáhnout / Zatlačit"), icon: "pushPull", tone: "create", onClick: () => addWithFaces("pushPull", faces) },
        { id: "of", label: tr("Odsadit plochu"), icon: "offsetFace", tone: "feature", onClick: () => addWithFaces("offsetFace", faces) },
        { id: "df", label: tr("Odstranit plochu"), icon: "deleteFace", tone: "cut", kbd: "Del", onClick: () => addWithFaces("deleteFace", faces) },
        { id: "dr", label: tr("Úkos"), icon: "draft", tone: "feature", onClick: () => addWithFaces("draft", faces) },
        { id: "sh", label: tr("Skořepina (otevřít plochu)"), icon: "shell", tone: "feature", onClick: () => addWithFaces("shell", faces) },
        { id: "th", label: tr("Zesílit"), icon: "thicken", tone: "feature", onClick: () => addWithFaces("thicken", faces) },
        meas,
        props,
        ...COLOR_MENU((c) => setFaceColor(faces, c), tr("Barva plochy")),
      ];
    }
    if (it.kind === "edge") {
      const edges = selection.some((x) => sameSel(x, it)) && selEdges.length ? selEdges : [it.index];
      if (isAsm) return [head, meas, props];
      return [
        head,
        { id: "fi", label: tr("Zaoblit hranu"), icon: "fillet", tone: "feature", onClick: () => addWithEdges("fillet", edges) },
        { id: "ch", label: tr("Srazit hranu"), icon: "chamfer", tone: "feature", onClick: () => addWithEdges("chamfer", edges) },
        meas,
        props,
      ];
    }
    if (it.kind === "vertex") return [head, { id: "co", label: tr("Souřadnice {0}", it.point.map((v) => fmtNum(v, 2)).join(" ; ")), icon: "axes", onClick: () => runInspect(it) }, meas, props];
    if (it.kind === "body" && !isAsm) {
      return [
        head,
        { id: "mv", label: tr("Přesunout / otočit (gizmo)"), icon: "transform", tone: "pattern", onClick: startBodyGizmo },
        { id: "hd", label: bodyHidden ? tr("Zobrazit těleso") : tr("Skrýt těleso"), icon: "eye", onClick: () => setBodyHidden((v) => !v) },
        { id: "tr", label: bodyOpacity < 1 ? tr("Neprůhledné") : tr("Průhledné"), icon: "xray", onClick: () => setBodyOpacity((v) => (v < 1 ? 1 : 0.35)) },
        meas,
        props,
        ...COLOR_MENU((c) => commit({ ...doc, color: c ?? undefined }), tr("Barva tělesa")),
      ];
    }
    // komponenta / podsestava (i těleso v sestavě)
    const topId = (it.kind === "component" || it.kind === "body" ? (it.topId ?? it.compId) : undefined)?.split("/")[0];
    const c = doc.components?.find((x) => x.id === topId);
    if (!c) return [head, props];
    const multi = selection.filter((x) => x.kind === "component" || x.kind === "body").map((x) => ("topId" in x ? x.topId : undefined) ?? ("compId" in x ? x.compId : undefined)).filter(Boolean) as string[];
    const tops = [...new Set(multi.map((x) => x.split("/")[0]))];
    return [
      { divider: true, label: c.source.kind === "asm" ? tr("Podsestava · {0}", c.name) : c.name },
      { id: "gz", label: tr("Přesunout / otočit (gizmo)"), icon: "transform", tone: "pattern", kbd: "G", onClick: () => startCompGizmo(c.id) },
      ...(c.source.kind === "asm"
        ? ([
            { id: "osub", label: tr("Otevřít podsestavu"), icon: "layers", onClick: () => editPartInContext(c) },
            { id: "dis", label: tr("Rozpustit podsestavu"), icon: "layers", onClick: () => { commit(dissolveSubassembly(doc, c.id)); setAsmSel(null); setSelection([]); } },
          ] as RMenuEntry[])
        : []),
      ...(tops.length > 1 ? ([{ id: "mksub", label: tr("Vytvořit podsestavu z vybraných ({0})", tops.length), icon: "layers", tone: "create", onClick: () => { commit(makeSubassembly(doc, tops, tr("Podsestava {0}", (doc.components ?? []).filter((x) => x.source.kind === "asm").length + 1))); setSelection([]); } }] as RMenuEntry[]) : []),
      ...compMenu(c),
      meas,
      props,
      ...COLOR_MENU((col) => setComp(c.id, { color: col ?? undefined }), tr("Barva komponenty")),
    ];
  };

  const runInterference = async () => {
    flash(tr("Kontroluji kolize…"));
    try {
      const res = await cad.interference(doc);
      setClashes(res);
      setClashInfo({ at: new Date().toLocaleTimeString(cadLocale()), comps: leaves.filter((l) => !l.hidden).length });
      flash(res.length ? tr("Kolize: {0}", res.length) : tr("Bez kolizí ✓ – výsledek je v panelu Kolize i ve stavu dokumentu"));
    } catch (e) {
      flash((e as Error).message);
    }
  };
  const compName = (id: string) => doc.components?.find((c) => c.id === id)?.name ?? id;
  /** stav sestavy pro textový stav (agenti): počty, obálka, objem, hmotnost, poslední kontrola kolizí */
  const asmStatusRef = useRef<() => AsmStatus | undefined>(() => undefined);
  asmStatusRef.current = () => {
    if (!isAsm) return undefined;
    const vis = leaves.filter((l) => !l.hidden);
    let volume = 0;
    let mass = 0;
    let known = vis.length > 0;
    for (const l of vis) {
      const v = asmCache.current.get(l.key)?.metrics?.volume;
      if (v == null) {
        known = false;
        continue;
      }
      volume += v;
      mass += asmPartInfo(l.comp).massKg ?? 0;
    }
    let bbox: [Vec3, Vec3] | undefined;
    for (const it of balloonItems ?? []) {
      if (!bbox) bbox = [[...it.bbox[0]] as Vec3, [...it.bbox[1]] as Vec3];
      else for (let k = 0; k < 3; k++) {
        bbox[0][k] = Math.min(bbox[0][k], it.bbox[0][k]);
        bbox[1][k] = Math.max(bbox[1][k], it.bbox[1][k]);
      }
    }
    return {
      components: (doc.components ?? []).length,
      parts: vis.length,
      bbox,
      volume: known ? volume : undefined,
      massKg: known ? mass : undefined,
      clash: clashes ? { count: clashes.length, pairs: clashes.map((x) => `${compName(x.a)} × ${compName(x.b)} (${fmtNum(x.volume, 1)} mm³)`), at: clashInfo?.at ?? "" } : null,
    };
  };

  // ---------- prvky ----------
  const beginEdit = (id: string, base: CadDoc) => {
    setSketchId(null);
    setSketchSel(null);
    setActiveId(id);
    setEditBase(base);
    setMeasure(false);
  };
  // ---------- prvky rozšíření (plochy, plech, pokročilé…) ----------
  const extActionApi = (): ExtActionApi => ({
    doc,
    result,
    selection,
    commit,
    flash,
    notice: (title, body) => setNotice({ title, body }),
    download,
    exportModel: (format) => exportModel(format as ExportFormat),
  });
  const addExt = (def: ExtDef) => {
    if (def.action) {
      void getExtUi(def.ext)?.action?.(extActionApi());
      return;
    }
    if (isAsm && def.scope !== "assembly" && def.scope !== "both") return flash(tr("V sestavě se prvky nepřidávají – otevřete díl (pravé tlačítko → Upravit díl)."));
    const extra: Record<string, unknown> = {};
    if (def.pick?.kind === "faces" && selFaces.length) extra[def.pick.key] = selFaces;
    if (def.pick?.kind === "edges" && selEdges.length) extra[def.pick.key] = selEdges;
    try {
      const f = newExtFeature(doc, def.ext, extra);
      commit({ ...doc, features: [...doc.features, f] });
      beginEdit(f.id, doc);
      track("cad_feature", { type: def.ext });
    } catch (e) {
      flash((e as Error).message);
    }
  };
  const extGroups = (tab: ExtTab): RGroup[] => {
    const by = new Map<string, ExtDef[]>();
    for (const d of extByTab(tab)) by.set(d.group, [...(by.get(d.group) ?? []), d]);
    return [...by.entries()].map(([label, defs]) => {
      const sorted = [...defs].sort((a, b) => Number(!!b.big) - Number(!!a.big));
      return {
        label: tr(label),
        big: sorted.filter((d) => d.big).length,
        items: sorted.map((d) => ({ id: d.ext, label: d.label, icon: d.icon ?? "cube", tone: d.tone ?? "create", hint: d.hint, kbd: d.kbd, disabled: !d.action && (d.scope === "assembly" ? !isAsm : d.scope === "both" ? false : isAsm), onClick: () => addExt(d) })),
      };
    });
  };

  const addFeature = (type: AddType) => {
    if (isAsm) return flash(tr("V sestavě se prvky nepřidávají – otevřete díl (pravé tlačítko → Upravit díl)."));
    if ((type === "extrude" || type === "revolve") && !doc.features.some((f) => f.type === "sketch")) {
      flash(tr("Nejdřív nakreslete skicu (profil)."));
      return;
    }
    if ((type === "sweep" || type === "loft") && doc.features.filter((f) => f.type === "sketch").length < 2) {
      flash(type === "sweep" ? tr("Tažení potřebuje dvě skici: profil a dráhu.") : tr("Šablonování potřebuje alespoň dvě skici v různých rovinách."));
      return;
    }
    const f = newFeature(doc, type);
    // těleso zvolené ve správci jako aktivní: nový prvek pracuje s ním (jinak s naposledy upraveným tělesem)
    if (doc.activeBody && !NO_BODY_TYPES.has(type) && type !== "combine" && type !== "copyBody") {
      const bs = bodiesAt(doc);
      if (bs.names.length > 1 && bs.names.includes(doc.activeBody) && doc.activeBody !== bs.active) f.body = doc.activeBody;
    }
    commit({ ...doc, features: [...doc.features, f] });
    beginEdit(f.id, doc);
    track("cad_feature", { type });
  };
  const addPattern = () => {
    const last = [...doc.features].reverse().find((f) => ["extrude", "revolve", "box", "cylinder", "sphere", "cone", "tube", "hole", "sweep", "loft", "text"].includes(f.type));
    if (!last) return flash(tr("Pole opakuje existující prvek – nejdřív vytvořte díru nebo vysunutí."));
    const f: Feature = { id: uid(), name: nextName(doc, "pattern"), type: "pattern", featureId: last.id, kind: "circular", count: 6, angle: 360, axis: "Z", center: [0, 0, 0] };
    commit({ ...doc, features: [...doc.features, f] });
    beginEdit(f.id, doc);
  };
  const createSketch = (plane: SketchPlane) => {
    const f: Feature = { id: uid(), name: nextName(doc, "sketch"), type: "sketch", plane, entities: [] };
    commit({ ...doc, features: [...doc.features, f] });
    setPlanePick(false);
    setActiveId(null);
    setSketchId(f.id);
    setTool("line");
    setTab("sketch");
  };
  const finishSketch = () => {
    const sk = doc.features.find((f) => f.id === sketchId);
    setSketchId(null);
    setSketchSel(null);
    setTab("create");
    if (!sk || sk.type !== "sketch") return;
    const usedBy = doc.features.some((f) => (f.type === "extrude" || f.type === "revolve") && f.sketchId === sk.id) || doc.features.some((f) => (f.type === "sweep" && (f.profileId === sk.id || f.pathId === sk.id)) || (f.type === "loft" && f.sketchIds.includes(sk.id)));
    if (!usedBy && sk.entities.length) {
      const hasBody = doc.features.some((f) => !NO_BODY_TYPES.has(f.type));
      const ex = newFeature(doc, "extrude", { sketchId: sk.id, mode: hasBody ? "add" : "new" } as Partial<Feature>);
      commit({ ...doc, features: [...doc.features, ex] });
      beginEdit(ex.id, doc);
    }
  };
  const cancelSketch = () => {
    const sk = doc.features.find((f) => f.id === sketchId);
    if (sk?.type === "sketch" && sk.entities.length === 0) commit({ ...doc, features: doc.features.filter((f) => f.id !== sk.id) });
    setSketchId(null);
    setSketchSel(null);
    setTab("create");
  };
  const removeFeature = (id: string) => {
    commit({ ...doc, features: doc.features.filter((f) => f.id !== id) });
    if (activeId === id) setActiveId(null);
    if (sketchId === id) setSketchId(null);
  };
  /** Smazat (Delete / tlačítko Smazat): upravovaný prvek, vybrané prvky, komponenty sestavy, plochy (Odstranit plochu), celé těleso. */
  const deleteSelection = () => {
    const ask = (msg: string) => !prefs.confirmDelete || window.confirm(msg);
    if (active) {
      if (!ask(tr("Smazat prvek „{0}“?", active.name))) return;
      return removeFeature(active.id);
    }
    const feats = selection.flatMap((x) => (x.kind === "feature" ? [x.featureId] : []));
    if (feats.length) {
      if (!ask(tr("Smazat {0} prvků z historie?", feats.length))) return;
      commit({ ...doc, features: doc.features.filter((f) => !feats.includes(f.id)) });
      setSelection([]);
      return;
    }
    if (isAsm) {
      const ids = new Set<string>();
      for (const x of selection) if (x.kind === "component" || x.kind === "body") { const top = (x.topId ?? x.compId)?.split("/")[0]; if (top) ids.add(top); }
      if (asmSel) ids.add(asmSel);
      if (!ids.size) return flash(tr("Vyberte komponentu, kterou chcete odebrat (klik v 3D okně nebo ve stromu)."));
      if (!ask(tr("Odebrat {0} komponent ze sestavy?", ids.size))) return;
      commit({ ...doc, components: (doc.components ?? []).filter((c) => !ids.has(c.id)) });
      setAsmSel(null);
      setSelection([]);
      return;
    }
    if (selection.some((x) => x.kind === "face")) return addWithFaces("deleteFace");
    if (selection.some((x) => x.kind === "body")) {
      if (!window.confirm(tr("Smazat celé těleso, tj. všechny prvky v historii dílu?"))) return;
      commit({ ...doc, features: [] });
      setSelection([]);
      return;
    }
    if (selection.length) return flash(tr("Hranu ani bod nelze smazat samostatně – vyberte plochu (Odstranit plochu) nebo prvek v historii."));
    flash(tr("Není co smazat – vyberte prvek v historii, plochu nebo komponentu a stiskněte Delete."));
  };
  const selectFeature = (f: Feature) => {
    if (f.type === "sketch") {
      setActiveId(null);
      setSketchId(f.id);
      setTool("select");
      setTab("sketch");
    } else if (f.id === activeId) setActiveId(null);
    else beginEdit(f.id, doc);
  };
  const okEdit = () => {
    setActiveId(null);
    setEditBase(null);
  };
  const cancelEdit = () => {
    if (editBase) commit(editBase);
    setActiveId(null);
    setEditBase(null);
  };

  // ---------- výběr v modelu ----------
  const FACE_PICK = new Set<string>(["shell", "hole", "draft", "pushPull", "deleteFace", "offsetFace", "thicken"]);
  const pickMode: PickMode = refPick
    ? "select"
    : isAsm
    ? mate || boltPick
      ? "asmFace"
      : "select"
    : planePick
      ? "face-plane"
      : measure
        ? "select"
        : active?.type === "fillet" || active?.type === "chamfer"
          ? active.edges === "all"
            ? "none"
            : "edges"
          : active && FACE_PICK.has(active.type)
            ? "faces"
            : active?.type === "ext"
              ? getExt(active.ext)?.pick?.kind === "faces"
                ? "faces"
                : getExt(active.ext)?.pick?.kind === "edges"
                  ? "edges"
                  : "select"
              : "select";

  const toggleExtPick = (i: number, kind: "faces" | "edges") => {
    if (active?.type !== "ext") return false;
    const pk = getExt(active.ext)?.pick;
    if (!pk || pk.kind !== kind) return false;
    const cur = (active.data[pk.key] as number[] | undefined) ?? [];
    updateFeature(active.id, { data: { ...active.data, [pk.key]: cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i] } } as Partial<Feature>);
    return true;
  };
  const extPicked = (kind: "faces" | "edges"): number[] => {
    if (active?.type !== "ext") return [];
    const pk = getExt(active.ext)?.pick;
    return pk && pk.kind === kind ? ((active.data[pk.key] as number[] | undefined) ?? []) : [];
  };
  const onPickEdge = (i: number) => {
    if (refPick) return void deliverRef({ kind: "edge", index: i }, refPick);
    if (toggleExtPick(i, "edges")) return;
    if (!active || (active.type !== "fillet" && active.type !== "chamfer") || active.edges === "all") return;
    const edges = active.edges.includes(i) ? active.edges.filter((x) => x !== i) : [...active.edges, i];
    updateFeature(active.id, { edges } as Partial<Feature>);
  };
  const sketchOnFace = async (i: number) => {
    const info = await cad.face(i);
    if (!info?.planar) return flash(tr("Skicu lze založit jen na rovinné ploše."));
    createSketch({ kind: "custom", origin: info.origin, normal: info.normal, xDir: info.xDir, label: tr("Plocha {0}", i + 1) });
  };
  const onPickFace = async (i: number, point?: [number, number, number]) => {
    if (refPick) return void deliverRef({ kind: "face", index: i, point }, refPick);
    if (planePick) return sketchOnFace(i);
    if (toggleExtPick(i, "faces")) return;
    if (active && FACE_PICK.has(active.type)) {
      const cur = ((active as { faces?: number[] }).faces ?? []);
      const faces = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i];
      updateFeature(active.id, { faces } as Partial<Feature>);
    }
    if (active?.type === "hole" && point) {
      const info = await cad.face(i);
      if (!info) return;
      const n = info.normal;
      const k = [0, 1, 2].reduce((a, b) => (Math.abs(n[b]) > Math.abs(n[a]) ? b : a), 0);
      const axis = (["X", "Y", "Z"] as const)[k];
      const round = (v: number) => Math.round(v * 100) / 100;
      updateFeature(active.id, { position: point.map(round) as [number, number, number], axis, flip: n[k] < 0 } as Partial<Feature>);
    }
  };

  // ---------- soubory ----------
  const exportModel = async (format: ExportFormat) => {
    const meta = EXPORTS.find((e) => e.f === format)!;
    try {
      // nejdřív dialog „Uložit jako“ (uživatelské gesto), pak teprve výpočet exportu
      let bytes = 0;
      const saved = await saveFile(`${safeName(doc.name)}.${meta.ext}`, async () => {
        flash(tr("Připravuji {0}…", meta.label));
        const t0 = Date.now();
        // dlouhý export (složitá / neplatná geometrie): průběžná zpráva s časem místo ticha
        const tick = window.setInterval(() => flash(tr("Připravuji {0}… {1} s – složitá geometrie; prvky s ⚠ (neplatná geometrie) export výrazně zpomalují", meta.label, Math.round((Date.now() - t0) / 1000))), 4000);
        try {
          const buf = await cad.exportFile(doc, format);
          bytes = buf.byteLength;
          return buf;
        } finally {
          window.clearInterval(tick);
        }
      }, meta.mime);
      if (saved) flash(tr("Export {0} hotov: {1} ({2})", meta.label, saved.name, bytes >= 1024 ? `${Math.round(bytes / 1024)} kB` : `${bytes} B`));
      else flash(tr("Export {0} zrušen.", meta.label));
      track("cad_export", { format });
    } catch (e) {
      flash((e as Error).message);
    }
  };
  /** cíl posledního uložení projektu (Ctrl+S pak ukládá bez dotazu; „Uložit jako…“ se zeptá znovu) */
  const projectTarget = useRef<SavedFile | null>(null);
  const saveProjectAs = async () => {
    const t = await pickSaveTarget(`${safeName(doc.name)}.mncad`, "application/json");
    if (!t) return;
    await writeSaved(t, JSON.stringify(doc, null, 1), "application/json");
    projectTarget.current = t.handle ? t : null;
    dirty.current = false;
    flash(tr("Uloženo: {0}", t.name));
  };
  const saveProject = async () => {
    const t = projectTarget.current;
    if (t?.handle) {
      try {
        await writeSaved(t, JSON.stringify(doc, null, 1), "application/json");
        dirty.current = false;
        flash(tr("Uloženo: {0}", t.name));
        return;
      } catch {
        projectTarget.current = null; // soubor už není dostupný → zeptat se znovu
      }
    }
    await saveProjectAs();
  };
  const newAssembly = (withCurrent = false) => {
    const a = emptyAssembly(withCurrent ? tr("Sestava – {0}", doc.name) : tr("Nová sestava"));
    if (withCurrent && !isAsm && doc.features.length) a.components = [partComponent(doc, {}, { group: "Díly", fixed: true, color: doc.color ?? "#b9c2cc" })];
    openDocInTab(a);
  };
  const newDoc = () => openDocInTab(emptyDoc());
  const openFile = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "mncad" || ext === "json") {
      try {
        const d = JSON.parse(await file.text()) as CadDoc;
        if (d.app !== "mnastrojarna-cad") throw new Error();
        if (isAsm && d.kind !== "assembly" && !drawAfterImport.current) {
          insertPart(d, tr("Díly"));
          flash(tr("Díl {0} vložen do sestavy.", d.name));
          return;
        }
        openDocInTab(d);
        flash(tr("Otevřeno: {0}", d.name));
        if (drawAfterImport.current) {
          drawAfterImport.current = false;
          setTimeout(() => openDrawingTabRef.current(), 1500);
        }
      } catch {
        flash(tr("Soubor není platný projekt Mnástrojárna CAD."));
      }
      return;
    }
    flash(tr("Načítám {0}…", file.name));
    try {
      const res = await prepareImport(file);
      if (res.kind === "unsupported") return setNotice({ title: tr("Formát .{0} nelze otevřít přímo", ext), body: res.message });
      const base = doc.features.length || doc.components?.length ? emptyDoc(file.name.replace(/\.[^.]+$/, "")) : { ...doc, name: doc.name === "Nový díl" ? file.name.replace(/\.[^.]+$/, "") : doc.name };
      if (res.kind === "body" && isAsm && !drawAfterImport.current) {
        insertComponent({ id: uid(), name: res.fileName.replace(/\.[^.]+$/, ""), source: { kind: "file", fileName: res.fileName, format: res.format, data: res.data }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] }, group: "Díly", color: "#9fb4c8" });
        flash(tr("Soubor vložen jako komponenta sestavy."));
        return;
      }
      if (res.kind === "body") {
        const f: Feature = { id: uid(), name: `Import ${res.fileName}`, type: "import", fileName: res.fileName, format: res.format, data: res.data };
        openDocInTab({ ...base, kind: "part", features: [...base.features, f] }); // každý model ve vlastní záložce
        flash(res.note ?? tr("Model importován – můžete na něj navázat dalšími prvky."));
        if (drawAfterImport.current) {
          drawAfterImport.current = false;
          setTimeout(() => openDrawingTabRef.current(), 1800);
        }
      } else {
        const f: Feature = { id: uid(), name: res.name, type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: res.entities };
        if (base === doc || base.name === doc.name) commit({ ...base, features: [...base.features, f] });
        else openDocInTab({ ...base, kind: "part", features: [...base.features, f] });
        setSketchId(f.id);
        setTool("select");
        setTab("sketch");
        flash(res.note ?? tr("Výkres načten jako skica ({0} entit).", res.entities.length));
      }
      track("cad_import", { format: ext ?? "" });
    } catch (e) {
      flash((e as Error).message || tr("Soubor se nepodařilo načíst."));
    }
  };
  // přetažení souborů do okna: každý se otevře ve vlastní záložce (bez výchozího chování prohlížeče = nové okno)
  const [dropHint, setDropHint] = useState(false);
  const hasFiles = (dt: DataTransfer) => dt.types.includes("Files") || Array.from(dt.items ?? []).some((i) => i.kind === "file");
  const onDragOver = (e: React.DragEvent) => {
    if (hasFiles(e.dataTransfer)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (!dropHint) setDropHint(true);
    }
  };
  /** soubory z přenosu – z průzkumníka (files) i z Outlooku / jiných aplikací (items) */
  const filesOf = (dt: DataTransfer): File[] => {
    const out: File[] = Array.from(dt.files ?? []);
    if (!out.length) for (const it of Array.from(dt.items ?? [])) if (it.kind === "file") { const f = it.getAsFile(); if (f) out.push(f); }
    return out;
  };
  const onDrop = async (e: React.DragEvent) => {
    const files = filesOf(e.dataTransfer);
    e.preventDefault();
    setDropHint(false);
    if (!files.length) return flash(tr("Přetažený obsah neobsahuje soubor – u Outlooku přetáhněte přílohu, ne text zprávy; případně ji nejdřív uložte na plochu."));
    setStartOpen(false);
    for (const f of files) await openFile(f);
  };
  const toRfq = async () => {
    try {
      flash(tr("Ukládám model STEP a otevírám e-mail…"));
      const buf = await cad.exportFile(doc, "step");
      const file = `${safeName(doc.name)}.step`;
      download(file, () => buf, "application/step");
      track("cad_to_rfq");
      const body = tr("Dobrý den,\n\nposílám model z Mnástrojárna CAD – soubor {0} jsem si stáhl do počítače a přikládám ho.\n\nMnožství:\nMateriál:\nTermín:\n\nS pozdravem\n", file);
      setTimeout(() => {
        window.location.href = `mailto:${SALES.email}?subject=${encodeURIComponent(`Poptávka z webu – ${doc.name}`)}&body=${encodeURIComponent(body)}`;
      }, 600);
    } catch (e) {
      flash((e as Error).message);
    }
  };
  const loadExample = (make: () => CadDoc) => openDocInTab(make());

  // ---------- nástroje ----------
  const toggleMeasure = () => {
    setMeasure((m) => !m);
    setMeasureSel([]);
    setMeasureRes(null);
    setActiveId(null);
  };
  const toggleSection = () => {
    if (section) return setSection(null);
    const m = result?.metrics;
    const c = m ? (m.bbox[0][1] + m.bbox[1][1]) / 2 : 0;
    setSection({ axis: "Y", offset: Math.round(c * 100) / 100, flip: false });
  };
  const view = (v: ViewName) => vp.current?.setView(v);

  // ---------- klávesy ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const field = (e.target as HTMLElement)?.closest?.("input,textarea,select") as HTMLElement | null;
      if (field) {
        if (e.key === "Escape") field.blur(); // Esc opustí textové pole, další Esc už ruší výběr
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && e.shiftKey && k === "k") {
        e.preventDefault();
        setAgentOpen(true);
        return;
      }
      if (mod && e.shiftKey && k === "l") {
        e.preventDefault();
        setHintsOn((v) => !v);
        return;
      }
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && k === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && k === "s") {
        e.preventDefault();
        saveProject();
        return;
      }
      if (mod && k === "o") {
        e.preventDefault();
        fileInput.current?.click();
        return;
      }
      if (mod && k === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (mod && k === ",") {
        e.preventDefault();
        setSettingsOpen(true);
        return;
      }
      if (mod && k === "l") {
        e.preventDefault();
        setLibraryOpen((v) => (v ? null : {}));
        return;
      }
      if (sketchId || mod || e.altKey) return;
      if (e.key === "Escape") {
        if (mate) setMate(null);
        if (boltPick) setBoltPick(null);
        else if (asmSel) setAsmSel(null);
        if (active) cancelEdit();
        setPlanePick(false);
        setMeasure(false);
        setMeasureSel([]);
        setMeasureRes(null);
        setSelection([]);
        setGizmoOn(null);
        setCtx(null);
        setHud(null);
        setInspect(null);
        return;
      }
      if (e.key === "Enter" && active) return okEdit();
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        return deleteSelection();
      }
      // zkratky dle nastavení (Nastavení → Klávesové zkratky)
      const sc = prefs.shortcuts;
      const combo = keyCombo(e).toUpperCase();
      const is = (id: string) => (sc[id] ?? "").toUpperCase() === combo;
      const viewIds: [string, ViewName][] = [["view.iso", "iso"], ["view.front", "front"], ["view.top", "top"], ["view.right", "right"], ["view.back", "back"], ["view.bottom", "bottom"], ["view.left", "left"]];
      for (const [id, v] of viewIds) if (is(id)) return view(v);
      if (is("view.fit")) vp.current?.fit();
      if (is("feature.extrude") && !isAsm) addFeature("extrude");
      if (is("feature.hole") && !isAsm) addFeature("hole");
      if (is("feature.fillet") && !isAsm) addFeature("fillet");
      if (is("feature.chamfer") && !isAsm) addFeature("chamfer");
      if (is("sketch.new") && !isAsm) createSketch({ kind: "base", name: "XY", offset: 0 });
      if (is("tool.measure")) toggleMeasure();
      if (is("tool.section")) toggleSection();
      if (is("view.ortho")) setPref("ortho", !prefs.ortho);
      if (k === "g" && isAsm && asmSel) setGizmoOn((g) => (g ? null : { target: "component", id: asmSel, mode: "translate" }));
      if (k === "r" && gizmoOn) setGizmoOn({ ...gizmoOn, mode: gizmoOn.mode === "translate" ? "rotate" : "translate" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const sketch = doc.features.find((f) => f.id === sketchId) as Extract<Feature, { type: "sketch" }> | undefined;
  const sketchesForView = useMemo(
    () =>
      doc.features.filter(
        (f): f is Extract<Feature, { type: "sketch" }> =>
          f.type === "sketch" &&
          !f.suppressed &&
          (f.id === activeId ||
            !doc.features.some((x) => ((x.type === "extrude" || x.type === "revolve") && x.sketchId === f.id) || (x.type === "sweep" && x.profileId === f.id) || (x.type === "loft" && x.sketchIds.includes(f.id)))),
      ),
    [doc.features, activeId],
  );
  const sketchSnaps = useSketchSnaps();
  const datums = useMemo<Datum[]>(
    () => doc.features.flatMap((f) => (f.type === "datum" && !f.suppressed ? [{ id: f.id, name: f.name, origin: f.origin, normal: f.normal, xDir: f.xDir, size: f.size }] : [])),
    [doc.features],
  );
  // pomocné osy / body / souřadné systémy – řeší je jádro nad postaveným tělesem
  const [datumGfx, setDatumGfx] = useState<DatumGfx[]>([]);
  useEffect(() => {
    if (isAsm || !doc.features.some((f) => f.type === "datumAxis" || f.type === "datumPoint" || f.type === "csys")) {
      setDatumGfx((v) => (v.length ? [] : v));
      return;
    }
    let dead = false;
    cad.datumGfx(doc).then((list) => !dead && setDatumGfx(list.map((x) => x.gfx)), () => undefined);
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, doc.features, isAsm]);
  const setSketchEntities = useCallback(
    (entities: SketchEntity[], record = true) => {
      if (!sketchId) return;
      const next = { ...doc, features: doc.features.map((f) => (f.id === sketchId ? ({ ...f, entities } as Feature) : f)) };
      (record ? commit : live)(next);
    },
    [doc, sketchId, commit, live],
  );
  /** změna skici z editoru: entity + vazby + kóty najednou */
  const setSketchPatch = useCallback(
    (patch: SketchPatch, record = true) => {
      if (!sketchId) return;
      const next = { ...doc, features: doc.features.map((f) => (f.id === sketchId ? ({ ...f, ...patch } as Feature) : f)) };
      (record ? commit : live)(next);
    },
    [doc, sketchId, commit, live],
  );

  const mat = MATERIALS.find((m) => m.id === doc.material) ?? MATERIALS[0];
  const m = result?.metrics;
  const errors = result?.status.filter((s) => !s.ok) ?? [];
  const warnings = result?.status.filter((s) => s.ok && s.warning) ?? [];
  const geomBad = !isAsm && result?.metrics && (result.metrics.valid === false || result.metrics.solids === 0);
  const bg = BACKGROUNDS[prefs.bg] ?? BACKGROUNDS.blue;
  const hasBody = isAsm ? asmViews.length > 0 : !!result?.mesh;

  // ---------- pás karet ----------
  const askNum = (label: string, def: number) => {
    const raw = window.prompt(label, String(def));
    if (raw === null) return null;
    const v = Number(raw.replace(",", "."));
    return Number.isFinite(v) ? v : null;
  };
  const selVerts = selection.filter((x): x is Extract<SelItem, { kind: "vertex" }> => x.kind === "vertex" && !x.compId).map((x) => x.point);
  const v3 = {
    sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    mul: (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k],
    dot: (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: (a: Vec3) => Math.hypot(a[0], a[1], a[2]),
    norm: (a: Vec3): Vec3 => {
      const l = Math.hypot(a[0], a[1], a[2]) || 1;
      return [a[0] / l, a[1] / l, a[2] / l];
    },
  };
  const offsetPlane = (name: "XY" | "XZ" | "YZ") => () => {
    const d = askNum(tr("Odsazení roviny {0} (mm, kladně ve směru normály)", name), 10);
    if (d !== null) createSketch({ kind: "base", name, offset: d });
  };
  const parallelFace = async () => {
    const i = selFaces[0];
    const info = await cad.face(i);
    if (!info?.planar) return flash(tr("Vyberte rovinnou plochu."));
    const d = askNum(tr("Odsazení od plochy (mm, kladně ve směru normály plochy)"), 10);
    if (d === null) return;
    createSketch({ kind: "custom", origin: v3.add(info.origin, v3.mul(info.normal, d)), normal: info.normal, xDir: info.xDir, label: tr("Plocha {0} {1}{2} mm", i + 1, d >= 0 ? "+" : "", d) });
  };
  const midPlane = async () => {
    const [a, b] = await Promise.all(selFaces.slice(0, 2).map((i) => cad.face(i)));
    if (!a?.planar || !b?.planar) return flash(tr("Vyberte dvě rovinné plochy."));
    const n = v3.norm(a.normal);
    if (Math.abs(v3.dot(n, v3.norm(b.normal))) > 0.999) {
      const dist = v3.dot(v3.sub(b.origin, a.origin), n);
      return createSketch({ kind: "custom", origin: v3.add(a.origin, v3.mul(n, dist / 2)), normal: n, xDir: a.xDir, label: tr("Střední rovina") });
    }
    // různoběžné plochy: půlicí rovina (úhlová osa normál) středem mezi plochami
    const nb = v3.norm(b.normal);
    const bis = v3.norm(v3.dot(n, nb) < 0 ? v3.sub(n, nb) : v3.add(n, nb));
    const x = v3.norm(v3.cross(bis, Math.abs(bis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
    flash(tr("Plochy nejsou rovnoběžné – založena půlicí rovina."));
    createSketch({ kind: "custom", origin: v3.mul(v3.add(a.origin, b.origin), 0.5), normal: bis, xDir: x, label: tr("Půlicí rovina") });
  };
  const threePoints = () => {
    const [p0, p1, p2] = selVerts;
    const x = v3.norm(v3.sub(p1, p0));
    const n0 = v3.cross(x, v3.sub(p2, p0));
    if (v3.len(n0) < 1e-6) return flash(tr("Body leží na jedné přímce – rovinu nelze určit."));
    createSketch({ kind: "custom", origin: p0, normal: v3.norm(n0), xDir: x, label: tr("Rovina 3 body") });
  };
  const sketchPlanes: RMenuEntry[] = [
    { divider: true, label: tr("Rovina skici") },
    { id: "xy", label: tr("Rovina XY (půdorys)"), icon: "datum", tone: "ref", onClick: () => createSketch({ kind: "base", name: "XY", offset: 0 }) },
    { id: "xz", label: tr("Rovina XZ (nárys)"), icon: "datum", tone: "ref", onClick: () => createSketch({ kind: "base", name: "XZ", offset: 0 }) },
    { id: "yz", label: tr("Rovina YZ (bokorys)"), icon: "datum", tone: "ref", onClick: () => createSketch({ kind: "base", name: "YZ", offset: 0 }) },
    { id: "face", label: tr("Na rovinné ploše modelu…"), icon: "face", tone: "sketch", disabled: !hasBody, onClick: () => { setPlanePick(true); setActiveId(null); flash(tr("Klikněte na rovinnou plochu modelu.")); } },
    { divider: true, label: tr("Odsazené a odvozené roviny") },
    { id: "xyo", label: tr("XY s odsazením…"), icon: "datum", tone: "ref", onClick: offsetPlane("XY") },
    { id: "xzo", label: tr("XZ s odsazením…"), icon: "datum", tone: "ref", onClick: offsetPlane("XZ") },
    { id: "yzo", label: tr("YZ s odsazením…"), icon: "datum", tone: "ref", onClick: offsetPlane("YZ") },
    { id: "faceOff", label: tr("Rovnoběžně s vybranou plochou…"), icon: "face", tone: "sketch", disabled: selFaces.length !== 1, hint: tr("nejdřív vyberte 1 rovinnou plochu"), onClick: parallelFace },
    { id: "mid", label: tr("Střední rovina mezi 2 plochami"), icon: "face", tone: "sketch", disabled: selFaces.length !== 2, hint: tr("nejdřív vyberte 2 plochy"), onClick: midPlane },
    { id: "pts", label: tr("Třemi body (3 vybrané vrcholy)"), icon: "datum", tone: "ref", disabled: selVerts.length !== 3, hint: tr("filtr výběru Bod → vyberte 3 vrcholy"), onClick: threePoints },
    ...(datums.length ? ([{ divider: true, label: tr("Pomocné roviny") }, ...datums.map((d) => ({ id: d.id, label: d.name, icon: "datum" as CadIconName, tone: "ref" as const, onClick: () => createSketch({ kind: "custom", origin: d.origin, normal: d.normal, xDir: d.xDir, label: d.name }) }))] as RMenuEntry[]) : []),
  ];
  const exportEntries: RMenuEntry[] = EXPORTS.map((e) => ({ id: e.f, label: e.label, icon: "export", tone: "file", hint: e.hint, disabled: !hasBody, onClick: () => exportModel(e.f) }));

  // ---------- formařské nástroje ----------
  const draftResult = useMemo<DraftResult | null>(() => (draftSetup.on && !isAsm && result?.mesh ? draftAnalysis(result.mesh, draftSetup.pull, draftSetup.minDeg) : null), [draftSetup, result, isAsm]);
  const analysis = useMemo(() => {
    const mesh = result?.mesh;
    if (!mesh || isAsm) return { colors: null as Float32Array | null, info: undefined as string | undefined };
    if (surface.mode === "curvature") {
      const c = curvatureColors(mesh);
      return { colors: c.colors, info: tr("Křivost min {0} · max {1} 1/mm (plná barva při ±{2})", fmtNum(c.min, 4), fmtNum(c.max, 4), fmtNum(c.range, 4)) };
    }
    if (surface.mode === "thickness") {
      const w = wallThickness(mesh, surface.limit);
      return { colors: w.colors, info: tr("Nejtenčí stěna ≈ {0} mm · průměr {1} mm · pod limitem {2} % vzorků", fmtNum(w.min, 2), fmtNum(w.avg, 2), fmtNum(w.below * 100, 1)) };
    }
    return { colors: null, info: undefined };
  }, [result, isAsm, surface.mode, surface.limit]);
  const vertexColors = useMemo(() => analysis.colors ?? (draftResult && result?.mesh ? draftVertexColors(result.mesh, draftResult) : null), [analysis.colors, draftResult, result]);
  const ejectors = useMemo<EjectorSuggestion[]>(() => (m ? suggestEjectors(m.bbox) : []), [m]);
  const addEjectors = (list: EjectorSuggestion[], mode: "holes" | "pins") => {
    if (!m) return;
    if (mode === "holes") {
      const fs: Feature[] = list.map((e, i) => ({ id: uid(), name: tr("Vyhazovač {0}", i + 1), type: "hole", position: [e.x, e.y, m.bbox[1][2]], axis: "Z", flip: false, diameter: e.d + 0.05, depth: 0, cbDiameter: 0, cbDepth: 0, kind: "simple" }));
      commit({ ...doc, features: [...doc.features, ...fs] });
      flash(tr("{0} děr pro vyhazovače přidáno do historie.", fs.length));
    } else {
      const a = emptyAssembly(tr("Sestava – {0}", doc.name));
      const len = Math.ceil((m.bbox[1][2] - m.bbox[0][2] + 100) / 10) * 10;
      a.components = [
        partComponent(doc, {}, { group: "Díly", fixed: true, color: doc.color ?? "#b9c2cc" }),
        ...list.map((e) => partComponent(ejectorPin(e.d, len), { position: [e.x, e.y, m.bbox[0][2] - len - 5] }, { group: "Vyhazování", color: "#e03930" })),
      ];
      openDocInTab(a);
      setMoldTools(false);
    }
  };
  const addCooling = (p: CoolingParams, mode: "part" | "component") => {
    const c = coolingCircuit(p);
    if (mode === "part") {
      const fs = c.features.map((f) => ({ ...f, id: uid(), ...(f.type === "cylinder" ? { mode: "cut" as const } : {}) })) as Feature[];
      commit({ ...doc, features: [...doc.features, ...fs] });
      flash(tr("Chladicí kanály vyvrtány do dílu (prvky Kanál/Propojka v historii)."));
    } else {
      insertComponent(partComponent(c, {}, { group: "Chlazení", color: "#1c7ed6" }));
    }
  };

  const baseGroups: Record<Exclude<Tab, "surface" | "sheet" | "weld">, RGroup[]> = {
    create: [
      { label: tr("Skica"), items: [{ id: "sketch", label: tr("Skica"), icon: "sketch", tone: "sketch", menu: sketchPlanes, active: planePick, hint: tr("2D profil na rovině nebo ploše") }] },
      {
        label: tr("Tvar"),
        big: 2,
        items: [
          { id: "extrude", label: tr("Vysunout"), icon: "extrude", tone: "create", kbd: "E", onClick: () => addFeature("extrude") },
          { id: "revolve", label: tr("Rotovat"), icon: "revolve", tone: "create", onClick: () => addFeature("revolve") },
          { id: "sweep", label: tr("Tažení"), icon: "sweep", tone: "create", onClick: () => addFeature("sweep"), hint: tr("profil po dráze") },
          { id: "loft", label: tr("Šablonovat"), icon: "loft", tone: "create", onClick: () => addFeature("loft"), hint: tr("přechod mezi profily") },
          { id: "text", label: tr("Text"), icon: "text", tone: "create", onClick: () => addFeature("text"), hint: tr("gravírování / reliéf") },
        ],
      },
      {
        label: tr("Primitiva"),
        big: 0,
        items: [
          { id: "box", label: tr("Kvádr"), icon: "box", tone: "create", onClick: () => addFeature("box") },
          { id: "cylinder", label: tr("Válec"), icon: "cylinder", tone: "create", onClick: () => addFeature("cylinder") },
          { id: "tube", label: tr("Trubka"), icon: "tube", tone: "create", onClick: () => addFeature("tube") },
          { id: "cone", label: tr("Kužel"), icon: "cone", tone: "create", onClick: () => addFeature("cone") },
          { id: "sphere", label: tr("Koule"), icon: "sphere", tone: "create", onClick: () => addFeature("sphere") },
        ],
      },
      {
        label: tr("Konstrukční prvky"),
        big: 1,
        items: [
          { id: "hole", label: tr("Díra"), icon: "hole", tone: "cut", kbd: "H", onClick: () => addFeature("hole"), hint: tr("vrtaná, zahloubená, se závitem") },
          { id: "thread", label: tr("Závit"), icon: "thread", tone: "cut", onClick: () => addFeature("thread") },
          { id: "split", label: tr("Rozříznout"), icon: "split", tone: "cut", onClick: () => addFeature("split") },
          { id: "rib", label: tr("Žebro"), icon: "rib", tone: "create", onClick: () => addFeature("rib"), hint: tr("z otevřené skici") },
          { id: "spring", label: tr("Pružina"), icon: "spring", tone: "create", onClick: () => addFeature("spring"), hint: tr("šroubovice s průřezem") },
        ],
      },
      {
        label: tr("Úpravy"),
        big: 1,
        items: [
          { id: "fillet", label: tr("Zaoblit"), icon: "fillet", tone: "feature", onClick: () => (selEdges.length ? addWithEdges("fillet") : addFeature("fillet")) },
          { id: "chamfer", label: tr("Srazit"), icon: "chamfer", tone: "feature", onClick: () => (selEdges.length ? addWithEdges("chamfer") : addFeature("chamfer")) },
          { id: "draft", label: tr("Úkos"), icon: "draft", tone: "feature", onClick: () => (selFaces.length ? addWithFaces("draft") : addFeature("draft")) },
          { id: "shell", label: tr("Skořepina"), icon: "shell", tone: "feature", onClick: () => (selFaces.length ? addWithFaces("shell") : addFeature("shell")) },
        ],
      },
      {
        label: tr("Přímé úpravy"),
        big: 1,
        items: [
          { id: "pushPull", label: tr("Vytáhnout / Zatlačit"), icon: "pushPull", tone: "feature", onClick: () => (selFaces.length ? addWithFaces("pushPull") : addFeature("pushPull")), hint: tr("posun vybraných ploch") },
          { id: "offsetFace", label: tr("Odsadit plochu"), icon: "offsetFace", tone: "feature", onClick: () => (selFaces.length ? addWithFaces("offsetFace") : addFeature("offsetFace")) },
          { id: "deleteFace", label: tr("Odstranit plochu"), icon: "deleteFace", tone: "cut", onClick: () => (selFaces.length ? addWithFaces("deleteFace") : addFeature("deleteFace")), hint: tr("odebere zaoblení, díry… a zacelí těleso") },
          { id: "thicken", label: tr("Zesílit"), icon: "thicken", tone: "feature", onClick: () => (selFaces.length ? addWithFaces("thicken") : addFeature("thicken")) },
          { id: "faceColor", label: tr("Barva plochy"), icon: "palette", tone: "view", disabled: !selFaces.length, menu: [COLORS[6], COLORS[4], COLORS[5], COLORS[0], COLORS[7]].map((c) => ({ id: c.c, label: `● ${c.l}`, icon: "palette" as CadIconName, onClick: () => setFaceColor(selFaces, c.c) })).concat([{ id: "reset", label: tr("Výchozí barva"), icon: "palette" as CadIconName, onClick: () => setFaceColor(selFaces, null) }]) },
        ],
      },
      {
        label: tr("Základní editace"),
        big: 0,
        items: [
          { id: "pattern", label: tr("Pole"), icon: "pattern", tone: "pattern", onClick: addPattern },
          { id: "mirror", label: tr("Zrcadlit"), icon: "mirror", tone: "pattern", onClick: () => addFeature("mirror") },
          { id: "transform", label: tr("Přesunout / otočit"), icon: "transform", tone: "pattern", onClick: startBodyGizmo, hint: tr("gizmo – posun 1 mm, otočení 15°") },
        ],
      },
      {
        label: tr("Tělesa"),
        big: 0,
        items: [
          { id: "splitBodies", label: tr("Rozdělit na tělesa"), icon: "split", tone: "cut", onClick: () => addFeature("splitBodies"), hint: tr("rovina rozdělí těleso na dvě samostatná tělesa") },
          { id: "copyBody", label: tr("Kopie tělesa"), icon: "copy", tone: "pattern", onClick: () => addFeature("copyBody"), hint: tr("další těleso jako posunutá kopie") },
          { id: "combine", label: tr("Sloučit tělesa"), icon: "layers", tone: "pattern", onClick: () => addFeature("combine"), hint: tr("sjednotit, odebrat nebo průnik dvou těles") },
        ],
      },
      {
        label: tr("Mazání"),
        big: 1,
        items: [{ id: "delete", label: tr("Smazat"), icon: "trash", tone: "cut", kbd: "Del", onClick: deleteSelection, hint: tr("smaže upravovaný / vybraný prvek, vybranou plochu (Odstranit plochu) nebo celé těleso") }],
      },
      {
        label: tr("Reference"),
        big: 1,
        items: [
          { id: "datum", label: tr("Rovina"), icon: "datum", tone: "ref", onClick: () => addFeature("datum"), hint: tr("pomocná rovina – 12 způsobů zadání") },
          { id: "datumAxis", label: tr("Osa"), icon: "datumAxis", tone: "ref", onClick: () => addFeature("datumAxis"), hint: tr("pomocná osa – hrana, válec, 2 body, průsečnice rovin…") },
          { id: "datumPoint", label: tr("Bod"), icon: "datumPoint", tone: "ref", onClick: () => addFeature("datumPoint"), hint: tr("pomocný bod – vrchol, střed, průsečík, odsazení…") },
          { id: "csys", label: tr("Souř. systém"), icon: "csys", tone: "ref", onClick: () => addFeature("csys"), hint: tr("souřadný systém z bodu a směrů") },
        ],
      },
      { label: tr("Knihovna"), items: [{ id: "library", label: tr("Normálie"), icon: "table", tone: "pattern", kbd: "Ctrl+L", onClick: () => setLibraryOpen({}), hint: tr("šrouby, ložiska, ozubená kola, profily… – stačí napsat „M8x30“") }] },
    ],
    asm: [
      {
        label: tr("Vložit"),
        big: 3,
        items: [
          { id: "ins", label: tr("Vložit díl / model"), icon: "open", tone: "file", onClick: () => fileInput.current?.click(), hint: tr(".mncad díl nebo STEP/IGES/STL… jako komponenta") },
          { id: "library", label: tr("Knihovna normálií"), icon: "table", tone: "pattern", kbd: "Ctrl+L", onClick: () => setLibraryOpen({}), hint: tr("šrouby, ložiska, ozubená kola, profily… – stačí napsat") },
          { id: "newpart", label: tr("Nový díl"), icon: "new", tone: "create", onClick: () => { const d = { ...emptyDoc(tr("Nový díl")), kind: "part" as const }; const c = partComponent(d, {}, { group: "Díly" }); commit({ ...doc, components: [...(doc.components ?? []), c] }); setTimeout(() => editPartInContext(c), 0); } },
        ],
      },
      {
        label: tr("Normálie"),
        big: 0,
        items: [
          { id: "screw", label: tr("Šroub ISO 4762"), icon: "thread", tone: "pattern", menu: (["M6", "M8", "M10", "M12", "M16"] as const).flatMap((m) => [20, 40, 60].map((l) => ({ id: `${m}x${l}`, label: `${m} × ${l}`, icon: "thread" as CadIconName, onClick: () => insertPart(screwISO4762(m, l)) }))) },
          { id: "pillar", label: tr("Vodicí sloupek"), icon: "cylinder", tone: "pattern", menu: [16, 20, 24, 30, 40].map((d) => ({ id: `p${d}`, label: tr("Ø{0} × {1}", d, d * 5), icon: "cylinder" as CadIconName, onClick: () => insertPart(guidePillar(d, d * 5), tr("Vedení")) })) },
          { id: "bush", label: tr("Vodicí pouzdro"), icon: "tube", tone: "pattern", menu: [16, 20, 24, 30, 40].map((d) => ({ id: `b${d}`, label: tr("Ø{0} × {1}", d, d * 2), icon: "tube" as CadIconName, onClick: () => insertPart(guideBush(d, d * 2), tr("Vedení")) })) },
          { id: "pin", label: tr("Vyhazovač"), icon: "cylinder", tone: "pattern", menu: [3, 4, 5, 6, 8, 10].map((d) => ({ id: `e${d}`, label: tr("Ø{0} × 150", d), icon: "cylinder" as CadIconName, onClick: () => insertPart(ejectorPin(d, 150), tr("Vyhazování")) })) },
          { id: "ring", label: tr("Středicí kroužek"), icon: "tube", tone: "pattern", onClick: () => insertPart(locatingRing(100, 10)) },
        ],
      },
      {
        label: tr("Přesun"),
        big: 2,
        items: [
          { id: "gz", label: tr("Přesunout / otočit"), icon: "transform", tone: "pattern", kbd: "G", disabled: !asmSel, active: gizmoOn?.target === "component", onClick: () => (gizmoOn ? setGizmoOn(null) : asmSel && startCompGizmo(asmSel)) },
          { id: "delete", label: tr("Odebrat"), icon: "trash", tone: "cut", kbd: "Del", disabled: !asmSel && !selection.length, onClick: deleteSelection, hint: tr("odebere vybrané komponenty ze sestavy") },
          {
            id: "sub",
            label: tr("Podsestava"),
            icon: "layers",
            tone: "create",
            menu: [
              {
                id: "mk",
                label: tr("Vytvořit z vybraných (Ctrl+klik)"),
                icon: "layers",
                onClick: () => {
                  const tops = [...new Set(selection.flatMap((x) => (x.kind === "component" || x.kind === "body" || x.kind === "face" ? [((x.topId ?? x.compId) ?? "").split("/")[0]] : [])).filter(Boolean))];
                  if (tops.length < 1) return flash(tr("Vyberte komponenty (filtr Komponenta, Ctrl+klik)."));
                  commit(makeSubassembly(doc, tops, tr("Podsestava {0}", (doc.components ?? []).filter((x) => x.source.kind === "asm").length + 1)));
                  setSelection([]);
                },
              },
              { id: "dis", label: tr("Rozpustit vybranou"), icon: "layers", disabled: doc.components?.find((c) => c.id === asmSel)?.source.kind !== "asm", onClick: () => asmSel && commit(dissolveSubassembly(doc, asmSel)) },
              { id: "open", label: tr("Otevřít vybranou"), icon: "edit", disabled: doc.components?.find((c) => c.id === asmSel)?.source.kind !== "asm", onClick: () => { const c = doc.components?.find((x) => x.id === asmSel); if (c) editPartInContext(c); } },
            ],
          },
        ],
      },
      { label: tr("Formy"), items: [{ id: "mold", label: tr("Rám formy"), icon: "layers", tone: "create", onClick: () => setMoldOpen(true), hint: tr("kompletní rám vstřikovací formy") }] },
      {
        label: tr("Vazby"),
        big: 0,
        items: [
          { id: "m1", label: tr("Kontakt"), icon: "datum", tone: "ref", disabled: !asmSel, active: mate?.mode === "mate", onClick: () => asmSel && startMate(asmSel, "mate") },
          { id: "m2", label: tr("Zarovnat"), icon: "datum", tone: "ref", disabled: !asmSel, active: mate?.mode === "flush", onClick: () => asmSel && startMate(asmSel, "flush") },
          { id: "m3", label: tr("Vystředit"), icon: "datum", tone: "ref", disabled: !asmSel, active: mate?.mode === "center", onClick: () => asmSel && startMate(asmSel, "center") },
        ],
      },
      {
        label: tr("Analýza"),
        big: 2,
        items: [
          { id: "clash", label: tr("Kolize"), icon: "section", tone: "cut", disabled: !hasBody, active: !!clashes?.length, onClick: runInterference, hint: tr("kontrola průniků komponent") },
          { id: "bom", label: tr("Kusovník"), icon: "table", tone: "tool", disabled: !bom.length, onClick: () => setBomOpen(true) },
          { id: "exp", label: explode ? tr("Složit") : tr("Rozložit"), icon: "transform", tone: "pattern", active: explode > 0, onClick: () => setExplode((e) => (e ? 0 : 1.2)) },
        ],
      },
    ],
    sketch: sketchRibbon({
      tool,
      setTool,
      snapGrid,
      setSnapGrid: (v) => setSnapGrid(v),
      onExportDxf: () => sketch && download(`${safeName(sketch.name)}.dxf`, sketchToDxf(sketch.entities), "application/dxf"),
      onImportDxf: () => fileInput.current?.click(),
      snaps: sketchSnaps,
      setSnap: setSketchSnap,
    }),
    tools: [
      {
        label: tr("Analýza"),
        big: 2,
        items: [
          { id: "measure", label: tr("Měřit"), icon: "measure", tone: "tool", kbd: "M", active: measure, disabled: !hasBody, onClick: toggleMeasure, hint: tr("vzdálenost, úhel, poloměr mezi body, hranami, plochami") },
          { id: "inspect", label: tr("Vlastnosti"), icon: "info", tone: "tool", active: inspectOpen, onClick: () => setInspectOpen((v) => !v), hint: tr("informace o vybrané entitě") },
          {
            id: "filter",
            label: tr("Filtr: {0}", tr(FILTER_LABEL[selFilter])),
            icon: "select",
            tone: "tool",
            menu: (Object.keys(FILTER_LABEL) as SelFilter[]).filter((f) => isAsm || (f !== "component" && f !== "subasm")).map((f) => ({ id: f, label: tr(FILTER_LABEL[f]), icon: "select" as CadIconName, active: selFilter === f, onClick: () => setSelFilter(f) })),
          },
          { id: "mass", label: tr("Hmotnost"), icon: "mass", tone: "tool", disabled: !hasBody, onClick: () => setMassOpen(true), hint: tr("objem, plocha, hmotnost") },
          { id: "section", label: tr("Řez"), icon: "section", tone: "tool", kbd: "X", active: !!section, disabled: !hasBody, onClick: toggleSection },
        ],
      },
      {
        label: tr("Parametrizace"),
        big: 0,
        items: [
          { id: "vars", label: tr("Proměnné"), icon: "variables", tone: "tool", onClick: () => { setPanels(true); flash(tr("Proměnné najdete v levém panelu – záložka Proměnné.")); } },
          { id: "cfg", label: tr("Stavy dílu"), icon: "configs", tone: "tool", onClick: () => { setPanels(true); flash(tr("Stavy (konfigurace) najdete v levém panelu – záložka Stavy.")); } },
        ],
      },
      { label: tr("Formy"), items: [{ id: "moldtools", label: tr("Formařské nástroje"), icon: "layers", tone: "create", active: moldTools, disabled: isAsm || !hasBody, onClick: () => setMoldTools((v) => !v), hint: tr("analýza úkosů, smrštění, dělicí rovina, vyhazovače, chlazení") }] },
    ],
    view: [
      {
        label: tr("Pohledy"),
        big: 1,
        items: [
          { id: "iso", label: tr("Izometrie"), icon: "iso", tone: "view", kbd: "0", onClick: () => view("iso") },
          { id: "front", label: tr("Přední"), icon: "front", tone: "view", kbd: "1", onClick: () => view("front") },
          { id: "top", label: tr("Horní"), icon: "top", tone: "view", kbd: "2", onClick: () => view("top") },
          { id: "right", label: tr("Pravý"), icon: "right", tone: "view", kbd: "3", onClick: () => view("right") },
          { id: "back", label: tr("Zadní"), icon: "back", tone: "view", kbd: "4", onClick: () => view("back") },
          { id: "bottom", label: tr("Spodní"), icon: "bottom", tone: "view", kbd: "5", onClick: () => view("bottom") },
          { id: "left", label: tr("Levý"), icon: "left", tone: "view", kbd: "6", onClick: () => view("left") },
        ],
      },
      {
        label: tr("Styl zobrazení"),
        big: 0,
        items: (
          [
            ["shadedEdges", tr("Stínovaný s hranami"), "shadedEdges"],
            ["shaded", tr("Stínovaný"), "shaded"],
            ["wireframe", tr("Drátový"), "wireframe"],
            ["hiddenLine", tr("Skryté hrany"), "hiddenLine"],
            ["xray", tr("Průhledný"), "xray"],
          ] as [DisplayMode, string, CadIconName][]
        ).map(([d, l, i]) => ({ id: d, label: l, icon: i, tone: "view" as const, active: prefs.display === d, onClick: () => setPref("display", d) })),
      },
      {
        label: tr("Kamera"),
        big: 1,
        items: [
          { id: "fit", label: tr("Přizpůsobit"), icon: "fit", tone: "view", kbd: "F", onClick: () => vp.current?.fit() },
          { id: "persp", label: tr("Perspektiva"), icon: "perspective", tone: "view", active: !prefs.ortho, onClick: () => setPref("ortho", false) },
          { id: "ortho", label: tr("Pravoúhlá"), icon: "ortho", tone: "view", kbd: "P", active: prefs.ortho, onClick: () => setPref("ortho", true) },
          { id: "grid", label: tr("Mřížka a osy"), icon: "grid", tone: "view", active: showGrid, onClick: () => setShowGrid((v) => !v) },
        ],
      },
      {
        label: tr("Vzhled"),
        big: 0,
        items: [
          { id: "color", label: tr("Barva tělesa"), icon: "palette", tone: "view", menu: COLORS.map((c) => ({ id: c.c, label: c.l, icon: "cube" as CadIconName, active: (doc.color ?? COLORS[0].c) === c.c, onClick: () => commit({ ...doc, color: c.c }) })) },
          { id: "bg", label: tr("Pozadí"), icon: "layers", tone: "view", menu: Object.entries(BACKGROUNDS).map(([k, b]) => ({ id: k, label: b.label, icon: "layers" as CadIconName, active: prefs.bg === k, onClick: () => setPref("bg", k) })) },
          {
            id: "mouse",
            label: tr("Ovládání myši"),
            icon: "mouse",
            tone: "view",
            menu: [
              { id: "zw3d", label: tr("ZW3D – pravé otáčí, prostřední posouvá"), icon: "mouse", active: prefs.mouse === "zw3d", onClick: () => setPref("mouse", "zw3d") },
              { id: "solidworks", label: tr("SolidWorks – prostřední otáčí, Ctrl+prostř. posouvá"), icon: "mouse", active: prefs.mouse === "solidworks", onClick: () => setPref("mouse", "solidworks") },
              { id: "simple", label: tr("Touchpad – levé otáčí, pravé posouvá"), icon: "mouse", active: prefs.mouse === "simple", onClick: () => setPref("mouse", "simple") },
            ],
          },
        ],
      },
    ],
    drawing: [
      { label: tr("Výkresová dokumentace"), items: [{ id: "drw", label: tr("Nový výkres"), icon: "drawing", tone: "file", disabled: !hasBody, onClick: openDrawingTab, hint: tr("otevře se v nové záložce: pohledy, řezy, kóty, razítko → PDF/DXF/DWG/SVG") }] },
    ],
    data: [
      {
        label: tr("Program"),
        big: 0,
        items: [
          { id: "settings", label: tr("Nastavení"), icon: "settings", tone: "view", kbd: "Ctrl+,", onClick: () => setSettingsOpen(true) },
          { id: "palette", label: tr("Paleta příkazů"), icon: "measure", tone: "view", kbd: "Ctrl+K", onClick: () => setPaletteOpen(true) },
          { id: "start", label: tr("Úvodní obrazovka"), icon: "home", tone: "view", onClick: () => setStartOpen(true) },
        ],
      },
      {
        label: tr("Soubor"),
        big: 2,
        items: [
          { id: "open", label: tr("Otevřít / Import"), icon: "open", tone: "file", kbd: "Ctrl+O", onClick: () => fileInput.current?.click(), hint: tr("STEP, IGES, BREP, STL, OBJ, 3MF, glTF, PLY, DXF, .mncad") },
          { id: "save", label: tr("Uložit projekt"), icon: "save", tone: "file", kbd: "Ctrl+S", onClick: () => void saveProject(), hint: tr("zeptá se, kam a pod jakým názvem; další Ctrl+S ukládá do téhož souboru") },
          { id: "saveAs", label: tr("Uložit jako…"), icon: "save", tone: "file", onClick: () => void saveProjectAs(), hint: tr("nový soubor / jiné místo") },
        ],
      },
      { label: tr("Export 3D"), items: [{ id: "export", label: tr("Export"), icon: "export", tone: "file", menu: exportEntries }] },
      {
        label: tr("Sestava"),
        items: [
          {
            id: "asm",
            label: tr("Sestava"),
            icon: "layers",
            tone: "create",
            menu: [
              { id: "na", label: tr("Nová prázdná sestava"), icon: "layers", onClick: () => newAssembly(false) },
              { id: "nc", label: tr("Sestava z aktuálního dílu"), icon: "layers", disabled: isAsm || !doc.features.length, onClick: () => newAssembly(true) },
              { id: "mold", label: tr("Rám vstřikovací formy…"), icon: "layers", onClick: () => setMoldOpen(true) },
            ],
          },
        ],
      },
      { label: tr("Ukázky"), items: [{ id: "ex", label: tr("Ukázkové díly"), icon: "cube", tone: "create", menu: EXAMPLES.map((ex) => ({ id: ex.id, label: ex.label, icon: "cube" as CadIconName, onClick: () => loadExample(ex.make) })) }] },
    ],
  };

  const groups: Record<Tab, RGroup[]> = {
    ...baseGroups,
    create: [...baseGroups.create, ...extGroups("create")],
    tools: [...baseGroups.tools, ...extGroups("tools")],
    asm: [...baseGroups.asm, ...extGroups("asm")],
    drawing: [...baseGroups.drawing, ...extGroups("drawing")],
    surface: extGroups("surface"),
    sheet: extGroups("sheet"),
    weld: extGroups("weld"),
  };
  const tabs: [Tab, string][] = [
    isAsm ? ["asm", tr("Sestava")] : ["create", tr("Tvorba")],
    ...(!isAsm && groups.surface.length ? ([["surface", tr("Plochy")]] as [Tab, string][]) : []),
    ...(!isAsm && groups.sheet.length ? ([["sheet", tr("Plech")]] as [Tab, string][]) : []),
    ...(!isAsm && groups.weld.length ? ([["weld", tr("Svařence")]] as [Tab, string][]) : []),
    ...(sketch ? ([["sketch", tr("Skica")]] as [Tab, string][]) : []),
    ["tools", tr("Nástroje")],
    ["view", tr("Zobrazení")],
    ["drawing", tr("Výkres")],
    ["data", tr("Data")],
  ];
  const curTab: Tab = isAsm ? (tab === "create" || tab === "sketch" || tab === "surface" || tab === "sheet" || tab === "weld" ? "asm" : tab) : sketch ? (tab === "create" || tab === "asm" ? "sketch" : tab) : tab === "sketch" || tab === "asm" ? "create" : tab;

  // ---------- výzva v řádku příkazů ----------
  const prompt = refPick
    ? tr("{0} · nebo zadejte hodnotu v poli · pravé tlačítko v poli = další způsoby · Esc zruší", refPick.label)
    : isAsm
    ? boltPick
      ? tr("Šroubový spoj: klikněte na válcovou plochu díry (strana kliknutí = hlava šroubu) · Esc zruší")
      : mate
      ? matePrompt(mate)
      : measure
        ? measureSel.length < 2
          ? tr("Měření ({0}): klikněte na {1} entitu", tr(FILTER_LABEL[selFilter]), measureSel.length ? tr("druhou") : tr("první"))
          : tr("Měření hotovo – kliknutím začnete nové · Esc ukončí")
        : gizmoOn
          ? tr("Táhněte šipkami gizma (posun) nebo oblouky (otočení) · R přepne režim · Esc ukončí")
        : asmLoading
          ? tr("Stavím komponenty…")
          : asmSel
            ? tr("Komponenta vybrána: G = gizmo přesunu, vazby Kontakt/Zarovnat/Vystředit · pravé tlačítko = nabídka · Ctrl+klik = více")
            : tr("Sestava · {0} komponent · filtr výběru: {1} · pravé tlačítko = nabídka", doc.components?.length ?? 0, tr(FILTER_LABEL[selFilter]))
    : planePick
    ? tr("Vyberte rovinnou plochu, na které se založí skica · Esc zruší")
    : measure
      ? measureSel.length < 2
        ? tr("Měření ({0}): klikněte na {1} entitu – bod, hranu, plochu nebo těleso · najetím na hranu se nabídnou koncové body, střed a střed kružnice", tr(FILTER_LABEL[selFilter]), measureSel.length ? tr("druhou") : tr("první"))
        : tr("Měření hotovo – kliknutím začnete nové · Esc ukončí")
      : gizmoOn
        ? tr("Táhněte šipkami gizma (posun 1 mm) nebo oblouky (otočení 15°) · R přepne režim · Hotovo potvrdí")
      : sketch
        ? tr("Skica na rovině {0} · kreslete myší, rozměry upravíte v panelu vpravo", planeLabel(sketch.plane))
        : active
          ? active.type === "fillet" || active.type === "chamfer"
            ? active.edges === "all"
              ? tr("Zaoblí/srazí se všechny hrany · Enter = OK, Esc = Storno")
              : tr("Vyberte hrany v modelu (vybráno {0}) · Enter = OK", active.edges.length)
            : active.type === "shell"
              ? tr("Vyberte plochy, které se otevřou · Enter = OK")
              : active.type === "draft"
                ? tr("Vyberte plochy pro úkos · Enter = OK")
                : active.type === "hole"
                  ? tr("Klikněte na plochu, kam se má vrtat · Enter = OK")
                  : tr("{0}: upravte parametry · Enter = OK, Esc = Storno", featureLabel(active))
          : selection.length
            ? (hintsOn ? tr("Popisky zapnuté (Ctrl+Shift+L) · ") : "") + tr("Vybráno: {0}× {1} · pravé tlačítko = příkazy pro výběr · Esc zruší", selection.length, tr(KIND_LABEL[selection[0].kind]).toLowerCase())
            : tr("Filtr výběru: {0} · klikněte na entitu · pravé tlačítko = nabídka", tr(FILTER_LABEL[selFilter]));

  const vpContext = (x: number, y: number, item: SelItem | null) => {
    if (item && !mate && !measure && !selection.some((x2) => sameSel(x2, item))) {
      setSelection([item]);
      if (isAsm && item.kind !== "feature") {
        const top = item.topId ?? item.compId;
        if (top) setAsmSel(top.split("/")[0]);
      }
    }
    const ent = entityMenu(item);
    const entries: RMenuEntry[] = [
      ...ent,
      ...(ent.length ? ([{ divider: true, label: tr("Zobrazení") }] as RMenuEntry[]) : []),
      { id: "v-fit", label: tr("Přizpůsobit"), icon: "fit", kbd: "F", onClick: () => vp.current?.fit() },
      { id: "v-iso", label: tr("Izometrie"), icon: "iso", kbd: "0", onClick: () => view("iso") },
      ...(!item
        ? ([
            { id: "v-front", label: tr("Přední"), icon: "front", kbd: "1", onClick: () => view("front") },
            { id: "v-top", label: tr("Horní"), icon: "top", kbd: "2", onClick: () => view("top") },
            { id: "v-right", label: tr("Pravý"), icon: "right", kbd: "3", onClick: () => view("right") },
            { divider: true, label: tr("Styl") },
            { id: "v-se", label: tr("Stínovaný s hranami"), icon: "shadedEdges", active: prefs.display === "shadedEdges", onClick: () => setPref("display", "shadedEdges") },
            { id: "v-wf", label: tr("Drátový"), icon: "wireframe", active: prefs.display === "wireframe", onClick: () => setPref("display", "wireframe") },
            { id: "v-xr", label: tr("Průhledný"), icon: "xray", active: prefs.display === "xray", onClick: () => setPref("display", "xray") },
            { divider: true, label: tr("Filtr výběru") },
            ...(Object.keys(FILTER_LABEL) as SelFilter[])
              .filter((f) => isAsm || (f !== "component" && f !== "subasm"))
              .map((f) => ({ id: `flt-${f}`, label: FILTER_LABEL[f], icon: "select" as CadIconName, active: selFilter === f, onClick: () => setSelFilter(f) })),
          ] as RMenuEntry[])
        : []),
      { divider: true },
      { id: "v-ms", label: measure ? tr("Ukončit měření") : tr("Měřit"), icon: "measure", tone: "tool", kbd: "M", disabled: !hasBody, onClick: toggleMeasure },
      { id: "v-sec", label: section ? tr("Zrušit řez") : tr("Řez"), icon: "section", tone: "tool", kbd: "X", disabled: !hasBody, onClick: toggleSection },
      ...(selection.length ? ([{ id: "v-clr", label: tr("Zrušit výběr ({0})", selection.length), icon: "x", kbd: "Esc", onClick: () => { setSelection([]); setInspect(null); } }] as RMenuEntry[]) : []),
      ...(active ? ([{ divider: true }, { id: "v-ok", label: tr("OK – potvrdit prvek"), icon: "check", onClick: okEdit }, { id: "v-cancel", label: tr("Storno"), icon: "x", onClick: cancelEdit }] as RMenuEntry[]) : []),
    ];
    setCtx({ x, y, entries });
  };

  const paramCtx = useMemo(
    () => ({
      bindings: doc.bindings ?? {},
      values: resolved.values,
      setBinding: (key: string, expr: string | null) => {
        const b = { ...(doc.bindings ?? {}) };
        if (expr == null) delete b[key];
        else b[key] = expr;
        commit({ ...doc, bindings: b });
      },
    }),
    [doc, resolved.values, commit],
  );

  const measureGfx: MeasureGfx | null = measure && measureRes ? measureRes.gfx : null;
  const bb = m ? m.bbox : null;

  const buildCommands = (): Command[] => {
    const out: Command[] = [];
    const tabLabel: Record<Tab, string> = { create: tr("Tvorba"), sketch: tr("Skica"), surface: tr("Plochy"), sheet: tr("Plech"), weld: tr("Svařence"), asm: tr("Sestava"), tools: tr("Nástroje"), view: tr("Zobrazení"), drawing: tr("Výkres"), data: tr("Data") };
    (Object.keys(groups) as Tab[]).forEach((t) => {
      for (const g of groups[t])
        for (const it of g.items) {
          if (it.menu) {
            for (const e of it.menu) if (!("divider" in e)) out.push({ id: `${t}.${it.id}.${e.id}`, label: e.label, group: `${tabLabel[t]} › ${it.label}`, icon: e.icon, tone: e.tone ?? it.tone, kbd: e.kbd, hint: e.hint, disabled: e.disabled || it.disabled, run: () => e.onClick?.() });
          } else out.push({ id: `${t}.${it.id}`, label: it.label, group: `${tabLabel[t]} › ${g.label}`, icon: it.icon, tone: it.tone, kbd: it.kbd, hint: it.hint, disabled: it.disabled, run: () => it.onClick?.() });
        }
    });
    out.push(
      { id: "p.library", label: tr("Knihovna normálií (šrouby, ložiska, ozubená kola, profily…)"), group: "Program", icon: "table", tone: "pattern", kbd: "Ctrl+L", run: () => setLibraryOpen({}) },
      { id: "p.settings", label: tr("Nastavení"), group: "Program", icon: "settings", kbd: "Ctrl+,", run: () => setSettingsOpen(true) },
      { id: "p.start", label: tr("Úvodní obrazovka"), group: "Program", icon: "home", run: () => setStartOpen(true) },
      { id: "p.help", label: tr("Klávesové zkratky a ovládání"), group: "Program", icon: "help", run: () => setNotice({ title: tr("Ovládání a zkratky"), body: HELP }) },
      { id: "p.docs", label: tr("Dokumentace a návod k obsluze (web)"), group: "Program", icon: "info", run: () => window.open(langMeta().docs, "_blank", "noopener") },
      { id: "p.pdf", label: tr("Příručka PDF – stáhnout"), group: "Program", icon: "drawing", run: () => window.open(CAD_LINKS.pdf, "_blank", "noopener") },
      { id: "p.share", label: tr("Sdílet odkazem (WhatsApp, e-mail, Teams…)"), group: "Program", icon: "share", run: () => setShareOpen(true) },
      { id: "p.agent", label: tr("Textové příkazy – pro AI agenty a automatizaci"), group: "Program", icon: "palette", kbd: "Ctrl+Shift+K", run: () => setAgentOpen(true) },
      { id: "p.hints", label: tr("Popisky pro výběr myší (F1 / E2 / V3) – {0}", hintsOn ? "vypnout" : "zapnout"), group: "Program", icon: "filterSel", kbd: "Ctrl+Shift+L", run: () => setHintsOn((v) => !v) },
      { id: "p.rfq", label: tr("Poptat výrobu (STEP + e-mail)"), group: "Program", icon: "export", run: toRfq },
    );
    return out;
  };

  // ---------- UI ----------
  /** chipy záložek dokumentů (společné pro hlavičku na počítači a řádek na mobilu) */
  const tabChips = (
    <>
      {tabStrip.map((t) => (
        <div
          key={t.id}
          role="tab"
          aria-selected={t.id === tabId}
          className={cn("group flex h-8 min-w-0 max-w-[280px] shrink-0 items-center gap-1.5 rounded-t-md border-x border-t px-2 text-[12.5px]", t.id === tabId ? "border-white/15 bg-white/[0.09] text-white" : "border-transparent text-white/55 hover:bg-white/[0.05] hover:text-white/85")}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              closeTab(t.id);
            }
          }}
        >
          <button type="button" className="flex min-w-0 items-center gap-1.5" onClick={() => activateTab(t.id)} title={t.id === tabId ? tr("Aktivní dokument – název lze přepsat") : tr("Přepnout na: {0}", t.title)}>
            <CadIcon name={t.kind === "assembly" ? "layers" : t.kind === "drawing" ? "drawing" : "cube"} className="h-3.5 w-3.5 shrink-0 text-brand" />
            {t.id === tabId && t.kind !== "drawing" ? (
              <input
                value={doc.name}
                onChange={(e) => live({ ...doc, name: e.target.value })}
                onBlur={() => commit(doc)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && (e.target as HTMLInputElement).blur()}
                className="w-[min(32vw,200px)] min-w-0 bg-transparent font-medium text-white outline-none"
                aria-label={tr("Název dokumentu")}
              />
            ) : (
              <span className="truncate font-medium">{t.title}</span>
            )}
          </button>
          {t.id === tabId && doc.activeConfig && <span className="rounded bg-[#0e7490] px-1.5 text-[10px] font-semibold">{doc.configs?.find((c) => c.id === doc.activeConfig)?.name}</span>}
          <button type="button" aria-label={tr("Zavřít {0}", t.title)} title={tr("Zavřít záložku (prostřední tlačítko)")} onClick={() => closeTab(t.id)} className="rounded px-1 text-[14px] leading-none text-white/40 hover:bg-white/15 hover:text-white">
            ×
          </button>
        </div>
      ))}
      <button type="button" title={tr("Nový díl v nové záložce")} aria-label={tr("Nová záložka")} onClick={newDoc} className="mb-1 grid h-6 w-6 shrink-0 place-items-center rounded text-[16px] leading-none text-white/60 hover:bg-white/10 hover:text-white">
        +
      </button>
    </>
  );

  return (
    <ParamContext.Provider value={paramCtx}>
      <RefPickContext.Provider value={refCtxValue}>
      <div className="fixed inset-0 flex flex-col bg-[#e9edf1] font-sans text-[#1f2933]" onDragEnter={onDragOver} onDragOver={onDragOver} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropHint(false); }} onDrop={(e) => void onDrop(e)}>
        {dropHint && (
          <div className="pointer-events-none fixed inset-0 z-[90] grid place-items-center bg-[#0b1220]/40">
            <div className="rounded-2xl border-2 border-dashed border-white/80 bg-white/95 px-10 py-8 text-center shadow-2xl">
              <p className="text-[17px] font-semibold text-[#1f2933]">{tr("Pusťte soubor – otevře se v nové záložce CADu")}</p>
              <p className="mt-1 text-[12.5px] text-[#6b7785]">{tr("STEP, IGES, BREP, STL, OBJ, 3MF, glTF, PLY, DXF, .mncad · u nativních formátů (Parasolid, SolidWorks…) poradíme převod")}</p>
            </div>
          </div>
        )}
        {/* Titulní lišta */}
        <header className="flex h-10 shrink-0 items-center gap-1 bg-gradient-to-b from-[#262b31] to-[#1c2025] px-2 text-white/85">
          <Link href="/" className="flex items-center gap-2 pr-2" title={tr("Zpět na web mnastrojarna.cz")}>
            <LogoMark className="h-6 w-6" />
            <span className="hidden font-display text-[14px] font-bold uppercase tracking-tight text-white sm:inline">
              {tr("Mnástrojárna")}{" "}<span className="text-brand">CAD</span>
            </span>
          </Link>
          <div className="mx-1 h-5 w-px bg-white/15" />
          <div className="hidden items-center gap-1 sm:flex">
            <QBtn icon="new" title={tr("Nový díl")} onClick={newDoc} />
            <QBtn icon="open" title={tr("Otevřít / importovat (Ctrl+O)")} onClick={() => fileInput.current?.click()} />
            <QBtn icon="save" title={tr("Uložit projekt (Ctrl+S)")} onClick={() => void saveProject()} />
            <div className="mx-1 h-5 w-px bg-white/15" />
          </div>
          <QBtn icon="undo" title={tr("Zpět (Ctrl+Z)")} onClick={undo} disabled={!hist.past.length} />
          <QBtn icon="redo" title={tr("Znovu (Ctrl+Y)")} onClick={redo} disabled={!hist.future.length} />
          {/* záložky otevřených dokumentů (díly, sestavy, výkresy) – na mobilu ve vlastním řádku pod lištou */}
          {narrow ? (
            <span className="flex-1" />
          ) : (
            <div className="flex min-w-0 flex-1 items-end gap-0.5 self-stretch overflow-x-auto overflow-y-hidden px-1 pt-1 [scrollbar-width:none] [touch-action:pan-x]" role="tablist" aria-label={tr("Otevřené dokumenty")}>
              {tabChips}
            </div>
          )}
          <span className={cn("hidden items-center gap-1.5 font-mono text-[10.5px] lg:flex", core === "error" || glError ? "text-brand" : "text-white/55")}>
            <span className={cn("h-2 w-2 rounded-full", core === "ready" ? (busy ? "animate-pulse bg-amber-400" : "bg-emerald-400") : core === "loading" ? "animate-pulse bg-amber-400" : "bg-brand")} />
            {glError ? (
              tr("3D okno: nedostupné (WebGL)")
            ) : core === "loading" ? (
              tr("Načítám jádro OpenCascade…")
            ) : core === "error" ? (
              tr("Jádro se nenačetlo")
            ) : busy ? (
              tr("Přepočítávám…")
            ) : stale ? (
              <button type="button" data-recompute className="text-amber-300 underline decoration-dotted underline-offset-2 hover:text-white" title={tr("Výpočet byl zrušen – kliknutím se model přepočítá")} onClick={() => runBuild(buildDocView)}>
                {tr("Výpočet zrušen · přepočítat")}
              </button>
            ) : (
              tr("OCCT · {0}", result ? `${result.ms} ms` : "připraveno")
            )}
          </span>
          <QBtn icon="measure" title={tr("Paleta příkazů (Ctrl+K)")} onClick={() => setPaletteOpen(true)} />
          <QBtn icon="settings" title={tr("Nastavení (Ctrl+,)")} onClick={() => setSettingsOpen(true)} />
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            disabled={!doc.features.length && !doc.components?.length}
            title={tr("Sdílet odkazem (WhatsApp, e-mail, Teams…) – příjemce otevře díl v prohlížeči")}
            aria-label={tr("Sdílet")}
            className="flex h-7 items-center gap-1 rounded px-1.5 text-[12px] font-medium text-white/85 hover:bg-white/10 disabled:opacity-40"
          >
            <CadIcon name="share" className="h-4 w-4" />
            <span className="hidden md:inline">{tr("Sdílet")}</span>
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setHelpMenu((v) => !v)}
              title={tr("Nápověda: dokumentace a návod k obsluze, příručka PDF, klávesové zkratky")}
              aria-label={tr("Nápověda")}
              aria-expanded={helpMenu}
              className={cn("flex h-7 items-center gap-1 rounded px-1.5 text-[12px] font-medium text-white/85 hover:bg-white/10", helpMenu && "bg-white/10")}
            >
              <CadIcon name="help" className="h-4 w-4" />
              <span className="hidden md:inline">{tr("Nápověda")}</span>
            </button>
            {helpMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setHelpMenu(false)} />
                <Dropdown
                  close={() => setHelpMenu(false)}
                  className="left-auto right-0 z-50 w-[320px]"
                  entries={[
                    { divider: true, label: tr("Dokumentace") },
                    { id: "docs", label: tr("Dokumentace a návod k obsluze (web)"), icon: "info", hint: tr("24 kapitol, postupy krok za krokem, FAQ – otevře se v nové záložce"), onClick: () => window.open(langMeta().docs, "_blank", "noopener") },
                    { id: "pdf", label: tr("Příručka PDF – stáhnout"), icon: "drawing", hint: tr("kompletní příručka k tisku a offline čtení"), onClick: () => window.open(CAD_LINKS.pdf, "_blank", "noopener") },
                    { divider: true, label: tr("Ovládání") },
                    { id: "help", label: tr("Klávesové zkratky a ovládání myší"), icon: "help", onClick: () => setNotice({ title: tr("Ovládání a zkratky"), body: HELP }) },
                    { id: "palette", label: tr("Paleta příkazů"), icon: "palette", kbd: "Ctrl+K", hint: tr("napište název příkazu („díra“, „výkres“, „zaoblit“…)"), onClick: () => setPaletteOpen(true) },
                    { id: "settings", label: tr("Nastavení…"), icon: "settings", kbd: "Ctrl+,", onClick: () => setSettingsOpen(true) },
                    { divider: true },
                    { id: "hints", label: tr("Popisky pro výběr myší (F1 / E2 / V3) – {0}", hintsOn ? "vypnout" : "zapnout"), icon: "filterSel", kbd: "Ctrl+Shift+L", active: hintsOn, hint: tr("štítky na plochách, hranách a vrcholech: klik na štítek = klik na entitu; pro AI agenty, automatizaci a dotyk"), onClick: () => setHintsOn((v) => !v) },
                    { id: "agent", label: tr("Textové příkazy – pro AI agenty i rychlé zadání"), icon: "palette", kbd: "Ctrl+Shift+K", hint: tr("kvádr 100 60 20 · díra 8,5 skrz v 20 30 · zaoblit 2 hrany svislé · JSON dokumentu · window.mncad"), onClick: () => setAgentOpen(true) },
                    { id: "diag", label: tr("Zkopírovat diagnostiku (bez dat dokumentu)"), icon: "info", hint: tr("verze programu, prohlížeč, WebGL, jádro, chyba – pro e-mail podpoře"), onClick: () => void copyDiagnostics() },
                    { id: "web", label: tr("Zpět na web mnastrojarna.cz"), icon: "home", onClick: () => window.location.assign("/") },
                  ]}
                />
              </>
            )}
          </div>
          <button type="button" onClick={toRfq} className="ml-2 whitespace-nowrap rounded bg-brand px-3 py-1 text-[12px] font-semibold text-white shadow hover:bg-brand-600">
            {tr("Poptat")}<span className="hidden sm:inline"> {tr("výrobu")}</span>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={`.mncad,.json,${IMPORT_ACCEPT}`}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) openFile(f);
              e.target.value = "";
            }}
          />
        </header>
        {narrow && (
          <div className="flex h-9 shrink-0 items-stretch bg-[#1c2025] text-white/85">
            <div className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto overflow-y-hidden px-1 pt-1 [scrollbar-width:none] [touch-action:pan-x]" role="tablist" aria-label={tr("Otevřené dokumenty")}>
              {tabChips}
            </div>
            <div className="relative flex shrink-0 items-center border-l border-white/10 px-1">
              <button
                ref={tabMenuRef}
                type="button"
                onClick={() => setTabMenu((v) => !v)}
                aria-label={tr("Seznam otevřených dokumentů")}
                title={tr("Seznam otevřených dokumentů")}
                className="flex h-7 items-center gap-1 rounded px-2 text-[12px] font-semibold hover:bg-white/10"
              >
                <CadIcon name="layers" className="h-4 w-4" />
                {tabStrip.length}
                <span className="text-[8px]">▼</span>
              </button>
              {tabMenu && (
                <Dropdown
                  anchor={tabMenuRef.current}
                  close={() => setTabMenu(false)}
                  entries={[
                    { divider: true, label: tr("Otevřené dokumenty") },
                    ...tabStrip.map((t) => ({ id: t.id, label: t.id === tabId ? doc.name : t.title, icon: (t.kind === "assembly" ? "layers" : t.kind === "drawing" ? "drawing" : "cube") as CadIconName, active: t.id === tabId, onClick: () => activateTab(t.id) })),
                    { divider: true },
                    { id: "new", label: tr("Nový díl v nové záložce"), icon: "new", tone: "create", onClick: newDoc },
                    { id: "close", label: tr("Zavřít: {0}", tabStrip.find((t) => t.id === tabId)?.title ?? doc.name), icon: "x", onClick: () => closeTab(tabId) },
                  ]}
                />
              )}
            </div>
          </div>
        )}

        {/* Záložky pásu */}
        {/* řádek záložek pásu: na úzké obrazovce vodorovně posuvný (jen vodorovně – žádné svislé „plavání“) */}
        <div className="flex h-8 shrink-0 items-stretch gap-0.5 overflow-x-auto overflow-y-hidden bg-[#dfe5eb] px-1 [scrollbar-width:none] [touch-action:pan-x]">
          <div ref={appMenuRef} className="relative shrink-0 border-b border-[#d5dbe2] py-1">
            <button type="button" onClick={() => setAppMenu((v) => !v)} className="h-full rounded-sm bg-brand px-3 text-[12px] font-semibold text-white hover:bg-brand-600">
              {tr("Soubor")}
            </button>
            {appMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setAppMenu(false)} />
                <Dropdown
                  anchor={appMenuRef.current}
                  close={() => setAppMenu(false)}
                  className="z-50 w-[300px]"
                  entries={[
                    { id: "new", label: tr("Nový díl"), icon: "new", tone: "file", onClick: newDoc },
                    { id: "open", label: tr("Otevřít / importovat…"), icon: "open", tone: "file", kbd: "Ctrl+O", onClick: () => fileInput.current?.click() },
                    { id: "save", label: tr("Uložit projekt (.mncad)"), icon: "save", tone: "file", kbd: "Ctrl+S", onClick: () => void saveProject() },
                    { id: "saveAs", label: tr("Uložit jako…"), icon: "save", tone: "file", onClick: () => void saveProjectAs() },
                    { id: "share", label: tr("Sdílet odkazem…"), icon: "share", tone: "file", disabled: !doc.features.length && !doc.components?.length, hint: tr("WhatsApp, e-mail, Teams – příjemce otevře díl v prohlížeči, platnost např. 10 dní"), onClick: () => setShareOpen(true) },
                    { divider: true, label: tr("Export 3D") },
                    ...exportEntries,
                    { divider: true, label: tr("Výkres") },
                    { id: "drw", label: tr("Výkres PDF / DXF / DWG…"), icon: "drawing", tone: "file", disabled: !hasBody, onClick: openDrawingTab },
                    { divider: true, label: tr("Sestavy") },
                    { id: "na", label: tr("Nová sestava"), icon: "layers", tone: "create", onClick: () => newAssembly(false) },
                    { id: "nc", label: tr("Sestava z aktuálního dílu"), icon: "layers", tone: "create", disabled: isAsm || !doc.features.length, onClick: () => newAssembly(true) },
                    { id: "mold", label: tr("Rám vstřikovací formy…"), icon: "layers", tone: "create", onClick: () => setMoldOpen(true) },
                    { divider: true, label: tr("Ukázky") },
                    ...EXAMPLES.map((ex) => ({ id: ex.id, label: ex.label, icon: "cube" as CadIconName, onClick: () => loadExample(ex.make) })),
                    { divider: true },
                    { id: "library", label: tr("Knihovna normálií…"), icon: "table", tone: "pattern", kbd: "Ctrl+L", onClick: () => setLibraryOpen({}) },
                    { id: "settings", label: tr("Nastavení…"), icon: "settings", kbd: "Ctrl+,", onClick: () => setSettingsOpen(true) },
                    { id: "help", label: tr("Klávesové zkratky a ovládání"), icon: "help", onClick: () => setNotice({ title: tr("Ovládání a zkratky"), body: HELP }) },
                    { id: "docs", label: tr("Dokumentace a návod k obsluze (web)…"), icon: "info", onClick: () => window.open(langMeta().docs, "_blank", "noopener") },
                    { id: "pdf", label: tr("Příručka PDF – stáhnout"), icon: "drawing", onClick: () => window.open(CAD_LINKS.pdf, "_blank", "noopener") },
                  ]}
                />
              </>
            )}
          </div>
          {tabs.map(([t, l]) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "mt-auto shrink-0 whitespace-nowrap rounded-t-md border px-3.5 py-1 text-[12px] font-medium",
                curTab === t ? "border-b-[#fbfcfd] border-x-[#d5dbe2] border-t-[#d5dbe2] bg-[#fbfcfd] text-[#1f2933]" : "border-x-transparent border-t-transparent border-b-[#d5dbe2] text-[#4a5664] hover:bg-white/50",
                t === "sketch" && "text-[#2563eb]",
              )}
            >
              {l}
            </button>
          ))}
          <div className="min-w-2 flex-1 border-b border-[#d5dbe2]" aria-hidden />
        </div>

        <Ribbon
          groups={groups[curTab]}
          right={
            sketch ? (
              <div className="flex items-center gap-2 px-3">
                <button type="button" onClick={cancelSketch} className="rounded border border-[#cfd6de] bg-white px-3 py-1.5 text-[12px] hover:bg-[#f3f6f9]">
                  {tr("Zavřít")}
                </button>
                <button type="button" onClick={finishSketch} className="flex items-center gap-1.5 rounded bg-[#16a34a] px-4 py-1.5 text-[12.5px] font-semibold text-white shadow hover:bg-[#15803d]">
                  <CadIcon name="check" className="h-4 w-4" /> {tr("Dokončit skicu")}
                </button>
              </div>
            ) : null
          }
        />

        <div className="relative flex min-h-0 flex-1">
          {/* Správce */}
          <aside className={cn("absolute inset-y-0 left-0 z-20 w-[270px] shrink-0 flex-col border-r border-[#d5dbe2] bg-white shadow-xl lg:static lg:flex lg:shadow-none", panels ? "flex" : "hidden")}>
            {isAsm ? (
              <AsmTree doc={doc} selected={asmSel} onSelect={setAsmSel} onCommit={(d) => { commit(d); if (d.mates !== doc.mates) void resolveMates(d); }} onContext={(x, y, entries) => setCtx({ x, y, entries })} menuFor={compMenu} mateStatus={mateStatus} onResolve={() => void resolveMates(doc)} />
            ) : (
              <Manager doc={doc} status={result?.status} activeId={activeId} sketchId={sketchId} onSelect={selectFeature} onCommit={commit} onContext={(x, y, entries) => setCtx({ x, y, entries })} bodies={result?.bodies} onActivateBody={(name) => commit({ ...doc, activeBody: name })} />
            )}
          </aside>

          {/* Pracovní plocha */}
          <main
            className="relative min-w-0 flex-1 overflow-hidden"
            onPointerDownCapture={(e) => {
              lastPtr.current = { x: e.clientX, y: e.clientY };
              setHud(null);
            }}
            onWheelCapture={() => setHud(null)}
          >
            <div className={cn("absolute inset-0", sketch && "invisible")} style={{ background: bg.css }}>
              <ViewportBoundary resetKey={glKey} onError={(error) => setGlError({ error, probe: probeWebGL() })}>
                <Viewport
                  key={glKey}
                  ref={vp}
                  onRenderError={setGlError}
                  hints={hintsOn}
                  mesh={result?.mesh ?? null}
                  sketches={sketchesForView}
                  datums={datums}
                  datumGfx={datumGfx}
                  pickMode={pickMode}
                  selectedEdges={active && (active.type === "fillet" || active.type === "chamfer") && active.edges !== "all" ? active.edges : extPicked("edges")}
                  selectedFaces={active && Array.isArray((active as { faces?: number[] }).faces) ? ((active as { faces?: number[] }).faces as number[]) : extPicked("faces")}
                  onPickEdge={onPickEdge}
                  onPickFace={onPickFace}
                  selFilter={refPick ? refFilter(refPick.want) : selFilter}
                  snapPoints={measure || (!!refPick && (refPick.want === "point" || refPick.want === "vertex" || refPick.want === "any"))}
                  selection={measure ? measureSel : mate ? mateSelection(mate, mateHover) : selection}
                  onPick={onPick}
                  measure={measureGfx}
                  vertices={result?.vertices ?? null}
                  faceColors={doc.faceColors}
                  bodyHidden={bodyHidden}
                  bodyOpacity={bodyOpacity}
                  gizmo={gizmo}
                  onGizmo={onGizmo}
                  onContext={vpContext}
                  onCursor={setCursor}
                  display={prefs.display}
                  ortho={prefs.ortho}
                  section={section}
                  bodyColor={doc.color}
                  mouse={prefs.mouse}
                  vertexColors={vertexColors}
                  surface={surface.mode === "zebra" ? "zebra" : "none"}
                  showGrid={showGrid}
                  assembly={isAsm ? asmViews : undefined}
                />
              </ViewportBoundary>
            </div>
            {glError && !sketch && (
              <ViewportFallback
                failure={glError}
                core={core}
                onRetry={() => {
                  setGlError(null);
                  setGlKey((k) => k + 1);
                }}
                onCopy={() => void copyDiagnostics()}
              />
            )}
            {sketch && (
              <>
                <Sketcher ref={sk} key={sketch.id} hints={hintsOn} sketch={sketch} onChange={setSketchPatch} selected={sketchSel} onSelect={setSketchSel} tool={tool} setTool={setTool} snapGrid={snapGrid} setSnapGrid={setSnapGrid} onFinish={finishSketch} modelLines={result?.mesh?.lines ?? null} />
                <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded bg-[#2563eb] px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-white shadow-lg">{tr("Skica ·")}{" "}{planeLabel(sketch.plane)}</div>
              </>
            )}

            {/* Měření */}
            {measure && (
              <FloatPanel
                title={tr("Měření")}
                icon="measure"
                onClose={toggleMeasure}
                extra={
                  measureRes ? (
                    <button
                      type="button"
                      title={tr("Kopírovat výsledky")}
                      onClick={() => navigator.clipboard?.writeText(measureRes.rows.map(([k, v]) => `${k}\t${v}`).join("\n")).then(() => flash(tr("Zkopírováno do schránky.")))}
                      className="rounded p-0.5 text-[#6b7785] hover:bg-[#eef2f6]"
                    >
                      <CadIcon name="copy" className="h-3.5 w-3.5" />
                    </button>
                  ) : null
                }
              >
                <div className="mb-2 flex flex-wrap gap-1">
                  {(["all", "vertex", "edge", "face", "body"] as SelFilter[]).map((f) => (
                    <button key={f} type="button" onClick={() => setSelFilter(f)} className={cn("rounded px-1.5 py-0.5 text-[11px]", selFilter === f ? "bg-[#1f2933] text-white" : "bg-[#eef2f6] hover:bg-[#e3e9f0]")}>
                      {tr(FILTER_LABEL[f])}
                    </button>
                  ))}
                </div>
                {measureSel.map((it, i) => (
                  <Row key={i} k={`${i + 1}.`} v={`${tr(KIND_LABEL[it.kind])}${it.kind === "face" || it.kind === "edge" || it.kind === "vertex" ? ` ${it.index + 1}` : ""}`} />
                ))}
                {measureRes?.rows.map(([k, v], i) => <Row key={`r${i}`} k={k} v={v} strong={i === 0 && measureSel.length === 2} />)}
                {measureSel.length === 0 && <p className="text-[11.5px] leading-relaxed text-[#6b7785]">{tr("Klikněte na bod, hranu, plochu nebo těleso. Druhá entita změří vzdálenost a úhel mezi nimi.")}</p>}
                {measureSel.length > 0 && (
                  <button type="button" onClick={() => { setMeasureSel([]); setMeasureRes(null); }} className="mt-2 w-full rounded border border-[#cfd6de] py-1 text-[12px] hover:bg-[#f3f6f9]">
                    {tr("Nové měření")}
                  </button>
                )}
              </FloatPanel>
            )}

            {/* Inspektor entity */}
            {inspect && inspectOpen && !measure && !sketch && (
              <FloatPanel title={inspect.info.title} icon="info" onClose={() => setInspectOpen(false)} pos="right-3 bottom-12">
                {inspect.info.rows.map(([k, v], i) => (
                  <Row key={i} k={k} v={v} />
                ))}
                {selection.length > 1 && <p className="mt-1.5 text-[11px] text-[#6b7785]">{tr("Vybráno")}{" "}{selection.length} {tr("entit · Ctrl/Shift+klik přidá/odebere")}</p>}
              </FloatPanel>
            )}

            {/* Gizmo */}
            {gizmo && (
              <div className="absolute left-1/2 top-12 z-20 flex -translate-x-1/2 items-center gap-1 rounded-md border border-[#cfd6de] bg-white/95 p-1 text-[12px] shadow-lg">
                <span className="px-2 font-semibold">{gizmoOn?.target === "component" ? tr("Přesun komponenty") : tr("Přesun tělesa")}</span>
                {(["translate", "rotate"] as const).map((md) => (
                  <button key={md} type="button" onClick={() => gizmoOn && setGizmoOn({ ...gizmoOn, mode: md })} className={cn("rounded px-2 py-1", gizmoOn?.mode === md ? "bg-[#1f2933] text-white" : "hover:bg-[#eef2f6]")}>
                    {md === "translate" ? tr("Posun (1 mm)") : tr("Otočení (15°)")}
                  </button>
                ))}
                <button type="button" onClick={() => { setGizmoOn(null); if (gizmoOn?.target === "body") okEdit(); }} className="rounded bg-[#16a34a] px-2.5 py-1 font-semibold text-white hover:bg-[#15803d]">
                  {tr("Hotovo")}
                </button>
              </div>
            )}

            {/* Řez */}
            {section && !sketch && (
              <FloatPanel title={tr("Řez modelem")} icon="section" onClose={() => setSection(null)} pos={measure ? "left-3 top-[300px]" : "left-3 top-3"}>
                <div className="mb-2 flex gap-1">
                  {(["X", "Y", "Z"] as const).map((a) => (
                    <button key={a} type="button" onClick={() => setSection({ ...section, axis: a, offset: bb ? Math.round(((bb[0]["XYZ".indexOf(a)] + bb[1]["XYZ".indexOf(a)]) / 2) * 100) / 100 : 0 })} className={cn("flex-1 rounded py-1 text-[12px] font-semibold", section.axis === a ? "bg-[#1f2933] text-white" : "bg-[#eef2f6] hover:bg-[#e3e9f0]")}>
                      {a}
                    </button>
                  ))}
                </div>
                {bb && (
                  <input
                    type="range"
                    min={bb[0]["XYZ".indexOf(section.axis)] - 0.01}
                    max={bb[1]["XYZ".indexOf(section.axis)] + 0.01}
                    step={0.01}
                    value={section.offset}
                    onChange={(e) => setSection({ ...section, offset: Number(e.target.value) })}
                    className="w-full accent-[#E03930]"
                  />
                )}
                <Row k={tr("Poloha")} v={`${fmtNum(section.offset, 2)} mm`} />
                <button type="button" onClick={() => setSection({ ...section, flip: !section.flip })} className="mt-2 w-full rounded border border-[#cfd6de] py-1 text-[12px] hover:bg-[#f3f6f9]">
                  {tr("Otočit stranu")}
                </button>
              </FloatPanel>
            )}

            {core === "loading" && (
              <div className="absolute inset-0 grid place-items-center bg-white/70 backdrop-blur-sm">
                <div className="text-center">
                  <span className="mx-auto block h-10 w-10 animate-spin rounded-full border-2 border-ink-700/10 border-t-brand" />
                  <p className="mt-4 text-[14px] font-semibold">{tr("Načítám CAD jádro OpenCascade")}</p>
                  <p className="mt-1 text-[12px] text-ink-700/55">{tr("Jen poprvé – poté se načítá z mezipaměti.")}</p>
                </div>
              </div>
            )}
            {core === "error" && (
              <div className="absolute inset-0 grid place-items-center bg-white/90">
                <p className="max-w-sm text-center text-[14px]">{tr("CAD jádro se nepodařilo načíst. Zkuste prosím aktuální Chrome, Edge, Firefox nebo Safari.")}</p>
              </div>
            )}

            <button type="button" className={cn("absolute top-3 z-30 rounded border border-[#cfd6de] bg-white p-2 shadow-sm lg:hidden", panels ? "left-[17.5rem]" : "left-3")} onClick={() => setPanels((p) => !p)} aria-label={tr("Správce historie")}>
              <CadIcon name="tree" className="h-4 w-4" />
            </button>

            {parentAsm && (
              <div className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-3 rounded-md bg-[#2563eb] px-3 py-1.5 text-[12.5px] text-white shadow-lg">
                <span>
                  {doc.kind === "assembly" ? tr("Úprava podsestavy") : tr("Úprava dílu")} {tr("v sestavě „")}{parentAsm.asm.name}“{asmStack.length > 1 ? tr(" (úroveň {0})", asmStack.length) : ""}
                </span>
                <button type="button" onClick={backToAssembly} className="rounded bg-white px-2.5 py-0.5 text-[12px] font-semibold text-[#2563eb] hover:bg-blue-50">
                  {tr("← Zpět do sestavy")}
                </button>
              </div>
            )}
            {moldTools && !isAsm && (
              <MoldPanel
                bbox={m ? m.bbox : null}
                draft={draftSetup}
                setDraft={setDraftSetup}
                draftResult={draftResult}
                onShrink={(pct) => {
                  commit(applyShrinkage(doc, pct));
                  flash(tr("Smrštění {0} % přidáno do historie jako měřítko.", pct));
                }}
                onParting={() => {
                  if (!result?.mesh) return;
                  const pz = suggestPartingZ(result.mesh);
                  setPartingZ(pz);
                  setSection({ axis: "Z", offset: pz.z, flip: false });
                }}
                partingZ={partingZ}
                onEjectors={addEjectors}
                ejectors={ejectors}
                onCooling={addCooling}
                surface={{ ...surface, info: analysis.info }}
                setSurface={setSurface}
                onClose={() => {
                  setMoldTools(false);
                  setDraftSetup((d) => ({ ...d, on: false }));
                  setSurface((x) => ({ ...x, mode: "none" }));
                }}
              />
            )}
            {isAsm && explode > 0 && (
              <FloatPanel title={tr("Rozložený pohled")} icon="transform" onClose={() => setExplode(0)}>
                <input type="range" min={0} max={3} step={0.05} value={explode} onChange={(e) => setExplode(Number(e.target.value))} className="w-full accent-[#E03930]" />
                <Row k={tr("Rozložení")} v={`${Math.round(explode * 100)} %`} />
              </FloatPanel>
            )}
            {isAsm && clashes && (
              <FloatPanel title={clashes.length ? tr("Kolize ({0})", clashes.length) : tr("Bez kolizí ✓")} icon="section" onClose={() => setClashes(null)} pos={explode > 0 ? "left-3 top-[150px]" : "left-3 top-3"}>
                {clashInfo && (
                  <p data-clash-result className="mb-1 text-[11px] text-[#5b6776]">
                    {clashes.length ? `${clashes.length} ${clashes.length === 1 ? tr("průnik") : clashes.length < 5 ? tr("průniky") : tr("průniků")}` : tr("Žádný průnik komponent")} {tr("· zkontrolováno")}{" "}{clashInfo.comps} {tr("komponent ·")}{" "}{clashInfo.at}
                  </p>
                )}
                <div className="max-h-56 space-y-1 overflow-y-auto">
                  {clashes.map((x, i) => {
                    const a = doc.components?.find((c) => c.id === x.a);
                    const b = doc.components?.find((c) => c.id === x.b);
                    return (
                      <button key={i} type="button" onClick={() => setAsmSel(x.a)} className="block w-full rounded px-1.5 py-1 text-left text-[11.5px] hover:bg-[#fde3e1]">
                        <span className="font-medium">{a?.name}</span> × <span className="font-medium">{b?.name}</span>
                        <span className="block font-mono text-[10.5px] text-brand-600">{fmtNum(x.volume, 2)} mm³</span>
                      </button>
                    );
                  })}
                </div>
              </FloatPanel>
            )}
            {shared && (tabId === shared.tabId || tabStrip.find((t) => t.id === tabId)?.srcTabId === shared.tabId) && (
              <div role="status" className="absolute left-1/2 top-2 z-30 flex max-w-[94%] -translate-x-1/2 items-center gap-3 rounded-md border border-[#f3c6c2] bg-[#fff7f6]/95 px-3 py-1.5 text-[12px] text-[#26303b] shadow">
                <CadIcon name="share" className="h-4 w-4 shrink-0 text-brand" />
                <span>
                  <strong>{tr("Sdílený dokument")}</strong>
                  {shared.from ? ` od ${shared.from}` : ""} · {shared.exp ? tr("platí do {0}", new Date(shared.exp).toLocaleDateString(cadLocale())) : tr("bez omezení platnosti")} {tr("· snímek – vaše úpravy se odesílateli nepromítnou")}
                </span>
                <button type="button" onClick={() => void saveProjectAs()} className="whitespace-nowrap rounded border border-[#cfd6de] bg-white px-2 py-0.5 hover:border-brand/50">
                  {tr("Uložit kopii…")}
                </button>
                <button type="button" onClick={() => setShared(null)} aria-label={tr("Skrýt")} className="rounded p-0.5 text-[#6b7785] hover:bg-white">
                  <CadIcon name="x" className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            {toast && <div className="absolute bottom-14 left-1/2 z-30 max-w-[90%] -translate-x-1/2 rounded-md bg-[#1f2933] px-4 py-2 text-[12.5px] text-white shadow-xl">{toast}</div>}

            {!sketch && (
              <div className={cn("pointer-events-none absolute bottom-2 left-24 right-24 flex flex-wrap justify-center gap-1.5 font-mono text-[10.5px]", bg.dark ? "text-white/80" : "text-[#26303b]")}>
                {isAsm ? (
                  <>
                    <Chip dark={bg.dark}>{doc.components?.length ?? 0} {tr("komponent ·")}{" "}{bom.length} {tr("položek kusovníku")}</Chip>
                    <Chip dark={bg.dark}>{tr("Hmotnost")}{" "}{fmtNum(bom.reduce((sum, r) => sum + (r.massKg ?? 0) * r.qty, 0), 2)} kg</Chip>
                    {asmLoading > 0 && <Chip dark={bg.dark}>{tr("Stavím komponenty…")}</Chip>}
                  </>
                ) : m ? (
                  <>
                    <Chip dark={bg.dark}>
                      {fmtNum(m.bbox[1][0] - m.bbox[0][0], 1)} × {fmtNum(m.bbox[1][1] - m.bbox[0][1], 1)} × {fmtNum(m.bbox[1][2] - m.bbox[0][2], 1)} mm
                    </Chip>
                    <Chip dark={bg.dark}>V {fmtNum(m.volume / 1000, 1)} cm³</Chip>
                    <Chip dark={bg.dark}>
                      {mat.label} {fmtNum(massKg(m.volume, mat.density), 3)} kg
                    </Chip>
                  </>
                ) : (
                  <Chip dark={bg.dark}>{tr("Prázdný model")}</Chip>
                )}
                {errors.length > 0 && <Chip warn>{errors.length} {tr("prvek s chybou")}</Chip>}
                {warnings.length > 0 && (
                  <Chip warn>
                    <span data-warn-chip title={warnings.map((w) => w.warning).join("\n")}>
                      {warnings.length} {warnings.length === 1 ? tr("prvek s upozorněním") : tr("prvky s upozorněním")}
                    </span>
                  </Chip>
                )}
                {geomBad && (
                  <Chip warn>
                    <span data-geom-chip title={tr("Výsledné těleso není platné (sebeprotínající plochy) nebo nemá žádný solid – export STEP může selhat. Opravte prvek označený ⚠ v historii.")}>{result!.metrics!.solids === 0 ? tr("bez objemového tělesa") : tr("neplatná geometrie")}</span>
                  </Chip>
                )}
              </div>
            )}
          </main>

          {/* Formulář prvku (jako „Options“ v ZW3D) */}
          {isAsm && asmSel && doc.components?.find((c) => c.id === asmSel) && (
            <aside className="absolute inset-y-0 right-0 z-20 flex w-[300px] shrink-0 flex-col border-l border-[#d5dbe2] bg-white shadow-xl max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:w-auto max-sm:max-h-[58vh] max-sm:rounded-t-2xl max-sm:border-l-0 max-sm:border-t lg:static lg:shadow-none">
              <div className="flex items-center gap-2 border-b border-[#d5dbe2] bg-gradient-to-b from-[#f7f9fb] to-[#eef2f6] px-3 py-2">
                <CadIcon name="cube" tone="create" className="h-5 w-5" />
                <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{tr("Komponenta ·")}{" "}{doc.components.find((c) => c.id === asmSel)!.name}</p>
                <button type="button" className="rounded p-1 text-[#6b7785] hover:bg-[#e3e9f0]" onClick={() => setAsmSel(null)} aria-label={tr("Zavřít")}>
                  <CadIcon name="x" className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <AsmProps
                  c={doc.components.find((c) => c.id === asmSel)!}
                  onChange={(p) => {
                    const nextDoc = { ...doc, components: (doc.components ?? []).map((c) => (c.id === asmSel ? { ...c, ...p } : c)) };
                    commit(nextDoc);
                    if (p.placement && doc.mates?.length) void resolveMates(nextDoc, asmSel);
                  }}
                  doc={doc}
                  onDoc={(d) => {
                    commit(d);
                    if (d.mates !== doc.mates) void resolveMates(d);
                  }}
                  onMate={(mode) => startMate(asmSel, mode)}
                  mate={mate?.compId === asmSel ? mate : null}
                  onMatePatch={(p) => setMate((m) => (p && m ? { ...m, ...p } : null))}
                  onMateFace={(leafId, face) => void onMateFace(leafId, face)}
                  onMateConfirm={(value) => mate && finishMate({ ...mate, value })}
                  onFaceHover={setMateHover}
                  onPattern={patternSelected}
                  onMirror={mirrorSelected}
                  onBolt={(o) => {
                    setMate(null);
                    setBoltPick((b) => (b ? null : o));
                    flash(tr("Klikněte na válcovou plochu díry (strana kliknutí = hlava šroubu)."));
                  }}
                  bolting={!!boltPick}
                />
              </div>
              <div className="flex gap-2 border-t border-[#d5dbe2] p-3">
                <button type="button" disabled={doc.components.find((c) => c.id === asmSel)!.source.kind !== "part"} onClick={() => editPartInContext(doc.components!.find((c) => c.id === asmSel)!)} className="flex-1 rounded bg-[#2563eb] py-2 text-[12.5px] font-semibold text-white hover:bg-[#1d4ed8] disabled:opacity-40">
                  {tr("Upravit díl")}
                </button>
                <button type="button" className="rounded border border-[#cfd6de] px-2 text-brand hover:bg-brand/5" title={tr("Odebrat")} onClick={() => { commit({ ...doc, components: (doc.components ?? []).filter((x) => x.id !== asmSel) }); setAsmSel(null); }}>
                  <CadIcon name="trash" className="h-4 w-4" />
                </button>
              </div>
            </aside>
          )}
          {(active || (sketch && sketchSel)) && (
            <aside className="absolute inset-y-0 right-0 z-20 flex w-[300px] shrink-0 flex-col border-l border-[#d5dbe2] bg-white shadow-xl max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:w-auto max-sm:max-h-[58vh] max-sm:rounded-t-2xl max-sm:border-l-0 max-sm:border-t lg:static lg:shadow-none">
              <div className="flex items-center gap-2 border-b border-[#d5dbe2] bg-gradient-to-b from-[#f7f9fb] to-[#eef2f6] px-3 py-2">
                <CadIcon name={active ? featureIcon(active) : "sketch"} tone={((active && featureTone(active)) ?? FEATURE_TONE[active?.type ?? "sketch"] ?? "create") as Tone} className="h-5 w-5" />
                <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{active ? `${featureLabel(active)} · ${active.name}` : tr("Entita skici")}</p>
                {active ? (
                  <>
                    <button type="button" title={tr("OK (Enter)")} onClick={okEdit} className="grid h-7 w-7 place-items-center rounded bg-[#16a34a] text-white shadow-sm hover:bg-[#15803d]">
                      <CadIcon name="check" className="h-4 w-4" />
                    </button>
                    <button type="button" title={tr("Storno (Esc)")} onClick={cancelEdit} className="grid h-7 w-7 place-items-center rounded bg-white text-brand ring-1 ring-[#cfd6de] hover:bg-brand/5">
                      <CadIcon name="x" className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  <button type="button" className="rounded p-1 text-[#6b7785] hover:bg-[#e3e9f0]" onClick={() => setSketchSel(null)} aria-label={tr("Zavřít")}>
                    <CadIcon name="x" className="h-4 w-4" />
                  </button>
                )}
              </div>
              {active && statusOf(result, active.id) && !statusOf(result, active.id)!.ok && (
                <p className="mx-3 mt-3 rounded border border-brand/30 bg-brand/10 px-2.5 py-1.5 text-[12px] text-brand-600">{statusOf(result, active.id)!.error}</p>
              )}
              {active && statusOf(result, active.id)?.ok && statusOf(result, active.id)?.warning && (
                <p data-form-warning className="mx-3 mt-3 rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[12px] text-amber-800">⚠ {statusOf(result, active.id)!.warning}</p>
              )}
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {active && <FeatureProps f={active} doc={doc} onChange={(p) => updateFeature(active.id, p)} />}
                {sketch &&
                  sketchSel &&
                  (() => {
                    const e = sketch.entities.find((x) => x.id === sketchSel);
                    return e ? (
                      <>
                        <EntityProps e={e} onChange={(n) => setSketchEntities(sketch.entities.map((x) => (x.id === n.id ? n : x)))} />
                        <button
                          type="button"
                          className="mt-5 w-full rounded border border-[#cfd6de] py-2 text-[12.5px] text-brand hover:bg-brand/5"
                          onClick={() => {
                            setSketchEntities(sketch.entities.filter((x) => x.id !== e.id));
                            setSketchSel(null);
                          }}
                        >
                          {tr("Smazat entitu")}
                        </button>
                      </>
                    ) : null;
                  })()}
              </div>
              {active && (
                <div className="flex gap-2 border-t border-[#d5dbe2] p-3">
                  <button type="button" className="flex flex-1 items-center justify-center gap-1.5 rounded bg-[#16a34a] py-2 text-[12.5px] font-semibold text-white hover:bg-[#15803d]" onClick={okEdit}>
                    <CadIcon name="check" className="h-4 w-4" /> OK
                  </button>
                  <button type="button" className="rounded border border-[#cfd6de] px-3 text-[12.5px] hover:bg-[#f3f6f9]" onClick={cancelEdit}>
                    {tr("Storno")}
                  </button>
                  <button type="button" className="rounded border border-[#cfd6de] px-2 text-brand hover:bg-brand/5" title={tr("Smazat prvek")} onClick={() => removeFeature(active.id)}>
                    <CadIcon name="trash" className="h-4 w-4" />
                  </button>
                </div>
              )}
            </aside>
          )}
        </div>

        {/* Řádek příkazů / stav */}
        <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-[#c9d1da] bg-[#eef2f6] px-3 text-[11.5px] text-[#3c4856]">
          <span className="font-semibold text-brand">»</span>
          <span className="min-w-0 flex-1 truncate">{prompt}</span>
          {!sketch && (
            <label className="flex items-center gap-1 text-[10.5px] text-[#5b6776]" title={tr("Filtr výběru (co se vybírá kliknutím)")}>
              {tr("Filtr")}
              <select value={selFilter} onChange={(e) => setSelFilter(e.target.value as SelFilter)} className="rounded border border-[#c9d1da] bg-white px-1 py-0 text-[11px] text-[#1f2933]">
                {(Object.keys(FILTER_LABEL) as SelFilter[])
                  .filter((f) => isAsm || (f !== "component" && f !== "subasm"))
                  .map((f) => (
                    <option key={f} value={f}>
                      {tr(FILTER_LABEL[f])}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {selection.length > 0 && <span className="rounded bg-brand/10 px-1.5 font-mono text-[10.5px] text-brand-600">{tr("vybráno")}{" "}{selection.length}</span>}
          {cursor && !sketch && <span className="hidden font-mono text-[10.5px] text-[#5b6776] md:inline">X {fmtNum(cursor[0], 2)} {tr("· Y")}{" "}{fmtNum(cursor[1], 2)} {tr("· Z")}{" "}{fmtNum(cursor[2], 2)}</span>}
          <span className="hidden font-mono text-[10.5px] text-[#5b6776] sm:inline">{tr("mm ·")}{" "}{prefs.ortho ? tr("pravoúhlá") : tr("perspektiva")}</span>
          <span className="hidden text-[10.5px] text-[#5b6776] lg:inline">{prefs.mouse === "zw3d" ? tr("Otáčení: pravé tl. · Posun: prostřední") : prefs.mouse === "solidworks" ? tr("Otáčení: prostřední · Posun: Ctrl+prostřední") : tr("Otáčení: levé · Posun: pravé")}</span>
        </footer>

        {ctx && <ContextMenu x={ctx.x} y={ctx.y} entries={ctx.entries} close={() => setCtx(null)} />}
        {hud && !active && !sketch && !ctx && !measure && !refPick && (
          <HudBar
            x={hud.x}
            y={hud.y}
            entries={entityMenu(hud.item)}
            onClose={() => setHud(null)}
            onMore={() => {
              const h = hud;
              setHud(null);
              vpContext(h.x, h.y, h.item);
            }}
          />
        )}

        {/* Hmotnostní vlastnosti */}
        {massOpen && m && (
          <Modal title={tr("Hmotnostní vlastnosti")} icon="mass" onClose={() => setMassOpen(false)}>
            <label className="mb-3 block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[#6b7785]">{tr("Materiál")}</span>
              <select value={doc.material} onChange={(e) => commit({ ...doc, material: e.target.value })} className="w-full rounded border border-[#cfd6de] bg-white px-2 py-1.5 text-[13px]">
                {MATERIALS.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label} ({x.density} {tr("g/cm³)")}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-2 block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[#6b7785]">{tr("Označení materiálu (razítko)")}</span>
              <input
                type="text"
                defaultValue={doc.materialName ?? ""}
                key={`mn-${doc.materialName ?? ""}`}
                placeholder={mat.label}
                title={tr("Volný text do razítka výkresu, např. ČSN 11 423 nebo 1.0503 – hustota se bere z třídy materiálu výše")}
                onBlur={(e) => {
                  const t = e.target.value.trim();
                  const next = t && t !== mat.label ? t : undefined;
                  if ((doc.materialName ?? undefined) !== next) commit({ ...doc, materialName: next });
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                className="w-full rounded border border-[#cfd6de] bg-white px-2 py-1.5 text-[12.5px] outline-none focus:border-brand"
              />
            </label>
            <Row k={tr("Hmotnost")} v={`${fmtNum(massKg(m.volume, mat.density), 4)} kg`} strong />
            <Row k={tr("Objem")} v={`${fmtNum(m.volume, 2)} mm³ (${fmtNum(m.volume / 1000, 3)} cm³)`} />
            <Row k={tr("Povrch")} v={`${fmtNum(m.area, 2)} mm² (${fmtNum(m.area / 100, 2)} cm²)`} />
            <Row k={tr("Hustota")} v={`${mat.density} g/cm³`} />
            <Row k={tr("Rozměry (X × Y × Z)")} v={`${fmtNum(m.bbox[1][0] - m.bbox[0][0], 3)} × ${fmtNum(m.bbox[1][1] - m.bbox[0][1], 3)} × ${fmtNum(m.bbox[1][2] - m.bbox[0][2], 3)} mm`} />
            <Row k={tr("Min. bod")} v={m.bbox[0].map((v) => fmtNum(v, 3)).join(" ; ")} />
            <Row k={tr("Max. bod")} v={m.bbox[1].map((v) => fmtNum(v, 3)).join(" ; ")} />
            <Row k={tr("Topologie")} v={`${m.faces} ploch · ${m.edges} hran`} />
          </Modal>
        )}

        {bomOpen && (
          <Modal title={tr("Kusovník – {0}", doc.name)} icon="table" onClose={() => setBomOpen(false)}>
            <div className="mb-3 flex gap-1 rounded bg-[#eef2f6] p-0.5 text-[12px]">
              {[
                [true, tr("Plochý (všechny díly)")],
                [false, tr("Strukturovaný (podsestavy)")],
              ].map(([v, l]) => (
                <button key={String(v)} type="button" onClick={() => setBomFlat(v as boolean)} className={cn("flex-1 rounded py-1", bomFlat === v ? "bg-white font-semibold shadow-sm" : "text-[#5b6776]")}>
                  {l as string}
                </button>
              ))}
            </div>
            <BomTable
              rows={bom}
              onCsv={() => download(`${safeName(doc.name)}_kusovnik.csv`, bomCsv(bom), "text/csv;charset=utf-8")}
              onDrawing={() => {
                setBomOpen(false);
                openDrawingTab();
              }}
            />
          </Modal>
        )}
        {moldOpen && (
          <Modal title={tr("Rám vstřikovací formy")} icon="layers" onClose={() => setMoldOpen(false)}>
            <MoldWizard
              onCreate={(p) => {
                setMoldOpen(false);
                commit(moldBase(p, tr("Rám formy {0}×{1}", p.width, p.length)));
                setAsmSel(null);
                setParentAsm(null);
                setActiveId(null);
                setSketchId(null);
                setTab("asm");
                flash(tr("Stavím rám formy…"));
                setTimeout(() => vp.current?.setView("iso"), 2500);
              }}
            />
          </Modal>
        )}
        {libraryOpen && (
          <LibraryDialog
            isAssembly={isAsm}
            initialQuery={libraryOpen.query}
            onClose={() => setLibraryOpen(null)}
            onInsertPart={(d) => {
              setLibraryOpen(null);
              openDocInTab({ ...d, kind: "part" });
              setTab("create");
              flash(tr("{0} otevřen jako nový díl.", d.name));
              setTimeout(() => vp.current?.setView("iso"), 900);
            }}
            onInsertComponent={(d, group) => {
              setLibraryOpen(null);
              insertPart(d, group || tr("Normálie"));
              flash(tr("{0} vložen do sestavy.", d.name));
            }}
          />
        )}
        <ComputeChip onCancel={cancelCompute} />
        {settingsOpen && <SettingsDialog settings={prefs} onChange={applySettings} onClose={() => setSettingsOpen(false)} backgrounds={BACKGROUNDS} />}
        {shareOpen && <ShareDialog doc={doc} view={drawingOpen ? "drawing" : "model"} onClose={() => setShareOpen(false)} onFlash={flash} />}
        {agentOpen && <AgentConsole onClose={() => setAgentOpen(false)} run={(t) => runAgentRef.current(t)} getDocJson={() => JSON.stringify(histRef.current.present, null, 1)} status={agentStatus} />}
        {sharePass && (
          <UiModal
            title={tr("Sdílený dokument je chráněný heslem")}
            icon="lock"
            tone="file"
            onClose={() => setSharePass(null)}
            width="max-w-md"
            footer={
              <>
                <Btn onClick={() => setSharePass(null)}>{tr("Zrušit")}</Btn>
                <Btn primary disabled={!!sharePass.busy || !sharePass.value} onClick={() => void unlockShared()}>
                  {tr("Otevřít")}
                </Btn>
              </>
            }
          >
            <p className="text-[12.5px] text-[#26303b]">{tr("Zadejte heslo, které vám odesílatel poslal zvlášť (SMS, telefon…).")}</p>
            <input
              type="password"
              autoFocus
              value={sharePass.value}
              onChange={(e) => setSharePass({ ...sharePass, value: e.target.value, error: undefined })}
              onKeyDown={(e) => e.key === "Enter" && void unlockShared()}
              aria-label={tr("Heslo sdíleného dokumentu")}
              className="mt-2 w-full rounded border border-[#cfd6de] px-2 py-1.5 text-[12.5px] outline-none focus:border-brand"
            />
            {sharePass.error && <p className="mt-1 text-[12px] text-brand">{sharePass.error}</p>}
          </UiModal>
        )}
        {paletteOpen && (
          <CommandPalette
            commands={buildCommands()}
            onClose={() => setPaletteOpen(false)}
            extra={(q) => {
              if (!/^[a-zá-ž]+\s+\S/i.test(q) && !/^[[{]/.test(q)) return [];
              const p = parseAgentText(q);
              return p.ops.length && !p.errors.length ? [{ id: "agent-run", label: tr("Provést příkaz: {0}", q), group: "Textové příkazy", icon: "palette" as CadIconName, hint: tr("textový příkaz (Nápověda → Textové příkazy)"), run: () => void runAgentRef.current(q).then((log) => flash(log.split("\n")[0] ?? tr("Hotovo"))) }] : [];
            }}
          />
        )}
        {startOpen && (
          <StartScreen
            actions={[
              { id: "part", label: tr("Nový díl"), desc: tr("Prázdný díl: skica → vysunutí → prvky. Parametrická historie."), icon: "cube", tone: "create", run: () => { setStartOpen(false); newDoc(); } },
              { id: "asm", label: tr("Nová sestava"), desc: tr("Prázdná sestava: komponenty, vazby, podsestavy, kusovník."), icon: "layers", tone: "create", run: () => { setStartOpen(false); newAssembly(false); } },
              { id: "drawing", label: tr("Nový výkres"), desc: tr("Otevřete díl nebo sestavu (.mncad, STEP…) a rovnou vznikne výkres s pohledy a razítkem."), icon: "drawing", tone: "file", run: () => { setStartOpen(false); drawAfterImport.current = true; fileInput.current?.click(); } },
            ]}
            secondary={[
              { id: "open", label: tr("Otevřít / importovat"), desc: tr("STEP, IGES, BREP, STL, OBJ, 3MF, glTF, DXF, .mncad"), icon: "open", tone: "file", kbd: "Ctrl+O", run: () => { setStartOpen(false); fileInput.current?.click(); } },
              { id: "lib", label: tr("Knihovna normálií"), desc: tr("103 rodin: šrouby, ložiska, ozubená kola, profily, normálie forem… Stačí napsat „M8x30“."), icon: "table", tone: "pattern", kbd: "Ctrl+L", run: () => { setStartOpen(false); setLibraryOpen({}); } },
              { id: "palette", label: tr("Paleta příkazů"), desc: tr("Napište, co chcete udělat – „díra“, „výkres“, „zaoblit“…"), icon: "measure", tone: "tool", kbd: "Ctrl+K", run: () => { setStartOpen(false); setPaletteOpen(true); } },
              { id: "settings", label: tr("Nastavení"), desc: tr("Myš jako ZW3D/SolidWorks, jednotky, zkratky, výkresy."), icon: "settings", tone: "view", run: () => { setStartOpen(false); setSettingsOpen(true); } },
              { id: "docs", label: tr("Dokumentace a návod"), desc: tr("Kompletní návod k obsluze: 24 kapitol, postupy, FAQ (otevře se v nové záložce)."), icon: "info", tone: "tool", run: () => window.open(langMeta().docs, "_blank", "noopener") },
              { id: "pdf", label: tr("Příručka PDF"), desc: tr("Celá dokumentace jako PDF k tisku a offline čtení."), icon: "drawing", tone: "tool", run: () => window.open(CAD_LINKS.pdf, "_blank", "noopener") },
              { id: "agent", label: tr("Textové příkazy (AI)"), desc: tr("Díl zadaný textem nebo JSON – pro AI agenty, automatizaci i rychlé modelování."), icon: "palette", tone: "tool", kbd: "Ctrl+Shift+K", run: () => { setStartOpen(false); setAgentOpen(true); } },
            ]}
            examples={EXAMPLES.map((ex) => ({ id: ex.id, label: ex.label, run: () => { setStartOpen(false); loadExample(ex.make); } }))}
            onOpenRecent={(r) => {
              void readRecentDoc(r.id).then((json) => {
                if (!json) return flash(tr("Soubor už není v paměti prohlížeče – otevřete ho ze souboru .mncad."));
                try {
                  const d = JSON.parse(json) as CadDoc;
                  setStartOpen(false);
                  openDocInTab(d, { docId: r.id });
                } catch {
                  flash(tr("Soubor se nepodařilo načíst."));
                }
              });
            }}
            onClose={() => setStartOpen(false)}
            onDisable={() => setPref("startScreen", false)}
          />
        )}
        {notice && (
          <Modal title={notice.title} icon="info" onClose={() => setNotice(null)}>
            <div className="whitespace-pre-line text-[13px] leading-relaxed text-[#26303b]">{notice.body}</div>
          </Modal>
        )}

        {drawingOpen && (isAsm || result?.metrics) && (
          <DrawingWorkspace
            doc={doc}
            onShare={() => setShareOpen(true)}
            onMaterialChange={(v) => {
              const t = v.trim();
              const next = t && t !== mat.label ? t : undefined;
              if ((doc.materialName ?? undefined) !== next) commit({ ...doc, materialName: next });
            }}
            massKg={isAsm ? bom.reduce((sum, r) => sum + (r.massKg ?? 0) * r.qty, 0) : massKg(result!.metrics!.volume, mat.density)}
            materialLabel={isAsm ? tr("dle kusovníku") : doc.materialName?.trim() || mat.label}
            bom={isAsm ? bom.map((r) => ({ pos: r.pos, name: r.name, number: r.number, qty: r.qty, material: r.material, massKg: r.massKg })) : undefined}
            drawings={doc.drawings}
            balloons={balloonItems}
            onDrawingsChange={(d) => liveWith((cur) => ({ ...cur, drawings: d }))}
            onPropsChange={(p) => commit({ ...doc, props: p })}
            onClose={() => {
              const t = docTabs.find((x) => x.id === tabId);
              if (t?.kind === "drawing") closeTab(t.id);
              else setDrawingOpen(false);
            }}
          />
        )}
      </div>
      </RefPickContext.Provider>
    </ParamContext.Provider>
  );
}

const HELP = `Myš (lze přepnout na kartě Zobrazení → Ovládání myši):
• ZW3D: pravé tlačítko táhnout = otáčení, prostřední = posun, kolečko = zoom k kurzoru, pravý klik = nabídka
• SolidWorks: prostřední = otáčení, Ctrl+prostřední = posun
• Touchpad: levé = otáčení, pravé = posun

Klávesy:
0 izometrie · 1 přední · 2 horní · 3 pravý · 4 zadní · 5 spodní · 6 levý
F přizpůsobit · P pravoúhlá/perspektiva · M měření · X řez
E vysunutí · H díra · Enter = OK · Esc = Storno · Delete = smazat prvek
Ctrl+Z / Ctrl+Y zpět / znovu · Ctrl+S uložit · Ctrl+O otevřít

Skica: V výběr · L úsečka · R obdélník · C kružnice · A oblouk · P mnohoúhelník · S drážka

Parametry: do pole lze psát výrazy (25/2) nebo vazby na proměnné (=d1*2).`;

function statusOf(result: BuildResult | null, id: string) {
  return result?.status.find((s) => s.id === id);
}

// ---------- drobné komponenty ----------

/** true na úzké obrazovce (< 640 px) – přepočítá se při otočení / změně velikosti */
function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

function QBtn({ icon, title, onClick, disabled }: { icon: CadIconName; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" title={title} onClick={onClick} disabled={disabled} className="rounded p-1.5 text-white/75 hover:bg-white/10 hover:text-white disabled:opacity-30">
      <CadIcon name={icon} className="h-4 w-4" />
    </button>
  );
}

function Chip({ children, warn, dark }: { children: React.ReactNode; warn?: boolean; dark?: boolean }) {
  return <span className={cn("rounded border px-2 py-0.5 backdrop-blur", warn ? "border-brand/40 bg-brand/15 text-brand-600" : dark ? "border-white/15 bg-black/30" : "border-[#c9d1da] bg-white/85")}>{children}</span>;
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[#edf1f5] py-1 text-[12px] last:border-0">
      <span className="text-[#6b7785]">{k}</span>
      <span className={cn("text-right font-mono", strong ? "text-[14px] font-bold text-[#0b1f33]" : "text-[#26303b]")}>{v}</span>
    </div>
  );
}

function FloatPanel({ title, icon, onClose, children, className, pos = "left-3 top-3", extra }: { title: string; icon: CadIconName; onClose: () => void; children: React.ReactNode; className?: string; pos?: string; extra?: React.ReactNode }) {
  return (
    <div className={cn("absolute z-20 w-[270px] rounded-md border border-[#cfd6de] bg-white/95 shadow-xl backdrop-blur", pos, className)}>
      <div className="flex items-center gap-2 border-b border-[#e3e8ee] px-3 py-1.5">
        <CadIcon name={icon} tone="tool" className="h-4 w-4" />
        <p className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{title}</p>
        {extra}
        <button type="button" onClick={onClose} className="rounded p-0.5 text-[#6b7785] hover:bg-[#eef2f6]" aria-label={tr("Zavřít")}>
          <CadIcon name="x" className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function Modal({ title, icon, onClose, children }: { title: string; icon: CadIconName; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-[#0b1220]/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg border border-[#cfd6de] bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 rounded-t-lg border-b border-[#e3e8ee] bg-gradient-to-b from-[#f7f9fb] to-[#eef2f6] px-4 py-2.5">
          <CadIcon name={icon} tone="tool" className="h-5 w-5" />
          <p className="flex-1 text-[13.5px] font-semibold">{title}</p>
          <button type="button" onClick={onClose} className="rounded p-1 text-[#6b7785] hover:bg-[#e3e9f0]" aria-label={tr("Zavřít")}>
            <CadIcon name="x" className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

/** Zmenší snímek 3D okna (data URL) na náhled 160×120 (JPEG) pro seznam nedávných souborů. */
function thumbnail(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = 160;
      c.height = 120;
      const g = c.getContext("2d");
      if (!g) return reject(new Error("canvas"));
      const sc = Math.max(160 / img.width, 120 / img.height);
      const w = img.width * sc;
      const h = img.height * sc;
      g.fillStyle = "#dfe5eb";
      g.fillRect(0, 0, 160, 120);
      g.drawImage(img, (160 - w) / 2, (120 - h) / 2, w, h);
      resolve(c.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = () => reject(new Error("img"));
    img.src = dataUrl;
  });
}

