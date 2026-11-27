/** `stav`: textový stav dokumentu v tom okamžiku; na konci vstupu vypíše stav jen závěrečná stavba (jednou). */
import { docStatusText } from "../../agent";
import { asmStatus, staleNotes } from "../asm-status";
import { buildDoc, docKeyOf, runOf } from "../run-doc";
import { statusKv } from "../kv";
import { asmHooks, sayKv, type OpHandler } from "./util";
import { withValidity } from "../validity-store";
import { reportMaterialConflicts, reportStaleCopies } from "../bom-notes";
import { reportStaleSheets } from "../outputs-ops";
import { reportLostSprings } from "../spring-fresh";
import { reportLostRefs } from "../lost-refs";

export const statusOp: OpHandler<"status"> = async (op, ctx) => {
  const r = runOf(ctx);
  if (op === r.lastOp) return;
  const res = await buildDoc(ctx);
  // i sestava vytvořená v tomto běhu: díly se postaví před stavem (ensureLeaves), stav vazeb a kolize pod klíčem dokumentu
  // obálka sestavy přesně (engine/asm-box.ts) – stejně jako řádek D a `kontrola sestava`
  const asm = await asmStatus(ctx.ws, ctx.host.kernel, r.doc, { ...asmHooks(ctx), key: docKeyOf(ctx) });
  const stale = staleNotes(ctx.ws, r.doc, docKeyOf(ctx)); // měření / porovnání z dřívější revize dokumentu (engine/result-key.ts)
  const shown = withValidity(ctx.ws, docKeyOf(ctx), r.doc, res); // přesná kontrola téže geometrie (kontrola přesně / export)
  sayKv(ctx, statusKv(r.doc, shown, asm, stale), docStatusText(r.doc, shown, asm, stale));
  reportStaleCopies(ctx, r.doc); // kopie dílu starší než díl v záložce – ⚠ s příkazem obnovy (bod 22g)
  reportMaterialConflicts(ctx, r.doc); // označení v razítku jiné třídy než hustota – ⚠ material.class-conflict (22g, kolo 7b)
  reportStaleSheets(ctx, r.doc); // vydaný list ze starší revize modelu – ⚠ drawing.stale (bod 20)
  reportLostSprings(ctx, r.doc, op.line); // ztracená dosedací plocha pružiny – ⚠ spring.lost, ne čistý stav (bod 7, kolo 6)
  reportLostRefs(ctx, r.doc); // vazba / pružina se ztracenou referencí – ⚠ mate.lost (bod 20, kolo 6)
};
