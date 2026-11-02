import { NextResponse } from "next/server";
import { apiRequire } from "@/lib/auth/session";
import { getUiPrefs, setUiPref } from "@/lib/data/ui-prefs";
import { sanitizeUiPref } from "@/lib/ui-prefs";

export const dynamic = "force-dynamic";

/**
 * Osobní předvolby vzhledu (šířka seznamu v Poště, sbalené složky …) — ukládají se hned bez potvrzení.
 *   GET                      → { prefs }
 *   POST { key, value }      → { ok, prefs }   (value null = výchozí)
 * Vždy jen pro přihlášeného uživatele (cizí předvolby nejdou). POST jde i s `keepalive` při zavření karty.
 */
export async function GET() {
  const auth = await apiRequire();
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ prefs: await getUiPrefs(auth.user.id) });
}

export async function POST(req: Request) {
  const auth = await apiRequire();
  if (auth instanceof NextResponse) return auth;
  let body: { key?: unknown; value?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatný požadavek." }, { status: 400 });
  }
  const s = sanitizeUiPref(body?.key, body?.value);
  if (!s.ok) return NextResponse.json({ ok: false, error: s.error }, { status: 400 });
  const r = await setUiPref(auth.user.id, s.key, s.value);
  if (!r.ok) return NextResponse.json(r, { status: 500 });
  return NextResponse.json(r);
}
