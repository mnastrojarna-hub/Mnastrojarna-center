/**
 * Nápověda polí prvku (`prvek nápověda …`, agent-help.ts) – jen text do protokolu. Hledání v nápovědě a tahák
 * (`nápověda hledat …`, `nápověda tahák`; `op.help`) spočítá help/answer.ts – načte se až při prvním hledání (rejstřík návodu
 * a příručky není v hlavním svazku aplikace). Výpis `= L<n> help hits=<N> q="…"` má výsledky jako pokračovací řádky
 * (jsou i ve stručném protokolu CLI, ≤ 1,5 kB); konzole prohlížeče dostane tentýž strojový řádek a tytéž řádky výsledků.
 * Tahák `= L<n> help cheat=cs bytes=N` má ve stručném protokolu jen začátek (záložky) a odkaz na celý, konzole a plný
 * protokol celý.
 *
 * Víc hledání v jednom běhu si místo stručného protokolu (2 kB) dělí: každé hledání má svůj řádek `= L<n> help hits=3 of=8
 * q="…"` a tolik výsledků, kolik se na jeho díl vejde (help/answer.ts `shareBudget`); všechny výsledky jsou v `detail`
 * (plný protokol, JSON) a v konzoli prohlížeče. Řádek `= L<n> help …` se ve stručném protokolu vypíše vždy, i když se
 * výsledky nevejdou (engine/protocol.ts `candidates`).
 */
import { getLang } from "../../i18n";
import type { ReportBuilder } from "../protocol";
import type { Entry } from "../protocol-types";
import { say, type OpHandler } from "./util";

/** hledání v nápovědě téhož běhu (podle reportu běhu): záznam výpisu, dotaz a celá odpověď */
const searches = new WeakMap<ReportBuilder, { entry: Entry; q: string; full: string[] }[]>();

export const infoOp: OpHandler<"info"> = async (op, ctx) => {
  if (!op.help) return say(ctx, ...op.lines);
  const { helpAnswer, searchAnswer, shareBudget } = await import("../../help/answer");
  const lang = getLang();
  const a = helpAnswer(op.help, lang);
  // konzole (prohlížeč): strojový řádek jako ve stručném protokolu a pod ním celá odpověď – řádky výsledků patří do
  // strojové části výpisu (stručný protokol), ne do `detail`
  if (ctx.log) {
    ctx.log.body.push({ line: ctx.line, text: `= L${ctx.line} help ${a.kv}` });
    for (const text of a.lines) ctx.log.body.push({ line: ctx.line, text });
  }
  // tahák (≈ 3,5 kB) se do stručného protokolu nevejde: začátek + odkaz, celý text v `detail` (plný protokol, JSON)
  if (a.short) {
    ctx.report.measure(ctx.line, "help", [a.kv, ...a.short].join("\n"), { detail: a.lines.join("\n") });
    return;
  }
  const entry = ctx.report.measure(ctx.line, "help", [a.kv, ...a.lines].join("\n"));
  let list = searches.get(ctx.report);
  if (!list) searches.set(ctx.report, (list = []));
  list.push({ entry, q: op.help.q, full: a.lines });
  if (list.length < 2) return;
  // druhé a další hledání běhu: všechna hledání na stejný díl stručného protokolu, celé odpovědi do `detail`
  const budget = shareBudget(list.length);
  for (const s of list) {
    const c = searchAnswer(s.q, lang, budget, { compact: true });
    s.entry.text = [c.kv, ...c.lines].join("\n");
    s.entry.detail = s.full.join("\n");
  }
};
