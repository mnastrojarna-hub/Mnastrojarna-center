import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Dodací list při „Zapsat dodání" proti lokálnímu Supabase (tools/local-supabase):
 * dílčí dodávka → vlastní DL (číslo z řady, jen dodané množství, bez cen) v delivery_notes(+items)
 * i v Dokumentech zakázky; druhá dílčí dodávka → druhý DL; chyba PDF → dodání zůstane zapsané,
 * číslo zůstane a „Vystavit znovu" ho použije; souběh dvou uživatelů → jedna dodávka, jeden DL;
 * dodáno bez DL → Doklady vystaví DL na dodané zboží; náhled DL; zbytek → konečný DL a Dodáno zákazníkovi; Doklady → Dodací
 * list stáhne vystavený DL bez nového čísla; zakázka bez dodávek dostane DL jako dřív a první dodávka
 * jeho číslo převezme; zaměstnanec DL vystaví i vidí; e-mail nese číslo konkrétního DL.
 *   LOCAL_SUPABASE=1 npx vitest run src/app/actions/delivery-notes.integration.test.ts
 * Vlastní data (zákazník, zakázky „E2E-21I-"), na konci se uklidí; číselné řady se nevrací (sdílená DB).
 */

const ENABLED = process.env.LOCAL_SUPABASE === "1";
const SALES = "156c7996-b488-4c53-a3f5-e51dd004f4ad"; // obchod@local.test
const WORKER = "3053f44f-90ee-45d7-879f-ea7ad99ee275"; // dilna@local.test
const TAG = Date.now().toString(36).toUpperCase();

const h = vi.hoisted(() => ({
  failRender: false,
  user: {
    id: "156c7996-b488-4c53-a3f5-e51dd004f4ad", email: "obchod@local.test", fullName: "Petr Obchodník", role: "obchodnik",
    initials: "PO", roleLabel: "Obchodník", aiAccess: true, active: true, hasProfile: true,
  } as Record<string, unknown>,
}));

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

vi.mock("@/lib/auth/session", async () => {
  const perms = await import("@/lib/auth/permissions");
  const ctx = { aiEnabled: false, aiConfigured: false, aiCaptureForAll: true, supplierInvoicesForAll: false };
  const can = (f: string) => perms.can(h.user as never, f as never, ctx as never);
  return {
    getSessionUser: async () => h.user,
    getAccess: async () => ({ user: h.user, ctx, features: [], can }),
    checkFeature: async (f: string) => (can(f) ? { user: h.user } : { error: "K této akci nemáš oprávnění." }),
    apiRequire: async () => ({ user: h.user }),
    requireUser: async () => h.user,
    requireFeature: async () => h.user,
  };
});

vi.mock("@/lib/pdf/render", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/pdf/render")>();
  return {
    ...real,
    renderDeliveryNotePdf: async (...args: Parameters<typeof real.renderDeliveryNotePdf>) => {
      if (h.failRender) throw new Error("Simulovaná chyba PDF.");
      return real.renderDeliveryNotePdf(...args);
    },
  };
});

type Actions = typeof import("./delivery-notes");
type Docs = typeof import("./job-documents");

function pdfText(buf: Buffer): string | null {
  try {
    const dir = mkdtempSync(path.join(os.tmpdir(), "dl-int-"));
    const f = path.join(dir, "dl.pdf");
    writeFileSync(f, buf);
    const out = execFileSync("pdftotext", ["-layout", f, "-"], { encoding: "utf8" });
    rmSync(dir, { recursive: true, force: true });
    return out.replace(/[  ]/g, " ");
  } catch {
    return null; // pdftotext není — obsah PDF se neověří
  }
}

describe.skipIf(!ENABLED)("dodací list při zápisu dodání ↔ lokální Supabase", () => {
  let db: SupabaseClient;
  let a: Actions;
  let d: Docs;
  let customerId = "";
  const jobs: string[] = [];
  let jobId = "";
  let itemA = "";
  let itemB = "";
  const numbers: string[] = [];

  async function newJob(suffix: string): Promise<{ id: string; a: string; b: string }> {
    const { data: o, error } = await db.from("orders").insert({
      number: `Z-E2E21I-${TAG}-${suffix}`, title: `E2E-21I-${suffix}`, status: "potvrzeno", source: "manual",
      owner_id: SALES, assignee_id: WORKER, created_by: SALES, customer_id: customerId, customer_order_number: `PO-${TAG}`,
      order_date: "2026-10-20", order_status: "potvrzena", order_revision: 1,
    }).select("id").single();
    expect(error).toBeNull();
    const id = (o as { id: string }).id;
    jobs.push(id);
    const { data: it } = await db.from("order_items").insert([
      { order_id: id, position: 0, drawing_number: `VK-${TAG}-A`, name: "Příruba", material: "11 523", quantity: 10, unit: "ks", unit_price: 123.45 },
      { order_id: id, position: 1, drawing_number: `VK-${TAG}-B`, name: "Hřídel", material: "42CrMo4", quantity: 4, unit: "ks", unit_price: 987.65 },
    ]).select("id, position").order("position");
    const rows = (it ?? []) as { id: string }[];
    await db.from("orders").update({ status: "dodano_k_nam" }).eq("id", id);
    return { id, a: rows[0].id, b: rows[1].id };
  }
  const order = async (id: string) => (await db.from("orders").select("*").eq("id", id).single()).data as Record<string, unknown>;
  const notesOf = async (id: string) =>
    ((await db.from("delivery_notes").select("*").eq("order_id", id).order("created_at")).data ?? []) as Record<string, unknown>[];
  const linesOf = async (noteId: string) =>
    ((await db.from("delivery_note_items").select("*").eq("delivery_note_id", noteId).order("position")).data ?? []) as Record<string, unknown>[];
  const fileRow = async (fileId: string) => (await db.from("job_files").select("*").eq("id", fileId).single()).data as Record<string, unknown>;
  const delivered = async (itemId: string) => Number(((await db.from("order_items").select("delivered_quantity").eq("id", itemId).single()).data as { delivered_quantity: number }).delivered_quantity);
  async function pdfOf(fileId: string): Promise<Buffer> {
    const f = await fileRow(fileId);
    const { data } = await db.storage.from("job-files").download(f.storage_path as string);
    return Buffer.from(await data!.arrayBuffer());
  }
  const dlCounter = async () => ((await db.from("doc_counters").select("counter").eq("doc_type", "DL").maybeSingle()).data as { counter: number } | null)?.counter ?? 0;

  beforeAll(async () => {
    const env = loadEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: c, error } = await db.from("customers").insert({
      name: `E2E-21I-Kovo ${TAG} s.r.o.`, country: "CZ", owner_id: SALES, email: `e2e21i-${TAG.toLowerCase()}@local.test`,
      contact_person: "Ing. Eva Testová", street: "Testovací 5", city: "Brno", zip: "602 00", ico: "87654321",
      delivery_address: "Sklad Brno, Průmyslová 12, 602 00 Brno",
    }).select("id").single();
    expect(error).toBeNull();
    customerId = (c as { id: string }).id;
    a = await import("./delivery-notes");
    d = await import("./job-documents");
    const j = await newJob("A");
    jobId = j.id;
    itemA = j.a;
    itemB = j.b;
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    for (const id of jobs) {
      const { data: files } = await db.from("job_files").select("storage_path").eq("job_id", id);
      const paths = ((files ?? []) as { storage_path: string }[]).map((f) => f.storage_path);
      if (paths.length) await db.storage.from("job-files").remove(paths);
      await db.from("delivery_notes").delete().eq("order_id", id);
      await db.from("invoices").delete().eq("order_id", id);
      await db.from("job_files").update({ replaced_by: null }).eq("job_id", id);
      await db.from("orders").delete().eq("id", id);
      await db.from("audit_log").delete().filter("diff->>jobId", "eq", id);
    }
    if (customerId) await db.from("customers").delete().eq("id", customerId);
  }, 60_000);

  it("1. dílčí dodávka → vlastní DL: číslo z řady, jen 6 ks Příruby, bez cen, v Dokumentech i delivery_notes", async () => {
    const res = await a.recordDelivery(jobId, [{ itemId: itemA, from: 0, to: 6 }], { note: "Paleta 1/2", issueNote: true });
    expect(res.ok, res.error).toBe(true);
    expect(res.recorded).toBe(true);
    const dn = res.deliveryNote!;
    expect(dn.number).toMatch(/^DL-\d{4}-\d{3,}$/);
    expect(dn.label).toBe("1. dílčí dodávka");
    expect(dn.final).toBe(false);
    numbers.push(dn.number);
    expect(await delivered(itemA)).toBe(6);
    expect((await order(jobId)).status).toBe("dodano_k_nam");
    expect((await order(jobId)).delivery_note_number).toBe(dn.number);

    const notes = await notesOf(jobId);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      number: dn.number, customer_id: customerId, delivery_address: "Sklad Brno, Průmyslová 12, 602 00 Brno", note: "Paleta 1/2",
    });
    const lines = await linesOf(notes[0].id as string);
    expect(lines.map((l) => [l.description, Number(l.quantity), l.unit])).toEqual([[`Příruba (výkres VK-${TAG}-A)`, 6, "ks"]]);

    const f = await fileRow(dn.fileId);
    expect(f).toMatchObject({ kind: "dodaci_list", origin: "generated", issuer: "my", archived: false, version: 1, storage_path: notes[0].storage_path });
    expect(f.title).toBe(`Dodací list ${dn.number} · 1. dílčí dodávka`);
    const pdf = await pdfOf(dn.fileId);
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    const text = pdfText(pdf);
    if (text) {
      expect(text).toContain(dn.number);
      expect(text).toContain(`PO-${TAG}`);
      expect(text).toContain("1. dílčí dodávka");
      expect(text).toMatch(/6 ks/);
      expect(text).toMatch(/z 10 ks/);
      expect(text).not.toContain("Hřídel"); // jen to, co odešlo
      expect(text).toContain("Průmyslová 12");
      expect(text).toContain("Paleta 1/2");
      expect(text).toMatch(/P\s*Ř\s*E\s*V\s*Z\s*A\s*L/);
      expect(text).not.toMatch(/Kč|123,45|987,65/);
    }
    // historie: dodání s odkazem na DL + vystavení DL
    const { data: ev } = await db.from("job_events").select("message, data").eq("job_id", jobId).order("created_at", { ascending: false }).limit(5);
    const msgs = ((ev ?? []) as { message: string }[]).map((e) => e.message);
    expect(msgs.some((m) => m.startsWith("Dodáno: Příruba 6/10 ks") && m.includes(`DL ${dn.number}`))).toBe(true);
    expect(msgs.some((m) => m.startsWith(`Vystaven dodací list ${dn.number}`))).toBe(true);
  }, 60_000);

  it("2. dílčí dodávka → druhý DL s vlastním číslem a vlastními množstvími (ne verze prvního)", async () => {
    const res = await a.recordDelivery(jobId, [{ itemId: itemA, from: 6, to: 10 }, { itemId: itemB, from: 0, to: 1 }], { issueNote: true });
    expect(res.ok, res.error).toBe(true);
    const dn = res.deliveryNote!;
    expect(dn.number).not.toBe(numbers[0]);
    expect(dn.label).toBe("2. dílčí dodávka");
    numbers.push(dn.number);
    const notes = await notesOf(jobId);
    expect(notes.map((n) => n.number)).toEqual(numbers);
    const lines = await linesOf(notes[1].id as string);
    expect(lines.map((l) => Number(l.quantity))).toEqual([4, 1]);
    const { data: dls } = await db.from("job_files").select("id, archived, filename").eq("job_id", jobId).eq("kind", "dodaci_list");
    expect(((dls ?? []) as { archived: boolean }[]).filter((x) => !x.archived)).toHaveLength(2);
    // orders.delivery_note_number zůstává první DL
    expect((await order(jobId)).delivery_note_number).toBe(numbers[0]);
  }, 60_000);

  it("souběh: jiný zápis mezitím → chyba, nic se nezapíše ani nevystaví", async () => {
    const before = (await notesOf(jobId)).length;
    const res = await a.recordDelivery(jobId, [{ itemId: itemB, from: 0, to: 2 }], { issueNote: true });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/mezitím někdo zapsal dodání/);
    expect((await notesOf(jobId)).length).toBe(before);
    expect(await delivered(itemB)).toBe(1);
  });

  it("chyba PDF → dodání ZŮSTANE zapsané a uživatel to ví; „Vystavit znovu“ použije stejné číslo; zbytek = konečný DL", async () => {
    h.failRender = true;
    const counter0 = await dlCounter();
    const failed = await a.recordDelivery(jobId, [{ itemId: itemB, from: 1, to: 4 }], { issueNote: true });
    h.failRender = false;
    expect(failed.ok).toBe(false);
    expect(failed.recorded).toBe(true);
    expect(failed.retry?.number).toMatch(/^DL-\d{4}-\d{3,}$/);
    expect(failed.error).toMatch(/^Dodání je zapsané, dodací list DL-\d{4}-\d{3,} se nepodařilo vystavit: .*Vystavit dodací list znovu.*číslo zůstane/);
    expect(await delivered(itemB)).toBe(4);
    expect((await order(jobId)).status).toBe("dodano_zakaznikovi");
    const pending = (await notesOf(jobId)).find((n) => n.id === failed.retry!.id)!;
    expect(pending.storage_path).toBeNull(); // zábor uvolněn → opakování ho hned zabere

    // nové zapsání (jiný dialog) na rezervaci nesáhne — retry jen s reissue
    const again = await a.recordDelivery(jobId, [{ itemId: itemB, from: 1, to: 4 }], { issueNote: true });
    expect(again.ok).toBe(false);
    expect(again.error).toMatch(/mezitím někdo zapsal dodání/);

    const ok = await a.recordDelivery(jobId, [{ itemId: itemB, from: 1, to: 4 }], { retryId: failed.retry!.id, reissue: true });
    expect(ok.ok, ok.error).toBe(true);
    expect(ok.recorded).toBe(true);
    expect(ok.deliveryNote!.number).toBe(failed.retry!.number);
    expect(ok.deliveryNote!.label).toBe("3. dodávka — konečná");
    expect(ok.deliveryNote!.final).toBe(true);
    numbers.push(ok.deliveryNote!.number);
    expect(await dlCounter()).toBe(counter0 + 1); // opakování nespotřebovalo další číslo
    expect(await delivered(itemB)).toBe(4); // jen DL, množství se znovu nezapsalo
    expect((await notesOf(jobId)).every((n) => String(n.storage_path).startsWith("zakazky/"))).toBe(true);
    const text = pdfText(await pdfOf(ok.deliveryNote!.fileId));
    if (text) expect(text).toMatch(/celkem dodáno[\s\S]*4 z 4 ks/);

    // staré okno: opakování už vystaveného DL nic nepřepíše
    const stale = await a.recordDelivery(jobId, [{ itemId: itemB, from: 1, to: 4 }], { retryId: failed.retry!.id, reissue: true });
    expect(stale.ok).toBe(false);
    expect(stale.error).toMatch(/je už vystavený/);
    expect(stale.retry).toBeNull();
    const { data: dls } = await db.from("job_files").select("id").eq("job_id", jobId).eq("kind", "dodaci_list").eq("archived", false);
    expect(dls ?? []).toHaveLength(3);
  }, 60_000);

  it("souběh dvou uživatelů na stejné dodávce: zapíše se jen jedna, jeden DL s PDF, jeden aktuální soubor; druhý nic nedostane", async () => {
    const j = await newJob("R");
    const counter0 = await dlCounter();
    const [r1, r2] = await Promise.all([
      a.recordDelivery(j.id, [{ itemId: j.a, from: 0, to: 6 }], { issueNote: true, note: "admin" }),
      // Hřídel první: když prohraje u Příruby, musí vrátit už zabranou Hřídel
      a.recordDelivery(j.id, [{ itemId: j.b, from: 0, to: 4 }, { itemId: j.a, from: 0, to: 4 }], { issueNote: true, note: "obchod" }),
    ]);
    const wins = [r1, r2].filter((r) => r.ok);
    const loses = [r1, r2].filter((r) => !r.ok);
    expect(wins).toHaveLength(1);
    expect(loses).toHaveLength(1);
    expect(loses[0].recorded).toBe(false);
    expect(loses[0].retry).toBeNull();
    expect(loses[0].error).toMatch(/mezitím někdo zapsal dodání/);
    const notes = await notesOf(j.id);
    expect(notes).toHaveLength(1);
    expect(String(notes[0].storage_path)).toMatch(/^zakazky\//);
    expect(notes[0].number).toBe(wins[0].deliveryNote!.number);
    const { data: files } = await db.from("job_files").select("id").eq("job_id", j.id).eq("kind", "dodaci_list").eq("archived", false);
    expect(files ?? []).toHaveLength(1);
    // množství = vítěz; poražený nic nepřepsal ani nenechal napůl (vrácený zábor u Hřídele)
    const winner = wins[0] === r1 ? { a: 6, b: 0 } : { a: 4, b: 4 };
    expect(await delivered(j.a)).toBe(winner.a);
    expect(await delivered(j.b)).toBe(winner.b);
    const lines = await linesOf(notes[0].id as string);
    expect(lines.map((l) => Number(l.quantity))).toEqual(wins[0] === r1 ? [6] : [4, 4]);
    expect(await dlCounter()).toBe(counter0 + 1);
  }, 60_000);

  it("Doklady → Dodací list: stáhne vystavený DL (poslední nebo vybraný), nové číslo nevzniká", async () => {
    const counter0 = await dlCounter();
    const notes = await notesOf(jobId);
    const latest = await d.generateJobDocument(jobId, "dodaci_list");
    expect(latest.ok, latest.error).toBe(true);
    expect(latest.number).toBe(numbers[2]);
    const first = await d.generateJobDocument(jobId, "dodaci_list", { deliveryNoteId: notes[0].id as string });
    expect(first.number).toBe(numbers[0]);
    expect((await fileRow(first.fileId!)).storage_path).toBe(notes[0].storage_path);
    expect(await dlCounter()).toBe(counter0);
    expect((await notesOf(jobId)).length).toBe(3);
    const list = await a.listDeliveryNotes(jobId);
    expect(list.ok, list.error).toBe(true);
    expect(list.notes!.map((n) => [n.number, n.lines.map((l) => l.quantity)])).toEqual([
      [numbers[0], [6]], [numbers[1], [4, 1]], [numbers[2], [3]],
    ]);
  }, 60_000);

  it("faktura vyjmenuje všechny dodací listy („dodacími listy č. …“)", async () => {
    const inv = await d.generateJobDocument(jobId, "faktura", { force: true });
    expect(inv.ok, inv.error).toBe(true);
    const text = pdfText(await pdfOf(inv.fileId!));
    if (text) {
      const flatText = text.replace(/\s+/g, " ");
      expect(flatText).toContain(`Dodáno dodacími listy č. ${numbers.join(", ")}.`);
    }
  }, 60_000);

  it("e-mail k DL nese číslo konkrétního dodacího listu", async () => {
    const notes = await notesOf(jobId);
    const f = await db.from("job_files").select("id").eq("storage_path", notes[1].storage_path as string).single();
    const draft = await d.draftJobDocumentEmail(jobId, (f.data as { id: string }).id);
    expect(draft.ok, draft.error).toBe(true);
    expect(draft.subject).toContain(numbers[1]);
    expect(draft.body).toContain(numbers[1]);
  });

  it("zakázka bez dodávek: Doklady → DL na všechny položky jako dřív; první dodávka převezme jeho číslo", async () => {
    const j = await newJob("B");
    const all = await d.generateJobDocument(j.id, "dodaci_list");
    expect(all.ok, all.error).toBe(true);
    expect((await order(j.id)).delivery_note_number).toBe(all.number);
    expect(await notesOf(j.id)).toHaveLength(0);
    const counter0 = await dlCounter();
    const res = await a.recordDelivery(j.id, [{ itemId: j.a, from: 0, to: 10 }, { itemId: j.b, from: 0, to: 4 }], { issueNote: true });
    expect(res.ok, res.error).toBe(true);
    expect(res.deliveryNote!.number).toBe(all.number);
    expect(res.deliveryNote!.label).toBeNull(); // jediná kompletní dodávka
    expect(res.deliveryNote!.version).toBe(2); // stejný DL — nová verze, ne nové číslo
    expect(await dlCounter()).toBe(counter0);
  }, 60_000);

  it("dodáno bez DL (starší dodání): Doklady → DL na dodané zboží (6 ks, ne 10 + 4), příště stejný DL bez nového čísla", async () => {
    const j = await newJob("L");
    const res = await a.recordDelivery(j.id, [{ itemId: j.a, from: 0, to: 6 }], { issueNote: false });
    expect(res.ok, res.error).toBe(true);
    const counter0 = await dlCounter();
    const dl = await d.generateJobDocument(j.id, "dodaci_list");
    expect(dl.ok, dl.error).toBe(true);
    expect(await dlCounter()).toBe(counter0 + 1);
    const notes = await notesOf(j.id);
    expect(notes.map((n) => n.number)).toEqual([dl.number]);
    expect((await linesOf(notes[0].id as string)).map((l) => Number(l.quantity))).toEqual([6]);
    const f = await fileRow(dl.fileId!);
    expect(f.title).toBe(`Dodací list ${dl.number} · 1. dílčí dodávka`);
    const text = pdfText(await pdfOf(dl.fileId!));
    if (text) {
      expect(text).toMatch(/6 ks/);
      expect(text).toMatch(/celkem dodáno[\s\S]*6 z 10 ks/);
      expect(text).not.toContain("Hřídel");
    }
    const again = await d.generateJobDocument(j.id, "dodaci_list");
    expect(again.number).toBe(dl.number);
    expect(again.fileId).toBe(dl.fileId);
    expect(await dlCounter()).toBe(counter0 + 1);

    // náhled bez uložení = uložený DL dodávky (ne všechny položky pod jeho číslem)
    const { GET } = await import("@/app/api/pdf/job/[id]/route");
    const prev = await GET(new Request(`http://localhost/api/pdf/job/${j.id}?type=dodaci-list`), { params: Promise.resolve({ id: j.id }) });
    expect(prev.status).toBe(307);
    expect(prev.headers.get("location")).toMatch(new RegExp(`/api/jobs/files/${dl.fileId}$`));
  }, 60_000);

  it("náhled DL zakázky dodané bez DL ukazuje dodané množství, ne objednané", async () => {
    const j = await newJob("P");
    await a.recordDelivery(j.id, [{ itemId: j.b, from: 0, to: 1 }], { issueNote: false });
    const { GET } = await import("@/app/api/pdf/job/[id]/route");
    const prev = await GET(new Request(`http://localhost/api/pdf/job/${j.id}?type=dodaci-list`), { params: Promise.resolve({ id: j.id }) });
    expect(prev.status).toBe(200);
    const text = pdfText(Buffer.from(await prev.arrayBuffer()));
    if (text) {
      expect(text).toContain("DL-NÁHLED");
      expect(text).toMatch(/1 ks/);
      expect(text).not.toContain("Příruba");
    }
    expect(await notesOf(j.id)).toHaveLength(0); // náhled nic neukládá
  }, 60_000);

  it("bez zaškrtnutí „Vystavit dodací list“ se jen zapíše dodání", async () => {
    const j = await newJob("C");
    const res = await a.recordDelivery(j.id, [{ itemId: j.a, from: 0, to: 2 }], { issueNote: false });
    expect(res.ok, res.error).toBe(true);
    expect(res.deliveryNote).toBeNull();
    expect(await delivered(j.a)).toBe(2);
    expect(await notesOf(j.id)).toHaveLength(0);
  });

  it("zaměstnanec: zapíše dodání, vystaví DL a vidí ho (žádný nákupní doklad, žádné ceny)", async () => {
    const j = await newJob("W");
    Object.assign(h.user, { id: WORKER, email: "dilna@local.test", fullName: "Jana Zaměstnanec", role: "zamestnanec", initials: "JZ", roleLabel: "Zaměstnanec" });
    try {
      const res = await a.recordDelivery(j.id, [{ itemId: j.b, from: 0, to: 2 }], { issueNote: true });
      expect(res.ok, res.error).toBe(true);
      const dn = res.deliveryNote!;
      const { data: price } = await db.rpc("job_file_price_ids", { p_ids: [dn.fileId] });
      expect(price ?? []).toEqual([]);
      const { getJob } = await import("@/lib/data/jobs");
      const job = await getJob(j.id);
      const f = job!.files.find((x) => x.id === dn.fileId);
      expect(f).toBeTruthy();
      expect(f!.locked ?? null).toBeNull();
      const text = pdfText(await pdfOf(dn.fileId));
      if (text) {
        expect(text).toContain("Jana Zaměstnanec");
        expect(text).not.toMatch(/Kč|987,65/);
      }
      const list = await a.listDeliveryNotes(j.id);
      expect(list.ok, list.error).toBe(true);
      expect(list.notes!.map((n) => n.number)).toEqual([dn.number]);
    } finally {
      Object.assign(h.user, { id: SALES, email: "obchod@local.test", fullName: "Petr Obchodník", role: "obchodnik", initials: "PO", roleLabel: "Obchodník" });
    }
  }, 60_000);
});
