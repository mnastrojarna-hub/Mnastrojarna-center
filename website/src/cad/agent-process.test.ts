/**
 * Text procesní vrstvy (vlna 22, bod 4): `pohyb proces …` CS / EN / DE, chyby s nápovědou, zápis do skriptu dokumentu.
 */
import { describe, expect, it } from "vitest";
import { parseMotionText } from "./agent-motion";
import { processListLines, processScript } from "./agent-process";
import { setLang } from "./i18n";
import type { CadDoc } from "./types";

setLang("cs");
const p = (line: string) => parseMotionText(line);

describe("pohyb proces – rozbor", () => {
  it("CS: střih bez hloubky, se začátkem podmínkou vazby a odpadem", () => {
    expect(p('pohyb proces střih "Razník" "Plech"')).toEqual({ op: "process", cmd: { k: "add", kind: "cut", tool: "Razník", target: "Plech" } });
    expect(p('pohyb proces střih "Razník" "Plech" při vazba "ZDVIH" <= 1 odpad s nástrojem název "Děrování"')).toEqual({
      op: "process",
      cmd: { k: "add", kind: "cut", tool: "Razník", target: "Plech", at: { mate: "ZDVIH", op: "<=", value: 1 }, scrap: "tool", name: "Děrování" },
    });
    expect(p('pohyb proces děrování "Razník" "Plech" od 0,5 s odpad zůstane')).toMatchObject({ cmd: { kind: "cut", at: { t: 0.5 }, scrap: "stay" } });
    expect(p('pohyb proces střih "Razník" "Plech" fáze "Střih" odpad padá')).toMatchObject({ cmd: { at: { phase: "Střih" }, scrap: "fall" } });
    expect(p('pohyb proces střih "Razník" "Plech" při motor 1 <=0,5')).toMatchObject({ cmd: { at: { motor: "1", op: "<=", value: 0.5 } } });
  });
  it("CS: ražení / otisk vyžaduje hloubku", () => {
    expect(p('pohyb proces ražení "Razník" "Plech" hloubka 0,3')).toMatchObject({ cmd: { k: "add", kind: "imprint", depth: 0.3 } });
    expect(p('pohyb proces otisk "Razník" "Plech" hloubka 0,3')).toMatchObject({ cmd: { kind: "imprint" } });
    expect(() => p('pohyb proces ražení "Razník" "Plech"')).toThrow(/hloubku otisku/);
  });
  it("EN / DE", () => {
    expect(p('motion process punch "Punch" "Sheet" depth 0.5 when motor 1 >= 2 scrap tool')).toMatchObject({ cmd: { kind: "cut", depth: 0.5, at: { motor: "1", op: ">=", value: 2 }, scrap: "tool" } });
    expect(p('motion process imprint "Punch" "Sheet" depth 0.3 phase "Mark"')).toMatchObject({ cmd: { kind: "imprint", depth: 0.3, at: { phase: "Mark" } } });
    expect(p('bewegung prozess stanzen "Stempel" "Blech" wenn verknüpfung "HUB" <= 1 abfall bleibt')).toMatchObject({ cmd: { kind: "cut", at: { mate: "HUB", op: "<=", value: 1 }, scrap: "stay" } });
    expect(p('bewegung prozess prägen "Stempel" "Blech" tiefe 0,2')).toMatchObject({ cmd: { kind: "imprint", depth: 0.2 } });
  });
  it("seznam a mazání", () => {
    expect(p("pohyb proces")).toEqual({ op: "process", cmd: { k: "list" } });
    expect(p("motion process list")).toEqual({ op: "process", cmd: { k: "list" } });
    expect(p("bewegung prozess liste")).toEqual({ op: "process", cmd: { k: "list" } });
    expect(p("pohyb proces smazat")).toEqual({ op: "process", cmd: { k: "remove" } });
    expect(p("pohyb proces 2 smazat")).toEqual({ op: "process", cmd: { k: "remove", ref: "2" } });
    expect(p("motion process delete 1")).toEqual({ op: "process", cmd: { k: "remove", ref: "1" } });
    expect(p("bewegung prozess 2 löschen")).toEqual({ op: "process", cmd: { k: "remove", ref: "2" } });
  });
  it("chyby s nápovědou (žádný tichý úspěch)", () => {
    expect(() => p('pohyb proces "Razník" "Plech"')).toThrow(/střih nebo ražení/);
    expect(() => p('pohyb proces střih "Razník"')).toThrow(/nástroj a obrobek/);
    expect(() => p('pohyb proces střih "Razník" "Plech" hloubka -1')).toThrow(/kladná/);
    expect(() => p('pohyb proces střih "Razník" "Plech" při vazba "ZDVIH" = 1')).toThrow(/operátor/);
    expect(() => p('pohyb proces střih "Razník" "Plech" odpad letí')).toThrow(/odpad padá/);
    expect(() => p('pohyb proces střih "Razník" "Plech" rychle')).toThrow(/neznámá volba/);
  });
  it("ostatní podpříkazy pohybu beze změny (proces neruší fáze / vůli / motor)", () => {
    expect(p('pohyb vůle "A" "B" min 0,05').op).toBe("clearance");
    expect(p('pohyb fáze "Sevření" od 0,4 s').op).toBe("phase");
    expect(p("pohyb krok 3")).toEqual({ op: "step", n: 3 });
  });
});

describe("pohyb proces – skript dokumentu a výpis", () => {
  const doc = {
    app: "mnastrojarna-cad",
    version: 2,
    name: "Lis",
    kind: "assembly",
    features: [],
    components: [
      { id: "P", name: "Plech", source: { kind: "part", doc: {} }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } },
      { id: "R", name: "Razník", source: { kind: "part", doc: {} }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } },
    ],
    mates: [{ id: "Z", type: "distance", a: { compId: "R" }, b: { compId: "P" }, value: 10, name: "ZDVIH" }],
    motion: {
      motors: [{ id: "m1", kind: "linear", mate: "Z", from: 10, to: -2 }],
      duration: 2,
      steps: 24,
      phases: [{ id: "f1", name: "Střih" }],
      process: [
        { id: "a", kind: "cut", tool: "R", target: "P", at: { mate: "Z", op: "<=", value: 1 }, scrap: "tool" },
        { id: "b", kind: "imprint", tool: "R", target: "P", depth: 0.3, at: { phase: "f1" }, name: "Značka" },
        { id: "c", kind: "cut", tool: "X", target: "P" },
      ],
    },
  } as unknown as CadDoc;
  const ref = (id: string) => ({ P: "#1", R: "#2" })[id] ?? null;
  it("CS / EN / DE řádky, komponenta mimo skript se vynechá", () => {
    expect(processScript(doc, 0, ref)).toEqual({ lines: ['pohyb proces střih #2 #1 při vazba 1 <= 1 odpad s nástrojem', 'pohyb proces ražení #2 #1 hloubka 0.3 fáze "Střih" název "Značka"'], skipped: 1 });
    expect(processScript(doc, 1, ref).lines[0]).toBe("motion process cut #2 #1 when mate 1 <= 1 scrap tool");
    expect(processScript(doc, 2, ref).lines[1]).toBe('bewegung prozess prägen #2 #1 tiefe 0.3 phase "Střih" name "Značka"');
  });
  it("zapsané řádky se znovu přečtou stejně (tam a zpět)", () => {
    for (const li of [0, 1, 2] as const) for (const l of processScript(doc, li, ref).lines) expect(parseMotionText(l).op).toBe("process");
  });
  it("výpis operací", () => {
    const l = processListLines(doc);
    expect(l[0]).toBe("Procesní operace: 3");
    expect(l[1]).toMatch(/1\. střih „Razník“ → „Plech“ · do prostřižení · od vazba „ZDVIH“ ≤ 1 · odpad: drží na nástroji/);
    expect(l[2]).toMatch(/2\. Značka \(otisk\) „Razník“ → „Plech“ · hloubka 0,3 mm · se začátkem fáze „Střih“/);
  });
});

describe("pohyb událost … odeber (zápis ze zprávy) a pohyb úroveň", () => {
  it("událost s odebráním = procesní operace střih s podmínkou", () => {
    expect(p('pohyb událost při vazba "ZDVIH" <= 1 odeber "Střižník" z "Plech"')).toEqual({ op: "process", cmd: { k: "add", kind: "cut", tool: "Střižník", target: "Plech", at: { mate: "ZDVIH", op: "<=", value: 1 } } });
    expect(p('motion event when motor 1 <= 0 remove "Punch" from "Sheet"')).toMatchObject({ op: "process", cmd: { kind: "cut", tool: "Punch", target: "Sheet", at: { motor: "1" } } });
  });
  it("událost bez odebrání zůstává fází (M3)", () => {
    expect(p('pohyb událost při vazba "ZDVIH" <= 30 zapnout vazba 2').op).toBe("phase");
  });
  it("pohyb úroveň = výpis (s volbou chyba při provedení, ne tiché přijetí)", () => {
    expect(p("pohyb úroveň")).toEqual({ op: "process", cmd: { k: "level" } });
    expect(p("pohyb úroveň geometrická")).toEqual({ op: "process", cmd: { k: "level", arg: "geometrická" } });
    expect(p("motion level")).toEqual({ op: "process", cmd: { k: "level" } });
  });
});
