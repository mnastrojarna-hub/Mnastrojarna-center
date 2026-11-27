"use client";

/**
 * Pohybová studie › Vůle a spojitost kontroly (vlna 22, bod 6 zprávy majitele – „Bez kolizí“ není kontrola provozní vůle).
 *
 *  - `ClearanceSettings`: kontrola kolizí i mezi kroky (spojitě) × jen v krocích (diskrétně), sledované dvojice komponent nebo
 *    „pohyblivé vůči ostatním“, limit nedostatečné vůle – mění `doc.motion.clearance` (cad/types.ts `MotionClearance`) stejně
 *    jako text `pohyb vůle …` / `pohyb kolize spojitě|diskrétně` (cad/agent-clearance.ts);
 *  - `ClearanceResult`: jak se kolize kontrolovaly (štítek spojitě / částečně / diskrétně – nikdy „bez kolizí“), nejmenší vůle
 *    s dvojicí, krokem a místem, tlačítko „Na minimum“, graf vůle po krocích s limitem a ukazatelem kroku;
 *  - úsečka nejbližších bodů v aktuálním kroku pro 3D okno i softwarový náhled (`clearanceGap` → cad-app → `gap`).
 *
 * Výpočet a texty jsou společné s protokolem (cad/motion-clearance.ts, cad/clearance-report.ts) – panel nic nepočítá sám.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { fmt } from "@/cad/agent-asm";
import { leafLabel } from "@/cad/clash-report";
import { clearanceSummaryLines, gapAt, sweepLabel, sweepOf, type GapGfx } from "@/cad/clearance-report";
import { tr } from "@/cad/i18n";
import type { MotionResult } from "@/cad/motion";
import { clearanceOf, type ClearancePair } from "@/cad/motion-clearance";
import type { CadDoc, MotionClearance, MotionStudy } from "@/cad/types";
import { cn } from "@/lib/cn";
import { CadIcon } from "./cad-icons";
import { Num } from "./props";

/* ───────── úsečka vůle pro 3D okno (sdílený stav jako poloha kroku) ───────── */

let gap: GapGfx | null = null;
const subs = new Set<() => void>();
export const clearanceGap = {
  get: () => gap,
  set(g: GapGfx | null) {
    if (g === gap || (g && gap && g.d === gap.d && g.p1.every((v, i) => v === gap!.p1[i]) && g.p2.every((v, i) => v === gap!.p2[i]) && g.label === gap.label)) return;
    gap = g;
    subs.forEach((f) => f());
  },
  subscribe(f: () => void) {
    subs.add(f);
    return () => void subs.delete(f);
  },
};
/** úsečka nejbližších bodů sledované vůle v zobrazeném kroku (null = nic) */
export function useClearanceGap(): GapGfx | null {
  return useSyncExternalStore(clearanceGap.subscribe, clearanceGap.get, () => null);
}

const cap = "mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[#4a5664]";

/** Nastavení vůle a spojitosti kontroly (pod volbou kolizí v panelu studie). */
export function ClearanceSettings({ doc, study, onStudy }: { doc: CadDoc; study: MotionStudy; onStudy: (s: Partial<MotionStudy>) => void }) {
  const c: MotionClearance = study.clearance ?? {};
  const comps = useMemo(() => doc.components ?? [], [doc.components]);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const set = (p: MotionClearance) => {
    const next: MotionClearance = { ...c, ...p };
    if (next.refine !== false) delete next.refine;
    if (!next.pairs || (Array.isArray(next.pairs) && !next.pairs.length)) delete next.pairs;
    if (next.limit === undefined) delete next.limit;
    onStudy({ clearance: Object.keys(next).length ? next : undefined });
  };
  const pairs = Array.isArray(c.pairs) ? c.pairs : [];
  const name = (id: string) => leafLabel(doc, [id]);
  const ia = a || comps[0]?.id || "";
  const ib = b || comps.find((x) => x.id !== ia)?.id || "";
  const add = () => {
    if (!ia || !ib || ia === ib || pairs.some((p) => (p.a === ia && p.b === ib) || (p.a === ib && p.b === ia))) return;
    set({ pairs: [...pairs, { a: ia, b: ib }] });
  };
  return (
    <div data-clearance-settings className="space-y-1.5 rounded border border-[#e3e8ee] p-2">
      <p className={cap}>{tr("Vůle a spojitost kontroly")}</p>
      {study.collisions && (
        <label className="flex items-center gap-2 text-[11.5px]">
          <input type="checkbox" data-motion-continuous className="accent-[#E03930]" checked={c.refine !== false} onChange={(e) => set({ refine: e.target.checked ? undefined : false })} />
          {tr("Kolize i mezi kroky (spojitě – zjemnění u kontaktu)")}
        </label>
      )}
      <div className="flex rounded-md bg-[#eef2f6] p-0.5" role="group" aria-label={tr("Sledovaná vůle")}>
        {(["none", "pairs", "moving"] as const).map((k) => {
          const on = k === "none" ? !c.pairs : k === "moving" ? c.pairs === "moving" : Array.isArray(c.pairs);
          return (
            <button
              key={k}
              type="button"
              data-clearance-mode={k}
              aria-pressed={on}
              onClick={() => set({ pairs: k === "none" ? undefined : k === "moving" ? "moving" : pairs.length ? pairs : ia && ib && ia !== ib ? [{ a: ia, b: ib }] : undefined })}
              className={cn("flex-1 rounded px-1 py-0.5 text-[10.5px]", on ? "bg-white shadow-sm" : "text-[#5b6776]")}
            >
              {k === "none" ? tr("Nesledovat") : k === "pairs" ? tr("Dvojice") : tr("Pohyblivé díly")}
            </button>
          );
        })}
      </div>
      {Array.isArray(c.pairs) && (
        <>
          <ul className="space-y-1" data-clearance-pairs>
            {pairs.map((p, i) => (
              <li key={`${p.a}-${p.b}`} data-clearance-pair={`${name(p.a)} × ${name(p.b)}`} className="flex items-center gap-1.5 rounded border border-[#d5dbe2] bg-white px-2 py-0.5 text-[11.5px]">
                <span className="min-w-0 flex-1 truncate">
                  „{name(p.a)}“ × „{name(p.b)}“
                </span>
                <button type="button" title={tr("Nesledovat dvojici")} onClick={() => set({ pairs: pairs.filter((_, k) => k !== i) })} className="text-[#6b7785] hover:text-brand">
                  <CadIcon name="trash" className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-1">
            {[ia, ib].map((v, k) => (
              <select key={k} data-clearance-comp={k ? "b" : "a"} aria-label={k ? tr("Komponenta B") : tr("Komponenta A")} value={v} onChange={(e) => (k ? setB : setA)(e.target.value)} className="min-w-0 flex-1 rounded border border-[#cfd6de] bg-white px-1 py-0.5 text-[11.5px]">
                {comps.map((x) => (
                  <option key={x.id} value={x.id}>
                    {name(x.id)}
                  </option>
                ))}
              </select>
            ))}
            <button type="button" data-clearance-add disabled={!ia || !ib || ia === ib} onClick={add} className="rounded border border-[#cfd6de] bg-white px-2 py-0.5 text-[11.5px] hover:bg-[#f3f6f9] disabled:opacity-50">
              {tr("Přidat")}
            </button>
          </div>
        </>
      )}
      {c.pairs && (
        <div data-clearance-limit>
          <Num label={tr("Nejmenší přípustná vůle (limit)")} value={c.limit ?? 0} step={0.01} min={0} onChange={(v) => set({ limit: v > 0 ? v : undefined })} />
        </div>
      )}
      <p className="text-[10.5px] leading-snug text-[#6b7785]">
        {c.pairs
          ? tr("Vůle = nejmenší vzdálenost dílů v každé poloze; u kontaktu se kroky zjemní (půlení, u posuvu přesná dráha). Pod limitem ⚠ s místem a krokem.")
          : tr("Nulový průnik není důkaz, že nic nedře – vůli ve vedení nebo u střižníku sledujte zde (dvojice nebo pohyblivé díly s limitem).")}
      </p>
    </div>
  );
}

/** krok pro skok na minimum: dohledaná poloha mezi kroky → nejbližší krok úseku (kolo 6), jinak začátek úseku / krok minima */
const jumpStep = (m: NonNullable<ClearancePair["min"]>): number => (m.between ? (m.located ? Math.min(m.between[1], Math.max(m.between[0], Math.round(m.pos))) : m.between[0]) : Math.round(m.pos));

/** Výsledek: spojitost kontroly, nejmenší vůle s místem a skokem na krok, graf vůle po krocích; úsečka vůle pro 3D okno. */
export function ClearanceResult({ res, doc, step, onStep }: { res: MotionResult; doc: CadDoc; step: number; onStep: (i: number) => void }) {
  const ext = clearanceOf(res);
  const c = ext.clearance;
  const s = res.collisionsChecked ? sweepOf(res) : null;
  // úsečka nejbližších bodů v zobrazeném kroku (3D okno i náhled bez WebGL)
  useEffect(() => {
    clearanceGap.set(gapAt(res, doc, step));
  }, [res, doc, step]);
  useEffect(() => () => clearanceGap.set(null), []);
  const lines = useMemo(() => clearanceSummaryLines(res, doc), [res, doc]);
  const best = c?.pairs.find((p) => p.min);
  const between = ext.between ?? [];
  if (!s && !c) return null;
  return (
    <div data-clearance-result className="space-y-1.5">
      {s && (
        <p data-motion-sweep={s.mode} className={cn("rounded px-2 py-1 text-[10.5px] leading-snug", s.mode === "continuous" ? "bg-[#eef3f8] text-[#2c4a66]" : "bg-[#fff4e5] text-[#8a5300]")}>
          {tr("Kontrola kolizí:")} {sweepLabel(res)}
        </p>
      )}
      {between.map((h, i) => (
        <button key={i} type="button" data-clearance-between={`${h.k0}-${h.k1}`} onClick={() => onStep(h.k0)} className="block w-full rounded bg-brand/10 px-2 py-1 text-left text-[11px] text-brand-600 hover:bg-brand/20">
          ⚠ {tr("Kolize mezi kroky {0} a {1}: „{2}“ × „{3}“ (poloha {4}) – v krocích samotných není", h.k0, h.k1, leafLabel(doc, [h.a]), leafLabel(doc, [h.b]), fmt(h.pos, 3))}
        </button>
      ))}
      {c && (
        <div data-clearance-min={best?.min ? fmt(best.min.d, 4) : ""} data-clearance-below={c.limit !== null && best?.min && best.min.d < c.limit ? "1" : "0"} className="space-y-1">
          <ul className="space-y-0.5 text-[11px] leading-snug text-[#4a5664]">
            {lines.map((l, i) => (
              <li key={i} className={cn(/⚠/.test(l) && "text-brand-600")}>
                {l}
              </li>
            ))}
          </ul>
          {best?.min && (
            <button type="button" data-clearance-jump onClick={() => onStep(jumpStep(best.min!))} className="rounded border border-[#cfd6de] bg-white px-2 py-0.5 text-[11px] hover:bg-[#f3f6f9]">
              {tr("Na minimum (krok {0})", jumpStep(best.min))}
            </button>
          )}
          <ClearanceChart res={res} step={step} />
        </div>
      )}
    </div>
  );
}

const COLORS = ["#E03930", "#2563eb", "#059669", "#7c3aed", "#d97706"];

/** graf vůle po krocích: sledované dvojice (nejvýš 5 nejbližších), limit, ukazatel kroku */
function ClearanceChart({ res, step }: { res: MotionResult; step: number }) {
  const c = clearanceOf(res).clearance;
  if (!c) return null;
  const pairs = c.pairs.slice(0, 5).filter((p) => p.series.some((v) => v !== null && v !== undefined));
  if (!pairs.length) return null;
  const W = 320;
  const H = 100;
  const pad = { l: 40, r: 6, t: 6, b: 14 };
  const n = Math.max(1, res.steps.length - 1);
  const vals = pairs.flatMap((p) => p.series.filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v)));
  let hi = Math.max(...vals, c.limit ?? 0);
  const lo = 0;
  if (hi - lo < 1e-9) hi = 1;
  const x = (i: number) => pad.l + (i / n) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  return (
    <svg data-clearance-chart viewBox={`0 0 ${W} ${H}`} className="w-full rounded border border-[#e3e8ee] bg-white" role="img" aria-label={tr("Vůle po krocích [mm]")}>
      <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="#e3e8ee" />
      {c.limit !== null && <line data-clearance-limit-line x1={pad.l} x2={W - pad.r} y1={y(c.limit)} y2={y(c.limit)} stroke="#E03930" strokeDasharray="4 3" strokeWidth="0.8" />}
      <text x={pad.l - 3} y={pad.t + 8} textAnchor="end" fontSize="8" fill="#6b7785">
        {fmt(hi, 3)}
      </text>
      <text x={pad.l - 3} y={H - pad.b} textAnchor="end" fontSize="8" fill="#6b7785">
        0 mm
      </text>
      <text x={pad.l} y={H - 3} fontSize="8" fill="#6b7785">
        {tr("krok")} 0
      </text>
      <text x={W - pad.r} y={H - 3} textAnchor="end" fontSize="8" fill="#6b7785">
        {n}
      </text>
      {pairs.map((p, i) => (
        <polyline key={`${p.a}-${p.b}`} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth="1.3" points={p.series.map((v, k) => (v !== null && v !== undefined && Number.isFinite(v) ? `${x(k).toFixed(1)},${y(Math.min(hi, v)).toFixed(1)}` : "")).filter(Boolean).join(" ")} />
      ))}
      <line x1={x(step)} x2={x(step)} y1={pad.t} y2={H - pad.b} stroke="#272425" strokeWidth="0.8" strokeDasharray="2 2" />
    </svg>
  );
}
