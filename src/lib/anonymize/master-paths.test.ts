import { describe, it, expect } from "vitest";
import { hiresMime, prepareHiresMaster, HIRES_MAX_BYTES } from "./hires-client";
import { jobMasterPath } from "@/lib/jobs/mapping";
import { captureHiresPath, isCaptureHiresPath, isCapturePagePath } from "@/lib/jobs/capture-review";
import { drawingAiPath, drawingUploadPath, isDrawingAiPath, isDrawingUploadPath } from "@/lib/drawings/upload-paths";

/**
 * Master fotky v plném rozlišení a přímé nahrání do archivu výkresů — cesty jsou pevně odvozené z cesty
 * hlavního souboru (prohlížeč je nemůže namířit na cizí dokument).
 */

const JOB = "3f2b8c1e-1d2a-4c3b-9a8e-7f6d5c4b3a21";
const U = "11111111-2222-4333-8444-555555555555";
const F = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("hires-client (prohlížeč)", () => {
  it("originál JPEG / PNG / WebP / HEIC beze změny, typ i podle přípony", () => {
    const jpg = new File(["x".repeat(10)], "IMG_1.JPG", { type: "image/jpeg" });
    expect(prepareHiresMaster(jpg)).toEqual({ blob: jpg, mime: "image/jpeg" });
    expect(hiresMime({ type: "", name: "IMG_2.HEIC" })).toBe("image/heic");
    expect(hiresMime({ type: "application/octet-stream", name: "a.heif" })).toBe("image/heif");
    expect(hiresMime({ type: "image/png", name: "x" })).toBe("image/png");
    expect(hiresMime({ type: "image/jpg", name: "x" })).toBe("image/jpeg");
  });
  it("GIF, TIFF, PDF, prázdný a příliš velký soubor master nemají", () => {
    expect(prepareHiresMaster(new File(["x"], "a.gif", { type: "image/gif" }))).toBeNull();
    expect(prepareHiresMaster(new File(["x"], "a.tif", { type: "image/tiff" }))).toBeNull();
    expect(prepareHiresMaster(new File(["x"], "a.pdf", { type: "application/pdf" }))).toBeNull();
    expect(prepareHiresMaster(new File([], "a.jpg", { type: "image/jpeg" }))).toBeNull();
    const big = { size: HIRES_MAX_BYTES + 1, type: "image/jpeg", name: "a.jpg" } as unknown as File;
    expect(prepareHiresMaster(big)).toBeNull();
  });
});

describe("cesty masteru", () => {
  it("dokument zakázky → zakazky/<zakázka>/master/<uuid hlavního souboru>", () => {
    expect(jobMasterPath(`zakazky/${JOB}/${F}-foto.jpg`)).toBe(`zakazky/${JOB}/master/${F}`);
    expect(jobMasterPath(`zakazky/${JOB.toUpperCase()}/${F.toUpperCase()}-foto.jpg`)).toBe(`zakazky/${JOB}/master/${F}`);
    expect(jobMasterPath(`zakazky/${JOB}/master/${F}`)).toBeNull();
    expect(jobMasterPath(`capture/${U}/${F}-foto.jpg`)).toBeNull();
    expect(jobMasterPath(`zakazky/${JOB}/../${F}-foto.jpg`)).toBeNull();
  });
  it("focení → capture/<uživatel>/<uuid stránky>.hires, jen vlastní", () => {
    const page = `capture/${U}/${F}-foto.jpg`;
    expect(isCapturePagePath(U, page)).toBe(true);
    const h = captureHiresPath(page);
    expect(h).toBe(`capture/${U}/${F}.hires`);
    expect(isCaptureHiresPath(U, h)).toBe(true);
    expect(isCapturePagePath(U, h)).toBe(false);
    expect(isCaptureHiresPath("99999999-2222-4333-8444-555555555555", h)).toBe(false);
    expect(captureHiresPath(`capture/${U}/${F}.json`)).toBeNull();
    expect(isCaptureHiresPath(U, `capture/${U}/../${F}.hires`)).toBe(false);
  });
  it("archiv výkresů → vykresy/upload/<uživatel>/<uuid>.<přípona> + kopie pro AI", () => {
    const p = drawingUploadPath(U, F, "application/pdf");
    expect(p).toBe(`vykresy/upload/${U}/${F}.pdf`);
    expect(isDrawingUploadPath(U, p)).toBe(true);
    expect(isDrawingUploadPath("99999999-2222-4333-8444-555555555555", p)).toBe(false);
    expect(isDrawingUploadPath(U, `vykresy/upload/${U}/../x.pdf`)).toBe(false);
    expect(isDrawingUploadPath(U, `vykresy/${F}.pdf`)).toBe(false);
    const img = drawingUploadPath(U, F, "image/jpeg");
    expect(drawingAiPath(img)).toBe(`vykresy/upload/${U}/${F}.ai.jpg`);
    expect(isDrawingAiPath(img, `vykresy/upload/${U}/${F}.ai.jpg`)).toBe(true);
    expect(isDrawingAiPath(img, `vykresy/upload/${U}/${F}.jpg`)).toBe(false);
    expect(isDrawingUploadPath(U, drawingAiPath(img))).toBe(false);
  });
});
