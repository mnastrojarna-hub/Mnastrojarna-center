import { describe, expect, it } from "vitest";
import {
  DEFAULT_TONE, applySalutation, combineTones, parseName, salutationFor, startsWithGreeting, suggestToneFromTexts,
  toneFromRow, toneInstruction, vocativeMale, vocativeFemaleFirst, ownPart,
} from "./tone";

describe("5. pád (vokativ)", () => {
  it.each([
    ["Pavel", "Pavle"], ["Karel", "Karle"], ["Jan", "Jane"], ["Petr", "Petře"], ["Tomáš", "Tomáši"], ["Ondřej", "Ondřeji"],
    ["Marek", "Marku"], ["Zdeněk", "Zdeňku"], ["Radek", "Radku"], ["Jiří", "Jiří"], ["Daniel", "Danieli"], ["Michal", "Michale"],
    ["Honza", "Honzo"], ["Oldřich", "Oldřichu"], ["Dominik", "Dominiku"], ["Igor", "Igore"], ["Alexandr", "Alexandře"],
    ["Novák", "Nováku"], ["Dvořák", "Dvořáku"], ["Svoboda", "Svobodo"], ["Novotný", "Novotný"], ["Šponer", "Šponere"],
    ["Volný", "Volný"], ["Jelínek", "Jelínku"], ["Vaněk", "Vaňku"], ["Beneš", "Beneši"], ["Kolář", "Koláři"], ["Němec", "Němče"],
    ["Klaus", "Klausi"], ["Havel", "Havle"], ["Procházka", "Procházko"],
  ])("%s → %s", (a, b) => expect(vocativeMale(a)).toBe(b));

  it("ženská jména", () => {
    expect(vocativeFemaleFirst("Jana")).toBe("Jano");
    expect(vocativeFemaleFirst("Lucie")).toBe("Lucie");
    expect(vocativeFemaleFirst("Dagmar")).toBe("Dagmar");
  });
});

describe("parseName", () => {
  it("tituly, pořadí, rod", () => {
    expect(parseName("Ing. Pavel Novák, Ph.D.")).toEqual({ first: "Pavel", last: "Novák", gender: "m" });
    expect(parseName("Jana Nováková")).toEqual({ first: "Jana", last: "Nováková", gender: "f" });
    expect(parseName("Novák Pavel")).toEqual({ first: "Pavel", last: "Novák", gender: "m" });
    expect(parseName("Novák, Pavel")).toEqual({ first: "Pavel", last: "Novák", gender: "m" });
    expect(parseName("NOVÁK")).toEqual({ first: null, last: "Novák", gender: "m" });
    expect(parseName("Pavel")).toEqual({ first: "Pavel", last: null, gender: "m" });
    expect(parseName("Nikola Nováková").gender).toBe("f");
    expect(parseName("Pavel Skála").gender).toBe("m");
    expect(parseName("p.novak@bosch.cz")).toEqual({ first: null, last: null, gender: "?" });
    expect(parseName("Petr Obchodník | MNástrojárna s.r.o.").first).toBe("Petr");
  });
});

describe("oslovení", () => {
  it("výchozí = vykání formálně se jménem v 5. pádě", () => {
    expect(salutationFor(DEFAULT_TONE, "Pavel Novák")).toBe("Dobrý den, pane Nováku,");
    expect(salutationFor(DEFAULT_TONE, "Ing. Jana Nováková")).toBe("Dobrý den, paní Nováková,");
    expect(salutationFor(DEFAULT_TONE, "Tomáš Šponer")).toBe("Dobrý den, pane Šponere,");
    expect(salutationFor(DEFAULT_TONE, null)).toBe("Dobrý den,");
    expect(salutationFor(DEFAULT_TONE, "info@firma.cz")).toBe("Dobrý den,");
  });
  it("tykání a vlastní oslovení", () => {
    const ty = { address: "ty" as const, tone: "pratelsky" as const, salutation: null };
    expect(salutationFor(ty, "Pavel Novák")).toBe("Ahoj Pavle,");
    expect(salutationFor(ty, "Jana Nováková")).toBe("Ahoj Jano,");
    expect(salutationFor(ty, null)).toBe("Ahoj,");
    expect(salutationFor({ ...ty, tone: "formalni" }, "Pavel Novák")).toBe("Dobrý den, Pavle,");
    expect(salutationFor({ ...ty, salutation: "Čau Pavle" }, "Pavel Novák")).toBe("Čau Pavle,");
    expect(salutationFor({ address: "vy", tone: "neutralni", salutation: null }, "Pavel Novák")).toBe("Dobrý den,");
  });
  it("pokyn pro AI obsahuje tykání a přesný první řádek", () => {
    const t = toneInstruction({ address: "ty", tone: "pratelsky", salutation: null, source: "manual" }, "Pavel Novák");
    expect(t).toContain("TYKÁŠ");
    expect(t).toContain("„Ahoj Pavle,“");
    expect(toneInstruction(DEFAULT_TONE, "Pavel Novák")).toContain("„Dobrý den, pane Nováku,“");
  });
  it("applySalutation nahradí pozdrav nebo ho doplní", () => {
    expect(applySalutation("Dobrý den,\n\nděkujeme.", "Ahoj Pavle,")).toBe("Ahoj Pavle,\n\nděkujeme.");
    expect(applySalutation("děkujeme za zprávu.", "Dobrý den, pane Nováku,")).toBe("Dobrý den, pane Nováku,\n\nděkujeme za zprávu.");
    expect(startsWithGreeting("Ahoj Pavle,\ntext")).toBe(true);
    expect(startsWithGreeting("posíláme")).toBe(false);
  });
  it("řádek DB a kombinace adresátů", () => {
    expect(toneFromRow({ address: "ty", tone: "pratelsky", salutation: " Ahoj Pavle, " })).toEqual({ address: "ty", tone: "pratelsky", salutation: "Ahoj Pavle", source: "manual" });
    expect(toneFromRow({ address: "x", tone: null })).toMatchObject({ address: "vy", tone: "formalni" });
    const ty = { address: "ty" as const, tone: "pratelsky" as const, salutation: null, source: "manual" as const };
    expect(combineTones([ty, ty]).mixed).toBe(false);
    const mixed = combineTones([ty, DEFAULT_TONE]);
    expect(mixed.mixed).toBe(true);
    expect(mixed.setting.address).toBe("vy");
  });
});

describe("návrh tykání z odeslané pošty", () => {
  it("Ahoj / tě → tykání s oslovením", () => {
    const s = suggestToneFromTexts(["Ahoj Pavle,\nposílám ti výkres, dej vědět.\n\n> Dobrý den, pane..."]);
    expect(s).toMatchObject({ address: "ty", salutation: "Ahoj Pavle", evidence: 1 });
  });
  it("vykání nebo nic → bez návrhu", () => {
    expect(suggestToneFromTexts(["Dobrý den,\nposíláme Vám nabídku."])).toBeNull();
    expect(suggestToneFromTexts([])).toBeNull();
    expect(suggestToneFromTexts(["Ahoj, posílám", "Dobrý den, Vám", "Dobrý den, Vás"])).toBeNull();
  });
  it("citace se nepočítá", () => {
    expect(ownPart("Dobrý den,\nděkujeme.\n\nDne 1. 1. Pavel napsal:\n> Ahoj, máš to?")).not.toContain("Ahoj");
  });
});
