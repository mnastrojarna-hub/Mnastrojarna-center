"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured, hasServiceKey } from "@/lib/supabase/server";
import { extractFromDocument } from "@/lib/ai/claude";
import { getAgentInstructions } from "@/lib/ai/corrections";

type Result = { ok: boolean; error?: string; number?: string };

const ALLOWED = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

export async function uploadDrawing(form: FormData): Promise<Result> {
  if (!isSupabaseConfigured() || !hasServiceKey()) {
    return { ok: false, error: "Pro upload doplň servisní klíč Supabase (Nastavení → Integrace)." };
  }
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Chybí soubor." };
  const mediaType = file.type || "application/pdf";
  if (!ALLOWED.includes(mediaType)) return { ok: false, error: "Povoleno PDF, PNG, JPG, WEBP." };
  if (file.size > 15 * 1024 * 1024) return { ok: false, error: "Max 15 MB." };

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const dataBase64 = bytes.toString("base64");

    // AI přečte metadata (číslo výkresu, materiál, rozměry, množství…)
    const x = await extractFromDocument({
      mediaType,
      dataBase64,
      rules: await getAgentInstructions("extraction"),
    });

    const db = await createOperatorClient();
    const drawingNumber = x.drawing_number?.trim() || file.name.replace(/\.[^.]+$/, "");
    const revision = x.revision?.trim() || "A";
    const storagePath = `vykresy/${drawingNumber}_${Date.now()}.${mediaType.split("/")[1] ?? "pdf"}`;

    await db.storage.from("documents").upload(storagePath, bytes, { contentType: mediaType, upsert: true });

    const ext = mediaType === "application/pdf" ? "PDF" : "IMG";
    const { data, error } = await db
      .from("drawings")
      .insert({
        drawing_number: drawingNumber,
        revision,
        material: x.material?.trim() || null,
        dimensions: x.dimensions?.trim() || null,
        quantity: x.quantity || null,
        file_type: ext,
        storage_path: storagePath,
        ai_metadata: { requirements: x.requirements, summary: x.summary, confidence: x.confidence },
      } as never)
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) return { ok: false, error: "Nepodařilo se uložit výkres." };

    // Archiv dokumentů
    await db.from("documents").insert({
      doc_type: "vykres",
      number: `${drawingNumber} rev. ${revision}`,
      title: `Výkres ${drawingNumber}`,
      storage_path: storagePath,
    } as never);

    revalidatePath("/drawings");
    return { ok: true, number: drawingNumber };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba uploadu" };
  }
}
