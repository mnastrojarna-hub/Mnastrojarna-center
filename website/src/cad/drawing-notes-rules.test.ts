/**
 * Vlna 23 (R1–R7): čistá pravidla poznámek výkresu pro agenty a razítko s technickými údaji – bez jádra.
 * Repro: src/cad/engine/__corpus__/84-w23-notes.txt (parita), w23/greens-notes.test.ts (skutečné jádro), e2e/cad-w23-notes.e2e.cjs.
 */
import { describe, expect, it } from "vitest";
import { classifyNote, freeTextLines, lineCount, linesOf, notesBudgetLine, notesRuleIssues, noteStyle, NOTE_MAX_LINES, stampAgentNotes } from "./drawing-notes-rules";
import { drawTitleBlock, techStripKeys, titleBlockSize } from "./title-block";
import { setLang } from "./i18n";
import { pmiMarksOf, zoneLegendOf } from "./pmi-marks";
import type { DrawingMeta } from "./drawing";
import type { CadDoc, DrawingAnnotation, DrawingDoc } from "./types";

setLang("cs");

const sheet = (id: string, anns: DrawingAnnotation[], meta: Record<string, unknown> = {}, drawing?: string): DrawingDoc => ({ id, name: id, options: {}, meta, annotations: anns, ...(drawing ? { drawing } : {}) });
const text = (t: string, by?: "agent" | "user"): DrawingAnnotation => ({ id: Math.random().toString(36).slice(2), view: "sheet", type: "text", at: [10, 10], text: t, size: 3.5, ...(by ? { by } : {}) });
const doc = (...drawings: DrawingDoc[]): Pick<CadDoc, "drawings"> => ({ drawings });

describe("R1 – údaj razítka v poznámce (classifyNote)", () => {
  it.each([
    ["Kalit 58-60 HRC", { heatTreatment: "Kalit", hardness: "58-60 HRC" }],
    ["1. Kalit a popouštět na 58-60 HRC.", { heatTreatment: "Kalit a popouštět", hardness: "58-60 HRC" }],
    ["Cernit", { surfaceTreatment: "Cernit" }],
    ["Hrany srazit 0,5x45", { edges: "srazit 0,5x45" }],
    ["ISO 2768-mK", { tolerance: "ISO 2768-mK" }],
    ["Nepředepsané tolerance ISO 2768-mK", { tolerance: "ISO 2768-mK" }],
    ["Ra 3,2", { roughness: "Ra 3,2" }],
    ["Materiál 1.2379", { material: "1.2379" }],
    ["Harden 58 HRC", { heatTreatment: "Harden", hardness: "58 HRC" }],
    ["Brüniert", { surfaceTreatment: "Brüniert" }],
  ])("„%s“ → pole razítka", (t, want) => {
    const c = classifyNote(t)!;
    expect(c).not.toBeNull();
    expect(c.mixed).toBe(false);
    expect(Object.fromEntries(c.parts.map((p) => [p.key, p.value]))).toEqual(want);
  });
  it.each(["Brousit", "Odmastit", "Konzervovat", "Balit", "Označit číslem výkresu", "≈ rozměry odhadem – ověřit"])("„%s“ není údaj razítka", (t) => {
    expect(classifyNote(t)).toBeNull();
  });
  it.each([
    "Tepelně zpracovat kalit a popustit na tvrdost 58 až 60 HRC podle předpisu výrobce oceli",
    "3. Povrchová úprava černění dle normy, vrstva rovnoměrná bez skvrn.",
    "4. Nepředepsané tolerance ISO 2768-mK, pokud není uvedeno jinak.",
    "7. Díl po kalení brousit na rovinnost 0,01 mm na celé ploše.",
  ])("smíšený text „%s“ se nepřesune (mixed)", (t) => {
    const c = classifyNote(t)!;
    expect(c.parts.length).toBeGreaterThan(0);
    expect(c.mixed).toBe(true);
  });
});

describe("R4 – heslovitý řádek (noteStyle)", () => {
  it.each(["Brousit", "Odmastit, konzervovat", "≈ rozměry odhadem – ověřit", "1. Označit číslem výkresu"])("„%s“ projde", (t) => expect(noteStyle(t)).toBeNull());
  it.each([
    ["Při jakékoli nejasnosti kontaktujte konstruktéra před výrobou.", /znaků|slov|věta|slovo/],
    ["Díl odmastit a pak zabalit do VCI fólie a dát", /slov/],
    ["Díl odmastit. Zabalit.", /vět/],
    ["Pokud není uvedeno jinak", /slovo věty/],
    ["Please contact the designer", /slovo věty/],
    ["a, b, c, d", /čárky/],
    ["x".repeat(61), /61 znaků/],
  ])("„%s“ neprojde", (t, re) => expect(noteStyle(t as string)).toMatch(re as RegExp));
  it("dlouhý řádek se počítá jako víc řádků – zalomení limit neobejde", () => {
    expect(lineCount("a".repeat(60))).toBe(1);
    expect(lineCount("a".repeat(121))).toBe(3);
    expect(lineCount("A\nB\n\nC")).toBe(3);
  });
});

describe("R4/R5 – volný text celého výkresu (všechny listy sady)", () => {
  it("text na listu 1 i 2, poznámka u razítka, poznámka bez cíle; odkazy na geometrii se nepočítají", () => {
    const d = doc(
      sheet("s1", [text("A", "agent"), text("B", "agent"), { id: "n", view: "front", type: "note", at: [1, 1], leader: [0, 0], text: "Lapovat", by: "agent" }, { id: "f", view: "sheet", type: "note", at: [1, 1], leader: [0, 0], text: "Volný", free: true, by: "agent" }], { note: "Odmastit", noteBy: "agent" }),
      sheet("s2", [text("C", "agent")]),
    );
    const items = freeTextLines(d, [0, 1]);
    expect(items.map((x) => x.text)).toEqual(["Odmastit", "A", "B", "Volný", "C"]);
    expect(linesOf(items)).toBe(5);
    expect(notesRuleIssues(d, [0, 1]).filter((f) => f.code === "drawing.notes-limit")).toEqual([]);
    // text na listu 2 = R5 (poznámky mimo list 1)
    expect(notesRuleIssues(d, [0, 1]).find((f) => f.code === "drawing.notes-sheet")?.level).toBe("warn");
    const d6 = doc(...d.drawings!.slice(0, 1), sheet("s2", [text("C", "agent"), text("D", "agent")]));
    const lim = notesRuleIssues(d6, [0, 1]).find((f) => f.code === "drawing.notes-limit")!;
    expect(lim.level).toBe("warn");
    expect(lim.data).toMatchObject({ lines: 6, max: NOTE_MAX_LINES, agent: 6 });
  });
  it("ruční text (GUI / starší dokument) = jen ℹ rada, ne ⚠ (R6)", () => {
    const d = doc(sheet("s1", Array.from({ length: 8 }, (_, i) => text(`Ruční poznámka ${i + 1} pokud není uvedeno jinak.`, "user"))));
    const f = notesRuleIssues(d, [0]);
    expect(f.length).toBeGreaterThan(0);
    expect(f.every((x) => x.level === "note")).toBe(true);
    // bez razítka původu (starší dokument) = ručně
    const legacy = doc(sheet("s1", Array.from({ length: 8 }, (_, i) => text(`Text ${i}`))));
    expect(notesRuleIssues(legacy, [0]).every((x) => x.level === "note")).toBe(true);
  });
  it("JSON dokument z textové cesty: poznámky bez razítka dostanou by=agent", () => {
    const d = stampAgentNotes(doc(sheet("s1", [text("A"), text("B", "user")], { note: "N" })));
    expect(d.drawings![0].annotations.map((a) => a.by)).toEqual(["agent", "user"]);
    expect((d.drawings![0].meta as { noteBy?: string }).noteBy).toBe("agent");
  });
  it("legenda oblastních úprav se počítá do limitu; stav to vypíše", () => {
    const d = doc(sheet("s1", [text("A", "agent")]));
    expect(notesBudgetLine(d, [0], { legend: ["Z1 tepelná: 58+2 HRC"] })).toBe("Poznámky nad razítkem: 2/5 řádků (agent 1, generátor 1)");
  });
});

describe("R1 – razítko: technická pole vždy v buňkách, ne v patičce", () => {
  const meta = (m: Partial<DrawingMeta>): DrawingMeta => ({ name: "Deska", material: "1.2379", ...m });
  const draw = (m: DrawingMeta) => drawTitleBlock({ W: 420, H: 297, margin: 10, ctx: { sheet: "A3", scaleLabel: "1:1", projection: "E" }, meta: m, polys: [], texts: [], above: 0 });
  it("ISO 7200 s technickými údaji dostane technický pás (+10 mm), patička je nemá", () => {
    const m = meta({ heatTreatment: "Kalit a popustit", hardness: "58-60 HRC", surfaceTreatment: "Černit", edges: "ISO 13715 -0,3", tolerance: "ISO 2768-mK", roughness: "Ra 3,2" });
    expect(titleBlockSize(m)).toEqual({ w: 180, h: 48 });
    expect(techStripKeys(m)).toEqual(["heatTreatment", "hardness", "surfaceTreatment", "edges", "tolerance", "roughness"]);
    const info = draw(m);
    for (const k of ["heatTreatment", "hardness", "surfaceTreatment", "edges", "tolerance", "roughness"]) expect(info.fields.find((f) => f.key === k)?.where, k).toBe("cell");
    expect(info.footer.join(" ")).not.toMatch(/Tepelné|Tvrdost|Povrch|Hrany|Nepředepsané|drsnost|HRC/);
  });
  it("bez technických údajů zůstává ISO 7200 180×38 (beze změny)", () => {
    expect(titleBlockSize(meta({}))).toEqual({ w: 180, h: 38 });
  });
  it("nástrojářská šablona má buňky tvrdost a obecná drsnost", () => {
    const info = draw(meta({ template: "toolmaker", hardness: "58 HRC", roughness: "Ra 1,6" }));
    expect(titleBlockSize({ template: "toolmaker", hardness: "58 HRC" })).toEqual({ w: 180, h: 64 });
    expect(info.fields.find((f) => f.key === "hardness")?.where).toBe("cell");
    expect(info.fields.find((f) => f.key === "roughness")?.where).toBe("cell");
  });
});

describe("R2/R3 – popisy a úpravy z modelu", () => {
  it("úpravy dostanou značky Z1, Z2; stejný předpis = jeden řádek vysvětlivky", () => {
    const d = { kind: "part" as const, functional: [
      { id: "f1", kind: "note" as const, face: { index: 1 }, text: "Brousit" },
      { id: "f2", kind: "treatment" as const, face: { index: 2 }, text: "58+2 HRC", what: "heat" as const, from: 10, to: 40 },
      { id: "f3", kind: "treatment" as const, face: { index: 4 }, text: "58+2 HRC", what: "heat" as const },
      { id: "f4", kind: "functional" as const, face: { index: 3 } },
    ] };
    const pmi = pmiMarksOf(d);
    expect(pmi.map((m) => `${m.kind}:${m.ref ?? ""}:${m.face}`)).toEqual(["note::1", "treatment:Z1:2", "treatment:Z2:4"]);
    expect(zoneLegendOf(pmi)).toEqual(["Z1, Z2 tepelná: 58+2 HRC"]);
  });
});
