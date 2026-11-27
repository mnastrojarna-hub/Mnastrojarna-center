/**
 * Revize modelu v exportu pohybové studie (vlna 22 kolo 7, bod 12 – „export a uložení musí pracovat s jasně určeným
 * dokončeným stavem“). CSV studie dostane poslední sloupec „Revize modelu“ s revizí sestavy (`r·a1b2c3`, engine/result-key.ts
 * modelRev – stejná jako „Výsledek platí … · r·…“ panelu Pohyb a `pohyb stav`), ze které výsledek vznikl. Dřívější sloupce
 * zůstávají na svých místech (tabulka v Excelu i skripty, které čtou sloupce podle pořadí, beze změny).
 */
import { tr } from "./i18n";
import { modelRev } from "./engine/result-key";
import type { CadDoc } from "./types";

const BOM = "﻿";

/** CSV (středník, CRLF, BOM) + sloupec „Revize modelu“ v každém řádku */
export function csvWithRev(csv: string, rev: string): string {
  const bom = csv.startsWith(BOM);
  const body = (bom ? csv.slice(1) : csv).replace(/\r\n$/, "");
  if (!body) return csv;
  const [head, ...rows] = body.split("\r\n");
  return (bom ? BOM : "") + [`${head};${tr("Revize modelu")}`, ...rows.map((r) => `${r};${rev}`)].join("\r\n") + "\r\n";
}

/** CSV pohybové studie dokumentu `doc` s jeho revizí modelu */
export const motionCsvWithRev = (csv: string, doc: CadDoc): string => csvWithRev(csv, modelRev(doc));
