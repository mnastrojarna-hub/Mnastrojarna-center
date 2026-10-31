import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DEMO, localSession, localSql } from "@/test/local-supabase";

/**
 * „Zanést fakturu" + Platební plán (31. 10.) proti lokálnímu Supabase (AI_FAKE_CAPTURE, batch/sinv-g36 / g37):
 *  zaměstnanec zanese PDF → AI přečte, založí dodavatele, zapíše fakturu, potvrzení s hlavičkou (bez id),
 *  super admin dostane řádek do fronty; stejný soubor = „už je zapsaná (kdy, kdo)"; ZIP / dva soubory odmítne;
 *  nabídka = „není faktura" → Přesto zapsat; chyba AI = uloženo, údaje doplní účetní; příloha e-mailu (Pošta);
 *  platební plán: jen super admin (akce, trigger, REST), přidat / upravit / zaplaceno (+ nabídka zaplacení
 *  faktury) / smazat (audit), přehled po dnech a nápověda nezaplacených faktur.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/supplier-invoices/record-plan.integration.test.ts
 */

const ENABLED = process.env.LOCAL_SUPABASE === "1";
const FIXTURES = path.resolve(process.cwd(), "src/lib/jobs/__fixtures__/capture");
const ICO = "27999936";

function loadEnv(): Record<string, string> {
  const file = path.resolve(process.cwd(), ".local-supabase/env");
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const h = vi.hoisted(() => ({ user: null as Record<string, unknown> | null, aiFails: false }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/ai/supplier-invoice-reader", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/supplier-invoice-reader")>("@/lib/ai/supplier-invoice-reader");
  return {
    ...actual,
    readSupplierInvoice: async (input: Parameters<typeof actual.readSupplierInvoice>[0]) => {
      if (h.aiFails) throw new Error("AI je přetížené (test).");
      return actual.readSupplierInvoice(input);
    },
  };
});
vi.mock("@/lib/supabase/server", async () => {
  const fs = await import("node:fs");
  const p = await import("node:path");
  const sb = await import("@supabase/supabase-js");
  const env: Record<string, string> = {};
  const file = p.resolve(process.cwd(), ".local-supabase/env");
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m) env[m[1]] = m[2];
    }
  }
  const headers = await import("@/lib/supabase/actor-headers");
  const admin = (opts: { actor?: unknown } = {}) => sb.createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(opts.actor ? { global: { headers: headers.actorHeaders(opts.actor as never) } } : {}),
  });
  return {
    isSupabaseConfigured: () => true,
    hasServiceKey: () => true,
    createAdminClient: admin,
    createOperatorClient: async (opts: { actor?: unknown } = {}) => admin(opts.actor ? opts : { actor: { id: (h.user as { id?: string } | null)?.id ?? null, kind: "user", via: "rucne" } }),
    createClient: async () => { throw new Error("Bez session (test)."); },
  };
});
vi.mock("@/lib/auth/session", async () => {
  const perms = await import("@/lib/auth/permissions");
  const ctx = () => ({ aiEnabled: true, aiCaptureForAll: true, aiConfigured: true, supplierInvoicesForAll: false });
  const access = () => ({
    user: h.user, ctx: ctx(), features: perms.allowedFeatures(h.user as never, ctx()),
    can: (f: string) => perms.can(h.user as never, f as never, ctx()),
  });
  return {
    getSessionUser: async () => h.user,
    getAccess: async () => access(),
    getAccessContext: async () => ctx(),
    checkFeature: async (f: string) => (perms.can(h.user as never, f as never, ctx()) ? { user: h.user } : { error: "K této akci nemáš oprávnění." }),
    requireUser: async () => h.user,
    requireFeature: async () => h.user,
  };
});

function person(id: string, email: string, role: string, fullName: string) {
  return { id, email, fullName, role, initials: "TT", roleLabel: role, aiAccess: false, active: true, hasProfile: true, mustChangePassword: false };
}

const pdf = (seed: string) => Buffer.from(`%PDF-1.4\n% ${seed}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`);

describe.skipIf(!ENABLED)("Zanést fakturu + Platební plán ↔ lokální Supabase", () => {
  let db: SupabaseClient;
  let s: typeof import("@/lib/jobs/capture-service");
  let up: typeof import("./upload");
  let mail: typeof import("./record-email");
  let plan: typeof import("@/app/actions/payment-plan");
  let admin: ReturnType<typeof person>;
  let sales: ReturnType<typeof person>;
  let worker: ReturnType<typeof person>;
  const RUN = Date.now().toString(36);
  let invoiceId = "";
  let emailId = "";
  const planIds = new Set<string>();

  async function upload(filename: string, body: Buffer, mimeType = "application/pdf") {
    const prep = await s.prepareCaptureUpload({ filename, size: body.length, mimeType });
    if (!prep.ok) throw new Error(prep.error);
    const { error } = await db.storage.from("job-files").uploadToSignedUrl(prep.path!, prep.token!, body, { contentType: mimeType });
    expect(error).toBeNull();
    return { path: prep.path!, filename, mimeType, size: body.length };
  }

  async function cleanup() {
    const ids = localSql(`select coalesce(string_agg(id::text, ','), '') from supplier_invoices where supplier_key = '${ICO}' or number like 'E2E-REC-%'`).split(",").filter(Boolean);
    if (ids.length) {
      const { data: f } = await db.from("supplier_invoice_files").select("storage_path").in("invoice_id", ids);
      const paths = ((f ?? []) as { storage_path: string }[]).map((x) => x.storage_path);
      if (paths.length) await db.storage.from("supplier-invoices").remove(paths);
      localSql(`delete from supplier_payment_plan where invoice_id in (${ids.map((x) => `'${x}'`).join(",")})`);
      localSql(`delete from approval_queue where type::text = 'supplier_invoice' and payload->>'invoiceId' in (${ids.map((x) => `'${x}'`).join(",")})`);
      await db.from("supplier_invoices").delete().in("id", ids).not("duplicate_of_id", "is", null);
      await db.from("supplier_invoices").delete().in("id", ids);
    }
    localSql(`delete from supplier_payment_plan where payee like 'E2E-REC %'`);
    localSql(`delete from suppliers where ico = '${ICO}'`);
    const mails = localSql(`select coalesce(string_agg(id::text, ','), '') from emails where subject like 'E2E-REC faktura%'`).split(",").filter(Boolean);
    if (mails.length) {
      const { data: a } = await db.from("email_attachments").select("storage_path").in("email_id", mails);
      const paths = ((a ?? []) as { storage_path: string | null }[]).map((x) => x.storage_path).filter((x): x is string => Boolean(x));
      if (paths.length) await db.storage.from("documents").remove(paths);
      await db.from("emails").delete().in("id", mails);
    }
  }

  beforeAll(async () => {
    const env = loadEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    process.env.AI_FAKE_CAPTURE = path.join(FIXTURES, "objednavka-strojmetal.json");
    db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
    const { data: profiles } = await db.from("profiles").select("id, email, full_name, role");
    const by = (email: string) => (profiles ?? []).find((p) => p.email === email)!;
    admin = person(by(DEMO.admin.email).id, DEMO.admin.email, "super_admin", "Admin");
    sales = person(by(DEMO.sales.email).id, DEMO.sales.email, "obchodnik", "Obchod");
    worker = person(by(DEMO.worker.email).id, DEMO.worker.email, "zamestnanec", "Dílna");
    localSql(`update automation_settings set mode = 'approval' where module = 'supplier_invoice'`);
    await cleanup();
    s = await import("@/lib/jobs/capture-service");
    up = await import("./upload");
    mail = await import("./record-email");
    plan = await import("@/app/actions/payment-plan");
  }, 60_000);

  afterAll(async () => {
    if (!ENABLED || !db) return;
    await cleanup();
  }, 60_000);

  it("zaměstnanec zanese PDF: AI přečte vše, založí dodavatele, zapíše; potvrzení s hlavičkou bez id; super admin ve frontě", async () => {
    h.user = worker;
    const file = await upload(`faktura-${RUN}__faktura_dodavatel-g36.pdf`, pdf(`a-${RUN}`));
    const res = await up.uploadSupplierInvoice({ files: [file] });
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    if (!res.ok) return;
    expect(res).toMatchObject({
      kind: "recorded", aiFilled: true,
      head: { supplierName: "E2E Soustružna Integrace s.r.o.", number: "FV-36-001", amount: 2420, currency: "CZK", dueDate: "2026-11-10", documentType: "faktura" },
    });
    expect("id" in res).toBe(false);
    expect(res.message).toMatch(/^Faktura zapsána ✓ — E2E Soustružna Integrace s\.r\.o\., č\. FV-36-001, částka 2\s420\sKč, splatnost 10\. 11\. 2026$/);
    const row = localSql(`select si.id || '|' || si.status || '|' || si.source || '|' || si.uploaded_by || '|' || coalesce(si.variable_symbol, '') || '|' || si.total_vat
      || '|' || coalesce(s.ico, '') || '|' || coalesce(si.ai_extracted->'vatBreakdown'->0->>'rate', '') from supplier_invoices si left join suppliers s on s.id = si.supplier_id where si.supplier_key = '${ICO}'`);
    const [id, status, source, by, vs, vat, supIco, rate] = row.split("|");
    invoiceId = id;
    expect([status, source, by, vs, vat, supIco, rate]).toEqual(["ke_kontrole", "upload", worker.id, "36001", "420.00", ICO, "21"]);
    expect(localSql(`select count(*) from supplier_invoice_items where invoice_id = '${id}'`)).toBe("1");
    expect(localSql(`select count(*) from approval_queue where type::text = 'supplier_invoice' and status = 'pending' and payload->>'invoiceId' = '${id}'`)).toBe("1");
    expect(localSql(`select count(*) from audit_log where action = 'supplier_invoice_recorded' and entity_id = '${id}'`)).toBe("1");
    // stránka v capture/ smazaná
    const { data: left } = await db.storage.from("job-files").list(file.path.slice(0, file.path.lastIndexOf("/")), { search: file.path.split("/").pop() });
    expect((left ?? []).length).toBe(0);
  }, 60_000);

  it("stejný soubor znovu = „už je zapsaná (kdy, kdo)“; super admin dostane i odkaz", async () => {
    h.user = admin;
    const res = await up.uploadSupplierInvoice({ files: [await upload(`znovu-${RUN}__faktura_dodavatel-g36.pdf`, pdf(`a-${RUN}`))] });
    expect(res).toMatchObject({ ok: true, kind: "duplicate", id: invoiceId, recordedBy: expect.any(String) });
    if (res.ok) expect(res.message).toMatch(/^Tahle faktura už je zapsaná \(\d{1,2}\. \d{1,2}\. \d{4}, .+\)\.$/);
    expect(localSql(`select count(*) from supplier_invoices where supplier_key = '${ICO}'`)).toBe("1");
  }, 60_000);

  it("ZIP / Word odmítne česky, dva soubory najednou ne", async () => {
    h.user = worker;
    const zip = await upload(`faktury-${RUN}.zip`, Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8]), "application/zip");
    const r1 = await up.uploadSupplierInvoice({ files: [zip] });
    expect(r1).toEqual({ ok: false, error: expect.stringMatching(/není faktura v PDF ani obrázek/) });
    const a = await upload(`a-${RUN}.pdf`, pdf(`x-${RUN}`));
    const b = await upload(`b-${RUN}.pdf`, pdf(`y-${RUN}`));
    expect(await up.uploadSupplierInvoice({ files: [a, b] })).toEqual({ ok: false, error: expect.stringMatching(/jen jednu fakturu/) });
  }, 60_000);

  it("nabídka = „tohle není faktura“ (nic se nezapíše); Přesto zapsat → zapsaná s poznámkou", async () => {
    h.user = worker;
    const file = await upload(`nabidka-${RUN}__faktura_dodavatel-g37.pdf`, pdf(`n-${RUN}`));
    const res = await up.uploadSupplierInvoice({ files: [file] });
    expect(res).toMatchObject({ ok: true, kind: "not_invoice", documentType: "nabidka", label: "nabídka" });
    expect(localSql(`select count(*) from supplier_invoices where number = 'NAB-36-9'`)).toBe("0");
    // soubor čeká v capture/ na rozhodnutí
    const forced = await up.uploadSupplierInvoice({ files: [file], force: true });
    expect(forced).toMatchObject({ ok: true, kind: "recorded", head: { number: "NAB-36-9", documentType: "nabidka" } });
    expect(localSql(`select note from supplier_invoices where number = 'NAB-36-9'`)).toMatch(/vypadá jako nabídka — zapsáno jako faktura/);
  }, 60_000);

  it("AI selže → doklad uložený, „údaje doplní účetní“, super admin ho má ke kontrole s chybou", async () => {
    h.user = worker;
    h.aiFails = true;
    try {
      const res = await up.uploadSupplierInvoice({ files: [await upload(`bez-ai-${RUN}.pdf`, pdf(`noai-${RUN}`))] });
      expect(res).toMatchObject({ ok: true, kind: "recorded", aiFilled: false, message: "Faktura zapsána ✓ — údaje doplní účetní." });
      const sha = (await import("node:crypto")).createHash("sha256").update(pdf(`noai-${RUN}`)).digest("hex");
      const row = localSql(`select id || '|' || status || '|' || coalesce(ai_error, '') from supplier_invoices where uploaded_by = '${worker.id}' and content_sha256 = '${sha}'`);
      const [id, status, aiErr] = row.split("|");
      expect(status).toBe("ke_kontrole");
      expect(aiErr).toMatch(/AI fakturu nezpracovala/);
      localSql(`update supplier_invoices set number = 'E2E-REC-noai' where id = '${id}'`);
    } finally {
      h.aiFails = false;
    }
  }, 60_000);

  it("Pošta: příloha e-mailu předvybraná (PDF před logem) a zapsaná; podruhé duplicita; cizí e-mail ne", async () => {
    h.user = sales;
    const path1 = `e2e-rec/${RUN}/faktura.pdf`;
    const body = pdf(`mail-${RUN}`);
    expect((await db.storage.from("documents").upload(path1, body, { contentType: "application/pdf" })).error).toBeNull();
    const { data: em } = await db.from("emails").insert({
      owner_id: sales.id, direction: "in", subject: `E2E-REC faktura ${RUN}`, from_email: "fakturace@e2e-27999936.cz", category: "faktura",
      received_at: new Date().toISOString(),
    }).select("id").single();
    emailId = (em as { id: string }).id;
    const { data: atts } = await db.from("email_attachments").insert([
      { email_id: emailId, filename: "logo.png", mime_type: "image/png", size_bytes: 2000, storage_path: `e2e-rec/${RUN}/logo.png` },
      { email_id: emailId, filename: `faktura__faktura_dodavatel-g36.pdf`, mime_type: "application/pdf", size_bytes: body.length, storage_path: path1 },
    ]).select("id, filename");
    const pdfAtt = ((atts ?? []) as { id: string; filename: string }[]).find((a) => a.filename.endsWith(".pdf"))!;
    const src = (await mail.emailInvoiceSource(emailId))!;
    expect(src.preselectedId).toBe(pdfAtt.id);
    expect(src.attachments.filter((a) => a.usable).map((a) => a.id)).toEqual([pdfAtt.id]);
    // faktura FV-36-001 už je zapsaná (jiný soubor, stejný dodavatel + číslo) → duplicita, nic nového
    const res = await mail.recordInvoiceFromEmailAttachment({ emailId, attachmentId: pdfAtt.id });
    expect(res).toMatchObject({ ok: true, kind: "duplicate", head: { number: "FV-36-001" } });
    // jiný uživatel e-mail nevidí
    h.user = worker;
    expect(await mail.emailInvoiceSource(emailId)).toBeNull();
    expect(await mail.recordInvoiceFromEmailAttachment({ emailId, attachmentId: pdfAtt.id })).toEqual({ ok: false, error: expect.stringMatching(/E-mail nenalezen|oprávnění/) });
  }, 60_000);

  it("platební plán: jen super admin; přidat, upravit, přehled po dnech, zaplaceno (+ nabídka faktury), vrátit, smazat (audit)", async () => {
    // obchodník / zaměstnanec: nic
    for (const u of [sales, worker]) {
      h.user = u;
      expect(await plan.getPaymentPlan()).toEqual({ ok: false, error: "K této akci nemáš oprávnění." });
      expect((await plan.addPaymentPlanEntry({ payee: "E2E-REC X", amount: "1", dueOn: "2026-11-02" })).ok).toBe(false);
    }
    h.user = admin;
    const today = (await import("@/lib/jobs/mapping")).todayIso();
    const { addDays } = await import("@/lib/supplier-invoices/payment-plan");
    const r1 = await plan.addPaymentPlanEntry({ payee: "E2E-REC Franta Vomáčka", amount: "12 500", dueOn: addDays(today, 2) });
    expect(r1.ok, r1.ok ? "" : r1.error).toBe(true);
    if (!r1.ok) return;
    planIds.add(r1.entry.id);
    expect(r1.entry).toMatchObject({ payee: "E2E-REC Franta Vomáčka", amount: 12500, currency: "CZK", dueOn: addDays(today, 2), paidAt: null, createdByName: expect.any(String) });
    expect(localSql(`select created_by from supplier_payment_plan where id = '${r1.entry.id}'`)).toBe(admin.id);
    expect((await plan.addPaymentPlanEntry({ payee: "", amount: "1", dueOn: today })).ok).toBe(false);
    const r2 = await plan.addPaymentPlanEntry({ payee: "E2E-REC Soustružna", amount: 2420, dueOn: addDays(today, -1), invoiceId, note: "dle faktury" });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    planIds.add(r2.entry.id);
    expect(r2.entry.invoice).toMatchObject({ id: invoiceId, number: "FV-36-001", paymentStatus: "nezaplaceno" });
    // upravit (odložit o den)
    const u = await plan.updatePaymentPlanEntry(r1.entry.id, { payee: "E2E-REC Franta Vomáčka", amount: "12 500", dueOn: addDays(today, 3), note: "hotově" });
    expect(u.ok && u.entry.dueOn === addDays(today, 3) && u.entry.note === "hotově").toBe(true);
    expect(localSql(`select updated_by from supplier_payment_plan where id = '${r1.entry.id}'`)).toBe(admin.id);
    // přehled: nápověda faktur ukazuje fakturu jako „v plánu" (splatnost do 14 dní)
    localSql(`update supplier_invoices set due_date = '${addDays(today, 5)}' where id = '${invoiceId}'`);
    const view = await plan.getPaymentPlan();
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    const mine = view.data.entries.filter((e) => planIds.has(e.id));
    expect(mine.map((e) => e.payee).sort()).toEqual(["E2E-REC Franta Vomáčka", "E2E-REC Soustružna"]);
    expect(view.data.upcomingInvoices.find((i) => i.id === invoiceId)).toMatchObject({ inPlan: true, amount: 2420 });
    expect(view.data.payees).toContain("E2E Soustružna Integrace s.r.o.");
    // zaplaceno: řádek s fakturou nabídne zaplacení faktury (nevnucuje — faktura zůstává nezaplacená)
    const p = await plan.setPaymentPlanPaid(r2.entry.id, true);
    expect(p).toMatchObject({ ok: true, entry: { paidAt: today, paidByName: expect.any(String) }, offerInvoice: { id: invoiceId, number: "FV-36-001" } });
    expect(localSql(`select payment_status from supplier_invoices where id = '${invoiceId}'`)).toBe("nezaplaceno");
    expect(localSql(`select paid_by from supplier_payment_plan where id = '${r2.entry.id}'`)).toBe(admin.id);
    const back = await plan.setPaymentPlanPaid(r2.entry.id, false);
    expect(back.ok && back.entry.paidAt === null && back.offerInvoice === null).toBe(true);
    expect(localSql(`select coalesce(paid_by::text, '-') from supplier_payment_plan where id = '${r2.entry.id}'`)).toBe("-");
    // smazat → audit (trigger)
    expect(await plan.deletePaymentPlanEntry(r1.entry.id)).toEqual({ ok: true });
    planIds.delete(r1.entry.id);
    expect(localSql(`select count(*) from audit_log where action = 'supplier_payment_plan_deleted' and entity_id = '${r1.entry.id}' and actor_id = '${admin.id}'`)).toBe("1");
    expect(localSql(`select count(*) from audit_log where action in ('payment_plan_created', 'payment_plan_updated', 'payment_plan_paid') and entity_id in ('${r1.entry.id}', '${r2.entry.id}')`)).toBe("4");
  }, 60_000);

  it("DB: plán čte přes REST jen super admin; zápis s autorem ne-super-adminem odmítne trigger", async () => {
    const a = await localSession(DEMO.admin.email, DEMO.admin.password);
    const sl = await localSession(DEMO.sales.email, DEMO.sales.password);
    expect(((await a.from("supplier_payment_plan").select("id").in("id", [...planIds])).data ?? []).length).toBe(planIds.size);
    expect((await sl.from("supplier_payment_plan").select("id").in("id", [...planIds])).data ?? []).toEqual([]);
    expect((await sl.from("supplier_payment_plan").insert({ payee: "E2E-REC hack", amount: 1, due_on: "2026-11-01" })).error).not.toBeNull();
    const headers = await import("@/lib/supabase/actor-headers");
    const env = loadEnv();
    const asSales = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false }, global: { headers: headers.actorHeaders({ id: sales.id, kind: "user", via: "rucne" }) },
    });
    const { error } = await asSales.from("supplier_payment_plan").insert({ payee: "E2E-REC hack", amount: 1, due_on: "2026-11-01" });
    expect(error?.message).toMatch(/jen super admin/);
  }, 60_000);
});
