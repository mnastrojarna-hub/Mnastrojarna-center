import { NextResponse } from "next/server";
import { generateQuote } from "@/lib/ai/claude";
import { getAgentInstructions } from "@/lib/ai/corrections";
import { runPricingFlow } from "@/lib/ai/pricing-flow";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const customer = String(body.customer ?? "");
    const inquiry = String(body.inquiry ?? "");

    // Volitelně nejdřív naceň (Nacenění v2), pak postav nabídku
    let estimate;
    if (body.withPricing) {
      const flow = await runPricingFlow({ ...body, drawingText: inquiry });
      estimate = flow.estimate;
    }

    const quoteRules = await getAgentInstructions("quote");
    const quote = await generateQuote({ customer, inquiry, estimate, rules: quoteRules });
    return NextResponse.json({ quote, estimate });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Chyba generování nabídky";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
