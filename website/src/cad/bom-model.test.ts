/**
 * Vlna 22, body 19 a 22g – model kusovníku (bom-model.ts): druh položky (vyráběný / normálie / nakupovaný) a jeho výchozí
 * hodnoty, materiál řádku (jedna funkce pro text, CLI i aplikaci), přeložená třída materiálu, desetinný oddělovač CSV podle
 * jazyka, oddíly a sloupce normy / rozměru / třídy / katalogu, úplnost dokumentace vyráběných dílů a označení z knihovny.
 */
import { afterEach, describe, expect, it } from "vitest";
import { bomCsv, computeBom, emptyAssembly, partComponent, screwISO4762, dowelISO8734 } from "./assembly";
import { bomCsvText, bomNotes, bomPartInfo, csvCaption, csvNum, docSupply, docSupplyLine, isStrengthClass, makeIncomplete, materialClassLabel, parseSupplyTokens, stdParts, supplyKindOf, supplyOf } from "./bom-model";
import { setLang } from "./i18n";
import { familyById, librarySupply, makeStandard, makeFromText } from "./library";
import { emptyDoc, type AsmComponent, type BuildResult, type CadDoc, type Feature } from "./types";

const box: Feature = { id: "b", name: "Kvádr 1", type: "box", size: [10, 10, 10], position: [0, 0, 0], centered: false, mode: "new" };
const part = (name: string, extra: Partial<CadDoc> = {}): CadDoc => ({ ...emptyDoc(name), kind: "part", features: [box], ...extra });
const built = (volume: number): BuildResult => ({ status: [], mesh: null, metrics: { volume, area: 0, bbox: [[0, 0, 0], [1, 1, 1]], faces: 6, edges: 12 }, ms: 0 });

afterEach(() => setLang("cs"));

describe("druh položky – výchozí podle původu, díl, komponenta (bod 19)", () => {
  it("vlastní díl = vyráběný, soubor STEP = nakupovaný, díl jen z importu = nakupovaný, normálie = normálie", () => {
    expect(supplyOf(partComponent(part("Deska A")))).toMatchObject({ kind: "make", explicit: false, why: "own" });
    const file: AsmComponent = { id: "f", name: "Válec", source: { kind: "file", fileName: "valec.step", format: "step", data: "x" }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } };
    expect(supplyOf(file)).toMatchObject({ kind: "buy", why: "file" });
    const imported = part("Ložisko", { features: [{ id: "i", name: "Import", type: "import", fileName: "l.step", format: "step", data: "" } as Feature] });
    expect(supplyOf(partComponent(imported))).toMatchObject({ kind: "buy", why: "import" });
    // generátor normálie (assembly.ts) nese druh výslovně; starší dokument bez druhu: skupina Normálie nebo číslo podle normy
    expect(supplyOf(partComponent(screwISO4762("M12", 40)))).toMatchObject({ kind: "standard", explicit: true });
    expect(supplyOf(partComponent(part("Šroub"), {}, { group: "Normálie" }))).toMatchObject({ kind: "standard", why: "library" });
    expect(supplyOf(partComponent(part("Šroub"), {}, { number: "DIN 912 – M8×20 – 8.8" }))).toMatchObject({ kind: "standard", standard: "DIN 912", size: "M8×20", grade: "8.8" });
  });
  it("druh na dílu (zdroj) a přepis na komponentě; komponenta vyhrává", () => {
    const p = part("Pouzdro", { supply: { kind: "buy", catalog: "SFJ8-30", vendor: "Katalog A" } });
    expect(supplyOf(partComponent(p))).toMatchObject({ kind: "buy", explicit: true, why: "part", catalog: "SFJ8-30", vendor: "Katalog A" });
    expect(supplyOf(partComponent(p, {}, { supply: { kind: "make" } }))).toMatchObject({ kind: "make", why: "component", catalog: "SFJ8-30" });
    expect(supplyOf(partComponent(p, {}, { supply: { catalog: "X-1" } }))).toMatchObject({ kind: "buy", why: "part", catalog: "X-1" });
  });
  it("slova druhu CS / EN / DE a auto", () => {
    for (const [w, k] of [["vyráběný", "make"], ["make", "make"], ["Fertigung", "make"], ["normálie", "standard"], ["standard", "standard"], ["Normteil", "standard"], ["nakupovaný", "buy"], ["buy", "buy"], ["Kaufteil", "buy"], ["auto", "auto"], ["výchozí", "auto"]] as const) expect(supplyKindOf(w), w).toBe(k);
    expect(supplyKindOf("cokoli")).toBeNull();
    expect(parseSupplyTokens(["nakupovaný", "katalog", "SFJ8-30", "výrobce", "Katalog A"])).toEqual({ kind: "buy", catalog: "SFJ8-30", vendor: "Katalog A" });
    expect(parseSupplyTokens(["auto"])).toEqual({});
    expect(() => parseSupplyTokens(["levný"])).toThrow(/druh: čekám vyráběný \| normálie \| nakupovaný \| auto, ne „levný“/);
    expect(() => parseSupplyTokens(["buy", "barva", "x"])).toThrow(/neznámá volba „barva“/);
  });
  it("označení normálie: norma · rozměr · třída / tolerance (kolík si drží m6)", () => {
    expect(stdParts("ISO 4762 – M12×40 – 12.9")).toEqual({ standard: "ISO 4762", size: "M12×40", grade: "12.9" });
    expect(stdParts("ISO 8734 – 8×30 – m6")).toEqual({ standard: "ISO 8734", size: "8×30", grade: "m6" });
    expect(stdParts("Pružina tlačná D20 d2 L0=50")).toEqual({ size: "Pružina tlačná D20 d2 L0=50" });
    expect(isStrengthClass("12.9")).toBe(true);
    expect(isStrengthClass("A2-70")).toBe(true);
    expect(isStrengthClass("200 HV")).toBe(true);
    expect(isStrengthClass("m6")).toBe(false);
  });
});

describe("knihovna normálií – druh a celé označení (bod 19)", () => {
  it("kolík ISO 8734 z textu: číslo = celé označení s m6, druh normálie; dřív „ISO 8734 – 8×30“ bez tolerance", () => {
    const made = makeFromText("kolík 8x30")!;
    expect(made.doc.props?.number).toBe("ISO 8734 – 8×30 – m6");
    expect(made.doc.supply?.kind).toBe("standard");
    const c = partComponent(made.doc, {}, { group: "Normálie", number: made.doc.props?.number });
    expect(supplyOf(c)).toMatchObject({ standard: "ISO 8734", size: "8×30", grade: "m6" });
  });
  it("skupiny knihovny: lineární technika = nakupovaný s katalogem, ozubení = vyráběný, šrouby = normálie", () => {
    const lin = familyById("hgr")!;
    expect(lin.group).toBe("Lineární technika");
    expect(librarySupply(lin)).toBe("buy");
    const rail = makeStandard(lin, { ...Object.fromEntries(lin.params.map((p) => [p.key, p.default])) });
    expect(rail.supply).toMatchObject({ kind: "buy", catalog: rail.props?.number });
    const screw = familyById("iso4762")!;
    expect(librarySupply(screw)).toBe("standard");
    const m8 = makeStandard(screw, { size: "M8", l: 30, grade: "12.9" });
    expect(m8.supply?.kind).toBe("standard");
    expect(bomPartInfo(partComponent(m8), null).material).toBe("12.9");
  });
});

describe("materiál řádku – jedna funkce (bod 22g + 19)", () => {
  it("vyráběný díl: označení materiálu; bez označení „— (třída Ocel)“ + příznak; ocel 1.2311 je sama označením", () => {
    expect(bomPartInfo(partComponent(part("A", { materialName: "1.2379" })), built(120000))).toEqual({ material: "1.2379", massKg: expect.closeTo(0.942, 3) });
    expect(bomPartInfo(partComponent(part("A")), null)).toEqual({ material: "— (třída Ocel)", massKg: undefined, noDesignation: true });
    expect(bomPartInfo(partComponent(part("A", { material: "1.2311" })), null).material).toBe("1.2311 (40CrMnMo7)");
  });
  it("normálie: pevnostní třída (12.9), kolík bez třídy „dle normy“ – nikdy obecné „Ocel“", () => {
    expect(bomPartInfo(partComponent(screwISO4762("M12", 40)), null).material).toBe("12.9");
    expect(bomPartInfo(partComponent(makeFromText("kolík 8x30")!.doc), null).material).toBe("dle normy");
    // dowelISO8734 z generátoru sestav nese typ A (ne pevnostní třídu)
    expect(bomPartInfo(partComponent(dowelISO8734(8, 30)), null).material).toBe("dle normy");
  });
  it("nakupovaný díl bez označení: třída materiálu (bez ⚠)", () => {
    const r = bomPartInfo(partComponent(part("P", { supply: { kind: "buy" } })), null);
    expect(r).toEqual({ material: "Ocel", massKg: undefined });
  });
  it("EN / DE: třída materiálu přeložená v okamžiku volání (dřív české „Ocel“ i v angličtině)", () => {
    setLang("en");
    expect(materialClassLabel("ocel")).toBe("Steel");
    expect(bomPartInfo(partComponent(part("A")), null).material).toBe("— (class Steel)");
    setLang("de");
    expect(materialClassLabel("hlinik")).toBe("Aluminium");
    expect(bomPartInfo(partComponent(part("A")), null).material).toBe("— (Klasse Stahl)");
  });
});

describe("CSV – oddíly, sloupce, desetinný oddělovač podle jazyka (bod 19 + 22g)", () => {
  const asm = (): CadDoc => ({
    ...emptyAssembly("Nástroj"),
    components: [
      partComponent(screwISO4762("M12", 40), {}, { id: "s", group: "Normálie" } as never),
      partComponent(part("Deska A", { materialName: "1.2379", props: { number: "DA-001" } }), {}, { id: "a" } as never),
      partComponent(part("Pouzdro", { supply: { kind: "buy", catalog: "SFJ8-30", vendor: "Katalog A" } }), {}, { id: "p" } as never),
      partComponent(part("Přidržovač"), {}, { id: "r" } as never),
    ],
  });
  const info = (c: AsmComponent) => bomPartInfo(c, built(20000)); // 20 cm³ oceli = 0,157 kg
  it("řádky v oddílech vyráběné → normálie → nakupované; druh, norma, rozměr, třída, katalog, výrobce", () => {
    const rows = computeBom(asm(), info);
    expect(rows.map((r) => [r.pos, r.name, r.kind])).toEqual([
      [1, "Deska A", "make"],
      [2, "Přidržovač", "make"],
      [3, "Šroub M12×40", "standard"],
      [4, "Pouzdro", "buy"],
    ]);
    const csv = bomCsv(rows).replace(/^﻿/, "").split("\r\n");
    expect(csv[0]).toBe("Pozice;Název;Číslo výkresu / norma;Ks;Materiál;Hmotnost 1 ks [kg];Hmotnost celkem [kg];Druh;Norma;Rozměr;Třída / tolerance;Katalogové číslo;Výrobce;Skupina");
    expect(csv[1]).toBe("1;Deska A;DA-001;1;1.2379;0,157;0,157;vyráběný;;;;;;");
    expect(csv[2]).toBe("2;Přidržovač;;1;— (třída Ocel);0,157;0,157;vyráběný;;;;;;");
    expect(csv[3]).toBe("3;Šroub M12×40;ISO 4762 – M12×40 – 12.9;1;12.9;0,157;0,157;normálie;ISO 4762;M12×40;12.9;;;Normálie");
    expect(csv[4]).toBe("4;Pouzdro;;1;Ocel;0,157;0,157;nakupovaný;;;;SFJ8-30;Katalog A;");
  });
  it("EN: tečka, anglická třída a hlavička; DE: čárka, „Stahl“", () => {
    setLang("en");
    const rows = computeBom(asm(), info);
    const en = bomCsv(rows).split("\r\n");
    expect(en[2]).toBe("2;Přidržovač;;1;— (class Steel);0.157;0.157;manufactured;;;;;;");
    expect(csvNum(1.5)).toBe("1.500");
    expect(csvCaption()).toBe("CSV (separator ;, decimal point):");
    setLang("de");
    const de = bomCsv(computeBom(asm(), info)).split("\r\n");
    expect(de[2]).toBe("2;Přidržovač;;1;— (Klasse Stahl);0,157;0,157;Fertigungsteil;;;;;;");
  });
  it("kusovník výkresu (BomItem) má týž zapisovač; poznámka jako poslední sloupec jen když je", () => {
    const csv = bomCsvText([{ pos: 1, name: "Hřídel", qty: 2, material: "C45", massKg: 0.25, note: "kalit" }]).split("\r\n");
    expect(csv[0].endsWith(";Skupina;Poznámka")).toBe(true);
    expect(csv[1]).toBe("1;Hřídel;;2;C45;0,250;0,500;;;;;;;;kalit");
  });
});

describe("upozornění a úplnost dokumentace (bod 19)", () => {
  it("vyráběné bez čísla / bez označení materiálu; normálie a nakupované se nehodnotí", () => {
    const rows = computeBom({ ...emptyAssembly("N"), components: [partComponent(part("A")), partComponent(screwISO4762("M8", 20)), partComponent(part("B", { props: { number: "B-1" }, materialName: "C45" }))] }, (c) => bomPartInfo(c, null));
    expect(bomNotes(rows)).toEqual({ noNumber: ["A"], noMaterial: ["A"] });
  });
  it("dokumentace: vyráběné s výkresem / bez výkresu, normálie, nakupované; každý zdroj jednou", () => {
    const withDrawing = part("Deska A", { props: { number: "DA-001" }, drawings: [{ id: "s1", name: "List 1" } as never] });
    const holder = part("Přidržovač");
    const d: CadDoc = { ...emptyAssembly("N"), components: [partComponent(withDrawing), partComponent(holder), partComponent(holder), partComponent(screwISO4762("M8", 20)), partComponent(part("P", { supply: { kind: "buy" } }))] };
    const s = docSupply(d, (c) => (c.source.kind === "part" ? c.source.doc.name : c.name));
    expect(s.make.map((m) => [m.name, m.drawing, m.comps])).toEqual([
      ["Deska A", true, 1],
      ["Přidržovač", false, 2],
    ]);
    expect([s.standard, s.buy]).toEqual([1, 1]);
    expect(docSupplyLine(s)).toBe("vyráběné 2 (bez výkresu 1), normálie 1, nakupované 1");
    expect(makeIncomplete(s)).toEqual(["Přidržovač (bez výkresu, bez čísla)"]);
  });
});
