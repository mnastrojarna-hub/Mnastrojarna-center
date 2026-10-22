import { NextResponse } from "next/server";

/**
 * Společné pro API „Vyfotit doklad": jen požadavky z vlastní aplikace (Origin = host)
 * a JSON tělo. Přístup a oprávnění kontroluje capture-service.
 */

export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // stejný původ bez hlavičky (starší prohlížeče, server)
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Načte JSON tělo; při chybě vrátí odpověď 4xx. */
export async function readJsonBody(req: Request): Promise<{ body: Record<string, unknown> } | NextResponse> {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "Požadavek z cizí stránky." }, { status: 403 });
  try {
    const body = (await req.json()) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("bad");
    return { body: body as Record<string, unknown> };
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatný požadavek." }, { status: 400 });
  }
}

/** ok → 200, jinak 400 (chyba je vždy česky v těle). */
export function respond<T extends { ok: boolean }>(res: T): NextResponse {
  return NextResponse.json(res, { status: res.ok ? 200 : 400, headers: { "Cache-Control": "no-store" } });
}
