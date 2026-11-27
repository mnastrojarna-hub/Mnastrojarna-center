/**
 * Hlášky kusovníku v enginu (vlna 22, bod 22g): sestava, jejíž komponenta je kopie dílu starší než díl v záložce, to
 * řekne VŠUDE, kde se kusovník ukazuje – `kusovník` (asm-agent.ts `bomCodes`), list sestavy (`výkres …`), `stav` sestavy –
 * jednou ⚠ `asm.stale-copy` za běh a komponentu, s příkazem, který kopii obnoví (`sestava obnovit`).
 */
import { staleCopies, staleCopyText } from "../asm-refresh";
import { materialConflictLines } from "../material-designation";
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

/**
 * ⚠ material.class-conflict za každý díl dokumentu (u sestavy díly komponent), jehož označení v razítku patří jiné třídě než
 * hustota (kolo 7b, bod 22g): `stav`, kusovník a list výkresu – dřív jen na řádku `materiál` (pak stav, kusovník i PDF
 * ukázaly označení oceli s hmotností nerezu bez slova). Stejný díl v běhu jednou.
 */
export function reportMaterialConflicts(ctx: OpCtx, doc: CadDoc): void {
  if (doc.kind === "draft") return;
  for (const x of materialConflictLines(doc)) {
    // stejný text z tohoto hlášení jednou za běh (`stav` i list v témže skriptu); záznam řádku příkazu `materiál` se
    // nepočítá – stav ho zopakuje (dřív stav po ⚠ příkazu mlčel)
    if (ctx.report.entries.some((e) => e.code === "material.class-conflict" && e.text === x.text && (e.data as { conflictOf?: string } | undefined)?.conflictOf === x.part)) continue;
    coded(ctx, "material.class-conflict", { text: x.text, data: { conflictOf: x.part } });
  }
}
