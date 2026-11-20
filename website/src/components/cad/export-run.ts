/**
 * Export 3D modelu v aplikaci jako úloha RunTrackeru (vlna 22, bod 22h): menu Soubor › Export i `window.mncad.exportFile`.
 *
 *  * úloha se řadí do téže fronty jako textové běhy (run-host.ts `appRuns`) – nikdy neexportuje rozpracovaný stav běhu;
 *  * fáze (engine/export-job.ts): přestavba modelu → převod → kontrola zpětným načtením (STEP / BREP – stejná kontrola jako
 *    textové `export step`) → zápis / stažení; čas, průběh po prvcích, výsledek a revize modelu zůstanou v seznamu Exporty;
 *  * zrušení (čekající i běžící úlohy, i po dialogu „Uložit jako“ File System Access API): soubor, který dialog už založil,
 *    se odstraní (`handle.remove()`); kde to prohlížeč neumí, záznam řekne „soubor nebyl zapsán (0 B)“.
 *
 * Bez Reactu – závislosti (jádro, zápis, dialog) dodá aplikace, testy dodají náhrady (export-run.test.ts).
 */
import { tr } from "@/cad/i18n";
import { exportModelRev, runExportJob, type ExportFormat3d, type ExportJobResult } from "@/cad/engine/export-job";
import type { KernelApi } from "@/cad/engine/kernel";
import { inputRevOf, isRunCancelled, type RunHandle, type RunSource, type RunTracker } from "@/cad/engine/run-queue";
import type { CadDoc } from "@/cad/types";

/** cíl zápisu z dialogu „Uložit jako“ (`handle` = File System Access API, null = stažení do složky Stažené) */
export type ExportTarget = { name: string; handle: unknown | null };

export type ExportRunDeps = {
  kernel: Pick<KernelApi, "check" | "exportFile" | "exportStats">;
  /** dokument a jeho klíč v okamžiku startu úlohy (po doběhnutí dřívějších běhů) */
  doc(): CadDoc;
  docKey(): string;
  /** zápis dat do cíle (FS Access / stažení) */
  write(target: ExportTarget, data: Uint8Array): Promise<void>;
  /** zrušení výpočtu v jádře (běžící převod / přestavba) */
  cancelKernel(): void;
  /** odběr průběhu jádra (prvek k z n) po dobu úlohy */
  onProgress?(fn: (p: { index: number; total: number; name?: string } | null) => void): () => void;
};

/** odstraní prázdný soubor, který založil dialog „Uložit jako“ (FS Access `handle.remove()`; Chrome 110+) */
export async function discardTarget(t: ExportTarget | null): Promise<boolean> {
  const h = t?.handle as { remove?: () => Promise<void> } | null | undefined;
  if (!h || typeof h.remove !== "function") return false;
  try {
    await h.remove();
    return true;
  } catch {
    return false;
  }
}

const notWritten = (t: ExportTarget | null, removed: boolean) => (!t ? tr("soubor nebyl zapsán") : t.handle ? (removed ? tr("prázdný soubor z dialogu odstraněn") : tr("soubor nebyl zapsán (0 B) – prázdný soubor z dialogu smažte ručně")) : tr("soubor nebyl zapsán ani stažen"));

/**
 * Úloha exportu ve frontě. `target` = cíl z dialogu (vybraný PŘED zařazením – uživatelské gesto), null = data jen volajícímu
 * (`window.mncad.exportFile`). Výsledek: data, kontrola, revize modelu, časy fází; zrušeno → `RunCancelled`.
 */
export function exportRun(tracker: RunTracker, o: { format: ExportFormat3d; label: string; source: RunSource; target: ExportTarget | null }, deps: ExportRunDeps): RunHandle<ExportJobResult<number>> {
  const h = tracker.enqueue({ kind: "export", source: o.source, label: o.label, onCancel: () => deps.cancelKernel() }, async (ctl) => {
    const d = deps.doc();
    const key = deps.docKey();
    ctl.set({ doc: d.name, docKey: key, inputRev: inputRevOf(key, d), result: { format: o.format, ...(o.target ? { file: o.target.name } : {}), modelRev: exportModelRev(d) } });
    const off = deps.onProgress?.((p) => p && ctl.progress(p.index, p.total, p.name));
    try {
      const r = await runExportJob(d, o.format, {
        kernel: deps.kernel,
        signal: ctl.signal,
        phase: (p) => ctl.phase(p),
        write: async (data) => {
          if (o.target) await deps.write(o.target, data);
          return data.length;
        },
      });
      ctl.set({ result: { ok: !r.check || r.check.ok, bytes: r.data.length, modelRev: r.modelRev, written: true, ...(r.check ? { check: { ok: r.check.ok, text: r.check.line.replace(/^[✓⚠✗]\s*/, "") } } : {}) } });
      return r;
    } catch (e) {
      const removed = await discardTarget(o.target);
      ctl.set({ result: { ok: false, written: false, removed, note: notWritten(o.target, removed) } });
      throw e;
    } finally {
      off?.();
    }
  });
  // zrušeno dřív, než úloha začala: cíl z dialogu už existuje (prázdný) – odstranit
  h.done.catch(async (e) => {
    if (!isRunCancelled(e) || h.entry.startedAt !== undefined) return;
    const removed = await discardTarget(o.target);
    tracker.update(h.id, { result: { ok: false, written: false, removed, note: notWritten(o.target, removed) } });
  });
  return h;
}
