import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_ENABLED, loadLocalEnv, localAdmin, localSql } from "@/test/local-supabase";

/**
 * Objednávka dodavateli — odchylky od výkresu a přílohy e-mailu ↔ lokální Supabase (majitel 2. 11.):
 *  - pokyn zákazníka z e-mailu (materiál, tolerance — přebíjí výkres) + nová revize výkresu → PDF objednávky
 *    („Odchylka od výkresu — platí místo výkresu") i text e-mailu,
 *  - e-mail nese PDF + aktuální výkres položky (anonymizovaná kopie, neutrální název) + 3D model (originál);
 *    výkres jiné položky ani starší revize ne; nic o zákazníkovi (jméno, IČO, číslo objednávky),
 *  - výkres, který se ještě anonymizuje → fronta odeslání, po dokončení odejde se stejnými přílohami,
 *  - změna po „Aktualizaci výkresu" → nová revize v příloze, „revize C je nahrazena a neplatí".
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/jobs/po-deviations.integration.test.ts
 */

type Sent = { to: string; subject: string; text: string; attachments?: { filename: string; content: Buffer; contentType?: string }[] };
const mail = vi.hoisted(() => ({ sent: [] as Sent[] }));

vi.mock("@/lib/email/send", () => ({
  sendMail: vi.fn(async (a: Sent) => {
    mail.sent.push(a);
    return { sent: true, emailId: undefined, messageId: `<podev-${mail.sent.length}@test>` };
  }),
  senderSignatureText: vi.fn(async () => "S pozdravem\nSuper Admin\nMnástrojárna s.r.o."),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const TAG = `PODEV${Date.now().toString(36).toUpperCase()}`;
const CUSTOMER = `Kovolis Hranice ${Date.now() % 1_000_000} s.r.o.`;
const ICO = String(10_000_000 + Math.floor(Math.random() * 80_000_000));
const CPO = `OBJ-${TAG}-55`;
const DN1 = `PD-${TAG}-1`;
const DN2 = `PD-${TAG}-2`;

describe.skipIf(!LOCAL_ENABLED)("objednávka dodavateli: odchylky od výkresu a přílohy ↔ lokální Supabase", () => {
  let db: SupabaseClient;
  let docs: typeof import("./purchase-order-docs");
  let data: typeof import("@/lib/data/purchasing");
  let adminId: string;
  let jobId: string;
  let itemA: string;
  let itemB: string;
  let supId: string;
  let fileA: string;
  let fileOld: string;
  let fileModel: string;
  let fileB: string;
  let po1: string;
  let po2: string;
  const paths: string[] = [];
  const anonA = Buffer.from(`%PDF-1.4\n% anon A ${TAG}\n`);
  const anonB = Buffer.from(`%PDF-1.4\n% anon B ${TAG}\n`);
  const stepBytes = Buffer.from(`ISO-10303-21;\nHEADER;\n/* ${TAG} */\nENDSEC;\nEND-ISO-10303-21;\n`);
  const author = () => ({ id: adminId, fullName: "Super Admin" });

  async function upload(p: string, buf: Buffer, type: string) {
    paths.push(p);
    const { error } = await db.storage.from("job-files").upload(p, buf, { contentType: type, upsert: true });
    if (error) throw new Error(error.message);
  }

  /** Výkres s hotovou anonymizovanou kopií (původní název nese jméno zákazníka). */
  async function drawing(itemId: string, label: string, anon: Buffer, extra = ""): Promise<string> {
    const id = randomUUID();
    const p = `zakazky/${jobId}/${id}-${CUSTOMER.replace(/\s/g, "_")}_${label}.pdf`;
    const a = `zakazky/${jobId}/anon/${id}.pdf`;
    await upload(p, Buffer.from(`%PDF-1.4\n% original ${CUSTOMER}\n`), "application/pdf");
    await upload(a, anon, "application/pdf");
    const sha = createHash("sha256").update(anon).digest("hex");
    return localSql(`insert into job_files (job_id, kind, title, filename, mime_type, storage_path, order_item_id, anon_status, anon_path, anon_filename, anon_mime, anon_sha256, anon_size, size_bytes${extra ? ", archived" : ""})
      values ('${jobId}', 'vykres', 'Výkres', '${CUSTOMER} ${label}.pdf', 'application/pdf', '${p}', '${itemId}', 'done', '${a}', '${label}.pdf', 'application/pdf', '${sha}', ${anon.length}, 100${extra ? ", true" : ""}) returning id`).split("\n")[0];
  }

  function pdfText(buf: Buffer): string {
    const tmp = path.join(os.tmpdir(), `podev-${randomUUID()}.pdf`);
    writeFileSync(tmp, buf);
    try {
      return execFileSync("pdftotext", ["-layout", tmp, "-"]).toString();
    } finally {
      rmSync(tmp, { force: true });
    }
  }

  async function storedPdf(poId: string): Promise<Buffer> {
    const fid = localSql(`select file_id from purchase_orders where id = '${poId}'`);
    const p = localSql(`select storage_path from job_files where id = '${fid}'`);
    const { data: blob } = await db.storage.from("job-files").download(p);
    return Buffer.from(await blob!.arrayBuffer());
  }

  function noCustomer(texts: string[]) {
    const all = texts.join("\n");
    expect(all).not.toContain(CUSTOMER.split(" ")[0]);
    expect(all).not.toContain(ICO);
    expect(all).not.toContain(CPO);
  }

  beforeAll(async () => {
    const env = loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    db = localAdmin();
    docs = await import("./purchase-order-docs");
    data = await import("@/lib/data/purchasing");
    adminId = localSql("select id from profiles where email = 'admin@local.test'");
    const cust = localSql(`insert into customers (name, ico, country, email) values ('${CUSTOMER}', '${ICO}', 'CZ', 'nakup@kovolis-${TAG.toLowerCase()}.test') returning id`).split("\n")[0];
    jobId = localSql(`insert into orders (number, title, status, source, owner_id, created_by, customer_id, customer_order_number, due_date)
      values ('Z-${TAG}', 'Příruby', 've_vyrobe', 'manual', '${adminId}', '${adminId}', '${cust}', '${CPO}', app_today() + 30) returning id`).split("\n")[0];
    itemA = localSql(`insert into order_items (order_id, position, drawing_number, revision, name, material, quantity, unit)
      values ('${jobId}', 0, '${DN1}', 'B', 'Příruba', '1.4301', 20, 'ks') returning id`).split("\n")[0];
    itemB = localSql(`insert into order_items (order_id, position, drawing_number, revision, name, material, quantity, unit)
      values ('${jobId}', 1, '${DN2}', 'A', 'Pouzdro', 'C45', 10, 'ks') returning id`).split("\n")[0];
    supId = localSql(`insert into suppliers (name, email) values ('Kooperant ${TAG}', 'kooperant-${TAG.toLowerCase()}@dod.test') returning id`).split("\n")[0];

    // výkres A: stará revize (nahrazená) + aktuální; 3D model A (originál STEP); výkres B (jiná položka)
    fileOld = await drawing(itemA, `${DN1}_B`, Buffer.from(`%PDF-1.4\n% anon old ${TAG}\n`), "archived");
    fileA = await drawing(itemA, `${DN1}_C`, anonA);
    localSql(`update job_files set replaced_by = '${fileA}' where id = '${fileOld}'`);
    {
      const id = randomUUID();
      const p = `zakazky/${jobId}/${id}-${CUSTOMER.replace(/\s/g, "_")}_model.step`;
      await upload(p, stepBytes, "application/octet-stream");
      fileModel = localSql(`insert into job_files (job_id, kind, title, filename, mime_type, storage_path, order_item_id, size_bytes)
        values ('${jobId}', 'model_3d', '3D model', '${CUSTOMER} model.step', 'application/octet-stream', '${p}', '${itemA}', ${stepBytes.length}) returning id`).split("\n")[0];
    }
    fileB = await drawing(itemB, DN2, anonB);

    // nová revize výkresu A (B → C, trigger zapíše změnu) + pokyny zákazníka z e-mailu nadřazené výkresu
    localSql(`update order_items set revision = 'C' where id = '${itemA}'`);
    localSql(`update job_drawing_changes set old_file_id = '${fileOld}', file_id = '${fileA}' where order_item_id = '${itemA}'`);
    localSql(`insert into job_mail_changes (job_id, order_item_id, kind, field, summary, value_new, value_prev, drawing_value, status, party)
      values ('${jobId}', '${itemA}', 'change', 'material', 'Materiál: 1.4301', '1.4301', '11 523', '11 523', 'applied', 'customer'),
             ('${jobId}', '${itemA}', 'change', 'tolerance', 'Tolerance', 'Pokyn z e-mailu 1. 11.: díra Ø12 H7 místo H8 dle dohody s ${CUSTOMER}', '—', null, 'applied', 'customer'),
             ('${jobId}', '${itemA}', 'change', 'surface', 'Povrch', 'zinek', '—', null, 'suggested', 'customer')`);

    // objednávka 1: jen položka A (vystavená); objednávka 2: jen položka B
    po1 = localSql(`insert into purchase_orders (job_id, supplier_id, status, number, order_date, required_date, currency, total, created_by)
      values ('${jobId}', '${supId}', 'vystavena', 'OV-${TAG}-1', app_today(), app_today() + 14, 'CZK', 0, '${adminId}') returning id`).split("\n")[0];
    localSql(`insert into purchase_order_items (purchase_order_id, position, drawing_number, name, material, quantity, unit, order_item_id)
      values ('${po1}', 0, '${DN1}', 'Příruba', '1.4301', 20, 'ks', '${itemA}')`);
    po2 = localSql(`insert into purchase_orders (job_id, supplier_id, status, number, order_date, required_date, currency, total, created_by)
      values ('${jobId}', '${supId}', 'vystavena', 'OV-${TAG}-2', app_today(), app_today() + 14, 'CZK', 0, '${adminId}') returning id`).split("\n")[0];
    // bez vazby order_item_id — díl se dohledá podle čísla výkresu
    localSql(`insert into purchase_order_items (purchase_order_id, position, drawing_number, name, quantity, unit)
      values ('${po2}', 0, '${DN2}', 'Pouzdro', 10, 'ks')`);
  }, 60_000);

  afterAll(async () => {
    if (!db || !jobId) return;
    localSql(`delete from anon_send_queue where job_id = '${jobId}'`);
    localSql(`delete from purchase_orders where job_id = '${jobId}'`);
    const files = localSql(`select storage_path from job_files where job_id = '${jobId}' and storage_path is not null`).split("\n").filter(Boolean);
    await db.storage.from("job-files").remove([...paths, ...files]).catch(() => undefined);
    localSql(`update job_files set replaced_by = null where job_id = '${jobId}'`);
    localSql(`delete from job_files where job_id = '${jobId}'`);
    localSql(`delete from orders where id = '${jobId}'`);
    localSql(`delete from suppliers where id = '${supId}'`);
    localSql(`delete from customers where name = '${CUSTOMER}'`);
    localSql(`delete from audit_log where diff->>'jobId' = '${jobId}'`);
  }, 60_000);

  it("PDF objednávky: odchylky od výkresu pod položkou (pokyn z e-mailu, nová revize), bez zákazníka", async () => {
    const po = (await data.fetchPurchaseOrder(db as never, po1))!;
    const stored = await docs.storePurchaseOrderPdfCore(db as never, author(), po);
    expect("fileId" in stored, JSON.stringify(stored)).toBe(true);
    const text = pdfText(await storedPdf(po1)).replace(/\s+/g, " ");
    expect(text).toContain("Odchylka od výkresu — platí místo výkresu");
    expect(text).toContain("Platí revize výkresu C (nahrazuje rev. B)");
    expect(text).toContain("Materiál: 1.4301 (na výkresu: 11 523)");
    expect(text).toContain("Tolerance: díra Ø12 H7 místo H8");
    expect(text).toContain("Odchylky od výkresu uvedené u položek mají přednost před výkresem.");
    expect(text).not.toContain("zinek"); // jen návrh, nepropsáno
    noCustomer([text]);
  }, 60_000);

  it("e-mail: souhrn odchylek + PDF, aktuální výkres (anonymizovaný) a 3D model položky — nic cizího, nic o zákazníkovi", async () => {
    const po = (await data.fetchPurchaseOrder(db as never, po1))!;
    const m = await docs.purchaseOrderMailFor(db as never, po, adminId, "issue");
    expect(m.to).toBe(`kooperant-${TAG.toLowerCase()}@dod.test`);
    expect(m.body).toContain(`– ${DN1}: Platí revize výkresu C (nahrazuje rev. B); Materiál: 1.4301 (na výkresu: 11 523); Tolerance: díra Ø12 H7 místo H8`);
    expect(m.body).toContain("V příloze dále zasíláme výkresy a 3D modely k objednaným položkám.");
    expect(m.body).not.toContain("pošleme samostatně");
    const plan = m.extras.attachments!.plan;
    expect(plan.candidates.map((c) => [c.fileId, c.role, c.name, c.checked])).toEqual([
      [fileA, "drawing", `${DN1}_C.pdf`, true],
      [fileModel, "model", `${DN1}_C.step`, true],
      [fileOld, "old", `${DN1}_B-neplatna.pdf`, false],
    ]);

    mail.sent.length = 0;
    const res = await docs.sendPurchaseOrderCore(db as never, author(), po1, m, { from: { ownerId: adminId } });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(mail.sent).toHaveLength(1);
    const sent = mail.sent[0];
    const names = (sent.attachments ?? []).map((a) => a.filename);
    expect(names).toEqual([`Objednavka_OV-${TAG}-1.pdf`, `${DN1}_C.pdf`, `${DN1}_C.step`]);
    expect(sent.attachments![1].content.equals(anonA)).toBe(true); // anonymizovaná kopie, ne originál
    expect(sent.attachments![2].content.equals(stepBytes)).toBe(true); // 3D model jako originál
    expect(names.some((n) => n.includes(DN2))).toBe(false);
    noCustomer([sent.subject, sent.text, ...names]);
    expect(localSql(`select status from purchase_orders where id = '${po1}'`)).toBe("odeslana");
    const ev = localSql(`select data->>'drawingFileIds' from job_events where entity_id = '${po1}' and data->>'mailKind' = 'issue' order by created_at desc limit 1`);
    expect(ev).toContain(fileA);
  }, 60_000);

  it("výkres se ještě anonymizuje → fronta odeslání; po dokončení odejde s neutrálním názvem (díl podle čísla výkresu)", async () => {
    localSql(`update job_files set anon_status = 'pending' where id = '${fileB}'`);
    const po = (await data.fetchPurchaseOrder(db as never, po2))!;
    const m = await docs.purchaseOrderMailFor(db as never, po, adminId, "issue");
    expect(m.extras.attachments!.plan.candidates.map((c) => [c.fileId, c.status, c.checked])).toEqual([[fileB, "pending", true]]);
    mail.sent.length = 0;
    const res = await docs.sendPurchaseOrderCore(db as never, author(), po2, m, { from: { ownerId: adminId } });
    expect(res).toMatchObject({ ok: true, queued: true });
    expect(mail.sent).toHaveLength(0);
    const q = localSql(`select kind || '|' || array_to_string(file_ids, ',') || '|' || (payload->>'purchaseOrderId') from anon_send_queue where id = '${(res as { queueId: string }).queueId}'`);
    expect(q).toBe(`purchase_order|${fileB}|${po2}`);

    localSql(`update job_files set anon_status = 'done' where id = '${fileB}'`);
    const { flushSendQueue } = await import("@/lib/anonymize/send-queue");
    const got: { attachments: { filename: string; content: Buffer }[]; subject: string; text: string }[] = [];
    const out = await flushSendQueue(db as never, {
      ids: [(res as { queueId: string }).queueId],
      sender: async (a) => { got.push(a); return { sent: true }; },
    });
    expect(out.sent).toBe(1);
    expect(got[0].attachments.map((a) => a.filename).sort()).toEqual([`${DN2}_A.pdf`, `Objednavka_OV-${TAG}-2.pdf`].sort());
    expect(got[0].attachments.find((a) => a.filename === `${DN2}_A.pdf`)!.content.equals(anonB)).toBe(true);
    noCustomer([got[0].subject, got[0].text]);
    expect(localSql(`select status from purchase_orders where id = '${po2}'`)).toBe("odeslana");
  }, 60_000);

  it("změna po nové revizi výkresu: nový výkres v příloze, stará revize nahrazena (text e-mailu i PDF)", async () => {
    localSql(`update purchase_orders set sent_at = now() - interval '1 hour' where id = '${po1}'`);
    const fileD = await drawing(itemA, `${DN1}_D`, Buffer.from(`%PDF-1.4\n% anon D ${TAG}\n`));
    localSql(`update job_files set archived = true, replaced_by = '${fileD}' where id = '${fileA}'`);
    localSql(`update order_items set revision = 'D' where id = '${itemA}'`);
    localSql(`update job_drawing_changes set old_file_id = '${fileA}', file_id = '${fileD}' where order_item_id = '${itemA}' and rev_to = 'D'`);
    localSql(`update purchase_orders set revision = 2 where id = '${po1}'`);
    const po = (await data.fetchPurchaseOrder(db as never, po1))!;
    await docs.storePurchaseOrderPdfCore(db as never, author(), po, { replaceFileId: po.fileId });
    const text = pdfText(await storedPdf(po1)).replace(/\s+/g, " ");
    expect(text).toContain("Platí revize výkresu D (nahrazuje rev. C)");
    expect(text.toUpperCase()).toContain("ZMĚNA Č. 2");

    const m = await docs.purchaseOrderMailFor(db as never, { ...po, revision: 2 }, adminId, "change", { reason: "nová revize výkresu" });
    expect(m.subject).toContain("Změna objednávky");
    expect(m.body).toContain(`Výkres ${DN1}: platí nová revize D — revize C je nahrazena a neplatí.`);
    const plan = m.extras.attachments!.plan;
    expect(plan.candidates.filter((c) => c.checked).map((c) => c.name)).toEqual([`${DN1}_D.pdf`, `${DN1}_D.step`]);
    expect(plan.candidates.find((c) => c.fileId === fileA)).toMatchObject({ role: "old", name: `${DN1}_C-neplatna.pdf`, checked: false });

    mail.sent.length = 0;
    const res = await docs.sendPurchaseOrderCore(db as never, author(), po1, m, { from: { ownerId: adminId }, kind: "change" });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const names = (mail.sent[0].attachments ?? []).map((a) => a.filename);
    expect(names).toEqual([`Objednavka_OV-${TAG}-1.pdf`, `${DN1}_D.pdf`, `${DN1}_D.step`]);
    noCustomer([mail.sent[0].subject, mail.sent[0].text, ...names]);
  }, 60_000);

  it("výběr z dialogu: jen soubory položek objednávky (cizí výkres neprojde), bez výkresů = jen PDF", async () => {
    const po = (await data.fetchPurchaseOrder(db as never, po1))!;
    const m = await docs.purchaseOrderMailFor(db as never, po, adminId, "change");
    mail.sent.length = 0;
    const r1 = await docs.sendPurchaseOrderCore(db as never, author(), po1, m, { from: { ownerId: adminId }, kind: "change", attachmentIds: [fileB, fileOld] });
    expect(r1.ok).toBe(true);
    expect(mail.sent[0].attachments!.map((a) => a.filename)).toEqual([`Objednavka_OV-${TAG}-1.pdf`, `${DN1}_B-neplatna.pdf`]);
    mail.sent.length = 0;
    await docs.sendPurchaseOrderCore(db as never, author(), po1, m, { from: { ownerId: adminId }, kind: "change", attachmentIds: false });
    expect(mail.sent[0].attachments!.map((a) => a.filename)).toEqual([`Objednavka_OV-${TAG}-1.pdf`]);
  }, 60_000);
});
