"use client";

import { tr } from "@/cad/i18n";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { ALL_THREADS, FEATURE_LABEL, METRIC_THREADS, planeLabel, threadByName } from "@/cad/defaults";
import { getExt, type ExtParam } from "@/cad/ext/registry";
import { getExtUi } from "./ext/registry";
import { evalExpr, exprRefs, isExpression } from "@/cad/params";
import type { Axis, BoolMode, CadDoc, Feature, HoleKind, PlaneName, SketchEntity, Vec2, Vec3 } from "@/cad/types";
import { cn } from "@/lib/cn";
import type { Extent, HoleEnd } from "@/cad/types";
import { AxisField, DirectionField, ExtentField, PlaneDefField, RefListField, StartField, ThinField } from "./ref-field";
import "./forms/index";
import { getFeatureForm } from "./forms/registry";

// ---------- parametry (proměnné / rovnice) ----------

/** Průchozí díry ISO 273: jemná / střední / hrubá řada (mm). */
const ISO273: Record<string, [number, number, number]> = {
  M3: [3.2, 3.4, 3.6], M4: [4.3, 4.5, 4.8], M5: [5.3, 5.5, 5.8], M6: [6.4, 6.6, 7], M8: [8.4, 9, 10], M10: [10.5, 11, 12], M12: [13, 13.5, 14.5],
  M14: [15, 15.5, 16.5], M16: [17, 17.5, 18.5], M18: [19, 20, 21], M20: [21, 22, 24], M22: [23, 24, 26], M24: [25, 26, 28], M27: [28, 30, 32], M30: [31, 33, 35], M36: [37, 39, 42],
};
const FIT_IDX = { fine: 0, medium: 1, coarse: 2 } as const;

/** Sbalitelná sekce formuláře (pokročilé volby). */
export function Details({ summary, children, open }: { summary: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group rounded-lg border border-ink-700/10">
      <summary className="cursor-pointer select-none px-3 py-2 text-[12px] font-medium text-ink-700/75 marker:text-ink-700/40 group-open:border-b group-open:border-ink-700/10">{summary}</summary>
      <div className="space-y-3 p-3">{children}</div>
    </details>
  );
}

/** Kontext vazeb parametrů: klíč „featureId:cesta“ → výraz; hodnoty proměnných pro náhled. */
export const ParamContext = createContext<{
  bindings: Record<string, string>;
  values: Record<string, number>;
  setBinding: (key: string, expr: string | null) => void;
} | null>(null);

const round4 = (v: number) => Math.round(v * 1e4) / 1e4;
const fmtVal = (v: number) => String(round4(v)).replace(".", ",");

/** Uložený výraz → výraz zobrazený uživateli (u převodu průměr ↔ poloměr apod.). */
function unwrapExpr(stored: string, factor: number) {
  if (factor === 1) return stored;
  const m = /^\((.*)\) \* ([0-9.e-]+)$/.exec(stored);
  return m && Math.abs(Number(m[2]) - 1 / factor) < 1e-9 ? m[1] : `(${stored}) * ${round4(factor)}`;
}
const wrapExpr = (expr: string, factor: number) => (factor === 1 ? expr : `(${expr}) * ${1 / factor}`);

// ---------- základní pole ----------

/**
 * Číselné pole: přijímá i výrazy (25/2, 10+5*2). S `bind` a ParamContext lze parametr navázat
 * na proměnné („L/2“ nebo „=d*3“) – hodnota se pak přepočítá při každé změně proměnné.
 * `bindFactor`: zobrazená hodnota = uložená × factor (např. průměr z poloměru = 2).
 */
export function Num({
  label,
  value,
  onChange,
  step = 1,
  min,
  suffix = "mm",
  hint,
  bind,
  bindFactor = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  suffix?: string;
  hint?: string;
  bind?: string;
  bindFactor?: number;
}) {
  const ctx = useContext(ParamContext);
  const stored = bind && ctx ? ctx.bindings[bind] : undefined;
  const shownExpr = stored != null ? unwrapExpr(stored, bindFactor) : null;
  const [text, setText] = useState(shownExpr ?? String(round4(value)));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setText(shownExpr ?? String(round4(value)));
    setErr(null);
  }, [value, shownExpr]);

  let boundValue: number | null = null;
  if (shownExpr != null) {
    try {
      boundValue = evalExpr(shownExpr, ctx?.values ?? {});
    } catch {
      boundValue = null;
    }
  }

  const clamp = (v: number) => (min != null ? Math.max(min, v) : v);
  // průběžné potvrzení platného čísla (po 450 ms bez psaní): hodnota se neztratí, ani když pole neopustí fokus (OK, automatizace)
  const liveTimer = useRef<number | null>(null);
  const latest = useRef({ value, onChange, shownExpr });
  latest.current = { value, onChange, shownExpr };
  const cancelLive = () => {
    if (liveTimer.current != null) window.clearTimeout(liveTimer.current);
    liveTimer.current = null;
  };
  useEffect(() => cancelLive, []);
  const typed = (t: string) => {
    setText(t);
    cancelLive();
    if (!/^\s*-?\d+(?:[.,]\d+)?\s*$/.test(t)) return;
    liveTimer.current = window.setTimeout(() => {
      liveTimer.current = null;
      const v = clamp(parseFloat(t.replace(",", ".")));
      const cur = latest.current;
      if (Number.isFinite(v) && cur.shownExpr == null && Math.abs(v - cur.value) > 1e-12) cur.onChange(v);
    }, 450);
  };
  const commit = (t: string) => {
    cancelLive();
    if (!t.trim()) {
      setText(shownExpr ?? String(round4(value)));
      return;
    }
    // vazba na proměnné
    if (bind && ctx && isExpression(t) && exprRefs(t).length) {
      const e = t.trim().replace(/^=\s*/, "");
      try {
        evalExpr(e, ctx.values);
        setErr(null);
        ctx.setBinding(bind, wrapExpr(e, bindFactor));
      } catch (x) {
        setErr((x as Error).message);
      }
      return;
    }
    try {
      const v = clamp(evalExpr(t));
      setErr(null);
      if (stored != null && ctx && bind) ctx.setBinding(bind, null);
      onChange(v);
    } catch (x) {
      setErr(ctx ? (x as Error).message : null);
      if (!ctx) setText(String(round4(value)));
    }
  };
  const unbind = () => {
    if (!bind || !ctx) return;
    ctx.setBinding(bind, null);
    if (boundValue != null) onChange(clamp(boundValue));
  };

  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-ink-700/55">
        {label}
        {hint && <span className="normal-case tracking-normal text-ink-700/40">{hint}</span>}
      </span>
      <span
        className={cn(
          "flex items-center rounded-lg border bg-white focus-within:ring-2",
          err ? "border-brand ring-brand/15" : shownExpr != null ? "border-sky-500/60 bg-sky-50 focus-within:border-sky-600 focus-within:ring-sky-500/15" : "border-ink-700/12 focus-within:border-brand focus-within:ring-brand/15",
        )}
      >
        {shownExpr != null && (
          <button type="button" title={tr("Parametr je navázaný na proměnné – kliknutím vazbu zrušíte")} onClick={(e) => (e.preventDefault(), unbind())} className="ml-1.5 rounded bg-sky-600 px-1 font-mono text-[10px] font-bold italic text-white hover:bg-brand">
            ƒx
          </button>
        )}
        <input
          className="w-full min-w-0 bg-transparent px-2.5 py-1.5 font-mono text-[13px] text-ink-700 outline-none"
          value={text}
          inputMode={ctx ? "text" : "decimal"}
          spellCheck={false}
          aria-label={label}
          onChange={(e) => typed(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
            if (e.key === "Escape") {
              setText(shownExpr ?? String(round4(value)));
              setErr(null);
            }
            if ((e.key === "ArrowUp" || e.key === "ArrowDown") && shownExpr == null) {
              e.preventDefault();
              onChange(clamp(value + (e.key === "ArrowUp" ? step : -step) * (e.shiftKey ? 10 : 1)));
            }
          }}
        />
        {shownExpr != null && boundValue != null && <span className="whitespace-nowrap pr-1 font-mono text-[11px] text-sky-700">= {fmtVal(boundValue)}</span>}
        {suffix && <span className="pr-2.5 font-mono text-[11px] text-ink-700/40">{suffix}</span>}
      </span>
      {err && <span className="mt-1 block text-[11px] text-brand-600">{err}</span>}
    </label>
  );
}

export function Vec({ label, value, onChange, bind }: { label: string; value: Vec3 | Vec2; onChange: (v: never) => void; bind?: string }) {
  const names = ["X", "Y", "Z"];
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{label}</p>
      <div className={cn("grid gap-1.5", value.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
        {value.map((v, i) => (
          <Num key={i} label={names[i]} value={v} suffix="" bind={bind ? `${bind}.${i}` : undefined} onChange={(n) => onChange(value.map((x, k) => (k === i ? n : x)) as never)} />
        ))}
      </div>
    </div>
  );
}

export function Seg<T extends string>({ label, value, options, onChange }: { label?: string; value: T; options: { v: T; l: string }[]; onChange: (v: T) => void }) {
  return (
    <div>
      {label && <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{label}</p>}
      <div className="flex rounded-lg bg-steel-100 p-0.5">
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className={cn("flex-1 rounded-md px-2 py-1.5 text-[12px] font-medium transition", value === o.v ? "bg-white text-ink-700 shadow-sm" : "text-ink-700/55 hover:text-ink-700")}
          >
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-700">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="accent-[#E03930]" />
      {label}
    </label>
  );
}

const MODES: { v: BoolMode; l: string }[] = [
  { v: "add", l: tr("Přidat") },
  { v: "cut", l: tr("Odebrat") },
  { v: "intersect", l: tr("Průnik") },
];
export const AXES: { v: Axis; l: string }[] = [
  { v: "X", l: "X" },
  { v: "Y", l: "Y" },
  { v: "Z", l: "Z" },
];
/** Roviny kolmé na osu (pro řez, úkos): offset se měří ve směru osy. */
export const AXIS_PLANES: { v: PlaneName; l: string; axis: Axis }[] = [
  { v: "XY", l: tr("XY ⟂ Z"), axis: "Z" },
  { v: "XZ", l: tr("XZ ⟂ Y"), axis: "Y" },
  { v: "YZ", l: tr("YZ ⟂ X"), axis: "X" },
];
const HOLE_KINDS: { v: HoleKind; l: string }[] = [
  { v: "simple", l: tr("Vrtaná") },
  { v: "counterbore", l: tr("Válc. zahl.") },
  { v: "countersink", l: tr("Kuž. zahl.") },
  { v: "tapped", l: tr("Závit") },
];
const TOOL_TYPES = ["extrude", "revolve", "box", "cylinder", "sphere", "cone", "tube", "hole", "sweep", "loft", "text"];

const fmtMm = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", ",");

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{label}</span>
      {children}
    </label>
  );
}
export const selectCls = "w-full rounded-lg border border-ink-700/12 bg-white px-2 py-1.5 text-[13px] outline-none focus:border-brand";
export const Info = ({ children }: { children: React.ReactNode }) => <p className="rounded-lg bg-steel-100 p-3 text-[12px] leading-relaxed text-ink-700/70">{children}</p>;

// ---------- prvky ----------

/** Změna prvku: objekt, nebo funkce nad aktuálním stavem prvku (dvě rychlé změny po sobě se nepřepíší). */
export type FeaturePatch = Partial<Feature> | ((f: Feature) => Partial<Feature>);

export function FeatureProps({
  f,
  doc,
  onChange,
  pickHint,
}: {
  f: Feature;
  doc: CadDoc;
  onChange: (patch: FeaturePatch) => void;
  pickHint?: string;
}) {
  const set = (p: Record<string, unknown> | ((f: Feature) => Record<string, unknown>)) => onChange(p as FeaturePatch);
  const b = (path: string) => `${f.id}:${path}`;
  const idx = doc.features.findIndex((x) => x.id === f.id);
  const before = idx >= 0 ? doc.features.slice(0, idx) : doc.features;
  const sketches = before.filter((x) => x.type === "sketch");
  const toolFeatures = before.filter((x) => TOOL_TYPES.includes(x.type) && x.id !== f.id);
  const mode = "mode" in f ? <Seg label={tr("Operace")} value={f.mode === "new" ? "add" : f.mode} options={MODES} onChange={(v) => set({ mode: v })} /> : null;
  const custom = getFeatureForm(f.type);

  return (
    <div className="space-y-3.5">
      <Field label={tr("Název")}>
        <input className="w-full rounded-lg border border-ink-700/12 px-2.5 py-1.5 text-[13px] outline-none focus:border-brand" value={f.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      {(() => {
        if (custom) return custom({ f, doc, set, b, sketches, toolFeatures, mode, pickHint });
        switch (f.type) {
          case "ext":
            return <ExtForm f={f} doc={doc} set={set} sketches={sketches} toolFeatures={toolFeatures} />;
          case "sketch":
            return (
              <>
                <Info>Rovina: {planeLabel(f.plane)} · {f.entities.length} entit</Info>
                <PlaneDefField label={tr("Rovina skici (asociativní)")} value={f.planeDef} allowNone noneLabel={tr("Pevná rovina (jak byla založena)")} onChange={(planeDef) => set({ planeDef })} />
                {f.planeDef && <Info>{tr("Rovina se přepočítá při každé změně modelu (např. posune-li se plocha, na které skica leží).")}</Info>}
              </>
            );
          case "extrude": {
            const ext1: Extent = f.extent ?? (f.symmetric ? { kind: "midPlane", d: f.distance } : { kind: "blind", d: f.distance });
            return (
              <>
                <SketchPick value={f.sketchId} sketches={sketches} onChange={(v) => set({ sketchId: v })} />
                <ExtentField label={tr("Ukončení (směr 1)")} value={ext1} defaultDistance={f.distance} onChange={(extent) => set({ extent, distance: "d" in extent ? extent.d : f.distance, symmetric: extent.kind === "midPlane" })} />
                <div className="flex flex-wrap gap-4">
                  <Check label={tr("Opačný směr")} value={f.reverse} onChange={(v) => set({ reverse: v })} />
                  <Check label={tr("Druhý směr")} value={!!f.extent2} onChange={(on) => set({ extent2: on ? { kind: "blind", d: f.distance } : undefined })} />
                </div>
                {f.extent2 && <ExtentField label={tr("Ukončení (směr 2)")} value={f.extent2} defaultDistance={f.distance} kinds={["blind", "throughAll", "toNext", "toVertex", "toFace", "offsetFromFace", "toBody"]} onChange={(extent2) => set({ extent2 })} />}
                <Details summary={tr("Začátek, směr, tenká stěna, úkos, kroucení…")} open={!!(f.from || f.dir || f.thin || f.draftAngle || f.twist || f.endScale || f.outerOnly)}>
                  <StartField value={f.from} onChange={(from) => set({ from })} />
                  <DirectionField value={f.dir} onChange={(dir) => set({ dir })} />
                  <ThinField value={f.thin} onChange={(thin) => set({ thin })} />
                  <div className="grid grid-cols-3 gap-2">
                    <Num label={tr("Úkos")} value={f.draftAngle ?? 0} suffix="°" hint={tr("0 = bez úkosu")} bind={b("draftAngle")} onChange={(v) => set({ draftAngle: Math.max(-44, Math.min(44, v)) })} />
                    <Num label={tr("Kroucení")} value={f.twist ?? 0} suffix="°" bind={b("twist")} onChange={(v) => set({ twist: v })} />
                    <Num label={tr("Měřítko konce")} value={f.endScale ?? 1} suffix="×" min={0.01} step={0.1} bind={b("endScale")} onChange={(v) => set({ endScale: v })} />
                  </div>
                  <Check label={tr("Jen vnější obrys (ignorovat otvory profilu)")} value={!!f.outerOnly} onChange={(v) => set({ outerOnly: v })} />
                </Details>
                {mode}
              </>
            );
          }
          case "revolve":
            return (
              <>
                <SketchPick value={f.sketchId} sketches={sketches} onChange={(v) => set({ sketchId: v })} />
                <AxisField value={f.axisDef} sketch={sketches.find((x) => x.id === f.sketchId)} onChange={(axisDef) => set({ axisDef, axis: axisDef?.kind === "sketchX" ? "x" : "y" })} />
                <Num label={tr("Úhel")} value={f.angle} min={0.01} suffix="°" bind={b("angle")} onChange={(v) => set({ angle: Math.min(360, v) })} />
                <Seg
                  label={tr("Směr")}
                  value={f.symmetric ? "sym" : f.angle2 ? "two" : "one"}
                  options={[{ v: "one", l: tr("Jeden směr") }, { v: "sym", l: tr("Střední rovina") }, { v: "two", l: tr("Dva směry") }]}
                  onChange={(v) => set(v === "sym" ? { symmetric: true, angle2: undefined } : v === "two" ? { symmetric: false, angle2: f.angle2 ?? 90 } : { symmetric: false, angle2: undefined })}
                />
                {!!f.angle2 && !f.symmetric && <Num label={tr("Úhel (směr 2)")} value={f.angle2} min={0.01} suffix="°" bind={b("angle2")} onChange={(v) => set({ angle2: Math.min(360, v) })} />}
                <ThinField value={f.thin} onChange={(thin) => set({ thin })} />
                {mode}
              </>
            );
          case "sweep":
            return (
              <>
                <SketchPick label={tr("Profil (uzavřená skica)")} value={f.profileId} sketches={sketches} onChange={(v) => set({ profileId: v })} />
                <SketchPick label={tr("Dráha (křivka)")} value={f.pathId} sketches={sketches} onChange={(v) => set({ pathId: v })} />
                <Check label={tr("Natáčet profil podle křivky (Frenet)")} value={f.frenet} onChange={(v) => set({ frenet: v })} />
                <Info>{tr("Profil by měl ležet v rovině kolmé na začátek dráhy. Dráha může obsahovat úsečky, oblouky a lomené čáry – musí být souvislá.")}</Info>
                {mode}
              </>
            );
          case "loft": {
            const ids = f.sketchIds;
            const setIds = (next: string[]) => set({ sketchIds: next });
            return (
              <>
                <div>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{tr("Profily (v pořadí)")}</p>
                  <ol className="space-y-1.5">
                    {ids.map((id, k) => (
                      <li key={k} className="flex items-center gap-1.5">
                        <span className="w-5 text-center font-mono text-[11px] text-ink-700/45">{k + 1}</span>
                        <select className={selectCls} value={id} onChange={(e) => setIds(ids.map((x, j) => (j === k ? e.target.value : x)))}>
                          <option value="">{tr("— vyberte skicu —")}</option>
                          {sketches.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                        <button type="button" title={tr("Posunout nahoru")} disabled={!k} className="rounded px-1 text-ink-700/50 hover:text-ink-700 disabled:opacity-25" onClick={() => setIds(ids.map((x, j) => (j === k - 1 ? ids[k] : j === k ? ids[k - 1] : x)))}>
                          ↑
                        </button>
                        <button type="button" title={tr("Odebrat")} disabled={ids.length <= 2} className="rounded px-1 text-ink-700/50 hover:text-brand disabled:opacity-25" onClick={() => setIds(ids.filter((_, j) => j !== k))}>
                          ×
                        </button>
                      </li>
                    ))}
                  </ol>
                  <button type="button" className="mt-1.5 text-[12px] font-medium text-brand hover:underline" onClick={() => setIds([...ids, sketches.find((s) => !ids.includes(s.id))?.id ?? ""])}>
                    {tr("+ Přidat profil")}
                  </button>
                </div>
                <Check label={tr("Přímkové plochy (bez vyhlazení)")} value={f.ruled} onChange={(v) => set({ ruled: v })} />
                {mode}
              </>
            );
          }
          case "box":
            return (
              <>
                <Vec label={tr("Rozměry (X × Y × Z)")} value={f.size} bind={b("size")} onChange={(v) => set({ size: v })} />
                <Vec label={tr("Poloha")} value={f.position} bind={b("position")} onChange={(v) => set({ position: v })} />
                <Check label={tr("Poloha = střed kvádru")} value={f.centered} onChange={(v) => set({ centered: v })} />
                {mode}
              </>
            );
          case "cylinder":
            return (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Num label={tr("Průměr")} value={f.radius * 2} min={0.001} bind={b("radius")} bindFactor={2} onChange={(v) => set({ radius: v / 2 })} />
                  <Num label={tr("Výška")} value={f.height} min={0.001} bind={b("height")} onChange={(v) => set({ height: v })} />
                </div>
                <Seg label={tr("Osa")} value={f.axis} options={AXES} onChange={(v) => set({ axis: v })} />
                <Vec label={tr("Poloha podstavy")} value={f.position} bind={b("position")} onChange={(v) => set({ position: v })} />
                {mode}
              </>
            );
          case "sphere":
            return (
              <>
                <Num label={tr("Průměr")} value={f.radius * 2} min={0.001} bind={b("radius")} bindFactor={2} onChange={(v) => set({ radius: v / 2 })} />
                <Vec label={tr("Střed")} value={f.position} bind={b("position")} onChange={(v) => set({ position: v })} />
                {mode}
              </>
            );
          case "cone":
            return (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <Num label={tr("Ø dole")} value={f.radius1 * 2} min={0} bind={b("radius1")} bindFactor={2} onChange={(v) => set({ radius1: v / 2 })} />
                  <Num label={tr("Ø nahoře")} value={f.radius2 * 2} min={0} bind={b("radius2")} bindFactor={2} onChange={(v) => set({ radius2: v / 2 })} />
                  <Num label={tr("Výška")} value={f.height} min={0.001} bind={b("height")} onChange={(v) => set({ height: v })} />
                </div>
                <Seg label={tr("Osa")} value={f.axis} options={AXES} onChange={(v) => set({ axis: v })} />
                <Vec label={tr("Poloha podstavy")} value={f.position} bind={b("position")} onChange={(v) => set({ position: v })} />
                {mode}
              </>
            );
          case "tube":
            return (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <Num label={tr("Ø vnější")} value={f.outer} min={0.001} bind={b("outer")} onChange={(v) => set({ outer: v })} />
                  <Num label={tr("Ø vnitřní")} value={f.inner} min={0} bind={b("inner")} onChange={(v) => set({ inner: v })} />
                  <Num label={tr("Délka")} value={f.height} min={0.001} bind={b("height")} onChange={(v) => set({ height: v })} />
                </div>
                <Seg label={tr("Osa")} value={f.axis} options={AXES} onChange={(v) => set({ axis: v })} />
                <Vec label={tr("Poloha podstavy")} value={f.position} bind={b("position")} onChange={(v) => set({ position: v })} />
                {mode}
              </>
            );
          case "hole":
            return <HoleProps f={f} set={set} b={b} />;
          case "thread": {
            const t = threadByName(f.designation);
            return (
              <>
                <Field label={tr("Závit (ISO metrický – hrubé i jemné stoupání)")}>
                  <select className={selectCls} value={t?.name ?? ""} onChange={(e) => set({ designation: e.target.value })}>
                    {!t && <option value="">{tr("— vyberte —")}</option>}
                    {ALL_THREADS.map((x) => (
                      <option key={x.name} value={x.name}>
                        {x.name}{x.name.includes("×") ? "" : ` × ${fmtMm(x.pitch)}`}
                      </option>
                    ))}
                  </select>
                </Field>
                <Check label={tr("Vnitřní závit (v díře)")} value={!!f.internal} onChange={(v) => set({ internal: v })} />
                <Num label={tr("Délka závitu")} value={f.length} min={0.1} bind={b("length")} onChange={(v) => set({ length: v })} />
                <Seg label={tr("Osa")} value={f.axis} options={AXES} onChange={(v) => set({ axis: v })} />
                <Vec label={tr("Začátek závitu (na ose)")} value={f.position} bind={b("position")} onChange={(v) => set({ position: v })} />
                <Check label={tr("Modelovat závitové drážky")} value={f.modeled} onChange={(v) => set({ modeled: v })} />
                <Info>
                  {f.modeled
                    ? tr("Závit se vymodeluje jako drážky (zjednodušeně, bez stoupání) – vhodné pro vizualizaci a 3D tisk.")
                    : tr("Kosmetický závit: geometrie se nemění, závit se uvede ve výkrese. Doporučeno pro výrobní dokumentaci.")}
                  {t && tr(" Jmenovitý Ø {0} mm, stoupání {1} mm.", fmtMm(t.d), fmtMm(t.pitch))}
                </Info>
              </>
            );
          }
          case "fillet":
          case "chamfer":
            return (
              <>
                {f.type === "fillet" ? (
                  <Num label={tr("Poloměr")} value={f.radius} min={0.01} step={0.5} bind={b("radius")} onChange={(v) => set({ radius: v })} />
                ) : (
                  <Num label={tr("Velikost sražení")} value={f.distance} min={0.01} step={0.5} bind={b("distance")} onChange={(v) => set({ distance: v })} />
                )}
                <Seg label={tr("Hrany")} value={f.edges === "all" ? "all" : "pick"} options={[{ v: "pick", l: tr("Vybrané") }, { v: "all", l: tr("Všechny") }]} onChange={(v) => set({ edges: v === "all" ? "all" : [] })} />
                {f.edges !== "all" && <PickInfo n={f.edges.length} what="hran" hint={pickHint} onClear={() => set({ edges: [] })} />}
              </>
            );
          case "shell":
            return (
              <>
                <Num label={tr("Tloušťka stěny")} value={f.thickness} min={0.01} step={0.5} bind={b("thickness")} onChange={(v) => set({ thickness: v })} />
                <PickInfo n={f.faces.length} what={tr("otevřených ploch")} hint={pickHint} onClear={() => set({ faces: [] })} />
              </>
            );
          case "pushPull":
            return (
              <>
                <Num label={tr("Vzdálenost")} value={f.distance} step={0.5} hint={tr("+ ven · − dovnitř")} bind={b("distance")} onChange={(v) => set({ distance: v })} />
                <PickInfo n={f.faces.length} what={tr("rovinných ploch")} hint={pickHint} onClear={() => set({ faces: [] })} />
                <Info>{tr("Přímá úprava: plocha se posune po své normále. Kladná hodnota přidá materiál, záporná odebere.")}</Info>
              </>
            );
          case "offsetFace":
            return (
              <>
                <Num label={tr("Odsazení")} value={f.distance} step={0.1} hint={tr("+ ven · − dovnitř")} bind={b("distance")} onChange={(v) => set({ distance: v })} />
                <PickInfo n={f.faces.length} what={tr("ploch k odsazení")} hint={pickHint} onClear={() => set({ faces: [] })} />
                <Info>{tr("Funguje i na zakřivených plochách – např. odsazení stěny díry o +0,5 mm díru zmenší.")}</Info>
              </>
            );
          case "deleteFace":
            return (
              <>
                <PickInfo n={f.faces.length} what={tr("ploch k odstranění")} hint={pickHint} onClear={() => set({ faces: [] })} />
                <Info>{tr("Odstraní díry, čepy, kuželová zahloubení a válcová zaoblení (obnoví ostrou hranu). Vhodné pro úpravy importovaných modelů.")}</Info>
              </>
            );
          case "thicken":
            return (
              <>
                <Num label={tr("Tloušťka")} value={f.thickness} step={0.5} hint={tr("+ ven · − dovnitř")} bind={b("thickness")} onChange={(v) => set({ thickness: v })} />
                <PickInfo n={f.faces.length} what={tr("ploch k zesílení")} hint={pickHint} onClear={() => set({ faces: [] })} />
                {mode}
              </>
            );
          case "rib":
            return (
              <>
                <SketchPick label={tr("Čára žebra (otevřená skica)")} value={f.sketchId} sketches={sketches} onChange={(v) => set({ sketchId: v })} />
                <Num label={tr("Tloušťka")} value={f.thickness} min={0.01} step={0.5} bind={b("thickness")} onChange={(v) => set({ thickness: v })} />
                <Seg
                  label={tr("Směr tloušťky")}
                  value={f.direction}
                  options={[
                    { v: "normal", l: tr("Kolmo na skicu") },
                    { v: "inPlane", l: tr("V rovině skici") },
                  ]}
                  onChange={(v) => set({ direction: v })}
                />
                <Check label={tr("Obrátit stranu")} value={f.flip} onChange={(v) => set({ flip: v })} />
                <Info>{tr("Žebro se protáhne od čáry až k tělesu. Stranu, kde narazí na materiál, najde automaticky.")}</Info>
              </>
            );
          case "spring":
            return (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Num label={tr("Průměr pružiny")} value={f.radius * 2} min={0.01} bind={b("radius")} bindFactor={2} onChange={(v) => set({ radius: v / 2 })} />
                  <Num label={tr("Průměr drátu")} value={f.wire} min={0.01} step={0.1} bind={b("wire")} onChange={(v) => set({ wire: v })} />
                  <Num label={tr("Stoupání")} value={f.pitch} min={0.01} step={0.5} bind={b("pitch")} onChange={(v) => set({ pitch: v })} />
                  <Num label={tr("Počet závitů")} value={f.turns} min={0.25} step={0.5} suffix="" bind={b("turns")} onChange={(v) => set({ turns: v })} />
                </div>
                <Info>{tr("Volná délka")}{" "}{Math.round(f.pitch * f.turns * 100) / 100} mm</Info>
                <Seg label={tr("Osa")} value={f.axis} options={AXES} onChange={(v) => set({ axis: v })} />
                <Vec label={tr("Poloha")} value={f.position} bind={b("position")} onChange={(v) => set({ position: v })} />
                {mode}
              </>
            );
          case "draft":
            return (
              <>
                <Num label={tr("Úhel úkosu")} value={f.angle} suffix="°" step={0.5} bind={b("angle")} onChange={(v) => set({ angle: Math.max(-44, Math.min(44, v)) })} />
                <PlaneDefField label={tr("Neutrální rovina")} value={f.planeDef} allowNone noneLabel={tr("Základní rovina (níže)")} onChange={(planeDef) => set({ planeDef })} />
                {!f.planeDef && (
                  <>
                    <Seg label={tr("Základní rovina")} value={f.plane} options={AXIS_PLANES} onChange={(v) => set({ plane: v })} />
                    <Num label={tr("Poloha roviny ({0})", AXIS_PLANES.find((p) => p.v === f.plane)?.axis)} value={f.offset} bind={b("offset")} onChange={(v) => set({ offset: v })} />
                  </>
                )}
                <PickInfo n={f.faces.length} what={tr("ploch ke zkosení")} hint={pickHint} onClear={() => set({ faces: [] })} />
              </>
            );
          case "split": {
            const ax = AXIS_PLANES.find((p) => p.v === f.plane)?.axis ?? "Z";
            return (
              <>
                <PlaneDefField label={tr("Řezná rovina")} value={f.planeDef} allowNone noneLabel={tr("Základní rovina (níže)")} onChange={(planeDef) => set({ planeDef })} />
                {!f.planeDef && (
                  <>
                    <Seg label={tr("Základní rovina")} value={f.plane} options={AXIS_PLANES} onChange={(v) => set({ plane: v })} />
                    <Num label={tr("Poloha roviny ({0})", ax)} value={f.offset} bind={b("offset")} onChange={(v) => set({ offset: v })} />
                  </>
                )}
                <Seg label={tr("Ponechat")} value={f.keep} options={[{ v: "negative", l: f.planeDef ? tr("Proti normále") : tr("Stranu −{0}", ax) }, { v: "positive", l: f.planeDef ? tr("Ve směru normály") : tr("Stranu +{0}", ax) }]} onChange={(v) => set({ keep: v })} />
              </>
            );
          }
          case "transform":
            return (
              <>
                <Vec label={tr("Posunutí")} value={f.translate} bind={b("translate")} onChange={(v) => set({ translate: v })} />
                <div className="grid grid-cols-2 gap-2">
                  <Num label={tr("Otočení")} value={f.rotateAngle} suffix="°" bind={b("rotateAngle")} onChange={(v) => set({ rotateAngle: v })} />
                  <Num label={tr("Měřítko")} value={f.scale} min={0.0001} step={0.1} suffix="×" bind={b("scale")} onChange={(v) => set({ scale: v })} />
                </div>
                <Seg label={tr("Osa otočení (přes počátek)")} value={f.rotateAxis} options={AXES} onChange={(v) => set({ rotateAxis: v })} />
                <Info>{tr("Pořadí: měřítko → otočení → posunutí, vše vůči počátku souřadnic.")}</Info>
              </>
            );
          case "datum":
            return (
              <>
                <PlaneDefField label={tr("Definice roviny")} value={f.planeDef} allowNone noneLabel={tr("Ručně (počátek a normála níže)")} onChange={(planeDef) => set({ planeDef })} />
                {f.planeDef && <Info>{tr("Počátek a normála níže se dopočítají z definice při každé změně modelu.")}</Info>}
                <Vec label={tr("Počátek")} value={f.origin} bind={b("origin")} onChange={(v) => set({ origin: v })} />
                <Vec label={tr("Normála")} value={f.normal} onChange={(v) => set({ normal: v })} />
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ["⟂ X", [1, 0, 0], [0, 1, 0]],
                      ["⟂ Y", [0, 1, 0], [1, 0, 0]],
                      ["⟂ Z", [0, 0, 1], [1, 0, 0]],
                    ] as [string, Vec3, Vec3][]
                  ).map(([l, n, x]) => (
                    <button key={l} type="button" onClick={() => set({ normal: n, xDir: x })} className="rounded-full border border-ink-700/15 px-2 py-0.5 font-mono text-[11px] text-ink-700/70 hover:border-ink-700/40">
                      {l}
                    </button>
                  ))}
                </div>
                <Num label={tr("Velikost zobrazení")} value={f.size} min={1} bind={b("size")} onChange={(v) => set({ size: v })} />
                <Info>{tr("Pomocná rovina nevytváří geometrii. Použijte ji pro novou skicu (Nová skica → pomocná rovina).")}</Info>
              </>
            );
          case "text":
            return (
              <>
                <Field label={tr("Text")}>
                  <input className="w-full rounded-lg border border-ink-700/12 px-2.5 py-1.5 text-[13px] outline-none focus:border-brand" value={f.text} maxLength={120} onChange={(e) => set({ text: e.target.value })} />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Num label={tr("Výška písma")} value={f.height} min={0.5} bind={b("height")} onChange={(v) => set({ height: v })} />
                  <Num label={tr("Hloubka")} value={f.depth} min={0.01} step={0.1} bind={b("depth")} onChange={(v) => set({ depth: v })} />
                </div>
                <Seg label={tr("Způsob")} value={f.mode} options={[{ v: "cut", l: tr("Gravírovat") }, { v: "add", l: tr("Vystoupit") }]} onChange={(v) => set({ mode: v })} />
                {f.plane.kind === "base" ? (
                  <div className="grid grid-cols-[1fr_96px] items-end gap-2">
                    <Seg label={tr("Rovina")} value={f.plane.name} options={[{ v: "XY", l: "XY" }, { v: "XZ", l: "XZ" }, { v: "YZ", l: "YZ" }]} onChange={(v) => set({ plane: { kind: "base", name: v, offset: f.plane.kind === "base" ? f.plane.offset : 0 } })} />
                    <Num label={tr("Odsazení")} value={f.plane.offset} bind={b("plane.offset")} onChange={(v) => set({ plane: { ...f.plane, offset: v } })} />
                  </div>
                ) : (
                  <Info>Rovina: {planeLabel(f.plane)}</Info>
                )}
                <Vec label={tr("Střed textu (v rovině)")} value={f.position} bind={b("position")} onChange={(v) => set({ position: v })} />
                <Num label={tr("Natočení")} value={f.angle} suffix="°" bind={b("angle")} onChange={(v) => set({ angle: v })} />
              </>
            );
          case "pattern": {
            const pcount = "count" in f ? f.count : 4;
            return (
              <>
                <Field label={tr("Opakovaný prvek")}>
                  <select className={selectCls} value={f.featureId} onChange={(e) => set({ featureId: e.target.value })}>
                    <option value="">{tr("— vyberte —")}</option>
                    {toolFeatures.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Seg
                  label={tr("Typ pole")}
                  value={f.kind}
                  options={[{ v: "linear", l: tr("Lineární") }, { v: "circular", l: tr("Kruhové") }]}
                  onChange={(v) =>
                    set(v === "linear" ? { kind: v, spacing: 20, direction: [1, 0, 0], count: pcount } : { kind: v, angle: 360, axis: "Z", center: [0, 0, 0], count: pcount })
                  }
                />
                {f.kind === "linear" ? (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <Num label={tr("Počet kusů")} value={f.count} min={1} suffix="ks" bind={b("count")} onChange={(v) => set({ count: Math.round(v) })} />
                      <Num label={tr("Rozteč")} value={f.spacing} bind={b("spacing")} onChange={(v) => set({ spacing: v })} />
                    </div>
                    <Vec label={tr("Směr 1")} value={f.direction} onChange={(v) => set({ direction: v })} />
                    <Check
                      label={tr("Druhý směr (mřížka)")}
                      value={(f.count2 ?? 1) > 1}
                      onChange={(on) => set(on ? { count2: 2, spacing2: f.spacing2 ?? f.spacing, direction2: f.direction2 ?? (Math.abs(f.direction[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]) } : { count2: 1 })}
                    />
                    {(f.count2 ?? 1) > 1 && (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          <Num label={tr("Počet (směr 2)")} value={f.count2 ?? 2} min={1} suffix="ks" bind={b("count2")} onChange={(v) => set({ count2: Math.round(v) })} />
                          <Num label={tr("Rozteč (směr 2)")} value={f.spacing2 ?? f.spacing} bind={b("spacing2")} onChange={(v) => set({ spacing2: v })} />
                        </div>
                        <Vec label={tr("Směr 2")} value={f.direction2 ?? [0, 1, 0]} onChange={(v) => set({ direction2: v })} />
                      </>
                    )}
                  </>
                ) : f.kind !== "circular" ? (
                  <Info>{tr("Tento typ pole (po křivce / podle skici / výplňové) připravuje modul polí.")}</Info>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <Num label={tr("Počet kusů")} value={f.count} min={2} suffix="ks" bind={b("count")} onChange={(v) => set({ count: Math.round(v) })} />
                      <Num label={tr("Celkový úhel")} value={f.angle} suffix="°" min={1} bind={b("angle")} onChange={(v) => set({ angle: Math.min(360, v) })} />
                    </div>
                    <Seg label={tr("Osa")} value={f.axis} options={AXES} onChange={(v) => set({ axis: v })} />
                    <Vec label={tr("Střed")} value={f.center} bind={b("center")} onChange={(v) => set({ center: v })} />
                  </>
                )}
              </>
            );
          }
          case "mirror":
            return (
              <>
                <PlaneDefField label={tr("Rovina zrcadlení")} value={f.planeDef} allowNone noneLabel={tr("Základní rovina (níže)")} onChange={(planeDef) => set({ planeDef })} />
                {!f.planeDef && (
                  <>
                    <Seg label={tr("Základní rovina")} value={f.plane} options={[{ v: "YZ", l: "YZ" }, { v: "XZ", l: "XZ" }, { v: "XY", l: "XY" }]} onChange={(v) => set({ plane: v })} />
                    <Num label={tr("Posunutí roviny")} value={f.offset} bind={b("offset")} onChange={(v) => set({ offset: v })} />
                  </>
                )}
                <Check label={tr("Ponechat originál (sloučit)")} value={f.keepOriginal} onChange={(v) => set({ keepOriginal: v })} />
              </>
            );
          case "import":
            return <Info>{tr("Importovaný soubor:")}{" "}{f.fileName} ({f.format.toUpperCase()}{tr("). Na model můžete navázat dalšími prvky (díry, zaoblení, odebrání…).")}</Info>;
        }
      })()}
    </div>
  );
}

/** Průvodce dírou (jako „Díra“ v ZW3D/Inventoru): typ, závit nebo šroub, zahloubení. */
function HoleProps({ f, set, b }: { f: Extract<Feature, { type: "hole" }>; set: (p: Record<string, unknown>) => void; b: (p: string) => string }) {
  const kind: HoleKind = f.kind ?? (f.cbDiameter > f.diameter && f.cbDepth > 0 ? "counterbore" : "simple");
  const thread = threadByName(f.thread);
  const forScrew = METRIC_THREADS.find((t) => Math.abs(t.clear - f.diameter) < 1e-6);
  const changeKind = (k: HoleKind) => {
    const t = forScrew ?? METRIC_THREADS.find((x) => x.name === "M8")!;
    if (k === "tapped") return set({ kind: k, thread: f.thread && threadByName(f.thread) ? f.thread : t.name, threadDepth: f.threadDepth ?? 0 });
    if (k === "counterbore") return set({ kind: k, diameter: forScrew ? f.diameter : t.clear, cbDiameter: f.cbDiameter > f.diameter ? f.cbDiameter : t.cb?.[0] ?? t.clear * 1.8, cbDepth: f.cbDepth > 0 ? f.cbDepth : t.cb?.[1] ?? t.d });
    if (k === "countersink") return set({ kind: k, diameter: forScrew ? f.diameter : t.clear, csDiameter: (f.csDiameter ?? 0) > f.diameter ? f.csDiameter : t.cs ?? t.clear * 2, csAngle: f.csAngle ?? 90 });
    set({ kind: k });
  };
  const fit = f.fit ?? "medium";
  const clearOf = (t: { name: string; clear: number }, ft = fit) => ISO273[t.name]?.[FIT_IDX[ft]] ?? t.clear;
  const forScrewFit = METRIC_THREADS.find((t) => Math.abs(clearOf(t) - f.diameter) < 1e-6) ?? forScrew;
  const pickScrew = (name: string, ft = fit) => {
    const t = threadByName(name);
    if (!t) return;
    const dia = clearOf(t, ft);
    if (kind === "counterbore") set({ diameter: dia, cbDiameter: t.cb?.[0] ?? dia * 1.8, cbDepth: t.cb?.[1] ?? t.d, fit: ft });
    else if (kind === "countersink") set({ diameter: dia, csDiameter: t.cs ?? dia * 2, fit: ft });
    else set({ diameter: dia, fit: ft });
  };
  const end: HoleEnd = f.end ?? (f.depth > 0 ? { kind: "blind" } : { kind: "throughAll" });
  const endExt: Extent = end.kind === "blind" ? { kind: "blind", d: f.depth || 10 } : end.kind === "toFace" ? { kind: "toFace", ref: end.ref, offset: end.offset } : { kind: end.kind };
  const setEnd = (e: Extent) => {
    if (e.kind === "blind") return set({ end: { kind: "blind" }, depth: e.d });
    if (e.kind === "throughAll") return set({ end: { kind: "throughAll" }, depth: 0 });
    if (e.kind === "toFace") return set({ end: { kind: "toFace", ref: e.ref, offset: e.offset } });
    if (e.kind === "toNext") return set({ end: { kind: "toNext" } });
  };
  return (
    <>
      <Seg label={tr("Typ díry")} value={kind} options={HOLE_KINDS} onChange={changeKind} />
      {kind === "tapped" ? (
        <>
          <Field label={tr("Závit (hrubé i jemné stoupání)")}>
            <select className={selectCls} value={thread && ALL_THREADS.some((x) => x.name === thread.name) ? thread.name : "custom"} onChange={(e) => e.target.value !== "custom" && set({ thread: e.target.value, diameter: threadByName(e.target.value)?.tap ?? f.diameter })}>
              {!(thread && ALL_THREADS.some((x) => x.name === thread.name)) && <option value="custom">{thread ? tr("{0} (vlastní stoupání)", thread.name) : tr("— vyberte nebo zadejte níže —")}</option>}
              {ALL_THREADS.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}{t.name.includes("×") ? "" : ` × ${fmtMm(t.pitch)}`} {tr("· vrták Ø")}{fmtMm(t.tap)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tr("Označení závitu (text)")}>
            <input className="w-full rounded-lg border border-ink-700/12 px-2.5 py-1.5 font-mono text-[13px] outline-none focus:border-brand" aria-label={tr("Označení závitu díry")} value={f.thread ?? ""} placeholder={tr("např. M18×1,5")} onChange={(e) => { const t = threadByName(e.target.value); set(t ? { thread: e.target.value, diameter: t.tap } : { thread: e.target.value }); }} />
            {!thread && (f.thread ?? "").trim() && <span className="mt-1 block text-[11px] text-brand-600">{tr("Neznámé označení – M2 až M48, volitelně se stoupáním (M18×1,5).")}</span>}
          </Field>
          <Num label={tr("Hloubka závitu")} value={f.threadDepth ?? 0} min={0} hint={tr("0 = celá")} bind={b("threadDepth")} onChange={(v) => set({ threadDepth: v })} />
          {thread && <Info>{tr("Vrtá se jádrový průměr Ø")}{fmtMm(thread.tap)} {tr("mm, závit")}{" "}{thread.name} {tr("se uvede ve výkrese.")}</Info>}
        </>
      ) : (
        <>
          <Field label={tr("Pro šroub (průchozí díra ISO 273)")}>
            <select className={selectCls} value={forScrewFit?.name ?? ""} onChange={(e) => pickScrew(e.target.value)}>
              <option value="">{tr("— vlastní průměr —")}</option>
              {METRIC_THREADS.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name} {tr("· Ø")}{fmtMm(clearOf(t))}
                </option>
              ))}
            </select>
          </Field>
          <Seg label={tr("Řada ISO 273")} value={fit} options={[{ v: "fine", l: tr("Jemná") }, { v: "medium", l: tr("Střední") }, { v: "coarse", l: tr("Hrubá") }]} onChange={(v) => (forScrewFit ? pickScrew(forScrewFit.name, v) : set({ fit: v }))} />
          <Num label={tr("Průměr")} value={f.diameter} min={0.01} bind={b("diameter")} onChange={(v) => set({ diameter: v })} />
          {kind === "counterbore" && (
            <div className="grid grid-cols-2 gap-2">
              <Num label={tr("Ø zahloubení")} value={f.cbDiameter} min={0} bind={b("cbDiameter")} onChange={(v) => set({ cbDiameter: v })} />
              <Num label={tr("Hl. zahloubení")} value={f.cbDepth} min={0} bind={b("cbDepth")} onChange={(v) => set({ cbDepth: v })} />
            </div>
          )}
          {kind === "countersink" && (
            <div className="grid grid-cols-2 gap-2">
              <Num label={tr("Ø zahloubení")} value={f.csDiameter ?? 0} min={0} bind={b("csDiameter")} onChange={(v) => set({ csDiameter: v })} />
              <Num label={tr("Úhel")} value={f.csAngle ?? 90} min={30} suffix="°" bind={b("csAngle")} onChange={(v) => set({ csAngle: Math.min(170, v) })} />
            </div>
          )}
        </>
      )}
      <ExtentField label={tr("Ukončení")} value={endExt} kinds={["blind", "throughAll", "toNext", "toFace"]} defaultDistance={f.depth || 10} onChange={setEnd} />
      {end.kind === "blind" && <Num label={tr("Úhel špičky vrtáku")} value={f.tipAngle ?? 118} min={60} suffix="°" bind={b("tipAngle")} onChange={(v) => set({ tipAngle: Math.min(170, v) })} />}
      {!f.points?.length && <Vec label={tr("Bod na povrchu")} value={f.position} bind={b("position")} onChange={(v) => set({ position: v })} />}
      <RefListField label={tr("Polohy děr (více naráz)")} value={f.points ?? []} onChange={(points) => set({ points: points.length ? points : undefined })} />
      <DirectionField label={tr("Osa díry")} allowNormal={false} value={f.dirDef ?? { kind: "axis", axis: f.axis }} onChange={(d) => (!d || d.kind === "axis" ? set({ axis: d?.axis ?? f.axis, dirDef: undefined }) : set({ dirDef: d }))} />
      <Check label={tr("Vrtat v kladném směru osy")} value={f.flip} onChange={(v) => set({ flip: v })} />
      <p className="text-[11px] text-ink-700/50">{tr("Tip: klikněte na plochu modelu – bod a osa se doplní automaticky. Více děr: „Přidat body klikem“ (vrcholy, středy kružnic, body skici přes pravé tlačítko).")}</p>
    </>
  );
}

export function SketchPick({ value, sketches, onChange, label = "Profil (skica)" }: { value: string; sketches: Feature[]; onChange: (v: string) => void; label?: string }) {
  return (
    <Field label={label}>
      <select className={selectCls} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{tr("— vyberte skicu —")}</option>
        {sketches.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function PickInfo({ n, what, hint, onClear }: { n: number; what: string; hint?: string; onClear: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-brand/40 bg-brand/5 p-3 text-[12px] text-ink-700">
      <p>
        <strong>{n}</strong> {what} {tr("vybráno.")}{" "}{hint ?? tr("Klikáním v modelu přidáváte / odebíráte.")}
      </p>
      {n > 0 && (
        <button type="button" onClick={onClear} className="mt-1 text-brand underline">
          {tr("Zrušit výběr")}
        </button>
      )}
    </div>
  );
}

// ---------- entity skici ----------

export function EntityProps({ e, onChange }: { e: SketchEntity; onChange: (n: SketchEntity) => void }) {
  const set = (p: Partial<SketchEntity>) => onChange({ ...e, ...p } as SketchEntity);
  const title = { line: tr("Úsečka"), arc: tr("Oblouk"), rect: tr("Obdélník"), circle: tr("Kružnice"), polygon: tr("Mnohoúhelník"), slot: tr("Drážka"), polyline: tr("Lomená čára"), point: tr("Bod"), ellipse: tr("Elipsa"), spline: tr("Spline") }[e.type];
  const arcInfo = e.type === "arc" ? arcGeomInfo(e.a, e.b, e.c) : null;
  return (
    <div className="space-y-3">
      <p className="text-[12px] font-semibold uppercase tracking-wider text-brand">{title}</p>
      {e.type === "line" && (
        <>
          <Vec label={tr("Počátek")} value={e.a} onChange={(v) => set({ a: v })} />
          <Vec label={tr("Konec")} value={e.b} onChange={(v) => set({ b: v })} />
          <LineLength e={e} onChange={onChange} />
        </>
      )}
      {e.type === "point" && <Vec label={tr("Poloha")} value={e.p} onChange={(v) => set({ p: v })} />}
      {e.type === "ellipse" && (
        <>
          <Vec label={tr("Střed")} value={[e.cx, e.cy]} onChange={(v: Vec2) => set({ cx: v[0], cy: v[1] })} />
          <div className="grid grid-cols-2 gap-2">
            <Num label={tr("Hlavní poloosa")} value={e.rx} min={0.001} onChange={(v) => set({ rx: v })} />
            <Num label={tr("Vedlejší poloosa")} value={e.ry} min={0.001} onChange={(v) => set({ ry: v })} />
          </div>
          <Num label={tr("Natočení")} value={e.angle} suffix="°" onChange={(v) => set({ angle: v })} />
        </>
      )}
      {(e.type === "spline" || e.type === "polyline") && (
        <>
          <div className="max-h-60 space-y-1.5 overflow-y-auto pr-1">
            {e.points.map((pt, i) => (
              <Vec key={i} label={tr("Bod {0}", i + 1)} value={pt} onChange={(v: Vec2) => set({ points: e.points.map((q, k) => (k === i ? v : q)) } as Partial<SketchEntity>)} />
            ))}
          </div>
          <Check label={tr("Uzavřená")} value={e.closed} onChange={(v) => set({ closed: v } as Partial<SketchEntity>)} />
        </>
      )}
      {e.type === "arc" && (
        <>
          <Vec label={tr("Počátek")} value={e.a} onChange={(v) => set({ a: v })} />
          <Vec label={tr("Bod na oblouku")} value={e.b} onChange={(v) => set({ b: v })} />
          <Vec label={tr("Konec")} value={e.c} onChange={(v) => set({ c: v })} />
          {arcInfo && (
            <p className="font-mono text-[11.5px] text-ink-700/60">
              R {Math.round(arcInfo.r * 1000) / 1000} {tr("· střed")}{" "}{Math.round(arcInfo.c[0] * 100) / 100} ; {Math.round(arcInfo.c[1] * 100) / 100}
            </p>
          )}
        </>
      )}
      {e.type === "circle" && (
        <>
          <Vec label={tr("Střed")} value={[e.cx, e.cy]} onChange={(v: Vec2) => set({ cx: v[0], cy: v[1] })} />
          <Num label={tr("Průměr")} value={e.r * 2} min={0.001} onChange={(v) => set({ r: v / 2 })} />
        </>
      )}
      {e.type === "rect" && (
        <>
          <Vec label={tr("Střed")} value={[e.cx, e.cy]} onChange={(v: Vec2) => set({ cx: v[0], cy: v[1] })} />
          <div className="grid grid-cols-2 gap-2">
            <Num label={tr("Šířka")} value={e.w} min={0.001} onChange={(v) => set({ w: v })} />
            <Num label={tr("Výška")} value={e.h} min={0.001} onChange={(v) => set({ h: v })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Num label={tr("Zaoblení rohů")} value={e.r} min={0} onChange={(v) => set({ r: v })} />
            <Num label={tr("Natočení")} value={e.angle} suffix="°" onChange={(v) => set({ angle: v })} />
          </div>
        </>
      )}
      {e.type === "polygon" && (
        <>
          <Vec label={tr("Střed")} value={[e.cx, e.cy]} onChange={(v: Vec2) => set({ cx: v[0], cy: v[1] })} />
          <div className="grid grid-cols-2 gap-2">
            <Num label={tr("Počet stran")} value={e.sides} min={3} suffix="" onChange={(v) => set({ sides: Math.round(v) })} />
            <Num label={tr("Opsaný průměr")} value={e.r * 2} min={0.001} onChange={(v) => set({ r: v / 2 })} />
          </div>
          <Num label={tr("Rozměr přes plochy")} value={2 * e.r * Math.cos(Math.PI / Math.max(3, e.sides))} min={0.001} onChange={(v) => set({ r: v / 2 / Math.cos(Math.PI / Math.max(3, e.sides)) })} />
          <Num label={tr("Natočení")} value={e.angle} suffix="°" onChange={(v) => set({ angle: v })} />
        </>
      )}
      {e.type === "slot" && (
        <>
          <Vec label={tr("Střed")} value={[e.cx, e.cy]} onChange={(v: Vec2) => set({ cx: v[0], cy: v[1] })} />
          <div className="grid grid-cols-2 gap-2">
            <Num label={tr("Celková délka")} value={e.length} min={0.001} onChange={(v) => set({ length: v })} />
            <Num label={tr("Šířka")} value={e.width} min={0.001} onChange={(v) => set({ width: v })} />
          </div>
          <Num label={tr("Natočení")} value={e.angle} suffix="°" onChange={(v) => set({ angle: v })} />
        </>
      )}
      <Check label={tr("Pomocná geometrie (netvoří profil)")} value={!!e.construction} onChange={(v) => set({ construction: v })} />
    </div>
  );
}

function arcGeomInfo(a: Vec2, b: Vec2, c: Vec2): { c: Vec2; r: number } | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12) return null;
  const s = (p: Vec2) => p[0] * p[0] + p[1] * p[1];
  const ux = (s(a) * (b[1] - c[1]) + s(b) * (c[1] - a[1]) + s(c) * (a[1] - b[1])) / d;
  const uy = (s(a) * (c[0] - b[0]) + s(b) * (a[0] - c[0]) + s(c) * (b[0] - a[0])) / d;
  return { c: [ux, uy], r: Math.hypot(a[0] - ux, a[1] - uy) };
}

function LineLength({ e, onChange }: { e: Extract<SketchEntity, { type: "line" }>; onChange: (n: SketchEntity) => void }) {
  const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
  const ang = (Math.atan2(e.b[1] - e.a[1], e.b[0] - e.a[0]) * 180) / Math.PI;
  const setPolar = (l: number, a: number) => {
    const t = (a * Math.PI) / 180;
    onChange({ ...e, b: [Math.round((e.a[0] + l * Math.cos(t)) * 1e4) / 1e4, Math.round((e.a[1] + l * Math.sin(t)) * 1e4) / 1e4] });
  };
  return (
    <div className="grid grid-cols-2 gap-2">
      <Num label={tr("Délka")} value={len} min={0.001} onChange={(v) => setPolar(v, ang)} />
      <Num label={tr("Úhel")} value={ang} suffix="°" onChange={(v) => setPolar(len, v)} />
    </div>
  );
}

export { FEATURE_LABEL };

// ---------- prvky rozšíření: formulář z registru nebo automaticky z params ----------

function ExtForm({ f, doc, set, sketches, toolFeatures }: { f: Extract<Feature, { type: "ext" }>; doc: CadDoc; set: (p: Record<string, unknown> | ((f: Feature) => Record<string, unknown>)) => void; sketches: Feature[]; toolFeatures: Feature[] }) {
  const def = getExt(f.ext);
  const ui = getExtUi(f.ext);
  const data = f.data ?? {};
  // funkčně nad aktuálními daty prvku – změna hloubky těsně následovaná jinou změnou se nepřepíše zastaralou kopií
  const patch = (p: Record<string, unknown>) => set((cur) => ({ data: { ...((cur as Extract<Feature, { type: "ext" }>).data ?? {}), ...p } }));
  if (!def) return <p className="text-[12px] text-brand-600">{tr("Modul prvku „")}{f.ext}{tr("“ není načten.")}</p>;
  if (ui?.Form) {
    const Form = ui.Form;
    return <Form f={f} doc={doc} onChange={patch} />;
  }
  if (!def.params?.length) return <p className="text-[12px] text-ink-700/55">{def.hint ?? tr("Prvek nemá parametry.")}</p>;
  return (
    <>
      {def.params.map((p: ExtParam) => {
        const v = data[p.key];
        switch (p.kind) {
          case "number":
            return <Num key={p.key} label={p.label} value={typeof v === "number" ? v : 0} step={p.step ?? 1} min={p.min} suffix={p.unit ?? "mm"} hint={p.hint} bind={`${f.id}:data.${p.key}`} onChange={(n) => patch({ [p.key]: p.max != null ? Math.min(p.max, n) : n })} />;
          case "bool":
            return (
              <label key={p.key} className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={!!v} onChange={(e) => patch({ [p.key]: e.target.checked })} className="accent-[#E03930]" />
                {p.label}
                {p.hint && <span className="text-[11px] text-ink-700/45">{p.hint}</span>}
              </label>
            );
          case "enum":
            return <Seg key={p.key} label={p.label} value={String(v ?? p.options[0]?.v ?? "")} options={p.options} onChange={(x) => patch({ [p.key]: x })} />;
          case "mode":
            return <Seg key={p.key} label={tr("Operace")} value={String(v === "new" ? "add" : (v ?? "add"))} options={MODES as unknown as { v: string; l: string }[]} onChange={(x) => patch({ [p.key]: x })} />;
          case "text":
            return (
              <Field key={p.key} label={p.label}>
                <input className="w-full rounded-lg border border-ink-700/12 px-2.5 py-1.5 text-[13px] outline-none focus:border-brand" value={String(v ?? "")} onChange={(e) => patch({ [p.key]: e.target.value })} />
              </Field>
            );
          case "vec3":
            return <Vec key={p.key} label={p.label} value={(Array.isArray(v) ? v : [0, 0, 0]) as Vec3} bind={`${f.id}:data.${p.key}`} onChange={(x: Vec3) => patch({ [p.key]: x })} />;
          case "sketch":
            return (
              <Field key={p.key} label={p.label}>
                <select className="w-full rounded-lg border border-ink-700/12 bg-white px-2 py-1.5 text-[13px]" value={String(v ?? "")} onChange={(e) => patch({ [p.key]: e.target.value })}>
                  <option value="">{tr("— vyberte skicu —")}</option>
                  {sketches.map((sk) => (
                    <option key={sk.id} value={sk.id}>
                      {sk.name}
                    </option>
                  ))}
                </select>
              </Field>
            );
          case "sketches": {
            const ids = Array.isArray(v) ? (v as string[]) : [];
            return (
              <Field key={p.key} label={p.label}>
                <div className="space-y-1">
                  {sketches.map((sk) => (
                    <label key={sk.id} className="flex items-center gap-2 text-[12.5px]">
                      <input type="checkbox" className="accent-[#E03930]" checked={ids.includes(sk.id)} onChange={(e) => patch({ [p.key]: e.target.checked ? [...ids, sk.id] : ids.filter((x) => x !== sk.id) })} />
                      {sk.name}
                    </label>
                  ))}
                </div>
              </Field>
            );
          }
          case "feature":
            return (
              <Field key={p.key} label={p.label}>
                <select className="w-full rounded-lg border border-ink-700/12 bg-white px-2 py-1.5 text-[13px]" value={String(v ?? "")} onChange={(e) => patch({ [p.key]: e.target.value })}>
                  <option value="">{tr("— vyberte prvek —")}</option>
                  {toolFeatures.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </Field>
            );
          case "faces":
          case "edges": {
            const n = Array.isArray(v) ? (v as number[]).length : 0;
            return (
              <div key={p.key} className="rounded-lg border border-dashed border-ink-700/20 p-2.5 text-[12.5px]">
                <span className="font-medium">{p.label}:</span> {n ? tr("{0} vybráno", n) : tr("vyberte v modelu ({0})", p.kind === "faces" ? "plochy" : "hrany")}
                {n > 0 && (
                  <button type="button" className="ml-2 text-brand hover:underline" onClick={() => patch({ [p.key]: [] })}>
                    vymazat
                  </button>
                )}
                {p.hint && <p className="mt-1 text-[11px] text-ink-700/45">{p.hint}</p>}
              </div>
            );
          }
        }
      })}
    </>
  );
}
