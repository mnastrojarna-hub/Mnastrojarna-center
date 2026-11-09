import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_ENABLED, loadLocalEnv, localAdmin } from "@/test/local-supabase";
import type { BatchApplyState, BatchReviewModel, BatchSortModel } from "@/lib/jobs/capture-batch-types";

/**
 * Pošta → „Přidat doklad (foto)" proti lokálnímu Supabase s testovací AI (AI_FAKE_CAPTURE + značky v názvech
 * příloh, fixtures …/capture/batch/*-gm*.json): e-mail s výkresy (i skenovaným), STEP, objednávkou
 * zákazníka a logem z podpisu → jedna zakázka se správnými druhy dokumentů, položkami a výkresy u položek;
 * poptávka jen v textu e-mailu (počty kusů z textu, zákazník a kontakt podle odesílatele); „Přidat k
 * zakázce" na existující zakázku; rozpracovaná dávka e-mailu se převezme bez nového čtení.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/email/mail-capture.integration.test.ts
 */

const FIXTURES = path.resolve(process.cwd(), "src/lib/jobs/__fixtures__/capture");
const STROJMETAL = "d2000000-0000-0000-0000-000000000001";

const h = vi.hoisted(() => ({ user: null as Record<string, unknown> | null }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/supabase/server", async () => {
  const lib = await import("@/test/local-supabase");
  return {
    isSupabaseConfigured: () => true,
    hasServiceKey: () => true,
    createAdminClient: (o?: { actor?: Parameters<typeof lib.localAdmin>[0] }) => lib.localAdmin(o?.actor ?? null),
    createOperatorClient: async (o?: { actor?: Parameters<typeof lib.localAdmin>[0] }) => lib.localAdmin(o?.actor ?? null),
    createClient: async () => { throw new Error("Bez session (test)."); },
  };
});
vi.mock("@/lib/auth/session", async () => {
  const perms = await import("@/lib/auth/permissions");
  const ctx = () => ({ aiEnabled: true, aiCaptureForAll: false, aiConfigured: false });
  const access = () => ({
    user: h.user, ctx: ctx(), features: perms.allowedFeatures(h.user as never, ctx()),
    can: (f: string) => perms.can(h.user as never, f as never, ctx()),
  });
  return {
    getSessionUser: async () => h.user,
    getAccess: async () => access(),
    checkFeature: async (f: string) => (perms.can(h.user as never, f as never, ctx()) ? { user: h.user } : { error: "K této akci nemáš oprávnění." }),
    apiRequire: async () => ({ user: h.user }),
    requireUser: async () => h.user,
    requireFeature: async () => h.user,
  };
});

type Service = typeof import("@/lib/jobs/capture-service");
type Batch = typeof import("@/lib/jobs/capture-batch-service");
type MailCapture = typeof import("./mail-capture");

const STEP = (part: string) => Buffer.from(`ISO-10303-21;\nHEADER;\nFILE_NAME('Part1.stp','2026');\nENDSEC;\nDATA;\n#5=PRODUCT('${part}','Díl','',(#2));\nENDSEC;\nEND-ISO-10303-21;\n`);

/** PNG hlavička s rozměry (IHDR) a výplní na danou velikost — logo z podpisu. */
function pngOf(width: number, height: number, size: number): Buffer {
  const b = Buffer.alloc(Math.max(size, 64));
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(b, 0);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

async function vectorPdf(seed: number): Promise<Buffer> {
  const d = await PDFDocument.create();
  d.setProducer("SOLIDWORKS 2024");
  d.addPage([842 + seed, 595]);
  return Buffer.from(await d.save());
}

/** „Sken": PDF jen s obrázkem (bez textu). */
async function scannedPdf(): Promise<Buffer> {
  const d = await PDFDocument.create();
  const png = await d.embedPng(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  const p = d.addPage([595, 842]);
  p.drawImage(png, { x: 0, y: 0, width: 595, height: 842 });
  return Buffer.from(await d.save());
}

async function orderPdf(): Promise<Buffer> {
  const d = await PDFDocument.create();
  d.setProducer("Microsoft Word");
  d.addPage([595, 842]);
  return Buffer.from(await d.save());
}

describe.skipIf(!LOCAL_ENABLED)("Pošta → dávka focení ↔ lokální Supabase", () => {
  let svc: SupabaseClient;
  let s: Service;
  let b: Batch;
  let mc: MailCapture;
  let admin: Record<string, unknown>;
  const RUN = Date.now().toString(36);
  const DOM = `mailcap-${RUN}.test`;
  const startedAt = new Date(Date.now() - 1000).toISOString();
  const jobIds = new Set<string>();
  const emailIds: string[] = [];
  const storagePaths: string[] = [];
  const captureIds = new Set<string>();
  let customerId = "";
  let jobB = { id: "", number: "" };
  const createdCustomers = new Set<string>();

  async function mail(input: {
    subject: string; from: string; fromName: string; category: string; body: string; customerId?: string | null; supplierId?: string | null;
    attachments: { filename: string; mime: string; body: Buffer }[];
  }): Promise<string> {
    const { data, error } = await svc.from("emails").insert({
      subject: input.subject, from_email: input.from, from_name: input.fromName, category: input.category, body_text: input.body,
      direction: "in", thread_id: `t-${RUN}-${emailIds.length}`, customer_id: input.customerId ?? null, supplier_id: input.supplierId ?? null, received_at: new Date().toISOString(),
      has_attachments: input.attachments.length > 0, owner_id: admin.id,
    }).select("id").single();
    if (error) throw new Error(error.message);
    const id = (data as { id: string }).id;
    emailIds.push(id);
    for (const [i, a] of input.attachments.entries()) {
      const p = `email-attachments/test-${RUN}/${id}/${i}-${a.filename.replace(/[^A-Za-z0-9._-]/g, "_")}`;
      const up = await svc.storage.from("documents").upload(p, a.body, { contentType: a.mime, upsert: true });
      if (up.error) throw new Error(up.error.message);
      storagePaths.push(p);
      const { error: e2 } = await svc.from("email_attachments").insert({ email_id: id, filename: a.filename, mime_type: a.mime, size_bytes: a.body.length, storage_path: p });
      if (e2) throw new Error(e2.message);
    }
    return id;
  }

  async function analyzeMail(emailId: string, jobId?: string): Promise<BatchSortModel> {
    const res = await s.analyzeCapture({ files: [], mail: { emailId }, ...(jobId ? { jobId } : {}) });
    if (!res.ok || !("batch" in res)) throw new Error(`Čekám dávku: ${JSON.stringify(res).slice(0, 400)}`);
    captureIds.add(res.batch.captureId);
    return res.batch;
  }

  async function extractAll(batch: BatchSortModel) {
    for (const d of batch.sort.docs.filter((x) => !x.excluded)) {
      const r = await b.captureBatchExtract({ captureId: batch.captureId, docId: d.id, type: d.type, pageIds: d.pageIds });
      if (!r.ok) throw new Error(r.error);
      expect(r.summary.status).toBe("ready");
    }
  }

  async function review(batch: BatchSortModel): Promise<BatchReviewModel> {
    const r = await b.captureBatchReview({ captureId: batch.captureId, sort: batch.sort });
    if (!r.ok) throw new Error(r.error);
    return r.review;
  }

  async function apply(captureId: string, state: BatchApplyState) {
    const r = await b.captureBatchApply({ captureId, state });
    for (const g of r.groups) if (g.jobId) jobIds.add(g.jobId);
    return r;
  }

  const filesOf = async (jobId: string) => {
    const { data } = await svc.from("job_files").select("id, kind, filename, order_item_id, content_sha256").eq("job_id", jobId);
    return (data ?? []) as { id: string; kind: string; filename: string; order_item_id: string | null; content_sha256: string | null }[];
  };
  const itemsOf = async (jobId: string) => {
    const { data } = await svc.from("order_items").select("id, drawing_number, quantity").eq("order_id", jobId).order("position");
    return ((data ?? []) as { id: string; drawing_number: string; quantity: number | string }[]).map((i) => ({ ...i, quantity: Number(i.quantity) }));
  };

  beforeAll(async () => {
    const env = loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    process.env.AI_FAKE_CAPTURE = path.join(FIXTURES, "objednavka-strojmetal.json");
    delete process.env.ANTHROPIC_API_KEY;
    svc = localAdmin();
    const { data: p } = await svc.from("profiles").select("id, email, full_name, role").eq("email", "admin@local.test").single();
    const prof = p as { id: string; email: string };
    admin = { id: prof.id, email: prof.email, fullName: "Admin", role: "super_admin", initials: "AD", roleLabel: "Super admin", aiAccess: true, active: true, hasProfile: true, mustChangePassword: false };
    h.user = admin;
    const { data: c, error } = await svc.from("customers").insert({ name: `Mail Capture ${RUN}`, email: `nakup@${DOM}`, owner_id: prof.id }).select("id").single();
    if (error) throw new Error(error.message);
    customerId = (c as { id: string }).id;
    s = await import("@/lib/jobs/capture-service");
    b = await import("@/lib/jobs/capture-batch-service");
    mc = await import("./mail-capture");
  }, 60_000);

  afterAll(async () => {
    const ids = [...jobIds];
    if (ids.length) {
      const { data: f } = await svc.from("job_files").select("storage_path").in("job_id", ids);
      const paths = ((f ?? []) as { storage_path: string }[]).map((x) => x.storage_path);
      for (let i = 0; i < paths.length; i += 100) await svc.storage.from("job-files").remove(paths.slice(i, i + 100));
      await svc.from("emails").update({ order_id: null }).in("order_id", ids);
      await svc.from("job_mail_changes").delete().in("job_id", ids);
      await svc.from("drawings").delete().in("job_id", ids);
      await svc.from("orders").delete().in("id", ids);
    }
    await svc.from("drawings").delete().in("drawing_number", ["8810-01", "8810-02", "8810-03", "8810-04", "8810-06", "8820-01", "8820-02"]).gte("created_at", startedAt);
    if (emailIds.length) await svc.from("emails").delete().in("id", emailIds);
    if (storagePaths.length) await svc.storage.from("documents").remove(storagePaths);
    for (const id of captureIds) {
      const { data } = await svc.from("capture_sessions").select("data").eq("id", id).maybeSingle();
      const fs = ((data as { data?: { files?: { path: string }[] } } | null)?.data?.files ?? []);
      if (fs.length) await svc.storage.from("job-files").remove(fs.map((x) => x.path));
      await svc.from("capture_sessions").delete().eq("id", id);
    }
    await svc.from("customer_contacts").delete().eq("customer_id", STROJMETAL).like("email", `%${RUN}%`);
    for (const id of createdCustomers) {
      await svc.from("customer_contacts").delete().eq("customer_id", id);
      await svc.from("customers").delete().eq("id", id);
    }
    if (customerId) {
      await svc.from("customer_contacts").delete().eq("customer_id", customerId);
      await svc.from("customers").delete().eq("id", customerId);
    }
    await svc.from("ai_training_examples").delete().gte("created_at", startedAt).eq("created_by", admin.id as string).in("kind", ["capture", "capture_drawing", "capture_sort"]);
  }, 120_000);

  it("objednávka + 3 výkresy (1 skenovaný) + STEP + logo z podpisu → 1 zakázka, správné druhy, výkresy u položek, kontakt", async () => {
    const sender = `petra.${RUN}@strojmetal.cz`;
    const emailId = await mail({
      subject: "Objednávka PO-E2E-MAIL-1", from: sender, fromName: "Petra Nová", category: "objednavka",
      body: "Dobrý den,\nv příloze objednávka PO-E2E-MAIL-1 a výkresy.\n\nS pozdravem\nPetra Nová\nNákup\nTel.: +420 777 123 456\n",
      attachments: [
        { filename: "8810-01__vykres-gm1a.pdf", mime: "application/pdf", body: await vectorPdf(1) },
        { filename: "8810-02__vykres-gm1b.pdf", mime: "application/pdf", body: await vectorPdf(2) },
        { filename: "sken_8810-03__vykres-gm1c.pdf", mime: "application/pdf", body: await scannedPdf() },
        { filename: "8810-01.step", mime: "application/octet-stream", body: STEP("8810-01") },
        { filename: "Objednavka__objednavka_zakaznik-gm1.pdf", mime: "application/pdf", body: await orderPdf() },
        { filename: "image001.png", mime: "image/png", body: pngOf(120, 40, 2_000) },
        { filename: "firma.png", mime: "image/png", body: pngOf(400, 100, 40_000) },
      ],
    });

    const plan = await mc.mailCapturePlan(emailId, null);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.files).toBe(6); // malé logo vyřazené už podle velikosti, banner až podle rozměrů
    expect(plan.customer?.id).toBe(STROJMETAL);
    expect(plan.sender).toMatchObject({ status: "new", email: sender, phone: "+420 777 123 456" });

    const batch = await analyzeMail(emailId);
    // loga z podpisu do dávky vůbec nejdou; všechny soubory jsou jeden balík e-mailu
    expect(batch.files.map((f) => f.filename).sort()).toEqual([
      "8810-01.step", "8810-01__vykres-gm1a.pdf", "8810-02__vykres-gm1b.pdf", "Objednavka__objednavka_zakaznik-gm1.pdf", "sken_8810-03__vykres-gm1c.pdf",
    ]);
    expect(new Set(batch.files.map((f) => f.bundle))).toEqual(new Set([`mail:${emailId}`]));
    const active = batch.sort.docs.filter((d) => !d.excluded);
    expect(active.map((d) => d.type).sort()).toEqual(["model_3d", "objednavka_zakaznik", "vykres", "vykres", "vykres"]);

    // znovu otevřít = převzít rozpracovanou dávku (žádné nové čtení AI)
    const again = await analyzeMail(emailId);
    expect(again.captureId).toBe(batch.captureId);

    await extractAll(batch);
    const rv = await review(batch);
    expect(rv.groups).toHaveLength(1);
    const g = rv.initial.groups[0];
    expect(g.job.targetKey).toBe("new");
    expect(g.job.customer).toMatchObject({ mode: "existing", id: STROJMETAL });
    expect(g.job.items.map((i) => [i.drawingNumber, Number(i.quantity)])).toEqual([["8810-01", 5], ["8810-02", 8], ["8810-03", 3]]);
    for (const d of active.filter((x) => x.type === "vykres")) {
      const st = rv.initial.docs[d.id];
      expect(st.kind === "drawing" && st.state.link.mode).toBe("docItem");
    }

    const res = await apply(batch.captureId, rv.initial);
    expect(res.status, JSON.stringify({ failed: res.docs.filter((d) => !d.ok), error: res.error })).toBe("done");
    expect(res.groups[0].created).toBe(true);
    const jobId = res.groups[0].jobId!;
    jobB = { id: jobId, number: res.groups[0].jobNumber! };

    const fin = await mc.finishMailCapture({ emailId, captureId: batch.captureId, jobId, created: true, addContact: true });
    expect(fin).toMatchObject({ ok: true, linkedFiles: 5, contact: "added" });

    const items = await itemsOf(jobId);
    expect(items.map((i) => [i.drawing_number, i.quantity])).toEqual([["8810-01", 5], ["8810-02", 8], ["8810-03", 3]]);
    const jf = await filesOf(jobId);
    expect(jf.map((f) => f.kind).sort()).toEqual(["model_3d", "objednavka", "vykres", "vykres", "vykres"]);
    expect(jf.some((f) => /image001|firma\.png/.test(f.filename))).toBe(false);
    const itemOf = (n: string) => items.find((i) => i.drawing_number === n)!.id;
    const drawings = jf.filter((f) => f.kind === "vykres");
    expect(drawings.map((f) => f.order_item_id).sort()).toEqual([itemOf("8810-01"), itemOf("8810-02"), itemOf("8810-03")].sort());
    expect(jf.find((f) => f.kind === "model_3d")!.order_item_id).toBe(itemOf("8810-01"));

    const { data: em } = await svc.from("emails").select("order_id, job_link_source").eq("id", emailId).single();
    expect(em).toMatchObject({ order_id: jobId, job_link_source: "created" });
    const { data: atts } = await svc.from("email_attachments").select("filename, job_file_id").eq("email_id", emailId);
    const linked = ((atts ?? []) as { filename: string; job_file_id: string | null }[]).filter((a) => a.job_file_id).map((a) => a.filename).sort();
    expect(linked).toHaveLength(5);
    expect(linked.some((n) => /image001|firma/.test(n))).toBe(false);
    const { data: job } = await svc.from("orders").select("status, customer_id, customer_contact_id, customer_contact_email, email_id").eq("id", jobId).single();
    expect(job).toMatchObject({ status: "objednavka", customer_id: STROJMETAL, customer_contact_email: sender, email_id: emailId });
    const { data: k } = await svc.from("customer_contacts").select("id, name, phone").eq("customer_id", STROJMETAL).eq("email", sender).single();
    expect(k).toMatchObject({ name: "Petra Nová", phone: "+420 777 123 456" });
    expect((job as { customer_contact_id: string }).customer_contact_id).toBe((k as { id: string }).id);
  }, 180_000);

  it("poptávka jen v textu e-mailu + 2 výkresy → nová zakázka, zákazník podle odesílatele, počty z textu", async () => {
    const sender = `jan.${RUN}@${DOM}`;
    const emailId = await mail({
      subject: "RE: Poptávka čepy a příruby", from: sender, fromName: "Jan Malý", category: "poptavka",
      body: "Dobrý den,\nprosíme o cenovou nabídku dle výkresů:\n8820-01 – 10 ks\n8820-02 – 4 ks\n\nDěkuji\nJan Malý\nmobil 603 222 333",
      attachments: [
        { filename: "8820-01__vykres-gm2a.pdf", mime: "application/pdf", body: await vectorPdf(3) },
        { filename: "8820-02__vykres-gm2b.pdf", mime: "application/pdf", body: await scannedPdf() },
        { filename: "Outlook-logo.png", mime: "image/png", body: pngOf(600, 200, 60_000) },
      ],
    });
    const batch = await analyzeMail(emailId);
    expect(batch.files).toHaveLength(2);
    await extractAll(batch);
    const rv = await review(batch);
    expect(rv.groups).toHaveLength(1);
    const g = rv.initial.groups[0];
    expect(g.job.customer).toEqual({ mode: "existing", id: customerId, name: `Mail Capture ${RUN}`, reason: "odesílatel e-mailu" });
    expect(g.job.fields).toMatchObject({ customerContact: "Jan Malý", customerContactEmail: sender });
    // 9. 11.: datum poptávky = den přijetí e-mailu (pražský čas), požadovaný termín v textu není → prázdný
    const { data: em } = await svc.from("emails").select("received_at").eq("id", emailId).single();
    const received = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" })
      .format(new Date((em as { received_at: string }).received_at));
    expect(g.job.fields.inquiryDate).toBe(received);
    // text e-mailu je primární doklad: položky z textu dostaly název z výkresů → název z položek
    expect(g.jobDraftTitle).toBe("Čep 8820-01 + 1 další");
    expect(g.job.items.map((i) => [i.key, i.drawingNumber, i.quantity])).toEqual([["ai-0", "8820-01", "10"], ["ai-1", "8820-02", "4"]]);
    const q = rv.docs.filter((d) => d.kind === "drawing").map((d) => {
      const st = rv.initial.docs[d.docId];
      return st.kind === "drawing" ? [st.state.drawingNumber, st.state.quantity] : null;
    });
    expect(q.sort()).toEqual([["8820-01", "10"], ["8820-02", "4"]]);
    expect(rv.warnings.some((w) => w.code === "drawing_quantity_missing")).toBe(false);

    const res = await apply(batch.captureId, rv.initial);
    expect(res.status).toBe("done");
    const jobId = res.groups[0].jobId!;
    const fin = await mc.finishMailCapture({ emailId, captureId: batch.captureId, jobId, created: true, addContact: true });
    expect(fin.ok).toBe(true);
    expect((await itemsOf(jobId)).map((i) => [i.drawing_number, i.quantity])).toEqual([["8820-01", 10], ["8820-02", 4]]);
    expect((await filesOf(jobId)).map((f) => f.kind)).toEqual(["vykres", "vykres"]);
    const { data: job } = await svc.from("orders").select("status, title, customer_id, customer_contact_id").eq("id", jobId).single();
    expect(job).toMatchObject({ status: "poptavka", title: "Čep 8820-01 + 1 další", customer_id: customerId });
    const { data: dates } = await svc.from("orders").select("inquiry_date").eq("id", jobId).single();
    expect((dates as { inquiry_date: string | null }).inquiry_date).toBe(received);
    expect((job as { customer_contact_id: string | null }).customer_contact_id).toBeTruthy();
  }, 180_000);

  it("„Přidat k zakázce“: další výkres z e-mailu na existující zakázku (počet z textu), vlákno přiřazeno ručně", async () => {
    expect(jobB.id).toBeTruthy();
    const emailId = await mail({
      subject: `Doplnění ${jobB.number}`, from: `petra.${RUN}@strojmetal.cz`, fromName: "Petra Nová", category: "k_zakazce", customerId: STROJMETAL,
      body: "Dobrý den,\nposíláme ještě jeden výkres:\n8810-04 – 6 ks\n\nPetra",
      attachments: [{ filename: "8810-04__vykres-gm1d.pdf", mime: "application/pdf", body: await vectorPdf(4) }],
    });
    const plan = await mc.mailCapturePlan(emailId, jobB.id);
    expect(plan.ok && plan.sender.status).toBe("existing"); // kontakt přidaný v prvním testu
    const batch = await analyzeMail(emailId, jobB.id);
    expect(batch.fixedJobId).toBe(jobB.id);
    await extractAll(batch);
    const rv = await review(batch);
    expect(rv.initial.groups[0].job.targetKey).toBe(jobB.id);
    const d = rv.docs.find((x) => x.kind === "drawing")!;
    const st = rv.initial.docs[d.docId];
    // text e-mailu „8810-04 – 6 ks" = položka z textu (ai-0), výkres na ni míří; řádek je vidět v Položkách
    expect(st.kind === "drawing" && [st.state.quantity, st.state.link.mode]).toEqual(["6", "docItem"]);
    expect(rv.initial.groups[0].job.items.map((i) => [i.drawingNumber, i.quantity])).toEqual([["8810-04", "6"]]);
    const res = await apply(batch.captureId, rv.initial);
    expect(res.status).toBe("done");
    expect(res.groups[0]).toMatchObject({ jobId: jobB.id, created: false });
    const fin = await mc.finishMailCapture({ emailId, captureId: batch.captureId, jobId: jobB.id, created: false, addContact: false });
    expect(fin).toMatchObject({ ok: true, linkedFiles: 1 });
    expect((await itemsOf(jobB.id)).map((i) => [i.drawing_number, i.quantity])).toEqual([["8810-01", 5], ["8810-02", 8], ["8810-03", 3], ["8810-04", 6]]);
    const jf = await filesOf(jobB.id);
    expect(jf.filter((f) => f.kind === "vykres")).toHaveLength(4);
    const { data: em } = await svc.from("emails").select("order_id, job_link_source").eq("id", emailId).single();
    expect(em).toMatchObject({ order_id: jobB.id, job_link_source: "manual" });
  }, 180_000);

  it("„Změnit“ u vlákna jiné zakázky: příloha, která už u cílové zakázky je (stejný obsah), se znovu neukládá; nová projde dávkou a vlákno se přesune", async () => {
    expect(jobB.id).toBeTruthy();
    // vlákno dnes patří k jiné zakázce
    const { data: other, error } = await svc.from("orders").insert({
      number: `Z-MC-${RUN}`, title: `Jiná zakázka ${RUN}`, source: "manual", status: "objednavka", owner_id: admin.id, created_by: admin.id, inquiry_date: new Date().toISOString().slice(0, 10), priority: "stredni",
    }).select("id").single();
    if (error) throw new Error(error.message);
    const otherId = (other as { id: string }).id;
    jobIds.add(otherId);
    // stejný obsah jako výkres 8810-04 uložený u jobB v minulém testu (PDF z pdf-lib nese datum → bajty vzít z úložiště)
    const { data: stored } = await svc.from("job_files").select("id, filename, storage_path, content_sha256").eq("job_id", jobB.id).eq("kind", "vykres").ilike("filename", "8810-04%").single();
    const dup = stored as { id: string; filename: string; storage_path: string; content_sha256: string };
    const dl = await svc.storage.from("job-files").download(dup.storage_path);
    if (dl.error || !dl.data) throw new Error(dl.error?.message ?? "soubor výkresu v úložišti chybí");
    const dupBytes = Buffer.from(await dl.data.arrayBuffer());
    const emailId = await mail({
      subject: `Výkresy znovu ${jobB.number}`, from: `petra.${RUN}@strojmetal.cz`, fromName: "Petra Nová", category: "k_zakazce", customerId: STROJMETAL,
      body: "Dobrý den,\nposíláme výkres 8810-04 ještě jednou a jeden nový:\n8810-06 – 2 ks\n\nPetra",
      attachments: [
        { filename: "8810-04__vykres-znovu.pdf", mime: "application/pdf", body: dupBytes },
        { filename: "8810-06__vykres-gm1f.pdf", mime: "application/pdf", body: await vectorPdf(6) },
      ],
    });
    await svc.from("emails").update({ order_id: otherId, job_link_source: "manual" }).eq("id", emailId);
    const before = await filesOf(jobB.id);

    // plán pro „Změnit" → jobB: duplicitní příloha vynechaná (s dokumentem, který ji drží), k roztřídění zbývá jedna
    const plan = await mc.mailCapturePlan(emailId, jobB.id);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.files).toBe(1);
    expect(plan.skipped).toEqual([{ id: expect.any(String), filename: "8810-04__vykres-znovu.pdf", reason: mc.ALREADY_IN_JOB, jobFileId: dup.id }]);
    // bez pevného cíle (jiná zakázka / nová) jdou do dávky obě
    const planNew = await mc.mailCapturePlan(emailId, null);
    expect(planNew.ok && planNew.files).toBe(2);

    const batch = await analyzeMail(emailId, jobB.id);
    expect(batch.fixedJobId).toBe(jobB.id);
    expect(batch.files.map((f) => f.filename)).toEqual(["8810-06__vykres-gm1f.pdf"]);
    await extractAll(batch);
    const rv = await review(batch);
    const res = await apply(batch.captureId, rv.initial);
    expect(res.status, JSON.stringify({ failed: res.docs.filter((d) => !d.ok), error: res.error })).toBe("done");
    expect(res.groups[0]).toMatchObject({ jobId: jobB.id, created: false });

    // bez výslovného „Změnit" se vlákno jiné zakázky nepřepíše
    const kept = await mc.finishMailCapture({ emailId, captureId: batch.captureId, jobId: jobB.id, created: false, addContact: false });
    expect(kept.ok).toBe(false);
    const { data: still } = await svc.from("emails").select("order_id").eq("id", emailId).single();
    expect(still).toMatchObject({ order_id: otherId });

    const fin = await mc.finishMailCapture({ emailId, captureId: batch.captureId, jobId: jobB.id, created: false, addContact: false, relink: true });
    expect(fin).toMatchObject({ ok: true, linkedFiles: 1 });
    const after = await filesOf(jobB.id);
    expect(after.filter((f) => f.content_sha256 === dup.content_sha256)).toHaveLength(1); // duplicitní výkres se znovu neuložil
    expect(after.length).toBe(before.length + 1);
    expect(after.some((f) => f.kind === "vykres" && /^8810-06/.test(f.filename))).toBe(true);
    const { data: em } = await svc.from("emails").select("order_id, job_link_source").eq("id", emailId).single();
    expect(em).toMatchObject({ order_id: jobB.id, job_link_source: "manual" });
    const { data: atts } = await svc.from("email_attachments").select("filename, job_file_id").eq("email_id", emailId);
    const byName = Object.fromEntries(((atts ?? []) as { filename: string; job_file_id: string | null }[]).map((a) => [a.filename, a.job_file_id]));
    expect(byName["8810-04__vykres-znovu.pdf"]).toBe(dup.id); // vynechaná příloha ukazuje na dokument, který už u zakázky byl
    expect(byName["8810-06__vykres-gm1f.pdf"]).toBeTruthy();
  }, 180_000);

  // ── majitel 6. 11.: e-mail + výkres → vše provázané (text, zákazník z hlavičky, položka, kontakt) ──
  const STEEL_ICO = "25931644";
  const steelingMail = (over: { subject?: string; body?: string; from?: string } = {}) => {
    const from = over.from ?? `jan.cejka@steeling-${RUN}.test`;
    return {
      subject: over.subject ?? "Poptávka – stud bolt M42", from, fromName: from, category: "poptavka",
      body: over.body ?? [
        "Dobrý den,",
        "prosím o cenovou nabídku na výrobu dle přiloženého výkresu SDF000637.4, 20 ks, termín dodání do 15. 12. 2026.",
        "Dodat s atestem 3.1.",
        "",
        "S pozdravem",
        "Jan Čejka",
        "Nákup",
        `STEELING ${RUN}, s.r.o.`,
        "Tovární 1402/12, 796 01 Prostějov",
        `IČO: ${STEEL_ICO}, DIČ: CZ${STEEL_ICO}`,
        "Tel.: +420 777 248 197",
        `${from} | www.steeling.cz`,
        "",
        "Dne 5. 11. 2026 napsal Mnástrojárna <obchod@mnastrojarna.cz>:",
        "> Dobrý den, posíláme ceník.",
      ].join("\n"),
    };
  };

  it("poptávka v textu + 1 výkres, neznámý odesílatel bez jména v hlavičce → zákazník z podpisu (nový, IČO, adresa), kontakt jménem, položka z textu s počtem, výkres na ni; uložení založí vše provázané", async () => {
    const m = steelingMail();
    const emailId = await mail({ ...m, attachments: [{ filename: "SDF000637.4__vykres-gm3.pdf", mime: "application/pdf", body: await vectorPdf(7) }] });

    // plán dialogu: jméno z podpisu, nikdy surová adresa; pozice a firma pro nového zákazníka
    const plan = await mc.mailCapturePlan(emailId, null);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.customer).toBeNull();
    expect(plan.sender).toMatchObject({ status: "none", name: "Jan Čejka", position: "Nákup", company: `STEELING ${RUN}, s.r.o.`, phone: "+420 777 248 197" });

    const batch = await analyzeMail(emailId);
    expect(batch.sort.docs.filter((d) => !d.excluded).map((d) => d.type)).toEqual(["vykres"]);
    await extractAll(batch);
    const rv = await review(batch);
    expect(rv.groups).toHaveLength(1);
    expect(rv.docs.map((d) => d.kind)).toEqual(["drawing"]); // text e-mailu nemá kartu dokladu
    const rg = rv.groups[0];
    const g = rv.initial.groups[0];
    expect(g.job.targetKey).toBe("new");
    expect(g.job.stage).toBe("poptavka");
    // zákazník z hlavičky podpisu — návrh „Založit nového zákazníka" s vyplněnými údaji
    expect(g.job.customer).toEqual({
      mode: "new",
      party: expect.objectContaining({ name: `STEELING ${RUN}, s.r.o.`, ico: STEEL_ICO, dic: `CZ${STEEL_ICO}`, street: "Tovární 1402/12", city: "Prostějov", zip: "796 01", email: m.from, phone: "+420 777 248 197", contactPerson: "Jan Čejka" }),
    });
    expect(g.job.fields).toMatchObject({ customerContact: "Jan Čejka", customerContactEmail: m.from, customerContactPhone: "+420 777 248 197", customerRequiredDate: "2026-12-15", title: "Stud bolt M42 / Schraubenbolzen M42 SDF000637.4" });
    expect(rg.fieldSources.customerContact?.label).toBe("z podpisu e-mailu");
    expect(rg.visibleFields).toEqual(expect.arrayContaining(["customerContact", "customerContactEmail", "customerContactPhone", "customerRequiredDate"]));
    // položka z textu („SDF000637.4, 20 ks") v Položkách, výkres na ni míří, karta výkresu má počet z textu
    expect(g.job.items.map((i) => [i.key, i.drawingNumber, i.quantity, i.revision, i.name])).toEqual([["ai-0", "SDF000637.4", "20", "A", "Stud bolt M42 / Schraubenbolzen M42"]]);
    const d = rv.docs[0];
    const st = rv.initial.docs[d.docId];
    expect(st.kind === "drawing" && [st.state.quantity, st.state.link]).toEqual(["20", { mode: "docItem", itemKey: "ai-0" }]);
    expect(d.kind === "drawing" && d.sources?.quantity).toBe("z textu e-mailu");
    expect(rg.itemOptions.new.map((o) => o.link.mode)).toEqual(["docItem", "add", "none"]);
    expect(rv.warnings.filter((w) => w.code === "drawing_quantity_missing" || w.code === "unlinked_drawing" || w.severity === "block")).toEqual([]);
    expect(rv.warnings.every((w) => !w.docIds.includes("mail"))).toBe(true);

    const res = await apply(batch.captureId, rv.initial);
    expect(res.status, JSON.stringify({ failed: res.docs.filter((x) => !x.ok), error: res.error })).toBe("done");
    expect(res.groups[0]).toMatchObject({ created: true, customerCreated: true });
    const jobId = res.groups[0].jobId!;
    const { data: job0 } = await svc.from("orders").select("customer_id").eq("id", jobId).single();
    const custId = (job0 as { customer_id: string }).customer_id;
    createdCustomers.add(custId);
    const fin = await mc.finishMailCapture({ emailId, captureId: batch.captureId, jobId, created: true, addContact: true });
    expect(fin.ok).toBe(true);

    expect((await itemsOf(jobId)).map((i) => [i.drawing_number, i.quantity])).toEqual([["SDF000637.4", 20]]);
    const jf = await filesOf(jobId);
    expect(jf.map((f) => f.kind)).toEqual(["vykres"]);
    expect(jf[0].order_item_id).toBe((await itemsOf(jobId))[0].id);
    const { data: cust } = await svc.from("customers").select("name, ico, dic, city, zip, email").eq("id", custId).single();
    expect(cust).toMatchObject({ name: `STEELING ${RUN}, s.r.o.`, ico: STEEL_ICO, city: "Prostějov", zip: "796 01", email: m.from });
    const { data: k } = await svc.from("customer_contacts").select("id, name, email, phone, position").eq("customer_id", custId).eq("email", m.from).single();
    expect(k).toMatchObject({ name: "Jan Čejka", phone: "+420 777 248 197", position: "Nákup" });
    const { data: job } = await svc.from("orders").select("status, title, customer_contact, customer_contact_email, customer_contact_id, customer_required_date, email_id").eq("id", jobId).single();
    expect(job).toMatchObject({ status: "poptavka", title: "Stud bolt M42 / Schraubenbolzen M42 SDF000637.4", customer_contact: "Jan Čejka", customer_contact_email: m.from, customer_contact_id: (k as { id: string }).id, customer_required_date: "2026-12-15", email_id: emailId });
  }, 180_000);

  it("AI čte text e-mailu (fixture): položka s názvem a popisem z textu, pozice kontaktu, údaje označené zdrojem", async () => {
    // jiný díl než v předchozím testu (stejné číslo výkresu by správně spárovalo tu zakázku); sken = výkres bez čísla v názvu
    const m = steelingMail({ subject: "Poptávka – stud bolt M42 (2)", body: `${steelingMail().body.replace("SDF000637.4", "SDF000641.2")}\n__mail-steeling` });
    const emailId = await mail({ ...m, attachments: [{ filename: "sken_vykresu__vykres-gm6.pdf", mime: "application/pdf", body: await vectorPdf(9) }] });
    const batch = await analyzeMail(emailId);
    await extractAll(batch);
    const rv = await review(batch);
    const g = rv.initial.groups[0];
    expect(rv.groups[0].model.aiUsed).toBe(true);
    expect(g.job.targetKey).toBe("new");
    // stejný odesílatel jako v předchozím testu → zákazník už v CRM (podle adresy), kontakt se znovu nezakládá
    expect(g.job.customer).toMatchObject({ mode: "existing", reason: "odesílatel e-mailu" });
    expect(createdCustomers.has((g.job.customer as { id: string }).id)).toBe(true);
    const plan = await mc.mailCapturePlan(emailId, null);
    expect(plan.ok && plan.sender).toMatchObject({ status: "existing", name: "Jan Čejka" });
    expect(g.job.items.map((i) => [i.key, i.drawingNumber, i.quantity, i.name, i.description])).toEqual([["ai-0", "SDF000641.2", "20", "Stud bolt M42", "dodat s atestem 3.1"]]);
    expect(g.job.fields).toMatchObject({ customerContact: "Jan Čejka", customerRequiredDate: "2026-12-15" });
    const dst = rv.initial.docs[rv.docs[0].docId];
    expect(dst.kind === "drawing" && [dst.state.drawingNumber, dst.state.quantity, dst.state.link]).toEqual(["SDF000641.2", "20", { mode: "docItem", itemKey: "ai-0" }]);
    const { data: sess } = await svc.from("capture_sessions").select("data").eq("id", batch.captureId).single();
    const ex = (sess as { data: { mail?: { extract?: { aiUsed: boolean; person: { name: string; position: string } } } } }).data.mail?.extract;
    expect(ex).toMatchObject({ aiUsed: true, person: { name: "Jan Čejka", position: "nákup" } });
  }, 180_000);

  it("objednávka zákazníka v příloze e-mailu (neznámý zákazník) → stejná kontrola jako focení: položky s cenami, nový zákazník z dokladu, stav Objednávka; text e-mailu jen doplní", async () => {
    const from = `horakova@hydraulika-morava-${RUN}.test`;
    const emailId = await mail({
      subject: "Objednávka PO-MAIL-HM-7", from, fromName: "Lenka Horáková", category: "objednavka",
      body: "Dobrý den,\nv příloze zasílám objednávku, termín prosím dodržet.\n\nS pozdravem\nLenka Horáková\nnákup\nHydraulika Morava s.r.o.\nmobil: +420 602 555 777",
      attachments: [{ filename: "Objednavka__objednavka_zakaznik-gm4.pdf", mime: "application/pdf", body: await orderPdf() }],
    });
    const batch = await analyzeMail(emailId);
    await extractAll(batch);
    const rv = await review(batch);
    expect(rv.groups).toHaveLength(1);
    const rg = rv.groups[0];
    const g = rv.initial.groups[0];
    expect(rg.primaryDocId).toBe(rv.docs[0].docId);           // přiložená objednávka je primární, ne text
    expect(rv.docs[0].kind === "business" && rv.docs[0].primary).toBe(true);
    expect(g.job.targetKey).toBe("new");
    expect(g.job.stage).toBe("objednavka");
    expect(g.job.customer).toEqual({ mode: "new", party: expect.objectContaining({ name: "Hydraulika Morava s.r.o.", ico: "08542311", contactPerson: "Lenka Horáková" }) });
    expect(g.job.items.map((i) => [i.drawingNumber, i.quantity, i.unitPrice])).toEqual([["HM-1050-03", "40", "1250"], ["HM-1050-07", "40", "310"]]);
    expect(g.job.fields).toMatchObject({ customerOrderNumber: "PO-MAIL-HM-7", customerRequiredDate: "2026-12-18", customerContact: "Lenka Horáková" });
    expect(rv.warnings.some((w) => w.code === "multiple_orders")).toBe(false);
    const res = await apply(batch.captureId, rv.initial);
    expect(res.status, JSON.stringify({ failed: res.docs.filter((x) => !x.ok), error: res.error })).toBe("done");
    const jobId = res.groups[0].jobId!;
    const { data: job0 } = await svc.from("orders").select("customer_id, status, customer_order_number").eq("id", jobId).single();
    createdCustomers.add((job0 as { customer_id: string }).customer_id);
    expect(job0).toMatchObject({ status: "objednavka", customer_order_number: "PO-MAIL-HM-7" });
    expect((await itemsOf(jobId)).map((i) => [i.drawing_number, i.quantity])).toEqual([["HM-1050-03", 40], ["HM-1050-07", 40]]);
    expect((await filesOf(jobId)).map((f) => f.kind)).toEqual(["objednavka"]);
    const fin = await mc.finishMailCapture({ emailId, captureId: batch.captureId, jobId, created: true, addContact: true });
    expect(fin.ok).toBe(true);
    const { data: k } = await svc.from("customer_contacts").select("name, phone, position").eq("customer_id", (job0 as { customer_id: string }).customer_id).eq("email", from).maybeSingle();
    expect(k).toMatchObject({ name: "Lenka Horáková", phone: "+420 602 555 777", position: "nákup" });
  }, 180_000);

  it("objednávka v příloze se stejným číslem jako existující zakázka → spárování se zakázkou (ne nová), upozornění na už uložený doklad", async () => {
    expect(jobB.id).toBeTruthy();
    const emailId = await mail({
      subject: "FW: Objednávka PO-E2E-MAIL-1", from: `petra.${RUN}@strojmetal.cz`, fromName: "Petra Nová", category: "objednavka", customerId: STROJMETAL,
      body: "Posílám objednávku ještě jednou.\nPetra",
      attachments: [{ filename: "Objednavka__objednavka_zakaznik-gm1.pdf", mime: "application/pdf", body: await orderPdf() }],
    });
    const batch = await analyzeMail(emailId);
    await extractAll(batch);
    const rv = await review(batch);
    const g = rv.initial.groups[0];
    expect(g.job.targetKey).toBe(jobB.id);
    const t = rv.groups[0].model.targets.find((x) => x.key === jobB.id);
    expect(t?.reason ?? "").toMatch(/objednávky/);
    expect(rv.warnings.some((w) => w.code === "already_saved")).toBe(true);
    expect(g.job.customer).toMatchObject({ mode: "existing", id: STROJMETAL });
  }, 180_000);

  it("dodací list dodavatele v příloze e-mailu od dodavatele → jako u focení: cíl vybere člověk (žádná nová zakázka), dodavatel podle IČO", async () => {
    const emailId = await mail({
      subject: "Dodací list DL-MAIL-91", from: "objednavky@hruby-cnc.cz", fromName: "", category: "potvrzeni_objednavky", supplierId: "d4000000-0000-0000-0000-000000000001",
      body: "Dobrý den,\nv příloze dodací list k dnešní dodávce.\n\nPavel Hrubý\nKovoobrábění Hrubý s.r.o.\ntel. +420 315 700 120",
      attachments: [{ filename: "DL__dodaci_list_dodavatel-gm5.pdf", mime: "application/pdf", body: await orderPdf() }],
    });
    const batch = await analyzeMail(emailId);
    expect(batch.sort.docs.filter((d) => !d.excluded).map((d) => d.type)).toEqual(["dodaci_list_dodavatel"]);
    await extractAll(batch);
    const rv = await review(batch);
    expect(rv.groups).toHaveLength(1);
    const g = rv.initial.groups[0];
    expect(g.job.targetKey).toBe("");                                   // ne vynucená nová zakázka
    expect(rv.warnings.find((w) => w.code === "target_required")?.severity).toBe("block");
    const d = rv.docs[0];
    expect(d.kind === "business" && d.supplierMatch?.id).toBe("d4000000-0000-0000-0000-000000000001");
    expect(rv.docs).toHaveLength(1);                                    // text e-mailu od dodavatele není doklad zákazníka
    expect(g.job.items).toEqual([]);
  }, 180_000);
});
