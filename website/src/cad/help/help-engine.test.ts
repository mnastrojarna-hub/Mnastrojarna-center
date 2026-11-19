/**
 * Hledání v nápovědě a tahák cestou enginu (stejná smyčka v prohlížeči i v CLI): výpis `= L<n> help hits=N q="…"`
 * s výsledky jako pokračovacími řádky stručného protokolu (gramatika MNCAD/1, ≤ 2 kB), konzole prohlížeče má tytéž
 * řádky; `mncad help search|cheat` na příkazové řádce.
 */
import { afterEach, describe, expect, it } from "vitest";
import { memoryFileSink, memoryFileSource, type EngineHost } from "../engine/host";
import type { KernelApi } from "../engine/kernel";
import { MemoryWorkspace } from "../engine/memory-workspace";
import { formatShort, GRAMMAR, utf8Bytes } from "../engine/protocol";
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
    // konzole prohlížeče: tytéž řádky (bez strojové části)
    expect(r.console).toContain("Hledání „záložky“");
    expect(r.console).not.toContain("hits=");
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
    expect(short).toMatch(/full cheat sheet \(\d+ B\): mncad help cheat · https:\/\/www\.mnastrojarna\.cz\/cad\/tahak\.en\.md/);
    expect(utf8Bytes(short)).toBeLessThanOrEqual(2048);
  });
  it("prvek nápověda <typ> beze změny (výpis lines=N)", async () => {
    const r = await runScript(new MemoryWorkspace(), "prvek nápověda kužel", host());
    expect(r.entries.find((x) => x.code === "help")?.text).toMatch(/^lines=\d+\nKužel \(cone\)/);
  });
});

describe("CLI: mncad help cheat | search <slova>", () => {
  it("tahák a hledání jako prostý text", () => {
    expect(cliHelpTopic(["cheat"], "cs")).toBe(AGENT_CHEATSHEET.cs.split("\n").filter((l) => l.trim()).join("\n"));
    expect(cliHelpTopic(["tahák"], "cs")).toMatch(/^# Tahák pro AI agenty/);
    expect(cliHelpTopic(["search", "přezdívka"], "cs")).toMatch(/^Hledání „přezdívka“ – [5-8] nejlepších výsledků[^\n]*\n1\. /);
    expect(cliHelpTopic(["kusovník"], "cs")).toMatch(/^Hledání „kusovník“/);
    setLang("en");
    expect(cliHelpTopic(["search", "strict", "mode"], "en")).toMatch(/^Search “strict mode”/);
    expect(cliHelpTopic(["cheat"], "en")).toMatch(/^# Cheat sheet for AI agents/);
    expect(cliHelpTopic(["search"], "cs")).toBeNull();
  });
});
