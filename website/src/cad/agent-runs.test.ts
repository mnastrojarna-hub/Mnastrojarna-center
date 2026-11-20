/** Opakovaný běh (vlna E, balík runs): zápis `nový díl "A" znovu|nový` v cs / en / de (agent-runs.ts, agent.ts `new`). */
import { describe, expect, it } from "vitest";
import { parseAgentText } from "./agent";
import { newDocTail } from "./agent-runs";

const op = (line: string) => {
  const p = parseAgentText(line);
  expect(p.errors, line).toEqual([]);
  return p.ops[0];
};

describe("nový díl / nová sestava – volba opakovaného běhu za názvem", () => {
  it("cs: znovu = použít záložku, nový / nová = vždy nová záložka; bez volby beze změny", () => {
    expect(op('nový díl "Deska" znovu')).toEqual({ k: "new", name: "Deska", assembly: false, line: 1, reuse: "reuse" });
    expect(op('nová sestava "S" nová')).toEqual({ k: "new", name: "S", assembly: true, line: 1, reuse: "new" });
    expect(op("nový díl Kryt levý nový")).toMatchObject({ name: "Kryt levý", reuse: "new" });
    expect(op("nový díl Deska")).toEqual({ k: "new", name: "Deska", assembly: false, line: 1 });
    expect(op('nový díl "Příruba DN50"')).toEqual({ k: "new", name: "Příruba DN50", assembly: false, line: 1 });
    expect(op("nová sestava Uložení   # komentář")).toEqual({ k: "new", name: "Uložení", assembly: true, line: 1 });
  });
  it("slovo v uvozovkách nebo jediné slovo je název, ne volba", () => {
    expect(op('nový díl "Kryt nový"')).toEqual({ k: "new", name: "Kryt nový", assembly: false, line: 1 });
    expect(op("nový díl znovu")).toEqual({ k: "new", name: "znovu", assembly: false, line: 1 });
    expect(op('nový díl „Rám znovu“')).toMatchObject({ name: "Rám znovu" });
    expect(op("nový díl")).toMatchObject({ name: "Nový díl", assembly: false });
    expect(op("nový díl")).not.toHaveProperty("reuse");
  });
  it("en: again / reuse / new; de: erneut / wieder / neu", () => {
    expect(op('new part "Plate" again')).toMatchObject({ k: "new", name: "Plate", assembly: false, reuse: "reuse" });
    expect(op("new part Plate reuse")).toMatchObject({ name: "Plate", reuse: "reuse" });
    expect(op("new assembly Frame new")).toMatchObject({ name: "Frame", assembly: true, reuse: "new" });
    expect(op('neues teil "Platte" erneut')).toMatchObject({ k: "new", name: "Platte", reuse: "reuse" });
    expect(op("neues teil Platte wieder")).toMatchObject({ name: "Platte", reuse: "reuse" });
    expect(op("neue baugruppe Rahmen neu")).toMatchObject({ name: "Rahmen", assembly: true, reuse: "new" });
  });
  it("newDocTail: slova za příkazem a druhem dokumentu", () => {
    expect(newDocTail('nový díl "A B" znovu')).toEqual({ name: "A B", mode: "reuse" });
    expect(newDocTail("nový díl A NOVÝ")).toEqual({ name: "A", mode: "new" });
    expect(newDocTail("nový díl")).toEqual({ name: "" });
    expect(newDocTail("nový díl 'Z' nove")).toEqual({ name: "Z", mode: "new" });
  });
});
