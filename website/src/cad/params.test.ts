import { describe, expect, it } from "vitest";
import { evalExpr, exprRefs, getPath, isExpression, resolveDoc, resolveVariables, setPath } from "./params";
import { emptyDoc, type CadDoc } from "./types";

describe("evalExpr", () => {
  it("aritmetika, priority, závorky, unární minus, mocnina", () => {
    expect(evalExpr("1 + 2 * 3")).toBe(7);
    expect(evalExpr("(1 + 2) * 3")).toBe(9);
    expect(evalExpr("-2 ^ 2")).toBe(-4);
    expect(evalExpr("2 ^ 3 ^ 2")).toBe(512);
    expect(evalExpr("2 * -3")).toBe(-6);
    expect(evalExpr("10 / 4")).toBe(2.5);
    expect(evalExpr("=25/2")).toBe(12.5);
    expect(evalExpr("2,5 * 2")).toBe(5);
    expect(evalExpr("1e3 + 1")).toBe(1001);
  });
  it("funkce ve stupních a konstanty", () => {
    expect(evalExpr("sin(30)")).toBeCloseTo(0.5, 12);
    expect(evalExpr("cos(60) + tan(45)")).toBeCloseTo(1.5, 12);
    expect(evalExpr("atan(1)")).toBeCloseTo(45, 12);
    expect(evalExpr("sqrt(16) + abs(-2)")).toBe(6);
    expect(evalExpr("max(1, 5, 3) - min(4; 2)")).toBe(3);
    expect(evalExpr("round(2.5) + floor(1.9) + ceil(1.1)")).toBe(6);
    expect(evalExpr("2 * pi")).toBeCloseTo(Math.PI * 2, 12);
    expect(evalExpr("max(1,5; 2)")).toBe(2);
    expect(evalExpr("max(1,5,3)")).toBe(5);
  });
  it("proměnné a chyby", () => {
    expect(evalExpr("d * 2 + délka", { d: 4, délka: 10 })).toBe(18);
    expect(() => evalExpr("x + 1")).toThrow(/Neznámá proměnná „x“/);
    expect(() => evalExpr("foo(1)")).toThrow(/Neznámá funkce/);
    expect(() => evalExpr("1 +")).toThrow();
    expect(() => evalExpr("(1 + 2")).toThrow(/\)/);
    expect(() => evalExpr("1 / 0")).toThrow(/nulou/);
    expect(() => evalExpr("2 $ 3")).toThrow(/Neplatný znak/);
    expect(() => evalExpr("")).toThrow();
    // žádné spouštění kódu
    expect(() => evalExpr("constructor.constructor('return 1')()")).toThrow();
  });
  it("odkazy a rozpoznání výrazu", () => {
    expect(exprRefs("a + sin(b) * pi + a")).toEqual(["a", "b"]);
    expect(isExpression("12,5")).toBe(false);
    expect(isExpression("=12")).toBe(true);
    expect(isExpression("L/2")).toBe(true);
  });
});

describe("resolveVariables", () => {
  it("vyhodnotí v pořadí závislostí a hlásí cykly", () => {
    const { values, errors } = resolveVariables([
      { name: "C", expr: "B * 2" },
      { name: "A", expr: "10" },
      { name: "B", expr: "A + 1" },
      { name: "X", expr: "Y" },
      { name: "Y", expr: "X + 1" },
      { name: "Z", expr: "X * 2" },
      { name: "1bad", expr: "1" },
    ]);
    expect(values).toMatchObject({ A: 10, B: 11, C: 22 });
    expect(errors.X).toMatch(/Cyklická/);
    expect(errors.Y).toMatch(/Cyklická/);
    expect(errors.Z).toBeTruthy();
    expect(errors["1bad"]).toMatch(/Neplatný název/);
  });
  it("přepisy ze stavu mají přednost", () => {
    const { values } = resolveVariables([{ name: "A", expr: "10" }, { name: "B", expr: "A * 3" }], { A: 2 });
    expect(values.B).toBe(6);
  });
});

describe("resolveDoc", () => {
  const base = (): CadDoc => ({
    ...emptyDoc("T"),
    features: [{ id: "b", name: "Kvádr", type: "box", size: [1, 2, 3], position: [0, 0, 0], centered: false, mode: "new" }],
    variables: [{ name: "L", expr: "40" }],
    bindings: { "b:size.0": "L * 2", "b:position.2": "-L" },
  });
  it("zapíše hodnoty do klonu a originál nemění", () => {
    const d = base();
    const { doc, values, errors } = resolveDoc(d);
    expect(errors).toEqual([]);
    expect(values.L).toBe(40);
    const f = doc.features[0] as Extract<CadDoc["features"][number], { type: "box" }>;
    expect(f.size).toEqual([80, 2, 3]);
    expect(f.position[2]).toBe(-40);
    expect((d.features[0] as typeof f).size[0]).toBe(1);
  });
  it("stav: hodnoty + potlačení, neplatná cesta a vazba na smazaný prvek", () => {
    const d = { ...base(), configs: [{ id: "k", name: "K", values: { L: 5 }, suppressed: ["b"] }], activeConfig: "k" };
    d.bindings = { ...d.bindings, "b:neni": "1", "zmizel:distance": "2" };
    const { doc, errors } = resolveDoc(d);
    expect(doc.features[0].suppressed).toBe(true);
    expect(getPath(doc.features[0], "size.0")).toBe(10);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/neexistuje/);
  });
  it("bez vazeb vrací stejný objekt", () => {
    const d = emptyDoc();
    expect(resolveDoc(d).doc).toBe(d);
  });
  it("setPath odmítne nečíselné cíle", () => {
    const o = { a: { b: [1, 2] }, s: "x" } as Record<string, unknown>;
    expect(setPath(o, "a.b.1", 5)).toBe(true);
    expect(setPath(o, "s", 5)).toBe(false);
    expect(setPath(o, "a.c", 5)).toBe(false);
  });
});
