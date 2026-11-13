import { describe, expect, it } from "vitest";
import {
  FINE, LaneTuner, SPLIT_MIN_BYTES, TOPOLOGY_MAX_MESH_TRIANGLES, TOPOLOGY_MAX_TRIANGLES, absoluteDeflection, estimateFacesFromBytes, fmtMb,
  isOutOfMemory, meshLevelNote, partWorkerCount, tessellationFor,
} from "./tessellation";

describe("přizpůsobivá jemnost sítě", () => {
  it("malé modely beze změny (0,1 % rozměru, 0,35 rad)", () => {
    for (const faces of [0, 1, 500, 40_000]) expect(tessellationFor(faces)).toEqual(FINE);
    expect(FINE).toEqual({ level: "fine", linearRatio: 0.001, angular: 0.35 });
    expect(meshLevelNote("fine")).toBeNull();
  });

  it("s počtem ploch se síť zhrubuje — monotónně", () => {
    const steps = [40_001, 150_000, 150_001, 400_000, 400_001, 5_000_000].map(tessellationFor);
    expect(steps.map((t) => t.level)).toEqual(["normal", "normal", "coarse", "coarse", "draft", "draft"]);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].linearRatio).toBeGreaterThanOrEqual(steps[i - 1].linearRatio);
      expect(steps[i].angular).toBeGreaterThanOrEqual(steps[i - 1].angular);
    }
    // ani u obrovské sestavy ne hrubší než 0,8 rad (kružnice aspoň z ~8 úseček)
    expect(tessellationFor(1e9).angular).toBeLessThanOrEqual(0.8);
    expect(meshLevelNote("coarse")).toMatch(/orientační/);
  });

  it("nesmyslný vstup → výchozí jemnost", () => {
    expect(tessellationFor(NaN)).toEqual(FINE);
    expect(tessellationFor(-5)).toEqual(FINE);
  });

  it("absolutní průhyb = podíl průměrného rozměru (jako OpenCascade), bez rozměru 1 mm", () => {
    expect(absoluteDeflection(FINE, 2000)).toBeCloseTo(2);
    expect(absoluteDeflection(tessellationFor(300_000), 10_000)).toBeCloseTo(25);
    expect(absoluteDeflection(FINE, 0)).toBe(1);
    expect(absoluteDeflection(FINE, NaN)).toBe(1);
  });

  it("odhad ploch z velikosti souboru a prahy", () => {
    expect(estimateFacesFromBytes(150 * 1024 * 1024)).toBeGreaterThan(300_000);
    expect(estimateFacesFromBytes(-1)).toBe(0);
    expect(SPLIT_MIN_BYTES).toBe(6 * 1024 * 1024);
    expect(TOPOLOGY_MAX_MESH_TRIANGLES).toBeLessThan(TOPOLOGY_MAX_TRIANGLES);
  });

  it("počet workerů: jedno jádro nechá stránce, nejvýš 4, málo paměti → 2", () => {
    expect(partWorkerCount(undefined)).toBe(1);
    expect(partWorkerCount(1)).toBe(1);
    expect(partWorkerCount(2)).toBe(1);
    expect(partWorkerCount(4)).toBe(3);
    expect(partWorkerCount(16)).toBe(4);
    expect(partWorkerCount(16, 2)).toBe(2);
  });

  it("ladění workerů: přidává, dokud propustnost roste o 15 %, pak se vrátí na nejlepší", () => {
    const t = new LaneTuner(4);
    expect(t.target).toBe(1);
    expect(t.next(100)).toBe(2); // první měření
    expect(t.next(180)).toBe(3); // 2 workery +80 %
    expect(t.next(190)).toBe(2); // 3 workery jen +5 % → zpět na 2
    expect(t.settled).toBe(true);
    expect(t.next(1000)).toBe(2);
  });

  it("ladění workerů: když druhý worker zpomalí, zůstane jeden; max 1 → hned hotovo", () => {
    const t = new LaneTuner(3);
    t.next(100);
    expect(t.next(70)).toBe(1);
    expect(t.settled).toBe(true);
    const single = new LaneTuner(1);
    expect(single.settled).toBe(true);
    expect(single.next(5)).toBe(1);
    const all = new LaneTuner(2);
    all.next(10);
    expect(all.next(30)).toBe(2);
    expect(all.settled).toBe(true);
  });

  it("chyby nedostatku paměti se poznají", () => {
    for (const m of ["Aborted(OOM)", "RangeError: Array buffer allocation failed", "RuntimeError: memory access out of bounds", "Cannot enlarge memory arrays"]) {
      expect(isOutOfMemory(m)).toBe(true);
    }
    expect(isOutOfMemory("STEP se nepodařilo načíst")).toBe(false);
  });

  it("velikost v MB česky", () => {
    expect(fmtMb(150 * 1024 * 1024)).toBe("150 MB");
    expect(fmtMb(59.8 * 1024 * 1024)).toBe("59,8 MB");
  });
});
