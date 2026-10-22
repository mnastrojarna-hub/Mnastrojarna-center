import type { CustomerPricingProfile, StrategyContext, StrategyResult } from "./types";

/**
 * Cenová strategie 1–10 → marže, s ohledem na vytížení výroby, atraktivitu
 * a strategický význam zákazníka, opakovatelnost a konkurenci na trhu.
 *
 * 1 = podnákladová · 2 = minimální marže · 3 = velmi agresivní · 5 = standard
 * 7 = vyšší marže · 8 = prémiová · 9 = vysoká · 10 = maximální obchodní cena
 */

/** Násobič výchozí marže pro úroveň 1–10 (úroveň 5 = 1,0 = výchozí marže). */
const LEVEL_FACTOR: Record<number, number> = {
  1: -0.6, 2: 0.2, 3: 0.5, 4: 0.75, 5: 1.0, 6: 1.35, 7: 1.75, 8: 2.3, 9: 2.9, 10: 3.7,
};

export const STRATEGY_LABEL: Record<number, string> = {
  1: "Podnákladová cena", 2: "Minimální marže", 3: "Velmi agresivní cena", 4: "Agresivní cena",
  5: "Standardní tržní cena", 6: "Mírně vyšší marže", 7: "Vyšší marže", 8: "Prémiová cena",
  9: "Vysoká marže", 10: "Maximální obchodní cena",
};

export function clampLevel(level: number): number {
  return Math.min(10, Math.max(1, Math.round(level || 5)));
}

export function marginForLevel(level: number, baseMarginPercent: number): number {
  return round1(baseMarginPercent * LEVEL_FACTOR[clampLevel(level)]);
}

/**
 * Výsledná strategie: zadaná úroveň ± kontextové posuny.
 * Vytížená výroba zdražuje; atraktivní/strategický zákazník, opakovatelnost
 * a silná konkurence zlevňují; rizikový zákazník zdražuje.
 */
export function resolveStrategy(input: {
  requestedLevel: number;
  baseMarginPercent: number;
  context?: StrategyContext;
  customer?: CustomerPricingProfile | null;
}): StrategyResult {
  const requested = clampLevel(input.requestedLevel);
  const ctx = input.context ?? {};
  const cust = input.customer ?? {};
  let level = requested;
  const adjustments: string[] = [];

  const utilization = ctx.utilizationPercent;
  if (typeof utilization === "number") {
    if (utilization >= 90) { level += 1; adjustments.push(`výroba vytížená na ${utilization} % → +1 úroveň`); }
    else if (utilization <= 50) { level -= 1; adjustments.push(`volná kapacita (${utilization} %) → −1 úroveň`); }
  }

  const strategic = ctx.customerStrategic || cust.businessPriority === "strategicky";
  const attractive = ctx.customerAttractive || cust.businessPriority === "vysoka"
    || (cust.annualRevenueCzk ?? 0) >= 1_000_000;
  if (strategic) { level -= 1; adjustments.push("strategický zákazník → −1 úroveň"); }
  else if (attractive) { level -= 0.5 as unknown as number; adjustments.push("atraktivní zákazník → −0,5 úrovně"); }

  if (ctx.repeatBusiness || cust.repeatCustomer) { adjustments.push("opakovaná zakázka → −0,5 úrovně"); level -= 0.5; }
  if (ctx.competitiveMarket || cust.priceLevel === "nizka") { level -= 1; adjustments.push("konkurenční trh / nízká cenová hladina → −1 úroveň"); }
  if (cust.priceLevel === "premium") { level += 1; adjustments.push("prémiová cenová hladina zákazníka → +1 úroveň"); }
  if (ctx.riskyCustomer || cust.riskLevel === "vysoke" || cust.paymentMorale === "spatna") {
    level += 1; adjustments.push("rizikový zákazník / špatná platební morálka → +1 úroveň");
  }

  const final = clampLevel(level);
  // Individuální marže zákazníka má přednost jako základ; strategie ji škáluje
  const base = typeof cust.marginPercent === "number" && cust.marginPercent > 0
    ? cust.marginPercent
    : input.baseMarginPercent;
  if (base !== input.baseMarginPercent) adjustments.push(`individuální marže zákazníka ${base} %`);

  return {
    level: final,
    requestedLevel: requested,
    marginPercent: marginForLevel(final, base),
    adjustments,
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
