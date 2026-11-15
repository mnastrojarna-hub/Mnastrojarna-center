/**
 * Registrace všech obsluh operací enginu (jeden soubor na druh operace). Od balíku B2 platí: nový textový příkaz =
 * soubor v `engine/ops/` + řádka zde, ne větev v `cad-app.tsx`. Vlastník „engine/ops“ smí obsluhu nahradit (nové
 * vyhodnocení modulu ve vývojovém serveru); jiný vlastník téhož druhu operace je chyba (registry.ts).
 */
import { apiOp } from "./api";
import { asmOp } from "./asm";
import { bodyOp } from "./body";
import { checkOp } from "../check";
import { compareOp } from "../compare-text";
import { clashOp } from "./clash";
import { docOp } from "./doc";
import { draftOp } from "./draft";
import { drawingOp } from "./drawing";
import { drawingCmdOp } from "./drawing-cmd";
import { editOp } from "./edit";
import { featureOp } from "./feature";
import { featuresOp } from "./features";
import { infoOp } from "./info";
import { insertOp } from "./insert";
import { libraryOp } from "./library";
import { measureOp } from "./measure";
import { metaOp } from "./meta";
import { newOp } from "./new";
import { openOp } from "./open";
import { outOp } from "./out";
import { popOp } from "./pop";
import { referenceOp } from "./reference";
import { registerOp, type OpHandler, type OpKind } from "./registry";
import { selectOp } from "./select";
import { constraintsOp, dimsOp, entitiesOp } from "./sketch";
import { sketchOnOp } from "./sketch-on";
import { statusOp } from "./status";
import { strictOp } from "./strict";
import { surfOp } from "./surf";
import { viewOp } from "./view";

const OWNER = "engine/ops";

/** všechny druhy operací textového skriptu a jejich obsluhy (úplnost hlídá překladač: chybějící druh = chyba typu) */
export const ENGINE_OPS: { [K in OpKind]: OpHandler<K> } = {
  doc: docOp,
  features: featuresOp,
  api: apiOp,
  out: outOp,
  open: openOp,
  new: newOp,
  meta: metaOp,
  feature: featureOp,
  entities: entitiesOp,
  constraints: constraintsOp,
  dims: dimsOp,
  sketchOn: sketchOnOp,
  select: selectOp,
  body: bodyOp,
  library: libraryOp,
  insert: insertOp,
  drawing: drawingOp,
  drawingCmd: drawingCmdOp,
  pop: popOp,
  view: viewOp,
  status: statusOp,
  measure: measureOp,
  clash: clashOp,
  check: checkOp,
  compare: compareOp,
  edit: editOp,
  asm: asmOp,
  surf: surfOp,
  draft: draftOp,
  info: infoOp,
  strict: strictOp,
  reference: referenceOp,
};

/** zaregistruje obsluhy všech druhů operací (opakované volání je bez účinku) */
export function registerEngineOps(): void {
  for (const k of Object.keys(ENGINE_OPS) as OpKind[]) registerOp(k, ENGINE_OPS[k] as OpHandler<OpKind>, OWNER);
}

registerEngineOps();
