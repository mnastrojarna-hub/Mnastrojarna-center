// Návrh rozdělení faktury dodavatele na zakázky (čistá funkce — AI „vyplní", člověk opraví).
// Pořadí důkazů: naše objednávka OV-… v řádku → zakázka Z-… → objednávka zákazníka → číslo výkresu →
// odkazy v hlavičce faktury → jediná otevřená objednávka dodavatele se shodnou částkou → režie podle
// klíčových slov → nepřiřazeno.
import { docNumbersEqual, normalizeDocNumber } from "@/lib/jobs/matching";
import type { OverheadCategory, SupplierInvoiceRefs, SupplierInvoiceTarget } from "@/lib/supplier-invoices/types";
import { capacityOf, fromCents, toCents } from "@/lib/supplier-invoices/money";

export interface MatchPurchaseOrderItem {
  id: string;
  drawingNumber: string | null;
  name: string | null;
  orderItemId: string | null;
}

export interface MatchPurchaseOrder {
  id: string;
  number: string | null;
  jobId: string;
  jobNumber: string;
  supplierId: string | null;
  status: string;
  total: number;
  /** Už má potvrzenou fakturu (jiné faktury). */
  invoiced: boolean;
  items: MatchPurchaseOrderItem[];
}

export interface MatchJobItem { id: string; drawingNumber: string | null; name: string | null }

export interface MatchJob {
  id: string;
  number: string;
  customerOrderNumber: string | null;
  /** Uzavřená zakázka (dokončeno, zrušeno…) — jen při přesné shodě čísla. */
  closed: boolean;
  items: MatchJobItem[];
}

export interface MatchInvoiceItem {
  id: string;
  text: string;
  code: string | null;
  amount: number;
  refs: string[];
}

export interface MatchInvoice {
  supplierId: string | null;
  totalNet: number;
  items: MatchInvoiceItem[];
  references: SupplierInvoiceRefs;
}

export interface ProposedAllocation {
  itemId: string | null;
  target: SupplierInvoiceTarget;
  jobId: string | null;
  category: OverheadCategory | null;
  amount: number;
  purchaseOrderId: string | null;
  purchaseOrderItemId: string | null;
  orderItemId: string | null;
  /** „podle naší objednávky OV-2026-014 v řádku" */
  reason: string;
  confidence: number;
}

const OV_RE = /\bOV[\s\-/._]?(\d{4})[\s\-/._]?(\d{1,5})\b/gi;
const JOB_RE = /\bZ[\s\-/._]?(\d{4})[\s\-/._]?(\d{1,5})\b/gi;

function numbersIn(text: string, re: RegExp, prefix: string): string[] {
  const out = new Set<string>();
  for (const m of String(text ?? "").matchAll(re)) out.add(`${prefix}-${m[1]}-${m[2]}`);
  return [...out];
}

/** Čísla našich objednávek dodavateli (OV-2026-014) v textu — vždy ve tvaru OV-RRRR-NNN. */
export function purchaseOrderNumbersIn(text: string): string[] {
  return numbersIn(text, OV_RE, "OV");
}

/** Čísla našich zakázek (Z-2026-014) v textu. */
export function jobNumbersIn(text: string): string[] {
  return numbersIn(text, JOB_RE, "Z");
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const OVERHEAD_RULES: { category: OverheadCategory; re: RegExp; label: string }[] = [
  { category: "doprava", re: /\b(doprav|preprav|postovn|baln[eé]|spedic|kuryr|fracht|freight|shipping|transport|zasilk)/, label: "doprava" },
  { category: "energie", re: /\b(elektrin|elektricka energie|energie|plyn\b|vodne|stocne|teplo\b)/, label: "energie" },
  { category: "naradi", re: /\b(naradi|rezne nastroj|vrtak|vymenitelne desticky|britov)/, label: "nářadí" },
  { category: "sluzby", re: /\b(servis|udrzb|kalibrac|najem|pronajem|licenc)/, label: "služby" },
  { category: "material", re: /\b(kancelarsk|cistic|mazivo|chladici kapalin|olej\b)/, label: "režijní materiál" },
];

/** Režie podle klíčových slov řádku (null = není režie). */
export function overheadCategoryOf(text: string): { category: OverheadCategory; label: string } | null {
  const t = fold(text ?? "");
  for (const r of OVERHEAD_RULES) if (r.re.test(t)) return { category: r.category, label: r.label };
  return null;
}

function containsNumber(text: string, number: string | null | undefined): boolean {
  const n = normalizeDocNumber(number);
  if (n.length < 4) return false;
  const t = normalizeDocNumber(text).replace(/-/g, "");
  return t.includes(n.replace(/-/g, ""));
}

function drawingTokens(item: MatchInvoiceItem): string[] {
  const out = new Set<string>();
  if (item.code) out.add(normalizeDocNumber(item.code));
  for (const r of item.refs) out.add(normalizeDocNumber(r));
  for (const tok of (item.text ?? "").split(/[\s,;()]+/)) {
    const n = normalizeDocNumber(tok);
    if (n.length >= 4 && /\d/.test(n)) out.add(n);
  }
  return [...out].filter((x) => x.length >= 4);
}

function poItemFor(po: MatchPurchaseOrder, item: MatchInvoiceItem): MatchPurchaseOrderItem | null {
  const toks = drawingTokens(item);
  const hits = po.items.filter((pi) => pi.drawingNumber && toks.some((t) => docNumbersEqual(t, pi.drawingNumber)));
  if (hits.length === 1) return hits[0];
  return po.items.length === 1 ? po.items[0] : null;
}

function jobItemFor(job: MatchJob, item: MatchInvoiceItem): MatchJobItem | null {
  const toks = drawingTokens(item);
  const hits = job.items.filter((ji) => ji.drawingNumber && toks.some((t) => docNumbersEqual(t, ji.drawingNumber)));
  return hits.length === 1 ? hits[0] : null;
}

interface Ctx {
  invoice: MatchInvoice;
  purchaseOrders: MatchPurchaseOrder[];
  jobs: MatchJob[];
}

type Hit = Omit<ProposedAllocation, "itemId" | "amount">;

function poHit(ctx: Ctx, po: MatchPurchaseOrder, item: MatchInvoiceItem | null, reason: string, confidence: number): Hit {
  const pi = item ? poItemFor(po, item) : null;
  return {
    target: "job", jobId: po.jobId, category: null, purchaseOrderId: po.id, purchaseOrderItemId: pi?.id ?? null,
    orderItemId: pi?.orderItemId ?? null, reason, confidence,
  };
}

function findPo(ctx: Ctx, number: string): MatchPurchaseOrder | null {
  const hits = ctx.purchaseOrders.filter((p) => p.number && docNumbersEqual(p.number, number) && p.status !== "zrusena");
  return hits.length === 1 ? hits[0] : null;
}

function findJob(ctx: Ctx, number: string): MatchJob | null {
  const hits = ctx.jobs.filter((j) => docNumbersEqual(j.number, number));
  return hits.length === 1 ? hits[0] : null;
}

/** Důkaz z jednoho řádku faktury (null = řádek sám nic neříká). */
function itemHit(ctx: Ctx, item: MatchInvoiceItem): Hit | null {
  const text = [item.text, item.code ?? "", ...item.refs].join(" ");
  for (const n of purchaseOrderNumbersIn(text)) {
    const po = findPo(ctx, n);
    if (po) return poHit(ctx, po, item, `podle naší objednávky ${po.number} v řádku`, 0.95);
  }
  for (const n of jobNumbersIn(text)) {
    const job = findJob(ctx, n);
    if (job) {
      const ji = jobItemFor(job, item);
      const po = ctx.purchaseOrders.find((p) => p.jobId === job.id && p.supplierId === ctx.invoice.supplierId && p.status !== "zrusena") ?? null;
      return {
        target: "job", jobId: job.id, category: null, purchaseOrderId: po?.id ?? null,
        purchaseOrderItemId: po ? poItemFor(po, item)?.id ?? null : null, orderItemId: ji?.id ?? null,
        reason: `podle zakázky ${job.number} v řádku`, confidence: 0.9,
      };
    }
  }
  const byCustomerOrder = ctx.jobs.filter((j) => !j.closed && j.customerOrderNumber && containsNumber(text, j.customerOrderNumber));
  if (byCustomerOrder.length === 1) {
    const job = byCustomerOrder[0];
    return {
      target: "job", jobId: job.id, category: null, purchaseOrderId: null, purchaseOrderItemId: null,
      orderItemId: jobItemFor(job, item)?.id ?? null, reason: `podle objednávky zákazníka ${job.customerOrderNumber} (${job.number})`, confidence: 0.85,
    };
  }
  // číslo výkresu: objednávka tohoto dodavatele s tím výkresem, jinak jediná otevřená zakázka s ním
  const toks = drawingTokens(item);
  if (toks.length) {
    const pos = ctx.purchaseOrders.filter((p) => p.status !== "zrusena" && p.supplierId === ctx.invoice.supplierId && ctx.invoice.supplierId
      && p.items.some((pi) => pi.drawingNumber && toks.some((t) => docNumbersEqual(t, pi.drawingNumber))));
    if (pos.length === 1) return poHit(ctx, pos[0], item, `podle výkresu v objednávce ${pos[0].number}`, 0.85);
    const jobs = ctx.jobs.filter((j) => !j.closed && j.items.some((ji) => ji.drawingNumber && toks.some((t) => docNumbersEqual(t, ji.drawingNumber))));
    if (jobs.length === 1) {
      const ji = jobItemFor(jobs[0], item);
      return {
        target: "job", jobId: jobs[0].id, category: null, purchaseOrderId: null, purchaseOrderItemId: null, orderItemId: ji?.id ?? null,
        reason: `podle výkresu ${ji?.drawingNumber ?? ""} (${jobs[0].number})`.replace("  ", " "), confidence: 0.8,
      };
    }
  }
  const oh = overheadCategoryOf(item.text);
  if (oh) {
    return {
      target: "rezie", jobId: null, category: oh.category, purchaseOrderId: null, purchaseOrderItemId: null, orderItemId: null,
      reason: `režie — ${oh.label}`, confidence: 0.75,
    };
  }
  return null;
}

/** Důkaz z hlavičky faktury (platí pro řádky, které samy nic neříkají). */
function headerHit(ctx: Ctx): Hit | null {
  const r = ctx.invoice.references;
  const pos = [...new Set(r.purchaseOrderNumbers.flatMap((n) => [...purchaseOrderNumbersIn(n), normalizeDocNumber(n)]))]
    .map((n) => findPo(ctx, n)).filter((p): p is MatchPurchaseOrder => Boolean(p));
  const uniquePos = [...new Map(pos.map((p) => [p.id, p])).values()];
  if (uniquePos.length === 1) return poHit(ctx, uniquePos[0], null, `podle naší objednávky ${uniquePos[0].number} na faktuře`, 0.85);
  const jobs = [...new Map(r.jobNumbers.map((n) => findJob(ctx, n)).filter((j): j is MatchJob => Boolean(j)).map((j) => [j.id, j])).values()];
  if (jobs.length === 1) {
    return {
      target: "job", jobId: jobs[0].id, category: null, purchaseOrderId: null, purchaseOrderItemId: null, orderItemId: null,
      reason: `podle zakázky ${jobs[0].number} na faktuře`, confidence: 0.85,
    };
  }
  const byCo = ctx.jobs.filter((j) => !j.closed && j.customerOrderNumber && r.customerOrderNumbers.some((n) => docNumbersEqual(n, j.customerOrderNumber)));
  if (byCo.length === 1) {
    return {
      target: "job", jobId: byCo[0].id, category: null, purchaseOrderId: null, purchaseOrderItemId: null, orderItemId: null,
      reason: `podle objednávky zákazníka ${byCo[0].customerOrderNumber} (${byCo[0].number})`, confidence: 0.8,
    };
  }
  return null;
}

/**
 * Jediná otevřená (nefakturovaná) objednávka dodavatele se shodnou částkou (±2 %). Objednávka, na kterou už
 * jde jiný řádek TÉTO faktury, se nenabízí (jinak by se na ni řádky sečetly přes její částku).
 */
function supplierPoHit(ctx: Ctx, amount: number, taken: Set<string>): Hit | null {
  if (!ctx.invoice.supplierId || !amount) return null;
  const open = ctx.purchaseOrders.filter((p) => p.supplierId === ctx.invoice.supplierId && p.status !== "zrusena" && p.status !== "navrh"
    && !p.invoiced && !taken.has(p.id));
  const close = open.filter((p) => p.total > 0 && Math.abs(p.total - Math.abs(amount)) <= Math.max(1, p.total * 0.02));
  if (close.length === 1) return poHit(ctx, close[0], null, `částka odpovídá otevřené objednávce ${close[0].number}`, 0.7);
  return null;
}

/** Zakázka, ze které se fotí: záložní návrh (s jedinou objednávkou tohoto dodavatele na ní, je-li). */
function contextJobHit(ctx: Ctx, jobId: string | null | undefined): Hit | null {
  const job = jobId ? ctx.jobs.find((j) => j.id === jobId) : null;
  if (!job) return null;
  const pos = ctx.invoice.supplierId
    ? ctx.purchaseOrders.filter((p) => p.jobId === job.id && p.supplierId === ctx.invoice.supplierId && p.status !== "zrusena")
    : [];
  if (pos.length === 1) return poHit(ctx, pos[0], null, `doklad nahraný u zakázky ${job.number} (objednávka ${pos[0].number ?? "—"})`, 0.65);
  return {
    target: "job", jobId: job.id, category: null, purchaseOrderId: null, purchaseOrderItemId: null, orderItemId: null,
    reason: `doklad nahraný u zakázky ${job.number}`, confidence: 0.6,
  };
}

/**
 * Návrh rozdělení. Každý řádek s částkou dostane nejvýš jeden návrh na celou částku (rozdělení na víc
 * zakázek je rozhodnutí člověka); bez řádků se navrhuje celá faktura (z hlavičky). Řádky bez vlastního
 * důkazu: odkaz v hlavičce → objednávka dodavatele se shodnou částkou → zakázka, ze které se fotí.
 */
export function proposeAllocations(
  invoice: MatchInvoice,
  purchaseOrders: MatchPurchaseOrder[],
  jobs: MatchJob[],
  opts: { fallbackJobId?: string | null } = {},
): ProposedAllocation[] {
  const ctx: Ctx = { invoice, purchaseOrders, jobs };
  const out: ProposedAllocation[] = [];
  const header = headerHit(ctx);
  const items = invoice.items.filter((i) => toCents(i.amount) !== 0);
  const unassigned: MatchInvoiceItem[] = [];
  for (const it of items) {
    const hit = itemHit(ctx, it);
    if (hit) out.push({ ...hit, itemId: it.id, amount: fromCents(toCents(it.amount)) });
    else unassigned.push(it);
  }
  const rest = unassigned.reduce((s, i) => s + toCents(i.amount), 0);
  const taken = new Set(out.map((p) => p.purchaseOrderId).filter((x): x is string => Boolean(x)));
  const fallback = header ?? supplierPoHit(ctx, fromCents(items.length ? rest : toCents(invoice.totalNet)), taken)
    ?? contextJobHit(ctx, opts.fallbackJobId);
  if (fallback) {
    for (const it of unassigned) {
      const pi = fallback.purchaseOrderId ? purchaseOrders.find((p) => p.id === fallback.purchaseOrderId) : null;
      const poi = pi ? poItemFor(pi, it) : null;
      out.push({
        ...fallback, itemId: it.id, amount: fromCents(toCents(it.amount)),
        purchaseOrderItemId: poi?.id ?? fallback.purchaseOrderItemId, orderItemId: poi?.orderItemId ?? fallback.orderItemId,
      });
    }
  }
  // zbytek faktury mimo položky (nebo celá faktura bez položek)
  const headerCap = capacityOf(null, invoice.totalNet, invoice.items.map((i) => ({ id: i.id, amount: i.amount })));
  if (toCents(headerCap) !== 0 && (!items.length) && fallback) {
    out.push({ ...fallback, itemId: null, amount: headerCap, purchaseOrderItemId: null, orderItemId: null });
  }
  return out;
}
