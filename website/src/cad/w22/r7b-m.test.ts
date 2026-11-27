/**
 * Vlna 22, balík M – fáze 2, kolo 7 (druhý commit, nálezy oponenta kola 7) bez jádra (syntetické plochy, w22-motion-fixture):
 *  1. bod 8 – dynamika s „na mezi chyba“: statistiky dynamiky (zdvih, v max, a max), dotyky, síly pružin, energie, CSV a graf jen
 *     z PLATNÝCH kroků. Dřív record() nahradil u neplatných snímků jen polohu (`place`) posledním platným, `dyn` (poloha, rychlost,
 *     zrychlení těžiště) a souhrn dynamiky braly stav integrátoru za mezí: „zdvih Z 30,35 mm“ vedle „ΔZ −15,205 mm“ téhož tělesa,
 *     „dotyk 0,659–2 s“ u dorazu, kterým těleso prošlo o 10,35 mm.
 *  2. popis instance v dosahu motoru a u pružiny se ztracenou dosedací plochou = táž funkce jako kolize (leafLabel); dřív vlastní
 *     kopie v motion-reach.ts a u pružiny holý název („pružina „Pružina““ i u tří pružin stejného názvu).
 * Na kódu commitu 690f9fa všechny selhávají.
 */
import { describe, expect, it } from "vitest";
import { motionRun } from "../asm-agent-kin";
import { leafLabel, lostSpringNote } from "../clash-report";
import { dynCharts, studyCsv } from "../motion-dynamic-report";
import type { DynMotionStep, DynResult } from "../motion-dynamic";
import { reachText } from "../motion-reach";
import type { AsmComponent, CadDoc, LostRef } from "../types";
import { fakeEnv, press, runLines } from "./w22-motion-fixture";

const MATE = 'sestava vazba vzdálenost "Deska A" F1 "Rám" F2 hodnota 57.5 název "ZDVIH"';
// Přidržovač 20 mm nad rámem (pevně), Mez ⟨5; 40⟩ mezi ním a Deskou A: deska smí dolů jen na hodnotu vazby 33 (t = 0,807 s při 30,35 mm/s)
const HOLD = ['sestava vazba vzdálenost "Přidržovač" F1 "Rám" F2 hodnota 20 název "PEVNÁ"', 'sestava vazba mez-vzdálenosti "Přidržovač" F2 "Deska A" F1 min 5 max 40 název "Mez"'];
const num = (s: string) => Number(s.replace(",", "."));

describe("kolo 7b – dynamika za mezí, popis instancí", () => {
  it("bod 8 (oponent kola 7): „na mezi chyba“ v dynamice – zdvih, dotyky, energie, CSV a graf jen z platných kroků; zdvih = ΔZ téhož tělesa", async () => {
    const env = fakeEnv();
    const a = await runLines(press({ holder: true }), env, MATE, ...HOLD, "pohyb dynamika čas 2 krok 0.002 snímky 12", "pohyb motor lineární vazba 1 57,5..27,15 rychlost 30.35 na mezi chyba");
    const log = a.last.log.join("\n");
    expect(a.kv).toMatch(/ mode=dyn /);
    expect(a.kv).toMatch(/ invalid=[1-9]\d* /);
    // souhrn kinematiky (poslední platná poloha) a souhrn dynamiky uvádějí pro Desku A TENTÝŽ zdvih
    const dz = log.match(/„Deska A“: ΔZ −([\d,]+) mm/);
    const stroke = log.match(/„Deska A“ [\d,]+ kg \([^)]*\): zdvih Z ([\d,]+) mm/);
    expect(dz && stroke, log).toBeTruthy();
    expect(num(stroke![1])).toBeCloseTo(num(dz![1]), 2);
    expect(num(stroke![1])).toBeLessThan(25); // za mezí by bylo 30,35
    // dotyk dorazu nekončí koncem studie (těleso dorazem prošlo – kroky za ním jsou neplatné)
    expect(log).not.toMatch(/\(min 5 mm\): dotyk [\d,]+–2 s/);
    expect(log).toMatch(/⚠ neplatné kroky \d+–12 \(motor za mezí – na mezi chyba\): zdvih, rychlosti, zrychlení, dotyky, síly pružin a energie jen z platných kroků/);
    expect(log).toMatch(/Energie: na začátku [-\d,]+ J, v posledním platném kroku \(t = [\d,]+ s\) [-\d,]+ J/);
    expect(log).not.toMatch(/Energie: na začátku [-\d,]+ J, na konci/);
    // výsledek: neplatný snímek bez `dyn`, dotyky a špičky jen do posledního platného kroku
    const res = (await motionRun(a.doc, env)) as DynResult;
    const steps = res.steps as DynMotionStep[];
    const bad = steps.filter((s) => s.status === "invalid");
    expect(bad.length).toBeGreaterThan(0);
    const t0 = bad[0].t;
    for (const s of bad) expect(s.dyn, `krok ${s.i}`).toBeUndefined();
    for (const s of steps.filter((x) => !x.status)) expect(s.dyn, `krok ${s.i}`).toBeDefined();
    for (const c of res.dynamic.contacts) for (const [, b] of c.intervals) expect(b, c.label).toBeLessThan(t0);
    for (const c of res.dynamic.contacts) for (const x of c.impacts) expect(x.t, c.label).toBeLessThan(t0);
    const pk = res.dynamic.peaks[res.dynamic.bodies.find((b) => b.name === "Deska A")!.id];
    expect(pk.tv).toBeLessThan(t0);
    expect(pk.a).toBeLessThan(1000); // < 1 m/s²: ráz zastavení motoru v t = 1 s (15 m/s²) je za mezí
    expect(res.dynamic.energy.endT).toBeLessThan(t0);
    // CSV: sloupce dynamiky v neplatných řádcích prázdné; graf: mezera (NaN)
    const rows = studyCsv(res, a.doc).replace(/^﻿/, "").trim().split("\r\n").slice(1);
    for (const s of bad) expect(rows[s.i].split(";").slice(-3), `CSV krok ${s.i}`).toEqual(["", "", ""]);
    const pos = dynCharts(res, a.doc).find((c) => c.key === "pos")!;
    expect(pos.series.length).toBeGreaterThan(0);
    for (const s of bad) for (const ser of pos.series) expect(ser.values[s.i], `graf krok ${s.i}`).toBeNaN();
  });

  it("bod 8: bez meze (motor nikam nenaráží) – žádný ⚠ neplatných kroků, energie „na konci“, dyn ve všech snímcích", async () => {
    const env = fakeEnv();
    const a = await runLines(press(), env, MATE, "pohyb dynamika čas 1 krok 0.002 snímky 10", "pohyb motor lineární vazba 1 57,5..40 rychlost 17.5 na mezi chyba");
    const log = a.last.log.join("\n");
    expect(log).not.toMatch(/neplatné kroky/);
    expect(log).toMatch(/Energie: na začátku [-\d,]+ J, na konci [-\d,]+ J/);
    const res = (await motionRun(a.doc, env)) as DynResult;
    expect((res.steps as DynMotionStep[]).every((s) => !!s.dyn)).toBe(true);
    expect(res.dynamic.energy.endT).toBeUndefined();
  });

  it("dosah motoru a pružina se ztracenou plochou: popis instance = leafLabel kolizí („Kostka #3“, „Kostka [K]“, „Pružina #4“)", () => {
    const lost: LostRef = { kind: "plane", origin: [0, 0, 0], normal: [0, 0, 1], why: "gone" };
    const base = press();
    const box = base.components![1];
    const mk = (id: string, name: string, extra: Partial<AsmComponent> = {}): AsmComponent => ({ ...box, id, name, ...extra });
    const doc: CadDoc = {
      ...base,
      components: [
        ...base.components!,
        mk("k1", "Kostka"),
        mk("k2", "Kostka", { alias: "K" }),
        mk("p1", "Pružina", { spring: { a: { compId: "rám", face: 1 }, b: { compId: "deska-a", face: 0 }, free: 20 } }),
        mk("p2", "Pružina", { spring: { a: { compId: "rám", face: 1 }, b: { compId: "deska-a", face: 0, lost }, free: 20 } }),
      ],
    };
    const txt = reachText({ motor: 0, mate: "m", comps: ["deska-a", "k1", "k2"], locked: ["k1", "k2"], axis: { origin: [0, 0, 0], dir: [0, 0, -1], rotary: false } }, doc);
    expect(txt).toContain(`„${leafLabel(doc, ["k1"])}“`);
    expect(txt).toContain("„Kostka #3“");
    expect(txt).toContain("„Kostka [K]“");
    // dvě pružiny stejného názvu, ztracená plocha jen u druhé: poznámka ji jmenuje instancí (#6), ne holým „Pružina“
    const note = lostSpringNote(doc, [{ a: "deska-a", b: "p2" }, { a: "deska-a", b: "p1" }]);
    expect(note).toBe(" · pružina „Pružina #6“ v neověřené délce (ztracená dosedací plocha – spring.lost)");
    expect(lostSpringNote(doc, [{ a: "deska-a", b: "p1" }])).toBe("");
  });
});

describe("kolo 7b – graf dynamiky přes neplatné kroky", () => {
  it("valueRuns: neplatný krok (NaN) čáru přeruší – dřív graf spojil body před a za mezerou jednou čarou", async () => {
    const { valueRuns } = await import("../motion-dynamic-report");
    expect(valueRuns([1, 2, NaN, NaN, 5, 6])).toEqual([[0, 1], [4, 5]]);
    expect(valueRuns([NaN, 1])).toEqual([[1]]);
    expect(valueRuns([NaN])).toEqual([]);
  });
});
