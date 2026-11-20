/** `stav`: textový stav dokumentu v tom okamžiku; na konci vstupu vypíše stav jen závěrečná stavba (jednou). */
import { docStatusText } from "../../agent";
import { asmStatus, staleNotes } from "../asm-status";
import { buildDoc, docKeyOf, runOf } from "../run-doc";
import { statusKv } from "../kv";
import { asmHooks, sayKv, type OpHandler } from "./util";
import { reportStaleCopies } from "../bom-notes";

export const statusOp: OpHandler<"status"> = async (op, ctx) => {
  const r = runOf(ctx);
  if (op === r.lastOp) return;
  const res = await buildDoc(ctx);
  // i sestava vytvořená v tomto běhu: díly se postaví před stavem (ensureLeaves), stav vazeb a kolize pod klíčem dokumentu
  // obálka sestavy přesně (engine/asm-box.ts) – stejně jako řádek D a `kontrola sestava`
  const asm = await asmStatus(ctx.ws, ctx.host.kernel, r.doc, { ...asmHooks(ctx), key: docKeyOf(ctx) });
  const stale = staleNotes(ctx.ws, r.doc, docKeyOf(ctx)); // měření / porovnání z dřívější revize dokumentu (engine/result-key.ts)
  sayKv(ctx, statusKv(r.doc, res, asm, stale), docStatusText(r.doc, res, asm, stale));
  reportStaleCopies(ctx, r.doc); // kopie dílu starší než díl v záložce – ⚠ s příkazem obnovy (bod 22g)
};
