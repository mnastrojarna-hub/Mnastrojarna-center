import { NextResponse } from "next/server";
import { categorizeEmail, draftReply } from "@/lib/ai/claude";
import { getAgentInstructions } from "@/lib/ai/corrections";

/**
 * Analyzuje e-mail AI (kategorie, priorita, spam, shrnutí) a volitelně
 * připraví návrh odpovědi. Volá se z ingest pipeline / fronty schvalování.
 */
export async function POST(req: Request) {
  try {
    const { from, subject, body, withDraft } = await req.json();
    if (!from || !subject) {
      return NextResponse.json({ error: "Chybí from/subject." }, { status: 400 });
    }
    const rules = await getAgentInstructions("email");
    const analysis = await categorizeEmail({ from, subject, body: body ?? "", rules });
    let draft: string | undefined;
    if (withDraft && !analysis.is_spam && analysis.category !== "spam") {
      draft = await draftReply({ from, subject, body: body ?? "", category: analysis.category, rules });
    }
    return NextResponse.json({ analysis, draft });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Neznámá chyba";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
