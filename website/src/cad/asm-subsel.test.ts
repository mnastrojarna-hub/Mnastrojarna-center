/** Podsestava › Vytvořit z vybraných (w13 chyba 13): výběr ve stromu i ve 3D okně, neaktivní položka s důvodem. */
import { describe, expect, it } from "vitest";
import { makeSubassembly, subassemblyPick, treeSelAfterPick } from "../components/cad/asm-flatten";
import { emptyAssembly, partComponent } from "./assembly";
import { emptyDoc } from "./types";

const asm = () => {
  const a = partComponent({ ...emptyDoc("A"), kind: "part" }, {});
  const b = partComponent({ ...emptyDoc("B"), kind: "part" }, {});
  const c = partComponent({ ...emptyDoc("C"), kind: "part" }, {});
  return { doc: { ...emptyAssembly("S"), components: [a, b, c] }, a, b, c };
};

describe("subassemblyPick", () => {
  it("bez výběru = důvod (položka neaktivní), prázdná sestava = jiný důvod", () => {
    const { doc } = asm();
    expect(subassemblyPick(doc, [], null)).toEqual({ ids: [], why: "Vyberte komponenty ve stromu nebo v modelu (Ctrl+klik přidá další)." });
    expect(subassemblyPick(emptyAssembly("x"), [], null).why).toBe("Sestava zatím nemá komponenty.");
  });
  it("komponenta vybraná jen ve stromu se počítá", () => {
    const { doc, b } = asm();
    expect(subassemblyPick(doc, [], b.id)).toEqual({ ids: [b.id] });
  });
  it("výběr ve 3D (komponenta, těleso, plocha listu podsestavy) + strom, bez duplicit, jen existující", () => {
    const { doc, a, b, c } = asm();
    const sel = [
      { kind: "component", compId: a.id, topId: a.id },
      { kind: "face", compId: `${b.id}/x`, topId: b.id },
      { kind: "body", compId: a.id },
      { kind: "component", compId: "neni" },
      { kind: "feature" },
    ];
    expect(subassemblyPick(doc, sel, c.id).ids).toEqual([a.id, b.id, c.id]);
    expect(subassemblyPick(doc, sel, a.id).ids).toEqual([a.id, b.id]);
  });
  it("výsledek jde rovnou do makeSubassembly", () => {
    const { doc, a, c } = asm();
    const p = subassemblyPick(doc, [{ kind: "component", compId: a.id, topId: a.id }], c.id);
    const made = makeSubassembly(doc, p.ids, "Pod");
    expect(made.components!.map((x) => x.name)).toEqual(["Pod", "B"]);
    expect(made.components![0].source.kind === "asm" && made.components![0].source.doc.components!.map((x) => x.name)).toEqual(["A", "C"]);
  });
});

describe("treeSelAfterPick – Ctrl+klik ve 3D, který komponentu ubral (w13 chyba 13, nález kontroly)", () => {
  const C = (id: string) => ({ kind: "component", compId: id, topId: id });
  it("odebraná komponenta nezůstane vybraná ve stromu – Vytvořit z vybraných vezme jen zbylé", () => {
    const { doc, a, b } = asm();
    // klik Deska (a), Ctrl+klik Čep (b), Ctrl+klik Čep znovu (ubrat)
    const s1 = [C(a.id)];
    const s2 = [C(a.id), C(b.id)];
    expect(treeSelAfterPick(s1, s2, C(b.id))).toBe(b.id);
    const s3 = [C(a.id)];
    const tree = treeSelAfterPick(s2, s3, C(b.id));
    expect(tree).toBe(a.id);
    expect(subassemblyPick(doc, s3, tree ?? null).ids).toEqual([a.id]);
    // dříve zůstal ve stromu Čep → podsestava z obou
    expect(subassemblyPick(doc, s3, b.id).ids).toEqual([a.id, b.id]);
  });
  it("ubrání poslední komponenty = nic ve stromu; plocha dílu podsestavy = jeho komponenta nejvyšší úrovně", () => {
    const { a, b } = asm();
    expect(treeSelAfterPick([C(a.id)], [], C(a.id))).toBeNull();
    expect(treeSelAfterPick([C(a.id), { kind: "face", compId: `${b.id}/x`, topId: `${b.id}/x` }], [{ kind: "face", compId: `${b.id}/x`, topId: `${b.id}/x` }], C(a.id))).toBe(b.id);
    expect(treeSelAfterPick([], [{ kind: "face", compId: `${b.id}/x` }], { kind: "face", compId: `${b.id}/x` })).toBe(b.id);
    expect(treeSelAfterPick([], [{ kind: "feature" }], { kind: "feature" })).toBeUndefined();
  });
});
