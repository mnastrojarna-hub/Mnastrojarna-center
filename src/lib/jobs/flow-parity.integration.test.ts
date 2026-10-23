import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_ENABLED, DEMO, localAdmin, profileId } from "@/test/local-supabase";
import { userActor } from "@/lib/supabase/actor-headers";
import {
  FLOW_ORDER_COLUMNS, FLOW_QUOTE_COLUMNS, deriveFlow, flowFactsFromRow, pragueToday, quoteFactsFromRow, snapshotKeysFromView,
} from "./flow-status";

/**
 * Parita odvozených stavů: deriveFlow (TS) = řádek view job_flow_v (DB) pro všechny zakázky
 * lokální DB + 12 dočasných scénářů Z-E2E-FLOW-PAR-* (po testu smazané).
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/jobs/flow-parity.integration.test.ts
 */

const PREFIX = `Z-E2E-FLOW-PAR-${Date.now().toString(36)}`;
type Row = Record<string, unknown>;

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const dayAgo = (n: number) => pragueToday(new Date(Date.now() - n * 86_400_000));

describe.skipIf(!LOCAL_ENABLED)("parita deriveFlow ↔ job_flow_v", () => {
  let svc: SupabaseClient;
  let db: SupabaseClient;
  const jobs: string[] = [];
  let n = 0;

  async function job(patch: Row, after?: (id: string) => Promise<void>): Promise<string> {
    n += 1;
    const { data, error } = await db.from("orders").insert({
      number: `${PREFIX}-${n}`, title: `Parita ${n}`, source: "manual", inquiry_date: "2026-10-01", ...patch,
    }).select("id").single();
    if (error) throw new Error(`${n}: ${error.message}`);
    const id = (data as { id: string }).id;
    jobs.push(id);
    if (after) await after(id);
    return id;
  }

  const items = (id: string, rows: Row[]) => db.from("order_items").insert(rows.map((r, i) => ({ order_id: id, position: i, quantity: 1, ...r })));
  const ok = <T extends { error: { message: string } | null }>(r: T) => { if (r.error) throw new Error(r.error.message); return r; };

  beforeAll(async () => {
    svc = localAdmin();
    db = localAdmin(userActor({ id: await profileId(svc, DEMO.sales.email) }));

    // 1) e-mailová poptávka (přijatá)
    await job({ status: "poptavka", source: "email" });
    // 2) čeká na podklady 3 dny
    await job({ status: "poptavka" }, async (id) => {
      ok(await db.from("orders").update({ inquiry_status: "ceka_na_podklady", waiting_note: "výkres" }).eq("id", id));
      ok(await db.from("orders").update({ waiting_since: daysAgo(3) }).eq("id", id));
    });
    // 3) nacenění 1/2 + čeká na cenu dodavatele
    await job({ status: "naceneni" }, async (id) => {
      ok(await items(id, [{ name: "A", unit_price: 10 }, { name: "B" }]));
      ok(await db.from("supplier_quotes").insert({ job_id: id, supplier_name: "Kooperace s.r.o." }));
    });
    // 4) odeslaná nabídka po platnosti (vypršela) — odeslaná před 5 dny
    await job({ status: "naceneni" }, async (id) => {
      const { data } = ok(await db.from("quotes").insert({ number: `${PREFIX}-Q4`, job_id: id, status: "ke_schvaleni", total: 1000, revision: 1, valid_until: dayAgo(1) }).select("id").single());
      ok(await db.from("quotes").update({ status: "odeslano", sent_at: daysAgo(5) }).eq("id", (data as { id: string }).id));
    });
    // 5) připomínky zákazníka k revizi 2 (r1 archivovaná)
    await job({ status: "nabidka" }, async (id) => {
      ok(await db.from("quotes").insert({ number: `${PREFIX}-Q5`, job_id: id, status: "odeslano", total: 1000, revision: 1, archived: true }));
      const { data } = ok(await db.from("quotes").insert({ number: `${PREFIX}-Q5-R2`, job_id: id, status: "odeslano", total: 900, revision: 2, valid_until: "2099-01-01" }).select("id").single());
      ok(await db.from("quotes").update({ feedback: "Chtějí jiný materiál" }).eq("id", (data as { id: string }).id));
    });
    // 6) doručená objednávka s vystaveným potvrzením (náš doklad)
    await job({ status: "objednavka", order_date: "2026-10-10", customer_order_number: "PAR-6" }, async (id) => {
      ok(await db.from("job_files").insert({ job_id: id, kind: "potvrzeni", filename: "p.pdf", storage_path: `zakazky/${id}/p.pdf`, origin: "generated" }));
    });
    // 7) potvrzená s rozporem (ruční)
    await job({ status: "objednavka", order_date: "2026-10-10", customer_order_number: "PAR-7" }, async (id) => {
      ok(await db.from("orders").update({ order_status: "rozpor", order_mismatch: { items: [{ kind: "cena", label: "Cena" }], source: "rucne", detected_at: daysAgo(2) } }).eq("id", id));
    });
    // 8) ve výrobě, 1 ze 2 položek dodána
    await job({ status: "potvrzeno", order_date: "2026-10-10", customer_order_number: "PAR-8" }, async (id) => {
      ok(await db.from("orders").update({ status: "ve_vyrobe" }).eq("id", id));
      ok(await items(id, [{ name: "A", quantity: 2 }, { name: "B", quantity: 3 }]));
      const { data } = await db.from("order_items").select("id").eq("order_id", id).order("position");
      ok(await db.from("order_items").update({ delivered_quantity: 2 }).eq("id", (data as { id: string }[])[0].id));
    });
    // 9) vše dodáno, DL potvrzený před poslední dodávkou → jen „dodáno"
    await job({ status: "potvrzeno", order_date: "2026-10-10", customer_order_number: "PAR-9" }, async (id) => {
      ok(await items(id, [{ name: "A", quantity: 1 }]));
      ok(await db.from("orders").update({ delivery_note_confirmed_at: dayAgo(3) }).eq("id", id));
      const { data } = await db.from("order_items").select("id").eq("order_id", id);
      ok(await db.from("order_items").update({ delivered_quantity: 1 }).eq("id", (data as { id: string }[])[0].id));
    });
    // 10) vyfakturováno po splatnosti s částečnou úhradou
    await job({ status: "dodano_zakaznikovi", order_date: "2026-09-01", customer_order_number: "PAR-10", value: 10_000 }, async (id) => {
      ok(await db.from("orders").update({ status: "fakturovano", invoice_number: `FV-${PREFIX}`, invoice_date: "2026-09-01", invoice_due_date: "2026-09-15" }).eq("id", id));
      ok(await db.from("job_payments").insert({ job_id: id, amount: 3000 }));
    });
    // 11) bez položek, částečná dodávka
    await job({ status: "na_sklade", order_date: "2026-10-01", customer_order_number: "PAR-11" }, async (id) => {
      ok(await db.from("orders").update({ partial_delivery_note: "1. paleta", partial_delivery_at: daysAgo(1) }).eq("id", id));
    });
    // 12) stornovaná objednávka (důvod) → zrušeno
    await job({ status: "potvrzeno", order_date: "2026-10-01", customer_order_number: "PAR-12" }, async (id) => {
      ok(await db.from("orders").update({ order_status: "stornovana", lost_reason: "jiny_dodavatel" }).eq("id", id));
    });
  }, 120_000);

  afterAll(async () => {
    if (!svc || !jobs.length) return;
    await svc.from("quotes").delete().in("job_id", jobs);
    await svc.from("orders").delete().in("id", jobs);
    await svc.from("audit_log").delete().in("entity_id", jobs);
    await svc.from("audit_log").delete().in("diff->>jobId", jobs);
  }, 60_000);

  it("scénáře dávají očekávané klíče", async () => {
    const { data } = await svc.from("job_flow_v").select("*").in("id", jobs);
    const byNum = new Map(((data ?? []) as Row[]).map((r) => [String(r.number).slice(PREFIX.length + 1), r]));
    const pick = (k: string, ...cols: string[]) => Object.fromEntries(cols.map((c) => [c, byNum.get(k)?.[c] ?? null]));
    expect(pick("1", "inquiry_key", "pricing_key")).toEqual({ inquiry_key: "prijata", pricing_key: "ceka" });
    expect(pick("2", "inquiry_key", "waiting_days")).toEqual({ inquiry_key: "ceka_na_podklady", waiting_days: 3 });
    expect(pick("3", "pricing_key")).toEqual({ pricing_key: "ceka_na_dodavatele" });
    expect(pick("4", "status", "quote_key", "inquiry_key", "waiting_days")).toEqual({ status: "nabidka", quote_key: "vyprsela", inquiry_key: "zpracovana", waiting_days: 5 });
    expect(pick("5", "quote_key", "quote_revision")).toEqual({ quote_key: "pripominky", quote_revision: 2 });
    expect(pick("6", "order_key", "confirmation_key")).toEqual({ order_key: "dorucena", confirmation_key: "vystaveno" });
    expect(pick("7", "order_key", "waiting_days")).toEqual({ order_key: "rozpor", waiting_days: 0 });
    expect(pick("8", "delivery_key", "fulfilment_key")).toEqual({ delivery_key: "castecne", fulfilment_key: "castecne_dodana" });
    expect(pick("9", "status", "delivery_key")).toEqual({ status: "dodano_zakaznikovi", delivery_key: "dodano" });
    expect(pick("10", "payment_key", "status")).toEqual({ payment_key: "po_splatnosti", status: "fakturovano" });
    expect(pick("11", "delivery_key", "fulfilment_key")).toEqual({ delivery_key: "castecne", fulfilment_key: "castecne_dodana" });
    expect(pick("12", "status", "order_key", "payment_key")).toEqual({ status: "zruseno", order_key: "stornovana", payment_key: null });
  });

  it("deriveFlow = job_flow_v pro všechny zakázky v DB", async () => {
    const [orders, quotes, sq, view] = await Promise.all([
      svc.from("orders").select(FLOW_ORDER_COLUMNS).limit(5000),
      svc.from("quotes").select(FLOW_QUOTE_COLUMNS).not("job_id", "is", null).limit(10000),
      svc.from("supplier_quotes").select("job_id").is("total", null).limit(10000),
      svc.from("job_flow_v").select("*").limit(5000),
    ]);
    expect(orders.error).toBeNull();
    expect(view.error).toBeNull();
    const pending = new Map<string, number>();
    for (const r of (sq.data ?? []) as { job_id: string }[]) pending.set(r.job_id, (pending.get(r.job_id) ?? 0) + 1);
    const qByJob = new Map<string, Row[]>();
    for (const q of (quotes.data ?? []) as unknown as Row[]) qByJob.set(String(q.job_id), [...(qByJob.get(String(q.job_id)) ?? []), q]);
    const viewById = new Map(((view.data ?? []) as Row[]).map((v) => [String(v.id), v]));
    const today = pragueToday();
    const rows = (orders.data ?? []) as unknown as Row[];
    expect(rows.length).toBeGreaterThanOrEqual(16 + 12);
    for (const o of rows) {
      const f = flowFactsFromRow(o, { pendingSupplierQuotes: pending.get(String(o.id)) ?? 0 });
      const ts = deriveFlow(f, (qByJob.get(String(o.id)) ?? []).map(quoteFactsFromRow), today);
      const { activeQuote, orderedWithoutQuote, ...keys } = ts;
      void orderedWithoutQuote;
      const v = viewById.get(String(o.id))!;
      expect(keys, `${o.id}`).toEqual(snapshotKeysFromView(v));
      expect(activeQuote?.id ?? null, `${o.id} aktivní nabídka`).toBe(v.quote_id ?? null);
    }
  });

  it("flow_counts sčítá stejné klíče", async () => {
    const { data, error } = await svc.rpc("flow_counts", { p_closed_days: 3650 });
    expect(error).toBeNull();
    const counts = new Map(((data ?? []) as { flow_phase: string; flow_key: string; n: number }[]).map((r) => [`${r.flow_phase}.${r.flow_key}`, r.n]));
    const { count } = await svc.from("job_flow_v").select("id", { count: "exact", head: true }).eq("order_key", "rozpor");
    expect(counts.get("order.rozpor")).toBe(count);
    expect(counts.get("quote.vyprsela") ?? 0).toBeGreaterThanOrEqual(1);
  });
});
