import { NextResponse } from "next/server";
import { syncMailbox, type SyncResult } from "@/lib/email/ingest";
import { apiRequire, getAccess } from "@/lib/auth/session";
import { selectMailboxesToSync } from "@/lib/email/visibility";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";

// IMAP klient vyžaduje Node runtime
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Ruční synchronizace pošty: super admin stáhne všechny schránky (včetně
 * globálního účtu), ostatní jen své vlastní schránky.
 */
export async function POST() {
  const auth = await apiRequire("mail");
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;
  const { can } = await getAccess();

  if (can("mail_all")) {
    return NextResponse.json(await syncMailbox({ limit: 20 }));
  }

  const none: SyncResult = {
    source: "none",
    configured: false,
    fetched: 0,
    ingested: 0,
    mailboxes: 0,
    message: "Nemáš přiřazenou e-mailovou schránku — požádej super admina.",
  };
  if (!isSupabaseConfigured()) return NextResponse.json(none);

  try {
    const db = await createOperatorClient();
    const { data, error } = await db.from("mailboxes").select("id, owner_id, active").eq("owner_id", user.id);
    if (error) return NextResponse.json({ ...none, message: error.message }, { status: 500 });
    const selection = selectMailboxesToSync(
      { userId: user.id, all: false },
      (data ?? []) as { id: string; owner_id: string | null; active: boolean | null }[],
    );
    if (selection.kind !== "own") return NextResponse.json(none);
    return NextResponse.json(await syncMailbox({ mailboxIds: selection.mailboxIds, limit: 20 }));
  } catch (err) {
    return NextResponse.json(
      { ...none, configured: true, message: err instanceof Error ? err.message : "Chyba synchronizace" },
      { status: 500 },
    );
  }
}
