import { describe, expect, it } from "vitest";
import { parseAgentText } from "./agent";
import { opKind, opTimer, slowestOf, slowField } from "./op-timing";

describe("časy operací pro protokol (Σ slow=, JSON timing)", () => {
  it("záznam, měření i při výjimce, 5 nejpomalejších, součet", async () => {
    let t = 0;
    const timer = opTimer(() => t);
    timer.add(3, "feature", 120);
    await timer.time(7, "clash", async () => {
      t += 4100;
    });
    await expect(
      timer.time(9, "motion", async () => {
        t += 12_149;
        throw new Error("x");
      }),
    ).rejects.toThrow("x");
    for (let i = 0; i < 6; i++) timer.add(20 + i, "mate", 10 * i);
    expect(timer.all().length).toBe(9);
    expect(timer.slowest().map((x) => [x.line, x.op, x.ms])).toEqual([
      [9, "motion", 12_149],
      [7, "clash", 4100],
      [3, "feature", 120],
      [25, "mate", 50],
      [24, "mate", 40],
    ]);
    expect(timer.total()).toBe(120 + 4100 + 12_149 + 150);
    expect(slowField(timer.all())).toBe("L9:motion:12.1");
  });
  it("formát slow= odpovídá gramatice (tečka, bez seskupení, L- bez řádku)", () => {
    expect(slowField([])).toBeNull();
    expect(slowField([{ line: 395, op: "motion", ms: 12_100 }])).toBe("L395:motion:12.1");
    expect(slowField([{ line: 0, op: "build", ms: 1_234_567 }])).toBe("L-:build:1234.6");
    expect(slowField([{ line: 4, op: "x", ms: 20 }])).toBe("L4:x:0.0");
    expect(slowestOf([{ line: 2, op: "a", ms: 5 }, { line: 1, op: "b", ms: 5 }], 1)[0].line).toBe(1);
  });
  it("druh operace z textového příkazu: ASCII, stejný ve všech jazycích", () => {
    const kind = (line: string) => {
      const p = parseAgentText(line);
      expect(p.errors, line).toEqual([]);
      return opKind(p.ops[0] as { k: string; cmd?: unknown });
    };
    expect(kind("pohyb motor lineární vazba 2 0..10 kroky 5")).toBe("motion");
    expect(kind("motion motor linear mate 2 0..10 steps 5")).toBe("motion");
    expect(kind('sestava vazba zámek "A" "B"')).toBe("mate");
    expect(kind("kolize")).toBe("clash");
    expect(kind("kvádr 10 20 30")).toBe("feature");
    for (const k of ["drawingCmd", "asm", "new"]) expect(opKind({ k })).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(opKind({ k: "drawingCmd" })).toBe("drawing-cmd");
    expect(opKind({ k: "asm", cmd: { k: "bom" } })).toBe("asm-bom");
  });
});
