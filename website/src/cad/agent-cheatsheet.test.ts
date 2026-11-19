/**
 * Tahák pro agenty (agent-cheatsheet.ts): každý příkaz v `…` se v cs / en / de přečte bez chyby (žádný „neznámý příkaz“, žádná
 * chyba rozboru ani tiché varování), soubor ≤ 5 kB, pokrývá dnešní příkazy (záložky, sestava, přezdívka, vazby, díry, pružiny,
 * pohyb, výkres, 2D, výstupy a odkazy, kontrola, porovnání, přísný režim, hledání v nápovědě) a je na začátku návodu pro AI.
 */
import { afterEach, describe, expect, it } from "vitest";
import { parseAgentText } from "./agent";
import { AGENT_CHEATSHEET, cheatCommands, type CheatLang } from "./agent-cheatsheet";
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
    for (const w of ["záložky", "zavřít záložku", "vložit \"", "jako \"K48\"", "přezdívka", "sestava vazba souosost", "díra závit M8", "zahloubení", "sestava pružina nová", "pohyb motor", "pohyb dynamika", "výkres razítko", "kótovat chytře funkční", "2d čára", "export step", "sdílet", "odkaz", "kontrola sestava", "porovnat \"ref.step\"", "přísně", "nápověda hledat", "nápověda tahák", "mncad run"])
      expect(t, w).toContain(w);
  });
  it("návod pro AI odkazuje na tahák a na hledání hned na začátku", () => {
    const head = AGENT_GUIDE.slice(0, 900);
    expect(head).toMatch(/nápověda tahák/);
    expect(head).toMatch(/nápověda hledat/);
    expect(head).toMatch(/\/cad\/tahak\.md/);
  });
});
