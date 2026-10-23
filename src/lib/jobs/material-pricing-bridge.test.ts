import { describe, expect, it } from "vitest";
import { MATERIALS } from "../pricing/materials";
import { analyzeDrawingMaterialWithCatalog, findCatalogMaterial, pricingGroupFor, PRICING_GROUP_TO_MATERIAL_GROUP } from "./material-pricing-bridge";
import { classifyMaterial, MATERIAL_GROUPS } from "./material-groups";

describe("most skupiny výkresu ↔ katalog nacenění (recenze 14)", () => {
  it("každá skupina katalogu má protějšek a zpětné mapování sedí", () => {
    for (const m of MATERIALS) {
      const g = PRICING_GROUP_TO_MATERIAL_GROUP[m.group];
      expect(MATERIAL_GROUPS[g]).toBeDefined();
      const c = classifyMaterial(m.aliases.find((a) => /\d/.test(a)) ?? m.label);
      expect(c.group).toBe(g);
      expect(pricingGroupFor(c)).toBe(m.group);
    }
  });
  it("hustota z katalogu: 1.4404 = 8,00 (stejně jako tabulka materials)", () => {
    const a = analyzeDrawingMaterialWithCatalog({ material: "1.4404", dimensions: "Ø65x120" });
    expect(a.catalog?.material.key).toBe("17349");
    expect(a.blank.density).toBe(8);
    // π/4·70²·130 = 500 299 mm³ × 8,00 = 4,002 kg
    expect(a.columns.blank_weight_kg).toBeCloseTo(4.002, 3);
  });
  it("katalog z DB s upravenou hustotou má přednost", () => {
    const catalog = MATERIALS.map((m) => (m.key === "alu_6082" ? { ...m, densityKgDm3: 2.71 } : m));
    expect(analyzeDrawingMaterialWithCatalog({ material: "EN AW-6082", dimensions: "Ø40x100" }, catalog).blank.density).toBe(2.71);
  });
  it("shoda aliasu jiné skupiny se ignoruje; bez shody hustota skupiny", () => {
    expect(findCatalogMaterial("mosaz", classifyMaterial("1.4301"))).toBeNull();
    const a = analyzeDrawingMaterialWithCatalog({ material: "1.2767", dimensions: "Ø40x100" });
    expect(a.catalog).toBeNull();
    expect(a.blank.density).toBe(7.8);
  });
});
