/** `měřit …`: údaje o F/E/V, vzdálenost a úhel dvou entit, těleso, díry, válce – výsledek do protokolu (jádro hostitele). */
import { measureLines } from "../../agent-measure";
import { runMeasure } from "../../agent-measure-run";
import { measureKv } from "../kv";
import { runOf } from "../run-doc";
import { coded, sayKv, type OpHandler } from "./util";

export const measureOp: OpHandler<"measure"> = async (op, ctx) => {
  const rep = await runMeasure(ctx.host.kernel, runOf(ctx).doc, op.cmd);
  // stručný protokol: čísla s tečkou a klíče stejné v cs/en/de; konzole: lokalizovaný řádek měření jako dřív
  sayKv(ctx, measureKv(rep, "comp" in op.cmd ? op.cmd.comp : undefined), ...measureLines(rep));
  const cut = (rep as { truncated?: { shown: number; total: number } }).truncated;
  if (cut) coded(ctx, "measure.truncated", { args: [cut.shown, cut.total] });
};
