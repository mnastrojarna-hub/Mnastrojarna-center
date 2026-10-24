/**
 * Výběr souboru ke sdílení ven (dodavatel, ZIP, „Stáhnout pro dodavatele") — spec §4.5.
 * pickShareFile je čistá funkce (bez rendereru); verifyShareBytes stáhne a ověří anonymizovanou
 * kopii (prefix cesty + sha256 proti anon_sha256 — chytí podvržený objekt v úložišti).
 */

import { isAnonCandidate } from "./candidate";
import type { AnonStatus } from "./types";

export interface FileRowWithAnon {
  id: string;
  job_id: string | null;
  kind: string | null;
  filename: string;
  mime_type: string | null;
  storage_path: string | null;
  origin: string | null;
  issuer: string | null;
  anon_status: AnonStatus | null;
  anon_path: string | null;
  anon_filename: string | null;
  anon_mime: string | null;
  anon_sha256: string | null;
  anon_reason?: string | null;
}

export interface ShareOptions {
  /** Výslovně „poslat originál" (audit). */
  original?: boolean;
  /** Potvrzeno „zkontroloval jsem náhled" (pro review). */
  reviewedByCaller?: boolean;
  /** „Není to podklad zákazníka" (pro skipped / starý řádek bez stavu). */
  confirmNotCustomerMaterial?: boolean;
  /** Volající je super admin (originál poptávky/objednávky zákazníka). */
  isSuperAdmin?: boolean;
  /** Archiv výkresů (bucket documents) — jiný prefix anon cesty. */
  archive?: boolean;
  /** Nákupní doklad (#25 — cena dodavatele, DB job_file_price_ids): anonymizovaná kopie se nikdy nesdílí. */
  priceDocument?: boolean;
}

export type ShareDecision =
  | { ok: true; source: "anon" | "original"; path: string; filename: string; mime: string; sha256?: string; warn?: string; audit?: boolean }
  | { ok: false; reason: "pending" | "review" | "failed" | "unsupported" | "needs_confirm" | "excluded" | "forbidden"; message: string };

const CUSTOMER_DOC_KINDS = new Set(["poptavka", "objednavka"]);

function original(row: FileRowWithAnon, audit: boolean, warn?: string): ShareDecision {
  if (!row.storage_path) return { ok: false, reason: "excluded", message: "Soubor nemá uložený originál." };
  return {
    ok: true, source: "original", path: row.storage_path, filename: row.filename,
    mime: row.mime_type || "application/octet-stream", ...(audit ? { audit: true } : {}), ...(warn ? { warn } : {}),
  };
}

function anon(row: FileRowWithAnon, warn?: string): ShareDecision {
  if (!row.anon_path || !row.anon_sha256) {
    return { ok: false, reason: "failed", message: "Anonymizovaná kopie chybí — anonymizuj znovu." };
  }
  return {
    ok: true, source: "anon", path: row.anon_path, filename: row.anon_filename || "vykres.pdf",
    mime: row.anon_mime || "application/pdf", sha256: row.anon_sha256, ...(warn ? { warn } : {}),
  };
}

export function pickShareFile(row: FileRowWithAnon, opts: ShareOptions = {}): ShareDecision {
  const ours = (row.origin ?? "upload") === "generated" || row.issuer === "my";
  if (ours) return original(row, false);
  const customerDoc = CUSTOMER_DOC_KINDS.has(row.kind ?? "");

  if (opts.original) {
    if (customerDoc && !opts.isSuperAdmin) {
      return { ok: false, reason: "forbidden", message: "Originál poptávky nebo objednávky zákazníka smí poslat ven jen super admin." };
    }
    return original(row, true, "Posílá se ORIGINÁL — zákazník a projektant jsou viditelní.");
  }

  const candidate = isAnonCandidate(row.kind, row.filename, row.mime_type, row.origin, row.issuer);
  const status = row.anon_status;
  // nákupní doklad s cenou dodavatele / soubor přeřazený mimo výkresy: dřívější anonymní kopie neplatí
  if (opts.priceDocument && status !== null && status !== "skipped") {
    return { ok: false, reason: "excluded", message: "Nákupní doklad s cenou dodavatele — anonymizovaná kopie se nesdílí." };
  }
  if (!candidate && status !== null && status !== "skipped") {
    return { ok: false, reason: "excluded", message: "Soubor už není výkres zákazníka — anonymizovaná kopie neplatí." };
  }
  if (!candidate && status === null) {
    // externí soubor, který se neanonymizuje (ZIP, DOCX, XLSX z e-mailu zákazníka, doklad dodavatele…):
    // ven jen po potvrzení „není to podklad zákazníka" a vždy s auditem
    if (opts.confirmNotCustomerMaterial) return original(row, true, "Posílá se externí soubor bez anonymizace.");
    return { ok: false, reason: "needs_confirm", message: "Soubor se neanonymizuje (není výkres v podporovaném formátu) — potvrď, že nejde o podklad zákazníka." };
  }
  switch (status) {
    case "done":
      return anon(row);
    case "review":
      if (opts.reviewedByCaller) return anon(row, "Anonymizace byla ke kontrole — odesláno po potvrzení.");
      return { ok: false, reason: "review", message: "Anonymizace čeká na kontrolu — zkontroluj náhled a potvrď." };
    case "pending":
    case "processing":
    case null:
      return { ok: false, reason: "pending", message: "Výkres se ještě anonymizuje — odešle se po dokončení." };
    case "failed":
      return { ok: false, reason: "failed", message: row.anon_reason ? `Anonymizace selhala: ${row.anon_reason}` : "Anonymizace selhala — anonymizuj znovu." };
    case "unsupported":
      return { ok: false, reason: "excluded", message: row.anon_reason || "Formát nelze anonymizovat — pošli PDF, DXF nebo STEP (originál jen výslovně)." };
    case "skipped":
      if (customerDoc) {
        return { ok: false, reason: "excluded", message: "Poptávku / objednávku zákazníka nelze poslat ven bez anonymizace — přilož anonymizované výkresy, nebo ji vyřaď." };
      }
      if (opts.confirmNotCustomerMaterial) return original(row, true, "Posílá se originál (anonymizace přeskočena).");
      return { ok: false, reason: "needs_confirm", message: "Soubor nebyl anonymizován — potvrď, že nejde o podklad zákazníka." };
    default:
      return { ok: false, reason: "pending", message: "Neznámý stav anonymizace." };
  }
}

/** Prefix, pod kterým smí anonymizovaná kopie ležet. */
export function anonPrefix(row: Pick<FileRowWithAnon, "job_id">, archive = false): string {
  return archive ? "vykresy/anon/" : `zakazky/${String(row.job_id ?? "").toLowerCase()}/anon/`;
}

export class ShareVerifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShareVerifyError";
  }
}

interface StorageLike {
  storage: { from(bucket: string): { download(path: string): Promise<{ data: Blob | null; error: { message: string } | null }> } };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Stáhne bajty k odeslání a u anonymizované kopie ověří prefix a sha256 (povinné u každého odeslání,
 * ZIPu i „Stáhnout pro dodavatele").
 */
export async function verifyShareBytes(db: StorageLike, decision: ShareDecision, row: FileRowWithAnon, opts: { archive?: boolean } = {}): Promise<Uint8Array> {
  if (!decision.ok) throw new ShareVerifyError(decision.message);
  const bucket = opts.archive ? "documents" : "job-files";
  if (decision.source === "anon") {
    const prefix = anonPrefix(row, opts.archive);
    if (!decision.path.startsWith(prefix) || decision.path.includes("..") || decision.path === row.storage_path) {
      throw new ShareVerifyError("Anonymizovaná kopie je na nečekaném místě — anonymizuj znovu.");
    }
  }
  const { data, error } = await db.storage.from(bucket).download(decision.path);
  if (error || !data) throw new ShareVerifyError(`Soubor se nepodařilo načíst: ${error?.message ?? "prázdný soubor"}`);
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (decision.source === "anon") {
    const got = await sha256(bytes);
    if (!decision.sha256 || got !== decision.sha256) {
      throw new ShareVerifyError("Anonymizovaná kopie byla změněna — anonymizuj znovu.");
    }
  }
  return bytes;
}

export const SHARE_FILE_SELECT =
  "id, job_id, kind, filename, mime_type, storage_path, origin, issuer, anon_status, anon_path, anon_filename, anon_mime, anon_sha256, anon_reason";

export interface SupplierAttachment {
  fileId: string;
  filename: string;
  content: Uint8Array;
  contentType: string;
  source: "anon" | "original";
  audit?: boolean;
}

export interface CollectResult {
  ready: SupplierAttachment[];
  /** Čeká na anonymizaci → fronta odeslání. */
  pending: string[];
  /** Nejde poslat (review bez potvrzení, failed, unsupported…). */
  blocked: { fileId: string; reason: ShareDecision extends infer D ? D extends { ok: false; reason: infer R } ? R : never : never; message: string }[];
}

interface QueryLike extends StorageLike {
  from(table: string): {
    select(cols: string): { in(col: string, vals: string[]): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> };
  };
  rpc?(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/**
 * Nákupní doklady (#25, DB pravidlo job_file_price_ids) mezi soubory — bez ohledu na oprávnění volajícího;
 * chyba DB = všechny (fail closed). Klient bez rpc (testy) = žádné.
 */
export async function sharePriceDocIds(db: Pick<QueryLike, "rpc">, ids: string[]): Promise<Set<string>> {
  if (!ids.length || !db.rpc) return new Set();
  const { data, error } = await db.rpc("job_file_price_ids", { p_ids: ids });
  if (error) return new Set(ids.map((x) => x.toLowerCase()));
  return new Set(((data ?? []) as string[]).map((x) => String(x).toLowerCase()));
}

/** Přílohy pro dodavatele: každý soubor přes pickShareFile + verifyShareBytes. */
export async function collectSupplierAttachments(db: QueryLike, fileIds: string[], opts: ShareOptions & { perFile?: Record<string, ShareOptions> } = {}): Promise<CollectResult> {
  const out: CollectResult = { ready: [], pending: [], blocked: [] };
  const ids = [...new Set(fileIds.filter(Boolean))];
  if (!ids.length) return out;
  const { data, error } = await db.from("job_files").select(SHARE_FILE_SELECT).in("id", ids);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as FileRowWithAnon[];
  const price = await sharePriceDocIds(db, ids);
  for (const id of ids) {
    const row = rows.find((r) => r.id === id);
    if (!row) {
      out.blocked.push({ fileId: id, reason: "excluded", message: "Soubor nenalezen." });
      continue;
    }
    const d = pickShareFile(row, { ...opts, ...(opts.perFile?.[id] ?? {}), priceDocument: price.has(id.toLowerCase()) });
    if (!d.ok) {
      if (d.reason === "pending") out.pending.push(id);
      else out.blocked.push({ fileId: id, reason: d.reason, message: d.message });
      continue;
    }
    const content = await verifyShareBytes(db, d, row);
    out.ready.push({ fileId: id, filename: d.filename, content, contentType: d.mime, source: d.source, ...(d.audit ? { audit: true } : {}) });
  }
  return out;
}
