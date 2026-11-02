import "server-only";
import type { JobsDb } from "@/lib/jobs/events";
import { isUuid, one } from "@/lib/jobs/mapping";
import { customerLeakGuard, findLeaks, redactCustomer, type LeakGuard } from "@/lib/rfq/model";
import { isModel3d } from "@/lib/anonymize/candidate";
import { SHARE_FILE_SELECT, pickShareFile, sharePriceDocIds, verifyShareBytes, type FileRowWithAnon } from "@/lib/anonymize/share";
import {
  attachmentMailLines, collectItemDeviations, deviationLines, normDrawing, pickPoAttachments, poAttachmentPlan, resolveDeviations,
  type CorrectionSource, type DeviationSources, type DrawingChangeSource, type ItemDeviationsRef, type ItemSource, type MailChangeSource,
  type PoAttachmentCandidate, type PoAttachmentPlan, type PoDeviation, type PoFileSource, type PoLineRef,
} from "@/lib/jobs/po-deviations";
import type { PurchaseItem, PurchaseOrderView } from "@/lib/jobs/purchasing-types";

/**
 * Objednávka dodavateli — odchylky od výkresu a přílohy e-mailu ze zdrojů zakázky (servisní / operátorský klient;
 * oprávnění hlídá volající). Čistá logika je v po-deviations.ts.
 *  • loadDeviationContext — položky zakázky, propsané pokyny z e-mailu, opravy, změny revize, pojistka zákazníka,
 *  • lineDeviations — platné odchylky řádků objednávky (potvrzené + nové ze zdrojů, bez údajů zákazníka),
 *  • loadPoAttachmentPlan / collectPoAttachments — přílohy jen dílů objednávky (anonymizované výkresy, modely).
 */

type Row = Record<string, unknown>;
const BUCKET = "job-files";

export interface DeviationContext {
  jobId: string;
  items: (ItemSource & { quantity: number | null })[];
  sources: DeviationSources;
  guard: LeakGuard;
}

export async function loadDeviationContext(db: JobsDb, jobId: string): Promise<DeviationContext | null> {
  if (!isUuid(jobId)) return null;
  const [job, items, mails, events, changes] = await Promise.all([
    db.from("orders")
      .select("id, title, customer_order_number, customer_inquiry_number, customer_contact, customer_contact_email, customer:customers!customer_id(name, ico, dic, email)")
      .eq("id", jobId).maybeSingle(),
    db.from("order_items").select("id, drawing_number, revision, supplier_note, unit, quantity").eq("order_id", jobId).order("position"),
    db.from("job_mail_changes").select("id, order_item_id, field, status, kind, value_new, drawing_value, created_at")
      .eq("job_id", jobId).eq("kind", "change").eq("status", "applied"),
    db.from("job_events").select("data, created_at").eq("job_id", jobId).eq("data->>exception", "correction").order("created_at"),
    db.from("job_drawing_changes").select("id, order_item_id, drawing_number, rev_from, rev_to, file_id, old_file_id, created_at").eq("job_id", jobId),
  ]);
  const j = job.data as (Row & { customer?: Row | Row[] | null }) | null;
  if (!j) return null;
  const cust = one(j.customer ?? null) as { name?: string | null; ico?: string | null; dic?: string | null; email?: string | null } | null;
  const guard = customerLeakGuard({
    name: cust?.name ?? null, ico: cust?.ico ?? null, dic: cust?.dic ?? null,
    email: cust?.email ?? (j.customer_contact_email as string | null) ?? null,
    contact: (j.customer_contact as string | null) ?? null,
    numbers: [j.customer_order_number as string | null, j.customer_inquiry_number as string | null],
  });
  const corrections: CorrectionSource[] = ((events.data ?? []) as { data: Row | null; created_at: string }[])
    .map((e) => ({ at: e.created_at, changes: Array.isArray(e.data?.changes) ? (e.data!.changes as CorrectionSource["changes"]) : [] }));
  return {
    jobId,
    items: ((items.data ?? []) as Row[]).map((r) => ({
      id: String(r.id), drawing_number: (r.drawing_number as string | null) ?? null, revision: (r.revision as string | null) ?? null,
      supplier_note: (r.supplier_note as string | null) ?? null, unit: (r.unit as string | null) ?? null,
      quantity: r.quantity === null || r.quantity === undefined ? null : Number(r.quantity),
    })),
    sources: {
      // chyba čtení (chybějící tabulka ve starší DB) = bez zdroje, nikdy pád objednávky
      mailChanges: (mails.error ? [] : (mails.data ?? [])) as MailChangeSource[],
      corrections: events.error ? [] : corrections,
      drawingChanges: (changes.error ? [] : (changes.data ?? [])) as DrawingChangeSource[],
    },
    guard,
  };
}

/** Řádek objednávky → díl zakázky: vazba order_item_id, jinak jednoznačné číslo výkresu. */
export function lineItemId(ctx: Pick<DeviationContext, "items">, line: Pick<PurchaseItem, "orderItemId" | "drawingNumber">): string | null {
  if (line.orderItemId && ctx.items.some((i) => i.id === line.orderItemId)) return line.orderItemId;
  const n = normDrawing(line.drawingNumber);
  if (n.length < 2) return null;
  const hit = ctx.items.filter((i) => normDrawing(i.drawing_number) === n);
  return hit.length === 1 ? hit[0].id : null;
}

/** Odchylka bez údajů zákazníka (citace z e-mailu může nést jméno firmy, číslo objednávky, kontakt). */
export function redactDeviation(d: PoDeviation, guard: LeakGuard): PoDeviation {
  const r = (s: string | null | undefined) => {
    if (!s) return s;
    const red = redactCustomer(s, guard);
    // osiřelé „dle dohody s …" / „od …" po odstraněném jménu → pryč (neutrální znění)
    return red.hits.length ? red.text.replace(/\s+(?:dle\s+dohody\s+)?(?:s|se|od|u|firmy|firmou)\s+…/giu, "").replace(/\s{2,}/g, " ").trim() : red.text;
  };
  return { ...d, value: r(d.value) ?? "", ...(d.drawingValue ? { drawingValue: r(d.drawingValue) } : {}), ...(d.was ? { was: r(d.was) } : {}) };
}

export interface LineDeviations {
  index: number;
  orderItemId: string | null;
  /** Ze zdrojů (bez potvrzení). */
  auto: PoDeviation[];
  /** Platný seznam (potvrzený + nové ze zdrojů), vč. vypnutých. */
  list: PoDeviation[];
}

/** Platné odchylky řádků objednávky (potvrzené v dialogu + nové ze zdrojů), vždy bez údajů zákazníka. */
export function lineDeviations(
  ctx: DeviationContext,
  lines: Pick<PurchaseItem, "orderItemId" | "drawingNumber" | "quantity" | "unit" | "note" | "deviations">[],
): LineDeviations[] {
  return lines.map((line, index) => {
    const itemId = lineItemId(ctx, line);
    const item = itemId ? ctx.items.find((i) => i.id === itemId) ?? null : null;
    const auto = item ? collectItemDeviations(item, ctx.sources, { quantity: line.quantity, note: line.note, unit: line.unit }).map((d) => redactDeviation(d, ctx.guard)) : [];
    const stored = line.deviations ? line.deviations.map((d) => redactDeviation(d, ctx.guard)) : null;
    return { index, orderItemId: itemId, auto, list: resolveDeviations(auto, stored) };
  });
}

/** Řádky „Odchylka od výkresu" pro PDF (po položkách). */
export async function purchaseOrderDeviationLines(db: JobsDb, po: Pick<PurchaseOrderView, "jobId" | "items">): Promise<string[][]> {
  const ctx = await loadDeviationContext(db, po.jobId).catch(() => null);
  if (!ctx) return po.items.map((it) => deviationLines(it.deviations ?? []));
  return lineDeviations(ctx, po.items).map((l) => deviationLines(l.list));
}

/** Souhrn odchylek do e-mailu (č. výkresu → řádky). */
export function deviationRefs(lines: LineDeviations[], items: Pick<PurchaseItem, "drawingNumber" | "name">[]): ItemDeviationsRef[] {
  return lines.map((l) => {
    const it = items[l.index];
    return { ref: (it?.drawingNumber ?? "").trim() || (it?.name ?? "").trim() || `položka ${l.index + 1}`, lines: deviationLines(l.list) };
  }).filter((r) => r.lines.length);
}

// ── Přílohy ─────────────────────────────────────────────────
type FileRow = FileRowWithAnon & { order_item_id: string | null; archived: boolean; replaced_by: string | null; created_at: string; size_bytes: number | null; anon_size: number | null };

export interface PoAttachmentData {
  plan: PoAttachmentPlan;
  lines: PoLineRef[];
}

/**
 * Plán příloh e-mailu objednávky: jen soubory dílů objednávky (výkresy a 3D modely; poptávka / objednávka
 * zákazníka ani soubory jiných dílů nikdy). `focusSince` (změna po nové revizi) = zaškrtnout jen díly,
 * kterým se od té doby změnila revize výkresu.
 */
export async function loadPoAttachmentPlan(
  db: JobsDb,
  po: Pick<PurchaseOrderView, "jobId" | "number"> & { items: (Pick<PurchaseItem, "drawingNumber" | "name"> & Partial<Pick<PurchaseItem, "orderItemId">>)[] },
  opts: { ctx?: DeviationContext | null; focusSince?: string | null } = {},
): Promise<PoAttachmentData> {
  const ctx = opts.ctx ?? (await loadDeviationContext(db, po.jobId));
  const lines: PoLineRef[] = po.items.map((it, index) => {
    const itemId = ctx ? lineItemId(ctx, it) : it.orderItemId ?? null;
    const item = ctx && itemId ? ctx.items.find((x) => x.id === itemId) : null;
    return {
      index, orderItemId: itemId, drawingNumber: it.drawingNumber ?? item?.drawing_number ?? null, revision: item?.revision ?? null,
      label: (it.drawingNumber ?? "").trim() || (it.name ?? "").trim() || `položka ${index + 1}`,
    };
  });
  const { data, error } = await db.from("job_files")
    .select(`${SHARE_FILE_SELECT}, order_item_id, archived, replaced_by, created_at, size_bytes, anon_size`)
    .eq("job_id", po.jobId).in("kind", ["vykres", "model_3d"]).order("created_at");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as FileRow[];
  const price = await sharePriceDocIds(db as never, rows.map((r) => r.id));
  const files: PoFileSource[] = rows.map((f) => {
    const dec = pickShareFile(f, { priceDocument: price.has(f.id.toLowerCase()) });
    const fromName = (n: string) => /\.([A-Za-z0-9]{1,8})$/.exec(n)?.[1] ?? "";
    return {
      id: f.id, kind: f.kind, filename: f.filename, order_item_id: f.order_item_id, archived: Boolean(f.archived), replaced_by: f.replaced_by,
      created_at: f.created_at, model: isModel3d(f.kind, f.filename),
      size: dec.ok && dec.source === "anon" ? f.anon_size ?? null : f.size_bytes ?? null,
      status: dec.ok ? "ready" : dec.reason === "pending" ? "pending" : "blocked",
      message: dec.ok ? null : dec.message,
      ext: (dec.ok ? fromName(dec.filename) : "") || fromName(f.filename) || "pdf",
    };
  });
  let focusItems: string[] | null = null;
  if (opts.focusSince && ctx) {
    const since = opts.focusSince;
    focusItems = [...new Set(ctx.sources.drawingChanges.filter((c) => c.order_item_id && c.created_at > since).map((c) => c.order_item_id as string))];
    if (!focusItems.length) focusItems = null;
  }
  const plan = poAttachmentPlan(lines, files, { poNumber: po.number, drawingChanges: ctx?.sources.drawingChanges ?? [], focusItems });
  return { plan, lines };
}

/** Řádky e-mailu: přiložené výkresy / modely a nahrazené revize (u dílů s novou revizí). */
export function poAttachmentMailLines(
  ctx: DeviationContext | null,
  data: PoAttachmentData,
  picked: Pick<PoAttachmentCandidate, "role" | "name" | "lines">[],
  address: "ty" | "vy" | null | undefined,
  opts: { since?: string | null } = {},
): string[] {
  const revisions: { ref: string; to: string; from: string | null }[] = [];
  if (ctx && opts.since !== undefined) {
    for (const l of data.lines) {
      if (!l.orderItemId || !picked.some((p) => p.role === "drawing" && p.lines.includes(l.index))) continue;
      const ch = ctx.sources.drawingChanges
        .filter((c) => c.order_item_id === l.orderItemId && (!opts.since || c.created_at > opts.since) && c.rev_to)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)).pop();
      if (ch) revisions.push({ ref: l.drawingNumber || l.label, to: String(ch.rev_to), from: ch.rev_from });
    }
  }
  return attachmentMailLines(picked, revisions, address);
}

export interface CollectedPoAttachments {
  ready: { fileId: string; filename: string; content: Buffer; contentType: string }[];
  pending: string[];
  blocked: { fileId: string; message: string }[];
  /** id → neutrální název (fronta po anonymizaci). */
  names: Record<string, string>;
}

/**
 * Bajty příloh (pickShareFile + verifyShareBytes — anonymizovaná kopie s kontrolou sha256, 3D model
 * originál). Výběr jen z plánu (cizí soubor neprojde); pending = čeká na anonymizaci → fronta odeslání.
 */
export async function collectPoAttachments(db: JobsDb, plan: PoAttachmentPlan, chosen: string[] | null | undefined): Promise<CollectedPoAttachments> {
  const picked = pickPoAttachments(plan, chosen);
  const out: CollectedPoAttachments = { ready: [], pending: [], blocked: [], names: {} };
  if (!picked.length) return out;
  const ids = picked.map((p) => p.fileId);
  const { data, error } = await db.from("job_files").select(SHARE_FILE_SELECT).in("id", ids);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as FileRowWithAnon[];
  const price = await sharePriceDocIds(db as never, ids);
  for (const p of picked) {
    out.names[p.fileId] = p.name;
    const f = rows.find((r) => r.id === p.fileId);
    if (!f) { out.blocked.push({ fileId: p.fileId, message: "Soubor nenalezen." }); continue; }
    const dec = pickShareFile(f, { priceDocument: price.has(f.id.toLowerCase()) });
    if (!dec.ok) {
      if (dec.reason === "pending") out.pending.push(p.fileId);
      else out.blocked.push({ fileId: p.fileId, message: dec.message });
      continue;
    }
    const bytes = await verifyShareBytes(db as never, dec, f);
    out.ready.push({ fileId: p.fileId, filename: p.name, content: Buffer.from(bytes), contentType: dec.mime });
  }
  return out;
}

/** Pojistka: údaj zákazníka v názvech příloh nebo v textech odchylek (nic takového neodejde). */
export function poLeaks(ctx: DeviationContext | null, texts: (string | null | undefined)[]): string[] {
  return ctx ? findLeaks(texts, ctx.guard) : [];
}

export { BUCKET as PO_FILES_BUCKET };
