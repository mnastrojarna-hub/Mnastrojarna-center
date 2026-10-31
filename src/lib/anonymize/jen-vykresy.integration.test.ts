import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_ENABLED, DEMO, loadLocalEnv, localAdmin, localSql, profileId } from "@/test/local-supabase";
import { userActor } from "@/lib/supabase/actor-headers";
import { A3, makeInvoicePdf, makeVectorDrawing, type SampleDrawing } from "./__fixtures__/samples";

/**
 * Jen 2D výkresy, jen název firmy, plná automatika (majitel 31. 10.) ↔ lokální Supabase
 * (migrace 20261031140000_anonymizace_jen_vykresy, testovací AI AI_FAKE_ANON):
 *  - objednávka zákazníka (i vyfocená) se neanonymizuje: žádný stav, žádná fronta, žádná událost,
 *  - příloha bez druhu, kterou AI nepozná jako výkres → „Není výkres" (nic se nemaže),
 *  - výkres → done, smazaný jen název firmy (osoby, telefon, cesta zůstanou),
 *  - změna druhu na serveru: přestal být výkresem → stav pryč; „Není výkres" → druh Výkres → do fronty,
 *  - odeslání dodavateli: výkres jen jako anonymní kopie, objednávka zákazníka nikdy, 3D model originál,
 *  - migrace: stav NE-výkresů pryč (kopie zůstává), „ke kontrole" → hotovo / znovu do fronty (v transakci
 *    s rollbackem — sdílená DB se nezmění).
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/anonymize/jen-vykresy.integration.test.ts
 * Vlastní data: zakázka Z-E2E-JV-*, zákazník „E2E-JV …"; vše se po sobě uklidí.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => { void fn; } }));
vi.mock("@/lib/email/send", () => ({ sendMail: vi.fn(async () => ({ sent: true })) }));
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
    createOperatorClient: async (opts: { actor?: unknown } = {}) => admin(opts), createClient: async () => { throw new Error("Bez session (test)."); },
  };
});

const STAMP = Date.now().toString(36);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const COMPANY_ONLY = '{"company":true,"logo":false,"person_drawn":false,"person_checked":false,"person_revisions":false,"signature":false,"path":false,"contact":false,"code":false,"copyright_owner":false,"copyright_whole":false,"filename":false}';

describe.skipIf(!LOCAL_ENABLED)("anonymizace jen výkresů ↔ lokální Supabase", () => {
  let svc: SupabaseClient;
  let op: SupabaseClient;
  let salesId = "";
  let adminId = "";
  let jobId = "";
  let customerId = "";
  let prevRedact = "";
  const prevFake = process.env.AI_FAKE_ANON;
  let runner: typeof import("./runner");
  let share: typeof import("./share");
  let fake: typeof import("./detect-ai");
  let drawing: SampleDrawing;

  async function addFile(filename: string, bytes: Uint8Array, mime: string | null, patch: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const p = `zakazky/${jobId}/${randomUUID()}-${filename.replace(/[^A-Za-z0-9._-]/g, "_")}`;
    const up = await svc.storage.from("job-files").upload(p, bytes, { contentType: mime ?? "application/octet-stream", upsert: false });
    if (up.error) throw new Error(up.error.message);
    const { data, error } = await localAdmin(userActor({ id: salesId })).from("job_files").insert({
      job_id: jobId, kind: "vykres", filename, mime_type: mime, size_bytes: bytes.length, storage_path: p, origin: "email", issuer: "zakaznik",
      uploaded_by: salesId, content_sha256: sha(bytes), ...patch,
    }).select("*").single();
    if (error) throw new Error(error.message);
    return data as Record<string, unknown>;
  }
  const row = async (id: string) => ((await svc.from("job_files").select("*").eq("id", id).single()).data as Record<string, unknown>);
  const runQueue = (ids: string[]) => runner.processQueue({ ids, fanOut: false, deadline: Date.now() + 240_000, maxFiles: 30 });
  const anonEvents = async (needle: string) => {
    const { data } = await svc.from("job_events").select("message").eq("job_id", jobId).ilike("message", `%${needle}%`);
    return ((data ?? []) as { message: string }[]).filter((e) => /anonymiz|není výkres|nelze/i.test(e.message));
  };

  beforeAll(async () => {
    const env = loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    process.env.AI_FAKE_ANON = mkdtempSync(path.join(os.tmpdir(), "anon-jv-"));
    svc = localAdmin();
    salesId = await profileId(svc, DEMO.sales.email);
    adminId = await profileId(svc, DEMO.admin.email);
    op = localAdmin(userActor({ id: adminId }));
    runner = await import("./runner");
    share = await import("./share");
    fake = await import("./detect-ai");
    drawing = await makeVectorDrawing({ withForm: false, withAttachment: false, company: "STROJMETAL a.s." });
    localSql("update automation_settings set mode = 'full', enabled = true where module = 'drawing_anonymize'");
    // výchozí po migraci: jen název firmy (vrací se v afterAll)
    prevRedact = localSql("select redact::text from drawing_anon_settings where id = 1");
    localSql(`update drawing_anon_settings set redact = '${COMPANY_ONLY}'::jsonb where id = 1`);
    const { data: c, error: ce } = await svc.from("customers").insert({ name: `E2E-JV ${STAMP} Strojmetal a.s.`, email: "nakup@strojmetal.cz", contact_person: "Ing. Jan Dvořák" }).select("id").single();
    if (ce) throw new Error(ce.message);
    customerId = (c as { id: string }).id;
    const { data: j, error } = await svc.from("orders").insert({ number: `Z-E2E-JV-${STAMP}`, title: "E2E jen výkresy", source: "manual", status: "poptavka", customer_id: customerId }).select("id").single();
    if (error) throw new Error(error.message);
    jobId = (j as { id: string }).id;
  }, 120_000);

  afterAll(async () => {
    fake?.setFakeAnonHandler(null);
    if (prevFake === undefined) delete process.env.AI_FAKE_ANON; else process.env.AI_FAKE_ANON = prevFake;
    if (prevRedact) localSql(`update drawing_anon_settings set redact = '${prevRedact.replace(/'/g, "''")}'::jsonb where id = 1`);
    if (!svc || !jobId) return;
    const { data: f } = await svc.from("job_files").select("id, storage_path, anon_path").eq("job_id", jobId);
    const rows = (f ?? []) as { id: string; storage_path: string; anon_path: string | null }[];
    const paths = rows.flatMap((r) => [r.storage_path, r.anon_path]).filter((x): x is string => Boolean(x));
    for (let i = 0; i < paths.length; i += 100) await svc.storage.from("job-files").remove(paths.slice(i, i + 100));
    for (const r of rows) await svc.from("drawing_anon_usage_log").delete().eq("subject_id", r.id);
    await svc.from("anon_send_queue").delete().eq("job_id", jobId);
    await svc.from("orders").delete().eq("id", jobId);
    await svc.from("customers").delete().eq("id", customerId);
  }, 120_000);

  it("objednávka zákazníka (PDF i fotka) se neanonymizuje: žádný stav, žádná fronta, žádná událost", async () => {
    const po = await addFile("Objednávka zákazníka PO-E2E-4471.pdf", await makeInvoicePdf(), "application/pdf", { kind: "objednavka", origin: "capture" });
    const poJpg = await addFile("PO-foto.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), "image/jpeg", { kind: "objednavka", origin: "capture" });
    const conf = await addFile("potvrzeni.pdf", await makeInvoicePdf(), "application/pdf", { kind: "potvrzeni" });
    for (const f of [po, poJpg, conf]) expect(f.anon_status, String(f.filename)).toBeNull();
    const o = await runQueue([po.id, poJpg.id, conf.id] as string[]);
    expect(o.results).toEqual([]);
    expect((await row(po.id as string)).anon_status).toBeNull();
    expect(await anonEvents("PO-E2E-4471")).toEqual([]);
    // ruční „Anonymizovat" ji nezařadí
    const { enqueue } = await import("./queue");
    const q = await enqueue(op as never, { fileIds: [po.id as string], force: true });
    expect(q.queued).toBe(0);
    expect(q.skipped[0]?.reason).toMatch(/Není výkres zákazníka/);
  }, 120_000);

  it("příloha bez druhu (Ostatní), kterou AI nepozná jako výkres → „Není výkres“, nic se nemaže", async () => {
    const f = await addFile("scan-001.pdf", await makeInvoicePdf(), "application/pdf", { kind: "ostatni" });
    expect(f.anon_status).toBe("pending");
    fake.setFakeAnonHandler((req) => req.call === "vector" ? { pages: [{ index: 1, isDrawing: false, textLayerTrustworthy: true, titleBlock: { img: 0, x: 0, y: 0, w: 0, h: 0 }, redactLines: [], boxes: [], keep: [], customerStandard: [] }], confidence: 0.95 } : null);
    try {
      await runQueue([f.id as string]);
    } finally {
      fake.setFakeAnonHandler(null);
    }
    const r = await row(f.id as string);
    expect(r.anon_status).toBe("skipped");
    expect(r.anon_reason).toBe("Není výkres");
    expect(r.anon_path).toBeNull();
  }, 120_000);

  it("výkres → done bez kontroly; smazaný jen název firmy, jména / telefon / cesta / logo zůstanou", async () => {
    const f = await addFile("D-1234-01.pdf", drawing.pdf, "application/pdf");
    expect(f.anon_status).toBe("pending");
    await runQueue([f.id as string]);
    const r = await row(f.id as string);
    expect(r.anon_status, String(r.anon_reason)).toBe("done");
    expect(r.anon_reason).toBeNull();
    const cats = new Set(((r.anon_regions ?? []) as { category: string }[]).map((x) => x.category));
    expect(cats.size).toBeGreaterThan(0);
    for (const c of cats) expect(["company", "custom"]).toContain(c);
    const { data: texts } = await svc.from("drawing_anon_texts").select("category, text").eq("job_file_id", f.id as string);
    const t = (texts ?? []) as { category: string; text: string }[];
    expect(t.some((x) => /STROJMETAL/i.test(x.text))).toBe(true);
    expect(t.some((x) => /Novák|Dvorak|\+420|C:\\/.test(x.text))).toBe(false);
    // výstup: firma pryč, jméno a telefon viditelné
    const { data: out } = await svc.storage.from("job-files").download(String(r.anon_path));
    const bytes = new Uint8Array(await out!.arrayBuffer());
    const { openPdf } = await import("./pdf-node");
    const { renderPageRaster, inkFraction } = await import("./pdf-raster");
    const doc = await openPdf(bytes);
    const ras = await renderPageRaster(await doc.getPage(1), 150 / 72, false);
    await doc.destroy();
    const k = ras.width / A3[0];
    const ink = (key: string) => {
      const s = drawing.texts.find((x) => x.key === key)!;
      return inkFraction(ras, { x: s.x * k, y: (A3[1] - s.y - s.size) * k, w: s.text.length * s.size * 0.5 * k, h: s.size * 1.25 * k }, 255);
    };
    expect(ink("company")).toBeLessThan(0.002);
    expect(ink("drawnBy")).toBeGreaterThan(0.01);
    expect(ink("phone")).toBeGreaterThan(0.01);
    expect(ink("drawingNumber")).toBeGreaterThan(0.01);
    // v historii jen tichý záznam (žádné „ke kontrole")
    const ev = await anonEvents("D-1234-01");
    expect(ev.length).toBeGreaterThan(0);
    expect(ev.some((e) => /ke kontrole/i.test(e.message))).toBe(false);
  }, 180_000);

  it("změna druhu na serveru: přestal být výkresem → stav pryč; „Není výkres“ → druh Výkres → znovu do fronty", async () => {
    const f = await addFile("chybne.pdf", drawing.pdf, "application/pdf");
    await runQueue([f.id as string]);
    expect((await row(f.id as string)).anon_status).toBe("done");
    await op.from("job_files").update({ kind: "objednavka" }).eq("id", f.id as string);
    const a = await row(f.id as string);
    expect(a.anon_status).toBeNull();
    expect(a.anon_path).toBeTruthy(); // kopie se nemaže (jen se nesdílí)
    expect(share.pickShareFile(a as never)).toMatchObject({ ok: false, reason: "excluded" });

    const g = await addFile("priloha.pdf", await makeInvoicePdf(), "application/pdf", { kind: "ostatni" });
    await svc.from("job_files").update({ anon_status: "skipped", anon_reason: "Není výkres", anon_actor_kind: "ai" }).eq("id", g.id as string);
    await op.from("job_files").update({ kind: "vykres" }).eq("id", g.id as string);
    expect((await row(g.id as string)).anon_status).toBe("pending");
    // ruční „Neanonymizovat" (člověk) zůstává i po změně druhu
    const h = await addFile("nas.pdf", drawing.pdf, "application/pdf", { kind: "ostatni" });
    await svc.from("job_files").update({ anon_status: "skipped", anon_reason: "Náš výkres", anon_actor_kind: "user" }).eq("id", h.id as string);
    await op.from("job_files").update({ kind: "vykres" }).eq("id", h.id as string);
    expect((await row(h.id as string)).anon_status).toBe("skipped");
  }, 180_000);

  it("odeslání dodavateli: výkres jen jako anonymní kopie, objednávka zákazníka nikdy, 3D model jako originál", async () => {
    const d = await addFile("D-77.pdf", drawing.pdf, "application/pdf");
    const po = await addFile("PO-77.pdf", await makeInvoicePdf(), "application/pdf", { kind: "objednavka" });
    const step = await addFile("D-77.step", new TextEncoder().encode("ISO-10303-21;\nEND-ISO-10303-21;\n"), null, { kind: "model_3d" });
    expect(step.anon_status).toBeNull();
    // před anonymizací výkres čeká (fronta odeslání), nikdy originál
    const before = await share.collectSupplierAttachments(svc as never, [d.id as string]);
    expect(before.pending).toEqual([d.id]);
    expect(before.ready).toEqual([]);
    await runQueue([d.id as string]);
    const coll = await share.collectSupplierAttachments(svc as never, [d.id, po.id, step.id] as string[]);
    const ready = Object.fromEntries(coll.ready.map((r) => [r.fileId, r]));
    expect(ready[d.id as string]?.source).toBe("anon");
    expect(sha(ready[d.id as string].content)).toBe((await row(d.id as string)).anon_sha256);
    expect(ready[step.id as string]?.source).toBe("original");
    expect(coll.blocked.find((b) => b.fileId === po.id)).toMatchObject({ reason: "excluded" });
  }, 180_000);

  it("migrace: stav NE-výkresů pryč (kopie zůstává), „ke kontrole“ → hotovo / znovu do fronty (transakce s rollbackem)", async () => {
    const po = await addFile("PO-mig.pdf", await makeInvoicePdf(), "application/pdf", { kind: "objednavka" });
    const st = await addFile("mig.step", new TextEncoder().encode("ISO-10303-21;\n"), null, { kind: "model_3d" });
    const revCopy = await addFile("rev-copy.pdf", drawing.pdf, "application/pdf");
    const revNo = await addFile("rev-none.pdf", drawing.pdf, "application/pdf");
    const ok = await addFile("ok.pdf", drawing.pdf, "application/pdf");
    const userSkip = await addFile("PO-skip.pdf", await makeInvoicePdf(), "application/pdf", { kind: "objednavka" });
    const anonPath = `zakazky/${jobId}/anon/${randomUUID()}-x.pdf`;
    await svc.from("job_files").update({ anon_status: "done", anon_path: anonPath, anon_sha256: "a".repeat(64) }).eq("id", po.id as string);
    await svc.from("job_files").update({ anon_status: "pending", anon_priority: 9 }).eq("id", st.id as string);
    await svc.from("job_files").update({ anon_status: "review", anon_reason: "Bez AI", anon_path: anonPath, anon_sha256: "b".repeat(64) }).eq("id", revCopy.id as string);
    await svc.from("job_files").update({ anon_status: "review", anon_reason: "Bez AI", anon_path: null, anon_sha256: null }).eq("id", revNo.id as string);
    await svc.from("job_files").update({ anon_status: "done", anon_path: anonPath, anon_sha256: "c".repeat(64) }).eq("id", ok.id as string);
    await svc.from("job_files").update({ anon_status: "skipped", anon_reason: "Náš výkres", anon_actor_kind: "user" }).eq("id", userSkip.id as string);
    expect((await row(po.id as string)).anon_status).toBe("done");

    const ids = [po, st, revCopy, revNo, ok, userSkip].map((x) => `'${x.id}'`).join(",");
    const dir = mkdtempSync(path.join(os.tmpdir(), "anon-jv-mig-"));
    const script = path.join(dir, "mig.sql");
    const mig = path.resolve(process.cwd(), "supabase/migrations/20261031140000_anonymizace_jen_vykresy.sql");
    writeFileSync(script, [
      "\\set ON_ERROR_STOP 1", "begin;", `\\i ${mig}`, `\\i ${mig}`,
      `select json_object_agg(filename, json_build_object('s', anon_status, 'p', anon_priority, 'path', anon_path is not null)) from job_files where id in (${ids});`,
      "rollback;",
    ].join("\n"));
    const outText = execFileSync(path.resolve(process.cwd(), "tools/local-supabase/psql.sh"), ["-X", "-q", "-tA", "-f", script], { encoding: "utf8" }).trim();
    const res = JSON.parse(outText.split("\n").filter((l) => l.startsWith("{")).pop()!) as Record<string, { s: string | null; p: number; path: boolean }>;
    expect(res["PO-mig.pdf"]).toEqual({ s: null, p: 0, path: true });
    expect(res["mig.step"].s).toBeNull();
    expect(res["rev-copy.pdf"].s).toBe("done");
    expect(res["rev-none.pdf"]).toMatchObject({ s: "pending", p: 5 });
    expect(res["ok.pdf"].s).toBe("done");
    expect(res["PO-skip.pdf"].s).toBe("skipped");
    // rollback: sdílená DB beze změny
    expect((await row(po.id as string)).anon_status).toBe("done");
  }, 120_000);
});
