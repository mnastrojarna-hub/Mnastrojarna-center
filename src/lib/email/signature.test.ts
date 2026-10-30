import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_CORRESPONDENCE_ADDRESS, SIGNATURE_LOGO_CID, SIGNATURE_LOGO_HEIGHT, SIGNATURE_LOGO_PATH, SIGNATURE_LOGO_WIDTH, SIGNATURE_VARIANTS,
  cleanLine, defaultSignatureFor, formatPhone, htmlBodyWithSignature, linkLabel, locateSignature, mailboxKey, normalizeSignature,
  phoneHref, pickStoredSignature, plainTextToHtml, putStoredSignature, renderSignature, safeWebHref, sameSignature,
  signatureCompanyFrom, signatureHtmlForApp, signatureLogoSrc, signatureLogoUrl, stripClosing, type SignatureSettings,
} from "./signature";
import { SIGNATURE_LOGO_PNG_BASE64, SIGNATURE_LOGO_PNG_SIZE } from "./signature-logo-data";

const company = signatureCompanyFrom({
  name: "Mnástrojárna s.r.o.",
  slogan: "místo pro Vaši kooperaci…",
  address: { street: "Varšavská 715/36", zip: "120 00", city: "Praha 2" },
  ico: "04304080",
  dic: "CZ04304080",
  web: "www.mnastrojarna.cz",
});
const LOGO = "https://app.mnastrojarna.cz/brand/mnastrojarna-email-logo@2x.png";
const vit = defaultSignatureFor({ fullName: "Vít Volný", phone: "734 846 246" }, "vit.volny@mnastrojarna.cz", company);
const jiri = defaultSignatureFor({ fullName: "Jiří Semorád", phone: "+420 774 534 513", position: "obchod" }, "semorad@nastrojarstvi.com", company);
const render = (s: SignatureSettings, logoSrc: string | null = LOGO) => renderSignature(s, { company, logoSrc });

/** Všechny odkazy v HTML (href). */
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("výchozí podpis", () => {
  it("z profilu, adresy schránky a firmy; varianta Firemní se vším", () => {
    expect(vit).toMatchObject({
      enabled: true, variant: "firemni", closing: "S pozdravem", fullName: "Vít Volný", role: "", phone: "+420 734 846 246",
      email: "vit.volny@mnastrojarna.cz", web: "www.mnastrojarna.cz", links: [], note: "",
      show: { logo: true, company: true, address: true, certifications: true, slogan: false },
    });
    expect(jiri.role).toBe("obchod");
  });
  it("bez schránky e-mail z profilu; neplatný e-mail se nevyplní", () => {
    expect(defaultSignatureFor({ fullName: "A", email: "Ja@Firma.CZ" }, null, company).email).toBe("ja@firma.cz");
    expect(defaultSignatureFor({ fullName: "A", email: "nesmysl" }, "", null).email).toBe("");
  });
});

describe("firemní údaje", () => {
  it("sídlo na jednom řádku, korespondenční adresa Pelhřimov, certifikace", () => {
    expect(company).toMatchObject({
      name: "Mnástrojárna s.r.o.", billingAddress: "Varšavská 715/36, 120 00 Praha 2", correspondenceAddress: "Mezná 9, 393 01 Pelhřimov",
      ico: "04304080", dic: "CZ04304080", certifications: ["ISO 9001", "ISO 14001"],
    });
    expect(DEFAULT_CORRESPONDENCE_ADDRESS).toBe("Mezná 9, 393 01 Pelhřimov");
  });
  it("z nastavení: adresa a certifikace jako text", () => {
    const c = signatureCompanyFrom({ name: "X", address: {} }, { correspondenceAddress: "Jiná 1, 100 00 Praha", certifications: "ISO 9001; IATF 16949" });
    expect(c.correspondenceAddress).toBe("Jiná 1, 100 00 Praha");
    expect(c.certifications).toEqual(["ISO 9001", "IATF 16949"]);
    expect(c.billingAddress).toBe("");
  });
});

describe("renderSignature — varianty", () => {
  it("Kompaktní: jméno, logo, kontakty na řádku; bez firemních údajů", () => {
    const { html, text } = render({ ...jiri, variant: "kompaktni" });
    expect(html).toContain("Jiří Semorád");
    expect(html).toContain(`src="${LOGO}"`);
    expect(html).toContain('href="tel:+420774534513"');
    expect(html).toContain('href="mailto:semorad@nastrojarstvi.com"');
    expect(html).toContain('href="https://www.mnastrojarna.cz"');
    expect(html).not.toContain("IČO");
    expect(html).not.toContain("Mezná");
    expect(text).toBe([
      "S pozdravem", "", "Jiří Semorád", "obchod | Mnástrojárna s.r.o.", "",
      "+420 774 534 513 | semorad@nastrojarstvi.com | www.mnastrojarna.cz",
    ].join("\n"));
  });

  it("Firemní: navíc fakturační údaje, adresa pro poštu a certifikace (drobně, šedě)", () => {
    const { html, text } = render(vit);
    expect(html).toContain("IČO&nbsp;04304080");
    expect(html).toContain("DIČ&nbsp;CZ04304080");
    expect(html).toContain("Doručovací a korespondenční adresa: Mezná 9, 393 01 Pelhřimov");
    expect(html).toContain("ISO 14001");
    expect(html).toContain("#6C6D6F");
    expect(text).toBe([
      "S pozdravem", "", "Vít Volný", "Mnástrojárna s.r.o.", "",
      "tel.: +420 734 846 246", "e-mail: vit.volny@mnastrojarna.cz", "web: www.mnastrojarna.cz", "",
      "Mnástrojárna s.r.o., Varšavská 715/36, 120 00 Praha 2", "IČO 04304080, DIČ CZ04304080",
      "Doručovací a korespondenční adresa: Mezná 9, 393 01 Pelhřimov", "Certifikace: ISO 9001, ISO 14001",
    ].join("\n"));
  });

  it("Vizitka: logo vlevo, červená linka, kontakty pod sebou (T / E / W), Outlook přes podmíněnou tabulku", () => {
    const { html } = render({ ...vit, variant: "vizitka" });
    expect(html).toContain("border-left:2px solid #E03930");
    expect(html).toContain("display:inline-block");
    expect(html).toContain("<!--[if mso]>");
    expect(html).toMatch(/>T<\/td>[\s\S]*>E<\/td>[\s\S]*>W<\/td>/);
    expect(html).toContain("IČO&nbsp;04304080");
  });

  it("každá varianta: bezpečné e-mailové HTML (tabulky, inline styly, Roboto → Arial, max. 520 px, logo 160 × 40)", () => {
    for (const variant of SIGNATURE_VARIANTS) {
      const { html } = render({ ...vit, variant, links: ["https://www.linkedin.com/company/mnastrojarna"] });
      expect(html.startsWith('<table role="presentation"')).toBe(true);
      expect(html).toContain("max-width:520px");
      expect(html).toContain("font-family:Roboto,Arial,Helvetica,sans-serif");
      expect(html).not.toMatch(/<style|<script|<link|class=|<svg|@import|url\(/i);
      expect(html).toContain(`width="${SIGNATURE_LOGO_WIDTH}" height="${SIGNATURE_LOGO_HEIGHT}"`);
      for (const h of hrefs(html)) expect(h).toMatch(/^(https:\/\/|mailto:|tel:\+)/);
      expect(html).toContain(">LinkedIn<");
    }
  });

  it("přepínače bloků", () => {
    const off = render({ ...vit, show: { logo: false, company: false, address: false, certifications: true, slogan: true } });
    expect(off.html).not.toContain("<img");
    expect(off.html).toContain("Mnástrojárna s.r.o."); // bez loga je firma v řádku pozice
    expect(off.html).not.toContain("IČO");
    expect(off.html).not.toContain("Mezná");
    expect(off.html).toContain("ISO 9001");
    expect(off.html).toContain("místo pro Vaši kooperaci…");
    expect(off.text).toContain("místo pro Vaši kooperaci…");
    expect(off.text).not.toContain("IČO");
  });

  it("chybějící údaje: jen jméno; bez telefonu a webu; nic → prázdný podpis; vypnutý → prázdný", () => {
    const onlyName = render({ ...vit, variant: "kompaktni", phone: "", email: "", web: "" }, null);
    expect(onlyName.text).toBe("S pozdravem\n\nVít Volný\nMnástrojárna s.r.o.\n\nwww.mnastrojarna.cz");
    const noWeb = render({ ...vit, variant: "kompaktni", web: "" }, null);
    expect(noWeb.text).toContain("www.mnastrojarna.cz"); // web firmy, když uživatel vlastní nemá
    const empty = renderSignature({ ...vit, variant: "kompaktni", fullName: "", phone: "", email: "", web: "", show: { ...vit.show, logo: false } }, {
      company: { ...company, name: "", web: "" }, logoSrc: null,
    });
    expect(empty).toEqual({ html: "", text: "" });
    expect(render({ ...vit, enabled: false })).toEqual({ html: "", text: "" });
  });

  it("bez pozdravu začíná jménem", () => {
    expect(render({ ...vit, closing: "" }).text.startsWith("Vít Volný\n")).toBe(true);
  });

  it("poznámka pod podpisem (max. 3 řádky) a druhý telefon", () => {
    const { html, text } = render({ ...vit, note: "a\nb\nc\nd", phone2: "+420 565 123 456" });
    expect(html).toContain("a<br>b<br>c");
    expect(html).not.toContain("<br>d");
    expect(text.endsWith("\n\na\nb\nc")).toBe(true);
    expect(html).toContain('href="tel:+420565123456"');
  });
});

describe("renderSignature — escapování (žádné vložení HTML)", () => {
  const evil = "<img src=x onerror=alert(1)>";
  it("jméno, pozice, pozdrav, poznámka, telefon", () => {
    const { html, text } = render({ ...vit, fullName: evil, role: `"><script>alert(1)</script>`, closing: "<b>Ahoj</b>", note: "<i>x</i>", phone: "<svg onload=1>" });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<b>Ahoj");
    expect(html).not.toContain("<i>x");
    expect(html).not.toContain("<svg");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(text).toContain(evil); // text je text
  });
  it("odkazy: javascript:, data:, uvozovky v e-mailu a webu se nevloží", () => {
    const { html } = render({
      ...vit, web: "javascript:alert(1)", email: 'a@b.cz" onmouseover="x', links: ["javascript:alert(1)", "data:text/html,x", "https://ok.cz/\"x"],
    });
    expect(html).not.toMatch(/javascript:|data:text|onmouseover/);
    expect(html).toContain('href="https://www.mnastrojarna.cz"'); // web firmy místo neplatného
    for (const h of hrefs(html)) expect(h).toMatch(/^(https:\/\/|mailto:|tel:\+)/);
  });
  it("firemní údaje z nastavení se escapují také", () => {
    const { html } = renderSignature(vit, { company: { ...company, name: "<b>X</b>", correspondenceAddress: "<u>A</u>", certifications: ["<i>ISO</i>"] }, logoSrc: LOGO });
    expect(html).not.toMatch(/<b>X|<u>A|<i>ISO/);
  });
  it("logo jen z povolených zdrojů", () => {
    for (const bad of ['javascript:alert(1)', 'https://x.cz/a.png" onerror="1', "//evil.cz/x.png", "data:text/html;base64,AAAA", "ftp://x.cz/l.png"]) {
      expect(render(vit, bad).html).not.toContain("<img");
    }
    expect(render(vit, `cid:${SIGNATURE_LOGO_CID}`).html).toContain(`src="cid:${SIGNATURE_LOGO_CID}"`);
    expect(render(vit, SIGNATURE_LOGO_PATH).html).toContain(`src="${SIGNATURE_LOGO_PATH}"`);
  });
});

describe("logo — absolutní URL a cid", () => {
  it("z předané adresy aplikace", () => {
    expect(signatureLogoUrl("https://app.mnastrojarna.cz/")).toBe(LOGO);
    expect(signatureLogoUrl("http://localhost:3000")).toBe("http://localhost:3000/brand/mnastrojarna-email-logo@2x.png");
    expect(signatureLogoUrl("nesmysl")).toBeNull();
    expect(signatureLogoUrl("javascript:alert(1)//")).toBeNull();
  });
  it("z prostředí: APP_URL → NEXT_PUBLIC_APP_URL → Vercel", () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://crm.mnastrojarna.cz");
    expect(signatureLogoUrl()).toBe("https://crm.mnastrojarna.cz/brand/mnastrojarna-email-logo@2x.png");
    vi.stubEnv("APP_URL", "https://app.mnastrojarna.cz");
    expect(signatureLogoUrl()).toBe(LOGO);
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "mn.vercel.app");
    expect(signatureLogoUrl()).toBe("https://mn.vercel.app/brand/mnastrojarna-email-logo@2x.png");
  });
  it("uložené HTML zprávy: logo cid → logo z webu aplikace", () => {
    const html = render(vit, `cid:${SIGNATURE_LOGO_CID}`).html;
    const app = signatureHtmlForApp(html);
    expect(app).not.toContain("cid:");
    expect(app).toContain(`src="${SIGNATURE_LOGO_PATH}"`);
  });
  it("cid / url", () => {
    expect(signatureLogoSrc("cid")).toBe(`cid:${SIGNATURE_LOGO_CID}`);
    expect(signatureLogoSrc("url", "https://app.mnastrojarna.cz")).toBe(LOGO);
  });
  it("PNG v public/brand a base64 modul jsou stejné (2×, 320 × 80) — přegeneruj tools/brand/render-email-logo.mjs", () => {
    const file = fs.readFileSync(path.join(process.cwd(), "public", SIGNATURE_LOGO_PATH));
    expect(file.subarray(1, 4).toString()).toBe("PNG");
    expect([file.readUInt32BE(16), file.readUInt32BE(20)]).toEqual([SIGNATURE_LOGO_WIDTH * 2, SIGNATURE_LOGO_HEIGHT * 2]);
    expect(SIGNATURE_LOGO_PNG_SIZE).toEqual({ width: SIGNATURE_LOGO_WIDTH * 2, height: SIGNATURE_LOGO_HEIGHT * 2 });
    expect(Buffer.from(SIGNATURE_LOGO_PNG_BASE64, "base64").equals(file)).toBe(true);
  });
});

describe("telefon, web, odkazy", () => {
  it("české číslo do tvaru +420 XXX XXX XXX, zahraniční beze změny", () => {
    expect(formatPhone("734846246")).toBe("+420 734 846 246");
    expect(formatPhone("00420 734 846 246")).toBe("+420 734 846 246");
    expect(formatPhone("+420734-846-246")).toBe("+420 734 846 246");
    expect(formatPhone("+49 30 1234567")).toBe("+49 30 1234567");
    expect(formatPhone("  ")).toBe("");
  });
  it("tel: odkaz", () => {
    expect(phoneHref("734 846 246")).toBe("tel:+420734846246");
    expect(phoneHref("+420 774 534 513")).toBe("tel:+420774534513");
    expect(phoneHref("0049 30 1234567")).toBe("tel:+49301234567");
    expect(phoneHref("123")).toBeNull();
  });
  it("web: doplní https, odmítne nesmysly", () => {
    expect(safeWebHref("www.mnastrojarna.cz")).toBe("https://www.mnastrojarna.cz");
    expect(safeWebHref("HTTP://Mnastrojarna.CZ/kontakt")).toBe("http://mnastrojarna.cz/kontakt");
    for (const bad of ["javascript:alert(1)", "mailto:a@b.cz", "https://user@evil.cz", "localhost", "a b.cz", "https://x"]) expect(safeWebHref(bad)).toBeNull();
  });
  it("popisky odkazů podle domény", () => {
    expect(linkLabel("https://www.linkedin.com/in/x")).toBe("LinkedIn");
    expect(linkLabel("https://m.facebook.com/mn")).toBe("Facebook");
    expect(linkLabel("https://youtu.be/x")).toBe("YouTube");
    expect(linkLabel("https://www.firma.cz/x")).toBe("firma.cz");
  });
  it("cleanLine: řídicí a neviditelné znaky pryč, mezery sloučené", () => {
    expect(cleanLine("  Jan‮\u0000  Novák\n ", 80)).toBe("Jan Novák");
    expect(cleanLine("x".repeat(100), 10)).toBe("x".repeat(10));
  });
});

describe("normalizeSignature (vstup z prohlížeče / z DB)", () => {
  it("neznámé klíče pryč, délky, neplatné hodnoty z výchozího", () => {
    const n = normalizeSignature({
      v: 9, variant: "hack", fullName: "  Vít   Volný  ", role: "r".repeat(500), email: "spatne", extra: "<x>",
      links: ["https://www.linkedin.com/in/vit", "javascript:1", "https://a.cz", "https://b.cz", "https://c.cz"],
      show: { logo: "ano", company: false }, note: "1\n2\n3\n4", enabled: "true",
    }, vit);
    expect(n.v).toBe(1);
    expect(n.variant).toBe("firemni");
    expect(n.fullName).toBe("Vít Volný");
    expect(n.role.length).toBe(80);
    expect(n.email).toBe(vit.email);
    expect(n.links).toEqual(["https://www.linkedin.com/in/vit", "https://a.cz", "https://b.cz"]);
    expect(n.show).toEqual({ ...vit.show, company: false });
    expect(n.note).toBe("1\n2\n3");
    expect(n.enabled).toBe(true);
    expect("extra" in n).toBe(false);
  });
  it("nesmyslný vstup → výchozí", () => {
    expect(normalizeSignature(null, vit)).toEqual(vit);
    expect(normalizeSignature("x", vit)).toEqual(vit);
    expect(sameSignature(normalizeSignature({}, jiri), jiri)).toBe(true);
  });
});

describe("uložení: podpis pro každou schránku", () => {
  const a = { ...vit, variant: "kompaktni" as const };
  const b = { ...vit, variant: "vizitka" as const };
  it("schránka → společný → nic", () => {
    let st = putStoredSignature(null, "Vit.Volny@Mnastrojarna.cz", a);
    expect(st).toEqual({ v: 1, mailboxes: { "vit.volny@mnastrojarna.cz": a } });
    expect(pickStoredSignature(st, "VIT.VOLNY@mnastrojarna.cz", vit)).toEqual({ settings: a, source: "mailbox" });
    expect(pickStoredSignature(st, "obchod@mnastrojarna.cz", vit)).toBeNull();
    st = putStoredSignature(st, null, b);
    expect(pickStoredSignature(st, "obchod@mnastrojarna.cz", vit)).toEqual({ settings: b, source: "default" });
    expect(pickStoredSignature(st, "vit.volny@mnastrojarna.cz", vit)?.source).toBe("mailbox");
  });
  it("smazání (obnovit výchozí) a odolnost vůči nesmyslům", () => {
    const st = putStoredSignature({ v: 1, mailboxes: { "x@y.cz": a, "nesmysl": a, "z@y.cz": 5 } }, "x@y.cz", null);
    expect(st).toEqual({ v: 1 });
    expect(putStoredSignature("garbage", null, null)).toEqual({ v: 1 });
    expect(pickStoredSignature([1, 2], "x@y.cz", vit)).toBeNull();
    expect(mailboxKey(" Jan@Firma.cz ")).toBe("jan@firma.cz");
    expect(mailboxKey("bez zavinace")).toBeNull();
  });
  it("uložený podpis se při čtení normalizuje", () => {
    const st = { v: 1, mailboxes: { "x@y.cz": { fullName: "<b>", variant: "nic" } } };
    expect(pickStoredSignature(st, "x@y.cz", vit)?.settings).toMatchObject({ fullName: "<b>", variant: "firemni", email: vit.email });
  });
  it("max. 20 schránek", () => {
    let st: unknown = null;
    for (let i = 0; i < 25; i++) st = putStoredSignature(st, `u${i}@firma.cz`, a);
    expect(Object.keys((st as { mailboxes: object }).mailboxes)).toHaveLength(20);
  });
});

describe("zpráva s grafickým podpisem", () => {
  const sig = render(vit, `cid:${SIGNATURE_LOGO_CID}`);
  const quote = "Dne 28. 10. 2026 Jan <jan@firma.cz> napsal(a):\n> Dobrý den,\n> > starší citace\n> pošlete nabídku <b>prosím</b>.";

  it("odpověď z okna psaní: text, podpis (místo „-- “ + text), citace jako blockquote", () => {
    const body = `Dobrý den,\nnabídku posílám v příloze <hned>.\n\n-- \n${sig.text}\n\n${quote}\n`;
    const html = htmlBodyWithSignature(body, sig)!;
    expect(html).toContain("nabídku posílám v příloze &lt;hned&gt;.");
    expect(html).toContain(sig.html);
    expect(html).not.toContain("-- <br>");
    expect(html.indexOf(sig.html)).toBeLessThan(html.indexOf("<blockquote"));
    expect(html).toContain("pošlete nabídku &lt;b&gt;prosím&lt;/b&gt;.");
    expect((html.match(/<blockquote/g) ?? []).length).toBe(2);
    expect(html).toContain('<a href="mailto:jan@firma.cz"');
  });

  it("uživatel podpis v textu upravil nebo smazal → jen text (null)", () => {
    expect(htmlBodyWithSignature(`Ahoj\n\n-- \n${sig.text.replace("Vít", "Vítek")}`, sig)).toBeNull();
    expect(htmlBodyWithSignature("Ahoj", sig)).toBeNull();
    expect(htmlBodyWithSignature("Ahoj", { html: "", text: "" })).toBeNull();
  });

  it("přeposlaná starší zpráva se stejným podpisem: nahradí se jen můj (za oddělovačem)", () => {
    const body = `Přeposílám.\n\n-- \n${sig.text}\n\n---------- Přeposlaná zpráva ----------\nOd: Vít\n\nText\n\n${sig.text}`;
    const parts = locateSignature(body, sig.text)!;
    expect(parts.before).toBe("Přeposílám.\n\n");
    expect(parts.after).toContain("Přeposlaná zpráva");
    expect(parts.after).toContain(sig.text);
  });

  it("dokument (podpis na konci bez oddělovače) a Windows konce řádků", () => {
    const body = `Dobrý den,\r\nv příloze faktura.\r\n\r\n${sig.text.replace(/\n/g, "\r\n")}`;
    const html = htmlBodyWithSignature(body, sig)!;
    expect(html).toContain("v příloze faktura.");
    expect(html).toContain(sig.html);
  });
});

describe("stripClosing (před připojením podpisu — žádný druhý pozdrav)", () => {
  it("pozdrav z AI / staré šablony pryč i s firmou pod ním", () => {
    expect(stripClosing("Dobrý den,\n\nděkujeme za poptávku.\n\nS pozdravem,\nMNástrojárna s.r.o.")).toBe("Dobrý den,\n\nděkujeme za poptávku.");
    expect(stripClosing("Dobrý den,\nx\n\nS pozdravem, Mnástrojárna s.r.o.\n\n")).toBe("Dobrý den,\nx");
    expect(stripClosing("Dobrý den,\nx\n\nS přátelským pozdravem\n\nJan Novák\nobchod\n+420 777 111 222\nwww.mnastrojarna.cz")).toBe("Dobrý den,\nx");
    expect(stripClosing("Text.\n\nDěkujeme a s pozdravem\nTým Mnástrojárna")).toBe("Text.");
    expect(stripClosing("Text.\r\n\r\nS úctou\r\nJan")).toBe("Text.");
  });
  it("bez pozdravu na konci se nic nemění; dlouhý text pod „pozdravem“ není podpis", () => {
    expect(stripClosing("Dobrý den,\n\nposíláme výkres.\nDíky")).toBe("Dobrý den,\n\nposíláme výkres.\nDíky");
    expect(stripClosing("Hezký den, posílám výkres H-100.\nPetr")).toBe("Hezký den, posílám výkres H-100.\nPetr");
    const long = "S pozdravem\n" + "Tohle je dlouhý řádek, který rozhodně není součástí podpisu, protože má přes osmdesát znaků textu.";
    expect(stripClosing(long)).toBe(long);
  });
});

describe("firemní údaje: název podle logomanuálu", () => {
  it("„MNástrojárna“ z výchozího nastavení → „Mnástrojárna s.r.o.“; jiný název beze změny", () => {
    expect(signatureCompanyFrom({ name: "MNástrojárna s.r.o.", address: {} }).name).toBe("Mnástrojárna s.r.o.");
    expect(signatureCompanyFrom({ name: "Jiná firma s.r.o.", address: {} }).name).toBe("Jiná firma s.r.o.");
  });
});

describe("plainTextToHtml", () => {
  it("escapuje, odkazy jen http(s) a e-maily, mezery na začátku řádku", () => {
    const h = plainTextToHtml("<script>x</script>\n  odsazeno https://www.mnastrojarna.cz/a?b=1&c=2. javascript:alert(1) a@b.cz");
    expect(h).toContain("&lt;script&gt;x&lt;/script&gt;<br>");
    expect(h).toContain("&nbsp;&nbsp;odsazeno");
    expect(h).toContain('<a href="https://www.mnastrojarna.cz/a?b=1&amp;c=2"');
    expect(h).toContain("2</a>."); // tečka za odkazem do něj nepatří
    expect(h).not.toContain('href="javascript');
    expect(h).toContain('<a href="mailto:a@b.cz"');
  });
  it("vnořené citace se uzavřou", () => {
    const h = plainTextToHtml("> a\n> > b\nc");
    expect(h).toBe(
      '<blockquote style="margin:4px 0 4px 2px;padding:0 0 0 10px;border-left:2px solid #D9D4D4;color:#6C6D6F;">a<br>'
      + '<blockquote style="margin:4px 0 4px 2px;padding:0 0 0 10px;border-left:2px solid #D9D4D4;color:#6C6D6F;">b<br></blockquote></blockquote>c',
    );
  });
});
