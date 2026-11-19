/**
 * Hledání v nápovědě (`nápověda hledat …`, help/answer.ts): jádro (slova, kmeny, překlepy), rejstřík ze tří zdrojů a hodnocení
 * na skutečných otázkách agenta – správný oddíl musí být mezi prvními třemi výsledky u ≥ 90 % otázek (cs, bez diakritiky,
 * s překlepy, en, de). Výstup ≤ 1,5 kB, 5–8 výsledků, strojová část `hits=N q="…"`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { parseAgentText, type AgentOp } from "../agent";
import { dictOf, setLang, tr, type CadLang } from "../i18n";
import { AGENT_COMMANDS } from "../agent";
import { cheatAnswer, HELP_BUDGET, searchAnswer, searchSections } from "./answer";
import { editDistance, foldText, SearchIndex, stem, utf8Len, words } from "./search-core";
import { commandChunks, docsChunks, guideChunks, helpIndex, textIn } from "./search-corpus";

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
