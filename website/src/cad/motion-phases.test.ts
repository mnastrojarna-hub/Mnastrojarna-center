/**
 * Vlna 22, bod 3: JEDNA studie celého cyklu – nájezd, sevření, střih, značení a návrat v jednom dokumentu (fáze, úseky motoru,
 * okna, podmínky, zapnutí / potlačení vazeb, režim po fázích). Bez jádra (syntetické plochy kvádrů – w22/w22-motion-fixture.ts).
 *
 * Model (neutrální názvy): Rám (ukotvený, horní plocha z = 10), Plech (ukotvený, horní plocha z = 12), Horní deska na vazbě
 * ZDVIH (Vzdálenost od Rámu, 80 mm), Razník zamčený k horní desce, Přidržovač nesený zámkem NESENÍ k horní desce a vazba MEZERA
 * (Vzdálenost Přidržovač – Plech, 30 mm) potlačená. Cyklus: motor ZDVIH 80 → 50 → 40 → 37, prodleva, zpět na 80; fáze Nájezd,
 * Sevření (MEZERA ≤ 0: potlačit NESENÍ, zapnout MEZERA – přidržovač zůstane na plechu), Střih (ZDVIH ≤ 40), Značení (ZDVIH ≤ 38),
 * Návrat (ZDVIH ≥ 50: zapnout NESENÍ, potlačit MEZERA – přidržovač jede zpět s deskou).
 */
import { afterEach, describe, expect, it } from "vitest";
import { parseAgentText } from "./agent";
import type { AsmCmd } from "./agent-asm";
import type { MotionCmd } from "./agent-motion";
import { motionKv, motionRun } from "./asm-agent-kin";
import { emptyAssembly, partComponent } from "./assembly";
import { setLang } from "./i18n";
import { motionSummary } from "./motion";
import { buildMotor, fillLegs, fitDuration, motorKeys, motorSpan, piecewiseNeed, profileAt } from "./motor-model";
import { boxPart, fakeEnv, runLines } from "./w22/w22-motion-fixture";
import type { CadDoc, MotionMotor, Vec3 } from "./types";

afterEach(() => setLang("cs"));

const mk = (n: string, size: Vec3, pos: Vec3, fixed = false) => ({ ...partComponent(boxPart(n, size), { position: pos }, fixed ? { fixed: true } : {}), id: n.toLowerCase().replace(/\s+/g, "-") });
/** lis s přidržovačem a razníkem (viz hlavička) */
function cell(): CadDoc {
  return {
    ...emptyAssembly("Cyklus"),
    components: [mk("Rám", [100, 100, 10], [0, 0, 0], true), mk("Plech", [100, 100, 2], [0, 0, 10], true), mk("Horní deska", [100, 100, 10], [0, 0, 90]), mk("Razník", [10, 10, 38], [45, 45, 52]), mk("Přidržovač", [100, 100, 10], [0, 0, 42])],
  };
}
const SETUP = [
  'sestava vazba vzdálenost "Horní deska" F1 "Rám" F2 hodnota 80 název "ZDVIH"',
  'sestava vazba souosost "Horní deska" F3 "Rám" F3',
  'sestava vazba zámek "Razník" "Horní deska"',
  'sestava vazba zámek "Přidržovač" "Horní deska" název "NESENÍ"',
  'sestava vazba souosost "Přidržovač" F3 "Rám" F3',
  'sestava vazba vzdálenost "Přidržovač" F1 "Plech" F2 hodnota 30 název "MEZERA"',
  'sestava vazba "MEZERA" potlačit',
];
const PHASES = [
  'pohyb fáze "Nájezd"',
  'pohyb fáze "Sevření" při vazba "MEZERA" <= 0 potlačit vazba "NESENÍ" zapnout vazba "MEZERA"',
  'pohyb fáze "Střih" při vazba "ZDVIH" <= 40',
  'pohyb fáze "Značení" při vazba "ZDVIH" <= 38',
  'pohyb fáze "Návrat" při vazba "ZDVIH" >= 50 zapnout vazba "NESENÍ" potlačit vazba "MEZERA"',
];
const MOTOR = 'pohyb motor lineární vazba "ZDVIH" 80..50..40..37 rychlost 50 prodleva 0,1 pak 80 rychlost 100 kroky 70';
const z = (d: CadDoc, res: Awaited<ReturnType<typeof motionRun>>, name: string, i: number) => res.steps[i].place[d.components!.find((c) => c.name === name)!.id].position[2];

describe("bod 3 – celý cyklus v jedné studii (fáze)", () => {
  it("pět fází nastane v pořadí, každá s 0 nesplněnými vazbami; přidržovač stojí na plechu a vrátí se přesně do výchozí polohy", async () => {
    const env = fakeEnv();
    const r = await runLines(cell(), env, ...SETUP, ...PHASES, MOTOR);
    const res = await motionRun(r.doc, env);
    const runs = res.phases!;
    expect(runs.map((x) => [x.name, x.reached])).toEqual([["Nájezd", true], ["Sevření", true], ["Střih", true], ["Značení", true], ["Návrat", true]]);
    for (const x of runs) {
      expect(x.conflictSteps, x.name).toBe(0);
      expect(x.stopped + x.invalid, x.name).toBe(0);
    }
    expect(res.conflictSteps).toBe(0);
    // okamžik začátku fáze zpřesněný mezi kroky: sevření při ZDVIH = 50 (t = 30 / 50 = 0,6 s), návrat při ZDVIH = 50 na cestě zpět (0,96 + 0,13 s)
    expect(runs[1].t!).toBeCloseTo(0.6, 3);
    expect(runs[2].t!).toBeCloseTo(0.8, 3);
    expect(runs[4].t!).toBeCloseTo(1.09, 3);
    // pořadí kroků fází navazuje a pokrývá celou studii
    expect(runs[0].step).toBe(0);
    for (let i = 1; i < runs.length; i++) expect(runs[i].step!).toBeGreaterThan(runs[i - 1].step!);
    expect(runs[4].end).toBe(70);
    // přidržovač: na plechu (z = 12) během sevření až značení, na konci zpět na výchozích 42 mm (zámek zachycen přesně při ZDVIH 50)
    const dn = r.doc;
    const mid = runs[3].step!;
    expect(z(dn, res, "Přidržovač", mid)).toBeCloseTo(12, 6);
    expect(z(dn, res, "Horní deska", mid)).toBeLessThan(52);
    expect(z(dn, res, "Přidržovač", 70)).toBeCloseTo(42, 6);
    expect(z(dn, res, "Horní deska", 70)).toBeCloseTo(90, 6);
    // krok 0 = dokument
    expect(z(dn, res, "Horní deska", 0)).toBeCloseTo(90, 9);
    expect(z(dn, res, "Přidržovač", 0)).toBeCloseTo(42, 9);
    // protokol po fázích a strojový řádek
    const sum = motionSummary(res, r.doc).join("\n");
    expect(sum).toMatch(/Fáze 2 „Sevření“: kroky \d+–\d+ · t = 0,6–[\d,]+ s · začátek: vazba „MEZERA“ ≤ 0 · kinematika · nesplněné vazby 0/);
    expect(sum).toMatch(/Fáze 5 „Návrat“: kroky \d+–70 · t = 1,09–1,39 s/);
    expect(motionKv(res, null, r.doc.motion!.duration, r.doc)).toMatch(/ level=kin groups=\S+ phases=5\/5$/);
    expect(motionKv(res, null, r.doc.motion!.duration, r.doc)).toMatch(/ m1=keys:80>50>40>37>80:---\+ /);
  });

  it("opakované přehrání ze stejného výchozího stavu: dva výpočty = stejné polohy ve všech krocích (studie dokument nemění)", async () => {
    const env = fakeEnv();
    const r = await runLines(cell(), env, ...SETUP, ...PHASES, MOTOR);
    const a = await motionRun(r.doc, env, { force: true });
    const b = await motionRun(r.doc, env, { force: true });
    expect(b.steps.map((s) => s.place)).toEqual(a.steps.map((s) => s.place));
    // dokument po výpočtu beze změny: vazba MEZERA dál potlačená, NESENÍ zapnutá
    expect(r.doc.mates!.find((m) => m.name === "MEZERA")!.suppressed).toBe(true);
    expect(r.doc.mates!.find((m) => m.name === "NESENÍ")!.suppressed).toBeFalsy();
  });

  it("podmínka hodnoty je hrana: „ZDVIH ≥ 50“ platí už při sevření (ZDVIH = 50) – návrat začne až na cestě zpět, sevření trvá", async () => {
    const env = fakeEnv();
    const r = await runLines(cell(), env, ...SETUP, PHASES[0], PHASES[1], PHASES[4], 'pohyb motor lineární vazba "ZDVIH" 80..50..40 rychlost 50 prodleva 0,1 pak 80 rychlost 100 kroky 40');
    const res = await motionRun(r.doc, env);
    const [, clamp, back] = res.phases!;
    expect(clamp.t!).toBeCloseTo(0.6, 3);
    expect(back.t!).toBeGreaterThan(0.9); // 0,6 + 0,2 + 0,1 prodleva + 0,1 zpět na 50
    expect(back.t!).toBeCloseTo(1.0, 3);
    expect(clamp.end! - clamp.step!).toBeGreaterThan(5);
    expect(z(r.doc, res, "Přidržovač", res.steps.length - 1)).toBeCloseTo(42, 6);
    expect(motionSummary(res, r.doc).join("\n")).not.toContain("undefined");
  });

  it("fáze, jejíž podmínka nenastane = ⚠ motion.phase-unreached (ne tichý úspěch); phases=4/5", async () => {
    const env = fakeEnv();
    const r = await runLines(cell(), env, ...SETUP, ...PHASES.slice(0, 4), 'pohyb fáze "Nikdy" při vazba "ZDVIH" <= 5', MOTOR);
    expect(r.codes.map((c) => c.code)).toContain("motion.phase-unreached");
    expect(r.kv).toMatch(/ phases=4\/5$/);
    expect(r.log.join("\n")).toMatch(/⚠ fáze 5 „Nikdy“ nenastala – podmínka vazba „ZDVIH“ ≤ 5 do konce studie nesplněna \(nejblíž 37\)/);
  });

  it("časová fáze a motor fáze: motor začne s fází (polohové okno), na téže vazbě pohání pozdější motor; skok začátku = ⚠ start-jump", async () => {
    const env = fakeEnv();
    const r = await runLines(
      cell(),
      env,
      ...SETUP.slice(0, 4),
      'pohyb fáze "Dolů"',
      'pohyb fáze "Zpět" od 1 s',
      'pohyb motor lineární vazba "ZDVIH" 80..60 kroky 20 čas 2',
      'pohyb motor lineární vazba "ZDVIH" 60..80 fáze "Zpět"',
    );
    const res = await motionRun(r.doc, env);
    expect(res.phases!.map((x) => [x.reached, x.t])).toEqual([[true, 0], [true, 1]]);
    // do 1 s jede první motor (80 → 60 za celou studii = 70 v t = 1), od 1 s druhý motor 60 → 80 do konce studie
    const hd = r.doc.components!.find((c) => c.name === "Horní deska")!.id;
    const at = (t: number) => res.steps.find((s) => Math.abs(s.t - t) < 1e-9)!.place[hd].position[2];
    expect(at(0.9)).toBeCloseTo(10 + 71, 6); // motor 1: 80 → 60 za 2 s, v t = 0,9 na 71
    expect(at(1)).toBeCloseTo(10 + 60, 6); // od t = 1 pohání motor 2 (začal později) – začátek 60, i když motor 1 by byl na 70
    expect(at(2)).toBeCloseTo(10 + 80, 6);
    // skok v okamžiku začátku se neschová: vazba byla na 71 (poloha předchozího kroku), motor 2 začíná na 60
    expect(res.starts?.[0]).toMatchObject({ motor: 1, step: 10, t: 1, from: 60 });
    expect(res.starts![0].value).toBeCloseTo(71, 6);
    expect(r.codes.map((c) => c.code)).toContain("motion.start-jump");
  });

  it("text CS / EN / DE: úseky, klíče, okno, fáze, navázat, událost", () => {
    const m = (line: string) => {
      const p = parseAgentText(line);
      expect(p.errors, line).toEqual([]);
      return (p.ops[0] as { cmd: AsmCmd }).cmd as unknown as { k: string; cmd: MotionCmd };
    };
    expect(m('pohyb motor lineární vazba "ZDVIH" 80..50..40..37 rychlost 50 prodleva 0,1 pak 80 rychlost 100').cmd).toMatchObject({ op: "motor", from: 80, to: 37, points: [50, 40, 37], speed: 50, extra: [{ time: 0.1 }, { to: 80, speed: 100 }] });
    expect(m("motion motor linear mate 1 80..50 then 80 time 0.5 window 0.2..1.2").cmd).toMatchObject({ op: "motor", from: 80, to: 50, extra: [{ to: 80, time: 0.5 }], window: { t0: 0.2, t1: 1.2 } });
    expect(m("bewegung antrieb linear verknüpfung 1 80..50 dann 80 geschwindigkeit 20 phase 2 anhängen").cmd).toMatchObject({ op: "motor", extra: [{ to: 80, speed: 20 }], phase: "2", append: true });
    expect(m("pohyb motor lineární vazba 1 klíče 0:57,5 0,3:40 0,6:27,15 1:57,5").cmd).toMatchObject({ op: "motor", keys: [{ t: 0, v: 57.5 }, { t: 0.3, v: 40 }, { t: 0.6, v: 27.15 }, { t: 1, v: 57.5 }] });
    expect(m("pohyb motor lineární vazba 1 57,5..27,15 od 0,2 s do 0,6 s").cmd).toMatchObject({ op: "motor", from: 57.5, to: 27.15, window: { t0: 0.2, t1: 0.6 } });
    expect(m("pohyb motor lineární vazba 1 od 80 pak 50 čas 0,6 pak 80 čas 0,4").cmd).toMatchObject({ op: "motor", from: 80, auto: true, extra: [{ to: 50, time: 0.6 }, { to: 80, time: 0.4 }] });
    expect(m('pohyb fáze "Sevření" při vazba "MEZERA" <= 0 potlačit vazba 6 zapnout vazba 7 kvazistatika').cmd).toEqual({ op: "phase", cmd: { k: "add", spec: { name: "Sevření", start: { mate: "MEZERA", op: "<=", value: 0 }, suppress: ["6"], enable: ["7"], mode: "quasistatic" } } });
    expect(m('motion phase "Clamp" when mate 7 <= 0 enable mate 7 suppress mate 6 quasistatic').cmd).toMatchObject({ op: "phase", cmd: { k: "add", spec: { name: "Clamp", start: { mate: "7", op: "<=", value: 0 }, enable: ["7"], suppress: ["6"], mode: "quasistatic" } } });
    expect(m('bewegung phase "Klemmen" wenn verknüpfung 7 <= 0 aktivieren verknüpfung 7 unterdrücken verknüpfung 6 quasistatisch').cmd).toMatchObject({ op: "phase", cmd: { k: "add", spec: { name: "Klemmen", enable: ["7"], suppress: ["6"], mode: "quasistatic" } } });
    expect(m('pohyb fáze "Zpět" od 1,2 s').cmd).toMatchObject({ cmd: { spec: { start: { t: 1.2 } } } });
    expect(m("pohyb fáze 2 upravit při motor 1 >= 30").cmd).toMatchObject({ cmd: { k: "edit", ref: "2", spec: { start: { motor: "1", op: ">=", value: 30 } } } });
    expect(m("motion phase 2 up").cmd).toEqual({ op: "phase", cmd: { k: "move", ref: "2", dir: -1 } });
    expect(m("bewegung phase 3 löschen").cmd).toEqual({ op: "phase", cmd: { k: "remove", ref: "3" } });
    expect(m('pohyb událost při vazba "ZDVIH" <= 30 zapnout vazba 2').cmd).toMatchObject({ op: "phase", cmd: { k: "add", spec: { start: { mate: "ZDVIH", value: 30 }, enable: ["2"] } } });
    expect(m("pohyb stav detail").cmd).toEqual({ op: "detail" });
    expect(m("motion detail").cmd).toEqual({ op: "detail" });
    // chyby: nenavazující úsek, klíče bez času 0, okno pozpátku
    expect(parseAgentText("pohyb motor lineární vazba 1 80..50 pak 40..20").errors[0]?.message).toMatch(/nenavazuje na konec předchozího úseku 50/);
    expect(parseAgentText("pohyb motor lineární vazba 1 57,5..27,15 okno 0,6..0,2").errors[0]?.message).toMatch(/časové okno/);
  });

  it("EN / DE protokol fází (stejný výpočet)", async () => {
    for (const lang of ["en", "de"] as const) {
      setLang(lang);
      const env = fakeEnv();
      const r = await runLines(cell(), env, ...SETUP, ...PHASES, MOTOR);
      const txt = r.log.join("\n");
      expect(txt).toMatch(lang === "en" ? /Phase 2 “Sevření”: steps \d+–\d+ · t = 0\.6–/ : /Phase 2 „Sevření“: Schritte \d+–\d+ · t = 0,6–/);
      expect(r.kv).toMatch(/ phases=5\/5$/);
    }
  });

  it("dynamika po fázích zatím není – výslovná chyba, ne tiché ignorování", async () => {
    const env = fakeEnv();
    await expect(runLines(cell(), env, ...SETUP.slice(0, 2), 'pohyb fáze "D" dynamika')).rejects.toThrow(/dynamika po fázích zatím není/);
  });
});

describe("bod 3 – model motoru: úseky, klíče, okno (cad/motor-model.ts)", () => {
  const base: MotionMotor = { id: "m", kind: "linear", mate: "x", from: 80, to: 80 };
  it("úseky s rychlostí a prodlevou → klíče; hodnoty mezi klíči lineárně", () => {
    const mo = { ...base, to: 80, legs: [{ to: 50, speed: 50 }, { to: 40, speed: 50 }, { to: 40, time: 0.1 }, { to: 80, speed: 100 }] };
    const p = motorKeys(mo, 2);
    expect(p.keys.map((k) => [Number(k.t.toFixed(6)), k.v])).toEqual([[0, 80], [0.6, 50], [0.8, 40], [0.9, 40], [1.3, 80]]);
    expect(profileAt(p, 0.3)).toBeCloseTo(65, 9);
    expect(profileAt(p, 0.85)).toBe(40);
    expect(profileAt(p, 1.5)).toBe(80); // po posledním klíči stojí
    expect(piecewiseNeed(mo)).toBeCloseTo(1.3, 9);
    expect(motorSpan(mo, 2)).toMatchObject({ mode: "keys", start: 80, end: 80, stroke: 40, dir: -1 });
  });
  it("úseky bez času vyplní okno stejnou rychlostí; okno posune začátek (do t0 drží začátek)", () => {
    const t = fillLegs(80, [{ to: 50 }, { to: 40 }], 0.8).map((g) => g.time!);
    expect(t[0]).toBeCloseTo(0.6, 12);
    expect(t[1]).toBeCloseTo(0.2, 12);
    const mo = { ...base, from: 57.5, to: 27.15, window: { t0: 0.2, t1: 0.6 } };
    const p = motorKeys(mo, 1);
    expect(profileAt(p, 0.1)).toBe(57.5);
    expect(profileAt(p, 0.4)).toBeCloseTo((57.5 + 27.15) / 2, 9);
    expect(profileAt(p, 0.9)).toBeCloseTo(27.15, 9);
  });
  it("buildMotor s mezipolohami / úseky / klíči; studie dost dlouhá pro úseky s časem", () => {
    const mo = buildMotor({ kind: "linear", from: 80, points: [50, 40], speed: 50, extra: [{ to: 80, time: 0.4 }] }, { id: "a", mate: "x", abs: true, current: 80 });
    expect(mo).toMatchObject({ from: 80, to: 80, legs: [{ to: 50, speed: 50 }, { to: 40, speed: 50 }, { to: 80, time: 0.4 }] });
    expect(fitDuration({ motors: [mo], duration: 2, steps: 10 }, 0)).toEqual({ duration: 1.2000000000000002 });
    expect(() => fitDuration({ motors: [mo], duration: 2, steps: 10 }, 0, 1)).toThrow(/trvají do 1,2 s/);
    const k = buildMotor({ kind: "linear", keys: [{ t: 0, v: 57.5 }, { t: 0.3, v: 40 }] }, { id: "b", mate: "x", abs: true, current: 57.5 });
    expect(k).toMatchObject({ from: 57.5, to: 40, keys: [{ t: 0, v: 57.5 }, { t: 0.3, v: 40 }] });
    expect(() => buildMotor({ kind: "linear", keys: [{ t: 0.1, v: 1 }, { t: 0.3, v: 2 }] }, { id: "c", mate: "x", abs: true, current: 0 })).toThrow(/v čase 0/);
    // dřívější jednoduchý rozsah beze změny (bitově stejné hodnoty)
    const old = motorKeys({ ...base, from: 57.5, to: 27.15 }, 2);
    expect(profileAt(old, 1, { k: 3, n: 6 })).toBe(57.5 + ((27.15 - 57.5) * 3) / 6);
  });
});
