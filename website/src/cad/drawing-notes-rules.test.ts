/**
 * Vlna 23 (R1–R7): čistá pravidla poznámek výkresu pro agenty a razítko s technickými údaji – bez jádra.
 * Repro: src/cad/engine/__corpus__/84-w23-notes.txt (parita), w23/greens-notes.test.ts (skutečné jádro), e2e/cad-w23-notes.e2e.cjs.
 */
import { describe, expect, it } from "vitest";
import { auditDoc, auditItems, classifyNote, metaBy, freeTextLines, lineCount, linesOf, mainSheet, newAgentFindings, notesBudgetLine, notesRuleIssues, noteStyle, NOTE_MAX_LINES, stampAgentNotes, stampOrigin, TITLE_VALUE_MAX, titleHint } from "./drawing-notes-rules";
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
    // věta jako hodnota buňky razítka (> TITLE_VALUE_MAX znaků) se do razítka nepřesune – agent ji musí zkrátit
    "2. Nekótované hrany sražení 0,5x45 stupňů, ostré hrany zbavit otřepů.",
  ])("smíšený text „%s“ se nepřesune (mixed)", (t) => {
    const c = classifyNote(t)!;
    expect(c.parts.length).toBeGreaterThan(0);
    expect(c.mixed).toBe(true);
  });
  it("rada k dlouhé hodnotě buňky nepíše větu do razítka", () => {
    const c = classifyNote("2. Nekótované hrany sražení 0,5x45 stupňů, ostré hrany zbavit otřepů.")!;
    expect(c.parts.some((p) => p.value.length > TITLE_VALUE_MAX)).toBe(true);
    expect(titleHint(c.parts)).toBe('výkres razítko hrany="…"');
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

describe("R4/R5 – volný text celého dokumentu (všechny výkresy a listy)", () => {
  it("text na listu 1 i 2, poznámka u razítka, poznámka bez cíle; odkazy na geometrii se nepočítají", () => {
    const d = doc(
      sheet("s1", [text("A", "agent"), text("B", "agent"), { id: "n", view: "front", type: "note", at: [1, 1], leader: [0, 0], text: "Lapovat", by: "agent" }, { id: "f", view: "sheet", type: "note", at: [1, 1], leader: [0, 0], text: "Volný", free: true, by: "agent" }], { note: "Odmastit", noteBy: "agent" }),
      sheet("s2", [text("C", "agent")]),
    );
    const items = freeTextLines(d, [0, 1]);
    expect(items.map((x) => x.text)).toEqual(["Odmastit", "A", "B", "Volný", "C"]);
    expect(linesOf(items)).toBe(5);
    expect(notesRuleIssues(d, [0, 1]).filter((f) => f.code === "drawing.notes-limit")).toEqual([]);
    // text agenta na listu 2 = R5 (poznámky mimo hlavní list) – ✗ (agent)
    expect(notesRuleIssues(d, [0, 1]).find((f) => f.code === "drawing.notes-sheet")?.level).toBe("error");
    const d6 = doc(...d.drawings!.slice(0, 1), sheet("s2", [text("C", "agent"), text("D", "agent")]));
    const lim = notesRuleIssues(d6, [0, 1]).find((f) => f.code === "drawing.notes-limit")!;
    expect(lim.level).toBe("error");
    // počet řádků je pod `count` – `lines` nesou v protokolu čísla řádků skriptu (engine/drawing-track.ts)
    expect(lim.data).toMatchObject({ count: 6, max: NOTE_MAX_LINES, agent: 6 });
    expect(lim.data).not.toHaveProperty("lines");
  });
  it("druhý výkres téhož dílu má společný limit; text na něm = mimo hlavní list", () => {
    const d = doc(sheet("s1", [text("A", "agent"), text("B", "agent"), text("C", "agent")]), sheet("p1", [text("D", "agent"), text("E", "agent"), text("F", "agent")], {}, "Poznámky"));
    const f = notesRuleIssues(d);
    expect(f.find((x) => x.code === "drawing.notes-limit")?.level).toBe("error");
    // 3 texty mimo hlavní list + kolo 3 (D4): výkres s názvem „Poznámky“ sám o sobě
    expect(f.filter((x) => x.code === "drawing.notes-sheet")).toHaveLength(4);
    expect(f.filter((x) => x.code === "drawing.notes-sheet" && x.text.includes("výkres poznámek"))).toHaveLength(1);
  });
  it("hlavní list = první list s pravoúhlým pohledem a kótami (list jen s izometrií a poznámkami jím není)", () => {
    const iso = { views: { front: false, top: false, left: false, iso: true } };
    const dim = { id: "k", view: "front", type: "dim" as const, kind: "horizontal" as const, a: [0, 0] as [number, number], b: [10, 0] as [number, number], offset: 10 };
    const d = doc({ ...sheet("s1", [text("A", "agent")]), options: iso }, { ...sheet("s2", [dim]), options: { views: { front: true, top: true } } });
    expect(mainSheet(d)).toBe(1);
    expect(notesRuleIssues(d).find((x) => x.code === "drawing.notes-sheet")?.level).toBe("error");
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
  it("dokument z textové cesty: vše je od agenta – i když JSON tvrdí by=user (R6: rozhoduje cesta)", () => {
    const d = stampAgentNotes({ ...doc(sheet("s1", [text("A"), text("B", "user")], { note: "N", noteBy: "user", name: "Deska", by: { name: "user" }, revisions: [{ rev: "A", date: "", note: "x", by: "user" }] })), functional: [{ id: "f1", kind: "note" as const, face: { index: 1 }, text: "Brousit", by: "user" as const }] });
    expect(d.drawings![0].annotations.map((a) => a.by)).toEqual(["agent", "agent"]);
    const m = d.drawings![0].meta as { noteBy?: string; by?: Record<string, string>; revisions?: { by?: string }[] };
    expect(m.noteBy).toBe("agent");
    expect(m.by?.name).toBe("agent");
    expect(m.revisions?.[0].by).toBe("agent");
    expect(d.functional?.[0].by).toBe("agent");
  });
  it("stampOrigin: nová / textově změněná položka dostane původ, nezměněná si ho nechá", () => {
    const s0 = sheet("s1", [text("A", "agent"), text("B", "agent")], { name: "Deska", by: { name: "agent" } });
    const s1 = stampOrigin(s0, { ...s0, annotations: [s0.annotations[0], { ...s0.annotations[1], text: "B2" } as DrawingAnnotation, text("C")], meta: { ...s0.meta, customer: "ACME" } }, "user");
    expect(s1.annotations.map((a) => a.by)).toEqual(["agent", "user", "user"]);
    // buňka bez razítka původu = ručně (GUI); buňka agenta zůstane agentova, dokud ji člověk nezmění
    expect(metaBy(s1.meta, "customer")).toBe("user");
    expect(metaBy(s1.meta, "name")).toBe("agent");
    expect(metaBy(stampOrigin(s1, { ...s1, meta: { ...s1.meta, name: "Deska 2" } }, "user").meta, "name")).toBe("user");
  });
  it("legenda oblastních úprav se počítá do limitu (původ = původ úpravy); stav to vypíše", () => {
    const d = doc(sheet("s1", [text("A", "agent")]));
    expect(notesBudgetLine(d, [0], { legend: [{ text: "Z1 tepelná: 58+2 HRC", by: "agent" }] })).toBe("Poznámky nad razítkem: 2/5 řádků (agent 2) · místní popisy 0/8");
  });
  it("příkaz zastaví jen nález u položky, kterou zapsal nebo změnil (newAgentFindings)", () => {
    const d0 = doc(sheet("s1", [text("Odmastit", "agent")]));
    const d1 = doc(sheet("s1", [...d0.drawings![0].annotations, text("Tuto plochu je nutné vždy pečlivě odmastit.", "agent")]));
    const f = newAgentFindings(auditDoc(d0), auditDoc(d1), auditItems(d0), auditItems(d1));
    expect(f.map((x) => x.code)).toEqual(["drawing.note-style"]);
    // stejný (už porušený) text bez změny příkaz nezastaví
    expect(newAgentFindings(auditDoc(d1), auditDoc(d1), auditItems(d1), auditItems(d1))).toEqual([]);
  });
});

describe("R1/R4 – ostatní kanály textu (kóty, popisy, značky, buňky razítka, revize)", () => {
  const dim = (x: Record<string, unknown>) => ({ id: "k", view: "front", type: "dim" as const, kind: "horizontal" as const, a: [0, 0] as [number, number], b: [10, 0] as [number, number], offset: 10, by: "agent" as const, ...x }) as DrawingAnnotation;
  it.each([
    [dim({ text: "Kalit a popustit na 58-60 HRC, ostré hrany srazit" }), "drawing.note-style"],
    [dim({ suffix: "58 HRC" }), "drawing.note-title-data"],
    [{ id: "r", view: "front", type: "roughness", at: [0, 0], ra: "Ra 3,2 kalit na 58 HRC a černit", by: "agent" } as DrawingAnnotation, "drawing.note-style"],
    [{ id: "g", view: "front", type: "gdt", at: [0, 0], symbol: "flat", value: "Povrch černit, pokud není", by: "agent" } as DrawingAnnotation, "drawing.note-style"],
    [{ id: "c", view: "front", type: "callout", tip: [0, 0], at: [1, 1], lines: ["Ø9 skrz"], tol: "kalit 58-60 HRC, hrany srazit 0,5x45", by: "agent" } as DrawingAnnotation, "drawing.note-style"],
  ])("značka %# → %s", (a, code) => {
    expect(auditDoc(doc(sheet("s1", [a]))).map((f) => f.code)).toContain(code);
  });
  it.each([
    [{ name: "Deska, kterou je nutné kalit" }, "drawing.note-style"],
    [{ name: "Deska kalená 58 HRC" }, "drawing.note-title-data"],
    [{ surfaceTreatment: "Černění dle normy, vrstva rovnoměrná bez skvrn" }, "drawing.note-style"],
    [{ revisions: [{ rev: "A", date: "", note: "Při jakékoli nejasnosti kontaktujte konstruktéra" }] }, "drawing.note-style"],
    [{ revisions: [{ rev: "A", date: "", note: "Kalit 58 HRC" }] }, "drawing.note-title-data"],
  ])("razítko / revize %# → %s", (m, code) => {
    expect(auditDoc(doc(sheet("s1", [], m as Record<string, unknown>))).map((f) => f.code)).toContain(code);
  });
  it("krátké technické údaje projdou: kóta „H7“, popis „4× M6 - 6H ↧12“, revize „Ø20 → Ø22“, název „Deska upínací“", () => {
    const d = doc(sheet("s1", [dim({ suffix: "H7" }), { id: "c", view: "front", type: "callout", tip: [0, 0], at: [1, 1], lines: ["4× M6 - 6H ↧12", "0,5×45°"] } as DrawingAnnotation], { name: "Deska upínací", revisions: [{ rev: "A", date: "", note: "Ø20 → Ø22" }] }));
    expect(auditDoc(d)).toEqual([]);
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

describe("R2/R3 – převod dokumentu na skript (doc → script) nese popisy a úpravy modelu", () => {
  it("poznámka F2 / úprava F3 … od … do … se zapíšou a přečtou jako příkazy modelu", async () => {
    const { docToScript } = await import("./doc-script");
    const { parseAgentText } = await import("./agent");
    const doc = { app: "mnastrojarna-cad", version: 2, name: "Deska", material: "ocel", features: [{ id: "b", name: "Kvádr 1", type: "box", size: [100, 60, 12], position: [0, 0, 0], centered: false, mode: "new" }], functional: [
      { id: "f1", kind: "note", face: { index: 1 }, text: "Brousit" },
      { id: "f2", kind: "treatment", face: { index: 2 }, text: "62+2 HRC", what: "heat", from: 10, to: 40 },
    ] } as unknown as CadDoc;
    const s = docToScript(doc).text;
    expect(s).toMatch(/^poznámka F2 "Brousit"$/m);
    expect(s).toMatch(/^úprava F3 tepelná "62\+2 HRC" od 10 do 40$/m);
    const ops = parseAgentText('poznámka F2 "Brousit"\núprava F3 tepelná "62+2 HRC" od 10 do 40').ops as unknown as { k: string; cmd: Record<string, unknown> }[];
    expect(ops.map((o) => o.cmd)).toEqual([{ kind: "note", face: 1, text: "Brousit" }, { kind: "treatment", face: 2, what: "heat", text: "62+2 HRC", from: 10, to: 40 }]);
  });
  it("ruční poznámka u razítka, která pravidlům agenta nevyhoví, se do skriptu nezapíše jako řádek, který by selhal", async () => {
    const { docToScript } = await import("./doc-script");
    const doc = { app: "mnastrojarna-cad", version: 2, name: "Deska", material: "ocel", features: [{ id: "b", name: "Kvádr 1", type: "box", size: [100, 60, 12], position: [0, 0, 0], centered: false, mode: "new" }], drawings: [{ id: "s1", name: "List 1", options: { sheet: "A3", dimensions: "none" }, meta: { note: "Kalit a popustit na 58 HRC, pokud není uvedeno jinak.", noteBy: "user" }, annotations: [] }] } as unknown as CadDoc;
    const r = docToScript(doc);
    expect(r.text).not.toMatch(/poznámka=/);
    expect(r.text).toMatch(/skript nepřenese/);
  });
});
