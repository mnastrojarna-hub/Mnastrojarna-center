import { describe, expect, it } from "vitest";
import subjektKamenice from "@/lib/ares/__fixtures__/subjekt-25037684.json";
import { parseAresSubject } from "@/lib/ares/ares";
import { EMPTY_CUSTOMER_FORM } from "@/components/customers/model";
import { EMPTY_SUPPLIER_FORM } from "@/components/suppliers/model";
import { draftFromBook, emptyBookDraft } from "@/lib/contacts/book-draft";
import {
  applyAresToCustomerForm, applyAresToSupplierForm, applyToCustomerForm, applyToSupplierForm, filledSummary, mergeContactsIntoDraft,
} from "./autofill";
import type { PartyAutofillData } from "./autofill-types";

const ares = parseAresSubject(subjektKamenice)!;

const data: PartyAutofillData = {
  kind: "customer",
  fields: { name: ares.name, ico: ares.ico, dic: ares.dic!, street: ares.street!, city: ares.city!, zip: ares.zip!, country: "CZ" },
  sources: { name: "ares", ico: "ares", dic: "ares", street: "ares", city: "ares", zip: "ares", country: "ares" },
  email: "info@strojmetal.test",
  phone: "+420 312 000 111",
  website: "www.strojmetal.test",
  contacts: [{ name: "Jana Nákupčí", position: "nákup", email: "jana@strojmetal.test", phone: "+420 777 000 111" }],
  roleEmails: [{ role: "fakturace", email: "faktury@strojmetal.test" }, { role: "nakup", email: "jana@strojmetal.test" }],
  paymentTermsDays: 45,
  supplierNumberAtCustomer: "D-4711",
  deliveryAddress: "",
  technologies: ["kování"],
  materials: ["hliník"],
  certifications: [],
  ares: { status: "found", message: "", candidates: [] },
  duplicate: null,
  summary: "",
  documentKind: "objednávka",
  confidence: 0.9,
  warnings: [],
};

describe("formulář zákazníka", () => {
  it("nový: vyplní vše, zdroj ARES / AI", () => {
    const { values, filled } = applyToCustomerForm({ ...EMPTY_CUSTOMER_FORM, ownerId: "x" }, data, "new");
    expect(values).toMatchObject({
      name: "Strojmetal Aluminium Forging a.s.", ico: "25037684", dic: "CZ25037684", street: "Ringhofferova 66",
      city: "Kamenice", zip: "251 68", country: "CZ", email: "info@strojmetal.test", phone: "+420 312 000 111",
      website: "www.strojmetal.test", paymentTermsDays: "45", supplierNumberAtCustomer: "D-4711", ownerId: "x",
    });
    expect(filled.name).toBe("ares");
    expect(filled.email).toBe("ai");
    expect(filled.country).toBeUndefined(); // CZ už tam bylo
  });

  it("nový: přepíše rozepsané, prázdná hodnota z AI nic nesmaže", () => {
    const { values } = applyToCustomerForm({ ...EMPTY_CUSTOMER_FORM, name: "strojmet", note: "VIP" }, { ...data, website: "" }, "new");
    expect(values.name).toBe("Strojmetal Aluminium Forging a.s.");
    expect(values.note).toBe("VIP");
  });

  it("úprava: doplní jen prázdná pole", () => {
    const cur = { ...EMPTY_CUSTOMER_FORM, name: "Strojmetal (náš název)", email: "stary@strojmetal.test", phone: "" };
    const { values, filled } = applyToCustomerForm(cur, data, "edit");
    expect(values.name).toBe("Strojmetal (náš název)");
    expect(values.email).toBe("stary@strojmetal.test");
    expect(values.phone).toBe("+420 312 000 111");
    expect(filled.name).toBeUndefined();
    expect(filled.phone).toBe("ai");
  });

  it("ARES tlačítko přepíše úřední údaje i u existujícího", () => {
    const { values, filled } = applyAresToCustomerForm({ ...EMPTY_CUSTOMER_FORM, name: "Strojmetal", email: "a@b.cz" }, ares);
    expect(values.name).toBe(ares.name);
    expect(values.email).toBe("a@b.cz");
    expect(Object.keys(filled).sort()).toEqual(["city", "dic", "ico", "name", "street", "zip"]);
  });
});

describe("formulář dodavatele", () => {
  it("adresa jedním řádkem, štítky se sloučí", () => {
    const { values, filled } = applyToSupplierForm({ ...EMPTY_SUPPLIER_FORM, technologies: ["Kování", "frézování"] }, { ...data, kind: "supplier" }, "new");
    expect(values.address).toBe("Ringhofferova 66, 251 68 Kamenice");
    expect(values.technologies).toEqual(["Kování", "frézování"]);
    expect(values.materials).toEqual(["hliník"]);
    expect(filled.address).toBe("ares");
    expect(filled.technologies).toBeUndefined();
    expect(filled.materials).toBe("ai");
  });

  it("ARES do dodavatele", () => {
    const { values } = applyAresToSupplierForm(EMPTY_SUPPLIER_FORM, ares);
    expect(values).toMatchObject({ name: ares.name, ico: "25037684", dic: "CZ25037684", address: "Ringhofferova 66, 251 68 Kamenice" });
  });
});

describe("kontakty a Kam posílat", () => {
  it("nový zákazník: prázdný řádek nahradí přečtená osoba, účel ukáže na osobu se stejným e-mailem", () => {
    const { draft, addedContacts, addedRoles } = mergeContactsIntoDraft(emptyBookDraft(true), data.contacts, data.roleEmails);
    expect(addedContacts).toBe(1);
    expect(addedRoles).toBe(2);
    expect(draft.contacts).toHaveLength(1);
    expect(draft.contacts[0]).toMatchObject({ name: "Jana Nákupčí", email: "jana@strojmetal.test", isPrimary: true });
    const nakup = draft.roles.find((r) => r.role === "nakup")!;
    expect(nakup.contactKey).toBe(draft.contacts[0].key);
    const fakt = draft.roles.find((r) => r.role === "fakturace")!;
    expect(fakt).toMatchObject({ contactKey: null, email: "faktury@strojmetal.test", isDefault: true });
  });

  it("existující osoba se doplní, ne zdvojí; účel podruhé nepřibude", () => {
    const saved = draftFromBook({
      contacts: [{ id: "00000000-0000-4000-8000-000000000001", name: "Jana Nakupci", email: null, position: null, phone: null, isPrimary: true }],
      roles: [],
    });
    const once = mergeContactsIntoDraft(saved, data.contacts, data.roleEmails);
    expect(once.addedContacts).toBe(0);
    expect(once.draft.contacts).toHaveLength(1);
    expect(once.draft.contacts[0]).toMatchObject({ name: "Jana Nakupci", email: "jana@strojmetal.test", phone: "+420 777 000 111", position: "nákup" });
    const twice = mergeContactsIntoDraft(once.draft, data.contacts, data.roleEmails);
    expect(twice.addedRoles).toBe(0);
    expect(twice.draft.roles).toHaveLength(2);
  });

  it("bez kontaktů zůstane jeden prázdný řádek", () => {
    expect(mergeContactsIntoDraft(emptyBookDraft(true), [], []).draft.contacts).toHaveLength(1);
  });

  it("souhrn", () => {
    expect(filledSummary(["název", "IČO"], 2, 1)).toBe("Vyplněno: název, IČO, 2 kontaktní osoby, 1 e-mail podle účelu.");
    expect(filledSummary([], 0, 0)).toMatch(/Nic nového/);
  });
});
