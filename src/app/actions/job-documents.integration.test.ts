import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * E2E dokladů ze zakázky proti lokálnímu Supabase (tools/local-supabase):
 * potvrzení (ceny chybí → varování → doplnit → PDF v1/v2) → návrh e-mailu → odeslání
 * (mail catcher, PDF v příloze, posun do „Potvrzená objednávka") → nabídka → dodací list →
 * faktura (číslo z řady, evidence faktur, „Vyfakturováno") → API náhledy.
 * Mockuje se jen přihlášení a revalidace. Spuštění:
 *   LOCAL_SUPABASE=1 npx vitest run src/app/actions/job-documents.integration.test.ts
 * Pracuje s vlastní dočasnou zakázkou a vše po sobě uklidí.
 */

const ENABLED = process.env.LOCAL_SUPABASE === "1";
const CUSTOMER = "d2000000-0000-0000-0000-000000000001"; // Strojmetal a.s. (splatnost 30 dní)
const MAIL_TO = `e2e-doklady-${Date.now()}@local.test`;
const COUNTERS = ["Z", "NAB", "DL", "FV"];

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

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

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
  const admin = () => sb.createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    isSupabaseConfigured: () => true,
    hasServiceKey: () => true,
    createAdminClient: admin,
    createOperatorClient: async () => admin(),
    createClient: async () => {
      throw new Error("Bez session (test).");
    },
  };
});

vi.mock("@/lib/auth/session", () => {
  const user = {
    id: "156c7996-b488-4c53-a3f5-e51dd004f4ad",
    email: "obchod@local.test",
    fullName: "Petr Obchodník",
    role: "obchodnik",
    initials: "PO",
    roleLabel: "Obchodník",
    aiAccess: true,
    active: true,
    hasProfile: true,
  };
  return {
    getSessionUser: async () => user,
    getAccess: async () => ({ user, ctx: {}, features: [], can: () => true }),
    checkFeature: async () => ({ user }),
    apiRequire: async () => ({ user }),
    requireUser: async () => user,
    requireFeature: async () => user,
  };
});

type Docs = typeof import("./job-documents");
type Jobs = typeof import("./jobs");

const pdfMagic = (b: Buffer) => b.subarray(0, 4).toString("latin1");

describe.skipIf(!ENABLED)("doklady ze zakázky ↔ lokální Supabase (E2E)", () => {
  let db: SupabaseClient;
  let d: Docs;
  let j: Jobs;
  let jobId = "";
  let jobNumber = "";
  let quoteId = "";
  let confirmationFileId = "";
  let invoiceNumber = "";
  const counters = new Map<string, { year: number; counter: number } | null>();
  const startedAt = new Date(Date.now() - 1000).toISOString();

  async function job() {
    const { data } = await db.from("orders").select("*").eq("id", jobId).single();
    return data as Record<string, unknown>;
  }
  async function file(id: string) {
    const { data } = await db.from("job_files").select("*").eq("id", id).single();
    return data as Record<string, unknown>;
  }
  async function download(storagePath: string) {
    const { data } = await db.storage.from("job-files").download(storagePath);
    return Buffer.from(await data!.arrayBuffer());
  }

  beforeAll(async () => {
    const env = loadEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    for (const t of COUNTERS) {
      const { data } = await db.from("doc_counters").select("year, counter").eq("doc_type", t).maybeSingle();
      counters.set(t, (data as { year: number; counter: number } | null) ?? null);
    }
    d = await import("./job-documents");
    j = await import("./jobs");

    const created = await j.createJob({
      title: "E2E doklady — hřídel a pouzdro",
      stage: "objednavka",
      customerId: CUSTOMER,
      customerOrderNumber: "PO-E2E-77",
      orderDate: "2026-10-20",
      customerRequiredDate: "2026-11-30",
      customerContactEmail: MAIL_TO,
      items: [
        { drawingNumber: "E2E-DOC-1", name: "Hřídel E2E", material: "C45", quantity: 10, unitPrice: 1000 },
        { drawingNumber: "E2E-DOC-2", name: "Pouzdro E2E", quantity: 5 },
      ],
    });
    expect(created.ok, created.error).toBe(true);
    jobId = created.id!;
    jobNumber = created.number!;
  }, 60_000);

  afterAll(async () => {
    if (!db || !jobId) return;
    const { data: files } = await db.from("job_files").select("storage_path").eq("job_id", jobId);
    const paths = ((files ?? []) as { storage_path: string }[]).map((f) => f.storage_path);
    if (paths.length) await db.storage.from("job-files").remove(paths);
    await db.from("documents").delete().eq("order_id", jobId);
    await db.from("invoices").delete().eq("order_id", jobId);
    await db.from("emails").delete().eq("order_id", jobId);
    await db.from("commission_entries").delete().eq("order_id", jobId);
    await db.from("job_files").update({ replaced_by: null }).eq("job_id", jobId);
    await db.from("quotes").delete().eq("job_id", jobId);
    await db.from("orders").delete().eq("id", jobId);
    await db.from("audit_log").delete().gte("created_at", startedAt).in("entity", ["orders", "job_files", "quotes"]);
    // číselné řady vrátit, jen pokud mezitím nikdo jiný nepřidělil další číslo
    for (const t of COUNTERS) {
      const before = counters.get(t);
      const { data } = await db.from("doc_counters").select("counter").eq("doc_type", t).maybeSingle();
      const now = (data as { counter: number } | null)?.counter;
      if (now === undefined) continue;
      if (!before) {
        if (now === 1) await db.from("doc_counters").delete().eq("doc_type", t).eq("counter", 1);
      } else if (now === before.counter + 1) {
        await db.from("doc_counters").update(before).eq("doc_type", t).eq("counter", now);
      }
    }
    const api = loadEnv().LOCAL_MAIL_API ?? "http://127.0.0.1:54324";
    await fetch(`${api}/messages?to=${encodeURIComponent(MAIL_TO)}`, { method: "DELETE" }).catch(() => undefined);
  }, 60_000);

  it("potvrzení s položkou bez ceny → varování; po doplnění ceny PDF v1 a v2", async () => {
    const warn = await d.generateJobDocument(jobId, "potvrzeni");
    expect(warn.ok).toBe(false);
    expect(warn.unpriced).toBe(1);
    expect(warn.error).toMatch(/^1 položka nemá cenu/);

    const forced = await d.generateJobDocument(jobId, "potvrzeni", { force: true });
    expect(forced.ok, forced.error).toBe(true);

    const { data: items } = await db.from("order_items").select("id, drawing_number").eq("order_id", jobId).order("position");
    const rows = items as { id: string; drawing_number: string }[];
    const saved = await j.saveJobItems(jobId, [
      { id: rows[0].id, drawingNumber: "E2E-DOC-1", name: "Hřídel E2E", material: "C45", quantity: 10, unitPrice: 1000 },
      { id: rows[1].id, drawingNumber: "E2E-DOC-2", name: "Pouzdro E2E", quantity: 5, unitPrice: 500 },
    ]);
    expect(saved.ok, saved.error).toBe(true);
    expect(Number((await job()).value)).toBe(12_500);

    const res = await d.generateJobDocument(jobId, "potvrzeni", { note: "Dodání v jedné dávce." });
    expect(res.ok, res.error).toBe(true);
    const expected = jobNumber.replace(/^Z-/, "POT-");
    expect(res.number).toBe(expected);
    expect(res.filename).toBe(`Potvrzeni_objednavky_${expected}.pdf`);
    expect(res.version).toBe(2); // vynucené v1 + toto (stejný název = nová verze)
    confirmationFileId = res.fileId!;
    const f = await file(confirmationFileId);
    expect(f).toMatchObject({ kind: "potvrzeni", version: 2, archived: false, mime_type: "application/pdf", title: `Potvrzení objednávky ${expected}` });
    expect(pdfMagic(await download(f.storage_path as string))).toBe("%PDF");
    const { data: older } = await db.from("job_files").select("archived, replaced_by").eq("job_id", jobId).eq("kind", "potvrzeni").eq("version", 1).single();
    expect(older).toMatchObject({ archived: true, replaced_by: confirmationFileId });

    const { data: evs } = await db.from("job_events").select("message").eq("job_id", jobId).eq("type", "file");
    const messages = ((evs ?? []) as { message: string }[]).map((e) => e.message);
    expect(messages).toContain(`Vystaveno potvrzení objednávky ${expected} (PDF) — verze 2`);
    expect(messages.some((m) => m.startsWith("Nahrán dokument"))).toBe(false);
  }, 60_000);

  it("návrh e-mailu k potvrzení a odeslání s PDF → stav Potvrzená objednávka", async () => {
    const draft = await d.draftJobDocumentEmail(jobId, confirmationFileId);
    expect(draft.ok, draft.error).toBe(true);
    expect(draft.to).toBe(MAIL_TO);
    expect(draft.kind).toBe("potvrzeni");
    expect(draft.subject).toBe("Potvrzení objednávky č. PO-E2E-77 – MNástrojárna s.r.o.");
    expect(draft.body).toContain("děkujeme za Vaši objednávku č. PO-E2E-77 ze dne 20. 10. 2026");
    expect(draft.body).toContain("• Potvrzený termín dodání: 30. 11. 2026");
    expect(draft.body).toContain("Petr Obchodník");

    expect((await d.sendJobDocument(jobId, confirmationFileId, { to: "spatne", subject: "x", body: "y" })).error).toBe("Neplatná e-mailová adresa: spatne");
    expect((await d.sendJobDocument(jobId, confirmationFileId, { to: MAIL_TO, subject: " ", body: "y" })).error).toBe("Doplň předmět e-mailu.");
    expect((await d.sendJobDocument(jobId, "00000000-0000-0000-0000-000000000000", { to: MAIL_TO, subject: "x", body: "y" })).error).toBe("Dokument nenalezen.");

    const sent = await d.sendJobDocument(jobId, confirmationFileId, { to: MAIL_TO, subject: draft.subject!, body: draft.body! });
    expect(sent.ok, sent.error).toBe(true);
    expect(sent.emailId).toBeTruthy();

    const api = loadEnv().LOCAL_MAIL_API ?? "http://127.0.0.1:54324";
    const msg = await (await fetch(`${api}/messages/latest?to=${encodeURIComponent(MAIL_TO)}&wait=3000`)).json();
    expect(msg.subject).toBe(draft.subject);
    expect(msg.attachments).toEqual([expect.objectContaining({ contentType: "application/pdf", filename: expect.stringMatching(/^Potvrzeni_objednavky_POT-/) })]);

    const jj = await job();
    expect(jj.status).toBe("potvrzeno");
    expect(jj.confirmed_at).toBeTruthy();
    const { data: ev } = await db.from("job_events").select("message, data").eq("job_id", jobId).eq("type", "email").single();
    expect((ev as { message: string }).message).toBe(`Odesláno potvrzení objednávky ${jobNumber.replace(/^Z-/, "POT-")} na ${MAIL_TO}`);
    const { data: out } = await db.from("emails").select("direction, order_id, owner_id, subject").eq("id", sent.emailId!).single();
    expect(out).toMatchObject({ direction: "out", order_id: jobId, owner_id: "156c7996-b488-4c53-a3f5-e51dd004f4ad" });
  }, 60_000);

  it("nabídka: PDF k nabídce (storage_path), odeslání označí nabídku jako odeslanou", async () => {
    const q = await j.createJobQuote(jobId, {
      title: "Hřídel a pouzdro", validUntil: "2026-11-21", leadTimeDays: 21,
      items: [{ drawingNumber: "E2E-DOC-1", name: "Hřídel E2E", quantity: 10, unitPrice: 1000 }],
    });
    expect(q.ok, q.error).toBe(true);
    quoteId = q.id!;
    // #25: nabídku obchodníka musí před vystavením PDF k odeslání schválit super admin
    expect(q.needsApproval).toBe(true);
    const blocked = await d.generateJobDocument(jobId, "nabidka", { quoteId });
    expect(blocked).toMatchObject({ ok: false, code: "approval" });
    const { data: adminRow } = await db.from("profiles").select("id").eq("email", "admin@local.test").single();
    expect((await db.from("quotes").update({ approved_by: (adminRow as { id: string }).id }).eq("id", quoteId)).error).toBeNull();
    const res = await d.generateJobDocument(jobId, "nabidka", { quoteId });
    expect(res.ok, res.error).toBe(true);
    expect(res.number).toBe(q.number);
    const f = await file(res.fileId!);
    expect(f).toMatchObject({ kind: "nabidka", quote_id: quoteId });
    const { data: qq } = await db.from("quotes").select("storage_path").eq("id", quoteId).single();
    expect((qq as { storage_path: string }).storage_path).toBe(f.storage_path);

    const draft = await d.draftJobDocumentEmail(jobId, res.fileId!);
    expect(draft.subject).toBe(`Cenová nabídka ${q.number} – Hřídel a pouzdro`);
    expect(draft.body).toContain("• Platnost nabídky: do 21. 11. 2026");
    expect(draft.body).toContain("• Dodací lhůta: 3 týdny od potvrzení objednávky");

    const sent = await d.sendJobDocument(jobId, res.fileId!, { to: MAIL_TO, subject: draft.subject!, body: draft.body! });
    expect(sent.ok, sent.error).toBe(true);
    const { data: after } = await db.from("quotes").select("status, sent_at").eq("id", quoteId).single();
    expect(after).toMatchObject({ status: "odeslano" });
    expect((await job()).status).toBe("potvrzeno"); // stav zakázky se nevrací zpět

    expect((await d.generateJobDocument(jobId, "nabidka", { quoteId: "00000000-0000-0000-0000-000000000000" })).error).toBe("Nabídka k této zakázce nepatří.");
  }, 60_000);

  // A2 (sk. 2): DL bez dodávky už nevzniká — jediná cesta je „Zapsat dodání a dodací list" (delivery-notes /
  // closing-flow integrační testy); dřív Doklady vystavily DL „na celou zakázku" s vlastním číslem
  it("dodací list bez dodávky: odmítnuto s návodem, číslo z řady se nespotřebuje", async () => {
    const a = await d.generateJobDocument(jobId, "dodaci_list");
    expect(a.ok).toBe(false);
    expect(a.code).toBe("delivery");
    expect(a.error).toMatch(/Zapsat dodání a dodací list/);
    expect((await job()).delivery_note_number).toBeNull();
    const { data: files } = await db.from("job_files").select("id").eq("job_id", jobId).eq("kind", "dodaci_list");
    expect(files ?? []).toHaveLength(0);
  }, 60_000);

  it("faktura: číslo FV, evidence faktur s DPH, archiv dokladů, stav Vyfakturováno, e-mail se splatností", async () => {
    // review A2 #2: bez dodání faktura nevznikne (dřív Potvrzeno → Vyfakturováno bez jediného dodaného kusu)
    const early = await d.generateJobDocument(jobId, "faktura");
    expect(early).toMatchObject({ ok: false, code: "delivery" });
    expect((await job()).invoice_number).toBeNull();
    const { data: its } = await db.from("order_items").select("id, quantity").eq("order_id", jobId);
    for (const it of (its ?? []) as { id: string; quantity: number }[]) {
      const { error } = await db.from("order_items").update({ delivered_quantity: it.quantity }).eq("id", it.id);
      expect(error).toBeNull();
    }
    const res = await d.generateJobDocument(jobId, "faktura");
    expect(res.ok, res.error).toBe(true);
    expect(res.number).toMatch(/^FV-\d{4}-\d{3,}$/);
    invoiceNumber = res.number!;
    const jj = await job();
    expect(jj.invoice_number).toBe(invoiceNumber);
    expect(jj.status).toBe("fakturovano");

    const { data: inv } = await db.from("invoices").select("*, items:invoice_items(*)").eq("order_id", jobId).single();
    const invoice = inv as Record<string, unknown> & { items: unknown[] };
    expect(invoice).toMatchObject({ number: invoiceNumber, customer_id: CUSTOMER, status: "vystavena" });
    expect(Number(invoice.subtotal)).toBe(12_500);
    expect(Number(invoice.vat_amount)).toBe(2_625);
    expect(Number(invoice.total)).toBe(15_125);
    expect(invoice.items).toHaveLength(2);
    const { data: docs } = await db.from("documents").select("doc_type, number, invoice_id").eq("order_id", jobId);
    expect(docs).toEqual([{ doc_type: "faktura", number: invoiceNumber, invoice_id: invoice.id }]);

    const again = await d.generateJobDocument(jobId, "faktura");
    expect(again.number).toBe(invoiceNumber);
    const { data: invs } = await db.from("invoices").select("id").eq("order_id", jobId);
    expect(invs).toHaveLength(1);

    const draft = await d.draftJobDocumentEmail(jobId, again.fileId!);
    expect(draft.subject).toBe(`Faktura ${invoiceNumber} – MNástrojárna s.r.o. (objednávka č. PO-E2E-77)`);
    const body = draft.body!.replace(/ | /g, " ");
    expect(body).toContain("• Částka k úhradě: 15 125,00 Kč");
    expect(body).toMatch(/• Datum splatnosti: \d{1,2}\. \d{1,2}\. \d{4}/);
    expect(body).toContain(`• Variabilní symbol: ${invoiceNumber.replace(/\D/g, "")}`);
  }, 60_000);

  it("API náhled PDF ze zakázky + starší odkaz přesměruje", async () => {
    const route = await import("@/app/api/pdf/job/[id]/route");
    const call = (qs: string, id = jobId) => route.GET(new Request(`http://localhost/api/pdf/job/${id}${qs}`), { params: Promise.resolve({ id }) });

    const res = await call("?type=faktura");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(`inline; filename="Faktura_${invoiceNumber}.pdf"`);
    expect(pdfMagic(Buffer.from(await res.arrayBuffer()))).toBe("%PDF");
    for (const t of ["nabidka", "potvrzeni", "dodaci-list"]) {
      const r = await call(`?type=${t}${t === "nabidka" ? `&quoteId=${quoteId}` : ""}`);
      expect(r.status, t).toBe(200);
    }
    expect((await call("?type=xyz")).status).toBe(400);
    expect((await call("?type=faktura", "nope")).status).toBe(404);
    expect((await call("?type=faktura", "00000000-0000-0000-0000-000000000000")).status).toBe(404);
    expect((await call("?type=nabidka&quoteId=00000000-0000-0000-0000-000000000000")).status).toBe(404);
    const dl = await call("?type=dodaci-list&download=1");
    expect(dl.headers.get("content-disposition")).toMatch(/^attachment; filename="Dodaci_list_DL-/);

    const legacy = await import("@/app/api/pdf/order/[id]/route");
    const r = await legacy.GET(new Request(`http://localhost/api/pdf/order/${jobId}?type=dodaci-list`), { params: Promise.resolve({ id: jobId }) });
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toBe(`http://localhost/api/pdf/job/${jobId}?type=dodaci-list`);
  }, 60_000);
});
