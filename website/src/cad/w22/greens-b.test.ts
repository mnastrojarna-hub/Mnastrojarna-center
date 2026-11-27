/**
 * Vlna 22, kolo 6 (balík b) – „greens“: úspěšné texty, které body tohoto balíku mění, se NEvypíšou, když kontrola
 * neproběhla nebo výsledek je jen předpoklad.
 *
 * * materiál zadaný označením, ze kterého se třída nepozná (Hardox 400): hustota je předpoklad → žádné ✓ na řádku, jen
 *   → (ℹ) + ⚠ material.density-assumed (dřív „✓ materiál … hustota zůstává“ vedle ⚠ – falešná zelená, engine/ops/meta.ts);
 * * komponenta sestavy `sestava komponenta "X" materiál "…"` = totéž pravidlo jako příkaz dílu (dřív se třída z označení
 *   nepoznala a hustota zůstala, bez hlášky – asm-agent.ts);
 * * pole označení v GUI = totéž pravidlo (`withDesignation`, `designationNote` – material-designation.ts).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { setLang } from "../i18n";
import type { EngineHost } from "../engine/host";
import { MemoryWorkspace } from "../engine/memory-workspace";
import { runScript } from "../engine/run";
import { designationNote, designationPatch, knownMaterialId, withDesignation } from "../material-designation";
import { emptyDoc, type CadDoc } from "../types";
import { realHost } from "./real-host";

let host: () => EngineHost;
beforeAll(async () => {
  setLang("cs");
  host = await realHost();
}, 120_000);

const at = (r: Awaited<ReturnType<typeof runScript>>, line: number) => r.entries.filter((e) => e.line === line);

describe("greens b: označení materiálu bez rozpoznané třídy není ✓", () => {
  it("díl: `materiál Hardox 400` → žádné ✓ na řádku, ⚠ material.density-assumed; `materiál ČSN 11 423` → ✓ + ℹ material.class", async () => {
    const r = await runScript(new MemoryWorkspace(), 'nový díl "Deska A"\nkvádr 10 10 10\nmateriál Hardox 400\nmateriál ČSN 11 423', host());
    const l3 = at(r, 3);
    expect(l3.filter((e) => e.level === "ok"), JSON.stringify(l3)).toEqual([]);
    expect(l3.some((e) => e.level === "warn" && e.code === "material.density-assumed")).toBe(true);
    const l4 = at(r, 4);
    expect(l4.some((e) => e.code === "material.class")).toBe(true);
    expect(l4.some((e) => e.code === "material.density-assumed")).toBe(false);
  }, 60_000);

  it("komponenta: `sestava komponenta … materiál \"ČSN 11 423\"` nastaví třídu Ocel z označení (ℹ), „Hardox 400“ = ⚠ (jako příkaz dílu)", async () => {
    const ws = new MemoryWorkspace();
    const r = await runScript(ws, 'nový díl "Deska A"\nkvádr 10 10 10\nmateriál hliník\nnová sestava "S"\nvložit "Deska A"\nsestava komponenta "Deska A" materiál "ČSN 11 423"\nsestava komponenta "Deska A" materiál "Hardox 400"', host());
    const l6 = at(r, 6);
    expect(l6.some((e) => e.code === "material.class"), JSON.stringify(l6)).toBe(true);
    expect(l6.some((e) => e.level === "ok" && /ČSN 11 423.*hustota podle: Ocel/.test(e.text))).toBe(true);
    const l7 = at(r, 7);
    expect(l7.some((e) => e.level === "warn" && e.code === "material.density-assumed"), JSON.stringify(l7)).toBe(true);
    const asm = ws.present();
    const src = asm.components?.[0]?.source;
    expect(src?.kind).toBe("part");
    if (src?.kind === "part") expect([src.doc.material, src.doc.materialName]).toEqual(["ocel", "Hardox 400"]);
  }, 60_000);
});

describe("greens b: GUI pole označení = pravidlo textového příkazu", () => {
  const part = (material: string, materialName?: string): CadDoc => ({ ...emptyDoc("Deska A"), material, ...(materialName ? { materialName } : {}) });
  it("withDesignation dává totéž co `materiál …` (designationPatch) a hláška pod polem má kód protokolu", () => {
    for (const t of ["ČSN 11 423", "1.4301", "EN AW-6082", "Hardox 400", "nerez", "steel"]) {
      const gui = withDesignation(part("hlinik"), t);
      const p = designationPatch(t);
      expect([gui.material, gui.materialName], t).toEqual([p.material ?? "hlinik", p.materialName]);
    }
    expect(designationNote("ČSN 11 423", withDesignation(part("hlinik"), "ČSN 11 423").material)?.code).toBe("material.class");
    expect(designationNote("Hardox 400", "ocel")?.code).toBe("material.density-assumed");
    // třída změněná po označení (ČSN 11 423 = ocel, ale vybraný hliník) – hustota je předpoklad, ne ℹ „zařazen jako“
    expect(designationNote("ČSN 11 423", "hlinik")?.code).toBe("material.density-assumed");
    expect(designationNote(undefined, "ocel")).toBeNull();
    // prázdné pole nebo popisek současné třídy = bez označení
    expect(withDesignation(part("ocel", "X"), "").materialName).toBeUndefined();
    expect(withDesignation(part("ocel", "X"), "Ocel").materialName).toBeUndefined();
    expect(knownMaterialId("Stahl")).toBe("ocel");
  });
});
