/**
 * Vlna 22, bod 10: co motor skutečně pohání (zkušební posun řešičem), osa a směr, díly spojené zámkem, konflikt dvou motorů na tomtéž
 * stupni volnosti UŽ PŘI DEFINICI (⚠ motion.motor-conflict), nahrazení motoru na téže vazbě nikdy potichu (ℹ motion.motor-replaced),
 * navázání úseků. Bez jádra (syntetické plochy kvádrů – w22/w22-motion-fixture.ts).
 */
import { afterEach, describe, expect, it } from "vitest";
import { motorCheck } from "./asm-agent-kin";
import { emptyAssembly, partComponent } from "./assembly";
import { setLang } from "./i18n";
import { axisWord, reachHighlight } from "./motion-reach";
import { boxPart, fakeEnv, runLines } from "./w22/w22-motion-fixture";
import type { CadDoc, Vec3 } from "./types";

afterEach(() => setLang("cs"));

const mk = (n: string, size: Vec3, pos: Vec3, fixed = false) => ({ ...partComponent(boxPart(n, size), { position: pos }, fixed ? { fixed: true } : {}), id: n.toLowerCase().replace(/\s+/g, "-") });
/** Deska A (ukotvená), Vodítko (ukotvené), Přidržovač na ZDVIH (Vzdálenost) a VEDENÍ (Souosost s vodítkem), Šroub zamčený k přidržovači */
function holder(): CadDoc {
  return {
    ...emptyAssembly("S1"),
    components: [mk("Deska A", [100, 100, 10], [0, 0, 0], true), mk("Vodítko", [100, 100, 5], [0, 0, -20], true), mk("Přidržovač", [100, 100, 8], [0, 0, 67.5]), mk("Šroub", [12, 12, 20], [44, 44, 75.5]), mk("Jiný díl", [10, 10, 10], [200, 0, 0])],
  };
}
const SETUP = ['sestava vazba zámek "Šroub" "Přidržovač"', 'sestava vazba souosost "Přidržovač" F3 "Vodítko" F3 název "VEDENÍ"', 'sestava vazba vzdálenost "Přidržovač" F1 "Deska A" F2 hodnota 57,5 název "ZDVIH"'];

describe("bod 10 – motor při definici", () => {
  it("motor pohání přidržovač + šroub (zámek), osa −Z; text to řekne hned po zadání", async () => {
    const env = fakeEnv();
    const r = await runLines(holder(), env, ...SETUP, 'pohyb motor lineární "Přidržovač" 57,5..27,15 kroky 4');
    expect(r.log).toContain(" pohání: „Přidržovač“ + 1 díl – spolu s ním kvůli pevné vazbě (zámku): „Šroub“ · směr −Z");
    expect(r.codes.map((c) => c.code)).not.toContain("motion.motor-conflict");
    const chk = await motorCheck(r.doc, env, 0);
    expect(chk.reach).toMatchObject({ comps: ["přidržovač", "šroub"], locked: ["šroub"], axis: { dir: [0, 0, -1], rotary: false } });
    expect(axisWord(chk.reach!.axis!)).toBe("směr −Z");
    const h = reachHighlight(chk.reach, 40)!;
    expect(h.comps).toEqual(["přidržovač", "šroub"]);
    expect(h.lines).toHaveLength(3); // osa + dvě čáry hrotu šipky
    expect(h.tip[2]).toBeCloseTo(h.lines[0][0][2] - 40, 9); // hrot 40 mm ve směru pohybu (−Z)
  });

  it("druhý motor na tomtéž stupni volnosti (VEDENÍ × ZDVIH) = ⚠ motion.motor-conflict UŽ PŘI ZADÁNÍ", async () => {
    const env = fakeEnv();
    const r = await runLines(holder(), env, ...SETUP, 'pohyb motor lineární vazba "ZDVIH" 57,5..27,15 kroky 4', 'pohyb motor lineární vazba "VEDENÍ" 0..-10 kroky 4');
    const c = r.codes.filter((x) => x.code === "motion.motor-conflict");
    expect(c).toHaveLength(1);
    expect(c[0].text).toMatch(/^motor 2 \(VEDENÍ\) pohání stejný stupeň volnosti „Přidržovač“ jako motor 1 \(ZDVIH\)/);
    // EN / DE
    for (const lang of ["en", "de"] as const) {
      setLang(lang);
      const r2 = await runLines(holder(), fakeEnv(), ...SETUP, 'pohyb motor lineární vazba "ZDVIH" 57,5..27,15 kroky 4', 'pohyb motor lineární vazba "VEDENÍ" 0..-10 kroky 4');
      expect(r2.codes.find((x) => x.code === "motion.motor-conflict")!.text).toMatch(lang === "en" ? /^motor 2 \(VEDENÍ\) drives the same degree of freedom/ : /^Antrieb 2 \(VEDENÍ\) treibt denselben Freiheitsgrad/);
    }
  });

  it("nezávislé motory (jiný díl) = žádný konflikt; motor v jiném časovém okně na téže vazbě = žádný konflikt", async () => {
    const env = fakeEnv();
    const d = { ...holder(), components: [...holder().components!, mk("Posuv", [10, 10, 10], [300, 0, 20])] };
    const r = await runLines(d, env, ...SETUP, 'sestava vazba vzdálenost "Posuv" F1 "Deska A" F2 hodnota 10 název "POSUV"', 'pohyb motor lineární vazba "ZDVIH" 57,5..27,15 kroky 4', 'pohyb motor lineární vazba "POSUV" 10..20 kroky 4');
    expect(r.codes.map((x) => x.code)).not.toContain("motion.motor-conflict");
    const w = await runLines(r.doc, env, 'pohyb motor lineární vazba "ZDVIH" 27,15..57,5 okno 1..2');
    expect(w.codes.map((x) => x.code)).not.toContain("motion.motor-conflict");
    expect(w.doc.motion!.motors).toHaveLength(3); // pozdější motor na téže vazbě nic nenahradil
  });

  it("motor na téže vazbě se stejným začátkem: nahrazení s ℹ motion.motor-replaced (nikdy potichu); navázat = úseky za dosavadní motor", async () => {
    const env = fakeEnv();
    const a = await runLines(holder(), env, ...SETUP, 'pohyb motor lineární vazba "ZDVIH" 57,5..27,15 kroky 4');
    const b = await runLines(a.doc, env, 'pohyb motor lineární vazba "ZDVIH" 57,5..37,15 kroky 4');
    expect(b.codes.map((x) => x.code)).toContain("motion.motor-replaced");
    expect(b.doc.motion!.motors).toHaveLength(1);
    const c = await runLines(a.doc, env, 'pohyb motor lineární vazba "ZDVIH" navázat pak 57,5 čas 1');
    expect(c.codes.map((x) => x.code)).not.toContain("motion.motor-replaced");
    expect(c.doc.motion!.motors).toHaveLength(1);
    expect(c.doc.motion!.motors[0]).toMatchObject({ from: 57.5, to: 57.5, legs: [{ to: 27.15 }, { to: 57.5, time: 1 }] });
    expect(c.kv).toMatch(/ m1=keys:57\.5>27\.15>57\.5:-\+ /);
    await expect(runLines(a.doc, env, 'pohyb motor lineární vazba "ZDVIH" 40..50 navázat')).rejects.toThrow(/nový úsek začíná na 40, dosavadní motor končí na 27\.15/);
  });

  it("motor, kterým nejde pohnout (stupeň volnosti drží vazby), dostane ⚠ při zadání", async () => {
    const env = fakeEnv();
    const r = await runLines(holder(), env, ...SETUP, 'sestava vazba zámek "Přidržovač" "Deska A"', 'pohyb motor lineární vazba "VEDENÍ" 0..-10 kroky 2');
    const c = r.codes.find((x) => x.code === "motion.motor-conflict");
    expect(c?.text).toMatch(/se nemůže pohnout ani jedním směrem/);
  });
});
