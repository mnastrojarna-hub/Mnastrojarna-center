import { describe, expect, it } from "vitest";
import { massKg, meshMetrics } from "./mesh-metrics";

// jednotková krychle 10 mm: 8 vrcholů, 12 trojúhelníků
const P = [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 0, 0, 10, 10, 0, 10, 10, 10, 10, 0, 10, 10];
const I = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];

describe("meshMetrics", () => {
  it("spočítá objem, plochu a gabarit krychle", () => {
    const m = meshMetrics([{ position: new Float32Array(P), index: new Uint32Array(I) }]);
    expect(m.size).toEqual([10, 10, 10]);
    expect(m.volume).toBeCloseTo(1000, 6);
    expect(m.area).toBeCloseTo(600, 6);
    expect(m.triangles).toBe(12);
  });

  it("je nezávislý na orientaci trojúhelníků", () => {
    const flipped = I.slice();
    for (let i = 0; i < flipped.length; i += 3) [flipped[i + 1], flipped[i + 2]] = [flipped[i + 2], flipped[i + 1]];
    expect(meshMetrics([{ position: P, index: flipped }]).volume).toBeCloseTo(1000, 6);
  });

  it("prázdná síť → nuly", () => {
    expect(meshMetrics([]).volume).toBe(0);
  });

  it("hmotnost oceli 1000 cm³ = 7,85 kg", () => {
    expect(massKg(1_000_000, 7.85)).toBeCloseTo(7.85, 6);
  });
});
