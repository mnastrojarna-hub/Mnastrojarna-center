/**
 * BALÍK 1 (edit) – upravovací příkazy 2D výkresu: POSUN, KOPIE, OTOČIT, MĚŘÍTKO, ZRCADLIT, EKVIDISTANTA, OŘÍZNOUT,
 * PRODLOUŽIT, ZAOBLIT, ZKOSIT, PŘERUŠIT, SPOJIT, ROZLOŽIT, PROTÁHNOUT, POLE (obdélníkové, polární, po dráze), PRODLOUŽENÍ,
 * ZAROVNAT, úpravy úchopy, úprava křivky (PEDIT) a splajnu. Vstupní bod balíku – jádro ho importuje v draft/index.ts.
 * Smlouva: website/CAD-2D-NAVRH.md, kapitola „Balík 1 – edit“. Soubory balíku: src/cad/draft/edit/*.
 *
 * Moduly: shared.ts (volby, výběr s PICKFIRST, kroky Zpět), param.ts (parametrický popis entit), nurbs.ts (dělení,
 * spojení, obrácení NURBS), cut.ts (ořez / prodloužení), offset.ts, fillet.ts (geometrie), xform.ts, trim.ts, modify.ts,
 * arrays.ts, join.ts, explode.ts (příkazy).
 */
import "./xform";
import "./trim";
import "./modify";
import "./arrays";
import "./join";
import "./explode";

export { EDIT_STATE, MOD, PRESET } from "./shared";
