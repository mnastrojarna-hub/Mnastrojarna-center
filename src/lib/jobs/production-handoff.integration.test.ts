import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HandoffInput, HandoffPlan, HandoffStepInput } from "@/lib/jobs/production-handoff-types";

/**
 * Předání do výroby — serverové jádro a akce (WP2) proti lokálnímu Supabase: předání s krokem u dodavatele
 * (kroky + objednávka s položkami z nabídky + fronta + události atomicky přes production_apply), PDF po potvrzení
 * transakce do Dokumentů, opakování tokenu nikdy neodesílá podruhé, režim „se schválením" vs. plná automatika,
 * krok u nás bez objednávky, dva kroky stejné firmy = jedna objednávka, existující objednávka z Nákupu se použije
 * (druhá = po_duplicate), změna dodavatele / termínu po vystavení (neodeslaná → nové PDF; odeslaná → změna ve
 * frontě), vrácení předání, doplnění ceny u odeslané objednávky přepočte provizi, focení potvrzení dodavatele,
 * zaměstnanec předá, ale ceny nevidí, schválení ve frontě ze schránky obchodníka zakázky, další krok po dodání.
 * Skutečný PostgREST a SMTP (lokální mailcatcher); mockuje se jen přihlášení a revalidace Next.js.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/jobs/production-handoff.integration.test.ts
 */

const ENABLED = process.env.LOCAL_SUPABASE === "1";
const TAG = Date.now().toString(36);
const PREFIX = `Z-E2E-HO-${TAG}`;
const SUP = `E2E-HO ${TAG}`;
const mailOf = (k: string) => `e2e-ho-${TAG}-${k}@local.test`;

type U = "sales" | "worker" | "admin" | "sales2";
const who = vi.hoisted(() => ({
  users: {} as Record<string, { id: string; email: string; fullName: string; role: "super_admin" | "obchodnik" | "zamestnanec" }>,
  current: "sales" as "sales" | "worker" | "admin" | "sales2",
}));
// skutečné SMTP (mailcatcher); test souběhu jen zdrží odeslání (dvojklik během SMTP)
const mailCtl = vi.hoisted(() => ({ delayMs: 0 }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/email/send", async (orig) => {
  const actual = await orig<typeof import("@/lib/email/send")>();
  return {
    ...actual,
    sendMail: async (input: Parameters<typeof actual.sendMail>[0]) => {
      if (mailCtl.delayMs) await new Promise((r) => setTimeout(r, mailCtl.delayMs));
      return actual.sendMail(input);
    },
  };
});

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

type Row = Record<string, unknown>;
type Actions = typeof import("@/app/actions/production-handoff");
type Purchasing = typeof import("@/app/actions/purchasing");
type Production = typeof import("@/app/actions/production");
type Approvals = typeof import("@/app/actions/approvals");
type Store = typeof import("@/lib/jobs/production-handoff-store");
type Flow = typeof import("@/lib/jobs/capture-flow");
type PStore = typeof import("@/lib/jobs/purchasing-store");

describe.skipIf(!ENABLED)("předání do výroby — server (WP2) ↔ lokální Supabase", () => {
  let svc: SupabaseClient;
  let act: Actions;
  let pur: Purchasing;
  let prod: Production;
  let appr: Approvals;
  let store: Store;
  let flow: Flow;
  let pstore: PStore;
  let mailApi = "";
  const jobs: string[] = [];
  const suppliers: string[] = [];
  let n = 0;
  let novak = "";
  let hruby = "";
  let tepkal = "";
  let nomail = "";
  let modeBefore: string | null = null;

  const as = (u: U) => { who.current = u; };
  const id = (u: U) => who.users[u].id;

  async function newSupplier(name: string, email: string | null, technologies: string[] = []): Promise<string> {
    const { data, error } = await svc.from("suppliers").insert({ name: `${SUP} ${name}`, email, technologies }).select("id").single();
    if (error) throw new Error(error.message);
    suppliers.push((data as { id: string }).id);
    return (data as { id: string }).id;
  }

  async function newJob(patch: Row = {}): Promise<{ id: string; items: string[] }> {
    n += 1;
    const { data, error } = await svc.from("orders").insert({
      number: `${PREFIX}-${n}`, title: `Předání ${n}`, source: "manual", status: "potvrzeno", order_date: "2026-10-20",
      owner_id: id("sales"), value: 60_000, currency: "CZK", due_date: "2026-12-18", ...patch,
    }).select("id").single();
    if (error) throw new Error(error.message);
    const jid = (data as { id: string }).id;
    jobs.push(jid);
    const { data: items, error: ie } = await svc.from("order_items").insert([
      { order_id: jid, position: 0, drawing_number: `PR-${TAG}-20`, name: "Příruba", material: "1.2379", material_designation: "1.2379", quantity: 200, unit: "ks", weight_kg: 1.2, heat_treatment: "kalit 58–60 HRC" },
      { order_id: jid, position: 1, drawing_number: `PR-${TAG}-21`, name: "Pouzdro", material: "11 523", quantity: 100, unit: "ks" },
    ]).select("id, position");
    if (ie) throw new Error(ie.message);
    return { id: jid, items: ((items ?? []) as { id: string; position: number }[]).sort((a, b) => a.position - b.position).map((r) => r.id) };
  }

  async function newQuote(jobId: string, supplierId: string, prices: [number | null, number | null], over: Row = {}): Promise<string> {
    const { data, error } = await svc.from("supplier_quotes").insert({
      job_id: jobId, supplier_id: supplierId, number: `NAB-${TAG}-${n}-${Math.random().toString(36).slice(2, 6)}`, currency: "CZK",
      lead_time_days: 21, source: "manual", total: (prices[0] ?? 0) * 200 + (prices[1] ?? 0) * 100, note: "frézování", ...over,
    }).select("id").single();
    if (error) throw new Error(error.message);
    const qid = (data as { id: string }).id;
    await svc.from("supplier_quote_items").insert([
      { supplier_quote_id: qid, position: 0, drawing_number: `PR-${TAG}-20`, name: "Příruba", quantity: 200, unit: "ks", unit_price: prices[0] },
      { supplier_quote_id: qid, position: 1, drawing_number: `PR-${TAG}-21`, name: "Pouzdro", quantity: 100, unit: "ks", unit_price: prices[1] },
    ]);
    return qid;
  }

  const job = async (jid: string) => ((await svc.from("orders").select("*").eq("id", jid).single()).data as Row);
  const ops = async (jid: string) => ((await svc.from("job_operations").select("*").eq("job_id", jid).order("position").order("created_at")).data ?? []) as Row[];
  // objednávky jednoho předání mají stejný čas transakce → pořadí podle čísla (OV přiděluje RPC postupně)
  const pos = async (jid: string) => ((await svc.from("purchase_orders").select("*, items:purchase_order_items(*)").eq("job_id", jid).order("created_at").order("number")).data ?? []) as Row[];
  const queue = async (jid: string) => ((await svc.from("approval_queue").select("*").eq("order_id", jid).order("created_at")).data ?? []) as Row[];
  const events = async (jid: string) => ((await svc.from("job_events").select("*").eq("job_id", jid).order("created_at")).data ?? []) as Row[];
  const files = async (jid: string) => ((await svc.from("job_files").select("*").eq("job_id", jid).order("created_at")).data ?? []) as Row[];
  const emails = async (jid: string) => ((await svc.from("emails").select("id, mailbox_id, subject, to_email").eq("order_id", jid)).data ?? []) as Row[];
  async function inbox(to: string): Promise<Row[]> {
    const r = await fetch(`${mailApi}/messages?to=${encodeURIComponent(to)}`);
    return (await r.json()) as Row[];
  }
  async function setMode(mode: "full" | "approval") {
    await svc.from("automation_settings").upsert({ module: "purchase_order", mode, enabled: true }, { onConflict: "module" });
  }

  async function plan(jid: string, opts: Parameters<Actions["prepareProductionHandoff"]>[1] = {}): Promise<HandoffPlan> {
    const r = await act.prepareProductionHandoff(jid, opts);
    expect(r.ok, r.error).toBe(true);
    return r.plan!;
  }
  function inputOf(p: HandoffPlan, over: Partial<HandoffInput> = {}, steps?: HandoffStepInput[]): HandoffInput {
    return {
      token: p.token, kind: p.kind, expectedStage: p.stage, expectedRouteVersion: p.routeVersion,
      steps: steps ?? p.steps.map((s) => ({ ...s })), ...over,
    };
  }
  function supplierStep(supplierId: string, plannedEnd: string, over: Partial<HandoffStepInput> = {}): HandoffStepInput {
    return {
      kind: "vyroba", who: { type: "supplier", id: supplierId }, plannedEnd, endsAtCustomerDate: false, deadlineAgreed: false,
      deadlineSource: "rucne", whoSource: "rucne", start: true, po: { mode: "vystavit" }, ...over,
    };
  }
  async function route(jid: string): Promise<string> {
    return String((await svc.rpc("production_route_version", { p_job: jid })).data ?? "");
  }
  async function manualInput(jid: string, steps: HandoffStepInput[], over: Partial<HandoffInput> = {}): Promise<HandoffInput> {
    const j = await job(jid);
    return { token: randomUUID(), kind: "predani", expectedStage: j.status as never, expectedRouteVersion: await route(jid), steps, ...over };
  }

  beforeAll(async () => {
    const local = await import("@/test/local-supabase");
    const env = local.loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    mailApi = env.LOCAL_MAIL_API ?? "http://127.0.0.1:54324";
    svc = local.localAdmin();
    const { data } = await svc.from("profiles").select("id, email, full_name, role").in("email", [local.DEMO.sales.email, local.DEMO.worker.email, local.DEMO.admin.email]);
    for (const r of (data ?? []) as { id: string; email: string; full_name: string; role: "super_admin" | "obchodnik" | "zamestnanec" }[]) {
      const key = r.role === "super_admin" ? "admin" : r.role === "obchodnik" ? "sales" : "worker";
      who.users[key] = { id: r.id, email: r.email, fullName: r.full_name, role: r.role };
    }
    // druhý obchodník (cizí zakázka) — jiný aktivní obchodník lokální databáze, když je
    const { data: other } = await svc.from("profiles").select("id, email, full_name, role, active").eq("role", "obchodnik").neq("email", local.DEMO.sales.email).limit(1);
    const o2 = ((other ?? []) as { id: string; email: string; full_name: string; active: boolean | null }[])[0];
    if (o2 && o2.active !== false) who.users.sales2 = { id: o2.id, email: o2.email, fullName: o2.full_name, role: "obchodnik" };
    const { data: m } = await svc.from("automation_settings").select("mode").eq("module", "purchase_order").maybeSingle();
    modeBefore = (m as { mode: string } | null)?.mode ?? null;
    await setMode("approval");
    novak = await newSupplier("Frézy Novák s.r.o.", mailOf("novak"), ["frezovani_3osy"]);
    hruby = await newSupplier("Kovoobrábění Hrubý s.r.o.", mailOf("hruby"), ["soustruzeni"]);
    tepkal = await newSupplier("TepKal s.r.o.", mailOf("tepkal"), ["tepelne_zpracovani"]);
    nomail = await newSupplier("Bez Mailu s.r.o.", null, ["frezovani_3osy"]);
    act = await import("@/app/actions/production-handoff");
    pur = await import("@/app/actions/purchasing");
    prod = await import("@/app/actions/production");
    appr = await import("@/app/actions/approvals");
    store = await import("@/lib/jobs/production-handoff-store");
    flow = await import("@/lib/jobs/capture-flow");
    pstore = await import("@/lib/jobs/purchasing-store");
  }, 60_000);

  afterAll(async () => {
    if (!svc) return;
    if (modeBefore) await setMode(modeBefore as "full" | "approval");
    if (jobs.length) {
      const { data: fl } = await svc.from("job_files").select("storage_path").in("job_id", jobs);
      const paths = ((fl ?? []) as { storage_path: string | null }[]).map((f) => f.storage_path).filter((p): p is string => Boolean(p));
      if (paths.length) await svc.storage.from("job-files").remove(paths);
      await svc.from("approval_queue").delete().in("order_id", jobs);
      await svc.from("emails").delete().in("order_id", jobs);
      await svc.from("orders").delete().in("id", jobs);
      await svc.from("audit_log").delete().in("entity_id", jobs);
      await svc.from("audit_log").delete().in("diff->>jobId", jobs);
    }
    const { data: extra } = await svc.from("suppliers").select("id").like("name", `${SUP}%`);
    const all = [...new Set([...suppliers, ...((extra ?? []) as { id: string }[]).map((s) => s.id)])];
    if (all.length) {
      await svc.from("suppliers").delete().in("id", all);
      await svc.from("audit_log").delete().in("entity_id", all);
    }
  }, 120_000);

  // ── 1. předání s krokem u dodavatele ──────────────────────
  let A: { id: string; items: string[] } = { id: "", items: [] };
  let aPo = "";
  let aToken = "";

  it("plán: nejlevnější srovnatelná nabídka primárně (i proti vítězi z Nákupu), termín z nabídky, objednávka teď, bez cen jen pro zaměstnance", async () => {
    A = await newJob();
    const cheap = await newQuote(A.id, novak, [40, 42]);                    // 8 000 + 4 200 = 12 200
    const dear = await newQuote(A.id, hruby, [50, 50], { selected: true, note: "soustružení" }); // vítěz Nákupu, dražší
    as("sales");
    const p = await plan(A.id);
    expect(p.kind).toBe("predani");
    expect(p.permissions.canSeePrices).toBe(true);
    expect(p.steps.length).toBeGreaterThanOrEqual(1);
    const s1 = p.steps[0];
    expect(s1.who).toMatchObject({ type: "supplier", id: novak });
    expect(s1.whoSource).toBe("nejlevnejsi_nabidka");
    expect(s1.supplierQuoteId).toBe(cheap);
    expect(s1.start).toBe(true);
    expect(s1.po.mode).toBe("vystavit");
    expect(s1.deadlineState).toBe("odhad");
    expect(s1.plannedEnd).toBeTruthy();
    expect(s1.suggestions.primary?.price).toBe(12_200);
    expect(s1.suggestions.alternatives[0]).toMatchObject({ supplierQuoteId: dear });
    expect(s1.poPreview).toMatchObject({ itemCount: 2, unpriced: 0, total: 12_200 });

    as("worker");
    const pw = await plan(A.id);
    expect(pw.permissions.canSeePrices).toBe(false);
    expect(pw.steps[0].suggestions.primary?.price).toBeNull();
    expect(pw.steps[0].suggestions.primary?.reason).toBe("Doporučeno podle nabídek");
    expect(pw.steps[0].poPreview?.total).toBeNull();
    expect(JSON.stringify(pw)).not.toMatch(/12\s?200/);
  }, 60_000);

  it("předání: kroky + objednávka (ceny z nabídky, díly) + fronta + události atomicky; PDF „Objednávka“ po potvrzení; e-mail ve frontě (se schválením)", async () => {
    as("sales");
    const p = await plan(A.id);
    const input = inputOf(p, {}, [{ ...p.steps[0], plannedEnd: "2026-11-20" }]);
    aToken = input.token;
    const r = await act.submitProductionHandoff(A.id, input);
    expect(r.ok, r.error).toBe(true);
    const res = r.result!;
    expect(res).toMatchObject({ replayed: false, kind: "predani", stage: "ve_vyrobe" });
    expect(res.purchaseOrders).toHaveLength(1);
    expect(res.purchaseOrders[0]).toMatchObject({ pdf: "ok", send: "ceka_na_schvaleni" });
    expect(res.purchaseOrders[0].fileId).toBeTruthy();

    const [po] = await pos(A.id);
    aPo = String(po.id);
    expect(po).toMatchObject({ status: "vystavena", supplier_id: novak, total: 12_200, created_by: id("sales"), required_date: "2026-11-20", handoff_id: res.handoffId });
    const items = (po.items as Row[]).sort((a, b) => Number(a.position) - Number(b.position));
    expect(items.map((i) => [i.drawing_number, Number(i.quantity), Number(i.unit_price), i.order_item_id])).toEqual([
      [`PR-${TAG}-20`, 200, 40, A.items[0]], [`PR-${TAG}-21`, 100, 42, A.items[1]],
    ]);
    expect(String(po.note)).toContain(`Objednávka k naší zakázce ${PREFIX}-1`);
    expect(String(po.note)).toMatch(/Operace: Výroba/);

    const o = await ops(A.id);
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({ status: "probiha", supplier_id: novak, purchase_order_id: aPo, po_mode: "vystavit", deadline_state: "odhad", created_by: id("sales"), handoff_id: res.handoffId });
    expect((await job(A.id))).toMatchObject({ status: "ve_vyrobe", supplier_id: novak });

    const q = await queue(A.id);
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ type: "purchase_order", status: "pending", owner_id: id("sales"), purchase_order_id: aPo, target: mailOf("novak") });
    const payload = q[0].payload as Row;
    expect(payload).toMatchObject({ kind: "issue", number: po.number, to: mailOf("novak") });
    expect(String(payload.subject)).toMatch(/^Objednávka OV-/);
    expect(String(payload.body)).toContain("Petr Obchodník");

    const f = (await files(A.id)).find((x) => x.id === po.file_id)!;
    expect(f).toMatchObject({ kind: "objednavka_vydana", issuer: "my", origin: "generated", uploaded_by: id("sales") });
    // nákupní doklad (#25): obsah zamčený pro uživatele bez práva na marže
    const priceIds = (await svc.rpc("job_file_price_ids", { p_ids: [String(f.id)] })).data as string[] | null;
    expect((priceIds ?? []).map((x) => x.toLowerCase())).toContain(String(f.id).toLowerCase());
    const blob = await svc.storage.from("job-files").download(String(f.storage_path));
    const buf = Buffer.from(await blob.data!.arrayBuffer());
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    if (process.env.PDF_PREVIEW_DIR) {
      const { writeFileSync, mkdirSync } = await import("node:fs");
      mkdirSync(process.env.PDF_PREVIEW_DIR, { recursive: true });
      writeFileSync(`${process.env.PDF_PREVIEW_DIR}/objednavka-predani.pdf`, buf);
    }

    const ev = await events(A.id);
    const msgs = ev.map((e) => String(e.message));
    expect(msgs.some((m) => /^Předáno do výroby: 1\) Výroba · .*Frézy Novák/.test(m))).toBe(true);
    expect(msgs.some((m) => m.startsWith(`Vystavena objednávka ${po.number} dodavateli`))).toBe(true);
    expect(msgs.some((m) => m.startsWith("Stav:") && m.includes("Ve výrobě"))).toBe(true);
    expect(msgs.some((m) => m === `Objednávka ${po.number} čeká na odeslání (schválení)`)).toBe(true);
    expect(ev.every((e) => !/12\s?200|Kč/.test(String(e.message)))).toBe(true);
    const summary = ev.find((e) => (e.data as Row)?.production === "predani")!;
    expect(summary).toMatchObject({ actor_id: id("sales") });
    const h = (await svc.from("production_handoffs").select("*").eq("id", res.handoffId).single()).data as Row;
    expect(h).toMatchObject({ created_by: id("sales"), kind: "predani", stage_from: "potvrzeno", stage_to: "ve_vyrobe" });
    expect((h.result as Row).replayed).toBe(false);
    const { data: audit } = await svc.from("audit_log").select("action").eq("entity_id", res.handoffId);
    expect(((audit ?? []) as Row[]).map((a) => a.action)).toContain("production_handoff");
    expect(await emails(A.id)).toHaveLength(0);                                   // se schválením: nic neodešlo
  }, 90_000);

  it("opakování tokenu (dvojklik / síť) jen doplní dokumenty — po ztraceném PDF ho vytvoří znovu a nikdy neodešle", async () => {
    as("sales");
    const before = (await pos(A.id))[0];
    // simulované selhání PDF po potvrzení: objednávka bez PDF
    await svc.from("purchase_orders").update({ file_id: null }).eq("id", aPo);
    const p = await plan(A.id);
    const r = await act.submitProductionHandoff(A.id, { ...inputOf(p), token: aToken, kind: "predani", expectedStage: "potvrzeno" });
    expect(r.ok, r.error).toBe(true);
    expect(r.result!.replayed).toBe(true);
    expect(await pos(A.id)).toHaveLength(1);
    const after = (await pos(A.id))[0];
    expect(after.file_id).toBeTruthy();
    expect(after.file_id).not.toBe(before.file_id);
    expect(r.result!.purchaseOrders[0]).toMatchObject({ id: aPo, send: "ceka_na_schvaleni" });
    expect((await queue(A.id)).filter((x) => x.status === "pending")).toHaveLength(1);
    expect(await emails(A.id)).toHaveLength(0);
    // souběh dvou stejných tokenů: jedno předání, jedna objednávka, žádný e-mail
    const B = await newJob();
    await newQuote(B.id, novak, [40, 42]);
    const pb = await plan(B.id);
    const ib = inputOf(pb, { sendNow: ["*"] });
    const [x, y] = await Promise.all([act.submitProductionHandoff(B.id, ib), act.submitProductionHandoff(B.id, ib)]);
    expect(x.ok && y.ok, `${x.error} ${y.error}`).toBe(true);
    expect([x.result!.replayed, y.result!.replayed].sort()).toEqual([false, true]);
    expect(await pos(B.id)).toHaveLength(1);
    expect(await emails(B.id)).toHaveLength(1);                                   // sendNow jen v prvním (neopakovaném) volání
    expect(await inbox(mailOf("novak"))).toEqual(expect.arrayContaining([expect.objectContaining({ subject: expect.stringMatching(/^Objednávka OV-/) })]));
    // ruční opakování „Zkusit znovu" (ensureHandoffDocuments) nikdy neposílá
    const e = await act.ensureHandoffDocuments(B.id, x.result!.handoffId);
    expect(e.ok, e.error).toBe(true);
    expect(await emails(B.id)).toHaveLength(1);
  }, 120_000);

  it("„Rovnou odeslat“ (obchodník): objednávka odeslána z jeho schránky, fronta schválena, stav termínu kroku = požadováno", async () => {
    const C = await newJob();
    await newQuote(C.id, novak, [40, 42]);
    as("sales");
    const p = await plan(C.id);
    const r = await act.submitProductionHandoff(C.id, inputOf(p, { sendNow: [p.steps[0].key] }));
    expect(r.ok, r.error).toBe(true);
    expect(r.result!.purchaseOrders[0].send).toBe("odeslano");
    const [po] = await pos(C.id);
    expect(po.status).toBe("odeslana");
    expect(po.sent_mailbox_id).toBeTruthy();
    const box = (await svc.from("mailboxes").select("owner_id").eq("id", po.sent_mailbox_id as string).single()).data as Row;
    expect(box.owner_id).toBe(id("sales"));
    expect((await queue(C.id))[0]).toMatchObject({ status: "approved", resolved_by: id("sales") });
    expect((await ops(C.id))[0].deadline_state).toBe("pozadovano");
  }, 90_000);

  it("plná automatika: bezpečná objednávka odejde sama; s položkou bez ceny čeká ve frontě s důvodem", async () => {
    await setMode("full");
    try {
      as("sales");
      const D = await newJob();
      await newQuote(D.id, novak, [40, 42]);
      const pd = await plan(D.id);
      expect(pd.automation).toMatchObject({ mode: "full", sendDefault: true });
      const r = await act.submitProductionHandoff(D.id, inputOf(pd));
      expect(r.ok, r.error).toBe(true);
      expect(r.result!.purchaseOrders[0].send).toBe("odeslano");
      expect((await queue(D.id))[0].status).toBe("auto_executed");
      expect((await pos(D.id))[0].status).toBe("odeslana");

      const E = await newJob();
      await newQuote(E.id, novak, [40, null]);                                  // pouzdro bez ceny
      const pe = await plan(E.id);
      expect(pe.steps[0].poPreview?.blockers).toEqual(expect.arrayContaining(["1 položka bez ceny"]));
      const re = await act.submitProductionHandoff(E.id, inputOf(pe));
      expect(re.ok, re.error).toBe(true);
      expect(re.result!.purchaseOrders[0].send).toBe("ceka_na_schvaleni");
      const q = (await queue(E.id))[0];
      expect(q.status).toBe("pending");
      expect(String(q.summary)).toContain("Neodesláno automaticky: 1 položka bez ceny");
      expect(await emails(E.id)).toHaveLength(0);

      // zaměstnanec v plné automatice: objednávka vznikne (jeho), čeká ve frontě, ceny nevidí
      as("worker");
      const W = await newJob();
      await newQuote(W.id, novak, [40, 42]);
      const pw = await plan(W.id);
      const rw = await act.submitProductionHandoff(W.id, inputOf(pw));
      expect(rw.ok, rw.error).toBe(true);
      expect(rw.result!.purchaseOrders[0].send).toBe("ceka_na_schvaleni");
      expect(JSON.stringify(rw.result)).not.toMatch(/12\s?200/);
      const [wpo] = await pos(W.id);
      expect(wpo).toMatchObject({ created_by: id("worker"), status: "vystavena", total: 12_200 });   // ceny staví server
      expect((await queue(W.id))[0]).toMatchObject({ status: "pending", owner_id: id("sales") });
      expect(await emails(W.id)).toHaveLength(0);
      // zaměstnanec nesmí poslat hned ani zapsat převzetí
      const W2 = await newJob();
      await newQuote(W2.id, novak, [40, 42]);
      const pw2 = await plan(W2.id);
      const forb = await act.submitProductionHandoff(W2.id, inputOf(pw2, { sendNow: ["*"] }));
      expect(forb).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await pos(W2.id)).toHaveLength(0);
      const forb2 = await act.sendStepPurchaseOrder(String(wpo.id));
      expect(forb2).toMatchObject({ ok: false, code: "FORBIDDEN" });
    } finally {
      await setMode("approval");
      as("sales");
    }
  }, 150_000);

  it("krok u nás bez objednávky; dva souvislé kroky stejné firmy = jedna objednávka (termín pozdějšího)", async () => {
    as("sales");
    const H = await newJob();
    const rh = await act.submitProductionHandoff(H.id, await manualInput(H.id, [{
      kind: "vyroba", who: { type: "u_nas" }, plannedEnd: "2026-11-20", endsAtCustomerDate: false, deadlineAgreed: false, start: true, po: { mode: null },
    }]));
    expect(rh.ok, rh.error).toBe(true);
    expect(await pos(H.id)).toHaveLength(0);
    expect(await queue(H.id)).toHaveLength(0);
    expect((await ops(H.id))[0]).toMatchObject({ in_house: true, status: "probiha", deadline_state: "plan", po_mode: null });

    const S = await newJob();
    await newQuote(S.id, novak, [40, 42]);
    const rs = await act.submitProductionHandoff(S.id, await manualInput(S.id, [
      supplierStep(novak, "2026-11-20"),
      supplierStep(novak, "2026-11-27", { kind: "brouseni", start: false, po: { mode: "pri_predani", orderNow: true } }),
    ]));
    expect(rs.ok, rs.error).toBe(true);
    const sp = await pos(S.id);
    expect(sp).toHaveLength(1);
    expect(sp[0].required_date).toBe("2026-11-27");
    // dodavatel vidí operace bez našeho interního číslování (review O16)
    expect(String(sp[0].note)).toMatch(/Operace: Výroba \+ Broušení \(krok 1 ze 2\)/);
    expect(String(sp[0].note)).not.toMatch(/Výroba 1/);
    const so = await ops(S.id);
    expect(so.map((o) => o.purchase_order_id)).toEqual([sp[0].id, sp[0].id]);
  }, 90_000);

  it("existující otevřená objednávka z Nákupu se použije (žádná druhá); vystavit novou u stejné firmy = po_duplicate", async () => {
    as("sales");
    const X = await newJob();
    const qid = await newQuote(X.id, novak, [40, 42]);
    const dr = await pur.draftPurchaseOrder(X.id, { supplierQuoteId: qid });
    expect(dr.ok, dr.error).toBe(true);
    const iss = await pur.issuePurchaseOrder(X.id, { ...dr.draft!, requiredDate: "2026-11-20" });
    expect(iss.ok, iss.error).toBe(true);
    const p = await plan(X.id);
    expect(p.steps[0].po).toMatchObject({ mode: "existujici", existingId: iss.id });
    expect(p.steps[0].whoSource).toBe("objednavka");
    // vynucená nová objednávka u stejné firmy → po_duplicate
    const dup = await act.submitProductionHandoff(X.id, inputOf(p, {}, [{ ...p.steps[0], po: { mode: "vystavit" } }]));
    expect(dup).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(dup.issues?.some((i) => i.code === "po_duplicate")).toBe(true);
    expect(await pos(X.id)).toHaveLength(1);
    const ok = await act.submitProductionHandoff(X.id, inputOf(p));
    expect(ok.ok, ok.error).toBe(true);
    expect(await pos(X.id)).toHaveLength(1);
    expect((await ops(X.id))[0]).toMatchObject({ purchase_order_id: iss.id, po_mode: "existujici" });
    expect((await events(X.id)).some((e) => String(e.message).startsWith(`Objednávka ${iss.number} přiřazena ke kroku`))).toBe(true);
  }, 90_000);

  it("změna termínu / dodavatele po vystavení: neodeslaná → požadovaný termín + nové PDF; zaměstnanec dodavatele nezmění; odeslaná → změna ve frontě (jedna)", async () => {
    as("sales");
    const Y = await newJob();
    await newQuote(Y.id, novak, [40, 42]);
    await newQuote(Y.id, hruby, [45, 45]);
    const p = await plan(Y.id);
    const r = await act.submitProductionHandoff(Y.id, inputOf(p, {}, [{ ...p.steps[0], plannedEnd: "2026-11-20" }]));
    expect(r.ok, r.error).toBe(true);
    const [po0] = await pos(Y.id);
    const op = (await ops(Y.id))[0];
    // termín (jakákoli role): objednávka se upraví mechanicky, PDF nová verze, e-mail ve frontě s novým termínem
    as("worker");
    const u1 = await prod.updateJobOperation(String(op.id), { plannedEnd: "2026-11-27" });
    expect(u1.ok, u1.error).toBe(true);
    let [po1] = await pos(Y.id);
    expect(po1.required_date).toBe("2026-11-27");
    expect(po1.file_id).not.toBe(po0.file_id);
    expect(String(((await queue(Y.id))[0].payload as Row).body)).toContain("27. 11. 2026");
    // dodavatel: zaměstnanec ne
    const u2 = await prod.updateJobOperation(String(op.id), { supplierId: hruby });
    expect(u2.ok).toBe(false);
    expect(u2.error).toMatch(/dodavatele změní obchodník nebo admin/);
    expect((await ops(Y.id))[0].supplier_id).toBe(novak);
    // obchodník: objednávka přejde na Hrubého (položky z jeho nabídky)
    as("sales");
    const u3 = await prod.updateJobOperation(String(op.id), { supplierId: hruby });
    expect(u3.ok, u3.error).toBe(true);
    [po1] = await pos(Y.id);
    expect(po1).toMatchObject({ supplier_id: hruby, total: 13_500, status: "vystavena" });
    expect((await queue(Y.id))[0].target).toBe(mailOf("hruby"));
    // odeslaná: změna termínu = změna objednávky (revize 2), krok „změna čeká", jeden čekající řádek „change"
    const sent = await act.sendStepPurchaseOrder(String(po1.id));
    expect(sent.ok, sent.error).toBe(true);
    as("worker");
    const u4 = await prod.updateJobOperation(String(op.id), { plannedEnd: "2026-12-04" });
    expect(u4.ok, u4.error).toBe(true);
    expect(u4.hint).toMatch(/změna čeká na odeslání/);
    const u5 = await prod.updateJobOperation(String(op.id), { plannedEnd: "2026-12-11" });
    expect(u5.ok, u5.error).toBe(true);
    const [po2] = await pos(Y.id);
    expect(po2).toMatchObject({ status: "odeslana", required_date: "2026-12-11" });
    // dokud změna čeká, další úprava ji jen přepíše: pořád „změna 2" a „mění se z" = termín, který dodavatel zná (review O6)
    expect(Number(po2.revision)).toBe(2);
    expect((await ops(Y.id))[0].deadline_state).toBe("zmena_ceka");
    const changes = (await queue(Y.id)).filter((x) => (x.payload as Row).kind === "change");
    expect(changes).toHaveLength(1);
    expect(changes[0].status).toBe("pending");
    expect(String((changes[0].payload as Row).subject)).toMatch(/^Změna objednávky .* \(změna 2\)/);
    expect((changes[0].payload as Row).previousRequiredDate).toBe("2026-11-27");
    expect(String((changes[0].payload as Row).body)).toContain("mění z 27. 11. 2026 na 11. 12. 2026");
    // obchodník změnu schválí → e-mail změny dodavateli
    as("sales");
    const ok = await appr.resolveApproval(String(changes[0].id), "approved");
    expect(ok, ok.error).toMatchObject({ ok: true, sent: true });
    const changeMail = (await inbox(mailOf("hruby"))).find((m) => /^Změna objednávky/.test(String(m.subject)));
    expect(changeMail).toBeTruthy();
    expect(String(changeMail!.subject)).toMatch(/\(změna 2\)/);
    // další změna po odeslané změně = změna 3, „mění z" = odeslaný termín
    as("worker");
    const u6 = await prod.updateJobOperation(String(op.id), { plannedEnd: "2026-12-14" });
    expect(u6.ok, u6.error).toBe(true);
    expect(Number((await pos(Y.id))[0].revision)).toBe(3);
    const ch3 = (await queue(Y.id)).filter((x) => (x.payload as Row).kind === "change" && x.status === "pending");
    expect(ch3).toHaveLength(1);
    expect(String((ch3[0].payload as Row).body)).toContain("mění z 11. 12. 2026 na 14. 12. 2026");
  }, 150_000);

  it("vrácení předání (nic neodešlo): kroky čekají, objednávka zrušena, fronta zamítnuta, stav zpět; s odeslanou objednávkou ne", async () => {
    as("sales");
    const Z = await newJob();
    await newQuote(Z.id, novak, [40, 42]);
    const p = await plan(Z.id);
    const r = await act.submitProductionHandoff(Z.id, inputOf(p));
    expect(r.ok, r.error).toBe(true);
    const pz = await plan(Z.id, { kind: "zpet" });
    const u = await act.submitProductionHandoff(Z.id, inputOf(pz, { kind: "zpet", undoHandoffId: r.result!.handoffId }, []));
    expect(u.ok, u.error).toBe(true);
    expect((await job(Z.id)).status).toBe("potvrzeno");
    expect((await ops(Z.id))[0]).toMatchObject({ status: "ceka", purchase_order_id: null, po_mode: "vystavit" });
    expect((await pos(Z.id))[0]).toMatchObject({ status: "zrusena", cancel_reason: "Předání vráceno" });
    expect((await queue(Z.id))[0].status).toBe("rejected");

    const Z2 = await newJob();
    await newQuote(Z2.id, novak, [40, 42]);
    const p2 = await plan(Z2.id);
    const r2 = await act.submitProductionHandoff(Z2.id, inputOf(p2, { sendNow: ["*"] }));
    expect(r2.ok, r2.error).toBe(true);
    const pz2 = await plan(Z2.id, { kind: "zpet" });
    const u2 = await act.submitProductionHandoff(Z2.id, inputOf(pz2, { kind: "zpet" }, []));
    expect(u2.ok).toBe(false);
    expect(u2.error).toMatch(/už odešla dodavateli/);
    expect((await job(Z2.id)).status).toBe("ve_vyrobe");
  }, 120_000);

  it("doplnění nákupní ceny u odeslané objednávky (jen ceny) přepočte provizi — „čeká na nákupní cenu“ zmizí", async () => {
    as("sales");
    const P = await newJob();
    await newQuote(P.id, novak, [40, null]);
    const p = await plan(P.id);
    const r = await act.submitProductionHandoff(P.id, inputOf(p, { sendNow: ["*"] }));
    expect(r.ok, r.error).toBe(true);
    const [po] = await pos(P.id);
    expect(po.status).toBe("odeslana");
    const comm0 = (await svc.from("commission_entries").select("cost_known, cost_pending_po, cost").eq("order_id", P.id).single()).data as Row;
    expect(comm0.cost_known).toBe(false);
    expect(comm0.cost_pending_po).toEqual([po.number]);
    const items = (po.items as Row[]).sort((a, b) => Number(a.position) - Number(b.position));
    // položky nejdou změnit…
    const bad = await pur.updatePurchaseOrder(String(po.id), { items: [{ name: "Jiná", quantity: 1 }] });
    expect(bad.error).toMatch(/už odešla dodavateli/);
    // …ale cena ano (a jen ta)
    const ok = await pur.updatePurchaseOrder(String(po.id), { prices: [{ itemId: String(items[1].id), unitPrice: 42 }] });
    expect(ok.ok, ok.error).toBe(true);
    const [po2] = await pos(P.id);
    expect(po2).toMatchObject({ status: "odeslana", total: 12_200 });
    const comm1 = (await svc.from("commission_entries").select("cost_known, cost_pending_po, cost").eq("order_id", P.id).single()).data as Row;
    expect(comm1).toMatchObject({ cost_known: true, cost_pending_po: null });
    expect(Number(comm1.cost)).toBe(12_200);
    expect((await events(P.id)).some((e) => /doplněna nákupní cena \(1 položka\)/.test(String(e.message)))).toBe(true);
    // stejné položky z formuláře s jinou cenou = taky jen cena (potvrzená objednávka)
    await pur.updatePurchaseOrder(String(po.id), { status: "potvrzena" });
    const form = items.map((it, i) => ({ drawingNumber: String(it.drawing_number), name: String(it.name), material: it.material ? String(it.material) : undefined, quantity: Number(it.quantity), unit: String(it.unit), unitPrice: i === 1 ? 44 : 40, note: it.note ? String(it.note) : undefined }));
    const ok2 = await pur.updatePurchaseOrder(String(po.id), { items: form });
    expect(ok2.ok, ok2.error).toBe(true);
    expect(Number(((await svc.from("commission_entries").select("cost").eq("order_id", P.id).single()).data as Row).cost)).toBe(12_400);
    // zaměstnanec ceny nedoplní
    as("worker");
    expect((await pur.updatePurchaseOrder(String(po.id), { prices: [{ itemId: String(items[1].id), unitPrice: 1 }] })).ok).toBe(false);
  }, 120_000);

  it("schválení ve frontě: admin schválí objednávku obchodníkovy zakázky → odejde ze schránky obchodníka s jeho podpisem; obchodník smí jen svou", async () => {
    as("sales");
    const Q = await newJob();
    await newQuote(Q.id, novak, [40, 42]);
    const p = await plan(Q.id);
    const r = await act.submitProductionHandoff(Q.id, inputOf(p));
    expect(r.ok, r.error).toBe(true);
    const row = (await queue(Q.id))[0];
    // jiný obchodník / zaměstnanec frontu cizí zakázky nevyřídí
    as("worker");
    expect((await appr.resolveApproval(String(row.id), "approved")).ok).toBe(false);
    const corrBefore = (await svc.from("ai_corrections").select("id", { count: "exact", head: true })).count ?? 0;
    as("admin");
    const ok = await appr.resolveApproval(String(row.id), "approved");
    expect(ok, ok.error).toMatchObject({ ok: true, sent: true });
    const [po] = await pos(Q.id);
    expect(po.status).toBe("odeslana");
    const box = (await svc.from("mailboxes").select("owner_id, email").eq("id", po.sent_mailbox_id as string).single()).data as Row;
    expect(box.owner_id).toBe(id("sales"));
    const msg = (await inbox(mailOf("novak"))).find((m) => String(m.subject).includes(String(po.number)))!;
    expect(String(msg.text)).toContain("Petr Obchodník");
    expect((await svc.from("approval_queue").select("status, resolved_by").eq("id", row.id as string).single()).data).toMatchObject({ status: "approved", resolved_by: id("admin") });
    expect((await svc.from("ai_corrections").select("id", { count: "exact", head: true })).count ?? 0).toBe(corrBefore);

    // obchodník svou zakázku vyřídí sám; zamítnutí nechá objednávku vystavenou
    as("sales");
    const Q2 = await newJob();
    await newQuote(Q2.id, novak, [40, 42]);
    const p2 = await plan(Q2.id);
    expect((await act.submitProductionHandoff(Q2.id, inputOf(p2))).ok).toBe(true);
    const row2 = (await queue(Q2.id))[0];
    const rej = await appr.resolveApproval(String(row2.id), "rejected");
    expect(rej.ok, rej.error).toBe(true);
    expect((await pos(Q2.id))[0].status).toBe("vystavena");
    expect((await events(Q2.id)).some((e) => /^Odeslání objednávky OV-.* zamítnuto \(Petr Obchodník\)$/.test(String(e.message)))).toBe(true);
  }, 120_000);

  it("focení potvrzení dodavatele: s naším číslem OV → použije objednávku; bez čísla podle dodavatele; nic nesedí v automatice → stav zůstává", async () => {
    as("sales");
    const salesActor = { id: id("sales"), fullName: "Petr Obchodník", margins: true, mailAll: false, via: "foto" as const };
    const local = await import("@/test/local-supabase");
    const headers = await import("@/lib/supabase/actor-headers");
    const db = local.localAdmin(headers.userActor({ id: id("sales") }, "foto"));
    const K = await newJob();
    const qk = await newQuote(K.id, novak, [40, 42]);
    const dr = await pur.draftPurchaseOrder(K.id, { supplierQuoteId: qk });
    const iss = await pur.issuePurchaseOrder(K.id, { ...dr.draft!, requiredDate: "2026-11-20" });
    expect(iss.ok, iss.error).toBe(true);
    const h1 = await flow.captureProductionHandoff(db, salesActor, K.id, { customerOrderNumber: iss.number, promisedDeliveryDate: "2026-11-27", supplier: null }, "auto");
    expect(h1, h1.warning).toMatchObject({ moved: true, stage: "ve_vyrobe" });
    expect(await pos(K.id)).toHaveLength(1);
    expect((await ops(K.id))[0]).toMatchObject({ purchase_order_id: iss.id, po_mode: "existujici", supplier_id: novak, planned_end: "2026-11-27", deadline_source: "potvrzeni_dodavatele", status: "probiha" });

    const K2 = await newJob();
    const q2 = await newQuote(K2.id, tepkal, [10, 10], { note: "kalení" });
    const d2 = await pur.draftPurchaseOrder(K2.id, { supplierQuoteId: q2 });
    const i2 = await pur.issuePurchaseOrder(K2.id, { ...d2.draft!, requiredDate: "2026-11-20" });
    expect(i2.ok, i2.error).toBe(true);
    const party = { name: `${SUP} TepKal s.r.o.`, ico: "", dic: "", street: "", city: "", zip: "", country: "", email: "", phone: "", contactPerson: "" };
    const h2 = await flow.captureProductionHandoff(db, salesActor, K2.id, { customerOrderNumber: null, promisedDeliveryDate: "2026-11-27", supplier: party }, "auto");
    expect(h2, h2.warning).toMatchObject({ moved: true });
    expect((await ops(K2.id))[0]).toMatchObject({ purchase_order_id: i2.id, po_mode: "existujici" });

    const K3 = await newJob();
    const stranger = { ...party, name: "Neznámá Kalírna s.r.o." };
    const h3 = await flow.captureProductionHandoff(db, salesActor, K3.id, { customerOrderNumber: null, promisedDeliveryDate: "2026-11-27", supplier: stranger }, "auto");
    expect(h3.moved).toBe(false);
    expect(h3.warning).toBe(flow.CAPTURE_HANDOFF_WAITING);
    expect((await job(K3.id)).status).toBe("potvrzeno");
    expect(await pos(K3.id)).toHaveLength(0);
    // s kontrolou člověka: krok u dodavatele z dokladu, „objednáno mimo systém" — žádná objednávka
    const h4 = await flow.captureProductionHandoff(db, salesActor, K3.id, { customerOrderNumber: null, promisedDeliveryDate: "2026-11-27", supplier: stranger, documentNumber: "POT-1" }, "review");
    expect(h4, h4.warning).toMatchObject({ moved: true });
    expect(await pos(K3.id)).toHaveLength(0);
    expect((await ops(K3.id))[0]).toMatchObject({ supplier_name: "Neznámá Kalírna s.r.o.", po_mode: "neobjednavat", po_none_reason: "Objednáno mimo systém — potvrzení dodavatele POT-1" });
  }, 120_000);

  it("dodání objednávky → další krok: plná automatika + bezpečný krok se předá sám (objednávka odejde), jinak upozornění", async () => {
    as("sales");
    const N = await newJob();
    await newQuote(N.id, novak, [40, 42]);
    await newQuote(N.id, tepkal, [5, 5], { note: "kalení" });
    const p = await plan(N.id);
    // výroba u Nováka teď, kalení u TepKal později (objednávka až při předání)
    const steps: HandoffStepInput[] = [
      { ...p.steps[0], plannedEnd: "2026-11-20" },
      {
        kind: "tepelne_zpracovani", who: { type: "supplier", id: tepkal }, plannedEnd: "2026-11-27", endsAtCustomerDate: false, deadlineAgreed: false,
        whoSource: "nejlevnejsi_nabidka", supplierQuoteId: p.steps.find((s) => s.kind === "tepelne_zpracovani")?.supplierQuoteId ?? null,
        po: { mode: "pri_predani" },
      },
    ];
    const r = await act.submitProductionHandoff(N.id, inputOf(p, {}, steps));
    expect(r.ok, r.error).toBe(true);
    const [po1] = await pos(N.id);
    await setMode("full");
    try {
      const del = await pur.updatePurchaseOrder(String(po1.id), { status: "dodana" });
      expect(del.ok, del.error).toBe(true);
      expect(del.hint).toMatch(/Další krok předán automaticky: Tepelné zpracování/);
      const o = await ops(N.id);
      expect(o.map((x) => x.status)).toEqual(["hotovo", "probiha"]);
      const all = await pos(N.id);
      expect(all).toHaveLength(2);
      expect(all[1]).toMatchObject({ supplier_id: tepkal, status: "odeslana" });
      const heat = (all[1].items as Row[]).sort((a, b) => Number(a.position) - Number(b.position));
      expect(heat[0]).toMatchObject({ name: "Příruba — tepelné zpracování", material: "1.2379", note: "kalit 58–60 HRC · 1,2 kg/ks" });
      expect(String(all[1].note)).toMatch(/Operace: Tepelné zpracování \(krok 2 ze 2\)\./);
      if (process.env.PDF_PREVIEW_DIR) {
        const f = (await files(N.id)).find((x) => x.id === all[1].file_id)!;
        const blob = await svc.storage.from("job-files").download(String(f.storage_path));
        const { writeFileSync } = await import("node:fs");
        writeFileSync(`${process.env.PDF_PREVIEW_DIR}/objednavka-kaleni.pdf`, Buffer.from(await blob.data!.arrayBuffer()));
      }
      const auto = (await svc.from("production_handoffs").select("kind, created_via").eq("job_id", N.id).order("created_at")).data as Row[];
      expect(auto[auto.length - 1]).toMatchObject({ kind: "dalsi_krok", created_via: "automaticky" });
    } finally {
      await setMode("approval");
    }
    // se schválením: jen upozornění (krok čeká na předání)
    const M = await newJob();
    await newQuote(M.id, novak, [40, 42]);
    const pm = await plan(M.id);
    const rm = await act.submitProductionHandoff(M.id, inputOf(pm, {}, [{ ...pm.steps[0], plannedEnd: "2026-11-20" }, { ...steps[1], supplierQuoteId: null, whoSource: "rucne" }]));
    expect(rm.ok, rm.error).toBe(true);
    const del2 = await pur.updatePurchaseOrder(String((await pos(M.id))[0].id), { status: "dodana" });
    expect(del2.hint).toMatch(/K předání dalšímu kroku: Tepelné zpracování · .*TepKal/);
    expect((await ops(M.id)).map((x) => x.status)).toEqual(["hotovo", "ceka"]);
  }, 150_000);

  it("storno u dodavatelů (zakázka zrušena): odeslaná dostane e-mail a je zrušená, neodeslaná se rovnou zruší", async () => {
    as("sales");
    const T = await newJob();
    await newQuote(T.id, novak, [40, 42]);
    const p = await plan(T.id);
    const r = await act.submitProductionHandoff(T.id, inputOf(p, { sendNow: ["*"] }));
    expect(r.ok, r.error).toBe(true);
    const [po] = await pos(T.id);
    const res = await pur.notifySuppliers(T.id, { kind: "cancel", purchaseOrderIds: [String(po.id)] });
    expect(res.ok, res.error).toBe(true);
    expect(res.sent).toEqual([po.id]);
    expect((await pos(T.id))[0]).toMatchObject({ status: "zrusena" });
    expect((await inbox(mailOf("novak"))).some((m) => String(m.subject).startsWith(`Storno objednávky ${po.number}`))).toBe(true);
  }, 90_000);

  it("další krok s částečným převzetím: objednávka zůstává otevřená (120/200), krok hotový, další objednávka na převzaté množství; zaměstnanec převzetí nezapíše", async () => {
    as("sales");
    const R = await newJob();
    await newQuote(R.id, novak, [40, 42]);
    await newQuote(R.id, tepkal, [5, 5], { note: "kalení" });
    const p = await plan(R.id);
    const steps: HandoffStepInput[] = [
      { ...p.steps[0], plannedEnd: "2026-11-20" },
      { kind: "tepelne_zpracovani", who: { type: "supplier", id: tepkal }, plannedEnd: "2026-11-27", endsAtCustomerDate: false, deadlineAgreed: false, orderItemIds: [R.items[0]], po: { mode: "pri_predani" } },
    ];
    expect((await act.submitProductionHandoff(R.id, inputOf(p, { sendNow: ["*"] }, steps))).ok).toBe(true);
    const [po1] = await pos(R.id);
    const it1 = (po1.items as Row[]).sort((a, b) => Number(a.position) - Number(b.position));
    const d = await plan(R.id);
    expect(d.kind).toBe("dalsi_krok");
    expect(d.current?.purchaseOrder?.items.map((i) => i.quantity)).toEqual([200, 100]);
    const op1 = String(d.current!.id);
    const next = { ...d.steps[0], po: { ...d.steps[0].po, mode: "vystavit" as const, quantities: { [R.items[0]]: 120 } } };
    // zaměstnanec: převzetí po položkách ne
    as("worker");
    const dw = await plan(R.id);
    expect(dw.current?.purchaseOrder?.items).toEqual([]);
    const forb = await act.submitProductionHandoff(R.id, inputOf(dw, { complete: { operationId: op1, receipts: [{ itemId: String(it1[0].id), received: 120 }] } }, [next]));
    expect(forb).toMatchObject({ ok: false, code: "FORBIDDEN" });
    as("sales");
    const r = await act.submitProductionHandoff(R.id, inputOf(d, {
      complete: { operationId: op1, receipts: [{ itemId: String(it1[0].id), received: 120 }, { itemId: String(it1[1].id), received: 100 }], continueWithoutRest: true },
    }, [next]));
    expect(r.ok, r.error).toBe(true);
    expect(r.result).toMatchObject({ kind: "dalsi_krok", completedOperationId: op1 });
    const all = await pos(R.id);
    expect(all[0].status).toBe("odeslana");                                          // zbytek dorazí později
    expect((all[0].items as Row[]).map((i) => Number(i.received_quantity)).sort((a, b) => a - b)).toEqual([100, 120]);
    expect(all[1]).toMatchObject({ supplier_id: tepkal });
    expect((all[1].items as Row[]).map((i) => Number(i.quantity))).toEqual([120]);
    expect((await ops(R.id)).map((o) => o.status)).toEqual(["hotovo", "probiha"]);
    expect((await events(R.id)).some((e) => /^Převzato od .*Frézy Novák s\.r\.o\.: PR-.*-20 120\/200 ks/.test(String(e.message)))).toBe(true);
  }, 120_000);

  it("ukončení výroby dřív: zbylé kroky přeskočené, nevyslaná objednávka zrušená, sdílená (s hotovým krokem) jen odpojená", async () => {
    as("sales");
    const F = await newJob();
    await newQuote(F.id, novak, [40, 42]);
    const r = await act.submitProductionHandoff(F.id, await manualInput(F.id, [
      supplierStep(novak, "2026-11-20"),
      supplierStep(novak, "2026-11-27", { kind: "brouseni", start: false, po: { mode: "pri_predani", orderNow: true } }),
      supplierStep(tepkal, "2026-12-04", { kind: "tepelne_zpracovani", start: false, po: { mode: "pri_predani", orderNow: true } }),
    ]));
    expect(r.ok, r.error).toBe(true);
    const [shared, heat] = await pos(F.id);
    const o = await ops(F.id);
    const u = await plan(F.id, { kind: "ukonceni", target: "dodano_k_nam" });
    const bad = await act.submitProductionHandoff(F.id, inputOf(u, { kind: "ukonceni", complete: { operationId: String(o[0].id) }, finish: { target: "dodano_k_nam" } }, []));
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/proč končíš výrobu dřív/);
    const u2 = await plan(F.id, { kind: "ukonceni", target: "dodano_k_nam" });
    const ok = await act.submitProductionHandoff(F.id, inputOf(u2, {
      kind: "ukonceni", complete: { operationId: String(o[0].id) }, finish: { target: "dodano_k_nam", skipReason: "zákazník bere bez broušení" },
    }, []));
    expect(ok.ok, ok.error).toBe(true);
    const after = await ops(F.id);
    expect(after.map((x) => x.status)).toEqual(["hotovo", "preskoceno", "preskoceno"]);
    expect(after[1].purchase_order_id).toBeNull();
    const [s2, h2] = await pos(F.id);
    expect(s2).toMatchObject({ id: shared.id, status: "vystavena" });
    expect(h2).toMatchObject({ id: heat.id, status: "zrusena", cancel_reason: "Výroba ukončena dřív — krok přeskočen" });
    const j = await job(F.id);
    expect(j.status).toBe("dodano_k_nam");
    expect(j.production_finished_at).toBeTruthy();
  }, 120_000);

  it("firma mimo adresář s objednávkou: dodavatel se založí v transakci (nabídka bez dodavatele se doplní); při chybě nezůstane sirotek", async () => {
    as("sales");
    const name = `${SUP} Nová Kalírna s.r.o.`;
    const G = await newJob();
    const { data: q } = await svc.from("supplier_quotes").insert({
      job_id: G.id, supplier_id: null, supplier_name: name, number: `NAB-${TAG}-free`, currency: "CZK", source: "manual", total: 1000, note: "frézování",
    }).select("id").single();
    const qid = (q as { id: string }).id;
    await svc.from("supplier_quote_items").insert([
      { supplier_quote_id: qid, position: 0, drawing_number: `PR-${TAG}-20`, name: "Příruba", quantity: 200, unit: "ks", unit_price: 3 },
      { supplier_quote_id: qid, position: 1, drawing_number: `PR-${TAG}-21`, name: "Pouzdro", quantity: 100, unit: "ks", unit_price: 4 },
    ]);
    // chyba až v RPC (start není první čekající krok) → nic nezůstane, ani nový dodavatel
    const H = await newJob();
    await svc.from("job_operations").insert({ job_id: H.id, position: 0, kind: "vyroba", in_house: true, status: "ceka", planned_end: "2026-11-13" });
    const fail = await act.submitProductionHandoff(H.id, await manualInput(H.id, [supplierStep("", "2026-11-20", { who: { type: "free", name } })]));
    expect(fail.ok).toBe(false);
    expect(fail.error).toMatch(/první nedokončený/);
    expect(((await svc.from("suppliers").select("id").eq("name", name)).data ?? [])).toHaveLength(0);
    expect(await pos(H.id)).toHaveLength(0);

    const r = await act.submitProductionHandoff(G.id, await manualInput(G.id, [supplierStep("", "2026-11-20", { who: { type: "free", name }, supplierQuoteId: qid })]));
    expect(r.ok, r.error).toBe(true);
    const sup = ((await svc.from("suppliers").select("id, created_by").eq("name", name)).data ?? []) as Row[];
    expect(sup).toHaveLength(1);
    const [po] = await pos(G.id);
    expect(po).toMatchObject({ supplier_id: sup[0].id, supplier_quote_id: qid, total: 1000 });
    expect(((await svc.from("supplier_quotes").select("supplier_id").eq("id", qid).single()).data as Row).supplier_id).toBe(sup[0].id);
    expect((await events(G.id)).some((e) => String(e.message) === `Nový dodavatel v adresáři: ${name} (při předání do výroby)`)).toBe(true);
  }, 90_000);

  it("potvrzení objednávky mezioperace nepřepíše slíbený termín zakázky — jen objednávka posledního otevřeného kroku", async () => {
    as("sales");
    const V = await newJob();
    await newQuote(V.id, novak, [40, 42]);
    const r = await act.submitProductionHandoff(V.id, await manualInput(V.id, [
      supplierStep(novak, "2026-11-20"),
      supplierStep(tepkal, "2026-11-27", { kind: "tepelne_zpracovani", start: false, po: { mode: "pri_predani", orderNow: true } }),
    ]));
    expect(r.ok, r.error).toBe(true);
    const [p1, p2] = await pos(V.id);
    const u1 = await pur.updatePurchaseOrder(String(p1.id), { status: "potvrzena", confirmedDate: "2026-11-19" });
    expect(u1.ok, u1.error).toBe(true);
    expect((await job(V.id)).supplier_promised_date).toBeNull();
    const u2 = await pur.updatePurchaseOrder(String(p2.id), { status: "potvrzena", confirmedDate: "2026-11-26" });
    expect(u2.ok, u2.error).toBe(true);
    expect((await job(V.id)).supplier_promised_date).toBe("2026-11-26");
    // potvrzené datum jiné než požadované posune termín kroku (DB) a stav termínu = potvrzeno
    const o = await ops(V.id);
    expect(o[0]).toMatchObject({ planned_end: "2026-11-19", deadline_state: "potvrzeno" });
  }, 90_000);

  // ── review WP2 (integrita + majitel) ──────────────────────
  /** Text PDF z Dokumentů zakázky (pdftotext); null = nástroj chybí. */
  async function pdfText(fileId: string): Promise<string | null> {
    const { data: f } = await svc.from("job_files").select("storage_path").eq("id", fileId).single();
    const { data: blob } = await svc.storage.from("job-files").download(String((f as Row).storage_path));
    const tmp = path.join(os.tmpdir(), `ho-${randomUUID()}.pdf`);
    writeFileSync(tmp, Buffer.from(await blob!.arrayBuffer()));
    try {
      return execFileSync("pdftotext", ["-layout", tmp, "-"]).toString();
    } catch {
      return null;
    } finally {
      rmSync(tmp, { force: true });
    }
  }
  const poMails = async (to: string, number: unknown, prefix = "Objednávka") =>
    (await inbox(to)).filter((m) => String(m.subject).startsWith(`${prefix} ${String(number)}`));
  async function handoffOne(jid: string, supplierId: string, over: Partial<HandoffInput> = {}, step: Partial<HandoffStepInput> = {}) {
    const r = await act.submitProductionHandoff(jid, await manualInput(jid, [supplierStep(supplierId, "2026-11-20", step)], over));
    expect(r.ok, r.error).toBe(true);
    return r.result!;
  }

  it("review: ukončení výroby se zrušením odeslané objednávky pošle dodavateli storno e-mailem", async () => {
    as("sales");
    const F = await newJob();
    await handoffOne(F.id, novak, {}, { who: { type: "u_nas" }, po: { mode: null } });
    const r = await act.submitProductionHandoff(F.id, await manualInput(F.id, [
      supplierStep(tepkal, "2026-11-27", { kind: "tepelne_zpracovani", start: false, po: { mode: "pri_predani", orderNow: true } }),
    ], { kind: "plan" }));
    expect(r.ok, r.error).toBe(true);
    const [po] = await pos(F.id);
    expect((await act.sendStepPurchaseOrder(String(po.id))).ok).toBe(true);
    const o = await ops(F.id);
    const u = await plan(F.id, { kind: "ukonceni", target: "dodano_k_nam" });
    const fin = await act.submitProductionHandoff(F.id, inputOf(u, {
      kind: "ukonceni", complete: { operationId: String(o[0].id) },
      finish: { target: "dodano_k_nam", skipReason: "zákazník bere bez kalení", cancelSentPurchaseOrderIds: [String(po.id)] },
    }, []));
    expect(fin.ok, fin.error).toBe(true);
    expect(fin.result!.stornos).toEqual([{ id: po.id, number: po.number, send: "odeslano" }]);
    expect((await pos(F.id))[0]).toMatchObject({ status: "zrusena", cancel_reason: "Výroba ukončena dřív — krok přeskočen" });
    expect(await poMails(mailOf("tepkal"), po.number, "Storno objednávky")).toHaveLength(1);
  }, 120_000);

  it("review: opravený příjemce ve frontě platí (dodavatel bez e-mailu i jiná adresa); neupravený řádek bere e-mail z adresáře", async () => {
    as("sales");
    const A = await newJob();
    await handoffOne(A.id, nomail);
    const row = (await queue(A.id))[0];
    expect(row.target).toBeNull();
    as("admin");
    const body = String((row.payload as Row).body);
    expect((await appr.updateApprovalBody({ id: String(row.id), body, target: mailOf("fixed"), agentKey: "purchase_order", originalBody: body, context: "x" })).ok).toBe(true);
    expect(((await queue(A.id))[0].payload as Row).to).toBe(mailOf("fixed"));
    as("sales");
    const ok = await appr.resolveApproval(String(row.id), "approved");
    expect(ok, ok.error).toMatchObject({ ok: true, sent: true });
    expect(await poMails(mailOf("fixed"), (await pos(A.id))[0].number)).toHaveLength(1);

    const B = await newJob();
    await handoffOne(B.id, novak);
    const rowB = (await queue(B.id))[0];
    const [poB] = await pos(B.id);
    const bodyB = String((rowB.payload as Row).body);
    expect((await appr.updateApprovalBody({ id: String(rowB.id), body: bodyB, target: mailOf("other"), agentKey: "purchase_order", originalBody: bodyB, context: "x" })).ok).toBe(true);
    expect((await appr.resolveApproval(String(rowB.id), "approved")).ok).toBe(true);
    expect(await poMails(mailOf("other"), poB.number)).toHaveLength(1);
    expect(await poMails(mailOf("novak"), poB.number)).toHaveLength(0);

    // dodavatel dostane e-mail do adresáře až po vystavení → neupravený řádek pošle na nový e-mail
    const C = await newJob();
    await handoffOne(C.id, nomail);
    await svc.from("suppliers").update({ email: mailOf("late") }).eq("id", nomail);
    try {
      const rowC = (await queue(C.id))[0];
      expect((await appr.resolveApproval(String(rowC.id), "approved")).ok).toBe(true);
      expect(await poMails(mailOf("late"), (await pos(C.id))[0].number)).toHaveLength(1);
    } finally {
      await svc.from("suppliers").update({ email: null }).eq("id", nomail);
    }
  }, 120_000);

  it("review: objednávka odejde dodavateli jen jednou (dvakrát „Odeslat“, fronta + „Odeslat“, dvojklik během SMTP); po zamítnutí jde poslat", async () => {
    as("sales");
    const C = await newJob();
    await handoffOne(C.id, novak);
    const [po] = await pos(C.id);
    expect((await act.sendStepPurchaseOrder(String(po.id))).ok).toBe(true);
    const s2 = await act.sendStepPurchaseOrder(String(po.id));
    expect(s2.ok).toBe(false);
    expect(s2.error).toMatch(/už odešla dodavateli/);
    expect(await poMails(mailOf("novak"), po.number)).toHaveLength(1);

    const D = await newJob();
    await handoffOne(D.id, novak);
    const [poD] = await pos(D.id);
    as("admin");
    expect((await appr.resolveApproval(String((await queue(D.id))[0].id), "approved")).ok).toBe(true);
    as("sales");
    expect((await act.sendStepPurchaseOrder(String(poD.id))).ok).toBe(false);
    expect(await poMails(mailOf("novak"), poD.number)).toHaveLength(1);

    const E = await newJob();
    await handoffOne(E.id, novak);
    const [poE] = await pos(E.id);
    mailCtl.delayMs = 1500;
    try {
      const p1 = act.sendStepPurchaseOrder(String(poE.id));
      await new Promise((res) => setTimeout(res, 500));
      const p2 = act.sendStepPurchaseOrder(String(poE.id));
      const res = await Promise.all([p1, p2]);
      expect(res.filter((x) => x.ok)).toHaveLength(1);
      expect(res.find((x) => !x.ok)?.error).toMatch(/mezitím/);
    } finally {
      mailCtl.delayMs = 0;
    }
    expect(await poMails(mailOf("novak"), poE.number)).toHaveLength(1);
    expect(await emails(E.id)).toHaveLength(1);

    // zamítnuto ve frontě → objednávka vystavená → „Odeslat" založí a zabere nový řádek
    const G = await newJob();
    await handoffOne(G.id, novak);
    const [poG] = await pos(G.id);
    expect((await appr.resolveApproval(String((await queue(G.id))[0].id), "rejected")).ok).toBe(true);
    const sg = await act.sendStepPurchaseOrder(String(poG.id));
    expect(sg.ok, sg.error).toBe(true);
    const qg = await queue(G.id);
    expect(qg.map((x) => x.status).sort()).toEqual(["approved", "rejected"]);
    expect(await poMails(mailOf("novak"), poG.number)).toHaveLength(1);
  }, 150_000);

  it("review: focení nikdy nevystaví objednávku — krok se zrušenou objednávkou v plné automatice zůstane, stav se nehne", async () => {
    as("sales");
    const K = await newJob();
    const r = await act.submitProductionHandoff(K.id, await manualInput(K.id, [supplierStep(novak, "2026-11-20", { start: false, po: { mode: "vystavit", orderNow: true } })], { kind: "plan" }));
    expect(r.ok, r.error).toBe(true);
    const [po] = await pos(K.id);
    expect((await pur.updatePurchaseOrder(String(po.id), { status: "zrusena", cancelReason: "test" })).ok).toBe(true);
    const local = await import("@/test/local-supabase");
    const headers = await import("@/lib/supabase/actor-headers");
    const db = local.localAdmin(headers.aiActor(id("sales"), "capture", "ai"));
    const party = { name: "Úplně Jiná Firma s.r.o.", ico: "", dic: "", street: "", city: "", zip: "", country: "", email: "", phone: "", contactPerson: "" };
    await setMode("full");
    try {
      const h = await flow.captureProductionHandoff(db as never, { id: id("sales"), fullName: "Petr", margins: true, mailAll: false, via: "ai" }, K.id,
        { customerOrderNumber: null, promisedDeliveryDate: "2026-11-27", supplier: party }, "auto");
      expect(h.moved).toBe(false);
      expect(h.warning).toBe(flow.CAPTURE_HANDOFF_WAITING);
    } finally {
      await setMode("approval");
    }
    expect((await pos(K.id)).map((p) => p.status)).toEqual(["zrusena"]);
    expect((await job(K.id)).status).toBe("potvrzeno");
    // pojistka v jádru: zdroj „capture" s novou objednávkou se odmítne
    const core = await store.productionHandoffCore(db as never, { id: id("sales"), fullName: "Petr", margins: true, mailAll: false, via: "ai" }, K.id,
      await manualInput(K.id, [supplierStep(hruby, "2026-11-27")]), { source: "capture" });
    expect(core).toMatchObject({ ok: false });
    expect((await pos(K.id))).toHaveLength(1);
  }, 120_000);

  it("review: změna dodavatele u odeslané objednávky — běžící krok dostane novou objednávku atomicky; když nová nejde, nezmění se nic", async () => {
    as("sales");
    const H = await newJob();
    await newQuote(H.id, novak, [40, 42]);
    await newQuote(H.id, hruby, [45, 45]);
    await handoffOne(H.id, novak, { sendNow: ["*"] });
    const op = (await ops(H.id))[0];
    const [old] = await pos(H.id);
    expect(old.status).toBe("odeslana");
    const u = await prod.updateJobOperation(String(op.id), { supplierId: hruby }, { confirmReplace: true, notifySupplier: true });
    expect(u.ok, u.error).toBe(true);
    const all = await pos(H.id);
    expect(all.map((p) => [p.supplier_id, p.status])).toEqual([[novak, "zrusena"], [hruby, "vystavena"]]);
    expect(String(all[0].cancel_reason)).toBe(`Změna dodavatele — nahrazeno ${String(all[1].number)}`);
    const after = (await ops(H.id))[0];
    expect(after).toMatchObject({ status: "probiha", supplier_id: hruby, purchase_order_id: all[1].id });
    expect(u.hint).toMatch(new RegExp(`stornována u dodavatele.*Vystavena ${String(all[1].number)}`));
    const storno = await poMails(mailOf("novak"), old.number, "Storno objednávky");
    expect(storno).toHaveLength(1);
    expect(String(storno[0].text)).not.toMatch(/změna dodavatele/i);   // neutrální text pro starého dodavatele
    expect((all[1].items as Row[]).length).toBe(2);
    expect(Number(all[1].total)).toBe(13_500);

    // selhání (Hrubý už má volnou objednávku z Nákupu): krok i stará odeslaná objednávka beze změny
    const P = await newJob();
    await newQuote(P.id, novak, [40, 42]);
    const hq = await newQuote(P.id, hruby, [45, 45]);
    await handoffOne(P.id, novak, { sendNow: ["*"] });
    const dr = await pur.draftPurchaseOrder(P.id, { supplierQuoteId: hq });
    expect((await pur.issuePurchaseOrder(P.id, { ...dr.draft!, requiredDate: "2026-11-20" })).ok).toBe(true);
    const opP = (await ops(P.id))[0];
    const before = await pos(P.id);
    const bad = await prod.updateJobOperation(String(opP.id), { supplierId: hruby }, { confirmReplace: true, notifySupplier: true });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/Dodavatel se nezměnil — .*už má k zakázce objednávku/);
    expect((await ops(P.id))[0]).toMatchObject({ supplier_id: novak, purchase_order_id: opP.purchase_order_id });
    expect((await pos(P.id)).map((p) => p.status)).toEqual(before.map((p) => p.status));
    expect(await poMails(mailOf("novak"), before[0].number, "Storno objednávky")).toHaveLength(0);
  }, 150_000);

  it("review: objednávku kroku odpojí / vymění jen obchodník; nevyslaná bez kroku se zruší; cizí dodavatel se nepřiřadí", async () => {
    as("sales");
    const G = await newJob();
    await handoffOne(G.id, novak);
    const op = (await ops(G.id))[0];
    const [po] = await pos(G.id);
    as("worker");
    const bypass = await prod.updateJobOperation(String(op.id), { supplierId: hruby, purchaseOrderId: null });
    expect(bypass.ok).toBe(false);
    expect(bypass.error).toMatch(/objednávku kroku změní obchodník nebo admin/);
    expect((await ops(G.id))[0]).toMatchObject({ supplier_id: novak, purchase_order_id: po.id });
    as("sales");
    // jiná objednávka u jiného dodavatele k tomuto kroku nepatří
    const hq = await newQuote(G.id, hruby, [45, 45]);
    const dr = await pur.draftPurchaseOrder(G.id, { supplierQuoteId: hq });
    const iss = await pur.issuePurchaseOrder(G.id, { ...dr.draft!, requiredDate: "2026-11-20" });
    expect(iss.ok, iss.error).toBe(true);
    const relink = await prod.updateJobOperation(String(op.id), { purchaseOrderId: iss.id });
    expect(relink.ok).toBe(false);
    expect(relink.error).toMatch(/je u jiného dodavatele než krok/);
    // obchodník odpojí nevyslanou objednávku → zruší se (a její řádek fronty)
    const det = await prod.updateJobOperation(String(op.id), { purchaseOrderId: null });
    expect(det.ok, det.error).toBe(true);
    expect((await pos(G.id)).find((p) => p.id === po.id)).toMatchObject({ status: "zrusena" });
    expect((await queue(G.id)).find((q) => q.purchase_order_id === po.id)?.status).toBe("rejected");
  }, 120_000);

  it("review: zaměstnanec předá → na PDF i v e-mailu je obchodník zakázky (ne zaměstnanec); schránka zaměstnance se nepoužije", async () => {
    as("worker");
    const W = await newJob();
    await newQuote(W.id, novak, [40, 42]);
    const p = await plan(W.id);
    expect((await act.submitProductionHandoff(W.id, inputOf(p))).ok).toBe(true);
    const [po] = await pos(W.id);
    expect(po.created_by).toBe(id("worker"));
    const docs = await import("@/lib/jobs/purchase-order-docs");
    const view = await (await import("@/lib/data/purchasing")).fetchPurchaseOrder(svc as never, String(po.id));
    expect(await docs.purchaseOrderContactId(svc as never, view!)).toBe(id("sales"));
    const text = await pdfText(String(po.file_id));
    if (text !== null) {
      expect(text).toContain(who.users.sales.fullName);
      expect(text).not.toContain(who.users.worker.fullName);
      expect(text).toContain(who.users.sales.email);
      expect(text).not.toContain(who.users.worker.email);
      // dodací adresa: provozovna (bez nastavení „Dodací adresa"), ne sídlo v Praze; DAP podle místa
      const custom = (await svc.from("integration_settings").select("value").eq("key", "company_delivery_address").maybeSingle()).data as Row | null;
      if (!custom?.value) {
        expect(String(po.delivery_address)).toMatch(/Mezná 9\n393 01 Mezná$/);
        expect(po.delivery_terms).toBe("DAP Mezná");
        expect(text).toContain("Mezná 9");
      }
    }
    // obchodník zakázky je zaměstnanec (výjimečně) → admin pošle ze své schránky, ne ze schránky zaměstnance
    as("sales");
    const W2 = await newJob({ owner_id: id("worker") });
    await newQuote(W2.id, novak, [40, 42]);
    as("admin");
    const p2 = await plan(W2.id);
    expect((await act.submitProductionHandoff(W2.id, inputOf(p2))).ok).toBe(true);
    const sender = await store.purchaseOrderSender(svc as never, { id: id("admin"), mailAll: true }, id("worker"));
    expect(sender.signerId).toBe(id("admin"));
    expect("mailboxId" in sender.from && sender.from.mailboxId).toBeFalsy();
  }, 120_000);

  it("review: jiný obchodník nepošle objednávku cizí zakázky ani tlačítkem „Odeslat“", async () => {
    if (!who.users.sales2) return;
    as("sales");
    const L = await newJob();
    await handoffOne(L.id, novak);
    const [po] = await pos(L.id);
    as("sales2");
    const s = await act.sendStepPurchaseOrder(String(po.id));
    expect(s.ok).toBe(false);
    expect(s.error).toMatch(/cizí zakázce/);
    const q = (await queue(L.id))[0];
    expect(q.status).toBe("pending");
    expect(String(q.summary)).not.toMatch(/Odeslání selhalo/);
    as("sales");
  }, 60_000);

  it("review: nabídka jen na část dílů → zbylé díly v objednávce bez ceny (výchozí); bez nich jen když je udělá jiný krok", async () => {
    as("sales");
    const S = await newJob();
    const { data: qd } = await svc.from("supplier_quotes").insert({ job_id: S.id, supplier_id: novak, number: `NAB-${TAG}-part`, currency: "CZK", lead_time_days: 14, source: "manual", total: 8000, note: "frézování" }).select("id").single();
    await svc.from("supplier_quote_items").insert({ supplier_quote_id: (qd as Row).id, position: 0, drawing_number: `PR-${TAG}-20`, name: "Příruba", quantity: 200, unit: "ks", unit_price: 40 });
    const p = await plan(S.id);
    expect(p.steps[0].po.includeUncovered).toBe(true);
    expect(p.steps[0].poPreview?.itemCount).toBe(2);
    const r = await act.submitProductionHandoff(S.id, inputOf(p));
    expect(r.ok, r.error).toBe(true);
    const items = ((await pos(S.id))[0].items as Row[]).sort((a, b) => Number(a.position) - Number(b.position));
    expect(items.map((i) => [i.drawing_number, i.unit_price])).toEqual([[`PR-${TAG}-20`, 40], [`PR-${TAG}-21`, null]]);
    expect(String(items[1].note)).toMatch(/mimo nabídku — prosíme o nacenění/);

    const S2 = await newJob();
    const { data: qd2 } = await svc.from("supplier_quotes").insert({ job_id: S2.id, supplier_id: novak, number: `NAB-${TAG}-part2`, currency: "CZK", lead_time_days: 14, source: "manual", total: 8000, note: "frézování" }).select("id").single();
    await svc.from("supplier_quote_items").insert({ supplier_quote_id: (qd2 as Row).id, position: 0, drawing_number: `PR-${TAG}-20`, name: "Příruba", quantity: 200, unit: "ks", unit_price: 40 });
    const p2 = await plan(S2.id);
    const bad = await act.submitProductionHandoff(S2.id, inputOf(p2, {}, [{ ...p2.steps[0], po: { ...p2.steps[0].po, includeUncovered: false } }]));
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(new RegExp(`Díl PR-${TAG}-21 nemá, kdo ho vyrobí`));
    expect(await pos(S2.id)).toHaveLength(0);
  }, 120_000);

  it("review: postup ze šablony „Výroba → tepelné zpracování → výroba“ — kalírna jen díl s kalením, cena z její nabídky za kg; text pro kalírnu", async () => {
    as("sales");
    const T = await newJob();
    await newQuote(T.id, novak, [40, 42]);
    const { data: hq } = await svc.from("supplier_quotes").insert({ job_id: T.id, supplier_id: tepkal, number: `NAB-${TAG}-kal`, currency: "CZK", lead_time_days: 5, source: "manual", total: null, note: "kalení" }).select("id").single();
    await svc.from("supplier_quote_items").insert({ supplier_quote_id: (hq as Row).id, position: 0, drawing_number: `PR-${TAG}-20`, name: "Kalení 58–60 HRC", quantity: 240, unit: "kg", unit_price: 45 });
    const tpl = await prod.applyOperationTemplate(T.id, "vyroba_kaleni", { byIndex: [novak, tepkal, novak] });
    expect(tpl.ok, tpl.error).toBe(true);
    const p = await plan(T.id);
    const heat = p.steps.find((s) => s.kind === "tepelne_zpracovani")!;
    expect(heat.orderItemIds).toEqual([T.items[0]]);
    expect(heat.supplierQuoteId).toBe((hq as Row).id);
    expect(heat.whoSource).toBe("nejlevnejsi_nabidka");
    const steps = p.steps.map((s) => (s.kind === "tepelne_zpracovani" ? { ...s, po: { ...s.po, orderNow: true } } : { ...s }));
    const r = await act.submitProductionHandoff(T.id, inputOf(p, {}, steps));
    expect(r.ok, r.error).toBe(true);
    const kal = (await pos(T.id)).find((x) => x.supplier_id === tepkal)!;
    expect((kal.items as Row[]).map((i) => [i.drawing_number, Number(i.quantity), i.unit, Number(i.unit_price)])).toEqual([[`PR-${TAG}-20`, 240, "kg", 45]]);
    expect(Number(kal.total)).toBe(10_800);
    expect(String(kal.note)).toMatch(/Dle výkresů: PR-.*-20\. Operace: Tepelné zpracování \(krok 2 ze 3\)\./);
    expect(String(kal.note)).not.toMatch(/Výroba dle výkresů|Výroba 1/);
    const text = await pdfText(String(kal.file_id));
    if (text !== null) {
      expect(text).toMatch(/objednáváme\s+tepelné\s+zpracování/);
      expect(text).not.toMatch(/Vyrábějte dle/);
      expect(text).not.toMatch(/Pouzdro/);
    }
  }, 120_000);

  it("review: bez nabídky — PDF bez „Celkem 0,00 Kč“, fronta připomene výkresy, blokace bez lživého „dražší“", async () => {
    as("sales");
    const R = await newJob();
    await setMode("full");
    try {
      await handoffOne(R.id, hruby);
    } finally {
      await setMode("approval");
    }
    const [po] = await pos(R.id);
    const row = (await queue(R.id))[0];
    expect(String(row.summary)).toContain("Dodavatel nemá výkresy — pošli je");
    expect(String(row.summary)).toMatch(/Neodesláno automaticky: .*firma bez nabídky \(zvolená ručně\)/);
    expect(String(row.summary)).not.toMatch(/dražší/);
    expect(String((row.payload as Row).body)).toContain("Výkresovou dokumentaci k položkám Vám pošleme samostatně");
    const text = await pdfText(String(po.file_id));
    if (text !== null) {
      expect(text).not.toMatch(/0,00\s*Kč/);
      expect(text).toMatch(/Prosíme o nacenění v potvrzení objednávky/);
    }
  }, 120_000);

  it("review: dodavatel potvrdí později → upozornění; další krok se předvyplní posunutý; posun konečného termínu je vidět i v dalším kroku", async () => {
    as("sales");
    const V = await newJob();
    const r = await act.submitProductionHandoff(V.id, await manualInput(V.id, [
      supplierStep(novak, "2026-11-20"),
      supplierStep(tepkal, "2026-11-23", { kind: "tepelne_zpracovani", start: false, po: { mode: "pri_predani" } }),
      supplierStep(novak, "2026-12-18", { kind: "vyroba", start: false, endsAtCustomerDate: true, po: { mode: "pri_predani" } }),
    ]));
    expect(r.ok, r.error).toBe(true);
    const [po1] = await pos(V.id);
    const c = await pur.updatePurchaseOrder(String(po1.id), { status: "potvrzena", confirmedDate: "2026-11-25" });
    expect(c.ok, c.error).toBe(true);
    expect(c.hint).toMatch(/Dodavatel potvrdil 25\. 11\. — další krok Tepelné zpracování.* má termín 23\. 11\./);
    const p = await plan(V.id, { kind: "dalsi_krok" });
    expect(p.steps[0].kind).toBe("tepelne_zpracovani");
    expect(p.steps[0].plannedEnd! >= "2026-11-26").toBe(true);
    expect(p.steps[0].deadlineCaption).toMatch(/^posunuto — předchozí krok potvrzen na 25\. 11\./);
    // zákazník posune konečný termín dřív → plán dalšího kroku to hlásí (konečný krok v dialogu není)
    await svc.from("orders").update({ due_date: "2026-12-04" }).eq("id", V.id);
    const p2 = await plan(V.id, { kind: "dalsi_krok" });
    expect(p2.issues.some((x) => x.code === "route_health" && /Konečný termín \(zákazník\) se změnil na 4\. 12\./.test(x.message))).toBe(true);
  }, 120_000);

  it("review: vědomě přijatý pozdní konec výroby je v historii (kdo a od kdy)", async () => {
    as("sales");
    const L = await newJob({ due_date: "2026-11-10" });
    const late = await act.submitProductionHandoff(L.id, await manualInput(L.id, [supplierStep(novak, "2026-11-20")]));
    expect(late.ok).toBe(false);
    const ok = await act.submitProductionHandoff(L.id, await manualInput(L.id, [supplierStep(novak, "2026-11-20")], { acceptLate: true }));
    expect(ok.ok, ok.error).toBe(true);
    const ev = (await events(L.id)).map((e) => String(e.message));
    expect(ev.some((m) => m.includes(`po konečném termínu (zákazník) 10. 11. — přijal ${who.users.sales.fullName}`))).toBe(true);
  }, 90_000);

  it("čisté pomocníky: druh předání z faktů, tvar vstupu, práva", () => {
    expect(store.deriveHandoffKind("poptavka", [])).toMatchObject({ code: "NO_CUSTOMER_ORDER" });
    expect(store.deriveHandoffKind("zruseno", [])).toMatchObject({ code: "STAGE_CHANGED" });
    expect(store.deriveHandoffKind("potvrzeno", [])).toEqual({ kind: "predani" });
    expect(store.deriveHandoffKind("ve_vyrobe", [])).toEqual({ kind: "doplneni" });
    expect(store.deriveHandoffKind("ve_vyrobe", [{ status: "probiha", inHouse: true, supplier: null, supplierName: null, plannedEnd: "2026-11-20" }])).toEqual({ kind: "dalsi_krok" });
    expect(store.checkHandoffInputShape({ token: "x" } as never)).toMatch(/identifikátor/);
    expect(store.marginsOnlyViolation({ sendNow: ["*"] } as never, { job: { dueDate: null } } as never)).toMatch(/odešle obchodník/);
    void pstore;
  });
});
