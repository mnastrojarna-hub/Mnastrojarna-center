import { NextResponse } from "next/server";
import { syncMailbox } from "@/lib/email/ingest";
import { apiRequire, getAccess } from "@/lib/auth/session";
import { getUnreadCount } from "@/lib/data/mail";
import { getMailStamp } from "@/lib/data/mail-threads";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { userActor } from "@/lib/supabase/actor-headers";
import { LIVE_FAST_MIN_INTERVAL_MS, LIVE_MIN_INTERVAL_MS } from "@/lib/email/live-poll";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * „Živá" pošta, dokud je aplikace otevřená (MailLiveProvider volá cca každých 60 s, jen viditelná
 * karta, jedna karta za všechny, při chybách s odstupem). Na Vercel Hobby běží cron jen 1× denně —
 * tohle je to, co dělá poštu „real-time".
 *
 * Tělo { sync: true, fast? } → krátké automatické stažení schránek uživatele (super admin: všech) —
 * schránka stažená před < 45 s (otevřená Pošta, fast: < 25 s) se přeskočí, se známým odmítnutým heslem se nepřihlašuje, max. 100
 * zpráv na schránku. Vrací počet nepřečtených (odznak), razítko změny (obnovit seznam) a zbývající
 * zprávy (stahování celé schránky běží dál).
 */
const LIVE_BUDGET_MS = 90_000;

export async function POST(req: Request) {
  const auth = await apiRequire("mail");
  if (auth instanceof NextResponse) return auth;
  let body: { sync?: unknown; fast?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // bez těla = jen počty
  }
  let remaining = 0;
  let ingested = 0;
  let error: string | undefined;
  let allFailed = false;
  if (body.sync === true && isSupabaseConfigured()) {
    try {
      const { can } = await getAccess();
      // otevřená Pošta (fast) kontroluje každých 30 s → schránka stažená před < 25 s se přeskočí;
      // jinak < 45 s (ochrana poskytovatele: nejvýš jedno přihlášení za ~25 s na schránku, ať kontroluje kdokoli)
      const minIntervalMs = body.fast === true ? LIVE_FAST_MIN_INTERVAL_MS : LIVE_MIN_INTERVAL_MS;
      const base = { limit: 50, maxMessages: 100, auto: true, minIntervalMs, actor: userActor(auth.user), deadline: Date.now() + LIVE_BUDGET_MS };
      let ids: string[] | undefined;
      if (!can("mail_all")) {
        const db = await createOperatorClient();
        const { data } = await db.from("mailboxes").select("id, active").eq("owner_id", auth.user.id);
        ids = ((data ?? []) as { id: string; active: boolean | null }[]).filter((m) => m.active !== false).map((m) => m.id);
      }
      if (!ids || ids.length) {
        // super admin: jen schránky (globální účet bez schránky stahuje tlačítko / plánovač)
        const res = await syncMailbox({ ...base, mailboxIds: ids ?? (await allActiveIds()) });
        remaining = res.remaining ?? 0;
        ingested = res.ingested;
        const failed = (res.boxes ?? []).filter((b) => !b.ok && b.skipped !== "auth" && b.skipped !== "incomplete");
        if (failed.length) error = failed.map((b) => b.error).filter(Boolean).join(" · ");
        // odstup v prohlížeči jen když nefunguje nic (jedna rozbitá schránka ostatní nezpomalí)
        const attempted = (res.boxes ?? []).filter((b) => !b.skipped);
        allFailed = attempted.length > 0 && attempted.every((b) => !b.ok);
      }
    } catch (err) {
      error = err instanceof Error ? err.message : "Stažení selhalo.";
      allFailed = true;
    }
  }
  const [unread, stamp] = await Promise.all([getUnreadCount(), getMailStamp()]);
  return NextResponse.json({ unread, stamp, remaining, ingested, allFailed, ...(error ? { error } : {}) });
}

async function allActiveIds(): Promise<string[]> {
  const db = await createOperatorClient();
  const { data } = await db.from("mailboxes").select("id").eq("active", true);
  return ((data ?? []) as { id: string }[]).map((m) => m.id);
}
