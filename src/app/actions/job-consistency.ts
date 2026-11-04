"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { userActor } from "@/lib/supabase/actor-headers";
import { checkFeature, getAccess } from "@/lib/auth/session";
import type { CurrentUser } from "@/lib/data/current-user";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { cleanNumber, isUuid, translateDbError } from "@/lib/jobs/mapping";
import {
  activePurchaseOrders, invoicedValueBlock, itemsPurchaseValue, itemsSaleValue, orderedCost, type ConsistencyFix,
  type DistributeMode,
} from "@/lib/jobs/consistency";
import { applyJobValueToItems, loadJobMoneyContext } from "@/lib/jobs/consistency-store";
import { newJobQuoteRevision, updateJob, updateJobQuote } from "@/app/actions/jobs";
import type { ActionResult, JobQuoteItemInput } from "@/lib/jobs/types";

/**
 * Křížová konzistence zakázky (majitel 4. 11.): změna hodnoty zakázky rozpočítaná na položky
 * a srovnání nesouladu jedním klikem („Srovnat podle položek / objednávek", nová verze nabídky).
 * Pravidla viz src/lib/jobs/consistency.ts; DB je vynucuje triggery (migrace 20261104120000).
 */

interface Ctx { db: JobsDb; user: CurrentUser; margins: boolean }

const NOT_FOUND = "Zakázka nenalezena.";
const MODES: DistributeMode[] = ["proportional", "per_piece", "unpriced"];
const FIXES: ConsistencyFix[] = ["value_from_items", "cost_from_orders", "cost_from_items", "quote_revision"];

async function begin(): Promise<Ctx | { error: string }> {
  if (!isSupabaseConfigured()) return { error: "Supabase není nakonfigurováno." };
  const access = await checkFeature("orders");
  if ("error" in access) return { error: access.error };
  const { can } = await getAccess();
  const db = await createOperatorClient({ actor: userActor(access.user) });
  return { db, user: access.user, margins: can("margins") };
}

function fail(err: unknown): { ok: false; error: string } {
  if (typeof err === "string") return { ok: false, error: translateDbError(err) };
  return { ok: false, error: err instanceof Error ? translateDbError(err.message) : "Neočekávaná chyba." };
}

function revalidateJob(jobId: string) {
  for (const p of ["/orders", "/inquiries", "/pricing", "/quotes", "/confirmations", "/purchasing", "/commissions", "/"]) revalidatePath(p);
  revalidatePath(`/orders/${jobId}`);
}

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
function rpc(db: JobsDb): Rpc {
  return (fn, args) => (db.rpc as unknown as Rpc).call(db, fn, args);
}

export interface SetJobValueResult {
  /** Hodnota zakázky po uložení (= Σ položek, když mají ceny). */
  value: number | null;
  requested: number | null;
  /** Cílová hodnota šla složit přesně na haléře. */
  exact: boolean;
  /** Počet položek se změněnou cenou. */
  changed: number;
  mode: DistributeMode | null;
  /** „Cena už nebude odpovídat odeslané nabídce…" */
  warning: string;
}

/**
 * Nová hodnota zakázky. Bez cen na položkách = ruční hodnota; s cenami se změna rozpočítá na položky
 * (mode: poměrně / rovnoměrně na kus / na položky bez ceny; bez mode výchozí podle položek).
 * Vyfakturovaná zakázka → odmítnuto.
 */
export async function setJobValue(jobId: string, value: number | null, mode?: DistributeMode): Promise<ActionResult<SetJobValueResult>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  if (mode !== undefined && !MODES.includes(mode)) return fail("Neznámý způsob rozpočítání.");
  const target = value === null ? null : cleanNumber(value);
  if (value !== null && (target === null || target < 0 || target > 1e12)) return fail("Hodnota zakázky musí být kladné číslo.");
  try {
    const ctx = await loadJobMoneyContext(c.db, jobId, { margins: c.margins });
    if (!ctx) return fail(NOT_FOUND);
    const block = invoicedValueBlock(ctx.snapshot);
    if (block) return fail(block);
    const priced = itemsSaleValue(ctx.snapshot.items) !== null;
    if (!priced && mode !== "unpriced") {
      // ruční hodnota (položky bez cen) — běžná úprava pole
      const res = await updateJob(jobId, { value: target });
      if (!res.ok) return fail(res.error ?? "Hodnotu se nepodařilo uložit.");
      return { ok: true, value: target, requested: target, exact: true, changed: 0, mode: null, warning: res.warning ?? "" };
    }
    if (target === null) return fail("Hodnotu zakázky nejde smazat, dokud mají položky ceny — smaž ceny v Položkách.");
    const r = await applyJobValueToItems(c.db, ctx, target, mode ?? null);
    if (!r.ok) return fail(r.error);
    revalidateJob(jobId);
    return { ok: true, value: r.value, requested: r.requested, exact: r.exact, changed: r.changed, mode: r.mode, warning: r.warning ?? "" };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Srovnání nesouladu jedním klikem: hodnota podle položek, nákup podle objednávek / položek,
 * nebo nová verze odeslané nabídky z aktuálních položek.
 */
export async function alignJobConsistency(
  jobId: string, fix: ConsistencyFix, opts: { quoteId?: string } = {},
): Promise<ActionResult<{ message: string; quoteId: string; number: string }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  if (!FIXES.includes(fix)) return fail("Neznámá oprava.");
  try {
    const { db, user, margins } = c;
    const ctx = await loadJobMoneyContext(db, jobId, { margins });
    if (!ctx) return fail(NOT_FOUND);
    const s = ctx.snapshot;
    const block = invoicedValueBlock(s);

    if (fix === "value_from_items") {
      if (block) return fail(block);
      if (itemsSaleValue(s.items) === null) return fail("Žádná položka nemá prodejní cenu — není podle čeho srovnat.");
      const { error } = await rpc(db)("sync_job_value", { p_job: jobId });
      if (error) return fail(error.message);
      revalidateJob(jobId);
      return { ok: true, message: "Hodnota zakázky srovnána se součtem položek." };
    }

    if (fix === "cost_from_orders" || fix === "cost_from_items") {
      if (!margins) return fail("Nákupní náklady upravuje jen obchodník nebo admin.");
      if (block) return fail(block);
      if (fix === "cost_from_orders") {
        if (orderedCost(s.purchaseOrders ?? []) === null) return fail("Zakázka nemá žádnou objednávku dodavateli.");
        const { error } = await rpc(db)("sync_job_purchase_cost", { p_job: jobId });
        if (error) return fail(error.message);
        revalidateJob(jobId);
        return { ok: true, message: "Nákupní náklady srovnány s objednávkami dodavatelům." };
      }
      if (activePurchaseOrders(s.purchaseOrders ?? []).length) {
        return fail("Nákupní náklady se počítají z objednávek dodavatelům — srovnej je podle objednávek.");
      }
      const v = itemsPurchaseValue(s.items);
      if (v === null) return fail("Žádná položka nemá nákupní cenu.");
      const { error } = await db.from("orders").update({ purchase_cost: v } as never).eq("id", jobId);
      if (error) return fail(error.message);
      await logJobEvent(db, {
        jobId, type: "field", message: "Nákupní náklady srovnány podle nákupních cen položek",
        data: { changes: [{ field: "purchase_cost", label: "Nákupní náklady", from: null, to: null, fromText: "", toText: "", sensitive: true }], fix },
        actorId: user.id,
      });
      revalidateJob(jobId);
      return { ok: true, message: "Nákupní náklady srovnány podle nákupních cen položek." };
    }

    // nová verze odeslané nabídky z aktuálních položek zakázky
    const quoteId = opts.quoteId;
    if (!quoteId || !isUuid(quoteId)) return fail("Chybí nabídka.");
    const quote = (s.quotes ?? []).find((q) => q.id === quoteId);
    if (!quote) return fail("Nabídka nepatří k této zakázce.");
    if (quote.accepted || quote.state === "prijata") return fail("Přijatou nabídku nová verze nenahradí — změnu ceny domluv se zákazníkem.");
    const { data: itemsData, error: itErr } = await db.from("order_items")
      .select("drawing_number, name, description, material, quantity, unit, unit_price, purchase_unit_price, note")
      .eq("order_id", jobId).order("position");
    if (itErr) return fail(itErr.message);
    const { data: vatData } = await db.from("quote_items").select("vat_rate").eq("quote_id", quoteId).order("position").limit(1);
    const vat = cleanNumber(((vatData ?? []) as { vat_rate: unknown }[])[0]?.vat_rate) ?? 21;
    const items: JobQuoteItemInput[] = ((itemsData ?? []) as Record<string, unknown>[]).map((r) => ({
      drawingNumber: (r.drawing_number as string | null) ?? undefined,
      name: (r.name as string | null) ?? undefined,
      description: (r.description as string | null) ?? undefined,
      material: (r.material as string | null) ?? undefined,
      quantity: cleanNumber(r.quantity) ?? 1,
      unit: (r.unit as string | null) ?? "ks",
      unitPrice: cleanNumber(r.unit_price),
      vatRate: vat,
      ...(margins ? { purchaseUnitPrice: cleanNumber(r.purchase_unit_price) } : {}),
      note: (r.note as string | null) ?? undefined,
    }));
    if (!items.length) return fail("Zakázka nemá položky — z čeho by byla nová verze?");
    const rev = await newJobQuoteRevision(quoteId);
    if (!rev.ok || !rev.id) return fail(rev.error ?? "Novou verzi nabídky se nepodařilo vytvořit.");
    const up = await updateJobQuote(rev.id, { items });
    if (!up.ok) return fail(up.error ?? "Novou verzi nabídky se nepodařilo naplnit položkami.");
    revalidateJob(jobId);
    return { ok: true, quoteId: rev.id, number: rev.number ?? "", message: `Nová verze nabídky ${rev.number ?? ""} s cenami z položek — zkontroluj ji a pošli zákazníkovi.` };
  } catch (err) {
    return fail(err);
  }
}
