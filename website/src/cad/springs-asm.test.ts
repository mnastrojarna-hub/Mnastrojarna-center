/**
 * Tlačná pružina z tabulky v sestavě (nález 4 recenze balíku part): `sestava pružina "Stírací pružina" mezi "Deska" "Stírač"`
 * převezme volnou délku L0, délku na doraz Ln a tuhost R z tabulky prvku `spring.compression` (návod pro AI, příklad stíracích
 * pružin) – bez zadání `volná / blok / tuhost`. Tažná pružina z tabulky dostane srozumitelnou hlášku místo „není pružina“.
 */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { parseAgentText, type AgentOp } from "./agent";
import type { AsmCmd } from "./agent-asm";
import { applyAsmCmd, type AsmEnv } from "./asm-agent";
import { findCylFace, interference, mateEdgeInfo, mateFaceInfo, mateFaceMesh, mateVertexInfo, partEntry } from "./asm-kernel";
import { springDocAt, springGeom } from "./asm-spring-geom";
import { calcCompression } from "./springs";
import type { CadDoc, Feature } from "./types";
import "./ext/index";
import "./feat/index";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({ locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"), print: () => undefined, printErr: () => undefined });
  r.setOC(oc as never);
}, 60_000);

const feats = (text: string): Feature[] => (parseAgentText(text).ops as AgentOp[]).filter((o): o is Extract<AgentOp, { k: "feature" }> => o.k === "feature").map((o) => o.feature);
const part = (name: string, text: string) => ({ app: "mnastrojarna-cad", version: 2, name, kind: "part", material: "ocel", features: feats(text) }) as unknown as CadDoc;
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
const rig = (spring: CadDoc): CadDoc =>
  ({
    app: "mnastrojarna-cad", version: 2, name: "S", kind: "assembly", material: "ocel", features: [],
    components: [
      { id: "D", name: "Deska", fixed: true, source: { kind: "part", doc: part("Deska", "kvádr 60 60 10") }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } },
      { id: "S", name: "Stírač", source: { kind: "part", doc: part("Stírač", "kvádr 60 60 10") }, placement: { position: [0, 0, 50], rotation: [0, 0, 0] } },
      { id: "P", name: "Stírací pružina", source: { kind: "part", doc: spring }, placement: { position: [0, 0, 10], rotation: [0, 0, 0] } },
    ],
    mates: [],
  }) as unknown as CadDoc;

describe("tlačná pružina z tabulky mezi deskami", () => {
  it("springGeom: osa, L0, Ln a tuhost z výpočtu; tvar v jiné délce = data.len", () => {
    const doc = part("Stírací pružina", "pružina tlačná d 2,5 De 20 L0 45 n 7 v 30 30 0");
    const c = calcCompression({ d: 2.5, De: 20, L0: 45, n: 7 });
    const g = springGeom(doc)!;
    expect(g).toMatchObject({ kind: "spring", base: [30, 30, 0], axis: [0, 0, 1], length: 45, free: 45, ring: 8.75 });
    expect(g.solid).toBeCloseTo(c.v.Ln!, 9);
    expect(g.rate).toBeCloseTo(c.v.R!, 9);
    const at40 = springDocAt(doc, 40);
    expect((at40.features[0] as Extract<Feature, { type: "ext" }>).data).toMatchObject({ len: 40, L0: 45 });
    expect(springGeom(at40)).toMatchObject({ length: 40, free: 45 });
  });
  it("sestava pružina … mezi … bez zadání: délka 40, L0 45, Ln 22,5, F = R·5 (nález 4)", async () => {
    const spring = part("Stírací pružina", "pružina tlačná d 2,5 De 20 L0 45 n 7 v 30 30 0");
    const R = calcCompression({ d: 2.5, De: 20, L0: 45, n: 7 }).v.R!;
    const res = await run(rig(spring), 'sestava pružina "Stírací pružina" mezi "Deska" "Stírač"', env());
    const log = res.log.join("\n");
    expect(log).not.toMatch(/✗/);
    expect(log).toContain("✓ pružina „Stírací pružina“: délka 40 mm · L0 45 · Ln 22,5 · stlačení 5 mm · síla 53 N (c 10,608 N/mm)");
    expect(R * 5).toBeCloseTo(53.04, 1);
    expect(res.doc.components![2].spring).toMatchObject({ free: 45, length: 40 });
    expect(res.doc.components![2].spring!.rate).toBeCloseTo(R, 9);
  }, 120_000);
  it("tažná pružina z tabulky: hláška místo „není pružina“", async () => {
    const ext = part("Tažná", "pružina tažná d 1,6 De 12 n 12 F0 5 v 30 30 0");
    await expect(run(rig(ext), 'sestava pružina "Stírací pružina" mezi "Deska" "Stírač"', env())).rejects.toThrow(/jen u tlačné pružiny/);
  }, 120_000);
});
