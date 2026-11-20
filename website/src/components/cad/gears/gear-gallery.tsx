"use client";

/**
 * Galerie druhů kol (první obrazovka průvodce): dlaždice po skupinách s živým obrázkem z výchozí tabulky (kuželová,
 * hypoidní kola a šnek z boku), název a normy; dlaždice Soukolí. Jedno klepnutí = tabulka druhu.
 * Automatizace: `[data-gear-kind="<druh>"]`, `[data-gear-kind="pair"]`.
 */
import { tr } from "@/cad/i18n";
import { KINDS, type GearKind } from "@/cad/gears";
import { GearThumb } from "./gear-preview";
import { GALLERY } from "./wizard-state";

export function GearGallery({ onPick, onPair }: { onPick: (k: GearKind) => void; onPair: () => void }) {
  return (
    <div className="space-y-3" data-gear-gallery>
      <p className="text-[12.5px] text-[#4b5866]">{tr("Vyberte druh kola – otevře se jedna tabulka s výchozími hodnotami. Stačí vyplnit modul a počet zubů a kliknout na Vytvořit.")}</p>
      {GALLERY.map((g) => (
        <div key={g.label()}>
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[#6b7785]">{g.label()}</p>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
            {g.kinds.map((k) => (
              <button key={k} type="button" data-gear-kind={k} onClick={() => onPick(k)} className="flex items-center gap-2 rounded border border-[#e3e8ee] bg-white px-2 py-1.5 text-left transition hover:border-brand hover:bg-brand/5">
                <GearThumb kind={k} data={KINDS[k].defaults()} sample className="h-14 w-14 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-semibold leading-tight text-[#0b1f33]">{KINDS[k].label}</span>
                  <span className="block truncate text-[10.5px] text-[#6b7785]">{KINDS[k].standards.slice(0, 2).join(" · ")}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <div>
        <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[#6b7785]">{tr("Dvě kola v záběru")}</p>
        <button type="button" data-gear-kind="pair" onClick={onPair} className="flex w-full items-center gap-3 rounded border border-dashed border-[#cfd6de] bg-[#fbfcfd] px-3 py-2 text-left transition hover:border-brand hover:bg-brand/5 sm:w-auto">
          <span className="flex shrink-0">
            <GearThumb kind="spur" data={{ ...KINDS.spur.defaults(), z: 10 }} className="h-12 w-12" />
            <GearThumb kind="spur" data={{ ...KINDS.spur.defaults(), z: 18 }} className="-ml-2 h-12 w-12" />
          </span>
          <span className="min-w-0">
            <span className="block text-[12.5px] font-semibold text-[#0b1f33]">{tr("Soukolí")}</span>
            <span className="block text-[11px] text-[#6b7785]">{tr("z₁, z₂ (nebo převod), modul, osová vzdálenost → obě kola a sestava s vazbou ozubení")}</span>
          </span>
        </button>
      </div>
    </div>
  );
}
