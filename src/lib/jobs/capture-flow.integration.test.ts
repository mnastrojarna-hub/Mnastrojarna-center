import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Foto dokladu → podrobné stavy toku a autor (spec 2.8) proti lokálnímu Supabase s testovací AI:
 *  • foto objednávky se stejným číslem → revize (Aktualizovaná), položky se NEpřepíšou;
 *  • foto objednávky proti odeslané nabídce s rozdílem → Rozpor s nabídkou;
 *  • náš DL částečně → stav zůstává, celý → Dodáno zákazníkovi (DB); DL dodavatele → převzaté množství;
 *  • naše nabídka → odeslaná (via foto), naše potvrzení → potvrzení odesláno (via foto);
 *  • plná automatika zapisuje jako ✨ AI (capture) za účet, který fotil; soubory origin = capture + vystavitel.
 * Klient nese hlavičky autora jako produkční server.ts. Vlastní zakázky Z-E2E-FOTO-*.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/jobs/capture-flow.integration.test.ts
 */

const ENABLED = process.env.LOCAL_SUPABASE === "1";
const FIXTURES = path.resolve(process.cwd(), "src/lib/jobs/__fixtures__/capture");
const TAG = Date.now().toString(36);
const PREFIX = `Z-E2E-FOTO-${TAG}`;

const h = vi.hoisted(() => ({ user: null as Record<string, unknown> | null }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

vi.mock("@/lib/supabase/server", async () => {
  const local = await import("@/test/local-supabase");
  const headers = await import("@/lib/supabase/actor-headers");
  return {
    isSupabaseConfigured: () => true,
    hasServiceKey: () => true,
    createAdminClient: (opts: { actor?: unknown } = {}) => local.localAdmin((opts.actor as never) ?? headers.SYSTEM_ACTOR),
    createOperatorClient: async (opts: { actor?: unknown } = {}) =>
      local.localAdmin(opts.actor !== undefined ? (opts.actor as never) : headers.userActor(h.user as never)),
    createClient: async () => {
      throw new Error("Bez session (test).");
    },
  };
});

vi.mock("@/lib/auth/session", async () => {
  const perms = await import("@/lib/auth/permissions");
  // bez API klíče → AI jen přes AI_FAKE_CAPTURE pro super admina
  const ctx = { aiEnabled: true, aiCaptureForAll: false, aiConfigured: false };
  const access = () => ({
    user: h.user, ctx, features: perms.allowedFeatures(h.user as never, ctx), can: (f: string) => perms.can(h.user as never, f as never, ctx),
  });
  return {
    getSessionUser: async () => h.user,
    getAccess: async () => access(),
    checkFeature: async (f: string) => (perms.can(h.user as never, f as never, ctx) ? { user: h.user } : { error: "K této akci nemáš oprávnění." }),
    apiRequire: async () => ({ user: h.user }),
    requireUser: async () => h.user,
    requireFeature: async () => h.user,
  };
});

type Row = Record<string, unknown>;
const FAKE_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 7)]);

describe.skipIf(!ENABLED)("foto dokladu → podrobné stavy a autor (lokální Supabase)", () => {
  let svc: SupabaseClient;
  let admin: Row;
  const jobs: string[] = [];
  const quotes: string[] = [];
  const ownPaths = new Set<string>();
  let n = 0;

  async function newJob(patch: Row): Promise<string> {
    n += 1;
    const { data, error } = await svc.from("orders").insert({
      number: `${PREFIX}-${n}`, title: `Foto ${n}`, source: "manual", inquiry_date: "2026-10-01", ...patch,
    }).select("id").single();
    if (error) throw new Error(error.message);
    jobs.push((data as { id: string }).id);
    return (data as { id: string }).id;
  }
  async function addItems(jobId: string, items: { dwg: string; qty: number; rev?: string }[]) {
    const { error } = await svc.from("order_items").insert(items.map((it, i) => ({
      order_id: jobId, position: i, drawing_number: it.dwg, name: `Díl ${it.dwg}`, quantity: it.qty, unit: "ks", revision: it.rev ?? null, unit_price: 1000,
    })));
    if (error) throw new Error(error.message);
  }
  const job = async (id: string) => (await svc.from("orders").select("*").eq("id", id).single()).data as Row;
  const item = (dwg: string, qty: number) => ({ drawingNumber: dwg, revision: "", name: "", description: "", material: "", quantity: qty, unit: "ks", unitPrice: 0, deliveryDate: "" });

  async function upload(s: typeof import("./capture-service"), filename: string) {
    const prep = await s.prepareCaptureUpload({ filename, size: FAKE_JPEG.length, mimeType: "image/jpeg" });
    if (!prep.ok) throw new Error(prep.error);
    ownPaths.add(prep.path!);
    const { error } = await svc.storage.from("job-files").uploadToSignedUrl(prep.path!, prep.token!, FAKE_JPEG, { contentType: "image/jpeg" });
    if (error) throw new Error(error.message);
    return { path: prep.path!, filename, mimeType: "image/jpeg", size: FAKE_JPEG.length };
  }

  beforeAll(async () => {
    const { localAdmin, DEMO } = await import("@/test/local-supabase");
    const { loadLocalEnv } = await import("@/test/local-supabase");
    const env = loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    svc = localAdmin();
    const { data: p } = await svc.from("profiles").select("id, email, role, full_name").eq("email", DEMO.admin.email).single();
    const a = p as { id: string; email: string; role: string; full_name: string };
    admin = { id: a.id, email: a.email, fullName: a.full_name, role: a.role, initials: "SA", roleLabel: a.role, aiAccess: false, active: true, hasProfile: true, mustChangePassword: false };
    h.user = admin;
  }, 60_000);

  afterAll(async () => {
    delete process.env.AI_FAKE_CAPTURE;
    if (!svc) return;
    for (const id of jobs) {
      const { data: files } = await svc.storage.from("job-files").list(`zakazky/${id}`, { limit: 100 });
      const paths = (files ?? []).map((f) => `zakazky/${id}/${f.name}`);
      if (paths.length) await svc.storage.from("job-files").remove(paths);
    }
    const { data: left } = await svc.storage.from("job-files").list(`capture/${admin?.id}`, { limit: 200 });
    const mine = (left ?? []).map((f) => `capture/${admin?.id}/${f.name}`).filter((p) => ownPaths.has(p) || [...ownPaths].some((o) => p.startsWith(o.replace(/\/[^/]+$/, "")) && p.endsWith(".json")));
    if (mine.length) await svc.storage.from("job-files").remove(mine);
    if (quotes.length) await svc.from("quotes").delete().in("id", quotes);
    if (jobs.length) {
      await svc.from("ai_training_examples").delete().in("job_id", jobs);
      await svc.from("purchase_orders").delete().in("job_id", jobs);
      await svc.from("quotes").delete().in("job_id", jobs);
      await svc.from("orders").delete().in("id", jobs);
      await svc.from("audit_log").delete().in("entity_id", jobs);
      await svc.from("audit_log").delete().in("diff->>job_id", jobs);
    }
  }, 60_000);

  it("foto objednávky se stejným číslem → revize (Aktualizovaná), položky se nepřepíšou, soubor origin capture", async () => {
    const s = await import("./capture-service");
    const jobId = await newJob({ status: "potvrzeno", customer_order_number: "4795-2026", order_date: "2026-10-05", value: 100_000, customer_required_date: "2026-11-20" });
    await addItems(jobId, [{ dwg: "VK-2291", qty: 40, rev: "B" }]);
    expect((await job(jobId))).toMatchObject({ order_status: "potvrzena", order_revision: 1 });

    process.env.AI_FAKE_CAPTURE = path.join(FIXTURES, "objednavka-strojmetal.json");
    const page = await upload(s, `foto-rev-${TAG}.jpg`);
    const res = await s.analyzeCapture({ files: [page], jobId });
    if (!res.ok || !("model" in res)) throw new Error(JSON.stringify(res).slice(0, 300));
    const saved = await s.applyCapture({ captureId: res.model.captureId, state: res.model.initial });
    expect(saved.ok, saved.error).toBe(true);
    expect(saved.flowNotes?.join(" ")).toMatch(/revize 2/);

    const j = await job(jobId);
    expect(j).toMatchObject({ status: "potvrzeno", order_status: "aktualizovana", order_revision: 2, order_changed_by: admin.id });
    const { data: items } = await svc.from("order_items").select("drawing_number, quantity").eq("order_id", jobId);
    expect(items).toEqual([{ drawing_number: "VK-2291", quantity: 40 }]);
    const { data: rev } = await svc.from("job_order_revisions").select("revision, decision, changes, created_by, created_via, file_id").eq("job_id", jobId).eq("revision", 2).single();
    const r = rev as Row;
    expect(r).toMatchObject({ revision: 2, decision: "ceka", created_by: admin.id, created_via: "foto" });
    const labels = (r.changes as { label: string }[]).map((c) => c.label);
    expect(labels).toEqual(expect.arrayContaining(["Množství VK-2291 (ks)", "Nová položka VK-2292", "Požadovaný termín", "Cena celkem bez DPH"]));
    expect(r.file_id).toBe(saved.fileId);
    const { data: f } = await svc.from("job_files").select("origin, issuer, uploaded_by").eq("id", saved.fileId!).single();
    expect(f).toEqual({ origin: "capture", issuer: "zakaznik", uploaded_by: admin.id });
    const { data: ev } = await svc.from("job_events").select("type, actor_id, via, message").eq("job_id", jobId).eq("type", "status");
    const st = (ev ?? []) as Row[];
    expect(st.some((e) => /rev 2/.test(String(e.message)) && e.actor_id === admin.id && e.via === "foto")).toBe(true);
  }, 90_000);

  it("foto objednávky proti odeslané nabídce s rozdílem → přijatá nabídka + Rozpor s nabídkou (AI)", async () => {
    const s = await import("./capture-service");
    const jobId = await newJob({ status: "nabidka" });
    const { data: q, error } = await svc.from("quotes").insert({
      job_id: jobId, number: `NAB-E2E-${TAG}`, status: "odeslano", total: 100_000, revision: 1, lead_time_days: 60, sent_at: new Date().toISOString(),
    }).select("id").single();
    if (error) throw new Error(error.message);
    quotes.push((q as { id: string }).id);
    await svc.from("quote_items").insert({ quote_id: (q as { id: string }).id, position: 0, drawing_number: "VK-2291", name: "Upínka", quantity: 50, unit: "ks", unit_price: 2000 });

    process.env.AI_FAKE_CAPTURE = path.join(FIXTURES, "objednavka-strojmetal.json");
    const page = await upload(s, `foto-rozpor-${TAG}.jpg`);
    const res = await s.analyzeCapture({ files: [page], jobId });
    if (!res.ok || !("model" in res)) throw new Error(JSON.stringify(res).slice(0, 300));
    const saved = await s.applyCapture({ captureId: res.model.captureId, state: res.model.initial });
    expect(saved.ok, saved.error).toBe(true);
    const j = await job(jobId);
    expect(j).toMatchObject({ status: "objednavka", order_status: "rozpor", order_status_changed_by: admin.id });
    const kinds = ((j.order_mismatch as { items: { kind: string }[] }).items).map((i) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(["cena", "polozka_navic", "termin"]));
    expect((j.order_mismatch as { source: string }).source).toBe("ai");
    const { data: qq } = await svc.from("quotes").select("status, state").eq("id", quotes[0]).single();
    expect(qq).toMatchObject({ status: "prijato", state: "prijata" });
    expect(saved.flowNotes?.join(" ")).toMatch(/liší od nabídky/);
  }, 90_000);

  it("náš DL: částečně → stav zůstává; zbytek → Dodáno zákazníkovi (DB); stráž faktury při částečném dodání", async () => {
    const { recordPhotoDelivery, captureStageGuard } = await import("./capture-flow");
    const { localAdmin } = await import("@/test/local-supabase");
    const { userActor } = await import("@/lib/supabase/actor-headers");
    const db = localAdmin(userActor({ id: admin.id as string }, "foto"));
    const jobId = await newJob({ status: "ve_vyrobe", order_date: "2026-10-05" });
    await addItems(jobId, [{ dwg: "A-1", qty: 10 }, { dwg: "A-2", qty: 5 }]);
    const r1 = await recordPhotoDelivery(db as never, admin.id as string, jobId, [item("A-1", 10), item("X-9", 3)], { documentNumber: "DL-1" });
    expect(r1).toMatchObject({ recorded: 1, complete: false, partial: true, unmatched: ["X-9"] });
    expect((await job(jobId)).status).toBe("ve_vyrobe");
    expect(await captureStageGuard(db as never, jobId, "fakturovano")).toMatchObject({ ok: false });
    const r2 = await recordPhotoDelivery(db as never, admin.id as string, jobId, [item("A-2", 5)], { documentNumber: "DL-2" });
    expect(r2).toMatchObject({ recorded: 1, complete: true });
    const j = await job(jobId);
    expect(j).toMatchObject({ status: "dodano_zakaznikovi", stage_changed_by: admin.id, stage_change_cause: "dodani" });
    expect(await captureStageGuard(db as never, jobId, "fakturovano")).toEqual({ ok: true });
    const { data: ev } = await svc.from("job_events").select("message, entity, actor_id").eq("job_id", jobId).eq("entity", "delivery");
    expect(((ev ?? []) as Row[]).map((e) => e.message).join("\n")).toMatch(/A-1 10\/10 ks · 1 z 2 položek/);
    for (const e of (ev ?? []) as Row[]) expect(e.actor_id).toBe(admin.id);
  }, 60_000);

  it("DL dodavatele: převzaté množství po položkách (podle čísla výkresu); zbytek → objednávka Dodána", async () => {
    const { receiveSupplierDlByPhoto } = await import("./capture-flow");
    const { localAdmin } = await import("@/test/local-supabase");
    const { userActor } = await import("@/lib/supabase/actor-headers");
    const db = localAdmin(userActor({ id: admin.id as string }, "foto"));
    const jobId = await newJob({ status: "ve_vyrobe" });
    const { data: po } = await svc.from("purchase_orders").insert({ job_id: jobId, number: `OV-E2E-FOTO-${TAG}`, status: "potvrzena", total: 500 }).select("id").single();
    const poId = (po as { id: string }).id;
    await svc.from("purchase_order_items").insert([
      { purchase_order_id: poId, position: 0, drawing_number: "PR-1", name: "Polotovar", quantity: 200, unit: "ks" },
      { purchase_order_id: poId, position: 1, drawing_number: "PR-2", name: "Tyč", quantity: 10, unit: "ks" },
    ]);
    const ref = { id: poId, jobId, number: `OV-E2E-FOTO-${TAG}`, status: "potvrzena" as const, fileId: null, supplierId: null };
    const r1 = await receiveSupplierDlByPhoto(db as never, admin.id as string, ref, [item("PR 1", 120)]);
    expect(r1).toMatchObject({ ok: true });
    const { data: its } = await svc.from("purchase_order_items").select("drawing_number, received_quantity, received_changed_by").eq("purchase_order_id", poId).order("position");
    expect(its).toEqual([
      { drawing_number: "PR-1", received_quantity: 120, received_changed_by: admin.id },
      { drawing_number: "PR-2", received_quantity: 0, received_changed_by: null },
    ]);
    expect(((await svc.from("purchase_orders").select("status").eq("id", poId).single()).data as Row).status).toBe("potvrzena");
    const r2 = await receiveSupplierDlByPhoto(db as never, admin.id as string, ref, [item("PR-1", 80), item("PR-2", 10)]);
    expect(r2).toMatchObject({ ok: true, stage: "dodano_k_nam" });
    expect(((await svc.from("purchase_orders").select("status, delivered_by").eq("id", poId).single()).data as Row)).toEqual({ status: "dodana", delivered_by: admin.id });
  }, 60_000);

  it("naše nabídka → odeslaná (foto), naše potvrzení → potvrzení odesláno; plná automatika = ✨ AI (capture) za účet", async () => {
    const { markQuoteSentByPhoto, confirmOrderByPhoto, autoCaptureCtx, proposeFromCapture } = await import("./capture-flow");
    const { createOperatorClient } = await import("@/lib/supabase/server");
    const { userActor } = await import("@/lib/supabase/actor-headers");
    const userDb = await createOperatorClient({ actor: userActor({ id: admin.id as string }, "foto") });
    const auto = await autoCaptureCtx({ db: userDb as never, user: { id: admin.id as string } }, true);

    const quoteJob = await newJob({ status: "naceneni" });
    const { data: q } = await svc.from("quotes").insert({ job_id: quoteJob, number: `NAB-E2E-F-${TAG}`, status: "navrh_ai", total: 1000, revision: 1 }).select("id").single();
    quotes.push((q as { id: string }).id);
    expect(await markQuoteSentByPhoto(auto.db, (q as { id: string }).id, "2026-10-20")).toEqual({ ok: true, changed: true });
    const { data: qq } = await svc.from("quotes").select("status, sent_via, sent_by, state").eq("id", (q as { id: string }).id).single();
    expect(qq).toMatchObject({ status: "odeslano", sent_via: "foto", sent_by: admin.id, state: "odeslana" });
    expect((await job(quoteJob)).status).toBe("nabidka");
    const { data: ev } = await svc.from("job_events").select("type, actor_id, actor_kind, agent").eq("job_id", quoteJob).eq("type", "stage");
    // stav posunula DB kaskádou z nabídky: autor = účet, druh = AI (agent nese jen hlavička přímého zápisu)
    expect(ev?.[0], JSON.stringify(ev)).toMatchObject({ actor_id: admin.id, actor_kind: "ai" });
    const { data: qev } = await svc.from("orders").select("stage_changed_by, stage_changed_via").eq("id", quoteJob).single();
    expect(qev).toMatchObject({ stage_changed_by: admin.id });

    const orderJob = await newJob({ status: "objednavka", order_date: "2026-10-05" });
    expect((await job(orderJob)).order_status).toBe("dorucena");
    expect(await confirmOrderByPhoto(auto.db, orderJob)).toEqual({ ok: true, changed: true });
    expect(await job(orderJob)).toMatchObject({
      status: "potvrzeno", order_status: "potvrzena", confirmation_sent_via: "foto", confirmation_sent_revision: 1,
      confirmation_sent_by: admin.id, confirmed_by: admin.id,
    });

    expect(await proposeFromCapture(auto.db, orderJob, { phase: "order", to: "stornovana", reason: "projekt_zrusen", label: "Stornovat objednávku — podle vyfoceného dokladu" })).toBe(true);
    const p = await job(orderJob);
    expect(p.flow_proposal).toMatchObject({ kind: "ai", agent: "capture", to: "stornovana" });
    expect(p.order_status).toBe("potvrzena"); // storno jen jako návrh, nikdy automaticky
    expect(await proposeFromCapture(auto.db, orderJob, { phase: "order", to: "stornovana", label: "znovu" })).toBe(false);
  }, 60_000);
});
