/**
 * `kolize`: kontrola průniků komponent sestavy v jádře; výsledek do protokolu a do stavu (`ws.asm.clash`).
 * Dvojice se zařadí geometricky v jádře (clash-class.ts + operace `clashDetail`, kap. 6.3): šroub v závitové díře = ℹ
 * `clash.thread`, prstenec pod hlavou šroubu = ℹ `clash.underhead`, ostatní = ⚠ `clash.real`; nevyhodnotitelné dvojice
 * ⚠ `clash.undetermined`, skryté komponenty ℹ `clash.hidden` (5.2 č. 20). Výpis `= clash` má počty tříd (stejný v cs/en/de).
 * Uložený výsledek nese otisk sestavy (`clashSig`): když se sestava potom změní, textový stav ho označí jako neplatný a CLI
 * ho na konci běhu přepočítá pro konečný stav (řádek D / Σ nikdy neukáže kolize jiné sestavy, než jaká se odevzdává).
 */
import { resultId, stampResult } from "../result-key";
import { classifyClashes, clashKv, clashSig, type ClashCounts, type ClashDetail } from "../../clash-class";
import { cadLocale, tr } from "../../i18n";
import { fmtNum } from "@/lib/mesh-metrics";
import { ensureLeaves } from "../asm-status";
import type { Code, CodeEntryInit } from "../codes";
import type { KernelApi } from "../kernel";
import { docKeyOf, runOf } from "../run-doc";
import type { Workspace } from "../workspace";
import type { Interference } from "../../asm-kernel";
import type { CadDoc } from "../../types";
import { asmHooks, coded, sayKv, type OpCtx, type OpHandler } from "./util";

/** důvod nevyhodnotitelné dvojice (do protokolu) */
const undeterminedWhy = (x: ClashDetail) =>
  x.why === "unknown-designation" ? tr("neznámé označení závitu „{0}“ (jmenovitý průměr jen z označení M…)", x.hole?.designation ?? x.note ?? "") : x.why === "missing-component" ? tr("komponenta dvojice v sestavě není") : x.note ? `${tr("booleovská operace jádra selhala")} (${x.note})` : tr("booleovská operace jádra selhala");

/**
 * Kam zařazené dvojice zapsat: `coded` = záznam s řádkem konzole (⚠ / ℹ), `quiet` = záznam jen do reportu (šroub v závitu
 * se počítá, nevypisuje). Operace běhu: `ctxOut(ctx)`; závěrečný souhrn CLI zapisuje rovnou do reportu.
 */
export type ClashOut = { coded: (code: Code, o: CodeEntryInit) => void; quiet: (code: Code, o: CodeEntryInit) => void };
export const ctxOut = (ctx: OpCtx): ClashOut => ({ coded: (c, o) => coded(ctx, c, o), quiet: (c, o) => void ctx.report.code(c, { line: ctx.line, ...o }) });

/**
 * Záznamy zařazených dvojic: šroub v závitu a prstenec pod hlavou jen ℹ (počítá se, nevypisuje), skutečná kolize ⚠ po
 * dvojicích, nevyhodnotitelná ⚠ s důvodem. Stejné ⚠ dvou příkazů se ve stručném protokolu sloučí (`L13,L14 ×2`).
 */
export function clashFindings(out: ClashOut, d: CadDoc, list: readonly ClashDetail[], res: readonly Interference[]): void {
  const name = (cid: string) => d.components?.find((c) => c.id === cid)?.name ?? cid;
  for (const x of list.filter((y) => y.cls === "thread" || y.cls === "underhead")) out.quiet(x.cls === "thread" ? "clash.thread" : "clash.underhead", { doc: d.name, args: [name(x.a), name(x.b)], data: { holeIn: x.holeIn, hole: x.hole, band: x.band, rest: x.rest, restDepth: x.restDepth } });
  for (const x of list.filter((y) => y.cls === "real")) out.coded("clash.real", { doc: d.name, args: [name(x.a), name(x.b), fmtNum(x.volume, 1)] });
  for (const x of list.filter((y) => y.cls === "undetermined")) out.coded("clash.undetermined", { doc: d.name, text: `${tr("kolizi „{0}“ × „{1}“ nelze vyhodnotit", name(x.a), name(x.b))}: ${undeterminedWhy(x)}` });
  const und = (res as { stats?: { undetermined?: number } }).stats?.undetermined ?? 0;
  if (und > 0) out.coded("clash.undetermined", { doc: d.name, text: tr("{0} dvojic komponent nelze vyhodnotit – booleovská operace jádra selhala (dvojice se nehlásí jako kolize)", und) });
}

/**
 * Kontrola kolizí sestavy (díly musí být postavené – `ensureLeaves`): průniky v jádře, zařazení dvojic a uložení výsledku
 * pod klíčem dokumentu s otiskem sestavy a řádkem kontroly. Volá `kolize`, `kontrola sestava` i závěrečný souhrn CLI.
 */
export async function checkClashes(ws: Workspace, kernel: KernelApi, d: CadDoc, key: string, line: number | null): Promise<{ res: Interference[]; list: ClashDetail[]; counts: ClashCounts }> {
  const res = await kernel.interference(d);
  const { list, counts } = await classifyClashes(kernel, d, res);
  // záznam s razítkem, pro co platí (dokument, revize, počet komponent, poloha z dokumentu) – panel Kolize a `stav` (result-key.ts)
  const at = new Date().toLocaleTimeString(cadLocale());
  const sig = clashSig(d);
  const comps = (d.components ?? []).length;
  ws.asm.clash.set(key, stampResult({ res, at, comps, classes: counts, sig, line }, resultId("clash", key, d, { sig, comps, at, line })));
  return { res, list, counts };
}

export const clashOp: OpHandler<"clash"> = async (_op, ctx) => {
  const d = runOf(ctx).doc;
  if (d.kind !== "assembly") throw new Error(tr("kolize: otevřený dokument není sestava"));
  const leaves = await ensureLeaves(ctx.ws, ctx.host.kernel, d, asmHooks(ctx)); // díly postavené i pro stav sestavy a souhrn
  const { res, list, counts } = await checkClashes(ctx.ws, ctx.host.kernel, d, docKeyOf(ctx), ctx.line);
  const comps = (d.components ?? []).length;
  const text = !res.length
    ? tr("✓ kolize: žádné ({0} komponent)", comps)
    : counts.underhead || counts.undetermined
      ? tr("kolize: {0} – šroub v závitu {1}, pod hlavou {2}, skutečné {3}, nevyhodnotitelné {4}", res.length, counts.thread, counts.underhead, counts.real, counts.undetermined)
      : tr("kolize: {0} – šroub v závitu {1}, skutečné {2}", res.length, counts.thread, counts.real);
  sayKv(ctx, clashKv(counts), text);
  clashFindings(ctxOut(ctx), d, list, res);
  const hidden = leaves.filter((l) => l.hidden).length;
  if (hidden) coded(ctx, "clash.hidden", { args: [hidden] });
};
