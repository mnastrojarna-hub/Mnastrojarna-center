import { NextResponse } from "next/server";
import { apiRequire } from "@/lib/auth/session";
import { generateQuote } from "@/lib/ai/claude";
import { getAgentInstructions } from "@/lib/ai/corrections";
import { runPricingFlow } from "@/lib/ai/pricing-flow";
import { submitAiQuote } from "@/app/actions/ai-quote";
import { userAiTone } from "@/lib/contacts/ai-tone";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Celý tok jedním voláním: naceň (baseline + AI technolog) → nabídka →
 * uložení + PDF archiv + fronta schválení (+ odeslání).
 */
export async function POST(req: Request) {
  const auth = await apiRequire("ai_pricing");
  if (auth instanceof NextResponse) return auth;
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

    // 2) Vygeneruj nabídku z kalkulace (průvodní e-mail s tykáním / vykáním obchodníka k adresátovi)
    const quote = await generateQuote({
      customer,
      inquiry,
      estimate,
      rules: await getAgentInstructions("quote"),
      tone: await userAiTone(auth.user.id, body.customerEmail),
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
