/**
 * Model motoru pohybové studie (cad/motor-model.ts): klíče a úseky pro všechny tvary zadání, bitová shoda s dřívějšími vzorci
 * kinematiky i dynamiky (dosavadní studie dávají stejná čísla), rozsah × rychlost se zastavením na konci, zadání motoru (znaménko,
 * zdvih, začátek), délka studie, texty CS / EN / DE a upozornění.
 */
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import { motorValue } from "./motion";
import { motorAt as dynMotorAt } from "./motion-dynamic";
import { buildMotor, fitDuration, legKeys, motorAt, motorIsAbsolute, motorKeys, motorMeaningText, motorNotes, motorRangeText, motorSpan, profileAt, profileOf } from "./motor-model";
import type { Mate, MotionMotor } from "./types";

afterEach(() => setLang("cs"));
const mo = (o: Partial<MotionMotor>): MotionMotor => ({ id: "m", kind: "linear", mate: "x", from: 0, to: 10, ...o });
const dist: Mate = { id: "x", type: "distance", a: { compId: "a", face: 0 }, b: { compId: "b", face: 0 }, value: 57.5, name: "ZDVIH" };
const conc: Mate = { id: "x", type: "concentric", a: { compId: "a", face: 0 }, b: { compId: "b", face: 0 }, name: "VEDENÍ" };

describe("motorKeys: klíče, úseky a chování za posledním klíčem", () => {
  it("rozsah = dva klíče (0: od, D: do) a stojí; tam a zpět = tři klíče sinusově; jen rychlost = jeden klíč a jede dál; rozsah × rychlost = konec v čase |do − od| / rychlost a stojí", () => {
    expect(motorKeys(mo({ from: 57.5, to: 27.15 }), 2)).toMatchObject({ keys: [{ t: 0, v: 57.5 }, { t: 2, v: 27.15 }], segments: [{ t0: 0, t1: 2, v0: 57.5, v1: 27.15, ease: "linear" }], after: { mode: "hold" } });
    expect(motorKeys(mo({ from: 55, to: 25, back: true }), 2).keys).toEqual([{ t: 0, v: 55 }, { t: 1, v: 25, ease: "sine" }, { t: 2, v: 55, ease: "sine" }]);
    expect(motorKeys(mo({ from: 5, to: 99, speed: 3 }), 2)).toMatchObject({ keys: [{ t: 0, v: 5 }], segments: [], after: { mode: "run", speed: 3, rotary: false } });
    const r = motorKeys(mo({ from: 57.5, to: 27.15, speed: 15.175, ranged: true }), 5);
    expect(r.keys).toEqual([{ t: 0, v: 57.5 }, { t: 2, v: 27.15 }]);
    expect(r.after).toEqual({ mode: "hold" });
    expect(motorKeys(mo({ kind: "rotary", from: 0, to: 720, speed: 60, ranged: true }), 9).keys[1]).toEqual({ t: 2, v: 720 }); // 60 ot/min = 360 °/s
  });
  it("rozsah × rychlost: jede rovnoměrně na konec, tam stojí – i když je studie delší; kratší studie skončí cestou", () => {
    const m = mo({ from: 57.5, to: 27.15, speed: 15.175, ranged: true });
    expect(motorAt(m, 0, 4)).toBe(57.5);
    expect(motorAt(m, 1, 4)).toBeCloseTo(42.325, 12);
    expect(motorAt(m, 2, 4)).toBeCloseTo(27.15, 12);
    expect(motorAt(m, 3, 4)).toBeCloseTo(27.15, 12);
    expect(motorAt(m, 4, 4)).toBeCloseTo(27.15, 12);
    for (let k = 0; k <= 40; k++) expect(motorValue(m, k, 40, 4)).toBeGreaterThanOrEqual(27.15 - 1e-12); // nikdy nepřejede konec
    expect(motorSpan(m, 4)).toMatchObject({ start: 57.5, end: 27.15, stroke: 30.35, dir: -1, mode: "ranged", short: false });
    expect(motorSpan(m, 4).time).toBeCloseTo(2, 12);
    expect(motorSpan(m, 4).hold).toBeCloseTo(2, 12);
    expect(motorSpan(m, 1)).toMatchObject({ short: true });
    expect(motorSpan(m, 1).endAt).toBeCloseTo(42.325, 12);
  });
  it("bitová shoda s dřívějšími vzorci: rozsah, tam a zpět a rychlost v kinematice (krok k z n) i v dynamice (čas t)", () => {
    const oldKin = (m: MotionMotor, k: number, n: number, D: number) => {
      const t = n > 0 ? (D * k) / n : 0;
      if (m.speed !== undefined) return m.from + (m.kind === "rotary" ? (m.speed * 360 * t) / 60 : m.speed * t);
      if (m.back) return m.from + ((m.to - m.from) * (1 - Math.cos((2 * Math.PI * k) / Math.max(1, n)))) / 2;
      return m.from + (n > 0 ? ((m.to - m.from) * k) / n : 0);
    };
    const oldDyn = (m: MotionMotor, t: number, D: number) => {
      if (m.speed !== undefined) return m.from + (m.kind === "rotary" ? (m.speed * 360 * t) / 60 : m.speed * t);
      const s = D > 0 ? Math.min(1, Math.max(0, t / D)) : 0;
      if (m.back) return m.from + ((m.to - m.from) * (1 - Math.cos(2 * Math.PI * s))) / 2;
      return m.from + (m.to - m.from) * s;
    };
    const list = [mo({ from: 57.5, to: 27.15 }), mo({ from: 10, to: 50 }), mo({ kind: "rotary", from: 0, to: 360 }), mo({ from: 55, to: 25, back: true }), mo({ from: 3.3, to: 0, speed: 7.7 }), mo({ kind: "rotary", from: 12, to: 360, speed: 33 })];
    for (const m of list)
      for (const [n, D] of [[36, 2], [112, 0.65], [7, 3], [4, 2], [1, 1]] as const) {
        for (let k = 0; k <= n; k++) expect(Object.is(motorValue(m, k, n, D), oldKin(m, k, n, D)), `kin ${JSON.stringify(m)} ${k}/${n}`).toBe(true);
        for (const t of [0, D / 7, D / 3, D / 2, 0.9 * D, D, 1.3 * D]) expect(Object.is(dynMotorAt(m, t, D), oldDyn(m, t, D)), `dyn ${JSON.stringify(m)} t=${t}`).toBe(true);
      }
  });
  it("obecné klíče (příprava na klíčové polohy a fáze): lineární i sinusové úseky, před prvním a za posledním klíčem", () => {
    const p = profileOf([{ t: 0, v: 57.5 }, { t: 0.3, v: 40 }, { t: 0.6, v: 27.15, ease: "sine" }, { t: 1, v: 57.5 }], { mode: "hold" }, 1.5);
    expect(p.segments.length).toBe(3);
    expect(profileAt(p, 0.15)).toBeCloseTo(48.75, 12);
    expect(profileAt(p, 0.45)).toBeCloseTo((40 + 27.15) / 2, 12); // sinus v polovině úseku = střed
    expect(profileAt(p, 0.8)).toBeCloseTo((27.15 + 57.5) / 2, 12);
    expect(profileAt(p, 1.2)).toBeCloseTo(57.5, 12);
    // klíče „tam a zpět“ popisují totéž co uzavřený vzorec
    const b = mo({ from: 55, to: 25, back: true });
    const keys = profileOf(motorKeys(b, 2).keys, { mode: "hold" }, 2);
    for (const t of [0, 0.3, 0.77, 1, 1.4, 2]) expect(profileAt(keys, t)).toBeCloseTo(motorAt(b, t, 2), 12);
  });
  it("úseky zadání (kam + čas NEBO rychlost) → klíče; úsek nese střední rychlost; profil nese chování na mezi (příprava na body 8 a 3)", () => {
    // nájezd rychlostí, střih za čas, prodleva, návrat rychlostí sinusově
    const keys = legKeys(57.5, [{ to: 40, speed: 35 }, { to: 27.15, time: 0.5 }, { to: 27.15, time: 0.2 }, { to: 57.5, speed: 60.7, ease: "sine" }]);
    expect(keys.map((k) => [Math.round(k.t * 1e9) / 1e9, k.v, k.ease ?? "linear"])).toEqual([[0, 57.5, "linear"], [0.5, 40, "linear"], [1, 27.15, "linear"], [1.2, 27.15, "linear"], [1.7, 57.5, "sine"]]);
    const p = profileOf(keys, { mode: "hold" }, 2);
    expect(p.segments.map((g) => Math.round(g.rate * 1e6) / 1e6)).toEqual([-35, -25.7, 0, 60.7]);
    expect(profileAt(p, 0.25)).toBeCloseTo(48.75, 12);
    expect(profileAt(p, 1.1)).toBeCloseTo(27.15, 12); // prodleva
    expect(profileAt(p, 1.45)).toBeCloseTo((27.15 + 57.5) / 2, 12); // sinusový návrat v polovině
    expect(profileAt(p, 1.9)).toBeCloseTo(57.5, 12); // za posledním klíčem stojí
    // chování na mezi vazby je vlastnost profilu: dnes vždy „continue“ (řešič žádá požadovanou hodnotu), „stop“ doplní etapa M2
    expect(p.atLimit).toBe("continue");
    expect(profileOf(keys, { mode: "hold" }, 2, "stop").atLimit).toBe("stop");
    // dnešní tvary jdou stejnou cestou: rozsah × rychlost = jeden úsek „kam rychlostí“, rozsah = „kam za dobu studie“
    expect(motorKeys(mo({ from: 57.5, to: 27.15, speed: 15.175, ranged: true }), 5)).toMatchObject({ atLimit: "continue", segments: [{ t0: 0, t1: 2, rate: -15.175 }] });
    expect(motorKeys(mo({ from: 57.5, to: 27.15 }), 2).segments[0].rate).toBeCloseTo(-15.175, 12);
    expect(motorKeys(mo({ kind: "rotary", from: 0, to: 720, speed: 60, ranged: true }), 9).segments[0].rate).toBe(360); // 60 ot/min = 360 °/s
  });
});

describe("zadání motoru: buildMotor a délka studie", () => {
  const o = { id: "m1", mate: "x" };
  it("absolutní vazba: znaménko se neobrací ani pro komponentu B; relativní: obrací", () => {
    expect(motorIsAbsolute({ kind: "linear" }, dist)).toBe(true);
    expect(motorIsAbsolute({ kind: "linear" }, conc)).toBe(false);
    expect(motorIsAbsolute({ kind: "rotary" }, conc)).toBe(false);
    expect(motorIsAbsolute({ kind: "linear" }, { type: "slot", value: 12 })).toBe(true);
    expect(motorIsAbsolute({ kind: "linear" }, { type: "slot" })).toBe(false);
    expect(buildMotor({ kind: "linear", from: 57.5, to: 27.15 }, { ...o, abs: true, current: 57.5, sign: -1 })).toMatchObject({ from: 57.5, to: 27.15 });
    expect(buildMotor({ kind: "linear", from: 0, to: -30.35 }, { ...o, abs: false, current: 0, sign: -1 })).toMatchObject({ from: -0, to: 30.35 });
  });
  it("začátek nezadán = aktuální hodnota; zdvih = konec o Δ od začátku; bez konce i zdvihu výchozí zdvih +10 mm / +360°", () => {
    expect(buildMotor({ kind: "linear", stroke: -30.35 }, { ...o, abs: true, current: 57.5 })).toMatchObject({ from: 57.5, to: 27.15 });
    expect(buildMotor({ kind: "linear" }, { ...o, abs: true, current: 57.5 })).toMatchObject({ from: 57.5, to: 67.5 });
    expect(buildMotor({ kind: "rotary" }, { ...o, abs: false, current: 0 })).toMatchObject({ from: 0, to: 360 });
    expect(buildMotor({ kind: "linear", speed: -5 }, { ...o, abs: true, current: 57.5 })).toEqual({ id: "m1", kind: "linear", mate: "x", from: 57.5, to: 57.5, speed: -5 });
  });
  it("rozsah / zdvih + rychlost = ranged s kladnou velikostí rychlosti; rozpory jsou chyby s vysvětlením", () => {
    expect(buildMotor({ kind: "linear", from: 57.5, to: 27.15, speed: 15.175 }, { ...o, abs: true, current: 57.5 })).toEqual({ id: "m1", kind: "linear", mate: "x", from: 57.5, to: 27.15, speed: 15.175, ranged: true });
    expect(buildMotor({ kind: "linear", from: 57.5, to: 27.15, speed: -15.175 }, { ...o, abs: true, current: 57.5 })).toMatchObject({ speed: 15.175, ranged: true });
    expect(() => buildMotor({ kind: "linear", from: 27.15, to: 57.5, speed: -1 }, { ...o, abs: true, current: 57.5 })).toThrow(/záporná, ale rozsah 27,15 → 57,5 mm roste/);
    expect(() => buildMotor({ kind: "linear", from: 5, to: 5, speed: 1 }, { ...o, abs: true, current: 5 })).toThrow(/rozsah od–do je nulový/);
    expect(() => buildMotor({ kind: "linear", from: 5, to: 9, speed: 1, back: true }, { ...o, abs: true, current: 5 })).toThrow(/tam a zpět/);
    expect(() => buildMotor({ kind: "linear", from: 5, stroke: 0 }, { ...o, abs: true, current: 5 })).toThrow(/zdvih je nulový/);
  });
  it("délka studie: jediný motor = doba jízdy; výslovný kratší čas = chyba; víc motorů = prodloužení s ⚠, delší studie zůstane", () => {
    const r = mo({ id: "a", from: 57.5, to: 27.15, speed: 15.175, ranged: true });
    expect(fitDuration({ motors: [r], duration: 7, steps: 36 }, 0)).toEqual({ duration: 2 });
    expect(fitDuration({ motors: [r], duration: 7, steps: 36 }, 0, 3)).toEqual({ duration: 3 });
    expect(() => fitDuration({ motors: [r], duration: 7, steps: 36 }, 0, 1)).toThrow(/trvá 2 s, zadaný čas 1 s nestačí/);
    const other = mo({ id: "b", mate: "y" });
    const ext = fitDuration({ motors: [other, r], duration: 1, steps: 36 }, 1);
    expect(ext.duration).toBe(2);
    expect(ext.note).toMatchObject({ code: "motion.duration-extended", args: [2, "1", "2"] });
    expect(fitDuration({ motors: [other, r], duration: 5, steps: 36 }, 1)).toEqual({ duration: 5 });
    expect(fitDuration({ motors: [other], duration: 5, steps: 36 }, 0)).toEqual({ duration: 5 }); // rozsah bez rychlosti délku neurčuje
  });
});

describe("texty: zdvih a směr vždy, význam hodnot, CS / EN / DE", () => {
  it("cs", () => {
    expect(motorRangeText(mo({ from: 57.5, to: 27.15 }), 2)).toBe("57,5 → 27,15 mm ↓ zdvih 30,35 mm");
    expect(motorRangeText(mo({ from: 27.15, to: 57.5 }), 2)).toBe("27,15 → 57,5 mm ↑ zdvih 30,35 mm");
    expect(motorRangeText(mo({ from: 57.5, to: 27.15, speed: 15.175, ranged: true }), 2)).toBe("57,5 → 27,15 mm ↓ zdvih 30,35 mm · 15,175 mm/s · 2 s");
    expect(motorRangeText(mo({ from: 57.5, to: 27.15, speed: 15.175, ranged: true }), 3)).toBe("57,5 → 27,15 mm ↓ zdvih 30,35 mm · 15,175 mm/s · 2 s (pak stojí do konce studie 3 s)");
    expect(motorRangeText(mo({ from: 55, to: 25, back: true }), 2)).toBe("55 → 25 → 55 mm ↓↑ zdvih 30 mm tam a zpět");
    expect(motorRangeText(mo({ kind: "rotary", from: 0, to: 360 }), 2)).toBe("0 → 360° ↺ otočení 360°");
    expect(motorRangeText(mo({ kind: "rotary", from: 0, to: -90 }), 2)).toBe("0 → -90° ↻ otočení 90°");
    expect(motorRangeText(mo({ from: 57.5, to: 57.5, speed: 15.175 }), 2)).toBe("od 57,5 mm ↑ rychlostí 15,175 mm/s (bez koncové hodnoty – za 2 s na 87,85 mm)");
    // starší dokument: konec uložený vedle rychlosti se nepoužívá – text to říká (dřív zmizel beze slova)
    expect(motorRangeText(mo({ from: 57.5, to: 27.15, speed: 15.175 }), 2)).toBe("od 57,5 mm ↑ rychlostí 15,175 mm/s (bez koncové hodnoty – za 2 s na 87,85 mm) · uložený konec 27,15 mm se nepoužívá");
    expect(motorMeaningText(mo({ from: 57.5, to: 27.15 }), true, 2)).toBe("hodnota vazby 57,5 → 27,15 mm ↓ zdvih 30,35 mm");
    expect(motorMeaningText(mo({ from: 0, to: -30.35 }), false, 2)).toBe("posuv od výchozí polohy 0 → -30,35 mm ↓ zdvih 30,35 mm");
    expect(motorMeaningText(mo({ kind: "rotary", from: 0, to: 360 }), false, 2)).toBe("natočení od výchozí polohy 0 → 360° ↺ otočení 360°");
  });
  it("en / de: celé věty přeložené, desetinná tečka v EN, žádný český zlomek (dřív „15.175 mm/s od 57.5 mm“)", () => {
    const list = [mo({ from: 57.5, to: 27.15, speed: 15.175, ranged: true }), mo({ from: 57.5, to: 27.15, speed: 15.175 }), mo({ from: 55, to: 25, back: true }), mo({ kind: "rotary", from: 0, to: 720, speed: 60, ranged: true }), mo({ kind: "rotary", from: 10, to: 10, speed: -30 })];
    setLang("en");
    expect(motorMeaningText(list[0], true, 3)).toBe("mate value 57.5 → 27.15 mm ↓ stroke 30.35 mm · 15.175 mm/s · 2 s (then stands until the end of the study at 3 s)");
    expect(motorMeaningText(list[1], true, 2)).toBe("mate value from 57.5 mm ↑ at 15.175 mm/s (no end value – at 87.85 mm after 2 s) · the stored end 27.15 mm is not used");
    expect(motorMeaningText(list[3], false, 2)).toBe("rotation from the initial pose 0 → 720° ↺ turn 720° · 60 rpm · 2 s");
    for (const m of list) expect(motorMeaningText(m, false, 2)).not.toMatch(/ od |zdvih|otočení|rychlostí|tam a zpět|ot\/min|polohy|konec/);
    setLang("de");
    expect(motorMeaningText(list[0], true, 2)).toBe("Verknüpfungswert 57,5 → 27,15 mm ↓ Hub 30,35 mm · 15,175 mm/s · 2 s");
    expect(motorMeaningText(list[2], false, 2)).toBe("Verschiebung ab Ausgangslage 55 → 25 → 55 mm ↓↑ Hub 30 mm hin und zurück");
    for (const m of list) expect(motorMeaningText(m, false, 2)).not.toMatch(/ od |zdvih|otočení|rychlostí|tam a zpět|ot\/min|polohy|konec/);
  });
});

describe("upozornění k motorům", () => {
  const label = (m: Mate) => m.name ?? m.type;
  it("začátek ≠ aktuální hodnota (absolutní i relativní vazba), naměřená hodnota má přednost před hodnotou z dokumentu", () => {
    const st = { motors: [mo({ from: 0, to: 30.35 })], duration: 2 };
    expect(motorNotes(st, [dist], label).map((x) => x.code)).toEqual(["motion.start-jump"]);
    expect(motorNotes(st, [dist], label)[0]).toMatchObject({ args: [1, "0 mm", "57,5 mm"] });
    expect(motorNotes({ motors: [mo({ from: 57.5, to: 27.15 })], duration: 2 }, [dist], label)).toEqual([]);
    expect(motorNotes({ motors: [mo({ from: 57.5, to: 27.15 })], duration: 2 }, [dist], label, [{ abs: true, current: 40 }]).map((x) => x.code)).toEqual(["motion.start-jump"]);
    expect(motorNotes({ motors: [mo({ from: 57.5, to: 27.15 })], duration: 2 }, [conc], label)[0].text).toMatch(/není 0 – u vazby „VEDENÍ“/);
    expect(motorNotes({ motors: [mo({ from: 57.505, to: 27.15 })], duration: 2 }, [dist], label)).toEqual([]); // pod 0,01 mm
  });
  it("motor nedojede (studie kratší než jízda); mezera pod nulou jen bez kontroly kolizí a ne u vazby „obráceně“", () => {
    const r = mo({ from: 57.5, to: 27.15, speed: 15.175, ranged: true });
    expect(motorNotes({ motors: [r], duration: 1 }, [dist], label).map((x) => x.code)).toEqual(["motion.motor-short"]);
    expect(motorNotes({ motors: [r], duration: 2 }, [dist], label)).toEqual([]);
    const neg = mo({ from: 57.5, to: -5 });
    expect(motorNotes({ motors: [neg], duration: 2 }, [dist], label).map((x) => x.code)).toEqual(["motion.gap-negative"]);
    expect(motorNotes({ motors: [neg], duration: 2, collisions: true }, [dist], label)).toEqual([]);
    expect(motorNotes({ motors: [neg], duration: 2 }, [{ ...dist, flip: true }], label)).toEqual([]);
    expect(motorNotes({ motors: [mo({ from: 0, to: -5 })], duration: 2 }, [conc], label)).toEqual([]); // posuv od výchozí polohy smí být záporný
  });
});
