/**
 * `nový díl [název] [znovu|nový]` / `nová sestava [název] [znovu|nový]`: nový dokument v nové záložce (bez názvu číslovaný
 * výchozí název); opakovaný běh téhož skriptu použije záložku stejného názvu z dřívějšího běhu (engine/runs.ts).
 */
import { emptyAssembly } from "../../assembly";
import { tr } from "../../i18n";
import { emptyDoc } from "../../types";
import { flush, runOf } from "../run-doc";
import { startRunDoc } from "../runs";
import { say, type OpHandler } from "./util";

export const newOp: OpHandler<"new"> = async (op, ctx) => {
  await flush(ctx);
  runOf(ctx).currentBody = null;
  // bez zadaného názvu („nový díl“) dostane dokument číslovaný výchozí název, aby se záložky nejmenovaly stejně
  const dflt = op.assembly ? tr("Nová sestava") : tr("Nový díl");
  const name = op.name === dflt ? ctx.ws.freshName(dflt) : op.name;
  const what = op.assembly ? tr("nová sestava") : tr("nový díl");
  const doc = op.assembly ? emptyAssembly(name) : emptyDoc(name);
  // pojmenovaný dokument: záložka stejného názvu z dřívějšího běhu se použije znovu (ℹ doc.reused – nikdy tiše)
  const st = await startRunDoc(ctx, doc, { origin: "new", ...(op.reuse ? { mode: op.reuse } : {}), fresh: op.name === dflt });
  say(ctx, st.reused ? tr("✓ {0} „{1}“ – znovu použitá záložka z dřívějšího běhu", what, name) : tr("✓ {0} „{1}“ – nová záložka", what, name));
  if (name !== op.name) ctx.report.code("name.renamed-auto", { line: ctx.line, doc: name, args: [name] }); // výchozí název očíslován (5.2 č. 15, ℹ jen do protokolu)
  st.report();
};
