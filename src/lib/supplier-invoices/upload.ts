import "server-only";
import { createAdminClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAccess, getSessionUser } from "@/lib/auth/session";
import { userActor } from "@/lib/supabase/actor-headers";
import type { JobsDb } from "@/lib/jobs/events";
import { CAPTURE_BATCH_MAX_FILES, CAPTURE_BUCKET, captureHiresPath, sniffDocumentMime } from "@/lib/jobs/capture-review";
import { cleanFileRefs } from "@/lib/jobs/capture-service";
import { isUuid } from "@/lib/jobs/mapping";
import { fakeGroupFor, isFakeCapture } from "@/lib/ai/fake-capture";
import { aiFailureMessage } from "@/lib/ai/ai-call";
import { readSupplierInvoice } from "@/lib/ai/supplier-invoice-reader";
import { logAudit } from "@/lib/audit";
import { supplierInvoicePerms } from "@/lib/supplier-invoices/access";
import {
  createSupplierInvoiceFromFile, processSupplierInvoice, upsertSupplierFromParty, type InvoiceFileInput,
} from "@/lib/supplier-invoices/service";
import { THANKS_TEXT, type SupplierInvoiceSource } from "@/lib/supplier-invoices/types";
import { recordInvoiceDocument } from "@/lib/supplier-invoices/record";
import { ONLY_ONE_FILE, recordResultMessage, type RecordInvoiceResult } from "@/lib/supplier-invoices/record-types";
import { dateText, formatMoney } from "@/components/supplier-invoices/format";
import { getAiConfig, getSetting } from "@/lib/settings";

/**
 * Nahrání faktury mimo focení (stránka „Nahrát fakturu", Dodavatelé → „Přiložit fakturu").
 * Soubory nahrává prohlížeč podepsanou URL do capture/<já>/ (stejně jako focení), server je přesune
 * do bucketu faktur a stránky v capture/ smaže.
 */

type Fail = { ok: false; error: string };

export interface UploadInvoiceResult {
  ok: true;
  /** Text pro každého („Děkujeme, nahráno…"). */
  message: string;
  /** Jen s právem na faktury. */
  id?: string;
  duplicate?: boolean;
}

async function captureFiles(db: JobsDb, userId: string, raw: unknown): Promise<{ files: InvoiceFileInput[]; paths: string[]; names: string[] } | Fail> {
  const refs = cleanFileRefs(userId, raw, Math.min(CAPTURE_BATCH_MAX_FILES, 30));
  if (typeof refs === "string") return { ok: false, error: refs };
  const files: InvoiceFileInput[] = [];
  for (const f of refs) {
    const { data, error } = await db.storage.from(CAPTURE_BUCKET).download(f.path);
    if (error || !data) return { ok: false, error: `Soubor ${f.filename} se nepodařilo načíst — nahraj ho prosím znovu.` };
    files.push({ bytes: new Uint8Array(await (data as Blob).arrayBuffer()), filename: f.filename, mimeType: f.mimeType });
  }
  const hires = (p: string) => { const h = captureHiresPath(p); return h ? [h] : []; };
  return { files, paths: refs.flatMap((f) => [f.path, ...(f.sortPath ? [f.sortPath] : []), ...hires(f.path)]), names: refs.map((f) => f.filename) };
}

function sourceOf(raw: unknown, files: InvoiceFileInput[]): SupplierInvoiceSource {
  if (raw === "photo" || raw === "scan" || raw === "upload") return raw;
  return files.some((f) => sniffDocumentMime(f.bytes) === "application/pdf") ? "upload" : "photo";
}

async function removeCapture(db: JobsDb, paths: string[]): Promise<void> {
  if (!paths.length) return;
  try { await db.storage.from(CAPTURE_BUCKET).remove(paths); } catch { /* úklid je best-effort */ }
}

/**
 * „Zanést fakturu" (31. 10., všichni): JEDEN soubor = jedna faktura (PDF / obrázek). AI ji hned přečte a zapíše;
 * odpověď nese potvrzení s hlavičkou (dodavatel, číslo, částka, splatnost), duplicitu, nebo „tohle není faktura"
 * (soubor zůstává v capture/ pro „Přesto zapsat" — force). Id faktury jen kdo smí Faktury dodavatelů.
 */
export async function uploadSupplierInvoice(input: { files: unknown; source?: unknown; force?: unknown }): Promise<(RecordInvoiceResult & { message: string }) | Fail> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  const user = await getSessionUser();
  if (!user || !user.active) return { ok: false, error: "Nejsi přihlášen — přihlas se znovu." };
  const access = await getAccess();
  const perms = supplierInvoicePerms(access.can);
  if (!perms.upload) return { ok: false, error: "K této akci nemáš oprávnění." };
  if (Array.isArray(input?.files) && input.files.length > 1) return { ok: false, error: ONLY_ONE_FILE };
  const actor = userActor(user, "foto");
  const db = createAdminClient({ actor }) as unknown as JobsDb;
  const got = await captureFiles(db, user.id, input?.files);
  if ("error" in got) return got;
  if (got.files.length !== 1) return { ok: false, error: ONLY_ONE_FILE };
  const res = await recordInvoiceDocument({
    file: got.files[0], source: sourceOf(input?.source, got.files), actor: { ...actor, id: user.id }, db,
    canOpen: perms.view && perms.amounts, force: input?.force === true,
    fakeGroup: fakeGroupFor("faktura_dodavatel", got.names),
  });
  // nevhodný soubor / hotovo → stránka v capture/ pryč; „není faktura" čeká na rozhodnutí (Přesto zapsat / Zrušit)
  if (!(res.ok && res.kind === "not_invoice")) await removeCapture(db, got.paths);
  if (!res.ok) return res;
  return { ...res, message: recordResultMessage(res, { money: (n, c) => formatMoney(n, c), date: (d) => dateText(d) }) };
}

export async function reprocessSupplierInvoice(id: string): Promise<{ ok: true; status: string } | Fail> {
  const user = await getSessionUser();
  if (!user || !user.active) return { ok: false, error: "Nejsi přihlášen — přihlas se znovu." };
  const perms = supplierInvoicePerms((await getAccess()).can);
  if (!perms.edit) return { ok: false, error: "K této akci nemáš oprávnění." };
  if (!isUuid(id)) return { ok: false, error: "Faktura nenalezena." };
  const res = await processSupplierInvoice(id, { actor: { id: user.id, kind: "ai", via: "ai", agent: "supplier-invoice" }, force: true });
  if (!res.ok) return res;
  return { ok: true, status: res.status };
}

async function aiReady(): Promise<boolean> {
  if (isFakeCapture()) return true;
  const [enabled, ai] = await Promise.all([getSetting("ai_enabled"), getAiConfig()]);
  const off = ["0", "false", "ne", "no", "off"].includes(String(enabled ?? "").trim().toLowerCase());
  return !off && Boolean(ai.apiKey);
}

export interface SupplierFromInvoiceResult {
  ok: true;
  supplier: { id: string; name: string; created: boolean; filled: string[] };
  invoice: { message: string; id?: string } | null;
}

/** Dodavatelé → „Přiložit fakturu": dodavatel z hlavičky (dedupe IČO), volitelně i faktura (bez druhého čtení AI). */
export async function supplierFromInvoiceUpload(input: { files: unknown; createInvoice: boolean }): Promise<SupplierFromInvoiceResult | Fail> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  const user = await getSessionUser();
  if (!user || !user.active) return { ok: false, error: "Nejsi přihlášen — přihlas se znovu." };
  const access = await getAccess();
  if (!access.can("suppliers")) return { ok: false, error: "K této akci nemáš oprávnění." };
  const perms = supplierInvoicePerms(access.can);
  const actor = userActor(user, "foto");
  const db = createAdminClient({ actor }) as unknown as JobsDb;
  const got = await captureFiles(db, user.id, input?.files);
  if ("error" in got) return got;
  if (!(await aiReady())) return { ok: false, error: "AI není zapnuté nebo nastavené — dodavatele založ ručně (Nový dodavatel)." };
  const aiFiles = got.files.flatMap((f) => {
    const mime = sniffDocumentMime(f.bytes);
    return mime ? [{ mediaType: mime, dataBase64: Buffer.from(f.bytes).toString("base64") }] : [];
  });
  if (!aiFiles.length && !isFakeCapture()) return { ok: false, error: "AI umí číst fotky (JPG, PNG, WEBP) a PDF — tenhle formát ne." };
  let extract;
  try {
    extract = (await readSupplierInvoice({ files: aiFiles, fakeGroup: fakeGroupFor("faktura_dodavatel", got.names) })).invoice;
  } catch (err) {
    return { ok: false, error: aiFailureMessage(err) };
  }
  const sup = await upsertSupplierFromParty(db, extract.supplier);
  if (!sup.ok) return sup;
  let invoice: SupplierFromInvoiceResult["invoice"] = null;
  if (input.createInvoice) {
    const res = await createSupplierInvoiceFromFile(got.files, sourceOf(null, got.files), actor, { db, extract, aiUsed: true, supplierId: sup.id });
    if (res.ok) invoice = perms.view && perms.amounts ? { message: res.created ? "Faktura uložena do Faktur dodavatelů." : "Tahle faktura už je nahraná.", id: res.id } : { message: THANKS_TEXT };
    else invoice = { message: `Fakturu se nepodařilo uložit: ${res.error}` };
  }
  await removeCapture(db, got.paths);
  await logAudit({
    action: sup.created ? "supplier_created_from_invoice" : "supplier_filled_from_invoice", entity: "suppliers", entityId: sup.id,
    diff: { filled: sup.filled, invoice: Boolean(invoice) }, actor,
  });
  return { ok: true, supplier: { id: sup.id, name: sup.name, created: sup.created, filled: sup.filled }, invoice };
}

