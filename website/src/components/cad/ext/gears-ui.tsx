/**
 * Kola a ozubení (vlna 19) – UI vstup balíku core: ikona prvků `gear.*` a import souborů, které doplňují balíky ui a text.
 * Bez nich funguje automatický formulář z `params` (řádky tabulky, `cad/gears/registry.ts` → `rowsToParams`).
 */
import { registerIcon } from "./icons";
import "../gears/register";
import "./gears-text-ui";

registerIcon(
  "gear",
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5l1.6 2.6 3-.9.4 3.1 3 1-1.3 2.8 1.8 2.5-2.8 1.4.1 3.1-3.1-.2-1.4 2.8-2.5-1.8-2.5 1.8-1.4-2.8-3.1.2.1-3.1-2.8-1.4 1.8-2.5L3.7 9.3l3-1 .4-3.1 3 .9z" />
  </>,
);
