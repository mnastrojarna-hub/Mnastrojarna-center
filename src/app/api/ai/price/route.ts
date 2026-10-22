import { NextResponse } from "next/server";
import { runPricingFlow } from "@/lib/ai/pricing-flow";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Nacenění v2: deterministická baseline + AI rafinace + ochrana proti
 * cenovým výkyvům + uložení kalkulace do historie (samoučení).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await runPricingFlow(body);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Chyba oceňování";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
