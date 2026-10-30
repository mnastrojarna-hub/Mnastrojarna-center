import { NextResponse } from "next/server";
import { apiRequire } from "@/lib/auth/session";
import { generateQuote } from "@/lib/ai/claude";
import { getAgentInstructions } from "@/lib/ai/corrections";
import { runPricingFlow } from "@/lib/ai/pricing-flow";
import { userAiTone } from "@/lib/contacts/ai-tone";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const auth = await apiRequire("ai_pricing");
  if (auth instanceof NextResponse) return auth;
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
    // průvodní e-mail s tykáním / vykáním obchodníka k adresátovi (když je e-mail zákazníka)
    const tone = await userAiTone(auth.user.id, body.customerEmail);
    const quote = await generateQuote({ customer, inquiry, estimate, rules: quoteRules, tone });
    return NextResponse.json({ quote, estimate });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Chyba generování nabídky";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
