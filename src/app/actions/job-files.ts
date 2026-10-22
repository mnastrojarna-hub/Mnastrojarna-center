"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { checkFeature } from "@/lib/auth/session";
import type { Feature } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/data/current-user";
import { logAudit } from "@/lib/audit";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { FILE_KINDS, guessFileKind, isJobFileKind, JOB_FILE_MAX_BYTES } from "@/lib/jobs/file-kinds";
import {
  isUuid, isValidJobFilePath, jobFilePath, cleanText, cleanNumber, rowToJobFile, JOB_FILE_SELECT,
  isGenericCaptureName, translateDbError, type FileRow,
} from "@/lib/jobs/mapping";
import type { JobFileKind } from "@/lib/supabase/database.types";
import type { ActionResult, JobFile } from "@/lib/jobs/types";

/**
 * Dokumenty zakázky. Soubor jde z prohlížeče PŘÍMO do Supabase Storage
 * (Vercel omezuje tělo požadavku na 4,5 MB — fotky z mobilu a 3D modely jsou větší):
 * 1) createJobFileUpload → podepsaná URL pro nahrání, 2) upload z prohlížeče,
 * 3) registerJobFile → záznam v job_files (verze, archiv, historie).
 */

const BUCKET = "job-files";
const FILE_NOT_FOUND = "Dokument nenalezen.";

interface Ctx {
  db: JobsDb;
  user: CurrentUser;
}

async function begin(feature: Feature = "orders"): Promise<Ctx | { error: string }> {
  if (!isSupabaseConfigured()) return { error: "Supabase není nakonfigurováno." };
  const access = await checkFeature(feature);
  if ("error" in access) return { error: access.error };
  const db = await createOperatorClient();
  return { db, user: access.user };
}

function fail(err: unknown): { ok: false; error: string } {
  if (typeof err === "string") return { ok: false, error: translateDbError(err) };
  return { ok: false, error: err instanceof Error ? translateDbError(err.message) : "Neočekávaná chyba." };
}

function revalidateFiles(jobId: string) {
  revalidatePath("/orders");
  revalidatePath(`/orders/${jobId}`);
  revalidatePath("/documents");
}

function kindLabel(kind: JobFileKind): string {
  return (FILE_KINDS[kind] ?? FILE_KINDS.ostatni).label;
}

async function jobExists(db: JobsDb, jobId: string): Promise<boolean> {
  const { data } = await db.from("orders").select("id").eq("id", jobId).maybeSingle();
  return Boolean(data);
}

async function loadFile(db: JobsDb, fileId: string): Promise<FileRow | null> {
  const { data, error } = await db.from("job_files").select(JOB_FILE_SELECT).eq("id", fileId).maybeSingle();
  if (error) console.error(`[job-files] Načtení dokumentu selhalo: ${error.message}`);
  return (data as FileRow | null) ?? null;
}

const MAX_NAME = 255;

export async function createJobFileUpload(input: {
  jobId: string;
  filename: string;
  size: number;
  mimeType?: string;
}): Promise<ActionResult<{ path: string; token: string; bucket: string }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!input || !isUuid(input.jobId)) return fail("Neplatná zakázka.");
  const filename = cleanText(input.filename, MAX_NAME);
  if (!filename) return fail("Chybí název souboru.");
  const size = cleanNumber(input.size);
  if (size === null || size <= 0) return fail("Soubor je prázdný.");
  if (size > JOB_FILE_MAX_BYTES) {
    return fail(`Soubor je příliš velký (max. ${Math.round(JOB_FILE_MAX_BYTES / 1024 / 1024)} MB).`);
  }
  try {
    if (!(await jobExists(c.db, input.jobId))) return fail("Zakázka nenalezena.");
    const path = jobFilePath(input.jobId, crypto.randomUUID(), filename);
    const { data, error } = await c.db.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data?.token) return fail(error?.message ?? "Nepodařilo se připravit nahrání souboru.");
    return { ok: true, path: (data.path as string | undefined) ?? path, token: data.token as string, bucket: BUCKET };
  } catch (err) {
    return fail(err);
  }
}

export async function registerJobFile(input: {
  jobId: string;
  path: string;
  filename: string;
  mimeType?: string;
  size?: number;
  kind?: JobFileKind;
  title?: string;
  quoteId?: string;
  note?: string;
  replaceFileId?: string;
  aiExtracted?: Record<string, unknown> | null;
  aiConfidence?: number | null;
}): Promise<ActionResult<{ file: JobFile }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!input || !isUuid(input.jobId)) return fail("Neplatná zakázka.");
  const jobId = input.jobId.toLowerCase();
  if (!isValidJobFilePath(jobId, input.path)) return fail("Neplatná cesta souboru.");
  const filename = cleanText(input.filename, MAX_NAME);
  if (!filename) return fail("Chybí název souboru.");
  if (input.kind !== undefined && !isJobFileKind(input.kind)) return fail("Neznámý druh dokumentu.");
  if (input.replaceFileId !== undefined && input.replaceFileId !== "" && !isUuid(input.replaceFileId)) return fail(FILE_NOT_FOUND);
  if (input.quoteId !== undefined && input.quoteId !== "" && !isUuid(input.quoteId)) return fail("Neplatná nabídka.");
  const size = cleanNumber(input.size);
  if (size !== null && (size < 0 || size > JOB_FILE_MAX_BYTES)) return fail("Neplatná velikost souboru.");
  let aiExtracted: Record<string, unknown> | null = null;
  if (input.aiExtracted !== undefined && input.aiExtracted !== null) {
    if (typeof input.aiExtracted !== "object" || Array.isArray(input.aiExtracted)) return fail("Neplatná data z AI.");
    if (JSON.stringify(input.aiExtracted).length > 200_000) return fail("Data z AI jsou příliš velká.");
    aiExtracted = input.aiExtracted;
  }
  const aiConf = cleanNumber(input.aiConfidence);

  try {
    const { db, user } = c;
    if (!(await jobExists(db, jobId))) return fail("Zakázka nenalezena.");

    // opakovaná registrace stejného souboru → vrátit existující záznam
    const { data: dup } = await db.from("job_files").select(JOB_FILE_SELECT).eq("storage_path", input.path).maybeSingle();
    if (dup) return { ok: true, file: rowToJobFile(dup as FileRow) };

    if (input.quoteId) {
      const { data: q } = await db.from("quotes").select("id").eq("id", input.quoteId).eq("job_id", jobId).maybeSingle();
      if (!q) return fail("Nabídka nepatří k této zakázce.");
    }

    const mimeType = cleanText(input.mimeType, 200);
    let replaced: FileRow | null = null;
    if (input.replaceFileId) {
      replaced = await loadFile(db, input.replaceFileId);
      if (!replaced || replaced.job_id !== jobId) return fail("Původní dokument nenalezen.");
      // nahrazuje se vždy nejnovější verze řetězu
      for (let hops = 0; replaced.replaced_by && hops < 50; hops++) {
        const next = await loadFile(db, replaced.replaced_by);
        if (!next || next.job_id !== jobId) break;
        replaced = next;
      }
    }
    const kind: JobFileKind = input.kind ?? (replaced && isJobFileKind(replaced.kind) ? replaced.kind : guessFileKind(filename, mimeType ?? undefined));
    if (!replaced && !isGenericCaptureName(filename)) {
      // stejný druh + stejný název → automaticky nová verze (ne u „image.jpg" z fotoaparátu)
      const { data: same } = await db
        .from("job_files")
        .select(JOB_FILE_SELECT)
        .eq("job_id", jobId)
        .eq("kind", kind)
        .eq("filename", filename)
        .eq("archived", false)
        .order("version", { ascending: false })
        .limit(1);
      replaced = ((same ?? []) as FileRow[])[0] ?? null;
    }

    const version = replaced ? (replaced.version ?? 1) + 1 : 1;
    const title = input.title !== undefined ? cleanText(input.title, 300) : (replaced?.title ?? null);
    const { data: created, error } = await db
      .from("job_files")
      .insert({
        job_id: jobId,
        kind,
        title,
        filename,
        mime_type: mimeType,
        size_bytes: size === null ? null : Math.round(size),
        storage_path: input.path,
        version,
        archived: false,
        quote_id: input.quoteId || null,
        ai_extracted: aiExtracted,
        ai_confidence: aiConf === null ? null : Math.round(Math.min(1, Math.max(0, aiConf)) * 1000) / 1000,
        note: cleanText(input.note, 2000),
        uploaded_by: user.id,
      } as never)
      .select(JOB_FILE_SELECT)
      .single();
    if (error || !created) return fail(error?.message ?? "Dokument se nepodařilo uložit.");
    const row = created as FileRow;

    if (replaced) {
      const { error: upErr } = await db
        .from("job_files")
        .update({ archived: true, replaced_by: row.id } as never)
        .eq("id", replaced.id);
      if (upErr) console.error(`[job-files] Archivace předchozí verze selhala: ${upErr.message}`);
    }

    await logJobEvent(db, {
      jobId, type: "file",
      message: `Nahrán dokument: ${kindLabel(kind)} — ${filename}${version > 1 ? ` (v${version})` : ""}`,
      data: { fileId: row.id, kind, filename, version, ...(replaced ? { replacedFileId: replaced.id } : {}) },
      actorId: user.id,
    });
    revalidateFiles(jobId);
    return { ok: true, file: rowToJobFile(row) };
  } catch (err) {
    return fail(err);
  }
}

export async function setJobFileArchived(fileId: string, archived: boolean): Promise<ActionResult> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(fileId)) return fail(FILE_NOT_FOUND);
  try {
    const file = await loadFile(c.db, fileId);
    if (!file) return fail(FILE_NOT_FOUND);
    const { error } = await c.db.from("job_files").update({ archived: Boolean(archived) } as never).eq("id", fileId);
    if (error) return fail(error.message);
    const kind = isJobFileKind(file.kind) ? file.kind : "ostatni";
    await logJobEvent(c.db, {
      jobId: file.job_id, type: "file",
      message: `${archived ? "Dokument archivován" : "Dokument obnoven z archivu"}: ${kindLabel(kind)} — ${file.filename}`,
      data: { fileId, action: archived ? "archived" : "unarchived" }, actorId: c.user.id,
    });
    revalidateFiles(file.job_id);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function updateJobFile(
  fileId: string,
  patch: { kind?: JobFileKind; title?: string; note?: string },
): Promise<ActionResult> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(fileId)) return fail(FILE_NOT_FOUND);
  if (!patch || typeof patch !== "object") return fail("Chybí změny.");
  if (patch.kind !== undefined && !isJobFileKind(patch.kind)) return fail("Neznámý druh dokumentu.");
  try {
    const file = await loadFile(c.db, fileId);
    if (!file) return fail(FILE_NOT_FOUND);
    const update: Record<string, unknown> = {};
    if (patch.kind !== undefined && patch.kind !== file.kind) update.kind = patch.kind;
    if (patch.title !== undefined && cleanText(patch.title, 300) !== (file.title ?? null)) update.title = cleanText(patch.title, 300);
    if (patch.note !== undefined && cleanText(patch.note, 2000) !== (file.note ?? null)) update.note = cleanText(patch.note, 2000);
    if (!Object.keys(update).length) return { ok: true };
    const { error } = await c.db.from("job_files").update(update as never).eq("id", fileId);
    if (error) return fail(error.message);

    const parts: string[] = [];
    if (update.kind) {
      const from = isJobFileKind(file.kind) ? file.kind : "ostatni";
      parts.push(`druh ${kindLabel(from)} → ${kindLabel(update.kind as JobFileKind)}`);
    }
    if ("title" in update) parts.push("název");
    if ("note" in update) parts.push("poznámka");
    await logJobEvent(c.db, {
      jobId: file.job_id, type: "file",
      message: `Dokument ${file.filename} upraven: ${parts.join(", ")}`,
      data: { fileId, action: "updated", ...update }, actorId: c.user.id,
    });
    revalidateFiles(file.job_id);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteJobFile(fileId: string): Promise<ActionResult> {
  const c = await begin("delete");
  if ("error" in c) return fail(c.error);
  if (!isUuid(fileId)) return fail(FILE_NOT_FOUND);
  try {
    const { db, user } = c;
    const file = await loadFile(db, fileId);
    if (!file) return fail(FILE_NOT_FOUND);

    // smazání nejnovější verze → předchozí verze se zase stane aktuální
    const { data: prev } = file.archived
      ? { data: [] }
      : await db.from("job_files").select("id").eq("replaced_by", fileId);
    const prevIds = ((prev ?? []) as { id: string }[]).map((r) => r.id);

    const { error } = await db.from("job_files").delete().eq("id", fileId);
    if (error) return fail(error.message);
    if (prevIds.length) {
      const { error: restErr } = await db.from("job_files").update({ archived: false, replaced_by: null } as never).in("id", prevIds);
      if (restErr) console.error(`[job-files] Obnovení předchozí verze selhalo: ${restErr.message}`);
    }

    if (file.storage_path) {
      try {
        const { error: stErr } = await db.storage.from(BUCKET).remove([file.storage_path]);
        if (stErr) console.error(`[job-files] Mazání z úložiště selhalo: ${stErr.message}`);
      } catch (e) {
        console.error(`[job-files] Mazání z úložiště selhalo: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const kind = isJobFileKind(file.kind) ? file.kind : "ostatni";
    await logAudit({
      action: "job_file_deleted", entity: "job_files", entityId: fileId,
      diff: { jobId: file.job_id, filename: file.filename, kind, version: file.version ?? 1 },
    });
    await logJobEvent(db, {
      jobId: file.job_id, type: "file",
      message: `Dokument smazán: ${kindLabel(kind)} — ${file.filename}`,
      data: { fileId, action: "deleted" }, actorId: user.id,
    });
    revalidateFiles(file.job_id);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function getJobFileUrl(
  fileId: string,
  opts: { download?: boolean } = {},
): Promise<ActionResult<{ url: string }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(fileId)) return fail(FILE_NOT_FOUND);
  try {
    const file = await loadFile(c.db, fileId);
    if (!file?.storage_path) return fail(FILE_NOT_FOUND);
    const { data, error } = await c.db.storage
      .from(BUCKET)
      .createSignedUrl(file.storage_path, 300, opts.download ? { download: file.filename } : undefined);
    if (error || !data?.signedUrl) return fail(error?.message ?? "Odkaz na soubor se nepodařilo vytvořit.");
    return { ok: true, url: data.signedUrl as string };
  } catch (err) {
    return fail(err);
  }
}
