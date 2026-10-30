import { createJobFileUpload, registerJobFile } from "@/app/actions/job-files";
import { createClient } from "@/lib/supabase/client";
import { guessFileKind, JOB_FILE_MAX_BYTES } from "@/lib/jobs/file-kinds";
import { nudgeAnonymize } from "@/lib/anonymize/nudge-client";
import { prepareHiresMaster } from "@/lib/anonymize/hires-client";
import { CANDIDATE_KINDS } from "@/lib/anonymize/candidate";
import type { JobFileKind } from "@/lib/supabase/database.types";
import type { JobFile } from "@/lib/jobs/types";

/**
 * Nahrání dokumentu zakázky z prohlížeče: velké fotky se nejdřív zmenší,
 * soubor jde přímo do Supabase Storage (podepsaná URL), pak se zaregistruje.
 * U zmenšené fotky, která může být výkres, jde vedle ní i originál (master v plném rozlišení —
 * zdroj anonymizace); nezmenšená fotka je originál sama.
 */

export type UploadPhase = "zmenseni" | "nahravani" | "ukladani";

export interface UploadJobFileOptions {
  jobId: string;
  kind?: JobFileKind;
  title?: string;
  quoteId?: string;
  replaceFileId?: string;
  note?: string;
  onPhase?: (phase: UploadPhase) => void;
}

export interface UploadJobFileResult {
  ok: boolean;
  error?: string;
  file?: JobFile;
}

export const DOWNSCALE_MAX_SIDE = 2400;
export const DOWNSCALE_MIN_BYTES = 1.5 * 1024 * 1024;
const JPEG_QUALITY = 0.85;

/** Fotka, kterou má smysl zmenšovat (gif/svg ne). */
export function isDownscalableImage(type: string): boolean {
  const t = (type || "").toLowerCase();
  return t.startsWith("image/") && t !== "image/gif" && t !== "image/svg+xml";
}

/** Cílové rozměry (delší strana max. maxSide, poměr zachován). */
export function fitWithin(width: number, height: number, maxSide = DOWNSCALE_MAX_SIDE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (!longest || longest <= maxSide) return { width, height };
  const scale = maxSide / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** foto.HEIC → foto.jpg */
export function jpegName(filename: string): string {
  const base = filename.replace(/\.[^./\\]+$/, "") || "foto";
  return `${base}.jpg`;
}

async function canvasToJpeg(bitmap: ImageBitmap, width: number, height: number): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff"; // průhlednost PNG → bílé pozadí
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
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
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", JPEG_QUALITY));
}

/**
 * Zmenší velkou fotku (> 1,5 MB nebo delší strana > 2400 px) na JPEG 0,85.
 * Když prohlížeč obrázek neumí dekódovat (např. HEIC), vrátí originál.
 */
export async function downscaleImage(file: File): Promise<Blob> {
  if (!isDownscalableImage(file.type) || typeof createImageBitmap !== "function") return file;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const longest = Math.max(bitmap.width, bitmap.height);
    if (file.size <= DOWNSCALE_MIN_BYTES && longest <= DOWNSCALE_MAX_SIDE) return file;
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const blob = await canvasToJpeg(bitmap, width, height);
    if (!blob) return file;
    // zmenšení nepomohlo (už malý soubor bez nutnosti zmenšit rozměry)
    if (blob.size >= file.size && longest <= DOWNSCALE_MAX_SIDE) return file;
    return blob;
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}

/** Fotka, která může být výkresem zákazníka (anonymizace) — ne fotka dodacího listu / faktury. */
function mayBeDrawing(file: File, kind: JobFileKind | undefined): boolean {
  const k = kind ?? guessFileKind(file.name || "foto.jpg", file.type || undefined);
  return (CANDIDATE_KINDS as readonly string[]).includes(k);
}

export async function uploadJobFile(file: File, opts: UploadJobFileOptions): Promise<UploadJobFileResult> {
  try {
    let body: Blob = file;
    let filename = file.name || "soubor";
    let contentType = file.type || "application/octet-stream";
    let downscaled = false;

    if (isDownscalableImage(file.type)) {
      opts.onPhase?.("zmenseni");
      const small = await downscaleImage(file);
      if (small !== file) {
        body = small;
        filename = jpegName(filename);
        contentType = "image/jpeg";
        downscaled = true;
      }
    }
    if (body.size > JOB_FILE_MAX_BYTES) {
      return { ok: false, error: `Soubor ${file.name} je příliš velký (max. ${Math.round(JOB_FILE_MAX_BYTES / 1024 / 1024)} MB).` };
    }
    // zmenšená fotka výkresu: originál z fotoaparátu jde vedle ní (anonymizace v plném rozlišení)
    const master = downscaled && mayBeDrawing(file, opts.kind) ? prepareHiresMaster(file) : null;

    opts.onPhase?.("nahravani");
    const prep = await createJobFileUpload({
      jobId: opts.jobId, filename, size: body.size, mimeType: contentType,
      ...(master ? { master: { size: master.blob.size, mimeType: master.mime } } : {}),
    });
    if (!prep.ok || !prep.path || !prep.token || !prep.bucket) {
      return { ok: false, error: prep.error ?? "Nahrání se nepodařilo připravit." };
    }
    const storage = createClient().storage.from(prep.bucket);
    const withMaster = Boolean(master && prep.masterPath && prep.masterToken);
    const [main, side] = await Promise.all([
      storage.uploadToSignedUrl(prep.path, prep.token, body, { contentType, upsert: false }),
      withMaster ? storage.uploadToSignedUrl(prep.masterPath!, prep.masterToken!, master!.blob, { contentType: master!.mime, upsert: false }) : null,
    ]);
    if (main.error) return { ok: false, error: `Nahrání selhalo: ${main.error.message}` };
    // master je jen pomůcka — bez něj se fotka anonymizuje ze zmenšené kopie (ke kontrole)
    if (side?.error) console.error(`[upload] Originál ${file.name} se nenahrál: ${side.error.message}`);

    opts.onPhase?.("ukladani");
    const reg = await registerJobFile({
      jobId: opts.jobId,
      path: prep.path,
      filename,
      mimeType: contentType,
      size: body.size,
      kind: opts.kind,
      title: opts.title,
      quoteId: opts.quoteId,
      note: opts.note,
      replaceFileId: opts.replaceFileId,
      ...(withMaster && side && !side.error ? { master: true } : {}),
      ...(!downscaled && contentType.toLowerCase().startsWith("image/") ? { original: true } : {}),
    });
    if (!reg.ok || !reg.file) return { ok: false, error: reg.error ?? "Dokument se nepodařilo uložit." };
    // výkres čeká na anonymizaci → hned spustit zpracování na serveru (route, ne server action; bez čekání)
    if (reg.file.anon?.status === "pending" || reg.file.anon?.status === "processing") {
      void nudgeAnonymize({ jobId: opts.jobId, fileIds: [reg.file.id] });
    }
    return { ok: true, file: reg.file };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Nahrání selhalo." };
  }
}

/** Více souborů postupně (mobilní data — ne paralelně). */
export async function uploadJobFiles(
  files: File[],
  opts: UploadJobFileOptions & { onFile?: (index: number, file: File) => void },
): Promise<(UploadJobFileResult & { name: string })[]> {
  const results: (UploadJobFileResult & { name: string })[] = [];
  for (let i = 0; i < files.length; i++) {
    opts.onFile?.(i, files[i]);
    // replaceFileId dává smysl jen pro jeden soubor
    const res = await uploadJobFile(files[i], files.length > 1 ? { ...opts, replaceFileId: undefined } : opts);
    results.push({ ...res, name: files[i].name });
  }
  return results;
}
