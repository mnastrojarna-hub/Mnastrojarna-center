/**
 * `kolize`: kontrola průniků komponent sestavy v jádře; výsledek do protokolu a do stavu (`ws.asm.clash`).
 * Dvojice se zařadí geometricky v jádře (clash-class.ts + operace `clashDetail`, kap. 6.3): šroub v závitové díře = ℹ
 * `clash.thread`, prstenec pod hlavou šroubu = ℹ `clash.underhead`, ostatní = ⚠ `clash.real`; nevyhodnotitelné dvojice
 * ⚠ `clash.undetermined`, skryté komponenty ℹ `clash.hidden` (5.2 č. 20). Výpis `= clash` má počty tříd (stejný v cs/en/de).
 * Uložený výsledek nese otisk sestavy (`clashSig`): když se sestava potom změní, textový stav ho označí jako neplatný a CLI
 * ho na konci běhu přepočítá pro konečný stav (řádek D / Σ nikdy neukáže kolize jiné sestavy, než jaká se odevzdává).
 */
import { resultId, stampResult } from "../result-key";
import { classifyClashes, clashKv, clashSig, countClasses, type ClashCounts, type ClashDetail } from "../../clash-class";
import { applyClashPolicy, isFault, staticRuleCtx, touchTol } from "../../clash-rules";
import { CLASS_ORDER, className, countsText, entryClashes, fmtVol, groupClashes, groupText, leafLabel, nf, pathA, pathB, ruleText } from "../../clash-report";
import { applyClashDocCmd, type ClashCmd } from "../../agent-clash";
import { cadLocale, tr } from "../../i18n";
import { ensureLeaves } from "../asm-status";
import type { Code, CodeEntryInit } from "../codes";
import type { KernelApi } from "../kernel";
import { docKeyOf, runOf } from "../run-doc";
import type { Workspace } from "../workspace";
import type { Interference } from "../../asm-kernel";
import type { CadDoc } from "../../types";
import { asmHooks, coded, say, sayKv, type OpCtx, type OpHandler } from "./util";

/**
 * Kam zařazené dvojice zapsat: `coded` = záznam s řádkem konzole (⚠ / ℹ), `quiet` = záznam jen do reportu (šroub v závitu
 * se počítá, nevypisuje). Operace běhu: `ctxOut(ctx)`; závěrečný souhrn CLI zapisuje rovnou do reportu.
 */
export type ClashOut = { coded: (code: Code, o: CodeEntryInit) => void; quiet: (code: Code, o: CodeEntryInit) => void };
export const ctxOut = (ctx: OpCtx): ClashOut => ({ coded: (c, o) => coded(ctx, c, o), quiet: (c, o) => void ctx.report.code(c, { line: ctx.line, ...o }) });

/** data záznamu skupiny (JSON `entries[].data`): třída, důvod, počet, instance, cesty, objem a místo každé položky */
const groupData = (g: ReturnType<typeof groupClashes>[number]) => ({
  // dřívější tvar `data` šroubu v závitu (díra, pásmo) z první položky – JSON zůstává zpětně čitelný
  ...(g.items[0].holeIn ? { holeIn: g.items[0].holeIn } : {}),
  ...(g.items[0].hole ? { hole: g.items[0].hole } : {}),
  ...(g.items[0].band !== undefined ? { band: g.items[0].band, rest: g.items[0].rest, restDepth: g.items[0].restDepth } : {}),
  cls: g.cls,
  why: g.why,
  n: g.items.length,
  pair: [g.a, g.b],
  items: g.items.map((i) => ({ a: i.la, b: i.lb, aPath: pathA(i), bPath: pathB(i), volume: Math.round(i.volume * 1000) / 1000, ...(i.at ? { at: i.at } : {}), ...(i.box ? { box: i.box } : {}), ...(i.depth !== undefined ? { depth: Math.round(i.depth * 1e4) / 1e4 } : {}), ...(i.rule ? { rule: i.rule } : {}), ...(i.hole ? { hole: i.hole } : {}), ...(i.band !== undefined ? { band: i.band, rest: i.rest } : {}) })),
});

/**
 * Záznamy zařazených dvojic po pravidlech dokumentu (vlna 22, bod 5), SESKUPENÉ (stejná třída, stejné díly, objem v toleranci):
 * skutečná kolize ⚠ `clash.real` a nevyhodnotitelná ⚠ `clash.undetermined` (s důvodem a nápovědou) s instancemi a místem;
 * pracovní kontakt ℹ `clash.work` (vypíše se – nikdy se neskryje tiše); šroub v závitu, prstenec pod hlavou a dotyk jen ℹ do
 * reportu (počítají se, seznam nezahltí). Argumenty kódu `clash.real` = [díl A, díl B, objem] jako dřív.
 */
export function clashFindings(out: ClashOut, d: CadDoc, list: readonly ClashDetail[], res: readonly Interference[]): void {
  const fin = applyClashPolicy(list, d, staticRuleCtx(d));
  for (const g of groupClashes(fin, d)) {
    const one = g.items.length === 1;
    const a = one ? g.items[0].la : g.a;
    const b = one ? g.items[0].lb : g.b;
    const text = groupText(g, d);
    const data = groupData(g);
    if (g.cls === "real") out.coded("clash.real", { doc: d.name, args: [a, b, fmtVol(g.volume)], text, data });
    else if (g.cls === "undetermined") out.coded("clash.undetermined", { doc: d.name, args: [a, b], text, data });
    else if (g.cls === "work") out.coded("clash.work", { doc: d.name, args: [a, b], text, data });
    else out.quiet(g.cls === "thread" ? "clash.thread" : g.cls === "underhead" ? "clash.underhead" : "clash.touch", { doc: d.name, args: [a, b], text, data });
  }
  const und = (res as { stats?: { undetermined?: number } }).stats?.undetermined ?? 0;
  if (und > 0) out.coded("clash.undetermined", { doc: d.name, text: tr("{0} dvojic komponent nelze vyhodnotit – booleovská operace jádra selhala (dvojice se nehlásí jako kolize)", und) });
}

/**
 * Kontrola kolizí sestavy (díly musí být postavené – `ensureLeaves`): průniky v jádře, zařazení dvojic a uložení výsledku
 * pod klíčem dokumentu s otiskem sestavy a řádkem kontroly. Volá `kolize`, `kontrola sestava` i závěrečný souhrn CLI.
 * Záznam nese geometrické zařazení `list` (pravidla dokumentu se nad ním uplatní živě – clash-report.ts `entryClashes`)
 * a počty tříd po pravidlech v době kontroly (`classes`).
 */
export async function checkClashes(ws: Workspace, kernel: KernelApi, d: CadDoc, key: string, line: number | null): Promise<{ res: Interference[]; list: ClashDetail[]; counts: ClashCounts }> {
  const res = await kernel.interference(d);
  const { list } = await classifyClashes(kernel, d, res);
  const counts = countClasses(applyClashPolicy(list, d, staticRuleCtx(d)));
  // záznam s razítkem, pro co platí (dokument, revize, počet komponent, poloha z dokumentu) – panel Kolize a `stav` (result-key.ts)
  const at = new Date().toLocaleTimeString(cadLocale());
  const sig = clashSig(d);
  const comps = (d.components ?? []).length;
  ws.asm.clash.set(key, stampResult({ res, list, at, comps, classes: counts, sig, line }, resultId("clash", key, d, { sig, comps, at, line })));
  return { res, list, counts };
}

/** souhrnná věta kontroly (dřívější tvar, dotyk / pracovní kontakt jen když nejsou nulové) */
function clashSummaryText(n: number, comps: number, c: ClashCounts): string {
  if (!n) return tr("✓ kolize: žádné ({0} komponent)", comps);
  if (c.touch || c.work) return tr("kolize: {0} – {1}", n, countsText(c));
  return c.underhead || c.undetermined ? tr("kolize: {0} – šroub v závitu {1}, pod hlavou {2}, skutečné {3}, nevyhodnotitelné {4}", n, c.thread, c.underhead, c.real, c.undetermined) : tr("kolize: {0} – šroub v závitu {1}, skutečné {2}", n, c.thread, c.real);
}

/** `kolize seznam [třída]`: poslední kontrola po skupinách (pravidla dokumentu živě), filtr třídy */
function listCmd(ctx: OpCtx, d: CadDoc, filter: Extract<ClashCmd, { op: "list" }>["filter"]): void {
  const entry = ctx.ws.asm.clash.get(docKeyOf(ctx));
  if (!entry) throw new Error(tr("kolize seznam: sestava ještě nebyla zkontrolována – nejdřív „kolize“"));
  if (entry.sig && entry.sig !== clashSig(d)) coded(ctx, "clash.stale", { args: [entry.at] });
  const fin = entryClashes(entry, d);
  const keep = (c: ClashDetail["cls"]) => filter === "all" || (filter === "faults" ? isFault(c) : c === filter);
  const groups = groupClashes(fin, d).filter((g) => keep(g.cls));
  const c = countClasses(fin);
  const lines = [tr("Kolize (zkontrolováno {0}): {1} · zobrazeno {2} skupin ({3})", entry.at, countsText(c), groups.length, filter === "all" ? tr("vše") : filter === "faults" ? tr("závady") : className(filter))];
  // výpis, ne nové nálezy: řádky bez ⚠ / ℹ na začátku (protokol by z nich udělal další varování) – třída slovem
  for (const cls of CLASS_ORDER) for (const g of groups.filter((x) => x.cls === cls)) lines.push(` ${isFault(g.cls) ? "!" : "·"} ${className(g.cls)}: ${groupText(g, d)}`);
  sayKv(ctx, `${clashKv(c)} shown=${groups.length} filter=${filter}`, ...lines);
}

export const clashOp: OpHandler<"clash"> = async (op, ctx) => {
  const r = runOf(ctx);
  const d = r.doc;
  if (d.kind !== "assembly") throw new Error(tr("kolize: otevřený dokument není sestava"));
  const cmd: ClashCmd = op.cmd ?? { op: "check" };
  if (cmd.op === "list") return listCmd(ctx, d, cmd.filter);
  if (cmd.op === "rules") {
    const rules = d.clashRules ?? [];
    say(ctx, rules.length ? tr("Pravidla kolizí ({0}) · tolerance dotyku {1} mm:", rules.length, nf(touchTol(d), 6)) : tr("Pravidla kolizí: žádná · tolerance dotyku {0} mm – kolize pravidlo pracovní \"A\" \"B\" [kroky 10..20]", nf(touchTol(d), 6)), ...rules.map((x, i) => ` ${i + 1}. ${ruleText(d, x)}`));
    return;
  }
  const changed = applyClashDocCmd(d, cmd);
  if (changed) {
    r.doc = changed.doc;
    r.changed = true;
    if (changed.rule) say(ctx, tr("✓ pravidlo kolizí {0}", ruleText(changed.doc, changed.rule)));
    else if (changed.removed) say(ctx, tr("✓ odebráno pravidel kolizí: {0}", changed.removed.length));
    else say(ctx, tr("✓ tolerance dotyku {0} mm (průnik tenčí = dotyk, ne kolize)", nf(touchTol(changed.doc), 6)));
    // uložená kontrola zůstává platná (geometrie se nezměnila) – třídy po nových pravidlech ukáže `kolize seznam` / `stav`
    const entry = ctx.ws.asm.clash.get(docKeyOf(ctx));
    if (entry && (!entry.sig || entry.sig === clashSig(changed.doc))) sayKv(ctx, clashKv(countClasses(entryClashes(entry, changed.doc))), tr("kolize po pravidlech: {0}", countsText(countClasses(entryClashes(entry, changed.doc)))));
    return;
  }
  const leaves = await ensureLeaves(ctx.ws, ctx.host.kernel, d, asmHooks(ctx)); // díly postavené i pro stav sestavy a souhrn
  const { res, list, counts } = await checkClashes(ctx.ws, ctx.host.kernel, d, docKeyOf(ctx), ctx.line);
  const comps = (d.components ?? []).length;
  sayKv(ctx, clashKv(counts), clashSummaryText(res.length, comps, counts));
  clashFindings(ctxOut(ctx), d, list, res);
  const hidden = leaves.filter((l) => l.hidden).length;
  if (hidden) coded(ctx, "clash.hidden", { args: [hidden] });
};

/** popis dvojice pro jiné moduly (stav, GUI): „Šroub M12 [S2] × Přidržovač“ */
export const pairLabel = (d: CadDoc, x: ClashDetail) => `${leafLabel(d, pathA(x))} × ${leafLabel(d, pathB(x))}`;
