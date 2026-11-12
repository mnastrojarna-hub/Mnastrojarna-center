import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { DEMO, LOCAL_ENABLED, loadLocalEnv, localAdmin, localAnon, localSession, localSql, profileId } from "@/test/local-supabase";

/**
 * Poslední aktivita (9. 11., migrace 20261109140000) proti lokálnímu Supabase:
 *  - touch_my_activity zapíše jen vlastní řádek, do 30 s podruhé nic, neaktivní účet nic,
 *  - cizí řádek nejde (servisní RPC, přímý UPDATE přes REST — ani vlastní, ani super admin),
 *  - tep nemění updated_at, nepíše audit (historie změn uživatele) a nezasahuje do profiles_guard,
 *  - server (service role) + API /api/activity (vždy 200).
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/data/activity.integration.test.ts
 */

const session = vi.hoisted(() => ({ user: null as null | { id: string; active: boolean } }));
vi.mock("@/lib/supabase/server", async () => {
  const lib = await import("@/test/local-supabase");
  return {
    isSupabaseConfigured: () => true,
    hasServiceKey: () => true,
    createAdminClient: () => lib.localAdmin(),
    createOperatorClient: async () => lib.localAdmin(),
    createClient: async () => { throw new Error("Bez session (test)."); },
  };
});
vi.mock("@/lib/auth/session", async () => {
  const { NextResponse: R } = await import("next/server");
  return {
    apiRequire: async () => (session.user ? { user: session.user } : R.json({ error: "Nepřihlášen." }, { status: 401 })),
  };
});

describe.skipIf(!LOCAL_ENABLED)("Poslední aktivita uživatele (tep)", () => {
  let svc: SupabaseClient;
  const TAG = `act${Date.now()}`;
  const PASS = `Heslo-${TAG}-1!`;
  const users: Record<"me" | "other", { id: string; email: string }> = { me: { id: "", email: "" }, other: { id: "", email: "" } };
  let adminId = "";
  const row = (id: string) => localSql(
    `select coalesce(last_active_at::text,'') || '|' || coalesce(last_active_path,'') || '|' || updated_at::text from profiles where id = '${id}'`,
  ).split("|");
  const audits = (id: string) => Number(localSql(`select count(*) from audit_log where entity = 'profiles' and entity_id = '${id}'`));
  const age = (id: string, sec: number) => localSql(`update profiles set last_active_at = now() - interval '${sec} seconds' where id = '${id}'`);

  beforeAll(async () => {
    const env = loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    svc = localAdmin();
    for (const key of ["me", "other"] as const) {
      const email = `${TAG}-${key}@local.test`;
      const { data, error } = await svc.auth.admin.createUser({ email, password: PASS, email_confirm: true, user_metadata: { full_name: key } });
      if (error) throw new Error(error.message);
      users[key] = { id: data.user!.id, email };
      await svc.from("profiles").update({ role: "obchodnik", active: true }).eq("id", data.user!.id);
    }
    adminId = await profileId(svc, DEMO.admin.email);
  }, 60_000);

  afterAll(async () => {
    for (const u of Object.values(users)) if (u.id) await svc.auth.admin.deleteUser(u.id).catch(() => undefined);
  });

  it("vlastní řádek: zapíše čas a stránku, do 30 s podruhé nic; updated_at ani audit se nemění", async () => {
    const { me, other } = users;
    const sess = await localSession(me.email, PASS);
    const [, , updatedBefore] = row(me.id);
    const auditBefore = audits(me.id);
    const otherBefore = row(other.id);

    const first = await sess.rpc("touch_my_activity", { p_path: "/orders/abc" });
    expect(first.error).toBeNull();
    expect(first.data).toBe(true);
    const [at1, path1, updated1] = row(me.id);
    expect(at1).not.toBe("");
    expect(path1).toBe("/orders/abc");
    expect(updated1).toBe(updatedBefore);

    // do 30 s: no-op (ani jiná stránka)
    const second = await sess.rpc("touch_my_activity", { p_path: "/inbox" });
    expect(second.error).toBeNull();
    expect(second.data).toBe(false);
    expect(row(me.id)).toEqual([at1, "/orders/abc", updatedBefore]);

    // po 30 s znovu
    age(me.id, 31);
    expect((await sess.rpc("touch_my_activity", { p_path: "/inbox" })).data).toBe(true);
    const [at3, path3, updated3] = row(me.id);
    expect(path3).toBe("/inbox");
    expect(new Date(at3).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(updated3).toBe(updatedBefore);

    // cizí řádek beze změny, žádný audit (historie změn uživatele)
    expect(row(other.id)).toEqual(otherBefore);
    expect(audits(me.id)).toBe(auditBefore);
  });

  it("cizí řádek nejde: servisní RPC, přímý UPDATE přes REST (vlastní i super admin), anonym", async () => {
    const { me, other } = users;
    const sess = await localSession(me.email, PASS);
    const otherBefore = row(other.id);

    expect((await sess.rpc("user_activity_touch", { p_user: other.id, p_path: "/x" })).error).not.toBeNull();
    // přímý UPDATE cizího: RLS řádek nevidí → beze změny
    await sess.from("profiles").update({ last_active_at: new Date().toISOString(), last_active_path: "/hack" }).eq("id", other.id);
    expect(row(other.id)).toEqual(otherBefore);
    // přímý UPDATE vlastního: trigger odmítne (čas si nikdo nepřikreslí)
    age(me.id, 120);
    const mineBefore = row(me.id);
    const own = await sess.from("profiles").update({ last_active_at: new Date(Date.now() + 86_400_000).toISOString() }).eq("id", me.id);
    expect(own.error?.message ?? "").toMatch(/Poslední aktivitu zapisuje jen aplikace/);
    expect(row(me.id)).toEqual(mineBefore);
    // super admin přes REST také ne
    const admin = await localSession(DEMO.admin.email, DEMO.admin.password);
    const byAdmin = await admin.from("profiles").update({ last_active_path: "/hack" }).eq("id", other.id);
    expect(byAdmin.error?.message ?? "").toMatch(/Poslední aktivitu zapisuje jen aplikace/);
    expect(row(other.id)).toEqual(otherBefore);
    // anonym RPC nesmí
    expect((await localAnon().rpc("touch_my_activity", { p_path: "/x" })).error).not.toBeNull();
    // super admin smí zbytek profilu dál měnit (tep nezasahuje do profiles_guard ani updated_at u běžné změny)
    const pos = await admin.from("profiles").update({ position: `pozice ${TAG}` }).eq("id", other.id);
    expect(pos.error).toBeNull();
    expect(row(other.id)[2]).not.toBe(otherBefore[2]);
    // profiles_guard platí dál: obchodník si roli nezmění
    const role = await sess.from("profiles").update({ role: "super_admin" }).eq("id", me.id);
    expect(role.error?.message ?? "").toMatch(/jen super admin/);
    void adminId;
  });

  it("server (service role): cesta očištěná, neaktivní účet nic; lib a API /api/activity", async () => {
    const { other } = users;
    // DB: cesta jen „/…" a max 200 znaků
    expect((await svc.rpc("user_activity_touch", { p_user: other.id, p_path: "https://evil" })).data).toBe(true);
    expect(row(other.id)[1]).toBe("");
    age(other.id, 31);
    expect((await svc.rpc("user_activity_touch", { p_user: other.id, p_path: `/${"y".repeat(400)}` })).data).toBe(true);
    expect(row(other.id)[1]).toHaveLength(200);

    // lib (servisní klíč s ověřeným uživatelem)
    const { touchActivity } = await import("./activity");
    age(other.id, 31);
    expect(await touchActivity(other.id, "/suppliers?x=1")).toBe(true);
    expect(row(other.id)[1]).toBe("/suppliers");
    expect(await touchActivity(other.id, "/customers")).toBe(false);
    expect(row(other.id)[1]).toBe("/suppliers");

    // neaktivní účet: nic
    age(other.id, 31);
    await svc.from("profiles").update({ active: false }).eq("id", other.id);
    expect(await touchActivity(other.id, "/orders")).toBe(false);
    await svc.from("profiles").update({ active: true }).eq("id", other.id);

    // API: přihlášený → zapíše; nepřihlášený → 200 { ok: false } (žádná chyba v konzoli prohlížeče)
    const { POST } = await import("@/app/api/activity/route");
    const req = (body: unknown) => new Request("http://localhost/api/activity", { method: "POST", body: JSON.stringify(body) });
    session.user = { id: other.id, active: true };
    const okRes = await POST(req({ path: "/drawings/1" }));
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toEqual({ ok: true });
    expect(row(other.id)[1]).toBe("/drawings/1");
    const again = await POST(req({ path: "/drawings/2" }));
    expect(await again.json()).toEqual({ ok: false });
    session.user = null;
    const anon = await POST(req({ path: "/x" }));
    expect(anon).toBeInstanceOf(NextResponse);
    expect(anon.status).toBe(200);
    expect(await anon.json()).toEqual({ ok: false });
    const bad = await POST(new Request("http://localhost/api/activity", { method: "POST", body: "{nesmysl" }));
    expect(bad.status).toBe(200);

    // správa uživatelů (super admin, servisní klíč) poslední aktivitu čte
    const { loadUsersPageData } = await import("@/components/users/data");
    const data = await loadUsersPageData();
    const u = data.users.find((x) => x.id === other.id);
    expect(u?.lastActivePath).toBe("/drawings/1");
    expect(new Date(u?.lastActiveAt ?? 0).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(data.users.find((x) => x.id === users.me.id)?.lastActivePath).toBe("/inbox");
  });
});
