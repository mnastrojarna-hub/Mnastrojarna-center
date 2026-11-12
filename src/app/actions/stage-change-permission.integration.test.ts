import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 9. 11. „Šponer má mít oprávnění změnit ručně stav zakázky dopředu i dozadu" — profiles.can_change_stage
 * (funkce „stage_any") — a „speciální stavy (nerealizováno, reklamace …) smí každý" proti lokálnímu Supabase: Korekce stavu (moveJobStage), náhled (previewJobStage),
 * setJobStage, DB pojistka uzavření (orders_stage_change), profiles_guard a správa uživatelů (updateUser).
 * Vlastní účty e2e-stage-* a zakázky Z-E2E-STAGE-*; mockuje se jen přihlášení a revalidace Next.js.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/app/actions/stage-change-permission.integration.test.ts
 */

const ENABLED = process.env.LOCAL_SUPABASE === "1";
const TAG = Date.now().toString(36);
const PREFIX = `Z-E2E-STAGE-${TAG}`;

type Who = "admin" | "sales" | "plain" | "stager";
const who = vi.hoisted(() => ({
  users: {} as Record<string, {
    id: string; email: string; fullName: string; role: "super_admin" | "obchodnik" | "zamestnanec"; canChangeStage?: boolean;
  }>,
  current: "sales" as string,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));

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
type JobFlow = typeof import("@/app/actions/job-flow");
type Jobs = typeof import("@/app/actions/jobs");
type Users = typeof import("@/app/actions/users");
type Ex = typeof import("@/app/actions/flow-exceptions");

describe.skipIf(!ENABLED)("9. 11. ruční změna stavu zakázky (can_change_stage) ↔ lokální Supabase", () => {
  let svc: SupabaseClient;
  let flow: Flow;
  let jobFlow: JobFlow;
  let jobs: Jobs;
  let users: Users;
  let ex: Ex;
  const created: string[] = [];
  const jobIds: string[] = [];
  const startedAt = new Date().toISOString();
  let n = 0;

  const as = (u: Who) => { who.current = u; };
  const id = (u: Who) => who.users[u].id;
  const password = (key: string) => `Stage-${TAG}-${key}-1!`;

  async function makeUser(key: "plain" | "stager", canChangeStage: boolean): Promise<void> {
    const email = `e2e-stage-${TAG}-${key}@local.test`;
    const { data, error } = await svc.auth.admin.createUser({
      email, password: password(key), email_confirm: true, user_metadata: { full_name: `STAGE ${key} ${TAG}` },
    });
    if (error || !data.user) throw new Error(error?.message ?? "createUser");
    created.push(data.user.id);
    const { error: pErr } = await svc.from("profiles").update({
      role: "zamestnanec", full_name: `STAGE ${key} ${TAG}`, active: true, can_change_stage: canChangeStage,
    } as never).eq("id", data.user.id);
    if (pErr) throw new Error(pErr.message);
    who.users[key] = { id: data.user.id, email, fullName: `STAGE ${key} ${TAG}`, role: "zamestnanec", canChangeStage };
  }

  async function newJob(status = "nabidka"): Promise<string> {
    n += 1;
    const { localAdmin } = await import("@/test/local-supabase");
    const { userActor } = await import("@/lib/supabase/actor-headers");
    const { data, error } = await localAdmin(userActor({ id: id("sales") })).from("orders").insert({
      number: `${PREFIX}-${n}`, title: `Stav ${n}`, source: "email", status, inquiry_date: "2026-11-01", owner_id: id("sales"),
    } as never).select("id").single();
    if (error) throw new Error(error.message);
    jobIds.push((data as { id: string }).id);
    return (data as { id: string }).id;
  }
  async function stage(jobId: string): Promise<string> {
    return ((await svc.from("orders").select("status").eq("id", jobId).single()).data as { status: string }).status;
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
    await makeUser("stager", true);
    flow = await import("@/app/actions/flow-status");
    jobFlow = await import("@/app/actions/job-flow");
    jobs = await import("@/app/actions/jobs");
    users = await import("@/app/actions/users");
    ex = await import("@/app/actions/flow-exceptions");
  }, 60_000);

  afterAll(async () => {
    if (!svc) return;
    if (jobIds.length) {
      await svc.from("quotes").delete().in("job_id", jobIds);
      await svc.from("invoices").delete().in("order_id", jobIds);
      await svc.from("orders").delete().in("id", jobIds);
      await svc.from("audit_log").delete().in("entity_id", jobIds);
    }
    await svc.from("audit_log").delete().in("entity_id", created);
    for (const uid of created) await svc.auth.admin.deleteUser(uid);
  }, 60_000);

  it("migrace: sloupec, komentář, profiles_guard a pojistka rozhodnutí bez uzavření (idempotentní soubor)", async () => {
    const { localSql } = await import("@/test/local-supabase");
    expect(localSql("select data_type || '|' || is_nullable || '|' || column_default from information_schema.columns "
      + "where table_name = 'profiles' and column_name = 'can_change_stage'")).toBe("boolean|NO|false");
    expect(localSql("select col_description('profiles'::regclass, (select attnum from pg_attribute where attrelid = 'profiles'::regclass and attname = 'can_change_stage'))"))
      .toContain("Smí ručně měnit stav zakázky");
    expect(localSql("select prosrc like '%can_change_stage is distinct from old.can_change_stage%' from pg_proc where proname = 'profiles_guard'")).toBe("t");
    // speciální stavy smí každý: pojistka rozhodnutí už uzavření zakázky nehlídá (odmítnutí poptávky a storno ano)
    expect(localSql("select prosrc like '%new.status in (''nerealizovano'', ''zruseno'') and (tg_op%' from pg_proc where proname = 'orders_stage_change'")).toBe("f");
    expect(localSql("select prosrc like '%stornovat objednávku smí obchodník nebo admin%' from pg_proc where proname = 'orders_stage_change'")).toBe("t");
    // jednorázová značka — druhé spuštění Šponera nepřepíná (ruční vypnutí ve Správě uživatelů vydrží)
    expect(localSql("select count(*) from integration_settings where key = 'stage_change_sponer_v1'")).toBe("1");
    const file = readFileSync(path.resolve(__dirname, "../../../supabase/migrations/20261109100000_zmena_stavu_opravneni.sql"), "utf8");
    expect(file).toContain("on conflict (key) do nothing");
    expect(file).toContain("add column if not exists can_change_stage");
  });

  it("zaměstnanec bez příznaku: běžný tok a speciální stavy (s důvodem) i návrat ano, Vyfakturováno / Dokončeno ne", async () => {
    const jobId = await newJob("nabidka");
    as("plain");
    expect(await flow.moveJobStage(jobId, "ve_vyrobe", { note: "korekce" })).toMatchObject({ ok: true, stage: "ve_vyrobe" });
    expect(await flow.moveJobStage(jobId, "fakturovano")).toEqual({ ok: false, error: "K této akci nemáš oprávnění." });
    expect(await flow.moveJobStage(jobId, "dokonceno")).toEqual({ ok: false, error: "K této akci nemáš oprávnění." });
    expect(await stage(jobId)).toBe("ve_vyrobe");
    expect(await jobFlow.previewJobStage(jobId, "dokonceno")).toMatchObject({ ok: true, allowed: false });
    expect(await jobFlow.previewJobStage(jobId, "nerealizovano")).toMatchObject({ ok: true, allowed: true, reasonRequired: true });
    expect(await jobFlow.previewJobStage(jobId, "reklamace")).toMatchObject({ ok: true, allowed: true, reasonRequired: false });
    expect((await jobs.setJobStage(jobId, "fakturovano")).ok).toBe(false);
    expect((await jobs.updateJob(jobId, { stage: "dokonceno" })).ok).toBe(false);
    expect(await stage(jobId)).toBe("ve_vyrobe");

    // speciální stavy: reklamace → zpět, pozastavit → Pokračovat (resume), nerealizováno jen s důvodem → zpět
    expect(await flow.moveJobStage(jobId, "reklamace", { note: "vadné díly" })).toMatchObject({ ok: true, stage: "reklamace" });
    expect(await flow.moveJobStage(jobId, "ve_vyrobe")).toMatchObject({ ok: true, stage: "ve_vyrobe" });
    expect(await ex.pauseJob(jobId, { reason: "čekáme na materiál" })).toMatchObject({ ok: true, stage: "pozastaveno" });
    expect(await ex.resumeJob(jobId)).toMatchObject({ ok: true, stage: "ve_vyrobe" });
    expect((await flow.moveJobStage(jobId, "nerealizovano", {})).ok).toBe(false);
    expect(await stage(jobId)).toBe("ve_vyrobe");
    expect(await flow.moveJobStage(jobId, "nerealizovano", { reason: "cena", note: "drahé" })).toMatchObject({ ok: true, stage: "nerealizovano" });
    expect((await svc.from("orders").select("lost_reason, lost_note, lost_by, side_from_stage").eq("id", jobId).single()).data)
      .toMatchObject({ lost_reason: "cena", lost_note: "drahé", lost_by: id("plain"), side_from_stage: "ve_vyrobe" });
    expect(await flow.moveJobStage(jobId, "ve_vyrobe")).toMatchObject({ ok: true, stage: "ve_vyrobe" });
    expect((await flow.moveJobStage(jobId, "zruseno", { reason: "vyroba" })).ok).toBe(true);
    expect(await stage(jobId)).toBe("zruseno");

    // výjimky v toku: „Zákazník neobjednal…" (důvod povinný) a „Obnovit poptávku" (bez nabídky → Poptávka)
    const pre = await newJob("nabidka");
    expect((await ex.closeJobAsLost(pre, "notOrdered", { reason: "kapacita" as never })).ok).toBe(false);
    expect(await ex.closeJobAsLost(pre, "notOrdered", { reason: "cena", note: "levnější konkurence" })).toMatchObject({ ok: true, stage: "nerealizovano" });
    expect(await ex.reopenLostJob(pre)).toMatchObject({ ok: true });
    expect(await stage(pre)).toBe("poptavka");

    // DB: speciální stav přímým zápisem (náš server s autorem) projde; storno objednávky dál jen obchodník / admin
    const { localAdmin } = await import("@/test/local-supabase");
    const { userActor } = await import("@/lib/supabase/actor-headers");
    const db = localAdmin(userActor({ id: id("plain") }));
    const direct = await newJob("nabidka");
    expect((await db.from("orders").update({ status: "nerealizovano", lost_reason: "cena" } as never).eq("id", direct)).error).toBeNull();
    expect(await stage(direct)).toBe("nerealizovano");
    expect((await db.from("orders").update({ status: "objednavka" } as never).eq("id", direct)).error).toBeNull();
    const { error } = await db.from("orders").update({ order_status: "stornovana" } as never).eq("id", direct);
    expect(error?.message).toContain("smí obchodník nebo admin");
  }, 60_000);

  it("zaměstnanec bez příznaku: Výroba se nepovedla → Zrušit zakázku smí (důvod „Výroba se nepovedla“)", async () => {
    const jobId = await newJob("nabidka");
    as("sales");
    expect(await flow.moveJobStage(jobId, "ve_vyrobe")).toMatchObject({ ok: true, stage: "ve_vyrobe" });
    as("plain");
    expect(await ex.recordProductionFailure(jobId, { reason: "zmetek", next: "cancel" })).toMatchObject({ ok: true, stage: "zruseno" });
    expect((await svc.from("orders").select("lost_reason").eq("id", jobId).single()).data).toMatchObject({ lost_reason: "vyroba" });
  }, 60_000);

  it("zaměstnanec s příznakem (Šponer): dopředu i dozadu, Dokončeno, uzavření s důvodem a zpět — bez marží", async () => {
    const jobId = await newJob("nabidka");
    as("stager");
    const perms = await import("@/lib/auth/permissions");
    expect(perms.can({ ...who.users.stager, aiAccess: false, active: true }, "margins", perms.DEFAULT_ACCESS_CONTEXT)).toBe(false);
    expect(await jobFlow.previewJobStage(jobId, "dokonceno")).toMatchObject({ ok: true, allowed: true, reasonRequired: false });
    expect(await jobFlow.previewJobStage(jobId, "zruseno")).toMatchObject({ ok: true, allowed: true, reasonRequired: true });
    expect(await flow.moveJobStage(jobId, "ve_vyrobe")).toMatchObject({ ok: true, stage: "ve_vyrobe" });
    expect(await flow.moveJobStage(jobId, "poptavka", { note: "zpět na začátek" })).toMatchObject({ ok: true, stage: "poptavka" });
    expect(await flow.moveJobStage(jobId, "dokonceno", { note: "hotovo mimo systém" })).toMatchObject({ ok: true, stage: "dokonceno" });
    expect(await flow.moveJobStage(jobId, "fakturovano")).toMatchObject({ ok: true, stage: "fakturovano" });
    // uzavření: důvod pořád povinný
    expect((await flow.moveJobStage(jobId, "nerealizovano", {})).ok).toBe(false);
    expect(await stage(jobId)).toBe("fakturovano");
    expect(await flow.moveJobStage(jobId, "nerealizovano", { reason: "cena", note: "drahé" })).toMatchObject({ ok: true, stage: "nerealizovano" });
    expect((await svc.from("orders").select("lost_reason, lost_note").eq("id", jobId).single()).data)
      .toMatchObject({ lost_reason: "cena", lost_note: "drahé" });
    expect(await flow.moveJobStage(jobId, "nabidka")).toMatchObject({ ok: true, stage: "nabidka" });
    expect((await jobs.setJobStage(jobId, "dokonceno")).ok).toBe(true);
    expect(await stage(jobId)).toBe("dokonceno");
    // historie nese autora
    const { data: ev } = await svc.from("job_events").select("actor_id, message").eq("job_id", jobId).eq("type", "stage");
    const mine = ((ev ?? []) as { actor_id: string | null; message: string }[]).filter((e) => e.actor_id === id("stager"));
    expect(mine.length).toBeGreaterThanOrEqual(6);
    expect(mine.some((e) => e.message.includes("Dokončeno"))).toBe(true);
  }, 60_000);

  it("profiles_guard: příznak si nikdo nezapne sám; super admin ano (Správa uživatelů + audit)", async () => {
    const local = await import("@/test/local-supabase");
    const session = await local.localSession(who.users.plain.email, password("plain"));
    const { error: selfErr } = await session.from("profiles").update({ can_change_stage: true } as never).eq("id", id("plain"));
    expect(selfErr?.message).toContain("jen super admin");
    expect((await svc.from("profiles").select("can_change_stage").eq("id", id("plain")).single()).data).toMatchObject({ can_change_stage: false });

    // správa uživatelů: jen super admin; neplatná hodnota; u obchodníka se neukládá
    as("plain");
    expect((await users.updateUser(id("plain"), { canChangeStage: true })).ok).toBe(false);
    as("admin");
    expect(await users.updateUser(id("plain"), { canChangeStage: "ano" as never })).toEqual({ ok: false, error: "Neplatné nastavení ruční změny stavu zakázky." });
    expect(await users.updateUser(id("plain"), { canChangeStage: true })).toMatchObject({ ok: true });
    expect((await svc.from("profiles").select("can_change_stage").eq("id", id("plain")).single()).data).toMatchObject({ can_change_stage: true });
    const { data: audit } = await svc.from("audit_log").select("diff").eq("action", "user_updated").eq("entity_id", id("plain"))
      .gte("created_at", startedAt);
    expect(((audit ?? []) as { diff: Record<string, unknown> }[]).some((a) => a.diff?.can_change_stage === true)).toBe(true);
    // beze změny → nic nezapisuje
    expect(await users.updateUser(id("plain"), { canChangeStage: true })).toEqual({ ok: true });
    expect(await users.updateUser(id("plain"), { canChangeStage: false })).toMatchObject({ ok: true });
    expect((await svc.from("profiles").select("can_change_stage").eq("id", id("plain")).single()).data).toMatchObject({ can_change_stage: false });
    // role obchodník: příznak se neukládá (mění stav vždy)
    expect(await users.updateUser(id("plain"), { role: "obchodnik", canChangeStage: true })).toMatchObject({ ok: true });
    expect((await svc.from("profiles").select("role, can_change_stage").eq("id", id("plain")).single()).data)
      .toMatchObject({ role: "obchodnik", can_change_stage: false });
    expect(await users.updateUser(id("plain"), { role: "zamestnanec" })).toMatchObject({ ok: true });
  }, 60_000);
});
