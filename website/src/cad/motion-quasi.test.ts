/**
 * Vlna 22, bod 2 – předpětí pružiny řídí polohu přidržovače (syntetická geometrie ploch, bez jádra; čísla jako repro bodu 2):
 * Rám pevně (horní plocha z = 10), Deska A na motoru (vazba ZDVIH = mezera spodek Desky A – vrch Rámu, 57,5 → 27,15, 12 kroků),
 * Přidržovač 8 mm volně: Mez k Desce A ⟨5; 25⟩, Dosed k Rámu ⟨0; 500⟩, pružina mezi Přidržovačem a Deskou A (L0 32 · Ln 14 · c 20).
 * Fyzikálně: Z_přidržovač = max(10; Z_deska − 33) – krok 6 = 19,325, krok 12 = 10, stejně nahoru i dolů a z libovolné výchozí polohy.
 */
import { afterEach, describe, expect, it } from "vitest";
import { compressionSpring } from "./library/pins";
import { setLang } from "./i18n";
import type { FaceGeo, GeoProvider } from "./mates";
import { solveStatic } from "./mates-static";
import { motionFindings, motionSummary, runMotion, type MotionResult } from "./motion";
import { levelKv, levelLine, studyMode } from "./motion-mode";
import { motionKv } from "./asm-agent-kin";
import { emptyDoc, type AsmComponent, type CadDoc, type Mate, type MateRef, type MotionStudy, type Placement, type Vec3 } from "./types";

afterEach(() => setLang("cs"));

const P = (position: Vec3 = [0, 0, 0]): Placement => ({ position, rotation: [0, 0, 0] });
const f = (compId: string, face: number): MateRef => ({ compId, face });
const comp = (id: string, placement: Placement, extra: Partial<AsmComponent> = {}): AsmComponent => ({ id, name: id, source: { kind: "part", doc: emptyDoc(id) }, placement, ...extra });
const G: Record<string, Record<string, FaceGeo>> = {
  R: { f0: { kind: "plane", origin: [50, 50, 10], normal: [0, 0, 1] } },
  A: { f0: { kind: "plane", origin: [50, 50, 0], normal: [0, 0, -1] } },
  H: { f0: { kind: "plane", origin: [30, 30, 8], normal: [0, 0, 1] }, f1: { kind: "plane", origin: [30, 30, 0], normal: [0, 0, -1] } },
};
const geo: GeoProvider = (r) => G[r.compId]?.[`f${r.face}`] ?? null;

/** sestava bodu 2: `hz` = výchozí Z přidržovače (34,5 = mezera 25, 44,5 = mezera 15), `dosed` = mez k rámu, `prefer` = preferovaná strana „Mez“ */
function rig(o: { hz?: number; az?: number; dosed?: boolean; prefer?: "min" | "max"; fixedH?: number; spring?: boolean } = {}): CadDoc {
  const hz = o.hz ?? 34.5;
  const spring = compressionSpring.make({ d: 2, D: 18, L: 32, n: 6 }) as CadDoc; // osa Z, začátek −1, L0 32, Ln (6+1)·2 = 14
  const mates: Mate[] = [
    { id: "zdvih", name: "ZDVIH", type: "distance", a: f("A", 0), b: f("R", 0), value: (o.az ?? 67.5) - 10 },
    { id: "mez", name: "Mez", type: "limitDistance", a: f("H", 0), b: f("A", 0), min: 5, max: 25, ...(o.prefer ? { prefer: o.prefer } : {}) },
    ...(o.dosed === false ? [] : [{ id: "dosed", name: "Dosed", type: "limitDistance", a: f("H", 1), b: f("R", 0), min: 0, max: 500 } as Mate]),
    ...(o.fixedH !== undefined ? [{ id: "pevna", name: "PEVNÁ", type: "distance", a: f("H", 1), b: f("R", 0), value: o.fixedH } as Mate] : []),
    ...(o.spring === false ? [] : [{ id: "zamek", type: "lock", a: f("S", -1), b: f("H", -1) } as Mate]),
  ];
  const comps: AsmComponent[] = [comp("R", P(), { fixed: true }), comp("A", P([0, 0, o.az ?? 67.5])), comp("H", P([20, 20, hz]))];
  if (o.spring !== false) comps.push({ id: "S", name: "Pružina", source: { kind: "part", doc: spring }, placement: P([50, 50, hz + 8 + 1]), spring: { a: f("H", 0), b: f("A", 0), free: 32, solid: 14, rate: 20 } });
  return { ...emptyDoc("Mechanika"), kind: "assembly", components: comps, mates };
}
const study = (from = 57.5, to = 27.15, mode?: MotionStudy["mode"]): MotionStudy => ({ motors: [{ id: "m", kind: "linear", mate: "zdvih", from, to }], duration: 2, steps: 12, ...(mode ? { mode } : {}) });
const hz = (res: MotionResult, k: number) => res.steps[k].place.H.position[2];
const az = (res: MotionResult, k: number) => res.steps[k].place.A.position[2];
const physical = (zA: number) => Math.max(10, zA - 33);

describe("bod 2 – kvazistatika: předpětí drží přidržovač u meze, dokud nedosedne na rám", () => {
  it("výchozí (automatický) režim = kvazistatika; krok 6 = 19,325, krok 12 = 10; každý krok Z = max(10; Z_deska − 33)", async () => {
    const d = rig();
    expect(studyMode(d, d.motion).mode).toBe("quasistatic");
    const res = await runMotion(d, geo, study());
    expect(res.level).toMatchObject({ level: "quasistatic", auto: true });
    expect(hz(res, 6)).toBeCloseTo(19.325, 4);
    expect(hz(res, 12)).toBeCloseTo(10, 4);
    for (let k = 0; k <= 12; k++) expect(hz(res, k), `krok ${k}`).toBeCloseTo(physical(az(res, k)), 4);
    expect(res.conflictSteps).toBe(0);
    // bez bočního ujetí a naklopení
    for (const s of res.steps) {
      expect(s.place.H.position[0]).toBeCloseTo(20, 6);
      expect(s.place.H.position[1]).toBeCloseTo(20, 6);
      expect(Math.max(...s.place.H.rotation.map(Math.abs))).toBeLessThan(1e-6);
    }
    // úroveň v protokolu a na strojovém řádku
    const sum = motionSummary(res, d);
    expect(sum[1]).toBe(levelLine(res.level!));
    expect(sum[1]).toMatch(/^Úroveň simulace: kvazistatika – .*zvoleno automaticky: sestava má pružinu „Pružina“/);
    expect(motionKv(res, null, 2)).toMatch(/ level=quasi groups=\S+$/);
  });

  it("stejný výsledek nahoru i dolů (akceptace zprávy): krok se stejnou hodnotou motoru = stejná poloha", async () => {
    const down = await runMotion(rig(), geo, study(57.5, 27.15));
    const up = await runMotion(rig({ az: 37.15 }), geo, study(27.15, 57.5));
    for (let k = 0; k <= 12; k++) {
      expect(az(up, 12 - k)).toBeCloseTo(az(down, k), 6);
      expect(hz(up, 12 - k), `krok ${k}`).toBeCloseTo(hz(down, k), 4);
    }
    expect(hz(up, 6)).toBeCloseTo(19.325, 4);
  });

  it.each([34.5, 44.5, 30, 20])("nezávisle na výchozí poloze přidržovače v dokumentu (Z %d) – krok 0 je rovnováha", async (z) => {
    const res = await runMotion(rig({ hz: z }), geo, study());
    expect(hz(res, 0)).toBeCloseTo(34.5, 4);
    expect(hz(res, 6)).toBeCloseTo(19.325, 4);
    expect(hz(res, 12)).toBeCloseTo(10, 4);
  });

  it("výslovná kinematika: poloha přidržovače neurčena → ⚠ motion.undetermined, souhrn neříká jen „Vazby splněny“", async () => {
    const d = rig({ hz: 44.5 });
    const res = await runMotion(d, geo, study(57.5, 27.15, "kinematic"));
    expect(res.level).toMatchObject({ level: "kinematic" });
    expect(res.level!.auto).toBeUndefined();
    expect(res.undetermined).toEqual([{ comp: "H", mates: ["mez", "dosed"], springs: ["Pružina"] }]);
    const sum = motionSummary(res, d);
    expect(sum).not.toContain("Vazby splněny ve všech krocích");
    expect(sum.join("\n")).toMatch(/⚠ vazby splněny ve všech krocích, ale polohu „H“ neurčují/);
    const u = motionFindings(res, d).find((x) => x.code === "motion.undetermined")!;
    expect(u.text).toMatch(/poloha „H“ není vazbami určena \(volná v mezi „Mez“ ⟨5; 25⟩ \(vazba 2\), „Dosed“ ⟨0; 500⟩ \(vazba 3\)\) – kinematika ji nechává, kde byla .* pružina „Pružina“ by ji tlačila: fyzikální poloha = pohyb kvazistatika/);
    expect(motionKv(res, null, 2)).toMatch(/ undetermined=1 level=kin groups=\S+$/);
  });

  it("kinematika s preferovanou stranou meze: stejné polohy jako kvazistatika, nahoru i dolů", async () => {
    const down = await runMotion(rig({ prefer: "max", hz: 44.5 }), geo, study(57.5, 27.15, "kinematic"));
    const up = await runMotion(rig({ prefer: "max", az: 37.15, hz: 12 }), geo, study(27.15, 57.5, "kinematic"));
    // fáze 2 (VĚDOMÁ změna): preference „Mez“ určuje Z přidržovače, a tím i mezeru „Dosed“ ve stejném směru – dřív se Dosed hlásil
    // jako neurčený (falešné ⚠ motion.undetermined, přísný běh syntetického nástroje stál); neurčená zůstává jen mez v jiném, volném směru
    expect(down.undetermined).toBeUndefined();
    expect(hz(down, 6)).toBeCloseTo(19.325, 4);
    expect(hz(down, 12)).toBeCloseTo(10, 4);
    expect(hz(up, 6)).toBeCloseTo(19.325, 4);
  });

  it("preference jedné meze neurčí mez v jiném volném směru (posuv v X zůstane ⚠ motion.undetermined)", async () => {
    const d = rig({ prefer: "max", hz: 44.5 });
    // boční mez přidržovače v X (rovina x = 20 přidržovače ↔ rovina x = 0 rámu): X přidržovače vazby neurčují ani s preferencí „Mez“
    G.H.f2 = { kind: "plane", origin: [20, 30, 4], normal: [-1, 0, 0] };
    G.R.f1 = { kind: "plane", origin: [0, 50, 5], normal: [1, 0, 0] };
    try {
      const side: Mate = { id: "bok", name: "Bok", type: "limitDistance", a: f("H", 2), b: f("R", 1), min: 0, max: 50 };
      const res = await runMotion({ ...d, mates: [...d.mates!, side] }, geo, study(57.5, 27.15, "kinematic"));
      expect(res.undetermined?.map((u) => u.mates)).toEqual([["bok"]]);
    } finally {
      delete G.H.f2;
      delete G.R.f1;
    }
  });

  it("preference nikdy nepřebije pevnou vazbu: přidržovač s pevnou vzdáleností 24,5 k rámu stojí na 34,5", async () => {
    // bez pružiny (její délka na doraz Ln by jinak motor zastavila – viz bod 8); preference min táhne přidržovač k desce, pevná vazba ho drží
    const res = await runMotion(rig({ prefer: "min", dosed: false, fixedH: 24.5, spring: false }), geo, { ...study(57.5, 40), mode: "kinematic" });
    for (const s of res.steps) expect(s.place.H.position[2]).toBeCloseTo(34.5, 6);
    expect(res.conflictSteps).toBe(0);
    expect(res.undetermined).toBeUndefined(); // poloha je určená pevnou vazbou
  });

  it("délka pružiny na doraz Ln je tvrdý doraz: motor se zastaví, když by pružinu stlačil pod Ln (dřív prošel a řádek pružiny byl ✗)", async () => {
    const res = await runMotion(rig({ dosed: false, fixedH: 24.5 }), geo, study(57.5, 40));
    // seat = Z_deska − 42,5 ≥ Ln 14 → deska nejníž na 56,5 (ZDVIH 46,5); kroky 8–12 motor stojí
    expect(res.steps.filter((s) => s.status === "stopped").map((s) => s.i)).toEqual([8, 9, 10, 11, 12]);
    for (const k of [8, 12]) {
      expect(res.steps[k].place.A.position[2]).toBeCloseTo(56.5, 4);
      expect(res.steps[k].springs!.S.length).toBeCloseTo(14, 3);
      expect(res.steps[k].reached![0]).toBeCloseTo(46.5, 4);
      expect(res.steps[k].conflicts).toEqual(expect.arrayContaining(["zdvih", "spring:S"]));
    }
    const lim = motionFindings(res, rig()).find((x) => x.code === "motion.motor-limit")!;
    expect(lim.text).toMatch(/^motor 1 stojí na mezi v krocích 8–12 \(t = 1\.333–2 s\): žádáno 45,833 → 40 mm, dosaženo 46,5 mm – brání: /);
    expect(lim.text).toContain("„PEVNÁ H → R“ 24,5 mm (splněno)");
    expect(lim.text).toContain("pružina „Pružina“ 14 mm – na délce na doraz Ln 14 mm");
  });

  it("statický přepočet je deterministický: ZDVIH 27,15 a zpět 57,5 dá tutéž polohu jako sestava hned po vložení", () => {
    const eq = (d: CadDoc) => {
      const r = solveStatic(d, geo, null, { equilibrium: true });
      return { ...d, components: r.components.map((c) => ({ ...c })) };
    };
    const set = (d: CadDoc, v: number): CadDoc => ({ ...d, mates: d.mates!.map((m) => (m.id === "zdvih" ? { ...m, value: v } : m)) });
    const zOf = (d: CadDoc) => d.components!.find((c) => c.id === "H")!.placement.position[2];
    for (const start of [34.5, 44.5, 30]) {
      const a = eq(rig({ hz: start }));
      expect(zOf(a), `start ${start}`).toBeCloseTo(34.5, 4);
      const down = eq(set(a, 27.15));
      expect(zOf(down)).toBeCloseTo(10, 4);
      const back = eq(set(down, 57.5));
      expect(zOf(back)).toBeCloseTo(34.5, 4);
    }
    // bez rovnováhy (zjišťování stavu) se nic neposouvá
    expect(solveStatic(rig({ hz: 44.5 }), geo, null).moved).not.toContain("H");
  });

  it("režim, úroveň a strojová podoba: animace / kinematika / kvazistatika / dynamika, + geometrická aproximace", () => {
    expect(levelKv({ level: "kinematic" })).toBe("level=kin");
    expect(levelKv({ level: "quasistatic" })).toBe("level=quasi");
    expect(levelKv({ level: "dynamic" })).toBe("level=dyn");
    expect(levelKv({ level: "animation", geo: true })).toBe("level=anim+geo");
    const d = rig({ spring: false });
    expect(studyMode(d, undefined)).toMatchObject({ mode: "kinematic", auto: true });
    expect(studyMode(d, { mode: "quasistatic" })).toEqual({ mode: "quasistatic", auto: false });
    // fáze s vlastním režimem přebije studii (etapa M3)
    expect(studyMode(d, { mode: "quasistatic" }, { mode: "dynamic" }).mode).toBe("dynamic");
    setLang("en");
    expect(levelLine({ level: "quasistatic" })).toMatch(/^Simulation level: quasi-statics – /);
  });
});
