import { describe, expect, it } from "vitest";
import { pickRecipients, roleEntryFromRow, type PartyAddressBook, type RoleEntry } from "./roles";

function entry(p: Partial<RoleEntry> & Pick<RoleEntry, "role" | "email">): RoleEntry {
  return { id: Math.random().toString(36), contactId: null, contactName: null, contactPosition: null, isDefault: false, source: "manual", ...p };
}

const book: PartyAddressBook = {
  kind: "customer",
  partyEmail: "info@bosch.test",
  contacts: [
    { id: "c1", name: "Pavel Novák", email: "novak@bosch.test", position: "nákupčí", phone: null, isPrimary: true },
    { id: "c2", name: "Eva Účetní", email: "eva@bosch.test", position: "účetní", phone: null, isPrimary: false },
  ],
  roles: [
    entry({ role: "fakturace", email: "faktury@bosch.test", isDefault: true }),
    entry({ role: "fakturace", email: "eva@bosch.test", contactId: "c2", contactName: "Eva Účetní" }),
    entry({ role: "nabidky", email: "rfq@bosch.test", isDefault: true }),
  ],
};

describe("pickRecipients", () => {
  it("faktura vždy na fakturační + kontakt zakázky a další fakturační v kopii", () => {
    const r = pickRecipients("faktura", book, { email: "Pavel <novak@bosch.test>", name: "Pavel Novák" });
    expect(r.to).toEqual(["faktury@bosch.test"]);
    expect(r.cc).toEqual(["eva@bosch.test", "novak@bosch.test"]);
    expect(r.reason).toContain("Fakturační e-mail zákazníka");
    expect(r.source).toBe("role");
  });
  it("nabídka: kontakt zakázky má přednost, bez něj e-mail pro nabídky", () => {
    expect(pickRecipients("nabidka", book, { email: "novak@bosch.test", name: "Pavel Novák" })).toMatchObject({ to: ["novak@bosch.test"], source: "job_contact" });
    const r = pickRecipients("nabidka", book, null);
    expect(r).toMatchObject({ to: ["rfq@bosch.test"], source: "role" });
    expect(r.reason).toBe("E-mail zákazníka pro nabídky");
  });
  it("bez role → běžná komunikace → e-mail firmy → hlavní kontakt", () => {
    expect(pickRecipients("potvrzeni", book, null)).toMatchObject({ to: ["info@bosch.test"], source: "party_email" });
    const withGeneral = { ...book, roles: [...book.roles, entry({ role: "komunikace", email: "obchod@bosch.test", isDefault: true })] };
    expect(pickRecipients("dodaci_list", withGeneral, null)).toMatchObject({ to: ["obchod@bosch.test"], source: "fallback_role" });
    expect(pickRecipients("komunikace", { ...book, partyEmail: null }, null)).toMatchObject({ to: ["novak@bosch.test"], source: "primary_contact" });
    expect(pickRecipients("faktura", { ...book, roles: [] }, null)).toMatchObject({ to: ["info@bosch.test"] });
    expect(pickRecipients("nabidka", null, null)).toMatchObject({ to: [], source: "none" });
  });
  it("dodavatel: objednávka na e-mail pro objednávky", () => {
    const sup: PartyAddressBook = { kind: "supplier", partyEmail: "info@ocel.test", contacts: [], roles: [entry({ role: "nakup", email: "objednavky@ocel.test", isDefault: true })] };
    const r = pickRecipients("objednavka_dodavateli", sup, null);
    expect(r.to).toEqual(["objednavky@ocel.test"]);
    expect(r.reason).toBe("E-mail dodavatele pro objednávky");
  });
  it("řádek DB s kontaktní osobou bere e-mail z kontaktu", () => {
    expect(roleEntryFromRow({ id: "1", role: "fakturace", email: null, contact_id: "c2", contact: { name: "Eva", email: "EVA@x.test" } }))
      .toMatchObject({ email: "eva@x.test", contactName: "Eva" });
    expect(roleEntryFromRow({ id: "1", role: "x", email: "a@b.cz" })).toBeNull();
  });
});
