/**
 * Fáze exportu 3D modelu (vlna 22, bod 22h) – samostatný malý modul bez závislostí na jádře, aby je mohl jmenovat i hlavní
 * vlákno CLI (`--progress`) a UI. Postup úlohy je v engine/export-job.ts.
 *
 *   model   – přestavba modelu · convert – převod do formátu · verify – kontrola zpětným načtením · write – zápis souboru
 */
import { tr } from "../i18n";

export const EXPORT_PHASES = ["model", "convert", "verify", "write"] as const;
export type ExportPhase = (typeof EXPORT_PHASES)[number];

/** text fáze pro člověka (seznam Exporty, chip, CLI `--progress`) */
export function exportPhaseText(p: ExportPhase | string, format = ""): string {
  const f = format.toUpperCase();
  switch (p) {
    case "model":
      return tr("přestavba modelu");
    case "convert":
      return f ? tr("převod do {0}", f) : tr("převod");
    case "verify":
      return tr("kontrola zpětným načtením");
    case "write":
      return tr("zápis souboru");
    default:
      return String(p);
  }
}
