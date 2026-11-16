/** `těleso N`: další prvky pracují se zvoleným tělesem dílu (více těles). */
import { bodiesAt } from "../../bodies";
import { tr } from "../../i18n";
import { runOf } from "../run-doc";
import { say, type OpHandler } from "./util";

export const bodyOp: OpHandler<"body"> = async (op, ctx) => {
  const r = runOf(ctx);
  const bs = bodiesAt(r.doc);
  if (!bs.names.includes(op.name)) throw new Error(tr("těleso „{0}“ v dílu není – tělesa: {1}", op.name, bs.names.join(", ")));
  r.currentBody = op.name;
  say(ctx, tr("✓ další prvky pracují s tělesem „{0}“", op.name));
};
