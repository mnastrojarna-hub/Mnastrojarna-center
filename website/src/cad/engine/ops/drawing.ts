/** `výkres`: otevře výkres dokumentu v záložce aplikace; bez 3D okna (CLI) ℹ `ui.no-view`. */
import { tr } from "../../i18n";
import { flush } from "../run-doc";
import { coded, say, type OpHandler } from "./util";

export const drawingOp: OpHandler<"drawing"> = async (_op, ctx) => {
  await flush(ctx);
  const open = ctx.host.ui?.openDrawing;
  if (!open) return coded(ctx, "ui.no-view", { args: [tr("výkres")] });
  open();
  say(ctx, tr("✓ výkres dokumentu se otevře v záložce"));
};
