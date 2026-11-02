import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_ENABLED, loadLocalEnv, localAdmin, localSession, localSql } from "@/test/local-supabase";
import { LOCKOUT_TEXT } from "./auth-lockout";

/**
 * Blokace přihlášení po odmítnutém hesle (2. 11.) proti lokálnímu Supabase + testovacímu poštovnímu serveru:
 *  - odmítnuté heslo (test připojení) → další test / ruční stažení / živé stahování / plánovač / zkouška
 *    odeslání se 60 min NEpřihlásí (žádné přihlášení na serveru), tlačítka dostanou důvod a čas,
 *  - časový limit (němý server) krátce po odmítnutí: neznámý server = obyčejná hláška; server, na kterém jiná
 *    schránka nedávno fungovala = „Hosting pravděpodobně dočasně zablokoval …" (test i stahování),
 *  - nové heslo → hned znovu, úspěch blokaci smaže,
 *  - profiles.ui_prefs: RPC sloučí klíč, cizí předvolby nejdou (RLS + trigger), neplatný klíč odmítne.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/email/mail-lockout.integration.test.ts
 */

type Srv = {
  ports: Record<string, number>;
  caFile: string;
  events: { type: string; user?: string; proto?: string }[];
  close: () => Promise<void>;
};

const BOX = "zamek@nastrojarstvi.test";
const PASS = "Zamek-Heslo-1";

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

describe.skipIf(!LOCAL_ENABLED)("Pošta — blokace po odmítnutém hesle a dočasná blokace u hostingu", () => {
  let srv: Srv;
  let svc: SupabaseClient;
  const TAG = `lock${Date.now()}`;
  const users: { me?: { id: string; email: string }; other?: { id: string; email: string } } = {};
  let boxId = "";
  let otherBoxId = "";
  const logins = () => srv.events.filter((e) => (e.type === "auth") && e.user === BOX).length;
  const status = () => localSql(`select coalesce(auth_fail_where,'') || '|' || auth_fail_count || '|' || (auth_fail_at is not null) from mailbox_status where mailbox_id = '${boxId}'`);
  const servers = (port: number, smtpPort = srv.ports.smtps) => ({
    preset: "other" as const, incoming_protocol: "imap" as const, imap_host: "127.0.0.1", imap_port: port, imap_tls: "tls" as const, imap_user: BOX,
    smtp_host: "127.0.0.1", smtp_port: smtpPort, smtp_tls: "tls" as const,
  });

  beforeAll(async () => {
    const env = loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.MAIL_TEST_PROVIDERS;
    const mod = (await import(path.resolve(__dirname, "../../../tools/e2e/mail-test-server.mjs"))) as {
      startMailTestServer: (o: { dir: string; base: number }) => Promise<Srv>;
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mail-lock-"));
    for (let i = 0; ; i++) {
      try {
        srv = await mod.startMailTestServer({ dir, base: 38000 + Math.floor(Math.random() * 600) * 10 });
        break;
      } catch (err) {
        if (i >= 5 || !/EADDRINUSE/.test(String(err))) throw err;
      }
    }
    tls.setDefaultCACertificates([...tls.getCACertificates("default"), fs.readFileSync(srv.caFile, "utf8")]);
    svc = localAdmin();
    for (const key of ["me", "other"] as const) {
      const email = `${TAG}-${key}@local.test`;
      const { data, error } = await svc.auth.admin.createUser({ email, password: `Heslo-${TAG}-1!`, email_confirm: true, user_metadata: { full_name: key } });
      if (error) throw new Error(error.message);
      users[key] = { id: data.user!.id, email };
      await svc.from("profiles").update({ role: "obchodnik", active: true }).eq("id", data.user!.id);
    }
    await svc.from("mailboxes").delete().eq("email", BOX);
  }, 60_000);

  afterAll(async () => {
    for (const u of [users.me, users.other]) {
      if (!u) continue;
      await svc.from("emails").delete().eq("owner_id", u.id);
      await svc.from("mailboxes").delete().eq("owner_id", u.id);
      await svc.auth.admin.deleteUser(u.id).catch(() => undefined);
    }
    await srv?.close();
  });

  it("odmítnuté heslo → další test, ruční i automatické stažení a zkouška odeslání se 60 min nepřihlásí", async () => {
    const my = await import("./my-mailbox");
    const saved = await my.saveMine(users.me!.id, { email: BOX, password: "Spatne-Heslo-9", config: servers(srv.ports.imaps) });
    expect(saved.ok).toBe(true);
    boxId = saved.id!;

    const first = await my.testMine(users.me!.id, boxId);
    expect(first.incoming?.ok).toBe(false);
    expect(first.incoming?.kind).toBe("auth");
    expect(status()).toBe("test|1|true");
    const after = logins();

    // znovu Otestovat připojení → bez přihlášení, důvod + čas dalšího pokusu
    const again = await my.testMine(users.me!.id, boxId);
    expect(again.incoming).toBeNull();
    expect(again.authLock?.blocked).toBe(true);
    expect(again.error).toMatch(/Heslo bylo odmítnuto[\s\S]*to zkus znovu po\s\d{1,2}\D\d{2}/);
    // „Najít nastavení" bez nového hesla také ne
    const det = await my.detectMine(users.me!.id, { mailboxId: boxId, email: BOX });
    expect(det.ok).toBe(false);
    expect(det.error).toMatch(/Heslo bylo odmítnuto/);

    // ruční „Stáhnout" i automatika (živá pošta 30 s, plánovač) → přeskočeno, s časem
    const ingest = await import("./ingest");
    for (const opts of [{ manual: true }, { auto: true, minIntervalMs: 0 }, {}]) {
      const r = await ingest.syncMailbox({ mailboxIds: [boxId], ...opts });
      const box = r.boxes?.find((b) => b.id === boxId);
      expect(box?.skipped).toBe("auth");
      expect(box?.error).toMatch(/Heslo bylo odmítnuto/);
      expect(box?.retryAt).toBeTruthy();
    }
    // Vyzkoušet odeslání → neodešle se, bez SMTP přihlášení
    const send = await my.testSendMine(users.me!.id, boxId);
    expect(send.sent).toBe(false);
    expect(send.text).toMatch(/Heslo bylo odmítnuto/);
    expect(logins()).toBe(after);

    // karta schránky: tlačítka dostanou důvod a čas
    const card = (await my.listMyMailboxes(users.me!.id)).find((b) => b.id === boxId)!;
    expect(card.authRetryAt).toBeTruthy();
    expect(card.authLockReason).toMatch(/Změň heslo/);
  }, 60_000);

  it("časový limit po odmítnutí: neznámý server = obyčejná hláška; server ověřený jinou schránkou = blokace hostingu", async () => {
    const my = await import("./my-mailbox");
    // hodina uplynula; stejné heslo, ale server mlčí (jako hosting90 po zablokování IP)
    localSql(`update mailbox_status set auth_fail_at = now() - interval '61 minutes' where mailbox_id = '${boxId}'`);
    const saved = await my.saveMine(users.me!.id, { mailboxId: boxId, email: BOX, config: servers(srv.ports.blackhole, srv.ports.blackhole) });
    expect(saved.ok).toBe(true);
    const plain = await my.testMine(users.me!.id, boxId);
    expect(plain.incoming?.ok).toBe(false);
    expect(["timeout", "greeting"]).toContain(plain.incoming?.kind);
    expect(plain.incoming?.error).not.toContain(LOCKOUT_TEXT);
    expect(plain.incoming?.hostLockout).toBeFalsy();

    // jiná schránka (kolega) se na stejném serveru před chvílí úspěšně stáhla → server je „známý"
    const { data: ob } = await svc.from("mailboxes").insert({
      email: `${TAG}-kolega@nastrojarstvi.test`, provider: "imap", owner_id: users.other!.id,
      config: { imap_host: "127.0.0.1", imap_port: srv.ports.imaps, imap_password: "x", smtp_host: "127.0.0.1" },
    }).select("id").single();
    otherBoxId = (ob as { id: string }).id;
    localSql(`insert into mailbox_status (mailbox_id, last_sync_ok_at) values ('${otherBoxId}', now()) on conflict (mailbox_id) do update set last_sync_ok_at = now()`);

    const host = await my.testMine(users.me!.id, boxId);
    expect(host.incoming?.hostLockout).toBe(true);
    expect(host.incoming?.error).toBe(LOCKOUT_TEXT);
    expect(status()).toMatch(/^host\|/);
    // a hned další pokus je zablokovaný s tímtéž vysvětlením
    const blocked = await my.testMine(users.me!.id, boxId);
    expect(blocked.authLock?.blocked).toBe(true);
    expect(blocked.error).toContain(LOCKOUT_TEXT);

    // stahování: stejné vysvětlení místo „špatný server nebo port"
    localSql(`update mailbox_status set auth_fail_at = now() - interval '61 minutes', auth_fail_where = 'sync' where mailbox_id = '${boxId}'`);
    const ingest = await import("./ingest");
    const r = await ingest.syncMailbox({ mailboxIds: [boxId], manual: true });
    const box = r.boxes?.find((b) => b.id === boxId);
    expect(box?.ok).toBe(false);
    expect(box?.error).toBe(`${BOX}: ${LOCKOUT_TEXT}`);
    expect(status()).toMatch(/^host\|/);
  }, 90_000);

  it("nové (správné) heslo → hned znovu; úspěch blokaci i pozastavené automatické stahování smaže", async () => {
    const my = await import("./my-mailbox");
    const saved = await my.saveMine(users.me!.id, { mailboxId: boxId, email: BOX, password: PASS, config: servers(srv.ports.imaps) });
    expect(saved.ok).toBe(true);
    const ok = await my.testMine(users.me!.id, boxId);
    expect(ok.incoming?.ok).toBe(true);
    expect(ok.smtp?.ok).toBe(true);
    expect(status()).toBe("|0|false");
    const card = (await my.listMyMailboxes(users.me!.id)).find((b) => b.id === boxId)!;
    expect(card.authRetryAt).toBeNull();
    const ingest = await import("./ingest");
    const r = await ingest.syncMailbox({ mailboxIds: [boxId], manual: true });
    expect(r.boxes?.find((b) => b.id === boxId)?.ok).toBe(true);
  }, 60_000);

  it("stažení s odmítnutým heslem zapíše blokaci; plánovač ani živá pošta to pak nezkouší", async () => {
    const my = await import("./my-mailbox");
    // heslo změněné na serveru (uložené už neplatí): simulace = uložit špatné
    await my.saveMine(users.me!.id, { mailboxId: boxId, email: BOX, password: "Zase-Spatne-1", config: servers(srv.ports.imaps) });
    const ingest = await import("./ingest");
    const first = await ingest.syncMailbox({ mailboxIds: [boxId], manual: true });
    expect(first.boxes?.find((b) => b.id === boxId)?.error).toMatch(/Přihlášení odmítnuto/);
    expect(status()).toBe("sync|1|true");
    const n = logins();
    const live = await ingest.syncMailbox({ mailboxIds: [boxId], auto: true, minIntervalMs: 0 });
    const cron = await ingest.syncMailbox({ mailboxIds: [boxId] });
    expect(live.boxes?.[0]?.skipped).toBe("auth");
    expect(cron.boxes?.[0]?.skipped).toBe("auth");
    expect(logins()).toBe(n);
  }, 60_000);

  it("profiles.ui_prefs: sloučení klíče, smazání, cizí předvolby nejdou, neplatný klíč ne", async () => {
    const me = users.me!;
    const other = users.other!;
    const set = await svc.rpc("ui_prefs_set", { p_user: me.id, p_key: "mail.listWidth", p_value: 420 });
    expect(set.error).toBeNull();
    await svc.rpc("ui_prefs_set", { p_user: me.id, p_key: "mail.foldersCollapsed", p_value: true });
    expect(localSql(`select ui_prefs::text from profiles where id = '${me.id}'`)).toBe('{"mail.listWidth": 420, "mail.foldersCollapsed": true}');
    await svc.rpc("ui_prefs_set", { p_user: me.id, p_key: "mail.foldersCollapsed", p_value: null });
    expect(localSql(`select ui_prefs::text from profiles where id = '${me.id}'`)).toBe('{"mail.listWidth": 420}');
    expect((await svc.rpc("ui_prefs_set", { p_user: me.id, p_key: "role", p_value: "x" })).error).not.toBeNull();

    // přihlášený uživatel: jen svůj řádek
    const sess = await localSession(me.email, `Heslo-${TAG}-1!`);
    const own = await sess.rpc("set_my_ui_pref", { p_key: "mail.listWidth", p_value: 380 });
    expect(own.error).toBeNull();
    expect((own.data as Record<string, unknown>)["mail.listWidth"]).toBe(380);
    // servisní RPC session nesmí (zápis za jiného uživatele)
    expect((await sess.rpc("ui_prefs_set", { p_user: other.id, p_key: "mail.listWidth", p_value: 999 })).error).not.toBeNull();
    // přímý UPDATE cizího profilu: RLS řádek nevidí / trigger odmítne → beze změny
    await sess.from("profiles").update({ ui_prefs: { "mail.listWidth": 999 } }).eq("id", other.id);
    expect(localSql(`select ui_prefs::text from profiles where id = '${other.id}'`)).toBe("{}");
    // super admin přes REST cizí předvolby také ne (trigger)
    expect(() => localSql(`begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${me.id}","role":"authenticated"}', true); update profiles set ui_prefs = '{"x.y":1}' where id = '${other.id}'; commit;`)).not.toThrow();
    expect(localSql(`select ui_prefs::text from profiles where id = '${other.id}'`)).toBe("{}");
    expect(() => localSql(`do $$ begin perform set_config('request.jwt.claims', '{"sub":"${me.id}","role":"authenticated"}', true); update profiles set ui_prefs = '{"x.y":1}' where id = '${other.id}'; end $$;`)).toThrow(/Předvolby vzhledu si upravuje každý sám/);
  }, 60_000);
});
