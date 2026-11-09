import { NextResponse } from "next/server";
import { apiRequire } from "@/lib/auth/session";
import { touchActivity } from "@/lib/data/activity";

export const dynamic = "force-dynamic";

/**
 * Tep poslední aktivity (9. 11.): POST { path } po skutečné akci uživatele (kliknutí / klávesa), nejvýš 1× za minutu
 * (src/components/activity-heartbeat.tsx). Vždy jen pro přihlášeného uživatele (cizí řádek nejde).
 * Odpověď je vždy 200 { ok } — tep je jen doplněk: odhlášení / chyba nesmí v prohlížeči hlásit chybný požadavek.
 */
export async function POST(req: Request) {
  const auth = await apiRequire();
  if (auth instanceof NextResponse) return NextResponse.json({ ok: false });
  let path: unknown = null;
  try {
    path = ((await req.json()) as { path?: unknown } | null)?.path ?? null;
  } catch {
    // bez těla = bez stránky
  }
  return NextResponse.json({ ok: await touchActivity(auth.user.id, path) });
}
