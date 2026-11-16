/**
 * Uložená nákupní cena položky zakázky (Marže a nákup, i ručně bez nabídky dodavatele) → do NEODESLANÝCH
 * objednávek dodavatelům, aby z nich neodešla chybějící nebo stará cena (majitel 16. 11.).
 *
 * Pravidla:
 *  • jen objednávky ve stavu Návrh / Vystavena, které ještě neodešly (sent_at prázdné);
 *  • jen řádky navázané na položku zakázky (order_item_id) v kusech;
 *  • jen hlavní krok (výroba / kompletní dodávka) nebo objednávka bez kroku — kooperace (kalení, povrch…)
 *    má vlastní cenu dodavatele;
 *  • řádek se přepíše, jen když je bez ceny, nebo má pořád předchozí uloženou nákupní cenu (= byla převzatá
 *    odsud). Cena, kterou dal dodavatel v nabídce (jiná), zůstane.
 * Po změně se srovná „celkem" objednávky a přegeneruje její PDF (pokud už existuje).
 */
import type { JobsDb } from "@/lib/jobs/events";

export interface ItemPriceChange { orderItemId: string; before: number | null; after: number | null }

const MAIN_KINDS = new Set(["vyroba", "kompletni_dodavka"]);
const PIECE_RE = /^(ks|kus[uy]?|pcs?)?$/i;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const same = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) < 0.005);

/** Čisté rozhodnutí pro jeden řádek objednávky: nová cena, nebo undefined = beze změny. */
export function nextPoLinePrice(line: { unitPrice: number | null; unit: string | null }, change: ItemPriceChange): number | null | undefined {
  if (!PIECE_RE.test((line.unit ?? "").trim())) return undefined;
  if (change.after === null || change.after <= 0) return undefined; // smazání ceny položky nic nemaže v objednávce
  if (same(line.unitPrice, change.after)) return undefined;
  if (line.unitPrice === null || same(line.unitPrice, change.before)) return Math.round(change.after * 100) / 100;
  return undefined;
}

/** Vrátí id objednávek, kterým se změnily ceny (pro přegenerování PDF). */
export async function syncSavedPurchasePrices(db: JobsDb, jobId: string, changes: ItemPriceChange[]): Promise<string[]> {
  const relevant = changes.filter((c) => !same(c.before, c.after));
  if (!relevant.length) return [];
  const byItem = new Map(relevant.map((c) => [c.orderItemId, c]));
  const { data: pos } = await db.from("purchase_orders").select("id, status, sent_at").eq("job_id", jobId);
  const open = ((pos ?? []) as { id: string; status: string; sent_at: string | null }[])
    .filter((p) => (p.status === "navrh" || p.status === "vystavena") && !p.sent_at).map((p) => p.id);
  if (!open.length) return [];
  // krok výroby, ke kterému objednávka patří (kooperace se nepřepisuje)
  const { data: ops } = await db.from("job_operations").select("purchase_order_id, kind").eq("job_id", jobId).in("purchase_order_id", open);
  const nonMain = new Set(((ops ?? []) as { purchase_order_id: string | null; kind: string }[])
    .filter((o) => o.purchase_order_id && !MAIN_KINDS.has(o.kind)).map((o) => o.purchase_order_id as string));
  const target = open.filter((id) => !nonMain.has(id));
  if (!target.length) return [];
  const { data: lines } = await db.from("purchase_order_items")
    .select("id, purchase_order_id, order_item_id, unit, unit_price, quantity").in("purchase_order_id", target);
  const touched = new Set<string>();
  for (const l of (lines ?? []) as { id: string; purchase_order_id: string; order_item_id: string | null; unit: string | null; unit_price: unknown }[]) {
    const ch = l.order_item_id ? byItem.get(l.order_item_id) : undefined;
    if (!ch) continue;
    const next = nextPoLinePrice({ unitPrice: num(l.unit_price), unit: l.unit }, ch);
    if (next === undefined) continue;
    const { error } = await db.from("purchase_order_items").update({ unit_price: next } as never).eq("id", l.id);
    if (!error) touched.add(l.purchase_order_id);
  }
  for (const poId of touched) {
    const { data } = await db.from("purchase_order_items").select("quantity, unit_price").eq("purchase_order_id", poId);
    const total = ((data ?? []) as { quantity: unknown; unit_price: unknown }[])
      .reduce((s, r) => s + (num(r.quantity) ?? 0) * (num(r.unit_price) ?? 0), 0);
    await db.from("purchase_orders").update({ total: Math.round(total * 100) / 100 } as never).eq("id", poId);
  }
  return [...touched];
}
