import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_ENABLED, loadLocalEnv, localAdmin, localSql } from "@/test/local-supabase";

/**
 * Stahování pošty end-to-end proti lokálnímu Supabase + testovacímu poštovnímu serveru:
 * schránka v DB → syncMailbox → e-maily v DB, stav v mailbox_status (poslední stažení / chyba,
 * inkrementální stav), samooprava serveru (+ audit), zámek, srozumitelná chyba špatného hesla.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/email/mail-sync.integration.test.ts
 */

type Srv = {
  ports: Record<string, number>;
  caFile: string;
  events: { type: string; proto?: string; user?: string }[];
  sent: { from: string; to: string[]; raw: string }[];
  addMessage: (u: string, m: { subject: string }) => number;
  close: () => Promise<void>;
};
const USER = "kolega@mnastrojarna.test";
const PASS = "Kolega-Heslo-1";

describe.skipIf(!LOCAL_ENABLED)("stahování pošty ↔ lokální Supabase + testovací IMAP/POP3", () => {
  let srv: Srv;
  let svc: SupabaseClient;
  const ids: string[] = [];
  let ingest: typeof import("./ingest");

  beforeAll(async () => {
    const env = loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    delete process.env.ANTHROPIC_API_KEY; // bez AI
    const mod = (await import(path.resolve(__dirname, "../../../tools/e2e/mail-test-server.mjs"))) as {
      startMailTestServer: (o: { dir: string; base: number }) => Promise<Srv>;
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mail-sync-"));
    for (let i = 0; ; i++) {
      try {
        srv = await mod.startMailTestServer({ dir, base: 44000 + Math.floor(Math.random() * 900) * 10 });
        break;
      } catch (err) {
        if (i >= 5 || !/EADDRINUSE/.test(String(err))) throw err;
      }
    }
    tls.setDefaultCACertificates([...tls.getCACertificates("default"), fs.readFileSync(srv.caFile, "utf8")]);
    process.env.MAIL_TEST_PROVIDERS = JSON.stringify([
      { domains: ["mnastrojarna.test"], imap: [{ host: "127.0.0.1", port: srv.ports.imaps, tls: "tls" }], pop3: [], smtp: [] },
    ]);
    svc = localAdmin();
    ingest = await import("./ingest");
  }, 60_000);

  afterAll(async () => {
    if (ids.length) {
      await svc.from("emails").delete().in("mailbox_id", ids);
      await svc.from("mailboxes").delete().in("id", ids);
    }
    delete process.env.MAIL_TEST_PROVIDERS;
    await srv?.close();
  });

  async function newBox(email: string, config: Record<string, unknown>): Promise<string> {
    await svc.from("mailboxes").delete().eq("email", email);
    const { data, error } = await svc.from("mailboxes").insert({ provider: "imap", email, config }).select("id").single();
    if (error) throw new Error(error.message);
    ids.push((data as { id: string }).id);
    return (data as { id: string }).id;
  }
  const status = async (id: string) =>
    (await svc.from("mailbox_status").select("*").eq("mailbox_id", id).single()).data as Record<string, unknown>;

  it("IMAP: stažení do DB, stav + inkrementálně jen nové; samooprava uloženého serveru", async () => {
    // uložený server nefunguje (jako mail.<vlastní doména>) → ověřený server poskytovatele
    const id = await newBox(USER, { imap_host: "mail.nastrojarstvi.invalid", imap_port: 993, imap_user: USER, imap_password: PASS });
    const r1 = await ingest.syncMailbox({ mailboxIds: [id], limit: 20 });
    expect(r1.boxes?.[0]).toMatchObject({ ok: true, fetched: 3, ingested: 3, source: "imap" });
    expect(r1.boxes?.[0].healed).toBe(`127.0.0.1:${srv.ports.imaps}`);
    const { data: box } = await svc.from("mailboxes").select("config").eq("id", id).single();
    expect((box as { config: Record<string, unknown> }).config).toMatchObject({ imap_host: "127.0.0.1", imap_port: srv.ports.imaps, imap_tls: "tls", imap_password: PASS });
    expect(localSql(`select count(*) from audit_log where action = 'mailbox_autofixed' and entity_id = '${id}'`)).toBe("1");
    const st = await status(id);
    expect(st.last_sync_error).toBeNull();
    expect(st.last_sync_ok_at).toBeTruthy();
    expect(st.sync_state).toMatchObject({ imap: { uidValidity: "1700000000", lastUid: 3 } });
    const { count } = await svc.from("emails").select("id", { count: "exact", head: true }).eq("mailbox_id", id);
    expect(count).toBe(3);

    const r2 = await ingest.syncMailbox({ mailboxIds: [id], limit: 20 });
    expect(r2.boxes?.[0]).toMatchObject({ ok: true, fetched: 0, ingested: 0 });
    srv.addMessage(USER, { subject: "Inkrementální zpráva" });
    const r3 = await ingest.syncMailbox({ mailboxIds: [id], limit: 20 });
    expect(r3.boxes?.[0]).toMatchObject({ ok: true, fetched: 1, ingested: 1 });
    expect((await status(id)).sync_state).toMatchObject({ imap: { lastUid: 4 } });

    // automatické stažení hned potom → přeskočeno (poslední pokus < 2 min)
    const auto = await ingest.syncMailbox({ mailboxIds: [id], auto: true });
    expect(auto.boxes?.[0]).toMatchObject({ ok: true, skipped: "recent" });
  }, 60_000);

  it("špatné heslo → česká chyba uložená ke schránce; neúplná schránka → co chybí", async () => {
    const id = await newBox("spatne@mnastrojarna.test", { imap_host: "127.0.0.1", imap_port: srv.ports.imaps, imap_user: USER, imap_password: "spatne" });
    const r = await ingest.syncMailbox({ mailboxIds: [id] });
    expect(r.boxes?.[0].ok).toBe(false);
    expect(r.message).toMatch(/Přihlášení odmítnuto/);
    expect(String((await status(id)).last_sync_error)).toMatch(/^spatne@mnastrojarna\.test: Přihlášení odmítnuto/);

    const empty = await newBox("prazdna@mnastrojarna.test", {});
    const e = await ingest.syncMailbox({ mailboxIds: [empty] });
    expect(e.configured).toBe(false);
    expect(e.message).toMatch(/nemá vyplněno: příchozí server, heslo/);
  }, 30_000);

  it("zámek: souběžné stažení stejné schránky se nespustí dvakrát", async () => {
    const id = ids[0];
    localSql(`update mailbox_status set sync_lock_until = now() + interval '1 minute' where mailbox_id = '${id}'`);
    const r = await ingest.syncMailbox({ mailboxIds: [id] });
    expect(r.boxes?.[0]).toMatchObject({ ok: true, skipped: "locked" });
    localSql(`update mailbox_status set sync_lock_until = null where mailbox_id = '${id}'`);
  });

  it("odmítnuté heslo: automatika (otevření pošty, plánovač) se znovu NEpřihlašuje; ručně ano; po opravě hesla zase automaticky", async () => {
    const id = await newBox("blok@mnastrojarna.test", { imap_host: "127.0.0.1", imap_port: srv.ports.imaps, imap_user: USER, imap_password: "spatne-heslo" });
    const logins = () => srv.events.filter((e) => e.type === "auth" && e.proto === "imap" && e.user === USER).length;
    const n0 = logins();
    const r1 = await ingest.syncMailbox({ mailboxIds: [id] }); // plánovač
    expect(r1.boxes?.[0]).toMatchObject({ ok: false });
    expect(logins()).toBe(n0 + 1);
    const st = await status(id);
    expect(st.last_sync_error_kind).toBe("auth");
    expect(String(st.last_sync_auth_fp)).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(st)).not.toContain("spatne-heslo");

    // plánovač ani otevření Přijaté pošty se se stejným heslem nepřihlásí (blokace IP u hosting90)
    const cron = await ingest.syncMailbox({ mailboxIds: [id] });
    expect(cron.boxes?.[0]).toMatchObject({ ok: false, skipped: "auth" });
    expect(cron.message).toMatch(/Heslo odmítnuto — oprav ho v Nastavení/);
    localSql(`update mailbox_status set last_sync_attempt_at = now() - interval '10 minutes' where mailbox_id = '${id}'`);
    const auto = await ingest.syncMailbox({ mailboxIds: [id], auto: true });
    expect(auto.boxes?.[0]).toMatchObject({ skipped: "auth" });
    expect(logins()).toBe(n0 + 1);

    // ruční tlačítko to zkusí znovu
    const manual = await ingest.syncMailbox({ mailboxIds: [id], manual: true });
    expect(manual.boxes?.[0]).toMatchObject({ ok: false });
    expect(manual.boxes?.[0].skipped).toBeUndefined();
    expect(logins()).toBe(n0 + 2);

    // oprava hesla (změna konfigurace) → automatika zase stahuje, stav chyby se vyčistí
    await svc.from("mailboxes").update({ config: { imap_host: "127.0.0.1", imap_port: srv.ports.imaps, imap_user: USER, imap_password: PASS } }).eq("id", id);
    const fixed = await ingest.syncMailbox({ mailboxIds: [id] });
    expect(fixed.boxes?.[0]).toMatchObject({ ok: true });
    expect(logins()).toBe(n0 + 3);
    const st2 = await status(id);
    expect(st2.last_sync_error_kind).toBeNull();
    expect(st2.last_sync_auth_fp).toBeNull();
  }, 60_000);

  it("časový limit: s méně než 60 s do konce se nezačne další schránka (žádné přihlášení), zámek zůstane volný", async () => {
    const a = await newBox("limit-a@mnastrojarna.test", { imap_host: "127.0.0.1", imap_port: srv.ports.imaps, imap_user: USER, imap_password: PASS });
    const b = await newBox("limit-b@mnastrojarna.test", { imap_host: "127.0.0.1", imap_port: srv.ports.imaps, imap_user: USER, imap_password: PASS });
    const n0 = srv.events.filter((e) => e.type === "auth").length;
    const r = await ingest.syncMailbox({ mailboxIds: [a, b], deadline: Date.now() + ingest.SYNC_RESERVE_MS - 1_000 });
    expect(r.boxes?.map((x) => x.skipped)).toEqual(["deadline", "deadline"]);
    expect(r.message).toMatch(/nestihlo se v časovém limitu/);
    expect(srv.events.filter((e) => e.type === "auth").length).toBe(n0);
    for (const id of [a, b]) {
      expect(localSql(`select count(*) from mailbox_status where mailbox_id = '${id}' and sync_lock_until > now()`)).toBe("0");
    }
    const { count } = await svc.from("emails").select("id", { count: "exact", head: true }).in("mailbox_id", [a, b]);
    expect(count).toBe(0);
    // s dostatkem času se stáhne normálně
    const ok = await ingest.syncMailbox({ mailboxIds: [a], deadline: Date.now() + ingest.SYNC_RESERVE_MS + 60_000 });
    expect(ok.boxes?.[0]).toMatchObject({ ok: true, ingested: 4 });
    expect(localSql(`select count(*) from mailbox_status where mailbox_id = '${a}' and sync_lock_until is null`)).toBe("1");
  }, 60_000);

  it("odeslání: schránka uživatele bez SMTP / vypnutá → neodejde pod jinou (firemní) adresou; s SMTP z vlastní schránky", async () => {
    const send = await import("./send");
    // vlastní testovací uživatel (sdílené seed účty se nemění)
    const email = `odesilatel.${Date.now()}@local.test`;
    const { data: created, error } = await svc.auth.admin.createUser({ email, password: "Odesilatel-123!", email_confirm: true });
    if (error) throw new Error(error.message);
    const uid = created.user!.id;
    try {
      const smtp = { smtp_host: "127.0.0.1", smtp_port: srv.ports.smtps, smtp_tls: "tls", smtp_user: USER, smtp_password: PASS };
      // firemní schránka (bez vlastníka) S odesíláním — dřív na ni spadlo odeslání uživatele bez SMTP
      await newBox("firemni-smtp@mnastrojarna.test", { imap_host: "127.0.0.1", imap_password: PASS, ...smtp });
      // vlastní schránky uživatele: bez SMTP + vypnutá s SMTP
      const bez = await newBox("bez-smtp@mnastrojarna.test", { imap_host: "127.0.0.1", imap_password: PASS });
      const vyp = await newBox("vypnuta-smtp@mnastrojarna.test", { imap_host: "127.0.0.1", imap_password: PASS, ...smtp });
      await svc.from("mailboxes").update({ owner_id: uid }).in("id", [bez, vyp]);
      await svc.from("mailboxes").update({ active: false }).eq("id", vyp);

      const sentBefore = srv.sent.length;
      const r = await send.sendMail({ to: "zakaznik@test.cz", subject: "Nabídka", text: "x", from: { ownerId: uid }, log: false });
      expect(r.sent).toBe(false);
      expect(r.reason).toMatch(/^Tvoje schránka nemá nastavené odesílání — doplň odchozí server \(SMTP\) v Nastavení → E-mailové schránky, nebo požádej admina/);
      const r2 = await send.sendMail({ to: "zakaznik@test.cz", subject: "Nabídka", text: "x", from: { mailboxId: vyp }, log: false });
      expect(r2.sent).toBe(false);
      expect(r2.reason).toMatch(/vypnutá/);
      expect(await send.isSmtpConfigured({ ownerId: uid })).toBe(false);
      expect(srv.sent.length).toBe(sentBefore); // nic neodešlo pod firemní adresou

      // uživatel má aktivní schránku s odesíláním → odejde z ní
      await svc.from("mailboxes").update({ active: true }).eq("id", vyp);
      const ok = await send.sendMail({ to: "zakaznik@test.cz", subject: "Nabídka OK", text: "x", from: { ownerId: uid }, log: false });
      expect(ok).toMatchObject({ sent: true });
      expect(srv.sent.at(-1)?.raw).toMatch(/^From: [^\n]*(\r?\n\s+[^\n]*)?<vypnuta-smtp@mnastrojarna\.test>/m);
      expect(srv.sent.at(-1)?.from).toMatch(/vypnuta-smtp@mnastrojarna\.test/);

      // schránka s odesíláním přes lokální mail catcher bez TLS (jako seed E2E obchodníka)
      await svc.from("mailboxes").update({ active: false }).eq("id", vyp);
      const env = loadLocalEnv();
      const catcher = await newBox("catcher-smtp@mnastrojarna.test", { smtp_host: "127.0.0.1", smtp_port: Number(env.SMTP_PORT || 54325), smtp_user: "catcher-smtp@mnastrojarna.test", smtp_password: "test" });
      await svc.from("mailboxes").update({ owner_id: uid }).eq("id", catcher);
      const to = `prijemce.${Date.now()}@test.cz`;
      const viaCatcher = await send.sendMail({ to, subject: "Přes catcher", text: "x", from: { ownerId: uid }, log: false });
      expect(viaCatcher).toMatchObject({ sent: true });
      const api = env.LOCAL_MAIL_API || "http://127.0.0.1:54324";
      const msgs = (await (await fetch(`${api}/messages?to=${encodeURIComponent(to)}`)).json()) as unknown[];
      expect(JSON.stringify(msgs)).toContain("catcher-smtp@mnastrojarna.test");
    } finally {
      await svc.from("mailboxes").delete().eq("owner_id", uid);
      await svc.auth.admin.deleteUser(uid);
    }
  }, 60_000);
});
