/**
 * Hledání v nápovědě (`nápověda hledat …`, help/answer.ts): jádro (slova, kmeny, překlepy), rejstřík ze tří zdrojů a hodnocení
 * na skutečných otázkách agenta – správný oddíl musí být mezi prvními třemi výsledky u ≥ 90 % otázek (cs, bez diakritiky,
 * s překlepy, en, de). Výstup ≤ 1,5 kB, 5–8 výsledků, strojová část `hits=N q="…"`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAgentText, type AgentOp } from "../agent";
import { dictOf, setLang, tr, type CadLang } from "../i18n";
import { AGENT_COMMANDS } from "../agent";
import { cheatAnswer, HELP_BUDGET, searchAnswer, searchSections, shareBudget } from "./answer";
import { editDistance, foldText, SearchIndex, stem, utf8Len, words } from "./search-core";
import { cheatChunks, commandChunks, docsChunks, guideChunks, helpIndex, textIn } from "./search-corpus";
import { HELDOUT, HELDOUT2, HELDOUT3, HELDOUT4, REVIEW, TYPOS, type EvalQuestion } from "./search-questions";

afterEach(() => setLang("cs"));

describe("jádro hledání", () => {
  it("slova bez diakritiky a stop slov, kmeny, vzdálenost s prohozením", () => {
    expect(foldText("Záložky ŠROUB Größe Ø10")).toBe("zalozky sroub grosse o10");
    expect(words("jak vložit díl do sestavy")).toEqual(["vlozit", "dil", "sestavy"]);
    expect(stem("zalozky")).toBe(stem("zalozka"));
    expect(stem("zaoblit")).toBe(stem("zaobleni"));
    expect(stem("sestavy")).toBe(stem("sestava"));
    expect(stem("tabs")).toBe("tab");
    expect(stem("zavit")).toBe("zavit"); // podstatné jméno, ne sloveso
    expect(editDistance("kolise", "kolize")).toBe(1);
    expect(editDistance("sestvaa", "sestava")).toBe(1); // prohozená písmena
    expect(editDistance("abc", "xyz", 1)).toBe(2);
  });
  it("přesná shoda > začátek slova > překlep; synonyma ze skupiny glosáře", () => {
    const ix = new SearchIndex(
      [
        { fields: { title: "Záložky dokumentů", body: "výpis otevřených záložek" }, data: "tabs" },
        { fields: { title: "Kolize", body: "kontrola průniků" }, data: "clash" },
        { fields: { title: "Sestava", body: "vložit díl do sestavy jako komponentu" }, data: "asm" },
      ],
      [["záložka", "tab", "registerkarte"]],
    );
    expect(ix.search("zalozky")[0].doc.data).toBe("tabs");
    expect(ix.search("tabs")[0].doc.data).toBe("tabs"); // překlad z glosáře
    expect(ix.search("kolise")[0].doc.data).toBe("clash"); // překlep
    expect(ix.search("sestav")[0].doc.data).toBe("asm"); // začátek slova
    expect(ix.search("xyzzy")).toEqual([]);
  });
  it("recenze: německé „der“ a „die“ jsou stop slova jen v německém běhu (česky „děr“ = díry, anglicky „die“ = střižnice)", () => {
    expect(words("průměry děr")).toEqual(["prumery", "der"]);
    expect(words("cutting die", "en")).toEqual(["cutting", "die"]);
    expect(words("kante der platte", "de")).toEqual(["kante", "platte"]);
    // výplň otázek („jak / kolik … má / jinou“, „how many“, „wie viele“) se vynechá ve všech jazycích
    expect(words("jak přepnout na jinou záložku")).toEqual(["prepnout", "zalozku"]);
    expect(words("how many components in assembly")).toEqual(["components", "assembly"]);
  });
  it("recenze: kmen nespojí formát s formou ani „mezi“ s mezí", () => {
    expect(stem("format")).toBe("format");
    expect(stem(foldText("formátu"))).toBe("format");
    expect(stem("forma")).not.toBe(stem("format"));
    expect(stem("mezi")).toBe("mezi");
  });
  it("recenze: překlep má přednost před začátkem jiného slova („sestva“ není tvar slova „šest“), krátké slovo se opraví záměnou", () => {
    const ix = new SearchIndex([
      { fields: { title: "Sestava", body: "vložit díl do sestavy" }, data: "asm" },
      { fields: { body: "šest prvků rozšíření" }, data: "six" },
      { fields: { title: "Díra", body: "díra se závitem" }, data: "hole" },
    ]);
    expect(ix.search("sestva").map((h) => h.doc.data)).toEqual(["asm"]);
    expect(ix.search("dyra")[0]?.doc.data).toBe("hole");
    // tvar s delší koncovkou, který kmen neodřízne, se najde začátkem („sestavama“ → „sestav“)
    expect(ix.search("sestavama")[0]?.doc.data).toBe("asm");
  });
  it("recenze: víceslovné heslo glosáře je jedno slovo dotazu – jeho slova samostatně synonyma nejsou", () => {
    const ix = new SearchIndex(
      [
        { fields: { cmd: "kusovník", body: "tabulka kusů" }, data: "bom" },
        { fields: { cmd: "materiál ocel", body: "materials and density" }, data: "mat" },
      ],
      [["kusovník", "bom", "bill of materials"]],
    );
    expect(ix.search("bill of materials")[0].doc.data).toBe("bom");
    expect(ix.search("materials")[0].doc.data).toBe("mat");
    expect(ix.search("materials").map((h) => h.doc.data)).not.toContain("bom");
  });
  it("recenze: slovo, které něco pojmenovává (název, příkaz), váží v pokrytí dotazu víc než slova z vět", () => {
    const ix = new SearchIndex([
      { fields: { cmd: "záložka \"název\"", body: "otevřené dokumenty" }, data: "tabs" },
      { fields: { body: "Tab přepne na další pole a jinou hodnotu zamkne" }, data: "prose" },
    ]);
    // „přepnout“ a „další“ jsou jen ve větě druhého úseku, „záložku“ pojmenovává příkaz prvního
    expect(ix.search("přepnout další záložku")[0].doc.data).toBe("tabs");
  });
});

/** otázka → co musí být mezi prvními třemi oddíly (klíč oddílu nebo jeho příkazy) */
const EVAL: { q: string; lang?: CadLang; want: RegExp }[] = [
  // otázky ze zadání (zpráva agenta, bod 6 a 10)
  { q: "záložky", want: /zalozk|záložk/ },
  { q: "jak vložit díl do sestavy", want: /sestava-textem|vložit "|cheat:sestava|docs:sestavy/ },
  { q: "přezdívka", want: /prezdiv|přezdívka|jako "/ },
  { q: "export step", want: /export step|vystupy-z-konzole/ },
  { q: "odkaz", want: /sdílet|odkaz|sdileni|odkazy/ },
  { q: "pružina mezi díly", want: /pruzina-v|sestava pružina|pruziny/ },
  { q: "výběr oknem", want: /vyber-oknem|selectBox|výběr oknem/ },
  { q: "závit", want: /zavit|závit/ },
  { q: "zaoblit hrany svislé", want: /zaoblit/ },
  { q: "tolerance kóty", want: /tolerance/ },
  { q: "kusovník", want: /kusovník|kusovnik/ },
  { q: "kolize", want: /kolize|clash/ },
  { q: "motor", want: /pohyb motor/ },
  { q: "2d export dwg", want: /2d export dwg|docs:2d|guide:2d|export dwg/ },
  { q: "přísný režim", want: /prisny-rezim|přísně/ },
  // další otázky agenta při modelování nástroje
  { q: "díra se zahloubením", want: /zahloubení|zahloubeni/ },
  { q: "skica na ploše modelu", want: /skica plocha|skica-na-plose/ },
  { q: "měření vzdálenosti dvou ploch", want: /mereni|měřit/ },
  { q: "razítko výkresu", want: /razítko|razitko/ },
  { q: "plech ohyb", want: /plech/ },
  { q: "svar koutový", want: /svar koutový|svary-koutove/ },
  { q: "porovnat s referenčním step", want: /porovnat|porovnani/ },
  { q: "uložit soubor bez dialogu", want: /uložit|ulozit|vystupy-z-konzole/ },
  { q: "více těles v dílu", want: /vice-teles|těleso/ },
  { q: "proměnné a rovnice", want: /proměnná|promenne|parametry/ },
  { q: "šikmé vysunutí", want: /sikme-vysunuti/ },
  { q: "kruhové pole děr", want: /pole kruhové|pole-5-druhu|pole N/ },
  { q: "vazba souosost", want: /souosost/ },
  { q: "dynamika gravitace", want: /dynamika|gravitace/ },
  { q: "předloha dwg zákazníka", want: /predloha|předloha/ },
  { q: "zpět o krok", want: /zpět/ },
  { q: "výkres řez", want: /výkres řez|rez/ },
  { q: "kótovat funkční rozměry", want: /funkční|funkcni/ },
  { q: "export textový skript", want: /export skript|textovy-skript/ },
  { q: "příkazová řádka bez prohlížeče", want: /mncad|bez-prohlizece|cli/ },
  // bez diakritiky a s překlepy
  { q: "zalozky", want: /zalozk|záložk/ },
  { q: "kusovnik", want: /kusovník|kusovnik/ },
  { q: "prisny rezim", want: /prisny-rezim|přísně/ },
  { q: "pruzna mezi dily", want: /pruzina-v|sestava pružina|pruziny/ },
  { q: "závyt", want: /zavit|závit/ },
  { q: "kolise", want: /kolize|clash/ },
  // anglicky a německy (rozhraní /en/cad, /de/cad)
  { q: "tabs", lang: "en", want: /zalozk|záložk|tabs/ },
  { q: "insert part into assembly", lang: "en", want: /vložit|insert|sestava-textem|cheat:assembly/ },
  { q: "alias", lang: "en", want: /prezdiv|alias|jako "/ },
  { q: "strict mode", lang: "en", want: /prisny|strict/ },
  { q: "stückliste", lang: "de", want: /kusovník|stückliste|kusovnik/ },
  { q: "feder zwischen teilen", lang: "de", want: /pruzina|feder/ },
  { q: "registerkarten", lang: "de", want: /zalozk|registerkarte/ },
];

describe("hodnocení na otázkách agenta", () => {
  it(`správný oddíl v prvních třech u ≥ 90 % z ${EVAL.length} otázek`, () => {
    const miss: string[] = [];
    for (const e of EVAL) {
      setLang(e.lang ?? "cs");
      const top = searchSections(e.q, e.lang ?? "cs", 3);
      const ok = top.some((s) => e.want.test(`${s.key} ${s.chunk.cmds.join(" ")}`));
      if (!ok) miss.push(`${e.q} → ${top.map((s) => s.key).join(" | ")}`);
    }
    setLang("cs");
    const rate = 1 - miss.length / EVAL.length;
    expect(EVAL.length).toBeGreaterThanOrEqual(25);
    console.log(`hodnocení: ${EVAL.length - miss.length}/${EVAL.length} v prvních třech (${(rate * 100).toFixed(1)} %)${miss.length ? `; mimo: ${miss.join(" ; ")}` : ""}`);
    expect(rate, `mimo první tři:\n${miss.join("\n")}`).toBeGreaterThanOrEqual(0.9);
  });
  /** podíl otázek, u kterých je správný příkaz / věta v některém z prvních tří VYPSANÝCH řádků odpovědi */
  const rateOf = (set: EvalQuestion[]) => {
    const miss: string[] = [];
    for (const e of set) {
      const lang = e.lang ?? "cs";
      setLang(lang);
      const a = searchAnswer(e.q, lang);
      if (!a.lines.slice(1, 4).some((l) => e.want.test(l))) miss.push(`[${lang}] ${e.q} → ${a.lines.slice(1, 4).map((l) => l.slice(0, 90)).join(" | ")}`);
    }
    setLang("cs");
    return { rate: 1 - miss.length / set.length, miss };
  };
  it("recenze: nezávislé otázky (60 recenzních + 100 zadržených) – správný příkaz ve vypsaných prvních třech řádcích u ≥ 90 %", () => {
    const sets = { REVIEW, HELDOUT, HELDOUT2, HELDOUT3, HELDOUT4 };
    const out: string[] = [];
    let n = 0;
    let bad = 0;
    for (const [name, set] of Object.entries(sets)) {
      const r = rateOf(set);
      out.push(`${name} ${set.length - r.miss.length}/${set.length}`);
      n += set.length;
      bad += r.miss.length;
      // recenzní sada a všechny dohromady ≥ 90 %; jednotlivá zadržená sada (20–30 otázek) smí o jednu až dvě otázky kolísat
      expect(r.rate, `${name} mimo první tři:\n${r.miss.join("\n")}`).toBeGreaterThanOrEqual(name === "REVIEW" ? 0.9 : 0.85);
    }
    console.log(`hodnocení podle vypsaných řádků: ${out.join(" · ")} · celkem ${n - bad}/${n} (${((1 - bad / n) * 100).toFixed(1)} %)`);
    expect(n).toBe(160);
    expect(1 - bad / n).toBeGreaterThanOrEqual(0.9);
  });
  it("recenze: překlepy a tvary slov najdou správný oddíl (sestva, dyra, kusovnk, tolerence, zavyt, zalozkami…)", () => {
    const r = rateOf(TYPOS);
    expect(r.miss, r.miss.join("\n")).toEqual([]);
  });
  it("recenze: konkrétní otázky, které původně minuly – odpověď je v prvním vypsaném řádku", () => {
    const first = (q: string, lang: CadLang = "cs") => {
      setLang(lang);
      return searchAnswer(q, lang).lines[1];
    };
    expect(first("jak přepnout na jinou záložku")).toMatch(/`záložka "název"\|N`/);
    expect(first("kolik komponent má sestava")).toMatch(/`sestava`.*výpis komponent/);
    expect(first("jak zjistit průměry děr")).toMatch(/měřit díry/);
    setLang("cs");
    expect(searchAnswer("změnit rozměr kvádru", "cs").lines.slice(1, 4).join("\n")).toMatch(/`upravit /);
    expect(first("limit paměti a času")).toMatch(/`--timeout 300` · `--max-mem 2048`/);
    expect(first("bill of materials", "en")).toMatch(/`bom`/);
    expect(first("stückliste exportieren", "de")).toMatch(/`stückliste`/);
    // anglický / německý běh: první výsledek je v jazyce běhu (tabulka příkazů nebo tahák), ne český odstavec návodu
    expect(first("linear motor with collisions", "en")).toMatch(/\[(command table|cheat sheet)\]: `motion motor/);
    expect(first("feder zwischen teilen", "de")).toMatch(/\[(Befehlstabelle|Spickzettel)\]/);
    // český návod a příručka jsou v anglickém / německém běhu označené – agent ví, že věta řádku je česky
    setLang("en");
    const en = searchAnswer("strict mode warnings", "en").lines.slice(1);
    expect(en.filter((l) => /\[guide|\[manual/.test(l)).every((l) => /\[(guide|manual #[\w-]+), Czech\]/.test(l))).toBe(true);
    expect(en.some((l) => /\[(command table|cheat sheet)\]/.test(l))).toBe(true);
    setLang("cs");
    expect(searchAnswer("přísný režim", "cs").lines.join("\n")).not.toMatch(/česky\]/);
  });
  it("recenze: řádek výsledku ukazuje příkazy, které odpovídají dotazu; tahák i větu; věta neopakuje vypsaný příkaz", () => {
    const lines = (q: string) => searchAnswer(q, "cs").lines.slice(1);
    // tahák: příkazy odpovídající dotazu (ne první dva příkazy řádku) a věta, když sama odpovídá
    const cheat = lines("další instance záložky").find((l) => /\[tahák\]/.test(l));
    expect(cheat).toMatch(/`záložky` · `záložka "Deska"`.* – .*další vložení = další instance/);
    expect(cheat).not.toMatch(/Jinde/);
    expect(lines("zavřít záložku").find((l) => /\[tahák\]/.test(l))).toMatch(/`zavřít záložku`/);
    for (const l of lines("kusovník")) {
      const m = /`([^`]+)` – (.*)$/.exec(l);
      if (m) expect(m[2].startsWith(m[1]), l).toBe(false);
    }
  });
  it("recenze: záhlaví má správné množné číslo (1 výsledek · 2–4 výsledky · 5+ výsledků), v en / de také", () => {
    const head = (lang: CadLang, n: number) => {
      setLang(lang);
      // rozpočet na n řádků: kompaktní odpověď nemá záhlaví, proto přes dotaz s rozpočtem a kontrolu textu záhlaví
      const a = searchAnswer("kusovník", lang, n === 1 ? 200 : n === 3 ? 330 : 1536);
      return a.lines[0];
    };
    expect(head("cs", 1)).toMatch(/– 1 nejlepší výsledek \(/);
    expect(head("cs", 3)).toMatch(/– [2-4] nejlepší výsledky \(/);
    expect(head("cs", 8)).toMatch(/– [5-8] nejlepších výsledků \(/);
    expect(head("en", 1)).toMatch(/– 1 best result \(/);
    expect(head("en", 8)).toMatch(/– [5-8] best results \(/);
    expect(head("de", 1)).toMatch(/– 1 bester Treffer \(/);
    expect(head("de", 8)).toMatch(/– [5-8] beste Treffer \(/);
    expect(searchAnswer("sestva", "cs").lines[0]).not.toMatch(/ 1 nejlepších /);
    expect(searchAnswer("sestva", "cs").sections.length).toBeGreaterThanOrEqual(5);
  });
  it("recenze: dlouhý dotaz – strojová část i záhlaví mají dotaz zkrácený na 80 B, odpověď ≤ 1,5 kB", () => {
    const q = "jak mám v sestavě nástroje vložit sedmdesát dílů z otevřených záložek tak aby každý měl svou přezdívku a vazby ".repeat(4).trim();
    expect(utf8Len(q)).toBeGreaterThan(350);
    const a = searchAnswer(q, "cs");
    expect(utf8Len(a.kv)).toBeLessThan(120);
    expect(a.kv).toMatch(/^hits=[5-8] q="jak mám v sestavě[^"]*…"$/);
    expect(a.lines.reduce((n, l) => n + utf8Len(l) + 1, 0)).toBeLessThanOrEqual(HELP_BUDGET);
    expect(utf8Len(searchAnswer("q".repeat(7000), "cs").lines.join("\n"))).toBeLessThan(400);
  });
  it("recenze: víc hledání v jednom běhu – rozpočet se dělí, kompaktní odpověď bez záhlaví a s of=N", () => {
    expect(shareBudget(1)).toBe(HELP_BUDGET);
    expect(shareBudget(2)).toBeLessThan(HELP_BUDGET / 1.5);
    expect(3 * (shareBudget(3) + 60)).toBeLessThanOrEqual(1750);
    expect(shareBudget(50)).toBeGreaterThanOrEqual(150);
    const a = searchAnswer("pružina mezi díly", "cs", shareBudget(3), { compact: true });
    expect(a.kv).toMatch(/^hits=[1-4] of=[5-8] q="pružina mezi díly"$/);
    expect(a.lines[0]).toMatch(/^1\. /);
    expect(a.lines.reduce((n, l) => n + utf8Len(l) + 1, 0)).toBeLessThanOrEqual(shareBudget(3));
  });
  it("recenze: řádky tabulek příručky jsou samostatné výsledky; úvod taháku (příkazová řádka) je v rejstříku", () => {
    expect(docsChunks().filter((c) => /#r\d+$/.test(c.key)).length).toBeGreaterThan(100);
    expect(cheatChunks("cs").some((c) => c.key === "cheat:uvod" && c.cmds.includes("--max-mem 2048"))).toBe(true);
  });
  it("každá otázka vrátí 5–8 výsledků ≤ 1,5 kB a strojovou část hits=N q=\"…\"", () => {
    for (const e of EVAL) {
      setLang(e.lang ?? "cs");
      const a = searchAnswer(e.q, e.lang ?? "cs");
      const bytes = a.lines.reduce((n, l) => n + utf8Len(l) + 1, 0);
      expect(bytes, e.q).toBeLessThanOrEqual(HELP_BUDGET);
      expect(a.sections.length, e.q).toBeGreaterThanOrEqual(5);
      expect(a.sections.length, e.q).toBeLessThanOrEqual(8);
      expect(a.lines.length, e.q).toBe(a.sections.length + 1);
      expect(a.kv, e.q).toBe(`hits=${a.sections.length} q="${e.q}"`);
      for (const [i, l] of a.lines.slice(1).entries()) expect(l.startsWith(`${i + 1}. `), l).toBe(true);
    }
  });
  it("rejstřík se staví jednou a hledání je rychlé", () => {
    helpIndex("cs");
    const t0 = performance.now();
    for (const e of EVAL.slice(0, 15)) searchSections(e.q, "cs");
    expect((performance.now() - t0) / 15).toBeLessThan(50);
  });
  it("názvy oddílů návodu a kapitol příručky mají překlad EN / DE (výsledky v jazyce běhu)", () => {
    const titles = [...new Set([...guideChunks(), ...docsChunks()].map((c) => c.title).filter(Boolean))];
    expect(titles.length).toBeGreaterThan(50);
    for (const lang of ["en", "de"] as const) {
      setLang(lang);
      expect(titles.filter((t) => tr(t) === t), lang).toEqual([]);
    }
  });
  it("popisy tabulky příkazů v jazyce běhu bez ohledu na jazyk, ve kterém se načetl agent.ts (prohlížeč = mncad run = mncad help)", () => {
    const key = AGENT_COMMANDS.find((c) => /záložky/.test(c.desc))!.desc; // v testu se agent.ts načetl česky
    const en = dictOf("en")[key];
    const de = dictOf("de")[key];
    expect(en && de).toBeTruthy();
    for (const loaded of [key, en, de]) {
      expect(textIn(loaded, "cs")).toBe(key);
      expect(textIn(loaded, "en")).toBe(en);
      expect(textIn(loaded, "de")).toBe(de);
    }
    expect(commandChunks("en").find((c) => c.text === en)).toBeTruthy();
    expect(textIn("bez překladu xyz", "en")).toBe("bez překladu xyz");
  });
  it("každý popis tabulky příkazů je jeden klíč slovníku (složený popis z více tr() by v EN / DE měl jiný text podle jazyka načtení modulu)", () => {
    // fáze 2 vlny 22: dva složené popisy (nový díl … znovu, řez … čelo řezu) dávaly v anglickém rejstříku podle pořadí načtení
    // jiný text – `mncad help search tabs` a `mncad run "help search tabs"` pak řadily 6. a 7. výsledek opačně
    const bad = AGENT_COMMANDS.filter((c) => !dictOf("en")[c.desc] || !dictOf("de")[c.desc]).map((c) => c.desc.slice(0, 80));
    expect(bad).toEqual([]);
  });
  it("pořadí výsledků nezávisí na jazyce, ve kterém se načetl agent.ts (en tabs: CLI help = mncad run = prohlížeč)", async () => {
    const run = async (loadLang: CadLang) => {
      vi.resetModules();
      const i = await import("../i18n");
      i.setLang(loadLang);
      const a = await import("./answer");
      i.setLang("en");
      return a.searchSections("tabs", "en").map((s) => `${s.key} ${s.score.toFixed(9)}`);
    };
    const cs = await run("cs");
    const en = await run("en");
    vi.resetModules();
    expect(cs.length).toBeGreaterThanOrEqual(5);
    expect(en).toEqual(cs);
  });
  it("nic nenalezeno → hits=0 a rada", () => {
    const a = searchAnswer("qqqxxyzz", "cs");
    expect(a.kv).toBe('hits=0 q="qqqxxyzz"');
    expect(a.lines[0]).toMatch(/nic nenalezeno.*nápověda tahák/);
  });
  it("výstup v jazyce běhu (záhlaví, druh zdroje, anglická slova příkazu)", () => {
    setLang("en");
    const a = searchAnswer("tabs", "en");
    expect(a.lines[0]).toMatch(/^Search “tabs” – \d+ best results/);
    expect(a.lines.join("\n")).toMatch(/\[(guide|command table|manual|cheat sheet)/);
    expect(a.lines.join("\n")).toMatch(/`tabs, tab, close tab`|`tabs`/);
    setLang("de");
    expect(searchAnswer("registerkarten", "de").lines[0]).toMatch(/^Suche „registerkarten“/);
  });
});

describe("rozbor: nápověda hledat / nápověda <slova> / tahák", () => {
  const op = (t: string) => {
    const p = parseAgentText(t);
    expect(p.errors, t).toEqual([]);
    return p.ops[0] as Extract<AgentOp, { k: "info" }>;
  };
  it("CS / EN / DE, bez slova „hledat“ jen když slovo není typ prvku", () => {
    expect(op("nápověda hledat záložky").help).toEqual({ mode: "search", q: "záložky" });
    expect(op("help search tabs").help).toEqual({ mode: "search", q: "tabs" });
    expect(op("hilfe suchen registerkarten").help).toEqual({ mode: "search", q: "registerkarten" });
    expect(op('nápověda hledat "pružina mezi díly"').help).toEqual({ mode: "search", q: "pružina mezi díly" });
    expect(op("nápověda záložky").help).toEqual({ mode: "search", q: "záložky" });
    expect(op("nápověda pružina mezi díly").help).toEqual({ mode: "search", q: "pružina mezi díly" });
    expect(op("? kolize").help).toEqual({ mode: "search", q: "kolize" });
    // typ prvku zůstává nápovědou polí (jako dřív)
    expect(op("nápověda díra").help).toBeUndefined();
    expect(op("nápověda díra").lines[0]).toMatch(/^Díra \(hole\)/);
    expect(op("nápověda díra").lines.at(-1)).toMatch(/nápověda hledat díra/);
    expect(op("help pružina").lines[0]).toMatch(/\(spring\)/);
    expect(op("prvek nápověda kužel").lines[0]).toMatch(/\(cone\)/);
    expect(op("nápověda").lines.at(-1)).toMatch(/nápověda hledat <slova>/);
  });
  it("tahák: nápověda tahák · help cheatsheet · hilfe spickzettel", () => {
    for (const t of ["nápověda tahák", "napoveda tahak", "help cheatsheet", "help cheat", "hilfe spickzettel"]) expect(op(t).help, t).toEqual({ mode: "cheat", q: "" });
    expect(cheatAnswer("cs").kv).toMatch(/^cheat=cs bytes=\d+$/);
    expect(cheatAnswer("en").lines[0]).toMatch(/^# Cheat sheet for AI agents/);
  });
  it("prvek nápověda <neznámé> zůstává chybou (jen typy), s radou na hledání; nápověda hledat bez slov = chyba", () => {
    expect(parseAgentText("prvek nápověda xyz").errors[0].message).toMatch(/^nápověda: neznámý typ prvku „xyz“ – typy: sketch, extrude.* · hledání v návodu: nápověda hledat xyz$/);
    expect(parseAgentText("nápověda hledat").errors[0].message).toMatch(/nápověda hledat: chybí slova/);
  });
});
