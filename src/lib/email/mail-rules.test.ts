import { describe, it, expect } from "vitest";
import { ruleCategorize } from "./mail-rules";

describe("třídění pošty bez AI (pravidla)", () => {
  it("kategorie podle předmětu (bez diakritiky, cs/en/de)", () => {
    expect(ruleCategorize({ subject: "Poptávka hřídele 50 ks" }).category).toBe("poptavka");
    expect(ruleCategorize({ subject: "RFQ shafts" }).category).toBe("poptavka");
    expect(ruleCategorize({ subject: "Objednávka 4500123" }).category).toBe("objednavka");
    expect(ruleCategorize({ subject: "Order PO-4500021877" }).category).toBe("objednavka");
    expect(ruleCategorize({ subject: "Potvrzení objednávky č. 12" }).category).toBe("potvrzeni_objednavky");
    expect(ruleCategorize({ subject: "Faktura 2026001" }).category).toBe("faktura");
    expect(ruleCategorize({ subject: "Upomínka – faktura po splatnosti" }).category).toBe("upominka");
    expect(ruleCategorize({ subject: "Reklamace dílů" }).category).toBe("reklamace");
    expect(ruleCategorize({ subject: "Nabídka materiálu" }).category).toBe("nabidka_dodavatele");
    expect(ruleCategorize({ subject: "Výkres rev. B" }).category).toBe("technicka_dokumentace");
    expect(ruleCategorize({ subject: "Dotaz" }).category).toBe("ostatni");
  });
  it("text e-mailu, když předmět nic neřekne", () => {
    expect(ruleCategorize({ subject: "Dobrý den", body: "prosím o cenovou nabídku na 20 ks" }).category).toBe("poptavka");
  });
  it("spam (hlavička serveru nebo typická slova) a hromadné zprávy", () => {
    expect(ruleCategorize({ subject: "Ahoj", headers: { "x-spam-flag": "YES" } })).toMatchObject({ category: "spam", isSpam: true });
    expect(ruleCategorize({ subject: "You have WON the lottery" }).isSpam).toBe(true);
    const news = ruleCategorize({ subject: "Novinky: nabídka měsíce", headers: { "list-unsubscribe": "<mailto:x>" } });
    expect(news).toMatchObject({ category: "ostatni", isSpam: false, priority: "nizka", bulk: true });
  });
  it("priorita: urgentní / reklamace / upomínka = vysoká", () => {
    expect(ruleCategorize({ subject: "URGENTNÍ: stojí linka" }).priority).toBe("vysoka");
    expect(ruleCategorize({ subject: "Reklamace" }).priority).toBe("vysoka");
    expect(ruleCategorize({ subject: "Objednávka", body: "potřebujeme ASAP" }).priority).toBe("vysoka");
    expect(ruleCategorize({ subject: "Poptávka" }).priority).toBe("stredni");
  });
});
