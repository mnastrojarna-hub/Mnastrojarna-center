"use client";

/**
 * Plátno 2D výkresu: dvě vrstvy canvasu (entity + mřížka; překryv s kurzorem, uchopením, gumovou čarou, oknem výběru),
 * kolečko = zoom ke kurzoru, prostřední tlačítko / dva prsty = posun, poklepání prostředním = rozsah,
 * levé = bod / výběr (zleva doprava okno, zprava doleva křížení, Shift = odebrat), pravé = kontextová nabídka.
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
};

type Props = {
  model: DraftModel;
  list: readonly DraftEntity[];
  sel: readonly string[];
  prompt: Prompt | null;
  prefs: DraftPrefs;
  onPoint: (p: Vec2) => void;
  onEntity: (id: string, p: Vec2) => void;
  onSelect: (ids: string[], mode: "add" | "remove") => void;
  onCursor: (p: Vec2 | null) => void;
  onContext: (x: number, y: number) => void;
  onDblClick: (id: string | null) => void;
  underlay?: (ctx: CanvasRenderingContext2D, v: View) => void;
  overlay?: (ctx: CanvasRenderingContext2D, v: View) => void;
  /** rozšíření (úchopy…): true = událost obsloužena, jádro ji přeskočí */
  onPointerHook?: (ev: { kind: "down" | "move" | "up"; world: Vec2; snapped: Vec2; screen: Vec2; button: number; shift: boolean; ctrl: boolean }) => boolean;
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
    win: null as { a: Vec2; b: Vec2; drag: boolean } | null,
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
      const [a, b] = [s.win.a, s.win.b];
      const crossing = b[0] < a[0];
      g.save();
      g.fillStyle = crossing ? "rgba(34,197,94,0.12)" : "rgba(59,130,246,0.12)";
      g.strokeStyle = crossing ? "#22c55e" : "#3b82f6";
      g.lineWidth = v.dpr;
      g.setLineDash(crossing ? [6 * v.dpr, 4 * v.dpr] : []);
      const x = Math.min(a[0], b[0]) * v.dpr;
      const y = Math.min(a[1], b[1]) * v.dpr;
      g.fillRect(x, y, Math.abs(b[0] - a[0]) * v.dpr, Math.abs(b[1] - a[1]) * v.dpr);
      g.strokeRect(x, y, Math.abs(b[0] - a[0]) * v.dpr, Math.abs(b[1] - a[1]) * v.dpr);
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
  }, []);

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

  const finishWindow = () => {
    const s = st.current;
    const v = view.current!;
    const p = pr.current;
    if (!s.win) return;
    const a = toWorld(v, s.win.a);
    const b = toWorld(v, s.win.b);
    const crossing = s.win.b[0] < s.win.a[0];
    const box: Box = { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) };
    let ids = windowSelect(p.model, idx(), box, crossing);
    if (p.prompt?.k === "select" && p.prompt.filter) ids = ids.filter((id) => { const e = entityById(p.list as DraftEntity[], id); return !!e && p.prompt!.k === "select" && (p.prompt as Extract<Prompt, { k: "select" }>).filter!(e); });
    s.win = null;
    p.onSelect(ids, winRemove.current ? "remove" : "add");
    schedule("both");
  };
  const winRemove = useRef(false);

  const onPointerDown = (e: React.PointerEvent) => {
    const s = st.current;
    const scr = local(e);
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
    if (e.pointerType !== "touch" && !pr.current.prompt && hook("down", scr, e)) {
      hooked.current = true;
      return;
    }
    if (e.pointerType === "touch") {
      // jeden prst: posun, klepnutí = klik (vyhodnotí se při puštění)
      const v = view.current!;
      s.pan = { x: scr[0], y: scr[1], cx: v.cx, cy: v.cy };
      return;
    }
    click(scr, e.shiftKey, false);
  };

  /** rozšíření mimo příkaz (úchopy): „down“ obsloužené rozšířením → i „move“ a „up“ jdou jen jemu */
  const hooked = useRef(false);
  const hook = (kind: "down" | "move" | "up", scr: Vec2, e: React.PointerEvent): boolean => {
    const h = pr.current.onPointerHook;
    const v = view.current;
    if (!h || !v) return false;
    const world = toWorld(v, scr);
    const snapped = resolvePoint(scr).p;
    return h({ kind, world, snapped, screen: scr, button: e.button, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
  };

  /** klik (myš ihned, dotyk po klepnutí) */
  const click = (scr: Vec2, shift: boolean, tap: boolean) => {
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
      s.win.b = scr;
      finishWindow();
      return;
    }
    const w = toWorld(v, scr);
    const filt = pmt?.k === "select" ? pmt.filter : undefined;
    const hit = pickEntity(p.model, idx(), w, (tap ? 3 * PICK : PICK) / v.scale, filt);
    if (hit) {
      p.onSelect([hit.id], shift ? "remove" : "add");
      return;
    }
    winRemove.current = shift;
    s.win = { a: scr, b: scr, drag: !tap };
    schedule("over");
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
      if (s.downAt && e.pointerType === "touch" && Math.hypot(dx, dy) < 6) return;
      view.current = { ...v, cx: s.pan.cx - dx / v.scale, cy: s.pan.cy + dy / v.scale };
      schedule("both");
      return;
    }
    s.cursor = scr;
    const r = resolvePoint(scr);
    s.world = r.p;
    s.snap = r.snap;
    if (e.pointerType !== "touch" && (hooked.current || !pr.current.prompt) && hook("move", scr, e) && hooked.current) {
      pr.current.onCursor(r.p);
      schedule("over");
      return;
    }
    if (s.win) {
      s.win.b = scr;
      if (s.downAt && Math.hypot(scr[0] - s.downAt.x, scr[1] - s.downAt.y) > 4) s.win.drag = true;
    } else updateHover(scr);
    pr.current.onCursor(r.p);
    schedule("over");
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const s = st.current;
    const scr = local(e);
    if (e.pointerType === "touch") {
      s.touches.delete(e.pointerId);
      if (s.pinch) {
        if (s.touches.size < 2) s.pinch = null;
        s.pan = null;
        return;
      }
      const d = s.downAt;
      const moved = d ? Math.hypot(scr[0] - d.x, scr[1] - d.y) : 99;
      s.pan = null;
      if (d && moved < 8 && Date.now() - d.t < 600) {
        s.cursor = scr;
        click(scr, false, true);
      }
      s.downAt = null;
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
    if (e.button === 2 && d && Math.hypot(scr[0] - d.x, scr[1] - d.y) < 5) {
      pr.current.onContext(e.clientX, e.clientY);
      return;
    }
    if (s.win?.drag && d && Math.hypot(scr[0] - d.x, scr[1] - d.y) > 4) {
      s.win.b = scr;
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

  /** Esc: zrušit rozpracované okno výběru */
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && st.current.win) {
        st.current.win = null;
        schedule("over");
      }
    };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, [schedule]);

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
