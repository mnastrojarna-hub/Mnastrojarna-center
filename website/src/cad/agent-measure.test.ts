import { afterEach, describe, expect, it } from "vitest";
import { AGENT_COMMANDS, parseAgentText } from "./agent";
import { dirText, measureLines, measureTokens, mfmt, parseMeasure } from "./agent-measure";
import { setLang } from "./i18n";

afterEach(() => setLang("cs"));

const cmdOf = (text: string) => {
  const p = parseAgentText(text);
  expect(p.errors).toEqual([]);
  const op = p.ops[0];
  if (op.k !== "measure") throw new Error(`není měření: ${op.k}`);
  return op.cmd;
};
const errOf = (text: string) => {
  const p = parseAgentText(text);
  expect(p.ops).toHaveLength(0);
  return p.errors[0]?.message ?? "";
};

describe("příkaz měřit – čtení zápisu", () => {
  it("česky: entity, dvojice, bod, těleso, díry, válce, pravidla", () => {
    expect(cmdOf("měřit F3")).toEqual({ kind: "entities", items: [{ ref: { kind: "face", index: 2 }, label: "F3" }] });
    expect(cmdOf("měřit f3 e5")).toEqual({ kind: "entities", items: [{ ref: { kind: "face", index: 2 }, label: "F3" }, { ref: { kind: "edge", index: 4 }, label: "E5" }] });
    expect(cmdOf("merit V1 10 20,5 -3")).toMatchObject({ kind: "entities", items: [{ ref: { kind: "vertex", index: 0 } }, { ref: { kind: "point", point: [10, 20.5, -3] } }] });
    expect(cmdOf("změřit V1 bod 0 0 5").kind).toBe("entities");
    expect(cmdOf("měřit těleso")).toEqual({ kind: "body", comp: undefined });
    expect(cmdOf("měřit díry")).toEqual({ kind: "holes", comp: undefined });
    expect(cmdOf("měřit válce")).toEqual({ kind: "cylinders", comp: undefined });
    expect(cmdOf("měřit plocha horní")).toEqual({ kind: "rule", what: "faces", rule: ["horní"], comp: undefined });
    expect(cmdOf("měřit plocha F7")).toMatchObject({ kind: "entities", items: [{ ref: { kind: "face", index: 6 } }] });
    expect(cmdOf("měřit hrany kruhové poloměr 4")).toEqual({ kind: "rule", what: "edges", rule: ["kruhové", "r=4"], comp: undefined });
    expect(cmdOf("měřit hrany svislé delší 10")).toMatchObject({ rule: ["svislé", "len>10"] });
    expect(cmdOf("měřit V2 těleso")).toMatchObject({ kind: "entities", items: [{ ref: { kind: "vertex", index: 1 } }, { ref: { kind: "body" } }] });
  });

  it("sestava: komponenta před dvojtečkou (i v uvozovkách)", () => {
    expect(cmdOf("měřit Hřídel:F3 Deska:F1")).toEqual({
      kind: "entities",
      items: [
        { ref: { kind: "face", index: 2 }, label: "Hřídel:F3", comp: "Hřídel" },
        { ref: { kind: "face", index: 0 }, label: "Deska:F1", comp: "Deska" },
      ],
    });
    expect(cmdOf('měřit "Hřídel 1":E2')).toMatchObject({ items: [{ comp: "Hřídel 1", ref: { kind: "edge", index: 1 } }] });
    expect(cmdOf("měřit Deska:díry")).toEqual({ kind: "holes", comp: "Deska" });
    expect(parseMeasure(measureTokens('"Víko A":F2 V1'))).toMatchObject({ items: [{ comp: "Víko A" }, { ref: { kind: "vertex", index: 0 } }] });
  });

  it("anglicky a německy", () => {
    expect(cmdOf("measure F3 F7").kind).toBe("entities");
    expect(cmdOf("measure body")).toEqual({ kind: "body", comp: undefined });
    expect(cmdOf("measure holes")).toEqual({ kind: "holes", comp: undefined });
    expect(cmdOf("measure cylinders")).toEqual({ kind: "cylinders", comp: undefined });
    expect(cmdOf("measure faces top")).toMatchObject({ kind: "rule", what: "faces", rule: ["top"] });
    expect(cmdOf("measure edges circular radius 4")).toMatchObject({ kind: "rule", what: "edges", rule: ["circular", "r=4"] });
    expect(cmdOf("messen F1 E2").kind).toBe("entities");
    expect(cmdOf("messen körper")).toEqual({ kind: "body", comp: undefined });
    expect(cmdOf("messen bohrungen")).toEqual({ kind: "holes", comp: undefined });
    expect(cmdOf("messen zylinder")).toEqual({ kind: "cylinders", comp: undefined });
    expect(cmdOf("messen kanten kreisförmig")).toMatchObject({ kind: "rule", what: "edges", rule: ["kreisförmig"] });
    expect(cmdOf("vermessen V1 punkt 1 2 3")).toMatchObject({ items: [{ ref: { kind: "vertex" } }, { ref: { kind: "point", point: [1, 2, 3] } }] });
  });

  it("chyby: chybí entita, F0, neznámé slovo, víc než dvě entity, neúplný bod", () => {
    expect(errOf("měřit")).toContain("měřit potřebuje, co měřit");
    expect(errOf("měřit F0")).toContain("začínají 1");
    expect(errOf("měřit X3")).toContain("neznámá entita „X3“");
    expect(errOf("měřit F1 F2 F3")).toContain("nejvýš dvě entity (zadáno 3)");
    expect(errOf("měřit V1 10 20")).toContain("tři souřadnice");
    expect(errOf("měřit plocha")).toContain("číslo nebo pravidlo");
    expect(errOf("měřit díry F2")).toContain("nemá další volby");
    expect(errOf("měřit 1 2 3")).toContain("aspoň jednu entitu");
  });

  it("příkaz je v tabulce příkazů (CS / EN / DE) a hláška o neznámém příkazu ho nabízí", () => {
    const row = AGENT_COMMANDS.find((c) => c.cmd.startsWith("měřit"));
    expect(row).toMatchObject({ en: "measure", de: "messen" });
    expect(errOf("blabla")).toContain("měřit");
    setLang("en");
    expect(errOf("blabla")).toContain("measure");
    setLang("de");
    expect(errOf("blabla")).toContain("messen");
  });
});

describe("text výsledku", () => {
  it("čísla: nejvýš 3 desetinná místa, čárka v CS/DE, tečka v EN, bez oddělovače tisíců", () => {
    expect(mfmt(12.5)).toBe("12,5");
    expect(mfmt(118429.2041)).toBe("118429,204");
    expect(mfmt(-0.0001)).toBe("0");
    expect(mfmt(20)).toBe("20");
    setLang("en");
    expect(mfmt(12.5)).toBe("12.5");
    setLang("de");
    expect(mfmt(0.25)).toBe("0,25");
  });
  it("směr: hlavní osy jako ±X/Y/Z, jinak vektor", () => {
    expect(dirText([0, 0, 1])).toBe("+Z");
    expect(dirText([0, -1, 0])).toBe("−Y");
    expect(dirText([1, 1, 0])).toBe("[0,7071; 0,7071; 0]");
  });
  it("řádky: dvojice, díry po průměrech, prázdný seznam", () => {
    const pair = measureLines({ kind: "pair", pair: { a: { label: "F1", kind: "face", type: "PLANE", normal: [0, 0, 1] }, b: { label: "F2", kind: "face", type: "PLANE", normal: [0, 0, -1] }, distance: 5, delta: [0, 0, 5], p1: [0, 0, 5], p2: [0, 0, 0], angle: 180, angleKind: "planes", parallel: true, planeDistance: 5 } });
    expect(pair).toEqual(["F1 (rovina) ↔ F2 (rovina): vzdálenost 5 mm · ΔX 0 · ΔY 0 · ΔZ 5 · nejbližší body [0; 0; 5] a [0; 0; 0] · úhel normál 180° (rovnoběžné) · vzdálenost rovin 5 mm"]);
    expect(measureLines({ kind: "holes", label: "", holes: [] })).toEqual(["Díry: žádné válcové díry"]);
    const holes = measureLines({
      kind: "holes",
      label: "Deska",
      holes: [
        { diameter: 8, radius: 4, axis: [0, 0, 1], from: [10, 10, 0], to: [10, 10, 20], length: 20, span: 360, faces: [7], entry: [10, 10, 20], drill: [0, 0, -1], through: true },
        { diameter: 8, radius: 4, axis: [0, 0, 1], from: [30, 10, 0], to: [30, 10, 20], length: 20, span: 360, faces: [8, 9], entry: [30, 10, 20], drill: [0, 0, -1], through: true },
      ],
    });
    expect(holes).toEqual(["Deska: Díry: 2 – Ø 8 mm × 2", "Ø 8 mm × 2:", "  D1 Ø 8 mm: vstup [10; 10; 20] · skrz, délka 20 mm · osa +Z · plocha F7", "  D2 Ø 8 mm: vstup [30; 10; 20] · skrz, délka 20 mm · osa +Z · plochy F8, F9"]);
  });
});
