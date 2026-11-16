import { describe, expect, it } from "vitest";
import { effectiveAutomationMode } from "./automation-mode";

describe("effectiveAutomationMode — přepínač nahoře je hlavní vypínač (16. 11.)", () => {
  it("nahoře „Se schválením“ → vše se schválením, i když modul má plnou automatiku", () => {
    expect(effectiveAutomationMode("approval", { mode: "full" })).toBe("approval");
    expect(effectiveAutomationMode(null, { mode: "full" })).toBe("approval");
    expect(effectiveAutomationMode(undefined, null)).toBe("approval");
  });
  it("nahoře „Plná automatika“ → platí modul; modul se schválením nebo vypnutý zůstane se schválením", () => {
    expect(effectiveAutomationMode("full", { mode: "full" })).toBe("full");
    expect(effectiveAutomationMode("full", { mode: "approval" })).toBe("approval");
    expect(effectiveAutomationMode("full", { mode: "full", enabled: false })).toBe("approval");
    expect(effectiveAutomationMode("full", null)).toBe("full");
  });
});
