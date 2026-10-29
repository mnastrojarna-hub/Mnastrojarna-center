import { NextResponse } from "next/server";
import { syncMailbox } from "@/lib/email/ingest";
import { cronAuthStatus } from "@/lib/email/visibility";
import { runFlowReminders } from "@/lib/email/flow-reminders";
import { cronActor } from "@/lib/supabase/actor-headers";

// IMAP klient vyžaduje Node runtime
export const runtime = "nodejs";
// Vercel (Fluid compute): Hobby max 300 s, Pro 800 s — stahování má vlastní limit 220 s (zbytek příště)
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Automatické stahování pošty všech schránek (Vercel Cron / externí plánovač) + plánovač toku
 * (návrh „Stažená — bez odezvy" po 14 dnech čekání na podklady, připomenutí nabídky po 7 dnech).
 * Autor: Systém (plánovač); zápisy AI analýzy pošty jako ✨ AI (e-mail).
 * Vyžaduje hlavičku `Authorization: Bearer <CRON_SECRET>` — middleware cestu
 * pouští bez přihlášení, ochranu dělá tento secret.
 */
export async function GET(req: Request) {
  const status = cronAuthStatus(req.headers.get("authorization"), process.env.CRON_SECRET);
  if (status === 503) {
    return NextResponse.json({ error: "CRON_SECRET není nastaven — automatické stahování je vypnuté." }, { status: 503 });
  }
  if (status === 401) return NextResponse.json({ error: "Neautorizováno." }, { status: 401 });

  try {
    // Na Vercel Hobby běží cron jen 1× denně (vercel.json „17 5 * * *") — „živě" stahuje otevřená aplikace
    // (/api/emails/live každou minutu, MailLiveProvider). Častější plán: Vercel Pro (vercel.json např.
    // „*/5 * * * *"), nebo externí plánovač (cron-job.org, GitHub Actions) volající tuto adresu s hlavičkou
    // Authorization: Bearer <CRON_SECRET>. Stahuje se dávka za dávkou do limitu (kurzor, nic se neztratí);
    // nová schránka / e-mail jen do konce − 60 s (pod maxDuration 300 s, zbývá čas i na plánovač toku).
    // Plánovač se se známým odmítnutým heslem nepřihlašuje (manual: false).
    const result = await syncMailbox({ limit: 100, actor: cronActor("cron-mail"), deadline: Date.now() + 240_000 });
    const flow = await runFlowReminders().catch((err: unknown) => ({ error: err instanceof Error ? err.message : "Plánovač toku selhal" }));
    return NextResponse.json({ ...result, flow });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Chyba synchronizace" },
      { status: 500 },
    );
  }
}
