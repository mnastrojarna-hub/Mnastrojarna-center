import { NextResponse } from "next/server";
import { askAssistant } from "@/lib/ai/claude";

export async function POST(req: Request) {
  try {
    const { question, context } = await req.json();
    if (!question || typeof question !== "string") {
      return NextResponse.json({ error: "Chybí dotaz." }, { status: 400 });
    }
    const answer = await askAssistant({ question, context });
    return NextResponse.json({ answer });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Neznámá chyba";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
