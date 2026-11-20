/**
 * Hlášky kusovníku v enginu (vlna 22, bod 22g): sestava, jejíž komponenta je kopie dílu starší než díl v záložce, to
 * řekne VŠUDE, kde se kusovník ukazuje – `kusovník` (asm-agent.ts `bomCodes`), list sestavy (`výkres …`), `stav` sestavy –
 * jednou ⚠ `asm.stale-copy` za běh a komponentu, s příkazem, který kopii obnoví (`sestava obnovit`).
 */
import { staleCopies, staleCopyText } from "../asm-refresh";
import type { CadDoc } from "../types";
import type { OpCtx } from "./ops/registry";
import { coded } from "./ops/util";

/** ⚠ asm.stale-copy za každou zastaralou kopii dílu v sestavě `doc` (stejný text v běhu jen jednou) */
export function reportStaleCopies(ctx: OpCtx, doc: CadDoc): void {
  if (doc.kind !== "assembly" || !doc.components?.length) return;
  for (const s of staleCopies(doc, (n) => ctx.ws.findPart(n))) {
    const text = staleCopyText(s);
    if (ctx.report.entries.some((e) => e.code === "asm.stale-copy" && e.text === text)) continue;
    coded(ctx, "asm.stale-copy", { text });
  }
}
