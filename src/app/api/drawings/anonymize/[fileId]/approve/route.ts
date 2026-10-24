import { anonGuard, json, loadSubject, readBody, tableParam } from "@/lib/anonymize/route-helpers";
import { approve } from "@/lib/anonymize/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** „Schválit" anonymizaci ke kontrole (review → done, s autorem). Odeslání čekající ve frontě pak odejdou. */
export async function POST(req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const body = await readBody(req);
  if (body instanceof Response) return body;
  const table = tableParam(body.table);
  const guard = await anonGuard(table);
  if (guard instanceof Response) return guard;
  const loaded = await loadSubject(guard, table, fileId, "edit");
  if (loaded instanceof Response) return loaded;
  const res = await approve(guard.db, table, fileId, guard.actor);
  return json(res, res.ok ? 200 : 409);
}
