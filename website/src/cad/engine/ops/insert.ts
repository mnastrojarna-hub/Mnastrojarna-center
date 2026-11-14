/**
 * `vložit "díl" [jako "K48"]`: komponenta z dílu otevřeného v záložce nebo vytvořeného tímto během (kopie dílu); `jako` =
 * přezdívka instance pro vazby místo #k (vlna 15, B15 – agent-asm.ts `insertExtras`, kolize přezdívek = chyba).
 */
import { insertExtras, insertNote } from "../../agent-asm";
import { partComponent } from "../../assembly";
import { tr } from "../../i18n";
import type { CadDoc } from "../../types";
import { runOf } from "../run-doc";
import { say, type OpHandler } from "./util";

export const insertOp: OpHandler<"insert"> = async (op, ctx) => {
  const r = runOf(ctx);
  if (r.doc.kind !== "assembly") throw new Error(tr("vložit: otevřený dokument není sestava – nejdřív „nová sestava“"));
  const src = ctx.ws.findPart(op.tab);
  if (!src || src.kind === "assembly") throw new Error(tr("díl „{0}“ není mezi otevřenými záložkami – otevřené díly: {1}", op.tab, ctx.ws.partNames().join(", ") || "—"));
  r.doc = { ...r.doc, components: [...(r.doc.components ?? []), partComponent(JSON.parse(JSON.stringify(src)) as CadDoc, { position: op.at, rotation: op.rotation }, insertExtras(r.doc, op))] };
  r.changed = true;
  (r.inserted ??= new Map()).set(src.name.trim().toLowerCase(), op.line); // komponenta = kopie dílu (5.2 č. 19)
  say(ctx, tr("✓ komponenta „{0}“ vložena do sestavy{1}", src.name, insertNote(op)));
};
