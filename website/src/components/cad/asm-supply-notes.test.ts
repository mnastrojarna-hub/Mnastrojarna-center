/** Vlna 22, bod 19 (kolo 7): výpis příkazu `výkresy dílů` pro tlačítko „Výrobní dokumentace“ (okno Kusovník). */
import { describe, expect, it } from "vitest";
import { partDrawingsNote } from "./asm-supply";

describe("partDrawingsNote", () => {
  it("vezme nadpis, oddíly i odsazené řádky výpisu a připojí ⚠ řádky protokolu", () => {
    const out = [
      "✓ záložka „Deska V“ (díl) je aktivní – další příkazy pracují s ní",
      "Výkresy dílů sestavy „Nástroj V“ – vyráběných dílů 2 (normálie 0 a nakupované 0 výkres nedostanou):",
      "Založeno (1, A4, Chytré kóty):",
      "  → Deska V – list „List 1“ vyhodnocen bez nálezů",
      "Nezaloženo – díl není otevřený v záložce (1); otevřete díl a zadejte výkres A4:",
      "  ⚠ Deska W",
      "⚠ řádek 1: vyráběnému dílu chybí výkres, číslo nebo označení materiálu: Deska W (bez výkresu)",
      "",
      "Dokument: „Nástroj V“ · sestava",
    ].join("\n");
    const n = partDrawingsNote(out);
    expect(n).toMatch(/^Výkresy dílů sestavy „Nástroj V“/);
    expect(n).toMatch(/Založeno \(1, A4, Chytré kóty\):\n→ Deska V – list „List 1“ vyhodnocen bez nálezů/);
    expect(n).toMatch(/⚠ Deska W/);
    expect(n).toMatch(/⚠ řádek 1: vyráběnému dílu chybí výkres/);
    expect(n).not.toMatch(/Dokument:/);
    expect(n).not.toMatch(/záložka „Deska V“/);
  });
});
