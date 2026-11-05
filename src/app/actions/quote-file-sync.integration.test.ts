import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { QUOTE_SENT_DELETE_BLOCK } from "@/lib/jobs/quote-files";

/**
 * Nabídka ↔ její PDF v Dokumentech (majitel 5. 11.): mazání je souměrné — proti lokálnímu Supabase
 * (skutečný PostgREST a úložiště; mockuje se jen přihlášení a revalidace).
 *  - smazání posledního vystaveného PDF v Dokumentech smaže i nabídku (s položkami, z úložiště);
 *  - smazání starší verze PDF (v1 vedle v2) nabídku nechá; smazání aktuální verze obnoví předchozí
 *    a srovná quotes.storage_path;
 *  - smazání nabídky v Nabídkách smaže všechna její PDF (řádky i úložiště), nahraný soubor s vazbou
 *    zůstane bez vazby;
 *  - odeslanou nabídku nejde smazat ani přes PDF; bez práva „delete" nic.
 * Vlastní zakázky Z-E2E-QPDF-*; po sobě uklidí.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/app/actions/quote-file-sync.integration.test.ts
 */

const ENABLED = process.env.LOCAL_SUPABASE === "1";
const TAG = Date.now().toString(36);
const PREFIX = `Z-E2E-QPDF-${TAG}`;
const CUSTOMER = "d2000000-0000-0000-0000-000000000001";

type Who = "sales" | "admin";
const who = vi.hoisted(() => ({
  users: {} as Record<string, { id: string; email: string; fullName: string; role: "super_admin" | "obchodnik" | "zamestnanec" }>,
  current: "admin" as string,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

vi.mock("@/lib/supabase/server", async () => {
  const local = await import("@/test/local-supabase");
  const headers = await import("@/lib/supabase/actor-headers");
  const current = () => {
    const u = who.users[who.current];
    return headers.userActor(u ? { id: u.id } : null);
  };
  return {
    isSupabaseConfigured: () => true,
    hasServiceKey: () => true,
    createAdminClient: (opts: { actor?: unknown } = {}) => local.localAdmin((opts.actor as never) ?? headers.SYSTEM_ACTOR),
    createOperatorClient: async (opts: { actor?: unknown } = {}) => local.localAdmin(opts.actor !== undefined ? (opts.actor as never) : current()),
    createClient: async () => {
      throw new Error("Bez session (test).");
    },
  };
});

vi.mock("@/lib/auth/session", async () => {
  const perms = await import("@/lib/auth/permissions");
  const user = () => {
    const u = who.users[who.current];
    return { ...u, initials: "XX", roleLabel: u.role, aiAccess: true, active: true, hasProfile: true, mustChangePassword: false };
  };
  const can = (f: string) => perms.can(user(), f as never, perms.DEFAULT_ACCESS_CONTEXT);
  return {
    getSessionUser: async () => user(),
    getAccess: async () => ({ user: user(), ctx: perms.DEFAULT_ACCESS_CONTEXT, features: [], can }),
    checkFeature: async (f: string) => (can(f) ? { user: user() } : { error: "K této akci nemáš oprávnění." }),
    apiRequire: async () => ({ user: user() }),
    requireUser: async () => user(),
    requireFeature: async () => user(),
  };
});

type Flow = typeof import("@/app/actions/flow-status");
type Jobs = typeof import("@/app/actions/jobs");
type Docs = typeof import("@/app/actions/job-documents");
type Files = typeof import("@/app/actions/job-files");
type Row = Record<string, unknown>;

describe.skipIf(!ENABLED)("nabídka ↔ PDF v Dokumentech: mazání souměrně (lokální Supabase)", () => {
  let svc: SupabaseClient;
  let flow: Flow;
  let jobs: Jobs;
  let docs: Docs;
  let files: Files;
  const jobIds: string[] = [];
  let n = 0;

  const as = (u: Who) => { who.current = u; };
  const id = (u: Who) => who.users[u].id;

  async function newJob(): Promise<string> {
    n += 1;
    const { data, error } = await svc.from("orders").insert({
      number: `${PREFIX}-${n}`, title: `PDF nabídky ${n}`, source: "manual", status: "naceneni", inquiry_date: "2026-10-20",
      customer_id: CUSTOMER, owner_id: id("sales"),
    }).select("id").single();
    if (error) throw new Error(error.message);
    jobIds.push((data as { id: string }).id);
    return (data as { id: string }).id;
  }
  /** Nabídka obchodníka schválená super adminem (PDF jde vystavit až po schválení). */
  async function approvedQuote(jobId: string): Promise<{ id: string; number: string }> {
    as("sales");
    const r = await jobs.createJobQuote(jobId, {
      title: "Hřídel", validUntil: "2099-01-01", leadTimeDays: 14,
      items: [{ drawingNumber: `QP-${TAG}`, name: "Hřídel", quantity: 2, unitPrice: 1000 }],
    });
    expect(r.ok, r.error).toBe(true);
    as("admin");
    const ok = await flow.setQuoteState(r.id!, "schvalena");
    expect(ok.ok, ok.error).toBe(true);
    return { id: r.id!, number: r.number! };
  }
  async function pdf(jobId: string, quoteId: string, note?: string): Promise<{ id: string; version: number; path: string }> {
    as("admin");
    const r = await docs.generateJobDocument(jobId, "nabidka", { quoteId, ...(note ? { note } : {}) });
    expect(r.ok, r.error).toBe(true);
    const row = await file(r.fileId!);
    return { id: r.fileId!, version: Number(row!.version), path: String(row!.storage_path) };
  }
  async function file(fileId: string): Promise<Row | null> {
    const { data } = await svc.from("job_files").select("*").eq("id", fileId).maybeSingle();
    return (data as Row | null) ?? null;
  }
  async function quote(quoteId: string): Promise<Row | null> {
    const { data } = await svc.from("quotes").select("*").eq("id", quoteId).maybeSingle();
    return (data as Row | null) ?? null;
  }
  async function stored(path: string): Promise<boolean> {
    const { data, error } = await svc.storage.from("job-files").download(path);
    return !error && Boolean(data);
  }
  async function events(jobId: string): Promise<string[]> {
    const { data } = await svc.from("job_events").select("message").eq("job_id", jobId).in("type", ["quote", "file"]).order("created_at");
    return ((data ?? []) as { message: string }[]).map((e) => e.message);
  }
  /** Nahraný (ne vystavený) soubor s vazbou na nabídku — příloha. */
  async function uploadedLinked(jobId: string, quoteId: string): Promise<{ id: string; path: string }> {
    const path = `zakazky/${jobId}/${crypto.randomUUID()}-scan-nabidky.pdf`;
    const up = await svc.storage.from("job-files").upload(path, Buffer.from("%PDF-1.4\n%%EOF"), { contentType: "application/pdf" });
    if (up.error) throw new Error(up.error.message);
    const { data, error } = await svc.from("job_files").insert({
      job_id: jobId, kind: "nabidka", filename: "scan-nabidky.pdf", mime_type: "application/pdf", storage_path: path,
      origin: "upload", issuer: "my", quote_id: quoteId, uploaded_by: id("admin"),
    }).select("id").single();
    if (error) throw new Error(error.message);
    return { id: (data as { id: string }).id, path };
  }

  beforeAll(async () => {
    const local = await import("@/test/local-supabase");
    const env = local.loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    svc = local.localAdmin();
    const { data } = await svc.from("profiles").select("id, email, full_name, role").in("email", [local.DEMO.sales.email, local.DEMO.admin.email]);
    for (const r of (data ?? []) as { id: string; email: string; full_name: string; role: "super_admin" | "obchodnik" | "zamestnanec" }[]) {
      who.users[r.role === "super_admin" ? "admin" : "sales"] = { id: r.id, email: r.email, fullName: r.full_name, role: r.role };
    }
    expect(Object.keys(who.users).sort()).toEqual(["admin", "sales"]);
    flow = await import("@/app/actions/flow-status");
    jobs = await import("@/app/actions/jobs");
    docs = await import("@/app/actions/job-documents");
    files = await import("@/app/actions/job-files");
  }, 60_000);

  afterAll(async () => {
    if (!svc || !jobIds.length) return;
    const { data: rows } = await svc.from("job_files").select("storage_path").in("job_id", jobIds);
    const paths = ((rows ?? []) as { storage_path: string }[]).map((f) => f.storage_path);
    if (paths.length) await svc.storage.from("job-files").remove(paths);
    await svc.from("job_files").delete().in("job_id", jobIds);
    await svc.from("job_events").delete().in("job_id", jobIds);
    await svc.from("quotes").delete().in("job_id", jobIds);
    await svc.from("orders").delete().in("id", jobIds);
    await svc.from("audit_log").delete().in("diff->>jobId", jobIds);
  });

  it("Dokumenty: smazání posledního PDF nabídky smaže i nabídku (položky, úložiště, historie)", async () => {
    const jobId = await newJob();
    const q = await approvedQuote(jobId);
    const f1 = await pdf(jobId, q.id);
    expect(await file(f1.id)).toMatchObject({ quote_id: q.id, origin: "generated", kind: "nabidka" });
    const filename = String((await file(f1.id))!.filename);
    expect(await stored(f1.path)).toBe(true);

    as("admin");
    const del = await files.deleteJobFile(f1.id);
    expect(del.ok, del.error).toBe(true);
    expect(del.quoteDeleted).toEqual({ id: q.id, number: q.number });
    expect(await file(f1.id)).toBeNull();
    expect(await quote(q.id)).toBeNull();
    expect((await svc.from("quote_items").select("id").eq("quote_id", q.id)).data).toEqual([]);
    expect(await stored(f1.path)).toBe(false);
    const ev = await events(jobId);
    expect(ev).toContain(`Dokument smazán: Nabídka — ${filename}`);
    expect(ev.at(-1)).toBe(`Nabídka ${q.number} smazána — smazáno její poslední PDF (${filename}) v Dokumentech`);
    const { data: audit } = await svc.from("audit_log").select("action, diff").eq("entity_id", q.id);
    expect((audit ?? []).some((a) => (a as Row).action === "quote_deleted")).toBe(true);
  }, 60_000);

  it("Dokumenty: starší verze PDF nabídku nechá; smazání aktuální verze obnoví předchozí a srovná quotes.storage_path", async () => {
    const jobId = await newJob();
    const q = await approvedQuote(jobId);
    const v1 = await pdf(jobId, q.id);
    const v2 = await pdf(jobId, q.id, "sleva 3 %");
    expect(v2.version).toBe(2);
    expect(await file(v1.id)).toMatchObject({ archived: true, replaced_by: v2.id });
    expect((await quote(q.id))?.storage_path).toBe(v2.path);

    // archivovaná v1 pryč → nabídka i v2 zůstanou
    as("admin");
    const d1 = await files.deleteJobFile(v1.id);
    expect(d1.ok, d1.error).toBe(true);
    expect(d1.quoteDeleted).toBeNull();
    expect(await quote(q.id)).not.toBeNull();
    expect(await file(v2.id)).toMatchObject({ archived: false });
    expect((await quote(q.id))?.storage_path).toBe(v2.path);

    // nová verze v3 nahradí v2; smazání aktuální v3 obnoví v2 a nabídka ukazuje na v2
    const v3 = await pdf(jobId, q.id, "sleva 5 %");
    expect(v3.version).toBe(3);
    expect((await quote(q.id))?.storage_path).toBe(v3.path);
    const d3 = await files.deleteJobFile(v3.id);
    expect(d3.ok, d3.error).toBe(true);
    expect(d3.quoteDeleted).toBeNull();
    expect(await file(v2.id)).toMatchObject({ archived: false, replaced_by: null });
    expect((await quote(q.id))?.storage_path).toBe(v2.path);
    expect(await stored(v3.path)).toBe(false);

    // poslední zbylá verze → nabídka zmizí
    const d2 = await files.deleteJobFile(v2.id);
    expect(d2.ok, d2.error).toBe(true);
    expect(d2.quoteDeleted?.id).toBe(q.id);
    expect(await quote(q.id)).toBeNull();
  }, 90_000);

  it("Nabídky: smazání nabídky smaže všechna její PDF (řádky i úložiště); nahraný soubor s vazbou zůstane bez vazby", async () => {
    const jobId = await newJob();
    const q = await approvedQuote(jobId);
    const v1 = await pdf(jobId, q.id);
    const v2 = await pdf(jobId, q.id, "sleva 2 %");
    const up = await uploadedLinked(jobId, q.id);

    as("admin");
    const del = await jobs.deleteJobQuote(q.id);
    expect(del.ok, del.error).toBe(true);
    expect(del.removedFiles).toBe(2);
    expect(await quote(q.id)).toBeNull();
    expect(await file(v1.id)).toBeNull();
    expect(await file(v2.id)).toBeNull();
    expect(await stored(v1.path)).toBe(false);
    expect(await stored(v2.path)).toBe(false);
    expect(await file(up.id)).toMatchObject({ quote_id: null, archived: false });
    expect(await stored(up.path)).toBe(true);
    expect((await events(jobId)).at(-1)).toBe(`Nabídka ${q.number} smazána včetně 2 PDF v Dokumentech`);
    // vedle DB auditu (job_files_deleted / quotes_deleted z triggerů) i výslovný záznam akce pro každé PDF a nabídku
    const { data: audit } = await svc.from("audit_log").select("action, entity_id").in("entity_id", [v1.id, v2.id, q.id]);
    const actions = ((audit ?? []) as Row[]).map((a) => `${a.action}:${a.entity_id}`);
    expect(actions).toEqual(expect.arrayContaining([`job_file_deleted:${v1.id}`, `job_file_deleted:${v2.id}`, `quote_deleted:${q.id}`]));
  }, 60_000);

  it("odeslaná nabídka: smazat nejde v Nabídkách ani přes její PDF v Dokumentech; archivace ano", async () => {
    const jobId = await newJob();
    const q = await approvedQuote(jobId);
    const v1 = await pdf(jobId, q.id);
    const { error } = await svc.from("quotes").update({ status: "odeslano" }).eq("id", q.id);
    expect(error).toBeNull();
    expect((await quote(q.id))?.sent_at).toBeTruthy();

    as("admin");
    const dq = await jobs.deleteJobQuote(q.id);
    expect(dq.ok).toBe(false);
    expect(dq.error).toBe(QUOTE_SENT_DELETE_BLOCK);
    const df = await files.deleteJobFile(v1.id);
    expect(df.ok).toBe(false);
    expect(df.error).toBe(`PDF nabídky ${q.number} nejde smazat — nabídka už byla zákazníkovi odeslána. Archivuj ho, nebo vystav novou verzi.`);
    expect(await quote(q.id)).not.toBeNull();
    expect(await file(v1.id)).not.toBeNull();
    expect(await stored(v1.path)).toBe(true);
    // archivovat PDF jde dál
    const arch = await files.setJobFileArchived(v1.id, true);
    expect(arch.ok, arch.error).toBe(true);
    expect(await file(v1.id)).toMatchObject({ archived: true });
  }, 60_000);

  it("bez práva „delete“ (obchodník) se nic nesmaže", async () => {
    const jobId = await newJob();
    const q = await approvedQuote(jobId);
    const v1 = await pdf(jobId, q.id);
    as("sales");
    expect((await files.deleteJobFile(v1.id)).error).toContain("oprávnění");
    expect((await jobs.deleteJobQuote(q.id)).error).toContain("oprávnění");
    expect(await quote(q.id)).not.toBeNull();
    expect(await file(v1.id)).not.toBeNull();
  }, 60_000);
});
