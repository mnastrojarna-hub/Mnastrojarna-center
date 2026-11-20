/**
 * Textové příkazy výstupů dokumentu (vlna 22, bod 20 – etapa D2; čistý rozbor, provedení engine/outputs-ops.ts):
 *  - `exporty [vymazat]` (EN `exports [clear]`, DE `exporte [löschen]`) – záznamy exportů dokumentu (formát, soubor, revize
 *    modelu, čas); zastaralé ⚠ s příkazem, který export zopakuje;
 *  - `výstupy [zastaralé]` (EN `outputs [stale]`, DE `ausgaben [veraltet]`), samostatně i `zastaralé` / `stale` / `veraltet`
 *    – vydání listů, exporty a uložené analýzy; „zastaralé“ = jen to, co pro nynější revizi modelu neplatí;
 *  - `přepočítat vše` (EN `recompute all`, DE `alles neu berechnen`) – přepočítá, co jde (kopie dílů v sestavě, kolize, stav
 *    vazeb, pohyb, listy), a vypíše, co musí udělat člověk (nová revize vydaného listu, nový export).
 * Rozbor volá agent-out.ts `parseOutLine` (výstupy textem) – OutCmd druhů `exports` / `outputs` / `recompute`.
 */
import { tr } from "./i18n";

export type OutputsCmd = { kind: "exports"; clear?: boolean } | { kind: "outputs"; stale?: boolean } | { kind: "recompute" };

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const W = (...w: string[]) => new Set(w.map(fold));
const EXPORTS = W("exporty", "exportů", "exports", "exporte", "exportliste");
const CLEAR = W("vymazat", "smazat", "vyprázdnit", "clear", "reset", "löschen", "leeren");
const OUTPUTS = W("výstupy", "výstup", "outputs", "ausgaben");
const STALE = W("zastaralé", "zastaralý", "zastaralá", "neplatné", "stale", "outdated", "veraltet", "veraltete");
const RECOMPUTE = W("přepočítat", "přepočti", "přepočítej", "recompute", "recalculate", "rebuild");
const ALL = W("vše", "všechno", "všechny", "all", "everything", "alle", "alles");

/** usage pro chybové hlášky */
export const outputsUsage = (): string => tr("exporty [vymazat] · výstupy [zastaralé] · přepočítat vše");

/** řádek příkazu výstupů dokumentu, jinak null (jiný příkaz) – `t` = slova řádku, `q` = slovo v uvozovkách */
export function parseOutputsLine(t: readonly string[], q: readonly boolean[] = []): OutputsCmd | null {
  if (!t.length || q[0]) return null;
  const w = t.map(fold);
  const rest = w.slice(1);
  if (EXPORTS.has(w[0])) {
    if (!rest.length) return { kind: "exports" };
    if (rest.length === 1 && CLEAR.has(rest[0])) return { kind: "exports", clear: true };
    throw new Error(tr("exporty: neznámé „{0}“ – {1}", t.slice(1).join(" "), outputsUsage()));
  }
  if (OUTPUTS.has(w[0])) {
    if (!rest.length) return { kind: "outputs" };
    if (rest.length === 1 && STALE.has(rest[0])) return { kind: "outputs", stale: true };
    throw new Error(tr("výstupy: neznámé „{0}“ – {1}", t.slice(1).join(" "), outputsUsage()));
  }
  if (STALE.has(w[0]) && (!rest.length || (rest.length === 1 && OUTPUTS.has(rest[0])))) return { kind: "outputs", stale: true };
  if (RECOMPUTE.has(w[0]) && rest.length === 1 && (ALL.has(rest[0]) || OUTPUTS.has(rest[0]))) return { kind: "recompute" };
  // DE „alles neu berechnen“
  if (w[0] === "alles" && w[1] === "neu" && (w[2] === "berechnen" || w[2] === "rechnen") && w.length === 3) return { kind: "recompute" };
  return null;
}
