import { describe, it, expect } from "vitest";
import { matchPartyByEmail, emailDomain, FREEMAIL_DOMAINS } from "./match";

const parties = [
  { id: "c1", email: "dvorak@strojmetal.cz" },
  { id: "c2", email: "nakup@tdkprecision.com" },
  { id: "c3", email: "pepa@gmail.com" },
  { id: "c4", email: null },
];

describe("emailDomain", () => {
  it("vrátí doménu malými písmeny", () => {
    expect(emailDomain("Jan.Dvorak@StrojMetal.CZ")).toBe("strojmetal.cz");
  });
  it("vrátí null pro neplatný vstup", () => {
    expect(emailDomain("bez-zavinace")).toBeNull();
    expect(emailDomain("@")).toBeNull();
    expect(emailDomain("a@")).toBeNull();
  });
});

describe("matchPartyByEmail", () => {
  it("najde přesnou shodu adresy", () => {
    expect(matchPartyByEmail("dvorak@strojmetal.cz", parties)).toBe("c1");
  });
  it("přesná shoda ignoruje velikost písmen", () => {
    expect(matchPartyByEmail("DVORAK@STROJMETAL.CZ", parties)).toBe("c1");
  });
  it("napáruje jinou osobu ze stejné firemní domény", () => {
    expect(matchPartyByEmail("uctarna@strojmetal.cz", parties)).toBe("c1");
  });
  it("freemail se na doménu nepáruje (jiný gmail ≠ stejná firma)", () => {
    expect(matchPartyByEmail("nekdo-jiny@gmail.com", parties)).toBeUndefined();
  });
  it("freemail se páruje jen na přesnou adresu", () => {
    expect(matchPartyByEmail("pepa@gmail.com", parties)).toBe("c3");
  });
  it("neznámá adresa nic nenajde", () => {
    expect(matchPartyByEmail("kdo@neznama-firma.cz", parties)).toBeUndefined();
    expect(matchPartyByEmail("", parties)).toBeUndefined();
  });
  it("freemail seznam obsahuje běžné české domény", () => {
    expect(FREEMAIL_DOMAINS.has("seznam.cz")).toBe(true);
    expect(FREEMAIL_DOMAINS.has("email.cz")).toBe(true);
  });
});
