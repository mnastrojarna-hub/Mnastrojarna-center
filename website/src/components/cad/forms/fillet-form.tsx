"use client";
/**
 * Formuláře zaoblení a zkosení (5. vlna): přepínač druhu zadání a pole podle druhu.
 * Výběr hran klikem v modelu běží přes pole `edges` (jako dosud); plochy a vrcholy se zadávají poli odkazů
 * (`faceRefs`, `faceRefs2`, `faceRefsMid`, `faceRef`, `vertexRefs`), které stavitel přeloží na topologii s otiskem.
 */
import type { Feature } from "@/cad/types";
import { Check, Info, Num, PickInfo, Seg } from "../props";
import { RefField, RefListField } from "../ref-field";
import { registerFeatureForm, type FeatureFormProps } from "./registry";

type FilletF = Extract<Feature, { type: "fillet" }>;
type ChamferF = Extract<Feature, { type: "chamfer" }>;
type FilletKind = NonNullable<FilletF["kind"]>;
type ChamferKind = NonNullable<ChamferF["kind"]>;

const FILLET_KINDS: { v: FilletKind; l: string }[] = [
  { v: "constant", l: "Konstantní" },
  { v: "asymmetric", l: "R1 → R2" },
  { v: "variable", l: "Tabulka" },
  { v: "faceFace", l: "Plocha–plocha" },
  { v: "fullRound", l: "Plný" },
];
const CHAMFER_KINDS: { v: ChamferKind; l: string }[] = [
  { v: "equal", l: "Stejné" },
  { v: "twoDistances", l: "D1 × D2" },
  { v: "distanceAngle", l: "D × úhel" },
  { v: "vertex", l: "Vrchol" },
];

const without = (o: Record<string, number> | undefined, k: string) => (o ? Object.fromEntries(Object.entries(o).filter(([key]) => key !== k)) : o);

/** Hrany: vybrané klikem / všechny (+ počet vybraných). */
function EdgesPick({ f, set, pickHint, allLabel = "Všechny" }: { f: FilletF | ChamferF; set: FeatureFormProps["set"]; pickHint?: string; allLabel?: string }) {
  return (
    <>
      <Seg label="Hrany" value={f.edges === "all" ? "all" : "pick"} options={[{ v: "pick", l: "Vybrané" }, { v: "all", l: allLabel }]} onChange={(v) => set({ edges: v === "all" ? "all" : [] })} />
      {f.edges !== "all" && <PickInfo n={f.edges.length} what="hran" hint={pickHint} onClear={() => set({ edges: [] })} />}
    </>
  );
}

function TangentChain({ f, set }: { f: FilletF | ChamferF; set: FeatureFormProps["set"] }) {
  return <Check label="Šířit výběr po tečně navazujících hranách" value={!!f.tangentChain} onChange={(v) => set({ tangentChain: v })} />;
}

function FilletForm({ f, set, b, pickHint }: FeatureFormProps<FilletF>) {
  const kind: FilletKind = f.kind ?? "constant";
  const edgeIdx = f.edges === "all" ? [] : f.edges;
  const radiusField = (label = "Poloměr") => <Num label={label} value={f.radius} min={0.01} step={0.5} bind={b("radius")} onChange={(v) => set({ radius: v })} />;
  return (
    <>
      <Seg label="Druh zaoblení" value={kind} options={FILLET_KINDS} onChange={(v) => set({ kind: v })} />
      {kind === "constant" && (
        <>
          {radiusField()}
          <EdgesPick f={f} set={set} pickHint={pickHint} />
          <TangentChain f={f} set={set} />
        </>
      )}
      {kind === "asymmetric" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {radiusField("R1 (začátek hrany)")}
            <Num label="R2 (konec hrany)" value={f.r2 ?? f.radius} min={0.01} step={0.5} bind={b("r2")} onChange={(v) => set({ r2: v })} />
          </div>
          <button type="button" className="text-[12px] text-brand underline" onClick={() => set({ radius: f.r2 ?? f.radius, r2: f.radius })}>
            Prohodit R1 ↔ R2
          </button>
          <EdgesPick f={f} set={set} pickHint={pickHint} />
          <TangentChain f={f} set={set} />
          <Info>
            Poloměr se mění lineárně od začátku hrany (R1) k jejímu konci (R2). Začátek hrany určuje model – běží-li přechod obráceně, hodnoty prohoďte. Eliptické (asymetrické) zaoblení s různou vzdáleností na každé
            ploše jádro OCCT neumí.
          </Info>
        </>
      )}
      {kind === "variable" && (
        <>
          {radiusField("Výchozí poloměr")}
          <EdgesPick f={f} set={set} pickHint={pickHint} />
          {f.edges === "all" ? (
            <Info>Pro tabulku poloměrů vyberte hrany klikem v modelu – u volby „Všechny“ platí výchozí poloměr.</Info>
          ) : (
            edgeIdx.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-wider text-ink-700/55">Poloměry hran</p>
                {edgeIdx.map((i) => {
                  const k = String(i);
                  const r1 = f.radii?.[k] ?? f.radius;
                  const r2 = f.radii2?.[k] ?? r1;
                  return (
                    <div key={i} className="rounded-lg border border-ink-700/10 p-2">
                      <div className="mb-1 flex items-center justify-between text-[12px]">
                        <span className="font-medium">Hrana {i + 1}</span>
                        <button type="button" onClick={() => set({ edges: edgeIdx.filter((x) => x !== i), radii: without(f.radii, k), radii2: without(f.radii2, k) })} className="rounded px-1.5 text-ink-700/50 hover:bg-steel-100" title="Odebrat hranu">
                          ×
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Num label="R začátek" value={r1} min={0.01} step={0.5} onChange={(v) => set({ radii: { ...f.radii, [k]: v } })} />
                        <Num label="R konec" value={r2} min={0.01} step={0.5} onChange={(v) => set({ radii2: { ...f.radii2, [k]: v } })} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
          <Info>Každá hrana může mít vlastní poloměr; liší-li se začátek a konec, mění se poloměr podél hrany lineárně. Řídicí body uprostřed hrany jádro neumožňuje; tečně navazující hrany tvoří jeden přechod se společným poloměrem.</Info>
        </>
      )}
      {kind === "faceFace" && (
        <>
          {radiusField()}
          <RefListField label="Sada ploch 1" value={f.faceRefs ?? []} want="face" onChange={(v) => set({ faceRefs: v })} />
          <RefListField label="Sada ploch 2" value={f.faceRefs2 ?? []} want="face" onChange={(v) => set({ faceRefs2: v })} />
          <Info>Zaoblí se hrany, které má plocha z první sady společné s plochou z druhé sady (např. horní plocha × všechny boční = celý obvod).</Info>
        </>
      )}
      {kind === "fullRound" && (
        <>
          <RefListField label="Boční plocha 1" value={f.faceRefs ?? []} want="face" onChange={(v) => set({ faceRefs: v })} />
          <RefListField label="Prostřední plocha (zaoblí se)" value={f.faceRefsMid ?? []} want="face" onChange={(v) => set({ faceRefsMid: v })} />
          <RefListField label="Boční plocha 2" value={f.faceRefs2 ?? []} want="face" onChange={(v) => set({ faceRefs2: v })} />
          <Info>
            Poloměr = polovina vzdálenosti rovnoběžných bočních ploch; prostřední plocha se nahradí válcem tečným k oběma. Prostřední plochu lze vynechat, je-li mezi bočními plochami jediná. Obdélníková prostřední plocha kolmá na
            boční se zaoblí přesně, jiná přibližně.
          </Info>
        </>
      )}
      {(kind === "constant" || kind === "asymmetric" || kind === "variable") && f.tangentChain && <Info>Jádro šíří zaoblení po tečně navazujících hranách (hrana → oblouk → hrana) i samo; volba rozšíří i výběr, se kterým pracuje tabulka a počet hran.</Info>}
    </>
  );
}

function ChamferForm({ f, set, b, pickHint }: FeatureFormProps<ChamferF>) {
  const kind: ChamferKind = f.kind ?? "equal";
  const withFace = kind === "twoDistances" || kind === "distanceAngle";
  const d1 = (label: string) => <Num label={label} value={f.distance} min={0.01} step={0.5} bind={b("distance")} onChange={(v) => set({ distance: v })} />;
  return (
    <>
      <Seg label="Druh sražení" value={kind} options={CHAMFER_KINDS} onChange={(v) => set({ kind: v })} />
      {kind === "equal" && (
        <>
          {d1("Velikost sražení")}
          <EdgesPick f={f} set={set} pickHint={pickHint} />
          <TangentChain f={f} set={set} />
        </>
      )}
      {kind === "twoDistances" && (
        <div className="grid grid-cols-2 gap-2">
          {d1("D1 (na ref. ploše)")}
          <Num label="D2 (sousední plocha)" value={f.d2 ?? f.distance} min={0.01} step={0.5} bind={b("d2")} onChange={(v) => set({ d2: v })} />
        </div>
      )}
      {kind === "distanceAngle" && (
        <div className="grid grid-cols-2 gap-2">
          {d1("D (na ref. ploše)")}
          <Num label="Úhel od ref. plochy" value={f.angle ?? 45} min={1} step={5} suffix="°" bind={b("angle")} onChange={(v) => set({ angle: v })} />
        </div>
      )}
      {withFace && (
        <>
          <RefField label="Referenční plocha" value={f.faceRef} want="face" hint="plocha, na které se měří první vzdálenost" onChange={(faceRef) => set({ faceRef })} />
          <EdgesPick f={f} set={set} pickHint={pickHint} allLabel="Všechny hrany plochy" />
          <TangentChain f={f} set={set} />
          <Info>
            {kind === "twoDistances"
              ? "D1 se měří na referenční ploše, D2 na sousední ploše. Vybrané hrany musí s referenční plochou sousedit; „Všechny hrany plochy“ srazí celý její obvod."
              : "Vzdálenost D se měří na referenční ploše; úhel svírá sražení s touto plochou (druhá vzdálenost = D · tg úhlu, 45° = symetrické)."}
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
          <RefListField label="Vrcholy" value={f.vertexRefs ?? []} want="vertex" onChange={(v) => set({ vertexRefs: v })} />
          {!!f.vertices?.length && <Info>+ {f.vertices.length} vrcholů zadaných indexem.</Info>}
          <Info>Roh se odřízne rovinou procházející body ve vzdálenostech D1–D3 od vrcholu podél jeho tří hran (v pořadí čísel hran). Ve vrcholu se musí stýkat právě tři hrany.</Info>
        </>
      )}
    </>
  );
}

registerFeatureForm("fillet", (p) => <FilletForm {...p} />);
registerFeatureForm("chamfer", (p) => <ChamferForm {...p} />);
