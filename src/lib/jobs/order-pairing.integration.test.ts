import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ReviewModel } from "@/lib/jobs/capture-review";

/**
 * Majitel 30. 10. (Z-2026-022): objednávka zákazníka bez čísel výkresů („Unašeč upravený 142/026",
 * 4 ks á 18 630) nahraná k zakázce, která položky už má (F0N603W88, EM7223CL0000) → položky se
 * PŘIDALY podruhé (součet 2×). Teď: řádky se spárují (2 položky, součet = objednávka), nejistý řádek
 * je otázka a bez odpovědi se neuloží, staré duplicity jdou jedním ťuknutím sloučit (odkazy se přesunou).
 *   LOCAL_SUPABASE=1 npx vitest run src/lib/jobs/order-pairing.integration.test.ts
 * Zakládá vlastní zakázky (titul E2E-PAIR-…) a po sobě je smaže.
 */

const ENABLED = process.env.LOCAL_SUPABASE === "1";
const FIXTURES = path.resolve(process.cwd(), "src/lib/jobs/__fixtures__/capture");
const STROJMETAL = "d2000000-0000-0000-0000-000000000001";

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

const h = vi.hoisted(() => ({ user: null as Record<string, unknown> | null }));

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
  const headers = await import("@/lib/supabase/actor-headers");
  const admin = (opts: { actor?: unknown } = {}) => sb.createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(opts.actor ? { global: { headers: headers.actorHeaders(opts.actor as never) } } : {}),
  });
  return {
    isSupabaseConfigured: () => true,
    hasServiceKey: () => true,
    createAdminClient: admin,
    createOperatorClient: async (opts: { actor?: unknown } = {}) => admin(opts),
    createClient: async () => {
      throw new Error("Bez session (test).");
    },
  };
});

vi.mock("@/lib/auth/session", async () => {
  const perms = await import("@/lib/auth/permissions");
  const ctx = { aiEnabled: true, aiCaptureForAll: false, aiConfigured: false };
  const access = () => ({
    user: h.user, ctx, features: perms.allowedFeatures(h.user as never, ctx),
    can: (f: string) => perms.can(h.user as never, f as never, ctx),
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

function person(id: string, email: string, role: string, fullName: string) {
  return { id, email, fullName, role, initials: "TT", roleLabel: role, aiAccess: false, active: true, hasProfile: true, mustChangePassword: false };
}

const FAKE_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 9)]);

type Item = { id: string; position: number; drawing_number: string | null; revision: string | null; name: string | null; description: string | null; quantity: number; unit_price: number; note: string | null; material: string | null };

describe.skipIf(!ENABLED)("Objednávka ↔ položky zakázky: párování místo zdvojení (Z-2026-022)", () => {
  let db: SupabaseClient;
  let s: typeof import("./capture-service");
  let r: typeof import("./capture-review");
  let store: typeof import("./item-duplicates-store");
  let admin: ReturnType<typeof person>;
  const jobIds: string[] = [];
  const ownPaths = new Set<string>();
  const tag = `E2E-PAIR-${Date.now().toString(36)}`;

  async function upload(filename: string) {
    const prep = await s.prepareCaptureUpload({ filename, size: FAKE_JPEG.length, mimeType: "image/jpeg" });
    expect(prep.ok, prep.error).toBe(true);
    ownPaths.add(prep.path!);
    const { error } = await db.storage.from("job-files").uploadToSignedUrl(prep.path!, prep.token!, FAKE_JPEG, { contentType: "image/jpeg" });
    expect(error).toBeNull();
    return { path: prep.path!, filename, mimeType: "image/jpeg", size: FAKE_JPEG.length };
  }

  /** Zakázka jako ve screenshotu: položky z poptávky / výkresů s čísly výkresů a cenami, hodnota 151 480. */
  async function seedJob(title: string, extra: Partial<Item>[] = []): Promise<string> {
    const { data, error } = await db.from("orders").insert({
      title: `${tag} ${title}`, customer_id: STROJMETAL, status: "nabidka", value: 151480, currency: "CZK",
    }).select("id").single();
    expect(error).toBeNull();
    const id = (data as { id: string }).id;
    jobIds.push(id);
    const rows = [
      { position: 0, drawing_number: "F0N603W88", revision: "02", name: "Unašeč upravený", material: "14220", quantity: 4, unit_price: 18630 },
      { position: 1, drawing_number: "EM7223CL0000", revision: "02", name: "Matice upravená", material: "14220", quantity: 8, unit_price: 9620 },
      ...extra.map((e, i) => ({ position: 2 + i, ...e })),
    ].map((x) => ({ ...x, order_id: id, unit: "ks" }));
    const { error: iErr } = await db.from("order_items").insert(rows);
    expect(iErr).toBeNull();
    return id;
  }

  async function items(jobId: string): Promise<Item[]> {
    const { data } = await db.from("order_items").select("id, position, drawing_number, revision, name, description, quantity, unit_price, note, material").eq("order_id", jobId).order("position");
    return ((data ?? []) as Item[]).map((i) => ({ ...i, quantity: Number(i.quantity), unit_price: Number(i.unit_price) }));
  }

  beforeAll(async () => {
    const env = loadEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: p } = await db.from("profiles").select("id, email, role, full_name").eq("email", "admin@local.test").single();
    const a = p as { id: string; email: string; role: string; full_name: string };
    admin = person(a.id, a.email, a.role, a.full_name);
    s = await import("./capture-service");
    r = await import("./capture-review");
    store = await import("./item-duplicates-store");
  }, 60_000);

  afterAll(async () => {
    delete process.env.AI_FAKE_CAPTURE;
    if (!db) return;
    for (const id of jobIds) {
      const { data: files } = await db.storage.from("job-files").list(`zakazky/${id}`, { limit: 100 });
      const paths = (files ?? []).map((f) => `zakazky/${id}/${f.name}`);
      if (paths.length) await db.storage.from("job-files").remove(paths);
    }
    if (ownPaths.size) await db.storage.from("job-files").remove([...ownPaths]);
    if (admin) {
      const { data: left } = await db.storage.from("job-files").list(`capture/${admin.id}`, { limit: 200 });
      const sessions = (left ?? []).filter((f) => f.name.endsWith(".json") && f.created_at && Date.parse(f.created_at) > Date.now() - 3600_000);
      void sessions; // relace se po uložení mažou samy; cizí nemazat
    }
    if (jobIds.length) {
      await db.from("purchase_orders").delete().in("job_id", jobIds);
      await db.from("job_operations").delete().in("job_id", jobIds);
      await db.from("ai_training_examples").delete().in("job_id", jobIds);
      await db.from("audit_log").delete().in("entity_id", jobIds);
      await db.from("orders").delete().in("id", jobIds);
    }
  }, 60_000);

  it("screenshot: objednávka bez čísel výkresů se spáruje se 2 položkami, součet = objednávka", async () => {
    h.user = admin;
    const jobId = await seedJob("párování");
    process.env.AI_FAKE_CAPTURE = path.join(FIXTURES, "objednavka-bez-vykresu.json");
    const res = await s.analyzeCapture({ files: [await upload("objednavka-142-026.jpg")], jobId });
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    if (!res.ok || !("model" in res)) return;
    const m: ReviewModel = res.model;
    const t = m.targets.find((x) => x.key === jobId)!;
    // žádný nový řádek, obě položky jen doplněné
    expect(m.initial.items).toEqual([]);
    expect(m.initial.merges.map((x) => x.drawingNumber).sort()).toEqual(["EM7223CL0000", "F0N603W88"]);
    // text řádku zákazníka („… 142/026") do prázdného popisu položky
    expect(m.initial.merges.map((x) => x.patch.description).sort()).toEqual(["Matice upravená 142/026", "Unašeč upravený 142/026"]);
    expect(t.totals).toMatchObject({ order: 151480, ifPaired: 151480, pairedMatches: true });

    const saved = await s.applyCapture({ captureId: m.captureId, state: m.initial });
    expect(saved.ok, saved.error).toBe(true);
    expect(saved.itemsAdded ?? 0).toBe(0);
    const list = await items(jobId);
    expect(list).toHaveLength(2);
    expect(list.map((i) => [i.drawing_number, i.revision, i.material, i.quantity, i.unit_price])).toEqual([
      ["F0N603W88", "02", "14220", 4, 18630], ["EM7223CL0000", "02", "14220", 8, 9620],
    ]);
    expect(list[0].description).toBe("Unašeč upravený 142/026");
    expect(list.reduce((a, i) => a + i.quantity * i.unit_price, 0)).toBe(151480);
    const { data: job } = await db.from("orders").select("customer_order_number, value").eq("id", jobId).single();
    expect(job).toMatchObject({ customer_order_number: "142/026" });
    expect(Number((job as { value: number }).value)).toBe(151480);
  }, 90_000);

  it("pojistka na serveru: zastaralý formulář s řádky navíc položky nezdvojí", async () => {
    h.user = admin;
    const jobId = await seedJob("pojistka");
    process.env.AI_FAKE_CAPTURE = path.join(FIXTURES, "objednavka-bez-vykresu.json");
    const res = await s.analyzeCapture({ files: [await upload("objednavka-stara.jpg")], jobId });
    if (!res.ok || !("model" in res)) throw new Error("analyze");
    const m = res.model;
    // jako starý klient: řádky objednávky jako nové položky od AI, bez doplnění
    const state = {
      ...m.initial, merges: [],
      items: [
        { ...r.emptyReviewItem("ai-0"), name: "Unašeč upravený", description: "Unašeč upravený 142/026", quantity: "4", unitPrice: "18630", aiFilled: true },
        { ...r.emptyReviewItem("ai-1"), name: "Matice upravená", description: "Matice upravená 142/026", quantity: "8", unitPrice: "9620", aiFilled: true },
      ],
    };
    const saved = await s.applyCapture({ captureId: m.captureId, state });
    expect(saved.ok, saved.error).toBe(true);
    expect(await items(jobId)).toHaveLength(2);
  }, 90_000);

  it("nejistý řádek: otázka, bez odpovědi se neuloží; „Ano“ = doplnění položky", async () => {
    h.user = admin;
    const jobId = await seedJob("otázka");
    // jiný název řádku → jen podle počtu, ceny a součtu = otázka (≈ 2 %)
    const fx = JSON.parse(readFileSync(path.join(FIXTURES, "objednavka-bez-vykresu.json"), "utf8"));
    fx.items[0].name = "Díl A";
    fx.items[0].description = "Díl A 142/026";
    const tmp = path.join(process.cwd(), "node_modules/.cache", `pair-${tag}.json`);
    const fs = await import("node:fs");
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(fx));
    process.env.AI_FAKE_CAPTURE = tmp;
    try {
      const res = await s.analyzeCapture({ files: [await upload("objednavka-otazka.jpg")], jobId });
      if (!res.ok || !("model" in res)) throw new Error("analyze");
      const m = res.model;
      const asks = r.openPairQuestions(m.initial.items);
      expect(asks).toHaveLength(1);
      expect(asks[0].pair!.itemLabel).toContain("F0N603W88");
      expect(r.canAutoApply({ ...m, mode: "full" })).toBe(false);
      const t = m.targets.find((x) => x.key === jobId)!;
      expect(r.totalsCheckText(t.totals)).toMatch(/Součet položek 226\s?000,00\s?Kč ≠ objednávka 151\s?480,00\s?Kč/);

      const refused = await s.applyCapture({ captureId: m.captureId, state: m.initial });
      expect(refused.ok).toBe(false);
      expect(refused.error).toMatch(/Rozhodni u řádku „Díl A“|Rozhodni u řádku „Díl A"/);
      expect(await items(jobId)).toHaveLength(2);

      const yes = r.answerPairQuestion(m.initial, asks[0].key, true);
      expect(yes.items).toEqual([]);
      const saved = await s.applyCapture({ captureId: m.captureId, state: yes });
      expect(saved.ok, saved.error).toBe(true);
      const list = await items(jobId);
      expect(list).toHaveLength(2);
      expect(list[0].description).toBe("Díl A 142/026");
      expect(list.map((i) => i.name)).toEqual(["Unašeč upravený", "Matice upravená"]);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }, 90_000);

  it("staré duplicity: Sloučit ponechá položky s výkresem, přesune odkazy, smaže duplicity, historie", async () => {
    h.user = admin;
    const jobId = await seedJob("duplicity", [
      { name: "Unašeč upravený", description: "Unašeč upravený 142/026", quantity: 4, unit_price: 18630 },
      { name: "Matice upravená", description: "Matice upravená 142/026", quantity: 8, unit_price: 9620 },
    ]);
    const before = await items(jobId);
    expect(before).toHaveLength(4);
    const [keep1, keep2, dup1, dup2] = before;
    // odkazy na duplicitu: objednávka dodavateli + výrobní krok
    const { data: po } = await db.from("purchase_orders").insert({ job_id: jobId }).select("id").single();
    const poId = (po as { id: string }).id;
    const { error: poiErr } = await db.from("purchase_order_items").insert({ purchase_order_id: poId, order_item_id: dup1.id, name: "Unašeč", quantity: 4 });
    expect(poiErr).toBeNull();
    const { data: op, error: opErr } = await db.from("job_operations").insert({ job_id: jobId, order_item_ids: [dup2.id, keep1.id] }).select("id").single();
    expect(opErr).toBeNull();

    const found = await store.detectDuplicateItems(db as never, jobId);
    expect(found.map((f) => [f.keepId, f.dropId])).toEqual([[keep1.id, dup1.id], [keep2.id, dup2.id]]);

    // požadavek s prohozeným pořadím: server rozhodne, co zůstane
    const res = await store.mergeDuplicateItemsCore(db as never, jobId, [{ keepId: dup1.id, dropId: keep1.id }, { keepId: keep2.id, dropId: dup2.id }], admin.id);
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    const after = await items(jobId);
    expect(after.map((i) => i.id)).toEqual([keep1.id, keep2.id]);
    expect(after[0].description).toBe("Unašeč upravený 142/026");
    expect(after.map((i) => [i.drawing_number, i.revision, i.material])).toEqual([["F0N603W88", "02", "14220"], ["EM7223CL0000", "02", "14220"]]);
    const { data: poi } = await db.from("purchase_order_items").select("order_item_id").eq("purchase_order_id", poId);
    expect(poi).toEqual([{ order_item_id: keep1.id }]);
    const { data: opRow } = await db.from("job_operations").select("order_item_ids").eq("id", (op as { id: string }).id).single();
    expect((opRow as { order_item_ids: string[] }).order_item_ids.sort()).toEqual([keep1.id, keep2.id].sort());
    const { data: job } = await db.from("orders").select("value").eq("id", jobId).single();
    expect(Number((job as { value: number }).value)).toBe(151480);
    const { data: ev } = await db.from("job_events").select("message, actor_id").eq("job_id", jobId).like("message", "Sloučeny duplicitní položky%");
    expect(ev).toHaveLength(1);
    expect((ev![0] as { actor_id: string }).actor_id).toBe(admin.id);

    // podruhé už nic: server odmítne (nejsou duplicitní)
    const again = await store.mergeDuplicateItemsCore(db as never, jobId, [{ keepId: keep1.id, dropId: dup1.id }], admin.id);
    expect(again.ok).toBe(false);
  }, 90_000);
});
