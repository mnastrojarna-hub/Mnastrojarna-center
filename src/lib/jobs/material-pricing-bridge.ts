/**
 * Most mezi skupinami materiálu výkresu (material-groups.ts) a katalogem nacenění
 * (src/lib/pricing/materials.ts + tabulka `materials`, migrace 20260610110000_pricing_v2).
 *
 * Jeden zdroj pravdy pro hustotu: když označení z výkresu sedí na alias v katalogu (a skupiny si
 * odpovídají), použije se hustota z katalogu (editovatelná v DB). Jinak hustota skupiny / podskupiny.
 * Čistý modul (klient i server).
 */

import { findMaterial, MATERIALS } from "../pricing/materials";
import type { MaterialGroup as PricingMaterialGroup, MaterialInfo } from "../pricing/types";
import { analyzeDrawingMaterial, type DrawingMaterialAnalysis, type DrawingMaterialInput } from "./blank-weight";
import type { MaterialClassification, MaterialGroupKey } from "./material-groups";

/** Skupina katalogu nacenění → skupina přehledu výkresu. */
export const PRICING_GROUP_TO_MATERIAL_GROUP: Record<PricingMaterialGroup, MaterialGroupKey> = {
  konstrukcni_ocel: "bezna_ocel",
  automatova_ocel: "bezna_ocel",
  legovana_ocel: "zuslechtena_ocel",
  nastrojova_ocel: "nastrojova_ocel",
  nerez: "nerez",
  litina: "litina",
  hlinik: "hlinik",
  mosaz: "barevne_kovy",
  med: "med",
  bronz: "barevne_kovy",
  titan: "titan",
  plast: "plasty",
};

/** Skupina přehledu (+ podskupina) → skupina katalogu nacenění; null = katalog skupinu nemá. */
export function pricingGroupFor(m: Pick<MaterialClassification, "group" | "subgroup">): PricingMaterialGroup | null {
  const sub = m.subgroup?.key;
  switch (m.group) {
    case "bezna_ocel": return sub === "automatova" ? "automatova_ocel" : "konstrukcni_ocel";
    case "zuslechtena_ocel": return "legovana_ocel";
    case "nastrojova_ocel": return "nastrojova_ocel";
    case "nerez": case "duplex": return "nerez";
    case "litina": return "litina";
    case "hlinik": return "hlinik";
    case "med": return "med";
    case "barevne_kovy":
      if (sub === "mosaz") return "mosaz";
      if (sub === "bronz" || sub === "hlinikovy_bronz") return "bronz";
      return null;
    case "titan": return "titan";
    case "plasty": return "plast";
    default: return null;
  }
}

export interface CatalogMatch {
  material: MaterialInfo;
  /** g/cm³ (= kg/dm³) */
  density: number;
}

/**
 * Najde materiál v katalogu nacenění podle označení z výkresu. Vrací jen shodu, jejíž skupina
 * odpovídá zařazení výkresu (ochrana proti volné částečné shodě aliasu).
 */
export function findCatalogMaterial(
  designation: string | null | undefined,
  classification: Pick<MaterialClassification, "group" | "subgroup">,
  catalog: MaterialInfo[] = MATERIALS,
): CatalogMatch | null {
  if (!designation || !designation.trim()) return null;
  const { material, matched } = findMaterial(designation, catalog);
  if (!matched) return null;
  if (PRICING_GROUP_TO_MATERIAL_GROUP[material.group] !== classification.group) return null;
  return { material, density: material.densityKgDm3 };
}

export interface DrawingMaterialWithCatalog extends DrawingMaterialAnalysis {
  /** Materiál katalogu nacenění, jehož hustota byla použita (null = hustota skupiny). */
  catalog: CatalogMatch | null;
}

/**
 * analyzeDrawingMaterial + hustota z katalogu nacenění (tabulka `materials`), když označení sedí.
 * Pro server: předej katalog načtený z DB (stejný tvar jako MATERIALS), jinak se použije výchozí.
 */
export function analyzeDrawingMaterialWithCatalog(
  input: DrawingMaterialInput,
  catalog: MaterialInfo[] = MATERIALS,
): DrawingMaterialWithCatalog {
  const first = analyzeDrawingMaterial(input);
  const match = findCatalogMaterial(input.material ?? "", first.material, catalog);
  if (!match || Math.abs(match.density - first.blank.density) < 1e-9) return { ...first, catalog: match };
  return { ...analyzeDrawingMaterial({ ...input, densityOverride: match.density }), catalog: match };
}
