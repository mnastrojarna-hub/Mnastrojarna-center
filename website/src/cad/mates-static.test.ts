/**
 * Vlna 22, bod 8 – statický přepočet s konfliktem (repro bodu 8, `sestava vazba "ZDVIH" hodnota=37.15`): dřív řešič zapsal do
 * dokumentu kompromis (Deska A ujetá na [42,83; 42,83; 47,28] a natočená, Přidržovač pod pevnou vzdáleností) a protokol začínal ✓.
 * Nyní: polohy beze změny, stav vazeb pro dokument, jak je, konfliktní vazby s odchylkami a nejbližší dosažitelná hodnota 37,5 mm.
 */
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import type { FaceGeo, GeoProvider } from "./mates";
import { conflictText, solveStatic } from "./mates-static";
import { emptyDoc, type AsmComponent, type CadDoc, type Mate, type MateRef, type Placement, type Vec3 } from "./types";

afterEach(() => setLang("cs"));

const P = (position: Vec3 = [0, 0, 0]): Placement => ({ position, rotation: [0, 0, 0] });
const f = (compId: string, face: number): MateRef => ({ compId, face });
const comp = (id: string, placement: Placement, fixed = false): AsmComponent => ({ id, name: id, source: { kind: "part", doc: emptyDoc(id) }, placement, ...(fixed ? { fixed: true } : {}) });
const G: Record<string, Record<string, FaceGeo>> = {
  R: { f0: { kind: "plane", origin: [50, 50, 10], normal: [0, 0, 1] } },
  A: { f0: { kind: "plane", origin: [50, 50, 0], normal: [0, 0, -1] } },
  H: { f0: { kind: "plane", origin: [30, 30, 8], normal: [0, 0, 1] }, f1: { kind: "plane", origin: [30, 30, 0], normal: [0, 0, -1] } },
};
const geo: GeoProvider = (r) => G[r.compId]?.[`f${r.face}`] ?? null;
const doc8 = (zdvih: number): CadDoc => ({
  ...emptyDoc("Mechanika"),
  kind: "assembly",
  components: [comp("R", P(), true), comp("A", P([0, 0, 67.5])), comp("H", P([0, 0, 34.5]))],
  mates: [
    { id: "zdvih", name: "ZDVIH", type: "distance", a: f("A", 0), b: f("R", 0), value: zdvih },
    { id: "pevna", name: "PEVNÁ", type: "distance", a: f("H", 1), b: f("R", 0), value: 24.5 },
    { id: "mez", name: "Mez", type: "limitDistance", a: f("H", 0), b: f("A", 0), min: 5, max: 25 },
  ] as Mate[],
});

describe("bod 8 – statický přepočet: konflikt nezapíše kompromis", () => {
  it("ZDVIH 37,15 (za mezí): polohy beze změny, ZDVIH konflikt, nejbližší dosažitelná hodnota 37,5 mm, brání Mez a PEVNÁ", () => {
    const d = doc8(37.15);
    const r = solveStatic(d, geo, null, { equilibrium: true, focus: "zdvih" });
    expect(r.moved).toEqual([]);
    expect(r.components.map((c) => c.placement)).toEqual(d.components!.map((c) => c.placement));
    expect(r.status).toEqual({ zdvih: "conflict", pevna: "ok", mez: "ok" });
    expect(r.conflict!.cause).toBe("motor");
    expect(r.conflict!.focus!.reach).toBeCloseTo(37.5, 4);
    expect(r.conflict!.focus!.want).toBe(37.15);
    expect([...r.conflict!.ids].sort()).toEqual(["mez", "pevna", "zdvih"]);
    const t = conflictText(r.conflict!);
    expect(t).toMatch(/^nejbližší dosažitelná hodnota 37,5 mm \(zadáno 37,15 mm\) – brání: /);
    expect(t).toContain("„Mez H → A“ 5 mm – na mezi min 5 mm (doraz)");
    expect(t).toContain("„PEVNÁ H → R“ 24,5 mm (splněno)");
  });

  it("splnitelná hodnota (ZDVIH 47,5): přepočet se zapíše jako dřív, bez konfliktu", () => {
    const r = solveStatic(doc8(47.5), geo, null, { equilibrium: true, focus: "zdvih" });
    expect(r.conflict).toBeUndefined();
    expect(r.moved).toEqual(["A"]);
    expect(r.components.find((c) => c.id === "A")!.placement.position).toEqual([0, 0, 57.5]);
  });

  it("vazby si odporují samy (dvě pevné vzdálenosti): bez upravené vazby – vypsané porušené vazby s odchylkami, polohy beze změny", () => {
    const d = { ...doc8(57.5), mates: [...doc8(57.5).mates!, { id: "pevna2", name: "PEVNÁ 2", type: "distance", a: f("H", 1), b: f("R", 0), value: 30 } as Mate] };
    const r = solveStatic(d, geo, null, { equilibrium: true });
    expect(r.moved).toEqual([]);
    expect(r.conflict!.cause).toBe("mates");
    expect(r.conflict!.ids).toEqual(expect.arrayContaining(["pevna", "pevna2"]));
    expect(conflictText(r.conflict!)).toMatch(/^vazby si odporují: /);
    setLang("en");
    expect(conflictText(r.conflict!)).toMatch(/^mates contradict each other: /);
  });
});
