import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReviewState } from "@/lib/jobs/capture-review";

/**
 * Majitel 5. 11.: „vyfotím doklad, AI ho přečte, položky jsou v zakázce, vyplním ceny položek — a hodnota
 * zakázky se nedoplní; čísla v systému nejsou propojená". Celý řetězec proti lokálnímu Supabase s testovací AI:
 *  1. foto objednávky → nová zakázka; člověk v kontrole přepíše cenu položky → hodnota zakázky = Σ položek
 *     (ne částka z hlavičky dokladu), nesoulad s hlavičkou se řekne jako upozornění;
 *  2. úprava ceny položky v kartě (saveJobItems) → hodnota následuje;
 *  3. ruční hodnota zakázky (setJobValue) → rozpočítá se na položky, Σ položek = hodnota;
 *  4. nákupní ceny položek → nákupní náklady (bez objednávek dodavatelům);
 *  5. foto objednávky k existující zakázce s položkami bez cen → ceny z dokladu, hodnota = Σ všech položek;
 *  6. createJob s částkou z hlavičky ≠ Σ položek → platí Σ položek.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/jobs/capture-value-sync.integration.test.ts
 */

const ENABLED = process.env.LOCAL_SUPABASE === "1";
const FIXTURES = path.resolve(process.cwd(), "src/lib/jobs/__fixtures__/capture");
const TAG = Date.now().toString(36);
const PREFIX = `Z-E2E-VAL-${TAG}`;

const h = vi.hoisted(() => ({ user: null as Record<string, unknown> | null }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

vi.mock("@/lib/supabase/server", async () => {
  const local = await import("@/test/local-supabase");
  const headers = await import("@/lib/supabase/actor-headers");
  return {
    isSupabaseConfigured: () => true,
    hasServiceKey: () => true,
    createAdminClient: (opts: { actor?: unknown } = {}) => local.localAdmin((opts.actor as never) ?? headers.SYSTEM_ACTOR),
    createOperatorClient: async (opts: { actor?: unknown } = {}) =>
      local.localAdmin(opts.actor !== undefined ? (opts.actor as never) : headers.userActor(h.user as never)),
    createClient: async () => {
      throw new Error("Bez session (test).");
    },
  };
});

vi.mock("@/lib/auth/session", async () => {
  const perms = await import("@/lib/auth/permissions");
  // bez API klíče → AI jen přes AI_FAKE_CAPTURE pro super admina
  const ctx = { aiEnabled: true, aiCaptureForAll: false, aiConfigured: false };
  const access = () => ({
    user: h.user, ctx, features: perms.allowedFeatures(h.user as never, ctx), can: (f: string) => perms.can(h.user as never, f as never, ctx),
  });
  return {
    getSessionUser: async () => h.user,
    getAccess: async () => access(),
    checkFeature: async (f: string) => (perms.can(h.user as never, f as never, ctx) ? { user: h.user } : { error: "K této akci nemáš oprávnění." }),
    apiRequire: async () => ({ user: h.user }),
    requireUser: async () => h.user,
    requireFeature: async () => h.user,
  };
});

type Row = Record<string, unknown>;
const FAKE_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 7)]);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

describe.skipIf(!ENABLED)("hodnota zakázky = součet položek napříč focením, kartou a nákupem (lokální Supabase)", () => {
  let svc: SupabaseClient;
  let admin: Row;
  const jobs: string[] = [];
  const ownPaths = new Set<string>();
  let n = 0;

  async function newJob(patch: Row): Promise<string> {
    n += 1;
    const { data, error } = await svc.from("orders").insert({
      number: `${PREFIX}-${n}`, title: `Hodnota ${n}`, source: "manual", inquiry_date: "2026-10-01", ...patch,
    }).select("id").single();
    if (error) throw new Error(error.message);
    jobs.push((data as { id: string }).id);
    return (data as { id: string }).id;
  }
  const job = async (id: string) => (await svc.from("orders").select("*").eq("id", id).single()).data as Row;
  async function items(id: string) {
    const { data } = await svc.from("order_items").select("id, drawing_number, quantity, unit_price, purchase_unit_price").eq("order_id", id).order("position");
    return ((data ?? []) as Row[]).map((r) => ({
      id: String(r.id), drawingNumber: r.drawing_number as string | null, quantity: Number(r.quantity),
      unitPrice: num(r.unit_price), purchaseUnitPrice: num(r.purchase_unit_price),
    }));
  }
  const sumOf = (list: { quantity: number; unitPrice: number | null }[]) =>
    Math.round(list.reduce((s, i) => s + (i.unitPrice === null ? 0 : i.quantity * i.unitPrice), 0) * 100) / 100;

  async function upload(s: typeof import("./capture-service"), filename: string) {
    const prep = await s.prepareCaptureUpload({ filename, size: FAKE_JPEG.length, mimeType: "image/jpeg" });
    if (!prep.ok) throw new Error(prep.error);
    ownPaths.add(prep.path!);
    const { error } = await svc.storage.from("job-files").uploadToSignedUrl(prep.path!, prep.token!, FAKE_JPEG, { contentType: "image/jpeg" });
    if (error) throw new Error(error.message);
    return { path: prep.path!, filename, mimeType: "image/jpeg", size: FAKE_JPEG.length };
  }

  beforeAll(async () => {
    const { localAdmin, DEMO, loadLocalEnv } = await import("@/test/local-supabase");
    const env = loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    svc = localAdmin();
    const { data: p } = await svc.from("profiles").select("id, email, role, full_name").eq("email", DEMO.admin.email).single();
    const a = p as { id: string; email: string; role: string; full_name: string };
    admin = { id: a.id, email: a.email, fullName: a.full_name, role: a.role, initials: "SA", roleLabel: a.role, aiAccess: false, active: true, hasProfile: true, mustChangePassword: false };
    h.user = admin;
    process.env.AI_FAKE_CAPTURE = path.join(FIXTURES, "objednavka-strojmetal.json");
  }, 60_000);

  afterAll(async () => {
    delete process.env.AI_FAKE_CAPTURE;
    if (!svc) return;
    for (const id of jobs) {
      const { data: files } = await svc.storage.from("job-files").list(`zakazky/${id}`, { limit: 100 });
      const paths = (files ?? []).map((f) => `zakazky/${id}/${f.name}`);
      if (paths.length) await svc.storage.from("job-files").remove(paths);
    }
    const { data: left } = await svc.storage.from("job-files").list(`capture/${admin?.id}`, { limit: 200 });
    const mine = (left ?? []).map((f) => `capture/${admin?.id}/${f.name}`)
      .filter((p) => ownPaths.has(p) || [...ownPaths].some((o) => p.startsWith(o.replace(/\.[^./]+$/, "")) && p.endsWith(".json")));
    if (mine.length) await svc.storage.from("job-files").remove(mine);
    if (jobs.length) {
      await svc.from("ai_training_examples").delete().in("job_id", jobs);
      await svc.from("ai_corrections").delete().eq("agent_key", "capture").like("context", `%${PREFIX}%`);
      await svc.from("orders").delete().in("id", jobs);
      await svc.from("audit_log").delete().in("entity_id", jobs);
    }
  }, 60_000);

  it("foto objednávky → nová zakázka: člověk přepíše cenu položky → hodnota = Σ položek, ne hlavička dokladu", async () => {
    const s = await import("./capture-service");
    const r = await import("./capture-review");
    const page = await upload(s, `foto-hodnota-${TAG}.jpg`);
    const res = await s.analyzeCapture({ files: [page] });
    if (!res.ok || !("model" in res)) throw new Error(JSON.stringify(res).slice(0, 300));
    const m = res.model;
    const best = m.targets.find((t) => t.key === m.initial.targetKey)!;
    const newT = m.targets.find((t) => t.key === "new")!;
    const choice = r.defaultCustomerChoice(newT, m.customerMatch, m.docCustomer);
    const fresh = r.switchTarget(m.initial, best, newT, choice, { mode: "none" });
    // AI: 50 × 1 180 + 50 × 960 = 107 000 = hlavička dokladu; člověk opraví cenu první položky na 1 000
    expect(fresh.fields.value).toBe("107000");
    expect(fresh.items.map((i) => `${i.drawingNumber}:${i.unitPrice}`)).toEqual(["VK-2291:1180", "VK-2292:960"]);
    const edited: ReviewState = r.syncLinkedTotals(
      { ...fresh, items: fresh.items.map((i) => (i.drawingNumber === "VK-2291" ? { ...i, unitPrice: "1000" } : i)) }, newT, m.margins,
    );
    expect(edited.fields.value).toBe("98000"); // formulář: hodnota následuje položky živě

    const saved = await s.applyCapture({ captureId: m.captureId, state: edited });
    expect(saved.ok, saved.error).toBe(true);
    jobs.push(saved.jobId!);
    expect(saved.created).toBe(true);
    expect(saved.warnings?.join("\n").replace(/[\u00a0\u202f]/g, " ")).toMatch(/Na dokladu je 107 000 Kč — položky dávají 98 000 Kč/);

    const j = await job(saved.jobId!);
    expect(num(j.value)).toBe(98_000);
    const its = await items(saved.jobId!);
    expect(its.map((i) => `${i.drawingNumber}:${i.unitPrice}`)).toEqual(["VK-2291:1000", "VK-2292:960"]);
    expect(sumOf(its)).toBe(num(j.value));

    // 2. karta zakázky — Položky: cena položky 1 000 → 1 200 → hodnota následuje (server i DB)
    const { saveJobItems } = await import("@/app/actions/jobs");
    const up1 = await saveJobItems(saved.jobId!, its.map((i) => ({
      id: i.id, drawingNumber: i.drawingNumber ?? "", quantity: i.quantity, unit: "ks",
      unitPrice: i.drawingNumber === "VK-2291" ? 1200 : i.unitPrice,
    })));
    expect(up1.ok, up1.error).toBe(true);
    expect(up1.value).toBe(108_000);
    expect(num((await job(saved.jobId!)).value)).toBe(108_000);

    // 3. ruční hodnota zakázky 100 000 → rozpočítá se poměrně na položky, Σ položek = hodnota
    const { setJobValue } = await import("@/app/actions/job-consistency");
    const dist = await setJobValue(saved.jobId!, 100_000, "proportional");
    expect(dist.ok, dist.error).toBe(true);
    expect(dist.value).toBe(100_000);
    expect(dist.changed).toBe(2);
    const after = await items(saved.jobId!);
    expect(sumOf(after)).toBe(100_000);
    expect(num((await job(saved.jobId!)).value)).toBe(100_000);
    const { data: ev } = await svc.from("job_events").select("message, data").eq("job_id", saved.jobId!).eq("type", "field").order("created_at", { ascending: false }).limit(1);
    expect(String((ev as Row[])[0]?.message)).toMatch(/rozpočítána na položky/);

    // přímý zápis jiné hodnoty do DB (jako by ji něco přepsalo) → DB ji srovná zpět na součet položek
    await svc.from("orders").update({ value: 1 }).eq("id", saved.jobId!);
    expect(num((await job(saved.jobId!)).value)).toBe(100_000);

    // 4. nákupní ceny položek → nákupní náklady = Σ nákupních cen (bez objednávek dodavatelům)
    const up2 = await saveJobItems(saved.jobId!, after.map((i) => ({
      id: i.id, drawingNumber: i.drawingNumber ?? "", quantity: i.quantity, unit: "ks", unitPrice: i.unitPrice,
      purchaseUnitPrice: i.drawingNumber === "VK-2291" ? 500 : 400,
    })));
    expect(up2.ok, up2.error).toBe(true);
    const j4 = await job(saved.jobId!);
    expect(num(j4.purchase_cost)).toBe(45_000);
    expect(num(j4.value)).toBe(100_000);
  }, 120_000);

  it("foto objednávky k zakázce s položkami bez cen → ceny z dokladu, hodnota = Σ všech položek", async () => {
    const s = await import("./capture-service");
    const jobId = await newJob({ status: "nabidka", customer_id: null });
    await svc.from("order_items").insert([{ order_id: jobId, position: 0, drawing_number: "VK-2291", name: "Upínka", quantity: 50, unit: "ks" }]);
    expect(num((await job(jobId)).value)).toBeNull();

    const page = await upload(s, `foto-existujici-${TAG}.jpg`);
    const res = await s.analyzeCapture({ files: [page], jobId });
    if (!res.ok || !("model" in res)) throw new Error(JSON.stringify(res).slice(0, 300));
    const m = res.model;
    expect(m.initial.targetKey).toBe(jobId);
    // nespárovaný řádek bez odpovědi by uložení zastavil — v testu jsou všechny řádky jisté / nové
    const r = await import("./capture-review");
    const state = { ...m.initial, items: m.initial.items.map((i) => (i.pair ? { ...i, pair: { ...i.pair, answer: "new" as const } } : i)) };
    expect(r.linkedTotal(state, m.margins)?.key).toBe("value");
    const saved = await s.applyCapture({ captureId: m.captureId, state });
    expect(saved.ok, saved.error).toBe(true);
    expect(saved.created).toBe(false);

    const its = await items(jobId);
    expect(its.length).toBe(2);
    expect(its.every((i) => i.unitPrice !== null)).toBe(true);
    const j = await job(jobId);
    expect(num(j.value)).toBe(sumOf(its));
    expect(num(j.value)).toBe(107_000);
  }, 120_000);

  it("createJob: částka z hlavičky ≠ Σ nacenených položek → platí Σ položek; bez cen zůstane ruční", async () => {
    const { createJob } = await import("@/app/actions/jobs");
    const a = await createJob({ title: `${PREFIX} header`, stage: "poptavka", value: 999, items: [{ quantity: 2, unit: "ks", unitPrice: 100, purchaseUnitPrice: 40 }, { quantity: 1, unit: "ks", unitPrice: 50 }] });
    expect(a.ok, a.error).toBe(true);
    jobs.push(a.id!);
    const ja = await job(a.id!);
    expect(num(ja.value)).toBe(250);
    expect(num(ja.purchase_cost)).toBe(80);

    const b = await createJob({ title: `${PREFIX} manual`, stage: "poptavka", value: 999, items: [{ quantity: 2, unit: "ks" }] });
    expect(b.ok, b.error).toBe(true);
    jobs.push(b.id!);
    expect(num((await job(b.id!)).value)).toBe(999);
  }, 60_000);
});
