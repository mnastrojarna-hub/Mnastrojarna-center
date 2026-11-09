import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Pošta → speciální stav zakázky (majitel 9. 11. + „samozřejmě s korekcí") proti lokálnímu Supabase (bez AI —
 * pravidla; výstup AI klasifikace jako emails.ai_job_signal): reklamace dodané zakázky → fronta → potvrzení →
 * Reklamace s důvodem a událostí s e-mailem; odmítnutí nabídky v plné automatice → Nerealizováno (✨ AI) → Vrátit
 * (nabídka zase odeslaná, učení); storno potvrzené objednávky → Zrušeno → Změnit na Pozastaveno; pozastavení →
 * pokračování; dodavatel nic; stejné vlákno podruhé nic (ani po zamítnutí / vrácení); úprava návrhu před potvrzením.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/email/mail-stage.integration.test.ts
 */

const ENABLED = process.env.LOCAL_SUPABASE === "1";
const TAG = `mstage${Date.now().toString(36)}`;
const DOM = `${TAG}.test`;

const who = vi.hoisted(() => ({
  users: {} as Record<string, { id: string; email: string; fullName: string; role: "super_admin" | "obchodnik" | "zamestnanec" }>,
  current: "admin" as "sales" | "worker" | "admin",
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
    createClient: async () => { throw new Error("Bez session (test)."); },
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

describe.skipIf(!ENABLED)("pošta → speciální stav zakázky ↔ lokální Supabase", () => {
  let svc: SupabaseClient;
  let customerId = "";
  let supplierId = "";
  const jobs: string[] = [];
  let n = 0;
  const as = (u: "sales" | "worker" | "admin") => { who.current = u; };

  async function newJob(status: string, patch: Row = {}): Promise<{ id: string; number: string }> {
    n += 1;
    const { localAdmin } = await import("@/test/local-supabase");
    const { userActor } = await import("@/lib/supabase/actor-headers");
    const number = `Z-${TAG}-${n}`;
    const { data, error } = await localAdmin(userActor({ id: who.users.sales.id })).from("orders").insert({
      number, title: `Stav z pošty ${n}`, source: "email", status, inquiry_date: "2026-10-20", owner_id: who.users.sales.id, customer_id: customerId,
      ...(["objednavka", "potvrzeno", "ve_vyrobe", "dodano_zakaznikovi"].includes(status) ? { order_date: "2026-10-25", customer_order_number: `PO-${n}` } : {}),
      ...patch,
    }).select("id").single();
    if (error) throw new Error(error.message);
    jobs.push((data as { id: string }).id);
    return { id: (data as { id: string }).id, number };
  }
  async function job(id: string): Promise<Row> {
    return (await svc.from("orders").select("*").eq("id", id).single()).data as Row;
  }
  async function mail(jobId: string | null, body: string, extra: Row = {}): Promise<{ id: string; thread_id: string }> {
    const { data, error } = await svc.from("emails").insert({
      direction: "in", from_email: `jan@${DOM}`, from_name: "Jan Dvořák", customer_id: customerId, category: "k_zakazce", order_id: jobId,
      subject: "Re: zakázka", body_text: body, received_at: new Date().toISOString(), message_id: `<${Math.random().toString(36).slice(2)}@${DOM}>`, ...extra,
    }).select("id, thread_id").single();
    if (error) throw new Error(error.message);
    return data as { id: string; thread_id: string };
  }
  async function proc(emailId: string, jobId: string) {
    const s = await import("./job-link-store");
    return s.extractAndApply(s.aiMailActor(null), emailId, jobId, { force: true });
  }
  async function mode(m: "full" | "approval") {
    await svc.from("automation_settings").upsert({ module: "mail_job_stage", mode: m, enabled: true });
  }
  async function signals(jobId: string): Promise<Row[]> {
    return ((await svc.from("job_mail_stage_signals").select("*").eq("job_id", jobId).order("created_at")).data ?? []) as Row[];
  }
  async function events(jobId: string): Promise<{ type: string; message: string; data: Row; actor_kind: string | null; agent: string | null }[]> {
    return ((await svc.from("job_events").select("type, message, data, actor_kind, agent, created_at").eq("job_id", jobId).order("created_at")).data ?? []) as never;
  }
  async function corrections(): Promise<Row[]> {
    return ((await svc.from("ai_corrections").select("*").eq("agent_key", "mail_stage").ilike("context", `%${TAG}%`).order("created_at")).data ?? []) as Row[];
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
    const { data: c } = await svc.from("customers").insert({ name: `Strojmetal ${TAG}`, email: `nakup@${DOM}`, owner_id: who.users.sales.id }).select("id").single();
    customerId = (c as { id: string }).id;
    const { data: s } = await svc.from("suppliers").insert({ name: `Kalírna ${TAG}`, email: `info@kalirna-${DOM}` }).select("id").single();
    supplierId = (s as { id: string }).id;
  }, 60_000);

  afterAll(async () => {
    await mode("approval").catch(() => undefined);
    if (!svc) return;
    if (jobs.length) {
      await svc.from("approval_queue").delete().in("order_id", jobs);
      await svc.from("emails").delete().in("order_id", jobs);
      await svc.from("quotes").delete().in("job_id", jobs);
      await svc.from("orders").delete().in("id", jobs);
    }
    await svc.from("emails").delete().ilike("from_email", `%${DOM}`);
    await svc.from("ai_corrections").delete().eq("agent_key", "mail_stage").ilike("context", `%${TAG}%`);
    if (customerId) await svc.from("customers").delete().eq("id", customerId);
    if (supplierId) await svc.from("suppliers").delete().eq("id", supplierId);
  });

  it("reklamace dodané zakázky → fronta ke schválení → potvrzení → Reklamace s důvodem a událostí s e-mailem", async () => {
    await mode("approval");
    const j = await newJob("dodano_zakaznikovi");
    const m = await mail(j.id, "Dobrý den,\nreklamujeme díly z poslední dodávky — nesedí rozměry dle výkresu, průměr 20h7 je mimo toleranci.\n\nS pozdravem Jan");
    await proc(m.id, j.id);
    const [sig] = await signals(j.id);
    expect(sig).toMatchObject({ kind: "reklamace", status: "pending", claim_reason: "rozmery", party: "customer", mode: "approval", thread_key: m.thread_id });
    expect((await job(j.id)).status).toBe("dodano_zakaznikovi"); // jen návrh
    const { data: q } = await svc.from("approval_queue").select("*").eq("id", sig.approval_id as string).single();
    expect(q).toMatchObject({ type: "job_stage", status: "pending", order_id: j.id, email_id: m.id });
    expect(String((q as Row).title)).toBe(`E-mail od Jan Dvořák naznačuje reklamaci zakázky ${j.number} — přepnout do Reklamace?`);

    // fronta: řádek načte návrh, potvrzení s upraveným důvodem (AI se učí)
    as("admin");
    const a = await import("@/app/actions/mail-stage");
    const view = await a.getApprovalStageSignalAction(sig.approval_id as string);
    expect(view).toMatchObject({ kind: "reklamace", status: "pending", jobNumber: j.number, options: expect.arrayContaining(["reklamace"]) });
    const r = await a.confirmStageSignalAction(sig.id as string, { kind: "reklamace", reason: "Průměr 20h7 mimo toleranci (12 ks)", claimReason: "rozmery" });
    expect(r).toMatchObject({ ok: true, stage: "reklamace" });
    const jj = await job(j.id);
    expect(jj).toMatchObject({ status: "reklamace", claim_reason: "rozmery", claim_note: "Průměr 20h7 mimo toleranci (12 ks)", claim_from_stage: "dodano_zakaznikovi" });
    expect(((await svc.from("approval_queue").select("status").eq("id", sig.approval_id as string).single()).data as Row).status).toBe("approved");
    const ev = (await events(j.id)).find((e) => e.data?.action === "mail_stage")!;
    expect(ev).toMatchObject({ type: "email", actor_kind: "user", data: { emailId: m.id, threadId: m.thread_id, signal: "reklamace", fromStage: "dodano_zakaznikovi", toStage: "reklamace", auto: false } });
    expect(ev.data.kind).toBeUndefined(); // „kind" by spustil fakta dokladů (job_events_flow_after)
    const stage = (await events(j.id)).find((e) => e.type === "stage" && e.data?.to === "reklamace");
    expect(String(stage?.data?.note ?? "")).toContain("Průměr 20h7");
    expect((await corrections()).some((c) => String(c.corrected_value).includes("Průměr 20h7"))).toBe(true);

    // druhá zpráva ve stejném vlákně se stejným signálem → nic znovu
    const m2 = await mail(j.id, "Ještě jednou: reklamujeme ty díly, rozměry nesedí.", { thread_id: m.thread_id });
    await proc(m2.id, j.id);
    expect((await signals(j.id)).length).toBe(1);
  }, 60_000);

  it("plná automatika: odmítnutí nabídky → Nerealizováno (✨ AI z pošty) → Vrátit (nabídka zase odeslaná, učení, vlákno se nenavrhne)", async () => {
    await mode("full");
    const j = await newJob("poptavka");
    const { data: qd, error: qe } = await svc.from("quotes").insert({
      number: `NAB-${TAG}-1`, job_id: j.id, status: "odeslano", sent_at: new Date().toISOString(), total: 1000, revision: 1, owner_id: who.users.sales.id,
    }).select("id").single();
    if (qe) throw new Error(qe.message);
    const qid = (qd as { id: string }).id;
    expect((await job(j.id)).status).toBe("nabidka");

    const m = await mail(j.id, "Dobrý den, děkujeme za nabídku, bohužel jsme vybrali jiného dodavatele.");
    // AI klasifikace souhlasí (structured output uložený při stažení)
    await svc.from("emails").update({ ai_job_signal: { kind: "nerealizovano", reason: "Zákazník vybral jiného dodavatele", confidence: 0.9 } }).eq("id", m.id);
    await proc(m.id, j.id);
    const [sig] = await signals(j.id);
    expect(sig).toMatchObject({ kind: "nerealizovano", status: "applied", applied_kind: "ai", source: "ai+rules", lost_reason: "jiny_dodavatel", from_stage: "nabidka", to_stage: "nerealizovano" });
    expect(sig.approval_id).toBeNull();
    expect(await job(j.id)).toMatchObject({ status: "nerealizovano", lost_reason: "jiny_dodavatel", lost_note: "Zákazník vybral jiného dodavatele" });
    expect(((await svc.from("quotes").select("status, lost_reason").eq("id", qid).single()).data as Row)).toMatchObject({ status: "zamitnuto", lost_reason: "jiny_dodavatel" });
    const ev = (await events(j.id)).find((e) => e.data?.action === "mail_stage")!;
    expect(ev).toMatchObject({ actor_kind: "ai", agent: "mail-stage", data: { auto: true, signal: "nerealizovano" } });
    expect(ev.message).toContain("přepnuto automaticky (AI z pošty)");
    const st = (await events(j.id)).find((e) => e.type === "stage" && e.data?.to === "nerealizovano")!;
    expect(st.actor_kind).toBe("ai");

    // Vrátit smí každý se zakázkou (zaměstnanec)
    as("worker");
    const a = await import("@/app/actions/mail-stage");
    const u = await a.undoStageSignalAction(sig.id as string);
    expect(u).toMatchObject({ ok: true, stage: "nabidka" });
    const back = await job(j.id);
    expect(back).toMatchObject({ status: "nabidka", lost_reason: null, lost_note: null });
    expect(((await svc.from("quotes").select("status").eq("id", qid).single()).data as Row).status).toBe("odeslano");
    const korekce = (await events(j.id)).filter((e) => e.type === "stage" && e.data?.to === "nabidka" && String(e.data?.note ?? "").startsWith("Korekce: AI z pošty chybně — vráceno na"));
    expect(korekce.length).toBe(1);
    expect(((await events(j.id)).find((e) => e.data?.action === "mail_stage")!.data as Row).undoneAt).toBeTruthy();
    expect((await signals(j.id))[0]).toMatchObject({ status: "undone" });
    const learned = await corrections();
    expect(learned.some((c) => String(c.ai_value).startsWith("Nerealizováno") && String(c.corrected_value).startsWith("Žádná změna"))).toBe(true);
    expect((await a.undoStageSignalAction(sig.id as string)).ok).toBe(false);

    // stejné vlákno a druh znovu → potlačeno (učení z korekce)
    const m2 = await mail(j.id, "Opravdu jsme vybrali jiného dodavatele.", { thread_id: m.thread_id });
    await proc(m2.id, j.id);
    expect((await signals(j.id)).length).toBe(1);
    expect((await job(j.id)).status).toBe("nabidka");
  }, 60_000);

  it("storno potvrzené objednávky → Zrušeno (auto) → Změnit na Pozastaveno; po ruční změně stavu už Vrátit nejde", async () => {
    await mode("full");
    const j = await newJob("potvrzeno");
    const m = await mail(j.id, "Dobrý den, bohužel stornujeme objednávku PO-3, projekt se nebude realizovat.");
    await proc(m.id, j.id);
    const [sig] = await signals(j.id);
    expect(sig).toMatchObject({ kind: "zruseno", status: "applied", to_stage: "zruseno", lost_reason: "projekt_zrusen" });
    expect(await job(j.id)).toMatchObject({ status: "zruseno", order_status: "stornovana" });

    as("sales");
    const a = await import("@/app/actions/mail-stage");
    const view = await a.getStageSignalAction(sig.id as string);
    expect(view).toMatchObject({ undoable: true, options: ["zruseno", "nerealizovano", "pozastaveno"].filter((k) => k !== "nerealizovano") });
    const ch = await a.changeStageSignalAction(sig.id as string, { kind: "pozastaveno", reason: "Zákazník jen čeká na rozhodnutí projektu" });
    expect(ch).toMatchObject({ ok: true, stage: "pozastaveno" });
    expect(await job(j.id)).toMatchObject({ status: "pozastaveno", hold_reason: "Zákazník jen čeká na rozhodnutí projektu", lost_reason: null, side_from_stage: "potvrzeno" });
    expect(["potvrzena", "dorucena"]).toContain((await job(j.id)).order_status);
    const s2 = (await signals(j.id))[0];
    expect(s2).toMatchObject({ status: "applied", final_kind: "pozastaveno", from_stage: "potvrzeno", to_stage: "pozastaveno", applied_kind: "user" });
    expect((await corrections()).some((c) => String(c.ai_value).startsWith("Zrušeno") && String(c.corrected_value).startsWith("Pozastaveno"))).toBe(true);
    // jen jiný důvod (stejný druh) — bez změny stavu
    expect(await a.changeStageSignalAction(sig.id as string, { kind: "pozastaveno", reason: "Čeká na nový výkres" })).toMatchObject({ ok: true, stage: "pozastaveno" });
    expect((await job(j.id)).hold_reason).toBe("Čeká na nový výkres");

    // někdo stav mezitím ručně změnil → Vrátit nejde
    const { localAdmin } = await import("@/test/local-supabase");
    const { userActor } = await import("@/lib/supabase/actor-headers");
    await localAdmin(userActor({ id: who.users.admin.id })).from("orders").update({ status: "ve_vyrobe" }).eq("id", j.id);
    const no = await a.undoStageSignalAction(sig.id as string);
    expect(no.ok).toBe(false);
    expect(no.error).toMatch(/od té doby změnil/);
    expect((await a.getStageSignalAction(sig.id as string))?.undoable).toBe(false);
  }, 60_000);

  it("pozastavení → pokračování (jiné zprávy, stejná zakázka); dodavatel stav nemění", async () => {
    await mode("full");
    const j = await newJob("ve_vyrobe");
    const m = await mail(j.id, "Pozastavte prosím výrobu, čekáme na novou revizi výkresu.");
    await proc(m.id, j.id);
    expect(await job(j.id)).toMatchObject({ status: "pozastaveno", hold_reason: "Pozastavte prosím výrobu, čekáme na novou revizi výkresu." });
    const m2 = await mail(j.id, "Dobrý den, můžete pokračovat ve výrobě, výkres zůstává.", { thread_id: m.thread_id });
    await proc(m2.id, j.id);
    expect(await job(j.id)).toMatchObject({ status: "ve_vyrobe", hold_reason: null });
    expect((await signals(j.id)).map((s) => [s.kind, s.status])).toEqual([["pozastaveno", "applied"], ["pokracovat", "applied"]]);

    // dodavatel: „pozastavte výrobu, máme zpoždění" → nic
    const s = await mail(j.id, "Musíme pozastavit výrobu, máme zpoždění materiálu. Reklamujeme dodaný polotovar.", { customer_id: null, supplier_id: supplierId, from_email: `info@kalirna-${DOM}`, from_name: "Kalírna" });
    await proc(s.id, j.id);
    expect((await signals(j.id)).length).toBe(2);
    expect((await job(j.id)).status).toBe("ve_vyrobe");
  }, 60_000);

  it("návrh: zamítnutí (žádná změna) se učí a vlákno se znovu nenavrhne; nesedí-li na stav, nic; neznámý odesílatel jen návrh", async () => {
    await mode("full");
    const j = await newJob("ve_vyrobe");
    // neznámý odesílatel (není zákazník zakázky) → i v plné automatice jen návrh
    const m = await mail(j.id, "Prosím pozastavte výrobu této zakázky.", { customer_id: null, from_email: `neznamy@jinde-${DOM}`, from_name: "Neznámý" });
    await proc(m.id, j.id);
    const [sig] = await signals(j.id);
    expect(sig).toMatchObject({ kind: "pozastaveno", status: "pending", party: "other" });
    as("worker");
    const a = await import("@/app/actions/mail-stage");
    expect(await a.confirmStageSignalAction(sig.id as string, { kind: "none" })).toMatchObject({ ok: true });
    expect((await signals(j.id))[0]).toMatchObject({ status: "rejected" });
    expect(((await svc.from("approval_queue").select("status").eq("id", sig.approval_id as string).single()).data as Row).status).toBe("rejected");
    expect((await job(j.id)).status).toBe("ve_vyrobe");
    expect((await corrections()).some((c) => String(c.ai_value).startsWith("Pozastaveno") && String(c.corrected_value).startsWith("Žádná změna"))).toBe(true);
    const m2 = await mail(j.id, "Pozastavte to prosím.", { thread_id: m.thread_id, customer_id: null, from_email: `neznamy@jinde-${DOM}` });
    await proc(m2.id, j.id);
    expect((await signals(j.id)).length).toBe(1);

    // pokračovat na zakázce, která neběží v pauze → nic
    const m3 = await mail(j.id, "Můžete pokračovat ve výrobě.");
    await proc(m3.id, j.id);
    expect((await signals(j.id)).length).toBe(1);

    // úprava návrhu před potvrzením: jiný stav (reklamace místo pozastavení)
    await mode("approval");
    const m4 = await mail(j.id, "Zastavte prosím výrobu, díly z první série mají vadný povrch.");
    await proc(m4.id, j.id);
    const p = (await signals(j.id)).find((s) => s.email_id === m4.id)!;
    expect(p.status).toBe("pending");
    as("sales");
    const r = await a.confirmStageSignalAction(p.id as string, { kind: "reklamace", reason: "Vadný povrch první série", claimReason: "povrch" });
    expect(r).toMatchObject({ ok: true, stage: "reklamace" });
    expect(await job(j.id)).toMatchObject({ status: "reklamace", claim_reason: "povrch", claim_note: "Vadný povrch první série" });
    expect((await signals(j.id)).find((s) => s.id === p.id)).toMatchObject({ kind: p.kind, final_kind: "reklamace", status: "applied" });
  }, 60_000);
});
