import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { SignatureEditor, signaturePreviewDocument, type SignatureEditorProps } from "./signature-editor";
import { SIGNATURE_LOGO_PATH, defaultSignatureFor, renderSignature, signatureCompanyFrom } from "@/lib/email/signature";

const company = signatureCompanyFrom({
  name: "Mnástrojárna s.r.o.", slogan: "místo pro Vaši kooperaci…", address: { street: "Varšavská 715/36", zip: "120 00", city: "Praha 2" },
  ico: "04304080", dic: "CZ04304080", web: "www.mnastrojarna.cz",
});
const defaults = defaultSignatureFor({ fullName: "Vít Volný", phone: "734 846 246" }, "vit.volny@mnastrojarna.cz", company);

const html = (p: Partial<SignatureEditorProps> = {}) =>
  renderToString(<SignatureEditor value={defaults} onChange={vi.fn()} defaults={defaults} company={company} {...p} />).replace(/<!-- -->/g, "");

/** Atributy elementu s daným data-testid (první výskyt). */
const tagOf = (h: string, testId: string) => new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`).exec(h)?.[0] ?? "";

describe("editor podpisu — první obrazovka", () => {
  it("varianty jako přepínač, vybraná označená", () => {
    const h = html({ value: { ...defaults, variant: "vizitka" } });
    expect(h).toContain('data-testid="signature-variants"');
    for (const label of ["Kompaktní", "Firemní", "Vizitka"]) expect(h).toContain(label);
    expect(h).toMatch(/role="radio" aria-checked="true"[^>]*data-variant="vizitka"/);
    expect(h).toMatch(/role="radio" aria-checked="false"[^>]*data-variant="firemni"/);
    expect(h).toContain("Logo vlevo, kontakty vpravo");
  });

  it("živý náhled v izolovaném iframe (bez skriptů) s logem z webu aplikace", () => {
    const h = html();
    const iframe = /<iframe[^>]*>/.exec(h)?.[0] ?? "";
    expect(iframe).toContain('sandbox="allow-same-origin"');
    expect(iframe).toContain('title="Náhled podpisu"');
    expect(iframe).toContain("Vít Volný");
    expect(iframe).toContain(SIGNATURE_LOGO_PATH);
    expect(iframe).toContain("IČO&amp;nbsp;04304080");
    expect(h).toMatch(/role="radio" aria-checked="true"[^>]*>[\s\S]*?Světlý/);
  });

  it("jméno, pozice, telefon — 16 px na mobilu", () => {
    const h = html();
    expect(h).toContain('value="Vít Volný"');
    expect(h).toContain('value="+420 734 846 246"');
    expect(h).toContain('type="tel"');
    expect((h.match(/text-base sm:h-9 sm:text-sm/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("4 přepínače; u Kompaktní jsou firemní údaje vypnuté s vysvětlením", () => {
    const full = html();
    expect(tagOf(full, "signature-toggles")).not.toBe("");
    expect((full.match(/role="switch"/g) ?? []).length).toBe(4); // Pokročilé je sbalené → jen 4 přepínače
    for (const label of ["Logo firmy", "Fakturační údaje", "Doručovací adresa", "Certifikace"]) expect(full).toContain(label);
    expect(full).toContain("Mezná 9, 393 01 Pelhřimov");
    expect(full).not.toMatch(/role="switch"[^>]*\sdisabled=""/);
    const compact = html({ value: { ...defaults, variant: "kompaktni" } });
    expect((compact.match(/role="switch"[^>]*\sdisabled=""/g) ?? []).length).toBe(3);
    expect(compact).toContain("Kompaktní je bez nich");
  });

  it("Pokročilé je sbalené", () => {
    const h = html();
    expect(tagOf(h, "signature-advanced-toggle")).toContain('aria-expanded="false"');
    expect(h).not.toContain('data-testid="signature-advanced"');
    expect(h).toContain("pozdrav, e-mail, web, odkazy, poznámka");
  });
});

describe("editor podpisu — schránky, uložení, výchozí", () => {
  it("přepínač schránek jen při dvou a více", () => {
    expect(html({ mailboxes: [{ key: "vit.volny@mnastrojarna.cz", label: "vit.volny@mnastrojarna.cz" }] })).not.toContain('data-testid="signature-mailboxes"');
    const h = html({
      mailboxes: [{ key: "vit.volny@mnastrojarna.cz", label: "vit.volny@mnastrojarna.cz" }, { key: "obchod@mnastrojarna.cz", label: "obchod@mnastrojarna.cz · firemní" }],
      mailboxKey: "obchod@mnastrojarna.cz",
    });
    expect(h).toContain('data-testid="signature-mailboxes"');
    expect(h).toMatch(/aria-checked="true"[^>]*>obchod@mnastrojarna\.cz · firemní/);
    expect(h).toMatch(/aria-checked="false"[^>]*>vit\.volny@mnastrojarna\.cz</);
  });

  it("Uložit jen s onSave; bez změn vypnuté, se změnou „Neuložené změny“", () => {
    expect(html()).not.toContain('data-testid="signature-save"');
    const same = html({ onSave: vi.fn(), savedValue: defaults });
    expect(tagOf(same, "signature-save")).toMatch(/\sdisabled=""/);
    expect(same).not.toContain("Neuložené změny");
    const changed = html({ onSave: vi.fn(), savedValue: { ...defaults, variant: "kompaktni" } });
    expect(tagOf(changed, "signature-save")).not.toMatch(/\sdisabled=""/);
    expect(changed).toContain("Neuložené změny");
    expect(changed).toContain("Obnovit výchozí");
  });

  it("nic uloženo: Uložit jde vždy (nahradí starý textový podpis), změny proti výchozímu", () => {
    const fresh = html({ onSave: vi.fn(), savedValue: null });
    expect(tagOf(fresh, "signature-save")).not.toMatch(/\sdisabled=""/);
    expect(fresh).toContain("Zatím výchozí podpis");
    const edited = html({ onSave: vi.fn(), savedValue: null, value: { ...defaults, role: "obchod" } });
    expect(edited).toContain("Neuložené změny");
  });

  it("vypnutý podpis: náhled to řekne", () => {
    expect(html({ value: { ...defaults, enabled: false } })).toContain("Podpis je vypnutý");
  });

  it("vstup se v náhledu escapuje (žádné HTML z jména)", () => {
    const h = html({ value: { ...defaults, fullName: "<img src=x onerror=alert(1)>" } });
    expect(h).not.toContain("<img src=x");
    expect(h).toContain("&amp;lt;img src=x");
  });

  it("vlastní logo (např. absolutní URL) i podpis bez loga", () => {
    expect(html({ logoSrc: "https://app.mnastrojarna.cz/brand/x.png" })).toContain("https://app.mnastrojarna.cz/brand/x.png");
    expect(/<iframe[^>]*>/.exec(html({ logoSrc: null }))?.[0]).not.toContain("&lt;img");
  });
});

describe("dokument náhledu", () => {
  const sig = renderSignature(defaults, { company, logoSrc: SIGNATURE_LOGO_PATH }).html;
  it("světlý: bílé pozadí, podpis, ukázkový začátek zprávy", () => {
    const d = signaturePreviewDocument(sig, "light");
    expect(d).toContain(sig);
    expect(d).toContain("děkujeme za poptávku");
    expect(d).not.toContain("invert(");
    expect(d).not.toMatch(/<script/i);
  });
  it("tmavý: simulace Outlook / Gmail — převrácené barvy, logo beze změny", () => {
    const d = signaturePreviewDocument(sig, "dark");
    expect(d).toContain(".mail{filter:invert(1) hue-rotate(180deg)");
    expect(d).toContain(".mail img{filter:invert(1) hue-rotate(180deg)}");
    expect(d).toContain("background:#1E1E1E");
  });
});
