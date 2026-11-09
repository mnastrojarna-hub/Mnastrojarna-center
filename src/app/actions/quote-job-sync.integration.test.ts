import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Nabídka → zakázka (majitel 9. 11.: „když se udělá nabídka, musí se do zakázky doplnit cena, položky,
 * termíny, nákup, marže"). Spuštění:
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/app/actions/quote-job-sync.integration.test.ts
 */
const ENABLED = process.env.LOCAL_SUPABASE === "1";
const TAG = Date.now().toString(36);
const PREFIX = `Z-E2E-QSYNC-${TAG}`;
const CUSTOMER = "d2000000-0000-0000-0000-000000000001"; // Strojmetal a.s.
const REPO = path.resolve(__dirname, "../../..");
const MIGRATION = path.join(REPO, "supabase/migrations/20261109090000_nabidka_do_zakazky.sql");

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

function pragueToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function plusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe.skipIf(!ENABLED)("nabídka → zakázka (lokální Supabase)", () => {
  let svc: SupabaseClient;
  let jobs: typeof import("@/app/actions/jobs");
  const created: string[] = [];
  let n = 0;

  async function newJob(items: Row[], extra: Row = {}): Promise<string> {
    n += 1;
    const { data: row, error } = await svc.from("orders").insert({
      number: `${PREFIX}-${n}`, title: `Propsání nabídky ${n}`, source: "manual", status: "nabidka", inquiry_date: "2026-11-01",
      owner_id: who.users.admin.id, customer_id: CUSTOMER, ...extra,
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
  async function job(jobId: string): Promise<Row> {
    const { data } = await svc.from("orders").select("value, purchase_cost, due_date, order_date, offer_sync").eq("id", jobId).single();
    return data as Row;
  }
  async function items(jobId: string): Promise<Row[]> {
    const { data } = await svc.from("order_items").select("id, position, drawing_number, name, quantity, unit_price, purchase_unit_price, note").eq("order_id", jobId).order("position");
    return (data ?? []) as Row[];
  }
  async function syncEvents(jobId: string): Promise<{ message: string; data: Row }[]> {
    const { data } = await svc.from("job_events").select("message, data, created_at").eq("job_id", jobId).eq("data->>action", "offer_sync").order("created_at");
    return (data ?? []) as { message: string; data: Row }[];
  }
  const plain = (s: string) => s.replace(/\s/g, " ");

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

  it("zakázka bez položek → nabídka se 3 položkami a lhůtou: položky, hodnota = Σ, nákup, termín, jedna událost", async () => {
    who.current = "admin";
    const jobId = await newJob([]);
    const res = await jobs.createJobQuote(jobId, {
      validUntil: plusDays(pragueToday(), 30), leadTimeDays: 31,
      items: [
        { drawingNumber: `QS-${TAG}-1`, name: "DK.Brus Mikrosa 1 a 2 prumer", quantity: 1, unitPrice: 16830, purchaseUnitPrice: 9000, note: "Pro zákazníka" },
        { drawingNumber: `QS-${TAG}-2`, name: "DK. Pod Mikrosa 1 prumer – 1", quantity: 1, unitPrice: 8540 },
        { drawingNumber: `QS-${TAG}-3`, name: "Příruba", quantity: 4, unitPrice: 2500, purchaseUnitPrice: 1000 },
      ],
    });
    expect(res.ok, res.error).toBe(true);
    const its = await items(jobId);
    expect(its.map((r) => [r.drawing_number, Number(r.quantity), Number(r.unit_price), r.purchase_unit_price === null ? null : Number(r.purchase_unit_price), r.note]))
      .toEqual([
        [`QS-${TAG}-1`, 1, 16830, 9000, null], // poznámka nabídky je pro zákazníka → do interní ne
        [`QS-${TAG}-2`, 1, 8540, null, null],
        [`QS-${TAG}-3`, 4, 2500, 1000, null],
      ]);
    const j = await job(jobId);
    expect(Number(j.value)).toBe(16830 + 8540 + 4 * 2500);
    expect(Number(j.purchase_cost)).toBe(9000 + 4 * 1000);
    expect(j.due_date).toBe(plusDays(pragueToday(), 31));
    expect((j.offer_sync as Row).quoteId).toBe(res.id);
    const ev = await syncEvents(jobId);
    expect(ev).toHaveLength(1);
    expect(plain(ev[0].message)).toBe(`Z nabídky ${res.number} doplněno: 3 položky, hodnota 35 370 Kč, termín dodání ${czDate(plusDays(pragueToday(), 31))}`);
    expect(ev[0].data).toMatchObject({ reason: "created", itemsCreated: 3, dueDate: plusDays(pragueToday(), 31) });

    // schválení / odeslání téže nabídky nic nezdvojí (stejné položky, stejný den)
    const sent = await jobs.markJobQuoteSent(res.id!);
    expect(sent.ok, sent.error).toBe(true);
    expect(await items(jobId)).toHaveLength(3);
    expect(await syncEvents(jobId)).toHaveLength(1);

    // datum objednávky u termínu z nabídky → termín od data objednávky (DB)
    const orderDate = plusDays(pragueToday(), 2);
    await svc.from("orders").update({ order_date: orderDate }).eq("id", jobId);
    expect((await job(jobId)).due_date).toBe(plusDays(orderDate, 31));
    const ev2 = await syncEvents(jobId);
    expect(ev2).toHaveLength(2);
    expect(ev2[1].message).toMatch(/^Termín dodání podle data objednávky: 31 dní od /);
  }, 60_000);

  it("zakázka s položkami → ceny podle nabídky, chybějící položka přibude, počty zůstanou; ruční termín se nemění", async () => {
    who.current = "admin";
    const jobId = await newJob([
      { drawing_number: `QS-${TAG}-A`, name: "Hřídel", quantity: 10, unit_price: 100 },
      { drawing_number: `QS-${TAG}-B`, name: "Deska", quantity: 5, unit_price: 50, purchase_unit_price: 20 },
    ], { due_date: "2027-01-15" });
    const res = await jobs.createJobQuote(jobId, {
      leadTimeDays: 20,
      items: [
        { drawingNumber: `QS-${TAG}-A`, name: "Hřídel", quantity: 12, unitPrice: 120, purchaseUnitPrice: 60 },
        { drawingNumber: `QS-${TAG}-B`, name: "Deska", quantity: 5, unitPrice: 55, purchaseUnitPrice: 30 },
        { drawingNumber: `QS-${TAG}-C`, name: "Pouzdro", quantity: 3, unitPrice: 40 },
      ],
    });
    expect(res.ok, res.error).toBe(true);
    const its = await items(jobId);
    expect(its.map((r) => [r.drawing_number, Number(r.quantity), Number(r.unit_price), r.purchase_unit_price === null ? null : Number(r.purchase_unit_price)]))
      .toEqual([
        [`QS-${TAG}-A`, 10, 120, 60], // počet zakázky zůstal, nákupní doplněna
        [`QS-${TAG}-B`, 5, 55, 20],   // nákupní v zakázce už byla → beze změny
        [`QS-${TAG}-C`, 3, 40, null], // přibyla
      ]);
    const j = await job(jobId);
    expect(Number(j.value)).toBe(10 * 120 + 5 * 55 + 3 * 40);
    expect(j.due_date).toBe("2027-01-15"); // ruční termín se nepřepisuje
    const ev = await syncEvents(jobId);
    expect(ev).toHaveLength(1);
    expect(plain(ev[0].message)).toBe(`Z nabídky ${res.number} srovnáno: přidána 1 položka, ceny 2 položek, nákupní ceny 1 položky, hodnota 1 595 Kč`);

    // ruční úprava ceny v zakázce po nabídce: opětovné propsání téže nabídky (odeslání) ji nepřepíše
    await svc.from("order_items").update({ unit_price: 130 }).eq("id", its[0].id as string);
    const sent = await jobs.markJobQuoteSent(res.id!);
    expect(sent.ok, sent.error).toBe(true);
    expect(Number((await items(jobId))[0].unit_price)).toBe(130);

    // přijetí zákazníkem = závazná cena nabídky (force)
    const acc = await jobs.acceptJobQuote(res.id!);
    expect(acc.ok, acc.error).toBe(true);
    expect(Number((await items(jobId))[0].unit_price)).toBe(120);
    expect(Number((await job(jobId)).value)).toBe(10 * 120 + 5 * 55 + 3 * 40);
  }, 60_000);

  it("nová verze se změněnou cenou → zakázka ji následuje", async () => {
    who.current = "admin";
    const jobId = await newJob([]);
    const first = await jobs.createJobQuote(jobId, {
      leadTimeDays: 10,
      items: [{ drawingNumber: `QS-${TAG}-R`, name: "Kroužek", quantity: 2, unitPrice: 300 }],
    });
    expect(first.ok, first.error).toBe(true);
    expect(Number((await job(jobId)).value)).toBe(600);
    const rev = await jobs.newJobQuoteRevision(first.id!);
    expect(rev.ok, rev.error).toBe(true);
    const upd = await jobs.updateJobQuote(rev.id!, {
      leadTimeDays: 14,
      items: [{ drawingNumber: `QS-${TAG}-R`, name: "Kroužek", quantity: 2, unitPrice: 350 }],
    });
    expect(upd.ok, upd.error).toBe(true);
    const its = await items(jobId);
    expect(its.map((r) => [Number(r.quantity), Number(r.unit_price)])).toEqual([[2, 350]]);
    const j = await job(jobId);
    expect(Number(j.value)).toBe(700);
    // termín odvozený z první verze se posune podle nové lhůty
    expect(j.due_date).toBe(plusDays(pragueToday(), 14));
    expect((j.offer_sync as Row).quoteId).toBe(rev.id);
  }, 60_000);

  it("vyfakturovaná zakázka se nemění", async () => {
    who.current = "admin";
    const jobId = await newJob([], { invoice_number: `FV-QS-${TAG}`, value: 1000 });
    const res = await jobs.createJobQuote(jobId, {
      leadTimeDays: 10, items: [{ drawingNumber: `QS-${TAG}-F`, name: "Díl", quantity: 1, unitPrice: 5000 }],
    });
    expect(res.ok, res.error).toBe(true);
    expect(await items(jobId)).toHaveLength(0);
    const j = await job(jobId);
    expect(Number(j.value)).toBe(1000);
    expect(j.due_date).toBeNull();
    expect(await syncEvents(jobId)).toHaveLength(0);
  }, 60_000);

  it("migrace: zakázka bez položek s odeslanou nabídkou dostane položky, hodnotu a termín — podruhé nic", async () => {
    const sentAt = new Date().toISOString();
    const jobId = await newJob([]);
    const archivedJob = await newJob([]); // jen archivní nabídka → nic
    const invoiced = await newJob([], { invoice_number: `FV-QSM-${TAG}` });
    const insQuote = async (job: string, number: string, extra: Row) => {
      const { data, error } = await svc.from("quotes").insert({
        number, job_id: job, customer_id: CUSTOMER, status: "odeslano", sent_at: sentAt, currency: "CZK",
        total: 96100, revision: 1, lead_time_days: 31, archived: false, created_by: who.users.admin.id, owner_id: who.users.admin.id, ...extra,
      }).select("id").single();
      if (error) throw new Error(error.message);
      const id = (data as { id: string }).id;
      const { error: e2 } = await svc.from("quote_items").insert([
        { quote_id: id, position: 0, drawing_number: `QSM-${TAG}-1`, name: "DK.Brus Mikrosa 1 a 2 prumer", quantity: 1, unit_price: 16830, vat_rate: 21 },
        { quote_id: id, position: 1, drawing_number: `QSM-${TAG}-2`, name: "DK. Pod Mikrosa 1 prumer – 1", quantity: 1, unit_price: 8540, vat_rate: 21 },
        { quote_id: id, position: 2, drawing_number: `QSM-${TAG}-3`, name: "Zbytek", quantity: 1, unit_price: 70730, purchase_unit_price: 40000, vat_rate: 21 },
      ]);
      if (e2) throw new Error(e2.message);
      return id;
    };
    const quoteId = await insQuote(jobId, `NAB-QSM-${TAG}-1`, {});
    await insQuote(archivedJob, `NAB-QSM-${TAG}-2`, { archived: true });
    await insQuote(invoiced, `NAB-QSM-${TAG}-3`, {});

    const runMigration = () => execFileSync(path.join(REPO, "tools/local-supabase/psql.sh"), ["-X", "-q", "-1", "-v", "ON_ERROR_STOP=1", "-f", MIGRATION], { stdio: ["ignore", "pipe", "pipe"] });
    runMigration();
    const its = await items(jobId);
    expect(its.map((r) => [r.drawing_number, Number(r.unit_price)])).toEqual([[`QSM-${TAG}-1`, 16830], [`QSM-${TAG}-2`, 8540], [`QSM-${TAG}-3`, 70730]]);
    const j = await job(jobId);
    expect(Number(j.value)).toBe(96100);
    expect(Number(j.purchase_cost)).toBe(40000);
    const due = plusDays(pragueToday(), 31);
    expect(j.due_date).toBe(due);
    expect(j.offer_sync).toMatchObject({ quoteId, dueDate: due, leadDays: 31 });
    // otisk položek z migrace = otisk serveru (opětovné propsání téže nabídky nic nezdvojí)
    const { offerItemsKey } = await import("@/lib/jobs/quote-job-sync-store");
    const { data: qIds } = await svc.from("quote_items").select("id").eq("quote_id", quoteId);
    expect((j.offer_sync as Row).itemsKey).toBe(offerItemsKey(((qIds ?? []) as { id: string }[]).map((r) => r.id)));
    let ev = await syncEvents(jobId);
    expect(ev).toHaveLength(1);
    expect(plain(ev[0].message)).toBe(`Z nabídky NAB-QSM-${TAG}-1 doplněno: 3 položky, hodnota 96 100 Kč, termín dodání ${czDate(due)}`);
    expect(await items(archivedJob)).toHaveLength(0);
    expect(await items(invoiced)).toHaveLength(0);

    runMigration(); // idempotence
    expect(await items(jobId)).toHaveLength(3);
    ev = await syncEvents(jobId);
    expect(ev).toHaveLength(1);

    // server po migraci: odeslání / schválení stejné nabídky nic nepřidá
    const { syncJobFromQuote } = await import("@/lib/jobs/quote-job-sync-store");
    const r = await syncJobFromQuote(svc as never, jobId, { actorId: who.users.admin.id, reason: "sent" });
    expect(r).toMatchObject({ ok: true, itemsCreated: 0, pricesUpdated: 0, dueDate: null });
    expect(await syncEvents(jobId)).toHaveLength(1);
  }, 120_000);
});

function czDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d}. ${m}. ${y}`;
}
