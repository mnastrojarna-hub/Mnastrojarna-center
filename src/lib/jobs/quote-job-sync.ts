import { formatKc, pairQuoteItems, sameMoney } from "@/lib/jobs/consistency";
import { CLOSED_STAGES, DELIVERED_STAGES } from "@/lib/jobs/stages";
import { addLeadTime, czDate, parseYmd } from "@/lib/jobs/lead-time";
import type { JobStage } from "@/lib/supabase/database.types";

/**
 * Nabídka → zakázka (majitel 9. 11.: „Když se udělá nabídka, musí se do zakázky doplnit číslo, cena,
 * termíny, nákup, marže, obrat — všechno provázané"). Čistá logika, sdílí ji server
 * (src/lib/jobs/quote-job-sync-store.ts) i přehled zakázky (aktuální nabídka v hlavičce).
 *
 * Pravidla:
 *  1. Aktuální nabídka zakázky = přijatá (orders.quote_id / stav přijato), jinak nejnovější platná verze
 *     (nejvyšší revize) bez archivovaných a zamítnutých. Archivní ani zamítnutá zakázku neřídí.
 *  2. Položky: zakázka bez položek → položky z nabídky (výkres, název, popis, materiál, počet, jednotka,
 *     prodejní i nákupní cena; poznámka položky nabídky je pro zákazníka → do interní poznámky ne).
 *     Zakázka s položkami → spárovat (výkres / název / pozice): prodejní cena podle nabídky, nákupní jen
 *     tam, kde v zakázce chybí; počty zakázky zůstanou (dodávky, objednávky dodavatelům); položky nabídky
 *     bez páru přibudou; položky zakázky bez páru zůstanou.
 *  3. Hodnota / nákup / marže plynou z položek (DB trigger + syncJobMoneyFromItems).
 *  4. Termín dodání (due_date) = datum objednávky (je-li), jinak odeslání nabídky, jinak její založení
 *     + dodací lhůta nabídky — jen když zakázka termín nemá, nebo ho dřív odvodila nabídka (orders.offer_sync).
 *     Ručně zadaný termín se nikdy nepřepíše; vyfakturovaná, sloučená, dokončená a zrušená zakázka se nemění.
 *  5. Stejná nabídka se stejnými položkami se znovu nepropisuje (ruční úprava cen v zakázce po nabídce
 *     zůstane a ukáže nesoulad s nabídkou) — kromě přijetí nabídky zákazníkem (force).
 */

export type OfferSyncReason = "created" | "updated" | "revision" | "approved" | "sent" | "accepted" | "backfill";

/** Stav posledního propsání nabídky do zakázky (orders.offer_sync). */
export interface OfferSyncState {
  quoteId: string;
  number: string | null;
  /** Otisk položek nabídky (id položek — úprava nabídky položky vždy nahradí novými). */
  itemsKey: string;
  /** Termín dodání, který naposledy odvodila nabídka (RRRR-MM-DD) — shoda s due_date = termín je „z nabídky". */
  dueDate: string | null;
  /** Kalendářní dny dodací lhůty, ze kterých termín vznikl (pro přepočet od data objednávky). */
  leadDays: number | null;
  at: string;
}

export function parseOfferSyncState(v: unknown): OfferSyncState | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (typeof r.quoteId !== "string" || !r.quoteId) return null;
  const lead = Number(r.leadDays);
  return {
    quoteId: r.quoteId,
    number: typeof r.number === "string" ? r.number : null,
    itemsKey: typeof r.itemsKey === "string" ? r.itemsKey : "",
    dueDate: typeof r.dueDate === "string" && parseYmd(r.dueDate) ? r.dueDate : null,
    leadDays: r.leadDays != null && Number.isFinite(lead) ? lead : null,
    at: typeof r.at === "string" ? r.at : "",
  };
}

// ── 1) Aktuální nabídka ───────────────────────────────────────
export interface OfferCandidate {
  id: string;
  status?: string | null;
  state?: string | null;
  archived?: boolean | null;
  revision?: number | null;
  createdAt?: string | null;
}

export function isRejectedQuote(q: Pick<OfferCandidate, "status" | "state">): boolean {
  return q.status === "zamitnuto" || q.state === "zamitnuta";
}

function isArchivedQuote(q: Pick<OfferCandidate, "archived" | "state">): boolean {
  return q.archived === true || q.state === "archivovana";
}

/** Přijatá nabídka (orders.quote_id nebo stav přijato), jinak nejnovější platná verze; null = žádná. */
export function currentOffer<T extends OfferCandidate>(quotes: T[], acceptedId: string | null | undefined): T | null {
  const live = quotes.filter((q) => !isRejectedQuote(q));
  const accepted = (acceptedId && live.find((q) => q.id === acceptedId))
    || live.find((q) => q.status === "prijato" || q.state === "prijata");
  if (accepted) return accepted;
  const open = live.filter((q) => !isArchivedQuote(q))
    .sort((a, b) => (Number(b.revision ?? 0) - Number(a.revision ?? 0)) || String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
  return open[0] ?? null;
}

// ── 2) Položky ────────────────────────────────────────────────
export interface OfferJobItem {
  id: string;
  position: number;
  drawingNumber: string | null;
  name: string | null;
  quantity: number;
  unitPrice: number | null;
  purchaseUnitPrice: number | null;
}

export interface OfferQuoteItem {
  position: number;
  drawingId: string | null;
  drawingNumber: string | null;
  name: string | null;
  description: string | null;
  material: string | null;
  quantity: number;
  unit: string;
  unitPrice: number | null;
  purchaseUnitPrice: number | null;
}

export interface OfferItemUpdate {
  id: string;
  unitPrice?: number;
  purchaseUnitPrice?: number;
}

export interface OfferItemsPlan {
  /** Nové položky zakázky (pozice už přepočtené za stávající). */
  create: (OfferQuoteItem & { position: number })[];
  update: OfferItemUpdate[];
  /** Kolik položek dostalo novou prodejní cenu / doplněnou nákupní cenu. */
  pricesUpdated: number;
  purchaseFilled: number;
  /** Zakázka položky neměla (vše se zakládá z nabídky). */
  fromScratch: boolean;
}

function drawingKey(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");
}

export function planOfferItems(jobItemsIn: OfferJobItem[], quoteItemsIn: OfferQuoteItem[]): OfferItemsPlan {
  const quoteItems = [...quoteItemsIn].sort((a, b) => a.position - b.position);
  const jobItems = [...jobItemsIn].sort((a, b) => a.position - b.position);
  const empty: OfferItemsPlan = { create: [], update: [], pricesUpdated: 0, purchaseFilled: 0, fromScratch: false };
  if (!quoteItems.length) return empty;
  if (!jobItems.length) {
    return { ...empty, create: quoteItems.map((q, i) => ({ ...q, position: i })), fromScratch: true };
  }
  const pairs = pairQuoteItems(jobItems, quoteItems); // jobIndex → quoteIndex
  // párování podle pozice nesmí spojit dva různé výkresy (jiný díl = nová položka, ne nová cena)
  for (const [ji, qi] of [...pairs.entries()]) {
    const a = drawingKey(jobItems[ji].drawingNumber);
    const b = drawingKey(quoteItems[qi].drawingNumber);
    if (a && b && a !== b) pairs.delete(ji);
  }
  const used = new Set<number>();
  const update: OfferItemUpdate[] = [];
  let pricesUpdated = 0;
  let purchaseFilled = 0;
  for (const [ji, qi] of [...pairs.entries()].sort((a, b) => a[0] - b[0])) {
    used.add(qi);
    const j = jobItems[ji];
    const q = quoteItems[qi];
    const u: OfferItemUpdate = { id: j.id };
    if (q.unitPrice !== null && !sameMoney(q.unitPrice, j.unitPrice)) {
      u.unitPrice = q.unitPrice;
      pricesUpdated += 1;
    }
    if (q.purchaseUnitPrice !== null && j.purchaseUnitPrice === null) {
      u.purchaseUnitPrice = q.purchaseUnitPrice;
      purchaseFilled += 1;
    }
    if (u.unitPrice !== undefined || u.purchaseUnitPrice !== undefined) update.push(u);
  }
  let next = jobItems.reduce((m, j) => Math.max(m, j.position), -1) + 1;
  const create = quoteItems.filter((_, i) => !used.has(i)).map((q) => ({ ...q, position: next++ }));
  return { create, update, pricesUpdated, purchaseFilled, fromScratch: false };
}

// ── 4) Termín dodání ──────────────────────────────────────────
export interface OfferDueInput {
  stage: JobStage | string | null;
  jobDueDate: string | null;
  previous: OfferSyncState | null;
  /** Dodací lhůta nabídky v kalendářních dnech (jen spolehlivá — quotes.lead_time_days). */
  leadDays: number | null;
  /** Datum objednávky zákazníka (lhůta běží od něj). */
  orderDate: string | null;
  /** Datum odeslání nabídky (Praha), jinak založení. */
  quoteDate: string | null;
}

export interface OfferDuePlan {
  /** Odvozený termín (null = lhůta chybí). */
  computed: string | null;
  /** Nový termín k zápisu (null = beze změny). */
  set: string | null;
  base: "order" | "quote" | null;
  /** Termín zakázky je odvozený z nabídky (prázdný / shodný s posledním odvozeným). */
  derived: boolean;
}

export function planOfferDueDate(i: OfferDueInput): OfferDuePlan {
  const lead = Number(i.leadDays);
  const hasLead = i.leadDays != null && Number.isFinite(lead) && lead > 0 && lead < 3 * 365;
  const orderBase = parseYmd(i.orderDate) ? i.orderDate! : null;
  const quoteBase = parseYmd(i.quoteDate) ? i.quoteDate! : null;
  const base = orderBase ?? quoteBase;
  const computed = hasLead && base ? addLeadTime(base, { days: Math.round(lead), unit: "kalendarni" }) || null : null;
  const derived = !i.jobDueDate || (i.previous?.dueDate != null && i.previous.dueDate === i.jobDueDate);
  const closed = CLOSED_STAGES.includes(i.stage as JobStage) || DELIVERED_STAGES.includes(i.stage as JobStage);
  const set = computed && derived && !closed && computed !== i.jobDueDate ? computed : null;
  return { computed, set, base: orderBase ? "order" : quoteBase ? "quote" : null, derived };
}

/** Zakázky, do kterých se nabídka nepropisuje (vedle vyfakturované a sloučené). */
export const OFFER_SYNC_FROZEN_STAGES: JobStage[] = ["dokonceno", "zruseno"];

// ── Historie ──────────────────────────────────────────────────
function count(n: number, one: string, few: string, many: string): string {
  return `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;
}

/** „Z nabídky NAB-2026-011 doplněno: 8 položek, hodnota 96 100 Kč, termín dodání 4. 12. 2026" */
export function offerSyncMessage(p: {
  number: string | null;
  fromScratch: boolean;
  created: number;
  pricesUpdated: number;
  purchaseFilled: number;
  value: number | null;
  valueChanged: boolean;
  currency?: string;
  dueDate: string | null;
  dueBase?: "order" | "quote" | null;
}): string {
  const parts: string[] = [];
  if (p.created) parts.push(p.fromScratch ? count(p.created, "položka", "položky", "položek") : `${p.created === 1 ? "přidána" : p.created <= 4 ? "přidány" : "přidáno"} ${count(p.created, "položka", "položky", "položek")}`);
  if (p.pricesUpdated) parts.push(`ceny ${p.pricesUpdated === 1 ? "1 položky" : `${p.pricesUpdated} položek`}`);
  if (p.purchaseFilled) parts.push(`nákupní ceny ${p.purchaseFilled === 1 ? "1 položky" : `${p.purchaseFilled} položek`}`);
  if (p.valueChanged && p.value !== null) parts.push(`hodnota ${formatKc(p.value, p.currency ?? "CZK")}`);
  if (p.dueDate) parts.push(`termín dodání ${czDate(p.dueDate)}${p.dueBase === "order" ? " (od data objednávky)" : ""}`);
  const label = p.number ? `Z nabídky ${p.number}` : "Z nabídky";
  return `${label} ${p.fromScratch ? "doplněno" : "srovnáno"}: ${parts.join(", ") || "beze změny"}`;
}
