import { describe, it, expect, afterEach, vi } from "vitest";
import path from "node:path";
import { fakeClassify, fakeExtractRaw, fakeGroupFor, parseFakeTag, safeBatchFile } from "./fake-capture";
import { normalizeClassification } from "@/lib/jobs/capture-batch";
import type { BatchFile, BatchPage } from "@/lib/jobs/capture-batch-types";

const FIXTURE = path.resolve(process.cwd(), "src/lib/jobs/__fixtures__/capture/objednavka-strojmetal.json");

afterEach(() => vi.unstubAllEnvs());

function files(names: string[], pageCounts: number[] = []): { files: BatchFile[]; pages: BatchPage[] } {
  const fs: BatchFile[] = names.map((n, i) => ({
    id: `f${i + 1}`, path: `capture/u/${i}`, filename: n, mimeType: "", size: 10, pageCount: pageCounts[i] ?? 1, sniffedMime: null,
    format: null, fromZip: null, splittable: true, aiReadable: true, aiSkipReason: null, sha256: "x",
  }));
  const pages: BatchPage[] = [];
  for (const f of fs) for (let p = 1; p <= f.pageCount; p++) pages.push({ id: `p${pages.length + 1}`, fileId: f.id, page: p, source: /\.pdf$/.test(f.filename) ? "pdf_page" : "image", label: "", aiLabel: "", duplicateOf: null });
  return { files: fs, pages };
}

describe("značky v názvu", () => {
  it("typ, flagy, strana, skupina, přefocení", () => {
    expect(parseFakeTag("E2E-x__objednavka_zakaznik-s2.png")).toEqual({ type: "objednavka_zakaznik", flags: [], page: 2, group: "0", dup: false });
    expect(parseFakeTag("x__dodaci_list_my+signed+partial-g3-dup.jpg")).toEqual({ type: "dodaci_list_my", flags: ["signed", "partial"], page: null, group: "g3", dup: true });
    expect(parseFakeTag("x__sada-dl-faktura.pdf")).toEqual({ sada: "dl-faktura" });
    expect(parseFakeTag("x__neexistuje.png")).toBeNull();
    expect(parseFakeTag("x__faktura_my+hacked.png")).toBeNull();
    expect(parseFakeTag("obycejna-fotka.png")).toBeNull();
  });
  it("path traversal odmítnut", () => {
    const dir = path.resolve("/tmp/batch");
    expect(safeBatchFile(dir, "../../etc/passwd")).toBeNull();
    expect(safeBatchFile(dir, "..")).toBeNull();
    expect(safeBatchFile(dir, "vykres-g2")).toBe(path.join(dir, "vykres-g2.json"));
  });
});

describe("falešné roztřídění a vytěžení", () => {
  it("bez značky = jeden doklad podle AI_FAKE_CAPTURE (dnešní tok)", () => {
    vi.stubEnv("AI_FAKE_CAPTURE", FIXTURE);
    const { files: fs, pages } = files(["a.png", "b.png"]);
    const raw = fakeClassify(fs, pages, pages.map((p) => p.id));
    expect(raw.documents).toHaveLength(1);
    expect(raw.documents[0]).toMatchObject({ type: "objednavka_zakaznik", pages: [1, 2], reason: "testovací roztřídění", confidence: 0.9 });
  });
  it("značky: pořadí stran, přefocení, skupiny, sada z PDF", () => {
    vi.stubEnv("AI_FAKE_CAPTURE", FIXTURE);
    const { files: fs, pages } = files([
      "E__objednavka_zakaznik-s2.png", "E__objednavka_zakaznik-s1.png", "E__objednavka_zakaznik-s1-dup.png",
      "E__vykres.png", "E__objednavka_zakaznik-g2.png", "E__sada-dl-faktura.pdf",
    ], [1, 1, 1, 1, 1, 2]);
    const raw = fakeClassify(fs, pages, pages.map((p) => p.id));
    const byType = raw.documents.map((d) => [d.type, d.pages]);
    expect(byType).toEqual([
      ["objednavka_zakaznik", [2, 1]],
      ["vykres", [4]],
      ["objednavka_zakaznik", [5]],
      ["dodaci_list_my", [6]],
      ["faktura_my", [7]],
    ]);
    expect(raw.duplicatePages).toEqual([{ page: 3, sameAs: 2 }]);
    expect(raw.documents.find((d) => d.type === "dodaci_list_my")?.flags).toEqual(["signed"]);
    expect(raw.documents[2].partyName).toBe("Kovo Plus s.r.o.");
    expect(raw.documents[0].issuerIco).toBe("45274649");
    expect(raw.documents[3].issuerIco).toBe("04304080");
    const norm = normalizeClassification(raw, pages, fs, { ourIco: "04304080", customerIcos: [], supplierIcos: [], margins: true, sentPageIds: pages.map((p) => p.id) });
    expect(norm.sort.excludedPageIds).toEqual(["p3"]);
    expect(norm.sort.docs.filter((d) => !d.excluded)).toHaveLength(5);
  });
  it("fixture podle druhu a skupiny, jinak AI_FAKE_CAPTURE", () => {
    vi.stubEnv("AI_FAKE_CAPTURE", FIXTURE);
    expect((fakeExtractRaw("objednavka_zakaznik", "g2") as { documentNumber: string }).documentNumber).toBe("PO-E2E-4480");
    expect((fakeExtractRaw("objednavka_zakaznik", "0") as { documentNumber: string }).documentNumber).toBe("PO-E2E-4471");
    expect((fakeExtractRaw("objednavka_zakaznik", null) as { documentNumber: string }).documentNumber).toBe("4795-2026");
    expect((fakeExtractRaw("vykres", "g2") as { drawingNumber: string }).drawingNumber).toBe("4711-03");
    expect((fakeExtractRaw("faktura_dodavatel", "g9") as { documentNumber: string }).documentNumber).toBe("4795-2026");
    expect(fakeGroupFor("vykres", ["x__vykres-g2.png"])).toBe("g2");
    expect(fakeGroupFor("vykres", ["bez.png"])).toBeNull();
  });
});
