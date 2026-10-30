import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const settings: Record<string, string | undefined> = {};
vi.mock("@/lib/settings", () => ({ getSetting: vi.fn(async (k: string) => settings[k]) }));
vi.mock("@/lib/company-server", () => ({ refreshCompanyFromSettings: vi.fn(async () => undefined) }));
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("testy předávají db");
  }),
}));

import {
  appendSignatureText, applySignature, loadSignatureCompany, outgoingSignature, resolveSignature, saveSignature, signatureLogoAttachment,
  signatureMailboxes, signedHtml,
} from "./signature-server";
import { SIGNATURE_LOGO_CID, defaultSignatureFor, putStoredSignature, signatureCompanyFrom } from "./signature";
import { SIGNATURE_LOGO_PNG_BASE64 } from "./signature-logo-data";

type Row = Record<string, unknown>;

/** Minimální Supabase: profiles (volitelně bez sloupce mail_signatures) a mailboxes. */
function fakeDb(init: { profile: Row; mailboxes?: Row[]; noColumn?: boolean }) {
  const profile: Row = { ...init.profile };
  const updates: Row[] = [];
  const db = {
    from(table: string) {
      let cols = "";
      const q = {
        select(c: string) {
          cols = c;
          return q;
        },
        eq() {
          return q;
        },
        order() {
          return Promise.resolve({ data: init.mailboxes ?? [], error: null });
        },
        async maybeSingle() {
          if (table !== "profiles") return { data: null, error: null };
          if (init.noColumn && cols.includes("mail_signatures")) {
            return { data: null, error: { code: "42703", message: "column profiles.mail_signatures does not exist" } };
          }
          const out: Row = {};
          for (const c of cols.split(",").map((s) => s.trim())) out[c] = profile[c] ?? null;
          return { data: out, error: null };
        },
        update(patch: Row) {
          return {
            async eq() {
              if (init.noColumn && "mail_signatures" in patch) return { error: { code: "PGRST204", message: "mail_signatures" } };
              updates.push(patch);
              Object.assign(profile, patch);
              return { error: null };
            },
          };
        },
      };
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient, profile, updates };
}

const PROFILE = { full_name: "Vít Volný", email: "vit@mnastrojarna.cz", phone: "734846246", position: "obchod", mail_signature: null };

beforeEach(() => {
  for (const k of Object.keys(settings)) delete settings[k];
});

describe("firemní údaje podpisu", () => {
  it("výchozí korespondenční adresa a certifikace; z nastavení přepíše", async () => {
    const c = await loadSignatureCompany();
    expect(c.correspondenceAddress).toBe("Mezná 9, 393 01 Pelhřimov");
    expect(c.certifications).toEqual(["ISO 9001", "ISO 14001"]);
    settings.company_correspondence_address = "Jiná 5, 393 01 Pelhřimov";
    settings.company_certifications = "ISO 9001";
    const d = await loadSignatureCompany();
    expect(d.correspondenceAddress).toBe("Jiná 5, 393 01 Pelhřimov");
    expect(d.certifications).toEqual(["ISO 9001"]);
  });
});

describe("resolveSignature", () => {
  it("nic uloženo → výchozí z profilu a adresy schránky", async () => {
    const { db } = fakeDb({ profile: PROFILE });
    const r = await resolveSignature({ userId: "u1", mailboxEmail: "vit.volny@mnastrojarna.cz", db });
    expect(r.source).toBe("auto");
    expect(r.saved).toBeNull();
    expect(r.settings).toMatchObject({ fullName: "Vít Volný", role: "obchod", phone: "+420 734 846 246", email: "vit.volny@mnastrojarna.cz" });
  });

  it("starý textový podpis platí, dokud se neuloží grafický", async () => {
    const { db } = fakeDb({ profile: { ...PROFILE, mail_signature: "Vít\n734 846 246" } });
    const r = await resolveSignature({ userId: "u1", mailboxEmail: null, db });
    expect(r.source).toBe("legacy");
    expect(r.legacyText).toBe("Vít\n734 846 246");
  });

  it("uložený podpis schránky má přednost; jiná schránka → společný", async () => {
    const company = await loadSignatureCompany();
    const base = defaultSignatureFor({ fullName: "Vít Volný" }, "a@b.cz", company);
    let stored = putStoredSignature(null, "a@b.cz", { ...base, variant: "vizitka" });
    stored = putStoredSignature(stored, null, { ...base, variant: "kompaktni" });
    const { db } = fakeDb({ profile: { ...PROFILE, mail_signature: "starý", mail_signatures: stored } });
    expect((await resolveSignature({ userId: "u1", mailboxEmail: "A@B.cz", db })).settings.variant).toBe("vizitka");
    const other = await resolveSignature({ userId: "u1", mailboxEmail: "jina@b.cz", db });
    expect(other.source).toBe("default");
    expect(other.settings.variant).toBe("kompaktni");
  });

  it("bez migrace (chybí sloupec) nespadne", async () => {
    const { db } = fakeDb({ profile: { ...PROFILE, mail_signature: "starý" }, noColumn: true });
    const r = await resolveSignature({ userId: "u1", mailboxEmail: null, db });
    expect(r.source).toBe("legacy");
  });
});

describe("saveSignature", () => {
  it("uloží normalizovaný podpis pod adresu schránky; null = zpět výchozí", async () => {
    const { db, profile } = fakeDb({ profile: PROFILE });
    const res = await saveSignature({ userId: "u1", mailboxEmail: "Vit.Volny@mnastrojarna.cz", settings: { variant: "vizitka", fullName: "  Vít  ", hack: 1 }, db });
    expect(res.ok).toBe(true);
    const stored = profile.mail_signatures as { mailboxes: Record<string, Row> };
    expect(Object.keys(stored.mailboxes)).toEqual(["vit.volny@mnastrojarna.cz"]);
    expect(stored.mailboxes["vit.volny@mnastrojarna.cz"]).toMatchObject({ variant: "vizitka", fullName: "Vít", phone: "+420 734 846 246" });
    expect("hack" in stored.mailboxes["vit.volny@mnastrojarna.cz"]).toBe(false);
    const reset = await saveSignature({ userId: "u1", mailboxEmail: "vit.volny@mnastrojarna.cz", settings: null, db });
    expect(reset.ok).toBe(true);
    expect(profile.mail_signatures).toEqual({ v: 1 });
  });

  it("bez migrace srozumitelná chyba", async () => {
    const { db } = fakeDb({ profile: PROFILE, noColumn: true });
    const res = await saveSignature({ userId: "u1", mailboxEmail: null, settings: {}, db });
    expect(res).toEqual({ ok: false, error: expect.stringContaining("chybí migrace") });
  });
});

describe("odeslání", () => {
  it("výchozí podpis: grafický s logem cid", async () => {
    const { db } = fakeDb({ profile: PROFILE });
    const sig = await outgoingSignature({ userId: "u1", mailboxEmail: "vit.volny@mnastrojarna.cz", db });
    expect(sig.rendered?.html).toContain(`src="cid:${SIGNATURE_LOGO_CID}"`);
    expect(sig.text).toContain("Vít Volný");
    const out = signedHtml(`Dobrý den,\n\n-- \n${sig.text}\n`, sig)!;
    expect(out.html).toContain(sig.rendered!.html);
    expect(out.inline).toHaveLength(1);
    expect(out.inline[0]).toMatchObject({ cid: SIGNATURE_LOGO_CID, contentType: "image/png", filename: "mnastrojarna-logo.png" });
    expect(out.inline[0].content.equals(Buffer.from(SIGNATURE_LOGO_PNG_BASE64, "base64"))).toBe(true);
    expect(signedHtml("Podpis smazán", sig)).toBeNull();
  });

  it("logo jako URL → žádná vložená příloha", async () => {
    vi.stubEnv("APP_URL", "https://app.mnastrojarna.cz");
    const { db } = fakeDb({ profile: PROFILE });
    const sig = await outgoingSignature({ userId: "u1", mailboxEmail: null, logo: "url", db });
    expect(sig.rendered?.html).toContain('src="https://app.mnastrojarna.cz/brand/mnastrojarna-email-logo@2x.png"');
    expect(signedHtml(`x\n\n-- \n${sig.text}`, sig)?.inline).toEqual([]);
    vi.unstubAllEnvs();
  });

  it("starý textový podpis → jen text; vypnutý → nic", async () => {
    const legacy = fakeDb({ profile: { ...PROFILE, mail_signature: "Vít" } });
    expect(await outgoingSignature({ userId: "u1", db: legacy.db })).toEqual({ text: "Vít", rendered: null });
    const company = signatureCompanyFrom({ name: "X", address: {} });
    const off = putStoredSignature(null, null, { ...defaultSignatureFor({ fullName: "Vít" }, null, company), enabled: false });
    const disabled = fakeDb({ profile: { ...PROFILE, mail_signature: "Vít", mail_signatures: off } });
    expect(await outgoingSignature({ userId: "u1", db: disabled.db })).toEqual({ text: "", rendered: null });
  });

  it("append (e-mail ve jménu uživatele): pozdrav z AI pryč, podpis jednou; je-li už v textu, nepřidá se znovu", async () => {
    const { db } = fakeDb({ profile: PROFILE });
    const sig = await outgoingSignature({ userId: "u1", mailboxEmail: "vit.volny@mnastrojarna.cz", db });
    const ai = "Dobrý den,\n\nděkujeme za poptávku, nabídku pošleme zítra.\n\nS pozdravem,\nMnástrojárna s.r.o.";
    const once = appendSignatureText(ai, sig.text);
    expect(once).toBe(`Dobrý den,\n\nděkujeme za poptávku, nabídku pošleme zítra.\n\n${sig.text}\n`);
    expect(appendSignatureText(once, sig.text)).toBe(once);
    const a = applySignature(ai, sig, "append");
    expect(a.text).toBe(once);
    expect(a.html!.split(`cid:${SIGNATURE_LOGO_CID}`)).toHaveLength(2); // logo právě jednou
    expect(a.html!.split('data-mn-signature="1"')).toHaveLength(2);
    expect(a.inline).toHaveLength(1);
    expect(a.html).not.toContain("Mnástrojárna s.r.o.</div>"); // původní textový pozdrav AI není v HTML
  });

  it("inline (okno psaní / dialog dokladu): převede jen podpis, který v textu je; smazaný = jen text; v odpovědi na citaci jen jednou", async () => {
    const { db } = fakeDb({ profile: PROFILE });
    const sig = await outgoingSignature({ userId: "u1", mailboxEmail: null, db });
    const quoted = sig.text.split("\n").map((l) => `> ${l}`).join("\n");
    const reply = `Díky.\n\n-- \n${sig.text}\n\nDne 1. 11. Vít Volný napsal(a):\n> Původní zpráva\n${quoted}\n`;
    const r = applySignature(reply, sig, "inline");
    expect(r.text).toBe(reply);
    expect(r.html!.split(`cid:${SIGNATURE_LOGO_CID}`)).toHaveLength(2);
    expect(r.html).toContain("blockquote"); // citace zůstala citací
    const gone = applySignature("Podpis jsem smazal.", sig, "inline");
    expect(gone).toEqual({ text: "Podpis jsem smazal.", html: null, inline: [] });
    // vypnutý / žádný podpis → beze změny
    expect(applySignature("x", { text: "", rendered: null }, "append")).toEqual({ text: "x", html: null, inline: [] });
    // starý textový podpis → připojí se jen text
    expect(applySignature("Text.", { text: "Vít\n734 846 246", rendered: null }, "append")).toEqual({ text: "Text.\n\nVít\n734 846 246\n", html: null, inline: [] });
  });

  it("logo příloha je PNG", () => {
    expect(signatureLogoAttachment().content.subarray(1, 4).toString()).toBe("PNG");
  });
});

describe("schránky pro podpis", () => {
  it("vlastní první, firemní označené, cizí osobní a vypnuté ne", async () => {
    const { db } = fakeDb({
      profile: PROFILE,
      mailboxes: [
        { email: "obchod@mnastrojarna.cz", owner_id: null, active: true },
        { email: "Vit.Volny@mnastrojarna.cz", owner_id: "u1", active: true },
        { email: "kolega@mnastrojarna.cz", owner_id: "u2", active: true },
        { email: "stara@mnastrojarna.cz", owner_id: "u1", active: false },
      ],
    });
    expect(await signatureMailboxes("u1", db)).toEqual([
      { key: "vit.volny@mnastrojarna.cz", label: "vit.volny@mnastrojarna.cz", own: true },
      { key: "obchod@mnastrojarna.cz", label: "obchod@mnastrojarna.cz · firemní", own: false },
    ]);
  });
});
