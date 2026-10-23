import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { zipSync } from "fflate";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BatchSortModel } from "@/lib/jobs/capture-batch-types";

/**
 * Pravidla dávky proti lokálnímu Supabase (testovací AI = AI_FAKE_CAPTURE + značky v názvech):
 * samostatný výkres (firma z razítka = projekce) se spáruje s EXISTUJÍCÍ zakázkou podle čísla výkresu
 * (i druhého čísla na listu), zákazník archivu = zákazník zakázky; víc zakázek se stejným číslem = návrh;
 * počet kusů z objednávky přepíše zakázku bez objednávky; 1 řádek s počtem není „celek"; objednávka
 * jiného zákazníka se nesloučí se ZIPem.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/jobs/capture-batch-rules.integration.test.ts
 * Vlastní data mají prefix „E2E-rules-<běh>"; vše se po sobě uklidí.
 */

const ENABLED = process.env.LOCAL_SUPABASE === "1";
const FIXTURES = path.resolve(process.cwd(), "src/lib/jobs/__fixtures__/capture");
const STROJMETAL = "d2000000-0000-0000-0000-000000000001";

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

const h = vi.hoisted(() => ({ user: null as Record<string, unknown> | null, aiForAll: false }));

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
  const ctx = () => ({ aiEnabled: true, aiCaptureForAll: h.aiForAll, aiConfigured: h.aiForAll });
  const access = () => ({
    user: h.user,
    ctx: ctx(),
    features: perms.allowedFeatures(h.user as never, ctx()),
    can: (f: string) => perms.can(h.user as never, f as never, ctx()),
  });
  return {
    getSessionUser: async () => h.user,
    getAccess: async () => access(),
    checkFeature: async (f: string) => (perms.can(h.user as never, f as never, ctx()) ? { user: h.user } : { error: "K této akci nemáš oprávnění." }),
    apiRequire: async () => ({ user: h.user }),
    requireUser: async () => h.user,
    requireFeature: async () => h.user,
  };
});

type Service = typeof import("./capture-service");
type Batch = typeof import("./capture-batch-service");

function person(id: string, email: string, role: string, fullName: string) {
  return { id, email, fullName, role, initials: "TT", roleLabel: role, aiAccess: false, active: true, hasProfile: true, mustChangePassword: false };
}

const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const png = (seed: number) => Buffer.concat([PNG_1x1, Buffer.from([seed])]);

describe.skipIf(!ENABLED)("Pravidla dávky ↔ lokální Supabase", () => {
  let db: SupabaseClient;
  let s: Service;
  let b: Batch;
  let admin: ReturnType<typeof person>;
  const RUN = Date.now().toString(36);
  const TAG = `E2E-rules-${RUN}`;
  const startedAt = new Date(Date.now() - 1000).toISOString();
  const jobIds = new Set<string>();
  const captureIds = new Set<string>();

  async function upload(filename: string, body: Buffer, mimeType: string) {
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

  async function extractAll(batch: BatchSortModel) {
    for (const d of batch.sort.docs.filter((x) => !x.excluded)) {
      const r = await b.captureBatchExtract({ captureId: batch.captureId, docId: d.id, type: d.type, pageIds: d.pageIds });
      if (!r.ok) throw new Error(r.error);
      expect(r.summary.status).toBe("ready");
    }
  }

  async function insertJob(letter: string, drawingNumber: string): Promise<{ id: string; itemId: string }> {
    const { data, error } = await db.from("orders").insert({
      number: `${TAG}-${letter}`, title: `${TAG} ${letter}`, status: "objednavka", customer_id: STROJMETAL,
    } as never).select("id").single();
    if (error || !data) throw new Error(error?.message ?? "insert");
    const id = (data as { id: string }).id;
    jobIds.add(id);
    const { data: it, error: e2 } = await db.from("order_items").insert({
      order_id: id, position: 0, drawing_number: drawingNumber, name: "Pouzdro", quantity: 12, unit: "ks",
    } as never).select("id").single();
    if (e2 || !it) throw new Error(e2?.message ?? "insert item");
    return { id, itemId: (it as { id: string }).id };
  }

  beforeAll(async () => {
    const env = loadEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    process.env.AI_FAKE_CAPTURE = path.join(FIXTURES, "objednavka-strojmetal.json");
    db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
    const { data: profiles } = await db.from("profiles").select("id, email");
    const by = (email: string) => (profiles ?? []).find((p) => p.email === email)!;
    admin = person(by("admin@local.test").id, "admin@local.test", "super_admin", "Admin");
    s = await import("./capture-service");
    b = await import("./capture-batch-service");
  }, 30_000);

  afterAll(async () => {
    const ids = [...jobIds];
    if (ids.length) {
      const { data: f } = await db.from("job_files").select("storage_path").in("job_id", ids);
      const paths = ((f ?? []) as { storage_path: string }[]).map((x) => x.storage_path);
      if (paths.length) await db.storage.from("job-files").remove(paths);
      await db.from("drawings").delete().in("job_id", ids);
      await db.from("quotes").delete().in("job_id", ids);
      await db.from("orders").delete().in("id", ids);
    }
    await db.from("quotes").delete().like("number", "NAB-ITR-90%").gte("created_at", startedAt);
    await db.from("drawings").delete().eq("drawing_number", "IT-VK-9402").gte("created_at", startedAt);
    for (const [entity, col] of [["orders", "number"]] as const) {
      const { data } = await db.from("audit_log").select("id").eq("entity", entity).like(`diff->row->>${col}`, `${TAG}%`).limit(1000);
      const aid = ((data ?? []) as { id: number }[]).map((r) => r.id);
      if (aid.length) await db.from("audit_log").delete().in("id", aid);
    }
    for (const id of captureIds) {
      const { data } = await db.from("capture_sessions").select("data").eq("id", id).maybeSingle();
      const fs = ((data as { data?: { files?: { path: string; sortPath?: string }[] } } | null)?.data?.files ?? []);
      if (fs.length) await db.storage.from("job-files").remove(fs.flatMap((x) => [x.path, ...(x.sortPath ? [x.sortPath] : [])]));
      await db.from("capture_sessions").delete().eq("id", id);
    }
    await db.from("ai_training_examples").delete().gte("created_at", startedAt).in("kind", ["capture", "capture_drawing", "capture_sort"]).eq("created_by", admin.id);
  }, 120_000);

  it("samostatný výkres projekční firmy → silná shoda s existující zakázkou podle 2. čísla, uloží se k položce", async () => {
    h.user = admin;
    const job = await insertJob("A", "IT-SM-9402-B");
    const batch = await analyze([await upload(`${TAG}__vykres-g7.png`, png(1), "image/png")]);
    const vk = batch.sort.docs.find((d) => d.type === "vykres")!;
    expect(vk.partyName).toBe("");
    await extractAll(batch);
    const r = await b.captureBatchReview({ captureId: batch.captureId, sort: batch.sort });
    if (!r.ok) throw new Error(r.error);
    const rv = r.review;
    expect(rv.groups).toHaveLength(1);
    expect(rv.initial.groups[0].job.targetKey).toBe(job.id);
    expect(rv.groups[0].autoReason ?? rv.groups[0].model.targets.find((t) => t.key === job.id)?.reason).toMatch(/podle čísla výkresu IT-SM-9402-B/);
    expect(rv.warnings.some((w) => w.code === "target_required")).toBe(false);
    const st = rv.initial.docs[vk.id];
    expect(st.kind === "drawing" && st.state.link).toEqual({ mode: "item", itemId: job.itemId });
    const dr = rv.docs.find((d) => d.docId === vk.id);
    expect(dr?.kind === "drawing" && dr.drawing.customerName).toBe("Projekce Novák s.r.o.");
    expect(dr?.kind === "drawing" && dr.drawing.drawingNumbers).toEqual(["IT-VK-9402", "IT-SM-9402-B"]);

    const res = await b.captureBatchApply({ captureId: batch.captureId, state: rv.initial });
    expect(res.status, JSON.stringify(res).slice(0, 800)).toBe("done");
    expect(res.groups[0]).toMatchObject({ jobId: job.id, created: false });
    const { data: jf } = await db.from("job_files").select("kind, order_item_id").eq("job_id", job.id);
    expect(jf).toEqual([{ kind: "vykres", order_item_id: job.itemId }]);
    // archiv výkresů: zákazník zakázky, ne projekce z razítka
    const { data: arch } = await db.from("drawings").select("customer_id, job_id").eq("drawing_number", "IT-VK-9402").maybeSingle();
    expect(arch).toMatchObject({ customer_id: STROJMETAL, job_id: job.id });
  }, 120_000);

  it("víc otevřených zakázek se stejným číslem → bez silné shody, návrh + upozornění, cíl vybere člověk", async () => {
    h.user = admin;
    await insertJob("B", "IT-SM-9402-B");
    const batch = await analyze([await upload(`${TAG}-amb__vykres-g7.png`, png(2), "image/png")]);
    await extractAll(batch);
    const r = await b.captureBatchReview({ captureId: batch.captureId, sort: batch.sort });
    if (!r.ok) throw new Error(r.error);
    expect(r.review.initial.groups[0].job.targetKey).toBe("");
    expect(r.review.warnings.find((w) => w.code === "group_uncertain")?.message).toMatch(new RegExp(`${TAG}-A.*${TAG}-B|${TAG}-B.*${TAG}-A`));
    const targets = r.review.groups[0].model.targets.map((t) => t.key);
    expect(targets.length).toBeGreaterThanOrEqual(3); // obě zakázky + nová
  }, 120_000);

  it("objednávka k zakázce z naší nabídky (40 ks) bez objednávky → položka 50 ks (platí objednávka)", async () => {
    h.user = admin;
    const { data: job, error } = await db.from("orders").insert({
      number: `${TAG}-Q`, title: `${TAG} Q`, status: "nabidka", customer_id: STROJMETAL,
    } as never).select("id").single();
    if (error || !job) throw new Error(error?.message ?? "insert");
    const jobId = (job as { id: string }).id;
    jobIds.add(jobId);
    await db.from("order_items").insert([
      { order_id: jobId, position: 0, drawing_number: "ITR-901-A", name: "Upínací deska", quantity: 40, unit: "ks" },
      { order_id: jobId, position: 1, drawing_number: "ITR-901-B", name: "Vodicí lišta", quantity: 20, unit: "ks" },
    ] as never);
    const { error: qe } = await db.from("quotes").insert({ number: "NAB-ITR-901", job_id: jobId, customer_id: STROJMETAL } as never);
    if (qe) throw new Error(qe.message);
    const batch = await analyze([
      await upload(`${TAG}__objednavka_zakaznik-g8.png`, png(11), "image/png"),
      await upload(`${TAG}__vykres-g8.png`, png(12), "image/png"),
    ]);
    await extractAll(batch);
    const r = await b.captureBatchReview({ captureId: batch.captureId, sort: batch.sort });
    if (!r.ok) throw new Error(r.error);
    const g = r.review.initial.groups[0];
    expect(g.job.targetKey).toBe(jobId);
    expect(g.job.merges.find((m) => m.drawingNumber === "ITR-901-A")).toMatchObject({ patch: { quantity: "50" }, override: ["quantity"] });
    expect(r.review.warnings.map((w) => w.message)).toContain("Platí objednávka: 50 ks (zakázka 40 ks) — ITR-901-A");
    const res = await b.captureBatchApply({ captureId: batch.captureId, state: r.review.initial });
    expect(res.status, JSON.stringify(res).slice(0, 800)).toBe("done");
    const { data: items } = await db.from("order_items").select("drawing_number, quantity").eq("order_id", jobId).order("position");
    expect(items).toEqual([{ drawing_number: "ITR-901-A", quantity: 50 }, { drawing_number: "ITR-901-B", quantity: 20 }]);
  }, 120_000);

  it("1 řádek objednávky s počtem (50 ks, bez čísla výkresu) + naše nabídka 40 ks → nová zakázka 50 ks", async () => {
    h.user = admin;
    const batch = await analyze([
      await upload(`${TAG}__objednavka_zakaznik-g9.png`, png(13), "image/png"),
      await upload(`${TAG}__nabidka_my-g9.png`, png(14), "image/png"),
    ]);
    await extractAll(batch);
    const r = await b.captureBatchReview({ captureId: batch.captureId, sort: batch.sort });
    if (!r.ok) throw new Error(r.error);
    const g = r.review.initial.groups[0];
    expect(g.job.items.map((i) => [i.drawingNumber, i.quantity, i.unitPrice])).toEqual([["ITR-902-H", "50", "200"]]);
    expect(r.review.warnings.some((w) => w.code === "whole_order")).toBe(false);
    expect(r.review.warnings.map((w) => w.message)).toContain("Platí objednávka: 50 ks (nabídka 40 ks) — ITR-902-H");
    const res = await b.captureBatchApply({ captureId: batch.captureId, state: r.review.initial });
    for (const x of res.groups) if (x.jobId) jobIds.add(x.jobId);
    expect(res.status, JSON.stringify(res).slice(0, 800)).toBe("done");
    const { data: items } = await db.from("order_items").select("drawing_number, quantity, unit_price").eq("order_id", res.groups[0].jobId!);
    expect(items).toEqual([{ drawing_number: "ITR-902-H", quantity: 50, unit_price: 200 }]);
  }, 120_000);

  it("samostatná objednávka jiného zákazníka + ZIP Strojmetalu (poptávka bez zákazníka + nabídka) → 2 skupiny", async () => {
    h.user = admin;
    const zip = Buffer.from(zipSync({
      "a__poptavka_zakaznik-g10.png": new Uint8Array(png(15)),
      "b__nabidka_my-g10.png": new Uint8Array(png(16)),
    }));
    const batch = await analyze([
      await upload(`${TAG}__objednavka_zakaznik-g10.png`, png(17), "image/png"),
      await upload(`${TAG}-podklady.zip`, zip, "application/zip"),
    ]);
    await extractAll(batch);
    const r = await b.captureBatchReview({ captureId: batch.captureId, sort: batch.sort });
    if (!r.ok) throw new Error(r.error);
    const byType = (t: string) => batch.sort.docs.find((d) => d.type === t)!.id;
    const groupOf = (id: string) => r.review.initial.groups.find((x) => x.docIds.includes(id))!;
    const kovo = groupOf(byType("objednavka_zakaznik"));
    expect(kovo.docIds).toEqual([byType("objednavka_zakaznik")]);
    expect(kovo.customerConfirmed).toBe(false);
    const zipGroup = groupOf(byType("nabidka_my"));
    expect(zipGroup.docIds.sort()).toEqual([byType("poptavka_zakaznik"), byType("nabidka_my")].sort());
    expect(zipGroup.customerConfirmed).toBe(true);
    expect(r.review.groups.find((x) => x.key === zipGroup.key)!.model.docCustomer.name).toMatch(/STROJMETAL/i);
  }, 120_000);
});
