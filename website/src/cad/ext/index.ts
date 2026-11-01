/**
 * Moduly rozšíření jádra – každý soubor registruje své prvky přes registerExt().
 * Import tohoto souboru (build.ts, UI) zajistí registraci. Přidáváš-li modul, přidej řádek sem.
 */
import "./surface";
import "./sheetmetal";
import "./advanced";
export * from "./registry";
