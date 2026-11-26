"use client";
/**
 * Vydání listu ve výkresovém prostředí (vlna 22, bod 20 – cad/doc-outputs.ts; text `výkres vydat`):
 *  * odznak na záložce listu – „rev. A“ (vydaný z nynějšího modelu) / „⚠ rev. A“ (vydaný ze starší revize modelu);
 *  * pruh nad listem u zastaralého vydaného listu: z jaké revize modelu byl vydán, jaká je teď, „Přepočítat“ (přepočítat vše)
 *    a „Vydat novou revizi B“;
 *  * oddíl u tabulky revizí: stav vydání a tlačítko „Vydat list jako rev. X“ / „Zrušit vydání“.
 * Žádný zelený stav: vydaný list z nynějšího modelu je neutrální „odpovídá modelu r·…“.
 */
import { defaultIssueRev, fmtDate, nextRev, nowRev, sheetIssueLine, sheetState, type ModelId } from "@/cad/doc-outputs";
import { tr } from "@/cad/i18n";
import type { CadDoc, DrawingDoc } from "@/cad/types";
import { cn } from "@/lib/cn";

/** odznak vydání na záložce listu */
export function IssueBadge({ doc, sheet, mid }: { doc: CadDoc; sheet: Pick<DrawingDoc, "issued"> | undefined; mid: ModelId | null }) {
  if (!sheet?.issued || !mid) return null;
  const stale = sheetState(doc, sheet, mid) === "stale";
  const is = sheet.issued;
  const title = stale ? tr("Vydáno jako rev. {0} z modelu {1} ({2}) – model je teď {3}: list je zastaralý", is.rev, is.modelRev, fmtDate(is.at), nowRev(is, mid)) : tr("Vydáno jako rev. {0} z modelu {1} ({2}) – odpovídá modelu", is.rev, is.modelRev, fmtDate(is.at));
  return (
    <span data-sheet-issued={is.rev} data-sheet-stale={stale ? "1" : undefined} title={title} className={cn("rounded px-1 text-[10px] font-semibold leading-4", stale ? "bg-amber-100 text-amber-800 ring-1 ring-amber-300" : "bg-ink-700/10 text-ink-700/70")}>
      {stale ? "⚠ " : ""}
      {tr("rev. {0}", is.rev)}
    </span>
  );
}

/** pruh nad listem: vydaný list ze starší revize modelu */
export function StaleSheetBanner({ doc, sheet, mid, onIssue, onRecompute }: { doc: CadDoc; sheet: DrawingDoc | undefined; mid: ModelId | null; onIssue?: (rev: string) => void; onRecompute?: () => void }) {
  if (!sheet?.issued || !mid || sheetState(doc, sheet, mid) !== "stale") return null;
  const is = sheet.issued;
  const next = nextRev(is.rev);
  return (
    <div role="alert" data-drawing-stale-banner={is.rev} className="flex shrink-0 flex-wrap items-center gap-2 border-b border-amber-300 bg-amber-50 px-3 py-1.5 text-[12px] text-amber-900">
      <span className="font-semibold">⚠ {tr("Model se změnil po vydání rev. {0}", is.rev)}</span>
      <span>{tr("List byl vydán z modelu {0} ({1}), model je teď {2}. List ukazuje nynější model – soubor s písmenem {3} by měl jiný obsah než vydaný papír.", is.modelRev, fmtDate(is.at), nowRev(is, mid), is.rev)}</span>
      <span className="ml-auto flex gap-1.5">
        {onRecompute && (
          <button type="button" data-stale-recompute onClick={onRecompute} className="rounded border border-amber-400 bg-white px-2 py-0.5 hover:border-brand hover:text-brand">
            {tr("Přepočítat")}
          </button>
        )}
        {onIssue && (
          <button type="button" data-issue-new={next} onClick={() => onIssue(next)} className="rounded border border-brand bg-brand px-2 py-0.5 font-semibold text-white hover:bg-brand/90">
            {tr("Vydat novou revizi {0}", next)}
          </button>
        )}
      </span>
    </div>
  );
}

/** oddíl „Vydání listu“ u tabulky revizí: stav a tlačítka */
export function IssueSection({ doc, sheet, mid, onIssue, onWithdraw }: { doc: CadDoc; sheet: DrawingDoc; mid: ModelId | null; onIssue?: (rev: string) => void; onWithdraw?: () => void }) {
  if (!mid) return null;
  const st = sheetState(doc, sheet, mid);
  const rev = defaultIssueRev(doc, sheet, mid);
  return (
    <div data-issue-section={st} className={cn("mt-2 rounded border p-1.5 text-[11.5px] leading-snug", st === "stale" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-ink-700/10 text-ink-700/70")}>
      <div data-issue-state>{sheetIssueLine(doc, sheet, mid)}</div>
      <div className="mt-1 flex gap-1">
        {onIssue && st !== "current" && (
          <button type="button" data-issue-btn={rev} onClick={() => onIssue(rev)} className="flex-1 rounded border border-ink-700/20 py-0.5 hover:border-brand hover:text-brand">
            {tr("Vydat list jako rev. {0}", rev)}
          </button>
        )}
        {onWithdraw && sheet.issued && (
          <button type="button" data-issue-withdraw onClick={onWithdraw} className="rounded border border-ink-700/15 px-2 py-0.5 text-ink-700/60 hover:border-brand hover:text-brand">
            {tr("Zrušit vydání")}
          </button>
        )}
      </div>
    </div>
  );
}
