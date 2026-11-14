/** `normálie <označení>`: v dílu nová záložka s normálií, v sestavě komponenta. */
import { partComponent } from "../../assembly";
import { tr } from "../../i18n";
import { makeFromText } from "../../library";
import { flush, runOf, startDoc } from "../run-doc";
import { say, type OpHandler } from "./util";

export const libraryOp: OpHandler<"library"> = async (op, ctx) => {
  const r = runOf(ctx);
  const made = makeFromText(op.query);
  if (!made) throw new Error(tr("normálii „{0}“ knihovna nezná – zkuste např. M8x30, ložisko 6204, pero 8x7x40", op.query));
  if (r.doc.kind === "assembly") {
    r.doc = { ...r.doc, components: [...(r.doc.components ?? []), partComponent(made.doc, { position: op.at ?? [0, 0, 0] }, { group: "Normálie", number: made.doc.props?.number, color: made.doc.color ?? "#b9c2cc" })] };
    r.changed = true;
    say(ctx, tr("✓ normálie „{0}“ vložena do sestavy jako komponenta", made.result.designation));
  } else {
    await flush(ctx);
    r.currentBody = null;
    startDoc(ctx, made.doc);
    say(ctx, tr("✓ normálie „{0}“ – nová záložka", made.result.designation));
  }
};
