import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BatchSortModel, DrawingReviewState } from "@/lib/jobs/capture-batch-types";

/**
 * Výkres → materiál, hmotnost, TZ / PÚ (napojení Krok B) proti lokálnímu Supabase (AI_FAKE_CAPTURE + značky):
 * uložení dávky zapíše skupinu materiálu, polotovar, kroky úprav s výslovným stavem a poznámky do položky
 * zakázky (order_items), archivu výkresů (drawings) i metadat dokumentu (job_files.ai_extracted) shodně;
 * ručně zadané hodnoty (spec_sources „rucne") se nepřepíšou, ruční úprava v kontrole ano.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/jobs/capture-drawing-spec.integration.test.ts
 * Vlastní data mají prefix „E2E-spec-<běh>"; čísla výkresů E2E-VK-1801/1802 se před i po testu uklidí.
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

const NUMBERS = ["E2E-VK-1801", "E2E-VK-1802", "E2E-VK-1901"];
const ITEM_SPEC = "drawing_number, material, material_group, material_designation, weight_kg, weight_source, blank_weight_kg, blank_dims, blank_shape, heat_status, heat_steps, heat_treatment, hardness, surface_status, surface_steps, surface_treatment, drawing_notes, spec_sources";

describe.skipIf(!ENABLED)("Výkres → materiál a úpravy ↔ lokální Supabase", () => {
  let db: SupabaseClient;
  let s: Service;
  let b: Batch;
  let admin: ReturnType<typeof person>;
  const RUN = Date.now().toString(36);
  const TAG = `E2E-spec-${RUN}`;
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

  async function review(files: Awaited<ReturnType<typeof upload>>[]) {
    const batch = await analyze(files);
    for (const d of batch.sort.docs.filter((x) => !x.excluded)) {
      const r = await b.captureBatchExtract({ captureId: batch.captureId, docId: d.id, type: d.type, pageIds: d.pageIds });
      if (!r.ok) throw new Error(r.error);
    }
    const r = await b.captureBatchReview({ captureId: batch.captureId, sort: batch.sort });
    if (!r.ok) throw new Error(r.error);
    return { batch, rv: r.review };
  }

  async function cleanJob(id: string) {
    const { data: f } = await db.from("job_files").select("storage_path").eq("job_id", id);
    const paths = ((f ?? []) as { storage_path: string }[]).map((x) => x.storage_path);
    if (paths.length) await db.storage.from("job-files").remove(paths);
    await db.from("drawings").delete().eq("job_id", id);
    await db.from("orders").delete().eq("id", id);
    jobIds.delete(id);
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
    await db.from("drawings").delete().in("drawing_number", NUMBERS);
  }, 30_000);

  afterAll(async () => {
    for (const id of [...jobIds]) await cleanJob(id);
    await db.from("drawings").delete().in("drawing_number", NUMBERS);
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

  it("objednávka + 2 výkresy: položky, archiv i dokumenty mají stejný materiál, polotovar a úpravy (i výslovné „bez“)", async () => {
    h.user = admin;
    const { batch, rv } = await review([
      await upload(`${TAG}__objednavka_zakaznik-g18.png`, png(1), "image/png"),
      await upload(`${TAG}-a__vykres-g18a.png`, png(2), "image/png"),
      await upload(`${TAG}-b__vykres-g18b.png`, png(3), "image/png"),
    ]);
    expect(rv.groups).toHaveLength(1);
    rv.initial.groups[0].job.targetKey = "new";
    const drawings = rv.docs.filter((d) => d.kind === "drawing");
    expect(drawings).toHaveLength(2);
    const stA = (rv.initial.docs[drawings.find((d) => d.kind === "drawing" && d.drawing.drawingNumber === NUMBERS[0])!.docId].state as DrawingReviewState);
    expect(stA.spec).toMatchObject({ materialGroup: "nastrojova_ocel", heatStatus: "uvedeno", surfaceStatus: "uvedeno", blankShape: "kulatina" });
    expect(stA.spec?.heatSteps.map((x) => `${x.kind}:${x.value}:${x.unit}`)).toEqual(["kaleni:58±2:HRC", "nitridace:700:HV"]);

    const res = await b.captureBatchApply({ captureId: batch.captureId, state: rv.initial });
    for (const g of res.groups) if (g.jobId) jobIds.add(g.jobId);
    expect(res.status, JSON.stringify(res).slice(0, 800)).toBe("done");
    const jobId = res.groups[0].jobId!;
    const { data: items } = await db.from("order_items").select(ITEM_SPEC).eq("order_id", jobId).order("position");
    const [a, bb] = items as Record<string, unknown>[];
    expect(a).toMatchObject({
      drawing_number: NUMBERS[0], material_group: "nastrojova_ocel", material_designation: "1.2379", heat_status: "uvedeno",
      heat_treatment: "kalení 58±2 HRC (vakuově); nitridace 700 HV, hloubka 0,1 mm", hardness: "58±2 HRC",
      surface_status: "uvedeno", surface_treatment: "černění", blank_shape: "kulatina", weight_source: "odhad",
      spec_sources: expect.objectContaining({ heat: "ai", surface: "ai", blank: "ai" }),
    });
    expect(Number(a.blank_weight_kg)).toBeGreaterThan(0.5);
    expect((a.heat_steps as unknown[]).length).toBe(2);
    expect(String(a.drawing_notes).split("\n")).toHaveLength(4);
    expect(bb).toMatchObject({
      drawing_number: NUMBERS[1], material_group: "bezna_ocel", heat_status: "bez", heat_steps: null, heat_treatment: null,
      surface_status: "bez", surface_treatment: null, weight_kg: 2.6, weight_source: "vykres",
    });
    // archiv výkresů = stejné hodnoty
    const { data: arch } = await db.from("drawings").select(ITEM_SPEC).in("drawing_number", NUMBERS).order("drawing_number");
    const cols = ["material_group", "material_designation", "weight_kg", "weight_source", "blank_weight_kg", "blank_dims", "blank_shape", "heat_status", "heat_steps", "heat_treatment", "hardness", "surface_status", "surface_steps", "surface_treatment", "drawing_notes"];
    const pick = (r: Record<string, unknown>) => Object.fromEntries(cols.map((c) => [c, r[c]]));
    expect((arch as Record<string, unknown>[]).map(pick)).toEqual([pick(a), pick(bb)]);
    // dokumenty zakázky: ai_extracted se stejnými údaji
    const { data: jf } = await db.from("job_files").select("ai_extracted, order_item_id").eq("job_id", jobId).eq("kind", "vykres");
    const ex = ((jf ?? []) as { ai_extracted: Record<string, unknown>; order_item_id: string | null }[])
      .map((f) => f.ai_extracted).sort((x, y) => String(x.drawingNumber).localeCompare(String(y.drawingNumber)));
    expect(ex[0]).toMatchObject({ materialGroup: "nastrojova_ocel", heatStatus: "uvedeno", surfaceStatus: "uvedeno", heatTreatment: a.heat_treatment, blankWeightKg: Number(a.blank_weight_kg) });
    expect(ex[0].heatSteps).toEqual(a.heat_steps);
    expect(ex[1]).toMatchObject({ heatStatus: "bez", surfaceStatus: "bez", weightKg: 2.6, weightSource: "vykres" });
    await cleanJob(jobId);
    await db.from("drawings").delete().in("drawing_number", NUMBERS);
  }, 180_000);

  it("ručně zadané u položky i v archivu zůstane; AI doplní jen prázdné; ruční úprava v kontrole přepíše", async () => {
    h.user = admin;
    const { data: job, error } = await db.from("orders").insert({
      number: `${TAG}-H`, title: `${TAG} H`, status: "objednavka", customer_id: STROJMETAL,
    } as never).select("id").single();
    if (error || !job) throw new Error(error?.message ?? "insert");
    const jobId = (job as { id: string }).id;
    jobIds.add(jobId);
    const { data: it } = await db.from("order_items").insert({
      order_id: jobId, position: 0, drawing_number: NUMBERS[0], name: "Razník", quantity: 8, unit: "ks",
      material_group: "nerez", heat_status: "bez", spec_sources: { material_group: "rucne", heat: "rucne" },
    } as never).select("id").single();
    const itemId = (it as { id: string }).id;
    // archiv: ručně „bez PÚ“ a skupina od AI (hliník) u téhož zákazníka
    await db.from("drawings").insert({
      drawing_number: NUMBERS[0], revision: "-", customer_id: STROJMETAL, file_type: "PDF", storage_path: "x", storage_bucket: "job-files",
      surface_status: "bez", spec_sources: { surface: "rucne", material_group: "ai" }, material_group: "hlinik", ai_metadata: {},
    } as never);

    const { batch, rv } = await review([await upload(`${TAG}-h__vykres-g18a.png`, png(4), "image/png")]);
    expect(rv.initial.groups[0].job.targetKey).toBe(jobId);
    const res = await b.captureBatchApply({ captureId: batch.captureId, state: rv.initial });
    expect(res.status, JSON.stringify(res).slice(0, 800)).toBe("done");
    expect(res.docs[0].summary).toMatch(/zůstalo ručně zadané: skupina materiálu, tepelné zpracování/);
    const { data: row } = await db.from("order_items").select(ITEM_SPEC).eq("id", itemId).single();
    expect(row).toMatchObject({
      material_group: "nerez", heat_status: "bez", heat_treatment: null, // ruční
      surface_status: "uvedeno", surface_treatment: "černění", blank_shape: "kulatina", // doplněno
      spec_sources: expect.objectContaining({ material_group: "rucne", heat: "rucne", surface: "ai" }),
    });
    const { data: arch } = await db.from("drawings").select(ITEM_SPEC).eq("drawing_number", NUMBERS[0]).single();
    expect(arch).toMatchObject({ surface_status: "bez", surface_treatment: null, material_group: "nastrojova_ocel", heat_status: "uvedeno" });

    // druhé focení téhož výkresu, v kontrole člověk TZ výslovně upravil → přepíše i ruční hodnotu
    const second = await review([await upload(`${TAG}-h2__vykres-g18a.png`, png(5), "image/png")]);
    const docId = second.rv.docs.find((d) => d.kind === "drawing")!.docId;
    const st = second.rv.initial.docs[docId].state as DrawingReviewState;
    st.spec = { ...st.spec!, heatSteps: [{ kind: "kaleni", value: "60", unit: "HRC", depthMm: "", note: "" }], manual: ["heat"] };
    st.onDuplicate = "version";
    const res2 = await b.captureBatchApply({ captureId: second.batch.captureId, state: second.rv.initial });
    expect(res2.status, JSON.stringify(res2).slice(0, 800)).toBe("done");
    const { data: row2 } = await db.from("order_items").select(ITEM_SPEC).eq("id", itemId).single();
    expect(row2).toMatchObject({ heat_status: "uvedeno", heat_treatment: "kalení 60 HRC", hardness: "60 HRC", material_group: "nerez",
      spec_sources: expect.objectContaining({ heat: "rucne", material_group: "rucne" }) });
  }, 240_000);

  it("objednávka 42CrMo4 × výkres C45: platí objednávka; druhé focení beze změn; odhad nenahradí hmotnost z výkresu; starší revize nepřepíše", async () => {
    h.user = admin;
    const NUM = "E2E-VK-1901";
    const { data: job, error } = await db.from("orders").insert({
      number: `${TAG}-R`, title: `${TAG} R`, status: "objednavka", customer_id: STROJMETAL,
    } as never).select("id").single();
    if (error || !job) throw new Error(error?.message ?? "insert");
    const jobId = (job as { id: string }).id;
    jobIds.add(jobId);
    const { data: it } = await db.from("order_items").insert({
      order_id: jobId, position: 0, drawing_number: NUM, name: "Čep", material: "42CrMo4", quantity: 4, unit: "ks",
    } as never).select("id").single();
    const itemId = (it as { id: string }).id;
    const apply = async (file: string, seed: number) => {
      const r = await review([await upload(`${TAG}-${seed}__${file}.png`, png(seed), "image/png")]);
      expect(r.rv.initial.groups[0].job.targetKey).toBe(jobId);
      const res = await b.captureBatchApply({ captureId: r.batch.captureId, state: r.rv.initial });
      expect(res.status, JSON.stringify(res).slice(0, 800)).toBe("done");
      const { data: row } = await db.from("order_items").select(`${ITEM_SPEC}, revision`).eq("id", itemId).single();
      const { data: ev } = await db.from("job_events").select("message").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1);
      return { res, row: row as Record<string, unknown>, event: String((ev as { message: string }[] | null)?.[0]?.message ?? "") };
    };

    // 1) rev. B, C45 na výkresu, objednávka 42CrMo4 → u položky platí objednávka (skupina, označení), upozornění
    const one = await apply("vykres-g19a", 11);
    expect(one.res.docs[0].summary).toMatch(/Materiál: objednávka 42CrMo4 × výkres C45 — u položky platí objednávka/);
    expect(one.row).toMatchObject({
      material: "42CrMo4", material_group: "zuslechtena_ocel", material_designation: "42CrMo4", revision: "B",
      heat_status: "uvedeno", heat_treatment: "kalení 60 HRC", surface_treatment: "černění", weight_kg: 2.6, weight_source: "vykres",
    });
    const { data: arch } = await db.from("drawings").select(ITEM_SPEC).eq("drawing_number", NUM).single();
    expect(arch).toMatchObject({ material_group: "bezna_ocel", material_designation: "C45" }); // archiv = výkres

    // 2) totéž znovu, AI hmotnost nepřečetla (odhad): stejné hodnoty = žádná změna, odhad nenahradí 2,6 kg z výkresu
    const two = await apply("vykres-g19c", 12);
    expect(two.row).toMatchObject({ weight_kg: 2.6, weight_source: "vykres", heat_treatment: "kalení 60 HRC" });
    expect(two.row.heat_steps).toEqual(one.row.heat_steps);
    expect(two.event).not.toMatch(/tepelné zpracování|povrchová úprava|hmotnost dílu/);
    expect(two.res.docs[0].summary).not.toMatch(/zůstalo ručně zadané/);

    // 3) starší rev. A (bez úprav) vyfocená později: uloží se vedle, položka drží hodnoty rev. B
    const three = await apply("vykres-g19b", 13);
    expect(three.res.docs[0].summary).toMatch(/rev\. A se uložil vedle/);
    expect(three.row).toMatchObject({ revision: "B", heat_status: "uvedeno", heat_treatment: "kalení 60 HRC", surface_status: "uvedeno", surface_treatment: "černění" });
    expect(three.event).not.toMatch(/tepelné zpracování|povrchová úprava/);
    await cleanJob(jobId);
    await db.from("drawings").delete().eq("drawing_number", NUM);
  }, 300_000);
});
