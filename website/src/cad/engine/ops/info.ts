/**
 * Nápověda polí prvku (`prvek nápověda …`, agent-help.ts) – jen text do protokolu. Hledání v nápovědě a tahák
 * (`nápověda hledat …`, `nápověda tahák`; `op.help`) spočítá help/answer.ts – načte se až při prvním hledání (rejstřík návodu
 * a příručky není v hlavním svazku aplikace). Výpis `= L<n> help hits=<N> q="…"` má výsledky jako pokračovací řádky
 * (jsou i ve stručném protokolu CLI, ≤ 1,5 kB); konzole prohlížeče dostane tytéž řádky. Tahák `= L<n> help cheat=cs bytes=N`
 * má ve stručném protokolu jen začátek (záložky) a odkaz na celý, konzole a plný protokol celý.
 */
import { getLang } from "../../i18n";
import { say, type OpHandler } from "./util";

export const infoOp: OpHandler<"info"> = async (op, ctx) => {
  if (!op.help) return say(ctx, ...op.lines);
  const { helpAnswer } = await import("../../help/answer");
  const a = helpAnswer(op.help, getLang());
  // řádky výsledků patří do strojové části výpisu (stručný protokol), ne do `detail` – konzole je dostane přímo
  if (ctx.log) for (const text of a.lines) ctx.log.body.push({ line: ctx.line, text });
  // tahák (≈ 3,5 kB) se do stručného protokolu nevejde: začátek + odkaz, celý text v `detail` (plný protokol, JSON)
  if (a.short) ctx.report.measure(ctx.line, "help", [a.kv, ...a.short].join("\n"), { detail: a.lines.join("\n") });
  else ctx.report.measure(ctx.line, "help", [a.kv, ...a.lines].join("\n"));
};
