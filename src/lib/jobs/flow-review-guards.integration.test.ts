import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_ENABLED, DEMO, localAdmin, localAnon, localSession, localSql, profileId } from "@/test/local-supabase";
import { userActor } from "@/lib/supabase/actor-headers";

/**
 * Pojistky z review podrobných stavů proti skutečnému PostgREST lokálního Supabase:
 * konec toku (odmítnutí, storno, nerealizováno, zamítnutí / schválení / odeslání nabídky) rozhodne
 * jen obchodník nebo admin (REST i náš server); neschválenou nabídku nejde přijmout; vložená
 * událost „e-mail" bez skutečného e-mailu nic nepotvrdí; uložené jméno autora přes REST nepodvrhneš;
 * čítače dokladů nejsou dostupné publishable klíčem; GDPR audit smazání zákazníka bez osobních údajů.
 * Vlastní data Z-E2E-REVIEW-* / NAB-E2E-REVIEW-*, vše po sobě smaže; čítače dokladů nemění.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/jobs/flow-review-guards.integration.test.ts
 */

const TAG = Date.now().toString(36);
const PREFIX = `Z-E2E-REVIEW-${TAG}`;

describe.skipIf(!LOCAL_ENABLED)("review: práva rozhodnutí a pojistky v DB", () => {
  let svc: SupabaseClient;
  let worker: SupabaseClient;
  let sales: SupabaseClient;
  let workerId = "";
  let salesId = "";
  const jobs: string[] = [];
  const customers: string[] = [];
  let n = 0;

  async function newJob(patch: Record<string, unknown> = {}): Promise<string> {
    n += 1;
    const { data, error } = await svc.from("orders").insert({
      number: `${PREFIX}-${n}`, title: "E2E review", source: "manual", status: "poptavka", inquiry_date: "2026-10-20", ...patch,
    }).select("id").single();
    if (error) throw new Error(error.message);
    const id = (data as { id: string }).id;
    jobs.push(id);
    return id;
  }

  async function newQuote(jobId: string, patch: Record<string, unknown> = {}): Promise<string> {
    n += 1;
    const { data, error } = await svc.from("quotes").insert({
      number: `NAB-E2E-REVIEW-${TAG}-${n}`, job_id: jobId, status: "ke_schvaleni", total: 1000, revision: 1, ...patch,
    }).select("id").single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  }

  async function job(id: string): Promise<Record<string, unknown>> {
    const { data } = await svc.from("orders").select("*").eq("id", id).single();
    return data as Record<string, unknown>;
  }

  beforeAll(async () => {
    svc = localAdmin();
    [workerId, salesId] = await Promise.all([profileId(svc, DEMO.worker.email), profileId(svc, DEMO.sales.email)]);
    worker = await localSession(DEMO.worker.email, DEMO.worker.password);
    sales = await localSession(DEMO.sales.email, DEMO.sales.password);
  }, 60_000);

  afterAll(async () => {
    if (!svc) return;
    if (jobs.length) {
      await svc.from("job_events").delete().in("job_id", jobs);
      await svc.from("quotes").delete().in("job_id", jobs);
      await svc.from("orders").delete().in("id", jobs);
      await svc.from("audit_log").delete().in("entity_id", jobs);
      await svc.from("audit_log").delete().in("diff->>jobId", jobs);
    }
    if (customers.length) await svc.from("audit_log").delete().in("entity_id", customers);
  }, 60_000);

  it("zaměstnanec (REST i náš server) neodmítne poptávku, nestornuje ani neuzavře zakázku — obchodník ano", async () => {
    const id = await newJob();
    const rest = await worker.from("orders").update({ status: "nerealizovano", lost_reason: "kapacita" }).eq("id", id).select("id");
    expect(rest.error?.code).toBe("42501");
    const app = await localAdmin(userActor({ id: workerId })).from("orders").update({ inquiry_status: "odmitnuta", lost_reason: "kapacita" }).eq("id", id).select("id");
    expect(app.error?.code).toBe("42501");
    expect((await job(id)).status).toBe("poptavka");
    // běžná práce zaměstnance projde (převzetí poptávky)
    const take = await worker.from("orders").update({ inquiry_status: "v_reseni" }).eq("id", id).select("id");
    expect(take.error).toBeNull();
    // obchodník rozhodne
    const ok = await sales.from("orders").update({ inquiry_status: "odmitnuta", lost_reason: "kapacita" }).eq("id", id).select("id");
    expect(ok.error).toBeNull();
    expect(await job(id)).toMatchObject({ status: "nerealizovano", inquiry_status: "odmitnuta", lost_by: salesId });

    const ord = await newJob({ status: "objednavka", order_date: "2026-10-20", customer_order_number: `PO-${TAG}` });
    const storno = await worker.from("orders").update({ order_status: "stornovana", lost_reason: "zakaznik_stahl" }).eq("id", ord).select("id");
    expect(storno.error?.code).toBe("42501");
    expect((await job(ord)).order_status).toBe("dorucena");
  });

  it("nabídku zaměstnanec neschválí, neodešle ani nezamítne (ani RPC flow_reject_quote)", async () => {
    const id = await newJob({ status: "nabidka" });
    const q = await newQuote(id);
    expect((await worker.from("quotes").update({ approved_by: workerId }).eq("id", q).select("id")).error?.code).toBe("42501");
    expect((await worker.from("quotes").update({ status: "odeslano" }).eq("id", q).select("id")).error?.code).toBe("42501");
    await svc.from("quotes").update({ status: "odeslano" }).eq("id", q);
    const rpc = await worker.rpc("flow_reject_quote", { p_quote: q, p_reason: "cena", p_note: null, p_competitor_price: 12345, p_close_job: true });
    expect(rpc.error?.code).toBe("42501");
    const { data: after } = await svc.from("quotes").select("status, competitor_price").eq("id", q).single();
    expect(after).toMatchObject({ status: "odeslano", competitor_price: null });
    expect((await job(id)).status).toBe("nabidka");
  });

  it("fakt z dokladu (vyfocená odeslaná nabídka) zapíše i zaměstnanec — to není rozhodnutí", async () => {
    const id = await newJob({ status: "naceneni" });
    const q = await newQuote(id, { approved_by: salesId });
    const photo = localAdmin(userActor({ id: workerId }, "foto"));
    const up = await photo.from("quotes").update({ status: "odeslano", sent_via: "foto" }).eq("id", q).select("id");
    expect(up.error).toBeNull();
    const { data } = await svc.from("quotes").select("status, sent_via, sent_by").eq("id", q).single();
    expect(data).toMatchObject({ status: "odeslano", sent_via: "foto", sent_by: workerId });
  });

  it("archivovanou verzi nabídky nejde zamítnout (nezavře zakázku ani aktivní verzi)", async () => {
    const id = await newJob({ status: "nabidka" });
    const old = await newQuote(id, { status: "odeslano", archived: true });
    const cur = await newQuote(id, { status: "odeslano", revision: 2 });
    const rpc = await sales.rpc("flow_reject_quote", { p_quote: old, p_reason: "cena", p_note: null, p_competitor_price: null, p_close_job: true });
    expect(rpc.error?.message).toMatch(/Archivovanou/);
    const { data: c } = await svc.from("quotes").select("status").eq("id", cur).single();
    expect((c as { status: string }).status).toBe("odeslano");
    expect((await job(id)).status).toBe("nabidka");
  });

  it("neschválenou nabídku (AI / limit) nejde přijmout ani rovnou vložit jako přijatou", async () => {
    const id = await newJob({ status: "naceneni" });
    const q = await newQuote(id, { ai_generated: true });
    const app = localAdmin(userActor({ id: salesId }));
    const up = await app.from("quotes").update({ status: "prijato" }).eq("id", q).select("id");
    expect(up.error?.message).toMatch(/čeká na schválení/);
    const ins = await app.from("quotes").insert({ number: `NAB-E2E-REVIEW-${TAG}-ins`, job_id: id, status: "prijato", total: 5, ai_generated: true }).select("id");
    expect(ins.error?.message).toMatch(/čeká na schválení/);
    expect((await job(id)).status).toBe("naceneni");
  });

  it("vložená událost „e-mail potvrzení“ přes REST bez odeslaného e-mailu nic nepotvrdí; jméno autora z profilu", async () => {
    const id = await newJob({ status: "objednavka", order_date: "2026-10-20", customer_order_number: `PO-E-${TAG}` });
    const ins = await worker.from("job_events").insert({
      job_id: id, type: "email", message: "Potvrzení odesláno", actor_name: "Admin Lokální", entity: "quote",
      data: { kind: "potvrzeni" },
    }).select("id");
    expect(ins.error).toBeNull();
    const j = await job(id);
    expect(j).toMatchObject({ order_status: "dorucena", status: "objednavka" });
    expect(j.confirmation_sent_via).toBeNull();
    const { data: ev } = await svc.from("job_events").select("actor_id, actor_name, entity, via").eq("job_id", id).eq("type", "email").single();
    expect(ev).toMatchObject({ actor_id: workerId, entity: "job", via: "rest" });
    expect((ev as { actor_name: string }).actor_name).not.toBe("Admin Lokální");
  });

  it("úhrada přes REST: uložené jméno a způsob zápisu zůstanou", async () => {
    const id = await newJob({ status: "fakturovano", order_date: "2026-10-01", customer_order_number: `PO-P-${TAG}`, invoice_number: `FV-E2E-${TAG}`, value: 1000 });
    const { data: pay, error } = await localAdmin(userActor({ id: salesId })).from("job_payments")
      .insert({ job_id: id, amount: 100, paid_on: "2026-10-22" }).select("id, recorded_name, via").single();
    expect(error).toBeNull();
    const p = pay as { id: string; recorded_name: string; via: string };
    const up = await sales.from("job_payments").update({ recorded_name: "Admin Lokální", via: "ai", note: "oprava" }).eq("id", p.id).select("recorded_name, via");
    expect(up.error).toBeNull();
    expect((up.data as { recorded_name: string; via: string }[])[0]).toMatchObject({ recorded_name: p.recorded_name, via: p.via });
  });

  it("čítače dokladů: publishable klíčem ani přihlášením nic; next_doc_number dál funguje přes DB", async () => {
    const anon = await localAnon().from("doc_counters").select("doc_type");
    expect(anon.error?.code).toBe("42501");
    const upd = await sales.from("doc_counters").update({ counter: 1 }).eq("doc_type", "NAB").select("doc_type");
    expect(upd.error?.code).toBe("42501");
    expect(localSql("select relrowsecurity from pg_class where relname = 'doc_counters'")).toBe("t");
  });

  it("GDPR: smazání zákazníka zapíše do auditu jen id, název a IČO", async () => {
    const { data, error } = await svc.from("customers").insert({
      name: `E2E Review ${TAG} s.r.o.`, ico: "99887766", email: "jan.novak@example.cz", phone: "+420 777 000 111", contact_person: "Jan Novák",
    }).select("id").single();
    expect(error).toBeNull();
    const cid = (data as { id: string }).id;
    customers.push(cid);
    await svc.from("customers").delete().eq("id", cid);
    const { data: a } = await svc.from("audit_log").select("diff").eq("action", "customers_deleted").eq("entity_id", cid).single();
    const row = (a as { diff: { row: Record<string, unknown> } }).diff.row;
    expect(row).toMatchObject({ id: cid, name: `E2E Review ${TAG} s.r.o.`, ico: "99887766" });
    expect(Object.keys(row).sort()).toEqual(["ico", "id", "name"]);
  });
});
