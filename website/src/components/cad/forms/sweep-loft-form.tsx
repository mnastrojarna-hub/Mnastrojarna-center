"use client";
/**
 * Formuláře tažení a šablonování (5. vlna, modul W5-C) – registrace přes `registerFeatureForm`.
 * Stavbu řeší `src/cad/feat/sweep-loft.ts`; popisky zde odpovídají tamním možnostem zadání.
 */
import { tr } from "@/cad/i18n";
import type { Feature } from "@/cad/types";
import { Check, Details, Info, Num, Seg, SketchPick, selectCls } from "../props";
import { DirectionField, RefField, ThinField } from "../ref-field";
import { registerFeatureForm, type FeatureFormProps } from "./registry";

type SweepF = Extract<Feature, { type: "sweep" }>;
type LoftF = Extract<Feature, { type: "loft" }>;
type Cond = NonNullable<LoftF["startCond"]>;

type Orient = "path" | "frenet" | "fixed";
const ORIENT: { v: Orient; l: string }[] = [
  { v: "path", l: tr("Sledovat dráhu") },
  { v: "frenet", l: tr("Frenet") },
  { v: "fixed", l: tr("Pevná orientace") },
];
const TRANSITIONS: { v: NonNullable<SweepF["transition"]>; l: string }[] = [
  { v: "right", l: tr("Pravoúhlý") },
  { v: "round", l: tr("Zaoblený") },
  { v: "transformed", l: tr("Transformovaný") },
];
const CONDS: { v: Cond; l: string }[] = [
  { v: "none", l: tr("Žádná") },
  { v: "normal", l: tr("Kolmo na profil") },
  { v: "direction", l: tr("Směr") },
];

// ---------------- tažení ----------------

function SweepForm({ f, set, b, sketches, mode }: FeatureFormProps<SweepF>) {
  const circle = f.circleRadius != null;
  const orient: Orient = f.keepNormal ? "fixed" : f.frenet ? "frenet" : "path";
  const advanced = !!(f.guideId || f.twist || f.twistTurns || (f.scaleEnd != null && f.scaleEnd !== 1) || f.thin || (f.transition && f.transition !== "right"));
  return (
    <>
      <Seg label={tr("Profil")} value={circle ? "circle" : "sketch"} options={[{ v: "sketch", l: tr("Skica") }, { v: "circle", l: tr("Kružnice (bez skici)") }]} onChange={(v) => set(v === "circle" ? { circleRadius: f.circleRadius ?? 5 } : { circleRadius: undefined })} />
      {circle ? (
        <Num label={tr("Průměr kruhového profilu")} value={(f.circleRadius ?? 5) * 2} min={0.001} bind={b("circleRadius")} bindFactor={2} onChange={(v) => set({ circleRadius: v / 2 })} />
      ) : (
        <SketchPick label={tr("Profil (uzavřená skica)")} value={f.profileId} sketches={sketches} onChange={(v) => set({ profileId: v })} />
      )}
      <SketchPick label={tr("Dráha (křivka)")} value={f.pathId} sketches={sketches} onChange={(v) => set({ pathId: v })} />
      <Seg label={tr("Orientace profilu podél dráhy")} value={orient} options={ORIENT} onChange={(v) => set({ keepNormal: v === "fixed" ? true : undefined, frenet: v === "frenet" })} />
      <Details summary={tr("Vodicí křivka, kroucení, měřítko, tenká stěna, přechod v rozích…")} open={advanced}>
        <SketchPick label={tr("Vodicí křivka (volitelně)")} value={f.guideId ?? ""} sketches={sketches} onChange={(v) => set({ guideId: v || undefined })} />
        <div className="grid grid-cols-2 gap-2">
          <Num label={tr("Kroucení")} value={f.twist ?? 0} suffix="°" hint={tr("podél celé dráhy")} bind={b("twist")} onChange={(v) => set({ twist: v || undefined })} />
          <Num label={tr("Otáčky")} value={f.twistTurns ?? 0} suffix="ot." step={0.25} bind={b("twistTurns")} onChange={(v) => set({ twistTurns: v || undefined })} />
        </div>
        <Num label={tr("Měřítko profilu na konci")} value={f.scaleEnd ?? 1} suffix="×" min={0.01} step={0.1} hint={tr("1 = beze změny")} bind={b("scaleEnd")} onChange={(v) => set({ scaleEnd: Math.abs(v - 1) < 1e-9 ? undefined : v })} />
        <Seg label={tr("Přechod v rozích dráhy")} value={f.transition ?? "right"} options={TRANSITIONS} onChange={(transition) => set({ transition: transition === "right" ? undefined : transition })} />
        <ThinField value={f.thin} onChange={(thin) => set({ thin })} />
      </Details>
      <Info>
        {tr("Profil by měl ležet v rovině kolmé na začátek dráhy (kružnice bez skici se tam umístí sama). Dráha může obsahovat úsečky, oblouky a lomené čáry – musí být souvislá. Pevná orientace = profil se po dráze jen posouvá (nenatáčí se). Vodicí křivka natáčí profil směrem k ní. Kroucení a měřítko se staví z řezů podél dráhy (hladké šablonování) – výsledek je u dlouhých drah mírně přibližný. Transformovaný přechod je určen pro hladké dráhy.")}
      </Info>
      {mode}
    </>
  );
}

// ---------------- šablonování ----------------

function LoftForm({ f, set, b, sketches, mode }: FeatureFormProps<LoftF>) {
  const ids = f.sketchIds;
  const setIds = (next: string[]) => set({ sketchIds: next });
  const endsOpen = !!(f.startPoint || f.endPoint || (f.startCond && f.startCond !== "none") || (f.endCond && f.endCond !== "none"));
  const curvesOpen = !!(f.centerlineId || f.guideIds?.length || f.thin);
  const condBlock = (side: "start" | "end") => {
    const point = side === "start" ? f.startPoint : f.endPoint;
    const cond = (side === "start" ? f.startCond : f.endCond) ?? "none";
    const dir = side === "start" ? f.startDir : f.endDir;
    const len = side === "start" ? f.startLen : f.endLen;
    const k = (name: string) => `${side}${name}`;
    const label = side === "start" ? tr("Začátek") : tr("Konec");
    return (
      <div className="space-y-2 rounded-lg border border-ink-700/10 p-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{label}</p>
        <Check label={side === "start" ? tr("Začít v bodě (špička)") : tr("Skončit v bodě (špička)")} value={!!point} onChange={(on) => set({ [k("Point")]: on ? { kind: "vertex", index: -1 } : undefined })} />
        {point ? (
          <RefField label={side === "start" ? tr("Počáteční bod") : tr("Koncový bod")} value={point} want="point" onChange={(ref) => set({ [k("Point")]: ref })} />
        ) : (
          <>
            <Seg label={tr("Okrajová podmínka")} value={cond} options={CONDS} onChange={(v) => set({ [k("Cond")]: v === "none" ? undefined : v })} />
            {cond === "direction" && <DirectionField label={side === "start" ? tr("Směr na začátku") : tr("Směr na konci")} value={dir} onChange={(d) => set({ [k("Dir")]: d })} />}
            {cond !== "none" && <Num label={tr("Délka náběhu")} value={len ?? 0} min={0} hint={tr("0 = 10 % vzdálenosti profilů")} bind={b(k("Len"))} onChange={(v) => set({ [k("Len")]: v || undefined })} />}
          </>
        )}
      </div>
    );
  };
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
              <button type="button" title={tr("Odebrat")} disabled={ids.length <= 1} className="rounded px-1 text-ink-700/50 hover:text-brand disabled:opacity-25" onClick={() => setIds(ids.filter((_, j) => j !== k))}>
                ×
              </button>
            </li>
          ))}
        </ol>
        <button type="button" className="mt-1.5 text-[12px] font-medium text-brand hover:underline" onClick={() => setIds([...ids, sketches.find((s) => !ids.includes(s.id))?.id ?? ""])}>
          {tr("+ Přidat profil")}
        </button>
      </div>
      <div className="flex flex-wrap gap-4">
        <Check label={tr("Přímkové plochy (bez vyhlazení)")} value={f.ruled} onChange={(v) => set({ ruled: v })} />
        <Check label={tr("Uzavřené (poslední profil se napojí na první)")} value={!!f.closed} onChange={(v) => set({ closed: v || undefined })} />
      </div>
      <Details summary={tr("Začátek a konec: šablonování do bodu, okrajové podmínky")} open={endsOpen}>
        {condBlock("start")}
        {condBlock("end")}
      </Details>
      <Details summary={tr("Osová a vodicí křivka, tenká stěna")} open={curvesOpen}>
        <SketchPick label={tr("Osová křivka (volitelně)")} value={f.centerlineId ?? ""} sketches={sketches} onChange={(v) => set({ centerlineId: v || undefined })} />
        <SketchPick label={tr("Vodicí křivka (volitelně)")} value={f.guideIds?.[0] ?? ""} sketches={sketches} onChange={(v) => set({ guideIds: v ? [v] : undefined })} />
        <ThinField value={f.thin} onChange={(thin) => set({ thin })} />
      </Details>
      <Info>
        {tr("Profily jsou uzavřené skici v různých rovinách (otvory se šablonují, mají-li všechny profily stejný počet). Stačí i jeden profil a bod (kužel / jehlan). Uzavřené šablonování potřebuje alespoň tři profily. Okrajové podmínky „kolmo“ / „směr“ jsou aproximace pomocným řezem v délce náběhu. Osová křivka má procházet profily (řezy se podél ní prokládají); vodicí křivka natáčí řezy směrem k sobě (použije se první). Osovou / vodicí křivku nelze kombinovat s bodem ani uzavřením.")}
      </Info>
      {mode}
    </>
  );
}

registerFeatureForm("sweep", (p) => <SweepForm {...p} />);
registerFeatureForm("loft", (p) => <LoftForm {...p} />);
