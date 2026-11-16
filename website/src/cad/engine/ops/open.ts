/** `otevřít "soubor"` (EN open, DE öffnen): dokument ze vstupních souborů hostitele v nové záložce (engine/open-file.ts). */
import { tr } from "../../i18n";
import { readDocument } from "../open-file";
import { flush, runOf, startDoc } from "../run-doc";
import { say, type OpHandler } from "./util";

export const openOp: OpHandler<"open"> = async (op, ctx) => {
  const res = await readDocument(ctx.host, op.name);
  await flush(ctx);
  runOf(ctx).currentBody = null;
  startDoc(ctx, res.doc);
  say(ctx, tr("✓ otevřeno „{0}“ – dokument „{1}“ v nové záložce", res.file, res.doc.name));
  if (res.note) say(ctx, `  ${res.note}`);
};
