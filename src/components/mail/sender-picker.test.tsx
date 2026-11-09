import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";

vi.mock("@/app/actions/mail-sender", () => ({ senderChoiceAction: vi.fn(), senderSignatureAction: vi.fn() }));

import { SenderPicker, swapSignature } from "./sender-picker";

describe("„Odeslat z“ (sender-picker)", () => {
  it("výměna podpisu v textu: jen když tam starý je, jednou", () => {
    const body = "Dobrý den,\nv příloze.\n\nS pozdravem\nJan Šponer\nMnástrojárna";
    expect(swapSignature(body, "S pozdravem\nJan Šponer\nMnástrojárna", "S pozdravem\nVáclav Volný\nMnástrojárna"))
      .toBe("Dobrý den,\nv příloze.\n\nS pozdravem\nVáclav Volný\nMnástrojárna");
    // uživatel podpis smazal / přepsal → text se nemění
    expect(swapSignature("Dobrý den.", "S pozdravem\nJan Šponer", "S pozdravem\nVáclav Volný")).toBe("Dobrý den.");
    expect(swapSignature("Dobrý den.", "", "X")).toBe("Dobrý den.");
  });

  it("před načtením ukáže, že zjišťuje odesílatele; jen pro admina (adminOnly) nic", () => {
    expect(renderToString(<SenderPicker value={null} onChange={() => undefined} />)).toContain("Zjišťuji, odkud se odešle");
    expect(renderToString(<SenderPicker adminOnly value={null} onChange={() => undefined} />)).toBe("");
  });
});
