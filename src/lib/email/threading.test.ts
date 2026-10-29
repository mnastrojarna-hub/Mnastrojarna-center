import { describe, it, expect } from "vitest";
import {
  bracketId, firstAddress, forwardBlock, forwardSubject, isReplySubject, normalizeSubject, parseMessageIds, quoteForReply,
  replyHeaders, replyRecipients, replySubject, sortThread, splitAddresses, subjectKey, withSignature,
} from "./threading";

describe("vlákna — předmět a klíč", () => {
  it("normalizace předmětu bez Re:/Fwd:/Odp: (i opakovaně, i [2])", () => {
    expect(normalizeSubject("Re: RE: Fwd: Poptávka  hřídele")).toBe("poptávka hřídele");
    expect(normalizeSubject("Odp[2]: Objednávka 4500123")).toBe("objednávka 4500123");
    expect(normalizeSubject("AW: WG: Anfrage")).toBe("anfrage");
    expect(normalizeSubject("Recenze výkresu")).toBe("recenze výkresu"); // „Re" bez dvojtečky není předpona
    expect(normalizeSubject(null)).toBe("");
  });
  it("odpověď poznám podle předpony", () => {
    expect(isReplySubject("Re: x")).toBe(true);
    expect(isReplySubject("Fwd: x")).toBe(true);
    expect(isReplySubject("Poptávka")).toBe(false);
  });
  it("klíč = předmět + protistrana (příchozí odesílatel, odchozí první adresát)", () => {
    expect(subjectKey({ subject: "Re: Poptávka", direction: "in", fromEmail: "Jan <JAN@firma.cz>" })).toBe("poptávka|jan@firma.cz");
    expect(subjectKey({ subject: "Poptávka", direction: "out", toEmail: "jan@firma.cz, eva@firma.cz" })).toBe("poptávka|jan@firma.cz");
  });
  it("první adresa a seznam adres", () => {
    expect(firstAddress("Jan Novák <Jan@Firma.cz>")).toBe("jan@firma.cz");
    expect(splitAddresses("a@b.cz; Jan <c@d.cz>, a@b.cz")).toEqual(["a@b.cz", "c@d.cz"]);
  });
});

describe("hlavičky odpovědi (In-Reply-To / References)", () => {
  it("Message-ID v <…>, References z hlavičky", () => {
    expect(bracketId("abc@x")).toBe("<abc@x>");
    expect(bracketId("<abc@x>")).toBe("<abc@x>");
    expect(bracketId("")).toBeNull();
    expect(parseMessageIds("<a@x> <b@y>\r\n <a@x>")).toEqual(["<a@x>", "<b@y>"]);
    expect(parseMessageIds("bare@id")).toEqual(["<bare@id>"]);
  });
  it("In-Reply-To = původní Message-ID, References = jeho References + Message-ID (max 20)", () => {
    expect(replyHeaders({ messageId: "<m3@x>", references: ["<m1@x>", "<m2@x>"], subject: "Re: a" })).toEqual({ inReplyTo: "<m3@x>", references: ["<m1@x>", "<m2@x>", "<m3@x>"] });
    const many = Array.from({ length: 30 }, (_, i) => `<r${i}@x>`);
    const h = replyHeaders({ messageId: "last@x", references: many, subject: "" });
    expect(h.references).toHaveLength(20);
    expect(h.references.at(-1)).toBe("<last@x>");
    expect(replyHeaders({ messageId: null, subject: "a" })).toEqual({ references: [] });
  });
  it("předmět odpovědi a přeposlání", () => {
    expect(replySubject("Poptávka")).toBe("Re: Poptávka");
    expect(replySubject("Re: Poptávka")).toBe("Re: Poptávka");
    expect(replySubject("Fwd: Poptávka")).toBe("Re: Poptávka");
    expect(forwardSubject("Re: Poptávka")).toBe("Fwd: Poptávka");
    expect(replySubject("")).toBe("Re: (bez předmětu)");
  });
});

describe("citace, přeposlání, podpis, adresáti", () => {
  const src = { fromName: "Jan", fromEmail: "jan@firma.cz", toEmail: "obchod@my.cz", subject: "Poptávka", receivedAt: "2026-10-22T08:00:00Z", body: "Dobrý den\r\n> starší\r\nS pozdravem" };
  it("citace s „> “ a hlavičkou Dne … napsal(a)", () => {
    const q = quoteForReply(src);
    expect(q).toMatch(/^Dne .*2026.* Jan <jan@firma\.cz> napsal\(a\):\n> Dobrý den\n>> starší\n> S pozdravem$/);
  });
  it("přeposlaná zpráva: hlavička + celé tělo", () => {
    const f = forwardBlock(src);
    expect(f).toContain("---------- Přeposlaná zpráva ----------");
    expect(f).toContain("Od: Jan <jan@firma.cz>");
    expect(f).toContain("Předmět: Poptávka");
    expect(f).toContain("Komu: obchod@my.cz");
    expect(f.endsWith("S pozdravem")).toBe(true);
  });
  it("podpis za „-- “", () => {
    expect(withSignature("Text", "Jan\nfirma")).toBe("Text\n\n-- \nJan\nfirma");
    expect(withSignature("Text", "  ")).toBe("Text");
  });
  it("Odpovědět = odesílatel; Odpovědět všem = + ostatní adresáti a kopie bez mých adres", () => {
    const msg = { direction: "in" as const, fromEmail: "jan@firma.cz", toEmail: "obchod@my.cz, eva@firma.cz", ccEmail: "petr@firma.cz, obchod@my.cz" };
    expect(replyRecipients(msg, ["obchod@my.cz"], false)).toEqual({ to: ["jan@firma.cz"], cc: [] });
    expect(replyRecipients(msg, ["OBCHOD@my.cz"], true)).toEqual({ to: ["jan@firma.cz"], cc: ["eva@firma.cz", "petr@firma.cz"] });
    // odpověď na vlastní odeslanou zprávu → znovu jejím adresátům
    expect(replyRecipients({ direction: "out", fromEmail: "obchod@my.cz", toEmail: "jan@firma.cz" }, ["obchod@my.cz"], false)).toEqual({ to: ["jan@firma.cz"], cc: [] });
  });
  it("vlákno od nejstarší", () => {
    const s = sortThread([{ id: "b", receivedAt: "2026-10-22T09:00:00Z" }, { id: "a", receivedAt: "2026-10-22T08:00:00Z" }, { id: "c", receivedAt: "2026-10-22T09:00:00Z" }]);
    expect(s.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
});
