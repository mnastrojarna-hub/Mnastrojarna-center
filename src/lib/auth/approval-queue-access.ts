import type { ApprovalType } from "@/lib/supabase/database.types";

/**
 * Kdo smí vyřídit kterou položku fronty ke schválení — čistá logika (sdílí server akce a data).
 *
 *  - Super admin (AI přehled, funkce „dashboard") vše.
 *  - 9. 11. „Smí řešit frontu ke schválení" (approval_queue, Šponer): odchozí e-maily, objednávky dodavatelům,
 *    stav zakázky z pošty, kategorizace, párování… — KROMĚ AI návrhu nabídky (typ „quote": schválení nabídky
 *    zůstává super adminovi) a rozdělení faktury dodavatele (typ „supplier_invoice": jen s přístupem k fakturám
 *    dodavatelů).
 *  - Obchodník s právem na marže vyřídí objednávku dodavateli u své zakázky (owner_id = já) — jako dřív.
 */
export type QueueFeature = "dashboard" | "approval_queue" | "margins" | "supplier_invoices";
export type QueueCan = (feature: QueueFeature) => boolean;

/** Typy fronty, které uživatel s approval_queue (ne super admin) nevidí ani nevyřizuje. */
export function hiddenQueueTypes(can: QueueCan): ApprovalType[] {
  if (can("dashboard")) return [];
  const hidden: ApprovalType[] = ["quote"];
  if (!can("supplier_invoices")) hidden.push("supplier_invoice");
  return hidden;
}

/** Vidí uživatel frontu ke schválení (stránka / panel)? */
export function maySeeQueue(can: QueueCan): boolean {
  return can("dashboard") || can("approval_queue");
}

/** Smí uživatel vyřídit (schválit / upravit / zamítnout) tento řádek fronty? */
export function mayResolveQueueRow(
  row: { type: ApprovalType | string; owner_id?: string | null },
  userId: string,
  can: QueueCan,
): boolean {
  if (can("dashboard")) return true;
  if (can("approval_queue") && !hiddenQueueTypes(can).includes(row.type as ApprovalType)) return true;
  return row.type === "purchase_order" && can("margins") && Boolean(row.owner_id) && row.owner_id === userId;
}
