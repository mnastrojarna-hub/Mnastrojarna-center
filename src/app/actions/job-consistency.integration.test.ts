import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Křížová konzistence zakázky (majitel 4. 11.) proti lokálnímu Supabase — skutečné triggery
 * (migrace 20261104120000_krizova_konzistence_cen.sql) + serverové akce:
 *  - položky → hodnota zakázky (akce i přímý zápis do položek), historie;
 *  - hodnota zakázky → rozpočítání na položky (poměrně / na kus / na položky bez ceny);
 *  - vyfakturovaná zakázka zamčená; odeslaná nabídka → upozornění; přijatá nabídka → ceny položek;
 *  - objednávky dodavatelům → nákupní náklady + provize (vystavení, úprava, zrušení), ruční nákup odmítnut;
 *  - odeslaná objednávka: položky ani termín změnit nejde; termín neodeslané ↔ termín kroku výroby.
 *   set -a; . .local-supabase/env; set +a
 *   LOCAL_SUPABASE=1 npx vitest run src/app/actions/job-consistency.integration.test.ts
 * Vlastní data (zakázky „E2E-KK-"), na konci se uklidí.
 */

const ENABLED = process.env.LOCAL_SUPABASE === "1";
const TAG = Date.now().toString(36).toUpperCase();

const who = vi.hoisted(() => ({
  users: {} as Record<string, { id: string; email: string; fullName: string; role: "super_admin" | "obchodnik" | "zamestnanec" }>,
  current: "sales" as "sales" | "worker" | "admin",
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

describe.skipIf(!ENABLED)("křížová konzistence zakázky ↔ lokální Supabase", () => {
  let svc: SupabaseClient;
  let customerId = "";
  let supplierId = "";
  let jobsA: typeof import("./jobs");
  let cons: typeof import("./job-consistency");
  let purch: typeof import("./purchasing");
  const jobs: string[] = [];
  let n = 0;
  const id = (u: "sales" | "worker" | "admin") => who.users[u].id;

  async function newJob(items: { qty: number; price: number | null; purchase?: number | null }[], patch: Row = {}): Promise<{ id: string; items: string[] }> {
    n += 1;
    const { data, error } = await svc.from("orders").insert({
      number: `Z-E2E-KK-${TAG}-${n}`, title: `E2E-KK-${n}`, status: "objednavka", source: "manual", owner_id: id("sales"),
      created_by: id("sales"), customer_id: customerId, order_date: "2026-10-20", value: 1, ...patch,
    }).select("id").single();
    if (error) throw new Error(error.message);
    const jobId = (data as { id: string }).id;
    jobs.push(jobId);
    if (items.length) {
      const { data: it, error: iErr } = await svc.from("order_items").insert(items.map((x, i) => ({
        order_id: jobId, position: i, drawing_number: `KK-${TAG}-${i}`, name: `Díl ${i + 1}`, quantity: x.qty, unit: "ks",
        unit_price: x.price, purchase_unit_price: x.purchase ?? null,
      }))).select("id, position").order("position");
      if (iErr) throw new Error(iErr.message);
      return { id: jobId, items: ((it ?? []) as { id: string }[]).map((r) => r.id) };
    }
    return { id: jobId, items: [] };
  }
  const order = async (jobId: string) => (await svc.from("orders").select("*").eq("id", jobId).single()).data as Row;
  const itemsOf = async (jobId: string) => ((await svc.from("order_items").select("id, quantity, unit_price, note").eq("order_id", jobId).order("position")).data ?? []) as Row[];
  const autoEvents = async (jobId: string, kind: string) =>
    ((await svc.from("job_events").select("message, data, actor_id, via").eq("job_id", jobId).filter("data->>auto", "eq", kind).order("created_at")).data ?? []) as Row[];
  const commission = async (jobId: string) => (await svc.from("commission_entries").select("*").eq("order_id", jobId).maybeSingle()).data as Row | null;
  const inputOf = (rows: Row[], prices: (number | null)[], qty?: number[]) => rows.map((r, i) => ({
    id: String(r.id), drawingNumber: `KK-${TAG}-${i}`, name: `Díl ${i + 1}`, quantity: qty?.[i] ?? Number(r.quantity), unit: "ks", unitPrice: prices[i],
  }));

  async function newPo(jobId: string, total: number, status = "vystavena", items: { orderItemId: string; qty: number; price: number }[] = []): Promise<string> {
    const { data, error } = await svc.from("purchase_orders").insert({
      job_id: jobId, supplier_id: supplierId, number: `OV-KK-${TAG}-${n}-${Math.round(total)}`, status, total,
      order_date: "2026-10-21", required_date: "2026-12-01",
    }).select("id").single();
    if (error) throw new Error(error.message);
    const poId = (data as { id: string }).id;
    if (items.length) {
      const { error: e2 } = await svc.from("purchase_order_items").insert(items.map((x, i) => ({
        purchase_order_id: poId, position: i, drawing_number: `KK-${TAG}-${i}`, quantity: x.qty, unit_price: x.price, order_item_id: x.orderItemId,
      })));
      if (e2) throw new Error(e2.message);
    }
    return poId;
  }

  beforeAll(async () => {
    const local = await import("@/test/local-supabase");
    const env = local.loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    svc = local.localAdmin();
    const { data } = await svc.from("profiles").select("id, email, full_name, role").in("email", [local.DEMO.sales.email, local.DEMO.worker.email, local.DEMO.admin.email]);
    for (const r of (data ?? []) as { id: string; email: string; full_name: string; role: "super_admin" | "obchodnik" | "zamestnanec" }[]) {
      const key = r.role === "super_admin" ? "admin" : r.role === "obchodnik" ? "sales" : "worker";
      who.users[key] = { id: r.id, email: r.email, fullName: r.full_name, role: r.role };
    }
    const { data: c, error } = await svc.from("customers").insert({ name: `E2E-KK ${TAG} s.r.o.`, country: "CZ", owner_id: id("sales") }).select("id").single();
    if (error) throw new Error(error.message);
    customerId = (c as { id: string }).id;
    const { data: s, error: sErr } = await svc.from("suppliers").insert({ name: `E2E-KK dodavatel ${TAG}` }).select("id").single();
    if (sErr) throw new Error(sErr.message);
    supplierId = (s as { id: string }).id;
    jobsA = await import("./jobs");
    cons = await import("./job-consistency");
    purch = await import("./purchasing");
  }, 60_000);

  afterAll(async () => {
    if (!svc) return;
    for (const jobId of jobs) {
      await svc.from("job_operations").delete().eq("job_id", jobId);
      await svc.from("purchase_orders").delete().eq("job_id", jobId);
      await svc.from("quotes").delete().eq("job_id", jobId);
      await svc.from("orders").delete().eq("id", jobId);
      await svc.from("audit_log").delete().filter("diff->>jobId", "eq", jobId);
    }
    if (supplierId) await svc.from("suppliers").delete().eq("id", supplierId);
    if (customerId) await svc.from("customers").delete().eq("id", customerId);
  }, 60_000);

  it("položky → hodnota zakázky: založení, uložení položek i přímý zápis (pošta, focení) — s historií", async () => {
    who.current = "sales";
    const j = await newJob([{ qty: 2, price: 54_000 }, { qty: 1, price: 24_000 }]);
    // případ majitele: hodnota zapsaná jinak než součet položek → DB ji srovná na součet
    expect(Number((await order(j.id)).value)).toBe(132_000);

    const rows = await itemsOf(j.id);
    const res = await jobsA.saveJobItems(j.id, inputOf(rows, [55_000, 24_000], [3, 1]));
    expect(res.ok, res.error).toBe(true);
    expect(res.value).toBe(189_000);
    expect(Number((await order(j.id)).value)).toBe(189_000);
    // jedna událost přepočtu na jedno uložení (sloučená v rámci požadavku), s autorem
    const ev = await autoEvents(j.id, "items_value");
    expect(ev).toHaveLength(2); // vložení položek + jedno uložení (2 řádky + hlavička = 1 událost)
    expect(ev.at(-1)?.message).toMatch(/^Hodnota zakázky přepočtena ze součtu položek: 132\s000 Kč → 189\s000 Kč$/);
    expect(ev.at(-1)?.actor_id).toBe(id("sales"));
    expect(ev.at(-1)?.via).toBe("automaticky");

    // přímý zápis do položky (jiná cesta než karta) → hodnota se přepočte taky
    await svc.from("order_items").update({ quantity: 2 }).eq("id", j.items[0]);
    expect(Number((await order(j.id)).value)).toBe(134_000);
    // přidání / odebrání položky
    await svc.from("order_items").insert({ order_id: j.id, position: 2, name: "Navíc", quantity: 1, unit: "ks", unit_price: 1_000 });
    expect(Number((await order(j.id)).value)).toBe(135_000);
    await svc.from("order_items").delete().eq("order_id", j.id).eq("position", 2);
    expect(Number((await order(j.id)).value)).toBe(134_000);
    // přímý zápis jiné hodnoty do zakázky DB srovná zpět
    await svc.from("orders").update({ value: 1 }).eq("id", j.id);
    expect(Number((await order(j.id)).value)).toBe(134_000);
    // provize jde za hodnotou
    expect(Number((await commission(j.id))?.revenue)).toBe(134_000);
  }, 60_000);

  it("bez cen na položkách je hodnota ruční; položky bez ceny se do součtu nepočítají", async () => {
    who.current = "sales";
    const j = await newJob([{ qty: 4, price: null }], { value: 5_000 });
    expect(Number((await order(j.id)).value)).toBe(5_000);
    const up = await jobsA.updateJob(j.id, { value: 6_000 });
    expect(up.ok, up.error).toBe(true);
    expect(Number((await order(j.id)).value)).toBe(6_000);
    // jedna položka dostane cenu → hodnota = Σ nacenených
    await svc.from("order_items").insert({ order_id: j.id, position: 1, name: "S cenou", quantity: 2, unit: "ks", unit_price: 100 });
    expect(Number((await order(j.id)).value)).toBe(200);
    // zbytek do 1 000 na položky bez ceny (rovnoměrně na kus)
    const r = await cons.setJobValue(j.id, 1_000, "unpriced");
    expect(r.ok, r.error).toBe(true);
    expect(r).toMatchObject({ value: 1_000, exact: true, changed: 1 });
    expect((await itemsOf(j.id)).map((x) => Number(x.unit_price))).toEqual([200, 100]);
    expect(Number((await order(j.id)).value)).toBe(1_000);
  }, 60_000);

  it("změna hodnoty zakázky se rozpočítá na položky (poměrně / na kus), haléře sedí, historie popisuje změnu", async () => {
    who.current = "sales";
    const j = await newJob([{ qty: 2, price: 54_000 }, { qty: 1, price: 24_000 }]);
    const r = await cons.setJobValue(j.id, 145_200, "proportional");
    expect(r.ok, r.error).toBe(true);
    expect(r).toMatchObject({ value: 145_200, exact: true, changed: 2, warning: "" });
    expect((await itemsOf(j.id)).map((x) => Number(x.unit_price))).toEqual([59_400, 26_400]);
    expect(Number((await order(j.id)).value)).toBe(145_200);
    const ev = await autoEvents(j.id, "items_value");
    expect(ev.at(-1)?.message).toMatch(/^Hodnota zakázky 132\s000\sKč → 145\s200\sKč rozpočítána na položky — poměrně podle položek: /);
    expect((ev.at(-1)?.data as Row).distribution).toMatchObject({ mode: "proportional", requested: 145_200, achieved: 145_200 });

    // rovnoměrně na kus přes obecnou úpravu pole (updateJob → výchozí rozpočítání)
    const r2 = await cons.setJobValue(j.id, 145_500, "per_piece");
    expect(r2.ok, r2.error).toBe(true);
    expect((await itemsOf(j.id)).map((x) => Number(x.unit_price))).toEqual([59_500, 26_500]);
    const up = await jobsA.updateJob(j.id, { value: 100_001 });
    expect(up.ok, up.error).toBe(true);
    const items = await itemsOf(j.id);
    expect(Number((await order(j.id)).value)).toBe(100_001);
    expect(Math.round((Number(items[0].unit_price) * 2 + Number(items[1].unit_price)) * 100)).toBe(10_000_100);
    // smazat hodnotu při naceněných položkách nejde
    expect((await jobsA.updateJob(j.id, { value: null })).ok).toBe(false);
  }, 60_000);

  it("vyfakturovaná zakázka: hodnota ani ceny / počty položek se nemění, poznámka ano", async () => {
    who.current = "sales";
    const j = await newJob([{ qty: 1, price: 10_000 }]);
    await svc.from("orders").update({ invoice_number: `FV-KK-${TAG}` }).eq("id", j.id);
    const r = await cons.setJobValue(j.id, 12_000);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/vyfakturovaná \(FV-KK-/);
    expect((await jobsA.updateJob(j.id, { value: 12_000 })).ok).toBe(false);
    const rows = await itemsOf(j.id);
    const price = await jobsA.saveJobItems(j.id, inputOf(rows, [11_000]));
    expect(price.ok).toBe(false);
    const note = await jobsA.saveJobItems(j.id, [{ ...inputOf(rows, [10_000])[0], note: "jen poznámka" }]);
    expect(note.ok, note.error).toBe(true);
    // přímý zápis do položky vyfakturovanou hodnotu nepřepíše
    await svc.from("order_items").update({ unit_price: 1 }).eq("id", j.items[0]);
    expect(Number((await order(j.id)).value)).toBe(10_000);
    expect((await cons.alignJobConsistency(j.id, "value_from_items")).ok).toBe(false);
  }, 60_000);

  it("odeslaná nabídka: změna cen upozorní; nová verze nabídky z položek; přijatá nabídka → ceny položek", async () => {
    who.current = "sales";
    const j = await newJob([{ qty: 2, price: 500 }, { qty: 1, price: 1_000 }], { status: "nabidka" });
    const { data: q, error } = await svc.from("quotes").insert({
      number: `NAB-KK-${TAG}`, customer_id: customerId, status: "odeslano", sent_at: new Date().toISOString(), job_id: j.id, total: 2_000, owner_id: id("sales"),
    }).select("id").single();
    if (error) throw new Error(error.message);
    const quoteId = (q as { id: string }).id;
    await svc.from("quote_items").insert([
      { quote_id: quoteId, position: 0, drawing_number: `KK-${TAG}-0`, name: "Díl 1", quantity: 2, unit_price: 500 },
      { quote_id: quoteId, position: 1, drawing_number: `KK-${TAG}-1`, name: "Díl 2", quantity: 1, unit_price: 1_000 },
    ]);
    const rows = await itemsOf(j.id);
    const saved = await jobsA.saveJobItems(j.id, inputOf(rows, [600, 1_000]));
    expect(saved.ok, saved.error).toBe(true);
    expect(saved.warning).toMatch(new RegExp(`odeslané nabídce NAB-KK-${TAG} \\(2\\s000\\sKč\\)`));
    const v = await cons.setJobValue(j.id, 2_400, "proportional");
    expect(v.ok && v.warning).toMatch(/odeslané nabídce/);

    // nová verze nabídky z aktuálních položek
    const rev = await cons.alignJobConsistency(j.id, "quote_revision", { quoteId });
    expect(rev.ok, rev.error).toBe(true);
    const { data: nq } = await svc.from("quotes").select("total, archived, revision").eq("id", rev.quoteId!).single();
    expect(Number((nq as Row).total)).toBe(Number((await order(j.id)).value));
    const { data: old } = await svc.from("quotes").select("archived").eq("id", quoteId).single();
    expect((old as Row).archived).toBe(true);

    // přijetí (jiné) nabídky s jinými cenami → ceny položek podle nabídky, hodnota = Σ = cena nabídky
    await svc.from("quotes").update({ archived: false }).eq("id", quoteId);
    await svc.from("quotes").delete().eq("id", rev.quoteId!);
    const acc = await jobsA.acceptJobQuote(quoteId);
    expect(acc.ok, acc.error).toBe(true);
    expect((await itemsOf(j.id)).map((x) => Number(x.unit_price))).toEqual([500, 1_000]);
    expect(Number((await order(j.id)).value)).toBe(2_000);
  }, 60_000);

  it("objednávky dodavatelům → nákupní náklady a provize; ruční nákup odmítnut; zrušení → nákup podle položek", async () => {
    who.current = "sales";
    const j = await newJob([{ qty: 2, price: 10_000, purchase: 6_000 }]);
    // bez objednávek: nákup z nákupních cen položek (uložení položek)
    const rows = await itemsOf(j.id);
    const saved = await jobsA.saveJobItems(j.id, [{ ...inputOf(rows, [10_000])[0], purchaseUnitPrice: 6_000 }]);
    expect(saved.ok, saved.error).toBe(true);
    expect(Number((await order(j.id)).purchase_cost)).toBe(12_000);

    const po = await newPo(j.id, 13_000, "vystavena", [{ orderItemId: j.items[0], qty: 2, price: 6_500 }]);
    expect(Number((await order(j.id)).purchase_cost)).toBe(13_000);
    expect(Number((await commission(j.id))?.cost)).toBe(13_000);
    expect((await autoEvents(j.id, "po_cost")).at(-1)?.message).toBe("Nákupní náklady přepočteny podle objednávek dodavatelům");
    // citlivé: v historii bez částek
    expect(JSON.stringify((await autoEvents(j.id, "po_cost")).at(-1)?.data)).not.toMatch(/13000/);

    // ruční změna nákupu při objednávkách → odmítnuto s vysvětlením
    const manual = await jobsA.updateJob(j.id, { purchaseCost: 9_000 });
    expect(manual.ok).toBe(false);
    expect(manual.error).toMatch(/počítají z objednávek dodavatelům \(OV-KK-/);

    // úprava objednávky (neodeslané): položky → celkem → nákup + provize
    const ed = await purch.updatePurchaseOrder(po, { items: [{ drawingNumber: `KK-${TAG}-0`, name: "Díl 1", quantity: 2, unit: "ks", unitPrice: 7_000, orderItemId: j.items[0] }] } as never);
    expect(ed.ok, ed.error).toBe(true);
    expect(Number((await order(j.id)).purchase_cost)).toBe(14_000);
    expect(Number((await commission(j.id))?.cost)).toBe(14_000);

    // zrušení poslední objednávky → nákup podle nákupních cen položek
    const cancel = await purch.updatePurchaseOrder(po, { status: "zrusena", cancelReason: "test" });
    expect(cancel.ok, cancel.error).toBe(true);
    expect(Number((await order(j.id)).purchase_cost)).toBe(12_000);
    expect(Number((await commission(j.id))?.cost)).toBe(12_000);
  }, 60_000);

  it("odeslaná objednávka: položky ani termín změnit nejde (jen cena); termín neodeslané → termín kroku výroby", async () => {
    who.current = "sales";
    const j = await newJob([{ qty: 4, price: 1_000 }], { due_date: "2026-12-20" });
    const sent = await newPo(j.id, 2_000, "odeslana", [{ orderItemId: j.items[0], qty: 4, price: 500 }]);
    const items = await purch.updatePurchaseOrder(sent, { items: [{ drawingNumber: "X", name: "Jiný", quantity: 5, unit: "ks", unitPrice: 500 }] } as never);
    expect(items.ok).toBe(false);
    expect(items.error).toMatch(/už odešla dodavateli/);
    const date = await purch.updatePurchaseOrder(sent, { requiredDate: "2026-12-05" });
    expect(date.ok).toBe(false);
    expect(date.error).toMatch(/už odešla dodavateli — termín/);

    // neodeslaná: termín → poslední navázaný otevřený krok
    const draft = await newPo(j.id, 1_000, "vystavena", [{ orderItemId: j.items[0], qty: 4, price: 250 }]);
    const { data: op, error } = await svc.from("job_operations").insert({
      job_id: j.id, position: 0, kind: "tepelne_zpracovani", supplier_id: supplierId, purchase_order_id: draft, planned_end: "2026-12-01", status: "ceka",
    }).select("id").single();
    if (error) throw new Error(error.message);
    const up = await purch.updatePurchaseOrder(draft, { requiredDate: "2026-12-03" });
    expect(up.ok, up.error).toBe(true);
    const { data: step } = await svc.from("job_operations").select("planned_end, deadline_source").eq("id", (op as { id: string }).id).single();
    expect(step).toMatchObject({ planned_end: "2026-12-03", deadline_source: "rucne" });
    // nákup = Σ aktivních objednávek
    expect(Number((await order(j.id)).purchase_cost)).toBe(3_000);
  }, 60_000);

  it("srovnání jedním klikem: hodnota podle položek a nákup podle objednávek (stará data)", async () => {
    who.current = "sales";
    const j = await newJob([{ qty: 1, price: 700 }]);
    const po = await newPo(j.id, 400);
    // stará data mimo pravidla (bez triggerů) — vypnout je jde jen v psql; simulace: zakázka „vyfakturovaná" a zpět
    await svc.from("orders").update({ invoice_number: "X" }).eq("id", j.id);
    await svc.from("orders").update({ value: 999, purchase_cost: 111 }).eq("id", j.id);
    await svc.from("orders").update({ invoice_number: null }).eq("id", j.id);
    expect(await order(j.id)).toMatchObject({ value: 999, purchase_cost: 111 });
    const a = await cons.alignJobConsistency(j.id, "value_from_items");
    expect(a.ok, a.error).toBe(true);
    const b = await cons.alignJobConsistency(j.id, "cost_from_orders");
    expect(b.ok, b.error).toBe(true);
    expect(await order(j.id)).toMatchObject({ value: 700, purchase_cost: 400 });
    expect(po).toBeTruthy();
  }, 60_000);
});
