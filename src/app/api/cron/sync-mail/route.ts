import { NextResponse } from "next/server";
import { syncMailbox } from "@/lib/email/ingest";
import { cronAuthStatus } from "@/lib/email/visibility";

// IMAP klient vyžaduje Node runtime
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Automatické stahování pošty všech schránek (Vercel Cron / externí plánovač).
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
    const result = await syncMailbox({ limit: 20 });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Chyba synchronizace" },
      { status: 500 },
    );
  }
}
