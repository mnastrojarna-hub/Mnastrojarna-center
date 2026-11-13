"use client";

/**
 * Skicář: tečny splinu (7. vlna). Úchyty tečen (čára od bodu + kroužek, tažením se zadá úhel a váha) a panel vlastností
 * vybraného splinu: u každého bodu tečna zapnuto/vypnuto, úhel (°) a váha (1 = přirozená). Matematika: cad/spline-tangent.ts.
 */
import { tr } from "@/cad/i18n";
import { splinePoints } from "@/cad/sketch";
import { curveAngleAt, setTangent, tangentAt, tangentHandles, weightAt, type SplineEnt } from "@/cad/spline-tangent";
import type { Vec2 } from "@/cad/types";
import { useEffect, useState } from "react";

/** Úchyty tečen vybraného splinu (pod obdélníkovými úchyty skicáře – kroužky a čáry, klíče „t{i}“). */
export function SplineTangentHandles({ e, toPx }: { e: SplineEnt; toPx: (p: Vec2) => [number, number] }) {
  return (
    <g data-spline-tangents={e.id} pointerEvents="none">
      {tangentHandles(e, splinePoints).map((h) => {
        const [x0, y0] = toPx(h.base);
        const [x1, y1] = toPx(h.p);
        return (
          <g key={h.key} data-tangent-handle={h.key} data-set={h.set ? "1" : "0"}>
            <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={h.set ? "#0e7490" : "#94a3b8"} strokeWidth={1.4} strokeDasharray={h.set ? undefined : "4 3"} />
            <circle cx={x1} cy={y1} r={4.5} fill={h.set ? "#0e7490" : "#fff"} stroke="#0e7490" strokeWidth={1.4} />
          </g>
        );
      })}
    </g>
  );
}

const fmt = (v: number) => String(Math.round(v * 100) / 100).replace(".", ",");
const parse = (s: string) => {
  const v = parseFloat(s.replace(",", "."));
  return Number.isFinite(v) ? v : null;
};

/** Pole čísla, které se uloží až po potvrzení (Enter / opuštění) – psaní neruší překreslování skici. */
function NumCell({ value, onCommit, label, disabled }: { value: number; onCommit: (v: number) => void; label: string; disabled?: boolean }) {
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]);
  const commit = () => {
    const v = parse(text);
    if (v === null) setText(fmt(value));
    else if (Math.abs(v - value) > 1e-9) onCommit(v);
  };
  return (
    <input
      aria-label={label}
      title={label}
      disabled={disabled}
      value={text}
      onChange={(ev) => setText(ev.target.value)}
      onBlur={commit}
      onKeyDown={(ev) => {
        ev.stopPropagation();
        if (ev.key === "Enter") commit();
      }}
      className="h-6 w-14 rounded border border-[#cfd6de] px-1 text-right font-mono text-[11px] disabled:bg-[#f1f4f7] disabled:text-[#9aa5b1]"
    />
  );
}

/** Panel vlastností vybraného splinu: tečny a váhy v bodech. */
export function SplineTangentPanel({ e, onChange }: { e: SplineEnt; onChange: (next: SplineEnt) => void }) {
  return (
    <div data-spline-panel={e.id} className="absolute right-3 top-3 max-h-[70%] w-72 overflow-auto rounded-md border border-[#cfd6de] bg-white/95 p-3 text-[12px] shadow-lg backdrop-blur" onPointerDown={(ev) => ev.stopPropagation()}>
      <p className="mb-1 font-semibold">{tr("Spline – tečny v bodech")}</p>
      <p className="mb-2 text-[11px] leading-snug text-[#6b7785]">{tr("Úhel od osy X skici (°), váha 1 = přirozená velikost. Tečnu lze i táhnout za kroužek u bodu.")}</p>
      <div className="grid grid-cols-[2.2rem_auto_1fr_1fr] items-center gap-x-1.5 gap-y-1">
        <span className="text-[10.5px] text-[#6b7785]">{tr("Bod")}</span>
        <span className="text-[10.5px] text-[#6b7785]">{tr("Tečna")}</span>
        <span className="text-[10.5px] text-[#6b7785]">{tr("Úhel °")}</span>
        <span className="text-[10.5px] text-[#6b7785]">{tr("Váha")}</span>
        {e.points.map((_, i) => {
          const a = tangentAt(e, i);
          const on = a !== null;
          const shown = on ? a : curveAngleAt(e, i, splinePoints);
          return (
            <div key={i} className="contents" data-spline-row={i}>
              <span className="font-mono text-[11px]">p{i}</span>
              <input type="checkbox" aria-label={tr("Tečna v bodě p{0}", i)} checked={on} onChange={(ev) => onChange(setTangent(e, i, ev.target.checked ? Math.round(shown * 100) / 100 : null))} className="accent-[#0e7490]" />
              <NumCell label={tr("Úhel tečny v bodě p{0}", i)} value={shown} onCommit={(v) => onChange(setTangent(e, i, v, weightAt(e, i)))} />
              <NumCell label={tr("Váha tečny v bodě p{0}", i)} value={weightAt(e, i)} disabled={!on} onCommit={(v) => v > 0 && onChange(setTangent(e, i, shown, v))} />
            </div>
          );
        })}
      </div>
      {e.tangents && (
        <button type="button" className="mt-2 text-[11px] text-[#b91c1c] underline" onClick={() => onChange(e.points.reduce((acc, _, i) => setTangent(acc, i, null), e))}>
          {tr("Zrušit všechny tečny")}
        </button>
      )}
    </div>
  );
}
