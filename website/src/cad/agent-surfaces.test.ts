import { describe, expect, it } from "vitest";
import { parseAgentText } from "./agent";
import { setLang } from "./i18n";
import { parseSurfaceLine } from "./agent-surfaces";

const ops = (t: string) => {
  const p = parseAgentText(t);
  expect(p.errors).toEqual([]);
  return p.ops;
};
const err = (t: string) => parseAgentText(t).errors[0]?.message ?? "";
const data = (t: string) => (ops(t)[0] as { feature: { ext: string; data: Record<string, unknown> } }).feature;

describe("plochy třídy A – text pro agenty", () => {
  it("výplň / fill / füllen", () => {
    expect(data("výplň E3 E4 E5 G2 sešít")).toMatchObject({ ext: "surf.fill", data: { edges: [2, 3, 4], continuity: "G2", sew: true } });
    expect(data("fill E1 E2 G1")).toMatchObject({ ext: "surf.fill", data: { edges: [0, 1], continuity: "G1" } });
    expect(data("füllen E7")).toMatchObject({ data: { edges: [6], continuity: "G1" } });
    expect(err("výplň")).toMatch(/hrany otvoru/);
    expect(err("výplň E3 nesmysl")).toMatch(/nesmysl/);
  });
  it("přechod / blend / übergang s napětím", () => {
    expect(data("přechod E3 E7 G2 G1 napětí 1,2 0,8 obrátit")).toMatchObject({ ext: "surf.blend", data: { edges: [2, 6], contA: "G2", contB: "G1", tensionA: 1.2, tensionB: 0.8, flip: true } });
    expect(data("blend E1 E2 G1 tension 2")).toMatchObject({ data: { contA: "G1", contB: "G1", tensionA: 2, tensionB: 2 } });
    expect(data("übergang E1 E2")).toMatchObject({ data: { contA: "G2", contB: "G2" } });
    expect(err("přechod E1")).toMatch(/právě dvě hrany/);
    expect(err("přechod E1 E2 G0")).toMatch(/G1 nebo G2/);
  });
  it("prodloužit plochu / extend surface / verlängern fläche", () => {
    expect(data("prodloužit plochu E5 10 G1")).toMatchObject({ ext: "surf.extendEdge", data: { edges: [4], length: 10, continuity: "G1" } });
    expect(data("extend surface E5 E6 length 12,5")).toMatchObject({ data: { edges: [4, 5], length: 12.5, continuity: "G2" } });
    expect(data("verlängern fläche E2 5 G2")).toMatchObject({ data: { edges: [1], length: 5 } });
    expect(data("prodloužit-plochu E2 5")).toMatchObject({ data: { edges: [1], length: 5 } });
    expect(err("prodloužit plochu E5")).toMatch(/kladnou délku/);
  });
  it("plocha F3 cv – seznam, bod, řada, síť (CS / EN / DE)", () => {
    expect(ops("plocha F3 cv")[0]).toMatchObject({ k: "surf", cmd: { kind: "cvList", face: 2, grid: null } });
    expect(ops("face F2 cv grid 5 4")[0]).toMatchObject({ k: "surf", cmd: { kind: "cvList", face: 1, grid: [5, 4] } });
    expect(data("plocha F3 cv 2 3 posun 0 0 1,5")).toMatchObject({ ext: "surf.cv", data: { faces: [2], gridU: 0, gridV: 0, moves: [{ i: 2, j: 3, d: [0, 0, 1.5] }], rows: [] } });
    expect(data("plocha F1 cv síť 4 4 2 2 posun 0 0 1 řada u 1 posun 0 0 -2")).toMatchObject({ data: { gridU: 4, gridV: 4, moves: [{ i: 2, j: 2, d: [0, 0, 1] }], rows: [{ dir: "u", index: 1, d: [0, 0, -2] }] } });
    expect(data("face F1 cv 1 1 move 1 0 0")).toMatchObject({ data: { moves: [{ i: 1, j: 1, d: [1, 0, 0] }] } });
    expect(data("fläche F1 cv reihe v 2 verschieben 0 0 1")).toMatchObject({ data: { rows: [{ dir: "v", index: 2, d: [0, 0, 1] }] } });
    expect(err("plocha F3 cv 2 3")).toMatch(/chybí posun/);
    expect(err("plocha F3 cv 2 posun 0 0 1")).toMatch(/„2“/);
    expect(err("plocha F3 cv posun 0 0 1")).toMatch(/posun čeho/);
    expect(err("plocha cv")).toMatch(/F…/);
    expect(parseSurfaceLine(["plocha", "F3", "barva"])).toBeNull();
  });
  it("analýza návaznosti / hřebenu", () => {
    expect(ops("analýza návaznosti E3 E5 zobrazit")[0]).toMatchObject({ k: "surf", cmd: { kind: "continuity", edges: [2, 4], show: true } });
    expect(ops("analyze continuity")[0]).toMatchObject({ k: "surf", cmd: { kind: "continuity", edges: [], show: false } });
    expect(ops("analyse stetigkeit E1")[0]).toMatchObject({ k: "surf", cmd: { kind: "continuity", edges: [0] } });
    expect(ops("analýza hřebenu E2 měřítko 50 zobrazit")[0]).toMatchObject({ k: "surf", cmd: { kind: "comb", edges: [1], scale: 50, show: true } });
    expect(ops("analyse kamm E1")[0]).toMatchObject({ k: "surf", cmd: { kind: "comb", edges: [0] } });
    // ostatní analýzy beze změny
    expect(ops("analýza křivosti")[0]).toMatchObject({ k: "api" });
  });
  it("hlášky v EN / DE nejsou neznámý příkaz", () => {
    for (const lang of ["en", "de"] as const) {
      setLang(lang);
      for (const w of lang === "en" ? ["fill", "blend", "extend surface", "face F3 cv", "analyze continuity", "analyze comb"] : ["füllen", "übergang", "verlängern fläche", "fläche F3 cv", "analyse stetigkeit", "analyse kamm"]) expect(err(w)).not.toMatch(/unknown command|unbekannter Befehl/);
    }
    setLang("cs");
  });
});
