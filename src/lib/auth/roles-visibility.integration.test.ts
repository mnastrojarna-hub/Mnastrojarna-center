import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_ENABLED, DEMO, localAdmin, localAnon, localSession, localSql, profileId } from "@/test/local-supabase";
import { userActor } from "@/lib/supabase/actor-headers";
import { isMineJob, type MineJobFacts } from "@/lib/auth/flow-scope";
import { isPriceDocument } from "@/lib/auth/price-visibility";

/**
 * #25 „Role a viditelnost" — pravidla v DB (migrace 20261023155000) proti skutečnému PostgREST
 * lokálního Supabase: schvalování nabídek ne-adminů super adminem (R0–R7, položky, vrácení),
 * backfill a idempotence migrace, fronta ke schválení, soubory a úložiště, obchodník zakázky,
 * jednorázové „AI focení pro všechny", poslední definice quotes_flow_before.
 * 25-B (druhý blok): parita „moje" SQL ↔ TS, vynucení session, počty a odznaky, pošta (RLS), parita
 * nákupních dokladů a pojistky migrace 20261023157000 (dokumenty přes REST, „Schválil" u zakázky, fronta).
 * Vlastní data Z-E2E-ROLE-* / NAB-E2E-ROLE-*, vše po sobě smaže.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/auth/roles-visibility.integration.test.ts
 */

const TAG = Date.now().toString(36);
const PREFIX = `Z-E2E-ROLE-${TAG}`;
const REPO = path.resolve(__dirname, "../../..");
const MIGRATION = path.join(REPO, "supabase/migrations/20261023155000_role_viditelnost.sql");

type Row = Record<string, unknown>;

/**
 * psql skript v JEDNÉ session (stop na chybě). Migraci test spouští jen uvnitř `begin … rollback` —
 * sdílená DB se nemění (pozdější migrace by se jinak tiše vrátily k definicím z 155000).
 */
function psqlScript(script: string): string {
  return execFileSync(path.join(REPO, "tools/local-supabase/psql.sh"), ["-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-f", "-"], {
    input: script, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

/** Řádky výstupu `značka|hodnota` → { značka: hodnota } (ostatní výstup se ignoruje). */
function marked(out: string): Record<string, string> {
  const res: Record<string, string> = {};
  for (const line of out.split("\n")) {
    const m = /^([A-Z0-9]+)\|(.*)$/.exec(line.trim());
    if (m) res[m[1]] = m[2];
  }
  return res;
}

const INCLUDE_MIGRATION = `\\i '${MIGRATION}'`;

describe.skipIf(!LOCAL_ENABLED)("#25 role a viditelnost — pravidla v DB", () => {
  let svc: SupabaseClient;
  let admin: SupabaseClient;
  let sales: SupabaseClient;
  let worker: SupabaseClient;
  let adminId = "";
  let salesId = "";
  let workerId = "";
  const jobs: string[] = [];
  const queueRows: string[] = [];
  const emails: string[] = [];
  const paths: string[] = [];
  let n = 0;

  async function newJob(patch: Row = {}): Promise<string> {
    n += 1;
    const { data, error } = await svc.from("orders").insert({
      number: `${PREFIX}-${n}`, title: "E2E role", source: "manual", status: "naceneni", inquiry_date: "2026-10-20", ...patch,
    }).select("id").single();
    if (error) throw new Error(error.message);
    const id = (data as { id: string }).id;
    jobs.push(id);
    return id;
  }

  /** Nabídka přes daného klienta (session = REST, app = náš server s autorem). */
  async function newQuote(db: SupabaseClient, jobId: string, patch: Row = {}): Promise<string> {
    n += 1;
    const { data, error } = await db.from("quotes").insert({
      number: `NAB-E2E-ROLE-${TAG}-${n}`, job_id: jobId, status: "ke_schvaleni", total: 1000, revision: 1, valid_until: "2099-01-01", ...patch,
    }).select("id").single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  }

  async function addItem(quoteId: string, patch: Row = {}): Promise<string> {
    const { data, error } = await svc.from("quote_items").insert({
      quote_id: quoteId, position: 0, name: "Díl", quantity: 2, unit: "ks", unit_price: 500, vat_rate: 21, ...patch,
    }).select("id").single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  }

  async function q(id: string): Promise<Row> {
    const { data } = await svc.from("quotes").select("*").eq("id", id).single();
    return data as Row;
  }

  const app = (id: string) => localAdmin(userActor({ id }));
  const tick = () => new Promise((r) => setTimeout(r, 15));

  beforeAll(async () => {
    svc = localAdmin();
    [adminId, salesId, workerId] = await Promise.all([
      profileId(svc, DEMO.admin.email), profileId(svc, DEMO.sales.email), profileId(svc, DEMO.worker.email),
    ]);
    [admin, sales, worker] = await Promise.all([
      localSession(DEMO.admin.email, DEMO.admin.password),
      localSession(DEMO.sales.email, DEMO.sales.password),
      localSession(DEMO.worker.email, DEMO.worker.password),
    ]);
  }, 60_000);

  afterAll(async () => {
    if (!svc) return;
    if (paths.length) await svc.storage.from("job-files").remove(paths);
    if (queueRows.length) await svc.from("approval_queue").delete().in("id", queueRows);
    if (emails.length) await svc.from("emails").delete().in("id", emails);
    if (jobs.length) {
      await svc.from("job_files").delete().in("job_id", jobs);
      await svc.from("job_events").delete().in("job_id", jobs);
      await svc.from("quotes").delete().in("job_id", jobs);
      await svc.from("orders").delete().in("id", jobs);
      await svc.from("audit_log").delete().in("entity_id", jobs);
    }
  }, 60_000);

  // ── 4) Trigger nabídek ─────────────────────────────────────
  it("nabídka obchodníka (REST i server) = „Neschválená“; schvaluje jen super admin; čas schválení dává DB", async () => {
    const job = await newJob();
    const rest = await newQuote(sales, job);
    expect(await q(rest)).toMatchObject({ admin_approval_required: true, approval_required: true, state: "ke_schvaleni", created_by: salesId });
    const viaApp = await newQuote(app(salesId), job);
    expect(await q(viaApp)).toMatchObject({ admin_approval_required: true, state: "ke_schvaleni" });

    // obchodník schválit nesmí (REST i server)
    const own = await sales.from("quotes").update({ approved_by: salesId }).eq("id", rest).select("id");
    expect(own.error?.code).toBe("42501");
    expect(own.error?.message).toContain("Nabídku schvaluje jen super admin.");
    expect((await app(salesId).from("quotes").update({ approved_by: salesId }).eq("id", viaApp).select("id")).error?.code).toBe("42501");
    // ani odeslat (R7)
    const send = await sales.from("quotes").update({ status: "odeslano" }).eq("id", rest).select("id");
    expect(send.error?.code).toBe("P0001");
    expect(send.error?.message).toBe("Nabídka čeká na schválení — odeslat ji lze až po schválení.");

    // super admin schválí — čas schválení vždy z DB (podvržený se ignoruje)
    const ok = await admin.from("quotes").update({ approved_by: adminId, approved_at: "2000-01-01T00:00:00Z" }).eq("id", rest).select("id");
    expect(ok.error).toBeNull();
    const approved = await q(rest);
    expect(approved).toMatchObject({ state: "schvalena", approved_by: adminId });
    expect(Date.parse(String(approved.approved_at))).toBeGreaterThan(Date.now() - 120_000);
    // REST schválení otisk nenese (píše jen server)
    expect(approved.approved_snapshot_sha).toBeNull();

    // nabídka super admina příznak nemá
    const mine = await newQuote(admin, job);
    expect(await q(mine)).toMatchObject({ admin_approval_required: false, approval_required: false, state: "rozpracovana" });
    // ctx db (psql) s autorem obchodníkem — příznak také
    const dbNum = `NAB-E2E-ROLE-${TAG}-db`;
    localSql(`insert into quotes (number, job_id, status, total, created_by) values ('${dbNum}', '${job}', 'ke_schvaleni', 10, '${salesId}')`);
    const { data: dbq } = await svc.from("quotes").select("admin_approval_required, state").eq("number", dbNum).single();
    expect(dbq).toMatchObject({ admin_approval_required: true, state: "ke_schvaleni" });
  });

  it("změna obsahu ne-adminem schválení zruší (hlavička i položky, updated_at se posune); úprava super admina znovu schválí", async () => {
    const job = await newJob();
    const id = await newQuote(app(salesId), job);
    const item = await addItem(id);
    await admin.from("quotes").update({ approved_by: adminId }).eq("id", id);
    expect((await q(id)).state).toBe("schvalena");

    // platnost (obsah) od obchodníka → znovu neschválená
    expect((await sales.from("quotes").update({ valid_until: "2099-02-01" }).eq("id", id).select("id")).error).toBeNull();
    expect(await q(id)).toMatchObject({ state: "ke_schvaleni", approved_by: null, approved_at: null, admin_approval_required: true });

    // položka od obchodníka (server) → zruší schválení a posune updated_at
    await admin.from("quotes").update({ approved_by: adminId }).eq("id", id);
    const before = await q(id);
    await tick();
    expect((await app(salesId).from("quote_items").update({ quantity: 3 }).eq("id", item).select("id")).error).toBeNull();
    const after = await q(id);
    expect(after).toMatchObject({ state: "ke_schvaleni", approved_by: null });
    expect(Date.parse(String(after.updated_at))).toBeGreaterThan(Date.parse(String(before.updated_at)));

    // super admin upraví položku schválené nabídky → zůstane schválená, approved_at se posune
    await admin.from("quotes").update({ approved_by: adminId }).eq("id", id);
    const a1 = await q(id);
    await tick();
    expect((await app(adminId).from("quote_items").update({ quantity: 4 }).eq("id", item).select("id")).error).toBeNull();
    const a2 = await q(id);
    expect(a2).toMatchObject({ state: "schvalena", approved_by: adminId });
    expect(Date.parse(String(a2.approved_at))).toBeGreaterThan(Date.parse(String(a1.approved_at)));
    expect(Date.parse(String(a2.updated_at))).toBeGreaterThan(Date.parse(String(a1.updated_at)));
    // i hlavička od super admina
    await tick();
    await admin.from("quotes").update({ title: "Upraveno adminem" }).eq("id", id);
    const a3 = await q(id);
    expect(a3).toMatchObject({ state: "schvalena", approved_by: adminId });
    expect(Date.parse(String(a3.approved_at))).toBeGreaterThan(Date.parse(String(a2.approved_at)));
  });

  it("schvalovací sloupce přes REST ne-admin nezmění (příznak, AI, otisk, vrácení)", async () => {
    const job = await newJob();
    const id = await newQuote(sales, job, { ai_generated: true });
    const up = await sales.from("quotes").update({
      admin_approval_required: false, ai_generated: false, approved_snapshot_sha: "podvrh",
      approval_returned_at: new Date().toISOString(), approval_return_note: "podvrh",
    }).eq("id", id).select("id");
    expect(up.error).toBeNull();
    expect(await q(id)).toMatchObject({
      admin_approval_required: true, ai_generated: true, approved_snapshot_sha: null, approval_returned_at: null, approval_return_note: null,
      state: "ke_schvaleni",
    });
    // ani při vložení
    const ins = await newQuote(sales, job, { admin_approval_required: false, approved_snapshot_sha: "x", approval_returned_at: new Date().toISOString() });
    expect(await q(ins)).toMatchObject({ admin_approval_required: true, approved_snapshot_sha: null, approval_returned_at: null });
    // server s autorem obchodníkem také ne
    await app(salesId).from("quotes").update({ admin_approval_required: false }).eq("id", ins);
    expect((await q(ins)).admin_approval_required).toBe(true);
  });

  it("R7: neschválenou nabídku nejde odeslat ani přijmout z žádného stavu (zamítnout → odeslat, archiv)", async () => {
    const job = await newJob({ status: "nabidka" });
    const id = await newQuote(app(salesId), job);
    // zamítnout lze jen odeslanou (REST i server, i super admin) — „zamítnout → otevřít jako odeslanou“ neprojde
    for (const db of [sales, app(salesId), admin]) {
      const rej = await db.from("quotes").update({ status: "zamitnuto" }).eq("id", id).select("id");
      expect(rej.error?.message).toBe("Zamítnout lze jen odeslanou nabídku.");
    }
    // starší data (zamítnutá před odesláním, ctx db) se jako odeslaná ani přijatá znovu neotevřou
    localSql(`update quotes set status = 'zamitnuto' where id = '${id}'`);
    expect((await q(id)).state).toBe("zamitnuta");
    const reopen = await sales.from("quotes").update({ status: "odeslano" }).eq("id", id).select("id");
    expect(reopen.error?.message).toBe("Nabídka čeká na schválení — odeslat ji lze až po schválení.");
    const accept = await sales.from("quotes").update({ status: "prijato" }).eq("id", id).select("id");
    expect(accept.error?.message).toBe("Nabídka čeká na schválení — přijmout ji lze až po schválení a odeslání.");
    // vložení rovnou jako odeslaná / přijatá
    const insSent = await sales.from("quotes").insert({ number: `NAB-E2E-ROLE-${TAG}-s`, job_id: job, status: "odeslano", total: 5 }).select("id");
    expect(insSent.error?.code).toBe("P0001");
    const insAcc = await app(salesId).from("quotes").insert({ number: `NAB-E2E-ROLE-${TAG}-a`, job_id: job, status: "prijato", total: 5 }).select("id");
    expect(insAcc.error?.code).toBe("P0001");
    // ani servisní klíč bez autora (jen psql / ctx db je výjimka)
    const svcSend = await svc.from("quotes").update({ status: "odeslano" }).eq("id", id).select("id");
    expect(svcSend.error?.code).toBe("P0001");

    // AI nabídka ke schválení (bez příznaku ne-admina), zamítnutá před odesláním: ani ta se neotevře
    if (localSql("select quote_ai_needs_approval(true)") === "t") {
      const aiNum = `NAB-E2E-ROLE-${TAG}-ai-z`;
      localSql(`insert into quotes (number, job_id, status, total, ai_generated, created_by)
        values ('${aiNum}', '${job}', 'ke_schvaleni', 10, true, '${adminId}');
        update quotes set status = 'zamitnuto' where number = '${aiNum}';`);
      const { data: ai } = await svc.from("quotes").select("id, admin_approval_required, approval_required, sent_at").eq("number", aiNum).single();
      expect(ai).toMatchObject({ admin_approval_required: false, approval_required: true, sent_at: null });
      const aiId = (ai as { id: string }).id;
      expect((await sales.from("quotes").update({ status: "odeslano" }).eq("id", aiId).select("id")).error?.code).toBe("P0001");
      expect((await sales.from("quotes").update({ status: "prijato" }).eq("id", aiId).select("id")).error?.code).toBe("P0001");
    }

    // archiv → úprava → obnovení: příznak zůstává, schválení se zruší
    const a = await newQuote(app(salesId), job);
    await admin.from("quotes").update({ approved_by: adminId }).eq("id", a);
    await sales.from("quotes").update({ archived: true }).eq("id", a);
    expect((await q(a)).state).toBe("archivovana");
    await sales.from("quotes").update({ title: "upraveno v archivu" }).eq("id", a);
    await sales.from("quotes").update({ archived: false }).eq("id", a);
    expect(await q(a)).toMatchObject({ state: "ke_schvaleni", approved_by: null, admin_approval_required: true });
  });

  it("R5: odeslanou nabídku ne-admin obsahově nezmění (hlavička ani položky), platnost prodloužit smí", async () => {
    const job = await newJob({ status: "nabidka" });
    const id = await newQuote(app(salesId), job);
    const item = await addItem(id);
    await admin.from("quotes").update({ approved_by: adminId }).eq("id", id);
    expect((await sales.from("quotes").update({ status: "odeslano" }).eq("id", id).select("id")).error).toBeNull();
    expect((await q(id)).state).toBe("odeslana");

    const total = await sales.from("quotes").update({ total: 1 }).eq("id", id).select("id");
    expect(total.error?.message).toBe("Odeslanou nabídku nejde upravit — vytvoř novou verzi.");
    const it1 = await app(salesId).from("quote_items").update({ unit_price: 1 }).eq("id", item).select("id");
    expect(it1.error?.message).toBe("Odeslanou nabídku nejde upravit — vytvoř novou verzi.");
    const ins = await app(salesId).from("quote_items").insert({ quote_id: id, position: 1, name: "navíc", quantity: 1, unit_price: 1 }).select("id");
    expect(ins.error?.code).toBe("P0001");
    const ext = await sales.from("quotes").update({ valid_until: "2099-12-31" }).eq("id", id).select("id");
    expect(ext.error).toBeNull();
    expect(await q(id)).toMatchObject({ state: "odeslana", valid_until: "2099-12-31", approved_by: adminId });
    // super admin smí (opravy)
    expect((await app(adminId).from("quote_items").update({ note: "oprava" }).eq("id", item).select("id")).error).toBeNull();
    // schválení odeslané nabídky ne-admin nezruší (pak by nešla přijmout) — REST i server
    for (const db of [sales, app(salesId)]) {
      expect((await db.from("quotes").update({ approved_by: null }).eq("id", id).select("id")).error).toBeNull();
      expect(await q(id)).toMatchObject({ state: "odeslana", approved_by: adminId });
    }
    expect((await sales.from("quotes").update({ status: "prijato" }).eq("id", id).select("id")).error).toBeNull();
    expect((await q(id)).state).toBe("prijata");
  });

  it("položku nejde přesunout do jiné nabídky (odeslaná by přišla o položky, schválená o schválení)", async () => {
    const job = await newJob({ status: "nabidka" });
    const sent = await newQuote(app(salesId), job);
    const item = await addItem(sent);
    await admin.from("quotes").update({ approved_by: adminId }).eq("id", sent);
    expect((await sales.from("quotes").update({ status: "odeslano" }).eq("id", sent).select("id")).error).toBeNull();
    const other = await newQuote(app(salesId), job);
    for (const db of [sales, app(salesId), admin]) {
      const mv = await db.from("quote_items").update({ quote_id: other }).eq("id", item).select("id");
      expect(mv.error?.message).toBe("Položku nejde přesunout do jiné nabídky.");
    }
    const { data } = await svc.from("quote_items").select("quote_id").eq("id", item).single();
    expect((data as { quote_id: string }).quote_id).toBe(sent);
    expect((await q(sent)).state).toBe("odeslana");
  });

  it("sent_at (= „odesláno“) mění jen odeslání — ne-admin ho u neodeslané nabídky nenastaví", async () => {
    const job = await newJob();
    const approved = await newQuote(app(salesId), job);
    await admin.from("quotes").update({ approved_by: adminId }).eq("id", approved);
    const pending = await newQuote(app(salesId), job, { ai_generated: true });
    const stamp = new Date().toISOString();
    for (const db of [sales, app(salesId), worker]) {
      expect((await db.from("quotes").update({ sent_at: stamp }).eq("id", approved).select("id")).error).toBeNull();
      expect((await db.from("quotes").update({ sent_at: stamp }).eq("id", pending).select("id")).error).toBeNull();
    }
    expect(await q(approved)).toMatchObject({ state: "schvalena", sent_at: null, approved_by: adminId });
    expect(await q(pending)).toMatchObject({ state: "ke_schvaleni", sent_at: null });
    // ani při vložení neodeslané
    const ins = await newQuote(sales, job, { sent_at: stamp });
    expect((await q(ins)).sent_at).toBeNull();
    // skutečné odeslání sent_at zapíše; opětovné odeslání odeslané ho smí posunout
    expect((await sales.from("quotes").update({ status: "odeslano" }).eq("id", approved).select("id")).error).toBeNull();
    const s1 = await q(approved);
    expect(s1.state).toBe("odeslana");
    expect(s1.sent_at).not.toBeNull();
    const later = new Date(Date.parse(String(s1.sent_at)) + 60_000).toISOString();
    expect((await sales.from("quotes").update({ status: "odeslano", sent_at: later }).eq("id", approved).select("id")).error).toBeNull();
    expect(Date.parse(String((await q(approved)).sent_at))).toBe(Date.parse(later));
  });

  it("zrušené schválení nabídky smaže „Schválil“ u zakázky (orders.approved_by/at)", async () => {
    const job = await newJob();
    const id = await newQuote(app(salesId), job);
    await admin.from("quotes").update({ approved_by: adminId }).eq("id", id);
    await svc.from("orders").update({ approved_by: adminId, approved_at: new Date().toISOString() }).eq("id", job);
    // úprava obchodníka (R1 v BEFORE triggeru) schválení zruší → i u zakázky
    expect((await sales.from("quotes").update({ title: "jinak" }).eq("id", id).select("id")).error).toBeNull();
    expect((await q(id)).approved_by).toBeNull();
    const { data } = await svc.from("orders").select("approved_by, approved_at").eq("id", job).single();
    expect(data).toMatchObject({ approved_by: null, approved_at: null });
  });

  it("R6: vrátit k přepracování smí jen super admin (jen neschválenou); úprava autora vrácení zruší", async () => {
    const job = await newJob();
    const id = await newQuote(app(salesId), job);
    await sales.from("quotes").update({ approval_returned_at: new Date().toISOString(), approval_return_note: "x" }).eq("id", id);
    expect((await q(id)).approval_returned_at).toBeNull();

    const ret = await admin.from("quotes").update({ approval_returned_at: "2000-01-01T00:00:00Z", approval_return_note: "doplň termín" }).eq("id", id).select("id");
    expect(ret.error).toBeNull();
    const r = await q(id);
    expect(r).toMatchObject({ state: "ke_schvaleni", approval_returned_by: adminId, approval_return_note: "doplň termín" });
    expect(Date.parse(String(r.approval_returned_at))).toBeGreaterThan(Date.now() - 120_000);

    await sales.from("quotes").update({ title: "podle připomínek" }).eq("id", id);
    expect(await q(id)).toMatchObject({ approval_returned_at: null, approval_returned_by: null, approval_return_note: null, state: "ke_schvaleni" });

    // schválenou vrátit nejde
    await admin.from("quotes").update({ approved_by: adminId }).eq("id", id);
    const bad = await admin.from("quotes").update({ approval_returned_at: new Date().toISOString(), approval_return_note: "pozdě" }).eq("id", id).select("id");
    expect(bad.error?.message).toBe("Vrátit k přepracování jde jen neschválenou nabídku.");
  });

  it("po schválení odešle nabídku i zaměstnanec — autor, obchodník nebo řešitel zakázky; cizí ne", async () => {
    const job = await newJob({ owner_id: adminId });
    const byWorker = await newQuote(worker, job);
    expect((await q(byWorker)).admin_approval_required).toBe(true);
    await admin.from("quotes").update({ approved_by: adminId }).eq("id", byWorker);
    const sent = await worker.from("quotes").update({ status: "odeslano" }).eq("id", byWorker).select("id");
    expect(sent.error).toBeNull();
    expect(await q(byWorker)).toMatchObject({ state: "odeslana", sent_by: workerId });

    const bySales = await newQuote(app(salesId), job);
    await admin.from("quotes").update({ approved_by: adminId }).eq("id", bySales);
    const foreign = await worker.from("quotes").update({ status: "odeslano" }).eq("id", bySales).select("id");
    expect(foreign.error?.code).toBe("42501");
    // řešitel zakázky smí
    await svc.from("orders").update({ assignee_id: workerId }).eq("id", job);
    expect((await worker.from("quotes").update({ status: "odeslano" }).eq("id", bySales).select("id")).error).toBeNull();
  });

  // ── 5) Backfill + idempotence ──────────────────────────────
  it("backfill: neschválené nabídky ne-adminů (obchodní fáze) označí, schválení ne-adminem zruší, žádost už nevyžaduje schválení; 2. běh nic", async () => {
    const job = await newJob({ approved_by: salesId, approved_at: new Date().toISOString() });
    const late = await newJob({ status: "ve_vyrobe" });
    const num = (s: string) => `NAB-E2E-ROLE-${TAG}-bf-${s}`;
    const pattern = `NAB-E2E-ROLE-${TAG}-bf-%`;
    const snapshot = (tag: string) => `
      select '${tag}Q|' || coalesce((select json_agg(json_build_object('k', right(number, 1), 'state', state,
        'flag', admin_approval_required, 'req', approval_required, 'by', approved_by, 'arch', archived, 'ctid', ctid::text)
        order by number) from quotes where number like '${pattern}')::text, '[]');
      select '${tag}E|' || count(*) from job_events where job_id in ('${job}', '${late}');
      select '${tag}O|' || coalesce(approved_by::text, '-') from orders where id = '${job}';`;
    // staré řádky jako před migrací (bez triggerů), migrace dvakrát — vše v transakci, která se odvolá
    const out = marked(psqlScript(`
      begin;
      set local session_replication_role = replica;
      insert into quotes (number, job_id, status, state, total, created_by, approval_required, admin_approval_required, archived, approved_by, approved_at, approval_requested_at, sent_at) values
        ('${num("u")}', '${job}', 'ke_schvaleni', 'rozpracovana', 10, '${salesId}', false, false, false, null, null, null, null),
        ('${num("a")}', '${job}', 'ke_schvaleni', 'schvalena', 10, '${salesId}', true, false, false, '${salesId}', now(), now(), null),
        ('${num("r")}', '${job}', 'ke_schvaleni', 'archivovana', 10, '${salesId}', false, false, true, null, null, null, null),
        ('${num("m")}', '${job}', 'ke_schvaleni', 'ke_schvaleni', 10, '${adminId}', true, false, false, null, null, now(), null),
        ('${num("z")}', '${job}', 'zamitnuto', 'zamitnuta', 10, '${salesId}', false, false, false, null, null, null, null),
        ('${num("l")}', '${late}', 'ke_schvaleni', 'ke_schvaleni', 10, '${salesId}', true, false, false, null, null, now(), null);
      set local session_replication_role = origin;
      ${INCLUDE_MIGRATION}
      ${snapshot("A")}
      ${INCLUDE_MIGRATION}
      ${snapshot("B")}
      select 'C|' || count(*) from quotes q where q.number like '${pattern}'
        and (q.status in ('navrh_ai', 'ke_schvaleni') or (q.status = 'zamitnuto' and q.sent_at is null))
        and (q.job_id is null or exists (select 1 from orders o where o.id = q.job_id and o.status in ('poptavka', 'naceneni', 'nabidka', 'pozastaveno')))
        and ((not q.admin_approval_required and quote_author_needs_admin(q.created_by))
          or (q.approved_by is not null and quote_author_needs_admin(q.approved_by))
          or (q.status <> 'zamitnuto' and q.approval_required is distinct from (quote_ai_needs_approval(q.ai_generated) or q.admin_approval_required)));
      rollback;`));
    type Snap = { k: string; state: string; flag: boolean; req: boolean; by: string | null; arch: boolean; ctid: string };
    const rowsOf = (s: string) => Object.fromEntries((JSON.parse(s) as Snap[]).map((r) => [r.k, r]));
    const first = rowsOf(out.AQ);
    expect(first.u).toMatchObject({ flag: true, state: "ke_schvaleni" });
    expect(first.a).toMatchObject({ flag: true, by: null, state: "ke_schvaleni" });
    expect(first.r).toMatchObject({ flag: true, state: "archivovana", arch: true });
    expect(first.m).toMatchObject({ flag: false, req: false, state: "rozpracovana" });
    // zamítnutá, která nikdy neodešla: příznak (R7 pak brání „znovuotevření“ jako odeslané)
    expect(first.z).toMatchObject({ flag: true, state: "zamitnuta" });
    // zakázka už ve výrobě: starý koncept se neoznačí, jen přepočet (žádost už schválení nevyžaduje)
    expect(first.l).toMatchObject({ flag: false, req: false, state: "rozpracovana" });
    // zakázka v obchodní fázi: „Schválil“ ne-adminem zmizí
    expect(out.AO).toBe("-");
    // 2. běh: žádný řádek se nezměnil (ctid), žádná nová historie
    const second = rowsOf(out.BQ);
    for (const k of ["u", "a", "r", "m", "z", "l"]) expect(second[k].ctid, k).toBe(first[k].ctid);
    expect(out.BE).toBe(out.AE);
    expect(out.C).toBe("0");
    // sdílená DB beze změny (transakce odvolána)
    expect((await svc.from("quotes").select("id").like("number", pattern)).data ?? []).toEqual([]);
    expect(((await svc.from("orders").select("approved_by").eq("id", job).single()).data as Row).approved_by).toBe(salesId);
  }, 60_000);

  // ── 7) Fronta ke schválení ─────────────────────────────────
  it("fronta: anonym ani zaměstnanec nic; obchodník jen své řádky; vkládá jen super admin", async () => {
    const mk = async (owner: string | null) => {
      const { data, error } = await svc.from("approval_queue").insert({
        type: "email_reply", title: `E2E role ${TAG}`, payload: {}, owner_id: owner,
      }).select("id").single();
      if (error) throw new Error(error.message);
      queueRows.push((data as { id: string }).id);
      return (data as { id: string }).id;
    };
    const own = await mk(salesId);
    const foreign = await mk(adminId);
    const orphan = await mk(null);
    const mineOnly = [own, foreign, orphan];

    const anon = await localAnon().from("approval_queue").select("id").in("id", mineOnly);
    expect(anon.data ?? []).toEqual([]);
    const w = await worker.from("approval_queue").select("id").in("id", mineOnly);
    expect(w.data ?? []).toEqual([]);
    const s = await sales.from("approval_queue").select("id").in("id", mineOnly);
    expect(((s.data ?? []) as { id: string }[]).map((r) => r.id)).toEqual([own]);
    const a = await admin.from("approval_queue").select("id").in("id", mineOnly);
    expect((a.data ?? []).length).toBe(3);

    // obchodník sáhne jen na svůj řádek — a i tam obsah nezmění (jinak „confused deputy“: přepsat řádek na
    // schválení cizí nabídky / e-mail na jinou adresu, který pak super admin jedním klikem provede)
    const job = await newJob();
    const victim = await newQuote(app(salesId), job);
    const rewrite = await sales.from("approval_queue").update({
      type: "quote", quote_id: victim, target: "utocnik@example.com", payload: { body: "jiný text" }, summary: "podvrh",
      title: "podvrh", owner_id: adminId,
    }).eq("id", own).select("id");
    expect(rewrite.error).toBeNull();
    const { data: kept } = await svc.from("approval_queue").select("type, quote_id, target, payload, summary, title, owner_id, status").eq("id", own).single();
    expect(kept).toMatchObject({ type: "email_reply", quote_id: null, target: null, payload: {}, summary: null, title: `E2E role ${TAG}`, owner_id: salesId, status: "pending" });
    expect(((await sales.from("approval_queue").update({ summary: "x" }).eq("id", foreign).select("id")).data ?? []).length).toBe(0);
    // vyřídit („schváleno“) smí jen super admin; odmítnout čekající svůj řádek obchodník smí
    const approve = await sales.from("approval_queue").update({ status: "approved" }).eq("id", own).select("id");
    expect(approve.error?.message).toBe("Položku fronty vyřizuje super admin.");
    expect((await sales.from("approval_queue").update({ status: "rejected" }).eq("id", own).select("id")).error).toBeNull();
    expect(((await svc.from("approval_queue").select("status, resolved_by").eq("id", own).single()).data as Row))
      .toMatchObject({ status: "rejected", resolved_by: salesId });
    expect((await sales.from("approval_queue").update({ status: "pending" }).eq("id", own).select("id")).error?.code).toBe("42501");
    // super admin přes REST obsah upraví (doplnění adresy)
    expect((await admin.from("approval_queue").update({ target: "zakaznik@example.com" }).eq("id", foreign).select("id")).error).toBeNull();
    expect(((await svc.from("approval_queue").select("target").eq("id", foreign).single()).data as Row).target).toBe("zakaznik@example.com");
    // vložit (skrýt nabídku za „čekající řádek") nesmí
    const ins = await sales.from("approval_queue").insert({ type: "email_reply", title: "podvrh", payload: {}, owner_id: salesId }).select("id");
    expect(ins.error).not.toBeNull();
    expect(((await sales.from("approval_queue").delete().eq("id", own).select("id")).data ?? []).length).toBe(0);
  });

  // ── 8) Soubory a úložiště ──────────────────────────────────
  it("nákupní doklad: zaměstnanec řádek ani soubor nepřečte, obchodník ano; REST obsah souboru nepřepíše", async () => {
    const job = await newJob();
    const pricePath = `${job}/e2e-${TAG}-nabidka-dodavatele.pdf`;
    const drawPath = `${job}/e2e-${TAG}-vykres.pdf`;
    const body = new Blob([Buffer.from("%PDF-1.4 e2e")], { type: "application/pdf" });
    for (const p of [pricePath, drawPath]) {
      const { error } = await svc.storage.from("job-files").upload(p, body, { contentType: "application/pdf", upsert: true });
      if (error) throw new Error(error.message);
      paths.push(p);
    }
    const { data: files, error } = await svc.from("job_files").insert([
      { job_id: job, kind: "naceneni", issuer: "dodavatel", filename: "nab.pdf", storage_path: pricePath, origin: "upload", content_sha256: "abc" },
      { job_id: job, kind: "vykres", issuer: "dodavatel", filename: "vyk.pdf", storage_path: drawPath, origin: "upload" },
    ]).select("id, kind");
    if (error) throw new Error(error.message);
    const priceId = ((files ?? []) as { id: string; kind: string }[]).find((f) => f.kind === "naceneni")!.id;
    const drawId = ((files ?? []) as { id: string; kind: string }[]).find((f) => f.kind === "vykres")!.id;

    const wRows = ((await worker.from("job_files").select("id").eq("job_id", job)).data ?? []) as { id: string }[];
    expect(wRows.map((r) => r.id)).toEqual([drawId]);
    const sRows = ((await sales.from("job_files").select("id").eq("job_id", job)).data ?? []) as { id: string }[];
    expect(sRows.map((r) => r.id).sort()).toEqual([priceId, drawId].sort());
    expect((await worker.storage.from("job-files").download(pricePath)).error).not.toBeNull();
    expect((await worker.storage.from("job-files").download(drawPath)).error).toBeNull();
    expect((await sales.storage.from("job-files").download(pricePath)).error).toBeNull();

    // REST: cesta, čas, otisk, druh — zůstávají (mění jen náš server)
    const patch = await sales.from("job_files").update({
      storage_path: drawPath, created_at: "2000-01-01T00:00:00Z", content_sha256: "podvrh", kind: "ostatni", title: "nový název",
    }).eq("id", priceId).select("id");
    expect(patch.error).toBeNull();
    const { data: kept } = await svc.from("job_files").select("storage_path, created_at, content_sha256, kind, title").eq("id", priceId).single();
    expect(kept).toMatchObject({ storage_path: pricePath, content_sha256: "abc", kind: "naceneni", title: "nový název" });
    expect(String((kept as Row).created_at)).not.toContain("2000-01-01");

    // úložiště: přepsat vystavené PDF ani nahrát mimo capture/<uid>/ nejde; signed upload (aplikace) ano
    const over = await sales.storage.from("job-files").upload(drawPath, body, { contentType: "application/pdf", upsert: true });
    expect(over.error).not.toBeNull();
    const outside = await sales.storage.from("job-files").upload(`${job}/e2e-${TAG}-cizi.pdf`, body, { contentType: "application/pdf" });
    expect(outside.error).not.toBeNull();
    const otherCapture = await sales.storage.from("job-files").upload(`capture/${workerId}/e2e-${TAG}.pdf`, body, { contentType: "application/pdf" });
    expect(otherCapture.error).not.toBeNull();
    const ownCapture = `capture/${salesId}/e2e-${TAG}-vlastni.pdf`;
    const direct = await sales.storage.from("job-files").upload(ownCapture, body, { contentType: "application/pdf" });
    expect(direct.error).toBeNull();
    paths.push(ownCapture);
    for (const p of [`capture/${salesId}/e2e-${TAG}-signed.pdf`, `${job}/e2e-${TAG}-signed.pdf`]) {
      const signed = await svc.storage.from("job-files").createSignedUploadUrl(p);
      expect(signed.error).toBeNull();
      const up = await sales.storage.from("job-files").uploadToSignedUrl(signed.data!.path, signed.data!.token, body, { contentType: "application/pdf" });
      expect(up.error, p).toBeNull();
      paths.push(p);
    }
  });

  it("přílohy e-mailů vkládá jen server (ani vlastník schránky přes REST)", async () => {
    const { data, error } = await svc.from("emails").insert({
      mailbox_id: "d5000000-0000-0000-0000-000000000001", owner_id: salesId, subject: `E2E role ${TAG}`, from_email: "x@example.test",
    }).select("id").single();
    if (error) throw new Error(error.message);
    const emailId = (data as { id: string }).id;
    emails.push(emailId);
    const ins = await sales.from("email_attachments").insert({ email_id: emailId, filename: "podvrh.pdf", storage_path: "x/y.pdf" }).select("id");
    expect(ins.error).not.toBeNull();

    // vlastní e-mail: přes REST jen příznaky (přečteno, spam…) — ne schránku, obsah ani vazby
    const other = "d5000000-0000-0000-0000-000000000002";
    const up = await sales.from("emails").update({
      mailbox_id: other, subject: "Podvržený e-mail", body_text: "podvrh", from_email: "ceo@example.com", is_read: true, is_spam: true,
    }).eq("id", emailId).select("id");
    expect(up.error).toBeNull();
    const { data: kept } = await svc.from("emails").select("mailbox_id, owner_id, subject, body_text, from_email, is_read, is_spam").eq("id", emailId).single();
    expect(kept).toMatchObject({
      mailbox_id: "d5000000-0000-0000-0000-000000000001", owner_id: salesId, subject: `E2E role ${TAG}`, body_text: null,
      from_email: "x@example.test", is_read: true, is_spam: true,
    });
    // dílna podvržený e-mail nevidí
    expect(((await worker.from("emails").select("id").eq("id", emailId)).data ?? []).length).toBe(0);
  });

  it("deaktivovaný účet nečte ani nenahrává ani do svého capture/<uid>/", async () => {
    const body = new Blob([Buffer.from("%PDF-1.4 e2e")], { type: "application/pdf" });
    const own = `capture/${workerId}/e2e-${TAG}-deakt.pdf`;
    const up = await worker.storage.from("job-files").upload(own, body, { contentType: "application/pdf" });
    expect(up.error).toBeNull();
    paths.push(own);
    expect((await worker.storage.from("job-files").download(own)).error).toBeNull();
    localSql(`update profiles set active = false where id = '${workerId}'`);
    try {
      expect((await worker.storage.from("job-files").download(own)).error).not.toBeNull();
      const again = await worker.storage.from("job-files").upload(`capture/${workerId}/e2e-${TAG}-deakt-2.pdf`, body, { contentType: "application/pdf" });
      expect(again.error).not.toBeNull();
    } finally {
      localSql(`update profiles set active = true where id = '${workerId}'`);
    }
    expect((await worker.storage.from("job-files").download(own)).error).toBeNull();
  });

  // ── 9) Obchodník zakázky ───────────────────────────────────
  it("obchodníka zakázky mění jen super admin (REST); zpracovává může měnit každý", async () => {
    const job = await newJob({ owner_id: adminId });
    const s = await sales.from("orders").update({ owner_id: salesId }).eq("id", job).select("id");
    expect(s.error?.code).toBe("42501");
    expect(s.error?.message).toBe("Obchodníka zakázky mění jen super admin.");
    expect((await worker.from("orders").update({ owner_id: workerId }).eq("id", job).select("id")).error?.code).toBe("42501");
    expect((await sales.from("orders").update({ assignee_id: salesId }).eq("id", job).select("id")).error).toBeNull();
    expect((await admin.from("orders").update({ owner_id: salesId }).eq("id", job).select("id")).error).toBeNull();
    const { data } = await svc.from("orders").select("owner_id, assignee_id").eq("id", job).single();
    expect(data).toMatchObject({ owner_id: salesId, assignee_id: salesId });
  });

  // ── 10) AI focení pro všechny ──────────────────────────────
  it("AI focení pro všechny: značka jen jednou — pozdější vypnutí super adminem migrace nepřepíše", async () => {
    const value = () => localSql("select value from integration_settings where key = 'ai_capture_for_all'");
    const original = value();
    expect(localSql("select value from integration_settings where key = 'ai_capture_default_v25'")).toBe("done");
    // vypnutí + znovu celá migrace v transakci, která se odvolá (sdílené nastavení se nemění)
    const out = marked(psqlScript(`
      begin;
      update integration_settings set value = 'false' where key = 'ai_capture_for_all';
      ${INCLUDE_MIGRATION}
      select 'V|' || value from integration_settings where key = 'ai_capture_for_all';
      rollback;`));
    expect(out.V).toBe("false");
    expect(value()).toBe(original);
  }, 60_000);

  // ── 11) Poslední definice funkcí ───────────────────────────
  it("platí definice z 20261023155000 (R0–R7, aktivní účty, štítek Neschválená)", () => {
    const src = localSql("select prosrc from pg_proc where proname = 'quotes_flow_before'");
    for (const marker of ["R0 (#25)", "R1 (#25)", "R2 (#25)", "R3 (#25)", "R5 (#25)", "R6 (#25)", "R7 (#25)", "R4"]) {
      expect(src, marker).toContain(marker);
    }
    expect(localSql("select prosrc from pg_proc where proname = 'is_super_admin'")).toContain("active");
    expect(localSql("select prosrc from pg_proc where proname = 'is_obchodnik_or_admin'")).toContain("active");
    expect(localSql("select flow_state_label('quote_state', 'ke_schvaleni')")).toBe("Neschválená");
    expect(localSql("select count(*) from pg_trigger where tgname in ('trg_quote_items_admin_approval', 'trg_orders_owner_guard')")).toBe("2");
  });
});

// ═══ 25-B: „moje" (parita SQL ↔ TS, vynucení session, počty), pošta, nákupní doklady, pojistky 157000 ═══
describe.skipIf(!LOCAL_ENABLED)("#25 „moje“ obchodního toku a pojistky 20261023157000", () => {
  let svc: SupabaseClient;
  let admin: SupabaseClient;
  let sales: SupabaseClient;
  let worker: SupabaseClient;
  let temp: SupabaseClient;
  let adminId = "";
  let salesId = "";
  let workerId = "";
  let tempId = "";
  const TEMP_EMAIL = `e2e-role-moje-${TAG}@local.test`;
  const TEMP_PASSWORD = "Docasne123!";
  const SALES_BOX = "d5000000-0000-0000-0000-000000000001";
  const WORKER_BOX = "d5000000-0000-0000-0000-000000000002";
  const jobs: string[] = [];
  const emailIds: string[] = [];
  const boxes: string[] = [];
  const queueRows: string[] = [];
  const pos: string[] = [];
  const sqs: string[] = [];
  const stored: string[] = [];
  const custs: string[] = [];
  let k = 0;
  const app = (id: string) => localAdmin(userActor({ id }));

  async function job(patch: Row = {}): Promise<string> {
    k += 1;
    const { data, error } = await svc.from("orders").insert({
      number: `${PREFIX}-M${k}`, title: "E2E moje", source: "manual", status: "poptavka", inquiry_date: "2026-10-20", ...patch,
    }).select("id").single();
    if (error) throw new Error(error.message);
    jobs.push((data as { id: string }).id);
    return (data as { id: string }).id;
  }
  async function email(patch: Row): Promise<string> {
    const { data, error } = await svc.from("emails").insert({ subject: `E2E moje ${TAG}`, from_email: "x@example.test", direction: "in", ...patch }).select("id").single();
    if (error) throw new Error(error.message);
    emailIds.push((data as { id: string }).id);
    return (data as { id: string }).id;
  }
  async function mailbox(owner: string | null): Promise<string> {
    const { data, error } = await svc.from("mailboxes").insert({
      provider: "imap", email: `e2e-moje-${TAG}-${boxes.length}@local.test`, owner_id: owner, active: false, config: {},
    }).select("id").single();
    if (error) throw new Error(error.message);
    boxes.push((data as { id: string }).id);
    return (data as { id: string }).id;
  }
  async function quote(db: SupabaseClient, jobId: string, patch: Row = {}): Promise<string> {
    k += 1;
    const { data, error } = await db.from("quotes").insert({
      number: `NAB-E2E-MOJE-${TAG}-${k}`, job_id: jobId, status: "ke_schvaleni", total: 1000, revision: 1, valid_until: "2099-01-01", ...patch,
    }).select("id").single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  }

  /** Fakta pro TS isMineJob přímo z DB (servisní klíč). */
  async function factsOf(ids: string[]): Promise<Map<string, MineJobFacts>> {
    const { data: orders } = await svc.from("orders").select("id, owner_id, assignee_id, created_by, email_id").in("id", ids);
    const rows = (orders ?? []) as { id: string; owner_id: string | null; assignee_id: string | null; created_by: string | null; email_id: string | null }[];
    const linked = rows.map((r) => r.email_id).filter((v): v is string => Boolean(v));
    const [byOrder, byId, qs] = await Promise.all([
      svc.from("emails").select("id, order_id, owner_id, mailbox_id").in("order_id", ids),
      linked.length ? svc.from("emails").select("id, order_id, owner_id, mailbox_id").in("id", linked) : Promise.resolve({ data: [] }),
      svc.from("quotes").select("job_id, created_by, owner_id, approval_requested_by").in("job_id", ids),
    ]);
    type E = { id: string; order_id: string | null; owner_id: string | null; mailbox_id: string | null };
    const mails = [...((byOrder.data ?? []) as E[]), ...((byId.data ?? []) as E[])];
    const out = new Map<string, MineJobFacts>();
    for (const r of rows) {
      out.set(r.id, {
        ownerId: r.owner_id, assigneeId: r.assignee_id, createdBy: r.created_by,
        emails: mails.filter((e) => e.order_id === r.id || e.id === r.email_id).map((e) => ({ ownerId: e.owner_id, mailboxId: e.mailbox_id })),
        quotePeople: ((qs.data ?? []) as Row[]).filter((q) => q.job_id === r.id)
          .flatMap((q) => [q.created_by, q.owner_id, q.approval_requested_by] as (string | null)[]),
      });
    }
    return out;
  }
  async function boxesOf(user: string): Promise<string[]> {
    const { data } = await svc.from("mailboxes").select("id").eq("owner_id", user);
    return ((data ?? []) as { id: string }[]).map((m) => m.id);
  }
  async function sqlMine(db: SupabaseClient, user: string, within: string[]): Promise<string[]> {
    const { data, error } = await db.rpc("flow_mine_job_id_list", { p_user: user });
    if (error) throw new Error(error.message);
    return ((data ?? []) as string[]).filter((id) => within.includes(id)).sort();
  }
  async function tsMine(user: string, within: string[]): Promise<string[]> {
    const facts = await factsOf(within);
    const viewer = { userId: user, mailboxIds: await boxesOf(user) };
    return within.filter((id) => facts.has(id) && isMineJob(facts.get(id)!, viewer)).sort();
  }

  let fx: Record<string, string> = {};

  beforeAll(async () => {
    svc = localAdmin();
    [adminId, salesId, workerId] = await Promise.all([
      profileId(svc, DEMO.admin.email), profileId(svc, DEMO.sales.email), profileId(svc, DEMO.worker.email),
    ]);
    const { data: created, error } = await svc.auth.admin.createUser({
      email: TEMP_EMAIL, password: TEMP_PASSWORD, email_confirm: true, user_metadata: { full_name: "Dočasný Obchodník" },
    });
    if (error) throw new Error(error.message);
    tempId = created.user!.id;
    localSql(`update profiles set role = 'obchodnik', active = true, full_name = 'Dočasný Obchodník' where id = '${tempId}'`);
    [admin, sales, worker, temp] = await Promise.all([
      localSession(DEMO.admin.email, DEMO.admin.password),
      localSession(DEMO.sales.email, DEMO.sales.password),
      localSession(DEMO.worker.email, DEMO.worker.password),
      localSession(TEMP_EMAIL, TEMP_PASSWORD),
    ]);

    // fixtury „moje“ dočasného obchodníka T (a–f), cizí, přeřazená schránka, e-mail bez schránky
    const myBox = await mailbox(tempId);
    const freeBox = await mailbox(null);
    fx.a = await job({ owner_id: tempId });
    fx.b = await job({ owner_id: adminId, assignee_id: tempId });
    fx.c = await job({ owner_id: adminId, created_by: tempId });
    const eD = await email({ mailbox_id: myBox, owner_id: null });
    fx.d = await job({ owner_id: adminId, email_id: eD });
    fx.e = await job({ owner_id: adminId });
    await email({ mailbox_id: null, owner_id: tempId, order_id: fx.e, direction: "out" });
    fx.f = await job({ owner_id: adminId });
    await quote(app(tempId), fx.f);
    fx.none = await job({ owner_id: adminId });
    await email({ mailbox_id: WORKER_BOX, owner_id: workerId, order_id: fx.none });
    await quote(svc, fx.none, { created_by: adminId });
    fx.reassigned = await job({ owner_id: adminId });
    await email({ mailbox_id: freeBox, owner_id: tempId, order_id: fx.reassigned });
    fx.nomailbox = await job({ owner_id: null });
    await email({ mailbox_id: null, owner_id: null, order_id: fx.nomailbox });
    fx.freeBox = freeBox;
  }, 90_000);

  afterAll(async () => {
    if (!svc) return;
    if (queueRows.length) await svc.from("approval_queue").delete().in("id", queueRows);
    if (pos.length) await svc.from("purchase_orders").delete().in("id", pos);
    if (sqs.length) await svc.from("supplier_quotes").delete().in("id", sqs);
    if (emailIds.length) await svc.from("emails").delete().in("id", emailIds);
    if (jobs.length) {
      await svc.from("job_files").delete().in("job_id", jobs);
      await svc.from("job_events").delete().in("job_id", jobs);
      await svc.from("quotes").delete().in("job_id", jobs);
      await svc.from("orders").delete().in("id", jobs);
    }
    if (stored.length) await svc.storage.from("job-files").remove(stored);
    if (custs.length) await svc.from("customers").delete().in("id", custs);
    if (boxes.length) await svc.from("mailboxes").delete().in("id", boxes);
    if (tempId) await svc.auth.admin.deleteUser(tempId).catch(() => undefined);
  }, 60_000);

  // ── 1) Parita „moje“ ────────────────────────────────────────
  it("parita: SQL flow_mine_job_ids = TS isMineJob (a–f, nic, cizí schránka, přeřazená schránka, e-mail bez schránky)", async () => {
    const within = Object.entries(fx).filter(([key]) => key !== "freeBox").map(([, v]) => v);
    const { data: demo } = await svc.from("orders").select("id")
      .gte("id", "d0000000-0000-0000-0000-000000000000").lte("id", "d0000000-0000-0000-0000-0000000000ff");
    const withDemo = [...within, ...((demo ?? []) as { id: string }[]).map((r) => r.id)];
    for (const user of [adminId, salesId, workerId, tempId]) {
      expect(await sqlMine(svc, user, withDemo), user).toEqual(await tsMine(user, withDemo));
      // pole (bez limitu řádků) = množina z flow_mine_job_ids
      const { data: set } = await svc.rpc("flow_mine_job_ids", { p_user: user });
      expect(((set ?? []) as string[]).filter((id) => withDemo.includes(id)).sort(), user).toEqual(await sqlMine(svc, user, withDemo));
    }
    expect(await sqlMine(svc, tempId, within)).toEqual([fx.a, fx.b, fx.c, fx.d, fx.e, fx.f, fx.reassigned].sort());
    expect(await sqlMine(svc, workerId, within)).toEqual([fx.none]);

    // přeřazení schránky: nový vlastník přebírá zakázky z příchozí pošty, starý drží své (e-mail přiřazený jemu)
    await svc.from("mailboxes").update({ owner_id: workerId }).eq("id", fx.freeBox);
    try {
      expect(await sqlMine(svc, workerId, within)).toEqual([fx.none, fx.reassigned].sort());
      expect(await tsMine(workerId, within)).toEqual([fx.none, fx.reassigned].sort());
      expect(await sqlMine(svc, tempId, within)).toContain(fx.reassigned);
    } finally {
      await svc.from("mailboxes").update({ owner_id: null }).eq("id", fx.freeBox);
    }
  }, 60_000);

  it("parita nákupních dokladů: SQL job_file_is_price_doc / job_file_price_ids = TS isPriceDocument (i sdílená cesta)", async () => {
    const jobId = await job({ owner_id: adminId });
    const base = `${jobId}/e2e-moje-${TAG}`;
    const matrix: Row[] = [
      { kind: "objednavka_vydana", issuer: "my", origin: "generated" },
      { kind: "naceneni", issuer: "dodavatel", origin: "capture" },
      { kind: "vykres", issuer: "dodavatel", origin: "upload" },
      { kind: "model_3d", issuer: "dodavatel", origin: "upload" },
      { kind: "nabidka", issuer: null, origin: "upload" },
      { kind: "nabidka", issuer: "my", origin: "generated" },
      { kind: "potvrzeni", issuer: null, origin: "generated" },
      { kind: "faktura", issuer: null, origin: "email" },
      { kind: "poptavka", issuer: null, origin: "upload" },
      { kind: "ostatni", issuer: "my", origin: "upload" },
      { kind: "ostatni", issuer: "my", origin: "upload" },
      { kind: "foto", issuer: "zakaznik", origin: "capture" },
    ];
    const { data, error } = await svc.from("job_files").insert(matrix.map((m, i) => ({
      job_id: jobId, filename: `f${i}.pdf`, storage_path: `${base}-${i}.pdf`, ...m,
    }))).select("id, kind, issuer, origin, storage_path, filename");
    if (error) throw new Error(error.message);
    const files = (data ?? []) as { id: string; kind: string; issuer: string | null; origin: string | null; storage_path: string; filename: string }[];
    const byName = (n: string) => files.find((f) => f.filename === n)!;
    // f9 navázaný na objednávku dodavateli, f10 na nabídku dodavatele
    const po = await svc.from("purchase_orders").insert({ job_id: jobId, file_id: byName("f9.pdf").id, number: `OV-E2E-${TAG}` }).select("id").single();
    if (po.error) throw new Error(po.error.message);
    pos.push((po.data as { id: string }).id);
    const sq = await svc.from("supplier_quotes").insert({ job_id: jobId, file_id: byName("f10.pdf").id, supplier_name: "E2E dodavatel" }).select("id").single();
    if (sq.error) throw new Error(sq.error.message);
    sqs.push((sq.data as { id: string }).id);
    const linked = new Set([byName("f9.pdf").id, byName("f10.pdf").id]);
    for (const f of files) {
      const { data: v } = await svc.rpc("job_file_is_price_doc", { p_id: f.id, p_kind: f.kind, p_issuer: f.issuer, p_origin: f.origin });
      expect(v, `${f.filename} ${f.kind}/${f.issuer}/${f.origin}`).toBe(isPriceDocument(f, linked));
    }
    // výkres se stejnou cestou jako nabídka dodavatele (f1) = nákupní (cestou), jinak ne
    const twin = await svc.from("job_files").insert({ job_id: jobId, kind: "vykres", filename: "twin.pdf", storage_path: byName("f1.pdf").storage_path }).select("id").single();
    if (twin.error) throw new Error(twin.error.message);
    const twinId = (twin.data as { id: string }).id;
    const { data: priceIds, error: pErr } = await svc.rpc("job_file_price_ids", { p_ids: [...files.map((f) => f.id), twinId] });
    expect(pErr).toBeNull();
    const expected = [...files.filter((f) => isPriceDocument(f, linked)).map((f) => f.id), twinId].sort();
    expect(((priceIds ?? []) as string[]).sort()).toEqual(expected);
    // REST session funkci nemá (jen server)
    expect((await sales.rpc("job_file_price_ids", { p_ids: [twinId] })).error).not.toBeNull();
  }, 60_000);

  // ── 2) Vynucení session ────────────────────────────────────
  it("session: flow_mine_job_ids vždy pro sebe (podvržené p_user nepomůže); neaktivní účet nic; flow_counts(p_mine) pro sebe", async () => {
    const within = [fx.a, fx.b, fx.c, fx.d, fx.e, fx.f, fx.none, fx.reassigned, fx.nomailbox];
    expect(await sqlMine(temp, adminId, within)).toEqual(await sqlMine(svc, tempId, within));
    expect(await sqlMine(sales, tempId, within)).toEqual(await sqlMine(svc, salesId, within));
    const { data: setOwn } = await temp.rpc("flow_mine_job_ids", { p_user: adminId });
    expect(((setOwn ?? []) as string[]).filter((id) => within.includes(id)).sort()).toEqual(await sqlMine(svc, tempId, within));

    const counts = async (db: SupabaseClient, mine: string | null) => {
      const { data, error } = await db.rpc("flow_counts", mine === undefined ? {} : { p_mine: mine });
      if (error) throw new Error(error.message);
      return Object.fromEntries(((data ?? []) as { flow_phase: string; flow_key: string; n: number }[]).map((r) => [`${r.flow_phase}.${r.flow_key}`, r.n]));
    };
    expect(await counts(temp, adminId)).toEqual(await counts(svc, tempId));

    localSql(`update profiles set active = false where id = '${tempId}'`);
    try {
      expect(await sqlMine(temp, tempId, within)).toEqual([]);
      const { data: none } = await temp.rpc("flow_mine_job_ids", { p_user: tempId });
      expect(((none ?? []) as string[]).filter((id) => within.includes(id))).toEqual([]);
    } finally {
      localSql(`update profiles set active = true where id = '${tempId}'`);
    }
  }, 60_000);

  // ── 3) Počty ───────────────────────────────────────────────
  it("počty: flow_counts(p_mine) = počty z „moje“ seznamů; null = všichni; odznaky bez uzavřených zakázek a s vrácenými zvlášť", async () => {
    const mine = await sqlMine(svc, tempId, [...jobs]);
    // fixtury obchodníka T jsou jeho jediné zakázky → přesné počty
    const { data: view } = await svc.from("job_flow_v").select("id, inquiry_key, pricing_key, order_key").in("id", mine);
    const expected: Record<string, number> = {};
    for (const r of (view ?? []) as Row[]) {
      for (const [ph, col] of [["inquiry", "inquiry_key"], ["pricing", "pricing_key"], ["order", "order_key"]] as const) {
        if (r[col]) expected[`${ph}.${r[col]}`] = (expected[`${ph}.${r[col]}`] ?? 0) + 1;
      }
    }
    const { data: qs } = await svc.from("quotes").select("id, state, job_id, created_by, owner_id, approval_requested_by")
      .or(`job_id.in.(${mine.join(",")}),created_by.eq.${tempId},owner_id.eq.${tempId},approval_requested_by.eq.${tempId}`);
    for (const q of (qs ?? []) as Row[]) expected[`quote.${q.state}`] = (expected[`quote.${q.state}`] ?? 0) + 1;
    const { data: rows } = await svc.rpc("flow_counts", { p_mine: tempId });
    const got: Record<string, number> = {};
    for (const r of (rows ?? []) as { flow_phase: string; flow_key: string; n: number }[]) {
      if (["inquiry", "pricing", "order", "quote"].includes(r.flow_phase)) got[`${r.flow_phase}.${r.flow_key}`] = r.n;
    }
    expect(got).toEqual(expected);
    // p_mine null = výchozí (všichni)
    const all = await svc.rpc("flow_counts", {});
    const allNull = await svc.rpc("flow_counts", { p_mine: null });
    const norm = (d: unknown) => JSON.stringify(((d ?? []) as { flow_phase: string; flow_key: string; n: number }[])
      .map((r) => `${r.flow_phase}.${r.flow_key}=${r.n}`).sort());
    expect(norm(allNull.data)).toBe(norm(all.data));

    // odznaky: neschválená (1), schválená k odeslání (1), vrácená (1); archivní a na uzavřené zakázce se nepočítají
    const badge = async () => ((await svc.rpc("flow_badge_counts", { p_mine: tempId })).data as Row[])[0];
    const before = await badge();
    const pending = await quote(app(tempId), fx.a);
    const ready = await quote(app(tempId), fx.a);
    const returned = await quote(app(tempId), fx.a);
    const archived = await quote(app(tempId), fx.a);
    const closedJob = await job({ owner_id: tempId, status: "dokonceno" });
    const onClosed = await quote(app(tempId), closedJob);
    for (const id of [ready, onClosed]) expect((await admin.from("quotes").update({ approved_by: adminId }).eq("id", id).select("id")).error).toBeNull();
    expect((await admin.from("quotes").update({ approval_returned_at: new Date().toISOString(), approval_return_note: "doplň" }).eq("id", returned).select("id")).error).toBeNull();
    await svc.from("quotes").update({ archived: true }).eq("id", archived);
    const after = await badge();
    expect(Number(after.quotes_pending) - Number(before.quotes_pending)).toBe(1);
    expect(Number(after.quotes_pending_manual) - Number(before.quotes_pending_manual)).toBe(1);
    expect(Number(after.quotes_ready) - Number(before.quotes_ready)).toBe(1);
    expect(Number(after.quotes_returned) - Number(before.quotes_returned)).toBe(1);
    expect(pending).toBeTruthy();
    // poptávky v odznaku = otevřené poptávky „moje“
    const { data: open } = await svc.from("orders").select("id").in("id", await sqlMine(svc, tempId, [...jobs]))
      .in("inquiry_status", ["prijata", "v_reseni", "ceka_na_podklady"]).in("status", ["poptavka", "naceneni"]);
    expect(Number(after.inquiries)).toBe((open ?? []).length);
  }, 90_000);

  // ── 6) Pošta (RLS) ─────────────────────────────────────────
  it("pošta: obchodník čte e-mail své schránky i bez vlastníka, ne dílnu; mailboxes.config ne; deaktivovaný nic", async () => {
    const mine = await email({ mailbox_id: SALES_BOX, owner_id: null });
    const foreign = await email({ mailbox_id: WORKER_BOX, owner_id: workerId });
    const s = await sales.from("emails").select("id").in("id", [mine, foreign]);
    expect(((s.data ?? []) as { id: string }[]).map((r) => r.id)).toEqual([mine]);
    const w = await worker.from("emails").select("id").in("id", [mine, foreign]);
    expect(((w.data ?? []) as { id: string }[]).map((r) => r.id)).toEqual([foreign]);
    // stav schránky: jen vlastní
    const st = await sales.from("mailbox_status").select("mailbox_id");
    expect(((st.data ?? []) as { mailbox_id: string }[]).every((r) => r.mailbox_id === SALES_BOX)).toBe(true);
    // přístupové údaje schránek jen super admin
    const mb = await sales.from("mailboxes").select("id, config");
    expect(mb.data ?? []).toEqual([]);

    const tempBox = boxes[0];
    const own = await email({ mailbox_id: tempBox, owner_id: null });
    expect(((await temp.from("emails").select("id").eq("id", own)).data ?? []).length).toBe(1);
    localSql(`update profiles set active = false where id = '${tempId}'`);
    try {
      expect(((await temp.from("emails").select("id").in("id", [own, mine])).data ?? []).length).toBe(0);
    } finally {
      localSql(`update profiles set active = true where id = '${tempId}'`);
    }
  });

  // ── Pojistky 20261023157000 ────────────────────────────────
  it("(a) dokument přes REST jen ze svého capture/<uid>/ a s cestou, kterou nemá jiný dokument", async () => {
    const jobId = await job({ owner_id: salesId });
    const priceRow = await svc.from("job_files").insert({
      job_id: jobId, kind: "naceneni", issuer: "dodavatel", filename: "nab.pdf", storage_path: `capture/${salesId}/e2e-moje-${TAG}-nab.pdf`,
    }).select("id").single();
    if (priceRow.error) throw new Error(priceRow.error.message);
    // mimo capture/<uid>/
    const outside = await worker.from("job_files").insert({ job_id: jobId, kind: "vykres", filename: "v.pdf", storage_path: `${jobId}/cizi-${TAG}.pdf` }).select("id");
    expect(outside.error?.code).toBe("42501");
    // cizí capture
    const other = await worker.from("job_files").insert({ job_id: jobId, kind: "vykres", filename: "v.pdf", storage_path: `capture/${salesId}/x-${TAG}.pdf` }).select("id");
    expect(other.error?.code).toBe("42501");
    // podvržený „výkres“ na cestu nákupního dokladu
    const twin = await sales.from("job_files").insert({ job_id: jobId, kind: "vykres", filename: "v.pdf", storage_path: `capture/${salesId}/e2e-moje-${TAG}-nab.pdf` }).select("id");
    expect(twin.error?.code).toBe("42501");
    expect(twin.error?.message).toBe("Tento soubor už patří jinému dokumentu.");
    // vlastní nová fotka projde
    const ok = await worker.from("job_files").insert({ job_id: jobId, kind: "foto", filename: "f.jpg", storage_path: `capture/${workerId}/e2e-moje-${TAG}-f.jpg` }).select("id");
    expect(ok.error).toBeNull();
  });

  it("(b) „Schválil“ u zakázky (orders.approved_by/at) zapisuje jen super admin", async () => {
    const jobId = await job({ owner_id: salesId });
    const s = await sales.from("orders").update({ approved_by: salesId, approved_at: new Date().toISOString() }).eq("id", jobId).select("id");
    expect(s.error?.code).toBe("42501");
    expect(s.error?.message).toBe("Schválení nabídky u zakázky zapisuje jen super admin.");
    expect((await worker.from("orders").update({ approved_at: "2026-01-01T00:00:00Z" }).eq("id", jobId).select("id")).error?.code).toBe("42501");
    expect((await app(salesId).from("orders").update({ approved_by: adminId }).eq("id", jobId).select("id")).error?.code).toBe("42501");
    // jiné sloupce dál smí
    expect((await sales.from("orders").update({ assignee_id: workerId }).eq("id", jobId).select("id")).error).toBeNull();
    // super admin (REST i server s autorem) smí
    expect((await admin.from("orders").update({ approved_by: adminId, approved_at: new Date().toISOString() }).eq("id", jobId).select("id")).error).toBeNull();
    expect((await app(adminId).from("orders").update({ approved_by: null, approved_at: null }).eq("id", jobId).select("id")).error).toBeNull();
    // založení zakázky ne-adminem s „Schválil“ → vynulováno
    k += 1;
    const ins = await app(salesId).from("orders").insert({
      number: `${PREFIX}-M${k}`, title: "E2E moje", source: "manual", status: "poptavka", owner_id: salesId,
      approved_by: adminId, approved_at: new Date().toISOString(),
    }).select("id, approved_by, approved_at").single();
    expect(ins.error).toBeNull();
    jobs.push((ins.data as { id: string }).id);
    expect(ins.data).toMatchObject({ approved_by: null, approved_at: null });
  });

  it("(c) odmítnutí vlastního řádku fronty přes REST: čas vyřízení dává DB (nejde antedatovat)", async () => {
    const { data, error } = await svc.from("approval_queue").insert({
      type: "email_reply", title: `E2E moje ${TAG}`, payload: {}, owner_id: salesId,
    }).select("id").single();
    if (error) throw new Error(error.message);
    const row = (data as { id: string }).id;
    queueRows.push(row);
    const started = Date.now();
    const up = await sales.from("approval_queue").update({ status: "rejected", resolved_at: "2001-01-01T00:00:00Z" }).eq("id", row).select("id");
    expect(up.error).toBeNull();
    const { data: after } = await svc.from("approval_queue").select("status, resolved_at, resolved_by").eq("id", row).single();
    expect(after).toMatchObject({ status: "rejected", resolved_by: salesId });
    expect(Date.parse(String((after as Row).resolved_at))).toBeGreaterThan(started - 60_000);
    // bez změny stavu čas vyřízení zůstane
    await sales.from("approval_queue").update({ resolved_at: "2001-01-01T00:00:00Z" }).eq("id", row);
    const { data: kept } = await svc.from("approval_queue").select("resolved_at").eq("id", row).single();
    expect((kept as Row).resolved_at).toBe((after as Row).resolved_at);
  });

  it("(d) úložiště: PDF neschválené / před schválením vzniklé naší nabídky přes REST jen super admin; cizí cestu nejde ověřit", async () => {
    const jobId = await job({ owner_id: salesId });
    const qid = await quote(app(salesId), jobId);
    expect(await svc.from("quotes").select("state, admin_approval_required").eq("id", qid).single().then((r) => r.data))
      .toMatchObject({ state: "ke_schvaleni", admin_approval_required: true });
    const pdf = async (name: string): Promise<string> => {
      const p = `zakazky/${jobId}/e2e-moje-${TAG}-${name}.pdf`;
      const up = await svc.storage.from("job-files").upload(p, Buffer.from("%PDF-1.4 e2e"), { contentType: "application/pdf" });
      if (up.error) throw new Error(up.error.message);
      stored.push(p);
      const ins = await svc.from("job_files").insert({
        job_id: jobId, kind: "nabidka", issuer: "my", origin: "generated", quote_id: qid, filename: `${name}.pdf`, storage_path: p,
      }).select("id");
      if (ins.error) throw new Error(ins.error.message);
      return p;
    };
    const read = async (db: SupabaseClient, p: string) => (await db.storage.from("job-files").download(p)).error === null;
    const before = await pdf("neschvalena");
    expect(await read(sales, before)).toBe(false);
    expect(await read(worker, before)).toBe(false);
    expect(await read(admin, before)).toBe(true);
    // schválení: PDF vzniklé před ním zůstane zamčené, nové projde
    expect((await admin.from("quotes").update({ approved_by: adminId }).eq("id", qid).select("id")).error).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    const after = await pdf("schvalena");
    expect(await read(sales, before)).toBe(false);
    expect(await read(sales, after)).toBe(true);
    expect(await read(worker, after)).toBe(true);
    expect(await read(admin, before)).toBe(true);
    // cizí cestu přihlášený neověří (jen vlastní capture/<uid>/), server ano
    expect((await worker.rpc("job_file_path_in_use", { p_path: after })).data).toBe(false);
    expect((await svc.rpc("job_file_path_in_use", { p_path: after })).data).toBe(true);
  });

  it("(e) obchodník nové zakázky: ne-admin jen sebe / nikoho / obchodníka zákazníka; obchodníka zákazníka mění jen super admin", async () => {
    const cust = async (owner: string | null, db: SupabaseClient = svc) => {
      k += 1;
      const r = await db.from("customers").insert({ name: `E2E moje ${TAG} zákazník ${k}`, owner_id: owner }).select("id").single();
      if (!r.error) custs.push((r.data as { id: string }).id);
      return r;
    };
    const adminCust = ((await cust(adminId)).data as { id: string }).id;
    const order = async (db: SupabaseClient, patch: Row) => {
      k += 1;
      const r = await db.from("orders").insert({ number: `${PREFIX}-M${k}`, title: "E2E moje", source: "manual", status: "poptavka", ...patch }).select("id").single();
      if (!r.error) jobs.push((r.data as { id: string }).id);
      return r;
    };
    // REST i server s autorem: cizí obchodník → 42501
    const foreign = await order(sales, { owner_id: adminId });
    expect(foreign.error?.code).toBe("42501");
    expect(foreign.error?.message).toBe("Obchodníka zakázky mění jen super admin.");
    expect((await order(app(workerId), { owner_id: salesId })).error?.code).toBe("42501");
    // obchodník zákazníka, sám sebe, nikdo → ok; super admin cokoli
    expect((await order(sales, { owner_id: adminId, customer_id: adminCust })).error).toBeNull();
    expect((await order(app(workerId), { owner_id: adminId, customer_id: adminCust })).error).toBeNull();
    expect((await order(sales, { owner_id: salesId })).error).toBeNull();
    expect((await order(worker, { owner_id: null })).error).toBeNull();
    expect((await order(admin, { owner_id: salesId })).error).toBeNull();
    expect((await order(app(adminId), { owner_id: workerId })).error).toBeNull();

    // obchodník zákazníka: ne-admin ho nezmění (REST ani server s autorem), ostatní údaje ano
    const up = await sales.from("customers").update({ owner_id: salesId }).eq("id", adminCust).select("id");
    expect(up.error?.code).toBe("42501");
    expect(up.error?.message).toBe("Obchodníka zákazníka mění jen super admin.");
    expect((await app(salesId).from("customers").update({ owner_id: salesId }).eq("id", adminCust).select("id")).error?.code).toBe("42501");
    expect((await sales.from("customers").update({ note: "E2E pozn." }).eq("id", adminCust).select("id")).error).toBeNull();
    // REST založí jen se sebou / bez obchodníka
    expect((await cust(adminId, sales)).error?.code).toBe("42501");
    expect((await cust(salesId, sales)).error).toBeNull();
    expect((await cust(null, worker)).error).toBeNull();
    // super admin smí
    expect((await admin.from("customers").update({ owner_id: salesId }).eq("id", adminCust).select("id")).error).toBeNull();
    expect((await svc.from("customers").select("owner_id").eq("id", adminCust).single()).data).toMatchObject({ owner_id: salesId });
  });

  it("(f) odznak „Nabídky“: k odeslání jen co viewer smí odeslat (TS quoteSendBlock); vrácené jen vlastní", async () => {
    const { quoteSendBlock } = await import("@/lib/jobs/flow-status");
    const badgeOf = async (u: string) => ((await svc.rpc("flow_badge_counts", { p_mine: u })).data as Row[])[0];
    const diff = (a: Row, b: Row, key: string) => Number(a[key]) - Number(b[key]);
    // zakázka obchodníka, kterou založil zaměstnanec → „moje" obou
    const jobId = await job({ owner_id: salesId, created_by: workerId });
    const w0 = await badgeOf(workerId);
    const s0 = await badgeOf(salesId);
    const bySales = await quote(app(salesId), jobId);
    const byWorker = await quote(app(workerId), jobId);
    const returned = await quote(app(salesId), jobId);
    for (const qid of [bySales, byWorker]) {
      expect((await admin.from("quotes").update({ approved_by: adminId }).eq("id", qid).select("id")).error).toBeNull();
    }
    expect((await admin.from("quotes").update({ approval_returned_at: new Date().toISOString(), approval_return_note: "doplň" }).eq("id", returned).select("id")).error).toBeNull();
    const w1 = await badgeOf(workerId);
    const s1 = await badgeOf(salesId);
    // zaměstnanec odešle jen svou schválenou; obchodník (nákupní ceny) obě
    expect(diff(w1, w0, "quotes_ready")).toBe(1);
    expect(diff(s1, s0, "quotes_ready")).toBe(2);
    // vrácenou opraví autor → jen jeho odznak
    expect(diff(w1, w0, "quotes_returned")).toBe(0);
    expect(diff(s1, s0, "quotes_returned")).toBe(1);
    // TS dvojče: stejné nabídky podle quoteSendBlock pro zaměstnance
    const workerCan = (f: string) => ["orders", "workflow", "documents"].includes(f);
    const { data: rows } = await svc.from("quotes").select("id, state, archived, created_by, admin_approval_required, approval_required, approved_by, sent_at")
      .in("id", [bySales, byWorker]);
    const sendable = ((rows ?? []) as Row[]).filter((r) => quoteSendBlock({
      state: r.state as never, archived: Boolean(r.archived), createdBy: r.created_by as string,
      adminApprovalRequired: r.admin_approval_required === true, approvalRequired: r.approval_required === true,
      approvedBy: r.approved_by as string | null, sentAt: r.sent_at as string | null,
    }, { can: workerCan as never, userId: workerId, jobOwnerId: salesId, jobAssigneeId: null }) === null);
    expect(sendable.map((r) => r.id)).toEqual([byWorker]);
    // Zpracovává: zaměstnanec pak smí odeslat i schválenou nabídku obchodníka
    await svc.from("orders").update({ assignee_id: workerId }).eq("id", jobId);
    expect(diff(await badgeOf(workerId), w0, "quotes_ready")).toBe(2);
  });
});
