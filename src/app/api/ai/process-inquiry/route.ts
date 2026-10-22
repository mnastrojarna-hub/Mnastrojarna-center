import { NextResponse } from "next/server";
import { generateQuote } from "@/lib/ai/claude";
import { getAgentInstructions } from "@/lib/ai/corrections";
import { runPricingFlow } from "@/lib/ai/pricing-flow";
import { submitAiQuote } from "@/app/actions/ai-quote";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Celý tok jedním voláním: naceň (baseline + AI technolog) → nabídka →
 * uložení + PDF archiv + fronta schválení (+ odeslání).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const customer = String(body.customer ?? "");
    const quantity = Number(body.quantity) || 1;
    const inquiry =
      `Výkres ${body.drawingNumber ?? "—"}, materiál ${body.material ?? "—"}, ` +
      `${body.dimensions ?? body.blankDimensions ?? "—"}, ${quantity} ks. ${body.requirements ?? ""}`;

    // 1) Naceň (deterministická baseline + AI rafinace + vyhlazení + uložení)
    const { estimate, baseline, historical, calculationId } = await runPricingFlow({
      ...body,
      quantity,
      drawingText: inquiry,
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

    return NextResponse.json({ estimate, baseline, historical, calculationId, quote, result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Chyba zpracování";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
