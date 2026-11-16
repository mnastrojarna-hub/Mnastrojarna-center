/**
 * Prostředí sestavy pro textové příkazy (`AsmEnv` z asm-agent.ts) nad pracovním prostorem a jádrem hostitele
 * (CAD-HEADLESS-NAVRH.md kap. 2.5) – totéž v aplikaci (mezipaměti `ws.asm` = mezipaměti aplikace) i v Node.
 *
 * * Díly komponent se staví v jádře jednou na klíč (`ws.asm.cache`); geometrie ploch a seznamy ploch v `ws.asm.geo` /
 *   `ws.asm.faceLists`.
 * * Generace jádra: mezipaměti platí pro jednu instanci jádra. Před každou operací sestavy se `ws.asm.generation`
 *   porovná s `kernel.generation()`; po restartu jádra se mezipaměti vyprázdní (ℹ `asm.kernel-restarted`).
 * * `mateFace` / `mateEnt` vrátí null u dílu, který mezipaměť zná, ale jádro ho už nemá (LRU 400 dílů, restart): díl
 *   se v jádře znovu postaví a dotaz zopakuje jednou; když se díl postavit nepodaří, zapíše se ✗ `asm.face-missing`.
 * * Záložky (`záložky`, `záložka`, `zavřít záložku`) přes `ws.tabs` / `ws.activate` / `ws.close`.
 */
import type { AsmEnv } from "../asm-agent";
import type { CadDoc, ComponentSource } from "../types";
import type { KernelApi } from "./kernel";
import { syncKernelGeneration, type Workspace } from "./workspace";

/** díl, jehož plochu jádro nemá a ani po novém postavení dílu nevrátilo */
export type FaceMissing = { key: string; index: number; name: string };

export type AsmEnvOptions = {
  /** zásobník úprav v kontextu sestavy (kopie `ws.asm.stack`; `applyAsmCmd` ho mění, engine ho pak zapíše zpět) */
  stack?: { asm: CadDoc; key: string }[];
  /** jádro se od posledních mezipamětí restartovalo – mezipaměti vyprázdněny (engine zapíše ℹ `asm.kernel-restarted`) */
  onRestart?: () => void;
  /** díl se nepodařilo v jádře znovu postavit pro dotaz na plochu (engine zapíše ✗ `asm.face-missing`) */
  onFaceMissing?: (m: FaceMissing) => void;
  /** nové výsledky stavby dílů v `ws.asm.cache` (aplikace překreslí 3D okno) */
  onParts?: () => void;
  /** díl má víc ploch, než se pro vazby načte (engine zapíše ⚠ `asm.faces-truncated`) */
  onFacesTruncated?: (name: string, limit: number) => void;
};

/** Porovná generaci mezipamětí s jádrem; true = jádro se restartovalo a mezipaměti s daty se vyprázdnily. */
export function checkKernelGeneration(ws: Workspace, kernel: Pick<KernelApi, "generation">): boolean {
  const a = ws.asm;
  const had = a.cache.size > 0 || a.geo.size > 0 || a.faceLists.size > 0;
  // generace 0 = mezipaměti ještě nikdy nepatřily žádnému jádru (nový pracovní prostor) – jen převzít
  const changed = syncKernelGeneration(a, kernel.generation());
  return changed && had;
}

const sourceName = (s: ComponentSource | undefined, key: string) => (s?.kind === "part" || s?.kind === "asm" ? s.doc.name : s?.kind === "file" ? s.fileName : key);

/** `AsmEnv` nad `ws` a jádrem hostitele (viz hlavička modulu). */
export function makeAsmEnv(ws: Workspace, kernel: KernelApi, o: AsmEnvOptions = {}): AsmEnv {
  if (checkKernelGeneration(ws, kernel)) o.onRestart?.();
  const asm = ws.asm;
  /** zdroje dílů podle klíče (pro nové postavení dílu, který jádro vyřadilo) */
  const sources = new Map<string, ComponentSource>();
  const rebuild = async (key: string): Promise<boolean> => {
    const src = sources.get(key);
    if (!src) return false;
    try {
      const [r] = await kernel.asmParts([{ key, source: src }]);
      if (!r?.result) return false;
      asm.cache.set(key, r.result);
      return true;
    } catch {
      return false;
    }
  };
  /** dotaz na entitu dílu s jedním opakováním po novém postavení dílu (kap. 2.5) */
  const retrying = async <T>(key: string, index: number, q: () => Promise<T | null>): Promise<T | null> => {
    const r = await q();
    if (r !== null || !asm.cache.has(key)) return r;
    if (!(await rebuild(key))) {
      o.onFaceMissing?.({ key, index, name: sourceName(sources.get(key), key) });
      return null;
    }
    return q();
  };
  return {
    parts: async (list) => {
      for (const p of list) sources.set(p.key, p.source);
      const need = list.filter((p) => !asm.cache.has(p.key));
      if (need.length) {
        for (const r of await kernel.asmParts(need)) asm.cache.set(r.key, r.result);
        o.onParts?.();
      }
      return list.map((p) => ({ key: p.key, result: asm.cache.get(p.key) ?? null }));
    },
    mateFace: (key, i) => retrying(key, i, () => kernel.mateFace(key, i)),
    mateEnt: (key, i, e) => retrying(key, i, () => kernel.mateEnt(key, i, e)),
    interference: (d) => kernel.interference(d),
    clashDetail: (d, pairs) => kernel.clashDetail(d, pairs),
    cylFace: (key, r) => kernel.cylFace(key, r),
    isCone: (key, i) => kernel.inspect({ kind: "comp", key, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }, { kind: "face", index: i }).then((e) => e.surface === "CONE", () => false),
    geo: asm.geo,
    faceLists: asm.faceLists,
    stack: o.stack,
    ...(o.onFacesTruncated ? { onFacesTruncated: (key: string, limit: number) => o.onFacesTruncated!(sourceName(sources.get(key), key), limit) } : {}),
    tabs: {
      list: () => ws.tabs(),
      activate: (id) => ws.activate(id),
      close: (id) => ws.close(id),
    },
  };
}
