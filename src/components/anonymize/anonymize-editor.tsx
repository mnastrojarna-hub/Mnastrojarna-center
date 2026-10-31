"use client";

import * as React from "react";
import {
  AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Hand, Loader2, Minus, Plus, RotateCcw, Save, ScanSearch, Square, Stamp, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { anonApi, previewUrl, type AnonStateDto, type AnonTableParam } from "./anon-api";
import { FileAnonBadge } from "./anon-badge";
import { ANON_CATEGORY_COLOR, ANON_CATEGORY_LABELS, describeCounts, displayReason, NOTHING_REMOVED, type AnonUiStatus } from "./anon-status";
import {
  addRect, anchorScroll, clampZoom, diffCounts, fromServer, lineAt, lineState, needsKeepConfirm, pinchZoom, rectFromDrag, stampZoom, titleBlockBox,
  toggleLine, toggleRegion, toManualSet, touchesKeep, uniqueText, type EdLine, type EdRegion, type KeepBoxN, type NBox,
} from "./editor-geometry";

/**
 * Editor anonymizace (spec §6.3, mobil první):
 *  - „Před" = serverový náhled originálu (PNG ≤ 2400 px, žádný pdf.js v prohlížeči), „Po" = výsledek,
 *  - u PDF řádky textové vrstvy: 1 ťuknutí = smazat / nechat (u chráněného pole ze serveru potvrzení),
 *  - „Přidat obdélník" je samostatný režim (jen v něm tažení kreslí; jinak prst posouvá, dva prsty přibližují
 *    kolem místa pod prsty); obdélník přes chráněné pole chce potvrzení,
 *  - seznam oblastí pod náhledem s přepínačem (přístupný bez myši), sticky spodní lišta Uložit / Schválit.
 * Uložení → PUT → server vypálí znovu → „hotovo (ručně)" + událost v historii (+n, −m); zásah do chráněného
 * pole bez potvrzení → ke kontrole (schválení = potvrzení).
 */

const SOURCE_LABEL: Record<string, string> = { rule: "automaticky", ai: "AI", cache: "AI (dřív)" };

export interface AnonymizeEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileId: string;
  table?: AnonTableParam;
  /** Původní název (PDF → řádky textové vrstvy). */
  sourceName?: string | null;
  title?: string;
  onSaved?: (status: string) => void;
}

export function AnonymizeEditor({ open, onOpenChange, fileId, table, sourceName, title, onSaved }: AnonymizeEditorProps) {
  const [state, setState] = React.useState<AnonStateDto | null>(null);
  const [items, setItems] = React.useState<EdRegion[]>([]);
  const [initial, setInitial] = React.useState<EdRegion[]>([]);
  const [lines, setLines] = React.useState<EdLine[]>([]);
  const [keep, setKeep] = React.useState<KeepBoxN[]>([]);
  const [history, setHistory] = React.useState<EdRegion[][]>([]);
  const [page, setPage] = React.useState(1);
  const [view, setView] = React.useState<"before" | "after">("before");
  const [mode, setMode] = React.useState<"tap" | "rect">("tap");
  const [zoom, setZoom] = React.useState(1);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [confirm, setConfirm] = React.useState<{ kind: "line"; line: EdLine } | { kind: "rect"; box: NBox } | null>(null);
  /** Uživatel v této relaci potvrdil zásah do chráněného pole → PUT confirmKeep. */
  const [confirmedKeep, setConfirmedKeep] = React.useState(false);
  const [draft, setDraft] = React.useState<NBox | null>(null);
  const [imgOk, setImgOk] = React.useState(true);
  const [aspect, setAspect] = React.useState(1.414);
  const scroller = React.useRef<HTMLDivElement>(null);
  const surface = React.useRef<HTMLDivElement>(null);
  const footer = React.useRef<HTMLElement>(null);
  /** Šířka náhledu při 100 % = celá stránka vidět; výška okna náhledu = zbytek obrazovky nad spodní lištou. */
  const [fitW, setFitW] = React.useState<number | null>(null);
  const [maxH, setMaxH] = React.useState<number | null>(null);
  /** Posun okna po změně přiblížení (bod pod prsty / střed razítka) — v layout efektu po překreslení. */
  const pendingScroll = React.useRef<((el: HTMLDivElement) => void) | null>(null);
  const loaded = state !== null;
  React.useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const top = el.getBoundingClientRect().top;
      const foot = footer.current?.getBoundingClientRect().height ?? 64;
      const minH = window.innerWidth >= 640 ? 260 : 200;
      const avail = Math.max(minH, Math.min(window.innerHeight * (window.innerWidth >= 640 ? 0.66 : 0.7), window.innerHeight - Math.max(0, top) - foot - 12));
      setMaxH(avail);
      setFitW(Math.max(120, Math.min(el.clientWidth, (avail - 2) * aspect)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [aspect, open, loaded]);
  React.useLayoutEffect(() => {
    const el = scroller.current;
    const f = pendingScroll.current;
    if (!el || !f) return;
    pendingScroll.current = null;
    f(el);
  }, [zoom, fitW]);
  const isPdf = /\.pdf$/i.test(sourceName ?? "") || state?.method === "raster_pdf";
  const totalPages = Math.max(1, state?.pages?.total ?? 1);

  const load = React.useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    const r = await anonApi.state(fileId, { table, lines: /\.pdf$/i.test(sourceName ?? ""), page: p });
    setLoading(false);
    if (!r.ok) return setError(r.error);
    setState(r.data);
    const ed = fromServer(r.data.regions ?? []);
    setItems(ed);
    setInitial(ed);
    setHistory([]);
    setLines((r.data.lines ?? []) as EdLine[]);
    setKeep((r.data.keep ?? []) as KeepBoxN[]);
    setImgOk(true);
  }, [fileId, table, sourceName]);

  React.useEffect(() => {
    if (open) void load(page);
  }, [open, page, load]);

  const pageItems = items.filter((r) => r.page === page);
  const diff = diffCounts(items, initial);
  const dirty = diff.added + diff.removed > 0;
  const excludedHere = Boolean(state?.pages?.excluded?.some((e) => e.page === page));

  function apply(next: EdRegion[]) {
    setHistory((h) => [...h.slice(-30), items]);
    setItems(next);
  }
  function undo() {
    setHistory((h) => {
      if (!h.length) return h;
      setItems(h[h.length - 1]);
      return h.slice(0, -1);
    });
  }

  // ── souřadnice ukazatele → normalizované 0..1 na stránce
  const toNorm = (e: { clientX: number; clientY: number }) => {
    const el = surface.current;
    if (!el) return null;
    const b = el.getBoundingClientRect();
    if (!b.width || !b.height) return null;
    return { x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)) };
  };

  const pointers = React.useRef(new Map<number, { x: number; y: number }>());
  const gesture = React.useRef<{
    start: { x: number; y: number } | null; t: number;
    pinch: { d0: number; z0: number; mid: { x: number; y: number }; offset: { x: number; y: number } } | null;
  }>({ start: null, t: 0, pinch: null });

  function onPointerDown(e: React.PointerEvent) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const c = { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 };
      const mid = toNorm(c) ?? { x: 0.5, y: 0.5 };
      const sb = scroller.current?.getBoundingClientRect();
      gesture.current.pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y), z0: zoom, mid, offset: { x: c.clientX - (sb?.left ?? 0), y: c.clientY - (sb?.top ?? 0) } };
      setDraft(null);
      return;
    }
    if (view !== "before") return;
    const p = toNorm(e);
    gesture.current = { start: p, t: Date.now(), pinch: null };
    if (mode === "rect" && p) {
      (e.target as Element).setPointerCapture?.(e.pointerId);
      setDraft({ x: p.x, y: p.y, w: 0, h: 0 });
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (g.pinch && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const z = pinchZoom(g.pinch.z0, g.pinch.d0, Math.hypot(a.x - b.x, a.y - b.y));
      const { mid, offset } = g.pinch;
      // bod pod prsty zůstane pod prsty (posun po překreslení na novou velikost)
      pendingScroll.current = (el) => {
        const s = surface.current;
        if (!s) return;
        const pos = anchorScroll(mid, { w: s.offsetWidth, h: s.offsetHeight }, offset);
        el.scrollLeft = pos.left + s.offsetLeft;
        el.scrollTop = pos.top + s.offsetTop;
      };
      setZoom(z);
      return;
    }
    if (mode === "rect" && g.start && view === "before") {
      const p = toNorm(e);
      if (p) setDraft({ x: Math.min(g.start.x, p.x), y: Math.min(g.start.y, p.y), w: Math.abs(p.x - g.start.x), h: Math.abs(p.y - g.start.y) });
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const had = pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (!had || g.pinch) {
      if (pointers.current.size === 0) gesture.current.pinch = null;
      return;
    }
    if (view !== "before") return;
    const p = toNorm(e);
    if (mode === "rect") {
      setDraft(null);
      if (g.start && p) {
        const box = rectFromDrag(g.start, p);
        if (box) {
          if (touchesKeep(box, keep, lines) && !confirmedKeep) setConfirm({ kind: "rect", box });
          else apply(addRect(items, box, page));
        }
      }
      gesture.current.start = null;
      return;
    }
    // ťuknutí (krátké, bez posunu) → řádek / oblast
    if (!g.start || !p || Date.now() - g.t > 600 || Math.hypot(p.x - g.start.x, p.y - g.start.y) > 0.01) return;
    const line = lineAt(lines, p);
    if (line) {
      if (lineState(line, items, page) !== "on" && needsKeepConfirm(line)) {
        setConfirm({ kind: "line", line });
        return;
      }
      apply(toggleLine(items, line, page, lines));
      return;
    }
    const r = [...pageItems].reverse().find((x) => p.x >= x.x && p.x <= x.x + x.w && p.y >= x.y && p.y <= x.y + x.h);
    if (r) apply(toggleRegion(items, r.id));
  }

  function confirmDelete() {
    if (!confirm) return;
    if (confirm.kind === "line") apply(toggleLine(items, confirm.line, page, lines));
    else apply(addRect(items, confirm.box, page));
    setConfirmedKeep(true);
    setConfirm(null);
  }

  function zoomBy(f: number) {
    const el = scroller.current;
    const s = surface.current;
    if (el && s && s.offsetWidth) {
      // přiblížit kolem středu okna
      const mid = { x: (el.scrollLeft + el.clientWidth / 2 - s.offsetLeft) / s.offsetWidth, y: (el.scrollTop + el.clientHeight / 2 - s.offsetTop) / s.offsetHeight };
      pendingScroll.current = (sc) => {
        const pos = anchorScroll(mid, { w: s.offsetWidth, h: s.offsetHeight }, { x: sc.clientWidth / 2, y: sc.clientHeight / 2 });
        sc.scrollLeft = pos.left + s.offsetLeft;
        sc.scrollTop = pos.top + s.offsetTop;
      };
    }
    setZoom((z) => clampZoom(z * f));
  }
  function zoomStamp() {
    const el = scroller.current;
    const box = state?.titleBlock ?? titleBlockBox([...lines, ...pageItems]);
    const w = fitW ?? el?.clientWidth ?? 360;
    const z = el ? stampZoom(box, w, aspect, el.clientWidth, el.clientHeight) : 2;
    pendingScroll.current = (sc) => {
      const s = surface.current;
      if (!s) return;
      const pos = anchorScroll({ x: box.x + box.w / 2, y: box.y + box.h / 2 }, { w: s.offsetWidth, h: s.offsetHeight }, { x: sc.clientWidth / 2, y: sc.clientHeight / 2 });
      sc.scrollLeft = pos.left + s.offsetLeft;
      sc.scrollTop = pos.top + s.offsetTop;
    };
    if (Math.abs(z - zoom) < 1e-6 && el) {
      // stejné přiblížení → layout efekt se nespustí, posunout hned
      const f = pendingScroll.current;
      pendingScroll.current = null;
      f?.(el);
      return;
    }
    setZoom(z);
  }

  async function save() {
    if (!state) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    const r = await anonApi.save(fileId, { regions: toManualSet(items) as never, expectedAt: state.at, table, confirmKeep: confirmedKeep });
    setSaving(false);
    if (!r.ok) {
      const d = r.data as { reason?: string; status?: string } | undefined;
      if (r.status === 422 && d?.status === "review") {
        // uloženo, ale zasahuje do chráněného údaje → ke kontrole: prohlédni „Po" a schval
        setNotice({ tone: "warn", text: d.reason ?? "Úprava zasahuje do chráněného údaje — zkontroluj náhled „Po“ a schval." });
        onSaved?.("review");
        await load(page);
        setView("after");
        return;
      }
      setError(r.status === 422 ? (d?.reason ?? "Uložení proběhlo, ale výsledek není hotový — zkontroluj.") : r.error);
      if (r.status === 409 || r.status === 422) void load(page);
      return;
    }
    setNotice({ tone: "ok", text: `Uloženo (+${diff.added}, −${diff.removed}) — výkres je anonymizovaný.` });
    onSaved?.(r.data.status);
    await load(page);
    setView("after");
  }

  async function approve() {
    setSaving(true);
    const r = await anonApi.approve(fileId, table);
    setSaving(false);
    if (!r.ok) return setError(r.error);
    setNotice({ tone: "ok", text: "Schváleno — kopie může jít dodavateli." });
    onSaved?.("done");
    await load(page);
  }

  const version = state?.at ?? null;
  const src = previewUrl(fileId, { table, page, variant: view === "after" ? "anon" : "orig", v: version });
  const status = (state?.status ?? null) as AnonUiStatus | null;
  const counts = describeCounts(state?.summary?.counts);
  const settled = status === "done" && Boolean(state?.reviewedAt);
  // důvod stavu se už ukazuje nahoře → stejné varování podruhé nevypisovat
  const warnings = (settled ? [] : state?.summary?.warnings ?? []).filter((w) => w.message !== state?.reason);
  const nothing = (status === "done" || status === "review") && !counts && (state?.summary?.total ?? 0) === 0 && !dirty;
  const reason = displayReason(status, state?.reason);
  const help = view === "after"
    ? "Takhle to dostane dodavatel — opravy dělej v „Před“."
    : mode === "rect"
      ? "Táhni prstem nebo myší přes místo, které se má smazat. Posun a přiblížení: přepni zpět na „Ťukat“."
      : lines.length
        ? "Ťukni na řádek: smazaný ↔ ponechaný. Jedním prstem posuneš, dvěma přiblížíš. Firma, jména, logo a cesty se mažou, technické údaje zůstávají."
        : "Ťukni na barevnou oblast: smazat ↔ nechat. Chybějící místo přidej režimem „Přidat obdélník“.";

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent
        aria-describedby={undefined}
        hideClose
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="top-0 flex h-[100dvh] max-w-none flex-col rounded-none border-0 sm:top-[2%] sm:h-[96vh] sm:w-[calc(100%-2rem)] sm:max-w-6xl sm:rounded-xl sm:border"
        data-testid="anon-editor"
      >
        <header className="flex items-center gap-2 border-b px-3 py-2 sm:px-4 sm:py-2.5">
          <ScanSearch className="hidden h-5 w-5 shrink-0 text-primary sm:block" aria-hidden />
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-sm sm:text-base">{title ?? "Upravit anonymizaci"}</DialogTitle>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <FileAnonBadge status={status} reviewed={Boolean(state?.reviewedAt)} reason={reason} total={state?.summary?.total ?? null} />
              {state?.filename && <span className="truncate font-mono">{state.filename}</span>}
            </div>
          </div>
          <button type="button" onClick={() => onOpenChange(false)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-accent" aria-label="Zavřít">
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* nástroje: na mobilu jedna řada (ikony s popisky pro čtečky), na desktopu s texty */}
        <div className="flex items-center gap-1 overflow-x-auto border-b bg-muted/30 px-2 py-1.5 sm:flex-wrap sm:gap-1.5 sm:px-4 sm:py-2" role="toolbar" aria-label="Nástroje editoru">
          <div className="inline-flex shrink-0 rounded-lg border bg-background p-0.5" role="tablist" aria-label="Zobrazení">
            {(["before", "after"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                disabled={v === "after" && !state?.hasAfter}
                className={cn("min-h-9 rounded-md px-2.5 text-xs font-semibold transition disabled:opacity-40 sm:px-3", view === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
              >
                {v === "before" ? <>Před<span className="hidden sm:inline"> (originál)</span></> : <>Po<span className="hidden sm:inline"> (pro dodavatele)</span></>}
              </button>
            ))}
          </div>
          {view === "before" && (
            <div className="inline-flex shrink-0 rounded-lg border bg-background p-0.5" role="radiogroup" aria-label="Režim">
              <button type="button" role="radio" aria-checked={mode === "tap"} onClick={() => setMode("tap")} aria-label={lines.length ? "Ťukat na řádky" : "Ťukat na oblasti"}
                className={cn("inline-flex min-h-9 items-center gap-1 rounded-md px-2.5 text-xs font-semibold", mode === "tap" ? "bg-sky-600 text-white" : "text-muted-foreground")}>
                <Hand className="h-4 w-4 sm:h-3.5 sm:w-3.5" /> <span className="hidden sm:inline">{lines.length ? "Ťukat na řádky" : "Ťukat na oblasti"}</span>
              </button>
              <button type="button" role="radio" aria-checked={mode === "rect"} onClick={() => setMode("rect")} data-testid="anon-mode-rect" aria-label="Přidat obdélník"
                className={cn("inline-flex min-h-9 items-center gap-1 rounded-md px-2.5 text-xs font-semibold", mode === "rect" ? "bg-amber-500 text-amber-950" : "text-muted-foreground")}>
                <Square className="h-4 w-4 sm:h-3.5 sm:w-3.5" /> <span className="hidden sm:inline">Přidat obdélník</span>
              </button>
            </div>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Button variant="outline" size="icon-sm" onClick={() => zoomBy(1 / 1.4)} aria-label="Oddálit" className="h-9 w-9"><Minus className="h-4 w-4" /></Button>
            <span className="hidden w-11 text-center text-xs tabular-nums text-muted-foreground sm:inline">{Math.round(zoom * 100)} %</span>
            <Button variant="outline" size="icon-sm" onClick={() => zoomBy(1.4)} aria-label="Přiblížit" className="h-9 w-9"><Plus className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" onClick={zoomStamp} className="h-9 px-2.5" aria-label="Přiblížit razítko" data-testid="anon-zoom-stamp">
              <Stamp className="h-4 w-4" /> <span className="hidden sm:inline">Razítko</span>
            </Button>
            {view === "before" && (
              <Button variant="outline" size="icon-sm" onClick={undo} disabled={!history.length} aria-label="Zpět" className="h-9 w-9"><RotateCcw className="h-4 w-4" /></Button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error && <p role="alert" className="mx-3 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
          {notice && (
            <p role="status" className={cn("mx-3 mt-3 rounded-lg border px-3 py-2 text-sm",
              notice.tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
                : "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100")}>
              {notice.text}
            </p>
          )}
          {confirm && (
            <div role="alertdialog" aria-label="Potvrdit smazání chráněného údaje" className="mx-3 mt-3 flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100 sm:flex-row sm:items-center">
              <span className="flex-1">
                {confirm.kind === "line" ? "Tento řádek je chráněný údaj (číslo výkresu, název, materiál, tolerance)" : "Obdélník zasahuje do chráněného údaje (číslo výkresu, název, materiál)"} — dodavatel ho potřebuje. Opravdu smazat?
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" className="min-h-11 sm:min-h-8" onClick={() => setConfirm(null)}>Nechat</Button>
                <Button size="sm" variant="destructive" className="min-h-11 sm:min-h-8" onClick={confirmDelete} data-testid="anon-confirm-keep">Přesto smazat</Button>
              </div>
            </div>
          )}

          <div
            ref={scroller}
            className="relative mx-2 mt-2 overflow-auto overscroll-contain rounded-lg border bg-neutral-200 dark:bg-neutral-800 sm:mx-4 sm:mt-3"
            style={{ touchAction: mode === "rect" && view === "before" ? "none" : "pan-x pan-y", maxHeight: maxH ? `${Math.round(maxH)}px` : "58dvh" }}
          >
            <div
              ref={surface}
              className="relative mx-auto select-none"
              style={{ width: fitW ? `${Math.round(fitW * zoom)}px` : `${zoom * 100}%` }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={(e) => { pointers.current.delete(e.pointerId); if (!pointers.current.size) gesture.current.pinch = null; setDraft(null); }}
              data-testid="anon-surface"
            >
              {view === "after" && excludedHere ? (
                <div className="flex aspect-[1.41] items-center justify-center bg-white p-6 text-center text-sm text-muted-foreground">Strana vyřazena — není to výkres, dodavatel ji nedostane.</div>
              ) : imgOk ? (
                <img
                  key={src}
                  src={src}
                  alt={view === "before" ? "Originál výkresu" : "Anonymizovaný výkres"}
                  draggable={false}
                  onLoad={(e) => { const t = e.currentTarget; if (t.naturalWidth) setAspect(t.naturalWidth / t.naturalHeight); }}
                  onError={() => setImgOk(false)}
                  className="block h-auto w-full bg-white"
                />
              ) : (
                <div className="flex aspect-[1.41] items-center justify-center p-6 text-center text-sm text-muted-foreground">Náhled se nepodařilo načíst.</div>
              )}
              {view === "before" && (
                <div className="pointer-events-none absolute inset-0" aria-hidden>
                  {lines.map((l) => {
                    const st = lineState(l, items, page);
                    return (
                      <div
                        key={l.id}
                        className={cn("absolute rounded-[2px] border", st === "on" ? "border-transparent" : l.keep ? "border-emerald-500/60 bg-emerald-400/10" : "border-sky-500/50 bg-sky-400/10")}
                        style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%`, width: `${l.w * 100}%`, height: `${l.h * 100}%` }}
                      />
                    );
                  })}
                  {pageItems.map((r) => (
                    <div
                      key={r.id}
                      data-region-state={r.state}
                      className={cn("absolute rounded-[2px] border-2", r.state === "on" ? "" : "border-dashed opacity-70")}
                      style={{
                        left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`,
                        borderColor: ANON_CATEGORY_COLOR[r.category] ?? "#f59e0b",
                        background: r.state === "on" ? `${ANON_CATEGORY_COLOR[r.category] ?? "#f59e0b"}55` : "transparent",
                      }}
                    />
                  ))}
                  {draft && (
                    <div className="absolute border-2 border-amber-500 bg-amber-400/30" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.w * 100}%`, height: `${draft.h * 100}%` }} />
                  )}
                </div>
              )}
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/40"><Loader2 className="h-6 w-6 animate-spin" /></div>
              )}
            </div>
          </div>

          {isPdf && totalPages > 1 && (
            <div className="mt-2 flex items-center justify-center gap-2 text-sm">
              <Button variant="outline" size="icon-sm" className="h-10 w-10" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || dirty} aria-label="Předchozí strana"><ChevronLeft className="h-4 w-4" /></Button>
              <span className="tabular-nums">Strana {page} / {totalPages}{excludedHere ? " · vyřazena" : ""}</span>
              <Button variant="outline" size="icon-sm" className="h-10 w-10" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || dirty} aria-label="Další strana"><ChevronRight className="h-4 w-4" /></Button>
            </div>
          )}

          <section className="space-y-2 px-3 py-3 sm:px-4" aria-label="Smazané oblasti">
            <p className="text-xs text-muted-foreground">{help}</p>
            {nothing && (
              <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 dark:bg-amber-500/10 dark:text-amber-100" data-testid="anon-nothing-removed">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {NOTHING_REMOVED} Kdyby tam byl, označ ho ťuknutím nebo obdélníkem.
              </p>
            )}
            {counts && <p className="text-sm"><strong>Smaže se:</strong> {counts}</p>}
            {status === "review" && reason && <p className="text-xs text-amber-800 dark:text-amber-300">{reason}</p>}
            {warnings.length > 0 && (
              <ul className="space-y-1 text-xs text-amber-800 dark:text-amber-300">
                {warnings.slice(0, 6).map((w, i) => <li key={`${w.code}-${i}`}>• {w.message}</li>)}
              </ul>
            )}
            <ul className="divide-y rounded-lg border">
              {pageItems.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">Na této straně nic smazáno není.</li>}
              {pageItems.map((r, i) => {
                const manual = r.added || r.source === "manual";
                const label = manual ? "Ručně označeno" : (ANON_CATEGORY_LABELS[r.category] ?? ["oblast"])[0];
                const text = r.text ? uniqueText(r.text.split(/\s+·\s+/)) : "";
                return (
                  <li key={r.id} className="flex items-center gap-2 px-3 py-2">
                    <span aria-hidden className="h-3 w-3 shrink-0 rounded-sm" style={{ background: ANON_CATEGORY_COLOR[r.category] ?? "#f59e0b" }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium first-letter:uppercase">{label}{!manual && <span className="text-xs font-normal text-muted-foreground"> · {SOURCE_LABEL[r.source] ?? r.source}</span>}</p>
                      {text && <p className="truncate text-xs text-muted-foreground" title={text}>{text}</p>}
                    </div>
                    <Switch
                      checked={r.state === "on"}
                      onCheckedChange={() => apply(toggleRegion(items, r.id))}
                      aria-label={`${r.state === "on" ? "Smazat" : "Nechat"}: ${label} ${i + 1}`}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <footer ref={footer} className="sticky bottom-0 grid grid-cols-2 gap-2 border-t bg-background/95 px-3 py-2 backdrop-blur sm:flex sm:items-center sm:justify-end sm:px-4 sm:py-2.5">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving} className="hidden min-h-9 sm:inline-flex">Zavřít</Button>
          {status === "review" && !dirty ? (
            <Button variant="success" onClick={() => void approve()} disabled={saving} className="min-h-11 sm:min-h-9" data-testid="anon-approve">
              <CheckCircle2 className="h-4 w-4" /> {nothing ? "Schválit bez změn" : "Schválit"}
            </Button>
          ) : <span className="sm:hidden" />}
          <Button onClick={() => void save()} disabled={saving || !dirty || !state} className="min-h-11 sm:min-h-9" data-testid="anon-save">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Uložit{dirty ? ` (+${diff.added}, −${diff.removed})` : ""}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
