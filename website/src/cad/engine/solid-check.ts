/**
 * Složení modelu pro objemový export (vlna 22, bod 22c) – bez zpětného čtení souboru: díl z výsledku stavby
 * (`metrics.solids` / `metrics.free`), sestava z postavených listových dílů (`ensureLeaves` → `ws.asm.cache`) se jmény
 * komponent bez tělesa / s plochami mimo tělesa. Slouží síťovým formátům (STL, 3MF), exportu „bez kontroly“ a jménům
 * komponent v hlášce kontroly STEP / BREP sestavy. Stejné v konzoli, CLI i `mncad serve`.
 */
import { flattenLeaves } from "../asm-flatten";
import { solidsOfLeaves, solidVerdict, type SolidParts, type SolidStats, type SolidVerdict } from "../solid-export";
import type { CadDoc } from "../types";
import type { AsmEnvOptions } from "./asm-env";
import { ensureLeaves } from "./asm-status";
import type { KernelApi } from "./kernel";
import type { Workspace } from "./workspace";

export type ModelSolids = SolidStats & { parts?: SolidParts };

/** složení modelu dokumentu; null = model nemá tvar (prázdný) nebo se nepodařilo zjistit */
export async function modelSolids(kernel: KernelApi, ws: Workspace | null, d: CadDoc, hooks: AsmEnvOptions = {}): Promise<ModelSolids | null> {
  try {
    if (d.kind === "assembly") {
      if (!ws) return null;
      const leaves = await ensureLeaves(ws, kernel, d, hooks);
      return solidsOfLeaves(leaves, (key) => ws.asm.cache.get(key)?.metrics);
    }
    if (d.kind === "draft" || !d.features?.length) return null;
    const m = (await kernel.build(d)).metrics;
    if (!m || m.solids === undefined) return null;
    return { solids: m.solids, free: m.free ?? 0 };
  } catch {
    return null;
  }
}

/** jen jména komponent sestavy (do hlášky kontroly STEP / BREP); díl → undefined */
export async function asmSolidParts(kernel: KernelApi, ws: Workspace | null, d: CadDoc, hooks: AsmEnvOptions = {}): Promise<SolidParts | undefined> {
  if (d.kind !== "assembly" || !ws || !flattenLeaves(d).length) return undefined;
  const m = await modelSolids(kernel, ws, d, hooks);
  return m?.parts && (m.parts.noSolid.length || m.parts.free.length) ? m.parts : undefined;
}

/** verdikt pro objemový formát bez zpětného čtení (síť, „bez kontroly“): ✗ bez tělesa, ⚠ plochy mimo tělesa, null = v pořádku / nezjištěno */
export async function modelSolidVerdict(kernel: KernelApi, ws: Workspace | null, d: CadDoc, label: string, hooks: AsmEnvOptions = {}): Promise<SolidVerdict | null> {
  const m = await modelSolids(kernel, ws, d, hooks);
  return m ? solidVerdict(m, label, "model", m.parts) : null;
}
