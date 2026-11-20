/**
 * Vlna 22, bod 3: převod dokument → skript zapíše fáze, úseky motoru, klíčové polohy, okno a fázi motoru (doc-script.ts →
 * doc-script-asm.ts) a řádky `pohyb …` přehrané na sestavě bez studie dají stejnou studii (tam a zpět) – česky, anglicky, německy.
 */
import { afterEach, describe, expect, it } from "vitest";
import { parseAgentText } from "./agent";
import { emptyAssembly, partComponent } from "./assembly";
import { docToScript } from "./doc-script";
import { setLang } from "./i18n";
import { boxPart, fakeEnv, runLines } from "./w22/w22-motion-fixture";
import type { CadDoc, MotionStudy, Vec3 } from "./types";
import "./ext/index";
import "./feat/index";

afterEach(() => setLang("cs"));

const mk = (n: string, size: Vec3, pos: Vec3, fixed = false) => ({ ...partComponent(boxPart(n, size), { position: pos }, fixed ? { fixed: true } : {}), id: n.toLowerCase().replace(/\s+/g, "-") });
const cell = (): CadDoc => ({
  ...emptyAssembly("Cyklus"),
  components: [mk("Rám", [100, 100, 10], [0, 0, 0], true), mk("Plech", [100, 100, 2], [0, 0, 10], true), mk("Horní deska", [100, 100, 10], [0, 0, 90]), mk("Přidržovač", [100, 100, 10], [0, 0, 42])],
});
const SETUP = [
  'sestava vazba vzdálenost "Horní deska" F1 "Rám" F2 hodnota 80 název "ZDVIH"',
  'sestava vazba souosost "Horní deska" F3 "Rám" F3',
  'sestava vazba zámek "Přidržovač" "Horní deska" název "NESENÍ"',
  'sestava vazba souosost "Přidržovač" F3 "Rám" F3',
  'sestava vazba vzdálenost "Přidržovač" F1 "Plech" F2 hodnota 30 název "MEZERA"',
  'sestava vazba "MEZERA" potlačit',
];
const STUDY = [
  'pohyb fáze "Nájezd"',
  'pohyb fáze "Sevření" při vazba "MEZERA" <= 0 potlačit vazba "NESENÍ" zapnout vazba "MEZERA" kvazistatika',
  'pohyb fáze "Návrat" od 1,1 s zapnout vazba "NESENÍ" potlačit vazba "MEZERA"',
  'pohyb motor lineární vazba "ZDVIH" 80..50..40 rychlost 50 prodleva 0,1 pak 80 rychlost 100 kroky 30',
  'pohyb motor lineární vazba "MEZERA" 0..5 okno 1,2..1,3',
];
/** studie bez id (id jsou náhodná) – motory a fáze porovnatelné mezi dvěma dokumenty */
const shape = (s: MotionStudy, d: CadDoc) => {
  const mate = (id: string) => d.mates!.find((m) => m.id === id)?.name ?? id;
  const ph = (id?: string) => s.phases?.find((p) => p.id === id)?.name;
  return {
    duration: s.duration,
    steps: s.steps,
    motors: s.motors.map((m) => ({ ...m, id: undefined, mate: mate(m.mate), phase: ph(m.phase) })),
    phases: s.phases?.map((p) => ({ ...p, id: undefined, enable: p.enable?.map(mate), suppress: p.suppress?.map(mate), start: p.start && "mate" in p.start ? { ...p.start, mate: mate(p.start.mate) } : p.start })),
  };
};

describe("bod 3 – fáze a úseky v převodu dokument → skript", () => {
  it("skript obsahuje fáze před motory a motor s úseky (od … pak … prodleva …), okno; přehrání dá stejnou studii", async () => {
    const env = fakeEnv();
    const src = await runLines(cell(), env, ...SETUP, ...STUDY);
    const text = docToScript(src.doc).text;
    const lines = text.split("\n").filter((l) => l.startsWith("pohyb"));
    expect(lines[0]).toBe('pohyb fáze "Nájezd"');
    expect(lines[1]).toBe('pohyb fáze "Sevření" při vazba 5 <= 0 potlačit vazba 3 zapnout vazba 5 kvazistatika');
    expect(lines[2]).toBe('pohyb fáze "Návrat" od 1.1 s potlačit vazba 5 zapnout vazba 3');
    expect(lines[3]).toMatch(/^pohyb motor lineární vazba 1 od 80 pak 50 rychlost 50 pak 40 rychlost 50 prodleva 0\.1 pak 80 rychlost 100 kroky 30$/);
    expect(lines[4]).toBe("pohyb motor lineární vazba 5 0..5 okno 1.2..1.3");
    expect(lines).toContain(`pohyb čas ${src.doc.motion!.duration}`);
    // přehrání řádků `pohyb …` na sestavě bez studie = stejná studie
    const base = { ...src.doc };
    delete base.motion;
    const back = await runLines(base, fakeEnv(), ...lines);
    expect(shape(back.doc.motion!, back.doc)).toEqual(shape(src.doc.motion!, src.doc));
  });
  it("klíčové polohy a fáze motoru; EN / DE skript projde rozborem bez chyb", async () => {
    const env = fakeEnv();
    const src = await runLines(cell(), env, ...SETUP, 'pohyb fáze "Dolů"', 'pohyb fáze "Zpět" od 1 s', "pohyb motor lineární vazba 1 klíče 0:80 0,5:60 kroky 20 čas 2", 'pohyb motor lineární vazba 1 60..80 fáze "Zpět"');
    const cs = docToScript(src.doc).text.split("\n").filter((l) => l.startsWith("pohyb"));
    expect(cs).toContain("pohyb motor lineární vazba 1 klíče 0:80 0.5:60 kroky 20");
    expect(cs).toContain('pohyb motor lineární vazba 1 60..80 fáze "Zpět"');
    for (const lang of ["en", "de"] as const) {
      const t = docToScript(src.doc, { lang }).text;
      const p = parseAgentText(t);
      expect(p.errors, lang).toEqual([]);
      expect(t).toMatch(lang === "en" ? /motion phase "Zpět" from 1 s/ : /bewegung phase "Zpět" von 1 s/);
      expect(t).toMatch(lang === "en" ? /motion motor linear mate 1 keys 0:80 0\.5:60/ : /bewegung antrieb linear verknüpfung 1 schlüssel 0:80 0\.5:60/);
    }
    const base = { ...src.doc };
    delete base.motion;
    const back = await runLines(base, fakeEnv(), ...cs);
    expect(shape(back.doc.motion!, back.doc)).toEqual(shape(src.doc.motion!, src.doc));
  });
});
