/**
 * Otisky výběru hran / ploch / vrcholů prvku nad tělesem PŘED ním (`cad/pick-sigs.ts` v jádře) – textové příkazy razítkují
 * vybrané entity ještě před přidáním prvku, aby výběr přežil přečíslování. Jediná implementace pro aplikaci i CLI (jádro
 * z hostitele); `components/cad/use-pick-sigs.ts` razítkuje jen upravovaný prvek ve formuláři.
 */
import { hasPicks } from "../pick-fields";
import type { CadDoc, Feature } from "../types";
import type { KernelApi } from "./kernel";

/** Prvek s otisky výběru spočtenými nad dokumentem `before`. Při chybě jádra vrátí prvek beze změny. */
export async function stampFeature(kernel: Pick<KernelApi, "pickSigs">, before: CadDoc, f: Feature): Promise<Feature> {
  if (!hasPicks(f)) return f;
  try {
    const res = await kernel.pickSigs(before, f);
    return res?.changed ? res.feature : f;
  } catch {
    return f;
  }
}
