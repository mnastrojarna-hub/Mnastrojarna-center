/**
 * Funkční prvky a základny v modelu (vlna 22, bod 18) – čistý rozbor textových příkazů (provedení engine/ops/functional.ts):
 *  - `funkční F7 [H7]` · `funkční "Díra 1" [H7]` · `funkční Díra 1 ±0,02` – plocha (F číslo) nebo prvek historie (název),
 *    volitelně předepsaná tolerance; kontrola kót pak u funkčního prvku chce velikost, polohu (od základny) a tuto toleranci;
 *  - `základna A F3` · `funkční základna A F3` – rovinná plocha jako základna (polohy funkčních prvků se kótují od ní);
 *  - `funkční` / `funkční seznam` – výpis; `funkční zrušit F7 | "Díra 1" | vše` · `základna zrušit A | vše`.
 * EN `functional F7 H7`, `functional datum A F3` (i `datum A F3`), `functional clear …`; DE `funktional F7 H7`, `bezug A F3`,
 * `funktional bezug A F3`, `funktional entfernen …`.
 *
 * Popisy ploch a oblastní úpravy v modelu (vlna 23, R2 / R3 – výkres je přebírá, cad/pmi-marks.ts):
 *  - `poznámka F7 "Brousit"` (EN `note F7 …`, DE `hinweis F7 …`) – krátký popis plochy; výkres = odkaz se šipkou / tečkou;
 *  - `úprava F7 tepelná "58+2 HRC" [od 0 do 25]` · `úprava F7 povrchová "černit"` (EN `treatment F7 heat|surface …
 *    [from 0 to 25]`, DE `behandlung F7 wärme|oberfläche … [von 0 bis 25]`) – výkres = tlustá čerchovaná čára 04.2 + kóta;
 *  - `poznámka zrušit F7|vše` · `úprava zrušit F7|Z1|vše`; `poznámka` / `úprava` samotné = výpis.
 */
import { tr } from "./i18n";

export type FunctionalCmd =
  | { kind: "list" }
  /** `target` = slova cíle a tolerance (název prvku může mít mezery – rozdělí je provedení podle názvů prvků dílu) */
  | { kind: "mark"; target: string[] }
  | { kind: "datum"; label: string; target: string[] }
  | { kind: "clear"; what: "functional" | "datum" | "note" | "treatment"; target: string[] | "all" }
  /** popis plochy v modelu (PMI) – výkres ho kreslí odkazovou čarou */
  | { kind: "note"; face: number; text: string }
  /** oblastní tepelná / povrchová úprava plochy (rozsah od–do v mm podél plochy v pohledu) */
  | { kind: "treatment"; face: number; what: "heat" | "surface"; text: string; from?: number; to?: number };

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const W = (...w: string[]) => new Set(w.map(fold));
const FUNC = W("funkční", "funkcni", "functional", "funktional", "funktion", "funktionsflache");
const DATUM = W("základna", "zakladna", "bezug", "bezugsflache");
const DATUM_EN = W("datum");
const LIST = W("seznam", "výpis", "list", "liste", "anzeigen");
const CLEAR = W("zrušit", "zrusit", "smazat", "odstranit", "clear", "remove", "delete", "entfernen", "löschen", "loschen", "aufheben");
const ALL = W("vše", "vse", "všechny", "all", "alle");
const NOTE_H = W("poznámka", "poznamka", "popis", "note", "hinweis", "notiz");
const TREAT_H = W("úprava", "uprava", "treatment", "behandlung");
const HEAT_W = W("tepelná", "tepelna", "tepelné", "tepelne", "kalení", "kaleni", "heat", "hardening", "wärme", "warme", "waerme", "härten", "harten");
const SURF_W = W("povrchová", "povrchova", "povrchové", "povrchove", "povrch", "surface", "coating", "oberfläche", "oberflache", "oberflaeche", "beschichtung");
const FROM_W = W("od", "from", "von");
const TO_W = W("do", "to", "bis");
const num = (s: string | undefined) => (s !== undefined && /^-?\d+(?:[.,]\d+)?$/.test(s) ? Number(s.replace(",", ".")) : NaN);

/** slova řádku: uvozovky drží název s mezerami pohromadě */
export function functionalTokens(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|„([^“”]*)[“”]|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** usage pro chybové hlášky */
export const functionalUsage = (): string => tr("funkční F7 [H7] · funkční \"Díra 1\" [±0,02] · základna A F3 · funkční [seznam] · funkční zrušit F7|\"Díra 1\"|vše · základna zrušit A|vše");

const isLetter = (s: string) => /^[A-Za-z]$/.test(s);
const isFace = (s: string) => /^F\d+$/i.test(s);

/** nápověda popisů a úprav modelu */
export const pmiUsage = (): string => tr("poznámka F7 \"Brousit\" · úprava F7 tepelná \"58+2 HRC\" [od 0 do 25] · úprava F7 povrchová \"černit\" · poznámka|úprava [seznam] · poznámka|úprava zrušit F7|vše");

/** `poznámka F7 "…"` / `úprava F7 …` (vlna 23) – null = jiný příkaz (hlavička nesedí nebo za ní není plocha / zrušit / nic) */
function parsePmiLine(t: string[]): FunctionalCmd | null {
  const h = fold(t[0]);
  const isNote = NOTE_H.has(h);
  if (!isNote && !TREAT_H.has(h)) return null;
  const rest = t.slice(1);
  if (!rest.length || (rest.length === 1 && LIST.has(fold(rest[0])))) return { kind: "list" };
  if (CLEAR.has(fold(rest[0]))) {
    const tg = rest.slice(1);
    if (!tg.length) throw new Error(tr("{0}: co zrušit? – {1}", t[0], pmiUsage()));
    return { kind: "clear", what: isNote ? "note" : "treatment", target: tg.length === 1 && ALL.has(fold(tg[0])) ? "all" : tg };
  }
  if (!isFace(rest[0])) return null;
  const face = Number(rest[0].slice(1)) - 1;
  if (isNote) {
    const text = rest.slice(1).join(" ").trim();
    if (!text) throw new Error(tr("poznámka: za plochou zadejte krátký popis v uvozovkách – {0}", pmiUsage()));
    return { kind: "note", face, text };
  }
  let i = 1;
  const w = fold(rest[i] ?? "");
  const what: "heat" | "surface" | null = HEAT_W.has(w) ? "heat" : SURF_W.has(w) ? "surface" : null;
  if (!what) throw new Error(tr("úprava: za plochou zadejte druh tepelná | povrchová – {0}", pmiUsage()));
  i++;
  const words: string[] = [];
  let from: number | undefined;
  let to: number | undefined;
  while (i < rest.length) {
    const f = fold(rest[i]);
    if (FROM_W.has(f) && !Number.isNaN(num(rest[i + 1]))) {
      from = num(rest[i + 1]);
      i += 2;
    } else if (TO_W.has(f) && !Number.isNaN(num(rest[i + 1]))) {
      to = num(rest[i + 1]);
      i += 2;
    } else words.push(rest[i++]);
  }
  const text = words.join(" ").trim();
  if (!text) throw new Error(tr("úprava: zadejte předpis v uvozovkách, např. úprava F7 tepelná \"58+2 HRC\" – {0}", pmiUsage()));
  if (from !== undefined && to !== undefined && !(to > from)) throw new Error(tr("úprava: rozsah od {0} do {1} – „do“ musí být větší než „od“ (mm podél plochy)", from, to));
  if ((from !== undefined && from < 0) || (to !== undefined && to <= 0)) throw new Error(tr("úprava: rozsah od / do v mm podél plochy (od 0)"));
  return { kind: "treatment", face, what, text, ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) };
}

/** řádek příkazu funkčních prvků / základen, jinak null (jiný příkaz) */
export function parseFunctionalLine(line: string): FunctionalCmd | null {
  const t = functionalTokens(line.trim());
  if (!t.length) return null;
  const pmi = parsePmiLine(t);
  if (pmi) return pmi;
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
  if (CLEAR.has(fold(rest[0]))) {
    const tg = rest.slice(1);
    if (!tg.length) throw new Error(tr("{0}: co zrušit? – {1}", t[0], functionalUsage()));
    return { kind: "clear", what: datum ? "datum" : "functional", target: tg.length === 1 && ALL.has(fold(tg[0])) ? "all" : tg };
  }
  if (datum) {
    if (rest.length !== 2 || !isLetter(rest[0]) || !isFace(rest[1])) throw new Error(tr("základna: písmeno a rovinná plocha, např. základna A F3 – {0}", functionalUsage()));
    return { kind: "datum", label: rest[0].toUpperCase(), target: [rest[1].toUpperCase()] };
  }
  return { kind: "mark", target: rest };
}

/** řádek AGENT_COMMANDS (agent.ts) */
export const PMI_COMMAND = {
  cmd: "poznámka F7 \"Brousit\" · úprava F7 tepelná \"58+2 HRC\" [od 0 do 25] · úprava F7 povrchová \"černit\" · poznámka|úprava zrušit F7|vše",
  en: "note F7 \"Grind\" / treatment F7 heat \"58+2 HRC\" from 0 to 25 / treatment F7 surface \"black oxide\" / note clear F7",
  de: "hinweis F7 \"Schleifen\" / behandlung F7 wärme \"58+2 HRC\" von 0 bis 25 / behandlung F7 oberfläche \"brüniert\" / hinweis entfernen F7",
};

export const FUNCTIONAL_COMMAND = {
  cmd: "funkční F7 [H7] · funkční \"Díra 1\" [±0,02] · základna A F3 · funkční [seznam] · funkční zrušit …",
  en: "functional F7 H7 / functional \"Hole 1\" ±0.02 / functional datum A F3 (datum A F3) / functional list / functional clear F7",
  de: "funktional F7 H7 / funktional \"Bohrung 1\" ±0,02 / bezug A F3 / funktional liste / funktional entfernen F7",
};
