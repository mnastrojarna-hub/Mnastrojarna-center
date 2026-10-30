import { describe, it, expect } from "vitest";
import { ADHOC_ANON_EXT_RE, adhocAnonPrefix, blockedAttachmentMessage, isInlineImage, recipientsAllowOriginals } from "./attachment-anon";

describe("výkres zákazníka v příloze e-mailu — komu smí originál", () => {
  const aud = {
    customerEmails: ["nakup@brisk.cz", "jan.novak@gmail.com"],
    internalEmails: ["vit.volny@mnastrojarna.cz"],
    internalDomains: ["mnastrojarna.cz", "gmail.com"],
  };
  it("zákazník zakázky (adresa i jeho doména) a kolegové → originál", () => {
    expect(recipientsAllowOriginals(["nakup@brisk.cz"], aud)).toBe(true);
    expect(recipientsAllowOriginals(["Technik@BRISK.cz", "vit.volny@mnastrojarna.cz"], aud)).toBe(true);
    expect(recipientsAllowOriginals(["kolega@mnastrojarna.cz"], aud)).toBe(true);
    expect(recipientsAllowOriginals(["jan.novak@gmail.com"], aud)).toBe(true);
  });
  it("dodavatel / kdokoli jiný (i jen jeden z adresátů, i v kopii) → jen anonymizovaná kopie", () => {
    expect(recipientsAllowOriginals(["kalirna@dodavatel.cz"], aud)).toBe(false);
    expect(recipientsAllowOriginals(["nakup@brisk.cz", "kalirna@dodavatel.cz"], aud)).toBe(false);
    // veřejná doména zákazníka (gmail) neotevře originál cizím adresám na gmailu
    expect(recipientsAllowOriginals(["jiny@gmail.com"], aud)).toBe(false);
    expect(recipientsAllowOriginals([], aud)).toBe(false);
  });
  it("hláška říká, co udělat", () => {
    expect(blockedAttachmentMessage("V-1.pdf", "pending")).toContain("Výkres ještě není anonymizovaný");
    expect(blockedAttachmentMessage("V-1.pdf", "review")).toContain("schval");
    expect(blockedAttachmentMessage("V-1.dwg", "unsupported", "DWG")).toContain("ulož výkres jako PDF");
  });
  it("přeposlání e-mailu: rada míří na přílohu z počítače / Moje anonymizace, ne na zakázku", () => {
    expect(blockedAttachmentMessage("V-1.dwg", "unsupported", undefined, "mail")).toContain("přilož ho z počítače");
    expect(blockedAttachmentMessage("V-1.pdf", "review", undefined, "mail")).toContain("Moje anonymizace");
    expect(blockedAttachmentMessage("V-1.pdf", "pending", undefined, "mail")).toBe(blockedAttachmentMessage("V-1.pdf", "pending"));
  });
  it("anonymizace na požádání: podporované přípony, prefix kopie uživatele, drobné vložené obrázky", () => {
    for (const f of ["a.pdf", "b.JPG", "c.dxf", "d.step", "e.stl", "f.iges", "g.heic"]) expect(ADHOC_ANON_EXT_RE.test(f)).toBe(true);
    for (const f of ["a.dwg", "b.zip", "c.eml", "d.docx"]) expect(ADHOC_ANON_EXT_RE.test(f)).toBe(false);
    expect(adhocAnonPrefix("u1")).toBe("capture/u1/anon/out/");
    expect(isInlineImage("image/png", 2_000)).toBe(true);
    expect(isInlineImage("image/png", 200_000)).toBe(false);
    expect(isInlineImage("application/pdf", 2_000)).toBe(false);
    expect(isInlineImage("image/png", null)).toBe(false);
  });
});
