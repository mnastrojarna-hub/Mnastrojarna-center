"use client";

import * as React from "react";
import {
  AlertTriangle, Box, ChevronDown, ChevronRight, Diameter, Eye, EyeOff, Focus, HelpCircle, Layers, ListTree, Loader2,
  Maximize2, MousePointer2, Redo2, Ruler, Trash2, TriangleRight, Undo2, X, ZoomIn, ZoomOut,
} from "lucide-react";
import type { ModelNode } from "@/lib/viewer3d/types";
import type { LoadStage } from "@/lib/viewer3d/worker-protocol";
import { fmtMm, steelMassKg, type Measurement } from "@/lib/viewer3d/measure";
import type { Model3DFormat } from "@/lib/viewer3d/sniff";
import { cn } from "@/lib/utils";
import { ViewerEngine, type ChangeKind, type ContextRequest, type DisplayMode, type StdView, type Tool } from "./engine";
import { loadModel } from "./load-model";

export interface ModelViewerProps {
  /** Obsah souboru (předá se do workeru — volající ho už nesmí potřebovat). */
  bytes: ArrayBuffer;
  format: Model3DFormat | "pdf";
  name: string;
  /** Popisek formátu do stavového řádku (např. „STEP (AP214)"). */
  formatLabel?: string;
  className?: string;
}

const STAGE_TEXT: Record<LoadStage, string> = {
  download: "Stahuji soubor…",
  engine: "Spouštím CAD jádro (OpenCascade)…",
  parse: "Čtu geometrii modelu…",
  topology: "Připravuji hrany a body pro měření…",
  render: "Vykresluji…",
};

const VIEWS: { key: StdView; label: string; kbd: string }[] = [
  { key: "iso", label: "Izometrie", kbd: "0" },
  { key: "front", label: "Zepředu", kbd: "1" },
  { key: "back", label: "Zezadu", kbd: "2" },
  { key: "left", label: "Zleva", kbd: "3" },
  { key: "right", label: "Zprava", kbd: "4" },
  { key: "top", label: "Shora", kbd: "5" },
  { key: "bottom", label: "Zespodu", kbd: "6" },
];

const DISPLAYS: { key: DisplayMode; label: string }[] = [
  { key: "shaded-edges", label: "Stínovaný s hranami" },
  { key: "shaded", label: "Stínovaný" },
  { key: "wireframe", label: "Drátový (jen hrany)" },
  { key: "xray", label: "Průhledný (rentgen)" },
];

const TOOL_HINT: Record<Exclude<Tool, "select">, [string, string]> = {
  distance: ["Klikni na 1. místo — roh, střed díry, střed hrany, hranu nebo plochu.", "Klikni na 2. místo."],
  diameter: ["Klikni na kružnici, oblouk nebo válcovou plochu (díra, čep).", ""],
  angle: ["Klikni na 1. hranu nebo rovinnou plochu.", "Klikni na 2. hranu nebo plochu."],
};

function fmt1(v: number): string {
  return v.toFixed(v >= 100 ? 1 : 2).replace(".", ",");
}

/**
 * Změny z enginu: „snap" (každý pohyb myši při měření) jde jen ke značce uchopení,
 * ostatní překreslí panely — strom velké sestavy se tak nepřekresluje při každém pohybu.
 */
function useEngineEvents(): { bump: (k: ChangeKind) => void; subscribeSnap: (fn: () => void) => () => void } {
  const [, setV] = React.useState(0);
  const snapSubs = React.useRef(new Set<() => void>());
  const bump = React.useCallback((k: ChangeKind) => {
    if (k === "snap") snapSubs.current.forEach((fn) => fn());
    else setV((x) => x + 1);
  }, []);
  const subscribeSnap = React.useCallback((fn: () => void) => {
    snapSubs.current.add(fn);
    return () => {
      snapSubs.current.delete(fn);
    };
  }, []);
  return { bump, subscribeSnap };
}

/** Prohlížeč 3D modelu (STEP, IGES, STL, 3D PDF…) s ovládáním jako ZW3D. */
export function ModelViewer({ bytes, format, name, formatLabel, className }: ModelViewerProps) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const engineRef = React.useRef<ViewerEngine | null>(null);
  const [stage, setStage] = React.useState<LoadStage | "ready">("download");
  const [error, setError] = React.useState<string | null>(null);
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [modelFormat, setModelFormat] = React.useState<string>(formatLabel ?? "");
  const { bump, subscribeSnap } = useEngineEvents();
  const [menu, setMenu] = React.useState<ContextRequest | null>(null);
  const [panel, setPanel] = React.useState<"tree" | "views" | "display" | null>(null);
  const [help, setHelp] = React.useState(false);
  const [isWide, setIsWide] = React.useState(true);

  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const upd = () => setIsWide(mq.matches);
    upd();
    mq.addEventListener("change", upd);
    return () => mq.removeEventListener("change", upd);
  }, []);

  // engine + načtení modelu
  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let engine: ViewerEngine;
    try {
      engine = new ViewerEngine(host, bump, (req) => setMenu(req));
    } catch {
      setError("Prohlížeč nemůže spustit 3D grafiku (WebGL). Zkus jiný prohlížeč nebo zapni hardwarovou akceleraci.");
      return;
    }
    engineRef.current = engine;
    const ac = new AbortController();
    setStage("parse");
    loadModel({ format, bytes, name } as Parameters<typeof loadModel>[0], (s) => setStage(s), ac.signal)
      .then((res) => {
        if (ac.signal.aborted) return;
        setStage("render");
        engine.load(res.model, res.topology, res.zUp);
        setWarnings(res.model.warnings ?? []);
        setModelFormat((f) => f || res.model.format);
        if (res.model.parts.length > 1 && window.matchMedia("(min-width: 1024px)").matches) setPanel("tree");
        setStage("ready");
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      ac.abort();
      engine.dispose();
      engineRef.current = null;
    };
    // bytes se předávají do workeru jen jednou (při změně zdroje se komponenta přepíná klíčem)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // klávesy (Esc nejdřív ruší měření / výběr, až potom zavře prohlížeč)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const eng = engineRef.current;
      if (!eng || stage !== "ready") return;
      if (e.key === "Escape" && (menu || panel || help)) {
        setMenu(null);
        setPanel((p) => (p === "tree" && isWide ? p : null));
        setHelp(false);
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (eng.handleKey(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [stage, menu, panel, help, isWide]);

  const eng = engineRef.current;
  const ready = stage === "ready" && !!eng && !error;
  const tool = eng?.getTool() ?? "select";
  const selection = eng?.getSelection() ?? [];
  const measures = eng?.getMeasures() ?? [];
  const hidden = eng?.hiddenCount() ?? 0;
  const display = eng?.getDisplay() ?? "shaded-edges";

  const setTool = (t: Tool) => {
    eng?.setTool(eng.getTool() === t && t !== "select" ? "select" : t);
    setMenu(null);
  };

  return (
    <div className={cn("relative h-full w-full select-none overflow-hidden bg-gradient-to-b from-[#d6dee8] to-[#f6f8fa] dark:from-[#2b3139] dark:to-[#121417]", className)}>
      <div ref={hostRef} className="absolute inset-0" data-testid="viewer3d-canvas" />

      {/* načítání / chyba */}
      {!error && stage !== "ready" && (
        <div className="absolute inset-0 z-20 flex items-center justify-center">
          <div className="flex items-center gap-3 rounded-xl border bg-card/95 px-4 py-3 text-sm shadow-lg">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span>{STAGE_TEXT[stage]}</span>
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
          <div className="max-w-md rounded-xl border bg-card p-5 text-center shadow-lg" role="alert">
            <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" />
            <p className="mt-2 font-semibold">3D model se nepodařilo zobrazit</p>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          </div>
        </div>
      )}

      {ready && (
        <>
          {/* lišta nástrojů: počítač nahoře, telefon dole */}
          <Toolbar
            wide={isWide}
            tool={tool}
            onTool={setTool}
            canUndo={eng!.canUndo()}
            canRedo={eng!.canRedo()}
            hasSelection={selection.length > 0}
            hidden={hidden}
            panel={panel}
            onPanel={(p) => setPanel((cur) => (cur === p ? null : p))}
            onUndo={() => eng!.undo()}
            onRedo={() => eng!.redo()}
            onDelete={() => eng!.deleteSelected()}
            onIsolate={() => eng!.isolate(selection)}
            onShowAll={() => eng!.showAll()}
            onFit={() => eng!.fit()}
            onHelp={() => setHelp(true)}
          />

          {panel === "views" && (
            <Popover wide={isWide} onClose={() => setPanel(null)} title="Pohled">
              {VIEWS.map((v) => (
                <MenuItem key={v.key} onClick={() => { eng!.setView(v.key); setPanel(null); }} kbd={v.kbd}>{v.label}</MenuItem>
              ))}
              <div className="my-1 border-t" />
              <MenuItem onClick={() => { eng!.zoomBy(1 / 1.4); }} kbd="+"><ZoomIn className="h-4 w-4" /> Přiblížit</MenuItem>
              <MenuItem onClick={() => { eng!.zoomBy(1.4); }} kbd="−"><ZoomOut className="h-4 w-4" /> Oddálit</MenuItem>
            </Popover>
          )}
          {panel === "display" && (
            <Popover wide={isWide} onClose={() => setPanel(null)} title="Zobrazení">
              {DISPLAYS.map((d) => (
                <MenuItem key={d.key} active={display === d.key} onClick={() => { eng!.setDisplay(d.key); setPanel(null); }}>{d.label}</MenuItem>
              ))}
            </Popover>
          )}
          {panel === "tree" && (
            <TreePanel engine={eng!} wide={isWide} onClose={() => setPanel(null)} />
          )}

          {/* pravý sloupec (telefon: nahoře vedle kostky): vybraný díl + měření */}
          <div
            className={cn(
              "pointer-events-none absolute z-30 flex flex-col gap-2",
              isWide ? "bottom-10 right-2 top-[7.25rem] w-72" : "left-2 right-[7rem] top-2 max-h-[46%]",
            )}
          >
            {tool === "select" && selection.length > 0 && <PartCard engine={eng!} selection={selection} />}
            {(tool !== "select" || (measures.length > 0 && (isWide || selection.length === 0))) && (
              <MeasurePanel
                wide={isWide}
                tool={tool}
                pending={eng!.hasPending()}
                measures={measures}
                onRemove={(id) => eng!.removeMeasure(id)}
                onClear={() => eng!.clearMeasures()}
                onDone={() => eng!.setTool("select")}
              />
            )}
          </div>

          {/* uchopení při měření */}
          {tool !== "select" && <SnapLayer engine={eng!} subscribe={subscribeSnap} />}

          {/* stavový řádek */}
          <StatusBar engine={eng!} format={modelFormat} wide={isWide} warnings={warnings} />

          {menu && (
            <ContextMenu
              req={menu}
              engine={eng!}
              onClose={() => setMenu(null)}
              hostRect={hostRef.current?.getBoundingClientRect() ?? null}
            />
          )}
          {help && <HelpOverlay onClose={() => setHelp(false)} />}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- lišta

function ToolButton({
  icon: Icon, label, active, disabled, onClick, kbd, testId,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  kbd?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      title={kbd ? `${label} (${kbd})` : label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "flex h-11 min-w-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1.5 text-[10px] font-medium transition md:h-9 md:min-w-9 md:flex-row md:px-2 md:text-xs",
        active ? "bg-primary text-primary-foreground shadow-sm" : "text-foreground/80 hover:bg-accent hover:text-foreground",
        disabled && "pointer-events-none opacity-35",
      )}
    >
      <Icon className="h-[18px] w-[18px] md:h-4 md:w-4" />
      <span className="max-w-[4.5rem] truncate md:hidden">{label}</span>
    </button>
  );
}

const Sep = () => <span aria-hidden className="mx-0.5 h-7 w-px shrink-0 bg-border md:h-6" />;

function Toolbar(p: {
  wide: boolean;
  tool: Tool;
  onTool: (t: Tool) => void;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  hidden: number;
  panel: string | null;
  onPanel: (p: "tree" | "views" | "display") => void;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
  onIsolate: () => void;
  onShowAll: () => void;
  onFit: () => void;
  onHelp: () => void;
}) {
  return (
    <div
      className={cn(
        "absolute z-30 flex max-w-full items-center gap-0.5 overflow-x-auto border bg-card/95 p-1 shadow-lg backdrop-blur scrollbar-thin",
        p.wide ? "left-1/2 top-2 -translate-x-1/2 rounded-xl" : "inset-x-0 bottom-0 rounded-none border-x-0 border-b-0 pb-[max(0.25rem,env(safe-area-inset-bottom))]",
      )}
      role="toolbar"
      aria-label="Nástroje 3D prohlížeče"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <ToolButton icon={MousePointer2} label="Výběr" active={p.tool === "select"} onClick={() => p.onTool("select")} testId="tool-select" />
      <ToolButton icon={Ruler} label="Vzdálenost" kbd="M" active={p.tool === "distance"} onClick={() => p.onTool("distance")} testId="tool-distance" />
      <ToolButton icon={Diameter} label="Průměr" active={p.tool === "diameter"} onClick={() => p.onTool("diameter")} testId="tool-diameter" />
      <ToolButton icon={TriangleRight} label="Úhel" active={p.tool === "angle"} onClick={() => p.onTool("angle")} testId="tool-angle" />
      <Sep />
      <ToolButton icon={Undo2} label="Zpět" kbd="Ctrl+Z" disabled={!p.canUndo} onClick={p.onUndo} testId="tool-undo" />
      <ToolButton icon={Redo2} label="Vpřed" kbd="Ctrl+Y" disabled={!p.canRedo} onClick={p.onRedo} testId="tool-redo" />
      <Sep />
      <ToolButton icon={Trash2} label="Smazat díl" kbd="Del" disabled={!p.hasSelection} onClick={p.onDelete} testId="tool-delete" />
      <ToolButton icon={Focus} label="Izolovat" kbd="I" disabled={!p.hasSelection} onClick={p.onIsolate} testId="tool-isolate" />
      <ToolButton icon={Eye} label={p.hidden ? `Ukázat vše (${p.hidden})` : "Ukázat vše"} disabled={!p.hidden} onClick={p.onShowAll} testId="tool-showall" />
      <Sep />
      <ToolButton icon={Maximize2} label="Celý model" kbd="F" onClick={p.onFit} testId="tool-fit" />
      <ToolButton icon={Box} label="Pohledy" active={p.panel === "views"} onClick={() => p.onPanel("views")} testId="tool-views" />
      <ToolButton icon={Layers} label="Zobrazení" active={p.panel === "display"} onClick={() => p.onPanel("display")} testId="tool-display" />
      <ToolButton icon={ListTree} label="Díly" active={p.panel === "tree"} onClick={() => p.onPanel("tree")} testId="tool-tree" />
      <ToolButton icon={HelpCircle} label="Ovládání" onClick={p.onHelp} testId="tool-help" />
    </div>
  );
}

function Popover({ wide, title, onClose, children }: { wide: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "absolute z-40 w-60 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl",
        wide ? "left-1/2 top-14 -translate-x-1/2" : "inset-x-2 bottom-[4.25rem] w-auto",
      )}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-2 py-1 text-xs font-semibold text-muted-foreground">
        {title}
        <button type="button" onClick={onClose} aria-label="Zavřít" className="rounded p-1 hover:bg-accent"><X className="h-3.5 w-3.5" /></button>
      </div>
      {children}
    </div>
  );
}

function MenuItem({ children, onClick, kbd, active, danger }: { children: React.ReactNode; onClick: () => void; kbd?: string; active?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-10 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-accent md:min-h-8",
        active && "bg-accent font-semibold",
        danger && "text-red-600 dark:text-red-400",
      )}
    >
      <span className="flex flex-1 items-center gap-2">{children}</span>
      {kbd && <kbd className="rounded border bg-muted px-1.5 text-[10px] text-muted-foreground">{kbd}</kbd>}
    </button>
  );
}

// ---------------------------------------------------------------- strom dílů

function collectParts(n: ModelNode, out: number[] = []): number[] {
  out.push(...n.parts);
  for (const c of n.children) collectParts(c, out);
  return out;
}

function TreePanel({ engine, wide, onClose }: { engine: ViewerEngine; wide: boolean; onClose: () => void }) {
  const root = engine.getTree();
  const sel = new Set(engine.getSelection());
  return (
    <div
      className={cn(
        "absolute z-30 flex flex-col overflow-hidden rounded-xl border bg-card/95 shadow-xl backdrop-blur",
        wide ? "bottom-10 left-2 top-14 w-72" : "inset-x-2 bottom-[4.25rem] max-h-[55%]",
      )}
      onPointerDown={(e) => e.stopPropagation()}
      data-testid="viewer3d-tree"
    >
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <ListTree className="h-4 w-4 text-muted-foreground" />
        <span className="flex-1 text-sm font-semibold">Díly sestavy ({engine.partCount()})</span>
        <button type="button" onClick={onClose} aria-label="Zavřít strom" className="rounded p-1 hover:bg-accent"><X className="h-4 w-4" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-1 text-sm scrollbar-thin">
        <TreeNode node={root} engine={engine} sel={sel} depth={0} />
      </div>
      <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">Klik = vybrat · oko = skrýt / ukázat · Ctrl+klik = více dílů</p>
    </div>
  );
}

function TreeNode({ node, engine, sel, depth }: { node: ModelNode; engine: ViewerEngine; sel: Set<number>; depth: number }) {
  const [open, setOpen] = React.useState(depth < 1);
  const all = React.useMemo(() => collectParts(node), [node]);
  const allHidden = all.length > 0 && all.every((i) => engine.isHidden(i));
  const isLeafPart = node.children.length === 0 && node.parts.length === 1;
  if (isLeafPart) return <PartRow index={node.parts[0]} engine={engine} sel={sel} depth={depth} label={node.name} />;
  return (
    <div>
      <div className="flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-accent/60" style={{ paddingLeft: depth * 12 + 4 }}>
        <button type="button" onClick={() => setOpen((o) => !o)} className="rounded p-0.5 text-muted-foreground hover:bg-accent" aria-label={open ? "Sbalit" : "Rozbalit"}>
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => (allHidden ? engine.showParts(all) : engine.hideParts(all))}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent"
          aria-label={allHidden ? "Ukázat skupinu" : "Skrýt skupinu"}
        >
          {allHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
        <button type="button" onClick={(e) => engine.select(all, e.ctrlKey || e.metaKey || e.shiftKey)} className={cn("min-w-0 flex-1 truncate text-left font-medium", allHidden && "text-muted-foreground line-through")}>
          {node.name} <span className="text-xs font-normal text-muted-foreground">({all.length})</span>
        </button>
      </div>
      {open && (
        <div>
          {node.parts.map((i) => <PartRow key={`p${i}`} index={i} engine={engine} sel={sel} depth={depth + 1} />)}
          {node.children.map((c, i) => <TreeNode key={i} node={c} engine={engine} sel={sel} depth={depth + 1} />)}
        </div>
      )}
    </div>
  );
}

function PartRow({ index, engine, sel, depth, label }: { index: number; engine: ViewerEngine; sel: Set<number>; depth: number; label?: string }) {
  const hidden = engine.isHidden(index);
  const selected = sel.has(index);
  return (
    <div
      className={cn("flex items-center gap-1 rounded-md px-1 py-0.5", selected ? "bg-amber-100 dark:bg-amber-500/20" : "hover:bg-accent/60")}
      style={{ paddingLeft: depth * 12 + 22 }}
    >
      <button
        type="button"
        onClick={() => (hidden ? engine.showParts([index]) : engine.hideParts([index]))}
        className="rounded p-0.5 text-muted-foreground hover:bg-accent"
        aria-label={hidden ? "Ukázat díl" : "Skrýt díl"}
      >
        {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        disabled={hidden}
        onClick={(e) => engine.select([index], e.ctrlKey || e.metaKey || e.shiftKey)}
        onDoubleClick={() => engine.fit(true)}
        className={cn("min-w-0 flex-1 truncate text-left", hidden && "text-muted-foreground line-through")}
        title={label ?? engine.partName(index)}
      >
        {label ?? engine.partName(index)}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- měření

function MeasurePanel({
  wide, tool, pending, measures, onRemove, onClear, onDone,
}: {
  wide: boolean;
  tool: Tool;
  pending: boolean;
  measures: Measurement[];
  onRemove: (id: number) => void;
  onClear: () => void;
  onDone: () => void;
}) {
  const hint = tool !== "select" ? TOOL_HINT[tool][pending ? 1 : 0] || TOOL_HINT[tool][0] : null;
  const list = [...measures].reverse();
  const [collapsed, setCollapsed] = React.useState(false);
  return (
    <div
      className="pointer-events-auto flex min-h-0 shrink flex-col overflow-hidden rounded-xl border bg-card/95 shadow-xl backdrop-blur"
      onPointerDown={(e) => e.stopPropagation()}
      data-testid="viewer3d-measure"
    >
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Ruler className="h-4 w-4 text-[#1f6feb]" />
        <span className="flex-1 text-sm font-semibold">Měření{measures.length ? ` (${measures.length})` : ""}</span>
        {measures.length > 0 && (
          <button type="button" onClick={onClear} className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">Smazat vše</button>
        )}
        {!wide && (
          <button type="button" onClick={() => setCollapsed((c) => !c)} className="rounded p-1 hover:bg-accent" aria-label={collapsed ? "Rozbalit" : "Sbalit"}>
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4 rotate-90" />}
          </button>
        )}
        {tool !== "select" && (
          <button type="button" onClick={onDone} className="rounded p-1 hover:bg-accent" aria-label="Ukončit měření"><X className="h-4 w-4" /></button>
        )}
      </div>
      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
          {hint && (
            <p className="border-b bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:bg-blue-500/10 dark:text-blue-200" data-testid="measure-hint">
              {hint}
              {tool === "distance" && <span className="mt-1 block text-[11px] opacity-75">Na kružnici se chytá její střed; Alt = bod přímo na hraně.</span>}
            </p>
          )}
          {list.length === 0 && !hint && <p className="px-3 py-3 text-xs text-muted-foreground">Zatím nic nezměřeno.</p>}
          <ul className="divide-y">
            {list.map((m) => (
              <li key={m.id} className="group px-3 py-2" data-testid="measure-item">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    {m.lines.filter((l) => l.primary).map((l) => (
                      <p key={l.label} className="text-xs text-muted-foreground">{l.label}<span className="block text-base font-bold tabular-nums text-foreground">{l.value}</span></p>
                    ))}
                    <dl className="mt-1 grid grid-cols-[auto,1fr] gap-x-2 text-[11px] tabular-nums">
                      {m.lines.filter((l) => !l.primary).map((l) => (
                        <React.Fragment key={l.label}>
                          <dt className="text-muted-foreground">{l.label}</dt>
                          <dd className="text-right">{l.value}</dd>
                        </React.Fragment>
                      ))}
                    </dl>
                  </div>
                  <button type="button" onClick={() => onRemove(m.id)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Smazat měření">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SnapLayer({ engine, subscribe }: { engine: ViewerEngine; subscribe: (fn: () => void) => () => void }) {
  const [, setV] = React.useState(0);
  React.useEffect(() => subscribe(() => setV((x) => x + 1)), [subscribe]);
  const snap = engine.getSnap();
  return snap ? <SnapMarker kind={snap.kind} x={snap.x} y={snap.y} text={snap.text} /> : null;
}

function SnapMarker({ kind, x, y, text }: { kind: string; x: number; y: number; text: string }) {
  const s = 14;
  const shape =
    kind === "vertex" ? <rect x={2} y={2} width={s - 4} height={s - 4} fill="none" stroke="#ff3b00" strokeWidth={2} />
      : kind === "center" ? <><circle cx={s / 2} cy={s / 2} r={s / 2 - 2} fill="none" stroke="#ff3b00" strokeWidth={2} /><path d={`M${s / 2} 1V${s - 1}M1 ${s / 2}H${s - 1}`} stroke="#ff3b00" strokeWidth={1.5} /></>
        : kind === "midpoint" ? <path d={`M${s / 2} 2L${s - 2} ${s - 2}H2Z`} fill="none" stroke="#ff3b00" strokeWidth={2} />
          : kind === "edge" ? <path d={`M2 2L${s - 2} ${s - 2}M${s - 2} 2L2 ${s - 2}`} stroke="#ff3b00" strokeWidth={2} />
            : <circle cx={s / 2} cy={s / 2} r={3} fill="#ff3b00" />;
  return (
    <div className="pointer-events-none absolute left-0 top-0 z-20" style={{ transform: `translate(${x - s / 2}px, ${y - s / 2}px)` }} data-testid="snap-marker" data-kind={kind}>
      <svg width={s} height={s} aria-hidden>{shape}</svg>
      <span className="absolute left-4 top-3 whitespace-nowrap rounded bg-[#272425]/85 px-1.5 py-0.5 text-[11px] font-medium text-white">{text}</span>
    </div>
  );
}

// ---------------------------------------------------------------- díl, stav, nabídka, nápověda

function PartCard({ engine, selection }: { engine: ViewerEngine; selection: number[] }) {
  const one = selection.length === 1 ? engine.partInfo(selection[0]) : null;
  return (
    <div
      className="pointer-events-auto shrink-0 overflow-auto rounded-xl border bg-card/95 p-3 text-sm shadow-xl backdrop-blur"
      onPointerDown={(e) => e.stopPropagation()}
      data-testid="viewer3d-part"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold" title={one?.name}>{one ? one.name : `Vybráno dílů: ${selection.length}`}</p>
          {one && (
            <dl className="mt-1 grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-xs tabular-nums">
              <dt className="text-muted-foreground">Rozměr</dt>
              <dd className="text-right">{one.size.map(fmt1).join(" × ")} mm</dd>
              {one.volume > 0 && (
                <>
                  <dt className="text-muted-foreground">Objem</dt>
                  <dd className="text-right">{(one.volume / 1000).toFixed(2).replace(".", ",")} cm³</dd>
                  <dt className="text-muted-foreground">Hmotnost (ocel)</dt>
                  <dd className="text-right">{steelMassKg(one.volume).toFixed(3).replace(".", ",")} kg</dd>
                </>
              )}
              <dt className="text-muted-foreground">Povrch</dt>
              <dd className="text-right">{(one.area / 100).toFixed(2).replace(".", ",")} cm²</dd>
              {one.holes.length > 0 && (
                <>
                  <dt className="text-muted-foreground">Průměry</dt>
                  <dd className="text-right">{one.holes.map((d) => `Ø${d.toString().replace(".", ",")}`).join(" · ")}</dd>
                </>
              )}
            </dl>
          )}
        </div>
        <button type="button" onClick={() => engine.clearSelection()} aria-label="Zrušit výběr" className="rounded p-1 hover:bg-accent"><X className="h-4 w-4" /></button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => engine.deleteSelected()} className="inline-flex min-h-9 items-center gap-1 rounded-md border px-2 text-xs font-medium hover:bg-accent"><Trash2 className="h-3.5 w-3.5" /> Smazat</button>
        <button type="button" onClick={() => engine.isolate(selection)} className="inline-flex min-h-9 items-center gap-1 rounded-md border px-2 text-xs font-medium hover:bg-accent"><Focus className="h-3.5 w-3.5" /> Izolovat</button>
        <button type="button" onClick={() => engine.fit(true)} className="inline-flex min-h-9 items-center gap-1 rounded-md border px-2 text-xs font-medium hover:bg-accent"><Maximize2 className="h-3.5 w-3.5" /> Přiblížit</button>
      </div>
    </div>
  );
}

function StatusBar({ engine, format, wide, warnings }: { engine: ViewerEngine; format: string; wide: boolean; warnings: string[] }) {
  const size = engine.modelSize();
  const hidden = engine.hiddenCount();
  return (
    <div
      className={cn(
        "pointer-events-none absolute z-10 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg bg-card/80 px-2 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur",
        wide ? "bottom-2 left-2" : "bottom-[4.25rem] left-2",
      )}
      data-testid="viewer3d-status"
    >
      <span className="font-medium text-foreground tabular-nums">{size.map(fmt1).join(" × ")} mm</span>
      <span>· {engine.partCount()} {engine.partCount() === 1 ? "díl" : engine.partCount() < 5 ? "díly" : "dílů"}{hidden ? ` (${hidden} skryto)` : ""}</span>
      {format && <span>· {format}</span>}
      {warnings.length > 0 && (
        <span className="pointer-events-auto inline-flex items-center gap-1 text-amber-700 dark:text-amber-400" title={warnings.join("\n")}>
          <AlertTriangle className="h-3 w-3" /> {warnings.length === 1 ? warnings[0] : `${warnings.length} upozornění`}
        </span>
      )}
    </div>
  );
}

function ContextMenu({ req, engine, onClose, hostRect }: { req: ContextRequest; engine: ViewerEngine; onClose: () => void; hostRect: DOMRect | null }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const close = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [onClose]);
  const left = hostRect ? Math.min(req.clientX - hostRect.left, hostRect.width - 230) : 8;
  const top = hostRect ? Math.min(req.clientY - hostRect.top, hostRect.height - 260) : 8;
  const sel = engine.getSelection();
  const act = (f: () => void) => () => {
    f();
    onClose();
  };
  return (
    <div ref={ref} className="absolute z-50 w-56 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl" style={{ left: Math.max(4, left), top: Math.max(4, top) }} data-testid="viewer3d-context">
      {req.part !== null && (
        <>
          <p className="truncate px-2.5 py-1 text-xs font-semibold text-muted-foreground">{engine.partName(req.part)}</p>
          <MenuItem onClick={act(() => engine.deleteSelected())} kbd="Del"><Trash2 className="h-4 w-4" /> Smazat díl</MenuItem>
          <MenuItem onClick={act(() => engine.isolate(sel.length ? sel : [req.part!]))} kbd="I"><Focus className="h-4 w-4" /> Izolovat</MenuItem>
          <MenuItem onClick={act(() => engine.fit(true))} kbd="F"><Maximize2 className="h-4 w-4" /> Přiblížit na díl</MenuItem>
          <div className="my-1 border-t" />
        </>
      )}
      <MenuItem onClick={act(() => engine.showAll())}><Eye className="h-4 w-4" /> Ukázat vše</MenuItem>
      <MenuItem onClick={act(() => engine.fit())} kbd="Ctrl+F"><Maximize2 className="h-4 w-4" /> Celý model</MenuItem>
      <MenuItem onClick={act(() => engine.setView("iso"))} kbd="0"><Box className="h-4 w-4" /> Izometrie</MenuItem>
      <MenuItem onClick={act(() => engine.undo())} kbd="Ctrl+Z"><Undo2 className="h-4 w-4" /> Zpět</MenuItem>
      <MenuItem onClick={act(() => engine.redo())} kbd="Ctrl+Y"><Redo2 className="h-4 w-4" /> Vpřed</MenuItem>
    </div>
  );
}

const HELP: [string, string][] = [
  ["Otáčení", "prostřední tlačítko (nebo levé) + táhnout · 1 prst"],
  ["Posun", "Shift / Ctrl + prostřední, nebo pravé tlačítko + táhnout · 2 prsty"],
  ["Přiblížení", "kolečko myši (ke kurzoru) · roztažení 2 prstů"],
  ["Celý model", "F nebo Ctrl+F · dvojklik do prázdna"],
  ["Výběr dílu", "klik · Ctrl / Shift + klik = více dílů"],
  ["Smazat / skrýt díl", "Del nebo H · Izolovat = I"],
  ["Zpět / vpřed", "Ctrl+Z / Ctrl+Y"],
  ["Pohledy", "0 izometrie · 1 zepředu · 2 zezadu · 3 zleva · 4 zprava · 5 shora · 6 zespodu · klik na kostku"],
  ["Měření", "M = vzdálenost · na kružnici chytá střed · Alt = bod na hraně · Esc = zrušit"],
  ["Místní nabídka", "pravé tlačítko · na telefonu podržet prst"],
];

function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onPointerDown={onClose}>
      <div className="max-h-full w-full max-w-lg overflow-auto rounded-xl border bg-card p-4 shadow-2xl" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="Ovládání prohlížeče">
        <div className="flex items-center justify-between">
          <p className="font-semibold">Ovládání (jako ZW3D)</p>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-accent" aria-label="Zavřít"><X className="h-4 w-4" /></button>
        </div>
        <dl className="mt-3 space-y-2 text-sm">
          {HELP.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[8.5rem,1fr] gap-2">
              <dt className="font-medium">{k}</dt>
              <dd className="text-muted-foreground">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">Smazání dílu jen skryje díl v prohlížeči — originální soubor se nemění. Míry jsou v milimetrech.</p>
      </div>
    </div>
  );
}

export { fmtMm };
