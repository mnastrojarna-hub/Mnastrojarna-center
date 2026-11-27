/**
 * Výsledky pohybové studie podle dokumentu a otisku jeho stavu (cad/motion-cache.ts, vlna 22 – body 1 a 12 zprávy): otisk zahrnuje
 * geometrii dílů a konfiguraci; výsledek jedné sestavy se neukáže u jiné; nový výpočet ruší předchozí a opožděný starší výsledek
 * nic nepřepíše. Zkoušky „před opravou“: `motionCached` po změně rozměru dílu vracel starý výsledek (klíč bez geometrie, jedna
 * globální položka pro všechny dokumenty).
 */
import { describe, expect, it } from "vitest";
import { motionCached, motionRun } from "./asm-agent-kin";
import { MotionSuperseded, dropMotion, motionSig, motionState, motionStatusOf, motionStoreOf, runStored, type MotionSlot } from "./motion-cache";
import type { MotionResult } from "./motion";
import type { CadDoc } from "./types";
import { fakeEnv, press, resizePart, runLines } from "./w22/w22-motion-fixture";

const MATE = 'sestava vazba vzdálenost "Deska A" F1 "Rám" F2 hodnota 57.5 název "ZDVIH"';
const MOTOR = "pohyb motor lineární vazba 1 57,5..27,15 kroky 4";
const fake = (tag: number): MotionResult => ({ steps: [{ i: 0, t: tag, motors: [], place: {}, conflicts: [] }], comps: [], motors: [], collision: null, collisionsChecked: false, conflictSteps: 0 });
const slotOf = (key: string, owner: object): MotionSlot => ({ key, store: motionStoreOf(owner) });

describe("otisk vstupu studie", () => {
  it("mění se s geometrií dílu, konfigurací dílu, polohou, vazbou i studií; ne se smyčkou přehrávání a (v kinematice) s nastavením dynamiky", async () => {
    const env = fakeEnv();
    const { doc } = await runLines(press(), env, MATE, MOTOR);
    const base = motionSig(doc);
    expect(motionSig({ ...doc })).toBe(base); // jiný objekt, stejný obsah
    expect(motionSig(resizePart(doc, "Rám", [30, 100, 10]))).not.toBe(base); // geometrie dílu (dřív stejný klíč → starý výsledek)
    const cfg: CadDoc = { ...doc, components: doc.components!.map((c) => (c.name === "Rám" && c.source.kind === "part" ? { ...c, source: { kind: "part", doc: { ...c.source.doc, activeConfig: "B", configs: [{ id: "B", name: "B", values: {} }] } as CadDoc } } : c)) };
    expect(motionSig(cfg)).not.toBe(base); // konfigurace dílu
    expect(motionSig({ ...doc, components: doc.components!.map((c, i) => (i === 1 ? { ...c, placement: { ...c.placement, position: [0, 0, 60] } } : c)) })).not.toBe(base);
    expect(motionSig({ ...doc, mates: doc.mates!.map((m) => ({ ...m, value: 50 })) })).not.toBe(base);
    expect(motionSig({ ...doc, motion: { ...doc.motion!, steps: 8 } })).not.toBe(base);
    expect(motionSig({ ...doc, motion: { ...doc.motion!, loop: true } })).toBe(base);
    expect(motionSig({ ...doc, motion: { ...doc.motion!, dyn: { dt: 0.001, masses: { x: 1 } } } })).toBe(base);
    const dyn = { ...doc, motion: { ...doc.motion!, mode: "dynamic" as const, dyn: { dt: 0.001 } } };
    expect(motionSig({ ...dyn, motion: { ...dyn.motion, dyn: { dt: 0.002 } } })).not.toBe(motionSig(dyn));
  });
});

describe("výsledek jen pro dokument a stav, pro který vznikl", () => {
  it("po změně geometrie dílu `motionCached` nic nevrátí, stav je „stale“ a jmenuje změněný díl; `motionRun` počítá znovu", async () => {
    const env = fakeEnv();
    const { doc } = await runLines(press(), env, MATE, MOTOR);
    const first = motionCached(doc, env)!;
    expect(first.steps.length).toBe(5);
    expect(motionState(doc, env).state).toBe("ok");
    // rám o 5 mm vyšší: horní plocha Z 15 → deska při mezeře 27,15 skončí o 5 mm výš (jiný výsledek, ne jen jiný klíč)
    const changed = resizePart(doc, "Rám", [100, 100, 15]);
    expect(motionCached(changed, env)).toBeNull();
    const st = motionState(changed, env);
    expect(st.state).toBe("stale");
    expect(st.state === "stale" && st.changed).toEqual(["geometrie dílu „Rám“"]);
    const again = await motionRun(changed, env);
    expect(again).not.toBe(first);
    expect(again.steps[4].place["deska-a"].position[2]).toBeCloseTo(42.15, 6);
    expect(first.steps[4].place["deska-a"].position[2]).toBeCloseTo(37.15, 6);
    expect(motionCached(changed, env)).toBe(again);
    // původní dokument teď nemá platný výsledek (jeden záznam na dokument) – žádný starý výsledek se nevydává za platný
    expect(motionCached(doc, env)).toBeNull();
    expect(motionState(doc, env).state).toBe("stale");
  });
  it("jiný dokument (jiný klíč) = nezkontrolováno, i kdyby měl stejné komponenty; výsledky dvou dokumentů se nepřepisují", async () => {
    const env = fakeEnv();
    const { doc } = await runLines(press(), env, MATE, MOTOR);
    const owner = {};
    const envA = { ...env, motion: slotOf("docA", owner) };
    const envB = { ...env, motion: slotOf("docB", owner) };
    const ra = await motionRun(doc, envA);
    expect(motionState(doc, envA).state).toBe("ok");
    expect(motionState(doc, envB)).toEqual({ state: "unchecked" }); // dřív jedna globální položka: výsledek A se ukázal i u B
    expect(motionCached(doc, envB)).toBeNull();
    const other = resizePart(doc, "Rám", [100, 100, 20]);
    const rb = await motionRun(other, envB);
    expect(motionCached(doc, envA)).toBe(ra); // výpočet B nepřepsal výsledek A
    expect(motionCached(other, envB)).toBe(rb);
    // jiný pracovní prostor (jiný vlastník úložiště) se stejným klíčem dokumentu = jiný záznam
    expect(motionState(doc, { ...env, motion: slotOf("docA", {}) })).toEqual({ state: "unchecked" });
    dropMotion(envA.motion.store, "docA");
    expect(motionState(doc, envA)).toEqual({ state: "unchecked" });
  });
  it("co se změnilo: poloha, vazby, studie, počet dílů – slovy", async () => {
    const env = fakeEnv();
    const { doc } = await runLines(press(), env, MATE, MOTOR);
    const ch = (d: CadDoc) => {
      const st = motionState(d, env);
      return st.state === "stale" ? st.changed : [st.state];
    };
    expect(ch({ ...doc, motion: { ...doc.motion!, steps: 9 } })).toEqual(["definice studie (motory, délka, kroky)"]);
    expect(ch({ ...doc, mates: doc.mates!.map((m) => ({ ...m, value: 50 })) })).toEqual(["vazby"]);
    expect(ch({ ...doc, components: doc.components!.map((c, i) => (i === 1 ? { ...c, hidden: true } : c)) })).toEqual(["poloha, ukotvení nebo skrytí komponent"]);
    expect(ch({ ...doc, components: [...doc.components!, { ...doc.components![1], id: "kopie", name: "Kopie" }] })).toEqual(["počet dílů (2 → 3)", "poloha, ukotvení nebo skrytí komponent"]);
  });
});

describe("souběh výpočtů (bod 12): nový výpočet ruší předchozí, opožděný výsledek nic nepřepíše", () => {
  const defer = <T>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  };
  it("starší výpočet (jiný vstup) skončí jako nahrazený a jeho výsledek se neuloží, ani když doběhne až po novějším", async () => {
    const env = fakeEnv();
    const { doc } = await runLines(press(), env, MATE);
    const slot = slotOf("d", {});
    const old = { ...doc, motion: { motors: [], duration: 2, steps: 10 } };
    const next = { ...doc, motion: { motors: [], duration: 2, steps: 40 } };
    const a = defer<MotionResult>();
    const b = defer<MotionResult>();
    let cancelA: () => boolean = () => false;
    const pa = runStored(slot, old, (cancel) => ((cancelA = cancel), a.promise));
    const pb = runStored(slot, next, () => b.promise);
    expect(cancelA()).toBe(true); // běžící starší výpočet dostal pokyn skončit
    b.resolve(fake(40));
    expect((await pb).steps[0].t).toBe(40);
    a.resolve(fake(10)); // opožděná odpověď staršího výpočtu
    await expect(pa).rejects.toBeInstanceOf(MotionSuperseded);
    const e = slot.store.byDoc.get("d")!;
    expect(e.res.steps[0].t).toBe(40);
    expect(e.sig).toBe(motionSig(next));
    expect(motionState(next, { motion: slot, geo: {} }).state).toBe("ok");
    expect(motionState(old, { motion: slot, geo: {} }).state).toBe("stale"); // výsledek 40 kroků se nevydává za výsledek staré studie
    expect(slot.store.running.size).toBe(0);
  });
  it("výsledek se ukládá pod otiskem SVÉHO vstupu; zrušený uživatelem se neuloží; chyba výpočtu nic nezmění", async () => {
    const env = fakeEnv();
    const { doc } = await runLines(press(), env, MATE);
    const slot = slotOf("d", {});
    const d1 = { ...doc, motion: { motors: [], duration: 2, steps: 5 } };
    await runStored(slot, d1, async () => fake(5));
    expect(slot.store.byDoc.get("d")!.sig).toBe(motionSig(d1));
    const d2 = { ...doc, motion: { motors: [], duration: 2, steps: 6 } };
    await runStored(slot, d2, async () => fake(6), () => true); // zrušeno
    expect(slot.store.byDoc.get("d")!.res.steps[0].t).toBe(5);
    await expect(runStored(slot, d2, async () => Promise.reject(new Error("pád")))).rejects.toThrow("pád");
    expect(slot.store.byDoc.get("d")!.res.steps[0].t).toBe(5);
    expect(slot.store.running.size).toBe(0);
  });
});

describe("stav pro příkaz `stav`", () => {
  it("bez studie nic; nespočítáno; platí (vazby, kolize nekontrolovány); NEPLATÍ s tím, co se změnilo", async () => {
    const env = fakeEnv();
    const a = await runLines(press(), env, MATE);
    const slot = slotOf("d", {});
    const e = { ...env, motion: slot };
    expect(motionStatusOf(slot.store, "d", a.doc)).toBeUndefined();
    const withStudy = { ...a.doc, motion: { motors: [{ id: "m", kind: "linear" as const, mate: a.doc.mates![0].id, from: 57.5, to: 27.15 }], duration: 2, steps: 4 } };
    expect(motionStatusOf(slot.store, "d", withStudy)).toEqual({ state: "unchecked", line: "Pohyb: nespočítáno – „pohyb spustit“ nebo Vypočítat pohyb v panelu studie" });
    await motionRun(withStudy, e);
    // kolize se nekontrolovaly → „mates-ok“, ne „ok“ (oprava po kontrole: strojové `motion=ok` jen po kontrole kolizí)
    expect(motionStatusOf(slot.store, "d", withStudy)).toEqual({ state: "mates-ok", line: "Pohyb: výsledek platí pro tento stav sestavy – 4 kroky, vazby splněny, kolize nekontrolovány (podrobně pohyb stav)" });
    expect(motionStatusOf(slot.store, "d", resizePart(withStudy, "Deska A", [50, 100, 10]))).toEqual({ state: "stale", line: "Pohyb: výsledek NEPLATÍ – od výpočtu se změnilo: geometrie dílu „Deska A“; přepočítá „pohyb spustit“" });
    expect(motionStatusOf(slot.store, "jiný", withStudy)!.state).toBe("unchecked");
  });
});
