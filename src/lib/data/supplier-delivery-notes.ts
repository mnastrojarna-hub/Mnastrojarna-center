import "server-only";
import { getAccess } from "@/lib/auth/session";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { toDlRows, type RawDlFile, type RawPo, type SupplierDlRow } from "@/lib/supplier-delivery-notes/model";

const SELECT = "id, job_id, filename, title, created_at, issuer, dl_no:ai_extracted->>documentNumber, dl_date:ai_extracted->>documentDate, "
  + "sup_name:ai_extracted->supplier->>name, po_no:ai_extracted->>customerOrderNumber, job:orders!job_id(number, title, customer:customers!customer_id(name))";

/** Všechny dodací listy dodavatelů (dokumenty zakázek „dodací list", které jsme nevystavili my). */
export async function listSupplierDeliveryNotes(): Promise<SupplierDlRow[] | null> {
  if (!isSupabaseConfigured()) return [];
  const access = await getAccess();
  if (!access.user || !access.can("workflow")) return null;
  try {
    const db = await createOperatorClient();
    const { data, error } = await db.from("job_files").select(SELECT)
      .eq("kind", "dodaci_list").eq("archived", false).or("origin.is.null,origin.neq.generated")
      .order("created_at", { ascending: false }).limit(2000);
    if (error) {
      console.error(`[data:supplier-dl] ${error.message}`);
      return null;
    }
    const files = (data ?? []) as unknown as RawDlFile[];
    const jobIds = [...new Set(files.map((f) => f.job_id))];
    let pos: RawPo[] = [];
    let ours: string[] = [];
    if (jobIds.length) {
      const [res, dls] = await Promise.all([
        db.from("purchase_orders").select("id, job_id, number, supplier:suppliers!supplier_id(name)").in("job_id", jobIds.slice(0, 1000)),
        // naše dodací listy (vystavené zákazníkům) — jejich kopie sem nepatří
        db.from("delivery_notes").select("number").in("order_id", jobIds.slice(0, 1000)),
      ]);
      pos = (res.data ?? []) as unknown as RawPo[];
      ours = ((dls.data ?? []) as { number: string | null }[]).map((d) => d.number ?? "").filter(Boolean);
    }
    return toDlRows(files, pos, ours);
  } catch (err) {
    console.error(`[data:supplier-dl] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
