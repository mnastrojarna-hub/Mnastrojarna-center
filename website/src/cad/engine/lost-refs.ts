/**
 * Ztracené reference VAZEB sestavy jako stav dokumentu (vlna 22 kolo 6, bod 20 – „změna modelu zneplatní vazby“): vazba,
 * jejíž plocha / hrana / vrchol po úpravě dílu neexistuje (`MateRef.lost`, cad/mate-remap.ts), je chyba dokumentu, ne jen
 * okamžiku `sestava hotovo`. Dřív ji `stav` a otevřený dokument ukázaly jen jako `mates=0/1(lost=1)` – hlavička byla `OK warn=0`
 * a přísný režim nezastavil. Teď:
 *
 *  * `stav` → ⚠ `mate.lost` za každou vazbu se ztracenou referencí, na řádku `stav` (i když je posledním příkazem
 *    a jeho stav vypisuje závěrečná stavba); přísný režim zastaví – jako ⚠ drawing.stale;
 *  * konec běhu (záznam bez řádku) → totéž, když se množina ztracených referencí od konce minulého běhu změnila (načtený
 *    dokument `--open` / `otevřít`, nová ztráta myší mezi běhy) – běh, který dokument jen exportoval, ji znovu nehlásí;
 *  * v jednom běhu jednou za vazbu: ✗ `mate.lost` ze `sestava hotovo` / `sestava obnovit` téhož běhu se neopakuje.
 *
 * Úroveň ⚠: jde o trvalý stav dokumentu (✗ zůstává u kroku, který referenci ztratil). Text = týž kód a tatáž oprava
 * (`sestava vazba N plocha …` / `… smazat`). Ztracená dosedací plocha PRUŽINY při `stav` / otevření je ⚠ `spring.lost` balíku M
 * (engine/spring-fresh.ts, kolo 6) – tady se nehlásí znovu, aby jedna ztráta nebyla dvakrát.
 */
import { mateLostArgs } from "../agent-asm";
import { mateLost } from "../mates";
import type { CadDoc } from "../types";
import { coded, type OpCtx } from "./ops/util";
import { docKeyOf } from "./run-doc";

/** vazby se ztracenou referencí: klíč (pro opakování v běhu) = číslo + text vazby, argumenty hlášky */
function lostItems(doc: CadDoc): { key: string; args: unknown[] }[] {
  if (doc.kind !== "assembly") return [];
  const out: { key: string; args: unknown[] }[] = [];
  for (const m of (doc.mates ?? []).filter(mateLost)) {
    const args = mateLostArgs(doc, m);
    out.push({ key: args[0], args });
  }
  return out;
}

/** množina ztracených referencí na konci minulého běhu nad týmž prostorem (`ws.asm` – stejný objekt i za obalem) */
const lastLost = new WeakMap<object, Map<string, string>>();

/**
 * Ztracené reference dokumentu `doc` → ⚠ mate.lost (viz hlavička). `end` = konec běhu: záznam bez řádku, jen při změně
 * množiny od minulého běhu; `statusLine` = poslední příkaz běhu je `stav` (jeho stav vypisuje závěrečná stavba) – pak se
 * hlásí VŽDY a na jeho řádku (výslovný dotaz na stav nikdy tiše „OK“).
 */
export function reportLostRefs(ctx: OpCtx, doc: CadDoc, o: { end?: boolean; statusLine?: number | null } = {}): void {
  const items = lostItems(doc);
  const line = o.end ? (o.statusLine ?? null) : ctx.line;
  if (o.end) {
    let m = lastLost.get(ctx.ws.asm);
    if (!m) lastLost.set(ctx.ws.asm, (m = new Map()));
    const key = docKeyOf(ctx);
    const prev = m.get(key);
    const now = items.map((x) => x.key).join("\n");
    m.set(key, now);
    if (prev === now && line === null) return;
  }
  for (const x of items) {
    // tatáž vazba už v tomto běhu hlášená (✗ ze `sestava hotovo` / `sestava obnovit`, ⚠ z dřívějšího `stav`) – neopakovat
    if (ctx.report.entries.some((e) => e.code === "mate.lost" && (!e.doc || e.doc === doc.name) && e.text.includes(x.key))) continue;
    const init = { args: x.args, level: "warn" as const, data: { stale: "lost" } };
    if (!o.end) coded(ctx, "mate.lost", init);
    else if (ctx.log) ctx.log.coded(line, "mate.lost", { doc: doc.name, ...init });
    else ctx.report.code("mate.lost", { line, doc: doc.name, ...init });
  }
}
