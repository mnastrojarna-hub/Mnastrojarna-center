import "server-only";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { unzipSync } from "fflate";
import type Anthropic from "@anthropic-ai/sdk";
import type { JobsDb } from "@/lib/jobs/events";
import type { BatchFile, BatchPage, CadFormat } from "@/lib/jobs/capture-batch-types";
import { CAPTURE_BUCKET, capturePagePath, sniffDocumentMime, type CaptureFileRef } from "@/lib/jobs/capture-review";
import { cadFormatOf, fileExtension, isDrawingFormat, isZipHead, stepPartNumber } from "@/lib/jobs/capture-batch";
import { CAD_EXTENSIONS } from "@/lib/jobs/file-kinds";
import { imageTokens, pdfPageTokens, type ClassifyFileNote, type ClassifyPage } from "@/lib/ai/batch-classifier";

/**
 * Dávkové focení — příprava souborů na serveru: rozpoznání druhu (obsah > přípona), CAD formát a číslo
 * dílu z hlavičky STEP, rozbalení ZIPu (limity proti ZIP bombě, názvy z Průzkumníka Windows v CP852),
 * počet stran PDF a jejich řez (pdf-lib), rozměry fotek, sloučení fotek vícestránkového dokladu do PDF
 * a bloky pro AI (náhledy pro roztřídění, originály pro vytěžení).
 */

export const HEAD_BYTES = 65_536;
/** Strop stahování v /analyze (dávka). */
export const ANALYZE_DOWNLOAD_CAP = 150 * 1024 * 1024;
/** Menší soubory se stahují celé (přesný SHA-256), větší CAD / kancelář jen hlavička. */
const FULL_HASH_MAX = 8 * 1024 * 1024;
export const ZIP_MAX_ENTRIES = 40;
/** Nejvýš souborů dávky po rozbalení ZIPů (víc dokladů roztřídění nezvládne). */
export const BATCH_MAX_FILES_UNZIPPED = 80;
export const ZIP_MAX_TOTAL = 100 * 1024 * 1024;
export const ZIP_MAX_ENTRY = 50 * 1024 * 1024;
export const AI_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const AI_MAX_IMAGE_SIDE = 8000;
/** > 20 obrázků v požadavku ⇒ každý ≤ 2000 px. */
export const AI_MANY_IMAGES_SIDE = 2000;
/** Strop vysokého rozlišení obrázku pro AI. */
export const AI_HIGH_RES_SIDE = 2576;
export const AI_MAX_DOC_BYTES = 22 * 1024 * 1024;
export const AI_MAX_DOC_IMAGES = 20;

const AI_IMAGE_MIMES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// ── Rozměry obrázků ─────────────────────────────────────────
/** Šířka × výška z hlavičky JPEG (SOF0/2), PNG (IHDR), WebP (VP8 / VP8L / VP8X); null = nepoznáno. */
export function imageDimensions(b: Uint8Array): { width: number; height: number } | null {
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const w = (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19];
    const h = (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23];
    return w > 0 && h > 0 ? { width: w >>> 0, height: h >>> 0 } : null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) { i += marker === 0xff ? 1 : 2; continue; }
      const len = (b[i + 2] << 8) | b[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const h = (b[i + 5] << 8) | b[i + 6];
        const w = (b[i + 7] << 8) | b[i + 8];
        return w > 0 && h > 0 ? { width: w, height: h } : null;
      }
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  }
  if (b.length >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === "VP8 ") {
      const w = ((b[27] << 8) | b[26]) & 0x3fff;
      const h = ((b[29] << 8) | b[28]) & 0x3fff;
      return w && h ? { width: w, height: h } : null;
    }
    if (chunk === "VP8L") {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") {
      const w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
      const h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
      return { width: w, height: h };
    }
  }
  return null;
}

// ── ZIP ─────────────────────────────────────────────────────
const CP852_HIGH =
  "ÇüéâäůćçłëŐőîŹÄĆÉĹĺôöĽľŚśÖÜŤťŁ×čáíóúĄąŽžĘę¬źČş«»░▒▓│┤ÁÂĚŞ╣║╗╝Żż┐└┴┬├─┼Ăă╚╔╩╦╠═╬¤đĐĎËďŇÍÎě┘┌█▄ŢŮ▀ÓßÔŃńňŠšŔÚŕŰýÝţ´\u00ad˝˛ˇ˘§÷¸°¨˙űŘř■\u00a0";

function latin1(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

/**
 * Název položky ZIPu ze surových bajtů: příznak UTF-8 → UTF-8; platné UTF-8 → UTF-8; jinak CP852
 * (Průzkumník Windows). Řetězec = bajty jako latin1 (tak ho vrací fflate bez příznaku).
 */
export function decodeZipName(raw: Uint8Array | string, utf8Flag = false): string {
  const bytes = typeof raw === "string"
    ? ([...raw].some((c) => c.charCodeAt(0) > 0xff) ? new TextEncoder().encode(raw) : Uint8Array.from(raw, (c) => c.charCodeAt(0)))
    : raw;
  if (utf8Flag || ![...bytes].some((b) => b >= 0x80)) return new TextDecoder("utf-8").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return Array.from(bytes, (b) => (b < 0x80 ? String.fromCharCode(b) : CP852_HIGH[b - 0x80])).join("");
  }
}

/** Názvy položek z centrálního adresáře ZIPu: klíč fflate → správně dekódovaný název. */
export function zipEntryNames(bytes: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let e = bytes.length - 22;
  while (e >= 0 && view.getUint32(e, true) !== 0x06054b50) {
    if (bytes.length - e > 65_558) return out;
    e--;
  }
  if (e < 0) return out;
  const count = view.getUint16(e + 10, true);
  let o = view.getUint32(e + 16, true);
  for (let i = 0; i < count && o + 46 <= bytes.length; i++) {
    if (view.getUint32(o, true) !== 0x02014b50) break;
    const flag = view.getUint16(o + 8, true);
    const nl = view.getUint16(o + 28, true);
    const el = view.getUint16(o + 30, true);
    const cl = view.getUint16(o + 32, true);
    const raw = bytes.subarray(o + 46, o + 46 + nl);
    const utf8 = (flag & 0x800) !== 0;
    const key = utf8 ? new TextDecoder("utf-8").decode(raw) : latin1(raw);
    out.set(key, decodeZipName(raw, utf8));
    o += 46 + nl + el + cl;
  }
  return out;
}

export type UnzipResult =
  | { ok: true; entries: { name: string; data: Uint8Array }[] }
  | { ok: false; reason: string; cadMajority: boolean; majorityFormat: CadFormat | null };

function skipEntry(name: string): boolean {
  const base = name.split("/").pop() ?? "";
  return name.endsWith("/") || name.startsWith("__MACOSX/") || name.includes("/__MACOSX/") || !base || base.startsWith(".");
}

/** Rozbalení ZIPu v limitech (počet, velikost deklarovaná i skutečná); nad limit = celý ZIP jako soubor. */
export function unzipLimited(bytes: Uint8Array): UnzipResult {
  const declared: { name: string; size: number }[] = [];
  try {
    unzipSync(bytes, {
      filter: (f) => {
        if (!skipEntry(f.name)) declared.push({ name: f.name, size: f.originalSize });
        return false;
      },
    });
  } catch {
    return { ok: false, reason: "ZIP je poškozený — přiložen celý.", cadMajority: false, majorityFormat: null };
  }
  const cadNames = declared.filter((d) => CAD_EXTENSIONS.includes(fileExtension(d.name)));
  const formats = cadNames.map((d) => cadFormatOf(d.name)).filter((f): f is CadFormat => Boolean(f));
  const majorityFormat = formats.sort((a, b) => formats.filter((x) => x === b).length - formats.filter((x) => x === a).length)[0] ?? null;
  const cadMajority = cadNames.length > declared.length / 2;
  const tooBig = (reason: string): UnzipResult => ({ ok: false, reason, cadMajority, majorityFormat });
  if (!declared.length) return tooBig("ZIP je prázdný — přiložen celý.");
  if (declared.length > ZIP_MAX_ENTRIES) return tooBig(`ZIP má víc než ${ZIP_MAX_ENTRIES} souborů — přiložen celý.`);
  const total = declared.reduce((s, d) => s + d.size, 0);
  if (total > ZIP_MAX_TOTAL || declared.some((d) => d.size > ZIP_MAX_ENTRY)) return tooBig("ZIP je po rozbalení příliš velký — přiložen celý.");
  let out: Record<string, Uint8Array>;
  try {
    out = unzipSync(bytes, {
      filter: (f) => !skipEntry(f.name) && f.originalSize <= ZIP_MAX_ENTRY,
    });
  } catch {
    return tooBig("ZIP nejde rozbalit — přiložen celý.");
  }
  const entries: { name: string; data: Uint8Array }[] = [];
  const names = zipEntryNames(bytes);
  let real = 0;
  for (const d of declared) {
    const data = out[d.name];
    if (!data) continue;
    if (data.length !== d.size) return tooBig("ZIP neodpovídá deklarovaným velikostem — přiložen celý.");
    real += data.length;
    if (real > ZIP_MAX_TOTAL) return tooBig("ZIP je po rozbalení příliš velký — přiložen celý.");
    const name = (names.get(d.name) ?? decodeZipName(d.name)).split("/").pop() ?? "soubor";
    entries.push({ name, data });
  }
  return { ok: true, entries };
}

// ── PDF ─────────────────────────────────────────────────────
export interface PdfInfo { pageCount: number; splittable: boolean; reason: string | null }

export async function pdfInfo(bytes: Uint8Array): Promise<PdfInfo> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    if (doc.isEncrypted) return { pageCount: Math.max(1, doc.getPageCount()), splittable: false, reason: "PDF je zaheslované — vyplň ručně." };
    return { pageCount: Math.max(1, doc.getPageCount()), splittable: true, reason: null };
  } catch {
    return { pageCount: 1, splittable: false, reason: "PDF je poškozené — vyplň ručně." };
  }
}

/** Nové PDF jen z vybraných stran (1-based). */
export async function extractPdfPages(bytes: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const out = await PDFDocument.create();
  const idx = pages.map((p) => p - 1).filter((i) => i >= 0 && i < src.getPageCount());
  const copied = await out.copyPages(src, idx);
  for (const p of copied) out.addPage(p);
  return out.save({ useObjectStreams: true });
}

/** A4 na výšku (nebo na šířku podle poměru) — fotky vícestránkového dokladu do jednoho PDF. */
export async function imagesToPdf(images: { bytes: Uint8Array; mime: string }[]): Promise<Uint8Array | null> {
  if (!images.length || images.some((i) => i.mime !== "image/jpeg" && i.mime !== "image/png")) return null;
  const doc = await PDFDocument.create();
  for (const img of images) {
    const embedded = img.mime === "image/png" ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
    const landscape = embedded.width > embedded.height;
    const [pw, ph] = landscape ? [841.89, 595.28] : [595.28, 841.89];
    const scale = Math.min(pw / embedded.width, ph / embedded.height);
    const w = embedded.width * scale;
    const h = embedded.height * scale;
    const page = doc.addPage([pw, ph]);
    page.drawImage(embedded, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }
  return doc.save({ useObjectStreams: true });
}

// ── Úložiště ────────────────────────────────────────────────
function bucket(db: JobsDb) {
  return db.storage.from(CAPTURE_BUCKET);
}

export async function downloadFull(db: JobsDb, path: string): Promise<Uint8Array | null> {
  try {
    const { data, error } = await bucket(db).download(path);
    if (error || !data) return null;
    return new Uint8Array(await (data as Blob).arrayBuffer());
  } catch {
    return null;
  }
}

/** Hlavička souboru (Range přes podepsanou URL; jinak celé stažení a ořez). */
export async function downloadHead(db: JobsDb, path: string, size: number): Promise<Uint8Array | null> {
  try {
    const { data } = await bucket(db).createSignedUrl(path, 60);
    const url = (data as { signedUrl?: string } | null)?.signedUrl;
    if (url) {
      const res = await fetch(url, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` } });
      if (res.ok || res.status === 206) {
        const buf = new Uint8Array(await res.arrayBuffer());
        return buf.length > HEAD_BYTES ? buf.subarray(0, HEAD_BYTES) : buf;
      }
    }
  } catch {
    // záloha níže
  }
  if (size > ZIP_MAX_ENTRY) return null;
  const full = await downloadFull(db, path);
  return full ? full.subarray(0, HEAD_BYTES) : null;
}

// ── Příprava dávky ──────────────────────────────────────────
export interface PreparedBatch {
  files: BatchFile[];
  pages: BatchPage[];
  /** Celý obsah obrázků a PDF (pro AI a řez) podle fileId. */
  contents: Map<string, Uint8Array>;
  /** Náhledy roztřídění (1280 px) podle fileId. */
  sortContents: Map<string, Uint8Array>;
  /** Rozměry obrázků podle fileId. */
  dims: Map<string, { width: number; height: number }>;
  /** Číslo dílu z hlavičky STEP podle fileId. */
  headNumbers: Record<string, string>;
  /** Úložiště: původní ZIPy k smazání (rozbaleno). */
  removePaths: string[];
  warnings: string[];
}

const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  heic: "image/heic", heif: "image/heif", stl: "model/stl", "3mf": "model/3mf", zip: "application/zip",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain", csv: "text/csv",
};

/** MIME podle přípony (položky ZIPu nemají typ). */
export function mimeFromName(name: string): string {
  return EXT_MIME[fileExtension(name)] ?? "application/octet-stream";
}

function isVisualHint(ref: CaptureFileRef): "image" | "pdf" | "zip" | "other" {
  const ext = fileExtension(ref.filename);
  const mime = ref.mimeType.toLowerCase();
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"].includes(ext)) return "image";
  if (mime === "application/zip" || mime === "application/x-zip-compressed" || ext === "zip") return "zip";
  return "other";
}

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

/**
 * Soubory relace → BatchFile + stránky. Obrázky a PDF se stáhnou celé (strop 150 MB), CAD / kancelář
 * jen hlavička. ZIP se rozbalí do capture/<uživatel>/… (nad limity zůstane celý jako soubor).
 */
export async function prepareBatchFiles(
  db: JobsDb,
  userId: string,
  refs: CaptureFileRef[],
  opts: { cap?: number } = {},
): Promise<PreparedBatch> {
  const cap = opts.cap ?? ANALYZE_DOWNLOAD_CAP;
  const out: PreparedBatch = {
    files: [], pages: [], contents: new Map(), sortContents: new Map(), dims: new Map(), headNumbers: {}, removePaths: [], warnings: [],
  };
  let downloaded = 0;
  const queue: (CaptureFileRef & { fromZip?: string | null; bytes?: Uint8Array; zipFormat?: CadFormat | null })[] = refs.map((r) => ({ ...r }));
  let fileNo = 0;
  while (queue.length) {
    const ref = queue.shift()!;
    const hint = isVisualHint(ref);
    let bytes: Uint8Array | null = ref.bytes ?? null;
    let head: Uint8Array | null = bytes ? bytes.subarray(0, HEAD_BYTES) : null;
    let full = Boolean(bytes);
    const wantFull = hint !== "other" || ref.size <= FULL_HASH_MAX;
    // strop paměti podle skutečných bajtů (velikost od klienta může lhát)
    if (!bytes && wantFull && downloaded + Math.max(ref.size, 1) <= cap) {
      bytes = await downloadFull(db, ref.path);
      if (bytes && downloaded + bytes.length > cap) {
        head = bytes.slice(0, HEAD_BYTES);
        ref.size = bytes.length;
        bytes = null;
        out.warnings.push(`${ref.filename} se do dávky nevešel celý — přiloží se jako soubor bez náhledu.`);
      } else if (bytes) {
        downloaded += bytes.length;
        ref.size = bytes.length;
        head = bytes.subarray(0, HEAD_BYTES);
        full = true;
      }
    }
    if (!head) head = await downloadHead(db, ref.path, ref.size);
    if (!head) {
      out.warnings.push(`Soubor ${ref.filename} se nepodařilo načíst z úložiště.`);
      continue;
    }
    const sniffed = sniffDocumentMime(head);
    // ZIP → rozbalit (3MF je ZIP, ale model)
    if (isZipHead(head) && fileExtension(ref.filename) !== "3mf" && !ref.fromZip && bytes && full) {
      const res = unzipLimited(bytes);
      const unzippedBytes = res.ok ? res.entries.reduce((n, e) => n + e.data.length, 0) : 0;
      if (res.ok && out.files.length + queue.length + res.entries.length > BATCH_MAX_FILES_UNZIPPED) {
        out.warnings.push(`${ref.filename}: po rozbalení by bylo víc než ${BATCH_MAX_FILES_UNZIPPED} souborů — přiložen celý.`);
      } else if (res.ok && downloaded + unzippedBytes > cap) {
        out.warnings.push(`${ref.filename} je po rozbalení příliš velký — přiložen celý.`);
      } else if (res.ok) {
        downloaded += unzippedBytes;
        const uploaded: typeof queue = [];
        let failed = false;
        for (const e of res.entries) {
          const path = capturePagePath(userId, crypto.randomUUID(), e.name);
          const mimeType = mimeFromName(e.name);
          const { error } = await bucket(db).upload(path, e.data, { contentType: mimeType, upsert: false });
          if (error) { failed = true; break; }
          uploaded.push({ path, filename: e.name, mimeType, size: e.data.length, fromZip: ref.filename, bytes: e.data });
        }
        if (!failed) {
          queue.unshift(...uploaded);
          out.removePaths.push(ref.path);
          continue;
        }
        await bucket(db).remove(uploaded.map((u) => u.path));
        out.warnings.push(`${ref.filename} se nepodařilo rozbalit — přiložen celý.`);
      } else if (!res.ok) {
        out.warnings.push(`${ref.filename}: ${res.reason}`);
        ref.zipFormat = res.cadMajority ? res.majorityFormat ?? "STEP" : null;
      }
    }
    const id = `f${++fileNo}`;
    const sha = full && bytes ? sha256Hex(bytes) : `p:${sha256Hex(new Uint8Array([...head, ...new TextEncoder().encode(`:${ref.size}`)]))}`;
    const base: BatchFile = {
      path: ref.path, filename: ref.filename, mimeType: ref.mimeType, size: ref.size,
      ...(ref.sortPath ? { sortPath: ref.sortPath } : {}),
      id, pageCount: 1, sniffedMime: sniffed, format: null, fromZip: ref.fromZip ?? null,
      splittable: false, aiReadable: false, aiSkipReason: null, sha256: sha,
    };
    if (sniffed === "application/pdf" && bytes) {
      const info = await pdfInfo(bytes);
      base.pageCount = info.pageCount;
      base.splittable = info.splittable;
      // zaheslované / poškozené PDF nejde rozdělit ani přečíst → 1 doklad, ruční vyplnění
      base.aiReadable = info.splittable;
      base.aiSkipReason = info.reason;
      out.contents.set(id, bytes);
      out.files.push(base);
      for (let p = 1; p <= base.pageCount; p++) {
        out.pages.push({
          id: "", fileId: id, page: p, source: "pdf_page",
          label: base.pageCount > 1 ? `${ref.filename} · str. ${p}/${base.pageCount}` : ref.filename,
          aiLabel: "", duplicateOf: null,
        });
      }
      continue;
    }
    if (sniffed && sniffed.startsWith("image/") && bytes) {
      const dim = imageDimensions(bytes);
      if (dim) out.dims.set(id, dim);
      const tooBig = bytes.length > AI_MAX_IMAGE_BYTES || Boolean(dim && Math.max(dim.width, dim.height) > AI_MAX_IMAGE_SIDE);
      base.aiReadable = AI_IMAGE_MIMES.includes(sniffed) && !tooBig;
      base.aiSkipReason = tooBig ? "Fotka je příliš velká — vyfoť znovu." : null;
      out.contents.set(id, bytes);
      if (ref.sortPath) {
        const sortBytes = await downloadFull(db, ref.sortPath);
        if (sortBytes && sniffDocumentMime(sortBytes) === "image/jpeg") out.sortContents.set(id, sortBytes);
      }
      out.files.push(base);
      out.pages.push({ id: "", fileId: id, page: 1, source: "image", label: ref.filename, aiLabel: "", duplicateOf: null });
      continue;
    }
    if (hint === "image" || hint === "pdf") {
      // HEIC, TIFF… — fotka bez AI (jako dnes)
      base.aiSkipReason = "Tenhle formát fotky AI nepřečte — vyplň ručně.";
      out.files.push(base);
      out.pages.push({ id: "", fileId: id, page: 1, source: "image", label: ref.filename, aiLabel: "", duplicateOf: null });
      continue;
    }
    base.format = ref.zipFormat ?? cadFormatOf(ref.filename, head, ref.size);
    if (base.format === "STEP") {
      const n = stepPartNumber(head);
      if (n) out.headNumbers[id] = n;
    }
    out.files.push(base);
    out.pages.push({ id: "", fileId: id, page: 1, source: "file", label: ref.filename, aiLabel: "", duplicateOf: null });
  }
  out.pages.forEach((p, i) => { p.id = `p${i + 1}`; });
  return out;
}

/** Popis souboru bez náhledu do promptu („3D model STEP, 1,2 MB"). */
export function fileNote(f: BatchFile, index: number): ClassifyFileNote {
  const what = f.format ? `${isDrawingFormat(f.format) ? "výkres" : "3D model"} ${f.format}` : "soubor";
  return { index, filename: f.filename, description: `${what}, ${sizeLabel(f.size)}` };
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** Blok obrázku pro AI (originál / náhled); null = nečitelné nebo nad limit. */
export function imageBlock(bytes: Uint8Array, maxSide: number | null): Anthropic.ContentBlockParam | null {
  const mime = sniffDocumentMime(bytes);
  if (!mime || !AI_IMAGE_MIMES.includes(mime) || bytes.length > AI_MAX_IMAGE_BYTES) return null;
  const dim = imageDimensions(bytes);
  if (maxSide && dim && Math.max(dim.width, dim.height) > maxSide) return null;
  return { type: "image", source: { type: "base64", media_type: mime as "image/jpeg", data: b64(bytes) } };
}

export function pdfBlock(bytes: Uint8Array): Anthropic.ContentBlockParam {
  return { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64(bytes) } };
}

/**
 * Strany pro roztřídění (S1…Sn): obrázek = náhled 1280 px (jinak originál ≤ 2000 px, jinak bez náhledu),
 * strana PDF = jednostránkové PDF. Soubory bez náhledu a nečitelné jdou jen jako poznámka F.
 */
export async function classifyPages(prep: PreparedBatch, maxPages: number): Promise<{ sent: ClassifyPage[]; truncated: string[]; notes: ClassifyFileNote[] }> {
  const sent: ClassifyPage[] = [];
  const truncated: string[] = [];
  const notes: ClassifyFileNote[] = [];
  const pdfCache = new Map<string, Uint8Array>();
  // > 20 obrázků v požadavku ⇒ každý ≤ 2000 px, jinak do stropu vysokého rozlišení
  const imageCount = prep.pages.filter((p) => p.source === "image" && prep.files.find((f) => f.id === p.fileId)?.aiReadable).length;
  const maxSide = imageCount > AI_MAX_DOC_IMAGES ? AI_MANY_IMAGES_SIDE : AI_HIGH_RES_SIDE;
  prep.files.forEach((f, i) => {
    const visual = prep.pages.some((p) => p.fileId === f.id && p.source !== "file");
    if (!visual || !f.aiReadable) notes.push(fileNote(f, i + 1));
  });
  for (const p of prep.pages) {
    if (p.source === "file") continue;
    const f = prep.files.find((x) => x.id === p.fileId)!;
    if (!f.aiReadable) continue;
    if (sent.length >= maxPages) { truncated.push(p.id); continue; }
    const label = p.source === "image" ? `${f.filename.slice(0, 80)}, fotka` : `${f.filename.slice(0, 80)}, str. ${p.page}/${f.pageCount}`;
    if (p.source === "image") {
      const sortBytes = prep.sortContents.get(f.id);
      const orig = prep.contents.get(f.id);
      const fromSort = sortBytes ? imageBlock(sortBytes, maxSide) : null;
      const block = fromSort || (orig ? imageBlock(orig, maxSide) : null);
      const used = block ? (fromSort ? sortBytes! : orig!) : null;
      const dim = used ? imageDimensions(used) : null;
      sent.push({ pageId: p.id, label, block, tokens: block ? imageTokens(dim?.width ?? null, dim?.height ?? null) : 50, bytes: used?.length ?? 0 });
      continue;
    }
    const bytes = prep.contents.get(f.id);
    if (!bytes) continue;
    let single = pdfCache.get(p.id);
    if (!single) {
      try {
        single = f.pageCount === 1 ? bytes : await extractPdfPages(bytes, [p.page]);
      } catch {
        single = undefined;
      }
    }
    if (!single) {
      sent.push({ pageId: p.id, label, block: null, tokens: 50, bytes: 0 });
      continue;
    }
    pdfCache.set(p.id, single);
    sent.push({ pageId: p.id, label, block: pdfBlock(single), tokens: pdfPageTokens(), bytes: single.length });
  }
  return { sent, truncated, notes };
}

export interface DocAiInput {
  files: { mediaType: string; dataBase64: string }[];
  /** Strany vynechané (nečitelné / nad limit). */
  skipped: number;
  truncated: boolean;
}

/**
 * Vstup vytěžení dokladu: jen jeho strany — strany PDF vyříznuté do nového PDF, fotky originály
 * (max. 20 obrázků, celkem ≤ 22 MB).
 */
export async function docAiInput(
  files: BatchFile[],
  pages: BatchPage[],
  pageIds: string[],
  contentOf: (f: BatchFile) => Promise<Uint8Array | null>,
): Promise<DocAiInput> {
  const out: DocAiInput = { files: [], skipped: 0, truncated: false };
  let total = 0;
  let images = 0;
  const docPages = pageIds.map((id) => pages.find((p) => p.id === id)).filter((p): p is BatchPage => Boolean(p));
  // strany PDF po souborech (zachovat pořadí dokladu)
  const runs: { file: BatchFile; pages: number[] }[] = [];
  for (const p of docPages) {
    const f = files.find((x) => x.id === p.fileId);
    if (!f || !f.aiReadable || p.source === "file") { out.skipped++; continue; }
    const last = runs[runs.length - 1];
    if (p.source === "pdf_page" && last && last.file.id === f.id) last.pages.push(p.page);
    else runs.push({ file: f, pages: [p.page] });
  }
  for (const r of runs) {
    const bytes = await contentOf(r.file);
    if (!bytes) { out.skipped += r.pages.length; continue; }
    if (sniffDocumentMime(bytes) === "application/pdf") {
      let pdf: Uint8Array = bytes;
      if (r.pages.length !== r.file.pageCount || r.pages.some((n, i) => n !== i + 1)) {
        try { pdf = await extractPdfPages(bytes, r.pages); } catch { out.skipped += r.pages.length; continue; }
      }
      if (total + pdf.length > AI_MAX_DOC_BYTES) { out.truncated = true; continue; }
      total += pdf.length;
      out.files.push({ mediaType: "application/pdf", dataBase64: b64(pdf) });
      continue;
    }
    const mime = sniffDocumentMime(bytes);
    if (!mime || !AI_IMAGE_MIMES.includes(mime)) { out.skipped++; continue; }
    if (images >= AI_MAX_DOC_IMAGES) { out.truncated = true; continue; }
    if (total + bytes.length > AI_MAX_DOC_BYTES) { out.truncated = true; continue; }
    images++;
    total += bytes.length;
    out.files.push({ mediaType: mime, dataBase64: b64(bytes) });
  }
  return out;
}
