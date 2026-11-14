import { NextResponse } from "next/server";
import { apiRequire, getAccess } from "@/lib/auth/session";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { userActor } from "@/lib/supabase/actor-headers";
import { isUuid } from "@/lib/jobs/mapping";
import { convertJobFileToPdf } from "@/lib/jobs/drawing-convert";
import { kickInBackground } from "@/lib/anonymize/queue";
import type { DrawingEditsInput } from "@/lib/viewer3d/drawing-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// DWG (LibreDWG ve WebAssembly) u velkého výkresu i desítky sekund
export const maxDuration = 60;

/**
 * POST /api/jobs/files/<id>/pdf — výkres DXF / DWG zakázky převede na PDF a uloží jako nový dokument
 * (druh výkres; opakovaně = nová verze). ?skip=1 (hromadný převod) = výkres, který PDF už má, přeskočit.
 * Přístup stejně jako otevření souboru; originál se nemění. Tělo { edits } (volitelně) = úpravy výkresu
 * z prohlížeče (smazané prvky, skryté / zapnuté hladiny) → PDF upraveného výkresu jako samostatná kopie.
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
    const edits = parseEdits(await req.text().catch(() => ""));
    if (edits === false) return NextResponse.json({ error: "Neplatné úpravy výkresu." }, { status: 400 });
    const out = await convertJobFileToPdf(db, guard.user.id, access, id, { skipIfConverted: skip, edits });
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

const MAX_EDIT_ITEMS = 2_000_000;

/** Úpravy z těla požadavku: null = bez úprav, false = neplatné. */
function parseEdits(body: string): DrawingEditsInput | null | false {
  if (!body.trim()) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return false;
  }
  const e = (raw as { edits?: unknown } | null)?.edits;
  if (e === undefined || e === null) return null;
  const o = e as Record<string, unknown>;
  const ints = (v: unknown) => Array.isArray(v) && v.length <= MAX_EDIT_ITEMS && v.every((x) => Number.isInteger(x) && (x as number) >= 0);
  const names = (v: unknown) => Array.isArray(v) && v.length <= 10_000 && v.every((x) => typeof x === "string" && x.length <= 512);
  if (!Number.isInteger(o.itemCount) || !ints(o.deletedItems) || !names(o.hiddenLayers) || !names(o.shownLayers)) return false;
  return { itemCount: o.itemCount as number, deletedItems: o.deletedItems as number[], hiddenLayers: o.hiddenLayers as string[], shownLayers: o.shownLayers as string[] };
}
