"use client";

/**
 * Pracovní plocha 2D výkresu (jako AutoCAD LT / DraftSight): pás karet Kreslení · Úpravy · Hladiny · Poznámky · Bloky ·
 * Rozvržení · Výstup, plátno modelového prostoru, příkazový řádek, panel Vlastnosti / Hladiny a stavový řádek
 * (souřadnice, MŘÍŽKA F7, KROK F9, ORTHO F8, POLÁRNÍ F10, UCHOP F3, TLOUŠŤKY). Psaní kamkoli jde do příkazového řádku.
 * Každý dokončený příkaz = jeden krok historie (Ctrl+Z / Ctrl+Y). Balíky fáze B přidávají své prvky přes UI_EXTS.
 */
import { getLang, tr } from "@/cad/i18n";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import "@/cad/draft";
import { cmdName, CmdRun, findCommand, runCommandLineAsync, tokenize, type DraftUiHooks, type Prompt } from "@/cad/draft/commands";
import { angleOf, dist, sub } from "@/cad/draft/geom";
import type { SnapKind } from "@/cad/draft/kinds";
import { findLayer, setCurrentLayer } from "@/cad/draft/layers";
import { entityById, spaceEntities, type DraftEntity, type DraftModel, type DraftSpace, type Vec2 } from "@/cad/draft/model";
import { pruneSelection, sessionFor, setSelection, subscribe, type DraftCmdResult } from "@/cad/draft/session";
import { DEFAULT_SNAPS, SNAP_KINDS } from "@/cad/draft/snap";
import { normalizeDraftDoc, emptyDraftDoc } from "@/cad/draft/doc";
import { displayHex } from "@/cad/draft/colors";
import { DRAFT_IMPORT_ACCEPT, draftImport } from "@/cad/draft/io";
import type { CadDoc } from "@/cad/types";
import { saveFile } from "@/lib/save-file";
import { cn } from "@/lib/cn";
import { CadIcon, type CadIconName } from "../cad-icons";
import { ContextMenu, Ribbon, type RGroup, type RMenuEntry } from "../ribbon";
import { DraftCanvas, SNAP_LABEL, type DraftCanvasHandle, type DraftPrefs } from "./draft-canvas";
import { DraftCmdLine, type CmdLineHandle } from "./draft-cmdline";
import { draftCoreRibbon } from "./draft-ribbon";
import { LayerPanel, PropsPanel } from "./draft-panels";
import { UI_EXTS } from "./ui-exts";
import type { DraftRibbonTab, DraftUiApi } from "./ui-ext";

type Props = {
  doc: CadDoc;
  onCommit: (d: CadDoc) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onOpenDoc: (d: CadDoc) => void;
  onSave: () => void;
  onShare: () => void;
  onFlash: (m: string) => void;
};

const PREFS_KEY = "mn-cad-draft-prefs-v1";
const DEFAULT_PREFS: DraftPrefs = { dark: true, grid: false, gridSnap: false, ortho: false, polar: true, polarInc: 45, osnap: true, osmodes: DEFAULT_SNAPS };
function loadPrefs(): DraftPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<DraftPrefs>) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

type HistLine = { text: string; kind?: "ok" | "err" | "cmd" | "info" };

const TABS: [DraftRibbonTab, string][] = [
  ["draw", tr("Kreslení")],
  ["modify", tr("Úpravy")],
  ["layers", tr("Hladiny")],
  ["annotate", tr("Poznámky")],
  ["blocks", tr("Bloky")],
  ["layout", tr("Rozvržení")],
  ["output", tr("Výstup")],
];

export function DraftWorkspace({ doc, onCommit, onUndo, onRedo, canUndo, canRedo, onOpenDoc, onSave, onShare, onFlash }: Props) {
  const model0 = doc.draft!;
  const session = sessionFor(model0);
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribe(force), []);
  const [tab, setTab] = useState<DraftRibbonTab>("draw");
  const [panel, setPanel] = useState<string | null>(() => (typeof window !== "undefined" && window.innerWidth >= 1024 ? "properties" : null));
  const [prefs, setPrefsState] = useState<DraftPrefs>(DEFAULT_PREFS);
  useEffect(() => setPrefsState(loadPrefs()), []);
  const setPrefs = (p: Partial<DraftPrefs>) =>
    setPrefsState((cur) => {
      const n = { ...cur, ...p };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(n));
      } catch {
        /* soukromý režim */
      }
      return n;
    });
  const [history, setHistory] = useState<HistLine[]>(() => [{ text: tr("2D výkres – napište příkaz (čára, kružnice, hladina…, zkratky L, C, PL…) nebo vyberte nástroj na pásu karet."), kind: "info" }]);
  const log = useCallback((...lines: HistLine[]) => setHistory((h) => [...h, ...lines].slice(-500)), []);
  const runRef = useRef<CmdRun | null>(null);
  const [, setRunVer] = useState(0);
  const canvas = useRef<DraftCanvasHandle>(null);
  const cmdline = useRef<CmdLineHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [snapMenu, setSnapMenu] = useState(false);
  const [layerMenu, setLayerMenu] = useState(false);
  const coordsRef = useRef<HTMLSpanElement>(null);
  /** první bod vzdálenosti / úhlu bez základního bodu (dva kliky) */
  const twoClick = useRef<Vec2 | null>(null);

  const run = runRef.current && !runRef.current.done ? runRef.current : null;
  const model = run ? run.tx.model : model0;
  const space: DraftSpace = session.space;
  const list = spaceEntities(model, space) ?? model.entities;
  const prompt: Prompt | null = run?.prompt ?? null;

  /**
   * Poslední zapsaný dokument. Zápis (konec příkazu) ho přepíše hned – příkaz spuštěný ve stejné obsluze události
   * (tlačítko pásu během běžícího příkazu, Esc a nový příkaz) tak pracuje s novým výkresem, ne se starým z props.
   */
  const docRef = useRef(doc);
  const docProp = useRef(doc);
  if (docProp.current !== doc) {
    docProp.current = doc;
    docRef.current = doc;
  }
  const commitModel = useCallback(
    (m: DraftModel) => {
      const d = { ...docRef.current, draft: m };
      docRef.current = d;
      onCommit(d);
    },
    [onCommit],
  );

  // změna výkresu zvenku (textové příkazy, zpět / znovu): rozpracovaný příkaz se přeruší, výběr pročistí
  useEffect(() => {
    const r = runRef.current;
    if (r && !r.done && r.tx.original !== model0) {
      r.cancel();
      runRef.current = null;
      log({ text: tr("příkaz přerušen – výkres se mezitím změnil"), kind: "info" });
      setRunVer((v) => v + 1);
    }
    pruneSelection(session, model0);
    if (session.zoom) applyZoom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model0]);

  // požadavek na pohled z textového příkazu (zoom …) – i z příkazu, který výkres nezmění
  useEffect(() => {
    if (session.zoom) applyZoom();
  });
  const applyZoom = () => {
    const z = session.zoom;
    session.zoom = null;
    const c = canvas.current;
    if (!z || !c) return;
    if (z.kind === "extents") c.zoomExtents();
    else if (z.kind === "window") c.zoomWindow(z.box);
    else if (z.kind === "center") {
      const v = c.getView();
      if (v) c.setView({ cx: z.c[0], cy: z.c[1], scale: v.h / z.h });
    } else if (z.kind === "scale") {
      const v = c.getView();
      if (v) c.setView({ scale: v.scale * z.k });
    }
  };

  const hooks: DraftUiHooks = useMemo(
    () => ({
      openPanel: (p) => setPanel(p),
      flash: onFlash,
      download: (name, data, mime) => void saveFile(name, typeof data === "string" ? data : (data as BlobPart), mime).catch(() => undefined),
      pickFile: () => fileInput.current?.click(),
      docName: () => docRef.current.name,
    }),
    [onFlash],
  );

  const resultLines = (r: DraftCmdResult): HistLine[] => (r.ok ? r.log.map((t) => ({ text: t, kind: t.startsWith("✓") ? ("ok" as const) : undefined })) : [{ text: `✗ ${r.error}`, kind: "err" as const }]);

  /** dokončený příkaz: protokol, zápis do historie dokumentu, poslední vytvořené */
  const finishRun = (r: CmdRun) => {
    const res = r.result("");
    log(...resultLines(res));
    // zrušený příkaz (Esc) nevypíše souhrn – nakreslené entity zůstávají, ohlásit je
    if (res.ok && !res.log.length && res.created.length) log({ text: `✓ ${res.created.join(", ")}`, kind: "ok" });
    if (!r.error && !r.def.readonly && r.tx.dirty) commitModel(r.tx.model);
    if (res.created.length) session.lastCreated = res.created;
    runRef.current = null;
    twoClick.current = null;
    if (session.zoom) setTimeout(applyZoom, 0);
    setRunVer((v) => v + 1);
  };
  const afterStep = () => {
    const r = runRef.current;
    if (!r) return;
    if (r.done) finishRun(r);
    else setRunVer((v) => v + 1);
  };

  const runLine = async (text: string) => {
    const r = await runCommandLineAsync(docRef.current.draft!, session, text, { interactive: true, ui: hooks });
    log(...resultLines(r.result));
    const nm = r.result.data?.newModel as DraftModel | undefined;
    if (nm) onOpenDoc(normalizeDraftDoc({ ...emptyDraftDoc(String(r.result.data?.name ?? tr("Výkres"))), draft: nm }));
    else if (r.model !== docRef.current.draft) commitModel(r.model);
    if (session.zoom) setTimeout(applyZoom, 0);
    return r.result;
  };

  const cancelRun = () => {
    const r = runRef.current;
    if (r && !r.done) {
      r.cancel();
      finishRun(r);
      log({ text: tr("*Zrušeno*"), kind: "cmd" });
    }
  };

  const feedToken = (t: string) => {
    const r = runRef.current;
    if (!r || r.done) return;
    if (r.prompt?.k === "select") {
      if (!t.trim()) r.feed({ k: "sel", ids: [...session.sel] });
      else {
        // zápis výběru textem během výzvy výběru
        void runLine(`vyber výběr ${t}`).then(() => setRunVer((v) => v + 1));
        return;
      }
    } else {
      const err = r.feedText(t, { dir: canvas.current?.cursor().dir ?? null });
      if (err && !r.done) log({ text: `✗ ${err}`, kind: "err" });
    }
    afterStep();
  };

  /** spustí příkaz interaktivně (s volitelným zadáním předem) */
  const startCommand = (name: string, pre: string[] = []) => {
    cancelRun();
    const def = findCommand(name);
    if (!def) return log({ text: tr("✗ neznámý příkaz „{0}“", name), kind: "err" });
    session.lastCmd = def.id;
    log({ text: `> ${cmdName(def)}${pre.length ? ` ${pre.join(" ")}` : ""}`, kind: "cmd" });
    if (def.line || def.async) {
      void runLine([name, ...pre].join(" "));
      return;
    }
    const r = new CmdRun(def, docRef.current.draft!, session, { interactive: true, ui: hooks });
    runRef.current = r;
    r.start();
    // zadání předem (napsaný řádek „blok A 0,0 okno x,y x,y smazat“, volby z pásu): výběr textem se zpracuje hned
    // (všechny jeho tokeny), ostatní tokeny po jednom jako Enter
    for (let i = 0; i < pre.length && !r.done; ) {
      if (r.prompt?.k === "select" && pre[i].trim()) {
        try {
          const ni = r.feedSelection(pre, i);
          // nic se nespotřebovalo (token není výběr): jde do další výzvy jako v textu; opakovaná výzva výběru → jako Enter
          if (ni === i && r.prompt?.k === "select") feedToken(pre[i++]);
          else i = ni;
        } catch (e) {
          log({ text: `✗ ${(e as Error).message}`, kind: "err" });
          break;
        }
        continue;
      }
      feedToken(pre[i++]);
    }
    afterStep();
  };

  const submit = (text: string) => {
    if (runRef.current && !runRef.current.done) return feedToken(text);
    const t = text.trim();
    if (!t) {
      if (session.lastCmd) startCommand(session.lastCmd);
      return;
    }
    const toks = tokenize(t);
    const def = findCommand(toks[0] ?? "");
    if (!def) return log({ text: tr("✗ neznámý příkaz „{0}“ – nápověda: napište „nápověda“", toks[0] ?? t), kind: "err" });
    if (def.line || def.async) {
      session.lastCmd = def.id;
      log({ text: `> ${t}`, kind: "cmd" });
      void runLine(t);
      return;
    }
    startCommand(toks[0], toks.slice(1));
  };

  const spaceSubmits = (value: string) => {
    const r = runRef.current;
    if (r && !r.done) return r.prompt?.k !== "text";
    const first = tokenize(value)[0] ?? "";
    const def = findCommand(first);
    if (/["„']/.test(value)) return false;
    return !!def && !def.line && !def.async && !/\s/.test(value.trim());
  };

  // ---------------------------------------------------------------- vstup z plátna
  const onPoint = (p: Vec2) => {
    const r = runRef.current;
    if (!r || r.done || !r.prompt) return;
    const pm = r.prompt;
    if (pm.k === "point") r.feed({ k: "point", p });
    else if (pm.k === "dist" || pm.k === "angle") {
      if (pm.pt) r.feed({ k: "point", p });
      else {
        const b = pm.base ?? twoClick.current;
        if (!b) {
          twoClick.current = p;
          log({ text: tr("zadejte druhý bod"), kind: "info" });
          return;
        }
        twoClick.current = null;
        r.feed({ k: "num", v: pm.k === "dist" ? dist(b, p) : ((((angleOf(sub(p, b)) * 180) / Math.PI) % 360) + 360) % 360 });
      }
    }
    afterStep();
  };
  const onEntity = (id: string, p: Vec2) => {
    const r = runRef.current;
    if (!r || r.done) return;
    r.feed({ k: "ent", id, p });
    afterStep();
  };
  const onSelect = (ids: string[], mode: "add" | "remove") => {
    const cur = new Set(session.sel);
    for (const id of ids) {
      if (mode === "remove") cur.delete(id);
      else cur.add(id);
    }
    setSelection(session, [...cur]);
  };

  // ---------------------------------------------------------------- klávesy (psaní kamkoli → příkazový řádek)
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyRef.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    const inCmd = !!t?.closest?.("[data-draft-input]");
    const inField = !inCmd && !!t?.closest?.("input,textarea,select,[contenteditable=true]");
    if (inField) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    const fkeys: Record<string, () => void> = {
      F2: () => document.querySelector<HTMLButtonElement>("[data-draft-cmdline] button")?.click(),
      F3: () => setPrefs({ osnap: !prefs.osnap }),
      F7: () => setPrefs({ grid: !prefs.grid }),
      F8: () => setPrefs({ ortho: !prefs.ortho, ...(prefs.ortho ? {} : { polar: false }) }),
      F9: () => setPrefs({ gridSnap: !prefs.gridSnap }),
      F10: () => setPrefs({ polar: !prefs.polar, ...(prefs.polar ? {} : { ortho: false }) }),
    };
    if (fkeys[e.key]) {
      stop();
      return fkeys[e.key]();
    }
    if (mod && k === "z") {
      if (inCmd) {
        stop();
        if (e.shiftKey) onRedo();
        else onUndo();
      }
      return;
    }
    if (mod && k === "y") {
      if (inCmd) {
        stop();
        onRedo();
      }
      return;
    }
    if (mod && k === "a" && !inCmd) {
      stop();
      setSelection(session, list.filter((x) => !findLayer(model, x.layer)?.frozen && findLayer(model, x.layer)?.on !== false).map((x) => x.id));
      return;
    }
    if (mod || e.altKey) return;
    if (inCmd) return;
    if (e.key === "Escape") {
      stop();
      if (runRef.current && !runRef.current.done) cancelRun();
      else setSelection(session, []);
      return;
    }
    if (e.key === "Delete") {
      stop();
      if (session.sel.length) startCommand("ERASE");
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      stop();
      submit("");
      return;
    }
    if (e.key.length === 1) {
      stop();
      cmdline.current?.type(e.key);
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, []);

  // ---------------------------------------------------------------- rozšíření (balíky fáze B)
  const api: DraftUiApi = {
    doc,
    model,
    session,
    command: startCommand,
    run: async (text) => {
      const lines = text.split(/\r?\n|;/).map((x) => x.trim()).filter(Boolean);
      const out: DraftCmdResult[] = [];
      let m = docRef.current.draft!;
      for (const l of lines) {
        const r = await runCommandLineAsync(m, session, l, { interactive: true, ui: hooks });
        out.push(r.result);
        log(...resultLines(r.result));
        m = r.model;
      }
      if (m !== docRef.current.draft) commitModel(m);
      return out;
    },
    commit: commitModel,
    select: (ids) => setSelection(session, ids),
    flash: onFlash,
    view: () => canvas.current?.getView() ?? null,
    setView: (v) => canvas.current?.setView(v),
    zoomExtents: () => canvas.current?.zoomExtents(),
    space,
    setSpace: (s) => {
      session.space = s;
      setSelection(session, []);
      force();
      setTimeout(() => canvas.current?.zoomExtents(), 0);
    },
    openPanel: setPanel,
    download: hooks.download!,
    openDoc: onOpenDoc,
    redraw: () => canvas.current?.redraw(),
  };

  // ---------------------------------------------------------------- pás karet
  const selEnts = (): DraftEntity[] => session.sel.map((id) => entityById(list as DraftEntity[], id)).filter((e): e is DraftEntity => !!e);
  const layerOfSel = (fn: (m: DraftModel, layer: string) => DraftModel, what: string) => {
    const ents = selEnts();
    if (!ents.length) return onFlash(tr("Nejdřív vyberte objekt – {0}", what));
    try {
      let m = model0;
      for (const l of new Set(ents.map((e) => e.layer))) m = fn(m, l);
      commitModel(m);
    } catch (e) {
      onFlash((e as Error).message);
    }
  };
  const coreGroups = draftCoreRibbon({
    model: model0,
    panel,
    activeCmd: run?.def.id ?? null,
    command: startCommand,
    selectAll: () => setSelection(session, list.map((e) => e.id)),
    selectNone: () => setSelection(session, []),
    setPanel,
    commit: commitModel,
    layerOfSel,
    currentFromSel: () => (selEnts()[0] ? commitModel(setCurrentLayer(model0, selEnts()[0].layer)) : startCommand("LAYMCUR")),
    save: onSave,
    share: onShare,
  });
  const groups = { ...coreGroups } as Record<DraftRibbonTab, RGroup[]>;
  for (const ext of UI_EXTS) {
    const add = ext.ribbon?.(api);
    if (!add) continue;
    for (const [k, v] of Object.entries(add) as [DraftRibbonTab, RGroup[]][]) groups[k] = [...groups[k], ...v];
  }
  const extPanels = Object.fromEntries(UI_EXTS.flatMap((e) => Object.entries(e.panels ?? {})));

  const ctxEntries = (): RMenuEntry[] => [
    ...(run ? [{ id: "enter", label: tr("Potvrdit (Enter)"), icon: "check" as CadIconName, onClick: () => feedToken("") }, { id: "cancel", label: tr("Zrušit (Esc)"), icon: "x" as CadIconName, onClick: cancelRun }] : []),
    ...(!run && session.lastCmd ? [{ id: "repeat", label: tr("Opakovat {0}", cmdName(findCommand(session.lastCmd)!)), icon: "redo" as CadIconName, onClick: () => startCommand(session.lastCmd!) }] : []),
    ...(session.sel.length && !run ? [{ divider: true as const }, { id: "del", label: tr("Smazat ({0})", session.sel.length), icon: "trash" as CadIconName, onClick: () => startCommand("ERASE") }, { id: "pr", label: tr("Vlastnosti"), icon: "edit" as CadIconName, onClick: () => setPanel("properties") }, { id: "li", label: tr("Výpis"), icon: "info" as CadIconName, onClick: () => startCommand("LIST") }] : []),
    { divider: true as const },
    { id: "all", label: tr("Vybrat vše"), icon: "select" as CadIconName, onClick: () => setSelection(session, list.map((e) => e.id)) },
    { id: "ze", label: tr("Zoom – rozsah"), icon: "fit" as CadIconName, onClick: () => canvas.current?.zoomExtents() },
    ...UI_EXTS.flatMap((e) => e.context?.(api) ?? []),
  ];

  const toggles: { id: string; label: string; on: boolean; kbd: string; set: () => void }[] = [
    { id: "grid", label: tr("MŘÍŽKA"), on: prefs.grid, kbd: "F7", set: () => setPrefs({ grid: !prefs.grid }) },
    { id: "snap", label: tr("KROK"), on: prefs.gridSnap, kbd: "F9", set: () => setPrefs({ gridSnap: !prefs.gridSnap }) },
    { id: "ortho", label: "ORTHO", on: prefs.ortho, kbd: "F8", set: () => setPrefs({ ortho: !prefs.ortho, ...(prefs.ortho ? {} : { polar: false }) }) },
    { id: "polar", label: tr("POLÁRNÍ {0}°", prefs.polarInc), on: prefs.polar, kbd: "F10", set: () => setPrefs({ polar: !prefs.polar, ...(prefs.polar ? {} : { ortho: false }) }) },
    { id: "osnap", label: tr("UCHOP"), on: prefs.osnap, kbd: "F3", set: () => setPrefs({ osnap: !prefs.osnap }) },
    { id: "lwt", label: tr("TLOUŠŤKY"), on: model0.vars.lwdisplay, kbd: "LWT", set: () => commitModel({ ...model0, vars: { ...model0.vars, lwdisplay: !model0.vars.lwdisplay } }) },
  ];

  const onFile = async (f: File) => {
    try {
      const r = await draftImport(f.name, new Uint8Array(await f.arrayBuffer()));
      onOpenDoc(normalizeDraftDoc({ ...emptyDraftDoc(f.name.replace(/\.[^.]+$/, "")), draft: r.model }));
      onFlash(`${f.name}: ${r.note}`);
    } catch (e) {
      onFlash((e as Error).message);
    }
  };

  const curLayer = findLayer(model0, model0.vars.clayer);
  const dark = prefs.dark;
  const extStatus = UI_EXTS.map((e) => e.statusLeft?.(api)).filter(Boolean);
  const lang = getLang();
  void lang;

  return (
    <div data-draft-workspace className="fixed inset-x-0 bottom-0 top-[76px] z-30 flex flex-col bg-[#e9edf1] text-[12.5px] text-[#1f2933] sm:top-10">
      {/* karty pásu */}
      <div className="flex h-8 shrink-0 items-stretch gap-0.5 overflow-x-auto overflow-y-hidden bg-[#dfe5eb] px-1 [scrollbar-width:none]">
        <span className="mr-1 flex shrink-0 items-center gap-1 self-center rounded-sm bg-[#1f2933] px-2 py-1 text-[11px] font-semibold text-white">
          <CadIcon name="drawing" className="h-3.5 w-3.5" /> 2D
        </span>
        {TABS.map(([t, l]) => (
          <button key={t} type="button" data-draft-tab={t} onClick={() => setTab(t)} className={cn("mt-auto shrink-0 whitespace-nowrap rounded-t-md border px-3.5 py-1 text-[12px] font-medium", tab === t ? "border-b-[#fbfcfd] border-x-[#d5dbe2] border-t-[#d5dbe2] bg-[#fbfcfd]" : "border-x-transparent border-t-transparent border-b-[#d5dbe2] text-[#4a5664] hover:bg-white/50")}>
            {l}
          </button>
        ))}
        <div className="min-w-2 flex-1 border-b border-[#d5dbe2]" />
      </div>
      <Ribbon
        groups={groups[tab].length ? groups[tab] : [{ label: tr("Připravuje se"), items: [{ id: "soon", label: tr("Nástroje této karty doplní další balík"), icon: "info", disabled: true }] }]}
        right={
          <div className="relative flex items-center gap-2 px-3">
            <button type="button" data-draft-layer-combo onClick={() => setLayerMenu((v) => !v)} className="flex max-w-[200px] items-center gap-1.5 rounded border border-[#cfd6de] bg-white px-2 py-1 text-[12px] hover:bg-[#f3f6f9]" title={tr("Aktuální hladina")}>
              <span className="h-3 w-3 shrink-0 rounded-sm border border-black/25" style={{ background: displayHex(curLayer?.color ?? 7, false) }} />
              <span className="truncate font-medium">{model0.vars.clayer}</span>
              <CadIcon name="chevronDown" className="h-3 w-3" />
            </button>
            {layerMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setLayerMenu(false)} />
                <div className="absolute right-3 top-full z-50 mt-1 max-h-[50vh] w-60 overflow-auto rounded border border-[#cfd6de] bg-white py-1 shadow-xl">
                  {model0.layers.map((l) => (
                    <button key={l.name} type="button" disabled={l.frozen} onClick={() => { setLayerMenu(false); commitModel(setCurrentLayer(model0, l.name)); }} className={cn("flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-[#eef2f6] disabled:opacity-40", l.name === model0.vars.clayer && "font-semibold")}>
                      <span className="h-3 w-3 rounded-sm border border-black/25" style={{ background: displayHex(l.color, false) }} />
                      <span className="flex-1 truncate">{l.name}</span>
                      <span className="text-[10px] text-[#6b7785]">{[l.on ? "" : tr("vyp"), l.frozen ? tr("zmr") : "", l.locked ? tr("zam") : ""].filter(Boolean).join(" ")}</span>
                    </button>
                  ))}
                  <button type="button" className="mt-1 w-full border-t px-2 py-1 text-left text-brand hover:bg-[#eef2f6]" onClick={() => { setLayerMenu(false); setPanel("layers"); }}>
                    {tr("Správce hladin…")}
                  </button>
                </div>
              </>
            )}
          </div>
        }
      />
      <div className="relative flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1 overflow-hidden" data-draft-main>
          <DraftCanvas
            ref={canvas}
            model={model}
            list={list}
            sel={session.sel}
            prompt={prompt}
            prefs={prefs}
            onPoint={onPoint}
            onEntity={onEntity}
            onSelect={onSelect}
            onCursor={(p) => {
              if (coordsRef.current) coordsRef.current.textContent = p ? `${p[0].toFixed(model.vars.prec)}, ${p[1].toFixed(model.vars.prec)}` : "";
            }}
            onContext={(x, y) => setCtxMenu({ x, y })}
            onDblClick={(id) => {
              if (!id) return;
              if (UI_EXTS.some((e) => e.dblclick?.(api, id))) return;
              setSelection(session, [id]);
              setPanel("properties");
            }}
            onPointerHook={(ev) => UI_EXTS.some((x) => x.pointer?.(api, ev))}
            underlay={(g, v) => UI_EXTS.forEach((e) => e.underlay?.(g, api, v))}
            overlay={(g, v) => UI_EXTS.forEach((e) => e.overlay?.(g, api, v))}
          />
          <div className="pointer-events-none absolute right-2 top-2 flex gap-1">
            <button type="button" className="pointer-events-auto rounded bg-black/40 px-2 py-1 text-[11px] text-white hover:bg-black/60" onClick={() => canvas.current?.zoomExtents()} title={tr("Zoom – rozsah (poklepání prostředním tlačítkem)")}>
              <CadIcon name="fit" className="h-4 w-4" />
            </button>
            <button type="button" className="pointer-events-auto rounded bg-black/40 px-2 py-1 text-[11px] text-white hover:bg-black/60" onClick={() => setPanel(panel ? null : "properties")} title={tr("Panel vlastností a hladin")}>
              <CadIcon name="table" className="h-4 w-4" />
            </button>
          </div>
        </main>
        {panel && (
          <aside className={cn("absolute inset-y-0 right-0 z-20 flex flex-col", panel === "layers" ? "w-[min(600px,96vw)]" : "w-[min(360px,92vw)]", " border-l border-[#d5dbe2] bg-white shadow-xl lg:static lg:shadow-none")} data-draft-panel={panel}>
            <div className="flex shrink-0 items-center gap-1 border-b border-[#e3e8ee] bg-[#f6f8fa] px-1">
              {[
                ["properties", tr("Vlastnosti")],
                ["layers", tr("Hladiny")],
                ...Object.entries(extPanels).map(([id, p]) => [id, p.title()]),
              ].map(([id, l]) => (
                <button key={id} type="button" onClick={() => setPanel(id)} className={cn("rounded-t px-2.5 py-1.5 text-[12px] font-medium", panel === id ? "bg-white text-[#1f2933]" : "text-[#6b7785] hover:text-[#1f2933]")}>
                  {l}
                </button>
              ))}
              <span className="flex-1" />
              <button type="button" onClick={() => setPanel(null)} className="rounded p-1 text-[#6b7785] hover:bg-[#e6ebf1]" aria-label={tr("Zavřít")}>
                <CadIcon name="x" className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {panel === "properties" && <PropsPanel model={model0} ids={session.sel} space={space} onCommit={commitModel} onFlash={onFlash} />}
              {panel === "layers" && <LayerPanel model={model0} onCommit={commitModel} onFlash={onFlash} />}
              {extPanels[panel]?.render(api)}
            </div>
          </aside>
        )}
      </div>
      <DraftCmdLine ref={cmdline} history={history} prompt={prompt} running={run ? cmdName(run.def) : null} onSubmit={submit} onCancel={cancelRun} onKeyword={(id) => feedToken(`_${id}`)} spaceSubmits={spaceSubmits} dark={dark} />
      {/* stavový řádek */}
      <div className="flex h-7 shrink-0 items-center gap-1 overflow-x-auto border-t border-[#d5dbe2] bg-[#eef2f6] px-2 text-[11px] [scrollbar-width:none]" data-draft-status>
        {extStatus}
        <span ref={coordsRef} className="w-[150px] shrink-0 font-mono text-[#4a5664]" data-draft-coords />
        {toggles.map((t) => (
          <button key={t.id} type="button" data-toggle={t.id} data-on={t.on ? "1" : "0"} onClick={t.set} title={t.kbd} className={cn("shrink-0 rounded px-1.5 py-0.5 font-semibold tracking-wide", t.on ? "bg-[#2563eb] text-white" : "text-[#6b7785] hover:bg-white")}>
            {t.label}
          </button>
        ))}
        <div className="relative shrink-0">
          <button type="button" onClick={() => setSnapMenu((v) => !v)} className="rounded px-1 text-[#6b7785] hover:bg-white" title={tr("Režimy uchopení")} data-snap-menu>
            ▾
          </button>
          {snapMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setSnapMenu(false)} />
              <div className="absolute bottom-full left-0 z-50 mb-1 w-52 rounded border border-[#cfd6de] bg-white py-1 shadow-xl">
                {SNAP_KINDS.map((k: SnapKind) => (
                  <label key={k} className="flex items-center gap-2 px-2 py-0.5 hover:bg-[#eef2f6]">
                    <input type="checkbox" checked={prefs.osmodes.includes(k)} onChange={(e) => setPrefs({ osmodes: e.target.checked ? [...prefs.osmodes, k] : prefs.osmodes.filter((x) => x !== k), osnap: true })} />
                    {SNAP_LABEL[k]}
                  </label>
                ))}
                <div className="mt-1 border-t px-2 pt-1 text-[#6b7785]">{tr("Polární přírůstek")}</div>
                <div className="flex flex-wrap gap-1 px-2 pb-1">
                  {[5, 10, 15, 22.5, 30, 45, 90].map((a) => (
                    <button key={a} type="button" onClick={() => setPrefs({ polarInc: a, polar: true, ortho: false })} className={cn("rounded border px-1", prefs.polarInc === a && "border-brand text-brand")}>
                      {a}°
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        <button type="button" onClick={() => setPrefs({ dark: !prefs.dark })} className="shrink-0 rounded px-1.5 py-0.5 text-[#6b7785] hover:bg-white" title={tr("Tmavé / světlé pozadí")} data-toggle="dark">
          {prefs.dark ? tr("TMAVÉ") : tr("SVĚTLÉ")}
        </button>
        <span className="flex-1" />
        <span className="shrink-0 text-[#6b7785]" data-draft-count>
          {tr("{0} entit", list.length)}
          {session.sel.length ? ` · ${tr("vybráno {0}", session.sel.length)}` : ""} · {model0.vars.units}
        </span>
        <button type="button" disabled={!canUndo} onClick={onUndo} className="shrink-0 rounded p-0.5 text-[#4a5664] hover:bg-white disabled:opacity-30" title={tr("Zpět (Ctrl+Z)")}>
          <CadIcon name="undo" className="h-3.5 w-3.5" />
        </button>
        <button type="button" disabled={!canRedo} onClick={onRedo} className="shrink-0 rounded p-0.5 text-[#4a5664] hover:bg-white disabled:opacity-30" title={tr("Znovu (Ctrl+Y)")}>
          <CadIcon name="redo" className="h-3.5 w-3.5" />
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept={DRAFT_IMPORT_ACCEPT}
        className="hidden"
        data-draft-file
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
          e.target.value = "";
        }}
      />
      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} entries={ctxEntries()} close={() => setCtxMenu(null)} />}
    </div>
  );
}
