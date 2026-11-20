"use client";

/**
 * Panel „Pozice a překryvy“ výkresu sestavy (vlna 22, bod 17): pozice po pohledech (výběr pohledu pro každou pozici,
 * zámek), umístění kusovníku (nad razítkem / ve sloupcích / automaticky), počet překryvů na listu (odznak) a značky
 * překryvů přes list. Stejná data jako text (`výkres pozice`, `výkres stav`): přiřazení = volba `balloonViews`, zámek =
 * `genEdit.lock` (cad/drawing-boxsel.ts `lockGenerated`), kontrola = cad/drawing-overlaps.ts `sheetOverlaps`.
 * Balónek jde dál táhnout myší na listu (výběr ve výkresu); zamčený se táhne i se zámkem.
 */
import { useMemo } from "react";
import { BALLOON_VIEWS, type DrawingOptions, type DrawingResult } from "@/cad/drawing";
import { lockGenerated } from "@/cad/drawing-boxsel";
import { overlapAdvice, overlapSummary, sheetOverlaps, type SheetOverlaps } from "@/cad/drawing-overlaps";
import { VIEW_CS } from "@/cad/agent-drawing";
import { tr } from "@/cad/i18n";

type Props = {
  res: DrawingResult | null;
  /** list s poznámkami a kótami (withAnnotations) – kontrola překryvů běží nad ním */
  out: DrawingResult | null;
  opts: DrawingOptions;
  set: <K extends keyof DrawingOptions>(k: K, v: DrawingOptions[K]) => void;
  showMarkers: boolean;
  onShowMarkers: (v: boolean) => void;
  hasBom: boolean;
};

const viewName = (k: string) => tr(VIEW_CS[k as keyof typeof VIEW_CS] ?? k);
const selectCls = "rounded border border-ink-700/15 bg-white px-1 py-0.5 text-[11px]";

/** kontrola překryvů hotového listu (s poznámkami) – sdílí panel i značky */
export function useSheetOverlaps(out: DrawingResult | null): SheetOverlaps | null {
  return useMemo(() => (out ? sheetOverlaps(out) : null), [out]);
}

export function PositionsPanel({ res, out, opts, set, showMarkers, onShowMarkers, hasBom }: Props) {
  const ov = useSheetOverlaps(out);
  const bs = res?.balloons ?? [];
  const onSheet = new Set((res?.views ?? []).map((v) => v.key));
  const views = BALLOON_VIEWS.filter((k) => onSheet.has(k) || (k === "iso" && opts.views.iso));
  const assign = (pos: number, v: string) => {
    const map = { ...(opts.balloonViews ?? {}) };
    if (v === "auto") delete map[String(pos)];
    else map[String(pos)] = v;
    set("balloonViews", Object.keys(map).length ? map : undefined);
  };
  const lock = (id: string, on: boolean, at: [number, number]) => set("genEdit", lockGenerated(opts.genEdit, [id], () => (on ? at : null)));
  const info = res?.balloonInfo;
  return (
    <div className="mb-2 rounded-md border border-ink-700/10 p-1.5" data-positions-panel>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold">{tr("Pozice a překryvy")}</span>
        {ov ? (
          <span data-overlap-count={ov.total} data-crossings={ov.crossings} className={ov.total ? "rounded bg-red-100 px-1.5 text-[10.5px] font-semibold text-red-700" : "rounded bg-steel-100 px-1.5 text-[10.5px] text-ink-700/70"} title={ov.total ? overlapAdvice(ov) : tr("Zkontrolováno: balónky, odkazové čáry, texty, kóty, geometrie pohledů, tabulky, rám")}>
            {ov.total ? tr("Překryvy: {0}", ov.total) : tr("Překryvy: 0")} · {tr("křížení {0}", ov.crossings)}
          </span>
        ) : (
          <span data-overlap-count="" className="text-[10.5px] text-ink-700/50">{tr("Překryvy: nezkontrolováno")}</span>
        )}
      </div>
      {ov && ov.total > 0 && (
        <p className="mb-1 text-[10.5px] leading-snug text-red-700" data-overlap-detail>
          {overlapSummary(ov)} – {overlapAdvice(ov)}
        </p>
      )}
      {ov && ov.total > 0 && (
        <label className="mb-1 flex items-center gap-1 text-[11px]">
          <input type="checkbox" data-overlap-markers-toggle checked={showMarkers} onChange={(e) => onShowMarkers(e.target.checked)} />
          {tr("Ukázat překryvy na listu")}
        </label>
      )}
      {hasBom && (
        <label className="mb-1 flex items-center justify-between gap-2 text-[11px]">
          <span>{tr("Kusovník")}</span>
          <select className={selectCls} data-bom-place value={opts.bomPlace ?? "auto"} onChange={(e) => set("bomPlace", e.target.value as DrawingOptions["bomPlace"])} aria-label={tr("Umístění kusovníku")}>
            <option value="auto">{tr("automaticky")}</option>
            <option value="above">{tr("nad razítkem")}</option>
            <option value="columns">{tr("ve sloupcích vlevo od razítka")}</option>
            {/* samostatný list kusovníku zakládá příkaz výkres kusovník list (přidá list) – v nabídce jen jeho stav */}
            {opts.bomPlace === "sheet" && <option value="sheet">{tr("na samostatném listu")}</option>}
          </select>
        </label>
      )}
      {res?.bomLayout && (
        <p className="mb-1 text-[10.5px] text-ink-700/60" data-bom-layout={res.bomLayout.mode} data-bom-hidden={res.bomLayout.hidden}>
          {tr("Kusovník: {0} řádků", res.bomLayout.rows)} · {res.bomLayout.mode === "columns" ? tr("{0} sloupců", res.bomLayout.cols) : res.bomLayout.mode === "sheet" ? tr("samostatný list") : tr("nad razítkem")}
          {res.bomLayout.hidden ? <span className="font-semibold text-red-700"> · {tr("{0} řádků se nevešlo", res.bomLayout.hidden)}</span> : null}
        </p>
      )}
      {bs.length > 0 && (
        <>
          <p className="mb-1 text-[10.5px] text-ink-700/60" data-balloon-info data-balloon-lost={info?.lost ?? 0}>
            {tr("Pozic {0} · zamčené {1} · nevešlo se {2}", bs.length, bs.filter((b) => b.mode === "locked").length, info?.lost ?? 0)}
          </p>
          <div className="max-h-56 overflow-auto">
            <table className="w-full text-[11px]">
              <tbody>
                {bs.map((b) => {
                  const id = b.id ?? `pos:${b.pos}`;
                  return (
                    <tr key={id} data-balloon-row={b.pos} data-balloon-view={b.view} data-balloon-mode={b.mode} className={b.lost ? "bg-red-50" : undefined}>
                      <td className="pr-1 font-semibold">{b.pos}</td>
                      <td className="pr-1">
                        <select className={selectCls} data-balloon-view-select={b.pos} value={opts.balloonViews?.[String(b.pos)] ?? "auto"} onChange={(e) => assign(b.pos, e.target.value)} aria-label={tr("Pohled pozice {0}", b.pos)}>
                          <option value="auto">{tr("auto ({0})", viewName(b.view ?? "front"))}</option>
                          {views.map((v) => (
                            <option key={v} value={v}>
                              {viewName(v)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <label className="flex items-center gap-1" title={tr("Zamčená pozice zůstane na místě i po přepočtu modelu")}>
                          <input type="checkbox" data-balloon-lock={b.pos} checked={b.mode === "locked"} onChange={(e) => lock(id, e.target.checked, [b.x, b.y])} />
                          {tr("zamknout")}
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/** značky překryvů přes list (červené obdélníky) – `data-overlap-marker` pro e2e */
export function OverlapMarkers({ out, tf }: { out: DrawingResult | null; tf: { x: number; y: number; z: number } }) {
  const ov = useSheetOverlaps(out);
  if (!out || !ov?.total) return null;
  return (
    <svg data-overlap-markers className="pointer-events-none absolute left-0 top-0 overflow-visible" width={out.sheet.w * tf.z} height={out.sheet.h * tf.z} style={{ transform: `translate(${tf.x}px,${tf.y}px)` }} viewBox={`0 0 ${out.sheet.w} ${out.sheet.h}`}>
      {ov.hits.map((h, i) => (
        <rect key={i} data-overlap-marker={h.kind} x={h.at[0] - 0.8} y={h.at[1] - 0.8} width={h.at[2] - h.at[0] + 1.6} height={h.at[3] - h.at[1] + 1.6} fill="rgba(224,57,48,.12)" stroke="#E03930" strokeWidth={Math.max(0.25, 1 / tf.z)}>
          <title>{h.what}</title>
        </rect>
      ))}
    </svg>
  );
}
