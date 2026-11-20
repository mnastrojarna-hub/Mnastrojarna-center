"use client";

/**
 * Fáze pohybové studie v panelu (vlna 22, bod 3 zprávy): pásy fází na časové ose (z výsledku – skutečný okamžik začátku každé fáze,
 * klik = skok na první krok fáze), seznam fází s úpravou, pořadím (nahoru / dolů) a smazáním, formulář fáze (název, podmínka začátku:
 * čas / hodnota vazby / hodnota motoru / po dojetí motorů předchozí fáze, zapnout / potlačit vazby, režim). Model a výpočet:
 * cad/motion-phases.ts, cad/motion.ts; text `pohyb fáze …` dělá totéž (cad/agent-motion-phases.ts).
 */
import { useState } from "react";
import { tr } from "@/cad/i18n";
import { MATE_LABEL } from "@/cad/mates";
import type { MotionResult } from "@/cad/motion";
import { condText, movePhase, newPhase, phaseProblems, removePhase } from "@/cad/motion-phases";
import type { CadDoc, Mate, MotionCond, MotionPhase, MotionStudy } from "@/cad/types";
import { cn } from "@/lib/cn";
import { CadIcon } from "./cad-icons";
import { Num } from "./props";

/** barvy pásů fází (střídají se) */
const BAND = ["#dbeafe", "#fde68a", "#fecaca", "#bbf7d0", "#e9d5ff", "#fed7aa"];

type Form = { i: number | null; name: string; kind: "none" | "time" | "mate" | "motor"; t: number; ref: string; op: "<=" | ">="; value: number; enable: string[]; suppress: string[]; mode: "" | "kinematic" | "quasistatic" };

const formOf = (ph: MotionPhase | null, i: number | null, n: number): Form => {
  const c = ph?.start;
  return {
    i,
    name: ph?.name ?? tr("Fáze {0}", n + 1),
    kind: !c ? "none" : "t" in c ? "time" : "mate" in c ? "mate" : "motor",
    t: c && "t" in c ? c.t : 0,
    ref: c && "mate" in c ? c.mate : c && "motor" in c ? c.motor : "",
    op: c && !("t" in c) ? c.op : "<=",
    value: c && !("t" in c) ? c.value : 0,
    enable: ph?.enable ?? [],
    suppress: ph?.suppress ?? [],
    mode: ph?.mode === "kinematic" || ph?.mode === "quasistatic" ? ph.mode : "",
  };
};

/** Pásy fází nad posuvníkem časové osy (jen s platným výsledkem). */
export function PhaseTimeline({ res, onStep }: { res: MotionResult; onStep: (i: number) => void }) {
  const runs = res.phases ?? [];
  if (!runs.length) return null;
  const T = res.steps[res.steps.length - 1]?.t || 1;
  const reached = runs.filter((r) => r.reached);
  return (
    <div data-phase-timeline={runs.length} className="relative h-5 w-full overflow-hidden rounded border border-[#d5dbe2] bg-[#f3f6f9]">
      {reached.map((r, k) => {
        const t0 = r.t ?? 0;
        const t1 = reached[k + 1]?.t ?? T;
        return (
          <button
            key={r.id}
            type="button"
            data-phase-band={r.index + 1}
            data-phase-step={r.step}
            title={tr("Fáze {0} „{1}“: t = {2}–{3} s · kroky {4}–{5} – klik = první krok fáze", r.index + 1, r.name, t0.toFixed(3), t1.toFixed(3), r.step ?? 0, r.end ?? r.step ?? 0)}
            onClick={() => onStep(r.step ?? 0)}
            className="absolute inset-y-0 truncate border-r border-white px-1 text-left text-[10px] font-medium text-[#26303b]"
            style={{ left: `${(100 * t0) / T}%`, width: `${Math.max(1, (100 * (t1 - t0)) / T)}%`, background: BAND[r.index % BAND.length] }}
          >
            {r.name}
          </button>
        );
      })}
      {runs.some((r) => !r.reached) && (
        <span data-phase-unreached className="absolute right-1 top-0.5 text-[10px] font-semibold text-brand-600">
          ⚠ {tr("nenastaly: {0}", runs.filter((r) => !r.reached).map((r) => r.name).join(", "))}
        </span>
      )}
    </div>
  );
}

/** Seznam a formulář fází (definice studie). */
export function MotionPhases({ doc, study, onStudy, flash }: { doc: CadDoc; study: MotionStudy; onStudy: (s: Partial<MotionStudy>) => void; flash: (t: string) => void }) {
  const phases = study.phases ?? [];
  const mates = doc.mates ?? [];
  const [form, setForm] = useState<Form | null>(null);
  const mateLabel = (m: Mate) => `${mates.indexOf(m) + 1}. ${m.name ?? tr(MATE_LABEL[m.type])}`;
  const save = () => {
    if (!form) return;
    const name = form.name.trim() || tr("Fáze {0}", phases.length + 1);
    if (phases.some((p, k) => k !== form.i && p.name.toLowerCase() === name.toLowerCase())) return flash(tr("Fáze „{0}“ už ve studii je.", name));
    const start: MotionCond | undefined = form.kind === "time" ? { t: Math.max(0, form.t) } : form.kind === "mate" && form.ref ? { mate: form.ref, op: form.op, value: form.value } : form.kind === "motor" && form.ref ? { motor: form.ref, op: form.op, value: form.value } : undefined;
    const rest = { ...(start ? { start } : {}), ...(form.enable.length ? { enable: form.enable } : {}), ...(form.suppress.length ? { suppress: form.suppress } : {}), ...(form.mode ? { mode: form.mode } : {}) };
    const list = form.i === null ? [...phases, newPhase(name, rest)] : phases.map((p, k) => (k === form.i ? { id: p.id, name, ...rest } : p));
    const problems = phaseProblems({ ...study, phases: list }, mates);
    if (problems.length) return flash(problems[0]);
    onStudy({ phases: list });
    setForm(null);
  };
  const toggle = (key: "enable" | "suppress", id: string) => form && setForm({ ...form, [key]: form[key].includes(id) ? form[key].filter((x) => x !== id) : [...form[key], id] });
  return (
    <div data-motion-phases={phases.length}>
      <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[#4a5664]">{tr("Fáze studie")}</p>
      {phases.length ? (
        <ol className="space-y-1">
          {phases.map((ph, i) => (
            <li key={ph.id} data-phase-row={i + 1} className="flex items-center gap-1 rounded border border-[#d5dbe2] bg-white px-2 py-1">
              <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: BAND[i % BAND.length] }} />
              <button type="button" data-phase-edit={i + 1} onClick={() => setForm(formOf(ph, i, i))} className="min-w-0 flex-1 text-left">
                <span className="block truncate font-medium">
                  {i + 1}. {ph.name}
                </span>
                <span className="block truncate text-[10.5px] text-[#6b7785]">
                  {condText(ph.start, doc, study, i)}
                  {ph.enable?.length ? ` · ${tr("zapnout {0}", ph.enable.length)}` : ""}
                  {ph.suppress?.length ? ` · ${tr("potlačit {0}", ph.suppress.length)}` : ""}
                  {ph.mode ? ` · ${ph.mode === "quasistatic" ? tr("kvazistatika") : tr("kinematika")}` : ""}
                </span>
              </button>
              <button type="button" data-phase-up={i + 1} disabled={i === 0} title={tr("Posunout dříve")} onClick={() => onStudy({ phases: movePhase(phases, i, -1) })} className="px-0.5 text-[#6b7785] hover:text-brand disabled:opacity-30">
                ↑
              </button>
              <button type="button" data-phase-down={i + 1} disabled={i === phases.length - 1} title={tr("Posunout později")} onClick={() => onStudy({ phases: movePhase(phases, i, 1) })} className="px-0.5 text-[#6b7785] hover:text-brand disabled:opacity-30">
                ↓
              </button>
              <button
                type="button"
                data-phase-remove={i + 1}
                title={tr("Smazat fázi")}
                onClick={() => {
                  const r = removePhase(study, i);
                  onStudy({ motors: r.study.motors, phases: r.study.phases });
                  if (r.motors) flash(tr("Fáze „{0}“ smazána – motorů, které s ní začínaly: {1} (začnou od začátku studie).", ph.name, r.motors));
                }}
                className="text-[#6b7785] hover:text-brand"
              >
                <CadIcon name="trash" className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[11px] text-[#6b7785]">{tr("Bez fází: jedna časová osa pro všechny motory. Fáze rozdělí cyklus (nájezd, sevření, střih, návrat) a od svého začátku zapnou / potlačí vazby nebo změní režim.")}</p>
      )}
      {!form && (
        <button type="button" data-phase-new onClick={() => setForm(formOf(null, null, phases.length))} className="mt-1.5 w-full rounded border border-[#cfd6de] bg-white py-1 text-[12px] hover:bg-[#f3f6f9]">
          {tr("+ Nová fáze")}
        </button>
      )}
      {form && (
        <div data-phase-form={form.i === null ? "new" : "edit"} className="mt-1.5 space-y-1.5 rounded border border-dashed border-[#cfd6de] p-2">
          <label className="block text-[10.5px] text-[#4a5664]">
            {tr("Název fáze")}
            <input data-phase-name value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-0.5 w-full rounded border border-[#cfd6de] bg-white px-2 py-1 text-[12px]" />
          </label>
          <label className="block text-[10.5px] text-[#4a5664]">
            {tr("Začátek fáze")}
            <select data-phase-start value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Form["kind"], ref: "" })} className="mt-0.5 w-full rounded border border-[#cfd6de] bg-white px-2 py-1 text-[12px]">
              <option value="none">{form.i === 0 || (form.i === null && !phases.length) ? tr("od začátku studie") : tr("po dojetí motorů předchozí fáze")}</option>
              <option value="time">{tr("v čase")}</option>
              <option value="mate">{tr("když hodnota vazby dosáhne")}</option>
              <option value="motor">{tr("když hodnota motoru dosáhne")}</option>
            </select>
          </label>
          {form.kind === "time" && <Num label={tr("Čas začátku")} value={form.t} step={0.1} min={0} suffix="s" onChange={(v) => setForm({ ...form, t: v })} />}
          {(form.kind === "mate" || form.kind === "motor") && (
            <div className="grid grid-cols-[1fr_52px_1fr] items-end gap-1">
              <select data-phase-ref aria-label={form.kind === "mate" ? tr("Vazba podmínky") : tr("Motor podmínky")} value={form.ref} onChange={(e) => setForm({ ...form, ref: e.target.value })} className="rounded border border-[#cfd6de] bg-white px-1 py-1 text-[11px]">
                <option value="">{tr("(vyberte)")}</option>
                {form.kind === "mate"
                  ? mates.map((m) => (
                      <option key={m.id} value={m.id}>
                        {mateLabel(m)}
                      </option>
                    ))
                  : study.motors.map((m, k) => (
                      <option key={m.id} value={m.id}>
                        {tr("Motor {0}", k + 1)}
                      </option>
                    ))}
              </select>
              <select data-phase-op aria-label={tr("Operátor podmínky")} value={form.op} onChange={(e) => setForm({ ...form, op: e.target.value as "<=" | ">=" })} className="rounded border border-[#cfd6de] bg-white px-1 py-1 text-[11px]">
                <option value="<=">≤</option>
                <option value=">=">≥</option>
              </select>
              <Num label={tr("hodnota")} value={form.value} step={1} suffix="" onChange={(v) => setForm({ ...form, value: v })} />
            </div>
          )}
          {mates.length > 0 && (
            <details className="text-[11px]" open={!!(form.enable.length || form.suppress.length)}>
              <summary className="cursor-pointer text-[#4a5664]">{tr("Vazby od začátku fáze (zapnout / potlačit)")}</summary>
              <p className="mt-1 text-[10.5px] text-[#6b7785]">{tr("Zapnutá vazba zachytí polohu dílů v okamžiku začátku fáze (zámek drží díly tak, jak právě jsou).")}</p>
              <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto">
                {mates.map((m) => (
                  <li key={m.id} className="flex items-center gap-1.5">
                    <label className="flex items-center gap-1" title={tr("zapnout")}>
                      <input type="checkbox" data-phase-enable={m.id} className="accent-[#16a34a]" checked={form.enable.includes(m.id)} onChange={() => toggle("enable", m.id)} />+
                    </label>
                    <label className="flex items-center gap-1" title={tr("potlačit")}>
                      <input type="checkbox" data-phase-suppress={m.id} className="accent-[#E03930]" checked={form.suppress.includes(m.id)} onChange={() => toggle("suppress", m.id)} />−
                    </label>
                    <span className={cn("truncate", m.suppressed && "text-[#8a96a3]")}>{mateLabel(m)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <label className="block text-[10.5px] text-[#4a5664]">
            {tr("Režim fáze")}
            <select data-phase-mode value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as Form["mode"] })} className="mt-0.5 w-full rounded border border-[#cfd6de] bg-white px-2 py-1 text-[12px]">
              <option value="">{tr("jako studie")}</option>
              <option value="kinematic">{tr("kinematika")}</option>
              <option value="quasistatic">{tr("kvazistatika")}</option>
            </select>
          </label>
          <div className="flex gap-1.5">
            <button type="button" data-phase-save onClick={save} className="flex-1 rounded bg-brand py-1 text-[12px] font-semibold text-white hover:bg-brand-600">
              {form.i === null ? tr("Přidat fázi") : tr("Uložit fázi")}
            </button>
            <button type="button" data-phase-cancel onClick={() => setForm(null)} className="rounded border border-[#cfd6de] bg-white px-2 text-[12px] hover:bg-[#f3f6f9]">
              {tr("Zrušit")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
