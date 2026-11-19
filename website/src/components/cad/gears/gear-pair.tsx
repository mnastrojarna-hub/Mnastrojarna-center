"use client";

/**
 * Soukolí v průvodci: druh soukolí, tabulka (z₁, z₂ nebo převod i, modul, osová vzdálenost – prázdná = spočtená, zadaná →
 * posunutí Σx se spočte a rozdělí podle DIN 3992, boční vůle, šířka, díry), výsledek (převod, a_w, α_w, x₁/x₂, ε_α, ε_β…),
 * varování (podřezání, špičatý zub, interference, ε_α) a náhled obou kol v záběru. „Vytvořit soukolí“ spustí skript
 * existujících příkazů (dva díly, sestava, vložení, vazba Ozubení / Hřeben) – stejný, jaký vrací text `soukolí`.
 * Automatizace: `[data-gear-pair]`, výběr druhu `[data-gear-pair-kind]`, výsledek `[data-gear-calc]`, skript `[data-gear-script]`.
 */
import { useMemo, useState } from "react";
import { tr } from "@/cad/i18n";
import { PAIR_ROWS, type GearData, type PairKind } from "@/cad/gears";
import { Computed, GearTable, cellIn } from "./gear-table";
import { PairPreview } from "./gear-preview";
import { planPair } from "./wizard-state";

/** popisky druhů soukolí v pořadí výběru */
export const PAIR_LABELS: Record<PairKind, () => string> = {
  spur: () => tr("Čelní s přímými zuby"),
  helical: () => tr("Čelní se šikmými zuby"),
  herringbone: () => tr("Šípové"),
  internal: () => tr("Vnitřní (pastorek ve věnci)"),
  rack: () => tr("Pastorek a hřeben"),
  bevel: () => tr("Kuželové"),
  hypoid: () => tr("Hypoidní"),
  worm: () => tr("Šnek a šnekové kolo"),
  cycloid: () => tr("Cykloidní (hodinové)"),
  cyclodisc: () => tr("Cykloidní reduktor (kotouč a věnec)"),
  sprocket: () => tr("Řetězový převod"),
  pulley: () => tr("Řemenový převod"),
};

export function GearPairPanel({ kind, values, onKind, onChange, onReset }: { kind: PairKind; values: GearData; onKind: (k: PairKind) => void; onChange: (p: GearData) => void; onReset: () => void }) {
  const { res, script } = useMemo(() => planPair(kind, values), [kind, values]);
  const [showScript, setShowScript] = useState(false);
  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" data-gear-pair={kind}>
      <div className="min-w-0 space-y-2">
        <label className="block">
          <span className="mb-0.5 block text-[10.5px] font-semibold uppercase tracking-wider text-[#6b7785]">{tr("Druh soukolí")}</span>
          <select className={cellIn} data-gear-pair-kind value={kind} onChange={(e) => onKind(e.target.value as PairKind)} aria-label={tr("Druh soukolí")}>
            {(Object.keys(PAIR_LABELS) as PairKind[]).map((k) => (
              <option key={k} value={k}>
                {PAIR_LABELS[k]()}
              </option>
            ))}
          </select>
        </label>
        <GearTable rows={PAIR_ROWS[kind]} data={values} onChange={onChange} issues={res.issues} mode="wizard" autoFocus />
        <button type="button" onClick={onReset} className="text-[11.5px] text-[#6b7785] underline-offset-2 hover:text-brand hover:underline">
          {tr("Výchozí hodnoty")}
        </button>
      </div>
      <div className="min-w-0 space-y-2">
        <PairPreview kind={kind} res={res} />
        {res.ok && <p className="text-center text-[12.5px] font-semibold text-[#0b1f33]" data-gear-pair-title>{res.asmName}</p>}
        {res.rows.length > 0 && <Computed rows={res.rows} title={tr("Výsledek soukolí")} />}
        {res.ok && (
          <div className="text-[11.5px] text-[#4b5866]">
            <button type="button" onClick={() => setShowScript((v) => !v)} className="underline-offset-2 hover:text-brand hover:underline">
              {showScript ? tr("Skrýt textové příkazy") : tr("Ukázat textové příkazy (stejné jako pro AI agenty)")}
            </button>
            {showScript && (
              <pre data-gear-script className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-[#e3e8ee] bg-[#f7f9fb] p-2 font-mono text-[11px] text-[#26303b]">
                {script.join("\n")}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
