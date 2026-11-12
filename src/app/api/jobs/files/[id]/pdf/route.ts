import { NextResponse } from "next/server";
import { apiRequire, getAccess } from "@/lib/auth/session";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { userActor } from "@/lib/supabase/actor-headers";
import { isUuid } from "@/lib/jobs/mapping";
import { convertJobFileToPdf } from "@/lib/jobs/drawing-convert";
import { kickInBackground } from "@/lib/anonymize/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// DWG (LibreDWG ve WebAssembly) u velkého výkresu i desítky sekund
export const maxDuration = 60;

/**
 * POST /api/jobs/files/<id>/pdf — výkres DXF / DWG zakázky převede na PDF a uloží jako nový dokument
 * (druh výkres; opakovaně = nová verze). ?skip=1 (hromadný převod) = výkres, který PDF už má, přeskočit.
 * Přístup stejně jako otevření souboru; originál se nemění.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiRequire("orders");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Dokument nenalezen." }, { status: 404 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Supabase není nakonfigurováno." }, { status: 503 });
  try {
    const db = await createOperatorClient({ actor: userActor(guard.user) });
    const access = await getAccess();
    const skip = new URL(req.url).searchParams.get("skip") === "1";
    const out = await convertJobFileToPdf(db, guard.user.id, access, id, { skipIfConverted: skip });
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
    if (out.skipped) return NextResponse.json({ skipped: true, file: out.existing, source: out.sourceName });
    // anonymizace: výkres PDF je kandidát jako každý jiný — šťouchnout do fronty (zpracuje route na pozadí)
    if (out.file.anon?.status === "pending") kickInBackground({ table: "job_files", ids: [out.file.id] });
    return NextResponse.json({
      skipped: false, file: { id: out.file.id, filename: out.file.filename, version: out.version }, sheet: out.sheet, source: out.sourceName,
    });
  } catch (err) {
    console.error(`[api:jobs:files:pdf] ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: "Převod na PDF se nepovedl — zkus to znovu." }, { status: 500 });
  }
}
