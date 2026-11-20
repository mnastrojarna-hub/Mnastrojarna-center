/**
 * Vlna 22, bod 15 (pohybová část) a bod 10: tuhé skupiny pohybové studie s tolerancí (cad/motion-groups.ts) místo zaokrouhlení,
 * výchozí souhrn po skupinách, detail po dílech na vyžádání, strojové pole `groups=` na konci řádku, žádné falešné „natáčí se“,
 * sestava ~100 komponent (pole šroubů zamčených k desce) s limitem času a velikosti protokolu.
 */
import { afterEach, describe, expect, it } from "vitest";
import { motionKv } from "./asm-agent-kin";
import { emptyAssembly, partComponent } from "./assembly";
import { setLang } from "./i18n";
import { motionGroups, motionSummary, type MotionResult } from "./motion";
import { groupLines, groupsKv, rigidMotionGroups } from "./motion-groups";
import { boxPart, fakeEnv, runLines } from "./w22/w22-motion-fixture";
import { emptyDoc, type AsmComponent, type CadDoc, type Mate, type Placement, type Vec3 } from "./types";

afterEach(() => setLang("cs"));

const P = (position: Vec3, rotation: Vec3 = [0, 0, 0]): Placement => ({ position, rotation });
const comp = (id: string, placement: Placement): AsmComponent => ({ id, name: id, source: { kind: "part", doc: emptyDoc(id) }, placement });
const asm = (components: AsmComponent[], mates: Mate[] = []): CadDoc => ({ ...emptyDoc("Sestava"), kind: "assembly", components, mates });
const result = (comps: string[], steps: Record<string, Placement>[]): MotionResult => ({
  steps: steps.map((place, i) => ({ i, t: i, motors: [i], place, conflicts: [] })),
  comps: comps.map((id) => ({ id, name: id })),
  motors: [],
  collision: null,
  collisionsChecked: false,
  conflictSteps: 0,
});

describe("tuhé skupiny s tolerancí (bod 15)", () => {
  it("hranice ,5 po zaokrouhlení (−22,7625 × −22,762500000000003) = JEDNA skupina, ne „58 + 1“", () => {
    // dřívější motionGroups: Math.round(Δ · 1000) → −22762 × −22763 → dvě skupiny se stejným zdvihem (travel=30.35mm:1,30.35mm:1)
    const res = result(["Deska", "Šroub"], [
      { Deska: P([0, 0, 40]), Šroub: P([10, 10, 50]) },
      { Deska: P([0, 0, 40 - 22.7625]), Šroub: P([10, 10, 50 - 22.762500000000003]) },
      { Deska: P([0, 0, 40 - 30.35]), Šroub: P([10, 10, 50 - 30.35]) },
    ]);
    expect(Math.round(-22.7625 * 1000)).not.toBe(Math.round(-22.762500000000003 * 1000)); // důvod dřívějšího rozpadu
    const g = rigidMotionGroups(res);
    expect(g.moving).toHaveLength(1);
    expect(g.moving[0]).toMatchObject({ n: 2, ids: ["Deska", "Šroub"] });
    expect(motionGroups(res).moving).toEqual([{ n: 2, travel: 30.35 }]);
    expect(groupsKv(g)).toEqual(["groups=2:z-30.35"]);
  });
  it("různý pohyb = různé skupiny; stojící díly zvlášť; skutečné natočení celé skupiny = jedna skupina", () => {
    const res = result(["A", "B", "C", "R1", "R2"], [
      { A: P([0, 0, 0]), B: P([5, 0, 0]), C: P([0, 0, 0]), R1: P([10, 0, 0]), R2: P([20, 0, 0]) },
      { A: P([0, 0, -10]), B: P([5, 0, -5]), C: P([0, 0, 0]), R1: P([0, 10, 0], [0, 0, 90]), R2: P([0, 20, 0], [0, 0, 90]) },
    ]);
    const g = rigidMotionGroups(res);
    expect(g.still).toEqual(["C"]);
    expect(g.moving.map((x) => [x.ids.join("+"), x.turn > 0])).toEqual([["R1+R2", true], ["A", false], ["B", false]]);
    // natáčející se skupina nejde do travel= / groups= (jako dřív rot=)
    expect(motionGroups(res)).toEqual({ moving: [{ n: 1, travel: 10 }, { n: 1, travel: 5 }], still: 1, rotating: 2 });
  });
  it("KEEP B11: díl otočený o 180° (Euler 180 ↔ −180), který se jen posouvá, nikdy „natáčí se“ – ani ve skupině, ani v detailu", () => {
    const doc = asm([comp("S", P([0, 0, 10], [180, 0, 0])), comp("D", P([0, 0, 0], [0, 180, 180]))]);
    const res = result(["S", "D"], [
      { S: P([0, 0, 10], [180, 0, 0]), D: P([0, 0, 0], [0, 180, 180]) },
      { S: P([0, 0, 5], [-180, 0, 0]), D: P([0, 0, -5], [180, 0, 0]) },
      { S: P([0, 0, 0], [180, 1e-12, 0]), D: P([0, 0, -10], [0, 180, 180]) },
    ]);
    const g = rigidMotionGroups(res, doc);
    expect(g.moving).toHaveLength(1);
    expect(g.moving[0].turn).toBeLessThan(1e-6);
    const lines = groupLines(g, (id) => id);
    expect(lines.join("\n")).not.toContain("natáčí se");
    expect(lines[0]).toBe(" „S“ + 1 díl (tuhá skupina – stejný pohyb): ΔZ −10 mm");
    const detail = motionSummary(res, doc, { detail: true }).join("\n");
    expect(detail).toContain("S: rozsah pohybu X 0 · Y 0 · Z 10 mm");
    expect(detail).not.toContain("natáčí se");
  });
  it("souhrn: výchozí = tuhé skupiny (název kořene zámků, „zámek“), detail = po dílech; 1 / 2–4 / 5+ dílů", () => {
    const comps = ["Deska", "Š1", "Š2", "Š3", "Š4", "Š5", "Rám"].map((id) => comp(id, P([0, 0, 0])));
    const mates: Mate[] = ["Š1", "Š2", "Š3", "Š4", "Š5"].map((id, i) => ({ id: `l${i}`, type: "lock", a: { compId: id, face: -1 }, b: { compId: "Deska", face: -1 }, rel: P([0, 0, 0]) }));
    const doc = asm(comps, mates);
    const steps = [0, -15, -30].map((dz) => Object.fromEntries(comps.map((c) => [c.id, P(c.id === "Rám" ? [0, 0, 0] : [0, 0, dz])])));
    const res = { ...result(comps.map((c) => c.id), steps), mates };
    const sum = motionSummary(res, doc);
    expect(sum).toContain(" „Deska“ + 5 dílů (tuhá skupina – zámek / pevné vazby): ΔZ −30 mm");
    expect(sum).toContain(" stojí: 1 („Rám“)");
    expect(sum.join("\n")).not.toContain("rozsah pohybu");
    expect(motionSummary(res, doc, { detail: true }).filter((l) => l.includes("rozsah pohybu"))).toHaveLength(6);
    setLang("en");
    expect(motionSummary(res, doc)).toContain(" „Deska“ + 5 parts (rigid group – lock / rigid mates): ΔZ −30 mm");
    setLang("de");
    expect(motionSummary(res, doc)).toContain(" „Deska“ + 5 Teile (starre Gruppe – Sperre / starre Verknüpfungen): ΔZ −30 mm");
  });
});

describe("sestava ~100 komponent (pole šroubů zamčených k desce) – čas a velikost protokolu", () => {
  it("98 šroubů + deska = jedna tuhá skupina 99 dílů; výpočet < 15 s, souhrn < 1 500 B, groups=99:z-30", async () => {
    const mk = (n: string, size: Vec3, pos: Vec3, fixed = false) => ({ ...partComponent(boxPart(n, size), { position: pos }, fixed ? { fixed: true } : {}), id: n });
    const screws = Array.from({ length: 98 }, (_, i) => mk(`Šroub ${i + 1}`, [6, 6, 20], [5 + (i % 14) * 7, 5 + Math.floor(i / 14) * 12, 60]));
    const doc: CadDoc = {
      ...emptyAssembly("Pole"),
      components: [mk("Rám", [100, 100, 10], [0, 0, 0], true), mk("Horní deska", [100, 100, 10], [0, 0, 50]), ...screws],
      mates: screws.map((s, i) => ({ id: `lk${i}`, type: "lock" as const, a: { compId: s.id, face: -1 }, b: { compId: "Horní deska", face: -1 } })),
    };
    const env = fakeEnv();
    const t0 = Date.now();
    const r = await runLines(doc, env, 'sestava vazba vzdálenost "Horní deska" F1 "Rám" F2 hodnota 40 název "ZDVIH"', 'sestava vazba souosost "Horní deska" F3 "Rám" F3', 'pohyb motor lineární vazba "ZDVIH" 40..10 kroky 30');
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(15000);
    const study = r.log.slice(r.log.findIndex((l) => l.startsWith("Pohybová studie:")));
    const bytes = Buffer.byteLength(study.join("\n"), "utf8");
    expect(bytes).toBeLessThan(1500);
    expect(study).toContain(" „Horní deska“ + 98 dílů (tuhá skupina – zámek / pevné vazby): ΔZ −30 mm");
    expect(study.filter((l) => l.includes("Šroub"))).toHaveLength(0); // žádný řádek po šroubech
    expect(r.kv).toMatch(/ travel=30mm:99 static=1 /);
    expect(r.kv).toMatch(/ level=kin groups=99:z-30$/);
    // detail po dílech je jen na vyžádání
    const d = await runLines(r.doc, env, "pohyb detail");
    expect(d.log.filter((l) => l.includes("rozsah pohybu"))).toHaveLength(99);
    expect(motionKv((await import("./asm-agent-kin")).motionCached(r.doc, env)!, null, 2, r.doc)).toBe(r.kv);
  }, 60000);
});
