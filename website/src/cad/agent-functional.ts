/**
 * Funkční prvky a základny v modelu (vlna 22, bod 18) – čistý rozbor textových příkazů (provedení engine/ops/functional.ts):
 *  - `funkční F7 [H7]` · `funkční "Díra 1" [H7]` · `funkční Díra 1 ±0,02` – plocha (F číslo) nebo prvek historie (název),
 *    volitelně předepsaná tolerance; kontrola kót pak u funkčního prvku chce velikost, polohu (od základny) a tuto toleranci;
 *  - `základna A F3` · `funkční základna A F3` – rovinná plocha jako základna (polohy funkčních prvků se kótují od ní);
 *  - `funkční profil "Skica 1" [tol]` – profil (skica, i přes prvek ze skici) jako celek: všechny jeho rozměry a polohy (kolo 7b);
 *  - `funkční dohledat` – označené plochy ze starší revize modelu znovu najít podle geometrie (kolo 7b);
 *  - `funkční` / `funkční seznam` – výpis; `funkční zrušit F7 | "Díra 1" | vše` · `základna zrušit A | vše`.
 * EN `functional F7 H7`, `functional datum A F3` (i `datum A F3`), `functional clear …`; DE `funktional F7 H7`, `bezug A F3`,
 * `funktional bezug A F3`, `funktional entfernen …`.
 */
import { tr } from "./i18n";

export type FunctionalCmd =
  | { kind: "list" }
  /** `target` = slova cíle a tolerance (název prvku může mít mezery – rozdělí je provedení podle názvů prvků dílu) */
  | { kind: "mark"; target: string[] }
  /** `funkční profil "Skica 1" [tol]` – profil (skica, i přes prvek, který z ní vzniká) jako celek (kolo 7b) */
  | { kind: "profile"; target: string[] }
  /** `funkční dohledat` – označené plochy ze starší revize modelu znovu najít podle geometrie (kolo 7b) */
  | { kind: "refind" }
  | { kind: "datum"; label: string; target: string[] }
  | { kind: "clear"; what: "functional" | "datum"; target: string[] | "all" };

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const W = (...w: string[]) => new Set(w.map(fold));
const FUNC = W("funkční", "funkcni", "functional", "funktional", "funktion", "funktionsflache");
const DATUM = W("základna", "zakladna", "bezug", "bezugsflache");
const DATUM_EN = W("datum");
const LIST = W("seznam", "výpis", "list", "liste", "anzeigen");
const CLEAR = W("zrušit", "zrusit", "smazat", "odstranit", "clear", "remove", "delete", "entfernen", "löschen", "loschen", "aufheben");
const ALL = W("vše", "vse", "všechny", "all", "alle");
const PROFILE = W("profil", "profile", "obrys", "contour", "kontur");
const REFIND = W("dohledat", "najít", "najit", "refind", "relocate", "suchen", "wiederfinden");

/** slova řádku: uvozovky drží název s mezerami pohromadě */
export function functionalTokens(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|„([^“”]*)[“”]|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** usage pro chybové hlášky */
export const functionalUsage = (): string => tr("funkční F7 [H7] · funkční \"Díra 1\" [±0,02] · funkční profil \"Skica 1\" [±0,02] · základna A F3 · funkční [seznam] · funkční dohledat · funkční zrušit F7|\"Díra 1\"|vše · základna zrušit A|vše");

const isLetter = (s: string) => /^[A-Za-z]$/.test(s);
const isFace = (s: string) => /^F\d+$/i.test(s);

/** řádek příkazu funkčních prvků / základen, jinak null (jiný příkaz) */
export function parseFunctionalLine(line: string): FunctionalCmd | null {
  const t = functionalTokens(line.trim());
  if (!t.length) return null;
  const h = fold(t[0]);
  let rest = t.slice(1);
  let datum = DATUM.has(h);
  if (!datum && DATUM_EN.has(h)) {
    // EN „datum A F3“ – jinak je „datum“ pomocná rovina (agent.ts), proto jen přesně písmeno + plocha / zrušit
    if (!((rest.length === 2 && isLetter(rest[0]) && isFace(rest[1])) || (rest.length >= 1 && CLEAR.has(fold(rest[0]))))) return null;
    datum = true;
  }
  if (!datum && !FUNC.has(h)) return null;
  if (!datum && rest.length && (DATUM.has(fold(rest[0])) || DATUM_EN.has(fold(rest[0])))) {
    datum = true;
    rest = rest.slice(1);
  }
  if (!rest.length || (rest.length === 1 && LIST.has(fold(rest[0])))) return { kind: "list" };
  if (!datum && rest.length === 1 && REFIND.has(fold(rest[0]))) return { kind: "refind" };
  if (CLEAR.has(fold(rest[0]))) {
    const tg = rest.slice(1);
    if (!tg.length) throw new Error(tr("{0}: co zrušit? – {1}", t[0], functionalUsage()));
    return { kind: "clear", what: datum ? "datum" : "functional", target: tg.length === 1 && ALL.has(fold(tg[0])) ? "all" : tg };
  }
  if (datum) {
    if (rest.length !== 2 || !isLetter(rest[0]) || !isFace(rest[1])) throw new Error(tr("základna: písmeno a rovinná plocha, např. základna A F3 – {0}", functionalUsage()));
    return { kind: "datum", label: rest[0].toUpperCase(), target: [rest[1].toUpperCase()] };
  }
  if (PROFILE.has(fold(rest[0]))) {
    if (rest.length < 2) throw new Error(tr("funkční profil: název skici nebo prvku ze skici, např. funkční profil \"Skica 1\" ±0,02 – {0}", functionalUsage()));
    return { kind: "profile", target: rest.slice(1) };
  }
  return { kind: "mark", target: rest };
}

/** řádek AGENT_COMMANDS (agent.ts) */
export const FUNCTIONAL_COMMAND = {
  cmd: "funkční F7 [H7] · funkční \"Díra 1\" [±0,02] · funkční profil \"Skica 1\" [±0,02] · základna A F3 · funkční [seznam] · funkční dohledat · funkční zrušit …",
  en: "functional F7 H7 / functional \"Hole 1\" ±0.02 / functional profile \"Sketch 1\" ±0.02 / functional datum A F3 (datum A F3) / functional list / functional refind / functional clear F7",
  de: "funktional F7 H7 / funktional \"Bohrung 1\" ±0,02 / funktional profil \"Skizze 1\" ±0,02 / bezug A F3 / funktional liste / funktional suchen / funktional entfernen F7",
};
