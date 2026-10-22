import { describe, expect, it } from "vitest";
import {
  documentEmailBody, documentEmailHtml, documentEmailSubject, draftDocumentEmail, escapeHtml, firstEmail,
  isDocumentEmailKind, issuedEventMessage, parseEmailList, sentEventMessage, type DocumentEmailInput,
} from "./document-emails";

const base: Omit<DocumentEmailInput, "kind"> = {
  jobNumber: "Z-2026-104",
  jobTitle: "Hřídel VK-2291",
  sender: { name: "Jan Novák", position: "obchodník", phone: "+420 777 111 222", email: "jan@mnastrojarna.cz" },
  company: { name: "MNástrojárna s.r.o.", web: "www.mnastrojarna.cz", email: "obchod@mnastrojarna.cz" },
};

const flat = (s: string) => s.replace(/ | /g, " ");

describe("documentEmailSubject", () => {
  it("nabídka: číslo, název a poptávka zákazníka", () => {
    expect(documentEmailSubject({ ...base, kind: "nabidka", number: "NAB-2026-031", customerInquiryNumber: "RFQ-77" }))
      .toBe("Cenová nabídka NAB-2026-031 – Hřídel VK-2291 (Vaše poptávka č. RFQ-77)");
  });

  it("nabídka bez názvu zakázky → firma", () => {
    expect(documentEmailSubject({ ...base, jobTitle: null, kind: "nabidka", number: "NAB-1" }))
      .toBe("Cenová nabídka NAB-1 – MNástrojárna s.r.o.");
  });

  it("potvrzení: přednost má číslo objednávky zákazníka", () => {
    expect(documentEmailSubject({ ...base, kind: "potvrzeni", number: "POT-2026-104", customerOrderNumber: "PO-4500021877" }))
      .toBe("Potvrzení objednávky č. PO-4500021877 – MNástrojárna s.r.o.");
    expect(documentEmailSubject({ ...base, kind: "potvrzeni", number: "POT-2026-104" }))
      .toBe("Potvrzení objednávky POT-2026-104 – MNástrojárna s.r.o.");
  });

  it("dodací list a faktura", () => {
    expect(documentEmailSubject({ ...base, kind: "dodaci_list", number: "DL-2026-001", customerOrderNumber: "PO-1" }))
      .toBe("Dodací list DL-2026-001 k objednávce č. PO-1 – MNástrojárna s.r.o.");
    expect(documentEmailSubject({ ...base, kind: "faktura", number: "FV-2026-003", customerOrderNumber: "PO-1" }))
      .toBe("Faktura FV-2026-003 – MNástrojárna s.r.o. (objednávka č. PO-1)");
  });

  it("ostatní dokument se odkazuje na zakázku", () => {
    expect(documentEmailSubject({ ...base, kind: "ostatni" })).toBe("Dokument k zakázce Z-2026-104 – Hřídel VK-2291");
  });
});

describe("documentEmailBody", () => {
  it("nabídka: platnost, dodací lhůta, číslo zakázky a podpis", () => {
    const body = documentEmailBody({
      ...base, kind: "nabidka", number: "NAB-2026-031", customerInquiryNumber: "RFQ-77",
      validUntil: "2026-11-21", leadTimeDays: 21,
    });
    expect(body.startsWith("Dobrý den,\n\n")).toBe(true);
    expect(body).toContain("děkujeme za Vaši poptávku č. RFQ-77");
    expect(body).toContain("cenovou nabídku č. NAB-2026-031 na „Hřídel VK-2291“");
    expect(body).toContain("• Platnost nabídky: do 21. 11. 2026");
    expect(body).toContain("• Dodací lhůta: 3 týdny od potvrzení objednávky");
    expect(body).toContain("• Naše číslo zakázky: Z-2026-104");
    expect(body).toContain("S pozdravem\n\nJan Novák\nobchodník\nMNástrojárna s.r.o.\ntel.: +420 777 111 222\ne-mail: jan@mnastrojarna.cz\nwww.mnastrojarna.cz");
  });

  it("potvrzení: objednávka zákazníka s datem, termín a nabídka", () => {
    const body = documentEmailBody({
      ...base, kind: "potvrzeni", number: "POT-2026-104", customerOrderNumber: "PO-4500021877",
      customerOrderDate: "2026-10-20", deliveryDate: "2026-11-05", quoteNumber: "NAB-2026-028",
    });
    expect(body).toContain("děkujeme za Vaši objednávku č. PO-4500021877 ze dne 20. 10. 2026");
    expect(body).toContain("potvrzení č. POT-2026-104");
    expect(body).toContain("• Potvrzený termín dodání: 5. 11. 2026");
    expect(body).toContain("• Dle naší nabídky: NAB-2026-028");
  });

  it("faktura: částka, splatnost a VS", () => {
    const body = flat(documentEmailBody({
      ...base, kind: "faktura", number: "FV-2026-003", amount: 12345, currency: "CZK",
      dueDate: "2026-11-05", variableSymbol: "2026003",
    }));
    expect(body).toContain("fakturu č. FV-2026-003");
    expect(body).toContain("• Částka k úhradě: 12 345,00 Kč");
    expect(body).toContain("• Datum splatnosti: 5. 11. 2026");
    expect(body).toContain("• Variabilní symbol: 2026003");
  });

  it("faktura bez částky ji nevypisuje; chybějící údaje se vynechají", () => {
    const body = documentEmailBody({ kind: "faktura", sender: {}, company: { name: "Firma" } });
    expect(body).not.toContain("Částka");
    expect(body).not.toContain("undefined");
    expect(body).not.toContain("null");
    expect(body).toContain("v příloze Vám zasíláme fakturu.");
    expect(body.endsWith("S pozdravem\n\nFirma")).toBe(true);
  });

  it("dodací list a ostatní", () => {
    expect(documentEmailBody({ ...base, kind: "dodaci_list", number: "DL-2026-001", customerOrderNumber: "PO-9" }))
      .toContain("dodací list č. DL-2026-001 k Vaší objednávce č. PO-9.");
    expect(documentEmailBody({ ...base, kind: "ostatni", filename: "vykres.pdf" }))
      .toContain("dokument vykres.pdf k zakázce Z-2026-104 (Hřídel VK-2291).");
  });

  it("draftDocumentEmail vrací předmět i text", () => {
    const d = draftDocumentEmail({ ...base, kind: "nabidka", number: "NAB-1" });
    expect(d.subject).toContain("NAB-1");
    expect(d.body).toContain("NAB-1");
  });
});

describe("documentEmailHtml", () => {
  it("escapuje text, odstavce a řádky", () => {
    const html = documentEmailHtml("Dobrý den,\n\n<b>pozor</b> & \"x\"\nřádek 2", { companyName: "A & B", web: "www.ab.cz" });
    expect(html).toContain("&lt;b&gt;pozor&lt;/b&gt; &amp; &quot;x&quot;<br>řádek 2");
    expect(html).toContain('<p style="margin:0 0 14px 0">Dobrý den,</p>');
    expect(html).toContain("A &amp; B");
    expect(html).toContain('href="https://www.ab.cz"');
    expect(html).not.toContain("<b>");
  });

  it("nebezpečná barva se nahradí firemní červenou", () => {
    expect(documentEmailHtml("x", { companyName: "F", accent: "red;background:url(x)" })).toContain("#E03930");
    expect(documentEmailHtml("x", { companyName: "F", accent: "#123456" })).toContain("#123456");
  });

  it("escapeHtml", () => {
    expect(escapeHtml(`<a href='x'>&</a>`)).toBe("&lt;a href=&#39;x&#39;&gt;&amp;&lt;/a&gt;");
  });
});

describe("adresy", () => {
  it("firstEmail vezme první platnou", () => {
    expect(firstEmail(null, "", "neplatny", "nakup@firma.cz", "x@y.cz")).toBe("nakup@firma.cz");
    expect(firstEmail("a@b.cz; c@d.cz")).toBe("a@b.cz");
    expect(firstEmail(undefined, "bez")).toBeNull();
  });

  it("parseEmailList rozdělí platné a neplatné, odstraní duplicity", () => {
    expect(parseEmailList("a@b.cz; Jan Novák <C@d.cz>, a@B.cz,\nspatne, ")).toEqual({
      valid: ["a@b.cz", "C@d.cz"],
      invalid: ["spatne"],
    });
    expect(parseEmailList("")).toEqual({ valid: [], invalid: [] });
    expect(parseEmailList("x@y")).toEqual({ valid: [], invalid: ["x@y"] });
  });
});

describe("historie", () => {
  it("issuedEventMessage / sentEventMessage", () => {
    expect(issuedEventMessage("faktura", "FV-2026-003")).toBe("Vystavena faktura FV-2026-003 (PDF)");
    expect(issuedEventMessage("potvrzeni", "POT-1", 2)).toBe("Vystaveno potvrzení objednávky POT-1 (PDF) — verze 2");
    expect(sentEventMessage("nabidka", "NAB-1", "x@y.cz")).toBe("Odeslána nabídka NAB-1 na x@y.cz");
    expect(sentEventMessage("ostatni", null, "x@y.cz")).toBe("Odeslán dokument na x@y.cz");
  });

  it("isDocumentEmailKind", () => {
    expect(isDocumentEmailKind("faktura")).toBe(true);
    expect(isDocumentEmailKind("vykres")).toBe(false);
  });
});
