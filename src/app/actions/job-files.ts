"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { checkFeature, getAccess } from "@/lib/auth/session";
import { assertJobFileAccess, fileLock, FILE_PRICE_KIND, FILE_PRICE_VIEW } from "@/lib/jobs/job-file-access";
import { userActor } from "@/lib/supabase/actor-headers";
import type { Feature } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/data/current-user";
import { logAudit } from "@/lib/audit";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { FILE_KINDS, isJobFileKind, JOB_FILE_MAX_BYTES } from "@/lib/jobs/file-kinds";
import {
  isUuid, jobFilePath, cleanText, cleanNumber, JOB_FILE_SELECT, translateDbError, type FileRow,
} from "@/lib/jobs/mapping";
import type { DocIssuerKey, JobFileKind, JobFileOrigin } from "@/lib/supabase/database.types";
import type { ActionResult, JobFile } from "@/lib/jobs/types";
import { registerJobFileCore } from "@/lib/jobs/job-files-store";

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
  const db = await createOperatorClient({ actor: userActor(access.user) });
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
  /** Bez vlastní události v historii (volající zapíše jednu souhrnnou — např. foto dokladu). */
  silent?: boolean;
  /** Bez automatické nové verze podle stejného názvu (stránky dokladu, „scan.pdf" ze skeneru). */
  noAutoVersion?: boolean;
  /** Odkud dokument je — „generated“ (náš vystavený doklad) smí jen server (job-documents), ne prohlížeč. */
  origin?: Exclude<JobFileOrigin, "generated"> | null;
  /** Kdo doklad vystavil (my / zákazník / dodavatel). */
  issuer?: DocIssuerKey | null;
  /** Revize objednávky, ke které doklad patří. */
  orderRevision?: number | null;
}): Promise<ActionResult<{ file: JobFile }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!input || typeof input !== "object") return fail("Neplatná zakázka.");
  // náš vystavený doklad (potvrzení → „vystaveno“) zapisuje jen generateJobDocument přímo jádrem
  if ((input.origin as string | null | undefined) === "generated") return fail("Neplatný původ dokumentu.");
  // #25: doklad dodavatele k naší nabídce nepatří (jinak by se poslal jako „naše nabídka“ mimo schválení)
  if (input.issuer === "dodavatel" && input.quoteId) return fail("Nabídka dodavatele nepatří k naší nabídce.");
  // #25: nahradit (= archivovat) smí jen dokument, jehož obsah smí upravit (nákupní doklad jen s „margins")
  const access = await getAccess();
  if (input.replaceFileId) {
    const checked = await assertJobFileAccess(c.db, input.replaceFileId, access, "edit");
    if (!checked.ok) return fail(checked.error);
  }
  const replaceBlock = async (file: FileRow): Promise<string | null> => {
    const lock = await fileLock(c.db, {
      id: file.id, kind: file.kind, issuer: file.issuer ?? null, origin: file.origin ?? null,
      quoteId: file.quote_id ?? null, createdAt: file.created_at,
    }, access);
    return lock === "price" ? FILE_PRICE_VIEW : null;
  };
  // jádro (lib/jobs/job-files-store) — nové volby (vazba položky, relace focení) jen pro serverový kód
  return registerJobFileCore(c.db, c.user.id, {
    replaceBlock, dupOnlyOwn: true,
    jobId: input.jobId, path: input.path, filename: input.filename, mimeType: input.mimeType, size: input.size,
    kind: input.kind, title: input.title, quoteId: input.quoteId, note: input.note, replaceFileId: input.replaceFileId,
    aiExtracted: input.aiExtracted, aiConfidence: input.aiConfidence, silent: input.silent, noAutoVersion: input.noAutoVersion,
    origin: input.origin ?? null, issuer: input.issuer ?? null, orderRevision: input.orderRevision ?? null,
  });
}

export async function setJobFileArchived(fileId: string, archived: boolean): Promise<ActionResult> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(fileId)) return fail(FILE_NOT_FOUND);
  try {
    const checked = await assertJobFileAccess(c.db, fileId, await getAccess(), "edit");
    if (!checked.ok) return fail(checked.error);
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
    const access = await getAccess();
    const checked = await assertJobFileAccess(c.db, fileId, access, "edit");
    if (!checked.ok) return fail(checked.error);
    const file = await loadFile(c.db, fileId);
    if (!file) return fail(FILE_NOT_FOUND);
    const update: Record<string, unknown> = {};
    if (patch.kind !== undefined && patch.kind !== file.kind) {
      // #25: druh vystaveného dokladu (náš PDF) se nemění; nabídka / objednávka dodavateli = nákupní strana
      if (file.origin === "generated") return fail("Druh vystaveného dokladu nejde změnit.");
      const sensitive: string[] = ["nabidka", "objednavka_vydana"];
      if (!access.can("margins") && (sensitive.includes(file.kind) || sensitive.includes(patch.kind))) return fail(FILE_PRICE_KIND);
      update.kind = patch.kind;
    }
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
    // #25: nákupní doklad / neschválená či zastaralá nabídka — obsah zamčený
    const checked = await assertJobFileAccess(c.db, fileId, await getAccess(), "view");
    if (!checked.ok) return fail(checked.error);
    const file = checked.file;
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
