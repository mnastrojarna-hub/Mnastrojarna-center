/**
 * Vlna 22, balík M – opravy po nezávislé kontrole etapy 1 (11 nálezů): každá zkouška na kódu před opravou selhává.
 *
 *  1. posun dílu UVNITŘ podsestavy → výsledek studie neplatí (dřív `motion=ok` a starý souhrn „Kolize: žádné“)
 *  2. dynamika po změně materiálu dílu → výsledek neplatí; kinematika na materiálu nezávisí
 *  3. starý dokument (rychlost + uložený konec bez `ranged`) → ⚠ motion.end-unused při výpočtu i při načtení
 *  4. směr a konec motoru na strojovém řádku `= … motion … m1=<průběh>:<začátek>><konec>:<směr>` (stručný protokol)
 *  5. `motion=ok` jen po kontrole kolizí bez průniku a bez upozornění k motorům (`mates-ok`, `warn`)
 *  6. druhý výpočet TÉHOŽ vstupu se připojí k běžícímu (žádné nepravdivé „sestava se mezitím změnila“)
 *  7. jediný motor nemění potichu dříve zadanou délku studie (ℹ motion.duration-set), dynamiku nezkracuje
 *  8. převod do skriptu: nepoužitý uložený konec dá poznámku; chyba rozporu s časem zmíní starší význam zápisu
 *  9. pořadí polí řádku `= … status …` (motion, pak příznaky z jiné revize)
 * 10. bez názvu etapy, který je zároveň názvem zákazníkova nástroje, v názvech souborů zkoušek
 * (11. chyba výpočtu v panelu jen u svého dokumentu – e2e cad-w22-m.e2e.cjs, oddíl 6)
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { motionCached, motionKv, motorKv, motionRun } from "../asm-agent-kin";
import { emptyAssembly, partComponent } from "../assembly";
import { docToScript } from "../doc-script";
import { statusKv } from "../engine/kv";
import { motionSig, motionState, motionStatusOf, motionStoreOf, runStored, type MotionSlot } from "../motion-cache";
import type { MotionResult } from "../motion";
import { fitDuration } from "../motor-model";
import type { CadDoc, MotionMotor, Vec3 } from "../types";
import { boxPart, fakeEnv, press, runLines } from "./w22-motion-fixture";

const MATE = 'sestava vazba vzdálenost "Deska A" F1 "Rám" F2 hodnota 57.5 název "ZDVIH"';
const MOTOR = "pohyb motor lineární vazba 1 57,5..27,15 kroky 4";
/** úložiště prostředí bez `env.motion` (zkoušky bez aplikace): klíč "" */
const slotOf = (env: { geo: object }): MotionSlot => ({ key: "", store: motionStoreOf(env.geo) });
const fake = (tag: number): MotionResult => ({ steps: [{ i: 0, t: tag, motors: [], place: {}, conflicts: [] }], comps: [], motors: [], collision: null, collisionsChecked: false, conflictSteps: 0 });
const defer = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

/** sestava s podsestavou „Skupina“ (díl „Doraz“ v Z 20 – mimo dráhu desky) */
function withSub(d: CadDoc): CadDoc {
  const sub: CadDoc = { ...emptyAssembly("Skupina"), components: [{ ...partComponent(boxPart("Doraz", [20, 20, 5]), { position: [0, 0, 20] }), id: "doraz" }] };
  return { ...d, components: [...(d.components ?? []), { id: "skupina", name: "Skupina", source: { kind: "asm", doc: sub }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } }] };
}
/** změna komponenty UVNITŘ podsestavy (jako `sestava upravit "Skupina"` … `sestava hotovo`) */
function editNested(d: CadDoc, change: (c: NonNullable<CadDoc["components"]>[number]) => NonNullable<CadDoc["components"]>[number]): CadDoc {
  return {
    ...d,
    components: (d.components ?? []).map((c) => (c.id === "skupina" && c.source.kind === "asm" ? { ...c, source: { kind: "asm" as const, doc: { ...c.source.doc, components: (c.source.doc.components ?? []).map(change) } } } : c)),
  };
}
const setMaterial = (d: CadDoc, comp: string, material: string): CadDoc => ({
  ...d,
  components: (d.components ?? []).map((c) => (c.name === comp && c.source.kind === "part" ? { ...c, source: { kind: "part" as const, doc: { ...c.source.doc, material } } } : c)),
});
/** motor uložený starší verzí přesným příkazem zprávy: od 57,5, konec 27,15, rychlost 15,175, BEZ `ranged` */
const legacyMotor = (mate: string): MotionMotor => ({ id: "mo", kind: "linear", mate, from: 57.5, to: 27.15, speed: 15.175 });

describe("1 – posun dílu uvnitř podsestavy", () => {
  it("otisk se změní, `motionCached` nic nevrátí, stav NEPLATÍ jmenuje podsestavu, `pohyb stav` ⚠, `pohyb spustit` ℹ přepočítá", async () => {
    const env = fakeEnv();
    const a = await runLines(withSub(press()), env, MATE, MOTOR);
    expect(motionCached(a.doc, env)).not.toBeNull();
    // díl podsestavy posunutý do dráhy desky (Z 40) – polohy komponent nejvyšší úrovně beze změny
    const moved = editNested(a.doc, (c) => ({ ...c, placement: { ...c.placement, position: [0, 0, 40] as Vec3 } }));
    expect(moved.components!.map((c) => c.placement)).toEqual(a.doc.components!.map((c) => c.placement));
    expect(motionSig(moved)).not.toBe(motionSig(a.doc)); // dřív stejný otisk
    expect(motionCached(moved, env)).toBeNull(); // dřív starý výsledek jako platný
    const { store, key } = slotOf(env);
    const st = motionStatusOf(store, key, moved)!;
    expect(st.state).toBe("stale");
    expect(st.line).toBe("Pohyb: výsledek NEPLATÍ – od výpočtu se změnilo: poloha, ukotvení, skrytí nebo vazby komponent v podsestavě „Skupina“; přepočítá „pohyb spustit“");
    expect(statusKv(moved, null, { components: 3, parts: 3, motion: st })).toMatch(/ motion=stale motion\.stale=1$/);
    const ps = await runLines(moved, env, "pohyb stav");
    expect(ps.codes.map((c) => c.code)).toEqual(["motion.stale"]);
    expect(ps.log.join("\n")).not.toMatch(/Vazby splněny ve všech krocích|Kolize: žádné/);
    const run = await runLines(moved, env, "pohyb spustit");
    expect(run.codes.map((c) => c.code)).toEqual(["motion.recomputed"]);
    expect(run.codes[0].args).toEqual(["poloha, ukotvení, skrytí nebo vazby komponent v podsestavě „Skupina“"]);
    expect(motionCached(moved, env)).not.toBeNull();
  });
  it("skrytí a ukotvení vnořené komponenty také; beze změny obsahu otisk stejný; posun celé podsestavy = poloha komponent", async () => {
    const env = fakeEnv();
    const a = await runLines(withSub(press()), env, MATE, MOTOR);
    const sig = motionSig(a.doc);
    expect(motionSig(editNested(a.doc, (c) => ({ ...c })))).toBe(sig);
    expect(motionSig(editNested(a.doc, (c) => ({ ...c, hidden: true })))).not.toBe(sig);
    expect(motionSig(editNested(a.doc, (c) => ({ ...c, fixed: true })))).not.toBe(sig);
    const top = { ...a.doc, components: a.doc.components!.map((c) => (c.id === "skupina" ? { ...c, placement: { ...c.placement, position: [5, 0, 0] as Vec3 } } : c)) };
    const st = motionState(top, env);
    expect(st.state === "stale" && st.changed).toEqual(["poloha, ukotvení nebo skrytí komponent"]);
  });
});

describe("2 – materiál dílu v dynamice", () => {
  it("dynamika: změna materiálu dílu = výsledek neplatí (hmotnost = objem × hustota); kinematika: beze změny", async () => {
    const env = fakeEnv();
    const dyn = await runLines(press(), env, MATE, "pohyb dynamika čas 0,02 krok 0,001 gravitace vyp");
    expect(dyn.doc.motion!.mode).toBe("dynamic");
    expect(motionCached(dyn.doc, env)).not.toBeNull();
    const alu = setMaterial(dyn.doc, "Deska A", "hlinik");
    expect(motionCached(alu, env)).toBeNull(); // dřív výsledek spočítaný pro ocel jako platný
    const st = motionState(alu, env);
    expect(st.state === "stale" && st.changed).toEqual(["materiál dílu „Deska A“ (hmotnost v dynamice)"]);
    const ps = await runLines(alu, env, "pohyb stav");
    expect(ps.codes.map((c) => c.code)).toEqual(["motion.stale"]);
    // kinematika na hmotnosti nezávisí – materiál výsledek nezneplatní
    const env2 = fakeEnv();
    const kin = await runLines(press(), env2, MATE, MOTOR);
    expect(motionSig(setMaterial(kin.doc, "Deska A", "hlinik"))).toBe(motionSig(kin.doc));
    expect(motionCached(setMaterial(kin.doc, "Deska A", "hlinik"), env2)).not.toBeNull();
  });
});

describe("3 – starý dokument s rychlostí a uloženým koncem", () => {
  it("výpočet: ⚠ motion.end-unused s hodnotami a návodem (dřív jen dovětek v textu motoru, bez kódu)", async () => {
    const env = fakeEnv();
    const a = await runLines(press(), env, MATE);
    const legacy: CadDoc = { ...a.doc, motion: { motors: [legacyMotor(a.doc.mates![0].id)], duration: 2, steps: 36 } };
    const r = await runLines(legacy, env, "pohyb spustit");
    expect(r.codes.map((c) => c.code)).toEqual(["motion.end-unused"]);
    expect(r.codes[0].args).toEqual([1, "27,15 mm", "87,85 mm"]);
    expect(r.codes[0].text).toBe(
      "motor 1: uložený konec 27,15 mm se nepoužívá – motor jede od 57,5 mm rychlostí 15,175 mm/s bez koncové hodnoty, na konci studie je na 87,85 mm (opačným směrem, než leží konec); dokument ze starší verze – dojet na konec a stát: pohyb motor lineární vazba 1 57,5..27,15 rychlost 15,175 (v panelu Převést na rozsah × rychlost)",
    );
    // stručný protokol: směr a skutečný konec na strojovém řádku
    expect(r.kv).toMatch(/ m1=open:57\.5>87\.85:\+ level=kin groups=\S+$/); // vlna 22, M2: úroveň simulace na konci řádku
    // verdikt: ne „ok“ ani „mates-ok“
    const { store, key } = slotOf(env);
    expect(motionStatusOf(store, key, legacy)!.state).toBe("warn");
    // výchozí konec staršího zadání bez rozsahu (10 mm / 360°) se nehlásí; nový zápis „od A rychlost V“ (to = from) také ne
    const plain = { ...legacy, motion: { ...legacy.motion!, motors: [{ ...legacyMotor(a.doc.mates![0].id), to: 10 }] } };
    expect((await runLines(plain, env, "pohyb spustit")).codes.map((c) => c.code)).not.toContain("motion.end-unused");
    const open = await runLines(a.doc, env, "pohyb motor lineární vazba 1 od 57.5 rychlost 15.175 kroky 4");
    expect(open.codes.map((c) => c.code)).not.toContain("motion.end-unused");
  });
});

describe("4 – směr a konec motoru na strojovém řádku", () => {
  it("přesný příkaz zprávy: `m1=ranged:57.5>27.15:-` na konci řádku (dřív řádek bajt po bajtu stejný jako při jízdě opačně)", async () => {
    const env = fakeEnv();
    const r = await runLines(press(), env, MATE, "pohyb motor lineární vazba 1 57.5..27.15 rychlost 15.175");
    expect(r.kv).toBe("motion steps=36 t=2 motors=1 conflicts=0 travel=30.35mm:1 static=1 m1=ranged:57.5>27.15:- level=kin groups=1:z-30.35"); // M2: úroveň na konci; M3: tuhé skupiny
    // výsledek, který neplatí: definice motorů zůstává na řádku (bez výsledkových polí)
    const st = await runLines({ ...r.doc, motion: { ...r.doc.motion!, steps: 9 } }, env, "pohyb stav");
    expect(st.kv).toBe("motion steps=9 t=2 motors=1 motion.stale=1 m1=ranged:57.5>27.15:-");
  });
  it("průběhy: rozsah, tam a zpět, rozsah × rychlost, jen rychlost; rotační ve stupních", () => {
    const m = (o: Partial<MotionMotor>): MotionMotor => ({ id: "m", kind: "linear", mate: "x", from: 0, to: 10, ...o });
    expect(motorKv([m({ from: 167, to: 117 })], 2)).toEqual(["m1=range:167>117:-"]);
    expect(motorKv([m({ from: 55, to: 25, back: true })], 0.5)).toEqual(["m1=back:55>25>55:-+"]);
    expect(motorKv([m({ from: 57.5, to: 27.15, speed: 15.175, ranged: true })], 3)).toEqual(["m1=ranged:57.5>27.15:-"]);
    expect(motorKv([m({ from: 57.5, to: 57.5, speed: -10 })], 2)).toEqual(["m1=open:57.5>37.5:-"]);
    expect(motorKv([m({ kind: "rotary", from: 0, to: 720, speed: 60, ranged: true }), m({ from: 0, to: 30 })], 3)).toEqual(["m1=ranged:0>720:+", "m2=range:0>30:+"]);
    const res: MotionResult = { ...fake(2), motors: [m({ from: 10, to: 50 })] };
    expect(motionKv(res, null)).toMatch(/ m1=range:10>50:\+ level=kin$/); // M2: úroveň simulace na konci řádku
  });
});

describe("5 – `motion=ok` jen po skutečné kontrole", () => {
  it("kolize nekontrolovány = `mates-ok`; ⚠ k motorům = `warn`; kontrola kolizí bez průniku = `ok`", async () => {
    const kvOf = (env: { geo: object }, d: CadDoc) => {
      const { store, key } = slotOf(env);
      return statusKv(d, null, { components: 2, parts: 2, motion: motionStatusOf(store, key, d) });
    };
    const env = fakeEnv();
    const a = await runLines(press(), env, MATE, MOTOR);
    expect(kvOf(env, a.doc)).toMatch(/ motion=mates-ok$/);
    expect(kvOf(env, a.doc)).not.toMatch(/motion=ok/);
    // začátek ≠ aktuální hodnota (⚠ motion.start-jump): vazby splněné, ale ne „ok“
    const jump = await runLines(a.doc, env, "pohyb motor lineární vazba 1 0..30,35 kroky 2");
    const { store, key } = slotOf(env);
    const s = motionStatusOf(store, key, jump.doc)!;
    expect(s.state).toBe("warn");
    expect(s.line).toBe("Pohyb: výsledek platí pro tento stav sestavy – 2 kroků, vazby splněny, kolize nekontrolovány, ⚠ upozornění k motorům: 1 (podrobně pohyb stav)");
    // mezera pod nulou bez kontroly kolizí: také „warn“
    const gap = await runLines(a.doc, env, "pohyb motor lineární vazba 1 57,5..-5 kroky 2");
    expect(motionStatusOf(store, key, gap.doc)!.state).toBe("warn");
    // skutečná kontrola kolizí v každém kroku bez průniku → „ok“
    const env2 = { ...fakeEnv(), interference: async () => [] };
    const c = await runLines(press(), env2, MATE, `${MOTOR} kolize`);
    expect(kvOf(env2, c.doc)).toMatch(/ motion=ok$/);
    // fáze 2 kolo 3 (bod 6): bez sledované vůle „bez průniku“ výslovně s „vůle nekontrolována“
    expect(motionStatusOf(slotOf(env2).store, "", c.doc)!.line).toMatch(/bez průniku těles v kontrolovaných krocích, vůle nekontrolována \(podrobně pohyb stav\)$/);
  });
});

describe("6 – souběh výpočtů téhož vstupu", () => {
  it("dva souběžné `motionRun` téhož dokumentu: oba doběhnou se stejným výsledkem (dřív starší ✗ MotionSuperseded)", async () => {
    const env = fakeEnv();
    const a = await runLines(press(), env, MATE);
    const doc: CadDoc = { ...a.doc, motion: { motors: [{ id: "m", kind: "linear", mate: a.doc.mates![0].id, from: 57.5, to: 27.15 }], duration: 2, steps: 4 } };
    const r = await Promise.allSettled([motionRun(doc, env), motionRun(doc, env)]);
    expect(r.map((x) => x.status)).toEqual(["fulfilled", "fulfilled"]);
    const [x, y] = r as PromiseFulfilledResult<MotionResult>[];
    expect(x.value).toBe(y.value); // jeden výpočet, týž výsledek
    expect(motionCached(doc, env)).toBe(x.value);
  });
  it("textový příkaz `pohyb spustit` a současně `window.mncad.motion()` (motionRun) nad týmž stavem: oba ok", async () => {
    const env = fakeEnv();
    const a = await runLines(press(), env, MATE, MOTOR);
    const ch = { ...a.doc, motion: { ...a.doc.motion!, steps: 6 } };
    const r = await Promise.allSettled([runLines(ch, env, "pohyb spustit"), motionRun(ch, env)]);
    expect(r.map((x) => x.status)).toEqual(["fulfilled", "fulfilled"]);
  });
  it("připojený volající: jeden výpočet, průběh dostanou oba; zrušení až když zruší všichni; jiný vstup dál nahrazuje", async () => {
    const env = fakeEnv();
    const { doc } = await runLines(press(), env, MATE);
    const slot: MotionSlot = { key: "d", store: motionStoreOf({}) };
    const d1 = { ...doc, motion: { motors: [], duration: 2, steps: 5 } };
    const a = defer<MotionResult>();
    let calls = 0;
    let step!: (k: number, n: number) => void;
    let cancel!: () => boolean;
    const seen1: number[] = [];
    const seen2: number[] = [];
    const c1 = { v: false };
    const c2 = { v: false };
    const p1 = runStored(slot, d1, (cn, on) => ((calls++, (cancel = cn), (step = on)), a.promise), () => c1.v, (k) => seen1.push(k));
    const p2 = runStored(slot, { ...d1 }, () => (calls++, Promise.reject(new Error("druhý výpočet téhož vstupu se nesmí spustit"))), () => c2.v, (k) => seen2.push(k));
    expect(calls).toBe(1);
    step(3, 5);
    expect([seen1, seen2]).toEqual([[3], [3]]);
    c1.v = true;
    expect(cancel()).toBe(false); // druhý volající výsledek dál chce
    c2.v = true;
    expect(cancel()).toBe(true); // zrušili oba
    c1.v = c2.v = false;
    a.resolve(fake(5));
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
    expect(slot.store.byDoc.get("d")!.sig).toBe(motionSig(d1));
    expect(slot.store.running.size).toBe(0);
    // jiný vstup: běžící výpočet se nahradí (MotionSuperseded) – beze změny
    const b = defer<MotionResult>();
    const pOld = runStored(slot, d1, () => b.promise);
    const pNew = runStored(slot, { ...d1, motion: { ...d1.motion, steps: 9 } }, async () => fake(9));
    expect((await pNew).steps[0].t).toBe(9);
    b.resolve(fake(5));
    await expect(pOld).rejects.toThrow(/nahradil novější výpočet/);
  });
});

describe("7 – délka studie a jediný motor", () => {
  it("kinematika: dříve zadaná délka 3 s se změní na dobu jízdy 2 s s ℹ motion.duration-set (dřív potichu)", async () => {
    const env = fakeEnv();
    const a = await runLines(press(), env, MATE, "pohyb čas 3");
    expect(a.doc.motion!.duration).toBe(3);
    const r = await runLines(a.doc, env, "pohyb motor lineární vazba 1 57.5..27.15 rychlost 15.175");
    expect(r.doc.motion!.duration).toBe(2);
    expect(r.codes.map((c) => c.code)).toEqual(["motion.duration-set"]);
    expect(r.codes[0].text).toBe("délka studie změněna z 3 s na 2 s – určuje ji doba jízdy jediného motoru 1 (rozsah × rychlost); jinou délku zadejte pohyb čas T (motor po dojetí stojí)");
    // z výchozí délky (2 s) beze slova navíc – doba je v řádku motoru
    expect(fitDuration({ motors: [{ id: "m", kind: "linear", mate: "x", from: 0, to: 30, speed: 10, ranged: true }], duration: 2, steps: 4 }, 0)).toEqual({ duration: 3 });
  });
  it("dynamika: délka se nezkracuje (motor po dojetí stojí), delší jízda ji prodlouží s ⚠", () => {
    const mo: MotionMotor = { id: "m", kind: "linear", mate: "x", from: 57.5, to: 55, speed: 10, ranged: true };
    expect(fitDuration({ motors: [mo], duration: 0.5, steps: 4, mode: "dynamic" }, 0)).toEqual({ duration: 0.5 }); // dřív 0,25
    const long = fitDuration({ motors: [{ ...mo, to: 27.15 }], duration: 0.5, steps: 4, mode: "dynamic" }, 0);
    expect(long.duration).toBeCloseTo(3.035, 9);
    expect(long.note?.code).toBe("motion.duration-extended");
  });
});

describe("8 – převod do skriptu a starší skripty", () => {
  it("nepoužitý uložený konec: poznámka převodu (dřív `notes: []`)", async () => {
    const env = fakeEnv();
    const a = await runLines(press(), env, MATE);
    const legacy: CadDoc = { ...a.doc, motion: { motors: [legacyMotor(a.doc.mates![0].id)], duration: 2, steps: 36 } };
    const s = docToScript(legacy);
    expect(s.text).toMatch(/pohyb motor lineární vazba 1 od 57\.5 rychlost 15\.175 kroky 36 čas 2/);
    expect(s.notes).toContain("motor pohybové studie č. 1: uložený konec 27.15 se nepoužíval (motor jede od začátku rychlostí bez konce) – skript ho nezapisuje; dojet na konec a stát = 57.5..27.15 s rychlostí (rozsah × rychlost)");
  });
  it("skript starší verze `A..B rychlost V … čas T` s rozporem: chyba řekne, jak zapsat dřívější význam", async () => {
    const env = fakeEnv();
    const a = await runLines(press(), env, MATE);
    await expect(runLines(a.doc, env, "pohyb motor lineární vazba 1 57.5..27.15 rychlost 15.175 čas 1")).rejects.toThrow(/skript ze starší verze: dřívější význam – jet od začátku rychlostí bez konce – zapíšete „od A rychlost V“/);
  });
});

describe("9 – pořadí polí řádku stavu", () => {
  it("`motion=` a `motion.stale=1` za kolizemi, příznaky výsledků z jiné revize vždy na konci", () => {
    const doc: CadDoc = { ...emptyAssembly("S"), components: [] };
    const line = statusKv(doc, null, { components: 2, parts: 2, motion: { state: "stale", line: "" }, matesStale: true }, [{ kind: "measure", rev: "r·abc123" }]);
    expect(line).toMatch(/ clash=- motion=stale motion\.stale=1 mates\.stale=1 measure\.stale=1$/);
  });
});

describe("10 – názvy souborů zkoušek bez názvu etapy", () => {
  it("v src/cad/w22 není soubor pojmenovaný podle etapy (název je zároveň názvem nástroje zákazníka)", () => {
    const names = fs.readdirSync(path.resolve(__dirname));
    expect(names.filter((n) => /^m1[-_.]/i.test(n))).toEqual([]);
  });
});
