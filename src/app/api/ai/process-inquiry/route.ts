import { NextResponse } from "next/server";
import { priceDrawing, generateQuote } from "@/lib/ai/claude";
import { getAgentInstructions } from "@/lib/ai/corrections";
import { getPricingParams } from "@/lib/settings";
import { findHistoricalQuote } from "@/lib/data/queries";
import { submitAiQuote } from "@/app/actions/ai-quote";

export const runtime = "nodejs";
export const maxDuration = 90;

/**
 * Celý tok jedním voláním: naceň (technolog) → nabídka → uložení + PDF archiv + fronta schválení (+ odeslání).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const customer = String(body.customer ?? "");
    const quantity = Number(body.quantity) || 1;
    const inquiry =
      `Výkres ${body.drawingNumber ?? "—"}, materiál ${body.material ?? "—"}, ` +
      `${body.dimensions ?? "—"}, ${quantity} ks. ${body.requirements ?? ""}`;

    // 1) Oceň jako technolog (s parametry + historickou cenou)
    const [params, historical] = await Promise.all([
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
      customer,
      requirements: body.requirements,
      drawingText: inquiry,
      params,
      historical,
      rules: await getAgentInstructions("pricing"),
    });

    // 2) Vygeneruj nabídku z kalkulace
    const quote = await generateQuote({
      customer,
      inquiry,
      estimate,
      rules: await getAgentInstructions("quote"),
    });

    // 3) Ulož + PDF archiv + fronta schválení (+ odeslání při plné automatice)
    let result = null;
    if (quote.items.length > 0) {
      result = await submitAiQuote({
        customer,
        customerEmail: body.customerEmail,
        items: quote.items,
        coverEmail: quote.cover_email,
        leadTimeDays: quote.lead_time_days,
        validUntilDays: quote.valid_until_days,
        autoSend: Boolean(body.autoSend && body.customerEmail),
      });
    }

    return NextResponse.json({ estimate, quote, result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Chyba zpracování";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
