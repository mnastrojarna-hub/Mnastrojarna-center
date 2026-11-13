/**
 * Více těles v dílu – názvy těles a statická simulace historie (bez geometrie).
 *
 * Model: díl má vždy jedno **aktivní těleso** (na něm pracují všechny prvky) a libovolný počet odložených těles.
 * - Prvek s polem `body` přepne aktivní těleso na uvedené; u operace „Nové těleso“ (`mode: "new"`) s dosud neexistujícím
 *   názvem založí nové těleso (dosavadní aktivní se odloží). Prvek bez `body` pracuje s naposledy aktivním tělesem.
 * - `splitBodies` rozřízne aktivní těleso rovinou: kladná strana zůstane aktivním tělesem, záporná je nové těleso `nameB`.
 * - `copyBody` zkopíruje těleso `source` (prázdné = aktivní) jako nové těleso `newName` s posunutím.
 * - `combine` sloučí / odečte / pronikne `tool` do `target`; `target` se stane aktivním, `tool` zanikne (není-li `keepTool`).
 *
 * Stejná pravidla uplatňuje jádro (`build.ts`); tady jsou bez geometrie – pro nabídky ve formulářích a textové příkazy.
 */
import type { CadDoc, Feature } from "./types";
import { weldBodyNames } from "./ext/weld-bodies";

/** název prvního tělesa dílu */
export const DEFAULT_BODY = "Těleso 1";

/** Prvek zakládá nové těleso (operace „Nové těleso“)? */
export const isNewBodyMode = (f: Feature): boolean => ("mode" in f && f.mode === "new") || (f.type === "ext" && (f.data as { mode?: unknown } | undefined)?.mode === "new");

/** Další volný název „Těleso N“. */
export function nextBodyName(used: Iterable<string>): string {
  const s = new Set(used);
  for (let n = 1; ; n++) if (!s.has(`Těleso ${n}`)) return `Těleso ${n}`;
}

export type BodyState = { names: string[]; active: string; /** už v historii vzniklo nějaké těleso? */ started: boolean };

/** Názvy těles a aktivní těleso po provedení prvků 0…index−1 (jen z historie, bez geometrie). */
export function bodiesAt(doc: Pick<CadDoc, "features">, index = doc.features.length): BodyState {
  let names = [DEFAULT_BODY];
  let active = DEFAULT_BODY;
  let started = false; // už vzniklo nějaké těleso?
  for (let i = 0; i < Math.min(index, doc.features.length); i++) {
    const f = doc.features[i];
    if (f.suppressed) continue;
    const makesGeometry = f.type !== "sketch" && f.type !== "datum" && f.type !== "datumAxis" && f.type !== "datumPoint" && f.type !== "csys";
    if (f.body && f.body !== active) {
      if (names.includes(f.body)) active = f.body;
      else if (!started) {
        names = names.map((n) => (n === active ? f.body! : n));
        active = f.body;
      } else if (isNewBodyMode(f)) {
        names.push(f.body);
        active = f.body;
      }
    }
    if (makesGeometry) started = true;
    if (f.type === "splitBodies") names.push(f.nameB?.trim() || nextBodyName(names));
    else if (f.type === "copyBody") names.push(f.newName?.trim() || nextBodyName(names));
    else if (f.type === "ext") names.push(...weldBodyNames(doc.features, i, names)); // svarový kov (a podložka) = vlastní tělesa
    else if (f.type === "combine") {
      const target = f.target?.trim() || active;
      const tool = f.tool?.trim();
      if (tool && tool !== target && names.includes(tool) && names.includes(target)) {
        if (!f.keepTool) names = names.filter((n) => n !== tool);
        active = target;
      }
    }
  }
  return { names, active, started };
}
