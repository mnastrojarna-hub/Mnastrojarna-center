import { NextResponse, after } from "next/server";
import { createAdminClient, hasServiceKey } from "@/lib/supabase/server";
import { cronActor, userActor } from "@/lib/supabase/actor-headers";
import { appOrigin, defaultDeadline, internalRunAuth, kick, runClaimed, type AnonDb } from "@/lib/anonymize/service";
import { idList, tableParam } from "@/lib/anonymize/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Interní běh anonymizace JEDNOHO souboru (rozvětvení z kick): claim + zpracování + after(kick)
 * (fronta se sama protáhne se souběhem ~5). Chráněno internalRunSecret (CRON_SECRET, jinak HMAC ze
 * SUPABASE_SECRET_KEY; cesta /api/cron je bez session).
 * Tělo: { table, ids: [id], manualBy? }.
 */
export async function POST(req: Request) {
  // CRON_SECRET, nebo (bez něj) tajemství odvozené ze SUPABASE_SECRET_KEY — viz internalRunSecret
  const status = internalRunAuth(req.headers.get("authorization"));
  if (status === 503) return NextResponse.json({ error: "Chybí CRON_SECRET i SUPABASE_SECRET_KEY." }, { status: 503 });
  if (status === 401) return NextResponse.json({ error: "Neautorizováno." }, { status: 401 });
  if (!hasServiceKey()) return NextResponse.json({ error: "Chybí SUPABASE_SECRET_KEY." }, { status: 503 });
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // prázdné tělo = vezmi z fronty
  }
  const table = tableParam(body.table);
  const ids = idList(body.ids, 1);
  const manualBy = typeof body.manualBy === "string" && /^[0-9a-f-]{36}$/i.test(body.manualBy) ? body.manualBy : null;
  const actor = manualBy ? userActor({ id: manualBy }, "rucne") : cronActor("drawing-anon");
  const db = createAdminClient({ actor }) as AnonDb;
  const start = Date.now();
  try {
    const results = await runClaimed(db, table, ids.length ? ids : null, { actor, deadline: defaultDeadline(start), manual: Boolean(manualBy) }, 1);
    const origin = appOrigin(req.url);
    // další z fronty (stejná tabulka; souběh drží počet rozvětvených běhů) — jen když se něco zpracovalo
    if (results.some((r) => r.reason !== "budget")) {
      after(async () => {
        await kick({ origin, table, db: createAdminClient({ actor: cronActor("drawing-anon") }) as AnonDb, limit: 1 });
      });
    }
    return NextResponse.json({ ok: true, results });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Chyba" }, { status: 500 });
  }
}
