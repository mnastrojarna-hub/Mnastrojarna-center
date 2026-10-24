import { anonGuard, isUuid, json } from "@/lib/anonymize/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Odeslání zakázky čekající na anonymizaci (hláška „Odešle se po dokončení anonymizace (2 výkresy)"
 * se Zrušit / Odeslat hned bez těchto výkresů). Jen čtení: příjemce a počty, bez obsahu e-mailu.
 * Zrušit a odeslat bez výkresů smí jen autor nebo super admin (akce cancelQueuedSend / sendQueuedWithoutPending).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId");
  if (!isUuid(jobId)) return json({ error: "Zakázka nenalezena." }, 404);
  const guard = await anonGuard("job_files");
  if (guard instanceof Response) return guard;
  const { data: job } = await guard.db.from("orders").select("id").eq("id", jobId).maybeSingle();
  if (!job) return json({ error: "Zakázka nenalezena." }, 404);
  const since = new Date(Date.now() - 3 * 24 * 3600_000).toISOString();
  const { data } = await guard.db.from("anon_send_queue").select("id, kind, status, reason, payload, file_ids, created_by, created_at")
    .eq("job_id", jobId).or(`status.in.(waiting,blocked,sending),and(status.eq.failed,created_at.gte.${since})`)
    .order("created_at", { ascending: false }).limit(10);
  const admin = guard.user.role === "super_admin";
  // objednávky dodavateli (ceny) jen s právem na marže; cizí odeslání bez příjemce a důvodu (jen že čeká)
  const canMargins = admin || guard.access.can("margins");
  const rows = ((data ?? []) as { id: string; kind: string; status: string; reason: string | null; payload: Record<string, unknown>; file_ids: string[]; created_by: string | null; created_at: string }[])
    .filter((r) => canMargins || r.kind !== "purchase_order");
  const fileIds = [...new Set(rows.flatMap((r) => r.file_ids ?? []))];
  const statuses = new Map<string, string | null>();
  if (fileIds.length) {
    const { data: f } = await guard.db.from("job_files").select("id, anon_status").in("id", fileIds.slice(0, 200));
    for (const x of (f ?? []) as { id: string; anon_status: string | null }[]) statuses.set(x.id, x.anon_status);
  }
  const items = rows.map((r) => {
    const mine = r.created_by === guard.user.id || admin;
    const to = Array.isArray(r.payload?.to) ? (r.payload.to as unknown[]).filter((x) => typeof x === "string").join(", ") : null;
    const label = typeof r.payload?.recipientLabel === "string" ? r.payload.recipientLabel : null;
    const pendingIds = (r.file_ids ?? []).filter((id) => { const s = statuses.get(id) ?? null; return s !== "done"; });
    // výkres, který odeslání blokuje (ke kontrole / selhal) → „Zkontrolovat výkres"
    const blockingFileId = pendingIds.find((id) => { const s = statuses.get(id); return s === "review" || s === "failed"; }) ?? null;
    return {
      id: r.id, kind: r.kind, status: r.status, to: mine ? (label ?? to) : null, fileCount: (r.file_ids ?? []).length, pendingCount: pendingIds.length,
      createdAt: r.created_at, reason: mine ? r.reason : null, mine, blockingFileId: mine ? blockingFileId : null,
    };
  });
  return json({ items });
}
