import { describe, expect, it } from "vitest";
import { AGENT_COMMANDS, parseAgentText, selectEdges, selectFaces, type EdgeLite, type FaceLite, type Bbox } from "./agent";
import { parseSelectCommand } from "./agent-select";

const cmdOf = (text: string) => {
  const p = parseAgentText(text);
  expect(p.errors).toEqual([]);
  const op = p.ops[0];
  if (op.k !== "api") throw new Error(`není příkaz API: ${op.k}`);
  return op.cmd;
};
const errOf = (text: string) => {
  const p = parseAgentText(text);
  expect(p.ops).toHaveLength(0);
  return p.errors[0]?.message ?? "";
};

describe("příkaz vyber – výběr entit textem", () => {
  it("česky, anglicky, německy: id, přidat, nic, výpis", () => {
    expect(cmdOf("vyber F3 E2 V5")).toEqual({ kind: "select", ids: ["F3", "E2", "V5"], additive: false });
    expect(cmdOf("vyber f3,e2")).toEqual({ kind: "select", ids: ["f3", "e2"], additive: false });
    expect(cmdOf("vyber F4 přidat")).toEqual({ kind: "select", ids: ["F4"], additive: true });
    expect(cmdOf("výběr těleso")).toEqual({ kind: "select", ids: ["těleso"], additive: false });
    expect(cmdOf("select E1 add")).toEqual({ kind: "select", ids: ["E1"], additive: true });
    expect(cmdOf("auswählen F2 hinzufügen")).toEqual({ kind: "select", ids: ["F2"], additive: true });
    expect(cmdOf("vyber Čep:F3 comp:Deska")).toEqual({ kind: "select", ids: ["Čep:F3", "comp:Deska"], additive: false });
    expect(cmdOf('vyber "feature:Díra 1"')).toEqual({ kind: "select", ids: ["feature:Díra 1"], additive: false });
    expect(cmdOf("vyber nic")).toEqual({ kind: "selectClear" });
    expect(cmdOf("select none")).toEqual({ kind: "selectClear" });
    expect(cmdOf("auswählen nichts")).toEqual({ kind: "selectClear" });
    expect(cmdOf("vyber")).toEqual({ kind: "selectShow" });
  });

  it("chyby s návodem", () => {
    expect(errOf("vyber modrá")).toContain("neznámé id „modrá“");
    expect(errOf("vyber přidat")).toContain("chybí co vybrat");
    expect(errOf("vyber F3 nic")).toContain("vyber nic zruší výběr");
    expect(parseSelectCommand(["kvádr", "10"])).toBeNull();
  });

  it("je v tabulce příkazů (CS / EN / DE)", () => {
    const row = AGENT_COMMANDS.find((c) => c.cmd.startsWith("vyber"));
    expect(row?.en).toContain("select");
    expect(row?.de).toContain("auswählen");
  });
});

describe("výběr textem – oprava po kontrole", () => {
  it("id oddělená středníkem (jako promítnout hrany E3;E7), pořadí stejných komponent #2:F3", () => {
    expect(cmdOf("vyber E3;E7")).toEqual({ kind: "select", ids: ["E3", "E7"], additive: false });
    expect(cmdOf("select E3;E7 add")).toEqual({ kind: "select", ids: ["E3", "E7"], additive: true });
    expect(cmdOf("auswählen F1;E2,V3")).toEqual({ kind: "select", ids: ["F1", "E2", "V3"], additive: false });
    expect(cmdOf("vyber #2:F3 comp:#1")).toEqual({ kind: "select", ids: ["#2:F3", "comp:#1"], additive: false });
  });

  it("tabulka příkazů neslibuje, že textové zaoblit / sražení převezmou výběr", () => {
    const row = AGENT_COMMANDS.find((c) => c.cmd.startsWith("vyber"))!;
    expect(row.desc).toContain("textové příkazy ne");
    expect(row.desc).toContain("zaoblit 3 hrany E2;E5");
    expect(AGENT_COMMANDS.find((c) => c.cmd.startsWith("zaoblit R [hrany"))!.cmd).toContain("E2;E5");
  });

  // kvádr 40 × 30 × 20: 12 hran (E1–E4 dole, E5–E8 nahoře, E9–E12 svislé), 6 ploch
  const bbox: Bbox = [[0, 0, 0], [40, 30, 20]];
  const edges: EdgeLite[] = Array.from({ length: 12 }, (_, i) => ({ index: i, curve: "line", dir: (i >= 8 ? [0, 0, 1] : [1, 0, 0]) as [number, number, number], center: [20, 15, i < 4 ? 0 : i < 8 ? 20 : 10] as [number, number, number], length: 10 }));
  const faces: FaceLite[] = Array.from({ length: 6 }, (_, i) => ({ index: i, planar: true, normal: [0, 0, i === 1 ? 1 : -1] as [number, number, number], center: [20, 15, i === 1 ? 20 : 0] as [number, number, number] }));

  it("hrany a plochy číslem v pravidle (zaoblit 3 hrany E2;E5, skořepina 2 otevřít F3)", () => {
    expect(selectEdges(["e2;e5"], edges, bbox)).toEqual([1, 4]);
    expect(selectEdges(["E2", "E5"], edges, bbox)).toEqual([1, 4]);
    expect(selectEdges(["e2,e9,e10", "svisle"], edges, bbox)).toEqual([8, 9]);
    expect(selectFaces(["f3;f2"], faces, bbox)).toEqual([1, 2]);
    expect(() => selectEdges(["e13"], edges, bbox)).toThrow(/E13 v tělese není – E1 až E12/);
    expect(() => selectEdges(["e0"], edges, bbox)).toThrow(/začínají 1/);
    expect(() => selectFaces(["f9"], faces, bbox)).toThrow(/F9 v tělese není – F1 až F6/);
    expect(() => selectEdges(["modre"], edges, bbox)).toThrow(/čísla E2;E5/);
  });

  it("textové zaoblit / srazit s čísly hran → výběr pravidlem (ne všechny hrany)", () => {
    for (const [text, rule] of [
      ["zaoblit 3 hrany E2;E5", ["e2;e5"]],
      ["fillet 3 edges E2", ["e2"]],
      ["srazit 1 hrany E2 E7", ["e2", "e7"]],
      ["skořepina 2 otevřít F3", ["f3"]],
    ] as [string, string[]][]) {
      const p = parseAgentText(text);
      expect(p.errors, text).toEqual([]);
      expect(p.ops[0], text).toMatchObject({ k: "select", rule });
    }
    // bez hran zůstává „všechny hrany“ (zdokumentováno) – výběr se nepřebírá
    expect(parseAgentText("zaoblit 3").ops[0]).toMatchObject({ k: "feature", feature: { type: "fillet", edges: "all" } });
  });
});
