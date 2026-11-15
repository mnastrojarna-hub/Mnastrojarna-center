/** `[ … ]` (pole prvků v JSON): prvky se přidají do dokumentu, výsledek po stavbě. */
import { tr } from "../../i18n";
import { prepare, runOf } from "../run-doc";
import { say, type OpHandler } from "./util";

export const featuresOp: OpHandler<"features"> = async (op, ctx) => {
  const r = runOf(ctx);
  for (const raw of op.features) {
    const f = prepare(ctx, raw);
    r.doc.features.push(f);
    r.added.push(f);
    say(ctx, tr("→ {0} ({1}) přidán – výsledek po výpočtu níže", f.name, f.type));
  }
  r.changed = true;
};
