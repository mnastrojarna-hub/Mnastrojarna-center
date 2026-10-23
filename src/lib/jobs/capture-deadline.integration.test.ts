import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BatchSortModel } from "@/lib/jobs/capture-batch-types";

/**
 * Pravidla dávky 2 proti lokálnímu Supabase (testovací AI = AI_FAKE_CAPTURE + značky v názvech):
 * objednávka bez termínu k zakázce s NAŠÍ nabídkou v systému (quotes / dříve uložený doklad nabídky)
 * → termín z nabídky (lhůta od data objednání), jednodokladový tok i dávka; „ks dle výkresu" → počet
 * z výkresu do položky i k výkresu; produkční případ objednávka + výkres + model + fotka + naše nabídka
 * psaná na jinak zapsaného zákazníka = JEDNA zakázka.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/jobs/capture-deadline.integration.test.ts
 * Vlastní data mají prefix „E2E-dl-<běh>"; vše se po sobě uklidí.
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

describe.skipIf(!ENABLED)("Pravidla dávky 2 ↔ lokální Supabase (termín z nabídky, počty u výkresů, 1 nahrání = 1 zakázka)", () => {
  let db: SupabaseClient;
  let s: Service;
  let b: Batch;
  let admin: ReturnType<typeof person>;
  const RUN = Date.now().toString(36);
  const TAG = `E2E-dl-${RUN}`;
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
    await db.from("quotes").delete().like("number", "NAB-ITD-9%").gte("created_at", startedAt);
    await db.from("drawings").delete().in("drawing_number", ["ITD-916-A", "F00N603W84"]).gte("created_at", startedAt);
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

  it("jednodokladový tok: objednávka bez termínu k zakázce s naší nabídkou v systému (4 týdny) → termín z nabídky", async () => {
    h.user = admin;
    const { data: job, error } = await db.from("orders").insert({
      number: `${TAG}-Q1`, title: `${TAG} Q1`, status: "nabidka", customer_id: STROJMETAL,
    } as never).select("id").single();
    if (error || !job) throw new Error(error?.message ?? "insert");
    const jobId = (job as { id: string }).id;
    jobIds.add(jobId);
    const { error: qe } = await db.from("quotes").insert({
      number: "NAB-ITD-915", job_id: jobId, customer_id: STROJMETAL, status: "odeslano", delivery_terms: "Dodací lhůta 4 týdny od objednávky",
    } as never);
    if (qe) throw new Error(qe.message);
    const res = await s.analyzeCapture({ files: [await upload(`${TAG}__objednavka_zakaznik-g15.png`, png(21), "image/png")] });
    if (!res.ok || !("model" in res) || !res.model) throw new Error(`Čekám jeden doklad: ${JSON.stringify(res).slice(0, 400)}`);
    const model = res.model;
    captureIds.add(model.captureId);
    const t = model.targets.find((x) => x.key === jobId);
    expect(t, JSON.stringify(model.targets.map((x) => [x.key, x.reason]))).toBeTruthy();
    expect(t!.proposed.customerRequiredDate).toBe("2026-11-18");
    expect(t!.proposed.dueDate).toBe("2026-11-18");
    expect(model.needsClarification.join(" | ")).toMatch(/převzat z nabídky NAB-ITD-915 v systému \(4 týdny od objednání → 18\. 11\. 2026\)/);
    expect(model.initial.targetKey).toBe(jobId);
    const applied = await s.applyCapture({ captureId: model.captureId, state: model.initial });
    expect(applied.ok, JSON.stringify(applied).slice(0, 500)).toBe(true);
    const { data: row } = await db.from("orders").select("customer_required_date, due_date, customer_order_number").eq("id", jobId).single();
    expect(row).toMatchObject({ customer_required_date: "2026-11-18", due_date: "2026-11-18", customer_order_number: "PO-ITD-915" });
  }, 120_000);

  it("jedna fotka objednávky: termín = datum objednávky, bez nabídky → termín se neuloží + varování (žádná plná automatika)", async () => {
    h.user = admin;
    const res = await s.analyzeCapture({ files: [await upload(`${TAG}__objednavka_zakaznik-g17.png`, png(24), "image/png")] });
    if (!res.ok || !("model" in res) || !res.model) throw new Error(`Čekám jeden doklad: ${JSON.stringify(res).slice(0, 400)}`);
    const model = res.model;
    captureIds.add(model.captureId);
    if ("applied" in res && res.applied && "jobId" in res.applied && typeof res.applied.jobId === "string") jobIds.add(res.applied.jobId);
    expect("applied" in res && res.applied).toBeFalsy();
    const t = model.targets.find((x) => x.key === model.initial.targetKey)!;
    expect(t.mode).toBe("new");
    expect(t.proposed.orderDate).toBe("2026-10-20");
    expect(t.proposed.customerRequiredDate ?? "").toBe("");
    expect(model.initial.fields.customerRequiredDate ?? "").toBe("");
    expect(model.needsClarification.join(" | ")).toMatch(/stejný jako datum objednávky\) a nabídka s lhůtou chybí — termín se neuloží, doplň termín zakázky/);
    await s.discardCapture({ captureId: model.captureId });
  }, 120_000);

  it("dávka: zakázka jen s DOKLADEM naší nabídky (5 týdnů od potvrzení) + objednávka „ks dle výkresu“ + výkres → termín, počet i název", async () => {
    h.user = admin;
    const { data: job, error } = await db.from("orders").insert({
      number: `${TAG}-Q2`, title: `${TAG} Q2`, status: "nabidka", customer_id: STROJMETAL,
    } as never).select("id").single();
    if (error || !job) throw new Error(error?.message ?? "insert");
    const jobId = (job as { id: string }).id;
    jobIds.add(jobId);
    await db.from("order_items").insert({ order_id: jobId, position: 0, drawing_number: "ITD-916-A", name: "Pouzdro", quantity: 1, unit: "ks" } as never);
    const { error: fe } = await db.from("job_files").insert({
      job_id: jobId, kind: "nabidka", filename: "nabidka-137.pdf", storage_path: `zakazky/${jobId}/nabidka-137.pdf`, title: "Nabídka 137/026",
      ai_extracted: { docKind: "nabidka", issuer: "my", documentNumber: "137/026", deliveryTerms: "dodací lhůta 5 týdnů od potvrzení objednávky", items: [] },
    } as never);
    if (fe) throw new Error(fe.message);
    const batch = await analyze([
      await upload(`${TAG}__objednavka_zakaznik-g16.png`, png(22), "image/png"),
      await upload(`${TAG}__vykres-g16.png`, png(23), "image/png"),
    ]);
    await extractAll(batch);
    const r = await b.captureBatchReview({ captureId: batch.captureId, sort: batch.sort });
    if (!r.ok) throw new Error(r.error);
    expect(r.review.groups).toHaveLength(1);
    const g = r.review.initial.groups[0];
    // číslo vyfocené nabídky (doklad zakázky) páruje objednávku „dle nabídky 137/026"
    expect(g.job.targetKey).toBe(jobId);
    expect(g.job.fields.customerRequiredDate).toBe("2026-11-25");
    expect(g.job.fields.dueDate).toBe("2026-11-25");
    expect(r.review.groups[0].fieldSources.customerRequiredDate?.label).toBe("z nabídky 137/026 v systému (5 týdnů od potvrzení objednávky → 25. 11. 2026)");
    // „ks dle výkresu" → položka zakázky i výkres 14 ks, název výkresu = název položky
    expect(g.job.merges.find((m) => m.drawingNumber === "ITD-916-A")).toMatchObject({ patch: { quantity: "14" }, override: ["quantity"] });
    const vk = batch.sort.docs.find((d) => d.type === "vykres")!;
    const st = r.review.initial.docs[vk.id];
    expect(st.kind === "drawing" && { q: st.state.quantity, t: st.state.title }).toEqual({ q: "14", t: "Pouzdro" });
    const res = await b.captureBatchApply({ captureId: batch.captureId, state: r.review.initial });
    expect(res.status, JSON.stringify(res).slice(0, 800)).toBe("done");
    const { data: row } = await db.from("orders").select("customer_required_date, due_date").eq("id", jobId).single();
    expect(row).toEqual({ customer_required_date: "2026-11-25", due_date: "2026-11-25" });
    const { data: items } = await db.from("order_items").select("drawing_number, quantity").eq("order_id", jobId);
    expect(items).toEqual([{ drawing_number: "ITD-916-A", quantity: 14 }]);
    const { data: vf } = await db.from("job_files").select("title, ai_extracted").eq("job_id", jobId).eq("kind", "vykres").single();
    const v = vf as { title: string; ai_extracted: { quantity: number; title: string } };
    expect(v.title).toMatch(/Výkres ITD-916-A · Pouzdro/);
    expect(v.ai_extracted).toMatchObject({ quantity: 14, title: "Pouzdro" });
    const { data: arch } = await db.from("drawings").select("quantity, title").eq("drawing_number", "ITD-916-A").eq("job_id", jobId).maybeSingle();
    expect(arch).toEqual({ quantity: 14, title: "Pouzdro" });
  }, 120_000);

  it("produkční případ: objednávka 8000060875/GPO84339 + výkres + STEP + fotka + naše nabídka 136/026 → JEDNA zakázka", async () => {
    h.user = admin;
    const step = Buffer.from("ISO-10303-21;\nHEADER;\nFILE_NAME('EM72231CJ0000.stp');\nENDSEC;\nDATA;\n#1=PRODUCT('EM72231CJ0000','EM72231CJ0000','',(#2));\nENDSEC;\nEND-ISO-10303-21;\n");
    const batch = await analyze([
      await upload(`${TAG}__objednavka_zakaznik-g11.png`, png(31), "image/png"),
      await upload(`${TAG}__vykres-g11.png`, png(32), "image/png"),
      await upload(`${TAG}-EM72231CJ0000.step`, step, "application/step"),
      await upload(`${TAG}__foto.png`, png(33), "image/png"),
      await upload(`${TAG}__nabidka_my-g11.png`, png(34), "image/png"),
    ]);
    expect(batch.sort.docs.map((d) => d.type).sort()).toEqual(["foto", "model_3d", "nabidka_my", "objednavka_zakaznik", "vykres"]);
    await extractAll(batch);
    const r = await b.captureBatchReview({ captureId: batch.captureId, sort: batch.sort });
    if (!r.ok) throw new Error(r.error);
    expect(r.review.groups, r.review.groups.map((g) => `${g.label} (${g.autoReason})`).join(" | ")).toHaveLength(1);
    expect(r.review.warnings.some((w) => w.severity === "block")).toBe(false);
    const g = r.review.initial.groups[0];
    expect(g.job.targetKey).toBe("new");
    expect(g.job.stage).toBe("objednavka");
    const res = await b.captureBatchApply({ captureId: batch.captureId, state: r.review.initial });
    for (const x of res.groups) if (x.jobId) jobIds.add(x.jobId);
    expect(res.status, JSON.stringify(res).slice(0, 800)).toBe("done");
    expect(res.groups).toHaveLength(1);
    const jobId = res.groups[0].jobId!;
    const { data: row } = await db.from("orders").select("status, customer_id, customer_order_number, customer_required_date").eq("id", jobId).single();
    expect(row).toMatchObject({ status: "objednavka", customer_id: STROJMETAL, customer_order_number: "8000060875/GPO84339", customer_required_date: "2026-11-17" });
    const { data: files } = await db.from("job_files").select("kind, title, ai_extracted").eq("job_id", jobId);
    const kinds = ((files ?? []) as { kind: string }[]).map((f) => f.kind).sort();
    expect(kinds).toEqual(["foto", "model_3d", "nabidka", "objednavka", "vykres"]);
    const quoteFile = ((files ?? []) as { kind: string; ai_extracted: { documentNumber?: string } | null }[]).find((f) => f.kind === "nabidka");
    expect(quoteFile?.ai_extracted?.documentNumber).toBe("136/026");
    // číslo naší nabídky je k zakázce: další doklad „dle nabídky 136/026" se k ní spáruje
    const { getMatchingCandidates } = await import("@/lib/data/jobs");
    const cand = (await getMatchingCandidates()).jobs.find((j) => j.id === jobId);
    expect(cand?.quoteNumbers).toContain("136/026");
    const vk = ((files ?? []) as { kind: string; title: string; ai_extracted: { quantity: number; title: string } }[]).find((f) => f.kind === "vykres")!;
    expect(vk.ai_extracted).toMatchObject({ quantity: 120, title: "Těleso ventilu" });
    const { data: items } = await db.from("order_items").select("drawing_number, name, quantity").eq("order_id", jobId);
    expect(items).toEqual([{ drawing_number: "F00N603W84", name: "Těleso ventilu", quantity: 120 }]);
    // žádná druhá zakázka z té nabídky
    const { count } = await db.from("job_files").select("id", { count: "exact", head: true }).eq("ai_extracted->>documentNumber", "136/026").neq("job_id", jobId);
    expect(count).toBe(0);
  }, 180_000);
});
