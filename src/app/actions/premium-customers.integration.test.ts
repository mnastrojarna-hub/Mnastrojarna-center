import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 9. 11. „Prémioví zákazníci" proti lokálnímu Supabase: migrace 20261109150000 (sloupec, audit, jednorázové
 * označení Hitachi / Expertbuy / Charvát Pacovské strojírny / Eden Europe podle variant názvu, idempotence,
 * nikdy neodznačí), přepnutí v kartě zákazníka (setCustomerPremium / updateCustomer) — smí každý aktivní
 * uživatel jako úpravu zákazníka, neaktivní ne; REST (RLS customers_update): přihlášený aktivní ano, anonym a
 * neaktivní ne. Zakázka čte příznak živě ze zákazníka (listJobs). Vlastní zákazníci „… PREM-<tag>".
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/app/actions/premium-customers.integration.test.ts
 */

const ENABLED = process.env.LOCAL_SUPABASE === "1";
const TAG = `PREM-${Date.now().toString(36)}`;
const MIGRATION = path.resolve(__dirname, "../../../supabase/migrations/20261109150000_premiovi_zakaznici.sql");
const PSQL = path.resolve(__dirname, "../../../tools/local-supabase/psql.sh");

const who = vi.hoisted(() => ({
  users: {} as Record<string, { id: string; email: string; fullName: string; role: "super_admin" | "obchodnik" | "zamestnanec"; active: boolean }>,
  current: "worker" as string,
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
    return { ...u, initials: "XX", roleLabel: u.role, aiAccess: false, hasProfile: true, mustChangePassword: false };
  };
  const can = (f: string) => perms.can(user(), f as never, perms.DEFAULT_ACCESS_CONTEXT);
  return {
    getSessionUser: async () => user(),
    getAccess: async () => ({ user: user(), ctx: perms.DEFAULT_ACCESS_CONTEXT, features: [], can }),
    checkFeature: async (f: string) => {
      const u = user();
      if (!u.active) return { error: "Účet není aktivní." };
      return can(f) ? { user: u } : { error: "K této akci nemáš oprávnění." };
    },
    apiRequire: async () => ({ user: user() }),
    requireUser: async () => user(),
    requireFeature: async () => user(),
  };
});

type Crm = typeof import("@/app/actions/crm");

/** psql se souborem nebo příkazem; vrací stdout + NOTICE ze stderr. */
function psql(args: string[]): { out: string; notices: string } {
  const r = spawnSync(PSQL, ["-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`psql selhalo: ${r.stderr}`);
  return { out: (r.stdout ?? "").trim(), notices: r.stderr ?? "" };
}

/** Jednorázový blok migrace (sekce 4) — spustí se znovu po smazání značky. */
function oneTimeBlock(): string {
  const file = readFileSync(MIGRATION, "utf8");
  const start = file.indexOf("do $$", file.indexOf("4) Výchozí prémioví zákazníci"));
  expect(start).toBeGreaterThan(0);
  return file.slice(start);
}

describe.skipIf(!ENABLED)("9. 11. prémioví zákazníci ↔ lokální Supabase", () => {
  let svc: SupabaseClient;
  let crm: Crm;
  const created: string[] = [];
  const customerIds: Record<string, string> = {};
  const jobIds: string[] = [];
  let markerBefore: string | null = null;

  async function customer(key: string, name: string, premium = false): Promise<string> {
    const { data, error } = await svc.from("customers").insert({ name: `${name} ${TAG}`, is_premium: premium } as never).select("id").single();
    if (error) throw new Error(error.message);
    customerIds[key] = (data as { id: string }).id;
    return customerIds[key];
  }
  async function premium(key: string): Promise<boolean> {
    const { data } = await svc.from("customers").select("is_premium").eq("id", customerIds[key]).single();
    return (data as { is_premium: boolean }).is_premium;
  }
  const as = (u: string) => { who.current = u; };

  beforeAll(async () => {
    const local = await import("@/test/local-supabase");
    const env = local.loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    svc = local.localAdmin();
    const { data } = await svc.from("profiles").select("id, email, full_name, role").in("email", [local.DEMO.worker.email, local.DEMO.admin.email]);
    for (const r of (data ?? []) as { id: string; email: string; full_name: string; role: "super_admin" | "zamestnanec" }[]) {
      who.users[r.role === "super_admin" ? "admin" : "worker"] = { id: r.id, email: r.email, fullName: r.full_name, role: r.role, active: true };
    }
    expect(Object.keys(who.users).sort()).toEqual(["admin", "worker"]);
    // neaktivní zaměstnanec (smí upravit zákazníka jen aktivní uživatel)
    const email = `e2e-${TAG.toLowerCase()}-off@local.test`;
    const { data: u, error } = await svc.auth.admin.createUser({ email, password: `Off-${TAG}-1!`, email_confirm: true, user_metadata: { full_name: `OFF ${TAG}` } });
    if (error || !u.user) throw new Error(error?.message ?? "createUser");
    created.push(u.user.id);
    await svc.from("profiles").update({ role: "zamestnanec", full_name: `OFF ${TAG}`, active: false } as never).eq("id", u.user.id);
    who.users.off = { id: u.user.id, email, fullName: `OFF ${TAG}`, role: "zamestnanec", active: false };
    markerBefore = psql(["-c", "select value from integration_settings where key = 'premium_customers_v1'"]).out || null;
    crm = await import("@/app/actions/crm");
  }, 60_000);

  afterAll(async () => {
    if (!svc) return;
    if (jobIds.length) await svc.from("orders").delete().in("id", jobIds);
    const ids = Object.values(customerIds);
    if (ids.length) {
      await svc.from("audit_log").delete().in("entity_id", ids);
      await svc.from("customers").delete().in("id", ids);
    }
    // značka zůstane jako před testem (migrace ji na lokální DB už zapsala)
    if (markerBefore) {
      await svc.from("integration_settings").upsert({
        key: "premium_customers_v1", category: "ai_access", label: "Prémioví zákazníci — Hitachi, Expertbuy, Charvát Pacovské strojírny, Eden Europe (9. 11.)",
        is_secret: false, value: markerBefore,
      } as never);
    }
    for (const uid of created) await svc.auth.admin.deleteUser(uid);
  }, 60_000);

  it("migrace: sloupec, komentář, audit trigger, značka; soubor jde spustit znovu beze změny", () => {
    expect(psql(["-c", "select data_type || '|' || is_nullable || '|' || column_default from information_schema.columns "
      + "where table_name = 'customers' and column_name = 'is_premium'"]).out).toBe("boolean|NO|false");
    expect(psql(["-c", "select col_description('customers'::regclass, (select attnum from pg_attribute where attrelid = 'customers'::regclass and attname = 'is_premium'))"]).out)
      .toContain("Prémiový zákazník");
    expect(psql(["-c", "select count(*) from pg_trigger where tgname = 'trg_customers_premium_audit'"]).out).toBe("1");
    expect(psql(["-c", "select count(*) from integration_settings where key = 'premium_customers_v1'"]).out).toBe("1");
    const again = psql(["-1", "-f", MIGRATION]);
    expect(again.notices).toContain("výchozí nastavení už proběhlo dřív — beze změny");
  });

  it("jednorázové označení: varianty názvů všech čtyř, všechny shody, nic neodznačí, druhé spuštění nic nemění", async () => {
    await customer("hitachi1", "HITACHI Energy Czech Republic s.r.o.");
    await customer("hitachi2", "Hitachi Rail STS");
    await customer("expert1", "ExpertBuy s.r.o.");
    await customer("expert2", "Expert-Buy");
    await customer("expert3", "expert  buy cz");
    await customer("charvat", "CHARVÁT AXL, a.s.");
    await customer("pacov", "Pacovské strojírny, a.s.");
    await customer("plainA", "Expert Plus");
    await customer("plainB", "Edenia");
    await customer("manual", "Ručně prémiový", true);

    // bez Eden Europe v adresáři → NOTICE „bez shody" (v transakci vrácené zpět, nic se nezmění)
    const dry = psql(["-c", `begin; delete from integration_settings where key = 'premium_customers_v1'; ${oneTimeBlock()} rollback;`]);
    expect(dry.notices).toContain("bez shody v adresáři");
    expect(dry.notices).toContain("Eden Europe");
    expect(await premium("hitachi1")).toBe(false);

    await customer("eden1", "EDEN  Europe GmbH");
    await customer("eden2", "Eden-Europe s.r.o.");
    psql(["-c", "delete from integration_settings where key = 'premium_customers_v1'"]);
    const run = psql(["-1", "-c", oneTimeBlock()]);
    for (const key of ["hitachi1", "hitachi2", "expert1", "expert2", "expert3", "charvat", "pacov", "eden1", "eden2"]) {
      expect([key, await premium(key)]).toEqual([key, true]);
    }
    expect(await premium("plainA")).toBe(false);
    expect(await premium("plainB")).toBe(false);
    expect(await premium("manual")).toBe(true); // nikdy neodznačí
    expect(run.notices).toContain("Prémioví zákazníci — Hitachi:");
    expect(run.notices).toContain(`Hitachi Rail STS ${TAG}`);
    expect(run.notices).toContain("Prémioví zákazníci — Eden Europe:");
    expect(run.notices).not.toContain("bez shody");
    // záchranná síť auditu (mimo náš server)
    const { data: audit } = await svc.from("audit_log").select("action, diff").eq("entity_id", customerIds.hitachi1);
    expect((audit ?? []).some((a) => (a as { action: string }).action === "customer_premium_changed")).toBe(true);

    // druhé spuštění (značka už je): nový Hitachi se neoznačí, ručně odznačený zůstane odznačený
    await svc.from("customers").update({ is_premium: false } as never).eq("id", customerIds.hitachi2);
    await customer("hitachi3", "Hitachi High-Tech");
    const second = psql(["-1", "-c", oneTimeBlock()]);
    expect(second.notices).toContain("beze změny");
    expect(await premium("hitachi3")).toBe(false);
    expect(await premium("hitachi2")).toBe(false);
    expect(await premium("hitachi1")).toBe(true);
  });

  it("přepínač v kartě zákazníka: aktivní zaměstnanec smí (jako úprava zákazníka), neaktivní ne; zakázky živě", async () => {
    const id = await customer("toggle", "Toggle s.r.o.");
    const { localAdmin } = await import("@/test/local-supabase");
    const { userActor } = await import("@/lib/supabase/actor-headers");
    const { data: j, error } = await localAdmin(userActor({ id: who.users.admin.id })).from("orders").insert({
      number: `Z-E2E-${TAG}`, title: "Prémiová zakázka", source: "manual", status: "objednavka", customer_id: id,
    } as never).select("id").single();
    if (error) throw new Error(error.message);
    jobIds.push((j as { id: string }).id);
    const jobs = await import("@/lib/data/jobs");
    const premiumOfJob = async () => (await jobs.listJobs({ customerId: id })).find((x) => x.id === jobIds[0])?.customerPremium;

    as("off");
    expect(await crm.setCustomerPremium(id, true)).toEqual({ ok: false, error: "Účet není aktivní." });
    expect(await premium("toggle")).toBe(false);

    as("worker");
    expect(await crm.setCustomerPremium(id, true)).toEqual({ ok: true, isPremium: true });
    expect(await premium("toggle")).toBe(true);
    as("admin");
    expect(await premiumOfJob()).toBe(true);
    expect((await jobs.listJobs({ customerId: id, premium: true })).map((x) => x.id)).toEqual(jobIds);
    const { data: audit } = await svc.from("audit_log").select("action, actor_id, diff").eq("entity_id", id).eq("action", "customer_premium_changed");
    expect(audit).toHaveLength(1); // náš server audituje sám, trigger (ctx app) ne podruhé
    expect((audit![0] as { actor_id: string }).actor_id).toBe(who.users.worker.id);

    // úprava zákazníka dialogem (pole isPremium) — vypne; bez pole (starší klient) nic nemění
    as("worker");
    const { CUSTOMER_SELECT, rowToCustomerView, customerFormFromView } = await import("@/components/customers/model");
    const { data: row } = await svc.from("customers").select(CUSTOMER_SELECT).eq("id", id).single();
    const form = customerFormFromView(rowToCustomerView(row as never));
    expect(form.isPremium).toBe(true);
    expect((await crm.updateCustomer(id, { ...form, isPremium: false })).ok).toBe(true);
    expect(await premium("toggle")).toBe(false);
    as("admin");
    expect(await premiumOfJob()).toBe(false);
    as("worker");
    const { isPremium: _drop, ...legacy } = form;
    void _drop;
    expect((await crm.updateCustomer(id, legacy as never)).ok).toBe(true);
    expect(await premium("toggle")).toBe(false);
    expect(await crm.setCustomerPremium("not-a-uuid", true)).toEqual({ ok: false, error: "Neplatný zákazník." });
  });

  it("REST (RLS customers_update): přihlášený aktivní uživatel ano (audit triggerem), anonym a neaktivní ne", async () => {
    const id = await customer("rest", "REST s.r.o.");
    const local = await import("@/test/local-supabase");
    const worker = await local.localSession(local.DEMO.worker.email, local.DEMO.worker.password);
    const { error } = await worker.from("customers").update({ is_premium: true } as never).eq("id", id);
    expect(error).toBeNull();
    expect(await premium("rest")).toBe(true);
    const { data: audit } = await svc.from("audit_log").select("action, actor_id").eq("entity_id", id).eq("action", "customer_premium_changed");
    expect(audit).toHaveLength(1);
    expect((audit![0] as { actor_id: string }).actor_id).toBe(who.users.worker.id);

    const anon = local.localAnon();
    await anon.from("customers").update({ is_premium: false } as never).eq("id", id);
    expect(await premium("rest")).toBe(true);

    const off = await local.localSession(who.users.off.email, `Off-${TAG}-1!`);
    await off.from("customers").update({ is_premium: false } as never).eq("id", id);
    expect(await premium("rest")).toBe(true);
  });
});
