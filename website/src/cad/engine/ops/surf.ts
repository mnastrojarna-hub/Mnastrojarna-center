/**
 * Plochy třídy A (agent-surfaces.ts): analýza návaznosti hran, hřebeny křivosti, řídicí body plochy – dotaz do jádra
 * hostitele, protokol; s „zobrazit“ překryv ve 3D okně aplikace (`host.ui.surfOverlay`), bez okna jen protokol.
 */
import { combLines, continuityLines, cvLines } from "../../agent-surfaces";
import { runOf } from "../run-doc";
import { say, type OpHandler } from "./util";

export const surfOp: OpHandler<"surf"> = async (op, ctx) => {
  const cmd = op.cmd;
  const doc = runOf(ctx).doc;
  const k = ctx.host.kernel;
  if (cmd.kind === "continuity") {
    const res = await k.surfA({ kind: "continuity", edges: cmd.edges }, doc);
    if (res.kind !== "continuity") return;
    if (cmd.show) ctx.host.ui?.surfOverlay?.(res);
    return say(ctx, ...continuityLines(res, cmd.show));
  }
  if (cmd.kind === "comb") {
    const res = await k.surfA({ kind: "comb", edges: cmd.edges, scale: cmd.scale }, doc);
    if (res.kind !== "comb") return;
    if (cmd.show) ctx.host.ui?.surfOverlay?.(res);
    return say(ctx, ...combLines(res, cmd.show));
  }
  const res = await k.surfA({ kind: "cv", face: cmd.face, grid: cmd.grid }, doc);
  if (res.kind !== "cv") return;
  say(ctx, ...cvLines(res));
};
