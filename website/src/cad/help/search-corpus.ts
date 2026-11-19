/**
 * Rejstřík nápovědy pro `nápověda hledat …`: úseky ze tří zdrojů a taháku –
 *
 *   návod pro AI (AGENT_GUIDE, Markdown): řádek tabulky, odstavec, položka seznamu; blok kódu patří k odstavci před ním;
 *     oddíl = ## / ### nadpis + tučný úvod odstavce („**Pružina v sestavě** …“)
 *   tabulka příkazů (AGENT_COMMANDS): jeden řádek = jeden úsek (syntaxe, anglická a německá slova, popis v jazyce běhu)
 *   příručka (CAD_DOCS, /cad/dokumentace): odstavec, položka seznamu, řádek tabulky; oddíl = kapitola + podnadpis
 *   tahák v jazyce běhu (AGENT_CHEATSHEET): řádek pod nadpisem
 *
 * Rejstřík se staví jednou pro jazyk (popisy příkazů a tahák závisí na jazyce) a drží se v paměti.
 */
import { AGENT_COMMANDS } from "../agent";
import { AGENT_CHEATSHEET } from "../agent-cheatsheet";
import { AGENT_GUIDE } from "../agent-guide";
import { dictOf, type CadLang } from "../i18n";
import { CAD_DOCS } from "@/content/cad-docs";
import { HELP_GLOSSARY } from "./glossary";
import { foldText, SearchIndex, type SearchDoc } from "./search-core";

export type HelpSrc = "guide" | "cmd" | "docs" | "cheat";
export type HelpChunk = {
  src: HelpSrc;
  /** oddíl (seskupení výsledků): `guide:<nadpis>[/<podnadpis>]`, `cmd:<i>`, `docs:<kapitola>[/<podnadpis>]`, `cheat:<nadpis>` */
  key: string;
  /** název oddílu (česky; zobrazení přeloží `tr`) */
  title: string;
  /** tučný úvod odstavce / podnadpis příručky */
  sub?: string;
  /** kotva kapitoly příručky (`/cad/dokumentace#<kotva>`) */
  anchor?: string;
  /** příkazy / ukázky v úseku */
  cmds: string[];
  /** prostý text úseku */
  text: string;
  /** řádek tabulky příkazů: slova v jazyce běhu */
  words?: { en: string; de: string };
};

/** slug oddílu (bez diakritiky, a-z0-9 a pomlčky) */
export const slug = (s: string): string =>
  foldText(s)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

const plain = (s: string) =>
  s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\\\|/g, "|")
    .replace(/\s+/g, " ")
    .trim();
const spans = (s: string) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1].replace(/\\\|/g, "|").trim()).filter((x) => x.length >= 2 && /[\p{L}]/u.test(x));
const headingText = (s: string) => plain(s.replace(/^#+\s*/, ""));

/** buňky řádku Markdown tabulky – `|` uvnitř `kódu` a `\|` buňky nedělí */
function tableCells(line: string): string[] {
  const t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const out: string[] = [];
  let cur = "";
  let code = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === "\\" && t[i + 1] === "|") {
      cur += "\\|";
      i++;
    } else if (ch === "`") {
      code = !code;
      cur += ch;
    } else if (ch === "|" && !code) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** úseky návodu pro AI */
export function guideChunks(md: string = AGENT_GUIDE): HelpChunk[] {
  const out: HelpChunk[] = [];
  let h2 = "";
  let h3 = "";
  let sub = "";
  let para: string[] = [];
  let code: string[] | null = null;
  let row = 0;
  const title = () => h3 || h2;
  const key = () => `guide:${slug(h2)}${h3 ? `/${slug(h3)}` : ""}${sub ? `/${slug(sub)}` : ""}`;
  const flush = () => {
    if (!para.length) return;
    const raw = para.join(" ").trim();
    para = [];
    if (!raw) return;
    const lead = /^\*\*(.+?)\*\*/.exec(raw);
    if (lead && plain(lead[1]).length <= 70) sub = plain(lead[1]).replace(/[.:]$/, "");
    out.push({ src: "guide", key: key(), title: title(), ...(sub ? { sub } : {}), cmds: spans(raw), text: plain(raw.replace(/^(?:[-*]|\d+\.)\s+/, "")) });
  };
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      if (code) {
        const cmds = code.map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !l.startsWith("//"));
        const comments = code
          .map((l) => /(?:^|\s)#\s+(.*)$/.exec(l)?.[1] ?? "")
          .filter(Boolean)
          .join(" ");
        const prev = out[out.length - 1];
        if (prev && prev.key === key() && !prev.key.includes("#r")) {
          prev.cmds.push(...cmds);
          if (comments) prev.text += ` ${comments}`;
        } else if (cmds.length) out.push({ src: "guide", key: key(), title: title(), ...(sub ? { sub } : {}), cmds, text: comments });
        code = null;
      } else {
        flush();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    if (/^#\s/.test(line)) continue;
    if (/^##\s/.test(line)) {
      flush();
      h2 = headingText(line);
      h3 = "";
      sub = "";
      continue;
    }
    if (/^###\s/.test(line)) {
      flush();
      h3 = headingText(line);
      sub = "";
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (/^\s*\|/.test(line)) {
      flush();
      const cells = tableCells(line);
      if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue;
      if (/^\s*\|\s*:?-{3,}/.test(lines[i + 1] ?? "")) continue; // záhlaví tabulky
      row++;
      const [first, ...rest] = cells;
      const cmds = spans(first);
      out.push({ src: "guide", key: `${key()}#r${row}`, title: title(), ...(sub ? { sub } : {}), cmds: cmds.length ? cmds : [plain(first)], text: plain(rest.join(" – ")) });
      continue;
    }
    // položka seznamu a řádek začínající tučným úvodem („**Výběr oknem** …“) začínají nový úsek
    if (/^\s*>/.test(line) && !h2) continue; // úvodní odkaz na tahák a hledání (návod o návodu) se nehledá
    if (/^\s*(?:[-*]\s+|\d+\.\s+|\*\*)/.test(line)) flush();
    para.push(line.replace(/^\s*>\s?/, "").trim());
  }
  flush();
  return out;
}

/** překlad → český zdrojový text (obrácené slovníky EN / DE, staví se jednou) */
const reverse = new Map<"en" | "de", Map<string, string>>();
function sourceOf(text: string): string {
  for (const l of ["en", "de"] as const) if (dictOf(l)[text] !== undefined) return text; // už je to český zdroj
  for (const l of ["en", "de"] as const) {
    let m = reverse.get(l);
    if (!m) {
      m = new Map();
      for (const [k, v] of Object.entries(dictOf(l))) if (!m.has(v)) m.set(v, k);
      reverse.set(l, m);
    }
    const k = m.get(text);
    if (k !== undefined) return k;
  }
  return text;
}

/**
 * Text přeložený voláním `tr()` při načtení modulu (popisy AGENT_COMMANDS) v jazyce `lang` – nezávisle na tom, v jakém
 * jazyce se modul načetl (prohlížeč /en/cad, vlákno `mncad run`, hlavní vlákno `mncad help` se liší pořadím načtení a
 * nastavení jazyka; rejstřík i výsledky pak musí být všude stejné).
 */
export function textIn(text: string, lang: CadLang): string {
  const src = sourceOf(text);
  return lang === "cs" ? src : (dictOf(lang)[src] ?? text);
}

/** úseky tabulky příkazů (popis v jazyce běhu) */
export function commandChunks(lang: CadLang): HelpChunk[] {
  return AGENT_COMMANDS.map((c, i) => ({ src: "cmd", key: `cmd:${i}`, title: "", cmds: c.cmd.split(" · ").map((x) => x.trim()), text: textIn(c.desc, lang), words: { en: c.en, de: c.de } }));
}

/** úseky příručky /cad/dokumentace */
export function docsChunks(): HelpChunk[] {
  const out: HelpChunk[] = [];
  for (const s of CAD_DOCS) {
    let sub = "";
    const push = (raw: string) => {
      if (!raw.trim()) return;
      out.push({ src: "docs", key: `docs:${s.id}${sub ? `/${slug(sub)}` : ""}`, title: s.title, ...(sub ? { sub } : {}), anchor: s.id, cmds: spans(raw), text: plain(raw) });
    };
    if (s.lead) push(s.lead);
    for (const b of s.blocks) {
      if (b.t === "h3") sub = b.text;
      else if (b.t === "p" || b.t === "note") push(b.text);
      else if (b.t === "ul" || b.t === "ol") b.items.forEach(push);
      else if (b.t === "table") b.rows.forEach((r) => push(r.join(" – ")));
      else if (b.t === "kbd") b.rows.forEach(([k, v]) => push(`${k} – ${v}`));
    }
  }
  return out;
}

/** úseky taháku v jazyce běhu */
export function cheatChunks(lang: CadLang): HelpChunk[] {
  const out: HelpChunk[] = [];
  let h = "";
  for (const line of AGENT_CHEATSHEET[lang].split("\n")) {
    if (/^#\s/.test(line) || !line.trim()) continue;
    if (/^##\s/.test(line)) {
      h = headingText(line);
      continue;
    }
    if (!h) continue;
    out.push({ src: "cheat", key: `cheat:${slug(h)}`, title: h, cmds: spans(line), text: plain(line.replace(/`[^`]*`/g, " ")) });
  }
  return out;
}

/** priorita zdroje (agent chce hlavně příkazy; příručka popisuje hlavně ovládání myší) */
const BOOST: Record<HelpSrc, number> = { cmd: 1.15, guide: 1, cheat: 0.9, docs: 0.75 };

/** ukázky hledání v nápovědě („nápověda hledat záložky“) se nehledají – jinak by každý dotaz našel i sám sebe */
const HELP_EXAMPLE = /(?:nápověda|napoveda|help|hilfe) (?:hledat|search|suchen) [^·;,)–]*/gi;

function toDoc(c: HelpChunk): SearchDoc<HelpChunk> {
  const cmds = c.cmds.filter((x) => !new RegExp(HELP_EXAMPLE.source, "i").test(x));
  return {
    fields: { title: [c.title, c.sub ?? ""].join(" "), cmd: cmds.join(" · "), body: c.text.replace(HELP_EXAMPLE, " "), ...(c.words ? { kw: `${c.words.en} ${c.words.de}` } : {}) },
    boost: BOOST[c.src],
    data: c,
  };
}

const cache = new Map<CadLang, SearchIndex<HelpChunk>>();

/** rejstřík nápovědy pro jazyk běhu (staví se jednou) */
export function helpIndex(lang: CadLang): SearchIndex<HelpChunk> {
  let ix = cache.get(lang);
  if (!ix) {
    const chunks = [...commandChunks(lang), ...guideChunks(), ...cheatChunks(lang), ...docsChunks()];
    ix = new SearchIndex(chunks.map(toDoc), HELP_GLOSSARY);
    cache.set(lang, ix);
  }
  return ix;
}
