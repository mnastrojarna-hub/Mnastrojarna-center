import { NextResponse } from "next/server";
import { priceDrawing } from "@/lib/ai/claude";
import { getAgentInstructions } from "@/lib/ai/corrections";
import { getPricingParams } from "@/lib/settings";
import { findHistoricalQuote } from "@/lib/data/queries";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const quantity = Number(body.quantity) || 1;
    const [rules, params, historical] = await Promise.all([
      getAgentInstructions("pricing"),
      getPricingParams(),
      findHistoricalQuote(body.drawingNumber),
    ]);
    const estimate = await priceDrawing({
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
      quantity,
      customer: body.customer,
      requirements: body.requirements,
      drawingText: body.drawingText,
      params,
      historical,
      rules,
    });
    return NextResponse.json({ estimate, historical });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Chyba oceňování";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
