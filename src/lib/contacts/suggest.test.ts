import { describe, expect, it } from "vitest";
import { matchScore, mergeSuggestions, splitPasted, suggestionDetail, type RecipientSuggestion } from "./suggest";

const NOW = Date.parse("2026-10-30T12:00:00Z");

describe("mergeSuggestions", () => {
  it("sloučí adresář a konverzace, adresář dodá jméno a firmu, pošta četnost", () => {
    const book: RecipientSuggestion[] = [{ email: "novak@bosch.test", name: "Pavel Novák", kind: "kontakt", company: "Bosch", position: "nákupčí" }];
    const mail: RecipientSuggestion[] = [
      { email: "NOVAK@bosch.test", name: "P. Novak", kind: "konverzace", hits: 9, lastAt: "2026-10-29T10:00:00Z" },
      { email: "novotny@jinde.test", name: "Jan Novotný", kind: "konverzace", hits: 1, lastAt: "2025-01-01T00:00:00Z" },
    ];
    const r = mergeSuggestions([book, mail], "nov", { now: NOW });
    expect(r[0]).toMatchObject({ email: "novak@bosch.test", name: "Pavel Novák", kind: "kontakt", company: "Bosch", hits: 9 });
    expect(r).toHaveLength(2);
  });
  it("bez diakritiky, vyloučení vybraných, nesouvisející pryč", () => {
    const list: RecipientSuggestion[] = [
      { email: "sponer@firma.test", name: "Tomáš Šponer", kind: "kolega" },
      { email: "x@y.test", name: "Jiný", kind: "konverzace" },
    ];
    expect(mergeSuggestions([list], "spon", { now: NOW }).map((s) => s.email)).toEqual(["sponer@firma.test"]);
    expect(mergeSuggestions([list], "spon", { now: NOW, exclude: ["sponer@firma.test"] })).toEqual([]);
  });
  it("prázdný dotaz: související se zakázkou nahoře", () => {
    const list: RecipientSuggestion[] = [
      { email: "a@x.test", name: "A", kind: "konverzace", hits: 50 },
      { email: "faktury@bosch.test", name: "Fakturace", kind: "kontakt", related: true, roles: ["Fakturace"] },
    ];
    expect(mergeSuggestions([list], "", { now: NOW })[0].email).toBe("faktury@bosch.test");
  });
  it("skóre a detail", () => {
    expect(matchScore({ email: "novak@bosch.test", name: "Pavel Novák" }, "pavel nov")).toBeGreaterThan(0);
    expect(matchScore({ email: "novak@bosch.test", name: "Pavel Novák" }, "zz")).toBe(0);
    expect(suggestionDetail({ email: "a@b.cz", name: "Pavel", kind: "kontakt", company: "Bosch", position: "nákupčí", roles: ["Fakturace"] })).toBe("Bosch · nákupčí · Fakturace");
  });
});

describe("splitPasted", () => {
  it("víc adres najednou", () => {
    expect(splitPasted("Jan <JAN@a.test>; eva@b.test,\nnic")).toEqual({ emails: ["jan@a.test", "eva@b.test"], rest: ["nic"] });
  });
});
