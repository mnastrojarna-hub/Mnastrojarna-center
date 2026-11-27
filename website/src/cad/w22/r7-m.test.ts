/**
 * Vlna 22, balík M – fáze 2, kolo 7 bez jádra (syntetické plochy, w22-motion-fixture): tvar čísla v řádku stavu pohybu, skutečný
 * dojezd zkráceného motoru na strojovém řádku (bod 9), vazby formuláře motoru po rolích (bod 10). Na kódu před kolem 7 selhávají.
 */
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "../i18n";
import { inStepsWord, stepsWord } from "../motion";
import { motionStatusOf, motionStoreOf, type MotionSlot } from "../motion-cache";
import { motorMateGroups } from "../motor-model";
import type { Mate } from "../types";
import { fakeEnv, press, runLines } from "./w22-motion-fixture";

afterEach(() => setLang("cs"));
const MATE = 'sestava vazba vzdálenost "Deska A" F1 "Rám" F2 hodnota 57.5 název "ZDVIH"';

describe("kolo 7 – řádek stavu, strojový řádek, vazby motoru", () => {
  it("řádek stavu „Pohyb: výsledek platí … – N kroků“ má tvar čísla podle počtu (dřív vždy „{0} kroků“: „4 kroků“, „1 kroků“)", async () => {
    const owner = {};
    const slot = (key: string): MotionSlot => ({ key, store: motionStoreOf(owner) });
    for (const [n, word] of [[4, "4 kroky"], [1, "1 krok"], [12, "12 kroků"]] as const) {
      const a = await runLines(press(), { ...fakeEnv(), motion: slot(`k${n}`) }, MATE, `pohyb motor lineární vazba 1 57,5..27,15 kroky ${n}`);
      const line = motionStatusOf(slot(`k${n}`).store, `k${n}`, a.doc)!.line;
      expect(line).toBe(`Pohyb: výsledek platí pro tento stav sestavy – ${word}, vazby splněny, kolize nekontrolovány (podrobně pohyb stav)`);
    }
    setLang("en");
    const e = await runLines(press(), { ...fakeEnv(), motion: slot("en") }, MATE, "motion motor linear mate 1 57.5..27.15 steps 1");
    expect(motionStatusOf(slot("en").store, "en", e.doc)!.line).toMatch(/ – 1 step, /);
  });
  it("6. pád počtu kroků: „v 1 kroku“, „v 4 krocích“ (dřív „průnik těles v 1 krocích“)", () => {
    expect(inStepsWord(1)).toBe("v 1 kroku");
    expect(inStepsWord(4)).toBe("v 4 krocích");
    expect(stepsWord(2)).toBe("2 kroky");
    setLang("de");
    expect(inStepsWord(1)).toBe("in 1 Schritt");
    expect(inStepsWord(5)).toBe("in 5 Schritten");
  });
  it("bod 9: zkrácená studie – strojový řádek nese skutečný dojezd `m1.end=42.325` na konci (pole m1= dál zadaný rozsah); nezkrácená bez pole", async () => {
    const env = fakeEnv();
    const a = await runLines(press(), env, MATE, "pohyb motor lineární vazba 1 57.5..27.15 rychlost 15.175", "pohyb čas 1", "pohyb");
    expect(a.kv).toMatch(/ m1=ranged:57\.5>27\.15:- /);
    expect(a.kv).toMatch(/ m1\.end=42\.325$/);
    expect(a.codes.some((c) => c.code === "motion.motor-short")).toBe(true);
    const b = await runLines(press(), env, MATE, "pohyb motor lineární vazba 1 57.5..27.15 rychlost 15.175", "pohyb");
    expect(b.kv).not.toMatch(/m1\.end=/);
  });
  it("bod 10: vazby pro motor po rolích – hodnota vazby (hlavní zdvih) × vedení; čísla motorů, které vazbu pohánějí", () => {
    const m = (id: string, type: Mate["type"], value?: number) => ({ id, type, ...(value !== undefined ? { value } : {}) }) as Pick<Mate, "id" | "type" | "value">;
    const mates = [m("ved", "concentric"), m("zdvih", "distance", 57.5), m("drazka", "slot"), m("poloha", "slot", 3)];
    const g = motorMateGroups(mates, "linear", [{ mate: "zdvih" }, { mate: "ved" }, { mate: "zdvih" }]);
    expect(g.value.map((x) => x.id)).toEqual(["zdvih", "poloha"]);
    expect(g.guide.map((x) => x.id)).toEqual(["ved", "drazka"]);
    expect(g.driven.get("zdvih")).toEqual([1, 3]);
    expect(g.driven.get("ved")).toEqual([2]);
    // rotační motor: hodnotu vazby neřídí – jen vedení (osa)
    const r = motorMateGroups([m("zaves", "hinge"), m("ved", "concentric")], "rotary");
    expect(r.value).toEqual([]);
    expect(r.guide.map((x) => x.id)).toEqual(["zaves", "ved"]);
  });
});
