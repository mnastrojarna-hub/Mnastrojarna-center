/**
 * Příkazy pro 3D okno a stav aplikace (agent-api.ts): řez, styl zobrazení, výběr, barva ploch, akce rozšíření, analýzy,
 * formařské nástroje. Provádí je aplikace (`host.ui.api` → agent-api-host.ts); bez aplikace (CLI) zobrazení a výběr
 * nemají účinek (ℹ `ui.no-view`), ostatní je ✗ `host.app-only` – nikdy tiše.
 */
import type { ApiCmd } from "../../agent-api";
import { getExt } from "../../ext/registry";
import { tr } from "../../i18n";
import { flush, runOf, startDoc } from "../run-doc";
import { coded, say, type OpHandler } from "./util";

/** popis příkazu pro hlášku bez aplikace */
function apiLabel(c: ApiCmd): string {
  switch (c.kind) {
    case "section":
    case "sectionOff":
      return tr("řez");
    case "display":
    case "fit":
      return tr("zobrazení");
    case "select":
    case "selectClear":
    case "selectShow":
      return tr("výběr");
    case "faceColor":
      return tr("barva plochy");
    case "action":
      return tr("akce {0}", c.id);
    case "analyze":
      return tr("analýza");
    case "parting":
      return tr("dělicí rovina");
    case "ejectors":
      return tr("vyhazovače");
    case "cooling":
      return tr("chlazení");
    case "shrinkage":
      return tr("smrštění");
    default:
      return (c as { kind: string }).kind;
  }
}
/** příkazy, které jen mění zobrazení / výběr ve 3D okně */
const VIEW_ONLY = new Set<ApiCmd["kind"]>(["section", "sectionOff", "display", "fit", "select", "selectClear", "selectShow"]);

export const apiOp: OpHandler<"api"> = async (op, ctx) => {
  const r = runOf(ctx);
  // akce s čistým textovým výstupem (tabulka ozubení): engine ji provede sám – stejně v aplikaci i v CLI
  const report = op.cmd.kind === "action" ? getExt(op.cmd.id)?.report : undefined;
  if (report && op.cmd.kind === "action") return say(ctx, ...report(r.doc, op.cmd.arg));
  const ui = ctx.host.ui?.api;
  if (!ui) return coded(ctx, VIEW_ONLY.has(op.cmd.kind) ? "ui.no-view" : "host.app-only", { args: [apiLabel(op.cmd)] });
  const res = await ui(op.cmd, r.doc);
  if (res.open) {
    await flush(ctx);
    r.currentBody = null;
    startDoc(ctx, res.open);
  } else if (res.doc) {
    r.doc = res.doc;
    r.changed = true;
  }
  r.added.push(...(res.added ?? []));
  say(ctx, ...res.log);
};
