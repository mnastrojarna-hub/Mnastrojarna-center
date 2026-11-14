import { describe, expect, it } from "vitest";
import { draftDocumentEmail, type DocumentEmailInput } from "@/lib/jobs/document-emails";
import { acceptRedraft, isUntouchedDraft, planRecipientSwitch, recipientNote, swapDraftSignature, type DraftTracking } from "./draft-retarget";
import { salutationFor } from "./tone";

const base: DocumentEmailInput = {
  kind: "potvrzeni",
  jobNumber: "Z-2026-0101",
  jobTitle: "Hřídele",
  number: "PO-2026-0101",
  customerOrderNumber: "OBJ-77",
  currency: "CZK",
  filename: "Potvrzeni_PO-2026-0101.pdf",
  sender: { name: "Vít Volný", email: "vit@mnastrojarna.test" },
  company: { name: "Mnástrojárna s.r.o." },
  signatureText: "Vít Volný\nMnástrojárna s.r.o.",
};

/** Návrh, jak ho připraví server pro adresáta (jméno + tykání / vykání). */
function draftFor(name: string, address: "ty" | "vy"): string {
  const tone = { address, tone: address === "ty" ? "pratelsky" : "formalni", salutation: null } as const;
  return draftDocumentEmail({ ...base, address, salutation: salutationFor(tone, name) }).body;
}

describe("změna adresáta → tykání / oslovení / text", () => {
  const pavel = draftFor("Pavel Novák", "ty");
  const natalie = draftFor("Natálie Vojčíková", "vy");

  it("generátor: tykání a vykání se liší i v textu, ne jen v oslovení", () => {
    expect(pavel.startsWith("Ahoj Pavle,")).toBe(true);
    expect(natalie.startsWith("Dobrý den, paní Vojčíková,")).toBe(true);
    expect(pavel).toContain("ti posíláme");
    expect(natalie).toContain("Vám zasíláme");
  });

  it("stejný adresát jako návrh (první načtení tónu) = nic", () => {
    expect(planRecipientSwitch({
      body: pavel, draftBody: pavel, draftTo: "Novak@Bosch.test", email: "novak@bosch.test", name: "Pavel Novák",
      salutation: "Ahoj Pavle,", address: "ty", canRegenerate: true,
    })).toEqual({ kind: "same" });
  });

  it("neupravený návrh → hned nové oslovení a celý text znovu (redraft)", () => {
    const plan = planRecipientSwitch({
      body: pavel, draftBody: pavel, draftTo: "novak@bosch.test", email: "vojcikova@bosch.test", name: "Natálie Vojčíková",
      salutation: "Dobrý den, paní Vojčíková,", address: "vy", canRegenerate: true,
    });
    expect(plan.kind).toBe("regenerate");
    if (plan.kind !== "regenerate") return;
    expect(plan.body.startsWith("Dobrý den, paní Vojčíková,\n\n")).toBe(true);
    // přijetí nového textu ze serveru: text je pořád „neupravený" (liší se jen oslovením)
    expect(acceptRedraft({ body: plan.body, draftBody: plan.body, mainTo: "vojcikova@bosch.test", email: "vojcikova@bosch.test", fresh: natalie })).toBe(natalie);
  });

  it("návrh lišící se jen oslovením (uživatel přepsal pozdrav) se pořád bere jako neupravený", () => {
    const greetingEdited = pavel.replace("Ahoj Pavle,", "Čau Pavle,");
    expect(isUntouchedDraft(greetingEdited, pavel)).toBe(true);
    expect(planRecipientSwitch({
      body: greetingEdited, draftBody: pavel, draftTo: "novak@bosch.test", email: "vojcikova@bosch.test", name: "Natálie Vojčíková",
      salutation: "Dobrý den, paní Vojčíková,", address: "vy", canRegenerate: true,
    }).kind).toBe("regenerate");
  });

  it("upravený text zůstane — vymění se jen oslovení a ukáže se poznámka", () => {
    const edited = pavel.replace("Vít Volný\nMnástrojárna", "Díky moc, přijedu ve čtvrtek.\n\nVít Volný\nMnástrojárna");
    expect(edited).not.toBe(pavel);
    const plan = planRecipientSwitch({
      body: edited, draftBody: pavel, draftTo: "novak@bosch.test", email: "vojcikova@bosch.test", name: "Natálie Vojčíková",
      salutation: "Dobrý den, paní Vojčíková,", address: "vy", canRegenerate: true,
    });
    expect(plan).toEqual({
      kind: "greeting",
      body: edited.replace("Ahoj Pavle,", "Dobrý den, paní Vojčíková,"),
      note: "Oslovení upraveno pro Natálie Vojčíková (vykání).",
    });
    // redraft po cestě nepřepíše uživatelův text — leda výslovně („Přegenerovat text")
    const greeting = plan.kind === "greeting" ? plan.body : "";
    expect(acceptRedraft({ body: greeting, draftBody: pavel, mainTo: "vojcikova@bosch.test", email: "vojcikova@bosch.test", fresh: natalie })).toBeNull();
    expect(acceptRedraft({ body: greeting, draftBody: pavel, mainTo: "vojcikova@bosch.test", email: "vojcikova@bosch.test", fresh: natalie, force: true })).toBe(natalie);
  });

  it("bez možnosti redraftu (nebo bez návrhu) jen oslovení + poznámka; neznámá adresa = e-mail v poznámce", () => {
    const plan = planRecipientSwitch({
      body: pavel, draftBody: pavel, draftTo: "novak@bosch.test", email: "nekdo@jinde.test", name: null,
      salutation: "Dobrý den,", address: "vy", canRegenerate: false,
    });
    expect(plan).toMatchObject({ kind: "greeting", note: "Oslovení upraveno pro nekdo@jinde.test (vykání)." });
    expect(plan.kind === "greeting" && plan.body.startsWith("Dobrý den,\n\n")).toBe(true);
    expect(planRecipientSwitch({
      body: "Ahoj,\n\nčus", draftBody: null, draftTo: "", email: "pavel@x.test", name: "Pavel Novák", salutation: "Ahoj Pavle,", address: "ty", canRegenerate: true,
    })).toMatchObject({ kind: "greeting", body: "Ahoj Pavle,\n\nčus", note: recipientNote("Pavel Novák", "ty") });
  });

  it("mezitím jiný adresát → redraft se zahodí", () => {
    expect(acceptRedraft({ body: pavel, draftBody: pavel, mainTo: "jiny@bosch.test", email: "vojcikova@bosch.test", fresh: natalie })).toBeNull();
  });

  it("výměna podpisu (Odeslat z) platí i pro uložený návrh a znovu připravený text", () => {
    const m = swapDraftSignature<{ body: string } & DraftTracking>({ body: pavel, draftBody: pavel }, "Vít Volný\nMnástrojárna s.r.o.", "Jan Šponer\nMnástrojárna s.r.o.");
    expect(m.body).toContain("Jan Šponer");
    expect(isUntouchedDraft(m.body, m.draftBody)).toBe(true);
    expect(m.sig).toEqual({ from: "Vít Volný\nMnástrojárna s.r.o.", to: "Jan Šponer\nMnástrojárna s.r.o." });
    const fresh = acceptRedraft({ body: m.body, draftBody: m.draftBody, mainTo: "vojcikova@bosch.test", email: "vojcikova@bosch.test", fresh: natalie, sig: m.sig });
    expect(fresh).toContain("Jan Šponer");
    expect(fresh).not.toContain("Vít Volný\nMnástrojárna");
    // přepnutí zpět na původní schránku → žádná výměna
    expect(swapDraftSignature(m, "Jan Šponer\nMnástrojárna s.r.o.", "Vít Volný\nMnástrojárna s.r.o.").sig).toBeNull();
  });
});
