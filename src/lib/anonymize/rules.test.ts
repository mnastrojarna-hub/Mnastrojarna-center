import { describe, it, expect } from "vitest";
import {
  DEFAULT_REDACT, isTechnicalText, makeTerms, ruleLine, rulePage, stripLegalForm, findTermRanges, makeTerm,
  isSuspiciousLiteral, type RuleContext,
} from "./rules";
import type { TextLine, Zone } from "./types";

const ctx = (over: Partial<RuleContext> = {}): RuleContext => ({
  terms: [], keepTerms: ["Mnástrojárna", "Mnastrojarna"], redact: { ...DEFAULT_REDACT }, ...over,
});

const hitTexts = (text: string, zone: Zone = "title_block", c: RuleContext = ctx()) =>
  ruleLine(text, zone, c).hits.map((h) => ({ cat: h.category, t: text.slice(h.start, h.end), rule: h.rule }));

describe("cesty", () => {
  it.each([
    ["C:\\Projekty\\Strojmetal\\Hřídel nová\\D-1234.dwg", "path_win"],
    ["C:/Users/novak/Vykresy/hridel.SLDDRW", "path_win"],
    ["..\\vykresy\\D-1234.dwg", "path_rel"],
    ["\\\\server01\\cad$\\projekty\\D-1234.dwg", "path_unc"],
    ["/home/novak/cad/D-1234.dxf", "path_unix"],
    ["file:///C:/cad/x.pdf", "path_file"],
    ["https://strojmetal.sharepoint.com/sites/cad/D-1234.pdf", "path_cloud"],
    ["Soubor: hridel_v3", "path_label"],
  ])("%s", (text, rule) => {
    const h = hitTexts(text, "body");
    expect(h.some((x) => x.cat === "path" && x.rule === rule)).toBe(true);
  });

  it("plot stamp se maže celý (od cesty do konce řádku)", () => {
    const t = "C:\\Projekty\\D-1234.dwg  23.10.2026 14:05  novak";
    const h = ruleLine(t, "frame", ctx()).hits.find((x) => x.rule === "path_win")!;
    expect(h.start).toBe(0);
    expect(h.end).toBe(t.length);
    expect(h.wholeItem).toBe(true);
  });

  it("cesta s diakritikou a mezerami", () => {
    const t = "D:\\Výkresy zákazníků\\Nový díl\\sestava.iam";
    expect(hitTexts(t, "body")[0]).toMatchObject({ cat: "path", t });
  });
});

describe("kontakty", () => {
  it.each([
    ["info@strojmetal.cz", "email"],
    ["www.strojmetal.cz", "url"],
    ["strojmetal.de", "domain"],
    ["Tel.: +420 312 456 789", "phone"],
    ["+49 89 1234 5678", "phone"],
    ["IČO: 12345678", "ico"],
    ["DIČ: CZ12345678", "vat"],
    ["USt-IdNr. DE123456789", "vat"],
  ])("%s", (text, rule) => {
    expect(hitTexts(text, "body").some((x) => x.cat === "contact" && x.rule === rule)).toBe(true);
  });

  it("tolerance nejsou telefon", () => {
    expect(hitTexts("+0,05 / -0,02", "body")).toEqual([]);
    expect(hitTexts("Ø25 +0.021/+0.008", "body")).toEqual([]);
  });

  it("adresa v razítku", () => {
    expect(hitTexts("Průmyslová 1234/5, 272 01 Kladno").some((x) => x.cat === "contact" && x.rule === "address")).toBe(true);
  });
});

describe("právní formy", () => {
  it.each([
    "STROJMETAL a.s.", "Strojírny Kladno s.r.o.", "ACME spol. s r.o.", "Müller GmbH", "Bosch Rexroth AG", "Huber KG",
    "Acme Ltd.", "Acme LLC", "Acme Inc.", "Acme Corp.", "Acme Co.", "Acme PLC", "Acme S.A.", "Acme SAS", "Acme S.r.l.",
    "Acme SRL", "Acme S.p.A.", "Acme B.V.", "Acme N.V.", "Acme SE", "Acme Sp. z o.o.", "Acme sp.j.", "Acme Kft.",
    "Acme Zrt.", "Acme d.o.o.", "Acme Oy", "Acme AB", "Acme A/S", "Acme ApS", "Kovo k.s.", "Kovo v.o.s.", "Spolek z.s.",
  ])("razítko: %s", (text) => {
    expect(hitTexts(text).some((x) => x.cat === "company")).toBe(true);
  });

  it("Fa. Müller v razítku je firma", () => {
    expect(hitTexts("Fa. Müller").some((x) => x.cat === "company")).toBe(true);
  });

  it.each(["SKF 6205-2RS", "Bosch Rexroth AG", "pozink Wiegel GmbH"])("mimo razítko pravidlo nemaže: %s", (text) => {
    const r = ruleLine(text, "body", ctx());
    expect(r.hits.filter((h) => h.category === "company")).toEqual([]);
  });

  it("mimo razítko je právní forma kandidát pro AI", () => {
    expect(ruleLine("Bosch Rexroth AG", "body", ctx()).candidate).toBe(true);
  });

  it("jednotka KG po čísle není právní forma", () => {
    expect(hitTexts("Hmotnost: 2,5 KG")).toEqual([]);
  });

  it("naše firma je výjimka", () => {
    expect(hitTexts("Mnástrojárna s.r.o.")).toEqual([]);
  });
});

describe("osoby (kotvy v 10 jazycích)", () => {
  it.each([
    ["Kreslil: J. Novák", "J. Novák"],
    ["Kreslil: Jan Novák 12.3.2024", "Jan Novák"],
    ["Kontroloval: Dvořák", "Dvořák"],
    ["Schválil: Ing. Petr Svoboda", "Ing. Petr Svoboda"],
    ["Gezeichnet: Müller", "Müller"],
    ["Geprüft: Schmidt", "Schmidt"],
    ["Drawn by: John Smith", "John Smith"],
    ["Checked: A. Brown", "A. Brown"],
    ["Rysował: Kowalski", "Kowalski"],
    ["Dessiné: Dupont", "Dupont"],
    ["Disegnato: Rossi", "Rossi"],
    ["Dibujado: García", "García"],
    ["Rajzolta: Kovács", "Kovács"],
    ["Разраб. Иванов", "Иванов"],
    ["设计: 王伟", "王伟"],
  ])("%s", (text, name) => {
    const h = hitTexts(text);
    expect(h.some((x) => x.cat === "person" && x.t.includes(name))).toBe(true);
  });

  it("popisek a datum zůstávají", () => {
    const t = "Kreslil: Novák 12.03.2024";
    const h = hitTexts(t).filter((x) => x.cat === "person");
    expect(h.map((x) => x.t)).toEqual(["Novák"]);
  });

  it("dvě kotvy v jednom řádku", () => {
    const h = hitTexts("Kreslil: Novák   Schválil: Dvořák").filter((x) => x.cat === "person").map((x) => x.t);
    expect(h).toContain("Novák");
    expect(h).toContain("Dvořák");
    expect(h.join(" ")).not.toContain("Schválil");
  });

  it("přepínač kontroloval/schválil", () => {
    const c = ctx({ redact: { ...DEFAULT_REDACT, person_checked: false } });
    expect(hitTexts("Schválil: Dvořák", "title_block", c)).toEqual([]);
    expect(hitTexts("Kreslil: Novák", "title_block", c).length).toBe(1);
  });

  it("iniciály v řádku revize", () => {
    const h = hitTexts("B  Změna rozměru 25 → 26  12.03.2024  JN", "revisions").filter((x) => x.cat === "person");
    expect(h.map((x) => x.t)).toEqual(["JN"]);
  });
});

describe("doložka", () => {
  it("maže jen jméno vlastníka", () => {
    const t = "© STROJMETAL a.s. Kopírování bez souhlasu zakázáno";
    const h = hitTexts(t).filter((x) => x.cat === "copyright_owner" || x.cat === "company");
    expect(h.some((x) => x.t.startsWith("STROJMETAL"))).toBe(true);
    const owner = hitTexts(t).find((x) => x.cat === "copyright_owner")!;
    expect(owner.t).not.toContain("zakázáno");
  });
  it("majetkem firmy X", () => {
    const h = hitTexts("Tento výkres je majetkem firmy Strojmetal Kladno.").filter((x) => x.cat === "copyright_owner");
    expect(h[0].t).toContain("Strojmetal");
  });
});

describe("podniková norma", () => {
  it.each(["dle Werknorm 123", "podniková norma PN 01", "Dle ŠKODA N 01 1234"])("%s → review", (t) => {
    const terms = makeTerms(["ŠKODA"], "crm");
    expect(ruleLine(t, "body", ctx({ terms })).customerStandard).toBe(true);
  });
  it("STM-N 123 se zkratkou zákazníka", () => {
    const terms = makeTerms(["STROJMETAL"], "crm");
    expect(ruleLine("Povrch dle STM-N 123", "body", ctx({ terms })).customerStandard).toBe(true);
  });
});

describe("technické tokeny", () => {
  it.each([
    "Ø25 h7", "H7/g6", "ISO 2768-mK", "1.4301", "S235JR+AR", "EN AW-6082 T6", "Ra 1,6", "M8x1.25", "DIN 912",
    "ČSN EN 10025", "Rev. B", "1:2", "12.03.2024", "2024-03-12", "42CrMo4+QT", "100 x 50 x 20", "±0,1", "R5", "HRC 58",
  ])("%s je technický", (t) => {
    expect(isTechnicalText(t)).toBe(true);
    expect(hitTexts(t, "title_block")).toEqual([]);
  });
  it.each(["SKF", "SM", "MS", "HSK", "Fa. Müller", "EN-Tech", "STROJMETAL"])("%s NENÍ technický", (t) => {
    expect(isTechnicalText(t)).toBe(false);
  });
});

describe("termíny", () => {
  it("normalizovaně, bez diakritiky, celé slovo", () => {
    const terms = makeTerms(["Strojmetal Kladno a.s."], "crm");
    expect(terms[0].norm).toBe("strojmetal kladno");
    const h = hitTexts("výrobek STROJMETAL KLADNO pro", "body", ctx({ terms }));
    expect(h).toEqual([{ cat: "custom", t: "STROJMETAL KLADNO", rule: "term_crm" }]);
  });
  it("rozepsané po znacích", () => {
    const t = makeTerm("Strojmetal", "crm")!;
    expect(findTermRanges("S T R O J M E T A L", t)).toEqual([{ start: 0, end: 19 }]);
  });
  it("výjimky neruší custom (i v technickém kontextu)", () => {
    const terms = makeTerms(["HSK"], "custom");
    expect(hitTexts("HSK 63", "body", ctx({ terms })).some((x) => x.cat === "custom")).toBe(true);
  });
  it("krátké termíny (< 3 znaky) a naše firma se ignorují", () => {
    expect(makeTerms(["AB", "Mnástrojárna s.r.o."], "custom", ["Mnástrojárna"])).toEqual([]);
  });
  it("stripLegalForm", () => {
    expect(stripLegalForm("STROJMETAL a.s.")).toBe("STROJMETAL");
    expect(stripLegalForm("Bosch Rexroth AG")).toBe("Bosch Rexroth");
  });
});

describe("rulePage — soused, keep pole", () => {
  const L = (id: string, text: string, x: number, y: number, w = 40, zone: Zone = "title_block"): TextLine => ({
    id, page: 1, text, spans: [{ itemId: id, start: 0, end: text.length, offset: 0 }], box: { x, y, w, h: 3 }, fontSize: 3, rot: 0, zone,
  });
  it("hodnota v buňce vpravo od popisku", () => {
    const lines = [L("a", "Kreslil", 100, 200, 15), L("b", "J. Novák", 130, 200, 20), L("c", "12.3.2024", 160, 200, 20)];
    const r = rulePage(lines, ctx());
    expect(r.hits.filter((h) => h.lineId === "b" && h.category === "person").length).toBeGreaterThan(0);
    expect(r.hits.some((h) => h.lineId === "c")).toBe(false);
  });
  it("keep pole čísla výkresu a termín v něm → review", () => {
    const terms = makeTerms(["STM"], "custom");
    const lines = [L("a", "Číslo výkresu:", 100, 200, 25), L("b", "STM-1234-01", 130, 200, 25)];
    const r = rulePage(lines, ctx({ terms }));
    expect(r.keep.find((k) => k.field === "drawingNumber")?.value).toBe("STM-1234-01");
    expect(r.termInKeep).toBe(true);
    expect(r.hits.some((h) => h.lineId === "b")).toBe(false);
  });
});

describe("isSuspiciousLiteral", () => {
  it.each(["info@x.cz", "strojmetal.cz", "ACME s.r.o.", "Bosch AG"])("%s", (t) => expect(isSuspiciousLiteral(t)).toBe(true));
  it.each(["D-1234", "Hřídel", "1.4301", "2,5 KG"])("%s není", (t) => expect(isSuspiciousLiteral(t)).toBe(false));
});
