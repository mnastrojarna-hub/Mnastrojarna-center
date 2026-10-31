import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * #25 Schvalování nabídek super adminem — serverové akce proti lokálnímu Supabase (skutečný PostgREST,
 * klient nese hlavičky autora jako produkční server.ts, oprávnění podle skutečné matice rolí; mockuje se
 * jen přihlášení a revalidace). Nabídka obchodníka / zaměstnance = „Neschválená" → schválí jen super
 * admin (otisk obsahu, optimistický zámek), vrácení k přepracování, PDF k odeslání až po schválení,
 * odeslání jen vystaveného PDF po posledním schválení, upozornění super adminům (1× za 30 min).
 * 25-B: „moje" (nabídky, dokumenty, objednávky dodavatelům), zámky obsahu dokumentů, odznaky a fronta
 * „Ke schválení", obchodník zakázky, provize cizí zakázky, zakázka z e-mailu. Vlastní zakázky Z-E2E-QAPPR-*.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/app/actions/quote-admin-approval.integration.test.ts
 */

const ENABLED = process.env.LOCAL_SUPABASE === "1";
const TAG = Date.now().toString(36);
const PREFIX = `Z-E2E-QAPPR-${TAG}`;
const CUSTOMER = "d2000000-0000-0000-0000-000000000001";
const OTHER_CUSTOMER = "d2000000-0000-0000-0000-000000000002";
const MAIL_TO = `e2e-qappr-${TAG}@local.test`;

// free / freeWorker / toggle = vlastní účty testu „schvalování per uživatel" (31. 10.)
type Who = "sales" | "worker" | "admin" | "free" | "freeWorker" | "toggle";
const who = vi.hoisted(() => ({
  users: {} as Record<string, {
    id: string; email: string; fullName: string; role: "super_admin" | "obchodnik" | "zamestnanec"; quoteNeedsApproval?: boolean;
  }>,
  current: "sales" as string,
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
type Row = Record<string, unknown>;

describe.skipIf(!ENABLED)("#25 schvalování nabídek super adminem ↔ lokální Supabase", () => {
  let svc: SupabaseClient;
  let flow: Flow;
  let jobs: Jobs;
  let docs: Docs;
  const jobIds: string[] = [];
  const customerIds: string[] = [];
  let n = 0;
  const startedAt = new Date(Date.now() - 1000).toISOString();

  const as = (u: Who) => { who.current = u; };
  const id = (u: Who) => who.users[u].id;

  async function newJob(patch: Row = {}): Promise<string> {
    n += 1;
    const { data, error } = await svc.from("orders").insert({
      number: `${PREFIX}-${n}`, title: `Schvalování ${n}`, source: "manual", status: "naceneni", inquiry_date: "2026-10-20",
      customer_id: CUSTOMER, customer_contact_email: MAIL_TO, owner_id: id("sales"), ...patch,
    }).select("id").single();
    if (error) throw new Error(error.message);
    jobIds.push((data as { id: string }).id);
    return (data as { id: string }).id;
  }

  /** Nabídka přes akci createJobQuote jako aktuální uživatel. */
  async function createQuote(jobId: string, price: number | null = 1000): Promise<{ id: string; number: string; needsApproval?: boolean }> {
    const r = await jobs.createJobQuote(jobId, {
      title: "Hřídel", validUntil: "2099-01-01", leadTimeDays: 14,
      items: [{ drawingNumber: `QA-${TAG}`, name: "Hřídel", quantity: 2, unitPrice: price ?? undefined }],
    });
    expect(r.ok, r.error).toBe(true);
    return { id: r.id!, number: r.number!, needsApproval: r.needsApproval };
  }
  async function q(quoteId: string): Promise<Row> {
    return (await svc.from("quotes").select("*").eq("id", quoteId).single()).data as Row;
  }
  async function events(jobId: string): Promise<string[]> {
    const { data } = await svc.from("job_events").select("message").eq("job_id", jobId).eq("type", "quote").order("created_at");
    return ((data ?? []) as { message: string }[]).map((e) => e.message);
  }
  async function quoteInput(quoteId: string, patch: Row = {}) {
    const row = await q(quoteId);
    const { data: items } = await svc.from("quote_items").select("*").eq("quote_id", quoteId).order("position");
    return {
      title: String(row.title ?? ""), validUntil: (row.valid_until as string | null) ?? undefined, leadTimeDays: (row.lead_time_days as number | null) ?? undefined,
      items: ((items ?? []) as Row[]).map((i) => ({
        drawingNumber: (i.drawing_number as string | null) ?? undefined, name: String(i.name ?? ""), quantity: Number(i.quantity),
        unitPrice: i.unit_price === null ? undefined : Number(i.unit_price),
      })),
      ...patch,
    };
  }
  async function draftAndSend(jobId: string, fileId: string) {
    const draft = await docs.draftJobDocumentEmail(jobId, fileId);
    expect(draft.ok, draft.error).toBe(true);
    return docs.sendJobDocument(jobId, fileId, { to: MAIL_TO, subject: draft.subject!, body: draft.body! });
  }
  async function badge(user: "sales" | "admin"): Promise<Row> {
    const { data, error } = await svc.rpc("flow_badge_counts", { p_mine: user === "admin" ? null : id(user) });
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[])[0];
  }

  beforeAll(async () => {
    const local = await import("@/test/local-supabase");
    const env = local.loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    svc = local.localAdmin();
    const { data } = await svc.from("profiles").select("id, email, full_name, role").in("email", [local.DEMO.sales.email, local.DEMO.worker.email, local.DEMO.admin.email]);
    for (const r of (data ?? []) as { id: string; email: string; full_name: string; role: "super_admin" | "obchodnik" | "zamestnanec" }[]) {
      const key = r.role === "super_admin" ? "admin" : r.role === "obchodnik" ? "sales" : "worker";
      who.users[key] = { id: r.id, email: r.email, fullName: r.full_name, role: r.role };
    }
    expect(Object.keys(who.users).sort()).toEqual(["admin", "sales", "worker"]);
    flow = await import("@/app/actions/flow-status");
    jobs = await import("@/app/actions/jobs");
    docs = await import("@/app/actions/job-documents");
  }, 60_000);

  afterAll(async () => {
    if (!svc) return;
    if (jobIds.length) {
      const { data: files } = await svc.from("job_files").select("storage_path").in("job_id", jobIds);
      const paths = ((files ?? []) as { storage_path: string }[]).map((f) => f.storage_path);
      if (paths.length) await svc.storage.from("job-files").remove(paths);
      await svc.from("job_files").delete().in("job_id", jobIds);
      await svc.from("emails").delete().in("order_id", jobIds);
      await svc.from("job_events").delete().in("job_id", jobIds);
      await svc.from("quotes").delete().in("job_id", jobIds);
      await svc.from("orders").delete().in("id", jobIds);
      await svc.from("audit_log").delete().in("entity_id", jobIds);
      await svc.from("audit_log").delete().in("diff->>jobId", jobIds);
    }
    if (customerIds.length) {
      await svc.from("audit_log").delete().in("entity_id", customerIds);
      await svc.from("customers").delete().in("id", customerIds);
    }
    await svc.from("audit_log").delete().eq("action", "quote_approval_notice").gte("created_at", startedAt);
  }, 60_000);

  it("nabídka obchodníka = Neschválená + událost; super adminům odejde upozornění nejvýš 1× za 30 min", async () => {
    // čisté okno throttlingu pro tento test
    await svc.from("audit_log").delete().eq("action", "quote_approval_notice").eq("entity_id", id("admin"))
      .gte("created_at", new Date(Date.now() - 31 * 60_000).toISOString());
    const jobId = await newJob();
    as("sales");
    const first = await createQuote(jobId);
    expect(first.needsApproval).toBe(true);
    expect(await q(first.id)).toMatchObject({ state: "ke_schvaleni", admin_approval_required: true, approved_by: null });
    expect(await events(jobId)).toContain(`Nabídka ${first.number} vytvořena — čeká na schválení super admina`);
    const second = await createQuote(jobId);
    expect(second.needsApproval).toBe(true);

    const { data: notices } = await svc.from("audit_log").select("entity_id, diff").eq("action", "quote_approval_notice")
      .eq("entity_id", id("admin")).gte("created_at", startedAt);
    expect(notices ?? []).toHaveLength(1);
    expect(((notices ?? [])[0] as Row).diff).toMatchObject({ quoteId: first.id });
    const api = (await import("@/test/local-supabase")).loadLocalEnv().LOCAL_MAIL_API ?? "http://127.0.0.1:54324";
    const msg = await (await fetch(`${api}/messages/latest?to=${encodeURIComponent(who.users.admin.email)}&wait=3000`)).json();
    expect(String(msg.subject)).toContain(`Ke schválení: nabídka ${first.number}`);

    // nabídka super admina schválení nepotřebuje a nikoho neupozorňuje
    as("admin");
    const own = await createQuote(jobId);
    expect(own.needsApproval).toBe(false);
    expect((await q(own.id)).state).toBe("rozpracovana");
  }, 60_000);

  it("schválit smí jen super admin; otisk obsahu; zastaralé updated_at a nabídka bez ceny neprojdou", async () => {
    const jobId = await newJob();
    as("sales");
    const quote = await createQuote(jobId);
    expect((await flow.setQuoteState(quote.id, "schvalena")).error).toBe("Nabídku schvaluje jen super admin.");
    expect((await flow.approveAndSendQuote(quote.id)).error).toBe("K této akci nemáš oprávnění.");
    expect((await jobs.approveJobQuote(quote.id)).error).toBe("K této akci nemáš oprávnění.");
    expect((await flow.setQuoteState(quote.id, "ke_schvaleni")).error).toContain("předávat je není potřeba");
    expect((await flow.setQuoteState(quote.id, "rozpracovana")).error).toContain("Neschválenou nabídku nejde vrátit mezi rozpracované");

    as("admin");
    expect((await flow.setQuoteState(quote.id, "schvalena", { expectedUpdatedAt: "2000-01-01T00:00:00Z" })).error)
      .toBe("Nabídku mezitím někdo upravil — zkontroluj ji a schval znovu.");
    const fresh = await q(quote.id);
    const ok = await flow.setQuoteState(quote.id, "schvalena", { expectedUpdatedAt: String(fresh.updated_at) });
    expect(ok).toMatchObject({ ok: true, quoteState: "schvalena" });
    const approved = await q(quote.id);
    expect(approved).toMatchObject({ approved_by: id("admin"), state: "schvalena" });
    expect(String(approved.approved_snapshot_sha)).toMatch(/^[0-9a-f]{64}$/);
    expect((await events(jobId)).at(-1)).toBe(`Nabídka ${quote.number} schválena — připravil(a) ${who.users.sales.fullName}`);

    // nabídka s položkou bez ceny
    as("sales");
    const unpriced = await createQuote(jobId, null);
    as("admin");
    expect((await flow.setQuoteState(unpriced.id, "schvalena")).error).toBe("Nabídku s položkou bez ceny nejde schválit — autor musí doplnit ceny.");
  }, 60_000);

  it("vrátit k přepracování: důvod povinný, autor ho vidí v odznaku; jeho úprava vrácení zruší", async () => {
    const jobId = await newJob();
    as("sales");
    const quote = await createQuote(jobId);
    expect((await flow.returnQuoteToAuthor(quote.id, "doplň termín")).error).toBe("K této akci nemáš oprávnění.");
    const before = Number((await badge("sales")).quotes_returned);
    const pendingBefore = Number((await badge("admin")).quotes_pending);
    as("admin");
    expect((await flow.returnQuoteToAuthor(quote.id, "x")).error).toBe("Napiš, co má autor upravit.");
    expect(await flow.returnQuoteToAuthor(quote.id, "doplň termín dodání")).toMatchObject({ ok: true, quoteState: "ke_schvaleni" });
    expect(await q(quote.id)).toMatchObject({ approval_return_note: "doplň termín dodání", approval_returned_by: id("admin") });
    expect((await events(jobId)).at(-1)).toBe(`Nabídka ${quote.number} vrácena autorovi k přepracování — doplň termín dodání`);
    expect(Number((await badge("sales")).quotes_returned)).toBe(before + 1);
    expect(Number((await badge("admin")).quotes_pending)).toBe(pendingBefore - 1);
    expect((await flow.returnQuoteToAuthor(quote.id, "znovu")).error).toContain("už je vrácená");

    as("sales");
    const upd = await jobs.updateJobQuote(quote.id, await quoteInput(quote.id, { leadTimeDays: 21 }));
    expect(upd.ok, upd.error).toBe(true);
    expect(await q(quote.id)).toMatchObject({ approval_returned_at: null, approval_return_note: null, state: "ke_schvaleni" });
    expect(Number((await badge("sales")).quotes_returned)).toBe(before);
  }, 60_000);

  it("PDF k odeslání až po schválení; poznámku ne-admin nedopíše; změna zakázky po schválení schválení zruší (admin přerazí)", async () => {
    const jobId = await newJob();
    as("sales");
    const quote = await createQuote(jobId);
    const blocked = await docs.generateJobDocument(jobId, "nabidka", { quoteId: quote.id });
    expect(blocked).toMatchObject({ ok: false, code: "approval" });
    expect(blocked.error).toContain("PDF k odeslání vystavíš až po schválení");
    as("admin");
    const adminBlocked = await docs.generateJobDocument(jobId, "nabidka", { quoteId: quote.id });
    expect(adminBlocked.error).toBe("Nabídka zatím není schválená — nejdřív ji schval, pak vystav PDF.");
    expect((await flow.setQuoteState(quote.id, "schvalena")).ok).toBe(true);

    as("sales");
    expect((await docs.generateJobDocument(jobId, "nabidka", { quoteId: quote.id, note: "sleva 5 %" })).error)
      .toBe("Poznámku k nabídce dopiš v úpravě nabídky — změnu pak schválí super admin.");
    const pdf = await docs.generateJobDocument(jobId, "nabidka", { quoteId: quote.id });
    expect(pdf.ok, pdf.error).toBe(true);
    const { data: file } = await svc.from("job_files").select("origin, quote_id, issuer").eq("id", pdf.fileId!).single();
    expect(file).toMatchObject({ origin: "generated", quote_id: quote.id, issuer: "my" });

    // zákazník zakázky se po schválení změnil → obchodník PDF nevystaví a schválení se zruší
    await svc.from("orders").update({ customer_id: OTHER_CUSTOMER }).eq("id", jobId);
    const reset = await docs.generateJobDocument(jobId, "nabidka", { quoteId: quote.id });
    expect(reset).toMatchObject({ ok: false, code: "approval" });
    expect(reset.error).toContain("schválení se zrušilo");
    expect(await q(quote.id)).toMatchObject({ approved_by: null, state: "ke_schvaleni" });
    expect((await events(jobId)).at(-1)).toBe(`Schválení nabídky ${quote.number} zrušeno — od schválení se změnily údaje zakázky.`);

    // super admin schválí znovu, zakázka se změní zpět a PDF vystaví on → otisk se přerazí
    as("admin");
    expect((await flow.setQuoteState(quote.id, "schvalena")).ok).toBe(true);
    const sha1 = (await q(quote.id)).approved_snapshot_sha;
    await svc.from("orders").update({ customer_id: CUSTOMER }).eq("id", jobId);
    const adminPdf = await docs.generateJobDocument(jobId, "nabidka", { quoteId: quote.id });
    expect(adminPdf.ok, adminPdf.error).toBe(true);
    const after = await q(quote.id);
    expect(after.approved_by).toBe(id("admin"));
    expect(after.approved_snapshot_sha).not.toBe(sha1);
  }, 90_000);

  it("odeslání: jen vystavené PDF po posledním schválení; nahraný soubor nabídky ne; zaměstnanec-autor po schválení ano, cizí ne", async () => {
    const jobId = await newJob();
    as("sales");
    const quote = await createQuote(jobId);
    as("admin");
    expect((await flow.setQuoteState(quote.id, "schvalena")).ok).toBe(true);
    as("sales");
    const oldPdf = await docs.generateJobDocument(jobId, "nabidka", { quoteId: quote.id });
    expect(oldPdf.ok, oldPdf.error).toBe(true);

    // super admin upraví schválenou nabídku → nové schválení, staré PDF neplatí
    as("admin");
    await new Promise((r) => setTimeout(r, 20));
    const adminEdit = await jobs.updateJobQuote(quote.id, await quoteInput(quote.id, { title: "Hřídel (upraveno)" }));
    expect(adminEdit.ok, adminEdit.error).toBe(true);
    expect(await q(quote.id)).toMatchObject({ state: "schvalena", approved_by: id("admin") });
    expect((await events(jobId)).at(-1)).toBe(`Nabídka ${quote.number} upravena a znovu schválena`);
    as("sales");
    expect((await draftAndSend(jobId, oldPdf.fileId!)).error).toBe("Toto PDF vzniklo před posledním schválením — vystav nové PDF nabídky a odešli ho.");

    // nahraný soubor nabídky (ne vystavený serverem) obchodník neodešle
    const { data: up, error: upErr } = await svc.from("job_files").insert({
      job_id: jobId, kind: "nabidka", quote_id: quote.id, filename: "nabidka-rucne.pdf", storage_path: `${jobId}/nabidka-rucne-${TAG}.pdf`,
      origin: "upload", issuer: "my", uploaded_by: id("sales"),
    }).select("id").single();
    if (upErr) throw new Error(upErr.message);
    const uploaded = await docs.sendJobDocument(jobId, (up as { id: string }).id, { to: MAIL_TO, subject: "Nabídka", body: "Dobrý den" });
    expect(uploaded.error).toBe("Nabídku posílej z vystaveného PDF (záložka Nabídky) — nahraný soubor nabídky odešle jen super admin.");

    const pdf = await docs.generateJobDocument(jobId, "nabidka", { quoteId: quote.id });
    expect(pdf.ok, pdf.error).toBe(true);
    expect(pdf.fileId).not.toBe(oldPdf.fileId);
    const sent = await draftAndSend(jobId, pdf.fileId!);
    expect(sent.ok, sent.error).toBe(true);
    expect(await q(quote.id)).toMatchObject({ state: "odeslana", sent_via: "email", sent_by: id("sales") });

    // zaměstnanec: svou schválenou nabídku odešle (jinak než e-mailem), cizí ne
    const wJob = await newJob({ owner_id: id("admin") });
    as("worker");
    const wq = await createQuote(wJob);
    expect(wq.needsApproval).toBe(true);
    as("sales");
    const sq = await createQuote(wJob);
    as("admin");
    expect((await flow.setQuoteState(wq.id, "schvalena")).ok).toBe(true);
    expect((await flow.setQuoteState(sq.id, "schvalena")).ok).toBe(true);
    as("worker");
    expect((await flow.setQuoteState(sq.id, "odeslana", { note: "osobně" })).error)
      .toBe("Nabídku zákazníkovi odesílá obchodník, super admin, nebo autor schválené nabídky.");
    expect((await jobs.markJobQuoteSent(sq.id)).error).toBe("Nabídku zákazníkovi odesílá obchodník, super admin, nebo autor schválené nabídky.");
    as("admin");
    const sqPdf = await docs.generateJobDocument(wJob, "nabidka", { quoteId: sq.id });
    expect(sqPdf.ok, sqPdf.error).toBe(true);
    as("worker");
    expect((await docs.sendJobDocument(wJob, sqPdf.fileId!, { to: MAIL_TO, subject: "Nabídka", body: "Dobrý den" })).error)
      .toBe("Nabídku zákazníkovi odesílá obchodník, super admin, nebo autor schválené nabídky.");
    expect(await flow.setQuoteState(wq.id, "odeslana", { note: "předáno osobně" })).toMatchObject({ ok: true, quoteState: "odeslana" });
    expect(await q(wq.id)).toMatchObject({ sent_by: id("worker"), state: "odeslana" });
  }, 120_000);

  it("soubor „od dodavatele“ navázaný na naši nabídku se jako naše nabídka neodešle (ani ji neoznačí odeslanou)", async () => {
    const jobId = await newJob();
    as("sales");
    const quote = await createQuote(jobId);
    as("admin");
    expect((await flow.setQuoteState(quote.id, "schvalena")).ok).toBe(true);
    as("sales");
    // akce registerJobFile vazbu dodavatel + naše nabídka odmítne
    const filesAct = await import("@/app/actions/job-files");
    const reg = await filesAct.registerJobFile({
      jobId, path: `${jobId}/podvrh-${TAG}.pdf`, filename: "podvrh.pdf", kind: "nabidka", quoteId: quote.id, issuer: "dodavatel",
    });
    expect(reg.error).toBe("Nabídka dodavatele nepatří k naší nabídce.");
    // stejný řádek vložený přímo (REST) → odeslání ho bere jako nahraný soubor naší nabídky
    const { data: up, error: upErr } = await svc.from("job_files").insert({
      job_id: jobId, kind: "nabidka", quote_id: quote.id, filename: "podvrh.pdf", storage_path: `${jobId}/podvrh-${TAG}.pdf`,
      origin: "upload", issuer: "dodavatel", uploaded_by: id("sales"),
    }).select("id").single();
    if (upErr) throw new Error(upErr.message);
    const res = await docs.sendJobDocument(jobId, (up as { id: string }).id, { to: MAIL_TO, subject: "Nabídka", body: "Dobrý den" });
    expect(res.error).toBe("Nabídku posílej z vystaveného PDF (záložka Nabídky) — nahraný soubor nabídky odešle jen super admin.");
    expect((await q(quote.id)).state).toBe("schvalena");
    const { data: sentEv } = await svc.from("job_events").select("id").eq("job_id", jobId).eq("type", "email");
    expect(sentEv ?? []).toEqual([]);
  }, 60_000);

  it("otisk se hlídá podle stavu, ne podle sent_at (podvržené „odesláno“ u neodeslané nabídky nepomůže)", async () => {
    const jobId = await newJob();
    as("sales");
    const quote = await createQuote(jobId);
    as("admin");
    expect((await flow.setQuoteState(quote.id, "schvalena")).ok).toBe(true);
    // servisní zápis sent_at bez odeslání (REST session ho už nepřepíše — test DB)
    await svc.from("quotes").update({ sent_at: new Date().toISOString() }).eq("id", quote.id);
    expect(await q(quote.id)).toMatchObject({ state: "schvalena" });
    await svc.from("orders").update({ customer_id: OTHER_CUSTOMER }).eq("id", jobId);
    as("sales");
    const reset = await docs.generateJobDocument(jobId, "nabidka", { quoteId: quote.id });
    expect(reset).toMatchObject({ ok: false, code: "approval" });
    expect(reset.error).toContain("schválení se zrušilo");
    expect(await q(quote.id)).toMatchObject({ approved_by: null, state: "ke_schvaleni" });
  }, 60_000);

  it("fronta: „Schválit“ u AI nabídky schválené jinde řádek jen vyřídí; řádek k ne-AI nabídce nabídku neschválí", async () => {
    const approvals = await import("@/app/actions/approvals");
    const jobId = await newJob();
    const mkAi = async () => {
      n += 1;
      const { data, error } = await svc.from("quotes").insert({
        number: `NAB-E2E-QAPPR-${TAG}-${n}`, job_id: jobId, status: "navrh_ai", total: 100, ai_generated: true, valid_until: "2099-01-01",
      }).select("id, state").single();
      if (error) throw new Error(error.message);
      const qid = (data as { id: string }).id;
      await svc.from("quote_items").insert({ quote_id: qid, position: 0, name: "Díl", quantity: 1, unit: "ks", unit_price: 100, vat_rate: 21 });
      return { id: qid, state: (data as { state: string }).state };
    };
    const mkRow = async (quoteId: string) => {
      const { data, error } = await svc.from("approval_queue").insert({
        type: "quote", title: `E2E QAPPR ${TAG}`, payload: {}, quote_id: quoteId, order_id: jobId,
      }).select("id").single();
      if (error) throw new Error(error.message);
      return (data as { id: string }).id;
    };
    const ai = await mkAi();
    if (ai.state !== "ke_schvaleni") return;   // automatizace nabídek „plná“ — není co schvalovat
    const row = await mkRow(ai.id);
    try {
      as("admin");
      expect((await flow.setQuoteState(ai.id, "schvalena")).ok).toBe(true);
      expect(await approvals.resolveApproval(row, "approved")).toMatchObject({ ok: true });
      expect(((await svc.from("approval_queue").select("status").eq("id", row).single()).data as Row).status).toBe("approved");
      expect(await q(ai.id)).toMatchObject({ state: "schvalena", approved_by: id("admin") });

      // řádek přepsaný na ne-AI nabídku (obchodníkova) → nabídku neschválí
      as("sales");
      const salesQ = await createQuote(jobId);
      const bad = await mkRow(salesQ.id);
      as("admin");
      expect((await approvals.resolveApproval(bad, "approved")).error)
        .toBe("Položka fronty neodpovídá AI návrhu nabídky — nabídku schval v záložce Nabídky zakázky.");
      expect(await q(salesQ.id)).toMatchObject({ state: "ke_schvaleni", approved_by: null });
      await svc.from("approval_queue").delete().eq("id", bad);
    } finally {
      await svc.from("approval_queue").delete().eq("id", row);
    }
  }, 60_000);

  it("přijmout / zamítnout jde jen odeslanou nabídku; úprava: ne-admin schválení zruší, odeslanou neupraví", async () => {
    const jobId = await newJob();
    as("sales");
    const quote = await createQuote(jobId);
    expect((await jobs.acceptJobQuote(quote.id)).error).toBe("Nabídka čeká na schválení — přijmout ji lze až po schválení a odeslání.");
    expect((await jobs.rejectJobQuote(quote.id, "drahé")).error).toBe("Zamítnout lze jen odeslanou nabídku.");

    as("admin");
    expect((await flow.setQuoteState(quote.id, "schvalena")).ok).toBe(true);
    as("sales");
    expect((await jobs.acceptJobQuote(quote.id)).error).toBe("Zákazník může přijmout jen odeslanou nabídku.");
    const upd = await jobs.updateJobQuote(quote.id, await quoteInput(quote.id, { leadTimeDays: 30 }));
    expect(upd).toMatchObject({ ok: true, approvalReset: true });
    expect(await q(quote.id)).toMatchObject({ state: "ke_schvaleni", approved_by: null, approved_snapshot_sha: null });
    expect((await events(jobId)).at(-1)).toBe(`Nabídka ${quote.number} upravena (schválení zrušeno — nutno znovu schválit)`);
    // beze změny se nic nepřepisuje (žádné nové schvalování kvůli uložení beze změny)
    as("admin");
    expect((await flow.setQuoteState(quote.id, "schvalena")).ok).toBe(true);
    as("sales");
    const same = await jobs.updateJobQuote(quote.id, await quoteInput(quote.id));
    expect(same).toMatchObject({ ok: true, approvalReset: false });
    expect((await q(quote.id)).state).toBe("schvalena");

    expect((await flow.setQuoteState(quote.id, "odeslana", { note: "osobně" })).ok).toBe(true);
    expect((await jobs.updateJobQuote(quote.id, await quoteInput(quote.id, { leadTimeDays: 7 }))).error)
      .toBe("Odeslanou nabídku nejde upravit — vytvoř novou verzi.");
    expect(await jobs.acceptJobQuote(quote.id)).toMatchObject({ ok: true });
  }, 90_000);

  // ═══ 25-B: „moje", nákupní doklady, obchodník zakázky ═══
  const PRICE_VIEW = "Nákupní doklad vidí obchodník a super admin.";
  const PRICE_SEND = "Nákupní doklad posílá obchodník nebo super admin.";

  async function storedFile(jobId: string, patch: Row): Promise<string> {
    n += 1;
    const storage = `${jobId}/e2e-qappr-${TAG}-${n}.pdf`;
    const up = await svc.storage.from("job-files").upload(storage, new Blob([Buffer.from("%PDF-1.4 e2e")], { type: "application/pdf" }), { contentType: "application/pdf", upsert: true });
    if (up.error) throw new Error(up.error.message);
    const { data, error } = await svc.from("job_files").insert({
      job_id: jobId, filename: `f-${n}.pdf`, mime_type: "application/pdf", storage_path: storage, origin: "upload", note: `poznámka tajné ${n}`, ...patch,
    }).select("id").single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  }

  it("„moje“: nabídky, dokumenty a objednávky dodavatelům zaměstnance jen jeho; ceny objednávek maskované; nákupní doklad zamčený", async () => {
    const data = await import("@/lib/data/jobs");
    const purchasing = await import("@/lib/data/purchasing");
    const scopeMod = await import("@/lib/data/flow-scope");
    const filesAct = await import("@/app/actions/job-files");
    const mineJob = await newJob({ owner_id: id("admin"), assignee_id: id("worker") });
    const otherJob = await newJob({ owner_id: id("admin") });
    as("admin");
    const qMine = await createQuote(mineJob);
    const qOther = await createQuote(otherJob);
    const draw = await storedFile(mineJob, { kind: "vykres", issuer: "zakaznik" });
    const foreign = await storedFile(otherJob, { kind: "vykres", issuer: "zakaznik" });
    const uploadedByWorker = await storedFile(otherJob, { kind: "foto", uploaded_by: id("worker") });
    const price = await storedFile(mineJob, { kind: "naceneni", issuer: "dodavatel" });
    const poPdf = await storedFile(mineJob, { kind: "objednavka_vydana", issuer: "my", origin: "generated" });
    const poIds: string[] = [];
    const mkPo = async (jobId: string, createdBy: string) => {
      n += 1;
      const { data: po, error } = await svc.from("purchase_orders").insert({
        job_id: jobId, number: `OV-E2E-${TAG}-${n}`, created_by: createdBy, note: "sleva tajné", payment_terms: "tajné splatnost",
        file_id: jobId === mineJob ? poPdf : null,
      }).select("id").single();
      if (error) throw new Error(error.message);
      const poId = (po as { id: string }).id;
      poIds.push(poId);
      await svc.from("purchase_order_items").insert({ purchase_order_id: poId, position: 0, name: "Kalení", quantity: 1, unit: "ks", unit_price: 12345 });
      return poId;
    };
    try {
      const poMine = await mkPo(mineJob, id("admin"));
      const poCreated = await mkPo(otherJob, id("worker"));
      const poForeign = await mkPo(otherJob, id("admin"));

      as("worker");
      const scope = await scopeMod.getFlowScope();
      expect(scope).toMatchObject({ all: false, error: false, userId: id("worker") });
      expect(scope!.jobIds.has(mineJob)).toBe(true);
      expect(scope!.jobIds.has(otherJob)).toBe(false);

      const quotes = (await data.listQuotes({}, { scope })).map((x) => x.id);
      expect(quotes).toContain(qMine.id);
      expect(quotes).not.toContain(qOther.id);
      // bez rozsahu (Kniha, ⌘K na serveru) všechny
      expect((await data.listQuotes()).map((x) => x.id)).toEqual(expect.arrayContaining([qMine.id, qOther.id]));
      // null rozsah = bez přístupu → nic (fail closed)
      expect(await data.listQuotes({}, { scope: null })).toEqual([]);
      // zakázky stránek toku a jejich stavy jen „moje"; Kniha (bez rozsahu) všechny
      const jobList = (await data.listJobs({}, { scope })).map((j) => j.id);
      expect(jobList).toContain(mineJob);
      expect(jobList).not.toContain(otherJob);
      expect((await data.listJobs({ q: PREFIX })).map((j) => j.id)).toEqual(expect.arrayContaining([mineJob, otherJob]));
      expect(await data.listJobs({}, { scope: { ...scope!, error: true } })).toEqual([]);
      const pages = await import("@/lib/data/flow-pages");
      const states = await pages.listFlowStateJobIds([{ phase: "inquiry", keys: ["prijata", "v_reseni", "ceka_na_podklady", "zpracovana"] }], { scope });
      expect(states?.has(otherJob)).toBe(false);

      const files = await data.listJobFiles({ includeArchived: true, limit: 2000 }, { scope });
      const ids = files.map((f) => f.id);
      expect(ids).toEqual(expect.arrayContaining([draw, uploadedByWorker, price, poPdf]));
      expect(ids).not.toContain(foreign);
      const locked = files.find((f) => f.id === price)!;
      expect(locked).toMatchObject({ locked: "price", note: null, hasAiData: false, kind: "naceneni" });
      expect(files.find((f) => f.id === poPdf)?.locked).toBe("price");
      expect(files.find((f) => f.id === draw)?.locked ?? null).toBeNull();
      // detail zakázky: řádek zůstane, obsah zamčený
      expect((await data.getJob(mineJob))?.files.find((f) => f.id === price)?.locked).toBe("price");

      const pos = await purchasing.listPurchaseOrders({}, { scope });
      // sdílená lokální DB: jiné běhy můžou mít další „moje“ objednávky dílny — hlídáme jen svoje fixtures
      const poIds = [poMine, poCreated, poForeign];
      expect(pos.filter((p) => poIds.includes(p.id)).map((p) => p.id).sort()).toEqual([poMine, poCreated].sort());
      expect(pos.every((p) => p.pricesHidden === true && p.total === 0 && p.fileId === null)).toBe(true);
      const json = JSON.stringify(pos);
      expect(json).not.toContain("12345");
      expect(json).not.toContain("tajné");
      expect(poForeign).toBeTruthy();

      // obsah nákupního dokladu: náhled, stažení, odeslání ne
      expect((await filesAct.getJobFileUrl(price)).error).toBe(PRICE_VIEW);
      expect((await filesAct.getJobFileUrl(draw)).ok).toBe(true);
      expect((await docs.draftJobDocumentEmail(mineJob, poPdf)).error).toBe(PRICE_SEND);
      expect((await docs.sendJobDocument(mineJob, poPdf, { to: MAIL_TO, subject: "Objednávka", body: "Dobrý den" })).error).toBe(PRICE_SEND);
      // úpravy: druh vystaveného dokladu nikdo; nákupní druh jen s marží; nákupní doklad ani archivovat
      expect((await filesAct.updateJobFile(draw, { kind: "nabidka" })).error).toBe("Druh nákupního dokladu mění obchodník nebo super admin.");
      expect((await filesAct.setJobFileArchived(price, true)).error).toBe(PRICE_VIEW);
      expect((await filesAct.updateJobFile(draw, { title: "Výkres hřídele" })).ok).toBe(true);

      as("sales");
      expect((await filesAct.getJobFileUrl(price)).ok).toBe(true);
      expect((await filesAct.updateJobFile(poPdf, { kind: "ostatni" })).error).toBe("Druh vystaveného dokladu nejde změnit.");
      const salesScope = await scopeMod.getFlowScope();
      const salesPos = await purchasing.listPurchaseOrders({}, { scope: salesScope });
      // obchodník: jen svoje (tyto tři jsou zakázky admina / dílny), bez maskování
      expect(salesPos.map((p) => p.id)).not.toEqual(expect.arrayContaining([poMine]));
      expect(salesPos.every((p) => !p.pricesHidden)).toBe(true);

      as("admin");
      const adminScope = await scopeMod.getFlowScope();
      expect(adminScope).toMatchObject({ all: true, canToggle: true });
      expect((await purchasing.listPurchaseOrders({}, { scope: adminScope })).map((p) => p.id)).toEqual(expect.arrayContaining([poMine, poCreated, poForeign]));
      const adminMine = await scopeMod.getFlowScope("moje");
      expect(adminMine).toMatchObject({ all: false, who: "moje", canToggle: true });
      expect(adminMine!.jobIds.has(otherJob)).toBe(true);
    } finally {
      await svc.from("purchase_orders").delete().in("id", poIds);
    }
  }, 120_000);

  it("PDF naší nabídky: čekající na schválení / před posledním schválením zamčené (super admin smí)", async () => {
    const filesAct = await import("@/app/actions/job-files");
    const data = await import("@/lib/data/jobs");
    const jobId = await newJob();
    as("sales");
    const quote = await createQuote(jobId);
    as("admin");
    expect((await flow.setQuoteState(quote.id, "schvalena")).ok).toBe(true);
    as("sales");
    const pdf = await docs.generateJobDocument(jobId, "nabidka", { quoteId: quote.id });
    expect(pdf.ok, pdf.error).toBe(true);
    expect((await filesAct.getJobFileUrl(pdf.fileId!)).ok).toBe(true);
    // úprava obchodníka → schválení zrušeno → PDF „neschválené“
    expect((await jobs.updateJobQuote(quote.id, await quoteInput(quote.id, { leadTimeDays: 40 }))).ok).toBe(true);
    expect((await filesAct.getJobFileUrl(pdf.fileId!)).error).toBe("Nabídka čeká na schválení super admina — stáhni náhled s vodoznakem (‚PDF náhled‘).");
    expect((await data.getJob(jobId))?.files.find((f) => f.id === pdf.fileId)?.locked).toBe("unapproved");
    // znovu schválená → staré PDF „před schválením“
    as("admin");
    await new Promise((r) => setTimeout(r, 20));
    expect((await flow.setQuoteState(quote.id, "schvalena")).ok).toBe(true);
    expect((await filesAct.getJobFileUrl(pdf.fileId!)).ok).toBe(true);
    as("sales");
    expect((await filesAct.getJobFileUrl(pdf.fileId!)).error).toBe("Toto PDF nabídky vzniklo před posledním schválením — vystav nové.");
    expect((await data.getJob(jobId))?.files.find((f) => f.id === pdf.fileId)?.locked).toBe("stale");
  }, 90_000);

  it("odznaky menu podle role; fronta „Ke schválení“ jen super admin, vždy všech", async () => {
    const queries = await import("@/lib/data/queries");
    const jobId = await newJob();
    as("sales");
    const quote = await createQuote(jobId);
    const salesBadge = await badge("sales");
    const sb = await queries.getBadgeCounts();
    expect(sb.quotes).toBe(Number(salesBadge.quotes_ready) + Number(salesBadge.quotes_returned));
    expect(sb.inquiries).toBe(Number(salesBadge.inquiries));
    expect(sb).toMatchObject({ pricing: 0, approvals: 0 });
    expect(await queries.listPendingQuoteApprovals()).toEqual([]);

    as("admin");
    const adminBadge = await badge("admin");
    const ab = await queries.getBadgeCounts();
    expect(ab.quotes).toBe(Number(adminBadge.quotes_pending));
    expect(ab.pricing).toBe(Number(adminBadge.pricing));
    const { count: queued } = await svc.from("approval_queue").select("id", { count: "exact", head: true }).eq("status", "pending");
    // AI přehled = fronta AI + ruční nabídky kolegů (panel „Nabídky ke schválení“, 25-C)
    expect(Number(adminBadge.quotes_pending_manual)).toBeGreaterThanOrEqual(1);
    expect(ab.approvals).toBe((queued ?? 0) + Number(adminBadge.quotes_pending_manual));
    const pending = await queries.listPendingQuoteApprovals();
    expect(pending.find((p) => p.quoteId === quote.id)).toMatchObject({
      number: quote.number, jobId, authorName: who.users.sales.fullName, unpriced: false, total: 2000,
    });
    // vrácená nabídka z fronty zmizí
    expect((await flow.returnQuoteToAuthor(quote.id, "doplň výkres")).ok).toBe(true);
    expect((await queries.listPendingQuoteApprovals()).some((p) => p.quoteId === quote.id)).toBe(false);
  }, 60_000);

  it("obchodník zakázky: jen super admin ho mění; nový ne-admin jen sebe / obchodníka zákazníka; provize cizí zakázky skrytá", async () => {
    const purchasingAct = await import("@/app/actions/purchasing");
    const purchasing = await import("@/lib/data/purchasing");
    const jobId = await newJob({ owner_id: id("admin"), value: 10000 });
    as("sales");
    expect((await jobs.updateJob(jobId, { ownerId: id("sales") })).error).toBe("Obchodníka zakázky mění jen super admin.");
    expect((await purchasingAct.assignJobOwner(jobId, id("sales"))).error).toBe("Obchodníka zakázky mění jen super admin.");
    expect((await jobs.updateJob(jobId, { assigneeId: id("sales") })).ok).toBe(true);
    // nová zakázka: cizí obchodník ne, obchodník zákazníka ano
    expect((await jobs.createJob({ title: `E2E ${TAG} cizí`, ownerId: id("admin") })).error).toBe("Obchodníka zakázky mění jen super admin.");
    as("worker");
    const viaCustomer = await jobs.createJob({ title: `E2E ${TAG} zákazník`, customerId: CUSTOMER, ownerId: id("sales") });
    expect(viaCustomer.ok, viaCustomer.error).toBe(true);
    jobIds.push(viaCustomer.id!);
    expect((await svc.from("orders").select("owner_id, created_by").eq("id", viaCustomer.id!).single()).data).toMatchObject({ owner_id: id("sales"), created_by: id("worker") });
    as("admin");
    expect((await jobs.updateJob(jobId, { ownerId: id("sales") })).ok).toBe(true);
    expect((await svc.from("orders").select("owner_id").eq("id", jobId).single()).data).toMatchObject({ owner_id: id("sales") });

    // provize: cizí (admina) obchodník nevidí, super admin ano
    const other = await newJob({ owner_id: id("admin"), value: 5000 });
    const { data: ce, error } = await svc.from("commission_entries").insert({
      owner_id: id("admin"), order_id: other, period: "2026-10-01", revenue: 5000, commission: 500, rate: 0.1,
    }).select("id").single();
    if (error) throw new Error(error.message);
    try {
      as("sales");
      const view = await purchasing.getJobPurchasing(other);
      expect(view).toMatchObject({ commission: null, commissionHidden: true });
      as("admin");
      const adminView = await purchasing.getJobPurchasing(other);
      expect(adminView?.commission?.ownerId).toBe(id("admin"));
      expect(adminView?.commissionHidden).toBeUndefined();
    } finally {
      await svc.from("commission_entries").delete().eq("id", (ce as { id: string }).id);
    }
  }, 60_000);

  it("nová zakázka: obchodník se hlídá před zápisem; bez volby obchodník zákazníka, zaměstnanec zpracovává; obchodníka zákazníka mění jen super admin", async () => {
    const crm = await import("@/app/actions/crm");
    const { EMPTY_CUSTOMER_FORM } = await import("@/components/customers/model");
    const name = (i: number) => `E2E QAPPR ${TAG} zákazník ${i}`;
    const byName = async (nm: string) => ((await svc.from("customers").select("id, owner_id").eq("name", nm)).data ?? []) as { id: string; owner_id: string | null }[];
    const order = async (jobId: string) => (await svc.from("orders").select("owner_id, assignee_id, created_by").eq("id", jobId).single()).data;
    const ok = (r: { ok: boolean; error?: string; id?: string }) => {
      expect(r.ok, r.error).toBe(true);
      jobIds.push(r.id!);
      return r.id!;
    };

    // cizí obchodník + nový zákazník → odmítnuto a zákazník NEVZNIKNE (dřív zůstal s cizím obchodníkem)
    as("sales");
    expect((await jobs.createJob({ title: `E2E ${TAG} o1`, customerName: name(1), ownerId: id("admin") })).error)
      .toBe("Obchodníka zakázky mění jen super admin.");
    expect(await byName(name(1))).toEqual([]);
    // obchodník bez volby: nový zákazník i zakázka jeho
    const s1 = ok(await jobs.createJob({ title: `E2E ${TAG} o2`, customerName: name(2) }));
    const c2 = await byName(name(2));
    customerIds.push(...c2.map((c) => c.id));
    expect(c2).toMatchObject([{ owner_id: id("sales") }]);
    expect(await order(s1)).toMatchObject({ owner_id: id("sales"), created_by: id("sales") });
    // bez volby u zákazníka jiného obchodníka → Obchodník = obchodník zákazníka (jako e-mail a fotka)
    const adminCust = ((await svc.from("customers").insert({ name: name(3), owner_id: id("admin") }).select("id").single()).data as { id: string }).id;
    customerIds.push(adminCust);
    const s2 = ok(await jobs.createJob({ title: `E2E ${TAG} o3`, customerId: adminCust }));
    expect(await order(s2)).toMatchObject({ owner_id: id("admin"), created_by: id("sales") });

    // zaměstnanec bez volby: nový zákazník bez obchodníka, zakázku zpracovává on (není Obchodník)
    as("worker");
    const w1 = ok(await jobs.createJob({ title: `E2E ${TAG} o4`, customerName: name(4) }));
    const c4 = await byName(name(4));
    customerIds.push(...c4.map((c) => c.id));
    expect(c4).toMatchObject([{ owner_id: null }]);
    expect(await order(w1)).toMatchObject({ owner_id: null, assignee_id: id("worker"), created_by: id("worker") });
    const w2 = ok(await jobs.createJob({ title: `E2E ${TAG} o5`, customerId: adminCust }));
    expect(await order(w2)).toMatchObject({ owner_id: id("admin"), assignee_id: id("worker") });

    // obchodník zákazníka (komu připadnou jeho další zakázky): cizího vybere jen super admin, ne-admin ho nezmění
    as("sales");
    expect((await crm.createCustomer({ ...EMPTY_CUSTOMER_FORM, name: name(5), ownerId: id("admin") })).error)
      .toBe("Obchodníka zákazníka mění jen super admin.");
    expect(await byName(name(5))).toEqual([]);
    const own = await crm.createCustomer({ ...EMPTY_CUSTOMER_FORM, name: name(6), ownerId: id("sales") });
    expect(own.ok, own.error).toBe(true);
    customerIds.push(own.id!);
    expect((await crm.updateCustomer(adminCust, { ...EMPTY_CUSTOMER_FORM, name: name(3), ownerId: id("sales") })).error)
      .toBe("Obchodníka zákazníka mění jen super admin.");
    expect((await crm.updateCustomer(adminCust, { ...EMPTY_CUSTOMER_FORM, name: name(3), ownerId: id("admin"), note: "pozn." })).ok).toBe(true);
    // obchodník zákazníka zůstal → zakázku s jiným (cizím) obchodníkem dál nezaloží
    expect((await jobs.createJob({ title: `E2E ${TAG} o6`, customerId: adminCust, ownerId: id("worker") })).error)
      .toBe("Obchodníka zakázky mění jen super admin.");
    expect((await jobs.createJob({ title: `E2E ${TAG} o7`, customerId: own.id!, ownerId: id("admin") })).error)
      .toBe("Obchodníka zakázky mění jen super admin.");
    as("admin");
    expect((await crm.updateCustomer(own.id!, { ...EMPTY_CUSTOMER_FORM, name: name(6), ownerId: id("admin") })).ok).toBe(true);
    expect((await svc.from("customers").select("owner_id").eq("id", own.id!).single()).data).toMatchObject({ owner_id: id("admin") });

    // 25-C: úprava zakázky s cizím obchodníkem + nový zákazník → odmítnuto DŘÍV, než zákazník vznikne
    const ownerless = await newJob({ owner_id: id("admin") });
    as("sales");
    expect((await jobs.updateJob(ownerless, { ownerId: id("sales"), customerName: name(7) })).error)
      .toBe("Obchodníka zakázky mění jen super admin.");
    expect(await byName(name(7))).toEqual([]);
    // 25-C: zaměstnanec Obchodníkem zákazníka nebude — ani sebe, ani cizího
    as("worker");
    expect((await crm.createCustomer({ ...EMPTY_CUSTOMER_FORM, name: name(8), ownerId: id("sales") })).error)
      .toBe("Obchodníka zákazníka mění jen super admin.");
    expect(await byName(name(8))).toEqual([]);
    const self = await crm.createCustomer({ ...EMPTY_CUSTOMER_FORM, name: name(9), ownerId: id("worker") });
    expect(self.ok, self.error).toBe(true);
    customerIds.push(self.id!);
    expect((await svc.from("customers").select("owner_id").eq("id", self.id!).single()).data).toMatchObject({ owner_id: null });
    as("admin");
  }, 60_000);

  it("přílohy e-mailu v Dokumentech: vystavitel podle e-mailu — doklad dodavatele zamčený, poptávka zákazníka ne; faktura dodavatele jen do Faktur dodavatelů", async () => {
    const mail = await import("@/app/actions/mail");
    const filesAct = await import("@/app/actions/job-files");
    const { data: sup } = await svc.from("suppliers").select("id").limit(1).single();
    const supplierId = (sup as { id: string }).id;
    const stored: string[] = [];
    const mails: string[] = [];
    const mk = async (patch: Row, filename: string) => {
      const { data, error } = await svc.from("emails").insert({
        mailbox_id: "d5000000-0000-0000-0000-000000000001", owner_id: id("sales"), direction: "in", subject: `Příloha E2E ${TAG}`,
        from_email: "x@example.test", received_at: new Date().toISOString(), ...patch,
      }).select("id").single();
      if (error) throw new Error(error.message);
      const emailId = (data as { id: string }).id;
      mails.push(emailId);
      const path = `e2e-qappr/${TAG}/${crypto.randomUUID()}-${filename}`;
      // různý obsah (stejný obsah = duplicita — Pošta B ho do dokumentů zakázky podruhé neuloží)
      const up = await svc.storage.from("documents").upload(path, Buffer.from(`%PDF-1.4 e2e ${TAG} ${filename}`), { contentType: "application/pdf" });
      if (up.error) throw new Error(up.error.message);
      stored.push(path);
      const att = await svc.from("email_attachments").insert({ email_id: emailId, filename, mime_type: "application/pdf", size_bytes: 12, storage_path: path });
      if (att.error) throw new Error(att.error.message);
      return emailId;
    };
    const jobId = await newJob();
    const invoice = await mk({ category: "faktura", supplier_id: supplierId, customer_id: null }, "FV-2026-0042.pdf");
    const offer = await mk({ category: "nabidka_dodavatele", supplier_id: supplierId, customer_id: null }, "Cenova-nabidka-0042.pdf");
    const rfq = await mk({ category: "poptavka", customer_id: CUSTOMER }, "Angebotsanfrage_AeroParts.pdf");
    try {
      as("sales");
      expect((await mail.linkEmailToJob(invoice, jobId)).ok).toBe(true);
      expect((await mail.linkEmailToJob(offer, jobId)).ok).toBe(true);
      expect((await mail.linkEmailToJob(rfq, jobId)).ok).toBe(true);
      const { data: files } = await svc.from("job_files").select("id, filename, kind, issuer, origin").eq("job_id", jobId);
      const f = new Map(((files ?? []) as Row[]).map((r) => [String(r.filename), r]));
      // Pošta B (B5): faktura dodavatele nikdy do dokumentů zakázky — do Faktur dodavatelů (vidí jen super admin)
      expect(f.has("FV-2026-0042.pdf")).toBe(false);
      const { data: inv } = await svc.from("supplier_invoices").select("id, source").eq("email_id", invoice);
      expect(((inv ?? []) as Row[]).map((r) => r.source)).toEqual(["email"]);
      expect(f.get("Cenova-nabidka-0042.pdf")).toMatchObject({ issuer: "dodavatel", origin: "email" });
      expect(f.get("Angebotsanfrage_AeroParts.pdf")).toMatchObject({ kind: "nabidka", issuer: "zakaznik", origin: "email" });
      as("worker");
      expect((await filesAct.getJobFileUrl(String(f.get("Cenova-nabidka-0042.pdf")!.id))).error).toBe("Nákupní doklad vidí obchodník a super admin.");
      const open = await filesAct.getJobFileUrl(String(f.get("Angebotsanfrage_AeroParts.pdf")!.id));
      expect(open.ok, open.error).toBe(true);
    } finally {
      // faktura z e-mailu: počkat na zpracování na pozadí (bez AI → ke kontrole), pak uklidit i soubory
      const invRows = async () => ((await svc.from("supplier_invoices").select("id, status").eq("email_id", invoice)).data ?? []) as { id: string; status: string }[];
      for (let i = 0; i < 40 && (await invRows()).some((r) => r.status === "nahrano"); i++) await new Promise((r) => setTimeout(r, 250));
      const ids = (await invRows()).map((r) => r.id);
      const { data: invFiles } = ids.length ? await svc.from("supplier_invoice_files").select("storage_path").in("invoice_id", ids) : { data: [] };
      const invPaths = ((invFiles ?? []) as { storage_path: string }[]).map((r) => r.storage_path);
      if (invPaths.length) await svc.storage.from("supplier-invoices").remove(invPaths);
      await svc.from("supplier_invoices").delete().eq("email_id", invoice);
      await svc.from("emails").delete().in("id", mails);
      await svc.storage.from("documents").remove(stored);
    }
  }, 60_000);

  it("registerJobFile: zaměstnanec nákupní doklad nenahradí (ani automatickou verzí) a cizí cestu nepřevezme; obchodník ano", async () => {
    const filesAct = await import("@/app/actions/job-files");
    const { jobFilePath } = await import("@/lib/jobs/mapping");
    const jobId = await newJob();
    const p = (nm: string) => jobFilePath(jobId, crypto.randomUUID(), nm);
    const fileRow = async (fileId: string) => (await svc.from("job_files").select("archived, replaced_by, version").eq("id", fileId).single()).data;
    as("admin");
    const pricePath = p("nabidka-dodavatele.pdf");
    const price = await filesAct.registerJobFile({
      jobId, path: pricePath, filename: "nabidka-dodavatele.pdf", kind: "naceneni", issuer: "dodavatel", note: "nákupní cena 123",
    });
    expect(price.ok, price.error).toBe(true);
    const priceId = price.file!.id;

    as("worker");
    expect((await filesAct.registerJobFile({ jobId, path: p("nahrada.pdf"), filename: "nahrada.pdf", replaceFileId: priceId })).error)
      .toBe("Nákupní doklad vidí obchodník a super admin.");
    // stejný název + druh → samostatný dokument (v1), nákupní doklad zůstane nedotčený
    const same = await filesAct.registerJobFile({ jobId, path: p("nabidka-dodavatele.pdf"), filename: "nabidka-dodavatele.pdf", kind: "naceneni" });
    expect(same.ok, same.error).toBe(true);
    expect(await fileRow(same.file!.id)).toMatchObject({ version: 1 });
    expect(await fileRow(priceId)).toMatchObject({ archived: false, replaced_by: null });
    // cesta cizího dokumentu → žádný řádek (ani nemaskovaná poznámka)
    const taken = await filesAct.registerJobFile({ jobId, path: pricePath, filename: "x.pdf" });
    expect(taken.error).toBe("Tento soubor už patří jinému dokumentu.");
    expect(taken.file).toBeUndefined();

    // obchodník (nákupní ceny) nahradit smí
    as("sales");
    const rep = await filesAct.registerJobFile({ jobId, path: p("nabidka-v2.pdf"), filename: "nabidka-v2.pdf", replaceFileId: priceId });
    expect(rep.ok, rep.error).toBe(true);
    expect(await fileRow(rep.file!.id)).toMatchObject({ version: 2 });
    expect(await fileRow(priceId)).toMatchObject({ archived: true, replaced_by: rep.file!.id });
  }, 60_000);

  it("zakázka z e-mailu patří vlastníkovi schránky (obchodník = Obchodník, dílna = Zpracovává)", async () => {
    const mail = await import("@/app/actions/mail");
    const mk = async (mailbox: string, owner: string) => {
      const { data, error } = await svc.from("emails").insert({
        mailbox_id: mailbox, owner_id: owner, direction: "in", subject: `Poptávka E2E ${TAG}`, from_email: "nakup@strojmetal.cz",
        customer_id: CUSTOMER, category: "poptavka", received_at: new Date().toISOString(),
      }).select("id").single();
      if (error) throw new Error(error.message);
      return (data as { id: string }).id;
    };
    const fromSales = await mk("d5000000-0000-0000-0000-000000000001", id("sales"));
    const fromWorker = await mk("d5000000-0000-0000-0000-000000000002", id("worker"));
    try {
      as("admin");
      const a = await mail.createJobFromEmail(fromSales);
      expect(a.ok, a.error).toBe(true);
      jobIds.push(a.id!);
      expect((await svc.from("orders").select("owner_id, assignee_id, created_by").eq("id", a.id!).single()).data)
        .toMatchObject({ owner_id: id("sales"), assignee_id: null, created_by: id("admin") });
      const w = await mail.createJobFromEmail(fromWorker);
      expect(w.ok, w.error).toBe(true);
      jobIds.push(w.id!);
      const { data: cust } = await svc.from("customers").select("owner_id").eq("id", CUSTOMER).single();
      expect((await svc.from("orders").select("owner_id, assignee_id, created_by").eq("id", w.id!).single()).data)
        .toMatchObject({ owner_id: (cust as { owner_id: string | null }).owner_id ?? id("admin"), assignee_id: id("worker"), created_by: id("admin") });
    } finally {
      await svc.from("emails").delete().in("id", [fromSales, fromWorker]);
    }
  }, 60_000);

  // ── 31. 10.: schvalování nabídek PER UŽIVATEL (profiles.quote_needs_approval) ──
  // Vlastní účty (demo účty sdílené DB se nemění): free = obchodník bez schvalování (Volný),
  // freeWorker = zaměstnanec bez schvalování, toggle = obchodník, kterému super admin nastavení přepíná.
  describe("schvalování per uživatel (31. 10.)", () => {
    type Users = typeof import("@/app/actions/users");
    let users: Users;
    const created: string[] = [];
    const QUOTE_SEND_NO_RIGHT = "Nabídku zákazníkovi odesílá obchodník, super admin, nebo autor schválené nabídky.";
    const AWAITS = "Nabídka čeká na schválení — odeslat ji lze až po schválení.";

    async function makeUser(key: Who, role: "obchodnik" | "zamestnanec", needs: boolean): Promise<void> {
      const email = `e2e-qappr-${TAG}-${key.toLowerCase()}@local.test`;
      const { data, error } = await svc.auth.admin.createUser({
        email, password: `Qappr-${TAG}-1!`, email_confirm: true, user_metadata: { full_name: `QAPPR ${key} ${TAG}` },
      });
      if (error || !data.user) throw new Error(error?.message ?? "createUser");
      created.push(data.user.id);
      const { error: pErr } = await svc.from("profiles").update({
        role, full_name: `QAPPR ${key} ${TAG}`, active: true, quote_needs_approval: needs,
      } as never).eq("id", data.user.id);
      if (pErr) throw new Error(pErr.message);
      who.users[key] = { id: data.user.id, email, fullName: `QAPPR ${key} ${TAG}`, role, quoteNeedsApproval: needs };
    }
    async function notices(quoteId: string): Promise<number> {
      const { data } = await svc.from("audit_log").select("id").eq("action", "quote_approval_notice")
        .gte("created_at", startedAt).eq("diff->>quoteId", quoteId);
      return (data ?? []).length;
    }

    beforeAll(async () => {
      users = await import("@/app/actions/users");
      await makeUser("free", "obchodnik", false);
      await makeUser("freeWorker", "zamestnanec", false);
      await makeUser("toggle", "obchodnik", true);
    }, 60_000);

    afterAll(async () => {
      // nabídky a zakázky uklidí vnější afterAll (jobIds); účty až po nich — FK jsou „set null"
      if (!svc) return;
      if (jobIds.length) await svc.from("quotes").delete().in("job_id", jobIds);
      await svc.from("audit_log").delete().in("entity_id", created);
      for (const uid of created) await svc.auth.admin.deleteUser(uid);
      for (const k of ["free", "freeWorker", "toggle"]) delete who.users[k];
    }, 60_000);

    it("DB: quote_author_needs_admin podle profilu; super admin nikdy (i s příznakem)", async () => {
      const needs = async (uid: string) => {
        const { data, error } = await svc.rpc("quote_author_needs_admin", { p_author: uid });
        if (error) throw new Error(error.message);
        return data as boolean;
      };
      expect(await needs(id("free"))).toBe(false);
      expect(await needs(id("freeWorker"))).toBe(false);
      expect(await needs(id("toggle"))).toBe(true);
      expect(await needs(id("sales"))).toBe(true);
      const { data: adm } = await svc.from("profiles").select("quote_needs_approval").eq("id", id("admin")).single();
      expect((adm as { quote_needs_approval: boolean }).quote_needs_approval).toBe(true);
      expect(await needs(id("admin"))).toBe(false);
    });

    it("obchodník bez schvalování: nabídka rovnou k odeslání (bez upozornění adminům), vystaví PDF a odešle ji e-mailem; úprava nic nezamkne", async () => {
      const jobId = await newJob({ owner_id: id("free") });
      as("free");
      const quote = await createQuote(jobId);
      expect(quote.needsApproval).toBe(false);
      expect(await q(quote.id)).toMatchObject({ state: "rozpracovana", admin_approval_required: false, approval_required: false, approved_by: null });
      expect(await events(jobId)).toContain(`Nabídka ${quote.number} vytvořena`);
      const upd = await jobs.updateJobQuote(quote.id, await quoteInput(quote.id, { title: "Hřídel (Volný upravil)" }));
      expect(upd).toMatchObject({ ok: true, approvalReset: false, needsApproval: false });
      expect(await q(quote.id)).toMatchObject({ state: "rozpracovana", admin_approval_required: false });
      const pdf = await docs.generateJobDocument(jobId, "nabidka", { quoteId: quote.id });
      expect(pdf.ok, pdf.error).toBe(true);
      const sent = await draftAndSend(jobId, pdf.fileId!);
      expect(sent.ok, sent.error).toBe(true);
      expect(await q(quote.id)).toMatchObject({ state: "odeslana", sent_via: "email", sent_by: id("free"), approved_by: null });
      expect(await notices(quote.id)).toBe(0);
    }, 120_000);

    it("obchodník se schvalováním (Šponer) dál čeká; uživatel bez schvalování cizí čekající nabídku neodešle a úpravou ji neuvolní", async () => {
      const jobId = await newJob();
      as("sales");
      const pending = await createQuote(jobId);
      expect(pending.needsApproval).toBe(true);
      expect(await q(pending.id)).toMatchObject({ state: "ke_schvaleni", admin_approval_required: true });
      expect((await jobs.markJobQuoteSent(pending.id)).error).toBe(AWAITS);
      as("free");
      expect((await jobs.markJobQuoteSent(pending.id)).error).toBe(AWAITS);
      expect((await flow.setQuoteState(pending.id, "odeslana", { note: "osobně" })).ok).toBe(false);
      const edit = await jobs.updateJobQuote(pending.id, await quoteInput(pending.id, { title: "Hřídel (upravil Volný)" }));
      expect(edit.ok, edit.error).toBe(true);
      expect(await q(pending.id)).toMatchObject({ state: "ke_schvaleni", admin_approval_required: true, approved_by: null });
      // DB pojistka (server s autorem): ani přímý zápis „odesláno" neprojde
      const asFree = (await import("@/test/local-supabase")).localAdmin({ id: id("free"), kind: "user", via: "rucne" });
      const { error } = await asFree.from("quotes").update({ status: "odeslano" } as never).eq("id", pending.id);
      expect(error?.message).toContain("Nabídka čeká na schválení");

      // naopak: uživatel se schvalováním upraví nabídku uživatele bez schvalování → čeká na super admina
      as("free");
      const freeQuote = await createQuote(jobId);
      as("sales");
      const salesEdit = await jobs.updateJobQuote(freeQuote.id, await quoteInput(freeQuote.id, { title: "Hřídel (upravil kolega)" }));
      expect(salesEdit).toMatchObject({ ok: true, needsApproval: true });
      expect(await q(freeQuote.id)).toMatchObject({ state: "ke_schvaleni", admin_approval_required: true });
      // … a když ji pak upraví zase autor bez schvalování, převezme ji (schválení podle autora)
      as("free");
      expect((await jobs.updateJobQuote(freeQuote.id, await quoteInput(freeQuote.id, { title: "Hřídel (zase Volný)" }))).ok).toBe(true);
      expect(await q(freeQuote.id)).toMatchObject({ state: "rozpracovana", admin_approval_required: false });
    }, 120_000);

    it("zaměstnanec bez schvalování odešle svou nabídku sám; cizí (ani rozpracovanou super admina) ne — server i DB", async () => {
      const jobId = await newJob({ owner_id: id("admin") });
      as("freeWorker");
      const own = await createQuote(jobId);
      expect(own.needsApproval).toBe(false);
      expect((await q(own.id)).state).toBe("rozpracovana");
      as("admin");
      const adminQuote = await createQuote(jobId);
      as("freeWorker");
      expect((await jobs.markJobQuoteSent(adminQuote.id)).error).toBe(QUOTE_SEND_NO_RIGHT);
      const asWorker = (await import("@/test/local-supabase")).localAdmin({ id: id("freeWorker"), kind: "user", via: "rucne" });
      const { error } = await asWorker.from("quotes").update({ status: "odeslano" } as never).eq("id", adminQuote.id);
      expect(error?.message).toBe("Schválit, odeslat nebo zamítnout nabídku smí obchodník nebo admin.");
      expect(await flow.setQuoteState(own.id, "odeslana", { note: "předáno osobně" })).toMatchObject({ ok: true, quoteState: "odeslana" });
      expect(await q(own.id)).toMatchObject({ state: "odeslana", sent_by: id("freeWorker") });
      // zaměstnanec se schvalováním (demo dílna) svou nabídku bez schválení dál neodešle
      as("worker");
      const wq = await createQuote(jobId);
      expect(wq.needsApproval).toBe(true);
      expect((await jobs.markJobQuoteSent(wq.id)).error).toBe(AWAITS);
    }, 120_000);

    it("super admin přepne „Nabídky musí schválit super admin“ → přepočet čekajících nabídek (schválené beze změny), audit a atribuce; jiný ho nezmění", async () => {
      const jobId = await newJob({ owner_id: id("toggle") });
      as("toggle");
      const p1 = await createQuote(jobId);
      const p2 = await createQuote(jobId);
      expect(p1.needsApproval && p2.needsApproval).toBe(true);
      as("admin");
      expect((await flow.setQuoteState(p2.id, "schvalena")).ok).toBe(true);

      // obchodník si ho nezmění — ani akcí, ani přímo přes REST (profiles_guard)
      as("sales");
      expect((await users.updateUser(id("toggle"), { quoteNeedsApproval: false })).ok).toBe(false);
      const local = await import("@/test/local-supabase");
      const session = await local.localSession(local.DEMO.sales.email, local.DEMO.sales.password);
      const { error: selfErr } = await session.from("profiles").update({ quote_needs_approval: false } as never).eq("id", id("sales"));
      expect(selfErr?.message).toContain("jen super admin");
      expect((await svc.from("profiles").select("quote_needs_approval").eq("id", id("sales")).single()).data)
        .toMatchObject({ quote_needs_approval: true });

      as("admin");
      const off = await users.updateUser(id("toggle"), { quoteNeedsApproval: false });
      expect(off).toMatchObject({ ok: true, pendingQuotes: { before: 1, after: 0 } });
      who.users.toggle.quoteNeedsApproval = false;
      expect(await q(p1.id)).toMatchObject({ state: "rozpracovana", admin_approval_required: false, approval_required: false });
      expect(await q(p2.id)).toMatchObject({ state: "schvalena", admin_approval_required: true, approved_by: id("admin") });
      const { data: prof } = await svc.from("profiles").select("quote_needs_approval, quote_approval_changed_by, quote_approval_changed_at")
        .eq("id", id("toggle")).single();
      expect(prof).toMatchObject({ quote_needs_approval: false, quote_approval_changed_by: id("admin") });
      expect((prof as { quote_approval_changed_at: string | null }).quote_approval_changed_at).toBeTruthy();
      const { data: audit } = await svc.from("audit_log").select("actor_id, diff").eq("action", "user_updated").eq("entity_id", id("toggle"))
        .order("created_at", { ascending: false }).limit(1);
      expect((audit ?? [])[0]).toMatchObject({ actor_id: id("admin"), diff: { quote_needs_approval: false, pending_quotes: { before: 1, after: 0 } } });
      // historie stavu nabídky nese super admina (přepočet je jeho změna)
      expect((await q(p1.id)).state_changed_by).toBe(id("admin"));

      as("toggle");
      expect((await jobs.markJobQuoteSent(p1.id)).ok).toBe(true);
      expect((await q(p1.id)).state).toBe("odeslana");
      const p3 = await createQuote(jobId);
      expect(p3.needsApproval).toBe(false);

      // zpět na schvalování: neodeslaná rozpracovaná znovu čeká; odeslaná a schválená beze změny
      as("admin");
      const on = await users.updateUser(id("toggle"), { quoteNeedsApproval: true });
      expect(on).toMatchObject({ ok: true, pendingQuotes: { before: 0, after: 1 } });
      who.users.toggle.quoteNeedsApproval = true;
      expect(await q(p3.id)).toMatchObject({ state: "ke_schvaleni", admin_approval_required: true });
      expect((await q(p1.id)).state).toBe("odeslana");
      expect((await q(p2.id)).state).toBe("schvalena");
      as("toggle");
      expect((await jobs.markJobQuoteSent(p3.id)).error).toBe(AWAITS);
      // beze změny = žádný zápis ani přepočet
      as("admin");
      expect(await users.updateUser(id("toggle"), { quoteNeedsApproval: true })).toEqual({ ok: true });
    }, 120_000);

    it("super admin: nastavení se u něj neukládá a jeho nabídky schválení nepotřebují", async () => {
      as("admin");
      const r = await users.updateUser(id("admin"), { quoteNeedsApproval: false });
      expect(r).toEqual({ ok: true });
      expect((await svc.from("profiles").select("quote_needs_approval").eq("id", id("admin")).single()).data)
        .toMatchObject({ quote_needs_approval: true });
      const jobId = await newJob();
      const own = await createQuote(jobId);
      expect(own.needsApproval).toBe(false);
      expect((await q(own.id)).state).toBe("rozpracovana");
    }, 60_000);
  });
});
