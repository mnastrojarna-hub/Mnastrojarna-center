/**
 * Vlna 15 – balík asm nad skutečným jádrem (OpenCascade):
 * - B10: obálka v řádku „Sestava: …“ = přesná obálka těles listových dílů v umístění. Dřív rohy lokální obálky dílu přenesené
 *   umístěním: díl natočený o 20° kolem Z (stopka 959) zvětšil obálku sestavy 308 mm v Y na 311,3 mm.
 * - pružina mezi dvěma deskami textem (`sestava pružina … mezi …`): dosedací plochy vybrané automaticky, délka 38 mm, přesný díl
 *   v aktuální délce pro export (stoupání se změní), pohybová studie s kontrolou kolizí po krocích.
 */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { parseAgentText } from "./agent";
import type { AsmCmd } from "./agent-asm";
import { applyAsmCmd, type AsmEnv } from "./asm-agent";
import { motionRun } from "./asm-agent-kin";
import { flattenAssembly, transformPoint } from "./assembly";
import { asmEnvelope, assemblyShape, findCylFace, interference, mateEdgeInfo, mateFaceInfo, mateFaceMesh, mateVertexInfo, partEntry } from "./asm-kernel";
import { springGeom } from "./asm-spring-geom";
import { compressionSpring } from "./library/pins";
import { motionSummary } from "./motion";
import type { CadDoc, Feature, Vec3 } from "./types";
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
const env = (): AsmEnv => ({
  parts: async (list) => Promise.all(list.map(async (p) => ({ key: p.key, result: (await partEntry(p.key, p.source)).result }))),
  mateFace: async (k, i) => mateFaceInfo(k, i),
  mateEnt: async (k, i, e) => (e === "edge" ? mateEdgeInfo(k, i) : e === "vertex" ? mateVertexInfo(k, i) : mateFaceMesh(k, i)),
  cylFace: async (k, rr) => findCylFace(k, rr),
  interference: (d) => interference(d),
  geo: new Map(),
  faceLists: new Map(),
  stack: [],
});
const run = async (d: CadDoc, line: string, e: AsmEnv) => {
  const p = parseAgentText(line);
  expect(p.errors, line).toEqual([]);
  return applyAsmCmd(d, (p.ops[0] as { cmd: AsmCmd }).cmd, e);
};
const size = (b: [Vec3, Vec3]) => [0, 1, 2].map((k) => b[1][k] - b[0][k]);

describe("B10 – přesná obálka sestavy", () => {
  it("sestava 308 mm v Y: díl natočený o 20° kolem Z obálku nezvětší (dřív 311,3 mm)", async () => {
    const doc = {
      app: "mnastrojarna-cad", version: 2, name: "959", kind: "assembly", material: "ocel", features: [],
      components: [
        { id: "z", name: "Základová deska", fixed: true, source: { kind: "part", doc: part("Základová deska", [box("a", [-2.4, -308, 0], [189.8, 308, 40])]) }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } },
        // stopka: válec Ø80 s plochou (není rotačně souměrná) natočená o 20° kolem Z – přesně y ≤ −2, rohy lokální obálky dají y až +5,85
        { id: "s", name: "Stopka", source: { kind: "part", doc: part("Stopka", [cyl("c", [0, 0, 0], 40, 60, "new"), box("f", [30, -50, -1], [20, 100, 62], "cut")]) }, placement: { position: [92.5, -42, 40], rotation: [0, 0, 20] } },
        // šroub 180 0 0 (násobek 90° – rohy jsou přesné) a skrytá pomocná komponenta mimo
        { id: "b", name: "Šroub M6x20", source: { kind: "part", doc: part("Šroub M6x20", [cyl("c", [0, 0, 0], 3, 20, "new")]) }, placement: { position: [10.7189, -131.0895, 165.2], rotation: [180, 0, 0] } },
        { id: "h", name: "Pomocná", hidden: true, source: { kind: "part", doc: part("Pomocná", [box("a", [0, 0, 0], [10, 10, 10])]) }, placement: { position: [0, 500, 0], rotation: [0, 0, 0] } },
      ],
    } as unknown as CadDoc;
    // repro: dřívější výpočet stavu (cad-app asmStatusRef) – 8 rohů lokální obálky dílu přes umístění
    let old: [Vec3, Vec3] | null = null;
    for (const l of flattenAssembly(doc).filter((x) => !x.hidden)) {
      const m = (await partEntry(l.key, l.comp.source)).result.metrics!.bbox;
      for (const x of [m[0][0], m[1][0]]) for (const y of [m[0][1], m[1][1]]) for (const z of [m[0][2], m[1][2]]) {
        const w = transformPoint(l.placement, [x, y, z]);
        if (!old) old = [[...w] as Vec3, [...w] as Vec3];
        else for (let k = 0; k < 3; k++) [old[0][k], old[1][k]] = [Math.min(old[0][k], w[k]), Math.max(old[1][k], w[k])];
      }
    }
    expect(size(old!)[1]).toBeGreaterThan(311);
    const env1 = await asmEnvelope(doc);
    expect(env1).toMatchObject({ leaves: 3, turned: 1 });
    expect(size(env1.bbox!)[0]).toBeCloseTo(189.8, 6);
    expect(size(env1.bbox!)[1]).toBeCloseTo(308, 6);
    expect(env1.bbox![1][1]).toBeCloseTo(0, 6);
    expect(env1.bbox![1][2]).toBeCloseTo(165.2, 6);
    // = přesná obálka celého tělesa sestavy (compound pro STEP)
    const sh = (await assemblyShape(doc))!;
    const bb = sh.boundingBox.bounds as [Vec3, Vec3];
    sh.delete();
    for (let k = 0; k < 3; k++) {
      expect(env1.bbox![0][k]).toBeCloseTo(bb[0][k], 6);
      expect(env1.bbox![1][k]).toBeCloseTo(bb[1][k], 6);
    }
  }, 120_000);
});

describe("pružina mezi deskami nad jádrem", () => {
  it("sestava pružina … mezi … (dosedací plochy automaticky) → 38 mm, F 150 N; přesný díl v délce; pohyb s kolizemi", async () => {
    const spring = compressionSpring.make({ d: 2, D: 20, L: 44, n: 8 }) as CadDoc;
    let d = {
      app: "mnastrojarna-cad", version: 2, name: "Nástroj", kind: "assembly", material: "ocel", features: [],
      components: [
        { id: "A", name: "Vodicí deska", fixed: true, source: { kind: "part", doc: part("Vodicí deska", [box("a", [0, 0, 0], [100, 100, 20]), cyl("h", [50, 50, 10], 6, 11, "cut")]) }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } },
        { id: "B", name: "Kotevní deska", source: { kind: "part", doc: part("Kotevní deska", [box("a", [0, 0, 0], [100, 100, 20])]) }, placement: { position: [0, 0, 58], rotation: [0, 0, 0] } },
        { id: "P", name: "Pružina R20", source: { kind: "part", doc: spring }, placement: { position: [20, 20, 21], rotation: [0, 0, 0] } },
      ],
      mates: [],
    } as unknown as CadDoc;
    const e = env();
    for (const line of ['sestava vazba zámek "Pružina R20" "Vodicí deska"', 'sestava vazba vzdálenost "Kotevní deska" spodní "Vodicí deska" horní hodnota 38 název "ZDVIH"']) {
      const res = await run(d, line, e);
      expect(res.log.join("\n"), line).not.toMatch(/✗/);
      d = res.doc;
    }
    const res = await run(d, 'sestava pružina "Pružina R20" mezi "Vodicí deska" "Kotevní deska" tuhost 25', e);
    const log = res.log.join("\n");
    expect(log).toMatch(/dosedací plochy pružiny „Pružina R20“: „Vodicí deska“ F\d+ rovinná \+Z → „Kotevní deska“ F\d+ rovinná −Z/);
    expect(log).toContain("✓ pružina „Pružina R20“: délka 38 mm · L0 44 · Ln 18 · stlačení 6 mm · síla 150 N (c 25 N/mm)");
    d = res.doc;
    expect(d.components![2].spring).toMatchObject({ free: 44, rate: 25, length: 38, offset: 0 });
    // přesný díl v délce 38 (stoupání 4,5): osa Z 20 … 58 (konce drátu skloněné o úhel stoupání – do 0,01 mm)
    const leaf = flattenAssembly(d).find((l) => l.comp.id === "P")!;
    const g = springGeom((leaf.comp.source as { doc: CadDoc }).doc)!;
    expect(g.length).toBeCloseTo(38, 9);
    const sh = (await assemblyShape(d))!;
    const bb = sh.boundingBox.bounds as [Vec3, Vec3];
    sh.delete();
    expect(bb[1][2]).toBeCloseTo(78, 6); // deska B nahoře
    const pb = (await partEntry(leaf.key, leaf.comp.source)).result.metrics!.bbox;
    expect(pb[1][2] - pb[0][2]).toBeGreaterThan(37.98);
    expect(pb[1][2] - pb[0][2]).toBeLessThan(38.001);
    // stav sestavy
    const st = await run(d, "sestava pružiny", e);
    expect(st.log.join("\n")).toContain("✓ pružina „Pružina R20“: délka 38 mm");
    // přepočet vazeb po změně vzdálenosti → délka pružiny sleduje desku B
    const moved = await run(d, 'sestava vazba "ZDVIH" hodnota=30', e);
    expect(moved.doc.components![2].spring).toMatchObject({ length: 30 });
    // pohybová studie: ZDVIH 38 → 16 (pod doraz 18) s kolizemi; pružina se zkracuje, pod dorazem ✗
    d = { ...d, motion: { motors: [{ id: "m", kind: "linear", mate: d.mates!.find((m) => m.name === "ZDVIH")!.id, from: 38, to: 16 }], duration: 1, steps: 11, collisions: true } };
    const mr = await motionRun(d, e, { force: true });
    expect(mr.steps.map((s) => s.springs!.P.length)).toEqual([38, 36, 34, 32, 30, 28, 26, 24, 22, 20, 18, 16]);
    const sum = motionSummary(mr, d).join("\n");
    expect(sum).toContain("✗ pružina „Pružina R20“: délka 38 → 16 mm (min 16 · L0 44 · Ln 18) · síla 150 → 700 N (max 700 N) – pod délkou na doraz v krocích 11");
    // dosednutí bez průniku do desek nad dorazem (kroky 0–9); ve 11. kroku (pod dorazem) tvar zůstane na dorazu a desku B protne
    for (const s of mr.steps.slice(0, 10)) expect(s.clashes, `krok ${s.i}`).toEqual([]);
    expect(mr.steps[11].clashes!.some((c) => [c.a, c.b].includes("P"))).toBe(true);
  }, 300_000);
});
