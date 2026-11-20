"use client";

/**
 * Pohybová studie › Dynamika (vlna 21): přepínač Kinematika / Dynamika, nastavení dynamiky (krok integrace, gravitace, tlumení
 * pružin, odraz na dorazech, snímky), hmotnosti pohyblivých komponent (z objemu × hustoty, ručně přepsatelné), síly / momenty na
 * vazbách a graf výsledku (poloha, rychlost, zrychlení těles v hlavní ose, síly pružin) s ukazatelem aktuálního kroku.
 * Výpočet je v cad/motion-dynamic.ts, panel jen upravuje `doc.motion` (mode, dyn) jako ostatní pole studie.
 */
import { useEffect, useMemo, useState } from "react";
import { fmt } from "@/cad/agent-asm";
import type { AsmEnv } from "@/cad/asm-agent";
import { compInertias } from "@/cad/asm-agent-dyn";
import { tr } from "@/cad/i18n";
import { MATE_LABEL } from "@/cad/mates";
import { defaultDyn } from "@/cad/motion-dynamic";
import { modeHelp, studyMode } from "@/cad/motion-mode";
import { dynCharts, isDyn } from "@/cad/motion-dynamic-report";
import type { MotionResult } from "@/cad/motion";
import type { CadDoc, MotionDynamic, MotionStudy, Vec3 } from "@/cad/types";
import { cn } from "@/lib/cn";
import { CadIcon } from "./cad-icons";
import { Num } from "./props";
import { DecimalInput } from "./springs/decimal-input";

const GRAV: { id: string; v: Vec3 | null; label: string }[] = [
  { id: "-Z", v: [0, 0, -1], label: "−Z" },
  { id: "+Z", v: [0, 0, 1], label: "+Z" },
  { id: "-Y", v: [0, -1, 0], label: "−Y" },
  { id: "+Y", v: [0, 1, 0], label: "+Y" },
  { id: "-X", v: [-1, 0, 0], label: "−X" },
  { id: "+X", v: [1, 0, 0], label: "+X" },
];
const gravId = (g: Vec3 | null | undefined) => (g === undefined ? "-Z" : g === null ? "off" : (GRAV.find((x) => x.v && x.v.every((c, k) => Math.abs(c - g[k]) < 1e-9))?.id ?? "-Z"));
const cap = "mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[#4a5664]";

/**
 * Přepínač režimu studie (nahoře v panelu): Kinematika / Kvazistatika / Dynamika (vlna 22, bod 2 – cad/motion-mode.ts). Studie bez
 * výslovného režimu (automaticky) má zvýrazněný režim, který zvolí výpočet, a tlačítko „Auto“; pod přepínačem jedna věta, co režim počítá.
 */
export function MotionModeSwitch({ study, onStudy, doc }: { study: MotionStudy; onStudy: (s: Partial<MotionStudy>) => void; doc?: CadDoc }) {
  const eff = doc ? studyMode(doc, study) : { mode: study.mode ?? "kinematic", auto: !study.mode };
  const set = (k: "kinematic" | "quasistatic" | "dynamic" | "auto") =>
    onStudy(
      k === "dynamic"
        ? { mode: "dynamic", dyn: study.dyn ?? defaultDyn(), ...(study.mode !== "dynamic" ? { duration: study.motors.length ? study.duration : 0.5 } : {}) }
        : { mode: k === "auto" ? undefined : k },
    );
  return (
    <div className="space-y-1">
      <div className="flex rounded-md bg-[#eef2f6] p-0.5" data-motion-mode={study.mode ?? "auto"} data-motion-mode-effective={eff.mode}>
        {(["kinematic", "quasistatic", "dynamic", "auto"] as const).map((k) => {
          const on = k === "auto" ? !study.mode : eff.mode === k;
          return (
            <button
              key={k}
              type="button"
              data-motion-mode-btn={k === "kinematic" ? "kin" : k === "quasistatic" ? "quasi" : k === "dynamic" ? "dyn" : "auto"}
              aria-pressed={k === "auto" ? !study.mode : study.mode === k}
              title={modeHelp(k)}
              onClick={() => set(k)}
              className={cn("flex-1 rounded px-1.5 py-0.5 text-[11px]", on ? "bg-white font-semibold shadow-sm" : "text-[#5b6776]", k === "auto" && "max-w-[52px] flex-none")}
            >
              {k === "kinematic" ? tr("Kinematika") : k === "quasistatic" ? tr("Kvazistatika") : k === "dynamic" ? tr("Dynamika") : tr("Auto")}
            </button>
          );
        })}
      </div>
      <p data-motion-mode-help className="text-[10.5px] leading-snug text-[#6b7785]">
        {modeHelp(study.mode ?? "auto")}
      </p>
    </div>
  );
}

/** Nastavení dynamiky: krok, gravitace, tlumení, odraz, snímky, hmotnosti a síly na vazbách. */
export function DynamicSettings({ doc, study, onStudy, env }: { doc: CadDoc; study: MotionStudy; onStudy: (s: Partial<MotionStudy>) => void; env: () => AsmEnv }) {
  const D: MotionDynamic = { ...defaultDyn(), ...(study.dyn ?? {}) };
  const setDyn = (p: Partial<MotionDynamic>) => onStudy({ dyn: { ...D, ...p } });
  const mates = useMemo(() => doc.mates ?? [], [doc.mates]);
  const comps = useMemo(() => doc.components ?? [], [doc.components]);
  // pohyblivé komponenty: nejsou ukotvené a mají vazbu (ostatní stojí)
  const moving = useMemo(() => comps.filter((c) => !c.fixed && mates.some((m) => !m.suppressed && m.type !== "fixed" && [m.a, m.b, m.c, m.d].some((r) => r?.compId === c.id)) && !mates.some((m) => m.type === "fixed" && m.a.compId === c.id)), [comps, mates]);
  const [auto, setAuto] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    let live = true;
    void compInertias(doc, env())
      .then((m) => live && setAuto(new Map([...m].map(([id, x]) => [id, x.mass]))))
      .catch(() => {});
    return () => {
      live = false;
    };
    // hmotnosti z dílů: jen při změně komponent (ne při každé úpravě studie)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.components]);
  const [load, setLoad] = useState<{ mate: string; kind: "force" | "torque"; value: number }>({ mate: "", kind: "force", value: 100 });
  const loadMate = mates.some((m) => m.id === load.mate) ? load.mate : (mates[0]?.id ?? "");
  const mateName = (id: string) => {
    const i = mates.findIndex((m) => m.id === id);
    const m = mates[i];
    const nm = (cid: string) => comps.find((c) => c.id === cid)?.name ?? "?";
    return m ? `${i + 1}. ${m.name ?? tr(MATE_LABEL[m.type])} · ${nm(m.a.compId)} → ${nm(m.b.compId)}` : tr("(vazba chybí)");
  };
  return (
    <div className="space-y-2.5 rounded border border-[#d5dbe2] bg-[#fafbfc] p-2" data-motion-dyn>
      <p className="text-[11px] leading-snug text-[#6b7785]">{tr("Dynamika: díly se hýbou silami pružin, gravitace a zadaných sil po stupních volnosti, které nechávají vazby. Meze vazeb a délka pružiny na doraz jsou dorazy. Motor není nutný.")}</p>
      <div className="grid grid-cols-2 gap-2">
        <Num label={tr("Krok integrace")} value={D.dt * 1000} step={0.1} min={0.001} suffix="ms" onChange={(v) => v > 0 && setDyn({ dt: v / 1000 })} />
        <Num label={tr("Snímků záznamu")} value={D.frames ?? 400} step={50} min={10} suffix="" onChange={(v) => setDyn({ frames: Math.max(10, Math.min(5000, Math.round(v))) })} />
        <Num label={tr("Tlumení pružin")} value={D.damping ?? 0} step={0.01} min={0} suffix="N·s/mm" onChange={(v) => setDyn({ damping: Math.max(0, v) })} />
        <Num label={tr("Odraz na dorazech")} value={D.restitution ?? 0} step={0.1} min={0} suffix="0–1" onChange={(v) => setDyn({ restitution: Math.max(0, Math.min(1, v)) })} />
      </div>
      <label className="flex items-center gap-2 text-[11.5px]">
        <span className="shrink-0">{tr("Gravitace")}</span>
        <select data-motion-gravity aria-label={tr("Gravitace")} value={gravId(D.gravity)} onChange={(e) => setDyn({ gravity: e.target.value === "off" ? null : GRAV.find((g) => g.id === e.target.value)!.v })} className="min-w-0 flex-1 rounded border border-[#cfd6de] bg-white px-2 py-0.5 text-[12px]">
          {GRAV.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label} (9,81 m/s²)
            </option>
          ))}
          <option value="off">{tr("vypnutá")}</option>
        </select>
      </label>
      {moving.length > 0 && (
        <div>
          <p className={cap}>{tr("Hmotnosti")}</p>
          <ul className="space-y-1" data-motion-masses>
            {moving.map((c) => {
              const kg = D.masses?.[c.id];
              const a = auto.get(c.id);
              return (
                <li key={c.id} className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate" title={c.name}>
                    {c.name}
                  </span>
                  <input
                    key={`${c.id}:${kg ?? ""}`}
                    data-motion-mass={c.name}
                    aria-label={tr("Hmotnost {0} [kg]", c.name)}
                    defaultValue={kg !== undefined ? String(kg) : ""}
                    placeholder={a !== undefined ? fmt(a, 3) : tr("z objemu")}
                    onBlur={(e) => {
                      const v = Number(e.target.value.replace(",", "."));
                      const masses = { ...(D.masses ?? {}) };
                      if (e.target.value.trim() && v > 0) masses[c.id] = v;
                      else delete masses[c.id];
                      setDyn({ masses });
                    }}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    className={cn("w-20 rounded border px-1.5 py-0.5 text-right font-mono text-[11.5px]", kg !== undefined ? "border-brand/60" : "border-[#cfd6de]")}
                  />
                  <span className="text-[10.5px] text-[#6b7785]">kg</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-1 text-[10.5px] text-[#6b7785]">{tr("Prázdné = z objemu × hustoty materiálu dílu (šedě).")}</p>
        </div>
      )}
      <div>
        <p className={cap}>{tr("Síly na vazbách")}</p>
        {(D.loads ?? []).length > 0 && (
          <ul className="mb-1 space-y-1" data-motion-loads>
            {(D.loads ?? []).map((l, i) => (
              <li key={`${l.mate}:${l.kind}`} className="flex items-center gap-1.5 rounded border border-[#d5dbe2] bg-white px-2 py-0.5">
                <span className="min-w-0 flex-1 truncate">{mateName(l.mate)}</span>
                <span className="font-mono text-[11px]">{l.kind === "force" ? `${fmt(l.value, 3)} N` : `${fmt(l.value, 4)} N·m`}</span>
                <button type="button" title={tr("Odebrat sílu")} onClick={() => setDyn({ loads: (D.loads ?? []).filter((_, k) => k !== i) })} className="text-[#6b7785] hover:text-brand">
                  <CadIcon name="trash" className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {mates.length ? (
          <div className="flex items-center gap-1">
            <select aria-label={tr("Vazba síly")} value={loadMate} onChange={(e) => setLoad({ ...load, mate: e.target.value })} className="min-w-0 flex-1 rounded border border-[#cfd6de] bg-white px-1.5 py-0.5 text-[11.5px]">
              {mates.map((m) => (
                <option key={m.id} value={m.id}>
                  {mateName(m.id)}
                </option>
              ))}
            </select>
            <select aria-label={tr("Druh zatížení")} value={load.kind} onChange={(e) => setLoad({ ...load, kind: e.target.value as "force" | "torque" })} className="rounded border border-[#cfd6de] bg-white px-1 py-0.5 text-[11.5px]">
              <option value="force">{tr("síla N")}</option>
              <option value="torque">{tr("moment N·m")}</option>
            </select>
            <DecimalInput aria-label={tr("Hodnota zatížení")} value={load.value} onValue={(v) => v !== null && setLoad((cur) => ({ ...cur, value: v }))} className="w-14 rounded border border-[#cfd6de] px-1 py-0.5 text-right font-mono text-[11.5px]" />
            <button type="button" disabled={!loadMate} onClick={() => setDyn({ loads: [...(D.loads ?? []).filter((x) => !(x.mate === loadMate && x.kind === load.kind)), { mate: loadMate, kind: load.kind, value: load.value }] })} className="rounded border border-[#cfd6de] bg-white px-1.5 py-0.5 text-[11.5px] hover:bg-[#f3f6f9] disabled:opacity-50">
              {tr("Přidat")}
            </button>
          </div>
        ) : (
          <p className="text-[11px] text-[#6b7785]">{tr("Sestava nemá vazby.")}</p>
        )}
      </div>
    </div>
  );
}

const COLORS = ["#E03930", "#2563eb", "#16a34a", "#9333ea", "#ea580c", "#0891b2"];

/** Graf výsledku dynamiky s výběrem veličiny a ukazatelem aktuálního kroku. */
export function DynChart({ res, doc, step }: { res: MotionResult; doc: CadDoc; step: number }) {
  const charts = useMemo(() => (isDyn(res) ? dynCharts(res, doc) : []), [res, doc]);
  const [key, setKey] = useState<string>("pos");
  const ch = charts.find((c) => c.key === key) ?? charts[0];
  if (!ch) return null;
  const W = 320;
  const H = 120;
  const pad = { l: 40, r: 6, t: 6, b: 16 };
  const t0 = ch.t[0] ?? 0;
  const t1 = ch.t[ch.t.length - 1] ?? 1;
  const vals = ch.series.flatMap((s) => s.values.filter(Number.isFinite));
  let lo = vals.length ? Math.min(...vals) : 0;
  let hi = vals.length ? Math.max(...vals) : 1;
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const x = (t: number) => pad.l + ((t - t0) / Math.max(1e-12, t1 - t0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const cur = ch.t[Math.min(step, ch.t.length - 1)] ?? t0;
  return (
    <div data-motion-chart={ch.key} className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {charts.map((c) => (
          <button key={c.key} type="button" data-motion-chart-btn={c.key} onClick={() => setKey(c.key)} className={cn("rounded px-1.5 py-0.5 text-[11px]", c.key === ch.key ? "bg-[#272425] text-white" : "border border-[#cfd6de] bg-white")}>
            {c.label}
          </button>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded border border-[#e3e8ee] bg-white" role="img" aria-label={`${ch.label} [${ch.unit}]`}>
        <line x1={pad.l} x2={W - pad.r} y1={y(lo)} y2={y(lo)} stroke="#e3e8ee" />
        {lo < 0 && hi > 0 && <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="#cfd6de" strokeDasharray="3 3" />}
        <text x={pad.l - 3} y={pad.t + 8} textAnchor="end" fontSize="8" fill="#6b7785">
          {fmt(hi, 3)}
        </text>
        <text x={pad.l - 3} y={H - pad.b} textAnchor="end" fontSize="8" fill="#6b7785">
          {fmt(lo, 3)}
        </text>
        <text x={pad.l - 3} y={(H - pad.b + pad.t) / 2 + 3} textAnchor="end" fontSize="8" fill="#6b7785">
          {ch.unit}
        </text>
        <text x={pad.l} y={H - 4} fontSize="8" fill="#6b7785">
          {fmt(t0, 3)} s
        </text>
        <text x={W - pad.r} y={H - 4} textAnchor="end" fontSize="8" fill="#6b7785">
          {fmt(t1, 3)} s
        </text>
        {ch.series.map((s, i) => (
          <polyline key={s.id} data-series={s.name} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth="1.3" points={s.values.map((v, k) => (Number.isFinite(v) ? `${x(ch.t[k]).toFixed(1)},${y(v).toFixed(1)}` : "")).filter(Boolean).join(" ")} />
        ))}
        <line x1={x(cur)} x2={x(cur)} y1={pad.t} y2={H - pad.b} stroke="#272425" strokeWidth="0.8" strokeDasharray="2 2" />
      </svg>
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-[#4a5664]">
        {ch.series.map((s, i) => (
          <li key={s.id} className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3" style={{ background: COLORS[i % COLORS.length] }} />
            {s.name}: {fmt(s.values[Math.min(step, s.values.length - 1)] ?? NaN, 3)} {ch.unit}
          </li>
        ))}
      </ul>
    </div>
  );
}
