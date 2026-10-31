import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeVectorDrawing } from "./__fixtures__/samples";

/**
 * Bug z produkce (30. 10.): KAŽDÉ PDF skončilo „PDF je poškozené nebo zaheslované". Příčina: pdf.js je
 * v Next.js zabundlovaný a DOMMatrix / Path2D / ImageData si v Node doplňuje přes
 * createRequire(import.meta.url) → require("@napi-rs/canvas"). import.meta.url je v bundlu cesta ze
 * stroje BUILDU (/vercel/path0/…), ve funkci (/var/task) neexistuje → require selže, globály chybí a
 * vykreslení spadne na „Path2D is not defined".
 *
 * Test to věrně napodobí: pdf.js se načte z kopie MIMO node_modules (odkud @napi-rs/canvas nejde najít),
 * globály se předem smažou — anonymizace musí přesto projít (pdf-node je doplní z přímého importu).
 */

const KEYS = ["DOMMatrix", "Path2D", "ImageData"] as const;
const g = globalThis as Record<string, unknown>;

describe("pdf.js z bundlu bez dosažitelného @napi-rs/canvas (jako funkce na Vercelu)", () => {
  let dir = "";
  const saved: Record<string, unknown> = {};
  let savedWorker: unknown;

  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "pdfjs-bundle-"));
    const src = path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build");
    for (const f of ["pdf.mjs", "pdf.mjs.map", "pdf.worker.mjs", "pdf.worker.mjs.map"]) copyFileSync(path.join(src, f), path.join(dir, f));
    for (const k of KEYS) { saved[k] = g[k]; delete g[k]; }
    savedWorker = g.pdfjsWorker;
    delete g.pdfjsWorker;
    vi.resetModules();
    vi.doMock("pdfjs-dist/legacy/build/pdf.mjs", () => import(/* @vite-ignore */ path.join(dir, "pdf.mjs")));
    vi.doMock("pdfjs-dist/legacy/build/pdf.worker.mjs", () => import(/* @vite-ignore */ path.join(dir, "pdf.worker.mjs")));
  });

  afterAll(() => {
    vi.doUnmock("pdfjs-dist/legacy/build/pdf.mjs");
    vi.doUnmock("pdfjs-dist/legacy/build/pdf.worker.mjs");
    vi.resetModules();
    for (const k of KEYS) g[k] = saved[k];
    g.pdfjsWorker = savedWorker;
    rmSync(dir, { recursive: true, force: true });
  });

  it("globály chybí a pdf.js je sám doplnit nemůže → pdf-node je doplní dřív, než se pdf.js načte", async () => {
    for (const k of KEYS) expect(typeof g[k], k).toBe("undefined");
    const node = await import("./pdf-node");
    await node.loadPdfjs();
    const napi = await import("@napi-rs/canvas");
    expect(g.DOMMatrix).toBe(napi.DOMMatrix);
    expect(g.Path2D).toBe(napi.Path2D);
    expect(g.ImageData).toBe(napi.ImageData);
  }, 60_000);

  it("běžné vektorové PDF se v tomto prostředí vykreslí a anonymizuje (žádné „poškozené“)", async () => {
    const { anonymizePdf } = await import("./pdf-pipeline");
    const { ALL_REDACT, makeTerms } = await import("./rules");
    const s = await makeVectorDrawing({ withForm: false, withAttachment: false });
    const res = await anonymizePdf({
      bytes: s.pdf, ctx: { terms: makeTerms(["ACME Forge GmbH"], "crm"), keepTerms: ["Mnástrojárna"], redact: { ...ALL_REDACT } }, ai: null,
      verifyPhotos: true, fillPdf: "white", fillPhoto: "white", maxDpi: 150, maxMpx: 40, pageFrom: 1, deadline: Date.now() + 240_000,
    });
    expect(res.failure).toBeNull();
    expect(res.partPdf).toBeTruthy();
    expect(res.outputProblems).toEqual([]);
  }, 120_000);
});
