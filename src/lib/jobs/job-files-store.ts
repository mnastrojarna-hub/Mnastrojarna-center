import "server-only";
import { revalidatePath } from "next/cache";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { FILE_KINDS, guessFileKind, isJobFileKind, JOB_FILE_MAX_BYTES } from "@/lib/jobs/file-kinds";
import {
  cleanNumber, cleanText, isGenericCaptureName, isUuid, isValidJobFilePath, rowToJobFile, translateDbError,
  JOB_FILE_SELECT, type FileRow,
} from "@/lib/jobs/mapping";
import type { DocIssuerKey, JobFileKind, JobFileOrigin } from "@/lib/supabase/database.types";
import type { ActionResult, JobFile } from "@/lib/jobs/types";

/**
 * Jádro registrace dokumentu zakázky (job_files) — sdílí server action registerJobFile
 * (oprávnění hlídá ona) a serverové toky (dávkové focení). Oprávnění tu NEhlídá nikdo:
 * volat jen z kódu, který už prošel checkFeature("orders").
 */

export interface RegisterJobFileInput {
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
  /** Bez vlastní události v historii (volající zapíše jednu souhrnnou). */
  silent?: boolean;
  /** Bez automatické nové verze podle stejného názvu. */
  noAutoVersion?: boolean;
  /** Položka zakázky, ke které dokument patří (výkres, model). */
  orderItemId?: string | null;
  /** Výkres v archivu. */
  drawingId?: string | null;
  /** Relace dávkového focení. */
  captureId?: string | null;
  /** SHA-256 obsahu (duplicity); „g:“ = otisk dat vystaveného dokladu (stejný obsah = žádná nová verze). */
  contentSha256?: string | null;
  /** Odkud dokument je (generated = náš doklad vystavený serverem — jen serverový kód). */
  origin?: JobFileOrigin | null;
  /** Kdo doklad vystavil (my / zákazník / dodavatel). */
  issuer?: DocIssuerKey | null;
  /** Revize objednávky, kterou náš doklad (potvrzení) pokrývá. */
  orderRevision?: number | null;
}

const ORIGINS: JobFileOrigin[] = ["generated", "upload", "capture", "email", "import"];
const ISSUERS: DocIssuerKey[] = ["my", "zakaznik", "dodavatel"];

const FILE_NOT_FOUND = "Dokument nenalezen.";
const MAX_NAME = 255;

function fail(err: unknown): { ok: false; error: string } {
  if (typeof err === "string") return { ok: false, error: translateDbError(err) };
  return { ok: false, error: err instanceof Error ? translateDbError(err.message) : "Neočekávaná chyba." };
}

function kindLabel(kind: JobFileKind): string {
  return (FILE_KINDS[kind] ?? FILE_KINDS.ostatni).label;
}

async function loadFile(db: JobsDb, fileId: string): Promise<FileRow | null> {
  const { data, error } = await db.from("job_files").select(JOB_FILE_SELECT).eq("id", fileId).maybeSingle();
  if (error) console.error(`[job-files] Načtení dokumentu selhalo: ${error.message}`);
  return (data as FileRow | null) ?? null;
}

function revalidateFiles(jobId: string) {
  try {
    revalidatePath("/orders");
    revalidatePath(`/orders/${jobId}`);
    revalidatePath("/documents");
  } catch {
    // mimo požadavek Next.js (testy) — nic
  }
}

/** Zapíše dokument zakázky (verze, archiv předchozí verze, událost). Opakovaná registrace téže cesty vrátí existující záznam. */
export async function registerJobFileCore(
  db: JobsDb,
  userId: string,
  input: RegisterJobFileInput,
): Promise<ActionResult<{ file: JobFile }>> {
  if (!input || !isUuid(input.jobId)) return fail("Neplatná zakázka.");
  const jobId = input.jobId.toLowerCase();
  if (!isValidJobFilePath(jobId, input.path)) return fail("Neplatná cesta souboru.");
  const filename = cleanText(input.filename, MAX_NAME);
  if (!filename) return fail("Chybí název souboru.");
  if (input.kind !== undefined && !isJobFileKind(input.kind)) return fail("Neznámý druh dokumentu.");
  if (input.replaceFileId !== undefined && input.replaceFileId !== "" && !isUuid(input.replaceFileId)) return fail(FILE_NOT_FOUND);
  if (input.quoteId !== undefined && input.quoteId !== "" && !isUuid(input.quoteId)) return fail("Neplatná nabídka.");
  for (const id of [input.orderItemId, input.drawingId, input.captureId]) {
    if (id !== undefined && id !== null && id !== "" && !isUuid(id)) return fail("Neplatná vazba dokumentu.");
  }
  const size = cleanNumber(input.size);
  if (size !== null && (size < 0 || size > JOB_FILE_MAX_BYTES)) return fail("Neplatná velikost souboru.");
  let aiExtracted: Record<string, unknown> | null = null;
  if (input.aiExtracted !== undefined && input.aiExtracted !== null) {
    if (typeof input.aiExtracted !== "object" || Array.isArray(input.aiExtracted)) return fail("Neplatná data z AI.");
    if (JSON.stringify(input.aiExtracted).length > 200_000) return fail("Data z AI jsou příliš velká.");
    aiExtracted = input.aiExtracted;
  }
  const aiConf = cleanNumber(input.aiConfidence);
  const sha = typeof input.contentSha256 === "string" && /^(p:|g:)?[0-9a-f]{64}$/.test(input.contentSha256) ? input.contentSha256 : null;
  if (input.origin !== undefined && input.origin !== null && !ORIGINS.includes(input.origin)) return fail("Neznámý původ dokumentu.");
  if (input.issuer !== undefined && input.issuer !== null && !ISSUERS.includes(input.issuer)) return fail("Neznámý vystavitel dokladu.");
  const orderRevision = cleanNumber(input.orderRevision);
  if (orderRevision !== null && (!Number.isInteger(orderRevision) || orderRevision < 1 || orderRevision > 10_000)) return fail("Neplatná revize objednávky.");

  try {
    const { data: job } = await db.from("orders").select("id").eq("id", jobId).maybeSingle();
    if (!job) return fail("Zakázka nenalezena.");

    // opakovaná registrace stejného souboru → vrátit existující záznam
    const { data: dup } = await db.from("job_files").select(JOB_FILE_SELECT).eq("storage_path", input.path).maybeSingle();
    if (dup) return { ok: true, file: rowToJobFile(dup as FileRow) };

    if (input.quoteId) {
      const { data: q } = await db.from("quotes").select("id").eq("id", input.quoteId).eq("job_id", jobId).maybeSingle();
      if (!q) return fail("Nabídka nepatří k této zakázce.");
    }
    if (input.orderItemId) {
      const { data: it } = await db.from("order_items").select("id").eq("id", input.orderItemId).eq("order_id", jobId).maybeSingle();
      if (!it) return fail("Položka nepatří k této zakázce.");
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
    if (!replaced && !input.noAutoVersion && !isGenericCaptureName(filename)) {
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
    const row: Record<string, unknown> = {
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
      uploaded_by: userId,
    };
    if (input.orderItemId) row.order_item_id = input.orderItemId.toLowerCase();
    if (input.drawingId) row.drawing_id = input.drawingId.toLowerCase();
    if (input.captureId) row.capture_id = input.captureId.toLowerCase();
    if (sha) row.content_sha256 = sha;
    if (input.origin) row.origin = input.origin;
    if (input.issuer) row.issuer = input.issuer;
    if (orderRevision !== null) row.order_revision = orderRevision;
    const { data: created, error } = await db.from("job_files").insert(row as never).select(JOB_FILE_SELECT).single();
    if (error || !created) {
      // souběžná registrace téže cesty → vrátit tu první
      const { data: again } = await db.from("job_files").select(JOB_FILE_SELECT).eq("storage_path", input.path).maybeSingle();
      if (again) return { ok: true, file: rowToJobFile(again as FileRow) };
      return fail(error?.message ?? "Dokument se nepodařilo uložit.");
    }
    const created1 = created as FileRow;

    if (replaced) {
      const { error: upErr } = await db
        .from("job_files")
        .update({ archived: true, replaced_by: created1.id } as never)
        .eq("id", replaced.id);
      if (upErr) console.error(`[job-files] Archivace předchozí verze selhala: ${upErr.message}`);
    }

    if (!input.silent) {
      await logJobEvent(db, {
        jobId, type: "file",
        message: `Nahrán dokument: ${kindLabel(kind)} — ${filename}${version > 1 ? ` (v${version})` : ""}`,
        data: { fileId: created1.id, kind, filename, version, ...(replaced ? { replacedFileId: replaced.id } : {}) },
        actorId: userId,
      });
    }
    revalidateFiles(jobId);
    return { ok: true, file: rowToJobFile(created1) };
  } catch (err) {
    return fail(err);
  }
}
