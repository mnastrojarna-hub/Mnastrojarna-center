"use client";
/**
 * Formuláře pole (5 druhů), skořepiny a úkosu s bohatým zadáním (5. vlna). Registrují se přes `registerFeatureForm`,
 * takže `props.tsx` zůstává beze změny. Stavbu dělá `src/cad/feat/pattern.ts`.
 */
import { tr } from "@/cad/i18n";
import { useState } from "react";
import type { AxisDef, Direction, Feature, Ref, Vec3 } from "@/cad/types";
import { cn } from "@/lib/cn";
import { AXES, AXIS_PLANES, Check, Details, Field, Info, Num, PickInfo, Seg, SketchPick, Vec } from "../props";
import { AxisField, DirectionField, PlaneDefField, RefField } from "../ref-field";
import { registerFeatureForm, type FeatureFormProps } from "./registry";

type PatternF = Extract<Feature, { type: "pattern" }>;
type ShellF = Extract<Feature, { type: "shell" }>;
type DraftF = Extract<Feature, { type: "draft" }>;
type Kind = PatternF["kind"];

const KINDS: { v: Kind; l: string }[] = [
  { v: "linear", l: tr("Lineární") },
  { v: "circular", l: tr("Kruhové") },
  { v: "curve", l: tr("Po křivce") },
  { v: "sketch", l: tr("Podle skici") },
  { v: "fill", l: tr("Výplň") },
];
const MAX_GRID = 12;
const MAX_CHIPS = 48;
const chipCls = (on: boolean, disabled = false) =>
  cn("min-w-[26px] rounded-md border px-1.5 py-1 text-center text-[11px] leading-none transition", disabled ? "cursor-default border-ink-700/10 bg-steel-100 text-ink-700/35" : on ? "border-brand bg-brand/10 text-brand line-through" : "border-ink-700/12 bg-white text-ink-700 hover:border-brand/50");
const linkCls = "text-[12px] text-brand underline";

/** Čárkami oddělené indexy (pro velká pole, kde se mřížka nevykreslí). */
function SkipText({ value, onChange, hint }: { value: number[]; onChange: (v: number[]) => void; hint: string }) {
  const [t, setT] = useState(value.join(", "));
  const commit = () => onChange([...new Set(t.split(/[\s,;]+/).map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0))].sort((a, b) => a - b));
  return (
    <Field label={tr("Vynechané kusy (indexy)")}>
      <input className="w-full rounded-lg border border-ink-700/12 px-2.5 py-1.5 text-[13px] outline-none focus:border-brand" value={t} placeholder={tr("např. 2, 5, 7")} onChange={(e) => setT(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />
      <span className="mt-1 block text-[11px] text-ink-700/55">{hint}</span>
    </Field>
  );
}

/** Mřížka pozic lineárního pole: klikem se kus vynechá (index a·count2 + b, 0 = zdroj). */
function SkipGrid({ n1, n2, value, onChange }: { n1: number; n2: number; value: number[]; onChange: (v: number[]) => void }) {
  if (n1 * n2 <= 1) return null;
  if (n1 > MAX_GRID || n2 > MAX_GRID) return <SkipText value={value} onChange={onChange} hint={tr("Index kusu = (pořadí ve směru 1 − 1) × {0} + (pořadí ve směru 2 − 1); 0 = zdroj.", n2)} />;
  const toggle = (i: number) => onChange(value.includes(i) ? value.filter((x) => x !== i) : [...value, i].sort((a, b) => a - b));
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{tr("Vynechat kusy (klikněte na pozici)")}</p>
      <div className="space-y-1 overflow-x-auto">
        {Array.from({ length: n2 }, (_, bi) => n2 - 1 - bi).map((b) => (
          <div key={b} className="flex gap-1">
            {Array.from({ length: n1 }, (_, a) => {
              const i = a * n2 + b;
              const seed = i === 0;
              return (
                <button key={a} type="button" disabled={seed} title={seed ? tr("zdrojový prvek") : `kus ${i}`} onClick={() => toggle(i)} className={chipCls(value.includes(i), seed)}>
                  {seed ? "●" : value.includes(i) ? "×" : i}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {n2 > 1 && <p className="mt-1 text-[11px] text-ink-700/55">{tr("Řádky = směr 2 (zdola nahoru), sloupce = směr 1.")}</p>}
    </div>
  );
}

/** Seznam kusů (kruhové, po křivce, podle skici): klikem se kus vynechá. */
function SkipList({ items, value, onChange, label = "Vynechat kusy" }: { items: { i: number; l: string }[]; value: number[]; onChange: (v: number[]) => void; label?: string }) {
  if (!items.length) return null;
  if (items.length > MAX_CHIPS) return <SkipText value={value} onChange={onChange} hint={tr("Kusy se číslují od 1 (0 = zdroj).")} />;
  const toggle = (i: number) => onChange(value.includes(i) ? value.filter((x) => x !== i) : [...value, i].sort((a, b) => a - b));
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{label}</p>
      <div className="flex flex-wrap gap-1">
        {items.map(({ i, l }) => (
          <button key={i} type="button" onClick={() => toggle(i)} className={chipCls(value.includes(i))} title={value.includes(i) ? tr("vynechán – klikem vrátit") : tr("klikem vynechat")}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Směr pole: čísla (vektor) nebo odkaz (hrana / 2 body / osa / normála plochy / vektor / úhel). */
function DirSpec({ label, vec, def, onVec, onDef }: { label: string; vec: Vec3; def: Direction | undefined; onVec: (v: Vec3) => void; onDef: (d: Direction | undefined) => void }) {
  if (def)
    return (
      <div className="space-y-1">
        <DirectionField label={label} value={def} onChange={onDef} allowNormal={false} />
        <button type="button" className={linkCls} onClick={() => onDef(undefined)}>
          {tr("Zadat čísly (vektor)")}
        </button>
      </div>
    );
  return (
    <div className="space-y-1">
      <Vec label={label} value={vec} onChange={onVec as (v: never) => void} />
      <button type="button" className={linkCls} onClick={() => onDef({ kind: "axis", axis: Math.abs(vec[1]) > 0.9 ? "Y" : Math.abs(vec[2]) > 0.9 ? "Z" : "X" })}>
        {tr("Zadat odkazem (hrana, 2 body, plocha, úhel…)")}
      </button>
    </div>
  );
}

function SourcePick({ f, toolFeatures, set }: { f: PatternF; toolFeatures: Feature[]; set: (p: Record<string, unknown>) => void }) {
  const ids = f.featureIds?.length ? f.featureIds : f.featureId ? [f.featureId] : [];
  const toggle = (id: string) => {
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
    set({ featureIds: next, featureId: next[0] ?? "" });
  };
  if (!toolFeatures.length) return <Info>{tr("Pole opakuje existující prvek – nejdřív vytvořte díru, vysunutí nebo jiné těleso.")}</Info>;
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{tr("Opakované prvky")}{" "}{ids.length > 1 && `(${ids.length})`}</p>
      <div className="max-h-36 space-y-0.5 overflow-y-auto rounded-lg border border-ink-700/12 bg-white p-1">
        {toolFeatures.map((t) => (
          <label key={t.id} className={cn("flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[13px]", ids.includes(t.id) ? "bg-brand/10 text-ink-700" : "text-ink-700/80 hover:bg-steel-100")}>
            <input type="checkbox" className="accent-[#E03930]" checked={ids.includes(t.id)} onChange={() => toggle(t.id)} />
            <span className="truncate">{t.name}</span>
          </label>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-ink-700/55">{tr("Lze vybrat více prvků naráz (např. díru i zahloubení).")}</p>
    </div>
  );
}

function PatternForm({ f, doc, set, b, sketches, toolFeatures }: FeatureFormProps<PatternF>) {
  const skip = f.skip ?? [];
  const setSkip = (skip: number[]) => set({ skip });
  const switchKind = (v: Kind) => {
    if (v === f.kind) return;
    const count = "count" in f ? f.count : 4;
    const sketchId = "sketchId" in f ? f.sketchId : sketches[sketches.length - 1]?.id ?? "";
    const base = { kind: v, skip: [] as number[] };
    if (v === "linear") set({ ...base, count, spacing: 20, direction: [1, 0, 0] });
    else if (v === "circular") set({ ...base, count, angle: 360, axis: "Z", center: [0, 0, 0] });
    else if (v === "curve") set({ ...base, count, sketchId, align: "tangent" });
    else if (v === "sketch") set({ ...base, sketchId });
    else set({ ...base, sketchId, spacing: 20, margin: 5, layout: "grid" });
  };
  const chips = (n: number, prefix = "") => Array.from({ length: Math.max(0, n - 1) }, (_, k) => ({ i: k + 1, l: `${prefix}${k + 1}` }));

  return (
    <>
      <SourcePick f={f} toolFeatures={toolFeatures} set={set} />
      <Seg label={tr("Druh pole")} value={f.kind} options={KINDS} onChange={switchKind} />

      {f.kind === "linear" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Num label={tr("Počet kusů")} value={f.count} min={1} suffix="ks" bind={b("count")} onChange={(v) => set({ count: Math.max(1, Math.round(v)) })} />
            <Num label={f.spacingMode === "total" ? tr("Celková délka") : tr("Rozteč")} value={f.spacing} bind={b("spacing")} onChange={(v) => set({ spacing: v })} />
          </div>
          <Seg label={tr("Vzdálenost zadaná jako")} value={f.spacingMode ?? "step"} options={[{ v: "step", l: tr("Krok mezi kusy") }, { v: "total", l: tr("Celková délka") }]} onChange={(v) => set({ spacingMode: v })} />
          <DirSpec label={tr("Směr 1")} vec={f.direction} def={f.dirDef} onVec={(direction) => set({ direction })} onDef={(dirDef) => set({ dirDef })} />
          <Check
            label={tr("Druhý směr (mřížka)")}
            value={(f.count2 ?? 1) > 1}
            onChange={(on) => set(on ? { count2: 2, spacing2: f.spacing2 ?? f.spacing, direction2: f.direction2 ?? (Math.abs(f.direction[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]) } : { count2: 1, stagger: false })}
          />
          {(f.count2 ?? 1) > 1 && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Num label={tr("Počet (směr 2)")} value={f.count2 ?? 2} min={1} suffix="ks" bind={b("count2")} onChange={(v) => set({ count2: Math.max(1, Math.round(v)) })} />
                <Num label={f.spacingMode === "total" ? tr("Celková délka (směr 2)") : tr("Rozteč (směr 2)")} value={f.spacing2 ?? f.spacing} bind={b("spacing2")} onChange={(v) => set({ spacing2: v })} />
              </div>
              <DirSpec label={tr("Směr 2")} vec={f.direction2 ?? [0, 1, 0]} def={f.dirDef2} onVec={(direction2) => set({ direction2 })} onDef={(dirDef2) => set({ dirDef2 })} />
              <Check label={tr("Střídavé řady (každá druhá řada posunutá o půl kroku)")} value={!!f.stagger} onChange={(stagger) => set({ stagger })} />
            </>
          )}
          <SkipGrid n1={Math.max(1, Math.round(f.count))} n2={Math.max(1, Math.round(f.count2 ?? 1))} value={skip} onChange={setSkip} />
        </>
      )}

      {f.kind === "circular" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Num label={tr("Počet kusů")} value={f.count} min={1} suffix="ks" bind={b("count")} onChange={(v) => set({ count: Math.max(1, Math.round(v)) })} />
            <Num label={tr("Celkový úhel")} value={f.angle} suffix="°" min={1} bind={b("angle")} onChange={(v) => set({ angle: Math.min(360, v) })} />
          </div>
          <Check label={tr("Rovnoměrně po celém úhlu (krok = úhel ÷ počet)")} value={f.equalSpacing ?? f.angle >= 360} onChange={(equalSpacing) => set({ equalSpacing })} />
          <Check label={tr("Symetricky na obě strany od zdroje")} value={!!f.symmetric} onChange={(symmetric) => set({ symmetric })} />
          <Check label={tr("Natáčet kopie kolem osy (vypnuto = jen posunout)")} value={f.radial !== false} onChange={(v) => set({ radial: v })} />
          {f.axisDef ? (
            <div className="space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{tr("Osa pole")}</p>
              <AxisField value={f.axisDef} onChange={(axisDef: AxisDef | undefined) => set({ axisDef })} sketch={undefined} />
              <button type="button" className={linkCls} onClick={() => set({ axisDef: undefined })}>
                {tr("Zadat osu čísly (osa + střed)")}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <Seg label={tr("Osa")} value={f.axis} options={AXES} onChange={(v) => set({ axis: v })} />
              <Vec label={tr("Střed")} value={f.center} bind={b("center")} onChange={(v) => set({ center: v })} />
              <button type="button" className={linkCls} onClick={() => set({ axisDef: { kind: "global", axis: f.axis } })}>
                {tr("Zadat osu odkazem (hrana, válcová plocha, 2 body, pomocná rovina…)")}
              </button>
            </div>
          )}
          <SkipList items={f.symmetric ? [...chips(Math.round(f.count), "+"), ...chips(Math.round(f.count), "−").map((c) => ({ i: Math.round(f.count) - 1 + c.i, l: c.l }))] : chips(Math.round(f.count))} value={skip} onChange={setSkip} />
          {f.axisDef && f.axisDef.kind.startsWith("sketch") && <Info>{tr("Pole nemá skicu – osy X/Y skici znamenají globální osy počátkem souřadnic.")}</Info>}
        </>
      )}

      {f.kind === "curve" && (
        <>
          <SketchPick label={tr("Skica křivky (dráha)")} value={f.sketchId} sketches={sketches} onChange={(sketchId) => set({ sketchId })} />
          <div className="grid grid-cols-2 gap-2">
            <Num label={tr("Počet kusů")} value={f.count} min={1} suffix="ks" bind={b("count")} onChange={(v) => set({ count: Math.max(1, Math.round(v)) })} />
            <Num label={tr("Rozteč (0 = rovnoměrně)")} value={f.spacing ?? 0} min={0} bind={b("spacing")} onChange={(v) => set({ spacing: v > 0 ? v : undefined })} />
          </div>
          <Seg label={tr("Natočení kopií")} value={f.align} options={[{ v: "tangent", l: tr("Podle tečny křivky") }, { v: "fixed", l: tr("Pevné (jen posun)") }]} onChange={(align) => set({ align })} />
          <SkipList items={chips(Math.round(f.count))} value={skip} onChange={setSkip} />
          <Info>{tr("Kusy se rozmístí po délce křivky od jejího začátku; u uzavřené křivky po celém obvodu. Referenční bod zdroje = střed jeho obalového kvádru: kopie se posunou o vzdálenost bodu křivky od jejího začátku a (u tečného natočení) otočí kolem tohoto středu.")}</Info>
        </>
      )}

      {f.kind === "sketch" && (
        <>
          <SketchPick label={tr("Skica s body")} value={f.sketchId} sketches={sketches} onChange={(sketchId) => set({ sketchId })} />
          {(() => {
            const sk = doc.features.find((x) => x.id === f.sketchId);
            const n = sk && sk.type === "sketch" ? sk.entities.filter((e) => e.type === "point").length : 0;
            return (
              <>
                <SkipList label={tr("Body skici ({0}) – klikem vynechat", n)} items={Array.from({ length: n }, (_, i) => ({ i, l: tr("Bod {0}", i + 1) }))} value={skip} onChange={setSkip} />
                {f.sketchId && !n && <Info>{tr("Skica zatím neobsahuje body – nakreslete je nástrojem Bod v místech kopií.")}</Info>}
              </>
            );
          })()}
          <Info>{tr("Kopie vzniknou v každém bodě skici (střed obalového kvádru zdroje se promítne do roviny skici; bod v místě zdroje se nepočítá).")}</Info>
        </>
      )}

      {f.kind === "fill" && (
        <>
          <SketchPick label={tr("Skica obrysu (uzavřený)")} value={f.sketchId} sketches={sketches} onChange={(sketchId) => set({ sketchId })} />
          <Seg label={tr("Rozložení")} value={f.layout ?? "grid"} options={[{ v: "grid", l: tr("Mřížka") }, { v: "stagger", l: tr("Střídavě") }, { v: "circular", l: tr("Kruhově") }]} onChange={(layout) => set({ layout })} />
          <div className="grid grid-cols-2 gap-2">
            <Num label={tr("Rozteč")} value={f.spacing} min={0.01} bind={b("spacing")} onChange={(v) => set({ spacing: v })} />
            <Num label={tr("Okraj od obrysu")} value={f.margin} min={0} bind={b("margin")} onChange={(v) => set({ margin: Math.max(0, v) })} />
          </div>
          <SkipText value={skip} onChange={setSkip} hint={tr("Kusy se číslují v pořadí řad (zdola nahoru, zleva doprava), u kruhového od středu po prstencích.")} />
          <Info>{tr("Vyplní vnitřek obrysu (otvory v obrysu se vynechají) kusy v dané rozteči; žádný kus není blíže k obrysu než okraj. Počátek rozložení = zdrojový prvek, leží-li v obrysu, jinak střed obrysu. Nejvýše 400 kusů.")}</Info>
        </>
      )}

      <Details summary={tr("Pokročilé")}>
        <Check label={tr("Jedna booleovská operace (kopie se nejdřív sloučí – rychlejší u velkých polí)")} value={!!f.geometryOnly} onChange={(geometryOnly) => set({ geometryOnly })} />
        {f.kind === "linear" && <Info>{tr("Při „celkové délce“ platí zadaná délka pro celé pole (krok = délka ÷ (počet − 1)), ve druhém směru stejně.")}</Info>}
      </Details>
    </>
  );
}

// ---------------- skořepina ----------------

function ShellForm({ f, doc, set, b, pickHint }: FeatureFormProps<ShellF>) {
  const th = f.thicknesses ?? {};
  const keys = Object.keys(th)
    .map(Number)
    .filter((k) => Number.isInteger(k))
    .sort((a, c) => a - c);
  const setTh = (k: number, v: number | null) => {
    const next: Record<string, number> = { ...th };
    if (v == null) delete next[String(k)];
    else next[String(k)] = v;
    set({ thicknesses: next });
  };
  return (
    <>
      <Num label={tr("Tloušťka stěny")} value={f.thickness} min={0.01} step={0.5} bind={b("thickness")} onChange={(v) => set({ thickness: v })} />
      <Check label={tr("Zesílit ven (stěna přiroste vně původního povrchu)")} value={!!f.outward} onChange={(outward) => set({ outward })} />
      <PickInfo n={f.faces.length} what={tr("otevřených ploch")} hint={pickHint} onClear={() => set({ faces: [] })} list={{ doc, f, kind: "faces", value: f.faces, onChange: (faces) => set({ faces }) }} />
      <Details summary={tr("Jiná tloušťka vybraných stěn{0}", keys.length ? ` (${keys.length})` : "")} open={keys.length > 0}>
        {keys.length > 0 && (
          <div className="space-y-1.5">
            {keys.map((k) => (
              <div key={k} className="flex items-end gap-2">
                <div className="flex-1">
                  <Num label={tr("Plocha {0}", k + 1)} value={th[String(k)]} min={0.01} step={0.5} onChange={(v) => setTh(k, v)} />
                </div>
                <button type="button" className="mb-1.5 rounded-md border border-ink-700/12 px-2 py-1 text-[12px] text-ink-700/70 hover:border-brand hover:text-brand" onClick={() => setTh(k, null)} title="odebrat">
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <RefField
          label={tr("Přidat stěnu s jinou tloušťkou")}
          value={undefined}
          want="face"
          allowXyz={false}
          onChange={(ref: Ref) => {
            if (ref.kind === "face" && ref.index >= 0 && !f.faces.includes(ref.index)) setTh(ref.index, th[String(ref.index)] ?? Math.round(f.thickness * 2 * 100) / 100);
          }}
        />
        <Info>{tr("Stěna u vybrané rovinné plochy dostane vlastní tloušťku (silnější dno, tenčí víko). Otevřené plochy a zakřivené stěny nelze.")}</Info>
      </Details>
    </>
  );
}

// ---------------- úkos ----------------

function DraftForm({ f, doc, set, b, pickHint }: FeatureFormProps<DraftF>) {
  return (
    <>
      <Num label={tr("Úhel úkosu")} value={f.angle} suffix="°" step={0.5} bind={b("angle")} onChange={(v) => set({ angle: Math.max(-44, Math.min(44, v)) })} />
      <PlaneDefField label={tr("Neutrální rovina")} value={f.planeDef} allowNone noneLabel={f.pull ? tr("Kolmo na směr tahu středem tělesa") : tr("Základní rovina (níže)")} onChange={(planeDef) => set({ planeDef })} />
      {f.pull ? (
        <div className="space-y-1">
          <DirectionField label={tr("Směr tahu (otevírání formy)")} value={f.pull} onChange={(pull) => set({ pull })} allowNormal={false} />
          <button type="button" className={linkCls} onClick={() => set({ pull: undefined })}>
            {tr("Bez směru tahu (podle roviny)")}
          </button>
        </div>
      ) : (
        <button type="button" className={linkCls} onClick={() => set({ pull: { kind: "axis", axis: AXIS_PLANES.find((p) => p.v === f.plane)?.axis ?? "Z" } })}>
          {tr("Zadat směr tahu (hrana, 2 body, osa, normála plochy…)")}
        </button>
      )}
      {!f.planeDef && !f.pull && (
        <>
          <Seg label={tr("Základní rovina")} value={f.plane} options={AXIS_PLANES} onChange={(v) => set({ plane: v })} />
          <Num label={tr("Poloha roviny ({0})", AXIS_PLANES.find((p) => p.v === f.plane)?.axis)} value={f.offset} bind={b("offset")} onChange={(v) => set({ offset: v })} />
        </>
      )}
      <Check label={tr("Rozšířit na tečně navazující plochy")} value={!!f.tangentChain} onChange={(tangentChain) => set({ tangentChain })} />
      <PickInfo n={f.faces.length} what={tr("ploch ke zkosení")} hint={pickHint} onClear={() => set({ faces: [] })} list={{ doc, f, kind: "faces", value: f.faces, onChange: (faces) => set({ faces }) }} />
      <Info>
        {tr("Plochy se naklopí o úhel kolem průsečnice s neutrální rovinou; směr tahu určuje, na kterou stranu se úkos otevírá (u zadané roviny jen otočí její orientaci). Bez roviny i směru platí základní rovina. Dělicí křivka a stupňovitý úkos zatím nejsou k dispozici.")}
      </Info>
    </>
  );
}

registerFeatureForm("pattern", (p) => <PatternForm {...p} />);
registerFeatureForm("shell", (p) => <ShellForm {...p} />);
registerFeatureForm("draft", (p) => <DraftForm {...p} />);
