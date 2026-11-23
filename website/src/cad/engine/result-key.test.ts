/**
 * Identita výsledků analýz (vlna 22, bod 1): výsledek platí jen pro klíč dokumentu + revizi geometrie + konfiguraci + polohu.
 * Čisté funkce – bez jádra. Příklady s neutrálními názvy („Deska A“, „Přidržovač“).
 */
import { describe, expect, it } from "vitest";
import { hashPair, sourceKey } from "../assembly";
import { flattenLeaves } from "../asm-flatten";
import { clashSig } from "../clash-class";
import { emptyDoc, type AsmComponent, type CadDoc, type Mate } from "../types";
import { MemoryWorkspace } from "./memory-workspace";
import { clashState, clashStateOf, dropResults, geometrySig, leavesSig, mateSig, mateSigOf, mateStatusState, modelRev, noteResult, notedResults, registerStaleProbe, resultId, resultIdOf, resultKey, resultState, setMateStatus, shortHash, staleResults, stampResult } from "./result-key";

const part = (name: string, size = 10): CadDoc => ({ ...emptyDoc(name), features: [{ id: `f-${name}`, type: "box", name: "Kvádr 1", size: [size, size, size] } as unknown as CadDoc["features"][number]] });
const comp = (id: string, name: string, z: number, o: Partial<AsmComponent> = {}): AsmComponent => ({ id, name, source: { kind: "part", doc: part(name) }, placement: { position: [0, 0, z], rotation: [0, 0, 0] }, ...o }) as AsmComponent;
const asm = (name: string, comps: AsmComponent[], mates: Mate[] = []): CadDoc => ({ ...emptyDoc(name), kind: "assembly", components: comps, ...(mates.length ? { mates } : {}) });
const mate = (value: number): Mate => ({ id: "m1", type: "distance", a: { compId: "b", face: 4 }, b: { compId: "a", face: 5 }, value }) as Mate;

describe("otisky a revize modelu", () => {
  it("sourceKey se po vyvedení hashPair nezměnil (tatáž FNV dvojice, žádné druhé hashování)", () => {
    const str = `step:5:hello:hello`;
    const [h1, h2] = hashPair(str);
    expect(sourceKey({ kind: "file", format: "step", data: "hello" } as never)).toBe(h1.toString(36) + h2.toString(36) + str.length.toString(36));
    expect(shortHash("abc")).toMatch(/^[0-9a-f]{6}$/);
    expect(shortHash("abc")).toBe(hashPair("abc")[0].toString(16).padStart(8, "0").slice(0, 6));
  });

  it("revize dílu r·<6 hex>: stejná geometrie = stejná, změna prvku / konfigurace = jiná", () => {
    const a = part("Deska A");
    expect(modelRev(a)).toMatch(/^r·[0-9a-f]{6}$/);
    expect(modelRev({ ...a, name: "Jiný název" })).toBe(modelRev(a)); // název geometrii nemění
    expect(modelRev(part("Deska A", 11))).not.toBe(modelRev(a));
    expect(modelRev({ ...a, activeConfig: "c2" } as CadDoc)).not.toBe(modelRev(a)); // konfigurace
    expect(geometrySig(a)).toBe(sourceKey({ kind: "part", doc: a }));
  });

  it("revize nezávisí na náhodných id (fáze 2: stejný skript = stejná revize v prohlížeči i v CLI), odkazy na id ano", () => {
    // tentýž díl, jen jiná náhodná id prvků (každý běh skriptu, prohlížeč × CLI) – odkaz zaoblení na kvádr zůstává
    const withIds = (box: string, fil: string, target = box): CadDoc => ({
      ...emptyDoc("Deska A"),
      features: [
        { id: box, type: "box", name: "Kvádr 1", size: [10, 20, 5] },
        { id: "k9x2m1q", type: "box", name: "Kvádr 2", size: [4, 4, 4] },
        { id: fil, type: "fillet", name: "Zaoblení 1", radius: 1, edges: [`${target}:e3`] },
      ] as unknown as CadDoc["features"],
    });
    const a = withIds("a1b2c3d", "z9y8x7w");
    const b = withIds("q0w9e8r", "t5y6u7i");
    expect(geometrySig(a)).not.toBe(geometrySig(b)); // shodu výsledků dál určuje otisk s id (přísnější)
    expect(modelRev(b)).toBe(modelRev(a));
    expect(resultId("measure", "k", b).rev).toBe(resultId("measure", "k", a).rev);
    // odkaz na jiný prvek (Kvádr 2 místo Kvádr 1) = jiná revize, i když se id přejmenovala
    expect(modelRev(withIds("a1b2c3d", "z9y8x7w", "k9x2m1q"))).not.toBe(modelRev(a));
    // jiný rozměr = jiná revize
    expect(modelRev({ ...a, features: a.features.map((f, i) => (i === 0 ? ({ ...f, size: [10, 20, 6] } as typeof f) : f)) })).not.toBe(modelRev(a));
    // sestava: jiná náhodná id komponent i prvků dílů, stejné díly a polohy = stejná revize; jiná poloha = jiná
    const s1 = asm("Sestava A", [{ ...comp("c1aaaaa", "Deska A", 0), source: { kind: "part", doc: a } } as AsmComponent, comp("c2bbbbb", "Přidržovač", 30)]);
    const s2 = asm("Sestava A", [{ ...comp("d7zzzzz", "Deska A", 0), source: { kind: "part", doc: b } } as AsmComponent, comp("e8yyyyy", "Přidržovač", 30)]);
    expect(clashSig(s1)).not.toBe(clashSig(s2));
    expect(modelRev(s2)).toBe(modelRev(s1));
    expect(modelRev(asm("Sestava A", [{ ...comp("d7zzzzz", "Deska A", 0), source: { kind: "part", doc: b } } as AsmComponent, comp("e8yyyyy", "Přidržovač", 31)]))).not.toBe(modelRev(s1));
    // pořadí komponent je součást modelu (pozice v kusovníku) – prohozené komponenty = jiná revize
    expect(modelRev(asm("Sestava A", [comp("c2bbbbb", "Přidržovač", 30), { ...comp("c1aaaaa", "Deska A", 0), source: { kind: "part", doc: a } } as AsmComponent]))).not.toBe(modelRev(s1));
  });

  it("otisk sestavy = clashSig: poloha, skrytí i revize dílu ho mění (poloha mechanismu je součást identity)", () => {
    const s = asm("Sestava A", [comp("a", "Deska A", 0), comp("b", "Přidržovač", 30)]);
    expect(geometrySig(s)).toBe(clashSig(s));
    expect(modelRev(asm("Sestava A", [comp("a", "Deska A", 0), comp("b", "Přidržovač", 5)]))).not.toBe(modelRev(s));
    expect(modelRev(asm("Sestava A", [comp("a", "Deska A", 0), comp("b", "Přidržovač", 30, { hidden: true })]))).not.toBe(modelRev(s));
    const edited = asm("Sestava A", [{ ...comp("a", "Deska A", 0), source: { kind: "part", doc: part("Deska A", 30) } } as AsmComponent, comp("b", "Přidržovač", 30)]);
    expect(modelRev(edited)).not.toBe(modelRev(s));
    // jiná aktivní konfigurace dílu v komponentě (polohy stejné) = jiný otisk → výsledek kontroly sestavy neplatí
    const config = asm("Sestava A", [{ ...comp("a", "Deska A", 0), source: { kind: "part", doc: { ...part("Deska A"), activeConfig: "c2" } } } as AsmComponent, comp("b", "Přidržovač", 30)]);
    expect(geometrySig(config)).not.toBe(geometrySig(s));
    expect(clashStateOf({ res: [], sig: clashSig(s) }, clashSig(config))).toBe("stale");
  });

  it("leavesSig z hotových listů = clashSig dokumentu (aplikace otisk z listů bere při každém překreslení)", () => {
    const s = asm("Sestava A", [comp("a", "Deska A", 0, { fixed: true }), comp("b", "Přidržovač", 30, { hidden: true })], [mate(20)]);
    expect(leavesSig(flattenLeaves(s))).toBe(clashSig(s));
    expect(mateSigOf(s, leavesSig(flattenLeaves(s)))).toBe(mateSig(s));
  });

  it("otisk vazeb: hodnota vazby, ukotvení a poloha komponenty mění otisk; název dokumentu ne", () => {
    const s = asm("Sestava A", [comp("a", "Deska A", 0, { fixed: true }), comp("b", "Přidržovač", 30)], [mate(20)]);
    expect(mateSig({ ...s, name: "X" })).toBe(mateSig(s));
    expect(mateSig({ ...s, mates: [mate(25)] })).not.toBe(mateSig(s));
    expect(mateSig({ ...s, components: [comp("a", "Deska A", 0), comp("b", "Přidržovač", 30)] })).not.toBe(mateSig(s));
    expect(mateSig({ ...s, components: [comp("a", "Deska A", 0, { fixed: true }), comp("b", "Přidržovač", 55)] })).not.toBe(mateSig(s));
  });

  it("resultKey (mezipaměť pohybové studie – balík M): jiný dokument, jiná geometrie dílu nebo jiná studie = jiný klíč", () => {
    const s = asm("Sestava A", [comp("a", "Deska A", 0), comp("b", "Přidržovač", 30)]);
    const k = resultKey("motion", "doc-1", s, "studie-1");
    expect(resultKey("motion", "doc-1", s, "studie-1")).toBe(k);
    expect(resultKey("motion", "doc-2", s, "studie-1")).not.toBe(k);
    expect(resultKey("motion", "doc-1", s, "studie-2")).not.toBe(k);
    const shorter = asm("Sestava A", [{ ...comp("a", "Deska A", 0), source: { kind: "part", doc: part("Deska A", 30) } } as AsmComponent, comp("b", "Přidržovač", 30)]);
    expect(resultKey("motion", "doc-1", shorter, "studie-1")).not.toBe(k); // změna geometrie dílu beze změny poloh a vazeb
  });
});

describe("razítko výsledku a jeho stav", () => {
  it("bez razítka = stale (nelze doložit), jiný dokument = unchecked, jiný otisk = stale, shoda = ok", () => {
    const d = part("Deska A");
    const res = { rows: [] };
    expect(resultState(null, { doc: "k", sig: "s" })).toBe("unchecked");
    expect(resultState(res, { doc: "k", sig: geometrySig(d) })).toBe("stale");
    const id = resultId("measure", "k", d, { at: "10:00", line: 3 });
    stampResult(res, id);
    expect(resultIdOf(res)).toMatchObject({ kind: "measure", doc: "k", name: "Deska A", pose: "doc", line: 3, rev: modelRev(d) });
    expect(resultState(res, { doc: "k", sig: geometrySig(d) })).toBe("ok");
    expect(resultState(res, { doc: "jiná záložka", sig: geometrySig(d) })).toBe("unchecked");
    expect(resultState(res, { doc: "k", sig: geometrySig(part("Deska A", 12)) })).toBe("stale");
  });

  it("kolize: žádný záznam = unchecked, záznam bez otisku nebo s jiným otiskem = stale, jinak ok / clash", () => {
    const s = asm("Sestava A", [comp("a", "Deska A", 0), comp("b", "Přidržovač", 30)]);
    const sig = clashSig(s);
    expect(clashStateOf(undefined, sig)).toBe("unchecked");
    expect(clashStateOf({ res: [] }, sig)).toBe("stale");
    expect(clashStateOf({ res: [], sig: "jiný" }, sig)).toBe("stale");
    expect(clashStateOf({ res: [], sig }, sig)).toBe("ok");
    expect(clashStateOf({ res: [{}], sig }, sig)).toBe("clash");
    const ws = new MemoryWorkspace();
    ws.asm.clash.set("A", { res: [], at: "10:00", comps: 2, sig });
    expect(clashState(ws, "A", s)).toBe("ok");
    expect(clashState(ws, "B", s)).toBe("unchecked"); // výsledek sestavy A se na B nepřenese
    expect(clashState(ws, "A", { ...s, components: [comp("a", "Deska A", 0), comp("b", "Přidržovač", 5)] })).toBe("stale");
  });

  it("stav vazeb: platí jen pro sestavu, kterou popisuje; zápis bez razítka se nebere", () => {
    const ws = new MemoryWorkspace();
    const s = asm("Sestava A", [comp("a", "Deska A", 0, { fixed: true }), comp("b", "Přidržovač", 30)], [mate(20)]);
    expect(mateStatusState(ws, "A", s).state).toBe("unchecked");
    setMateStatus(ws, "A", s, { m1: "ok" });
    expect(mateStatusState(ws, "A", s)).toEqual({ status: { m1: "ok" }, state: "ok" });
    expect(mateStatusState(ws, "B", s).state).toBe("unchecked");
    const moved = { ...s, components: [comp("a", "Deska A", 0, { fixed: true }), comp("b", "Přidržovač", 55)] };
    expect(mateStatusState(ws, "A", moved).state).toBe("stale");
    ws.asm.mateStatus.set("C", { m1: "ok" }); // zápis mimo setMateStatus (bez razítka)
    expect(mateStatusState(ws, "C", s).state).toBe("stale");
  });
});

describe("uložené výsledky dokumentu, které neplatí (stale= řádku D, stav)", () => {
  it("měření / porovnání z jiné revize, neplatná kolize a vazby; pořadí pevné; nezkontrolované zastaralé není", () => {
    const ws = new MemoryWorkspace();
    const s = asm("Sestava A", [comp("a", "Deska A", 0, { fixed: true }), comp("b", "Přidržovač", 30)], [mate(20)]);
    expect(staleResults(ws, "A", s)).toEqual([]);
    ws.asm.clash.set("A", { res: [], at: "10:00", comps: 2, sig: clashSig(s) });
    setMateStatus(ws, "A", s, { m1: "ok" });
    noteResult(ws, resultId("measure", "A", s, { line: 4 }));
    noteResult(ws, resultId("compare", "A", s, { line: 5 }));
    expect(staleResults(ws, "A", s)).toEqual([]);
    const moved = { ...s, components: [comp("a", "Deska A", 0, { fixed: true }), comp("b", "Přidržovač", 5)] };
    expect(staleResults(ws, "A", moved)).toEqual(["clash", "mates", "measure", "compare"]);
    expect(staleResults(ws, "B", moved)).toEqual([]); // jiný dokument žádné uložené výsledky nemá
    expect(notedResults(ws, "A").map((x) => x.kind).sort()).toEqual(["compare", "measure"]);
    dropResults(ws, "A", "measure");
    expect(staleResults(ws, "A", moved)).toEqual(["clash", "mates", "compare"]);
    dropResults(ws, "A");
    expect(notedResults(ws, "A")).toEqual([]);
  });

  it("sonda dalšího balíku (pohybová studie): true = motion mezi neplatnými, chyba sondy stav neshodí", () => {
    const ws = new MemoryWorkspace();
    const s = asm("Sestava A", [comp("a", "Deska A", 0), comp("b", "Přidržovač", 30)]);
    registerStaleProbe("motion", (_w, key) => key === "A");
    expect(staleResults(ws, "A", s)).toEqual(["motion"]);
    expect(staleResults(ws, "B", s)).toEqual([]);
    registerStaleProbe("motion", () => {
      throw new Error("x");
    });
    expect(staleResults(ws, "A", s)).toEqual([]);
    registerStaleProbe("motion", () => false);
  });
});
