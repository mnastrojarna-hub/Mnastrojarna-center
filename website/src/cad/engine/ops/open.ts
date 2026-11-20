/** `otevřít "soubor"` (EN open, DE öffnen): dokument ze vstupních souborů hostitele v nové záložce (engine/open-file.ts). */
import { tr } from "../../i18n";
import { readDocument } from "../open-file";
import { flush, runOf } from "../run-doc";
import { startRunDoc } from "../runs";
import { freshenRunDoc } from "../spring-fresh";
import { say, type OpHandler } from "./util";

export const openOp: OpHandler<"open"> = async (op, ctx) => {
  const res = await readDocument(ctx.host, op.name);
  await flush(ctx);
  runOf(ctx).currentBody = null;
  // opakovaný běh: záložka téhož dokumentu otevřeného dřívějším během (ne `nový díl` téhož názvu – engine/runs.ts)
  const st = await startRunDoc(ctx, res.doc, { origin: "open" });
  say(ctx, st.reused ? tr("✓ otevřeno „{0}“ – dokument „{1}“ ve znovu použité záložce z dřívějšího běhu", res.file, res.doc.name) : tr("✓ otevřeno „{0}“ – dokument „{1}“ v nové záložce", res.file, res.doc.name));
  if (res.note) say(ctx, `  ${res.note}`);
  st.report();
  await freshenRunDoc(ctx, op.line); // pružiny: délka z dosedacích ploch, ⚠ spring.stale (vlna 22, bod 7)
};
