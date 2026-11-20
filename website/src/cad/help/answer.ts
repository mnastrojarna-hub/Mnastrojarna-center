/**
 * Odpověď na `nápověda hledat …` a `nápověda tahák` (engine – prohlížeč i CLI – a `mncad help search|cheat`):
 *
 *   hledání: 5–8 nejlepších oddílů (návod pro AI, tabulka příkazů, příručka, tahák), každý na jednom řádku = název oddílu
 *   + odpovídající příkazy + 1–2 věty; celkem ≤ 1,5 kB (UTF-8), v jazyce běhu. Strojová část výpisu `=`:
 *   `hits=<N> q="<dotaz>"` (stručný protokol: `= L3 help hits=6 q="záložky"` + řádky výsledků jako pokračovací řádky);
 *   dotaz je v ní zkrácený na 80 B jako v záhlaví. Víc hledání v jednom běhu si stručný protokol dělí (`shareBudget`):
 *   každé má méně výsledků bez řádku záhlaví a `hits=3 of=8` říká, kolik by jich bylo samostatně (všechny jsou v plném
 *   protokolu a v konzoli prohlížeče).
 *   tahák: celý tahák jazyka běhu, strojová část `cheat=<jazyk> bytes=<N>`.
 */
import type { HelpRequest } from "../agent-help";
import { AGENT_CHEATSHEET } from "../agent-cheatsheet";
import { quote } from "../engine/protocol";
import { tr, type CadLang } from "../i18n";
import { helpIndex, type HelpChunk } from "./search-corpus";
import { clipBytes, SearchIndex, utf8Len, type SearchHit } from "./search-core";

/** nejvýš bajtů výpisu výsledků (záhlaví + řádky výsledků, UTF-8 včetně konců řádků) */
export const HELP_BUDGET = 1536;
const MIN_HITS = 5;
const MAX_HITS = 8;
/** nejvýš bajtů dotazu v záhlaví a ve strojové části `q="…"` */
const Q_MAX = 80;
/** místo pro všechna hledání jednoho běhu ve stručném protokolu, řádek `= L<n> help hits=… q="…"` a nejmenší díl jednoho hledání */
const SHARE_TOTAL = 1700;
const SHARE_HEAD = 60;
const SHARE_MIN = 150;

export type HelpSection = { key: string; score: number; chunk: HelpChunk; terms: Set<string> };
/** `short` = řádky do strojové části výpisu (stručný protokol ≤ 2 kB), když se celá odpověď nevejde (tahák); jinak `lines` */
export type HelpAnswer = { kv: string; lines: string[]; sections: HelpSection[]; short?: string[] };

/** nejlepší oddíly pro dotaz (seskupené úseky; skóre oddílu = nejlepší úsek + 0,2 × druhý) */
export function searchSections(q: string, lang: CadLang, limit = MAX_HITS): HelpSection[] {
  const hits = helpIndex(lang).search(q, 400);
  const by = new Map<string, { best: SearchHit<HelpChunk>; second: number }>();
  for (const h of hits) {
    const k = h.doc.data.key;
    const g = by.get(k);
    if (!g) by.set(k, { best: h, second: 0 });
    else if (!g.second) g.second = h.score;
  }
  const secs = [...by.entries()].map(([key, g]) => ({ key, score: g.best.score + 0.2 * g.second, chunk: g.best.doc.data, terms: g.best.terms }));
  secs.sort((a, b) => b.score - a.score);
  // stejné příkazy z tabulky příkazů a z tabulky návodu jen jednou; z jedné tabulky (řádky `…#r<n>`) nejvýš 2 výsledky;
  // z taháku nejvýš 2 oddíly (příkaz `záložka "…"` je v několika oddílech souvislého příkladu)
  const seen = new Set<string>();
  const perTable = new Map<string, number>();
  const out: HelpSection[] = [];
  let cheat = 0;
  for (const s of secs) {
    const sig = s.chunk.cmds.slice(0, 1).join("").replace(/\s+/g, " ").slice(0, 40);
    if (s.chunk.src !== "docs" && s.chunk.src !== "cheat" && sig && seen.has(sig)) continue;
    if (s.chunk.src === "cheat" && ++cheat > 2) continue;
    const table = s.key.replace(/#r\d+$/, "");
    const n = perTable.get(table) ?? 0;
    if (table !== s.key && n >= 2) continue;
    perTable.set(table, n + 1);
    if (sig) seen.add(sig);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

const SRC_TAG = (c: HelpChunk): string => (c.src === "guide" ? tr("návod") : c.src === "cmd" ? tr("tabulka příkazů") : c.src === "docs" ? `${tr("příručka")} #${c.anchor}` : tr("tahák"));

/** příkazy úseku, které odpovídají dotazu (nejvýš `max`, v pořadí úseku); když žádný neodpovídá, první příkazy úseku */
function pickCmds(c: HelpChunk, terms: Set<string>, max: number): string[] {
  const scored = c.cmds.map((x, i) => ({ x, i, n: SearchIndex.matchesIn(x, terms) }));
  const hit = scored.filter((s) => s.n > 0).sort((a, b) => b.n - a.n || a.i - b.i);
  const pick = (hit.length ? hit : scored).slice(0, max).sort((a, b) => a.i - b.i);
  return pick.map((s) => s.x);
}

function pickSentence(text: string, terms: Set<string>): string {
  const parts = text.split(/(?<=[.;!?])\s+|\s+·\s+/).filter((p) => p.trim());
  if (!parts.length) return "";
  let best = 0;
  let bestN = -1;
  parts.forEach((p, i) => {
    const n = SearchIndex.matchesIn(p, terms);
    if (n > bestN) {
      best = i;
      bestN = n;
    }
  });
  let s = parts[best];
  if (s.length < 70 && parts[best + 1]) s += ` ${parts[best + 1]}`;
  return s.replace(/^[\s–·:-]+/, "");
}

/** dlouhý nadpis bez závorky na konci („Řádkové příkazy (česky i anglicky, …)“ → „Řádkové příkazy“) */
const shortTitle = (t: string) => (t.length > 48 && / \(/.test(t) ? t.slice(0, t.indexOf(" (")) : t);

/** název oddílu v jazyce běhu (nadpisy návodu a kapitoly příručky mají překlad, podnadpisy zůstanou) */
function sectionTitle(c: HelpChunk, lang: CadLang): string {
  if (c.src === "cmd") return tr("Příkaz");
  if (c.src === "cheat") return `${tr("Tahák")} › ${c.title}`;
  const t = shortTitle(tr(c.title));
  return c.sub && (lang === "cs" || c.src === "guide") ? `${t} › ${shortTitle(c.sub)}` : t;
}

function hitLine(i: number, s: HelpSection, lang: CadLang, cap: number): string {
  const c = s.chunk;
  const cmdCap = Math.max(50, Math.floor(cap * 0.45));
  // tahák: řádek = mnoho hotových příkazů – vypíší se ty, které odpovídají dotazu (až 3)
  const picked = pickCmds(c, s.terms, c.src === "cheat" ? 3 : 2);
  let cmds = picked.map((x) => `\`${clipBytes(x, cmdCap)}\``);
  if (c.src === "cmd" && lang !== "cs" && c.words) cmds = [`\`${clipBytes(c.words[lang], cmdCap)}\``, ...cmds.slice(0, 1)];
  const title = sectionTitle(c, lang);
  const head = `${i}. ${title ? `${title} ` : ""}[${SRC_TAG(c)}]${cmds.length ? ": " : ""}${cmds.join(" · ")}`;
  // věta tahák jen tehdy, když sama odpovídá dotazu („další vložení = další instance“); jinde vždy
  let sent = pickSentence(c.text, s.terms);
  if (c.src === "cheat" && !SearchIndex.matchesIn(sent, s.terms)) sent = "";
  // věta, která začíná vypsaným příkazem („`kusovník [csv]` – kusovník [csv] – tabulka…“), ho neopakuje
  for (const x of picked) if (sent.startsWith(x)) sent = sent.slice(x.length).replace(/^[\s–·:;,-]+/, "");
  const room = cap - utf8Len(head) - 3;
  return room >= 30 && sent ? `${head} – ${clipBytes(sent, room)}` : clipBytes(head, cap);
}

/** záhlaví výpisu v jazyce běhu – počet podle pravidel jazyka (1 výsledek · 2–4 výsledky · 5 a víc výsledků) */
function headerLine(q: string, n: number): string {
  const s = clipBytes(q, Q_MAX);
  if (n === 1) return tr("Hledání „{0}“ – 1 nejlepší výsledek (návod pro AI, příkazy, příručka):", s);
  if (n < 5) return tr("Hledání „{0}“ – {1} nejlepší výsledky (návod pro AI, příkazy, příručka):", s, n);
  return tr("Hledání „{0}“ – {1} nejlepších výsledků (návod pro AI, příkazy, příručka):", s, n);
}

/**
 * řádky odpovědi hledání (≤ `budget` bajtů). `compact` = jedno z více hledání téhož běhu: bez řádku záhlaví (dotaz a počet
 * jsou ve strojové části), výsledků jen kolik se vejde (aspoň jeden) a `of=<N>` = kolik by jich bylo samostatně.
 */
export function searchAnswer(q: string, lang: CadLang, budget = HELP_BUDGET, o: { compact?: boolean } = {}): HelpAnswer {
  const all = searchSections(q, lang, MAX_HITS);
  // dotaz ve strojové části zkrácený jako v záhlaví – dlouhá otázka nesmí odpověď vytlačit ze stručného protokolu
  const kvOf = (n: number, of = n) => `hits=${n}${of > n ? ` of=${of}` : ""} q=${quote(clipBytes(q, Q_MAX))}`;
  if (!all.length) return { kv: kvOf(0), lines: [tr("Hledání „{0}“: nic nenalezeno – zkuste jiné nebo kratší slovo, „nápověda tahák“ (nejčastější příkazy) nebo „prvek nápověda“ (typy prvků).", clipBytes(q, Q_MAX))], sections: [] };
  const top = all[0].score;
  let n = all.filter((s) => s.score >= top * 0.25).length;
  n = Math.min(all.length, Math.max(MIN_HITS, Math.min(MAX_HITS, n)));
  const wanted = n;
  for (let cap = 260; ; cap -= 20) {
    const secs = all.slice(0, n);
    const lines = [...(o.compact ? [] : [headerLine(q, secs.length)]), ...secs.map((s, i) => hitLine(i + 1, s, lang, cap))];
    const bytes = lines.reduce((a, l) => a + utf8Len(l) + 1, 0);
    if (bytes <= budget) return { kv: kvOf(secs.length, o.compact ? wanted : secs.length), lines, sections: secs };
    if (cap <= 120) {
      if (n > 1) {
        n--;
        cap = 280;
      } else return { kv: kvOf(1, o.compact ? wanted : 1), lines: lines.map((l) => clipBytes(l, Math.max(60, Math.floor(budget / lines.length) - 1))), sections: secs };
    }
  }
}

/**
 * Rozpočet jedné odpovědi, když je v běhu `count` hledání: jedno hledání má celý HELP_BUDGET (5–8 výsledků), víc hledání
 * si dělí místo stručného protokolu (2 kB bez hlavičky, Σ a řádku D) rovným dílem – každé má svůj řádek `= L<n> help …`
 * a aspoň jeden výsledek.
 */
export function shareBudget(count: number): number {
  if (count <= 1) return HELP_BUDGET;
  return Math.max(SHARE_MIN, Math.floor(SHARE_TOTAL / count) - SHARE_HEAD);
}

/** nejvýš bajtů začátku taháku ve stručném protokolu (úvod + Dokumenty a záložky), zbytek odkazem */
export const CHEAT_SHORT_BUDGET = 1200;
const CHEAT_FILE: Record<CadLang, string> = { cs: "tahak.md", en: "tahak.en.md", de: "tahak.de.md" };

/**
 * tahák v jazyce běhu: konzole prohlížeče a `mncad help cheat` celý (`lines`), stručný protokol CLI jen začátek po celých
 * řádcích (≤ CHEAT_SHORT_BUDGET – úvod, protokol, záložky) a řádek, kde je celý (`short`; celý text je v `detail`)
 */
export function cheatAnswer(lang: CadLang): HelpAnswer {
  const text = AGENT_CHEATSHEET[lang];
  const lines = text.split("\n").filter((l) => l.trim());
  const short: string[] = [];
  let n = 0;
  for (const l of lines) {
    if (n + utf8Len(l) + 1 > CHEAT_SHORT_BUDGET) break;
    short.push(l);
    n += utf8Len(l) + 1;
  }
  // `mncad help cheat` bez --lang vypíše český tahák – odkaz proto nese jazyk běhu
  if (short.length < lines.length) short.push(tr("… celý tahák ({0} B): mncad help cheat{2} · https://www.mnastrojarna.cz/cad/{1} · plný protokol (--full, --json)", utf8Len(text), CHEAT_FILE[lang], lang === "cs" ? "" : ` --lang ${lang}`));
  return { kv: `cheat=${lang} bytes=${utf8Len(text)}`, lines, sections: [], short };
}

/** odpověď na požadavek z rozboru (`nápověda hledat …`, `nápověda tahák`) */
export function helpAnswer(req: HelpRequest, lang: CadLang): HelpAnswer {
  return req.mode === "cheat" ? cheatAnswer(lang) : searchAnswer(req.q, lang);
}
