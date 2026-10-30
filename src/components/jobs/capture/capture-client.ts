import { createCaptureUpload, discardCapture } from "@/app/actions/capture";
import { createClient } from "@/lib/supabase/client";
import { downscaleImage, fitWithin, isDownscalableImage, jpegName } from "@/lib/jobs/upload-client";
import { prepareHiresMaster } from "@/lib/anonymize/hires-client";
import { CAPTURE_BATCH_MAX_FILE_BYTES, CAPTURE_SORT_SIDE } from "@/lib/jobs/capture-review";
import type { CaptureDocKind, CaptureResult } from "@/lib/jobs/capture-types";
import type {
  AnalyzeCaptureResponse, CaptureFileRef, ReviewOptions, ReviewState, ReviewTarget,
} from "@/lib/jobs/capture-review";
import type {
  BatchApplyState, BatchDocType, BatchResult, BatchReviewModel, BatchSort, BatchSortModel, DocExtractSummary,
} from "@/lib/jobs/capture-batch-types";

/**
 * Prohlížeč ↔ server pro „Vyfotit doklad": stránky jdou přímo do Supabase Storage
 * (podepsaná URL), čtení a uložení přes /api/jobs/capture/* (dávka /batch/*).
 */

const UPLOAD_FAILED = "Nahrání selhalo — zkontroluj připojení a zkus to znovu.";
const SORT_QUALITY = 0.8;

/** Typ obsahu pro úložiště (prohlížeč u CAD / ZIP typ často nehlásí). */
export function captureContentType(filename: string, type: string): string {
  const f = filename.toLowerCase();
  if (/\.pdf$/.test(f)) return "application/pdf";
  if (/\.stl$/.test(f)) return "model/stl";
  if (/\.3mf$/.test(f)) return "model/3mf";
  if (/\.zip$/.test(f)) return "application/zip";
  if (type) return type;
  if (/\.hei[cf]$/.test(f)) return "image/heic";
  if (/\.(jpe?g)$/.test(f)) return "image/jpeg";
  if (/\.png$/.test(f)) return "image/png";
  if (/\.webp$/.test(f)) return "image/webp";
  return "application/octet-stream";
}

/** Náhled fotky pro roztřídění (delší strana 1280 px, JPEG 0,8); null = prohlížeč ho neudělá. */
async function sortPreview(file: Blob): Promise<Blob | null> {
  if (typeof createImageBitmap !== "function") return null;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const { width, height } = fitWithin(bitmap.width, bitmap.height, CAPTURE_SORT_SIDE);
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      return await canvas.convertToBlob({ type: "image/jpeg", quality: SORT_QUALITY });
    }
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", SORT_QUALITY));
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

/**
 * Nahrání jedné stránky / souboru. Fotky: originál ≤ 2400 px (jako dřív) a k nim
 * náhled pro roztřídění (sortPath); ostatní soubory beze změny.
 */
export async function uploadCapturePage(
  file: File,
  opts: { sortPreview?: boolean; master?: boolean } = {},
): Promise<{ ok: true; ref: CaptureFileRef } | { ok: false; error: string }> {
  try {
    let body: Blob = file;
    let filename = file.name || "doklad.jpg";
    let contentType = captureContentType(filename, file.type);
    const image = isDownscalableImage(contentType);
    if (image) {
      const small = await downscaleImage(file);
      if (small !== file) {
        body = small;
        filename = jpegName(filename);
        contentType = "image/jpeg";
      }
    }
    if (body.size > CAPTURE_BATCH_MAX_FILE_BYTES) return { ok: false, error: "Soubor je větší než 50 MB." };
    const preview = image && opts.sortPreview !== false ? await sortPreview(body) : null;
    // fotka (může být výkres): originál z fotoaparátu vedle zmenšené stránky → anonymizace v plném rozlišení.
    // HEIC, který prohlížeč neumí zmenšit, je originál sám (server ho přečte celý).
    const master = image && opts.master !== false && !(body === file && /^image\/hei[cf]$/.test(contentType)) ? prepareHiresMaster(file) : null;
    const prep = await createCaptureUpload({
      filename, size: body.size, mimeType: contentType, sortPreview: Boolean(preview),
      ...(master ? { master: { size: master.blob.size, mimeType: master.mime } } : {}),
    });
    if (!prep.ok || !prep.path || !prep.token || !prep.bucket) return { ok: false, error: prep.error ?? "Nahrání se nepodařilo připravit." };
    const storage = createClient().storage.from(prep.bucket);
    // stránka, náhled roztřídění a master souběžně (mobilní data: jedno čekání místo tří)
    const withPreview = Boolean(preview && prep.sortPath && prep.sortToken);
    const withMaster = Boolean(master && prep.masterPath && prep.masterToken);
    const [main, side, hires] = await Promise.all([
      storage.uploadToSignedUrl(prep.path, prep.token, body, { contentType, upsert: false }),
      withPreview ? storage.uploadToSignedUrl(prep.sortPath!, prep.sortToken!, preview!, { contentType: "image/jpeg", upsert: false }) : null,
      withMaster ? storage.uploadToSignedUrl(prep.masterPath!, prep.masterToken!, master!.blob, { contentType: master!.mime, upsert: false }) : null,
    ]);
    if (main.error) {
      console.error(`[capture] Nahrání ${filename} selhalo: ${main.error.message}`);
      const extra = [...(withPreview && side && !side.error ? [prep.sortPath!] : []), ...(withMaster && hires && !hires.error ? [prep.masterPath!] : [])];
      if (extra.length) discardCaptureQuietly({ paths: extra });
      return { ok: false, error: UPLOAD_FAILED };
    }
    // master je jen pomůcka — bez něj se fotka anonymizuje ze zmenšené stránky (ke kontrole)
    if (withMaster && hires?.error) console.error(`[capture] Originál ${filename} se nenahrál: ${hires.error.message}`);
    let sortPath: string | null = null;
    if (withPreview && side) {
      // náhled je jen pomůcka — když se nenahraje, server použije originál
      if (side.error) console.error(`[capture] Náhled ${filename} se nenahrál: ${side.error.message}`);
      else sortPath = prep.sortPath!;
    }
    return { ok: true, ref: { path: prep.path, filename, mimeType: contentType, size: body.size, ...(sortPath ? { sortPath } : {}) } };
  } catch (err) {
    // technický detail jen do logu, uživateli srozumitelná česká hláška
    console.error(`[capture] Nahrání ${file.name} selhalo: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, error: UPLOAD_FAILED };
  }
}

/** SHA-256 obsahu (hex) — stejný soubor se do dávky nepřidá dvakrát. "" = prohlížeč neumí (http bez TLS). */
export async function fileSha256(file: File): Promise<string> {
  try {
    if (typeof crypto === "undefined" || !crypto.subtle) return "";
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return "";
  }
}

async function postJson<T extends { ok: boolean; error?: string }>(
  url: string,
  body: unknown,
  signal?: AbortSignal,
  extra: Pick<RequestInit, "keepalive"> = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
      cache: "no-store",
      ...extra,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return { ok: false, error: "Nepodařilo se spojit se serverem — zkontroluj připojení a zkus to znovu." } as T;
  }
  try {
    return (await res.json()) as T;
  } catch {
    const hint = res.status === 504 ? " (vypršel čas — zkus méně stránek)" : "";
    return { ok: false, error: `Server neodpověděl správně (HTTP ${res.status})${hint}. Zkus to znovu.` } as T;
  }
}

export function analyzeCaptureRequest(
  input: { files: CaptureFileRef[]; jobId?: string; expectedKind?: CaptureDocKind },
  signal?: AbortSignal,
): Promise<AnalyzeCaptureResponse> {
  return postJson<AnalyzeCaptureResponse>("/api/jobs/capture/analyze", input, signal);
}

export function applyCaptureRequest(captureId: string, state: ReviewState): Promise<CaptureResult> {
  return postJson<CaptureResult>("/api/jobs/capture/apply", { captureId, state });
}

export function captureTargetRequest(captureId: string, jobId: string): Promise<{ ok: boolean; error?: string; target?: ReviewTarget }> {
  return postJson("/api/jobs/capture/target", { captureId, jobId });
}

// ── Dávka ───────────────────────────────────────────────────
type Fail = { ok: false; error: string };

/** Obnova rozpracované dávky (sessionStorage → server). */
export function batchSessionRequest(captureId: string): Promise<{ ok: true; batch: BatchSortModel; extracts: DocExtractSummary[] } | Fail> {
  return postJson("/api/jobs/capture/batch/session", { captureId });
}

/** Vytěžení jednoho dokladu — bez abortu (server dočte i při zamčeném telefonu, výsledek si uloží). */
export function extractBatchDocRequest(input: {
  captureId: string;
  docId: string;
  type: BatchDocType;
  pageIds: string[];
  force?: boolean;
}): Promise<{ ok: true; summary: DocExtractSummary } | Fail> {
  return postJson("/api/jobs/capture/batch/extract", input, undefined, { keepalive: true });
}

export function batchReviewRequest(
  input: {
    captureId: string;
    sort: BatchSort;
    assign?: Record<string, string>;
    targets?: Record<string, string>;
    customerConfirmed?: string[];
  },
  signal?: AbortSignal,
): Promise<{ ok: true; review: BatchReviewModel } | Fail> {
  return postJson("/api/jobs/capture/batch/review", input, signal);
}

export function batchJobsRequest(q: string, signal?: AbortSignal): Promise<{ ok: true; jobs: ReviewOptions["jobs"] } | Fail> {
  return postJson("/api/jobs/capture/batch/jobs", { q }, signal);
}

/** Uložení dávky; chyba spojení = výsledek „failed" se stejným tvarem (dialog ho umí ukázat). */
export async function applyBatchRequest(captureId: string, state: BatchApplyState): Promise<BatchResult> {
  const res = await postJson<BatchResult | (Fail & Partial<BatchResult>)>("/api/jobs/capture/batch/apply", { captureId, state });
  if (Array.isArray(res.docs) && Array.isArray(res.groups) && res.status) return res as BatchResult;
  return {
    ok: false, status: "failed", error: res.error ?? "Uložení se nepodařilo.", aiUsed: false,
    groups: [], docs: [], pending: [], warnings: [],
  };
}

/** Zahodit nahrané stránky / rozpracovaný doklad (best-effort, na pozadí). */
export function discardCaptureQuietly(input: { captureId?: string | null; paths?: string[] }): void {
  if (!input.captureId && !input.paths?.length) return;
  discardCapture({ captureId: input.captureId ?? null, paths: input.paths ?? [] }).catch(() => {});
}
