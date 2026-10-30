import "server-only";
import type { JobsDb } from "@/lib/jobs/events";
import { round3 } from "@/lib/jobs/delivery-notes";

/**
 * Lehké čtení dodacích listů (bez PDF knihoven) — sdílí karta zakázky (getJob) i vystavení DL.
 *
 * Kolik z každé položky už pokrývají vystavené dodací listy (součet řádků DL navázaných na položku).
 * null = některý vystavený DL má řádek bez vazby na položku (starší data) — pak nejde poznat, co je
 * dodané bez DL, a nic se nedopočítává. exclude = DL, který se právě vystavuje (opakování).
 */
export async function documentedQuantities(db: JobsDb, jobId: string, opts: { exclude?: string } = {}): Promise<Map<string, number> | null> {
  const { data: notes, error } = await db.from("delivery_notes").select("id")
    .eq("order_id", jobId).like("storage_path", "zakazky/%");
  if (error) throw new Error(error.message);
  const ids = ((notes ?? []) as { id: string }[]).map((n) => n.id).filter((id) => id !== opts.exclude);
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const { data, error: itemsErr } = await db.from("delivery_note_items").select("order_item_id, quantity").in("delivery_note_id", ids);
  if (itemsErr) throw new Error(itemsErr.message);
  for (const r of (data ?? []) as { order_item_id: string | null; quantity: number | string }[]) {
    if (!r.order_item_id) return null;
    out.set(r.order_item_id, round3((out.get(r.order_item_id) ?? 0) + Number(r.quantity)));
  }
  return out;
}

/**
 * Vystavené dodací listy zakázky pro kartu (čip v hlavičce, přehled): číslo z delivery_notes (jediný
 * zdroj čísla DL) + id souboru PDF v Dokumentech (null = PDF chybí) — nejnovější první.
 */
export async function issuedNoteRefs(db: JobsDb, jobId: string): Promise<{ id: string | null; number: string; createdAt: string }[]> {
  const { data, error } = await db.from("delivery_notes").select("number, storage_path, created_at")
    .eq("order_id", jobId).like("storage_path", "zakazky/%").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const notes = ((data ?? []) as { number: string | null; storage_path: string; created_at: string }[]).filter((n) => n.number);
  if (!notes.length) return [];
  const { data: files } = await db.from("job_files").select("id, storage_path")
    .eq("job_id", jobId).eq("archived", false).in("storage_path", notes.map((n) => n.storage_path));
  const byPath = new Map(((files ?? []) as { id: string; storage_path: string }[]).map((f) => [f.storage_path, f.id]));
  return notes.map((n) => ({ id: byPath.get(n.storage_path) ?? null, number: n.number!, createdAt: n.created_at }));
}

/**
 * Vyfocený NÁŠ dodací list (focení dokladu, dodané kusy z fotky) → řádek delivery_notes s fotkou místo
 * PDF a řádky navázanými na položky — dodávka pak má svůj DL (žádné druhé „DL na dodané zboží" s jiným
 * číslem) a číslo DL má jediný zdroj. Číslo už v evidenci (náš DL z aplikace, podepsaný a vyfocený) →
 * nic nového. Bez čísla, fotky nebo dodaných kusů → nic.
 */
export async function recordCapturedDeliveryNote(
  db: JobsDb,
  jobId: string,
  opts: {
    number: string | null | undefined;
    storagePath: string | null | undefined;
    issueDate?: string | null;
    lines: { itemId: string; description: string; quantity: number; unit: string }[];
  },
): Promise<"created" | "exists" | "skipped"> {
  const number = (opts.number ?? "").trim().slice(0, 120);
  const lines = opts.lines.filter((l) => l.quantity > 0);
  if (!number || !opts.storagePath || !lines.length) return "skipped";
  const { data: same } = await db.from("delivery_notes").select("id").eq("number", number).maybeSingle();
  if (same) return "exists";
  const { data: job } = await db.from("orders").select("customer_id").eq("id", jobId).maybeSingle();
  const { data: row, error } = await db.from("delivery_notes").insert({
    number, order_id: jobId, customer_id: (job as { customer_id: string | null } | null)?.customer_id ?? null,
    ...(opts.issueDate && /^\d{4}-\d{2}-\d{2}/.test(opts.issueDate) ? { issue_date: opts.issueDate.slice(0, 10) } : {}),
    storage_path: opts.storagePath, note: "Vyfocený dodací list",
  } as never).select("id").single();
  if (error || !row) {
    if (error) console.error(`[delivery-notes] Vyfocený DL ${number} se nezapsal: ${error.message}`);
    return "skipped";
  }
  const id = (row as { id: string }).id;
  const { error: itemsErr } = await db.from("delivery_note_items").insert(lines.map((l, i) => ({
    delivery_note_id: id, description: l.description.slice(0, 500), quantity: round3(l.quantity),
    unit: (l.unit || "ks").slice(0, 20), position: i, order_item_id: l.itemId,
  })) as never);
  if (itemsErr) console.error(`[delivery-notes] Řádky vyfoceného DL ${number} se nezapsaly: ${itemsErr.message}`);
  return "created";
}
