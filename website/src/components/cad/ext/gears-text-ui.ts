/**
 * Kola a ozubení – obsluha akce `gear.table` v UI (balík text, vlna 19): tabulky ozubení všech kol dílu v okně hlášení.
 * Textový příkaz `kolo tabulka` (a `akce gear.table`) provede engine sám bez UI (`ExtDef.report`, engine/ops/api.ts) –
 * tady jen tlačítko / paleta, kdyby akci nabídly.
 */
import { gearTableReport } from "@/cad/agent-gears-table";
import { tr } from "@/cad/i18n";
import { registerExtUi } from "./registry";

registerExtUi("gear.table", {
  action: (api) => {
    try {
      api.notice(tr("Tabulka ozubení"), gearTableReport(api.doc, "*").join("\n"));
    } catch (e) {
      api.flash((e as Error).message);
    }
  },
});
