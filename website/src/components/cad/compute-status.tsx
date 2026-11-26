"use client";
/**
 * Stavový řádek: poslední výpočet aplikace s id a revizí vstupu (vlna 22, bod 12 – compute-runs.ts): „v12 stavba modelu ·
 * počítá“, „v13 kontrola kolizí · nahrazeno“… Atributy pro e2e: `data-compute-run`, `data-compute-kind`, `data-compute-state`,
 * `data-compute-rev`; nápověda (title) vypíše posledních několik výpočtů se stavem, revizí a časem.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { cadLocale, tr } from "@/cad/i18n";
import { isFinal, runStateText } from "@/cad/engine/run-queue";
import { computeRuns, lastCompute } from "./compute-runs";

const secs = (ms: number) => (ms / 1000).toLocaleString(cadLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function ComputeStatus() {
  useSyncExternalStore(
    (f) => computeRuns.subscribe(f),
    () => computeRuns.version,
    () => 0,
  );
  const e = lastCompute();
  const running = !!e && !isFinal(e.state);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [running]);
  if (!e) return null;
  const rev = e.inputRev?.split("@")[1] ?? "";
  const recent = computeRuns
    .list("compute")
    .slice(-6)
    .reverse()
    .map((x) => `${x.id} ${x.label} · ${runStateText(x.state)} · ${x.doc ?? ""} ${x.inputRev?.split("@")[1] ?? ""} · ${secs(computeRuns.elapsed(x))} s`)
    .join("\n");
  return (
    <span
      data-compute-run={e.id}
      data-compute-kind={e.what}
      data-compute-state={e.state}
      data-compute-rev={rev}
      title={tr("Výpočty aplikace (id, stav, revize vstupu):") + "\n" + recent}
      className={"hidden items-center gap-1 font-mono text-[10.5px] lg:flex " + (e.state === "error" ? "text-brand" : running ? "text-amber-300" : "text-white/45")}
    >
      {e.id} {e.label} · {runStateText(e.state)}
      {rev ? ` · ${rev}` : ""}
      {running ? ` · ${secs(computeRuns.elapsed(e))} s` : ""}
    </span>
  );
}
