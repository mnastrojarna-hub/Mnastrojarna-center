/**
 * Moduly rozšíření jádra – každý soubor registruje své prvky přes registerExt().
 * Import tohoto souboru (build.ts, UI) zajistí registraci. Přidáváš-li modul, přidej řádek sem.
 */
import "./surface";
import "./surface-a";
import "./sheetmetal";
import "./advanced";
import "./weld";
import "./sheetmetal-form";
export * from "./registry";
