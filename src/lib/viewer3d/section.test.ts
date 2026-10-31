import { describe, expect, it } from "vitest";
import { chainSegments, sliceMesh } from "./section";

function box(sx: number, sy: number, sz: number) {
  const c = [[0, 0, 0], [sx, 0, 0], [sx, sy, 0], [0, sy, 0], [0, 0, sz], [sx, 0, sz], [sx, sy, sz], [0, sy, sz]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return { positions: new Float32Array(c.flat()), indices: new Uint32Array(f.flat()) };
}

/** Trubka (díra Ø2r uvnitř), plášť i vnitřek, osa Z. */
function tube(rIn: number, rOut: number, h: number, n: number) {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const r of [rOut, rIn]) {
    const base = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pos.push(r * Math.cos(a), r * Math.sin(a), 0, r * Math.cos(a), r * Math.sin(a), h);
    }
    for (let i = 0; i < n; i++) {
      const a = base + i * 2;
      const b = base + ((i + 1) % n) * 2;
      idx.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

describe("řez sítě rovinou", () => {
  it("kvádr řezem v polovině výšky → obdélník (4 hrany, 4 rohy)", () => {
    const b = box(10, 20, 30);
    const segs = sliceMesh(b.positions, b.indices, { normal: [0, 0, 1], constant: -15 });
    const t = chainSegments(segs, 1e-5);
    expect(t.curves.filter((c) => c.kind === "line")).toHaveLength(4);
    expect(t.corners.length / 3).toBe(4);
    const lengths = t.curves.map((c) => Math.round(c.length)).sort((a, b) => a - b);
    expect(lengths).toEqual([10, 10, 20, 20]);
    for (let i = 2; i < t.corners.length; i += 3) expect(t.corners[i]).toBeCloseTo(15);
  });

  it("trubka kolmo na osu → dvě kružnice se středem v ose (díra v řezu)", () => {
    const tb = tube(4, 9, 20, 48);
    const segs = sliceMesh(tb.positions, tb.indices, { normal: [0, 0, 1], constant: -7 });
    const t = chainSegments(segs, 1e-5);
    const circles = t.curves.filter((c) => c.kind === "circle").sort((a, b) => a.radius! - b.radius!);
    expect(circles).toHaveLength(2);
    expect(circles[0].radius).toBeCloseTo(4, 3);
    expect(circles[1].radius).toBeCloseTo(9, 3);
    expect(Math.hypot(circles[0].center![0], circles[0].center![1])).toBeLessThan(1e-3);
    expect(circles[0].center![2]).toBeCloseTo(7, 4);
  });

  it("rovina mimo síť → nic", () => {
    const b = box(1, 1, 1);
    expect(sliceMesh(b.positions, b.indices, { normal: [0, 0, 1], constant: -5 }).length).toBe(0);
    expect(chainSegments(new Float32Array(0), 1e-5).curves).toHaveLength(0);
  });
});
