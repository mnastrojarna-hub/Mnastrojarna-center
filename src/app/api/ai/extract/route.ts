import { NextResponse } from "next/server";
import { extractFromDocument } from "@/lib/ai/claude";
import { getAgentInstructions } from "@/lib/ai/corrections";
import { apiRequire, getAccess } from "@/lib/auth/session";
import { createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { CAPTURE_BUCKET, captureHiresPath, captureSortPath, isCapturePagePath, sniffDocumentMime } from "@/lib/jobs/capture-review";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
/** Claude: obrázek do 5 MB (base64), PDF v požadavku do 32 MB. */
const MAX_IMAGE_BYTES = 3_700_000;
const MAX_PDF_BYTES = 22 * 1024 * 1024;

/**
 * Čtení výkresu / dokladu pro AI nacenění. Soubor NEJDE přes tuto funkci (Vercel 4,5 MB): prohlížeč ho
 * nahraje podepsanou URL do capture/<já>/ (uploadCapturePage — fotka zmenšená ≤ 2400 px), sem pošle jen
 * JSON { path, filename, mimeType }; server soubor přečte z úložiště a po přečtení smaže.
 */
export async function POST(req: Request) {
  // čtení výkresu / dokladu: AI nacenění (super admin) nebo AI čtení dokladů
  const auth = await apiRequire();
  if (auth instanceof NextResponse) return auth;
  const { can } = await getAccess();
  if (!can("ai_pricing") && !can("ai_capture")) return NextResponse.json({ error: "Bez oprávnění." }, { status: 403 });
  if (!isSupabaseConfigured() || !hasServiceKey()) return NextResponse.json({ error: "Pro čtení přílohy doplň servisní klíč Supabase." }, { status: 503 });
  let body: { path?: unknown; filename?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Očekávám JSON s cestou nahraného souboru." }, { status: 400 });
  }
  const path = body?.path;
  if (!isCapturePagePath(auth.user.id, path)) return NextResponse.json({ error: "Chybí soubor." }, { status: 400 });
  const db = createAdminClient();
  const storage = db.storage.from(CAPTURE_BUCKET);
  const cleanup = async () => {
    const extra = [captureSortPath(auth.user.id, path), captureHiresPath(path)].filter((p): p is string => Boolean(p));
    try { await storage.remove([path, ...extra]); } catch { /* dočasné soubory vyprší (24 h) */ }
  };
  try {
    const { data, error } = await storage.download(path);
    if (error || !data) return NextResponse.json({ error: "Soubor se nepodařilo načíst — nahraj ho znovu." }, { status: 404 });
    const bytes = Buffer.from(await (data as Blob).arrayBuffer());
    const mediaType = sniffDocumentMime(bytes);
    if (!mediaType || !ALLOWED.includes(mediaType)) {
      return NextResponse.json({ error: "Nepodporovaný typ souboru. Povoleno PDF, PNG, JPG, WEBP." }, { status: 415 });
    }
    if (bytes.length > (mediaType === "application/pdf" ? MAX_PDF_BYTES : MAX_IMAGE_BYTES)) {
      return NextResponse.json({ error: mediaType === "application/pdf" ? "PDF je pro čtení AI příliš velké (max 22 MB)." : "Obrázek je pro čtení AI příliš velký." }, { status: 413 });
    }
    const rules = await getAgentInstructions("extraction");
    const extracted = await extractFromDocument({ mediaType, dataBase64: bytes.toString("base64"), rules });
    return NextResponse.json({ extracted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Chyba čtení přílohy";
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    await cleanup();
  }
}
