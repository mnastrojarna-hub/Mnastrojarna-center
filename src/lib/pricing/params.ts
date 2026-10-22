import type { PricingParams } from "./types";

export type { PricingParams } from "./types";

/** Výchozí parametry kalkulace — přepisují se hodnotami z DB (integration_settings). */
export const DEFAULT_PRICING_PARAMS: PricingParams = {
  hourlyRate: 1200,
  handlingRate: 600,
  programmingRate: 900,
  setupRate: 800,
  inspectionRate: 700,
  marginPercent: 15,
  inflationPercent: 5,
  transportDefault: 500,
  materialTransport: 300,
  strategyLevel: 5,
  utilizationPercent: 70,
  smallQtySurchargePct: 20,
  specialMaterialSurchargePct: 15,
  certificationSurchargePct: 10,
  scarceMaterialSurchargePct: 25,
  maxPriceStepPct: 15,
  expressSurchargePct: 25,
  fastSurchargePct: 10,
  countryCode: "CZ",
};
