import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { createHmac } from "node:crypto";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BatchApplyState, BatchReviewModel, BatchSortModel, DocExtractSummary } from "@/lib/jobs/capture-batch-types";

/**
 * Dávkové focení proti lokálnímu Supabase (tools/local-supabase) s testovací AI (AI_FAKE_CAPTURE +
 * značky v názvech souborů): roztřídění → vytěžení → kontrola → uložení. Mockuje se jen přihlášení
 * a revalidace Next.js. Spuštění:
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/jobs/capture-batch-service.integration.test.ts
 * Vlastní data mají prefix „E2E-batch-<běh>"; vše se po sobě uklidí (čítače čísel se nevracejí).
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
const STEP = (part: string) => Buffer.from(`ISO-10303-21;\nHEADER;\nFILE_NAME('Part1.stp','2026');\nENDSEC;\nDATA;\n#5=PRODUCT('${part}','Díl','',(#2));\nENDSEC;\nEND-ISO-10303-21;\n`);

async function pdf(pages: number): Promise<Buffer> {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([300, 400 + i]);
  return Buffer.from(await d.save());
}

function jwt(sub: string, secret: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ sub, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 });
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

describe.skipIf(!ENABLED)("Dávkové focení ↔ lokální Supabase", () => {
  let db: SupabaseClient;
  let env: Record<string, string>;
  let s: Service;
  let b: Batch;
  let admin: ReturnType<typeof person>;
  let sales: ReturnType<typeof person>;
  let worker: ReturnType<typeof person>;
  const RUN = Date.now().toString(36);
  const TAG = `E2E-batch-${RUN}`;
  const startedAt = new Date(Date.now() - 1000).toISOString();
  const jobIds = new Set<string>();
  const captureIds = new Set<string>();

  async function upload(filename: string, body: Buffer, mimeType: string, master?: Buffer) {
    const prep = await s.prepareCaptureUpload({ filename, size: body.length, mimeType, ...(master ? { master: { size: master.length, mimeType } } : {}) });
    expect(prep.ok, prep.ok ? "" : prep.error).toBe(true);
    if (!prep.ok) throw new Error(prep.error);
    const { error } = await db.storage.from("job-files").uploadToSignedUrl(prep.path!, prep.token!, body, { contentType: mimeType });
    expect(error).toBeNull();
    if (master) {
      // master fotky v plném rozlišení (capture/<uživatel>/<uuid>.hires) — v relaci se nic neposílá navíc
      expect(prep.masterPath).toMatch(/\.hires$/);
      const m = await db.storage.from("job-files").uploadToSignedUrl(prep.masterPath!, prep.masterToken!, master, { contentType: mimeType });
      expect(m.error).toBeNull();
      hires.set(prep.path!, prep.masterPath!);
    }
    return { path: prep.path!, filename, mimeType, size: body.length };
  }
  /** stránka → její master (jen kde test master nahrál) */
  const hires = new Map<string, string>();
  async function stored(p: string): Promise<boolean> {
    const dir = p.slice(0, p.lastIndexOf("/"));
    const { data } = await db.storage.from("job-files").list(dir, { search: p.slice(p.lastIndexOf("/") + 1) });
    return (data ?? []).some((o) => o.name === p.slice(p.lastIndexOf("/") + 1));
  }

  async function analyze(files: Awaited<ReturnType<typeof upload>>[], jobId?: string): Promise<BatchSortModel> {
    const res = await s.analyzeCapture({ files, ...(jobId ? { jobId } : {}) });
    if (!res.ok || !("batch" in res)) throw new Error(`Čekám dávku: ${JSON.stringify(res).slice(0, 400)}`);
    captureIds.add(res.batch.captureId);
    return res.batch;
  }

  async function extractAll(batch: BatchSortModel): Promise<DocExtractSummary[]> {
    const out: DocExtractSummary[] = [];
    for (const d of batch.sort.docs.filter((x) => !x.excluded)) {
      const r = await b.captureBatchExtract({ captureId: batch.captureId, docId: d.id, type: d.type, pageIds: d.pageIds });
      if (!r.ok) throw new Error(r.error);
      out.push(r.summary);
    }
    return out;
  }

  async function review(batch: BatchSortModel, extra: Record<string, unknown> = {}): Promise<BatchReviewModel> {
    const r = await b.captureBatchReview({ captureId: batch.captureId, sort: batch.sort, ...extra });
    if (!r.ok) throw new Error(r.error);
    for (const g of r.review.groups) for (const t of g.model.targets) if (t.jobId) jobIds.add(t.jobId);
    return r.review;
  }

  async function apply(captureId: string, state: BatchApplyState) {
    const r = await b.captureBatchApply({ captureId, state });
    for (const g of r.groups) if (g.jobId) jobIds.add(g.jobId);
    return r;
  }

  const saveAgain = (state: BatchApplyState) => {
    for (const d of Object.values(state.docs)) if (d.kind !== "file" && d.state.onDuplicate) d.state.onDuplicate = "version";
  };

  const files = async (jobId: string) => {
    const { data } = await db.from("job_files").select("id, kind, title, filename, storage_path, ai_extracted, order_item_id, drawing_id, capture_id, content_sha256, note, anon_source_path").eq("job_id", jobId);
    return (data ?? []) as Record<string, unknown>[];
  };

  beforeAll(async () => {
    env = loadEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    process.env.AI_FAKE_CAPTURE = path.join(FIXTURES, "objednavka-strojmetal.json");
    db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
    const { data: profiles } = await db.from("profiles").select("id, email, full_name, role");
    const by = (email: string) => (profiles ?? []).find((p) => p.email === email)!;
    admin = person(by("admin@local.test").id, "admin@local.test", "super_admin", "Admin");
    sales = person(by("obchod@local.test").id, "obchod@local.test", "obchodnik", "Obchod");
    worker = person(by("dilna@local.test").id, "dilna@local.test", "zamestnanec", "Dílna");
    s = await import("./capture-service");
    b = await import("./capture-batch-service");
  }, 30_000);

  afterAll(async () => {
    const ids = [...jobIds].filter((id) => id !== STROJMETAL);
    const { data: own } = await db.from("orders").select("id").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).gte("created_at", startedAt);
    const created = ((own ?? []) as { id: string }[]).map((r) => r.id);
    if (created.length) {
      const { data: f } = await db.from("job_files").select("storage_path, anon_source_path").in("job_id", created);
      const paths = ((f ?? []) as { storage_path: string; anon_source_path: string | null }[]).flatMap((x) => [x.storage_path, ...(x.anon_source_path ? [x.anon_source_path] : [])]);
      for (let i = 0; i < paths.length; i += 100) await db.storage.from("job-files").remove(paths.slice(i, i + 100));
      await db.from("drawings").delete().in("job_id", created);
      await db.from("orders").delete().in("id", created);
    }
    await db.from("drawings").delete().in("drawing_number", ["4711-02", "4711-03", "9999-77"]).gte("created_at", startedAt);
    await db.from("customers").delete().in("ico", ["27654320", "27654321"]).gte("created_at", startedAt);
    await db.from("customers").delete().like("name", `${TAG}%`);
    await db.from("orders").delete().like("number", `${TAG}%`);
    // záznamy auditu o smazání vlastních testovacích řádků (20k zákazníků, 5k zakázek) — audit nezaplevelit
    for (const [entity, col] of [["customers", "name"], ["orders", "number"]] as const) {
      for (let i = 0; i < 30; i++) {
        const { data } = await db.from("audit_log").select("id").eq("entity", entity).like(`diff->row->>${col}`, `${TAG}%`).limit(1000);
        const ids = ((data ?? []) as { id: number }[]).map((r) => r.id);
        if (!ids.length) break;
        await db.from("audit_log").delete().in("id", ids);
      }
    }
    for (const id of captureIds) {
      const { data } = await db.from("capture_sessions").select("data").eq("id", id).maybeSingle();
      const fs = ((data as { data?: { files?: { path: string; sortPath?: string }[] } } | null)?.data?.files ?? []);
      await db.storage.from("job-files").remove(fs.flatMap((x) => [x.path, ...(x.sortPath ? [x.sortPath] : [])]));
      await db.from("capture_sessions").delete().eq("id", id);
    }
    await db.from("ai_training_examples").delete().gte("created_at", startedAt).in("kind", ["capture", "capture_drawing", "capture_sort"]).in("created_by", [admin.id, sales.id, worker.id]);
    await db.from("ai_corrections").delete().gte("created_at", startedAt).eq("agent_key", "capture");
  }, 120_000);

  it("plná dávka: objednávka (2 fotky), výkres, STEP, nabídka dodavatele, PDF s DL a fakturou → 1 zakázka", async () => {
    h.user = admin;
    const up = [
      await upload(`${TAG}__objednavka_zakaznik-s1.png`, png(1), "image/png", png(101)),
      await upload(`${TAG}__objednavka_zakaznik-s2.png`, png(2), "image/png"),
      await upload(`${TAG}__vykres.png`, png(3), "image/png", png(103)),
      await upload("4711-02_rev_B.step", STEP("4711-02"), "application/octet-stream"),
      await upload(`${TAG}__nabidka_dodavatel.png`, png(4), "image/png"),
      await upload(`${TAG}__sada-dl-faktura.pdf`, await pdf(2), "application/pdf"),
    ];
    const batch = await analyze(up);
    expect(batch.skipSort).toBe(false);
    const active = batch.sort.docs.filter((d) => !d.excluded);
    expect(active.map((d) => d.type).sort()).toEqual(["dodaci_list_my", "faktura_my", "model_3d", "nabidka_dodavatel", "objednavka_zakaznik", "vykres"]);
    expect(active.find((d) => d.type === "objednavka_zakaznik")!.pageIds).toHaveLength(2);
    expect(active.find((d) => d.type === "dodaci_list_my")!.flags).toContain("signed");
    expect(batch.previews.every((p) => p.url?.startsWith("http"))).toBe(true);

    const sums = await extractAll(batch);
    expect(sums.every((x) => x.status === "ready")).toBe(true);
    // idempotentní: druhé volání vrátí uložené
    const again = await b.captureBatchExtract({ captureId: batch.captureId, docId: active[0].id, type: active[0].type, pageIds: active[0].pageIds });
    expect(again.ok && again.summary.status).toBe("ready");

    const rv = await review(batch);
    expect(rv.groups).toHaveLength(1);
    const g = rv.groups[0];
    expect(rv.initial.groups[0].job.targetKey).toBe("new");
    expect(rv.initial.groups[0].job.stage).toBe("fakturovano");
    expect(rv.initial.groups[0].job.items).toHaveLength(2);
    expect(rv.warnings.some((w) => w.code === "revision_conflict")).toBe(true);
    const drawingId = active.find((d) => d.type === "vykres")!.id;
    const dst = rv.initial.docs[drawingId];
    expect(dst.kind === "drawing" && dst.state.link).toEqual({ mode: "docItem", itemKey: "ai-0" });
    const dlId = active.find((d) => d.type === "dodaci_list_my")!.id;
    const dls = rv.initial.docs[dlId];
    expect(dls.kind === "business" && dls.state.confirmDelivered).toBe(true);
    expect(g.model.customerMatch?.id).toBe(STROJMETAL);

    const res = await apply(batch.captureId, rv.initial);
    expect(res.status, JSON.stringify({ failed: res.docs.filter((d) => !d.ok), pending: res.pending, error: res.error })).toBe("done");
    expect(res.docs.filter((d) => d.ok && !d.skipped)).toHaveLength(6);
    const jobId = res.groups[0].jobId!;
    expect(res.groups[0].created).toBe(true);

    const { count } = await db.from("order_items").select("id", { count: "exact", head: true }).eq("order_id", jobId);
    expect(count).toBe(2);
    const jf = await files(jobId);
    expect(jf.map((f) => f.kind).sort()).toEqual(["dodaci_list", "faktura", "model_3d", "naceneni", "objednavka", "vykres"]);
    const orderFile = jf.find((f) => f.kind === "objednavka")!;
    expect(String(orderFile.filename)).toMatch(/\.pdf$/); // 2 fotky → 1 PDF
    const dl = jf.find((f) => f.kind === "dodaci_list")!;
    const inv = jf.find((f) => f.kind === "faktura")!;
    expect(dl.storage_path).not.toBe(inv.storage_path); // PDF rozdělené na 2 soubory
    const model = jf.find((f) => f.kind === "model_3d")!;
    expect((model.ai_extracted as Record<string, unknown>).format).toBe("STEP");
    const drawingFile = jf.find((f) => f.kind === "vykres")!;
    expect(drawingFile.order_item_id).toBeTruthy();
    // výkres z fotky: master přesunutý k dokumentu (zdroj anonymizace v plném rozlišení)
    const { jobMasterPath } = await import("./mapping");
    expect(drawingFile.anon_source_path).toBe(jobMasterPath(String(drawingFile.storage_path)));
    expect(await stored(String(drawingFile.anon_source_path))).toBe(true);
    expect(await stored(hires.get(up[2].path)!)).toBe(false);
    // 2 fotky objednávky → 1 PDF: master se nepoužije a s relací zmizí
    expect(orderFile.anon_source_path).toBeNull();
    expect(model.order_item_id).toBe(drawingFile.order_item_id);
    expect(jf.every((f) => f.capture_id === batch.captureId)).toBe(true);
    const { data: dr } = await db.from("drawings").select("*").eq("drawing_number", "4711-02").eq("revision", "B").maybeSingle();
    expect(dr).toMatchObject({ storage_bucket: "job-files", job_id: jobId, customer_id: STROJMETAL, job_file_id: drawingFile.id });
    expect(model.drawing_id).toBe((dr as { id: string }).id);
    const { data: sq } = await db.from("supplier_quotes").select("*, items:supplier_quote_items!supplier_quote_id(*)").eq("job_id", jobId);
    expect(sq).toHaveLength(1);
    expect(sq![0]).toMatchObject({ source: "foto", capture_id: batch.captureId, selected: true, number: "NAB-552" });
    expect(sq![0].items).toHaveLength(2);
    expect(sq![0].file_id).toBe(jf.find((f) => f.kind === "naceneni")!.id);
    const { data: job } = await db.from("orders").select("status, invoice_number, delivery_note_number, delivery_note_confirmed_at, customer_id, capture_key").eq("id", jobId).single();
    expect(job).toMatchObject({ status: "fakturovano", invoice_number: "FV-E2E-1", delivery_note_number: "DL-E2E-1", customer_id: STROJMETAL, capture_key: `${batch.captureId}:${g.key}` });
    expect(job!.delivery_note_confirmed_at).toBeTruthy();
    const { data: ev } = await db.from("job_events").select("type, message, actor_id, data").eq("job_id", jobId);
    expect((ev ?? []).every((e) => e.actor_id === admin.id)).toBe(true);
    expect((ev ?? []).some((e) => /AI roztřídila vyfocenou dávku 6 dokladů/.test(e.message))).toBe(true);
    const { data: tr } = await db.from("ai_training_examples").select("kind").eq("created_by", admin.id).gte("created_at", startedAt);
    const kinds = ((tr ?? []) as { kind: string }[]).map((x) => x.kind);
    expect(kinds.filter((k) => k === "capture").length).toBeGreaterThanOrEqual(4);
    expect(kinds).toContain("capture_drawing");
    expect(kinds).toContain("capture_sort");
    // relace hotová, zbylé soubory pryč
    const { data: sess } = await db.from("capture_sessions").select("status").eq("id", batch.captureId).single();
    expect(sess!.status).toBe("done");
    expect(await stored(hires.get(up[0].path)!)).toBe(false);

    // idempotence: opakované uložení nic nezdvojí
    const twice = await apply(batch.captureId, rv.initial);
    expect(twice.status).toBe("done");
    expect((await files(jobId)).length).toBe(6);
    const { count: c2 } = await db.from("order_items").select("id", { count: "exact", head: true }).eq("order_id", jobId);
    expect(c2).toBe(2);
    const { count: q2 } = await db.from("supplier_quotes").select("id", { count: "exact", head: true }).eq("job_id", jobId);
    expect(q2).toBe(1);

    // pád po „started": doklad se zopakuje idempotentně
    const nabId = active.find((d) => d.type === "nabidka_dodavatel")!.id;
    await db.from("capture_apply_steps").update({ status: "started" }).eq("capture_id", batch.captureId).eq("step", `doc:${nabId}`);
    await db.from("capture_sessions").update({ status: "partial" }).eq("id", batch.captureId);
    const third = await apply(batch.captureId, rv.initial);
    expect(third.status, JSON.stringify(third).slice(0, 500)).toBe("done");
    expect((await files(jobId)).length).toBe(6);
    const { count: q3 } = await db.from("supplier_quotes").select("id", { count: "exact", head: true }).eq("job_id", jobId);
    expect(q3).toBe(1);
  }, 120_000);

  it("dvě objednávky různých zákazníků → 2 zakázky, nový zákazník založen", async () => {
    h.user = admin;
    const batch = await analyze([
      await upload(`${TAG}__objednavka_zakaznik.png`, png(10), "image/png"),
      await upload(`${TAG}__objednavka_zakaznik-g2.png`, png(11), "image/png"),
    ]);
    await extractAll(batch);
    const rv = await review(batch);
    expect(rv.groups).toHaveLength(2);
    const res = await apply(batch.captureId, rv.initial);
    expect(res.status, JSON.stringify(res).slice(0, 500)).toBe("done");
    const ids = res.groups.map((g) => g.jobId!);
    const { data } = await db.from("orders").select("id, customer:customers!customer_id(name, ico)").in("id", ids);
    const icos = ((data ?? []) as unknown as { customer: { ico: string } }[]).map((r) => r.customer.ico).sort();
    expect(icos).toEqual(["27654320", "45274649"]);
    expect(res.groups.find((g) => g.customerName?.startsWith("Kovo"))?.customerCreated).toBe(true);
  }, 120_000);

  it("změna druhu v rámci formuláře (potvrzení → faktura) se nečte znovu — kontrola i uložení použijí přečtené údaje", async () => {
    h.user = admin;
    const batch = await analyze([
      await upload(`${TAG}-chg__objednavka_zakaznik.png`, png(20), "image/png"),
      await upload(`${TAG}-chg__potvrzeni_my.png`, png(21), "image/png"),
    ]);
    await extractAll(batch);
    const doc = batch.sort.docs.find((d) => d.type === "potvrzeni_my")!;
    const sort = { ...batch.sort, docs: batch.sort.docs.map((d) => (d.id === doc.id ? { ...d, type: "faktura_my" as const } : d)) };
    const r = await b.captureBatchReview({ captureId: batch.captureId, sort });
    if (!r.ok) throw new Error(r.error);
    for (const g of r.review.groups) for (const t of g.model.targets) if (t.jobId) jobIds.add(t.jobId);
    const rd = r.review.docs.find((d) => d.docId === doc.id)!;
    expect(rd.kind === "business" && rd.type).toBe("faktura_my");
    expect(rd.kind === "business" && rd.aiUsed).toBe(true);
    const st = r.review.initial.docs[doc.id];
    expect(st.kind === "business" && st.state.type).toBe("faktura_my");
    expect(st.kind === "business" && st.state.documentNumber).toBe("PT-E2E-1");
    const res = await apply(batch.captureId, { ...r.review.initial, sort });
    expect(res.status, JSON.stringify(res).slice(0, 500)).toBe("done");
    const jf = await files(res.groups[0].jobId!);
    const inv = jf.find((f) => f.kind === "faktura");
    expect(inv?.ai_extracted && (inv.ai_extracted as Record<string, unknown>).docKind).toBe("faktura");
  }, 120_000);

  it("odebraná stránka před čtením: smaže se i její náhled roztřídění", async () => {
    h.user = admin;
    const body = png(30);
    const prep = await s.prepareCaptureUpload({ filename: `${TAG}-drop.png`, size: body.length, mimeType: "image/png", sortPreview: true, master: { size: body.length, mimeType: "image/png" } });
    if (!prep.ok) throw new Error(prep.error);
    expect(prep.sortPath).toMatch(/\.sort\.jpg$/);
    expect(prep.masterPath).toMatch(/\.hires$/);
    await db.storage.from("job-files").uploadToSignedUrl(prep.path!, prep.token!, body, { contentType: "image/png" });
    await db.storage.from("job-files").uploadToSignedUrl(prep.sortPath!, prep.sortToken!, body, { contentType: "image/jpeg" });
    await db.storage.from("job-files").uploadToSignedUrl(prep.masterPath!, prep.masterToken!, body, { contentType: "image/png" });
    const res = await s.discardCapture({ paths: [prep.path!] });
    expect(res.ok).toBe(true);
    const folder = prep.path!.slice(0, prep.path!.lastIndexOf("/"));
    const { data } = await db.storage.from("job-files").list(folder, { limit: 1000 });
    const names = (data ?? []).map((o) => `${folder}/${o.name}`);
    expect(names).not.toContain(prep.path);
    expect(names).not.toContain(prep.sortPath);
    expect(names).not.toContain(prep.masterPath);
  }, 60_000);

  it("částečné selhání → ostatní uloženy, zavření přiloží neuložené jako Ostatní", async () => {
    h.user = admin;
    const batch = await analyze([
      await upload(`${TAG}__objednavka_zakaznik.png`, png(20), "image/png"),
      await upload(`${TAG}__vykres.png`, png(21), "image/png"),
    ]);
    await extractAll(batch);
    const rv = await review(batch);
    const state = structuredClone(rv.initial);
    // stejné doklady jako v 1. testu → „Uložit jako novou verzi" (výchozí by bylo „Neukládat znovu")
    expect(rv.warnings.some((w) => w.code === "already_saved")).toBe(true);
    saveAgain(state);
    const vid = state.sort.docs.find((d) => d.type === "vykres")!.id;
    const v = state.docs[vid];
    if (v.kind === "drawing") v.state.link = { mode: "item", itemId: "99999999-9999-4999-8999-999999999999" };
    const res = await apply(batch.captureId, state);
    expect(res.status, JSON.stringify(res).slice(0, 1500)).toBe("partial");
    expect(res.pending).toEqual([vid]);
    expect(res.docs.find((d) => d.docId === vid)?.error).toMatch(/položka/i);
    const jobId = res.groups[0].jobId!;
    // zavření → neuložený výkres k zakázce jako „Ostatní"
    const d = await s.discardCapture({ captureId: batch.captureId });
    expect(d.ok).toBe(true);
    const jf = await files(jobId);
    const att = jf.find((f) => f.kind === "ostatni");
    expect(att?.note).toBe("Neuloženo z focení — zkontroluj");
    // nic se neztratilo, relace pryč
    const { data: sess } = await db.from("capture_sessions").select("status").eq("id", batch.captureId).maybeSingle();
    expect(sess?.status ?? "smazána").not.toBe("partial");
  }, 120_000);

  it("po částečném uložení: přeskupení uložené zakázky se odmítne, oprava zbytku se douloží", async () => {
    h.user = admin;
    const batch = await analyze([
      await upload(`${TAG}__objednavka_zakaznik.png`, png(30), "image/png"),
      await upload(`${TAG}__vykres.png`, png(31), "image/png"),
    ]);
    await extractAll(batch);
    const rv = await review(batch);
    const state = structuredClone(rv.initial);
    saveAgain(state);
    const vid = state.sort.docs.find((d) => d.type === "vykres")!.id;
    const v = state.docs[vid];
    const goodLink = v.kind === "drawing" ? v.state.link : null;
    if (v.kind === "drawing") v.state.link = { mode: "item", itemId: "99999999-9999-4999-8999-999999999999" };
    const first = await apply(batch.captureId, state);
    expect(first.status, JSON.stringify(first).slice(0, 800)).toBe("partial");
    const jobId = first.groups[0].jobId!;
    // relace hned „partial" (přerušené ukládání se neuklidí jako neuložené)
    const { data: sess } = await db.from("capture_sessions").select("status").eq("id", batch.captureId).single();
    expect(sess!.status).toBe("partial");

    // výkres přesunutý do nové skupiny: klíč g1 (uložená zakázka) by dostal jiné doklady → odmítnout
    const regrouped = structuredClone(state);
    const g1 = regrouped.groups[0];
    regrouped.groups = [{ ...g1, docIds: g1.docIds.filter((id) => id !== vid) }, { ...structuredClone(g1), key: "g9", docIds: [vid], job: { ...g1.job, targetKey: "new" } }];
    const bad = await apply(batch.captureId, regrouped);
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/už uložená/);
    const { count: jobsWithKey } = await db.from("orders").select("id", { count: "exact", head: true }).eq("capture_key", `${batch.captureId}:g9`);
    expect(jobsWithKey).toBe(0);

    // stejné skupiny, opravená vazba výkresu → doloží se jen výkres
    const fixed = structuredClone(state);
    const fv = fixed.docs[vid];
    if (fv.kind === "drawing" && goodLink) fv.state.link = goodLink.mode === "docItem" ? { mode: "add" } : goodLink;
    const second = await apply(batch.captureId, fixed);
    expect(second.status, JSON.stringify(second).slice(0, 800)).toBe("done");
    const jf = (await files(jobId)).filter((f) => f.capture_id === batch.captureId);
    expect(jf.filter((f) => f.kind === "vykres")).toHaveLength(1);
    expect(jf.filter((f) => f.kind === "objednavka")).toHaveLength(1);
    // výkres má vlastní událost s autorem (položka / archiv)
    const { data: ev } = await db.from("job_events").select("message, actor_id, data").eq("job_id", jobId);
    expect((ev ?? []).some((e) => /^Výkres .*přiložen z focení/.test(e.message) && e.actor_id === admin.id)).toBe(true);
  }, 120_000);

  it("úklid starého toku (24 h) nesmí smazat soubory otevřené / částečné dávky", async () => {
    h.user = admin;
    const batch = await analyze([
      await upload(`${TAG}__objednavka_zakaznik.png`, png(40), "image/png"),
      await upload(`${TAG}__vykres.png`, png(41), "image/png", png(141)),
    ]);
    const store = await import("./capture-store");
    const live = await store.liveSessionPaths(db as never, admin.id);
    for (const f of batch.files) expect(live.has(f.path)).toBe(true);
    // master otevřené dávky se úklidem také nesmaže
    const vk = batch.files.find((f) => f.filename.endsWith("__vykres.png"))!;
    expect(live.has(hires.get(vk.path)!)).toBe(true);
    await db.from("capture_sessions").update({ status: "partial" }).eq("id", batch.captureId);
    const live2 = await store.liveSessionPaths(db as never, admin.id);
    expect(live2.has(batch.files[0].path)).toBe(true);
    await s.discardCapture({ captureId: batch.captureId });
    const live3 = await store.liveSessionPaths(db as never, admin.id);
    expect(live3.has(batch.files[0].path)).toBe(false);
  }, 60_000);

  it("bez práva na marže: nabídka dodavatele bez cen, bez supplier_quotes, Nákup ji pak zapíše", async () => {
    h.user = worker;
    h.aiForAll = true;
    try {
      const { data: j } = await db.from("orders").insert({ number: `${TAG}-NAK`, title: `${TAG} nákup`, status: "naceneni", customer_id: STROJMETAL } as never).select("id").single();
      const jobId = (j as { id: string }).id;
      jobIds.add(jobId);
      const batch = await analyze([await upload(`${TAG}__nabidka_dodavatel.png`, png(30), "image/png")]);
      expect(batch.skipSort).toBe(true);
      expect(batch.margins).toBe(false);
      await extractAll(batch);
      const rv = await review(batch, { targets: {} });
      expect(rv.initial.groups[0].job.targetKey).toBe("");
      expect(rv.warnings.some((w) => w.code === "target_required" && w.severity === "block")).toBe(true);
      const rv2 = await review(batch, { targets: { [rv.groups[0].key]: jobId } });
      const json = JSON.stringify(rv2);
      expect(json).not.toMatch(/1450|45400|45 400/);
      expect(rv2.initial.groups[0].job.targetKey).toBe(jobId);
      const st2 = structuredClone(rv2.initial);
      saveAgain(st2);
      const res = await apply(batch.captureId, st2);
      expect(res.status, JSON.stringify(res).slice(0, 500)).toBe("done");
      expect(res.docs[0].purchasingPending, JSON.stringify(res).slice(0, 1500)).toBe(true);
      expect(JSON.stringify(res)).not.toMatch(/1450|45400/);
      const { count } = await db.from("supplier_quotes").select("id", { count: "exact", head: true }).eq("job_id", jobId);
      expect(count).toBe(0);
      const jf = await files(jobId);
      const f = jf.find((x) => x.kind === "naceneni")!;
      expect((f.ai_extracted as Record<string, unknown>).purchasingPending).toBe(true);
      const { data: ev } = await db.from("job_events").select("message, data").eq("job_id", jobId);
      expect(JSON.stringify(ev)).not.toMatch(/1450|45400|45 400/);
      expect((ev ?? []).some((e) => /čeká na zapsání do Nákupu/.test(e.message))).toBe(true);
      // obchodník / admin v Nákupu „Zapsat"
      h.user = admin;
      const p = await import("@/app/actions/purchasing");
      const imp = await p.importCapturedSupplierQuote(f.id as string);
      expect(imp.ok, imp.ok ? "" : imp.error).toBe(true);
      const { data: sq } = await db.from("supplier_quotes").select("source, file_id, number, items:supplier_quote_items!supplier_quote_id(unit_price)").eq("job_id", jobId);
      expect(sq).toHaveLength(1);
      expect(sq![0]).toMatchObject({ source: "foto", file_id: f.id, number: "NAB-552" });
      expect((sq![0].items as { unit_price: number }[]).map((i) => Number(i.unit_price)).sort()).toEqual([1450, 410].sort());
      const { data: after } = await db.from("job_files").select("ai_extracted").eq("id", f.id).single();
      expect((after!.ai_extracted as Record<string, unknown>).purchasingPending).toBeUndefined();
      expect((await p.importCapturedSupplierQuote(f.id as string)).ok).toBe(false);
    } finally {
      h.aiForAll = false;
    }
  }, 120_000);

  it("cizí relace a stránky jsou odmítnuty", async () => {
    h.user = admin;
    const batch = await analyze([
      await upload(`${TAG}__faktura_my.png`, png(40), "image/png"),
      await upload("4711-03.dxf", Buffer.from("  0\nSECTION\n  2\nHEADER\n"), "application/octet-stream"),
    ]);
    const d = batch.sort.docs[0];
    expect(batch.sort.docs.map((x) => x.type)).toEqual(["faktura_my", "vykres"]);
    expect(await b.captureBatchExtract({ captureId: batch.captureId, docId: d.id, type: d.type, pageIds: ["p77"] })).toMatchObject({ ok: false, error: "Stránka nepatří k této dávce." });
    h.user = sales;
    expect(await b.captureBatchExtract({ captureId: batch.captureId, docId: d.id, type: d.type, pageIds: d.pageIds })).toMatchObject({ ok: false });
    expect(await b.captureBatchReview({ captureId: batch.captureId, sort: batch.sort })).toMatchObject({ ok: false });
    expect(await b.captureBatchApply({ captureId: batch.captureId, state: {} })).toMatchObject({ ok: false, status: "failed" });
    expect(await b.captureBatchSession({ captureId: batch.captureId })).toMatchObject({ ok: false });
    h.user = admin;
    const back = await b.captureBatchSession({ captureId: batch.captureId });
    expect(back.ok && back.batch.sort.docs.length).toBe(2);
    expect((await s.discardCapture({ captureId: batch.captureId })).ok).toBe(true);
    const { data: gone } = await db.from("capture_sessions").select("id").eq("id", batch.captureId).maybeSingle();
    expect(gone).toBeNull();
  }, 60_000);

  it("politiky Storage: cizí capture/ nejde číst ani zapsat, vlastní .json nejde přepsat, podepsané nahrání funguje", async () => {
    const anonSales = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${jwt(sales.id, env.SUPABASE_JWT_SECRET)}` } },
    });
    const adminPath = `capture/${admin.id}/${crypto.randomUUID()}-tajne.png`;
    await db.storage.from("job-files").upload(adminPath, png(50), { contentType: "image/png" });
    const read = await anonSales.storage.from("job-files").download(adminPath);
    expect(read.data).toBeNull();
    const write = await anonSales.storage.from("job-files").upload(`capture/${admin.id}/${crypto.randomUUID()}-x.png`, png(51), { contentType: "image/png" });
    expect(write.error).not.toBeNull();
    const ownJson = `capture/${sales.id}/${crypto.randomUUID()}.json`;
    await db.storage.from("job-files").upload(ownJson, Buffer.from("{}"), { contentType: "application/json" });
    const over = await anonSales.storage.from("job-files").upload(ownJson, Buffer.from("{\"hack\":1}"), { upsert: true, contentType: "application/json" });
    expect(over.error).not.toBeNull();
    const { data: still } = await db.storage.from("job-files").download(ownJson);
    expect(await (still as Blob).text()).toBe("{}");
    // podepsaná URL ze serveru funguje i z prohlížeče
    h.user = sales;
    const prep = await s.prepareCaptureUpload({ filename: "x.png", size: 70, mimeType: "image/png" });
    expect(prep.ok).toBe(true);
    if (prep.ok) {
      const up = await anonSales.storage.from("job-files").uploadToSignedUrl(prep.path!, prep.token!, png(52), { contentType: "image/png" });
      expect(up.error).toBeNull();
      await db.storage.from("job-files").remove([prep.path!]);
    }
    await db.storage.from("job-files").remove([adminPath, ownJson]);
  }, 60_000);

  it("jeden doklad dál dnešním tokem; jediná nabídka dodavatele jde dávkou bez roztřídění", async () => {
    h.user = admin;
    const one = await s.analyzeCapture({ files: [await upload("doklad.png", png(60), "image/png")] });
    expect(one.ok && "model" in one).toBe(true);
    if (one.ok && "model" in one) await s.discardCapture({ captureId: one.model.captureId, paths: one.model.previews.map((p) => p.path) });
    const two = await s.analyzeCapture({ files: [await upload("str1.png", png(61), "image/png"), await upload("str2.png", png(62), "image/png")] });
    expect(two.ok && "model" in two).toBe(true);
    if (two.ok && "model" in two) await s.discardCapture({ captureId: two.model.captureId, paths: two.model.previews.map((p) => p.path) });
  }, 60_000);

  it("velikost kontroly se 5k zakázkami a 20k zákazníky < 1,5 MB", async () => {
    h.user = admin;
    const customers = Array.from({ length: 20_000 }, (_, i) => ({ name: `${TAG}-C${i}`, ico: String(80_000_000 + i) }));
    for (let i = 0; i < customers.length; i += 2000) {
      const { error } = await db.from("customers").insert(customers.slice(i, i + 2000) as never);
      expect(error).toBeNull();
    }
    const jobs = Array.from({ length: 5000 }, (_, i) => ({ number: `${TAG}-J${i}`, title: `Zakázka ${i}`, status: "poptavka", customer_id: STROJMETAL }));
    for (let i = 0; i < jobs.length; i += 1000) {
      const { error } = await db.from("orders").insert(jobs.slice(i, i + 1000) as never);
      expect(error).toBeNull();
    }
    const batch = await analyze([
      await upload(`${TAG}__objednavka_zakaznik.png`, png(70), "image/png"),
      await upload("9999-77.step", STEP("9999-77"), "application/octet-stream"),
    ]);
    await extractAll(batch);
    const rv = await review(batch);
    const size = Buffer.byteLength(JSON.stringify({ ok: true, review: rv }));
    expect(size).toBeLessThan(1.5 * 1024 * 1024);
    expect(rv.options.jobs.length).toBeLessThanOrEqual(300);
    await s.discardCapture({ captureId: batch.captureId });
  }, 300_000);
});
