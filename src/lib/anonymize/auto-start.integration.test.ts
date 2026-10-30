import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_ENABLED, DEMO, loadLocalEnv, localAdmin, localSql, profileId } from "@/test/local-supabase";
import { makeVectorDrawing } from "./__fixtures__/samples";

/**
 * „Výkres nahraný dodatečně se točí navždy" ↔ lokální Supabase (AI_FAKE_ANON): KAŽDÁ cesta, kterou přibude
 * výkres, ho zařadí a zpracování začne hned v témže požadavku (after()), BEZ CRON_SECRET a s NEDOSAŽITELNOU
 * adresou aplikace (APP_URL → 127.0.0.1:9, jako chráněné / špatné nasazení na Vercelu):
 *   dokumenty zakázky (registerJobFile + šťouchnutí), focení (apply), dávka (batch/apply), přílohy pošty
 *   (/api/emails/sync), archiv výkresů (registerDrawing + šťouchnutí), samostatný nástroj, ruční zařazení,
 *   řetěz interního běhu; převzetí přerušeného běhu, 3 pokusy → selhání s českým důvodem, Nastavení.
 * Celá sada běží dvakrát: bez CRON_SECRET a s ním.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/anonymize/auto-start.integration.test.ts
 * Běhy bez filtru (plánovač, pošta) se v testu omezí na vlastní soubory — sdílená DB má soubory jiných sad.
 */

const h = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  after: [] as (() => unknown)[],
  own: new Set<string>(),
  scheduled: [] as Record<string, unknown>[],
  capture: null as null | (() => Promise<unknown>),
  batch: null as null | (() => Promise<unknown>),
  sync: null as null | (() => Promise<unknown>),
  extract: null as null | Record<string, unknown>,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => { h.after.push(fn); } }));
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
    isSupabaseConfigured: () => true, hasServiceKey: () => true, createAdminClient: admin,
    createOperatorClient: async (opts: { actor?: unknown } = {}) => admin(opts),
    createClient: async () => { throw new Error("Bez session (test)."); },
  };
});
vi.mock("@/lib/auth/session", async () => {
  const perms = await import("@/lib/auth/permissions");
  const { NextResponse } = await import("next/server");
  const ctx = { aiEnabled: true, aiCaptureForAll: true, aiConfigured: false };
  const access = () => ({ user: h.user, ctx, features: perms.allowedFeatures(h.user as never, ctx), can: (f: string) => perms.can(h.user as never, f as never, ctx) });
  return {
    getSessionUser: async () => h.user,
    getAccess: async () => access(),
    checkFeature: async (f: string) => (perms.can(h.user as never, f as never, ctx) ? { user: h.user } : { error: "K této akci nemáš oprávnění." }),
    apiRequire: async (f: string) => (perms.can(h.user as never, f as never, ctx) ? { user: h.user } : NextResponse.json({ error: "Zakázáno" }, { status: 403 })),
    requireUser: async () => h.user,
    requireFeature: async () => h.user,
  };
});
// běh bez filtru (plánovač, pošta) jen nad vlastními soubory sady
vi.mock("@/lib/anonymize/runner", async (orig) => {
  const real = await orig<typeof import("./runner")>();
  return {
    ...real,
    processInBackground: (o: Parameters<typeof real.processInBackground>[0]) => {
      h.scheduled.push(o as never);
      // výběr fronty až po odpovědi (jako after()) — vlastní soubory sady v tu chvíli
      if (o.ids || o.jobIds) real.processInBackground(o);
      else h.after.push(() => real.processQueue({ ...o, ids: [...h.own] }));
    },
  };
});
vi.mock("@/lib/jobs/capture-service", () => ({ applyCapture: async () => h.capture!() }));
vi.mock("@/lib/jobs/capture-batch-service", () => ({ captureBatchApply: async () => h.batch!() }));
vi.mock("@/lib/email/ingest", () => ({ syncMailbox: async () => h.sync!() }));
vi.mock("@/lib/ai/claude", () => ({ extractFromDocument: async () => h.extract }));
vi.mock("@/lib/ai/corrections", () => ({ getAgentInstructions: async () => "" }));

const STAMP = Date.now().toString(36);
const PREFIX = `Z-E2E-ANONAUTO-${STAMP}`;
const UNREACHABLE = "http://127.0.0.1:9";

/** Doběhnout všechny after() (i ty, které přidají další). */
async function drain() {
  for (let i = 0; i < 20 && h.after.length; i++) {
    const list = h.after.splice(0);
    for (const fn of list) await fn();
  }
}

function req(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

const MODES = [
  { name: "bez CRON_SECRET", secret: undefined as string | undefined },
  { name: "s CRON_SECRET", secret: "auto-start-secret" },
];

describe.skipIf(!LOCAL_ENABLED)("anonymizace se spustí sama hned po nahrání (bez plánovače, nedosažitelná adresa)", () => {
  let svc: SupabaseClient;
  let adminId = "";
  let pdf: Uint8Array;
  const jobs: string[] = [];
  const paths: { bucket: string; path: string }[] = [];
  const drawings: string[] = [];
  const adhocs: string[] = [];
  const prev = { fake: process.env.AI_FAKE_ANON, cron: process.env.CRON_SECRET, app: process.env.APP_URL, pub: process.env.NEXT_PUBLIC_APP_URL };
  let n = 0;

  async function newJob(): Promise<string> {
    n += 1;
    const { data, error } = await svc.from("orders").insert({ number: `${PREFIX}-${n}`, title: "E2E anonymizace automaticky", source: "manual", status: "poptavka", owner_id: adminId }).select("id").single();
    if (error) throw new Error(error.message);
    jobs.push((data as { id: string }).id);
    return (data as { id: string }).id;
  }

  async function put(jobId: string, filename: string): Promise<string> {
    const p = `zakazky/${jobId}/${randomUUID()}-${filename}`;
    const { error } = await svc.storage.from("job-files").upload(p, pdf, { contentType: "application/pdf", upsert: false });
    if (error) throw new Error(error.message);
    paths.push({ bucket: "job-files", path: p });
    return p;
  }

  /** Soubor zakázky vložený „jako po nahrání" (trigger zařadí pending). */
  async function insertFile(jobId: string, filename: string, patch: Record<string, unknown> = {}): Promise<string> {
    const p = await put(jobId, filename);
    const { data, error } = await localAdmin({ id: adminId, kind: "user", via: "rucne" }).from("job_files").insert({
      job_id: jobId, kind: "vykres", filename, mime_type: "application/pdf", size_bytes: pdf.length, storage_path: p, origin: "upload", uploaded_by: adminId, ...patch,
    }).select("id, anon_status").single();
    if (error) throw new Error(error.message);
    const id = (data as { id: string }).id;
    h.own.add(id);
    expect((data as { anon_status: string }).anon_status).toBe("pending");
    return id;
  }

  async function status(id: string, table = "job_files"): Promise<{ anon_status: string; anon_reason: string | null; anon_attempts: number }> {
    const { data } = await svc.from(table).select("anon_status, anon_reason, anon_attempts").eq("id", id).single();
    return data as never;
  }

  const finished = (s: string) => s === "done" || s === "review";

  beforeAll(async () => {
    const env = loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    process.env.AI_FAKE_ANON = mkdtempSync(path.join(os.tmpdir(), "anon-auto-"));
    process.env.APP_URL = UNREACHABLE;
    process.env.NEXT_PUBLIC_APP_URL = UNREACHABLE;
    svc = localAdmin();
    adminId = await profileId(svc, DEMO.admin.email);
    const { data: p } = await svc.from("profiles").select("id, email, role, full_name").eq("id", adminId).single();
    const pr = p as { id: string; email: string; role: string; full_name: string };
    h.user = { id: pr.id, email: pr.email, fullName: pr.full_name, role: pr.role, initials: "SA", roleLabel: pr.role, aiAccess: true, active: true, hasProfile: true, mustChangePassword: false };
    pdf = (await makeVectorDrawing()).pdf;
  }, 120_000);

  afterAll(async () => {
    for (const [k, v] of [["AI_FAKE_ANON", prev.fake], ["CRON_SECRET", prev.cron], ["APP_URL", prev.app], ["NEXT_PUBLIC_APP_URL", prev.pub]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    if (!svc) return;
    const none = ["00000000-0000-0000-0000-000000000000"];
    const { data: f } = await svc.from("job_files").select("id, storage_path, anon_path").in("job_id", jobs.length ? jobs : none);
    const rows = (f ?? []) as { id: string; storage_path: string; anon_path: string | null }[];
    const jf = [...paths.filter((p) => p.bucket === "job-files").map((p) => p.path), ...rows.flatMap((r) => [r.storage_path, r.anon_path]).filter((x): x is string => Boolean(x))];
    for (let i = 0; i < jf.length; i += 100) await svc.storage.from("job-files").remove(jf.slice(i, i + 100));
    const { data: d } = await svc.from("drawings").select("id, storage_path, anon_path").in("id", drawings.length ? drawings : none);
    const dp = ((d ?? []) as { storage_path: string | null; anon_path: string | null }[]).flatMap((r) => [r.storage_path, r.anon_path]).filter((x): x is string => Boolean(x));
    if (dp.length) await svc.storage.from("documents").remove(dp);
    const { data: a } = await svc.from("drawing_anon_adhoc").select("storage_path, anon_path").in("id", adhocs.length ? adhocs : none);
    const ap = ((a ?? []) as { storage_path: string | null; anon_path: string | null }[]).flatMap((r) => [r.storage_path, r.anon_path]).filter((x): x is string => Boolean(x));
    if (ap.length) await svc.storage.from("job-files").remove(ap);
    const subjects = [...rows.map((r) => r.id), ...drawings, ...adhocs];
    for (let i = 0; i < subjects.length; i += 100) await svc.from("drawing_anon_usage_log").delete().in("subject_id", subjects.slice(i, i + 100));
    if (adhocs.length) await svc.from("drawing_anon_adhoc").delete().in("id", adhocs);
    if (drawings.length) {
      await svc.from("documents").delete().like("number", `E2E-AUTO-${STAMP}%`);
      await svc.from("drawings").delete().in("id", drawings);
    }
    if (jobs.length) await svc.from("orders").delete().in("id", jobs);
  }, 120_000);

  for (const mode of MODES) {
    describe(mode.name, () => {
      beforeAll(() => {
        if (mode.secret) process.env.CRON_SECRET = mode.secret; else delete process.env.CRON_SECRET;
        h.after.length = 0;
      });

      it("Dokumenty zakázky: nahrání (registerJobFile) → šťouchnutí z prohlížeče → zpracováno v té routě", async () => {
        const job = await newJob();
        const { jobFilePath } = await import("@/lib/jobs/mapping");
        const p = jobFilePath(job, randomUUID(), "D-1234-01.pdf");
        const up = await svc.storage.from("job-files").upload(p, pdf, { contentType: "application/pdf" });
        expect(up.error).toBeNull();
        paths.push({ bucket: "job-files", path: p });
        const { registerJobFile } = await import("@/app/actions/job-files");
        const reg = await registerJobFile({ jobId: job, path: p, filename: "D-1234-01.pdf", mimeType: "application/pdf", size: pdf.length, kind: "vykres" });
        expect(reg.ok, reg.error).toBe(true);
        const id = reg.file!.id;
        h.own.add(id);
        expect(reg.file!.anon?.status).toBe("pending");
        // druhá šance ze server action: kick na nedosažitelnou adresu selže POCTIVĚ (dřív „rozběhnuto")
        await drain();
        const q = await import("./queue");
        expect(q.lastKickFailure()?.message).toMatch(/nedostupná/);
        expect((await status(id)).anon_status).toBe("pending");
        // prohlížeč hned po nahrání: POST /api/drawings/anonymize/process
        const route = await import("@/app/api/drawings/anonymize/process/route");
        const res = await route.POST(req("/api/drawings/anonymize/process", { jobId: job, fileIds: [id] }));
        const body = await res.json();
        expect(body).toMatchObject({ ok: true, started: true, pending: 1 });
        await drain();
        expect(finished((await status(id)).anon_status)).toBe(true);
        // hotovo → další šťouchnutí nic nespustí
        const again = await (await route.POST(req("/api/drawings/anonymize/process", { jobId: job }))).json();
        expect(again).toMatchObject({ started: false, pending: 0 });
      }, 120_000);

      it("Dokumenty: čekání v záložce (jobId) — omezovač 1× / 8 s, souběh dvou souborů zakázky", async () => {
        const job = await newJob();
        const a = await insertFile(job, "A-1.pdf");
        const b = await insertFile(job, "B-2.pdf");
        const route = await import("@/app/api/drawings/anonymize/process/route");
        const r1 = await (await route.POST(req("/api/drawings/anonymize/process", { jobId: job }))).json();
        expect(r1).toMatchObject({ started: true, pending: 2 });
        const r2 = await (await route.POST(req("/api/drawings/anonymize/process", { jobId: job }))).json();
        expect(r2).toMatchObject({ started: false, reason: "throttled" });
        await drain();
        expect(finished((await status(a)).anon_status)).toBe(true);
        expect(finished((await status(b)).anon_status)).toBe(true);
      }, 120_000);

      it("Focení dokladu (capture/apply) → stránky zakázky zpracované po odpovědi", async () => {
        const job = await newJob();
        const id = await insertFile(job, "foto-objednavka.pdf", { origin: "capture", kind: "objednavka", issuer: "zakaznik" });
        h.capture = async () => ({ ok: true, jobId: job, fileId: id, created: false, aiUsed: false, filled: [] });
        const route = await import("@/app/api/jobs/capture/apply/route");
        const res = await route.POST(req("/api/jobs/capture/apply", { captureId: randomUUID(), state: {} }));
        expect(res.status).toBe(200);
        expect(route.maxDuration).toBe(300);
        await drain();
        expect(finished((await status(id)).anon_status)).toBe(true);
      }, 120_000);

      it("Dávka focení (batch/apply) → všechny uložené výkresy zpracované", async () => {
        const job = await newJob();
        const a = await insertFile(job, "V-1.pdf", { origin: "capture" });
        const b = await insertFile(job, "V-2.pdf", { origin: "capture" });
        h.batch = async () => ({ ok: true, status: "done", aiUsed: false, groups: [], pending: [], warnings: [], docs: [{ fileIds: [a] }, { fileIds: [b] }] });
        const route = await import("@/app/api/jobs/capture/batch/apply/route");
        expect((await route.POST(req("/api/jobs/capture/batch/apply", { captureId: randomUUID(), state: {} }))).status).toBe(200);
        await drain();
        expect(finished((await status(a)).anon_status)).toBe(true);
        expect(finished((await status(b)).anon_status)).toBe(true);
      }, 120_000);

      it("Přílohy pošty (stažení /api/emails/sync uloží přílohu k zakázce) → zpracováno po odpovědi", async () => {
        const job = await newJob();
        let id = "";
        h.sync = async () => {
          id = await insertFile(job, "priloha-vykres.pdf", { origin: "email", kind: "ostatni", issuer: "zakaznik" });
          return { source: "imap", configured: true, fetched: 1, ingested: 1, mailboxes: 1, done: true };
        };
        const before = h.scheduled.length;
        const route = await import("@/app/api/emails/sync/route");
        expect((await route.POST(req("/api/emails/sync", {}))).status).toBe(200);
        expect(h.scheduled.length).toBe(before + 1);
        await drain();
        expect(finished((await status(id)).anon_status)).toBe(true);
      }, 120_000);

      it("Archiv výkresů (podepsaná URL + registerDrawing) → id + pending → šťouchnutí (table drawings) → zpracováno", async () => {
        h.extract = {
          drawing_number: `E2E-AUTO-${STAMP}-${mode.secret ? "s" : "n"}`, revision: "A", material: "S235JR", blank_dimensions: "", heat_treatment: "", surface_treatment: "",
          requirements: "", part_name: "Hřídel", quantity: 2, heat_status: "none", surface_status: "none", summary: "", confidence: 0.9,
        };
        const { createDrawingUpload, registerDrawing } = await import("@/app/actions/drawings");
        // soubor jde přímo do úložiště (žádné bajty přes server action), akce dostane jen cestu
        const prep = await createDrawingUpload({ filename: "hridel.pdf", size: pdf.length, mimeType: "application/pdf" });
        expect(prep.ok, prep.error).toBe(true);
        expect(prep.path).toMatch(/^vykresy\/upload\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/);
        const up = await svc.storage.from(prep.bucket!).uploadToSignedUrl(prep.path!, prep.token!, pdf, { contentType: "application/pdf" });
        expect(up.error).toBeNull();
        const r = await registerDrawing({ path: prep.path!, filename: "hridel.pdf", mimeType: "application/pdf" });
        expect(r.ok, r.error).toBe(true);
        drawings.push(r.id!);
        expect(r.anonStatus).toBe("pending");
        await drain(); // kick ze server action na nedosažitelnou adresu → nic
        expect((await status(r.id!, "drawings")).anon_status).toBe("pending");
        const route = await import("@/app/api/drawings/anonymize/process/route");
        const body = await (await route.POST(req("/api/drawings/anonymize/process", { table: "drawings", fileIds: [r.id] }))).json();
        expect(body).toMatchObject({ started: true, pending: 1 });
        await drain();
        expect(finished((await status(r.id!, "drawings")).anon_status)).toBe(true);
      }, 120_000);

      it("Samostatný nástroj (adhoc) → zpracováno v té routě (bez kick)", async () => {
        const route = await import("@/app/api/drawings/anonymize/adhoc/route");
        const prep = await (await route.POST(req("/api/drawings/anonymize/adhoc", { filename: "nastroj.pdf", size: pdf.length, mimeType: "application/pdf" }))).json();
        expect(prep.ok).toBe(true);
        adhocs.push(prep.id);
        const up = await svc.storage.from("job-files").uploadToSignedUrl(prep.path, prep.token, pdf, { contentType: "application/pdf" });
        expect(up.error).toBeNull();
        const start = await (await route.POST(req("/api/drawings/anonymize/adhoc", { id: prep.id }))).json();
        expect(start).toMatchObject({ ok: true, status: "pending" });
        await drain();
        expect(finished((await status(prep.id, "drawing_anon_adhoc")).anon_status)).toBe(true);
      }, 120_000);

      it("Ruční „Anonymizovat“ (POST /api/drawings/anonymize) při nefunkčním rozvětvení → přesto zpracováno", async () => {
        const job = await newJob();
        const id = await insertFile(job, "rucne.pdf");
        const route = await import("@/app/api/drawings/anonymize/route");
        const body = await (await route.POST(req("/api/drawings/anonymize", { fileIds: [id], force: true }))).json();
        expect(body.statuses[id]).toBe("pending");
        await drain();
        expect(finished((await status(id)).anon_status)).toBe(true);
      }, 120_000);

      it("Interní běh (/run): zpracuje svůj soubor a po odpovědi PŘÍMO pokračuje dalším z fronty", async () => {
        const job = await newJob();
        const a = await insertFile(job, "run-a.pdf");
        const b = await insertFile(job, "run-b.pdf");
        const { internalRunSecret } = await import("./queue");
        const route = await import("@/app/api/cron/drawing-anonymize/run/route");
        const probe = await route.GET(new Request("http://localhost/api/cron/drawing-anonymize/run", { headers: { authorization: `Bearer ${internalRunSecret()}` } }));
        expect(probe.status).toBe(200);
        const res = await route.POST(req("/api/cron/drawing-anonymize/run", { table: "job_files", ids: [a] }, { authorization: `Bearer ${internalRunSecret()}` }));
        expect(res.status).toBe(200);
        expect(finished((await status(a)).anon_status)).toBe(true);
        await drain();
        expect(finished((await status(b)).anon_status)).toBe(true);
      }, 120_000);
    });
  }

  it("přerušený běh (processing s prošlým zámkem) se převezme; po 3 pokusech selhání s českým důvodem", async () => {
    delete process.env.CRON_SECRET;
    const job = await newJob();
    const a = await insertFile(job, "prerusene.pdf");
    const b = await insertFile(job, "zaseknute.pdf");
    localSql(`update job_files set anon_status = 'processing', anon_lock_until = now() - interval '1 min', anon_attempts = 1 where id = '${a}'`);
    localSql(`update job_files set anon_status = 'processing', anon_lock_until = now() - interval '1 min', anon_attempts = 3 where id = '${b}'`);
    // živý zámek se nepřevezme
    const c = await insertFile(job, "bezi.pdf");
    localSql(`update job_files set anon_status = 'processing', anon_lock_until = now() + interval '5 min', anon_attempts = 1 where id = '${c}'`);
    const { processQueue } = await import("./runner");
    const o = await processQueue({ jobIds: [job], fanOut: false, deadline: Date.now() + 200_000 });
    expect(o.results.map((r) => r.id)).toEqual([a]);
    expect(finished((await status(a)).anon_status)).toBe(true);
    const sb = await status(b);
    expect(sb.anon_status).toBe("failed");
    expect(sb.anon_reason).toMatch(/Opakovaně překročen čas zpracování/);
    expect((await status(c)).anon_status).toBe("processing");
    const { data: ev } = await svc.from("job_events").select("message").eq("job_id", job).ilike("message", "%selhala%");
    expect(((ev ?? []) as { message: string }[]).some((e) => /zaseknute\.pdf.*opakovaně překročen čas/i.test(e.message))).toBe(true);
    // selhaný → „Zkusit znovu" (ruční zařazení) → zpracováno
    const route = await import("@/app/api/drawings/anonymize/route");
    await route.POST(req("/api/drawings/anonymize", { fileIds: [b], force: true }));
    await drain();
    expect(finished((await status(b)).anon_status)).toBe(true);
  }, 120_000);

  it("smazaný originál: hned failed s pravdivým českým důvodem (opakování nepomůže)", async () => {
    const job = await newJob();
    const id = await insertFile(job, "rozbity.pdf");
    // rozbitý zdroj: soubor v úložišti chybí
    const { data } = await svc.from("job_files").select("storage_path").eq("id", id).single();
    await svc.storage.from("job-files").remove([(data as { storage_path: string }).storage_path]);
    const { processQueue } = await import("./runner");
    for (let i = 0; i < 3; i++) await processQueue({ ids: [id], fanOut: false, deadline: Date.now() + 200_000 });
    const st = await status(id);
    expect(st.anon_status).toBe("failed");
    expect(st.anon_attempts).toBe(1);
    expect(st.anon_reason).toBe("Originál souboru v úložišti chybí — nahraj ho znovu.");
    expect(st.anon_reason).not.toMatch(/^[A-Za-z ]+error/i);
  }, 120_000);

  it("po nasazení: soubory s dřívější nepravdivou hláškou „poškozené nebo zaheslované“ vrátí migrace do fronty a doběhnou samy", async () => {
    const job = await newJob();
    const a = await insertFile(job, "stary-poskozene.pdf");
    const b = await insertFile(job, "stary-technicka.pdf");
    const c = await insertFile(job, "stary-cas.pdf");
    localSql(`update job_files set anon_status = 'failed', anon_attempts = 3, anon_reason = 'PDF je poškozené nebo zaheslované — nejde otevřít. Požádej o nový soubor.' where id = '${a}'`);
    localSql(`update job_files set anon_status = 'failed', anon_attempts = 3, anon_reason = 'Anonymizace se nepovedla (technická chyba) — zkus Anonymizovat znovu.' where id = '${b}'`);
    localSql(`update job_files set anon_status = 'failed', anon_attempts = 3, anon_reason = 'Opakovaně překročen čas zpracování.' where id = '${c}'`);
    const mig = readFileSync(path.join(process.cwd(), "supabase/migrations/20261030180000_anonymizace_pdf_znovu.sql"), "utf8");
    for (let i = 0; i < 2; i++) localSql(mig); // idempotentní
    for (const id of [a, b]) expect(await status(id)).toEqual({ anon_status: "pending", anon_reason: null, anon_attempts: 0 });
    expect((await status(c)).anon_status).toBe("failed"); // jiný důvod se nemění
    // zpracuje je běžná fronta (otevření zakázky / plánovač) — bez ručního klikání
    const { processQueue } = await import("./runner");
    await processQueue({ jobIds: [job], fanOut: false, deadline: Date.now() + 200_000 });
    for (const id of [a, b]) {
      const st = await status(id);
      expect(finished(st.anon_status), `${st.anon_status}: ${st.anon_reason}`).toBe(true);
    }
  }, 180_000);

  it("chyba prostředí („Path2D is not defined“ jako na Vercelu) → pending „zkusí se znovu automaticky“, další běh soubor dokončí; nikdy „poškozené“", async () => {
    const job = await newJob();
    const id = await insertFile(job, "vykres-porucha.pdf");
    const { sha256Hex } = await import("./text");
    const fault = path.join(process.env.AI_FAKE_ANON!, `${await sha256Hex(pdf)}.fault.json`);
    writeFileSync(fault, JSON.stringify({ message: "Path2D is not defined" }));
    const { processQueue } = await import("./runner");
    await processQueue({ ids: [id], fanOut: false, deadline: Date.now() + 200_000 });
    const st1 = await status(id);
    expect(existsSync(fault)).toBe(false);
    expect(st1.anon_status).toBe("pending");
    expect(st1.anon_attempts).toBe(1);
    expect(st1.anon_reason).toBe("Anonymizace se nepovedla kvůli technické chybě při zpracování — zkusí se znovu automaticky.");
    await processQueue({ ids: [id], fanOut: false, deadline: Date.now() + 200_000 });
    const st2 = await status(id);
    expect(finished(st2.anon_status), `${st2.anon_status}: ${st2.anon_reason}`).toBe(true);
    expect(st2.anon_attempts).toBe(2);
    expect(String(st2.anon_reason ?? "")).not.toMatch(/poškozené|zaheslované/);
  }, 120_000);

  it("Nastavení: nedosažitelná adresa a zaseknutý výkres → jasné varování", async () => {
    const job = await newJob();
    const id = await insertFile(job, "stary-pending.pdf");
    localSql(`update job_files set created_at = now() - interval '30 min' where id = '${id}'`);
    const { anonRunnerHealth } = await import("./queue");
    const hlt = await anonRunnerHealth(svc as never);
    expect(hlt.warning).toMatch(/Souběžné zpracování nefunguje: Adresa http:\/\/127\.0\.0\.1:9 je nedostupná/);
    expect(hlt.warning).toMatch(/déle než 15 min/);
    expect(hlt.stuck).toBeGreaterThanOrEqual(1);
    expect(hlt.ok).toBeNull();
    await svc.from("job_files").update({ anon_status: "skipped" }).eq("id", id);
  }, 60_000);
});
