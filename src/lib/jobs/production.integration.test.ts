import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { daysBetween } from "./production";
import { todayIso } from "./mapping";

/**
 * E2E akcí výroby proti lokálnímu Supabase (tools/local-supabase): šablona postupu
 * → operace u dodavatelů a u nás → posun stavů (navazující operace, souhrn
 * orders.production_*, zakázka → Ve výrobě) → domluvy → potvrzený dodací list →
 * faktura se splatností → zaplaceno → Dokončeno. Mockuje se jen přihlášení
 * a revalidace Next.js. Spuštění:
 *   LOCAL_SUPABASE=1 npx vitest run src/lib/jobs/production.integration.test.ts
 * Pracuje s demo zakázkou Z-2026-104 a vše po sobě vrátí.
 */

const ENABLED = process.env.LOCAL_SUPABASE === "1";
const JOB = "d0000000-0000-0000-0000-000000000004"; // Z-2026-104, objednávka, zákazník se splatností 45 dní
const HRUBY = "d4000000-0000-0000-0000-000000000001";
const TEPKAL = "d4000000-0000-0000-0000-000000000002";
const COAT = "d4000000-0000-0000-0000-000000000003";

const perms = vi.hoisted(() => ({ deny: new Set<string>() }));

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
    mustChangePassword: false,
  };
  const can = (f: string) => !perms.deny.has(f);
  return {
    getSessionUser: async () => user,
    getAccess: async () => ({ user, ctx: {}, features: [], can }),
    checkFeature: async (f: string) => (can(f) ? { user } : { error: "K této akci nemáš oprávnění." }),
    apiRequire: async () => ({ user }),
    requireUser: async () => user,
    requireFeature: async () => user,
  };
});

type Actions = typeof import("@/app/actions/production");
type Data = typeof import("@/lib/data/production");
type OpRow = { id: string; position: number; kind: string; status: string; in_house: boolean; supplier_id: string | null; supplier_name: string | null; note: string | null; planned_end: string | null; started_at: string | null; finished_at: string | null; created_by: string | null };

describe.skipIf(!ENABLED)("akce výroby ↔ lokální Supabase (E2E)", () => {
  let db: SupabaseClient;
  let a: Actions;
  let data: Data;
  let snapshot: Record<string, unknown>;
  let adminId = "";
  const startedAt = new Date(Date.now() - 1000).toISOString();
  const fileIds: string[] = [];
  const ids: Record<string, string> = {};

  async function job() {
    const { data: j } = await db.from("orders").select("*").eq("id", JOB).single();
    return j as Record<string, unknown>;
  }

  async function ops(): Promise<OpRow[]> {
    const { data: r } = await db.from("job_operations").select("*").eq("job_id", JOB).order("position").order("created_at");
    return (r ?? []) as OpRow[];
  }

  async function op(id: string): Promise<OpRow> {
    const { data: r } = await db.from("job_operations").select("*").eq("id", id).single();
    return r as OpRow;
  }

  async function events() {
    const { data: r } = await db.from("job_events").select("type, message, data, created_at").eq("job_id", JOB).gte("created_at", startedAt).order("created_at");
    return (r ?? []) as { type: string; message: string; data: Record<string, unknown> }[];
  }

  beforeAll(async () => {
    const env = loadEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    snapshot = await job();
    expect(snapshot.status).toBe("objednavka");
    expect((await ops()).length).toBe(0);
    const { data: adm } = await db.from("profiles").select("id").eq("role", "super_admin").limit(1).single();
    adminId = (adm as { id: string }).id;
    a = await import("@/app/actions/production");
    data = await import("@/lib/data/production");
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    perms.deny.clear();
    await db.from("job_operations").delete().eq("job_id", JOB).gte("created_at", startedAt);
    if (fileIds.length) await db.from("job_files").delete().in("id", fileIds);
    await db.from("job_events").delete().eq("job_id", JOB).gte("created_at", startedAt);
    await db.from("audit_log").delete().gte("created_at", startedAt).eq("entity", "job_operations");
    const restore: Record<string, unknown> = {};
    for (const k of [
      "status", "customer_note", "delivery_note_confirmed_at", "invoice_number", "invoice_date", "invoice_due_date",
      "paid_at", "paid_amount", "confirmed_at", "production_started_at", "delivered_at", "invoiced_at", "received_at",
    ]) restore[k] = snapshot[k];
    await db.from("orders").update(restore).eq("id", JOB);
    // stage_changed_at přepisuje trigger při změně stavu → zvlášť
    await db.from("orders").update({ stage_changed_at: snapshot.stage_changed_at }).eq("id", JOB);
  }, 60_000);

  it("postup ze šablony + vložená operace; souhrn v zakázce, stav se nemění", async () => {
    const t = await a.applyOperationTemplate(JOB, "soustruzeny", {
      soustruzeni: HRUBY, tepelne_zpracovani: TEPKAL, brouseni: "u_nas", povrchova_uprava: COAT,
    });
    expect(t.ok, t.error).toBe(true);
    expect(t.ids).toHaveLength(4);
    [ids.sou, ids.tep, ids.bru, ids.pov] = t.ids!;

    const add = await a.addJobOperations(JOB, [{ kind: "kontrola", inHouse: true, plannedEnd: "2026-10-01" }], { atPosition: 3 });
    expect(add.ok, add.error).toBe(true);
    ids.kon = add.ids![0];

    const rows = await ops();
    expect(rows.map((r) => [r.kind, r.position])).toEqual([
      ["soustruzeni", 0], ["tepelne_zpracovani", 1], ["brouseni", 2], ["kontrola", 3], ["povrchova_uprava", 4],
    ]);
    expect(rows[0]).toMatchObject({ supplier_id: HRUBY, in_house: false, status: "ceka", created_by: "156c7996-b488-4c53-a3f5-e51dd004f4ad" });
    expect(rows[2]).toMatchObject({ in_house: true, supplier_id: null });

    const j = await job();
    expect(j).toMatchObject({
      status: "objednavka", production_step: "soustruzeni", production_location: "Kovoobrábění Hrubý s.r.o.",
      production_done: 0, production_total: 5, production_problem: false,
    });

    expect((await a.addJobOperations(JOB, [])).error).toBe("Vyber aspoň jednu operaci.");
    expect((await a.addJobOperations(JOB, [{ kind: "frezovani", supplierId: "00000000-0000-0000-0000-000000000000" }])).error).toBe("Dodavatel nenalezen.");
    expect((await a.applyOperationTemplate(JOB, "neznama")).error).toBe("Neznámá šablona postupu.");
    expect((await a.addJobOperations("00000000-0000-0000-0000-000000000000", [{ kind: "jine" }])).error).toBe("Zakázka nenalezena.");

    const view = await data.getJobOperations(JOB);
    expect(view.map((o) => o.location)).toEqual(["Kovoobrábění Hrubý s.r.o.", "TepKal s.r.o.", "U nás", "U nás", "CoatTech CZ"]);
    expect(view[3]).toMatchObject({ label: "Kontrola / měření", overdue: true, createdBy: { name: "Petr Obchodník" } });
  }, 60_000);

  it("posun stavů: start → Ve výrobě; jiná firma čeká, u nás / stejná firma navazuje", async () => {
    const s1 = await a.advanceJobOperation(ids.sou);
    expect(s1).toMatchObject({ ok: true, status: "probiha" });
    expect((await op(ids.sou)).started_at).toBeTruthy();
    expect(await job()).toMatchObject({ status: "ve_vyrobe", production_step: "soustruzeni", production_location: "Kovoobrábění Hrubý s.r.o." });
    expect((await job()).production_started_at).toBeTruthy();

    const s2 = await a.advanceJobOperation(ids.sou);
    expect(s2).toMatchObject({ ok: true, status: "hotovo" });
    expect(s2.nextId).toBeUndefined(); // kalení je u jiné firmy → čeká na převoz
    expect((await op(ids.tep)).status).toBe("ceka");
    expect(await job()).toMatchObject({ production_step: "tepelne_zpracovani", production_location: "TepKal s.r.o.", production_done: 1 });
    expect((await a.advanceJobOperation(ids.sou)).error).toBe("Operace je už hotová.");

    const st = await a.setJobOperationStatus(ids.tep, "probiha", "odvezeno do kalírny");
    expect(st).toMatchObject({ ok: true, status: "probiha" });
    expect((await op(ids.tep)).note).toMatch(/^\d{1,2}\. \d{1,2}\. 2026 \d{2}:\d{2} · Petr Obchodník: odvezeno do kalírny$/);

    const s3 = await a.advanceJobOperation(ids.tep);
    expect(s3).toMatchObject({ ok: true, status: "hotovo", nextId: ids.bru }); // broušení u nás → rozběhne se samo
    expect((await op(ids.bru)).status).toBe("probiha");
    expect(await job()).toMatchObject({ production_step: "brouseni", production_location: "U nás", production_done: 2 });

    expect((await a.setJobOperationStatus(ids.bru, "problem", "chybí přídavek na broušení")).ok).toBe(true);
    expect((await job()).production_problem).toBe(true);
    const s4 = await a.advanceJobOperation(ids.bru);
    expect(s4).toMatchObject({ ok: true, status: "hotovo", nextId: ids.kon });
    expect((await job()).production_problem).toBe(false);
    expect((await op(ids.bru)).finished_at).toBeTruthy();

    expect((await a.setJobOperationStatus(ids.bru, "nic" as never)).error).toBe("Neznámý stav operace.");
  }, 60_000);

  it("filtry knihy: počty podle operace a místa", async () => {
    const f = await data.listOperationLocations();
    expect(f.steps.find((s) => s.key === "kontrola")?.count ?? 0).toBeGreaterThanOrEqual(1);
    expect(f.locations.find((l) => l.name === "U nás")?.count ?? 0).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it("úprava, pořadí a mazání (vlastní do 24 h, jinak jen s právem)", async () => {
    const up = await a.updateJobOperation(ids.pov, { plannedEnd: "2026-11-30", note: "Zinek žlutý", supplierName: "Galvanika Novák" });
    expect(up.ok, up.error).toBe(true);
    expect(await op(ids.pov)).toMatchObject({ planned_end: "2026-11-30", note: "Zinek žlutý", supplier_id: null, supplier_name: "Galvanika Novák" });
    expect((await a.updateJobOperation(ids.pov, { plannedStart: "2026-12-05" })).error).toBe("Začátek operace je po jejím termínu.");
    expect((await a.updateJobOperation(ids.pov, { plannedEnd: "2026-11-30" })).ok).toBe(true); // beze změn

    expect((await a.moveJobOperation(ids.pov, "up")).ok).toBe(true);
    expect((await ops()).map((r) => r.id)).toEqual([ids.sou, ids.tep, ids.bru, ids.pov, ids.kon]);
    expect((await a.moveJobOperation(ids.sou, "up")).ok).toBe(true); // okraj → nic
    expect((await a.reorderJobOperations(JOB, [ids.sou, ids.tep])).error).toMatch(/obnov stránku/);
    const re = await a.reorderJobOperations(JOB, [ids.sou, ids.tep, ids.bru, ids.kon, ids.pov]);
    expect(re.ok, re.error).toBe(true);
    expect((await ops()).map((r) => [r.id, r.position])).toEqual([[ids.sou, 0], [ids.tep, 1], [ids.bru, 2], [ids.kon, 3], [ids.pov, 4]]);

    perms.deny.add("delete");
    const { data: foreign } = await db.from("job_operations").insert({ job_id: JOB, position: 9, kind: "doprava", created_by: adminId }).select("id").single();
    const foreignId = (foreign as { id: string }).id;
    expect((await a.deleteJobOperation(foreignId)).error).toMatch(/vlastní operaci do 24 hodin/);
    const own = await a.addJobOperations(JOB, [{ kind: "doprava", supplierName: "PPL" }]);
    expect((await a.deleteJobOperation(own.ids![0])).ok).toBe(true);
    perms.deny.delete("delete");
    expect((await a.deleteJobOperation(foreignId)).ok).toBe(true);
    expect((await ops()).length).toBe(5);
    expect(await job()).toMatchObject({ production_total: 5, production_step: "kontrola" });
  }, 60_000);

  it("domluvy se zákazníkem", async () => {
    const text = "Zákazník chce měřicí protokol 3D a balení po 10 ks — domluveno telefonicky.";
    expect((await a.setCustomerNote(JOB, text)).ok).toBe(true);
    expect((await job()).customer_note).toBe(text);
    const n = (await events()).filter((e) => e.message === "Domluvy se zákazníkem upraveny").length;
    expect((await a.setCustomerNote(JOB, `  ${text} `)).ok).toBe(true);
    expect((await events()).filter((e) => e.message === "Domluvy se zákazníkem upraveny").length).toBe(n);
    expect(n).toBe(1);
  }, 60_000);

  it("výroba hotová → potvrzený DL → faktura se splatností → zaplaceno → Dokončeno", async () => {
    await a.advanceJobOperation(ids.kon); // probíhá → hotovo
    await a.advanceJobOperation(ids.pov); // čeká → probíhá (jiná firma — ručně)
    await a.advanceJobOperation(ids.pov);
    expect(await job()).toMatchObject({ production_step: "hotovo", production_location: null, production_done: 5, production_total: 5 });

    const { data: f } = await db.from("job_files").insert({
      job_id: JOB, kind: "foto", filename: "dl-podepsany.jpg", storage_path: `zakazky/${JOB}/e2e-dl-podepsany.jpg`, note: null,
    }).select("id").single();
    fileIds.push((f as { id: string }).id);
    expect((await a.confirmDeliveryNote(JOB, { fileId: "00000000-0000-0000-0000-000000000000" })).error).toBe("Dokument nepatří k této zakázce.");
    expect((await a.confirmDeliveryNote(JOB, { date: "22.10." })).error).toMatch(/Neplatné datum/);
    const dl = await a.confirmDeliveryNote(JOB, { date: "2026-10-22", fileId: fileIds[0] });
    expect(dl).toMatchObject({ ok: true, stage: "dodano_zakaznikovi", date: "2026-10-22" });
    const { data: file } = await db.from("job_files").select("title, kind, note").eq("id", fileIds[0]).single();
    expect(file).toEqual({ title: "Potvrzený dodací list", kind: "dodaci_list", note: "Potvrzeno zákazníkem 22. 10. 2026" });
    const j1 = await job();
    expect(j1).toMatchObject({ status: "dodano_zakaznikovi", delivery_note_confirmed_at: "2026-10-22" });
    expect(j1.delivered_at).toBeTruthy();

    expect((await a.setInvoiceInfo(JOB, { invoiceDate: "2026-10-22", invoiceDueDate: "2026-10-01" })).error).toBe("Splatnost je před datem faktury.");
    const inv = await a.setInvoiceInfo(JOB, { invoiceNumber: "FV-E2E-104", invoiceDate: "2026-10-22" });
    expect(inv).toMatchObject({ ok: true, stage: "fakturovano", invoiceDate: "2026-10-22", invoiceDueDate: "2026-12-06" }); // 45 dní
    expect(await job()).toMatchObject({ status: "fakturovano", invoice_number: "FV-E2E-104", invoice_due_date: "2026-12-06" });
    const closing = await data.getJobClosingInfo(JOB);
    expect(closing).toMatchObject({
      stage: "fakturovano", invoiceNumber: "FV-E2E-104", paymentTermsDays: 45, overdueInvoice: false, paidAt: null,
      daysToDue: daysBetween(todayIso(), "2026-12-06"), deliveryNoteConfirmedAt: "2026-10-22",
      customerNote: expect.stringContaining("měřicí protokol"),
    });
    // změna data faktury → nová splatnost
    expect((await a.setInvoiceInfo(JOB, { invoiceDate: "2026-10-23" })).invoiceDueDate).toBe("2026-12-07");

    const paid = await a.markJobPaid(JOB, { date: "2026-10-24", amount: 90_000 });
    expect(paid).toMatchObject({ ok: true, stage: "dokonceno", paidAt: "2026-10-24" });
    const j2 = await job();
    expect(j2).toMatchObject({ status: "dokonceno", paid_at: "2026-10-24" });
    expect(Number(j2.paid_amount)).toBe(90_000);
    expect(await data.getJobClosingInfo(JOB)).toMatchObject({ paidAmount: 90_000, daysToDue: null, overdueInvoice: false });

    perms.deny.add("margins");
    expect((await a.unmarkJobPaid(JOB)).error).toBe("K této akci nemáš oprávnění.");
    expect((await data.getJobClosingInfo(JOB))?.paidAmount).toBeNull();
    perms.deny.delete("margins");
    const un = await a.unmarkJobPaid(JOB);
    expect(un).toMatchObject({ ok: true, stage: "fakturovano" });
    expect(await job()).toMatchObject({ status: "fakturovano", paid_at: null, paid_amount: null });

    perms.deny.add("margins");
    const again = await a.markJobPaid(JOB, { amount: 5 });
    perms.deny.delete("margins");
    expect(again).toMatchObject({ ok: true, stage: "dokonceno", paidAt: todayIso() });
    expect((await job()).paid_amount).toBeNull(); // bez práva na marže se částka nezapíše
  }, 60_000);

  it("historie zakázky: výroba, stavy, bez částek", async () => {
    const ev = await events();
    const text = ev.map((e) => e.message).join("\n");
    expect(text).toContain("Postup výroby ze šablony „Soustružený díl — kalený a broušený\": Soustružení (Kovoobrábění Hrubý s.r.o.), Tepelné zpracování (TepKal s.r.o.), Broušení (U nás), Povrchová úprava (CoatTech CZ)");
    expect(text).toContain("Přidána operace: Kontrola / měření (U nás)");
    expect(text).toContain("Výroba: Soustružení (Kovoobrábění Hrubý s.r.o.) → Probíhá");
    expect(text).toContain("Výroba: Tepelné zpracování (TepKal s.r.o.) → Probíhá — odvezeno do kalírny");
    expect(text).toContain("Výroba: Broušení (U nás) → Probíhá — navazuje automaticky");
    expect(text).toContain("Výroba: Povrchová úprava (CoatTech CZ) — kdo: Galvanika Novák, termín 30. 11. 2026, poznámka");
    expect(text).toContain("Stav: Objednávka → Ve výrobě — výroba začala");
    expect(text).toContain("Potvrzený dodací list vrácen (22. 10. 2026)");
    expect(text).toContain("Stav: Ve výrobě → Dodáno zákazníkovi — potvrzený dodací list");
    expect(text).toContain("Faktura FV-E2E-104 ze dne 22. 10. 2026, splatnost 6. 12. 2026");
    expect(text).toContain("Stav: Dodáno zákazníkovi → Vyfakturováno — faktura vystavena");
    expect(text).toContain("Zaplaceno 24. 10. 2026");
    expect(text).toContain("Stav: Vyfakturováno → Dokončeno — zaplaceno");
    expect(text).toMatch(/Výroba: operace Doprava \(.+\) odstraněna/);
    expect(text).not.toMatch(/90 ?000|Kč/);
    expect(JSON.stringify(ev.map((e) => e.data))).not.toContain("90000");
    expect(ev.filter((e) => e.message.startsWith("Stav: Objednávka → Ve výrobě")).length).toBe(1);
  }, 60_000);
});
