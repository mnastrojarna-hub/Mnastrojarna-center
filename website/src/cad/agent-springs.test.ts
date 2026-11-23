/**
 * Textové příkazy pružin z tabulky (agent-springs.ts): CS / EN / DE dají stejná data, starý zápis zůstává, chyby a varování
 * u řádku, `pružina tabulka` / `nápověda`, stav dokumentu, převodník dokument → skript tam a zpět (vlastní příkaz).
 */
import { describe, expect, it } from "vitest";
import { AGENT_COMMANDS, featureSummary, parseAgentText, type AgentOp } from "./agent";
import { ALL_SPRINGS, springScriptLine, springTableLines } from "./agent-springs";
import { docToScript } from "./doc-script";
import { emptyDoc, type CadDoc, type Feature } from "./types";
import "./ext/index";

const ops = (text: string) => {
  const p = parseAgentText(text);
  return { ops: p.ops as AgentOp[], errors: p.errors.map((e) => e.message) };
};
const feat = (text: string) => {
  const r = ops(text);
  expect(r.errors).toEqual([]);
  const op = r.ops[0] as Extract<AgentOp, { k: "feature" }>;
  expect(op.k).toBe("feature");
  return op;
};
const data = (text: string) => (feat(text).feature as Extract<Feature, { type: "ext" }>).data;

describe("pružina … textem", () => {
  it("tlačná CS / EN / DE → stejná data, výchozí výčty a umístění", () => {
    const cs = data("pružina tlačná d 2 De 20 L0 50 n 8 konce broušené materiál SH");
    expect(cs).toEqual({ d: 2, De: 20, L0: 50, n: 8, ends: "ground", material: "SH", nu: "0.5", hand: "right", at: [0, 0, 0], axis: "Z", mode: "new" });
    expect(data("spring compression d 2 De 20 L0 50 n 8 ends ground material SH")).toEqual(cs);
    expect(data("feder druck d 2 De 20 L0 50 n 8 enden geschliffen werkstoff SH")).toEqual(cs);
    expect(data("druckfeder d 2 De 20 L0 50 n 8")).toEqual(cs);
    // slova místo značek, desetinná čárka, alternativy a umístění
    expect(data("pružina tlačná drát 2,5 vnitřní 15 délka 60 celkem 10 přiložené nerez levé L2 40 v 10 0 5 osa X tvar 45 přidat")).toEqual({ d: 2.5, Di: 15, L0: 60, nt: 10, ends: "closed", material: "1.4310", nu: "0.5", hand: "left", L2: 40, at: [10, 0, 5], axis: "X", len: 45, mode: "add" });
  });
  it("tažná, zkrutná, talířová", () => {
    expect(data("pružina tažná d 1,6 De 12 n 12 F0 5 očka poloviční natočení 90")).toMatchObject({ d: 1.6, De: 12, n: 12, F0: 5, loop: "half", loop2: "half", angle: "90" });
    expect(data("spring torsion d 2 De 20 n 6.25 legs radial legs 30 a2 60")).toMatchObject({ leg1: "radial", leg2: "radial", l1: 30, l2: 30, a2: 60 });
    expect(data("feder teller reihe B De 40 säule 4 2 L2 15")).toMatchObject({ series: "B", De: 40, ns: 4, np: 2, L2: 15 });
  });
  it("výsledek v protokolu (souhrn + varování), chyba zadání u řádku, název", () => {
    const op = feat("pružina tlačná d 1 De 12 n 6 L0 40 L2 12 název \"Stírací pružina\"");
    expect(op.feature.name).toBe("Stírací pružina");
    expect(op.note).toMatch(/tlačná d 1 · De 12 · L0 40/);
    expect(op.note).toMatch(/⚠ při stlačení na L2 je napětí s korekcí k 101 % dovoleného .*staticky vyhoví/);
    // souhrn do stavu bez varování (ta má řádek stavu jednou z ⚠ stavby prvku – nález 11)
    expect(featureSummary(op.feature)).toBe("tlačná d 1 · De 12 · L0 40 · n 6 · R 1,276 N/mm · Ln 8 mm · F2 35,7 N");
    expect(ops("pružina tlačná d 2 De 20 n 8").errors[0]).toMatch(/zadejte volnou délku L0/);
    expect(ops("pružina tlačná d 2 De 20 L0 50 n 8 kecy").errors[0]).toMatch(/neznámé slovo „kecy“/);
    expect(ops("pružina talířová řada A De 41").errors[0]).toMatch(/nemá talíř De 41/);
  });
  it("starý zápis pružina D stoupání P závity N drát d zůstává prvkem Pružina", () => {
    const op = feat("pružina 20 stoupání 5 závity 8 drát 2");
    expect(op.feature.type).toBe("spring");
    expect(feat("druckfeder 20 steigung 5 windungen 8 draht 2").feature.type).toBe("spring");
  });
  it("tabulka a nápověda bez nového případu ve smyčce (api akce / info)", () => {
    // název nese operace (arg akce) – rozbor nemá vedlejší účinek
    expect(ops('pružina tabulka "Pružina 2"').ops[0]).toEqual({ k: "api", cmd: { kind: "action", id: "spring.table", arg: "Pružina 2" }, line: 1 });
    expect(ops("pružina tabulka").ops[0]).toMatchObject({ cmd: { arg: "" } });
    expect(ops("spring table all").ops[0]).toMatchObject({ cmd: { arg: ALL_SPRINGS } });
    expect(ops("feder tabelle alle").ops[0]).toMatchObject({ cmd: { arg: ALL_SPRINGS } });
    expect(ops('pružina tabulka "vše"').ops[0]).toMatchObject({ cmd: { arg: "vše" } }); // v uvozovkách = název
    const h = ops("pružina nápověda tlačná").ops[0] as Extract<AgentOp, { k: "info" }>;
    expect(h.k).toBe("info");
    expect(h.lines.join("\n")).toMatch(/EN 13906-1/);
    expect(h.lines.some((l) => /^ {2}L0\|délka/.test(l))).toBe(true);
    const all = ops("spring help").ops[0] as Extract<AgentOp, { k: "info" }>;
    expect(all.lines.join("\n")).toMatch(/DIN 2093/);
  });
  it("tabulka dílu: poslední / pojmenovaná / všechny pružiny, neznámý název = chyba", () => {
    const a = feat("pružina tlačná d 2 De 20 L0 50 n 8 L2 30").feature;
    const b = feat("pružina tažná d 1,6 De 12 n 12 F0 5").feature;
    const doc: CadDoc = { ...emptyDoc("P"), features: [a, b] };
    const heads = (lines: string[]) => lines.filter((l) => /^Pružina „/.test(l));
    expect(heads(springTableLines(doc))).toEqual([expect.stringMatching(/Tažná pružina/)]); // bez názvu = poslední v historii
    const all = springTableLines(doc, ALL_SPRINGS);
    expect(heads(all).length).toBe(2);
    expect(all.join("\n")).toMatch(/tuhost R: 3,494 N\/mm/);
    expect(heads(springTableLines(doc, a.name)).length).toBe(1);
    expect(springTableLines(doc, a.name)[0]).toMatch(/Tlačná pružina/);
    expect(() => springTableLines(doc, "Nic")).toThrow(/v dílu není/);
  });
  it("paleta Ctrl+K rozebírá text při psaní – rozbor předpon nemění výsledek pozdějšího příkazu (nález 1)", () => {
    const alfa = feat('pružina tlačná d 2 De 20 L0 50 n 8 název "Alfa"').feature;
    const beta = feat('pružina tlačná d 2 De 24 L0 50 n 8 v 40 0 0 název "Beta"').feature;
    const doc: CadDoc = { ...emptyDoc("Dvě"), features: [alfa, beta] };
    // rozepsaný příkaz v paletě (každá předpona se rozebere, nic se neprovede)
    const typed = 'pružina tabulka "Alfa"';
    for (let i = 1; i <= typed.length; i++) parseAgentText(typed.slice(0, i));
    for (let k = 0; k < 7; k++) {
      const op = ops('pružina tabulka "Beta"').ops[0] as Extract<AgentOp, { k: "api" }>;
      const arg = op.cmd.kind === "action" ? op.cmd.arg : undefined;
      const lines = springTableLines(doc, arg);
      expect(lines.filter((l) => /^Pružina „/.test(l)), `běh ${k + 1}`).toEqual([expect.stringMatching(/„Beta“/)]);
    }
    // příkaz z palety: provede se právě rozebraný text
    const fromPalette = ops(typed).ops[0] as Extract<AgentOp, { k: "api" }>;
    expect(fromPalette.cmd).toMatchObject({ arg: "Alfa" });
  });
  it("stav dokumentu: řádek pružiny se souhrnem; AGENT_COMMANDS mají řádky pružin", () => {
    const f = feat("pružina tlačná d 2 De 20 L0 50 n 8").feature;
    expect(featureSummary(f)).toMatch(/tlačná d 2 · De 20 · L0 50 · n 8 · R 3,494 N\/mm · Ln 20 mm/);
    for (const w of ["tlačná", "tažná", "zkrutná", "talířová", "tabulka", "nápověda"]) expect(AGENT_COMMANDS.some((c) => c.cmd.startsWith(`pružina ${w}`)), w).toBe(true);
    expect(AGENT_COMMANDS.some((c) => c.cmd.startsWith("pružina D stoupání"))).toBe(true);
  });
});

describe("dokument → skript → dokument", () => {
  const texts = [
    "pružina tlačná d 2 De 20 L0 50 n 8 L1 40 L2 30",
    "pružina tlačná d 2,5 D 17,5 L0 60 nt 10 konce přiložené materiál DH uložení 2 levé v 5 0 0 osa -Y tvar 45 přidat",
    "pružina tažná d 1,6 De 12 n 12,5 F0 5 očka boční očko2 německé L2 50",
    "pružina zkrutná d 2 De 20 n 6,25 rameno1 radiální l1 30 rameno2 osové l2 20 a2 60",
    "pružina talířová řada C De 50 sloupec 3 2",
  ];
  it("vlastní příkaz tam a zpět ve všech třech jazycích (data beze změny)", () => {
    const fs = texts.map((t) => feat(t).feature);
    const doc: CadDoc = { ...emptyDoc("Pružiny"), kind: "part", features: fs };
    for (const lang of ["cs", "en", "de"] as const) {
      for (const f of fs) expect(springScriptLine(f, lang), `${lang} ${f.name}`).not.toBeNull();
      const r = docToScript(doc, { lang });
      expect(r.stats.byType.ext, lang).toMatchObject({ generic: 0, json: 0 });
      const back = parseAgentText(r.text);
      expect(back.errors.map((e) => e.message), lang).toEqual([]);
      const got = (back.ops as AgentOp[]).filter((o): o is Extract<AgentOp, { k: "feature" }> => o.k === "feature").map((o) => (o.feature as Extract<Feature, { type: "ext" }>).data);
      expect(got, lang).toEqual(fs.map((f) => (f as Extract<Feature, { type: "ext" }>).data));
    }
  });
});

describe("návod pro AI – kapitola Pružiny", () => {
  it("bloky příkladů se přečtou bez chyb", async () => {
    const { AGENT_GUIDE } = await import("./agent-guide");
    const start = AGENT_GUIDE.indexOf("### Pružiny z tabulky");
    // kapitola končí za druhým příkladem pružin (za ní je od vlny 19 kapitola Kola a ozubení s vlastními bloky – ty kontroluje agent-gears.test.ts)
    const lastEx = AGENT_GUIDE.indexOf("### Příklad – tažná pružina upínky");
    expect(start).toBeGreaterThan(0);
    expect(lastEx).toBeGreaterThan(start);
    const end = AGENT_GUIDE.indexOf("\n### ", lastEx + 4);
    const part = AGENT_GUIDE.slice(start, end);
    expect(part).toContain("### Příklad – stírací pružiny");
    const blocks = [...part.matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(blocks.length).toBe(2);
    for (const b of blocks) expect(parseAgentText(b).errors.map((e) => e.message)).toEqual([]);
  });
});
