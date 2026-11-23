/**
 * Vlna 22, bod 5 (balík C1): třídy kolizí pro všechny výstupy – čisté funkce clash-rules.ts a clash-report.ts.
 * Popisy instancí (přezdívka / #pořadí / podsestava), místo průniku, seskupení opakovaných nálezů, dotyk, pravidla pracovního
 * kontaktu a závitu, souhrn pohybu („kroků s kolizí“ jen se skutečnou kolizí), první skutečná kolize, zvýraznění jen závad.
 */
import { describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import { clashKv, countClasses, type ClashDetail } from "./clash-class";
import { applyClashPolicy, isFault, ruleActive, ruleMatches, staticRuleCtx, stepRuleCtx, withRule, withoutRule } from "./clash-rules";
import { apiStepClashes, clashCountsKv, clashCsvCell, entryClashes, entryCounts, faultLeafIds, firstFault, groupClashes, groupText, leafLabel, motionClashKv, motionClashSummary, statusPairs, stepHasFault } from "./clash-report";
import type { AsmComponent, CadDoc } from "./types";

setLang("cs");
const part = (name: string): CadDoc => ({ name, kind: "part", material: "ocel", features: [] }) as unknown as CadDoc;
const comp = (id: string, name: string, alias?: string, src?: CadDoc): AsmComponent => ({ id, name, ...(alias ? { alias } : {}), source: src ? { kind: "asm", doc: src } : { kind: "part", doc: part(name) }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } }) as AsmComponent;
const asm = (name: string, components: AsmComponent[], extra: Partial<CadDoc> = {}): CadDoc => ({ name, kind: "assembly", material: "ocel", features: [], components, ...extra }) as unknown as CadDoc;

/** Sestava 5: deska, přidržovač, tři šrouby (S1–S3), plech */
const doc5 = asm("Sestava 5", [comp("d", "Deska A"), comp("p", "Přidržovač"), comp("s1", "Šroub M12", "S1"), comp("s2", "Šroub M12", "S2"), comp("s3", "Šroub M12", "S3"), comp("pl", "Plech")]);
const det = (a: string, b: string, volume: number, cls: ClashDetail["cls"], extra: Partial<ClashDetail> = {}): ClashDetail => ({ a, b, volume, cls, why: cls === "real" ? "no-thread" : cls === "thread" ? "thread" : "kernel-failed", aPath: [a], bPath: [b], ...extra });

describe("popis instance a místo", () => {
  it("přezdívka [S2], #pořadí u stejných názvů bez přezdívky, jediný název beze změny, podsestava „Skupina › Díl [S1]“", () => {
    expect(leafLabel(doc5, ["s2"])).toBe("Šroub M12 [S2]");
    expect(leafLabel(doc5, ["p"])).toBe("Přidržovač");
    const blocks = asm("B", [comp("a", "Blok"), comp("b", "Blok"), comp("c", "Blok")]);
    expect(leafLabel(blocks, ["b"])).toBe("Blok #2");
    const sub = asm("Horní skupina", [comp("d", "Deska A"), comp("s1", "Šroub M12", "S1"), comp("s2", "Šroub M12", "S2")]);
    const top = asm("Sestava 5S", [comp("z", "Základ"), comp("g", "Horní skupina", undefined, sub)]);
    // dřív „Horní skupina“ × „Horní skupina“ (název komponenty nejvyšší úrovně)
    expect(leafLabel(top, ["g", "s1"])).toBe("Horní skupina › Šroub M12 [S1]");
    expect(leafLabel(top, ["g", "d"])).toBe("Horní skupina › Deska A");
  });
  it("text nálezu nese instanci, objem a místo průniku (těžiště + obálka)", () => {
    const g = groupClashes([det("p", "s2", 365.2, "real", { at: [50, 30, 28.5], box: [[41, 21, 27], [59, 39, 30]] })], doc5);
    expect(groupText(g[0], doc5)).toBe("kolize „Přidržovač“ × „Šroub M12 [S2]“ (365,2 mm³) – místo [50; 30; 28,5] · obálka 18 × 18 × 3 mm");
  });
});

describe("seskupení opakovaných nálezů", () => {
  const four = asm("Sestava 5G", [comp("d", "Deska A"), comp("p", "Přidržovač"), comp("a", "Šroub M12"), comp("b", "Šroub M12"), comp("c", "Šroub M12"), comp("e", "Šroub M12")]);
  it("4 stejné nárazy hlav (objem lišící se o < 2 %) = jedna skupina „4×“ s instancemi; jiná třída zvlášť", () => {
    const list = [det("p", "a", 365.2, "real"), det("p", "b", 365.1, "real"), det("p", "c", 363.9, "real"), det("p", "e", 365.2, "real"), det("d", "a", 251, "thread"), det("d", "b", 251, "thread")];
    const g = groupClashes(list, four);
    expect(g.map((x) => [x.cls, x.items.length])).toEqual([
      ["real", 4],
      ["thread", 2],
    ]);
    expect(g[0].refs).toEqual(["#3", "#4", "#5", "#6"]);
    expect(groupText(g[0], four)).toMatch(/^4× kolize „Přidržovač“ × „Šroub M12“ \[#3, #4, #5, #6\] \(363,9–365,2 mm³\)$/);
  });
  it("objem mimo toleranci = samostatná skupina (rozdílný náraz se neschová do skupiny)", () => {
    const g = groupClashes([det("p", "a", 365, "real"), det("p", "b", 200, "real")], four);
    expect(g.length).toBe(2);
  });
});

describe("politika dokumentu: dotyk, pravidlo závit, pracovní kontakt", () => {
  it("dotyk: průnik tenčí než tolerance = touch (počítá se, není závada); tlustší zůstane skutečnou kolizí", () => {
    const d = asm("T", [comp("a", "Deska A"), comp("b", "Deska B")]);
    const thin = det("a", "b", 0.1, "real", { depth: 0.0001 });
    expect(applyClashPolicy([thin], d, staticRuleCtx(d))[0].cls).toBe("touch");
    expect(applyClashPolicy([{ ...thin, depth: 0.5 }], d, staticRuleCtx(d))[0].cls).toBe("real");
    // tolerance dokumentu menší než přesah → skutečná kolize
    expect(applyClashPolicy([thin], { ...d, clashTol: 0.00001 }, staticRuleCtx(d))[0].cls).toBe("real");
    // bez údaje o tloušťce nikdy dotyk (slabší tvrzení)
    expect(applyClashPolicy([{ ...thin, depth: undefined }], d, staticRuleCtx(d))[0].cls).toBe("real");
  });
  it("šroub v jádrové díře bez prvku závitu = nevyhodnotitelné; pravidlo závit ho zařadí podle pásma (hlava v materiálu zůstane skutečná)", () => {
    const d = asm("P", [comp("d", "Deska C"), comp("s", "Šroub M12", "S1")]);
    const x = det("d", "s", 251.1, "undetermined", { why: "no-thread-feature", bandCls: "thread", hole: { designation: "M12", D: 12, r: 5.1, depth: 8, through: false } });
    expect(applyClashPolicy([x], d, staticRuleCtx(d))[0].cls).toBe("undetermined");
    const ruled = withRule(d, { kind: "thread", a: ["d"], b: ["s"] });
    const y = applyClashPolicy([x], ruled, staticRuleCtx(ruled))[0];
    expect([y.cls, y.why, y.rule]).toEqual(["thread", "thread-rule", "r1"]);
    // pravidlo závit nepřebije skutečnou kolizi (hlava šroubu v jiné desce)
    expect(applyClashPolicy([det("d", "s", 900, "real")], ruled, staticRuleCtx(ruled))[0].cls).toBe("real");
  });
  it("pracovní kontakt: okno kroků platí jen v krocích studie (staticky ne), okno hodnoty motoru i staticky podle hodnoty vazby", () => {
    const base = asm("Střih", [comp("r", "Razník"), comp("pl", "Plech")], { mates: [{ id: "m1", type: "distance", value: 26, a: { compId: "r", face: 0 }, b: { compId: "pl", face: 0 } } as never], motion: { motors: [{ id: "mo", kind: "linear", mate: "m1", from: 26, to: 22 }], duration: 2, steps: 4 } as never });
    const x = det("pl", "r", 78.5, "real");
    const bySteps = withRule(base, { kind: "work", a: ["r"], b: ["pl"], when: { steps: [0, 2] } });
    expect(applyClashPolicy([x], bySteps, staticRuleCtx(bySteps))[0].cls).toBe("real");
    expect(applyClashPolicy([x], bySteps, stepRuleCtx(bySteps, { i: 2, motors: [24] }))[0].cls).toBe("work");
    expect(applyClashPolicy([x], bySteps, stepRuleCtx(bySteps, { i: 3, motors: [23] }))[0].cls).toBe("real");
    const byMate = withRule(base, { kind: "work", a: ["r"], b: ["pl"], when: { mate: "m1", from: 26, to: 24 } });
    expect(applyClashPolicy([x], byMate, staticRuleCtx(byMate))[0].cls).toBe("work");
    expect(applyClashPolicy([x], byMate, stepRuleCtx(byMate, { i: 3, motors: [23] }))[0].cls).toBe("real");
    // jiná dvojice pravidlu nepodléhá; šroub v závitu se pravidlem nemění
    expect(applyClashPolicy([det("pl", "x", 5, "real")], byMate, staticRuleCtx(byMate))[0].cls).toBe("real");
    expect(applyClashPolicy([det("pl", "r", 5, "thread")], byMate, staticRuleCtx(byMate))[0].cls).toBe("thread");
    expect(withoutRule(byMate, "r1").clashRules).toBeUndefined();
  });
  it("shoda pravidla podle cest (díl v podsestavě, obě pořadí dvojice, bez B = s čímkoli)", () => {
    expect(ruleMatches({ a: ["g", "s1"], b: ["pl"] }, { a: "pl", b: "g", aPath: ["pl"], bPath: ["g", "s1"] })).toBe(true);
    expect(ruleMatches({ a: ["g"] }, { a: "g", b: "x", aPath: ["g", "s2"], bPath: ["x"] })).toBe(true);
    expect(ruleMatches({ a: ["g", "s1"], b: ["pl"] }, { a: "g", b: "pl", aPath: ["g", "s2"], bPath: ["pl"] })).toBe(false);
    expect(ruleActive({ when: { steps: [3, 1] } }, { step: 2 })).toBe(true);
    expect(ruleActive({ when: { mate: "m", from: 5, to: 1 } }, { motorValue: () => undefined })).toBe(false);
  });
});

describe("stav a strojové výpisy", () => {
  const list = [det("d", "s1", 251.1, "thread"), det("d", "s2", 345.2, "thread"), det("d", "s3", 251.1, "thread"), det("p", "s2", 365.2, "real", { at: [50, 30, 28.5] }), det("s3", "pl", 77.3, "real", { at: [87.81, 30, 32.5] })];
  it("`stav`: jen závady s instancí a místem, šrouby v závitu počtem; kv `clash=5(thread=3,real=2)`", () => {
    const p = statusPairs(list, doc5);
    expect(p[0]).toBe("skutečné 2: Přidržovač × Šroub M12 [S2] (365,2 mm³) v místě [50; 30; 28,5]");
    expect(p[1]).toBe("Plech × Šroub M12 [S3] (77,3 mm³) v místě [87,81; 30; 32,5]");
    expect(p[2]).toBe("šroub v závitu 3");
    expect(p.join("; ")).not.toMatch(/Deska A × Šroub/);
    expect(clashCountsKv(countClasses(list))).toBe("5(thread=3,real=2)");
    expect(clashKv(countClasses(list))).toBe("total=5 thread=3 underhead=0 real=2 undetermined=0");
    expect(clashKv(countClasses([det("a", "b", 1, "touch"), det("a", "c", 1, "work")]))).toBe("total=2 thread=0 underhead=0 real=0 undetermined=0 touch=1 work=1");
  });
  it("uložený záznam bez zařazení = surové dvojice jako skutečné (nikdy „šroub v závitu“ bez kontroly geometrie)", () => {
    const res = list.map(({ a, b, volume }) => ({ a, b, volume }));
    expect(entryCounts({ res }, doc5)).toMatchObject({ total: 5, real: 5, thread: 0 });
    expect(entryCounts({ res, list }, doc5)).toMatchObject({ total: 5, real: 2, thread: 3 });
    // seznam jiné délky než průniky (poškozený záznam) se nepoužije
    expect(entryClashes({ res, list: list.slice(0, 2) }, doc5).every((x) => x.cls === "real")).toBe(true);
  });
  it("zvýraznění ve 3D: jen listy se závadou – šroub, který je jen v závitu, nesvítí", () => {
    const ids = faultLeafIds(entryClashes({ res: list, list }, doc5));
    expect([...ids].sort()).toEqual(["p", "pl", "s2", "s3"]);
    expect(ids.has("s1")).toBe(false);
    expect(ids.has("d")).toBe(false);
    expect(isFault("undetermined")).toBe(true);
    expect(isFault("work")).toBe(false);
  });
});

describe("pohybová studie: kroky s kolizí jen se skutečnou kolizí, první skutečná kolize", () => {
  const thr = (s: string) => det("d", s, 251.1, "thread");
  const hit = det("doraz", "s2", 600, "real", { at: [80, 30, 100.5] });
  const d = asm("Sestava 5M", [comp("z", "Základ"), comp("d", "Deska A"), comp("s1", "Šroub M12", "S1"), comp("s2", "Šroub M12", "S2"), comp("doraz", "Doraz")]);
  const steps = Array.from({ length: 16 }, (_, i) => ({ i, t: i * 0.1, motors: [40 + i], clashes: i >= 9 ? [thr("s1"), thr("s2"), hit] : [thr("s1"), thr("s2")] }));
  const res = { steps, collisionsChecked: true };
  it("16 kroků se šrouby v závitu, skutečná kolize od kroku 9 → kroků s kolizí 7 z 16, thread=2, real=1, first.real=9", () => {
    const s = motionClashSummary(res, d);
    expect(s.stats).toMatchObject({ steps: 7, of: 16, thread: 2, real: 1, firstReal: 9 });
    // vlna 22, bod 6: na konci spojitost kontroly (výsledek bez údaje = diskrétně, kroky bez polohy → posun 0)
    expect(motionClashKv(s.stats).join(" ")).toBe("clash.steps=7/16 thread=2 real=1 first.real=9 clash.mode=discrete clash.poses=16 clash.refined=0 clash.maxstep=0mm");
    expect(s.lines[0]).toBe("Kolize v pohybu: kroků s kolizí 7 z 16 · šroub v závitu 2 dvojic (kroky 0–15) · skutečné: 1 dvojic dílů v 7 krocích, první v kroku 9");
    expect(s.codes.map((c) => c.code)).toEqual(["clash.thread", "clash.real"]);
    expect(s.codes[1].text).toMatch(/^v pohybu „Doraz“ × „Šroub M12 \[S2\]“ od kroku 9 .* – místo \[80; 30; 100,5\] v kroku 9$/);
  });
  it("první kolize pro API = první SKUTEČNÁ (krok 9, instance), ne šroub v závitu v kroku 0; štítek kroku jen u skutečné", () => {
    expect(firstFault(res, d)).toMatchObject({ step: 9, a: "Doraz", b: "Šroub M12 [S2]", cls: "real" });
    expect(stepHasFault(d, steps[0])).toBe(false);
    expect(stepHasFault(d, steps[9])).toBe(true);
    expect(apiStepClashes(d, steps[0]).map((x) => x.cls)).toEqual(["thread", "thread"]);
    expect(clashCsvCell(d, steps[0])).toBe("Deska A × Šroub M12 [S1] (šroub v závitu), Deska A × Šroub M12 [S2] (šroub v závitu)");
    expect(clashCsvCell(d, { i: 1, t: 0, motors: [] })).toBe("nekontrolováno");
  });
  it("jen šrouby v závitu = žádná skutečná kolize, ale ani „žádné ve všech krocích“ (průnik existuje)", () => {
    const only = { steps: steps.slice(0, 3).map((s) => ({ ...s, clashes: [thr("s1")] })), collisionsChecked: true };
    const s = motionClashSummary(only, d);
    expect(s.stats.steps).toBe(0);
    expect(s.lines[0]).toMatch(/skutečné: žádné$/);
    expect(s.lines[0]).not.toMatch(/žádné ve všech krocích/);
    expect(firstFault(only, d)).toBeNull();
  });
  it("pracovní kontakt v okně kroků se nepočítá jako kolize, mimo okno ano; kv work=1", () => {
    const st = asm("Střih", [comp("r", "Razník"), comp("pl", "Plech")], { clashRules: [{ id: "r1", kind: "work", a: ["r"], b: ["pl"], when: { steps: [0, 2] } }] });
    const ss = Array.from({ length: 5 }, (_, i) => ({ i, t: i * 0.5, motors: [26 - i], clashes: [det("pl", "r", 78.5, "real")] }));
    const s = motionClashSummary({ steps: ss, collisionsChecked: true }, st);
    expect(s.stats).toMatchObject({ steps: 2, of: 5, real: 1, firstReal: 3, work: 1 });
    expect(motionClashKv(s.stats).join(" ")).toBe("clash.steps=2/5 thread=0 real=1 first.real=3 work=1 clash.mode=discrete clash.poses=5 clash.refined=0 clash.maxstep=0mm");
    expect(s.codes.map((c) => c.code)).toEqual(["clash.real", "clash.work"]);
  });
  it("dvojice bez třídy (výsledek bez zařazení) se bere jako skutečná kolize", () => {
    const raw = { steps: [{ i: 0, t: 0, motors: [0], clashes: [{ a: "d", b: "s1", volume: 251 }] }], collisionsChecked: true };
    expect(motionClashSummary(raw, d).stats.real).toBe(1);
  });
});
