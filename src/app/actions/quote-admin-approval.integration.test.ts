import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * #25 Schvalování nabídek super adminem — serverové akce proti lokálnímu Supabase (skutečný PostgREST,
 * klient nese hlavičky autora jako produkční server.ts, oprávnění podle skutečné matice rolí; mockuje se
 * jen přihlášení a revalidace). Nabídka obchodníka / zaměstnance = „Neschválená" → schválí jen super
 * admin (otisk obsahu, optimistický zámek), vrácení k přepracování, PDF k odeslání až po schválení,
 * odeslání jen vystaveného PDF po posledním schválení, upozornění super adminům (1× za 30 min).
 * (Části „moje", nákupní doklady a obchodník zakázky doplňuje 25-B.) Vlastní zakázky Z-E2E-QAPPR-*.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/app/actions/quote-admin-approval.integration.test.ts
 */

const ENABLED = process.env.LOCAL_SUPABASE === "1";
const TAG = Date.now().toString(36);
const PREFIX = `Z-E2E-QAPPR-${TAG}`;
const CUSTOMER = "d2000000-0000-0000-0000-000000000001";
const OTHER_CUSTOMER = "d2000000-0000-0000-0000-000000000002";
const MAIL_TO = `e2e-qappr-${TAG}@local.test`;

const who = vi.hoisted(() => ({
  users: {} as Record<string, { id: string; email: string; fullName: string; role: "super_admin" | "obchodnik" | "zamestnanec" }>,
  current: "sales" as "sales" | "worker" | "admin",
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
  let n = 0;
  const startedAt = new Date(Date.now() - 1000).toISOString();

  const as = (u: "sales" | "worker" | "admin") => { who.current = u; };
  const id = (u: "sales" | "worker" | "admin") => who.users[u].id;

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
});
