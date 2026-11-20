/**
 * `mncad help cheat` a `mncad help search <slova>` (CLI, hlavní vlákno): tahák a hledání v nápovědě jako prostý text na
 * stdout – stejný obsah jako `nápověda tahák` / `nápověda hledat …` v běhu (help/answer.ts), bez protokolu MNCAD/1.
 * `mncad help <slova>` (slovo není téma) hledá také. `mncad help search` bez slov je chyba použití (`error`) se stejnou
 * radou jako `nápověda hledat` bez slov v běhu.
 */
import { tr, type CadLang } from "../i18n";
import { cheatAnswer, searchAnswer } from "./answer";

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const CHEAT = new Set(["cheat", "cheatsheet", "cheat-sheet", "tahak", "spickzettel"]);
const SEARCH = new Set(["search", "find", "hledat", "hledej", "najdi", "suchen", "suche", "finden"]);

export function cliHelpTopic(topic: string[], lang: CadLang): { text: string } | { error: string } {
  const [first = "", ...rest] = topic;
  const t = fold(first);
  if (CHEAT.has(t) && !rest.length) return { text: cheatAnswer(lang).lines.join("\n") };
  const q = (SEARCH.has(t) ? rest : topic).join(" ").trim();
  if (!q) return { error: tr("mncad help search: chybí slova – např. mncad help search záložky (hledá v návodu pro AI, v příkazech a v příručce); témata: guide, commands, cheat, search <slova>") };
  return { text: searchAnswer(q, lang).lines.join("\n") };
}
