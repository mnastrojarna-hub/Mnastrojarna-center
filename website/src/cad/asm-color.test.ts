import { describe, expect, it } from "vitest";
import { allColored, colorComponents, colorTargets } from "./asm-color";
import { makeSubassembly } from "../components/cad/asm-flatten";
import { emptyAssembly, partComponent } from "./assembly";
import { emptyDoc } from "./types";

const asm = () => {
  const a = emptyAssembly("Test");
  a.components = [partComponent(emptyDoc("Deska"), {}, { color: "#b9c2cc" }), partComponent(emptyDoc("Čep"), {}, { color: "#b9c2cc" }), partComponent(emptyDoc("Kolík"), {}, { color: "#b9c2cc" })];
  return a;
};

describe("Zobrazení › Barva v sestavě (asm-color.ts)", () => {
  it("bez výběru obarví všechny komponenty, s výběrem jen vybrané", () => {
    const a = asm();
    const [d, c, k] = a.components!.map((x) => x.id);
    expect(colorTargets(a, [])).toEqual([d, c, k]);
    expect(colorTargets(a, [c, c, "neexistuje"])).toEqual([c]);
    const all = colorComponents(a, colorTargets(a, []), "#e03930");
    expect(all.components!.map((x) => x.color)).toEqual(["#e03930", "#e03930", "#e03930"]);
    expect(allColored(all, [d, c, k], "#E03930")).toBe(true);
    const one = colorComponents(a, [c], "#4f81bd");
    expect(one.components!.map((x) => x.color)).toEqual(["#b9c2cc", "#4f81bd", "#b9c2cc"]);
    expect(allColored(one, [c], "#4f81bd")).toBe(true);
    expect(allColored(one, [d, c], "#4f81bd")).toBe(false);
    expect(a.components!.map((x) => x.color)).toEqual(["#b9c2cc", "#b9c2cc", "#b9c2cc"]); // původní dokument beze změny (Ctrl+Z)
  });
  it("podsestava: barva se propíše i do jejích dílů (jejich vlastní barva má při zobrazení přednost)", () => {
    const a = asm();
    const [d, c] = a.components!.map((x) => x.id);
    const s = makeSubassembly(a, [d, c], "Uzel");
    const sub = s.components!.find((x) => x.source.kind === "asm")!;
    const out = colorComponents(s, [sub.id], "#e0b24a");
    const sub2 = out.components!.find((x) => x.id === sub.id)!;
    expect(sub2.color).toBe("#e0b24a");
    expect(sub2.source.kind === "asm" && sub2.source.doc.components!.map((x) => x.color)).toEqual(["#e0b24a", "#e0b24a"]);
    expect(allColored(out, [sub.id], "#e0b24a")).toBe(true);
  });
});
