import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Stránky toku a doklady proti lokálnímu Supabase (Balík 2): náš doklad (origin/issuer/revize),
 * historie jen přibývá, potvrzení podle odeslané revize, schválení před odesláním nabídky,
 * faktura při částečném dodání, prodloužení platnosti a data stránek (stav + autor + další krok).
 * Mockuje se jen přihlášení a revalidace; klient nese hlavičky autora jako produkční server.ts.
 * Vlastní zakázky Z-E2E-FLOW-DOC-*, čítače dokladů se nevracejí.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/app/actions/flow-docs.integration.test.ts
 */

const ENABLED = process.env.LOCAL_SUPABASE === "1";
const PREFIX = `Z-E2E-FLOW-DOC-${Date.now().toString(36)}`;
const MAIL_TO = `e2e-flow-doc-${Date.now()}@local.test`;
const CUSTOMER = "d2000000-0000-0000-0000-000000000001"; // Strojmetal a.s.

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

type Row = Record<string, unknown>;

describe.skipIf(!ENABLED)("stránky toku a doklady ↔ lokální Supabase", () => {
  let svc: SupabaseClient;
  let docs: typeof import("@/app/actions/job-documents");
  let files: typeof import("@/app/actions/job-files");
  let flow: typeof import("@/app/actions/flow-status");
  let pages: typeof import("@/app/actions/flow-pages");
  let data: typeof import("@/lib/data/flow-pages");
  const jobs: string[] = [];
  let n = 0;
  const startedAt = new Date(Date.now() - 1000).toISOString();
  const mailApi = () => process.env.LOCAL_MAIL_API ?? "http://127.0.0.1:54324";

  const as = (u: "sales" | "worker" | "admin") => { who.current = u; };
  const id = (u: "sales" | "worker" | "admin") => who.users[u].id;

  async function client() {
    const { localAdmin } = await import("@/test/local-supabase");
    const { userActor } = await import("@/lib/supabase/actor-headers");
    return localAdmin(userActor({ id: id("sales") }));
  }
  async function newJob(patch: Row = {}, items: Row[] = [{ name: "Hřídel", drawing_number: "FD-1", quantity: 4, unit_price: 1000 }]): Promise<string> {
    n += 1;
    const db = await client();
    const { data: row, error } = await db.from("orders").insert({
      number: `${PREFIX}-${n}`, title: `Doklady ${n}`, source: "manual", status: "objednavka", inquiry_date: "2026-10-20",
      owner_id: id("sales"), customer_id: CUSTOMER, customer_contact_email: MAIL_TO, customer_order_number: `PO-${PREFIX}-${n}`, ...patch,
    }).select("id").single();
    if (error) throw new Error(error.message);
    const jobId = (row as { id: string }).id;
    jobs.push(jobId);
    if (items.length) {
      const { error: iErr } = await db.from("order_items").insert(items.map((it, i) => ({ order_id: jobId, position: i, unit: "ks", ...it })));
      if (iErr) throw new Error(iErr.message);
    }
    return jobId;
  }
  async function job(jobId: string): Promise<Row> {
    return (await svc.from("orders").select("*").eq("id", jobId).single()).data as Row;
  }
  async function view(jobId: string): Promise<Row> {
    return (await svc.from("job_flow_v").select("*").eq("id", jobId).single()).data as Row;
  }
  async function events(jobId: string, type?: string) {
    let q = svc.from("job_events").select("id, type, message, data, actor_id, actor_kind, via, created_at").eq("job_id", jobId);
    if (type) q = q.eq("type", type);
    return ((await q.order("created_at")).data ?? []) as { id: string; type: string; message: string; data: Row; actor_id: string | null; actor_kind: string; via: string | null }[];
  }
  async function draftAndSend(jobId: string, fileId: string) {
    const draft = await docs.draftJobDocumentEmail(jobId, fileId);
    expect(draft.ok, draft.error).toBe(true);
    return docs.sendJobDocument(jobId, fileId, { to: MAIL_TO, subject: draft.subject!, body: draft.body! });
  }

  beforeAll(async () => {
    const local = await import("@/test/local-supabase");
    const env = local.loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    if (env.LOCAL_MAIL_API) process.env.LOCAL_MAIL_API = env.LOCAL_MAIL_API;
    svc = local.localAdmin();
    const { data: ps } = await svc.from("profiles").select("id, email, full_name, role").in("email", [local.DEMO.sales.email, local.DEMO.worker.email, local.DEMO.admin.email]);
    for (const r of (ps ?? []) as { id: string; email: string; full_name: string; role: "super_admin" | "obchodnik" | "zamestnanec" }[]) {
      const key = r.role === "super_admin" ? "admin" : r.role === "obchodnik" ? "sales" : "worker";
      who.users[key] = { id: r.id, email: r.email, fullName: r.full_name, role: r.role };
    }
    expect(Object.keys(who.users).sort()).toEqual(["admin", "sales", "worker"]);
    docs = await import("@/app/actions/job-documents");
    files = await import("@/app/actions/job-files");
    flow = await import("@/app/actions/flow-status");
    pages = await import("@/app/actions/flow-pages");
    data = await import("@/lib/data/flow-pages");
  }, 60_000);

  afterAll(async () => {
    if (!svc || !jobs.length) return;
    const { data: fs } = await svc.from("job_files").select("storage_path").in("job_id", jobs);
    const paths = ((fs ?? []) as { storage_path: string | null }[]).map((f) => f.storage_path).filter((p): p is string => Boolean(p));
    if (paths.length) await svc.storage.from("job-files").remove(paths);
    await svc.from("documents").delete().in("order_id", jobs);
    await svc.from("invoices").delete().in("order_id", jobs);
    await svc.from("emails").delete().in("order_id", jobs);
    await svc.from("commission_entries").delete().in("order_id", jobs);
    await svc.from("job_files").update({ replaced_by: null }).in("job_id", jobs);
    await svc.from("job_files").delete().in("job_id", jobs);
    await svc.from("quotes").delete().in("job_id", jobs);
    await svc.from("orders").delete().in("id", jobs);
    await svc.from("audit_log").delete().gte("created_at", startedAt).in("entity_id", jobs);
    await svc.from("audit_log").delete().gte("created_at", startedAt).in("diff->>jobId", jobs);
    await fetch(`${mailApi()}/messages?to=${encodeURIComponent(MAIL_TO)}`, { method: "DELETE" }).catch(() => undefined);
  }, 90_000);

  it("potvrzení = náš doklad k revizi objednávky; jedna událost „Vystaveno…“ s autorem; prohlížeč „generated“ nepodvrhne", async () => {
    const jobId = await newJob();
    as("sales");
    const before = await events(jobId);
    const gen = await docs.generateJobDocument(jobId, "potvrzeni");
    expect(gen.ok, gen.error).toBe(true);
    const f = (await svc.from("job_files").select("*").eq("id", gen.fileId!).single()).data as Row;
    expect(f).toMatchObject({ kind: "potvrzeni", origin: "generated", issuer: "my", order_revision: 1, uploaded_by: id("sales") });
    expect(await job(jobId)).toMatchObject({ confirmation_issued_revision: 1, confirmation_issued_by: id("sales"), order_status: "dorucena" });
    expect((await view(jobId)).confirmation_key).toBe("vystaveno");
    const after = await events(jobId);
    // historie jen přibývá: staré události beze změny, přibyla právě jedna (bez „Nahrán dokument“)
    expect(after.slice(0, before.length).map((e) => e.message)).toEqual(before.map((e) => e.message));
    const added = after.slice(before.length);
    expect(added.map((e) => e.message)).toEqual([`Vystaveno potvrzení objednávky ${gen.number} (PDF)`]);
    expect(added[0]).toMatchObject({ type: "file", actor_id: id("sales"), actor_kind: "user", via: "rucne" });
    expect(added[0].data).toMatchObject({ fileId: gen.fileId, action: "issued", orderRevision: 1 });

    const fake = await files.registerJobFile({
      jobId, path: `${jobId}/x/podvrh.pdf`, filename: "podvrh.pdf", kind: "potvrzeni", origin: "generated" as never,
    });
    expect(fake.error).toBe("Neplatný původ dokumentu.");
  }, 60_000);

  it("odeslání potvrzení e-mailem potvrdí objednávku v DB (✉ rev 1), zakázka Potvrzeno, jedna změna stavu s autorem", async () => {
    const jobId = await newJob();
    as("sales");
    const gen = await docs.generateJobDocument(jobId, "potvrzeni");
    expect(gen.ok, gen.error).toBe(true);
    const sent = await draftAndSend(jobId, gen.fileId!);
    expect(sent.ok, sent.error).toBe(true);
    expect(await job(jobId)).toMatchObject({
      status: "potvrzeno", order_status: "potvrzena", confirmation_sent_revision: 1, confirmation_sent_via: "email",
      confirmation_sent_by: id("sales"), confirmed_by: id("sales"), order_confirmed_revision: 1,
    });
    expect((await view(jobId)).confirmation_key).toBe("odeslano");
    const stage = await events(jobId, "stage");
    expect(stage).toHaveLength(1);
    expect(stage[0]).toMatchObject({ actor_id: id("sales") });
    expect(stage[0].message).toContain("Objednávka → Potvrzená objednávka");
  }, 60_000);

  it("změna objednávky (rev 2): nové potvrzení „k rev 2“, potvrzená změna bez dokladu → po odeslání ✉ rev 2; data stránky ukáže rozdíl a autora", async () => {
    const jobId = await newJob();
    as("sales");
    const first = await docs.generateJobDocument(jobId, "potvrzeni");
    expect((await draftAndSend(jobId, first.fileId!)).ok).toBe(true);
    const ch = await flow.registerOrderChange(jobId, {
      note: "množství 4 → 6 ks", changes: [{ field: "quantity", label: "Množství FD-1", from: 4, to: 6 }],
    });
    expect(ch).toMatchObject({ ok: true, orderStatus: "aktualizovana", revision: 2 });
    const rev = (await data.getLatestOrderRevisions([jobId]))[jobId];
    expect(rev).toMatchObject({ revision: 2, decision: "ceka", changes: [{ label: "Množství FD-1", from: "4", to: "6" }] });
    expect(rev.created.by?.id).toBe(id("sales"));

    const second = await docs.generateJobDocument(jobId, "potvrzeni");
    expect(second.ok, second.error).toBe(true);
    expect(((await svc.from("job_files").select("order_revision").eq("id", second.fileId!).single()).data as Row).order_revision).toBe(2);
    expect((await events(jobId, "file")).at(-1)?.message).toBe(`Vystaveno potvrzení objednávky ${second.number} k rev 2 (PDF) — verze 2`);

    expect(await flow.decideOrderChange(jobId, true)).toMatchObject({ ok: true, orderStatus: "potvrzena" });
    expect((await view(jobId)).confirmation_key).toBe("bez_dokladu");
    const states = await data.getFlowJobStates([jobId]);
    expect(states[jobId].next?.key).toBe("order.sendConfirmation");
    expect((await draftAndSend(jobId, second.fileId!)).ok).toBe(true);
    expect(await job(jobId)).toMatchObject({ confirmation_sent_revision: 2, order_confirmed_revision: 2 });
    expect((await view(jobId)).confirmation_key).toBe("odeslano");
  }, 90_000);

  it("AI nabídka čeká na schválení: e-mail neodejde; po schválení odejde (e-mailem, kdo), zakázka Nabídka odeslaná", async () => {
    const jobId = await newJob({ status: "naceneni", customer_order_number: null });
    const db = await client();
    const { data: q } = await db.from("quotes").insert({
      number: `${PREFIX}-Q${++n}`, job_id: jobId, status: "ke_schvaleni", total: 4000, revision: 1, valid_until: "2099-01-01",
      owner_id: id("sales"), created_by: id("sales"), customer_id: CUSTOMER, ai_generated: true,
    }).select("id").single();
    const quoteId = (q as { id: string }).id;
    await db.from("quote_items").insert({ quote_id: quoteId, position: 0, name: "Hřídel", drawing_number: "FD-1", quantity: 4, unit_price: 1000 });
    as("sales");
    const pdf = await docs.generateJobDocument(jobId, "nabidka", { quoteId });
    expect(pdf.ok, pdf.error).toBe(true);
    const blocked = await draftAndSend(jobId, pdf.fileId!);
    expect(blocked.error).toBe("Nabídka čeká na schválení — odeslat ji lze až po schválení.");
    expect((await svc.from("emails").select("id").eq("order_id", jobId)).data).toHaveLength(0);

    expect(await flow.setQuoteState(quoteId, "schvalena")).toMatchObject({ ok: true, quoteState: "schvalena" });
    const sent = await draftAndSend(jobId, pdf.fileId!);
    expect(sent.ok, sent.error).toBe(true);
    expect((await svc.from("quotes").select("*").eq("id", quoteId).single()).data).toMatchObject({
      status: "odeslano", state: "odeslana", sent_via: "email", sent_by: id("sales"), approved_by: id("sales"),
    });
    expect((await job(jobId)).status).toBe("nabidka");
    const info = (await data.getFlowQuoteInfo([quoteId]))[quoteId];
    expect(info).toMatchObject({ display: "odeslana", next: { key: "quote.accept" } });
    expect(info.stamps.sent).toMatchObject({ via: "email", by: { id: id("sales") } });
    expect(info.stamps.approved?.by?.id).toBe(id("sales"));
  }, 60_000);

  it("faktura při částečném dodání stav neposouvá; po dodání všeho ano (stejné číslo faktury)", async () => {
    const jobId = await newJob({ status: "ve_vyrobe" }, [
      { name: "Hřídel", drawing_number: "FD-1", quantity: 4, unit_price: 1000 },
      { name: "Pouzdro", drawing_number: "FD-2", quantity: 2, unit_price: 500 },
    ]);
    const { data: items } = await svc.from("order_items").select("id, drawing_number").eq("order_id", jobId).order("position");
    const [a, b] = items as { id: string }[];
    as("sales");
    expect((await flow.setDeliveredQuantities(jobId, [{ itemId: a.id, delivered: 4 }])).ok).toBe(true);
    const inv = await docs.generateJobDocument(jobId, "faktura");
    expect(inv.ok, inv.error).toBe(true);
    expect(await job(jobId)).toMatchObject({ status: "ve_vyrobe", invoice_number: inv.number });
    expect((await events(jobId, "file")).at(-1)?.message).toBe(`Vystavena faktura ${inv.number} (PDF) · dílčí dodávka, stav zakázky zůstává`);

    expect((await flow.setDeliveredQuantities(jobId, [{ itemId: b.id, delivered: 2 }])).stage).toBe("dodano_zakaznikovi");
    const again = await docs.generateJobDocument(jobId, "faktura");
    expect(again.number).toBe(inv.number);
    expect(await job(jobId)).toMatchObject({ status: "fakturovano", invoiced_by: id("sales") });
    const last = (await events(jobId, "stage")).at(-1)!;
    expect(last).toMatchObject({ actor_id: id("sales") });
    expect(last.message).toContain("Vyfakturováno");
  }, 90_000);

  it("prodloužit platnost: vypršelá → odeslaná, událost s autorem; neodeslanou ani do minulosti nejde", async () => {
    const jobId = await newJob({ status: "nabidka", customer_order_number: null });
    const db = await client();
    const { data: q } = await db.from("quotes").insert({
      number: `${PREFIX}-Q${++n}`, job_id: jobId, status: "odeslano", sent_at: "2026-09-01T08:00:00Z", total: 1000, revision: 1,
      valid_until: "2026-09-30", owner_id: id("sales"), created_by: id("sales"),
    }).select("id").single();
    const quoteId = (q as { id: string }).id;
    expect((await data.getFlowQuoteInfo([quoteId]))[quoteId]).toMatchObject({ display: "vyprsela", next: { key: "quote.extend" } });
    as("sales");
    expect((await pages.extendQuoteValidity(quoteId, "2020-01-01")).error).toBe("Nová platnost musí být dnes nebo později.");
    expect(await pages.extendQuoteValidity(quoteId, "2099-12-31")).toMatchObject({ ok: true, validUntil: "2099-12-31" });
    expect((await data.getFlowQuoteInfo([quoteId]))[quoteId]).toMatchObject({ display: "odeslana", next: { key: "quote.accept" } });
    const ev = (await events(jobId, "quote")).at(-1)!;
    expect(ev).toMatchObject({ actor_id: id("sales"), message: `Nabídka ${`${PREFIX}-Q${n}`}: platnost prodloužena do 31. 12. 2099` });
    const { data: d } = await db.from("quotes").insert({
      number: `${PREFIX}-Q${++n}`, job_id: jobId, status: "ke_schvaleni", total: 1000, revision: 2, valid_until: "2099-01-01", owner_id: id("sales"),
    }).select("id").single();
    expect((await pages.extendQuoteValidity((d as { id: string }).id, "2099-12-31")).error).toContain("jen odeslanou nabídku");
  }, 60_000);

  it("data stránek: stav = job_flow_v, autor dílčího stavu, další krok podle práva; filtr podle stavu", async () => {
    const jobId = await newJob({ status: "poptavka", source: "email", customer_order_number: null }, []);
    as("sales");
    expect((await flow.takeInquiry(jobId)).ok).toBe(true);
    const st = (await data.getFlowJobStates([jobId]))[jobId];
    const v = await view(jobId);
    expect(st.snapshot.inquiry).toBe(v.inquiry_key);
    expect(st.snapshot.pricing).toBe(v.pricing_key);
    expect(st.stamps.inquiry).toMatchObject({ by: { id: id("sales"), name: who.users.sales.fullName }, via: "rucne", kind: "user" });
    expect(st.next?.key).toBe("pricing.open");
    expect(st.menu).toEqual(expect.arrayContaining(["inquiry.wait", "inquiry.decline", "inquiry.withdraw"]));
    as("worker");
    const w = (await data.getFlowJobStates([jobId]))[jobId];
    expect(w.menu).toContain("inquiry.propose");
    expect(w.menu).not.toContain("inquiry.decline");
    expect((await data.listFlowStateJobIds([{ phase: "inquiry", keys: ["v_reseni"] }]))?.has(jobId)).toBe(true);
    expect((await data.listFlowStateJobIds([{ phase: "inquiry", keys: ["prijata"] }]))?.has(jobId)).toBe(false);
    // zaměstnanec navrhne odmítnutí, obchodník přijme → odmítnutá, autor = obchodník, návrh v historii
    expect((await flow.proposeFlowChange(jobId, { phase: "inquiry", to: "odmitnuta", reason: "kapacita" })).ok).toBe(true);
    as("sales");
    expect((await data.getFlowJobStates([jobId]))[jobId]).toMatchObject({ canDecideProposal: true, next: { key: "proposal.decide" } });
    expect(await flow.decideFlowProposal(jobId, true)).toMatchObject({ ok: true, inquiryStatus: "odmitnuta", stage: "nerealizovano" });
    const lost = (await data.getFlowJobStates([jobId]))[jobId];
    expect(lost.stamps.lost?.by?.id).toBe(id("sales"));
    expect((await data.listFlowStateJobIds([{ phase: "inquiry", keys: ["odmitnuta"] }]))?.has(jobId)).toBe(true);
  }, 60_000);
});
