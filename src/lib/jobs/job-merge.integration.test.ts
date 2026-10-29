import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { LOCAL_ENABLED, DEMO, localAdmin, localSession, localSql, profileId } from "@/test/local-supabase";
import { userActor } from "@/lib/supabase/actor-headers";
import type { JobsDb } from "@/lib/jobs/events";
import { mergeJobsCore, previewJobMergeCore, resolveMergeTarget, searchMergeCandidatesCore } from "@/lib/jobs/job-merge-store";

/**
 * Sloučení zakázek (#24) proti lokálnímu Supabase (PostgREST + skutečné triggery):
 * reprodukce Z-2026-013 (objednávka zákazníka 8000060875 / GPO84339 + výkres F00N603W84 + STEP
 * EM72231CJ0000 + fotka) × Z-2026-014 (jen naše odeslaná nabídka 136/026) → jedna zakázka se vším,
 * stav konzistentní (objednávka s přijatou nabídkou), historie obou, provize přepočtené,
 * idempotentní opakování, odmítnutí (oprávnění, IČO, uzavřená, vyplacená provize, objednávky dodavatelům).
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/jobs/job-merge.integration.test.ts
 */

const TAG = Date.now().toString(36);
const PREFIX = `Z-E2E-MERGE-${TAG}`;

type Row = Record<string, unknown>;

describe.skipIf(!LOCAL_ENABLED)("sloučení zakázek ↔ lokální Supabase", () => {
  let svc: SupabaseClient;
  let sales = "";
  let admin = "";
  let worker = "";
  const jobs: string[] = [];
  const customers: string[] = [];
  const suppliers: string[] = [];
  let n = 0;
  const as = (id: string) => localAdmin(userActor({ id })) as unknown as JobsDb;

  async function customer(name: string, ico: string | null): Promise<string> {
    const { data, error } = await svc.from("customers").insert({ name: `${name} ${TAG}`, ico }).select("id").single();
    if (error) throw new Error(error.message);
    customers.push((data as { id: string }).id);
    return (data as { id: string }).id;
  }

  async function newJob(patch: Row): Promise<{ id: string; number: string }> {
    n += 1;
    const number = `${PREFIX}-${String(n).padStart(3, "0")}`;
    const { data, error } = await svc.from("orders").insert({
      number, title: `Sloučení ${n}`, source: "foto", status: "poptavka", owner_id: sales, created_by: sales, ...patch,
    }).select("id").single();
    if (error) throw new Error(error.message);
    jobs.push((data as { id: string }).id);
    return { id: (data as { id: string }).id, number };
  }

  async function file(jobId: string, kind: string, filename: string, issuer: string | null, sha: string): Promise<string> {
    const { data, error } = await svc.from("job_files").insert({
      job_id: jobId, kind, filename, title: filename, storage_path: `e2e-merge/${TAG}/${randomUUID()}/${filename}`,
      origin: "capture", issuer, content_sha256: sha, mime_type: filename.endsWith(".pdf") ? "application/pdf" : "application/octet-stream",
    }).select("id").single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  }

  async function job(id: string): Promise<Row> {
    const { data } = await svc.from("orders").select("*").eq("id", id).single();
    return data as Row;
  }

  async function count(table: string, column: string, id: string): Promise<number> {
    const { count: c } = await svc.from(table).select("id", { count: "exact", head: true }).eq(column, id);
    return c ?? 0;
  }

  /** Z-013 (objednávka + výkres + model + fotka) a Z-014 (naše odeslaná nabídka). `pdfOnly` = nabídka
   *  jen jako PDF bez záznamu nabídky (nejčastější tvar ze staré dávky); `sameIco` = zákazník zapsaný
   *  dvakrát (jiný záznam, stejné IČO). */
  async function fixture(opts: { sourceIco?: string | null; sameCustomer?: boolean; pdfOnly?: boolean; sameIco?: boolean } = {}) {
    const cust = await customer("Bosch Termotechnika", "26345323");
    const cust2 = opts.sameCustomer === false ? await customer("Jiný zákazník", opts.sourceIco ?? "12345678")
      : opts.sameIco ? await customer("BOSCH s.r.o.", "26345323") : cust;
    const order = await newJob({
      status: "objednavka", customer_id: cust, customer_order_number: "8000060875", customer_inquiry_number: "GPO84339",
      order_date: "2026-10-20", customer_required_date: "2026-12-04", value: 48_000, title: "F00N603W84 — objednávka",
    });
    const quoteJob = await newJob({
      status: "poptavka", customer_id: cust2, inquiry_date: "2026-10-01", title: "F00N603W84 — nabídka", note: "Termín z nabídky 6 týdnů.",
      due_date: "2026-12-11", customer_contact: "Ing. Novák",
    });
    // položky: objednávka 40 ks; nabídka stejný výkres jinak zapsaný (mezery) 50 ks s cenou + druhý díl
    const { error: e1 } = await svc.from("order_items").insert([
      { order_id: order.id, position: 0, drawing_number: "F00N603W84", name: "Těleso", quantity: 40, unit: "ks" },
      { order_id: quoteJob.id, position: 0, drawing_number: "F00N 603 W84", name: "Těleso", quantity: 50, unit: "ks", unit_price: 1200, material: "1.4301" },
      { order_id: quoteJob.id, position: 1, drawing_number: "EM72231CJ0000", name: "Víko", quantity: 50, unit: "ks", unit_price: 300 },
    ]);
    if (e1) throw new Error(e1.message);
    await file(order.id, "objednavka", "8000060875.pdf", "zakaznik", `sha-obj-${TAG}-${n}`);
    await file(order.id, "vykres", "F00N603W84.pdf", "zakaznik", `sha-drw-${TAG}-${n}`);
    await file(order.id, "model_3d", "EM72231CJ0000.step", "zakaznik", `sha-stp-${TAG}-${n}`);
    await file(order.id, "foto", "foto.jpg", null, `sha-foto-${TAG}-${n}`);
    const quoteFile = await file(quoteJob.id, "nabidka", "136-026.pdf", "my", `sha-nab-${TAG}-${n}`);
    await file(quoteJob.id, "vykres", "F00N603W84.pdf", "zakaznik", `sha-drw-${TAG}-${n}`);   // stejný výkres v obou dávkách
    if (opts.pdfOnly) {
      await svc.from("job_files").update({ title: "Nabídka 136/026", ai_extracted: { documentNumber: "136/026" } }).eq("id", quoteFile);
      await svc.from("orders").update({ status: "nabidka" }).eq("id", quoteJob.id);
      return { order, quoteJob, quoteId: null as string | null, quoteState: null as string | null, emailId: null as string | null, cust };
    }
    const { data: q, error: qe } = await svc.from("quotes").insert({
      number: `136/026-${TAG}-${n}`, customer_id: cust2, status: "odeslano", job_id: quoteJob.id, total: 75_000, title: "Nabídka 136/026",
      owner_id: sales, lead_time_days: 42,
    }).select("id, state").single();
    if (qe) throw new Error(qe.message);
    await svc.from("job_files").update({ quote_id: (q as { id: string }).id }).eq("id", quoteFile);
    // naposled ji upravil obchodník (přesun nesmí „kdo upravil" vymazat)
    await svc.from("quotes").update({ updated_by: sales }).eq("id", (q as { id: string }).id);
    const { data: em, error: ee } = await svc.from("emails").insert({
      subject: `Nabídka 136/026 ${TAG}`, from_email: "nabidky@mnastrojarna.cz", direction: "out", order_id: quoteJob.id, received_at: new Date().toISOString(),
    }).select("id").single();
    if (ee) throw new Error(ee.message);
    await svc.from("job_events").insert({ job_id: quoteJob.id, type: "comment", message: "Zákazník chce kalení", actor_id: sales });
    return { order, quoteJob, quoteId: (q as { id: string; state: string }).id as string | null, quoteState: (q as { state: string }).state as string | null, emailId: (em as { id: string }).id as string | null, cust };
  }

  async function merged(target: string, source: string, actor = sales) {
    const res = await mergeJobsCore(as(actor), { targetId: target, sourceId: source, token: randomUUID() });
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    if (!res.ok) throw new Error(res.error);
    return res.result;
  }

  beforeAll(async () => {
    svc = localAdmin();
    [sales, admin, worker] = await Promise.all([profileId(svc, DEMO.sales.email), profileId(svc, DEMO.admin.email), profileId(svc, DEMO.worker.email)]);
  }, 60_000);

  afterAll(async () => {
    if (!svc) return;
    if (jobs.length) {
      await svc.from("job_merges").delete().in("target_id", jobs);
      await svc.from("job_merges").delete().in("source_id", jobs);
      await svc.from("orders").update({ merged_into_id: null }).in("id", jobs);
      await svc.from("job_files").delete().in("job_id", jobs);
      await svc.from("emails").delete().in("order_id", jobs);
      await svc.from("quotes").delete().in("job_id", jobs);
      await svc.from("purchase_orders").delete().in("job_id", jobs);
      await svc.from("commission_entries").delete().in("order_id", jobs);
      await svc.from("orders").delete().in("id", jobs);
      await svc.from("audit_log").delete().in("entity_id", jobs);
      await svc.from("audit_log").delete().in("diff->>jobId", jobs);
    }
    if (suppliers.length) await svc.from("suppliers").delete().in("id", suppliers);
    if (customers.length) await svc.from("customers").delete().in("id", customers);
  }, 120_000);

  it("Z-013 × Z-014: náhled ukáže, co se přesune, co vyhraje a že se nabídka přijme", async () => {
    const f = await fixture();
    expect(f.quoteState).toBe("odeslana");
    expect((await job(f.quoteJob.id)).status).toBe("nabidka");      // odeslaná nabídka posunula poptávku
    const res = await previewJobMergeCore(as(sales), f.order.id, f.quoteJob.id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const p = res.preview;
    expect(p).toMatchObject({ ok: true, needsForce: false, canForce: false, stage: { from: "objednavka", to: "objednavka", source: "nabidka" } });
    expect(p.acceptQuote?.id).toBe(f.quoteId);
    expect(p.counts).toMatchObject({ items: 1, itemsMerged: 1, files: 2, filesDuplicate: 1, quotes: 1, emails: 1 });
    const byField = Object.fromEntries(p.fields.map((x) => [x.field, x]));
    expect(byField.note).toMatchObject({ rule: "fill", result: "Termín z nabídky 6 týdnů." });
    expect(byField.due_date).toMatchObject({ rule: "fill", result: "11. 12. 2026" });
    expect(byField.customer_contact).toMatchObject({ rule: "fill" });
    expect(byField.inquiry_date).toMatchObject({ rule: "fill" });
    expect(byField.customer_order_number).toBeUndefined();          // jen u cíle → beze změny
    expect(p.conflicts.filter((c) => c.level === "block")).toEqual([]);
  }, 60_000);

  it("sloučí vše do jedné zakázky, stav a provize sedí, historie u obou, opakování je idempotentní", async () => {
    const f = await fixture();
    const before = await job(f.order.id);
    const token = randomUUID();
    const res = await mergeJobsCore(as(sales), { targetId: f.order.id, sourceId: f.quoteJob.id, token });
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    if (!res.ok) return;
    expect(res.result).toMatchObject({ targetNumber: f.order.number, sourceNumber: f.quoteJob.number, replayed: false, forced: false });
    expect(res.result.acceptedQuote?.id).toBe(f.quoteId);

    // cíl: vše tady
    const t = await job(f.order.id);
    expect(t).toMatchObject({
      status: "objednavka", order_status: "dorucena", customer_order_number: "8000060875", customer_inquiry_number: "GPO84339",
      customer_required_date: "2026-12-04", due_date: "2026-12-11", inquiry_date: "2026-10-01", note: "Termín z nabídky 6 týdnů.",
      customer_contact: "Ing. Novák", quote_id: f.quoteId, merged_into_id: null, items_count: 2,
    });
    expect(Number(t.value)).toBe(48_000);                            // vyhrává cíl (objednávka)
    expect(t.updated_by).toBe(sales);
    const { data: q } = await svc.from("quotes").select("job_id, status, state, accepted_by, updated_by").eq("id", f.quoteId).single();
    expect(q).toMatchObject({ job_id: f.order.id, status: "prijato", state: "prijata", accepted_by: sales, updated_by: sales });
    const { data: items } = await svc.from("order_items").select("drawing_number, quantity, unit_price, material, position").eq("order_id", f.order.id).order("position");
    expect(items).toHaveLength(2);
    expect(items?.[0]).toMatchObject({ drawing_number: "F00N603W84", material: "1.4301" });
    expect(Number(items?.[0].quantity)).toBe(40);                    // objednávka vyhrává počet kusů
    expect(Number(items?.[0].unit_price)).toBe(1200);                // cena doplněná z nabídky
    expect(items?.[1]).toMatchObject({ drawing_number: "EM72231CJ0000", position: 1 });
    const { data: files } = await svc.from("job_files").select("kind, filename, archived, replaced_by").eq("job_id", f.order.id);
    expect(files).toHaveLength(6);
    expect((files ?? []).filter((x) => !x.archived).map((x) => x.kind).sort()).toEqual(["foto", "model_3d", "nabidka", "objednavka", "vykres"]);
    expect((files ?? []).filter((x) => x.archived)).toHaveLength(1);  // stejný výkres = archivovaná kopie
    expect(await count("emails", "order_id", f.order.id)).toBe(1);
    expect(await count("job_files", "job_id", f.quoteJob.id)).toBe(0);
    expect(await count("quotes", "job_id", f.quoteJob.id)).toBe(0);

    // zdroj: uzavřený jako duplicitní, odkaz na cíl
    const s = await job(f.quoteJob.id);
    expect(s).toMatchObject({ status: "zruseno", lost_reason: "duplicita", merged_into_id: f.order.id, merged_by: sales, quote_id: null });
    expect(String(s.lost_note)).toContain(f.order.number);
    // sloučená duplicita není „odmítnutá poptávka“ ani „stornovaná objednávka“ (přehledy a počty toku)
    expect(s).toMatchObject({ inquiry_status: null, order_status: null });
    expect(await resolveMergeTarget(as(sales), f.quoteJob.id)).toEqual({ id: f.order.id, number: f.order.number });

    // historie: událost na obou, přesunuté záznamy s odkazem odkud
    const { data: tev } = await svc.from("job_events").select("type, message, data, actor_id, actor_name").eq("job_id", f.order.id).order("created_at");
    const merged = (tev ?? []).filter((e) => (e.message as string).startsWith("Sloučeno ze zakázky"));
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ actor_id: sales, actor_name: "Petr Obchodník" });
    expect(merged[0].message).toContain(`Sloučeno ze zakázky ${f.quoteJob.number} (Petr Obchodník)`);
    expect((tev ?? []).find((e) => e.message === "Zákazník chce kalení")?.data).toMatchObject({ mergedFrom: { number: f.quoteJob.number } });
    expect((tev ?? []).some((e) => e.type === "quote" && /Odeslaná → Přijatá/.test(e.message as string))).toBe(true);
    // přesunuté záznamy zakázky / poptávky / objednávky ukazují na cíl (ne na zdroj)
    const { data: stale } = await svc.from("job_events").select("id").eq("job_id", f.order.id).in("entity", ["job", "inquiry", "order"]).eq("entity_id", f.quoteJob.id);
    expect(stale).toEqual([]);
    const { data: sev } = await svc.from("job_events").select("type, message").eq("job_id", f.quoteJob.id);
    expect((sev ?? []).some((e) => (e.message as string).startsWith(`Sloučeno do zakázky ${f.order.number} (Petr Obchodník)`))).toBe(true);
    expect((sev ?? []).some((e) => e.type === "stage" && /Zrušeno/.test(e.message as string) && /sloučeno do zakázky/.test(e.message as string))).toBe(true);

    // provize: cíl přepočtený (hodnota objednávky), zdroj žádnou nemá
    const { data: ce } = await svc.from("commission_entries").select("order_id, revenue, status").in("order_id", [f.order.id, f.quoteJob.id]);
    expect((ce ?? []).map((x) => x.order_id)).toEqual([f.order.id]);
    expect(Number(ce?.[0].revenue)).toBe(48_000);

    // audit
    const { data: audit } = await svc.from("audit_log").select("action, actor_id").eq("entity_id", f.order.id).eq("action", "job_merged");
    expect(audit).toEqual([{ action: "job_merged", actor_id: sales }]);

    // opakování: stejný token i nový token → výsledek prvního, nic dalšího
    const again = await mergeJobsCore(as(sales), { targetId: f.order.id, sourceId: f.quoteJob.id, token });
    expect(again.ok && again.result.replayed).toBe(true);
    const third = await mergeJobsCore(as(sales), { targetId: f.order.id, sourceId: f.quoteJob.id, token: randomUUID() });
    expect(third.ok && third.result.replayed).toBe(true);
    const { data: tev2 } = await svc.from("job_events").select("id").eq("job_id", f.order.id);
    expect(tev2).toHaveLength((tev ?? []).length);
    expect(before.number).toBe(t.number);
    // sloučená zakázka už není mezi kandidáty
    const cands = await searchMergeCandidatesCore(as(sales), f.order.id, PREFIX);
    expect(cands.some((c) => c.id === f.quoteJob.id)).toBe(false);
  }, 60_000);

  it("opačný směr (cíl = nabídka): objednávka zákazníka a stav přejdou s ní, počty kusů z objednávky", async () => {
    const f = await fixture();
    // náhled: částky česky, název zakázky mezi hodnotami (vyhrává cíl)
    const pv = await previewJobMergeCore(as(admin), f.quoteJob.id, f.order.id);
    const pf = pv.ok ? Object.fromEntries(pv.preview.fields.map((x) => [x.field, x])) : {};
    expect(pf.value?.result).toMatch(/^48\s000 Kč$/);
    expect(pf.title).toMatchObject({ rule: "keep", source: "F00N603W84 — objednávka", result: "F00N603W84 — nabídka" });
    expect(pv.ok && pv.preview.conflicts.some((c) => c.code === "STAGE_ADVANCE")).toBe(true);
    const res = await mergeJobsCore(as(admin), { targetId: f.quoteJob.id, sourceId: f.order.id, token: randomUUID() });
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    const t = await job(f.quoteJob.id);
    expect(t).toMatchObject({ status: "objednavka", order_status: "dorucena", order_revision: 1, customer_order_number: "8000060875", quote_id: f.quoteId });
    expect(String(t.stage_change_note ?? "")).toContain(`sloučením se zakázkou ${f.order.number}`);
    const { data: q } = await svc.from("quotes").select("status").eq("id", f.quoteId).single();
    expect(q).toMatchObject({ status: "prijato" });
    const { data: rev } = await svc.from("job_order_revisions").select("revision, customer_order_number").eq("job_id", f.quoteJob.id);
    expect(rev).toEqual([{ revision: 1, customer_order_number: "8000060875" }]);
    const { data: items } = await svc.from("order_items").select("drawing_number, quantity, unit_price").eq("order_id", f.quoteJob.id).order("position");
    expect(Number(items?.[0].quantity)).toBe(40);
    expect(Number(items?.[0].unit_price)).toBe(1200);
    const { data: ce } = await svc.from("commission_entries").select("order_id").in("order_id", [f.order.id, f.quoteJob.id]);
    expect((ce ?? []).map((x) => x.order_id)).toEqual([f.quoteJob.id]);
  }, 60_000);

  it("odmítne: stejnou zakázku, zaměstnance, cizí zakázky obchodníka, uzavřenou, vyplacenou provizi", async () => {
    const f = await fixture();
    const same = await mergeJobsCore(as(admin), { targetId: f.order.id, sourceId: f.order.id, token: randomUUID() });
    expect(same).toMatchObject({ ok: false, code: "SAME_JOB" });

    const w = await mergeJobsCore(as(worker), { targetId: f.order.id, sourceId: f.quoteJob.id, token: randomUUID() });
    expect(w).toMatchObject({ ok: false, code: "FORBIDDEN" });

    const foreign = await newJob({ status: "nabidka", owner_id: admin, created_by: admin, customer_id: f.cust });
    const s1 = await mergeJobsCore(as(sales), { targetId: f.order.id, sourceId: foreign.id, token: randomUUID() });
    expect(s1).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(s1.ok ? "" : s1.error).toMatch(/své zakázky/);

    const closed = await newJob({ status: "nerealizovano", customer_id: f.cust, lost_reason: "cena" });
    const c1 = await mergeJobsCore(as(admin), { targetId: f.order.id, sourceId: closed.id, token: randomUUID() });
    expect(c1).toMatchObject({ ok: false, code: "CLOSED" });

    const { data: paidRows } = await svc.from("commission_entries").update({ status: "vyplaceno", cost_known: true }).eq("order_id", f.order.id).select("status");
    expect(paidRows).toEqual([{ status: "vyplaceno" }]);
    const paid = await mergeJobsCore(as(admin), { targetId: f.order.id, sourceId: f.quoteJob.id, token: randomUUID() });
    expect(paid).toMatchObject({ ok: false, code: "COMMISSION_PAID" });
    await svc.from("commission_entries").update({ status: "predbezna" }).eq("order_id", f.order.id);

    // nic se nepřesunulo
    expect(await count("quotes", "job_id", f.quoteJob.id)).toBe(1);
    expect((await job(f.quoteJob.id)).merged_into_id).toBeNull();
    expect(await count("job_merges", "source_id", f.quoteJob.id)).toBe(0);
  }, 60_000);

  it("různé IČO a odeslané objednávky u různých dodavatelů: jen super admin s důvodem", async () => {
    const f = await fixture({ sameCustomer: false, sourceIco: "12345678" });
    const pv = await previewJobMergeCore(as(sales), f.order.id, f.quoteJob.id);
    expect(pv.ok && pv.preview.needsForce).toBe(true);
    expect(pv.ok && pv.preview.conflicts.some((c) => c.code === "CUSTOMER_DIFFERENT" && c.level === "force")).toBe(true);
    const sales1 = await mergeJobsCore(as(sales), { targetId: f.order.id, sourceId: f.quoteJob.id, token: randomUUID(), force: true, reason: "chci" });
    expect(sales1).toMatchObject({ ok: false, code: "NEEDS_FORCE" });

    // odeslané objednávky u dvou různých dodavatelů → konflikt k nahlášení
    const { data: sup } = await svc.from("suppliers").insert([{ name: `Kalírna ${TAG}` }, { name: `Frézárna ${TAG}` }]).select("id");
    const [s1, s2] = ((sup ?? []) as { id: string }[]).map((x) => x.id);
    suppliers.push(s1, s2);
    const { error: poErr } = await svc.from("purchase_orders").insert([
      { job_id: f.order.id, number: `OV-MERGE-${TAG}-1`, supplier_id: s1, status: "odeslana", total: 1000 },
      { job_id: f.quoteJob.id, number: `OV-MERGE-${TAG}-2`, supplier_id: s2, status: "odeslana", total: 900 },
    ]);
    expect(poErr).toBeNull();
    const pv2 = await previewJobMergeCore(as(admin), f.order.id, f.quoteJob.id);
    const po = pv2.ok ? pv2.preview.conflicts.find((c) => c.code === "PO_SUPPLIER_CONFLICT") : undefined;
    expect(po?.level).toBe("force");
    expect(po?.purchaseOrders).toEqual([`OV-MERGE-${TAG}-1`, `OV-MERGE-${TAG}-2`]);
    expect(pv2.ok && pv2.preview.canForce).toBe(true);

    const noReason = await mergeJobsCore(as(admin), { targetId: f.order.id, sourceId: f.quoteJob.id, token: randomUUID(), force: true });
    expect(noReason).toMatchObject({ ok: false, code: "VALIDATION" });
    const ok = await mergeJobsCore(as(admin), {
      targetId: f.order.id, sourceId: f.quoteJob.id, token: randomUUID(), force: true, reason: "Stejná firma, druhé IČO je pobočka",
    });
    expect(ok.ok, ok.ok ? "" : ok.error).toBe(true);
    if (!ok.ok) return;
    expect(ok.result.forced).toBe(true);
    expect((await job(f.order.id)).customer_id).toBe(f.cust);         // zákazník cíle zůstává
    expect(await count("purchase_orders", "job_id", f.order.id)).toBe(2);
    const { data: ev } = await svc.from("job_events").select("message").eq("job_id", f.order.id).like("message", "Sloučeno ze zakázky%");
    expect(ev?.[0].message).toContain("důvod: Stejná firma");
  }, 60_000);

  it("po sloučení: zápis na zdroj skončí u cíle, zdroj nejde upravit ani znovu otevřít", async () => {
    const f = await fixture();
    await merged(f.order.id, f.quoteJob.id);
    // pozdní zápisy (otevřená karta, focení, pošta) míří na zdroj → přesměrují se na cíl
    const { data: late, error: lateErr } = await as(sales).from("order_items")
      .insert({ order_id: f.quoteJob.id, position: 9, drawing_number: "LATE-WRITE", quantity: 1, unit: "ks" }).select("order_id").single();
    expect(lateErr).toBeNull();
    expect(late?.order_id).toBe(f.order.id);
    const lateFile = await file(f.quoteJob.id, "foto", "late.jpg", null, `sha-late-${TAG}`);
    const { data: lf } = await svc.from("job_files").select("job_id").eq("id", lateFile).single();
    expect(lf?.job_id).toBe(f.order.id);
    const { data: le } = await as(sales).from("emails").insert({
      subject: `Pozdní ${TAG}`, from_email: "x@bosch.test", direction: "in", order_id: f.quoteJob.id, received_at: new Date().toISOString(),
    }).select("order_id").single();
    expect(le?.order_id).toBe(f.order.id);
    await svc.from("emails").delete().eq("subject", `Pozdní ${TAG}`);
    const { data: lc } = await as(sales).from("job_events").insert({ job_id: f.quoteJob.id, type: "comment", message: "pozdní komentář" }).select("job_id").single();
    expect(lc?.job_id).toBe(f.order.id);
    // zdroj: úpravy i znovuotevření odmítne (aplikace i REST), zůstane Zrušeno
    const reopen = await as(admin).from("orders").update({ status: "objednavka" }).eq("id", f.quoteJob.id);
    expect(reopen.error?.message ?? "").toMatch(/sloučen/);
    const edit = await as(sales).from("orders").update({ note: "z otevřené karty" }).eq("id", f.quoteJob.id);
    expect(edit.error?.message ?? "").toMatch(/sloučen/);
    const sess = await localSession(DEMO.admin.email, DEMO.admin.password);
    const viaRest = await sess.from("orders").update({ status: "poptavka" }).eq("id", f.quoteJob.id);
    expect(viaRest.error?.message ?? "").toMatch(/sloučen/);
    expect(await job(f.quoteJob.id)).toMatchObject({ status: "zruseno", merged_into_id: f.order.id });
    // zaměstnanec (REST) nevloží zakázku rovnou jako „sloučenou“
    const w = await localSession(DEMO.worker.email, DEMO.worker.password);
    const ins = await w.from("orders").insert({ number: `${PREFIX}-INS`, title: "vložená", merged_into_id: f.order.id, merged_at: new Date().toISOString() }).select("id").maybeSingle();
    const { data: insRow } = await svc.from("orders").select("id, merged_into_id, merged_at").eq("number", `${PREFIX}-INS`).maybeSingle();
    if (insRow) jobs.push((insRow as { id: string }).id);
    if (!ins.error) expect(insRow).toMatchObject({ merged_into_id: null, merged_at: null });
    // zaměstnanec nevidí záznamy sloučení (čísla objednávek dodavatelům ve výsledku)
    const { data: wm } = await w.from("job_merges").select("id").eq("source_id", f.quoteJob.id);
    expect(wm ?? []).toEqual([]);
    const s2 = await localSession(DEMO.sales.email, DEMO.sales.password);
    const { data: sm } = await s2.from("job_merges").select("id").eq("source_id", f.quoteJob.id);
    expect(sm).toHaveLength(1);
  }, 90_000);

  it("obchodník nesloučí zakázku jiného obchodníka ani ji nepřevede do zakázky bez obchodníka", async () => {
    const f = await fixture();
    await svc.from("orders").update({ owner_id: admin }).eq("id", f.quoteJob.id);    // zakládal Petr, obchodník je jiný
    const pv = await previewJobMergeCore(as(sales), f.order.id, f.quoteJob.id);
    expect(pv.ok && pv.preview.conflicts.find((c) => c.code === "FORBIDDEN")?.message).toMatch(/různé obchodníky/);
    const r1 = await mergeJobsCore(as(sales), { targetId: f.order.id, sourceId: f.quoteJob.id, token: randomUUID() });
    expect(r1).toMatchObject({ ok: false, code: "FORBIDDEN" });
    await svc.from("orders").update({ owner_id: null }).eq("id", f.order.id);
    await svc.from("orders").update({ owner_id: sales }).eq("id", f.quoteJob.id);
    const r2 = await mergeJobsCore(as(sales), { targetId: f.order.id, sourceId: f.quoteJob.id, token: randomUUID() });
    expect(r2).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect((await job(f.quoteJob.id)).merged_into_id).toBeNull();
    // super admin smí: obchodník zdroje doplní prázdného obchodníka cíle
    await merged(f.order.id, f.quoteJob.id, admin);
    expect((await job(f.order.id)).owner_id).toBe(sales);
  }, 60_000);

  it("spojené položky si nesou dodané kusy; klíče focení přejdou na cíl; objednávka zákazníka si nese autory", async () => {
    const cust = await customer("Dodávky", "11223344");
    const src = await newJob({ status: "potvrzeno", customer_id: cust, customer_order_number: `PO-ATR-${TAG}`, capture_key: `cap-${TAG}:g1` });
    const tgt = await newJob({ status: "poptavka", customer_id: cust });
    const at = "2026-10-20T10:00:00.000Z";
    const { error: ue } = await svc.from("orders").update({
      confirmed_by: admin, confirmation_issued_at: at, confirmation_issued_by: admin, confirmation_issued_revision: 1,
      confirmation_sent_at: at, confirmation_sent_by: admin, confirmation_sent_revision: 1, confirmation_sent_via: "email",
    }).eq("id", src.id);
    expect(ue).toBeNull();
    const { error: ie } = await svc.from("order_items").insert([
      { order_id: src.id, position: 0, drawing_number: "DRW-1", quantity: 40, unit: "ks", delivered_quantity: 40, delivered_changed_by: admin,
        delivered_changed_at: at, capture_key: `cap-${TAG}:g1:0` },
      { order_id: tgt.id, position: 0, drawing_number: "DRW 1", quantity: 40, unit: "ks" },
    ]);
    expect(ie).toBeNull();
    await merged(tgt.id, src.id);                                      // slučuje Petr
    const t = await job(tgt.id);
    expect(t).toMatchObject({
      status: "potvrzeno", order_status: "potvrzena", customer_order_number: `PO-ATR-${TAG}`, capture_key: `cap-${TAG}:g1`,
      confirmed_by: admin, confirmation_issued_by: admin, confirmation_sent_by: admin, items_delivered: 1,
    });
    const { data: ti } = await svc.from("order_items").select("delivered_quantity, delivered_changed_by, delivered_changed_at, capture_key").eq("order_id", tgt.id);
    expect(ti).toHaveLength(1);
    expect(Number(ti?.[0].delivered_quantity)).toBe(40);
    expect(ti?.[0]).toMatchObject({ delivered_changed_by: admin, capture_key: `cap-${TAG}:g1:0` });
    expect(new Date(String(ti?.[0].delivered_changed_at)).toISOString()).toBe(at);
    expect((await job(src.id)).capture_key).toBeNull();
    const { data: si } = await svc.from("order_items").select("capture_key").eq("order_id", src.id);
    expect((si ?? []).every((x) => x.capture_key === null)).toBe(true);
  }, 60_000);

  it("zdroj v Reklamaci / Pozastaveno: slučuje se do něj (prohodit směr); dvojí objednávka u stejného dodavatele se nahlásí", async () => {
    const cust = await customer("Zvláštní stavy", "55667788");
    const rekl = await newJob({ status: "reklamace", customer_id: cust, customer_order_number: `PO-7B-${TAG}` });
    const pric = await newJob({ status: "naceneni", customer_id: cust });
    const pv = await previewJobMergeCore(as(admin), pric.id, rekl.id);
    expect(pv.ok && pv.preview.conflicts.find((c) => c.code === "SPECIAL_STAGE")?.level).toBe("block");
    const r = await mergeJobsCore(as(admin), { targetId: pric.id, sourceId: rekl.id, token: randomUUID() });
    expect(r).toMatchObject({ ok: false });
    // opačně (cíl v reklamaci) to jde
    const pv2 = await previewJobMergeCore(as(admin), rekl.id, pric.id);
    expect(pv2.ok && pv2.preview.ok).toBe(true);

    const a = await newJob({ status: "potvrzeno", customer_id: cust });
    const b = await newJob({ status: "potvrzeno", customer_id: cust });
    const { data: sup } = await svc.from("suppliers").insert({ name: `Kalírna dvakrát ${TAG}` }).select("id").single();
    suppliers.push((sup as { id: string }).id);
    const { error: poErr } = await svc.from("purchase_orders").insert([
      { job_id: a.id, number: `OV-DUP-${TAG}-1`, supplier_id: (sup as { id: string }).id, status: "odeslana", total: 3000 },
      { job_id: b.id, number: `OV-DUP-${TAG}-2`, supplier_id: (sup as { id: string }).id, status: "potvrzena", total: 3000 },
    ]);
    expect(poErr).toBeNull();
    const pv3 = await previewJobMergeCore(as(admin), a.id, b.id);
    const dup = pv3.ok ? pv3.preview.conflicts.find((c) => c.code === "PO_DUPLICATE") : undefined;
    expect(dup?.level).toBe("force");
    expect(dup?.purchaseOrders).toEqual([`OV-DUP-${TAG}-1`, `OV-DUP-${TAG}-2`]);
    const r3 = await mergeJobsCore(as(admin), { targetId: a.id, sourceId: b.id, token: randomUUID() });
    expect(r3).toMatchObject({ ok: false, code: "NEEDS_FORCE" });
  }, 60_000);

  it("nabídka, kterou nejde přijmout, se v náhledu nepřislíbí a sloučení vrátí upozornění", async () => {
    const f = await fixture();
    localSql(`update quotes set admin_approval_required = true where id = '${f.quoteId}'`);   // starší data: odeslaná bez schválení
    const pv = await previewJobMergeCore(as(sales), f.order.id, f.quoteJob.id);
    expect(pv.ok && pv.preview.acceptQuote).toBeNull();
    expect(pv.ok && pv.preview.conflicts.find((c) => c.code === "QUOTE_WONT_ACCEPT")?.level).toBe("warn");
    const res = await merged(f.order.id, f.quoteJob.id);
    expect(res.acceptedQuote).toBeNull();
    expect(res.warnings.some((w) => w.code === "QUOTE_WONT_ACCEPT" || w.code === "QUOTE_NOT_ACCEPTED")).toBe(true);
    const { data: q } = await svc.from("quotes").select("status, job_id").eq("id", f.quoteId!).single();
    expect(q).toMatchObject({ status: "odeslano", job_id: f.order.id });
  }, 60_000);

  it("nabídka jen jako PDF: náhled to řekne a historie cíle zapíše, že byla odeslaná", async () => {
    const f = await fixture({ pdfOnly: true });
    expect((await job(f.quoteJob.id)).status).toBe("nabidka");
    const pv = await previewJobMergeCore(as(sales), f.order.id, f.quoteJob.id);
    const pdf = pv.ok ? pv.preview.conflicts.find((c) => c.code === "QUOTE_PDF_ONLY") : undefined;
    expect(pdf?.level).toBe("warn");
    expect(pdf?.message).toContain("136/026");
    await merged(f.order.id, f.quoteJob.id);
    const { data: ev } = await svc.from("job_events").select("message, type").eq("job_id", f.order.id).like("message", "Nabídka 136/026 (PDF)%");
    expect(ev).toHaveLength(1);
    expect(ev?.[0].message).toContain(f.quoteJob.number);
  }, 60_000);

  it("výběr najde dvojče s jinak zapsaným výkresem a zákazníkem zapsaným dvakrát (stejné IČO), i ze stejného focení", async () => {
    const f = await fixture({ sameIco: true });
    await svc.from("orders").update({ capture_key: `capx-${TAG}:g1` }).eq("id", f.order.id);
    await svc.from("orders").update({ capture_key: `capx-${TAG}:g2` }).eq("id", f.quoteJob.id);
    const sug = await searchMergeCandidatesCore(as(sales), f.order.id, "");
    const twin = sug.find((c) => c.id === f.quoteJob.id);    expect(twin?.reasons).toEqual(expect.arrayContaining(["capture", "drawing", "customer"]));
    expect(sug[0].id).toBe(f.quoteJob.id);                             // nejpravděpodobnější první
    const found = await searchMergeCandidatesCore(as(sales), f.order.id, "F00N603W84");
    expect(found.some((c) => c.id === f.quoteJob.id)).toBe(true);
    const spaced = await searchMergeCandidatesCore(as(sales), f.quoteJob.id, "F00N 603W84");
    expect(spaced.some((c) => c.id === f.order.id)).toBe(true);
  }, 60_000);

  it("faktury dodavatelů: alokace zdroje (i na spojenou položku) přejdou na cíl, náklad cíle je spočítá, pozdní zápis na zdroj skončí u cíle", async () => {
    const f = await fixture();
    const { data: srcItem } = await svc.from("order_items").select("id").eq("order_id", f.quoteJob.id).eq("position", 0).single();
    const { data: tgtItem } = await svc.from("order_items").select("id").eq("order_id", f.order.id).eq("position", 0).single();
    const { data: sup, error: se } = await svc.from("suppliers").insert({ name: `Kooperant faktury ${TAG}` }).select("id").single();
    if (se) throw new Error(se.message);
    suppliers.push((sup as { id: string }).id);
    const { data: po, error: pe } = await svc.from("purchase_orders").insert({
      job_id: f.quoteJob.id, supplier_id: (sup as { id: string }).id, number: `OV-E2E-${TAG}-${n}`, status: "vystavena", total: 20_000,
    }).select("id").single();
    if (pe) throw new Error(pe.message);
    const { data: inv, error: ie } = await svc.from("supplier_invoices").insert({
      supplier_id: (sup as { id: string }).id, supplier_name: "Kooperant", number: `FA-${TAG}-${n}`, total_net: 18_000, source: "upload",
    }).select("id").single();
    if (ie) throw new Error(ie.message);
    const invoiceId = (inv as { id: string }).id;
    try {
      const { data: it, error: ite } = await svc.from("supplier_invoice_items").insert({ invoice_id: invoiceId, position: 0, text: "Výroba", amount: 18_000 }).select("id").single();
      if (ite) throw new Error(ite.message);
      const { error: ae } = await svc.from("supplier_invoice_allocations").insert({
        invoice_id: invoiceId, item_id: (it as { id: string }).id, target: "job", job_id: f.quoteJob.id, purchase_order_id: (po as { id: string }).id,
        order_item_id: (srcItem as { id: string }).id, amount: 18_000, confirmed_at: new Date().toISOString(),
      });
      if (ae) throw new Error(ae.message);
      await merged(f.order.id, f.quoteJob.id);
      // (počet v souhrnu RPC; typovaný přehled sloučení ho neukazuje)
      expect(localSql(`select result->'moved'->>'supplierInvoiceAllocations' from job_merges where source_id = '${f.quoteJob.id}'`)).toBe("1");
      const { data: a } = await svc.from("supplier_invoice_allocations").select("job_id, order_item_id, purchase_order_id").eq("invoice_id", invoiceId).single();
      expect(a).toMatchObject({ job_id: f.order.id, order_item_id: (tgtItem as { id: string }).id, purchase_order_id: (po as { id: string }).id });
      // náklad cíle bez dvojího počítání: dílčí faktura 18 000 na objednávku 20 000 → 20 000; konečná → 18 000
      expect(localSql(`select cost::text || '|' || known::text from job_cost('${f.order.id}')`)).toBe("20000.00|true");
      await svc.from("supplier_invoices").update({ final_po_ids: [(po as { id: string }).id] }).eq("id", invoiceId);
      const cost = localSql(`select cost::text || '|' || known::text from job_cost('${f.order.id}')`);
      expect(cost).toBe("18000.00|true");
      const { data: ce } = await svc.from("commission_entries").select("cost").eq("order_id", f.order.id).maybeSingle();
      if (ce) expect(Number((ce as { cost: number }).cost)).toBe(18_000);
      // pozdní zápis na sloučený zdroj → cíl
      await svc.from("supplier_invoice_allocations").delete().eq("invoice_id", invoiceId);
      const { data: late, error: le } = await svc.from("supplier_invoice_allocations").insert({
        invoice_id: invoiceId, item_id: (it as { id: string }).id, target: "job", job_id: f.quoteJob.id, amount: 500,
      }).select("job_id").single();
      expect(le).toBeNull();
      expect((late as { job_id: string }).job_id).toBe(f.order.id);
    } finally {
      await svc.from("supplier_invoices").delete().eq("id", invoiceId);
    }
  }, 60_000);

  it("Pošta B: změny z e-mailů a návrhy přiřazení zdroje přejdou na cíl (i spojená položka), pozdní zápis na zdroj skončí u cíle", async () => {
    const f = await fixture();
    const { data: srcItem } = await svc.from("order_items").select("id").eq("order_id", f.quoteJob.id).eq("position", 0).single();
    const { data: tgtItem } = await svc.from("order_items").select("id").eq("order_id", f.order.id).eq("position", 0).single();
    const thread = `m:-:<merge-b-${TAG}-${n}@test>`;
    const { error: ce } = await svc.from("job_mail_changes").insert({
      job_id: f.quoteJob.id, email_id: f.emailId, order_item_id: (srcItem as { id: string }).id, kind: "change", field: "heat",
      summary: "Tepelné zpracování: kalení", value_new: "kalení", status: "applied", party: "customer",
    });
    expect(ce).toBeNull();
    // návrh stejného vlákna na obě zakázky → po sloučení jen jeden (cíl)
    const { error: se } = await svc.from("email_job_suggestions").insert([
      { thread_id: thread, job_id: f.quoteJob.id, score: 0.6 }, { thread_id: thread, job_id: f.order.id, score: 0.5 },
    ]);
    expect(se).toBeNull();
    await merged(f.order.id, f.quoteJob.id);
    const { data: ch } = await svc.from("job_mail_changes").select("job_id, order_item_id").eq("email_id", f.emailId!).single();
    expect(ch).toMatchObject({ job_id: f.order.id, order_item_id: (tgtItem as { id: string }).id });
    const { data: sg } = await svc.from("email_job_suggestions").select("job_id").eq("thread_id", thread);
    expect(sg).toEqual([{ job_id: f.order.id }]);
    // pozdní zápis (stahování pošty běželo souběžně) na sloučený zdroj → cíl
    const { data: late, error: le } = await svc.from("job_mail_changes").insert({
      job_id: f.quoteJob.id, kind: "info", field: "deadline", summary: `Termín pozdě ${TAG}`, status: "info",
    }).select("job_id").single();
    expect(le).toBeNull();
    expect((late as { job_id: string }).job_id).toBe(f.order.id);
    await svc.from("job_mail_changes").delete().eq("job_id", f.order.id);
    await svc.from("email_job_suggestions").delete().eq("thread_id", thread);
  }, 60_000);

  it("REST (session) nesloučí ani nenastaví příznak sloučení", async () => {
    const f = await fixture();
    const s = await localSession(DEMO.admin.email, DEMO.admin.password);
    const rpc = await s.rpc("merge_jobs", { p_target: f.order.id, p_source: f.quoteJob.id, p_token: randomUUID() });
    expect(rpc.error).not.toBeNull();
    const pv = await s.rpc("merge_jobs_preview", { p_target: f.order.id, p_source: f.quoteJob.id });
    expect(pv.error).not.toBeNull();
    await s.from("orders").update({ merged_into_id: f.order.id, title: "Přejmenováno přes REST" }).eq("id", f.quoteJob.id);
    const j = await job(f.quoteJob.id);
    expect(j).toMatchObject({ merged_into_id: null, title: "Přejmenováno přes REST" });
    const ins = await s.from("job_merges").insert({ token: randomUUID(), target_number: "x", source_number: "y" });
    expect(ins.error).not.toBeNull();
  }, 60_000);
});
