import { describe, expect, it } from "vitest";
import { emptyAssembly, partComponent } from "@/cad/assembly";
import { emptyDoc, type CadDoc } from "@/cad/types";
import { flattenLeaves } from "./asm-flatten";
import { compRef, leafByRef, leafRef } from "./leaf-ref";

/** sestava se dvěma instancemi dílu „Kostka“, jedinečným „Čep“ a podsestavou „Rám“ (s další Kostkou) dvakrát */
function asm(): CadDoc {
  const kostka = { ...emptyDoc("Kostka"), kind: "part" as const };
  const cep = { ...emptyDoc("Čep"), kind: "part" as const };
  const ram: CadDoc = { ...emptyAssembly("Rám"), components: [partComponent(kostka, { position: [0, 0, 50] }), partComponent(cep)] };
  const sub = (x: number) => ({ id: `ram${x}`, name: "Rám", source: { kind: "asm" as const, doc: ram }, placement: { position: [x, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] } });
  return { ...emptyAssembly("S"), components: [partComponent(kostka, {}, { id: "k1" }), partComponent(kostka, { position: [80, 0, 0] }, { id: "k2" }), partComponent(cep, {}, { id: "c1", name: "Čep velký" }), sub(200), sub(400)] };
}

describe("odkaz na komponentu sestavy – stejně pojmenované instance (oprava po kontrole)", () => {
  it("každý list má odkaz, který vede zpět na tutéž instanci", () => {
    const d = asm();
    const leaves = flattenLeaves(d);
    const refs = leaves.map((l) => leafRef(d, leaves, l));
    expect(new Set(refs).size).toBe(leaves.length);
    for (const l of leaves) expect(leafByRef(d, leaves, leafRef(d, leaves, l)).id).toBe(l.id);
    // dvě Kostky nejvyšší úrovně = pořadí #1 / #2, jedinečný název zůstane názvem
    expect(leafRef(d, leaves, leaves.find((l) => l.id === "k2")!)).toBe("#2");
    expect(leafRef(d, leaves, leaves.find((l) => l.id === "c1")!)).toBe("Čep velký");
    // díl v podsestavě, která je v sestavě dvakrát: #4/Kostka, #5/Kostka
    expect(refs).toContain("#4/Kostka");
    expect(refs).toContain("#5/Čep");
  });

  it("víceznačný název je chyba s výčtem odkazů (ne tiše první instance); neznámý název vyjmenuje komponenty", () => {
    const d = asm();
    const leaves = flattenLeaves(d);
    expect(() => leafByRef(d, leaves, "Kostka")).toThrow(/„Kostka“ je v sestavě 4× – zadejte pořadí: #1, #2, #4\/Kostka, #5\/Kostka/);
    expect(() => leafByRef(d, leaves, "Nic")).toThrow(/komponenta „Nic“ v sestavě není/);
    expect(leafByRef(d, leaves, "čep velký").id).toBe("c1");
    expect(leafByRef(d, leaves, "#2").id).toBe("k2");
    // podsestava jako celek: odkaz komponenty nejvyšší úrovně
    expect(compRef(d, leaves, "ram400")).toBe("#5");
    expect(compRef(d, leaves, "k1")).toBe("#1");
  });

  it("jedinečné názvy se nemění (Čep:F3 jako dosud)", () => {
    const one: CadDoc = { ...emptyAssembly("S"), components: [partComponent({ ...emptyDoc("Čep"), kind: "part" }, {}, { id: "a" }), partComponent({ ...emptyDoc("Deska"), kind: "part" }, {}, { id: "b" })] };
    const leaves = flattenLeaves(one);
    expect(leaves.map((l) => leafRef(one, leaves, l))).toEqual(["Čep", "Deska"]);
    expect(leafByRef(one, leaves, "deska").id).toBe("b");
  });
});
