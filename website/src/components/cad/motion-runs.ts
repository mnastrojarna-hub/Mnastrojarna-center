/**
 * Výpočet pohybové studie jako záznam sdíleného modelu výpočtů aplikace (vlna 22, bod 12 – kolo 6): týž `RunTracker`
 * (`computeRuns`, components/cad/compute-runs.ts) jako stavba modelu, přepočet vazeb, kolize a měření – žádný druhý model běhů.
 *
 * Záznam zakládá jediné místo, kde se studie opravdu počítá (cad/motion-cache.ts `runStored`, přes `setMotionRunHook`): panel
 * Pohyb (Vypočítat pohyb), `window.mncad.motion()` i textový příkaz v aplikaci. Id `v…`, revize vstupu `<klíč>@r·……`, stavy
 * queued → running → done | cancelled | error | superseded (`MotionSuperseded` = novější výpočet jiného vstupu → „nahrazeno“,
 * nikdy „dokončeno“). Výsledek z mezipaměti (stejný otisk studie) ani připojení k běžícímu výpočtu nový záznam nezakládá –
 * `motionRunOf(sig)` vrátí záznam výpočtu, který výsledek spočítal (panel „Výsledek platí … výpočet v…“, `mncad.motion().run`).
 */
import { motionSig, setMotionRunHook } from "@/cad/motion-cache";
import type { MotionResult } from "@/cad/motion";
import type { CadDoc } from "@/cad/types";
import { computeBegin, computeRuns } from "./compute-runs";

export type MotionRunInfo = { id: string; inputRev: string; state: string };

/** záznam výpočtu podle otisku studie (výsledek v mezipaměti → výpočet, který ho spočítal) */
const bySig = new Map<string, string>();

setMotionRunHook((d, key) => {
  const run = computeBegin("motion", key, d);
  bySig.set(motionSig(d), run.id);
  while (bySig.size > 60) bySig.delete(bySig.keys().next().value!);
  return { end: (state, error) => run.end(state, error) };
});

/** záznam výpočtu, ze kterého je výsledek pro otisk `sig` (null = neznámý – výsledek z dřívější relace / mimo aplikaci) */
export function motionRunOf(sig: string): MotionRunInfo | null {
  const id = bySig.get(sig);
  const e = id ? computeRuns.get(id) : undefined;
  return e ? { id: e.id, inputRev: e.inputRev ?? "", state: e.state } : null;
}

/** výpočet / výsledek studie `doc` (`fn` = motionRun) a záznam výpočtu, který výsledek spočítal */
export async function trackedMotion(doc: CadDoc, fn: () => Promise<MotionResult>): Promise<{ res: MotionResult; run: MotionRunInfo | null }> {
  const res = await fn();
  return { res, run: motionRunOf(motionSig(doc)) };
}
