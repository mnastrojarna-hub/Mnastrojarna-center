/**
 * Kontrola objemového exportu z menu aplikace (Data ▸ Export – vlna 22, bod 22c): stejná pravidla a tytéž věty jako textový
 * `export step|brep|stl|3mf` (agent-out.ts `exportCheck`, solid-export.ts `solidVerdict`):
 *  - STEP / BREP: soubor se znovu načte jádrem (`exportStats`, bez sítě a úložiště importů) – ✗ soubor bez objemového tělesa,
 *    ⚠ volné plochy vedle tělesa / soubor se liší, ✓ věrná kopie jen s tělesem;
 *  - STL / 3MF: složení modelu (síť se zpětně nečte) – ✗ model bez tělesa, ⚠ plochy mimo tělesa;
 *  - ostatní formáty (OBJ, glTF, VRML – pro zobrazení) se nekontrolují (null).
 */
import { checkFailed, exportCheck } from "@/cad/agent-out";
import { tr } from "@/cad/i18n";
import type { KernelShapeStats } from "@/cad/export-verify";
import { isVolumeFormat, solidVerdict, type SolidParts, type SolidStats } from "@/cad/solid-export";
import type { CadDoc } from "@/cad/types";

export type GuiExportCheck = { level: "ok" | "warn" | "error"; text: string; format: string };

type StatsKernel = { exportStats: (doc: CadDoc, bytes: Uint8Array, format: "step" | "brep") => Promise<{ model: KernelShapeStats; file: KernelShapeStats }> };

export async function guiExportCheck(cad: StatsKernel, doc: CadDoc, format: string, bytes: Uint8Array, model: (SolidStats & { parts?: SolidParts }) | null): Promise<GuiExportCheck | null> {
  if (!isVolumeFormat(format)) return null;
  const label = format.toUpperCase();
  if (format === "step" || format === "brep") {
    try {
      const { model: m, file } = await cad.exportStats(doc, bytes, format);
      const c = exportCheck(m, file, label, model?.parts);
      return { level: c.level ?? (c.ok ? "ok" : "warn"), text: c.line, format };
    } catch (e) {
      const c = checkFailed(label, (e as Error).message || tr("chyba jádra"));
      return { level: "error", text: c.line, format };
    }
  }
  if (!model) return null;
  const v = solidVerdict(model, label, "model", model.parts);
  return v ? { level: v.level, text: `${v.level === "error" ? "✗" : "⚠"} ${v.text}`, format } : null;
}
