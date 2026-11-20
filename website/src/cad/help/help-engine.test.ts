/**
 * Hledání v nápovědě a tahák cestou enginu (stejná smyčka v prohlížeči i v CLI): výpis `= L<n> help hits=N q="…"`
 * s výsledky jako pokračovacími řádky stručného protokolu (gramatika MNCAD/1, ≤ 2 kB), konzole prohlížeče má tytéž
 * řádky; `mncad help search|cheat` na příkazové řádce.
 */
import { afterEach, describe, expect, it } from "vitest";
import { memoryFileSink, memoryFileSource, type EngineHost } from "../engine/host";
import type { KernelApi } from "../engine/kernel";
import { MemoryWorkspace } from "../engine/memory-workspace";
import { formatFull, formatShort, GRAMMAR, utf8Bytes } from "../engine/protocol";
import { runScript } from "../engine/run";
import { setLang } from "../i18n";
import { AGENT_CHEATSHEET } from "../agent-cheatsheet";
import { cliHelpTopic } from "./cli-help";

const kernel = { generation: () => 1, build: async () => ({ status: [], mesh: null, metrics: null, ms: 1 }), asmParts: async () => [], stepSplit: async () => null } as unknown as KernelApi;
const host = (): EngineHost => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });

afterEach(() => setLang("cs"));

describe("engine: nápověda hledat / tahák", () => {
  it("výpis = L1 help hits=N q=\"…\" + řádky výsledků; stručný protokol ≤ 2 kB a podle gramatiky", async () => {
    const r = await runScript(new MemoryWorkspace(), "nápověda hledat záložky", host());
    const e = r.entries.find((x) => x.code === "help")!;
    expect(e).toMatchObject({ line: 1, level: "measure" });
    const [kv, ...rows] = String(e.text).split("\n");
    expect(kv).toMatch(/^hits=[5-8] q="záložky"$/);
    expect(rows[0]).toMatch(/^Hledání „záložky“ – [5-8] nejlepších výsledků/);
    expect(rows.slice(1).some((l) => /záložky|záložka/.test(l))).toBe(true);
    expect(r.counts.errors).toBe(0);
    const short = formatShort(r);
    expect(short).toMatch(/^= L1 help hits=[5-8] q="záložky"$/m);
    expect(short).toMatch(/^ {2}1\. /m);
    expect(utf8Bytes(short)).toBeLessThanOrEqual(2048);
    for (const l of short.split("\n")) expect(Object.values(GRAMMAR).some((re) => re.test(l)), l).toBe(true);
    // konzole prohlížeče (window.mncad.run, konzole v CADu): tentýž strojový řádek jako stručný protokol a pod ním tytéž řádky
    const cons = String(r.console).split("\n");
    expect(cons[0]).toMatch(/^= L1 help hits=[5-8] q="záložky"$/);
    expect(cons[0]).toBe(short.split("\n").find((l) => l.startsWith("= L1 help")));
    expect(cons[1]).toMatch(/^Hledání „záložky“ – [5-8] nejlepších výsledků/);
    expect(cons.slice(1, rows.length + 1)).toEqual(rows);
  });
  it("recenze: víc hledání v jednom běhu – každé má svůj řádek = L<n> help a výsledky; stručný protokol ≤ 2 kB bez přetečení", async () => {
    const r = await runScript(new MemoryWorkspace(), "nápověda hledat záložky\nnápověda hledat pružina mezi díly\nnápověda hledat kusovník", host());
    const short = formatShort(r);
    expect(utf8Bytes(short)).toBeLessThanOrEqual(2048);
    expect(short).not.toContain("protocol-full.txt");
    for (const l of short.split("\n")) expect(Object.values(GRAMMAR).some((re) => re.test(l)), l).toBe(true);
    const heads = short.split("\n").filter((l) => l.startsWith("= "));
    expect(heads).toHaveLength(3);
    expect(heads[0]).toMatch(/^= L1 help hits=[2-6] of=[5-8] q="záložky"$/);
    expect(heads[1]).toMatch(/^= L2 help hits=[2-6] of=[5-8] q="pružina mezi díly"$/);
    expect(heads[2]).toMatch(/^= L3 help hits=[2-6] of=[5-8] q="kusovník"$/);
    // pod každým řádkem = jeho výsledky od 1., bez řádku záhlaví
    const at = (n: number) => short.split("\n").indexOf(heads[n]);
    for (const n of [0, 1, 2]) expect(short.split("\n")[at(n) + 1]).toMatch(/^ {2}1\. /);
    expect(short).toMatch(/`záložky`/);
    expect(short).toMatch(/sestava pružina/);
    expect(short).toMatch(/`kusovník/);
    // celé odpovědi (5–8 výsledků se záhlavím) zůstávají v plném protokolu a v konzoli prohlížeče
    const full = formatFull(r);
    for (const q of ["záložky", "pružina mezi díly", "kusovník"]) expect(full).toMatch(new RegExp(`^ {2}Hledání „${q}“ – [5-8] nejlepších výsledků`, "m"));
    expect(String(r.console).match(/^= L\d help hits=[5-8] q=/gm)).toHaveLength(3);
  });
  it("recenze: mnoho hledání v jednom běhu – řádek = L<n> help má každé, i když se výsledky nevejdou", async () => {
    const qs = ["záložky", "kusovník", "kolize", "závit", "díra", "pružina", "výkres", "razítko", "motor", "odkaz", "export step", "přísně", "měřit", "tolerance"];
    const r = await runScript(new MemoryWorkspace(), qs.map((q) => `nápověda hledat ${q}`).join("\n"), host());
    const short = formatShort(r);
    expect(utf8Bytes(short)).toBeLessThanOrEqual(2048);
    expect(short.split("\n").filter((l) => /^= L\d+ help hits=\d/.test(l))).toHaveLength(qs.length);
    expect(short).toMatch(/^… \d+ entries \d+B in protocol-full\.txt$/m);
  });
  it("recenze: dlouhý dotaz (350+ B) – řádek = L1 help s dotazem zkráceným na 80 B a výsledky ve stručném protokolu", async () => {
    const q = "jak mám v sestavě nástroje vložit sedmdesát dílů z otevřených záložek tak aby každý měl svou přezdívku a vazby ".repeat(4).trim();
    const r = await runScript(new MemoryWorkspace(), `nápověda hledat ${q}`, host());
    const short = formatShort(r);
    expect(short).toMatch(/^= L1 help hits=[5-8] q="jak mám v sestavě[^"]{20,90}…"$/m);
    expect(short).toMatch(/^ {2}1\. /m);
    expect(short).not.toContain("protocol-full.txt");
    expect(utf8Bytes(short)).toBeLessThanOrEqual(2048);
    const big = await runScript(new MemoryWorkspace(), `nápověda hledat ${"sestava záložky kusovník ".repeat(280)}`, host());
    expect(utf8Bytes(formatShort(big))).toBeLessThanOrEqual(2048);
    expect(formatShort(big)).toMatch(/^= L1 help hits=[5-8] q="sestava záložky kusovník/m);
  });
  it("nápověda <slova> (slovo není typ prvku) hledá; v dokumentu výpis nemá název dokumentu", async () => {
    const r = await runScript(new MemoryWorkspace(), "nový díl Deska\nkvádr 10 10 10\nnápověda pružina mezi díly", host());
    expect(formatShort(r)).toMatch(/^= L3 help hits=\d q="pružina mezi díly"$/m);
  });
  it("EN / DE: jazyk běhu", async () => {
    setLang("en");
    const en = await runScript(new MemoryWorkspace(), "help search tabs", host());
    expect(formatShort(en)).toMatch(/^= L1 help hits=\d q="tabs"\n {2}Search “tabs”/m);
    setLang("de");
    const de = await runScript(new MemoryWorkspace(), "hilfe suchen stückliste", host());
    expect(formatShort(de)).toMatch(/^= L1 help hits=\d q="stückliste"\n {2}Suche „stückliste“/m);
  });
  it("nápověda tahák: = L1 help cheat=cs bytes=N, celý tahák v konzoli", async () => {
    const r = await runScript(new MemoryWorkspace(), "nápověda tahák", host());
    const e = r.entries.find((x) => x.code === "help")!;
    expect(String(e.text).split("\n")[0]).toMatch(/^cheat=cs bytes=\d+$/);
    expect(r.console).toContain("# Tahák pro AI agenty");
    expect(r.console).toContain("nová sestava");
    expect(r.console).toContain("## Přísný režim a nápověda"); // konzole: celý tahák
    // stručný protokol CLI: výpis s kv, začátek taháku (záložky) a odkaz na celý; ≤ 2 kB bez přetečení, celý text v detail
    const short = formatShort(r);
    expect(short).toMatch(/^= L1 help cheat=cs bytes=\d+$/m);
    expect(short).toContain("zavřít záložku");
    expect(short).toMatch(/^ {2}… celý tahák \(\d+ B\): mncad help cheat · https:\/\/www\.mnastrojarna\.cz\/cad\/tahak\.md/m);
    expect(short).not.toContain("protocol-full.txt");
    expect(utf8Bytes(short)).toBeLessThanOrEqual(2048);
    for (const l of short.split("\n")) expect(Object.values(GRAMMAR).some((re) => re.test(l)), l).toBe(true);
    expect(String(e.detail)).toBe(AGENT_CHEATSHEET.cs.split("\n").filter((l) => l.trim()).join("\n"));
  });
  it("EN tahák: anglický začátek a odkaz na tahak.en.md", async () => {
    setLang("en");
    const r = await runScript(new MemoryWorkspace(), "help cheatsheet", host());
    const short = formatShort(r);
    expect(short).toMatch(/^= L1 help cheat=en bytes=\d+\n {2}# Cheat sheet for AI agents/m);
    // `mncad help cheat` bez --lang vypíše český tahák – odkaz v anglickém běhu proto říká --lang en
    expect(short).toMatch(/full cheat sheet \(\d+ B\): mncad help cheat --lang en · https:\/\/www\.mnastrojarna\.cz\/cad\/tahak\.en\.md/);
    expect(String(r.console).split("\n")[0]).toMatch(/^= L1 help cheat=en bytes=\d+$/);
    expect(utf8Bytes(short)).toBeLessThanOrEqual(2048);
  });
  it("prvek nápověda <typ> beze změny (výpis lines=N)", async () => {
    const r = await runScript(new MemoryWorkspace(), "prvek nápověda kužel", host());
    expect(r.entries.find((x) => x.code === "help")?.text).toMatch(/^lines=\d+\nKužel \(cone\)/);
  });
});

describe("CLI: mncad help cheat | search <slova>", () => {
  it("tahák a hledání jako prostý text", () => {
    const text = (topic: string[], lang: "cs" | "en" | "de") => {
      const r = cliHelpTopic(topic, lang);
      return "text" in r ? r.text : `✗ ${r.error}`;
    };
    expect(text(["cheat"], "cs")).toBe(AGENT_CHEATSHEET.cs.split("\n").filter((l) => l.trim()).join("\n"));
    expect(text(["tahák"], "cs")).toMatch(/^# Tahák pro AI agenty/);
    expect(text(["search", "přezdívka"], "cs")).toMatch(/^Hledání „přezdívka“ – [5-8] nejlepších výsledků[^\n]*\n1\. /);
    expect(text(["kusovník"], "cs")).toMatch(/^Hledání „kusovník“/);
    // recenze: `mncad help search` bez slov = jasná chyba „chybí slova“ (ne „neznámé téma search“)
    expect(cliHelpTopic(["search"], "cs")).toEqual({ error: expect.stringMatching(/^mncad help search: chybí slova – např\. mncad help search záložky/) });
    expect(JSON.stringify(cliHelpTopic(["hledat"], "cs"))).not.toMatch(/neznámé téma/);
    setLang("en");
    expect(text(["search", "strict", "mode"], "en")).toMatch(/^Search “strict mode”/);
    expect(text(["cheat"], "en")).toMatch(/^# Cheat sheet for AI agents/);
    expect(text(["search"], "en")).toMatch(/^✗ mncad help search: words missing/);
  });
});
