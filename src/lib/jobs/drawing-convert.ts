import "server-only";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Access } from "@/lib/auth/session";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { assertJobFileAccess } from "@/lib/jobs/job-file-access";
import { registerJobFileCore } from "@/lib/jobs/job-files-store";
import { jobFilePath } from "@/lib/jobs/mapping";
import type { DocIssuerKey, JobFileOrigin } from "@/lib/supabase/database.types";
import type { JobFile } from "@/lib/jobs/types";
import { convertNote, isCadDrawingName, pdfNameFor } from "@/lib/jobs/drawing-convert-names";

/**
 * Výkres DXF / DWG zakázky → PDF (nový dokument zakázky, druh výkres). Server: stejná kontrola přístupu
 * jako otevření souboru (assertJobFileAccess „view"), originál se nemění. DXF čte dxf-parser, DWG
 * LibreDWG (WebAssembly z node_modules — next.config: serverExternalPackages + tracing), kreslí
 * lib/viewer3d/drawing-pdf (totéž co prohlížeč, včetně čísel kót).
 *
 * Vazba PDF → zdroj: job_files.source_file_id (migrace 20261107090000). Opakovaný převod téhož výkresu
 * (i jeho novější verze) = nová verze PDF; hromadný převod (skipIfConverted) výkres s PDF přeskočí.
 * Převedené PDF má původ a vystavitele zdroje (ne „generated") → anonymizace ho zařadí jako každý výkres.
 */

const BUCKET = "job-files";
const MAX_BYTES = 80 * 1024 * 1024;
/** Postgres: sloupec neexistuje (migrace ještě neproběhla) → bez vazby, převod funguje dál. */
const UNDEFINED_COLUMN = "42703";

export type ConvertOutcome =
  | { ok: true; skipped: false; file: JobFile; version: number; sheet: string; sourceName: string }
  | { ok: true; skipped: true; existing: { id: string; filename: string }; sourceName: string }
  | { ok: false; status: number; error: string };

interface SourceRow {
  id: string;
  job_id: string;
  filename: string;
  storage_path: string | null;
  archived: boolean | null;
  order_item_id: string | null;
  origin: string | null;
  issuer: string | null;
  size_bytes: number | string | null;
}

interface DerivedRow {
  id: string;
  filename: string;
  source_file_id: string | null;
  version: number | null;
}

const fail = (status: number, error: string): ConvertOutcome => ({ ok: false, status, error });

/** Id dokumentu a všech jeho starších verzí (řetěz replaced_by). */
async function versionChain(db: JobsDb, id: string): Promise<string[]> {
  const ids = [id];
  let frontier = [id];
  for (let hops = 0; hops < 30 && frontier.length; hops++) {
    const { data } = await db.from("job_files").select("id").in("replaced_by", frontier);
    frontier = ((data ?? []) as { id: string }[]).map((r) => r.id).filter((x) => !ids.includes(x));
    ids.push(...frontier);
  }
  return ids;
}

/** Aktuální PDF převedená z tohoto výkresu (nebo jeho starší verze); null = vazba v DB není (stará DB). */
async function derivedPdfs(db: JobsDb, chain: string[]): Promise<DerivedRow[] | null> {
  const { data, error } = await db.from("job_files").select("id, filename, source_file_id, version")
    .in("source_file_id", chain).eq("archived", false).order("created_at", { ascending: false });
  if (error) {
    if ((error as { code?: string }).code !== UNDEFINED_COLUMN) console.error(`[drawing-convert] Vazba PDF → výkres: ${error.message}`);
    return null;
  }
  return (data ?? []) as DerivedRow[];
}

/** Bez vazby v DB (před migrací): PDF stejného jména s poznámkou „Převedeno z …". */
async function derivedByName(db: JobsDb, jobId: string, sourceName: string): Promise<DerivedRow[]> {
  const { data } = await db.from("job_files").select("id, filename, version").eq("job_id", jobId).eq("archived", false)
    .eq("note", convertNote(sourceName));
  return ((data ?? []) as DerivedRow[]).map((r) => ({ ...r, source_file_id: null }));
}

export async function convertJobFileToPdf(
  db: JobsDb, userId: string, access: Pick<Access, "user" | "can">, fileId: string, opts: { skipIfConverted?: boolean } = {},
): Promise<ConvertOutcome> {
  const checked = await assertJobFileAccess(db, fileId, access, "view");
  if (!checked.ok) return fail(checked.status, checked.error);
  const { data: rowData } = await db.from("job_files")
    .select("id, job_id, filename, storage_path, archived, order_item_id, origin, issuer, size_bytes").eq("id", fileId).maybeSingle();
  const src = rowData as SourceRow | null;
  if (!src?.storage_path) return fail(404, "Dokument nenalezen.");
  if (!isCadDrawingName(src.filename)) return fail(415, "Na PDF jde převést jen výkres DXF nebo DWG.");
  if (Number(src.size_bytes ?? 0) > MAX_BYTES) return fail(413, "Výkres je na převod příliš velký — otevři ho v CAD programu a ulož jako PDF.");

  const chain = await versionChain(db, src.id);
  const linked = await derivedPdfs(db, chain);
  const derived = linked ?? (await derivedByName(db, src.job_id, src.filename));
  const own = derived.find((d) => d.source_file_id === src.id) ?? (linked === null ? derived[0] : undefined);
  if (opts.skipIfConverted && own) return { ok: true, skipped: true, existing: { id: own.id, filename: own.filename }, sourceName: src.filename };
  // starší verze výkresu už PDF má → nová verze téhož PDF
  const replace = own ?? derived[0] ?? null;

  const { data: blob, error: dlErr } = await db.storage.from(BUCKET).download(src.storage_path);
  if (dlErr || !blob) return fail(404, "Soubor výkresu v úložišti nenalezen.");
  const bytes = new Uint8Array(await blob.arrayBuffer());

  // výkres → 2D model (stejný parser jako prohlížeč) → PDF
  const [{ sniffFile }, { ModelImportError }, { drawingToPdf, EmptyDrawingError }] = await Promise.all([
    import("@/lib/viewer3d/sniff"), import("@/lib/viewer3d/types"), import("@/lib/viewer3d/drawing-pdf"),
  ]);
  const sniffed = sniffFile(bytes, src.filename);
  // podle obsahu; neznámý obsah → podle přípony (parser pak řekne, co je špatně)
  const format = sniffed.kind === "model" && (sniffed.format === "dxf" || sniffed.format === "dwg")
    ? sniffed.format : /\.dwg$/i.test(src.filename) ? "dwg" : "dxf";
  let pdf: { bytes: Uint8Array; sheet: string };
  try {
    let drawing;
    if (format === "dwg") {
      const { parseDwg } = await import("@/lib/viewer3d/formats/dwg");
      drawing = await parseDwg(bytes, path.join(process.cwd(), "node_modules", "@mlightcad", "libredwg-web", "wasm"));
    } else {
      const { parseDxf } = await import("@/lib/viewer3d/formats/dxf");
      drawing = parseDxf(bytes);
    }
    const font = new Uint8Array(await readFile(path.join(process.cwd(), "public", "fonts", "Roboto-Regular.ttf")));
    pdf = await drawingToPdf(drawing, { font, sourceName: src.filename });
  } catch (e) {
    if (e instanceof ModelImportError || e instanceof EmptyDrawingError) return fail(422, e.message);
    console.error(`[drawing-convert] ${src.filename}: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    return fail(500, "Výkres se nepodařilo převést na PDF (neočekávaná chyba).");
  }

  // název: nová verze drží jméno předchozího PDF; jinak základ výkresu, kolize s jiným dokumentem → „(z DXF)"
  let filename = replace?.filename ?? "";
  if (!filename) {
    const { data: same } = await db.from("job_files").select("filename").eq("job_id", src.job_id).eq("archived", false).ilike("filename", "%.pdf");
    const names = new Set(((same ?? []) as { filename: string }[]).map((r) => r.filename.toLowerCase()));
    filename = pdfNameFor(src.filename, (n) => names.has(n.toLowerCase()));
  }
  const storagePath = jobFilePath(src.job_id, randomUUID(), filename);
  const up = await db.storage.from(BUCKET).upload(storagePath, pdf.bytes, { contentType: "application/pdf", upsert: false });
  if (up.error) return fail(500, `PDF se nepodařilo uložit: ${up.error.message}`);

  const origin = (src.origin === "generated" || !src.origin ? "upload" : src.origin) as JobFileOrigin;
  const res = await registerJobFileCore(db, userId, {
    jobId: src.job_id, path: storagePath, filename, mimeType: "application/pdf", size: pdf.bytes.length, kind: "vykres",
    note: convertNote(src.filename), noAutoVersion: true, silent: true, replaceFileId: replace?.id,
    orderItemId: src.order_item_id ?? undefined, origin, issuer: (src.issuer as DocIssuerKey | null) ?? null,
  });
  if (!res.ok || !res.file) {
    await db.storage.from(BUCKET).remove([storagePath]);
    return fail(400, res.error ?? "PDF se nepodařilo zapsat k zakázce.");
  }
  const file = res.file;
  const { error: linkErr } = await db.from("job_files").update({ source_file_id: src.id } as never).eq("id", file.id);
  if (linkErr && (linkErr as { code?: string }).code !== UNDEFINED_COLUMN) console.error(`[drawing-convert] Vazba PDF → výkres: ${linkErr.message}`);
  await logJobEvent(db, {
    jobId: src.job_id, type: "file",
    message: `Výkres převeden do PDF: ${src.filename} → ${filename}${file.version > 1 ? ` (v${file.version})` : ""}`,
    data: { fileId: file.id, sourceFileId: src.id, filename, version: file.version, action: "converted_pdf" },
    actorId: userId,
  });
  return { ok: true, skipped: false, file, version: file.version, sheet: pdf.sheet, sourceName: src.filename };
}
