import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BatchApplyState, BatchReviewModel, BatchSortModel } from "@/lib/jobs/capture-batch-types";
import { DEMO, localAdmin, localSession, localSql } from "@/test/local-supabase";
import { userActor } from "@/lib/supabase/actor-headers";
import type { AllocationInput } from "@/lib/supplier-invoices/types";

/**
 * Faktury dodavatelů proti lokálnímu Supabase (testovací AI: AI_FAKE_CAPTURE + batch/sinv*.json):
 * zaměstnanec vyfotí objednávku + fakturu dodavatele v jedné dávce → objednávka jako dřív, faktura do Faktur
 * dodavatelů („Děkujeme, nahráno"), nic z ní nepřečte (data, akce, soubory, REST, hledání); super admin ji vidí,
 * AI navrhne rozdělení podle OV-…, rozdělí 10 000 / 20 000 na dvě zakázky + režie, potvrdí; náklady a provize
 * bez dvojího počítání; zaplaceno jen super admin; duplicita; dodavatel z hlavičky; přepínač „všichni".
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/supplier-invoices/supplier-invoices.integration.test.ts
 */

const ENABLED = process.env.LOCAL_SUPABASE === "1";
const FIXTURES = path.resolve(process.cwd(), "src/lib/jobs/__fixtures__/capture");
const HRUBY = "d4000000-0000-0000-0000-000000000001";
const PO_NUMBER = "OV-2099-901";

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

const h = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null, forAll: false, after: [] as Promise<unknown>[],
  /** Během čtení AI (simulace: super admin mezitím fakturu upraví). */
  duringRead: null as null | (() => Promise<void>),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/ai/supplier-invoice-reader", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/supplier-invoice-reader")>("@/lib/ai/supplier-invoice-reader");
  return {
    ...actual,
    readSupplierInvoice: async (input: Parameters<typeof actual.readSupplierInvoice>[0]) => {
      const res = await actual.readSupplierInvoice(input);
      if (h.duringRead) await h.duringRead();
      return res;
    },
  };
});
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  // after(): zpracování „po odpovědi" — test na něj počká
  return { ...actual, after: (fn: () => unknown) => { h.after.push(Promise.resolve().then(fn)); } };
});

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
  const headers = await import("@/lib/supabase/actor-headers");
  const admin = (opts: { actor?: unknown } = {}) => sb.createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(opts.actor ? { global: { headers: headers.actorHeaders(opts.actor as never) } } : {}),
  });
  return {
    isSupabaseConfigured: () => true,
    hasServiceKey: () => true,
    createAdminClient: admin,
    createOperatorClient: async (opts: { actor?: unknown } = {}) => admin(opts),
    createClient: async () => { throw new Error("Bez session (test)."); },
  };
});

vi.mock("@/lib/auth/session", async () => {
  const perms = await import("@/lib/auth/permissions");
  const { NextResponse } = await vi.importActual<typeof import("next/server")>("next/server");
  const ctx = () => ({ aiEnabled: true, aiCaptureForAll: true, aiConfigured: true, supplierInvoicesForAll: h.forAll });
  const access = () => ({
    user: h.user, ctx: ctx(), features: perms.allowedFeatures(h.user as never, ctx()),
    can: (f: string) => perms.can(h.user as never, f as never, ctx()),
  });
  return {
    getSessionUser: async () => h.user,
    getAccess: async () => access(),
    getAccessContext: async () => ctx(),
    checkFeature: async (f: string) => (perms.can(h.user as never, f as never, ctx()) ? { user: h.user } : { error: "K této akci nemáš oprávnění." }),
    apiRequire: async (f?: string) => (!h.user ? NextResponse.json({ error: "Nepřihlášen." }, { status: 401 })
      : f && !perms.can(h.user as never, f as never, ctx()) ? NextResponse.json({ error: "Bez oprávnění." }, { status: 403 }) : { user: h.user }),
    requireUser: async () => h.user,
    requireFeature: async () => h.user,
  };
});

type Service = typeof import("@/lib/jobs/capture-service");
type Batch = typeof import("@/lib/jobs/capture-batch-service");
type Actions = typeof import("@/app/actions/supplier-invoices");
type Data = typeof import("@/lib/data/supplier-invoices");
type Core = typeof import("./service");
type Upload = typeof import("./upload");

function person(id: string, email: string, role: string, fullName: string) {
  return { id, email, fullName, role, initials: "TT", roleLabel: role, aiAccess: false, active: true, hasProfile: true, mustChangePassword: false };
}

const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const png = (seed: number) => Buffer.concat([PNG_1x1, Buffer.from([seed, seed >> 8])]);

describe.skipIf(!ENABLED)("Faktury dodavatelů ↔ lokální Supabase", () => {
  let db: SupabaseClient;
  let s: Service;
  let b: Batch;
  let act: Actions;
  let data: Data;
  let core: Core;
  let up: Upload;
  let admin: ReturnType<typeof person>;
  let sales: ReturnType<typeof person>;
  let worker: ReturnType<typeof person>;
  const RUN = Date.now().toString(36);
  const TAG = `E2E-sinv-${RUN}`;
  const startedAt = new Date(Date.now() - 1000).toISOString();
  let jobA = "";
  let jobB = "";
  let poA = "";
  let invoiceId = "";
  const invoiceIds = new Set<string>();
  const captureIds = new Set<string>();
  const createdJobs = new Set<string>();
  const createdSuppliers = new Set<string>();

  async function upload(filename: string, body: Buffer, mimeType = "image/png") {
    const prep = await s.prepareCaptureUpload({ filename, size: body.length, mimeType });
    if (!prep.ok) throw new Error(prep.error);
    const { error } = await db.storage.from("job-files").uploadToSignedUrl(prep.path!, prep.token!, body, { contentType: mimeType });
    expect(error).toBeNull();
    return { path: prep.path!, filename, mimeType, size: body.length };
  }

  async function analyze(files: Awaited<ReturnType<typeof upload>>[]): Promise<BatchSortModel> {
    const res = await s.analyzeCapture({ files });
    if (!res.ok || !("batch" in res)) throw new Error(`Čekám dávku: ${JSON.stringify(res).slice(0, 400)}`);
    captureIds.add(res.batch.captureId);
    return res.batch;
  }

  async function jobCost(id: string): Promise<string> {
    return localSql(`select cost::text || '|' || known::text from job_cost('${id}')`);
  }

  async function commissionCost(id: string): Promise<number> {
    const { data: c } = await db.from("commission_entries").select("cost").eq("order_id", id).single();
    return Number((c as { cost: number }).cost);
  }

  async function cleanupInvoices(where: string) {
    const ids = localSql(`select coalesce(string_agg(id::text, ','), '') from supplier_invoices where ${where}`).split(",").filter(Boolean);
    if (!ids.length) return;
    const { data: f } = await db.from("supplier_invoice_files").select("storage_path").in("invoice_id", ids);
    const paths = ((f ?? []) as { storage_path: string }[]).map((x) => x.storage_path);
    if (paths.length) await db.storage.from("supplier-invoices").remove(paths);
    localSql(`delete from approval_queue where type::text = 'supplier_invoice' and payload->>'invoiceId' in (${ids.map((x) => `'${x}'`).join(",")})`);
    // nejdřív duplicity (smazání originálu by jim vynulovalo odkaz → unikátní index dodavatel + číslo)
    await db.from("supplier_invoices").delete().in("id", ids).not("duplicate_of_id", "is", null);
    await db.from("supplier_invoices").delete().in("id", ids);
  }

  beforeAll(async () => {
    const env = loadEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    process.env.AI_FAKE_CAPTURE = path.join(FIXTURES, "objednavka-strojmetal.json");
    db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
    const { data: profiles } = await db.from("profiles").select("id, email, full_name, role");
    const by = (email: string) => (profiles ?? []).find((p) => p.email === email)!;
    admin = person(by(DEMO.admin.email).id, DEMO.admin.email, "super_admin", "Admin");
    sales = person(by(DEMO.sales.email).id, DEMO.sales.email, "obchodnik", "Obchod");
    worker = person(by(DEMO.worker.email).id, DEMO.worker.email, "zamestnanec", "Dílna");
    // zbytky dřívějších běhů (stejná faktura by byla duplicita)
    await cleanupInvoices(`(supplier_key = '25874411' and number_norm = 'FA20260815') or supplier_key = '27999990'`);
    localSql(`delete from purchase_orders where number = '${PO_NUMBER}'`);
    localSql(`update integration_settings set value = 'super_admin' where key = 'supplier_invoices_visibility'`);
    localSql(`update automation_settings set mode = 'approval' where module = 'supplier_invoice'`);
    // dvě zakázky obchodníka (sdružená faktura) a objednávka dodavateli OV-2099-901 u zakázky A
    const mk = async (suffix: string, value: number, planned: number | null) => {
      const { data: j, error } = await db.from("orders").insert({
        number: `${TAG}-${suffix}`, title: `Faktury dodavatelů ${suffix}`, status: "potvrzeno", value, purchase_cost: planned,
        owner_id: sales.id, order_date: "2026-10-20",
      }).select("id").single();
      if (error) throw new Error(error.message);
      createdJobs.add((j as { id: string }).id);
      return (j as { id: string }).id;
    };
    jobA = await mk("A", 100_000, null);
    jobB = await mk("B", 50_000, 5_000);
    const { data: po, error: pe } = await db.from("purchase_orders").insert({ job_id: jobA, supplier_id: HRUBY, number: PO_NUMBER, status: "potvrzena", total: 30_000 }).select("id").single();
    if (pe) throw new Error(pe.message);
    poA = (po as { id: string }).id;
    s = await import("@/lib/jobs/capture-service");
    b = await import("@/lib/jobs/capture-batch-service");
    act = await import("@/app/actions/supplier-invoices");
    data = await import("@/lib/data/supplier-invoices");
    core = await import("./service");
    up = await import("./upload");
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    h.forAll = false;
    localSql(`update integration_settings set value = 'super_admin' where key = 'supplier_invoices_visibility'`);
    if (invoiceIds.size) await cleanupInvoices(`id in (${[...invoiceIds].map((x) => `'${x}'`).join(",")})`);
    await cleanupInvoices(`created_at >= '${startedAt}' and (supplier_key in ('25874411', '27999990') or uploaded_by in ('${admin.id}', '${sales.id}', '${worker.id}'))`);
    for (const id of captureIds) {
      const { data: j } = await db.from("orders").select("id").like("capture_key", `${id}:%`);
      for (const r of (j ?? []) as { id: string }[]) createdJobs.add(r.id);
      const { data: sess } = await db.from("capture_sessions").select("data").eq("id", id).maybeSingle();
      const fs = ((sess as { data?: { files?: { path: string; sortPath?: string }[] } } | null)?.data?.files ?? []);
      if (fs.length) await db.storage.from("job-files").remove(fs.flatMap((x) => [x.path, ...(x.sortPath ? [x.sortPath] : [])]));
      await db.from("capture_sessions").delete().eq("id", id);
    }
    await db.from("purchase_orders").delete().eq("number", PO_NUMBER);
    const jobs = [...createdJobs];
    if (jobs.length) {
      const { data: f } = await db.from("job_files").select("storage_path").in("job_id", jobs);
      const paths = ((f ?? []) as { storage_path: string }[]).map((x) => x.storage_path);
      if (paths.length) await db.storage.from("job-files").remove(paths);
      await db.from("commission_entries").delete().in("order_id", jobs);
      await db.from("orders").delete().in("id", jobs);
    }
    for (const id of createdSuppliers) await db.from("suppliers").delete().eq("id", id);
    await db.from("ai_training_examples").delete().gte("created_at", startedAt).in("created_by", [admin.id, sales.id, worker.id]);
  }, 120_000);

  it("zaměstnanec: objednávka + faktura dodavatele v jedné dávce → objednávka jako dřív, faktura do Faktur dodavatelů", async () => {
    h.user = worker;
    const files = [await upload(`${TAG}__objednavka_zakaznik.png`, png(1)), await upload(`${TAG}__faktura_dodavatel.png`, png(2))];
    const batch = await analyze(files);
    const active = batch.sort.docs.filter((d) => !d.excluded);
    expect(active.map((d) => d.type).sort()).toEqual(["faktura_dodavatel", "objednavka_zakaznik"]);
    const inv = active.find((d) => d.type === "faktura_dodavatel")!;
    for (const d of active) {
      const r = await b.captureBatchExtract({ captureId: batch.captureId, docId: d.id, type: d.type, pageIds: d.pageIds });
      if (!r.ok) throw new Error(r.error);
      expect(r.summary.status).toBe("ready");
      if (d.id === inv.id) {
        expect(r.summary.title).toBe("Faktura dodavatele → Faktury dodavatelů");
        expect(r.summary.documentNumber).toBe("");
      }
    }
    const rv = await b.captureBatchReview({ captureId: batch.captureId, sort: batch.sort });
    if (!rv.ok) throw new Error(rv.error);
    const review: BatchReviewModel = rv.review;
    expect(review.groups).toHaveLength(1);
    expect(review.groups[0].docIds).not.toContain(inv.id);
    expect(review.docs.some((d) => d.docId === inv.id)).toBe(false);
    expect(review.supplierInvoices).toEqual([{ docId: inv.id, pageIds: inv.pageIds, aiUsed: true }]);   // bez údajů
    expect(JSON.stringify(review)).not.toContain("FA-2026-0815");
    const res = await b.captureBatchApply({ captureId: batch.captureId, state: review.initial as BatchApplyState });
    expect(res.status, JSON.stringify({ docs: res.docs, err: res.error })).toBe("done");
    for (const g of res.groups) if (g.jobId && g.created) createdJobs.add(g.jobId);
    const invRes = res.docs.find((d) => d.docId === inv.id)!;
    expect(invRes).toMatchObject({ ok: true, supplierInvoice: true, jobId: null, links: [], summary: "Děkujeme, nahráno — fakturu zpracuje super admin." });
    expect(invRes.supplierInvoiceId).toBeUndefined();
    expect(JSON.stringify(res)).not.toContain("FA-2026-0815");
    const order = res.docs.find((d) => d.type === "objednavka_zakaznik")!;
    expect(order.ok).toBe(true);
    // faktura: řádek v evidenci, soubor v bucketu faktur, žádný dokument zakázky
    const { data: row } = await db.from("supplier_invoices").select("*").eq("capture_key", `${batch.captureId}:${inv.id}`).single();
    const r = row as Record<string, unknown>;
    invoiceId = r.id as string;
    invoiceIds.add(invoiceId);
    expect(r).toMatchObject({ uploaded_by: worker.id, supplier_id: HRUBY, number: "FA-2026-0815", variable_symbol: "20260815", source: "photo", ai_used: true });
    expect(Number(r.total_gross)).toBe(38_115);
    const { data: fl } = await db.from("supplier_invoice_files").select("storage_path").eq("invoice_id", invoiceId);
    expect(fl).toHaveLength(1);
    const dl = await db.storage.from("supplier-invoices").download((fl as { storage_path: string }[])[0].storage_path);
    expect(dl.error).toBeNull();
    const { data: jf } = await db.from("job_files").select("kind").eq("job_id", order.jobId!);
    expect(((jf ?? []) as { kind: string }[]).some((x) => x.kind === "faktura")).toBe(false);
    // headline dávky (jen zaměstnanci): objednávka uložená, faktura „nahráno"
    const { batchResultHeadline } = await import("@/lib/jobs/capture-batch");
    expect(batchResultHeadline({ groups: [], docs: [invRes] })).toBe("Děkujeme, nahráno");
  }, 120_000);

  it("obchodník (má nákupní ceny, faktury ale nevidí): vytěžení dávky nenese číslo faktury ani dodavatele", async () => {
    h.user = sales;
    const batch = await analyze([await upload(`${TAG}-obch__objednavka_zakaznik.png`, png(4)), await upload(`${TAG}-obch__faktura_dodavatel.png`, png(3))]);
    const inv = batch.sort.docs.find((d) => !d.excluded && d.type === "faktura_dodavatel")!;
    const r = await b.captureBatchExtract({ captureId: batch.captureId, docId: inv.id, type: inv.type, pageIds: inv.pageIds });
    if (!r.ok) throw new Error(r.error);
    expect(r.summary).toMatchObject({ title: "Faktura dodavatele → Faktury dodavatelů", documentNumber: "" });
    expect(JSON.stringify(r)).not.toMatch(/FA-2026-0815|Hrubý/);
  }, 60_000);

  it("zaměstnanec ani obchodník z faktury nic nepřečte (data, akce, soubory, podepsané URL, REST, hledání)", async () => {
    for (const u of [worker, sales]) {
      h.user = u;
      expect(await data.listSupplierInvoices()).toBeNull();
      expect(await data.getSupplierInvoice(invoiceId)).toBeNull();
      expect(await data.getJobInvoiceCosts(jobA)).toBeNull();
      expect(await data.supplierInvoiceCounts()).toBeNull();
      expect(await data.supplierInvoiceSearchEntries()).toEqual([]);
      for (const r of [
        await act.saveSupplierInvoiceAllocations(invoiceId, []), await act.confirmSupplierInvoiceAi(invoiceId),
        await act.setSupplierInvoicePayment(invoiceId, { status: "zaplaceno" }), await act.updateSupplierInvoiceHeader(invoiceId, { number: "X" }),
        await act.deleteSupplierInvoice(invoiceId), await act.searchJobsForSupplierInvoice("Z-"), await act.setSupplierInvoiceVisibility("all"),
      ]) {
        expect(r.ok).toBe(false);
      }
      expect(await act.jobSupplierInvoices(jobA)).toEqual({ ok: true, data: null, visibility: "super_admin" });
      const { data: f } = await db.from("supplier_invoice_files").select("id").eq("invoice_id", invoiceId).single();
      const { GET } = await import("@/app/api/supplier-invoices/files/[id]/route");
      const resp = await GET(new Request("http://localhost/api/supplier-invoices/files/x"), { params: Promise.resolve({ id: (f as { id: string }).id }) });
      expect(resp.status).toBe(403);
      const search = await (await import("@/app/api/search/route")).GET();
      expect(((await search.json()) as { supplierInvoices?: unknown[] }).supplierInvoices ?? []).toEqual([]);
    }
    // druhá linie: REST session (RLS + úložiště)
    const w = await localSession(DEMO.worker.email, DEMO.worker.password);
    expect((await w.from("supplier_invoices").select("id").eq("id", invoiceId)).data ?? []).toEqual([]);
    expect((await w.from("supplier_invoice_items").select("id").eq("invoice_id", invoiceId)).data ?? []).toEqual([]);
    const { data: f } = await db.from("supplier_invoice_files").select("storage_path").eq("invoice_id", invoiceId).single();
    const sdl = await w.storage.from("supplier-invoices").download((f as { storage_path: string }).storage_path);
    expect(sdl.error).not.toBeNull();
    const sgn = await w.storage.from("supplier-invoices").createSignedUrl((f as { storage_path: string }).storage_path, 60);
    expect(sgn.data?.signedUrl ?? null).toBeNull();
    const sl = await localSession(DEMO.sales.email, DEMO.sales.password);
    expect((await sl.from("supplier_invoices").select("id").eq("id", invoiceId)).data ?? []).toEqual([]);
    // ani super admin přes REST nečte zaplaceno (sloupce nejsou grantované)
    const ad = await localSession(DEMO.admin.email, DEMO.admin.password);
    expect((await ad.from("supplier_invoices").select("id, number").eq("id", invoiceId)).data).toHaveLength(1);
    expect((await ad.from("supplier_invoices").select("payment_status").eq("id", invoiceId)).error).not.toBeNull();
    expect((await ad.from("supplier_invoices").update({ number: "REST" }).eq("id", invoiceId)).error).not.toBeNull();
  }, 120_000);

  it("super admin: vidí fakturu, AI navrhla rozdělení podle OV-… a režii; čeká ve frontě", async () => {
    h.user = admin;
    const d = (await data.getSupplierInvoice(invoiceId))!;
    expect(d).toMatchObject({ number: "FA-2026-0815", supplier: { id: HRUBY }, status: "ke_kontrole", paymentStatus: "nezaplaceno", totalNet: 31_500 });
    expect(d.items.map((i) => i.amount)).toEqual([30_000, 1_000, 500]);
    expect(d.files[0].href).toMatch(/^\/api\/supplier-invoices\/files\//);
    const byItem = (n: number) => d.allocations.filter((a) => a.itemId === d.items[n].id);
    expect(byItem(0)).toEqual([expect.objectContaining({ target: "job", amount: 30_000, purchaseOrderId: poA, aiSuggested: true, confirmed: false })]);
    expect(byItem(0)[0].job?.id).toBe(jobA);
    expect(byItem(0)[0].aiReason).toMatch(/OV-2099-901/);
    expect(byItem(2)).toEqual([expect.objectContaining({ target: "rezie", category: "doprava", amount: 500 })]);
    const q = localSql(`select status::text from approval_queue where type::text = 'supplier_invoice' and payload->>'invoiceId' = '${invoiceId}'`);
    expect(q).toBe("pending");
    // návrh se do nákladu nepočítá
    expect(await jobCost(jobA)).toBe("30000.00|true");
    const list = (await data.listSupplierInvoices({ view: "ke_kontrole" }))!;
    expect(list.items.some((x) => x.id === invoiceId)).toBe(true);
    expect(list.totals.net).not.toBeNull();
    expect((await data.supplierInvoiceSearchEntries()).some((e) => e.id === invoiceId)).toBe(true);
    const { data: f } = await db.from("supplier_invoice_files").select("id").eq("invoice_id", invoiceId).single();
    const { GET } = await import("@/app/api/supplier-invoices/files/[id]/route");
    const resp = await GET(new Request("http://localhost/api/supplier-invoices/files/x"), { params: Promise.resolve({ id: (f as { id: string }).id }) });
    expect(resp.status).toBe(302);
    expect(resp.headers.get("location")).toMatch(/supplier-invoices/);
  }, 60_000);

  it("rozdělí položku 10 000 / 20 000 na dvě zakázky + režie, potvrdí; náklady a provize bez dvojího počítání", async () => {
    h.user = admin;
    const d = (await data.getSupplierInvoice(invoiceId))!;
    const [i1, i2, i3] = d.items.map((i) => i.id);
    const ai = d.allocations.find((a) => a.itemId === i1)!;
    expect(await commissionCost(jobA)).toBe(30_000);
    expect(await commissionCost(jobB)).toBe(5_000);
    // přes částku položky → chyba (aplikace i DB)
    const over = await act.saveSupplierInvoiceAllocations(invoiceId, [{ id: ai.id, itemId: i1, target: "job", jobId: jobA, category: null, amount: 30_000.01, confirmed: true }]);
    expect(over.ok).toBe(false);
    const dbOver = await db.from("supplier_invoice_allocations").insert({ invoice_id: invoiceId, item_id: i1, target: "job", job_id: jobB, amount: 1 });
    expect(dbOver.error?.message ?? "").toMatch(/přesahuje/);
    const rows = [
      { id: ai.id, itemId: i1, target: "job" as const, jobId: jobA, category: null, amount: 10_000, purchaseOrderId: poA, aiSuggested: true, aiReason: ai.aiReason, confirmed: true },
      { itemId: i1, target: "job" as const, jobId: jobB, category: null, amount: 20_000, confirmed: true },
      { itemId: i2, target: "job" as const, jobId: jobB, category: null, amount: 1_000, confirmed: true },
      { id: d.allocations.find((a) => a.itemId === i3)!.id, itemId: i3, target: "rezie" as const, jobId: null, category: "doprava" as const, amount: 500, confirmed: true },
    ];
    const res = await act.saveSupplierInvoiceAllocations(invoiceId, rows);
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    if (!res.ok) return;
    expect(res.invoice?.status).toBe("zpracovano");
    expect(res.invoice?.allocations.every((a) => a.confirmed)).toBe(true);
    expect(localSql(`select status::text || '|' || (resolved_by = '${admin.id}')::text from approval_queue where type::text = 'supplier_invoice' and payload->>'invoiceId' = '${invoiceId}'`)).toBe("approved|true");
    // A: objednávka 30 000 a na ni DÍLČÍ faktura 10 000 → náklad dál 30 000 (dílčí faktura ho nesníží, provize nevyskočí);
    // B: bez objednávky → 21 000 z faktury (odhad 5 000 už neplatí)
    expect(await jobCost(jobA)).toBe("30000.00|true");
    expect(await jobCost(jobB)).toBe("21000.00|true");
    expect(await commissionCost(jobA)).toBe(30_000);
    expect(await commissionCost(jobB)).toBe(21_000);
    // stejně v kartě marže (aplikace) a v bloku zakázky
    const { getJobPurchasing } = await import("@/lib/data/purchasing");
    const pa = (await getJobPurchasing(jobA))!;
    expect(pa.totals).toMatchObject({ cost: 30_000, costSource: "faktury", profit: 70_000 });
    const jc = (await data.getJobInvoiceCosts(jobA))!;
    expect(jc.confirmedTotal).toBe(10_000);
    expect(jc.invoicedPurchaseOrders).toEqual([{ id: poA, number: PO_NUMBER, poTotal: 30_000, invoiced: 10_000, complete: false, counted: 30_000 }]);
    // „Faktura konečná" (víc faktur na objednávku nepřijde) → náklad = skutečnost 10 000; zpět → 30 000
    expect((await act.setSupplierInvoiceFinalPo(invoiceId, poA, true)).ok).toBe(true);
    expect(await jobCost(jobA)).toBe("10000.00|true");
    expect(await commissionCost(jobA)).toBe(10_000);
    expect((await getJobPurchasing(jobA))!.totals.cost).toBe(10_000);
    expect((await data.getSupplierInvoice(invoiceId))!.purchaseOrderInvoicing).toEqual([
      expect.objectContaining({ id: poA, total: 30_000, invoiced: 10_000, complete: true, final: true }),
    ]);
    expect((await act.setSupplierInvoiceFinalPo(invoiceId, poA, false)).ok).toBe(true);
    expect(await jobCost(jobA)).toBe("30000.00|true");
    expect(await commissionCost(jobA)).toBe(30_000);
    // změna: B pryč → B zpět na odhad, faktura znovu ke kontrole (zbývá rozdělit)
    const without = await act.saveSupplierInvoiceAllocations(invoiceId, [rows[0], rows[3]].map((r, i) => ({ ...r, id: i === 0 ? ai.id : rows[3].id })));
    expect(without.ok).toBe(true);
    expect(await jobCost(jobB)).toBe("5000.00|true");
    expect(await commissionCost(jobB)).toBe(5_000);
    expect(localSql(`select status from supplier_invoices where id = '${invoiceId}'`)).toBe("ke_kontrole");
    // a zpět
    const kept: AllocationInput[] = (await data.getSupplierInvoice(invoiceId))!.allocations.map((a) => ({
      id: a.id, itemId: a.itemId, target: a.target, jobId: a.job?.id ?? null, category: a.category, amount: a.amount!, purchaseOrderId: a.purchaseOrderId, confirmed: true,
    }));
    const back = await act.saveSupplierInvoiceAllocations(invoiceId, [...kept, rows[1], rows[2]]);
    expect(back.ok).toBe(true);
    expect(await commissionCost(jobB)).toBe(21_000);
    // zamítnutá faktura se do nákladů nepočítá
    expect((await act.setSupplierInvoiceRejected(invoiceId, true)).ok).toBe(true);
    expect(await jobCost(jobB)).toBe("5000.00|true");
    expect((await act.setSupplierInvoiceRejected(invoiceId, false)).ok).toBe(true);
    expect(await jobCost(jobB)).toBe("21000.00|true");
    expect(localSql(`select status from supplier_invoices where id = '${invoiceId}'`)).toBe("zpracovano");
  }, 120_000);

  /** Faktura přímo v DB (servisně): hlavička + položky + potvrzené rozdělení. */
  async function seedInvoice(o: {
    number: string; currency?: string; rate?: number | null; proforma?: boolean; net?: number | null;
    items: { text: string; amount: number }[]; allocs?: { item: number | null; jobId?: string | null; poId?: string | null; amount: number; rezie?: boolean }[];
  }): Promise<{ id: string; items: string[] }> {
    const { data: inv, error } = await db.from("supplier_invoices").insert({
      number: o.number, supplier_id: HRUBY, supplier_ico: "25874411", currency: o.currency ?? "CZK", exchange_rate: o.rate ?? null,
      is_proforma: o.proforma ?? false, total_net: o.net === undefined ? o.items.reduce((s2, i) => s2 + i.amount, 0) : o.net, status: "ke_kontrole",
      source: "upload", uploaded_by: admin.id,
    }).select("id").single();
    if (error) throw new Error(error.message);
    const id = (inv as { id: string }).id;
    invoiceIds.add(id);
    const { data: its, error: ie } = await db.from("supplier_invoice_items").insert(o.items.map((i, n) => ({ invoice_id: id, position: n, text: i.text, amount: i.amount }))).select("id, position");
    if (ie) throw new Error(ie.message);
    const ids = ((its ?? []) as { id: string; position: number }[]).sort((a, b2) => a.position - b2.position).map((x) => x.id);
    if (o.allocs?.length) {
      const { error: ae } = await db.from("supplier_invoice_allocations").insert(o.allocs.map((a) => ({
        invoice_id: id, item_id: a.item === null ? null : ids[a.item], target: a.rezie ? "rezie" : "job", job_id: a.rezie ? null : a.jobId ?? null,
        overhead_category: a.rezie ? "ostatni" : null, purchase_order_id: a.poId ?? null, amount: a.amount, confirmed_at: new Date().toISOString(),
      })));
      if (ae) throw new Error(ae.message);
    }
    return { id, items: ids };
  }

  it("dílčí faktury na objednávku: druhá dílčí faktura ji doplní na celou (Σ ≥ 99,5 %) → náklad = Σ faktur", async () => {
    h.user = admin;
    expect(await jobCost(jobA)).toBe("30000.00|true");
    const second = await seedInvoice({ number: `${TAG}-PART2`, items: [{ text: "Zbytek dle OV-2099-901", amount: 19_900 }], allocs: [{ item: 0, jobId: jobA, poId: poA, amount: 19_900 }] });
    expect(await jobCost(jobA)).toBe("29900.00|true");      // 10 000 + 19 900 = 99,7 % → celá
    expect(await commissionCost(jobA)).toBe(29_900);
    // smazání druhé faktury → zase dílčí → 30 000
    await db.from("supplier_invoices").delete().eq("id", second.id);
    invoiceIds.delete(second.id);
    expect(await jobCost(jobA)).toBe("30000.00|true");
    expect(await commissionCost(jobA)).toBe(30_000);
  }, 60_000);

  it("faktura v cizí měně bez kurzu: nikdy 1:1 jako Kč — náklad neznámý, zůstane ke kontrole; s kurzem se přepočte", async () => {
    h.user = admin;
    const before = localSql(`select cost::text from job_cost('${jobB}')`);
    const eur = await seedInvoice({ number: `${TAG}-EUR`, currency: "EUR", items: [{ text: "Broušení", amount: 240 }], allocs: [{ item: 0, jobId: jobB, amount: 240 }] });
    expect(await jobCost(jobB)).toBe(`${before}|false`);
    expect(localSql(`select status from supplier_invoices where id = '${eur.id}'`)).toBe("ke_kontrole");
    expect(localSql(`select array_to_string(job_unpriced_purchase_orders('${jobB}'), ';')`)).toBe("kurz EUR u faktury dodavatele");
    const jc = (await data.getJobInvoiceCosts(jobB))!;
    expect(jc.missingRate).toBe(true);
    expect(jc.allocations.find((a) => a.invoiceId === eur.id)?.amountCzk).toBeNull();
    const { getJobPurchasing } = await import("@/lib/data/purchasing");
    expect((await getJobPurchasing(jobB))!.totals).toMatchObject({ cost: null, costSource: "neuplna", missingRates: ["kurz EUR u faktury dodavatele"] });
    const list = (await data.listSupplierInvoices())!;
    expect(list.items.find((x) => x.id === eur.id)?.missingRate).toBe(true);
    expect(list.totals.foreign).toEqual(expect.arrayContaining([expect.objectContaining({ currency: "EUR", net: 240 })]));
    // kurz doplněn ručně → 240 × 25 = 6 000 Kč, zpracováno
    expect((await act.updateSupplierInvoiceHeader(eur.id, { exchangeRate: "25" })).ok).toBe(true);
    expect(await jobCost(jobB)).toBe(`${(Number(before) + 6_000).toFixed(2)}|true`);
    expect(localSql(`select status from supplier_invoices where id = '${eur.id}'`)).toBe("zpracovano");
    expect(await commissionCost(jobB)).toBe(Number(before) + 6_000);
    await db.from("supplier_invoices").delete().eq("id", eur.id);
    invoiceIds.delete(eur.id);
    expect(await jobCost(jobB)).toBe(`${before}|true`);
  }, 60_000);

  it("zálohová faktura se do nákladu nepočítá (ani potvrzené rozdělení), AI nic nenavrhne", async () => {
    h.user = admin;
    const before = await jobCost(jobB);
    const pf = await seedInvoice({ number: `${TAG}-ZAL`, proforma: true, items: [{ text: "Záloha na výrobu", amount: 15_000 }], allocs: [{ item: 0, jobId: jobB, amount: 15_000 }] });
    expect(await jobCost(jobB)).toBe(before);
    expect(localSql(`select status from supplier_invoices where id = '${pf.id}'`)).toBe("zpracovano");
    expect((await data.getSupplierInvoice(pf.id))!.isProforma).toBe(true);
    // AI: zálohová (fixture) → bez návrhu rozdělení
    const raw = JSON.parse(readFileSync(path.join(FIXTURES, "batch/sinv.json"), "utf8")) as Record<string, unknown>;
    const made = await core.createSupplierInvoiceFromFile({ bytes: new Uint8Array(png(140)), filename: `${TAG}-zal.png` }, "upload", userActor({ id: admin.id }), {
      extract: { ...raw, number: `${TAG}-ZAL-AI`, isProforma: true } as never, aiUsed: true,
    });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    invoiceIds.add(made.id);
    expect(localSql(`select is_proforma::text || '|' || (select count(*) from supplier_invoice_allocations where invoice_id = '${made.id}') from supplier_invoices where id = '${made.id}'`)).toBe("true|0");
    await db.from("supplier_invoices").delete().in("id", [pf.id, made.id]);
    invoiceIds.delete(pf.id);
    invoiceIds.delete(made.id);
  }, 60_000);

  it("bez součtu faktury není „zbytek mimo položky“ (záporná režie neprojde); položky se ukládají atomicky", async () => {
    h.user = admin;
    const x = await seedInvoice({ number: `${TAG}-NONET`, net: null, items: [{ text: "Výroba", amount: 2_000 }], allocs: [{ item: 0, jobId: jobB, amount: 2_000 }] });
    expect(localSql(`select coalesce(total_net::text, '-') || '|' || status from supplier_invoices where id = '${x.id}'`)).toBe("-|zpracovano");
    const neg = await db.from("supplier_invoice_allocations").insert({ invoice_id: x.id, item_id: null, target: "rezie", overhead_category: "ostatni", amount: -2_000, confirmed_at: new Date().toISOString() });
    expect(neg.error?.message ?? "").toMatch(/přesahuje/);
    // snížení položky pod její rozdělení → chyba, nic se nezmění (ani nová položka)
    const bad = await act.saveSupplierInvoiceItems(x.id, [{ id: x.items[0], text: "Výroba", amount: 1_000 }, { text: "Nová", amount: 500 }]);
    expect(bad.ok).toBe(false);
    expect(localSql(`select string_agg(text || '=' || amount::text, ',' order by position) from supplier_invoice_items where invoice_id = '${x.id}'`)).toBe("Výroba=2000.00");
    // v pořádku: přidá položku, faktura bez součtu dostane součet položek
    const ok = await act.saveSupplierInvoiceItems(x.id, [{ id: x.items[0], text: "Výroba", amount: 2_000 }, { text: "Kalení", amount: 700 }]);
    expect(ok.ok, ok.ok ? "" : ok.error).toBe(true);
    expect(localSql(`select total_net::text || '|' || status from supplier_invoices where id = '${x.id}'`)).toBe("2700.00|ke_kontrole");
    await db.from("supplier_invoices").delete().eq("id", x.id);
    invoiceIds.delete(x.id);
  }, 60_000);

  it("zpracování nikdy nezůstane „AI čte“: nesmyslná čísla → ke kontrole s poznámkou; chyba → ke kontrole s chybou", async () => {
    h.user = admin;
    const raw = JSON.parse(readFileSync(path.join(FIXTURES, "batch/sinv.json"), "utf8")) as Record<string, unknown>;
    const made = await core.createSupplierInvoiceFromFile({ bytes: new Uint8Array(png(150)), filename: `${TAG}-big.png` }, "upload", userActor({ id: admin.id }), {
      extract: { ...raw, number: `${TAG}-BIG`, totalNet: 5e12, items: [{ text: "Výroba", amount: 5e12 }] } as never, aiUsed: true,
    });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    invoiceIds.add(made.id);
    const row = (await data.getSupplierInvoice(made.id))!;
    expect(row.status).toBe("ke_kontrole");
    expect(row.aiProcessedAt).not.toBeNull();
    expect(row.needsClarification.join(" ")).toMatch(/nesmyslnou částku/);
    // selhání zpracování (např. chyba DB) → ke kontrole, chyba a čas zpracování zapsané
    localSql(`update supplier_invoices set status = 'nahrano', ai_processed_at = null, ai_error = null where id = '${made.id}'`);
    await core.markProcessingFailed(db as never, made.id, "test");
    expect(localSql(`select status || '|' || (ai_processed_at is not null)::text || '|' || ai_error from supplier_invoices where id = '${made.id}'`))
      .toBe("ke_kontrole|true|AI fakturu nezpracovala: test");
  }, 60_000);

  it("smazání originálu se dvěma duplicitami projde: nejstarší duplicita je nový originál, druhá ukáže na ni", async () => {
    h.user = admin;
    const orig = await seedInvoice({ number: `${TAG}-DUPDEL`, items: [{ text: "Výroba", amount: 100 }] });
    const dup = async () => {
      const { data: d, error } = await db.from("supplier_invoices").insert({
        number: `${TAG}-DUPDEL`, supplier_id: HRUBY, supplier_ico: "25874411", duplicate_of_id: orig.id, status: "ke_kontrole", source: "upload", uploaded_by: admin.id,
      }).select("id").single();
      if (error) throw new Error(error.message);
      invoiceIds.add((d as { id: string }).id);
      return (d as { id: string }).id;
    };
    const d1 = await dup();
    const d2 = await dup();
    const res = await act.deleteSupplierInvoice(orig.id);
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    invoiceIds.delete(orig.id);
    expect(localSql(`select string_agg(id::text || '>' || coalesce(duplicate_of_id::text, '-'), ',' order by created_at) from supplier_invoices where id in ('${d1}', '${d2}')`))
      .toBe(`${d1}>-,${d2}>${d1}`);
  }, 60_000);

  it("přečíst znovu: když fakturu někdo během čtení AI upraví, nové čtení se neuloží", async () => {
    h.user = admin;
    const raw = JSON.parse(readFileSync(path.join(FIXTURES, "batch/sinv.json"), "utf8")) as Record<string, unknown>;
    const made = await core.createSupplierInvoiceFromFile({ bytes: new Uint8Array(png(160)), filename: `${TAG}-race.png` }, "upload", userActor({ id: admin.id }), {
      extract: { ...raw, number: `${TAG}-RACE` } as never, aiUsed: true,
    });
    if (!made.ok) throw new Error(made.error);
    invoiceIds.add(made.id);
    h.duringRead = async () => { localSql(`update supplier_invoices set note = 'ruční úprava' where id = '${made.id}'`); };
    try {
      const res = await core.processSupplierInvoice(made.id, { actor: userActor({ id: admin.id }), force: true });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/změnila/);
    } finally {
      h.duringRead = null;
    }
    expect(localSql(`select number || '|' || note from supplier_invoices where id = '${made.id}'`)).toBe(`${TAG}-RACE|ruční úprava`);
    // bez souběhu se přečte (fixture sinv.json → číslo FA-2026-0815 = duplicita původní faktury)
    const ok = await core.processSupplierInvoice(made.id, { actor: userActor({ id: admin.id }), force: true });
    expect(ok.ok).toBe(true);
  }, 60_000);

  it("foto přeznačené na „Faktura — od dodavatele“: fakturu přečte čtečka faktur (ne položky objednávky zákazníka)", async () => {
    h.user = worker;
    h.after = [];
    const one = await s.analyzeCapture({ files: [await upload(`${TAG}-single.png`, png(170))] });
    if (!one.ok || !("model" in one)) throw new Error(JSON.stringify(one).slice(0, 300));
    captureIds.add(one.model.captureId);
    expect(one.model.initial.chip).not.toBe("faktura_dodavatel");
    const saved = await s.applyCapture({ captureId: one.model.captureId, state: { ...one.model.initial, chip: "faktura_dodavatel" } });
    expect(saved.ok, saved.error).toBe(true);
    expect(saved.summary).toBe("Děkujeme, nahráno — fakturu zpracuje super admin.");
    expect(saved.supplierInvoice).toEqual({ id: null });
    await Promise.all(h.after);
    const id = localSql(`select id from supplier_invoices where capture_key = 'single:${one.model.captureId}'`);
    invoiceIds.add(id);
    const items = localSql(`select string_agg(text, ' | ' order by position) from supplier_invoice_items where invoice_id = '${id}'`);
    expect(items).toMatch(/Výroba přírub/);
    expect(items).not.toMatch(/Upínka/);
    expect(localSql(`select coalesce(supplier_id::text, '-') from supplier_invoices where id = '${id}'`)).toBe(HRUBY);
  }, 60_000);

  it("zaplaceno / nezaplaceno jen super admin (akce i DB)", async () => {
    h.user = sales;
    expect((await act.setSupplierInvoicePayment(invoiceId, { status: "zaplaceno" })).ok).toBe(false);
    const viaSales = await localAdmin(userActor({ id: sales.id })).from("supplier_invoices").update({ payment_status: "zaplaceno" }).eq("id", invoiceId);
    expect(viaSales.error?.message ?? "").toMatch(/jen super admin/);
    h.user = admin;
    const res = await act.setSupplierInvoicePayment(invoiceId, { status: "zaplaceno", paidAt: "2026-10-28" });
    expect(res.ok).toBe(true);
    expect(localSql(`select payment_status || '|' || paid_at::text || '|' || (paid_by = '${admin.id}')::text from supplier_invoices where id = '${invoiceId}'`)).toBe("zaplaceno|2026-10-28|true");
    expect((await data.listSupplierInvoices({ view: "nezaplacene" }))!.items.some((x) => x.id === invoiceId)).toBe(false);
    expect((await act.setSupplierInvoicePayment(invoiceId, { status: "nezaplaceno" })).ok).toBe(true);
    expect(localSql(`select payment_status || '|' || coalesce(paid_at::text, '-') from supplier_invoices where id = '${invoiceId}'`)).toBe("nezaplaceno|-");
  }, 60_000);

  it("stejný soubor ani stejná faktura (dodavatel + číslo) nevznikne podruhé — jen duplicita", async () => {
    h.user = admin;
    const { data: f } = await db.from("supplier_invoice_files").select("storage_path, filename").eq("invoice_id", invoiceId).single();
    const blob = (await db.storage.from("supplier-invoices").download((f as { storage_path: string }).storage_path)).data!;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const same = await core.createSupplierInvoiceFromFile({ bytes, filename: "znovu.png" }, "photo", userActor({ id: admin.id }), { process: "sync" });
    expect(same).toMatchObject({ ok: true, id: invoiceId, created: false, duplicateOfId: invoiceId });
    const other = await core.createSupplierInvoiceFromFile({ bytes: new Uint8Array(png(77)), filename: `${TAG}-jina-fotka.png` }, "photo", userActor({ id: admin.id }), { process: "sync" });
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    invoiceIds.add(other.id);
    expect(other).toMatchObject({ created: true, duplicateOfId: invoiceId, status: "ke_kontrole" });
    expect(localSql(`select count(*) from supplier_invoice_allocations where invoice_id = '${other.id}'`)).toBe("0");
    const dup = (await data.getSupplierInvoice(other.id))!;
    expect(dup.duplicateOf?.id).toBe(invoiceId);
    expect((await data.listSupplierInvoices({ view: "duplicity" }))!.items.map((x) => x.id)).toContain(other.id);
    // „Není duplicita" nejde, dokud je stejné číslo — unikátní index
    expect((await act.markSupplierInvoiceNotDuplicate(other.id)).ok).toBe(false);
    expect((await act.deleteSupplierInvoice(other.id)).ok).toBe(true);
    invoiceIds.delete(other.id);
  }, 60_000);

  it("Zanést fakturu (stránka, 31. 10.): stejná faktura (dodavatel + číslo) jiným souborem = „už je zapsaná“, nic nového", async () => {
    h.user = worker;
    const before = localSql(`select count(*) from supplier_invoices where created_at >= '${startedAt}'`);
    const file = await upload(`${TAG}-stranka__faktura_dodavatel.png`, png(88));
    const res = await up.uploadSupplierInvoice({ files: [file] });
    expect(res).toMatchObject({ ok: true, kind: "duplicate", head: { number: "FA-2026-0815" } });
    if (!res.ok) return;
    expect(res.message).toMatch(/^Tahle faktura už je zapsaná \(\d{1,2}\. \d{1,2}\. 2026/);
    // zaměstnanec nedostane id (Faktury dodavatelů nevidí)
    expect("id" in res).toBe(false);
    expect(localSql(`select count(*) from supplier_invoices where created_at >= '${startedAt}'`)).toBe(before);
    // stránka v capture/ smazaná
    const { data: left } = await db.storage.from("job-files").list(file.path.slice(0, file.path.lastIndexOf("/")), { search: file.path.split("/").pop() });
    expect((left ?? []).length).toBe(0);
  }, 60_000);

  it("Dodavatelé → Přiložit fakturu: dodavatel z hlavičky, podruhé jen doplní (podle IČO), faktura jen na přání", async () => {
    h.user = worker;
    const first = await up.supplierFromInvoiceUpload({ files: [await upload(`${TAG}-a__faktura_dodavatel-g2.png`, png(101))], createInvoice: false });
    expect(first.ok, first.ok ? "" : first.error).toBe(true);
    if (!first.ok) return;
    createdSuppliers.add(first.supplier.id);
    expect(first.supplier).toMatchObject({ name: "E2E Kalírna Nová s.r.o.", created: true });
    expect(first.supplier.filled).toEqual(expect.arrayContaining(["IČO", "DIČ", "adresa", "bankovní účet", "e-mail", "telefon"]));
    expect(first.invoice).toBeNull();
    expect(localSql(`select ico || '|' || dic || '|' || bank_account || '|' || address from suppliers where id = '${first.supplier.id}'`))
      .toBe("27999990|CZ27999990|CZ6508000000192000145399|Tovární 5, 76001 Zlín");
    expect(localSql(`select count(*) from supplier_invoices where supplier_key = '27999990'`)).toBe("0");
    // podruhé: stejné IČO → stejný dodavatel, nic nového; s fakturou → zaměstnanec jen „Děkujeme"
    localSql(`update suppliers set phone = null where id = '${first.supplier.id}'`);
    const second = await up.supplierFromInvoiceUpload({ files: [await upload(`${TAG}-b__faktura_dodavatel-g2.png`, png(102))], createInvoice: true });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.supplier).toMatchObject({ id: first.supplier.id, created: false, filled: ["telefon"] });
    expect(second.invoice).toEqual({ message: "Děkujeme, nahráno — fakturu zpracuje super admin." });
    expect(localSql(`select count(*) || '|' || min(supplier_id::text) from supplier_invoices where supplier_key = '27999990'`)).toBe(`1|${first.supplier.id}`);
  }, 60_000);

  it("přepínač „všichni“: faktury vidí všichni, zaplaceno jen super admin, částky jen s nákupními cenami", async () => {
    h.user = admin;
    expect((await act.setSupplierInvoiceVisibility("all")).ok).toBe(true);
    expect(localSql(`select value from integration_settings where key = 'supplier_invoices_visibility'`)).toBe("all");
    h.forAll = true;
    try {
      h.user = sales;
      const ls = (await data.listSupplierInvoices())!;
      const it = ls.items.find((x) => x.id === invoiceId)!;
      expect(it.totalNet).toBe(31_500);
      expect(it.paymentStatus).toBeNull();
      expect(ls.totals.unpaid).toBeNull();
      const ds = (await data.getSupplierInvoice(invoiceId))!;
      expect(ds).toMatchObject({ paymentStatus: null, paidAt: null, perms: { view: true, amounts: true, edit: false, paid: false } });
      expect(ds.files).toHaveLength(1);
      expect((await act.setSupplierInvoicePayment(invoiceId, { status: "zaplaceno" })).ok).toBe(false);
      // obchodník fakturu vidí, ale NEMĚNÍ (rozdělení = náklady a provize zakázek ostatních) — akce i route
      const kept = ds.allocations.map((a) => ({ id: a.id, itemId: a.itemId, target: a.target, jobId: a.job?.id ?? null, category: a.category, amount: a.amount!, confirmed: true }));
      const before = localSql(`select string_agg(id::text || amount::text || coalesce(job_id::text, ''), ',' order by id) from supplier_invoice_allocations where invoice_id = '${invoiceId}'`);
      for (const r of [
        await act.saveSupplierInvoiceAllocations(invoiceId, kept.map((k) => ({ ...k, jobId: jobA }))), await act.setSupplierInvoiceRejected(invoiceId, true),
        await act.confirmSupplierInvoiceAi(invoiceId), await act.updateSupplierInvoiceHeader(invoiceId, { number: "X" }),
        await act.saveSupplierInvoiceItems(invoiceId, []), await act.supplierFromInvoiceHeader(invoiceId), await act.markSupplierInvoiceNotDuplicate(invoiceId),
        await act.setSupplierInvoiceFinalPo(invoiceId, poA, true), await act.fillSupplierInvoiceRate(invoiceId),
      ]) {
        expect(r).toEqual({ ok: false, error: "K této akci nemáš oprávnění." });
      }
      expect(localSql(`select string_agg(id::text || amount::text || coalesce(job_id::text, ''), ',' order by id) from supplier_invoice_allocations where invoice_id = '${invoiceId}'`)).toBe(before);
      expect(localSql(`select status from supplier_invoices where id = '${invoiceId}'`)).not.toBe("zamitnuto");
      const { POST } = await import("@/app/api/supplier-invoices/[id]/process/route");
      const pr = await POST(new Request("http://localhost/x", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }), { params: Promise.resolve({ id: invoiceId }) });
      expect(((await pr.json()) as { ok?: boolean }).ok).not.toBe(true);
      const { GET } = await import("@/app/api/supplier-invoices/files/[id]/route");
      const fileId = ds.files[0].id;
      expect((await GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: fileId }) })).status).toBe(302);
      h.user = worker;
      // zaměstnanec: soubor faktury (s cenami) ne — ani odkaz v detailu
      expect((await GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: fileId }) })).status).toBe(403);
      expect((await data.getSupplierInvoice(invoiceId))!.files).toEqual([]);
      const lw = (await data.listSupplierInvoices())!;
      expect(lw.items.find((x) => x.id === invoiceId)).toMatchObject({ totalNet: null, totalGross: null, paymentStatus: null, unallocated: null });
      const dw = (await data.getSupplierInvoice(invoiceId))!;
      expect(dw.items.every((i) => i.amount === null)).toBe(true);
      expect(dw.allocations.every((a) => a.amount === null)).toBe(true);
      expect((await act.saveSupplierInvoiceAllocations(invoiceId, [])).ok).toBe(false);
      expect(await data.getJobInvoiceCosts(jobA)).toBeNull();
      // REST: obchodník vidí řádky (bez zaplaceno), zaměstnanec nic
      const sl = await localSession(DEMO.sales.email, DEMO.sales.password);
      expect((await sl.from("supplier_invoices").select("id, total_net").eq("id", invoiceId)).data).toHaveLength(1);
      expect((await sl.from("supplier_invoices").select("paid_at").eq("id", invoiceId)).error).not.toBeNull();
      const w = await localSession(DEMO.worker.email, DEMO.worker.password);
      expect((await w.from("supplier_invoices").select("id").eq("id", invoiceId)).data ?? []).toEqual([]);
    } finally {
      h.user = admin;
      expect((await act.setSupplierInvoiceVisibility("super_admin")).ok).toBe(true);
      h.forAll = false;
    }
    const sl = await localSession(DEMO.sales.email, DEMO.sales.password);
    expect((await sl.from("supplier_invoices").select("id").eq("id", invoiceId)).data ?? []).toEqual([]);
  }, 60_000);
});
