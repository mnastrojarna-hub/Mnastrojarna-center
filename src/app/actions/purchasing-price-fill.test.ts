import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Doplnění nákupních cen u objednávky (updatePurchaseOrder, patch.prices): nejdřív ceny položek, až potom
 * hlavička s „celkem" — chyba uprostřed nesmí nechat „celkem" jiné než součet položek v DB.
 * Falešná DB zaznamenává pořadí zápisů; přihlášení a načtení objednávky jsou mocky.
 */

type Call = { table: string; op: "update" | "select"; row?: Record<string, unknown>; filters: [string, unknown][] };
const state = vi.hoisted(() => ({
  calls: [] as Call[],
  /** Vrátí chybu pro daný zápis (null = projde). */
  failWhen: null as null | ((c: Call) => string | null),
  /** Položky „v DB" (po zápisech cen). */
  items: [] as { id: string; quantity: number; unit_price: number | null }[],
}));

function builder(table: string) {
  const call: Call = { table, op: "select", filters: [] };
  const resolve = () => {
    if (call.op === "update") {
      const err = state.failWhen?.(call) ?? null;
      if (!err && table === "purchase_order_items" && call.row && "unit_price" in call.row) {
        const id = call.filters.find(([k]) => k === "id")?.[1];
        const it = state.items.find((x) => x.id === id);
        if (it) it.unit_price = call.row.unit_price as number | null;
      }
      return { data: null, error: err ? { message: err } : null };
    }
    if (table === "purchase_order_items") return { data: state.items.map((x) => ({ ...x })), error: null };
    return { data: null, error: null };
  };
  const b: Record<string, unknown> = {
    update(row: Record<string, unknown>) { call.op = "update"; call.row = row; state.calls.push(call); return b; },
    select() { if (call.op !== "update") { call.op = "select"; state.calls.push(call); } return b; },
    eq(k: string, v: unknown) { call.filters.push([k, v]); return b; },
    in() { return b; },
    maybeSingle() { return Promise.resolve(resolve()); },
    single() { return Promise.resolve(resolve()); },
    then(onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) { return Promise.resolve(resolve()).then(onOk, onErr); },
  };
  return b;
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  isSupabaseConfigured: () => true,
  createOperatorClient: async () => ({ from: (t: string) => builder(t), rpc: async () => ({ data: null, error: null }) }),
  createAdminClient: () => ({ from: (t: string) => builder(t) }),
  hasServiceKey: () => true,
}));
vi.mock("@/lib/auth/session", () => ({
  checkFeature: async () => ({ user: { id: "11111111-1111-4111-8111-111111111111", fullName: "Petr Obchodník", role: "obchodnik" } }),
  getAccess: async () => ({ can: () => true }),
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/jobs/events", async (orig) => ({ ...(await orig<typeof import("@/lib/jobs/events")>()), logJobEvent: vi.fn(async () => undefined) }));

const PO = "22222222-2222-4222-8222-222222222222";
const I1 = "33333333-3333-4333-8333-333333333333";
const I2 = "44444444-4444-4444-8444-444444444444";

vi.mock("@/lib/data/purchasing", async (orig) => ({
  ...(await orig<typeof import("@/lib/data/purchasing")>()),
  fetchPurchaseOrder: async () => ({
    id: PO, jobId: "55555555-5555-4555-8555-555555555555", number: "OV-2026-012", status: "odeslana", orderDate: "2026-10-20",
    requiredDate: "2026-11-20", confirmedDate: null, sentAt: "2026-10-21T10:00:00Z", fileId: null, currency: "CZK",
    supplier: { id: "s1", name: "Frézy Novák s.r.o." },
    items: [
      { id: I1, position: 0, drawingNumber: "PR-1", name: "Příruba", quantity: 200, unit: "ks", unitPrice: null },
      { id: I2, position: 1, drawingNumber: "PR-2", name: "Pouzdro", quantity: 100, unit: "ks", unitPrice: null },
    ],
  }),
}));

describe("updatePurchaseOrder — doplnění cen: položky před hlavičkou", () => {
  beforeEach(() => {
    state.calls = [];
    state.failWhen = null;
    state.items = [{ id: I1, quantity: 200, unit_price: null }, { id: I2, quantity: 100, unit_price: null }];
  });

  const writes = () => state.calls.filter((c) => c.op === "update").map((c) => `${c.table}:${JSON.stringify(c.row)}`);

  it("chyba u druhé položky → hlavička dostane součet toho, co v DB opravdu je (ne plánované celkem)", async () => {
    state.failWhen = (c) => (c.table === "purchase_order_items" && c.filters.some(([k, v]) => k === "id" && v === I2) ? "síť" : null);
    const { updatePurchaseOrder } = await import("@/app/actions/purchasing");
    const r = await updatePurchaseOrder(PO, { prices: [{ itemId: I1, unitPrice: 40 }, { itemId: I2, unitPrice: 42 }] });
    expect(r.ok).toBe(false);
    const w = writes();
    expect(w[0]).toBe(`purchase_order_items:${JSON.stringify({ unit_price: 40 })}`);
    expect(w[1]).toBe(`purchase_order_items:${JSON.stringify({ unit_price: 42 })}`);
    // plánované celkem 12 200 se nezapsalo; zapsal se skutečný součet položek (jen první má cenu)
    expect(w.some((x) => x.includes("12200"))).toBe(false);
    expect(w[w.length - 1]).toBe(`purchase_orders:${JSON.stringify({ total: 8000 })}`);
  });

  it("chyba hlavičky po zápisu cen → celkem srovnané podle položek", async () => {
    let headerFails = true;
    state.failWhen = (c) => {
      if (c.table === "purchase_orders" && headerFails && c.row && "total" in c.row) { headerFails = false; return "zámek"; }
      return null;
    };
    const { updatePurchaseOrder } = await import("@/app/actions/purchasing");
    const r = await updatePurchaseOrder(PO, { prices: [{ itemId: I1, unitPrice: 40 }, { itemId: I2, unitPrice: 42 }] });
    expect(r.ok).toBe(false);
    const w = writes();
    // pořadí: obě položky → hlavička (selhala) → srovnání celkem podle DB
    expect(w.slice(0, 2).every((x) => x.startsWith("purchase_order_items:"))).toBe(true);
    expect(w[2]).toBe(`purchase_orders:${JSON.stringify({ total: 12200 })}`);
    expect(w[3]).toBe(`purchase_orders:${JSON.stringify({ total: 12200 })}`);
    expect(state.items.map((i) => i.unit_price)).toEqual([40, 42]);
  });

  it("bez chyby: ceny položek se zapíšou dřív než celkem", async () => {
    const { updatePurchaseOrder } = await import("@/app/actions/purchasing");
    await updatePurchaseOrder(PO, { prices: [{ itemId: I1, unitPrice: 40 }, { itemId: I2, unitPrice: 42 }] });
    const w = writes();
    const firstHeader = w.findIndex((x) => x.startsWith("purchase_orders:"));
    const lastItem = w.map((x) => x.startsWith("purchase_order_items:")).lastIndexOf(true);
    expect(lastItem).toBeGreaterThanOrEqual(0);
    expect(firstHeader).toBeGreaterThan(lastItem);
  });
});
