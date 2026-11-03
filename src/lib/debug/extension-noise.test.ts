import { describe, expect, it } from "vitest";
import { isExtensionNoise } from "./capture";

describe("debug lišta: chyby rozšíření prohlížeče", () => {
  it("JSON-RPC chyba peněženky se ignoruje", () => {
    expect(isExtensionNoise({ code: -32603, message: "Internal JSON-RPC error." })).toBe(true);
    expect(isExtensionNoise({ code: 4001, message: "User rejected the request." })).toBe(true);
  });
  it("chyba ze skriptu rozšíření se ignoruje", () => {
    const e = new Error("x");
    e.stack = "Error: x\n    at chrome-extension://abcdef/inpage.js:1:1";
    expect(isExtensionNoise(e)).toBe(true);
  });
  it("chyby aplikace zůstávají", () => {
    expect(isExtensionNoise(new Error("Nepodařilo se uložit"))).toBe(false);
    expect(isExtensionNoise({ code: 500, message: "Server" })).toBe(false);
    expect(isExtensionNoise("text")).toBe(false);
  });
});
