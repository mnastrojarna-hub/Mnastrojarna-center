import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_ENABLED, DEMO, loadLocalEnv, localAdmin, profileId } from "@/test/local-supabase";
import { userActor } from "@/lib/supabase/actor-headers";

/**
 * Anonymizace — datová vrstva UI ↔ lokální Supabase:
 *  - JOB_FILE_SELECT nese anon_* (bez anon_ai_cache) → JobFile.anon pro odznak a menu,
 *  - registerJobFileCore: anonStatus „skipped" (s autorem) a anonSourcePath (master fotky) jen ze serveru,
 *  - lib/data/anonymize: odznaky po zakázkách, seznam „Ke kontrole" s číslem zakázky podle rozsahu,
 *    počet pro Dashboard, čekající výkresy (hromadná akce), stav archivu, data karty Nastavení,
 *  - routa fronty odeslání (jen čtení, počty a příjemci).
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/anonymize/ui-data.integration.test.ts
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
const who = vi.hoisted(() => ({ id: "", role: "super_admin" as string, margins: true }));
vi.mock("@/lib/supabase/server", async () => {
  const sb = await import("@supabase/supabase-js");
  const { loadLocalEnv: env } = await import("@/test/local-supabase");
  const headers = await import("@/lib/supabase/actor-headers");
  const e = env();
  const admin = (opts: { actor?: unknown } = {}) => sb.createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: headers.actorHeaders((opts.actor ?? headers.SYSTEM_ACTOR) as never) },
  });
  return {
    isSupabaseConfigured: () => true,
    hasServiceKey: () => true,
    createAdminClient: admin,
    createOperatorClient: async (opts: { actor?: unknown } = {}) => admin(opts),
    createClient: async () => { throw new Error("Bez session (test)."); },
  };
});
vi.mock("@/lib/auth/session", () => {
  const access = () => ({
    user: { id: who.id, role: who.role, active: true, email: "x@local.test", full_name: "Test" },
    can: (f: string) => f !== "margins" || who.role === "super_admin" || who.margins,
    features: ["orders", "settings", "drawings"],
  });
  return {
    getAccess: async () => access(),
    checkFeature: async () => ({ user: access().user }),
    apiRequire: async () => ({ user: access().user }),
    requireFeature: async () => access().user,
  };
});

const STAMP = Date.now().toString(36);

describe.skipIf(!LOCAL_ENABLED)("anonymizace — data UI ↔ lokální Supabase", () => {
  let svc: SupabaseClient;
  let adminId = "";
  let salesId = "";
  const jobs: string[] = [];
  const paths: string[] = [];

  async function newJob(n: number): Promise<string> {
    const { data, error } = await svc.from("orders").insert({ number: `Z-E2E-ANONUI-${STAMP}-${n}`, title: "E2E anon UI", source: "manual", status: "poptavka" }).select("id").single();
    if (error) throw new Error(error.message);
    jobs.push((data as { id: string }).id);
    return (data as { id: string }).id;
  }

  async function upload(jobId: string, name: string): Promise<string> {
    const p = `zakazky/${jobId}/${randomUUID()}-${name}`;
    const up = await svc.storage.from("job-files").upload(p, new Uint8Array([37, 80, 68, 70]), { contentType: "application/pdf" });
    if (up.error) throw new Error(up.error.message);
    paths.push(p);
    return p;
  }

  beforeAll(async () => {
    const env = loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    svc = localAdmin();
    adminId = await profileId(svc, DEMO.admin.email);
    salesId = await profileId(svc, DEMO.sales.email);
    who.id = adminId;
  });

  afterAll(async () => {
    if (jobs.length) {
      await svc.from("anon_send_queue").delete().in("job_id", jobs);
      await svc.from("job_files").delete().in("job_id", jobs);
      await svc.from("orders").delete().in("id", jobs);
    }
    if (paths.length) await svc.storage.from("job-files").remove(paths);
  });

  it("registerJobFileCore: skipped s autorem + master fotky (strážce REST hlídá jádrový test)", async () => {
    const { registerJobFileCore } = await import("@/lib/jobs/job-files-store");
    const jobId = await newJob(1);
    const db = localAdmin(userActor({ id: salesId }));
    const p1 = await upload(jobId, "12-345.pdf");
    const r1 = await registerJobFileCore(db as never, salesId, { jobId, path: p1, filename: "12-345.pdf", mimeType: "application/pdf", size: 4, origin: "capture", anonStatus: "skipped" });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.file!.anon?.status).toBe("skipped");
    expect(r1.file!.anon?.reason).toMatch(/vypnuta/);
    const { data: row } = await svc.from("job_files").select("anon_status, anon_by, anon_actor_kind, anon_via").eq("id", r1.file!.id).single();
    expect(row).toMatchObject({ anon_status: "skipped", anon_by: salesId, anon_actor_kind: "user", anon_via: "foto" });

    // master fotky (capture/<uživatel>/…) → anon_source_path; bez přepínače trigger zařadí kandidáta (pending)
    const p2 = await upload(jobId, "foto.jpg");
    const master = `capture/${salesId}/hires/${randomUUID()}-foto.jpg`;
    const r2 = await registerJobFileCore(db as never, salesId, { jobId, path: p2, filename: "foto.jpg", mimeType: "image/jpeg", size: 4, origin: "capture", anonSourcePath: master });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    const { data: row2 } = await svc.from("job_files").select("anon_status, anon_source_path").eq("id", r2.file!.id).single();
    expect(row2).toMatchObject({ anon_status: "pending", anon_source_path: master });
    expect(r2.file!.anon?.status).toBe("pending");

    // cizí master / stejná cesta / nesmysl → odmítnuto
    const p3 = await upload(jobId, "b.jpg");
    for (const bad of [`capture/${adminId}/hires/x.jpg`, p3, "../../etc/passwd"]) {
      const r = await registerJobFileCore(db as never, salesId, { jobId, path: p3, filename: "b.jpg", mimeType: "image/jpeg", anonSourcePath: bad });
      expect(r.ok, bad).toBe(false);
    }

  }, 60_000);

  it("JOB_FILE_SELECT → JobFile.anon (souhrn, vyřazené strany) bez anon_ai_cache", async () => {
    const { JOB_FILE_SELECT, rowToJobFile } = await import("@/lib/jobs/mapping");
    expect(JOB_FILE_SELECT).not.toContain("anon_ai_cache");
    const jobId = await newJob(2);
    const p = await upload(jobId, "d.pdf");
    const { data: f } = await svc.from("job_files").insert({ job_id: jobId, kind: "vykres", filename: "d.pdf", mime_type: "application/pdf", storage_path: p, origin: "email" }).select("id").single();
    const id = (f as { id: string }).id;
    await localAdmin(userActor({ id: adminId })).from("job_files").update({
      anon_status: "review", anon_reason: "Bez AI (jen pravidla)", anon_filename: "D-1_B.pdf", anon_at: new Date().toISOString(),
      anon_summary: { counts: { company: 1, person: 2 }, total: 3, warnings: [{ code: "no_ai", message: "Bez AI" }] },
      anon_pages: { total: 3, included: [2, 3], excluded: [{ page: 1, why: "not_drawing" }] },
    }).eq("id", id);
    const { data: row, error } = await svc.from("job_files").select(JOB_FILE_SELECT).eq("id", id).single();
    expect(error).toBeNull();
    const jf = rowToJobFile(row as never);
    expect(jf.anon).toMatchObject({ status: "review", filename: "D-1_B.pdf", reason: "Bez AI (jen pravidla)", counts: { company: 1, person: 2 }, total: 3, excludedPages: [1] });
    expect(jf.anon!.warnings[0]).toEqual({ code: "no_ai", message: "Bez AI" });
  }, 30_000);

  it("lib/data/anonymize: odznaky, Ke kontrole (rozsah), počet, čekající, archiv, Nastavení", async () => {
    const d = await import("@/lib/data/anonymize");
    const a = await newJob(3);
    const b = await newJob(4);
    const op = localAdmin(userActor({ id: adminId }));
    const mk = async (jobId: string, name: string, status: string) => {
      const p = await upload(jobId, name);
      const { data } = await svc.from("job_files").insert({ job_id: jobId, kind: "vykres", filename: name, mime_type: "application/pdf", storage_path: p, origin: "email" }).select("id").single();
      const id = (data as { id: string }).id;
      await op.from("job_files").update({ anon_status: status, anon_at: new Date().toISOString(), anon_reason: status === "failed" ? "Chyba" : null }).eq("id", id);
      return id;
    };
    const ids = {
      done: await mk(a, "1.pdf", "done"), review: await mk(a, "2.pdf", "review"), pending: await mk(a, "3.pdf", "pending"),
      failed: await mk(b, "4.pdf", "failed"), skipped: await mk(b, "5.pdf", "skipped"),
    };
    await svc.from("anon_send_queue").insert({ kind: "job_document", job_id: a, payload: { to: ["d@x.cz"], subject: "S", body: "B" }, file_ids: [ids.pending, ids.done], status: "waiting", created_by: adminId });

    const badges = await d.getJobAnonBadges([a, b]);
    expect(badges[a]).toMatchObject({ total: 3, done: 1, review: 1, pending: 1, sendWaiting: 1 });
    expect(badges[b]).toMatchObject({ total: 2, failed: 1, skipped: 1 });

    const all = await d.getAnonReviewList({ limit: 200 });
    const mine = all.filter((r) => r.jobId === a || r.jobId === b);
    expect(mine.map((r) => r.id).sort()).toEqual([ids.review, ids.failed].sort());
    expect(mine.find((r) => r.id === ids.review)!.jobNumber).toBe(`Z-E2E-ANONUI-${STAMP}-3`);
    // rozsah „moje" jen se zakázkou b
    const scoped = await d.getAnonReviewList({ scope: { all: false, userId: adminId, jobIds: new Set([b]), error: false } as never });
    expect(scoped.map((r) => r.id)).toEqual([ids.failed]);
    expect(await d.getAnonReviewList({ scope: null })).toEqual([]);

    expect(await d.getAnonReviewCount({ all: false, userId: adminId, jobIds: new Set([a, b]), error: false } as never)).toBe(2);
    expect(await d.getAnonReviewCount()).toBeGreaterThanOrEqual(2);
    // čekající = jen pending (selhané mají vlastní tlačítko), bez starých výkresů (backfill, priorita 9)
    const legacy = await mk(b, "6.pdf", "pending");
    await op.from("job_files").update({ anon_priority: 9, anon_via: "backfill" }).eq("id", legacy);
    const pend = await d.getAnonPending({ all: false, userId: adminId, jobIds: new Set([a, b]), error: false } as never);
    expect(pend.fileIds).toEqual([ids.pending]);
    expect(pend.count).toBe(1);
    // dlouhý rozsah (> 300 zakázek) nepřeteče URL — dávky po 200
    const many = new Set([a, b, ...Array.from({ length: 450 }, () => randomUUID())]);
    expect((await d.getAnonPending({ all: false, userId: adminId, jobIds: many, error: false } as never)).count).toBe(1);
    expect(await d.getAnonReviewCount({ all: false, userId: adminId, jobIds: many, error: false } as never)).toBe(2);
    expect((await d.getAnonReviewList({ scope: { all: false, userId: adminId, jobIds: many, error: false } as never })).map((r) => r.id).sort())
      .toEqual([ids.review, ids.failed].sort());
    const manyBadges = await d.getJobAnonBadges([...many]);
    expect(manyBadges[a]).toMatchObject({ done: 1, review: 1 });

    const st = await d.getDrawingAnonStatuses([{ id: "drawing-x", jobFileId: ids.review }]);
    expect(st["drawing-x"]).toMatchObject({ status: "review", table: "job_files", fileId: ids.review });

    const panel = await d.getAnonSettingsPanel();
    expect(panel).not.toBeNull();
    expect(panel!.settings.redact.company).toBe(true);
    expect(["full", "approval"]).toContain(panel!.mode);
    expect(panel!.reviewCount).toBeGreaterThanOrEqual(2);

    // routa fronty odeslání: příjemce a kolik výkresů ještě čeká
    const { GET } = await import("@/app/api/drawings/anonymize/send-queue/route");
    const res = await GET(new Request(`http://localhost/api/drawings/anonymize/send-queue?jobId=${a}`));
    const body = (await res.json()) as { items: { status: string; to: string; fileCount: number; pendingCount: number; mine: boolean }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ status: "waiting", to: "d@x.cz", fileCount: 2, pendingCount: 1, mine: true });

    // cizí odeslání: bez příjemce a důvodu; objednávka dodavateli (ceny) jen s právem na marže
    await svc.from("anon_send_queue").insert({ kind: "purchase_order", job_id: a, payload: { to: ["po@x.cz"], subject: "PO", body: "B" }, file_ids: [ids.pending], status: "waiting", created_by: adminId });
    who.id = salesId; who.role = "obchodnik"; who.margins = false;
    try {
      const r2 = await GET(new Request(`http://localhost/api/drawings/anonymize/send-queue?jobId=${a}`));
      const b2 = (await r2.json()) as { items: { kind: string; to: string | null; reason: string | null; mine: boolean }[] };
      expect(b2.items.map((i) => i.kind)).toEqual(["job_document"]);
      expect(b2.items[0]).toMatchObject({ to: null, reason: null, mine: false });
      who.margins = true;
      const r3 = await GET(new Request(`http://localhost/api/drawings/anonymize/send-queue?jobId=${a}`));
      expect(((await r3.json()) as { items: unknown[] }).items).toHaveLength(2);
    } finally {
      who.id = adminId; who.role = "super_admin"; who.margins = true;
    }
  }, 60_000);

  it("routy: cizí samostatná anonymizace 404, nákupní doklad 403 bez marží, ke kontrole bez potvrzení 409", async () => {
    const op = localAdmin(userActor({ id: adminId }));
    const jobId = await newJob(6);
    // samostatný nástroj super admina
    const adhocPath = `capture/${adminId}/anon/${randomUUID()}-x.pdf`;
    const { data: ad, error: adErr } = await svc.from("drawing_anon_adhoc").insert({ user_id: adminId, storage_path: adhocPath, filename: "x.pdf", mime_type: "application/pdf", size_bytes: 4, anon_status: "uploading", anon_via: "rucne" }).select("id").single();
    expect(adErr).toBeNull();
    const adhocId = (ad as { id: string }).id;
    // nákupní doklad (objednávka vydaná) s hotovou kopií + výkres ke kontrole
    const pPrice = await upload(jobId, "po.pdf");
    const { data: pf } = await svc.from("job_files").insert({ job_id: jobId, kind: "objednavka_vydana", filename: "po.pdf", mime_type: "application/pdf", storage_path: pPrice, origin: "email" }).select("id").single();
    const priceId = (pf as { id: string }).id;
    await op.from("job_files").update({ anon_status: "review", anon_path: `zakazky/${jobId}/anon/x.pdf`, anon_sha256: "a".repeat(64), anon_at: new Date().toISOString() }).eq("id", priceId);
    const pRev = await upload(jobId, "rev.pdf");
    const { data: rf } = await svc.from("job_files").insert({ job_id: jobId, kind: "vykres", filename: "rev.pdf", mime_type: "application/pdf", storage_path: pRev, origin: "email" }).select("id").single();
    const revId = (rf as { id: string }).id;
    await op.from("job_files").update({ anon_status: "review", anon_path: `zakazky/${jobId}/anon/y.pdf`, anon_sha256: "b".repeat(64), anon_at: new Date().toISOString() }).eq("id", revId);

    const state = await import("@/app/api/drawings/anonymize/[fileId]/route");
    const preview = await import("@/app/api/drawings/anonymize/[fileId]/preview/route");
    const download = await import("@/app/api/drawings/anonymize/[fileId]/download/route");
    const approveR = await import("@/app/api/drawings/anonymize/[fileId]/approve/route");
    const ctx = (id: string) => ({ params: Promise.resolve({ fileId: id }) });
    const put = (id: string, body: Record<string, unknown>) => new Request(`http://localhost/api/drawings/anonymize/${id}`, { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
    who.id = salesId; who.role = "obchodnik"; who.margins = false;
    try {
      expect((await state.GET(new Request(`http://localhost/x?table=adhoc`), ctx(adhocId))).status).toBe(404);
      expect((await preview.GET(new Request(`http://localhost/x?table=adhoc`), ctx(adhocId))).status).toBe(404);
      expect((await download.GET(new Request(`http://localhost/x?table=adhoc`), ctx(adhocId))).status).toBe(404);
      expect((await state.PUT(put(adhocId, { table: "adhoc", regions: [], expectedAt: null }), ctx(adhocId))).status).toBe(404);

      expect((await preview.GET(new Request("http://localhost/x"), ctx(priceId))).status).toBe(403);
      expect((await download.GET(new Request("http://localhost/x"), ctx(priceId))).status).toBe(403);
      const ap = new Request("http://localhost/x", { method: "POST", body: JSON.stringify({}), headers: { "content-type": "application/json" } });
      expect((await approveR.POST(ap, ctx(priceId))).status).toBe(403);

      const dl = await download.GET(new Request("http://localhost/x"), ctx(revId));
      expect(dl.status).toBe(409);
      expect(((await dl.json()) as { reason: string }).reason).toBe("review");
    } finally {
      who.id = adminId; who.role = "super_admin"; who.margins = true;
      await svc.from("drawing_anon_adhoc").delete().eq("id", adhocId);
    }
    // s maržemi (super admin) nákupní doklad projde zámkem, ale anonymní kopie se nesdílí nikdy
    const dlAdmin = await download.GET(new Request("http://localhost/x?reviewed=1"), ctx(priceId));
    expect(dlAdmin.status).toBe(409);
    expect(((await dlAdmin.json()) as { reason: string }).reason).toBe("excluded");
  }, 60_000);

  it("akce: režim anonymizace a staré výkresy (jen super admin)", async () => {
    const act = await import("@/app/actions/drawing-anon");
    const { data: before } = await svc.from("automation_settings").select("mode").eq("module", "drawing_anonymize").maybeSingle();
    const prevRow = before as { mode: "full" | "approval" } | null;
    try {
      expect((await act.setAnonMode("approval")).ok).toBe(true);
      const { data: m } = await svc.from("automation_settings").select("mode").eq("module", "drawing_anonymize").single();
      expect((m as { mode: string }).mode).toBe("approval");
    } finally {
      // sdílená DB: vrátit přesně původní stav (i když řádek předtím nebyl)
      if (prevRow) await svc.from("automation_settings").update({ mode: prevRow.mode }).eq("module", "drawing_anonymize");
      else await svc.from("automation_settings").delete().eq("module", "drawing_anonymize");
    }

    // povýšení starých výkresů jen v zakázkách testu (ne celý backfill sdílené DB)
    const { promoteLegacy } = await import("@/lib/anonymize/queue");
    const jobId = await newJob(5);
    const p = await upload(jobId, "old.pdf");
    const { data } = await svc.from("job_files").insert({ job_id: jobId, kind: "vykres", filename: "old.pdf", mime_type: "application/pdf", storage_path: p, origin: "email" }).select("id").single();
    const id = (data as { id: string }).id;
    const op = localAdmin(userActor({ id: adminId }));
    await op.from("job_files").update({ anon_status: "pending", anon_priority: 9, anon_via: "backfill" }).eq("id", id);
    const r = await promoteLegacy(op as never, { jobIds: [jobId] });
    expect(r.ids).toEqual([id]);
    const { data: row } = await svc.from("job_files").select("anon_priority, anon_via").eq("id", id).single();
    expect(row).toMatchObject({ anon_priority: 5, anon_via: "backfill" });
    expect((await promoteLegacy(op as never, { jobIds: [] })).ids).toEqual([]);

    // ruční zařazení obchodníkem nechá starý výkres v pořadí backfillu (bez obejití denního limitu)
    const { enqueue } = await import("@/lib/anonymize/queue");
    await op.from("job_files").update({ anon_priority: 9 }).eq("id", id);
    const e1 = await enqueue(op as never, { fileIds: [id], priority: 0, via: "rucne", keepBackfill: true });
    expect(e1.backfill).toEqual([id]);
    const { data: row2 } = await svc.from("job_files").select("anon_priority, anon_via").eq("id", id).single();
    expect(row2).toMatchObject({ anon_priority: 9, anon_via: "backfill" });

    who.role = "obchodnik";
    try {
      expect((await act.setAnonMode("full")).ok).toBe(false);
      expect((await act.queueLegacyDrawings()).ok).toBe(false);
    } finally {
      who.role = "super_admin";
    }
  }, 60_000);
});
