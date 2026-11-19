/**
 * `mncad help cheat` a `mncad help search <slova>` (CLI, hlavní vlákno): tahák a hledání v nápovědě jako prostý text na
 * stdout – stejný obsah jako `nápověda tahák` / `nápověda hledat …` v běhu (help/answer.ts), bez protokolu MNCAD/1.
 * `mncad help <slova>` (slovo není téma) hledá také. Vrací null = neznámé téma (prázdný dotaz).
 */
import type { CadLang } from "../i18n";
import { cheatAnswer, searchAnswer } from "./answer";

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const CHEAT = new Set(["cheat", "cheatsheet", "cheat-sheet", "tahak", "spickzettel"]);
const SEARCH = new Set(["search", "find", "hledat", "hledej", "najdi", "suchen", "suche", "finden"]);

export function cliHelpTopic(topic: string[], lang: CadLang): string | null {
  const [first = "", ...rest] = topic;
  const t = fold(first);
  if (CHEAT.has(t) && !rest.length) return cheatAnswer(lang).lines.join("\n");
  const q = (SEARCH.has(t) ? rest : topic).join(" ").trim();
  if (!q) return null;
  return searchAnswer(q, lang).lines.join("\n");
}
