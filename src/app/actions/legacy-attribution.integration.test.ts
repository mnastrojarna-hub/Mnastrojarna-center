import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Balík 3 — starší akce, AI / plánovač a audit proti lokálnímu Supabase („kdo to udělal" vždy):
 *  • fronta schvalování: schválení AI nabídky zapíše quotes.approved_by, resolved_by = kdo schválil, souběh odmítne;
 *  • režim automatiky: kontrola práva settings + audit s autorem a změnou z → na;
 *  • limit schválení nabídek: uložení + audit; plánovač toku: návrh „Stažená — Bez odezvy" po 14 dnech,
 *    připomenutí nabídky po 7 dnech do fronty (opakování nic nezdvojí), autor Systém (plánovač);
 *  • ingest pošty: autor ✨ AI (e-mail) za vlastníka schránky / plánovač;
 *  • smazání účtu s historií → odmítnuto (nabídne deaktivaci);
 *  • /settings/audit: filtr osoby, entity a období.
 * Klient nese hlavičky autora jako produkční server.ts. Vlastní data Z-E2E-B3-* / NAB-E2E-B3-*.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/app/actions/legacy-attribution.integration.test.ts
 */

const ENABLED = process.env.LOCAL_SUPABASE === "1";
const TAG = Date.now().toString(36);
const PREFIX = `Z-E2E-B3-${TAG}`;
const startedAt = new Date(Date.now() - 1000).toISOString();

const who = vi.hoisted(() => ({
  users: {} as Record<string, { id: string; email: string; fullName: string; role: "super_admin" | "obchodnik" | "zamestnanec" }>,
  current: "admin" as "sales" | "worker" | "admin",
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

vi.mock("@/lib/settings", async (orig) => ({ ...(await orig<typeof import("@/lib/settings")>()), invalidateSettingsCache: vi.fn() }));

type Row = Record<string, unknown>;

describe.skipIf(!ENABLED)("Balík 3: starší akce, plánovač a audit — autor vždy (lokální Supabase)", () => {
  let svc: SupabaseClient;
  const jobs: string[] = [];
  const queueIds: string[] = [];
  const tempUsers: string[] = [];
  let n = 0;
  let automationBefore: { global: string | null; quote: string | null } = { global: null, quote: null };
  let limitBefore: { value: string | null } | null = null;
  const as = (u: "sales" | "worker" | "admin") => { who.current = u; };
  const id = (u: "sales" | "worker" | "admin") => who.users[u].id;

  async function newJob(patch: Row): Promise<string> {
    n += 1;
    const { data, error } = await svc.from("orders").insert({ number: `${PREFIX}-${n}`, title: `B3 ${n}`, source: "email", inquiry_date: "2026-10-01", ...patch }).select("id").single();
    if (error) throw new Error(error.message);
    jobs.push((data as { id: string }).id);
    return (data as { id: string }).id;
  }

  beforeAll(async () => {
    const { localAdmin, profileId, DEMO } = await import("@/test/local-supabase");
    svc = localAdmin();
    who.users.admin = { id: await profileId(svc, DEMO.admin.email), email: DEMO.admin.email, fullName: "Super Admin", role: "super_admin" };
    who.users.sales = { id: await profileId(svc, DEMO.sales.email), email: DEMO.sales.email, fullName: "Petr Obchodník", role: "obchodnik" };
    who.users.worker = { id: await profileId(svc, DEMO.worker.email), email: DEMO.worker.email, fullName: "Pavel Dílna", role: "zamestnanec" };
    const g = await svc.from("automation_global").select("mode").eq("id", true).maybeSingle();
    const q = await svc.from("automation_settings").select("mode").eq("module", "quote").maybeSingle();
    automationBefore = { global: (g.data as Row | null)?.mode as string ?? null, quote: (q.data as Row | null)?.mode as string ?? null };
    const l = await svc.from("integration_settings").select("value").eq("key", "quote_approval_limit").maybeSingle();
    limitBefore = (l.data as { value: string | null } | null) ?? null;
  }, 60_000);

  afterAll(async () => {
    if (!svc) return;
    if (automationBefore.global) await svc.from("automation_global").update({ mode: automationBefore.global }).eq("id", true);
    if (automationBefore.quote) await svc.from("automation_settings").update({ mode: automationBefore.quote }).eq("module", "quote");
    if (limitBefore) await svc.from("integration_settings").update({ value: limitBefore.value }).eq("key", "quote_approval_limit");
    else await svc.from("integration_settings").delete().eq("key", "quote_approval_limit");
    if (queueIds.length) await svc.from("approval_queue").delete().in("id", queueIds);
    if (jobs.length) {
      await svc.from("approval_queue").delete().in("order_id", jobs);
      await svc.from("quotes").delete().in("job_id", jobs);
      await svc.from("orders").delete().in("id", jobs);
      await svc.from("audit_log").delete().in("entity_id", jobs);
      await svc.from("audit_log").delete().in("diff->>jobId", jobs);
    }
    for (const u of tempUsers) {
      await svc.from("job_events").delete().eq("actor_id", u);
      await svc.auth.admin.deleteUser(u);
      await svc.from("audit_log").delete().eq("entity_id", u);
    }
    await svc.from("audit_log").delete().gte("created_at", startedAt)
      .in("action", ["automation_mode_changed", "settings_updated", "approval_approved", "approval_rejected", "user_deleted"]);
  }, 60_000);

  it("fronta: schválení AI nabídky zapíše approved_by i resolved_by; souběžné druhé vyřízení odmítne; zaměstnanec nesmí", async () => {
    const jobId = await newJob({ status: "naceneni", owner_id: id("sales") });
    const { data: q } = await svc.from("quotes").insert({ job_id: jobId, number: `NAB-E2E-B3-${TAG}`, status: "navrh_ai", ai_generated: true, total: 5000, revision: 1 }).select("id").single();
    const quoteId = (q as { id: string }).id;
    // #25: super admin schválí jen nabídku s položkami a cenami
    await svc.from("quote_items").insert({ quote_id: quoteId, position: 0, name: "Díl", quantity: 1, unit: "ks", unit_price: 5000, vat_rate: 21 });
    const { data: item } = await svc.from("approval_queue").insert({ type: "quote", title: `B3 nabídka ${TAG}`, quote_id: quoteId, order_id: jobId, ai_confidence: 0.9 }).select("id").single();
    const itemId = (item as { id: string }).id;
    queueIds.push(itemId);
    const a = await import("./approvals");

    as("worker");
    expect((await a.resolveApproval(itemId, "approved")).ok).toBe(false);
    as("sales"); // fronta (AI přehled) je jen pro super admina
    expect((await a.resolveApproval(itemId, "approved")).ok).toBe(false);
    as("admin");
    const r = await a.resolveApproval(itemId, "approved");
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    const { data: qq } = await svc.from("quotes").select("approved_by, state").eq("id", quoteId).single();
    expect(qq).toMatchObject({ approved_by: id("admin"), state: "schvalena" });
    const { data: qi } = await svc.from("approval_queue").select("status, resolved_by, resolved_at").eq("id", itemId).single();
    expect(qi).toMatchObject({ status: "approved", resolved_by: id("admin") });
    expect((await a.resolveApproval(itemId, "rejected")).error).toMatch(/už někdo vyřídil/);
    const { data: au } = await svc.from("audit_log").select("actor_id, actor_name").eq("entity_id", itemId).eq("action", "approval_approved").single();
    expect(au).toMatchObject({ actor_id: id("admin"), actor_name: "Super Admin" });
  }, 60_000);

  it("režim automatiky: právo settings + audit „z → na“ s autorem; beze změny se audit nezapíše", async () => {
    const m = await import("./automation");
    as("sales");
    expect((await m.setModuleMode("quote", "full")).ok).toBe(false);
    as("admin");
    const target = automationBefore.quote === "full" ? "approval" : "full";
    expect(await m.setModuleMode("quote", target)).toEqual({ ok: true });
    expect(await m.setModuleMode("quote", target)).toEqual({ ok: true });
    const { data } = await svc.from("audit_log").select("actor_id, diff, entity_id").eq("action", "automation_mode_changed").eq("entity_id", "quote").gte("created_at", startedAt);
    const rows = (data ?? []) as Row[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_id: id("admin"), diff: { module: "quote", from: automationBefore.quote, to: target } });
    const { data: s } = await svc.from("automation_settings").select("updated_by").eq("module", "quote").single();
    expect((s as Row).updated_by).toBe(id("admin"));
  }, 60_000);

  it("limit schválení nabídek: uložení (jen settings) + audit; od #25 už schválení nevyžaduje (nabídky ne-adminů schvaluje super admin vždy)", async () => {
    const i = await import("./integrations");
    as("sales");
    expect((await i.saveQuoteApprovalLimit(1000)).ok).toBe(false);
    as("admin");
    expect((await i.saveQuoteApprovalLimit(-5)).ok).toBe(false);
    expect(await i.saveQuoteApprovalLimit(80_000)).toEqual({ ok: true });
    const { data: s } = await svc.from("integration_settings").select("value, category, updated_by").eq("key", "quote_approval_limit").single();
    expect(s).toMatchObject({ value: "80000", category: "firma", updated_by: id("admin") });
    const jobId = await newJob({ status: "naceneni" });
    const { data: q } = await svc.from("quotes").insert({ job_id: jobId, number: `NAB-E2E-B3L-${TAG}`, status: "ke_schvaleni", total: 90_000, revision: 1 }).select("approval_required, state").single();
    expect(q).toMatchObject({ approval_required: false, state: "rozpracovana" });
    const { data: qs } = await svc.from("quotes").insert({ job_id: jobId, number: `NAB-E2E-B3L-${TAG}-s`, status: "ke_schvaleni", total: 10, revision: 1, created_by: id("sales") })
      .select("approval_required, admin_approval_required, state").single();
    expect(qs).toMatchObject({ approval_required: true, admin_approval_required: true, state: "ke_schvaleni" });
    const { data: au } = await svc.from("audit_log").select("actor_id, diff").eq("action", "settings_updated").eq("entity_id", "quote_approval_limit").gte("created_at", startedAt).order("created_at", { ascending: false }).limit(1).single();
    expect(au).toMatchObject({ actor_id: id("admin"), diff: { to: "80000" } });
  }, 60_000);

  it("plánovač toku: 14 dní bez podkladů → návrh Stažená (Bez odezvy); 7 dní bez odezvy → připomenutí do fronty; opakování nic nezdvojí", async () => {
    const { runFlowReminders, quoteReminderText } = await import("@/lib/email/flow-reminders");
    const waitJob = await newJob({ status: "poptavka", inquiry_status: "ceka_na_podklady", waiting_note: "výkres STEP" });
    await svc.from("orders").update({ waiting_since: new Date(Date.now() - 20 * 86_400_000).toISOString() }).eq("id", waitJob);
    const freshJob = await newJob({ status: "poptavka", inquiry_status: "ceka_na_podklady", waiting_note: "model" });
    const quoteJob = await newJob({ status: "nabidka", customer_contact: "Ing. Eva Testová", customer_contact_email: `b3-${TAG}@local.test`, owner_id: id("sales") });
    const sentAt = new Date(Date.now() - 9 * 86_400_000).toISOString();
    const { data: q } = await svc.from("quotes").insert({
      job_id: quoteJob, number: `NAB-E2E-B3R-${TAG}`, status: "odeslano", sent_at: sentAt, total: 1000, revision: 1, valid_until: "2099-12-31",
    }).select("id").single();
    const quoteId = (q as { id: string }).id;

    const scope = { jobIds: [waitJob, freshJob, quoteJob] };
    expect(await runFlowReminders(scope)).toEqual({ proposals: 1, reminders: 1 });
    expect(await runFlowReminders(scope)).toEqual({ proposals: 0, reminders: 0 });

    const { data: w } = await svc.from("orders").select("flow_proposal, flow_proposal_by, inquiry_status").eq("id", waitJob).single();
    expect(w).toMatchObject({ inquiry_status: "ceka_na_podklady", flow_proposal_by: null, flow_proposal: { phase: "inquiry", to: "stazena", reason: "bez_odezvy", kind: "ai" } });
    expect(((w as Row).flow_proposal as { note: string }).note).toMatch(/Čeká na podklady (19|20) dní \(výkres STEP\)/);
    expect(((await svc.from("orders").select("flow_proposal").eq("id", freshJob).single()).data as Row).flow_proposal).toBeNull();
    const { data: ev } = await svc.from("job_events").select("actor_kind, via, entity").eq("job_id", waitJob).eq("entity", "proposal");
    // návrh připravil plánovač (via cron) jménem AI — v historii „✨ AI (…)", nikdy prázdný autor
    expect(ev?.[0]).toMatchObject({ actor_kind: "ai", via: "cron" });

    const { data: rq } = await svc.from("approval_queue").select("id, type, target, payload, order_id, owner_id, status").eq("quote_id", quoteId);
    const rows = (rq ?? []) as Row[];
    expect(rows).toHaveLength(1);
    queueIds.push(String(rows[0].id));
    expect(rows[0]).toMatchObject({ type: "reminder", target: `b3-${TAG}@local.test`, order_id: quoteJob, owner_id: id("sales"), status: "pending" });
    expect((rows[0].payload as { body: string }).body).toContain("Dobrý den, Ing. Eva Testová,");
    expect(quoteReminderText({ number: "NAB-1", customerName: null, contact: null, validUntil: null, sentAt: null }).body).toMatch(/^Dobrý den,\n\ndovolujeme si připomenout naši cenovou nabídku NAB-1\./);
  }, 60_000);

  it("ingest pošty: autor ✨ AI (e-mail) za vlastníka schránky; bez AI kdo spustil (výchozí plánovač)", async () => {
    const { ingestActor } = await import("@/lib/email/ingest");
    expect(ingestActor(true, { ownerId: id("sales") })).toEqual({ id: id("sales"), kind: "ai", via: "email", agent: "email-ingest" });
    expect(ingestActor(true, {})).toEqual({ id: null, kind: "ai", via: "email", agent: "email-ingest" });
    expect(ingestActor(false, {})).toMatchObject({ id: null, kind: "system", via: "cron" });
    expect(ingestActor(false, { actor: { id: id("admin"), kind: "user", via: "rucne" } })).toMatchObject({ id: id("admin"), kind: "user" });
  });

  it("smazání účtu s historií změn → odmítnuto (nabídne deaktivaci); bez historie projde", async () => {
    const users = await import("./users");
    const mk = async (suffix: string) => {
      const { data, error } = await svc.auth.admin.createUser({ email: `b3-${suffix}-${TAG}@local.test`, password: `Heslo-${TAG}-1!`, email_confirm: true });
      if (error) throw new Error(error.message);
      tempUsers.push(data.user!.id);
      await svc.from("profiles").update({ full_name: `B3 ${suffix}`, role: "zamestnanec", active: true }).eq("id", data.user!.id);
      return data.user!.id;
    };
    const withHistory = await mk("hist");
    const clean = await mk("clean");
    const jobId = await newJob({ status: "poptavka" });
    await svc.from("job_events").insert({ job_id: jobId, type: "field", message: "B3 změna", actor_id: withHistory, data: {} });
    as("admin");
    const r1 = await users.deleteUser(withHistory);
    expect(r1.ok).toBe(false);
    expect(r1.error).toMatch(/historii 1 záznam změn — místo smazání ho deaktivuj/);
    expect(await users.deleteUser(clean)).toEqual({ ok: true });
    tempUsers.splice(tempUsers.indexOf(clean), 1);
  }, 60_000);

  it("/settings/audit: filtr osoby, entity a období; jméno autora vždy", async () => {
    const { listAudit } = await import("@/lib/data/audit");
    as("sales");
    expect((await listAudit()).entries).toEqual([]);
    as("admin");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague" }).format(new Date());
    const all = await listAudit({ actorId: id("admin"), entity: "automation_settings", from: today, to: today });
    expect(all.entries.length).toBeGreaterThanOrEqual(1);
    expect(all.entries.every((e) => e.entity === "automation_settings" && e.stamp.by?.name === "Super Admin")).toBe(true);
    expect(all.entries[0]).toMatchObject({ actionLabel: "Změněn režim automatiky" });
    expect(all.actors.some((a) => a.name === "Petr Obchodník")).toBe(true);
    expect((await listAudit({ actorId: id("worker"), entity: "automation_settings", from: today })).entries).toEqual([]);
    expect((await listAudit({ entity: "automation_settings", from: "2000-01-01", to: "2000-01-02" })).entries).toEqual([]);
    const sys = await listAudit({ actorKind: "system", from: today });
    expect(sys.entries.every((e) => e.stamp.kind !== "user" || !e.stamp.by)).toBe(true);
  }, 60_000);
});
