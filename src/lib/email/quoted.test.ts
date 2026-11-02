import { describe, it, expect } from "vitest";
import { splitQuoted } from "./quoted";

describe("citovaná historie v textu e-mailu", () => {
  it("Outlook: „-----Original Message-----“ / „Původní zpráva“", () => {
    const r = splitQuoted("Děkuji, beru.\r\n\r\n-----Original Message-----\r\nFrom: Jan\r\nSubject: Poptávka\r\n\r\nPoptávám 50 ks.");
    expect(r.main).toBe("Děkuji, beru.");
    expect(r.quoted.startsWith("-----Original Message-----")).toBe(true);
    expect(r.quotedLines).toBe(5);
    expect(splitQuoted("Ok\n\n---------- Původní zpráva ----------\nOd: X").main).toBe("Ok");
  });

  it("„Dne … napsal(a):“ i na dva řádky, „On … wrote:“, blok „>“", () => {
    expect(splitQuoted("Posílám výkres.\n\nDne 1. 11. 2026 v 10:00 Jan Novák <jan@x.cz> napsal(a):\n> Pošlete výkres").main).toBe("Posílám výkres.");
    expect(splitQuoted("Ano.\nOn Mon, Nov 2, 2026 at 9:00 AM Eva <eva@x.cz>\nwrote:\n> text").main).toBe("Ano.");
    expect(splitQuoted("Souhlas.\n\n> původní\n> zpráva\n").quoted).toBe("> původní\n> zpráva");
  });

  it("hlavička Outlooku Od: / Odesláno:", () => {
    const r = splitQuoted("Termín platí.\n\nOd: Eva Nová <eva@firma.test>\nOdesláno: pondělí 2. listopadu 2026 9:00\nKomu: my\nPředmět: Termín\n\nKdy dodáte?");
    expect(r.main).toBe("Termín platí.");
    expect(r.quoted).toMatch(/^Od: Eva/);
  });

  it("bez citace, nebo jen citace (přeposlání bez textu) → nic se nesbalí", () => {
    expect(splitQuoted("Dobrý den,\nposílám poptávku.\nS pozdravem")).toEqual({ main: "Dobrý den,\nposílám poptávku.\nS pozdravem", quoted: "", quotedLines: 0 });
    expect(splitQuoted("-----Original Message-----\nFrom: Jan\nText").quoted).toBe("");
    expect(splitQuoted("> jen citace").quoted).toBe("");
    // „>“ uprostřed textu (ne do konce) není citace historie
    expect(splitQuoted("a\n> b\nc").quoted).toBe("");
    expect(splitQuoted("").main).toBe("");
  });
});
