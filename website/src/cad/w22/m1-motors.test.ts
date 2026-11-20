/**
 * Vlna 22, balík M, etapa M1 – regresní zkoušky bodů 9 a 11 zprávy na úrovni textových příkazů (bez jádra, syntetické plochy):
 * rozsah × rychlost (dojede na konec a stojí, směr a konec v protokolu, rozpor s délkou studie nikdy potichu), význam začátku
 * a konce podle druhu vazby, zdvih od aktuální hodnoty, skok začátku, motor zadaný komponentou B vazby Vzdálenost.
 * Na kódu před opravou tyto zkoušky selhávají (motor 57,5 → 87,85, díl v Z −47,5, žádné ⚠).
 */
import { afterEach, describe, expect, it } from "vitest";
import { motionCached, motionRun } from "../asm-agent-kin";
import { setLang } from "../i18n";
import { fakeEnv, press, resizePart, runLines } from "./m1-fixture";

afterEach(() => setLang("cs"));
const MATE = 'sestava vazba vzdálenost "Deska A" F1 "Rám" F2 hodnota 57.5 název "ZDVIH"';
const zOf = (res: NonNullable<ReturnType<typeof motionCached>>, step: number, id = "deska-a") => res.steps[step].place[id].position[2];

describe("bod 9 – rozsah × rychlost: přesný příkaz ze zprávy", () => {
  for (const [lang, cmd, text] of [
    ["cs", "pohyb motor lineární vazba 1 57.5..27.15 rychlost 15.175", "✓ motor 1: lineární motor · ZDVIH „Deska A“ → „Rám“ · hodnota vazby 57,5 → 27,15 mm ↓ zdvih 30,35 mm · 15,175 mm/s · 2 s"],
    ["en", "motion motor linear mate 1 57.5..27.15 speed 15.175", "✓ motor 1: linear motor · ZDVIH „Deska A“ → „Rám“ · mate value 57.5 → 27.15 mm ↓ stroke 30.35 mm · 15.175 mm/s · 2 s"],
    ["de", "bewegung antrieb linear verknüpfung 1 57.5..27.15 geschwindigkeit 15.175", "✓ Antrieb 1: Linearantrieb · ZDVIH „Deska A“ → „Rám“ · Verknüpfungswert 57,5 → 27,15 mm ↓ Hub 30,35 mm · 15,175 mm/s · 2 s"],
  ] as const)
    it(`${lang}: dojede z 57,5 na 27,15 rychlostí 15,175 mm/s za 2 s a stojí; směr a konec v protokolu; žádný český zlomek`, async () => {
      const env = fakeEnv();
      const a = await runLines(press(), env, MATE);
      setLang(lang);
      const r = await runLines(a.doc, env, cmd);
      expect(r.log[0]).toBe(text);
      // délka studie = |27,15 − 57,5| / 15,175 = 2 s; motor je „rozsah × rychlost“ s koncem – nic se nezahodilo
      expect(r.doc.motion).toMatchObject({ duration: 2, motors: [{ kind: "linear", from: 57.5, to: 27.15, speed: 15.175, ranged: true }] });
      const res = motionCached(r.doc, env)!;
      const n = res.steps.length - 1;
      expect(res.steps[0].motors[0]).toBe(57.5);
      expect(res.steps[n].motors[0]).toBeCloseTo(27.15, 9); // dřív 87,85 (opačným směrem)
      expect(zOf(res, n)).toBeCloseTo(37.15, 6); // dřív 97,85
      // klesá monotónně a nikdy nepřejede konec
      for (let k = 1; k <= n; k++) expect(res.steps[k].motors[0]).toBeLessThan(res.steps[k - 1].motors[0]);
      expect(Math.min(...res.steps.map((s) => s.motors[0]))).toBeGreaterThanOrEqual(27.15 - 1e-9);
      // EN / DE protokol bez nepřeložených českých slov (dřív „od 57.5 mm“)
      if (lang !== "cs") expect(r.log.join("\n")).not.toMatch(/ od \d|zdvih|hodnota vazby|rychlostí|kroků/);
      expect(r.codes).toEqual([]);
    });

  it("rozpor s délkou studie nikdy potichu: kratší čas = chyba s vysvětlením, delší = motor po dojetí stojí (je to napsáno)", async () => {
    const env = fakeEnv();
    const a = await runLines(press(), env, MATE);
    await expect(runLines(a.doc, env, "pohyb motor lineární vazba 1 57.5..27.15 rychlost 15.175 čas 1")).rejects.toThrow(/rozsah 30,35 mm rychlostí 15,175 mm\/s trvá 2 s, zadaný čas 1 s nestačí – vynechte čas \(délka studie bude 2 s\), nebo rychlost/);
    const r = await runLines(a.doc, env, "pohyb motor lineární vazba 1 57.5..27.15 rychlost 15.175 čas 3 kroky 6");
    expect(r.doc.motion!.duration).toBe(3);
    expect(r.log[0]).toMatch(/57,5 → 27,15 mm ↓ zdvih 30,35 mm · 15,175 mm\/s · 2 s \(pak stojí do konce studie 3 s\)$/);
    const res = motionCached(r.doc, env)!;
    expect(res.steps.map((s) => Math.round(s.motors[0] * 1e4) / 1e4)).toEqual([57.5, 49.9125, 42.325, 34.7375, 27.15, 27.15, 27.15]); // po 2 s stojí na konci
  });
  it("záporná rychlost proti rostoucímu rozsahu = chyba; kladná i záporná rychlost u klesajícího rozsahu = totéž (velikost)", async () => {
    const env = fakeEnv();
    const a = await runLines(press(), env, MATE);
    await expect(runLines(a.doc, env, "pohyb motor lineární vazba 1 27.15..57.5 rychlost -15.175")).rejects.toThrow(/rychlost -15,175 je záporná, ale rozsah 27,15 → 57,5 mm roste/);
    const r = await runLines(a.doc, env, "pohyb motor lineární vazba 1 57.5..27.15 rychlost -15.175");
    expect(r.doc.motion!.motors[0]).toMatchObject({ from: 57.5, to: 27.15, speed: 15.175, ranged: true });
    await expect(runLines(a.doc, env, "pohyb motor lineární vazba 1 57.5..27.15 rychlost 0")).rejects.toThrow(/rychlost musí být nenulová/);
  });
  it("studie později zkrácená pod dobu jízdy: ⚠ motion.motor-short (kde motor skončí), ne tiché useknutí", async () => {
    const env = fakeEnv();
    const a = await runLines(press(), env, MATE, "pohyb motor lineární vazba 1 57.5..27.15 rychlost 15.175");
    const r = await runLines(a.doc, env, "pohyb čas 1");
    expect(r.codes.map((c) => c.code)).toEqual(["motion.motor-short"]);
    expect(r.codes[0].text).toBe("motor 1 nedojede na konec: 30,35 mm rychlostí 15,175 mm/s trvá 2 s, studie má 1 s – skončí na 42,325 mm; pohyb čas 2");
    const res = motionCached(r.doc, env)!;
    expect(res.steps[res.steps.length - 1].motors[0]).toBeCloseTo(42.325, 9);
  });
  it("jen rychlost (bez konce) zůstává: jede od aktuální hodnoty vazby, protokol říká „bez koncové hodnoty“ a kam za dobu studie dojede", async () => {
    const env = fakeEnv();
    const a = await runLines(press(), env, MATE);
    const r = await runLines(a.doc, env, "pohyb motor lineární vazba 1 rychlost -10 kroky 4");
    expect(r.doc.motion!.motors[0]).toMatchObject({ from: 57.5, speed: -10 });
    expect(r.doc.motion!.motors[0].ranged).toBeUndefined();
    expect(r.log[0]).toBe("✓ motor 1: lineární motor · ZDVIH „Deska A“ → „Rám“ · hodnota vazby od 57,5 mm ↓ rychlostí 10 mm/s (bez koncové hodnoty – za 2 s na 37,5 mm)");
    expect(r.codes).toEqual([]); // začátek = aktuální hodnota → žádný skok (dřív začátek 0 = skok o 57,5)
    // výslovný začátek s rychlostí: „od 40 rychlost 5“
    const s = await runLines(a.doc, env, "pohyb motor lineární vazba 1 od 40 rychlost 5 kroky 4");
    expect(s.doc.motion!.motors[0]).toMatchObject({ from: 40, speed: 5 });
    expect(s.codes.map((c) => c.code)).toEqual(["motion.start-jump"]);
  });
  it("rotační: 0..720 ot/min 60 = dvě otáčky za 2 s a stojí; druhý motor s delší jízdou prodlouží studii s ⚠", async () => {
    const env = fakeEnv();
    const a = await runLines(press({ holder: true }), env, 'sestava vazba souosost "Deska A" F3 "Rám" F3', 'sestava vazba souosost "Přidržovač" F3 "Rám" F3');
    const r = await runLines(a.doc, env, "pohyb motor rotační vazba 1 0..720 ot/min 60 kroky 8");
    expect(r.doc.motion).toMatchObject({ duration: 2, motors: [{ from: 0, to: 720, speed: 60, ranged: true }] });
    expect(r.log[0]).toMatch(/natočení od výchozí polohy 0 → 720° ↺ otočení 720° · 60 ot\/min · 2 s$/);
    const r2 = await runLines(r.doc, env, "pohyb motor lineární vazba 2 0..30 rychlost 10");
    expect(r2.doc.motion!.duration).toBe(3);
    expect(r2.codes.map((c) => c.code)).toEqual(["motion.duration-extended"]);
    expect(r2.codes[0].text).toBe("délka studie prodloužena z 2 s na 3 s – motor 2 potřebuje na svůj rozsah 3 s (ostatní motory s rozsahem bez rychlosti tím zpomalí)");
    // první motor po 2 s stojí na 720° – je to v jeho popisu
    const st = await runLines(r2.doc, env, "pohyb stav");
    expect(st.log.join("\n")).toMatch(/0 → 720° ↺ otočení 720° · 60 ot\/min · 2 s \(pak stojí do konce studie 3 s\)/);
  });
});

describe("bod 11 – absolutní hodnota vazby × zdvih", () => {
  it("Vzdálenost: začátek a konec jsou hodnoty vazby; protokol vždy uvádí zdvih a směr", async () => {
    const env = fakeEnv();
    const r = await runLines(press(), env, MATE, "pohyb motor lineární vazba 1 57,5..27,15 kroky 2");
    expect(r.log.find((l) => l.startsWith("✓ motor"))).toBe("✓ motor 1: lineární motor · ZDVIH „Deska A“ → „Rám“ · hodnota vazby 57,5 → 27,15 mm ↓ zdvih 30,35 mm");
    expect(zOf(motionCached(r.doc, env)!, 2)).toBeCloseTo(37.15, 6);
    expect(r.codes).toEqual([]);
  });
  it("zdvih místo konce: „zdvih -30,35“ = od aktuální hodnoty 57,5 na 27,15 (EN stroke, DE hub; i s výslovným začátkem)", async () => {
    const env = fakeEnv();
    const a = await runLines(press(), env, MATE);
    for (const cmd of ["pohyb motor lineární vazba 1 zdvih -30,35 kroky 2", "motion motor linear mate 1 stroke -30.35 steps 2", "bewegung antrieb linear verknüpfung 1 hub -30,35 schritte 2", "pohyb motor lineární vazba 1 od 57,5 zdvih -30,35 kroky 2"]) {
      const r = await runLines(a.doc, env, cmd);
      expect(r.doc.motion!.motors[0], cmd).toMatchObject({ from: 57.5, to: 27.15 });
      expect(r.log[0], cmd).toMatch(/hodnota vazby 57,5 → 27,15 mm ↓ zdvih 30,35 mm$/);
      expect(r.codes, cmd).toEqual([]);
    }
    // zdvih + rychlost = rozsah × rychlost
    const r = await runLines(a.doc, env, "pohyb motor lineární vazba 1 zdvih -30,35 rychlost 15,175");
    expect(r.doc.motion).toMatchObject({ duration: 2, motors: [{ from: 57.5, to: 27.15, ranged: true }] });
    await expect(runLines(a.doc, env, "pohyb motor lineární vazba 1 57,5..27,15 zdvih 5")).rejects.toThrow(/zadejte konec \(od\.\.do\), nebo zdvih – ne obojí/);
    await expect(runLines(a.doc, env, "pohyb motor lineární vazba 1 zdvih 0")).rejects.toThrow(/zdvih je nulový/);
  });
  it("uživatel zadá zdvih jako konec (0..30,35): ⚠ motion.start-jump s hodnotami – dřív tichý skok o 57,5 mm a zelený souhrn bez slova", async () => {
    const env = fakeEnv();
    const r = await runLines(press(), env, MATE, "pohyb motor lineární vazba 1 0..30,35 kroky 2");
    expect(r.codes.map((c) => c.code)).toEqual(["motion.start-jump"]);
    expect(r.codes[0].text).toBe("motor 1: začátek 0 mm se liší od aktuální hodnoty vazby „ZDVIH“ 57,5 mm – v kroku 0 díl přeskočí o 57,5 mm; zdvih od aktuální hodnoty: pohyb motor … zdvih Δ");
    expect(zOf(motionCached(r.doc, env)!, 0)).toBeCloseTo(10, 6); // skok tam opravdu je – proto varování
  });
  it("Souosost: hodnoty jsou posuv od výchozí polohy – je to napsáno; začátek ≠ 0 dá ⚠", async () => {
    const env = fakeEnv();
    const a = await runLines(press(), env, 'sestava vazba souosost "Deska A" F3 "Rám" F3 název "VEDENÍ"');
    const r = await runLines(a.doc, env, "pohyb motor lineární vazba 1 0..-30,35 kroky 2");
    expect(r.log[0]).toBe("✓ motor 1: lineární motor · VEDENÍ „Deska A“ → „Rám“ · posuv od výchozí polohy 0 → -30,35 mm ↓ zdvih 30,35 mm");
    expect(r.codes).toEqual([]);
    expect(zOf(motionCached(r.doc, env)!, 2)).toBeCloseTo(37.15, 6);
    const j = await runLines(a.doc, env, "pohyb motor lineární vazba 1 57,5..27,15 kroky 2");
    expect(j.codes.map((c) => c.code)).toEqual(["motion.start-jump"]);
    expect(j.codes[0].text).toMatch(/začátek 57,5 mm není 0 – u vazby „VEDENÍ“ je hodnota motoru posuv \/ natočení od výchozí polohy, v kroku 0 díl přeskočí o 57,5 mm/);
    // bez zadaného začátku se u posuvu začíná na 0 (výchozí poloha)
    const s = await runLines(a.doc, env, "pohyb motor lineární vazba 1 zdvih -30,35 kroky 2");
    expect(s.doc.motion!.motors[0]).toMatchObject({ from: 0, to: -30.35 });
  });
  it("CHYBA ze zprávy: motor zadaný komponentou B vazby Vzdálenost už neobrací znaménko absolutní mezery (díl dřív prošel ukotvenou deskou se zeleným souhrnem)", async () => {
    const env = fakeEnv();
    // vazba A = Rám (horní), B = Deska A (spodní) – „Deska A“ je B vazby
    const a = await runLines(press(), env, 'sestava vazba vzdálenost "Rám" F2 "Deska A" F1 hodnota 57,5 název "ZDVIH"');
    const r = await runLines(a.doc, env, 'pohyb motor lineární "Deska A" 57,5..27,15 kroky 2');
    expect(r.doc.motion!.motors[0]).toMatchObject({ from: 57.5, to: 27.15 }); // dřív −57,5 … −27,15
    expect(r.log[0]).toBe("✓ motor 1: lineární motor · ZDVIH „Rám“ → „Deska A“ · hodnota vazby 57,5 → 27,15 mm ↓ zdvih 30,35 mm (hodnota vazby je absolutní – nezáleží na tom, že komponenta je B vazby)");
    const res = motionCached(r.doc, env)!;
    expect(zOf(res, 0)).toBeCloseTo(67.5, 6); // krok 0 = výchozí poloha (dřív Z −47,5)
    expect(zOf(res, 2)).toBeCloseTo(37.15, 6); // dřív Z −17,15 – skrz ukotvený Rám (Z 0…10)
    expect(Math.min(...res.steps.map((s) => s.place["deska-a"].position[2]))).toBeGreaterThan(10); // nikdy pod horní plochou rámu
    expect(r.codes).toEqual([]);
    // u relativní vazby (Souosost) se znaménko komponenty B obrací dál – a protokol to říká
    const c = await runLines(press(), env, 'sestava vazba souosost "Rám" F3 "Deska A" F3');
    const rc = await runLines(c.doc, env, 'pohyb motor lineární "Deska A" 0..-30,35 kroky 2');
    expect(rc.doc.motion!.motors[0]).toMatchObject({ from: -0, to: 30.35 });
    expect(rc.log[0]).toMatch(/\(komponenta je B vazby – hodnoty s opačným znaménkem\)$/);
  });
  it("mezera vazby Vzdálenost pod nulou bez kontroly kolizí: ⚠ motion.gap-negative vedle „Vazby splněny“ (splněné vazby neříkají nic o tělesech)", async () => {
    const env = fakeEnv();
    const r = await runLines(press(), env, MATE, "pohyb motor lineární vazba 1 57,5..-5 kroky 2");
    expect(r.codes.map((c) => c.code)).toEqual(["motion.gap-negative"]);
    expect(r.codes[0].text).toMatch(/hodnota vazby „ZDVIH“ klesne pod nulu \(-5 mm\) – plochy vazby se prostoupí/);
    // kolize zapnuté, ale jádro je nespočítalo (prostředí bez kontroly kolizí) → varování zůstává: nekontrolováno není „bez kolizí“
    const k0 = await runLines(r.doc, env, "pohyb kolize");
    expect(k0.codes.map((c) => c.code)).toContain("motion.gap-negative");
    expect(k0.log.join("\n")).not.toMatch(/Kolize: žádné/);
    // se skutečnou kontrolou kolizí v každém kroku varování není potřeba – průnik hlásí kolize kroků
    const env2 = { ...fakeEnv(), interference: async () => [] };
    const k = await runLines(r.doc, env2, "pohyb kolize");
    expect(k.codes.map((c) => c.code)).not.toContain("motion.gap-negative");
  });
});

describe("bod 1 (pohyb) – výsledek studie po změně geometrie dílu", () => {
  it("po změně rozměru dílu (polohy, vazby i studie beze změny) se starý výsledek nevrací jako platný a studie se počítá znovu", async () => {
    const env = fakeEnv();
    const a = await runLines(press(), env, MATE, "pohyb motor lineární vazba 1 57,5..27,15 kroky 4");
    const first = motionCached(a.doc, env)!;
    expect(zOf(first, 4)).toBeCloseTo(37.15, 6);
    // rám o 5 mm vyšší – deska při mezeře 27,15 musí skončit na Z 42,15
    const changed = resizePart(a.doc, "Rám", [100, 100, 15]);
    expect(motionCached(changed, env)).toBeNull(); // dřív: starý výsledek (klíč mezipaměti bez geometrie dílů)
    const again = await motionRun(changed, env);
    expect(zOf(again, 4)).toBeCloseTo(42.15, 6); // dřív 37,15 z mezipaměti
    const run = await runLines(changed, env, "pohyb spustit", "pohyb krok 4");
    expect(run.log.join("\n")).toMatch(/Deska A \[0; 0; 42,15\]/);
  });
});
