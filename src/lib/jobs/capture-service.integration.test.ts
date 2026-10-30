import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ReviewModel, ReviewState } from "@/lib/jobs/capture-review";

/**
 * E2E „📷 Vyfotit doklad" proti lokálnímu Supabase (tools/local-supabase) s testovací AI
 * (AI_FAKE_CAPTURE = fixture JSON): nahrání → AI čtení → párování → kontrola → uložení,
 * pevná zakázka + oprava (učení AI), ruční vyplnění bez AI, bezpečnost cest.
 * Mockuje se jen přihlášení a revalidace Next.js. Spuštění:
 *   LOCAL_SUPABASE=1 npx vitest run src/lib/jobs/capture-service.integration.test.ts
 * Demo data nemění — zakládá vlastní zakázky a vše po sobě uklidí (čítač čísel zakázek se
 * nevrací — souběžně můžou zakládat zakázky jiné testy, vrácení by způsobilo kolizi čísel).
 */

const ENABLED = process.env.LOCAL_SUPABASE === "1";
const FIXTURES = path.resolve(process.cwd(), "src/lib/jobs/__fixtures__/capture");

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

const h = vi.hoisted(() => ({ user: null as Record<string, unknown> | null }));

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
  const headers = await import("@/lib/supabase/actor-headers");
  // jako produkční server.ts: autor jde v hlavičkách x-actor-* (DB mu věří jen u servisní role)
  const admin = (opts: { actor?: unknown } = {}) => sb.createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(opts.actor ? { global: { headers: headers.actorHeaders(opts.actor as never) } } : {}),
  });
  return {
    isSupabaseConfigured: () => true,
    hasServiceKey: () => true,
    createAdminClient: admin,
    createOperatorClient: async (opts: { actor?: unknown } = {}) => admin(opts),
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
    user: h.user,
    ctx,
    features: perms.allowedFeatures(h.user as never, ctx),
    can: (f: string) => perms.can(h.user as never, f as never, ctx),
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

type Service = typeof import("./capture-service");
type Review = typeof import("./capture-review");

function person(id: string, email: string, role: string, fullName: string) {
  return { id, email, fullName, role, initials: "TT", roleLabel: role, aiAccess: false, active: true, hasProfile: true, mustChangePassword: false };
}

/** Odpověď /analyze pro jeden doklad (dávka by tu byla chyba). */
function single<T extends { ok: boolean }>(res: T): Extract<T, { model: unknown }> {
  if (!res.ok || !("model" in res)) throw new Error(`Čekám jeden doklad: ${JSON.stringify(res).slice(0, 300)}`);
  return res as Extract<T, { model: unknown }>;
}

/** Malý „JPEG" (hlavička stačí — testovací AI obsah nečte). */
const FAKE_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 7)]);

describe.skipIf(!ENABLED)("Vyfotit doklad ↔ lokální Supabase (E2E)", () => {
  let db: SupabaseClient;
  let s: Service;
  let r: Review;
  let admin: ReturnType<typeof person>;
  let sales: ReturnType<typeof person>;
  const startedAt = new Date(Date.now() - 1000).toISOString();
  const jobIds: string[] = [];
  const customerIds: string[] = [];
  let jobId = "";
  let manualJobId = "";

  /** Stránky nahrané tímto testem (úklid nesmí sáhnout na soubory souběžné sady — dávka používá stejnou složku). */
  const ownPaths = new Set<string>();

  async function upload(filename: string, mimeType = "image/jpeg", body: Buffer = FAKE_JPEG, opts: { master?: Buffer } = {}) {
    const prep = await s.prepareCaptureUpload({ filename, size: body.length, mimeType, ...(opts.master ? { master: { size: opts.master.length, mimeType } } : {}) });
    expect(prep.ok, prep.error).toBe(true);
    if (prep.path) ownPaths.add(prep.path);
    const { error } = await db.storage.from("job-files").uploadToSignedUrl(prep.path!, prep.token!, body, { contentType: mimeType });
    expect(error).toBeNull();
    if (opts.master) {
      // master fotky v plném rozlišení vedle zmenšené stránky (capture/<uživatel>/<uuid>.hires)
      expect(prep.masterPath).toBe(r.captureHiresPath(prep.path!));
      ownPaths.add(prep.masterPath!);
      const m = await db.storage.from("job-files").uploadToSignedUrl(prep.masterPath!, prep.masterToken!, opts.master, { contentType: mimeType });
      expect(m.error).toBeNull();
    }
    return { path: prep.path!, filename, mimeType, size: body.length, ...(prep.masterPath ? { masterPath: prep.masterPath } : {}) };
  }

  async function exists(p: string): Promise<boolean> {
    const dir = p.slice(0, p.lastIndexOf("/"));
    const name = p.slice(p.lastIndexOf("/") + 1);
    const { data } = await db.storage.from("job-files").list(dir, { search: name });
    return (data ?? []).some((f) => f.name === name);
  }

  beforeAll(async () => {
    const env = loadEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profiles } = await db.from("profiles").select("id, email, role, full_name").in("email", ["admin@local.test", "obchod@local.test"]);
    const byEmail = new Map(((profiles ?? []) as { id: string; email: string; role: string; full_name: string }[]).map((p) => [p.email, p]));
    const a = byEmail.get("admin@local.test")!;
    const o = byEmail.get("obchod@local.test")!;
    admin = person(a.id, a.email, a.role, a.full_name);
    sales = person(o.id, o.email, o.role, o.full_name);
    s = await import("./capture-service");
    r = await import("./capture-review");
  }, 60_000);

  afterAll(async () => {
    delete process.env.AI_FAKE_CAPTURE;
    if (!db) return;
    for (const id of jobIds) {
      const { data: files } = await db.storage.from("job-files").list(`zakazky/${id}`, { limit: 100 });
      const paths = (files ?? []).map((f) => `zakazky/${id}/${f.name}`);
      if (paths.length) await db.storage.from("job-files").remove(paths);
      const { data: masters } = await db.storage.from("job-files").list(`zakazky/${id}/master`, { limit: 100 });
      const mp = (masters ?? []).map((f) => `zakazky/${id}/master/${f.name}`);
      if (mp.length) await db.storage.from("job-files").remove(mp);
    }
    for (const u of [admin, sales]) {
      if (!u) continue;
      const { data: left } = await db.storage.from("job-files").list(`capture/${u.id}`, { limit: 100 });
      // vlastní stránky + relace v1 (.json); náhledy a stránky dávky patří souběžné sadě
      const mine = (left ?? []).filter((f) => f.created_at && f.created_at >= startedAt)
        .map((f) => `capture/${u.id}/${f.name}`)
        .filter((p) => ownPaths.has(p) || p.endsWith(".json"));
      if (mine.length) await db.storage.from("job-files").remove(mine);
    }
    if (jobIds.length) {
      await db.from("ai_training_examples").delete().in("job_id", jobIds);
      await db.from("audit_log").delete().in("entity_id", jobIds);
      await db.from("orders").delete().in("id", jobIds);
    }
    await db.from("ai_corrections").delete().eq("agent_key", "capture").gte("created_at", startedAt);
    if (customerIds.length) await db.from("customers").delete().in("id", customerIds);
  }, 60_000);

  it("objednávka zákazníka: AI přečte, spáruje zákazníka, nabídne zakázky → nová zakázka", async () => {
    h.user = admin;
    process.env.AI_FAKE_CAPTURE = path.join(FIXTURES, "objednavka-strojmetal.json");
    const page = await upload("objednavka-4795.jpg", "image/jpeg", FAKE_JPEG, { master: Buffer.concat([FAKE_JPEG, Buffer.alloc(64)]) });
    const { masterPath: _m, ...pageRef } = page;

    const res = await s.analyzeCapture({ files: [pageRef] });
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    if (!res.ok) return;
    const m: ReviewModel = single(res).model;
    expect(single(res).applied).toBeUndefined(); // výchozí režim = kontrola člověkem
    expect(m.aiUsed).toBe(true);
    expect(m.mode).toBe("approval");
    expect(m.customerMatch).toMatchObject({ name: "Strojmetal a.s.", score: 100 });
    expect(m.previews[0].url).toMatch(/^http/);
    expect(m.options.customers.length).toBeGreaterThan(0);
    // Z-2026-101: stejný zákazník + výkres VK-2291; Z-2026-103 má naši nabídku, ale jiného zákazníka
    const best = m.targets.find((t) => t.key === m.initial.targetKey)!;
    expect(best).toMatchObject({ mode: "existing", number: "Z-2026-101" });
    expect(best.reason).toContain("VK-2291");
    const other = m.targets.find((t) => t.number === "Z-2026-103");
    expect(other?.reason).toContain("jinému zákazníkovi");
    expect(m.targets[m.targets.length - 1].key).toBe("new");
    expect(m.initial.chip).toBe("objednavka_zakaznik");

    // ruční výběr jiné zakázky → návrh pro ni (nic se nezapisuje)
    const retarget = await s.captureTarget({ captureId: m.captureId, jobId: other!.jobId! });
    expect(retarget.ok, retarget.error).toBe(true);
    expect(retarget.target?.mode).toBe("existing");

    // uživatel zvolí „Založit novou zakázku"
    const newT = m.targets.find((t) => t.key === "new")!;
    const fallback = r.defaultCustomerChoice(newT, m.customerMatch, m.docCustomer);
    const state: ReviewState = r.switchTarget(m.initial, best, newT, fallback, { mode: "none" });
    expect(state.customer).toMatchObject({ mode: "existing", name: "Strojmetal a.s." });

    const saved = await s.applyCapture({ captureId: m.captureId, state });
    expect(saved.ok, saved.error).toBe(true);
    jobId = saved.jobId!;
    jobIds.push(jobId);
    expect(saved).toMatchObject({ created: true, aiUsed: true, stageTo: "objednavka", itemsAdded: 2, docLabel: "Objednávka zákazníka" });
    expect(saved.fileIds).toHaveLength(1);
    expect(saved.warnings).toBeUndefined();

    const { data: job } = await db.from("orders").select("*").eq("id", jobId).single();
    expect(job).toMatchObject({
      status: "objednavka", source: "foto", ai_filled: true, customer_order_number: "4795-2026",
      order_date: "2026-10-21", customer_required_date: "2026-11-27", customer_id: m.customerMatch!.id,
      owner_id: sales.id, created_by: admin.id, // zakázka patří obchodníkovi zákazníka
    });
    expect(Number(job!.value)).toBe(107000);
    const { data: items } = await db.from("order_items").select("drawing_number, quantity, unit_price").eq("order_id", jobId).order("position");
    expect((items ?? []).map((i) => [i.drawing_number, Number(i.quantity), Number(i.unit_price)])).toEqual([["VK-2291", 50, 1180], ["VK-2292", 50, 960]]);

    const { data: files } = await db.from("job_files").select("kind, storage_path, ai_extracted, note, title, anon_source_path").eq("job_id", jobId);
    expect(files).toHaveLength(1);
    expect(files![0]).toMatchObject({ kind: "objednavka", title: "Objednávka zákazníka 4795-2026" });
    expect(files![0].storage_path).toMatch(new RegExp(`^zakazky/${jobId}/`));
    // master fotky přesunutý k dokumentu → zdroj anonymizace v plném rozlišení
    expect(files![0].anon_source_path).toBe(`zakazky/${jobId}/master/${String(files![0].storage_path).split("/").pop()!.slice(0, 36)}`);
    expect(await exists(String(files![0].anon_source_path))).toBe(true);
    expect(await exists(page.masterPath!)).toBe(false);
    expect(files![0].ai_extracted).toBeTruthy();
    expect(files![0].note).toContain("atest");
    expect(await exists(page.path)).toBe(false); // přesunuto k zakázce
    expect(await exists(r.captureSessionPath(admin.id, m.captureId))).toBe(false);

    const { data: events } = await db.from("job_events").select("type, message, data").eq("job_id", jobId);
    const ai = (events ?? []).find((e) => e.type === "ai");
    expect(ai?.message).toMatch(/^AI přečetla objednávku zákazníka 4795-2026 a doplnila: /);
    expect((ai?.data as { filledColumns: string[] }).filledColumns).toContain("customer_order_number");
    const { data: train } = await db.from("ai_training_examples").select("source, doc_kind").eq("job_id", jobId);
    expect(train).toEqual([{ source: "ai", doc_kind: "objednavka" }]);

    // stejnou relaci nejde uložit dvakrát
    const again = await s.applyCapture({ captureId: m.captureId, state });
    expect(again.ok).toBe(false);
  }, 60_000);

  it("dodací list dodavatele u pevné zakázky: dodavatel, stav, oprava → AI se učí", async () => {
    expect(jobId).toBeTruthy();
    h.user = admin;
    process.env.AI_FAKE_CAPTURE = path.join(FIXTURES, "dodaci-list-dodavatel.json");
    const pages = [await upload("dl-1.jpg"), await upload("dl-2.jpg")];

    const res = await s.analyzeCapture({ files: pages, jobId });
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    if (!res.ok) return;
    const m = single(res).model;
    expect(m.fixedJobId).toBe(jobId);
    expect(m.targets).toHaveLength(1);
    expect(m.initial).toMatchObject({ chip: "dodaci_list_dodavatel", stage: "dodano_k_nam", fileKind: "dodaci_list", targetKey: jobId });
    expect(m.supplierMatch?.name).toBe("Kovoobrábění Hrubý s.r.o.");
    expect(m.initial.customer).toMatchObject({ mode: "existing", reason: "zákazník zakázky" });
    expect(m.targets[0].proposed.supplierOrderNumber).toBe("OBJ-2026-045");
    expect(m.initial.items).toHaveLength(0); // díly jiných zakázek se nepřidávají

    // jiná zakázka u pevného dokladu nejde
    expect((await s.applyCapture({ captureId: m.captureId, state: { ...m.initial, targetKey: "new" } })).ok).toBe(false);

    const state: ReviewState = { ...m.initial, fields: { ...m.initial.fields, supplierOrderNumber: "OBJ-2026-046" } };
    const saved = await s.applyCapture({ captureId: m.captureId, state });
    expect(saved.ok, saved.error).toBe(true);
    expect(saved).toMatchObject({ created: false, stageFrom: "objednavka", stageTo: "dodano_k_nam", matchedBy: "doklad nahraný u zakázky" });
    expect(saved.fileIds).toHaveLength(2);

    const { data: job } = await db.from("orders").select("status, supplier_id, supplier_order_number").eq("id", jobId).single();
    expect(job).toMatchObject({ status: "dodano_k_nam", supplier_order_number: "OBJ-2026-046", supplier_id: m.supplierMatch!.id });
    const { data: files } = await db.from("job_files").select("kind, title").eq("job_id", jobId).eq("kind", "dodaci_list").order("title");
    expect((files ?? []).map((f) => f.title)).toEqual(["Dodací list dodavatele DL-2026-0877 · str. 1/2", "Dodací list dodavatele DL-2026-0877 · str. 2/2"]);
    const { data: events } = await db.from("job_events").select("type, message").eq("job_id", jobId).eq("type", "stage");
    expect((events ?? []).some((e) => /Dodáno k nám/.test(e.message))).toBe(true);

    const { data: corr } = await db.from("ai_corrections").select("field, ai_value, corrected_value").eq("agent_key", "capture").gte("created_at", startedAt);
    expect(corr).toContainEqual({ field: "Číslo objednávky u dodavatele", ai_value: "OBJ-2026-045", corrected_value: "OBJ-2026-046" });
    const { data: train } = await db.from("ai_training_examples").select("source, final").eq("job_id", jobId).eq("doc_kind", "dodaci_list");
    expect(train?.[0]?.source).toBe("corrected");
    expect((train?.[0]?.final as { customerOrderNumber: string }).customerOrderNumber).toBe("OBJ-2026-046");
  }, 60_000);

  it("bez povoleného AI: stejný formulář prázdný, ruční vyplnění, nový zákazník", async () => {
    h.user = sales;
    process.env.AI_FAKE_CAPTURE = path.join(FIXTURES, "poptavka-novy-zakaznik.json"); // obchodník ho nesmí použít
    const page = await upload("poptavka.pdf", "application/pdf", Buffer.from("%PDF-1.4\n%test\n"));

    const res = await s.analyzeCapture({ files: [page] });
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    if (!res.ok) return;
    const m = single(res).model;
    expect(m.aiUsed).toBe(false);
    expect(m.reason).toMatch(/^Nemáš povolené AI čtení dokladů/);
    expect(m.initial).toMatchObject({ targetKey: "new", fields: {}, items: [], customer: { mode: "none" } });

    const filled = r.changeChip(m.initial, "poptavka_zakaznik", m.targets[0]);
    const name = `E2E Hydraulika ${Date.now()} s.r.o.`;
    const state: ReviewState = {
      ...filled,
      customer: { mode: "new", party: { name, ico: "", dic: "", street: "Dlouhá 1", city: "Brno", zip: "602 00", country: "CZ", email: "", phone: "", contactPerson: "Jana Nová" } },
      fields: { title: "Těleso ventilu — poptávka", customerInquiryNumber: "RFQ-E2E-1", customerRequiredDate: "2026-12-10" },
      items: [{ ...r.emptyReviewItem("n1"), drawingNumber: "TV-77", name: "Těleso ventilu", quantity: "20" }],
    };
    const saved = await s.applyCapture({ captureId: m.captureId, state });
    expect(saved.ok, saved.error).toBe(true);
    jobIds.push(saved.jobId!);
    manualJobId = saved.jobId!;
    if (saved.customerId) customerIds.push(saved.customerId);
    expect(saved).toMatchObject({ created: true, aiUsed: false, customerCreated: true, stageTo: "poptavka", itemsAdded: 1 });

    const { data: job } = await db.from("orders").select("status, customer_inquiry_number, ai_filled, owner_id").eq("id", saved.jobId!).single();
    expect(job).toMatchObject({ status: "poptavka", customer_inquiry_number: "RFQ-E2E-1", ai_filled: false, owner_id: sales.id });
    const { data: events } = await db.from("job_events").select("type, message").eq("job_id", saved.jobId!);
    expect((events ?? []).find((e) => e.type === "file" && e.message.startsWith("Doklad zapsán ručně"))).toBeTruthy();
    const { data: train } = await db.from("ai_training_examples").select("source").eq("job_id", saved.jobId!);
    expect(train).toEqual([{ source: "manual" }]);
    const { data: files } = await db.from("job_files").select("kind, mime_type").eq("job_id", saved.jobId!);
    expect(files).toEqual([{ kind: "poptavka", mime_type: "application/pdf" }]);
  }, 60_000);

  it("plná automatika: jistý doklad u pevné zakázky se uloží hned", async () => {
    expect(manualJobId).toBeTruthy();
    h.user = admin;
    process.env.AI_FAKE_CAPTURE = path.join(FIXTURES, "dodaci-list-dodavatel.json");
    const { data: before } = await db.from("automation_settings").select("module").eq("module", "capture").maybeSingle();
    expect(before).toBeNull(); // výchozí stav = kontrola člověkem
    await db.from("automation_settings").insert({ module: "capture", mode: "full", enabled: true });
    try {
      const page = await upload("dl-auto.jpg");
      const res = await s.analyzeCapture({ files: [page], jobId: manualJobId });
      expect(res.ok, res.ok ? "" : res.error).toBe(true);
      if (!res.ok) return;
      expect(single(res).model.mode).toBe("full");
      expect(single(res).applied).toMatchObject({ ok: true, autoApplied: true, stageFrom: "poptavka", stageTo: "dodano_k_nam", jobId: manualJobId });
      const { data: job } = await db.from("orders").select("status, supplier_order_number").eq("id", manualJobId).single();
      expect(job).toMatchObject({ status: "dodano_k_nam", supplier_order_number: "OBJ-2026-045" });
      const { data: ev } = await db.from("job_events").select("message, data").eq("job_id", manualJobId).eq("type", "ai");
      expect(ev?.[0]?.message).toMatch(/uloženo automaticky$/);
      expect(await exists(r.captureSessionPath(admin.id, single(res).model.captureId))).toBe(false);
    } finally {
      await db.from("automation_settings").delete().eq("module", "capture");
    }
  }, 60_000);

  it("potvrzení dodavatele s naším číslem objednávky → předání do výroby (krok té objednávky, termín z potvrzení, žádná nová objednávka)", async () => {
    h.user = admin;
    process.env.AI_FAKE_CAPTURE = path.join(FIXTURES, "potvrzeni-dodavatel.json");
    const { data: sup } = await db.from("suppliers").select("id").eq("name", "Kovoobrábění Hrubý s.r.o.").limit(1).maybeSingle();
    expect(sup).toBeTruthy();
    const supplierId = (sup as { id: string }).id;
    await db.from("purchase_orders").delete().eq("number", "OV-2026-E2E-POT");
    const { data: job, error: jobErr } = await db.from("orders").insert({
      number: `Z-E2E-POT-${Date.now().toString(36)}`, title: "Potvrzení dodavatele → výroba", source: "manual", status: "potvrzeno",
      order_date: "2026-10-20", owner_id: sales.id, due_date: "2026-12-18",
    }).select("id").single();
    expect(jobErr).toBeNull();
    const jid = (job as { id: string }).id;
    jobIds.push(jid);
    const { data: po, error: poErr } = await db.from("purchase_orders").insert({
      job_id: jid, number: "OV-2026-E2E-POT", supplier_id: supplierId, status: "odeslana", order_date: "2026-10-21", required_date: "2026-11-20", currency: "CZK",
    }).select("id").single();
    expect(poErr).toBeNull();
    const poId = (po as { id: string }).id;

    const res = await s.analyzeCapture({ files: [await upload("pot-1.jpg")], jobId: jid });
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    if (!res.ok) return;
    const m = single(res).model;
    expect(m.initial).toMatchObject({ chip: "potvrzeni_dodavatel", stage: "ve_vyrobe", targetKey: jid });
    const saved = await s.applyCapture({ captureId: m.captureId, state: m.initial });
    expect(saved.ok, saved.error).toBe(true);
    expect(saved).toMatchObject({ stageFrom: "potvrzeno", stageTo: "ve_vyrobe" });

    const { data: ops } = await db.from("job_operations").select("status, supplier_id, purchase_order_id, po_mode, planned_end, deadline_source, handoff_id").eq("job_id", jid);
    expect(ops).toHaveLength(1);
    expect(ops![0]).toMatchObject({ status: "probiha", supplier_id: supplierId, purchase_order_id: poId, po_mode: "existujici", planned_end: "2026-11-27", deadline_source: "potvrzeni_dodavatele" });
    expect(ops![0].handoff_id).toBeTruthy();
    const { data: pos } = await db.from("purchase_orders").select("id").eq("job_id", jid);
    expect(pos).toHaveLength(1);                                    // AI žádnou objednávku nevystaví
    const { data: handoffs } = await db.from("production_handoffs").select("kind, created_by").eq("job_id", jid);
    expect(handoffs).toEqual([{ kind: "predani", created_by: admin.id }]);
  }, 60_000);

  it("bezpečnost: cizí cesty, neplatné soubory, zahození dokladu", async () => {
    h.user = sales;
    const mine = await upload("x.jpg");
    const foreign = { ...mine, path: mine.path.replace(sales.id, admin.id) };
    expect(await s.analyzeCapture({ files: [foreign] })).toMatchObject({ ok: false, error: "Neplatná cesta souboru." });
    expect(await s.analyzeCapture({ files: [] })).toMatchObject({ ok: false });
    // dávka bere i CAD a ostatní soubory (do 50 MB); prázdný / příliš velký soubor ne
    const step = await s.prepareCaptureUpload({ filename: "model.step", size: 10, mimeType: "application/octet-stream" });
    expect(step).toMatchObject({ ok: true });
    if (step.ok && step.path) await db.storage.from("job-files").remove([step.path]);
    expect(await s.prepareCaptureUpload({ filename: "model.step", size: 0 })).toMatchObject({ ok: false, error: "Soubor je prázdný." });
    expect(await s.prepareCaptureUpload({ filename: "big.step", size: 51 * 1024 * 1024 })).toMatchObject({ ok: false, error: "Soubor je větší než 50 MB." });
    expect(await s.applyCapture({ captureId: "00000000-0000-4000-8000-000000000000", state: {} })).toMatchObject({ ok: false });

    expect((await s.discardCapture({ paths: [mine.path, foreign.path] })).ok).toBe(true);
    expect(await exists(mine.path)).toBe(false);

    h.user = { ...sales, active: false };
    expect(await s.prepareCaptureUpload({ filename: "a.jpg", size: 10, mimeType: "image/jpeg" })).toMatchObject({ ok: false });
  }, 60_000);
});
