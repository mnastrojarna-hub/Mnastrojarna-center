import "server-only";
import type { Access } from "@/lib/auth/session";
import type { JobsDb } from "@/lib/jobs/events";
import type { FileLock } from "@/lib/jobs/types";
import { isOurQuoteFile, isPriceDocument } from "@/lib/auth/price-visibility";
import { QUOTE_AWAITS_APPROVAL, quoteApprovalBlock } from "@/lib/jobs/flow-status";

/**
 * Přístup k obsahu dokumentu zakázky (#25 §4.2) — server, servisní klíč. Řádek dokumentu vidí každý,
 * kdo vidí zakázku; OBSAH (náhled, stažení, odeslání, úprava) je zamčený:
 *  - "price": nákupní doklad (objednávka dodavateli, doklady dodavatele, neznámý vystavitel u cenových
 *    druhů, soubor navázaný na objednávku / nabídku dodavatele — i přes sdílenou cestu v úložišti)
 *    pro uživatele bez práva „margins";
 *  - "unapproved" / "stale": PDF naší nabídky, která čeká na schválení / vzniklo před posledním
 *    schválením — pro všechny kromě super admina.
 * Nákupní doklady počítá DB (job_file_price_ids = job_file_is_price_doc + job_file_path_is_price_doc),
 * TS dvojče isPriceDocument (lib/auth/price-visibility).
 */

export type { FileLock };

export const FILE_PRICE_VIEW = "Nákupní doklad vidí obchodník a super admin.";
export const FILE_PRICE_SEND = "Nákupní doklad posílá obchodník nebo super admin.";
export const FILE_PRICE_KIND = "Druh nákupního dokladu mění obchodník nebo super admin.";
export const FILE_UNAPPROVED_VIEW = "Nabídka čeká na schválení super admina — stáhni náhled s vodoznakem (‚PDF náhled‘).";
export const FILE_STALE_VIEW = "Toto PDF nabídky vzniklo před posledním schválením — vystav nové.";
/** = text odeslání v job-documents (25-A). */
export const FILE_STALE_SEND = "Toto PDF vzniklo před posledním schválením — vystav nové PDF nabídky a odešli ho.";
const FILE_NOT_FOUND = "Dokument nenalezen.";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHUNK = 200;

export interface FileLockInput {
  id: string;
  kind: string;
  issuer?: string | null;
  origin?: string | null;
  quoteId?: string | null;
  createdAt: string;
}

export interface FileRowForAccess {
  id: string;
  job_id: string;
  kind: string;
  filename: string;
  mime_type: string | null;
  storage_path: string | null;
  quote_id: string | null;
  size_bytes: number | string | null;
  origin: string | null;
  issuer: string | null;
  created_at: string;
}

const FILE_ACCESS_SELECT = "id, job_id, kind, filename, mime_type, storage_path, quote_id, size_bytes, origin, issuer, created_at";

function chunks<T>(list: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Id nákupních dokladů mezi zadanými (DB). null = chyba → volající zamkne vše (fail closed). */
async function priceIds(db: JobsDb, ids: string[]): Promise<Set<string> | null> {
  const out = new Set<string>();
  for (const part of chunks(ids)) {
    const { data, error } = await db.rpc("job_file_price_ids", { p_ids: part });
    if (error) {
      console.error(`[job-file-access] Nákupní doklady se nepodařilo ověřit: ${error.message}`);
      return null;
    }
    for (const v of (Array.isArray(data) ? data : []) as unknown[]) if (typeof v === "string") out.add(v.toLowerCase());
  }
  return out;
}

interface QuoteApprovalRow {
  id: string;
  admin_approval_required: boolean | null;
  approval_required: boolean | null;
  approved_by: string | null;
  approved_at: string | null;
  sent_at: string | null;
}

/** Zámky obsahu pro seznam dokumentů (jeden dávkový dotaz na nákupní doklady a schválení nabídek). */
export async function fileLocks(db: JobsDb, files: FileLockInput[], access: Pick<Access, "user" | "can">): Promise<Map<string, FileLock>> {
  const out = new Map<string, FileLock>();
  const list = files.filter((f) => UUID_RE.test(f.id));
  if (!list.length) return out;
  const margins = access.can("margins");
  const isAdmin = access.user?.role === "super_admin";

  if (!margins) {
    const price = await priceIds(db, list.map((f) => f.id.toLowerCase()));
    for (const f of list) {
      // chyba DB → zamknout (i to, co by podle TS pravidla nákupní nebylo)
      if (!price || price.has(f.id.toLowerCase()) || isPriceDocument({ ...f, issuer: f.issuer ?? null }, new Set())) out.set(f.id, "price");
    }
  }

  if (!isAdmin) {
    const ours = list.filter((f) => !out.has(f.id) && f.quoteId && UUID_RE.test(f.quoteId) && isOurQuoteFile(f));
    const quoteIds = [...new Set(ours.map((f) => f.quoteId!.toLowerCase()))];
    const quotes = new Map<string, QuoteApprovalRow>();
    let failed = false;
    for (const part of chunks(quoteIds)) {
      const { data, error } = await db.from("quotes")
        .select("id, admin_approval_required, approval_required, approved_by, approved_at, sent_at").in("id", part);
      if (error) {
        console.error(`[job-file-access] Schválení nabídek se nepodařilo ověřit: ${error.message}`);
        failed = true;
        break;
      }
      for (const r of (data ?? []) as QuoteApprovalRow[]) quotes.set(r.id.toLowerCase(), r);
    }
    for (const f of ours) {
      const q = quotes.get(f.quoteId!.toLowerCase());
      if (failed) { out.set(f.id, "unapproved"); continue; }
      if (!q) continue;
      const block = quoteApprovalBlock({
        adminApprovalRequired: q.admin_approval_required === true, approvalRequired: q.approval_required === true,
        approvedBy: q.approved_by, sentAt: q.sent_at,
      });
      if (block) out.set(f.id, "unapproved");
      else if (q.approved_at && Date.parse(f.createdAt) < Date.parse(q.approved_at)) out.set(f.id, "stale");
    }
  }
  return out;
}

/** Zámek jednoho souboru (null = obsah smí). */
export async function fileLock(db: JobsDb, file: FileLockInput, access: Pick<Access, "user" | "can">): Promise<FileLock> {
  return (await fileLocks(db, [file], access)).get(file.id) ?? null;
}

export type JobFileAccessResult =
  | { ok: true; file: FileRowForAccess; lock: FileLock }
  | { ok: false; status: 403 | 404 | 409; error: string; lock?: FileLock };

/**
 * Smí uživatel s obsahem souboru pracovat? view = náhled / stažení, send = e-mailem zákazníkovi,
 * edit = úprava / archivace (zámek nabídky čekající na schválení úpravě nebrání).
 */
export async function assertJobFileAccess(
  db: JobsDb, fileId: string, access: Pick<Access, "user" | "can">, intent: "view" | "send" | "edit",
): Promise<JobFileAccessResult> {
  if (!UUID_RE.test(fileId)) return { ok: false, status: 404, error: FILE_NOT_FOUND };
  const { data, error } = await db.from("job_files").select(FILE_ACCESS_SELECT).eq("id", fileId).maybeSingle();
  if (error) console.error(`[job-file-access] Načtení dokumentu selhalo: ${error.message}`);
  const file = (data as FileRowForAccess | null) ?? null;
  if (!file) return { ok: false, status: 404, error: FILE_NOT_FOUND };
  const lock = await fileLock(db, {
    id: file.id, kind: file.kind, issuer: file.issuer, origin: file.origin, quoteId: file.quote_id, createdAt: file.created_at,
  }, access);
  if (lock === "price") {
    return { ok: false, status: 403, lock, error: intent === "send" ? FILE_PRICE_SEND : FILE_PRICE_VIEW };
  }
  if (intent !== "edit" && lock === "unapproved") {
    return { ok: false, status: 409, lock, error: intent === "send" ? QUOTE_AWAITS_APPROVAL : FILE_UNAPPROVED_VIEW };
  }
  if (intent !== "edit" && lock === "stale") {
    return { ok: false, status: 409, lock, error: intent === "send" ? FILE_STALE_SEND : FILE_STALE_VIEW };
  }
  return { ok: true, file, lock };
}
