import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_ENABLED, DEMO, localAdmin, localAnon, localSession, localSql, profileId } from "@/test/local-supabase";
import { encodeChangeNote, userActor } from "@/lib/supabase/actor-headers";

/**
 * „Kdo to udělal“ proti skutečnému PostgREST lokálního Supabase: hlavičky autora → DB (app_ctx),
 * atribuční sloupce, jediná stavová událost (sloučení se starým zápisem aplikace), ochrana proti
 * podvrhu přes REST, revoke interních funkcí, automatické posuny, kaskáda smazání účtu.
 * Pracuje jen s vlastními zakázkami Z-E2E-FLOW-ATTR-* a vše po sobě smaže.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/jobs/flow-attribution.integration.test.ts
 */

const PREFIX = `Z-E2E-FLOW-ATTR-${Date.now().toString(36)}`;

describe.skipIf(!LOCAL_ENABLED)("atribuce změn ↔ lokální Supabase", () => {
  let svc: SupabaseClient;
  let sales = "";
  let admin = "";
  let worker = "";
  const jobs: string[] = [];
  const tempUsers: string[] = [];
  let n = 0;

  async function newJob(patch: Record<string, unknown> = {}, db: SupabaseClient = svc): Promise<string> {
    n += 1;
    const { data, error } = await db.from("orders").insert({
      number: `${PREFIX}-${n}`, title: "E2E atribuce", source: "manual", status: "poptavka", inquiry_date: "2026-10-20", ...patch,
    }).select("id").single();
    if (error) throw new Error(error.message);
    const id = (data as { id: string }).id;
    jobs.push(id);
    return id;
  }

  async function job(id: string): Promise<Record<string, unknown>> {
    const { data } = await svc.from("orders").select("*").eq("id", id).single();
    return data as Record<string, unknown>;
  }

  async function events(id: string, type?: string) {
    let q = svc.from("job_events").select("*").eq("job_id", id);
    if (type) q = q.eq("type", type);
    const { data } = await q.order("created_at");
    return (data ?? []) as { id: string; type: string; message: string; data: Record<string, unknown>; actor_id: string | null;
      actor_kind: string; actor_name: string | null; via: string | null; entity: string }[];
  }

  beforeAll(async () => {
    svc = localAdmin();
    [sales, admin, worker] = await Promise.all([profileId(svc, DEMO.sales.email), profileId(svc, DEMO.admin.email), profileId(svc, DEMO.worker.email)]);
  }, 60_000);

  afterAll(async () => {
    if (!svc) return;
    if (jobs.length) {
      await svc.from("job_files").delete().in("job_id", jobs);
      await svc.from("quotes").delete().in("job_id", jobs);
      await svc.from("orders").delete().in("id", jobs);
      await svc.from("audit_log").delete().in("entity_id", jobs);
      await svc.from("audit_log").delete().in("diff->>jobId", jobs);
    }
    for (const u of tempUsers) await svc.auth.admin.deleteUser(u).catch(() => undefined);
  }, 60_000);

  it("app_whoami: hlavička u servisní role, bez hlaviček service, session = přihlášený, anon bez práva", async () => {
    const app = (await localAdmin(userActor({ id: sales })).rpc("app_whoami")).data as Record<string, unknown>;
    expect(app).toMatchObject({ ctx: "app", actor: sales, kind: "user", via: "rucne", service: true });
    const plain = (await svc.rpc("app_whoami")).data as Record<string, unknown>;
    expect(plain).toMatchObject({ ctx: "service", actor: null, kind: "system" });
    const s = await localSession(DEMO.sales.email, DEMO.sales.password, { "x-actor-id": admin, "x-actor-kind": "user" });
    const me = (await s.rpc("app_whoami")).data as Record<string, unknown>;
    expect(me).toMatchObject({ ctx: "session", actor: sales, uid: sales, kind: "user", via: "rest", service: false });
    const anon = await localAnon({ "x-actor-id": admin }).rpc("app_whoami");
    expect(anon.error?.code).toBe("42501");
    expect(localSql("select app_whoami()->>'ctx'")).toBe("db");
  });

  it("posun stavu s hlavičkou: autor, způsob, jediná událost (sloučení se zápisem aplikace)", async () => {
    const id = await newJob();
    const db = localAdmin(userActor({ id: sales }));
    const { error } = await db.from("orders").update({ status: "naceneni" }).eq("id", id);
    expect(error).toBeNull();
    const j = await job(id);
    expect(j).toMatchObject({ stage_changed_by: sales, stage_changed_via: "rucne", inquiry_status: "v_reseni", updated_by: sales });
    let st = await events(id, "stage");
    expect(st).toHaveLength(1);
    expect(st[0]).toMatchObject({ actor_id: sales, actor_kind: "user", actor_name: "Petr Obchodník", via: "rucne", entity: "job" });
    expect(st[0].message).toBe("Stav: Poptávka → Nacenění");
    // starší kód zapíše vlastní stage událost → sloučí se s DB událostí
    await db.from("job_events").insert({ job_id: id, type: "stage", message: "Stav: Poptávka → Nacenění — ručně z knihy", data: { from: "poptavka", to: "naceneni", note: "ručně z knihy" }, actor_id: sales });
    st = await events(id, "stage");
    expect(st).toHaveLength(1);
    expect(st[0].message).toBe("Stav: Poptávka → Nacenění — ručně z knihy");
    expect(st[0].data).toMatchObject({ merged: true, origin: "db", note: "ručně z knihy" });
    // dílčí stav poptávky se při změně hlavního stavu nepíše zvlášť (dorovnání)
    expect((await events(id, "status")).filter((e) => e.data.field === "inquiry_status")).toHaveLength(0);
  });

  it("M1: session nepodvrhne autora ani původ události a nesloučí se do cizí", async () => {
    const id = await newJob();
    await localAdmin(userActor({ id: admin })).from("orders").update({ status: "naceneni" }).eq("id", id);
    const before = await events(id, "stage");
    expect(before).toHaveLength(1);
    expect(before[0].actor_id).toBe(admin);
    const s = await localSession(DEMO.sales.email, DEMO.sales.password);
    const { error } = await s.from("job_events").insert({
      job_id: id, type: "stage", message: "Stav: Poptávka → Nacenění (podvrh)", data: { from: "poptavka", to: "naceneni", origin: "db", auto: true },
      actor_id: admin,
    });
    expect(error).toBeNull();
    const after = await events(id, "stage");
    expect(after).toHaveLength(2);
    const mine = after.find((e) => e.id !== before[0].id)!;
    expect(mine).toMatchObject({ actor_id: sales, actor_kind: "user", via: "rest" });
    expect(mine.data.origin).toBeUndefined();
    expect(mine.data.auto).toBeUndefined();
    const theirs = after.find((e) => e.id === before[0].id)!;
    expect(theirs.message).toBe(before[0].message);
    expect(theirs.data.merged).toBeUndefined();
    // session nesmí historii mazat ani měnit
    await s.from("job_events").delete().eq("id", before[0].id);
    await s.from("job_events").update({ message: "přepsáno" }).eq("id", before[0].id);
    const kept = (await events(id, "stage")).find((e) => e.id === before[0].id)!;
    expect(kept.message).toBe(before[0].message);
  });

  it("M2: session nepřepíše atribuční sloupce (orders, quotes)", async () => {
    const id = await newJob({ status: "potvrzeno", order_date: "2026-10-01", customer_order_number: "PO-ATTR" }, localAdmin(userActor({ id: admin })));
    const j0 = await job(id);
    expect(j0).toMatchObject({ order_status: "potvrzena", confirmed_by: admin, stage_changed_by: admin, created_by: admin });
    const s = await localSession(DEMO.sales.email, DEMO.sales.password);
    await s.from("orders").update({ confirmed_by: sales, stage_changed_by: sales, created_by: sales, note: "poznámka ze session" }).eq("id", id);
    const j1 = await job(id);
    expect({ confirmed_by: j1.confirmed_by, stage_changed_by: j1.stage_changed_by, created_by: j1.created_by, note: j1.note, updated_by: j1.updated_by })
      .toEqual({ confirmed_by: admin, stage_changed_by: admin, created_by: admin, note: "poznámka ze session", updated_by: sales });

    const { data: q } = await localAdmin(userActor({ id: admin })).from("quotes")
      .insert({ number: `${PREFIX}-Q`, job_id: id, status: "odeslano", total: 1000, revision: 1 }).select("id, sent_by, state, sent_via").single();
    expect(q).toMatchObject({ sent_by: admin, state: "odeslana" });
    await s.from("quotes").update({ sent_by: sales, created_by: sales }).eq("id", (q as { id: string }).id);
    const { data: q2 } = await svc.from("quotes").select("sent_by, created_by, updated_by").eq("id", (q as { id: string }).id).single();
    expect(q2).toMatchObject({ sent_by: admin, created_by: admin, updated_by: sales });
  });

  it("M3: interní přepočty a náklady přes REST se session nejdou", async () => {
    const s = await localSession(DEMO.sales.email, DEMO.sales.password);
    const id = jobs[0];
    for (const [fn, args] of [
      ["recompute_job_payments", { p_job: id }], ["recompute_job_production", { p_job: id }], ["job_cost", { p_job: id }],
      ["recompute_job_flow", { p_job: id }], ["commission_rule_for", { p_owner: sales, p_at: "2026-10-01" }],
    ] as const) {
      const r = await s.rpc(fn, args);
      expect(r.error?.code, fn).toBe("42501");
    }
    // RPC toku smí aktivní uživatel (bez parametru autora)
    const counts = await s.rpc("flow_counts", {});
    expect(counts.error).toBeNull();
  });

  it("operace → probíhá: zakázka Ve výrobě automaticky, příčina výroba, autor = kdo klikl, objednávka potvrzena bez dokladu", async () => {
    const id = await newJob({ status: "objednavka", order_date: "2026-10-01", customer_order_number: "PO-OP" });
    const db = localAdmin(userActor({ id: worker }));
    const { data: op, error } = await db.from("job_operations").insert({ job_id: id, kind: "frezovani", in_house: true }).select("id").single();
    expect(error).toBeNull();
    await db.from("job_operations").update({ status: "probiha" }).eq("id", (op as { id: string }).id);
    const j = await job(id);
    expect(j).toMatchObject({ status: "ve_vyrobe", stage_changed_by: worker, stage_changed_via: "automaticky", stage_change_cause: "vyroba", order_status: "potvrzena", order_confirmed_revision: 1 });
    const st = await events(id, "stage");
    expect(st.at(-1)?.message).toBe("Stav: Objednávka → Ve výrobě — automaticky (výroba začala)");
    expect(st.at(-1)).toMatchObject({ actor_id: worker, via: "automaticky" });
    const { data: v } = await svc.from("job_flow_v").select("confirmation_key, fulfilment_key").eq("id", id).single();
    expect(v).toMatchObject({ confirmation_key: "bez_dokladu", fulfilment_key: "ve_vyrobe" });
    const { data: opRow } = await svc.from("job_operations").select("status_changed_by, status_changed_via, created_by").eq("id", (op as { id: string }).id).single();
    expect(opRow).toMatchObject({ status_changed_by: worker, status_changed_via: "rucne", created_by: worker });
    // v kontextu „app“ DB záchrannou událost operace nepíše (zapisuje ji aplikace)
    expect((await events(id, "field")).filter((e) => e.data.production === "status")).toHaveLength(0);
  });

  it("poznámka x-change-note (UTF-8) ve stage_change_note i ve zprávě", async () => {
    const id = await newJob();
    const note = "Zákazník volal — přeceníme ✓";
    const { error } = await localAdmin(userActor({ id: sales })).from("orders").update({ status: "naceneni" }).eq("id", id)
      .setHeader("x-change-note", encodeChangeNote(note)!);
    expect(error).toBeNull();
    expect((await job(id)).stage_change_note).toBe(note);
    expect((await events(id, "stage"))[0].message).toBe(`Stav: Poptávka → Nacenění — ${note}`);
  });

  it("posun zpět vynuluje razítka pozdějších kroků i confirmed_by; explicitní razítko zůstane", async () => {
    const db = localAdmin(userActor({ id: sales }));
    const id = await newJob({ status: "objednavka", order_date: "2026-10-01", customer_order_number: "PO-BACK" }, db);
    await db.from("orders").update({ status: "potvrzeno" }).eq("id", id);
    await db.from("orders").update({ status: "ve_vyrobe" }).eq("id", id);
    const j0 = await job(id);
    expect(j0.confirmed_at).not.toBeNull();
    expect(j0.production_started_at).not.toBeNull();
    expect(j0.confirmed_by).toBe(sales);
    await db.from("orders").update({ status: "objednavka" }).eq("id", id);
    const j1 = await job(id);
    expect(j1).toMatchObject({ confirmed_at: null, confirmed_by: null, production_started_at: null, order_status: "dorucena" });
    const explicit = "2026-09-01T10:00:00+00:00";
    await db.from("orders").update({ status: "dodano_zakaznikovi" }).eq("id", id);
    await db.from("orders").update({ status: "potvrzeno", delivered_at: explicit }).eq("id", id);
    const j2 = await job(id);
    expect(new Date(j2.delivered_at as string).toISOString()).toBe(new Date(explicit).toISOString());
    expect(j2.received_at).toBeNull();
  });

  it("výkres u „čeká na podklady“ ukončí čekání (+ událost „přišly podklady“)", async () => {
    const db = localAdmin(userActor({ id: sales }));
    const id = await newJob({ source: "email" });
    await db.from("orders").update({ inquiry_status: "ceka_na_podklady", waiting_note: "chybí výkres" }).eq("id", id);
    const j0 = await job(id);
    expect(j0.waiting_since).not.toBeNull();
    expect(j0.inquiry_status_changed_via).toBe("rucne");
    await db.from("job_files").insert({ job_id: id, kind: "vykres", filename: "v.pdf", storage_path: `zakazky/${id}/v.pdf` });
    const j1 = await job(id);
    expect(j1).toMatchObject({ inquiry_status: "prijata", waiting_since: null, inquiry_status_changed_via: "automaticky", inquiry_status_changed_by: sales });
    const st = (await events(id, "status")).filter((e) => e.data.field === "inquiry_status");
    expect(st.map((e) => e.message)).toEqual([
      "Poptávka: Přijatá → Čeká na podklady — chybí výkres",
      "Poptávka: Čeká na podklady → Přijatá — automaticky (přišly podklady)",
    ]);
  });

  it("M4: potvrzení od dodavatele / bez původu není naše vystavené potvrzení", async () => {
    const db = localAdmin(userActor({ id: sales }));
    const id = await newJob({ status: "objednavka", order_date: "2026-10-01", customer_order_number: "PO-M4" });
    await db.from("job_files").insert({ job_id: id, kind: "potvrzeni", filename: "d.pdf", storage_path: `zakazky/${id}/d.pdf`, issuer: "dodavatel" });
    await db.from("job_files").insert({ job_id: id, kind: "potvrzeni", filename: "x.pdf", storage_path: `zakazky/${id}/x.pdf` });
    expect((await job(id)).confirmation_issued_at).toBeNull();
    await db.from("job_files").insert({ job_id: id, kind: "potvrzeni", filename: "my.pdf", storage_path: `zakazky/${id}/my.pdf`, origin: "generated" });
    const j = await job(id);
    expect(j).toMatchObject({ confirmation_issued_revision: 1, confirmation_issued_by: sales });
    const { data: f } = await svc.from("job_files").select("issuer, order_revision").eq("job_id", id).eq("filename", "my.pdf").single();
    expect(f).toMatchObject({ issuer: "my", order_revision: 1 });
    // session nesmí označit soubor jako „náš vystavený doklad“
    const s = await localSession(DEMO.sales.email, DEMO.sales.password);
    await s.from("job_files").insert({ job_id: id, kind: "potvrzeni", filename: "fake.pdf", storage_path: `zakazky/${id}/fake.pdf`, origin: "generated" });
    const { data: fake } = await svc.from("job_files").select("origin").eq("job_id", id).eq("filename", "fake.pdf").single();
    expect((fake as { origin: string }).origin).toBe("upload");
  });

  it("B2: smazání účtu s historií projde, jméno zůstane v historii", async () => {
    const email = `e2e-flow-attr-${Date.now()}@local.test`;
    const { data: created, error } = await svc.auth.admin.createUser({ email, password: "Docasne123!", email_confirm: true, user_metadata: { full_name: "Dočasný Účet" } });
    expect(error).toBeNull();
    const uid = created.user!.id;
    tempUsers.push(uid);
    const id = await newJob();
    await localAdmin(userActor({ id: uid })).from("orders").update({ status: "naceneni" }).eq("id", id);
    expect((await job(id)).stage_changed_by).toBe(uid);
    const del = await svc.auth.admin.deleteUser(uid);
    expect(del.error).toBeNull();
    tempUsers.pop();
    const j = await job(id);
    expect(j.stage_changed_by).toBeNull();
    expect(j.stage_changed_at).not.toBeNull();
    const st = await events(id, "stage");
    expect(st[0]).toMatchObject({ actor_id: null, actor_name: "Dočasný Účet" });
    expect(localSql("select count(*) from orders o where stage_changed_by is not null and not exists (select 1 from profiles where id = o.stage_changed_by)")).toBe("0");
  });

  it("smyčky: celý scénář v DB pod statement_timeout 5 s (rollback)", () => {
    const out = localSql(`
      begin;
      set local statement_timeout = '5s';
      insert into orders (id, number, title, source, status, inquiry_date) values ('eeeeeeee-0000-4000-8000-00000000f001', '${PREFIX}-LOOP', 'smyčka', 'email', 'poptavka', '2026-10-20');
      insert into order_items (order_id, name, quantity, unit_price, position) values
        ('eeeeeeee-0000-4000-8000-00000000f001', 'A', 2, 100, 0), ('eeeeeeee-0000-4000-8000-00000000f001', 'B', 1, 50, 1);
      insert into quotes (id, number, job_id, status, total, revision) values ('eeeeeeee-0000-4000-8000-00000000f002', '${PREFIX}-LQ', 'eeeeeeee-0000-4000-8000-00000000f001', 'ke_schvaleni', 250, 1);
      update quotes set status = 'odeslano' where id = 'eeeeeeee-0000-4000-8000-00000000f002';
      update quotes set status = 'prijato' where id = 'eeeeeeee-0000-4000-8000-00000000f002';
      update orders set status = 've_vyrobe' where id = 'eeeeeeee-0000-4000-8000-00000000f001';
      update order_items set delivered_quantity = quantity where order_id = 'eeeeeeee-0000-4000-8000-00000000f001';
      update orders set status = 'fakturovano', invoice_number = 'FV-LOOP' where id = 'eeeeeeee-0000-4000-8000-00000000f001';
      insert into job_payments (job_id, amount) values ('eeeeeeee-0000-4000-8000-00000000f001', 100);
      update orders set paid_at = '2026-10-23', paid_amount = 250 where id = 'eeeeeeee-0000-4000-8000-00000000f001';
      update orders set paid_at = null, paid_amount = null, status = 'fakturovano' where id = 'eeeeeeee-0000-4000-8000-00000000f001';
      update orders set status = 'zruseno' where id = 'eeeeeeee-0000-4000-8000-00000000f001';
      select status || '|' || coalesce(order_status, '-') || '|' || coalesce(lost_reason, '-') || '|' ||
             (select count(*) from job_events where job_id = 'eeeeeeee-0000-4000-8000-00000000f001' and type = 'stage')
        from orders where id = 'eeeeeeee-0000-4000-8000-00000000f001';
      rollback;`);
    expect(out.split("\n").filter((l) => l.includes("|")).at(-1)).toMatch(/^zruseno\|stornovana\|neuvedeno\|\d+$/);
  });
});
