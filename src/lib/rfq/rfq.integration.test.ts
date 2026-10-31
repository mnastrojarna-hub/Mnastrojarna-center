import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_ENABLED, loadLocalEnv, localAdmin, localSession, localSql } from "@/test/local-supabase";

/**
 * Poptávky dodavatelům ↔ lokální Supabase (migrace 20261031160000):
 *  - nastavení kola (položky, výkresy a jejich stav, dodavatelé s e-mailem pro poptávky, kvalita),
 *  - náhled a odeslání: každý dodavatel SAMOSTATNÝ e-mail, PDF poptávky + anonymizovaný výkres s neutrálním názvem,
 *    nic o zákazníkovi (jméno, IČO, číslo objednávky / poptávky, název zakázky) — ani v předmětu, textu, názvech příloh,
 *  - čekající nabídky bez ceny (stav „Čeká na ceny dodavatelů"), výkres čekající na anonymizaci → fronta (neutrální názvy),
 *  - odpověď s naším číslem → „Odpověděl", Zapsat nabídku, porovnání, Vybrat (doporučený / jiný s důvodem) → nákupní cena,
 *    nevybraní bez odpovědi uklizeni, urgence ve vlákně, odmítnutí, chyba SMTP → K odeslání → Zkusit znovu,
 *  - RLS: zaměstnanec bez „Smí poptávat" kola nevidí, s příznakem ano; příznak si sám nezapne.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/rfq/rfq.integration.test.ts
 * Vlastní data „RFQIT-<tag>", na konci se uklidí.
 */

type Sent = { to: string; subject: string; text: string; attachments?: { filename: string; content: Buffer }[]; inReplyTo?: string | null; supplierId?: string | null };
const mail = vi.hoisted(() => ({ sent: [] as Sent[], fail: false }));

vi.mock("@/lib/email/send", () => ({
  sendMail: vi.fn(async (a: Sent) => {
    if (mail.fail) return { sent: false, reason: "SMTP: 535 špatné heslo (test)" };
    mail.sent.push(a);
    return { sent: true, emailId: undefined, messageId: `<rfq-it-${mail.sent.length}@test>` };
  }),
  senderSignatureText: vi.fn(async () => "Dominik Šponer\nMnástrojárna s.r.o."),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const TAG = `RFQIT${Date.now().toString(36).toUpperCase()}`;
// jméno zákazníka nesdílí slova se značkou (ta je v číslech výkresů a adresách dodavatelů)
const CUSTOMER = `Strojmetal Brněnská ${Date.now() % 1_000_000} a.s.`;
const ICO = String(10_000_000 + Math.floor(Math.random() * 80_000_000));
const PO = `PO-${TAG}-77`;

describe.skipIf(!LOCAL_ENABLED)("poptávky dodavatelům ↔ lokální Supabase", () => {
  let db: SupabaseClient;
  let store: typeof import("./store");
  let reply: typeof import("./reply");
  let adminId: string;
  let workerId: string;
  let jobId: string;
  let item1: string;
  let item2: string;
  let readyFile: string;
  let pendingFile: string;
  const sups: { id: string; name: string; email: string }[] = [];
  const paths: string[] = [];
  const actor = () => ({ id: adminId, fullName: "Super Admin", role: "super_admin" });

  beforeAll(async () => {
    const env = loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    db = localAdmin();
    store = await import("./store");
    reply = await import("./reply");
    adminId = localSql("select id from profiles where email = 'admin@local.test'");
    workerId = localSql("select id from profiles where email = 'dilna@local.test'");
    const cust = localSql(`insert into customers (name, ico, country, email) values ('${CUSTOMER}', '${ICO}', 'CZ', 'nakup@strojmetal-${TAG.toLowerCase()}.test') returning id`).split("\n")[0];
    jobId = localSql(`insert into orders (number, title, status, source, owner_id, created_by, customer_id, customer_order_number, customer_inquiry_number, due_date)
      values ('Z-${TAG}', '${CUSTOMER} — hřídele', 'naceneni', 'manual', '${adminId}', '${adminId}', '${cust}', '${PO}', 'RFQ-${TAG}', app_today() + 30) returning id`).split("\n")[0];
    item1 = localSql(`insert into order_items (order_id, position, drawing_number, revision, name, material, quantity, unit, unit_price)
      values ('${jobId}', 0, 'VK-${TAG}-1', 'A', 'Hřídel pro ${CUSTOMER}', '42CrMo4', 50, 'ks', null) returning id`).split("\n")[0];
    item2 = localSql(`insert into order_items (order_id, position, drawing_number, revision, name, material, quantity, unit, unit_price)
      values ('${jobId}', 1, 'VK-${TAG}-2', 'B', 'Pouzdro', 'C45', 20, 'ks', null) returning id`).split("\n")[0];
    // výkres 1: hotová anonymizovaná kopie v úložišti (původní název nese jméno zákazníka); výkres 2: čeká na anonymizaci
    const orig = Buffer.from("%PDF-1.4\n% original\n");
    const anon = Buffer.from(`%PDF-1.4\n% anon ${TAG}\n`);
    {
      const id = randomUUID();
      const p = `zakazky/${jobId}/${id}-${CUSTOMER.replace(/\s/g, "_")}_VK1.pdf`;
      const a = `zakazky/${jobId}/anon/${id}.pdf`;
      paths.push(p, a);
      await db.storage.from("job-files").upload(p, orig, { contentType: "application/pdf" });
      await db.storage.from("job-files").upload(a, anon, { contentType: "application/pdf" });
      const sha = createHash("sha256").update(anon).digest("hex");
      readyFile = localSql(`insert into job_files (job_id, kind, title, filename, mime_type, storage_path, order_item_id, anon_status, anon_path, anon_filename, anon_mime, anon_sha256)
        values ('${jobId}', 'vykres', 'Výkres', '${CUSTOMER} VK1.pdf', 'application/pdf', '${p}', '${item1}', 'done', '${a}', 'VK-${TAG}-1_A.pdf', 'application/pdf', '${sha}') returning id`).split("\n")[0];
    }
    pendingFile = localSql(`insert into job_files (job_id, kind, title, filename, mime_type, storage_path, order_item_id, anon_status)
      values ('${jobId}', 'vykres', 'Výkres 2', '${CUSTOMER} VK2.pdf', 'application/pdf', 'zakazky/${jobId}/${randomUUID()}-vk2.pdf', '${item2}', 'pending') returning id`).split("\n")[0];
    for (const [n, tech] of [["Hrubý", "frezovani_3osy"], ["Novák", "soustruzeni"], ["Kalírna", "tepelne_zpracovani"]] as const) {
      const email = `${n.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()}-${TAG.toLowerCase()}@dod.test`;
      const id = localSql(`insert into suppliers (name, email, technologies, rating) values ('${n} ${TAG}', '${email}', array['${tech}'], 4.5) returning id`).split("\n")[0];
      sups.push({ id, name: `${n} ${TAG}`, email });
    }
    // Novák: zvláštní e-mail pro poptávky (účel „Poptávky (RFQ)")
    sups[1].email = `poptavky-${TAG.toLowerCase()}@dod.test`;
    localSql(`insert into party_role_emails (supplier_id, role, email, is_default, source) values ('${sups[1].id}', 'nabidky', '${sups[1].email}', true, 'manual')`);
  });

  afterAll(async () => {
    if (!db || !jobId) return;
    localSql(`delete from anon_send_queue where job_id = '${jobId}'`);
    localSql(`delete from mail_outbox where payload->>'jobId' = '${jobId}'`);
    localSql(`delete from rfq_rounds where job_id = '${jobId}'`);
    localSql(`delete from supplier_quotes where job_id = '${jobId}'`);
    const files = localSql(`select storage_path from job_files where job_id = '${jobId}' and storage_path is not null`).split("\n").filter(Boolean);
    await db.storage.from("job-files").remove([...paths, ...files]).catch(() => undefined);
    localSql(`delete from job_files where job_id = '${jobId}'`);
    localSql(`delete from emails where subject like '%${TAG}%' or body_text like '%${TAG}%'`);
    localSql(`delete from orders where id = '${jobId}'`);
    localSql(`delete from party_role_emails where supplier_id in (${sups.map((s) => `'${s.id}'`).join(",") || "null"})`);
    localSql(`delete from suppliers where name like '%${TAG}'`);
    localSql(`delete from customers where name = '${CUSTOMER}'`);
    localSql(`delete from audit_log where diff->>'jobId' = '${jobId}'`);
  });

  const guardTexts = () => [CUSTOMER, "Strojmetal", ICO, PO, `RFQ-${TAG}`, "hřídele"];
  function noCustomer(s: string, what: string) {
    for (const t of guardTexts()) expect(s.toLowerCase().includes(t.toLowerCase()), `${what} obsahuje „${t}“: ${s.slice(0, 400)}`).toBe(false);
  }

  it("nastavení kola: položky, stav výkresů, dodavatelé s e-mailem pro poptávky, výchozí termíny", async () => {
    const s = await store.loadRfqSetup(db as never, jobId);
    expect(s).not.toBeNull();
    expect(s!.items.map((i) => i.id)).toEqual([item1, item2]);
    const d = new Map(s!.drawings.map((x) => [x.id, x]));
    expect(d.get(readyFile)).toMatchObject({ status: "ready", itemId: item1, name: `VK-${TAG}-1_A.pdf` });
    expect(d.get(pendingFile)).toMatchObject({ status: "pending", itemId: item2 });
    const novak = s!.suppliers.find((x) => x.id === sups[1].id);
    expect(novak?.email).toBe(sups[1].email);
    expect(s!.defaults.requiredDate < s!.job.customerDate!).toBe(true);
  });

  it("náhled: každý dodavatel zvlášť, bez zákazníka, výkres čeká na anonymizaci", async () => {
    const input = baseInput();
    const p = await store.previewRfq(db as never, actor(), input);
    if ("error" in p) throw new Error(p.error);
    expect(p.mails.map((m) => m.to)).toEqual(sups.map((s) => [s.email]));
    expect(p.leaks).toEqual([]);
    expect(p.redacted.length).toBeGreaterThan(0); // „Hřídel pro Strojmetal…" → bez zákazníka
    expect(p.pending).toBe(1);
    for (const m of p.mails) noCustomer(`${m.subject}\n${m.body}\n${m.attachments.map((a) => a.name).join(" ")}`, "náhled");
  });

  function baseInput(over: Record<string, unknown> = {}) {
    return {
      jobId, scope: "dil" as const, items: [{ orderItemId: item1, quantities: [50, 100] }, { orderItemId: item2, quantities: [20] }],
      requiredDate: localSql("select (app_today() + 20)::text"), replyBy: localSql("select (app_today() + 3)::text"),
      note: `Prosíme o atest 3.1 (pro ${CUSTOMER})`, recipients: sups.map((s) => ({ supplierId: s.id, emails: [s.email] })),
      ...over,
    };
  }

  let roundId = "";
  let number = "";
  it("odeslání bez čekajícího výkresu: 3 samostatné e-maily, PDF + anonymizovaný výkres, čekající nabídky bez ceny", async () => {
    mail.sent = [];
    const r = await store.createAndSendRound(db as never, actor(), baseInput({ skipPending: true }));
    if ("error" in r) throw new Error(r.error);
    roundId = r.roundId;
    number = r.number;
    expect(number).toMatch(/^PD-20\d{2}-\d{3,}$/);
    expect(r).toMatchObject({ sent: 3, waiting: 0, failed: [] });
    expect(mail.sent.map((m) => m.to)).toEqual(sups.map((s) => s.email));
    for (const m of mail.sent) {
      expect(m.to.includes(",")).toBe(false);
      expect(m.subject).toBe(`Poptávka ${number}`);
      expect(m.text).toContain(`${number}/1: VK-${TAG}-1 rev. A`);
      expect(m.text).toContain("50 ks / 100 ks");
      expect((m.attachments ?? []).map((a) => a.filename)).toEqual([`Poptavka-${number}.pdf`, `VK-${TAG}-1_A.pdf`]);
      noCustomer(`${m.subject}\n${m.text}\n${(m.attachments ?? []).map((a) => a.filename).join(" ")}`, "e-mail");
      const pdf = (m.attachments ?? [])[0].content;
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    }
    const recs = localSql(`select string_agg(status || ':' || coalesce(supplier_quote_id::text, '-'), ',' order by rank) from rfq_recipients where round_id = '${roundId}'`).split(",");
    expect(recs.every((x) => x.startsWith("odeslano:") && !x.endsWith(":-"))).toBe(true);
    expect(localSql(`select count(*) from supplier_quotes where job_id = '${jobId}' and total is null and rfq_recipient_id is not null`)).toBe("3");
    expect(localSql(`select pricing_key from job_flow_v where id = '${jobId}'`)).toBe("ceka_na_dodavatele");
    // PDF poptávky v Dokumentech zakázky = náš doklad (ne nákupní), bez zákazníka v názvu
    expect(localSql(`select kind || '|' || issuer || '|' || origin || '|' || filename from job_files where id = (select file_id from rfq_rounds where id = '${roundId}')`))
      .toBe(`naceneni|my|generated|Poptavka-${number}.pdf`);
    const view = await store.loadJobRfq(db as never, jobId);
    expect(view?.rounds[0].items[0].name).not.toMatch(/strojmetal/i);
  });

  it("výkres čeká na anonymizaci → fronta (neutrální názvy), stav „Čeká na anonymizaci“", async () => {
    mail.sent = [];
    const r = await store.createAndSendRound(db as never, actor(), baseInput({ recipients: [{ supplierId: sups[0].id, emails: [sups[0].email] }] }));
    if ("error" in r) throw new Error(r.error);
    expect(r).toMatchObject({ sent: 0, waiting: 1 });
    expect(mail.sent).toHaveLength(0);
    const q = localSql(`select kind || '|' || status || '|' || array_length(file_ids, 1) || '|' || (payload->'neutralNames'->>'${readyFile}') from anon_send_queue where job_id = '${jobId}' and ref_id = '${r.roundId}'`);
    expect(q).toBe(`supplier_inquiry|waiting|2|VK-${TAG}-1_A.pdf`);
    expect(localSql(`select status from rfq_recipients where round_id = '${r.roundId}'`)).toBe("ceka_na_anonymizaci");
    localSql(`update rfq_rounds set status = 'zrusene' where id = '${r.roundId}'`);
  });

  it("odpověď s naším číslem → „Odpověděl“ a zakázka kola; nabídky, porovnání, Vybrat (doporučený / jiný s důvodem)", async () => {
    const emailId = localSql(`insert into emails (direction, from_email, from_name, subject, body_text, received_at)
      values ('in', '${sups[1].email}', 'Novák', 'Re: Poptávka ${number}', 'VK-${TAG}-1: 410 Kč / 380 Kč\nVK-${TAG}-2: 150 Kč\nDodací lhůta 10 dní', now()) returning id`).split("\n")[0];
    const hit = await reply.noteRfqReply(db, { id: emailId, direction: "in", subject: `Re: Poptávka ${number}`, body_text: "x", from_email: sups[1].email, supplier_id: null, in_reply_to: null, message_refs: null });
    expect(hit?.jobId).toBe(jobId);
    const novak = localSql(`select id from rfq_recipients where round_id = '${roundId}' and supplier_id = '${sups[1].id}'`);
    expect(hit?.recipientId).toBe(novak);
    expect(localSql(`select status || '|' || reply_email_id from rfq_recipients where id = '${novak}'`)).toBe(`odpovedel|${emailId}`);
    const pre = await store.replyText(db as never, novak);
    expect(pre?.text).toContain("410 Kč");

    const hruby = localSql(`select id from rfq_recipients where round_id = '${roundId}' and supplier_id = '${sups[0].id}'`);
    const kalirna = localSql(`select id from rfq_recipients where round_id = '${roundId}' and supplier_id = '${sups[2].id}'`);
    const offer = (p1: number, p1b: number, p2: number, lead: number) => ({
      leadTimeDays: lead, lines: [{ orderItemId: item1, quantity: 50, unitPrice: p1 }, { orderItemId: item1, quantity: 100, unitPrice: p1b }, { orderItemId: item2, quantity: 20, unitPrice: p2 }],
    });
    expect(await store.saveRecipientOffer(db as never, actor(), novak, offer(410, 380, 150, 10))).toMatchObject({ ok: true });
    expect(await store.saveRecipientOffer(db as never, actor(), hruby, offer(450, 420, 140, 12))).toMatchObject({ ok: true });
    expect(await store.saveRecipientOffer(db as never, actor(), hruby, { lines: [{ orderItemId: item1, quantity: 7, unitPrice: 1 }] })).toMatchObject({ error: "Množství nebylo poptáno." });
    expect(localSql(`select total from supplier_quotes where rfq_recipient_id = '${novak}'`)).toBe("23500.00");

    const data = await store.loadJobRfq(db as never, jobId);
    const round = data!.rounds.find((r) => r.id === roundId)!;
    expect(round.offers).toHaveLength(2);
    const { compareRfq } = await import("./model");
    const cmp = compareRfq(round, new Map(data!.quality.map((q) => [q.supplierId, q])), data!.weights, new Map(data!.ratings.map((r) => [r.supplierId, r])));
    expect(cmp.rows[0].recommended?.recipientId).toBe(novak);
    expect(cmp.rows[1].recommended?.recipientId).toBe(hruby);

    // jiný než doporučený bez důvodu → chyba; s důvodem → uloží se kdo / proč
    expect(await store.selectWinner(db as never, actor(), roundId, { orderItemId: item1, recipientId: hruby })).toMatchObject({ error: expect.stringContaining("napiš krátce proč") });
    expect(await store.selectWinner(db as never, actor(), roundId, { orderItemId: item1, recipientId: novak })).toEqual({ ok: true, overridden: false });
    expect(await store.selectWinner(db as never, actor(), roundId, { orderItemId: item2, recipientId: novak, reason: "jeden dodavatel na vše" })).toEqual({ ok: true, overridden: true });
    expect(localSql(`select purchase_unit_price from order_items where id = '${item1}'`)).toBe("410.00");
    expect(localSql(`select purchase_unit_price from order_items where id = '${item2}'`)).toBe("150.00");
    expect(localSql(`select overridden || '|' || override_reason || '|' || selected_by from rfq_selections where round_id = '${roundId}' and order_item_id = '${item2}'`))
      .toBe(`true|jeden dodavatel na vše|${adminId}`);
    expect(localSql(`select status from rfq_rounds where id = '${roundId}'`)).toBe("vybrano");
    // jeden dodavatel na vše → vítězná nabídka zakázky (dodavatel, plánovaný nákup)
    expect(localSql(`select selected from supplier_quotes where rfq_recipient_id = '${novak}'`)).toBe("t");
    expect(localSql(`select supplier_id || '|' || purchase_cost from orders where id = '${jobId}'`)).toBe(`${sups[1].id}|23500.00`);
    // Kalírna neodpověděla → bez odpovědi, čekající nabídka bez ceny uklizená (konec „Čeká na ceny dodavatelů")
    expect(localSql(`select status from rfq_recipients where id = '${kalirna}'`)).toBe("bez_odpovedi");
    expect(localSql(`select count(*) from supplier_quotes where total is null and rfq_recipient_id in (select id from rfq_recipients where round_id = '${roundId}')`)).toBe("0");

    // poděkování nevybranému s nabídkou (Hrubý), ve vlákně
    mail.sent = [];
    expect(await store.thankOthers(db as never, actor(), roundId)).toEqual({ ok: true, sent: 1 });
    expect(mail.sent[0]).toMatchObject({ to: sups[0].email, subject: `Re: Poptávka ${number}` });
  });

  it("urgence, odmítnutí, chyba SMTP → K odeslání → Zkusit znovu", async () => {
    const r = await store.createAndSendRound(db as never, actor(), baseInput({ skipPending: true, recipients: [{ supplierId: sups[2].id, emails: [sups[2].email] }, { supplierId: sups[0].id, emails: [sups[0].email] }] }));
    if ("error" in r) throw new Error(r.error);
    const [kal, hru] = localSql(`select string_agg(id::text, ',' order by rank) from rfq_recipients where round_id = '${r.roundId}'`).split(",");
    mail.sent = [];
    expect(await store.remindRecipient(db as never, actor(), kal)).toEqual({ ok: true });
    expect(mail.sent[0].subject).toBe(`Připomenutí: Poptávka ${r.number}`);
    expect(localSql(`select reminder_count from rfq_recipients where id = '${kal}'`)).toBe("1");
    expect(await store.declineRecipient(db as never, actor(), hru, "nemá kapacitu")).toEqual({ ok: true });
    expect(localSql(`select status || '|' || coalesce(decline_note, '') from rfq_recipients where id = '${hru}'`)).toBe("odmitl|nemá kapacitu");
    expect(localSql(`select count(*) from supplier_quotes where rfq_recipient_id = '${hru}'`)).toBe("0");

    mail.fail = true;
    const f = await store.createAndSendRound(db as never, actor(), baseInput({ skipPending: true, recipients: [{ supplierId: sups[2].id, emails: [sups[2].email] }] }));
    mail.fail = false;
    if ("error" in f) throw new Error(f.error);
    expect(f.failed).toHaveLength(1);
    const rec = localSql(`select id || '|' || status || '|' || (outbox_id is not null) from rfq_recipients where round_id = '${f.roundId}'`).split("|");
    expect(rec.slice(1)).toEqual(["chyba", "true"]);
    expect(localSql(`select status || '|' || jsonb_array_length(payload->'attachments') from mail_outbox where id = (select outbox_id from rfq_recipients where id = '${rec[0]}')`)).toBe("failed|2");
    mail.sent = [];
    expect(await store.retryRecipient(db as never, actor(), rec[0])).toEqual({ ok: true });
    expect(mail.sent[0].to).toBe(sups[2].email);
    expect((mail.sent[0].attachments ?? []).map((a) => a.filename)).toEqual([`Poptavka-${f.number}.pdf`, `VK-${TAG}-1_A.pdf`]);
    expect(localSql(`select status from rfq_recipients where id = '${rec[0]}'`)).toBe("odeslano");
  });

  it("pojistky: adresa zákazníka, stejná adresa u dvou dodavatelů, operace bez druhu", async () => {
    expect(await store.previewRfq(db as never, actor(), baseInput({ recipients: [{ supplierId: sups[0].id, emails: [`nakup@strojmetal-${TAG.toLowerCase()}.test`] }] })))
      .toMatchObject({ error: expect.stringContaining("adresa zákazníka") });
    expect(await store.previewRfq(db as never, actor(), baseInput({ recipients: [{ supplierId: sups[0].id, emails: ["x@dod.test"] }, { supplierId: sups[1].id, emails: ["x@dod.test"] }] })))
      .toMatchObject({ error: expect.stringContaining("u dvou dodavatelů") });
    expect(await store.previewRfq(db as never, actor(), baseInput({ scope: "operace", operationKinds: [] })))
      .toMatchObject({ error: expect.stringContaining("operaci") });
  });

  it("kvalita z historie a RLS: zaměstnanec bez příznaku kola nevidí, s příznakem ano, sám si ho nezapne", async () => {
    const q = await store.loadQuality(db, sups.map((s) => s.id));
    expect(q.map((x) => x.supplierId).sort()).toEqual(sups.map((s) => s.id).sort());
    const before = localSql(`select can_rfq from profiles where id = '${workerId}'`);
    try {
      localSql(`update profiles set can_rfq = false where id = '${workerId}'`);
      const worker = await localSession("dilna@local.test", "Dilna123!");
      const { data: none } = await worker.from("rfq_rounds").select("id").eq("job_id", jobId);
      expect(none ?? []).toHaveLength(0);
      const { error: selfErr } = await worker.from("profiles").update({ can_rfq: true }).eq("id", workerId);
      expect(selfErr?.message ?? localSql(`select can_rfq from profiles where id = '${workerId}'`)).toMatch(/super admin|^f$/);
      localSql(`update profiles set can_rfq = true where id = '${workerId}'`);
      const { data: some } = await worker.from("rfq_rounds").select("id").eq("job_id", jobId);
      expect((some ?? []).length).toBeGreaterThan(0);
      const { error: insErr } = await worker.from("rfq_rounds").insert({ job_id: jobId, number: `PD-${TAG}` });
      expect(insErr).not.toBeNull();
    } finally {
      localSql(`update profiles set can_rfq = ${before === "t"} where id = '${workerId}'`);
    }
  });
});
