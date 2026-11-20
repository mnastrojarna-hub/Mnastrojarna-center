/**
 * Vlna 22, bod 20 – etapa D2 (výkresová část): revize modelu na listu a v exportech, vydání listu, záznamy exportů,
 * seznam zastaralých výstupů (čisté funkce cad/doc-outputs.ts, rozbor agent-outputs.ts a `výkres vydat`). Engine se skutečným
 * jádrem: engine/outputs-d2.test.ts; korpus 77 / 78.
 */
import { afterEach, describe, expect, it } from "vitest";
import { parseOutputsLine } from "./agent-outputs";
import { parseDrawing } from "./agent-drawing";
import { parseOutLine } from "./agent-out";
import type { DText, DrawingMeta, Poly } from "./drawing";
import { dxfWithRevs, pdfInfo } from "./drawing-export";
import { defaultIssueRev, emitIssue, exportLine, exportsText, issueSheet, modelId, nextRev, OUTPUTS_MAX, outputsKv, outputsStatusLines, recordExport, sheetIssueLine, sheetState, staleOutputKinds, staleOutputs, staleOutputsText, withdrawIssue } from "./doc-outputs";
import { modelRev } from "./engine/result-key";
import { setLang } from "./i18n";
import { drawTitleBlock } from "./title-block";
import type { CadDoc, DrawingDoc, Feature } from "./types";

afterEach(() => setLang("cs"));

const box = (id: string, x: number): Feature => ({ id, name: "Kvádr 1", type: "box", size: [x, 40, 10], position: [0, 0, 0] }) as unknown as Feature;
const sheet = (o: Partial<DrawingDoc> = {}): DrawingDoc => ({ id: "s1", name: "List 1", options: {}, meta: {}, annotations: [], ...o });
const part = (x = 60, drawings: DrawingDoc[] = [sheet()]): CadDoc => ({ app: "mnastrojarna-cad", version: 2, name: "Deska A", material: "ocel", features: [box("b1", x)], drawings });
/** stejný díl se změněnou geometrií (zkrácený kvádr), výkresy a záznamy beze změny */
const changed = (d: CadDoc, x = 30): CadDoc => ({ ...d, features: [box("b1", x)] });

describe("revize modelu (jedna definice – A1 result-key.ts)", () => {
  it("r·xxxxxx = A1 modelRev; nemění ji název, výkresy ani záznamy exportů, mění ji geometrie", () => {
    const d = part();
    expect(modelId(d).rev).toBe(modelRev(d));
    expect(modelId(d).rev).toMatch(/^r·[0-9a-f]{6}$/);
    expect(modelId({ ...d, name: "Jiný" }).sig).toBe(modelId(d).sig);
    expect(modelId({ ...d, drawings: [] }).sig).toBe(modelId(d).sig);
    expect(modelId(recordExport(d, { what: "model", format: "step", file: "a.step" }).doc).sig).toBe(modelId(d).sig);
    expect(modelId(changed(d)).sig).not.toBe(modelId(d).sig);
  });
  it("další písmeno revize", () => {
    expect([nextRev(undefined), nextRev("A"), nextRev("b"), nextRev("Z"), nextRev("1"), nextRev("A9"), nextRev("09"), nextRev("01")]).toEqual(["A", "B", "C", "AA", "2", "A10", "10", "02"]);
  });
});

describe("vydání listu (výkres vydat)", () => {
  it("první vydání: revize A přidaná do tabulky, revize v razítku, revize modelu a čas; stav „odpovídá modelu“", () => {
    const d = part();
    expect(sheetState(d, d.drawings![0])).toBe("none");
    expect(sheetIssueLine(d, d.drawings![0])).toMatch(/^Vydání: nevydáno · list z modelu r·[0-9a-f]{6} \(vydat: výkres vydat A\)$/);
    const r = issueSheet(d, d.drawings![0], { at: "2026-11-20T10:00:00.000Z" });
    expect(r.rev).toBe("A");
    expect(r.added).toBe(true);
    const m = r.sheet.meta as Partial<DrawingMeta>;
    expect(m.revision).toBe("A");
    expect(m.revisions?.map((x) => [x.rev, x.note])).toEqual([["A", "první vydání"]]);
    expect(r.sheet.issued).toMatchObject({ rev: "A", modelRev: modelId(d).rev, sig: modelId(d).sig, at: "2026-11-20T10:00:00.000Z" });
    const d2: CadDoc = { ...d, drawings: [r.sheet] };
    expect(sheetState(d2, r.sheet)).toBe("current");
    expect(sheetIssueLine(d2, r.sheet)).toMatch(/^Vydání: rev\. A z modelu r·[0-9a-f]{6} \(.+\) – odpovídá modelu$/);
  });

  it("změna modelu po vydání: list ZASTARALÝ, výchozí další písmeno B s popisem „změna modelu r·… → r·…“", () => {
    const d0 = part();
    const a = issueSheet(d0, d0.drawings![0]).sheet;
    const d1 = changed({ ...d0, drawings: [a] });
    expect(sheetState(d1, a)).toBe("stale");
    expect(sheetIssueLine(d1, a)).toMatch(/^⚠ Vydání: rev\. A z modelu r·\w{6} \(.+\) – model je teď r·\w{6}: list je ZASTARALÝ – vydejte novou revizi: výkres vydat B$/);
    expect(defaultIssueRev(d1, a)).toBe("B");
    const b = issueSheet(d1, a);
    expect(b.rev).toBe("B");
    expect(b.sameRevChanged).toBe(false);
    expect((b.sheet.meta as Partial<DrawingMeta>).revisions?.map((x) => x.rev)).toEqual(["A", "B"]);
    expect((b.sheet.meta as Partial<DrawingMeta>).revisions?.[1].note).toBe(`změna modelu ${modelId(d0).rev} → ${modelId(d1).rev}`);
    expect(sheetState(d1, b.sheet)).toBe("current");
  });

  it("totéž písmeno po změně modelu = sameRevChanged (⚠ drawing.stale); stejný model a písmeno = beze změny", () => {
    const d0 = part();
    const a = issueSheet(d0, d0.drawings![0]).sheet;
    expect(issueSheet({ ...d0, drawings: [a] }, a, { rev: "A" })).toMatchObject({ unchanged: true, sameRevChanged: false });
    const again = issueSheet(changed({ ...d0, drawings: [a] }), a, { rev: "a" });
    expect(again).toMatchObject({ rev: "A", unchanged: false, sameRevChanged: true, added: false });
  });

  it("rozpracovaná revize C zapsaná po vydání A se při novém vydání použije; zrušení vydání list nechá", () => {
    const d0 = part();
    const a = issueSheet(d0, d0.drawings![0]).sheet;
    const withC: DrawingDoc = { ...a, meta: { ...a.meta, revision: "C", revisions: [...((a.meta as Partial<DrawingMeta>).revisions ?? []), { rev: "C", date: "1. 1. 2027", note: "rozpracováno" }] } };
    expect(defaultIssueRev(changed({ ...d0, drawings: [withC] }), withC)).toBe("C");
    const w = withdrawIssue(a);
    expect(w.issued).toBeUndefined();
    expect((w.meta as Partial<DrawingMeta>).revisions?.length).toBe(1);
  });
});

describe("záznamy exportů", () => {
  it("revize modelu a čas; stejný formát + soubor nahradí starší; nejvýš OUTPUTS_MAX", () => {
    let d = part();
    d = recordExport(d, { what: "drawing", format: "PDF", file: "Deska_A_vykres.pdf", sheets: ["s1"], rev: "A", at: "2026-11-20T10:00:00.000Z" }).doc;
    d = recordExport(d, { what: "model", format: "step", file: "Deska A.step" }).doc;
    d = recordExport(d, { what: "drawing", format: "pdf", file: "Deska_A_vykres.pdf", sheets: ["s1"] }).doc;
    expect(d.outputs!.map((r) => `${r.format}:${r.file}`)).toEqual(["step:Deska A.step", "pdf:Deska_A_vykres.pdf"]);
    expect(d.outputs!.every((r) => r.modelRev === modelId(d).rev)).toBe(true);
    for (let i = 0; i < OUTPUTS_MAX + 5; i++) d = recordExport(d, { what: "model", format: "stl", file: `f${i}.stl` }).doc;
    expect(d.outputs!.length).toBe(OUTPUTS_MAX);
  });

  it("po změně modelu: záznam ZASTARALÝ s příkazem, který export zopakuje; před změnou „odpovídá modelu“ (ne ✓)", () => {
    const d0 = recordExport(part(), { what: "drawing", format: "pdf", file: "Deska_A_vykres.pdf", sheets: ["s1"], rev: "A" }).doc;
    const rec = d0.outputs![0];
    expect(exportLine(d0, rec)).toMatch(/^PDF „Deska_A_vykres\.pdf“ · list List 1 · rev\. A · z modelu r·\w{6} \(.+\) – odpovídá modelu$/);
    expect(exportLine(d0, rec)).not.toContain("✓");
    const d1 = changed(d0);
    expect(exportLine(d1, rec)).toMatch(/^⚠ PDF „Deska_A_vykres\.pdf“ .* – ZASTARALÝ: model je teď r·\w{6}, exportujte znovu: výkres export pdf$/);
    expect(exportsText(d1)).toMatch(/^Exporty \(1, zastaralých 1\) · model je teď r·\w{6}:\n {2}1\. ⚠ PDF/);
    expect(exportsText(part())).toMatch(/^Exporty: žádné záznamy/);
  });
});

describe("zastaralé výstupy a stav dokumentu", () => {
  it("dokument bez vydaných listů a záznamů exportů: stav beze změny (žádné řádky, žádné kv)", () => {
    const d = part();
    expect(outputsStatusLines(d)).toEqual([]);
    expect(outputsKv(d)).toBe("");
    expect(staleOutputKinds(d)).toEqual([]);
  });

  it("vydaný list a export ze starší revize, analýzy A1 a kopie D1 v jednom seznamu; co přepočítá přepočítat vše", () => {
    const d0 = part();
    const a = issueSheet(d0, d0.drawings![0]).sheet;
    const d1 = changed(recordExport({ ...d0, drawings: [a] }, { what: "model", format: "step", file: "Deska A.step" }).doc);
    const items = staleOutputs(d1, { analyses: ["clash", "measure"], copies: [{ name: "Deska A", why: "kopie je starší", fix: "sestava obnovit #1" }] });
    expect(items.map((x) => [x.kind, x.fix, x.auto])).toEqual([
      ["copy", "sestava obnovit #1", true],
      ["analysis", "kolize", true],
      ["analysis", "měřit …", false],
      ["sheet", "výkres vydat B", false],
      ["export", "export step", false],
    ]);
    expect(staleOutputsText(d1, items)).toMatch(/^Zastaralé výstupy \(5\) · model je teď r·\w{6}:/);
    expect(outputsKv(d1)).toBe("drawing.stale=1 export.stale=1");
    expect(staleOutputKinds(d1)).toEqual(["drawing", "export"]);
    const lines = outputsStatusLines(d1);
    expect(lines[0]).toBe(`Revize modelu: ${modelId(d1).rev}`);
    expect(lines.slice(1).every((l) => l.startsWith("⚠ "))).toBe(true);
  });

  it("nic zastaralého: „žádné“ jen když vydané listy i exporty odpovídají nynější revizi", () => {
    const d0 = part();
    const d = recordExport({ ...d0, drawings: [issueSheet(d0, d0.drawings![0]).sheet] }, { what: "model", format: "step", file: "a.step" }).doc;
    const items = staleOutputs(d);
    expect(items).toEqual([]);
    expect(staleOutputsText(d, items)).toMatch(/^Zastaralé výstupy: žádné/);
    expect(outputsStatusLines(d).some((l) => l.startsWith("⚠"))).toBe(false);
  });
});

describe("razítko a metadata souborů nesou revizi modelu", () => {
  it("patička razítka: „Model r·…“ za číslem listu (bez revize modelu beze změny)", () => {
    const draw = (meta: Partial<DrawingMeta>) => {
      const polys: Poly[] = [];
      const texts: DText[] = [];
      return drawTitleBlock({ W: 420, H: 297, margin: 10, ctx: { sheet: "A3", scaleLabel: "1:2", projection: "E" }, meta: { name: "Deska", material: "Ocel", ...meta } as DrawingMeta, polys, texts, above: 0 });
    };
    expect(draw({ modelRev: "r·a1b2c3" }).footer.join(" ")).toContain("List 1/1 · Model r·a1b2c3");
    expect(draw({}).footer.join(" ")).not.toContain("Model");
  });
  it("PDF předmět a klíčová slova, DXF komentář 999 (ASCII) před hlavičkou", () => {
    expect(pdfInfo({ modelRev: "r·a1b2c3", rev: "B" })).toEqual({ subject: "Model r·a1b2c3 · rev. B", keywords: "model=r·a1b2c3 rev=B" });
    expect(pdfInfo({})).toEqual({});
    const dxf = dxfWithRevs("0\nSECTION\n2\nHEADER\n", { modelRev: "r·a1b2c3", rev: "B" });
    expect(dxf.startsWith("999\nMnastrojarna CAD model r-a1b2c3 rev B\n0\nSECTION")).toBe(true);
    expect(/^[\x00-\x7f]*$/.test(dxf.split("\n")[1])).toBe(true);
    expect(dxfWithRevs("0\nSECTION\n", {})).toBe("0\nSECTION\n");
  });
});

describe("textové příkazy (CS / EN / DE)", () => {
  it("výkres vydat [B] [\"popis\"] [vše] · zrušit", () => {
    expect(parseDrawing(["vydat"], "vydat")).toEqual({ k: "issue", op: "issue" });
    expect(parseDrawing([], 'vydat b "nová díra Ø8" vše')).toBeNull(); // bez tokenů = jen otevřít výkres
    expect(parseDrawing(["vydat", "b"], 'vydat b "nová díra Ø8" vše')).toEqual({ k: "issue", op: "issue", rev: "B", note: "nová díra Ø8", all: true });
    expect(parseDrawing(["issue", "C", "datum", "1.12.2026"], "issue C datum 1.12.2026")).toEqual({ k: "issue", op: "issue", rev: "C", date: "1.12.2026" });
    expect(parseDrawing(["freigeben", "aufheben"], "freigeben aufheben")).toEqual({ k: "issue", op: "withdraw" });
    expect(parseDrawing(["vydat", "zrušit", "vše"], "vydat zrušit vše")).toEqual({ k: "issue", op: "withdraw", all: true });
    // popis bez písmena revize: „první“ (víc než 4 znaky) není písmeno revize
    expect(parseDrawing(["vydat", "první", "vydání"], "vydat první vydání")).toEqual({ k: "issue", op: "issue", note: "první vydání" });
  });
  it("exporty · výstupy [zastaralé] · přepočítat vše (i přes parseOutLine)", () => {
    expect(parseOutputsLine(["exporty"])).toEqual({ kind: "exports" });
    expect(parseOutputsLine(["exports", "clear"])).toEqual({ kind: "exports", clear: true });
    expect(parseOutputsLine(["exporte", "löschen"])).toEqual({ kind: "exports", clear: true });
    expect(parseOutputsLine(["výstupy"])).toEqual({ kind: "outputs" });
    expect(parseOutputsLine(["outputs", "stale"])).toEqual({ kind: "outputs", stale: true });
    expect(parseOutputsLine(["veraltet"])).toEqual({ kind: "outputs", stale: true });
    expect(parseOutputsLine(["zastaralé"])).toEqual({ kind: "outputs", stale: true });
    expect(parseOutputsLine(["přepočítat", "vše"])).toEqual({ kind: "recompute" });
    expect(parseOutputsLine(["recompute", "all"])).toEqual({ kind: "recompute" });
    expect(parseOutputsLine(["alles", "neu", "berechnen"])).toEqual({ kind: "recompute" });
    expect(parseOutputsLine(["přepočítat"])).toBeNull();
    expect(parseOutputsLine(["export", "step"])).toBeNull();
    expect(() => parseOutputsLine(["exporty", "x"])).toThrow(/exporty: neznámé „x“/);
    expect(parseOutLine(["přepočítat", "vše"])).toEqual({ kind: "recompute" });
    expect(parseOutLine(["export", "step"])).toEqual({ kind: "export", format: "step" }); // export dál beze změny
  });
});

describe("skript z dokumentu", () => {
  it("vydaný list z nynějšího modelu = řádek výkres vydat A (EN drawing issue); zastaralý = jen poznámka", () => {
    const d0 = part();
    const a = issueSheet(d0, d0.drawings![0]).sheet;
    const out = (li: 0 | 1 | 2, d: CadDoc) => {
      const lines: string[] = [];
      const notes: string[] = [];
      emitIssue({ li, line: (s) => lines.push(s), note: (s) => notes.push(s) }, d, a);
      return { lines, notes };
    };
    expect(out(0, { ...d0, drawings: [a] })).toEqual({ lines: ["výkres vydat A"], notes: [] });
    expect(out(1, { ...d0, drawings: [a] }).lines).toEqual(["drawing issue A"]);
    expect(out(2, { ...d0, drawings: [a] }).lines).toEqual(["zeichnung freigeben A"]);
    const st = out(0, changed({ ...d0, drawings: [a] }));
    expect(st.lines).toEqual([]);
    expect(st.notes[0]).toMatch(/vydání se do skriptu nezapisuje \(vydejte znovu: výkres vydat B\)$/);
  });
});

describe("EN / DE", () => {
  it("texty stavu v angličtině a němčině", () => {
    const d0 = part();
    const a = issueSheet(d0, d0.drawings![0]).sheet;
    const d1 = changed({ ...d0, drawings: [a] });
    setLang("en");
    expect(sheetIssueLine(d1, a)).toMatch(/^⚠ Issue: rev\. A from model r·\w{6} \(.+\) – the model is now r·\w{6}: the sheet is OUTDATED – issue a new revision: drawing issue B$/);
    setLang("de");
    expect(sheetIssueLine(d1, a)).toMatch(/^⚠ Freigabe: Rev\. A aus Modell r·\w{6} \(.+\) – das Modell ist jetzt r·\w{6}: das Blatt ist VERALTET/);
  });
});
