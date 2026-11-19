/**
 * Vstupní body „Kola a ozubení“ na pásu karet (vlna 19, balík ui): JEDNO velké tlačítko průvodce `gear.wizard` (galerie →
 * tabulka → Vytvořit) pro všech 14 druhů a malé tlačítko `gear.pair` (soukolí → dva díly a sestava s vazbou). Obě jsou
 * akce (bez prvku v historii); obsluhu v okně doplňuje components/cad/gears/register.tsx. Paleta Ctrl+K je převezme z pásu.
 * Samotné prvky `gear.*` jsou zaregistrované skrytě (cad/ext/gears.ts) – nabízí je průvodce, text a `prvek gear.*`.
 */
import { tr } from "../i18n";
import { registerExt } from "./registry";

registerExt({
  ext: "gear.wizard",
  label: tr("Kola a ozubení"),
  icon: "gear",
  tone: "create",
  tab: "create",
  group: "Kola a ozubení",
  big: true,
  order: 1,
  action: true,
  scope: "both",
  hint: tr("ozubené kolo z tabulky: čelní, šikmé, šípové, vnitřní, hřeben, kuželové, hypoidní, šnek, cykloidní, řetězové kolo, řemenice, rohatka"),
  make: () => ({}),
});
registerExt({
  ext: "gear.pair",
  label: tr("Soukolí"),
  icon: "gear-pair",
  tone: "create",
  tab: "create",
  group: "Kola a ozubení",
  order: 2,
  action: true,
  scope: "both",
  hint: tr("dvě kola v záběru: z₁, z₂, modul, osová vzdálenost → díly a sestava s vazbou ozubení"),
  make: () => ({}),
});
