import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * E2E serverových akcí nákupu proti lokálnímu Supabase (tools/local-supabase):
 * nabídky dodavatelů → vítěz → návrh → vystavení (PDF do úložiště) → úprava → e-mail
 * (mail catcher) → potvrzení → dodání → obchodník; provize z DB triggeru.
 * Mockuje se jen přihlášení (session) a revalidace Next.js. Spuštění:
 *   LOCAL_SUPABASE=1 npx vitest run src/app/actions/purchasing.integration.test.ts
 * Pracuje s demo zakázkou Z-2026-106 a vše po sobě vrátí.
 */

const ENABLED = process.env.LOCAL_SUPABASE === "1";
const JOB = "d0000000-0000-0000-0000-000000000006"; // Z-2026-106, ve výrobě
const HRUBY = "d4000000-0000-0000-0000-000000000001";
const OWNER = "156c7996-b488-4c53-a3f5-e51dd004f4ad"; // Petr Obchodník (obchodnik, 10 %)
const MAIL_TO = `e2e-dodavatel-${Date.now()}@local.test`;

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

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

vi.mock("@/lib/supabase/server", async () => {
  const fs = await import("node:fs");
  const p = await import("node:path");
  const sb = await import("@supabase/supabase-js");
  const env: Record<string, string> = {};
  const file = p.resolve(process.cwd(), ".local-supabase/env");
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m) env[m[1]] = m[2];
    }
  }
  const admin = () => sb.createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    isSupabaseConfigured: () => true,
    hasServiceKey: () => true,
    createAdminClient: admin,
    createOperatorClient: async () => admin(),
    createClient: async () => {
      throw new Error("Bez session (test).");
    },
  };
});

/** Role přihlášeného (#25: obchodníka zakázky mění jen super admin — test přepne roli). */
const who = vi.hoisted(() => ({ role: "obchodnik" as "obchodnik" | "super_admin" }));

vi.mock("@/lib/auth/session", () => {
  const user = {
    id: "156c7996-b488-4c53-a3f5-e51dd004f4ad",
    email: "obchod@local.test",
    fullName: "Petr Obchodník",
    get role() { return who.role; },
    initials: "PO",
    roleLabel: "Obchodník",
    aiAccess: true,
    active: true,
    hasProfile: true,
  };
  return {
    getSessionUser: async () => user,
    getAccess: async () => ({ user, ctx: {}, features: [], can: () => true }),
    checkFeature: async () => ({ user }),
    apiRequire: async () => ({ user }),
    requireUser: async () => user,
    requireFeature: async () => user,
  };
});

type Actions = typeof import("./purchasing");

/** Projde data události a vrátí všechna čísla (nákupní ceny do historie nepatří). */
function numbersIn(v: unknown, out: number[] = []): number[] {
  if (typeof v === "number") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => numbersIn(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => numbersIn(x, out));
  return out;
}

describe.skipIf(!ENABLED)("akce nákupu ↔ lokální Supabase (E2E)", () => {
  let db: SupabaseClient;
  let a: Actions;
  let snapshot: Record<string, unknown>;
  let counterBefore: { year: number; counter: number } | null = null;
  const startedAt = new Date(Date.now() - 1000).toISOString();
  const quoteIds: string[] = [];
  let poId = "";
  let adminId = "";

  async function commission() {
    const { data } = await db.from("commission_entries").select("*").eq("order_id", JOB).single();
    return data as { owner_id: string; cost: string; profit: string; commission: string; rate: string };
  }

  async function job() {
    const { data } = await db.from("orders").select("*").eq("id", JOB).single();
    return data as Record<string, unknown>;
  }

  beforeAll(async () => {
    const env = loadEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    snapshot = await job();
    const { data: c } = await db.from("doc_counters").select("year, counter").eq("doc_type", "OV").maybeSingle();
    counterBefore = (c as { year: number; counter: number } | null) ?? null;
    const { data: adm } = await db.from("profiles").select("id").eq("role", "super_admin").limit(1).single();
    adminId = (adm as { id: string }).id;
    a = await import("./purchasing");
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    if (poId) await db.from("purchase_orders").delete().eq("id", poId);
    await db.from("purchase_orders").delete().eq("job_id", JOB).gte("created_at", startedAt);
    if (quoteIds.length) await db.from("supplier_quotes").delete().in("id", quoteIds);
    const { data: files } = await db.from("job_files").select("id, storage_path").eq("job_id", JOB).gte("created_at", startedAt);
    const rows = (files ?? []) as { id: string; storage_path: string }[];
    if (rows.length) {
      await db.storage.from("job-files").remove(rows.map((f) => f.storage_path));
      await db.from("job_files").update({ replaced_by: null }).in("id", rows.map((f) => f.id));
      await db.from("job_files").delete().in("id", rows.map((f) => f.id));
    }
    await db.from("job_events").delete().eq("job_id", JOB).gte("created_at", startedAt);
    await db.from("emails").delete().eq("order_id", JOB).gte("created_at", startedAt);
    await db.from("audit_log").delete().gte("created_at", startedAt).in("entity", ["purchase_orders", "supplier_quotes", "orders", "job_files", "suppliers"]);
    const restore: Record<string, unknown> = {};
    for (const k of ["supplier_id", "supplier_order_number", "purchase_cost", "supplier_promised_date", "owner_id", "status", "received_at", "stage_changed_at"]) {
      restore[k] = snapshot[k];
    }
    await db.from("orders").update(restore).eq("id", JOB);
    if (counterBefore) await db.from("doc_counters").update(counterBefore).eq("doc_type", "OV");
    else await db.from("doc_counters").delete().eq("doc_type", "OV");
    const api = loadEnv().LOCAL_MAIL_API ?? "http://127.0.0.1:54324";
    await fetch(`${api}/messages?to=${encodeURIComponent(MAIL_TO)}`, { method: "DELETE" }).catch(() => undefined);
  }, 60_000);

  it("nabídky dodavatelů: založení, dopočet termínu a ceny, vítěz", async () => {
    const r1 = await a.createSupplierQuote(JOB, {
      supplierId: HRUBY, number: "NAB-E2E-1", quoteDate: "2026-10-20", leadTimeDays: 14,
      items: [{ drawingNumber: "E2E-100", name: "Hřídel E2E", material: "C45", quantity: 10, unitPrice: 2500 }],
    });
    expect(r1).toMatchObject({ ok: true });
    quoteIds.push(r1.id!);
    const r2 = await a.createSupplierQuote(JOB, { supplierName: "Brusírna E2E", number: "NB-2", total: 27_000, items: [] });
    expect(r2.ok).toBe(true);
    quoteIds.push(r2.id!);
    expect((await a.createSupplierQuote(JOB, { supplierName: "X", items: [] })).error).toBe("Zadej položky nebo celkovou cenu nabídky.");

    const { data: q } = await db.from("supplier_quotes").select("total, delivery_date, created_by").eq("id", r1.id!).single();
    expect(q).toMatchObject({ total: 25000, delivery_date: "2026-11-03", created_by: OWNER });

    expect((await a.selectWinningSupplierQuote(r2.id!)).ok).toBe(true);
    expect((await a.selectWinningSupplierQuote(r1.id!)).ok).toBe(true);
    const { data: sel } = await db.from("supplier_quotes").select("id").eq("job_id", JOB).eq("selected", true);
    expect((sel ?? []).map((x) => x.id)).toEqual([r1.id]);
    const j = await job();
    expect(Number(j.purchase_cost)).toBe(25_000);
    expect(Number((await commission()).cost)).toBe(25_000);

    const up = await a.updateSupplierQuote(r1.id!, { items: [{ drawingNumber: "E2E-100", name: "Hřídel E2E", quantity: 10, unitPrice: 2400 }] });
    expect(up.ok).toBe(true);
    expect(Number((await job()).purchase_cost)).toBe(24_000);
  }, 60_000);

  it("návrh → vystavení objednávky s PDF v Dokumentech zakázky", async () => {
    const dr = await a.draftPurchaseOrder(JOB);
    expect(dr.ok).toBe(true);
    const d = dr.draft!;
    expect(d).toMatchObject({ supplierId: HRUBY, supplierQuoteId: quoteIds[0], itemsSource: "nabidka_dodavatele", total: 24_000, requiredDate: "2026-11-03" });
    expect(d.supplier?.email).toBe("objednavky@hruby-cnc.cz");
    expect(d.deliveryAddress).toContain("\n");
    expect(d.note).toContain("Z-2026-106");

    const res = await a.issuePurchaseOrder(JOB, d);
    expect(res.ok, res.error).toBe(true);
    expect(res.number).toMatch(/^OV-\d{4}-\d{3,}$/);
    expect(res.pdfError).toBeUndefined();
    expect(res.fileId).toBeTruthy();
    poId = res.id!;

    const { data: po } = await db.from("purchase_orders").select("*, items:purchase_order_items(*)").eq("id", poId).single();
    expect(po).toMatchObject({ status: "vystavena", total: 24000, supplier_id: HRUBY, file_id: res.fileId, created_by: OWNER });
    const { data: file } = await db.from("job_files").select("kind, filename, storage_path, version").eq("id", res.fileId!).single();
    expect(file).toMatchObject({ kind: "objednavka_vydana", filename: `Objednavka_${res.number}.pdf`, version: 1 });
    const { data: blob } = await db.storage.from("job-files").download((file as { storage_path: string }).storage_path);
    const buf = Buffer.from(await blob!.arrayBuffer());
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");

    const j = await job();
    expect(j.supplier_order_number ?? snapshot.supplier_order_number).toBeTruthy();
    const c = await commission();
    expect(Number(c.cost)).toBe(24_000);
    expect(Number(c.commission)).toBeCloseTo((Number(snapshot.value) - 24_000) * 0.1, 2);
  }, 60_000);

  it("úprava položek před odesláním → nový total, nové PDF (v2), provize", async () => {
    const r = await a.updatePurchaseOrder(poId, {
      items: [{ drawingNumber: "E2E-100", name: "Hřídel E2E", quantity: 12, unitPrice: 2400 }],
      note: "Upraveno v testu",
    });
    expect(r.ok, r.error).toBe(true);
    expect(r.fileId).toBeTruthy();
    const { data: f } = await db.from("job_files").select("version, archived").eq("id", r.fileId!).single();
    expect(f).toMatchObject({ version: 2, archived: false });
    expect(Number((await commission()).cost)).toBe(28_800);
    expect((await a.regeneratePurchaseOrderPdf(poId)).ok).toBe(true);
  }, 60_000);

  it("API náhled PDF: uložená objednávka, návrh z dialogu, neplatné id", async () => {
    const route = await import("@/app/api/pdf/purchase-order/[id]/route");
    const res = await route.GET(new Request(`http://localhost/api/pdf/purchase-order/${poId}`), { params: Promise.resolve({ id: poId }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toMatch(/^inline; filename="Objednavka_OV-/);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    if (process.env.PDF_PREVIEW === "1") writeFileSync("/tmp/claude-0/pdf-preview/objednavka-vydana-e2e.pdf", buf);

    const dr = await a.draftPurchaseOrder(JOB, { supplierQuoteId: quoteIds[1] });
    expect(dr.draft).toMatchObject({ supplierId: null, supplierName: "Brusírna E2E", itemsSource: "zakazka" });
    const post = await route.POST(
      new Request("http://localhost/api/pdf/purchase-order/draft", { method: "POST", body: JSON.stringify({ jobId: JOB, draft: dr.draft }) }),
      { params: Promise.resolve({ id: "draft" }) },
    );
    expect(post.status).toBe(200);
    expect(Buffer.from(await post.arrayBuffer()).subarray(0, 4).toString("latin1")).toBe("%PDF");

    const bad = await route.GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: "nope" }) });
    expect(bad.status).toBe(404);
    const badPost = await route.POST(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ jobId: JOB, draft: { items: [] } }) }),
      { params: Promise.resolve({ id: "draft" }) },
    );
    expect(badPost.status).toBe(400);
  }, 60_000);

  it("e-mail dodavateli s PDF v příloze → stav Odeslána", async () => {
    const m = await a.draftPurchaseOrderEmail(poId);
    expect(m.ok).toBe(true);
    expect(m.to).toBe("objednavky@hruby-cnc.cz");
    expect(m.subject).toMatch(/^Objednávka OV-\d{4}-\d+ — /);
    expect(m.body).toContain("Petr Obchodník");

    expect((await a.sendPurchaseOrder(poId, { to: "spatna-adresa", subject: "x", body: "y" })).error).toBe("Zadej platný e-mail dodavatele.");
    const s = await a.sendPurchaseOrder(poId, { to: MAIL_TO, subject: m.subject!, body: m.body! });
    expect(s.ok, s.error).toBe(true);

    const api = loadEnv().LOCAL_MAIL_API ?? "http://127.0.0.1:54324";
    const msg = await (await fetch(`${api}/messages/latest?to=${encodeURIComponent(MAIL_TO)}&wait=3000`)).json();
    expect(msg.subject).toBe(m.subject);
    expect(msg.attachments).toEqual([expect.objectContaining({ contentType: "application/pdf", filename: expect.stringMatching(/^Objednavka_OV-/) })]);

    const { data: po } = await db.from("purchase_orders").select("status, sent_at").eq("id", poId).single();
    expect(po!.status).toBe("odeslana");
    expect(po!.sent_at).toBeTruthy();
    expect((await a.updatePurchaseOrder(poId, { items: [{ name: "x", quantity: 1 }] })).error).toMatch(/už odešla/);
  }, 60_000);

  it("potvrzení dodavatelem → slíbený termín v zakázce; dodání → Dodáno k nám", async () => {
    expect((await a.updatePurchaseOrder(poId, { status: "dodana", confirmedDate: "x" })).error).toBe("Neplatné datum.");
    const r = await a.updatePurchaseOrder(poId, { status: "potvrzena", confirmedDate: "2026-11-05", supplierReference: "POT-777" });
    expect(r.ok, r.error).toBe(true);
    expect((await job()).supplier_promised_date).toBe("2026-11-05");
    expect((await a.updatePurchaseOrder(poId, { status: "odeslana" })).error).toMatch(/Stav nelze změnit/);

    const del = await a.updatePurchaseOrder(poId, { status: "dodana" });
    expect(del.ok).toBe(true);
    expect(del.stage).toBe("dodano_k_nam");
    expect((await job()).status).toBe("dodano_k_nam");
  }, 60_000);

  it("obchodník zakázky → provize jiného obchodníka; nabídku lze smazat", async () => {
    // #25: obchodníka zakázky (komu patří provize) mění jen super admin
    expect((await a.assignJobOwner(JOB, adminId)).error).toBe("Obchodníka zakázky mění jen super admin.");
    expect((await commission()).owner_id).toBe(OWNER);
    who.role = "super_admin";
    try {
      const r = await a.assignJobOwner(JOB, adminId);
      expect(r.ok).toBe(true);
      expect(r.commission?.ownerId).toBe(adminId);
      expect((await commission()).owner_id).toBe(adminId);
      const back = await a.assignJobOwner(JOB, OWNER);
      expect(back.commission).toMatchObject({ ownerId: OWNER, ownerName: "Petr Obchodník", rate: 0.1 });
      expect((await a.assignJobOwner(JOB, "00000000-0000-0000-0000-000000000000")).error).toMatch(/Uživatel nenalezen/);
    } finally {
      who.role = "obchodnik";
    }

    expect((await a.deleteSupplierQuote(quoteIds[1])).ok).toBe(true);
  }, 60_000);

  it("historie zakázky: žádné nákupní ceny", async () => {
    const { data } = await db.from("job_events").select("type, message, data").eq("job_id", JOB).gte("created_at", startedAt);
    const events = (data ?? []) as { type: string; message: string; data: Record<string, unknown> }[];
    expect(events.length).toBeGreaterThan(8);
    const prices = [2400, 2500, 24_000, 25_000, 27_000, 28_800];
    for (const e of events) {
      expect(e.message).not.toMatch(/Kč|24 000|25 000|28 800/);
      expect(numbersIn(e.data).filter((n) => prices.includes(n))).toEqual([]);
    }
    expect(events.map((e) => e.message).join("\n")).toMatch(/Vystavena objednávka OV-\d{4}-\d+ dodavateli Kovoobrábění Hrubý s\.r\.o\./);
  }, 60_000);
});
