import { describe, expect, it } from "vitest";
import {
  combineSignals, correctableKinds, decideStageAction, detectStageSignalRules, parseAiJobSignal, proposalTitle, stageFit,
  type StageJobFacts,
} from "./mail-stage-signal";

const kind = (t: string, subject?: string) => detectStageSignalRules(t, subject)?.kind ?? null;

describe("pošta → speciální stav: pravidla (CZ / DE / EN)", () => {
  it("reklamace — vada, rozměry, chybějící kusy, poškození", () => {
    expect(kind("Dobrý den, reklamujeme díly z dodávky DL-1234, nesedí rozměry dle výkresu.")).toBe("reklamace");
    expect(detectStageSignalRules("Průměr 20h7 je mimo toleranci u 12 kusů.")?.claimReason).toBe("rozmery");
    expect(detectStageSignalRules("V balíku chybí 5 ks, prosím o doplnění.")?.claimReason).toBe("mnozstvi");
    expect(detectStageSignalRules("Díly dorazily poškozené.")?.claimReason).toBe("poskozeni");
    expect(kind("Wir müssen die Lieferung beanstanden, die Teile sind fehlerhaft.")).toBe("reklamace");
    expect(detectStageSignalRules("Leider gibt es eine Maßabweichung am Bohrbild.")?.claimReason).toBe("rozmery");
    expect(kind("We have a quality complaint: 10 pcs are out of tolerance.")).toBe("reklamace");
    expect(detectStageSignalRules("Unfortunately 4 pcs are missing from the shipment.")?.claimReason).toBe("mnozstvi");
  });

  it("nerealizováno — jiný dodavatel, cena, projekt zrušen (důvod prohry)", () => {
    const a = detectStageSignalRules("Děkujeme za nabídku, bohužel jsme vybrali jiného dodavatele.");
    expect(a).toMatchObject({ kind: "nerealizovano", lostReason: "jiny_dodavatel" });
    expect(detectStageSignalRules("Cena je pro nás bohužel příliš vysoká.")?.lostReason).toBe("cena");
    expect(detectStageSignalRules("Projekt byl zrušen, nebudeme nic objednávat.")?.lostReason).toBe("projekt_zrusen");
    expect(detectStageSignalRules("Wir haben den Auftrag anderweitig vergeben.")?.lostReason).toBe("jiny_dodavatel");
    expect(detectStageSignalRules("Thank you, but we went with another supplier.")?.lostReason).toBe("jiny_dodavatel");
    expect(detectStageSignalRules("The price is too high for us.")?.lostReason).toBe("cena");
    expect(detectStageSignalRules("Rušíme poptávku, už ji nepotřebujeme.")).toMatchObject({ kind: "nerealizovano", lostReason: "zakaznik_stahl" });
  });

  it("zrušeno — storno objednávky", () => {
    expect(kind("Stornujeme objednávku č. PO-4471.")).toBe("zruseno");
    expect(kind("Prosím zrušte naši objednávku 4471, projekt se nerealizuje.")).toBe("zruseno");
    expect(kind("Wir müssen die Bestellung leider stornieren.")).toBe("zruseno");
    expect(kind("Please cancel our purchase order 4471.")).toBe("zruseno");
  });

  it("pozastaveno / pokračovat / reklamace vyřízena", () => {
    expect(kind("Pozastavte prosím výrobu, čekáme na novou revizi výkresu.")).toBe("pozastaveno");
    expect(kind("Please put the order on hold until further notice.")).toBe("pozastaveno");
    expect(kind("Bitte die Fertigung vorerst anhalten.")).toBe("pozastaveno");
    expect(detectStageSignalRules("Posuňte prosím dodání o 14 dní.")?.confidence).toBeLessThan(0.8);
    expect(kind("Můžete pokračovat ve výrobě, výkres je beze změny.")).toBe("pokracovat");
    expect(kind("Pozastavení je zrušeno, pokračujte.")).toBe("pokracovat");
    expect(kind("You can now proceed with the production.")).toBe("pokracovat");
    expect(kind("Reklamace je tímto vyřízená, náhradní díly sedí.")).toBe("reklamace_vyrizena");
    expect(kind("The complaint is closed, replacement parts are fine.")).toBe("reklamace_vyrizena");
  });

  it("popření, otázka a běžná pošta", () => {
    expect(kind("Nejde o reklamaci, jen dotaz k povrchu.")).toBeNull();
    expect(kind("Please do not cancel the order, we just need a new date.")).toBeNull();
    expect(kind("Prosím kalit a 30 ks místo 20.")).toBeNull();
    expect(kind("Děkujeme za nabídku, objednávku pošleme zítra.")).toBeNull();
    const q = detectStageSignalRules("Můžete pokračovat ve výrobě?");
    expect(q?.kind).toBe("pokracovat");
    expect(q!.confidence).toBeLessThan(0.8);
  });
});

describe("spojení AI + pravidla", () => {
  const rules = detectStageSignalRules("Reklamujeme 5 ks, nesedí rozměry dle výkresu.");
  it("shoda zvedne jistotu, jen AI 90 %, jen pravidla, AI „none“ oslabí, rozpor jen návrh", () => {
    expect(combineSignals({ kind: "reklamace", reason: "Zákazník reklamuje rozměry", confidence: 0.8 }, rules))
      .toMatchObject({ kind: "reklamace", source: "ai+rules", reason: "Zákazník reklamuje rozměry", claimReason: "rozmery" });
    expect(combineSignals({ kind: "reklamace", reason: "x", confidence: 0.8 }, rules)!.confidence).toBeCloseTo(0.95, 3);
    expect(combineSignals({ kind: "pozastaveno", reason: "Zákazník chce počkat", confidence: 0.9 }, null)).toMatchObject({ kind: "pozastaveno", source: "ai", confidence: 0.81 });
    expect(combineSignals(null, rules)).toBe(rules);
    expect(combineSignals({ kind: "none", reason: "", confidence: 0.9 }, rules)!.confidence).toBeLessThan(0.8);
    const conflict = combineSignals({ kind: "zruseno", reason: "storno", confidence: 0.9 }, rules)!;
    expect(conflict.kind).toBe("zruseno");
    expect(conflict.confidence).toBeLessThan(0.8);
    expect(combineSignals({ kind: "none", reason: "", confidence: 1 }, null)).toBeNull();
    expect(parseAiJobSignal({ kind: "bogus" })).toBeNull();
    expect(parseAiJobSignal({ kind: "reklamace", reason: " r ", confidence: 7 })).toEqual({ kind: "reklamace", reason: "r", confidence: 1 });
  });
});

describe("sedí na stav zakázky", () => {
  const f = (stage: StageJobFacts["stage"], x: Partial<StageJobFacts> = {}): StageJobFacts => ({ stage, ...x });
  it("nerealizováno jen před objednávkou (po ní → zrušeno), zrušeno jen po objednávce před dodáním", () => {
    expect(stageFit("nerealizovano", f("nabidka"))).toMatchObject({ ok: true, kind: "nerealizovano", to: "nerealizovano" });
    expect(stageFit("nerealizovano", f("potvrzeno"))).toMatchObject({ ok: true, kind: "zruseno", remapped: true, lostReason: "projekt_zrusen" });
    expect(stageFit("zruseno", f("ve_vyrobe"))).toMatchObject({ ok: true, kind: "zruseno" });
    expect(stageFit("zruseno", f("poptavka"))).toMatchObject({ ok: true, kind: "nerealizovano", remapped: true });
    expect(stageFit("zruseno", f("dodano_zakaznikovi")).ok).toBe(false);
    expect(stageFit("zruseno", f("pozastaveno", { sideFromStage: "ve_vyrobe" }))).toMatchObject({ ok: true, kind: "zruseno" });
    expect(stageFit("nerealizovano", f("pozastaveno", { sideFromStage: "nabidka" }))).toMatchObject({ ok: true, kind: "nerealizovano" });
  });
  it("reklamace ve výrobě a po dodání; fakturovaná jen návrh; otevřená reklamace ne", () => {
    expect(stageFit("reklamace", f("nabidka")).ok).toBe(false);
    expect(stageFit("reklamace", f("ve_vyrobe")).ok).toBe(true);
    expect(stageFit("reklamace", f("dodano_zakaznikovi"))).toMatchObject({ ok: true, to: "reklamace" });
    expect(stageFit("reklamace", f("fakturovano"))).toMatchObject({ ok: true, closed: true });
    expect(stageFit("reklamace", f("potvrzeno", { itemsCount: 2, itemsDelivered: 2 })).ok).toBe(true);
    expect(stageFit("reklamace", f("reklamace")).ok).toBe(false);
    expect(stageFit("reklamace", f("ve_vyrobe", { claimOpenedAt: "2026-11-01" })).ok).toBe(false);
  });
  it("pozastavit / pokračovat / vyřízení; uzavřené nic", () => {
    expect(stageFit("pozastaveno", f("ve_vyrobe")).ok).toBe(true);
    expect(stageFit("pozastaveno", f("pozastaveno")).ok).toBe(false);
    expect(stageFit("pozastaveno", f("dodano_zakaznikovi")).ok).toBe(false);
    expect(stageFit("pokracovat", f("ve_vyrobe")).ok).toBe(false);
    expect(stageFit("pokracovat", f("pozastaveno", { sideFromStage: "ve_vyrobe" }))).toMatchObject({ ok: true, to: "ve_vyrobe" });
    expect(stageFit("reklamace_vyrizena", f("reklamace", { claimOpenedAt: "x", claimFromStage: "dodano_zakaznikovi" }))).toMatchObject({ ok: true, to: "dodano_zakaznikovi" });
    expect(stageFit("reklamace_vyrizena", f("dodano_zakaznikovi")).ok).toBe(false);
    for (const k of ["reklamace", "pozastaveno", "pokracovat", "zruseno", "nerealizovano"] as const) {
      expect(stageFit(k, f("zruseno")).ok).toBe(false);
      expect(stageFit(k, f("nerealizovano")).ok).toBe(false);
      expect(stageFit(k, f("ve_vyrobe", { mergedIntoId: "x" })).ok).toBe(false);
    }
    expect(correctableKinds(f("ve_vyrobe"))).toEqual(["reklamace", "zruseno", "pozastaveno"]);
    expect(correctableKinds(f("nabidka"), "reklamace")).toEqual(["reklamace", "nerealizovano", "pozastaveno"]);
  });
});

describe("rozhodnutí", () => {
  it("auto jen full + zákazník + jistota ≥ 0,8 + bez pochybností; dodavatel nikdy", () => {
    expect(decideStageAction({ confidence: 0.9, party: "customer", mode: "full" })).toBe("auto");
    expect(decideStageAction({ confidence: 0.9, party: "customer", mode: "approval" })).toBe("approval");
    expect(decideStageAction({ confidence: 0.7, party: "customer", mode: "full" })).toBe("approval");
    expect(decideStageAction({ confidence: 0.9, party: "other", mode: "full" })).toBe("approval");
    expect(decideStageAction({ confidence: 0.9, party: "customer", mode: "full", hold: true })).toBe("approval");
    expect(decideStageAction({ confidence: 0.9, party: "customer", mode: "full", closed: true })).toBe("approval");
    expect(decideStageAction({ confidence: 0.4, party: "customer", mode: "full" })).toBe("ignore");
    expect(decideStageAction({ confidence: 0.99, party: "supplier", mode: "full" })).toBe("ignore");
    expect(proposalTitle("reklamace", "Jan Novák", "Z-2026-014")).toBe("E-mail od Jan Novák naznačuje reklamaci zakázky Z-2026-014 — přepnout do Reklamace?");
  });
});
