"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { circleFrom3, entityPath, findLoops, loopPolygon, snapPoints } from "@/cad/sketch";
import { uid, type SketchEntity, type Vec2 } from "@/cad/types";

export type SketchTool = "select" | "line" | "rect" | "circle" | "arc" | "polygon" | "slot";

type Props = {
  entities: SketchEntity[];
  onChange: (next: SketchEntity[], commit?: boolean) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  tool: SketchTool;
  setTool: (t: SketchTool) => void;
  snapGrid: boolean;
};

type Handle = { key: string; p: Vec2 };

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString("cs-CZ");

function niceStep(x: number) {
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const n = x / p;
  return (n < 2 ? 1 : n < 5 ? 2 : 5) * p;
}

function handlesOf(e: SketchEntity): Handle[] {
  switch (e.type) {
    case "line":
      return [{ key: "a", p: e.a }, { key: "b", p: e.b }];
    case "arc":
      return [{ key: "a", p: e.a }, { key: "b", p: e.b }, { key: "c", p: e.c }];
    case "polyline":
      return e.points.map((p, i) => ({ key: `p${i}`, p }));
    case "circle":
      return [{ key: "c", p: [e.cx, e.cy] }, { key: "r", p: [e.cx + e.r, e.cy] }];
    case "rect":
      return [{ key: "c", p: [e.cx, e.cy] }, { key: "corner", p: [e.cx + e.w / 2, e.cy + e.h / 2] }];
    case "polygon":
      return [{ key: "c", p: [e.cx, e.cy] }, { key: "r", p: [e.cx, e.cy + e.r] }];
    case "slot":
      return [{ key: "c", p: [e.cx, e.cy] }];
  }
}

function applyHandle(e: SketchEntity, key: string, p: Vec2): SketchEntity {
  switch (e.type) {
    case "line":
    case "arc":
      return { ...e, [key]: p } as SketchEntity;
    case "polyline": {
      const i = Number(key.slice(1));
      return { ...e, points: e.points.map((q, k) => (k === i ? p : q)) };
    }
    case "circle":
      return key === "c" ? { ...e, cx: p[0], cy: p[1] } : { ...e, r: Math.max(0.01, dist([e.cx, e.cy], p)) };
    case "rect":
      return key === "c" ? { ...e, cx: p[0], cy: p[1] } : { ...e, w: Math.max(0.01, Math.abs(p[0] - e.cx) * 2), h: Math.max(0.01, Math.abs(p[1] - e.cy) * 2) };
    case "polygon":
      return key === "c" ? { ...e, cx: p[0], cy: p[1] } : { ...e, r: Math.max(0.01, dist([e.cx, e.cy], p)) };
    case "slot":
      return { ...e, cx: p[0], cy: p[1] };
  }
}

function moveEntity(e: SketchEntity, d: Vec2): SketchEntity {
  const m = (p: Vec2): Vec2 => [p[0] + d[0], p[1] + d[1]];
  switch (e.type) {
    case "line":
      return { ...e, a: m(e.a), b: m(e.b) };
    case "arc":
      return { ...e, a: m(e.a), b: m(e.b), c: m(e.c) };
    case "polyline":
      return { ...e, points: e.points.map(m) };
    default:
      return { ...e, cx: (e as { cx: number }).cx + d[0], cy: (e as { cy: number }).cy + d[1] } as SketchEntity;
  }
}

function distToPath(pt: Vec2, pts: Vec2[], closed: boolean) {
  let best = Infinity;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / l2));
    best = Math.min(best, Math.hypot(pt[0] - (a[0] + t * dx), pt[1] - (a[1] + t * dy)));
  }
  return best;
}

/**
 * 2D skicář: souřadnice v mm, osa Y nahoru. Kolečko = zoom ke kurzoru, prostřední/pravé tlačítko = posun.
 */
export function Sketcher({ entities, onChange, selected, onSelect, tool, setTool, snapGrid }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState({ cx: 0, cy: 0, scale: 4 }); // px na mm
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [snapHit, setSnapHit] = useState<Vec2 | null>(null);
  const [pts, setPts] = useState<Vec2[]>([]); // rozpracované body nástroje
  const drag = useRef<{ kind: "pan"; from: Vec2; view: typeof view } | { kind: "handle"; id: string; key: string } | { kind: "move"; id: string; from: Vec2; orig: SketchEntity } | null>(null);
  const fitted = useRef(false);

  // velikost
  useEffect(() => {
    const el = svgRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // úvodní zaměření na obsah
  useEffect(() => {
    if (fitted.current || !size.w) return;
    fitted.current = true;
    const all = entities.flatMap((e) => entityPath(e).pts);
    if (!all.length) return setView({ cx: 0, cy: 0, scale: Math.min(size.w, size.h) / 160 });
    const xs = all.map((p) => p[0]);
    const ys = all.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs) || 50;
    const h = Math.max(...ys) - Math.min(...ys) || 50;
    setView({ cx: (Math.max(...xs) + Math.min(...xs)) / 2, cy: (Math.max(...ys) + Math.min(...ys)) / 2, scale: Math.min(size.w / (w * 1.6), size.h / (h * 1.6)) });
  }, [size, entities]);

  useEffect(() => setPts([]), [tool]);

  const toMm = useCallback(
    (clientX: number, clientY: number): Vec2 => {
      const r = svgRef.current!.getBoundingClientRect();
      return [view.cx + (clientX - r.left - size.w / 2) / view.scale, view.cy - (clientY - r.top - size.h / 2) / view.scale];
    },
    [view, size],
  );
  const toPx = (p: Vec2): Vec2 => [size.w / 2 + (p[0] - view.cx) * view.scale, size.h / 2 - (p[1] - view.cy) * view.scale];

  const gridStep = niceStep(24 / view.scale);
  const allSnaps = useMemo(() => [[0, 0] as Vec2, ...entities.flatMap(snapPoints)], [entities]);

  const snap = (p: Vec2, exclude?: string): Vec2 => {
    const tolMm = 9 / view.scale;
    let best: Vec2 | null = null;
    let bd = tolMm;
    const cands = exclude ? [[0, 0] as Vec2, ...entities.filter((e) => e.id !== exclude).flatMap(snapPoints)] : allSnaps;
    for (const s of cands) {
      const d = dist(s, p);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    setSnapHit(best);
    if (best) return [...best] as Vec2;
    // vodorovné/svislé zarovnání k poslednímu bodu
    const last = pts[pts.length - 1];
    let q: Vec2 = snapGrid ? [Math.round(p[0] / gridStep) * gridStep, Math.round(p[1] / gridStep) * gridStep] : p;
    if (last) {
      if (Math.abs(p[1] - last[1]) * view.scale < 6) q = [q[0], last[1]];
      if (Math.abs(p[0] - last[0]) * view.scale < 6) q = [last[0], q[1]];
    }
    return [Math.round(q[0] * 1e4) / 1e4, Math.round(q[1] * 1e4) / 1e4];
  };

  const hitEntity = (p: Vec2) => {
    const tol = 7 / view.scale;
    let best: string | null = null;
    let bd = tol;
    for (const e of entities) {
      const { pts: path, closed } = entityPath(e);
      const d = distToPath(p, path, closed);
      if (d < bd) {
        bd = d;
        best = e.id;
      }
    }
    return best;
  };

  const add = (e: SketchEntity) => {
    onChange([...entities, e], true);
    onSelect(e.id);
  };

  const onPointerDown = (ev: React.PointerEvent) => {
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
    const raw = toMm(ev.clientX, ev.clientY);
    if (ev.button === 1 || ev.button === 2) {
      drag.current = { kind: "pan", from: [ev.clientX, ev.clientY], view };
      return;
    }
    if (tool === "select") {
      // úchyt vybrané entity?
      const sel = entities.find((e) => e.id === selected);
      if (sel) {
        const h = handlesOf(sel).find((h) => dist(h.p, raw) * view.scale < 8);
        if (h) {
          drag.current = { kind: "handle", id: sel.id, key: h.key };
          return;
        }
      }
      const id = hitEntity(raw);
      onSelect(id);
      if (id) drag.current = { kind: "move", id, from: raw, orig: entities.find((e) => e.id === id)! };
      else drag.current = { kind: "pan", from: [ev.clientX, ev.clientY], view };
      return;
    }
    const p = snap(raw);
    const next = [...pts, p];
    switch (tool) {
      case "line": {
        if (pts.length === 0) return setPts([p]);
        const a = pts[pts.length - 1];
        if (dist(a, p) < 1e-6) return;
        onChange([...entities, { id: uid(), type: "line", a, b: p }], true);
        // uzavření na počáteční bod ukončí řetěz
        if (dist(p, pts[0]) < 1e-6) return setPts([]);
        return setPts([...pts, p]);
      }
      case "rect":
        if (next.length < 2) return setPts(next);
        if (Math.abs(next[0][0] - p[0]) < 1e-6 || Math.abs(next[0][1] - p[1]) < 1e-6) return;
        add({ id: uid(), type: "rect", cx: (next[0][0] + p[0]) / 2, cy: (next[0][1] + p[1]) / 2, w: Math.abs(p[0] - next[0][0]), h: Math.abs(p[1] - next[0][1]), r: 0, angle: 0 });
        return setPts([]);
      case "circle":
        if (next.length < 2) return setPts(next);
        if (dist(next[0], p) < 1e-6) return;
        add({ id: uid(), type: "circle", cx: next[0][0], cy: next[0][1], r: Math.round(dist(next[0], p) * 1e4) / 1e4 });
        return setPts([]);
      case "polygon":
        if (next.length < 2) return setPts(next);
        add({
          id: uid(),
          type: "polygon",
          cx: next[0][0],
          cy: next[0][1],
          r: dist(next[0], p),
          sides: 6,
          angle: (Math.atan2(p[1] - next[0][1], p[0] - next[0][0]) * 180) / Math.PI - 90,
        });
        return setPts([]);
      case "arc":
        if (next.length < 3) return setPts(next);
        if (!circleFrom3(next[0], p, next[1])) return;
        add({ id: uid(), type: "arc", a: next[0], b: p, c: next[1] });
        return setPts([]);
      case "slot": {
        if (next.length < 3) return setPts(next);
        const [a, b] = next;
        const len = dist(a, b);
        const dx = (b[0] - a[0]) / (len || 1);
        const dy = (b[1] - a[1]) / (len || 1);
        const w = Math.abs((p[0] - a[0]) * -dy + (p[1] - a[1]) * dx) * 2 || 10;
        add({ id: uid(), type: "slot", cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, length: len + w, width: w, angle: (Math.atan2(dy, dx) * 180) / Math.PI });
        return setPts([]);
      }
    }
  };

  const onPointerMove = (ev: React.PointerEvent) => {
    const raw = toMm(ev.clientX, ev.clientY);
    const d = drag.current;
    if (d?.kind === "pan") {
      setView({ ...d.view, cx: d.view.cx - (ev.clientX - d.from[0]) / view.scale, cy: d.view.cy + (ev.clientY - d.from[1]) / view.scale });
      return;
    }
    if (d?.kind === "handle") {
      const p = snap(raw, d.id);
      setCursor(p);
      onChange(entities.map((e) => (e.id === d.id ? applyHandle(e, d.key, p) : e)), false);
      return;
    }
    if (d?.kind === "move") {
      let delta: Vec2 = [raw[0] - d.from[0], raw[1] - d.from[1]];
      if (snapGrid) delta = [Math.round(delta[0] / gridStep) * gridStep, Math.round(delta[1] / gridStep) * gridStep];
      onChange(entities.map((e) => (e.id === d.id ? moveEntity(d.orig, delta) : e)), false);
      return;
    }
    setCursor(tool === "select" ? raw : snap(raw));
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && d.kind !== "pan") onChange(entities, true);
  };

  const onWheel = (ev: React.WheelEvent) => {
    const before = toMm(ev.clientX, ev.clientY);
    const k = Math.exp(-ev.deltaY * 0.0015);
    const scale = Math.min(400, Math.max(0.02, view.scale * k));
    const r = svgRef.current!.getBoundingClientRect();
    setView({
      scale,
      cx: before[0] - (ev.clientX - r.left - size.w / 2) / scale,
      cy: before[1] + (ev.clientY - r.top - size.h / 2) / scale,
    });
  };

  // klávesy
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input,textarea,select")) return;
      if (e.key === "Escape") {
        if (pts.length) setPts([]);
        else if (tool !== "select") setTool("select");
        else onSelect(null);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        onChange(entities.filter((x) => x.id !== selected), true);
        onSelect(null);
      }
      const map: Record<string, SketchTool> = { l: "line", r: "rect", c: "circle", a: "arc", p: "polygon", s: "slot", v: "select" };
      if (!e.ctrlKey && !e.metaKey && map[e.key.toLowerCase()]) setTool(map[e.key.toLowerCase()]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pts, tool, selected, entities, onChange, onSelect, setTool]);

  // ---------- vykreslení ----------
  const { loops, openCount } = useMemo(() => findLoops(entities), [entities]);
  const fillPath = loops.map((l) => "M" + loopPolygon(l).map((p) => toPx(p).map((v) => v.toFixed(1)).join(",")).join("L") + "Z").join(" ");

  const gridLines: React.ReactNode[] = [];
  const x0 = view.cx - size.w / 2 / view.scale;
  const x1 = view.cx + size.w / 2 / view.scale;
  const y0 = view.cy - size.h / 2 / view.scale;
  const y1 = view.cy + size.h / 2 / view.scale;
  for (let x = Math.ceil(x0 / gridStep) * gridStep; x <= x1; x += gridStep) {
    const major = Math.abs(Math.round(x / gridStep) % 5) === 0;
    const px = toPx([x, 0])[0];
    gridLines.push(<line key={"x" + x} x1={px} x2={px} y1={0} y2={size.h} stroke={major ? "#e2dfdc" : "#f1efed"} strokeWidth={1} />);
  }
  for (let y = Math.ceil(y0 / gridStep) * gridStep; y <= y1; y += gridStep) {
    const major = Math.abs(Math.round(y / gridStep) % 5) === 0;
    const py = toPx([0, y])[1];
    gridLines.push(<line key={"y" + y} y1={py} y2={py} x1={0} x2={size.w} stroke={major ? "#e2dfdc" : "#f1efed"} strokeWidth={1} />);
  }
  const o = toPx([0, 0]);

  const preview = (() => {
    if (!cursor || !pts.length) return null;
    const c = cursor;
    const P = (p: Vec2) => toPx(p).join(",");
    const label = (p: Vec2, s: string) => {
      const [x, y] = toPx(p);
      return (
        <g>
          <rect x={x + 10} y={y - 24} width={s.length * 7 + 12} height={20} rx={10} fill="#272425" />
          <text x={x + 16} y={y - 10} fill="#fff" fontSize={11} fontFamily="ui-monospace,monospace">
            {s}
          </text>
        </g>
      );
    };
    switch (tool) {
      case "line":
        return (
          <g>
            <polyline points={[pts[pts.length - 1], c].map(P).join(" ")} fill="none" stroke="#E03930" strokeWidth={1.5} strokeDasharray="5 4" />
            {label(c, `${fmt(dist(pts[pts.length - 1], c))} mm · ${fmt(((Math.atan2(c[1] - pts[pts.length - 1][1], c[0] - pts[pts.length - 1][0]) * 180) / Math.PI + 360) % 360)}°`)}
          </g>
        );
      case "rect": {
        const a = pts[0];
        return (
          <g>
            <polygon points={[a, [c[0], a[1]] as Vec2, c, [a[0], c[1]] as Vec2].map(P).join(" ")} fill="rgba(224,57,48,.06)" stroke="#E03930" strokeWidth={1.5} strokeDasharray="5 4" />
            {label(c, `${fmt(Math.abs(c[0] - a[0]))} × ${fmt(Math.abs(c[1] - a[1]))}`)}
          </g>
        );
      }
      case "circle":
      case "polygon": {
        const r = dist(pts[0], c);
        const [cx, cy] = toPx(pts[0]);
        return (
          <g>
            <circle cx={cx} cy={cy} r={r * view.scale} fill="rgba(224,57,48,.06)" stroke="#E03930" strokeWidth={1.5} strokeDasharray="5 4" />
            <line x1={cx} y1={cy} x2={toPx(c)[0]} y2={toPx(c)[1]} stroke="#E03930" strokeDasharray="2 3" />
            {label(c, tool === "circle" ? `Ø ${fmt(r * 2)}` : `R ${fmt(r)}`)}
          </g>
        );
      }
      case "arc": {
        if (pts.length === 1) return <polyline points={[pts[0], c].map(P).join(" ")} stroke="#E03930" strokeDasharray="5 4" fill="none" />;
        const path = entityPath({ id: "_", type: "arc", a: pts[0], b: c, c: pts[1] }).pts;
        const cc = circleFrom3(pts[0], c, pts[1]);
        return (
          <g>
            <polyline points={path.map(P).join(" ")} fill="none" stroke="#E03930" strokeWidth={1.5} strokeDasharray="5 4" />
            {cc && label(c, `R ${fmt(cc.r)}`)}
          </g>
        );
      }
      case "slot":
        return <polyline points={[...pts, c].map(P).join(" ")} fill="none" stroke="#E03930" strokeWidth={1.5} strokeDasharray="5 4" />;
    }
    return null;
  })();

  const sel = entities.find((e) => e.id === selected);

  return (
    <div className="absolute inset-0 select-none">
      <svg
        ref={svgRef}
        className="h-full w-full"
        style={{ cursor: tool === "select" ? "default" : "crosshair", background: "#fff" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setCursor(null)}
        onWheel={onWheel}
        onContextMenu={(e) => {
          e.preventDefault();
          setPts([]);
        }}
        onDoubleClick={() => setPts([])}
      >
        {gridLines}
        <line x1={o[0]} x2={o[0] + 60} y1={o[1]} y2={o[1]} stroke="#E03930" strokeWidth={1.5} />
        <line x1={o[0]} x2={o[0]} y1={o[1]} y2={o[1] - 60} stroke="#2f9e44" strokeWidth={1.5} />
        <circle cx={o[0]} cy={o[1]} r={3} fill="#272425" />
        <path d={fillPath} fill="rgba(224,57,48,.08)" fillRule="evenodd" />
        {entities.map((e) => {
          const { pts: path, closed } = entityPath(e);
          const P = path.map((p) => toPx(p).map((v) => v.toFixed(1)).join(",")).join(" ");
          const isSel = e.id === selected;
          const construction = e.type === "line" && e.construction;
          const props = {
            fill: "none",
            stroke: isSel ? "#E03930" : construction ? "#9a9b9d" : "#272425",
            strokeWidth: isSel ? 2.4 : 1.6,
            strokeDasharray: construction ? "6 4" : undefined,
            strokeLinejoin: "round" as const,
          };
          return closed ? <polygon key={e.id} points={P} {...props} /> : <polyline key={e.id} points={P} {...props} />;
        })}
        {/* koncové body */}
        {entities.flatMap((e) =>
          e.type === "line" || e.type === "arc"
            ? [e.a, e.type === "line" ? e.b : e.c].map((p, i) => {
                const [x, y] = toPx(p);
                return <circle key={e.id + i} cx={x} cy={y} r={2.5} fill="#fff" stroke="#272425" strokeWidth={1.2} />;
              })
            : [],
        )}
        {sel &&
          handlesOf(sel).map((h) => {
            const [x, y] = toPx(h.p);
            return <rect key={h.key} x={x - 5} y={y - 5} width={10} height={10} rx={2} fill="#fff" stroke="#E03930" strokeWidth={1.6} />;
          })}
        {pts.map((p, i) => {
          const [x, y] = toPx(p);
          return <circle key={i} cx={x} cy={y} r={3.5} fill="#E03930" />;
        })}
        {preview}
        {snapHit && cursor && tool !== "select" && (
          <rect x={toPx(snapHit)[0] - 6} y={toPx(snapHit)[1] - 6} width={12} height={12} fill="none" stroke="#1c7ed6" strokeWidth={1.6} />
        )}
      </svg>
      <div className="pointer-events-none absolute bottom-3 left-3 flex gap-2 font-mono text-[11px] text-ink-700/70">
        <span className="rounded-full border border-ink-700/10 bg-white/90 px-3 py-1 backdrop-blur">
          X {cursor ? fmt(cursor[0]) : "—"} · Y {cursor ? fmt(cursor[1]) : "—"} mm
        </span>
        <span className="rounded-full border border-ink-700/10 bg-white/90 px-3 py-1 backdrop-blur">mřížka {fmt(gridStep)} mm</span>
        <span className="rounded-full border border-ink-700/10 bg-white/90 px-3 py-1 backdrop-blur">
          {loops.length} uzavř. profil{loops.length === 1 ? "" : loops.length < 5 && loops.length > 1 ? "y" : "ů"}
          {openCount ? ` · ${openCount} otevřených` : ""}
        </span>
      </div>
    </div>
  );
}
