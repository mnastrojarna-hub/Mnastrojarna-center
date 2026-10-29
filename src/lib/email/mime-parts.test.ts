import { describe, it, expect } from "vitest";
import { attachmentsFromStructure, decodeWords, extractPart, listAttachments, parseHeaderValue, readHeaders } from "./mime-parts";

const pdf = Buffer.from("%PDF-1.4 testovací výkres H-100");
const b64 = pdf.toString("base64").replace(/.{1,20}/g, "$&\r\n");
const raw = Buffer.from([
  "Message-ID: <a@x>",
  "In-Reply-To: <orig@x>",
  "References: <r1@x>\r\n <orig@x>",
  "Subject: =?UTF-8?B?UG9wdMOhdmth?=",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="B1"',
  "",
  "--B1",
  'Content-Type: multipart/alternative; boundary="B2"',
  "",
  "--B2",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Dobrý den",
  "--B2",
  "Content-Type: text/html; charset=utf-8",
  "",
  "<p>Dobrý den</p>",
  "--B2--",
  "--B1",
  'Content-Type: application/pdf; name="vykres.pdf"',
  'Content-Disposition: attachment; filename*=UTF-8\'\'v%C3%BDkres%20H-100.pdf',
  "Content-Transfer-Encoding: base64",
  "",
  b64,
  "--B1",
  "Content-Type: image/png",
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from("PNGDATA").toString("base64"),
  "--B1--",
  "",
].join("\r\n"), "utf8");

describe("MIME — hlavičky a přílohy", () => {
  it("hlavičky (rozbalené) a parametry", () => {
    const h = readHeaders(raw);
    expect(h["in-reply-to"]).toBe("<orig@x>");
    expect(h["references"]).toBe("<r1@x> <orig@x>");
    expect(decodeWords(h["subject"])).toBe("Poptávka");
    expect(parseHeaderValue('text/plain; charset="utf-8"; name="a b.pdf"')).toEqual({ value: "text/plain", params: { charset: "utf-8", name: "a b.pdf" } });
    expect(decodeWords("=?iso-8859-2?Q?P=F8=EDloha?=")).toBe("Příloha");
  });
  it("přílohy s číslováním jako IMAP (text v alternative 1.1/1.2 se nepočítá)", () => {
    const att = listAttachments(raw);
    expect(att.map((a) => [a.partId, a.filename, a.contentType])).toEqual([
      ["2", "výkres H-100.pdf", "application/pdf"],
      ["3", "priloha-3.png", "image/png"],
    ]);
    expect(att[0].size).toBe(pdf.length);
  });
  it("obsah přílohy podle čísla části (přeposlání / stažení)", () => {
    const p = extractPart(raw, "2");
    expect(p?.content.equals(pdf)).toBe(true);
    expect(p?.filename).toBe("výkres H-100.pdf");
    expect(extractPart(raw, "9")).toBeNull();
  });
  it("zkrácená zpráva: příloha je vidět, velikost neznámá", () => {
    const cut = raw.subarray(0, raw.indexOf("PNGDATA".slice(0, 1)) > 0 ? raw.length - 30 : raw.length);
    const att = listAttachments(cut, true);
    expect(att.some((a) => a.filename === "výkres H-100.pdf")).toBe(true);
    expect(att.at(-1)?.size).toBeNull();
  });
  it("jednoduchá zpráva bez příloh", () => {
    expect(listAttachments(Buffer.from("Subject: x\r\nContent-Type: text/plain\r\n\r\nahoj\r\n"))).toEqual([]);
  });
  it("BODYSTRUCTURE ze serveru (imapflow)", () => {
    const att = attachmentsFromStructure({
      childNodes: [
        { part: "1", type: "text/plain", size: 10 },
        { part: "2", type: "application/pdf", disposition: "attachment", dispositionParameters: { filename: "a.pdf" }, size: 400, encoding: "base64" },
      ],
    });
    expect(att).toEqual([{ partId: "2", filename: "a.pdf", contentType: "application/pdf", size: 300 }]);
  });
});
