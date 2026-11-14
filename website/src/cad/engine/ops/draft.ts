/** `2d …`: 2D výkres (cad/draft/agent.ts) – `2d nový` = nová záložka, ostatní příkazy nad otevřeným 2D výkresem. */
import { flush, runOf, startDoc } from "../run-doc";
import { say, type OpHandler } from "./util";

export const draftOp: OpHandler<"draft"> = async (op, ctx) => {
  const r = runOf(ctx);
  const res = await (await import("../../draft/agent")).applyDraftText(r.doc, op.text);
  if (res.newDoc) {
    await flush(ctx);
    r.currentBody = null;
    startDoc(ctx, res.newDoc);
  } else if (res.changed) {
    r.doc = res.doc;
    r.changed = true;
  }
  say(ctx, ...res.log);
};
