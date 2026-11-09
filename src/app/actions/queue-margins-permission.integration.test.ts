import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 9. 11. Šponer bez super admina: „Smí řešit frontu ke schválení" (profiles.can_resolve_queue → approval_queue) a
 * „Vidí nákupní ceny a marže" (profiles.can_see_margins → margins) proti lokálnímu Supabase — vyřízení fronty
 * (resolveApproval, updateApprovalBody, getApprovalQueue), nákupní ceny (getPurchaseOrder, REST politiky),
 * pojistka rozhodnutí (app_actor_may_decide), profiles_guard a správa uživatelů (updateUser).
 * Vlastní účty e2e-qm-* a zakázky Z-E2E-QM-*; mockuje se přihlášení, revalidace Next.js a odeslání e-mailu (SMTP).
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/app/actions/queue-margins-permission.integration.test.ts
 */

const ENABLED = process.env.LOCAL_SUPABASE === "1";
const TAG = Date.now().toString(36);
const PREFIX = `Z-E2E-QM-${TAG}`;

type Who = "admin" | "sales" | "plain" | "sponer";
const who = vi.hoisted(() => ({
  users: {} as Record<string, {
    id: string; email: string; fullName: string; role: "super_admin" | "obchodnik" | "zamestnanec";
    canResolveQueue?: boolean; canSeeMargins?: boolean;
  }>,
  current: "sales" as string,
  sent: [] as { to: string; subject: string }[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
// SMTP se netestuje (odeslana-posta.integration) — tady jen, že schválení odchozí akce e-mail opravdu odešle
vi.mock("@/lib/email/send", async (orig) => ({
  ...(await orig<typeof import("@/lib/email/send")>()),
  sendMail: vi.fn(async (input: { to: string; subject: string }) => {
    who.sent.push({ to: input.to, subject: input.subject });
    return { sent: true };
  }),
}));

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

type Approvals = typeof import("@/app/actions/approvals");
type Users = typeof import("@/app/actions/users");
type Queries = typeof import("@/lib/data/queries");
type Purchasing = typeof import("@/lib/data/purchasing");

describe.skipIf(!ENABLED)("9. 11. fronta ke schválení a nákupní ceny / marže bez super admina ↔ lokální Supabase", () => {
  let svc: SupabaseClient;
  let approvals: Approvals;
  let users: Users;
  let queries: Queries;
  let purchasing: Purchasing;
  const created: string[] = [];
  const jobIds: string[] = [];
  const queueIds: string[] = [];
  const startedAt = new Date().toISOString();
  let n = 0;
  let jobId = "";
  let poId = "";

  const as = (u: Who) => { who.current = u; };
  const id = (u: Who) => who.users[u].id;
  const password = (key: string) => `Qm-${TAG}-${key}-1!`;

  async function makeUser(key: "plain" | "sponer", flags: boolean): Promise<void> {
    const email = `e2e-qm-${TAG}-${key}@local.test`;
    const { data, error } = await svc.auth.admin.createUser({
      email, password: password(key), email_confirm: true, user_metadata: { full_name: `QM ${key} ${TAG}` },
    });
    if (error || !data.user) throw new Error(error?.message ?? "createUser");
    created.push(data.user.id);
    const { error: pErr } = await svc.from("profiles").update({
      role: "zamestnanec", full_name: `QM ${key} ${TAG}`, active: true, can_resolve_queue: flags, can_see_margins: flags,
    } as never).eq("id", data.user.id);
    if (pErr) throw new Error(pErr.message);
    who.users[key] = { id: data.user.id, email, fullName: `QM ${key} ${TAG}`, role: "zamestnanec", canResolveQueue: flags, canSeeMargins: flags };
  }

  async function newJob(): Promise<string> {
    n += 1;
    const { localAdmin } = await import("@/test/local-supabase");
    const { userActor } = await import("@/lib/supabase/actor-headers");
    const { data, error } = await localAdmin(userActor({ id: id("sales") })).from("orders").insert({
      number: `${PREFIX}-${n}`, title: `Fronta ${n}`, source: "email", status: "objednavka", inquiry_date: "2026-11-01", owner_id: id("sales"),
    } as never).select("id").single();
    if (error) throw new Error(error.message);
    jobIds.push((data as { id: string }).id);
    return (data as { id: string }).id;
  }

  async function queueRow(type: string, extra: Record<string, unknown> = {}): Promise<string> {
    const { data, error } = await svc.from("approval_queue").insert({
      type, title: `QM ${type} ${TAG}`, summary: "test", payload: { body: `Dobrý den, ${type} ${TAG}.`, subject: `QM ${type} ${TAG}` },
      target: "zakaznik@local.test", status: "pending", order_id: jobId, owner_id: id("sales"), ...extra,
    } as never).select("id").single();
    if (error) throw new Error(error.message);
    queueIds.push((data as { id: string }).id);
    return (data as { id: string }).id;
  }
  async function status(qid: string): Promise<{ status: string; resolved_by: string | null }> {
    return (await svc.from("approval_queue").select("status, resolved_by").eq("id", qid).single()).data as { status: string; resolved_by: string | null };
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
    await makeUser("plain", false);
    await makeUser("sponer", true);
    jobId = await newJob();
    const { data: po, error } = await svc.from("purchase_orders").insert({
      job_id: jobId, status: "vystavena", total: 12345.5, currency: "CZK",
    } as never).select("id").single();
    if (error) throw new Error(error.message);
    poId = (po as { id: string }).id;
    approvals = await import("@/app/actions/approvals");
    users = await import("@/app/actions/users");
    queries = await import("@/lib/data/queries");
    purchasing = await import("@/lib/data/purchasing");
  }, 60_000);

  afterAll(async () => {
    if (!svc) return;
    if (queueIds.length) await svc.from("approval_queue").delete().in("id", queueIds);
    if (jobIds.length) {
      await svc.from("approval_queue").delete().in("order_id", jobIds);
      await svc.from("purchase_orders").delete().in("job_id", jobIds);
      await svc.from("orders").delete().in("id", jobIds);
      await svc.from("audit_log").delete().in("entity_id", jobIds);
    }
    await svc.from("audit_log").delete().in("entity_id", [...created, ...queueIds]);
    for (const uid of created) await svc.auth.admin.deleteUser(uid);
  }, 60_000);

  it("migrace: sloupce, komentáře, profiles_guard, pojistky margins a jednorázová značka (idempotentní soubor)", async () => {
    const { localSql } = await import("@/test/local-supabase");
    for (const col of ["can_resolve_queue", "can_see_margins"]) {
      expect(localSql("select data_type || '|' || is_nullable || '|' || column_default from information_schema.columns "
        + `where table_name = 'profiles' and column_name = '${col}'`)).toBe("boolean|NO|false");
      expect(localSql(`select prosrc like '%${col} is distinct from old.${col}%' from pg_proc where proname = 'profiles_guard'`)).toBe("t");
    }
    expect(localSql("select col_description('profiles'::regclass, (select attnum from pg_attribute where attrelid = 'profiles'::regclass and attname = 'can_resolve_queue'))"))
      .toContain("Smí řešit frontu ke schválení");
    expect(localSql("select col_description('profiles'::regclass, (select attnum from pg_attribute where attrelid = 'profiles'::regclass and attname = 'can_see_margins'))"))
      .toContain("Vidí nákupní ceny a marže");
    // dřívější příznaky v profiles_guard zůstaly
    expect(localSql("select prosrc like '%can_change_stage is distinct from old.can_change_stage%' and prosrc like '%full_access is distinct%' from pg_proc where proname = 'profiles_guard'")).toBe("t");
    expect(localSql("select prosrc like '%can_see_margins%' from pg_proc where proname = 'app_actor_may_decide'")).toBe("t");
    expect(localSql("select prosrc like '%can_see_margins%' from pg_proc where proname = 'flow_badge_counts'")).toBe("t");
    expect(localSql("select count(*) from pg_policies where policyname in ('margins_viewer_select', 'job_files_bucket_read_margins')")).toBe("8");
    expect(localSql("select count(*) from integration_settings where key = 'sponer_queue_margins_v1'")).toBe("1");
    const file = readFileSync(path.resolve(__dirname, "../../../supabase/migrations/20261109130000_sponer_fronta_marze.sql"), "utf8");
    expect(file).toContain("on conflict (key) do nothing");
    expect(file).toContain("add column if not exists can_resolve_queue");
    expect(file).toContain("add column if not exists can_see_margins");
  });

  it("zaměstnanec bez příznaku: frontu nevidí ani nevyřídí, nákupní ceny ne", async () => {
    const qid = await queueRow("categorization");
    as("plain");
    expect(await queries.getApprovalQueue()).toEqual([]);
    expect(await approvals.resolveApproval(qid, "approved")).toEqual({ ok: false, error: "K této akci nemáš oprávnění." });
    expect(await approvals.resolveApproval(qid, "rejected")).toEqual({ ok: false, error: "K této akci nemáš oprávnění." });
    expect((await approvals.updateApprovalBody({ id: qid, body: "jiný text", agentKey: "email", originalBody: "x", context: "t" })).ok).toBe(false);
    expect((await status(qid)).status).toBe("pending");
    expect(await purchasing.getPurchaseOrder(poId)).toBeNull();
    expect((await queries.getBadgeCounts()).approvals).toBe(0);
  }, 60_000);

  it("Šponer (s příznakem): vidí frontu bez AI návrhů nabídek, potvrdí, upraví, odešle a zamítne — autor vyřízení je on", async () => {
    const cat = await queueRow("categorization");
    const reply = await queueRow("email_reply");
    const quoteRow = await queueRow("quote");
    const rej = await queueRow("order_match");
    const inv = await queueRow("supplier_invoice", { payload: { invoiceId: null } });
    as("sponer");
    const items = await queries.getApprovalQueue();
    const ids = items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining([cat, reply, rej]));
    expect(ids).not.toContain(quoteRow);
    expect(ids).not.toContain(inv);
    expect((await queries.getBadgeCounts()).approvals).toBeGreaterThanOrEqual(3);

    // potvrzení uvnitř systému
    expect(await approvals.resolveApproval(cat, "approved")).toEqual({ ok: true });
    expect(await status(cat)).toEqual({ status: "approved", resolved_by: id("sponer") });
    // úprava textu a odeslání odchozí odpovědi (e-mail opravdu odejde — sendMail)
    expect(await approvals.updateApprovalBody({
      id: reply, body: `Upravený text ${TAG}`, agentKey: "email", originalBody: `Dobrý den, email_reply ${TAG}.`, context: "test",
    })).toEqual({ ok: true });
    who.sent.length = 0;
    expect(await approvals.resolveApproval(reply, "approved")).toEqual({ ok: true, sent: true });
    expect(who.sent).toEqual([{ to: "zakaznik@local.test", subject: `QM email_reply ${TAG}` }]);
    expect(await status(reply)).toEqual({ status: "approved", resolved_by: id("sponer") });
    // zamítnutí
    expect(await approvals.resolveApproval(rej, "rejected")).toEqual({ ok: true });
    expect(await status(rej)).toEqual({ status: "rejected", resolved_by: id("sponer") });
    // AI návrh nabídky a rozdělení faktury dodavatele dál ne
    expect(await approvals.resolveApproval(quoteRow, "approved")).toEqual({ ok: false, error: "K této akci nemáš oprávnění." });
    expect(await approvals.resolveApproval(quoteRow, "rejected")).toEqual({ ok: false, error: "K této akci nemáš oprávnění." });
    expect(await approvals.resolveApproval(inv, "rejected")).toEqual({ ok: false, error: "K této akci nemáš oprávnění." });
    expect((await status(quoteRow)).status).toBe("pending");
    // naposledy vyřízené (bez typů, které nevidí)
    const recent = await queries.getResolvedApprovals(50);
    expect(recent.map((r) => r.id)).toEqual(expect.arrayContaining([cat, reply, rej]));
  }, 60_000);

  it("Šponer: objednávku dodavateli ve frontě (cizí zakázka) zamítne; zaměstnanec bez příznaku ne", async () => {
    const qid = await queueRow("purchase_order", { purchase_order_id: poId, payload: { kind: "issue", subject: `OV ${TAG}` } });
    as("plain");
    expect(await approvals.resolveApproval(qid, "rejected")).toEqual({ ok: false, error: "K této akci nemáš oprávnění." });
    as("sponer");
    expect(await approvals.resolveApproval(qid, "rejected")).toEqual({ ok: true });
    expect(await status(qid)).toEqual({ status: "rejected", resolved_by: id("sponer") });
    expect(((await svc.from("purchase_orders").select("status").eq("id", poId).single()).data as { status: string }).status).toBe("vystavena");
  }, 60_000);

  it("Šponer vidí nákupní ceny (aplikace i REST) a rozhodne konec toku; bez příznaku ne", async () => {
    as("sponer");
    expect(await purchasing.getPurchaseOrder(poId)).toMatchObject({ id: poId });
    const local = await import("@/test/local-supabase");
    const sp = await local.localSession(who.users.sponer.email, password("sponer"));
    expect(((await sp.from("purchase_orders").select("id, total").eq("id", poId)).data ?? [])).toEqual([{ id: poId, total: 12345.5 }]);
    const pl = await local.localSession(who.users.plain.email, password("plain"));
    expect(((await pl.from("purchase_orders").select("id, total").eq("id", poId)).data ?? [])).toEqual([]);
    // REST: vlastní příznak si nikdo nezapne (profiles_guard)
    const { error: selfErr } = await pl.from("profiles").update({ can_see_margins: true } as never).eq("id", id("plain"));
    expect(selfErr?.message).toContain("jen super admin");
    const { error: selfQ } = await pl.from("profiles").update({ can_resolve_queue: true } as never).eq("id", id("plain"));
    expect(selfQ?.message).toContain("jen super admin");
    // ani Šponer si příznak nevypne / nezmění sám
    const { error: selfOff } = await sp.from("profiles").update({ can_resolve_queue: false } as never).eq("id", id("sponer"));
    expect(selfOff?.message).toContain("jen super admin");

    // pojistka rozhodnutí (app_actor_may_decide = právo margins): storno objednávky přímým zápisem s autorem
    const { userActor } = await import("@/lib/supabase/actor-headers");
    const j1 = await newJob();
    const plainDb = local.localAdmin(userActor({ id: id("plain") }));
    const { error: plainErr } = await plainDb.from("orders").update({ order_status: "stornovana" } as never).eq("id", j1);
    expect(plainErr?.message).toContain("smí obchodník nebo admin");
    const spDb = local.localAdmin(userActor({ id: id("sponer") }));
    expect((await spDb.from("orders").update({ order_status: "stornovana" } as never).eq("id", j1)).error).toBeNull();
  }, 60_000);

  it("Správa uživatelů: přepínače mění jen super admin (audit); marže jen u zaměstnance, fronta i u obchodníka", async () => {
    as("plain");
    expect((await users.updateUser(id("plain"), { canResolveQueue: true })).ok).toBe(false);
    expect((await users.updateUser(id("plain"), { canSeeMargins: true })).ok).toBe(false);
    as("sponer");
    expect((await users.updateUser(id("plain"), { canSeeMargins: true })).ok).toBe(false);
    as("admin");
    expect(await users.updateUser(id("plain"), { canResolveQueue: "ano" as never })).toEqual({ ok: false, error: "Neplatné nastavení „Smí řešit frontu ke schválení“." });
    expect(await users.updateUser(id("plain"), { canResolveQueue: true, canSeeMargins: true })).toMatchObject({ ok: true });
    expect((await svc.from("profiles").select("can_resolve_queue, can_see_margins").eq("id", id("plain")).single()).data)
      .toMatchObject({ can_resolve_queue: true, can_see_margins: true });
    const { data: audit } = await svc.from("audit_log").select("diff").eq("action", "user_updated").eq("entity_id", id("plain"))
      .gte("created_at", startedAt);
    expect(((audit ?? []) as { diff: Record<string, unknown> }[]).some((a) => a.diff?.can_resolve_queue === true && a.diff?.can_see_margins === true)).toBe(true);
    // beze změny → nic nezapisuje
    expect(await users.updateUser(id("plain"), { canResolveQueue: true, canSeeMargins: true })).toEqual({ ok: true });
    expect(await users.updateUser(id("plain"), { canResolveQueue: false, canSeeMargins: false })).toMatchObject({ ok: true });
    // obchodník: marže má vždy (příznak se neukládá), frontu jen s příznakem
    expect(await users.updateUser(id("plain"), { role: "obchodnik", canSeeMargins: true, canResolveQueue: true })).toMatchObject({ ok: true });
    expect((await svc.from("profiles").select("role, can_resolve_queue, can_see_margins").eq("id", id("plain")).single()).data)
      .toMatchObject({ role: "obchodnik", can_resolve_queue: true, can_see_margins: false });
    expect(await users.updateUser(id("plain"), { role: "zamestnanec", canResolveQueue: false })).toMatchObject({ ok: true });
  }, 60_000);
});
