import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { COMPANY } from "@/lib/company";
import { refreshCompanyFromSettings } from "@/lib/company-server";
import { getSetting } from "@/lib/settings";
import { logAudit } from "@/lib/audit";
import { sendMail, senderSignatureText } from "@/lib/email/send";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { registerJobFileCore } from "@/lib/jobs/job-files-store";
import { cleanDate, cleanNumber, cleanText, fetchPaged, isUuid, jobFilePath, one } from "@/lib/jobs/mapping";
import { selectWinningQuoteCore } from "@/lib/jobs/purchasing-store";
import { fetchProfileContact } from "@/lib/data/purchasing";
import { pragueToday } from "@/lib/jobs/flow-status";
import { OPERATION_KINDS, isOperationKind, type OperationKind } from "@/lib/jobs/operations";
import { normalizeDrawingNumber } from "@/lib/jobs/production-suggest";
import { toneFor } from "@/lib/contacts/server";
import { supplierParty } from "@/lib/pdf/components";
import { SHARE_FILE_SELECT, pickShareFile, sharePriceDocIds, verifyShareBytes, type FileRowWithAnon } from "@/lib/anonymize/share";
import { enqueueSend, sendWithoutPending } from "@/lib/anonymize/send-queue";
import { appOrigin, kick } from "@/lib/anonymize/queue";
import { renderRfqPdf } from "./pdf";
import {
  RFQ_MAX_QTY_VARIANTS, RFQ_MAX_SUPPLIERS, RFQ_WEIGHTS_SETTING, cleanKinds, compareRfq, customerLeakGuard,
  findLeaks, isRecipientStatus, neutralFileName, normalizeWeights, redactCustomer, rfqDefaultDates, rfqMail,
  rfqPdfFileName, rfqReminderMail, rfqThanksMail, whatText,
  type LeakGuard, type RankHistory, type RankSupplier, type RfqItem, type RfqOffer, type RfqRecipientView, type RfqRoundView,
  type RfqScope, type RfqSelectionView, type RfqWeights, type SupplierQuality,
} from "./model";

/**
 * Poptávky dodavatelům — práce s DB (servisní klient; oprávnění „rfq" hlídá volající akce). Každý dodavatel
 * dostane SAMOSTATNÝ e-mail (nikdy společné Komu / Kopie), s naším PDF poptávky a jen ANONYMIZOVANÝMI výkresy
 * (anonymize/share.ts); výkres, který se ještě anonymizuje → fronta anon_send_queue (odejde sám po dokončení),
 * selhání SMTP → fronta K odeslání (Pošta → „Přijmout a odeslat"). Do historie zakázky nikdy nejdou ceny.
 */

type Row = Record<string, unknown>;
type Db = SupabaseClient;
const BUCKET = "job-files";
const RFQ_TABLES_MISSING = /rfq_|relation .* does not exist|schema cache/i;

function loose(db: JobsDb): Db {
  return db as unknown as Db;
}

export interface RfqActor { id: string; fullName: string; role: string }

// ── Kontext zakázky pro dialog ──────────────────────────────
export interface RfqSetupItem {
  id: string;
  position: number;
  drawingNumber: string | null;
  revision: string | null;
  name: string | null;
  material: string | null;
  quantity: number;
  unit: string;
}

export interface RfqSetupStep {
  id: string;
  kind: OperationKind;
  label: string;
  itemIds: string[] | null;
  who: string | null;
}

export interface RfqSetupDrawing {
  id: string;
  itemId: string | null;
  /** Bezpečný název pro dodavatele (nikdy původní). */
  name: string;
  status: "ready" | "pending" | "blocked";
  message: string | null;
}

export interface RfqSetup {
  job: { id: string; number: string; stage: string; customerDate: string | null };
  items: RfqSetupItem[];
  steps: RfqSetupStep[];
  drawings: RfqSetupDrawing[];
  suppliers: RankSupplier[];
  history: RankHistory;
  quality: SupplierQuality[];
  defaults: { requiredDate: string; replyBy: string };
  today: string;
}

interface JobRow {
  id: string; number: string; title: string | null; status: string; due_date: string | null; customer_required_date: string | null;
  customer_order_number: string | null; customer_inquiry_number: string | null; customer_contact: string | null; customer_contact_email: string | null;
  customer: { name: string | null; ico: string | null; dic: string | null; email: string | null } | null;
}

async function loadJob(db: Db, jobId: string): Promise<JobRow | null> {
  const { data } = await db.from("orders")
    .select("id, number, title, status, due_date, customer_required_date, customer_order_number, customer_inquiry_number, customer_contact, customer_contact_email, customer:customers!customer_id(name, ico, dic, email)")
    .eq("id", jobId).maybeSingle();
  if (!data) return null;
  const r = data as Row;
  return { ...(r as unknown as JobRow), customer: one(r.customer as JobRow["customer"] | JobRow["customer"][] | null) };
}

export function guardOfJob(j: JobRow): LeakGuard {
  return customerLeakGuard({
    name: j.customer?.name, ico: j.customer?.ico, dic: j.customer?.dic, email: j.customer?.email ?? j.customer_contact_email,
    contact: j.customer_contact, numbers: [j.customer_order_number, j.customer_inquiry_number],
  });
}

async function loadItems(db: Db, jobId: string): Promise<RfqSetupItem[]> {
  const { data } = await db.from("order_items")
    .select("id, position, drawing_number, revision, name, material, material_designation, quantity, unit")
    .eq("order_id", jobId).order("position");
  return ((data ?? []) as Row[]).map((r) => ({
    id: String(r.id), position: Number(r.position) || 0, drawingNumber: cleanText(r.drawing_number, 120), revision: cleanText(r.revision, 40),
    name: cleanText(r.name, 300), material: cleanText(r.material_designation, 200) ?? cleanText(r.material, 200),
    quantity: Number(r.quantity) || 1, unit: cleanText(r.unit, 20) ?? "ks",
  }));
}

/** Výkresy zakázky k položkám (bez poptávky / objednávky zákazníka) + stav pro dodavatele. */
async function loadDrawings(db: Db, jobId: string, items: RfqSetupItem[]): Promise<RfqSetupDrawing[]> {
  const { data } = await db.from("job_files").select(`${SHARE_FILE_SELECT}, order_item_id, archived`)
    .eq("job_id", jobId).eq("archived", false).in("kind", ["vykres", "model_3d"]).order("created_at");
  const rows = (data ?? []) as (FileRowWithAnon & { order_item_id: string | null })[];
  const price = await sharePriceDocIds(db as never, rows.map((r) => r.id));
  const out: RfqSetupDrawing[] = [];
  rows.forEach((f, i) => {
    let itemId = f.order_item_id;
    if (!itemId) {
      const flat = (f.filename ?? "").replace(/[\s.\-/_]/g, "").toUpperCase();
      itemId = items.find((it) => {
        const n = normalizeDrawingNumber(it.drawingNumber);
        return n && n.length >= 3 && flat.includes(n);
      })?.id ?? null;
    }
    const it = items.find((x) => x.id === itemId) ?? null;
    const dec = pickShareFile(f, { priceDocument: price.has(f.id.toLowerCase()) });
    const ext = /\.([A-Za-z0-9]{1,8})$/.exec(dec.ok ? dec.filename : f.filename)?.[1] ?? "pdf";
    out.push({
      id: f.id, itemId,
      name: neutralFileName({ drawingNumber: it?.drawingNumber, revision: it?.revision, ext, roundNumber: "PD", index: i + 1 }),
      status: dec.ok ? "ready" : dec.reason === "pending" ? "pending" : "blocked",
      message: dec.ok ? null : dec.message,
    });
  });
  return out;
}

/** Dodavatelé s adresou pro poptávky (účel „Poptávky" → e-mail firmy → hlavní kontakt). */
async function loadSuppliers(db: Db): Promise<RankSupplier[]> {
  const [{ data: sups }, roles, contacts] = await Promise.all([
    fetchPaged<Row>((from, to) => db.from("suppliers").select("id, name, email, technologies, materials, certifications, lead_days, rating").order("name").order("id").range(from, to), 5000),
    db.from("party_role_emails").select("supplier_id, email, is_default, supplier_contact_id, contact:supplier_contacts!supplier_contact_id(email)").eq("role", "nabidky").not("supplier_id", "is", null),
    db.from("supplier_contacts").select("supplier_id, email, is_primary").not("email", "is", null),
  ]);
  const roleMail = new Map<string, string>();
  for (const r of ((roles.error ? [] : roles.data) ?? []) as Row[]) {
    const e = cleanText(r.email, 300) ?? cleanText(one(r.contact as Row | Row[] | null)?.email, 300);
    const sid = String(r.supplier_id);
    if (e && (!roleMail.has(sid) || r.is_default)) roleMail.set(sid, e);
  }
  const contactMail = new Map<string, string>();
  for (const r of ((contacts.error ? [] : contacts.data) ?? []) as Row[]) {
    const sid = String(r.supplier_id);
    const e = cleanText(r.email, 300);
    if (e && (!contactMail.has(sid) || r.is_primary)) contactMail.set(sid, e);
  }
  const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).map(String).filter(Boolean) : []);
  return (sups as Row[]).map((s) => {
    const id = String(s.id);
    return {
      id, name: String(s.name ?? ""), technologies: arr(s.technologies), materials: arr(s.materials), certifications: arr(s.certifications),
      leadDays: cleanNumber(s.lead_days), rating: cleanNumber(s.rating),
      email: roleMail.get(id) ?? cleanText(s.email, 300) ?? contactMail.get(id) ?? null,
    };
  });
}

export async function loadQuality(db: Db, ids: string[]): Promise<SupplierQuality[]> {
  const list = [...new Set(ids.filter(isUuid))];
  if (!list.length) return [];
  const { data, error } = await db.rpc("supplier_quality_stats", { p_ids: list });
  if (error) return [];
  return ((data ?? []) as Row[]).map((r) => ({
    supplierId: String(r.supplier_id), rating: null, certifications: [], ordersDone: Number(r.orders_done) || 0, onTime: Number(r.on_time) || 0,
    late: Number(r.late) || 0, avgDelayDays: r.avg_delay_days === null || r.avg_delay_days === undefined ? null : Number(r.avg_delay_days),
    issues: Number(r.issues) || 0, jobs: Number(r.jobs) || 0,
  }));
}

async function loadHistory(db: Db, jobId: string, items: RfqSetupItem[]): Promise<RankHistory> {
  const out: RankHistory = { drawings: [], operations: [], rfq: [] };
  try {
    const raw = [...new Set(items.map((i) => (i.drawingNumber ?? "").trim()).filter(Boolean))].slice(0, 50);
    if (raw.length) {
      const { data } = await db.from("purchase_order_items")
        .select("drawing_number, unit_price, po:purchase_orders!purchase_order_id(job_id, status, supplier_id)")
        // purchase_order_items nemá created_at (řazení by dotaz shodilo) — stačí posledních pár set řádků
        .in("drawing_number", raw).limit(200);
      for (const r of (data ?? []) as Row[]) {
        const po = one(r.po as Row | Row[] | null);
        if (!po || po.job_id === jobId || po.status === "zrusena") continue;
        out.drawings.push({ drawingNumber: String(r.drawing_number ?? ""), supplierId: (po.supplier_id as string | null) ?? null, unitPrice: cleanNumber(r.unit_price) });
      }
    }
    const { data: ops } = await db.from("job_operations").select("kind, supplier_id").neq("job_id", jobId).eq("in_house", false)
      .not("supplier_id", "is", null).in("status", ["hotovo", "probiha"]).order("updated_at", { ascending: false }).limit(200);
    for (const o of (ops ?? []) as Row[]) if (isOperationKind(o.kind)) out.operations.push({ kind: o.kind, supplierId: String(o.supplier_id) });
    const { data: rr, error } = await db.from("rfq_recipients").select("supplier_id, status").not("supplier_id", "is", null).limit(2000);
    if (!error) {
      const m = new Map<string, { asked: number; answered: number }>();
      for (const r of (rr ?? []) as Row[]) {
        const st = String(r.status);
        if (!["odeslano", "odpovedel", "nabidka", "odmitl", "bez_odpovedi"].includes(st)) continue;
        const k = String(r.supplier_id);
        const v = m.get(k) ?? { asked: 0, answered: 0 };
        v.asked++;
        if (["odpovedel", "nabidka", "odmitl"].includes(st)) v.answered++;
        m.set(k, v);
      }
      out.rfq = [...m.entries()].map(([supplierId, v]) => ({ supplierId, ...v }));
    }
  } catch (err) {
    console.error(`[rfq] Historie dodavatelů se nenačetla: ${err instanceof Error ? err.message : String(err)}`);
  }
  return out;
}

/** Vše pro dialog „Poptat dodavatele". */
export async function loadRfqSetup(dbIn: JobsDb, jobId: string): Promise<RfqSetup | null> {
  const db = loose(dbIn);
  if (!isUuid(jobId)) return null;
  const job = await loadJob(db, jobId);
  if (!job) return null;
  const items = await loadItems(db, jobId);
  const [drawings, suppliers, history, opsRes] = await Promise.all([
    loadDrawings(db, jobId, items),
    loadSuppliers(db),
    loadHistory(db, jobId, items),
    db.from("job_operations").select("id, kind, title, status, order_item_ids, in_house, supplier_name, supplier:suppliers!supplier_id(name)").eq("job_id", jobId).order("position"),
  ]);
  const quality = await loadQuality(db, suppliers.map((s) => s.id));
  const today = pragueToday();
  const steps: RfqSetupStep[] = ((opsRes.data ?? []) as Row[])
    .filter((o) => isOperationKind(o.kind) && o.status !== "preskoceno" && o.status !== "hotovo")
    .map((o) => ({
      id: String(o.id), kind: o.kind as OperationKind, label: cleanText(o.title, 120) ?? OPERATION_KINDS[o.kind as OperationKind].label,
      itemIds: Array.isArray(o.order_item_ids) && (o.order_item_ids as unknown[]).length ? (o.order_item_ids as string[]) : null,
      who: o.in_house ? "U nás" : (cleanText(one(o.supplier as Row | Row[] | null)?.name, 200) ?? cleanText(o.supplier_name, 200)),
    }));
  const customerDate = job.customer_required_date ?? job.due_date ?? null;
  return {
    job: { id: job.id, number: job.number, stage: job.status, customerDate },
    items, steps, drawings, suppliers, history, quality, defaults: rfqDefaultDates({ today, customerDate }), today,
  };
}

// ── Vstup kola ──────────────────────────────────────────────
export interface RfqInput {
  jobId: string;
  scope: RfqScope;
  operationKinds?: string[];
  items: { orderItemId: string; quantities: number[] }[];
  requiredDate: string | null;
  replyBy: string | null;
  note?: string | null;
  recipients: { supplierId: string; emails: string[] }[];
  /** Výkresy, které se ještě anonymizují: false (výchozí) = počkat a odeslat samo, true = poslat hned bez nich. */
  skipPending?: boolean;
  /** Výkresy, které uživatel z poptávky vyřadil. */
  excludeDrawingIds?: string[];
}

const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]{2,}$/;

interface Prepared {
  job: JobRow;
  guard: LeakGuard;
  scope: RfqScope;
  kinds: OperationKind[];
  items: RfqItem[];
  drawings: RfqSetupDrawing[];
  recipients: { supplier: RankSupplier; emails: string[] }[];
  requiredDate: string | null;
  replyBy: string | null;
  note: string | null;
  redacted: string[];
}

async function prepare(db: Db, input: RfqInput, number: string): Promise<Prepared | { error: string }> {
  if (!input || typeof input !== "object" || !isUuid(input.jobId)) return { error: "Zakázka nenalezena." };
  const job = await loadJob(db, input.jobId);
  if (!job) return { error: "Zakázka nenalezena." };
  if (["zruseno", "nerealizovano", "dokonceno", "slouceno"].includes(job.status)) return { error: "Uzavřenou zakázku nejde poptávat — nejdřív ji obnov." };
  const guard = guardOfJob(job);
  const scope: RfqScope = input.scope === "operace" ? "operace" : "dil";
  const kinds = scope === "operace" ? cleanKinds(input.operationKinds) : [];
  if (scope === "operace" && !kinds.length) return { error: "Vyber, kterou operaci poptáváš (např. tepelné zpracování)." };
  const all = await loadItems(db, job.id);
  const wanted = (Array.isArray(input.items) ? input.items : []).filter((x) => x && isUuid(x.orderItemId));
  if (!wanted.length) return { error: "Vyber aspoň jednu položku." };
  const redacted: string[] = [];
  const items: RfqItem[] = [];
  for (const w of wanted) {
    const it = all.find((x) => x.id === w.orderItemId);
    if (!it) return { error: "Položka nepatří k této zakázce." };
    const qs = (Array.isArray(w.quantities) ? w.quantities : []).map(Number).filter((n) => Number.isFinite(n) && n > 0 && n <= 1_000_000);
    const quantities = [...new Set([...(qs.length ? qs : [it.quantity])].map((n) => Math.round(n * 1000) / 1000))].slice(0, RFQ_MAX_QTY_VARIANTS);
    const name = redactCustomer(it.name, guard);
    const material = redactCustomer(it.material, guard);
    redacted.push(...name.hits, ...material.hits);
    items.push({
      orderItemId: it.id, ref: `${number}/${items.length + 1}`, drawingNumber: it.drawingNumber, revision: it.revision,
      name: name.text.trim() || null, material: material.text.trim() || null, unit: it.unit, quantities, customerQty: quantities[0],
    });
  }
  const requiredDate = cleanDate(input.requiredDate);
  const replyBy = cleanDate(input.replyBy);
  const today = pragueToday();
  if (requiredDate && requiredDate < today) return { error: "Požadovaný termín je v minulosti." };
  if (replyBy && replyBy < today) return { error: "„Odpověď do“ je v minulosti." };
  if (replyBy && requiredDate && replyBy > requiredDate) return { error: "„Odpověď do“ je až po požadovaném termínu dodání." };
  const noteR = redactCustomer(cleanText(input.note, 2000), guard);
  redacted.push(...noteR.hits);
  const list = (Array.isArray(input.recipients) ? input.recipients : []).filter((r) => r && isUuid(r.supplierId));
  const unique = list.filter((r, i) => list.findIndex((x) => x.supplierId === r.supplierId) === i);
  if (!unique.length) return { error: "Vyber aspoň jednoho dodavatele." };
  if (unique.length > RFQ_MAX_SUPPLIERS) return { error: `Najednou nejvýš ${RFQ_MAX_SUPPLIERS} dodavatelů.` };
  const sups = await loadSuppliers(db);
  const recipients: Prepared["recipients"] = [];
  for (const r of unique) {
    const s = sups.find((x) => x.id === r.supplierId);
    if (!s) return { error: "Dodavatel nenalezen." };
    const emails = [...new Set((Array.isArray(r.emails) ? r.emails : []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))].slice(0, 5);
    if (!emails.length) return { error: `Doplň e-mail dodavatele ${s.name}.` };
    const bad = emails.find((e) => !EMAIL_RE.test(e));
    if (bad) return { error: `Neplatná adresa „${bad}“ u ${s.name}.` };
    // adresa zákazníka nesmí dostat poptávku dodavatele
    const leak = findLeaks(emails, guard);
    if (leak.length) return { error: `Adresa u ${s.name} vypadá jako adresa zákazníka — zkontroluj ji.` };
    recipients.push({ supplier: s, emails });
  }
  // napříč dodavateli nikdy stejná adresa (každý dostane svůj e-mail)
  const seen = new Map<string, string>();
  for (const r of recipients) {
    for (const e of r.emails) {
      if (seen.has(e) && seen.get(e) !== r.supplier.id) return { error: `Adresa ${e} je u dvou dodavatelů — každý dodavatel musí mít svou.` };
      seen.set(e, r.supplier.id);
    }
  }
  const excluded = new Set((input.excludeDrawingIds ?? []).filter(isUuid).map((x) => x.toLowerCase()));
  const itemIds = new Set(items.map((i) => i.orderItemId));
  const allDrawings = await loadDrawings(db, job.id, all);
  const drawings = allDrawings
    .filter((d) => (d.itemId ? itemIds.has(d.itemId) : items.length === all.length) && !excluded.has(d.id.toLowerCase()))
    .map((d, i) => {
      const it = items.find((x) => x.orderItemId === d.itemId);
      const ext = /\.([A-Za-z0-9]{1,8})$/.exec(d.name)?.[1] ?? "pdf";
      return { ...d, name: neutralFileName({ drawingNumber: it?.drawingNumber, revision: it?.revision, ext, roundNumber: number, index: i + 1 }) };
    });
  // stejný název dvakrát (víc listů / formátů) → „-2"
  const names = new Set<string>();
  for (const d of drawings) {
    let n = d.name;
    for (let k = 2; names.has(n.toLowerCase()); k++) n = d.name.replace(/(\.[^.]+)?$/, `-${k}$1`);
    names.add(n.toLowerCase());
    d.name = n;
  }
  return {
    job, guard, scope, kinds, items, drawings, recipients, requiredDate, replyBy, note: noteR.text.trim() || null,
    redacted: [...new Set(redacted)],
  };
}

interface Composed { subject: string; body: string; salutation: string; address: "ty" | "vy" }

async function composeFor(db: Db, p: Prepared, number: string, user: RfqActor, emails: string[], signature: string): Promise<Composed> {
  const tone = await toneFor(db, user.id, emails).catch(() => null);
  const salutation = tone?.salutation ?? "Dobrý den,";
  const address = tone?.setting.address ?? "vy";
  const m = rfqMail({
    number, scope: p.scope, operationKinds: p.kinds, items: p.items, requiredDate: p.requiredDate, replyBy: p.replyBy, note: p.note,
    salutation, address, signature, drawingCount: p.drawings.filter((d) => d.status !== "blocked").length,
  });
  return { ...m, salutation, address };
}

export interface RfqPreview {
  number: string;
  mails: { supplierId: string; supplierName: string; to: string[]; subject: string; body: string; attachments: { name: string; status: "ready" | "pending" | "blocked"; message: string | null }[] }[];
  leaks: string[];
  redacted: string[];
  pending: number;
  blocked: number;
}

/** Náhled před odesláním (číslo kola se přidělí až při odeslání). */
export async function previewRfq(dbIn: JobsDb, user: RfqActor, input: RfqInput): Promise<RfqPreview | { error: string }> {
  const db = loose(dbIn);
  const year = pragueToday().slice(0, 4);
  const number = `PD-${year}-…`;
  const p = await prepare(db, input, number);
  if ("error" in p) return p;
  await refreshCompanyFromSettings();
  const signature = await senderSignatureText(user.id, { ownerId: user.id });
  const mails: RfqPreview["mails"] = [];
  const pdfName = rfqPdfFileName(`PD-${year}-NNN`);
  for (const r of p.recipients) {
    const c = await composeFor(db, p, number, user, r.emails, signature);
    mails.push({
      supplierId: r.supplier.id, supplierName: r.supplier.name, to: r.emails, subject: c.subject, body: c.body,
      attachments: [
        { name: pdfName, status: "ready", message: null },
        ...p.drawings.map((d) => ({ name: d.name, status: d.status, message: d.message })),
      ],
    });
  }
  const leaks = findLeaks([...mails.flatMap((m) => [m.subject, m.body.split(/\n-- \n/)[0]]), ...p.drawings.map((d) => d.name)], p.guard);
  return {
    number, mails, leaks, redacted: p.redacted,
    pending: p.drawings.filter((d) => d.status === "pending").length, blocked: p.drawings.filter((d) => d.status === "blocked").length,
  };
}

async function nextRoundNumber(db: Db): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const { data, error } = await db.rpc("next_doc_number", { p_prefix: "PD" });
    if (error || !data) throw new Error(error?.message ?? "Číslo poptávky se nepodařilo přidělit.");
    const n = String(data);
    const { count } = await db.from("rfq_rounds").select("id", { count: "exact", head: true }).eq("number", n);
    if (!count) return n;
  }
  throw new Error("Číslo poptávky se nepodařilo přidělit.");
}

/** PDF poptávky → úložiště + Dokumenty zakázky (náš doklad, bez cen, bez zákazníka). */
async function storeRfqPdf(db: Db, user: RfqActor, p: Prepared, number: string): Promise<{ fileId: string; buffer: Buffer; filename: string } | { error: string }> {
  await refreshCompanyFromSettings();
  const me = await fetchProfileContact(db as unknown as JobsDb, user.id).catch(() => ({ name: null, email: null, phone: null }));
  const buffer = await renderRfqPdf({
    number, issueDate: pragueToday(), buyer: supplierParty(), what: whatText(p.scope, p.kinds),
    items: p.items.map((i) => ({ ref: i.ref, drawingNumber: i.drawingNumber, revision: i.revision, name: i.name, material: i.material, unit: i.unit, quantities: i.quantities })),
    requiredDate: p.requiredDate, replyBy: p.replyBy, note: p.note,
    contactPerson: me.name ?? user.fullName, contactEmail: me.email ?? COMPANY.email ?? null, contactPhone: me.phone ?? COMPANY.phone ?? null,
    drawingCount: p.drawings.filter((d) => d.status !== "blocked").length,
  });
  const filename = rfqPdfFileName(number);
  const path = jobFilePath(p.job.id, crypto.randomUUID(), filename);
  const { error: upErr } = await db.storage.from(BUCKET).upload(path, buffer, { contentType: "application/pdf", upsert: false });
  if (upErr) return { error: `Uložení PDF poptávky selhalo: ${upErr.message}` };
  const reg = await registerJobFileCore(db as unknown as JobsDb, user.id, {
    jobId: p.job.id, path, filename, mimeType: "application/pdf", size: buffer.length, kind: "naceneni",
    title: `Poptávka ${number} (dodavatelům)`, origin: "generated", issuer: "my", noAutoVersion: true, silent: true,
  });
  if (!reg.ok || !reg.file) {
    await db.storage.from(BUCKET).remove([path]);
    return { error: reg.error ?? "PDF poptávky se nepodařilo zařadit do dokumentů." };
  }
  return { fileId: reg.file.id, buffer, filename };
}

/** Čekající nabídka dodavatele (bez ceny) — stav „Čeká na ceny dodavatelů", „Poptáno: …" v Technologii. */
async function insertPlaceholder(db: Db, user: RfqActor, p: Prepared, number: string, recipientId: string, s: RankSupplier): Promise<string | null> {
  const { data, error } = await db.from("supplier_quotes").insert({
    job_id: p.job.id, supplier_id: s.id, supplier_name: s.name, currency: "CZK", total: null, selected: false,
    note: `Poptáno ${number} — čeká na nabídku`, source: "email", created_by: user.id, rfq_recipient_id: recipientId,
    operation_kinds: p.scope === "operace" ? p.kinds : ["kompletni_dodavka"],
  }).select("id").single();
  if (error || !data) {
    console.error(`[rfq] Čekající nabídka se nezaložila: ${error?.message}`);
    return null;
  }
  const id = (data as { id: string }).id;
  const rows = p.items.flatMap((it, i) => it.quantities.map((q, k) => ({
    supplier_quote_id: id, position: i * 10 + k, drawing_number: it.drawingNumber, name: it.name, material: it.material, quantity: q, unit: it.unit, unit_price: null,
  })));
  if (rows.length) await db.from("supplier_quote_items").insert(rows);
  return id;
}

async function attachmentsFor(db: Db, p: Prepared, skipPending: boolean): Promise<{ ready: { filename: string; content: Buffer; contentType: string }[]; pending: string[]; readyIds: string[] }> {
  const ids = p.drawings.filter((d) => d.status !== "blocked").map((d) => d.id);
  const out = { ready: [] as { filename: string; content: Buffer; contentType: string }[], pending: [] as string[], readyIds: [] as string[] };
  if (!ids.length) return out;
  const { data } = await db.from("job_files").select(SHARE_FILE_SELECT).in("id", ids);
  const rows = (data ?? []) as FileRowWithAnon[];
  const price = await sharePriceDocIds(db as never, ids);
  for (const d of p.drawings) {
    if (d.status === "blocked") continue;
    const f = rows.find((r) => r.id === d.id);
    if (!f) continue;
    const dec = pickShareFile(f, { priceDocument: price.has(f.id.toLowerCase()) });
    if (!dec.ok) {
      if (dec.reason === "pending" && !skipPending) out.pending.push(d.id);
      continue;
    }
    const bytes = await verifyShareBytes(db as never, dec, f);
    out.ready.push({ filename: d.name, content: Buffer.from(bytes), contentType: dec.mime });
    out.readyIds.push(d.id);
  }
  return out;
}

export interface RfqSendResult {
  roundId: string;
  number: string;
  sent: number;
  waiting: number;
  failed: { supplier: string; error: string }[];
}

/**
 * Založí kolo a pošle poptávku: každý dodavatel SAMOSTATNĚ (svůj e-mail, svůj tón), PDF + anonymizované výkresy.
 * Čekající výkres → fronta anonymizace (odejde sám), chyba SMTP → K odeslání (Přijmout a odeslat).
 */
export async function createAndSendRound(dbIn: JobsDb, user: RfqActor, input: RfqInput): Promise<RfqSendResult | { error: string }> {
  const db = loose(dbIn);
  let number: string;
  try {
    number = await nextRoundNumber(db);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Číslo poptávky se nepodařilo přidělit." };
  }
  const p = await prepare(db, input, number);
  if ("error" in p) return p;
  const pdf = await storeRfqPdf(db, user, p, number);
  if ("error" in pdf) return pdf;
  const { data: round, error } = await db.from("rfq_rounds").insert({
    job_id: p.job.id, number, status: "otevrene", scope: p.scope, operation_kinds: p.kinds.length ? p.kinds : null,
    items: p.items, required_date: p.requiredDate, reply_by: p.replyBy, note: p.note, file_id: pdf.fileId,
    drawing_file_ids: p.drawings.filter((d) => d.status !== "blocked").map((d) => d.id), created_by: user.id,
  }).select("id").single();
  if (error || !round) return { error: RFQ_TABLES_MISSING.test(error?.message ?? "") ? "Chybí migrace poptávek dodavatelům (20261031160000)." : error?.message ?? "Kolo se nepodařilo založit." };
  const roundId = (round as { id: string }).id;
  const signature = await senderSignatureText(user.id, { ownerId: user.id });
  const files = await attachmentsFor(db, p, Boolean(input.skipPending));
  const result: RfqSendResult = { roundId, number, sent: 0, waiting: 0, failed: [] };
  let rank = 0;
  for (const r of p.recipients) {
    rank++;
    const { data: rec } = await db.from("rfq_recipients").insert({
      round_id: roundId, supplier_id: r.supplier.id, supplier_name: r.supplier.name, emails: r.emails, status: "k_odeslani", rank,
    }).select("id").single();
    const recipientId = (rec as { id: string } | null)?.id;
    if (!recipientId) {
      result.failed.push({ supplier: r.supplier.name, error: "Dodavatele se nepodařilo zapsat." });
      continue;
    }
    const quoteId = await insertPlaceholder(db, user, p, number, recipientId, r.supplier);
    if (quoteId) await db.from("rfq_recipients").update({ supplier_quote_id: quoteId }).eq("id", recipientId);
    const mail = await composeFor(db, p, number, user, r.emails, signature);
    const leaks = findLeaks([mail.subject, mail.body.split(/\n-- \n/)[0], ...p.drawings.map((d) => d.name)], p.guard);
    if (leaks.length) {
      // pojistka: nic, co prozradí zákazníka, neodejde
      await db.from("rfq_recipients").update({ status: "chyba", error: `Zastaveno — text obsahuje údaj zákazníka (${leaks.join(", ")}).` }).eq("id", recipientId);
      result.failed.push({ supplier: r.supplier.name, error: "Text obsahuje údaj zákazníka — zkontroluj poznámku a položky." });
      continue;
    }
    const outcome = await deliver(db, user, { roundId, recipientId, number, jobId: p.job.id, supplier: r.supplier, emails: r.emails, mail, pdf, files, drawingIds: p.drawings.filter((d) => d.status !== "blocked").map((d) => d.id), names: Object.fromEntries(p.drawings.map((d) => [d.id, d.name])) });
    if (outcome === "sent") result.sent++;
    else if (outcome === "waiting") result.waiting++;
    else result.failed.push({ supplier: r.supplier.name, error: outcome.error });
  }
  const what = whatText(p.scope, p.kinds);
  await logJobEvent(db as unknown as JobsDb, {
    jobId: p.job.id, type: "email", entity: "supplier_quote", entityId: roundId, actorId: user.id,
    message: `Poptávka ${number} (${what}) odeslána ${p.recipients.length} ${p.recipients.length === 1 ? "dodavateli" : "dodavatelům"}: ${p.recipients.map((r) => r.supplier.name).join(", ")}`
      + (result.waiting ? ` — ${result.waiting} čeká na anonymizaci výkresů` : "") + (result.failed.length ? ` — ${result.failed.length} neodešlo` : ""),
    data: { rfqRoundId: roundId, number, suppliers: p.recipients.map((r) => r.supplier.id), sent: result.sent, waiting: result.waiting, failed: result.failed.length },
  });
  await logAudit({
    action: "rfq_round_sent", entity: "rfq_rounds", entityId: roundId,
    diff: { jobId: p.job.id, number, scope: p.scope, kinds: p.kinds, items: p.items.length, suppliers: p.recipients.map((r) => ({ id: r.supplier.id, to: r.emails })), sent: result.sent, waiting: result.waiting, failed: result.failed.length, redacted: p.redacted.length },
    actor: { id: user.id, kind: "user", via: "rucne" },
  });
  return result;
}

interface DeliverInput {
  roundId: string; recipientId: string; number: string; jobId: string; supplier: { id: string; name: string }; emails: string[];
  mail: { subject: string; body: string }; pdf: { fileId: string; buffer: Buffer; filename: string };
  files: { ready: { filename: string; content: Buffer; contentType: string }[]; pending: string[]; readyIds: string[] };
  drawingIds: string[]; names: Record<string, string>;
}

/** Jeden dodavatel: čeká na výkresy → fronta; jinak odeslat; chyba → K odeslání. */
async function deliver(db: Db, user: RfqActor, d: DeliverInput): Promise<"sent" | "waiting" | { error: string }> {
  if (d.files.pending.length) {
    const q = await enqueueSend(db as never, {
      kind: "supplier_inquiry", jobId: d.jobId, refId: d.roundId, createdBy: user.id,
      payload: { to: d.emails, subject: d.mail.subject, body: d.mail.body, extraFileIds: [d.pdf.fileId], recipientLabel: `dodavateli ${d.supplier.name} (poptávka ${d.number})`, neutralNames: { ...d.names, [d.pdf.fileId]: d.pdf.filename } },
      fileIds: [...d.files.readyIds, ...d.files.pending],
    });
    if (!q.ok) {
      await db.from("rfq_recipients").update({ status: "chyba", error: q.error }).eq("id", d.recipientId);
      return { error: q.error };
    }
    await db.from("rfq_recipients").update({ status: "ceka_na_anonymizaci", send_queue_id: q.id, sent_by: user.id, error: null }).eq("id", d.recipientId);
    const origin = appOrigin(null);
    if (origin) await kick({ origin, table: "job_files", ids: d.files.pending.slice(0, 5), manualBy: user.id }).catch(() => undefined);
    return "waiting";
  }
  const res = await sendMail({
    to: d.emails.join(", "), subject: d.mail.subject, text: d.mail.body,
    attachments: [{ filename: d.pdf.filename, content: d.pdf.buffer, contentType: "application/pdf" }, ...d.files.ready],
    from: { ownerId: user.id }, jobId: d.jobId, senderId: user.id, supplierId: d.supplier.id,
    signature: { userId: user.id, mode: "inline" }, category: "k_zakazce",
  });
  if (!res.sent) {
    // K odeslání: stejná zpráva odejde tlačítkem „Přijmout a odeslat" (výkresy přes ochranu jen anonymizované)
    const { data: ob } = await db.from("mail_outbox").insert({
      created_by: user.id, status: "failed", last_error: (res.reason ?? "Odeslání selhalo.").slice(0, 1000), attempts: 1,
      payload: {
        mode: "new", to: d.emails.join(", "), subject: d.mail.subject, body: d.mail.body, jobId: d.jobId,
        attachments: [{ kind: "job", ref: d.pdf.fileId, filename: d.pdf.filename }, ...d.files.readyIds.map((id) => ({ kind: "job", ref: id, filename: d.names[id] }))],
      },
    }).select("id").maybeSingle();
    await db.from("rfq_recipients").update({ status: "chyba", error: res.reason ?? "Odeslání selhalo.", outbox_id: (ob as { id: string } | null)?.id ?? null, sent_by: user.id }).eq("id", d.recipientId);
    return { error: res.reason ?? "Odeslání selhalo." };
  }
  await db.from("rfq_recipients").update({ status: "odeslano", sent_at: new Date().toISOString(), sent_by: user.id, email_id: res.emailId ?? null, error: null }).eq("id", d.recipientId);
  return "sent";
}

// ── Načtení kol ─────────────────────────────────────────────
export interface JobRfqData {
  rounds: RfqRoundView[];
  quality: SupplierQuality[];
  ratings: { supplierId: string; rating: number | null; certifications: string[] }[];
  weights: RfqWeights;
  today: string;
}

export async function loadWeights(): Promise<RfqWeights> {
  return normalizeWeights(await getSetting(RFQ_WEIGHTS_SETTING).catch(() => undefined));
}

function lineItemId(round: Pick<RfqRoundView, "items">, drawing: string | null, name: string | null): string | null {
  const dn = normalizeDrawingNumber(drawing);
  const byDn = dn ? round.items.find((i) => normalizeDrawingNumber(i.drawingNumber) === dn) : null;
  if (byDn) return byDn.orderItemId;
  const n = (name ?? "").trim().toLowerCase();
  return round.items.find((i) => (i.name ?? "").trim().toLowerCase() === n && n)?.orderItemId ?? null;
}

/** Stav fronty anonymizace / K odeslání → stav dodavatele (odešlo samo po anonymizaci / po „Přijmout a odeslat"). */
async function reconcile(db: Db, recs: Row[]): Promise<void> {
  const queued = recs.filter((r) => r.status === "ceka_na_anonymizaci" && r.send_queue_id);
  if (queued.length) {
    const { data } = await db.from("anon_send_queue").select("id, status, reason, sent_at").in("id", queued.map((r) => String(r.send_queue_id)));
    for (const q of (data ?? []) as Row[]) {
      const r = queued.find((x) => x.send_queue_id === q.id);
      if (!r) continue;
      if (q.status === "sent") {
        await db.from("rfq_recipients").update({ status: "odeslano", sent_at: q.sent_at ?? new Date().toISOString(), error: null }).eq("id", r.id).eq("status", "ceka_na_anonymizaci");
        r.status = "odeslano";
        r.sent_at = q.sent_at;
        r.error = null;
      } else if (q.status === "blocked" || q.status === "failed" || q.status === "cancelled") {
        const reason = q.status === "cancelled" ? "Odeslání zrušeno." : String(q.reason ?? "Výkres nejde poslat.");
        if (r.error !== reason) await db.from("rfq_recipients").update({ error: reason }).eq("id", r.id);
        r.error = reason;
      }
    }
  }
  const failed = recs.filter((r) => r.status === "chyba" && r.outbox_id);
  if (failed.length) {
    const { data } = await db.from("mail_outbox").select("id, status, email_id, sent_at").in("id", failed.map((r) => String(r.outbox_id)));
    for (const o of (data ?? []) as Row[]) {
      const r = failed.find((x) => x.outbox_id === o.id);
      if (!r || o.status !== "sent") continue;
      await db.from("rfq_recipients").update({ status: "odeslano", sent_at: o.sent_at ?? new Date().toISOString(), email_id: o.email_id ?? null, error: null }).eq("id", r.id).eq("status", "chyba");
      r.status = "odeslano";
      r.sent_at = o.sent_at;
      r.error = null;
    }
  }
}

export async function loadJobRfq(dbIn: JobsDb, jobId: string): Promise<JobRfqData | null> {
  const db = loose(dbIn);
  if (!isUuid(jobId)) return null;
  const { data: rounds, error } = await db.from("rfq_rounds")
    .select("id, job_id, number, status, scope, operation_kinds, items, required_date, reply_by, note, file_id, drawing_file_ids, created_at, closed_at, creator:profiles!created_by(full_name)")
    .eq("job_id", jobId).order("created_at", { ascending: false });
  if (error) {
    if (!RFQ_TABLES_MISSING.test(error.message)) console.error(`[rfq] Kola se nenačetla: ${error.message}`);
    return null;
  }
  const rr = (rounds ?? []) as Row[];
  const ids = rr.map((r) => String(r.id));
  const [recRes, selRes] = ids.length ? await Promise.all([
    db.from("rfq_recipients").select("*, sender:profiles!sent_by(full_name), reply:emails!reply_email_id(subject)").in("round_id", ids).order("rank"),
    db.from("rfq_selections").select("*, who:profiles!selected_by(full_name)").in("round_id", ids),
  ]) : [{ data: [] }, { data: [] }];
  const recs = (recRes.data ?? []) as Row[];
  await reconcile(db, recs);
  const quoteIds = recs.map((r) => r.supplier_quote_id).filter(isUuid) as string[];
  const { data: quotes } = quoteIds.length
    ? await db.from("supplier_quotes").select("id, rfq_recipient_id, number, quote_date, valid_until, lead_time_days, delivery_date, currency, total, note, items:supplier_quote_items(drawing_number, name, quantity, unit_price, position)").in("id", quoteIds)
    : { data: [] };
  const supIds = [...new Set(recs.map((r) => r.supplier_id).filter(isUuid) as string[])];
  const [quality, supRows, weights] = await Promise.all([
    loadQuality(db, supIds),
    supIds.length ? db.from("suppliers").select("id, rating, certifications").in("id", supIds) : Promise.resolve({ data: [] }),
    loadWeights(),
  ]);
  const out: RfqRoundView[] = rr.map((r) => {
    const items = (Array.isArray(r.items) ? r.items : []) as RfqItem[];
    const roundRecs = recs.filter((x) => x.round_id === r.id);
    const recipients: RfqRecipientView[] = roundRecs.map((x) => ({
      id: String(x.id), supplierId: (x.supplier_id as string | null) ?? null, supplierName: String(x.supplier_name ?? ""),
      emails: Array.isArray(x.emails) ? (x.emails as string[]) : [], status: isRecipientStatus(x.status) ? x.status : "odeslano",
      rank: cleanNumber(x.rank), recommendReason: cleanText(x.recommend_reason, 300), sentAt: (x.sent_at as string | null) ?? null,
      sentBy: cleanText(one(x.sender as Row | Row[] | null)?.full_name, 200), error: cleanText(x.error, 500),
      remindedAt: (x.reminded_at as string | null) ?? null, reminderCount: Number(x.reminder_count) || 0, repliedAt: (x.replied_at as string | null) ?? null,
      replyEmailId: (x.reply_email_id as string | null) ?? null, replySubject: cleanText(one(x.reply as Row | Row[] | null)?.subject, 300),
      supplierQuoteId: (x.supplier_quote_id as string | null) ?? null, declinedAt: (x.declined_at as string | null) ?? null,
      declineNote: cleanText(x.decline_note, 500), thankedAt: (x.thanked_at as string | null) ?? null,
      queueId: (x.send_queue_id as string | null) ?? null, outboxId: (x.outbox_id as string | null) ?? null,
    }));
    const base = { items };
    const offers: RfqOffer[] = ((quotes ?? []) as Row[])
      .filter((q) => recipients.some((x) => x.id === q.rfq_recipient_id) && q.total !== null)
      .map((q) => ({
        recipientId: String(q.rfq_recipient_id), quoteId: String(q.id), number: cleanText(q.number, 80), quoteDate: cleanDate(q.quote_date),
        total: cleanNumber(q.total), currency: String(q.currency || "CZK"), leadTimeDays: cleanNumber(q.lead_time_days), deliveryDate: cleanDate(q.delivery_date),
        validUntil: cleanDate(q.valid_until), note: cleanText(q.note, 2000),
        lines: ((q.items ?? []) as Row[]).sort((a, b) => Number(a.position) - Number(b.position)).map((l) => ({
          orderItemId: lineItemId(base, (l.drawing_number as string | null) ?? null, (l.name as string | null) ?? null),
          drawingNumber: (l.drawing_number as string | null) ?? null, quantity: Number(l.quantity) || 0, unitPrice: cleanNumber(l.unit_price),
        })),
      }));
    const selections: RfqSelectionView[] = ((selRes.data ?? []) as Row[]).filter((s) => s.round_id === r.id).map((s) => ({
      orderItemId: (s.order_item_id as string | null) ?? null, recipientId: String(s.recipient_id), supplierQuoteId: (s.supplier_quote_id as string | null) ?? null,
      recommendedRecipientId: (s.recommended_recipient_id as string | null) ?? null, overridden: Boolean(s.overridden), overrideReason: cleanText(s.override_reason, 500),
      unitPrice: cleanNumber(s.unit_price), quantity: cleanNumber(s.quantity), selectedBy: cleanText(one(s.who as Row | Row[] | null)?.full_name, 200),
      selectedAt: String(s.selected_at),
    }));
    return {
      id: String(r.id), jobId: String(r.job_id), number: String(r.number), status: (r.status as RfqRoundView["status"]) ?? "otevrene",
      scope: r.scope === "operace" ? "operace" : "dil", operationKinds: cleanKinds(r.operation_kinds), items,
      requiredDate: cleanDate(r.required_date), replyBy: cleanDate(r.reply_by), note: cleanText(r.note, 2000), fileId: (r.file_id as string | null) ?? null,
      drawingFileIds: Array.isArray(r.drawing_file_ids) ? (r.drawing_file_ids as string[]) : [], createdAt: String(r.created_at),
      createdBy: cleanText(one(r.creator as Row | Row[] | null)?.full_name, 200), closedAt: (r.closed_at as string | null) ?? null,
      recipients, offers, selections,
    };
  });
  const ratings = ((supRows.data ?? []) as Row[]).map((s) => ({
    supplierId: String(s.id), rating: cleanNumber(s.rating), certifications: Array.isArray(s.certifications) ? (s.certifications as string[]) : [],
  }));
  return { rounds: out, quality, ratings, weights, today: pragueToday() };
}

// ── Akce nad dodavatelem kola ───────────────────────────────
interface RecipientCtx { rec: Row; round: Row; job: JobRow }

async function recipientCtx(db: Db, recipientId: string): Promise<RecipientCtx | { error: string }> {
  if (!isUuid(recipientId)) return { error: "Dodavatel poptávky nenalezen." };
  const { data: rec } = await db.from("rfq_recipients").select("*").eq("id", recipientId).maybeSingle();
  if (!rec) return { error: "Dodavatel poptávky nenalezen." };
  const { data: round } = await db.from("rfq_rounds").select("*").eq("id", (rec as Row).round_id as string).maybeSingle();
  if (!round) return { error: "Poptávka nenalezena." };
  const job = await loadJob(db, String((round as Row).job_id));
  if (!job) return { error: "Zakázka nenalezena." };
  return { rec: rec as Row, round: round as Row, job };
}

async function sentMessageId(db: Db, emailId: unknown): Promise<string | null> {
  if (!isUuid(emailId)) return null;
  const { data } = await db.from("emails").select("message_id").eq("id", emailId).maybeSingle();
  return ((data as { message_id: string | null } | null)?.message_id) ?? null;
}

/** „Urgovat" — připomenutí jedním ťuknutím (ve vlákně původní poptávky). */
export async function remindRecipient(dbIn: JobsDb, user: RfqActor, recipientId: string): Promise<{ ok: true } | { error: string }> {
  const db = loose(dbIn);
  const c = await recipientCtx(db, recipientId);
  if ("error" in c) return c;
  if (!["odeslano", "bez_odpovedi"].includes(String(c.rec.status))) return { error: "Urgovat jde jen dodavatele, který zatím neodpověděl." };
  const emails = (c.rec.emails as string[]) ?? [];
  const tone = await toneFor(db, user.id, emails).catch(() => null);
  const signature = await senderSignatureText(user.id, { ownerId: user.id });
  const m = rfqReminderMail({ number: String(c.round.number), replyBy: cleanDate(c.round.reply_by), salutation: tone?.salutation ?? "Dobrý den,", address: tone?.setting.address ?? "vy", signature }, pragueToday());
  const mid = await sentMessageId(db, c.rec.email_id);
  const res = await sendMail({
    to: emails.join(", "), subject: m.subject, text: m.body, from: { ownerId: user.id }, jobId: c.job.id, senderId: user.id,
    supplierId: (c.rec.supplier_id as string | null) ?? null, signature: { userId: user.id, mode: "inline" }, category: "k_zakazce",
    inReplyTo: mid, references: mid ? [mid] : null,
  });
  if (!res.sent) return { error: res.reason ?? "Připomenutí se nepodařilo odeslat." };
  await db.from("rfq_recipients").update({
    reminded_at: new Date().toISOString(), reminded_by: user.id, reminder_count: (Number(c.rec.reminder_count) || 0) + 1, status: "odeslano",
  }).eq("id", recipientId);
  await logJobEvent(db as unknown as JobsDb, {
    jobId: c.job.id, type: "email", entity: "supplier_quote", entityId: String(c.round.id), actorId: user.id,
    message: `Poptávka ${c.round.number}: urgence dodavateli ${c.rec.supplier_name} (${emails.join(", ")})`,
    data: { rfqRoundId: c.round.id, rfqRecipientId: recipientId, emailId: res.emailId ?? null, action: "reminded" },
  });
  return { ok: true };
}

/** Dodavatel odmítl (nenabídne) — čekající nabídka bez ceny se smaže. */
export async function declineRecipient(dbIn: JobsDb, user: RfqActor, recipientId: string, note: string | null): Promise<{ ok: true } | { error: string }> {
  const db = loose(dbIn);
  const c = await recipientCtx(db, recipientId);
  if ("error" in c) return c;
  if (c.rec.status === "nabidka") return { error: "Dodavatel už poslal nabídku — smaž ji v Nákupu, pokud neplatí." };
  await db.from("rfq_recipients").update({ status: "odmitl", declined_at: new Date().toISOString(), decline_note: cleanText(note, 500) }).eq("id", recipientId);
  if (isUuid(c.rec.supplier_quote_id)) await db.from("supplier_quotes").delete().eq("id", c.rec.supplier_quote_id as string).is("total", null);
  await logJobEvent(db as unknown as JobsDb, {
    jobId: c.job.id, type: "quote", entity: "supplier_quote", entityId: String(c.round.id), actorId: user.id,
    message: `Poptávka ${c.round.number}: ${c.rec.supplier_name} nenabídne${cleanText(note, 200) ? ` — ${cleanText(note, 200)}` : ""}`,
    data: { rfqRoundId: c.round.id, rfqRecipientId: recipientId, action: "declined" },
  });
  return { ok: true };
}

export interface RfqOfferInput {
  number?: string | null;
  quoteDate?: string | null;
  validUntil?: string | null;
  leadTimeDays?: number | string | null;
  deliveryDate?: string | null;
  currency?: string | null;
  note?: string | null;
  lines: { orderItemId: string; quantity: number; unitPrice: number | string | null }[];
}

/** „Zapsat nabídku" — ceny po položkách a množstvích do nabídky dodavatele z kola (bez cen v historii). */
export async function saveRecipientOffer(dbIn: JobsDb, user: RfqActor, recipientId: string, input: RfqOfferInput): Promise<{ ok: true; quoteId: string } | { error: string }> {
  const db = loose(dbIn);
  const c = await recipientCtx(db, recipientId);
  if ("error" in c) return c;
  if (["zruseno"].includes(String(c.rec.status))) return { error: "Dodavatel byl z poptávky vyřazen." };
  const items = (Array.isArray(c.round.items) ? c.round.items : []) as RfqItem[];
  const lines: { item: RfqItem; quantity: number; unitPrice: number | null }[] = [];
  for (const l of Array.isArray(input?.lines) ? input.lines : []) {
    const item = items.find((i) => i.orderItemId === l.orderItemId);
    if (!item) return { error: "Položka nepatří k poptávce." };
    const q = Number(l.quantity);
    if (!item.quantities.some((x) => Math.abs(x - q) < 1e-6)) return { error: "Množství nebylo poptáno." };
    const raw = l.unitPrice;
    const price = raw === null || raw === undefined || raw === "" ? null : Number(String(raw).replace(/\s/g, "").replace(",", "."));
    if (price !== null && (!Number.isFinite(price) || price < 0 || price > 100_000_000)) return { error: "Neplatná cena." };
    lines.push({ item, quantity: q, unitPrice: price === null ? null : Math.round(price * 100) / 100 });
  }
  const priced = lines.filter((l) => l.unitPrice !== null);
  if (!priced.length) return { error: "Zadej aspoň jednu cenu." };
  const main = priced.filter((l) => Math.abs(l.quantity - l.item.customerQty) < 1e-6);
  const total = main.length ? Math.round(main.reduce((s, l) => s + (l.unitPrice as number) * l.quantity, 0) * 100) / 100 : null;
  const lead = cleanNumber(input.leadTimeDays);
  if (lead !== null && (lead < 0 || lead > 730)) return { error: "Neplatná dodací lhůta." };
  const currency = (cleanText(input.currency, 3) ?? "CZK").toUpperCase();
  const quoteDate = cleanDate(input.quoteDate) ?? pragueToday();
  const row: Row = {
    number: cleanText(input.number, 80), quote_date: quoteDate, valid_until: cleanDate(input.validUntil), lead_time_days: lead,
    delivery_date: cleanDate(input.deliveryDate) ?? (lead !== null ? null : null), currency, total,
    note: cleanText(input.note, 2000) ?? `Nabídka k poptávce ${c.round.number}`, source: c.rec.reply_email_id ? "email" : "manual", updated_by: user.id,
  };
  let quoteId = isUuid(c.rec.supplier_quote_id) ? String(c.rec.supplier_quote_id) : null;
  if (quoteId) {
    const { error } = await db.from("supplier_quotes").update(row).eq("id", quoteId);
    if (error) return { error: error.message };
  } else {
    const { data, error } = await db.from("supplier_quotes").insert({
      ...row, job_id: c.job.id, supplier_id: c.rec.supplier_id ?? null, supplier_name: c.rec.supplier_name, selected: false, created_by: user.id,
      rfq_recipient_id: recipientId, operation_kinds: c.round.scope === "operace" ? c.round.operation_kinds : ["kompletni_dodavka"],
    }).select("id").single();
    if (error || !data) return { error: error?.message ?? "Nabídku se nepodařilo uložit." };
    quoteId = (data as { id: string }).id;
  }
  await db.from("supplier_quote_items").delete().eq("supplier_quote_id", quoteId);
  const rows = lines.map((l, i) => ({
    supplier_quote_id: quoteId, position: i, drawing_number: l.item.drawingNumber, name: l.item.name, material: l.item.material,
    quantity: l.quantity, unit: l.item.unit, unit_price: l.unitPrice,
  }));
  const { error: itErr } = await db.from("supplier_quote_items").insert(rows);
  if (itErr) return { error: itErr.message };
  await db.from("rfq_recipients").update({
    status: "nabidka", supplier_quote_id: quoteId, replied_at: c.rec.replied_at ?? new Date().toISOString(), error: null,
  }).eq("id", recipientId);
  await logJobEvent(db as unknown as JobsDb, {
    jobId: c.job.id, type: "quote", entity: "supplier_quote", entityId: quoteId, actorId: user.id,
    message: `Poptávka ${c.round.number}: zapsána nabídka dodavatele ${c.rec.supplier_name}${row.number ? ` č. ${row.number}` : ""}`,
    data: { rfqRoundId: c.round.id, rfqRecipientId: recipientId, supplierQuoteId: quoteId, action: "offer" },
  });
  return { ok: true, quoteId };
}

/**
 * „Vybrat" — vítěz položky (orderItemId) nebo celého kola (null). Uloží doporučení vs. výběr (kdo / proč přebil),
 * u celého dílu propíše nákupní cenu položky (Nacenění, marže nabídky), vítěz všech položek = vítězná nabídka zakázky
 * (dodavatel, plánovaný nákup, termín → předání do výroby / objednávka). U operace = firma a nabídka kroku Technologie.
 */
export async function selectWinner(dbIn: JobsDb, user: RfqActor, roundId: string, input: { orderItemId: string | null; recipientId: string; reason?: string | null }): Promise<{ ok: true; overridden: boolean } | { error: string }> {
  const db = loose(dbIn);
  if (!isUuid(roundId) || !isUuid(input?.recipientId)) return { error: "Poptávka nenalezena." };
  const { data: jobRow } = await db.from("rfq_rounds").select("job_id").eq("id", roundId).maybeSingle();
  if (!jobRow) return { error: "Poptávka nenalezena." };
  const data = await loadJobRfq(dbIn, String((jobRow as Row).job_id));
  const round = data?.rounds.find((r) => r.id === roundId);
  if (!data || !round) return { error: "Poptávka nenalezena." };
  if (round.status === "zrusene") return { error: "Poptávka je zrušená." };
  const rec = round.recipients.find((r) => r.id === input.recipientId);
  if (!rec) return { error: "Dodavatel není v této poptávce." };
  const offer = round.offers.find((o) => o.recipientId === rec.id);
  if (!offer) return { error: "Od dodavatele zatím nemáme nabídku — nejdřív ji zapiš." };
  const cmp = compareRfq(round, new Map(data.quality.map((q) => [q.supplierId, q])), data.weights, new Map(data.ratings.map((r) => [r.supplierId, r])));
  const orderItemId = input.orderItemId && isUuid(input.orderItemId) ? input.orderItemId : null;
  const targets = orderItemId ? cmp.rows.filter((r) => r.item.orderItemId === orderItemId) : cmp.rows;
  if (orderItemId && !targets.length) return { error: "Položka nepatří k poptávce." };
  for (const row of targets) {
    if (!row.cells.some((c) => c.recipientId === rec.id && c.unitPrice !== null)) return { error: `${rec.supplierName} nemá cenu u položky ${row.item.ref}.` };
  }
  const recommended = orderItemId ? targets[0]?.recommended?.recipientId ?? null : cmp.overall?.recipientId ?? targets[0]?.recommended?.recipientId ?? null;
  const overridden = Boolean(recommended && recommended !== rec.id);
  const reason = cleanText(input.reason, 500);
  if (overridden && !reason) return { error: "Vybíráš jiného dodavatele než doporučeného — napiš krátce proč." };
  const now = new Date().toISOString();
  const upsert = async (itemId: string | null, cell: { unitPrice: number | null; quantity: number } | null) => {
    const sel = {
      round_id: roundId, order_item_id: itemId, recipient_id: rec.id, supplier_quote_id: offer.quoteId, recommended_recipient_id: recommended,
      overridden, override_reason: overridden ? reason : null, unit_price: cell?.unitPrice ?? null, quantity: cell?.quantity ?? null, selected_by: user.id, selected_at: now,
    };
    const q = db.from("rfq_selections").delete().eq("round_id", roundId);
    await (itemId ? q.eq("order_item_id", itemId) : q.is("order_item_id", null));
    await db.from("rfq_selections").insert(sel);
  };
  if (!orderItemId) await upsert(null, null);
  for (const row of targets) {
    const cell = row.cells.find((c) => c.recipientId === rec.id) ?? null;
    await upsert(row.item.orderItemId, cell ? { unitPrice: cell.unitPrice, quantity: cell.quantity } : null);
    if (round.scope === "dil" && cell?.unitPrice !== null && cell?.unitPrice !== undefined && cell.currency === "CZK") {
      await db.from("order_items").update({ purchase_unit_price: cell.unitPrice }).eq("id", row.item.orderItemId).eq("order_id", round.jobId);
    }
  }
  // stav kola + vítěz zakázky
  const { data: sels } = await db.from("rfq_selections").select("order_item_id, recipient_id").eq("round_id", roundId);
  const list = (sels ?? []) as Row[];
  const covered = round.items.every((i) => list.some((s) => s.order_item_id === i.orderItemId));
  const single = covered && new Set(list.filter((s) => s.order_item_id).map((s) => String(s.recipient_id))).size === 1;
  if (covered) await db.from("rfq_rounds").update({ status: "vybrano", closed_at: now, closed_by: user.id }).eq("id", roundId);
  if (single && round.scope === "dil") {
    const r = await selectWinningQuoteCore(db as unknown as JobsDb, user.id, offer.quoteId);
    if (!r.ok) console.error(`[rfq] Vítězná nabídka zakázky: ${r.error}`);
  }
  if (round.scope === "operace") {
    // krok Technologie (bez objednávky) dostane firmu a nabídku
    const { data: ops } = await db.from("job_operations").select("id, kind, purchase_order_id, status").eq("job_id", round.jobId);
    for (const o of (ops ?? []) as Row[]) {
      if (!round.operationKinds.includes(o.kind as OperationKind) || o.purchase_order_id || ["hotovo", "preskoceno"].includes(String(o.status))) continue;
      const { error } = await db.from("job_operations").update({ supplier_id: rec.supplierId, supplier_name: rec.supplierId ? null : rec.supplierName, in_house: false, supplier_quote_id: offer.quoteId }).eq("id", o.id);
      if (error) console.error(`[rfq] Krok technologie: ${error.message}`);
    }
  }
  if (covered) {
    // kdo neposlal nabídku → bez odpovědi (čekající nabídky bez ceny se uklidí — „Čeká na ceny dodavatelů" skončí)
    for (const x of round.recipients) {
      if (!["odeslano", "odpovedel", "ceka_na_anonymizaci"].includes(x.status)) continue;
      await db.from("rfq_recipients").update({ status: "bez_odpovedi" }).eq("id", x.id);
      if (x.supplierQuoteId) await db.from("supplier_quotes").delete().eq("id", x.supplierQuoteId).is("total", null);
    }
  }
  const scopeText = orderItemId ? `položka ${targets[0].item.ref}` : "celá poptávka";
  await logJobEvent(db as unknown as JobsDb, {
    jobId: round.jobId, type: "quote", entity: "supplier_quote", entityId: offer.quoteId, actorId: user.id,
    message: `Poptávka ${round.number}: vybrán dodavatel ${rec.supplierName} (${scopeText})${overridden ? ` — místo doporučeného, důvod: ${reason}` : " — doporučený"}`,
    data: { rfqRoundId: roundId, rfqRecipientId: rec.id, orderItemId, overridden, recommended, action: "selected" },
  });
  await logAudit({
    action: "rfq_selected", entity: "rfq_rounds", entityId: roundId,
    diff: { jobId: round.jobId, orderItemId, recipientId: rec.id, supplierId: rec.supplierId, overridden, recommended, reason },
    actor: { id: user.id, kind: "user", via: "rucne" },
  });
  return { ok: true, overridden };
}

/** „Děkujeme, tentokrát ne" — nevybraným dodavatelům s nabídkou (volitelné, jedním ťuknutím). */
export async function thankOthers(dbIn: JobsDb, user: RfqActor, roundId: string): Promise<{ ok: true; sent: number } | { error: string }> {
  const db = loose(dbIn);
  if (!isUuid(roundId)) return { error: "Poptávka nenalezena." };
  const { data: round } = await db.from("rfq_rounds").select("id, job_id, number").eq("id", roundId).maybeSingle();
  if (!round) return { error: "Poptávka nenalezena." };
  const r0 = round as Row;
  const [{ data: recs }, { data: sels }] = await Promise.all([
    db.from("rfq_recipients").select("*").eq("round_id", roundId),
    db.from("rfq_selections").select("recipient_id").eq("round_id", roundId),
  ]);
  const winners = new Set(((sels ?? []) as Row[]).map((s) => String(s.recipient_id)));
  if (!winners.size) return { error: "Nejdřív vyber vítěze." };
  const signature = await senderSignatureText(user.id, { ownerId: user.id });
  let sent = 0;
  for (const x of (recs ?? []) as Row[]) {
    if (winners.has(String(x.id)) || x.thanked_at || !["nabidka", "odpovedel"].includes(String(x.status))) continue;
    const emails = (x.emails as string[]) ?? [];
    const tone = await toneFor(db, user.id, emails).catch(() => null);
    const m = rfqThanksMail({ number: String(r0.number), salutation: tone?.salutation ?? "Dobrý den,", address: tone?.setting.address ?? "vy", signature });
    const mid = await sentMessageId(db, x.email_id);
    const res = await sendMail({
      to: emails.join(", "), subject: m.subject, text: m.body, from: { ownerId: user.id }, jobId: String(r0.job_id), senderId: user.id,
      supplierId: (x.supplier_id as string | null) ?? null, signature: { userId: user.id, mode: "inline" }, category: "k_zakazce",
      inReplyTo: mid, references: mid ? [mid] : null,
    });
    if (!res.sent) return sent ? { ok: true, sent } : { error: res.reason ?? "Poděkování se nepodařilo odeslat." };
    await db.from("rfq_recipients").update({ thanked_at: new Date().toISOString() }).eq("id", x.id);
    sent++;
  }
  if (sent) {
    await logJobEvent(db as unknown as JobsDb, {
      jobId: String(r0.job_id), type: "email", entity: "supplier_quote", entityId: roundId, actorId: user.id,
      message: `Poptávka ${r0.number}: poděkování nevybraným dodavatelům (${sent})`, data: { rfqRoundId: roundId, action: "thanked", count: sent },
    });
  }
  return { ok: true, sent };
}

/** Čeká na anonymizaci → „Poslat hned bez čekajících výkresů". */
export async function sendRecipientWithoutPending(dbIn: JobsDb, user: RfqActor, recipientId: string): Promise<{ ok: true } | { error: string }> {
  const db = loose(dbIn);
  const c = await recipientCtx(db, recipientId);
  if ("error" in c) return c;
  if (c.rec.status !== "ceka_na_anonymizaci" || !isUuid(c.rec.send_queue_id)) return { error: "Poptávka dodavateli už nečeká na výkresy." };
  // řádek fronty patří k tomuto kolu (právo „rfq" ověřila akce) — pošle se pod autorem kola, ne pod kolegou
  const r = await sendWithoutPending(db as never, String(c.rec.send_queue_id), String(c.rec.sent_by ?? user.id), true);
  if (!r.ok) return { error: r.error ?? "Odeslání se nepodařilo." };
  await reconcile(db, [c.rec]);
  return { ok: true };
}

/** Neodešlo (SMTP) → zkusit znovu teď (stejná zpráva jako ve frontě K odeslání). */
export async function retryRecipient(dbIn: JobsDb, user: RfqActor, recipientId: string): Promise<{ ok: true } | { error: string }> {
  const db = loose(dbIn);
  const c = await recipientCtx(db, recipientId);
  if ("error" in c) return c;
  if (c.rec.status !== "chyba") return { error: "Poptávka dodavateli už odešla." };
  if (c.rec.outbox_id) {
    const { data: ob } = await db.from("mail_outbox").select("id, payload, status").eq("id", c.rec.outbox_id as string).maybeSingle();
    const o = ob as { id: string; payload: { to: string; subject: string; body: string; attachments?: { kind: string; ref: string; filename?: string }[] }; status: string } | null;
    if (o && o.status !== "sent" && o.status !== "cancelled") {
      const ids = (o.payload.attachments ?? []).filter((a) => a.kind === "job" && isUuid(a.ref)).map((a) => a.ref);
      const { data: rows } = ids.length ? await db.from("job_files").select(SHARE_FILE_SELECT).in("id", ids) : { data: [] };
      const price = await sharePriceDocIds(db as never, ids);
      const atts: { filename: string; content: Buffer; contentType?: string }[] = [];
      for (const a of o.payload.attachments ?? []) {
        const f = ((rows ?? []) as FileRowWithAnon[]).find((r) => r.id === a.ref);
        if (!f) continue;
        const dec = pickShareFile(f, { priceDocument: price.has(f.id.toLowerCase()) });
        if (!dec.ok) continue;
        const bytes = await verifyShareBytes(db as never, dec, f);
        atts.push({ filename: a.filename || dec.filename, content: Buffer.from(bytes), contentType: dec.mime });
      }
      const res = await sendMail({
        to: o.payload.to, subject: o.payload.subject, text: o.payload.body, attachments: atts, from: { ownerId: user.id }, jobId: c.job.id,
        senderId: user.id, supplierId: (c.rec.supplier_id as string | null) ?? null, signature: { userId: user.id, mode: "inline" }, category: "k_zakazce",
      });
      if (!res.sent) {
        await db.from("rfq_recipients").update({ error: res.reason ?? "Odeslání selhalo." }).eq("id", recipientId);
        return { error: res.reason ?? "Odeslání selhalo." };
      }
      await db.from("mail_outbox").update({ status: "sent", sent_at: new Date().toISOString(), email_id: res.emailId ?? null }).eq("id", o.id);
      await db.from("rfq_recipients").update({ status: "odeslano", sent_at: new Date().toISOString(), email_id: res.emailId ?? null, error: null }).eq("id", recipientId);
      return { ok: true };
    }
  }
  return { error: "Zprávu k opakování se nepodařilo najít — pošli poptávku znovu." };
}

/** Text odpovědi dodavatele (pro předvyplnění nabídky). */
export async function replyText(dbIn: JobsDb, recipientId: string): Promise<{ text: string; subject: string | null; items: RfqItem[]; today: string } | null> {
  const db = loose(dbIn);
  const c = await recipientCtx(db, recipientId);
  if ("error" in c || !isUuid(c.rec.reply_email_id)) return null;
  const { data } = await db.from("emails").select("subject, body_text").eq("id", c.rec.reply_email_id as string).maybeSingle();
  const em = data as { subject: string | null; body_text: string | null } | null;
  if (!em) return null;
  return { text: em.body_text ?? "", subject: em.subject, items: (c.round.items as RfqItem[]) ?? [], today: pragueToday() };
}
