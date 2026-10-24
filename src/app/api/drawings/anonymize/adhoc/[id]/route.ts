import { anonGuard, json, loadSubject } from "@/lib/anonymize/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stav jedné anonymizace samostatného nástroje (dotazování klienta; přežije přepnutí aplikace na iOS). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await anonGuard("drawing_anon_adhoc");
  if (guard instanceof Response) return guard;
  const loaded = await loadSubject(guard, "drawing_anon_adhoc", id, "view");
  if (loaded instanceof Response) return loaded;
  const r = loaded.row;
  return json({
    id: r.id, filename: r.filename, status: r.anon_status, reason: r.anon_reason ?? null, summary: r.anon_summary ?? null,
    anonFilename: r.anon_filename ?? null, at: r.anon_at ?? null, regions: r.anon_regions ?? [], pages: r.anon_pages ?? null,
    // stažení vždy přes /api/drawings/anonymize/<id>/download?table=adhoc (ověření sha)
    downloadUrl: r.anon_path ? `/api/drawings/anonymize/${r.id}/download?table=adhoc` : null,
  });
}
