"use client";

import { useRef, useState } from "react";
import type { Dict } from "@/content/cs";
import { HeroCanvas } from "./hero-canvas";

const POS = [
  { x1: 58, y1: 30, x2: 70, y2: 13 },
  { x1: 37, y1: 62, x2: 17, y2: 80 },
  { x1: 40, y1: 38, x2: 15, y2: 26 },
];

/**
 * Hero jako technický výkresový list: 3D díl, odkazové kóty, rohové razítko a CAD kurzor se souřadnicemi.
 */
export function HeroSheet({ t, slogan }: { t: Dict["heroSheet"]; slogan: string }) {
  const CALLOUTS = POS.map((p, i) => ({ ...p, ...t.callouts[i] }));
  const ref = useRef<HTMLDivElement>(null);
  const [cur, setCur] = useState<{ x: number; y: number; mx: number; my: number } | null>(null);

  return (
    <div
      ref={ref}
      className="relative aspect-[4/3.4] w-full overflow-hidden rounded-[28px] border border-ink-700/10 bg-white shadow-[0_60px_120px_-60px_rgba(39,36,37,.45)] md:aspect-[4/3.6]"
      onPointerMove={(e) => {
        const r = ref.current!.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        setCur({ x, y, mx: ((x / r.width) * 297).valueOf(), my: (((r.height - y) / r.height) * 210).valueOf() });
      }}
      onPointerLeave={() => setCur(null)}
    >
      <div className="bg-grid-light absolute inset-0" />
      {/* okraje listu se souřadnicovými poli */}
      <div className="pointer-events-none absolute inset-3 rounded-[20px] border border-ink-700/15" />
      <div className="pointer-events-none absolute inset-x-3 top-3 flex justify-around font-mono text-[9px] text-ink-700/30">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <span key={n}>{n}</span>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-3 left-3 flex flex-col justify-around pl-1 font-mono text-[9px] text-ink-700/30">
        {["A", "B", "C", "D"].map((n) => (
          <span key={n}>{n}</span>
        ))}
      </div>

      <HeroCanvas className="absolute inset-0" />

      {/* odkazové kóty */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {CALLOUTS.map((c, i) => (
          <g key={i} className="callout" style={{ ["--i" as string]: i }}>
            <line x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} stroke="#E03930" strokeWidth="0.25" vectorEffect="non-scaling-stroke" pathLength={1} className="callout-line" />
            <circle cx={c.x1} cy={c.y1} r="0.7" fill="#E03930" className="callout-dot" />
          </g>
        ))}
      </svg>
      {CALLOUTS.map((c, i) => (
        <div
          key={c.label}
          className="callout-label pointer-events-none absolute rounded-lg border border-ink-700/10 bg-white/90 px-2.5 py-1.5 shadow-sm backdrop-blur"
          style={{ left: `${c.x2}%`, top: `${c.y2}%`, transform: `translate(${c.x2 > 50 ? "-55%" : "-50%"}, -50%)`, ["--i" as string]: i }}
        >
          <p className="whitespace-nowrap font-mono text-[12px] font-medium text-ink-700">{c.label}</p>
          <p className="font-mono text-[9px] uppercase tracking-widest text-ink-700/45">{c.sub}</p>
        </div>
      ))}

      {/* rohové razítko */}
      <div className="pointer-events-none absolute bottom-6 right-6 hidden w-64 grid-cols-3 border border-ink-700/40 bg-white/90 font-mono text-[9px] uppercase text-ink-700/70 backdrop-blur sm:grid">
        <div className="col-span-3 border-b border-ink-700/40 px-2 py-1.5">
          <span className="block text-[8px] text-ink-700/40">{t.tbName}</span>
          <span className="text-[11px] font-semibold text-ink-700">{slogan}</span>
        </div>
        <div className="border-r border-ink-700/40 px-2 py-1">
          <span className="block text-[8px] text-ink-700/40">{t.tbScale}</span>1:1
        </div>
        <div className="border-r border-ink-700/40 px-2 py-1">
          <span className="block text-[8px] text-ink-700/40">{t.tbTolerance}</span>2768-mK
        </div>
        <div className="px-2 py-1">
          <span className="block text-[8px] text-ink-700/40">{t.tbQuality}</span>ISO 9001
        </div>
      </div>

      {/* CAD kurzor */}
      {cur && (
        <>
          <div className="pointer-events-none absolute inset-y-0 w-px bg-brand/30" style={{ left: cur.x }} />
          <div className="pointer-events-none absolute inset-x-0 h-px bg-brand/30" style={{ top: cur.y }} />
          <div className="pointer-events-none absolute rounded bg-ink px-1.5 py-0.5 font-mono text-[10px] text-white" style={{ left: cur.x + 10, top: cur.y + 10 }}>
            X {cur.mx.toFixed(1)} · Y {cur.my.toFixed(1)}
          </div>
        </>
      )}
    </div>
  );
}
