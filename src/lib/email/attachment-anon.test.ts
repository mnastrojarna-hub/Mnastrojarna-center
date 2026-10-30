import { describe, it, expect } from "vitest";
import { blockedAttachmentMessage, recipientsAllowOriginals } from "./attachment-anon";

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
});
