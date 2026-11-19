"use client";

/**
 * Hledání na stránce dokumentace (/cad/dokumentace, /en/cad/documentation, /de/cad/dokumentation) – jen v prohlížeči,
 * bez serveru: rejstřík z odstavců, položek, řádků tabulek a ukázek kódu na stránce (help/search-core.ts – stejné jádro
 * jako `nápověda hledat` v CADu: bez diakritiky, kmeny, začátek slova, překlep, synonyma cs/en/de z help/glossary.ts).
 * Výsledky = oddíly (kapitola › podnadpis) s úryvkem; Enter / klik skočí na nejlepší místo oddílu, nalezená slova se
 * zvýrazní, obsah vlevo ztlumí kapitoly bez výsledku a „Jen nalezené kapitoly“ skryje ostatní. Klávesy: `/` nebo Ctrl+K
 * (⌘K) = do pole, šipky, Enter, Esc. Odkaz `?q=slovo` otevře stránku s hledáním.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HELP_GLOSSARY } from "@/cad/help/glossary";
import { foldText, SearchIndex, stem, type SearchHit } from "@/cad/help/search-core";

type Locale = "cs" | "en" | "de";
const L = {
  cs: {
    ph: "Hledat v dokumentaci…",
    aria: "Hledat v dokumentaci",
    keys: "/ nebo Ctrl+K",
    none: "Nic nenalezeno – zkuste jiné nebo kratší slovo.",
    found: (n: number) => `${n} ${n === 1 ? "oddíl" : n < 5 ? "oddíly" : "oddílů"}`,
    only: "Jen nalezené kapitoly",
    clear: "Vymazat",
  },
  en: {
    ph: "Search this page…",
    aria: "Search the documentation",
    keys: "/ or Ctrl+K",
    none: "Nothing found on this page – the complete manual (Czech) has more.",
    found: (n: number) => `${n} section${n === 1 ? "" : "s"}`,
    only: "Matching sections only",
    clear: "Clear",
  },
  de: {
    ph: "Auf dieser Seite suchen…",
    aria: "Dokumentation durchsuchen",
    keys: "/ oder Strg+K",
    none: "Auf dieser Seite nichts gefunden – das vollständige Handbuch (Tschechisch) enthält mehr.",
    found: (n: number) => `${n} Abschnitt${n === 1 ? "" : "e"}`,
    only: "Nur Abschnitte mit Treffern",
    clear: "Löschen",
  },
} as const;

/** úsek textu stránky: element, oddíl (kapitola), její kotva, název kapitoly, podnadpis a text */
type Block = { el: HTMLElement; section: HTMLElement; id: string; title: string; sub: string; text: string };
/** výsledek = oddíl (kapitola › podnadpis) s nejlepším úsekem */
type Result = { key: string; block: Block; score: number; terms: Set<string>; snippet: string; count: number };

const BLOCKS = "p, li, tr, pre, figcaption, aside, h3, dt, dd, summary";
const MARK = "rounded-sm bg-amber-200/80 px-0.5 text-inherit";
const MAX_RESULTS = 8;

/** úseky textu stránky (blok = nejmenší prvek s textem, který není uvnitř jiného bloku; h3 = podnadpis následujících) */
function collect(root: Element, sectionSel: string): Block[] {
  const out: Block[] = [];
  root.querySelectorAll<HTMLElement>(sectionSel).forEach((section, si) => {
    const id = section.id || `sekce-${si + 1}`;
    const h2 = section.querySelector<HTMLElement>("h2");
    const title = (h2?.textContent ?? "").trim();
    let sub = "";
    section.querySelectorAll<HTMLElement>(BLOCKS).forEach((el) => {
      if (el.tagName === "H3") {
        sub = (el.textContent ?? "").trim();
        return;
      }
      if (el.parentElement?.closest(BLOCKS)) return; // blok v bloku (li > p)
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text) out.push({ el, section, id, title, sub, text });
    });
    if (h2 && title) out.push({ el: h2, section, id, title, sub: "", text: title });
  });
  return out;
}

/** věta úseku s nejvíc nalezenými slovy (zkrácená) */
function snippetOf(text: string, terms: Set<string>): string {
  const parts = text.split(/(?<=[.;!?])\s+/);
  let best = parts[0] ?? "";
  let n = -1;
  for (const p of parts) {
    const c = SearchIndex.matchesIn(p, terms);
    if (c > n) {
      n = c;
      best = p;
    }
  }
  return best.length > 200 ? `${best.slice(0, 197)}…` : best;
}

/** zvýrazní slova úseku, jejichž kmen je mezi nalezenými (nejvýš `budget` značek); vrátí počet značek */
function markTerms(el: HTMLElement, terms: Set<string>, budget: number): number {
  if (budget <= 0) return 0;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  let used = 0;
  for (const node of nodes) {
    const s = node.nodeValue ?? "";
    const parts: (string | { w: string })[] = [];
    let last = 0;
    for (const m of s.matchAll(/[\p{L}\p{N}]+/gu)) {
      const f = foldText(m[0]);
      if (f.length < 2 || !(terms.has(stem(f)) || terms.has(f))) continue;
      if (m.index! > last) parts.push(s.slice(last, m.index));
      parts.push({ w: m[0] });
      last = m.index! + m[0].length;
      if (++used >= budget) break;
    }
    if (!parts.length) continue;
    if (last < s.length) parts.push(s.slice(last));
    const frag = document.createDocumentFragment();
    for (const p of parts) {
      if (typeof p === "string") frag.append(p);
      else {
        const mk = document.createElement("mark");
        mk.className = MARK;
        mk.dataset.docHit = "1";
        mk.textContent = p.w;
        frag.append(mk);
      }
    }
    node.replaceWith(frag);
    if (used >= budget) break;
  }
  return used;
}

function clearMarks(root: Element) {
  root.querySelectorAll("mark[data-doc-hit]").forEach((m) => {
    const parent = m.parentNode;
    m.replaceWith(document.createTextNode(m.textContent ?? ""));
    parent?.normalize();
  });
}

const STICKY = "sticky top-[76px] z-30 -mx-2 mb-8 rounded-2xl bg-white/95 px-2 py-2 shadow-[0_1px_0_rgba(39,36,37,0.08)] backdrop-blur";

/**
 * Pole hledání nad stránkou dokumentace. `root` = obal stránky, `sections` = oddíly uvnitř (id = kotva, první h2 = název),
 * `toc` = seznam odkazů obsahu (`a[href="#id"]`), který se podle výsledků ztlumí.
 */
export function DocsSearch({ locale = "cs", root = "article.doc", sections = "section.doc-section[id]", toc, className = STICKY }: { locale?: Locale; root?: string; sections?: string; toc?: string; className?: string }) {
  const t = L[locale];
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState(false);
  const [only, setOnly] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  /** pole hledání nahoru (pod hlavičku), ať je seznam výsledků vidět – po `/`, Ctrl+K a zaměření pole níž na stránce */
  const bringUp = useCallback(() => {
    const top = box.current?.getBoundingClientRect().top ?? 0;
    if (top > window.innerHeight * 0.35) window.scrollTo({ top: window.scrollY + top - 90, behavior: "instant" }); // web má scroll-behavior: smooth
  }, []);
  /** zavření seznamu po opuštění pole (zpožděné kvůli kliku do seznamu); nové zaměření nebo psaní ho zruší */
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keepOpen = () => {
    clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const index = useRef<{ ix: SearchIndex<Block>; blocks: Block[] } | null>(null);

  const ensureIndex = useCallback(() => {
    if (index.current) return index.current;
    const r = document.querySelector(root);
    const blocks = r ? collect(r, sections) : [];
    index.current = { blocks, ix: new SearchIndex(blocks.map((b) => ({ fields: { title: `${b.title} ${b.sub}`, body: b.text }, data: b })), HELP_GLOSSARY) };
    return index.current;
  }, [root, sections]);

  // výsledky: oddíly (kapitola › podnadpis), nejlepší úsek oddílu
  const run = useCallback(
    (query: string) => {
      if (!query.trim()) return setResults(null);
      const hits: SearchHit<Block>[] = ensureIndex().ix.search(query, 300);
      const by = new Map<string, Result>();
      for (const h of hits) {
        const b = h.doc.data;
        const key = `${b.id}|${b.sub}`;
        const g = by.get(key);
        if (g) {
          g.count++;
          for (const x of h.terms) g.terms.add(x);
        } else by.set(key, { key, block: b, score: h.score, terms: new Set(h.terms), snippet: snippetOf(b.text, h.terms), count: 1 });
      }
      setResults([...by.values()].sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS));
      setSel(0);
    },
    [ensureIndex],
  );

  useEffect(() => {
    const id = setTimeout(() => run(q), 120);
    return () => clearTimeout(id);
  }, [q, run]);

  // zvýraznění, obsah a filtr kapitol podle výsledků
  const hitSections = useMemo(() => new Set((results ?? []).map((r) => r.block.id)), [results]);
  useEffect(() => {
    const r = document.querySelector(root);
    if (!r) return;
    clearMarks(r);
    if (results?.length) {
      const all = new Set<string>();
      for (const x of results) for (const s of x.terms) all.add(s);
      let budget = 400;
      for (const b of index.current?.blocks ?? []) {
        if (budget <= 0) break;
        if (hitSections.has(b.id) && SearchIndex.matchesIn(b.text, all) > 0) budget -= markTerms(b.el, all, budget);
      }
    }
    r.querySelectorAll<HTMLElement>(sections).forEach((s, i) => {
      const id = s.id || `sekce-${i + 1}`;
      s.style.display = results && only && !hitSections.has(id) ? "none" : "";
      s.dataset.searchHit = results ? (hitSections.has(id) ? "1" : "0") : "";
    });
    if (toc)
      document.querySelectorAll<HTMLAnchorElement>(`${toc} a[href^="#"]`).forEach((a) => {
        const miss = !!results && !hitSections.has(a.getAttribute("href")!.slice(1));
        a.style.opacity = miss ? "0.3" : "";
        a.dataset.searchHit = results && !miss ? "1" : "";
      });
  }, [results, only, hitSections, root, sections, toc]);

  const jump = useCallback((res: Result | undefined) => {
    if (!res) return;
    const el = res.block.el;
    el.closest("details")?.setAttribute("open", ""); // odpověď FAQ ve sbaleném <details>
    const top = el.getBoundingClientRect().top + window.scrollY - 200; // pod lepící hlavičkou a polem hledání
    // plynule jen na krátkou vzdálenost (dlouhý plynulý posun přeruší psaní / zaměření pole a nedojede); „instant“ i přes
    // scroll-behavior: smooth webu
    window.scrollTo({ top: Math.max(0, top), behavior: Math.abs(top - window.scrollY) > 2 * window.innerHeight ? "instant" : "smooth" });
    if (res.block.section.id) history.replaceState(null, "", `#${res.block.section.id}`);
    el.dataset.searchJump = "1";
    el.classList.add("ring-2", "ring-amber-300", "rounded");
    setTimeout(() => {
      el.classList.remove("ring-2", "ring-amber-300", "rounded");
      delete el.dataset.searchJump;
    }, 2200);
    setOpen(false);
  }, []);

  // klávesy: „/“ (mimo pole) a Ctrl+K / ⌘K = do pole
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement | null;
      const typing = !!tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName));
      if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey) && !e.altKey) {
        e.preventDefault();
        input.current?.focus({ preventScroll: true });
        input.current?.select();
        bringUp();
      } else if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        input.current?.focus({ preventScroll: true });
        bringUp();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bringUp]);

  // ?q=… v adrese
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("q");
    if (p) {
      setQ(p);
      setOpen(true);
    }
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      keepOpen();
      setSel((s) => Math.min((results?.length ?? 1) - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      jump(results?.[sel]);
    } else if (e.key === "Escape") {
      if (q) setQ("");
      else input.current?.blur();
      setOpen(false);
    }
  };

  const showList = open && !!results;
  return (
    <div role="search" ref={box} className={className} data-docs-search>
      {/* nadpisy pod lepícím polem hledání (skok z obsahu i z výsledků) */}
      <style>{`${root} h2, ${root} h3 { scroll-margin-top: 10rem; }`}</style>
      <div className="relative">
        <div className="flex items-center gap-2 rounded-xl border border-ink-700/15 bg-white px-3 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
          <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink-700/45" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={input}
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              keepOpen();
            }}
            onFocus={() => {
              ensureIndex();
              keepOpen();
              bringUp();
            }}
            onKeyDown={onKeyDown}
            onBlur={() => {
              clearTimeout(closeTimer.current);
              closeTimer.current = setTimeout(() => setOpen(false), 150);
            }}
            placeholder={t.ph}
            aria-label={t.aria}
            aria-controls="docs-search-results"
            aria-expanded={showList}
            aria-activedescendant={showList && results!.length ? `docs-search-opt-${sel}` : undefined}
            role="combobox"
            aria-autocomplete="list"
            className="h-11 min-w-0 flex-1 bg-transparent text-[15px] text-ink-700 outline-none placeholder:text-ink-700/40 [&::-webkit-search-cancel-button]:hidden"
          />
          {results && (
            <span className="shrink-0 text-[12px] text-ink-700/55" data-docs-search-count>
              {results.length ? t.found(results.length) : "0"}
            </span>
          )}
          {q ? (
            <button type="button" onClick={() => setQ("")} className="shrink-0 rounded-md px-2 py-1 text-[12px] text-ink-700/60 hover:bg-ink-700/5" aria-label={t.clear}>
              ✕
            </button>
          ) : (
            <kbd className="hidden shrink-0 rounded border border-ink-700/15 px-1.5 py-0.5 font-mono text-[11px] text-ink-700/50 sm:inline">{t.keys}</kbd>
          )}
        </div>
        {results && (
          <label className="mt-1.5 flex items-center gap-2 px-1 text-[12px] text-ink-700/60">
            <input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} className="accent-brand" data-docs-search-only />
            {t.only}
          </label>
        )}
        {showList && (
          <ul id="docs-search-results" role="listbox" className="absolute inset-x-0 top-full z-10 mt-1 max-h-[60vh] overflow-y-auto rounded-xl border border-ink-700/10 bg-white p-1 shadow-xl">
            {results!.length === 0 && <li className="px-3 py-2 text-[14px] text-ink-700/60">{t.none}</li>}
            {results!.map((r, i) => (
              <li
                key={r.key}
                id={`docs-search-opt-${i}`}
                role="option"
                aria-selected={i === sel}
                data-docs-search-result={r.block.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  jump(r);
                }}
                onMouseEnter={() => setSel(i)}
                className={`cursor-pointer rounded-lg px-3 py-2 ${i === sel ? "bg-brand/10" : "hover:bg-ink-700/5"}`}
              >
                <p className="text-[13px] font-semibold text-ink-700">
                  {r.block.title}
                  {r.block.sub && <span className="font-normal text-ink-700/60"> › {r.block.sub}</span>}
                  {r.count > 1 && <span className="ml-2 font-normal text-ink-700/40">×{r.count}</span>}
                </p>
                <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-ink-700/70">{r.snippet}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
