import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { unzipSync, strFromU8 } from "fflate";
import { PDFDocument } from "pdf-lib";

/**
 * Faktury vydané ↔ lokální Supabase (tools/local-supabase): seznam za měsíc / rok, ZIP, sloučené PDF, CSV,
 * oprávnění (jen super admin / plný přístup — obchodník a zaměstnanec nic) a smazání stejnou cestou jako PDF
 * faktury v Dokumentech (release_job_invoice: číslo zpět do řady, stav zpět na „Dodáno zákazníkovi").
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/issued-invoices/issued-invoices.integration.test.ts
 * Pracuje s vlastními dočasnými zakázkami a vše po sobě uklidí.
 */

const ENABLED = process.env.LOCAL_SUPABASE === "1";
const CUSTOMER = "d2000000-0000-0000-0000-000000000001"; // Strojmetal a.s.
const COUNTERS = ["Z", "FV"];

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

type Who = { id: string; role: "super_admin" | "obchodnik" | "zamestnanec"; fullAccess?: boolean; canSeeMargins?: boolean };
const USERS = {
  admin: { id: "5ff3e3a5-29d4-4eba-845d-75b2fb8c5041", role: "super_admin" },
  full: { id: "4b27a72c-e981-4023-bab7-1e40adf303bd", role: "super_admin", fullAccess: true },
  sales: { id: "156c7996-b488-4c53-a3f5-e51dd004f4ad", role: "obchodnik" },
  staff: { id: "3053f44f-90ee-45d7-879f-ea7ad99ee275", role: "zamestnanec", canSeeMargins: true },
} satisfies Record<string, Who>;
const state: { who: Who } = { who: USERS.admin };

vi.mock("@/lib/auth/session", async () => {
  const perms = await import("@/lib/auth/permissions");
  const { NextResponse } = await import("next/server");
  const ctx = { aiEnabled: true, aiCaptureForAll: true, aiConfigured: false };
  const user = () => ({
    ...state.who, email: `${state.who.role}@local.test`, fullName: state.who.role, initials: "T", roleLabel: state.who.role,
    aiAccess: false, active: true, hasProfile: true, mustChangePassword: false,
  });
  const allowed = (f: import("@/lib/auth/permissions").Feature) => perms.can(user(), f, ctx);
  return {
    getSessionUser: async () => user(),
    getAccessContext: async () => ctx,
    getAccess: async () => ({ user: user(), ctx, features: perms.allowedFeatures(user(), ctx), can: allowed }),
    checkFeature: async (f: import("@/lib/auth/permissions").Feature) => (allowed(f) ? { user: user() } : { error: "K této akci nemáš oprávnění." }),
    apiRequire: async (f?: import("@/lib/auth/permissions").Feature) => (!f || allowed(f) ? { user: user() } : NextResponse.json({ error: "Bez oprávnění." }, { status: 403 })),
    requireUser: async () => user(),
    requireFeature: async (f: import("@/lib/auth/permissions").Feature) => {
      if (!allowed(f)) throw new Error(`redirect:/orders?pristup=${f}`);
      return user();
    },
  };
});

describe.skipIf(!ENABLED)("Faktury vydané ↔ lokální Supabase", () => {
  let db: SupabaseClient;
  const jobs: string[] = [];
  const counters = new Map<string, { year: number; counter: number } | null>();
  const startedAt = new Date(Date.now() - 1000).toISOString();
  let month = "";
  let lastMonth = "";
  let year = "";
  // A, B = tento měsíc (z aplikace), C = minulý měsíc, D = faktura mimo systém (bez PDF)
  const inv: Record<"A" | "B" | "C" | "D", { jobId: string; number: string; id: string }> = {} as never;

  async function makeJob(title: string, price: number): Promise<string> {
    const j = await import("@/app/actions/jobs");
    const created = await j.createJob({
      title, stage: "objednavka", customerId: CUSTOMER, orderDate: "2026-10-01",
      items: [{ drawingNumber: `E2E-FV-${title}`, name: `Díl ${title}`, quantity: 2, unitPrice: price }],
    });
    expect(created.ok, created.error).toBe(true);
    jobs.push(created.id!);
    const { data: its } = await db.from("order_items").select("id, quantity").eq("order_id", created.id!);
    for (const it of (its ?? []) as { id: string; quantity: number }[]) {
      await db.from("order_items").update({ delivered_quantity: it.quantity }).eq("id", it.id);
    }
    return created.id!;
  }

  async function issue(jobId: string): Promise<{ number: string; id: string }> {
    const d = await import("@/app/actions/job-documents");
    const res = await d.generateJobDocument(jobId, "faktura");
    expect(res.ok, res.error).toBe(true);
    const { data } = await db.from("invoices").select("id").eq("number", res.number!).single();
    return { number: res.number!, id: (data as { id: string }).id };
  }

  const as = (who: Who) => { state.who = who; };
  const route = async (kind: "zip" | "csv" | "pdf", obdobi: string, extra = "") => {
    const url = `http://localhost/api/${kind === "pdf" ? "pdf/issued-invoices" : `issued-invoices/${kind}`}?obdobi=${obdobi}${extra}`;
    const mod = kind === "zip" ? await import("@/app/api/issued-invoices/zip/route")
      : kind === "csv" ? await import("@/app/api/issued-invoices/csv/route")
      : await import("@/app/api/pdf/issued-invoices/route");
    return mod.GET(new Request(url));
  };

  beforeAll(async () => {
    const env = loadEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    for (const t of COUNTERS) {
      const { data } = await db.from("doc_counters").select("year, counter").eq("doc_type", t).maybeSingle();
      counters.set(t, (data as { year: number; counter: number } | null) ?? null);
    }
    const { todayIso } = await import("@/lib/jobs/mapping");
    const { periodKey, shiftPeriod, parsePeriod } = await import("./model");
    const today = todayIso();
    const cur = parsePeriod(today.slice(0, 7), today);
    month = periodKey(cur);
    lastMonth = periodKey(shiftPeriod(cur, -1));
    year = today.slice(0, 4);

    as(USERS.admin);
    for (const [k, price] of [["A", 1000], ["B", 2500], ["C", 400]] as const) {
      const jobId = await makeJob(k, price);
      inv[k] = { jobId, ...(await issue(jobId)) };
    }
    // C → minulý měsíc (datum vystavení i u zakázky)
    const lastDay = `${lastMonth}-15`;
    await db.from("invoices").update({ issue_date: lastDay, taxable_date: lastDay, due_date: `${lastMonth}-28` }).eq("id", inv.C.id);
    await db.from("orders").update({ invoice_date: lastDay }).eq("id", inv.C.jobId);
    // B zaplacená (vyrovnávající platba zakázky)
    await db.from("job_payments").insert({ job_id: inv.B.jobId, paid_on: `${month}-02`, amount: null, settles: true, recorded_by: USERS.admin.id });
    // D: faktura mimo systém (bez PDF) přes zápis údajů faktury
    const dJob = await makeJob("D", 700);
    const { setInvoiceInfoCore } = await import("@/lib/jobs/production-store");
    const extNo = `E2E-EXT-${Date.now()}`;
    const r = await setInvoiceInfoCore(db as never, USERS.admin.id, dJob, { invoiceNumber: extNo, invoiceDate: `${month}-03` });
    expect(r.ok, "error" in r ? r.error : "").toBe(true);
    const { data: dRow } = await db.from("invoices").select("id").eq("number", extNo).single();
    inv.D = { jobId: dJob, number: extNo, id: (dRow as { id: string }).id };
  }, 120_000);

  afterAll(async () => {
    if (!db) return;
    for (const jobId of jobs) {
      const { data: files } = await db.from("job_files").select("storage_path").eq("job_id", jobId);
      const paths = ((files ?? []) as { storage_path: string }[]).map((f) => f.storage_path).filter(Boolean);
      if (paths.length) await db.storage.from("job-files").remove(paths);
      await db.from("documents").delete().eq("order_id", jobId);
      await db.from("invoices").delete().eq("order_id", jobId);
      await db.from("job_payments").delete().eq("job_id", jobId);
      await db.from("commission_entries").delete().eq("order_id", jobId);
      await db.from("job_files").update({ replaced_by: null }).eq("job_id", jobId);
      await db.from("orders").delete().eq("id", jobId);
    }
    const { data: exports } = await db.storage.from("job-files").list(`exports/${USERS.admin.id}`);
    const ours = ((exports ?? []) as { name: string }[]).filter((f) => f.name.includes("Faktury_vydane_")).map((f) => `exports/${USERS.admin.id}/${f.name}`);
    if (ours.length) await db.storage.from("job-files").remove(ours);
    await db.from("audit_log").delete().gte("created_at", startedAt).in("entity", ["orders", "job_files", "invoices"]);
    // číselné řady vrátit, jen pokud mezitím nikdo jiný nepřidělil další číslo
    for (const t of COUNTERS) {
      const before = counters.get(t);
      if (!before) continue;
      const { data } = await db.from("doc_counters").select("counter").eq("doc_type", t).maybeSingle();
      const now = (data as { counter: number } | null)?.counter;
      if (now !== undefined && now > before.counter) {
        const ours = t === "FV" ? 3 : 4;
        if (now <= before.counter + ours) await db.from("doc_counters").update(before).eq("doc_type", t).eq("counter", now);
      }
    }
  }, 120_000);

  it("obchodník a zaměstnanec (i s maržemi) nevidí nic: data stránky, ZIP, PDF, CSV, smazání", async () => {
    const data = await import("@/lib/data/issued-invoices");
    const { deleteIssuedInvoice } = await import("@/app/actions/issued-invoices");
    const { parsePeriod } = await import("./model");
    for (const who of [USERS.sales, USERS.staff]) {
      as(who);
      expect(await data.listIssuedInvoices(parsePeriod(month, `${month}-10`))).toBeNull();
      for (const k of ["zip", "csv", "pdf"] as const) {
        const res = await route(k, month);
        expect(res.status, `${who.role} ${k}`).toBe(403);
        expect(res.headers.get("content-type")).toMatch(/json/);
      }
      const del = await deleteIssuedInvoice(inv.A.id);
      expect(del.ok).toBe(false);
      expect(del.error).toMatch(/oprávnění/);
      // stránka přesměruje (requireFeature)
      const page = await import("@/app/(app)/issued-invoices/page");
      await expect(page.default({ searchParams: Promise.resolve({ obdobi: month }) })).rejects.toThrow(/pristup=issued_invoices/);
    }
    const { data: still } = await db.from("invoices").select("id").eq("id", inv.A.id);
    expect(still ?? []).toHaveLength(1);
  }, 60_000);

  it("super admin: měsíc — faktury, PDF, stavy úhrady, součty; rok i minulý měsíc", async () => {
    as(USERS.admin);
    const data = await import("@/lib/data/issued-invoices");
    const { parsePeriod, totalsOf } = await import("./model");
    const res = await data.listIssuedInvoices(parsePeriod(month, `${month}-10`));
    expect(res).not.toBeNull();
    const mine = res!.items.filter((it) => jobs.includes(it.job?.id ?? ""));
    expect(mine.map((it) => it.number).sort()).toEqual([inv.A.number, inv.B.number, inv.D.number].sort());
    const a = mine.find((it) => it.number === inv.A.number)!;
    expect(a).toMatchObject({ net: 2000, vat: 420, gross: 2420, currency: "CZK", external: false, estimated: false });
    expect(a.customer?.name).toBe("Strojmetal a.s.");
    expect(a.file?.filename).toBe(`Faktura_${inv.A.number}.pdf`);
    expect(a.file?.generated).toBe(true);
    expect(["nezaplaceno", "po_splatnosti"]).toContain(a.payment.state);
    const b = mine.find((it) => it.number === inv.B.number)!;
    expect(b.payment).toMatchObject({ state: "zaplaceno", remaining: 0, paid: 6050 });
    const d = mine.find((it) => it.number === inv.D.number)!;
    expect(d).toMatchObject({ external: true, file: null });
    const t = totalsOf(mine);
    expect(t.byCurrency[0]).toMatchObject({ currency: "CZK", count: 3, net: 2000 + 5000 + d.net, gross: 2420 + 6050 + d.gross });
    expect(t.paidCount).toBe(1);
    expect(t.withoutPdf).toBe(1);

    const last = await data.listIssuedInvoices(parsePeriod(lastMonth, `${month}-10`));
    expect(last!.items.some((it) => it.number === inv.C.number)).toBe(true);
    expect(last!.items.some((it) => it.number === inv.A.number)).toBe(false);
    if (lastMonth.startsWith(year)) {
      const y = await data.listIssuedInvoices(parsePeriod(year, `${month}-10`));
      for (const k of ["A", "B", "C", "D"] as const) expect(y!.items.some((it) => it.number === inv[k].number), k).toBe(true);
    }
    // plný přístup = jako super admin
    as(USERS.full);
    expect((await data.listIssuedInvoices(parsePeriod(month, `${month}-10`)))?.items.some((it) => it.number === inv.A.number)).toBe(true);
    as(USERS.admin);
  }, 60_000);

  it("ZIP: každá faktura jako PDF pojmenované číslem + odběratelem, přehled CSV, CHYBI.txt", async () => {
    as(USERS.admin);
    const res = await route("zip", month);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="Faktury_vydane_${month}.zip"`);
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const names = Object.keys(files);
    for (const k of ["A", "B"] as const) {
      const name = `${inv[k].number}_Strojmetal_a.s.pdf`;
      expect(names, name).toContain(name);
      expect(strFromU8(files[name].subarray(0, 4))).toBe("%PDF");
    }
    expect(names.some((n) => n.startsWith(inv.D.number))).toBe(false); // bez PDF
    expect(strFromU8(files["CHYBI.txt"])).toContain(`${inv.D.number} (Strojmetal a.s.) — faktura nemá PDF`);
    const csvBytes = files[`Prehled_Faktury_vydane_${month}.csv`];
    expect([...csvBytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM (dekodér ho při čtení zahodí)
    const csv = strFromU8(csvBytes);
    expect(csv).toContain(`${inv.A.number};`);
    expect(names.some((n) => n.startsWith(inv.C.number))).toBe(false); // jiný měsíc
    const { data: audit } = await db.from("audit_log").select("diff").eq("action", "issued_invoices_export").gte("created_at", startedAt);
    expect((audit ?? []).some((r) => (r as { diff: { format: string } }).diff.format === "zip")).toBe(true);
  }, 60_000);

  it("sloučené PDF: všechny faktury měsíce v jednom (inline pro prohlížeč, ?download=1 ke stažení)", async () => {
    as(USERS.admin);
    const res = await route("pdf", month);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(`inline; filename="Faktury_vydane_${month}.pdf"`);
    const included = Number(res.headers.get("x-invoices-included"));
    expect(included).toBeGreaterThanOrEqual(2);
    const pdf = await PDFDocument.load(new Uint8Array(await res.arrayBuffer()));
    // každá faktura ≥ 1 strana + strana „bez PDF" (faktura D)
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(included + 1);
    const dl = await route("pdf", month, "&download=1");
    expect(dl.headers.get("content-disposition")).toBe(`attachment; filename="Faktury_vydane_${month}.pdf"`);
  }, 60_000);

  it("CSV: UTF-8 s BOM, středník, české částky", async () => {
    as(USERS.admin);
    const res = await route("csv", month);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    const line = text.split("\r\n").find((l) => l.startsWith(`${inv.A.number};`))!;
    expect(line).toContain(";Strojmetal a.s.;");
    expect(line).toContain(";2000,00;21;420,00;2420,00;CZK;");
    expect(text.split("\r\n").find((l) => l.startsWith(`${inv.B.number};`))).toContain(";Zaplaceno;");
  }, 60_000);

  it("smazání: stejná cesta jako PDF v Dokumentech — číslo zpět do řady, stav Dodáno, nová faktura stejné číslo", async () => {
    as(USERS.admin);
    const { deleteIssuedInvoice } = await import("@/app/actions/issued-invoices");
    // C byla vystavená poslední → číslo se uvolní
    const del = await deleteIssuedInvoice(inv.C.id);
    expect(del.ok, del.error).toBe(true);
    expect(del).toMatchObject({ number: inv.C.number, numberFree: true, stageReturned: true, filesDeleted: 1, jobId: inv.C.jobId });
    const { data: job } = await db.from("orders").select("invoice_number, invoice_date, status").eq("id", inv.C.jobId).single();
    expect(job).toMatchObject({ invoice_number: null, invoice_date: null, status: "dodano_zakaznikovi" });
    expect((await db.from("invoices").select("id").eq("number", inv.C.number)).data ?? []).toHaveLength(0);
    expect((await db.from("job_files").select("id").eq("job_id", inv.C.jobId).eq("kind", "faktura")).data ?? []).toHaveLength(0);
    const { data: ev } = await db.from("job_events").select("message").eq("job_id", inv.C.jobId).like("message", `Faktura ${inv.C.number} zrušena%`);
    expect(ev ?? []).toHaveLength(1);
    const { data: audit } = await db.from("audit_log").select("diff").eq("action", "issued_invoice_deleted").eq("entity_id", inv.C.id);
    expect(audit ?? []).toHaveLength(1);
    // nová faktura dostane totéž číslo
    const again = await issue(inv.C.jobId);
    expect(again.number).toBe(inv.C.number);
    inv.C = { ...inv.C, ...again };

    // A není poslední → číslo zůstane obsazené (díra v řadě), zakázka zpět na Dodáno
    const delA = await deleteIssuedInvoice(inv.A.id);
    expect(delA.ok, delA.error).toBe(true);
    expect(delA).toMatchObject({ number: inv.A.number, numberFree: false, stageReturned: true });

    // faktura mimo systém (bez PDF) → zrušena tímtéž RPC
    const delD = await deleteIssuedInvoice(inv.D.id);
    expect(delD.ok, delD.error).toBe(true);
    expect(delD).toMatchObject({ number: inv.D.number, filesDeleted: 0, numberFree: false });
    const { data: jd } = await db.from("orders").select("invoice_number").eq("id", inv.D.jobId).single();
    expect((jd as { invoice_number: string | null }).invoice_number).toBeNull();

    // smazaná faktura znovu → „nenalezena"
    const twice = await deleteIssuedInvoice(inv.A.id);
    expect(twice.ok).toBe(false);
    expect(twice.error).toMatch(/nenalezena/);
    // uhrazenou (invoices.status = uhrazena) smazat nejde
    await db.from("invoices").update({ status: "uhrazena" }).eq("id", inv.B.id);
    const paid = await deleteIssuedInvoice(inv.B.id);
    expect(paid.ok).toBe(false);
    expect(paid.error).toMatch(/uhrazen/);
    expect((await db.from("job_files").select("id").eq("job_id", inv.B.jobId).eq("kind", "faktura")).data ?? []).toHaveLength(1);
  }, 120_000);
});
