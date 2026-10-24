import { anonGuard, json, loadSubject, readBody, tableParam } from "@/lib/anonymize/route-helpers";
import { defaultDeadline, saveManualRegions, validateManualRegions } from "@/lib/anonymize/service";
import type { AnonRegion } from "@/lib/anonymize/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ fileId: string }> };

/**
 * Stav anonymizace jednoho souboru (pro odznak a editor): stav, důvod, souhrn po kategoriích,
 * oblasti (čitelný text jen super adminovi), vyřazené stránky, krátká podepsaná URL „Po" a
 * (?lines=1&page=n u PDF) řádky textové vrstvy pro ťukací editor. ?table=drawings|adhoc.
 */
export async function GET(req: Request, { params }: Ctx) {
  const { fileId } = await params;
  const url = new URL(req.url);
  const table = tableParam(url.searchParams.get("table"));
  const guard = await anonGuard(table);
  if (guard instanceof Response) return guard;
  const loaded = await loadSubject(guard, table, fileId, "view");
  if (loaded instanceof Response) return loaded;
  const r = loaded.row;
  const regions = (r.anon_regions ?? []) as AnonRegion[];
  let texts: Record<string, string> = {};
  if (guard.user.role === "super_admin") {
    const col = table === "job_files" ? "job_file_id" : table === "drawings" ? "drawing_id" : "adhoc_id";
    const { data } = await guard.db.from("drawing_anon_texts").select("region_id, text").eq(col, fileId);
    texts = Object.fromEntries(((data ?? []) as { region_id: string; text: string }[]).map((t) => [t.region_id, t.text]));
  }
  let afterUrl: string | null = null;
  if (r.anon_path) {
    const bucket = table === "drawings" ? "documents" : "job-files";
    const { data } = await guard.db.storage.from(bucket).createSignedUrl(String(r.anon_path), 600);
    afterUrl = data?.signedUrl ?? null;
  }
  let lines: { id: string; text: string; x: number; y: number; w: number; h: number; zone: string }[] | undefined;
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  if (url.searchParams.get("lines") === "1" && String(r.storage_path ?? "").toLowerCase().endsWith(".pdf")) {
    try {
      const bucket = table === "drawings" ? "documents" : "job-files";
      const { data: blob } = await guard.db.storage.from(bucket).download(String(r.anon_source_path ?? r.storage_path));
      if (blob) {
        const { openPdf } = await import("@/lib/anonymize/pdf-node");
        const { extractPage } = await import("@/lib/anonymize/pdf-text");
        const pdf = await openPdf(new Uint8Array(await blob.arrayBuffer()));
        if (page <= pdf.numPages) {
          const { info } = await extractPage(pdf, page);
          lines = info.lines.map((l) => ({ id: l.id, text: l.text, x: l.box.x / info.widthPt, y: l.box.y / info.heightPt, w: l.box.w / info.widthPt, h: l.box.h / info.heightPt, zone: l.zone }));
        }
        await pdf.destroy();
      }
    } catch {
      lines = [];
    }
  }
  return json({
    id: r.id, table, status: r.anon_status, reason: r.anon_reason ?? null, method: r.anon_method ?? null, filename: r.anon_filename ?? null,
    at: r.anon_at ?? null, by: r.anon_by ?? null, actorKind: r.anon_actor_kind ?? null, via: r.anon_via ?? null,
    reviewedAt: r.anon_reviewed_at ?? null, reviewedBy: r.anon_reviewed_by ?? null, summary: r.anon_summary ?? null, pages: r.anon_pages ?? null,
    regions: regions.map((g) => (texts[g.id] ? { ...g, text: texts[g.id] } : g)), afterUrl, ...(lines ? { lines } : {}),
  });
}

/** Ruční úprava (editor): { regions (ruční sada manual:added|removed), expectedAt } → vypálit znovu → done. */
export async function PUT(req: Request, { params }: Ctx) {
  const { fileId } = await params;
  const body = await readBody(req);
  if (body instanceof Response) return body;
  const table = tableParam(body.table);
  const guard = await anonGuard(table);
  if (guard instanceof Response) return guard;
  const loaded = await loadSubject(guard, table, fileId, "edit");
  if (loaded instanceof Response) return loaded;
  const regions = validateManualRegions(body.regions);
  if (!regions) return json({ error: "Neplatné oblasti." }, 400);
  const expectedAt = typeof body.expectedAt === "string" ? body.expectedAt : null;
  const res = await saveManualRegions(guard.db, table, fileId, regions, expectedAt, guard.actor, defaultDeadline());
  if ("conflict" in res) return json({ error: "Anonymizace se mezitím změnila — obnov náhled." }, 409);
  if ("notFound" in res) return json({ error: "Soubor nenalezen." }, 404);
  return json({ ok: res.status === "done", ...res }, res.status === "done" ? 200 : 422);
}
