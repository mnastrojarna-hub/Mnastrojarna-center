import { describe, expect, it } from "vitest";
import { formatLeadEmail, isForeignVat, isFreeMail, isValidCzIco, scoreLead, validateLead, type LeadInput } from "./lead";

const base: LeadInput = {
  needs: ["cnc-obrabeni"],
  budget: "200k-1m",
  quantity: "6-50",
  deadline: "1m",
  description: "Hřídele dle výkresu, materiál 42CrMo4, kalené.",
  ico: "04304080",
  company: "Testovací a.s.",
  name: "Jan Novák",
  email: "jan.novak@firma.cz",
  gdpr: true,
};

describe("IČO / VAT", () => {
  it("validuje kontrolní součet IČO", () => {
    expect(isValidCzIco("04304080")).toBe(true); // Mnástrojárna
    expect(isValidCzIco("04304081")).toBe(false);
    expect(isValidCzIco("1234")).toBe(false);
    expect(isValidCzIco("25596641")).toBe(true);
  });
  it("rozpozná zahraniční VAT ID", () => {
    expect(isForeignVat("DE123456789")).toBe(true);
    expect(isForeignVat("CZ04304080")).toBe(false);
    expect(isForeignVat("abc")).toBe(false);
  });
});

describe("validateLead", () => {
  it("projde validní poptávka", () => {
    expect(validateLead(base)).toEqual({});
  });
  it("odmítne zakázku pod 50 000 Kč", () => {
    expect(validateLead({ ...base, budget: "pod-50k" }).budget).toMatch(/50 000/);
  });
  it("vyžaduje IČO, souhlas a popis", () => {
    const e = validateLead({ ...base, ico: "", gdpr: false, description: "x" });
    expect(Object.keys(e).sort()).toEqual(["description", "gdpr", "ico"]);
  });
  it("odmítne neplatný odkaz a e-mail", () => {
    const e = validateLead({ ...base, email: "x@", dataLink: "ftp://x" });
    expect(e.email).toBeTruthy();
    expect(e.dataLink).toBeTruthy();
  });
});

describe("scoreLead", () => {
  it("velká ověřená zakázka s výkresem = A", () => {
    const s = scoreLead({ ...base, budget: "1-5m", phone: "+420 777 123 456" }, { company: { ico: "04304080", name: "X s.r.o." }, attachments: 2 });
    expect(s.grade).toBe("A");
  });
  it("freemail bez dokumentace a malý rozpočet = C", () => {
    const s = scoreLead({ ...base, budget: "50-200k", email: "pepa@seznam.cz" }, { company: null, attachments: 0 });
    expect(s.grade).toBe("C");
    expect(isFreeMail("pepa@seznam.cz")).toBe(true);
  });
});

describe("formatLeadEmail", () => {
  it("escapuje HTML a nese skóre v předmětu", () => {
    const s = scoreLead(base, { company: null, attachments: 0 });
    const m = formatLeadEmail({ ...base, description: "<script>alert(1)</script>" }, s, null, []);
    expect(m.subject).toContain(`[${s.grade}]`);
    expect(m.html).not.toContain("<script>");
    expect(m.text).toContain("alert(1)");
    expect(m.html).toContain("&lt;script&gt;");
  });
});
