import { NextResponse } from "next/server";
import { priceDrawing } from "@/lib/ai/claude";
import { getAgentInstructions } from "@/lib/ai/corrections";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const quantity = Number(body.quantity) || 1;
    const rules = await getAgentInstructions("pricing");
    const estimate = await priceDrawing({
      drawingNumber: body.drawingNumber,
      material: body.material,
      dimensions: body.dimensions,
      quantity,
      requirements: body.requirements,
      drawingText: body.drawingText,
      rules,
    });
    return NextResponse.json({ estimate });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Chyba oceňování";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
