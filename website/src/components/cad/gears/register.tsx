"use client";

/**
 * Kola a ozubení – UI (vlna 19, balík ui): akce pásu karet `gear.wizard` (průvodce) a `gear.pair` (soukolí) a formulář
 * úprav všech 14 prvků `gear.*` = TATÁŽ tabulka jako v průvodci (vstupy, hlášky u řádků, spočtené řádky, náhled) – změna
 * z nebo m v historii kolo přestaví. Poloha odkazem a směr osy odkazem (hrana, plocha…) se zadávají jako u ostatních prvků.
 *
 * Bez okna (textový běh `akce gear.wizard`, `window.mncad.action`) akce průvodce nic neotevírá – vypíše do protokolu,
 * jak kolo zadat textem (zachytávací API nemá `runText`).
 */
import { useMemo } from "react";
import { tr } from "@/cad/i18n";
import { KINDS, GEAR_KINDS, kindOfExt, rowsToParams, type GearData, type GearRow } from "@/cad/gears";
import type { ExtParam } from "@/cad/ext/registry";
import type { Ref } from "@/cad/refs";
import { ExtDirectionParam } from "../ext-params";
import { registerIcon } from "../ext/icons";
import { registerExtUi, type ExtActionApi, type ExtFormProps } from "../ext/registry";
import { RefField } from "../ref-field";
import { GearPreview } from "./gear-preview";
import { GearTable } from "./gear-table";
import { openGearWizard, type GearWizardOpts } from "./gear-wizard";
import { evaluate, gearName } from "./wizard-state";

registerIcon(
  "gear-pair",
  <>
    <circle cx="8" cy="9" r="5" />
    <circle cx="8" cy="9" r="1.5" />
    <circle cx="17" cy="16" r="4" />
    <circle cx="17" cy="16" r="1.2" />
    <path d="M8 2.5v1.5M8 14v1.5M1.5 9H3M13 9h1.5M3.4 4.4l1 1M11.6 12.6l1 1M3.4 13.6l1-1M11.6 5.4l1-1M17 10.5v1.5M17 20v1.5M11.5 16H13M21 16h1.5" />
  </>,
);

/** jak kolo zadat textem (protokol akce bez okna) */
const textHelp = () =>
  [
    tr("Průvodce Kola a ozubení je okno pro práci myší. Textem se kolo zadá obecným příkazem prvku:"),
    "  prvek gear.spur m=2 z=24 b=20 bore=20 keyway=true",
    "  prvek gear.helical m=2 z=24 beta=15 hand=left",
    "  prvek gear.sprocket chain=08B z=19 rows=2",
    tr("Všechny řádky tabulky druhu (klíč, jednotka, výchozí hodnota, nápověda): prvek nápověda gear.spur"),
    tr("Druhy: {0}", GEAR_KINDS.map((k) => `gear.${k}`).join(", ")),
  ].join("\n");

/** Otevře průvodce z akce rozšíření (pás karet, paleta, úvodní obrazovka, knihovna). */
export function openGears(api: ExtActionApi, opts: GearWizardOpts = {}): Promise<void> {
  if (!api.runText) {
    api.notice(tr("Kola a ozubení"), textHelp());
    return Promise.resolve();
  }
  return openGearWizard({ doc: api.doc, commit: api.commit, flash: api.flash, runText: api.runText }, opts);
}

registerExtUi("gear.wizard", { action: (api) => openGears(api) });
registerExtUi("gear.pair", { action: (api) => openGears(api, { pair: true }) });

/** Formulář úpravy prvku `gear.*` – stejná tabulka jako v průvodci. */
function GearEditForm({ f, onChange }: ExtFormProps) {
  const def = kindOfExt(f.ext)!;
  const data = useMemo<GearData>(() => ({ ...def.defaults(), ...(f.data ?? {}) }), [def, f.data]);
  const ev = useMemo(() => evaluate(def.kind, data), [def, data]);
  const params = useMemo(() => rowsToParams(def.rows), [def]);
  const special = (r: GearRow) => {
    if (r.kind === "point")
      return (
        <div>
          <RefField label={r.label} want="point" allowXyz={false} compact value={(f.data?.[r.key] as Ref | undefined) ?? undefined} onChange={(ref) => onChange({ [r.key]: ref })} />
          {!!f.data?.[r.key] && (
            <button type="button" className="mt-1 text-[11px] text-brand underline" onClick={() => onChange({ [r.key]: null })}>
              {tr("Zrušit odkaz (použít souřadnice)")}
            </button>
          )}
        </div>
      );
    if (r.kind === "direction") {
      const p = params.find((x) => x.key === r.key) as Extract<ExtParam, { kind: "direction" }> | undefined;
      return p ? <ExtDirectionParam p={{ ...p, label: "", hint: undefined }} value={f.data?.[r.key]} onChange={(d) => onChange({ [r.key]: d })} /> : null;
    }
    return null;
  };
  const stale = f.name !== gearName(def.kind, data) && /\b[mz]\d/.test(f.name);
  return (
    <div className="space-y-2" data-gear-form={def.kind}>
      <div className="flex items-center gap-2">
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-semibold">{def.label}</p>
          <p className="truncate text-[11px] text-[#6b7785]">{def.standards.join(" · ")}</p>
        </div>
      </div>
      <GearPreview kind={def.kind} data={data} compact />
      {stale && <p className="text-[11px] text-[#6b7785]">{tr("Podle tabulky: {0} (název prvku se nemění – přejmenujte ho v historii).", gearName(def.kind, data))}</p>}
      <GearTable rows={def.rows} data={data} onChange={(p) => onChange(p)} issues={ev.issues} computed={ev.rows} mode="edit" bindPrefix={`${f.id}:data.`} special={special} />
      <p className="text-[11px] leading-snug text-[#6b7785]">
        <span className="font-semibold">{tr("Přesnost:")}</span> {def.accuracy}
      </p>
    </div>
  );
}

for (const k of GEAR_KINDS) registerExtUi(KINDS[k].ext, { Form: GearEditForm });
