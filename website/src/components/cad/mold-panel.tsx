"use client";

import { tr } from "@/cad/i18n";
import { useState } from "react";
import { DRAFT_COLORS, DRAFT_LABELS, SHRINKAGE, defaultCooling, type CoolingParams, type DraftClass, type DraftResult, type EjectorSuggestion } from "@/cad/mold";
import type { Vec3 } from "@/cad/types";
import { fmtNum } from "@/lib/mesh-metrics";
import { cn } from "@/lib/cn";
import { CadIcon } from "./cad-icons";
import { DirVecField } from "./dir-vec-field";
import { pullChange, pullShown, type DraftSetup } from "./mold-pull";
import { Num } from "./props";
import { Btn, FloatPanel, Row, Segmented, Toggle } from "./ui";

/** Směr vyhození (= směr otevírání formy) – viz `mold-pull.ts` (`pull` jednotkový, `pullRaw` zadání v poli, `pullDef` odkaz). */
export type { DraftSetup };
/** analýza ploch: žádná / zebra / křivost / tloušťka stěn */
export type SurfaceSetup = { mode: "none" | "zebra" | "curvature" | "thickness"; limit: number; info?: string };

/**
 * Panel formařských nástrojů: analýza úkosů (barevná mapa), smrštění, dělicí rovina,
 * návrh vyhazovačů a chladicího okruhu.
 */
export function MoldPanel({
  bbox,
  draft,
  setDraft,
  draftResult,
  onShrink,
  onParting,
  partingZ,
  onEjectors,
  ejectors,
  onCooling,
  onClose,
  surface,
  setSurface,
}: {
  bbox: [Vec3, Vec3] | null;
  draft: DraftSetup;
  setDraft: (d: DraftSetup) => void;
  draftResult: DraftResult | null;
  onShrink: (pct: number) => void;
  onParting: () => void;
  partingZ: { z: number; perimeter: number } | null;
  onEjectors: (list: EjectorSuggestion[], mode: "holes" | "pins") => void;
  ejectors: EjectorSuggestion[];
  onCooling: (p: CoolingParams, mode: "part" | "component") => void;
  onClose: () => void;
  surface: SurfaceSetup;
  setSurface: (s: SurfaceSetup) => void;
}) {
  const [tab, setTab] = useState<"draft" | "surface" | "shrink" | "eject" | "cool">("draft");
  const [shrinkId, setShrinkId] = useState("pp");
  const [custom, setCustom] = useState<number | null>(null);
  const [cool, setCool] = useState<CoolingParams | null>(bbox ? defaultCooling(bbox) : null);
  const pct = custom ?? SHRINKAGE.find((s) => s.id === shrinkId)?.pct ?? 1;
  const total = draftResult ? draftResult.areas.reduce((a, b) => a + b, 0) || 1 : 1;
  /** směr otevírání formy – stejné pole na kartách Úkosy, Vyhazovače a Chlazení (typovaný vektor nebo odkaz na model) */
  const pullField = (label: string, showMap: boolean) => (
    <DirVecField
      label={label}
      value={pullShown(draft)}
      def={draft.pullDef}
      flip={draft.pullFlip}
      attr="data-pull-dir"
      onChange={(v, def, flip) => setDraft(pullChange(draft, v, def, flip, showMap))}
    />
  );

  return (
    <FloatPanel title={tr("Formařské nástroje")} icon="layers" tone="create" onClose={onClose} width={300} initial={{ x: 12, y: 12 }}>
      <Segmented
        size="sm"
        value={tab}
        options={[
          { v: "draft", l: tr("Úkosy") },
          { v: "surface", l: tr("Plochy") },
          { v: "shrink", l: tr("Smrštění") },
          { v: "eject", l: tr("Vyhazovače") },
          { v: "cool", l: tr("Chlazení") },
        ]}
        onChange={setTab}
      />
      {tab === "draft" && (
        <div className="mt-3 space-y-2">
          <Toggle label={tr("Barevná mapa úkosů")} checked={draft.on} onChange={(on) => setDraft({ ...draft, on })} />
          <div data-mold-pull>{pullField(tr("Směr vyhození"), true)}</div>
          <Num label={tr("Min. úkos")} value={draft.minDeg} step={0.5} min={0} suffix="°" onChange={(v) => setDraft({ ...draft, on: true, minDeg: v })} />
          {draftResult && (
            <div className="space-y-1 pt-1">
              {([0, 1, 2, 3] as DraftClass[]).map((k) => (
                <div key={k} className="flex items-center gap-2 text-[12px]">
                  <span className="h-3 w-3 rounded-sm" style={{ background: DRAFT_COLORS[k] }} />
                  <span className="flex-1">{tr(DRAFT_LABELS[k])}</span>
                  <span className="font-mono text-[11px] text-[#5b6776]">{fmtNum((draftResult.areas[k] / total) * 100, 1)} %</span>
                </div>
              ))}
              <p className={cn("mt-1 rounded px-2 py-1 text-[11.5px]", draftResult.undercutRatio > 0 ? "bg-brand/10 text-brand-600" : "bg-emerald-50 text-emerald-700")}>
                {draftResult.undercutRatio > 0 ? tr("Podkosy na {0} % povrchu – díl nelze vyhodit bez posuvných čelistí.", fmtNum(draftResult.undercutRatio * 100, 1)) : tr("Bez podkosů ✓ Díl lze vyhodit ve zvoleném směru.")}
              </p>
            </div>
          )}
          <div className="border-t border-[#edf1f5] pt-2">
            <Btn onClick={onParting} className="w-full" disabled={!bbox}>
              {tr("Navrhnout dělicí rovinu")}
            </Btn>
            {partingZ && <Row k={tr("Dělicí rovina")} v={`Z = ${fmtNum(partingZ.z, 2)} mm · obvod ${fmtNum(partingZ.perimeter, 0)} mm`} />}
          </div>
        </div>
      )}

      {tab === "surface" && (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{tr("Analýza ploch")}</p>
          <div className="space-y-1">
            {(
              [
                ["none", "Vypnuto"],
                ["zebra", tr("Zebra pruhy – návaznost a hladkost ploch")],
                ["curvature", tr("Mapa křivosti – modrá vydutá, zelená rovina, červená vypuklá")],
                ["thickness", tr("Tloušťka stěn – červená pod limitem")],
              ] as [SurfaceSetup["mode"], string][]
            ).map(([m, l]) => (
              <label key={m} className={cn("flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-[12px]", surface.mode === m ? "bg-[#eef2f6]" : "hover:bg-[#f7f9fb]")}>
                <input type="radio" name="surface-mode" checked={surface.mode === m} onChange={() => setSurface({ ...surface, mode: m })} className="mt-0.5 accent-[#E03930]" />
                {l}
              </label>
            ))}
          </div>
          {surface.mode === "thickness" && <Num label={tr("Minimální tloušťka")} value={surface.limit} step={0.5} min={0.1} onChange={(v) => setSurface({ ...surface, limit: v })} />}
          {surface.info && <p className="rounded bg-[#eef2f6] px-2 py-1 text-[11.5px] text-[#4a5664]">{surface.info}</p>}
        </div>
      )}
      {tab === "shrink" && (
        <div className="mt-3 space-y-2">
          <p className="text-[11.5px] leading-relaxed text-[#6b7785]">{tr("Dutina formy musí být o smrštění větší než výlisek. Přidá do historie dílu měřítko (lze kdykoli upravit nebo potlačit).")}</p>
          <select
            value={custom != null ? "custom" : shrinkId}
            onChange={(e) => {
              if (e.target.value === "custom") setCustom(pct);
              else {
                setCustom(null);
                setShrinkId(e.target.value);
              }
            }}
            className="w-full rounded border border-[#cfd6de] bg-white px-2 py-1.5 text-[12.5px]"
          >
            {SHRINKAGE.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} – {s.pct} %
              </option>
            ))}
            <option value="custom">{tr("Vlastní hodnota…")}</option>
          </select>
          {custom != null && <Num label={tr("Smrštění")} value={custom} step={0.1} min={0} suffix="%" onChange={setCustom} />}
          <Row k={tr("Měřítko dutiny")} v={`× ${(1 + pct / 100).toFixed(4)}`} strong />
          <Btn primary className="w-full" onClick={() => onShrink(pct)}>
            {tr("Použít smrštění")}{" "}{pct} %
          </Btn>
        </div>
      )}

      {tab === "eject" && (
        <div className="mt-3 space-y-2">
          <p className="text-[11.5px] leading-relaxed text-[#6b7785]">{tr("Návrh pravidelného rozmístění vyhazovačů v průmětu dílu kolmo na směr otevírání formy. Na díl se přidají díry, do sestavy skutečné vyhazovače.")}</p>
          <div data-mold-eject-dir>{pullField(tr("Směr otevírání formy (= vyhození)"), false)}</div>
          <Row k={tr("Navrženo")} v={ejectors.length ? `${ejectors.length} × Ø${ejectors[0].d} mm` : "—"} />
          <div className="grid grid-cols-2 gap-2">
            <Btn disabled={!bbox} onClick={() => onEjectors(ejectors, "holes")}>
              {tr("Díry do dílu")}
            </Btn>
            <Btn disabled={!bbox} onClick={() => onEjectors(ejectors, "pins")}>
              {tr("Vyhazovače do sestavy")}
            </Btn>
          </div>
        </div>
      )}

      {tab === "cool" && cool && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Num label={tr("Ø kanálu")} value={cool.diameter} min={4} onChange={(v) => setCool({ ...cool, diameter: v })} />
            <Num label={tr("Hloubka pod dutinou")} value={cool.depth} min={5} onChange={(v) => setCool({ ...cool, depth: v })} />
            <Num label={tr("Počet větví")} value={cool.rows} min={1} step={1} suffix="" onChange={(v) => setCool({ ...cool, rows: Math.round(v) })} />
            <Num label={tr("Přesah")} value={cool.overhang} min={0} onChange={(v) => setCool({ ...cool, overhang: v })} />
          </div>
          <p className="text-[11.5px] text-[#6b7785]">{tr("Meandr rovnoběžných vrtů propojených příčnými vrty. Doporučená vzdálenost od dutiny 2–3 × Ø.")}</p>
          <div data-mold-cool-dir>{pullField(tr("Směr otevírání formy – kanály leží kolmo na něj pod dutinou"), false)}</div>
          <div className="grid grid-cols-2 gap-2">
            <Btn onClick={() => onCooling({ ...cool, dir: draft.pull }, "part")}>{tr("Vrtat do dílu (negativ)")}</Btn>
            <Btn onClick={() => onCooling({ ...cool, dir: draft.pull }, "component")}>{tr("Vložit do sestavy")}</Btn>
          </div>
        </div>
      )}
      {tab === "cool" && !cool && (
        <p className="mt-3 flex items-center gap-2 text-[12px] text-[#6b7785]">
          <CadIcon name="info" className="h-4 w-4" /> {tr("Nejdřív vytvořte nebo otevřete těleso.")}
        </p>
      )}
    </FloatPanel>
  );
}
