import { NextResponse } from "next/server";
import { syncMailbox, type SyncResult } from "@/lib/email/ingest";
import { apiRequire, getAccess } from "@/lib/auth/session";
import { isUuidLike, selectMailboxesToSync } from "@/lib/email/visibility";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { userActor } from "@/lib/supabase/actor-headers";
import { processInBackground } from "@/lib/anonymize/runner";

// IMAP klient vyžaduje Node runtime
export const runtime = "nodejs";
// Vercel (Fluid compute): Hobby max 300 s; vlastní limit níže drží odpověď hluboko pod ním
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Nejzazší konec stahování (zbytek zpráv se stáhne při dalším volání — stav se posouvá jen o zpracované).
 * Nová schránka / e-mail se začne jen do konce − 60 s (SYNC_RESERVE_MS) → odpověď do ~160 s, pod maxDuration.
 * Stahuje se CELÁ schránka (INBOX + Odeslané) po dávkách 50 zpráv; odpověď nese `total` / `remaining` /
 * `done` a klient volá znovu, dokud není `done` (průběh „Staženo 340 z 2 150").
 */
const SYNC_BUDGET_MS = 160_000;
const CHUNK = 50;
/**
 * Max. zpráv na schránku za jedno volání — klient volá znovu, dokud není hotovo (průběh se ukazuje
 * po každém volání a žádné volání se neblíží limitu platformy). MAIL_SYNC_MAX_PER_CALL jen pro testy.
 */
const MAX_PER_CALL = Math.min(5000, Math.max(20, Number(process.env.MAIL_SYNC_MAX_PER_CALL) || 400));

/**
 * Ruční synchronizace pošty: super admin stáhne všechny schránky (včetně
 * globálního účtu), ostatní jen své vlastní schránky.
 * Tělo (volitelné): { auto: true } = automatické stažení při otevření Přijaté pošty (přeskočí
 * schránky stažené před < 2 min), { mailboxId } = jen jedna schránka (po uložení schránky).
 */
export async function POST(req: Request) {
  const auth = await apiRequire("mail");
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;
  const { can } = await getAccess();
  let body: { auto?: unknown; mailboxId?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // bez těla = ruční stažení všeho
  }
  const auto = body.auto === true;
  const manual = !auto; // tlačítko / po uložení schránky: přihlásí se i se známým odmítnutým heslem
  const only = typeof body.mailboxId === "string" && isUuidLike(body.mailboxId) ? body.mailboxId : undefined;
  const start = Date.now();
  const deadline = start + SYNC_BUDGET_MS;
  // přílohy e-mailů uložené k zakázkám (výkresy) se anonymizují hned — po odpovědi, ve zbytku času funkce
  // (výběr fronty proběhne až po stažení, takže zachytí i právě uložené přílohy)
  if (isSupabaseConfigured()) processInBackground({ table: "job_files", deadline: start + 270_000, maxFiles: 5, label: "přílohy pošty" });

  if (can("mail_all")) {
    return NextResponse.json(
      await syncMailbox({ limit: CHUNK, maxMessages: MAX_PER_CALL, actor: userActor(user), auto, manual, deadline, ...(only ? { mailboxIds: [only] } : {}) }),
    );
  }

  const none: SyncResult = {
    source: "none",
    configured: false,
    fetched: 0,
    ingested: 0,
    mailboxes: 0,
    done: true,
    message: "Zatím nemáš připojenou e-mailovou schránku — připoj si ji v Můj účet → Moje e-mailová schránka.",
  };
  if (!isSupabaseConfigured()) return NextResponse.json(none);

  try {
    const db = await createOperatorClient({ actor: userActor(user) });
    const { data, error } = await db.from("mailboxes").select("id, owner_id, active").eq("owner_id", user.id);
    if (error) return NextResponse.json({ ...none, message: error.message }, { status: 500 });
    const selection = selectMailboxesToSync(
      { userId: user.id, all: false },
      (data ?? []) as { id: string; owner_id: string | null; active: boolean | null }[],
    );
    if (selection.kind !== "own") return NextResponse.json(none);
    const ids = only ? selection.mailboxIds.filter((id) => id === only) : selection.mailboxIds;
    if (!ids.length) return NextResponse.json(none);
    return NextResponse.json(await syncMailbox({ mailboxIds: ids, limit: CHUNK, maxMessages: MAX_PER_CALL, actor: userActor(user), auto, manual, deadline }));
  } catch (err) {
    return NextResponse.json(
      { ...none, configured: true, message: err instanceof Error ? err.message : "Chyba synchronizace" },
      { status: 500 },
    );
  }
}
