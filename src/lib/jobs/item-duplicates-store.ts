import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { findDuplicateItems, type DuplicateItem, type DuplicatePair } from "@/lib/jobs/item-pairing";

/**
 * Sloučení duplicitních položek zakázky (Položky → „Vypadá to na duplicitní položky — Sloučit").
 * Majitel 30. 10. (Z-2026-022): objednávka bez čísel výkresů se k zakázce přidala jako nové položky.
 * Server dvojice znovu ověří (findDuplicateItems nad daty z DB), ponechá „bohatší" položku (číslo
 * výkresu, revize, materiál, vazby), přesune na ni všechny odkazy duplicity (objednávky dodavatelům,
 * výrobní kroky, dodací listy, faktury dodavatelů, dokumenty, změny z pošty), doplní jí prázdné
 * údaje, duplicitu smaže a zapíše to do historie zakázky (autor = přihlášený uživatel).
 */

type Row = Record<string, unknown>;

const ITEM_COLS = [
  "id", "position", "drawing_id", "description", "quantity", "unit_price", "drawing_number", "revision", "name", "material",
  "unit", "purchase_unit_price", "note", "delivered_quantity", "material_group", "material_designation", "weight_kg",
  "blank_weight_kg", "blank_dims", "blank_shape", "heat_treatment", "surface_treatment", "hardness", "drawing_notes",
  "weight_source", "material_condition", "heat_status", "surface_status", "heat_steps", "surface_steps", "spec_sources",
  "tech_procedure", "tech_complete", "tech_complete_by", "supplier_note",
].join(", ");

/** Údaje, které se ponechané položce doplní z duplicity, jen když je nemá. */
const FILL_COLS = [
  "drawing_id", "description", "drawing_number", "revision", "name", "material", "unit_price", "purchase_unit_price",
  "material_group", "material_designation", "weight_kg", "blank_weight_kg", "blank_dims", "blank_shape", "heat_treatment",
  "surface_treatment", "hardness", "drawing_notes", "weight_source", "material_condition", "heat_status", "surface_status",
  "heat_steps", "surface_steps", "spec_sources", "tech_procedure", "supplier_note",
];

/** Tabulky s odkazem na položku zakázky (FK order_items, ON DELETE SET NULL → nejdřív přesunout). */
const REF_TABLES: { table: string; column: string }[] = [
  { table: "purchase_order_items", column: "order_item_id" },
  { table: "delivery_note_items", column: "order_item_id" },
  { table: "supplier_invoice_allocations", column: "order_item_id" },
  { table: "job_files", column: "order_item_id" },
  { table: "job_mail_changes", column: "order_item_id" },
];

function empty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (typeof v === "number") return v === 0;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function toDup(r: Row, links: number): DuplicateItem {
  return {
    id: String(r.id), position: Number(r.position) || 0,
    drawingNumber: (r.drawing_number as string | null) ?? null, revision: (r.revision as string | null) ?? null,
    name: (r.name as string | null) ?? null, description: (r.description as string | null) ?? null,
    material: (r.material as string | null) ?? null, quantity: num(r.quantity), unitPrice: num(r.unit_price),
    links: links + (r.drawing_id ? 1 : 0) + (r.tech_procedure || r.tech_complete ? 1 : 0),
  };
}

function itemLabel(r: Row): string {
  return [`${(Number(r.position) || 0) + 1}`, r.drawing_number, r.revision ? `rev. ${r.revision}` : "", r.name].filter(Boolean).join(" ");
}

async function loadJobItems(db: JobsDb, jobId: string): Promise<{ rows: Row[]; links: Map<string, number> }> {
  const { data, error } = await db.from("order_items").select(ITEM_COLS).eq("order_id", jobId).order("position");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];
  const ids = rows.map((r) => String(r.id));
  const links = new Map<string, number>();
  if (!ids.length) return { rows, links };
  const add = (id: unknown, n = 1) => { if (typeof id === "string") links.set(id, (links.get(id) ?? 0) + n); };
  for (const t of REF_TABLES) {
    const { data: refs } = await db.from(t.table).select(t.column).in(t.column, ids);
    for (const r of (refs ?? []) as Row[]) add(r[t.column]);
  }
  const { data: ops } = await db.from("job_operations").select("order_item_ids").eq("job_id", jobId);
  for (const o of (ops ?? []) as { order_item_ids: string[] | null }[]) for (const id of o.order_item_ids ?? []) add(id);
  return { rows, links };
}

/** Pravděpodobné duplicity v položkách zakázky podle dat v DB (pro kontrolu na serveru i testy). */
export async function detectDuplicateItems(db: JobsDb, jobId: string): Promise<DuplicatePair[]> {
  const { data: job } = await db.from("orders").select("value").eq("id", jobId).maybeSingle();
  const { rows, links } = await loadJobItems(db, jobId);
  return findDuplicateItems(rows.map((r) => toDup(r, links.get(String(r.id)) ?? 0)), { orderTotal: num((job as Row | null)?.value) });
}

export type MergeDuplicatesResult =
  | { ok: true; merged: { keepId: string; dropId: string; label: string }[]; value: number | null }
  | { ok: false; error: string };

export async function mergeDuplicateItemsCore(
  db: JobsDb,
  jobId: string,
  requested: { keepId: string; dropId: string }[],
  actorId: string | null,
): Promise<MergeDuplicatesResult> {
  const { data: job } = await db.from("orders").select("id, value").eq("id", jobId).maybeSingle();
  if (!job) return { ok: false, error: "Zakázka nenalezena." };
  const { rows, links } = await loadJobItems(db, jobId);
  const found = findDuplicateItems(rows.map((r) => toDup(r, links.get(String(r.id)) ?? 0)), { orderTotal: num((job as Row).value) });
  const same = (a: { keepId: string; dropId: string }, b: { keepId: string; dropId: string }) =>
    (a.keepId === b.keepId && a.dropId === b.dropId) || (a.keepId === b.dropId && a.dropId === b.keepId);
  const todo = found.filter((f) => requested.some((r) => same(r, f)));
  if (!todo.length) return { ok: false, error: "Položky už nevypadají jako duplicitní (někdo je mezitím upravil) — obnov stránku." };

  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const merged: { keepId: string; dropId: string; label: string }[] = [];
  for (const p of todo) {
    const keep = byId.get(p.keepId)!;
    const drop = byId.get(p.dropId)!;
    // 1) ponechané položce doplnit, co nemá (nic nepřepisovat)
    const patch: Row = {};
    for (const col of FILL_COLS) if (empty(keep[col]) && !empty(drop[col])) patch[col] = drop[col];
    if (!keep.tech_complete && drop.tech_complete) {
      patch.tech_complete = true;
      patch.tech_complete_by = drop.tech_complete_by ?? null;
    }
    if (!(Number(keep.delivered_quantity) > 0) && Number(drop.delivered_quantity) > 0) patch.delivered_quantity = drop.delivered_quantity;
    const keepNote = String(keep.note ?? "").trim();
    const extra = [
      drop.description && drop.description !== keep.description && !patch.description ? `Řádek objednávky: ${String(drop.description).trim()}` : "",
      String(drop.note ?? "").trim(),
    ].filter((x) => x && !keepNote.includes(x));
    if (extra.length) patch.note = [keepNote, ...extra].filter(Boolean).join("\n").slice(0, 2000);
    if (Object.keys(patch).length) {
      const { error } = await db.from("order_items").update(patch as never).eq("id", p.keepId).eq("order_id", jobId);
      if (error) return { ok: false, error: error.message };
    }
    // 2) odkazy duplicity → ponechaná položka
    for (const t of REF_TABLES) {
      const { error } = await db.from(t.table).update({ [t.column]: p.keepId } as never).eq(t.column, p.dropId);
      if (error) return { ok: false, error: `${t.table}: ${error.message}` };
    }
    const { data: ops } = await db.from("job_operations").select("id, order_item_ids").eq("job_id", jobId).contains("order_item_ids", [p.dropId]);
    for (const o of (ops ?? []) as { id: string; order_item_ids: string[] }[]) {
      const next = [...new Set(o.order_item_ids.map((id) => (id === p.dropId ? p.keepId : id)))];
      const { error } = await db.from("job_operations").update({ order_item_ids: next } as never).eq("id", o.id);
      if (error) return { ok: false, error: `job_operations: ${error.message}` };
    }
    // 3) duplicitu smazat
    const { error: delErr } = await db.from("order_items").delete().eq("id", p.dropId).eq("order_id", jobId);
    if (delErr) return { ok: false, error: delErr.message };
    merged.push({ keepId: p.keepId, dropId: p.dropId, label: `${itemLabel(keep)} ← ${String(drop.name ?? drop.description ?? "položka")}` });
  }

  // hodnota zakázky = součet položek (jako ruční úprava položek), když mají všechny cenu
  let value: number | null = null;
  const { data: rest } = await db.from("order_items").select("quantity, unit_price").eq("order_id", jobId);
  const list = (rest ?? []) as Row[];
  if (list.length && list.every((r) => Number(r.unit_price) > 0)) {
    value = Math.round(list.reduce((s, r) => s + (Number(r.quantity) || 0) * Number(r.unit_price), 0) * 100) / 100;
    await db.from("orders").update({ value } as never).eq("id", jobId);
  }
  await logJobEvent(db, {
    jobId, type: "field",
    message: `Sloučeny duplicitní položky (${merged.length}): ${merged.map((m) => m.label).join("; ")}`.slice(0, 500),
    data: { mergedItems: merged, reasons: todo.map((t) => t.reason), ...(value !== null ? { value } : {}) },
    actorId, entity: "job",
  });
  return { ok: true, merged, value };
}
