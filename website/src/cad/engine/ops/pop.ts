/** `smazat poslední`: odebere poslední prvek historie. */
import { tr } from "../../i18n";
import { runOf } from "../run-doc";
import { say, type OpHandler } from "./util";

export const popOp: OpHandler<"pop"> = async (_op, ctx) => {
  const r = runOf(ctx);
  const f = r.doc.features.pop();
  r.changed = r.changed || !!f;
  say(ctx, f ? tr("✓ odstraněn prvek „{0}“", f.name) : tr("✗ není co odstranit"));
};
