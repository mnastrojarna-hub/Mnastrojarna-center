import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Výjimky v toku (31. 10.) proti lokálnímu Supabase: Zákazník neobjednal + Obnovit, Pozastavit / Pokračovat
 * (stav před pauzou), Reklamace (oprava → vyřízena, dobropis), Výroba se nepovedla, Vyrábět bez objednávky
 * (příznak zmizí s číslem objednávky jakoukoli cestou), Oprava zakázky (revize + hodnota), Aktualizace
 * výkresu (trigger revize položky, banner, Beru na vědomí). Vlastní zakázky Z-E2E-FLOWEXC-*.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/app/actions/flow-exceptions.integration.test.ts
 */

const ENABLED = process.env.LOCAL_SUPABASE === "1";
const PREFIX = `Z-E2E-FLOWEXC-${Date.now().toString(36)}`;

const who = vi.hoisted(() => ({
  users: {} as Record<string, { id: string; email: string; fullName: string; role: "super_admin" | "obchodnik" | "zamestnanec" }>,
  current: "sales" as "sales" | "worker" | "admin",
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

type Exc = typeof import("@/app/actions/flow-exceptions");
type Row = Record<string, unknown>;

describe.skipIf(!ENABLED)("výjimky v toku ↔ lokální Supabase", () => {
  let svc: SupabaseClient;
  let x: Exc;
  const jobs: string[] = [];
  let n = 0;
  const as = (u: "sales" | "worker" | "admin") => { who.current = u; };
  const id = (u: "sales" | "worker" | "admin") => who.users[u].id;

  async function newJob(patch: Row = {}): Promise<string> {
    n += 1;
    const { localAdmin } = await import("@/test/local-supabase");
    const { userActor } = await import("@/lib/supabase/actor-headers");
    const { data, error } = await localAdmin(userActor({ id: id("sales") })).from("orders").insert({
      number: `${PREFIX}-${n}`, title: `Výjimka ${n}`, source: "email", status: "poptavka", inquiry_date: "2026-10-20", owner_id: id("sales"), ...patch,
    }).select("id").single();
    if (error) throw new Error(error.message);
    jobs.push((data as { id: string }).id);
    return (data as { id: string }).id;
  }
  async function job(jobId: string): Promise<Row> {
    return (await svc.from("orders").select("*").eq("id", jobId).single()).data as Row;
  }
  async function events(jobId: string) {
    return ((await svc.from("job_events").select("type, message, data, actor_id").eq("job_id", jobId).order("created_at")).data ?? []) as { type: string; message: string; data: Row; actor_id: string | null }[];
  }
  async function addItem(jobId: string, patch: Row = {}): Promise<string> {
    const { data, error } = await svc.from("order_items").insert({
      order_id: jobId, position: 0, name: "Díl", drawing_number: "F0N603W88", revision: "02", quantity: 10, unit: "ks", unit_price: 100, ...patch,
    }).select("id").single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  }
  /** Přímý posun stavu jako „Korekce stavu" (s autorem). */
  async function setStage(jobId: string, status: string, extra: Row = {}) {
    const { localAdmin } = await import("@/test/local-supabase");
    const { userActor } = await import("@/lib/supabase/actor-headers");
    const { error } = await localAdmin(userActor({ id: id("admin") })).from("orders").update({ status, ...extra }).eq("id", jobId);
    if (error) throw new Error(error.message);
  }

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
    x = await import("@/app/actions/flow-exceptions");
  }, 60_000);

  afterAll(async () => {
    if (!svc || !jobs.length) return;
    await svc.from("job_drawing_changes").delete().in("job_id", jobs);
    await svc.from("job_files").delete().in("job_id", jobs);
    await svc.from("quotes").delete().in("job_id", jobs);
    await svc.from("orders").delete().in("id", jobs);
    await svc.from("audit_log").delete().in("entity_id", jobs);
  }, 60_000);

  it("Zákazník neobjednal: odeslaná nabídka zamítnuta, důvod u zakázky; Obnovit poptávku vrátí Nabídku", async () => {
    const jobId = await newJob();
    const { data: q } = await svc.from("quotes").insert({ number: `${PREFIX}-Q1`, job_id: jobId, status: "odeslano", sent_at: new Date().toISOString(), total: 1000, revision: 1, owner_id: id("sales") }).select("id").single();
    expect((await job(jobId)).status).toBe("nabidka");
    as("worker");
    expect((await x.closeJobAsLost(jobId, "notOrdered", { reason: "cena" })).ok).toBe(false);
    as("sales");
    expect((await x.closeJobAsLost(jobId, "decline", { reason: "kapacita" })).error).toMatch(/Nabídka už odešla/);
    expect((await x.closeJobAsLost(jobId, "notOrdered", { reason: "jine" })).error).toMatch(/poznámku/);
    const res = await x.closeJobAsLost(jobId, "notOrdered", { reason: "cena", note: "o 20 % dráž" });
    expect(res).toMatchObject({ ok: true, stage: "nerealizovano" });
    const j = await job(jobId);
    expect([j.lost_reason, j.lost_note, j.side_from_stage, j.lost_by]).toEqual(["cena", "o 20 % dráž", "nabidka", id("sales")]);
    const qr = (await svc.from("quotes").select("status, lost_reason").eq("id", (q as { id: string }).id).single()).data as Row;
    expect(qr).toMatchObject({ status: "zamitnuto", lost_reason: "cena" });
    const stageEv = (await events(jobId)).filter((e) => e.type === "stage").at(-1)!;
    expect(stageEv.message).toMatch(/Nerealizováno.*Cena/);
    expect(stageEv.actor_id).toBe(id("sales"));
    // obnovit
    const back = await x.reopenLostJob(jobId, { note: "zákazník se vrátil" });
    expect(back, JSON.stringify(back)).toMatchObject({ ok: true, stage: "nabidka" });
    const j2 = await job(jobId);
    expect([j2.lost_reason, j2.status]).toEqual([null, "nabidka"]);
    expect(((await svc.from("quotes").select("status").eq("id", (q as { id: string }).id).single()).data as Row).status).toBe("odeslano");
  });

  it("Nebudeme nabízet z poptávky → poptávka odmítnutá (my)", async () => {
    const jobId = await newJob();
    as("sales");
    expect((await x.closeJobAsLost(jobId, "decline", { reason: "nevyrabime" })).ok).toBe(true);
    const j = await job(jobId);
    expect([j.status, j.inquiry_status, j.lost_reason]).toEqual(["nerealizovano", "odmitnuta", "nevyrabime"]);
    expect((await x.reopenLostJob(jobId)).stage).toBe("poptavka");
  });

  it("Pozastavit / Pokračovat vrací do stavu před pauzou (s důvodem v historii)", async () => {
    const jobId = await newJob();
    await setStage(jobId, "potvrzeno");
    as("worker");
    expect((await x.pauseJob(jobId, { reason: "" })).ok).toBe(false);
    const p = await x.pauseJob(jobId, { reason: "Čeká na materiál" });
    expect(p).toMatchObject({ ok: true, stage: "pozastaveno" });
    let j = await job(jobId);
    expect([j.side_from_stage, j.hold_reason]).toEqual(["potvrzeno", "Čeká na materiál"]);
    expect((await events(jobId)).filter((e) => e.type === "stage").at(-1)!.message).toMatch(/Pozastaveno — pozastaveno — Čeká na materiál/);
    const r = await x.resumeJob(jobId);
    expect(r).toMatchObject({ ok: true, stage: "potvrzeno" });
    j = await job(jobId);
    expect([j.status, j.hold_reason, j.order_status]).toEqual(["potvrzeno", null, "potvrzena"]);
    expect((await x.resumeJob(jobId)).ok).toBe(false);
  });

  it("Reklamace: oprava vrátí kusy k dodání, po dodání „vyřízena“ zpět do Vyfakturováno; dobropis hned zpět", async () => {
    const jobId = await newJob();
    const item = await addItem(jobId);
    await setStage(jobId, "potvrzeno");
    await svc.from("order_items").update({ delivered_quantity: 10 }).eq("id", item);
    await setStage(jobId, "fakturovano", { invoice_number: `${PREFIX}-FV` });
    as("worker");
    expect((await x.openClaim(jobId, { reason: "rozmery", note: "" })).ok).toBe(false);
    const o = await x.openClaim(jobId, { reason: "rozmery", qty: 3, itemId: item, note: "3 ks mimo toleranci" });
    expect(o).toMatchObject({ ok: true, stage: "reklamace" });
    let j = await job(jobId);
    expect([j.claim_from_stage, j.claim_reason, Number(j.claim_qty), j.claim_opened_by, j.invoice_number]).toEqual(["fakturovano", "rozmery", 3, id("worker"), `${PREFIX}-FV`]);
    expect((await x.openClaim(jobId, { reason: "rozmery", note: "znovu" })).ok).toBe(false);
    const fix = await x.resolveClaim(jobId, { resolution: "oprava", note: "přebrousit" });
    expect(fix).toMatchObject({ ok: true, stage: "reklamace" });
    expect(Number(((await svc.from("order_items").select("delivered_quantity").eq("id", item).single()).data as Row).delivered_quantity)).toBe(7);
    // výroba a znovu dodáno (zkráceně): reklamace → Ve výrobě → dodáno vše → Dodáno zákazníkovi
    await setStage(jobId, "ve_vyrobe");
    await svc.from("order_items").update({ delivered_quantity: 10 }).eq("id", item);
    j = await job(jobId);
    expect(j.status).toBe("dodano_zakaznikovi");
    expect(j.invoice_number).toBe(`${PREFIX}-FV`);
    const close = await x.closeClaim(jobId, { note: "opraveno" });
    expect(close).toMatchObject({ ok: true, stage: "fakturovano" });
    j = await job(jobId);
    expect([j.status, j.claim_resolution, Boolean(j.claim_resolved_at), j.claim_resolved_by]).toEqual(["fakturovano", "oprava", true, id("worker")]);

    // druhá reklamace: dobropis → hned zpět
    as("sales");
    expect((await x.openClaim(jobId, { reason: "povrch", note: "škrábance" })).ok).toBe(true);
    expect((await x.resolveClaim(jobId, { resolution: "dobropis" })).ok).toBe(false);
    const credit = await x.resolveClaim(jobId, { resolution: "dobropis", note: "DOB-1" });
    expect(credit).toMatchObject({ ok: true, stage: "fakturovano" });
    expect((await job(jobId)).claim_resolution).toBe("dobropis");
  });

  it("Výroba se nepovedla: zmetek v historii, zrušit zakázku s důvodem „Výroba se nepovedla“", async () => {
    const jobId = await newJob();
    const item = await addItem(jobId);
    await setStage(jobId, "potvrzeno");
    await setStage(jobId, "ve_vyrobe");
    as("worker");
    const r = await x.recordProductionFailure(jobId, { itemId: item, qty: 2, reason: "Chyba výroby", next: "remake" });
    expect(r).toMatchObject({ ok: true, handoff: "plan" });
    expect((await events(jobId)).some((e) => e.data?.exception === "production_failed" && /2 ks z 10/.test(e.message))).toBe(true);
    expect((await x.recordProductionFailure(jobId, { reason: "Chyba", next: "cancel" })).ok).toBe(false);
    expect((await x.recordProductionFailure(jobId, { itemId: item, qty: 20, reason: "Chyba", next: "short" })).ok).toBe(false);
    as("sales");
    const c = await x.recordProductionFailure(jobId, { reason: "Vada materiálu", note: "praskliny", next: "cancel" });
    expect(c).toMatchObject({ ok: true, stage: "zruseno" });
    const j = await job(jobId);
    expect([j.status, j.lost_reason, j.order_status]).toEqual(["zruseno", "vyroba", "stornovana"]);
  });

  it("Vyrábět bez objednávky: příznak, potvrzení bez čísla ne; číslo objednávky (jakoukoli cestou) příznak zruší", async () => {
    const jobId = await newJob();
    as("worker");
    const s = await x.startWithoutCustomerPo(jobId, { note: "zákazník napsal vyrábějte" });
    expect(s).toMatchObject({ ok: true, stage: "objednavka" });
    let j = await job(jobId);
    expect([j.awaiting_customer_po, j.order_status, j.awaiting_po_by, j.awaiting_po_note]).toEqual([true, "dorucena", id("worker"), "zákazník napsal vyrábějte"]);
    expect(j.awaiting_po_since).toBeTruthy();
    expect((await x.startWithoutCustomerPo(jobId)).ok).toBe(false);
    // ve výrobě (zkráceně) — objednávka dorazí přímým zápisem čísla (foto / pošta / ruční úprava)
    await setStage(jobId, "ve_vyrobe");
    await svc.from("orders").update({ customer_order_number: "PO-4711" }).eq("id", jobId);
    j = await job(jobId);
    expect([j.awaiting_customer_po, Boolean(j.customer_po_received_at), j.status]).toEqual([false, true, "ve_vyrobe"]);
    expect((await events(jobId)).some((e) => e.data?.exception === "po_received" && /PO-4711/.test(e.message))).toBe(true);

    // ruční zápis „Objednávka zákazníka dorazila"
    const job2 = await newJob({ status: "nabidka" });
    await x.startWithoutCustomerPo(job2);
    const reg = await x.registerCustomerPo(job2, { number: "PO-9", date: "2026-10-30" });
    expect(reg.ok).toBe(true);
    const j2 = await job(job2);
    expect([j2.awaiting_customer_po, j2.customer_order_number, j2.order_date]).toEqual([false, "PO-9", "2026-10-30"]);
    // příznak nejde nastavit zakázce, která číslo už má
    await svc.from("orders").update({ awaiting_customer_po: true }).eq("id", job2);
    expect((await job(job2)).awaiting_customer_po).toBe(false);
  });

  it("Oprava zakázky: množství + termín → revize objednávky (přijatá), hodnota přepočtena, chip Opraveno", async () => {
    const jobId = await newJob();
    const item = await addItem(jobId, { quantity: 10, unit_price: 100 });
    await setStage(jobId, "potvrzeno", { value: 1000, due_date: "2026-11-12", confirmation_sent_at: new Date().toISOString(), confirmation_sent_revision: 1 });
    as("sales");
    expect((await x.correctOrder(jobId, { reason: "x", items: [] })).ok).toBe(false);
    expect((await x.correctOrder(jobId, { reason: "beze změny", items: [{ id: item, quantity: 10 }] })).ok).toBe(false);
    const r = await x.correctOrder(jobId, { reason: "Zákazník změnil množství", items: [{ id: item, quantity: 15, unitPrice: 90 }], dueDate: "2026-11-20" });
    expect(r.ok).toBe(true);
    if (!r.ok || !r.changes) throw new Error("bez výsledku");
    expect(r.changes.map((c) => c.field)).toEqual([`item:${item}:quantity`, `item:${item}:unit_price`, "due_date"]);
    expect(r.confirmationSent).toBe(true);
    const j = await job(jobId);
    expect([Number(j.value), j.due_date, j.order_status, j.order_revision, j.order_confirmed_revision, j.corrected_by]).toEqual([1350, "2026-11-20", "potvrzena", 2, 2, id("sales")]);
    expect(j.corrected_note).toBe("Zákazník změnil množství");
    const rev = (await svc.from("job_order_revisions").select("revision, decision, changes").eq("job_id", jobId).eq("revision", 2).single()).data as Row;
    expect(rev.decision).toBe("prijata");
    expect((await events(jobId)).some((e) => e.data?.exception === "correction" && /množství: 10 → 15/.test(e.message))).toBe(true);
  });

  it("Aktualizace výkresu: revize položky → změna, štítek na zakázce, soubor nahrazen, Beru na vědomí", async () => {
    const jobId = await newJob();
    const item = await addItem(jobId);
    // přímá změna revize (foto, pošta, ruční úprava položky) = nová revize výkresu
    await svc.from("order_items").update({ revision: "03" }).eq("id", item);
    let j = await job(jobId);
    expect(j.drawing_changes_open).toBe(1);
    const auto = (await svc.from("job_drawing_changes").select("*").eq("job_id", jobId)).data as Row[];
    expect(auto.map((c) => [c.rev_from, c.rev_to, c.drawing_number])).toEqual([["02", "03", "F0N603W88"]]);
    // ruční aktualizace se souborem: starý výkres → nahrazený
    const { data: f1 } = await svc.from("job_files").insert({ job_id: jobId, kind: "vykres", filename: "F0N603W88_02.pdf", storage_path: `zakazky/${jobId}/a-F0N603W88_02.pdf`, version: 1 }).select("id").single();
    const { data: f2 } = await svc.from("job_files").insert({ job_id: jobId, kind: "vykres", filename: "F0N603W88_04.pdf", storage_path: `zakazky/${jobId}/b-F0N603W88_04.pdf`, version: 1 }).select("id").single();
    as("worker");
    expect((await x.recordDrawingRevision(jobId, { itemId: item, revision: "03" })).ok).toBe(false);
    const r = await x.recordDrawingRevision(jobId, { itemId: item, revision: "04", fileId: (f2 as { id: string }).id, note: "tolerance díry" });
    expect(r.ok).toBe(true);
    const old = (await svc.from("job_files").select("archived, replaced_by, note").eq("id", (f1 as { id: string }).id).single()).data as Row;
    expect(old).toMatchObject({ archived: true, replaced_by: (f2 as { id: string }).id, note: "nahrazeno rev. 04" });
    const nf = (await svc.from("job_files").select("order_item_id, version").eq("id", (f2 as { id: string }).id).single()).data as Row;
    expect(nf).toMatchObject({ order_item_id: item, version: 2 });
    const ch = (await svc.from("job_drawing_changes").select("*").eq("job_id", jobId).order("created_at")).data as Row[];
    expect(ch.at(-1)).toMatchObject({ rev_from: "03", rev_to: "04", file_id: (f2 as { id: string }).id, old_file_id: (f1 as { id: string }).id, note: "tolerance díry", created_by: id("worker") });
    j = await job(jobId);
    expect(j.drawing_changes_open).toBe(2);
    expect((await events(jobId)).filter((e) => e.data?.exception === "drawing_revision").length).toBe(2);
    // Beru na vědomí (jedna) → zbývá 1; pak všechny
    expect((await x.acknowledgeDrawingChanges(jobId, { changeId: ch[0].id as string })).ok).toBe(true);
    expect((await job(jobId)).drawing_changes_open).toBe(1);
    const all = await x.acknowledgeDrawingChanges(jobId);
    expect(all).toMatchObject({ ok: true, count: 1 });
    expect((await job(jobId)).drawing_changes_open).toBe(0);
    const acked = (await svc.from("job_drawing_changes").select("acknowledged_by").eq("job_id", jobId)).data as Row[];
    expect(acked.every((a) => a.acknowledged_by === id("worker"))).toBe(true);
    expect((await events(jobId)).some((e) => e.data?.exception === "drawing_revision_ack" && e.actor_id === id("worker"))).toBe(true);
  });
});
