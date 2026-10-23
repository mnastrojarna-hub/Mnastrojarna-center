import { describe, it, expect } from "vitest";
import {
  activeDocs, allowedTypes, dirtyDocs, docOfPage, eachFileSeparately, excludeDoc, excludePage, isLockedPage, mergeAll,
  mergeDocs, movePage, movePageWithin, needsExtract, newDocId, previousDoc, restoreDoc, restorePage, sameSort,
  setDocType, splitPage, swapIssuer,
} from "./batch-sort";
import { validateBatchSort } from "@/lib/jobs/capture-batch";
import { SORT_DOCS } from "./__fixtures__/batch";
import type { BatchDocDraft, BatchDocType, BatchFile, BatchPage, BatchSort } from "@/lib/jobs/capture-batch-types";

function page(id: string, fileId: string, source: BatchPage["source"] = "image", n = 1, duplicateOf: string | null = null): BatchPage {
  return { id, fileId, page: n, source, label: `${fileId} · ${n}`, aiLabel: "", duplicateOf };
}

function file(id: string, over: Partial<BatchFile> = {}): BatchFile {
  return {
    id, path: `capture/u/${id}`, filename: `${id}.jpg`, mimeType: "image/jpeg", size: 100, pageCount: 1,
    sniffedMime: "image/jpeg", format: null, fromZip: null, splittable: true, aiReadable: true, aiSkipReason: null, sha256: id,
    ...over,
  };
}

function doc(id: string, type: BatchDocType, pageIds: string[], over: Partial<BatchDocDraft> = {}): BatchDocDraft {
  return {
    id, type, pageIds, aiType: type, confidence: 0.9, reason: "", title: "", documentNumber: "", partyName: "",
    drawingNumbers: [], format: null, flags: [], issuerCheck: "ok", excluded: false, ...over,
  };
}

// f1 = 2 fotky objednávky, f2 = 3stránkové PDF (DL + faktura + výkres), f3 = STEP
const PAGES: BatchPage[] = [
  page("p1", "f1"), page("p2", "f1b"),
  page("p3", "f2", "pdf_page", 1), page("p4", "f2", "pdf_page", 2), page("p5", "f2", "pdf_page", 3),
  page("p6", "f3", "file"),
];
const FILES: BatchFile[] = [
  file("f1"), file("f1b"),
  file("f2", { filename: "sada.pdf", mimeType: "application/pdf", pageCount: 3 }),
  file("f3", { filename: "4711-02.step", mimeType: "application/octet-stream", format: "STEP" }),
];
const SORT: BatchSort = {
  docs: [
    doc("d1", "objednavka_zakaznik", ["p1", "p2"]),
    doc("d2", "dodaci_list_my", ["p3"]),
    doc("d3", "faktura_my", ["p4"]),
    doc("d4", "vykres", ["p5"]),
    doc("d5", "model_3d", ["p6"]),
  ],
  excludedPageIds: [],
};

const valid = (s: BatchSort) => validateBatchSort(s, PAGES);

describe("roztřídění — operace", () => {
  it("výchozí roztřídění je platné", () => {
    expect(valid(SORT)).toBeNull();
    expect(docOfPage(SORT, "p4")?.id).toBe("d3");
  });

  it("změna druhu a prohození vystavitele", () => {
    const s = setDocType(SORT, "d2", "potvrzeni_my");
    expect(s.docs[1].type).toBe("potvrzeni_my");
    expect(s.docs[1].issuerCheck).toBe("unknown");
    expect(swapIssuer(SORT, "d3").docs[2].type).toBe("faktura_dodavatel");
    expect(swapIssuer(swapIssuer(SORT, "d3"), "d3").docs[2].type).toBe("faktura_my");
    // výkres protějšek nemá
    expect(swapIssuer(SORT, "d4")).toBe(SORT);
  });

  it("oddělit stránku jako nový doklad → hned za původní, pak sloučit zpět", () => {
    const s = splitPage(SORT, "p2", "objednavka_zakaznik", "u-test0001");
    expect(s.docs.map((d) => d.id)).toEqual(["d1", "u-test0001", "d2", "d3", "d4", "d5"]);
    expect(s.docs[0].pageIds).toEqual(["p1"]);
    expect(s.docs[1].pageIds).toEqual(["p2"]);
    expect(valid(s)).toBeNull();
    const back = mergeDocs(s, "d1", "u-test0001");
    expect(back.docs[0].pageIds).toEqual(["p1", "p2"]);
    expect(back.docs).toHaveLength(5);
    expect(previousDoc(s, "u-test0001")?.id).toBe("d1");
    expect(previousDoc(s, "d1")).toBeNull();
  });

  it("oddělení jediné stránky dokladu doklad nahradí na stejném místě", () => {
    const s = splitPage(SORT, "p3", "dodaci_list_dodavatel", "u-x");
    expect(s.docs.map((d) => d.id)).toEqual(["d1", "u-x", "d3", "d4", "d5"]);
    expect(valid(s)).toBeNull();
  });

  it("přesun stránky mezi doklady, prázdný doklad zmizí", () => {
    const s = movePage(SORT, "p4", "d2");
    expect(s.docs.find((d) => d.id === "d2")?.pageIds).toEqual(["p3", "p4"]);
    expect(s.docs.some((d) => d.id === "d3")).toBe(false);
    expect(valid(s)).toBeNull();
    const front = movePage(SORT, "p4", "d2", 0);
    expect(front.docs.find((d) => d.id === "d2")?.pageIds).toEqual(["p4", "p3"]);
    expect(movePage(SORT, "p4", "nic")).toBe(SORT);
  });

  it("pořadí stran v dokladu", () => {
    const s = movePageWithin(SORT, "p2", -1);
    expect(s.docs[0].pageIds).toEqual(["p2", "p1"]);
    expect(movePageWithin(SORT, "p1", -1)).toBe(SORT);
  });

  it("vyřazení a vrácení dokladu / stránky", () => {
    const s = excludeDoc(SORT, "d4");
    expect(activeDocs(s).map((d) => d.id)).not.toContain("d4");
    expect(restoreDoc(s, "d4").docs[3].excluded).toBe(false);

    const e = excludePage(SORT, "p2");
    expect(e.excludedPageIds).toEqual(["p2"]);
    expect(e.docs[0].pageIds).toEqual(["p1"]);
    expect(valid(e)).toBeNull();
    const r = restorePage(e, "p2", PAGES, "d1");
    expect(r.docs[0].pageIds).toEqual(["p1", "p2"]);
    expect(r.excludedPageIds).toEqual([]);
  });

  it("vrácení duplicitní stránky ji zařadí za stránku, kterou opakuje", () => {
    const pages = [...PAGES, page("p7", "f9", "image", 1, "p1")];
    const s: BatchSort = { ...SORT, excludedPageIds: ["p7"] };
    expect(validateBatchSort(s, pages)).toBeNull();
    const r = restorePage(s, "p7", pages);
    expect(r.docs[0].pageIds).toEqual(["p1", "p7", "p2"]);
    // bez vazby → nový doklad „Jiné"
    const lone = restorePage({ ...SORT, excludedPageIds: ["p9"] }, "p9", [...PAGES, page("p9", "f9")], undefined, "u-new");
    expect(lone.docs[lone.docs.length - 1]).toMatchObject({ id: "u-new", type: "ostatni", pageIds: ["p9"] });
  });

  it("každá fotka zvlášť (nedělitelné PDF zůstane pohromadě)", () => {
    let n = 0;
    const one: BatchSort = { docs: [doc("d1", "objednavka_zakaznik", ["p1", "p2", "p3", "p4", "p5"])], excludedPageIds: [] };
    const s = eachFileSeparately(one, PAGES, FILES, () => `u-${++n}`);
    expect(s.docs.map((d) => d.pageIds)).toEqual([["p1"], ["p2"], ["p3"], ["p4"], ["p5"]]);
    expect(s.docs[0].id).toBe("d1");
    expect(s.docs.every((d) => d.type === "objednavka_zakaznik")).toBe(true);

    const locked = FILES.map((f) => (f.id === "f2" ? { ...f, splittable: false } : f));
    expect(isLockedPage(PAGES, locked, "p4")).toBe(true);
    const s2 = eachFileSeparately(one, PAGES, locked, () => `u-${++n}`);
    expect(s2.docs.map((d) => d.pageIds)).toEqual([["p1"], ["p2"], ["p3", "p4", "p5"]]);
  });

  it("sloučit vše do jednoho — CAD soubor zůstane samostatně, typ = první obchodní", () => {
    const s = mergeAll({ ...SORT, docs: [doc("d4", "vykres", ["p5"]), ...SORT.docs.filter((d) => d.id !== "d4")] }, PAGES);
    expect(s.docs).toHaveLength(2);
    expect(s.docs[0]).toMatchObject({ id: "d4", type: "objednavka_zakaznik" });
    expect(s.docs[0].pageIds).toEqual(["p5", "p1", "p2", "p3", "p4"]);
    expect(s.docs[1].id).toBe("d5");
    expect(validateBatchSort(s, PAGES)).toBeNull();
  });

  it("povolené druhy: soubor bez náhledu jen výkres / model / jiné; fotka nikdy model", () => {
    expect(allowedTypes(SORT.docs[4], PAGES)).toEqual(["model_3d", "vykres", "ostatni"]);
    expect(allowedTypes(SORT.docs[0], PAGES)).not.toContain("model_3d");
    expect(allowedTypes(SORT.docs[0], PAGES)).toContain("nabidka_dodavatel");
  });

  it("id nového dokladu", () => {
    expect(newDocId()).toMatch(/^u-[0-9a-z]{8}$/);
  });
});

describe("dirtyDocs — co přečíst znovu", () => {
  it("změna stránek / nový doklad", () => {
    const s = splitPage(SORT, "p2", "objednavka_zakaznik", "u-1");
    expect(dirtyDocs(SORT, s).sort()).toEqual(["d1", "u-1"]);
  });

  it("změna formuláře nebo strany ano, v rámci strany ne", () => {
    expect(dirtyDocs(SORT, setDocType(SORT, "d2", "faktura_my"))).toEqual([]);
    expect(dirtyDocs(SORT, setDocType(SORT, "d2", "dodaci_list_dodavatel"))).toEqual(["d2"]);
    expect(dirtyDocs(SORT, setDocType(SORT, "d4", "ostatni"))).toEqual(["d4"]);
    expect(dirtyDocs(SORT, setDocType(SORT, "d2", "vykres"))).toEqual(["d2"]);
  });

  it("vyřazený doklad se nečte", () => {
    expect(dirtyDocs(SORT, excludeDoc(SORT, "d2"))).toEqual([]);
  });

  it("needsExtract a sameSort", () => {
    expect(needsExtract("objednavka_zakaznik", true)).toBe(true);
    expect(needsExtract("objednavka_zakaznik", false)).toBe(false);
    expect(needsExtract("vykres", true)).toBe(true);
    expect(needsExtract("model_3d", false)).toBe(true);
    expect(needsExtract("foto", true)).toBe(false);
    expect(sameSort(SORT, { ...SORT })).toBe(true);
    expect(sameSort(SORT, setDocType(SORT, "d2", "faktura_my"))).toBe(false);
  });
});

describe("popis dokladu v seznamech (přesun / sloučení)", () => {
  it("bez čísla dokladu: číslo výkresu, formát, strana nebo první stránka", async () => {
    const { docLabel } = await import("./capture-sort");
    const base = { ...SORT_DOCS[0], documentNumber: "", drawingNumbers: [], format: null, partyName: "" };
    expect(docLabel({ ...base, documentNumber: "PO-1" })).toMatch(/ PO-1$/);
    expect(docLabel({ ...base, type: "vykres", drawingNumbers: ["4711-02"] })).toBe("Výkres · 4711-02");
    expect(docLabel({ ...base, type: "model_3d", format: "STEP" })).toBe("3D model · STEP");
    expect(docLabel({ ...base, type: "foto", pageIds: ["p2"] }, [{ id: "p1" }, { id: "p2" }])).toBe("Fotka · S2");
  });
});
