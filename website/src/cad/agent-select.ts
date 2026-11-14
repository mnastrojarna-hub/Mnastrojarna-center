/**
 * Výběr entit textovým příkazem (pro AI agenty, kteří mají jen konzoli – bez myši a bez WebGL):
 *
 *   vyber F3 E2 V5 [přidat]     vybere entity stejně jako klik (Ctrl/Shift + klik = „přidat“)
 *   vyber Čep:F3 · vyber #2:F3 (druhá ze stejných komponent) · vyber comp:Čep · vyber "feature:Díra 1" · vyber těleso
 *   vyber E3;E7 · vyber F3,E2           id lze oddělit i středníkem nebo čárkou
 *   vyber nic                   zruší výběr (Esc)
 *   vyber                       vypíše aktuální výběr
 *
 * EN `select`, DE `auswählen`. Id jsou stejná jako u popisků pro výběr, příkazu `měřit` a `window.mncad.select`.
 * Výběr pak převezmou tlačítka pásu karet (Zaoblit / Sražení / Skica na vybrané ploše) a formuláře prvků („+ aktuální
 * výběr“); textové příkazy výběr nečtou – hrany a plochy se v nich píší čísly (`zaoblit 3 hrany E2;E5`).
 * Provedení (stav aplikace) je v components/cad/agent-api-host.ts.
 */
import { tr } from "./i18n";

export type SelectCmd = { kind: "select"; ids: string[]; additive: boolean } | { kind: "selectClear" } | { kind: "selectShow" };

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const set = (...w: string[]) => new Set(w.map(fold));
export const SELECT_HEADS = set("vyber", "vybrat", "vyberte", "výběr", "select", "selection", "auswählen", "auswahl", "wähle", "markieren");
const ADD_WORDS = set("přidat", "přidej", "add", "plus", "hinzufügen", "dazu", "zusätzlich");
const NONE_WORDS = set("nic", "zrušit", "zrus", "vyp", "žádný", "zadny", "prázdný", "none", "nothing", "clear", "off", "nichts", "aufheben", "leeren", "keine");

export const selectUsage = () => tr("vyber F3 E2 V5 [přidat] · vyber Čep:F3 | #2:F3 | comp:Čep | \"feature:Díra 1\" | těleso · vyber nic · vyber (vypíše výběr)");

/** Id entity: F3 / E2 / V5 / těleso, s komponentou „Čep:F3“, nebo comp:Název / feature:Název. */
const ID = /^(?:(?:comp|component|komponenta|komponente|feature|prvek|element):.+|(?:.+:)?(?:[fev]\d+|těleso|teleso|body|körper|koerper|korper|solid))$/i;

/**
 * Rozbor příkazu `vyber …` (slova už rozdělená, uvozovky odstraněné); jiný příkaz → null.
 * Neznámé slovo skončí chybou s návodem – id se dál ověří proti modelu při provedení.
 */
export function parseSelectCommand(tokens: string[]): SelectCmd | null {
  const head = fold(tokens[0] ?? "");
  if (!SELECT_HEADS.has(head)) return null;
  // id oddělené mezerou, čárkou i středníkem (jako `promítnout hrany E3;E7`)
  const rest = tokens.slice(1).flatMap((t) => t.split(/[,;]/)).map((t) => t.trim()).filter(Boolean);
  if (!rest.length) return { kind: "selectShow" };
  if (rest.length === 1 && NONE_WORDS.has(fold(rest[0]))) return { kind: "selectClear" };
  const ids: string[] = [];
  let additive = false;
  for (const t of rest) {
    const w = fold(t);
    if (ADD_WORDS.has(w)) additive = true;
    else if (NONE_WORDS.has(w)) throw new Error(tr("vyber nic zruší výběr – bez dalších slov ({0})", selectUsage()));
    else if (ID.test(t)) ids.push(t);
    else throw new Error(tr("vyber: neznámé id „{0}“ – {1}", t, selectUsage()));
  }
  if (!ids.length) throw new Error(tr("vyber: chybí co vybrat – {0}", selectUsage()));
  return { kind: "select", ids, additive };
}

/**
 * Výběr nastavený textem / přes API, dokud ho aplikace nevykreslí (stav Reactu se projeví až po vykreslení) –
 * `selection()` hned po `select()` / `vyber nic` tak vrátí nový výběr.
 *
 * Čekající výběr platí, jen dokud má aplikace pořád tentýž stav jako při jeho nastavení (`base`). Jakmile se stav
 * změní – vykreslil se tento výběr, nebo ho už přepsal novější klik do modelu, Esc či formulář – platí zase stav
 * aplikace. Pojistka: po `ttlMs` vždy stav aplikace (aplikace výběr nepřevzala).
 *
 * Dřív se čekající výběr zrušil, jen když ho někdo přečetl právě ve chvíli, kdy stav byl tentýž seznam; jinak až
 * 2 s přebíjel i novější klik – `window.mncad.selection()` po kliku do 2 s od `vyber nic` vrátil prázdný výběr.
 */
export function pendingSelection<T>(ttlMs = 2000, now: () => number = Date.now) {
  let pending: { items: T; base: T; until: number } | null = null;
  return {
    /** výběr `items` nastavený přes API; `base` = stav aplikace v tu chvíli (nový výběr ještě nevykreslený) */
    set(base: T, items: T) {
      pending = { items, base, until: now() + ttlMs };
    },
    /** aktuální výběr ke stavu aplikace `state`: čekající, dokud se stav od nastavení nezměnil */
    current(state: T): T {
      if (pending && (state !== pending.base || now() > pending.until)) pending = null;
      return pending ? pending.items : state;
    },
  };
}
