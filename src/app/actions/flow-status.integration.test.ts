import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { QUOTE_ADMIN_ONLY } from "@/lib/jobs/flow-status";

/**
 * Akce podrobných stavů toku proti lokálnímu Supabase: skutečný PostgREST, klient nese hlavičky
 * autora (jako produkční server.ts), oprávnění podle skutečné matice rolí. Mockuje se jen
 * přihlášení (přepínatelný uživatel) a revalidace Next.js. Vlastní zakázky Z-E2E-FLOW-ACT-*.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/app/actions/flow-status.integration.test.ts
 */

const ENABLED = process.env.LOCAL_SUPABASE === "1";
const PREFIX = `Z-E2E-FLOW-ACT-${Date.now().toString(36)}`;

const who = vi.hoisted(() => ({
  users: {} as Record<string, { id: string; email: string; fullName: string; role: "super_admin" | "obchodnik" | "zamestnanec" }>,
  current: "sales" as "sales" | "worker" | "admin",
  race: null as null | (() => Promise<void>),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

vi.mock("@/lib/supabase/server", async () => {
  const local = await import("@/test/local-supabase");
  const headers = await import("@/lib/supabase/actor-headers");
  /** Souběh: první update tabulky orders nejdřív počká na „cizí“ zápis (optimistický zámek). */
  const withRace = (c: SupabaseClient) => {
    const from = c.from.bind(c);
    (c as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const qb = from(t) as unknown as { update: (...a: unknown[]) => { then: (...x: unknown[]) => unknown } };
      if (t === "orders") {
        const up = qb.update.bind(qb);
        qb.update = (...a: unknown[]) => {
          const b = up(...a);
          const race = who.race;
          if (race) {
            who.race = null;
            const orig = b.then.bind(b);
            b.then = (res: unknown, rej: unknown) => race().then(() => orig(res, rej));
          }
          return b;
        };
      }
      return qb;
    };
    return c;
  };
  const current = () => {
    const u = who.users[who.current];
    return headers.userActor(u ? { id: u.id } : null);
  };
  return {
    isSupabaseConfigured: () => true,
    hasServiceKey: () => true,
    createAdminClient: (opts: { actor?: unknown } = {}) => local.localAdmin((opts.actor as never) ?? headers.SYSTEM_ACTOR),
    createOperatorClient: async (opts: { actor?: unknown } = {}) =>
      withRace(local.localAdmin(opts.actor !== undefined ? (opts.actor as never) : current())),
    createClient: async () => {
      throw new Error("Bez session (test).");
    },
  };
});

vi.mock("@/lib/auth/session", async () => {
  const perms = await import("@/lib/auth/permissions");
  const user = () => {
    const u = who.users[who.current];
    return {
      ...u, initials: "XX", roleLabel: u.role, aiAccess: true, active: true, hasProfile: true, mustChangePassword: false,
    };
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

type Flow = typeof import("@/app/actions/flow-status");
type Jobs = typeof import("@/app/actions/jobs");
type Prod = typeof import("@/app/actions/production");
type Row = Record<string, unknown>;

describe.skipIf(!ENABLED)("akce podrobných stavů toku ↔ lokální Supabase", () => {
  let svc: SupabaseClient;
  let a: Flow;
  let j: Jobs;
  let p: Prod;
  const jobs: string[] = [];
  let n = 0;
  let limitBefore: { value: string } | null = null;

  const as = (u: "sales" | "worker" | "admin") => { who.current = u; };
  const id = (u: "sales" | "worker" | "admin") => who.users[u].id;

  async function newJob(patch: Row = {}): Promise<string> {
    n += 1;
    const { localAdmin } = await import("@/test/local-supabase");
    const { userActor } = await import("@/lib/supabase/actor-headers");
    const { data, error } = await localAdmin(userActor({ id: id("sales") })).from("orders").insert({
      number: `${PREFIX}-${n}`, title: `Akce ${n}`, source: "email", status: "poptavka", inquiry_date: "2026-10-20", owner_id: id("sales"), ...patch,
    }).select("id").single();
    if (error) throw new Error(error.message);
    jobs.push((data as { id: string }).id);
    return (data as { id: string }).id;
  }
  async function job(jobId: string): Promise<Row> {
    return (await svc.from("orders").select("*").eq("id", jobId).single()).data as Row;
  }
  async function flow(jobId: string): Promise<Row> {
    return (await svc.from("job_flow_v").select("*").eq("id", jobId).single()).data as Row;
  }
  async function events(jobId: string, type?: string) {
    let q = svc.from("job_events").select("type, message, data, actor_id, actor_kind, via").eq("job_id", jobId);
    if (type) q = q.eq("type", type);
    return ((await q.order("created_at")).data ?? []) as { type: string; message: string; data: Row; actor_id: string | null; actor_kind: string; via: string | null }[];
  }
  async function quoteRow(quoteId: string): Promise<Row> {
    return (await svc.from("quotes").select("*").eq("id", quoteId).single()).data as Row;
  }
  /** #25: výchozí autor = super admin (jeho nabídka schválení nepotřebuje → „Rozpracovaná“);
   *  `author: "sales"` = nabídka obchodníka → „Neschválená“, dokud ji super admin neschválí. */
  async function addQuote(jobId: string, patch: Row = {}, author: "sales" | "admin" = "admin"): Promise<string> {
    const { localAdmin } = await import("@/test/local-supabase");
    const { userActor } = await import("@/lib/supabase/actor-headers");
    const { data, error } = await localAdmin(userActor({ id: id(author) })).from("quotes").insert({
      number: `${PREFIX}-Q${++n}`, job_id: jobId, status: "ke_schvaleni", total: 50_000, revision: 1, valid_until: "2099-01-01", owner_id: id("sales"), ...patch,
    }).select("id").single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  }
  /** #25: super admin schválí jen nabídku s položkami a cenami. */
  async function addQuoteItem(quoteId: string, unitPrice = 50_000): Promise<void> {
    const { error } = await svc.from("quote_items").insert({ quote_id: quoteId, position: 0, name: "Díl", quantity: 1, unit: "ks", unit_price: unitPrice, vat_rate: 21 });
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
    const { data: lim } = await svc.from("integration_settings").select("value").eq("key", "quote_approval_limit").maybeSingle();
    limitBefore = (lim as { value: string } | null) ?? null;
    a = await import("@/app/actions/flow-status");
    j = await import("@/app/actions/jobs");
    p = await import("@/app/actions/production");
  }, 60_000);

  afterAll(async () => {
    if (!svc) return;
    who.race = null;
    if (limitBefore) await svc.from("integration_settings").update({ value: limitBefore.value }).eq("key", "quote_approval_limit");
    else await svc.from("integration_settings").delete().eq("key", "quote_approval_limit");
    if (jobs.length) {
      await svc.from("job_files").delete().in("job_id", jobs);
      await svc.from("invoices").delete().in("order_id", jobs);
      await svc.from("quotes").delete().in("job_id", jobs);
      await svc.from("orders").delete().in("id", jobs);
      await svc.from("audit_log").delete().in("entity_id", jobs);
      await svc.from("audit_log").delete().in("diff->>jobId", jobs);
    }
  }, 60_000);

  // ── Poptávka ──────────────────────────────────────────────
  it("převzetí a odmítnutí poptávky obchodníkem s důvodem → Nerealizováno + kdo", async () => {
    const jobId = await newJob();
    as("sales");
    expect(await a.takeInquiry(jobId)).toMatchObject({ ok: true, inquiryStatus: "v_reseni", stage: "poptavka" });
    expect(await job(jobId)).toMatchObject({ assignee_id: id("sales"), inquiry_status_changed_by: id("sales"), inquiry_status_changed_via: "rucne" });
    expect((await a.setInquiryStatus(jobId, "odmitnuta", {})).error).toBe("Vyber důvod.");
    expect((await a.setInquiryStatus(jobId, "odmitnuta", { reason: "cena" })).error).toBe("Vyber důvod."); // „cena“ je důvod zákazníka
    expect((await a.setInquiryStatus(jobId, "odmitnuta", { reason: "jine" })).error).toContain("doplň poznámku");
    const r = await a.setInquiryStatus(jobId, "odmitnuta", { reason: "kapacita", note: "plno do prosince" });
    expect(r).toMatchObject({ ok: true, stage: "nerealizovano", inquiryStatus: "odmitnuta" });
    expect(await job(jobId)).toMatchObject({ lost_reason: "kapacita", lost_note: "plno do prosince", lost_by: id("sales"), stage_changed_via: "automaticky", stage_change_cause: "poptavka" });
    const ev = [...await events(jobId, "status"), ...await events(jobId, "stage")];
    expect(ev.map((e) => e.message)).toEqual([
      "Poptávka: Přijatá → V řešení",
      "Poptávka: V řešení → Odmítnutá — Nestíháme (kapacita / termín): plno do prosince",
      "Stav: Poptávka → Nerealizováno — automaticky (poptávka uzavřena) · důvod: Nestíháme (kapacita / termín)",
    ]);
    expect(ev.every((e) => e.actor_id === id("sales"))).toBe(true);
    expect(JSON.stringify(ev)).not.toMatch(/\d{4,}\s?Kč/);
  });

  it("převzít od jiného řešitele: nejdřív dotaz, pak převzetí + událost", async () => {
    const jobId = await newJob({ assignee_id: null });
    as("worker");
    expect(await a.takeInquiry(jobId)).toMatchObject({ ok: true });
    as("sales");
    const ask = await a.takeInquiry(jobId);
    expect(ask).toMatchObject({ ok: false, needsConfirm: `Převzít od ${who.users.worker.fullName}?` });
    expect(await a.takeInquiry(jobId, { force: true })).toMatchObject({ ok: true });
    expect((await job(jobId)).assignee_id).toBe(id("sales"));
    expect((await events(jobId, "field")).at(-1)?.message).toBe(`Řešitel: ${who.users.worker.fullName} → ${who.users.sales.fullName} (převzato)`);
  });

  it("zaměstnanec neodmítne, jen navrhne; obchodník návrh přijme („na návrh: X“)", async () => {
    const jobId = await newJob();
    as("worker");
    expect((await a.setInquiryStatus(jobId, "odmitnuta", { reason: "nevyrabime" })).error).toBe("K této akci nemáš oprávnění.");
    expect(await a.proposeFlowChange(jobId, { phase: "inquiry", to: "odmitnuta", reason: "nevyrabime" })).toMatchObject({ ok: true });
    expect(await job(jobId)).toMatchObject({ flow_proposal_by: id("worker"), flow_proposal: expect.objectContaining({ label: "Odmítnout poptávku — Nevyrábíme (technologie)", kind: "user" }) });
    expect((await a.decideFlowProposal(jobId, true)).error).toBe("K této akci nemáš oprávnění.");
    as("sales");
    expect((await a.proposeFlowChange(jobId, { phase: "inquiry", to: "stazena", reason: "bez_odezvy" })).error).toContain("už čeká návrh");
    const r = await a.decideFlowProposal(jobId, true);
    expect(r).toMatchObject({ ok: true, stage: "nerealizovano", inquiryStatus: "odmitnuta" });
    const jj = await job(jobId);
    expect(jj).toMatchObject({ flow_proposal: null, lost_reason: "nevyrabime", lost_by: id("sales") });
    const msgs = (await events(jobId, "status")).map((e) => e.message);
    expect(msgs).toContain(`Návrh: Odmítnout poptávku — Nevyrábíme (technologie)`);
    expect(msgs.some((m) => m.startsWith("Poptávka: Přijatá → Odmítnutá — Nevyrábíme (technologie)"))).toBe(true);
    expect(msgs).toContain("Návrh uzavřen: Odmítnout poptávku — Nevyrábíme (technologie)");
    // korekce s poznámkou z návrhu jde do hlavičky → poznámka u stavové události není (důvod má přednost)
    expect((await events(jobId, "stage")).at(-1)?.message).toContain("Nerealizováno");
  });

  it("M6c: obnovení odmítnuté poptávky ze Zrušeno vrátí zakázku do Poptávky", async () => {
    const jobId = await newJob();
    as("sales");
    const m = await a.moveJobStage(jobId, "zruseno", { reason: "duplicita" });
    expect(m).toMatchObject({ ok: true, stage: "zruseno", inquiryStatus: "odmitnuta" });
    expect(await a.setInquiryStatus(jobId, "prijata")).toMatchObject({ ok: true, stage: "poptavka", inquiryStatus: "prijata" });
    expect(await job(jobId)).toMatchObject({ lost_reason: null, lost_at: null, stage_change_cause: "obnoveni" });
    as("worker");
    expect((await a.moveJobStage(jobId, "nerealizovano", { reason: "cena" })).error).toBe("K této akci nemáš oprávnění.");
    expect((await a.setInquiryStatus(jobId, "ceka_na_podklady")).error).toContain("Napiš, co chybí");
    expect(await a.setInquiryStatus(jobId, "ceka_na_podklady", { note: "chybí STEP model" })).toMatchObject({ ok: true, inquiryStatus: "ceka_na_podklady" });
    expect((await job(jobId)).waiting_note).toBe("chybí STEP model");
  });

  // ── Nabídka ───────────────────────────────────────────────
  it("AI nabídka v režimu se schválením: odeslat bez schválení nejde, „Schválit a odeslat“ projde", async () => {
    const jobId = await newJob({ status: "naceneni" });
    const qId = await addQuote(jobId, { ai_generated: true });
    expect(await quoteRow(qId)).toMatchObject({ approval_required: true, state: "ke_schvaleni" });
    await addQuoteItem(qId);
    as("sales");
    const direct = await j.markJobQuoteSent(qId);
    expect(direct.error).toBe("Nabídka čeká na schválení — odeslat ji lze až po schválení.");
    expect((await a.setQuoteState(qId, "odeslana")).error).toContain("nejde přejít");
    as("worker");
    expect((await a.approveAndSendQuote(qId)).error).toBe("K této akci nemáš oprávnění.");
    // #25: schvaluje (i „Schválit a odeslat“) jen super admin
    as("sales");
    expect((await a.approveAndSendQuote(qId)).error).toBe("K této akci nemáš oprávnění.");
    as("admin");
    const r = await a.approveAndSendQuote(qId);
    expect(r).toMatchObject({ ok: true, quoteState: "odeslana", stage: "nabidka" });
    expect(await quoteRow(qId)).toMatchObject({ approved_by: id("admin"), sent_by: id("admin"), sent_via: "rucne", state_changed_by: id("admin") });
    expect((await job(jobId)).inquiry_status).toBe("zpracovana");
  });

  it("#25: nabídku obchodníka schvaluje jen super admin; limit částky už schválení nevyžaduje", async () => {
    await svc.from("integration_settings").upsert({ key: "quote_approval_limit", value: "100000", category: "firma", label: "Limit schválení nabídek", is_secret: false });
    try {
      const jobId = await newJob({ status: "naceneni" });
      // nabídka super admina nad (dřívějším) limitem → bez schválení
      const big = await addQuote(jobId, { total: 150_000 });
      expect(await quoteRow(big)).toMatchObject({ approval_required: false, state: "rozpracovana" });
      const qId = await addQuote(jobId, { total: 150_000 }, "sales");
      await addQuoteItem(qId, 150_000);
      expect(await quoteRow(qId)).toMatchObject({ approval_required: true, admin_approval_required: true, state: "ke_schvaleni", created_by: id("sales") });
      as("sales");
      expect((await j.approveJobQuote(qId)).error).toBe("K této akci nemáš oprávnění.");
      expect((await a.setQuoteState(qId, "schvalena")).error).toBe(QUOTE_ADMIN_ONLY);
      expect((await a.setQuoteState(qId, "ke_schvaleni")).error).toContain("předávat je není potřeba");
      as("admin");
      expect(await a.setQuoteState(qId, "schvalena")).toMatchObject({ ok: true, quoteState: "schvalena" });
      expect((await quoteRow(qId)).approved_by).toBe(id("admin"));
    } finally {
      if (limitBefore) await svc.from("integration_settings").update({ value: limitBefore.value }).eq("key", "quote_approval_limit");
      else await svc.from("integration_settings").delete().eq("key", "quote_approval_limit");
    }
  });

  it("odeslání (staré markJobQuoteSent) → sent_by + Nabídka (1 událost), přijetí → objednávka rev 1, sourozenec archiv", async () => {
    const jobId = await newJob({ status: "naceneni" });
    const q1 = await addQuote(jobId);
    const q2 = await addQuote(jobId, { revision: 2 });
    as("sales");
    expect(await j.markJobQuoteSent(q1)).toMatchObject({ ok: true });
    expect(await quoteRow(q1)).toMatchObject({ sent_by: id("sales"), state: "odeslana" });
    const st = await events(jobId, "stage");
    expect(st).toHaveLength(1);
    expect(st[0]).toMatchObject({ message: "Stav: Nacenění → Nabídka odeslaná — automaticky (nabídka)", actor_id: id("sales"), via: "automaticky" });
    expect(await a.setQuoteState(q1, "prijata")).toMatchObject({ ok: true, quoteState: "prijata", stage: "objednavka", orderStatus: "dorucena" });
    expect(await quoteRow(q2)).toMatchObject({ archived: true, superseded_by: q1, state: "archivovana" });
    expect(await job(jobId)).toMatchObject({ quote_id: q1, order_revision: 1, order_status: "dorucena" });
    const { data: rev } = await svc.from("job_order_revisions").select("revision, decision").eq("job_id", jobId);
    expect(rev).toEqual([{ revision: 1, decision: "ceka" }]);
  });

  it("zamítnutí nabídky s uzavřením zakázky (RPC) → Nerealizováno + důvod; zákazník se vrátil", async () => {
    const jobId = await newJob({ status: "naceneni" });
    const qId = await addQuote(jobId);
    as("sales");
    await a.setQuoteState(qId, "odeslana", { note: "osobně na schůzce" });
    expect((await a.setQuoteState(qId, "zamitnuta", {})).error).toBe("Vyber důvod.");
    const r = await a.setQuoteState(qId, "zamitnuta", { reason: "cena", note: "o 12 % dráž", competitorPrice: 41_000 });
    expect(r).toMatchObject({ ok: true, quoteState: "zamitnuta", stage: "nerealizovano" });
    expect(await quoteRow(qId)).toMatchObject({ lost_reason: "cena", rejected_reason: "o 12 % dráž", rejected_by: id("sales"), competitor_price: 41000 });
    expect(await job(jobId)).toMatchObject({ lost_reason: "cena", lost_note: "o 12 % dráž" });
    const back = await a.setQuoteState(qId, "odeslana");
    expect(back).toMatchObject({ ok: true, quoteState: "odeslana", stage: "nabidka" });
    expect(await quoteRow(qId)).toMatchObject({ lost_reason: null, rejected_by: null, competitor_price: null });
    expect(await job(jobId)).toMatchObject({ lost_reason: null });
  });

  it("M2: korekce Nabídka → Nerealizováno zamítne odeslanou a archivuje koncept; → Objednávka přijme jedinou odeslanou", async () => {
    as("sales");
    const j1 = await newJob({ status: "naceneni" });
    const sent = await addQuote(j1);
    await a.setQuoteState(sent, "odeslana");
    const draft = await addQuote(j1, { revision: 2 });
    const m = await a.moveJobStage(j1, "nerealizovano", { reason: "termin" });
    expect(m.effect).toMatchObject({ quotesRejected: [expect.stringContaining(PREFIX)], quotesArchived: [expect.stringContaining(PREFIX)] });
    expect(await quoteRow(sent)).toMatchObject({ status: "zamitnuto", lost_reason: "termin", rejected_by: id("sales") });
    expect(await quoteRow(draft)).toMatchObject({ archived: true, state: "archivovana" });
    expect((await events(j1, "quote")).filter((e) => (e.data as Row).origin === "db").map((e) => e.via)).toEqual(expect.arrayContaining(["automaticky"]));

    const j2 = await newJob({ status: "naceneni" });
    const only = await addQuote(j2);
    await a.setQuoteState(only, "odeslana");
    const m2 = await a.moveJobStage(j2, "objednavka");
    expect(m2.effect?.quoteAccepted).toContain(PREFIX);
    expect(await quoteRow(only)).toMatchObject({ status: "prijato", accepted_by: id("sales") });
    expect(await job(j2)).toMatchObject({ quote_id: only, order_status: "dorucena", value: 50000 });
  });

  // ── Objednávka a potvrzení ────────────────────────────────
  it("Potvrzeno jinak → Potvrzeno, potvrzení odesláno; změna rev 2 → aktualizovaná; přijetí změny bez odeslání = bez dokladu", async () => {
    const jobId = await newJob({ status: "objednavka", order_date: "2026-10-01", customer_order_number: "PO-ACT-1" });
    as("sales");
    // naše PDF potvrzení k rev 1 (pro pozdější e-mail se starým souborem)
    const { localAdmin } = await import("@/test/local-supabase");
    const { userActor } = await import("@/lib/supabase/actor-headers");
    const { data: file } = await localAdmin(userActor({ id: id("sales") })).from("job_files")
      .insert({ job_id: jobId, kind: "potvrzeni", filename: "pot1.pdf", storage_path: `zakazky/${jobId}/pot1.pdf`, origin: "generated" }).select("id").single();
    expect((await flow(jobId)).confirmation_key).toBe("vystaveno");
    const r = await a.setOrderStatus(jobId, "potvrzena", { note: "telefonicky" });
    expect(r).toMatchObject({ ok: true, stage: "potvrzeno", orderStatus: "potvrzena" });
    expect(await job(jobId)).toMatchObject({ confirmed_by: id("sales"), confirmation_sent_by: id("sales"), confirmation_sent_via: "rucne", confirmation_sent_revision: 1, order_confirmed_revision: 1 });
    expect((await flow(jobId)).confirmation_key).toBe("odeslano");

    expect((await a.registerOrderChange(jobId, {})).error).toBe("Popiš, co zákazník změnil.");
    const ch = await a.registerOrderChange(jobId, { note: "Množství 120 → 150 ks", changes: [{ field: "quantity", label: "Množství", from: 120, to: 150 }] });
    expect(ch).toMatchObject({ ok: true, revision: 2, orderStatus: "aktualizovana", stage: "potvrzeno" });
    expect(await job(jobId)).toMatchObject({ order_revision: 2, order_changed_by: id("sales"), order_confirmed_revision: 1 });
    const { data: revs } = await svc.from("job_order_revisions").select("revision, decision, created_by, note").eq("job_id", jobId).order("revision");
    expect(revs).toEqual([
      { revision: 1, decision: "prijata", created_by: id("sales"), note: null },
      { revision: 2, decision: "ceka", created_by: id("sales"), note: "Množství 120 → 150 ks" },
    ]);
    expect((await events(jobId, "status")).at(-1)?.message).toBe("Objednávka: Potvrzená → Aktualizovaná (rev 2) — Množství 120 → 150 ks");
    expect((await a.setOrderStatus(jobId, "potvrzena")).error).toContain("Rozhodni o změně");

    expect(await a.decideOrderChange(jobId, true)).toMatchObject({ ok: true, orderStatus: "potvrzena" });
    expect(await job(jobId)).toMatchObject({ order_confirmed_revision: 2, confirmation_sent_revision: 1 });
    expect((await flow(jobId)).confirmation_key).toBe("bez_dokladu");
    // e-mail se starým PDF (rev 1) rev 2 nepotvrdí
    await svc.from("job_events").insert({ job_id: jobId, type: "email", message: "E-mail: potvrzení", data: { kind: "potvrzeni", fileId: (file as { id: string }).id }, actor_id: id("sales") });
    expect(await job(jobId)).toMatchObject({ confirmation_sent_revision: 1, order_status: "potvrzena" });
    expect((await flow(jobId)).confirmation_key).toBe("bez_dokladu");

    // další změna: nepřijímáme → zůstává rev 2 potvrzená, revize 3 odmítnutá
    await a.registerOrderChange(jobId, { note: "Termín o týden dřív" });
    expect((await a.decideOrderChange(jobId, false)).error).toContain("proč změnu nepřijímáme");
    expect(await a.decideOrderChange(jobId, false, { note: "Termín nestihneme" })).toMatchObject({ ok: true, orderStatus: "potvrzena" });
    expect(await job(jobId)).toMatchObject({ order_revision: 3, order_confirmed_revision: 2 });
    const { data: r3 } = await svc.from("job_order_revisions").select("decision, decided_by, decision_note").eq("job_id", jobId).eq("revision", 3).single();
    expect(r3).toEqual({ decision: "odmitnuta", decided_by: id("sales"), decision_note: "Termín nestihneme" });
    expect((await events(jobId, "status")).at(-1)?.message).toBe("Objednávka: Aktualizovaná → Potvrzená (rev 3) — změna nepřijata: Termín nestihneme");
  });

  it("storno: bez dodávky → Zrušeno, s dodávkou stav zůstává; obnovení jen admin; rozpor + žádost o opravu", async () => {
    as("sales");
    const j1 = await newJob({ status: "potvrzeno", order_date: "2026-10-01", customer_order_number: "PO-ST-1" });
    expect((await a.setOrderStatus(j1, "stornovana", { reason: "cena" })).error).toBe("Vyber důvod.");
    expect(await a.setOrderStatus(j1, "stornovana", { reason: "projekt_zrusen" })).toMatchObject({ ok: true, stage: "zruseno", orderStatus: "stornovana" });
    expect((await a.setOrderStatus(j1, "potvrzena")).error).toBe("K této akci nemáš oprávnění.");
    as("admin");
    expect(await a.setOrderStatus(j1, "potvrzena")).toMatchObject({ ok: true, stage: "potvrzeno", orderStatus: "potvrzena" });

    as("sales");
    const j2 = await newJob({ status: "ve_vyrobe", order_date: "2026-10-01", customer_order_number: "PO-ST-2" });
    await svc.from("order_items").insert([{ order_id: j2, name: "A", quantity: 2, position: 0 }, { order_id: j2, name: "B", quantity: 1, position: 1 }]);
    const { data: its } = await svc.from("order_items").select("id").eq("order_id", j2).order("position");
    await a.setDeliveredQuantities(j2, [{ itemId: (its as { id: string }[])[0].id, delivered: 2 }]);
    expect(await a.setOrderStatus(j2, "stornovana", { reason: "projekt_zrusen" })).toMatchObject({ ok: true, stage: "ve_vyrobe", orderStatus: "stornovana" });

    const j3 = await newJob({ status: "objednavka", order_date: "2026-10-01", customer_order_number: "PO-ST-3" });
    expect((await a.setOrderStatus(j3, "rozpor")).error).toContain("Vyjmenuj");
    expect(await a.setOrderStatus(j3, "rozpor", { mismatch: { items: [{ kind: "chybi_polozka", label: "Chybí položka B" }] } })).toMatchObject({ ok: true, orderStatus: "rozpor" });
    expect(await a.requestOrderFix(j3, { note: "poslán e-mail nákupčímu" })).toMatchObject({ ok: true });
    expect(((await job(j3)).order_mismatch as Row).fix_requested_at).toBeTruthy();
    expect((await events(j3, "status")).at(-1)?.message).toBe("Požádáno o opravu objednávky — poslán e-mail nákupčímu");
    expect(await a.setOrderStatus(j3, "potvrzena")).toMatchObject({ ok: true, stage: "potvrzeno" });
    expect(((await job(j3)).order_mismatch as Row).resolved).toMatchObject({ decision: "prijato_jak_je", by: id("sales") });
  });

  // ── Dodání ────────────────────────────────────────────────
  it("dodání po položkách: 1 ze 2 → částečně; uzavření druhé s menším množstvím → Dodáno zákazníkovi; DL před další dodávkou neplatí; uložení položek dodávky zachová", async () => {
    as("worker");
    const jobId = await newJob({ status: "ve_vyrobe", order_date: "2026-10-01", customer_order_number: "PO-DEL" });
    await svc.from("order_items").insert([{ order_id: jobId, name: "Příruba", quantity: 200, unit: "ks", position: 0 }, { order_id: jobId, name: "Hřídel", quantity: 10, unit: "ks", position: 1 }]);
    const { data: its } = await svc.from("order_items").select("id, name, quantity").eq("order_id", jobId).order("position");
    const [i1, i2] = its as { id: string; name: string; quantity: number }[];
    expect((await a.setDeliveredQuantities(jobId, [{ itemId: i1.id, delivered: 400 }])).error).toContain("nadodání");
    const d1 = await a.setDeliveredQuantities(jobId, [{ itemId: i1.id, delivered: 200 }, { itemId: i2.id, delivered: 6 }]);
    expect(d1).toMatchObject({ ok: true, stage: "ve_vyrobe" });
    expect(await flow(jobId)).toMatchObject({ delivery_key: "castecne", items_delivered: 1, items_partial: 1 });
    expect((await events(jobId, "field")).at(-1)?.message).toBe("Dodáno: Příruba 200/200 ks, Hřídel 6/10 ks · 1 z 2 položek");

    // uložení položek (upsert) dodávky zachová a stav neposune
    as("sales");
    const saved = await j.saveJobItems(jobId, [
      { id: i1.id, name: "Příruba", quantity: 200, unit: "ks" },
      { id: i2.id, name: "Hřídel (upraveno)", quantity: 10, unit: "ks" },
    ] as never);
    expect(saved).toMatchObject({ ok: true });
    const { data: after } = await svc.from("order_items").select("id, name, delivered_quantity").eq("order_id", jobId).order("position");
    expect(after).toEqual([{ id: i1.id, name: "Příruba", delivered_quantity: 200 }, { id: i2.id, name: "Hřídel (upraveno)", delivered_quantity: 6 }]);
    expect((await job(jobId)).status).toBe("ve_vyrobe");

    as("worker");
    await svc.from("orders").update({ delivery_note_confirmed_at: "2026-10-20" }).eq("id", jobId);
    expect(await a.closeItemDelivery(jobId, i2.id, { reason: "4 ks zmetky, zákazník souhlasí" })).toMatchObject({ ok: true, stage: "dodano_zakaznikovi" });
    expect(await job(jobId)).toMatchObject({ stage_change_cause: "dodani", stage_changed_via: "automaticky", stage_changed_by: id("worker"), items_delivered: 2 });
    const { data: closed } = await svc.from("order_items").select("delivery_closed, delivery_closed_by, delivery_closed_reason").eq("id", i2.id).single();
    expect(closed).toEqual({ delivery_closed: true, delivery_closed_by: id("worker"), delivery_closed_reason: "4 ks zmetky, zákazník souhlasí" });
    // DL potvrzený 20. 10., poslední dodávka dnes → jen „dodáno“
    expect((await flow(jobId)).delivery_key).toBe("dodano");
  });

  // ── Úhrady ────────────────────────────────────────────────
  it("úhrady: 30 % částečně, doplatek vyrovná (Dokončeno), markJobPaid s nižší částkou vyrovná, korekce Dokončeno + další platba nevrací, smazání vyrovnání → Vyfakturováno", async () => {
    as("sales");
    const jobId = await newJob({ status: "fakturovano", order_date: "2026-09-01", customer_order_number: "PO-PAY", value: 100_000, invoice_number: `FV-${PREFIX}` });
    const r1 = await a.recordJobPayment(jobId, { date: "2026-10-10", amount: 30_000 });
    expect(r1).toMatchObject({ ok: true, stage: "fakturovano", paymentState: "castecne_zaplaceno" });
    expect(await job(jobId)).toMatchObject({ paid_at: null, paid_amount: null, paid_so_far: 30000 });
    const r2 = await a.recordJobPayment(jobId, { date: "2026-10-20", amount: 70_000 });
    expect(r2).toMatchObject({ ok: true, stage: "dokonceno", paymentState: "zaplaceno" });
    expect(await job(jobId)).toMatchObject({ paid_at: "2026-10-20", paid_amount: 100000, paid_by: id("sales"), stage_change_cause: "platba" });
    const pe = (await events(jobId, "field")).filter((e) => (e.data as Row).production === "payment");
    expect(pe.map((e) => e.message)).toEqual(["Zadána úhrada (částečná) 10. 10.", "Zadána úhrada (částečná) 20. 10."]);
    expect(JSON.stringify(await events(jobId))).not.toMatch(/30000|70000|100000/);

    // smazání vyrovnávající úhrady → zpět Vyfakturováno (jen z přepočtu úhrad)
    const { data: pays } = await svc.from("job_payments").select("id, amount").eq("job_id", jobId).order("paid_on");
    expect(await a.deleteJobPayment((pays as { id: string }[])[1].id)).toMatchObject({ ok: true, stage: "fakturovano", paymentState: "castecne_zaplaceno" });

    // stará akce „Zaplaceno“ s nižší částkou vyrovnává vždy (sleva, skonto)
    const paid = await p.markJobPaid(jobId, { date: "2026-10-22", amount: 90_000 });
    expect(paid).toMatchObject({ ok: true, stage: "dokonceno" });
    expect(await job(jobId)).toMatchObject({ paid_at: "2026-10-22", paid_amount: 90000 });
    // A2 (ochrana záloh, migrace 20261029170000): ruční úhrada 30 000 zůstala, zrcadlo zapsalo jen doplatek do 90 000
    // (dřív zápis orders.paid_* smazal všechny úhrady a vložil jednu 90 000)
    const { data: mirrored } = await svc.from("job_payments").select("amount, settles, via").eq("job_id", jobId).order("paid_on");
    expect(mirrored).toEqual([
      { amount: 30000, settles: false, via: expect.not.stringMatching(/^automaticky$/) },
      { amount: 60000, settles: true, via: "automaticky" },
    ]);
    expect(await p.unmarkJobPaid(jobId)).toMatchObject({ ok: true, stage: "fakturovano" });
    // zrušení úhrady smaže jen automatický doplatek; ruční záloha zůstane (oprava = „Odebrat“ u úhrady)
    const left = ((await svc.from("job_payments").select("id, amount, settles").eq("job_id", jobId)).data ?? []) as { id: string; amount: number; settles: boolean }[];
    expect(left.map((x) => [x.amount, x.settles])).toEqual([[30000, false]]);
    expect(await job(jobId)).toMatchObject({ paid_at: null, paid_so_far: 30000 });
    expect(await a.deleteJobPayment(left[0].id)).toMatchObject({ ok: true });

    // korekce → Dokončeno při 30 % a další dílčí platba zakázku nevrátí (M6b)
    await a.recordJobPayment(jobId, { date: "2026-10-10", amount: 30_000 });
    expect(await a.moveJobStage(jobId, "dokonceno")).toMatchObject({ ok: true, stage: "dokonceno" });
    expect(await job(jobId)).toMatchObject({ paid_amount: null, paid_so_far: 30000 });
    expect((await job(jobId)).paid_at).not.toBeNull();
    expect(await a.recordJobPayment(jobId, { date: "2026-10-23", amount: 5_000 })).toMatchObject({ ok: true, stage: "dokonceno", paymentState: "zaplaceno" });

    // úhrady = finance: bez práva na marže (zaměstnanec) nic nezapíše ani nesmaže (review UX 17)
    as("worker");
    const j2 = await newJob({ status: "fakturovano", order_date: "2026-09-01", customer_order_number: "PO-PAY-2", value: 1000, invoice_number: `FV2-${PREFIX}` });
    expect((await a.recordJobPayment(j2, { amount: 5 })).error).toBe("K této akci nemáš oprávnění.");
    expect(await job(j2)).toMatchObject({ status: "fakturovano", paid_at: null, paid_so_far: 0 });
    expect((await a.deleteJobPayment((pays as { id: string }[])[0].id)).error).toBe("K této akci nemáš oprávnění.");
  });

  // ── Souběh ────────────────────────────────────────────────
  it("optimistický zámek: souběžná změna → chyba se jménem prvního", async () => {
    const jobId = await newJob({ source: "email" });
    as("sales");
    const { localAdmin } = await import("@/test/local-supabase");
    const { userActor } = await import("@/lib/supabase/actor-headers");
    who.race = async () => {
      await localAdmin(userActor({ id: id("admin") })).from("orders").update({ inquiry_status: "ceka_na_podklady", waiting_note: "souběh" }).eq("id", jobId);
    };
    const r = await a.setInquiryStatus(jobId, "v_reseni");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(new RegExp(`^Stav mezitím změnil ${who.users.admin.fullName} \\((právě teď|před \\d+ min)\\) — obnov stránku\\.$`));
    expect((await job(jobId)).inquiry_status).toBe("ceka_na_podklady");
  });
});
