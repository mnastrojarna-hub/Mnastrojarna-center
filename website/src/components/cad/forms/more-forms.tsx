"use client";
/**
 * Formuláře 5. vlny (modul refs-more): primitiva, pružina, závit, text, transformace a Vytáhnout/Zatlačit
 * s polohou / osou / ukončením odkazem + pomocná osa, pomocný bod a souřadný systém.
 * Registrace přes `registerFeatureForm` – vestavěné větve v `props.tsx` se nepoužijí.
 */
import { tr } from "@/cad/i18n";
import { useEffect, useState } from "react";
import { cad } from "@/cad/client";
import { ALL_THREADS, planeLabel, threadByName } from "@/cad/defaults";
import { AXIS_KINDS, EXTENT_KINDS, NO_EDGE, NO_FACE, NO_REF, fmtVec, isPlaceholder, type AxisDef, type Direction, type Extent, type Ref } from "@/cad/refs";
import type { Axis, CadDoc, Feature, Vec3 } from "@/cad/types";
import { cn } from "@/lib/cn";
import { AXES, Check, Details, Field, Info, Num, PickInfo, Seg, Vec, selectCls } from "../props";
import { DirectionField, PlaneDefField, RefField } from "../ref-field";
import { registerFeatureForm, type FeatureFormProps } from "./registry";

type Set = (patch: Record<string, unknown>) => void;
const fmtMm = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", ",");
/** „Vymazat“ v poli odkazu vrací placeholder – u volitelných odkazů znamená „bez odkazu“. */
const opt = (r: Ref): Ref | undefined => (isPlaceholder(r) ? undefined : r);
/** Prvky historie před tímto prvkem (odkazy smí mířit jen dozadu). */
function before(doc: CadDoc, f: Feature): Feature[] {
  const i = doc.features.findIndex((x) => x.id === f.id);
  return i >= 0 ? doc.features.slice(0, i) : doc.features;
}

// ---------------- společná pole ----------------

/** Poloha: odkazem (vrchol, střed hrany, střed kružnice, bod skici, odvozený bod…) nebo čísly. */
function PositionField({ label = tr("Poloha"), value, refValue, bind, set }: { label?: string; value: Vec3; refValue: Ref | undefined; bind: string; set: Set }) {
  return (
    <div className="space-y-1.5">
      <RefField label={`${label} odkazem`} value={refValue} want="point" hint={refValue ? tr("Vymazat = zpět na čísla") : tr("volitelné")} onChange={(r) => set({ positionRef: opt(r) })} />
      {refValue ? (
        <button type="button" onClick={() => set({ positionRef: undefined })} className="text-[11.5px] text-brand hover:underline">
          {tr("Zadat čísly (naposledy")}{" "}{fmtVec(value)})
        </button>
      ) : (
        <Vec label={label} value={value} bind={bind} onChange={(v) => set({ position: v })} />
      )}
    </div>
  );
}

/** Osa X / Y / Z, nebo libovolný směr (hrana, osa válce, dva body, normála plochy, vektor). */
function AxisDirField({ axis, dirDef, set, label = tr("Osa") }: { axis?: Axis; dirDef: Direction | undefined; set: Set; label?: string }) {
  const def: Direction = { kind: "axis", axis: axis ?? "Z" };
  return (
    <div className="space-y-1.5">
      {!dirDef && axis && <Seg label={label} value={axis} options={AXES} onChange={(v) => set({ axis: v })} />}
      <Check label={tr("{0} libovolným směrem (hrana, osa válce, dva body, normála plochy, vektor)", label)} value={!!dirDef} onChange={(on) => set({ dirDef: on ? def : undefined })} />
      {dirDef && <DirectionField label={label} value={dirDef} allowNormal={false} onChange={(d) => set({ dirDef: d ?? def })} />}
    </div>
  );
}

/** Výběr prvku pomocné geometrie z historie (jen prvky před aktuálním). */
function DatumSelect({ value, onChange, types, list, placeholder }: { value: string; onChange: (id: string) => void; types: Feature["type"][]; list: Feature[]; placeholder: string }) {
  const items = list.filter((x) => types.includes(x.type) && !x.suppressed);
  return (
    <select className={selectCls} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{items.length ? `— ${placeholder} —` : tr("— žádná {0} před tímto prvkem —", placeholder)}</option>
      {items.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </select>
  );
}

const AXIS_OPTS: { v: AxisDef["kind"]; l: string }[] = [
  ...AXIS_KINDS.filter((k) => k.v !== "sketchX" && k.v !== "sketchY" && k.v !== "sketchLine"),
  { v: "twoPlanes", l: tr("Průsečnice dvou rovin") },
  { v: "datumAxis", l: tr("Pomocná osa / osa Z souřadného systému") },
];
function defaultAxisDef(kind: AxisDef["kind"]): AxisDef {
  switch (kind) {
    case "global":
      return { kind, axis: "Z" };
    case "edge":
      return { kind, ref: NO_EDGE };
    case "cylFace":
      return { kind, ref: NO_FACE };
    case "twoPoints":
      return { kind, a: NO_REF, b: NO_REF };
    case "twoPlanes":
      return { kind, a: NO_FACE, b: NO_FACE };
    case "datum":
    case "datumAxis":
      return { kind, featureId: "" };
    default:
      return { kind: "global", axis: "Z" };
  }
}

/** Osa modelem (bez os skici): hrana, válcová plocha, dva body, globální osa, pomocná rovina, průsečnice rovin, pomocná osa. */
export function AxisDefField({ label = tr("Osa"), value, onChange, allowNone, noneLabel = tr("Globální osa X / Y / Z (níže)"), list }: { label?: string; value: AxisDef | undefined; onChange: (a: AxisDef | undefined) => void; allowNone?: boolean; noneLabel?: string; list: Feature[] }) {
  const v = value;
  return (
    <div className="space-y-2 rounded-lg border border-ink-700/10 bg-steel-50/60 p-2">
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{label}</span>
        <select className={selectCls} value={v?.kind ?? "none"} onChange={(e) => onChange(e.target.value === "none" ? undefined : defaultAxisDef(e.target.value as AxisDef["kind"]))}>
          {allowNone && <option value="none">{noneLabel}</option>}
          {AXIS_OPTS.map((k) => (
            <option key={k.v} value={k.v}>
              {k.l}
            </option>
          ))}
        </select>
      </label>
      {v?.kind === "global" && (
        <div className="flex gap-1">
          {(["X", "Y", "Z"] as Axis[]).map((a) => (
            <button key={a} type="button" onClick={() => onChange({ kind: "global", axis: a })} className={cn("flex-1 rounded-md border px-2 py-1 text-[12px]", v.axis === a ? "border-brand bg-brand/10 text-brand" : "border-ink-700/12 bg-white")}>
              {a}
            </button>
          ))}
        </div>
      )}
      {v?.kind === "edge" && <RefField label={tr("Přímá hrana")} value={v.ref} want="edge" onChange={(ref) => onChange({ kind: "edge", ref })} />}
      {v?.kind === "cylFace" && <RefField label={tr("Válcová / kuželová plocha")} value={v.ref} want="face" onChange={(ref) => onChange({ kind: "cylFace", ref })} />}
      {v?.kind === "twoPoints" && (
        <>
          <RefField label={tr("První bod")} value={v.a} want="point" onChange={(a) => onChange({ ...v, a })} />
          <RefField label={tr("Druhý bod")} value={v.b} want="point" onChange={(b) => onChange({ ...v, b })} />
        </>
      )}
      {v?.kind === "twoPlanes" && (
        <>
          <RefField label={tr("1. rovina (plocha / pomocná rovina)")} value={v.a} want="face" onChange={(a) => onChange({ ...v, a })} />
          <RefField label={tr("2. rovina (plocha / pomocná rovina)")} value={v.b} want="face" onChange={(b) => onChange({ ...v, b })} />
        </>
      )}
      {v?.kind === "datum" && <DatumSelect value={v.featureId} types={["datum"]} list={list} placeholder={tr("pomocná rovina")} onChange={(featureId) => onChange({ kind: "datum", featureId })} />}
      {v?.kind === "datumAxis" && <DatumSelect value={v.featureId} types={["datumAxis", "csys"]} list={list} placeholder={tr("pomocná osa")} onChange={(featureId) => onChange({ kind: "datumAxis", featureId })} />}
    </div>
  );
}

/** Živý popis vyřešené pomocné geometrie (bod / směr) podle odkazu na prvek. */
function DatumInfo({ doc, ref }: { doc: CadDoc; ref: Ref }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    const t = setTimeout(() => {
      cad.refInfo(doc, ref).then(
        (r) => {
          if (dead) return;
          if (r.error) return setText("⚠ " + r.error);
          const g = r.geo;
          if (!g?.point) return setText(null);
          setText(`${g.kindLabel ?? ""}: bod ${fmtVec(g.point)}${g.dir ? ` · směr ${fmtVec(g.dir)}` : ""}`.trim());
        },
        () => undefined,
      );
    }, 180);
    return () => {
      dead = true;
      clearTimeout(t);
    };
  }, [doc, ref]);
  return text ? <p className={cn("rounded-lg px-3 py-2 text-[11.5px]", text.startsWith("⚠") ? "bg-brand/5 text-brand" : "bg-steel-100 text-ink-700/70")}>{text}</p> : null;
}

// ---------------- primitiva ----------------

registerFeatureForm("box", ({ f, set, b, mode }) => (
  <>
    <Vec label={tr("Rozměry (X × Y × Z)")} value={f.size} bind={b("size")} onChange={(v) => set({ size: v })} />
    <PositionField value={f.position} refValue={f.positionRef} bind={b("position")} set={set} />
    <Check label={tr("Poloha = střed kvádru")} value={f.centered} onChange={(v) => set({ centered: v })} />
    <AxisDirField label={tr("Osa Z kvádru")} dirDef={f.dirDef} set={set} />
    {mode}
  </>
));

registerFeatureForm("cylinder", ({ f, set, b, mode }) => (
  <>
    <div className="grid grid-cols-2 gap-2">
      <Num label={tr("Průměr")} value={f.radius * 2} min={0.001} bind={b("radius")} bindFactor={2} onChange={(v) => set({ radius: v / 2 })} />
      <Num label={tr("Výška")} value={f.height} min={0.001} bind={b("height")} onChange={(v) => set({ height: v })} />
    </div>
    <AxisDirField axis={f.axis} dirDef={f.dirDef} set={set} />
    <PositionField label={tr("Poloha podstavy")} value={f.position} refValue={f.positionRef} bind={b("position")} set={set} />
    {mode}
  </>
));

registerFeatureForm("sphere", ({ f, set, b, mode }) => (
  <>
    <Num label={tr("Průměr")} value={f.radius * 2} min={0.001} bind={b("radius")} bindFactor={2} onChange={(v) => set({ radius: v / 2 })} />
    <PositionField label={tr("Střed")} value={f.position} refValue={f.positionRef} bind={b("position")} set={set} />
    {mode}
  </>
));

registerFeatureForm("cone", ({ f, set, b, mode }) => (
  <>
    <div className="grid grid-cols-3 gap-2">
      <Num label={tr("Ø dole")} value={f.radius1 * 2} min={0} bind={b("radius1")} bindFactor={2} onChange={(v) => set({ radius1: v / 2 })} />
      <Num label={tr("Ø nahoře")} value={f.radius2 * 2} min={0} bind={b("radius2")} bindFactor={2} onChange={(v) => set({ radius2: v / 2 })} />
      <Num label={tr("Výška")} value={f.height} min={0.001} bind={b("height")} onChange={(v) => set({ height: v })} />
    </div>
    <AxisDirField axis={f.axis} dirDef={f.dirDef} set={set} />
    <PositionField label={tr("Poloha podstavy")} value={f.position} refValue={f.positionRef} bind={b("position")} set={set} />
    {mode}
  </>
));

registerFeatureForm("tube", ({ f, set, b, mode }) => (
  <>
    <div className="grid grid-cols-3 gap-2">
      <Num label={tr("Ø vnější")} value={f.outer} min={0.001} bind={b("outer")} onChange={(v) => set({ outer: v })} />
      <Num label={tr("Ø vnitřní")} value={f.inner} min={0} bind={b("inner")} onChange={(v) => set({ inner: v })} />
      <Num label={tr("Délka")} value={f.height} min={0.001} bind={b("height")} onChange={(v) => set({ height: v })} />
    </div>
    <AxisDirField axis={f.axis} dirDef={f.dirDef} set={set} />
    <PositionField label={tr("Poloha podstavy")} value={f.position} refValue={f.positionRef} bind={b("position")} set={set} />
    {mode}
  </>
));

// ---------------- pružina, závit, text ----------------

registerFeatureForm("spring", ({ f, set, b, mode }) => (
  <>
    <div className="grid grid-cols-2 gap-2">
      <Num label={tr("Průměr pružiny")} value={f.radius * 2} min={0.01} bind={b("radius")} bindFactor={2} onChange={(v) => set({ radius: v / 2 })} />
      <Num label={tr("Průměr drátu")} value={f.wire} min={0.01} step={0.1} bind={b("wire")} onChange={(v) => set({ wire: v })} />
      <Num label={tr("Stoupání")} value={f.pitch} min={0.01} step={0.5} bind={b("pitch")} onChange={(v) => set({ pitch: v })} />
      <Num label={tr("Počet závitů")} value={f.turns} min={0.25} step={0.5} suffix="" bind={b("turns")} onChange={(v) => set({ turns: v })} />
    </div>
    <Info>{tr("Volná délka")}{" "}{Math.round(f.pitch * f.turns * 100) / 100} mm</Info>
    <AxisDirField axis={f.axis} dirDef={f.dirDef} set={set} />
    <PositionField label={tr("Poloha (začátek osy)")} value={f.position} refValue={f.positionRef} bind={b("position")} set={set} />
    {mode}
  </>
));

registerFeatureForm("thread", ({ f, set, b }) => {
  const t = threadByName(f.designation);
  const known = !!t && ALL_THREADS.some((x) => x.name === t.name);
  return (
    <>
      <Field label={tr("Závit (ISO metrický – hrubé i jemné stoupání)")}>
        <select className={selectCls} value={known ? t!.name : "custom"} onChange={(e) => e.target.value !== "custom" && set({ designation: e.target.value })}>
          {!known && <option value="custom">{t ? tr("{0} (vlastní stoupání)", t.name) : tr("— vyberte nebo zadejte níže —")}</option>}
          {ALL_THREADS.map((x) => (
            <option key={x.name} value={x.name}>
              {x.name}{x.name.includes("×") ? "" : ` × ${fmtMm(x.pitch)}`}
            </option>
          ))}
        </select>
      </Field>
      <Field label={tr("Označení (text)")}>
        <input className="w-full rounded-lg border border-ink-700/12 px-2.5 py-1.5 font-mono text-[13px] outline-none focus:border-brand" aria-label={tr("Označení závitu")} value={f.designation} placeholder={tr("např. M18×1,5")} onChange={(e) => set({ designation: e.target.value })} />
        {!t && f.designation.trim() && <span className="mt-1 block text-[11px] text-brand-600">{tr("Neznámé označení – zadejte M2 až M48, volitelně se stoupáním (M18×1,5).")}</span>}
      </Field>
      <Check label={tr("Vnitřní závit (v díře)")} value={!!f.internal} onChange={(v) => set({ internal: v })} />
      <Num label={tr("Délka závitu")} value={f.length} min={0.1} bind={b("length")} onChange={(v) => set({ length: v })} />
      <AxisDirField axis={f.axis} dirDef={f.dirDef} set={set} />
      <PositionField label={tr("Začátek závitu (na ose)")} value={f.position} refValue={f.positionRef} bind={b("position")} set={set} />
      <Info>{tr("Tip: začátek = střed kružnice konce válce / díry (⋯ → Střed kružnice), osa = „Podél hrany / osy válce“ s válcovou plochou.")}</Info>
      <Check label={tr("Modelovat závitové drážky")} value={f.modeled} onChange={(v) => set({ modeled: v })} />
      <Info>
        {f.modeled ? tr("Závit se vymodeluje jako drážky (zjednodušeně, bez stoupání) – vhodné pro vizualizaci a 3D tisk. Skutečnou šroubovici dává Plochy → Tažení po šroubovici (profil Závit 60°).") : tr("Kosmetický závit: geometrie se nemění, závit se uvede ve výkrese (kružnice válce / jádra díry se kótuje označením). Doporučeno pro výrobní dokumentaci.")}
        {t && tr(" Jmenovitý Ø {0} mm, stoupání {1} mm{2}.", fmtMm(t.d), fmtMm(t.pitch), f.internal ? tr(", jádro díry Ø {0} mm", fmtMm(t.tap)) : "")}
      </Info>
    </>
  );
});

registerFeatureForm("text", ({ f, set, b }) => (
  <>
    <Field label={tr("Text")}>
      <input className="w-full rounded-lg border border-ink-700/12 px-2.5 py-1.5 text-[13px] outline-none focus:border-brand" value={f.text} maxLength={120} onChange={(e) => set({ text: e.target.value })} />
    </Field>
    <div className="grid grid-cols-2 gap-2">
      <Num label={tr("Výška písma")} value={f.height} min={0.5} bind={b("height")} onChange={(v) => set({ height: v })} />
      <Num label={tr("Hloubka")} value={f.depth} min={0.01} step={0.1} bind={b("depth")} onChange={(v) => set({ depth: v })} />
    </div>
    <Seg label={tr("Způsob")} value={f.mode} options={[{ v: "cut", l: tr("Gravírovat") }, { v: "add", l: tr("Vystoupit") }]} onChange={(v) => set({ mode: v })} />
    <PlaneDefField label={tr("Rovina textu")} value={f.planeDef} allowNone noneLabel={f.plane.kind === "base" ? tr("Základní rovina + odsazení (níže)") : tr("Pevná rovina ({0})", planeLabel(f.plane))} onChange={(planeDef) => set({ planeDef })} />
    {!f.planeDef && f.plane.kind === "base" && (
      <div className="grid grid-cols-[1fr_96px] items-end gap-2">
        <Seg label={tr("Rovina")} value={f.plane.name} options={[{ v: "XY", l: "XY" }, { v: "XZ", l: "XZ" }, { v: "YZ", l: "YZ" }]} onChange={(v) => set({ plane: { kind: "base", name: v, offset: f.plane.kind === "base" ? f.plane.offset : 0 } })} />
        <Num label={tr("Odsazení")} value={f.plane.offset} bind={b("plane.offset")} onChange={(v) => set({ plane: { ...f.plane, offset: v } })} />
      </div>
    )}
    <RefField label={tr("Střed textu odkazem")} value={f.positionRef} want="point" hint={f.positionRef ? tr("Vymazat = zpět na čísla") : tr("volitelné – bod se promítne do roviny")} onChange={(r) => set({ positionRef: opt(r) })} />
    {!f.positionRef && <Vec label={tr("Střed textu (v rovině)")} value={f.position} bind={b("position")} onChange={(v) => set({ position: v })} />}
    <Num label={tr("Natočení")} value={f.angle} suffix="°" bind={b("angle")} onChange={(v) => set({ angle: v })} />
  </>
));

// ---------------- transformace ----------------

registerFeatureForm("transform", ({ f, doc, set, b }) => {
  const list = before(doc, f);
  return (
    <>
      <Vec label={tr("Posunutí")} value={f.translate} bind={b("translate")} onChange={(v) => set({ translate: v })} />
      <Details summary={tr("Posun z bodu do bodu")} open={!!f.translateRef}>
        <Check label={tr("Posunout z bodu do bodu (přičte se k posunutí výše)")} value={!!f.translateRef} onChange={(on) => set({ translateRef: on ? { a: NO_REF, b: NO_REF } : undefined })} />
        {f.translateRef && (
          <>
            <RefField label={tr("Z bodu")} value={f.translateRef.a} want="point" onChange={(a) => set({ translateRef: { ...f.translateRef, a } })} />
            <RefField label={tr("Do bodu")} value={f.translateRef.b} want="point" onChange={(b2) => set({ translateRef: { ...f.translateRef, b: b2 } })} />
          </>
        )}
      </Details>
      <div className="grid grid-cols-2 gap-2">
        <Num label={tr("Otočení")} value={f.rotateAngle} suffix="°" bind={b("rotateAngle")} onChange={(v) => set({ rotateAngle: v })} />
        <Num label={tr("Měřítko")} value={f.scale} min={0.0001} step={0.1} suffix="×" bind={b("scale")} onChange={(v) => set({ scale: v })} />
      </div>
      <AxisDefField label={tr("Osa otočení")} value={f.rotateAxisDef} allowNone noneLabel={tr("Globální osa X / Y / Z středem (níže)")} list={list} onChange={(rotateAxisDef) => set({ rotateAxisDef })} />
      {!f.rotateAxisDef && <Seg label={tr("Globální osa otočení")} value={f.rotateAxis} options={AXES} onChange={(v) => set({ rotateAxis: v })} />}
      <RefField label={tr("Střed měřítka a otáčení")} value={f.centerRef} want="point" hint={f.centerRef ? tr("Vymazat = počátek") : tr("volitelné – jinak počátek")} onChange={(r) => set({ centerRef: opt(r) })} />
      <Info>{tr("Pořadí: měřítko (kolem středu) → otočení (kolem zadané osy, nebo globální osy středem) → posunutí (čísla + z bodu do bodu).")}</Info>
    </>
  );
});

// ---------------- Vytáhnout / Zatlačit ----------------

const PP_KINDS: Extent["kind"][] = ["blind", "toVertex", "toFace", "offsetFromFace"];
registerFeatureForm("pushPull", ({ f, doc, set, b, pickHint }) => {
  const e: Extent = f.extent ?? { kind: "blind", d: f.distance };
  const change = (kind: Extent["kind"]) => {
    if (kind === "blind") return set({ extent: undefined });
    if (kind === "toVertex") return set({ extent: { kind, ref: NO_REF } });
    if (kind === "toFace") return set({ extent: { kind, ref: NO_FACE, offset: 0 } });
    return set({ extent: { kind: "offsetFromFace", ref: NO_FACE, d: 5 } });
  };
  return (
    <>
      <Field label={tr("Ukončení")}>
        <select className={selectCls} value={e.kind} onChange={(ev) => change(ev.target.value as Extent["kind"])}>
          {EXTENT_KINDS.filter((k) => PP_KINDS.includes(k.v)).map((k) => (
            <option key={k.v} value={k.v} title={k.hint}>
              {k.l}
            </option>
          ))}
        </select>
      </Field>
      {e.kind === "blind" && <Num label={tr("Vzdálenost")} value={f.distance} step={0.5} hint={tr("+ ven · − dovnitř")} bind={b("distance")} onChange={(v) => set({ distance: v })} />}
      {e.kind === "toVertex" && <RefField label={tr("Vrchol / bod")} value={e.ref} want="point" onChange={(ref) => set({ extent: { ...e, ref } })} />}
      {(e.kind === "toFace" || e.kind === "offsetFromFace") && (
        <>
          <RefField label={tr("Cílová plocha / pomocná rovina")} value={e.ref} want="face" onChange={(ref) => set({ extent: { ...e, ref } })} />
          <Num label={e.kind === "toFace" ? tr("Odsazení od plochy (0 = až k ploše)") : tr("Odsazení")} value={e.kind === "toFace" ? (e.offset ?? 0) : e.d} step={0.5} onChange={(v) => set({ extent: e.kind === "toFace" ? { ...e, offset: v } : { ...e, d: v } })} />
        </>
      )}
      <PickInfo n={f.faces.length} what={tr("rovinných ploch")} hint={pickHint} onClear={() => set({ faces: [] })} list={{ doc, f, kind: "faces", value: f.faces, onChange: (faces) => set({ faces }) }} />
      <Info>{e.kind === "blind" ? tr("Přímá úprava: plocha se posune po své normále. Kladná hodnota přidá materiál, záporná odebere.") : tr("Vzdálenost se spočítá ze středu každé vybrané plochy po cílovou rovinu podél normály plochy (každá plocha zvlášť).")}</Info>
    </>
  );
});

// ---------------- pomocná geometrie ----------------

registerFeatureForm("datumAxis", ({ f, doc, set, b }) => (
  <>
    <AxisDefField label={tr("Definice osy")} value={f.def} list={before(doc, f)} onChange={(def) => set({ def: def ?? { kind: "global", axis: "Z" } })} />
    <DatumInfo doc={doc} ref={{ kind: "datumAxis", featureId: f.id }} />
    <Num label={tr("Délka zobrazení")} value={f.length} min={1} bind={b("length")} onChange={(v) => set({ length: v })} />
    <Info>{tr("Pomocná osa nevytváří geometrii. Použijte ji jako osu rotace, otočení či kruhového pole, nebo jako směr (volba „Pomocná osa“ v poli osy / směru).")}</Info>
  </>
));

registerFeatureForm("datumPoint", ({ f, doc, set }) => (
  <>
    <RefField label={tr("Bod")} value={f.ref} want="point" hint={tr("pravé tlačítko / ⋯ = další způsoby")} onChange={(ref) => set({ ref })} />
    <DatumInfo doc={doc} ref={{ kind: "datumPoint", featureId: f.id }} />
    <Info>{tr("Způsoby zadání: vrchol, střed / začátek / konec hrany, střed kružnice, střed plochy, bod v % délky hrany, střed mezi body, mezi body v poměru, odsazený podél hrany, průmět na plochu, průsečík hrany s plochou, počátek, souřadnice, bod skici. Bod pak slouží jako poloha díry, primitiva, střed otáčení…")}</Info>
  </>
));

registerFeatureForm("csys", ({ f, doc, set, b }) => (
  <>
    <RefField label={tr("Počátek")} value={f.origin} want="point" onChange={(origin) => set({ origin })} />
    <DirectionField label={tr("Osa Z")} value={f.zDir} allowNormal={false} onChange={(d) => set({ zDir: d ?? { kind: "axis", axis: "Z" } })} />
    <DirectionField label={tr("Osa X (ortogonalizuje se vůči Z)")} value={f.xDir} allowNormal={false} onChange={(d) => set({ xDir: d ?? { kind: "axis", axis: "X" } })} />
    <DatumInfo doc={doc} ref={{ kind: "datumPoint", featureId: f.id }} />
    <Num label={tr("Velikost zobrazení")} value={f.size ?? 50} min={1} bind={b("size")} onChange={(v) => set({ size: v })} />
    <Info>{tr("Souřadný systém nevytváří geometrii. Jeho počátek lze použít jako bod („Pomocný bod“), osu Z jako osu („Pomocná osa“) a rovinu XY jako rovinu skici (definice roviny „Rovnoběžně s plochou“ → odkaz na souřadný systém).")}</Info>
  </>
));
