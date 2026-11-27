/**
 * Pružiny po načtení dokumentu (vlna 22, bod 7 zprávy – „po importu zůstávají neaktuální odvozené parametry pružiny“).
 *
 * Řídicí jsou polohy komponent, dosedací plochy a L0 / Ln / tuhost; `spring.length` / `offset` / `seat` jsou jen odvozená mezipaměť
 * (cad/types.ts SpringDef). Po každém načtení celého dokumentu – CLI `--open`, řádek JSON ve skriptu (i `window.mncad.setDocument`
 * a vložení JSON do konzole), `otevřít "soubor"` – se délka odvodí z ploch v nynějších polohách; rozpor s uloženou délkou nad
 * 0,01 mm se ohlásí ⚠ `spring.stale` (uložená × z ploch) a dokument se opraví jedním krokem historie. `stav`, kolize, STEP i 3D
 * pak pracují s délkou z ploch. Stejnou kontrolu (bez zápisu) dělá `stav` (`springCheck` – řádek „Pružiny: … délka odvozená
 * z dosedacích ploch“ / ⚠ rozpor / „nezkontrolováno“).
 */
import { springComps, springDriftArgs, springDriftText, type SpringCheck } from "../asm-spring";
import { markMissingSeats, springCheckOf } from "../asm-spring-agent";
import { lostSpringComps, springFixCmd, springLostShort } from "../spring-lost";
import { isCancelled } from "../kernel-client";
import type { CadDoc } from "../types";
import { makeAsmEnv, type AsmEnvOptions } from "./asm-env";
import type { KernelApi } from "./kernel";
import type { OpCtx } from "./ops/registry";
import { asmHooks } from "./ops/util";
import { docKeyOf, runOf } from "./run-doc";
import type { Workspace } from "./workspace";

/**
 * Pracovní dokument běhu právě načtený celý (JSON, `--open`, otevřít): délky pružin z dosedacích ploch, rozpor ⚠ `spring.stale`
 * na řádku načtení (`line`, null = před skriptem). Opravený dokument nahradí pracovní dokument běhu (zapíše se jako krok historie).
 */
export async function freshenRunDoc(ctx: OpCtx, line: number | null): Promise<void> {
  const r = runOf(ctx);
  let doc = r.doc;
  if (doc.kind !== "assembly" || !springComps(doc).length) return;
  const env = makeAsmEnv(ctx.ws, ctx.host.kernel, { docKey: docKeyOf(ctx), ...asmHooks(ctx) });
  // dosedací plocha, kterou díl nemá (vnější úprava – plocha 99): ztracená, ne „uložená délka … nezkontrolováno“ (kolo 6)
  try {
    const m = await markMissingSeats(doc, env);
    if (m.marked.length) {
      doc = r.doc = m.doc;
      r.changed = true;
    }
  } catch (e) {
    if (isCancelled(e)) throw e;
  }
  // každá pružina se ztracenou dosedací plochou (nově zjištěná i uložená v souboru) = ⚠ na řádku načtení
  reportLostSprings(ctx, doc, line);
  let res: Awaited<ReturnType<typeof springCheckOf>> = null;
  try {
    res = await springCheckOf(doc, env);
  } catch (e) {
    if (isCancelled(e)) throw e;
    return; // geometrie ploch nejde načíst – `stav` řekne „nezkontrolováno“
  }
  if (!res) return;
  if (res.doc !== doc) {
    r.doc = res.doc;
    r.changed = true;
  }
  for (const d of res.check.stale) {
    const o = { doc: doc.name, args: springDriftArgs(d), text: springDriftText(d) };
    if (ctx.log) ctx.log.coded(line, "spring.stale", o);
    else ctx.report.code("spring.stale", { line, ...o });
  }
}

/**
 * ⚠ `spring.lost` za každou pružinu se ztracenou dosedací plochou (načtení dokumentu, `stav`): délka a síla nezkontrolovány, příkaz
 * opravy. Varování, ne poznámka – přísný režim (`--strict`) na něm zastaví, stejně jako na ⚠ rozporu délky (vlna 22, bod 7 / 20).
 */
export function reportLostSprings(ctx: OpCtx, doc: CadDoc, line: number | null): void {
  for (const c of lostSpringComps(doc)) {
    const o = { doc: doc.name, args: [c.name, springLostShort(doc, c), springFixCmd(doc, c)] };
    if (ctx.log) ctx.log.coded(line, "spring.lost", o);
    else ctx.report.code("spring.lost", { line, ...o });
  }
}

/** Kontrola pružin pro `stav` (bez zápisu): ověřeno proti plochám / rozpory / nezkontrolováno. Bez pružin undefined. */
export async function springCheck(ws: Workspace, kernel: KernelApi, doc: CadDoc, o: AsmEnvOptions = {}): Promise<SpringCheck | undefined> {
  if (doc.kind !== "assembly" || !springComps(doc).length) return undefined;
  try {
    const res = await springCheckOf(doc, makeAsmEnv(ws, kernel, o));
    return res?.check ?? { checked: false, stale: [] };
  } catch (e) {
    if (isCancelled(e)) throw e;
    return { checked: false, stale: [] };
  }
}
