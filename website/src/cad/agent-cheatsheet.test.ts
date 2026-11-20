/**
 * Tahák pro agenty (agent-cheatsheet.ts): každý příkaz v `…` se v cs / en / de přečte bez chyby (žádný „neznámý příkaz“, žádná
 * chyba rozboru ani tiché varování), soubor ≤ 5 kB, pokrývá dnešní příkazy (záložky, sestava, přezdívka, vazby, díry, pružiny,
 * pohyb, výkres, 2D, výstupy a odkazy, kontrola, porovnání, přísný režim, hledání v nápovědě) a je na začátku návodu pro AI.
 * Rozbor nestačí (anglické „fix“ místo „fixed“ se přečetlo, ale díl nevložilo) – že příkazy taháku fungují za sebou jako
 * jeden skript, zkouší ve skutečném jádře agent-cheatsheet-kernel.test.ts; tady jen stavba souvislého příkladu.
 */
import { afterEach, describe, expect, it } from "vitest";
import { parseAgentText } from "./agent";
import { AGENT_CHEATSHEET, cheatCommands, cheatElsewhere, cheatSequence, type CheatLang } from "./agent-cheatsheet";
import { AGENT_GUIDE } from "./agent-guide";
import { setLang } from "./i18n";

afterEach(() => setLang("cs"));
const LANGS: CheatLang[] = ["cs", "en", "de"];
const bytes = (s: string) => new TextEncoder().encode(s).length;

describe("tahák pro agenty", () => {
  it.each(LANGS)("%s: každý příkaz se přečte bez chyby a bez varování", (lang) => {
    setLang(lang);
    const cmds = cheatCommands(lang);
    expect(cmds.length).toBeGreaterThan(60);
    const bad: string[] = [];
    for (const c of cmds) {
      const p = parseAgentText(c);
      if (p.errors.length || p.warnings?.length || !p.ops.length) bad.push(`${c} → ${p.errors.map((e) => e.message.slice(0, 120)).join(" | ")}${p.warnings?.length ? ` ⚠ ${JSON.stringify(p.warnings)}` : ""}`);
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });
  it.each(LANGS)("%s: ≤ 5 kB a stejné oddíly ve všech jazycích", (lang) => {
    expect(bytes(AGENT_CHEATSHEET[lang])).toBeLessThanOrEqual(5120);
    const heads = (l: CheatLang) => AGENT_CHEATSHEET[l].split("\n").filter((x) => x.startsWith("## ")).length;
    expect(heads(lang)).toBe(heads("cs"));
    expect(cheatCommands(lang).length).toBe(cheatCommands("cs").length);
  });
  it("pokrývá dnešní příkazy (cs)", () => {
    const t = AGENT_CHEATSHEET.cs;
    for (const w of ["záložky", "zavřít záložku", "vložit \"", "jako \"D1\"", "přezdívka \"K48\"", "sestava vazba souosost", "díra závit M8", "zahloubení", "sestava pružina nová", "pohyb motor", "pohyb dynamika", "výkres razítko", "kótovat chytře funkční", "2d čára", "export step", "sdílet", "odkaz", "kontrola sestava", "porovnat \"ref.step\"", "přísně", "nápověda hledat", "nápověda tahák", "mncad run", "--timeout", "--max-mem"])
      expect(t, w).toContain(w);
  });
  it.each(LANGS)("%s: souvislý příklad = příkazy v pořadí bez ukázek za „Jinde:“ a bez zástupných „…“; stejná stavba ve všech jazycích", (lang) => {
    const seq = cheatSequence(lang);
    const other = cheatElsewhere(lang);
    const all = cheatCommands(lang);
    expect(seq.length).toBeGreaterThan(70);
    expect(seq.length).toBe(cheatSequence("cs").length);
    expect(other.length).toBe(cheatElsewhere("cs").length);
    expect(other.length).toBeGreaterThan(10);
    // každý příkaz taháku je buď v souvislém příkladu, nebo ukázka za „Jinde:“, nebo má zástupné „…“
    expect([...seq, ...other, ...all.filter((c) => c.includes("…"))].sort()).toEqual([...all].sort());
    // příkazy, které do souvislého skriptu nepatří (zavírají záložku, vracejí běh, potřebují síť nebo vstupní soubor)
    for (const c of seq) expect(c, c).not.toMatch(/^(zavřít záložku|close tab|registerkarte schließen|zpět|undo|rückgängig)$/);
  });
  it("anglický tahák: ukotvení při vložení je „fixed“ (slovo „fix“ engine nezná – přilepil by ho k názvu dílu)", () => {
    expect(AGENT_CHEATSHEET.en).toContain('insert "Plate" at 0 0 0 fixed as "D1"');
    expect(AGENT_CHEATSHEET.en).not.toMatch(/ fix as /);
    const p = parseAgentText('insert "Plate" at 0 0 0 fixed as "D1"');
    expect(p.errors).toEqual([]);
    expect(p.ops[0]).toMatchObject({ k: "insert", tab: "Plate", fixed: true, alias: "D1" });
    // past, kterou rozbor sám nezachytí: „fix“ se přečte jako část názvu záložky
    expect(parseAgentText('insert "Plate" at 0 0 0 fix as "D1"').ops[0]).toMatchObject({ k: "insert", tab: "Plate fix", fixed: false });
  });
  it("návod pro AI odkazuje na tahák a na hledání hned na začátku", () => {
    const head = AGENT_GUIDE.slice(0, 900);
    expect(head).toMatch(/nápověda tahák/);
    expect(head).toMatch(/nápověda hledat/);
    expect(head).toMatch(/\/cad\/tahak\.md/);
  });
});
