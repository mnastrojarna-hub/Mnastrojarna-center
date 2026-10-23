"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured, hasServiceKey } from "@/lib/supabase/server";
import { extractFromDocument } from "@/lib/ai/claude";
import { getAgentInstructions } from "@/lib/ai/corrections";
import { userActor } from "@/lib/supabase/actor-headers";
import { logAudit } from "@/lib/audit";
import { checkFeature } from "@/lib/auth/session";
import { emptyDrawing } from "@/lib/jobs/capture-batch";
import { initialSpecState, insertSpecRow, normalizeDrawingSpec, specColumns, specSources } from "@/lib/jobs/drawing-spec";

type Result = { ok: boolean; error?: string; number?: string };

const ALLOWED = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

export async function uploadDrawing(form: FormData): Promise<Result> {
  const auth = await checkFeature("drawings");
  if ("error" in auth) return { ok: false, error: auth.error };
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

    const db = await createOperatorClient({ actor: userActor(auth.user) });
    const drawingNumber = x.drawing_number?.trim() || file.name.replace(/\.[^.]+$/, "");
    const revision = x.revision?.trim() || "A";

    // Detekce duplicit: stejné číslo výkresu + revize už v archivu je
    const { data: existing } = await db
      .from("drawings")
      .select("id, revision")
      .eq("drawing_number", drawingNumber);
    const sameRevision = (existing ?? []).some(
      (d: { revision: string }) => d.revision.toLowerCase() === revision.toLowerCase(),
    );
    if (sameRevision) {
      return {
        ok: false,
        error: `Duplicita: výkres ${drawingNumber} rev. ${revision} už v archivu je. Nová verze musí mít vyšší revizi.`,
      };
    }

    const storagePath = `vykresy/${drawingNumber}_${Date.now()}.${mediaType.split("/")[1] ?? "pdf"}`;

    await db.storage.from("documents").upload(storagePath, bytes, { contentType: mediaType, upsert: true });

    // materiál (skupina), polotovar, TZ / PÚ s výslovným stavem — stejně jako výkres z focení
    const dr = {
      ...emptyDrawing(), material: x.material?.trim() ?? "", blankDimensions: x.blank_dimensions?.trim() ?? "",
      heatTreatment: x.heat_treatment?.trim() ?? "", surfaceTreatment: x.surface_treatment?.trim() ?? "",
      notes: x.requirements?.trim() ?? "", title: x.part_name?.trim() ?? "", quantity: x.quantity > 0 ? x.quantity : 0,
    };
    // AI výslovně říká „bez" / „nezjištěno" — jinak by každý díl bez úprav svítil „TZ nezjištěno"
    const { conflicts: _conflicts, ...drSpec } = normalizeDrawingSpec({ heatStatus: x.heat_status, surfaceStatus: x.surface_status }, dr);
    Object.assign(dr, drSpec);
    const spec = initialSpecState(dr, { aiUsed: (x.confidence ?? 0) > 0 });
    const specRow = insertSpecRow(specColumns(spec, dr.material), specSources(spec, false));

    const ext = mediaType === "application/pdf" ? "PDF" : "IMG";
    const { data, error } = await db
      .from("drawings")
      .insert({
        drawing_number: drawingNumber,
        revision,
        material: x.material?.trim() || null,
        dimensions: x.blank_dimensions?.trim() || null,
        quantity: x.quantity || null,
        file_type: ext,
        storage_path: storagePath,
        ai_metadata: { requirements: x.requirements, summary: x.summary, confidence: x.confidence },
        uploaded_by: auth.user.id,
        title: x.part_name?.trim() || null,
        ...specRow,
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

    await logAudit({
      action: "drawing_uploaded", entity: "drawings", entityId: (data[0] as { id: string }).id,
      diff: { drawingNumber, revision, aiConfidence: x.confidence ?? null }, actor: userActor(auth.user),
    });
    revalidatePath("/drawings");
    return { ok: true, number: drawingNumber };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba uploadu" };
  }
}
