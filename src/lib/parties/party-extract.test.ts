import { describe, expect, it } from "vitest";
import subjektKamenice from "@/lib/ares/__fixtures__/subjekt-25037684.json";
import { parseAresSubject } from "@/lib/ares/ares";
import {
  PARTY_SCHEMA, aresIcoOf, mergeWithAres, normalizePartyExtract, ourDomains, partySystemPrompt,
} from "./party-extract";

const raw = {
  name: " KOVO  Novák s.r.o. ",
  ico: "IČ: 250 37 684",
  dic: "cz 25037684",
  street: "Průmyslová 5", city: "Kamenice", zip: "25168", country: "Česká republika",
  email: "INFO@kovo-novak.cz",
  phone: "+420 222 333 444",
  website: "https://www.kovo-novak.cz/",
  contacts: [
    { name: "Jan Novák", position: "nákupčí", email: "Jan.Novak@kovo-novak.cz", phone: "+420 777 111 222" },
    { name: "Jan Novák", position: "", email: "jan.novak@kovo-novak.cz", phone: "" },
    { name: "Petr Náš", position: "obchod", email: "petr@mnastrojarna.cz", phone: "" },
    { name: "", position: "", email: "", phone: "" },
  ],
  roleEmails: [
    { role: "fakturace", email: "faktury@kovo-novak.cz" },
    { role: "fakturace", email: "FAKTURY@kovo-novak.cz" },
    { role: "dodaci_listy", email: "obchod@mnastrojarna.cz" },
    { role: "neznamy", email: "x@kovo-novak.cz" },
  ],
  paymentTermsDays: 30,
  supplierNumberAtCustomer: " 40017 ",
  deliveryAddress: "Sklad Hala 3, Kamenice",
  technologies: ["frézování", "Frézování", "kalení"],
  materials: [], certifications: ["ISO 9001"],
  documentKind: "objednávka",
  confidence: 1.4,
  summary: "Objednávka od KOVO Novák.",
  needsClarification: ["", "Ověř IČO"],
};

describe("normalizePartyExtract", () => {
  it("zákazník: uklidí údaje, vyhodí naše lidi a adresy, duplicitní kontakty a cizí účely", () => {
    const p = normalizePartyExtract(raw, "customer");
    expect(p).toMatchObject({
      name: "KOVO Novák s.r.o.",
      ico: "25037684",
      dic: "CZ25037684",
      zip: "25168",
      country: "CZ",
      email: "info@kovo-novak.cz",
      website: "www.kovo-novak.cz",
      paymentTermsDays: 30,
      supplierNumberAtCustomer: "40017",
      deliveryAddress: "Sklad Hala 3, Kamenice",
      technologies: [],
      certifications: [],
      confidence: 1,
      needsClarification: ["Ověř IČO"],
      onlyOurs: false,
    });
    expect(p.contacts).toEqual([{ name: "Jan Novák", position: "nákupčí", email: "jan.novak@kovo-novak.cz", phone: "+420 777 111 222" }]);
    expect(p.roleEmails).toEqual([{ role: "fakturace", email: "faktury@kovo-novak.cz" }]);
  });

  it("dodavatel: štítky ano, zákaznické údaje ne; účel dodací listy jen u zákazníka", () => {
    const p = normalizePartyExtract({ ...raw, roleEmails: [{ role: "nakup", email: "obj@kovo-novak.cz" }] }, "supplier");
    expect(p.technologies).toEqual(["frézování", "kalení"]);
    expect(p.certifications).toEqual(["ISO 9001"]);
    expect(p.paymentTermsDays).toBeNull();
    expect(p.supplierNumberAtCustomer).toBe("");
    expect(p.deliveryAddress).toBe("");
    expect(p.roleEmails).toEqual([{ role: "nakup", email: "obj@kovo-novak.cz" }]);
  });

  it("AI vrátila naši firmu → údaje firmy prázdné, onlyOurs", () => {
    const p = normalizePartyExtract({ name: "MNástrojárna s.r.o.", ico: "04304080", email: "obchod@mnastrojarna.cz", contacts: [] }, "customer");
    expect(p.onlyOurs).toBe(true);
    expect(p.name).toBe("");
    expect(p.ico).toBe("");
    expect(p.email).toBe("");
  });

  it("nesmysly a chybějící pole", () => {
    const p = normalizePartyExtract({ phone: "volejte", website: "není", paymentTermsDays: 9999, email: "bez zavináče" }, "customer");
    expect(p.phone).toBe("");
    expect(p.website).toBe("");
    expect(p.paymentTermsDays).toBeNull();
    expect(p.email).toBe("");
    expect(p.contacts).toEqual([]);
    expect(normalizePartyExtract(null, "supplier").name).toBe("");
  });
});

describe("ARES", () => {
  const ares = parseAresSubject(subjektKamenice)!;

  it("ARES má přednost u názvu, IČO, DIČ a celého sídla", () => {
    const doc = normalizePartyExtract({ ...raw, name: "Strojmetal", dic: "", street: "Jiná 1", city: "", zip: "11000" }, "customer");
    const { fields, sources } = mergeWithAres(doc, ares);
    expect(fields).toEqual({
      name: "Strojmetal Aluminium Forging a.s.", ico: "25037684", dic: "CZ25037684",
      street: "Ringhofferova 66", city: "Kamenice", zip: "251 68", country: "CZ",
    });
    expect(sources).toMatchObject({ name: "ares", ico: "ares", dic: "ares", street: "ares", zip: "ares" });
  });

  it("bez DIČ v ARES zůstane DIČ z dokladu; bez ARES vše z dokladu", () => {
    const doc = normalizePartyExtract(raw, "customer");
    const merged = mergeWithAres(doc, { ...ares, dic: null });
    expect(merged.fields.dic).toBe("CZ25037684");
    expect(merged.sources.dic).toBe("doc");
    const none = mergeWithAres(doc, null);
    expect(none.fields.name).toBe("KOVO Novák s.r.o.");
    expect(none.sources).toMatchObject({ name: "doc", ico: "doc", street: "doc" });
  });

  it("které IČO hledat", () => {
    expect(aresIcoOf({ ico: "25037684", country: "CZ", dic: "" })).toEqual({ ico: "25037684", invalid: false });
    expect(aresIcoOf({ ico: "25037685", country: "CZ", dic: "" })).toEqual({ ico: null, invalid: true });
    expect(aresIcoOf({ ico: "12345678", country: "DE", dic: "DE123456789" })).toEqual({ ico: null, invalid: false });
    expect(aresIcoOf({ ico: "", country: "CZ", dic: "" })).toEqual({ ico: null, invalid: false });
  });
});

describe("prompt a schéma", () => {
  it("prompt říká, koho hledat, a vylučuje nás", () => {
    expect(partySystemPrompt("customer")).toMatch(/ZÁKAZNÍKA/);
    expect(partySystemPrompt("supplier")).toMatch(/DODAVATELE/);
    expect(partySystemPrompt("customer")).toMatch(/Nezakládáš zakázku/);
    expect(partySystemPrompt("supplier")).toContain("04304080");
    expect(ourDomains()).toContain("mnastrojarna.cz");
  });

  it("strukturovaný výstup: všechna pole povinná", () => {
    expect(PARTY_SCHEMA.required.sort()).toEqual(Object.keys(PARTY_SCHEMA.properties).sort());
    const c = PARTY_SCHEMA.properties.contacts.items;
    expect(c.required.sort()).toEqual(Object.keys(c.properties).sort());
  });
});
