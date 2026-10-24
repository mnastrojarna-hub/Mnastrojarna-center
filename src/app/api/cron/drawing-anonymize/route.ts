import { NextResponse } from "next/server";
import { cronAuthStatus } from "@/lib/email/visibility";
import { createAdminClient, hasServiceKey } from "@/lib/supabase/server";
import { cronActor } from "@/lib/supabase/actor-headers";
import { ANON_TABLES, appOrigin, kick, type AnonDb } from "@/lib/anonymize/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Záchranná síť anonymizace (externí plánovač každých 5 min; Vercel Hobby cron 1× denně nestačí):
 * rozvětví čekající soubory (i backfill s prioritou 9 — denní limit hlídá služba), projde frontu
 * odeslání a uklidí prošlé soubory samostatného nástroje (7 dní). `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(req: Request) {
  const status = cronAuthStatus(req.headers.get("authorization"), process.env.CRON_SECRET);
  if (status === 503) return NextResponse.json({ error: "CRON_SECRET není nastaven — anonymizace na pozadí je vypnutá." }, { status: 503 });
  if (status === 401) return NextResponse.json({ error: "Neautorizováno." }, { status: 401 });
  if (!hasServiceKey()) return NextResponse.json({ error: "Chybí SUPABASE_SECRET_KEY." }, { status: 503 });
  const db = createAdminClient({ actor: cronActor("drawing-anon") }) as AnonDb;
  const origin = appOrigin(req.url);
  const kicked: Record<string, number> = {};
  for (const table of ANON_TABLES) {
    const k = await kick({ origin, table, db });
    kicked[table] = k.kicked;
  }
  const { flushSendQueue } = await import("@/lib/anonymize/send-queue");
  const sendQueue = await flushSendQueue(db).catch((err: unknown) => ({ error: err instanceof Error ? err.message : "Fronta odeslání selhala" }));

  // úklid samostatného nástroje (zdroj + výstup + řádek)
  let expired = 0;
  const { data: old } = await db.from("drawing_anon_adhoc").select("id, storage_path, anon_path, anon_source_path").lt("expires_at", new Date().toISOString()).limit(100);
  const rows = (old ?? []) as { id: string; storage_path: string | null; anon_path: string | null; anon_source_path: string | null }[];
  if (rows.length) {
    const paths = rows.flatMap((r) => [r.storage_path, r.anon_path, r.anon_source_path]).filter((p): p is string => Boolean(p && p.startsWith("capture/")));
    if (paths.length) await db.storage.from("job-files").remove(paths).catch(() => undefined);
    await db.from("drawing_anon_adhoc").delete().in("id", rows.map((r) => r.id));
    expired = rows.length;
  }
  return NextResponse.json({ ok: true, kicked, sendQueue, expired });
}
