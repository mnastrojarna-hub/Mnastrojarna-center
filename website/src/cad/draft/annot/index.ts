/**
 * BALÍK 2 (annot) – poznámky 2D výkresu: MTEXT, textové styly, kóty (lineární, natočená, zarovnaná, úhlová, poloměr,
 * průměr, oblouková, souřadnicová, základnicová, řetězová) s kótovacími styly, odkazy (LEADER / MLEADER), šrafy
 * (HATCH se vzory ANSI/ISO, plná výplň, přechod, asociativní hranice), tolerance. Vstupní bod balíku.
 * Smlouva: website/CAD-2D-NAVRH.md, kapitola „Balík 2 – annot“. Soubory balíku: src/cad/draft/annot/*.
 */
import "./kinds-annot";
import "./cmd-text";
import "./cmd-dim";
import "./cmd-other";

export { annoMultiplier, annoScaledList, annoScaleOf, parseAnnoScale } from "./anno";
export { resolveDimStyle, dimStyles, currentDimStyle, fullDimStyle, materializeDimStyles } from "./dimstyle";
export { leaderText } from "./kinds-annot";
