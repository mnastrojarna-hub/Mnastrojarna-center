import { describe, expect, it } from "vitest";
import {
  angleBetween, fmtMm, lineLineDistance, measureAngle, measureDiameter, measureDistance, meshVolumeArea, pointPlaneDistance, steelMassKg,
  type SnapPoint,
} from "./measure";

const pt = (point: [number, number, number], extra: Partial<SnapPoint> = {}): SnapPoint => ({ kind: "vertex", point, part: 0, ...extra });

describe("formát", () => {
  it("mm s desetinnou čárkou a mezerou v tisících", () => {
    expect(fmtMm(12.5)).toBe("12,500 mm");
    expect(fmtMm(1234.5)).toBe("1 234,50 mm");
  });
});

describe("geometrie měření", () => {
  it("úhly, rovina, přímky", () => {
    expect(angleBetween([1, 0, 0], [0, 1, 0])).toBeCloseTo(90);
    expect(angleBetween([1, 0, 0], [-1, 0, 0])).toBeCloseTo(0);
    expect(angleBetween([1, 0, 0], [-1, 0, 0], false)).toBeCloseTo(180);
    expect(pointPlaneDistance([3, 4, 10], { normal: [0, 0, 2], point: [0, 0, 1] })).toBeCloseTo(9);
    expect(lineLineDistance({ point: [0, 0, 0], dir: [1, 0, 0] }, { point: [0, 5, 0], dir: [1, 0, 0] })).toBeCloseTo(5);
    expect(lineLineDistance({ point: [0, 0, 0], dir: [1, 0, 0] }, { point: [0, 0, 7], dir: [0, 1, 0] })).toBeCloseTo(7);
  });

  it("vzdálenost bodů s ΔX ΔY ΔZ", () => {
    const m = measureDistance(pt([0, 0, 0]), pt([3, 4, 12]));
    expect(m.lines[0]).toMatchObject({ label: "Vzdálenost", primary: true });
    expect(m.short).toBe(fmtMm(13));
    expect(m.lines.find((l) => l.label === "ΔZ")?.value).toBe(fmtMm(12));
  });

  it("dvě rovnoběžné plochy → kolmá vzdálenost rovin", () => {
    const a = pt([1, 1, 0], { kind: "face", geometry: { plane: { normal: [0, 0, 1], point: [0, 0, 0] } } });
    const b = pt([5, 9, 25], { kind: "face", geometry: { plane: { normal: [0, 0, -1], point: [0, 0, 25] } } });
    const m = measureDistance(a, b);
    expect(m.lines[0]).toMatchObject({ label: "Vzdálenost rovin", value: fmtMm(25) });
    expect(m.points[0]).toEqual([5, 9, 0]);
  });

  it("dvě rovnoběžné díry → rozteč os", () => {
    const a = pt([5, 0, 3], { kind: "face", geometry: { cylinder: { axis: [0, 0, 1], point: [0, 0, 0], radius: 5 } } });
    const b = pt([45, 0, 8], { kind: "face", geometry: { cylinder: { axis: [0, 0, 1], point: [40, 0, 0], radius: 3 } } });
    const m = measureDistance(a, b);
    expect(m.lines[0]).toMatchObject({ label: "Rozteč os", value: fmtMm(40) });
  });

  it("průměr kružnice i válce", () => {
    const c = measureDiameter(pt([10, 0, 0], { kind: "edge", geometry: { circle: { center: [0, 0, 0], normal: [0, 0, 1], radius: 10, full: true } } }));
    expect(c?.short).toBe(`Ø ${fmtMm(20)}`);
    const arc = measureDiameter(pt([0, 4, 0], { kind: "edge", geometry: { circle: { center: [0, 0, 0], normal: [0, 0, 1], radius: 4, full: false } } }));
    expect(arc?.short).toBe(`R ${fmtMm(4)}`);
    const cyl = measureDiameter(pt([6, 0, 30], { kind: "face", geometry: { cylinder: { axis: [0, 0, 1], point: [0, 0, 0], radius: 6 } } }));
    expect(cyl?.short).toBe(`Ø ${fmtMm(12)}`);
    expect(cyl?.points[0]).toEqual([0, 0, 30]);
    expect(measureDiameter(pt([0, 0, 0]))).toBeNull();
  });

  it("úhel hran a ploch", () => {
    const e1 = pt([0, 0, 0], { kind: "edge", geometry: { line: { point: [0, 0, 0], dir: [1, 0, 0], length: 10 } } });
    const e2 = pt([0, 0, 0], { kind: "edge", geometry: { line: { point: [0, 0, 0], dir: [1, 1, 0], length: 10 } } });
    expect(measureAngle(e1, e2)?.short).toBe("45,00°");
    const f1 = pt([0, 0, 0], { kind: "face", geometry: { plane: { normal: [0, 0, 1], point: [0, 0, 0] } } });
    const f2 = pt([0, 0, 0], { kind: "face", geometry: { plane: { normal: [0, 1, 0], point: [0, 0, 0] } } });
    expect(measureAngle(f1, f2)?.short).toBe("90,00°");
    // hrana ležící v rovině → 0°
    expect(measureAngle(e1, f1)?.short).toBe("0,00°");
    expect(measureAngle(pt([0, 0, 0]), f1)).toBeNull();
  });

  it("objem a povrch krychle 10 mm, hmotnost oceli", () => {
    // krychle z 12 trojúhelníků
    const v = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], [0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10]];
    const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
    const r = meshVolumeArea(new Float32Array(v.flat()), new Uint32Array(f.flat()));
    expect(r.volume).toBeCloseTo(1000, 6);
    expect(r.area).toBeCloseTo(600, 6);
    expect(steelMassKg(1000)).toBeCloseTo(0.00785, 8);
  });
});
