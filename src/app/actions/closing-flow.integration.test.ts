import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Konec toku (A2, beta 29. 10.) proti lokálnímu Supabase: dodací list → faktura (PDF, evidence,
 * Vyfakturováno) bez potvrzeného DL, jen po dodání všeho a jen jednou (souběh = jedno číslo, návrh e-mailu
 * nic nevystaví), faktura mimo systém (řádek bez PDF, ne cizí číslo, ne bez dodání),
 * jedna cesta platby (záloha nikdy nezmizí — ochrana triggeru), zaměstnanec fakturu nevystaví ani nepošle,
 * dodané zboží bez DL dostane DL i u zakázky s DL, zavřená chyba DL nenechá mezeru v řadě.
 *   LOCAL_SUPABASE=1 npx vitest run src/app/actions/closing-flow.integration.test.ts
 * Vlastní data (zakázky „E2E-A2I-"), na konci se uklidí.
 */

const ENABLED = process.env.LOCAL_SUPABASE === "1";
const TAG = Date.now().toString(36).toUpperCase();

const who = vi.hoisted(() => ({
  users: {} as Record<string, { id: string; email: string; fullName: string; role: "super_admin" | "obchodnik" | "zamestnanec" }>,
  current: "sales" as "sales" | "worker" | "admin",
  failRender: false,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

vi.mock("@/lib/supabase/server", async () => {
  const local = await import("@/test/local-supabase");
  const headers = await import("@/lib/supabase/actor-headers");
  const current = () => {
    const u = who.users[who.current];
    return headers.userActor(u ? { id: u.id } : null);
  };
  return {
    isSupabaseConfigured: () => true,
    hasServiceKey: () => true,
    createAdminClient: (opts: { actor?: unknown } = {}) => local.localAdmin((opts.actor as never) ?? headers.SYSTEM_ACTOR),
    createOperatorClient: async (opts: { actor?: unknown } = {}) => local.localAdmin(opts.actor !== undefined ? (opts.actor as never) : current()),
    createClient: async () => {
      throw new Error("Bez session (test).");
    },
  };
});

vi.mock("@/lib/auth/session", async () => {
  const perms = await import("@/lib/auth/permissions");
  const user = () => {
    const u = who.users[who.current];
    return { ...u, initials: "XX", roleLabel: u.role, aiAccess: true, active: true, hasProfile: true, mustChangePassword: false };
  };
  const can = (f: string) => perms.can(user(), f as never, perms.DEFAULT_ACCESS_CONTEXT);
  return {
    getSessionUser: async () => user(),
    getAccess: async () => ({ user: user(), ctx: perms.DEFAULT_ACCESS_CONTEXT, features: [], can }),
    checkFeature: async (f: string) => (can(f) ? { user: user() } : { error: "K této akci nemáš oprávnění." }),
    apiRequire: async () => ({ user: user() }),
    requireUser: async () => user(),
    requireFeature: async () => user(),
  };
});

vi.mock("@/lib/pdf/render", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/pdf/render")>();
  return {
    ...real,
    renderDeliveryNotePdf: async (...args: Parameters<typeof real.renderDeliveryNotePdf>) => {
      if (who.failRender) throw new Error("Simulovaná chyba PDF");
      return real.renderDeliveryNotePdf(...args);
    },
  };
});

type Row = Record<string, unknown>;

describe.skipIf(!ENABLED)("konec toku: DL → faktura → platba ↔ lokální Supabase", () => {
  let svc: SupabaseClient;
  let dn: typeof import("./delivery-notes");
  let docs: typeof import("./job-documents");
  let prod: typeof import("./production");
  let flow: typeof import("./flow-status");
  let customerId = "";
  const jobs: string[] = [];
  let n = 0;
  const as = (u: "sales" | "worker" | "admin") => { who.current = u; };
  const id = (u: "sales" | "worker" | "admin") => who.users[u].id;

  async function newJob(status: string, items: { qty: number; price: number | null }[], patch: Row = {}): Promise<{ id: string; items: string[] }> {
    n += 1;
    const { data, error } = await svc.from("orders").insert({
      number: `Z-E2E-A2I-${TAG}-${n}`, title: `E2E-A2I-${n}`, status: "potvrzeno", source: "manual", owner_id: id("sales"),
      created_by: id("sales"), customer_id: customerId, customer_order_number: `PO-A2I-${TAG}`, order_date: "2026-10-20",
      order_status: "potvrzena", order_revision: 1, value: 10_000, ...patch,
    }).select("id").single();
    if (error) throw new Error(error.message);
    const jobId = (data as { id: string }).id;
    jobs.push(jobId);
    const { data: it, error: iErr } = await svc.from("order_items").insert(items.map((x, i) => ({
      order_id: jobId, position: i, drawing_number: `VYK-A2I-${TAG}-${i}`, name: `Díl ${i + 1}`, quantity: x.qty, unit: "ks", unit_price: x.price,
    }))).select("id, position").order("position");
    if (iErr) throw new Error(iErr.message);
    if (status !== "potvrzeno") await svc.from("orders").update({ status }).eq("id", jobId);
    return { id: jobId, items: ((it ?? []) as { id: string }[]).map((r) => r.id) };
  }
  const order = async (jobId: string) => (await svc.from("orders").select("*").eq("id", jobId).single()).data as Row;
  const flowRow = async (jobId: string) => (await svc.from("job_flow_v").select("*").eq("id", jobId).single()).data as Row;
  const invoicesOf = async (jobId: string) => ((await svc.from("invoices").select("*").eq("order_id", jobId)).data ?? []) as Row[];
  const notesOf = async (jobId: string) => ((await svc.from("delivery_notes").select("*").eq("order_id", jobId).order("created_at")).data ?? []) as Row[];
  const payments = async (jobId: string) => ((await svc.from("job_payments").select("amount, settles, via").eq("job_id", jobId).order("paid_on").order("created_at")).data ?? []) as Row[];
  const counter = async (p: string) => ((await svc.from("doc_counters").select("counter").eq("doc_type", p).maybeSingle()).data as { counter: number } | null)?.counter ?? 0;

  beforeAll(async () => {
    const local = await import("@/test/local-supabase");
    const env = local.loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    svc = local.localAdmin();
    const { data } = await svc.from("profiles").select("id, email, full_name, role").in("email", [local.DEMO.sales.email, local.DEMO.worker.email, local.DEMO.admin.email]);
    for (const r of (data ?? []) as { id: string; email: string; full_name: string; role: "super_admin" | "obchodnik" | "zamestnanec" }[]) {
      const key = r.role === "super_admin" ? "admin" : r.role === "obchodnik" ? "sales" : "worker";
      who.users[key] = { id: r.id, email: r.email, fullName: r.full_name, role: r.role };
    }
    expect(Object.keys(who.users).sort()).toEqual(["admin", "sales", "worker"]);
    const { data: c, error } = await svc.from("customers").insert({
      name: `E2E-A2I-Kovo ${TAG} s.r.o.`, country: "CZ", owner_id: id("sales"), email: `e2e-a2i-${TAG.toLowerCase()}@local.test`,
      street: "Testovací 5", city: "Brno", zip: "602 00", ico: "87654321", payment_terms_days: 30,
    }).select("id").single();
    if (error) throw new Error(error.message);
    customerId = (c as { id: string }).id;
    dn = await import("./delivery-notes");
    docs = await import("./job-documents");
    prod = await import("./production");
    flow = await import("./flow-status");
  }, 60_000);

  afterAll(async () => {
    if (!svc) return;
    as("sales");
    who.failRender = false;
    for (const jobId of jobs) {
      const { data: files } = await svc.from("job_files").select("storage_path").eq("job_id", jobId);
      const paths = ((files ?? []) as { storage_path: string | null }[]).map((f) => f.storage_path).filter((x): x is string => Boolean(x));
      if (paths.length) await svc.storage.from("job-files").remove(paths);
      await svc.from("documents").delete().eq("order_id", jobId);
      await svc.from("delivery_notes").delete().eq("order_id", jobId);
      await svc.from("invoices").delete().eq("order_id", jobId);
      await svc.from("job_files").update({ replaced_by: null }).eq("job_id", jobId);
      await svc.from("orders").delete().eq("id", jobId);
      await svc.from("audit_log").delete().filter("diff->>jobId", "eq", jobId);
    }
    if (customerId) await svc.from("customers").delete().eq("id", customerId);
  }, 60_000);

  it("DL → faktura bez potvrzeného DL: PDF (FV), invoices + položky, Dokumenty, datum + splatnost i na zakázce, stav Vyfakturováno", async () => {
    as("sales");
    const j = await newJob("dodano_k_nam", [{ qty: 10, price: 100 }, { qty: 4, price: 250 }]);
    const res = await dn.recordDelivery(j.id, [{ itemId: j.items[0], from: 0, to: 10 }, { itemId: j.items[1], from: 0, to: 4 }], { issueNote: true });
    expect(res.ok, res.error).toBe(true);
    expect((await order(j.id)).status).toBe("dodano_zakaznikovi");
    expect((await order(j.id)).delivery_note_confirmed_at).toBeNull(); // potvrzený DL není podmínka
    const fv = await docs.generateJobDocument(j.id, "faktura", { reuse: true });
    expect(fv.ok, fv.error).toBe(true);
    expect(fv.number).toMatch(/^FV-/);
    const o = await order(j.id);
    expect(o).toMatchObject({ status: "fakturovano", invoice_number: fv.number, invoiced_by: id("sales") });
    const inv = await invoicesOf(j.id);
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ number: fv.number, status: "vystavena" });
    expect(String(inv[0].storage_path)).toMatch(/^zakazky\//);
    expect(Number(inv[0].subtotal)).toBe(2000);
    // splatnost: PDF / evidence = zakázka (zákazník 30 dní)
    expect(o.invoice_date).toBe(inv[0].issue_date);
    expect(o.invoice_due_date).toBe(inv[0].due_date);
    const { data: items } = await svc.from("invoice_items").select("id").eq("invoice_id", inv[0].id as string);
    expect(items ?? []).toHaveLength(2);
    const { data: file } = await svc.from("job_files").select("kind, origin, issuer").eq("id", fv.fileId!).single();
    expect(file).toEqual({ kind: "faktura", origin: "generated", issuer: "my" });
    // opětovné otevření dialogu (reuse) nevytvoří novou verzi ani číslo
    const counterFv = await counter("FV");
    const again = await docs.generateJobDocument(j.id, "faktura", { reuse: true });
    expect(again.fileId).toBe(fv.fileId);
    expect(await counter("FV")).toBe(counterFv);
    expect((await flowRow(j.id)).payment_key).toBe("ceka_na_uhradu");
  }, 90_000);

  // review A2 #4: „dílčí" faktura účtovala celou objednávku → z aplikace až po dodání všeho; faktura mimo
  // systém při dílčí dodávce jde zapsat (stav se neposune, splatnost se hlídá)
  it("dílčí dodávka: faktura z aplikace nevznikne (číslo se nespotřebuje); mimo systém ano, stav zůstane, „po splatnosti“ se hlídá", async () => {
    as("sales");
    const j = await newJob("ve_vyrobe", [{ qty: 10, price: 100 }, { qty: 4, price: 250 }]);
    const res = await dn.recordDelivery(j.id, [{ itemId: j.items[0], from: 0, to: 10 }], { issueNote: true });
    expect(res.ok, res.error).toBe(true);
    const c0 = await counter("FV");
    const fv = await docs.generateJobDocument(j.id, "faktura");
    expect(fv).toMatchObject({ ok: false, code: "delivery" });
    expect(fv.error).toMatch(/až bude dodáno vše/);
    expect(await counter("FV")).toBe(c0);
    expect(await invoicesOf(j.id)).toHaveLength(0);
    const draft = await docs.draftInvoiceEmail(j.id);
    expect(draft).toMatchObject({ ok: false, code: "delivery" });
    const ext = await prod.setInvoiceInfo(j.id, { invoiceNumber: `EXTP-${TAG}`, invoiceDate: "2026-09-01", invoiceDueDate: "2026-09-15" });
    expect(ext.ok, ext.error).toBe(true);
    const o = await order(j.id);
    expect(o.status).toBe("ve_vyrobe");
    expect((await flowRow(j.id)).payment_key).toBe("po_splatnosti");
    expect((await invoicesOf(j.id))[0]).toMatchObject({ number: `EXTP-${TAG}`, due_date: "2026-09-15", issue_date: "2026-09-01", storage_path: null });
  }, 90_000);

  // review A2 #1: znovuotevření dialogu / odkazu nevystaví fakturu znovu (nové datum by smazalo „po splatnosti")
  it("vystavená faktura: další vystavení vrátí stejné PDF — žádná nová verze, číslo ani datum; „po splatnosti“ zůstane", async () => {
    as("sales");
    const j = await newJob("dodano_k_nam", [{ qty: 2, price: 500 }]);
    expect((await dn.recordDelivery(j.id, [{ itemId: j.items[0], from: 0, to: 2 }], { issueNote: true })).ok).toBe(true);
    const fv = await docs.generateJobDocument(j.id, "faktura");
    expect(fv.ok, fv.error).toBe(true);
    expect(fv.existing).toBe(false);
    expect((await prod.setInvoiceInfo(j.id, { invoiceDate: "2026-09-01", invoiceDueDate: "2026-09-15" })).ok).toBe(true);
    expect((await flowRow(j.id)).payment_key).toBe("po_splatnosti");
    const c0 = await counter("FV");
    for (const opts of [undefined, { reuse: true }, { force: true }] as const) {
      const again = await docs.generateJobDocument(j.id, "faktura", opts);
      expect(again).toMatchObject({ ok: true, fileId: fv.fileId, number: fv.number, existing: true });
    }
    expect(await counter("FV")).toBe(c0);
    const { data: files } = await svc.from("job_files").select("version, archived").eq("job_id", j.id).eq("kind", "faktura");
    expect(files).toEqual([{ version: 1, archived: false }]);
    expect(await order(j.id)).toMatchObject({ invoice_date: "2026-09-01", invoice_due_date: "2026-09-15" });
    expect((await invoicesOf(j.id))[0]).toMatchObject({ issue_date: "2026-09-01", due_date: "2026-09-15" });
    expect((await flowRow(j.id)).payment_key).toBe("po_splatnosti");
    // návrh e-mailu = poslat znovu (existující PDF)
    const draft = await docs.draftInvoiceEmail(j.id);
    expect(draft.ok, draft.error).toBe(true);
    expect(draft.existing).toMatchObject({ fileId: fv.fileId, number: fv.number });
    expect(draft.subject).toContain(fv.number!);
    // výslovné nové PDF téže faktury (reissue): stejné číslo, datum a splatnost zůstanou
    const re = await docs.generateJobDocument(j.id, "faktura", { reissue: true });
    expect(re).toMatchObject({ ok: true, number: fv.number, existing: false });
    expect(await counter("FV")).toBe(c0);
    expect((await invoicesOf(j.id))[0]).toMatchObject({ issue_date: "2026-09-01", due_date: "2026-09-15" });
    const { data: docRows } = await svc.from("documents").select("id").eq("order_id", j.id).eq("doc_type", "faktura");
    expect(docRows ?? []).toHaveLength(1);
  }, 90_000);

  // review A2 #2: bez dodání žádná faktura (ani přes Doklady / /documents / ?akce, ani mimo systém)
  it("bez dodání: faktura z aplikace ani mimo systém nevznikne, stav se nepohne (Ve výrobě, Potvrzeno, Poptávka)", async () => {
    as("sales");
    for (const st of ["ve_vyrobe", "potvrzeno", "poptavka"]) {
      const j = await newJob(st, [{ qty: 3, price: 100 }]);
      const c0 = await counter("FV");
      const fv = await docs.generateJobDocument(j.id, "faktura", { force: true });
      expect(fv).toMatchObject({ ok: false, code: "delivery" });
      expect(fv.error).toMatch(/po dodání/);
      expect(await counter("FV")).toBe(c0);
      const ext = await prod.setInvoiceInfo(j.id, { invoiceNumber: `EXTN-${TAG}-${st}`, invoiceDate: "2026-10-25" });
      expect(ext.ok).toBe(false);
      expect(ext.error).toMatch(/po dodání/);
      expect(await order(j.id)).toMatchObject({ status: st, invoice_number: null });
      expect(await invoicesOf(j.id)).toHaveLength(0);
    }
  }, 90_000);

  // review A2 #3: dvě souběžná vystavení (dvě záložky, dva uživatelé) = jedna faktura, jedno číslo
  it("souběh dvou vystavení: jedno číslo FV, jeden řádek evidence i archivu dokladů", async () => {
    as("sales");
    for (let round = 0; round < 3; round++) {
      const j = await newJob("dodano_zakaznikovi", [{ qty: 1, price: 800 }]);
      const c0 = await counter("FV");
      const [a, b] = await Promise.all([
        docs.generateJobDocument(j.id, "faktura", { reuse: true }),
        docs.generateJobDocument(j.id, "faktura", { reuse: true }),
      ]);
      expect(a.ok, a.error).toBe(true);
      expect(b.ok, b.error).toBe(true);
      expect(a.number).toBe(b.number);
      expect(await counter("FV")).toBe(c0 + 1);
      expect((await invoicesOf(j.id)).map((x) => x.number)).toEqual([a.number]);
      expect((await order(j.id)).invoice_number).toBe(a.number);
      const { data: docRows } = await svc.from("documents").select("id").eq("order_id", j.id).eq("doc_type", "faktura");
      expect(docRows ?? []).toHaveLength(1);
      const { data: live } = await svc.from("job_files").select("id").eq("job_id", j.id).eq("kind", "faktura").eq("archived", false);
      expect(live ?? []).toHaveLength(1);
    }
  }, 120_000);

  // review A2 #5: otevření dialogu (návrh e-mailu) nic nevystaví — „Zrušit" je opravdu zrušení
  it("návrh e-mailu před vystavením: značka čísla, nic se nevystaví (číslo, evidence, PDF, stav)", async () => {
    as("sales");
    const j = await newJob("dodano_zakaznikovi", [{ qty: 2, price: 1500 }]);
    const c0 = await counter("FV");
    const d = await docs.draftInvoiceEmail(j.id);
    expect(d.ok, d.error).toBe(true);
    expect(d.existing).toBeNull();
    expect(d.subject).toContain("[číslo faktury]");
    expect(d.body).toContain("[číslo faktury]");
    expect(d.body).toContain("Variabilní symbol: [variabilní symbol]");
    expect(d.to).toBe(`e2e-a2i-${TAG.toLowerCase()}@local.test`);
    expect(d.unpriced).toBe(0);
    expect(await counter("FV")).toBe(c0);
    expect(await order(j.id)).toMatchObject({ status: "dodano_zakaznikovi", invoice_number: null, invoice_date: null });
    expect(await invoicesOf(j.id)).toHaveLength(0);
    const { data: f } = await svc.from("job_files").select("id").eq("job_id", j.id).eq("kind", "faktura");
    expect(f ?? []).toHaveLength(0);
    as("worker");
    try {
      expect(await docs.draftInvoiceEmail(j.id)).toMatchObject({ ok: false, code: "rights" });
    } finally {
      as("sales");
    }
  }, 60_000);

  // beta 30. 10.: faktura po záloze — „Uhrazeno zálohou…", „Zbývá uhradit" v PDF i e-mailu; bez účtu varování
  it("záloha 3 000 bez DPH: faktura i e-mail „Zbývá uhradit 26 620“, rekapitulace DPH za celé plnění; bez účtu varování", async () => {
    as("sales");
    const j = await newJob("dodano_k_nam", [{ qty: 5, price: 3000 }, { qty: 10, price: 1000 }]);
    const res = await dn.recordDelivery(j.id, [{ itemId: j.items[0], from: 0, to: 5 }, { itemId: j.items[1], from: 0, to: 10 }], { issueNote: true });
    expect(res.ok, res.error).toBe(true);
    const dep = await flow.recordJobPayment(j.id, { date: "2026-10-12", amount: 3_000 });
    expect(dep.ok, dep.error).toBe(true);
    const flatText = (s: string) => s.replace(/[\s  ]+/g, " ");
    const d = await docs.draftInvoiceEmail(j.id);
    expect(d.ok, d.error).toBe(true);
    const body = flatText(d.body ?? "");
    expect(body).toContain("• Celkem s DPH: 30 250,00 Kč");
    expect(body).toContain("• Uhrazeno (zálohy a platby): 3 630,00 Kč");
    expect(body).toContain("• Zbývá uhradit: 26 620,00 Kč");
    // lokální Nastavení nemá bankovní účet ani IBAN → varování před vystavením
    const { data: bank } = await svc.from("integration_settings").select("key, value").in("key", ["company_bank_account", "company_iban"]);
    if (!((bank ?? []) as { value: string | null }[]).some((r) => r.value?.trim())) {
      expect(d.bankWarning).toBe("Faktura bude bez QR a čísla účtu — doplň bankovní účet v Nastavení → Firemní údaje.");
    }
    const fv = await docs.generateJobDocument(j.id, "faktura");
    expect(fv.ok, fv.error).toBe(true);
    const { data: file } = await svc.from("job_files").select("storage_path").eq("id", fv.fileId!).single();
    const { data: blob, error: dlErr } = await svc.storage.from("job-files").download((file as { storage_path: string }).storage_path);
    expect(dlErr).toBeNull();
    // text PDF jen testovým pomocníkem (pdf.js) — samotné akce nic nevykreslují
    const { pdfText } = await import("@/test/pdf-text");
    const text = await pdfText(await blob!.arrayBuffer());
    const squash = (s: string) => s.replace(/[\s  ]+/g, "");
    expect(squash(text)).toContain(squash("Uhrazeno zálohou 12. 10. 2026"));
    expect(squash(text)).toContain(squash("Zbývá uhradit26 620,00 Kč"));
    expect(squash(text)).toContain(squash("21 %25 000,00 Kč5 250,00 Kč30 250,00 Kč"));
    // evidence faktur = celé zdanitelné plnění (záloha není daňový doklad)
    expect(Number((await invoicesOf(j.id))[0].total)).toBe(30250);
    // e-mail k vystavené faktuře: stále zbytek
    const again = await docs.draftInvoiceEmail(j.id);
    expect(flatText(again.body ?? "")).toContain("• Zbývá uhradit: 26 620,00 Kč");
    expect(again.bankWarning ?? null).toBeNull();
  }, 90_000);

  // review A2 #6: obecná úprava zakázky čísla dokladů nepřepíše (zaměstnanec ani obchodník)
  it("updateJob nezapíše číslo faktury ani DL (jediná cesta: Vystavit fakturu / mimo systém / zápis dodání)", async () => {
    const { updateJob } = await import("./jobs");
    const j = await newJob("dodano_zakaznikovi", [{ qty: 1, price: 900 }]);
    for (const u of ["worker", "sales"] as const) {
      as(u);
      const r = await updateJob(j.id, { invoiceNumber: `W-${TAG}`, deliveryNoteNumber: `WDL-${TAG}` } as never);
      expect(r.ok, r.error).toBe(true);
      expect(await order(j.id)).toMatchObject({ invoice_number: null, delivery_note_number: null });
    }
    as("sales");
    expect((await flowRow(j.id)).payment_key).toBeNull();
    const fv = await docs.generateJobDocument(j.id, "faktura");
    expect(fv.ok, fv.error).toBe(true);
    expect(fv.number).toMatch(/^FV-\d{4}-\d{3,}$/);
  }, 60_000);

  // review A2 #7: číslo faktury jiné zakázky se nepřevezme; faktura mimo systém má DPH
  it("mimo systém: číslo cizí zakázky odmítne; nová má základ, sazbu DPH a celkem s DPH", async () => {
    as("sales");
    const a = await newJob("dodano_zakaznikovi", [{ qty: 1, price: 900 }]);
    const fa = await docs.generateJobDocument(a.id, "faktura");
    expect(fa.ok, fa.error).toBe(true);
    const b = await newJob("dodano_zakaznikovi", [{ qty: 1, price: 900 }]);
    const steal = await prod.setInvoiceInfo(b.id, { invoiceNumber: fa.number! });
    expect(steal.ok).toBe(false);
    expect(steal.error).toBe(`Faktura ${fa.number} už patří zakázce Z-E2E-A2I-${TAG}-${n - 1}.`);
    expect(await order(b.id)).toMatchObject({ invoice_number: null, status: "dodano_zakaznikovi" });
    const ok = await prod.setInvoiceInfo(b.id, { invoiceNumber: `EXTV-${TAG}`, invoiceDate: "2026-10-25" });
    expect(ok.ok, ok.error).toBe(true);
    const inv = (await invoicesOf(b.id))[0];
    expect(Number(inv.subtotal)).toBe(10_000);
    expect([0, 21]).toContain(Number(inv.vat_rate));
    expect(Number(inv.total)).toBeCloseTo(Number(inv.subtotal) + Number(inv.vat_amount), 2);
    expect(Number(inv.vat_amount)).toBeCloseTo(Number(inv.subtotal) * Number(inv.vat_rate) / 100, 2);
    // a vystavit fakturu z aplikace k zakázce s fakturou mimo systém nejde (druhá faktura)
    const second = await docs.generateJobDocument(b.id, "faktura");
    expect(second).toMatchObject({ ok: false, code: "invoiced" });
  }, 60_000);

  // review A2 #9: naše faktura je pro zaměstnance zamčená (PDF ani odeslání)
  it("zaměstnanec: PDF naší faktury v kartě zamčené (price), DL ne", async () => {
    as("sales");
    const j = await newJob("dodano_k_nam", [{ qty: 1, price: 900 }]);
    expect((await dn.recordDelivery(j.id, [{ itemId: j.items[0], from: 0, to: 1 }], { issueNote: true })).ok).toBe(true);
    const fv = await docs.generateJobDocument(j.id, "faktura");
    expect(fv.ok, fv.error).toBe(true);
    const { getJob } = await import("@/lib/data/jobs");
    as("worker");
    try {
      const job = await getJob(j.id);
      const inv = job!.files.find((f) => f.id === fv.fileId);
      expect(inv?.locked).toBe("price");
      expect(job!.files.find((f) => f.kind === "dodaci_list")?.locked ?? null).toBeNull();
      expect(job!.deliveryNotes?.map((x) => x.number)).toHaveLength(1);
    } finally {
      as("sales");
    }
    const mine = await getJob(j.id);
    expect(mine!.files.find((f) => f.id === fv.fileId)?.locked ?? null).toBeNull();
  }, 60_000);

  // review A2 #13: vyfocený náš DL → delivery_notes (žádný druhý DL „na dodané zboží")
  it("vyfocený náš DL: řádek delivery_notes s položkami; stejné číslo podruhé nic nepřidá", async () => {
    as("sales");
    const { recordCapturedDeliveryNote, documentedQuantities } = await import("@/lib/jobs/delivery-notes-db");
    const j = await newJob("dodano_k_nam", [{ qty: 5, price: 100 }]);
    await svc.from("order_items").update({ delivered_quantity: 5 }).eq("id", j.items[0]);
    const lines = [{ itemId: j.items[0], description: "Díl 1", quantity: 5, unit: "ks" }];
    const path = `zakazky/${j.id}/foto-dl-${TAG}.jpg`;
    expect(await recordCapturedDeliveryNote(svc as never, j.id, { number: `DLF-${TAG}`, storagePath: path, issueDate: "2026-10-20", lines })).toBe("created");
    expect(await recordCapturedDeliveryNote(svc as never, j.id, { number: `DLF-${TAG}`, storagePath: path, lines })).toBe("exists");
    expect(await recordCapturedDeliveryNote(svc as never, j.id, { number: null, storagePath: path, lines })).toBe("skipped");
    const notes = await notesOf(j.id);
    expect(notes.map((x) => [x.number, x.issue_date])).toEqual([[`DLF-${TAG}`, "2026-10-20"]]);
    expect(Object.fromEntries((await documentedQuantities(svc as never, j.id))!)).toEqual({ [j.items[0]]: 5 });
  }, 60_000);

  it("faktura vystavená mimo systém: číslo + splatnost → řádek evidence bez PDF, Vyfakturováno; přejmenování opraví týž řádek", async () => {
    as("sales");
    const j = await newJob("dodano_zakaznikovi", [{ qty: 1, price: 5000 }]);
    const r = await prod.setInvoiceInfo(j.id, { invoiceNumber: `EXT-${TAG}`, invoiceDate: "2026-10-25" });
    expect(r.ok, r.error).toBe(true);
    expect(r).toMatchObject({ stage: "fakturovano", invoiceDueDate: "2026-11-24" }); // 30 dní dle zákazníka
    let inv = await invoicesOf(j.id);
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ number: `EXT-${TAG}`, storage_path: null, issue_date: "2026-10-25", due_date: "2026-11-24", status: "vystavena" });
    // review A2 #7: základ = hodnota zakázky (bez DPH), celkem = základ + DPH výchozí sazby
    expect(Number(inv[0].subtotal)).toBe(10_000);
    expect(Number(inv[0].total)).toBeCloseTo(10_000 + Number(inv[0].vat_amount), 2);
    const fix = await prod.setInvoiceInfo(j.id, { invoiceNumber: `EXT2-${TAG}` });
    expect(fix.ok, fix.error).toBe(true);
    inv = await invoicesOf(j.id);
    expect(inv.map((x) => x.number)).toEqual([`EXT2-${TAG}`]);
  }, 60_000);

  it("platba: jedna cesta „Zadat platbu“; přímý zápis úhrady (stará „Zaplaceno“) zálohu NESMAŽE, zrušení ji nechá", async () => {
    as("sales");
    const j = await newJob("fakturovano", [{ qty: 1, price: 10_000 }], { invoice_number: `FV-A2I-${TAG}`, invoice_date: "2026-10-20" });
    const dep = await flow.recordJobPayment(j.id, { date: "2026-10-10", amount: 3_000 });
    expect(dep).toMatchObject({ ok: true, stage: "fakturovano", paymentState: "castecne_zaplaceno" });
    // obejití dialogu (markJobPaid / psql): celá částka 10 000 → doplatek 7 000, záloha zůstane
    const paid = await prod.markJobPaid(j.id, { date: "2026-10-22", amount: 10_000 });
    expect(paid).toMatchObject({ ok: true, stage: "dokonceno" });
    expect((await payments(j.id)).map((p) => [Number(p.amount), p.settles, p.via === "automaticky"])).toEqual([[3000, false, false], [7000, true, true]]);
    expect(await order(j.id)).toMatchObject({ paid_at: "2026-10-22", paid_so_far: 10000 });
    // zrušení úhrady zápisem do zakázky → zmizí jen automatický doplatek
    const un = await prod.unmarkJobPaid(j.id);
    expect(un).toMatchObject({ ok: true, stage: "fakturovano" });
    expect((await payments(j.id)).map((p) => [Number(p.amount), p.settles])).toEqual([[3000, false]]);
    expect(await order(j.id)).toMatchObject({ paid_at: null, paid_so_far: 3000 });
    // přímo v DB (psql / úklid): paid_at bez částky → vyrovnání „zbytkem“, záloha zůstane
    await svc.from("orders").update({ paid_at: "2026-10-23" }).eq("id", j.id);
    const rows = await payments(j.id);
    expect(rows.map((p) => [p.amount === null ? null : Number(p.amount), p.settles])).toEqual([[3000, false], [null, true]]);
    // doplatek dialogem „Zadat platbu" (vyrovnává) → Dokončeno
    await svc.from("orders").update({ paid_at: null }).eq("id", j.id);
    const settle = await flow.recordJobPayment(j.id, { date: "2026-10-24", amount: 7_000, settles: true });
    expect(settle).toMatchObject({ ok: true, stage: "dokonceno", paymentState: "zaplaceno" });
    expect((await payments(j.id)).filter((p) => p.amount !== null).map((p) => Number(p.amount))).toEqual([3000, 7000]);
  }, 60_000);

  it("zaměstnanec: fakturu nevystaví (ani přes Doklady / Dokumenty), nepošle, nezapíše ani nenavrhne e-mail", async () => {
    as("sales");
    const j = await newJob("dodano_zakaznikovi", [{ qty: 2, price: 500 }]);
    const fv = await docs.generateJobDocument(j.id, "faktura");
    expect(fv.ok, fv.error).toBe(true);
    as("worker");
    try {
      const counterFv = await counter("FV");
      const w = await docs.generateJobDocument(j.id, "faktura", { force: true });
      expect(w).toMatchObject({ ok: false, code: "rights" });
      expect(w.error).toMatch(/Fakturu vystavuje a posílá obchodník nebo super admin/);
      expect(await counter("FV")).toBe(counterFv);
      const send = await docs.sendJobDocument(j.id, fv.fileId!, { to: "x@local.test", subject: "Faktura", body: "…" });
      expect(send.ok).toBe(false);
      expect(send.error).toMatch(/obchodník nebo super admin/);
      const draft = await docs.draftJobDocumentEmail(j.id, fv.fileId!);
      expect(draft.ok).toBe(false);
      expect((await prod.setInvoiceInfo(j.id, { invoiceNumber: "X-1" })).error).toBe("K této akci nemáš oprávnění.");
      expect((await flow.recordJobPayment(j.id, { amount: 1 })).error).toBe("K této akci nemáš oprávnění.");
      // DL dál smí (bez cen)
      const k = await newJob("dodano_k_nam", [{ qty: 1, price: 900 }]);
      const dl = await dn.recordDelivery(k.id, [{ itemId: k.items[0], from: 0, to: 1 }], { issueNote: true });
      expect(dl.ok, dl.error).toBe(true);
    } finally {
      as("sales");
    }
  }, 90_000);

  it("DL: bez dodávky nevznikne (číslo se nespotřebuje); dodávka bez DL u zakázky s DL → „DL na dodané zboží“ jen na chybějící kusy", async () => {
    as("sales");
    const j = await newJob("dodano_k_nam", [{ qty: 10, price: 100 }, { qty: 4, price: 250 }]);
    const c0 = await counter("DL");
    const none = await docs.generateJobDocument(j.id, "dodaci_list");
    expect(none).toMatchObject({ ok: false, code: "delivery" });
    expect(await counter("DL")).toBe(c0);
    // 1. dodávka bez DL (nezaškrtnuté), 2. dodávka s DL → DL má pořadí „2."
    expect((await dn.recordDelivery(j.id, [{ itemId: j.items[0], from: 0, to: 6 }], { issueNote: false })).ok).toBe(true);
    const second = await dn.recordDelivery(j.id, [{ itemId: j.items[0], from: 6, to: 10 }], { issueNote: true });
    expect(second.ok, second.error).toBe(true);
    expect(second.deliveryNote!.label).toBe("2. dílčí dodávka");
    const { data: lines } = await svc.from("delivery_note_items").select("order_item_id, quantity").eq("delivery_note_id", second.deliveryNote!.id);
    expect((lines ?? []).map((l) => [(l as Row).order_item_id, Number((l as Row).quantity)])).toEqual([[j.items[0], 4]]);
    // Doklady → „DL na dodané zboží": jen 6 ks z 1. dodávky (ne znovu 10), vlastní označení
    const catchUp = await docs.generateJobDocument(j.id, "dodaci_list");
    expect(catchUp.ok, catchUp.error).toBe(true);
    expect(catchUp.number).not.toBe(second.deliveryNote!.number);
    const notes = await notesOf(j.id);
    expect(notes).toHaveLength(2);
    const { data: cl } = await svc.from("delivery_note_items").select("quantity").eq("delivery_note_id", notes[1].id as string);
    expect((cl ?? []).map((l) => Number((l as Row).quantity))).toEqual([6]);
    const { data: f } = await svc.from("job_files").select("title").eq("id", catchUp.fileId!).single();
    expect((f as Row).title).toBe(`Dodací list ${catchUp.number} · dříve dodané zboží`);
    // vše zdokumentováno → Doklady jen stáhne poslední DL, nové číslo nevznikne
    const c1 = await counter("DL");
    const latest = await docs.generateJobDocument(j.id, "dodaci_list");
    expect(latest.ok).toBe(true);
    expect(await counter("DL")).toBe(c1);
    expect((await notesOf(j.id))).toHaveLength(2);
    // karta (getJob) zná zdokumentované množství po položkách
    const { getJob } = await import("@/lib/data/jobs");
    const job = await getJob(j.id);
    expect(job!.deliveryDocumented).toEqual({ [j.items[0]]: 10 });
  }, 90_000);

  it("chyba DL, obrazovka zavřena bez opakování → další DL zakázky převezme rezervované číslo (řada bez mezer)", async () => {
    as("sales");
    const j = await newJob("dodano_k_nam", [{ qty: 10, price: 100 }]);
    who.failRender = true;
    const failed = await dn.recordDelivery(j.id, [{ itemId: j.items[0], from: 0, to: 3 }], { issueNote: true });
    who.failRender = false;
    expect(failed.ok).toBe(false);
    expect(failed.recorded).toBe(true);
    // věta chyby vždy končí tečkou před výzvou „Zkus…"
    expect(failed.error).toMatch(/Simulovaná chyba PDF\. Zkus „Vystavit dodací list znovu“/);
    const reserved = failed.retry!.number!;
    const c0 = await counter("DL");
    const next = await dn.recordDelivery(j.id, [{ itemId: j.items[0], from: 3, to: 5 }], { issueNote: true });
    expect(next.ok, next.error).toBe(true);
    expect(next.deliveryNote!.number).toBe(reserved);
    expect(await counter("DL")).toBe(c0); // žádné nové číslo
    const notes = await notesOf(j.id);
    expect(notes.map((x) => x.number)).toEqual([reserved]);
    expect(String(notes[0].storage_path)).toMatch(/^zakazky\//);
    // 3 ks z neúspěšné dodávky zůstaly bez DL → Doklady je nabídnou
    const catchUp = await docs.generateJobDocument(j.id, "dodaci_list");
    expect(catchUp.ok, catchUp.error).toBe(true);
    expect(catchUp.number).not.toBe(reserved);
    const { data: cl } = await svc.from("delivery_note_items").select("quantity").eq("delivery_note_id", (await notesOf(j.id))[1].id as string);
    expect((cl ?? []).map((l) => Number((l as Row).quantity))).toEqual([3]);
  }, 90_000);
});
