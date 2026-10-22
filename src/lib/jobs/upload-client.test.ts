import { describe, it, expect, vi, beforeEach } from "vitest";

const actions = vi.hoisted(() => ({
  createJobFileUpload: vi.fn(),
  registerJobFile: vi.fn(),
}));
const storage = vi.hoisted(() => ({ uploadToSignedUrl: vi.fn() }));

vi.mock("@/app/actions/job-files", () => actions);
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ storage: { from: () => storage } }),
}));

import { uploadJobFile, uploadJobFiles, downscaleImage, fitWithin, jpegName, isDownscalableImage } from "./upload-client";

const JOB = "3f2b8c1e-1d2a-4c3b-9a8e-7f6d5c4b3a21";

beforeEach(() => {
  actions.createJobFileUpload.mockReset().mockResolvedValue({ ok: true, path: `zakazky/${JOB}/x-a.pdf`, token: "t", bucket: "job-files" });
  actions.registerJobFile.mockReset().mockImplementation(async (i: { filename: string }) => ({
    ok: true, file: { id: "f1", filename: i.filename },
  }));
  storage.uploadToSignedUrl.mockReset().mockResolvedValue({ data: {}, error: null });
});

describe("pomocné funkce", () => {
  it("fitWithin", () => {
    expect(fitWithin(4800, 3600)).toEqual({ width: 2400, height: 1800 });
    expect(fitWithin(1000, 3000)).toEqual({ width: 800, height: 2400 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
  it("jpegName a typy", () => {
    expect(jpegName("IMG_001.HEIC")).toBe("IMG_001.jpg");
    expect(jpegName("bez")).toBe("bez.jpg");
    expect(isDownscalableImage("image/jpeg")).toBe(true);
    expect(isDownscalableImage("image/gif")).toBe(false);
    expect(isDownscalableImage("image/svg+xml")).toBe(false);
    expect(isDownscalableImage("application/pdf")).toBe(false);
  });
  it("bez createImageBitmap (server/test) vrátí originál", async () => {
    const f = new File(["x"], "a.jpg", { type: "image/jpeg" });
    expect(await downscaleImage(f)).toBe(f);
  });
});

describe("uploadJobFile", () => {
  it("projde přípravou, nahráním a registrací s fázemi", async () => {
    const phases: string[] = [];
    const f = new File(["%PDF"], "výkres.pdf", { type: "application/pdf" });
    const res = await uploadJobFile(f, { jobId: JOB, kind: "vykres", onPhase: (p) => phases.push(p) });
    expect(res.ok).toBe(true);
    expect(res.file?.id).toBe("f1");
    expect(phases).toEqual(["nahravani", "ukladani"]);
    expect(actions.createJobFileUpload).toHaveBeenCalledWith({ jobId: JOB, filename: "výkres.pdf", size: 4, mimeType: "application/pdf" });
    expect(storage.uploadToSignedUrl).toHaveBeenCalledWith(`zakazky/${JOB}/x-a.pdf`, "t", f, { contentType: "application/pdf", upsert: false });
    expect(actions.registerJobFile).toHaveBeenCalledWith(expect.objectContaining({ jobId: JOB, kind: "vykres", filename: "výkres.pdf", size: 4 }));
  });
  it("fotka projde fází zmenšení", async () => {
    const phases: string[] = [];
    await uploadJobFile(new File(["x"], "a.jpg", { type: "image/jpeg" }), { jobId: JOB, onPhase: (p) => phases.push(p) });
    expect(phases).toEqual(["zmenseni", "nahravani", "ukladani"]);
  });
  it("chyba přípravy se vrátí a nic se nenahraje", async () => {
    actions.createJobFileUpload.mockResolvedValue({ ok: false, error: "Bez oprávnění." });
    const res = await uploadJobFile(new File(["x"], "a.pdf"), { jobId: JOB });
    expect(res).toEqual({ ok: false, error: "Bez oprávnění." });
    expect(storage.uploadToSignedUrl).not.toHaveBeenCalled();
  });
  it("chyba nahrání do úložiště", async () => {
    storage.uploadToSignedUrl.mockResolvedValue({ data: null, error: { message: "403" } });
    const res = await uploadJobFile(new File(["x"], "a.pdf"), { jobId: JOB });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/403/);
    expect(actions.registerJobFile).not.toHaveBeenCalled();
  });
  it("více souborů postupně, replaceFileId jen u jednoho", async () => {
    const res = await uploadJobFiles(
      [new File(["a"], "a.pdf"), new File(["b"], "b.pdf")],
      { jobId: JOB, replaceFileId: "old" },
    );
    expect(res.map((r) => [r.name, r.ok])).toEqual([["a.pdf", true], ["b.pdf", true]]);
    expect(actions.registerJobFile.mock.calls.every((c) => c[0].replaceFileId === undefined)).toBe(true);
  });
});
