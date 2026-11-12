import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_ENABLED, loadLocalEnv, localAdmin, localSql } from "@/test/local-supabase";

/**
 * Pošta → Odeslané: každý doklad, který aplikace pošle ven, má záznam v odeslané poště (emails, direction
 * out) a ten vidí ve složce Odeslané (RPC mail_threads i archiv /sent) ten, kdo ho poslal — obchodník
 * i super admin — a majitel schránky, ze které odešel; nikdo cizí. Majitel 3. 11.: „Pošlu objednávku
 * dodavateli a v Poště nevidím, že jsme mu něco poslali."
 * Majitel 9. 11.: každý posílá ze SVÉ schránky (Šponer ze Šponerovy, Volný z Volného), schránku si vybírá jen
 * super admin — a odeslaný e-mail patří do Odeslaných vlastníka schránky, ze které opravdu odešel.
 * Cesty: objednávka dodavateli (vystavení ze schránky odesílatele, změna, storno, pozastavení),
 * objednávka přes frontu ke schválení, objednávka po anonymizaci výkresů (fronta odeslání), doklady
 * zákazníkovi (potvrzení, dodací list, faktura; super admin bez schránky přes globální SMTP), AI nabídka,
 * schválená odpověď z fronty, okno psaní; zápis při chybě vazby (záznam vznikne i bez vazeb).
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/email/odeslana-posta.integration.test.ts
 */

type Srv = {
  ports: Record<string, number>;
  caFile: string;
  sent: { from: string; to: string[]; raw: string }[];
  folder: (user: string, name?: string) => { raw?: string }[];
  close: () => Promise<void>;
};

type Key = "a" | "b" | "c" | "d" | "e";
const session = vi.hoisted(() => ({
  current: null as null | { id: string; email: string; fullName: string; role: string; fullAccess?: boolean; realRole?: string; feat?: string },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => { void Promise.resolve().then(fn).catch(() => undefined); } }));
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
  const SALES = ["orders", "workflow", "documents", "customers", "suppliers", "mail", "margins", "ai_pricing", "rfq"];
  const FEATURES: Record<string, string[]> = {
    obchodnik: SALES,
    super_admin: [...SALES, "mail_all", "dashboard", "settings", "users"],
    // plný přístup (2. 11.): vše jako super admin kromě uživatelů a pošty všech schránek
    plny: [...SALES, "dashboard", "settings"],
  };
  const user = () => {
    const u = session.current!;
    return { ...u, initials: "XX", roleLabel: u.role, aiAccess: true, active: true, hasProfile: true };
  };
  const feat = () => session.current?.feat ?? session.current?.role ?? "";
  const can = (f: string) => (FEATURES[feat()] ?? []).includes(f);
  return {
    getSessionUser: async () => user(),
    getAccess: async () => ({ user: user(), ctx: {}, features: FEATURES[feat()], can }),
    checkFeature: async (f: string) => (can(f) ? { user: user() } : { error: "Bez oprávnění." }),
    apiRequire: async () => ({ user: user() }),
    requireUser: async () => user(),
    requireFeature: async () => user(),
  };
});

const TAG = `ODP${Date.now().toString(36).toUpperCase()}`;
const BOX_A = { user: "odeslane-a@nastrojarstvi.test", pass: "OdeslaneA-Heslo-1" };
const BOX_B = { user: "odeslane-b@nastrojarstvi.test", pass: "OdeslaneB-Heslo-1" };
const BOX_E = { user: "odeslane-e@nastrojarstvi.test", pass: "OdeslaneE-Heslo-1" };

describe.skipIf(!LOCAL_ENABLED)("Pošta → Odeslané: každý odeslaný doklad je zapsaný a vidí ho odesílatel", () => {
  let srv: Srv;
  let db: SupabaseClient;
  const users = {} as Record<Key, { id: string; email: string; name: string; role: string }>;
  const boxes = {} as Record<"a" | "b" | "e", string>;
  let customerId = "";
  let supplierId = "";
  let jobId = "";
  const SUP_MAIL = `dodavatel-${TAG.toLowerCase()}@dod.test`;
  const CUST_MAIL = `zakaznik-${TAG.toLowerCase()}@zak.test`;
  const paths: string[] = [];
  let quoteModeBefore = "";

  const as = (k: Key) => {
    const u = users[k];
    // plný přístup: aplikace ho vidí jako super admina (role), skutečná role v DB je zaměstnanec (getCurrentUser)
    session.current = k === "e"
      ? { id: u.id, email: u.email, fullName: u.name, role: "super_admin", fullAccess: true, realRole: u.role, feat: "plny" }
      : { id: u.id, email: u.email, fullName: u.name, role: u.role };
  };

  /** Odeslaný e-mail ve složce Odeslané (vlákna) a v archivu odeslané pošty — pro uživatele `k`. */
  async function seenBy(k: Key, emailId: string): Promise<{ threads: boolean; archive: boolean }> {
    as(k);
    const { listThreads } = await import("@/lib/data/mail-threads");
    const { getSentMail } = await import("@/lib/data/mail");
    const tid = localSql(`select thread_id from emails where id = '${emailId}'`);
    const page = await listThreads({ folder: "sent", mailboxId: null, query: TAG, limit: 200 });
    const archive = await getSentMail({ limit: 500 });
    return { threads: page.items.some((t) => t.threadId === tid && t.direction === "out"), archive: archive.some((i) => i.id === emailId) };
  }

  async function expectVisible(emailId: string, who: Key[], notWho: Key[]) {
    for (const k of who) expect(await seenBy(k, emailId), `vidí ${k}`).toEqual({ threads: true, archive: true });
    for (const k of notWho) expect(await seenBy(k, emailId), `nevidí ${k}`).toEqual({ threads: false, archive: false });
  }

  function row(emailId: string) {
    const r = localSql(`select direction || '|' || coalesce(mailbox_id::text, '-') || '|' || coalesce(owner_id::text, '-') || '|' || coalesce(order_id::text, '-')
      || '|' || coalesce(supplier_id::text, '-') || '|' || coalesce(customer_id::text, '-') || '|' || coalesce(purchase_order_id::text, '-') || '|' || coalesce(category::text, '-')
      || '|' || has_attachments || '|' || coalesce(sent_copy, '-') from emails where id = '${emailId}'`).split("|");
    return { direction: r[0], mailbox: r[1], owner: r[2], job: r[3], supplier: r[4], customer: r[5], po: r[6], category: r[7], attachments: r[8] === "true" || r[8] === "t", sentCopy: r[9] };
  }

  async function newPo(status: "vystavena" | "odeslana", n: number): Promise<string> {
    const id = localSql(`insert into purchase_orders (job_id, supplier_id, status, number, order_date, required_date, currency, total, created_by${status === "odeslana" ? ", sent_at" : ""})
      values ('${jobId}', '${supplierId}', '${status}', 'OV-${TAG}-${n}', app_today(), app_today() + 14, 'CZK', 1000, '${users.b.id}'${status === "odeslana" ? ", now()" : ""}) returning id`).split("\n")[0];
    localSql(`insert into purchase_order_items (purchase_order_id, position, drawing_number, name, material, quantity, unit, unit_price)
      values ('${id}', 0, 'VK-${TAG}-${n}', 'Hřídel', 'C45', 10, 'ks', 100)`);
    return id;
  }

  const po = async () => import("@/lib/jobs/purchase-order-docs");
  const data = async () => import("@/lib/data/purchasing");
  const handoff = async () => import("@/lib/jobs/production-handoff-store");

  /** Poslední odchozí e-mail objednávky (purchase_order_id). */
  const poMail = (poId: string) => localSql(`select id from emails where purchase_order_id = '${poId}' and direction = 'out' order by received_at desc limit 1`);

  beforeAll(async () => {
    const env = loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const mod = (await import(path.resolve(__dirname, "../../../tools/e2e/mail-test-server.mjs"))) as {
      startMailTestServer: (o: { dir: string; base: number }) => Promise<Srv>;
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odeslana-"));
    for (let i = 0; ; i++) {
      try {
        srv = await mod.startMailTestServer({ dir, base: 38000 + Math.floor(Math.random() * 900) * 10 });
        break;
      } catch (err) {
        if (i >= 5 || !/EADDRINUSE/.test(String(err))) throw err;
      }
    }
    tls.setDefaultCACertificates([...tls.getCACertificates("default"), fs.readFileSync(srv.caFile, "utf8")]);
    db = localAdmin();

    const NAMES: Record<Key, [string, string]> = {
      a: ["Adam Odesílatel", "obchodnik"], b: ["Bára Zakázková", "obchodnik"], c: ["Cyril Cizí", "obchodnik"], d: ["Dana Adminová", "super_admin"],
      e: ["Emil Plný", "zamestnanec"],
    };
    for (const k of ["a", "b", "c", "d", "e"] as Key[]) {
      const email = `${TAG.toLowerCase()}-${k}@local.test`;
      const { data: u, error } = await db.auth.admin.createUser({ email, password: `Heslo-${TAG}-1!`, email_confirm: true, user_metadata: { full_name: NAMES[k][0] } });
      if (error) throw new Error(error.message);
      users[k] = { id: u.user!.id, email, name: NAMES[k][0], role: NAMES[k][1] };
      await db.from("profiles").update({ role: NAMES[k][1], full_name: NAMES[k][0], active: true, ...(k === "e" ? { full_access: true } : {}) }).eq("id", u.user!.id);
    }
    const cfg = (b: { user: string; pass: string }) => ({
      imap_host: "127.0.0.1", imap_port: srv.ports.imaps, imap_tls: "tls", imap_user: b.user, imap_password: b.pass,
      smtp_host: "127.0.0.1", smtp_port: srv.ports.smtps, smtp_tls: "tls", smtp_user: b.user, smtp_password: b.pass,
    });
    await db.from("mailboxes").delete().in("email", [BOX_A.user, BOX_B.user, BOX_E.user]);
    for (const [k, b] of [["a", BOX_A], ["b", BOX_B], ["e", BOX_E]] as const) {
      const { data: m, error } = await db.from("mailboxes").insert({ provider: "imap", email: b.user, owner_id: users[k].id, active: true, config: cfg(b) }).select("id").single();
      if (error) throw new Error(error.message);
      boxes[k] = (m as { id: string }).id;
    }

    customerId = localSql(`insert into customers (name, country, email) values ('Zákazník ${TAG}', 'CZ', '${CUST_MAIL}') returning id`).split("\n")[0];
    supplierId = localSql(`insert into suppliers (name, email) values ('Kooperant ${TAG}', '${SUP_MAIL}') returning id`).split("\n")[0];
    jobId = localSql(`insert into orders (number, title, status, source, owner_id, created_by, customer_id, due_date)
      values ('Z-${TAG}', 'Hřídele ${TAG}', 've_vyrobe', 'manual', '${users.b.id}', '${users.b.id}', '${customerId}', app_today() + 30) returning id`).split("\n")[0];
    quoteModeBefore = localSql("select mode from automation_settings where module = 'quote'");
  }, 120_000);

  afterAll(async () => {
    if (quoteModeBefore) localSql(`update automation_settings set mode = '${quoteModeBefore}' where module = 'quote'`);
    if (db && jobId) {
      localSql(`delete from approval_queue where order_id = '${jobId}' or title like '%${TAG}%'`);
      localSql(`delete from anon_send_queue where job_id = '${jobId}'`);
      localSql(`delete from emails where order_id = '${jobId}' or subject like '%${TAG}%'`);
      localSql(`delete from purchase_orders where job_id = '${jobId}'`);
      const files = localSql(`select storage_path from job_files where job_id = '${jobId}'`).split("\n").filter(Boolean);
      await db.storage.from("job-files").remove([...paths, ...files]).catch(() => undefined);
      localSql(`update job_files set replaced_by = null where job_id = '${jobId}'`);
      localSql(`delete from job_files where job_id = '${jobId}'`);
      localSql(`delete from orders where id = '${jobId}'`);
      localSql(`delete from suppliers where id = '${supplierId}'`);
      localSql(`delete from customers where id = '${customerId}'`);
      const quotes = localSql(`select id || '|' || number from quotes where note like '%${TAG}%'`).split("\n").filter(Boolean).map((l) => l.split("|"));
      for (const [id, number] of quotes) {
        await db.storage.from("documents").remove([`nabidky/${number}.pdf`]).catch(() => undefined);
        localSql(`delete from documents where quote_id = '${id}'; delete from approval_queue where quote_id = '${id}'; delete from quotes where id = '${id}'`);
      }
    }
    if (db) {
      for (const u of Object.values(users)) {
        localSql(`delete from emails where owner_id = '${u.id}'`);
        await db.from("mailboxes").delete().eq("owner_id", u.id);
        await db.auth.admin.deleteUser(u.id).catch(() => undefined);
      }
    }
    await srv?.close();
  }, 120_000);

  it("objednávka dodavateli: obchodník A pošle objednávku zakázky obchodníka B → z A-ho schránky (majitel 9. 11.), v Odeslaných u A i admina", async () => {
    const poId = await newPo("vystavena", 1);
    const { purchaseOrderSender } = await handoff();
    // dřív: schránka obchodníka zakázky (B) — teď vždy toho, kdo posílá
    const sender = await purchaseOrderSender({ id: users.a.id });
    expect(sender).toMatchObject({ from: { ownerId: users.a.id }, signerId: users.a.id, mailboxEmail: BOX_A.user });
    // ani požadovaná schránka kolegy to nezmění (vybírat smí jen super admin)
    expect(await purchaseOrderSender({ id: users.a.id, fromMailboxId: boxes.b })).toMatchObject({ from: { ownerId: users.a.id }, signerId: users.a.id });
    const docs = await po();
    const view = (await (await data()).fetchPurchaseOrder(db as never, poId))!;
    const mail = await docs.purchaseOrderMailFor(db as never, view, sender.signerId, "issue", { from: sender.from });
    const res = await docs.sendPurchaseOrderCore(db as never, { id: users.a.id, fullName: users.a.name }, poId, { ...mail, to: SUP_MAIL, subject: `Objednávka OV-${TAG}-1` }, { from: sender.from, signerId: sender.signerId });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const emailId = (res as { emailId?: string }).emailId!;
    expect(emailId).toBeTruthy();
    expect(row(emailId)).toEqual({
      direction: "out", mailbox: boxes.a, owner: users.a.id, job: jobId, supplier: supplierId, customer: "-", po: poId, category: "objednavka", attachments: true, sentCopy: "ok",
    });
    // příloha (PDF objednávky) uložená u záznamu, kopie ve složce Odeslané na serveru (IMAP APPEND) — A, ne B
    expect(Number(localSql(`select count(*) from email_attachments where email_id = '${emailId}' and mime_type = 'application/pdf'`))).toBe(1);
    expect(srv.folder(BOX_A.user, "Sent").some((m) => String(m.raw ?? "").includes(`OV-${TAG}-1`))).toBe(true);
    expect(srv.folder(BOX_B.user, "Sent").some((m) => String(m.raw ?? "").includes(`OV-${TAG}-1`))).toBe(false);
    expect(localSql(`select sent_mailbox_id from purchase_orders where id = '${poId}'`)).toBe(boxes.a);
    await expectVisible(emailId, ["a", "d"], ["c"]);
  }, 120_000);

  it("objednávka: změna, storno a pozastavení z vlastní schránky odesílatele → každé v Odeslaných", async () => {
    const docs = await po();
    const author = { id: users.a.id, fullName: users.a.name };
    const p2 = await newPo("vystavena", 2);
    const v2 = (await (await data()).fetchPurchaseOrder(db as never, p2))!;
    const first = await docs.sendPurchaseOrderCore(db as never, author, p2, { ...(await docs.purchaseOrderMailFor(db as never, v2, users.a.id, "issue")), to: SUP_MAIL, subject: `Objednávka OV-${TAG}-2` }, { from: { ownerId: users.a.id } });
    expect(first.ok, JSON.stringify(first)).toBe(true);
    const ids: string[] = [(first as { emailId: string }).emailId];
    for (const kind of ["change", "hold", "cancel"] as const) {
      const v = (await (await data()).fetchPurchaseOrder(db as never, p2))!;
      const m = await docs.purchaseOrderMailFor(db as never, v, users.a.id, kind, { reason: "test" });
      const r = await docs.sendPurchaseOrderCore(db as never, author, p2, { ...m, to: SUP_MAIL, subject: `${kind} OV-${TAG}-2` }, { from: { ownerId: users.a.id }, kind, reason: "test" });
      expect(r.ok, `${kind}: ${JSON.stringify(r)}`).toBe(true);
      ids.push((r as { emailId: string }).emailId);
    }
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) {
      expect(row(id)).toMatchObject({ direction: "out", mailbox: boxes.a, owner: users.a.id, job: jobId, supplier: supplierId, po: p2, category: "objednavka", sentCopy: "ok" });
      await expectVisible(id, ["a", "d"], ["c"]);
    }
    expect(localSql(`select status from purchase_orders where id = '${p2}'`)).toBe("zrusena");
  }, 180_000);

  it("objednávka přes frontu ke schválení: super admin schválí → ze schránky, kterou vybral (B); bez volby ze své (bez schránky → globální SMTP)", async () => {
    const p3 = await newPo("vystavena", 3);
    localSql(`insert into approval_queue (type, title, payload, target, status, order_id, owner_id, purchase_order_id)
      values ('purchase_order', 'Objednávka OV-${TAG}-3', '{"kind":"issue","subject":"Objednávka OV-${TAG}-3","to":"${SUP_MAIL}"}', '${SUP_MAIL}', 'pending', '${jobId}', '${users.b.id}', '${p3}')`);
    const qid = localSql(`select id from approval_queue where purchase_order_id = '${p3}'`);
    as("d");
    const { resolveApproval } = await import("@/app/actions/approvals");
    // super admin vybral „Odeslat z: schránka B" → odejde z ní a patří do Odeslaných B (vlastník schránky)
    const r = await resolveApproval(qid, "approved", { fromMailboxId: boxes.b });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    const emailId = poMail(p3);
    expect(emailId).toBeTruthy();
    expect(row(emailId)).toMatchObject({ direction: "out", mailbox: boxes.b, owner: users.b.id, job: jobId, supplier: supplierId, po: p3, category: "objednavka", attachments: true });
    expect(srv.folder(BOX_B.user, "Sent").some((m) => String(m.raw ?? "").includes(`OV-${TAG}-3`))).toBe(true);
    await expectVisible(emailId, ["d", "b"], ["c"]);

    as("d");
    // bez volby: ze schránky super admina — nemá ji → globální SMTP (dřív: schránka obchodníka zakázky)
    const p3b = await newPo("vystavena", 31);
    localSql(`insert into approval_queue (type, title, payload, target, status, order_id, owner_id, purchase_order_id)
      values ('purchase_order', 'Objednávka OV-${TAG}-31', '{"kind":"issue","subject":"Objednávka OV-${TAG}-31","to":"${SUP_MAIL}"}', '${SUP_MAIL}', 'pending', '${jobId}', '${users.b.id}', '${p3b}')`);
    const q2 = localSql(`select id from approval_queue where purchase_order_id = '${p3b}'`);
    const r2 = await resolveApproval(q2, "approved");
    expect(r2, JSON.stringify(r2)).toMatchObject({ ok: true });
    expect(row(poMail(p3b))).toMatchObject({ direction: "out", mailbox: "-", owner: users.d.id, po: p3b });

    // obchodník B schválí objednávku své zakázky s požadavkem na schránku A → stejně ze své (B)
    const p3c = await newPo("vystavena", 32);
    localSql(`insert into approval_queue (type, title, payload, target, status, order_id, owner_id, purchase_order_id)
      values ('purchase_order', 'Objednávka OV-${TAG}-32', '{"kind":"issue","subject":"Objednávka OV-${TAG}-32","to":"${SUP_MAIL}"}', '${SUP_MAIL}', 'pending', '${jobId}', '${users.b.id}', '${p3c}')`);
    const q3 = localSql(`select id from approval_queue where purchase_order_id = '${p3c}'`);
    as("b");
    const r3 = await resolveApproval(q3, "approved", { fromMailboxId: boxes.a });
    expect(r3, JSON.stringify(r3)).toMatchObject({ ok: true });
    expect(row(poMail(p3c))).toMatchObject({ direction: "out", mailbox: boxes.b, owner: users.b.id, po: p3c });
  }, 180_000);

  it("objednávka po anonymizaci výkresů (fronta odeslání) → v Odeslaných s dodavatelem a objednávkou", async () => {
    const p4 = await newPo("vystavena", 4);
    const docs = await po();
    const v4 = (await (await data()).fetchPurchaseOrder(db as never, p4))!;
    const stored = await docs.storePurchaseOrderPdfCore(db as never, { id: users.a.id, fullName: users.a.name }, v4);
    expect("fileId" in stored, JSON.stringify(stored)).toBe(true);
    const fileId = (stored as { fileId: string }).fileId;
    const sq = await import("@/lib/anonymize/send-queue");
    const q = await sq.enqueueSend(db as never, {
      kind: "purchase_order", jobId, refId: p4, createdBy: users.a.id,
      payload: { to: [SUP_MAIL], subject: `Objednávka OV-${TAG}-4`, body: "Dobrý den,\nobjednávka v příloze.", extraFileIds: [fileId], purchaseOrderId: p4 },
      fileIds: [],
    });
    expect(q.ok, JSON.stringify(q)).toBe(true);
    const out = await sq.flushSendQueue(db as never, { ids: [(q as { id: string }).id] });
    expect(out.sent).toBe(1);
    const emailId = poMail(p4);
    expect(emailId).toBeTruthy();
    expect(row(emailId)).toMatchObject({ direction: "out", mailbox: boxes.a, owner: users.a.id, job: jobId, supplier: supplierId, po: p4, category: "objednavka", attachments: true });
    await expectVisible(emailId, ["a", "d"], ["c"]);
    expect(localSql(`select status from purchase_orders where id = '${p4}'`)).toBe("odeslana");
  }, 120_000);

  it("doklady zákazníkovi (potvrzení, dodací list, faktura): obchodník ze své schránky, admin bez schránky přes globální SMTP", async () => {
    const { sendJobDocument } = await import("@/app/actions/job-documents");
    const docsToSend: { kind: string; who: Key }[] = [
      { kind: "potvrzeni", who: "a" }, { kind: "dodaci_list", who: "a" }, { kind: "faktura", who: "a" }, { kind: "potvrzeni", who: "d" },
    ];
    for (const [i, d] of docsToSend.entries()) {
      const p = `zakazky/${jobId}/${TAG}-${i}.pdf`;
      paths.push(p);
      const { error } = await db.storage.from("job-files").upload(p, Buffer.from(`%PDF-1.4\n% ${TAG} ${d.kind}\n`), { contentType: "application/pdf", upsert: true });
      if (error) throw new Error(error.message);
      const fileId = localSql(`insert into job_files (job_id, kind, title, filename, mime_type, storage_path, size_bytes, origin, issuer)
        values ('${jobId}', '${d.kind}', '${d.kind}', '${d.kind}-${TAG}.pdf', 'application/pdf', '${p}', 30, 'generated', 'my') returning id`).split("\n")[0];
      as(d.who);
      const r = await sendJobDocument(jobId, fileId, { to: CUST_MAIL, subject: `Doklad ${d.kind} ${TAG}`, body: `Dobrý den,\nv příloze ${d.kind}.` });
      expect(r.ok, `${d.kind}/${d.who}: ${r.error}`).toBe(true);
      const emailId = r.emailId!;
      expect(emailId, `${d.kind}/${d.who} bez záznamu`).toBeTruthy();
      expect(row(emailId)).toMatchObject({
        direction: "out", owner: users[d.who].id, job: jobId, customer: customerId, attachments: true,
        mailbox: d.who === "a" ? boxes.a : "-", sentCopy: "skipped",
        ...(d.who === "a" ? { sentCopy: "ok" } : {}),
      });
      await expectVisible(emailId, d.who === "a" ? ["a", "d"] : ["d"], ["c"]);
    }
  }, 180_000);

  it("AI nabídka (plná automatika) → odejde s PDF a je v Odeslaných obchodníka", async () => {
    localSql("update automation_settings set mode = 'full' where module = 'quote'");
    localSql(`update profiles set quote_needs_approval = false where id = '${users.a.id}'`);
    as("a");
    const { submitAiQuote } = await import("@/app/actions/ai-quote");
    const r = await submitAiQuote({
      customer: `Zákazník ${TAG}`, customerEmail: CUST_MAIL, items: [{ description: `Hřídel ${TAG}`, quantity: 2, unit: "ks", unit_price: 100, vat_rate: 21 }],
      coverEmail: `Dobrý den,\nposíláme nabídku ${TAG}.`, leadTimeDays: 10, validUntilDays: 30, autoSend: true,
    });
    expect(r.ok, r.error).toBe(true);
    expect(r.sent, r.sentReason).toBe(true);
    const emailId = localSql(`select id from emails where direction = 'out' and subject like 'Cenová nabídka ${r.number}%' limit 1`);
    expect(emailId).toBeTruthy();
    expect(row(emailId)).toMatchObject({ direction: "out", mailbox: boxes.a, owner: users.a.id, attachments: true, sentCopy: "ok" });
    localSql(`update emails set subject = subject || ' ${TAG}' where id = '${emailId}'`); // vyhledání složky podle značky testu
    await expectVisible(emailId, ["a", "d"], ["c"]);
  }, 120_000);

  it("schválená odpověď z fronty (e-mail zákazníkovi) a okno psaní → v Odeslaných odesílatele", async () => {
    const inbound = localSql(`insert into emails (mailbox_id, owner_id, direction, from_email, from_name, to_email, subject, body_text, message_id, received_at, order_id, customer_id)
      values ('${boxes.a}', '${users.a.id}', 'in', '${CUST_MAIL}', 'Zákazník', '${BOX_A.user}', 'Dotaz ${TAG}', 'Kdy dodáte?', '<dotaz-${TAG}@zak.test>', now() - interval '1 hour', '${jobId}', '${customerId}') returning id`).split("\n")[0];
    localSql(`insert into approval_queue (type, title, payload, target, status, order_id, owner_id, email_id)
      values ('email_reply', 'Odpověď ${TAG}', '{"subject":"Re: Dotaz ${TAG}","body":"Dodáme v pátek."}', '${CUST_MAIL}', 'pending', '${jobId}', '${users.a.id}', '${inbound}')`);
    const qid = localSql(`select id from approval_queue where email_id = '${inbound}'`);
    // frontu vyřizuje super admin (bez vlastní schránky; osobní schránka kolegy se nepoužije → globální SMTP)
    as("d");
    const { resolveApproval } = await import("@/app/actions/approvals");
    const r = await resolveApproval(qid, "approved");
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, sent: true });
    const replyId = localSql(`select id from emails where direction = 'out' and in_reply_to = '<dotaz-${TAG}@zak.test>' limit 1`);
    expect(replyId).toBeTruthy();
    expect(row(replyId)).toMatchObject({ mailbox: "-", owner: users.d.id, job: jobId, customer: customerId, sentCopy: "skipped" });
    await expectVisible(replyId, ["d"], ["c"]);

    as("a");

    const { sendComposedAction } = await import("@/app/actions/mail-compose");
    const c = await sendComposedAction({ mode: "new", to: SUP_MAIL, subject: `Dotaz na termín ${TAG}`, body: "Dobrý den,\njaký je termín?", jobId });
    expect(c.ok, c.error).toBe(true);
    expect(row(c.emailId!)).toMatchObject({ direction: "out", mailbox: boxes.a, owner: users.a.id, job: jobId, sentCopy: "ok" });
    await expectVisible(c.emailId!, ["a", "d"], ["c"]);
  }, 120_000);

  it("majitel 9. 11.: zaměstnanec (plný přístup) i obchodník posílají vždy ze své schránky; jen super admin vybírá (a špatnou volbu odmítne)", async () => {
    const lastFrom = (needle: string) => srv.sent.filter((m) => m.raw.includes(needle)).map((m) => m.from.replace(/^MAIL FROM:\s*<|>.*$/gi, "")).pop();

    // zaměstnanec s plným přístupem a vlastní schránkou pošle objednávku zakázky obchodníka B (i s „volbou" schránky B)
    const p7 = await newPo("vystavena", 7);
    as("e");
    const { sendPurchaseOrder } = await import("@/app/actions/purchasing");
    const s7 = await sendPurchaseOrder(p7, { to: SUP_MAIL, subject: `Objednávka OV-${TAG}-7`, body: "Dobrý den,\nobjednáváme." }, { attachmentIds: [], fromMailboxId: boxes.b });
    expect(s7.ok, s7.error).toBe(true);
    expect(row(poMail(p7))).toMatchObject({ direction: "out", mailbox: boxes.e, owner: users.e.id, po: p7, supplier: supplierId, sentCopy: "ok" });
    expect(lastFrom(`OV-${TAG}-7`)).toBe(BOX_E.user);
    expect(localSql(`select sent_mailbox_id from purchase_orders where id = '${p7}'`)).toBe(boxes.e);

    // doklad zákazníkovi: obchodník A s požadavkem na schránku B → ze své (A); super admin s volbou B → z B (Odeslané B)
    const { sendJobDocument } = await import("@/app/actions/job-documents");
    const upload = async (n: number) => {
      const p = `zakazky/${jobId}/${TAG}-pravidlo-${n}.pdf`;
      paths.push(p);
      const { error } = await db.storage.from("job-files").upload(p, Buffer.from(`%PDF-1.4\n% ${TAG} ${n}\n`), { contentType: "application/pdf", upsert: true });
      if (error) throw new Error(error.message);
      return localSql(`insert into job_files (job_id, kind, title, filename, mime_type, storage_path, size_bytes, origin, issuer)
        values ('${jobId}', 'dodaci_list', 'DL', 'dl-${TAG}-${n}.pdf', 'application/pdf', '${p}', 30, 'generated', 'my') returning id`).split("\n")[0];
    };
    as("a");
    const fa = await upload(1);
    const da = await sendJobDocument(jobId, fa, { to: CUST_MAIL, subject: `DL A ${TAG}`, body: "Dobrý den,\nv příloze.", fromMailboxId: boxes.b });
    expect(da.ok, da.error).toBe(true);
    expect(row(da.emailId!)).toMatchObject({ mailbox: boxes.a, owner: users.a.id });
    expect(lastFrom(`DL A ${TAG}`)).toBe(BOX_A.user);

    as("d");
    const fd = await upload(2);
    const dd = await sendJobDocument(jobId, fd, { to: CUST_MAIL, subject: `DL D ${TAG}`, body: "Dobrý den,\nv příloze.", fromMailboxId: boxes.b });
    expect(dd.ok, dd.error).toBe(true);
    expect(row(dd.emailId!)).toMatchObject({ mailbox: boxes.b, owner: users.b.id, sentCopy: "ok" });
    expect(lastFrom(`DL D ${TAG}`)).toBe(BOX_B.user);
    await expectVisible(dd.emailId!, ["b", "d"], ["c"]);

    as("d");
    // super admin vybere schránku bez odesílání → NEodejde potichu odjinud, řekne proč
    const { data: nb, error: nbErr } = await db.from("mailboxes").insert({
      provider: "imap", email: `bez-smtp-${TAG.toLowerCase()}@nastrojarstvi.test`, owner_id: users.c.id, active: true,
      config: { imap_host: "127.0.0.1", imap_port: srv.ports.imaps, imap_user: "x", imap_password: "y" },
    }).select("id").single();
    if (nbErr) throw new Error(nbErr.message);
    const fx = await upload(3);
    const before = Number(localSql(`select count(*) from emails where subject = 'DL X ${TAG}'`));
    const dx = await sendJobDocument(jobId, fx, { to: CUST_MAIL, subject: `DL X ${TAG}`, body: "x", fromMailboxId: (nb as { id: string }).id });
    expect(dx.ok).toBe(false);
    expect(dx.error).toMatch(/nemá nastavené odesílání/);
    expect(Number(localSql(`select count(*) from emails where subject = 'DL X ${TAG}'`))).toBe(before);
    await db.from("mailboxes").delete().eq("id", (nb as { id: string }).id);

    // okno psaní: super admin pošle ze schránky A; obchodník C (bez schránky) s volbou A → ne z A (globální SMTP)
    const { sendComposedAction } = await import("@/app/actions/mail-compose");
    const cd = await sendComposedAction({ mode: "new", to: CUST_MAIL, subject: `Psaní D ${TAG}`, body: "Dobrý den.", fromMailboxId: boxes.a });
    expect(cd.ok, cd.error).toBe(true);
    expect(row(cd.emailId!)).toMatchObject({ mailbox: boxes.a, owner: users.a.id });
    as("c");
    const cc = await sendComposedAction({ mode: "new", to: CUST_MAIL, subject: `Psaní C ${TAG}`, body: "Dobrý den.", fromMailboxId: boxes.a });
    expect(cc.ok, cc.error).toBe(true);
    expect(row(cc.emailId!)).toMatchObject({ mailbox: "-", owner: users.c.id });
    expect(lastFrom(`Psaní C ${TAG}`)).not.toBe(BOX_A.user);
  }, 180_000);

  it("záznam vznikne i když vazba neprojde (smazaná zakázka) a zpráva už uložená stažením Odeslaných se jen doplní", async () => {
    const { recordSentMail } = await import("@/lib/email/send");
    const base = {
      mailbox_id: boxes.a, direction: "out", from_email: BOX_A.user, to_email: SUP_MAIL, subject: `Vazba ${TAG}`, body_text: "x", snippet: "x",
      owner_id: users.a.id, is_read: true, has_draft: false, has_attachments: false, sent_copy: "skipped", received_at: new Date().toISOString(),
    };
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const id = await recordSentMail({ ...base, message_id: `<vazba-${TAG}@x>`, order_id: "00000000-0000-0000-0000-0000000000ff", category: "objednavka" });
    expect(id).toBeTruthy();
    expect(row(id!)).toMatchObject({ direction: "out", owner: users.a.id, job: "-", mailbox: boxes.a });
    expect(err.mock.calls.some((c) => String(c[0]).includes("se nezapsal do Odeslaných"))).toBe(true);

    // kopie ze složky Odeslané uložená synchronizací dřív (vlastník schránky, bez vazeb) → doplnit, ne zahodit
    const synced = localSql(`insert into emails (mailbox_id, owner_id, direction, from_email, to_email, subject, body_text, message_id, received_at)
      values ('${boxes.b}', '${users.b.id}', 'out', '${BOX_B.user}', '${SUP_MAIL}', 'Sync ${TAG}', 'x', '<sync-${TAG}@x>', now()) returning id`).split("\n")[0];
    const claimed = await recordSentMail({ ...base, mailbox_id: boxes.b, subject: `Sync ${TAG}`, message_id: `<sync-${TAG}@x>`, order_id: jobId, supplier_id: supplierId, category: "objednavka" });
    expect(claimed).toBe(synced);
    expect(row(synced)).toMatchObject({ owner: users.a.id, job: jobId, supplier: supplierId, category: "objednavka" });
    err.mockRestore();
  }, 60_000);
  it("migrace 20261103120000: doplní chybějící záznamy odeslané pošty z historie zakázky (idempotentně, bez duplicit)", async () => {
    const p5 = await newPo("odeslana", 5);
    const p6 = await newPo("odeslana", 6);
    const ev = (poId: string, n: number, mins: number) => localSql(`insert into job_events (job_id, type, message, data, actor_id, actor_kind, entity, entity_id, created_at)
      values ('${jobId}', 'email', 'Objednávka OV-${TAG}-${n} odeslána dodavateli Kooperant (${SUP_MAIL}) z ${BOX_B.user}',
        jsonb_build_object('purchaseOrderId', '${poId}', 'number', 'OV-${TAG}-${n}', 'to', jsonb_build_array('${SUP_MAIL}'), 'emailId', null, 'mailKind', 'issue', 'mailboxId', '${boxes.b}'),
        '${users.a.id}', 'user', 'purchase_order', '${poId}', now() - interval '${mins} minutes') returning id`).split("\n")[0];
    const e5 = ev(p5, 5, 90);
    ev(p6, 6, 80);
    // p6: kopie ze složky Odeslané uložená synchronizací (majitel schránky, bez zakázky) — doplní se, nezaloží znovu
    const synced = localSql(`insert into emails (mailbox_id, owner_id, direction, from_email, to_email, subject, body_text, message_id, received_at)
      values ('${boxes.b}', '${users.b.id}', 'out', '${BOX_B.user}', '${SUP_MAIL}', 'Objednávka OV-${TAG}-6 — Kooperant', 'x', '<sync6-${TAG}@x>', now() - interval '79 minutes') returning id`).split("\n")[0];
    // doklad zákazníkovi bez emailId (předmět v datech)
    localSql(`insert into job_events (job_id, type, message, data, actor_id, actor_kind, created_at)
      values ('${jobId}', 'email', 'Faktura odeslána zákazníkovi', jsonb_build_object('fileId', gen_random_uuid(), 'kind', 'faktura', 'number', 'FV-${TAG}', 'to', jsonb_build_array('${CUST_MAIL}'), 'cc', '[]'::jsonb, 'subject', 'Faktura FV-${TAG}'),
        '${users.a.id}', 'user', now() - interval '70 minutes')`);

    const migration = path.resolve(__dirname, "../../../supabase/migrations/20261103121000_odeslana_posta_doplneni.sql");
    const run = () => execFileSync(path.resolve(__dirname, "../../../tools/local-supabase/psql.sh"), ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", migration], { stdio: ["ignore", "pipe", "pipe"] });
    run();
    run(); // podruhé nic nepřibude

    expect(localSql(`select count(*) from emails where message_id = 'backfill:je:${e5}'`)).toBe("1");
    const id5 = localSql(`select id from emails where message_id = 'backfill:je:${e5}'`);
    expect(row(id5)).toMatchObject({ direction: "out", mailbox: boxes.b, owner: users.a.id, job: jobId, supplier: supplierId, po: p5, category: "objednavka" });
    await expectVisible(id5, ["a", "b", "d"], ["c"]);

    expect(localSql(`select count(*) from emails where direction = 'out' and subject like '%OV-${TAG}-6%'`)).toBe("1");
    expect(row(synced)).toMatchObject({ owner: users.a.id, job: jobId, po: p6, supplier: supplierId, category: "objednavka" });

    expect(localSql(`select count(*) from emails where direction = 'out' and subject = 'Faktura FV-${TAG}'`)).toBe("1");
    const inv = localSql(`select id from emails where direction = 'out' and subject = 'Faktura FV-${TAG}'`);
    expect(row(inv)).toMatchObject({ owner: users.a.id, job: jobId, customer: customerId, category: "faktura", mailbox: "-" });
    await expectVisible(inv, ["a", "d"], ["b", "c"]);
  }, 120_000);
});
