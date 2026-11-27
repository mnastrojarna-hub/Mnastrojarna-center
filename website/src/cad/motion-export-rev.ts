/**
 * Revize modelu v exportu pohybové studie (vlna 22 kolo 7, bod 12 – „export a uložení musí pracovat s jasně určeným
 * dokončeným stavem“). CSV studie dostane poslední sloupec „Revize modelu“ s revizí sestavy (`r·a1b2c3`, engine/result-key.ts
 * modelRev – stejná jako „Výsledek platí … · r·…“ panelu Pohyb a `pohyb stav`), ze které výsledek vznikl. Dřívější sloupce
 * zůstávají na svých místech (tabulka v Excelu i skripty, které čtou sloupce podle pořadí, beze změny). Volá ji jediná funkce
 * CSV studie `studyCsv` (motion-dynamic-report.ts) – všechny cesty exportu tak nesou revizi stejně.
 */
import { tr } from "./i18n";

const BOM = "﻿";

/** CSV (středník, CRLF, BOM) + sloupec „Revize modelu“ v každém řádku */
export function csvWithRev(csv: string, rev: string): string {
  const bom = csv.startsWith(BOM);
  const body = (bom ? csv.slice(1) : csv).replace(/\r\n$/, "");
  if (!body) return csv;
  const [head, ...rows] = body.split("\r\n");
  return (bom ? BOM : "") + [`${head};${tr("Revize modelu")}`, ...rows.map((r) => `${r};${rev}`)].join("\r\n") + "\r\n";
}
