/** `měřit …`: údaje o F/E/V, vzdálenost a úhel dvou entit, těleso, díry, válce – výsledek do protokolu (jádro hostitele). */
import { measureLines } from "../../agent-measure";
import { runMeasure } from "../../agent-measure-run";
import { measureKv } from "../kv";
import { noteResult, resultId } from "../result-key";
import { docKeyOf, runOf } from "../run-doc";
import { coded, sayKv, type OpHandler } from "./util";

export const measureOp: OpHandler<"measure"> = async (op, ctx) => {
  const d = runOf(ctx).doc;
  const rep = await runMeasure(ctx.host.kernel, d, op.cmd);
  // měření platí pro tuto revizi dokumentu – po pozdější změně ho `stav` a řádek D označí jako neplatné (engine/result-key.ts)
  noteResult(ctx.ws, resultId("measure", docKeyOf(ctx), d, { line: ctx.line ?? null }));
  // stručný protokol: čísla s tečkou a klíče stejné v cs/en/de; konzole: lokalizovaný řádek měření jako dřív
  sayKv(ctx, measureKv(rep, "comp" in op.cmd ? op.cmd.comp : undefined), ...measureLines(rep));
  const cut = (rep as { truncated?: { shown: number; total: number } }).truncated;
  if (cut) coded(ctx, "measure.truncated", { args: [cut.shown, cut.total] });
};
