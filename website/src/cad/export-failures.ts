/**
 * Neúspěšné a zrušené exporty v dokumentu (vlna 22 kolo 7, bod 22h – „trvalý stav, čas běhu, diagnostika“).
 *
 * Dřív zůstal neúspěšný export jen v seznamu Exporty relace (run-chip.tsx) – po uložení a novém otevření .mncad o něm nebyla
 * stopa. Záznam `CadDoc.exportFailures` nese formát, cílový soubor, stav (chyba / zrušeno), fázi úlohy, ve které skončila,
 * text chyby (s příčinou ze zapisovače STEP – formats/export.ts writeStepFile), revizi exportovaného modelu, čas a dobu běhu.
 * Není to výstup: soubor nevznikl, takže záznam nikdy neříká „odpovídá modelu“ a do zastaralých výstupů nepatří.
 * Stejně jako záznam exportu je to záznam skutečnosti – krok Zpět ho nesmaže (history-outputs.ts carryOutputs).
 */
import { tr } from "./i18n";
import { exportPhaseText } from "./engine/export-phases";
import { jobTime } from "./doc-outputs";
import type { CadDoc, ExportFailRecord } from "./types";

export const FAILS_MAX = 10;

let seq = 0;
const newId = () => `x${Date.now().toString(36)}${(seq++).toString(36)}`;

/** fáze úlohy exportu, ve které chyba vznikla (engine/export-job.ts ji připíše k výjimce) */
export const failedPhaseOf = (e: unknown): string | undefined => (e && typeof e === "object" ? ((e as { exportPhase?: string }).exportPhase ?? undefined) : undefined);

/** krátký text chyby do záznamu (bez víceřádkového výpisu jádra, nejvýš 400 znaků) */
export const failText = (e: unknown): string => {
  const t = (e instanceof Error ? e.message : String(e ?? "")).replace(/\s+/g, " ").trim();
  return t.length > 400 ? `${t.slice(0, 399)}…` : t || tr("neznámá chyba");
};

export type ExportFailInput = Omit<ExportFailRecord, "id" | "at"> & { at?: string; id?: string };

/** Zapíše neúspěšný export do dokumentu (nejnovější na konci, nejvýš FAILS_MAX). Vstup se nemění. */
export function recordExportFailure(doc: CadDoc, f: ExportFailInput): CadDoc {
  const rec: ExportFailRecord = { ...f, id: f.id ?? newId(), at: f.at ?? new Date().toISOString() };
  return { ...doc, exportFailures: [...(doc.exportFailures ?? []), rec].slice(-FAILS_MAX) };
}

/** krok Zpět: cíl dostane záznamy neúspěšných exportů, které vznikly po něm (jako záznamy exportů) */
export function carryFailures(target: CadDoc, from: CadDoc): CadDoc {
  if (target.exportFailures === from.exportFailures || !from.exportFailures?.length) return target;
  const had = new Set((target.exportFailures ?? []).map((r) => r.id));
  const add = from.exportFailures.filter((r) => !had.has(r.id));
  return add.length ? { ...target, exportFailures: [...(target.exportFailures ?? []), ...add].slice(-FAILS_MAX) } : target;
}

const when = (at: string) => at.replace("T", " ").slice(0, 16);
const secs = (ms?: number) => (ms === undefined ? "" : ` ${jobTime(ms)}`);

/** jeden řádek záznamu: „✗ STEP „Deska.step“ · z modelu r·… · 2026-11-27 10:30 ⏱ 0,4 s – chyba ve fázi „převod do STEP“: …“ */
export function failureLine(f: ExportFailRecord): string {
  const head = `${f.state === "cancelled" ? "–" : "✗"} ${f.format.toUpperCase()}${f.file ? ` „${f.file}“` : ""} · ${tr("z modelu {0}", f.modelRev)} · ${when(f.at)}${secs(f.ms)}`;
  const where = f.phase ? tr(" ve fázi „{0}“", exportPhaseText(f.phase, f.format)) : "";
  return f.state === "cancelled" ? `${head} – ${tr("zrušeno{0}, soubor nevznikl", where)}` : `${head} – ${tr("chyba{0}, soubor nevznikl: {1}", where, f.error)}`;
}

/** řádky výpisu `exporty` / panelu Výstupy (prázdné bez záznamů) */
export function failuresLines(doc: CadDoc): string[] {
  const list = doc.exportFailures ?? [];
  if (!list.length) return [];
  return [tr("Neúspěšné exporty ({0}) – soubor nevznikl:", list.length), ...[...list].reverse().map((f, i) => `  ${i + 1}. ${failureLine(f)}`)];
}
