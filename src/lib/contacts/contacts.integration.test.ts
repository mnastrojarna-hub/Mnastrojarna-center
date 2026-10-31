import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_ENABLED, loadLocalEnv, localAdmin, localSession, localSql } from "@/test/local-supabase";

/**
 * Kontakty (30. 10.) proti lokálnímu Supabase:
 *  - tykání / vykání je za uživatele — RLS: každý čte a mění jen své řádky; Volný tyká, Šponer vyká
 *    stejnému kontaktu → AI / doklady „Ahoj Pavle," vs. „Dobrý den, pane Nováku,";
 *  - e-maily podle účelu: kontakt jiného zákazníka odmítne DB, jedna výchozí; odeslání je opravdu použije
 *    (faktura → Fakturace + kontakt zakázky v kopii, nabídka → Nabídky); AI je doplní, ruční nepřepíše;
 *  - našeptávač: adresář (firma, pozice, účel) + adresy z konverzací jen z pošty, kterou uživatel vidí;
 *    mail_address_suggest přes REST nejde.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/contacts/contacts.integration.test.ts
 */

const session = vi.hoisted(() => ({ current: null as null | { id: string; email: string; fullName: string; role: string } }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/supabase/server", async () => {
  const lib = await import("@/test/local-supabase");
  const admin = () => lib.localAdmin();
  return {
    isSupabaseConfigured: () => true,
    hasServiceKey: () => true,
    createAdminClient: admin,
    createOperatorClient: async () => admin(),
    createClient: async () => { throw new Error("Bez session (test)."); },
  };
});
vi.mock("@/lib/auth/session", () => {
  const user = () => {
    const u = session.current!;
    return { ...u, initials: "XX", roleLabel: u.role, aiAccess: false, active: true, hasProfile: true };
  };
  const can = (f: string) => f !== "mail_all" && f !== "flow_all";
  return {
    getSessionUser: async () => user(),
    getAccess: async () => ({ user: user(), ctx: {}, features: [], can }),
    checkFeature: async (f: string) => (can(f) ? { user: user() } : { error: "Bez oprávnění." }),
    apiRequire: async () => ({ user: user() }),
    requireUser: async () => user(),
    requireFeature: async () => user(),
  };
});

describe.skipIf(!LOCAL_ENABLED)("Kontakty — účely e-mailů, tykání, našeptávač", () => {
  const TAG = `kt${Date.now()}`;
  const DOM = `bosch-${TAG}.test`;
  const PAVEL = `pavel.novak@${DOM}`;
  const FAKT = `faktury@${DOM}`;
  const RFQ = `rfq@${DOM}`;
  let svc: SupabaseClient;
  const users: Record<"vit" | "sponer", { id: string; email: string; password: string }> = {} as never;
  let customerId = "";
  let otherCustomerId = "";
  let pavelId = "";
  let otherContactId = "";
  const jobIds: string[] = [];
  const asVit = () => { session.current = { id: users.vit.id, email: users.vit.email, fullName: "Vít Volný", role: "obchodnik" }; };
  const asSponer = () => { session.current = { id: users.sponer.id, email: users.sponer.email, fullName: "Tomáš Šponer", role: "obchodnik" }; };

  beforeAll(async () => {
    const env = loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    svc = localAdmin();
    for (const [key, name] of [["vit", "Vít Volný"], ["sponer", "Tomáš Šponer"]] as const) {
      const email = `${TAG}-${key}@local.test`;
      const password = `Heslo-${TAG}-1!`;
      const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
      if (error) throw new Error(error.message);
      users[key] = { id: data.user!.id, email, password };
      await svc.from("profiles").update({ role: "obchodnik", full_name: name, active: true }).eq("id", data.user!.id);
    }
    const { data: c1 } = await svc.from("customers").insert({ name: `Bosch ${TAG}`, email: `info@${DOM}` }).select("id").single();
    customerId = (c1 as { id: string }).id;
    const { data: c2 } = await svc.from("customers").insert({ name: `Cizí ${TAG}`, email: `info@cizi-${TAG}.test`, owner_id: users.sponer.id }).select("id").single();
    otherCustomerId = (c2 as { id: string }).id;
    const { data: p } = await svc.from("customer_contacts").insert({ customer_id: customerId, name: "Ing. Pavel Novák", position: "nákupčí", email: PAVEL, phone: "+420 777 000 111", is_primary: true }).select("id").single();
    pavelId = (p as { id: string }).id;
    const { data: o } = await svc.from("customer_contacts").insert({ customer_id: otherCustomerId, name: "Skrytý Kontakt", position: "ředitel", email: `skryty@cizi-${TAG}.test` }).select("id").single();
    otherContactId = (o as { id: string }).id;
    // pošta: Vít dostal zprávu od Pavla a jinou od neznámého; Šponerova pošta je pro Víta neviditelná
    await svc.from("emails").insert([
      { owner_id: users.vit.id, direction: "in", from_name: "Pavel Novák", from_email: PAVEL, to_email: users.vit.email, cc_email: `Jana Kolegyně <jana@${DOM}>`, subject: `Poptávka ${TAG}`, body_text: "Dobrý den", message_id: `<${TAG}-1@x>`, received_at: new Date().toISOString() },
      { owner_id: users.vit.id, direction: "out", from_email: users.vit.email, to_email: `Pavel Novák <${PAVEL}>`, subject: `Re: Poptávka ${TAG}`, body_text: "Ahoj Pavle,\nposílám ti nabídku, dej vědět.\n\n> Dobrý den", message_id: `<${TAG}-2@x>`, received_at: new Date().toISOString() },
      { owner_id: users.sponer.id, direction: "in", from_name: "Tajný", from_email: `tajny@hidden-${TAG}.test`, to_email: users.sponer.email, subject: `Tajné ${TAG}`, body_text: "x", message_id: `<${TAG}-3@x>`, received_at: new Date().toISOString() },
    ]);
  }, 60_000);

  afterAll(async () => {
    if (!svc) return;
    for (const id of jobIds) {
      await svc.from("job_files").delete().eq("job_id", id);
      await svc.from("quotes").delete().eq("job_id", id);
      await svc.from("order_items").delete().eq("order_id", id);
      await svc.from("orders").delete().eq("id", id);
    }
    await svc.from("emails").delete().like("subject", `%${TAG}%`);
    await svc.from("party_role_emails").delete().in("customer_id", [customerId, otherCustomerId].filter(Boolean));
    await svc.from("customers").delete().in("id", [customerId, otherCustomerId].filter(Boolean));
    for (const u of Object.values(users)) {
      if (!u) continue;
      await svc.from("contact_tone").delete().eq("user_id", u.id);
      await svc.auth.admin.deleteUser(u.id).catch(() => undefined);
    }
  });

  it("tykání: RLS — každý jen své řádky", async () => {
    const vit = await localSession(users.vit.email, users.vit.password);
    const sponer = await localSession(users.sponer.email, users.sponer.password);
    const ins = await vit.from("contact_tone").insert({ email: ` ${PAVEL.toUpperCase()} `, address: "ty", tone: "pratelsky" }).select("user_id, email").single();
    expect(ins.error).toBeNull();
    expect(ins.data).toEqual({ user_id: users.vit.id, email: PAVEL });
    // za někoho jiného nejde
    const forged = await vit.from("contact_tone").insert({ user_id: users.sponer.id, email: PAVEL, address: "ty" });
    expect(forged.error).not.toBeNull();
    // Šponer Vítův řádek nevidí ani nezmění
    const seen = await sponer.from("contact_tone").select("id").eq("email", PAVEL);
    expect(seen.data ?? []).toEqual([]);
    const upd = await sponer.from("contact_tone").update({ address: "vy" }).eq("user_id", users.vit.id).select("id");
    expect(upd.data ?? []).toEqual([]);
    expect(localSql(`select address from contact_tone where user_id = '${users.vit.id}' and email = '${PAVEL}'`)).toBe("ty");
    await vit.from("contact_tone").delete().eq("email", PAVEL);
    expect(localSql(`select count(*) from contact_tone where user_id = '${users.vit.id}'`)).toBe("0");
  }, 30_000);

  it("e-maily podle účelu: kontrola v DB (cizí kontakt, malá písmena, jedna výchozí)", async () => {
    const bad = await svc.from("party_role_emails").insert({ customer_id: customerId, role: "fakturace", contact_id: otherContactId });
    expect(bad.error?.message).toMatch(/nepatří k tomuto zákazníkovi/);
    const ok = await svc.from("party_role_emails").insert({ customer_id: customerId, role: "fakturace", email: ` ${FAKT.toUpperCase()} `, is_default: true }).select("email").single();
    expect(ok.data).toEqual({ email: FAKT });
    const dupDefault = await svc.from("party_role_emails").insert({ customer_id: customerId, role: "fakturace", email: `jina@${DOM}`, is_default: true });
    expect(dupDefault.error).not.toBeNull();
    const none = await svc.from("party_role_emails").insert({ customer_id: customerId, role: "nabidky" });
    expect(none.error).not.toBeNull();
    await svc.from("party_role_emails").delete().eq("customer_id", customerId);
  });

  it("akce: přidat do role (první = výchozí), výchozí přepnout, smazat → výchozí další", async () => {
    asVit();
    const a = await import("@/app/actions/contacts");
    const r1 = await a.saveRoleEmailAction({ kind: "customer", partyId: customerId, role: "fakturace", email: FAKT });
    expect(r1.ok, r1.error).toBe(true);
    const r2 = await a.saveRoleEmailAction({ kind: "customer", partyId: customerId, role: "fakturace", email: `ucetni@${DOM}` });
    expect(r2.ok, r2.error).toBe(true);
    expect(localSql(`select email || ':' || (case when is_default then 't' else 'f' end) from party_role_emails where customer_id = '${customerId}' order by created_at`)).toBe(`${FAKT}:t\nucetni@${DOM}:f`);
    expect((await a.saveRoleEmailAction({ kind: "customer", partyId: customerId, role: "fakturace", email: FAKT })).error).toMatch(/už v tomto účelu/);
    const r3 = await a.saveRoleEmailAction({ kind: "customer", partyId: customerId, role: "nabidky", contactId: pavelId });
    expect(r3.ok, r3.error).toBe(true);
    expect((await a.setRoleDefaultAction("customer", r2.id!)).ok).toBe(true);
    expect((await a.deleteRoleEmailAction("customer", r2.id!)).ok).toBe(true);
    expect(localSql(`select email || ':' || (case when is_default then 't' else 'f' end) from party_role_emails where customer_id = '${customerId}' and role = 'fakturace'`)).toBe(`${FAKT}:t`);
  });

  it("odeslání podle účelu: faktura → Fakturace (+ kontakt zakázky v kopii), nabídka → Nabídky (Pavel)", async () => {
    const { recipientsFor } = await import("./server");
    const inv = await recipientsFor(svc, "faktura", { customerId }, { email: `vedouci@${DOM}`, name: "Vedoucí" });
    expect(inv).toMatchObject({ to: [FAKT], cc: [`vedouci@${DOM}`], source: "role" });
    expect(inv.reason).toContain("Fakturační e-mail zákazníka");
    const quote = await recipientsFor(svc, "nabidka", { customerId }, null);
    expect(quote).toMatchObject({ to: [PAVEL], source: "role" });
    expect(quote.reason).toBe("E-mail zákazníka pro nabídky (Ing. Pavel Novák)");
    // kontakt zakázky má u nabídky přednost
    expect((await recipientsFor(svc, "nabidka", { customerId }, { email: `vedouci@${DOM}` })).to).toEqual([`vedouci@${DOM}`]);
    // potvrzení bez role Nákup → e-mail firmy
    expect((await recipientsFor(svc, "potvrzeni", { customerId }, null)).to).toEqual([`info@${DOM}`]);
  });

  it("tykání za uživatele: Volný tyká → „Ahoj Pavle,“, Šponer vyká → „Dobrý den, pane Nováku,“; návrh z odeslané pošty", async () => {
    const a = await import("@/app/actions/contacts");
    const { toneFor } = await import("./server");
    asVit();
    const before = await a.getToneAction(PAVEL);
    expect(before.ok, before.error).toBe(true);
    expect(before.tone).toMatchObject({ saved: false, name: "Ing. Pavel Novák", salutation: "Dobrý den, pane Nováku," });
    expect(before.tone?.suggestion).toMatchObject({ address: "ty", salutation: "Ahoj Pavle" });
    const saved = await a.saveToneAction(PAVEL, { address: "ty", fromSuggestion: true });
    expect(saved).toMatchObject({ ok: true, salutation: "Ahoj Pavle," });
    asSponer();
    const sp = await a.getToneAction(PAVEL);
    expect(sp.tone).toMatchObject({ saved: false, salutation: "Dobrý den, pane Nováku,", suggestion: null });
    const tv = await toneFor(svc, users.vit.id, [PAVEL]);
    const ts = await toneFor(svc, users.sponer.id, [PAVEL]);
    expect(tv.salutation).toBe("Ahoj Pavle,");
    expect(tv.instruction).toContain("TYKÁŠ");
    expect(ts.salutation).toBe("Dobrý den, pane Nováku,");
    // víc adresátů s různým nastavením → formálně bez jména
    await a.saveToneAction(`jana@${DOM}`, { address: "vy", tone: "formalni" });
    expect((await toneFor(svc, users.vit.id, [PAVEL, `jana@${DOM}`])).salutation).toBe("Dobrý den,");
    // změna e-mailu kontaktu přenese tykání všech uživatelů na novou adresu
    asVit();
    const crm = await import("@/app/actions/crm");
    const moved = await crm.saveCustomerContact(customerId, { name: "Ing. Pavel Novák", position: "nákupčí", email: `p.novak@${DOM}`, phone: "", isPrimary: true }, pavelId);
    expect(moved.ok, moved.error).toBe(true);
    expect(localSql(`select email from contact_tone where user_id = '${users.vit.id}' and address = 'ty'`)).toBe(`p.novak@${DOM}`);
    await crm.saveCustomerContact(customerId, { name: "Ing. Pavel Novák", position: "nákupčí", email: PAVEL, phone: "", isPrimary: true }, pavelId);
    expect(localSql(`select email from contact_tone where user_id = '${users.vit.id}' and address = 'ty'`)).toBe(PAVEL);
  });

  it("návrh e-mailu k nabídce: Komu = e-mail pro nabídky, text s tykáním odesílatele", async () => {
    asVit();
    const j = await import("@/app/actions/jobs");
    const d = await import("@/app/actions/job-documents");
    const created = await j.createJob({ title: `Kontakty ${TAG}`, stage: "poptavka", customerId, items: [{ name: "Díl", quantity: 2, unitPrice: 100 }] });
    expect(created.ok, created.error).toBe(true);
    jobIds.push(created.id!);
    const q = await j.createJobQuote(created.id!, { title: "Díl", validUntil: "2026-12-31", leadTimeDays: 14, items: [{ name: "Díl", quantity: 2, unitPrice: 100 }] });
    expect(q.ok, q.error).toBe(true);
    const vit = await d.draftQuoteEmail(created.id!, q.id!);
    expect(vit.ok, vit.error).toBe(true);
    expect(vit).toMatchObject({ to: PAVEL, recipientReason: "E-mail zákazníka pro nabídky (Ing. Pavel Novák)" });
    expect(vit.body?.startsWith("Ahoj Pavle,\n\ndíky za tvou poptávku")).toBe(true);
    asSponer();
    const sp = await d.draftQuoteEmail(created.id!, q.id!);
    expect(sp.body?.startsWith("Dobrý den, pane Nováku,\n\nděkujeme za Vaši poptávku")).toBe(true);
  }, 60_000);

  it("AI / rozpoznání doplní účel, ruční výchozí nepřepíše; naše adresy nikdy", async () => {
    const { rememberRoleEmails } = await import("./server");
    const { detectRoleEmails } = await import("./role-detect");
    const found = detectRoleEmails(`Dobrý den,\nfaktury prosím zasílejte na uctarna@${DOM}. Objednávky posílejte na nakup@${DOM}.\nKopie: obchod@mnastrojarna.cz`);
    const added = await rememberRoleEmails(svc, { customerId }, [...found, { role: "fakturace", email: "faktury@mnastrojarna.cz" }], {
      exclude: (e) => e.endsWith("@mnastrojarna.cz"),
    });
    expect(added).toBe(2);
    expect(localSql(`select role || ':' || email || ':' || (case when is_default then 't' else 'f' end) || ':' || source from party_role_emails where customer_id = '${customerId}' and source = 'ai' order by role`))
      .toBe(`fakturace:uctarna@${DOM}:f:ai\nnakup:nakup@${DOM}:t:ai`);
    // podruhé nic nového
    expect(await rememberRoleEmails(svc, { customerId }, found, { exclude: () => false })).toBe(0);
    // faktura dál na ručně nastavenou výchozí, AI adresa v kopii
    const { recipientsFor } = await import("./server");
    expect(await recipientsFor(svc, "faktura", { customerId }, null)).toMatchObject({ to: [FAKT], cc: [`uctarna@${DOM}`] });
  });

  it("našeptávač: kontakt s firmou / pozicí / účelem, konverzace jen z mé pošty, cizí zákazník skrytý", async () => {
    const { searchRecipients } = await import("./suggest-server");
    const vitView = { userId: users.vit.id, all: false, mail: true };
    const r = await searchRecipients(svc, vitView, "novak");
    const pavel = r.find((s) => s.email === PAVEL);
    expect(pavel).toMatchObject({ kind: "kontakt", name: "Ing. Pavel Novák", company: `Bosch ${TAG}`, position: "nákupčí" });
    expect(pavel?.roles).toContain("Nabídky");
    expect(pavel?.hits).toBeGreaterThanOrEqual(2);
    // adresa jen z konverzace (kopie)
    expect((await searchRecipients(svc, vitView, "kolegyn")).map((s) => [s.email, s.kind])).toContainEqual([`jana@${DOM}`, "konverzace"]);
    // cizí pošta ani cizí zákazník
    expect((await searchRecipients(svc, vitView, `hidden-${TAG}`)).length).toBe(0);
    expect((await searchRecipients(svc, vitView, "Skrytý")).length).toBe(0);
    expect((await searchRecipients(svc, { userId: users.sponer.id, all: false, mail: true }, "Skrytý")).map((s) => s.email)).toEqual([`skryty@cizi-${TAG}.test`]);
    // kontext zákazníka: jeho adresy nahoře i bez psaní (fakturační s účelem)
    const ctx = await searchRecipients(svc, vitView, "", { customerId });
    expect(ctx.slice(0, 4).map((s) => s.email)).toEqual(expect.arrayContaining([PAVEL, FAKT]));
    expect(ctx.find((s) => s.email === FAKT)?.roles).toContain("Fakturace");
    // akce pro klienta (dotaz + kontext + vyloučení vybraných)
    asVit();
    const { searchRecipientsAction } = await import("@/app/actions/mail-compose");
    const act = await searchRecipientsAction("pav", { customerId, exclude: [] });
    expect(act[0]?.email).toBe(PAVEL);
    expect((await searchRecipientsAction("pav", { customerId, exclude: [PAVEL] })).some((s) => s.email === PAVEL)).toBe(false);
  });

  it("dodavatel: kontaktní osoby (jméno, pozice, telefon, e-mail) + Objednávky → objednávka jde tam, s tykáním podepisujícího", async () => {
    asVit();
    const a = await import("@/app/actions/contacts");
    const { recipientsFor, toneFor } = await import("./server");
    const { data: s } = await svc.from("suppliers").insert({ name: `Kalírna ${TAG}`, email: `info@kalirna-${TAG}.test`, contact_person: "Jan Kalič" }).select("id").single();
    const supplierId = (s as { id: string }).id;
    try {
      const c = await a.saveSupplierContactAction(supplierId, { name: "Jan Kalič", position: "obchod", email: `jan@kalirna-${TAG}.test`, phone: "+420 600 000 000", isPrimary: true });
      expect(c.ok, c.error).toBe(true);
      const r = await a.saveRoleEmailAction({ kind: "supplier", partyId: supplierId, role: "nakup", contactId: c.id });
      expect(r.ok, r.error).toBe(true);
      const book = await a.getSupplierBookAction(supplierId);
      expect(book.book?.contacts).toEqual([expect.objectContaining({ name: "Jan Kalič", position: "obchod", phone: "+420 600 000 000", email: `jan@kalirna-${TAG}.test` })]);
      const pick = await recipientsFor(svc, "objednavka_dodavateli", { supplierId });
      expect(pick).toMatchObject({ to: [`jan@kalirna-${TAG}.test`], reason: "E-mail dodavatele pro objednávky (Jan Kalič)" });
      await a.saveToneAction(`jan@kalirna-${TAG}.test`, { address: "ty" });
      expect((await toneFor(svc, users.vit.id, [`jan@kalirna-${TAG}.test`])).salutation).toBe("Ahoj Jane,");
      // cizí role z jiného typu firmy nejde smazat přes špatný druh
      expect((await a.deleteRoleEmailAction("customer", r.id!)).ok).toBe(false);
      expect((await a.deleteSupplierContactAction(supplierId, c.id!)).ok).toBe(true);
      expect(localSql(`select count(*) from party_role_emails where supplier_id = '${supplierId}'`)).toBe("0");
    } finally {
      await svc.from("suppliers").delete().eq("id", supplierId);
    }
  });

  it("mail_address_suggest: viditelnost podle uživatele, přes REST nejde", async () => {
    const { data } = await svc.rpc("mail_address_suggest", { p_q: TAG.slice(0, 6), p_user: users.vit.id, p_all: false, p_limit: 50 });
    const emails = ((data ?? []) as { email: string }[]).map((r) => r.email);
    expect(emails).not.toContain(`tajny@hidden-${TAG}.test`);
    const all = await svc.rpc("mail_address_suggest", { p_q: `hidden-${TAG}`, p_user: users.vit.id, p_all: true, p_limit: 5 });
    expect(((all.data ?? []) as { email: string }[]).map((r) => r.email)).toEqual([`tajny@hidden-${TAG}.test`]);
    const mine = await svc.rpc("mail_address_suggest", { p_q: "", p_user: users.vit.id, p_all: false, p_limit: 10 });
    expect(((mine.data ?? []) as { email: string }[]).map((r) => r.email)).not.toContain(users.vit.email);
    const vit = await localSession(users.vit.email, users.vit.password);
    const rest = await vit.rpc("mail_address_suggest", { p_q: "", p_user: users.sponer.id, p_all: true, p_limit: 5 });
    expect(rest.error).not.toBeNull();
  });
});
