import { anonGuard, json, loadSubject, readBody, tableParam } from "@/lib/anonymize/route-helpers";
import { defaultDeadline, saveManualRegions, validateManualRegions } from "@/lib/anonymize/service";
import type { AnonRegion, KeepField } from "@/lib/anonymize/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ fileId: string }> };

type NBox = { x: number; y: number; w: number; h: number };

/** Hodnoty keep polí z vytěžení (číslo výkresu, revize, materiál) — stejné jako služba. */
function keepValuesOf(row: Record<string, unknown>): Partial<Record<KeepField, string>> {
  const ex = (row.ai_extracted && typeof row.ai_extracted === "object" ? row.ai_extracted : {
    drawingNumber: row.drawing_number, revision: row.revision, material: row.material,
  }) as Record<string, unknown>;
  const d = (ex.drawing && typeof ex.drawing === "object" ? ex.drawing : ex) as Record<string, unknown>;
  const out: Partial<Record<KeepField, string>> = {};
  for (const k of ["drawingNumber", "revision", "material"] as const) {
    const v = d[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

/**
 * Stav anonymizace jednoho souboru (pro odznak a editor): stav, důvod, souhrn po kategoriích,
 * oblasti (čitelný text jen super adminovi), vyřazené stránky, hasAfter (je kopie „Po") a
 * (?lines=1&page=n u PDF) řádky textové vrstvy pro ťukací editor + chráněná pole (keep) a razítko.
 * ?table=drawings|adhoc. Žádná přímá URL na kopii (stahuje se jen přes /download s ověřením sha).
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
  let lines: { id: string; text: string; x: number; y: number; w: number; h: number; zone: string; keep?: boolean }[] | undefined;
  let keep: (NBox & { field: string })[] | undefined;
  let titleBlock: NBox | null | undefined;
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  if (url.searchParams.get("lines") === "1" && String(r.storage_path ?? "").toLowerCase().endsWith(".pdf")) {
    try {
      const bucket = table === "drawings" ? "documents" : "job-files";
      const { data: blob } = await guard.db.storage.from(bucket).download(String(r.anon_source_path ?? r.storage_path));
      if (blob) {
        const { openPdf } = await import("@/lib/anonymize/pdf-node");
        const { extractPage } = await import("@/lib/anonymize/pdf-text");
        const { rulePage, makeTerms, DEFAULT_REDACT } = await import("@/lib/anonymize/rules");
        const pdf = await openPdf(new Uint8Array(await blob.arrayBuffer()));
        if (page <= pdf.numPages) {
          const { info } = await extractPage(pdf, page);
          const W = info.widthPt, H = info.heightPt;
          const norm = (b: { x: number; y: number; w: number; h: number }): NBox => ({ x: b.x / W, y: b.y / H, w: b.w / W, h: b.h / H });
          // chráněná pole (číslo výkresu, revize, materiál, měřítko, název) — editor u nich chce potvrzení
          const pr = rulePage(info.lines, { terms: makeTerms([], "crm"), keepTerms: [], redact: { ...DEFAULT_REDACT } }, { keepValues: keepValuesOf(r) });
          const keepIds = new Set(pr.keep.map((k) => k.lineId));
          lines = info.lines.map((l) => ({ id: l.id, text: l.text, ...norm(l.box), zone: l.zone, ...(keepIds.has(l.id) ? { keep: true } : {}) }));
          const byId = new Map(info.lines.map((l) => [l.id, l]));
          const seen = new Set<string>();
          keep = pr.keep.flatMap((k) => {
            const l = byId.get(k.lineId);
            if (!l || seen.has(`${k.lineId}:${k.field}`)) return [];
            seen.add(`${k.lineId}:${k.field}`);
            return [{ ...norm(l.box), field: k.field }];
          });
          titleBlock = info.titleBlock ? norm(info.titleBlock) : null;
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
    regions: regions.map((g) => (texts[g.id] ? { ...g, text: texts[g.id] } : g)), hasAfter: Boolean(r.anon_path),
    ...(lines ? { lines } : {}), ...(keep ? { keep } : {}), ...(titleBlock !== undefined ? { titleBlock } : {}),
  });
}

/**
 * Ruční úprava (editor): { regions (ruční sada manual:added|removed), expectedAt, confirmKeep? } → vypálit
 * znovu → done (uložení = rozhodnutí člověka, i se zásahem do chráněného pole). Jiný výsledek → 422.
 */
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
  const res = await saveManualRegions(guard.db, table, fileId, regions, expectedAt, guard.actor, defaultDeadline(), { confirmKeep: body.confirmKeep === true });
  if ("conflict" in res) return json({ error: "Anonymizace se mezitím změnila — obnov náhled." }, 409);
  if ("notFound" in res) return json({ error: "Soubor nenalezen." }, 404);
  const warnings = (res.summary?.warnings ?? []).map((w) => ({ code: w.code, message: w.message, ...(w.page ? { page: w.page } : {}) }));
  return json({ ok: res.status === "done", status: res.status, reason: res.reason, warnings }, res.status === "done" ? 200 : 422);
}
