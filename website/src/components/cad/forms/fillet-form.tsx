"use client";
/**
 * Formuláře zaoblení a zkosení (5. vlna): přepínač druhu zadání a pole podle druhu.
 * Výběr hran klikem v modelu běží přes pole `edges` (jako dosud); plochy a vrcholy se zadávají poli odkazů
 * (`faceRefs`, `faceRefs2`, `faceRefsMid`, `faceRef`, `vertexRefs`), které stavitel přeloží na topologii s otiskem.
 */
import { tr } from "@/cad/i18n";
import type { Feature } from "@/cad/types";
import { cn } from "@/lib/cn";
import { Check, Info, Num, PickInfo, Seg } from "../props";
import { RefField, RefListField } from "../ref-field";
import { registerFeatureForm, type FeatureFormProps } from "./registry";

type FilletF = Extract<Feature, { type: "fillet" }>;
type ChamferF = Extract<Feature, { type: "chamfer" }>;
type FilletKind = NonNullable<FilletF["kind"]>;
type ChamferKind = NonNullable<ChamferF["kind"]>;

const FILLET_KINDS: { v: FilletKind; l: string }[] = [
  { v: "constant", l: tr("Konstantní") },
  { v: "asymmetric", l: tr("R1 → R2") },
  { v: "variable", l: tr("Tabulka") },
  { v: "faceFace", l: tr("Plocha–plocha") },
  { v: "fullRound", l: tr("Plný") },
  { v: "setback", l: tr("Setback") },
  { v: "conic", l: tr("Eliptické / kuželosečkové") },
];
const CHAMFER_KINDS: { v: ChamferKind; l: string }[] = [
  { v: "equal", l: tr("Stejné") },
  { v: "twoDistances", l: tr("D1 × D2") },
  { v: "distanceAngle", l: tr("D × úhel") },
  { v: "vertex", l: tr("Vrchol") },
];

const without = (o: Record<string, number> | undefined, k: string) => (o ? Object.fromEntries(Object.entries(o).filter(([key]) => key !== k)) : o);

/** Hrany: vybrané klikem / všechny (+ počet vybraných). */
function EdgesPick({ f, doc, set, pickHint, allLabel = tr("Všechny") }: { f: FilletF | ChamferF; doc: FeatureFormProps["doc"]; set: FeatureFormProps["set"]; pickHint?: string; allLabel?: string }) {
  return (
    <>
      <Seg label={tr("Hrany")} value={f.edges === "all" ? "all" : "pick"} options={[{ v: "pick", l: tr("Vybrané") }, { v: "all", l: allLabel }]} onChange={(v) => set({ edges: v === "all" ? "all" : [] })} />
      {f.edges !== "all" && <PickInfo n={f.edges.length} what={tr("hran")} hint={pickHint} onClear={() => set({ edges: [] })} list={{ doc, f, kind: "edges", value: f.edges, onChange: (edges) => set({ edges }) }} />}
    </>
  );
}

/** Druhy zaoblení jako přepínač, který se zalomí do dvou řádků (7 druhů se do šířky panelu nevejde). */
function KindChips({ value, onChange }: { value: FilletKind; onChange: (v: FilletKind) => void }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{tr("Druh zaoblení")}</p>
      <div className="flex flex-wrap gap-0.5 rounded-lg bg-steel-100 p-0.5" data-fillet-kinds>
        {FILLET_KINDS.map((o) => (
          <button key={o.v} type="button" onClick={() => onChange(o.v)} className={cn("flex-auto rounded-md px-2 py-1.5 text-[12px] font-medium transition", value === o.v ? "bg-white text-ink-700 shadow-sm" : "text-ink-700/55 hover:text-ink-700")}>
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Setback: výchozí vzdálenost od vrcholu a jiné hodnoty pro vybrané vrcholy. */
function SetbackFields({ f, set, b }: Pick<FeatureFormProps<FilletF>, "f" | "set" | "b">) {
  const list = f.setbacks ?? [];
  return (
    <>
      <Num label={tr("Setback (od vrcholu podél hran)")} value={f.setback ?? f.radius} min={0.01} step={0.5} bind={b("setback")} hint={tr("výchozí = poloměr")} onChange={(v) => set({ setback: v })} />
      {list.map((x, i) => (
        <div key={i} className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <RefField compact label={tr("Vrchol {0}", i + 1)} value={x.at} want="vertex" onChange={(at) => set({ setbacks: list.map((y, k) => (k === i ? { ...y, at } : y)) })} />
          </div>
          <div className="w-24">
            <Num label={tr("Setback")} value={x.d} min={0.01} step={0.5} onChange={(d) => set({ setbacks: list.map((y, k) => (k === i ? { ...y, d } : y)) })} />
          </div>
          <button type="button" className="mb-1.5 rounded-md border border-ink-700/12 px-2 py-1 text-[12px] text-ink-700/70 hover:border-brand hover:text-brand" title={tr("Odebrat vrchol")} onClick={() => set({ setbacks: list.filter((_, k) => k !== i) })}>
            ×
          </button>
        </div>
      ))}
      <RefField label={tr("Přidat vrchol s jiným setbackem")} value={undefined} want="vertex" onChange={(at) => set({ setbacks: [...list, { at, d: Math.round((f.setback ?? f.radius) * 150) / 100 }] })} />
    </>
  );
}

function TangentChain({ f, set }: { f: FilletF | ChamferF; set: FeatureFormProps["set"] }) {
  return <Check label={tr("Šířit výběr po tečně navazujících hranách")} value={!!f.tangentChain} onChange={(v) => set({ tangentChain: v })} />;
}

function FilletForm({ f, doc, set, b, pickHint }: FeatureFormProps<FilletF>) {
  const kind: FilletKind = f.kind ?? "constant";
  const edgeIdx = f.edges === "all" ? [] : f.edges;
  const radiusField = (label = tr("Poloměr")) => <Num label={label} value={f.radius} min={0.01} step={0.5} bind={b("radius")} onChange={(v) => set({ radius: v })} />;
  return (
    <>
      <KindChips value={kind} onChange={(v) => set(v === "conic" && f.r2 === undefined ? { kind: v, r2: Math.round(f.radius * 50) / 100 } : { kind: v })} />
      {kind === "constant" && (
        <>
          {radiusField()}
          <EdgesPick f={f} doc={doc} set={set} pickHint={pickHint} />
          <TangentChain f={f} set={set} />
        </>
      )}
      {kind === "asymmetric" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {radiusField(tr("R1 (začátek hrany)"))}
            <Num label={tr("R2 (konec hrany)")} value={f.r2 ?? f.radius} min={0.01} step={0.5} bind={b("r2")} onChange={(v) => set({ r2: v })} />
          </div>
          <button type="button" className="text-[12px] text-brand underline" onClick={() => set({ radius: f.r2 ?? f.radius, r2: f.radius })}>
            {tr("Prohodit R1 ↔ R2")}
          </button>
          <EdgesPick f={f} doc={doc} set={set} pickHint={pickHint} />
          <TangentChain f={f} set={set} />
          <Info>
            {tr("Poloměr se mění lineárně od začátku hrany (R1) k jejímu konci (R2). Začátek hrany určuje model – běží-li přechod obráceně, hodnoty prohoďte. Různou vzdálenost na každé ploše (eliptický průřez) má druh „Eliptické / kuželosečkové“.")}
          </Info>
        </>
      )}
      {kind === "variable" && (
        <>
          {radiusField(tr("Výchozí poloměr"))}
          <EdgesPick f={f} doc={doc} set={set} pickHint={pickHint} />
          {f.edges === "all" ? (
            <Info>{tr("Pro tabulku poloměrů vyberte hrany klikem v modelu – u volby „Všechny“ platí výchozí poloměr.")}</Info>
          ) : (
            edgeIdx.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{tr("Poloměry hran")}</p>
                {edgeIdx.map((i) => {
                  const k = String(i);
                  const r1 = f.radii?.[k] ?? f.radius;
                  const r2 = f.radii2?.[k] ?? r1;
                  return (
                    <div key={i} className="rounded-lg border border-ink-700/10 p-2">
                      <div className="mb-1 flex items-center justify-between text-[12px]">
                        <span className="font-medium">{tr("Hrana")}{" "}{i + 1}</span>
                        <button type="button" onClick={() => set({ edges: edgeIdx.filter((x) => x !== i), radii: without(f.radii, k), radii2: without(f.radii2, k) })} className="rounded px-1.5 text-ink-700/50 hover:bg-steel-100" title={tr("Odebrat hranu")}>
                          ×
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Num label={tr("R začátek")} value={r1} min={0.01} step={0.5} onChange={(v) => set({ radii: { ...f.radii, [k]: v } })} />
                        <Num label={tr("R konec")} value={r2} min={0.01} step={0.5} onChange={(v) => set({ radii2: { ...f.radii2, [k]: v } })} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
          <Info>{tr("Každá hrana může mít vlastní poloměr; liší-li se začátek a konec, mění se poloměr podél hrany lineárně. Řídicí body uprostřed hrany jádro neumožňuje; tečně navazující hrany tvoří jeden přechod se společným poloměrem.")}</Info>
        </>
      )}
      {kind === "faceFace" && (
        <>
          {radiusField()}
          <RefListField label={tr("Sada ploch 1")} value={f.faceRefs ?? []} want="face" onChange={(v) => set({ faceRefs: v })} />
          <RefListField label={tr("Sada ploch 2")} value={f.faceRefs2 ?? []} want="face" onChange={(v) => set({ faceRefs2: v })} />
          <Info>{tr("Zaoblí se hrany, které má plocha z první sady společné s plochou z druhé sady (např. horní plocha × všechny boční = celý obvod).")}</Info>
        </>
      )}
      {kind === "fullRound" && (
        <>
          <RefListField label={tr("Boční plocha 1")} value={f.faceRefs ?? []} want="face" onChange={(v) => set({ faceRefs: v })} />
          <RefListField label={tr("Prostřední plocha (zaoblí se)")} value={f.faceRefsMid ?? []} want="face" onChange={(v) => set({ faceRefsMid: v })} />
          <RefListField label={tr("Boční plocha 2")} value={f.faceRefs2 ?? []} want="face" onChange={(v) => set({ faceRefs2: v })} />
          <Info>
            {tr("Poloměr = polovina vzdálenosti rovnoběžných bočních ploch; prostřední plocha se nahradí válcem tečným k oběma. Prostřední plochu lze vynechat, je-li mezi bočními plochami jediná. Obdélníková prostřední plocha kolmá na boční se zaoblí přesně, jiná přibližně.")}
          </Info>
        </>
      )}
      {kind === "setback" && (
        <>
          {radiusField()}
          <SetbackFields f={f} set={set} b={b} />
          <EdgesPick f={f} doc={doc} set={set} pickHint={pickHint} />
          <TangentChain f={f} set={set} />
          <Info>
            {tr("Ve vrcholu, kde se stýkají aspoň tři vybrané hrany, zaoblení skončí ve vzdálenosti setback od vrcholu a roh uzavře hladká N-stranná záplata, tečná (G1) k zaoblením i k plochám rohu. Setback musí být alespoň rovný poloměru (stejná hodnota ≈ běžný kulový roh). Přesně pro rohy z rovinných ploch a přímých hran; jiné rohy dostanou běžné zaoblení vrcholu a prvek zobrazí ⚠.")}
          </Info>
        </>
      )}
      {kind === "conic" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {radiusField(tr("D1 (první plocha)"))}
            <Num label={tr("D2 (druhá plocha)")} value={f.r2 ?? f.radius} min={0.01} step={0.5} bind={b("r2")} onChange={(v) => set({ r2: v })} />
          </div>
          <button type="button" className="text-[12px] text-brand underline" onClick={() => set({ radius: f.r2 ?? f.radius, r2: f.radius })}>
            {tr("Prohodit D1 ↔ D2")}
          </button>
          <Seg label={tr("Průřez")} value={f.rho === undefined ? "ellipse" : "conic"} options={[{ v: "ellipse", l: tr("Elipsa") }, { v: "conic", l: tr("Kuželosečka (rho)") }]} onChange={(v) => set({ rho: v === "ellipse" ? undefined : 0.5 })} />
          {f.rho !== undefined && <Num label={tr("Rho (0,5 = parabola, menší = plošší, větší = ostřejší)")} value={f.rho} min={0.01} step={0.05} suffix="" bind={b("rho")} onChange={(v) => set({ rho: Math.max(0.01, Math.min(0.99, v)) })} />}
          <RefListField label={tr("Plocha pro D1 (volitelně)")} value={f.faceRefs ?? []} want="face" onChange={(v) => set({ faceRefs: v })} />
          <EdgesPick f={f} doc={doc} set={set} pickHint={pickHint} />
          <TangentChain f={f} set={set} />
          <Info>
            {tr("Průřez je oblouk elipsy (nebo kuželosečky s parametrem rho) tečný k oběma plochám: D1 se odměří na první ploše, D2 na druhé. První plocha = plocha z pole výše, jinak plocha s normálou nejvíc nahoru (+Z, pak +Y, +X). Přímá hrana mezi rovinnými plochami a kruhová hrana se stálým průřezem (rovina ⟂ osa, souosý válec/kužel) jsou přesné; jiné hrany se proloží šablonováním průřezů (přibližně, ⚠). Vnitřní hrany materiál přidají.")}
          </Info>
        </>
      )}
      {(kind === "constant" || kind === "asymmetric" || kind === "variable") && f.tangentChain && <Info>{tr("Jádro šíří zaoblení po tečně navazujících hranách (hrana → oblouk → hrana) i samo; volba rozšíří i výběr, se kterým pracuje tabulka a počet hran.")}</Info>}
    </>
  );
}

function ChamferForm({ f, doc, set, b, pickHint }: FeatureFormProps<ChamferF>) {
  const kind: ChamferKind = f.kind ?? "equal";
  const withFace = kind === "twoDistances" || kind === "distanceAngle";
  const d1 = (label: string) => <Num label={label} value={f.distance} min={0.01} step={0.5} bind={b("distance")} onChange={(v) => set({ distance: v })} />;
  return (
    <>
      <Seg label={tr("Druh sražení")} value={kind} options={CHAMFER_KINDS} onChange={(v) => set({ kind: v })} />
      {kind === "equal" && (
        <>
          {d1(tr("Velikost sražení"))}
          <EdgesPick f={f} doc={doc} set={set} pickHint={pickHint} />
          <TangentChain f={f} set={set} />
        </>
      )}
      {kind === "twoDistances" && (
        <div className="grid grid-cols-2 gap-2">
          {d1(tr("D1 (na ref. ploše)"))}
          <Num label={tr("D2 (sousední plocha)")} value={f.d2 ?? f.distance} min={0.01} step={0.5} bind={b("d2")} onChange={(v) => set({ d2: v })} />
        </div>
      )}
      {kind === "distanceAngle" && (
        <div className="grid grid-cols-2 gap-2">
          {d1(tr("D (na ref. ploše)"))}
          <Num label={tr("Úhel od ref. plochy")} value={f.angle ?? 45} min={1} step={5} suffix="°" bind={b("angle")} onChange={(v) => set({ angle: v })} />
        </div>
      )}
      {withFace && (
        <>
          <RefField label={tr("Referenční plocha")} value={f.faceRef} want="face" hint={tr("plocha, na které se měří první vzdálenost")} onChange={(faceRef) => set({ faceRef })} />
          <EdgesPick f={f} doc={doc} set={set} pickHint={pickHint} allLabel={tr("Všechny hrany plochy")} />
          <TangentChain f={f} set={set} />
          <Info>
            {kind === "twoDistances"
              ? tr("D1 se měří na referenční ploše, D2 na sousední ploše. Vybrané hrany musí s referenční plochou sousedit; „Všechny hrany plochy“ srazí celý její obvod.")
              : tr("Vzdálenost D se měří na referenční ploše; úhel svírá sražení s touto plochou (druhá vzdálenost = D · tg úhlu, 45° = symetrické).")}
          </Info>
        </>
      )}
      {kind === "vertex" && (
        <>
          <div className="grid grid-cols-3 gap-2">
            {d1("D1")}
            <Num label="D2" value={f.d2 ?? f.distance} min={0.01} step={0.5} bind={b("d2")} onChange={(v) => set({ d2: v })} />
            <Num label="D3" value={f.d3 ?? f.d2 ?? f.distance} min={0.01} step={0.5} bind={b("d3")} onChange={(v) => set({ d3: v })} />
          </div>
          <RefListField label={tr("Vrcholy")} value={f.vertexRefs ?? []} want="vertex" onChange={(v) => set({ vertexRefs: v })} />
          {!!f.vertices?.length && <Info>+ {f.vertices.length} {tr("vrcholů zadaných indexem.")}</Info>}
          <Info>{tr("Roh se odřízne rovinou procházející body ve vzdálenostech D1–D3 od vrcholu podél jeho tří hran (v pořadí čísel hran). Ve vrcholu se musí stýkat právě tři hrany.")}</Info>
        </>
      )}
    </>
  );
}

registerFeatureForm("fillet", (p) => <FilletForm {...p} />);
registerFeatureForm("chamfer", (p) => <ChamferForm {...p} />);
