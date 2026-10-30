import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_ENABLED, DEMO, loadLocalEnv, localAdmin, localSql, profileId } from "@/test/local-supabase";

/**
 * Plné rozlišení a přímé nahrání ↔ lokální Supabase (testovací AI AI_FAKE_ANON):
 *  - fotka z telefonu (4032 px) z prohlížeče: zmenšená hlavní kopie + master na podepsanou URL → anonymizace
 *    z masteru, bez varování „Fotka v nízkém rozlišení", kopie pro dodavatele v plném rozlišení; nezmenšená
 *    fotka je originál sama; master, který prohlížeč nenahrál, se neregistruje; mazání smaže i master,
 *  - archiv výkresů: 6 MB PDF přes podepsanou URL (žádné bajty přes server action) → registerDrawing →
 *    anonymizace hned po nahrání; duplicita stejné revize odmítnuta (dočasný soubor smazán), vyšší revize projde,
 *  - „Poslat originál": jen super admin, se stejným pravidlem v jednotlivém stažení i ve frontě odeslání (audit).
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/anonymize/master.integration.test.ts
 * Vlastní data: zakázka Z-E2E-MASTER-*, výkresy E2E-MASTER-*; vše se po sobě uklidí.
 */

const STAMP_H = vi.hoisted(() => ({ v: Date.now().toString(36) }));
const who = vi.hoisted(() => ({ id: "", role: "super_admin" as string }));
const sent = vi.hoisted(() => ({ mails: [] as { to: string; attachments: { filename: string }[] }[] }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => { void fn; } }));
vi.mock("@/lib/email/send", () => ({ sendMail: vi.fn(async (a: { to: string; attachments: { filename: string }[] }) => { sent.mails.push(a); return { sent: true, emailId: null }; }) }));
vi.mock("@/lib/ai/claude", () => ({
  extractFromDocument: vi.fn(async () => ({
    drawing_number: `E2E-MASTER-${STAMP_H.v}`, revision: "A", material: "S235JR", blank_dimensions: "", heat_treatment: "", surface_treatment: "",
    requirements: "", part_name: "Hřídel", quantity: 1, heat_status: "none", surface_status: "none", summary: "", confidence: 0.9,
  })),
}));
vi.mock("@/lib/ai/corrections", () => ({ getAgentInstructions: async () => "" }));
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
vi.mock("@/lib/auth/session", () => {
  const user = () => ({ id: who.id, role: who.role, active: true, email: "x@local.test", full_name: "Test", aiAccess: true });
  const access = () => ({ user: user(), can: (f: string) => f !== "margins" || who.role === "super_admin", features: ["orders", "settings", "drawings"], ctx: { aiEnabled: true, aiCaptureForAll: true, aiConfigured: true } });
  return {
    getSessionUser: async () => user(),
    getAccess: async () => access(),
    checkFeature: async () => ({ user: user() }),
    apiRequire: async () => ({ user: user() }),
    requireFeature: async () => user(),
  };
});

const STAMP = STAMP_H.v;

/** Výkres vyfocený telefonem: 4032 × 3024, razítko s firmou. */
async function phonePhoto(w = 4032, h = 3024): Promise<Uint8Array> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#fff"/>
    <rect x="30" y="30" width="${w - 60}" height="${h - 60}" fill="none" stroke="#000" stroke-width="6"/>
    <circle cx="${w * 0.35}" cy="${h * 0.45}" r="${h * 0.2}" fill="none" stroke="#000" stroke-width="6"/>
    <rect x="${w * 0.55}" y="${h * 0.72}" width="${w * 0.42}" height="${h * 0.24}" fill="none" stroke="#000" stroke-width="4"/>
    <text x="${w * 0.57}" y="${h * 0.8}" font-family="DejaVu Sans" font-size="${h * 0.035}" font-weight="bold">Strojmetal a.s.</text>
    <text x="${w * 0.57}" y="${h * 0.9}" font-family="DejaVu Sans" font-size="${h * 0.03}">D-4711-02  1.4301</text></svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer());
}
const downscaled = async (b: Uint8Array) => new Uint8Array(await sharp(Buffer.from(b)).resize(2400, 2400, { fit: "inside" }).jpeg({ quality: 85 }).toBuffer());

/** PDF výkresu ~6 MB (vektorové razítko + velká bitmapa šumu). */
async function sixMegPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([1190.55, 841.89]);
  p.drawRectangle({ x: 20, y: 20, width: 1150, height: 800, borderColor: rgb(0, 0, 0), borderWidth: 1.2 });
  p.drawText("STROJMETAL a.s.", { x: 700, y: 160, size: 12, font: helv });
  p.drawText("D-4711-02", { x: 760, y: 50, size: 14, font: helv });
  const noise = Buffer.alloc(1450 * 1450 * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (Math.random() * 256) | 0;
  const png = await sharp(noise, { raw: { width: 1450, height: 1450, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
  const img = await doc.embedPng(png);
  p.drawImage(img, { x: 60, y: 300, width: 200, height: 200 });
  return new Uint8Array(await doc.save());
}

describe.skipIf(!LOCAL_ENABLED)("plné rozlišení a přímé nahrání ↔ lokální Supabase", () => {
  let svc: SupabaseClient;
  let adminId = "";
  let salesId = "";
  let jobId = "";
  const drawings: string[] = [];
  const extraPaths: { bucket: string; path: string }[] = [];
  const prevFake = process.env.AI_FAKE_ANON;
  let runner: typeof import("./runner");

  const row = async (id: string) => ((await svc.from("job_files").select("*").eq("id", id).single()).data as Record<string, unknown>);
  const runQueue = (ids: string[], table: "job_files" | "drawings" = "job_files") =>
    runner.processQueue({ table, ids, fanOut: false, deadline: Date.now() + 240_000, maxFiles: 10 });

  /** Nahrání z prohlížeče jako upload-client: příprava → podepsané URL → registrace akcí. */
  async function browserUpload(name: string, main: Uint8Array, master: Uint8Array | null, opts: { original?: boolean; skipMasterUpload?: boolean } = {}) {
    const act = await import("@/app/actions/job-files");
    const prep = await act.createJobFileUpload({ jobId, filename: name, size: main.length, mimeType: "image/jpeg", ...(master ? { master: { size: master.length, mimeType: "image/jpeg" } } : {}) });
    expect(prep.ok, prep.error).toBe(true);
    if (!prep.ok) throw new Error(prep.error);
    const mainPath = prep.path!;
    const up = await svc.storage.from(prep.bucket!).uploadToSignedUrl(mainPath, prep.token!, main, { contentType: "image/jpeg" });
    expect(up.error).toBeNull();
    if (master) {
      expect(prep.masterPath).toBe(`zakazky/${jobId}/master/${mainPath.split("/").pop()!.slice(0, 36)}`);
      if (!opts.skipMasterUpload) {
        const m = await svc.storage.from(prep.bucket!).uploadToSignedUrl(prep.masterPath!, prep.masterToken!, master, { contentType: "image/jpeg" });
        expect(m.error).toBeNull();
      }
    }
    const reg = await act.registerJobFile({
      jobId, path: mainPath, filename: name, mimeType: "image/jpeg", size: main.length, kind: "vykres",
      ...(master ? { master: true } : {}), ...(opts.original ? { original: true } : {}),
    });
    expect(reg.ok, reg.error).toBe(true);
    if (!reg.ok) throw new Error(reg.error);
    return { id: reg.file!.id, path: mainPath, masterPath: prep.masterPath ?? null };
  }

  beforeAll(async () => {
    const env = loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    process.env.AI_FAKE_ANON = mkdtempSync(path.join(os.tmpdir(), "anon-master-"));
    svc = localAdmin();
    adminId = await profileId(svc, DEMO.admin.email);
    salesId = await profileId(svc, DEMO.sales.email);
    who.id = salesId;
    who.role = "obchodnik";
    runner = await import("./runner");
    localSql("update drawing_anon_settings set enabled = true, auto_upload = true, hires_capture = true where id = 1");
    const { data: j, error } = await svc.from("orders").insert({ number: `Z-E2E-MASTER-${STAMP}`, title: "E2E plné rozlišení", source: "manual", status: "poptavka", owner_id: salesId }).select("id").single();
    if (error) throw new Error(error.message);
    jobId = (j as { id: string }).id;
  }, 120_000);

  afterAll(async () => {
    if (prevFake === undefined) delete process.env.AI_FAKE_ANON; else process.env.AI_FAKE_ANON = prevFake;
    if (!svc) return;
    if (jobId) {
      const { data: f } = await svc.from("job_files").select("id, storage_path, anon_path, anon_source_path").eq("job_id", jobId);
      const rows = (f ?? []) as { id: string; storage_path: string; anon_path: string | null; anon_source_path: string | null }[];
      const paths = [...new Set(rows.flatMap((r) => [r.storage_path, r.anon_path, r.anon_source_path]).filter((x): x is string => Boolean(x)))];
      for (let i = 0; i < paths.length; i += 100) await svc.storage.from("job-files").remove(paths.slice(i, i + 100));
      for (const r of rows) await svc.from("drawing_anon_usage_log").delete().eq("subject_id", r.id);
      await svc.from("anon_send_queue").delete().eq("job_id", jobId);
      await svc.from("orders").delete().eq("id", jobId);
    }
    if (drawings.length) {
      const { data: d } = await svc.from("drawings").select("id, storage_path, anon_path").in("id", drawings);
      const dp = ((d ?? []) as { storage_path: string | null; anon_path: string | null }[]).flatMap((r) => [r.storage_path, r.anon_path]).filter((x): x is string => Boolean(x));
      if (dp.length) await svc.storage.from("documents").remove(dp);
      for (const id of drawings) await svc.from("drawing_anon_usage_log").delete().eq("subject_id", id);
      await svc.from("documents").delete().like("number", `E2E-MASTER-${STAMP}%`);
      await svc.from("drawings").delete().in("id", drawings);
    }
    for (const p of extraPaths) await svc.storage.from(p.bucket).remove([p.path]);
  }, 120_000);

  it("fotka 4032 px z prohlížeče: anonymizace z masteru, bez „nízkého rozlišení“, kopie pro dodavatele v plném rozlišení", async () => {
    const orig = await phonePhoto();
    const small = await downscaled(orig);
    expect((await sharp(Buffer.from(small)).metadata()).width).toBe(2400);
    const f = await browserUpload(`IMG_${STAMP}.jpg`, small, orig);
    const r0 = await row(f.id);
    expect(r0.anon_source_path).toBe(f.masterPath);
    expect(r0.anon_status).toBe("pending");
    await runQueue([f.id]);
    const r = await row(f.id);
    expect(["done", "review"]).toContain(r.anon_status);
    const warnings = ((r.anon_summary as { warnings?: { code: string }[] } | null)?.warnings ?? []).map((w) => w.code);
    expect(warnings).not.toContain("no_master");
    const { data } = await svc.storage.from("job-files").download(String(r.anon_path));
    const meta = await sharp(Buffer.from(await data!.arrayBuffer())).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(4032);
    // hlavní (zmenšená) kopie zůstala pro náhledy a čtení AI
    expect(r.storage_path).toBe(f.path);
  }, 180_000);

  it("nezmenšená fotka = originál sama; neexistující master se neregistruje (→ „nízké rozlišení“)", async () => {
    // různé bajty (stejný obsah by převzal výsledek dvojčete)
    const small = await downscaled(await phonePhoto(2000, 1500));
    const small2 = await downscaled(await phonePhoto(2010, 1500));
    const self = await browserUpload(`orig_${STAMP}.jpg`, small, null, { original: true });
    expect((await row(self.id)).anon_source_path).toBe(self.path);
    const lost = await browserUpload(`lost_${STAMP}.jpg`, small2, small2, { skipMasterUpload: true });
    expect((await row(lost.id)).anon_source_path).toBeNull();
    await runQueue([self.id, lost.id]);
    const codes = async (id: string) => (((await row(id)).anon_summary as { warnings?: { code: string }[] } | null)?.warnings ?? []).map((w) => w.code);
    expect(await codes(self.id)).not.toContain("no_master");
    expect(await codes(lost.id)).toContain("no_master");
  }, 180_000);

  it("master nejde namířit na cizí soubor; vypnutý „master“ v Nastavení = žádná URL; smazání smaže i master", async () => {
    const { registerJobFileCore } = await import("@/lib/jobs/job-files-store");
    const { jobMasterPath } = await import("@/lib/jobs/mapping");
    const other = `zakazky/${randomUUID()}/${randomUUID()}-x.jpg`;
    const p = `zakazky/${jobId}/${randomUUID()}-y.jpg`;
    const bad = await registerJobFileCore(svc as never, salesId, { jobId, path: p, filename: "y.jpg", anonSourcePath: other });
    expect(bad.ok).toBe(false);
    expect(jobMasterPath(p)).toMatch(new RegExp(`^zakazky/${jobId}/master/`));

    localSql("update drawing_anon_settings set hires_capture = false where id = 1");
    try {
      const act = await import("@/app/actions/job-files");
      const prep = await act.createJobFileUpload({ jobId, filename: "z.jpg", size: 10, mimeType: "image/jpeg", master: { size: 20, mimeType: "image/jpeg" } });
      expect(prep.ok && prep.masterPath).toBeFalsy();
    } finally {
      localSql("update drawing_anon_settings set hires_capture = true where id = 1");
    }

    const orig = await phonePhoto(3000, 2000);
    const f = await browserUpload(`smazat_${STAMP}.jpg`, await downscaled(orig), orig);
    who.role = "super_admin";
    who.id = adminId;
    try {
      const act = await import("@/app/actions/job-files");
      const del = await act.deleteJobFile(f.id);
      expect(del.ok, del.error).toBe(true);
      const dir = f.masterPath!.slice(0, f.masterPath!.lastIndexOf("/"));
      const { data } = await svc.storage.from("job-files").list(dir, { search: f.masterPath!.split("/").pop() });
      expect((data ?? []).length).toBe(0);
    } finally {
      who.role = "obchodnik";
      who.id = salesId;
    }
  }, 180_000);

  it("archiv výkresů: 6 MB PDF přes podepsanou URL → anonymizace hned; duplicita revize odmítnuta a dočasný soubor smazán", async () => {
    const pdf = await sixMegPdf();
    expect(pdf.length).toBeGreaterThan(6 * 1000 * 1000);
    const act = await import("@/app/actions/drawings");
    const prep = await act.createDrawingUpload({ filename: "D-4711-02.pdf", size: pdf.length, mimeType: "application/pdf" });
    expect(prep.ok, prep.error).toBe(true);
    expect(prep.path).toMatch(new RegExp(`^vykresy/upload/${salesId}/[0-9a-f-]{36}\\.pdf$`));
    const up = await svc.storage.from("documents").uploadToSignedUrl(prep.path!, prep.token!, pdf, { contentType: "application/pdf" });
    expect(up.error).toBeNull();
    // cizí / vymyšlená cesta → odmítnuto
    expect((await act.registerDrawing({ path: `vykresy/upload/${adminId}/${randomUUID()}.pdf`, filename: "x.pdf", mimeType: "application/pdf" })).ok).toBe(false);
    const r = await act.registerDrawing({ path: prep.path!, filename: "D-4711-02.pdf", mimeType: "application/pdf" });
    expect(r.ok, r.error).toBe(true);
    drawings.push(r.id!);
    expect(r.number).toBe(`E2E-MASTER-${STAMP}`);
    expect(r.anonStatus).toBe("pending");
    const { data: d } = await svc.from("drawings").select("storage_path").eq("id", r.id!).single();
    const stored = String((d as { storage_path: string }).storage_path);
    expect(stored).toMatch(new RegExp(`^vykresy/E2E-MASTER-${STAMP}_\\d+\\.pdf$`));
    // dočasná cesta po přesunu neexistuje
    const tmpList = await svc.storage.from("documents").list(`vykresy/upload/${salesId}`, { search: prep.path!.split("/").pop() });
    expect((tmpList.data ?? []).length).toBe(0);
    await runQueue([r.id!], "drawings");
    const { data: after } = await svc.from("drawings").select("anon_status, anon_path").eq("id", r.id!).single();
    expect(["done", "review"]).toContain((after as { anon_status: string }).anon_status);
    expect((after as { anon_path: string | null }).anon_path).toMatch(/^vykresy\/anon\//);

    // stejné číslo + revize → duplicita, nahraný soubor se uklidí
    const prep2 = await act.createDrawingUpload({ filename: "D-4711-02.pdf", size: pdf.length, mimeType: "application/pdf" });
    await svc.storage.from("documents").uploadToSignedUrl(prep2.path!, prep2.token!, pdf, { contentType: "application/pdf" });
    const dup = await act.registerDrawing({ path: prep2.path!, filename: "D-4711-02.pdf", mimeType: "application/pdf" });
    expect(dup.ok).toBe(false);
    expect(dup.error).toMatch(/Duplicita/);
    const tmp2 = await svc.storage.from("documents").list(`vykresy/upload/${salesId}`, { search: prep2.path!.split("/").pop() });
    expect((tmp2.data ?? []).length).toBe(0);
    // vyšší revize projde (verzování)
    const claude = await import("@/lib/ai/claude");
    vi.mocked(claude.extractFromDocument).mockResolvedValueOnce({
      drawing_number: `E2E-MASTER-${STAMP}`, revision: "B", material: "S235JR", blank_dimensions: "", heat_treatment: "", surface_treatment: "",
      requirements: "", part_name: "Hřídel", quantity: 1, heat_status: "none", surface_status: "none", summary: "", confidence: 0.9,
    } as never);
    const prep3 = await act.createDrawingUpload({ filename: "D-4711-02.pdf", size: pdf.length, mimeType: "application/pdf" });
    await svc.storage.from("documents").uploadToSignedUrl(prep3.path!, prep3.token!, pdf, { contentType: "application/pdf" });
    const revB = await act.registerDrawing({ path: prep3.path!, filename: "D-4711-02.pdf", mimeType: "application/pdf" });
    expect(revB.ok, revB.error).toBe(true);
    drawings.push(revB.id!);
  }, 240_000);

  it("„Poslat originál“: jednotlivé stažení i fronta odeslání — jen super admin, audit, bez původního názvu", async () => {
    const p = `zakazky/${jobId}/${randomUUID()}-sestava-strojmetal.dwg`;
    await svc.storage.from("job-files").upload(p, new Uint8Array([0x41, 0x43, 0x31, 0x30, 0x33, 0x32]), { contentType: "application/octet-stream" });
    const { data: ins, error } = await svc.from("job_files").insert({
      job_id: jobId, kind: "vykres", filename: "sestava-strojmetal.dwg", storage_path: p, origin: "email", issuer: "zakaznik", uploaded_by: salesId,
    }).select("id, anon_status").single();
    if (error) throw new Error(error.message);
    const dwg = (ins as { id: string; anon_status: string }).id;
    expect((ins as { anon_status: string }).anon_status).toBe("unsupported");

    // 1) jednotlivé stažení „pro dodavatele"
    const route = await import("@/app/api/drawings/anonymize/[fileId]/download/route");
    const get = (q: string) => route.GET(new Request(`http://localhost/api/drawings/anonymize/${dwg}/download${q}`), { params: Promise.resolve({ fileId: dwg }) });
    const plain = await get("");
    expect(plain.status).toBe(409);
    const forbidden = await get("?original=1");
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).error).toMatch(/jen super admin.*DXF/);
    who.role = "super_admin";
    who.id = adminId;
    try {
      const ok = await get("?original=1");
      expect(ok.status).toBe(200);
      expect(ok.headers.get("content-disposition")).toBe('attachment; filename="original.dwg"');
      expect(new Uint8Array(await ok.arrayBuffer()).length).toBe(6);
      const audit = localSql(`select count(*) from audit_log where action = 'anon_original_download' and entity_id = '${dwg}'`);
      expect(audit).toBe("1");
    } finally {
      who.role = "obchodnik";
      who.id = salesId;
    }

    // 2) fronta odeslání zablokovaná DWG
    const sq = await import("./send-queue");
    const q = await sq.enqueueSend(svc, {
      kind: "job_document", jobId, payload: { to: ["kooperant@local.test"], subject: "Výkresy", body: "Dobrý den", originalFileIds: [dwg], originalConfirmedBy: adminId } as never,
      fileIds: [dwg], createdBy: salesId,
    });
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    // podstrčené potvrzení z požadavku klienta se zahodí
    const { data: qr } = await svc.from("anon_send_queue").select("payload").eq("id", q.id).single();
    expect((qr as { payload: Record<string, unknown> }).payload.originalFileIds).toBeUndefined();
    await sq.flushSendQueue(svc, { ids: [q.id] });
    const blocked = (await svc.from("anon_send_queue").select("status, reason").eq("id", q.id).single()).data as { status: string; reason: string };
    expect(blocked.status).toBe("blocked");
    expect(blocked.reason).toMatch(/jen super admin/);
    const deny = await sq.allowQueuedOriginals(svc, q.id, { id: salesId, role: "obchodnik" }, null);
    expect(deny.ok).toBe(false);
    sent.mails.length = 0;
    const allow = await sq.allowQueuedOriginals(svc, q.id, { id: adminId, role: "super_admin" }, null);
    expect(allow, JSON.stringify(allow)).toMatchObject({ ok: true, sent: true });
    expect(sent.mails[0]?.attachments.map((a) => a.filename)).toEqual(["original.dwg"]);
    const done = (await svc.from("anon_send_queue").select("status").eq("id", q.id).single()).data as { status: string };
    expect(done.status).toBe("sent");
    expect(localSql(`select count(*) from audit_log where action = 'anon_send_queue_original' and entity_id = '${q.id}'`)).toBe("1");
    expect(localSql(`select count(*) from audit_log where action = 'anon_send_queue_sent' and entity_id = '${q.id}' and diff->'originals' ? '${dwg}'`)).toBe("1");
  }, 180_000);
});
