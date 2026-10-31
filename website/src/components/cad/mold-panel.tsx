"use client";

import { useState } from "react";
import { DRAFT_COLORS, DRAFT_LABELS, SHRINKAGE, defaultCooling, type CoolingParams, type DraftClass, type DraftResult, type EjectorSuggestion } from "@/cad/mold";
import type { Vec3 } from "@/cad/types";
import { fmtNum } from "@/lib/mesh-metrics";
import { cn } from "@/lib/cn";
import { CadIcon } from "./cad-icons";
import { Num } from "./props";
import { Btn, FloatPanel, Row, Segmented, Toggle } from "./ui";

export type DraftSetup = { on: boolean; pull: Vec3; minDeg: number };

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
}) {
  const [tab, setTab] = useState<"draft" | "shrink" | "eject" | "cool">("draft");
  const [shrinkId, setShrinkId] = useState("pp");
  const [custom, setCustom] = useState<number | null>(null);
  const [cool, setCool] = useState<CoolingParams | null>(bbox ? defaultCooling(bbox) : null);
  const pct = custom ?? SHRINKAGE.find((s) => s.id === shrinkId)?.pct ?? 1;
  const total = draftResult ? draftResult.areas.reduce((a, b) => a + b, 0) || 1 : 1;
  const axisOf = (p: Vec3) => (p[0] ? "X" : p[1] ? "Y" : "Z") as "X" | "Y" | "Z";
  const sign = (p: Vec3) => (p[0] + p[1] + p[2] < 0 ? -1 : 1);

  return (
    <FloatPanel title="Formařské nástroje" icon="layers" tone="create" onClose={onClose} width={300} initial={{ x: 12, y: 12 }}>
      <Segmented
        size="sm"
        value={tab}
        options={[
          { v: "draft", l: "Úkosy" },
          { v: "shrink", l: "Smrštění" },
          { v: "eject", l: "Vyhazovače" },
          { v: "cool", l: "Chlazení" },
        ]}
        onChange={setTab}
      />
      {tab === "draft" && (
        <div className="mt-3 space-y-2">
          <Toggle label="Barevná mapa úkosů" checked={draft.on} onChange={(on) => setDraft({ ...draft, on })} />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-700/55">Směr vyhození</p>
              <Segmented size="sm" value={axisOf(draft.pull)} options={[{ v: "X", l: "X" }, { v: "Y", l: "Y" }, { v: "Z", l: "Z" }]} onChange={(a) => setDraft({ ...draft, on: true, pull: [a === "X" ? sign(draft.pull) : 0, a === "Y" ? sign(draft.pull) : 0, a === "Z" ? sign(draft.pull) : 0] as Vec3 })} />
            </div>
            <Num label="Min. úkos" value={draft.minDeg} step={0.5} min={0} suffix="°" onChange={(v) => setDraft({ ...draft, on: true, minDeg: v })} />
          </div>
          <Btn onClick={() => setDraft({ ...draft, on: true, pull: draft.pull.map((v) => -v) as Vec3 })} className="w-full">
            Obrátit směr
          </Btn>
          {draftResult && (
            <div className="space-y-1 pt-1">
              {([0, 1, 2, 3] as DraftClass[]).map((k) => (
                <div key={k} className="flex items-center gap-2 text-[12px]">
                  <span className="h-3 w-3 rounded-sm" style={{ background: DRAFT_COLORS[k] }} />
                  <span className="flex-1">{DRAFT_LABELS[k]}</span>
                  <span className="font-mono text-[11px] text-[#5b6776]">{fmtNum((draftResult.areas[k] / total) * 100, 1)} %</span>
                </div>
              ))}
              <p className={cn("mt-1 rounded px-2 py-1 text-[11.5px]", draftResult.undercutRatio > 0 ? "bg-brand/10 text-brand-600" : "bg-emerald-50 text-emerald-700")}>
                {draftResult.undercutRatio > 0 ? `Podkosy na ${fmtNum(draftResult.undercutRatio * 100, 1)} % povrchu – díl nelze vyhodit bez posuvných čelistí.` : "Bez podkosů ✓ Díl lze vyhodit ve zvoleném směru."}
              </p>
            </div>
          )}
          <div className="border-t border-[#edf1f5] pt-2">
            <Btn onClick={onParting} className="w-full" disabled={!bbox}>
              Navrhnout dělicí rovinu
            </Btn>
            {partingZ && <Row k="Dělicí rovina" v={`Z = ${fmtNum(partingZ.z, 2)} mm · obvod ${fmtNum(partingZ.perimeter, 0)} mm`} />}
          </div>
        </div>
      )}

      {tab === "shrink" && (
        <div className="mt-3 space-y-2">
          <p className="text-[11.5px] leading-relaxed text-[#6b7785]">Dutina formy musí být o smrštění větší než výlisek. Přidá do historie dílu měřítko (lze kdykoli upravit nebo potlačit).</p>
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
            <option value="custom">Vlastní hodnota…</option>
          </select>
          {custom != null && <Num label="Smrštění" value={custom} step={0.1} min={0} suffix="%" onChange={setCustom} />}
          <Row k="Měřítko dutiny" v={`× ${(1 + pct / 100).toFixed(4)}`} strong />
          <Btn primary className="w-full" onClick={() => onShrink(pct)}>
            Použít smrštění {pct} %
          </Btn>
        </div>
      )}

      {tab === "eject" && (
        <div className="mt-3 space-y-2">
          <p className="text-[11.5px] leading-relaxed text-[#6b7785]">Návrh pravidelného rozmístění vyhazovačů v půdorysu dílu. Na díl se přidají díry, do sestavy skutečné vyhazovače.</p>
          <Row k="Navrženo" v={ejectors.length ? `${ejectors.length} × Ø${ejectors[0].d} mm` : "—"} />
          <div className="grid grid-cols-2 gap-2">
            <Btn disabled={!bbox} onClick={() => onEjectors(ejectors, "holes")}>
              Díry do dílu
            </Btn>
            <Btn disabled={!bbox} onClick={() => onEjectors(ejectors, "pins")}>
              Vyhazovače do sestavy
            </Btn>
          </div>
        </div>
      )}

      {tab === "cool" && cool && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Num label="Ø kanálu" value={cool.diameter} min={4} onChange={(v) => setCool({ ...cool, diameter: v })} />
            <Num label="Hloubka pod dutinou" value={cool.depth} min={5} onChange={(v) => setCool({ ...cool, depth: v })} />
            <Num label="Počet větví" value={cool.rows} min={1} step={1} suffix="" onChange={(v) => setCool({ ...cool, rows: Math.round(v) })} />
            <Num label="Přesah" value={cool.overhang} min={0} onChange={(v) => setCool({ ...cool, overhang: v })} />
          </div>
          <p className="text-[11.5px] text-[#6b7785]">Meandr rovnoběžných vrtů propojených příčnými vrty. Doporučená vzdálenost od dutiny 2–3 × Ø.</p>
          <div className="grid grid-cols-2 gap-2">
            <Btn onClick={() => onCooling(cool, "part")}>Vrtat do dílu (negativ)</Btn>
            <Btn onClick={() => onCooling(cool, "component")}>Vložit do sestavy</Btn>
          </div>
        </div>
      )}
      {tab === "cool" && !cool && (
        <p className="mt-3 flex items-center gap-2 text-[12px] text-[#6b7785]">
          <CadIcon name="info" className="h-4 w-4" /> Nejdřív vytvořte nebo otevřete těleso.
        </p>
      )}
    </FloatPanel>
  );
}
