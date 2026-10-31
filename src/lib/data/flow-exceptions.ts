import "server-only";
import { cache } from "react";
import type { JobsDb } from "@/lib/jobs/events";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAccess } from "@/lib/auth/session";
import { AWAITING_PO_REMIND_DAYS, dayDiff, pragueDay, pragueToday } from "@/lib/jobs/flow-status";
import type { DrawingChangeAffects, DrawingChangeView, PersonRef } from "@/lib/jobs/types";

/**
 * Data výjimek v toku pro kartu zakázky: změny revize výkresu (banner „Nová revize výkresu") a čeho se
 * týkají (otevřené objednávky / poptávky u dodavatelů) — dva lehké dotazy jen u zakázky se změnou.
 */

type Row = Record<string, unknown>;
const PERSON = "id, full_name, email";

function person(v: unknown): PersonRef | null {
  const p = (Array.isArray(v) ? v[0] : v) as { id?: string; full_name?: string | null; email?: string | null } | null | undefined;
  if (!p?.id) return null;
  return { id: p.id, name: (p.full_name ?? "").trim() || (p.email ?? "").trim() || "—" };
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

export async function loadDrawingChanges(
  db: JobsDb, jobId: string, opts: { margins: boolean },
): Promise<{ changes: DrawingChangeView[]; affects: DrawingChangeAffects } | null> {
  const { data, error } = await db.from("job_drawing_changes")
    .select(`id, order_item_id, drawing_number, rev_from, rev_to, file_id, note, created_at, created_via, acknowledged_at, creator:profiles!created_by(${PERSON}), acker:profiles!acknowledged_by(${PERSON})`)
    .eq("job_id", jobId).order("created_at", { ascending: false }).limit(20);
  if (error) {
    console.error(`[data:flow-exceptions] Změny výkresů: ${error.message}`);
    return null;
  }
  const changes: DrawingChangeView[] = ((data ?? []) as Row[]).map((r) => ({
    id: String(r.id),
    itemId: text(r.order_item_id),
    drawingNumber: text(r.drawing_number),
    revFrom: text(r.rev_from),
    revTo: text(r.rev_to),
    fileId: text(r.file_id),
    note: text(r.note),
    createdAt: String(r.created_at),
    createdBy: person(r.creator),
    via: text(r.created_via),
    acknowledgedAt: text(r.acknowledged_at),
    acknowledgedBy: person(r.acker),
  }));
  const affects: DrawingChangeAffects = { purchaseOrders: [], pendingSupplierQuotes: 0 };
  if (!changes.some((c) => !c.acknowledgedAt) || !opts.margins) return { changes, affects };
  const [pos, sq] = await Promise.all([
    db.from("purchase_orders")
      .select("id, number, status, drawing_changed_at, supplier:suppliers!supplier_id(name, email), items:purchase_order_items!purchase_order_id(order_item_id)")
      .eq("job_id", jobId).in("status", ["navrh", "vystavena", "odeslana", "potvrzena"]),
    db.from("supplier_quotes").select("id, total").eq("job_id", jobId),
  ]);
  if (pos.error) console.error(`[data:flow-exceptions] Objednávky: ${pos.error.message}`);
  affects.purchaseOrders = ((pos.data ?? []) as Row[]).map((p) => {
    const s = (Array.isArray(p.supplier) ? p.supplier[0] : p.supplier) as { name?: string | null; email?: string | null } | null;
    return {
      id: String(p.id), number: String(p.number ?? ""), status: String(p.status ?? ""),
      supplier: text(s?.name), supplierEmail: text(s?.email),
      itemIds: ((p.items ?? []) as { order_item_id: string | null }[]).map((i) => i.order_item_id).filter((x): x is string => Boolean(x)),
      drawingChangedAt: text(p.drawing_changed_at),
    };
  });
  affects.pendingSupplierQuotes = ((sq.data ?? []) as { total: unknown }[]).filter((x) => x.total === null || x.total === undefined).length;
  return { changes, affects };
}

/** Počty výjimek přes celou knihu (chipy Knihy, přehled): klíč výjimky / „chybi_po" / „duvod.<důvod>". */
export const getFlowExceptionCounts = cache(async (): Promise<Record<string, number>> => {
  const out: Record<string, number> = {};
  if (!isSupabaseConfigured()) return out;
  try {
    const access = await getAccess();
    if (!access.user || !access.user.active || !access.can("orders")) return out;
    const db = await createOperatorClient();
    const { data, error } = await db.from("orders")
      .select("status, awaiting_customer_po, awaiting_po_since, claim_opened_at, claim_resolved_at, drawing_changes_open, corrected_at, lost_reason")
      .is("merged_into_id", null)
      .or("awaiting_customer_po.eq.true,status.in.(reklamace,pozastaveno,nerealizovano,zruseno),drawing_changes_open.gt.0,and(claim_opened_at.not.is.null,claim_resolved_at.is.null),corrected_at.not.is.null")
      .limit(20_000);
    if (error) {
      console.error(`[data:flow-exceptions] Počty: ${error.message}`);
      return out;
    }
    const today = pragueToday();
    const add = (k: string) => { out[k] = (out[k] ?? 0) + 1; };
    for (const r of (data ?? []) as Row[]) {
      const status = String(r.status);
      if (r.awaiting_customer_po === true) {
        add("bez_po");
        const since = pragueDay(text(r.awaiting_po_since));
        if (since && dayDiff(since, today) >= AWAITING_PO_REMIND_DAYS) add("chybi_po");
      }
      if (status === "reklamace" || (r.claim_opened_at && !r.claim_resolved_at)) add("reklamace");
      if (status === "pozastaveno") add("pozastaveno");
      if (Number(r.drawing_changes_open) > 0) add("vykres");
      if (r.corrected_at && !["dokonceno", "nerealizovano", "zruseno"].includes(status)) add("opraveno");
      if (status === "nerealizovano" || status === "zruseno") add(`duvod.${text(r.lost_reason) ?? "neuvedeno"}`);
    }
    return out;
  } catch (err) {
    console.error(`[data:flow-exceptions] ${err instanceof Error ? err.message : String(err)}`);
    return out;
  }
});
