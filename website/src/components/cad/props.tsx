"use client";

import { EntityMultiPick, describeEdge, describeFace, docBefore, useTopology } from "./entity-multi-pick";
import type { PlaneDef, Ref } from "@/cad/refs";
import { bodiesAt, isNewBodyMode, nextBodyName } from "@/cad/bodies";
import { tr } from "@/cad/i18n";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { ALL_THREADS, FEATURE_LABEL, METRIC_THREADS, planeLabel, threadByName } from "@/cad/defaults";
import { getExt, type ExtParam } from "@/cad/ext/registry";
import { ExtDirectionParam, ExtAxisParam, LegacyHint } from "./ext-params";
import { getExtUi } from "./ext/registry";
import { evalExpr, exprRefs, isExpression } from "@/cad/params";
import type { Axis, BoolMode, CadDoc, Feature, HoleKind, PlaneName, SketchEntity, Vec2, Vec3 } from "@/cad/types";
import { cn } from "@/lib/cn";
import type { Extent, HoleEnd } from "@/cad/types";
import { AxisField, DirectionField, ExtentField, PlaneDefField, RefField, RefListField, RefPickContext, StartField, ThinField } from "./ref-field";
import "./forms/index";
import { getFeatureForm } from "./forms/registry";
import { HoleBottomField, TapDrillField, threadPatch } from "./forms/hole-fields";
import { ExtrudeDraftFields, ExtrudeHeightCheck } from "./extrude-fields";

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

/** prvky bez geometrie – cílové těleso se u nich nevolí */
const NO_GEOMETRY = new Set<string>(["sketch", "datum", "datumAxis", "datumPoint", "csys"]);
const MODES: { v: BoolMode | "newbody"; l: string }[] = [
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
  // ── více těles: stav těles před tímto prvkem (názvy, aktivní) ──
  const bs = bodiesAt(doc, idx >= 0 ? idx : doc.features.length);
  /** prvek zakládá nové těleso (operace „Nové těleso“ s dosud neexistujícím názvem) */
  const makesNewBody = bs.started && isNewBodyMode(f) && !!f.body && !bs.names.includes(f.body);
  const mode =
    "mode" in f ? (
      <>
        <Seg
          label={tr("Operace")}
          value={makesNewBody ? "newbody" : f.mode === "new" ? "add" : f.mode}
          options={bs.started ? [...MODES, { v: "newbody" as const, l: tr("Nové těleso") }] : MODES}
          onChange={(v) => (v === "newbody" ? set({ mode: "new", body: nextBodyName(bs.names) }) : set({ mode: v, body: makesNewBody ? undefined : f.body }))}
        />
        {makesNewBody && (
          <Field label={tr("Název nového tělesa")}>
            <input className="w-full rounded-lg border border-ink-700/12 px-2.5 py-1.5 text-[13px] outline-none focus:border-brand" aria-label={tr("Název nového tělesa")} value={f.body ?? ""} onChange={(e) => set({ body: e.target.value || nextBodyName(bs.names) })} />
          </Field>
        )}
      </>
    ) : null;
  /** cílové těleso prvku – nabízí se, jakmile má díl víc těles (prvky pro práci s tělesy mají vlastní pole) */
  const bodyPick =
    bs.names.length > 1 && !makesNewBody && !NO_GEOMETRY.has(f.type) && f.type !== "combine" && f.type !== "copyBody" ? (
      <Field label={tr("Těleso")}>
        <select className={selectCls} aria-label={tr("Těleso, na kterém prvek pracuje")} value={f.body && bs.names.includes(f.body) ? f.body : ""} onChange={(e) => set({ body: e.target.value || undefined })}>
          <option value="">{tr("naposledy aktivní ({0})", bs.active)}</option>
          {bs.names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </Field>
    ) : null;
  const custom = getFeatureForm(f.type);

  return (
    <div className="space-y-3.5">
      <Field label={tr("Název")}>
        <input className="w-full rounded-lg border border-ink-700/12 px-2.5 py-1.5 text-[13px] outline-none focus:border-brand" value={f.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      {bodyPick}
      {(() => {
        if (custom) return custom({ f, doc, set, b, sketches, toolFeatures, mode, pickHint });
        switch (f.type) {
          case "splitBodies": {
            const ax = AXIS_PLANES.find((p) => p.v === f.plane)?.axis ?? "Z";
            return (
              <>
                <PlaneDefField label={tr("Dělicí rovina")} value={f.planeDef} allowNone noneLabel={tr("Základní rovina (níže)")} onChange={(planeDef) => set({ planeDef })} />
                {!f.planeDef && (
                  <>
                    <Seg label={tr("Základní rovina")} value={f.plane} options={AXIS_PLANES} onChange={(v) => set({ plane: v })} />
                    <Num label={tr("Poloha roviny ({0})", ax)} value={f.offset} bind={b("offset")} onChange={(v) => set({ offset: v })} />
                  </>
                )}
                <Field label={tr("Název nového tělesa (záporná strana roviny)")}>
                  <input className="w-full rounded-lg border border-ink-700/12 px-2.5 py-1.5 text-[13px] outline-none focus:border-brand" aria-label={tr("Název nového tělesa")} value={f.nameB ?? ""} placeholder={nextBodyName(bs.names)} onChange={(e) => set({ nameB: e.target.value || undefined })} />
                </Field>
                <Info>{tr("Rovina rozdělí těleso „{0}“ na dvě: strana ve směru normály zůstane tímto tělesem, opačná strana je nové těleso. Další prvky pracují s tělesem, které vyberete v poli Těleso nebo ve správci.", f.body && bs.names.includes(f.body) ? f.body : bs.active)}</Info>
              </>
            );
          }
          case "copyBody":
            return (
              <>
                <Field label={tr("Kopírované těleso")}>
                  <select className={selectCls} aria-label={tr("Kopírované těleso")} value={f.source && bs.names.includes(f.source) ? f.source : ""} onChange={(e) => set({ source: e.target.value })}>
                    <option value="">{tr("aktivní ({0})", bs.active)}</option>
                    {bs.names.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </Field>
                <Vec label={tr("Posunutí kopie")} value={f.translate} bind={b("translate")} onChange={(v) => set({ translate: v })} />
                <Field label={tr("Název kopie")}>
                  <input className="w-full rounded-lg border border-ink-700/12 px-2.5 py-1.5 text-[13px] outline-none focus:border-brand" aria-label={tr("Název kopie")} value={f.newName ?? ""} placeholder={nextBodyName(bs.names)} onChange={(e) => set({ newName: e.target.value || undefined })} />
                </Field>
                <Info>{tr("Kopie je samostatné těleso dílu – dá se dál upravovat, nebo sloučit s jiným tělesem (Sloučit tělesa).")}</Info>
              </>
            );
          case "combine": {
            const target = f.target && bs.names.includes(f.target) ? f.target : "";
            const targetName = target || bs.active;
            const tools = bs.names.filter((n) => n !== targetName);
            return (
              <>
                {bs.names.length < 2 && <Info>{tr("Díl má zatím jedno těleso. Druhé vznikne operací „Nové těleso“ u vysunutí či primitiva, rozdělením (Rozdělit na tělesa) nebo kopií (Kopie tělesa).")}</Info>}
                <Field label={tr("Cílové těleso (výsledek)")}>
                  <select className={selectCls} aria-label={tr("Cílové těleso")} value={target} onChange={(e) => set({ target: e.target.value })}>
                    <option value="">{tr("aktivní ({0})", bs.active)}</option>
                    {bs.names.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={tr("Nástrojové těleso")}>
                  <select className={selectCls} aria-label={tr("Nástrojové těleso")} value={f.tool && tools.includes(f.tool) ? f.tool : ""} onChange={(e) => set({ tool: e.target.value })}>
                    <option value="">{tr("— vyberte těleso —")}</option>
                    {tools.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </Field>
                <Seg label={tr("Operace")} value={f.op} options={[{ v: "add", l: tr("Sjednotit") }, { v: "cut", l: tr("Odebrat") }, { v: "intersect", l: tr("Průnik") }]} onChange={(v) => set({ op: v })} />
                <Check label={tr("Ponechat nástrojové těleso")} value={f.keepTool} onChange={(v) => set({ keepTool: v })} />
                <Info>{tr("Výsledek zůstane v cílovém tělese; nástrojové těleso zanikne, pokud ho neponecháte.")}</Info>
              </>
            );
          }
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
                  <ExtrudeHeightCheck f={f} set={set} />
                  <ThinField value={f.thin} onChange={(thin) => set({ thin })} />
                  <ExtrudeDraftFields f={f} set={set} bind={b} />
                  <div className="grid grid-cols-2 gap-2">
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
          case "hole":
            return <HoleProps f={f} set={set} b={b} />;
          case "offsetFace":
            return (
              <>
                <Num label={tr("Odsazení")} value={f.distance} step={0.1} hint={tr("+ ven · − dovnitř")} bind={b("distance")} onChange={(v) => set({ distance: v })} />
                <PickInfo n={f.faces.length} what={tr("ploch k odsazení")} hint={pickHint} onClear={() => set({ faces: [] })} list={{ doc, f, kind: "faces", value: f.faces, onChange: (faces) => set({ faces }) }} />
                <Info>{tr("Funguje i na zakřivených plochách – např. odsazení stěny díry o +0,5 mm díru zmenší.")}</Info>
              </>
            );
          case "deleteFace":
            return (
              <>
                <PickInfo n={f.faces.length} what={tr("ploch k odstranění")} hint={pickHint} onClear={() => set({ faces: [] })} list={{ doc, f, kind: "faces", value: f.faces, onChange: (faces) => set({ faces }) }} />
                <Info>{tr("Odstraní díry, čepy, kuželová zahloubení a válcová zaoblení (obnoví ostrou hranu). Vhodné pro úpravy importovaných modelů.")}</Info>
              </>
            );
          case "thicken":
            return (
              <>
                <Num label={tr("Tloušťka")} value={f.thickness} step={0.5} hint={tr("+ ven · − dovnitř")} bind={b("thickness")} onChange={(v) => set({ thickness: v })} />
                <PickInfo n={f.faces.length} what={tr("ploch k zesílení")} hint={pickHint} onClear={() => set({ faces: [] })} list={{ doc, f, kind: "faces", value: f.faces, onChange: (faces) => set({ faces }) }} />
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
                <Seg label={tr("Zrcadlit")} value={f.featureIds?.length || f.featureIds ? "features" : "body"} options={[{ v: "body", l: tr("Celé těleso") }, { v: "features", l: tr("Vybrané prvky") }]} onChange={(v) => set({ featureIds: v === "features" ? [] : undefined })} />
                {f.featureIds ? (
                  <Field label={tr("Prvky ke zrcadlení")}>
                    <div className="space-y-1" data-mirror-features>
                      {toolFeatures.length === 0 && <span className="text-[12px] text-ink-700/55">{tr("V historii zatím není prvek s nástrojovým tělesem (vysunutí, díra, primitivum…).")}</span>}
                      {toolFeatures.map((x) => (
                        <label key={x.id} className="flex items-center gap-2 text-[12.5px]">
                          <input type="checkbox" className="accent-[#E03930]" checked={f.featureIds!.includes(x.id)} onChange={(e) => set({ featureIds: e.target.checked ? [...f.featureIds!, x.id] : f.featureIds!.filter((id) => id !== x.id) })} />
                          {x.name}
                        </label>
                      ))}
                    </div>
                  </Field>
                ) : (
                  <Check label={tr("Ponechat originál (sloučit)")} value={f.keepOriginal} onChange={(v) => set({ keepOriginal: v })} />
                )}
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
  const endExt: Extent =
    end.kind === "blind" ? { kind: "blind", d: f.depth || 10 } : end.kind === "toFace" ? { kind: "toFace", ref: end.ref, offset: end.offset } : end.kind === "toVertex" ? { kind: "toVertex", ref: end.ref } : end.kind === "offsetFromFace" ? { kind: "offsetFromFace", ref: end.ref, d: end.d } : { kind: end.kind };
  const setEnd = (e: Extent) => {
    if (e.kind === "blind") return set({ end: { kind: "blind" }, depth: e.d });
    if (e.kind === "throughAll") return set({ end: { kind: "throughAll" }, depth: 0 });
    if (e.kind === "toFace") return set({ end: { kind: "toFace", ref: e.ref, offset: e.offset } });
    if (e.kind === "toVertex") return set({ end: { kind: "toVertex", ref: e.ref } });
    if (e.kind === "offsetFromFace") return set({ end: { kind: "offsetFromFace", ref: e.ref, d: e.d } });
    if (e.kind === "toNext") return set({ end: { kind: "toNext" } });
    if (e.kind === "toBody") return set({ end: { kind: "toBody" } });
  };
  return (
    <>
      <Seg label={tr("Typ díry")} value={kind} options={HOLE_KINDS} onChange={changeKind} />
      {kind === "tapped" ? (
        <>
          <Field label={tr("Závit (hrubé i jemné stoupání)")}>
            <select className={selectCls} value={thread && ALL_THREADS.some((x) => x.name === thread.name) ? thread.name : "custom"} onChange={(e) => e.target.value !== "custom" && set(threadPatch(f, e.target.value))}>
              {!(thread && ALL_THREADS.some((x) => x.name === thread.name)) && <option value="custom">{thread ? tr("{0} (vlastní stoupání)", thread.name) : tr("— vyberte nebo zadejte níže —")}</option>}
              {ALL_THREADS.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}{t.name.includes("×") ? "" : ` × ${fmtMm(t.pitch)}`} {tr("· vrták Ø")}{fmtMm(t.tap)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tr("Označení závitu (text)")}>
            <input className="w-full rounded-lg border border-ink-700/12 px-2.5 py-1.5 font-mono text-[13px] outline-none focus:border-brand" aria-label={tr("Označení závitu díry")} value={f.thread ?? ""} placeholder={tr("např. M18×1,5")} onChange={(e) => set(threadPatch(f, e.target.value))} />
            {!thread && (f.thread ?? "").trim() && <span className="mt-1 block text-[11px] text-brand-600">{tr("Neznámé označení – M2 až M48, volitelně se stoupáním (M18×1,5).")}</span>}
          </Field>
          <Num label={tr("Hloubka závitu")} value={f.threadDepth ?? 0} min={0} hint={tr("0 = celá")} bind={b("threadDepth")} onChange={(v) => set({ threadDepth: v })} />
          {thread && <TapDrillField f={f} t={thread} set={set} b={b} />}
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
      <ExtentField label={tr("Ukončení")} value={endExt} kinds={["blind", "throughAll", "toNext", "toFace", "toVertex", "offsetFromFace", "toBody"]} defaultDistance={f.depth || 10} onChange={setEnd} />
      {end.kind === "blind" && <HoleBottomField f={f} set={set} b={b} />}
      {!f.points?.length && <Vec label={tr("Bod na povrchu")} value={f.position} bind={b("position")} onChange={(v) => set({ position: v })} />}
      <RefListField label={tr("Polohy děr (více naráz)")} value={f.points ?? []} onChange={(points) => set({ points: points.length ? points : undefined })} />
      {!!f.points?.length && <Info>{tr("Díry se vrtají v {0} zadaných polohách. Pole „Bod na povrchu“ se při tom nepoužívá – objeví se znovu, když polohy odeberete.", f.points.length)}</Info>}
      <DirectionField label={tr("Osa díry")} allowNormal={false} value={f.dirDef ?? { kind: "axis", axis: f.axis }} onChange={(d) => (!d || d.kind === "axis" ? set({ axis: d?.axis ?? f.axis, dirDef: undefined }) : set({ dirDef: d }))} />
      <Check label={tr("Vrtat v kladném směru osy")} value={f.flip} onChange={(v) => set({ flip: v })} />
      {end.kind === "throughAll" && (
        <>
          <Check label={tr("Skrz oběma směry (celé těleso)")} value={!!f.bothWays} onChange={(v) => set({ bothWays: v || undefined })} />
          <Info>{f.bothWays ? tr("Díra prochází celým tělesem na obě strany od zadaného bodu.") : tr("Díra „skrz“ vrtá od zadaného bodu jen ve směru vrtání – materiál nad bodem (např. protější příruba) zůstane.")}</Info>
        </>
      )}
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

/** Výběr hran / ploch prvku: počet, tlačítka „Ze seznamu…“ a „+ aktuální výběr“, popis vybraných entit. */
export function PickInfo({
  n,
  what,
  hint,
  onClear,
  list,
}: {
  n: number;
  what: string;
  hint?: string;
  onClear: () => void;
  /** zapne výběr ze seznamu, pravidlem a z aktuálního výběru v modelu (indexy se vztahují k tělesu před prvkem `f`) */
  list?: { doc: CadDoc; f: Feature; kind: "faces" | "edges"; value: number[]; onChange: (v: number[]) => void };
}) {
  const ctx = useContext(RefPickContext);
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState(false);
  // aktuální výběr v modelu (vybraný před otevřením formuláře), který ve výběru prvku ještě není
  const fromSel = list ? [...new Set((ctx?.selectionRefs ?? []).filter((r) => r.kind === (list.kind === "faces" ? "face" : "edge")).map((r) => (r as { index: number }).index))].filter((i) => !list.value.includes(i)) : [];
  return (
    <div className="rounded-lg border border-dashed border-brand/40 bg-brand/5 p-3 text-[12px] text-ink-700" data-pick-info={list?.kind}>
      <p>
        <strong>{n}</strong> {what} {tr("vybráno.")}{" "}{hint ?? tr("Klikáním v modelu přidáváte / odebíráte.")}
      </p>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {list && (
          <button type="button" data-pick-list onClick={() => setOpen(true)} className="text-brand underline">
            {tr("Ze seznamu / pravidlem…")}
          </button>
        )}
        {list && fromSel.length > 0 && (
          <button type="button" data-pick-add-selection onClick={() => list.onChange([...list.value, ...fromSel].sort((a, b) => a - b))} className="text-brand underline" title={tr("Přidá plochy / hrany vybrané v modelu před otevřením formuláře")}>
            {tr("+ aktuální výběr ({0})", fromSel.length)}
          </button>
        )}
        {list && n > 0 && (
          <button type="button" data-pick-details onClick={() => setDetails((v) => !v)} className="text-brand underline">
            {details ? tr("Skrýt popis") : tr("Popis vybraných")}
          </button>
        )}
        {n > 0 && (
          <button type="button" onClick={onClear} className="text-brand underline">
            {tr("Zrušit výběr")}
          </button>
        )}
      </div>
      {list && details && n > 0 && <PickedDetails list={list} />}
      {list && open && <EntityMultiPick doc={docBefore(list.doc, list.f)} kind={list.kind} value={list.value} onChange={list.onChange} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** popis vybraných ploch / hran (typ, směr, velikost) – aby číslo v seznamu nebylo jediný údaj; každou lze odebrat */
function PickedDetails({ list }: { list: { doc: CadDoc; f: Feature; kind: "faces" | "edges"; value: number[]; onChange: (v: number[]) => void } }) {
  const { topo, loading, error } = useTopology(docBefore(list.doc, list.f));
  if (loading) return <p className="mt-1.5 text-ink-700/60">{tr("Načítám plochy a hrany z jádra…")}</p>;
  if (error || !topo) return <p className="mt-1.5 text-brand">{error ?? tr("Těleso není k dispozici.")}</p>;
  return (
    <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-y-auto" data-pick-detail-list>
      {list.value.map((i) => {
        const text = list.kind === "faces" ? (topo.faces.find((x) => x.index === i) ? describeFace(topo.faces.find((x) => x.index === i)!) : null) : topo.edges.find((x) => x.index === i) ? describeEdge(topo.edges.find((x) => x.index === i)!) : null;
        return (
          <li key={i} className="flex items-center gap-1.5">
            <span className="font-medium">
              {list.kind === "faces" ? tr("Plocha") : tr("Hrana")} {i + 1}
            </span>
            <span className={cn("min-w-0 flex-1 truncate", !text && "text-brand")}>{text ?? tr("v tělese před prvkem není – odeberte ji")}</span>
            <button type="button" aria-label={tr("Odebrat z výběru")} className="px-1 text-brand" onClick={() => list.onChange(list.value.filter((x) => x !== i))}>
              ×
            </button>
          </li>
        );
      })}
    </ul>
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
          <Check label={tr("Uzavřená")} value={e.closed} onChange={(v) => set({ closed: v, autoClose: undefined } as Partial<SketchEntity>)} />
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
    return (
      <>
        {def.legacy && <LegacyHint text={def.legacy} />}
        <Form f={f} doc={doc} onChange={patch} />
      </>
    );
  }
  if (!def.params?.length) return <p className="text-[12px] text-ink-700/55">{def.hint ?? tr("Prvek nemá parametry.")}</p>;
  return (
    <>
      {def.legacy && <LegacyHint text={def.legacy} />}
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
            // pořadí skic je významné (šablonování ploch jde v zadaném pořadí) – vybrané lze posouvat nahoru a dolů
            const ids = (Array.isArray(v) ? (v as string[]) : []).filter((id) => sketches.some((sk) => sk.id === id));
            const move = (i: number, d: -1 | 1) => {
              const next = [...ids];
              [next[i], next[i + d]] = [next[i + d], next[i]];
              patch({ [p.key]: next });
            };
            const rest = sketches.filter((sk) => !ids.includes(sk.id));
            return (
              <Field key={p.key} label={p.label}>
                <div className="space-y-1" data-sketch-order={p.key}>
                  {ids.map((id, i) => (
                    <div key={id} className="flex items-center gap-1 rounded border border-ink-700/10 px-1.5 py-0.5 text-[12.5px]">
                      <span className="w-4 text-ink-700/45">{i + 1}.</span>
                      <span className="min-w-0 flex-1 truncate">{sketches.find((sk) => sk.id === id)?.name}</span>
                      <button type="button" aria-label={tr("Posunout výš")} title={tr("Posunout výš")} disabled={i === 0} onClick={() => move(i, -1)} className="px-1 text-ink-700/60 hover:text-brand disabled:opacity-30">
                        ↑
                      </button>
                      <button type="button" aria-label={tr("Posunout níž")} title={tr("Posunout níž")} disabled={i === ids.length - 1} onClick={() => move(i, 1)} className="px-1 text-ink-700/60 hover:text-brand disabled:opacity-30">
                        ↓
                      </button>
                      <button type="button" aria-label={tr("Odebrat z výběru")} title={tr("Odebrat z výběru")} onClick={() => patch({ [p.key]: ids.filter((x) => x !== id) })} className="px-1 text-brand">
                        ×
                      </button>
                    </div>
                  ))}
                  {rest.length > 0 && (
                    <select className="w-full rounded-lg border border-ink-700/12 bg-white px-2 py-1.5 text-[13px]" aria-label={tr("Přidat skicu")} value="" onChange={(e) => e.target.value && patch({ [p.key]: [...ids, e.target.value] })}>
                      <option value="">{tr("+ přidat skicu…")}</option>
                      {rest.map((sk) => (
                        <option key={sk.id} value={sk.id}>
                          {sk.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {p.hint && <span className="block text-[11px] text-ink-700/45">{p.hint}</span>}
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
          case "plane":
            // rovina odkazem (plocha, tři body, pomocná rovina…) – prázdné = základní rovina a odsazení prvku
            return (
              <div key={p.key}>
                <PlaneDefField label={p.label} value={(v as PlaneDef | undefined) ?? undefined} allowNone noneLabel={tr("Základní rovina (níže)")} onChange={(planeDef) => patch({ [p.key]: planeDef ?? null })} />
                {p.hint && <p className="mt-1 text-[11px] text-ink-700/45">{p.hint}</p>}
              </div>
            );
          case "point":
            // bod odkazem (vrchol, střed hrany, bod skici…) – prázdné = souřadnice prvku
            return (
              <div key={p.key}>
                <RefField label={p.label} want="point" allowXyz={false} value={(v as Ref | undefined) ?? undefined} onChange={(ref) => patch({ [p.key]: ref })} hint={p.hint} />
                {!!v && (
                  <button type="button" className="mt-1 text-[11.5px] text-brand underline" onClick={() => patch({ [p.key]: null })}>
                    {tr("Zrušit odkaz (použít souřadnice)")}
                  </button>
                )}
              </div>
            );
          case "direction":
            // směr jako u vysunutí / pole (osa, vektor čísly, hrana, normála plochy…); starší „X“ / [x,y,z] se zobrazí převedené
            return <ExtDirectionParam key={p.key} p={p} value={v} onChange={(d) => patch({ [p.key]: d })} />;
          case "axis":
            // osa jako u rotace (osy skici, čára skici, hrana, válcová plocha, dva body, globální osa…); starší „x“ / „y“ převedené
            return <ExtAxisParam key={p.key} p={p} value={v} sketch={p.sketchKey ? sketches.find((sk) => sk.id === data[p.sketchKey!]) : undefined} onChange={(a) => patch({ [p.key]: a })} />;
          case "faces":
          case "edges": {
            // stejný výběr jako u základních prvků: klik v modelu, seznam / pravidlo, aktuální výběr, popis vybraných
            const idx = Array.isArray(v) ? (v as number[]) : [];
            return (
              <div key={p.key} className="space-y-1">
                <p className="text-[12.5px] font-medium">{p.label}</p>
                <PickInfo n={idx.length} what={p.kind === "faces" ? tr("ploch") : tr("hran")} hint={p.hint} onClear={() => patch({ [p.key]: [] })} list={{ doc, f, kind: p.kind, value: idx, onChange: (x) => patch({ [p.key]: x }) }} />
              </div>
            );
          }
        }
      })}
    </>
  );
}
