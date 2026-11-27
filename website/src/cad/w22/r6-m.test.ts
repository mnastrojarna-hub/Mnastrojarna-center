/**
 * Vlna 22, balík M – fáze 2, kolo 6 (bez jádra, model z w22-motion-fixture): regresní případy zbylých mezer z nezávislého
 * ověření po bodech. Každý případ na kódu před kolem 6 padá (popis v komentáři u případu).
 */
import { describe, expect, it } from "vitest";
import { motionRun } from "../asm-agent-kin";
import { springMotionLines } from "../asm-spring";
import { markMissingSeats } from "../asm-spring-agent";
import { springsCount } from "../engine/kv";
import { preferOutcome } from "../mates-static";
import { motionFindings, motionSummary, runMotion, stepsWord } from "../motion";
import { condMeasurable, phaseProblems } from "../motion-phases";
import { motorNotes } from "../motor-model";
import { geoProvider } from "../asm-agent";
import type { CadDoc, Mate, MotionStudy } from "../types";
import { boxFaces, fakeEnv, press, resizePart, runLines } from "./w22-motion-fixture";

const MATE = 'sestava vazba vzdálenost "Deska A" F1 "Rám" F2 hodnota 57.5 název "ZDVIH"';
const GREEN_MATES = "Vazby splněny ve všech krocích";

describe("bod 5 – pohyb krok N: instance s přezdívkou", () => {
  it("dvě komponenty téhož dílu se v kroku liší přezdívkou („Deska A [D1]“), dřív dva stejné řádky bez instance", async () => {
    const env = fakeEnv();
    const base = press();
    const doc: CadDoc = { ...base, components: base.components!.map((c) => (c.id === "deska-a" ? { ...c, alias: "D1" } : c)) };
    const a = await runLines(doc, env, MATE, "pohyb motor lineární vazba 1 57,5..47,5 kroky 2", "pohyb krok 2");
    const txt = a.last.log.join("\n");
    expect(txt).toMatch(/^ Deska A \[D1\] \[0; 0; 57,5\]$/m);
    expect(txt).not.toMatch(/^ Deska A \[0; 0;/m);
  });
});

describe("bod 15 – jeden souhrn studie v `pohyb stav`, tvar čísla kroků", () => {
  it("`pohyb stav` má jeden řádek „Pohybová studie:“ (dřív dva pod sebou) a revizi modelu r·…", async () => {
    const env = fakeEnv();
    const a = await runLines(press(), env, MATE, "pohyb motor lineární vazba 1 57,5..40 kroky 4", "pohyb stav");
    const heads = a.last.log.filter((l) => /^ ?Pohybová studie:/.test(l));
    expect(heads).toHaveLength(1);
    expect(heads[0]).toMatch(/^Pohybová studie: motorů 1 · kroků 4 · 2 s · r·[0-9a-f]{6}$/);
    expect(a.last.log.join("\n")).toContain(GREEN_MATES);
  });
  it("souhrn výsledku: „4 kroky“, „1 krok“, „12 kroků“ (dřív „4 kroků“)", async () => {
    expect([1, 2, 4, 5, 12].map(stepsWord)).toEqual(["1 krok", "2 kroky", "4 kroky", "5 kroků", "12 kroků"]);
    const env = fakeEnv();
    const a = await runLines(press(), env, MATE, "pohyb motor lineární vazba 1 57,5..40 kroky 4");
    expect(a.log.join("\n")).toMatch(/Pohybová studie: 4 kroky · 2 s · motory:/);
    expect(a.log.join("\n")).not.toMatch(/4 kroků/);
  });
});

describe("bod 10 – konfliktní motor v překrývajícím se čase", () => {
  const STEPS = ["sestava vazba souosost \"Deska A\" F3 \"Rám\" F3 název \"OSA\"", "pohyb motor lineární vazba 1 57,5..27,15 kroky 4"];
  for (const win of ["okno 0,5..1,5", "okno 1..2"]) {
    it(`druhý motor (${win}) na tomtéž stupni volnosti: „stejný stupeň volnosti jako motor 1“, ne „zámek, ukotvení, mez“; přijetí bez ✓; brání: motor`, async () => {
      // dřív: jen stejný začátek se zkoušel → ⚠ „se nemůže pohnout … (zámek, ukotvení, mez)“, „✓ motor 2“, brání: (nezjištěno)
      const env = fakeEnv();
      const a = await runLines(press(), env, MATE, ...STEPS, `pohyb motor lineární vazba "OSA" 0..-5 ${win}`);
      const conf = a.last.codes?.filter((c) => c.code === "motion.motor-conflict") ?? [];
      expect(conf.length).toBeGreaterThan(0);
      expect(conf[0].text).toMatch(/motor 2 \(OSA\) pohání stejný stupeň volnosti „Deska A“ jako motor 1 \(ZDVIH\)/);
      expect(conf.some((c) => /zámek, ukotvení, mez/.test(c.text ?? ""))).toBe(false);
      expect(a.last.log.some((l) => /^✓ motor 2/.test(l))).toBe(false);
      expect(a.last.log[0]).toMatch(/^→ motor 2 přijat, ale je v konfliktu \(motion\.motor-conflict\)/);
      const lim = a.last.codes?.find((c) => c.code === "motion.motor-limit");
      if (lim) expect(lim.text).not.toContain("brání: (nezjištěno)");
    });
  }
  it("motor bez konfliktu dál „✓ motor N“ (zelená jen pro motor, který kontrola pustila)", async () => {
    const env = fakeEnv();
    const a = await runLines(press({ holder: true }), env, MATE, 'sestava vazba vzdálenost "Přidržovač" F1 "Rám" F2 hodnota 20 název "P"', "pohyb motor lineární vazba 1 57,5..40 kroky 2", 'pohyb motor lineární vazba "P" 20..10 kroky 2');
    expect(a.last.log[0]).toMatch(/^✓ motor 2:/);
    expect((a.last.codes ?? []).map((c) => c.code)).not.toContain("motion.motor-conflict");
  });
});

describe("bod 11 – rada u rotačního motoru", () => {
  it("rotační motor se začátkem ≠ 0: „bez skoku: 0..Δ nebo otočení Δ“ (dřív „zdvih Δ“)", () => {
    const m: Mate = { id: "osa", type: "concentric", a: { compId: "deska-a", face: 2 }, b: { compId: "rám", face: 2 }, name: "OSA" };
    const study: Pick<MotionStudy, "motors" | "duration"> = { motors: [{ id: "m", kind: "rotary", mate: "osa", from: 90, to: 180 }], duration: 2 };
    const n = motorNotes(study, [m], (x) => x.name ?? "?").find((x) => x.code === "motion.start-jump")!;
    expect(n.text).toMatch(/bez skoku: 0\.\.Δ nebo otočení Δ$/);
    expect(n.text).not.toContain("zdvih Δ");
  });
});

describe("bod 3 – podmínka fáze na mezi vzdálenosti", () => {
  const LIM = 'sestava vazba mez-vzdálenosti "Přidržovač" F1 "Rám" F2 min 0 max 500 název "Dosed"';
  it("fáze „vazba Dosed ≤ 5“ na mezi vzdálenosti se měří a nastane (dřív hodnota nikdy změřena, phases=1/2, „nejbližší hodnota ?“)", async () => {
    const env = fakeEnv();
    // přidržovač zamčený k desce: mezera k rámu klesá s motorem 30 → 0 (Z přidržovače 40 − 10)
    const base = press({ holder: true });
    const h = { ...base, components: base.components!.map((c) => (c.id === "přidržovač" ? { ...c, placement: { ...c.placement, position: [0, 0, 40] as [number, number, number] } } : c)) };
    const a = await runLines(h, env, MATE, 'sestava vazba zámek "Přidržovač" "Deska A"', LIM, 'pohyb fáze "Dolů"', 'pohyb fáze "Dosed" při vazba "Dosed" <= 5', "pohyb motor lineární vazba 1 57,5..27,5 kroky 6");
    expect(a.kv).toMatch(/ phases=2\/2$/);
    expect(a.log.join("\n")).toMatch(/Fáze 2 „Dosed“: kroky \d+–6 /);
    expect(a.codes.map((c) => c.code)).not.toContain("motion.phase-unreached");
  });
  it("podmínku na vazbě, jejíž hodnotu nejde měřit (zámek), odmítne už `pohyb fáze` (✗), ne ✓ a pak „nenastala“", async () => {
    expect(condMeasurable({ type: "lock" })).toBe(false);
    expect(condMeasurable({ type: "limitDistance" })).toBe(true);
    const env = fakeEnv();
    const a = await runLines(press({ holder: true }), env, MATE, 'sestava vazba zámek "Přidržovač" "Deska A" název "Z"');
    await expect(runLines(a.doc, env, 'pohyb fáze "Nikdy" při vazba "Z" <= 0')).rejects.toThrow(/hodnotu vazby „Z“ \(Zámek\) nejde měřit – podmínka by nikdy nenastala/);
    const st: MotionStudy = { motors: [], duration: 2, steps: 4, phases: [{ id: "p", name: "Nikdy", start: { mate: a.doc.mates!.find((m) => m.name === "Z")!.id, op: "<=", value: 0 } }] };
    expect(phaseProblems(st, a.doc.mates!).join("\n")).toMatch(/nejde měřit/);
  });
  it("fáze, která čeká na předchozí nezačatou fázi, uvede tuto příčinu – ne „nejbližší hodnota ?“", async () => {
    const env = fakeEnv();
    const a = await runLines(press(), env, MATE, 'pohyb fáze "Dolů"', 'pohyb fáze "Nikdy" při vazba "ZDVIH" <= 1', 'pohyb fáze "Zpět" při vazba "ZDVIH" >= 50', "pohyb motor lineární vazba 1 57,5..27,15 kroky 4");
    const wait = a.codes.find((c) => c.code === "motion.phase-unreached" && /Zpět/.test(c.text ?? ""))!;
    expect(wait.text).toMatch(/čeká na předchozí fázi „Nikdy“, která nezačala – podmínka vazba „ZDVIH“ ≥ 50 se nevyhodnocovala/);
    expect(wait.text).not.toContain("nejbližší hodnota ?");
    expect(a.log.join("\n")).toMatch(/⚠ fáze 3 „Zpět“ nenastala – čeká na fázi 2 „Nikdy“, která nezačala/);
  });
});

describe("bod 2 – preference meze × poloha dokumentu", () => {
  /** přidržovač volně v Mezi ⟨5; 25⟩ k desce, v dokumentu u max (mezera 25), preference min – jako když ji v sestavě přebije pružina */
  const prefDoc = (): CadDoc => {
    const base = press({ holder: true });
    const h = resizePart(base, "Přidržovač", [100, 100, 8]);
    const comps = h.components!.map((c) => (c.id === "přidržovač" ? { ...c, placement: { ...c.placement, position: [0, 0, 34.5] as [number, number, number] } } : c));
    const mates: Mate[] = [
      { id: "zdvih", type: "distance", a: { compId: "deska-a", face: 0 }, b: { compId: "rám", face: 1 }, value: 57.5, name: "ZDVIH" },
      { id: "mez", type: "limitDistance", a: { compId: "přidržovač", face: 1 }, b: { compId: "deska-a", face: 0 }, min: 5, max: 25, name: "Mez", prefer: "min" },
      { id: "osa", type: "concentric", a: { compId: "přidržovač", face: 2 }, b: { compId: "rám", face: 2 }, name: "VEDENÍ" },
    ];
    return { ...h, components: comps, mates };
  };
  it("statická kontrola: preferovaná strana min, díl stojí u max → nesplněno (dřív „✓ … preferovaná strana min · ok“)", async () => {
    const env = fakeEnv();
    const d = prefDoc();
    await runLines(d, env, "sestava"); // načte plochy dílů
    const po = preferOutcome(d, geoProvider(d, env), d.mates![1])!;
    expect(po).toMatchObject({ met: false, side: "min", at: "max", spring: false });
  });
  it("kinematika: krok 0 jinde než poloha v sestavě = ⚠ motion.start-jump, ne „Vazby splněny ve všech krocích“", async () => {
    const env = fakeEnv();
    const d = { ...prefDoc(), motion: { motors: [{ id: "m1", kind: "linear" as const, mate: "zdvih", from: 57.5, to: 47.5 }], duration: 2, steps: 2, mode: "kinematic" as const } };
    await runLines(d, env, "sestava");
    const res = await runMotion(d, geoProvider(d, env), d.motion);
    expect(res.start0?.map((x) => x.comp)).toContain("přidržovač");
    expect(res.start0!.find((x) => x.comp === "přidržovač")!.d).toBeCloseTo(20, 3);
    const f = motionFindings(res, d).find((x) => x.code === "motion.start-jump" && x.args[0] === "0")!;
    expect(f.text).toMatch(/krok 0 se liší od polohy v sestavě: „Přidržovač“ 20 mm/);
    expect(f.text).toMatch(/preferovanou stranu meze „Mez“ \(min\)/);
    const sum = motionSummary(res, d).join("\n");
    expect(sum).not.toContain(GREEN_MATES);
    expect(sum).toMatch(/⚠ vazby splněny ve všech krocích, ale krok 0 je jinde než poloha v sestavě/);
  });
  it("pružina na dorazu Ln ve všech krocích: ⚠, ne ✓", async () => {
    const pin = (await import("../library/pins")).compressionSpring.make({ d: 2, D: 18, L: 32, n: 6 }) as CadDoc;
    const base = press();
    const doc: CadDoc = { ...base, components: [...base.components!, { id: "s", name: "P", source: { kind: "part", doc: pin }, placement: { position: [0, 0, 10], rotation: [0, 0, 0] }, spring: { a: { compId: "rám", face: 1 }, b: { compId: "deska-a", face: 0 }, free: 32, solid: 14, rate: 20, length: 14, offset: 0, seat: 14 } }] };
    const st = { length: 14, offset: 0, seat: 14, force: 360, level: "ok" as const };
    const lines = springMotionLines(doc, [{ i: 0, t: 0, springs: { s: st } }, { i: 1, t: 1, springs: { s: st } }]).join("\n");
    expect(lines).not.toMatch(/^✓ pružina/m);
    expect(lines).toMatch(/^⚠ pružina „P“: .* po celou studii stlačená na doraz Ln \(blok\)/m);
  });
});

describe("bod 8 – nesplněné vazby jen skutečně porušené", () => {
  it("motor na mezi u pevné vazby: krok počítá 1 nesplněnou (motor), pevná vzdálenost a mez na dorazu jen „brání:“", async () => {
    // dřív: „⚠ nesplněné vazby: 3“ a motion.conflict u PEVNÁ (24,5 mm – splněno)
    const env = fakeEnv();
    const a = await runLines(press({ holder: true }), env, MATE, 'sestava vazba vzdálenost "Přidržovač" F1 "Rám" F2 hodnota 20 název "PEVNÁ"', 'sestava vazba mez-vzdálenosti "Přidržovač" F2 "Deska A" F1 min 5 max 40 název "Mez"', "pohyb motor lineární vazba 1 57,5..27,15 kroky 4", "pohyb krok 4");
    const txt = a.last.log.join("\n");
    expect(txt).toMatch(/⚠ nesplněné vazby: 1$/m);
    expect(txt).toMatch(/^ {2}brání: „PEVNÁ Přidržovač → Rám“/m);
    expect(txt).not.toMatch(/konflikt: „PEVNÁ/);
    const res = await motionRun(a.doc, env);
    const stopped = res.steps.filter((s) => s.status === "stopped");
    expect(stopped.length).toBeGreaterThan(0);
    for (const s of stopped) expect(s.conflicts.every((id) => !(a.doc.mates ?? []).some((m) => m.id === id && m.name === "PEVNÁ"))).toBe(true);
  });
});

describe("bod 7 – dosedací plocha, kterou díl nemá", () => {
  it("plocha 99: strana se označí jako ztracená (springs.lost=1); existující plocha beze změny", async () => {
    const env = fakeEnv();
    const pin = (await import("../library/pins")).compressionSpring.make({ d: 2, D: 18, L: 32, n: 6 }) as CadDoc;
    const base = press();
    const mk = (face: number): CadDoc => ({ ...base, components: [...base.components!, { id: "s", name: "P", source: { kind: "part", doc: pin }, placement: { position: [0, 0, 10], rotation: [0, 0, 0] }, spring: { a: { compId: "rám", face: 1 }, b: { compId: "deska-a", face }, free: 32, solid: 14, length: 25, offset: 0, seat: 25 } }] });
    expect(boxFaces([1, 1, 1])).toHaveLength(3); // fixture: díl má 3 plochy (F1–F3)
    const lost = await markMissingSeats(mk(99), env);
    expect(lost.marked).toEqual(["s"]);
    expect(lost.doc.components!.find((c) => c.id === "s")!.spring!.b.lost).toMatchObject({ why: "none" });
    expect(springsCount(lost.doc)).toEqual({ total: 1, lost: 1 });
    const fine = await markMissingSeats(mk(0), env);
    expect(fine.marked).toEqual([]);
    expect(springsCount(fine.doc)).toBeUndefined();
  });
});
