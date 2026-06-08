import { NextResponse } from "next/server";
import { generateQuote, priceDrawing } from "@/lib/ai/claude";
import { getAgentInstructions } from "@/lib/ai/corrections";
import { getPricingParams } from "@/lib/settings";
import { findHistoricalQuote } from "@/lib/data/queries";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const customer = String(body.customer ?? "");
    const inquiry = String(body.inquiry ?? "");

    // Volitelně nejdřív naceň technologem, pak postav nabídku
    let estimate;
    if (body.withPricing) {
      const [priceRules, params, historical] = await Promise.all([
        getAgentInstructions("pricing"),
        getPricingParams(),
        findHistoricalQuote(body.drawingNumber),
      ]);
      estimate = await priceDrawing({
        drawingNumber: body.drawingNumber,
        partType: body.partType,
        orderType: body.orderType,
        material: body.material,
        blankDimensions: body.blankDimensions ?? body.dimensions,
        blankWeightKg: body.blankWeightKg,
        finishedWeightKg: body.finishedWeightKg,
        surfaceTreatment: body.surfaceTreatment,
        heatTreatment: body.heatTreatment,
        surfaceQualities: body.surfaceQualities,
        machiningTechnologies: body.machiningTechnologies,
        tolerancesBeforeHt: body.tolerancesBeforeHt,
        tolerancesAfterHt: body.tolerancesAfterHt,
        quantity: Number(body.quantity) || 1,
        customer,
        requirements: body.requirements,
        drawingText: inquiry,
        params,
        historical,
        rules: priceRules,
      });
    }

    const quoteRules = await getAgentInstructions("quote");
    const quote = await generateQuote({ customer, inquiry, estimate, rules: quoteRules });
    return NextResponse.json({ quote, estimate });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Chyba generování nabídky";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
