/**
 * Entity, vazby a kóty skici (`entities`, `constraints`, `dims`): do skici bloku, jinak do skici otevřené ve skicáři
 * (nezaložil-li tento vstup vlastní skicu), jinak do poslední; po vazbách / kótách a na konci bloku se skica vyřeší.
 */
import { applySketchOp, type SketchOp } from "../../agent-sketch";
import { openSketchFor, runOf } from "../run-doc";
import { say, type OpCtx, type OpHandler } from "./util";

async function sketchOp(op: SketchOp, ctx: OpCtx): Promise<void> {
  const r = runOf(ctx);
  say(ctx, ...applySketchOp(r.doc.features, op, openSketchFor(ctx)));
  r.changed = true;
}

export const entitiesOp: OpHandler<"entities"> = sketchOp;
export const constraintsOp: OpHandler<"constraints"> = sketchOp;
export const dimsOp: OpHandler<"dims"> = sketchOp;
