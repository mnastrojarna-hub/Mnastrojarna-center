import "server-only";
import { priceDrawing, type PriceEstimate } from "@/lib/ai/claude";
import { getAgentInstructions } from "@/lib/ai/corrections";
import { getPricingParams } from "@/lib/settings";
import {
  findHistoricalPrices, getCustomerPricingProfile, loadPricingCatalog, savePricingCalculation,
} from "@/lib/data/pricing-data";
import { calculatePrice, type EngineInput } from "@/lib/pricing/engine";
import { stabilizePrice } from "@/lib/pricing/smoothing";
import { breakdownToEstimate } from "@/lib/pricing/convert";
import type { LeadTimeMode, PriceBreakdown } from "@/lib/pricing/types";

/**
 * Kompletní tok Nacenění v2 (sdílený /api/ai/price a /api/ai/process-inquiry):
 * 1) parametry + zákaznický profil + historie + katalogy z DB
 * 2) deterministická baseline kalkulace (funguje i bez AI klíče)
 * 3) AI rafinace (technolog) nad baseline
 * 4) ochrana proti cenovým výkyvům i nad AI výsledkem
 * 5) uložení kalkulace do historie (samoučení)
 */

export interface PricingRequestBody {
  drawingNumber?: string;
  partType?: string;
  orderType?: string;
  material?: string;
  dimensions?: string;
  blankDimensions?: string;
  blankWeightKg?: number;
  finishedWeightKg?: number;
  surfaceTreatment?: string;
  heatTreatment?: string;
  surfaceQualities?: string[];
  machiningTechnologies?: string[];
  tolerancesBeforeHt?: Record<string, number>;
  tolerancesAfterHt?: Record<string, number>;
  geomToleranceCount?: number;
  threadCount?: number;
  holeCount?: number;
  pocketCount?: number;
  certificateRequired?: boolean;
  quantity?: number | string;
  customer?: string;
  requirements?: string;
  drawingText?: string;
  strategyLevel?: number;
  leadMode?: LeadTimeMode;
}

export interface PricingFlowResult {
  estimate: PriceEstimate;
  baseline: PriceBreakdown;
  historical: { found: boolean; unitPrice?: number; note?: string };
  calculationId: string | null;
}

const LEAD_MODES: LeadTimeMode[] = ["expres", "rychly", "standard", "dlouhy"];

export async function runPricingFlow(body: PricingRequestBody): Promise<PricingFlowResult> {
  const quantity = Math.max(1, Number(body.quantity) || 1);
  const leadMode = LEAD_MODES.includes(body.leadMode as LeadTimeMode) ? (body.leadMode as LeadTimeMode) : undefined;

  const [rules, params, history, customerProfile, catalog] = await Promise.all([
    getAgentInstructions("pricing"),
    getPricingParams(),
    findHistoricalPrices(body.drawingNumber),
    getCustomerPricingProfile(body.customer),
    loadPricingCatalog(),
  ]);

  // 1) Deterministická baseline
  const engineInput: EngineInput = {
    drawingNumber: body.drawingNumber,
    partType: body.partType,
    material: body.material,
    blankDimensions: body.blankDimensions ?? body.dimensions,
    blankWeightKg: numOrUndef(body.blankWeightKg),
    finishedWeightKg: numOrUndef(body.finishedWeightKg),
    quantity,
    technologies: body.machiningTechnologies,
    surfaceTreatment: body.surfaceTreatment,
    heatTreatment: body.heatTreatment,
    surfaceQualities: body.surfaceQualities,
    tolerancesBeforeHt: body.tolerancesBeforeHt,
    tolerancesAfterHt: body.tolerancesAfterHt,
    geomToleranceCount: numOrUndef(body.geomToleranceCount),
    threadCount: numOrUndef(body.threadCount),
    holeCount: numOrUndef(body.holeCount),
    pocketCount: numOrUndef(body.pocketCount),
    certificateRequired: body.certificateRequired,
    requestedLeadMode: leadMode,
    strategyLevel: numOrUndef(body.strategyLevel),
    customer: customerProfile,
    history,
    params,
    catalog,
  };
  const baseline = calculatePrice(engineInput);

  // 2) AI rafinace (bez klíče vrací baseline ve stejném tvaru)
  let estimate: PriceEstimate;
  try {
    estimate = await priceDrawing({
      drawingNumber: body.drawingNumber,
      partType: body.partType,
      orderType: body.orderType,
      material: body.material,
      blankDimensions: body.blankDimensions ?? body.dimensions,
      blankWeightKg: numOrUndef(body.blankWeightKg),
      finishedWeightKg: numOrUndef(body.finishedWeightKg),
      surfaceTreatment: body.surfaceTreatment,
      heatTreatment: body.heatTreatment,
      surfaceQualities: body.surfaceQualities,
      machiningTechnologies: body.machiningTechnologies,
      tolerancesBeforeHt: body.tolerancesBeforeHt,
      tolerancesAfterHt: body.tolerancesAfterHt,
      geomToleranceCount: numOrUndef(body.geomToleranceCount),
      threadCount: numOrUndef(body.threadCount),
      holeCount: numOrUndef(body.holeCount),
      pocketCount: numOrUndef(body.pocketCount),
      quantity,
      customer: body.customer,
      customerProfile,
      requirements: body.requirements,
      drawingText: body.drawingText,
      params,
      baseline,
      history,
      rules,
    });
  } catch {
    // AI selhala → deterministická kalkulace je plnohodnotný výstup
    estimate = breakdownToEstimate(baseline);
    estimate.reasoning = "AI rafinace selhala — použita deterministická kalkulace.\n\n" + estimate.reasoning;
  }

  // 3) Ochrana proti výkyvům i nad AI výsledkem (AI limit obejít nesmí)
  if (history.length && estimate.unit_price > 0) {
    const s = stabilizePrice(estimate.unit_price, history, {
      inflationPctPerYear: params.inflationPercent,
      maxStepUpPct: params.maxPriceStepPct,
      maxStepDownPct: params.maxPriceStepPct,
    });
    if (s.adjusted) {
      estimate.unit_price = s.price;
      estimate.total_price = Math.round(s.price * quantity * 100) / 100;
      estimate.price_stability_note = s.note;
      estimate.historical_used = true;
    }
  }

  // 4) Uložení do historie kalkulací (samoučení) — best effort
  const calculationId = await savePricingCalculation({
    drawingNumber: body.drawingNumber,
    customerName: body.customer,
    material: estimate.material || body.material,
    quantity,
    inputs: { ...body, quantity },
    baseline: baseline as unknown as Record<string, unknown>,
    estimate: estimate as unknown as Record<string, unknown>,
    unitPrice: estimate.unit_price,
    totalPrice: estimate.total_price,
    marginPercent: estimate.margin_percent,
    leadTimeDays: estimate.lead_time_days,
    strategyLevel: estimate.strategy_level,
    confidence: estimate.confidence,
  });

  const newest = history[0];
  return {
    estimate,
    baseline,
    historical: newest
      ? { found: true, unitPrice: newest.unitPrice, note: newest.note }
      : { found: false },
    calculationId,
  };
}

function numOrUndef(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : undefined;
}
