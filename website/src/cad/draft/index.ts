/**
 * 2D CAD – vstupní bod: registruje druhy entit a příkazy jádra a vstupní body balíků fáze B.
 * Každý balík má VLASTNÍ adresář a jeden řádek importu níže (už připravený) – do tohoto souboru balíky nezasahují.
 */
import "./kinds-core";
import "./cmd-draw";
import "./cmd-core";
import "./edit";
import "./annot";
import "./layout";
import "./io";

export * from "./model";
export { newDraftModel, emptyDraftDoc, isDraftDoc, docHasContent, docTabKind, normalizeDraftDoc } from "./doc";
