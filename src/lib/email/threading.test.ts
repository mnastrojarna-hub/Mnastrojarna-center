import { describe, it, expect } from "vitest";
import {
  assignThread, bracketId, firstAddress, forwardBlock, forwardSubject, isReplySubject, normalizeSubject, parseMessageIds, quoteForReply, quotesMessage,
  replyHeaders, replyRecipients, replySubject, sortThread, splitAddresses, subjectKey, threadsToAdopt, withSignature, type NewThreadMessage, type ThreadCandidate,
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

describe("pravidlo vlákna — jen skutečná konverzace (Pošta E, „Poptávka Brisk“)", () => {
  const BOX = "b1";
  const first: ThreadCandidate = {
    id: "e1", threadId: "m:b1:<a1@brisk.cz>", mailboxId: BOX, messageId: "<a1@brisk.cz>", subject: "Poptávka Brisk", direction: "in",
    fromEmail: "nakup@brisk.cz", receivedAt: "2026-10-01T08:00:00Z", snippet: "Dobrý den, poptáváme 50 ks pouzder dle výkresu BR-100, termín do konce měsíce.",
  };
  const replied: ThreadCandidate = { ...first, id: "e0", threadId: "m:b1:<a0@brisk.cz>", messageId: "<a0@brisk.cz>", subject: "Re: Poptávka Brisk", receivedAt: "2026-09-01T08:00:00Z", snippet: "Děkujeme za nabídku, objednáme." };
  const msg = (p: Partial<NewThreadMessage>): NewThreadMessage => ({
    id: "n1", mailboxId: BOX, messageId: "<n1@brisk.cz>", subject: "Poptávka Brisk", direction: "in", fromEmail: "nakup@brisk.cz", receivedAt: "2026-10-08T08:00:00Z", ...p,
  });

  it("stejný předmět i odesílatel, jiná poptávka o týden později → nové vlákno (i když starší vlákno má „Re:“)", () => {
    expect(assignThread(msg({}), [first, replied])).toBe("m:b1:<n1@brisk.cz>");
  });
  it("odpověď s In-Reply-To / References → vlákno původní zprávy (i bez „Re:“ v předmětu)", () => {
    expect(assignThread(msg({ subject: "Re: Poptávka Brisk", inReplyTo: "<a1@brisk.cz>" }), [first])).toBe(first.threadId);
    expect(assignThread(msg({ subject: "Doplnění", references: ["a1@brisk.cz"] }), [first])).toBe(first.threadId);
  });
  it("původní zpráva stažená až po odpovědi → vlákno odpovědi", () => {
    const reply: ThreadCandidate = { ...first, id: "r", threadId: "m:b1:<r@x>", messageId: "<r@x>", inReplyTo: "<n1@brisk.cz>", subject: "Re: Poptávka Brisk", receivedAt: "2026-10-09T08:00:00Z" };
    expect(assignThread(msg({}), [reply])).toBe("m:b1:<r@x>");
  });
  it("Fw:/Re: bez hlaviček → nové vlákno; s prokazatelnou citací dřívější zprávy → její vlákno", () => {
    expect(assignThread(msg({ subject: "Fw: Poptávka Brisk", body: "Posílám dál." }), [first])).toBe("m:b1:<n1@brisk.cz>");
    const quoted = `Ano, termín platí.\n\n> Dobrý den, poptáváme 50 ks\n> pouzder dle výkresu BR-100, termín do konce měsíce.`;
    expect(assignThread(msg({ subject: "Re: Poptávka Brisk", body: quoted }), [first])).toBe(first.threadId);
    expect(quotesMessage(quoted, first.snippet)).toBe(true);
    expect(quotesMessage("krátké", "krátké")).toBe(false); // krátký text citaci neprokáže
  });
  it("„Re:“ bez hlaviček s citací přišlo dřív než originál (stahování od nejnovější) → originál do jejího vlákna", () => {
    const quotingReply: ThreadCandidate = {
      ...first, id: "q", threadId: "m:b1:<q@x>", messageId: "<q@x>", subject: "Re: Poptávka Brisk", receivedAt: "2026-10-09T08:00:00Z",
      body: "Platí.\n> Dobrý den, poptáváme 50 ks pouzder dle výkresu BR-100, termín do konce měsíce.",
    };
    expect(assignThread(msg({ snippet: first.snippet, receivedAt: "2026-10-01T08:00:00Z" }), [quotingReply])).toBe("m:b1:<q@x>");
    // jiná poptávka se stejným předmětem citovaná není → nové vlákno
    expect(assignThread(msg({ snippet: "Dobrý den, nová poptávka: 200 ks čepů dle výkresu BR-555." }), [quotingReply])).toBe("m:b1:<n1@brisk.cz>");
  });
  it("první stažení od nejnovější: odpovědi (hlavičky i citace) čekající na originál se k němu připojí, jiná poptávka ne", () => {
    const hdr: ThreadCandidate = { ...first, id: "h", threadId: "m:b1:<h@x>", messageId: "<h@x>", inReplyTo: "<n1@brisk.cz>", subject: "Re: Poptávka Brisk", receivedAt: "2026-10-09T08:00:00Z" };
    const quo: ThreadCandidate = {
      ...first, id: "q", threadId: "m:b1:<q@x>", messageId: "<q@x>", subject: "Re: Poptávka Brisk", receivedAt: "2026-10-10T08:00:00Z",
      body: "Platí.\n> Dobrý den, poptáváme 50 ks pouzder dle výkresu BR-100, termín do konce měsíce.",
    };
    const other: ThreadCandidate = { ...first, id: "o", threadId: "m:b1:<o@x>", messageId: "<o@x>", subject: "Poptávka Brisk", receivedAt: "2026-10-11T08:00:00Z", snippet: "Jiná poptávka 200 ks." };
    const orig = msg({ snippet: first.snippet, receivedAt: "2026-10-01T08:00:00Z" });
    const tid = assignThread(orig, [hdr, quo, other]);
    expect(tid).toBe("m:b1:<h@x>"); // hlavičky první
    expect(threadsToAdopt({ ...orig, threadId: tid }, [hdr, quo, other])).toEqual(["m:b1:<q@x>"]);
  });
  it("jiná schránka se nespojí ani s hlavičkami", () => {
    expect(assignThread(msg({ mailboxId: "b2", inReplyTo: "<a1@brisk.cz>" }), [first])).toBe("m:b2:<n1@brisk.cz>");
  });
  it("Outlook conversationId: jen bez hlaviček a u „Re:“; hlavičky mají přednost", () => {
    const conv: ThreadCandidate = { ...first, id: "c", threadId: "m:b1:<c@x>", messageId: "<c@x>", conversationId: "CONV-1", receivedAt: "2026-10-02T08:00:00Z" };
    expect(assignThread(msg({ subject: "Re: Poptávka Brisk", conversationId: "CONV-1" }), [conv, first])).toBe("m:b1:<c@x>");
    // bez „Re:“ conversationId nestačí
    expect(assignThread(msg({ conversationId: "CONV-1" }), [conv])).toBe("m:b1:<n1@brisk.cz>");
    // hlavičky ukazují jinam než conversationId → platí hlavičky
    expect(assignThread(msg({ subject: "Re: Poptávka Brisk", conversationId: "CONV-1", inReplyTo: "<a1@brisk.cz>" }), [conv, first])).toBe(first.threadId);
  });
});
