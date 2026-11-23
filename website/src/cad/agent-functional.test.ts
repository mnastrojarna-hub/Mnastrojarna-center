/**
 * Vlna 22, bod 18 – rozbor příkazů funkčních prvků a základen (agent-functional.ts) a jejich napojení v parseAgentText,
 * CS / EN / DE; `datum` v EN jen v přesném tvaru (jinak je to pomocná rovina). Podpříkazy výkresu `výkres kontrola kót`
 * a `výkres doplnit kóty` (agent-drawing.ts).
 */
import { describe, expect, it } from "vitest";
import { parseAgentText } from "./agent";
import { parseDrawing } from "./agent-drawing";
import { functionalTokens, parseFunctionalLine } from "./agent-functional";

describe("bod 18 – funkční / základna (rozbor)", () => {
  it("CS: plocha s tolerancí, prvek v uvozovkách, prvek bez uvozovek, výpis, zrušení", () => {
    expect(parseFunctionalLine("funkční F7 H7")).toEqual({ kind: "mark", target: ["F7", "H7"] });
    expect(parseFunctionalLine('funkční "Díra 1" ±0,02')).toEqual({ kind: "mark", target: ["Díra 1", "±0,02"] });
    expect(parseFunctionalLine("funkční Díra 1")).toEqual({ kind: "mark", target: ["Díra", "1"] });
    expect(parseFunctionalLine("funkční")).toEqual({ kind: "list" });
    expect(parseFunctionalLine("funkční seznam")).toEqual({ kind: "list" });
    expect(parseFunctionalLine("funkční zrušit vše")).toEqual({ kind: "clear", what: "functional", target: "all" });
    expect(parseFunctionalLine('funkční zrušit "Díra 1"')).toEqual({ kind: "clear", what: "functional", target: ["Díra 1"] });
  });
  it("základna: CS, funkční základna, EN functional datum / datum A F3, DE bezug; zrušení", () => {
    expect(parseFunctionalLine("základna A F3")).toEqual({ kind: "datum", label: "A", target: ["F3"] });
    expect(parseFunctionalLine("funkční základna b f5")).toEqual({ kind: "datum", label: "B", target: ["F5"] });
    expect(parseFunctionalLine("functional datum A F3")).toEqual({ kind: "datum", label: "A", target: ["F3"] });
    expect(parseFunctionalLine("datum A F3")).toEqual({ kind: "datum", label: "A", target: ["F3"] });
    expect(parseFunctionalLine("bezug C F1")).toEqual({ kind: "datum", label: "C", target: ["F1"] });
    expect(parseFunctionalLine("základna zrušit A")).toEqual({ kind: "clear", what: "datum", target: ["A"] });
    expect(() => parseFunctionalLine("základna A")).toThrow(/písmeno a rovinná plocha/);
    expect(() => parseFunctionalLine("základna AB F3")).toThrow(/písmeno a rovinná plocha/);
  });
  it("EN / DE funkční; „datum“ jinak než přesně = pomocná rovina (jiný příkaz)", () => {
    expect(parseFunctionalLine("functional F7 h6")).toEqual({ kind: "mark", target: ["F7", "h6"] });
    expect(parseFunctionalLine("funktional F2")).toEqual({ kind: "mark", target: ["F2"] });
    expect(parseFunctionalLine("functional clear F7")).toEqual({ kind: "clear", what: "functional", target: ["F7"] });
    expect(parseFunctionalLine("funktional entfernen alle")).toEqual({ kind: "clear", what: "functional", target: "all" });
    expect(parseFunctionalLine("datum offset 10")).toBeNull();
    expect(parseFunctionalLine("kvádr 10 10 10")).toBeNull();
    expect(parseFunctionalLine("kótovat funkční 26,5")).toBeNull();
  });
  it("uvozovky „…“ i \"…\" drží název s mezerami", () => {
    expect(functionalTokens('funkční „Díra 2“ H7')).toEqual(["funkční", "Díra 2", "H7"]);
  });
  it("parseAgentText: řádek funkční / základna = operace functional (CS, EN, DE)", () => {
    const p = parseAgentText('nový díl "A"\nkvádr 10 10 10\nfunkční F6 H7\nzákladna A F1\nfunctional datum B F2\nbezug C F3');
    expect(p.errors).toEqual([]);
    const ops = p.ops.filter((o) => o.k === "functional");
    expect(ops.map((o) => (o as { cmd: { kind: string } }).cmd.kind)).toEqual(["mark", "datum", "datum", "datum"]);
  });
});

describe("bod 18 – výkres kontrola kót / výkres doplnit kóty (rozbor)", () => {
  it("CS / EN / DE", () => {
    expect(parseDrawing(["kontrola", "kót"])).toEqual({ k: "dimcheck" });
    expect(parseDrawing(["check", "dims"])).toEqual({ k: "dimcheck" });
    expect(parseDrawing(["prüfen", "maße"])).toEqual({ k: "dimcheck" });
    expect(parseDrawing(["doplnit", "kóty"])).toEqual({ k: "dimfill", what: "all" });
    expect(parseDrawing(["doplnit", "kóty", "polohy"])).toEqual({ k: "dimfill", what: "pos" });
    expect(parseDrawing(["doplnit", "kóty", "velikosti"])).toEqual({ k: "dimfill", what: "size" });
    expect(parseDrawing(["doplnit", "kóty", "3", "5"])).toEqual({ k: "dimfill", what: "all", only: [3, 5] });
    expect(parseDrawing(["complete", "dims", "positions"])).toEqual({ k: "dimfill", what: "pos" });
    expect(parseDrawing(["add", "missing", "dims"])).toEqual({ k: "dimfill", what: "all" });
    expect(parseDrawing(["maße", "ergänzen", "alle"])).toEqual({ k: "dimfill", what: "all" });
    expect(() => parseDrawing(["doplnit", "kóty", "něco"])).toThrow(/výkres doplnit kóty/);
    // dosavadní příkazy beze změny
    expect(parseDrawing(["kontrola", "tolerancí"])).toEqual({ k: "tolcheck" });
  });
});
