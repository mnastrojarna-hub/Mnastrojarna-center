import { describe, it, expect } from "vitest";
import { findSentFolder, sentCopyLabel } from "./mail-folders";
import { threadCountLabel } from "./mail-types";

describe("složka Odeslané na serveru", () => {
  it("přednostně SPECIAL-USE \\Sent (i s jiným jménem)", () => {
    const f = findSentFolder([
      { path: "INBOX" }, { path: "Sent" }, { path: "INBOX.Odeslané", specialUse: "\\Sent" },
    ]);
    expect(f?.path).toBe("INBOX.Odeslané");
    expect(findSentFolder([{ path: "Moje odeslané", flags: ["\\HasNoChildren", "\\Sent"] }])?.path).toBe("Moje odeslané");
  });
  it("bez SPECIAL-USE: Sent → INBOX.Sent → Odeslaná pošta → Sent Items", () => {
    expect(findSentFolder([{ path: "INBOX" }, { path: "Sent Items" }, { path: "INBOX.Sent" }])?.path).toBe("INBOX.Sent");
    expect(findSentFolder([{ path: "INBOX" }, { path: "Sent Items" }, { path: "Odeslaná pošta" }])?.path).toBe("Odeslaná pošta");
    expect(findSentFolder([{ path: "INBOX" }, { path: "Sent Items" }])?.path).toBe("Sent Items");
    expect(findSentFolder([{ path: "INBOX" }, { path: "sent" }])?.path).toBe("sent");
  });
  it("jiná běžná jména (bez diakritiky, poslední úroveň), složka \\Noselect se nebere", () => {
    expect(findSentFolder([{ path: "INBOX/Odeslane polozky", delimiter: "/" }])?.path).toBe("INBOX/Odeslane polozky");
    expect(findSentFolder([{ path: "Sent", flags: ["\\Noselect"] }])).toBeNull();
    expect(findSentFolder([{ path: "INBOX" }, { path: "Drafts" }])).toBeNull();
  });
  it("popis výsledku kopie", () => {
    expect(sentCopyLabel("ok")).toMatch(/uložena do Odeslaných/);
    expect(sentCopyLabel("failed", "na serveru není složka")).toMatch(/nepodařilo uložit \(na serveru není složka\) — e-mail ale odešel/);
    expect(sentCopyLabel("skipped", "POP3 nemá složku Odeslané (jen IMAP)")).toMatch(/neukládá: POP3/);
  });
});

describe("review #12: počet vláken česky", () => {
  it("1 vlákno / 2–4 vlákna / 5+ vláken", () => {
    expect(threadCountLabel(1)).toBe("1 vlákno");
    expect(threadCountLabel(2)).toBe("2 vlákna");
    expect(threadCountLabel(4)).toBe("4 vlákna");
    expect(threadCountLabel(5)).toBe("5 vláken");
    expect(threadCountLabel(0)).toBe("0 vláken");
    expect(threadCountLabel(1204).replace(/\s/g, " ")).toBe("1 204 vláken");
  });
});
