/**
 * Vlna 15 – balík asm, opravy po revizi (bez jádra; nálezy s geometrií ploch v asm-w15-review-kernel.test.ts):
 * - kusovník: pružiny v různé délce = jedna položka (dřív řádek podle délky v panelu, na čipu i v tabulce výkresu) a hmotnost
 *   pružiny i v textovém kusovníku (dřív se hledala podle zdroje v délce modelu, postavené bylo těleso v aktuální délce);
 * - přezdívka: kopie (duplikovat, pole, zrcadlit, Duplikovat v panelu) ji nepřebírají, `přezdívka ""` ji zruší, název nesmí být
 *   přezdívkou jiné komponenty, přezdívka ve vazbách a v seznamu komponent v chybě;
 * - pružiny se stejným názvem: řádky protokolu (6×) / #k, window.mncad.motion() a CSV podle instance;
 * - odebraná dosedací komponenta definici pružiny zruší; DE „normteil feder …“.
 */
import { afterEach, describe, expect, it } from "vitest";
import { parseAgentText } from "./agent";
import { findComp, mateLines, mateText, renameProblem, type AsmCmd } from "./agent-asm";
import { applyAsmCmd, bomData, type AsmEnv } from "./asm-agent";
import { motionTable } from "./asm-agent-kin";
import { computeBom, instanceKey, mirrorComponent, patternComponent, removeComponents, sourceKey } from "./assembly";
import { springEffective } from "./asm-spring-geom";
import { instanceLines, springComps, springLines, springMotionLines, springStatusLine, type SpringState } from "./asm-spring";
import { setLang } from "./i18n";
import { makeFromText } from "./library";
import { compressionSpring } from "./library/pins";
import { motionCsv, type MotionResult } from "./motion";
import { emptyDoc, type AsmComponent, type BuildResult, type CadDoc, type Feature, type Mate, type Placement, type SpringDef, type Vec3 } from "./types";
import { bomOf } from "@/components/cad/asm-flatten";

afterEach(() => setLang("cs"));

const P = (position: Vec3 = [0, 0, 0], rotation: Vec3 = [0, 0, 0]): Placement => ({ position, rotation });
const box = (name: string, size: Vec3): CadDoc => ({ ...emptyDoc(name), features: [{ id: "b", name: "K", type: "box", size, position: [0, 0, 0], centered: false, mode: "new" } as unknown as Feature] });
const comp = (id: string, name: string, doc: CadDoc, placement: Placement, extra: Partial<AsmComponent> = {}): AsmComponent => ({ id, name, source: { kind: "part", doc: JSON.parse(JSON.stringify(doc)) as CadDoc }, placement, ...extra });
const asm = (components: AsmComponent[], mates: Mate[] = []): CadDoc => ({ ...emptyDoc("T2"), kind: "assembly", components, mates });
const asmOp = (line: string) => {
  const p = parseAgentText(line);
  expect(p.errors, line).toEqual([]);
  return (p.ops[0] as { cmd: AsmCmd }).cmd;
};
/** prostředí bez jádra: „stavba“ vrátí objem 1000 mm³ pro každý klíč, který se opravdu staví */
const fakeEnv = (built: string[] = []): AsmEnv => ({
  parts: async (list) =>
    list.map((p) => {
      built.push(p.key);
      return { key: p.key, result: { status: [], mesh: null, metrics: { volume: 1000, area: 0, bbox: [[0, 0, 0], [1, 1, 1]], faces: 0 } } as unknown as BuildResult };
    }),
  mateFace: async () => null,
  cylFace: async () => -1,
  geo: new Map(),
  faceLists: new Map(),
  stack: [],
});

const SPRING = compressionSpring.make({ d: 2, D: 20, L: 44, n: 8 }) as CadDoc;
const sdef = (a: string, b: string, length: number, extra: Partial<SpringDef> = {}): SpringDef => ({ a: { compId: a, face: 1 }, b: { compId: b, face: 0 }, free: 44, solid: 20, rate: 25, length, offset: 0, seat: length, ...extra });
/** T2 z revize: základ, dvě desky B (58 a 50), dvě pružiny 2×20×44 v délce 38 a 30 mm */
const T2 = () =>
  asm([
    comp("Z", "ZAKLAD", box("ZAKLAD", [300, 100, 20]), P(), { fixed: true }),
    comp("B1", "B", box("B", [100, 100, 20]), P([0, 0, 58])),
    comp("B2", "B", box("B", [100, 100, 20]), P([200, 0, 50])),
    comp("S1", SPRING.name, SPRING, P([30, 30, 20]), { spring: sdef("Z", "B1", 38) }),
    comp("S2", SPRING.name, SPRING, P([230, 30, 20]), { spring: sdef("Z", "B2", 30) }),
  ]);

describe("revize – kusovník s pružinami v různé délce", () => {
  it("repro: panel / čip / tabulka výkresu (bomOf) měly 4 řádky – pružina 38 a 30 mm zvlášť; nyní 3 řádky, pružina 2 ks", () => {
    const d = T2();
    // dřívější bomOf(flat): komponenty z flattenLeaves → zdroj pružiny nahrazen dílem v aktuální délce → jiný sourceKey
    const old = computeBom({ ...d, components: d.components!.map((c) => springEffective(c)) }, () => ({ massKg: 1 }));
    expect(old.length).toBe(4);
    // mezipaměť aplikace zná jen tělesa v sestavě (pružina v aktuální délce)
    const cache = new Map(d.components!.map((c) => [sourceKey(springEffective(c).source), 0.011]));
    const info = (c: AsmComponent) => ({ material: "Ocel", massKg: cache.get(sourceKey(c.source)) });
    for (const flat of [true, false]) {
      const rows = bomOf(d, flat, info);
      expect(rows.map((r) => [r.name, r.qty]), `flat ${flat}`).toEqual([
        ["ZAKLAD", 1],
        ["B", 2],
        [SPRING.name, 2],
      ]);
      expect(rows[2].massKg, `flat ${flat}`).toBe(0.011);
      expect(rows[2].ids).toEqual(["S1", "S2"]);
    }
  });
  it("repro: textový kusovník ztratil hmotnost pružiny („bez dílů, které se nepostavily“) – nyní z tělesa v aktuální délce", async () => {
    const d = T2();
    const built: string[] = [];
    const b = await bomData(d, fakeEnv(built), false);
    expect(b.rows.map((r) => r.qty)).toEqual([1, 2, 2]);
    expect(b.rows.every((r) => r.massKg != null)).toBe(true);
    expect(b.text).not.toMatch(/nepostavily/);
    // hmotnost pružiny = těleso v aktuální délce (jako stav), žádná zvláštní stavba volné pružiny
    expect(built).toContain(sourceKey(springEffective(d.components![3]).source));
    expect(built).not.toContain(sourceKey(d.components![3].source));
  });
});

describe("revize – přezdívka instance", () => {
  const S = box("S", [6, 6, 20]);
  const base = () => asm([comp("A", "A", box("A", [100, 100, 20]), P(), { fixed: true }), comp("K", "S", S, P([10, 10, 70]), { alias: "K48" }), comp("L", "S", S, P([30, 10, 70]), { alias: "K51" })]);

  it("repro: duplikovat / pole / zrcadlit přebíraly přezdívku → „K48“ pak nešla najít; nyní kopie bez přezdívky", async () => {
    const r = await applyAsmCmd(base(), asmOp('sestava duplikovat "K48" posun 20 0 0'), fakeEnv());
    expect(r.doc.components!.map((c) => c.alias ?? null)).toEqual([null, "K48", "K51", null]);
    expect(findComp(r.doc, "K48").id).toBe("K");
    const pat = patternComponent(base(), "K", { kind: "linear", count: 3, spacing: 15, direction: [1, 0, 0] });
    expect(pat.components!.filter((c) => c.alias === "K48").length).toBe(1);
    const mir = mirrorComponent(base(), "L", "YZ", 150);
    expect(mir.components!.filter((c) => c.alias === "K51").length).toBe(1);
    expect(findComp(mir, "K51").id).toBe("L");
    // chyba vyjmenuje komponenty i s přezdívkami
    expect(() => findComp(base(), "K99")).toThrow(/#2 S \[K48\], #3 S \[K51\]/);
  });
  it("repro: `přezdívka \"\"` hlásilo „chybí hodnota“ – nyní přezdívku zruší (jako holé `přezdívka`)", async () => {
    expect(asmOp('sestava komponenta #2 přezdívka ""')).toMatchObject({ k: "comp", patch: { alias: "" } });
    expect(asmOp('assembly component #2 alias ""')).toMatchObject({ patch: { alias: "" } });
    expect(asmOp("sestava komponenta #2 přezdívka")).toMatchObject({ patch: { alias: "" } });
    const r = await applyAsmCmd(base(), asmOp('sestava komponenta #2 přezdívka ""'), fakeEnv());
    expect(r.doc.components![1].alias).toBeUndefined();
    expect(r.log.join("\n")).toContain("bez přezdívky");
  });
  it("repro: přejmenování na přezdívku jiné komponenty prošlo a název pak vedl na ni; nyní ✗", async () => {
    const d = base();
    await expect(applyAsmCmd(d, asmOp('sestava komponenta #1 název "K48"'), fakeEnv())).rejects.toThrow(/je přezdívka komponenty #2 S/);
    expect(renameProblem(d, "k48", "A")).toMatch(/přezdívka/);
    expect(renameProblem(d, "K48", "K")).toBeNull(); // vlastní přezdívka nevadí
    // přezdívka i název jiné komponenty (vložený díl se jmenuje jako přezdívka) – nevybere se potichu
    const e = { ...d, components: [...d.components!, comp("X", "K48", S, P())] };
    expect(() => findComp(e, "K48")).toThrow(/přezdívka #2 i název #4/);
  });
  it("repro: vazby a jejich výpis ukazovaly „S“ → „S“ – nyní s přezdívkou", () => {
    const d = base();
    const m = { id: "m", type: "lock", a: { compId: "K", face: 0 }, b: { compId: "L", face: 0 } } as Mate;
    expect(mateText(d, m)).toBe("Zámek „S“ [K48] F1 → „S“ [K51] F1");
    expect(mateLines({ ...d, mates: [m] })[1]).toContain("Zámek „S“ [K48] F1 → „S“ [K51] F1");
    const sym = { id: "y", type: "symmetric", a: { compId: "K", face: 0 }, b: { compId: "L", face: 0 }, c: { compId: "A", face: 2 } } as Mate;
    expect(mateText(d, sym)).toContain("rovina „A“ F3");
  });
});

describe("revize – pružiny se stejným názvem (protokol, motion API, CSV)", () => {
  const st = (id: string, length: number, level: SpringState["level"] = "ok"): SpringState => ({ id, name: SPRING.name, seat: length, length, offset: 0, free: 44, solid: 20, rate: 25, force: 25 * (44 - length), level });

  it("stejný stav = jeden řádek (n×) bez #k; různý stav = řádek pro každý s #k / [přezdívka]", () => {
    const d = T2();
    expect(springLines(d, [st("S1", 38), st("S2", 38)])).toEqual(["✓ pružina „Pružina 2×20×44“: délka 38 mm · L0 44 · Ln 20 · stlačení 6 mm · síla 150 N (c 25 N/mm) (2×)"]);
    const two = springLines(d, [st("S1", 38), st("S2", 30)]);
    expect(two).toEqual(["✓ pružina „Pružina 2×20×44“ #4: délka 38 mm · L0 44 · Ln 20 · stlačení 6 mm · síla 150 N (c 25 N/mm)", "✓ pružina „Pružina 2×20×44“ #5: délka 30 mm · L0 44 · Ln 20 · stlačení 14 mm · síla 350 N (c 25 N/mm)"]);
    const al = { ...d, components: d.components!.map((c) => (c.id === "S2" ? { ...c, alias: "P2" } : c)) };
    expect(springLines(al, [st("S1", 38), st("S2", 30)])[1]).toMatch(/^✓ pružina „Pružina 2×20×44“ \[P2\]: délka 30 mm/);
    // stav dokumentu: různé délky s #k, stejné jednou s počtem
    expect(springStatusLine(d)).toBe("Pružiny: „Pružina 2×20×44“ #4 38 mm (L0 44 · Ln 20) · F 150 N ✓ · „Pružina 2×20×44“ #5 30 mm (L0 44 · Ln 20) · F 350 N ✓");
    // 6 shodných instancí jedním řádkem (revize: 2·N řádků protokolu)
    const items = [1, 2, 3, 4, 5, 6].map((i) => ({ c: { ...d.components![3], id: `x${i}` }, text: (ref: string) => `✓ P${ref}` }));
    const six = { ...d, components: items.map((x) => x.c) };
    expect(instanceLines(six, items)).toEqual(["✓ P (6×)"]);
  });
  it("repro: motion().steps[i].springs a comps podle NÁZVU slily stejně pojmenované pružiny; nyní podle instance", () => {
    const d = { ...T2(), components: T2().components!.map((c) => (c.id === "S2" ? { ...c, alias: "PZ3" } : c)) };
    const step = (i: number, a: number, b: number) => ({ i, t: i, motors: [i], place: { S1: P([30, 30, 20]), S2: P([230, 30, 20]), B1: P([0, 0, 58 - i]), B2: P([200, 0, 50]) }, conflicts: [], springs: { S1: { length: a, offset: 0, seat: a, force: 25 * (44 - a), level: "ok" as const }, S2: { length: b, offset: 0, seat: b, level: "warn" as const } } });
    const res = { steps: [step(0, 40, 42), step(1, 30, 42)], comps: ["S1", "S2", "B1", "B2"].map((id) => ({ id, name: d.components!.find((c) => c.id === id)!.name })), motors: [], collision: null, collisionsChecked: false, conflictSteps: 0 } as unknown as MotionResult;
    const t = motionTable(d, res);
    expect(Object.keys(t[0].springs!)).toEqual(["Pružina 2×20×44 #4", "Pružina 2×20×44 [PZ3]"]);
    expect(t[1].springs!["Pružina 2×20×44 #4"]).toMatchObject({ length: 30, force: 350, level: "ok" });
    expect(Object.keys(t[0].comps)).toEqual(["Pružina 2×20×44 #4", "Pružina 2×20×44 [PZ3]", "B #2", "B #3"]);
    expect(instanceKey(d, "Z")).toBe("ZAKLAD");
    const lines = springMotionLines(d, res.steps);
    expect(lines[0]).toMatch(/^✓ pružina „Pružina 2×20×44“ #4: délka 40 → 30 mm/);
    expect(lines[1]).toMatch(/^⚠ pružina „Pružina 2×20×44“ \[PZ3\]: délka 42 mm/);
    const head = motionCsv(res, d).split("\r\n")[0];
    expect(head).toContain("Pružina 2×20×44 #4 L [mm]");
    expect(head).toContain("Pružina 2×20×44 [PZ3] F [N]");
    expect(head).toContain("B #2 X");
  });
});

describe("revize – odebraná dosedací komponenta", () => {
  it("repro: definice pružiny zůstala (stav ✓ 38 mm, STEP v délce 38); nyní se odebere s hláškou, tvar ve volné délce", async () => {
    const d = T2();
    const r = await applyAsmCmd(d, asmOp("sestava odebrat #2"), fakeEnv());
    expect(r.log.join("\n")).toContain("pružiny bez dosedací komponenty (definice odebrána, tvar ve volné délce): „Pružina 2×20×44“");
    expect(r.doc.components!.find((c) => c.id === "S1")!.spring).toBeUndefined();
    expect(r.doc.components!.find((c) => c.id === "S2")!.spring).toBeDefined();
    expect(springStatusLine(r.doc)).not.toContain("38 mm");
    // panel aplikace (Odebrat, Del) – stejný pomocník; visící definice (ruční JSON) se nepočítá
    expect(removeComponents(d, ["B2"]).springs).toEqual([SPRING.name]);
    const dangling = { ...d, components: d.components!.filter((c) => c.id !== "B1") };
    expect(springComps(dangling).map((c) => c.id)).toEqual(["S2"]);
  });
});

describe("revize – DE normálie pružiny", () => {
  it("repro: „normteil feder d2 D20 L44 n8“ knihovna neznala; nyní DIN 2095 i „druckfeder“, Passfeder zůstává perem", () => {
    for (const q of ["feder d2 D20 L44 n8", "druckfeder d2 D20 L44 n8", "Feder d2 D20 L44 n8"]) {
      const hit = makeFromText(q);
      expect(hit?.result.family.id, q).toBe("spring");
      expect(hit?.result.values).toMatchObject({ d: 2, D: 20, L: 44, n: 8 });
    }
    expect(makeFromText("passfeder 8x7x40")?.result.family.id).not.toBe("spring");
    expect(makeFromText("tellerfeder 20")?.result.family.id).not.toBe("spring");
    setLang("de");
    expect(makeFromText("feder d2 D20 L44 n8")!.result.designation).toBe("Feder 2×20×44 – n=8");
    setLang("cs");
    expect(makeFromText("pružina d2 D20 L44 n8")!.result.designation).toBe("Pružina 2×20×44 – n=8");
  });
});
