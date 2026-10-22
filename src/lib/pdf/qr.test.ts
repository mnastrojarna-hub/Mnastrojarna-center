import { describe, it, expect } from "vitest";
import {
  buildSpdString, isValidIban, normalizeIban, qrMatrix, qrRuns, spdAmount, spdMessage, spdVariableSymbol,
} from "./qr";

// Veřejně publikovaný vzorový IBAN (Česká spořitelna, účet 19-2000145399/0800)
const IBAN = "CZ65 0800 0000 1920 0014 5399";

describe("QR Platba — SPD řetězec", () => {
  it("IBAN bez mezer + kontrolní součet", () => {
    expect(normalizeIban(IBAN)).toBe("CZ6508000000192000145399");
    expect(isValidIban(IBAN)).toBe(true);
    expect(isValidIban("CZ6608000000192000145399")).toBe(false); // špatný kontrolní součet
    expect(isValidIban("")).toBe(false);
    expect(isValidIban("123456789/0800")).toBe(false);
  });

  it("částka s tečkou a 2 desetinnými místy", () => {
    expect(spdAmount(129411.92)).toBe("129411.92");
    expect(spdAmount(1500)).toBe("1500.00");
    expect(spdAmount(0.1 + 0.2)).toBe("0.30");
    expect(spdAmount(0)).toBeUndefined();
    expect(spdAmount(-5)).toBeUndefined();
    expect(spdAmount(Number.NaN)).toBeUndefined();
    expect(spdAmount(12_345_678_901)).toBeUndefined(); // přes 10 znaků
  });

  it("VS jen číslice, max 10", () => {
    expect(spdVariableSymbol("FV-2026-0158")).toBe("20260158");
    expect(spdVariableSymbol("2026/000012345")).toBe("6000012345");
    expect(spdVariableSymbol("ABC")).toBeUndefined();
    expect(spdVariableSymbol(undefined)).toBeUndefined();
  });

  it("zpráva bez diakritiky a hvězdiček, max 60 znaků", () => {
    expect(spdMessage("Faktura č. 2026*01 — díly")).toBe("Faktura c. 2026 01 dily");
    const long = spdMessage("Ř".repeat(80))!;
    expect(long).toBe("R".repeat(60));
    expect(spdMessage("  \n  ")).toBeUndefined();
    expect(spdMessage("a".repeat(59) + " b")!.length).toBeLessThanOrEqual(60);
  });

  it("kompletní řetězec v pořadí ACC, AM, CC, X-VS, DT, MSG", () => {
    const spd = buildSpdString({
      iban: IBAN,
      bic: "gibaczpx",
      amount: 129411.92,
      variableSymbol: "FV-2026-0158",
      dueDate: "2026-11-05",
      message: "Faktura FV-2026-0158",
    });
    expect(spd).toBe(
      "SPD*1.0*ACC:CZ6508000000192000145399+GIBACZPX*AM:129411.92*CC:CZK*X-VS:20260158*DT:20261105*MSG:Faktura FV-2026-0158",
    );
  });

  it("bez platného IBANu žádný QR; neplatný BIC se vynechá", () => {
    expect(buildSpdString({ iban: "", amount: 100 })).toBeNull();
    expect(buildSpdString({ iban: "CZ00 1234", amount: 100 })).toBeNull();
    expect(buildSpdString({ iban: IBAN, bic: "XX", amount: 100 })).toBe("SPD*1.0*ACC:CZ6508000000192000145399*AM:100.00*CC:CZK");
  });
});

describe("QR matice", () => {
  it("vykreslí matici s orientačními čtverci a sloučenými běhy", () => {
    const text = buildSpdString({ iban: IBAN, amount: 1500, variableSymbol: "123", dueDate: "2026-11-05" })!;
    const m = qrMatrix(text);
    expect(m.size).toBeGreaterThanOrEqual(21);
    expect((m.size - 17) % 4).toBe(0); // velikost verze QR = 17 + 4·v
    // levý horní orientační čtverec: tmavý okraj 7×7, světlý prstenec, tmavý střed
    expect(m.modules[0].slice(0, 7).every(Boolean)).toBe(true);
    expect(m.modules[1][1]).toBe(false);
    expect(m.modules[3][3]).toBe(true);
    expect(m.modules[7][7]).toBe(false);

    const runs = qrRuns(m);
    const dark = m.modules.flat().filter(Boolean).length;
    expect(runs.reduce((s, r) => s + r.w, 0)).toBe(dark);
    expect(runs.length).toBeLessThan(dark);
    for (const r of runs) {
      expect(r.x + r.w).toBeLessThanOrEqual(m.size);
      expect(m.modules[r.y].slice(r.x, r.x + r.w).every(Boolean)).toBe(true);
    }
  });
});
