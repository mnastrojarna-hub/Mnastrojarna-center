import { describe, it, expect } from "vitest";
import {
  EMPTY_CUSTOMER_FORM, addressLine, customerFilterCounts, customerFormFromView, filterCustomers, initialsOf,
  parsePaymentDays, rowToContactView, rowToCustomerView, sortContacts, validateContactForm, validateCustomerForm,
  websiteHref, avatarToneFor, type CustomerRow, type CustomerView,
} from "@/components/customers/model";

const ROW: CustomerRow = {
  id: "c1",
  name: "Strojmetal a.s.",
  customer_number: "ZK0007",
  ico: "45274649",
  dic: "CZ45274649",
  street: "Průmyslová 12",
  city: "Brno",
  zip: "602 00",
  country: "CZ",
  email: "nakup@strojmetal.cz",
  phone: "+420 777 111 222",
  contact_person: "Jana Nováková",
  website: "strojmetal.cz",
  payment_terms_days: "30",
  delivery_address: null,
  supplier_number_at_customer: "100245",
  note: "  ",
  owner_id: "u1",
  created_at: "2026-01-01T00:00:00Z",
  owner: [{ id: "u1", full_name: "Petr Obchodník", email: "petr@firma.cz" }],
  jobs: [
    { status: "objednavka", value: 10000 },
    { status: "ve_vyrobe", value: "2500.5" },
    { status: "dokonceno", value: 5000 },
    { status: "nerealizovano", value: 99999 },
    { status: "zruseno", value: null },
  ],
};

function view(over: Partial<CustomerView> = {}): CustomerView {
  return { ...rowToCustomerView(ROW), ...over };
}

describe("rowToCustomerView", () => {
  it("mapuje údaje, počty zakázek a obrat bez prohraných", () => {
    const v = rowToCustomerView(ROW);
    expect(v.customerNumber).toBe("ZK0007");
    expect(v.owner).toEqual({ id: "u1", name: "Petr Obchodník" });
    expect(v.activeJobs).toBe(2);
    expect(v.totalJobs).toBe(5);
    expect(v.revenue).toBe(17500.5);
    expect(v.paymentTermsDays).toBe(30);
    expect(v.note).toBeNull();
  });

  it("starší záznam jen se složenou adresou ukáže adresu jako ulici", () => {
    const v = rowToCustomerView({ id: "x", name: "Old", address: "Dlouhá 1, Praha", street: null, city: null, zip: null });
    expect(v.street).toBe("Dlouhá 1, Praha");
    expect(v.country).toBe("CZ");
    expect(v.totalJobs).toBe(0);
    expect(v.owner).toBeNull();
  });

  it("vlastník bez jména → e-mail", () => {
    const v = rowToCustomerView({ ...ROW, owner: { id: "u2", full_name: " ", email: "a@b.cz" } });
    expect(v.owner?.name).toBe("a@b.cz");
  });
});

describe("formulář zákazníka", () => {
  it("prázdný formulář chce název", () => {
    expect(validateCustomerForm(EMPTY_CUSTOMER_FORM).name).toBeTruthy();
  });

  it("validuje IČO, e-mail, splatnost a web", () => {
    const errs = validateCustomerForm({
      ...EMPTY_CUSTOMER_FORM, name: "Firma", ico: "12ab", email: "x@", paymentTermsDays: "12.5", website: "není web",
    });
    expect(errs.ico).toBeTruthy();
    expect(errs.email).toBeTruthy();
    expect(errs.paymentTermsDays).toBeTruthy();
    expect(errs.website).toBeTruthy();
    expect(errs.name).toBeUndefined();
  });

  it("platný formulář nemá chyby (IČO s mezerou je OK)", () => {
    expect(validateCustomerForm({ ...EMPTY_CUSTOMER_FORM, name: "Firma s.r.o.", ico: "452 74 649", email: "a@b.cz", paymentTermsDays: "14" })).toEqual({});
  });

  it("view → formulář → zpět stejné hodnoty", () => {
    const f = customerFormFromView(view());
    expect(f.name).toBe("Strojmetal a.s.");
    expect(f.paymentTermsDays).toBe("30");
    expect(f.ownerId).toBe("u1");
    expect(f.customerNumber).toBe("ZK0007");
  });

  it("parsePaymentDays", () => {
    expect(parsePaymentDays("")).toBeNull();
    expect(parsePaymentDays(" 30 ")).toBe(30);
    expect(parsePaymentDays("400")).toBeNaN();
    expect(parsePaymentDays("-1")).toBeNaN();
  });
});

describe("filtry seznamu", () => {
  const list = [
    view(),
    view({ id: "c2", name: "Kovo Žďár", customerNumber: "ZK0008", ico: null, dic: null, city: "Žďár nad Sázavou", activeJobs: 0, totalJobs: 0, owner: null }),
    view({ id: "c3", name: "Hydraulika CZ", customerNumber: "ZK0009", activeJobs: 0, totalJobs: 3, owner: { id: "u2", name: "Jiný" }, contactPerson: "Karel", city: "Olomouc" }),
  ];

  it("hledá bez diakritiky a podle čísla zákazníka / IČO", () => {
    expect(filterCustomers(list, { q: "zdar" }).map((c) => c.id)).toEqual(["c2"]);
    expect(filterCustomers(list, { q: "zk0009" }).map((c) => c.id)).toEqual(["c3"]);
    expect(filterCustomers(list, { q: "45274649" }).map((c) => c.id)).toEqual(["c1", "c3"]);
    expect(filterCustomers(list, { q: "jana brno" }).map((c) => c.id)).toEqual(["c1"]);
  });

  it("filtry aktivní / moji / bez zakázek + počty", () => {
    expect(filterCustomers(list, { filter: "aktivni" }).map((c) => c.id)).toEqual(["c1"]);
    expect(filterCustomers(list, { filter: "moji", userId: "u2" }).map((c) => c.id)).toEqual(["c3"]);
    expect(filterCustomers(list, { filter: "moji" })).toEqual([]);
    expect(filterCustomers(list, { filter: "bez_zakazek" }).map((c) => c.id)).toEqual(["c2"]);
    expect(customerFilterCounts(list, "u1")).toEqual({ vse: 3, aktivni: 1, moji: 1, bez_zakazek: 1 });
  });
});

describe("kontakty a drobnosti", () => {
  it("hlavní kontakt první, pak abecedně", () => {
    const sorted = sortContacts([
      rowToContactView({ id: "1", name: "Zdeněk" }),
      rowToContactView({ id: "2", name: "Adam" }),
      rowToContactView({ id: "3", name: "Marie", is_primary: true }),
    ]);
    expect(sorted.map((c) => c.name)).toEqual(["Marie", "Adam", "Zdeněk"]);
  });

  it("validace kontaktu", () => {
    expect(validateContactForm({ name: "", position: "", email: "", phone: "", isPrimary: false })).toBeTruthy();
    expect(validateContactForm({ name: "Petr", position: "", email: "spatne", phone: "", isPrimary: false })).toBeTruthy();
    expect(validateContactForm({ name: "Petr", position: "", email: "p@f.cz", phone: "", isPrimary: true })).toBeNull();
  });

  it("adresa, web, iniciály, barva", () => {
    expect(addressLine({ street: "Hlavní 1", city: "Brno", zip: "602 00" })).toBe("Hlavní 1, 602 00 Brno");
    expect(addressLine({ street: null, city: null, zip: null })).toBeNull();
    expect(websiteHref("firma.cz")).toBe("https://firma.cz");
    expect(websiteHref("http://x.cz/a")).toBe("http://x.cz/a");
    expect(websiteHref("nic")).toBeNull();
    expect(initialsOf("Strojmetal a.s.")).toBe("ST");
    expect(initialsOf("Kovo Žďár s. r. o.")).toBe("KŽ");
    expect(initialsOf("Hofmann Tools GmbH")).toBe("HT");
    expect(avatarToneFor("Strojmetal")).toBe(avatarToneFor("Strojmetal"));
  });
});
