/**
 * Vlna 22, bod 22g – komponenta je kopie dílu: otisk dílu při vložení, rozlišení „díl se změnil“ × „kopie upravena
 * v sestavě“, ⚠ s příkazem obnovy a JEDNA funkce obnovy (`refreshPlan`) pro text, GUI i balík D2.
 */
import { describe, expect, it } from "vitest";
import { emptyAssembly, partComponent } from "./assembly";
import { copyOrigin, copyState, refreshPlan, staleCopies, staleCopyText } from "./asm-refresh";
import { emptyDoc, type AsmComponent, type CadDoc, type Feature } from "./types";

const box = (h = 20): Feature => ({ id: "b1", name: "Kvádr 1", type: "box", size: [100, 60, h], position: [0, 0, 0], centered: false, mode: "new" });
const part = (name: string, extra: Partial<CadDoc> = {}): CadDoc => ({ ...emptyDoc(name), kind: "part", features: [box()], ...extra });
/** vložení jako `vložit "…"`: kopie dílu + otisk (engine/ops/insert.ts) */
const insert = (p: CadDoc, extra: Partial<AsmComponent> = {}): AsmComponent => partComponent(JSON.parse(JSON.stringify(p)) as CadDoc, { position: [5, 6, 7] }, { origin: copyOrigin(p), ...extra });
const asmOf = (...comps: AsmComponent[]): CadDoc => ({ ...emptyAssembly("Nástroj"), components: comps });

describe("stav kopie dílu – směr změny podle otisku", () => {
  it("číslo a materiál zadané na díl AŽ PO vložení = kopie starší než díl (dřív bez ⚠, kusovník prázdné číslo a „Ocel“)", () => {
    const p0 = part("Deska A");
    const c = insert(p0);
    const p1: CadDoc = { ...p0, materialName: "1.2379", props: { number: "DA-001" } };
    expect(copyState(c, p0)).toEqual({ stale: [], local: [], legacy: false });
    expect(copyState(c, p1)).toEqual({ stale: ["number", "material"], local: [], legacy: false });
    // geometrie a výkres dílu se hlásí také
    const p2: CadDoc = { ...p1, features: [box(25)], drawings: [{ id: "s", name: "List 1" } as never] };
    expect(copyState(c, p2)!.stale).toEqual(["geometry", "number", "material", "drawing"]);
  });
  it("úprava kopie v sestavě (sestava komponenta … materiál, sestava upravit) není „starší než díl“", () => {
    const p0 = part("Přidržovač");
    const c0 = insert(p0);
    const c = { ...c0, source: { kind: "part" as const, doc: { ...(c0.source as { doc: CadDoc }).doc, materialName: "C45" } } };
    expect(copyState(c, p0)).toEqual({ stale: [], local: ["material"], legacy: false });
    const p1 = { ...p0, props: { number: "PR-002" } };
    expect(copyState(c, p1)).toEqual({ stale: ["number"], local: ["material"], legacy: false });
  });
  it("komponenta bez otisku (dřívější dokument): jen vlastnosti, geometrie se neporovnává (id prvků se liší)", () => {
    const c = partComponent(part("Deska A"));
    const p = part("Deska A", { features: [{ ...box(), id: "jiné-id" }], materialName: "1.2379" });
    expect(copyState(c, p)).toEqual({ stale: ["material"], local: [], legacy: true });
  });
  it("díl není otevřený / komponenta není díl → žádný stav (nic se netvrdí)", () => {
    expect(copyState(insert(part("A")), null)).toBeNull();
    const file: AsmComponent = { id: "f", name: "F", source: { kind: "file", fileName: "f.step", format: "step", data: "x" }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } };
    expect(copyState(file, part("F"))).toBeNull();
  });
});

describe("staleCopies + text ⚠ s příkazem obnovy", () => {
  it("jen zastaralé kopie; text uvádí pole a `sestava obnovit #k` (přezdívka, je-li)", () => {
    const pa = part("Deska A");
    const pb = part("Přidržovač");
    const d = asmOf(insert(pa), insert(pb, { alias: "P1" }));
    const tabs: Record<string, CadDoc> = { "Deska A": { ...pa, props: { number: "DA-001" } }, Přidržovač: { ...pb, materialName: "C45" } };
    const st = staleCopies(d, (n) => tabs[n] ?? null);
    expect(st.map((s) => [s.part, s.stale])).toEqual([
      ["Deska A", ["number"]],
      ["Přidržovač", ["material"]],
    ]);
    expect(staleCopyText(st[0])).toBe("komponenta „Deska A“ je starší než díl „Deska A“ v záložce (číslo) – kusovník a výkres ukazují údaje z vložení; obnovit: sestava obnovit #1");
    expect(staleCopyText(st[1])).toMatch(/obnovit: sestava obnovit "P1"$/);
    expect(staleCopies(d, undefined)).toEqual([]);
  });
});

describe("refreshPlan – jedna funkce obnovy", () => {
  it("převezme číslo, materiál a geometrii; poloha, přezdívka, skupina zůstávají; nový otisk = už nic zastaralého", () => {
    const p0 = part("Deska A");
    const c = insert(p0, { alias: "D", group: "Desky", id: "c1" } as Partial<AsmComponent>);
    const p1: CadDoc = { ...p0, materialName: "1.2379", props: { number: "DA-001" }, features: [box(25)] };
    const plan = refreshPlan(asmOf(c), ["c1"], () => p1);
    const n = plan.doc.components![0];
    expect(plan.done).toEqual([{ id: "c1", name: "Deska A", fields: ["geometry", "number", "material"], local: [], geometry: true }]);
    expect(n.placement.position).toEqual([5, 6, 7]);
    expect([n.alias, n.group]).toEqual(["D", "Desky"]);
    expect(n.source.kind === "part" && [n.source.doc.materialName, n.source.doc.props?.number, (n.source.doc.features[0] as { size: number[] }).size[2]]).toEqual(["1.2379", "DA-001", 25]);
    expect(copyState(n, p1)!.stale).toEqual([]);
  });
  it("číslo zadané na komponentě (přepis v sestavě) zůstává; převzaté číslo se obnoví", () => {
    const p0 = part("A", { props: { number: "A-1" } });
    const p1 = { ...p0, props: { number: "A-2" } };
    const inherited = insert(p0, { id: "i", number: "A-1" } as Partial<AsmComponent>);
    const own = insert(p0, { id: "o", number: "VLASTNÍ-9" } as Partial<AsmComponent>);
    const plan = refreshPlan(asmOf(inherited, own), ["i", "o"], () => p1);
    expect(plan.doc.components!.map((c) => c.number)).toEqual(["A-2", "VLASTNÍ-9"]);
    expect(plan.done[1].keptNumber).toBe("VLASTNÍ-9");
  });
  it("jen údaje (`sestava obnovit … údaje`): číslo a materiál, geometrie a výkresy zůstanou a dál se hlásí", () => {
    const p0 = part("A");
    const c = insert(p0, { id: "c" } as Partial<AsmComponent>);
    const p1: CadDoc = { ...p0, materialName: "1.2379", features: [box(30)] };
    const plan = refreshPlan(asmOf(c), ["c"], () => p1, { metaOnly: true });
    const n = plan.doc.components![0];
    expect(plan.done[0]).toMatchObject({ fields: ["material"], geometry: false });
    expect(n.source.kind === "part" && (n.source.doc.features[0] as { size: number[] }).size[2]).toBe(20);
    expect(copyState(n, p1)!.stale).toEqual(["geometry"]);
  });
  it("díl není otevřený, soubor, podsestava → přeskočeno s důvodem (nic se nezmění)", () => {
    const file: AsmComponent = { id: "f", name: "F", source: { kind: "file", fileName: "f.step", format: "step", data: "x" }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } };
    const c = insert(part("A"), { id: "a" } as Partial<AsmComponent>);
    const plan = refreshPlan(asmOf(c, file), ["a", "f"], () => null);
    expect(plan.done).toEqual([]);
    expect(plan.skipped.map((s) => s.why)).toEqual(["díl „A“ není otevřený v záložce", "importovaný soubor – nemá díl v záložce"]);
    expect(plan.doc.components![0]).toBe(c);
  });
});
