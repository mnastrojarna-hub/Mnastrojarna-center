/**
 * Pokročilé vazby nad skutečným jádrem (OpenCascade): geometrie koule, hran (kružnice, úsečka), vrcholů a jemná síť plochy vačky;
 * vačka s rovinným zdvihátkem textem a pohybová studie – zdvih = R + e·sin θ.
 */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { parseAgentText } from "./agent";
import type { AsmCmd } from "./agent-asm";
import { applyAsmCmd, type AsmEnv } from "./asm-agent";
import { motionRun, motionTable } from "./asm-agent-kin";
import { findCylFace, mateEdgeInfo, mateFaceInfo, mateFaceMesh, mateVertexInfo, partEntry } from "./asm-kernel";
import type { CadDoc, Feature } from "./types";
import "./ext/index";
import "./feat/index";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

const part = (name: string, features: Partial<Feature>[]) => ({ app: "mnastrojarna-cad", version: 2, name, kind: "part", material: "ocel", features }) as unknown as CadDoc;
const box = (id: string, position: number[], size: number[], mode = "new") => ({ id, name: "K" + id, type: "box", size, position, centered: false, mode }) as Partial<Feature>;
const cyl = (id: string, position: number[], radius: number, height: number, mode: string, axis = "Z") => ({ id, name: "V" + id, type: "cylinder", radius, height, position, axis, mode }) as Partial<Feature>;
const at = (position: number[]) => ({ position, rotation: [0, 0, 0] });
const env = (): AsmEnv => ({
  parts: async (list) => Promise.all(list.map(async (p) => ({ key: p.key, result: (await partEntry(p.key, p.source)).result }))),
  mateFace: async (k, i) => mateFaceInfo(k, i),
  mateEnt: async (k, i, e) => (e === "edge" ? mateEdgeInfo(k, i) : e === "vertex" ? mateVertexInfo(k, i) : mateFaceMesh(k, i)),
  cylFace: async (k, rr) => findCylFace(k, rr),
  geo: new Map(),
  faceLists: new Map(),
  stack: [],
});
const run = async (d: CadDoc, line: string, e: AsmEnv) => {
  const p = parseAgentText(line);
  expect(p.errors, line).toEqual([]);
  return applyAsmCmd(d, (p.ops[0] as { cmd: AsmCmd }).cmd, e);
};

describe("geometrie entit z jádra", () => {
  it("koule, kružnice, úsečka, vrchol, síť plochy", async () => {
    await partEntry("koule", { kind: "part", doc: part("Koule", [{ id: "s", name: "S", type: "sphere", radius: 4, position: [1, 2, 3], mode: "new" } as Partial<Feature>]) });
    expect(mateFaceInfo("koule", 0)).toMatchObject({ kind: "sphere", origin: [1, 2, 3], radius: 4 });
    await partEntry("vacka", { kind: "part", doc: part("Vačka", [cyl("c", [5, 0, 0], 20, 10, "new"), cyl("b", [0, 0, -1], 4.1, 12, "cut")]) });
    const kinds = Array.from({ length: 12 }, (_, i) => mateEdgeInfo("vacka", i)?.kind).filter(Boolean);
    expect(kinds).toContain("circle");
    expect(kinds).toContain("line");
    const circ = Array.from({ length: 12 }, (_, i) => mateEdgeInfo("vacka", i)).find((x) => x?.kind === "circle" && Math.abs((x.radius ?? 0) - 20) < 1e-9)!;
    expect(circ.origin[0]).toBeCloseTo(5, 9);
    expect(Math.abs(circ.normal[2])).toBeCloseTo(1, 9);
    const v = mateVertexInfo("vacka", 0)!;
    expect(v.kind).toBe("point");
    expect(Math.hypot(v.origin[0] - 5, v.origin[1])).toBeCloseTo(20, 9);
    const m = mateFaceMesh("vacka", 0)!;
    expect(m.kind).toBe("cylinder");
    expect(m.tris!.length / 3).toBeGreaterThan(300);
    // tětiva sítě ≤ 0,002 mm: všechny vrcholy na válci R 20, nejvyšší bod nejvýš o 0,002 mm pod vrcholem kružnice
    for (const p of m.pts!) expect(Math.hypot(p[0] - 5, p[1])).toBeCloseTo(20, 4);
    expect(20 - Math.max(...m.pts!.map((p) => p[1]))).toBeLessThan(0.002);
  });
});

describe("vačka s rovinným zdvihátkem nad jádrem", () => {
  it("vazba textem (-Y = rovinná plocha, ne otvor podél Y) a pohyb: zdvih = 20 + 5·sin θ", async () => {
    const CAM = {
      app: "mnastrojarna-cad", version: 2, name: "V", kind: "assembly", material: "ocel", features: [],
      components: [
        { id: "ram2", name: "Rám2", fixed: true, source: { kind: "part", doc: part("Rám2", [box("a", [-30, -30, -10], [60, 100, 10]), cyl("h", [0, 0, -10], 4, 20, "add"), cyl("g", [0, 30, 5], 3, 40, "add", "Y")]) }, placement: at([0, 0, 0]) },
        { id: "vacka", name: "Vačka", source: { kind: "part", doc: part("Vačka", [cyl("c", [5, 0, 0], 20, 10, "new"), cyl("b", [0, 0, -1], 4.1, 12, "cut")]) }, placement: at([0, 0, 0]) },
        { id: "zdvih", name: "Zdvihátko", source: { kind: "part", doc: part("Zdvihátko", [box("a", [-10, 0, 0], [20, 20, 10]), cyl("v", [0, -5, 5], 3.1, 40, "cut", "Y")]) }, placement: at([0, 20, 0]) },
      ],
    } as unknown as CadDoc;
    const e = env();
    let d = CAM;
    for (const line of ['sestava vazba závěs "Vačka" Ø8,2 "Rám2" Ø8', 'sestava vazba souosost "Zdvihátko" Ø6,2 "Rám2" Ø6', 'sestava vazba vačka "Zdvihátko" -Y "Vačka" válcová Ø40', 'pohyb motor rotační "Vačka" 0..360 krok 15']) {
      const res = await run(d, line, e);
      expect(res.log.join("\n"), line).not.toMatch(/⚠/);
      d = res.doc;
    }
    expect(d.mates![2]).toMatchObject({ type: "cam", a: { compId: "zdvih" }, b: { compId: "vacka" } });
    const res = await motionRun(d, e);
    const tab = motionTable(d, res);
    expect(tab.length).toBe(25);
    let worst = 0;
    for (const s of tab) worst = Math.max(worst, Math.abs(s.comps["Zdvihátko"].position[1] - (20 + 5 * Math.sin((s.motors[0] * Math.PI) / 180))));
    expect(worst).toBeLessThan(0.002);
    expect(res.conflictSteps).toBe(0);
  }, 120_000);
});
