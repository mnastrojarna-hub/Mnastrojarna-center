import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_ENABLED, loadLocalEnv, localAdmin, localSql } from "@/test/local-supabase";

/**
 * Pošta B end-to-end proti lokálnímu Supabase + testovacímu poštovnímu serveru (bez AI — pravidla):
 * naše nabídka odeslaná ze zakázky → zákazník odpoví „prosím kalit, a 30 ks místo 20" → K zakázce,
 * přiřazeno vláknem, historie, položka kalení + 30 ks (výkres přebit), vrácení; dodavatel s OV-… přes
 * objednávku; nejasný e-mail = návrh a potvrzení jedním ťuknutím; nová poptávka zůstane Poptávkou;
 * zakázka z e-mailu „prosím kalit" = kalení na položce; poznámky v historii; viditelnost (zaměstnanec
 * nevidí cizí poštu, ceny dodavatele jen s maržemi); dopočet staré pošty idempotentní.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/email/mail-b.integration.test.ts
 */

type Srv = {
  ports: Record<string, number>;
  caFile: string;
  sent: { from: string; to: string[]; raw: string }[];
  addMessage: (u: string, m: Record<string, unknown>) => number;
  close: () => Promise<void>;
};

const USER = "kolega@mnastrojarna.test";
const PASS = "Kolega-Heslo-1";

const session = vi.hoisted(() => ({ current: null as null | { id: string; email: string; fullName: string; role: string } }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/supabase/server", async () => {
  const lib = await import("@/test/local-supabase");
  return {
    isSupabaseConfigured: () => true,
    hasServiceKey: () => true,
    createAdminClient: (o?: { actor?: Parameters<typeof lib.localAdmin>[0] }) => lib.localAdmin(o?.actor ?? null),
    createOperatorClient: async (o?: { actor?: Parameters<typeof lib.localAdmin>[0] }) => lib.localAdmin(o?.actor ?? null),
    createClient: async () => { throw new Error("Bez session (test)."); },
  };
});
vi.mock("@/lib/auth/session", () => {
  const FEATURES: Record<string, string[]> = {
    obchodnik: ["orders", "workflow", "documents", "customers", "suppliers", "mail", "margins"],
    zamestnanec: ["orders", "workflow", "documents", "customers", "suppliers", "mail"],
  };
  const user = () => {
    const u = session.current!;
    return { ...u, initials: "XX", roleLabel: u.role, aiAccess: false, active: true, hasProfile: true };
  };
  const can = (f: string) => (FEATURES[session.current?.role ?? ""] ?? []).includes(f);
  return {
    getSessionUser: async () => user(),
    getAccess: async () => ({ user: user(), ctx: {}, features: FEATURES[session.current!.role], can }),
    checkFeature: async (f: string) => (can(f) ? { user: user() } : { error: "Bez oprávnění." }),
    apiRequire: async () => ({ user: user() }),
    requireUser: async () => user(),
    requireFeature: async () => user(),
  };
});

describe.skipIf(!LOCAL_ENABLED)("Pošta B ↔ lokální Supabase + testovací IMAP/SMTP", () => {
  let srv: Srv;
  let svc: SupabaseClient;
  const TAG = `mailb${Date.now()}`;
  const DOM = `strojmetal-${TAG}.test`;
  const SUP = `ocel-${TAG}.test`;
  const users: { a?: { id: string; email: string }; w?: { id: string; email: string } } = {};
  let boxId = "";
  let customerId = "";
  let supplierId = "";
  const jobs: { id: string; number: string }[] = [];
  let job1 = { id: "", number: "" };
  let job2 = { id: "", number: "" };
  let itemId = "";
  let poNumber = "";

  beforeAll(async () => {
    const env = loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    delete process.env.ANTHROPIC_API_KEY; // bez AI (pravidla)
    const mod = (await import(path.resolve(__dirname, "../../../tools/e2e/mail-test-server.mjs"))) as {
      startMailTestServer: (o: { dir: string; base: number }) => Promise<Srv>;
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mail-b-"));
    for (let i = 0; ; i++) {
      try {
        srv = await mod.startMailTestServer({ dir, base: 47000 + Math.floor(Math.random() * 900) * 10 });
        break;
      } catch (err) {
        if (i >= 5 || !/EADDRINUSE/.test(String(err))) throw err;
      }
    }
    tls.setDefaultCACertificates([...tls.getCACertificates("default"), fs.readFileSync(srv.caFile, "utf8")]);
    process.env.MAIL_TEST_PROVIDERS = JSON.stringify([
      { domains: ["nastrojarstvi.test", "mnastrojarna.test"], label: "hosting90 (test)",
        imap: [{ host: "127.0.0.1", port: srv.ports.imaps, tls: "tls" }], pop3: [], smtp: [{ host: "127.0.0.1", port: srv.ports.smtps, tls: "tls" }] },
    ]);
    svc = localAdmin();
    for (const [key, role, name] of [["a", "obchodnik", "Adam Obchodník"], ["w", "zamestnanec", "Wanda Dílna"]] as const) {
      const email = `${TAG}-${key}@local.test`;
      const { data, error } = await svc.auth.admin.createUser({ email, password: `Heslo-${TAG}-1!`, email_confirm: true, user_metadata: { full_name: name } });
      if (error) throw new Error(error.message);
      users[key] = { id: data.user!.id, email };
      await svc.from("profiles").update({ role, full_name: name, active: true }).eq("id", data.user!.id);
    }
    await svc.from("mailboxes").delete().eq("email", USER);
    // výchozí režimy Pošty B (plná automatika — migrace je zakládá; test je nezávislý na ručních změnách)
    await svc.from("automation_settings").upsert([{ module: "mail_job_link", mode: "full", enabled: true }, { module: "mail_job_changes", mode: "full", enabled: true }]);
  }, 60_000);

  afterAll(async () => {
    for (const j of jobs) {
      await svc.from("quotes").delete().eq("job_id", j.id);
      await svc.from("job_mail_changes").delete().eq("job_id", j.id);
      await svc.from("email_job_suggestions").delete().eq("job_id", j.id);
      await svc.from("emails").update({ order_id: null }).eq("order_id", j.id);
      await svc.from("purchase_orders").delete().eq("job_id", j.id);
      await svc.from("job_files").delete().eq("job_id", j.id);
      await svc.from("order_items").delete().eq("order_id", j.id);
      await svc.from("drawings").delete().eq("job_id", j.id);
      await svc.from("orders").delete().eq("id", j.id);
    }
    if (boxId) {
      // faktury dodavatelů z e-mailů schránky (B5) — i když test spadl dřív, než uklidil
      const { data: em } = await svc.from("emails").select("id").eq("mailbox_id", boxId);
      const ids = ((em ?? []) as { id: string }[]).map((r) => r.id);
      const { data: inv } = ids.length ? await svc.from("supplier_invoices").select("id").in("email_id", ids) : { data: [] };
      const invIds = ((inv ?? []) as { id: string }[]).map((r) => r.id);
      if (invIds.length) {
        const { data: f } = await svc.from("supplier_invoice_files").select("storage_path").in("invoice_id", invIds);
        const paths = ((f ?? []) as { storage_path: string }[]).map((r) => r.storage_path);
        if (paths.length) await svc.storage.from("supplier-invoices").remove(paths);
        await svc.from("supplier_invoices").delete().in("id", invIds);
      }
      await svc.from("emails").delete().eq("mailbox_id", boxId);
      await svc.from("mailboxes").delete().eq("id", boxId);
    }
    if (customerId) await svc.from("customers").delete().eq("id", customerId);
    await svc.from("customers").delete().eq("name", `Cizí ${TAG}`); // i když test spadl dřív, než uklidil
    if (supplierId) await svc.from("suppliers").delete().eq("id", supplierId);
    for (const u of [users.a, users.w]) {
      if (!u) continue;
      await svc.from("emails").delete().eq("owner_id", u.id);
      await svc.auth.admin.deleteUser(u.id).catch(() => undefined);
    }
    delete process.env.MAIL_TEST_PROVIDERS;
    await srv?.close();
  });

  const asA = () => { session.current = { id: users.a!.id, email: users.a!.email, fullName: "Adam Obchodník", role: "obchodnik" }; };
  const asW = () => { session.current = { id: users.w!.id, email: users.w!.email, fullName: "Wanda Dílna", role: "zamestnanec" }; };
  const sync = async () => (await import("./ingest")).syncMailbox({ mailboxIds: [boxId], manual: true });
  const emailBy = (where: string) => JSON.parse(localSql(`select row_to_json(x) from (select id, thread_id, order_id, category, job_link_source, job_link_actor, job_info_at is not null as info from emails where mailbox_id = '${boxId}' and ${where} order by received_at desc limit 1) x`) || "null");

  async function newJob(title: string, items: { drawing: string; qty: number }[], extra: Record<string, unknown> = {}) {
    const number = localSql("select next_job_number()");
    const { data, error } = await svc.from("orders").insert({ number, title, status: "nabidka", customer_id: customerId, owner_id: users.a!.id, created_by: users.a!.id, ...extra }).select("id, number").single();
    if (error) throw new Error(error.message);
    const j = data as { id: string; number: string };
    jobs.push(j);
    for (const [i, it] of items.entries()) {
      const { data: d } = await svc.from("drawings").insert({ drawing_number: it.drawing, revision: "A", customer_id: customerId, quantity: it.qty, heat_status: "bez", surface_status: "bez", job_id: j.id }).select("id").single();
      const { data: row, error: e2 } = await svc.from("order_items").insert({
        order_id: j.id, position: i, drawing_number: it.drawing, name: `Díl ${it.drawing}`, quantity: it.qty, unit: "ks", material: "11 523",
        heat_status: "bez", surface_status: "bez", drawing_id: (d as { id: string }).id,
      }).select("id").single();
      if (e2) throw new Error(e2.message);
      if (i === 0) itemId = (row as { id: string }).id;
    }
    return j;
  }

  it("příprava: schránka obchodníka, stará pošta, zákazník, dodavatel, zakázky", async () => {
    asA();
    const my = await import("./my-mailbox");
    const det = await my.detectMine(users.a!.id, { email: USER, password: PASS });
    expect(det.ok).toBe(true);
    const saved = await my.saveMine(users.a!.id, { email: USER, password: PASS, config: det.config! });
    expect(saved.ok).toBe(true);
    boxId = saved.id!;
    await sync(); // výchozí zprávy schránky (bez zákazníka — nic se nepřiřadí)
    const { data: c } = await svc.from("customers").insert({ name: `Strojmetal ${TAG}`, email: `nakup@${DOM}`, owner_id: users.a!.id }).select("id").single();
    customerId = (c as { id: string }).id;
    const { data: s } = await svc.from("suppliers").insert({ name: `Ocel ${TAG}`, email: `obchod@${SUP}` }).select("id").single();
    supplierId = (s as { id: string }).id;
    job1 = await newJob("Hřídel H-200", [{ drawing: `H-200-${TAG}`, qty: 20 }]);
    expect(job1.number).toMatch(/^Z-\d{4}-\d{3,}$/);
  }, 90_000);

  let quoteThread = "";
  it("naše nabídka ze zakázky → odpověď „prosím kalit, a 30 ks místo 20“ → K zakázce, vlákno, historie, položka přebita, vrácení", async () => {
    asA();
    const compose = await import("@/app/actions/mail-compose");
    const sent = await compose.sendComposedAction({
      mode: "new", jobId: job1.id, to: `dvorak@${DOM}`, subject: `Nabídka k zakázce — hřídel ${TAG}`, body: `Dobrý den,\nv příloze nabídka na 20 ks H-200-${TAG}.\n\nS pozdravem Adam`,
    });
    expect(sent.ok).toBe(true);
    const out = JSON.parse(localSql(`select row_to_json(x) from (select message_id, thread_id, order_id from emails where id = '${sent.emailId}') x`));
    expect(out.order_id).toBe(job1.id);
    quoteThread = out.thread_id;
    await new Promise((r) => setTimeout(r, 1100));
    srv.addMessage(USER, {
      subject: `Re: Nabídka k zakázce — hřídel ${TAG}`, from: `Jan Dvořák <dvorak@${DOM}>`, inReplyTo: out.message_id, references: out.message_id,
      body: `Dobrý den,\n\nnabídku akceptujeme, prosím kalit, a 30 ks místo 20.\n\nS pozdravem\nJan Dvořák\nStrojmetal\n\nDne 29. 10. 2026 Adam napsal(a):\n> v příloze nabídka na 20 ks H-200-${TAG}.\n> materiál 1.4301`,
    });
    await sync();
    const reply = emailBy(`body_text like 'Dobrý den,%nabídku akceptujeme%'`);
    expect(reply).toMatchObject({ order_id: job1.id, category: "k_zakazce", job_link_actor: "ai", thread_id: quoteThread, info: true });
    expect(["thread", "reply"]).toContain(reply.job_link_source);

    // položka: kalení + 30 ks (výkres: bez TZ / 20 ks přebito), citace bez historie (1.4301 z citace se NEbere)
    const item = JSON.parse(localSql(`select row_to_json(x) from (select quantity::int as q, heat_status, heat_treatment, material from order_items where id = '${itemId}') x`));
    expect(item).toEqual({ q: 30, heat_status: "uvedeno", heat_treatment: "kalení", material: "11 523" });
    const changes = JSON.parse(localSql(`select json_agg(row_to_json(x) order by x.field) from (select field, status, drawing_value, value_prev, value_new, kind from job_mail_changes where job_id = '${job1.id}' and kind = 'change') x`));
    expect(changes).toEqual([
      { field: "heat", status: "applied", drawing_value: "bez TZ", value_prev: "bez TZ", value_new: "kalení", kind: "change" },
      { field: "quantity", status: "applied", drawing_value: "20 ks", value_prev: "20 ks", value_new: "30 ks", kind: "change" },
    ]);
    const events = localSql(`select string_agg(message, ' || ' order by created_at) from job_events where job_id = '${job1.id}' and type = 'email'`);
    expect(events).toMatch(/přiřazen k zakázce automaticky/);
    expect(events).toMatch(/Z e-mailu od Jan Dvořák: Tepelné zpracování: kalení .*nadřazeno výkresu/);
    expect(events).toMatch(/Z e-mailu od Jan Dvořák: Počet kusů: 30 ks \(místo 20 ks\)/);
    expect(events).not.toMatch(/1\.4301/);
    expect(localSql(`select actor_kind from job_events where job_id = '${job1.id}' and data->>'action' = 'mail_change' limit 1`)).toBe("ai");
    // návrh štítku „kalení"
    expect(localSql(`select value_new || '|' || status from job_mail_changes where job_id = '${job1.id}' and kind = 'tag'`)).toBe("kalení|suggested");

    // Komunikace zakázky: vlákno (dovnitř i ven), změny s odznakem
    const data = await import("@/lib/data/job-mail");
    const comm = (await data.getJobCommunication(job1.id))!;
    expect(comm.threads.map((t) => t.threadId)).toEqual([quoteThread]);
    expect(comm.threads[0].messageCount).toBe(2);
    expect(comm.contact.email).toBe(`nakup@${DOM}`);
    const heat = comm.changes.find((c) => c.field === "heat" && c.kind === "change")!;
    expect(heat.badge).toMatch(/^Pokyn zákazníka z e-mailu \d{1,2}\. \d{1,2}\. \d{4} — nadřazeno výkresu$/);
    expect(heat.threadId).toBe(quoteThread);

    // seznam pošty: složka „K zakázkám" + chip zakázky
    const inbox = await import("@/app/actions/mail-inbox");
    const list = await inbox.listThreadsAction({ folder: "jobs" });
    const row = list.items.find((t) => t.threadId === quoteThread)!;
    expect(row).toMatchObject({ jobId: job1.id, jobNumber: job1.number, category: "K zakázce", jobTitle: "Hřídel H-200" });
    expect((await inbox.listThreadsAction({ folder: "inbox", category: "K zakázce" })).items.some((t) => t.threadId === quoteThread)).toBe(true);
    const det = await inbox.openThreadAction(quoteThread, { markRead: false });
    expect(det).toMatchObject({ jobId: job1.id, jobNumber: job1.number, jobTitle: "Hřídel H-200" });

    // vrácení počtu jedním ťuknutím → 20 ks, historie „Vráceno"
    const act = await import("@/app/actions/mail-jobs");
    const qId = comm.changes.find((c) => c.field === "quantity" && c.kind === "change")!.id;
    expect(await act.undoMailChangeAction(qId)).toMatchObject({ ok: true });
    expect(localSql(`select quantity::int from order_items where id = '${itemId}'`)).toBe("20");
    expect(localSql(`select status from job_mail_changes where id = '${qId}'`)).toBe("undone");
    expect(localSql(`select message from job_events where job_id = '${job1.id}' and data->>'action' = 'mail_change_undone'`)).toMatch(/^Vráceno: Počet kusů: 30 ks/);
    expect((await act.undoMailChangeAction(qId)).ok).toBe(false); // podruhé nic
    // znovu propsat
    expect(await act.applyMailChangeAction(qId)).toMatchObject({ ok: true });
    expect(localSql(`select quantity::int from order_items where id = '${itemId}'`)).toBe("30");
    // štítek z e-mailu jedním ťuknutím → štítky zakázky + historie
    const tagId = localSql(`select id from job_mail_changes where job_id = '${job1.id}' and kind = 'tag'`);
    expect(await act.applyMailChangeAction(tagId)).toMatchObject({ ok: true });
    expect(localSql(`select array_to_string(tags, ',') from orders where id = '${job1.id}'`)).toContain("kalení");

    // opakované stažení nic nezdvojí
    await sync();
    expect(localSql(`select count(*) from job_mail_changes where job_id = '${job1.id}' and kind = 'change'`)).toBe("2");
  }, 120_000);

  it("dodavatel s číslem naší objednávky OV-… → zakázka přes objednávku; cena dodavatele jen s maržemi", async () => {
    asA();
    poNumber = localSql("select next_doc_number('OV')");
    const { error } = await svc.from("purchase_orders").insert({ job_id: job1.id, supplier_id: supplierId, number: poNumber, status: "odeslana" });
    expect(error).toBeNull();
    srv.addMessage(USER, {
      subject: `Potvrzení objednávky ${poNumber}`, from: `Ocel ${TAG} <obchod@${SUP}>`,
      body: "Dobrý den, potvrzujeme Vaši objednávku. Kalení dodáme do 15. 11. 2026. Cena kalení 1 200 Kč/ks.\n\nS pozdravem Ocel",
    });
    await sync();
    const m = emailBy(`subject = 'Potvrzení objednávky ${poNumber}'`);
    expect(m).toMatchObject({ order_id: job1.id, job_link_source: "po_number", category: "potvrzeni_objednavky" });
    // dodavatel položky nemění (jen historie); cena je citlivá
    expect(localSql(`select count(*) from job_mail_changes where email_id = '${m.id}' and kind = 'change'`)).toBe("0");
    expect(localSql(`select bool_or(sensitive) from job_mail_changes where email_id = '${m.id}' and field = 'price'`)).toBe("t");
    expect(localSql(`select summary from job_mail_changes where email_id = '${m.id}' and field = 'deadline' and kind = 'info'`)).toBe("Termín: 15. 11. 2026");
    expect(localSql(`select message from job_events where job_id = '${job1.id}' and data->>'field' = 'price'`)).toMatch(/Cena \(podrobnosti vidí obchodník a admin\)/);
    const data = await import("@/lib/data/job-mail");
    expect((await data.getJobCommunication(job1.id))!.changes.some((c) => c.field === "price")).toBe(true);
    asW();
    expect((await data.getJobCommunication(job1.id))!.changes.some((c) => c.field === "price")).toBe(false);
  }, 90_000);

  it("nejasný e-mail (dvě otevřené zakázky firmy) → návrh „Patří k …?“ a potvrzení jedním ťuknutím; nová poptávka zůstane Poptávkou", async () => {
    asA();
    job2 = await newJob("Příruba P-20", [{ drawing: `P-20-${TAG}`, qty: 5 }]);
    srv.addMessage(USER, { subject: `Dotaz ${TAG}`, from: `Jan Dvořák <dvorak@${DOM}>`, body: "Dobrý den, kdy to bude hotové?" });
    srv.addMessage(USER, { subject: `Poptávka přírub ${TAG}`, from: `Jan Dvořák <dvorak@${DOM}>`, body: "Prosím o nabídku na 100 ks přírub dle přiloženého výkresu." });
    await sync();
    const q = emailBy(`subject = 'Dotaz ${TAG}'`);
    expect(q.order_id).toBeNull();
    const sugg = JSON.parse(localSql(`select row_to_json(x) from (select id, job_id, status from email_job_suggestions where thread_id = '${q.thread_id}') x`));
    // stejně jisté zakázky firmy → ta s nejčerstvější komunikací (job1 má poštu), ne nejvyšší číslo (review fix 5)
    expect(sugg).toMatchObject({ job_id: job1.id, status: "pending" });
    const inq = emailBy(`subject = 'Poptávka přírub ${TAG}'`);
    expect(inq).toMatchObject({ order_id: null, category: "poptavka" });
    expect(localSql(`select count(*) from email_job_suggestions where thread_id = '${inq.thread_id}'`)).toBe("0");

    const inbox = await import("@/app/actions/mail-inbox");
    const list = await inbox.listThreadsAction({ folder: "jobs" });
    expect(list.items.find((t) => t.threadId === q.thread_id)?.suggestion).toMatchObject({ id: sugg.id, jobNumber: job1.number });
    expect(list.items.find((t) => t.threadId === q.thread_id)?.suggestion?.forMessage).toBeUndefined();
    expect(list.counts?.jobSuggestions).toBeGreaterThanOrEqual(1);
    expect(list.items.some((t) => t.threadId === inq.thread_id)).toBe(false);

    const act = await import("@/app/actions/mail-jobs");
    expect(await act.confirmJobSuggestionAction(sugg.id)).toMatchObject({ ok: true, jobId: job1.id, jobNumber: job1.number });
    expect(emailBy(`subject = 'Dotaz ${TAG}'`)).toMatchObject({ order_id: job1.id, category: "k_zakazce", job_link_actor: "user", job_link_source: "manual" });
    // změnit jedním ťuknutím na jinou zakázku a odpojit
    expect(await act.setThreadJobAction(q.thread_id, job2.id)).toMatchObject({ ok: true, jobId: job2.id });
    expect(emailBy(`subject = 'Dotaz ${TAG}'`).order_id).toBe(job2.id);
    expect(localSql(`select count(*) from job_events where job_id = '${job1.id}' and data->>'action' = 'unlinked'`)).toBe("1");
    expect(await act.setThreadJobAction(q.thread_id, null)).toMatchObject({ ok: true });
    expect(emailBy(`subject = 'Dotaz ${TAG}'`).order_id).toBeNull();
  }, 90_000);

  it("zakázka z e-mailu: „prosím kalit“ v textu je nadřazené výkresu → položka má kalení; příloha jednou, nová revize výkresu = nová verze", async () => {
    asA();
    const DN = `H-777-${TAG}`;
    srv.addMessage(USER, {
      subject: `Poptávka ${DN}`, from: `Jan Dvořák <dvorak@${DOM}>`,
      body: `Dobrý den, poptáváme 20 ks dle výkresu ${DN}, prosím kalit.\n\nDěkuji, Jan`,
      attachments: [{ filename: `${DN}_revA.pdf`, contentType: "application/pdf", content: Buffer.from(`%PDF-1.4 výkres ${DN} rev A`) }],
    });
    await sync();
    const em = emailBy(`subject = 'Poptávka ${DN}'`);
    expect(em).toMatchObject({ order_id: null, category: "poptavka" });
    const mail = await import("@/app/actions/mail");
    const r = await mail.createJobFromEmail(em.id);
    expect(r.ok).toBe(true);
    jobs.push({ id: r.id!, number: r.number! });
    const item = JSON.parse(localSql(`select row_to_json(x) from (select drawing_number, quantity::int as q, heat_status, heat_treatment from order_items where order_id = '${r.id}') x`));
    expect(item).toEqual({ drawing_number: DN, q: 20, heat_status: "uvedeno", heat_treatment: "kalení" });
    expect(localSql(`select status || '|' || coalesce(drawing_value, 'null') from job_mail_changes where job_id = '${r.id}' and field = 'heat' and kind = 'change'`)).toBe("applied|null");
    expect(localSql(`select count(*) from job_files where job_id = '${r.id}' and origin = 'email'`)).toBe("1");
    expect(localSql(`select kind from job_files where job_id = '${r.id}' and origin = 'email'`)).toBe("vykres");
    // opakování: stejná zakázka, žádná druhá kopie přílohy
    expect(await mail.createJobFromEmail(em.id)).toMatchObject({ ok: true, id: r.id, existed: true });
    expect(localSql(`select count(*) from job_files where job_id = '${r.id}'`)).toBe("1");
    // zákazník pošle novou revizi výkresu (s číslem zakázky v předmětu) → přiřadí se a uloží jako v2
    srv.addMessage(USER, {
      subject: `${r.number} nová revize`, from: `Jan Dvořák <dvorak@${DOM}>`, body: "Posílám novou revizi B výkresu.",
      attachments: [{ filename: `${DN}_revB.pdf`, contentType: "application/pdf", content: Buffer.from(`%PDF-1.4 výkres ${DN} rev B`) }],
    });
    await sync();
    expect(emailBy(`subject = '${r.number} nová revize'`)).toMatchObject({ order_id: r.id, job_link_source: "job_number" });
    const files = localSql(`select string_agg(version || ':' || archived, ',' order by version) from job_files where job_id = '${r.id}'`);
    expect(files).toBe("1:true,2:false");
    expect(localSql(`select revision from order_items where order_id = '${r.id}'`)).toBe("B");
  }, 120_000);

  it("poznámky v historii; zaměstnanec bez schránky poštu zakázky nevidí (ani v poště), ostatní ano", async () => {
    asA();
    const jobsAct = await import("@/app/actions/jobs");
    expect((await jobsAct.updateJob(job1.id, { note: `Pozor: kalit vakuově ${TAG}` })).ok).toBe(true);
    const ev = JSON.parse(localSql(`select data from job_events where job_id = '${job1.id}' and type = 'field' and message like 'Interní poznámka:%' order by created_at desc limit 1`));
    expect(ev.changes[0]).toMatchObject({ field: "note", toText: `Pozor: kalit vakuově ${TAG}` });
    const helpers = await import("@/components/jobs/detail/detail-helpers");
    expect(helpers.eventPhase({ type: "field", data: ev })).toBe("poznamky");

    asW();
    const data = await import("@/lib/data/job-mail");
    const comm = (await data.getJobCommunication(job1.id))!;
    expect(comm.threads).toEqual([]);
    expect(comm.canMail).toBe(true);
    expect(comm.changes.some((c) => c.field === "heat")).toBe(true); // změny zakázky ano (ne citlivé)
    expect(comm.changes.every((c) => c.threadId === null)).toBe(true); // e-mail neotevře
    const inbox = await import("@/app/actions/mail-inbox");
    expect((await inbox.listThreadsAction({ folder: "jobs" })).items).toEqual([]);
    const act = await import("@/app/actions/mail-jobs");
    expect((await act.setThreadJobAction(quoteThread, job2.id)).ok).toBe(false);
    expect(JSON.stringify(comm)).not.toContain("nabídku akceptujeme");
  }, 60_000);

  it("dopočet staré pošty: přiřadí podle čísla zakázky, opakování nic nezdvojí, bez změn položek", async () => {
    asA();
    const mid = `<old-${TAG}@${DOM}>`;
    await svc.from("emails").insert({
      mailbox_id: boxId, owner_id: users.a!.id, direction: "in", message_id: mid, from_email: `dvorak@${DOM}`, customer_id: customerId,
      subject: `Dotaz k ${job2.number}`, body_text: "Prosím zinkovat.", category: "ostatni", received_at: new Date(Date.now() - 40 * 86_400_000).toISOString(),
    });
    const act = await import("@/app/actions/mail-jobs");
    const r1 = await act.backfillMailJobsAction();
    expect(r1.ok).toBe(true);
    expect(r1.linked).toBeGreaterThanOrEqual(1);
    const m = emailBy(`message_id = '${mid}'`);
    expect(m).toMatchObject({ order_id: job2.id, job_link_source: "job_number", category: "k_zakazce" });
    expect(localSql(`select count(*) from job_mail_changes where email_id = '${m.id}'`)).toBe("0"); // stará pošta nemění zakázku
    const events = localSql(`select count(*) from job_events where job_id = '${job2.id}'`);
    const r2 = await act.backfillMailJobsAction();
    expect(r2).toMatchObject({ ok: true, linked: 0 });
    expect(localSql(`select count(*) from job_events where job_id = '${job2.id}'`)).toBe(events);
  }, 90_000);
  // ── Review Pošty B: chybné přiřazení a jeho následky ──────────────────────
  const itemOf = (jobId: string) => localSql(`select id from order_items where order_id = '${jobId}' order by position limit 1`);
  const itemRow = (id: string) => JSON.parse(localSql(`select row_to_json(x) from (select quantity::int q, heat_status, heat_treatment, material, spec_sources from order_items where id = '${id}') x`));
  const mailRow = (id: string) => JSON.parse(localSql(`select row_to_json(x) from (select order_id, category, job_link_source, thread_id from emails where id = '${id}') x`));
  async function rawMail(row: Record<string, unknown>) {
    const { data, error } = await svc.from("emails").insert({
      mailbox_id: boxId, owner_id: users.a!.id, direction: "in", from_email: `jan@${DOM}`, from_name: "Jan Dvořák", customer_id: customerId, category: "ostatni",
      received_at: new Date().toISOString(), message_id: `<${Math.random().toString(36).slice(2)}-${TAG}@${DOM}>`, ...row,
    }).select("id, thread_id, message_id").single();
    if (error) throw new Error(error.message);
    return data as { id: string; thread_id: string; message_id: string };
  }
  const proc = async (id: string) => {
    const s = await import("./job-link-store");
    return s.processEmailForJobs(s.aiMailActor(users.a!.id), id, { useAi: false, recentDays: 30 });
  };

  it("review #3: nová poptávka se stejným předmětem jako stará uzavřená zakázka se k ní nepřiřadí a nic nezmění", async () => {
    asA();
    const closed = await newJob(`Stará ${TAG}`, [{ drawing: `S-1-${TAG}`, qty: 10 }], { status: "dokonceno" });
    const it0 = itemOf(closed.id);
    const old = await rawMail({ direction: "out", from_email: USER, to_email: `jan@${DOM}`, subject: "Re: Poptávka", order_id: closed.id, job_link_source: "sent", body_text: "Děkujeme", is_read: true, received_at: new Date(Date.now() - 200 * 86_400_000).toISOString() });
    const m = await rawMail({ subject: "Poptávka", category: "poptavka", body_text: "Dobrý den,\nposíláme novou poptávku na jiný díl, potřebujeme celkem 50 ks, prosím kalit.\n\nS pozdravem Jan" });
    // Pošta E: vlákno jen podle skutečné konverzace — stejný předmět bez hlaviček = nové vlákno už při uložení
    expect(m.thread_id).not.toBe(old.thread_id);
    await proc(m.id);
    expect(mailRow(m.id)).toMatchObject({ order_id: null, category: "poptavka" });
    // … a zůstává ve vlastním vlákně (v poště se neukáže pod starou zakázkou)
    expect(mailRow(m.id).thread_id).not.toBe(old.thread_id);
    expect(localSql(`select count(*) from email_job_suggestions where email_id = '${m.id}'`)).toBe("0");
    expect(itemRow(it0)).toMatchObject({ q: 10, heat_status: "bez" });
    expect(localSql(`select count(*) from job_mail_changes where job_id = '${closed.id}'`)).toBe("0");
    // „K zakázkám" nezobrazí vlákno jen s naší odeslanou poštou (review #12)
    const inbox = await import("@/app/actions/mail-inbox");
    const out = await rawMail({ direction: "out", from_email: USER, to_email: `jiny@${DOM}`, subject: `Nabídka jen odeslaná ${TAG}`, order_id: closed.id, job_link_source: "sent", body_text: "Nabídka", is_read: true });
    expect((await inbox.listThreadsAction({ folder: "jobs" })).items.some((t) => t.threadId === out.thread_id)).toBe(false);
  }, 60_000);

  it("review #5: stará pošta (stažená dodatečně) zakázku přiřadí, ale položky nezmění", async () => {
    asA();
    const j = await newJob(`Běžící ${TAG}`, [{ drawing: `B-1-${TAG}`, qty: 20 }]);
    const m = await rawMail({ subject: `Dotaz k ${j.number}`, body_text: "Prosím 30 ks místo 20 ks.", received_at: new Date(Date.now() - 730 * 86_400_000).toISOString() });
    await proc(m.id);
    expect(mailRow(m.id)).toMatchObject({ order_id: j.id, job_link_source: "job_number" });
    expect(itemRow(itemOf(j.id)).q).toBe(20);
    expect(localSql(`select count(*) from job_mail_changes where email_id = '${m.id}'`)).toBe("0");
  }, 60_000);

  it("review #2 + #6: vlastní číslo zákazníka ≠ naše OV jiné zakázky; neznámý odesílatel s naším OV jen návrh a jen návrhy změn", async () => {
    asA();
    const { data: oc } = await svc.from("customers").insert({ name: `Cizí ${TAG}`, email: `x@cizi-${TAG}.test` }).select("id").single();
    const otherCust = (oc as { id: string }).id;
    const other = await newJob(`Cizí ${TAG}`, [{ drawing: `C-1-${TAG}`, qty: 20 }], { customer_id: otherCust });
    const po = localSql("select next_doc_number('OV')");
    await svc.from("purchase_orders").insert({ job_id: other.id, supplier_id: supplierId, number: po, status: "odeslana" });
    const [, year, n] = /^OV-(\d{4})-(\d+)$/.exec(po)!;
    const own = await rawMail({ subject: "Objednávka", category: "objednavka", body_text: `Dobrý den,\nposíláme naši objednávku č. ${Number(n)}/${year}, potřebujeme celkem 35 ks.\n\nJan` });
    await proc(own.id);
    expect(mailRow(own.id).order_id).toBeNull();
    expect(itemRow(itemOf(other.id)).q).toBe(20);

    // neznámý odesílatel „Re: Objednávka OV-…" → jen návrh přiřazení
    const unk = await rawMail({ from_email: `novak@jina-${TAG}.test`, from_name: "Novák", customer_id: null, subject: `Re: Objednávka ${po}`, body_text: "Dobrý den,\ndodáme 18 ks místo 20 ks.\nMateriál bude 1.4305.\nCena 950 Kč/ks.\n\nS pozdravem Novák" });
    await proc(unk.id);
    expect(mailRow(unk.id).order_id).toBeNull();
    expect(localSql(`select status from email_job_suggestions where thread_id = '${unk.thread_id}' and job_id = '${other.id}'`)).toBe("pending");
    // ruční přiřazení: neznámý odesílatel položky nemění — změny jen jako návrhy, cena citlivá
    const act = await import("@/app/actions/mail-jobs");
    expect(await act.setThreadJobAction(unk.thread_id, other.id)).toMatchObject({ ok: true });
    expect(itemRow(itemOf(other.id))).toMatchObject({ q: 20, material: "11 523" });
    const ch = JSON.parse(localSql(`select json_agg(row_to_json(x) order by x.field) from (select field, status, party, sensitive from job_mail_changes where email_id = '${unk.id}' and kind <> 'tag') x`));
    expect(ch).toEqual([
      { field: "material", status: "suggested", party: "other", sensitive: false },
      { field: "price", status: "info", party: "other", sensitive: true },
      { field: "quantity", status: "suggested", party: "other", sensitive: false },
    ]);
    const data = await import("@/lib/data/job-mail");
    expect((await data.getJobCommunication(other.id))!.changes.find((c) => c.field === "quantity")!.badge).toBeNull();
    await svc.from("job_mail_changes").delete().eq("job_id", other.id);
    await svc.from("email_job_suggestions").delete().eq("job_id", other.id);
    await svc.from("emails").update({ order_id: null }).eq("order_id", other.id);
    await svc.from("purchase_orders").delete().eq("job_id", other.id);
    await svc.from("order_items").delete().eq("order_id", other.id);
    await svc.from("drawings").delete().eq("job_id", other.id);
    await svc.from("orders").delete().eq("id", other.id);
    await svc.from("customers").delete().eq("id", otherCust);
  }, 90_000);

  it("review #7 + #11: přeřazení vlákna vrátí změny na špatné zakázce a propíše je na správnou; odpovědi ve vlákně nepřidávají historii", async () => {
    asA();
    const wrong = await newJob(`Špatná ${TAG}`, [{ drawing: `W-1-${TAG}`, qty: 20 }]);
    const right = await newJob(`Správná ${TAG}`, [{ drawing: `R-1-${TAG}`, qty: 20 }]);
    const m = await rawMail({ subject: `${wrong.number} upřesnění`, body_text: "Prosím kalit." });
    await proc(m.id);
    expect(itemRow(itemOf(wrong.id))).toMatchObject({ heat_status: "uvedeno", heat_treatment: "kalení", spec_sources: { heat: "rucne" } });
    // další odpovědi ve vlákně (i „děkuji") → žádná nová událost přiřazení
    for (const body of ["Děkuji, v pořádku.\n\nS pozdravem Jan", "OK, díky."]) {
      const r = await rawMail({ subject: `Re: ${wrong.number} upřesnění`, in_reply_to: m.message_id, message_refs: [m.message_id], body_text: body });
      await proc(r.id);
      expect(mailRow(r.id).order_id).toBe(wrong.id);
    }
    expect(localSql(`select count(*) from job_events where job_id = '${wrong.id}' and data->>'action' = 'linked'`)).toBe("1");

    const act = await import("@/app/actions/mail-jobs");
    expect(await act.setThreadJobAction(m.thread_id, right.id)).toMatchObject({ ok: true, jobId: right.id });
    expect(itemRow(itemOf(wrong.id))).toMatchObject({ heat_status: "bez", heat_treatment: null });
    expect(itemRow(itemOf(wrong.id)).spec_sources.heat).toBeUndefined();
    expect(localSql(`select string_agg(field || ':' || status, ',' order by kind, field) from job_mail_changes where job_id = '${wrong.id}'`)).toBe("heat:undone,heat:dismissed");
    expect(localSql(`select message from job_events where job_id = '${wrong.id}' and data->>'reason' = 'wrong_job'`)).toMatch(/^Vráceno — e-mail patřil k jiné zakázce: Tepelné zpracování: kalení/);
    expect(itemRow(itemOf(right.id))).toMatchObject({ heat_status: "uvedeno", heat_treatment: "kalení" });
    expect(localSql(`select status from job_mail_changes where job_id = '${right.id}' and kind = 'change'`)).toBe("applied");
  }, 90_000);

  it("review #8: Vrátit starší změnu nepřepíše novější; vrácení novější obnoví starší", async () => {
    asA();
    const j = await newJob(`Undo ${TAG}`, [{ drawing: `U-1-${TAG}`, qty: 20 }]);
    const it1 = itemOf(j.id);
    const m1 = await rawMail({ subject: `${j.number} počet`, body_text: "Prosím 30 ks místo 20 ks." });
    await proc(m1.id);
    const m2 = await rawMail({ subject: `${j.number} počet znovu`, body_text: "Omlouvám se, nakonec 40 ks místo 30 ks." });
    await proc(m2.id);
    expect(itemRow(it1).q).toBe(40);
    const c1 = localSql(`select id from job_mail_changes where email_id = '${m1.id}' and kind = 'change'`);
    const c2 = localSql(`select id from job_mail_changes where email_id = '${m2.id}' and kind = 'change'`);
    expect(localSql(`select status from job_mail_changes where id = '${c1}'`)).toBe("superseded");
    const act = await import("@/app/actions/mail-jobs");
    expect((await act.undoMailChangeAction(c1)).ok).toBe(false);
    expect(itemRow(it1).q).toBe(40);
    // ruční změna položky mezitím → vrácení odmítnuto
    await svc.from("order_items").update({ quantity: 45 }).eq("id", it1);
    expect(await act.undoMailChangeAction(c2)).toMatchObject({ ok: false, error: expect.stringMatching(/mezitím změnila/) });
    await svc.from("order_items").update({ quantity: 40 }).eq("id", it1);
    expect(await act.undoMailChangeAction(c2)).toMatchObject({ ok: true });
    expect(itemRow(it1).q).toBe(30);
    expect(localSql(`select status from job_mail_changes where id = '${c1}'`)).toBe("applied");
    expect(await act.undoMailChangeAction(c1)).toMatchObject({ ok: true });
    expect(itemRow(it1).q).toBe(20);
  }, 90_000);

  it("review #4 (B5): faktura dodavatele z e-mailu → Faktury dodavatelů, ne dokumenty zakázky; zaměstnanec ani obchodník ji nevidí", async () => {
    asA();
    const j = await newJob(`Faktura ${TAG}`, [{ drawing: `F-1-${TAG}`, qty: 5 }]);
    const po = localSql("select next_doc_number('OV')");
    await svc.from("purchase_orders").insert({ job_id: j.id, supplier_id: supplierId, number: po, status: "odeslana" });
    const path = `mail-b/${TAG}/faktura.pdf`;
    const pdf = Buffer.from(`%PDF-1.4\n% faktura ${TAG} 12 345 Kč\n`);
    expect((await svc.storage.from("documents").upload(path, pdf, { contentType: "application/pdf" })).error).toBeNull();
    const m = await rawMail({ from_email: `obchod@${SUP}`, from_name: "Ocel", customer_id: null, supplier_id: supplierId, category: "faktura", subject: `Faktura 2026123 k objednávce ${po}`, body_text: "V příloze faktura.", has_attachments: true });
    await svc.from("email_attachments").insert({ email_id: m.id, filename: "Faktura_2026123.pdf", mime_type: "application/pdf", size_bytes: pdf.length, storage_path: path });
    await proc(m.id);
    await proc(m.id); // opakování nic nezdvojí
    expect(mailRow(m.id)).toMatchObject({ order_id: j.id, job_link_source: "po_number", category: "faktura" });
    expect(localSql(`select count(*) from job_files where job_id = '${j.id}'`)).toBe("0");
    expect(localSql(`select count(*) from supplier_invoices where email_id = '${m.id}'`)).toBe("1");
    expect(localSql(`select source || '|' || coalesce(supplier_id::text, '') from supplier_invoices where email_id = '${m.id}'`)).toBe(`email|${supplierId}`);
    const ev = localSql(`select message from job_events where job_id = '${j.id}' and data->>'action' = 'supplier_invoice'`);
    expect(ev).toMatch(/faktura dodavatele předána do Faktur dodavatelů/);
    expect(ev).not.toMatch(/2026123|12 345/);
    const data = await import("@/lib/data/job-mail");
    expect((await data.getJobCommunication(j.id))!.pendingFiles).toBe(0);
    // počkat na zpracování na pozadí (bez AI → ke kontrole), pak uklidit
    for (let i = 0; i < 40 && localSql(`select status from supplier_invoices where email_id = '${m.id}'`) === "nahrano"; i++) await new Promise((r) => setTimeout(r, 250));
    const inv = localSql(`select id from supplier_invoices where email_id = '${m.id}'`);
    const files = localSql(`select coalesce(string_agg(storage_path, ','), '') from supplier_invoice_files where invoice_id = '${inv}'`).split(",").filter(Boolean);
    if (files.length) await svc.storage.from("supplier-invoices").remove(files);
    await svc.from("supplier_invoices").delete().eq("id", inv);
    await svc.from("email_attachments").delete().eq("email_id", m.id);
    await svc.storage.from("documents").remove([path]);
  }, 90_000);

  // ── Review 2: špatná automatická změna na špatné zakázce / položce = špatné díly ──────────
  const surf = (id: string) => localSql(`select coalesce(surface_status, '') || '|' || coalesce(surface_treatment, '') from order_items where id = '${id}'`);
  async function jobThread(job: { id: string; number: string }, subject: string) {
    return rawMail({ direction: "out", from_email: USER, to_email: `jan@${DOM}`, subject, order_id: job.id, job_link_source: "sent", body_text: "Dobrý den, posíláme podklady.", is_read: true });
  }

  it("fix 1: odpověď ve vlákně zakázky B, jejíž vlastní text jmenuje zakázku A → nepřiřadit k B, jen „Patří k A?“, nic nepropsat; Ano → A", async () => {
    asA();
    const jA = await newJob(`Konflikt A ${TAG}`, [{ drawing: `KA-1-${TAG}`, qty: 10 }]);
    const jB = await newJob(`Konflikt B ${TAG}`, [{ drawing: `KB-1-${TAG}`, qty: 10 }]);
    const out = await jobThread(jB, `Podklady ${TAG} B`);
    const r1 = await rawMail({
      subject: `Re: Podklady ${TAG} B`, in_reply_to: out.message_id, message_refs: [out.message_id],
      body_text: `Dobrý den,\nk zakázce ${jA.number}: prosím zinkovat.\n\nS pozdravem Jan\n\nDne 29. 10. 2026 Adam napsal(a):\n> Dobrý den, posíláme podklady.`,
    });
    expect(r1.thread_id).toBe(out.thread_id);
    const res = await proc(r1.id);
    expect(res.linked).toBeUndefined();
    expect(res.suggested).toMatchObject({ jobId: jA.id });
    expect(mailRow(r1.id).order_id).toBeNull();
    const sg = JSON.parse(localSql(`select row_to_json(x) from (select id, status, thread_job_id, email_id, reasons from email_job_suggestions where thread_id = '${out.thread_id}' and job_id = '${jA.id}') x`));
    expect(sg).toMatchObject({ status: "pending", thread_job_id: jB.id, email_id: r1.id });
    expect(sg.reasons[0]).toContain(`jmenuje ${jA.number}`);
    // nic propsáno ani navrženo na B (ani na A — zpráva není přiřazená)
    expect(surf(itemOf(jB.id))).toBe("bez|");
    expect(surf(itemOf(jA.id))).toBe("bez|");
    expect(localSql(`select count(*) from job_mail_changes where email_id = '${r1.id}'`)).toBe("0");

    // pošta: vlákno u B s otázkou k jedné zprávě; Komunikace A ukáže „Patří sem?"
    const inbox = await import("@/app/actions/mail-inbox");
    const row = (await inbox.listThreadsAction({ folder: "jobs" })).items.find((t) => t.threadId === out.thread_id)!;
    expect(row).toMatchObject({ jobId: jB.id, suggestion: { id: sg.id, jobId: jA.id, forMessage: true } });
    expect(await inbox.openThreadAction(out.thread_id, { markRead: false })).toMatchObject({ jobId: jB.id, suggestion: { id: sg.id, forMessage: true } });
    const data = await import("@/lib/data/job-mail");
    expect((await data.getJobCommunication(jA.id))!.suggestions.map((s) => s.id)).toContain(sg.id);

    // další odpověď ve vlákně (bez jiné zakázky) se k B přiřadí, ale otázku ani zprávu r1 nesmete
    const r2 = await rawMail({ subject: `Re: Podklady ${TAG} B`, in_reply_to: out.message_id, message_refs: [out.message_id], body_text: "Děkuji, v pořádku.\n\nJan" });
    await proc(r2.id);
    expect(mailRow(r2.id).order_id).toBe(jB.id);
    expect(mailRow(r1.id).order_id).toBeNull();
    expect(localSql(`select status from email_job_suggestions where id = '${sg.id}'`)).toBe("pending");

    // „Ano" → zpráva k A, pokyn propsán na A (cíl potvrdil člověk), B beze změny
    const act = await import("@/app/actions/mail-jobs");
    expect(await act.confirmJobSuggestionAction(sg.id)).toMatchObject({ ok: true, jobId: jA.id });
    expect(mailRow(r1.id).order_id).toBe(jA.id);
    expect(mailRow(r2.id).order_id).toBe(jB.id);
    expect(surf(itemOf(jA.id))).toBe("uvedeno|zinkování");
    expect(surf(itemOf(jB.id))).toBe("bez|");
  }, 90_000);

  it("fix 1: „Ne“ u otázky → zpráva patří k zakázce vlákna, pokyny jen jako návrhy; slabý konflikt (jen výkres jiné zakázky) = vlákno, ale jen návrhy", async () => {
    asA();
    const jA = await newJob(`Ne A ${TAG}`, [{ drawing: `NA-1-${TAG}`, qty: 10 }]);
    const jB = await newJob(`Ne B ${TAG}`, [{ drawing: `NB-1-${TAG}`, qty: 10 }]);
    const out = await jobThread(jB, `Ne ${TAG} B`);
    const r1 = await rawMail({ subject: `Re: Ne ${TAG} B`, in_reply_to: out.message_id, message_refs: [out.message_id], body_text: `Dobrý den, k ${jA.number} prosím zinkovat.\n\nJan` });
    await proc(r1.id);
    const sid = localSql(`select id from email_job_suggestions where thread_id = '${out.thread_id}' and job_id = '${jA.id}'`);
    const act = await import("@/app/actions/mail-jobs");
    expect(await act.rejectJobSuggestionAction(sid)).toMatchObject({ ok: true });
    expect(mailRow(r1.id).order_id).toBe(jB.id);
    expect(surf(itemOf(jB.id))).toBe("bez|");
    const ch = JSON.parse(localSql(`select row_to_json(x) from (select status, hold_reason, hold_job_number from job_mail_changes where email_id = '${r1.id}' and kind = 'change') x`));
    expect(ch).toEqual({ status: "suggested", hold_reason: "other_job", hold_job_number: jA.number });
    expect(localSql(`select message from job_events where job_id = '${jB.id}' and data->>'action' = 'mail_change'`)).toMatch(new RegExp(`návrh \\(e-mail jmenuje i zakázku ${jA.number}\\)`));
    const data = await import("@/lib/data/job-mail");
    const view = (await data.getJobCommunication(jB.id))!.changes.find((c) => c.kind === "change")!;
    expect(view).toMatchObject({ status: "suggested", hold: "other_job", holdJobNumber: jA.number });

    // slabý konflikt: odpověď ve vlákně B jmenuje jen výkres zakázky A → přiřadit k B, ale jen návrh
    const r2 = await rawMail({ subject: `Re: Ne ${TAG} B`, in_reply_to: out.message_id, message_refs: [out.message_id], body_text: `K výkresu NA-1-${TAG} prosím kalit.\n\nJan` });
    const res = await proc(r2.id);
    expect(mailRow(r2.id).order_id).toBe(jB.id);
    expect(res.held).toMatchObject({ reason: "other_job", jobNumber: jA.number });
    expect(itemRow(itemOf(jB.id))).toMatchObject({ heat_status: "bez", heat_treatment: null });
    expect(localSql(`select status || '|' || hold_reason from job_mail_changes where email_id = '${r2.id}' and kind = 'change'`)).toBe("suggested|other_job");
    // bez konfliktu (vlastní text bez jiné zakázky) se dál propisuje automaticky
    const r3 = await rawMail({ subject: `Re: Ne ${TAG} B`, in_reply_to: out.message_id, message_refs: [out.message_id], body_text: "Ještě prosím 12 ks místo 10 ks.\n\nJan" });
    await proc(r3.id);
    expect(itemRow(itemOf(jB.id)).q).toBe(12);
  }, 90_000);

  const suggOf = (threadId: string, jobId: string) => JSON.parse(localSql(`select row_to_json(x) from (select id, status, email_id, thread_job_id from email_job_suggestions where thread_id = '${threadId}' and job_id = '${jobId}') x`) || "null");

  it("fix V2d: dvě otázky v jednom vlákně (E, F); „Ano“ u E přiřadí jen tu zprávu — zpráva jmenující F zůstane s otevřenou otázkou a na E se nic z ní nepropíše", async () => {
    asA();
    const jA = await newJob(`Dvě A ${TAG}`, [{ drawing: `DA-1-${TAG}`, qty: 10 }]);
    const jE = await newJob(`Dvě E ${TAG}`, [{ drawing: `DE-1-${TAG}`, qty: 10 }]);
    const jF = await newJob(`Dvě F ${TAG}`, [{ drawing: `DF-1-${TAG}`, qty: 10 }]);
    const out = await jobThread(jA, `Dvě ${TAG} A`);
    const hdr = { subject: `Re: Dvě ${TAG} A`, in_reply_to: out.message_id, message_refs: [out.message_id] };
    const m1 = await rawMail({ ...hdr, body_text: `Dobrý den, k zakázce ${jE.number}: prosím zinkovat.\n\nJan` });
    expect((await proc(m1.id)).suggested).toMatchObject({ jobId: jE.id });
    // druhá odpověď: kategorie z pravidel „Nabídka dodavatele" (z „Re: Nabídka…") — do rozhodnutí se neukazuje (fix 3)
    const m2 = await rawMail({ ...hdr, category: "nabidka_dodavatele", body_text: `Dobrý den, k zakázce ${jF.number}: prosím kalit.\n\nJan` });
    expect((await proc(m2.id)).suggested).toMatchObject({ jobId: jF.id });
    const sE = suggOf(out.thread_id, jE.id);
    const sF = suggOf(out.thread_id, jF.id);
    expect(sE).toMatchObject({ status: "pending", email_id: m1.id, thread_job_id: jA.id });
    expect(sF).toMatchObject({ status: "pending", email_id: m2.id, thread_job_id: jA.id });

    // fix 3: otázka nese id své zprávy (řádek i detail vlákna ukážou u ní neutrální „K zakázce?")
    const inbox = await import("@/app/actions/mail-inbox");
    const row = (await inbox.listThreadsAction({ folder: "jobs" })).items.find((t) => t.threadId === out.thread_id)!;
    expect(row.emailId).toBe(m2.id);
    expect(row.category).toBe("Nabídka dodavatele");
    const pair = (s: { jobId: string; emailId?: string } | null | undefined) => s && (s.jobId === jE.id ? s.emailId === m1.id : s.jobId === jF.id && s.emailId === m2.id);
    expect(row.suggestion).toMatchObject({ forMessage: true });
    expect(pair(row.suggestion)).toBe(true);
    const det = await inbox.openThreadAction(out.thread_id, { markRead: false });
    expect(det.suggestion).toMatchObject({ forMessage: true });
    expect(pair(det.suggestion)).toBe(true);

    const act = await import("@/app/actions/mail-jobs");
    expect(await act.confirmJobSuggestionAction(sE.id)).toMatchObject({ ok: true, jobId: jE.id, jobNumber: jE.number });
    expect(mailRow(m1.id)).toMatchObject({ order_id: jE.id, category: "k_zakazce", job_link_source: "manual", thread_id: out.thread_id });
    expect(mailRow(m2.id).order_id).toBeNull();
    expect(mailRow(out.id).order_id).toBe(jA.id);
    expect(suggOf(out.thread_id, jE.id).status).toBe("accepted");
    expect(suggOf(out.thread_id, jF.id)).toMatchObject({ status: "pending", email_id: m2.id });
    expect(surf(itemOf(jE.id))).toBe("uvedeno|zinkování");
    expect(itemRow(itemOf(jE.id)).heat_status).toBe("bez");
    expect(itemRow(itemOf(jF.id)).heat_status).toBe("bez");
    expect(itemRow(itemOf(jA.id)).heat_status).toBe("bez");
    expect(surf(itemOf(jA.id))).toBe("bez|");
    expect(localSql(`select count(*) from job_mail_changes where email_id = '${m2.id}'`)).toBe("0");
    expect(localSql(`select count(*) from job_events where job_id = '${jE.id}' and type = 'email' and data->>'action' = 'linked'`)).toBe("1");
    // otázka F dál v poště i v Komunikaci F
    const data = await import("@/lib/data/job-mail");
    expect((await data.getJobCommunication(jF.id))!.suggestions.map((s) => s.id)).toContain(sF.id);

    // „Ano" u F: jen m2 → F, kalení na F; m1 zůstane u E
    expect(await act.confirmJobSuggestionAction(sF.id)).toMatchObject({ ok: true, jobId: jF.id });
    expect(mailRow(m2.id)).toMatchObject({ order_id: jF.id, category: "k_zakazce" });
    expect(mailRow(m1.id).order_id).toBe(jE.id);
    expect(itemRow(itemOf(jF.id))).toMatchObject({ heat_status: "uvedeno", heat_treatment: "kalení" });
    expect(itemRow(itemOf(jE.id)).heat_status).toBe("bez");
    // vyřízená otázka znovu: chyba, nic se nepohne
    expect(await act.confirmJobSuggestionAction(sF.id)).toMatchObject({ ok: false });
  }, 120_000);

  it("fix V2d-Ne: „Ano“ u novější otázky (H), pak „Ne“ u starší (G) → zpráva jde k zakázce vlákna A (ne k H), pokyny jen jako návrh", async () => {
    asA();
    const jA = await newJob(`Ne2 A ${TAG}`, [{ drawing: `N2A-1-${TAG}`, qty: 10 }]);
    const jG = await newJob(`Ne2 G ${TAG}`, [{ drawing: `N2G-1-${TAG}`, qty: 10 }]);
    const jH = await newJob(`Ne2 H ${TAG}`, [{ drawing: `N2H-1-${TAG}`, qty: 10 }]);
    const out = await jobThread(jA, `Ne2 ${TAG} A`);
    const hdr = { subject: `Re: Ne2 ${TAG} A`, in_reply_to: out.message_id, message_refs: [out.message_id] };
    const mG = await rawMail({ ...hdr, body_text: `Dobrý den, k zakázce ${jG.number}: prosím černit.\n\nJan` });
    expect((await proc(mG.id)).suggested).toMatchObject({ jobId: jG.id });
    const mH = await rawMail({ ...hdr, body_text: `Dobrý den, k zakázce ${jH.number}: prosím kalit.\n\nJan` });
    expect((await proc(mH.id)).suggested).toMatchObject({ jobId: jH.id });
    const sG = suggOf(out.thread_id, jG.id);
    const sH = suggOf(out.thread_id, jH.id);
    expect(sG).toMatchObject({ status: "pending", email_id: mG.id, thread_job_id: jA.id });

    const act = await import("@/app/actions/mail-jobs");
    expect(await act.confirmJobSuggestionAction(sH.id)).toMatchObject({ ok: true, jobId: jH.id });
    expect(mailRow(mH.id).order_id).toBe(jH.id);
    // „Ne" u G: zpráva patří k zakázce vlákna z doby otázky (A), ne k naposledy přiřazené H
    expect(await act.rejectJobSuggestionAction(sG.id)).toMatchObject({ ok: true });
    expect(mailRow(mG.id).order_id).toBe(jA.id);
    expect(suggOf(out.thread_id, jG.id).status).toBe("rejected");
    // jmenovala jinou zakázku → na A nic automaticky, na H nic z ní
    expect(surf(itemOf(jA.id))).toBe("bez|");
    expect(itemRow(itemOf(jH.id))).toMatchObject({ heat_status: "uvedeno", heat_treatment: "kalení" });
    expect(localSql(`select count(*) from job_mail_changes where email_id = '${mG.id}' and job_id = '${jH.id}'`)).toBe("0");
  }, 120_000);

  it("fix V2e: odpověď ve vlákně A s předmětem změněným na číslo zakázky B (tělo bez čísla) → otázka „Patří k B?“, nic nepropsat; po „Ne“ zděděný předmět už neptá", async () => {
    asA();
    const jA = await newJob(`Předmět A ${TAG}`, [{ drawing: `PA-1-${TAG}`, qty: 10 }]);
    const jB = await newJob(`Předmět B ${TAG}`, [{ drawing: `PB-1-${TAG}`, qty: 10 }]);
    const out = await jobThread(jA, `Nabídka hřídel ${TAG} A`);
    const r1 = await rawMail({ subject: `Re: ${jB.number} změna`, in_reply_to: out.message_id, message_refs: [out.message_id], body_text: "Dobrý den, prosím zinkovat a dodat co nejdřív.\n\nJan" });
    expect(r1.thread_id).toBe(out.thread_id);
    const res = await proc(r1.id);
    expect(res.linked).toBeUndefined();
    expect(res.suggested).toMatchObject({ jobId: jB.id });
    expect(mailRow(r1.id).order_id).toBeNull();
    expect(suggOf(out.thread_id, jB.id)).toMatchObject({ status: "pending", email_id: r1.id, thread_job_id: jA.id });
    expect(surf(itemOf(jA.id))).toBe("bez|");
    expect(surf(itemOf(jB.id))).toBe("bez|");
    expect(localSql(`select count(*) from job_mail_changes where email_id = '${r1.id}'`)).toBe("0");
    // předmět jmenuje i zakázku vlákna → přiřadit vláknem, ale změny jen jako návrh
    const r0 = await rawMail({ subject: `Re: ${jA.number} a ${jB.number}`, in_reply_to: out.message_id, message_refs: [out.message_id], body_text: "Prosím 12 ks místo 10 ks.\n\nJan" });
    const res0 = await proc(r0.id);
    expect(mailRow(r0.id).order_id).toBe(jA.id);
    expect(res0.held).toMatchObject({ reason: "other_job", jobNumber: jB.number });
    expect(itemRow(itemOf(jA.id)).q).toBe(10);

    // „Ne" → r1 k A (pokyn jen návrh); další odpověď se zděděným předmětem se už neptá a propíše se na A
    const act = await import("@/app/actions/mail-jobs");
    expect(await act.rejectJobSuggestionAction(suggOf(out.thread_id, jB.id).id)).toMatchObject({ ok: true });
    expect(mailRow(r1.id).order_id).toBe(jA.id);
    expect(surf(itemOf(jA.id))).toBe("bez|");
    const r2 = await rawMail({ subject: `Re: Re: ${jB.number} změna`, in_reply_to: r1.message_id, message_refs: [out.message_id, r1.message_id], body_text: "Ještě prosím kalit.\n\nJan" });
    const res2 = await proc(r2.id);
    expect(mailRow(r2.id).order_id).toBe(jA.id);
    expect(res2.held).toBeUndefined();
    expect(itemRow(itemOf(jA.id))).toMatchObject({ heat_status: "uvedeno", heat_treatment: "kalení" });
    expect(itemRow(itemOf(jB.id)).heat_status).toBe("bez");
  }, 120_000);

  it("fix 4: víc nabídek téže jiné zakázky — kandidáti vrátí každou zmíněnou, konflikt nepřehlédne tu z textu", async () => {
    asA();
    const jA = await newJob(`Víc A ${TAG}`, [{ drawing: `VA-1-${TAG}`, qty: 10 }]);
    const jG = await newJob(`Víc G ${TAG}`, [{ drawing: `VG-1-${TAG}`, qty: 10 }]);
    const base = 90000 + Math.floor(Math.random() * 9000);
    const [n1, n2] = [`NAB-2026-${base}`, `NAB-2026-${base + 1}`];
    for (const n of [n1, `${n2}-R2`]) {
      const { error } = await svc.from("quotes").insert({ job_id: jG.id, number: n, status: "navrh_ai", total: 1000, revision: 1 });
      expect(error).toBeNull();
    }
    const out = await jobThread(jA, `Víc ${TAG} A (${n1})`);
    // předmět zděděný z vlákna jmenuje první nabídku G (bez konfliktu), vlastní text druhou
    const r = await rawMail({ subject: `Re: Víc ${TAG} A (${n1})`, in_reply_to: out.message_id, message_refs: [out.message_id], body_text: `Dobrý den, k nabídce ${n2} prosím zinkovat.\n\nJan` });
    expect(localSql(`select count(*) from mail_job_candidates('${r.id}', null, '{}', array['${n1}', '${n2}'], '{}', null, null) where job_id = '${jG.id}' and signal = 'quote_number'`)).toBe("2");
    const res = await proc(r.id);
    expect(res.suggested).toMatchObject({ jobId: jG.id });
    expect(mailRow(r.id).order_id).toBeNull();
    expect(surf(itemOf(jA.id))).toBe("bez|");
  }, 90_000);

  it("fix 2: „X místo Y“ propsat jen když Y je na položce; jinak návrh „e-mail: X místo Y, na položce je Z“", async () => {
    asA();
    const j = await newJob(`Místo ${TAG}`, [{ drawing: `M-1-${TAG}`, qty: 20 }]);
    const it1 = itemOf(j.id);
    const m1 = await rawMail({ subject: `${j.number} materiál`, body_text: "Dobrý den, materiál 1.4301 místo 1.4305 a 30 ks místo 25 ks.\n\nJan" });
    await proc(m1.id);
    expect(itemRow(it1)).toMatchObject({ q: 20, material: "11 523" });
    const ch = JSON.parse(localSql(`select json_agg(row_to_json(x) order by x.field) from (select field, status, hold_reason, value_mail_old, value_prev from job_mail_changes where email_id = '${m1.id}' and kind = 'change') x`));
    expect(ch).toEqual([
      { field: "material", status: "suggested", hold_reason: "mismatch", value_mail_old: "1.4305", value_prev: "11 523" },
      { field: "quantity", status: "suggested", hold_reason: "mismatch", value_mail_old: "25 ks", value_prev: "20 ks" },
    ]);
    const ev = localSql(`select string_agg(message, ' || ') from job_events where job_id = '${j.id}' and data->>'action' = 'mail_change'`);
    expect(ev).toContain("e-mail: 1.4301 místo 1.4305, na položce je 11 523");
    expect(ev).toContain("e-mail: 30 ks místo 25 ks, na položce je 20 ks");
    const data = await import("@/lib/data/job-mail");
    expect((await data.getJobCommunication(j.id))!.changes.find((c) => c.field === "material")).toMatchObject({ hold: "mismatch", mailOld: "1.4305", valuePrev: "11 523" });
    // Y sedí (i jinak zapsané „11523") → propsat automaticky
    const m2 = await rawMail({ subject: `${j.number} materiál znovu`, body_text: "Omlouvám se: materiál 1.4404 místo 11523, počet 30 ks místo 20 ks.\n\nJan" });
    await proc(m2.id);
    expect(itemRow(it1)).toMatchObject({ q: 30, material: "1.4404" });
    expect(localSql(`select string_agg(status, ',' order by field) from job_mail_changes where email_id = '${m2.id}' and kind = 'change'`)).toBe("applied,applied");
  }, 90_000);

  it("fix 3: ruční úprava propsané hodnoty (Položky → Uložit) = „nahrazeno ruční úpravou“, bez odznaku a bez selhávajícího Vrátit; Znovu propsat jde", async () => {
    asA();
    const j = await newJob(`Ruční ${TAG}`, [{ drawing: `RU-1-${TAG}`, qty: 20 }]);
    const it1 = itemOf(j.id);
    const m = await rawMail({ subject: `${j.number} upřesnění`, body_text: "Prosím 30 ks místo 20 ks a vyrazit číslo dílu na čelo.\n\nJan" });
    await proc(m.id);
    const qId = localSql(`select id from job_mail_changes where email_id = '${m.id}' and field = 'quantity' and kind = 'change'`);
    const nId = localSql(`select id from job_mail_changes where email_id = '${m.id}' and field = 'marking' and kind = 'change'`);
    expect(localSql(`select status from job_mail_changes where id in ('${qId}', '${nId}') group by status`)).toBe("applied");
    const row = JSON.parse(localSql(`select row_to_json(x) from (select id, drawing_number, name, quantity::int q, material, note, unit from order_items where id = '${it1}') x`));
    expect(row.note).toContain("vyrazit číslo dílu");
    const jobsAct = await import("@/app/actions/jobs");
    const save = (over: Partial<{ quantity: number; note: string; material: string }>) => jobsAct.saveJobItems(j.id, [{
      id: it1, drawingNumber: row.drawing_number, name: row.name, quantity: over.quantity ?? row.q, material: over.material ?? row.material, unit: row.unit, note: over.note ?? row.note,
    }]);
    // uložení beze změny (a s ručně připsaným řádkem poznámky) změny z e-mailu nechá
    expect((await save({ note: `${row.note}\nRuční řádek` })).ok).toBe(true);
    expect(localSql(`select string_agg(status, ',' order by field) from job_mail_changes where id in ('${qId}', '${nId}')`)).toBe("applied,applied");
    // ručně přepsaný počet → nahrazeno; poznámka s řádkem z e-mailu dál platí
    expect((await save({ quantity: 35, note: `${row.note}\nRuční řádek` })).ok).toBe(true);
    expect(localSql(`select status from job_mail_changes where id = '${qId}'`)).toBe("replaced");
    expect(localSql(`select status from job_mail_changes where id = '${nId}'`)).toBe("applied");
    const data = await import("@/lib/data/job-mail");
    const comm = (await data.getJobCommunication(j.id))!;
    expect(comm.changes.find((c) => c.id === qId)!.status).toBe("replaced");
    const act = await import("@/app/actions/mail-jobs");
    expect(await act.undoMailChangeAction(qId)).toMatchObject({ ok: false, error: "Tuto změnu nejde vrátit." });
    // vrácení poznámkového pokynu odebere jen jeho řádek (ruční řádek zůstane)
    expect(await act.undoMailChangeAction(nId)).toMatchObject({ ok: true });
    expect(localSql(`select note from order_items where id = '${it1}'`)).toBe("Ruční řádek");
    // znovu propsat nahrazenou změnu
    expect(await act.applyMailChangeAction(qId)).toMatchObject({ ok: true });
    expect(itemRow(it1).q).toBe(30);
    // úprava mimo Položky (jiná cesta) → v Komunikaci hned „nahrazeno" (bez Vrátit), i když DB ještě „applied"
    await svc.from("order_items").update({ quantity: 33 }).eq("id", it1);
    expect(localSql(`select status from job_mail_changes where id = '${qId}'`)).toBe("applied");
    expect((await data.getJobCommunication(j.id))!.changes.find((c) => c.id === qId)!.status).toBe("replaced");
  }, 90_000);

  it("fix 4 + 5: indexy párování; přiřazení e-mailu k zakázce = jeden řádek v historii", async () => {
    asA();
    expect(localSql(`select count(*) from pg_indexes where indexname in ('idx_order_items_drawing_norm', 'idx_orders_customer_order_norm', 'idx_orders_number_upper', 'idx_quotes_number_base', 'idx_po_number_upper')`)).toBe("5");
    const j = await newJob(`Jeden řádek ${TAG}`, [{ drawing: `JR-1-${TAG}`, qty: 5 }]);
    const a1 = await rawMail({ subject: `Jeden řádek ${TAG}`, customer_id: null, from_email: `x@neznamy-${TAG}.test`, body_text: "Dobrý den, posílám výkres." });
    const a2 = await rawMail({ subject: `Re: Jeden řádek ${TAG}`, customer_id: null, from_email: `x@neznamy-${TAG}.test`, in_reply_to: a1.message_id, message_refs: [a1.message_id], body_text: "Doplňuji." });
    expect(a2.thread_id).toBe(a1.thread_id);
    const mail = await import("@/app/actions/mail");
    expect(await mail.linkEmailToJob(a1.id, j.id)).toMatchObject({ ok: true });
    expect(mailRow(a1.id)).toMatchObject({ order_id: j.id, job_link_source: "manual" });
    expect(mailRow(a2.id).order_id).toBe(j.id);
    expect(localSql(`select count(*) from job_events where job_id = '${j.id}' and type = 'email' and data->>'action' = 'linked'`)).toBe("1");
    expect(await mail.linkEmailToJob(a1.id, j.id)).toMatchObject({ ok: true });
    expect(localSql(`select count(*) from job_events where job_id = '${j.id}' and type = 'email' and data->>'action' = 'linked'`)).toBe("1");
  }, 60_000);

  it("review #13: citace z e-mailu přes REST nikdo nepřečte (ostatní sloupce dle RLS)", async () => {
    const s = await (await import("@/test/local-supabase")).localSession(users.w!.email, `Heslo-${TAG}-1!`);
    const { error } = await s.from("job_mail_changes").select("id, quote").limit(1);
    expect(error?.message ?? "").toMatch(/permission denied/i);
    const ok = await s.from("job_mail_changes").select("id, summary").eq("job_id", job1.id);
    expect(ok.error).toBeNull();
    expect((ok.data ?? []).length).toBeGreaterThan(0);
  }, 30_000);
});
