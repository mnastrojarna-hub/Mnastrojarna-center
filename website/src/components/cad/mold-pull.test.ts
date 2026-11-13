/**
 * Směr vyhození zadaný čísly (nález kontroly po nasazení): složky se potvrzují po jedné, pole musí ukazovat zadání a jednotkový
 * směr se počítá až z celého vektoru.
 */
import { describe, expect, it } from "vitest";
import { pullChange, pullShown, type DraftSetup } from "./mold-pull";
import type { Vec3 } from "@/cad/types";

/** jako pole Vektor (`Vec` v props.tsx): změní jednu složku zobrazené hodnoty a ohlásí celý vektor */
const typeComponent = (d: DraftSetup, k: number, x: number): DraftSetup => {
  const v = [...pullShown(d)] as Vec3;
  v[k] = x;
  return pullChange(d, v, undefined, false, true);
};

describe("směr vyhození zadaný po složkách", () => {
  it("2; 1; 0 zadané postupně od Z dá směr (0,894; 0,447; 0), pole ukazuje 2; 1; 0", () => {
    let d: DraftSetup = { on: false, pull: [0, 0, 1], minDeg: 1 };
    for (const [k, x] of [[0, 2], [1, 1], [2, 0]] as const) d = typeComponent(d, k, x);
    expect(pullShown(d)).toEqual([2, 1, 0]);
    expect(d.pull[0]).toBeCloseTo(2 / Math.sqrt(5), 8);
    expect(d.pull[1]).toBeCloseTo(1 / Math.sqrt(5), 8);
    expect(d.pull[2]).toBe(0);
    expect(d.on).toBe(true);
  });

  it("rozpracovaný nulový vektor nechá poslední platný směr, zadání zůstane", () => {
    let d: DraftSetup = { on: true, pull: [0, 0, 1], minDeg: 1 };
    d = typeComponent(d, 2, 0);
    expect(pullShown(d)).toEqual([0, 0, 0]);
    expect(d.pull).toEqual([0, 0, 1]);
    d = typeComponent(d, 1, -3);
    expect(d.pull).toEqual([0, -1, 0]);
  });

  it("odkaz: vyřešený směr se uloží jako zadání i jednotkový směr; karta Vyhazovače mapu nezapíná", () => {
    const def = { kind: "faceNormal", ref: { kind: "face", index: 2 } } as const;
    const d = pullChange({ on: false, pull: [0, 0, 1], minDeg: 1 }, [1, 0, 0], def, true, false);
    expect(d).toEqual({ on: false, pull: [1, 0, 0], pullRaw: [1, 0, 0], minDeg: 1, pullDef: def, pullFlip: true });
  });
});
