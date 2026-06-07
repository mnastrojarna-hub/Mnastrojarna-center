import { NextResponse } from "next/server";
import { generateQuote, priceDrawing } from "@/lib/ai/claude";
import { getAgentRules, buildRulesPrompt } from "@/lib/ai/rules";

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
      const priceRules = buildRulesPrompt(await getAgentRules("pricing"));
      estimate = await priceDrawing({
        drawingNumber: body.drawingNumber,
        material: body.material,
        dimensions: body.dimensions,
        quantity: Number(body.quantity) || 1,
        requirements: body.requirements,
        drawingText: inquiry,
        rules: priceRules,
      });
    }

    const quoteRules = buildRulesPrompt(await getAgentRules("quote"));
    const quote = await generateQuote({ customer, inquiry, estimate, rules: quoteRules });
    return NextResponse.json({ quote, estimate });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Chyba generování nabídky";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
