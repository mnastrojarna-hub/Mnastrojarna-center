/** `nový díl [název]` / `nová sestava [název]`: nový dokument v nové záložce (bez názvu číslovaný výchozí název). */
import { emptyAssembly } from "../../assembly";
import { tr } from "../../i18n";
import { emptyDoc } from "../../types";
import { flush, runOf, startDoc } from "../run-doc";
import { say, type OpHandler } from "./util";

export const newOp: OpHandler<"new"> = async (op, ctx) => {
  await flush(ctx);
  runOf(ctx).currentBody = null;
  // bez zadaného názvu („nový díl“) dostane dokument číslovaný výchozí název, aby se záložky nejmenovaly stejně
  const dflt = op.assembly ? tr("Nová sestava") : tr("Nový díl");
  const name = op.name === dflt ? ctx.ws.freshName(dflt) : op.name;
  startDoc(ctx, op.assembly ? emptyAssembly(name) : emptyDoc(name));
  say(ctx, tr("✓ {0} „{1}“ – nová záložka", op.assembly ? tr("nová sestava") : tr("nový díl"), name));
  if (name !== op.name) ctx.report.code("name.renamed-auto", { line: ctx.line, doc: name, args: [name] }); // výchozí název očíslován (5.2 č. 15, ℹ jen do protokolu)
};
