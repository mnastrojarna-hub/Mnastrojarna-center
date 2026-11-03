import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_ENABLED, DEMO, loadLocalEnv, localAdmin, localSql, profileId } from "@/test/local-supabase";
import { userActor } from "@/lib/supabase/actor-headers";
import { buildForeignCompanyPdf } from "./__fixtures__/foreign-company-pdf.mjs";

/**
 * Majitel 2. 11.: „výkresy, které jsou vedeny jako anonymizované, mají furt v hlavičce název firmy" ↔ lokální
 * Supabase (testovací AI AI_FAKE_ANON, migrace 20261103110000_anonymizace_v2_prepocet):
 *  - zakázka pro Strojmetal (CRM), v razítku BRISK Tábor a.s. + název jako křivky + Type3 + doložka + 2. list
 *    → hotovo (detektor anon-v2.0), v kopii pro dodavatele žádná firma, technika a naše firma zůstanou,
 *  - výstupní kontrola najde zbylý název, který nejde smazat → kopie se nepoužije: jeden automatický pokus
 *    znovu, pak „selhalo" s důvodem (nic ke kontrole), dodavatel ji nedostane,
 *  - migrace: hotové kopie starého detektoru → znovu do fronty (backfill), kopie anon-v2.0 ne; přepočet
 *    vytvoří novou kopii (transakce s rollbackem — sdílená DB se nezmění).
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/anonymize/cizi-firma.integration.test.ts
 * Vlastní data: zakázka Z-E2E-CF-*, zákazník „E2E-CF …"; vše se po sobě uklidí.
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

vi.setConfig({ testTimeout: 240_000 });

const STAMP = Date.now().toString(36);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const COMPANY_ONLY = '{"company":true,"logo":false,"person_drawn":false,"person_checked":false,"person_revisions":false,"signature":false,"path":false,"contact":false,"code":false,"copyright_owner":false,"copyright_whole":false,"filename":false}';
type Fx = Awaited<ReturnType<typeof buildForeignCompanyPdf>>;

describe.skipIf(!LOCAL_ENABLED)("firma v razítku ≠ zákazník z CRM ↔ lokální Supabase", () => {
  let svc: SupabaseClient;
  let salesId = "";
  let jobId = "";
  let customerId = "";
  let prevRedact = "";
  const prevFake = process.env.AI_FAKE_ANON;
  let runner: typeof import("./runner");
  let share: typeof import("./share");
  let fake: typeof import("./detect-ai");
  let raster: typeof import("./pdf-raster");
  let node: typeof import("./pdf-node");

  async function addFile(filename: string, bytes: Uint8Array): Promise<Record<string, unknown>> {
    const p = `zakazky/${jobId}/${randomUUID()}-${filename}`;
    const up = await svc.storage.from("job-files").upload(p, bytes, { contentType: "application/pdf", upsert: false });
    if (up.error) throw new Error(up.error.message);
    const { data, error } = await localAdmin(userActor({ id: salesId })).from("job_files").insert({
      job_id: jobId, kind: "vykres", filename, mime_type: "application/pdf", size_bytes: bytes.length, storage_path: p, origin: "email", issuer: "zakaznik",
      uploaded_by: salesId, content_sha256: sha(bytes),
    }).select("*").single();
    if (error) throw new Error(error.message);
    return data as Record<string, unknown>;
  }
  const row = async (id: string) => ((await svc.from("job_files").select("*").eq("id", id).single()).data as Record<string, unknown>);
  const runQueue = (ids: string[]) => runner.processQueue({ ids, fanOut: false, deadline: Date.now() + 200_000, maxFiles: 10 });
  async function download(p: string): Promise<Uint8Array> {
    const { data, error } = await svc.storage.from("job-files").download(p);
    if (error || !data) throw new Error(error?.message ?? "prázdné");
    return new Uint8Array(await data.arrayBuffer());
  }
  async function inks(pdf: Uint8Array, fx: Fx) {
    const doc = await node.openPdf(pdf, { requireFonts: false });
    const pages: Awaited<ReturnType<typeof raster.renderPageRaster>>[] = [];
    for (let p = 1; p <= doc.numPages; p++) pages.push(await raster.renderPageRaster(await doc.getPage(p), 2, false));
    await doc.destroy();
    const at = (pg: number, b: { x: number; y: number; w: number; h: number }) => raster.contrastInkFraction(pages[pg - 1], { x: b.x * 2, y: b.y * 2, w: b.w * 2, h: b.h * 2 });
    return { gone: fx.gone.map((g) => ({ label: g.label, ink: at(g.page, g.box) })), kept: fx.kept.map((k) => ({ label: k.label, ink: at(k.page, k.box) })) };
  }
  /** Testovací AI: názvy bez textové vrstvy (křivky, Type3) v bodech stránky. */
  const vectorFor = (fx: Fx) => ({
    pages: [1, 2].map((p) => ({
      index: p, isDrawing: true, textLayerTrustworthy: true, titleBlock: { img: 0, x: 0, y: 0, w: 0, h: 0 }, redactLines: [], boxes: [], keep: [], customerStandard: [],
      companies: fx.gone.filter((g) => g.page === p && /křivky|Type3/.test(g.label)).map((g) => ({ pt: g.box, role: "designer", form: /křivky|bez Unicode/.test(g.label) ? "curves" : "text", text: /křivky/.test(g.label) ? "KOVOTEX" : /bez Unicode/.test(g.label) ? "ALFAPLAST" : "HYDROTEK S.R.O." })),
    })),
    confidence: 0.95,
  });

  beforeAll(async () => {
    const env = loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    process.env.AI_FAKE_ANON = mkdtempSync(path.join(os.tmpdir(), "anon-cf-"));
    svc = localAdmin();
    salesId = await profileId(svc, DEMO.sales.email);
    runner = await import("./runner");
    share = await import("./share");
    fake = await import("./detect-ai");
    raster = await import("./pdf-raster");
    node = await import("./pdf-node");
    localSql("update automation_settings set mode = 'full', enabled = true where module = 'drawing_anonymize'");
    prevRedact = localSql("select redact::text from drawing_anon_settings where id = 1");
    localSql(`update drawing_anon_settings set redact = '${COMPANY_ONLY}'::jsonb where id = 1`);
    const { data: c, error: ce } = await svc.from("customers").insert({ name: `E2E-CF ${STAMP} Strojmetal a.s.`, email: "nakup@strojmetal.cz", owner_id: salesId }).select("id").single();
    if (ce) throw new Error(ce.message);
    customerId = (c as { id: string }).id;
    const { data: j, error } = await svc.from("orders").insert({ number: `Z-E2E-CF-${STAMP}`, title: "E2E cizí firma v razítku", source: "manual", status: "poptavka", customer_id: customerId, owner_id: salesId }).select("id").single();
    if (error) throw new Error(error.message);
    jobId = (j as { id: string }).id;
  }, 120_000);

  afterEach(() => fake?.setFakeAnonHandler(null));

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

  it("hotovo: v kopii pro dodavatele žádná firma (razítko, křivky, Type3, doložka, 2. list), technika a naše firma zůstanou", async () => {
    const fx = await buildForeignCompanyPdf({ stamp: `${STAMP}A` });
    fake.setFakeAnonHandler((req) => (req.call === "vector" ? vectorFor(fx) : null));
    const f = await addFile(`BT-${STAMP}A.pdf`, fx.bytes);
    await runQueue([f.id as string]);
    const r = await row(f.id as string);
    expect(r.anon_status, String(r.anon_reason)).toBe("done");
    expect((r.anon_summary as { detector?: string }).detector).toBe("anon-v2.0");
    const d = share.pickShareFile(r as never);
    expect(d.ok && d.source).toBe("anon");
    const out = await download(String(r.anon_path));
    const { gone, kept } = await inks(out, fx);
    for (const g of gone) expect(g.ink, g.label).toBeLessThan(0.003);
    for (const k of kept) expect(k.ink, k.label).toBeGreaterThan(0.05);
    // smazané texty (jen super admin) obsahují firmu z výkresu — v kopii ani v názvu souboru není
    const { data: texts } = await svc.from("drawing_anon_texts").select("text").eq("job_file_id", f.id as string);
    expect(((texts ?? []) as { text: string }[]).map((t) => t.text).join("|")).toMatch(/BRISK/);
    expect(String(r.anon_filename)).not.toMatch(/BRISK|KOVOTEX|HYDROTEK/i);
    expect(Buffer.from(out).toString("latin1")).not.toMatch(/BRISK|Tabor|KOVOTEX|HYDROTEK|ALFAPLAST/);
  });

  it("název v kopii zůstane → kopie se nepoužije: pokus znovu, pak selhalo s důvodem (nic ke kontrole)", async () => {
    const fx = await buildForeignCompanyPdf({ stamp: `${STAMP}B` });
    const dn = fx.kept.find((k) => k.label === "číslo výkresu")!;
    // AI výstupní kontrola vidí „firmu" přes číslo výkresu (to se nikdy nevypálí) → neprošlo
    fake.setFakeAnonHandler((req) => {
      if (req.call === "vector") return vectorFor(fx);
      if (req.call !== "company_check") return null;
      const ov = req.images[0];
      const k = ov.s * (300 / 72);
      return { items: [{ img: 0, x: Math.round(dn.box.x * k), y: Math.round(dn.box.y * k), w: Math.round(dn.box.w * k), h: Math.round(dn.box.h * k), text: "BRISK", role: "owner", form: "text" }] };
    });
    const f = await addFile(`BT-${STAMP}B.pdf`, fx.bytes);
    await runQueue([f.id as string]);
    let r = await row(f.id as string);
    expect(r.anon_status).toBe("pending");
    expect(String(r.anon_reason)).toMatch(/zůstal název firmy.*zkusí se znovu/);
    expect(share.pickShareFile(r as never).ok).toBe(false);
    await runQueue([f.id as string]);
    r = await row(f.id as string);
    expect(r.anon_status).toBe("failed");
    expect(String(r.anon_reason)).toMatch(/zůstal název firmy — kopie se nepoužije/);
    const d = share.pickShareFile(r as never);
    expect(d.ok).toBe(false);
    expect(!d.ok && d.reason).toBe("failed");
    expect(r.anon_path).toBeNull();
  });

  it("migrace: stará hotová kopie → fronta (backfill), kopie anon-v2.0 zůstane; přepočet vytvoří novou kopii", async () => {
    const fx = await buildForeignCompanyPdf({ stamp: `${STAMP}C` });
    fake.setFakeAnonHandler((req) => (req.call === "vector" ? vectorFor(fx) : null));
    const oldF = await addFile(`BT-${STAMP}C-old.pdf`, fx.bytes);
    const newF = await addFile(`BT-${STAMP}C-new.pdf`, fx.bytes);
    await runQueue([newF.id as string]);
    const nr = await row(newF.id as string);
    expect(nr.anon_status, `${nr.anon_reason} ${nr.anon_attempts}`).toBe("done");
    // „stará" kopie (detektor anon-v1.0): zdroj jako kopie — v razítku firma
    const oldPath = `zakazky/${jobId}/anon/${randomUUID()}-stara.pdf`;
    await svc.storage.from("job-files").upload(oldPath, fx.bytes, { contentType: "application/pdf" });
    await svc.from("job_files").update({
      anon_status: "done", anon_method: "raster_pdf", anon_path: oldPath, anon_sha256: sha(fx.bytes), anon_summary: { counts: {}, total: 1 }, anon_priority: 0,
    }).eq("id", oldF.id as string);
    const ids = [oldF, newF].map((x) => `'${x.id}'`).join(",");
    const dir = mkdtempSync(path.join(os.tmpdir(), "anon-cf-mig-"));
    const script = path.join(dir, "mig.sql");
    const mig = path.resolve(process.cwd(), "supabase/migrations/20261103110000_anonymizace_v2_prepocet.sql");
    writeFileSync(script, [
      "\\set ON_ERROR_STOP 1", "begin;", `\\i ${mig}`, `\\i ${mig}`,
      `select json_object_agg(filename, json_build_object('s', anon_status, 'p', anon_priority, 'via', anon_via)) from job_files where id in (${ids});`,
      "rollback;",
    ].join("\n"));
    const outText = execFileSync(path.resolve(process.cwd(), "tools/local-supabase/psql.sh"), ["-X", "-q", "-tA", "-f", script], { encoding: "utf8" }).trim();
    const res = JSON.parse(outText.split("\n").filter((l) => l.startsWith("{")).pop()!) as Record<string, { s: string; p: number; via: string }>;
    expect(res[`BT-${STAMP}C-old.pdf`]).toEqual({ s: "pending", p: 9, via: "backfill" });
    expect(res[`BT-${STAMP}C-new.pdf`].s).toBe("done");
    expect((await row(oldF.id as string)).anon_status).toBe("done"); // rollback
    // stejný zásah jako migrace (jen tento soubor) → plánovač / odeslání ho přepočítá
    await svc.from("job_files").update({ anon_status: "pending", anon_priority: 9, anon_via: "backfill", anon_attempts: 0 }).eq("id", oldF.id as string);
    const pending = await row(oldF.id as string);
    expect(share.pickShareFile(pending as never).ok).toBe(false); // stará kopie se do přepočtu nepoužije
    // plánovač (cron) bere i backfill
    const run = await runner.processQueue({ ids: [oldF.id as string], fanOut: false, deadline: Date.now() + 200_000, maxFiles: 10, includeBackfill: true });
    const r = await row(oldF.id as string);
    expect(r.anon_status, JSON.stringify(run.results) + String(r.anon_reason)).toBe("done");
    expect(r.anon_path).not.toBe(oldPath);
    expect((r.anon_summary as { detector?: string }).detector).toBe("anon-v2.0");
    const { gone } = await inks(await download(String(r.anon_path)), fx);
    for (const g of gone) expect(g.ink, g.label).toBeLessThan(0.003);
  });
});
