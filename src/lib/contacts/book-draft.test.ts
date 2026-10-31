import { describe, expect, it } from "vitest";
import {
  bookContactPerson, bookInputFromDraft, draftAddContact, draftAddRole, draftFromBook, draftPickableContacts,
  draftRemoveContact, draftRemoveRole, draftRoleEntries, draftSetRoleDefault, draftSignature, draftTogglePrimary,
  draftUpdateContact, emptyBookDraft, validatePartyBookInput, type BookDraft,
} from "./book-draft";
import type { RoleEntry } from "./roles";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const R1 = "33333333-3333-4333-8333-333333333333";

function ok<T>(r: { draft: T } | { error: string }): T {
  if ("error" in r) throw new Error(r.error);
  return r.draft;
}

/** Dialog: tři osoby → Faktury = A, Dodací listy = B, Běžná = C. */
function threeContacts(): { d: BookDraft; a: string; b: string; c: string } {
  let d = emptyBookDraft(true);
  const a = d.contacts[0].key;
  d = draftUpdateContact(d, a, { name: "Anna Účetní", email: "Anna@Firma.test", position: "účetní" });
  const rb = draftAddContact(d);
  d = draftUpdateContact(rb.draft, rb.key, { name: "Bohouš Sklad", email: "sklad@firma.test" });
  const rc = draftAddContact(d);
  d = draftUpdateContact(rc.draft, rc.key, { name: "Cyril Nákup", email: "cyril@firma.test", phone: "+420 1" });
  d = ok(draftAddRole(d, "fakturace", { contactId: a }));
  d = ok(draftAddRole(d, "dodaci_listy", { contactId: rb.key }));
  d = ok(draftAddRole(d, "komunikace", { contactId: rc.key }));
  return { d, a, b: rb.key, c: rc.key };
}

describe("koncept adresáře (dialog firmy)", () => {
  it("nová firma: jeden prázdný řádek (hlavní); prázdné řádky se neukládají", () => {
    const d = emptyBookDraft(true);
    expect(d.contacts).toHaveLength(1);
    expect(d.contacts[0].isPrimary).toBe(true);
    const r = bookInputFromDraft("customer", d);
    expect(r).toEqual({ input: { contacts: [], roles: [], knownContactIds: [], knownRoleIds: [] } });
  });

  it("tři osoby a účely → vstup akce: e-mail malými, výchozí v každém účelu, odkaz na osobu klíčem", () => {
    const { d, a, b, c } = threeContacts();
    expect(draftPickableContacts(d).map((x) => x.email)).toEqual(["anna@firma.test", "sklad@firma.test", "cyril@firma.test"]);
    const entries = draftRoleEntries(d);
    expect(entries.map((e) => [e.role, e.contactName, e.email, e.isDefault])).toEqual([
      ["fakturace", "Anna Účetní", "anna@firma.test", true],
      ["dodaci_listy", "Bohouš Sklad", "sklad@firma.test", true],
      ["komunikace", "Cyril Nákup", "cyril@firma.test", true],
    ]);
    const r = bookInputFromDraft("customer", d);
    if ("error" in r) throw new Error(r.error);
    expect(r.input.contacts.map((x) => [x.key, x.name, x.email, x.isPrimary])).toEqual([
      [a, "Anna Účetní", "anna@firma.test", true], [b, "Bohouš Sklad", "sklad@firma.test", false], [c, "Cyril Nákup", "cyril@firma.test", false],
    ]);
    expect(r.input.roles).toEqual([
      { id: null, role: "fakturace", contactKey: a, email: null, isDefault: true },
      { id: null, role: "dodaci_listy", contactKey: b, email: null, isDefault: true },
      { id: null, role: "komunikace", contactKey: c, email: null, isDefault: true },
    ]);
    expect(bookContactPerson(r.input)).toBe("Anna Účetní");
  });

  it("víc adres v účelu: první výchozí, ★ přepne, duplicita odmítnuta; samotná adresa", () => {
    const t = threeContacts();
    const b = t.b;
    let d = ok(draftAddRole(t.d, "dodaci_listy", { email: " Prijem@Firma.test " }));
    expect(draftAddRole(d, "dodaci_listy", { contactId: b })).toEqual({ error: "Tahle adresa už v tomto účelu je." });
    expect(draftAddRole(d, "dodaci_listy", { email: "sklad@firma.test" })).toEqual({ error: "Tahle adresa už v tomto účelu je." });
    expect(draftAddRole(d, "nabidky", { email: "nic" })).toEqual({ error: "Vyber kontaktní osobu nebo zadej platný e-mail." });
    const dl = () => draftRoleEntries(d).filter((e) => e.role === "dodaci_listy");
    expect(dl().map((e) => [e.email, e.isDefault])).toEqual([["sklad@firma.test", true], ["prijem@firma.test", false]]);
    d = draftSetRoleDefault(d, dl()[1].id);
    expect(dl().map((e) => [e.email, e.isDefault])).toEqual([["sklad@firma.test", false], ["prijem@firma.test", true]]);
    d = draftRemoveRole(d, dl()[1].id);
    expect(dl().map((e) => [e.email, e.isDefault])).toEqual([["sklad@firma.test", true]]);
  });

  it("odebraná osoba zmizí i z účelů, hlavním se stane další; ★ hlavní je jen jeden", () => {
    const t = threeContacts();
    const b = t.b;
    let d = draftRemoveContact(t.d, t.a);
    expect(d.contacts.map((c) => [c.name, c.isPrimary])).toEqual([["Bohouš Sklad", true], ["Cyril Nákup", false]]);
    expect(d.roles.some((r) => r.role === "fakturace")).toBe(false);
    d = draftTogglePrimary(d, d.contacts[1].key);
    expect(d.contacts.map((c) => c.isPrimary)).toEqual([false, true]);
    d = draftTogglePrimary(d, d.contacts[1].key);
    expect(d.contacts.map((c) => c.isPrimary)).toEqual([false, false]);
    expect(d.contacts[0].key).toBe(b);
  });

  it("kontrola: jméno chybí, osoba v účelu bez e-mailu, neplatný e-mail", () => {
    const { d, b } = threeContacts();
    expect(bookInputFromDraft("customer", draftUpdateContact(d, b, { name: "" }))).toEqual({ error: "Kontakt sklad@firma.test: Zadej jméno kontaktní osoby." });
    expect(bookInputFromDraft("customer", draftUpdateContact(d, b, { email: "" })))
      .toEqual({ error: "„Dodací listy“: Bohouš Sklad nemá e-mail — doplň ho, nebo osobu z účelu odeber." });
    expect(bookInputFromDraft("customer", draftUpdateContact(d, b, { email: "sklad@" }))).toMatchObject({ error: expect.stringContaining("Tohle nevypadá jako e-mail.") });
  });

  it("uložený adresář → koncept → beze změny stejný podpis; dodavatel nemá Dodací listy", () => {
    const roles: RoleEntry[] = [
      { id: R1, role: "fakturace", email: "anna@firma.test", contactId: U1, contactName: "Anna", contactPosition: null, isDefault: true, source: "ai" },
    ];
    const book = {
      contacts: [
        { id: U2, name: "Bob", email: null, position: null, phone: null, isPrimary: false },
        { id: U1, name: "Anna", email: "anna@firma.test", position: "účetní", phone: null, isPrimary: true },
      ],
      roles,
    };
    const d = draftFromBook(book);
    expect(d.contacts.map((c) => c.name)).toEqual(["Anna", "Bob"]);
    expect(d.knownContactIds).toEqual([U2, U1]);
    expect(d.knownRoleIds).toEqual([R1]);
    expect(draftSignature(draftFromBook(book))).toBe(draftSignature(d));
    expect(draftSignature(draftUpdateContact(d, U2, { phone: "1" }))).not.toBe(draftSignature(d));
    const r = bookInputFromDraft("customer", d);
    if ("error" in r) throw new Error(r.error);
    expect(r.input.roles).toEqual([{ id: R1, role: "fakturace", contactKey: U1, email: null, isDefault: true }]);
    expect(validatePartyBookInput("supplier", { contacts: [], roles: [{ role: "dodaci_listy", email: "a@b.cz", isDefault: true }] }))
      .toEqual({ error: "Neplatný účel e-mailu." });
  });

  it("server: neplatný tvar, cizí klíč, dvě výchozí → jedna", () => {
    expect(validatePartyBookInput("customer", null)).toEqual({ error: "Neplatné kontakty." });
    expect(validatePartyBookInput("customer", { contacts: [{ key: "a b", name: "Xx" }] })).toEqual({ error: "Neplatný kontakt." });
    expect(validatePartyBookInput("customer", { contacts: [], roles: [{ role: "fakturace", contactKey: "zz", isDefault: true }] }))
      .toMatchObject({ error: expect.stringContaining("kontaktní osoba v adresáři chybí") });
    const r = validatePartyBookInput("customer", {
      contacts: [{ key: "k1", name: "Eva", email: "eva@x.test", isPrimary: true }, { key: "k2", name: "Jan", isPrimary: true }],
      roles: [
        { role: "fakturace", email: "a@x.test", isDefault: true }, { role: "fakturace", email: "b@x.test", isDefault: true },
        { role: "fakturace", email: "A@x.test", isDefault: false }, { role: "nabidky", contactKey: "k1", isDefault: false },
      ],
      knownContactIds: [U1, "nope"],
    });
    if ("error" in r) throw new Error(r.error);
    expect(r.input.contacts.map((c) => c.isPrimary)).toEqual([true, false]);
    expect(r.input.roles.map((x) => [x.role, x.email ?? x.contactKey, x.isDefault])).toEqual([
      ["fakturace", "a@x.test", true], ["fakturace", "b@x.test", false], ["nabidky", "k1", true],
    ]);
    expect(r.input.knownContactIds).toEqual([U1]);
  });
});
