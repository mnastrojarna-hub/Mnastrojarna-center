import "server-only";
import { logAudit } from "@/lib/audit";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { jobMasterPath } from "@/lib/jobs/mapping";
import { QUOTE_SENT_DELETE_BLOCK, quoteIsSent } from "@/lib/jobs/quote-files";
import type { QuoteStatus } from "@/lib/supabase/database.types";

/**
 * Server: nabídka ↔ její vystavená PDF (job_files.quote_id, kind nabidka, origin generated).
 * Pravidla v lib/jobs/quote-files (sdílená s UI); tady jejich provedení nad DB a úložištěm:
 *  - deleteJobQuote → smaže i všechna PDF nabídky (řádky + úložiště), nahrané soubory s vazbou jen odpojí (FK);
 *  - deleteJobFile → poslední PDF nabídky bere nabídku s sebou; jinak jen srovná quotes.storage_path.
 * Oprávnění („delete") a zámek odeslané nabídky ověřuje volající (quoteDeleteBlock).
 */

const BUCKET = "job-files";

export interface QuoteSyncRow {
  id: string;
  number: string | null;
  job_id: string | null;
  status: string | null;
  sent_at: string | null;
  storage_path: string | null;
  total: number | string | null;
}

const QUOTE_SYNC_SELECT = "id, number, job_id, status, sent_at, storage_path, total";

export async function loadQuoteForSync(db: JobsDb, quoteId: string): Promise<QuoteSyncRow | null> {
  const { data, error } = await db.from("quotes").select(QUOTE_SYNC_SELECT).eq("id", quoteId).maybeSingle();
  if (error) console.error(`[quote-file-sync] Načtení nabídky selhalo: ${error.message}`);
  return (data as QuoteSyncRow | null) ?? null;
}

/** Odeslanou nabídku smazat nejde (= menu Nabídky: „Smazat" jen bez sent_at). */
export function quoteDeleteBlock(q: Pick<QuoteSyncRow, "sent_at" | "status">): string | null {
  return quoteIsSent({ sentAt: q.sent_at, status: (q.status ?? "ke_schvaleni") as QuoteStatus }) ? QUOTE_SENT_DELETE_BLOCK : null;
}

export interface QuotePdfRow {
  id: string;
  filename: string;
  storage_path: string | null;
  anon_source_path: string | null;
  version: number | null;
  archived: boolean | null;
}

/** Vystavená PDF nabídky — všechny verze (i archivované), od nejstarší. */
export async function quotePdfRows(db: JobsDb, quoteId: string): Promise<QuotePdfRow[]> {
  const { data, error } = await db
    .from("job_files")
    .select("id, filename, storage_path, anon_source_path, version, archived")
    .eq("quote_id", quoteId).eq("kind", "nabidka").eq("origin", "generated")
    .order("version", { ascending: true }).order("created_at", { ascending: true });
  if (error) console.error(`[quote-file-sync] Načtení PDF nabídky selhalo: ${error.message}`);
  return ((data ?? []) as QuotePdfRow[]);
}

/** Objekty v úložišti k dokumentům (hlavní soubor + vlastní master fotky) — best effort, chyba jen do logu. */
export async function removeFileObjects(db: JobsDb, files: Pick<QuotePdfRow, "storage_path" | "anon_source_path">[]): Promise<void> {
  const paths = new Set<string>();
  for (const f of files) {
    if (!f.storage_path) continue;
    paths.add(f.storage_path);
    // master v plném rozlišení patří jen tomuto dokumentu (zakazky/<zakázka>/master/…)
    if (f.anon_source_path && f.anon_source_path === jobMasterPath(f.storage_path)) paths.add(f.anon_source_path);
  }
  if (!paths.size) return;
  try {
    const { error } = await db.storage.from(BUCKET).remove([...paths]);
    if (error) console.error(`[quote-file-sync] Mazání z úložiště selhalo: ${error.message}`);
  } catch (e) {
    console.error(`[quote-file-sync] Mazání z úložiště selhalo: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function quoteLabel(q: { number: string | null }): string {
  return q.number ? `Nabídka ${q.number}` : "Nabídka";
}

/**
 * Smaže nabídku (položky kaskádou, orders.quote_id set null) i její vystavená PDF (řádky + úložiště).
 * Nahrané soubory s vazbou na nabídku zůstanou (FK quote_id set null). Volající ověřil „delete"
 * a quoteDeleteBlock. `cause: "file"` = spouští smazání jejího posledního PDF v Dokumentech
 * (soubor už je pryč; do historie se zapíše, proč nabídka zmizela).
 */
export async function deleteQuoteWithPdfs(
  db: JobsDb,
  quote: QuoteSyncRow,
  actorId: string,
  opts: { cause: "quote" } | { cause: "file"; filename: string },
): Promise<{ ok: true; removedFiles: number } | { ok: false; error: string }> {
  const pdfs = await quotePdfRows(db, quote.id);
  if (pdfs.length) {
    const { error } = await db.from("job_files").delete().in("id", pdfs.map((p) => p.id));
    if (error) return { ok: false, error: error.message };
  }
  const { error } = await db.from("quotes").delete().eq("id", quote.id);
  if (error) return { ok: false, error: error.message };
  await removeFileObjects(db, pdfs);

  for (const p of pdfs) {
    await logAudit({
      action: "job_file_deleted", entity: "job_files", entityId: p.id,
      diff: { jobId: quote.job_id, filename: p.filename, kind: "nabidka", version: p.version ?? 1, quoteId: quote.id, cause: "quote_deleted" },
    });
  }
  await logAudit({
    action: "quote_deleted", entity: "quotes", entityId: quote.id,
    diff: { number: quote.number, jobId: quote.job_id, total: quote.total, removedFiles: pdfs.length, cause: opts.cause },
  });
  if (quote.job_id) {
    const n = pdfs.length;
    const withPdf = n ? ` včetně ${n} PDF v Dokumentech` : "";
    const message = opts.cause === "file"
      ? `${quoteLabel(quote)} smazána — smazáno její poslední PDF (${opts.filename}) v Dokumentech`
      : `${quoteLabel(quote)} smazána${withPdf}`;
    await logJobEvent(db, {
      jobId: quote.job_id, type: "quote", message,
      data: { quoteId: quote.id, number: quote.number, action: "deleted", removedFiles: pdfs.map((p) => p.id), cause: opts.cause },
      actorId,
    });
  }
  return { ok: true, removedFiles: pdfs.length };
}

/**
 * Po smazání jedné verze PDF: quotes.storage_path ukazovalo na smazaný soubor → přepnout na aktuální
 * (nearchivovanou nejvyšší) verzi, jinak vynulovat. Zbylé verze předá volající (už bez smazané).
 */
export async function syncQuoteStoragePath(db: JobsDb, quote: QuoteSyncRow, deletedPath: string | null, rest: QuotePdfRow[]): Promise<void> {
  if (!deletedPath || quote.storage_path !== deletedPath) return;
  const current = [...rest].filter((p) => !p.archived && p.storage_path).sort((a, b) => (b.version ?? 1) - (a.version ?? 1))[0];
  const { error } = await db.from("quotes").update({ storage_path: current?.storage_path ?? null } as never).eq("id", quote.id);
  if (error) console.error(`[quote-file-sync] Srovnání PDF nabídky selhalo: ${error.message}`);
}
