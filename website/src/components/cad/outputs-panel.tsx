"use client";
/**
 * Panel „Zastaralé výstupy“ (vlna 22, bod 20 – cad/doc-outputs.ts, text `výstupy` / `přepočítat vše`): odznak v rohu 3D okna,
 * když dokumentu něco neplatí (vydaný list ze starší revize modelu, export ze starší revize, uložená analýza – kolize, stav
 * vazeb, pohyb, měření –, kopie dílu v sestavě starší než díl). Rozbalený panel ukáže položky s příkazem, který je opraví,
 * vydání listů, záznamy exportů a tlačítko „Přepočítat vše“ = text `přepočítat vše` přes engine (stejný běh jako konzole a CLI).
 * Bez zastaralých položek je odznak neutrální („Výstupy · model r·…“) – nikdy zelený.
 */
import { useMemo, useState } from "react";
import { exportLine, fmtDate, fmtTime, modelId, sheetIssueLine, staleOutputs } from "@/cad/doc-outputs";
import { tr } from "@/cad/i18n";
import type { CadDoc } from "@/cad/types";
import { cn } from "@/lib/cn";

type Props = {
  doc: CadDoc;
  /** druhy uložených analýz, které pro nynější stav neplatí (engine/result-key.ts `staleResults`) */
  analyses: readonly string[];
  /** kopie dílů v sestavě starší než díl (asm-refresh.ts `staleCopies`) */
  copies: readonly { name: string; why: string; fix?: string }[];
  /** `přepočítat vše` přes engine; vrací text protokolu */
  onRecompute: () => Promise<string>;
  /** posun nad spodní lištu */
  bottom?: number;
};

export function OutputsPanel({ doc, analyses, copies, onRecompute, bottom = 40 }: Props) {
  const items = useMemo(() => staleOutputs(doc, { analyses, copies }), [doc, analyses, copies]);
  const mid = useMemo(() => modelId(doc), [doc]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const exps = doc.outputs ?? [];
  const sheets = (doc.drawings ?? []).filter((s) => s.issued);
  if (doc.kind === "draft" || (!items.length && !exps.length && !sheets.length && !open)) return null;
  const recompute = async () => {
    setBusy(true);
    try {
      const out = await onRecompute();
      // jen výpis `přepočítat vše` (od jeho nadpisu), bez stavu dokumentu na konci
      const i = out.indexOf(tr("Přepočítat vše – dokument „{0}“, revize modelu {1}:", "", "").split("„")[0]);
      setLast((i >= 0 ? out.slice(i) : out).split("\n\n")[0]);
    } catch (e) {
      setLast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="absolute right-3 z-20 flex flex-col items-end gap-1" style={{ bottom }}>
      {open && (
        <div data-outputs-panel className="max-h-[60vh] w-[380px] max-w-[92vw] overflow-y-auto rounded-md border border-black/10 bg-white/97 p-2.5 text-[12px] text-[#26303b] shadow-xl">
          <div className="mb-1.5 flex items-center gap-2">
            <strong>{tr("Výstupy dokumentu")}</strong>
            <span data-model-rev={mid.rev} className="font-mono text-[11px] text-ink-700/60">
              {tr("model {0}", mid.rev)}
            </span>
            <button type="button" onClick={() => setOpen(false)} aria-label={tr("Zavřít")} className="ml-auto rounded px-1 text-ink-700/50 hover:text-brand">
              ×
            </button>
          </div>
          <div className="mb-1 font-semibold">{items.length ? tr("Zastaralé ({0})", items.length) : tr("Zastaralé: žádné")}</div>
          {items.map((x, i) => (
            <div key={`${x.kind}-${i}`} data-outputs-item={x.kind} data-auto={x.auto ? "1" : undefined} className="mb-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-1">
              <div>
                ⚠ <strong>{x.label}</strong> – {x.why}
              </div>
              <div className="font-mono text-[11px] text-ink-700/70">
                → {x.fix}
                {x.auto ? ` · ${tr("přepočítá „Přepočítat vše“")}` : ` · ${tr("ručně")}`}
              </div>
            </div>
          ))}
          {sheets.length > 0 && (
            <>
              <div className="mb-1 mt-2 font-semibold">{tr("Vydané listy ({0})", sheets.length)}</div>
              {sheets.map((s) => (
                <div key={s.id} data-outputs-sheet={s.issued!.rev} className="mb-0.5 text-[11.5px]">
                  {s.name}: {sheetIssueLine(doc, s, mid)}
                </div>
              ))}
            </>
          )}
          {exps.length > 0 && (
            <>
              <div className="mb-1 mt-2 font-semibold">{tr("Exporty ({0})", exps.length)}</div>
              {[...exps].reverse().map((r) => (
                <div key={r.id} data-outputs-export={r.sig === mid.sig ? "current" : "stale"} className={cn("mb-0.5 text-[11.5px]", r.sig !== mid.sig && "text-amber-900")} title={`${fmtDate(r.at)} ${fmtTime(r.at)}`}>
                  {exportLine(doc, r, mid)} <span className="text-ink-700/50">{fmtTime(r.at)}</span>
                </div>
              ))}
            </>
          )}
          <button type="button" data-recompute-all disabled={busy} onClick={() => void recompute()} className="mt-2 w-full rounded border border-brand bg-brand px-2 py-1 font-semibold text-white hover:bg-brand/90 disabled:opacity-50">
            {busy ? tr("Přepočítávám…") : tr("Přepočítat vše")}
          </button>
          {last && (
            <pre data-recompute-result className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-ink-700/5 p-1.5 font-mono text-[10.5px] leading-snug">
              {last}
            </pre>
          )}
        </div>
      )}
      <button
        type="button"
        data-outputs-chip={items.length}
        onClick={() => setOpen((o) => !o)}
        className={cn("rounded-full border px-2.5 py-0.5 text-[11.5px] shadow", items.length ? "border-amber-400 bg-amber-50 font-semibold text-amber-900" : "border-black/10 bg-white/90 text-ink-700/70")}
      >
        {items.length ? `⚠ ${tr("Zastaralé výstupy: {0}", items.length)}` : tr("Výstupy · model {0}", mid.rev)}
      </button>
    </div>
  );
}
