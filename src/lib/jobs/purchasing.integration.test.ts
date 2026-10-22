import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  PURCHASE_ORDER_LIST_SELECT, PURCHASE_ORDER_SELECT, SUPPLIER_QUOTE_SELECT, purchasingTotals,
  rowToCommissionView, rowToPurchaseOrderListItem, rowToPurchaseOrderView, rowToSupplierQuoteView,
  type CommissionDbRow, type PurchaseOrderDbRow, type SupplierQuoteDbRow,
} from "./purchasing";

/**
 * Integrace s lokálním Supabase (tools/local-supabase): DB trigger přepočítá provizi
 * při změně objednávek vydaných, sazby i obchodníka. Spuštění:
 *   LOCAL_SUPABASE=1 npx vitest run src/lib/jobs/purchasing.integration.test.ts
 * Pracuje s demo zakázkou Z-2026-105 a po sobě vše uklidí.
 */

const ENABLED = process.env.LOCAL_SUPABASE === "1";
const JOB = "d0000000-0000-0000-0000-000000000005"; // Z-2026-105, potvrzeno, 58 200 Kč, odhad nákupu 37 400 Kč
const SUPPLIER = "d4000000-0000-0000-0000-000000000001"; // Kovoobrábění Hrubý s.r.o.
const TAG = `TEST-${Date.now()}`;

function loadEnv(): Record<string, string> {
  const file = path.resolve(process.cwd(), ".local-supabase/env");
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

describe.skipIf(!ENABLED)("nákup zakázky ↔ lokální Supabase (provize v DB)", () => {
  let db: SupabaseClient;
  let ownerId: string;
  let ownerRate: number;
  let value: number;
  let plannedCost: number;
  const poIds: string[] = [];
  const quoteIds: string[] = [];
  const ruleIds: string[] = [];

  async function commission(): Promise<CommissionDbRow> {
    const { data, error } = await db.from("commission_entries").select("*").eq("order_id", JOB).single();
    if (error) throw new Error(error.message);
    return data as CommissionDbRow;
  }

  async function insertPo(total: number, status = "vystavena"): Promise<string> {
    const { data, error } = await db
      .from("purchase_orders")
      .insert({ job_id: JOB, supplier_id: SUPPLIER, number: `OV-${TAG}-${poIds.length + 1}`, status, total })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    poIds.push(data.id);
    return data.id as string;
  }

  beforeAll(async () => {
    const env = loadEnv();
    const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321";
    const key = env.SUPABASE_SECRET_KEY;
    if (!key) throw new Error("Chybí SUPABASE_SECRET_KEY v .local-supabase/env — spusť tools/local-supabase/start.sh");
    db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db
      .from("orders")
      .select("id, value, purchase_cost, owner_id, owner:profiles!owner_id(commission_rate)")
      .eq("id", JOB)
      .single();
    if (error) throw new Error(error.message);
    const row = data as unknown as { value: string; purchase_cost: string; owner_id: string; owner: { commission_rate: string } };
    ownerId = row.owner_id;
    ownerRate = Number(row.owner.commission_rate);
    value = Number(row.value);
    plannedCost = Number(row.purchase_cost);
    expect(value).toBeGreaterThan(0);
    expect(ownerRate).toBeGreaterThan(0);
  });

  afterAll(async () => {
    if (!db) return;
    if (ruleIds.length) await db.from("commission_rules").delete().in("id", ruleIds);
    if (poIds.length) await db.from("purchase_orders").delete().in("id", poIds);
    if (quoteIds.length) await db.from("supplier_quotes").delete().in("id", quoteIds);
    if (ownerId) await db.from("orders").update({ owner_id: ownerId }).eq("id", JOB);
  });

  it("výchozí stav: provize z odhadu nákupu", async () => {
    const c = await commission();
    expect(Number(c.cost)).toBe(plannedCost);
    expect(Number(c.profit)).toBe(value - plannedCost);
    expect(Number(c.commission)).toBeCloseTo((value - plannedCost) * ownerRate, 2);
    expect(c.cost_known).toBe(true);
  });

  it("číslo objednávky z RPC (počítadlo se pak vrátí)", async () => {
    const { data: before } = await db.from("doc_counters").select("doc_type, year, counter").eq("doc_type", "OV").maybeSingle();
    try {
      const { data, error } = await db.rpc("next_purchase_order_number");
      expect(error).toBeNull();
      expect(String(data)).toMatch(/^OV-\d{4}-\d{3,}$/);
    } finally {
      if (before) await db.from("doc_counters").update({ year: before.year, counter: before.counter }).eq("doc_type", "OV");
      else await db.from("doc_counters").delete().eq("doc_type", "OV");
    }
  });

  it("nabídka dodavatele se čte přes SUPPLIER_QUOTE_SELECT", async () => {
    const { data, error } = await db
      .from("supplier_quotes")
      .insert({ job_id: JOB, supplier_id: SUPPLIER, number: `NAB-${TAG}`, total: 39_500, delivery_date: "2026-11-20" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    quoteIds.push(data.id);
    const { error: itErr } = await db.from("supplier_quote_items").insert([
      { supplier_quote_id: data.id, position: 1, drawing_number: "VK-B", quantity: 2, unit_price: 250 },
      { supplier_quote_id: data.id, position: 0, drawing_number: "VK-A", quantity: 10, unit_price: 3900 },
    ]);
    expect(itErr).toBeNull();

    const { data: row, error: selErr } = await db.from("supplier_quotes").select(SUPPLIER_QUOTE_SELECT).eq("id", data.id).single();
    if (selErr) throw new Error(selErr.message);
    const v = rowToSupplierQuoteView(row as unknown as SupplierQuoteDbRow);
    expect(v.supplier?.name).toBe("Kovoobrábění Hrubý s.r.o.");
    expect(v.supplierName).toBe("Kovoobrábění Hrubý s.r.o.");
    expect(v.total).toBe(39_500);
    expect(v.items.map((i) => i.drawingNumber)).toEqual(["VK-A", "VK-B"]);
    expect(v.items[0]).toMatchObject({ quantity: 10, unitPrice: 3900 });

    // jen jedna vítězná nabídka na zakázku
    await db.from("supplier_quotes").update({ selected: true }).eq("id", data.id);
    const { data: q2 } = await db
      .from("supplier_quotes")
      .insert({ job_id: JOB, supplier_name: "Konkurent", number: `NAB-${TAG}-2`, selected: false })
      .select("id")
      .single();
    quoteIds.push(q2!.id);
    const { error: dupErr } = await db.from("supplier_quotes").update({ selected: true }).eq("id", q2!.id);
    expect(dupErr?.message ?? "").toMatch(/duplicate key|unique/i);
  });

  it("objednávka vydaná → provize ze skutečného nákupu (trigger)", async () => {
    const id = await insertPo(40_000);
    await db.from("purchase_order_items").insert({ purchase_order_id: id, position: 0, drawing_number: "VK-A", quantity: 10, unit_price: 4000 });
    const c = await commission();
    expect(Number(c.cost)).toBe(40_000);
    expect(Number(c.profit)).toBe(value - 40_000);
    expect(Number(c.commission)).toBeCloseTo((value - 40_000) * ownerRate, 2);
    expect(Number(c.margin)).toBeCloseTo(Math.round(((value - 40_000) / value) * 10_000) / 10_000, 4);

    // čistá logika (panel marže v UI) dává stejný výsledek jako DB
    const { data: rows } = await db.from("purchase_orders").select(PURCHASE_ORDER_SELECT).eq("job_id", JOB);
    const pos = ((rows ?? []) as unknown as PurchaseOrderDbRow[]).map(rowToPurchaseOrderView);
    const t = purchasingTotals({ revenue: value, plannedCost, purchaseOrders: pos });
    expect(t.cost).toBe(Number(c.cost));
    expect(t.profit).toBe(Number(c.profit));
    expect(t.margin).toBeCloseTo(Number(c.margin), 4);
    const view = rowToCommissionView(c, "Obchodník");
    expect(view.commission).toBeCloseTo(t.profit! * ownerRate, 2);
    const po = pos.find((p) => p.id === id)!;
    expect(po.supplier?.name).toBe("Kovoobrábění Hrubý s.r.o.");
    expect(po.items[0]).toMatchObject({ drawingNumber: "VK-A", quantity: 10, unitPrice: 4000 });
  });

  it("víc objednávek se sčítá, zrušená se nepočítá", async () => {
    const second = await insertPo(5_000);
    expect(Number((await commission()).cost)).toBe(45_000);
    await db.from("purchase_orders").update({ status: "zrusena" }).eq("id", poIds[0]);
    expect(Number((await commission()).cost)).toBe(5_000);
    await db.from("purchase_orders").update({ total: 7_500 }).eq("id", second);
    const c = await commission();
    expect(Number(c.cost)).toBe(7_500);
    expect(Number(c.commission)).toBeCloseTo((value - 7_500) * ownerRate, 2);
  });

  it("přehled objednávek: PURCHASE_ORDER_LIST_SELECT se zakázkou a zákazníkem", async () => {
    const { data, error } = await db.from("purchase_orders").select(PURCHASE_ORDER_LIST_SELECT).in("id", poIds);
    if (error) throw new Error(error.message);
    const list = ((data ?? []) as unknown as PurchaseOrderDbRow[]).map(rowToPurchaseOrderListItem);
    expect(list).toHaveLength(2);
    expect(list[0].job?.number).toBe("Z-2026-105");
    expect(list[0].customer?.name).toBeTruthy();
  });

  it("smlouva obchodníka (commission_rules) má přednost před sazbou z profilu", async () => {
    const { data, error } = await db
      .from("commission_rules")
      .insert({ owner_id: ownerId, rate: 0.2, base: "margin", valid_from: "2000-01-01", note: TAG })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    ruleIds.push(data.id);
    const c = await commission();
    expect(Number(c.rate)).toBe(0.2);
    expect(Number(c.commission)).toBeCloseTo(Number(c.profit) * 0.2, 2);

    await db.from("commission_rules").update({ base: "revenue", rate: 0.01 }).eq("id", data.id);
    const r = await commission();
    expect(r.base).toBe("revenue");
    expect(Number(r.commission)).toBeCloseTo(value * 0.01, 2);

    await db.from("commission_rules").delete().eq("id", data.id);
    ruleIds.length = 0;
    expect(Number((await commission()).rate)).toBe(ownerRate);
  });

  it("přidělení obchodníka přepočte provizi (jiná sazba)", async () => {
    const { data: admin } = await db.from("profiles").select("id, commission_rate").eq("role", "super_admin").limit(1).single();
    await db.from("orders").update({ owner_id: admin!.id }).eq("id", JOB);
    const c = await commission();
    expect(c.owner_id).toBe(admin!.id);
    expect(Number(c.commission)).toBeCloseTo(Number(c.profit) * Number(admin!.commission_rate), 2);
    await db.from("orders").update({ owner_id: ownerId }).eq("id", JOB);
    expect((await commission()).owner_id).toBe(ownerId);
  });

  it("smazání objednávek vrátí provizi na odhad nákupu", async () => {
    await db.from("purchase_orders").delete().in("id", poIds);
    poIds.length = 0;
    const c = await commission();
    expect(Number(c.cost)).toBe(plannedCost);
    expect(Number(c.commission)).toBeCloseTo((value - plannedCost) * ownerRate, 2);
  });
});
