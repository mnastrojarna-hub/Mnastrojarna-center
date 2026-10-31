import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToString as renderRaw } from "react-dom/server";

const renderToString = (node: React.ReactElement) => renderRaw(node).replace(/<!-- -->/g, "");

// Panel „Vyplnit z dokladu" bez Next.js (akce a nahrávání nahrazené)
vi.mock("@/app/actions/ares", () => ({ aresLookupAction: vi.fn() }));
vi.mock("@/components/jobs/capture/capture-client", () => ({ uploadCapturePage: vi.fn(), discardCaptureQuietly: vi.fn() }));

import { AresNoteText, DuplicateNotice, PartyAutofill, docLine, filledClass } from "@/components/contacts/party-autofill";

describe("PartyAutofill", () => {
  it("nový zákazník: tři cesty (vyfotit, nahrát, vložit text), jen zákazník — žádná zakázka", () => {
    const html = renderToString(<PartyAutofill kind="customer" onApply={() => ""} onApplyAres={() => ""} />);
    expect(html).toContain("Vyplnit z dokladu");
    expect(html).toContain("AI vyplní jen zákazníka — žádnou zakázku");
    expect(html).toContain("Vyfotit");
    expect(html).toContain("Nahrát");
    expect(html).toContain("Vložit text");
    expect(html).toContain('capture="environment"');
    expect(html).toMatch(/accept="[^"]*\.eml[^"]*\.msg/);
  });

  it("dodavatel", () => {
    const html = renderToString(<PartyAutofill kind="supplier" onApply={() => ""} onApplyAres={() => ""} />);
    expect(html).toContain("AI vyplní jen dodavatele");
  });

  it("úprava existujícího: sbalené do jednoho tlačítka", () => {
    const html = renderToString(<PartyAutofill kind="customer" compact exceptId="x" onApply={() => ""} onApplyAres={() => ""} />);
    expect(html).toContain("Doplnit z dokladu");
    expect(html).not.toContain("Vložit text");
  });

  it("upozornění na duplicitu s odkazem", () => {
    const html = renderToString(<DuplicateNotice kind="customer" duplicate={{ id: "c1", label: "ZK0007 Strojmetal a.s.", by: "ico" }} />);
    expect(html).toContain("Tento zákazník už v adresáři je");
    expect(html).toContain("ZK0007 Strojmetal a.s.");
    expect(html).toContain("stejné IČO");
    expect(html).toContain('href="/customers/c1"');
    expect(renderToString(<DuplicateNotice kind="supplier" duplicate={null} />)).toBe("");
  });

  it("poznámka ARES a zvýraznění polí", () => {
    expect(renderToString(<AresNoteText note={null} fallback="nápověda" />)).toBe("nápověda");
    expect(renderToString(<AresNoteText note={{ tone: "ok", text: "Doplněno z ARES" }} fallback="x" />)).toContain("text-emerald-700");
    expect(filledClass("ai")).toContain("violet");
    expect(filledClass("ares")).toContain("emerald");
    expect(filledClass(undefined)).toBe("");
  });

  it("druh dokladu se v souhrnu AI nezdvojuje", () => {
    expect(docLine("objednávka", "Objednávka od Strojmetal.")).toBe("Objednávka od Strojmetal.");
    expect(docLine("podpis e-mailu", "Karel Kalič, kalírna.")).toBe("Podpis e-mailu: Karel Kalič, kalírna.");
    expect(docLine("", "Něco.")).toBe("Něco.");
  });
});
