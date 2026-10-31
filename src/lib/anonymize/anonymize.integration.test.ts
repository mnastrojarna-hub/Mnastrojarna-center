import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_ENABLED, DEMO, loadLocalEnv, localAdmin, localSession, localSql, profileId } from "@/test/local-supabase";
import { aiActor, userActor } from "@/lib/supabase/actor-headers";
import { makeInvoicePdf, makeVectorDrawing, logoPng } from "./__fixtures__/samples";

/**
 * Anonymizace výkresů ↔ lokální Supabase (migrace 20261023159000) s testovací AI (AI_FAKE_ANON):
 * trigger zařazení (kandidát = externí soubor), strážce anon_* proti REST, claim/souběh, běh služby
 * (vektor, fotka, DXF, STEP, DWG, faktura, smíšené PDF), cache podle obsahu, fallback modelu, ruční
 * úprava, schválení, fronta odeslání, ověření sha při sdílení, samostatný nástroj a archiv výkresů.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/anonymize/anonymize.integration.test.ts
 * Vlastní data: zakázky Z-E2E-ANON-*, zákazníci „E2E-ANON …"; vše se po sobě uklidí.
 */

const mails = vi.hoisted(() => ({ list: [] as { to: string; attachments?: { filename: string; content: Buffer }[] }[] }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/email/send", () => ({
  sendMail: vi.fn(async (a: { to: string; attachments?: { filename: string; content: Buffer }[] }) => { mails.list.push(a); return { sent: true, emailId: undefined }; }),
}));
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

const STAMP = Date.now().toString(36);
const PREFIX = `Z-E2E-ANON-${STAMP}`;
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

type Svc = typeof import("./service");
type Fake = typeof import("./detect-ai");

describe.skipIf(!LOCAL_ENABLED)("anonymizace výkresů ↔ lokální Supabase", () => {
  let svc: SupabaseClient;
  let app: SupabaseClient;
  let s: Svc;
  let fake: Fake;
  let adminId = "";
  let workerId = "";
  let salesId = "";
  const jobs: string[] = [];
  const customers: string[] = [];
  const paths: { bucket: string; path: string }[] = [];
  const drawings: string[] = [];
  const adhocs: string[] = [];
  let n = 0;
  let vector: Awaited<ReturnType<typeof makeVectorDrawing>>;
  const prevFake = process.env.AI_FAKE_ANON;
  const prevSecret = process.env.CRON_SECRET;

  async function newCustomer(name: string, email: string): Promise<string> {
    const { data, error } = await svc.from("customers").insert({ name: `E2E-ANON ${STAMP} ${name}`, email, contact_person: "Petr Svoboda" }).select("id").single();
    if (error) throw new Error(error.message);
    customers.push((data as { id: string }).id);
    return (data as { id: string }).id;
  }

  async function newJob(customerId: string | null = null): Promise<string> {
    n += 1;
    const { data, error } = await svc.from("orders").insert({ number: `${PREFIX}-${n}`, title: "E2E anonymizace", source: "manual", status: "poptavka", customer_id: customerId }).select("id").single();
    if (error) throw new Error(error.message);
    jobs.push((data as { id: string }).id);
    return (data as { id: string }).id;
  }

  async function addFile(jobId: string, filename: string, bytes: Uint8Array, mime: string | null, patch: Record<string, unknown> = {}, client: SupabaseClient = app): Promise<Record<string, unknown>> {
    const p = `zakazky/${jobId}/${randomUUID()}-${filename.replace(/[^A-Za-z0-9._-]/g, "_")}`;
    const up = await svc.storage.from("job-files").upload(p, bytes, { contentType: mime ?? "application/octet-stream", upsert: false });
    if (up.error) throw new Error(up.error.message);
    paths.push({ bucket: "job-files", path: p });
    const { data, error } = await client.from("job_files").insert({
      job_id: jobId, kind: "ostatni", filename, mime_type: mime, size_bytes: bytes.length, storage_path: p, origin: "upload", content_sha256: sha(bytes), ...patch,
    }).select("*").single();
    if (error) throw new Error(error.message);
    return data as Record<string, unknown>;
  }

  async function row(id: string, table = "job_files"): Promise<Record<string, unknown>> {
    const { data } = await svc.from(table).select("*").eq("id", id).single();
    return data as Record<string, unknown>;
  }

  async function run(id: string, opts: { manual?: boolean; table?: "job_files" | "drawings" | "drawing_anon_adhoc" } = {}) {
    const table = opts.table ?? "job_files";
    const r = await row(id, table);
    const actor = opts.manual ? userActor({ id: adminId }) : aiActor((r.uploaded_by as string | null) ?? null, "drawing-anon", "automaticky");
    const db = localAdmin(actor);
    const res = await s.runClaimed(db, table, [id], { actor, deadline: Date.now() + 240_000, manual: Boolean(opts.manual) }, 1);
    return res[0];
  }

  beforeAll(async () => {
    const env = loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    process.env.AI_FAKE_ANON = mkdtempSync(path.join(os.tmpdir(), "anon-fake-"));
    delete process.env.CRON_SECRET;
    svc = localAdmin();
    adminId = await profileId(svc, DEMO.admin.email);
    workerId = await profileId(svc, DEMO.worker.email);
    salesId = await profileId(svc, DEMO.sales.email);
    app = localAdmin(userActor({ id: salesId }));
    s = await import("./service");
    fake = await import("./detect-ai");
    vector = await makeVectorDrawing();
    // režim automatiky „full" pro test (vrací se v afterAll)
    localSql("update automation_settings set mode = 'full', enabled = true where module = 'drawing_anonymize'");
  }, 120_000);

  afterEach(() => {
    fake.setFakeAnonHandler(null);
  });

  afterAll(async () => {
    if (prevFake === undefined) delete process.env.AI_FAKE_ANON; else process.env.AI_FAKE_ANON = prevFake;
    if (prevSecret !== undefined) process.env.CRON_SECRET = prevSecret;
    if (!svc) return;
    const { data: f } = await svc.from("job_files").select("storage_path, anon_path, anon_pages").in("job_id", jobs.length ? jobs : ["00000000-0000-0000-0000-000000000000"]);
    const extra = ((f ?? []) as { storage_path: string; anon_path: string | null; anon_pages: { parts?: string[] } | null }[])
      .flatMap((r) => [r.storage_path, r.anon_path, ...(r.anon_pages?.parts ?? [])]).filter((x): x is string => Boolean(x));
    const all = [...paths.filter((p) => p.bucket === "job-files").map((p) => p.path), ...extra];
    for (let i = 0; i < all.length; i += 100) await svc.storage.from("job-files").remove(all.slice(i, i + 100));
    const docs = paths.filter((p) => p.bucket === "documents").map((p) => p.path);
    const { data: d } = await svc.from("drawings").select("anon_path").in("id", drawings.length ? drawings : ["00000000-0000-0000-0000-000000000000"]);
    docs.push(...((d ?? []) as { anon_path: string | null }[]).map((r) => r.anon_path).filter((x): x is string => Boolean(x)));
    if (docs.length) await svc.storage.from("documents").remove(docs);
    const { data: a } = await svc.from("drawing_anon_adhoc").select("anon_path").in("id", adhocs.length ? adhocs : ["00000000-0000-0000-0000-000000000000"]);
    const ap = ((a ?? []) as { anon_path: string | null }[]).map((r) => r.anon_path).filter((x): x is string => Boolean(x));
    if (ap.length) await svc.storage.from("job-files").remove(ap);
    if (adhocs.length) await svc.from("drawing_anon_adhoc").delete().in("id", adhocs);
    if (drawings.length) await svc.from("drawings").delete().in("id", drawings);
    await svc.from("anon_send_queue").delete().in("job_id", jobs.length ? jobs : ["00000000-0000-0000-0000-000000000000"]);
    // záznamy útraty (bez cizího klíče) testovacích souborů
    const { data: fids } = await svc.from("job_files").select("id").in("job_id", jobs.length ? jobs : ["00000000-0000-0000-0000-000000000000"]);
    const subjects = [...((fids ?? []) as { id: string }[]).map((x) => x.id), ...drawings, ...adhocs];
    for (let i = 0; i < subjects.length; i += 100) await svc.from("drawing_anon_usage_log").delete().in("subject_id", subjects.slice(i, i + 100));
    if (jobs.length) await svc.from("orders").delete().in("id", jobs);
    if (customers.length) await svc.from("customers").delete().in("id", customers);
    await svc.from("drawing_anon_ai_cache").delete().gte("created_at", new Date(Date.now() - 3_600_000).toISOString()).like("method", "%");
  }, 120_000);

  it("trigger: externí kandidát → pending (i kind ostatni), náš doklad → nic, DWG → unsupported, e-mail → pending", async () => {
    const job = await newJob();
    const a = await addFile(job, "12-345.pdf", vector.pdf, "application/pdf");
    expect(a.anon_status).toBe("pending");
    expect(a.anon_via).toBe("automaticky");
    const g = await addFile(job, "nabidka.pdf", vector.pdf, "application/pdf", { origin: "generated", kind: "nabidka" });
    expect(g.anon_status).toBeNull();
    const dwg = await addFile(job, "sestava.dwg", new Uint8Array([1, 2, 3]), null, { kind: "vykres" });
    expect(dwg.anon_status).toBe("unsupported");
    const em = await addFile(job, "priloha.pdf", vector.pdf, "application/pdf", { origin: "email" });
    expect(em.anon_status).toBe("pending");
    expect(em.anon_via).toBe("email");
  });

  it("TS zrcadlo kandidáta = SQL anon_is_candidate", async () => {
    const { isAnonCandidate } = await import("./candidate");
    const cases: [string, string, string | null, string | null, string | null][] = [
      ["ostatni", "12-345.pdf", "application/pdf", "upload", null], ["foto", "a.JPG", null, "capture", null], ["vykres", "x.dwg", null, "email", null],
      ["nabidka", "x.pdf", "application/pdf", "generated", "my"], ["faktura", "x.pdf", "application/pdf", "email", null], ["vykres", "x.step", null, null, null],
      ["poptavka", "x.heic", "image/heic", "email", "zakaznik"], ["vykres", "x.docx", null, "upload", null], ["objednavka", "o.pdf", null, "upload", "my"],
      // jen 2D výkresy (31. 10.)
      ["objednavka", "PO-E2E-4471.pdf", "application/pdf", "capture", "zakaznik"], ["poptavka", "rfq.pdf", "application/pdf", "email", "zakaznik"],
      ["vykres", "a.pdf", "application/pdf", "email", "zakaznik"], ["vykres", "a.pdf", "application/pdf", "email", "dodavatel"],
      ["model_3d", "a.step", null, "email", "zakaznik"], ["model_3d", "a.pdf", "application/pdf", "upload", null], ["ostatni", "a.STL", null, "upload", null],
      ["ostatni", "a.igs", null, "upload", null], ["ostatni", "a.sldprt", null, "upload", null], ["objednavka", "a.dwg", null, "email", "zakaznik"],
      ["ostatni", "a.dxf", null, "upload", null], ["vykres", "a.bmp", null, "upload", null], ["foto", "a.bmp", null, "upload", null],
      ["ostatni", "p.zip", "application/zip", "email", "zakaznik"], ["korespondence", "m.eml", null, "upload", null], ["faktura", "f.zip", null, "email", null],
      ["nabidka", "n.pdf", "application/pdf", "email", "dodavatel"], ["dodaci_list", "d.pdf", "application/pdf", "email", "zakaznik"], ["ostatni", "k.xlsx", null, "upload", null],
    ];
    for (const c of cases) {
      const { data, error } = await svc.rpc("anon_is_candidate", { p_kind: c[0], p_filename: c[1], p_mime: c[2], p_origin: c[3], p_issuer: c[4] });
      expect(error).toBeNull();
      expect(data, c.join(" ")).toBe(isAnonCandidate(...c));
    }
  });

  it("strážce M13: přihlášený uživatel (REST) anon_* nezmění ani nepředvyplní", async () => {
    const job = await newJob();
    const f = await addFile(job, "12-346.pdf", vector.pdf, "application/pdf");
    const worker = await localSession(DEMO.worker.email, DEMO.worker.password);
    const { error } = await worker.from("job_files").update({ anon_status: "done", anon_path: f.storage_path, anon_sha256: "x" }).eq("id", f.id as string);
    expect(error).toBeNull();
    const after = await row(f.id as string);
    expect(after.anon_status).toBe("pending");
    expect(after.anon_path).toBeNull();
    const ins = await worker.from("job_files").insert({ job_id: job, kind: "ostatni", filename: "x.pdf", storage_path: `zakazky/${job}/${randomUUID()}-x.pdf`, anon_status: "done", anon_path: "zakazky/x/anon/y.pdf" }).select("*").single();
    if (!ins.error) {
      expect((ins.data as Record<string, unknown>).anon_path).toBeNull();
      expect((ins.data as Record<string, unknown>).anon_status).toBe("pending");
    }
    // claim jen servisní role
    const { error: rpcErr } = await worker.rpc("claim_drawing_anon", { p_limit: 1, p_ids: [f.id] });
    expect(rpcErr).toBeTruthy();
  });

  it("vektorové PDF: běh služby → done, výstup bez textu a metadat, originál beze změny, texty jen super admin, událost s autorem AI", async () => {
    const cust = await newCustomer("Strojmetal Kladno a.s.", "nakup@strojmetal.cz");
    const job = await newJob(cust);
    const f = await addFile(job, "12-345.pdf", vector.pdf, "application/pdf");
    const before = sha(vector.pdf);
    fake.resetFakeAnonCalls();
    const res = await run(f.id as string);
    expect(res.status, res.reason ?? "").toBe("done");
    expect(fake.fakeAnonCalls("vector")).toBe(1);
    const r = await row(f.id as string);
    expect(String(r.anon_path)).toMatch(new RegExp(`^zakazky/${job}/anon/`));
    expect(r.anon_filename).toBe("D-1234-01_B.pdf"); // číslo výkresu a revize z razítka (keep pole)
    expect(r.anon_actor_kind).toBe("ai");
    expect(r.anon_method).toBe("raster_pdf");
    expect(JSON.stringify(r.anon_regions)).not.toMatch(/STROJMETAL|Novák|Kladno/i);
    const { data: out } = await svc.storage.from("job-files").download(String(r.anon_path));
    const bytes = new Uint8Array(await out!.arrayBuffer());
    expect(sha(bytes)).toBe(r.anon_sha256);
    const { checkPdfOutput } = await import("./pdf-raster");
    expect((await checkPdfOutput(bytes)).problems).toEqual([]);
    const { data: orig } = await svc.storage.from("job-files").download(String(r.storage_path));
    expect(sha(new Uint8Array(await orig!.arrayBuffer()))).toBe(before);
    // texty smazaných oblastí: super admin ano, zaměstnanec ne
    const adminS = await localSession(DEMO.admin.email, DEMO.admin.password);
    const workerS = await localSession(DEMO.worker.email, DEMO.worker.password);
    const { data: at } = await adminS.from("drawing_anon_texts").select("text").eq("job_file_id", f.id as string);
    expect((at ?? []).length).toBeGreaterThan(0);
    const { data: wt } = await workerS.from("drawing_anon_texts").select("text").eq("job_file_id", f.id as string);
    expect(wt ?? []).toEqual([]);
    const { data: cache } = await workerS.from("drawing_anon_ai_cache").select("src_sha256").limit(1);
    expect(cache ?? []).toEqual([]);
    const { data: ev } = await svc.from("job_events").select("message, actor_kind, agent").eq("job_id", job).eq("type", "file").ilike("message", "%anonymizovala%");
    expect((ev ?? []).length).toBeGreaterThan(0);
    expect((ev as { actor_kind: string }[])[0].actor_kind).toBe("ai");
  }, 120_000);

  it("cache podle obsahu (M11): stejný soubor u jiného zákazníka → bez volání AI, nové termíny → nové vypálení; stejné termíny → kopie výstupu", async () => {
    const c2 = await newCustomer("Jiná firma s.r.o.", "info@jina-firma.cz");
    const job2 = await newJob(c2);
    const f2 = await addFile(job2, "vykres.pdf", vector.pdf, "application/pdf");
    fake.resetFakeAnonCalls();
    const r2 = await run(f2.id as string);
    expect(r2.status).toBe("done");
    expect(fake.fakeAnonCalls()).toBe(0);
    const row2 = await row(f2.id as string);
    expect((row2.anon_summary as { cachedFrom?: string }).cachedFrom).toBeUndefined();
    // stejná zakázka a termíny → kopie hotového výstupu
    const f3 = await addFile(job2, "vykres-kopie.pdf", vector.pdf, "application/pdf");
    const r3 = await run(f3.id as string);
    expect(r3.status).toBe("done");
    const row3 = await row(f3.id as string);
    expect((row3.anon_summary as { cachedFrom?: string }).cachedFrom).toBe(f2.id);
    expect(row3.anon_sha256).toBe(row2.anon_sha256);
    expect(row3.anon_path).not.toBe(row2.anon_path);
    expect(fake.fakeAnonCalls()).toBe(0);
  }, 120_000);

  it("fallback modelu → done s poznámkou v historii (nic ke kontrole); faktura → skipped (Není výkres); smíšené PDF → jen stránky výkresů", async () => {
    const job = await newJob();
    const other = await makeVectorDrawing({ company: "FALLBACK GmbH" });
    const f = await addFile(job, "fb.pdf", other.pdf, "application/pdf");
    fake.setFakeAnonHandler((req) => req.call === "vector" ? { data: { pages: [{ index: 1, isDrawing: true, textLayerTrustworthy: true, titleBlock: { img: 0, x: 0, y: 0, w: 0, h: 0 }, redactLines: [], boxes: [], keep: [], customerStandard: [] }], confidence: 0.96 }, model: "claude-sonnet-5-5" } : null);
    const r = await run(f.id as string);
    expect(r.status).toBe("done");
    expect(r.reason).toBeNull();
    expect((r.summary?.warnings ?? []).map((w) => w.code)).toContain("model_fallback");
    const { data: fev } = await svc.from("job_events").select("message").eq("job_id", job).ilike("message", "%anonymizova%záložní model%");
    expect((fev ?? []).length).toBe(1);

    const inv = await addFile(job, "faktura-scan.pdf", await makeInvoicePdf(), "application/pdf");
    fake.setFakeAnonHandler((req) => req.call === "vector" ? { pages: [{ index: 1, isDrawing: false, textLayerTrustworthy: true, titleBlock: { img: 0, x: 0, y: 0, w: 0, h: 0 }, redactLines: [], boxes: [], keep: [], customerStandard: [] }], confidence: 0.97 } : null);
    const ri = await run(inv.id as string);
    expect(ri.status).toBe("skipped");
    expect((await row(inv.id as string)).anon_reason).toBe("Není výkres");

    const mixed = await makeVectorDrawing({ extraPages: ["letter", "drawing"], company: "MIXED a.s." });
    // poptávka zákazníka (druh) se neanonymizuje vůbec — jen výkresy
    const fp = await addFile(job, "poptavka-mix.pdf", mixed.pdf, "application/pdf", { kind: "poptavka", origin: "email" });
    expect(fp.anon_status).toBeNull();
    // příloha bez druhu (Ostatní) s výkresy i dopisem → klasifikace stránek
    const fm = await addFile(job, "priloha-mix.pdf", mixed.pdf, "application/pdf", { kind: "ostatni", origin: "email" });
    fake.setFakeAnonHandler((req) => req.call === "vector" ? { pages: [1, 2, 3].map((i) => ({ index: i, isDrawing: i !== 1, textLayerTrustworthy: true, titleBlock: { img: 0, x: 0, y: 0, w: 0, h: 0 }, redactLines: [], boxes: [], keep: [], customerStandard: [] })), confidence: 0.95 } : null);
    const rm = await run(fm.id as string);
    expect(rm.status).toBe("done");
    const rowm = await row(fm.id as string);
    expect((rowm.anon_pages as { included: number[]; excluded: { page: number }[] }).included).toEqual([2, 3]);
    expect((rowm.anon_pages as { excluded: { page: number }[] }).excluded.map((e) => e.page)).toEqual([1]);
  }, 180_000);

  it("DXF → done (jen firma pryč, jméno zůstane), 3D model (STEP / STL) se neanonymizuje vůbec, DWG zůstane unsupported", async () => {
    const job = await newJob(await newCustomer("Strojmetal Aluminium Forging s.r.o.", "nakup@strojmetal-af.cz"));
    const dxf = new TextEncoder().encode("  0\nSECTION\n  2\nENTITIES\n  0\nTEXT\n  8\n0\n 10\n1.0\n  1\nKreslil: J. Novak\n  0\nTEXT\n  1\nACME s.r.o.\n  0\nTEXT\n  1\nVyrobeno pro STROJMETAL\n  0\nENDSEC\n  0\nEOF\n");
    const fd = await addFile(job, "dil.dxf", dxf, null, { kind: "vykres" });
    expect(fd.anon_status).toBe("pending");
    const rd = await run(fd.id as string);
    expect(rd.status, rd.reason ?? "").toBe("done");
    const rdr = await row(fd.id as string);
    const { data: dxfOut } = await svc.storage.from("job-files").download(String(rdr.anon_path));
    const dtext = await dxfOut!.text();
    expect(dtext).not.toMatch(/STROJMETAL|ACME/i);
    expect(dtext).toContain("Kreslil: J. Novak"); // osoby výchozí nemazat („nic víc")
    expect(dtext).toContain("Vyrobeno pro");
    // 3D modely nemají razítko ani název firmy (majitel 31. 10.) — žádný stav, žádná fronta
    const step = new TextEncoder().encode("ISO-10303-21;\nHEADER;\nFILE_NAME('a.step','2026',(''),(''),'','','');\nENDSEC;\nDATA;\n#1=PRODUCT('D-1','STROJMETAL hridel','',(#2));\nENDSEC;\nEND-ISO-10303-21;\n");
    const fs = await addFile(job, "dil.step", step, null, { kind: "model_3d" });
    expect(fs.anon_status).toBeNull();
    const fl = await addFile(job, "dil.stl", new TextEncoder().encode("solid STROJMETAL\nendsolid\n"), null, { kind: "ostatni" });
    expect(fl.anon_status).toBeNull();
    expect(await run(fs.id as string)).toBeUndefined(); // claim nic nevezme
    const dwg = await addFile(job, "sestava.dwg", new Uint8Array([1, 2, 3]), null, { kind: "ostatni" });
    expect(dwg.anon_status).toBe("unsupported");
  }, 60_000);

  it("fotka výkresu bez masteru → done (nízké rozlišení jen poznámka), výstup bez EXIF", async () => {
    const job = await newJob();
    const sharp = (await import("sharp")).default;
    const jpg = new Uint8Array(await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#ffffff" } }).jpeg().withMetadata({ exif: { IFD0: { Artist: "Jan Novak" } } }).toBuffer());
    const f = await addFile(job, "IMG_0001.jpg", jpg, "image/jpeg", { kind: "vykres", origin: "capture" });
    const r = await run(f.id as string);
    expect(r.status).toBe("done");
    const rr = await row(f.id as string);
    expect(rr.anon_reason).toBeNull();
    expect(JSON.stringify((rr.anon_summary as { warnings: unknown[] }).warnings)).toMatch(/nízkém rozlišení/);
    const { data } = await svc.storage.from("job-files").download(String(rr.anon_path));
    const m = await sharp(Buffer.from(await data!.arrayBuffer())).metadata();
    expect(m.exif).toBeUndefined();
  }, 120_000);

  it("claim: dva claimy na stejný soubor → jedno zpracování; prošlý zámek po 3 pokusech → failed", async () => {
    const job = await newJob();
    const f = await addFile(job, "c.pdf", vector.pdf, "application/pdf");
    const [a, b] = await Promise.all([s.claim(svc, "job_files", 1, [f.id as string]), s.claim(svc, "job_files", 1, [f.id as string])]);
    expect(a.length + b.length).toBe(1);
    localSql(`update job_files set anon_status = 'processing', anon_attempts = 3, anon_lock_until = now() - interval '1 min' where id = '${f.id}'`);
    const c = await s.claim(svc, "job_files", 1, [f.id as string]);
    expect(c).toEqual([]);
    expect((await row(f.id as string)).anon_status).toBe("failed");
    // třetí prošlý zámek = událost v historii zakázky (ne tiché selhání)
    const { data: ev } = await svc.from("job_events").select("message").eq("job_id", job).ilike("message", "%opakovaně překročen čas%");
    expect((ev ?? []).length).toBe(1);
  });

  it("nákupní doklad (#25) se neanonymizuje; cesta anonymní kopie nákupního dokladu je chráněná jako originál", async () => {
    const job = await newJob();
    const f = await addFile(job, "vykres-dodavatele.pdf", vector.pdf, "application/pdf", { kind: "vykres", issuer: "dodavatel" });
    expect(f.anon_status).toBe("pending");
    // soubor se stane nákupním dokladem (odkaz z objednávky dodavateli)
    const { data: po, error: poErr } = await svc.from("purchase_orders").insert({ job_id: job, file_id: f.id }).select("id").single();
    expect(poErr).toBeNull();
    const r = await run(f.id as string);
    expect(r.status).toBe("skipped");
    expect((await row(f.id as string)).anon_reason).toMatch(/Nákupní doklad/);
    // zařazení ručně (i přes zakázku) nákupní doklad přeskočí
    const e = await s.enqueue(svc, { jobIds: [job], force: true });
    expect(e.skipped.some((x) => x.id === f.id && /Nákupní/.test(x.reason))).toBe(true);
    // storage pravidlo cen: shoda i na anon_path / anon_source_path
    const anonPath = `zakazky/${job}/anon/${randomUUID()}-x.pdf`;
    await svc.from("job_files").update({ anon_path: anonPath }).eq("id", f.id as string);
    const { data: isPrice } = await svc.rpc("job_file_path_is_price_doc", { p_path: anonPath });
    expect(isPrice).toBe(true);
    await svc.from("job_files").update({ anon_path: null }).eq("id", f.id as string);
    await svc.from("purchase_orders").delete().eq("id", (po as { id: string }).id);
  });

  it("útrata AI: každý běh s voláním AI se zapíše; denní limit sčítá log bez ručních běhů", async () => {
    const job = await newJob();
    const f = await addFile(job, "u.pdf", (await makeVectorDrawing({ company: "USAGE s.r.o." })).pdf, "application/pdf");
    await run(f.id as string);
    const { data: log } = await svc.from("drawing_anon_usage_log").select("subject_id, calls, manual, via").eq("subject_id", f.id as string);
    expect((log ?? []).length).toBe(1);
    expect((log as { calls: number }[])[0].calls).toBeGreaterThan(0);
    const { spentToday } = await import("./budget");
    const before = await spentToday(svc);
    await svc.from("drawing_anon_usage_log").insert([
      { subject_table: "job_files", subject_id: f.id, via: "automaticky", manual: false, usd: 1.25, calls: 1 },
      { subject_table: "job_files", subject_id: f.id, via: "rucne", manual: true, usd: 9, calls: 1 },
    ]);
    expect(Math.round((await spentToday(svc) - before) * 100) / 100).toBe(1.25);
    await svc.from("drawing_anon_usage_log").delete().eq("subject_id", f.id as string);
  }, 120_000);

  it("kick: 6 čekajících → 5 samostatných běhů s CRON_SECRET (mock fetch)", async () => {
    const job = await newJob();
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await addFile(job, `k${i}.pdf`, vector.pdf, "application/pdf")).id as string);
    process.env.CRON_SECRET = "test-secret";
    const calls: { url: string; auth: string; body: { ids: string[] } }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, auth: String((init.headers as Record<string, string>).authorization), body: JSON.parse(String(init.body)) });
      return new Response("{}");
    }) as unknown as typeof fetch;
    const k = await s.kick({ origin: "http://localhost:9999", ids: ids.slice(0, 5), fetchImpl });
    delete process.env.CRON_SECRET;
    expect(k.kicked).toBe(5);
    expect(calls).toHaveLength(5);
    expect(calls[0].url).toBe("http://localhost:9999/api/cron/drawing-anonymize/run");
    expect(calls[0].auth).toBe("Bearer test-secret");
    expect(new Set(calls.map((c) => c.body.ids[0])).size).toBe(5);
    // bez CRON_SECRET: tajemství odvozené ze SUPABASE_SECRET_KEY (automatické zdroje nezůstanou viset)
    calls.length = 0;
    const k2 = await s.kick({ origin: "http://x", ids: ids.slice(0, 1), fetchImpl });
    expect(k2.kicked).toBe(1);
    expect(calls[0].auth).toBe(`Bearer ${s.internalRunSecret()}`);
    expect(s.internalRunAuth(calls[0].auth)).toBe(200);
    // bez obou tajemství se nevolá nic (route pak zpracuje v after())
    const key = process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SECRET_KEY;
    expect((await s.kick({ origin: "http://x", ids, fetchImpl })).kicked).toBe(0);
    process.env.SUPABASE_SECRET_KEY = key;
    await svc.from("job_files").update({ anon_status: "skipped" }).in("id", ids);
  });

  it("ruční úprava (editor): přidaná oblast → done + reviewed_by, událost +1; starší „ke kontrole“ jde schválit", async () => {
    const job = await newJob();
    const other = await makeVectorDrawing({ company: "MANUAL a.s." });
    const f = await addFile(job, "m.pdf", other.pdf, "application/pdf");
    fake.setFakeAnonHandler((req) => req.call === "vector" ? { data: { pages: [{ index: 1, isDrawing: true, textLayerTrustworthy: true, titleBlock: { img: 0, x: 0, y: 0, w: 0, h: 0 }, redactLines: [], boxes: [], keep: [], customerStandard: [] }], confidence: 0.95 }, model: "claude-x" } : null);
    const first = await run(f.id as string);
    expect(first.status, JSON.stringify(first)).toBe("done");
    const r0 = await row(f.id as string);
    const actor = userActor({ id: adminId });
    const res = await s.saveManualRegions(localAdmin(actor), "job_files", f.id as string, [{ id: "m-1", page: 1, x: 0.4, y: 0.4, w: 0.1, h: 0.05, category: "other", source: "manual", zone: "body", manual: "added" }], String(r0.anon_at), actor, Date.now() + 200_000);
    expect("status" in res && res.status).toBe("done");
    const r1 = await row(f.id as string);
    expect(r1.anon_reviewed_by).toBe(adminId);
    expect((r1.anon_regions as { manual?: string }[]).some((x) => x.manual === "added")).toBe(true);
    const { data: ev } = await svc.from("job_events").select("message").eq("job_id", job).ilike("message", "%ručně (+1%");
    expect((ev ?? []).length).toBe(1);
    // konflikt: starý expectedAt
    const conflict = await s.saveManualRegions(localAdmin(actor), "job_files", f.id as string, [], String(r0.anon_at), actor, Date.now() + 200_000);
    expect("conflict" in conflict).toBe(true);

    // jiný obsah (stejné bajty by převzaly hotový schválený výstup z cache)
    const f2 = await addFile(job, "m2.pdf", (await makeVectorDrawing({ company: "MANUAL2 a.s." })).pdf, "application/pdf");
    await run(f2.id as string);
    expect((await row(f2.id as string)).anon_status).toBe("done");
    // řádek „ke kontrole" z doby před migrací 20261031140000 (simulace) jde pořád schválit
    await svc.from("job_files").update({ anon_status: "review" }).eq("id", f2.id as string);
    const ap = await s.approve(localAdmin(actor), "job_files", f2.id as string, actor);
    expect(ap.ok).toBe(true);
    expect((await row(f2.id as string)).anon_status).toBe("done");
  }, 180_000);

  it("ruční obdélník přes číslo výkresu: uložení = rozhodnutí člověka → done (nic ke kontrole)", async () => {
    const { A3 } = await import("./__fixtures__/samples");
    const job = await newJob();
    const f = await addFile(job, "k.pdf", (await makeVectorDrawing({ company: "KEEP a.s." })).pdf, "application/pdf");
    fake.setFakeAnonHandler((req) => req.call === "vector" ? { data: { pages: [{ index: 1, isDrawing: true, textLayerTrustworthy: true, titleBlock: { img: 0, x: 0, y: 0, w: 0, h: 0 }, redactLines: [], boxes: [], keep: [], customerStandard: [] }], confidence: 0.95 }, model: "claude-x" } : null);
    await run(f.id as string);
    const [W, H] = A3;
    const tbx = W - 20 - 520;
    const overNumber = { id: "m-keep", page: 1, x: (tbx + 130) / W, y: (H - 20 - 28 - 16) / H, w: 110 / W, h: 22 / H, category: "other" as const, source: "manual" as const, zone: "body" as const, manual: "added" as const };
    const actor = userActor({ id: adminId });
    const r0 = await row(f.id as string);
    const res = await s.saveManualRegions(localAdmin(actor), "job_files", f.id as string, [overNumber], String(r0.anon_at), actor, Date.now() + 200_000);
    expect("status" in res && res.status).toBe("done");
    const r1 = await row(f.id as string);
    expect(r1.anon_status).toBe("done");
    expect(r1.anon_reason).toBeNull();
    expect(r1.anon_reviewed_by).toBe(adminId);
    // potvrzení zásahu (editor: „Přesto smazat") → také done
    const res2 = await s.saveManualRegions(localAdmin(actor), "job_files", f.id as string, [overNumber], String(r1.anon_at), actor, Date.now() + 200_000, { confirmKeep: true });
    expect("status" in res2 && res2.status).toBe("done");
    expect((await row(f.id as string)).anon_reviewed_by).toBe(adminId);
  }, 180_000);

  it("fronta odeslání: pending → čeká; po done odejde s anonymní kopií (sha); nejistá AI → done → odejde sama; objednávka zákazníka nikdy; podvržený objekt → selže", async () => {
    const { enqueueSend, flushSendQueue } = await import("./send-queue");
    const job = await newJob();
    const other = await makeVectorDrawing({ company: "QUEUE s.r.o." });
    const f = await addFile(job, "q.pdf", other.pdf, "application/pdf");
    const sent: { filename: string; content: Buffer }[][] = [];
    const sender = async (a: { attachments: { filename: string; content: Buffer }[] }) => { sent.push(a.attachments); return { sent: true, emailId: "e1" }; };
    const q = await enqueueSend(svc, { kind: "job_document", jobId: job, payload: { to: ["dodavatel@example.com"], subject: "Poptávka", body: "Dobrý den" }, fileIds: [f.id as string], createdBy: salesId });
    expect(q.ok).toBe(true);
    const id = (q as { id: string }).id;
    expect((await flushSendQueue(svc, { ids: [id], sender })).waiting).toBe(1);
    await run(f.id as string);
    const done = await row(f.id as string);
    expect(done.anon_status).toBe("done");
    // run → onAnonSettled → fronta odešle sama (sendMail je v testu podvržený)
    const qr = await row(id, "anon_send_queue");
    expect(qr.status).toBe("sent");
    const mail = mails.list.find((m) => m.to === "dodavatel@example.com");
    expect(mail?.attachments?.[0].filename).toBe(done.anon_filename);
    expect(sha(new Uint8Array(mail!.attachments![0].content))).toBe(done.anon_sha256);
    const { data: qev } = await svc.from("job_events").select("message, actor_id").eq("job_id", job).ilike("message", "Odesláno%po anonymizaci%");
    expect((qev as { actor_id: string }[])[0]?.actor_id).toBe(salesId);
    expect(sent).toHaveLength(0);

    // dřív „ke kontrole" (záložní model) → teď done → odejde sama, bez schvalování
    const f2 = await addFile(job, "q2.pdf", (await makeVectorDrawing({ company: "QUEUE2 s.r.o." })).pdf, "application/pdf");
    fake.setFakeAnonHandler((req) => req.call === "vector" ? { data: { pages: [{ index: 1, isDrawing: true, textLayerTrustworthy: true, titleBlock: { img: 0, x: 0, y: 0, w: 0, h: 0 }, redactLines: [], boxes: [], keep: [], customerStandard: [] }], confidence: 0.6 }, model: "claude-x" } : null);
    const q2 = await enqueueSend(svc, { kind: "job_document", jobId: job, payload: { to: ["dodavatel@example.com"], subject: "P2", body: "x" }, fileIds: [f2.id as string], createdBy: salesId });
    await run(f2.id as string);
    expect((await row(f2.id as string)).anon_status).toBe("done");
    expect((await row((q2 as { id: string }).id, "anon_send_queue")).status).toBe("sent");

    // objednávka zákazníka: neanonymizuje se a dodavateli neodejde (fronta ji zablokuje)
    const po = await addFile(job, "Objednavka PO-4471.pdf", vector.pdf, "application/pdf", { kind: "objednavka", issuer: "zakaznik", origin: "email" });
    expect(po.anon_status).toBeNull();
    const q3 = await enqueueSend(svc, { kind: "job_document", jobId: job, payload: { to: ["dodavatel@example.com"], subject: "P3", body: "x" }, fileIds: [po.id as string], createdBy: salesId });
    await flushSendQueue(svc, { ids: [(q3 as { id: string }).id], sender });
    const q3r = await row((q3 as { id: string }).id, "anon_send_queue");
    expect(q3r.status).toBe("blocked");
    expect(String(q3r.reason)).toMatch(/objednávku zákazníka/i);
    expect((await row(po.id as string)).anon_status).toBeNull();

    // podvržení: přepsaný anon objekt → sha nesedí
    const { pickShareFile, verifyShareBytes } = await import("./share");
    await svc.storage.from("job-files").update(String(done.anon_path), new TextEncoder().encode("podvrh"), { upsert: true });
    const fr = await row(f.id as string);
    await expect(verifyShareBytes(svc as never, pickShareFile(fr as never), fr as never)).rejects.toThrow(/změněna/);
  }, 240_000);

  it("samostatný nástroj (adhoc) a archiv výkresů (documents) → done, výstup ve správném prefixu", async () => {
    const p = `capture/${salesId}/anon/${randomUUID()}-vykres.pdf`;
    await svc.storage.from("job-files").upload(p, vector.pdf, { contentType: "application/pdf" });
    paths.push({ bucket: "job-files", path: p });
    const { data: ad, error } = await svc.from("drawing_anon_adhoc").insert({ user_id: salesId, storage_path: p, filename: "vykres.pdf", mime_type: "application/pdf", anon_status: "pending" }).select("id").single();
    expect(error).toBeNull();
    adhocs.push((ad as { id: string }).id);
    const r = await run((ad as { id: string }).id, { table: "drawing_anon_adhoc", manual: true });
    expect(["done", "review"]).toContain(r.status);
    const ar = await row((ad as { id: string }).id, "drawing_anon_adhoc");
    expect(String(ar.anon_path)).toMatch(new RegExp(`^capture/${salesId}/anon/out/`));
    // jiný uživatel adhoc nevidí
    const worker = await localSession(DEMO.worker.email, DEMO.worker.password);
    const { data: wv } = await worker.from("drawing_anon_adhoc").select("id").eq("id", (ad as { id: string }).id);
    expect(wv ?? []).toEqual([]);

    const dp = `vykresy/${randomUUID()}-D-9999.pdf`;
    await svc.storage.from("documents").upload(dp, vector.pdf, { contentType: "application/pdf" });
    paths.push({ bucket: "documents", path: dp });
    const { data: dr, error: de } = await svc.from("drawings").insert({ drawing_number: `E2E-ANON-${STAMP}`, revision: "A", storage_path: dp, storage_bucket: "documents" }).select("id, anon_status").single();
    expect(de).toBeNull();
    drawings.push((dr as { id: string }).id);
    expect((dr as { anon_status: string }).anon_status).toBe("pending");
    const rd = await run((dr as { id: string }).id, { table: "drawings" });
    expect(["done", "review"]).toContain(rd.status);
    const drr = await row((dr as { id: string }).id, "drawings");
    expect(String(drr.anon_path)).toMatch(/^vykresy\/anon\//);
    expect(String(drr.anon_filename)).toBe(`E2E-ANON-${STAMP}_A.pdf`);
  }, 180_000);

  it("stránkování: 12 stran → 2 běhy (po 10) s navázáním a spojením částí", async () => {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 1; i <= 12; i++) {
      const pg = doc.addPage([420, 297]);
      pg.drawText("STROJMETAL", { x: 200, y: 52, size: 8, font });
      pg.drawText(`Kreslil: J. Novák   Cislo vykresu: P-${i}`, { x: 200, y: 40, size: 7, font });
      pg.drawText("Material: 1.4301   Revize: A", { x: 200, y: 28, size: 7, font });
    }
    // výchozí: maže se jen název firmy zákazníka (z CRM) — na každé ze 12 stran
    const job = await newJob(await newCustomer("Strojmetal Paging a.s.", "nakup@strojmetal-paging.cz"));
    const pdf12 = await doc.save();
    const f = await addFile(job, "sada.pdf", pdf12, "application/pdf");
    // 1. dávka: odpověděl záložní model → poznámka se přes dávky neztratí (výsledek hotový)
    let vectorCalls = 0;
    fake.setFakeAnonHandler((req) => {
      if (req.call !== "vector") return null;
      vectorCalls++;
      const pages = [...new Set(req.images.map((i) => i.page))];
      const data = { pages: pages.map((p) => ({ index: p, isDrawing: true, textLayerTrustworthy: true, titleBlock: { img: 0, x: 0, y: 0, w: 0, h: 0 }, redactLines: [], boxes: [], keep: [], customerStandard: [] })), confidence: 0.95 };
      return vectorCalls === 1 ? { data, model: "claude-sonnet-5-5" } : data;
    });
    const r1 = await run(f.id as string);
    expect(r1.continued).toBe(true);
    const mid = await row(f.id as string);
    expect(mid.anon_status).toBe("pending");
    expect((mid.anon_pages as { next: number }).next).toBe(11);
    expect((mid.anon_pages as { parts: string[] }).parts).toHaveLength(1);
    const r2 = await run(f.id as string);
    // 2. dávka zavolala AI pro stránky 11–12 (cache je po stránkách)
    expect(vectorCalls).toBe(2);
    expect(r2.status).toBe("done");
    expect((r2.summary?.warnings ?? []).map((w) => w.code)).toContain("model_fallback");
    const fin = await row(f.id as string);
    // texty smazaného názvu firmy z obou dávek (12 stran)
    const { data: texts } = await svc.from("drawing_anon_texts").select("region_id").eq("job_file_id", f.id as string);
    expect(new Set((texts ?? []).map((t) => String((t as { region_id: string }).region_id).split("-")[0])).size).toBe(12);
    // útrata sečtená přes dávky
    expect((fin.anon_usage as { calls: number }).calls).toBe(2);
    const { data } = await svc.storage.from("job-files").download(String(fin.anon_path));
    const { openPdf } = await import("./pdf-node");
    const out = await openPdf(new Uint8Array(await data!.arrayBuffer()));
    expect(out.numPages).toBe(12);
    await out.destroy();
    expect((fin.anon_pages as { included: number[] }).included).toHaveLength(12);
    // části se po spojení smažou
    const { data: list } = await svc.storage.from("job-files").list(`zakazky/${job}/anon/${f.id}`);
    expect((list ?? []).filter((o) => o.name.startsWith("part-"))).toEqual([]);

    // ruční uložení editoru na > 10 stranách: navazující (automatická) dávka běží za uživatele bez AI → done + reviewed
    fake.setFakeAnonHandler(null);
    const actor = userActor({ id: adminId });
    const save = await s.saveManualRegions(localAdmin(actor), "job_files", f.id as string, [{ id: "m-12", page: 12, x: 0.1, y: 0.1, w: 0.1, h: 0.05, category: "other", source: "manual", zone: "body", manual: "added" }], String(fin.anon_at), actor, Date.now() + 200_000);
    expect("continued" in save && save.continued).toBe(true);
    const calls = fake.fakeAnonCalls();
    const r3 = await run(f.id as string); // cron / kick: bez ručního kontextu
    expect(r3.status).toBe("done");
    expect(fake.fakeAnonCalls()).toBe(calls);
    const fin2 = await row(f.id as string);
    expect(fin2.anon_reviewed_by).toBe(adminId);
    expect(fin2.anon_by).toBe(adminId);
  }, 300_000);

  it("PNG logo fixture je platné (sanity)", async () => {
    expect((await logoPng()).length).toBeGreaterThan(100);
    expect(workerId).toBeTruthy();
  });
});
