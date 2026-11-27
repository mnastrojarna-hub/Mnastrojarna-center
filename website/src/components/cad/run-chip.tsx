"use client";
/**
 * Stav běhů a výstupů v aplikaci (vlna 22, body 12 a 22h):
 *  * `RunWaitChip` – „Čekám na dokončení výpočtu…“ se Zrušit: uložit / export / sdílet čekají na frontu běhů a stavbu
 *    modelu (run-host.ts `outputGate`); `data-run-wait`, `data-run-wait-cancel`;
 *  * `ExportList` – malý seznam „Exporty“ (úlohy exportu této relace: stav, fáze, čas, soubor, velikost, kontrola,
 *    revize modelu) – zůstane i po konci exportu; `data-export-job`, `data-export-state`, `data-export-phase`, `data-export-rev`,
 *    `data-export-check`, `data-export-cancel`. Trvalý záznam exportů v dokumentu je věc balíku D.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { cadLocale, tr } from "@/cad/i18n";
import { exportPhaseText } from "@/cad/engine/export-phases";
import { isFinal, runStateText, type RunEntry } from "@/cad/engine/run-queue";
import { appRuns, outputGate } from "./run-host";

const secs = (ms: number) => (ms / 1000).toLocaleString(cadLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const kb = (b: number) => (b >= 1024 * 1024 ? `${(b / 1048576).toLocaleString(cadLocale(), { maximumFractionDigits: 1 })} MB` : b >= 1024 ? `${Math.round(b / 1024)} kB` : `${b} B`);

/** odběr trackeru běhů pro React (verze = počítadlo změn) */
export function useRuns(): number {
  return useSyncExternalStore(
    (f) => appRuns.subscribe(f),
    () => appRuns.version,
    () => 0,
  );
}

/** tikání hodin, dokud něco běží (čas běhu) */
function useTick(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

/** „Čekám na dokončení výpočtu…“ – uložit / export / sdílet čekají na dokončený stav */
export function RunWaitChip() {
  const st = useSyncExternalStore(
    (f) => outputGate.subscribe(f),
    () => outputGate.state,
    () => null,
  );
  useRuns();
  const now = useTick(!!st);
  if (!st) return null;
  const act = appRuns.active();
  const waiting = appRuns.pending().length;
  return (
    <div
      role="status"
      aria-live="polite"
      data-run-wait={st.what}
      className="pointer-events-auto fixed bottom-24 left-1/2 z-[71] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-3 rounded-md border border-[#cdd5de] bg-white px-3 py-2 text-[12.5px] text-[#1f2933] shadow-lg"
    >
      <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-sky-500" />
      <span className="min-w-0 truncate">
        {tr("Čekám na dokončení výpočtu…")} <span className="text-[#6b7785]">({st.what}{act ? ` · ${tr("běh {0}", act.id)} ${runStateText(act.state)}` : ""}{waiting > 1 ? ` · ${tr("ve frontě {0}", waiting)}` : ""})</span>
      </span>
      <span className="shrink-0 font-mono tabular-nums text-[#6b7785]">{secs(now - st.since)} s</span>
      <button type="button" data-run-wait-cancel onClick={() => outputGate.cancel()} className="shrink-0 rounded border border-[#cdd5de] px-2 py-0.5 font-medium hover:border-brand hover:text-brand" title={tr("Akce se neprovede; výpočet poběží dál")}>
        {tr("Zrušit")}
      </button>
    </div>
  );
}

const phaseLabel = (e: RunEntry, p: string) => exportPhaseText(p, e.result?.format ?? "");

/** jeden řádek úlohy exportu */
function ExportRow({ e, now }: { e: RunEntry; now: number }) {
  const ms = e.ms ?? (e.startedAt !== undefined ? now - e.startedAt : 0);
  const r = e.result ?? {};
  const tone = e.state === "done" ? (r.check && !r.check.ok ? "text-amber-700" : r.check?.note ? "text-slate-700" : "text-emerald-700") : e.state === "error" ? "text-brand-600" : e.state === "cancelled" ? "text-[#6b7785]" : "text-sky-700";
  return (
    <li data-export-job={e.id} data-export-state={e.state} data-export-phase={e.phase ?? ""} data-export-rev={r.modelRev ?? ""} data-export-check={r.check ? (r.check.ok ? (r.check.note ? "unchecked" : "ok") : "fail") : "none"} data-export-file={r.file ?? ""} className="border-b border-[#edf1f5] py-1 last:border-0">
      <div className="flex items-center gap-2">
        <span className={`font-semibold ${tone}`}>{runStateText(e.state)}</span>
        <span className="min-w-0 flex-1 truncate" title={e.label}>
          {r.file ?? e.label}
        </span>
        <span className="font-mono tabular-nums text-[#6b7785]">{secs(ms)} s</span>
        {!isFinal(e.state) && (
          <button type="button" data-export-cancel onClick={() => appRuns.cancel(e.id)} className="rounded border border-[#cdd5de] px-1.5 text-[11px] hover:border-brand hover:text-brand">
            {tr("Zrušit")}
          </button>
        )}
      </div>
      <div className="text-[11px] text-[#6b7785]">
        {e.state === "running" && e.phase ? `${tr("fáze")}: ${phaseLabel(e, e.phase)}${e.progress ? ` ${e.progress.index + 1}/${e.progress.total}` : ""}` : null}
        {e.state === "queued" ? tr("čeká na dokončení dřívějšího běhu") : null}
        {isFinal(e.state) && e.phases.length ? e.phases.map((p) => `${phaseLabel(e, p.phase)} ${secs(p.ms ?? 0)} s${p.state !== "done" ? ` (${p.state === "cancelled" ? tr("zrušeno") : tr("chyba")})` : ""}`).join(" · ") : null}
      </div>
      {(r.bytes !== undefined || r.modelRev || r.check || r.note || e.error) && (
        <div className="text-[11px] text-[#4a5664]">
          {r.bytes !== undefined && r.written !== false ? kb(r.bytes) : null}
          {r.modelRev ? ` · ${tr("model")} ${r.modelRev}` : null}
          {r.check ? ` · ${r.check.ok ? (r.check.note ? "ℹ" : "✓") : "⚠"} ${r.check.text}` : null}
          {r.note ? ` · ${r.note}` : null}
          {e.error ? ` · ${e.error}` : null}
        </div>
      )}
    </li>
  );
}

/** seznam „Exporty“ této relace (zůstává po konci exportu; zavírací křížek ho jen schová) */
export function ExportList() {
  useRuns();
  const list = appRuns.list("export");
  const [hidden, setHidden] = useState<number>(0);
  const live = list.some((e) => !isFinal(e.state));
  const now = useTick(live);
  const shown = list.filter((e) => e.seq > hidden);
  if (!shown.length) return null;
  return (
    <div data-export-list className="pointer-events-auto fixed bottom-12 right-3 z-[69] w-[min(380px,calc(100vw-24px))] rounded-md border border-[#cdd5de] bg-white px-3 py-2 text-[12px] text-[#1f2933] shadow-lg">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-semibold">{tr("Exporty")}</span>
        <button type="button" data-export-list-close onClick={() => setHidden(Math.max(...list.map((e) => (isFinal(e.state) ? e.seq : 0))))} className="text-[#8a95a3] hover:text-brand" aria-label={tr("Skrýt dokončené exporty")}>
          ×
        </button>
      </div>
      <ul className="max-h-48 overflow-y-auto">
        {shown
          .slice(-6)
          .reverse()
          .map((e) => (
            <ExportRow key={e.id} e={e} now={now} />
          ))}
      </ul>
    </div>
  );
}
