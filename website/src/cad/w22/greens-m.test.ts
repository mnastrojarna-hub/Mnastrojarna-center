/**
 * Vlna 22, balík M – „žádné falešně zelené“ u pohybové studie (hlavní zásada zprávy). Pro každý text úspěchu, kterého se body
 * etapy 1 balíku M týkají, je tu případ, kdy se NESMÍ vypsat: kontrola neproběhla, proběhla pro jiný vstup (jiný dokument, změněný díl,
 * změněná studie), nebo dopadla špatně.
 *
 * | text úspěchu | kde | nesmí se vypsat, když |
 * |---|---|---|
 * | „Vazby splněny ve všech krocích“ | souhrn studie (protokol, panel, API) | výsledek pro nynější stav neplatí (`pohyb stav`), vazby v některém kroku splněné nejsou |
 * | „Kolize: žádné ve všech krocích“ | souhrn studie | kolize se nepočítaly (vypnuté, nebo je jádro nespočítalo), výsledek neplatí |
 * | „Pohyb: výsledek platí … vazby splněny“, `motion=ok` | `stav` | jiný dokument, změněný díl / poloha / studie, nespočítáno, nesplněné vazby, kolize nekontrolované (`mates-ok`), ⚠ k motorům (`warn`) |
 * | „bez průniku těles v kontrolovaných krocích“ | `stav` | kolize nekontrolovány → „kolize nekontrolovány“ |
 * | platný výsledek z `motionCached` (panel „Výsledek platí“, export, `window.mncad.motion`) | panel / API | jiný dokument, jiný otisk |
 * | ✓ motor … bez varování | `pohyb motor` | začátek ≠ aktuální hodnota, motor nedojede, záporná mezera bez kontroly kolizí |
 *
 * GUI část (panel `data-motion-state`, přepnutí záložky, dávka motorů + přehrát) je v e2e `cad-w22-m.e2e.cjs`.
 */
import { describe, expect, it } from "vitest";
import { motionCached, motionRun } from "../asm-agent-kin";
import { statusKv } from "../engine/kv";
import { motionStatusOf, motionStoreOf, type MotionSlot } from "../motion-cache";
import { motionSummary } from "../motion";
import type { CadDoc } from "../types";
import { fakeEnv, press, resizePart, runLines } from "./w22-motion-fixture";

const MATE = 'sestava vazba vzdálenost "Deska A" F1 "Rám" F2 hodnota 57.5 název "ZDVIH"';
const GREEN_MATES = "Vazby splněny ve všech krocích";
const GREEN_CLASH = "Kolize: žádné ve všech krocích";

describe("zelené texty pohybové studie – kdy se nesmí vypsat", () => {
  it("„Vazby splněny ve všech krocích“: po změně dílu ji `pohyb stav` nevypíše (výsledek neplatí), až `pohyb spustit` po novém výpočtu", async () => {
    const env = fakeEnv();
    const a = await runLines(press(), env, MATE, "pohyb motor lineární vazba 1 57,5..27,15 kroky 4");
    expect(a.log).toContain(GREEN_MATES); // platný výsledek ji má
    const changed = resizePart(a.doc, "Rám", [100, 100, 15]);
    const st = await runLines(changed, env, "pohyb stav");
    expect(st.log.join("\n")).not.toContain(GREEN_MATES);
    expect(st.log.join("\n")).not.toMatch(/rozsah pohybu|konec \[/); // žádný starý souhrn
    expect(st.codes.map((c) => c.code)).toEqual(["motion.stale"]);
    expect(st.kv).toBe("motion steps=4 t=2 motors=1 motion.stale=1 m1=range:57.5>27.15:-"); // bez výsledkových polí (conflicts=, travel=); motory = definice
    const run = await runLines(changed, env, "pohyb spustit");
    expect(run.log).toContain(GREEN_MATES);
    expect(run.codes.map((c) => c.code)).toEqual(["motion.recomputed"]);
    expect(run.kv).toBe("motion steps=4 t=2 motors=1 conflicts=0 travel=30.35mm:1 static=1 m1=range:57.5>27.15:- level=kin"); // vlna 22, M2: úroveň na konci
    // krok, export i přehrání po další změně také nejdřív přepočítají (ℹ motion.recomputed) – nikdy starý krok
    const again = resizePart(changed, "Rám", [100, 100, 20]);
    const step = await runLines(again, env, "pohyb krok 4");
    expect(step.codes.map((c) => c.code)).toEqual(["motion.recomputed"]);
    expect(step.log.join("\n")).toMatch(/Deska A \[0; 0; 47,15\]/); // 20 + 27,15 (ne 42,15 ze starého výsledku)
  });
  it("„Vazby splněny…“ se nevypíše, když vazby splněné nejsou (motor proti pevné vzdálenosti)", async () => {
    const env = fakeEnv();
    const a = await runLines(press({ holder: true }), env, MATE, 'sestava vazba vzdálenost "Přidržovač" F1 "Rám" F2 hodnota 20', 'sestava vazba vzdálenost "Deska A" F1 "Přidržovač" F2 hodnota 29.5');
    const r = await runLines(a.doc, env, "pohyb motor lineární vazba 1 57,5..40 kroky 2");
    expect(r.log.join("\n")).not.toContain(GREEN_MATES);
    expect(r.log.join("\n")).toMatch(/⚠ nesplněné vazby v \d+ krocích/);
    const slot = env.motion ?? { key: "", store: motionStoreOf(env.geo) };
    expect(motionStatusOf(slot.store, slot.key, r.doc)!.state).toBe("conflict");
    expect(motionStatusOf(slot.store, slot.key, r.doc)!.line).not.toMatch(/vazby splněny/);
  });
  it("„Kolize: žádné ve všech krocích“ jen když se kolize opravdu počítaly: vypnuté ani nespočítané (bez jádra) ji nedají", async () => {
    const env = fakeEnv(); // prostředí bez kontroly kolizí
    const a = await runLines(press(), env, MATE);
    const off = await runLines(a.doc, env, "pohyb motor lineární vazba 1 57,5..27,15 kroky 2");
    expect(off.log.join("\n")).not.toContain(GREEN_CLASH);
    const asked = await runLines(a.doc, env, "pohyb motor lineární vazba 1 57,5..27,15 kroky 2 kolize");
    expect(asked.doc.motion!.collisions).toBe(true);
    expect(asked.log.join("\n")).not.toContain(GREEN_CLASH); // zapnuté, ale nespočítané ≠ žádné
    expect(motionSummary(motionCached(asked.doc, env)!, asked.doc).join("\n")).not.toContain(GREEN_CLASH);
    const checked = { ...fakeEnv(), interference: async () => [] };
    const ok = await runLines(a.doc, checked, "pohyb motor lineární vazba 1 57,5..27,15 kroky 2 kolize");
    expect(ok.log).toContain(GREEN_CLASH);
    // a po změně dílu ji stav studie nevypíše
    const st = await runLines(resizePart(ok.doc, "Deska A", [50, 100, 10]), checked, "pohyb stav");
    expect(st.log.join("\n")).not.toContain(GREEN_CLASH);
  });
  it("`stav`: „výsledek platí … vazby splněny“ a `motion=ok` jen pro dokument a stav výpočtu; jinak NEPLATÍ / nespočítáno a `motion.stale=1` / `motion=-`", async () => {
    const env = fakeEnv();
    const owner = {};
    const slot = (key: string): MotionSlot => ({ key, store: motionStoreOf(owner) });
    const a = await runLines(press(), { ...env, motion: slot("A") }, MATE, "pohyb motor lineární vazba 1 57,5..27,15 kroky 4");
    const kvOf = (d: CadDoc, key: string) => statusKv(d, null, { components: 2, parts: 2, motion: motionStatusOf(slot(key).store, key, d) });
    const okLine = motionStatusOf(slot("A").store, "A", a.doc)!;
    expect(okLine.line).toBe("Pohyb: výsledek platí pro tento stav sestavy – 4 kroků, vazby splněny, kolize nekontrolovány (podrobně pohyb stav)");
    // kolize se v této studii nekontrolovaly: vazby splněny, ale `motion=ok` to není (oprava po kontrole – dřív `motion=ok`)
    expect(kvOf(a.doc, "A")).toMatch(/ motion=mates-ok$/);
    expect(kvOf(a.doc, "A")).not.toMatch(/ motion=ok\b/);
    // jiný dokument se stejným obsahem (druhá záložka): nespočítáno
    expect(motionStatusOf(slot("B").store, "B", a.doc)!.line).toMatch(/^Pohyb: nespočítáno/);
    expect(kvOf(a.doc, "B")).toMatch(/ motion=-$/);
    expect(kvOf(a.doc, "B")).not.toMatch(/motion=ok/);
    // změněný díl, poloha, studie: NEPLATÍ
    for (const d of [resizePart(a.doc, "Rám", [100, 100, 12]), { ...a.doc, motion: { ...a.doc.motion!, steps: 9 } }, { ...a.doc, components: a.doc.components!.map((c, i) => (i === 1 ? { ...c, placement: { ...c.placement, position: [5, 0, 67.5] as [number, number, number] } } : c)) }]) {
      const s = motionStatusOf(slot("A").store, "A", d)!;
      expect(s.state).toBe("stale");
      expect(s.line).toMatch(/^Pohyb: výsledek NEPLATÍ – od výpočtu se změnilo: /);
      expect(s.line).not.toMatch(/vazby splněny|výsledek platí/);
      expect(kvOf(d, "A")).toMatch(/ motion=stale motion\.stale=1$/);
    }
    // sestava bez studie nemá řádek ani pole
    const noStudy = { ...a.doc, motion: undefined };
    expect(motionStatusOf(slot("A").store, "A", noStudy)).toBeUndefined();
    expect(kvOf(noStudy, "A")).not.toMatch(/motion/);
  });
  it("platný výsledek pro panel, export a API (`motionCached`) nikdy z jiného dokumentu ani z jiného stavu; `motionRun` vždy vrací výsledek nynějšího stavu", async () => {
    const env = fakeEnv();
    const owner = {};
    const envA = { ...env, motion: { key: "A", store: motionStoreOf(owner) } };
    const envB = { ...env, motion: { key: "B", store: motionStoreOf(owner) } };
    const a = await runLines(press(), envA, MATE, "pohyb motor lineární vazba 1 57,5..27,15 kroky 4");
    expect(motionCached(a.doc, envA)).not.toBeNull();
    expect(motionCached(a.doc, envB)).toBeNull();
    const changed = resizePart(a.doc, "Rám", [100, 100, 15]);
    expect(motionCached(changed, envA)).toBeNull();
    const res = await motionRun(changed, envA); // window.mncad.motion() jde touto cestou
    expect(res.steps[4].place["deska-a"].position[2]).toBeCloseTo(42.15, 6);
  });
  it("✓ motor bez varování jen u zadání bez skoku, s dojezdem a s nezápornou mezerou", async () => {
    const env = fakeEnv();
    const a = await runLines(press(), env, MATE);
    for (const [cmd, code] of [
      ["pohyb motor lineární vazba 1 0..30,35 kroky 2", "motion.start-jump"],
      ["pohyb motor lineární vazba 1 57,5..-5 kroky 2", "motion.gap-negative"],
    ] as const)
      expect((await runLines(a.doc, env, cmd)).codes.map((c) => c.code), cmd).toEqual([code]);
    const short = await runLines(a.doc, env, "pohyb motor lineární vazba 1 57,5..27,15 rychlost 15,175", "pohyb čas 0,5");
    expect(short.codes.map((c) => c.code)).toContain("motion.motor-short");
    expect((await runLines(a.doc, env, "pohyb motor lineární vazba 1 57,5..27,15 kroky 2")).codes).toEqual([]);
  });
});

/**
 * Vlna 22, etapa M2 (body 2, 7, 8) – zelené texty, které se NESMÍ vypsat:
 * | text | nesmí se vypsat, když |
 * |---|---|
 * | „Vazby splněny ve všech krocích“ | poloha dílu je vazbami neurčená (volný v mezi, kinematika), motor stojí na mezi |
 * | „✓ vazba N (…): hodnota …“ | úprava vazby nejde splnit (konflikt – polohy beze změny, ⚠ mate.conflict) |
 * | „Pružiny: … ✓“ v `stav` | délka nejde ověřit proti dosedacím plochám (nezkontrolováno), uložená délka plochám neodpovídá |
 * | „Úroveň simulace: kvazistatika“ | výpočet byl kinematický (výslovně nebo automaticky bez pružiny) |
 */
describe("zelené texty etapy M2 – kdy se nesmí vypsat", () => {
  it("„Vazby splněny ve všech krocích“ ne, když vazby polohu přidržovače neurčují (volný v mezi, kinematika) – ⚠ motion.undetermined", async () => {
    const env = fakeEnv();
    const a = await runLines(press({ holder: true }), env, MATE, 'sestava vazba mez-vzdálenosti "Přidržovač" F2 "Deska A" F1 min 5 max 25', "pohyb motor lineární vazba 1 57,5..40 kroky 2");
    expect(a.log.join("\n")).not.toContain(GREEN_MATES);
    expect(a.log.join("\n")).toMatch(/⚠ vazby splněny ve všech krocích, ale polohu „Přidržovač“ neurčují/);
    expect(a.codes.map((c) => c.code)).toContain("motion.undetermined");
    expect(a.kv).toMatch(/ undetermined=1 level=kin$/);
    // s preferovanou stranou je poloha určená → „Vazby splněny“ smí
    const b = await runLines(a.doc, env, 'sestava vazba 2 preferovat max', "pohyb spustit");
    expect(b.log).toContain(GREEN_MATES);
    expect(b.codes.map((c) => c.code)).not.toContain("motion.undetermined");
  });
  it("„Vazby splněny…“ ne, když motor stojí na mezi (pevná vazba přidržovače × mez) – ⚠ motion.motor-limit, bez ujetí", async () => {
    const env = fakeEnv();
    const a = await runLines(press({ holder: true }), env, MATE, 'sestava vazba vzdálenost "Přidržovač" F1 "Rám" F2 hodnota 20', 'sestava vazba mez-vzdálenosti "Přidržovač" F2 "Deska A" F1 min 5 max 40', "pohyb motor lineární vazba 1 57,5..27,15 kroky 4");
    expect(a.log.join("\n")).not.toContain(GREEN_MATES);
    expect(a.codes.map((c) => c.code)).toContain("motion.motor-limit");
    expect(a.kv).toMatch(/ stopped=\d+ level=kin$/);
  });
  it("„✓ vazba … hodnota“ ne, když úpravu nejde splnit: ⚠, polohy beze změny, ⚠ mate.conflict s nejbližší dosažitelnou hodnotou", async () => {
    const env = fakeEnv();
    const a = await runLines(press({ holder: true }), env, MATE, 'sestava vazba vzdálenost "Přidržovač" F1 "Rám" F2 hodnota 20', 'sestava vazba mez-vzdálenosti "Přidržovač" F2 "Deska A" F1 min 5 max 40');
    const before = a.doc.components!.map((c) => c.placement);
    const r = await runLines(a.doc, env, 'sestava vazba "ZDVIH" hodnota=30');
    expect(r.log[0]).toMatch(/^⚠ vazba 1 /);
    expect(r.log.join("\n")).not.toMatch(/^✓ vazba 1/m);
    expect(r.doc.components!.map((c) => c.placement)).toEqual(before);
    const c = r.codes.find((x) => x.code === "mate.conflict")!;
    expect(c.text).toMatch(/nejbližší dosažitelná hodnota 33 mm \(zadáno 30 mm\) – brání: /);
  });
  it("„Pružiny: … ✓“ ne, když délku nešlo ověřit proti plochám, ani když uložená délka plochám neodpovídá", async () => {
    const { springStatusLine } = await import("../asm-spring");
    const doc: CadDoc = { ...press(), components: [...press().components!, { id: "s", name: "P", source: { kind: "part", doc: (await import("../library/pins")).compressionSpring.make({ d: 2, D: 18, L: 32, n: 6 }) as CadDoc }, placement: { position: [0, 0, 10], rotation: [0, 0, 0] }, spring: { a: { compId: "rám", face: 1 }, b: { compId: "deska-a", face: 0 }, free: 32, solid: 14, length: 25, offset: 0, seat: 25 } }] };
    expect(springStatusLine(doc)).toMatch(/✓$/); // bez kontroly dosavadní tvar (jen uložená délka)
    expect(springStatusLine(doc, { checked: false, stale: [] })).not.toContain("✓");
    expect(springStatusLine(doc, { checked: true, stale: [{ id: "s", name: "P", stored: 25, derived: 57.5, seat: 57.5, offset: 0 }] })).toMatch(/– ⚠ pružina „P“: uložená délka 25 mm neodpovídá dosedacím plochám \(57,5 mm\)/);
  });
  it("„Úroveň simulace: kvazistatika“ ne u kinematického výpočtu", async () => {
    const env = fakeEnv();
    const a = await runLines(press(), env, MATE, "pohyb motor lineární vazba 1 57,5..40 kroky 2");
    expect(a.log.join("\n")).toMatch(/Úroveň simulace: kinematika – .*zvoleno automaticky: sestava nemá pružinu/);
    expect(a.log.join("\n")).not.toMatch(/Úroveň simulace: kvazistatika/);
    expect(a.kv).toMatch(/ level=kin$/);
  });
});
