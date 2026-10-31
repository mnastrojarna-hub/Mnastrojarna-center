import { describe, expect, it } from "vitest";
import { detectRoleEmails } from "./role-detect";

describe("detectRoleEmails", () => {
  it("pokyny k zasílání", () => {
    const r = detectRoleEmails("Dobrý den,\nfaktury prosím zasílejte na fakturace@bosch.test. Objednávky posílejte na nakup@bosch.test.\nDíky");
    expect(r.map((x) => [x.role, x.email])).toEqual([["fakturace", "fakturace@bosch.test"], ["nakup", "nakup@bosch.test"]]);
  });
  it("popisky v podpisu a jiné jazyky", () => {
    expect(detectRoleEmails("Fakturace: ucetni@firma.test\nPoptávky: rfq@firma.test")).toEqual([
      expect.objectContaining({ role: "fakturace", email: "ucetni@firma.test" }),
      expect.objectContaining({ role: "nabidky", email: "rfq@firma.test" }),
    ]);
    expect(detectRoleEmails("Please send invoices to ap@company.test")[0]).toMatchObject({ role: "fakturace", email: "ap@company.test" });
    expect(detectRoleEmails("Rechnungen bitte an rechnung@firma.de senden")[0]).toMatchObject({ role: "fakturace" });
  });
  it("bez pokynu nic (poděkování za objednávku + podpis)", () => {
    expect(detectRoleEmails("Děkujeme za objednávku.\nS pozdravem\nPavel Novák\nnovak@bosch.test")).toEqual([]);
    expect(detectRoleEmails("bez adresy")).toEqual([]);
  });
  it("vynechá naše adresy", () => {
    expect(detectRoleEmails("faktury zasílejte na faktury@mnastrojarna.cz", { exclude: (e) => e.endsWith("@mnastrojarna.cz") })).toEqual([]);
  });
});
