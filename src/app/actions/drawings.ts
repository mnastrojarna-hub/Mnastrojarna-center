"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured, hasServiceKey } from "@/lib/supabase/server";
import { extractFromDocument } from "@/lib/ai/claude";
import { getAgentInstructions } from "@/lib/ai/corrections";
import { userActor } from "@/lib/supabase/actor-headers";
import { logAudit } from "@/lib/audit";
import { checkFeature } from "@/lib/auth/session";
import { kickInBackground } from "@/lib/anonymize/queue";
import { emptyDrawing } from "@/lib/jobs/capture-batch";
import { initialSpecState, insertSpecRow, normalizeDrawingSpec, specColumns, specSources } from "@/lib/jobs/drawing-spec";
import {
  DRAWING_ALLOWED_MIMES, DRAWING_MAX_BYTES, drawingAiPath, drawingExt, drawingUploadFolder, drawingUploadPath, isDrawingAiPath,
  isDrawingUploadPath,
} from "@/lib/drawings/upload-paths";

/**
 * Archiv výkresů → „Nahrát výkres": soubor jde z prohlížeče PŘÍMO do Supabase Storage (podepsaná URL —
 * server action má limit těla 1 MB, Vercel 4,5 MB; výkres PDF mívá 5–20 MB):
 *  1) createDrawingUpload → podepsaná URL do vykresy/upload/<uživatel>/<uuid>.<přípona>
 *     (+ u velké fotky URL pro zmenšenou kopii jen pro čtení AI),
 *  2) prohlížeč nahraje originál (a kopii pro AI),
 *  3) registerDrawing → AI přečte metadata, kontrola duplicit (číslo + revize), přesun do archivu, záznam;
 *     anonymizaci zařadí DB trigger a prohlížeč hned šťouchne do /api/drawings/anonymize/process.
 */

type Result = { ok: boolean; error?: string; number?: string; id?: string; anonStatus?: string | null };
type Prep = { ok: boolean; error?: string; path?: string; token?: string; bucket?: string; aiPath?: string; aiToken?: string };

const BUCKET = "documents";
type Extracted = Pick<Awaited<ReturnType<typeof extractFromDocument>>,
  "drawing_number" | "revision" | "material" | "blank_dimensions" | "heat_treatment" | "surface_treatment" | "requirements"
  | "part_name" | "quantity" | "heat_status" | "surface_status" | "summary" | "confidence">;
const EMPTY_EXTRACTION: Extracted = {
  drawing_number: "", revision: "", material: "", blank_dimensions: "", heat_treatment: "", surface_treatment: "", requirements: "",
  part_name: "", quantity: 0, heat_status: "nezjisteno", surface_status: "nezjisteno", summary: "", confidence: 0,
};
/** Claude: obrázek do 5 MB (base64) a požadavek do 32 MB — větší soubor AI nečte (vyplní se z názvu). */
const AI_MAX_IMAGE_BYTES = 3_700_000;
const AI_MAX_PDF_BYTES = 22 * 1024 * 1024;

async function begin() {
  const auth = await checkFeature("drawings");
  if ("error" in auth) return { error: auth.error as string };
  if (!isSupabaseConfigured() || !hasServiceKey()) {
    return { error: "Pro upload doplň servisní klíč Supabase (Nastavení → Integrace)." };
  }
  const db = await createOperatorClient({ actor: userActor(auth.user) });
  return { user: auth.user, db };
}

/** Nedokončená nahrání uživatele (zavřená stránka mezi nahráním a uložením) starší než 24 h. Best-effort. */
async function cleanupStaleUploads(db: Awaited<ReturnType<typeof createOperatorClient>>, userId: string): Promise<void> {
  try {
    const folder = drawingUploadFolder(userId);
    const { data } = await db.storage.from(BUCKET).list(folder, { limit: 100, sortBy: { column: "created_at", order: "asc" } });
    const cutoff = Date.now() - 24 * 3600_000;
    const old = ((data ?? []) as { name: string; created_at?: string | null }[])
      .filter((f) => f.name && f.created_at && Date.parse(f.created_at) < cutoff).map((f) => `${folder}/${f.name}`);
    if (old.length) await db.storage.from(BUCKET).remove(old);
  } catch {
    // úklid nesmí shodit nahrávání
  }
}

export async function createDrawingUpload(input: { filename: string; size: number; mimeType: string; aiCopy?: boolean }): Promise<Prep> {
  const c = await begin();
  if ("error" in c) return { ok: false, error: c.error };
  const mime = String(input?.mimeType ?? "").toLowerCase();
  if (!DRAWING_ALLOWED_MIMES.includes(mime)) return { ok: false, error: "Povoleno PDF, PNG, JPG, WEBP." };
  const size = Number(input?.size);
  if (!(size > 0)) return { ok: false, error: "Soubor je prázdný." };
  if (size > DRAWING_MAX_BYTES) return { ok: false, error: `Max ${Math.round(DRAWING_MAX_BYTES / 1024 / 1024)} MB.` };
  try {
    await cleanupStaleUploads(c.db, c.user.id);
    const path = drawingUploadPath(c.user.id, crypto.randomUUID(), mime);
    const { data, error } = await c.db.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data?.token) return { ok: false, error: error?.message ?? "Nahrání se nepodařilo připravit." };
    const out: Prep = { ok: true, path: (data.path as string | undefined) ?? path, token: data.token as string, bucket: BUCKET };
    if (input.aiCopy === true && mime.startsWith("image/")) {
      const aiPath = drawingAiPath(out.path!);
      const ai = aiPath ? await c.db.storage.from(BUCKET).createSignedUploadUrl(aiPath) : null;
      if (ai && !ai.error && ai.data?.token) {
        out.aiPath = (ai.data.path as string | undefined) ?? aiPath!;
        out.aiToken = ai.data.token as string;
      }
    }
    return out;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Nahrání se nepodařilo připravit." };
  }
}

export async function registerDrawing(input: { path: string; filename: string; mimeType: string; aiPath?: string | null }): Promise<Result> {
  const c = await begin();
  if ("error" in c) return { ok: false, error: c.error };
  const { db, user } = c;
  const mediaType = String(input?.mimeType ?? "").toLowerCase();
  if (!DRAWING_ALLOWED_MIMES.includes(mediaType)) return { ok: false, error: "Povoleno PDF, PNG, JPG, WEBP." };
  if (!isDrawingUploadPath(user.id, input?.path)) return { ok: false, error: "Neplatná cesta souboru." };
  const aiPath = input.aiPath && isDrawingAiPath(input.path, input.aiPath) ? input.aiPath : null;
  const filename = String(input.filename ?? "").slice(0, 255) || "vykres";
  const cleanupTmp = async (paths: string[]) => {
    try { await db.storage.from(BUCKET).remove(paths); } catch { /* dočasné soubory vyprší */ }
  };

  try {
    // AI přečte metadata (číslo výkresu, materiál, rozměry, množství…) — u velké fotky ze zmenšené kopie
    const { data: blob, error: dlErr } = await db.storage.from(BUCKET).download(aiPath ?? input.path);
    if (dlErr || !blob) return { ok: false, error: "Soubor se nepodařilo načíst z úložiště — nahraj ho znovu." };
    const bytes = Buffer.from(await (blob as Blob).arrayBuffer());
    const aiMedia = aiPath ? "image/jpeg" : mediaType;
    const tooBig = aiMedia === "application/pdf" ? bytes.length > AI_MAX_PDF_BYTES : bytes.length > AI_MAX_IMAGE_BYTES;
    let x: Extracted = { ...EMPTY_EXTRACTION, summary: "Soubor je pro čtení AI příliš velký — doplň údaje ručně." };
    if (!tooBig) {
      try {
        x = await extractFromDocument({ mediaType: aiMedia, dataBase64: bytes.toString("base64"), rules: await getAgentInstructions("extraction") });
      } catch (err) {
        // výkres se uloží i bez AI (číslo z názvu souboru) — anonymizace běží dál
        x = { ...EMPTY_EXTRACTION, summary: `AI výkres nepřečetla (${err instanceof Error ? err.message.slice(0, 120) : "chyba"}) — doplň údaje ručně.` };
      }
    }
    const drawingNumber = x.drawing_number?.trim() || filename.replace(/\.[^.]+$/, "");
    const revision = x.revision?.trim() || "A";

    // Detekce duplicit: stejné číslo výkresu + revize už v archivu je (nová verze = vyšší revize)
    const { data: existing } = await db
      .from("drawings")
      .select("id, revision")
      .eq("drawing_number", drawingNumber);
    const sameRevision = (existing ?? []).some(
      (d: { revision: string }) => d.revision.toLowerCase() === revision.toLowerCase(),
    );
    if (sameRevision) {
      await cleanupTmp([input.path, ...(aiPath ? [aiPath] : [])]);
      return {
        ok: false,
        error: `Duplicita: výkres ${drawingNumber} rev. ${revision} už v archivu je. Nová verze musí mít vyšší revizi.`,
      };
    }

    const safeNumber = drawingNumber.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "vykres";
    const storagePath = `vykresy/${safeNumber}_${Date.now()}.${drawingExt(mediaType)}`;
    const { error: mvErr } = await db.storage.from(BUCKET).move(input.path, storagePath);
    if (mvErr) return { ok: false, error: `Výkres se nepodařilo uložit do archivu: ${mvErr.message}` };
    if (aiPath) await cleanupTmp([aiPath]);

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
        // fotka / sken nahraný do archivu je originál (prohlížeč ho nezmenšuje) → anonymizace v plném rozlišení
        ...(mediaType.startsWith("image/") ? { anon_source_path: storagePath } : {}),
        ai_metadata: { requirements: x.requirements, summary: x.summary, confidence: x.confidence, ...(tooBig ? { aiSkipped: "too_big" } : {}) },
        uploaded_by: user.id,
        title: x.part_name?.trim() || null,
        ...specRow,
      } as never)
      .select("id");
    if (error || !data || data.length === 0) {
      await cleanupTmp([storagePath]);
      return { ok: false, error: error?.message ?? "Nepodařilo se uložit výkres." };
    }

    // Archiv dokumentů
    await db.from("documents").insert({
      doc_type: "vykres",
      number: `${drawingNumber} rev. ${revision}`,
      title: `Výkres ${drawingNumber}`,
      storage_path: storagePath,
    } as never);

    await logAudit({
      action: "drawing_uploaded", entity: "drawings", entityId: (data[0] as { id: string }).id,
      diff: { drawingNumber, revision, aiConfidence: x.confidence ?? null, ...(tooBig ? { aiSkipped: "too_big" } : {}) }, actor: userActor(user),
    });
    revalidatePath("/drawings");
    // anonymizace (DB trigger zařadil pending): akce nevykresluje — šťouchnutí po odpovědi a prohlížeč
    // hned volá /api/drawings/anonymize/process (zpracuje route); id + stav pro prohlížeč
    const id = (data[0] as { id: string }).id;
    const { data: st } = await db.from("drawings").select("anon_status").eq("id", id).maybeSingle();
    const anonStatus = (st as { anon_status: string | null } | null)?.anon_status ?? null;
    if (anonStatus === "pending") kickInBackground({ table: "drawings", ids: [id] });
    return { ok: true, number: drawingNumber, id, anonStatus };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba uploadu" };
  }
}
