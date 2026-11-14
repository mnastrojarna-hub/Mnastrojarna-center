/** `přísně [vyp] [kromě kód,…]` (EN strict, DE streng): přísný režim od tohoto řádku (engine/strict.ts, kap. 5.3). */
import { tr } from "../../i18n";
import { say, type OpHandler } from "./util";

export const strictOp: OpHandler<"strict"> = async (op, ctx) => {
  const s = ctx.strict;
  if (!s) return;
  s.apply({ on: op.on, ...(op.except ? { except: op.except } : {}) });
  ctx.report.strictMode = s;
  const ex = [...s.except];
  say(ctx, s.on ? tr("✓ přísný režim – první ⚠ nebo ✗ zastaví běh{0}", ex.length ? tr(" (kromě {0})", ex.join(", ")) : "") : tr("✓ přísný režim vypnut"));
};
