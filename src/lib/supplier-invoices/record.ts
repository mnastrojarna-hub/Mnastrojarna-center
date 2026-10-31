import "server-only";
import { createHash } from "node:crypto";
import type { ActorContext } from "@/lib/supabase/actor-headers";
import type { JobsDb } from "@/lib/jobs/events";
import { isUuid } from "@/lib/jobs/mapping";
import { normalizeIco } from "@/lib/jobs/customers";
import { isOurParty } from "@/lib/jobs/purchasing-store";
import { getAiConfig, getSetting } from "@/lib/settings";
import { isFakeCapture } from "@/lib/ai/fake-capture";
import { aiFailureMessage } from "@/lib/ai/ai-call";
import { readSupplierInvoice } from "@/lib/ai/supplier-invoice-reader";
import { logAudit } from "@/lib/audit";
import {
  createSupplierInvoiceFromFile, markProcessingFailed, matchSupplier, numberNorm, upsertSupplierFromParty, type InvoiceFileInput,
} from "@/lib/supplier-invoices/service";
import {
  documentTypeLabel, invoiceFileKind, isInvoiceDocument, rejectTypeMessage,
  type RecordedInvoiceHead, type RecordInvoiceResult,
} from "@/lib/supplier-invoices/record-types";
import type { SupplierInvoiceExtract, SupplierInvoiceSource } from "@/lib/supplier-invoices/types";

/**
 * „Zanést fakturu" (zadání majitele 31. 10.) — JEDEN účetní doklad (PDF / obrázek) → AI přečte vše
 * (dodavatel — shoda podle IČO / DIČ / názvu, jinak založí; číslo, VS, data, částky, DPH, měna, účet,
 * položky, naše objednávky / zakázky → návrh rozdělení stávající logikou) → faktura zapsaná → potvrzení
 * s hlavičkou. Duplicita (stejný soubor, stejný dodavatel + číslo) se nezapíše podruhé. Doklad, který
 * podle AI není faktura (dodací list, nabídka…), se bez potvrzení nezapíše. Bez AI se doklad uloží
 * a údaje doplní super admin. Super admin dostane řádek do fronty „AI přehled" (Faktury ke kontrole).
 * Oprávnění hlídá volající (route / akce).
 */

const AI_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const AI_MAX_PDF_BYTES = 22 * 1024 * 1024;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** Přečtené doklady čekající na „Přesto zapsat" (bez druhého čtení AI; jen v rámci instance). */
const pendingExtracts = new Map<string, { at: number; extract: SupplierInvoiceExtract }>();
const PENDING_TTL_MS = 30 * 60 * 1000;

function remember(key: string, extract: SupplierInvoiceExtract): void {
  const now = Date.now();
  for (const [k, v] of pendingExtracts) if (now - v.at > PENDING_TTL_MS) pendingExtracts.delete(k);
  if (pendingExtracts.size > 100) pendingExtracts.delete(pendingExtracts.keys().next().value as string);
  pendingExtracts.set(key, { at: now, extract });
}

function recall(key: string): SupplierInvoiceExtract | null {
  const hit = pendingExtracts.get(key);
  if (!hit || Date.now() - hit.at > PENDING_TTL_MS) return null;
  return hit.extract;
}

export interface RecordInvoiceInput {
  file: InvoiceFileInput;
  source: SupplierInvoiceSource;
  /** Autor (nahrávající). */
  actor: ActorContext & { id: string };
  db: JobsDb;
  /** Smí Faktury dodavatelů (vrátí se id → „Otevřít fakturu"). */
  canOpen: boolean;
  /** „Přesto zapsat jako fakturu" (AI řekla, že to faktura není). */
  force?: boolean;
  emailId?: string | null;
  /** Idempotence (e-mail: „email:<příloha>"). */
  captureKey?: string | null;
  /** Dodavatel z e-mailu (když ho AI na dokladu nenajde). */
  supplierHintId?: string | null;
  /** Testovací háček (AI_FAKE_CAPTURE): skupina fixture. */
  fakeGroup?: string | null;
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

type Row = Record<string, unknown>;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const HEAD_SELECT = "id, number, supplier_name, total_net, total_gross, currency, due_date, ai_extracted, created_at, uploaded_by, supplier:suppliers!supplier_id(name), uploader:profiles!uploaded_by(full_name, email)";

function headOf(r: Row): RecordedInvoiceHead {
  const sup = one(r.supplier as Row | Row[] | null);
  const ex = (r.ai_extracted ?? null) as { documentType?: string } | null;
  const gross = numOrNull(r.total_gross);
  return {
    supplierName: String(sup?.name ?? r.supplier_name ?? "").trim() || null,
    number: (r.number as string | null) || null,
    amount: gross ?? numOrNull(r.total_net),
    currency: String(r.currency ?? "CZK"),
    dueDate: (r.due_date as string | null) || null,
    documentType: (ex?.documentType as RecordedInvoiceHead["documentType"]) ?? "faktura",
  };
}

function headOfExtract(ex: SupplierInvoiceExtract): RecordedInvoiceHead {
  return {
    supplierName: ex.supplier.name || null,
    number: ex.number || null,
    amount: ex.totalGross || ex.totalNet || null,
    currency: ex.currency,
    dueDate: ex.dueDate || null,
    documentType: ex.documentType ?? "faktura",
  };
}

async function loadHead(db: JobsDb, id: string): Promise<Row | null> {
  const { data } = await db.from("supplier_invoices").select(HEAD_SELECT).eq("id", id).maybeSingle();
  return (data as Row | null) ?? null;
}

async function duplicateOf(db: JobsDb, id: string, canOpen: boolean): Promise<RecordInvoiceResult> {
  const r = await loadHead(db, id);
  const up = one((r?.uploader ?? null) as Row | Row[] | null);
  return {
    ok: true, kind: "duplicate",
    recordedAt: String(r?.created_at ?? new Date().toISOString()),
    recordedBy: String(up?.full_name ?? up?.email ?? "").trim() || null,
    head: r ? headOf(r) : null,
    ...(canOpen ? { id } : {}),
  };
}

/** Stejná faktura (dodavatel + číslo) už zapsaná? Klíč dodavatele jako v DB (IČO → id → název). */
async function findSameNumber(db: JobsDb, ex: SupplierInvoiceExtract, supplierId: string | null): Promise<string | null> {
  const nnorm = numberNorm(ex.number);
  if (!nnorm) return null;
  const keys = [normalizeIco(ex.supplier.ico), supplierId, ex.supplier.name.trim().toLowerCase() || null]
    .filter((k): k is string => Boolean(k));
  const base = () => db.from("supplier_invoices").select("id").eq("number_norm", nnorm).is("duplicate_of_id", null).neq("status", "zamitnuto");
  for (const k of [...new Set(keys)]) {
    const { data } = await base().eq("supplier_key", k).order("created_at").limit(1);
    const hit = ((data ?? []) as { id: string }[])[0];
    if (hit) return hit.id;
  }
  if (supplierId) {
    const { data } = await base().eq("supplier_id", supplierId).order("created_at").limit(1);
    const hit = ((data ?? []) as { id: string }[])[0];
    if (hit) return hit.id;
  }
  return null;
}

/** Řádek fronty „AI přehled" pro super admina: nová faktura ke kontrole (jen když tam žádný není). */
export async function notifyNewInvoice(db: JobsDb, id: string, uploaderName: string | null): Promise<void> {
  try {
    const r = await loadHead(db, id);
    if (!r) return;
    const { data: st } = await db.from("supplier_invoices").select("status").eq("id", id).maybeSingle();
    if ((st as { status?: string } | null)?.status === "zpracovano") return;
    const { count } = await db.from("approval_queue").select("id", { count: "exact", head: true })
      .eq("type", "supplier_invoice").eq("status", "pending").eq("payload->>invoiceId", id);
    if ((count ?? 0) > 0) return;
    const h = headOf(r);
    const money = h.amount !== null ? `${h.amount.toLocaleString("cs-CZ", { maximumFractionDigits: 2 })} ${h.currency === "CZK" ? "Kč" : h.currency}` : null;
    const title = [h.supplierName ?? "Nová faktura dodavatele", h.number ? `č. ${h.number}` : null, money].filter(Boolean).join(" · ");
    await db.from("approval_queue").insert({
      type: "supplier_invoice", title: title.slice(0, 300),
      summary: `Nová faktura${uploaderName ? ` — zapsal(a) ${uploaderName}` : ""}. Zkontroluj ji ve Fakturách dodavatelů.`.slice(0, 500),
      payload: { invoiceId: id, check: true }, status: "pending",
    } as never);
  } catch {
    // upozornění je best-effort (faktura je zapsaná)
  }
}

async function uploaderName(db: JobsDb, userId: string): Promise<string | null> {
  const { data } = await db.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
  const p = data as { full_name: string | null; email: string | null } | null;
  return String(p?.full_name ?? p?.email ?? "").trim() || null;
}

/** Uloží doklad bez AI (bez klíče / chyba čtení) — údaje doplní super admin. */
async function storeWithoutAi(input: RecordInvoiceInput, file: InvoiceFileInput, reason: string): Promise<RecordInvoiceResult> {
  const res = await createSupplierInvoiceFromFile(file, input.source, input.actor, {
    db: input.db, process: "none", emailId: input.emailId ?? null, captureKey: input.captureKey ?? null,
    supplierId: isUuid(input.supplierHintId) ? input.supplierHintId : null,
  });
  if (!res.ok) return res;
  if (!res.created) return duplicateOf(input.db, res.duplicateOfId ?? res.id, input.canOpen);
  await markProcessingFailed(input.db, res.id, reason);
  await notifyNewInvoice(input.db, res.id, await uploaderName(input.db, input.actor.id));
  await logAudit({ action: "supplier_invoice_recorded", entity: "supplier_invoices", entityId: res.id, diff: { ai: false, source: input.source, reason }, actor: input.actor });
  return {
    ok: true, kind: "recorded", aiFilled: false,
    head: { supplierName: null, number: null, amount: null, currency: "CZK", dueDate: null, documentType: "faktura" },
    ...(input.canOpen ? { id: res.id } : {}),
  };
}

export async function recordInvoiceDocument(input: RecordInvoiceInput): Promise<RecordInvoiceResult> {
  const { db } = input;
  let file = input.file;
  if (!file?.bytes?.length) return { ok: false, error: "Soubor faktury je prázdný — vyber ho prosím znovu." };
  if (file.bytes.length > MAX_FILE_BYTES) return { ok: false, error: "Soubor je větší než 50 MB." };
  const kind = invoiceFileKind(file.bytes);
  if (!kind) return { ok: false, error: rejectTypeMessage(file.filename) };
  if (kind === "heic") {
    try {
      const { heicToJpeg } = await import("@/lib/anonymize/image");
      const jpeg = await heicToJpeg(file.bytes);
      file = { bytes: jpeg, filename: `${file.filename.replace(/\.[^.]+$/, "") || "faktura"}.jpg`, mimeType: "image/jpeg" };
    } catch {
      return { ok: false, error: "Fotku HEIC se nepodařilo přečíst — vyfoť fakturu znovu (JPG) nebo nahraj PDF." };
    }
  }
  const sha = createHash("sha256").update(file.bytes).digest("hex");
  try {
    // 1) stejný soubor / stejná příloha už zapsaná
    if (input.captureKey) {
      const { data } = await db.from("supplier_invoices").select("id, duplicate_of_id").eq("capture_key", input.captureKey).maybeSingle();
      const p = data as { id: string; duplicate_of_id: string | null } | null;
      if (p) return duplicateOf(db, p.duplicate_of_id ?? p.id, input.canOpen);
    }
    const { data: same } = await db.from("supplier_invoices").select("id, duplicate_of_id").eq("content_sha256", sha).neq("status", "zamitnuto")
      .order("created_at").limit(1);
    const hit = ((same ?? []) as { id: string; duplicate_of_id: string | null }[])[0];
    if (hit) return duplicateOf(db, hit.duplicate_of_id ?? hit.id, input.canOpen);

    // 2) AI čtení (bez AI: uložit, údaje doplní účetní)
    if (!(await aiReady())) return storeWithoutAi(input, file, "AI není zapnuté nebo nastavené — vyplň fakturu ručně.");
    const mime = kind === "pdf" ? "application/pdf" : (invoiceMime(file.bytes) ?? "image/jpeg");
    const tooBig = mime === "application/pdf" ? file.bytes.length > AI_MAX_PDF_BYTES : file.bytes.length > AI_MAX_IMAGE_BYTES;
    if (tooBig && !isFakeCapture()) return storeWithoutAi(input, file, "Soubor je pro AI příliš velký — vyplň fakturu ručně.");
    const cacheKey = `${input.actor.id}:${sha}`;
    let extract = input.force ? recall(cacheKey) : null;
    if (!extract) {
      try {
        extract = (await readSupplierInvoice({
          files: [{ mediaType: mime, dataBase64: Buffer.from(file.bytes).toString("base64") }],
          fakeGroup: input.fakeGroup ?? null,
        })).invoice;
      } catch (err) {
        return storeWithoutAi(input, file, aiFailureMessage(err).slice(0, 400));
      }
    }

    // 3) není to faktura → zeptat se (nic se nezapsalo)
    if (!isInvoiceDocument(extract.documentType) && !input.force) {
      remember(cacheKey, extract);
      return { ok: true, kind: "not_invoice", documentType: extract.documentType ?? "jiny", label: documentTypeLabel(extract.documentType), head: headOfExtract(extract) };
    }
    pendingExtracts.delete(cacheKey);

    // 4) dodavatel: shoda IČO / DIČ / název (adresář se nemění); nový se založí až u nové faktury
    const party = extract.supplier;
    const validParty = Boolean(party.name || party.ico) && !isOurParty({ ico: party.ico, name: party.name });
    let supplierId: string | null = null;
    if (validParty) {
      const ico = normalizeIco(party.ico);
      if (ico) {
        const { data } = await db.from("suppliers").select("id").eq("ico", ico).limit(1);
        supplierId = ((data ?? []) as { id: string }[])[0]?.id ?? null;
      }
      if (!supplierId) supplierId = (await matchSupplier(db, party))?.id ?? null;
    }

    // 5) stejná faktura (dodavatel + číslo) už zapsaná jiným souborem
    const sameNumber = await findSameNumber(db, extract, supplierId);
    if (sameNumber) return duplicateOf(db, sameNumber, input.canOpen);

    if (!supplierId && validParty) {
      const sup = await upsertSupplierFromParty(db, party);
      if (sup.ok) {
        supplierId = sup.id;
        if (sup.created) {
          await logAudit({
            action: "supplier_created_from_invoice", entity: "suppliers", entityId: sup.id,
            diff: { filled: sup.filled, via: "zanest_fakturu" }, actor: input.actor,
          });
        }
      }
    }
    if (!supplierId && isUuid(input.supplierHintId)) supplierId = input.supplierHintId;

    // 6) zápis (hlavička, položky, návrh rozdělení podle režimu automatiky — stávající logika)
    const forced = !isInvoiceDocument(extract.documentType);
    const res = await createSupplierInvoiceFromFile(file, input.source, input.actor, {
      db, extract, aiUsed: true, supplierId, emailId: input.emailId ?? null, captureKey: input.captureKey ?? null,
      note: forced ? `AI: doklad vypadá jako ${documentTypeLabel(extract.documentType)} — zapsáno jako faktura na přání nahrávajícího.` : null,
    });
    if (!res.ok) return res;
    if (!res.created || res.duplicateOfId) return duplicateOf(db, res.duplicateOfId ?? res.id, input.canOpen);
    await notifyNewInvoice(db, res.id, await uploaderName(db, input.actor.id));
    await logAudit({
      action: "supplier_invoice_recorded", entity: "supplier_invoices", entityId: res.id,
      diff: { ai: true, source: input.source, forced, documentType: extract.documentType ?? "faktura", status: res.status }, actor: input.actor,
    });
    const r = await loadHead(db, res.id);
    return {
      ok: true, kind: "recorded", aiFilled: true,
      head: r ? headOf(r) : headOfExtract(extract),
      ...(input.canOpen ? { id: res.id } : {}),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Fakturu se nepodařilo zapsat." };
  }
}

function invoiceMime(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b[0] === 0x52 && b[1] === 0x49) return "image/webp";
  return null;
}
