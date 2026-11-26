"use client";

/**
 * Plátno 2D výkresu: dvě vrstvy canvasu (entity + mřížka; překryv s kurzorem, uchopením, gumovou čarou, oknem výběru),
 * kolečko = zoom ke kurzoru, prostřední tlačítko / dva prsty = posun, poklepání prostředním = rozsah,
 * levé = bod / výběr: klik = jedna entita, tažení (i ze stisku na entitě) = okno (zleva doprava) / křížení (zprava doleva),
 * klik do prázdna = okno dvěma kliky; bez modifikátoru nahradí (ve výzvě „Vyberte objekty“ přidá), Ctrl / Shift přidá
 * (klik přepne), Ctrl+Shift / Alt odebere; Esc zruší jen okno (pravidla: cad/box-select-2d.ts). Dotyk: jeden prst = posun,
 * dlouhý stisk a tažení = okno. Pravé tlačítko = kontextová nabídka.
 */
import { tr } from "@/cad/i18n";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { Prompt } from "@/cad/draft/commands";
import { dist, sub, unit, type Box } from "@/cad/draft/geom";
import type { SnapKind } from "@/cad/draft/kinds";
import { layerVisible } from "@/cad/draft/layers";
import { entityById, type DraftEntity, type DraftModel, type Vec2 } from "@/cad/draft/model";
import { drawEntities, drawGrid, drawHighlight, drawPreview, drawSnapMarker, drawUcs, fitView, installTextMeasure, toScreen, toWorld, viewBox, type View } from "@/cad/draft/render";
import { pickEntity, windowSelect } from "@/cad/draft/select";
import { findSnap, orthoPoint, polarPoint, type SnapHit } from "@/cad/draft/snap";
import { spatialIndex } from "@/cad/draft/spatial";
import { extents } from "@/cad/draft/status";
import { perfMark } from "@/cad/perf-log";
import { boxMode, CLICK_PX, clickMode, HOLD_MS, HOLD_SLOP_PX, holdPhase, isCrossing, isDoubleClick, isDrag, rectFrom, type BoxMods, type ClickMode } from "@/cad/box-select-2d";
import { boxLabel, drawBoxSelect } from "../box-select-2d-ui";

export type DraftPrefs = {
  dark: boolean;
  grid: boolean;
  gridSnap: boolean;
  ortho: boolean;
  polar: boolean;
  polarInc: number;
  osnap: boolean;
  osmodes: SnapKind[];
};

export type DraftCanvasHandle = {
  zoomExtents: () => void;
  zoomWindow: (b: Box) => void;
  setView: (v: Partial<Pick<View, "cx" | "cy" | "scale">>) => void;
  getView: () => View | null;
  redraw: () => void;
  /** poslední (uchopený) bod kurzoru a směr k němu od základního bodu výzvy – přímé zadání vzdálenosti */
  cursor: () => { p: Vec2 | null; dir: Vec2 | null };
  /** volba Okno / Křížení (o / k) ve výzvě výběru: další dva kliky (nebo tažení) zadají rohy; null = zrušit */
  windowMode: (kind: "window" | "crossing" | null) => void;
};

type Props = {
  model: DraftModel;
  list: readonly DraftEntity[];
  sel: readonly string[];
  prompt: Prompt | null;
  prefs: DraftPrefs;
  onPoint: (p: Vec2) => void;
  onEntity: (id: string, p: Vec2) => void;
  onSelect: (ids: string[], mode: ClickMode) => void;
  onCursor: (p: Vec2 | null) => void;
  onContext: (x: number, y: number) => void;
  onDblClick: (id: string | null) => void;
  underlay?: (ctx: CanvasRenderingContext2D, v: View) => void;
  overlay?: (ctx: CanvasRenderingContext2D, v: View) => void;
  /** rozšíření (úchopy…): true = událost obsloužena, jádro ji přeskočí */
  onPointerHook?: (ev: { kind: "down" | "move" | "up"; world: Vec2; snapped: Vec2; screen: Vec2; button: number; shift: boolean; ctrl: boolean; alt?: boolean }) => boolean;
};

const SNAP_LABEL: Record<SnapKind, string> = {
  end: tr("Koncový bod"),
  mid: tr("Polovina"),
  cen: tr("Střed"),
  qua: tr("Kvadrant"),
  int: tr("Průsečík"),
  per: tr("Kolmo"),
  tan: tr("Tečně"),
  nea: tr("Nejbližší"),
  nod: tr("Uzel"),
  ins: tr("Bod vložení"),
  ext: tr("Prodloužení"),
  app: tr("Zdánlivý průsečík"),
};
export { SNAP_LABEL };

const PICK = 5; // px – výběrový čtvereček
const CLICK_PX_CTX = CLICK_PX; // px – pravý klik bez tažení = kontextová nabídka
const APERTURE = 10; // px – okruh uchopení

export const DraftCanvas = forwardRef<DraftCanvasHandle, Props>(function DraftCanvas(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const over = useRef<HTMLCanvasElement>(null);
  const view = useRef<View | null>(null);
  const pr = useRef(props);
  pr.current = props;
  const st = useRef({
    cursor: null as Vec2 | null, // obrazovka (CSS px)
    world: null as Vec2 | null, // výsledný bod (uchopený / ortho)
    snap: null as SnapHit | null,
    hover: null as string | null,
    /** okno výběru: rohy (px), tažené / dvěma kliky, modifikátory (stisk, puštění, poslední pohyb), vynucené o / k, dotykem */
    win: null as { a: Vec2; b: Vec2; drag: boolean; mods: BoxMods[]; cur?: BoxMods; force?: "window" | "crossing"; touch?: boolean; t?: number } | null,
    /** stisk levého tlačítka ve výběru: klik (entita pod kurzorem), nebo po posunu ≥ 5 px okno */
    press: null as { a: Vec2; hit: string | null; mods: BoxMods } | null,
    /** čeká se na první roh okna zadaného volbou o / k */
    force: null as "window" | "crossing" | null,
    /** po Esc během okna: puštění tlačítka už nic nevybere */
    swallowUp: false,
    hold: 0,
    /** živý počet entit v okně (klíč = rohy, čas posledního výpočtu) */
    live: null as { key: string; ids: string[]; at: number; ms: number } | null,
    /** konec okna – doba do vykreslení výběru (data-boxsel) */
    boxT0: 0,
    pan: null as { x: number; y: number; cx: number; cy: number } | null,
    touches: new Map<number, Vec2>(),
    pinch: null as { d: number; scale: number; mid: Vec2; world: Vec2 } | null,
    downAt: null as { x: number; y: number; button: number; t: number } | null,
    raf: 0,
    rafOver: 0,
    lastMid: 0,
  });

  useEffect(() => installTextMeasure(), []);

  const idx = useCallback(() => spatialIndex(pr.current.list, { model: pr.current.model }), []);

  /** výzva „Vyberte objekty“: klik i okno bez modifikátoru výběr doplňují (jako v AutoCADu), jinak ho nahrazují */
  const accumulate = useCallback(() => pr.current.prompt?.k === "select", []);
  /** id entit, které okno vybere (viditelné; ve výzvě výběru jen ty, které příkaz přijme) */
  const winIds = useCallback(
    (w: { a: Vec2; b: Vec2; force?: "window" | "crossing" }): string[] => {
      const v = view.current;
      const p = pr.current;
      if (!v) return [];
      const crossing = w.force ? w.force === "crossing" : isCrossing(w.a, w.b);
      const r = rectFrom(toWorld(v, w.a), toWorld(v, w.b));
      const ids = windowSelect(p.model, idx(), r, crossing);
      const filt = p.prompt?.k === "select" ? p.prompt.filter : undefined;
      if (!filt) return ids;
      return ids.filter((id) => {
        const e = entityById(p.list as DraftEntity[], id);
        return !!e && filt(e);
      });
    },
    [idx],
  );

  // ---------------------------------------------------------------- vykreslení
  const drawBase = useCallback(() => {
    const c = base.current;
    const v = view.current;
    if (!c || !v) return;
    const g = c.getContext("2d");
    if (!g) return;
    const p = pr.current;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = p.prefs.dark ? "#212830" : "#ffffff";
    g.fillRect(0, 0, c.width, c.height);
    p.underlay?.(g, v);
    if (p.prefs.grid) drawGrid(g, v, p.model.vars.grid, p.prefs.dark);
    const r = drawEntities(g, p.model, p.list, idx(), v, { dark: p.prefs.dark, lwdisplay: p.model.vars.lwdisplay });
    if (p.sel.length) {
      const ents = p.sel.map((id) => entityById(p.list as DraftEntity[], id)).filter((e): e is DraftEntity => !!e && layerVisible(p.model, e.layer));
      drawHighlight(g, p.model, ents, v, { color: p.prefs.dark ? "#5aa9ff" : "#1d6fe0", width: 2, dash: [6, 3], grips: true });
    }
    drawUcs(g, v);
    if (r.drawn > 2000 || r.ms > 30) perfMark("draft.render", r.ms, { drawn: r.drawn, total: p.list.length });
    // pohled pro automatizaci (převod souřadnic výkresu na obrazovku): x = (X − cx)·scale + w/2, y = h/2 − (Y − cy)·scale
    host.current?.setAttribute("data-view", JSON.stringify({ cx: v.cx, cy: v.cy, scale: v.scale, w: v.w, h: v.h, ms: Math.round(r.ms * 10) / 10, drawn: r.drawn }));
    lastRender.current = { ms: r.ms, drawn: r.drawn };
    const bs = st.current;
    if (bs.boxT0) {
      // výběr oknem: doba od puštění tlačítka po vykreslení zvýrazněného výběru (automatizace: data-boxsel)
      const prev = JSON.parse(host.current?.getAttribute("data-boxsel") || "{}");
      host.current?.setAttribute("data-boxsel", JSON.stringify({ ...prev, total: Math.round((performance.now() - bs.boxT0) * 10) / 10 }));
      bs.boxT0 = 0;
    }
  }, [idx]);
  const lastRender = useRef({ ms: 0, drawn: 0 });

  const drawOver = useCallback(() => {
    const c = over.current;
    const v = view.current;
    if (!c || !v) return;
    const g = c.getContext("2d");
    if (!g) return;
    const p = pr.current;
    const s = st.current;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    p.overlay?.(g, v);
    if (s.hover && !s.win) {
      const e = entityById(p.list as DraftEntity[], s.hover);
      if (e) drawHighlight(g, p.model, [e], v, { color: p.prefs.dark ? "#9fd0ff" : "#4f8fe8", width: 3 });
    }
    const pt = s.world;
    if (pt && p.prompt && "preview" in p.prompt && p.prompt.preview) {
      try {
        drawPreview(g, p.model, p.prompt.preview(pt), v, p.prefs.dark);
      } catch {
        /* neplatný náhled (nulová délka…) */
      }
    }
    if (s.win) {
      const w = s.win;
      const crossing = w.force ? w.force === "crossing" : isCrossing(w.a, w.b);
      // živý náhled: entity, které okno právě vybere (u velkých výkresů se přepočítává nejvýš ~7× za s)
      const key = `${w.a.join(",")}|${w.b.join(",")}|${crossing}`;
      const now = performance.now();
      if (!s.live || (s.live.key !== key && (s.live.ms < 25 || now - s.live.at > 150))) {
        const t0 = performance.now();
        const ids = winIds(w);
        s.live = { key, ids, at: now, ms: performance.now() - t0 };
      }
      if (s.live.ids.length && s.live.ids.length <= 3000) {
        const ents = s.live.ids.map((id) => entityById(p.list as DraftEntity[], id)).filter((e): e is DraftEntity => !!e);
        drawHighlight(g, p.model, ents, v, { color: crossing ? "#22c55e" : "#3b82f6", width: 2 });
      }
      const mode = boxMode([...w.mods, ...(w.cur ? [w.cur] : [])], accumulate());
      drawBoxSelect(g, w.a, w.b, crossing, v.dpr, boxLabel(s.live.ids.length, crossing, mode === "replace" ? undefined : accumulate() && mode === "add" ? undefined : mode));
      host.current?.setAttribute("data-boxsel-live", String(s.live.ids.length));
    } else if (s.force && s.cursor) {
      // volba o / k: kurzor ukazuje, že se čeká na první roh
      g.save();
      g.font = `${11 * v.dpr}px sans-serif`;
      const label = s.force === "crossing" ? tr("Křížení: první roh") : tr("Okno: první roh");
      const tw = g.measureText(label).width;
      g.fillStyle = "rgba(17,24,39,0.86)";
      g.fillRect((s.cursor[0] + 14) * v.dpr, (s.cursor[1] + 18) * v.dpr, tw + 10 * v.dpr, 17 * v.dpr);
      g.fillStyle = "#ffffff";
      g.fillText(label, (s.cursor[0] + 19) * v.dpr, (s.cursor[1] + 30) * v.dpr);
      g.restore();
    }
    // kurzor: kříž + výběrový čtvereček
    if (s.cursor) {
      const scr = pt ? toScreen(v, pt) : s.cursor;
      const [x, y] = [scr[0] * v.dpr, scr[1] * v.dpr];
      const L = 28 * v.dpr;
      g.save();
      g.strokeStyle = p.prefs.dark ? "#ffffff" : "#111827";
      g.lineWidth = v.dpr;
      g.beginPath();
      const wantPoint = p.prompt && (p.prompt.k === "point" || p.prompt.k === "dist" || p.prompt.k === "angle");
      g.moveTo(x - L, y);
      g.lineTo(x + L, y);
      g.moveTo(x, y - L);
      g.lineTo(x, y + L);
      if (!wantPoint) g.rect(x - PICK * v.dpr, y - PICK * v.dpr, 2 * PICK * v.dpr, 2 * PICK * v.dpr);
      g.stroke();
      g.restore();
      if (s.snap) {
        drawSnapMarker(g, v, s.snap.p, s.snap.kind);
        g.save();
        g.font = `${11 * v.dpr}px sans-serif`;
        const label = SNAP_LABEL[s.snap.kind];
        const tw = g.measureText(label).width;
        g.fillStyle = "rgba(17,24,39,0.85)";
        g.fillRect(x + 12 * v.dpr, y + 10 * v.dpr, tw + 8 * v.dpr, 16 * v.dpr);
        g.fillStyle = "#fde68a";
        g.fillText(label, x + 16 * v.dpr, y + 22 * v.dpr);
        g.restore();
      }
      // dynamické zadání: vzdálenost a úhel od základního bodu
      if (pt && p.prompt && "base" in p.prompt && p.prompt.base) {
        const bp = p.prompt.base;
        const d = dist(bp, pt);
        const a = ((Math.atan2(pt[1] - bp[1], pt[0] - bp[0]) * 180) / Math.PI + 360) % 360;
        const txt = `${d.toFixed(Math.min(4, p.model.vars.prec))} < ${a.toFixed(Math.max(0, p.model.vars.aprec))}°`;
        g.save();
        g.font = `${11 * v.dpr}px sans-serif`;
        const tw = g.measureText(txt).width;
        g.fillStyle = p.prefs.dark ? "rgba(255,255,255,0.9)" : "rgba(17,24,39,0.85)";
        g.fillRect(x + 12 * v.dpr, y - 28 * v.dpr, tw + 8 * v.dpr, 16 * v.dpr);
        g.fillStyle = p.prefs.dark ? "#111827" : "#ffffff";
        g.fillText(txt, x + 16 * v.dpr, y - 16 * v.dpr);
        g.restore();
      }
    }
  }, [accumulate, winIds]);

  const schedule = useCallback(
    (which: "base" | "over" | "both") => {
      const s = st.current;
      if (which !== "over" && !s.raf)
        s.raf = requestAnimationFrame(() => {
          s.raf = 0;
          drawBase();
        });
      if (!s.rafOver)
        s.rafOver = requestAnimationFrame(() => {
          s.rafOver = 0;
          drawOver();
        });
    },
    [drawBase, drawOver],
  );

  // velikost plátna
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const resize = () => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, r.width);
      const h = Math.max(1, r.height);
      for (const c of [base.current, over.current]) {
        if (!c) continue;
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
        c.style.width = `${w}px`;
        c.style.height = `${h}px`;
      }
      if (!view.current) {
        const ex = extents(pr.current.model, pr.current.list);
        view.current = ex ? fitView(ex, w, h, dpr) : { cx: 150, cy: 100, scale: Math.min(w / 340, h / 230), w, h, dpr };
      } else view.current = { ...view.current, w, h, dpr };
      drawBase();
      drawOver();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [drawBase, drawOver]);

  // změna modelu / výběru / nastavení → překreslit
  useEffect(() => schedule("both"), [props.model, props.list, props.sel, props.prefs, props.prompt, schedule]);

  const zoomExtents = useCallback(() => {
    const v = view.current;
    if (!v) return;
    const ex = extents(pr.current.model, pr.current.list);
    view.current = ex ? fitView(ex, v.w, v.h, v.dpr) : { ...v, cx: 150, cy: 100, scale: Math.min(v.w / 340, v.h / 230) };
    schedule("both");
  }, [schedule]);

  useImperativeHandle(
    ref,
    () => ({
      zoomExtents,
      zoomWindow: (b) => {
        const v = view.current;
        if (!v) return;
        view.current = fitView(b, v.w, v.h, v.dpr, 0.02);
        schedule("both");
      },
      setView: (nv) => {
        if (!view.current) return;
        view.current = { ...view.current, ...nv };
        schedule("both");
      },
      getView: () => view.current,
      redraw: () => schedule("both"),
      cursor: () => {
        const s = st.current;
        const b = pr.current.prompt && "base" in pr.current.prompt ? pr.current.prompt.base : null;
        return { p: s.world, dir: s.world && b && dist(s.world, b) > 1e-12 ? unit(sub(s.world, b)) : null };
      },
      windowMode: (kind) => {
        const s = st.current;
        s.force = kind;
        s.win = null;
        s.press = null;
        s.live = null;
        schedule("over");
      },
    }),
    [zoomExtents, schedule],
  );

  // ---------------------------------------------------------------- vstup
  /** výsledný bod pro polohu kurzoru: uchopení → krok mřížky → ortho / polární */
  const resolvePoint = (scr: Vec2): { p: Vec2; snap: SnapHit | null } => {
    const v = view.current!;
    const p = pr.current;
    const raw = toWorld(v, scr);
    const b = p.prompt && "base" in p.prompt ? (p.prompt.base ?? null) : null;
    const wantPoint = p.prompt && (p.prompt.k === "point" || p.prompt.k === "dist" || p.prompt.k === "angle");
    if (wantPoint && p.prefs.osnap) {
      const hit = findSnap(p.model, idx(), raw, APERTURE / v.scale, new Set(p.prefs.osmodes), b);
      if (hit) return { p: hit.p, snap: hit };
    }
    let q = raw;
    if (wantPoint && p.prefs.gridSnap) {
      const sp = p.model.vars.snap > 0 ? p.model.vars.snap : 10;
      q = [Math.round(q[0] / sp) * sp, Math.round(q[1] / sp) * sp];
    }
    if (wantPoint && b) {
      if (p.prefs.ortho) q = orthoPoint(b, q);
      else if (p.prefs.polar) q = polarPoint(b, q, p.prefs.polarInc)?.p ?? q;
    }
    return { p: q, snap: null };
  };

  const local = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = host.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const updateHover = (scr: Vec2) => {
    const p = pr.current;
    const v = view.current!;
    const s = st.current;
    const wantsPick = !p.prompt || p.prompt.k === "select" || p.prompt.k === "entity";
    if (!wantsPick || p.list.length > 200000) {
      s.hover = null;
      return;
    }
    const filt = p.prompt?.k === "entity" || p.prompt?.k === "select" ? p.prompt.filter : undefined;
    s.hover = pickEntity(p.model, idx(), toWorld(v, scr), PICK / v.scale, filt)?.id ?? null;
  };

  const modsOf = (e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): BoxMods => ({ ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey });

  /** dokončí okno: výběr podle směru (nebo volby o / k) a modifikátorů */
  const finishWindow = () => {
    const s = st.current;
    const p = pr.current;
    const w = s.win;
    if (!w) return;
    const t0 = performance.now();
    const ids = winIds(w);
    const mode = boxMode([...w.mods, ...(w.cur ? [w.cur] : [])], accumulate());
    s.win = null;
    s.live = null;
    p.onSelect(ids, mode);
    s.boxT0 = t0;
    host.current?.setAttribute("data-boxsel", JSON.stringify({ n: ids.length, mode, crossing: w.force ? w.force === "crossing" : isCrossing(w.a, w.b), ms: Math.round((performance.now() - t0) * 10) / 10 }));
    host.current?.removeAttribute("data-boxsel-live");
    schedule("both");
  };
  const cancelWindow = (): boolean => {
    const s = st.current;
    // stisk ve výběru, který se ještě nepohnul o 5 px (z něj by bylo okno): Esc zruší i ten – výběr zůstane
    const pending = !!s.press && !!s.downAt;
    if (!s.win && !s.force && !pending) return false;
    const pressed = !!s.downAt;
    s.win = null;
    s.force = null;
    s.live = null;
    s.press = null;
    s.swallowUp = pressed;
    host.current?.removeAttribute("data-boxsel-live");
    schedule("over");
    return true;
  };
  const cancelWindowRef = useRef(cancelWindow);
  cancelWindowRef.current = cancelWindow;

  const onPointerDown = (e: React.PointerEvent) => {
    const s = st.current;
    const scr = local(e);
    s.swallowUp = false;
    if (e.pointerType === "touch") {
      s.touches.set(e.pointerId, scr);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      if (s.touches.size === 2) {
        const [a, b] = [...s.touches.values()];
        const v = view.current!;
        const m: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        s.pinch = { d: dist(a, b), scale: v.scale, mid: m, world: toWorld(v, m) };
        s.downAt = null;
        s.win = null;
        s.press = null;
        clearTimeout(s.hold);
        return;
      }
    }
    s.downAt = { x: scr[0], y: scr[1], button: e.button, t: Date.now() };
    if (e.button === 1) {
      e.preventDefault();
      const v = view.current!;
      s.pan = { x: scr[0], y: scr[1], cx: v.cx, cy: v.cy };
      if (Date.now() - s.lastMid < 350) {
        zoomExtents();
        s.pan = null;
      }
      s.lastMid = Date.now();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    // poklepání do prázdna není druhý roh okna zadaného dvěma kliky: okno otevřené prvním klikem se zruší a stisk
    // dostane rozšíření (poklepání do výřezu rozvržení = modelový prostor); jinak se stisk spolkne (žádné nové okno)
    const win0 = s.win;
    if (e.pointerType !== "touch" && win0 && !win0.drag && !win0.force && win0.t !== undefined && isDoubleClick(win0.a, win0.t, scr, Date.now())) {
      s.win = null;
      s.live = null;
      s.press = null;
      host.current?.removeAttribute("data-boxsel-live");
      schedule("over");
      if (!pr.current.prompt && hook("down", scr, e)) hooked.current = true;
      return;
    }
    if (e.pointerType !== "touch" && !pr.current.prompt && !s.win && !s.force && hook("down", scr, e)) {
      hooked.current = true;
      return;
    }
    if (e.pointerType === "touch") {
      // jeden prst: posun, klepnutí = klik (vyhodnotí se při puštění), dlouhý stisk na místě a tažení = okno výběru
      const v = view.current!;
      s.pan = { x: scr[0], y: scr[1], cx: v.cx, cy: v.cy };
      clearTimeout(s.hold);
      const down = scr;
      const t = performance.now();
      s.hold = window.setTimeout(() => {
        const c = st.current;
        const p = pr.current;
        const last = c.touches.get(e.pointerId);
        if (!c.downAt || c.pinch || c.touches.size !== 1 || !c.pan || !last) return;
        if (holdPhase(down, t, last, performance.now()) !== "hold") return;
        if (p.prompt && p.prompt.k !== "select") return;
        // posun pohledu se zruší (prst stál), od místa stisku se táhne okno
        view.current = { ...view.current!, cx: c.pan.cx, cy: c.pan.cy };
        c.pan = null;
        c.win = { a: down, b: last, drag: true, mods: [{}], touch: true };
        c.hover = null;
        if (typeof navigator !== "undefined") navigator.vibrate?.(15);
        schedule("both");
      }, HOLD_MS);
      return;
    }
    press(scr, modsOf(e));
  };

  /** rozšíření mimo příkaz (úchopy): „down“ obsloužené rozšířením → i „move“ a „up“ jdou jen jemu */
  const hooked = useRef(false);
  const hook = (kind: "down" | "move" | "up", scr: Vec2, e: React.PointerEvent): boolean => {
    const h = pr.current.onPointerHook;
    const v = view.current;
    if (!h || !v) return false;
    const world = toWorld(v, scr);
    const snapped = resolvePoint(scr).p;
    return h({ kind, world, snapped, screen: scr, button: e.button, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey });
  };

  /**
   * Stisk levého tlačítka (myš ihned, dotyk při klepnutí): bod / entita podle výzvy; ve výběru se rozhodne až při
   * puštění (klik) nebo po posunu ≥ 5 px (okno – i když stisk padl na entitu).
   */
  const press = (scr: Vec2, mods: BoxMods) => {
    const s = st.current;
    const p = pr.current;
    const v = view.current!;
    const pmt = p.prompt;
    if (pmt && (pmt.k === "point" || pmt.k === "dist" || pmt.k === "angle")) {
      const r = resolvePoint(scr);
      p.onPoint(r.p);
      return;
    }
    if (pmt?.k === "entity") {
      const w = toWorld(v, scr);
      const hit = pickEntity(p.model, idx(), w, PICK / v.scale, pmt.filter);
      if (hit) p.onEntity(hit.id, w);
      return;
    }
    // výběr (bez příkazu nebo výzva výběru)
    if (s.win && !s.win.drag) {
      // druhý roh okna zadaného dvěma kliky
      s.win.b = scr;
      s.win.mods.push(mods);
      finishWindow();
      return;
    }
    if (s.force) {
      // volba o / k: první roh (další klik nebo puštění po tažení zadá druhý)
      s.win = { a: scr, b: scr, drag: false, mods: [mods], force: s.force };
      s.force = null;
      s.press = null;
      schedule("over");
      return;
    }
    const filt = pmt?.k === "select" ? pmt.filter : undefined;
    s.press = { a: scr, hit: pickEntity(p.model, idx(), toWorld(v, scr), PICK / v.scale, filt)?.id ?? null, mods };
  };

  /** puštění bez tažení: klik na entitu vybere ji (podle modifikátorů), klik do prázdna začne okno dvěma kliky */
  const release = (scr: Vec2, mods: BoxMods) => {
    const s = st.current;
    const pr0 = s.press;
    s.press = null;
    if (!pr0) return;
    if (pr0.hit) {
      pr.current.onSelect([pr0.hit], clickMode([pr0.mods, mods], accumulate()));
      schedule("over");
      return;
    }
    s.win = { a: pr0.a, b: scr, drag: false, mods: [pr0.mods], t: Date.now() };
    schedule("over");
  };

  /** klepnutí prstem: jako klik s větším okruhem výběru */
  const tap = (scr: Vec2) => {
    const p = pr.current;
    const v = view.current!;
    const pmt = p.prompt;
    if (pmt && pmt.k !== "select") return press(scr, {});
    const s = st.current;
    if (s.win && !s.win.drag) return press(scr, {});
    if (s.force) return press(scr, {});
    const filt = pmt?.k === "select" ? pmt.filter : undefined;
    const hit = pickEntity(p.model, idx(), toWorld(v, scr), (3 * PICK) / v.scale, filt);
    s.press = { a: scr, hit: hit?.id ?? null, mods: {} };
    release(scr, {});
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = st.current;
    const scr = local(e);
    const v = view.current;
    if (!v) return;
    if (e.pointerType === "touch" && s.touches.has(e.pointerId)) {
      s.touches.set(e.pointerId, scr);
      if (s.pinch && s.touches.size >= 2) {
        const [a, b] = [...s.touches.values()];
        const d = dist(a, b);
        const m: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const scale = Math.max(1e-9, Math.min(1e8, (s.pinch.scale * d) / Math.max(1, s.pinch.d)));
        // bod pod středem prstů zůstane na místě
        view.current = { ...v, scale, cx: s.pinch.world[0] - (m[0] - v.w / 2) / scale, cy: s.pinch.world[1] + (m[1] - v.h / 2) / scale };
        schedule("both");
        return;
      }
    }
    if (s.pan) {
      const dx = scr[0] - s.pan.x;
      const dy = scr[1] - s.pan.y;
      if (s.downAt && e.pointerType === "touch" && Math.hypot(dx, dy) < HOLD_SLOP_PX) return;
      if (e.pointerType === "touch") clearTimeout(s.hold);
      view.current = { ...v, cx: s.pan.cx - dx / v.scale, cy: s.pan.cy + dy / v.scale };
      schedule("both");
      return;
    }
    s.cursor = scr;
    const r = resolvePoint(scr);
    s.world = r.p;
    s.snap = r.snap;
    if (e.pointerType !== "touch" && (hooked.current || (!pr.current.prompt && !s.win && !s.press && !s.force)) && hook("move", scr, e) && hooked.current) {
      pr.current.onCursor(r.p);
      schedule("over");
      return;
    }
    // tažení ze stisku (i na entitě) o ≥ 5 px = okno výběru
    if (s.press && s.downAt && isDrag(s.press.a, scr)) {
      s.win = { a: s.press.a, b: scr, drag: true, mods: [s.press.mods] };
      s.press = null;
      s.hover = null;
    }
    if (s.win) {
      s.win.b = scr;
      s.win.cur = modsOf(e);
      if (s.downAt && isDrag([s.downAt.x, s.downAt.y], scr)) s.win.drag = true;
    } else updateHover(scr);
    pr.current.onCursor(r.p);
    schedule("over");
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const s = st.current;
    const scr = local(e);
    if (e.pointerType === "touch") {
      clearTimeout(s.hold);
      s.touches.delete(e.pointerId);
      if (s.pinch) {
        if (s.touches.size < 2) s.pinch = null;
        s.pan = null;
        return;
      }
      const d = s.downAt;
      s.downAt = null;
      if (s.win?.touch) {
        // okno dlouhým stiskem: zvednutí prstu ho dokončí (bez posunu se zruší)
        if (isDrag(s.win.a, scr)) {
          s.win.b = scr;
          finishWindow();
        } else {
          s.win = null;
          s.live = null;
          schedule("over");
        }
        s.pan = null;
        return;
      }
      const moved = d ? Math.hypot(scr[0] - d.x, scr[1] - d.y) : 99;
      s.pan = null;
      if (d && moved < HOLD_SLOP_PX && Date.now() - d.t < HOLD_MS + 100) {
        s.cursor = scr;
        tap(scr);
      }
      return;
    }
    if (s.pan) {
      s.pan = null;
      return;
    }
    if (hooked.current) {
      hooked.current = false;
      s.downAt = null;
      hook("up", scr, e);
      schedule("both");
      return;
    }
    const d = s.downAt;
    s.downAt = null;
    if (e.button === 2 && d && Math.hypot(scr[0] - d.x, scr[1] - d.y) < CLICK_PX_CTX) {
      pr.current.onContext(e.clientX, e.clientY);
      return;
    }
    if (s.swallowUp) {
      // Esc během okna: tlačítko se pouští bez výběru
      s.swallowUp = false;
      s.press = null;
      return;
    }
    if (s.press) return release(scr, modsOf(e));
    if (s.win?.drag && d && isDrag([d.x, d.y], scr)) {
      s.win.b = scr;
      s.win.mods.push(modsOf(e));
      finishWindow();
    } else if (s.win) s.win.drag = false; // klik do prázdna → okno se dokončí druhým klikem
  };

  const onWheel = (e: React.WheelEvent) => {
    const v = view.current;
    if (!v) return;
    const scr = local(e);
    const w = toWorld(v, scr);
    const k = Math.exp(-Math.max(-300, Math.min(300, e.deltaY * (e.deltaMode === 1 ? 33 : 1))) * 0.0015);
    const scale = Math.max(1e-9, Math.min(1e8, v.scale * k));
    view.current = { ...v, scale, cx: w[0] - (scr[0] - v.w / 2) / scale, cy: w[1] + (scr[1] - v.h / 2) / scale };
    schedule("both");
  };

  const onLeave = () => {
    const s = st.current;
    s.cursor = null;
    s.world = null;
    s.snap = null;
    s.hover = null;
    pr.current.onCursor(null);
    schedule("over");
  };

  // kolečko bez posouvání stránky (pasivní posluchač React nestačí)
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const stop = (e: WheelEvent) => e.preventDefault();
    el.addEventListener("wheel", stop, { passive: false });
    return () => el.removeEventListener("wheel", stop);
  }, []);

  /**
   * Esc: zruší jen rozpracované okno výběru (nebo čekání na roh po volbě o / k) – výběr i běžící příkaz zůstanou.
   * Posluchač se registruje před pracovní plochou (efekt potomka běží dřív) a událost dál nepustí.
   */
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && cancelWindowRef.current()) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, []);

  // nová výzva, která nechce výběr (bod, entita, text): rozpracované okno a volba o / k se zahodí
  useEffect(() => {
    const s = st.current;
    if (props.prompt && props.prompt.k === "select") return;
    if (s.force || (s.win && !s.win.drag)) {
      s.force = null;
      s.win = null;
      s.live = null;
    }
    if (!props.prompt) s.force = null;
  }, [props.prompt]);

  return (
    <div
      ref={host}
      data-draft-canvas
      className="absolute inset-0 cursor-none touch-none select-none overflow-hidden"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onLeave}
      onWheel={onWheel}
      onContextMenu={(e) => e.preventDefault()}
      onDoubleClick={(e) => {
        const v = view.current;
        if (!v) return;
        const hit = pickEntity(pr.current.model, idx(), toWorld(v, local(e)), PICK / v.scale);
        pr.current.onDblClick(hit?.id ?? null);
      }}
    >
      <canvas ref={base} className="absolute inset-0" />
      <canvas ref={over} className="absolute inset-0" data-draft-overlay />
    </div>
  );
});

export { viewBox };
