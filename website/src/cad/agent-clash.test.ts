/**
 * Vlna 22, bod 5 (balík C1): příkaz `kolize …` textem – výpis po třídách, pravidla pracovního kontaktu a závitu, tolerance dotyku
 * (CS / EN / DE), úprava dokumentu a přenos pravidel do skriptu dokumentu (tam a zpět).
 */
import { describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import { applyClashDocCmd, clashRulesScript, compPath, parseClashText } from "./agent-clash";
import { parseAgentText } from "./agent";
import type { AsmComponent, CadDoc } from "./types";

setLang("cs");
const part = (name: string): CadDoc => ({ name, kind: "part", material: "ocel", features: [] }) as unknown as CadDoc;
const comp = (id: string, name: string, alias?: string, src?: CadDoc): AsmComponent => ({ id, name, ...(alias ? { alias } : {}), source: src ? { kind: "asm", doc: src } : { kind: "part", doc: part(name) }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } }) as AsmComponent;
const sub: CadDoc = { name: "Horní skupina", kind: "assembly", material: "ocel", features: [], components: [comp("d", "Deska A"), comp("s1", "Šroub M12", "S1")] } as unknown as CadDoc;
const doc: CadDoc = {
  name: "Střih",
  kind: "assembly",
  material: "ocel",
  features: [],
  components: [comp("r", "Razník"), comp("pl", "Plech"), comp("g", "Horní skupina", undefined, sub)],
  mates: [{ id: "m1", type: "distance", name: "ZDVIH", value: 26, a: { compId: "r", face: 0 }, b: { compId: "pl", face: 0 } }],
} as unknown as CadDoc;

describe("parseClashText (CS / EN / DE)", () => {
  it("prázdný řádek = kontrola; seznam s třídou; tolerance", () => {
    expect(parseClashText("")).toEqual({ op: "check" });
    expect(parseClashText("seznam")).toEqual({ op: "list", filter: "all" });
    expect(parseClashText("seznam skutečné")).toEqual({ op: "list", filter: "real" });
    expect(parseClashText("seznam pod hlavou")).toEqual({ op: "list", filter: "underhead" });
    expect(parseClashText("list touch")).toEqual({ op: "list", filter: "touch" });
    expect(parseClashText("liste gewinde")).toEqual({ op: "list", filter: "thread" });
    expect(parseClashText("tolerance 0,02")).toEqual({ op: "tol", value: 0.02 });
    expect(parseClashText("toleranz 0.005")).toEqual({ op: "tol", value: 0.005 });
    expect(() => parseClashText("seznam fialové")).toThrow(/neznámá třída/);
  });
  it("pravidlo pracovní s oknem kroků / hodnotou motoru vazby a poznámkou; závit; výpis a mazání pravidel", () => {
    expect(parseClashText('pravidlo pracovní "Razník" "Plech" kroky 10..20')).toEqual({ op: "rule", kind: "work", a: "Razník", b: "Plech", steps: [10, 20] });
    expect(parseClashText('pravidlo pracovní "Razník" "Plech" pohyb "ZDVIH" 30..27,5 pozn střih plechu')).toEqual({ op: "rule", kind: "work", a: "Razník", b: "Plech", mate: "ZDVIH", from: 30, to: 27.5, note: "střih plechu" });
    expect(parseClashText('rule work "Punch" "Sheet" steps 1..3')).toMatchObject({ op: "rule", kind: "work", steps: [1, 3] });
    expect(parseClashText('regel arbeit "Stempel" "Blech" bewegung 2 5..1')).toMatchObject({ op: "rule", kind: "work", mate: "2", from: 5, to: 1 });
    expect(parseClashText('pravidlo závit "Deska C"')).toEqual({ op: "rule", kind: "thread", a: "Deska C" });
    expect(parseClashText("pravidla")).toEqual({ op: "rules" });
    expect(parseClashText("rules")).toEqual({ op: "rules" });
    expect(parseClashText("pravidlo 2 smazat")).toEqual({ op: "ruleDel", n: 2 });
    expect(parseClashText("regel 1 löschen")).toEqual({ op: "ruleDel", n: 1 });
    expect(parseClashText("pravidla smazat")).toEqual({ op: "ruleDel", n: "all" });
    expect(() => parseClashText('pravidlo závit "A" kroky 1..2')).toThrow(/platí vždy/);
    expect(() => parseClashText('pravidlo pracovní "A" "B" kroky 10')).toThrow(/rozsah od..do/);
    expect(() => parseClashText("pravidlo fialové")).toThrow(/pracovní nebo závit/);
  });
  it("řádek skriptu `kolize …` dá operaci clash s příkazem (bez slov = kontrola)", () => {
    const { ops, errors } = parseAgentText('kolize\nkolize pravidlo pracovní "Razník" "Plech" kroky 0..2\nclash list real\nkollision toleranz 0,01');
    expect(errors).toEqual([]);
    const cl = ops.filter((o) => o.k === "clash") as { k: "clash"; cmd?: unknown }[];
    expect(cl.length).toBe(4);
    expect(cl[0].cmd).toBeUndefined();
    expect(cl[1].cmd).toMatchObject({ op: "rule", kind: "work", steps: [0, 2] });
    expect(cl[2].cmd).toEqual({ op: "list", filter: "real" });
    expect(cl[3].cmd).toEqual({ op: "tol", value: 0.01 });
  });
});

describe("úprava dokumentu a skript", () => {
  it("pravidlo s komponentami podle názvu / přezdívky / cesty v podsestavě a vazbou podle názvu", () => {
    expect(compPath(doc, "Horní skupina/S1")).toEqual(["g", "s1"]);
    expect(compPath(doc, "Horní skupina › Deska A")).toEqual(["g", "d"]);
    expect(() => compPath(doc, "Razník/X")).toThrow(/není podsestava/);
    const r = applyClashDocCmd(doc, parseClashText('pravidlo pracovní "Razník" "Plech" pohyb "ZDVIH" 26..24'))!;
    expect(r.rule).toEqual({ id: "r1", kind: "work", a: ["r"], b: ["pl"], when: { mate: "m1", from: 26, to: 24 } });
    const r2 = applyClashDocCmd(r.doc, parseClashText('pravidlo závit "Horní skupina/Deska A"'))!;
    expect(r2.doc.clashRules!.map((x) => x.id)).toEqual(["r1", "r2"]);
    const del = applyClashDocCmd(r2.doc, parseClashText("pravidlo 1 smazat"))!;
    expect(del.doc.clashRules!.map((x) => x.id)).toEqual(["r2"]);
    expect(() => applyClashDocCmd(del.doc, parseClashText("pravidlo 5 smazat"))).toThrow(/v sestavě není/);
    expect(applyClashDocCmd(doc, parseClashText("tolerance 0,02"))!.doc.clashTol).toBe(0.02);
    expect(applyClashDocCmd(doc, parseClashText("seznam"))).toBeNull();
  });
  it("skript dokumentu: pravidla a tolerance jako řádky `kolize …` v jazyce skriptu, které se znovu rozeberou na totéž pravidlo", () => {
    const d: CadDoc = { ...doc, clashRules: [{ id: "r1", kind: "work", a: ["r"], b: ["pl"], when: { steps: [0, 2] }, note: "střih" }, { id: "r2", kind: "work", a: ["r"], b: ["pl"], when: { mate: "m1", from: 26, to: 24.5 } }, { id: "r3", kind: "thread", a: ["g", "d"] }], clashTol: 0.02 };
    const ref = (p: readonly string[]) => (p.length === 1 ? `#${(d.components ?? []).findIndex((c) => c.id === p[0]) + 1}` : null);
    const cs = clashRulesScript(d, 0, ref, () => 1);
    expect(cs.lines).toEqual(["kolize pravidlo pracovní #1 #2 kroky 0..2 pozn střih", "kolize pravidlo pracovní #1 #2 pohyb 1 26..24,5", "kolize tolerance 0,02"]);
    expect(cs.skipped).toBe(1); // díl v podsestavě se do skriptu nepřenese – poznámka, ne tiché zahození
    const en = clashRulesScript(d, 1, ref, () => 1);
    expect(en.lines[0]).toBe("clash rule work #1 #2 steps 0..2 note střih");
    const de = clashRulesScript(d, 2, ref, () => 1);
    expect(de.lines[1]).toBe("kollision regel arbeit #1 #2 bewegung 1 26..24,5");
    // zpět: řádek skriptu → stejné pravidlo
    const back = applyClashDocCmd({ ...doc }, parseClashText(cs.lines[1].replace(/^kolize /, "")))!;
    expect(back.rule).toMatchObject({ kind: "work", a: ["r"], b: ["pl"], when: { mate: "m1", from: 26, to: 24.5 } });
    const back2 = applyClashDocCmd({ ...doc }, parseClashText(cs.lines[0].replace(/^kolize /, "")))!;
    expect(back2.rule).toMatchObject({ when: { steps: [0, 2] }, note: "střih" });
  });
});
