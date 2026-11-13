import { describe, expect, it } from "vitest";
import { AGENT_COMMANDS, docStatusText, featureSummary, parseAgentText } from "./agent";
import { parseWeldLine } from "./agent-welds";
import "./ext/index";
import { emptyDoc, type Feature } from "./types";

const named = (l: string) => `${l} 1`;
const one = (line: string) => {
  const op = parseWeldLine(line, 1, named);
  if (!op) throw new Error("null");
  return op;
};
const dataOf = (line: string) => {
  const op = one(line);
  if (op.k === "api") throw new Error("api");
  return { op, f: op.feature as Extract<Feature, { type: "ext" }>, d: (op.feature as Extract<Feature, { type: "ext" }>).data };
};

describe("příkaz svar – CS / EN / DE", () => {
  it("koutový: a / z, hrany čísly, oboustranně, kolem, přerušovaný", () => {
    const { op, f, d } = dataOf("svar koutový a5 hrany E7;E9 oboustranně přerušovaný 50/100 metoda 135");
    expect(op.k).toBe("feature");
    expect(f.ext).toBe("weld.bead");
    expect(d).toMatchObject({ a: 5, measure: "a", edges: [6, 8], both: true, intermittent: true, segLen: 50, pitch: 100, process: "135", separate: true });
    expect(dataOf("svar koutový z7 hrany E3 kolem").d).toMatchObject({ a: 7, measure: "z", edges: [2], allAround: true });
    const r = one("svar koutový a4 hrany svislé");
    expect(r.k).toBe("select");
    if (r.k === "select") {
      expect(r.rule).toEqual(["svisle"]);
      expect(r.into).toEqual({ path: "data.edges", kind: "edges" });
    }
    expect(dataOf("weld fillet a6 edges E2 E4 both sides all around field").d).toMatchObject({ a: 6, edges: [1, 3], both: true, allAround: true, field: true });
    expect(dataOf("schweißnaht kehlnaht a3 kanten E1 beidseitig unterbrochen 40/80").d).toMatchObject({ a: 3, edges: [0], both: true, intermittent: true, segLen: 40, pitch: 80 });
    expect(dataOf("naht kehl a3 kante E5 ringsum").d).toMatchObject({ allAround: true, edges: [4] });
    expect(dataOf("svar koutový a5 hrany E1 sloučit").d.separate).toBe(false);
  });
  it("tupý: úprava, úhel, otupení, mezera, hrana / plocha, podložka", () => {
    const { f, d } = dataOf("svar tupý V 60 otupení 1 mezera 2 hrana E7 podložka");
    expect(f.ext).toBe("weld.groove");
    expect(f.name).toBe("Tupý svar V 1");
    expect(d).toMatchObject({ prep: "V", angle: 60, rootFace: 1, gap: 2, edges: [6], faces: [], backing: true });
    expect(dataOf("svar X 60 mezera 2 plocha F3").d).toMatchObject({ prep: "X", angle: 60, gap: 2, faces: [2], edges: [] });
    expect(dataOf("svar U R6 úhel 10 otupení 2 plocha F4").d).toMatchObject({ prep: "U", radius: 6, angle: 10, rootFace: 2, faces: [3] });
    expect(dataOf("svar ½V 45 hrana E2 převýšení 1 kořen 1,5 obráceně").d).toMatchObject({ prep: "HV", angle: 45, cap: 1, root: 1.5, flip: true, edges: [1] });
    expect(dataOf("svar K plocha F1").d).toMatchObject({ prep: "K", faces: [0] });
    expect(dataOf("svar 2J R5 plocha F1").d).toMatchObject({ prep: "JJ", radius: 5 });
    expect(dataOf("svar I mezera 3 t 6 plocha F2").d).toMatchObject({ prep: "I", gap: 3, t: 6 });
    expect(dataOf("weld butt V 60 root face 1 gap 2 edge E7 backing cap 1.5 root 1").d).toMatchObject({ prep: "V", angle: 60, rootFace: 1, gap: 2, edges: [6], backing: true, cap: 1.5, root: 1 });
    expect(dataOf("weld HV 45 face F2").d).toMatchObject({ prep: "HV", angle: 45, faces: [1] });
    expect(dataOf("naht stumpf X 60 steg 2 spalt 2 fläche F3 badsicherung").d).toMatchObject({ prep: "X", rootFace: 2, gap: 2, faces: [2], backing: true });
    const r = one("svar tupý V plocha +X");
    expect(r.k === "select" && r.into).toEqual({ path: "data.faces", kind: "faces" });
  });
  it("děrový, žlábkový, bodový, tabulka", () => {
    expect(dataOf("svar děrový Ø12 počet 3 rozteč 50 plocha F3").d).toMatchObject({ d: 12, n: 3, pitch: 50, faces: [2] });
    expect(dataOf("svar žlábkový 30×10 plocha F3").d).toMatchObject({ slot: 30, d: 10 });
    expect(dataOf("svar bodový Ø6 rozteč 40 počet 5 plocha F2 kratší").d).toMatchObject({ d: 6, pitch: 40, n: 5, faces: [1], axis: "short" });
    expect(dataOf("weld spot Ø5 pitch 30 count 4 face F1").d).toMatchObject({ d: 5, pitch: 30, n: 4 });
    expect(dataOf("naht punkt Ø6 teilung 40 anzahl 5 fläche F1").d).toMatchObject({ d: 6, pitch: 40, n: 5 });
    expect(dataOf("weld plug Ø12 count 2 face F7").f.ext).toBe("weld.plug");
    expect(one("svar tabulka")).toEqual({ k: "api", cmd: { kind: "action", id: "weld.weldTable" }, line: 1 });
    expect(one("weld table").k).toBe("api");
    expect(one("naht tabelle").k).toBe("api");
  });
  it("chyby česky a jiný příkaz = null", () => {
    expect(parseWeldLine("kvádr 10 10 10", 1, named)).toBeNull();
    expect(() => one("svar")).toThrow(/druh/);
    expect(() => one("svar koutový a5")).toThrow(/hrany/);
    expect(() => one("svar tupý V 60")).toThrow(/plocha/);
    expect(() => one("svar žlábkový Ø10 plocha F1")).toThrow(/délku žlábku/);
    expect(() => one("svar trojúhelníkový a5")).toThrow(/neznámý druh/);
    expect(() => one("svar koutový a5 hrany E1 metoda xyz")).toThrow(/ISO 4063/);
  });
  it("zapojení do parseAgentText, obecný prvek, nápověda a stav", () => {
    const p = parseAgentText("kvádr 100 100 10\nsvar tupý V 60 plocha F2\nsvar tabulka\nprvek weld.groove prep=K faces=[3] angle=45");
    expect(p.errors).toEqual([]);
    expect(p.ops.map((o) => o.k)).toEqual(["feature", "feature", "api", "feature"]);
    const g = p.ops[3];
    expect(g.k === "feature" && g.feature.type === "ext" && g.feature.data).toMatchObject({ prep: "K", faces: [3], angle: 45 });
    expect(AGENT_COMMANDS.some((c) => c.cmd.startsWith("svar tupý"))).toBe(true);
    const f = (p.ops[1] as { feature: Feature }).feature;
    expect(featureSummary(f)).toMatch(/tupý V/);
    const txt = docStatusText({ ...emptyDoc("T"), features: [f] }, { status: [{ id: f.id, ok: true, info: "tupý V s10 · svarový kov 0,1 kg" }], mesh: null, metrics: null, ms: 0 });
    expect(txt).toContain("→ tupý V s10");
  });
});

describe("hrana / plocha u bodu", () => {
  it("souřadnice → edgeAt / faceAt (vyřeší jádro)", () => {
    expect(dataOf("svar koutový a5 hrana u 5 50 12; -5 50 12 oboustranně").d).toMatchObject({ edgeAt: [[5, 50, 12], [-5, 50, 12]], edges: [], both: true });
    expect(dataOf("svar tupý V 60 plocha u 0 100 5").d).toMatchObject({ faceAt: [[0, 100, 5]], faces: [], edges: [] });
    expect(dataOf("weld fillet a4 edge at 5 50 12").d).toMatchObject({ edgeAt: [[5, 50, 12]] });
    expect(dataOf("naht punkt Ø6 fläche bei 100 50 18").d).toMatchObject({ faceAt: [[100, 50, 18]] });
    expect(() => one("svar koutový a5 hrana u 5 50")).toThrow(/tři souřadnice/);
  });
});
