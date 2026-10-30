import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_ENABLED, loadLocalEnv, localAdmin, localSql } from "@/test/local-supabase";

/**
 * Pošta A end-to-end proti lokálnímu Supabase + testovacímu poštovnímu serveru (IMAP s Odeslanými +
 * APPEND, SMTP): vlastní schránka v Můj účet → stažení CELÉ schránky (≥ 150 zpráv) po dávkách s
 * průběhem → odpověď + nová zpráva + přeposlání s přílohou → uloženo jako odchozí, kopie v
 * Odeslaných na serveru, vlákno (In-Reply-To) → vlaječka / priorita / předání kolegovi s autorem →
 * viditelnost (kolega B nevidí osobní schránku A ani její poštu, hesla nikdy v odpovědích).
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/email/mail-a.integration.test.ts
 */

type Srv = {
  ports: Record<string, number>;
  caFile: string;
  events: { type: string; user?: string; folder?: string }[];
  sent: { from: string; to: string[]; raw: string }[];
  addMessage: (u: string, m: Record<string, unknown>) => number;
  addMessages: (u: string, n: number, o?: Record<string, unknown>) => number;
  folder: (u: string, name?: string) => { uid: number; messageId: string; raw: Buffer }[];
  lastMessageId: string | null;
  close: () => Promise<void>;
};

const USER = "jmeno@nastrojarstvi.test";
const PASS = "Spravne-Heslo-1";

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

describe.skipIf(!LOCAL_ENABLED)("Pošta A ↔ lokální Supabase + testovací IMAP/SMTP", () => {
  let srv: Srv;
  let svc: SupabaseClient;
  const users: { a?: { id: string; email: string }; b?: { id: string; email: string }; c?: { id: string; email: string } } = {};
  let boxId = "";
  let jobId = "";
  const TAG = `mailA${Date.now()}`;

  beforeAll(async () => {
    const env = loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    delete process.env.ANTHROPIC_API_KEY; // bez AI (pravidla + ai_pending)
    const mod = (await import(path.resolve(__dirname, "../../../tools/e2e/mail-test-server.mjs"))) as {
      startMailTestServer: (o: { dir: string; base: number }) => Promise<Srv>;
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mail-a-"));
    for (let i = 0; ; i++) {
      try {
        srv = await mod.startMailTestServer({ dir, base: 46000 + Math.floor(Math.random() * 900) * 10 });
        break;
      } catch (err) {
        if (i >= 5 || !/EADDRINUSE/.test(String(err))) throw err;
      }
    }
    tls.setDefaultCACertificates([...tls.getCACertificates("default"), fs.readFileSync(srv.caFile, "utf8")]);
    process.env.MAIL_TEST_PROVIDERS = JSON.stringify([
      { domains: ["nastrojarstvi.test", "mnastrojarna.test"], label: "hosting90 (test)",
        imap: [{ host: "127.0.0.1", port: srv.ports.imaps, tls: "tls" }], pop3: [], smtp: [{ host: "127.0.0.1", port: srv.ports.smtps, tls: "tls" }] },
    ]);
    svc = localAdmin();
    const NAMES = { a: "Adam Obchodník", b: "Bára Kolegyně", c: "Cyril Technolog" } as const;
    for (const key of ["a", "b", "c"] as const) {
      const email = `${TAG}-${key}@local.test`;
      const { data, error } = await svc.auth.admin.createUser({ email, password: `Heslo-${TAG}-1!`, email_confirm: true, user_metadata: { full_name: NAMES[key] } });
      if (error) throw new Error(error.message);
      users[key] = { id: data.user!.id, email };
      await svc.from("profiles").update({ role: "obchodnik", full_name: NAMES[key], active: true }).eq("id", data.user!.id);
    }
    await svc.from("mailboxes").delete().eq("email", USER);
  }, 60_000);

  afterAll(async () => {
    if (jobId) {
      await svc.from("job_files").delete().eq("job_id", jobId);
      await svc.from("quotes").delete().eq("job_id", jobId);
      await svc.from("orders").delete().eq("id", jobId);
    }
    if (boxId) {
      await svc.from("emails").delete().eq("mailbox_id", boxId);
      await svc.from("mailboxes").delete().eq("id", boxId);
    }
    for (const u of [users.a, users.b, users.c]) {
      if (!u) continue;
      await svc.from("emails").delete().eq("owner_id", u.id);
      await svc.from("mailboxes").delete().eq("owner_id", u.id);
      await svc.auth.admin.deleteUser(u.id).catch(() => undefined);
    }
    delete process.env.MAIL_TEST_PROVIDERS;
    await srv?.close();
  });

  const asA = () => { session.current = { id: users.a!.id, email: users.a!.email, fullName: "Adam Obchodník", role: "obchodnik" }; };
  const asB = () => { session.current = { id: users.b!.id, email: users.b!.email, fullName: "Bára Kolegyně", role: "obchodnik" }; };
  const asC = () => { session.current = { id: users.c!.id, email: users.c!.email, fullName: "Cyril Technolog", role: "obchodnik" }; };
  /** SELECT přes RLS jako přihlášený uživatel (REST cesta) — poslední řádek výstupu. */
  const rlsAs = (uid: string, select: string) =>
    localSql(`begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true); ${select}; rollback;`).split("\n").at(-1)!;

  it("Můj účet: e-mail + heslo → najde IMAP i SMTP, uloží s vlastníkem = já, heslo se nevrací", async () => {
    asA();
    const my = await import("./my-mailbox");
    const det = await my.detectMine(users.a!.id, { email: USER, password: PASS });
    expect(det.ok).toBe(true);
    expect(det.incoming).toMatchObject({ host: "127.0.0.1", port: srv.ports.imaps });
    expect(det.smtp).toMatchObject({ host: "127.0.0.1", port: srv.ports.smtps });
    const saved = await my.saveMine(users.a!.id, { email: USER, password: PASS, config: det.config! });
    expect(saved).toMatchObject({ ok: true });
    expect(saved.warning).toBeUndefined();
    boxId = saved.id!;
    const { data: row } = await svc.from("mailboxes").select("owner_id, config").eq("id", boxId).single();
    expect(row).toMatchObject({ owner_id: users.a!.id, config: { smtp_host: "127.0.0.1", imap_password: PASS } });
    const list = await my.listMyMailboxes(users.a!.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ email: USER, canSend: true, passwordStored: true });
    expect(JSON.stringify(list)).not.toContain(PASS);
    // cizí schránku nespravuji: B ji nevidí, nezmění, neodpojí
    expect(await my.listMyMailboxes(users.b!.id)).toEqual([]);
    expect((await my.removeMine(users.b!.id, boxId)).ok).toBe(false);
    expect((await my.saveMine(users.b!.id, { email: USER, password: "x", config: det.config! })).error).toMatch(/je už v aplikaci připojená/);
    expect((await my.testSendMine(users.b!.id, boxId)).sent).toBe(false);
  }, 60_000);

  it("„Vyzkoušet odeslání“: zkušební e-mail na vlastní adresu + kopie do Odeslaných (APPEND)", async () => {
    const my = await import("./my-mailbox");
    const before = srv.sent.length;
    const sentFolder = srv.folder(USER, "Sent").length;
    const r = await my.testSendMine(users.a!.id, boxId, "Adam");
    expect(r.sent).toBe(true);
    expect(r.sentCopy).toBe("ok");
    expect(r.text).toMatch(/Odesláno z jmeno@nastrojarstvi\.test na jmeno@nastrojarstvi\.test\. Kopie uložena do Odeslaných/);
    expect(srv.sent.length).toBe(before + 1);
    const copy = srv.folder(USER, "Sent");
    expect(copy.length).toBe(sentFolder + 1);
    expect(copy.at(-1)!.raw.equals(Buffer.from(srv.sent.at(-1)!.raw + "\r\n")) || copy.at(-1)!.raw.toString().includes(srv.sent.at(-1)!.raw.split("\r\n").find((l) => /^Message-ID:/i.test(l))!)).toBe(true); // stejná zpráva
  }, 30_000);

  it("stáhnout VŠE: ≥ 150 zpráv po dávkách s kurzorem, průběh klesá k 0, žádná duplicita; starší dostanou pravidla + ai_pending", async () => {
    srv.addMessages(USER, 160, { prefix: `Archiv ${TAG}`, stepHours: 6 });
    const ingest = await import("./ingest");
    const progress: { total: number; remaining: number }[] = [];
    let rounds = 0;
    for (;;) {
      const r = await ingest.syncMailbox({ mailboxIds: [boxId], limit: 30, maxMessages: 60, manual: true, deadline: Date.now() + ingest.SYNC_RESERVE_MS + 60_000 });
      rounds++;
      expect(r.boxes?.[0].ok).toBe(true);
      progress.push({ total: r.total ?? 0, remaining: r.remaining ?? 0 });
      if (r.done || rounds > 10) break;
    }
    expect(rounds).toBeGreaterThanOrEqual(3); // několik volání (UI volá znovu, dokud není hotovo)
    expect(progress[0].total).toBeGreaterThanOrEqual(163);
    expect(progress[0].remaining).toBeGreaterThan(0);
    for (let i = 1; i < progress.length; i++) expect(progress[i].remaining).toBeLessThan(progress[i - 1].remaining + 1);
    expect(progress.at(-1)!.remaining).toBe(0);
    const inbox = Number(localSql(`select count(*) from emails where mailbox_id = '${boxId}' and direction = 'in'`));
    expect(inbox).toBe(163);
    expect(localSql(`select count(*) from (select message_id from emails where mailbox_id = '${boxId}' group by message_id having count(*) > 1) d`)).toBe("0");
    // AI vypnutá → pravidla (kategorie / priorita) a příznak „AI později"
    expect(localSql(`select category || '|' || ai_pending from emails where mailbox_id = '${boxId}' and subject = 'Poptávka hřídele 50 ks'`)).toBe("poptavka|true");
    expect(localSql(`select category from emails where mailbox_id = '${boxId}' and subject = 'Objednávka 4500123'`)).toBe("objednavka");
    // stav: INBOX hotový až dolů, Odeslané (zkušební e-mail z předchozího testu) staženy jako odchozí
    const st = JSON.parse(localSql(`select sync_state from mailbox_status where mailbox_id = '${boxId}'`));
    expect(st.imap).toMatchObject({ uidValidity: "1700000000", backfillBelow: 1 });
    expect(st.imapSent).toMatchObject({ path: "Sent" });
    expect(localSql(`select count(*) from emails where mailbox_id = '${boxId}' and direction = 'out' and subject like 'Test odeslání z aplikace%'`)).toBe("1");
    // další stažení: nic nového
    const again = await ingest.syncMailbox({ mailboxIds: [boxId], manual: true });
    expect(again.boxes?.[0]).toMatchObject({ ok: true, ingested: 0, remaining: 0 });
  }, 180_000);

  let originalId = "";
  let threadId = "";
  let replyMessageId = "";

  it("odpověď z aplikace: z mé schránky, uložená jako odchozí ve vlákně, In-Reply-To/References, kopie v Odeslaných; zákazník odpoví → stejné vlákno", async () => {
    asA();
    const { data: orig } = await svc.from("emails").select("id, message_id, thread_id, from_email").eq("mailbox_id", boxId).eq("subject", "Poptávka hřídele 50 ks").single();
    originalId = (orig as { id: string }).id;
    threadId = (orig as { thread_id: string }).thread_id;
    const compose = await import("@/app/actions/mail-compose");
    const ctx = await compose.composeContextAction({ sourceEmailId: originalId });
    expect(ctx).toMatchObject({ ok: true, from: USER });
    const sentBefore = srv.sent.length;
    const res = await compose.sendComposedAction({
      mode: "reply", sourceEmailId: originalId, to: (orig as { from_email: string }).from_email, subject: "Re: Poptávka hřídele 50 ks",
      body: "Dobrý den, nabídku pošleme zítra.\n\n> Dobrý den,",
    });
    expect(res).toMatchObject({ ok: true, fromAddress: USER, sentCopy: "ok" });
    expect(srv.sent.length).toBe(sentBefore + 1);
    const raw = srv.sent.at(-1)!.raw;
    expect(raw).toMatch(new RegExp(`^In-Reply-To: ${(orig as { message_id: string }).message_id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m"));
    expect(raw).toMatch(/^References: /m);
    const { data: out } = await svc.from("emails").select("direction, thread_id, in_reply_to, message_id, owner_id, mailbox_id, sent_copy, is_read").eq("id", res.emailId!).single();
    expect(out).toMatchObject({ direction: "out", thread_id: threadId, in_reply_to: (orig as { message_id: string }).message_id, owner_id: users.a!.id, mailbox_id: boxId, sent_copy: "ok", is_read: true });
    replyMessageId = (out as { message_id: string }).message_id;
    expect(srv.folder(USER, "Sent").some((m) => m.messageId === replyMessageId)).toBe(true);

    // zákazník odpoví (In-Reply-To = naše zpráva) → po stažení ve stejném vlákně (Date má přesnost na sekundy)
    await new Promise((r) => setTimeout(r, 1100));
    srv.addMessage(USER, { subject: "Re: Poptávka hřídele 50 ks", body: "Děkujeme, čekáme.", from: "Jan Dvořák <dvorak@strojmetal.test>", inReplyTo: replyMessageId, references: `${(orig as { message_id: string }).message_id} ${replyMessageId}` });
    const ingest = await import("./ingest");
    await ingest.syncMailbox({ mailboxIds: [boxId], manual: true });
    expect(localSql(`select thread_id from emails where mailbox_id = '${boxId}' and body_text like 'Děkujeme, čekáme.%'`)).toBe(threadId);
    // kopie z Odeslaných se při stažení nezdvojí (stejné Message-ID)
    expect(localSql(`select count(*) from emails where mailbox_id = '${boxId}' and message_id = '${replyMessageId}'`)).toBe("1");

    const data = await import("@/lib/data/mail-threads");
    const thread = await data.getThread(threadId);
    expect(thread.ok).toBe(true);
    expect(thread.messages!.map((m) => m.direction)).toEqual(["in", "out", "in"]); // od nejstarší
    const sent = await data.listThreads({ folder: "sent" });
    expect(sent.items.some((t) => t.threadId === threadId)).toBe(true);
  }, 90_000);

  it("nová zpráva a přeposlání s původní přílohou (příloha ze serveru IMAP)", async () => {
    asA();
    const pdf = Buffer.from("%PDF-1.4 výkres H-200");
    srv.addMessage(USER, { subject: `Výkres ${TAG}`, body: "V příloze výkres.", from: "Eva <eva@firma.test>", attachments: [{ filename: "vykres-H200.pdf", contentType: "application/pdf", content: pdf }] });
    const ingest = await import("./ingest");
    await ingest.syncMailbox({ mailboxIds: [boxId], manual: true });
    const { data: em } = await svc.from("emails").select("id, has_attachments, imap_uid, imap_folder").eq("mailbox_id", boxId).eq("subject", `Výkres ${TAG}`).single();
    expect(em).toMatchObject({ has_attachments: true, imap_folder: "INBOX" });
    const { data: att } = await svc.from("email_attachments").select("id, filename, imap_part, storage_path").eq("email_id", (em as { id: string }).id);
    expect(att).toHaveLength(1);
    expect(att![0]).toMatchObject({ filename: "vykres-H200.pdf", imap_part: "2", storage_path: null });
    const loaded = await (await import("./attachments")).loadEmailAttachment((att![0] as { id: string }).id);
    expect(loaded.ok && loaded.file.content.equals(pdf)).toBe(true);

    const compose = await import("@/app/actions/mail-compose");
    // výkres zákazníka: komukoli mimo zákazníka by šla jen anonymizovaná kopie (mail-e) → kolega zákazníka (jeho doména) dostane originál
    const blockedFwd = await compose.sendComposedAction({
      mode: "forward", sourceEmailId: (em as { id: string }).id, to: "technolog@nekde.test", subject: `Fwd: Výkres ${TAG}`, body: "Posílám dál.",
      attachments: [{ kind: "original", ref: (att![0] as { id: string }).id }],
    });
    expect(blockedFwd.blocked?.[0]).toMatchObject({ kind: "original", reason: "pending" });
    await svc.from("drawing_anon_adhoc").delete().eq("user_id", users.a!.id);
    const fwd = await compose.sendComposedAction({
      mode: "forward", sourceEmailId: (em as { id: string }).id, to: "technolog@firma.test", subject: `Fwd: Výkres ${TAG}`, body: "Posílám dál.",
      attachments: [{ kind: "original", ref: (att![0] as { id: string }).id }],
    });
    expect(fwd).toMatchObject({ ok: true });
    expect(srv.sent.at(-1)!.raw).toContain("vykres-H200.pdf");
    expect(srv.sent.at(-1)!.raw).toContain(pdf.toString("base64").slice(0, 20));
    const { data: fwdRow } = await svc.from("emails").select("thread_id, has_attachments").eq("id", fwd.emailId!).single();
    expect(fwdRow).toMatchObject({ has_attachments: true });
    const { count } = await svc.from("email_attachments").select("id", { count: "exact", head: true }).eq("email_id", fwd.emailId!);
    expect(count).toBe(1); // příloha odeslané pošty uložená (další přeposlání)

    const fresh = await compose.sendComposedAction({ mode: "new", to: "novy@zakaznik.test", cc: "eva@firma.test", bcc: "archiv@my.test", subject: `Nová ${TAG}`, body: "Dobrý den" });
    expect(fresh).toMatchObject({ ok: true, sentCopy: "ok" });
    const raw = srv.sent.at(-1)!.raw;
    expect(raw).toMatch(/^Cc: eva@firma\.test/m);
    expect(raw).not.toMatch(/^Bcc:/m); // skrytá kopie jen v obálce
    expect(srv.sent.at(-1)!.to.join(" ")).toContain("archiv@my.test");
    const bad = await compose.sendComposedAction({ mode: "new", to: "neplatna-adresa", subject: "x", body: "x" });
    expect(bad.error).toMatch(/Neplatná adresa/);
  }, 90_000);

  it("vlaječka, priorita 1–5 a předání kolegovi — s autorem; B vidí jen předané vlákno", async () => {
    asA();
    const act = await import("@/app/actions/mail-inbox");
    expect((await act.setThreadFlagAction(threadId, true)).ok).toBe(true);
    expect((await act.setThreadPriorityAction(threadId, 1)).ok).toBe(true);
    expect((await act.setThreadPriorityAction(threadId, 7)).ok).toBe(false);
    expect(localSql(`select bool_and(flagged) || '|' || min(flagged_by::text) || '|' || min(priority_rank) || '|' || min(priority_set_by::text) from emails where thread_id = '${threadId}'`))
      .toBe(`true|${users.a!.id}|1|${users.a!.id}`);
    expect(Number(localSql(`select count(*) from audit_log where action in ('email_flagged','email_priority_set') and actor_id = '${users.a!.id}'`))).toBeGreaterThanOrEqual(2);

    const flagged = await act.listThreadsAction({ folder: "flagged" });
    expect(flagged.items.map((t) => t.threadId)).toEqual([threadId]);
    const p1 = await act.listThreadsAction({ folder: "inbox", priorityMax: 1 });
    expect(p1.items.map((t) => t.threadId)).toEqual([threadId]);
    const byPriority = await act.listThreadsAction({ folder: "inbox", sort: "priority" });
    expect(byPriority.items[0].threadId).toBe(threadId);
    expect(byPriority.total).toBeGreaterThan(150);
    const page2 = await act.listThreadsAction({ folder: "inbox", offset: 50, limit: 50 });
    expect(page2.items).toHaveLength(50);
    const search = await act.listThreadsAction({ folder: "all", query: "hřídele čekáme" });
    expect(search.items.map((t) => t.threadId)).toEqual([threadId]);

    const share = await act.shareThreadAction(threadId, [users.b!.id], "Prosím nacenit do pátku");
    expect(share).toMatchObject({ ok: true, shared: 1 });
    expect(localSql(`select shared_by || '|' || note from email_shares where thread_id = '${threadId}' and shared_with = '${users.b!.id}'`)).toBe(`${users.a!.id}|Prosím nacenit do pátku`);

    // B: osobní schránku A ani její poštu nevidí; předané vlákno ano (s poznámkou, nepřečtené)
    asB();
    const mail = await import("@/lib/data/mail");
    expect(await mail.getUnreadCount()).toBe(1);
    const inbox = await act.listThreadsAction({ folder: "inbox" });
    expect(inbox.items.map((t) => t.threadId)).toEqual([threadId]);
    expect(inbox.items[0].share).toMatchObject({ note: "Prosím nacenit do pátku", by: "Adam Obchodník", unread: true });
    const other = localSql(`select thread_id from emails where mailbox_id = '${boxId}' and subject = 'Objednávka 4500123'`);
    expect((await act.openThreadAction(other)).ok).toBe(false);
    expect((await act.setThreadFlagAction(other, true)).ok).toBe(false);
    const opened = await act.openThreadAction(threadId);
    expect(opened.ok).toBe(true);
    expect(opened.messages!.length).toBe(3);
    expect(await mail.getUnreadCount()).toBe(0);
    expect(localSql(`select read_at is not null from email_shares where thread_id = '${threadId}' and shared_with = '${users.b!.id}'`)).toBe("t");
    // B odpoví na předané vlákno: z osobní schránky A NE — B nemá schránku, firemní je bez SMTP → globální SMTP
    const compose = await import("@/app/actions/mail-compose");
    const ctx = await compose.composeContextAction({ sourceEmailId: originalId });
    expect(ctx.from).not.toBe(USER);
    const boxes = await mail.getMailboxesForUser();
    expect(boxes).toEqual([]);
    const all = JSON.stringify([inbox, opened, boxes, ctx]);
    expect(all).not.toContain(PASS);
    expect(all).not.toContain("imap_password");
  }, 90_000);


  // ── Opravy z review ──────────────────────────────────────────────────────────

  it("review #4: příloha IMAP jen ze STEJNÉ zprávy — po změně schránky na jiný účet se cizí soubor nevydá; po návratu se dohledá podle Message-ID", async () => {
    asA();
    const { data: em } = await svc.from("emails").select("id, imap_uid, imap_uidvalidity, message_id").eq("mailbox_id", boxId).eq("subject", `Výkres ${TAG}`).single();
    const row = em as { id: string; imap_uid: number; imap_uidvalidity: string | null; message_id: string };
    expect(row.imap_uidvalidity).toBe("1700000000");
    const { data: att } = await svc.from("email_attachments").select("id").eq("email_id", row.id).single();
    const attId = (att as { id: string }).id;
    const loader = await import("./attachments");
    // jiný účet má pod STEJNÝM UID jinou zprávu s přílohou (scénář z review)
    const OTHER = "kolega@mnastrojarna.test";
    const otherCount = srv.folder(OTHER, "INBOX").length;
    if (row.imap_uid - 1 > otherCount) srv.addMessages(OTHER, row.imap_uid - 1 - otherCount, { prefix: `Kolega ${TAG}` });
    const otherUid = srv.addMessage(OTHER, { subject: "Interní ceník", body: "x", from: "Ja <ja@firma.test>", attachments: [{ filename: "INTERNI-cenik.pdf", contentType: "application/pdf", content: Buffer.from("KOLEGA-INTERNI-CENIK") }] });
    expect(otherUid).toBe(row.imap_uid);
    const { data: mb } = await svc.from("mailboxes").select("email, config").eq("id", boxId).single();
    const orig = mb as { email: string; config: Record<string, unknown> };
    // a) schránka přepnutá přímo v DB (UID zůstalo) → kontrola Message-ID nepustí cizí zprávu
    await svc.from("mailboxes").update({ email: OTHER, config: { ...orig.config, imap_password: "Kolega-Heslo-1" } }).eq("id", boxId);
    const wrong = await loader.loadEmailAttachment(attId);
    expect(wrong.ok).toBe(false);
    expect(JSON.stringify(wrong)).not.toContain("INTERNI");
    await svc.from("mailboxes").update({ email: orig.email, config: orig.config }).eq("id", boxId);
    expect((await loader.loadEmailAttachment(attId)).ok).toBe(true);
    // b) změna adresy v Můj účet → UID se zahodí; zpět na původní účet → dohledá se podle Message-ID
    const my = await import("./my-mailbox");
    const cfg = { ...orig.config } as Record<string, unknown>;
    delete cfg.imap_password; delete cfg.smtp_password;
    expect((await my.saveMine(users.a!.id, { mailboxId: boxId, email: OTHER, password: "Kolega-Heslo-1", config: cfg })).ok).toBe(true);
    expect(localSql(`select coalesce(imap_uid::text, 'null') from emails where id = '${row.id}'`)).toBe("null");
    const gone = await loader.loadEmailAttachment(attId);
    expect(gone.ok).toBe(false);
    expect(JSON.stringify(gone)).not.toContain("INTERNI");
    expect((await my.saveMine(users.a!.id, { mailboxId: boxId, email: USER, password: PASS, config: cfg })).ok).toBe(true);
    const back = await loader.loadEmailAttachment(attId);
    expect(back.ok && back.file.content.toString()).toBe("%PDF-1.4 výkres H-200");
    expect(localSql(`select imap_uid || '|' || imap_uidvalidity from emails where id = '${row.id}'`)).toBe(`${row.imap_uid}|1700000000`);
  }, 90_000);

  it("review #1 + #2: stejná zpráva ve dvou schránkách = dvě vlákna; předání otevře jen schránku předaného e-mailu (RPC, RLS, detail, akce); kolega nečte poštu majiteli", async () => {
    const { data: bx, error } = await svc.from("mailboxes").insert({ email: `leak-b-${TAG}@local.test`, provider: "imap", owner_id: users.b!.id, config: {} }).select("id").single();
    expect(error).toBeNull();
    const boxB = (bx as { id: string }).id;
    try {
      const mid = `<leak-${TAG}@zakaznik.test>`;
      const base = { direction: "in", message_id: mid, from_email: "novak@zakaznik.test", to_email: USER, cc_email: `leak-b-${TAG}@local.test`, subject: `Poptávka leak ${TAG}`, body_text: "Prosím nabídku.", received_at: new Date(Date.now() - 7200_000).toISOString() };
      await svc.from("emails").insert([
        { ...base, mailbox_id: boxId, owner_id: users.a!.id },
        { ...base, mailbox_id: boxB, owner_id: users.b!.id },
      ]);
      await svc.from("emails").insert({
        mailbox_id: boxB, owner_id: users.b!.id, direction: "out", message_id: `<b-private-${TAG}@firma.test>`, in_reply_to: mid, message_refs: [mid],
        from_email: `leak-b-${TAG}@local.test`, to_email: "novak@zakaznik.test", subject: `Re: Poptávka leak ${TAG}`, body_text: `SOUKROMÉ ${TAG}: sleva 15 %`, received_at: new Date(Date.now() - 3600_000).toISOString(),
      });
      const tidA = localSql(`select thread_id from emails where mailbox_id = '${boxId}' and message_id = '${mid}'`);
      const tidB = localSql(`select thread_id from emails where mailbox_id = '${boxB}' and message_id = '${mid}'`);
      expect(tidA).not.toBe(tidB);
      expect(tidA).toBe(`m:${boxId}:${mid}`);
      expect(localSql(`select thread_id from emails where message_id = '<b-private-${TAG}@firma.test>'`)).toBe(tidB);

      asA();
      const act = await import("@/app/actions/mail-inbox");
      expect((await act.shareThreadAction(tidA, [users.c!.id], "mrkni")).ok).toBe(true);
      expect(localSql(`select mailbox_id from email_shares where thread_id = '${tidA}' and shared_with = '${users.c!.id}'`)).toBe(boxId);

      asC();
      const list = await act.listThreadsAction({ folder: "all" });
      const t = list.items.find((x) => x.threadId === tidA);
      expect(t).toMatchObject({ messageCount: 1, unreadCount: 0, share: { unread: true, note: "mrkni" } });
      expect(list.items.some((x) => x.threadId === tidB)).toBe(false);
      expect(JSON.stringify(list)).not.toContain("SOUKROMÉ");
      expect(Number(rlsAs(users.c!.id, `select count(*) from emails where body_text like 'SOUKROMÉ ${TAG}%'`))).toBe(0);
      expect(Number(rlsAs(users.c!.id, `select count(*) from emails where message_id = '${mid}'`))).toBe(1);
      expect((await act.openThreadAction(tidB)).ok).toBe(false);
      expect((await act.setThreadFlagAction(tidB, true)).ok).toBe(false);
      const mail = await import("@/lib/data/mail");
      const bId = localSql(`select id from emails where mailbox_id = '${boxB}' and message_id = '${mid}'`);
      expect(await mail.getVisibleEmailRow(bId, "id")).toBeNull();
      expect(await mail.getUnreadCount()).toBe(1); // neotevřené předání
      const opened = await act.openThreadAction(tidA);
      expect(opened.ok).toBe(true);
      expect(opened.messages!.map((m) => m.body)).toEqual(["Prosím nabídku."]);
      expect(await mail.getUnreadCount()).toBe(0);
      // #2: kolega předané vlákno otevřel — majiteli schránky zůstává jeho e-mail nepřečtený
      expect(localSql(`select is_read from emails where mailbox_id = '${boxId}' and message_id = '${mid}'`)).toBe("f");
      asA();
      const mine = await act.listThreadsAction({ folder: "inbox" });
      expect(mine.items.find((x) => x.threadId === tidA)?.unreadCount).toBe(1);
      // #12: odznak v menu = počet nepřečtených vláken ve složce Přijaté
      expect(await mail.getUnreadCount()).toBe(mine.counts!.inboxUnread);
    } finally {
      await svc.from("email_shares").delete().eq("shared_with", users.c!.id);
      await svc.from("emails").delete().eq("mailbox_id", boxB);
      await svc.from("emails").delete().like("message_id", `<leak-${TAG}%`);
      await svc.from("mailboxes").delete().eq("id", boxB);
    }
  }, 60_000);

  it("review #3: „Z dokumentů zakázky“ nenabídne ani neodešle PDF nabídky čekající na schválení (stejná pravidla jako odeslání ze zakázky)", async () => {
    asA();
    const { data: job, error: jobErr } = await svc.from("orders").insert({
      number: `MA-${TAG}`, title: "Mail A zámek", source: "manual", status: "naceneni", inquiry_date: "2026-10-20", owner_id: users.a!.id,
    }).select("id").single();
    expect(jobErr).toBeNull();
    jobId = (job as { id: string }).id;
    const { data: q, error: qErr } = await svc.from("quotes").insert({ number: `NAB-MA-${TAG}`, job_id: jobId, total: 100, valid_until: "2099-01-01", admin_approval_required: true }).select("id").single();
    expect(qErr).toBeNull();
    const quoteId = (q as { id: string }).id;
    const put = async (name: string, extra: Record<string, unknown>) => {
      const storage = `${jobId}/${name}`;
      await svc.storage.from("job-files").upload(storage, new Blob([Buffer.from("%PDF-1.4 mail-a")], { type: "application/pdf" }), { contentType: "application/pdf", upsert: true });
      const { data, error } = await svc.from("job_files").insert({ job_id: jobId, filename: name, mime_type: "application/pdf", storage_path: storage, origin: "upload", ...extra }).select("id").single();
      expect(error).toBeNull();
      return (data as { id: string }).id;
    };
    const locked = await put(`NAB-MA-${TAG}.pdf`, { kind: "nabidka", quote_id: quoteId });
    // náš výkres (issuer my) — výkres ZÁKAZNÍKA by mimo zákazníka zakázky šel jen anonymizovaný (mail-e test)
    const free = await put(`vykres-${TAG}.pdf`, { kind: "vykres", issuer: "my" });
    const compose = await import("@/app/actions/mail-compose");
    const ctx = await compose.composeContextAction({ jobId });
    expect(ctx.ok).toBe(true);
    const offered = (ctx.jobFiles ?? []).map((f) => f.id);
    expect(offered).toContain(free);
    expect(offered).not.toContain(locked);
    const before = srv.sent.length;
    const res = await compose.sendComposedAction({ mode: "new", to: "zakaznik@nekde.test", subject: `Nabídka ${TAG}`, body: "x", jobId, attachments: [{ kind: "job", ref: locked }] });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/čeká na schválení/);
    expect(srv.sent.length).toBe(before);
    const ok = await compose.sendComposedAction({ mode: "new", to: "zakaznik@nekde.test", subject: `Výkres ${TAG} zak`, body: "x", jobId, attachments: [{ kind: "job", ref: free }] });
    expect(ok).toMatchObject({ ok: true });
    expect(srv.sent.at(-1)!.raw).toContain(`vykres-${TAG}.pdf`);
  }, 60_000);

  it("review #7: „Odpojit“ a znovu připojit stejnou schránku → stejná pošta bez duplicit, přílohy i předání fungují dál", async () => {
    const my = await import("./my-mailbox");
    const before = Number(localSql(`select count(*) from emails where mailbox_id = '${boxId}'`));
    expect(before).toBeGreaterThan(160);
    const { data: mb } = await svc.from("mailboxes").select("config").eq("id", boxId).single();
    const cfg = { ...(mb as { config: Record<string, unknown> }).config };
    delete cfg.imap_password; delete cfg.smtp_password;
    expect((await my.removeMine(users.a!.id, boxId)).ok).toBe(true);
    expect(Number(localSql(`select count(*) from emails where detached_mailbox_id = '${boxId}' and mailbox_id is null`))).toBe(before);
    const saved = await my.saveMine(users.a!.id, { email: USER, password: PASS, config: cfg });
    expect(saved.ok).toBe(true);
    const oldBox = boxId;
    boxId = saved.id!;
    expect(Number(localSql(`select count(*) from emails where mailbox_id = '${boxId}'`))).toBe(before);
    expect(localSql(`select count(*) from emails where detached_mailbox_id = '${oldBox}'`)).toBe("0");
    const ingest = await import("./ingest");
    for (let i = 0; i < 10; i++) {
      const r = await ingest.syncMailbox({ mailboxIds: [boxId], manual: true, limit: 100, deadline: Date.now() + ingest.SYNC_RESERVE_MS + 60_000 });
      expect(r.boxes?.[0].ok).toBe(true);
      if (r.done) break;
    }
    expect(Number(localSql(`select count(*) from emails where mailbox_id = '${boxId}'`))).toBe(before);
    expect(localSql(`select count(*) from (select message_id from emails where mailbox_id = '${boxId}' group by message_id having count(*) > 1) d`)).toBe("0");
    const { data: att } = await svc.from("email_attachments").select("id, email:emails!email_id(subject)").eq("filename", "vykres-H200.pdf");
    const inbound = ((att ?? []) as { id: string; email: { subject: string } | { subject: string }[] | null }[])
      .find((a) => (Array.isArray(a.email) ? a.email[0] : a.email)?.subject === `Výkres ${TAG}`);
    const loaded = await (await import("./attachments")).loadEmailAttachment(inbound!.id);
    expect(loaded.ok).toBe(true);
    // předání kolegovi B (z dřívějška) míří na novou schránku → B vlákno vidí dál
    expect(localSql(`select mailbox_id from email_shares where thread_id = '${threadId}' and shared_with = '${users.b!.id}'`)).toBe(boxId);
    asB();
    const act = await import("@/app/actions/mail-inbox");
    expect((await act.openThreadAction(threadId)).ok).toBe(true);
  }, 240_000);
});
