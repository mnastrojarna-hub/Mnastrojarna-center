"use client";

import { useEffect, useState } from "react";
import { FEATURE_LABEL, planeLabel } from "@/cad/defaults";
import type { BoolMode, CadDoc, Feature, SketchEntity, Vec2, Vec3 } from "@/cad/types";
import { cn } from "@/lib/cn";

// ---------- základní pole ----------

export function Num({ label, value, onChange, step = 1, min, suffix = "mm", hint }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; suffix?: string; hint?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(Math.round(value * 1e4) / 1e4)), [value]);
  const commit = (t: string) => {
    // podpora jednoduchých výrazů: 25/2, 10+5*2
    const clean = t.replace(",", ".").replace(/[^0-9+\-*/(). ]/g, "");
    let v = Number(clean);
    if (!Number.isFinite(v)) {
      try {
        v = Function(`"use strict";return (${clean})`)() as number;
      } catch {
        v = NaN;
      }
    }
    if (Number.isFinite(v)) {
      if (min != null) v = Math.max(min, v);
      onChange(v);
    } else setText(String(value));
  };
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-ink-700/55">
        {label}
        {hint && <span className="normal-case tracking-normal text-ink-700/40">{hint}</span>}
      </span>
      <span className="flex items-center rounded-lg border border-ink-700/12 bg-white focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15">
        <input
          className="w-full min-w-0 bg-transparent px-2.5 py-1.5 font-mono text-[13px] text-ink-700 outline-none"
          value={text}
          inputMode="decimal"
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              const v = value + (e.key === "ArrowUp" ? step : -step) * (e.shiftKey ? 10 : 1);
              onChange(min != null ? Math.max(min, v) : v);
            }
          }}
        />
        {suffix && <span className="pr-2.5 font-mono text-[11px] text-ink-700/40">{suffix}</span>}
      </span>
    </label>
  );
}

export function Vec({ label, value, onChange }: { label: string; value: Vec3 | Vec2; onChange: (v: never) => void }) {
  const names = ["X", "Y", "Z"];
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{label}</p>
      <div className={cn("grid gap-1.5", value.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
        {value.map((v, i) => (
          <Num key={i} label={names[i]} value={v} suffix="" onChange={(n) => onChange(value.map((x, k) => (k === i ? n : x)) as never)} />
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
const AXES = [
  { v: "X" as const, l: "X" },
  { v: "Y" as const, l: "Y" },
  { v: "Z" as const, l: "Z" },
];

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
  const sketches = doc.features.filter((x) => x.type === "sketch");
  const toolFeatures = doc.features.filter((x) => ["extrude", "revolve", "box", "cylinder", "sphere", "cone", "tube", "hole"].includes(x.type) && x.id !== f.id);
  const mode = "mode" in f ? <Seg label="Operace" value={f.mode === "new" ? "add" : f.mode} options={MODES} onChange={(v) => set({ mode: v })} /> : null;

  return (
    <div className="space-y-3.5">
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55">Název</span>
        <input className="w-full rounded-lg border border-ink-700/12 px-2.5 py-1.5 text-[13px] outline-none focus:border-brand" value={f.name} onChange={(e) => set({ name: e.target.value })} />
      </label>
      {(() => {
        switch (f.type) {
          case "sketch":
            return <p className="rounded-lg bg-steel-100 p-3 text-[12px] text-ink-700/70">Rovina: {planeLabel(f.plane)} · {f.entities.length} entit</p>;
          case "extrude":
            return (
              <>
                <SketchPick value={f.sketchId} sketches={sketches} onChange={(v) => set({ sketchId: v })} />
                <Num label="Vzdálenost" value={f.distance} min={0.001} onChange={(v) => set({ distance: v })} />
                <div className="flex gap-4">
                  <Check label="Symetricky" value={f.symmetric} onChange={(v) => set({ symmetric: v })} />
                  <Check label="Opačný směr" value={f.reverse} onChange={(v) => set({ reverse: v })} />
                </div>
                {mode}
              </>
            );
          case "revolve":
            return (
              <>
                <SketchPick value={f.sketchId} sketches={sketches} onChange={(v) => set({ sketchId: v })} />
                <Seg label="Osa rotace (ve skice)" value={f.axis} options={[{ v: "y", l: "Svislá osa Y" }, { v: "x", l: "Vodorovná osa X" }]} onChange={(v) => set({ axis: v })} />
                <Num label="Úhel" value={f.angle} min={1} suffix="°" onChange={(v) => set({ angle: Math.min(360, v) })} />
                {mode}
              </>
            );
          case "box":
            return (
              <>
                <Vec label="Rozměry (X × Y × Z)" value={f.size} onChange={(v) => set({ size: v })} />
                <Vec label="Poloha" value={f.position} onChange={(v) => set({ position: v })} />
                <Check label="Poloha = střed kvádru" value={f.centered} onChange={(v) => set({ centered: v })} />
                {mode}
              </>
            );
          case "cylinder":
            return (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Num label="Průměr" value={f.radius * 2} min={0.001} onChange={(v) => set({ radius: v / 2 })} />
                  <Num label="Výška" value={f.height} min={0.001} onChange={(v) => set({ height: v })} />
                </div>
                <Seg label="Osa" value={f.axis} options={AXES} onChange={(v) => set({ axis: v })} />
                <Vec label="Poloha podstavy" value={f.position} onChange={(v) => set({ position: v })} />
                {mode}
              </>
            );
          case "sphere":
            return (
              <>
                <Num label="Průměr" value={f.radius * 2} min={0.001} onChange={(v) => set({ radius: v / 2 })} />
                <Vec label="Střed" value={f.position} onChange={(v) => set({ position: v })} />
                {mode}
              </>
            );
          case "cone":
            return (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <Num label="Ø dole" value={f.radius1 * 2} min={0} onChange={(v) => set({ radius1: v / 2 })} />
                  <Num label="Ø nahoře" value={f.radius2 * 2} min={0} onChange={(v) => set({ radius2: v / 2 })} />
                  <Num label="Výška" value={f.height} min={0.001} onChange={(v) => set({ height: v })} />
                </div>
                <Seg label="Osa" value={f.axis} options={AXES} onChange={(v) => set({ axis: v })} />
                <Vec label="Poloha podstavy" value={f.position} onChange={(v) => set({ position: v })} />
                {mode}
              </>
            );
          case "tube":
            return (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <Num label="Ø vnější" value={f.outer} min={0.001} onChange={(v) => set({ outer: v })} />
                  <Num label="Ø vnitřní" value={f.inner} min={0} onChange={(v) => set({ inner: v })} />
                  <Num label="Délka" value={f.height} min={0.001} onChange={(v) => set({ height: v })} />
                </div>
                <Seg label="Osa" value={f.axis} options={AXES} onChange={(v) => set({ axis: v })} />
                <Vec label="Poloha podstavy" value={f.position} onChange={(v) => set({ position: v })} />
                {mode}
              </>
            );
          case "hole":
            return (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Num label="Průměr" value={f.diameter} min={0.01} onChange={(v) => set({ diameter: v })} />
                  <Num label="Hloubka" value={f.depth} min={0} hint="0 = skrz" onChange={(v) => set({ depth: v })} />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[3.4, 4.5, 5.5, 6.6, 9, 11, 13.5, 17.5].map((d) => (
                    <button key={d} type="button" onClick={() => set({ diameter: d })} className={cn("rounded-full border px-2 py-0.5 font-mono text-[11px]", f.diameter === d ? "border-brand bg-brand text-white" : "border-ink-700/15 text-ink-700/70 hover:border-ink-700/40")}>
                      M{({ 3.4: 3, 4.5: 4, 5.5: 5, 6.6: 6, 9: 8, 11: 10, 13.5: 12, 17.5: 16 } as Record<number, number>)[d]}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Num label="Ø zahloubení" value={f.cbDiameter} min={0} hint="0 = bez" onChange={(v) => set({ cbDiameter: v })} />
                  <Num label="Hl. zahloubení" value={f.cbDepth} min={0} onChange={(v) => set({ cbDepth: v })} />
                </div>
                <Vec label="Bod na povrchu" value={f.position} onChange={(v) => set({ position: v })} />
                <Seg label="Osa díry" value={f.axis} options={AXES} onChange={(v) => set({ axis: v })} />
                <Check label="Vrtat v kladném směru osy" value={f.flip} onChange={(v) => set({ flip: v })} />
                <p className="text-[11px] text-ink-700/50">Tip: klikněte na plochu modelu – bod se doplní automaticky.</p>
              </>
            );
          case "fillet":
          case "chamfer":
            return (
              <>
                {f.type === "fillet" ? (
                  <Num label="Poloměr" value={f.radius} min={0.01} step={0.5} onChange={(v) => set({ radius: v })} />
                ) : (
                  <Num label="Velikost sražení" value={f.distance} min={0.01} step={0.5} onChange={(v) => set({ distance: v })} />
                )}
                <Seg label="Hrany" value={f.edges === "all" ? "all" : "pick"} options={[{ v: "pick", l: "Vybrané" }, { v: "all", l: "Všechny" }]} onChange={(v) => set({ edges: v === "all" ? "all" : [] })} />
                {f.edges !== "all" && <PickInfo n={f.edges.length} what="hran" hint={pickHint} onClear={() => set({ edges: [] })} />}
              </>
            );
          case "shell":
            return (
              <>
                <Num label="Tloušťka stěny" value={f.thickness} min={0.01} step={0.5} onChange={(v) => set({ thickness: v })} />
                <PickInfo n={f.faces.length} what="otevřených ploch" hint={pickHint} onClear={() => set({ faces: [] })} />
              </>
            );
          case "pattern":
            return (
              <>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55">Opakovaný prvek</span>
                  <select className="w-full rounded-lg border border-ink-700/12 bg-white px-2 py-1.5 text-[13px]" value={f.featureId} onChange={(e) => set({ featureId: e.target.value })}>
                    <option value="">— vyberte —</option>
                    {toolFeatures.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Seg
                  label="Typ pole"
                  value={f.kind}
                  options={[{ v: "linear", l: "Lineární" }, { v: "circular", l: "Kruhové" }]}
                  onChange={(v) =>
                    set(v === "linear" ? { kind: v, spacing: 20, direction: [1, 0, 0], count: f.count } : { kind: v, angle: 360, axis: "Z", center: [0, 0, 0], count: f.count })
                  }
                />
                <Num label="Počet kusů" value={f.count} min={2} suffix="ks" onChange={(v) => set({ count: Math.round(v) })} />
                {f.kind === "linear" ? (
                  <>
                    <Num label="Rozteč" value={f.spacing} onChange={(v) => set({ spacing: v })} />
                    <Vec label="Směr" value={f.direction} onChange={(v) => set({ direction: v })} />
                  </>
                ) : (
                  <>
                    <Num label="Celkový úhel" value={f.angle} suffix="°" min={1} onChange={(v) => set({ angle: Math.min(360, v) })} />
                    <Seg label="Osa" value={f.axis} options={AXES} onChange={(v) => set({ axis: v })} />
                    <Vec label="Střed" value={f.center} onChange={(v) => set({ center: v })} />
                  </>
                )}
              </>
            );
          case "mirror":
            return (
              <>
                <Seg label="Rovina zrcadlení" value={f.plane} options={[{ v: "YZ", l: "YZ" }, { v: "XZ", l: "XZ" }, { v: "XY", l: "XY" }]} onChange={(v) => set({ plane: v })} />
                <Num label="Posunutí roviny" value={f.offset} onChange={(v) => set({ offset: v })} />
                <Check label="Ponechat originál (sloučit)" value={f.keepOriginal} onChange={(v) => set({ keepOriginal: v })} />
              </>
            );
          case "import":
            return <p className="rounded-lg bg-steel-100 p-3 text-[12px] text-ink-700/70">Importovaný soubor: {f.fileName}. Na model můžete navázat dalšími prvky (díry, zaoblení, odebrání…).</p>;
        }
      })()}
    </div>
  );
}

function SketchPick({ value, sketches, onChange }: { value: string; sketches: Feature[]; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55">Profil (skica)</span>
      <select className="w-full rounded-lg border border-ink-700/12 bg-white px-2 py-1.5 text-[13px]" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— vyberte skicu —</option>
        {sketches.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
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
  const title = { line: "Úsečka", arc: "Oblouk", rect: "Obdélník", circle: "Kružnice", polygon: "Mnohoúhelník", slot: "Drážka", polyline: "Lomená čára" }[e.type];
  return (
    <div className="space-y-3">
      <p className="text-[12px] font-semibold uppercase tracking-wider text-brand">{title}</p>
      {e.type === "line" && (
        <>
          <Vec label="Počátek" value={e.a} onChange={(v) => set({ a: v })} />
          <Vec label="Konec" value={e.b} onChange={(v) => set({ b: v })} />
          <LineLength e={e} onChange={onChange} />
          <Check label="Konstrukční čára" value={!!e.construction} onChange={(v) => set({ construction: v })} />
        </>
      )}
      {e.type === "arc" && (
        <>
          <Vec label="Počátek" value={e.a} onChange={(v) => set({ a: v })} />
          <Vec label="Bod na oblouku" value={e.b} onChange={(v) => set({ b: v })} />
          <Vec label="Konec" value={e.c} onChange={(v) => set({ c: v })} />
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
      {e.type === "polyline" && <p className="text-[12px] text-ink-700/60">{e.points.length} bodů · {e.closed ? "uzavřená" : "otevřená"}. Body upravíte tažením.</p>}
    </div>
  );
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
