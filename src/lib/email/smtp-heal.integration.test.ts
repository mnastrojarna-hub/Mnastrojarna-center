import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_ENABLED, loadLocalEnv, localAdmin } from "@/test/local-supabase";
import type { MailboxConfig } from "@/lib/supabase/database.types";

/**
 * BUG produkce 10/2026 „535 Incorrect authentication data“ při odeslání, příjem OK — proti lokálnímu
 * Supabase + testovacímu poštovnímu serveru (SMTP odmítá špatné heslo 535):
 *  - uložené zastaralé vlastní SMTP heslo → odeslání projde heslem schránky a SMTP heslo se smaže (audit),
 *  - obě hesla špatně → hláška s heslem, AUTH a serverem + co dělat; nic se nemaže,
 *  - „Otestovat“ (Můj účet) stejně: SMTP OK s poznámkou a opravou,
 *  - uložení schránky v Můj účet novým heslem / odškrtnutí „SMTP má jiné heslo“ v Nastavení SMTP heslo smaže.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/email/smtp-heal.integration.test.ts
 */

type Srv = {
  ports: Record<string, number>;
  caFile: string;
  events: { type: string; proto?: string; user?: string }[];
  sent: { from: string; to: string[]; raw: string }[];
  close: () => Promise<void>;
};

const USER = "smtpheal@nastrojarstvi.test";
const PASS = "Smtpheal-Heslo-1";
const STALE = "Stare-SMTP-heslo";

const session = vi.hoisted(() => ({ current: null as null | { id: string; email: string; fullName: string; role: string } }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/supabase/server", async () => {
  const lib = await import("@/test/local-supabase");
  const admin = () => lib.localAdmin();
  return {
    isSupabaseConfigured: () => true,
    hasServiceKey: () => true,
    createAdminClient: admin,
    createOperatorClient: async () => admin(),
    createClient: async () => { throw new Error("Bez session (test)."); },
  };
});
vi.mock("@/lib/auth/session", () => {
  const FEATURES: Record<string, string[]> = {
    obchodnik: ["orders", "workflow", "documents", "customers", "suppliers", "mail", "margins"],
    super_admin: ["orders", "workflow", "documents", "customers", "suppliers", "mail", "mail_all", "margins", "dashboard", "settings", "users"],
  };
  const user = () => {
    const u = session.current!;
    return { ...u, initials: "XX", roleLabel: u.role, aiAccess: false, active: true, hasProfile: true };
  };
  const can = (f: string) => (FEATURES[session.current?.role ?? ""] ?? []).includes(f);
  return {
    getSessionUser: async () => user(),
    getAccess: async () => ({ user: user(), ctx: {}, features: FEATURES[session.current!.role], can }),
    checkFeature: async (f: string) => (can(f) ? { user: user() } : { error: "Bez oprávnění." }),
    apiRequire: async () => ({ user: user() }),
    requireUser: async () => user(),
    requireFeature: async () => user(),
  };
});

describe.skipIf(!LOCAL_ENABLED)("SMTP 535: zastaralé vlastní SMTP heslo ↔ lokální Supabase + testovací SMTP", () => {
  let srv: Srv;
  let svc: SupabaseClient;
  let userId = "";
  let adminId = "";
  let boxId = "";
  const TAG = `smtpheal${Date.now()}`;

  const cfg = async (): Promise<MailboxConfig> => ((await svc.from("mailboxes").select("config").eq("id", boxId).single()).data as { config: MailboxConfig }).config;
  const setCfg = async (patch: Partial<MailboxConfig>, drop: (keyof MailboxConfig)[] = []) => {
    const c = { ...(await cfg()), ...patch } as MailboxConfig;
    for (const k of drop) delete c[k];
    await svc.from("mailboxes").update({ config: c }).eq("id", boxId);
  };
  const smtpAuths = () => srv.events.filter((e) => e.type === "auth" && e.proto === "smtp" && e.user === USER).length;

  beforeAll(async () => {
    const env = loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    const mod = (await import(path.resolve(__dirname, "../../../tools/e2e/mail-test-server.mjs"))) as {
      startMailTestServer: (o: { dir: string; base: number }) => Promise<Srv>;
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smtp-heal-"));
    for (let i = 0; ; i++) {
      try {
        srv = await mod.startMailTestServer({ dir, base: 33000 + Math.floor(Math.random() * 900) * 10 });
        break;
      } catch (err) {
        if (i >= 5 || !/EADDRINUSE/.test(String(err))) throw err;
      }
    }
    tls.setDefaultCACertificates([...tls.getCACertificates("default"), fs.readFileSync(srv.caFile, "utf8")]);
    process.env.MAIL_TEST_PROVIDERS = JSON.stringify([
      { domains: ["nastrojarstvi.test"], label: "hosting90 (test)",
        imap: [{ host: "127.0.0.1", port: srv.ports.imaps, tls: "tls" }], pop3: [], smtp: [{ host: "127.0.0.1", port: srv.ports.smtps, tls: "tls" }] },
    ]);
    svc = localAdmin();
    for (const [key, role] of [["u", "obchodnik"], ["a", "super_admin"]] as const) {
      const email = `${TAG}-${key}@local.test`;
      const { data, error } = await svc.auth.admin.createUser({ email, password: `Heslo-${TAG}-1!`, email_confirm: true, user_metadata: { full_name: `SMTP ${key}` } });
      if (error) throw new Error(error.message);
      await svc.from("profiles").update({ role, full_name: `SMTP ${key}`, active: true }).eq("id", data.user!.id);
      if (key === "u") userId = data.user!.id;
      else adminId = data.user!.id;
    }
    await svc.from("mailboxes").delete().eq("email", USER);
    const { data, error } = await svc.from("mailboxes").insert({
      email: USER, provider: "imap", owner_id: userId,
      config: {
        preset: "hosting90", incoming_protocol: "imap", imap_host: "127.0.0.1", imap_port: srv.ports.imaps, imap_tls: "tls", imap_user: USER, imap_password: PASS,
        smtp_host: "127.0.0.1", smtp_port: srv.ports.smtps, smtp_tls: "tls", smtp_password: STALE,
      },
    }).select("id").single();
    if (error) throw new Error(error.message);
    boxId = (data as { id: string }).id;
  }, 60_000);

  afterAll(async () => {
    if (boxId) {
      await svc.from("emails").delete().eq("mailbox_id", boxId);
      await svc.from("audit_log").delete().eq("entity_id", boxId);
      await svc.from("mailboxes").delete().eq("id", boxId);
    }
    for (const id of [userId, adminId]) if (id) await svc.auth.admin.deleteUser(id).catch(() => undefined);
    delete process.env.MAIL_TEST_PROVIDERS;
    await srv?.close();
  });

  it("odeslání: uložené SMTP heslo 535 → heslo schránky projde → SMTP heslo smazáno + audit", async () => {
    session.current = { id: userId, email: `${TAG}-u@local.test`, fullName: "SMTP u", role: "obchodnik" };
    const { sendTestMail } = await import("./send");
    const before = smtpAuths();
    const sent = srv.sent.length;
    const r = await sendTestMail(boxId, "test");
    expect(r.sent, r.reason).toBe(true);
    expect(srv.sent.length).toBe(sent + 1);
    expect(smtpAuths() - before).toBe(2); // staré SMTP heslo (535) + heslo schránky
    const c = await cfg();
    expect(c.smtp_password).toBeUndefined();
    expect(c.imap_password).toBe(PASS);
    const { data: audit } = await svc.from("audit_log").select("action, diff").eq("entity_id", boxId).eq("action", "mailbox_smtp_password_healed");
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(STALE);
    expect(JSON.stringify(audit)).not.toContain(PASS);
    // další odeslání: rovnou heslem schránky, jedno přihlášení
    const b2 = smtpAuths();
    expect((await sendTestMail(boxId, "test")).sent).toBe(true);
    expect(smtpAuths() - b2).toBe(1);
  }, 60_000);

  it("obě hesla špatně → neodešlo; hláška: server:port, šifrování, AUTH, zdroj hesla, co dál; nic se nemaže", async () => {
    await setCfg({ imap_password: "Spatne-heslo-schranky", smtp_password: STALE });
    const { sendTestMail } = await import("./send");
    const before = smtpAuths();
    const r = await sendTestMail(boxId, "test");
    expect(r.sent).toBe(false);
    expect(smtpAuths() - before).toBe(3); // nejvýš 3 pokusy (hosting90 při mnoha chybách blokuje IP)
    expect(r.reason).toMatch(/^Odeslání selhalo — Přihlášení odmítnuto — server 127\.0\.0\.1 nepřijal uživatele nebo heslo \(uživatel smtpheal@nastrojarstvi\.test\)/);
    expect(r.reason).toContain(`127.0.0.1:${srv.ports.smtps} SSL/TLS · AUTH PLAIN · vlastní SMTP heslo → odmítnuto`);
    expect(r.reason).toContain("heslo příchozí pošty → odmítnuto");
    expect(r.reason).toContain("AUTH LOGIN");
    expect(r.reason).toContain("Můj účet → Moje e-mailová schránka → Upravit");
    expect(r.reason).not.toContain(STALE);
    expect((await cfg()).smtp_password).toBe(STALE);
  }, 60_000);

  it("Můj účet → Otestovat: SMTP OK až s heslem schránky → poznámka + oprava", async () => {
    await setCfg({ imap_password: PASS, smtp_password: STALE });
    const my = await import("./my-mailbox");
    const t = await my.testMine(userId, boxId);
    expect(t.incoming?.ok).toBe(true);
    expect(t.smtp?.ok).toBe(true);
    expect(t.smtp?.note).toMatch(/zastaralé SMTP heslo jsem smazal/);
    expect((await cfg()).smtp_password).toBeUndefined();
    const list = await my.listMyMailboxes(userId);
    expect(list[0].smtpPasswordSeparate).toBe(false);
  }, 60_000);

  it("Můj účet → Upravit (nové heslo / „Ověřit a uložit“) smaže staré vlastní SMTP heslo", async () => {
    await setCfg({ smtp_password: STALE });
    const my = await import("./my-mailbox");
    expect((await my.listMyMailboxes(userId))[0].smtpPasswordSeparate).toBe(true);
    const det = await my.detectMine(userId, { mailboxId: boxId, email: USER, password: PASS });
    expect(det.ok).toBe(true);
    const saved = await my.saveMine(userId, { mailboxId: boxId, email: USER, password: PASS, config: det.config! });
    expect(saved.ok).toBe(true);
    const c = await cfg();
    expect(c.smtp_password).toBeUndefined();
    expect(c.imap_password).toBe(PASS);
  }, 60_000);

  it("Nastavení (super admin): odškrtnuté „SMTP má jiné heslo“ smaže uložené SMTP heslo; zaškrtnuté ho při změně hesla schránky ponechá", async () => {
    session.current = { id: adminId, email: `${TAG}-a@local.test`, fullName: "SMTP a", role: "super_admin" };
    const { updateMailbox } = await import("@/app/actions/integrations");
    const base = { provider: "imap" as const, email: USER, config: { ...(await cfg()) } };
    delete base.config.imap_password;
    delete base.config.smtp_password;
    await setCfg({ smtp_password: STALE });
    expect((await updateMailbox(boxId, { ...base, secrets: { imap_password: PASS, keep_smtp_password: true } })).ok).toBe(true);
    expect((await cfg()).smtp_password).toBe(STALE);
    expect((await updateMailbox(boxId, { ...base, secrets: { clear_smtp_password: true } })).ok).toBe(true);
    const c = await cfg();
    expect(c.smtp_password).toBeUndefined();
    expect(c.imap_password).toBe(PASS);
  }, 60_000);
});
