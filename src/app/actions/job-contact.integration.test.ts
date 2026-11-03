import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Kontaktní osoba zakázky = kontakt z Karty zákazníka (majitel 3. 11.) proti lokálnímu Supabase:
 *  • výběr kontaktu → jméno, e-mail i telefon jdou s ním (historie „Kontaktní osoba: A → B");
 *  • úprava kontaktu v Kartě zákazníka → propojené zakázky se změní (spouštěč DB);
 *  • změna zákazníka → hlavní kontakt nového zákazníka (bez kontaktů → prázdné);
 *  • „Přidat kontakt …" (newCustomerContact) založí kontakt v kartě a propojí ho; stejný e-mail = existující;
 *  • telefon / e-mail jiné osoby nastavit nejde (akce ani přímý zápis do DB), kontakt cizího zákazníka odmítne;
 *  • zápis e-mailu, který má kontakt zákazníka (AI / focení), zakázku propojí sám.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/app/actions/job-contact.integration.test.ts
 */

const ENABLED = process.env.LOCAL_SUPABASE === "1";
const TAG = Date.now().toString(36);
const PREFIX = `Z-E2E-KT-${TAG}`;

const who = vi.hoisted(() => ({ user: null as null | { id: string; email: string; fullName: string; role: "super_admin" } }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/supabase/server", async () => {
  const local = await import("@/test/local-supabase");
  const headers = await import("@/lib/supabase/actor-headers");
  return {
    isSupabaseConfigured: () => true,
    hasServiceKey: () => true,
    createAdminClient: () => local.localAdmin(headers.SYSTEM_ACTOR),
    createOperatorClient: async (opts: { actor?: unknown } = {}) => local.localAdmin((opts.actor as never) ?? headers.userActor(who.user ? { id: who.user.id } : null)),
    createClient: async () => { throw new Error("Bez session (test)."); },
  };
});
vi.mock("@/lib/auth/session", async () => {
  const perms = await import("@/lib/auth/permissions");
  const user = () => ({ ...who.user!, initials: "SA", roleLabel: "Super admin", aiAccess: true, active: true, hasProfile: true, mustChangePassword: false });
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
interface Contact { id: string; name: string; email: string | null; phone: string | null }

describe.skipIf(!ENABLED)("Kontaktní osoba zakázky z Karty zákazníka (lokální Supabase)", () => {
  let svc: SupabaseClient;
  const jobs: string[] = [];
  const customers: string[] = [];
  let n = 0;
  let acme = "";
  let beta = "";
  let empty = "";
  let pavel: Contact;
  let jana: Contact;
  let betaBoss: Contact;

  async function customer(name: string): Promise<string> {
    const { data, error } = await svc.from("customers").insert({ name: `${name} ${TAG}` }).select("id").single();
    if (error) throw new Error(error.message);
    customers.push((data as { id: string }).id);
    return (data as { id: string }).id;
  }
  async function contact(customerId: string, c: Partial<Contact> & { is_primary?: boolean; position?: string }): Promise<Contact> {
    const { data, error } = await svc.from("customer_contacts").insert({ customer_id: customerId, ...c }).select("id, name, email, phone").single();
    if (error) throw new Error(error.message);
    return data as Contact;
  }
  async function newJob(patch: Row = {}): Promise<string> {
    n += 1;
    const { data, error } = await svc.from("orders").insert({ number: `${PREFIX}-${n}`, title: `KT ${n}`, source: "manual", ...patch }).select("id").single();
    if (error) throw new Error(error.message);
    jobs.push((data as { id: string }).id);
    return (data as { id: string }).id;
  }
  async function job(id: string): Promise<Row> {
    const { data } = await svc.from("orders").select("customer_id, customer_contact_id, customer_contact, customer_contact_email, customer_contact_phone").eq("id", id).single();
    return data as Row;
  }
  const linkedTo = (c: Contact | null) => c
    ? { customer_contact_id: c.id, customer_contact: c.name, customer_contact_email: c.email, customer_contact_phone: c.phone }
    : { customer_contact_id: null, customer_contact: null, customer_contact_email: null, customer_contact_phone: null };

  beforeAll(async () => {
    const { localAdmin, profileId, DEMO } = await import("@/test/local-supabase");
    svc = localAdmin();
    who.user = { id: await profileId(svc, DEMO.admin.email), email: DEMO.admin.email, fullName: "Super Admin", role: "super_admin" };
    acme = await customer("Acme");
    beta = await customer("Beta");
    empty = await customer("Bez kontaktů");
    pavel = await contact(acme, { name: "Ing. Pavel Novák", email: `pavel@acme-${TAG}.test`, phone: "+420 777 000 111", position: "nákupčí", is_primary: true });
    jana = await contact(acme, { name: "Jana Malá", email: `jana@acme-${TAG}.test`, phone: "+420 777 000 222", position: "technik" });
    betaBoss = await contact(beta, { name: "Boris Beta", email: `boris@beta-${TAG}.test`, phone: "+420 600 000 333", is_primary: true });
  }, 60_000);

  afterAll(async () => {
    if (!svc) return;
    if (jobs.length) {
      await svc.from("job_events").delete().in("job_id", jobs);
      await svc.from("orders").delete().in("id", jobs);
    }
    if (customers.length) {
      await svc.from("customer_contacts").delete().in("customer_id", customers);
      await svc.from("customers").delete().in("id", customers);
    }
  }, 60_000);

  it("výběr kontaktu → jméno, e-mail i telefon jdou s ním; historie ukáže změnu osoby", async () => {
    const { updateJob } = await import("./jobs");
    const id = await newJob({ customer_id: acme });
    expect(await updateJob(id, { customerContactId: pavel.id })).toEqual({ ok: true });
    expect(await job(id)).toMatchObject(linkedTo(pavel));

    expect(await updateJob(id, { customerContactId: jana.id })).toEqual({ ok: true });
    expect(await job(id)).toMatchObject(linkedTo(jana));
    const { data: evs } = await svc.from("job_events").select("message, data").eq("job_id", id).eq("type", "field").order("created_at");
    const last = (evs ?? []).at(-1) as { message: string; data: { changes: { field: string }[] } };
    expect(last.data.changes.map((c) => c.field).sort()).toEqual(["customer_contact", "customer_contact_email", "customer_contact_phone"]);
    expect(last.message).toContain("Kontaktní osoba");

    // zrušení výběru → vše prázdné
    expect(await updateJob(id, { customerContactId: null })).toEqual({ ok: true });
    expect(await job(id)).toMatchObject(linkedTo(null));
  });

  it("úprava kontaktu v Kartě zákazníka se propíše do propojených zakázek", async () => {
    const { updateJob } = await import("./jobs");
    const id = await newJob({ customer_id: acme });
    const other = await newJob({ customer_id: acme, customer_contact: "Někdo jiný", customer_contact_email: `jiny@acme-${TAG}.test` });
    expect(await updateJob(id, { customerContactId: jana.id })).toEqual({ ok: true });
    const { error } = await svc.from("customer_contacts").update({ phone: "+420 999 888 777", email: `jana.mala@acme-${TAG}.test`, name: "Jana Malá-Nová" }).eq("id", jana.id);
    expect(error).toBeNull();
    jana = { ...jana, phone: "+420 999 888 777", email: `jana.mala@acme-${TAG}.test`, name: "Jana Malá-Nová" };
    expect(await job(id)).toMatchObject(linkedTo(jana));
    // nepropojená zakázka zůstala beze změny
    expect(await job(other)).toMatchObject({ customer_contact_id: null, customer_contact: "Někdo jiný" });

    // smazání kontaktu vazbu zruší, text zůstane jako starý údaj
    const tmp = await contact(acme, { name: "Dočasný", email: `docasny@acme-${TAG}.test`, phone: "1" });
    const j2 = await newJob({ customer_id: acme });
    expect(await updateJob(j2, { customerContactId: tmp.id })).toEqual({ ok: true });
    await svc.from("customer_contacts").delete().eq("id", tmp.id);
    expect(await job(j2)).toMatchObject({ customer_contact_id: null, customer_contact: "Dočasný" });
  });

  it("změna zákazníka → hlavní kontakt nového zákazníka; bez kontaktů → prázdné", async () => {
    const { updateJob } = await import("./jobs");
    const id = await newJob({ customer_id: acme });
    expect(await updateJob(id, { customerContactId: jana.id })).toEqual({ ok: true });
    expect(await updateJob(id, { customerId: beta })).toEqual({ ok: true });
    expect(await job(id)).toMatchObject({ customer_id: beta, ...linkedTo(betaBoss) });
    expect(await updateJob(id, { customerId: empty })).toEqual({ ok: true });
    expect(await job(id)).toMatchObject({ customer_id: empty, ...linkedTo(null) });

    // přímý zápis jiného zákazníka do DB (bez akce) vazbu na cizí kontakt odpojí i s údaji osoby
    const j2 = await newJob({ customer_id: acme });
    expect(await updateJob(j2, { customerContactId: pavel.id })).toEqual({ ok: true });
    await svc.from("orders").update({ customer_id: empty }).eq("id", j2);
    expect(await job(j2)).toMatchObject({ customer_id: empty, ...linkedTo(null) });
  });

  it("„Přidat kontakt …“ založí kontakt v kartě zákazníka a propojí ho; stejný e-mail použije existující", async () => {
    const { updateJob } = await import("./jobs");
    const id = await newJob({ customer_id: empty });
    const mail = `nova.osoba@empty-${TAG}.test`;
    expect(await updateJob(id, { newCustomerContact: { email: ` ${mail.toUpperCase()} ` } })).toEqual({ ok: true });
    const { data: created } = await svc.from("customer_contacts").select("id, name, email, phone, is_primary").eq("customer_id", empty);
    expect(created).toHaveLength(1);
    const k = (created as (Contact & { is_primary: boolean })[])[0];
    expect(k).toMatchObject({ name: "Nova Osoba", email: mail, is_primary: true });
    expect(await job(id)).toMatchObject(linkedTo(k));

    const j2 = await newJob({ customer_id: empty });
    expect(await updateJob(j2, { newCustomerContact: { email: mail } })).toEqual({ ok: true });
    expect(await svc.from("customer_contacts").select("id").eq("customer_id", empty).then((r) => r.data?.length)).toBe(1);
    expect(await job(j2)).toMatchObject({ customer_contact_id: k.id });

    // jen jméno
    expect(await updateJob(j2, { newCustomerContact: { name: "Petr Jménem" } })).toEqual({ ok: true });
    expect(await job(j2)).toMatchObject({ customer_contact: "Petr Jménem", customer_contact_email: null });

    // bez zákazníka / neplatný e-mail → česká chyba
    const j3 = await newJob();
    expect(await updateJob(j3, { newCustomerContact: { name: "X" } })).toMatchObject({ ok: false, error: expect.stringContaining("Nejdřív vyber zákazníka") });
    expect(await updateJob(j3, { newCustomerContact: { email: "spatne" } })).toMatchObject({ ok: false, error: "Neplatný e-mail kontaktní osoby." });
  });

  it("telefon ani e-mail jiné osoby nastavit nejde; kontakt cizího zákazníka odmítne", async () => {
    const { updateJob } = await import("./jobs");
    const id = await newJob({ customer_id: acme });
    expect(await updateJob(id, { customerContactId: pavel.id })).toEqual({ ok: true });

    // akce: samostatná úprava textů se ignoruje
    expect(await updateJob(id, { customerContactPhone: "+420 111 111 111", customerContactEmail: "cizi@x.test", customerContact: "Podvrh" })).toEqual({ ok: true });
    expect(await job(id)).toMatchObject(linkedTo(pavel));

    // přímý zápis do DB: pojistka vrátí hodnoty kontaktu
    await svc.from("orders").update({ customer_contact_phone: jana.phone, customer_contact: jana.name }).eq("id", id);
    expect(await job(id)).toMatchObject(linkedTo(pavel));

    // kontakt jiného zákazníka
    const r = await updateJob(id, { customerContactId: betaBoss.id });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("nepatří k zákazníkovi") });
    await svc.from("orders").update({ customer_contact_id: betaBoss.id }).eq("id", id);
    expect((await job(id)).customer_contact_id).not.toBe(betaBoss.id);
  });

  it("zakázka s e-mailem kontaktu zákazníka (AI / focení) se propojí sama; detail nese kontakty", async () => {
    const id = await newJob({ customer_id: acme, customer_contact: "P. Novák", customer_contact_email: pavel.email!.toUpperCase(), customer_contact_phone: null });
    expect(await job(id)).toMatchObject(linkedTo(pavel));
    const unknown = await newJob({ customer_id: acme, customer_contact: "Neznámý", customer_contact_email: `neznamy@jinde-${TAG}.test` });
    expect(await job(unknown)).toMatchObject({ customer_contact_id: null, customer_contact: "Neznámý" });

    const { JOB_DETAIL_SELECT, rowToJobDetail } = await import("@/lib/jobs/mapping");
    const { data, error } = await svc.from("orders").select(JOB_DETAIL_SELECT).eq("id", id).single();
    expect(error).toBeNull();
    const d = rowToJobDetail(data as never, { quotes: [], files: [], events: [] }, { margins: true });
    expect(d.customerContactId).toBe(pavel.id);
    expect(d.customerDetail?.contacts.map((k) => k.id)).toEqual([pavel.id, jana.id]);
    expect(d.customerDetail?.contacts[0]).toMatchObject({ isPrimary: true, position: "nákupčí", phone: pavel.phone });
  });
});
