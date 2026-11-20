"use client";

/**
 * Živý 2D náhled kola (SVG): obrys zubů a těla, díra, roztečná (čerchovaná), hlavová, patní a základní kružnice, legenda
 * s průměry; detail zubu 0 (pata, zaoblení, hlava); soukolí = obě kola v záběru ve vypočtené osové vzdálenosti s přímkou
 * záběru. Čistá geometrie je v `sketch.ts` – náhled se počítá při každé změně tabulky (bez jádra).
 * Automatizace: `[data-gear-preview]`, `[data-gear-detail]`, `[data-gear-thumb="<druh>"]`.
 */
import { useMemo } from "react";
import { tr } from "@/cad/i18n";
import type { GearData, GearKind, PairKind, PairResult, Vec2 } from "@/cad/gears";
import { cn } from "@/lib/cn";
import { showNum } from "./gear-table";
import { pairSketch, pathOf, shapePath, toothFocus, wheelSketch, type CircleRole, type Sketch2 } from "./sketch";

const CIRCLE_STYLE: Record<CircleRole, { stroke: string; dash?: string; label: () => string; sym: string }> = {
  ref: { stroke: "#2563eb", dash: "10 3 2 3", label: () => tr("roztečná"), sym: "d" },
  tip: { stroke: "#16a34a", label: () => tr("hlavová"), sym: "dₐ" },
  root: { stroke: "#E03930", label: () => tr("patní"), sym: "d_f" },
  base: { stroke: "#9333ea", dash: "2 3", label: () => tr("základní"), sym: "d_b" },
};
const WHEEL_FILL = ["#dfe6ee", "#f1e3c8"];

/** SVG obrázek náčrtu; `box` = výřez v mm (jinak celý náčrt s okrajem) */
export function SketchSvg({ sk, box, className, title, thin, bare, ...rest }: { sk: Sketch2; box?: [Vec2, Vec2]; className?: string; title?: string; thin?: boolean; bare?: boolean } & Record<`data-${string}`, string | boolean | undefined>) {
  const [a, b] = box ?? sk.box;
  const w = Math.max(b[0] - a[0], 1e-6);
  const h = Math.max(b[1] - a[1], 1e-6);
  const pad = 0.06 * Math.max(w, h);
  // y dolů: výřez [x0, −y1] … [x1, −y0]
  const vb = `${a[0] - pad} ${-b[1] - pad} ${w + 2 * pad} ${h + 2 * pad}`;
  const sw = thin ? 0.8 : 1.2;
  return (
    <svg viewBox={vb} className={className} role="img" aria-label={title} preserveAspectRatio="xMidYMid meet" {...rest}>
      {title && <title>{title}</title>}
      {sk.shapes.map((s, i) => (
        <path key={i} d={shapePath(s)} fillRule="evenodd" fill={s.role === "section" ? "#e9edf2" : WHEEL_FILL[s.wheel ?? 0]} stroke="#26303b" strokeWidth={sw} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      ))}
      {!bare && sk.circles.map((c, i) => {
        const st = CIRCLE_STYLE[c.role];
        return <circle key={i} cx={c.c[0]} cy={-c.c[1]} r={c.r} fill="none" stroke={st.stroke} strokeWidth={thin ? 0.6 : 0.9} strokeDasharray={st.dash} vectorEffect="non-scaling-stroke" opacity={0.85} />;
      })}
      {sk.lines.map((l, i) => (
        <path key={i} d={pathOf([l.a, l.b], false)} stroke={l.role === "action" ? "#ea580c" : l.role === "pitch" ? "#2563eb" : "#6b7785"} strokeWidth={l.role === "action" ? 2.2 : 0.9} strokeDasharray={l.role === "axis" || l.role === "pitch" ? "10 3 2 3" : undefined} vectorEffect="non-scaling-stroke" fill="none" />
      ))}
    </svg>
  );
}

/** obrázek druhu do galerie: méně zubů, ať jsou v 56 px vidět (jen obrázek druhu, ne zadání uživatele) */
const THUMB: Partial<Record<GearKind, GearData>> = { spur: { z: 12 }, helical: { z: 12 }, herringbone: { z: 12 }, internal: { z: 24, rimD: 0 }, rack: { z: 6 }, wormwheel: { z: 16 }, cycloid: { z: 14 }, cyclodisc: { N: 8 }, sprocket: { z: 11 }, pulley: { z: 14 }, ratchet: { z: 12 } };
/** malý obrázek druhu (galerie, formulář): obrys bez kružnic */
export function GearThumb({ kind, data, className, sample }: { kind: GearKind; data: GearData; className?: string; sample?: boolean }) {
  const sk = useMemo(() => wheelSketch(kind, sample ? { ...data, ...(THUMB[kind] ?? {}) } : data, { coarse: true }), [kind, data, sample]);
  return <SketchSvg sk={sk} className={className ?? "h-14 w-14"} thin bare data-gear-thumb={kind} />;
}

/** legenda průměrů pod náhledem */
function Legend({ sk }: { sk: Sketch2 }) {
  const seen = new Set<CircleRole>();
  const items = sk.circles.filter((c) => (seen.has(c.role) ? false : (seen.add(c.role), true)));
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap justify-center gap-x-3 gap-y-0.5 text-[11px] text-[#4b5866]">
      {items.map((c) => {
        const st = CIRCLE_STYLE[c.role];
        return (
          <span key={c.role} className="inline-flex items-center gap-1" data-gear-legend={c.role}>
            <svg width="18" height="6" aria-hidden>
              <line x1="0" y1="3" x2="18" y2="3" stroke={st.stroke} strokeWidth="1.5" strokeDasharray={st.dash ? "4 2" : undefined} />
            </svg>
            {st.label()} <span className="font-mono">Ø{st.sym} {showNum(Math.round(2 * c.r * 1000) / 1000)}</span>
          </span>
        );
      })}
    </div>
  );
}

/** Náhled jednoho kola: celý obrys + detail zubu 0, legenda průměrů. */
export function GearPreview({ kind, data, compact }: { kind: GearKind; data: GearData; compact?: boolean }) {
  const sk = useMemo(() => wheelSketch(kind, data), [kind, data]);
  const focus = useMemo(() => toothFocus(kind, data), [kind, data]);
  if (!sk.shapes.length) return <p className="py-6 text-center text-[12px] text-[#6b7785]">{tr("Náhled se ukáže po opravě řádků označených ✗.")}</p>;
  return (
    <div className="flex w-full flex-col items-center gap-1.5" data-gear-preview={kind}>
      <div className={cn("grid w-full gap-1.5", focus && !compact ? "grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]" : "grid-cols-1")}>
        <div className="rounded border border-[#e3e8ee] bg-white p-1">
          <SketchSvg sk={sk} className={cn("w-full", compact ? "h-36" : "h-56")} title={tr("Náhled kola")} />
        </div>
        {focus && !compact && (
          <div className="rounded border border-[#e3e8ee] bg-white p-1" data-gear-detail>
            <SketchSvg sk={sk} box={focus} className="h-56 w-full" title={tr("Detail zubu")} />
            <p className="text-center text-[10.5px] text-[#6b7785]">{tr("detail zubu (pata a hlava)")}</p>
          </div>
        )}
      </div>
      <Legend sk={sk} />
    </div>
  );
}

/** Náhled soukolí: obě kola v záběru v poloze sestavy. */
export function PairPreview({ kind, res }: { kind: PairKind; res: PairResult }) {
  const sk = useMemo(() => pairSketch(kind, res), [kind, res]);
  if (!sk.shapes.length) return <p className="py-6 text-center text-[12px] text-[#6b7785]">{tr("Náhled se ukáže po opravě řádků označených ✗.")}</p>;
  return (
    <div className="flex w-full flex-col items-center gap-1" data-gear-preview={`pair-${kind}`}>
      <div className="w-full rounded border border-[#e3e8ee] bg-white p-1">
        <SketchSvg sk={sk} className="h-64 w-full" title={tr("Náhled soukolí")} />
      </div>
      {sk.lines.some((l) => l.role === "action") && <p className="text-[11px] text-[#4b5866]">{tr("oranžově přímka záběru (tečna k základním kružnicím přes valivý bod)")}</p>}
    </div>
  );
}
