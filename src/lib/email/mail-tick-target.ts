import "server-only";
import { createAdminClient, hasServiceKey } from "@/lib/supabase/server";
import { appOrigin, internalRunSecret } from "@/lib/anonymize/queue";

/**
 * Adresa a tajemství pro plánovač pošty v databázi (pg_cron → /api/cron/mail-tick). Zapíše je sama
 * aplikace (tajemství tak není v repozitáři); tabulka mail_tick_target je jen pro servisní roli.
 * Zapisuje se jen při změně (paměť procesu).
 */
let written: string | null = null;

export async function ensureMailTickTarget(): Promise<void> {
  if (!hasServiceKey()) return;
  const origin = appOrigin(null);
  const secret = internalRunSecret();
  if (!origin || !secret || /localhost|127\.0\.0\.1/.test(origin)) return;
  const bypass = (process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "").trim() || null;
  const key = `${origin}|${secret}|${bypass ?? ""}`;
  if (written === key) return;
  const { error } = await createAdminClient().from("mail_tick_target").upsert(
    { id: 1, url: `${origin}/api/cron/mail-tick`, secret, bypass, updated_at: new Date().toISOString() } as never,
    { onConflict: "id" },
  );
  if (!error) written = key;
}
