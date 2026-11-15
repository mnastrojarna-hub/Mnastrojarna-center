/** `zobraz iso|přední|…`: pohled 3D okna aplikace; bez okna (CLI) ℹ `ui.no-view`. */
import { tr } from "../../i18n";
import { coded, say, type OpHandler } from "./util";

export const viewOp: OpHandler<"view"> = async (op, ctx) => {
  const view = ctx.host.ui?.view;
  if (!view) return coded(ctx, "ui.no-view", { args: [tr("pohled {0}", op.view)] });
  view(op.view);
  say(ctx, tr("✓ pohled {0}", op.view));
};
