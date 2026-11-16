/** `skica plocha F3|horní …`, `skica rovina "…"`: skica na ploše / pomocné rovině – otisk a rovina z jádra jako při výběru myší. */
import { selectFaces } from "../../agent";
import { sketchOnPlane } from "../../agent-sketch";
import { prepare, runOf } from "../run-doc";
import { say, type OpHandler } from "./util";

export const sketchOnOp: OpHandler<"sketchOn"> = async (op, ctx) => {
  const r = runOf(ctx);
  const k = ctx.host.kernel;
  const res = await sketchOnPlane(prepare(ctx, op.feature), op, r.doc, { build: k.build, face: k.face, refInfo: k.refInfo, topology: k.topology, selectFaces });
  r.doc.features.push(res.feature);
  r.added.push(res.feature);
  r.changed = true;
  say(ctx, res.log);
};
