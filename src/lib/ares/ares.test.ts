import { describe, expect, it } from "vitest";
import subjektKamenice from "./__fixtures__/subjekt-25037684.json";
import subjektVut from "./__fixtures__/subjekt-00216305.json";
import subjektMy from "./__fixtures__/subjekt-04304080.json";
import vyhledatStrojmetal from "./__fixtures__/vyhledat.json";
import {
  aresAddress, companyNameKey, formatZip, icoDigits, isValidIco, parseAresSearch, parseAresSubject, pickAresByName,
  type AresCompany,
} from "./ares";

describe("IČO", () => {
  it("kontrolní číslice", () => {
    expect(isValidIco("04304080")).toBe(true);
    expect(isValidIco("25037684")).toBe(true);
    expect(isValidIco("00216305")).toBe(true);
    expect(isValidIco("45274649")).toBe(true);
    expect(isValidIco("12345678")).toBe(false);
    expect(isValidIco("25037685")).toBe(false);
    expect(isValidIco("")).toBe(false);
    expect(isValidIco("abc")).toBe(false);
  });

  it("mezery, prefix a doplnění nul", () => {
    expect(icoDigits("043 04 080")).toBe("04304080");
    expect(icoDigits("IČ: 4304080")).toBe("04304080");
    expect(icoDigits("216305")).toBe("00216305");
    expect(icoDigits("123456789")).toBeNull();
    expect(icoDigits("00000000")).toBeNull();
    expect(isValidIco("216305")).toBe(true);
  });
});

describe("převod odpovědi ARES", () => {
  it("firma s ulicí a č. p. bez orientačního (Kamenice)", () => {
    const c = parseAresSubject(subjektKamenice)!;
    expect(c).toMatchObject({
      ico: "25037684",
      name: "Strojmetal Aluminium Forging a.s.",
      dic: "CZ25037684",
      street: "Ringhofferova 66",
      city: "Kamenice",
      zip: "251 68",
      country: "CZ",
      address: "Ringhofferova 66, 251 68 Kamenice",
      defunct: false,
    });
  });

  it("Praha: obec z poštovní adresy (Praha 2), č. p./č. o.", () => {
    const c = parseAresSubject(subjektMy)!;
    expect(c.street).toBe("Varšavská 715/36");
    expect(c.city).toBe("Praha 2");
    expect(c.zip).toBe("120 00");
    expect(c.dic).toBe("CZ04304080");
  });

  it("Brno: obec Brno (ne Brno-střed)", () => {
    const c = parseAresSubject(subjektVut)!;
    expect(c.city).toBe("Brno");
    expect(c.street).toBe("Antonínská 548/1");
  });

  it("bez ulice: část obce + číslo; č. ev.; písmeno orientačního", () => {
    expect(aresAddress({ nazevObce: "Sedlec", nazevCastiObce: "Sedlec", cisloDomovni: 12, psc: 25001, textovaAdresa: "Sedlec 12, 25001 Sedlec", kodStatu: "CZ" }))
      .toMatchObject({ street: "Sedlec 12", city: "Sedlec", zip: "250 01" });
    expect(aresAddress({ nazevObce: "Lhota", nazevCastiObce: "Lhota", cisloDomovni: 7, typCisloDomovni: 2, psc: 39601 }).street).toBe("Lhota č. ev. 7");
    expect(aresAddress({ nazevObce: "Plzeň", nazevUlice: "Nádražní", cisloDomovni: 1200, cisloOrientacni: 5, cisloOrientacniPismeno: "a", psc: 30100 }))
      .toMatchObject({ street: "Nádražní 1200/5a", city: "Plzeň", zip: "301 00" });
  });

  it("jen textová adresa (zahraničí / nestandardizovaná)", () => {
    expect(aresAddress({ kodStatu: "SK", textovaAdresa: "Hlavná 5, 04001 Košice" })).toMatchObject({
      street: "Hlavná 5", city: "Košice", zip: "040 01", country: "SK",
    });
  });

  it("zaniklá firma, chybějící DIČ, neplatná data", () => {
    const c = parseAresSubject({ ico: "25037684", obchodniJmeno: "Stará firma s.r.o.", datumZaniku: "2019-05-31", sidlo: {} })!;
    expect(c.defunct).toBe(true);
    expect(c.defunctDate).toBe("2019-05-31");
    expect(c.dic).toBeNull();
    expect(parseAresSubject({ kod: "NENALEZENO" })).toBeNull();
    expect(parseAresSubject(null)).toBeNull();
  });

  it("výsledek hledání", () => {
    const r = parseAresSearch(vyhledatStrojmetal);
    expect(r.total).toBe(3);
    expect(r.items.map((x) => x.ico)).toEqual(["14054434", "25037684", "29013569"]);
    expect(parseAresSearch({})).toEqual({ total: 0, items: [] });
  });

  it("PSČ", () => {
    expect(formatZip(12000)).toBe("120 00");
    expect(formatZip("602 00")).toBe("602 00");
    expect(formatZip("1234")).toBeNull();
  });
});

describe("výběr podle názvu", () => {
  const items = parseAresSearch(vyhledatStrojmetal).items;

  it("název bez právní formy a diakritiky", () => {
    expect(companyNameKey("ČEZ, a. s.")).toBe("cez");
    expect(companyNameKey("Strojmetal Aluminium Forging a.s.")).toBe("strojmetal aluminium forging");
    expect(companyNameKey("KOVO Novák, spol. s r.o.")).toBe("kovo novak");
    expect(companyNameKey("PP STROJMETAL s.r.o.")).toBe("pp strojmetal");
  });

  it("přesná shoda názvu = jistá", () => {
    const r = pickAresByName(items, { name: "STROJMETAL ALUMINIUM FORGING, a. s." });
    expect(r.pick?.ico).toBe("25037684");
    expect(r.candidates[0].ico).toBe("25037684");
  });

  it("nejasný název = bez výběru, kandidáti k výběru", () => {
    const r = pickAresByName(items, { name: "Strojmetal" });
    expect(r.pick).toBeNull();
    expect(r.candidates).toHaveLength(3);
  });

  it("víc stejných názvů rozhodne PSČ, jediný podobný výsledek se bere", () => {
    const a = { ...items[1], ico: "11111111", zip: "602 00", city: "Brno" } as AresCompany;
    const b = { ...items[1], ico: "22222222", zip: "251 68", city: "Kamenice" } as AresCompany;
    expect(pickAresByName([a, b], { name: items[1].name, zip: "25168" }).pick?.ico).toBe("22222222");
    expect(pickAresByName([a, b], { name: items[1].name, city: "Brno" }).pick?.ico).toBe("11111111");
    expect(pickAresByName([a, b], { name: items[1].name }).pick).toBeNull();
    expect(pickAresByName([items[1]], { name: "Strojmetal Aluminium" }).pick?.ico).toBe("25037684");
    expect(pickAresByName([items[1]], { name: "Úplně jiná firma" }).pick).toBeNull();
  });

  it("zaniklé firmy jen když nic jiného není", () => {
    const dead = { ...items[1], ico: "33333333", defunct: true } as AresCompany;
    expect(pickAresByName([dead, items[1]], { name: items[1].name }).pick?.ico).toBe("25037684");
    expect(pickAresByName([dead], { name: items[1].name }).pick?.ico).toBe("33333333");
  });
});
