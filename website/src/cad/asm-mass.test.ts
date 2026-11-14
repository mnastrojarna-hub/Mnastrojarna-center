import { describe, expect, it } from "vitest";
import { placementMatrix } from "./assembly";
import { applyMatrix, asmMassProps, massOf, type MassLeaf, type PartMass } from "./asm-mass";

const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
// kvádr 100 × 50 × 10 s rohem v počátku (těžiště ve středu) a válec Ø20 × 40 (osa Z, těžiště v polovině výšky)
const BOX: PartMass = { volume: 100 * 50 * 10, area: 2 * (100 * 50 + 100 * 10 + 50 * 10), com: [50, 25, 5], bbox: [[0, 0, 0], [100, 50, 10]] };
const PIN: PartMass = { volume: Math.PI * 100 * 40, area: 2 * Math.PI * 100 + 2 * Math.PI * 10 * 40, com: [0, 0, 20], bbox: [[-10, -10, 0], [10, 10, 40]] };

describe("hmotnostní vlastnosti sestavy (Nástroje › Hmotnost v sestavě)", () => {
  it("součet hmotností a objemů podle materiálů, těžiště vážené hmotností ve světových souřadnicích", () => {
    const leaves: MassLeaf[] = [
      { id: "a", name: "Deska", key: "box", matrix: IDENT, density: 7.85, material: "Ocel" },
      { id: "b", name: "Čep", key: "pin", matrix: placementMatrix({ position: [50, 25, 10], rotation: [0, 0, 0] }), density: 2.7, material: "Hliník" },
    ];
    const r = asmMassProps(leaves, new Map([["box", BOX], ["pin", PIN]]));
    const mBox = massOf(BOX.volume, 7.85);
    const mPin = massOf(PIN.volume, 2.7);
    expect(mBox).toBeCloseTo(0.3925, 6); // 50 cm³ × 7,85 g/cm³
    expect(r.massKg).toBeCloseTo(mBox + mPin, 9);
    expect(r.volume).toBeCloseTo(BOX.volume + PIN.volume, 6);
    expect(r.area).toBeCloseTo(BOX.area + PIN.area, 6);
    // čep stojí na desce ve středu (x 50, y 25) – těžiště leží na svislé ose středem desky, výš než střed desky
    const z = (mBox * 5 + mPin * (10 + 20)) / (mBox + mPin);
    expect(r.cog![0]).toBeCloseTo(50, 9);
    expect(r.cog![1]).toBeCloseTo(25, 9);
    expect(r.cog![2]).toBeCloseTo(z, 9);
    expect(r.bbox).toEqual([[0, 0, 0], [100, 50, 50]]);
    expect(r.rows.map((x) => x.name)).toEqual(["Deska", "Čep"]); // od nejtěžšího
    expect(r.missing).toEqual([]);
  });
  it("stejný díl vložený dvakrát s otočením: těžiště i obálka podle umístění, díl bez změření v chybějících", () => {
    const rot = placementMatrix({ position: [0, 0, 0], rotation: [90, 0, 0] }); // osa Z čepu → −Y
    expect(applyMatrix(rot, [0, 0, 20]).map((v) => Math.round(v * 1e9) / 1e9)).toEqual([0, -20, 0]);
    const leaves: MassLeaf[] = [
      { id: "1", name: "Čep", key: "pin", matrix: IDENT, density: 7.85, material: "Ocel" },
      { id: "2", name: "Čep", key: "pin", matrix: rot, density: 7.85, material: "Ocel" },
      { id: "3", name: "STEP bez tělesa", key: "x", matrix: IDENT, density: 7.85, material: "Ocel" },
    ];
    const r = asmMassProps(leaves, new Map([["pin", PIN], ["x", null]]));
    expect(r.rows).toHaveLength(2);
    expect(r.cog![0]).toBeCloseTo(0, 9);
    expect(r.cog![1]).toBeCloseTo(-10, 9);
    expect(r.cog![2]).toBeCloseTo(10, 9);
    expect(r.bbox![0].map((v) => Math.round(v))).toEqual([-10, -40, -10]);
    expect(r.bbox![1].map((v) => Math.round(v))).toEqual([10, 10, 40]);
    expect(r.missing).toEqual(["STEP bez tělesa"]);
  });
  it("prázdná sestava: nula, bez těžiště a obálky", () => {
    const r = asmMassProps([], new Map());
    expect(r).toMatchObject({ massKg: 0, volume: 0, cog: null, bbox: null, rows: [] });
  });
});
