"use client";

import * as React from "react";
import { Minus, Plus, Scan } from "lucide-react";

/** Obrázek s přiblížením (kolečko, dva prsty, dvojklik) a posunem tažením. */
export function ImageView({ src, alt }: { src: string; alt: string }) {
  const [t, setT] = React.useState({ s: 1, x: 0, y: 0 });
  const boxRef = React.useRef<HTMLDivElement>(null);
  const ptrs = React.useRef(new Map<number, { x: number; y: number }>());
  const last = React.useRef<{ d: number; mx: number; my: number } | null>(null);

  const zoomAt = React.useCallback((f: number, cx: number, cy: number) => {
    setT((cur) => {
      const s = Math.min(12, Math.max(1, cur.s * f));
      const k = s / cur.s;
      if (s === 1) return { s: 1, x: 0, y: 0 };
      return { s, x: cx - (cx - cur.x) * k, y: cy - (cy - cur.y) * k };
    });
  }, []);

  React.useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const local = (e: React.PointerEvent) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-neutral-900">
      <div
        ref={boxRef}
        className="flex h-full w-full items-center justify-center"
        style={{ touchAction: "none", cursor: t.s > 1 ? "grab" : "zoom-in" }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          ptrs.current.set(e.pointerId, local(e));
          last.current = null;
        }}
        onPointerMove={(e) => {
          const prev = ptrs.current.get(e.pointerId);
          if (!prev) return;
          const p = local(e);
          ptrs.current.set(e.pointerId, p);
          if (ptrs.current.size === 2) {
            const [a, b] = [...ptrs.current.values()];
            const now = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
            if (last.current && last.current.d > 0) {
              zoomAt(now.d / last.current.d, now.mx, now.my);
              const dx = now.mx - last.current.mx;
              const dy = now.my - last.current.my;
              setT((c) => (c.s > 1 ? { ...c, x: c.x + dx, y: c.y + dy } : c));
            }
            last.current = now;
          } else if (ptrs.current.size === 1) {
            setT((c) => (c.s > 1 ? { ...c, x: c.x + p.x - prev.x, y: c.y + p.y - prev.y } : c));
          }
        }}
        onPointerUp={(e) => {
          ptrs.current.delete(e.pointerId);
          last.current = null;
        }}
        onPointerCancel={(e) => ptrs.current.delete(e.pointerId)}
        onDoubleClick={(e) => {
          const r = boxRef.current!.getBoundingClientRect();
          if (t.s > 1) setT({ s: 1, x: 0, y: 0 });
          else zoomAt(2.5, e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2);
        }}
        data-testid="image-view"
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="max-h-full max-w-full select-none object-contain"
          style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})`, transformOrigin: "center", transition: ptrs.current.size ? "none" : "transform 80ms" }}
        />
      </div>
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-black/60 px-1.5 py-1 text-white shadow-lg backdrop-blur">
        <button type="button" onClick={() => zoomAt(1 / 1.5, 0, 0)} className="rounded-full p-2 hover:bg-white/10" aria-label="Oddálit"><Minus className="h-4 w-4" /></button>
        <span className="w-11 text-center text-xs tabular-nums">{Math.round(t.s * 100)} %</span>
        <button type="button" onClick={() => zoomAt(1.5, 0, 0)} className="rounded-full p-2 hover:bg-white/10" aria-label="Přiblížit"><Plus className="h-4 w-4" /></button>
        <button type="button" onClick={() => setT({ s: 1, x: 0, y: 0 })} className="rounded-full p-2 hover:bg-white/10" aria-label="Celý obrázek"><Scan className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
