import "server-only";
import { createHash } from "node:crypto";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { aiActor, type ActorContext } from "@/lib/supabase/actor-headers";
import type { JobsDb } from "@/lib/jobs/events";
import { getModuleMode } from "@/lib/automation";
import { getAiConfig, getSetting } from "@/lib/settings";
import { isFakeCapture } from "@/lib/ai/fake-capture";
import { aiFailureMessage } from "@/lib/ai/ai-call";
import { readSupplierInvoice } from "@/lib/ai/supplier-invoice-reader";
import type { ReadDocumentFile } from "@/lib/ai/document-reader";
import { sniffDocumentMime } from "@/lib/jobs/capture-review";
import { isUuid, safeStorageName, translateDbError } from "@/lib/jobs/mapping";
import { matchParty } from "@/lib/jobs/matching";
import { composeAddress, normalizeCountry, normalizeDic, normalizeIco } from "@/lib/jobs/customers";
import { isOurParty, loadSupplierCandidates } from "@/lib/jobs/purchasing-store";
import { normalizeSupplierInvoice, partyAddress } from "@/lib/supplier-invoices/extract";
import { cnbRate } from "@/lib/supplier-invoices/cnb-rate";
import { cleanAllocationInputs, validateAllocations } from "@/lib/supplier-invoices/money";
import {
  proposeAllocations, purchaseOrderNumbersIn, jobNumbersIn,
  type MatchJob, type MatchPurchaseOrder, type ProposedAllocation,
} from "@/lib/supplier-invoices/matching";
import type {
  AllocationInput, InvoiceSupplierParty, SupplierInvoiceExtract, SupplierInvoicePaymentStatus, SupplierInvoiceSource,
} from "@/lib/supplier-invoices/types";
import type { SupplierInvoiceRow } from "@/lib/supplier-invoices/db-types";

/**
 * Faktury dodavatelů — serverové jádro (servisní klíč; OPRÁVNĚNÍ HLÍDÁ VOLAJÍCÍ: akce, API, dávka).
 *  createSupplierInvoiceFromFile → soubory do bucketu supplier-invoices (nikdy job_files), řádek faktury,
 *  processSupplierInvoice → AI čtení (nebo hotové vytěžení), dodavatel, položky, duplicita, návrh rozdělení
 *  podle režimu automatiky (plná = potvrzeno, se schválením = čeká v detailu a ve frontě),
 *  saveAllocations / confirmAiAllocations / setPayment / upsertSupplierFromParty.
 * E-mail (Mail B) volá createSupplierInvoiceFromFile(file, "email", actor, { emailId }).
 */

export const SUPPLIER_INVOICE_BUCKET = "supplier-invoices";
export const SUPPLIER_INVOICE_MODULE = "supplier_invoice";
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const AI_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const AI_MAX_TOTAL_BYTES = 22 * 1024 * 1024;

type Row = Record<string, unknown>;

export interface InvoiceFileInput {
  bytes: Uint8Array;
  filename: string;
  mimeType?: string | null;
}

export interface CreateInvoiceOptions {
  /** Idempotence (dávka „<captureId>:<docId>", e-mail „mail:<id>:<příloha>"). */
  captureKey?: string | null;
  emailId?: string | null;
  /** Hotové vytěžení (dávka už fakturu přečetla) — AI se znovu nevolá. */
  extract?: SupplierInvoiceExtract | null;
  /** Vytěžení z AI (true) / ručně (false). */
  aiUsed?: boolean;
  /** Bez hotového vytěžení: sync = přečíst hned, background = po odpovědi (after), none = jen uložit. */
  process?: "sync" | "background" | "none";
  /** Testovací háček: skupina fixture. */
  fakeGroup?: string | null;
  /** Dodavatel už vybraný (Dodavatelé → Přiložit fakturu). */
  supplierId?: string | null;
  /**
   * Zakázka, ze které se fotí („Přidat doklad (foto)" u zakázky) — řádky bez vlastního důkazu dostanou
   * návrh na ni (jen návrh, potvrzuje super admin).
   */
  contextJobId?: string | null;
  note?: string | null;
  /** Hotový klient (dávka) — jinak servisní klient s autorem. */
  db?: JobsDb;
}

export type CreateInvoiceResult =
  | { ok: true; id: string; created: boolean; duplicateOfId: string | null; status: SupplierInvoiceRow["status"] }
  | { ok: false; error: string };

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function dbFor(actor: ActorContext, db?: JobsDb): JobsDb {
  return db ?? (createAdminClient({ actor }) as unknown as JobsDb);
}

function errText(e: unknown): string {
  if (!e) return "Neočekávaná chyba.";
  if (typeof e === "string") return translateDbError(e);
  const m = (e as { message?: unknown }).message;
  return typeof m === "string" ? translateDbError(m) : "Neočekávaná chyba.";
}

function mimeOf(f: InvoiceFileInput): string {
  return sniffDocumentMime(f.bytes) ?? (f.mimeType || "application/octet-stream").toLowerCase();
}

function extOf(mime: string): string {
  return mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : mime === "image/gif" ? "gif" : "jpg";
}

/** Klíč dodavatele jako v DB (supplier_key): IČO, jinak id, jinak název. */
export function supplierKeyOf(p: { ico?: string | null; supplierId?: string | null; name?: string | null }): string | null {
  const ico = String(p.ico ?? "").replace(/\D/g, "");
  if (ico) return ico;
  if (p.supplierId) return p.supplierId;
  const n = String(p.name ?? "").trim().toLowerCase();
  return n || null;
}

export function numberNorm(n: string | null | undefined): string {
  return String(n ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

/**
 * Založí fakturu dodavatele ze souboru(ů) jedné faktury. Stejný soubor (obsah) podruhé = vrátí existující
 * (created: false, duplicateOfId); jiný soubor téže faktury (dodavatel + číslo) se pozná při čtení.
 */
export async function createSupplierInvoiceFromFile(
  file: InvoiceFileInput | InvoiceFileInput[],
  source: SupplierInvoiceSource,
  actor: ActorContext,
  opts: CreateInvoiceOptions = {},
): Promise<CreateInvoiceResult> {
  const files = (Array.isArray(file) ? file : [file]).filter((f) => f && f.bytes && f.bytes.length > 0);
  if (!files.length) return { ok: false, error: "Chybí soubor faktury." };
  if (files.length > 30) return { ok: false, error: "Faktura může mít nejvýš 30 stránek." };
  if (files.some((f) => f.bytes.length > MAX_FILE_BYTES)) return { ok: false, error: "Soubor je větší než 50 MB." };
  if (!["photo", "scan", "upload", "email"].includes(source)) return { ok: false, error: "Neznámý zdroj faktury." };
  const db = dbFor(actor, opts.db);
  const captureKey = opts.captureKey ? String(opts.captureKey).slice(0, 200) : null;
  try {
    if (captureKey) {
      const { data: prev } = await db.from("supplier_invoices").select("id, duplicate_of_id, status").eq("capture_key", captureKey).maybeSingle();
      const p = prev as { id: string; duplicate_of_id: string | null; status: SupplierInvoiceRow["status"] } | null;
      if (p) return { ok: true, id: p.id, created: false, duplicateOfId: p.duplicate_of_id, status: p.status };
    }
    const shas = files.map((f) => sha256(f.bytes));
    // stejný obsah už nahraný → nezakládat znovu
    const { data: same } = await db.from("supplier_invoices").select("id, status").eq("content_sha256", shas[0]).neq("status", "zamitnuto").limit(1);
    const hit = ((same ?? []) as { id: string; status: SupplierInvoiceRow["status"] }[])[0];
    if (hit) return { ok: true, id: hit.id, created: false, duplicateOfId: hit.id, status: hit.status };

    const insert: Row = {
      source, capture_key: captureKey, email_id: isUuid(opts.emailId) ? opts.emailId : null, content_sha256: shas[0],
      uploaded_by: actor.id, note: opts.note ? String(opts.note).slice(0, 2000) : null,
      supplier_id: isUuid(opts.supplierId) ? opts.supplierId : null,
    };
    const { data: ins, error } = await db.from("supplier_invoices").insert(insert as never).select("id").single();
    if (error || !ins) {
      // souběžný pokus se stejným klíčem
      if (captureKey && /duplicate|unique/i.test(error?.message ?? "")) {
        const { data: again } = await db.from("supplier_invoices").select("id, duplicate_of_id, status").eq("capture_key", captureKey).maybeSingle();
        const a = again as { id: string; duplicate_of_id: string | null; status: SupplierInvoiceRow["status"] } | null;
        if (a) return { ok: true, id: a.id, created: false, duplicateOfId: a.duplicate_of_id, status: a.status };
      }
      return { ok: false, error: errText(error) };
    }
    const id = (ins as { id: string }).id;
    const rows: Row[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const mime = mimeOf(f);
      const safe = safeStorageName(f.filename || `faktura-${i + 1}.${extOf(mime)}`).slice(0, 120) || `faktura-${i + 1}.${extOf(mime)}`;
      const path = `${id}/${crypto.randomUUID()}-${safe}`;
      const { error: upErr } = await db.storage.from(SUPPLIER_INVOICE_BUCKET).upload(path, f.bytes, { contentType: mime, upsert: false });
      if (upErr) {
        await removeInvoice(db, id);
        return { ok: false, error: `Soubor ${f.filename} se nepodařilo uložit: ${upErr.message}` };
      }
      rows.push({ invoice_id: id, position: i, storage_path: path, filename: f.filename.slice(0, 255) || safe, mime_type: mime, size: f.bytes.length, sha256: shas[i], uploaded_by: actor.id });
    }
    const { error: fErr } = await db.from("supplier_invoice_files").insert(rows as never);
    if (fErr) {
      await removeInvoice(db, id);
      return { ok: false, error: errText(fErr) };
    }
    const contextJobId = isUuid(opts.contextJobId) ? opts.contextJobId : null;
    if (opts.extract) {
      try {
        const res = await applyExtract(db, id, opts.extract, { aiUsed: opts.aiUsed ?? true, actor, contextJobId });
        return { ok: true, id, created: true, duplicateOfId: res.duplicateOfId, status: res.status };
      } catch (err) {
        // faktura (soubor) zůstává — jen se nevyplnila; super admin ji uvidí ke kontrole
        await markProcessingFailed(db, id, errText(err));
        return { ok: true, id, created: true, duplicateOfId: null, status: "ke_kontrole" };
      }
    }
    const mode = opts.process ?? "background";
    if (mode === "sync") {
      const res = await processSupplierInvoice(id, { actor, fakeGroup: opts.fakeGroup ?? null, db, contextJobId });
      return { ok: true, id, created: true, duplicateOfId: res.ok ? res.duplicateOfId : null, status: res.ok ? res.status : "ke_kontrole" };
    }
    if (mode === "background") scheduleProcessing(id, actor, opts.fakeGroup ?? null, contextJobId);
    return { ok: true, id, created: true, duplicateOfId: null, status: "nahrano" };
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
}

/** Zpracování po odpovědi (route / akce); mimo požadavek Next.js hned na pozadí. */
export function scheduleProcessing(id: string, actor: ActorContext, fakeGroup: string | null = null, contextJobId: string | null = null): void {
  const run = () => processSupplierInvoice(id, { actor, fakeGroup, contextJobId }).then(() => undefined, () => undefined);
  try {
    after(run);
  } catch {
    void run();
  }
}

async function removeInvoice(db: JobsDb, id: string): Promise<void> {
  try {
    const { data } = await db.from("supplier_invoice_files").select("storage_path").eq("invoice_id", id);
    const paths = ((data ?? []) as { storage_path: string }[]).map((r) => r.storage_path);
    if (paths.length) await db.storage.from(SUPPLIER_INVOICE_BUCKET).remove(paths);
    await db.from("supplier_invoices").delete().eq("id", id);
  } catch {
    // úklid je best-effort
  }
}

/** Smazání faktury i souborů (super admin). */
export async function deleteSupplierInvoice(db: JobsDb, id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isUuid(id)) return { ok: false, error: "Faktura nenalezena." };
  const { data } = await db.from("supplier_invoice_files").select("storage_path").eq("invoice_id", id);
  const paths = ((data ?? []) as { storage_path: string }[]).map((r) => r.storage_path);
  // smazání originálu: jeho duplicity by (ON DELETE SET NULL) byly všechny „originál" → unikátní index
  // dodavatel + číslo by smazání odmítl. Nejstarší duplicita se stane originálem, ostatní ukážou na ni.
  const { data: dups } = await db.from("supplier_invoices").select("id").eq("duplicate_of_id", id).order("created_at").limit(500);
  const dupIds = ((dups ?? []) as { id: string }[]).map((r) => r.id);
  if (dupIds.length > 1) {
    const { error: rErr } = await db.from("supplier_invoices").update({ duplicate_of_id: dupIds[0] } as never).in("id", dupIds.slice(1));
    if (rErr) return { ok: false, error: errText(rErr) };
  }
  await resolveQueue(db, id, "rejected");
  const { error } = await db.from("supplier_invoices").delete().eq("id", id);
  if (error) return { ok: false, error: errText(error) };
  if (paths.length) {
    try { await db.storage.from(SUPPLIER_INVOICE_BUCKET).remove(paths); } catch { /* best-effort */ }
  }
  return { ok: true };
}

async function aiReady(): Promise<boolean> {
  if (isFakeCapture()) return true;
  try {
    const [enabled, ai] = await Promise.all([getSetting("ai_enabled"), getAiConfig()]);
    const off = ["0", "false", "ne", "no", "off"].includes(String(enabled ?? "").trim().toLowerCase());
    return !off && Boolean(ai.apiKey);
  } catch {
    return false;
  }
}

/** Soubory faktury pro AI (PDF + obrázky v limitech API). */
export async function invoiceAiFiles(db: JobsDb, id: string): Promise<{ files: ReadDocumentFile[]; skipped: number }> {
  const { data } = await db.from("supplier_invoice_files").select("storage_path, mime_type").eq("invoice_id", id).order("position");
  const out: ReadDocumentFile[] = [];
  let skipped = 0;
  let total = 0;
  for (const f of (data ?? []) as { storage_path: string; mime_type: string | null }[]) {
    const { data: blob } = await db.storage.from(SUPPLIER_INVOICE_BUCKET).download(f.storage_path);
    if (!blob) { skipped++; continue; }
    const bytes = new Uint8Array(await (blob as Blob).arrayBuffer());
    const mime = sniffDocumentMime(bytes);
    if (!mime || (mime.startsWith("image/") && bytes.length > AI_MAX_IMAGE_BYTES) || total + bytes.length > AI_MAX_TOTAL_BYTES) { skipped++; continue; }
    total += bytes.length;
    out.push({ mediaType: mime, dataBase64: Buffer.from(bytes).toString("base64") });
  }
  return { files: out, skipped };
}

export type ProcessResult =
  | { ok: true; status: SupplierInvoiceRow["status"]; duplicateOfId: string | null; proposals: number; aiUsed: boolean }
  | { ok: false; error: string };

/**
 * Zpracování selhalo (chyba DB, nesmyslná data…) — faktura NESMÍ zůstat „AI fakturu čte": ke kontrole s chybou
 * (detail nabídne „Přečíst znovu (AI)").
 */
export async function markProcessingFailed(db: JobsDb, id: string, error: string): Promise<void> {
  try {
    await db.from("supplier_invoices").update({
      status: "ke_kontrole", ai_error: `AI fakturu nezpracovala: ${error}`.slice(0, 500), ai_processed_at: new Date().toISOString(),
    } as never).eq("id", id).in("status", ["nahrano", "ke_kontrole"]);
  } catch {
    // best-effort (detail po ~3 min stejně nabídne přečíst znovu)
  }
}

/** Otisk stavu faktury (hlavička, položky, rozdělení) — změnil ho mezitím člověk? */
async function invoiceVersion(db: JobsDb, id: string): Promise<string> {
  const [h, i, a] = await Promise.all([
    db.from("supplier_invoices").select("updated_at").eq("id", id).maybeSingle(),
    db.from("supplier_invoice_items").select("id, updated_at").eq("invoice_id", id).order("id"),
    db.from("supplier_invoice_allocations").select("id, updated_at, confirmed_at").eq("invoice_id", id).order("id"),
  ]);
  return JSON.stringify([(h.data as { updated_at?: string } | null)?.updated_at ?? null, i.data ?? [], a.data ?? []]);
}

/** AI přečte fakturu a vyplní vše (bez potvrzeného rozdělení; jinak „Nejdřív zruš potvrzené rozdělení"). */
export async function processSupplierInvoice(
  id: string,
  opts: { actor?: ActorContext; fakeGroup?: string | null; db?: JobsDb; force?: boolean; contextJobId?: string | null } = {},
): Promise<ProcessResult> {
  const actor = opts.actor ?? aiActor(null, "supplier-invoice");
  const db = dbFor(aiActor(actor.id ?? null, "supplier-invoice"), opts.db);
  let started = false;
  try {
    const { data: inv } = await db.from("supplier_invoices").select("id, status, ai_processed_at").eq("id", id).maybeSingle();
    const row = inv as { id: string; status: string; ai_processed_at: string | null } | null;
    if (!row) return { ok: false, error: "Faktura nenalezena." };
    if (row.ai_processed_at && !opts.force) {
      const { data: again } = await db.from("supplier_invoices").select("status, duplicate_of_id").eq("id", id).single();
      const a = again as { status: SupplierInvoiceRow["status"]; duplicate_of_id: string | null };
      return { ok: true, status: a.status, duplicateOfId: a.duplicate_of_id, proposals: 0, aiUsed: true };
    }
    const confirmedCount = async () => (await db.from("supplier_invoice_allocations").select("id", { count: "exact", head: true })
      .eq("invoice_id", id).not("confirmed_at", "is", null)).count ?? 0;
    if ((await confirmedCount()) > 0) return { ok: false, error: "Faktura má potvrzené rozdělení — nejdřív ho zruš, pak ji nech přečíst znovu." };
    started = true;
    if (!(await aiReady())) {
      await db.from("supplier_invoices").update({ status: "ke_kontrole", ai_error: "AI není zapnuté nebo nastavené — vyplň fakturu ručně." } as never).eq("id", id);
      return { ok: true, status: "ke_kontrole", duplicateOfId: null, proposals: 0, aiUsed: false };
    }
    const files = await invoiceAiFiles(db, id);
    if (!files.files.length && !isFakeCapture()) {
      await db.from("supplier_invoices").update({ status: "ke_kontrole", ai_error: "AI tenhle soubor nepřečte — vyplň fakturu ručně." } as never).eq("id", id);
      return { ok: true, status: "ke_kontrole", duplicateOfId: null, proposals: 0, aiUsed: false };
    }
    const before = await invoiceVersion(db, id);
    let extract: SupplierInvoiceExtract;
    try {
      extract = (await readSupplierInvoice({ files: files.files, fakeGroup: opts.fakeGroup ?? null })).invoice;
    } catch (err) {
      await db.from("supplier_invoices").update({ status: "ke_kontrole", ai_error: aiFailureMessage(err).slice(0, 500), ai_processed_at: new Date().toISOString() } as never).eq("id", id);
      return { ok: true, status: "ke_kontrole", duplicateOfId: null, proposals: 0, aiUsed: false };
    }
    // čtení trvá 10–60 s: mezitím mohl super admin fakturu upravit nebo potvrdit → nic nepřepisovat
    if ((await confirmedCount()) > 0 || (await invoiceVersion(db, id)) !== before) {
      const error = "Faktura se během čtení AI změnila — nové čtení jsem neuložil (tvoje úpravy platí). Případně ji nech přečíst znovu.";
      await db.from("supplier_invoices").update({ ai_error: error, ai_processed_at: new Date().toISOString(), status: "ke_kontrole" } as never)
        .eq("id", id).eq("status", "nahrano");
      return { ok: false, error };
    }
    const res = await applyExtract(db, id, extract, { aiUsed: true, actor, replace: true, contextJobId: opts.contextJobId ?? null });
    return { ok: true, status: res.status, duplicateOfId: res.duplicateOfId, proposals: res.proposals, aiUsed: true };
  } catch (err) {
    const msg = errText(err);
    if (started) await markProcessingFailed(db, id, msg);
    return { ok: false, error: msg };
  }
}

/** Dodavatel z adresáře podle IČO / DIČ / názvu (shoda ≥ 80). */
export async function matchSupplier(db: JobsDb, party: Pick<InvoiceSupplierParty, "name" | "ico" | "dic" | "email">): Promise<{ id: string; name: string; reason: string } | null> {
  if (!party.name && !party.ico && !party.dic) return null;
  if (isOurParty({ ico: party.ico, name: party.name })) return null;
  const cands = await loadSupplierCandidates(db);
  const m = matchParty(party, cands);
  if (!m || m.score < 80) return null;
  return { id: m.id, name: cands.find((c) => c.id === m.id)?.name ?? party.name, reason: m.reason };
}

/**
 * Zapíše vytěžení: hlavička (prázdná pole / přepsat při novém čtení), položky, dodavatel (shoda),
 * duplicita (dodavatel + číslo), návrh rozdělení podle režimu automatiky.
 */
export async function applyExtract(
  db: JobsDb,
  id: string,
  raw: SupplierInvoiceExtract,
  opts: { aiUsed: boolean; actor: ActorContext; replace?: boolean; contextJobId?: string | null },
): Promise<{ status: SupplierInvoiceRow["status"]; duplicateOfId: string | null; proposals: number }> {
  const ex = normalizeSupplierInvoice(raw);
  // cizí měna: kurz z faktury, jinak ČNB ke dni DUZP (vystavení); bez kurzu se náklad nepočítá (nikdy 1:1)
  const rate = ex.currency === "CZK" ? null
    : ex.exchangeRate > 0 ? ex.exchangeRate
    : await cnbRate(ex.currency, ex.taxableDate || ex.issueDate || null);
  const { data: cur } = await db.from("supplier_invoices").select("*").eq("id", id).single();
  const inv = cur as SupplierInvoiceRow;
  const supplierParty = isOurParty({ ico: ex.supplier.ico, name: ex.supplier.name }) ? { ...ex.supplier, name: "", ico: "", dic: "" } : ex.supplier;
  const match = inv.supplier_id ? null : await matchSupplier(db, supplierParty);
  const supplierId = inv.supplier_id ?? match?.id ?? null;
  let supplierIco = normalizeIco(supplierParty.ico);
  if (!supplierIco && supplierId) {
    const { data: s } = await db.from("suppliers").select("ico").eq("id", supplierId).maybeSingle();
    supplierIco = normalizeIco((s as { ico: string | null } | null)?.ico);
  }
  const header: Row = {
    supplier_id: supplierId,
    supplier_name: supplierParty.name || null,
    supplier_ico: supplierIco,
    supplier_dic: normalizeDic(supplierParty.dic),
    supplier_address: partyAddress(supplierParty) || null,
    supplier_bank_account: supplierParty.bankAccount || null,
    supplier_email: supplierParty.email || null,
    supplier_phone: supplierParty.phone || null,
    number: ex.number || null,
    variable_symbol: ex.variableSymbol || null,
    issue_date: ex.issueDate || null,
    taxable_date: ex.taxableDate || null,
    due_date: ex.dueDate || null,
    currency: ex.currency,
    exchange_rate: rate,
    total_net: ex.totalNet || null,
    total_vat: ex.totalVat || null,
    total_gross: ex.totalGross || null,
    is_credit_note: ex.isCreditNote,
    is_proforma: ex.isProforma,
    ai_extracted: ex as unknown as Row,
    ai_confidence: opts.aiUsed ? ex.confidence : null,
    ai_used: opts.aiUsed,
    ai_error: null,
    ai_processed_at: new Date().toISOString(),
  };
  if (!opts.replace) {
    // ruční úpravy mají přednost (jen prázdná pole; výchozí hodnota sloupce = prázdné — jinak by EUR faktura
    // z dávky zůstala „CZK" a zálohová by nebyla zálohová)
    const DEFAULTS: Row = { currency: "CZK", is_credit_note: false, is_proforma: false };
    for (const k of Object.keys(header)) {
      const v = (inv as unknown as Row)[k];
      if (k in DEFAULTS && v === DEFAULTS[k]) continue;
      if (v !== null && v !== undefined && v !== "" && !["ai_extracted", "ai_confidence", "ai_used", "ai_error", "ai_processed_at", "supplier_id"].includes(k)) delete header[k];
    }
  }
  // duplicita: stejný dodavatel + číslo u jiné aktivní faktury
  const key = supplierKeyOf({ ico: (header.supplier_ico as string | null) ?? inv.supplier_ico, supplierId: (header.supplier_id as string | null) ?? inv.supplier_id, name: (header.supplier_name as string | null) ?? inv.supplier_name });
  const nnorm = numberNorm((header.number as string | null) ?? inv.number);
  let duplicateOfId: string | null = inv.duplicate_of_id;
  if (key && nnorm && !duplicateOfId) {
    const { data: dups } = await db.from("supplier_invoices").select("id").eq("supplier_key", key).eq("number_norm", nnorm)
      .is("duplicate_of_id", null).neq("status", "zamitnuto").neq("id", id).order("created_at").limit(1);
    duplicateOfId = ((dups ?? []) as { id: string }[])[0]?.id ?? null;
  }
  if (duplicateOfId) header.duplicate_of_id = duplicateOfId;
  let { error } = await db.from("supplier_invoices").update(header as never).eq("id", id);
  if (error && /uq_supplier_invoices_number|duplicate key/i.test(error.message)) {
    // souběžně nahraná stejná faktura → tahle je duplicita
    const { data: dups } = await db.from("supplier_invoices").select("id").eq("supplier_key", key ?? "").eq("number_norm", nnorm)
      .is("duplicate_of_id", null).neq("id", id).limit(1);
    duplicateOfId = ((dups ?? []) as { id: string }[])[0]?.id ?? null;
    ({ error } = await db.from("supplier_invoices").update({ ...header, duplicate_of_id: duplicateOfId } as never).eq("id", id));
  }
  if (error) throw new Error(error.message);

  // položky: při novém čtení se nahradí (nepotvrzené návrhy s nimi zmizí)
  const { count: itemCount } = await db.from("supplier_invoice_items").select("id", { count: "exact", head: true }).eq("invoice_id", id);
  if (opts.replace || !itemCount) {
    await db.from("supplier_invoice_allocations").delete().eq("invoice_id", id).is("confirmed_at", null);
    // staré položky pryč, nové dovnitř — atomicky (RPC pod zámkem faktury)
    const res = await saveItems(db, id, ex.items.map((it) => ({
      id: null, text: it.text.slice(0, 1000), code: it.code || null, quantity: it.quantity || null, unit: it.unit || null,
      unitPrice: it.unitPrice || null, amount: it.amount, vatRate: it.vatRate >= 0 ? it.vatRate : null,
    })));
    if (!res.ok) throw new Error(res.error);
  }
  if (duplicateOfId) {
    await db.from("supplier_invoices").update({ status: "ke_kontrole" } as never).eq("id", id);
    return { status: "ke_kontrole", duplicateOfId, proposals: 0 };
  }
  // zálohová faktura se do nákladů nepočítá (náklad přinese až daňový doklad) → žádný návrh rozdělení
  const { data: pf } = await db.from("supplier_invoices").select("is_proforma").eq("id", id).single();
  const proposals = (pf as { is_proforma: boolean } | null)?.is_proforma ? [] : await proposeFor(db, id, ex, opts.contextJobId ?? null);
  const auto = (await getModuleMode(SUPPLIER_INVOICE_MODULE)) === "full";
  if (proposals.length) {
    const rows: AllocationInput[] = proposals.map((p) => ({
      itemId: p.itemId, target: p.target, jobId: p.jobId, category: p.category, amount: p.amount,
      purchaseOrderId: p.purchaseOrderId, purchaseOrderItemId: p.purchaseOrderItemId, orderItemId: p.orderItemId,
      aiSuggested: true, aiReason: p.reason, confirmed: auto,
    }));
    const { error: aErr } = await db.rpc("supplier_invoice_set_allocations" as never, { p_invoice: id, p_rows: rows.map(toRpcRow) } as never);
    if (aErr) throw new Error(aErr.message);
    if (!auto) await enqueueApproval(db, id, proposals);
  }
  const { data: after } = await db.from("supplier_invoices").select("status").eq("id", id).single();
  let status = (after as { status: SupplierInvoiceRow["status"] }).status;
  if (status === "nahrano") {
    await db.from("supplier_invoices").update({ status: "ke_kontrole" } as never).eq("id", id);
    status = "ke_kontrole";
  }
  return { status, duplicateOfId: null, proposals: proposals.length };
}

function toRpcRow(r: AllocationInput): Row {
  return {
    id: r.id ?? null, itemId: r.itemId, target: r.target, jobId: r.target === "job" ? r.jobId : null,
    category: r.target === "rezie" ? r.category ?? "ostatni" : null, amount: r.amount,
    purchaseOrderId: r.target === "job" ? r.purchaseOrderId ?? null : null,
    purchaseOrderItemId: r.target === "job" ? r.purchaseOrderItemId ?? null : null,
    orderItemId: r.target === "job" ? r.orderItemId ?? null : null,
    note: r.note ?? null, aiSuggested: Boolean(r.aiSuggested), aiReason: r.aiReason ?? null, confirmed: r.confirmed,
  };
}

const CLOSED: string[] = ["dokonceno", "nerealizovano", "zruseno"];

/** Kontext návrhu: objednávky dodavateli (zmíněné + dodavatele) a zakázky (zmíněné, s výkresy). */
async function proposeFor(db: JobsDb, id: string, ex: SupplierInvoiceExtract, contextJobId: string | null = null): Promise<ProposedAllocation[]> {
  const [{ data: inv }, { data: items }] = await Promise.all([
    db.from("supplier_invoices").select("supplier_id, total_net").eq("id", id).single(),
    db.from("supplier_invoice_items").select("id, text, code, amount, position").eq("invoice_id", id).order("position"),
  ]);
  const head = inv as { supplier_id: string | null; total_net: number | string | null };
  const itemRows = ((items ?? []) as { id: string; text: string; code: string | null; amount: number | string; position: number }[]);
  const allText = [
    ...itemRows.map((i) => `${i.text} ${i.code ?? ""}`),
    ...ex.items.flatMap((i) => i.refs),
    ...ex.references.purchaseOrderNumbers, ...ex.references.jobNumbers,
  ].join(" ");
  const poNumbers = [...new Set([...purchaseOrderNumbersIn(allText), ...ex.references.purchaseOrderNumbers])].slice(0, 50);
  const PO_SELECT = "id, number, job_id, supplier_id, status, total, job:orders!job_id(number, status, merged_into_id), items:purchase_order_items(id, drawing_number, name, order_item_id)";
  const pos = new Map<string, Row>();
  if (head.supplier_id) {
    const { data } = await db.from("purchase_orders").select(PO_SELECT).eq("supplier_id", head.supplier_id).neq("status", "zrusena").order("created_at", { ascending: false }).limit(100);
    for (const r of (data ?? []) as Row[]) pos.set(r.id as string, r);
  }
  if (poNumbers.length) {
    // čísla OV porovnává matching (normalizace) — načíst kandidáty podle číslic čísla
    const ors = poNumbers.map((n) => `number.ilike.%${n.replace(/[^0-9]/g, "").slice(-3)}%`).join(",");
    const { data } = await db.from("purchase_orders").select(PO_SELECT).or(ors).limit(200);
    for (const r of (data ?? []) as Row[]) pos.set(r.id as string, r);
  }
  const poIds = [...pos.keys()];
  const invoiced = new Set<string>();
  if (poIds.length) {
    const { data } = await db.from("supplier_invoice_allocations").select("purchase_order_id, invoice_id").in("purchase_order_id", poIds).not("confirmed_at", "is", null);
    for (const r of (data ?? []) as { purchase_order_id: string; invoice_id: string }[]) if (r.invoice_id !== id) invoiced.add(r.purchase_order_id);
  }
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
  const matchPos: MatchPurchaseOrder[] = [...pos.values()].flatMap((r) => {
    const job = one(r.job as Row | Row[] | null);
    if (!job || job.merged_into_id) return [];
    return [{
      id: r.id as string, number: (r.number as string | null) ?? null, jobId: r.job_id as string, jobNumber: String(job.number ?? ""),
      supplierId: (r.supplier_id as string | null) ?? null, status: String(r.status), total: Number(r.total ?? 0), invoiced: invoiced.has(r.id as string),
      items: ((r.items ?? []) as Row[]).map((i) => ({ id: i.id as string, drawingNumber: (i.drawing_number as string | null) ?? null, name: (i.name as string | null) ?? null, orderItemId: (i.order_item_id as string | null) ?? null })),
    }];
  });
  // zakázky: otevřené (výkresy, č. objednávky zákazníka) + zmíněné čísla
  const jobNumbers = [...new Set([...jobNumbersIn(allText), ...ex.references.jobNumbers])];
  const JOB_SELECT = "id, number, status, customer_order_number, merged_into_id, items:order_items(id, drawing_number, name)";
  const { data: jobsData } = await db.from("orders").select(JOB_SELECT)
    .is("merged_into_id", null).not("status", "in", `(${CLOSED.join(",")})`).order("created_at", { ascending: false }).limit(1500);
  const jobs = new Map<string, Row>(((jobsData ?? []) as Row[]).map((r) => [r.id as string, r]));
  if (jobNumbers.length) {
    const { data } = await db.from("orders").select(JOB_SELECT)
      .is("merged_into_id", null).in("number", jobNumbers.slice(0, 50)).limit(50);
    for (const r of (data ?? []) as Row[]) jobs.set(r.id as string, r);
  }
  // fotí se přímo u zakázky → ta je záložní návrh pro řádky bez vlastního důkazu (sloučená → cíl sloučení)
  let fallbackJobId: string | null = null;
  if (contextJobId) {
    const { data } = await db.from("orders").select(JOB_SELECT).eq("id", contextJobId).maybeSingle();
    let ctxJob = data as Row | null;
    if (ctxJob?.merged_into_id) {
      const { data: t } = await db.from("orders").select(JOB_SELECT).eq("id", ctxJob.merged_into_id as string).maybeSingle();
      ctxJob = t as Row | null;
    }
    if (ctxJob && !ctxJob.merged_into_id && !["nerealizovano", "zruseno"].includes(String(ctxJob.status))) {
      jobs.set(ctxJob.id as string, ctxJob);
      fallbackJobId = ctxJob.id as string;
    }
  }
  const matchJobs: MatchJob[] = [...jobs.values()].map((r) => ({
    id: r.id as string, number: String(r.number ?? ""), customerOrderNumber: (r.customer_order_number as string | null) ?? null,
    closed: CLOSED.includes(String(r.status)),
    items: ((r.items ?? []) as Row[]).map((i) => ({ id: i.id as string, drawingNumber: (i.drawing_number as string | null) ?? null, name: (i.name as string | null) ?? null })),
  }));
  const refsByPos = new Map(ex.items.map((it, i) => [i, it.refs]));
  return proposeAllocations({
    supplierId: head.supplier_id,
    totalNet: Number(head.total_net ?? 0),
    items: itemRows.map((r) => ({ id: r.id, text: r.text, code: r.code, amount: Number(r.amount), refs: refsByPos.get(r.position) ?? [] })),
    references: ex.references,
  }, matchPos, matchJobs, { fallbackJobId });
}

/** Řádek fronty schvalování „AI rozdělila fakturu" (jen super admin ji vidí). */
async function enqueueApproval(db: JobsDb, id: string, proposals: ProposedAllocation[]): Promise<void> {
  const { data: inv } = await db.from("supplier_invoices").select("number, supplier_name, total_net, currency, supplier:suppliers!supplier_id(name)").eq("id", id).single();
  const h = inv as { number: string | null; supplier_name: string | null; total_net: number | string | null; currency: string; supplier?: Row | Row[] | null };
  const supplier = String((Array.isArray(h.supplier) ? h.supplier[0] : h.supplier)?.name ?? h.supplier_name ?? "").trim();
  const jobIds = [...new Set(proposals.map((p) => p.jobId).filter((x): x is string => Boolean(x)))];
  const { data: jobs } = jobIds.length ? await db.from("orders").select("id, number").in("id", jobIds) : { data: [] };
  const num = new Map(((jobs ?? []) as { id: string; number: string }[]).map((j) => [j.id, j.number]));
  const money = (v: number) => `${v.toLocaleString("cs-CZ", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${h.currency === "CZK" ? "Kč" : h.currency}`;
  const lines = proposals.map((p) => `• ${p.target === "rezie" ? "Režie" : num.get(p.jobId ?? "") ?? "zakázka"}: ${money(p.amount)} — ${p.reason}`);
  // krátký titulek (mobil): kdo + číslo + částka; podrobnosti v souhrnu a textu
  const net = h.total_net === null || h.total_net === "" ? null : Number(h.total_net);
  const title = [supplier || "Faktura dodavatele", h.number ? `č. ${h.number}` : null, net !== null && Number.isFinite(net) ? money(net) : null]
    .filter(Boolean).join(" · ");
  const targets = [...new Set(proposals.map((p) => (p.target === "rezie" ? "režie" : num.get(p.jobId ?? "") ?? "zakázka")))];
  const conf = proposals.reduce((s, p) => s + p.confidence, 0) / Math.max(1, proposals.length);
  await resolveQueue(db, id, "rejected", { silent: true });
  await db.from("approval_queue").insert({
    type: "supplier_invoice", title: title.slice(0, 300),
    summary: `Faktura dodavatele${h.number ? ` ${h.number}` : ""}${supplier ? ` (${supplier})` : ""}${net !== null && Number.isFinite(net) ? `, ${money(net)} bez DPH` : ""} — AI navrhla rozdělení na ${targets.join(", ")}; potvrď jedním ťuknutím.`.slice(0, 500),
    payload: { invoiceId: id, body: lines.join("\n") }, status: "pending", ai_confidence: Math.round(conf * 1000) / 1000,
  } as never);
}

/**
 * Vyřídí čekající řádky fronty faktury. approved = potvrzeno (trigger potvrdí návrhy), rejected = zrušeno.
 * silent: stará položka nahrazená novým návrhem (bez mazání návrhů — dělá ho trigger jen u rejected bez silent).
 */
export async function resolveQueue(db: JobsDb, id: string, status: "approved" | "rejected", opts: { silent?: boolean } = {}): Promise<void> {
  // filtr v DB (ne prvních N v JS — při stovkách čekajících řádků by se ten správný minul)
  const { data } = await db.from("approval_queue").select("id").eq("type", "supplier_invoice").eq("status", "pending")
    .eq("payload->>invoiceId", id).limit(50);
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  if (!ids.length) return;
  if (opts.silent) {
    // náhrada starého návrhu: řádek fronty zmizí, nepotvrzené návrhy nechá (payload bez invoiceId = trigger nic nedělá)
    await db.from("approval_queue").update({ status: "rejected", payload: { replaced: true, invoice: id } } as never).in("id", ids);
    return;
  }
  await db.from("approval_queue").update({ status } as never).in("id", ids);
}

/** Uloží celé rozdělení faktury (validace stejná jako v DB). */
export async function saveAllocations(
  db: JobsDb,
  id: string,
  input: AllocationInput[],
): Promise<{ ok: true; status: SupplierInvoiceRow["status"] } | { ok: false; error: string }> {
  if (!isUuid(id)) return { ok: false, error: "Faktura nenalezena." };
  const rows = cleanAllocationInputs(Array.isArray(input) ? input.slice(0, 500) : []);
  for (const r of rows) {
    if (r.target !== "job" && r.target !== "rezie") return { ok: false, error: "Neplatný cíl rozdělení." };
    if (r.jobId && !isUuid(r.jobId)) return { ok: false, error: "Neplatná zakázka." };
    if (r.itemId && !isUuid(r.itemId)) return { ok: false, error: "Neplatná položka." };
    if (r.id && !isUuid(r.id)) r.id = null;
  }
  const [{ data: inv }, { data: items }] = await Promise.all([
    db.from("supplier_invoices").select("id, total_net, status, duplicate_of_id").eq("id", id).maybeSingle(),
    db.from("supplier_invoice_items").select("id, amount").eq("invoice_id", id),
  ]);
  const h = inv as { id: string; total_net: number | string | null; status: string; duplicate_of_id: string | null } | null;
  if (!h) return { ok: false, error: "Faktura nenalezena." };
  if (h.duplicate_of_id) return { ok: false, error: "Faktura je označená jako duplicita — nejdřív potvrď, že duplicita není." };
  const problem = validateAllocations(
    { totalNet: h.total_net === null ? null : Number(h.total_net), items: ((items ?? []) as { id: string; amount: number | string }[]).map((i) => ({ id: i.id, amount: Number(i.amount) })) },
    rows.map((r) => ({ itemId: r.itemId, target: r.target, jobId: r.target === "job" ? r.jobId : null, category: r.category, amount: r.amount })),
  );
  if (problem) return { ok: false, error: problem };
  const { error } = await db.rpc("supplier_invoice_set_allocations" as never, { p_invoice: id, p_rows: rows.map(toRpcRow) } as never);
  if (error) return { ok: false, error: errText(error) };
  const { count } = await db.from("supplier_invoice_allocations").select("id", { count: "exact", head: true }).eq("invoice_id", id).is("confirmed_at", null);
  if (!count) await resolveQueue(db, id, "approved");
  const { data: after } = await db.from("supplier_invoices").select("status").eq("id", id).single();
  return { ok: true, status: (after as { status: SupplierInvoiceRow["status"] }).status };
}

export interface ItemRpcRow {
  id: string | null;
  text: string;
  code: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  amount: number;
  vatRate: number | null;
}

/**
 * Nahradí položky faktury atomicky (RPC supplier_invoice_set_items: zámek faktury, jedna transakce, kapacita
 * rozdělení se zkontroluje na konci; faktura bez součtu dostane součet položek).
 */
export async function saveItems(db: JobsDb, id: string, rows: ItemRpcRow[]): Promise<{ ok: true; status: SupplierInvoiceRow["status"] } | { ok: false; error: string }> {
  if (!isUuid(id)) return { ok: false, error: "Faktura nenalezena." };
  const { data, error } = await db.rpc("supplier_invoice_set_items" as never, {
    p_invoice: id, p_rows: rows.map((r) => ({ ...r, id: r.id && isUuid(r.id) ? r.id : null })),
  } as never);
  if (error) return { ok: false, error: errText(error) };
  return { ok: true, status: ((data as { status?: SupplierInvoiceRow["status"] } | null)?.status ?? "ke_kontrole") };
}

/**
 * „Faktura konečná" u objednávky dodavateli: objednávka je touto fakturou vyfakturovaná celá → do nákladu
 * jde Σ faktur (i když je nižší než objednávka). Bez toho dílčí faktura náklad objednávky jen navyšuje.
 */
export async function setFinalPurchaseOrder(db: JobsDb, id: string, poId: string, final: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isUuid(id) || !isUuid(poId)) return { ok: false, error: "Faktura nenalezena." };
  const { data } = await db.from("supplier_invoices").select("final_po_ids").eq("id", id).maybeSingle();
  if (!data) return { ok: false, error: "Faktura nenalezena." };
  const { count } = await db.from("supplier_invoice_allocations").select("id", { count: "exact", head: true }).eq("invoice_id", id).eq("purchase_order_id", poId);
  if (final && !count) return { ok: false, error: "Faktura není rozdělená na tuhle objednávku." };
  const cur = ((data as { final_po_ids: string[] | null }).final_po_ids ?? []).filter((x) => x !== poId);
  const { error } = await db.from("supplier_invoices").update({ final_po_ids: final ? [...cur, poId] : cur } as never).eq("id", id);
  if (error) return { ok: false, error: errText(error) };
  return { ok: true };
}

/** Kurz ČNB ke dni DUZP (vystavení) — „Načíst kurz ČNB". */
export async function fillExchangeRate(db: JobsDb, id: string): Promise<{ ok: true; rate: number } | { ok: false; error: string }> {
  if (!isUuid(id)) return { ok: false, error: "Faktura nenalezena." };
  const { data } = await db.from("supplier_invoices").select("currency, taxable_date, issue_date").eq("id", id).maybeSingle();
  const h = data as { currency: string; taxable_date: string | null; issue_date: string | null } | null;
  if (!h) return { ok: false, error: "Faktura nenalezena." };
  if (h.currency === "CZK") return { ok: false, error: "Faktura je v korunách — kurz nepotřebuje." };
  const rate = await cnbRate(h.currency, h.taxable_date ?? h.issue_date);
  if (!rate) return { ok: false, error: `Kurz ${h.currency} se z ČNB nepodařilo načíst — doplň ho ručně (Upravit → Kurz).` };
  const { error } = await db.from("supplier_invoices").update({ exchange_rate: rate } as never).eq("id", id);
  if (error) return { ok: false, error: errText(error) };
  return { ok: true, rate };
}

/** „Potvrdit vše, co navrhla AI." */
export async function confirmAiAllocations(db: JobsDb, id: string): Promise<{ ok: true; confirmed: number } | { ok: false; error: string }> {
  if (!isUuid(id)) return { ok: false, error: "Faktura nenalezena." };
  const { data, error } = await db.from("supplier_invoice_allocations").update({ confirmed_at: new Date().toISOString() } as never)
    .eq("invoice_id", id).is("confirmed_at", null).select("id");
  if (error) return { ok: false, error: errText(error) };
  await resolveQueue(db, id, "approved");
  return { ok: true, confirmed: (data ?? []).length };
}

/** Zaplaceno / nezaplaceno (jen super admin — hlídá volající i DB). */
export async function setPayment(
  db: JobsDb,
  id: string,
  input: { status: SupplierInvoicePaymentStatus; paidAt?: string | null; paidAmount?: number | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isUuid(id)) return { ok: false, error: "Faktura nenalezena." };
  if (!["nezaplaceno", "castecne", "zaplaceno"].includes(input?.status)) return { ok: false, error: "Neplatný stav úhrady." };
  const paidAt = input.paidAt && /^\d{4}-\d{2}-\d{2}$/.test(input.paidAt) ? input.paidAt : null;
  const amount = input.status === "castecne" && typeof input.paidAmount === "number" && Number.isFinite(input.paidAmount) ? Math.round(input.paidAmount * 100) / 100 : null;
  const { data, error } = await db.from("supplier_invoices").update({
    payment_status: input.status, paid_at: input.status === "nezaplaceno" ? null : paidAt, paid_amount: amount,
  } as never).eq("id", id).select("id");
  if (error) return { ok: false, error: errText(error) };
  if (!(data ?? []).length) return { ok: false, error: "Faktura nenalezena." };
  return { ok: true };
}

/**
 * Dodavatel z hlavičky faktury: podle IČO (přesně), jinak shoda názvu / DIČ ≥ 80 → doplní jen prázdná pole;
 * jinak založí nového. Naše firma nikdy.
 */
export async function upsertSupplierFromParty(
  db: JobsDb,
  party: InvoiceSupplierParty,
): Promise<{ ok: true; id: string; name: string; created: boolean; filled: string[] } | { ok: false; error: string }> {
  if (isOurParty({ ico: party.ico, name: party.name })) return { ok: false, error: "Na faktuře je jako dodavatel naše firma — zkontroluj doklad." };
  const ico = normalizeIco(party.ico);
  const dic = normalizeDic(party.dic);
  const address = composeAddress({ street: party.street, city: party.city, zip: party.zip }) ?? null;
  let existing: Row | null = null;
  if (ico) {
    const { data } = await db.from("suppliers").select("*").eq("ico", ico).limit(1);
    existing = ((data ?? []) as Row[])[0] ?? null;
  }
  if (!existing) {
    const m = await matchSupplier(db, party);
    if (m) {
      const { data } = await db.from("suppliers").select("*").eq("id", m.id).maybeSingle();
      existing = (data as Row | null) ?? null;
    }
  }
  const values: Record<string, { col: string; v: string | null; label: string }> = {
    ico: { col: "ico", v: ico, label: "IČO" },
    dic: { col: "dic", v: dic, label: "DIČ" },
    address: { col: "address", v: address, label: "adresa" },
    bank: { col: "bank_account", v: party.bankAccount?.trim() || null, label: "bankovní účet" },
    email: { col: "email", v: party.email?.trim().toLowerCase() || null, label: "e-mail" },
    phone: { col: "phone", v: party.phone?.trim() || null, label: "telefon" },
    contact: { col: "contact_person", v: party.contactPerson?.trim() || null, label: "kontaktní osoba" },
  };
  if (existing) {
    const patch: Row = {};
    const filled: string[] = [];
    for (const x of Object.values(values)) {
      const cur = existing[x.col];
      if (x.v && (cur === null || cur === undefined || String(cur).trim() === "")) { patch[x.col] = x.v; filled.push(x.label); }
    }
    if (Object.keys(patch).length) {
      const { error } = await db.from("suppliers").update(patch as never).eq("id", existing.id as string);
      if (error) return { ok: false, error: errText(error) };
    }
    return { ok: true, id: existing.id as string, name: String(existing.name ?? party.name), created: false, filled };
  }
  if (!party.name.trim()) return { ok: false, error: "Na faktuře chybí název dodavatele." };
  const insert: Row = { name: party.name.trim().slice(0, 300), country: normalizeCountry(party.country) };
  const filled: string[] = [];
  for (const x of Object.values(values)) if (x.v) { insert[x.col] = x.v; filled.push(x.label); }
  const { data, error } = await db.from("suppliers").insert(insert as never).select("id, name").single();
  if (error || !data) return { ok: false, error: errText(error) };
  return { ok: true, id: (data as { id: string }).id, name: (data as { name: string }).name, created: true, filled };
}

/** Uložená hlavička faktury jako strana dodavatele (pro „Založit dodavatele"). */
export function partyOfInvoice(inv: Pick<SupplierInvoiceRow, "supplier_name" | "supplier_ico" | "supplier_dic" | "supplier_address" | "supplier_bank_account" | "supplier_email" | "supplier_phone" | "ai_extracted">): InvoiceSupplierParty {
  const ex = inv.ai_extracted ? normalizeSupplierInvoice(inv.ai_extracted).supplier : null;
  return {
    name: inv.supplier_name ?? ex?.name ?? "", ico: inv.supplier_ico ?? ex?.ico ?? "", dic: inv.supplier_dic ?? ex?.dic ?? "",
    street: ex?.street ?? (inv.supplier_address ?? ""), city: ex?.city ?? "", zip: ex?.zip ?? "", country: ex?.country ?? "CZ",
    email: inv.supplier_email ?? ex?.email ?? "", phone: inv.supplier_phone ?? ex?.phone ?? "", contactPerson: ex?.contactPerson ?? "",
    bankAccount: inv.supplier_bank_account ?? ex?.bankAccount ?? "",
  };
}
