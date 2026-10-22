import { createCaptureUpload, discardCapture } from "@/app/actions/capture";
import { createClient } from "@/lib/supabase/client";
import { downscaleImage, isDownscalableImage, jpegName } from "@/lib/jobs/upload-client";
import { JOB_FILE_MAX_BYTES } from "@/lib/jobs/file-kinds";
import type { CaptureDocKind, CaptureResult } from "@/lib/jobs/capture-types";
import type { AnalyzeCaptureResponse, CaptureFileRef, ReviewState, ReviewTarget } from "@/lib/jobs/capture-review";

/**
 * Prohlížeč ↔ server pro „Vyfotit doklad": stránky jdou přímo do Supabase Storage
 * (podepsaná URL), čtení a uložení přes /api/jobs/capture/*.
 */

export async function uploadCapturePage(file: File): Promise<{ ok: true; ref: CaptureFileRef } | { ok: false; error: string }> {
  try {
    let body: Blob = file;
    let filename = file.name || "doklad.jpg";
    let contentType = file.type || (/\.pdf$/i.test(filename) ? "application/pdf" : "image/jpeg");
    if (isDownscalableImage(file.type)) {
      const small = await downscaleImage(file);
      if (small !== file) {
        body = small;
        filename = jpegName(filename);
        contentType = "image/jpeg";
      }
    }
    if (body.size > JOB_FILE_MAX_BYTES) {
      return { ok: false, error: `Soubor je příliš velký (max. ${Math.round(JOB_FILE_MAX_BYTES / 1024 / 1024)} MB).` };
    }
    const prep = await createCaptureUpload({ filename, size: body.size, mimeType: contentType });
    if (!prep.ok || !prep.path || !prep.token || !prep.bucket) return { ok: false, error: prep.error ?? "Nahrání se nepodařilo připravit." };
    const { error } = await createClient().storage
      .from(prep.bucket)
      .uploadToSignedUrl(prep.path, prep.token, body, { contentType, upsert: false });
    if (error) {
      console.error(`[capture] Nahrání ${filename} selhalo: ${error.message}`);
      return { ok: false, error: "Nahrání selhalo — zkontroluj připojení a zkus to znovu." };
    }
    return { ok: true, ref: { path: prep.path, filename, mimeType: contentType, size: body.size } };
  } catch (err) {
    // technický detail jen do logu, uživateli srozumitelná česká hláška
    console.error(`[capture] Nahrání ${file.name} selhalo: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, error: "Nahrání selhalo — zkontroluj připojení a zkus to znovu." };
  }
}

async function postJson<T extends { ok: boolean; error?: string }>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
      cache: "no-store",
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

/** Zahodit nahrané stránky / rozpracovaný doklad (best-effort, na pozadí). */
export function discardCaptureQuietly(input: { captureId?: string | null; paths?: string[] }): void {
  if (!input.captureId && !input.paths?.length) return;
  discardCapture({ captureId: input.captureId ?? null, paths: input.paths ?? [] }).catch(() => {});
}
