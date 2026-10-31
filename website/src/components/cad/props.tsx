"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { FEATURE_LABEL, METRIC_THREADS, planeLabel, threadByName } from "@/cad/defaults";
import { evalExpr, exprRefs, isExpression } from "@/cad/params";
import type { Axis, BoolMode, CadDoc, Feature, HoleKind, PlaneName, SketchEntity, Vec2, Vec3 } from "@/cad/types";
import { cn } from "@/lib/cn";

// ---------- parametry (proměnné / rovnice) ----------

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
  const commit = (t: string) => {
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
          <button type="button" title="Parametr je navázaný na proměnné – kliknutím vazbu zrušíte" onClick={(e) => (e.preventDefault(), unbind())} className="ml-1.5 rounded bg-sky-600 px-1 font-mono text-[10px] font-bold italic text-white hover:bg-brand">
            ƒx
          </button>
        )}
        <input
          className="w-full min-w-0 bg-transparent px-2.5 py-1.5 font-mono text-[13px] text-ink-700 outline-none"
          value={text}
          inputMode={ctx ? "text" : "decimal"}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
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
  { v: "add", l: "Přidat" },
  { v: "cut", l: "Odebrat" },
  { v: "intersect", l: "Průnik" },
];
const AXES: { v: Axis; l: string }[] = [
  { v: "X", l: "X" },
  { v: "Y", l: "Y" },
  { v: "Z", l: "Z" },
];
/** Roviny kolmé na osu (pro řez, úkos): offset se měří ve směru osy. */
const AXIS_PLANES: { v: PlaneName; l: string; axis: Axis }[] = [
  { v: "XY", l: "XY ⟂ Z", axis: "Z" },
  { v: "XZ", l: "XZ ⟂ Y", axis: "Y" },
  { v: "YZ", l: "YZ ⟂ X", axis: "X" },
];
const HOLE_KINDS: { v: HoleKind; l: string }[] = [
  { v: "simple", l: "Vrtaná" },
  { v: "counterbore", l: "Válc. zahl." },
  { v: "countersink", l: "Kuž. zahl." },
  { v: "tapped", l: "Závit" },
];
const TOOL_TYPES = ["extrude", "revolve", "box", "cylinder", "sphere", "cone", "tube", "hole", "sweep", "loft", "text"];

const fmtMm = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", ",");

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{label}</span>
      {children}
    </label>
  );
}
const selectCls = "w-full rounded-lg border border-ink-700/12 bg-white px-2 py-1.5 text-[13px] outline-none focus:border-brand";
const Info = ({ children }: { children: React.ReactNode }) => <p className="rounded-lg bg-steel-100 p-3 text-[12px] leading-relaxed text-ink-700/70">{children}</p>;

// ---------- prvky ----------

export function FeatureProps({
  f,
  doc,
  onChange,
  pickHint,
}: {
  f: Feature;
  doc: CadDoc;
  onChange: (patch: Partial<Feature>) => void;
  pickHint?: string;
}) {
  const set = (p: Record<string, unknown>) => onChange(p as Partial<Feature>);
  const b = (path: string) => `${f.id}:${path}`;
  const idx = doc.features.findIndex((x) => x.id === f.id);
  const before = idx >= 0 ? doc.features.slice(0, idx) : doc.features;
  const sketches = before.filter((x) => x.type === "sketch");
  const toolFeatures = before.filter((x) => TOOL_TYPES.includes(x.type) && x.id !== f.id);
  const mode = "mode" in f ? <Seg label="Operace" value={f.mode === "new" ? "add" : f.mode} options={MODES} onChange={(v) => set({ mode: v })} /> : null;

  return (
    <div className="space-y-3.5">
      <Field label="Název">
        <input className="w-full rounded-lg border border-ink-700/12 px-2.5 py-1.5 text-[13px] outline-none focus:border-brand" value={f.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      {(() => {
        switch (f.type) {
          case "sketch":
            return <Info>Rovina: {planeLabel(f.plane)} · {f.entities.length} entit</Info>;
          case "extrude":
            return (
              <>
                <SketchPick value={f.sketchId} sketches={sketches} onChange={(v) => set({ sketchId: v })} />
                <Num label="Vzdálenost" value={f.distance} min={0.001} bind={b("distance")} onChange={(v) => set({ distance: v })} />
                <div className="flex gap-4">
                  <Check label="Symetricky" value={f.symmetric} onChange={(v) => set({ symmetric: v })} />
                  <Check label="Opačný směr" value={f.reverse} onChange={(v) => set({ reverse: v })} />
                </div>
                <Num label="Úkos" value={f.draftAngle ?? 0} suffix="°" hint="0 = bez úkosu" bind={b("draftAngle")} onChange={(v) => set({ draftAngle: Math.max(-44, Math.min(44, v)) })} />
                {mode}
              </>
            );
          case "revolve":
            return (
              <>
                <SketchPick value={f.sketchId} sketches={sketches} onChange={(v) => set({ sketchId: v })} />
                <Seg label="Osa rotace (ve skice)" value={f.axis} options={[{ v: "y", l: "Svislá osa Y" }, { v: "x", l: "Vodorovná osa X" }]} onChange={(v) => set({ axis: v })} />
                <Num label="Úhel" value={f.angle} min={1} suffix="°" bind={b("angle")} onChange={(v) => set({ angle: Math.min(360, v) })} />
                {mode}
              </>
            );
          case "sweep":
            return (
              <>
                <SketchPick label="Profil (uzavřená skica)" value={f.profileId} sketches={sketches} onChange={(v) => set({ profileId: v })} />
                <SketchPick label="Dráha (křivka)" value={f.pathId} sketches={sketches} onChange={(v) => set({ pathId: v })} />
                <Check label="Natáčet profil podle křivky (Frenet)" value={f.frenet} onChange={(v) => set({ frenet: v })} />
                <Info>Profil by měl ležet v rovině kolmé na začátek dráhy. Dráha může obsahovat úsečky, oblouky a lomené čáry – musí být souvislá.</Info>
                {mode}
              </>
            );
          case "loft": {
            const ids = f.sketchIds;
            const setIds = (next: string[]) => set({ sketchIds: next });
            return (
              <>
                <div>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-700/55">Profily (v pořadí)</p>
                  <ol className="space-y-1.5">
                    {ids.map((id, k) => (
                      <li key={k} className="flex items-center gap-1.5">
                        <span className="w-5 text-center font-mono text-[11px] text-ink-700/45">{k + 1}</span>
                        <select className={selectCls} value={id} onChange={(e) => setIds(ids.map((x, j) => (j === k ? e.target.value : x)))}>
                          <option value="">— vyberte skicu —</option>
                          {sketches.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                        <button type="button" title="Posunout nahoru" disabled={!k} className="rounded px-1 text-ink-700/50 hover:text-ink-700 disabled:opacity-25" onClick={() => setIds(ids.map((x, j) => (j === k - 1 ? ids[k] : j === k ? ids[k - 1] : x)))}>
                          ↑
                        </button>
                        <button type="button" title="Odebrat" disabled={ids.length <= 2} className="rounded px-1 text-ink-700/50 hover:text-brand disabled:opacity-25" onClick={() => setIds(ids.filter((_, j) => j !== k))}>
                          ×
                        </button>
                      </li>
                    ))}
                  </ol>
                  <button type="button" className="mt-1.5 text-[12px] font-medium text-brand hover:underline" onClick={() => setIds([...ids, sketches.find((s) => !ids.includes(s.id))?.id ?? ""])}>
                    + Přidat profil
                  </button>
                </div>
                <Check label="Přímkové plochy (bez vyhlazení)" value={f.ruled} onChange={(v) => set({ ruled: v })} />
                {mode}
              </>
            );
          }
          case "box":
            return (
              <>
                <Vec label="Rozměry (X × Y × Z)" value={f.size} bind={b("size")} onChange={(v) => set({ size: v })} />
                <Vec label="Poloha" value={f.position} bind={b("position")} onChange={(v) => set({ position: v })} />
                <Check label="Poloha = střed kvádru" value={f.centered} onChange={(v) => set({ centered: v })} />
                {mode}
              </>
            );
          case "cylinder":
            return (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Num label="Průměr" value={f.radius * 2} min={0.001} bind={b("radius")} bindFactor={2} onChange={(v) => set({ radius: v / 2 })} />
                  <Num label="Výška" value={f.height} min={0.001} bind={b("height")} onChange={(v) => set({ height: v })} />
                </div>
                <Seg label="Osa" value={f.axis} options={AXES} onChange={(v) => set({ axis: v })} />
                <Vec label="Poloha podstavy" value={f.position} bind={b("position")} onChange={(v) => set({ position: v })} />
                {mode}
              </>
            );
          case "sphere":
            return (
              <>
                <Num label="Průměr" value={f.radius * 2} min={0.001} bind={b("radius")} bindFactor={2} onChange={(v) => set({ radius: v / 2 })} />
                <Vec label="Střed" value={f.position} bind={b("position")} onChange={(v) => set({ position: v })} />
                {mode}
              </>
            );
          case "cone":
            return (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <Num label="Ø dole" value={f.radius1 * 2} min={0} bind={b("radius1")} bindFactor={2} onChange={(v) => set({ radius1: v / 2 })} />
                  <Num label="Ø nahoře" value={f.radius2 * 2} min={0} bind={b("radius2")} bindFactor={2} onChange={(v) => set({ radius2: v / 2 })} />
                  <Num label="Výška" value={f.height} min={0.001} bind={b("height")} onChange={(v) => set({ height: v })} />
                </div>
                <Seg label="Osa" value={f.axis} options={AXES} onChange={(v) => set({ axis: v })} />
                <Vec label="Poloha podstavy" value={f.position} bind={b("position")} onChange={(v) => set({ position: v })} />
                {mode}
              </>
            );
          case "tube":
            return (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <Num label="Ø vnější" value={f.outer} min={0.001} bind={b("outer")} onChange={(v) => set({ outer: v })} />
                  <Num label="Ø vnitřní" value={f.inner} min={0} bind={b("inner")} onChange={(v) => set({ inner: v })} />
                  <Num label="Délka" value={f.height} min={0.001} bind={b("height")} onChange={(v) => set({ height: v })} />
                </div>
                <Seg label="Osa" value={f.axis} options={AXES} onChange={(v) => set({ axis: v })} />
                <Vec label="Poloha podstavy" value={f.position} bind={b("position")} onChange={(v) => set({ position: v })} />
                {mode}
              </>
            );
          case "hole":
            return <HoleProps f={f} set={set} b={b} />;
          case "thread": {
            const t = threadByName(f.designation);
            return (
              <>
                <Field label="Závit (ISO metrický, hrubé stoupání)">
                  <select className={selectCls} value={t?.name ?? ""} onChange={(e) => set({ designation: e.target.value })}>
                    {!t && <option value="">— vyberte —</option>}
                    {METRIC_THREADS.map((x) => (
                      <option key={x.name} value={x.name}>
                        {x.name} × {fmtMm(x.pitch)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Num label="Délka závitu" value={f.length} min={0.1} bind={b("length")} onChange={(v) => set({ length: v })} />
                <Seg label="Osa" value={f.axis} options={AXES} onChange={(v) => set({ axis: v })} />
                <Vec label="Začátek závitu (na ose)" value={f.position} bind={b("position")} onChange={(v) => set({ position: v })} />
                <Check label="Modelovat závitové drážky" value={f.modeled} onChange={(v) => set({ modeled: v })} />
                <Info>
                  {f.modeled
                    ? "Závit se vymodeluje jako drážky (zjednodušeně, bez stoupání) – vhodné pro vizualizaci a 3D tisk."
                    : "Kosmetický závit: geometrie se nemění, závit se uvede ve výkrese. Doporučeno pro výrobní dokumentaci."}
                  {t && ` Jmenovitý Ø ${fmtMm(t.d)} mm, stoupání ${fmtMm(t.pitch)} mm.`}
                </Info>
              </>
            );
          }
          case "fillet":
          case "chamfer":
            return (
              <>
                {f.type === "fillet" ? (
                  <Num label="Poloměr" value={f.radius} min={0.01} step={0.5} bind={b("radius")} onChange={(v) => set({ radius: v })} />
                ) : (
                  <Num label="Velikost sražení" value={f.distance} min={0.01} step={0.5} bind={b("distance")} onChange={(v) => set({ distance: v })} />
                )}
                <Seg label="Hrany" value={f.edges === "all" ? "all" : "pick"} options={[{ v: "pick", l: "Vybrané" }, { v: "all", l: "Všechny" }]} onChange={(v) => set({ edges: v === "all" ? "all" : [] })} />
                {f.edges !== "all" && <PickInfo n={f.edges.length} what="hran" hint={pickHint} onClear={() => set({ edges: [] })} />}
              </>
            );
          case "shell":
            return (
              <>
                <Num label="Tloušťka stěny" value={f.thickness} min={0.01} step={0.5} bind={b("thickness")} onChange={(v) => set({ thickness: v })} />
                <PickInfo n={f.faces.length} what="otevřených ploch" hint={pickHint} onClear={() => set({ faces: [] })} />
              </>
            );
          case "pushPull":
            return (
              <>
                <Num label="Vzdálenost" value={f.distance} step={0.5} hint="+ ven · − dovnitř" bind={b("distance")} onChange={(v) => set({ distance: v })} />
                <PickInfo n={f.faces.length} what="rovinných ploch" hint={pickHint} onClear={() => set({ faces: [] })} />
                <Info>Přímá úprava: plocha se posune po své normále. Kladná hodnota přidá materiál, záporná odebere.</Info>
              </>
            );
          case "offsetFace":
            return (
              <>
                <Num label="Odsazení" value={f.distance} step={0.1} hint="+ ven · − dovnitř" bind={b("distance")} onChange={(v) => set({ distance: v })} />
                <PickInfo n={f.faces.length} what="ploch k odsazení" hint={pickHint} onClear={() => set({ faces: [] })} />
                <Info>Funguje i na zakřivených plochách – např. odsazení stěny díry o +0,5 mm díru zmenší.</Info>
              </>
            );
          case "deleteFace":
            return (
              <>
                <PickInfo n={f.faces.length} what="ploch k odstranění" hint={pickHint} onClear={() => set({ faces: [] })} />
                <Info>Odstraní díry, čepy, kuželová zahloubení a válcová zaoblení (obnoví ostrou hranu). Vhodné pro úpravy importovaných modelů.</Info>
              </>
            );
          case "thicken":
            return (
              <>
                <Num label="Tloušťka" value={f.thickness} step={0.5} hint="+ ven · − dovnitř" bind={b("thickness")} onChange={(v) => set({ thickness: v })} />
                <PickInfo n={f.faces.length} what="ploch k zesílení" hint={pickHint} onClear={() => set({ faces: [] })} />
                {mode}
              </>
            );
          case "rib":
            return (
              <>
                <SketchPick label="Čára žebra (otevřená skica)" value={f.sketchId} sketches={sketches} onChange={(v) => set({ sketchId: v })} />
                <Num label="Tloušťka" value={f.thickness} min={0.01} step={0.5} bind={b("thickness")} onChange={(v) => set({ thickness: v })} />
                <Seg
                  label="Směr tloušťky"
                  value={f.direction}
                  options={[
                    { v: "normal", l: "Kolmo na skicu" },
                    { v: "inPlane", l: "V rovině skici" },
                  ]}
                  onChange={(v) => set({ direction: v })}
                />
                <Check label="Obrátit stranu" value={f.flip} onChange={(v) => set({ flip: v })} />
                <Info>Žebro se protáhne od čáry až k tělesu. Stranu, kde narazí na materiál, najde automaticky.</Info>
              </>
            );
          case "spring":
            return (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Num label="Průměr pružiny" value={f.radius * 2} min={0.01} bind={b("radius")} bindFactor={2} onChange={(v) => set({ radius: v / 2 })} />
                  <Num label="Průměr drátu" value={f.wire} min={0.01} step={0.1} bind={b("wire")} onChange={(v) => set({ wire: v })} />
                  <Num label="Stoupání" value={f.pitch} min={0.01} step={0.5} bind={b("pitch")} onChange={(v) => set({ pitch: v })} />
                  <Num label="Počet závitů" value={f.turns} min={0.25} step={0.5} suffix="" bind={b("turns")} onChange={(v) => set({ turns: v })} />
                </div>
                <Info>Volná délka {Math.round(f.pitch * f.turns * 100) / 100} mm</Info>
                <Seg label="Osa" value={f.axis} options={AXES} onChange={(v) => set({ axis: v })} />
                <Vec label="Poloha" value={f.position} bind={b("position")} onChange={(v) => set({ position: v })} />
                {mode}
              </>
            );
          case "draft":
            return (
              <>
                <Num label="Úhel úkosu" value={f.angle} suffix="°" step={0.5} bind={b("angle")} onChange={(v) => set({ angle: Math.max(-44, Math.min(44, v)) })} />
                <Seg label="Neutrální rovina" value={f.plane} options={AXIS_PLANES} onChange={(v) => set({ plane: v })} />
                <Num label={`Poloha roviny (${AXIS_PLANES.find((p) => p.v === f.plane)?.axis})`} value={f.offset} bind={b("offset")} onChange={(v) => set({ offset: v })} />
                <PickInfo n={f.faces.length} what="ploch ke zkosení" hint={pickHint} onClear={() => set({ faces: [] })} />
              </>
            );
          case "split": {
            const ax = AXIS_PLANES.find((p) => p.v === f.plane)?.axis ?? "Z";
            return (
              <>
                <Seg label="Řezná rovina" value={f.plane} options={AXIS_PLANES} onChange={(v) => set({ plane: v })} />
                <Num label={`Poloha roviny (${ax})`} value={f.offset} bind={b("offset")} onChange={(v) => set({ offset: v })} />
                <Seg label="Ponechat" value={f.keep} options={[{ v: "negative", l: `Stranu −${ax}` }, { v: "positive", l: `Stranu +${ax}` }]} onChange={(v) => set({ keep: v })} />
              </>
            );
          }
          case "transform":
            return (
              <>
                <Vec label="Posunutí" value={f.translate} bind={b("translate")} onChange={(v) => set({ translate: v })} />
                <div className="grid grid-cols-2 gap-2">
                  <Num label="Otočení" value={f.rotateAngle} suffix="°" bind={b("rotateAngle")} onChange={(v) => set({ rotateAngle: v })} />
                  <Num label="Měřítko" value={f.scale} min={0.0001} step={0.1} suffix="×" bind={b("scale")} onChange={(v) => set({ scale: v })} />
                </div>
                <Seg label="Osa otočení (přes počátek)" value={f.rotateAxis} options={AXES} onChange={(v) => set({ rotateAxis: v })} />
                <Info>Pořadí: měřítko → otočení → posunutí, vše vůči počátku souřadnic.</Info>
              </>
            );
          case "datum":
            return (
              <>
                <Vec label="Počátek" value={f.origin} bind={b("origin")} onChange={(v) => set({ origin: v })} />
                <Vec label="Normála" value={f.normal} onChange={(v) => set({ normal: v })} />
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
                <Num label="Velikost zobrazení" value={f.size} min={1} bind={b("size")} onChange={(v) => set({ size: v })} />
                <Info>Pomocná rovina nevytváří geometrii. Použijte ji pro novou skicu (Nová skica → pomocná rovina).</Info>
              </>
            );
          case "text":
            return (
              <>
                <Field label="Text">
                  <input className="w-full rounded-lg border border-ink-700/12 px-2.5 py-1.5 text-[13px] outline-none focus:border-brand" value={f.text} maxLength={120} onChange={(e) => set({ text: e.target.value })} />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Num label="Výška písma" value={f.height} min={0.5} bind={b("height")} onChange={(v) => set({ height: v })} />
                  <Num label="Hloubka" value={f.depth} min={0.01} step={0.1} bind={b("depth")} onChange={(v) => set({ depth: v })} />
                </div>
                <Seg label="Způsob" value={f.mode} options={[{ v: "cut", l: "Gravírovat" }, { v: "add", l: "Vystoupit" }]} onChange={(v) => set({ mode: v })} />
                {f.plane.kind === "base" ? (
                  <div className="grid grid-cols-[1fr_96px] items-end gap-2">
                    <Seg label="Rovina" value={f.plane.name} options={[{ v: "XY", l: "XY" }, { v: "XZ", l: "XZ" }, { v: "YZ", l: "YZ" }]} onChange={(v) => set({ plane: { kind: "base", name: v, offset: f.plane.kind === "base" ? f.plane.offset : 0 } })} />
                    <Num label="Odsazení" value={f.plane.offset} bind={b("plane.offset")} onChange={(v) => set({ plane: { ...f.plane, offset: v } })} />
                  </div>
                ) : (
                  <Info>Rovina: {planeLabel(f.plane)}</Info>
                )}
                <Vec label="Střed textu (v rovině)" value={f.position} bind={b("position")} onChange={(v) => set({ position: v })} />
                <Num label="Natočení" value={f.angle} suffix="°" bind={b("angle")} onChange={(v) => set({ angle: v })} />
              </>
            );
          case "pattern":
            return (
              <>
                <Field label="Opakovaný prvek">
                  <select className={selectCls} value={f.featureId} onChange={(e) => set({ featureId: e.target.value })}>
                    <option value="">— vyberte —</option>
                    {toolFeatures.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Seg
                  label="Typ pole"
                  value={f.kind}
                  options={[{ v: "linear", l: "Lineární" }, { v: "circular", l: "Kruhové" }]}
                  onChange={(v) =>
                    set(v === "linear" ? { kind: v, spacing: 20, direction: [1, 0, 0], count: f.count } : { kind: v, angle: 360, axis: "Z", center: [0, 0, 0], count: f.count })
                  }
                />
                {f.kind === "linear" ? (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <Num label="Počet kusů" value={f.count} min={1} suffix="ks" bind={b("count")} onChange={(v) => set({ count: Math.round(v) })} />
                      <Num label="Rozteč" value={f.spacing} bind={b("spacing")} onChange={(v) => set({ spacing: v })} />
                    </div>
                    <Vec label="Směr 1" value={f.direction} onChange={(v) => set({ direction: v })} />
                    <Check
                      label="Druhý směr (mřížka)"
                      value={(f.count2 ?? 1) > 1}
                      onChange={(on) => set(on ? { count2: 2, spacing2: f.spacing2 ?? f.spacing, direction2: f.direction2 ?? (Math.abs(f.direction[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]) } : { count2: 1 })}
                    />
                    {(f.count2 ?? 1) > 1 && (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          <Num label="Počet (směr 2)" value={f.count2 ?? 2} min={1} suffix="ks" bind={b("count2")} onChange={(v) => set({ count2: Math.round(v) })} />
                          <Num label="Rozteč (směr 2)" value={f.spacing2 ?? f.spacing} bind={b("spacing2")} onChange={(v) => set({ spacing2: v })} />
                        </div>
                        <Vec label="Směr 2" value={f.direction2 ?? [0, 1, 0]} onChange={(v) => set({ direction2: v })} />
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <Num label="Počet kusů" value={f.count} min={2} suffix="ks" bind={b("count")} onChange={(v) => set({ count: Math.round(v) })} />
                      <Num label="Celkový úhel" value={f.angle} suffix="°" min={1} bind={b("angle")} onChange={(v) => set({ angle: Math.min(360, v) })} />
                    </div>
                    <Seg label="Osa" value={f.axis} options={AXES} onChange={(v) => set({ axis: v })} />
                    <Vec label="Střed" value={f.center} bind={b("center")} onChange={(v) => set({ center: v })} />
                  </>
                )}
              </>
            );
          case "mirror":
            return (
              <>
                <Seg label="Rovina zrcadlení" value={f.plane} options={[{ v: "YZ", l: "YZ" }, { v: "XZ", l: "XZ" }, { v: "XY", l: "XY" }]} onChange={(v) => set({ plane: v })} />
                <Num label="Posunutí roviny" value={f.offset} bind={b("offset")} onChange={(v) => set({ offset: v })} />
                <Check label="Ponechat originál (sloučit)" value={f.keepOriginal} onChange={(v) => set({ keepOriginal: v })} />
              </>
            );
          case "import":
            return <Info>Importovaný soubor: {f.fileName} ({f.format.toUpperCase()}). Na model můžete navázat dalšími prvky (díry, zaoblení, odebrání…).</Info>;
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
  const pickScrew = (name: string) => {
    const t = threadByName(name);
    if (!t) return;
    if (kind === "counterbore") set({ diameter: t.clear, cbDiameter: t.cb?.[0] ?? t.clear * 1.8, cbDepth: t.cb?.[1] ?? t.d });
    else if (kind === "countersink") set({ diameter: t.clear, csDiameter: t.cs ?? t.clear * 2 });
    else set({ diameter: t.clear });
  };
  return (
    <>
      <Seg label="Typ díry" value={kind} options={HOLE_KINDS} onChange={changeKind} />
      {kind === "tapped" ? (
        <>
          <Field label="Závit">
            <select className={selectCls} value={thread?.name ?? ""} onChange={(e) => set({ thread: e.target.value })}>
              {!thread && <option value="">— vyberte —</option>}
              {METRIC_THREADS.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name} × {fmtMm(t.pitch)} · vrták Ø{fmtMm(t.tap)}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Num label="Hloubka díry" value={f.depth} min={0} hint="0 = skrz" bind={b("depth")} onChange={(v) => set({ depth: v })} />
            <Num label="Hloubka závitu" value={f.threadDepth ?? 0} min={0} hint="0 = celá" bind={b("threadDepth")} onChange={(v) => set({ threadDepth: v })} />
          </div>
          {thread && <Info>Vrtá se jádrový průměr Ø{fmtMm(thread.tap)} mm, závit {thread.name} se uvede ve výkrese.</Info>}
        </>
      ) : (
        <>
          <Field label="Pro šroub (průchozí díra ISO 273)">
            <select className={selectCls} value={forScrew?.name ?? ""} onChange={(e) => pickScrew(e.target.value)}>
              <option value="">— vlastní průměr —</option>
              {METRIC_THREADS.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name} · Ø{fmtMm(t.clear)}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Num label="Průměr" value={f.diameter} min={0.01} bind={b("diameter")} onChange={(v) => set({ diameter: v })} />
            <Num label="Hloubka" value={f.depth} min={0} hint="0 = skrz" bind={b("depth")} onChange={(v) => set({ depth: v })} />
          </div>
          {kind === "counterbore" && (
            <div className="grid grid-cols-2 gap-2">
              <Num label="Ø zahloubení" value={f.cbDiameter} min={0} bind={b("cbDiameter")} onChange={(v) => set({ cbDiameter: v })} />
              <Num label="Hl. zahloubení" value={f.cbDepth} min={0} bind={b("cbDepth")} onChange={(v) => set({ cbDepth: v })} />
            </div>
          )}
          {kind === "countersink" && (
            <div className="grid grid-cols-2 gap-2">
              <Num label="Ø zahloubení" value={f.csDiameter ?? 0} min={0} bind={b("csDiameter")} onChange={(v) => set({ csDiameter: v })} />
              <Num label="Úhel" value={f.csAngle ?? 90} min={30} suffix="°" bind={b("csAngle")} onChange={(v) => set({ csAngle: Math.min(170, v) })} />
            </div>
          )}
        </>
      )}
      <Vec label="Bod na povrchu" value={f.position} bind={b("position")} onChange={(v) => set({ position: v })} />
      <Seg label="Osa díry" value={f.axis} options={AXES} onChange={(v) => set({ axis: v })} />
      <Check label="Vrtat v kladném směru osy" value={f.flip} onChange={(v) => set({ flip: v })} />
      <p className="text-[11px] text-ink-700/50">Tip: klikněte na plochu modelu – bod se doplní automaticky.{f.depth > 0 ? " Slepá díra má špičku vrtáku 118°." : ""}</p>
    </>
  );
}

function SketchPick({ value, sketches, onChange, label = "Profil (skica)" }: { value: string; sketches: Feature[]; onChange: (v: string) => void; label?: string }) {
  return (
    <Field label={label}>
      <select className={selectCls} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— vyberte skicu —</option>
        {sketches.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

function PickInfo({ n, what, hint, onClear }: { n: number; what: string; hint?: string; onClear: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-brand/40 bg-brand/5 p-3 text-[12px] text-ink-700">
      <p>
        <strong>{n}</strong> {what} vybráno. {hint ?? "Klikáním v modelu přidáváte / odebíráte."}
      </p>
      {n > 0 && (
        <button type="button" onClick={onClear} className="mt-1 text-brand underline">
          Zrušit výběr
        </button>
      )}
    </div>
  );
}

// ---------- entity skici ----------

export function EntityProps({ e, onChange }: { e: SketchEntity; onChange: (n: SketchEntity) => void }) {
  const set = (p: Partial<SketchEntity>) => onChange({ ...e, ...p } as SketchEntity);
  const title = { line: "Úsečka", arc: "Oblouk", rect: "Obdélník", circle: "Kružnice", polygon: "Mnohoúhelník", slot: "Drážka", polyline: "Lomená čára", point: "Bod", ellipse: "Elipsa", spline: "Spline" }[e.type];
  const arcInfo = e.type === "arc" ? arcGeomInfo(e.a, e.b, e.c) : null;
  return (
    <div className="space-y-3">
      <p className="text-[12px] font-semibold uppercase tracking-wider text-brand">{title}</p>
      {e.type === "line" && (
        <>
          <Vec label="Počátek" value={e.a} onChange={(v) => set({ a: v })} />
          <Vec label="Konec" value={e.b} onChange={(v) => set({ b: v })} />
          <LineLength e={e} onChange={onChange} />
        </>
      )}
      {e.type === "point" && <Vec label="Poloha" value={e.p} onChange={(v) => set({ p: v })} />}
      {e.type === "ellipse" && (
        <>
          <Vec label="Střed" value={[e.cx, e.cy]} onChange={(v: Vec2) => set({ cx: v[0], cy: v[1] })} />
          <div className="grid grid-cols-2 gap-2">
            <Num label="Hlavní poloosa" value={e.rx} min={0.001} onChange={(v) => set({ rx: v })} />
            <Num label="Vedlejší poloosa" value={e.ry} min={0.001} onChange={(v) => set({ ry: v })} />
          </div>
          <Num label="Natočení" value={e.angle} suffix="°" onChange={(v) => set({ angle: v })} />
        </>
      )}
      {(e.type === "spline" || e.type === "polyline") && (
        <>
          <div className="max-h-60 space-y-1.5 overflow-y-auto pr-1">
            {e.points.map((pt, i) => (
              <Vec key={i} label={`Bod ${i + 1}`} value={pt} onChange={(v: Vec2) => set({ points: e.points.map((q, k) => (k === i ? v : q)) } as Partial<SketchEntity>)} />
            ))}
          </div>
          <Check label="Uzavřená" value={e.closed} onChange={(v) => set({ closed: v } as Partial<SketchEntity>)} />
        </>
      )}
      {e.type === "arc" && (
        <>
          <Vec label="Počátek" value={e.a} onChange={(v) => set({ a: v })} />
          <Vec label="Bod na oblouku" value={e.b} onChange={(v) => set({ b: v })} />
          <Vec label="Konec" value={e.c} onChange={(v) => set({ c: v })} />
          {arcInfo && (
            <p className="font-mono text-[11.5px] text-ink-700/60">
              R {Math.round(arcInfo.r * 1000) / 1000} · střed {Math.round(arcInfo.c[0] * 100) / 100} ; {Math.round(arcInfo.c[1] * 100) / 100}
            </p>
          )}
        </>
      )}
      {e.type === "circle" && (
        <>
          <Vec label="Střed" value={[e.cx, e.cy]} onChange={(v: Vec2) => set({ cx: v[0], cy: v[1] })} />
          <Num label="Průměr" value={e.r * 2} min={0.001} onChange={(v) => set({ r: v / 2 })} />
        </>
      )}
      {e.type === "rect" && (
        <>
          <Vec label="Střed" value={[e.cx, e.cy]} onChange={(v: Vec2) => set({ cx: v[0], cy: v[1] })} />
          <div className="grid grid-cols-2 gap-2">
            <Num label="Šířka" value={e.w} min={0.001} onChange={(v) => set({ w: v })} />
            <Num label="Výška" value={e.h} min={0.001} onChange={(v) => set({ h: v })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Num label="Zaoblení rohů" value={e.r} min={0} onChange={(v) => set({ r: v })} />
            <Num label="Natočení" value={e.angle} suffix="°" onChange={(v) => set({ angle: v })} />
          </div>
        </>
      )}
      {e.type === "polygon" && (
        <>
          <Vec label="Střed" value={[e.cx, e.cy]} onChange={(v: Vec2) => set({ cx: v[0], cy: v[1] })} />
          <div className="grid grid-cols-2 gap-2">
            <Num label="Počet stran" value={e.sides} min={3} suffix="" onChange={(v) => set({ sides: Math.round(v) })} />
            <Num label="Opsaný průměr" value={e.r * 2} min={0.001} onChange={(v) => set({ r: v / 2 })} />
          </div>
          <Num label="Rozměr přes plochy" value={2 * e.r * Math.cos(Math.PI / Math.max(3, e.sides))} min={0.001} onChange={(v) => set({ r: v / 2 / Math.cos(Math.PI / Math.max(3, e.sides)) })} />
          <Num label="Natočení" value={e.angle} suffix="°" onChange={(v) => set({ angle: v })} />
        </>
      )}
      {e.type === "slot" && (
        <>
          <Vec label="Střed" value={[e.cx, e.cy]} onChange={(v: Vec2) => set({ cx: v[0], cy: v[1] })} />
          <div className="grid grid-cols-2 gap-2">
            <Num label="Celková délka" value={e.length} min={0.001} onChange={(v) => set({ length: v })} />
            <Num label="Šířka" value={e.width} min={0.001} onChange={(v) => set({ width: v })} />
          </div>
          <Num label="Natočení" value={e.angle} suffix="°" onChange={(v) => set({ angle: v })} />
        </>
      )}
      <Check label="Pomocná geometrie (netvoří profil)" value={!!e.construction} onChange={(v) => set({ construction: v })} />
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
      <Num label="Délka" value={len} min={0.001} onChange={(v) => setPolar(v, ang)} />
      <Num label="Úhel" value={ang} suffix="°" onChange={(v) => setPolar(len, v)} />
    </div>
  );
}

export { FEATURE_LABEL };
