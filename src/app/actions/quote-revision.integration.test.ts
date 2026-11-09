import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Nová verze nabídky bere AKTUÁLNÍ položky zakázky a platnost ode dneška (majitel 5. 11.: „nový doklad už má mít
 * aktuální datum" — odeslaná verze se nemění, ale nová vzniká z aktuálních dat). Spuštění:
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/app/actions/quote-revision.integration.test.ts
 */
const ENABLED = process.env.LOCAL_SUPABASE === "1";
const PREFIX = `Z-E2E-QREV-${Date.now().toString(36)}`;
const CUSTOMER = "d2000000-0000-0000-0000-000000000001"; // Strojmetal a.s.

const who = vi.hoisted(() => ({
  users: {} as Record<string, { id: string; email: string; fullName: string; role: "super_admin" | "obchodnik" | "zamestnanec" }>,
  current: "admin" as "sales" | "admin",
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

vi.mock("@/lib/supabase/server", async () => {
  const local = await import("@/test/local-supabase");
  const headers = await import("@/lib/supabase/actor-headers");
  const current = () => {
    const u = who.users[who.current];
    return headers.userActor(u ? { id: u.id } : null);
  };
  return {
    isSupabaseConfigured: () => true,
    hasServiceKey: () => true,
    createAdminClient: (opts: { actor?: unknown } = {}) => local.localAdmin((opts.actor as never) ?? headers.SYSTEM_ACTOR),
    createOperatorClient: async (opts: { actor?: unknown } = {}) => local.localAdmin(opts.actor !== undefined ? (opts.actor as never) : current()),
    createClient: async () => {
      throw new Error("Bez session (test).");
    },
  };
});

vi.mock("@/lib/auth/session", async () => {
  const perms = await import("@/lib/auth/permissions");
  const user = () => {
    const u = who.users[who.current];
    return { ...u, initials: "XX", roleLabel: u.role, aiAccess: true, active: true, hasProfile: true, mustChangePassword: false };
  };
  const can = (f: string) => perms.can(user(), f as never, perms.DEFAULT_ACCESS_CONTEXT);
  return {
    getSessionUser: async () => user(),
    getAccess: async () => ({ user: user(), ctx: perms.DEFAULT_ACCESS_CONTEXT, features: [], can }),
    checkFeature: async (f: string) => (can(f) ? { user: user() } : { error: "K této akci nemáš oprávnění." }),
    apiRequire: async () => ({ user: user() }),
    requireUser: async () => user(),
    requireFeature: async () => user(),
  };
});

type Row = Record<string, unknown>;

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}
function plusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe.skipIf(!ENABLED)("nová verze nabídky ↔ aktuální zakázka (lokální Supabase)", () => {
  let svc: SupabaseClient;
  let jobs: typeof import("@/app/actions/jobs");
  const created: string[] = [];
  let n = 0;

  async function newJob(items: Row[]): Promise<string> {
    n += 1;
    const { data: row, error } = await svc.from("orders").insert({
      number: `${PREFIX}-${n}`, title: `Nová verze ${n}`, source: "manual", status: "nabidka", inquiry_date: "2026-10-20",
      owner_id: who.users.admin.id, customer_id: CUSTOMER,
    }).select("id").single();
    if (error) throw new Error(error.message);
    const jobId = (row as { id: string }).id;
    created.push(jobId);
    if (items.length) {
      const { error: iErr } = await svc.from("order_items").insert(items.map((it, i) => ({ order_id: jobId, position: i, unit: "ks", ...it })));
      if (iErr) throw new Error(iErr.message);
    }
    return jobId;
  }
  async function quoteWithItems(quoteId: string): Promise<{ quote: Row; items: Row[] }> {
    const { data: q } = await svc.from("quotes").select("*").eq("id", quoteId).single();
    const { data: items } = await svc.from("quote_items").select("*").eq("quote_id", quoteId).order("position");
    return { quote: q as Row, items: (items ?? []) as Row[] };
  }

  beforeAll(async () => {
    const local = await import("@/test/local-supabase");
    const env = local.loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    svc = local.localAdmin();
    const { data: ps } = await svc.from("profiles").select("id, email, full_name, role").in("email", [local.DEMO.sales.email, local.DEMO.admin.email]);
    for (const r of (ps ?? []) as { id: string; email: string; full_name: string; role: "super_admin" | "obchodnik" | "zamestnanec" }[]) {
      who.users[r.role === "super_admin" ? "admin" : "sales"] = { id: r.id, email: r.email, fullName: r.full_name, role: r.role };
    }
    expect(Object.keys(who.users).sort()).toEqual(["admin", "sales"]);
    jobs = await import("@/app/actions/jobs");
  }, 60_000);

  afterAll(async () => {
    if (!svc || !created.length) return;
    await svc.from("quotes").delete().in("job_id", created);
    await svc.from("orders").delete().in("id", created);
  });

  it("nová verze: položky, počty a ceny podle aktuální zakázky, platnost znovu ode dneška", async () => {
    const today = isoToday();
    const jobId = await newJob([
      { drawing_number: "QR-1", name: "Hřídel", quantity: 4, unit_price: 1000, purchase_unit_price: 700 },
      { drawing_number: "QR-2", name: "Deska", quantity: 3, unit_price: 450 },
    ]);
    const first = await jobs.createJobQuote(jobId, {
      validUntil: plusDays(today, 5), leadTimeDays: 14, note: "první verze",
      items: [
        { drawingNumber: "QR-1", name: "Hřídel", quantity: 4, unitPrice: 1000, vatRate: 12, purchaseUnitPrice: 700, note: "Včetně balení" },
        { drawingNumber: "QR-2", name: "Deska", quantity: 3, unitPrice: 450, vatRate: 12 },
      ],
    });
    expect(first.ok, first.error).toBe(true);
    if (!first.ok || !first.id || !first.number) return;

    // mezitím se zakázka změnila: cena a počet hřídele, deska bez ceny v zakázce, nový díl
    const { data: its } = await svc.from("order_items").select("id, drawing_number").eq("order_id", jobId);
    for (const it of (its ?? []) as { id: string; drawing_number: string }[]) {
      if (it.drawing_number === "QR-1") await svc.from("order_items").update({ quantity: 5, unit_price: 1200 }).eq("id", it.id);
      if (it.drawing_number === "QR-2") await svc.from("order_items").update({ unit_price: null, note: "Počet doplň — interní" }).eq("id", it.id);
    }
    await svc.from("order_items").insert({ order_id: jobId, position: 2, unit: "ks", drawing_number: "QR-3", name: "Nový díl", quantity: 2, unit_price: 50 });

    const rev = await jobs.newJobQuoteRevision(first.id);
    expect(rev.ok, rev.error).toBe(true);
    if (!rev.ok || !rev.id) return;
    expect(rev.number).toBe(`${first.number}-R2`);

    const { quote, items } = await quoteWithItems(rev.id);
    expect(quote.revision).toBe(2);
    expect(quote.valid_until).toBe(plusDays(today, 5)); // stejná délka platnosti (5 dní), ale ode dneška
    expect(quote.lead_time_days).toBe(14);
    expect(items.map((r) => [r.drawing_number, Number(r.quantity), Number(r.unit_price), r.vat_rate === null ? null : Number(r.vat_rate), r.note])).toEqual([
      ["QR-1", 5, 1200, 12, "Včetně balení"],
      ["QR-2", 3, 450, 12, null], // cena z předchozí verze, interní poznámka zakázky se nepřenáší
      ["QR-3", 2, 50, 12, null],
    ]);
    expect(Number(quote.total)).toBe(5 * 1200 + 3 * 450 + 2 * 50);
    // nákupní cena se přenáší (super admin má marže)
    expect(Number(items[0].purchase_unit_price)).toBe(700);

    const { quote: old } = await quoteWithItems(first.id);
    expect(old.archived).toBe(true);
    // poslední událost nabídky (propsání nové verze do zakázky — 9. 11. — je samostatná událost „Z nabídky …")
    const { data: ev } = await svc.from("job_events").select("message, data").eq("job_id", jobId).eq("type", "quote").eq("data->>action", "revision").order("created_at", { ascending: false }).limit(1);
    const e = ((ev ?? []) as { message: string; data: Row }[])[0];
    expect(e?.message).toContain("podle aktuálních položek zakázky");
    expect(e?.data?.itemsFromJob).toBe(true);
  }, 60_000);

  it("zakázka bez položek: nová verze opíše položky předchozí verze, platnost přesto ode dneška", async () => {
    const today = isoToday();
    const jobId = await newJob([]);
    const first = await jobs.createJobQuote(jobId, {
      validUntil: "2026-01-01", // už prošlá / nesmyslná délka → 30 dní
      items: [{ drawingNumber: "QR-9", name: "Kus", quantity: 2, unitPrice: 100 }],
    });
    expect(first.ok, first.error).toBe(true);
    if (!first.ok || !first.id || !first.number) return;
    const rev = await jobs.newJobQuoteRevision(first.id);
    expect(rev.ok, rev.error).toBe(true);
    if (!rev.ok || !rev.id) return;
    const { quote, items } = await quoteWithItems(rev.id);
    expect(items.map((r) => [r.drawing_number, Number(r.quantity), Number(r.unit_price)])).toEqual([["QR-9", 2, 100]]);
    expect(Number(quote.total)).toBe(200);
    expect(quote.valid_until).toBe(plusDays(today, 30));
  }, 60_000);
});
