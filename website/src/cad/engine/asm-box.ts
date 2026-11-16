/**
 * Přesná světová obálka sestavy – JEDNA implementace pro aplikaci i CLI: operace jádra `asmEnvelope` (asm-kernel.ts, vlna 15
 * B10): viditelné listy, díly natočené po násobcích 90° rohy přesné lokální obálky, obecně natočené změřené v umístění (rohy
 * lokální obálky by obálku zvětšily – zkouška 959: o 3 mm), pružiny v aktuální délce, velké importy ze sítě (`approx`).
 *
 * Používá ji stav sestavy (`asmStatus` → `stav`, závěrečný stav běhu, `window.mncad.status()`, řádek D v CLI cli/job.ts)
 * i `kontrola sestava` (check.ts). Brána B6 fáze B měřila obálku zde vlastním měřením listů; při integraci s vlnou 15
 * (w14-int2) se sloučila s operací jádra, aby obálka sestavy měla jeden výpočet.
 */
import type { CadDoc, Vec3 } from "../types";
import type { KernelApi } from "./kernel";

/** jednotková matice listu (po sloupcích) – měření dílu komponenty v jeho lokálních souřadnicích */
export const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * Přesná obálka sestavy z jádra; `approx` = počet velkých importů měřených ze sítě. Null = díl / 2D výkres, jádro bez operace
 * (starší hostitel) nebo chyba – volající ponechá obálku z lokálních obálek dílů.
 */
export async function asmWorldBox(k: Partial<Pick<KernelApi, "asmEnvelope">>, doc: CadDoc): Promise<{ bbox: [Vec3, Vec3]; approx: number } | null> {
  if (doc.kind !== "assembly" || !k.asmEnvelope) return null;
  const env = await k.asmEnvelope(doc).catch(() => null);
  return env?.bbox && env.bbox.every((v) => v.every(Number.isFinite)) ? { bbox: env.bbox, approx: env.approx } : null;
}
