/**
 * Pád jádra (WebAssembly): nedostatek paměti, abort OpenCascade, přístup mimo paměť. Po takové chybě je instance WASM
 * nepoužitelná (každé další volání selže nebo vrátí nesmysl) – jádro se musí ukončit a spustit znovu.
 */
import { tr } from "./i18n";

const FATAL = /Aborted\(|out of memory|\bOOM\b|memory access out of bounds|unreachable|Cannot enlarge memory|Array buffer allocation failed|RangeError: (?:Invalid typed array length|WebAssembly\.Memory)|could not allocate memory/i;

/** Je chyba pádem WASM (ne běžnou chybou operace)? */
export function isFatalKernelError(e: unknown): boolean {
  if (typeof WebAssembly !== "undefined" && e instanceof WebAssembly.RuntimeError) return true;
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e ?? "");
  return FATAL.test(msg);
}

/** Je chyba nedostatkem paměti? */
export const isOutOfMemory = (msg: string) => /out of memory|\bOOM\b|Cannot enlarge memory|allocation failed|could not allocate/i.test(msg);

/** Srozumitelná zpráva pro uživatele po pádu jádra (jádro se spouští znovu). */
export function fatalKernelText(raw: string): string {
  return isOutOfMemory(raw)
    ? tr("Jádru CAD došla paměť – model je pro prohlížeč příliš velký. Jádro bylo spuštěno znovu. Velkou sestavu STEP otevřete jako sestavu (díly se čtou zvlášť), zavřete ostatní záložky nebo skryjte část komponent.")
    : tr("Jádro CAD spadlo ({0}) a bylo spuštěno znovu. Zkuste operaci zopakovat; pokud se pád opakuje, model je pravděpodobně poškozený nebo příliš velký.", raw.slice(0, 120));
}
