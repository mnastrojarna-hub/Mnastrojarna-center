import { NextResponse } from "next/server";
import { extractFromDocument } from "@/lib/ai/claude";
import { getAgentInstructions } from "@/lib/ai/corrections";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Očekávám nahraný soubor (multipart/form-data)." }, { status: 400 });
  }
  try {
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Chybí soubor." }, { status: 400 });
    }
    const mediaType = file.type || "application/pdf";
    if (!ALLOWED.includes(mediaType)) {
      return NextResponse.json({ error: `Nepodporovaný typ: ${mediaType}. Povoleno PDF, PNG, JPG, WEBP.` }, { status: 415 });
    }
    if (file.size > 15 * 1024 * 1024) {
      return NextResponse.json({ error: "Soubor je příliš velký (max 15 MB)." }, { status: 413 });
    }

    const dataBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const rules = await getAgentInstructions("extraction");
    const extracted = await extractFromDocument({ mediaType, dataBase64, rules });
    return NextResponse.json({ extracted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Chyba čtení přílohy";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
