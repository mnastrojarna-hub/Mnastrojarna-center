import { NextResponse } from "next/server";
import { syncMailbox } from "@/lib/email/ingest";
import { cronActor } from "@/lib/supabase/actor-headers";
import { internalRunAuth } from "@/lib/anonymize/queue";
import { LIVE_MIN_INTERVAL_MS } from "@/lib/email/live-poll";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * Pravidelné stahování pošty i bez otevřené aplikace (majitel 25. 11.: „v Outlooku ho vidím hodinu,
 * v systému ne"). Volá ho plánovač v databázi (Supabase pg_cron + pg_net, každé 2 min — migrace
 * 20261125110000) — Vercel Hobby smí cron jen 1× denně. Krátké kolo: nové zprávy všech schránek,
 * schránku staženou před < 45 s (otevřená aplikace) přeskočí, se známým odmítnutým heslem se nepřihlašuje.
 * Chráněno interním tajemstvím (CRON_SECRET, jinak odvozené ze SUPABASE_SECRET_KEY).
 */
export async function GET(req: Request) {
  const status = internalRunAuth(req.headers.get("authorization"));
  if (status === 503) return NextResponse.json({ error: "Chybí CRON_SECRET i SUPABASE_SECRET_KEY." }, { status: 503 });
  if (status === 401) return NextResponse.json({ error: "Neautorizováno." }, { status: 401 });
  try {
    const res = await syncMailbox({
      limit: 50, maxMessages: 100, auto: true, minIntervalMs: LIVE_MIN_INTERVAL_MS,
      actor: cronActor("mail-tick"), deadline: Date.now() + 80_000,
    });
    return NextResponse.json({ ok: true, ingested: res.ingested, remaining: res.remaining ?? 0 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Chyba synchronizace" }, { status: 500 });
  }
}
