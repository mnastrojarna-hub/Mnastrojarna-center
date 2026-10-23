"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Flame, Layers, Plus, Scale, StickyNote, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AiMark, FieldLabel, Segmented } from "@/components/jobs/capture/capture-parts";
import {
  BLANK_SHAPE_OPTIONS, HARDNESS_UNITS, HEAT_KIND_OPTIONS, MATERIAL_GROUP_OPTIONS, SURFACE_KIND_OPTIONS, stepMissingHardness,
  type DrawingSpecState, type HeatStep, type SpecGroupKey, type SurfaceStep, type TreatmentStatus,
} from "@/lib/jobs/drawing-spec";
import { isMaterialGroupKey } from "@/lib/jobs/material-groups";
import type { BlankShape } from "@/lib/jobs/blank-weight";
import { cn } from "@/lib/utils";

const SELECT =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const WEIGHT_SOURCE_LABEL: Record<string, { label: string; tone: string }> = {
  vykres: { label: "z výkresu", tone: "text-emerald-700 dark:text-emerald-400" },
  odhad: { label: "odhad", tone: "text-amber-700 dark:text-amber-400" },
  rucne: { label: "ručně", tone: "text-sky-700 dark:text-sky-300" },
};

const STATUS_TEXT: Record<"heat" | "surface", Record<Exclude<TreatmentStatus, "uvedeno">, string>> = {
  heat: { bez: "Bez tepelného zpracování", nezjisteno: "Nezjištěno — doplň" },
  surface: { bez: "Bez povrchové úpravy", nezjisteno: "Nezjištěno — doplň" },
};

function move<T>(list: T[], i: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [x] = next.splice(i, 1);
  next.splice(to, 0, x);
  return next;
}

function StepButtons({ i, n, onMove, onRemove, disabled, what }: {
  i: number; n: number; onMove: (to: number) => void; onRemove: () => void; disabled?: boolean; what: string;
}) {
  const btn = "rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30";
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button type="button" className={btn} onClick={() => onMove(i - 1)} disabled={disabled || i === 0} aria-label={`${what} ${i + 1} nahoru`}><ArrowUp className="h-3.5 w-3.5" /></button>
      <button type="button" className={btn} onClick={() => onMove(i + 1)} disabled={disabled || i === n - 1} aria-label={`${what} ${i + 1} dolů`}><ArrowDown className="h-3.5 w-3.5" /></button>
      <button type="button" className={cn(btn, "hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10")} onClick={onRemove} disabled={disabled} aria-label={`Odebrat ${what.toLowerCase()} ${i + 1}`}><Trash2 className="h-3.5 w-3.5" /></button>
    </div>
  );
}

/** Blok úprav: výslovný stav (s úpravou / bez / nezjištěno) + kroky v pořadí. */
function TreatmentBlock<S extends HeatStep | SurfaceStep>({
  kind, status, steps, onChange, renderStep, emptyStep, idPrefix, ai, disabled,
}: {
  kind: "heat" | "surface";
  status: TreatmentStatus;
  steps: S[];
  onChange: (status: TreatmentStatus, steps: S[]) => void;
  renderStep: (s: S, set: (s: S) => void, id: string) => React.ReactNode;
  emptyStep: () => S;
  idPrefix: string;
  ai: boolean;
  disabled?: boolean;
}) {
  const title = kind === "heat" ? "Tepelné zpracování" : "Povrchová úprava";
  const what = kind === "heat" ? "Krok TZ" : "Krok PÚ";
  const Icon = kind === "heat" ? Flame : Layers;
  const shown: TreatmentStatus = steps.length ? "uvedeno" : status;
  return (
    <div className="space-y-2 rounded-lg border bg-background/60 p-2.5" data-testid={`spec-${kind}`} data-status={shown}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold"><Icon className="h-3.5 w-3.5 text-muted-foreground" /> {title} {ai && <AiMark />}</span>
        <Segmented<TreatmentStatus>
          value={shown}
          className="sm:w-auto"
          options={[
            { value: "uvedeno", label: "S úpravou" },
            { value: "bez", label: kind === "heat" ? "Bez TZ" : "Bez PÚ" },
            { value: "nezjisteno", label: "Nezjištěno" },
          ]}
          onChange={(v) => {
            if (disabled) return;
            if (v === "uvedeno") onChange("uvedeno", steps.length ? steps : [emptyStep()]);
            else onChange(v, []);
          }}
        />
      </div>
      {shown === "uvedeno" ? (
        <ol className="space-y-2">
          {steps.map((s, i) => (
            <li key={i} className="sm:flex sm:items-start sm:gap-1.5" data-testid={`spec-${kind}-step-${i}`}>
              {/* mobil: číslo a tlačítka nad poli (pole na celou šířku); počítač: vlevo / vpravo */}
              <div className="mb-1 flex items-center justify-between sm:contents">
                <span className="inline-flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground sm:mt-2">{i + 1}</span>
                <div className="sm:order-last">
                  <StepButtons
                    i={i} n={steps.length} what={what} disabled={disabled}
                    onMove={(to) => onChange("uvedeno", move(steps, i, to))}
                    onRemove={() => {
                      const next = steps.filter((_, j) => j !== i);
                      onChange(next.length ? "uvedeno" : "nezjisteno", next);
                    }}
                  />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                {renderStep(s, (ns) => onChange("uvedeno", steps.map((x, j) => (j === i ? ns : x))), `${idPrefix}-${kind}-${i}`)}
              </div>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => onChange("uvedeno", [...steps, emptyStep()])}
              disabled={disabled}
              className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs font-medium text-sky-700 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-500/10"
            >
              <Plus className="h-3.5 w-3.5" /> Přidat krok
            </button>
          </li>
        </ol>
      ) : (
        <p
          data-testid={`spec-${kind}-status-text`}
          className={cn(
            "rounded-md px-2.5 py-1.5 text-sm",
            shown === "bez" ? "border border-dashed text-muted-foreground" : "bg-amber-50 font-medium text-amber-900 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-100 dark:ring-amber-500/30",
          )}
        >
          {STATUS_TEXT[kind][shown]}
        </p>
      )}
    </div>
  );
}

/**
 * Sekce „Materiál a úpravy" kontroly výkresu: skupina materiálu, hmotnost dílu (z výkresu / odhad / ručně),
 * polotovar ≈ odhad (rozměr, tvar), tepelné zpracování a povrchové úpravy jako kroky v pořadí s hodnotami,
 * výslovný stav („Bez tepelného zpracování" / „Bez povrchové úpravy" / „Nezjištěno — doplň") a poznámky výkresu.
 */
export function CaptureDrawingSpec({
  spec, initial, aiUsed, onChange, idPrefix, disabled,
}: {
  spec: DrawingSpecState;
  /** Návrh AI (pro značku ✨ dokud ho člověk nezmění). */
  initial: DrawingSpecState | null;
  aiUsed: boolean;
  onChange: (s: DrawingSpecState) => void;
  idPrefix: string;
  disabled?: boolean;
}) {
  const edit = (k: SpecGroupKey, patch: Partial<DrawingSpecState>) =>
    onChange({ ...spec, ...patch, manual: spec.manual.includes(k) ? spec.manual : [...spec.manual, k] });
  const isAi = (k: SpecGroupKey) => aiUsed && Boolean(initial) && !spec.manual.includes(k);
  const ws = spec.weightKg.trim() ? WEIGHT_SOURCE_LABEL[spec.weightSource || "rucne"] : null;

  return (
    <section className="space-y-2.5 rounded-xl border border-dashed p-2.5 sm:p-3" data-testid="capture-drawing-spec">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Scale className="h-3.5 w-3.5" /> Materiál, hmotnost a úpravy
      </h4>

      <div className="grid gap-2.5 sm:grid-cols-2">
        <div>
          <FieldLabel htmlFor={`${idPrefix}-group`} extra={isAi("material_group") && spec.materialGroup ? <AiMark /> : undefined}>Skupina materiálu</FieldLabel>
          <select
            id={`${idPrefix}-group`}
            data-testid="spec-material-group"
            className={SELECT}
            value={spec.materialGroup}
            disabled={disabled}
            onChange={(e) => edit("material_group", { materialGroup: isMaterialGroupKey(e.target.value) ? e.target.value : "" })}
          >
            <option value="">Nezjištěno — doplň</option>
            {MATERIAL_GROUP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <FieldLabel
            htmlFor={`${idPrefix}-weight`}
            extra={ws ? <span className={cn("text-[10px] font-semibold", ws.tone)} data-testid="spec-weight-source">{ws.label}</span> : undefined}
          >
            Hmotnost dílu (kg)
          </FieldLabel>
          <Input
            id={`${idPrefix}-weight`}
            data-testid="spec-weight"
            inputMode="decimal"
            value={spec.weightKg}
            placeholder="neuvedeno"
            maxLength={20}
            disabled={disabled}
            onChange={(e) => edit("weight", { weightKg: e.target.value, weightSource: e.target.value.trim() ? "rucne" : "" })}
            autoComplete="off"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <div>
          <FieldLabel
            htmlFor={`${idPrefix}-blank`}
            extra={<span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">{spec.manual.includes("blank") ? "ručně" : "≈ odhad"}</span>}
          >
            Polotovar (kg)
          </FieldLabel>
          <Input
            id={`${idPrefix}-blank`}
            data-testid="spec-blank-weight"
            inputMode="decimal"
            value={spec.blankWeightKg}
            placeholder="nelze odhadnout"
            maxLength={20}
            disabled={disabled}
            onChange={(e) => edit("blank", { blankWeightKg: e.target.value })}
            autoComplete="off"
          />
        </div>
        <div>
          <FieldLabel htmlFor={`${idPrefix}-blank-dims`}>Rozměr polotovaru</FieldLabel>
          <Input
            id={`${idPrefix}-blank-dims`}
            data-testid="spec-blank-dims"
            value={spec.blankDims}
            placeholder="Ø70 × 130 mm"
            maxLength={120}
            disabled={disabled}
            onChange={(e) => edit("blank", { blankDims: e.target.value })}
            autoComplete="off"
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <FieldLabel htmlFor={`${idPrefix}-blank-shape`}>Tvar polotovaru</FieldLabel>
          <select
            id={`${idPrefix}-blank-shape`}
            className={SELECT}
            value={spec.blankShape}
            disabled={disabled}
            onChange={(e) => edit("blank", { blankShape: e.target.value as BlankShape | "" })}
          >
            <option value="">—</option>
            {BLANK_SHAPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>
      {spec.blankNote && !spec.manual.includes("blank") && (
        <p className="text-[11px] text-muted-foreground" data-testid="spec-blank-note">Odhad: {spec.blankNote}</p>
      )}

      <TreatmentBlock<HeatStep>
        kind="heat"
        status={spec.heatStatus}
        steps={spec.heatSteps}
        idPrefix={idPrefix}
        ai={isAi("heat")}
        disabled={disabled}
        emptyStep={() => ({ kind: "kaleni", value: "", unit: "HRC", depthMm: "", note: "" })}
        onChange={(heatStatus, heatSteps) => edit("heat", { heatStatus, heatSteps })}
        renderStep={(s, set, id) => {
          const missing = stepMissingHardness(s);
          return (
          <div className="space-y-1.5">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,6rem)_5.5rem] gap-1.5">
              <select aria-label="Druh tepelného zpracování" className={SELECT} value={s.kind} disabled={disabled} onChange={(e) => set({ ...s, kind: e.target.value as HeatStep["kind"] })}>
                {HEAT_KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <Input
                id={`${id}-value`} aria-label="Hodnota (tvrdost)" placeholder={missing ? "doplň" : "58±2"} value={s.value} maxLength={40} disabled={disabled}
                onChange={(e) => set({ ...s, value: e.target.value })} autoComplete="off"
                aria-invalid={missing || undefined} aria-describedby={missing ? `${id}-missing` : undefined}
                className={cn(missing && "border-amber-400 bg-amber-50/60 ring-1 ring-amber-300 dark:border-amber-500/50 dark:bg-amber-500/10")}
              />
              <select aria-label="Jednotka" className={SELECT} value={s.unit} disabled={disabled} onChange={(e) => set({ ...s, unit: e.target.value as HeatStep["unit"] })}>
                <option value="">—</option>
                {HARDNESS_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            {missing && (
              <p id={`${id}-missing`} data-testid="spec-heat-missing-hardness" className="text-[11px] font-medium text-amber-800 dark:text-amber-300">
                Tvrdost neuvedena — doplň (kolik HRC / HV)
              </p>
            )}
            <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-1.5">
              <Input aria-label="Hloubka vrstvy (mm)" placeholder="hloubka mm" value={s.depthMm} maxLength={30} disabled={disabled} onChange={(e) => set({ ...s, depthMm: e.target.value })} autoComplete="off" />
              <Input aria-label="Upřesnění" placeholder="upřesnění (vakuově, jen čep…)" value={s.note} maxLength={200} disabled={disabled} onChange={(e) => set({ ...s, note: e.target.value })} autoComplete="off" />
            </div>
          </div>
          );
        }}
      />

      <TreatmentBlock<SurfaceStep>
        kind="surface"
        status={spec.surfaceStatus}
        steps={spec.surfaceSteps}
        idPrefix={idPrefix}
        ai={isAi("surface")}
        disabled={disabled}
        emptyStep={() => ({ kind: "cerneni", spec: "", thicknessUm: "" })}
        onChange={(surfaceStatus, surfaceSteps) => edit("surface", { surfaceStatus, surfaceSteps })}
        renderStep={(s, set, id) => (
          <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5rem]">
            <select aria-label="Druh povrchové úpravy" className={cn(SELECT, "col-span-2 sm:col-span-1")} value={s.kind} disabled={disabled} onChange={(e) => set({ ...s, kind: e.target.value as SurfaceStep["kind"] })}>
              {SURFACE_KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <Input id={`${id}-spec`} aria-label="Specifikace" placeholder="specifikace (Fe/Zn 8…)" value={s.spec} maxLength={200} disabled={disabled} onChange={(e) => set({ ...s, spec: e.target.value })} autoComplete="off" />
            <Input aria-label="Tloušťka vrstvy (µm)" placeholder="µm" value={s.thicknessUm} maxLength={30} disabled={disabled} onChange={(e) => set({ ...s, thicknessUm: e.target.value })} autoComplete="off" />
          </div>
        )}
      />

      <div>
        <FieldLabel htmlFor={`${idPrefix}-notes`} extra={isAi("notes") && spec.notes ? <AiMark /> : undefined}>
          <span className="inline-flex items-center gap-1"><StickyNote className="h-3 w-3" /> Poznámky z výkresu (1 řádek = 1 poznámka)</span>
        </FieldLabel>
        <Textarea
          id={`${idPrefix}-notes`}
          data-testid="spec-notes"
          value={spec.notes}
          rows={Math.min(8, Math.max(2, spec.notes.split("\n").length))}
          maxLength={8000}
          placeholder="Technické požadavky, obecné tolerance, nekótované hrany…"
          disabled={disabled}
          onChange={(e) => edit("notes", { notes: e.target.value })}
          className="min-h-[56px]"
        />
      </div>
    </section>
  );
}
