import { describe, it, expect } from "vitest";
import {
  BATCH_TYPES, BATCH_TYPE_ENUM, BATCH_TYPE_ORDER, batchEventMessage, batchResultHeadline, batchStage, batchSummaryLine,
  batchTypeFor, cadFormatOf, captureUuid, checkIssuer, defaultSortWithoutAi, drawingNumberFromFilename, isNewerRevision, normalizeClassification,
  normalizeDrawing, pagesKey, redactPrices, revisionFromFilename, revisionRank, sha1Hex, sideOf, stepPartNumber, validateBatchSort,
  type RawClassification,
} from "./capture-batch";
import type { BatchFile, BatchPage, BatchReviewModel, BatchApplyState, BatchResult } from "./capture-batch-types";
import { isUuid } from "./mapping";
import { FILE_KINDS } from "./file-kinds";

function file(id: string, filename: string, over: Partial<BatchFile> = {}): BatchFile {
  return {
    id, path: `capture/u/${id}`, filename, mimeType: "", size: 1000, pageCount: 1, sniffedMime: null, format: null,
    fromZip: null, splittable: true, aiReadable: true, aiSkipReason: null, sha256: "x", ...over,
  };
}

function pagesOf(files: BatchFile[], src: (f: BatchFile) => BatchPage["source"] = (f) => (f.pageCount > 1 || /\.pdf$/.test(f.filename) ? "pdf_page" : /\.(png|jpe?g)$/.test(f.filename) ? "image" : "file")): BatchPage[] {
  const out: BatchPage[] = [];
  for (const f of files) {
    for (let p = 1; p <= f.pageCount; p++) {
      out.push({ id: `p${out.length + 1}`, fileId: f.id, page: p, source: src(f), label: `${f.filename} · str. ${p}`, aiLabel: "", duplicateOf: null });
    }
  }
  return out;
}

const raw = (over: Partial<RawClassification>): RawClassification => ({
  documents: [], fileLinks: [], ignoredPages: [], duplicatePages: [], pageLabels: [], notes: [], ...over,
});

const doc = (pages: number[], type: string, over: Record<string, unknown> = {}) => ({
  pages, type, title: "", documentNumber: "", partyName: "", issuerName: "", issuerIco: "", recipientIco: "",
  drawingNumbers: [], flags: [], confidence: 0.9, reason: "", continuesPrevious: false, ...over,
});

const ctx = { ourIco: "04304080", customerIcos: ["45274649"], supplierIcos: ["25874411"], margins: true };

describe("BATCH_TYPES", () => {
  it("každý druh má stranu, skupinu, formulář a barvu souboru; prohození je symetrické", () => {
    for (const t of BATCH_TYPE_ORDER) {
      const m = BATCH_TYPES[t];
      expect(m.key).toBe(t);
      expect(["customer", "supplier", "none"]).toContain(m.side);
      expect(["zakaznik", "my", "dodavatel", "ostatni"]).toContain(m.group);
      expect(["business", "drawing", "model", "file"]).toContain(m.form);
      expect(FILE_KINDS[m.fileKind]).toBeTruthy();
      if (m.swap) {
        expect(BATCH_TYPES[m.swap].swap).toBe(t);
        expect(m.swapLabel).toMatch(/^Je to /);
        expect(BATCH_TYPES[m.swap].side).not.toBe(m.side);
      }
    }
    expect(BATCH_TYPE_ORDER).toHaveLength(16);
    expect(BATCH_TYPE_ENUM).not.toContain("model_3d");
  });

  it("strany a formuláře", () => {
    expect(sideOf("nabidka_dodavatel")).toBe("supplier");
    expect(sideOf("objednavka_my")).toBe("supplier");
    expect(sideOf("faktura_my")).toBe("customer");
    expect(sideOf("vykres")).toBe("none");
    expect(BATCH_TYPES.model_3d.form).toBe("model");
    expect(BATCH_TYPES.vykres.form).toBe("drawing");
    expect(BATCH_TYPES.foto.form).toBe("file");
    expect(BATCH_TYPES.nabidka_dodavatel.fileKind).toBe("naceneni");
    expect(batchTypeFor("nabidka", "dodavatel")).toBe("nabidka_dodavatel");
    expect(batchTypeFor("objednavka", "neznamy")).toBe("objednavka_zakaznik");
  });
});

describe("CAD a čísla z názvu", () => {
  it("cadFormatOf podle přípony i obsahu", () => {
    expect(cadFormatOf("a.step")).toBe("STEP");
    expect(cadFormatOf("A.STP")).toBe("STEP");
    expect(cadFormatOf("x.igs")).toBe("IGES");
    expect(cadFormatOf("x.sldprt")).toBe("SolidWorks");
    expect(cadFormatOf("x.CATPart")).toBe("CATIA");
    expect(cadFormatOf("x.x_t")).toBe("Parasolid");
    expect(cadFormatOf("x.dwg")).toBe("DWG");
    expect(cadFormatOf("x.pdf")).toBeNull();
    expect(cadFormatOf("bez-pripony", "ISO-10303-21;\nHEADER;")).toBe("STEP");
    expect(cadFormatOf("x.bin", "AC1032\u0000")).toBe("DWG");
    expect(cadFormatOf("x.txt", "  0\nSECTION\n  2\nHEADER")).toBe("DXF");
    expect(cadFormatOf("x.dat", "solid part\n facet normal 0 0 1\n")).toBe("STL");
    const bin = new Uint8Array(84 + 50 * 2);
    bin[80] = 2;
    expect(cadFormatOf("x.bin", bin, bin.length)).toBe("STL");
    const iges = `${"Hlavička IGES".padEnd(72, " ")}S      1\n`;
    expect(cadFormatOf("x.dat", iges)).toBe("IGES");
  });

  it("drawingNumberFromFilename / revisionFromFilename", () => {
    expect(drawingNumberFromFilename("4711-02_rev_B.step")).toBe("4711-02");
    expect(revisionFromFilename("4711-02_rev_B.step")).toBe("B");
    expect(drawingNumberFromFilename("Výkres 4711-03 rev A.pdf")).toBe("4711-03");
    expect(drawingNumberFromFilename("VK_2291_index_C.dxf")).toBe("VK-2291");
    expect(drawingNumberFromFilename("Part1.stp")).toBe("");
    expect(drawingNumberFromFilename("IMG_2034.jpg")).toBe("");
    expect(drawingNumberFromFilename("scan.pdf")).toBe("");
    expect(drawingNumberFromFilename("e2e__vykres-g2.png")).toBe("");
  });

  it("stepPartNumber z PRODUCT, jinak FILE_NAME", () => {
    expect(stepPartNumber("ISO-10303-21;\nFILE_NAME('Part1.stp','2026');\nDATA;\n#5=PRODUCT('4711-02','Upínací deska','',(#2));")).toBe("4711-02");
    expect(stepPartNumber("FILE_NAME('C:\\\\cad\\\\4711-03_rev_A.stp','x');\nPRODUCT('Part1','','',(#1));")).toBe("4711-03");
    expect(stepPartNumber("FILE_NAME('Body.stp','x');")).toBe("");
    expect(stepPartNumber(null)).toBe("");
  });
});

describe("normalizeClassification", () => {
  it("10stránkové PDF → 8 výkresů, jeden dvoulistový", () => {
    const f = file("f1", "vykresy.pdf", { pageCount: 10 });
    const pages = pagesOf([f]);
    const sent = pages.map((p) => p.id);
    const docs = [doc([1, 2], "vykres", { documentNumber: "100-01" })];
    for (let i = 3; i <= 9; i++) docs.push(doc([i], "vykres", { documentNumber: `100-0${i}` }));
    docs.push(doc([10], "vykres", { documentNumber: "100-01", continuesPrevious: false }));
    const out = normalizeClassification(raw({ documents: docs.slice(0, 8), ignoredPages: [10] }), pages, [f], { ...ctx, sentPageIds: sent });
    const active = out.sort.docs.filter((d) => !d.excluded);
    expect(active).toHaveLength(8);
    expect(active[0].pageIds).toEqual(["p1", "p2"]);
    expect(out.sort.docs.find((d) => d.excluded)?.pageIds).toEqual(["p10"]);
    expect(validateBatchSort(out.sort, out.pages)).toBeNull();
  });

  it("přefocená strana → vyřazená (lze vrátit), nezařazené strany → „Nezařazené strany\"", () => {
    const files = [file("f1", "a.jpg"), file("f2", "b.jpg"), file("f3", "c.jpg")];
    const pages = pagesOf(files);
    const out = normalizeClassification(raw({
      documents: [doc([1], "objednavka_zakaznik", { documentNumber: "PO-1" })],
      duplicatePages: [{ page: 2, sameAs: 1 }],
    }), pages, files, { ...ctx, sentPageIds: pages.map((p) => p.id) });
    expect(out.sort.excludedPageIds).toEqual(["p2"]);
    expect(out.pages.find((p) => p.id === "p2")?.duplicateOf).toBe("p1");
    expect(out.warnings.find((w) => w.actions[0]?.kind === "restore_page")?.actions[0].pageId).toBe("p2");
    const rest = out.sort.docs.find((d) => d.title === "Nezařazené strany");
    expect(rest?.pageIds).toEqual(["p3"]);
    expect(validateBatchSort(out.sort, out.pages)).toBeNull();
  });

  it("strany mimo rozsah a ve dvou dokladech, > 80 stran", () => {
    const f = file("f1", "x.pdf", { pageCount: 3 });
    const pages = pagesOf([f]);
    const out = normalizeClassification(raw({
      documents: [doc([1, 2, 99], "faktura_my"), doc([2], "dodaci_list_my")],
    }), pages, [f], { ...ctx, sentPageIds: ["p1", "p2"], truncatedPageIds: ["p3"] });
    expect(out.sort.docs[0].pageIds).toEqual(["p1", "p2"]);
    expect(out.sort.docs.some((d) => d.type === "dodaci_list_my")).toBe(false);
    expect(out.warnings.some((w) => w.code === "pages_truncated")).toBe(true);
    expect(out.sort.docs.find((d) => d.title === "Nezařazené strany")?.pageIds).toEqual(["p3"]);
  });

  it("potvrzená naše nabídka → objednávka zákazníka, duplicitní doklad → upozornění", () => {
    const files = [file("f1", "a.jpg"), file("f2", "b.jpg"), file("f3", "c.jpg")];
    const pages = pagesOf(files);
    const out = normalizeClassification(raw({
      documents: [
        doc([1], "nabidka_my", { flags: ["accepted"], documentNumber: "NAB-1" }),
        doc([2], "faktura_my", { documentNumber: "FV-118" }),
        doc([3], "faktura_my", { documentNumber: "FV 118" }),
      ],
    }), pages, files, { ...ctx, sentPageIds: pages.map((p) => p.id) });
    expect(out.sort.docs[0].type).toBe("objednavka_zakaznik");
    expect(out.warnings.some((w) => w.code === "sort_uncertain" && /Potvrzená naše nabídka/.test(w.message))).toBe(true);
    const dup = out.warnings.find((w) => w.code === "duplicate_doc");
    expect(dup?.actions[0]).toMatchObject({ kind: "exclude_doc", label: "Vyřadit duplicitu", docId: "d3" });
  });

  it("kontrola vystavitele přes IČO (rozpor → návrh druhu)", () => {
    const files = [file("f1", "a.jpg")];
    const pages = pagesOf(files);
    const out = normalizeClassification(raw({
      documents: [doc([1], "nabidka_dodavatel", { issuerIco: "04304080", recipientIco: "45274649" })],
    }), pages, files, { ...ctx, sentPageIds: ["p1"] });
    expect(out.sort.docs[0].issuerCheck).toBe("mismatch");
    const w = out.warnings.find((x) => x.code === "issuer_mismatch");
    expect(w?.actions[0]).toMatchObject({ kind: "set_type", type: "nabidka_my" });
    expect(checkIssuer("faktura_my", "04304080", "45274649", ctx).check).toBe("ok");
    expect(checkIssuer("faktura_dodavatel", "25874411", "04304080", ctx).check).toBe("ok");
    expect(checkIssuer("objednavka_zakaznik", "25874411", "04304080", ctx)).toEqual({ check: "mismatch", suggested: null });
    expect(checkIssuer("potvrzeni_my", "25874411", "", ctx)).toEqual({ check: "mismatch", suggested: "potvrzeni_dodavatel" });
    expect(checkIssuer("objednavka_zakaznik", "", "", ctx).check).toBe("unknown");
  });

  it("bez práva na marže: dodavatelské doklady bez cen a důvodu, štítky stran bez částek", () => {
    const files = [file("f1", "a.jpg")];
    const pages = pagesOf(files);
    const out = normalizeClassification(raw({
      documents: [doc([1], "nabidka_dodavatel", { title: "Nabídka 45 400 Kč", reason: "cena 45 400 Kč", documentNumber: "NAB-552", partyName: "Hrubý" })],
      pageLabels: [{ page: 1, label: "str. 1 · celkem 45 400 Kč" }],
    }), pages, files, { ...ctx, margins: false, sentPageIds: ["p1"] });
    expect(out.sort.docs[0].title).toBe("Nabídka dodavatele NAB-552 · Hrubý");
    expect(out.sort.docs[0].reason).toBe("");
    expect(out.pages[0].aiLabel).not.toMatch(/45/);
  });

  it("soubory bez náhledu = vlastní doklady (model / výkres / jiné), číslo z fileLinks / STEP / názvu", () => {
    const files = [file("f1", "a.jpg"), file("f2", "Part1.step", { format: "STEP" }), file("f3", "4711-03.dxf", { format: "DXF" }), file("f4", "rozpis.xlsx")];
    const pages = pagesOf(files);
    const out = normalizeClassification(raw({
      documents: [doc([1], "objednavka_zakaznik")],
      fileLinks: [{ file: 2, drawingNumber: "4711-02", revision: "B" }],
    }), pages, files, { ...ctx, sentPageIds: ["p1"], headNumbers: {} });
    const types = out.sort.docs.map((d) => [d.type, d.documentNumber, d.format]);
    expect(types).toEqual([
      ["objednavka_zakaznik", "", null],
      ["model_3d", "4711-02", "STEP"],
      ["vykres", "4711-03", "DXF"],
      ["ostatni", "", null],
    ]);
    expect(validateBatchSort(out.sort, out.pages)).toBeNull();
  });

  it("nedělitelné PDF drží strany pohromadě", () => {
    const f = file("f1", "x.pdf", { pageCount: 2, splittable: false });
    const pages = pagesOf([f]);
    const out = normalizeClassification(raw({ documents: [doc([1], "faktura_my"), doc([2], "dodaci_list_my")] }), pages, [f], { ...ctx, sentPageIds: ["p1", "p2"] });
    expect(out.sort.docs.filter((d) => d.pageIds.length)).toHaveLength(1);
    expect(out.sort.docs[0].pageIds).toEqual(["p1", "p2"]);
  });
});

describe("validateBatchSort", () => {
  const files = [file("f1", "a.jpg"), file("f2", "b.jpg"), file("f3", "m.step")];
  const pages = pagesOf(files);
  const base = (docs: { id: string; type: string; pageIds: string[] }[], excludedPageIds: string[] = []) => ({
    docs: docs.map((d) => ({ ...defaultSortWithoutAi([], [], "manual").docs[0], aiType: null, confidence: null, reason: "", title: "", documentNumber: "", partyName: "", drawingNumbers: [], format: null, flags: [], issuerCheck: "unknown" as const, excluded: false, ...d } as never)),
    excludedPageIds,
  });
  it("hlídá stránky, jedinečnost a samostatné soubory", () => {
    expect(validateBatchSort(base([{ id: "d1", type: "objednavka_zakaznik", pageIds: ["p1", "p2"] }, { id: "d2", type: "model_3d", pageIds: ["p3"] }]), pages)).toBeNull();
    expect(validateBatchSort(base([{ id: "d1", type: "objednavka_zakaznik", pageIds: ["p1"] }]), pages)).toMatch(/není zařazená/);
    expect(validateBatchSort(base([{ id: "d1", type: "objednavka_zakaznik", pageIds: ["p1", "p2", "p3"] }]), pages)).toMatch(/samostatný doklad/);
    expect(validateBatchSort(base([{ id: "d1", type: "objednavka_zakaznik", pageIds: ["p1", "p2"] }, { id: "d1", type: "model_3d", pageIds: ["p3"] }]), pages)).toMatch(/stejný identifikátor/);
    expect(validateBatchSort(base([{ id: "d1", type: "model_3d", pageIds: ["p1"] }, { id: "d2", type: "foto", pageIds: ["p2"] }, { id: "d3", type: "ostatni", pageIds: ["p3"] }]), pages)).toMatch(/3D model/);
    expect(validateBatchSort(base([{ id: "d1", type: "foto", pageIds: ["p1"] }, { id: "d2", type: "model_3d", pageIds: ["p3"] }], ["p2", "p9"]), pages)).toMatch(/nepatří/);
    expect(validateBatchSort(base([{ id: "d1", type: "foto", pageIds: ["p1", "p9"] }]), pages)).toMatch(/nepatří/);
  });
});

describe("batchStage", () => {
  it("nejvyšší posun dopředu; proforma, dobropis, dílčí dodávka a zaplaceno jen přepínačem", () => {
    const docs = [{ type: "objednavka_zakaznik" as const, flags: [] }, { type: "dodaci_list_my" as const, flags: [] }, { type: "faktura_my" as const, flags: [] }];
    expect(batchStage(docs, { mode: "existing", stage: "objednavka" })).toBe("fakturovano");
    expect(batchStage(docs, { mode: "new", stage: null })).toBe("fakturovano");
    expect(batchStage([{ type: "faktura_my", flags: ["proforma"] }], { mode: "existing", stage: "objednavka" })).toBe("keep");
    expect(batchStage([{ type: "faktura_my", flags: ["credit_note"] }], { mode: "existing", stage: "objednavka" })).toBe("keep");
    expect(batchStage([{ type: "faktura_my", flags: [], paidComplete: true }], { mode: "existing", stage: "objednavka" })).toBe("dokonceno");
    expect(batchStage([{ type: "faktura_my", flags: ["paid"] }], { mode: "existing", stage: "objednavka" })).toBe("fakturovano");
    expect(batchStage([{ type: "dodaci_list_dodavatel", flags: ["partial"] }], { mode: "existing", stage: "ve_vyrobe" })).toBe("keep");
    expect(batchStage([{ type: "dodaci_list_dodavatel", flags: ["partial"], partialConfirmed: true }], { mode: "existing", stage: "ve_vyrobe" })).toBe("dodano_k_nam");
    expect(batchStage(docs, { mode: "existing", stage: "dokonceno" })).toBe("keep");
    expect(batchStage(docs, { mode: "existing", stage: "pozastaveno" })).toBe("keep");
    expect(batchStage([{ type: "vykres", flags: [] }], { mode: "new", stage: null })).toBe("poptavka");
    expect(batchStage([{ type: "faktura_dodavatel", flags: [] }], { mode: "existing", stage: "objednavka" })).toBe("keep");
  });
});

describe("defaultSortWithoutAi", () => {
  it("bez AI: fotky a PDF = 1 doklad, CAD zvlášť; různé názvy → podle názvu", () => {
    const files = [file("f1", "IMG_1.jpg"), file("f2", "IMG_2.jpg"), file("f3", "4711-02.step", { format: "STEP" })];
    const pages = pagesOf(files);
    const s = defaultSortWithoutAi(files, pages, "manual");
    expect(s.docs.map((d) => [d.type, d.pageIds])).toEqual([["ostatni", ["p1", "p2"]], ["model_3d", ["p3"]]]);
    const named = [file("f1", "faktura-118.pdf"), file("f2", "dodaci-list.pdf"), file("f3", "foto.jpg")];
    const s2 = defaultSortWithoutAi(named, pagesOf(named), "manual");
    expect(s2.docs.map((d) => d.type)).toEqual(["faktura_my", "dodaci_list_my"]);
    expect(s2.docs[0].pageIds).toEqual(["p1", "p3"]);
    const s3 = defaultSortWithoutAi(files, pages, "ai_failed", { expectedType: "objednavka_zakaznik" });
    expect(s3.docs.map((d) => d.type)).toEqual(["objednavka_zakaznik", "objednavka_zakaznik", "model_3d"]);
    expect(validateBatchSort(s3, pages)).toBeNull();
  });
});

describe("texty", () => {
  it("souhrnná událost a nadpis výsledku", () => {
    expect(batchEventMessage({ aiUsed: true, docs: [{ type: "objednavka_zakaznik", documentNumber: "PO-4471" }, { type: "vykres", documentNumber: "4711-02" }] }))
      .toBe("AI roztřídila vyfocenou dávku 2 dokladů: objednávku zákazníka PO-4471, výkres 4711-02");
    expect(batchEventMessage({ aiUsed: false, auto: true, docs: [{ type: "foto" }] })).toBe("Vyfocena dávka 1 dokladu (vyplněno ručně): fotka — uloženo automaticky");
    const docs = (n: number): BatchResult["docs"] => Array.from({ length: n }, (_, i) => ({
      docId: `d${i}`, groupKey: "g1", type: "foto" as const, label: "", ok: true, jobId: "j", jobNumber: "Z-1", fileIds: [], fileKind: "foto" as const, title: "", summary: "", links: [],
    }));
    expect(batchResultHeadline({ groups: [{ key: "g1", ok: true, jobNumber: "Z-2026-031", created: false, stageTo: "fakturovano" }], docs: docs(6) }))
      .toBe("Uloženo 6 dokladů k zakázce Z-2026-031 · stav Vyfakturováno");
    expect(batchResultHeadline({ groups: [{ key: "g1", ok: true, jobNumber: "Z-1", created: true }], docs: docs(1) })).toBe("Založena zakázka Z-1 · uložen 1 doklad");
    expect(batchResultHeadline({ groups: [{ key: "g1", ok: true, jobNumber: "Z-1", created: false }, { key: "g2", ok: true, jobNumber: "Z-2", created: true }], docs: docs(3) }))
      .toBe("Uloženy 3 doklady ke 2 zakázkám · 1 nová zakázka");
    expect(batchResultHeadline({ groups: [], docs: [] })).toBe("Nic se neuložilo");
  });

  it("souhrn nad Uložit vše", () => {
    const job = {
      chip: "objednavka_zakaznik", docKind: "objednavka", issuer: "zakaznik", fileKind: "objednavka", targetKey: "new",
      customer: { mode: "new", party: { name: "Kovo Plus s.r.o." } }, supplier: { mode: "none" }, fields: {},
      items: [{ key: "ai-0", drawingNumber: "A", name: "x", description: "" }], merges: [], stage: "objednavka", docNote: "",
    };
    const state = {
      sort: { docs: [{ id: "d1", type: "objednavka_zakaznik", pageIds: ["p1"], excluded: false }, { id: "d2", type: "nabidka_dodavatel", pageIds: ["p2"], excluded: false }, { id: "d3", type: "vykres", pageIds: ["p3"], excluded: false }, { id: "d4", type: "foto", pageIds: ["p4"], excluded: true }], excludedPageIds: [] },
      groups: [{ key: "g1", docIds: ["d1", "d2", "d3"], job, customerConfirmed: false, jobDraftTitle: "" }],
      docs: {
        d2: { kind: "business", state: { type: "nabidka_dodavatel", fileOnly: false, onDuplicate: null } },
        d3: { kind: "drawing", state: { drawingNumber: "4711-02", archive: true, link: { mode: "add" }, onDuplicate: null } },
      },
    } as unknown as BatchApplyState;
    const review = { margins: true, groups: [{ key: "g1", model: { targets: [{ key: "new", number: null }] } }] } as unknown as BatchReviewModel;
    expect(batchSummaryLine(review, state)).toBe(
      "1 zakázka · 3 doklady · vyřazeno 1 (smaže se) · stav nové zakázky → Objednávka · + nový zákazník Kovo Plus s.r.o. · + 2 položky · 1 nabídka dodavatele → Nákup · 1 výkres do archivu",
    );
    expect(batchSummaryLine({ ...review, margins: false } as BatchReviewModel, state)).toContain("1 nabídka dodavatele čeká na zapsání do Nákupu");
  });

  it("redactPrices", () => {
    expect(redactPrices("celkem 45 400 Kč a 12,50 EUR")).toBe("celkem … a …");
  });
});

describe("normalizeDrawing", () => {
  it("doplní chybějící pole, ořízne, převede datum a jistotu", () => {
    const d = normalizeDrawing({ drawingNumber: " 4711-02 ", revision: "Rev. B", quantity: "5", confidence: 3, drawingDate: "30.9.2026", needsClarification: ["ověř tol.", 5] });
    expect(d).toMatchObject({ drawingNumber: "4711-02", revision: "B", quantity: 5, confidence: 1, drawingDate: "2026-09-30", needsClarification: ["ověř tol."] });
    expect(normalizeDrawing("nesmysl").drawingNumber).toBe("");
  });
});

describe("pagesKey, captureUuid", () => {
  it("klíč stran a deterministické UUID", () => {
    expect(pagesKey(["p1", "p3"])).toBe("p1,p3");
    const a = captureUuid("6f1c2c4e-0000-4000-8000-000000000001", "d1", 0);
    expect(a).toBe(captureUuid("6F1C2C4E-0000-4000-8000-000000000001", "d1", 0));
    expect(a).not.toBe(captureUuid("6f1c2c4e-0000-4000-8000-000000000001", "d2", 0));
    expect(isUuid(a)).toBe(true);
    expect(a[14]).toBe("5");
    expect(sha1Hex("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(sha1Hex("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
  });
});

describe("revize výkresu", () => {
  it("písmena i čísla, prázdná a neporovnatelná revize nic nenahradí", () => {
    expect(revisionRank("B")).toEqual([1, 2]);
    expect(revisionRank("rev. AA")).toEqual([1, 27]);
    expect(revisionRank("03")).toEqual([0, 3]);
    expect(revisionRank("")).toBeNull();
    expect(revisionRank("B-2")).toBeNull();
    expect(isNewerRevision("C", "B")).toBe(true);
    expect(isNewerRevision("AA", "Z")).toBe(true);
    expect(isNewerRevision("B", "C")).toBe(false);
    expect(isNewerRevision("", "C")).toBe(false);
    expect(isNewerRevision("C", "")).toBe(false);
    expect(isNewerRevision("2", "B")).toBe(false);
    expect(isNewerRevision("10", "9")).toBe(true);
  });
});
