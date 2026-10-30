import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_ENABLED, loadLocalEnv, localAdmin, localSql } from "@/test/local-supabase";

/**
 * Pošta E proti lokálnímu Supabase + testovacímu poštovnímu serveru:
 *  - obchodník si v Pošta → Nastavení pošty → Schránka sám nastaví servery RUČNĚ (IMAP + SMTP, port,
 *    šifrování, uživatel), otestuje vyplněné před uložením a uloží přesně to (bez automatického hledání),
 *  - „SMTP má jiné heslo" ponechá uložené SMTP heslo; cizí schránku netestuje ani neuloží,
 *  - fronta K odeslání: odeslání se špatným heslem → zpráva se neztratí (mail_outbox) → „Přijmout
 *    a odeslat" ji po opravě hesla odešle (jen moje položky; zahodit jde jen svou).
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/email/mail-e.integration.test.ts
 */

type Srv = {
  ports: Record<string, number>;
  caFile: string;
  events: { type: string; user?: string; proto?: string; ok?: boolean }[];
  sent: { from: string; to: string[]; raw: string }[];
  addMessage: (u: string, m: Record<string, unknown>) => number;
  lastMessageId: string | null;
  close: () => Promise<void>;
};

const BOX = "outbox@nastrojarstvi.test";
const PASS = "Outbox-Heslo-1";

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
  const BASE = ["orders", "workflow", "documents", "customers", "suppliers", "mail", "margins", "supplier_invoices_upload"];
  const FEATURES: Record<string, string[]> = { obchodnik: BASE, super_admin: BASE };
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

describe.skipIf(!LOCAL_ENABLED)("Pošta E — nastavení schránky v Poště + Přijmout a odeslat", () => {
  let srv: Srv;
  let svc: SupabaseClient;
  const users: { vit?: { id: string; email: string }; other?: { id: string; email: string } } = {};
  let boxId = "";
  const jobIds: string[] = [];
  const TAG = `mailE${Date.now()}`;
  const asVit = () => { session.current = { id: users.vit!.id, email: users.vit!.email, fullName: "Vít Volný", role: "obchodnik" }; };
  const asOther = () => { session.current = { id: users.other!.id, email: users.other!.email, fullName: "Olga Jiná", role: "obchodnik" }; };

  beforeAll(async () => {
    const env = loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const mod = (await import(path.resolve(__dirname, "../../../tools/e2e/mail-test-server.mjs"))) as {
      startMailTestServer: (o: { dir: string; base: number }) => Promise<Srv>;
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mail-e-"));
    for (let i = 0; ; i++) {
      try {
        srv = await mod.startMailTestServer({ dir, base: 47000 + Math.floor(Math.random() * 900) * 10 });
        break;
      } catch (err) {
        if (i >= 5 || !/EADDRINUSE/.test(String(err))) throw err;
      }
    }
    tls.setDefaultCACertificates([...tls.getCACertificates("default"), fs.readFileSync(srv.caFile, "utf8")]);
    svc = localAdmin();
    for (const key of ["vit", "other"] as const) {
      const email = `${TAG}-${key}@local.test`;
      const name = key === "vit" ? "Vít Volný" : "Olga Jiná";
      const { data, error } = await svc.auth.admin.createUser({ email, password: `Heslo-${TAG}-1!`, email_confirm: true, user_metadata: { full_name: name } });
      if (error) throw new Error(error.message);
      users[key] = { id: data.user!.id, email };
      await svc.from("profiles").update({ role: "obchodnik", full_name: name, active: true }).eq("id", data.user!.id);
    }
    await svc.from("mailboxes").delete().eq("email", BOX);
  }, 60_000);

  afterAll(async () => {
    if (boxId) {
      await svc.from("supplier_invoices").delete().in("email_id", (await svc.from("emails").select("id").eq("mailbox_id", boxId)).data?.map((r) => (r as { id: string }).id) ?? []);
      await svc.from("emails").delete().eq("mailbox_id", boxId);
    }
    for (const id of jobIds) {
      await svc.from("job_files").delete().eq("job_id", id);
      await svc.from("order_items").delete().eq("order_id", id);
      await svc.from("orders").delete().eq("id", id);
    }
    for (const u of [users.vit, users.other]) {
      if (!u) continue;
      await svc.from("mail_outbox").delete().eq("created_by", u.id);
      await svc.from("emails").delete().eq("owner_id", u.id);
      await svc.from("mailboxes").delete().eq("owner_id", u.id);
      await svc.auth.admin.deleteUser(u.id).catch(() => undefined);
    }
    await srv?.close();
  });

  const manual = () => ({
    preset: "other" as const, incoming_protocol: "imap" as const, imap_host: "127.0.0.1", imap_port: srv.ports.imaps, imap_tls: "tls" as const, imap_user: BOX,
    smtp_host: "127.0.0.1", smtp_port: srv.ports.smtps, smtp_tls: "tls" as const,
  });

  it("servery ručně: test vyplněného (příjem + SMTP) bez uložení → uložit přesně to; cizí to nesmí", async () => {
    const my = await import("./my-mailbox");
    // špatný port SMTP → příjem OK, odesílání chyba (česky), nic se neuloží
    const bad = await my.testDraftMine(users.vit!.id, { email: BOX, password: PASS, config: { ...manual(), smtp_port: srv.ports.closed } });
    expect(bad.incoming?.ok).toBe(true);
    expect(bad.smtp?.ok).toBe(false);
    expect(bad.smtp?.error).toBeTruthy();
    expect(Number(localSql(`select count(*) from mailboxes where email = '${BOX}'`))).toBe(0);
    const good = await my.testDraftMine(users.vit!.id, { email: BOX, password: PASS, config: manual() });
    expect(good.incoming).toMatchObject({ ok: true });
    expect(good.smtp).toMatchObject({ ok: true });
    const saved = await my.saveMine(users.vit!.id, { email: BOX, password: PASS, config: manual() });
    expect(saved).toMatchObject({ ok: true });
    boxId = saved.id!;
    expect(JSON.parse(localSql(`select config - 'imap_password' from mailboxes where id = '${boxId}'`))).toMatchObject({
      imap_host: "127.0.0.1", imap_port: srv.ports.imaps, imap_tls: "tls", imap_user: BOX, smtp_host: "127.0.0.1", smtp_port: srv.ports.smtps, smtp_tls: "tls",
    });
    // předvyplnění formuláře: servery bez hesel
    const list = await my.listMyMailboxes(users.vit!.id);
    expect(list[0]).toMatchObject({ editable: true, lockedReason: null, settings: { imapHost: "127.0.0.1", imapPort: srv.ports.imaps, smtpHost: "127.0.0.1", smtpPort: srv.ports.smtps } });
    expect(JSON.stringify(list)).not.toContain(PASS);
    // cizí uživatel: test s mou schránkou (uložené heslo!) ani uložení nejde
    const foreign = await my.testDraftMine(users.other!.id, { mailboxId: boxId, email: BOX, config: manual() });
    expect(foreign.error).toMatch(/spravuješ jen svou/);
    expect(foreign.incoming).toBeNull();
    const dup = await my.saveMine(users.other!.id, { email: BOX, password: PASS, config: manual() });
    expect(dup.error).toMatch(/je už v aplikaci připojená \(má ji kolega\).*Požádej super admina/);
  }, 60_000);

  it("„SMTP má jiné heslo“ zaškrtnuté bez zadání → uložené SMTP heslo zůstane; odškrtnuté → smaže se", async () => {
    const my = await import("./my-mailbox");
    await svc.from("mailboxes").update({ config: { ...manual(), imap_password: PASS, smtp_password: "Jine-SMTP-1" } }).eq("id", boxId);
    expect((await my.saveMine(users.vit!.id, { mailboxId: boxId, email: BOX, password: PASS, keepSmtpPassword: true, config: manual() })).ok).toBe(true);
    expect(localSql(`select config->>'smtp_password' from mailboxes where id = '${boxId}'`)).toBe("Jine-SMTP-1");
    expect((await my.saveMine(users.vit!.id, { mailboxId: boxId, email: BOX, config: manual() })).ok).toBe(true);
    expect(localSql(`select (config ? 'smtp_password')::text from mailboxes where id = '${boxId}'`)).toBe("false");
  }, 30_000);

  let queuedId = "";
  it("odeslání se špatným heslem → zpráva čeká v K odeslání (neztratí se), Přijmout a odeslat bez opravy znovu selže", async () => {
    asVit();
    await svc.from("mailboxes").update({ config: { ...manual(), imap_password: "Spatne-heslo-1" } }).eq("id", boxId);
    const compose = await import("@/app/actions/mail-compose");
    const sentBefore = srv.sent.length;
    const r = await compose.sendComposedAction({ mode: "new", to: "zakaznik@firma.test", subject: `Nabídka ${TAG}`, body: "Dobrý den, posílám nabídku." });
    expect(r.ok).toBe(false);
    expect(r.queued).toBe(true);
    expect(r.needsSettings).toBe(true);
    expect(r.error).toMatch(/Přihlášení odmítnuto/);
    queuedId = r.outboxId!;
    expect(srv.sent.length).toBe(sentBefore);
    // opakované Odeslat ze stejného okna (outboxId) → pořád jedna položka
    const again = await compose.sendComposedAction({ mode: "new", to: "zakaznik@firma.test", subject: `Nabídka ${TAG}`, body: "Dobrý den, posílám nabídku.", outboxId: queuedId });
    expect(again.outboxId).toBe(queuedId);
    const list = await compose.listOutboxAction();
    expect(list.items.map((i) => i.id)).toEqual([queuedId]);
    expect(list.items[0]).toMatchObject({ subject: `Nabídka ${TAG}`, to: "zakaznik@firma.test", attempts: 2 });
    // kontrola obsahu do fronty nevede
    const invalid = await compose.sendComposedAction({ mode: "new", to: "neplatna", subject: "x", body: "x" });
    expect(invalid).toMatchObject({ ok: false });
    expect(invalid.queued).toBeUndefined();
    // Přijmout a odeslat bez opravy: neodesláno, řekne co opravit
    const flush = await compose.flushOutboxAction();
    expect(flush).toMatchObject({ ok: true, sent: 0, failed: 1, needsSettings: true });
    expect(localSql(`select status || '|' || attempts from mail_outbox where id = '${queuedId}'`)).toBe("failed|3");
    // RLS: kolega frontu nevidí ani přes REST
    const rls = localSql(`begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${users.other!.id}","role":"authenticated"}', true); select count(*) from mail_outbox where id = '${queuedId}'; rollback;`).split("\n").at(-1);
    expect(rls).toBe("0");
  }, 60_000);

  it("kolega cizí položku neodešle ani nezahodí; po opravě hesla Přijmout a odeslat odešle (z mé schránky, uloženo jako odchozí)", async () => {
    const compose = await import("@/app/actions/mail-compose");
    asOther();
    expect((await compose.flushOutboxAction()).sent).toBe(0);
    expect((await compose.discardOutboxAction(queuedId)).ok).toBe(false);
    expect((await compose.listOutboxAction()).items).toEqual([]);
    asVit();
    const my = await import("./my-mailbox");
    expect((await my.saveMine(users.vit!.id, { mailboxId: boxId, email: BOX, password: PASS, config: manual() })).ok).toBe(true);
    const before = srv.sent.length;
    const flush = await compose.flushOutboxAction();
    expect(flush).toMatchObject({ ok: true, sent: 1, failed: 0 });
    expect(srv.sent.length).toBe(before + 1);
    expect(srv.sent.at(-1)!.raw).toMatch(new RegExp(`Subject: Nab.*${TAG}|${TAG}`));
    const row = JSON.parse(localSql(`select row_to_json(o) from (select status, email_id, sent_at is not null as sent from mail_outbox where id = '${queuedId}') o`));
    expect(row).toMatchObject({ status: "sent", sent: true });
    expect(localSql(`select direction || '|' || mailbox_id || '|' || owner_id from emails where id = '${row.email_id}'`)).toBe(`out|${boxId}|${users.vit!.id}`);
    expect((await compose.listOutboxAction()).items).toEqual([]);
    // podruhé nic (žádné dvojí odeslání)
    expect((await compose.flushOutboxAction()).sent).toBe(0);
    expect(srv.sent.length).toBe(before + 1);
  }, 60_000);

  it("vlákna: dvě „Poptávka Brisk“ od stejného zákazníka o týden později → dvě vlákna a dvě poptávky; odpověď s hlavičkami do vlákna; „Re:“ bez hlaviček a citace zvlášť", async () => {
    asVit();
    const S = `Poptávka Brisk ${TAG}`;
    const from = "Nákup Brisk <nakup@brisk.test>";
    const day = 24 * 3600_000;
    const t0 = Date.now() - 14 * day;
    const body1 = "Dobrý den, poptáváme 50 ks pouzder dle výkresu BR-100, termín do konce měsíce. Děkujeme.";
    srv.addMessage(BOX, { subject: S, body: body1, from, date: new Date(t0) });
    const mid1 = srv.lastMessageId!;
    srv.addMessage(BOX, { subject: `Re: ${S}`, body: "Upřesnění: materiál 11SMnPb30.", from, inReplyTo: mid1, references: mid1, date: new Date(t0 + day) });
    srv.addMessage(BOX, { subject: S, body: "Dobrý den, nová poptávka: 200 ks čepů dle výkresu BR-555.", from, date: new Date(t0 + 7 * day) });
    srv.addMessage(BOX, { subject: `Re: ${S}`, body: "Ještě jedna věc bez citace.", from, date: new Date(t0 + 8 * day) });
    srv.addMessage(BOX, { subject: `Re: ${S}`, body: `Termín platí.\n\n> ${body1.slice(0, 40)}\n> ${body1.slice(40)}`, from, date: new Date(t0 + 9 * day) });
    const ingest = await import("./ingest");
    const r = await ingest.syncMailbox({ mailboxIds: [boxId], manual: true });
    expect(r.boxes?.[0].ok).toBe(true);
    const rows = JSON.parse(localSql(`select coalesce(json_agg(json_build_object('s', subject, 'b', left(body_text, 30), 't', thread_id) order by received_at), '[]') from emails where mailbox_id = '${boxId}' and subject like '%Brisk ${TAG}%'`)) as { s: string; b: string; t: string }[];
    expect(rows).toHaveLength(5);
    const [first, reply, second, bare, quoted] = rows;
    expect(reply.t).toBe(first.t); // In-Reply-To
    expect(quoted.t).toBe(first.t); // „Re:“ s citací původní zprávy
    expect(second.t).not.toBe(first.t); // stejný předmět, jiná poptávka
    expect(bare.t).not.toBe(first.t); // „Re:“ bez hlaviček a bez citace
    expect(bare.t).not.toBe(second.t);
    // z první poptávky zakázka → druhá poptávka (stejný předmět) zůstává bez zakázky
    const ids = JSON.parse(localSql(`select json_agg(id order by received_at) from emails where mailbox_id = '${boxId}' and subject like '%Brisk ${TAG}%'`)) as string[];
    const mail = await import("@/app/actions/mail");
    const job = await mail.createJobFromEmail(ids[0]);
    expect(job.ok).toBe(true);
    jobIds.push(job.id!);
    const jobs = await import("./job-link-store");
    const a = { db: svc, actorId: users.vit!.id, kind: "user" as const, ctx: null as never };
    await jobs.processEmailForJobs(a as never, ids[2], {});
    expect(localSql(`select coalesce(order_id::text, '') from emails where id = '${ids[2]}'`)).toBe("");
    expect(localSql(`select order_id from emails where id = '${ids[1]}'`)).toBe(job.id);
  }, 120_000);

  it("oprava starých dat (mail_rethread_split): špatně spojené vlákno se rozdělí, automatické přiřazení zděděné z vlákna se zruší, ruční zůstane; opakování nic nezmění", async () => {
    const ids = JSON.parse(localSql(`select json_agg(id order by received_at) from emails where mailbox_id = '${boxId}' and subject like '%Brisk ${TAG}%'`)) as string[];
    const [first, reply, second, bare] = ids;
    const tid = localSql(`select thread_id from emails where id = '${first}'`);
    const jobId = localSql(`select order_id from emails where id = '${first}'`);
    // jako po staré verzi (párování podle předmětu): druhá poptávka a „Re:“ bez hlaviček ve vlákně první, zakázka zděděná automaticky
    localSql(`update emails set thread_id = '${tid}', order_id = '${jobId}', job_link_source = 'thread', job_link_actor = 'ai' where id = '${second}'`);
    localSql(`update emails set thread_id = '${tid}', order_id = '${jobId}', job_link_source = 'manual', job_link_actor = 'user' where id = '${bare}'`);
    const moved = Number(localSql(`select mail_rethread_split()`));
    expect(moved).toBeGreaterThanOrEqual(2);
    const row = (id: string) => localSql(`select thread_id || '|' || coalesce(order_id::text, '-') from emails where id = '${id}'`);
    expect(row(first)).toBe(`${tid}|${jobId}`);
    expect(row(reply)).toBe(`${tid}|${jobId}`); // skutečná odpověď zůstává
    expect(row(second).startsWith(`${tid}|`)).toBe(false);
    expect(row(second).endsWith("|-")).toBe(true); // automatické přiřazení z vlákna pryč
    expect(localSql(`select job_match_at is null from emails where id = '${second}'`)).toBe("t"); // posoudí se znovu
    expect(row(bare).startsWith(`${tid}|`)).toBe(false);
    expect(row(bare).endsWith(`|${jobId}`)).toBe(true); // ruční přiřazení zůstává
    expect(localSql(`select mail_rethread_split()`)).toBe("0");
  }, 60_000);

  it("Oddělit z vlákna (ručně): zpráva dostane vlastní vlákno; cizí zprávu neoddělím", async () => {
    asVit();
    const ids = JSON.parse(localSql(`select json_agg(id order by received_at) from emails where mailbox_id = '${boxId}' and subject like '%Brisk ${TAG}%'`)) as string[];
    const actions = await import("@/app/actions/mail-actions");
    const tid = localSql(`select thread_id from emails where id = '${ids[4]}'`);
    const r = await actions.splitFromThreadAction(ids[4]);
    expect(r).toMatchObject({ ok: true });
    expect(localSql(`select thread_id from emails where id = '${ids[4]}'`)).not.toBe(tid);
    expect(localSql(`select thread_id from emails where id = '${ids[0]}'`)).toBe(tid);
    asOther();
    expect((await actions.splitFromThreadAction(ids[1])).ok).toBe(false);
  }, 60_000);

  it("hlavní akce: faktura dodavatele z e-mailu → Faktury dodavatelů (bez zakázky); objednávka bez shody → založí zakázku", async () => {
    asVit();
    srv.addMessage(BOX, {
      subject: `Faktura ${TAG}`, body: "V příloze faktura.", from: "Účtárna <fakturace@dodavatel.test>",
      attachments: [{ filename: `faktura-${TAG}.pdf`, contentType: "application/pdf", content: Buffer.from("%PDF-1.4 faktura") }],
    });
    srv.addMessage(BOX, { subject: `Objednávka ${TAG}`, body: "Objednáváme 10 ks přírub dle nabídky.", from: "Nový zákazník <novy@zakaznik.test>" });
    const ingest = await import("./ingest");
    await ingest.syncMailbox({ mailboxIds: [boxId], manual: true });
    const inv = localSql(`select id from emails where mailbox_id = '${boxId}' and subject = 'Faktura ${TAG}'`);
    const actions = await import("@/app/actions/mail-actions");
    const r = await actions.recordSupplierInvoiceFromEmailAction(inv);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.created + r.existing).toBeGreaterThanOrEqual(1);
    expect(Number(localSql(`select count(*) from supplier_invoices where email_id = '${inv}'`))).toBeGreaterThanOrEqual(1);
    expect(localSql(`select coalesce(order_id::text, '') from emails where id = '${inv}'`)).toBe(""); // žádná zakázka
    const ord = localSql(`select id from emails where mailbox_id = '${boxId}' and subject = 'Objednávka ${TAG}'`);
    const o = await actions.processOrderFromEmailAction(ord);
    expect(o.ok).toBe(true);
    if (o.ok && o.mode !== "choose") {
      jobIds.push(o.jobId);
      expect(["created", "linked", "existing"]).toContain(o.mode);
      expect(localSql(`select order_id from emails where id = '${ord}'`)).toBe(o.jobId);
    }
    // bez přílohy → ruční nahrání
    const plain = localSql(`select id from emails where mailbox_id = '${boxId}' and subject = 'Objednávka ${TAG}'`);
    const n = await actions.recordSupplierInvoiceFromEmailAction(plain);
    expect(n.ok && n.noFiles).toBe(true);
  }, 120_000);

  it("výkres zákazníka z dokumentů zakázky: zákazníkovi originál, dodavateli jen ověřená anonymizovaná kopie, jinak blok; originál jen super admin (audit)", async () => {
    asVit();
    const crypto = await import("node:crypto");
    const custDomain = `zak-${TAG.toLowerCase()}.test`;
    const { data: cust } = await svc.from("customers").insert({ name: `Zákazník ${TAG}`, email: `nakup@${custDomain}` }).select("id").single();
    const customerId = (cust as { id: string }).id;
    const { data: job } = await svc.from("orders").insert({
      number: `ME-${TAG}`, title: "Mail E výkresy", source: "manual", status: "poptavka", inquiry_date: "2026-10-30", owner_id: users.vit!.id, customer_id: customerId,
    }).select("id").single();
    const jobId = (job as { id: string }).id;
    jobIds.push(jobId);
    const orig = Buffer.from(`%PDF-1.4 ORIGINAL zakaznik ${TAG}`);
    const path = `${jobId}/vykres-zak-${TAG}.pdf`;
    await svc.storage.from("job-files").upload(path, new Blob([orig], { type: "application/pdf" }), { contentType: "application/pdf", upsert: true });
    const { data: f } = await svc.from("job_files").insert({ job_id: jobId, kind: "vykres", filename: `vykres-zak-${TAG}.pdf`, mime_type: "application/pdf", storage_path: path, origin: "upload" }).select("id").single();
    const fileId = (f as { id: string }).id;
    await svc.from("job_files").update({ anon_status: "pending", anon_path: null, anon_sha256: null }).eq("id", fileId);
    const compose = await import("@/app/actions/mail-compose");
    const send = (to: string, extra: Record<string, unknown> = {}) => compose.sendComposedAction({
      mode: "new", to, subject: `Výkres ${TAG}`, body: "V příloze výkres.", jobId, attachments: [{ kind: "job", ref: fileId, ...extra }],
    });
    const before = srv.sent.length;
    // dodavatel, výkres se ještě anonymizuje → blok, nic neodešlo, nezařadí se do K odeslání
    const p = await send(`kalirna@dodavatel-${TAG.toLowerCase()}.test`);
    expect(p).toMatchObject({ ok: false, blocked: [{ ref: fileId, reason: "pending" }], canSendOriginal: false });
    expect(p.blocked![0].message).toMatch(/Výkres ještě není anonymizovaný/);
    expect(p.queued).toBeUndefined();
    expect(srv.sent.length).toBe(before);
    // zákazník zakázky (jiná adresa jeho domény) → originál
    const c = await send(`technik@${custDomain}`);
    expect(c).toMatchObject({ ok: true });
    expect(srv.sent.at(-1)!.raw).toContain(`vykres-zak-${TAG}.pdf`);
    // hotová anonymizace → dodavatel dostane anonymizovanou kopii (ověřený sha256), ne originál
    const anon = Buffer.from(`%PDF-1.4 ANON ${TAG}`);
    const anonPath = `zakazky/${jobId.toLowerCase()}/anon/${fileId}.pdf`;
    await svc.storage.from("job-files").upload(anonPath, new Blob([anon], { type: "application/pdf" }), { contentType: "application/pdf", upsert: true });
    const sha = crypto.createHash("sha256").update(anon).digest("hex");
    await svc.from("job_files").update({ anon_status: "done", anon_path: anonPath, anon_filename: `anonym-${TAG}.pdf`, anon_mime: "application/pdf", anon_sha256: sha }).eq("id", fileId);
    const d = await send(`kalirna@dodavatel-${TAG.toLowerCase()}.test`);
    expect(d).toMatchObject({ ok: true });
    const raw = srv.sent.at(-1)!.raw;
    expect(raw).toContain(`anonym-${TAG}.pdf`);
    expect(raw).not.toContain(`vykres-zak-${TAG}.pdf`);
    // podvržená kopie v úložišti (jiný sha) → blok
    await svc.from("job_files").update({ anon_sha256: "0".repeat(64) }).eq("id", fileId);
    expect((await send(`kalirna@dodavatel-${TAG.toLowerCase()}.test`)).blocked?.[0]).toMatchObject({ reason: "failed" });
    // nejde anonymizovat (DWG…) → blok s radou „ulož jako PDF“; obchodník originál poslat nesmí
    await svc.from("job_files").update({ anon_status: "unsupported", anon_reason: "Formát DWG nejde anonymizovat." }).eq("id", fileId);
    const u = await send(`kalirna@dodavatel-${TAG.toLowerCase()}.test`);
    expect(u.blocked?.[0].message).toMatch(/ulož výkres jako PDF/);
    expect((await send(`kalirna@dodavatel-${TAG.toLowerCase()}.test`, { original: true })).blocked?.[0]).toMatchObject({ reason: "forbidden" });
    // super admin výslovně „Poslat originál“ → odejde originál + audit
    session.current = { id: users.vit!.id, email: users.vit!.email, fullName: "Vít Volný", role: "super_admin" };
    const s = await send(`kalirna@dodavatel-${TAG.toLowerCase()}.test`, { original: true });
    expect(s).toMatchObject({ ok: true });
    expect(srv.sent.at(-1)!.raw).toContain(`vykres-zak-${TAG}.pdf`);
    expect(localSql(`select count(*) from audit_log where action = 'email_attachment_original_sent' and diff::text like '%${fileId}%'`)).toBe("1");
    asVit();
    await svc.from("customers").delete().eq("id", customerId).then(() => undefined, () => undefined);
  }, 120_000);

  it("zahodit: jen moje čekající zpráva, neodejde", async () => {
    asVit();
    await svc.from("mailboxes").update({ config: { ...manual(), imap_password: "Spatne-heslo-2" } }).eq("id", boxId);
    const compose = await import("@/app/actions/mail-compose");
    const r = await compose.sendComposedAction({ mode: "new", to: "zakaznik@firma.test", subject: `Zahodit ${TAG}`, body: "x" });
    expect(r.queued).toBe(true);
    expect((await compose.discardOutboxAction(r.outboxId!)).ok).toBe(true);
    expect(localSql(`select status from mail_outbox where id = '${r.outboxId}'`)).toBe("cancelled");
    await svc.from("mailboxes").update({ config: { ...manual(), imap_password: PASS } }).eq("id", boxId);
    const before = srv.sent.length;
    expect((await compose.flushOutboxAction()).sent).toBe(0);
    expect(srv.sent.length).toBe(before);
  }, 60_000);
});
