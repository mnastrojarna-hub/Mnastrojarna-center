import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

type El = { tag: string; isConnected: boolean; selectionStart?: number; selectionEnd?: number; focus: ReturnType<typeof vi.fn>; setSelectionRange?: ReturnType<typeof vi.fn> };

/**
 * Minimální stránka: konzole (textarea s kurzorem) má fokus; Clipboard API prohlížeč odmítne (okno není aktivní) →
 * záložní cesta přes skryté pole, které si fokus vezme (`select()`) a po odebrání ho nechá na <body>.
 */
function page(execCopy: () => boolean) {
  const body: El = { tag: "BODY", isConnected: true, focus: vi.fn() };
  const doc = {
    activeElement: null as El | null,
    body: { ...body, appendChild: vi.fn() },
    createElement: () => ta,
    execCommand: vi.fn(execCopy),
  };
  const consoleInput: El = {
    tag: "TEXTAREA",
    isConnected: true,
    selectionStart: 3,
    selectionEnd: 7,
    focus: vi.fn(() => void (doc.activeElement = consoleInput)),
    setSelectionRange: vi.fn(),
  };
  const ta = {
    tag: "TEXTAREA",
    value: "",
    style: {} as Record<string, string>,
    setAttribute: vi.fn(),
    select: vi.fn(() => void (doc.activeElement = ta as unknown as El)),
    remove: vi.fn(() => {
      if (doc.activeElement === (ta as unknown as El)) doc.activeElement = doc.body as unknown as El;
    }),
  };
  doc.activeElement = consoleInput;
  vi.stubGlobal("document", doc);
  vi.stubGlobal("navigator", { clipboard: { writeText: () => Promise.reject(new DOMException("Document is not focused.", "NotAllowedError")) } });
  return { doc, consoleInput, ta };
}

afterEach(() => vi.unstubAllGlobals());

describe("copyText – záložní kopírování nevezme fokus", () => {
  it("revize: po záložním kopírování má fokus i kurzor zase konzole (další psaný příkaz neskončí ve zkratkách stránky)", async () => {
    const { doc, consoleInput, ta } = page(() => true);
    expect(await copyText("https://example.test/cad#s=1")).toBe(true);
    expect(ta.select).toHaveBeenCalled();
    expect(ta.remove).toHaveBeenCalled();
    expect(doc.activeElement).toBe(consoleInput);
    expect(consoleInput.setSelectionRange).toHaveBeenCalledWith(3, 7);
  });

  it("kopírování selže (execCommand vyhodí) → false a fokus se stejně vrátí", async () => {
    const { doc, consoleInput } = page(() => {
      throw new Error("not allowed");
    });
    expect(await copyText("x")).toBe(false);
    expect(doc.activeElement).toBe(consoleInput);
  });

  it("Clipboard API funguje → bez skrytého pole, fokus se nehne", async () => {
    const { doc, consoleInput, ta } = page(() => true);
    vi.stubGlobal("navigator", { clipboard: { writeText: () => Promise.resolve() } });
    expect(await copyText("x")).toBe(true);
    expect(ta.select).not.toHaveBeenCalled();
    expect(doc.activeElement).toBe(consoleInput);
  });
});
