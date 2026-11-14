/**
 * BALÍK 3 (layout) – bloky (BLOCK, INSERT, atributy, úprava bloku, rozložení vložení), rozvržení (papírový prostor,
 * formát listu, výřezy v měřítku, zamčení výřezu, zmrazení hladin ve výřezu) a tisk do PDF (styly tisku, tloušťky,
 * měřítko 1:1 na papír). Vstupní bod balíku. Smlouva: website/CAD-2D-NAVRH.md, kapitola „Balík 3 – layout“.
 * Soubory balíku: src/cad/draft/layout/*.
 */
import "./kinds";
import "./cmd-blocks";
import "./cmd-layout";
import "./cmd-plot";

export { activeViewport, annoScale, layoutState } from "./state";
