"use client";
/**
 * Ukazatel běžícího výpočtu jádra: který prvek se právě počítá (k z n), uplynulý čas a tlačítko Zrušit.
 * Krátké výpočty (pod 0,8 s) se neukazují. Zrušení ukončí jádro – dokument se vrací do stavu před výpočtem (řeší aplikace).
 */
import { useEffect, useState } from "react";
import { cad, type CadProgress } from "@/cad/client";
import { cadLocale, tr } from "@/cad/i18n";

const SHOW_AFTER_MS = 800;

/** popis běžící operace pro ukazatel i automatizaci */
export function progressLabel(p: CadProgress): string {
  if (p.op === "compare" && p.phase === "feature" && p.type === undefined && p.id === undefined) return tr("Porovnání {0}/{1}: {2}", p.index + 1, p.total, p.name ?? "");
  if (p.op === "compare" && p.phase === "start") return tr("Porovnávám s referenčním modelem…");
  if (p.op === "stepSplit") return p.phase === "feature" ? tr("Čtu strukturu sestavy STEP – díl {0}/{1}", p.index + 1, p.total) : tr("Čtu strukturu sestavy STEP…");
  if (p.op === "asmParts" && p.phase === "feature") return tr("Načítám díl {0}/{1}: {2}", p.index + 1, p.total, p.name ?? "");
  if (p.phase === "feature") return tr("Počítám prvek {0}/{1}: {2}", p.index + 1, p.total, p.name ?? "");
  if (p.phase === "mesh") return tr("Počítám síť modelu…");
  if (p.op === "drawing") return tr("Počítám pohledy výkresu…");
  if (p.op === "export") return tr("Připravuji export…");
  if (p.op === "interference") return tr("Počítám kolize…");
  if (p.op === "asmParts") return tr("Počítám díly sestavy…");
  return tr("Počítám model…");
}

const secs = (ms: number) => (ms / 1000).toLocaleString(cadLocale(), { minimumFractionDigits: ms < 10_000 ? 1 : 0, maximumFractionDigits: ms < 10_000 ? 1 : 0 });

export function ComputeChip({ onCancel }: { onCancel: () => void }) {
  const [p, setP] = useState<CadProgress | null>(() => cad.progress());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => cad.onProgress(setP), []);
  useEffect(() => {
    if (!p) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [p]);
  if (!p) return null;
  const total = now - p.startedAt;
  if (total < SHOW_AFTER_MS) return null;
  const feat = Math.max(0, now - p.featureAt);
  return (
    <div
      role="status"
      aria-live="polite"
      data-compute={p.phase}
      className="pointer-events-auto fixed bottom-12 left-1/2 z-[70] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-3 rounded-md border border-[#cdd5de] bg-white px-3 py-2 text-[12.5px] text-[#1f2933] shadow-lg"
    >
      <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-500" />
      <span className="min-w-0 truncate" data-compute-label>
        {progressLabel(p)}
      </span>
      <span className="shrink-0 font-mono tabular-nums text-[#6b7785]" title={tr("čas tohoto kroku · celkový čas výpočtu")}>
        {p.phase === "feature" && total - feat > 500 ? `${secs(feat)} s · ` : ""}
        {tr("celkem {0} s", secs(total))}
      </span>
      <button type="button" data-compute-cancel onClick={onCancel} className="shrink-0 rounded border border-[#cdd5de] px-2 py-0.5 font-medium hover:border-brand hover:text-brand" title={tr("Ukončí výpočet a vrátí dokument do stavu před ním")}>
        {tr("Zrušit")}
      </button>
    </div>
  );
}
