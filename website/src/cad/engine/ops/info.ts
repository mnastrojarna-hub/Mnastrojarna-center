/** Nápověda polí prvku (`prvek nápověda …`, agent-help.ts) – jen text do protokolu. */
import { say, type OpHandler } from "./util";

export const infoOp: OpHandler<"info"> = async (op, ctx) => say(ctx, ...op.lines);
