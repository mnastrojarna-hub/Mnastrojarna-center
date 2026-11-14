/**
 * Vlna 15 – balík asm, opravy po revizi nad skutečným jádrem (OpenCascade):
 * - automatická dosedací plocha nesmí být plocha, kterou pružina prochází otvorem (959: pružiny procházejí otvory Ø20 kotevní
 *   desky a opírají se o opěrnou desku – dřív ✗ „stlačena pod délku na doraz“ 13 mm, 775 N a ✗ v každém kroku studie);
 * - příklad z návodu pro AI (sekce „Pružina v sestavě“) běží a dá zdokumentované řádky;
 * - přesun dosedací komponenty v sestavě BEZ vazeb přepočítá délku pružiny (dřív stav dál 38 mm / 150 N ✓);
 * - obrácené dosedací plochy = ✗ bez uložení definice (dřív uložená pružina 0,001 mm / 1112,5 N);
 * - `blok 0` / `tuhost 0` zruší dřív zadanou hodnotu (pole panelu „0 = z modelu / neuvádět“ ji dřív nezrušila).
 */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { parseAgentText } from "./agent";
import type { AsmCmd } from "./agent-asm";
import { AGENT_GUIDE } from "./agent-guide";
import { applyAsmCmd, type AsmEnv } from "./asm-agent";
import { findCylFace, interference, mateEdgeInfo, mateFaceInfo, mateFaceMesh, mateVertexInfo, partEntry } from "./asm-kernel";
import { springStatusLine } from "./asm-spring";
import { compressionSpring } from "./library/pins";
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
const cyl = (id: string, position: number[], radius: number, height: number, mode: string) => ({ id, name: "V" + id, type: "cylinder", radius, height, position, axis: "Z", mode }) as Partial<Feature>;
const tube = (id: string, position: number[], outer: number, inner: number, height: number) => ({ id, name: "T" + id, type: "tube", outer, inner, height, position, axis: "Z", mode: "new" }) as Partial<Feature>;
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

/**
 * Sestava z příkladu v návodu: vodicí deska dole, kotevní deska s otvory Ø20 (pružiny jimi procházejí), opěrná deska nahoře
 * (vazba Vzdálenost „ZDVIH“ 38 k vodicí desce), 2× „Pružina R20“ = trubka Ø20/Ø10 × 38 stojící na vodicí desce.
 */
async function tool(e: AsmEnv): Promise<CadDoc> {
  const spring = part("Pružina R20", [tube("t", [0, 0, 0], 20, 10, 38)]);
  let d = {
    app: "mnastrojarna-cad", version: 2, name: "Nástroj", kind: "assembly", material: "ocel", features: [],
    components: [
      { id: "A", name: "Vodicí deska", fixed: true, source: { kind: "part", doc: part("Vodicí deska", [box("a", [0, 0, 0], [200, 100, 20])]) }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } },
      { id: "K", name: "Kotevní deska", fixed: true, source: { kind: "part", doc: part("Kotevní deska", [box("a", [0, 0, 0], [200, 100, 10]), cyl("h1", [50, 50, -1], 10, 12, "cut"), cyl("h2", [150, 50, -1], 10, 12, "cut")]) }, placement: { position: [0, 0, 30], rotation: [0, 0, 0] } },
      { id: "C", name: "Opěrná deska", source: { kind: "part", doc: part("Opěrná deska", [box("a", [0, 0, 0], [200, 100, 20])]) }, placement: { position: [0, 0, 58], rotation: [0, 0, 0] } },
      { id: "P1", name: "Pružina R20", source: { kind: "part", doc: spring }, placement: { position: [50, 50, 20], rotation: [0, 0, 0] } },
      { id: "P2", name: "Pružina R20", source: { kind: "part", doc: JSON.parse(JSON.stringify(spring)) }, placement: { position: [150, 50, 20], rotation: [0, 0, 0] } },
    ],
    mates: [],
  } as unknown as CadDoc;
  const res = await run(d, 'sestava vazba vzdálenost "Opěrná deska" spodní "Vodicí deska" horní hodnota 38 název "ZDVIH"', e);
  expect(res.log.join("\n")).not.toMatch(/✗/);
  d = res.doc;
  return d;
}

describe("revize – dosedací plocha s otvorem, příklad z návodu", () => {
  it("repro: B = kotevní deska (pružiny procházejí otvory Ø20) dřív ✗ 10 mm pod dorazem; nyní ✗ s radou, s opěrnou deskou ✓ 38 mm", async () => {
    const e = env();
    const d = await tool(e);
    await expect(run(d, 'sestava pružina "Pružina R20" mezi "Vodicí deska" "Kotevní deska" volná 44 blok 20 tuhost 25', e)).rejects.toThrow(/osa pružiny prochází komponentou „Kotevní deska“ otvorem – plocha F\d+ rovinná −Z nemá pod pružinou materiál/);
    // příklad z návodu (blok kódu za „Příklad (sestava: …“) – řádek po řádku jako konzole
    const guide = AGENT_GUIDE.slice(AGENT_GUIDE.indexOf("Příklad (sestava: „Vodicí deska“ dole"));
    const block = guide.slice(guide.indexOf("```") + 3, guide.indexOf("```", guide.indexOf("```") + 3)).trim().split("\n");
    expect(block).toEqual(['sestava pružina "Pružina R20" mezi "Vodicí deska" "Opěrná deska" volná 44 blok 20 tuhost 25', 'pohyb motor lineární vazba "ZDVIH" 38..32 kroky 6', "pohyb"]);
    let doc = d;
    const logs: string[] = [];
    for (const line of block) {
      const res = await run(doc, line, e);
      doc = res.doc;
      logs.push(...res.log);
    }
    const log = logs.join("\n");
    const one = "✓ pružina „Pružina R20“: délka 38 mm · L0 44 · Ln 20 · stlačení 6 mm · síla 150 N (c 25 N/mm) (2×)";
    const motion = " ✓ pružina „Pružina R20“: délka 38 → 32 mm (min 32 · L0 44 · Ln 20) · síla 150 → 300 N (max 300 N) (2×)";
    expect(log).toContain(one);
    expect(log).toContain(motion);
    // zdokumentované řádky v návodu = skutečný výstup; dosedací plochy jednou pro obě pružiny
    expect(AGENT_GUIDE).toContain(one);
    expect(AGENT_GUIDE).toContain(motion.trim());
    expect(logs.filter((l) => l.includes("dosedací plochy pružiny")).length).toBe(1);
    expect(logs.filter((l) => l.startsWith("✓ pružina „Pružina R20“: délka 38 mm")).length).toBe(1);
    expect(log).not.toMatch(/^✗/m);
  }, 300_000);
});

describe("revize – pružina v sestavě bez vazeb, obrácené plochy, zrušení hodnot", () => {
  const spring = compressionSpring.make({ d: 2, D: 20, L: 44, n: 8 }) as CadDoc;
  const T1 = () =>
    ({
      app: "mnastrojarna-cad", version: 2, name: "T1", kind: "assembly", material: "ocel", features: [],
      components: [
        { id: "A", name: "A", fixed: true, source: { kind: "part", doc: part("A", [box("a", [0, 0, 0], [100, 100, 20])]) }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } },
        { id: "B", name: "B", source: { kind: "part", doc: part("B", [box("a", [0, 0, 0], [100, 100, 20])]) }, placement: { position: [0, 0, 58], rotation: [0, 0, 0] } },
        { id: "P1", name: spring.name, alias: "P1", source: { kind: "part", doc: spring }, placement: { position: [30, 30, 20], rotation: [0, 0, 0] } },
        { id: "P2", name: spring.name, alias: "P2", source: { kind: "part", doc: JSON.parse(JSON.stringify(spring)) }, placement: { position: [70, 70, 20], rotation: [0, 0, 0] } },
      ],
    }) as unknown as CadDoc;

  it("repro: přesun dosedací komponenty bez vazeb nechal 38 mm / 150 N ✓; nyní 30 mm / 350 N", async () => {
    const e = env();
    let d = (await run(T1(), `sestava pružina "${spring.name}" mezi "A" "B" tuhost 25`, e)).doc;
    expect(springStatusLine(d)).toBe(`Pružiny: „${spring.name}“ 38 mm (L0 44 · Ln 18) · F 150 N ✓ (2×)`);
    const res = await run(d, 'sestava komponenta "B" v 0 0 50', e);
    d = res.doc;
    expect(d.components!.find((c) => c.id === "P1")!.spring).toMatchObject({ length: 30, seat: 30 });
    expect(springStatusLine(d)).toBe(`Pružiny: „${spring.name}“ 30 mm (L0 44 · Ln 18) · F 350 N ✓ (2×)`);
    // posun i pootočení komponenty, která není dosedací, délku nemění
    const same = await run(d, 'sestava komponenta "P2" posun 0 0 0', e);
    expect(springStatusLine(same.doc)).toBe(springStatusLine(d));
  }, 300_000);

  it("repro: obrácené dosedací plochy se uložily (0,001 mm, 1112,5 N); nyní ✗ a definice se neuloží", async () => {
    const e = env();
    const d = T1();
    await expect(run(d, 'sestava pružina "P1" mezi "B" "A" tuhost 25', e)).rejects.toThrow(/obráceném pořadí.*prohoďte A a B – definice se neuložila/);
    // správné pořadí projde
    const ok = await run(d, 'sestava pružina "P1" mezi "A" "B" tuhost 25', e);
    // jen jedna ze dvou stejně pojmenovaných pružin → řádek s přezdívkou
    expect(ok.log.join("\n")).toContain(`✓ pružina „${spring.name}“ [P1]: délka 38 mm`);
  }, 300_000);

  it("repro: panel (0 = neuvádět / z modelu) ani text nezrušil dřív zadanou tuhost a délku na doraz; nyní blok 0 / tuhost 0", async () => {
    const e = env();
    let d = (await run(T1(), 'sestava pružina "P1" mezi "A" "B" blok 20 tuhost 25', e)).doc;
    expect(d.components![2].spring).toMatchObject({ solid: 20, rate: 25 });
    // příkaz, který pošle panel po vynulování obou polí
    const res = await run(d, "sestava pružina #3 mezi #1 #2 volná 44 blok 0 tuhost 0", e);
    d = res.doc;
    expect(d.components![2].spring!.solid).toBeUndefined();
    expect(d.components![2].spring!.rate).toBeUndefined();
    const line = res.log.find((l) => l.startsWith("✓ pružina"))!;
    expect(line).toContain("délka 38 mm · L0 44 · Ln 18"); // doraz z modelu (n + 1)·d
    expect(line).not.toContain("síla");
    // bez nulování hodnoty zůstávají (příkaz bez blok / tuhost)
    const keep = await run((await run(T1(), 'sestava pružina "P1" mezi "A" "B" blok 20 tuhost 25', e)).doc, 'sestava pružina "P1" volná 44', e);
    expect(keep.doc.components![2].spring).toMatchObject({ solid: 20, rate: 25 });
  }, 300_000);
});
