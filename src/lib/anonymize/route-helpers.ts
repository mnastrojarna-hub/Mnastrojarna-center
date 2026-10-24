import "server-only";
import { NextResponse } from "next/server";
import { apiRequire, getAccess, type Access } from "@/lib/auth/session";
import { createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { userActor, type ActorContext } from "@/lib/supabase/actor-headers";
import { assertJobFileAccess } from "@/lib/jobs/job-file-access";
import type { CurrentUser } from "@/lib/data/current-user";
import { SUBJECT_SELECT, type AnonDb, type AnonTable, type SubjectRow } from "./service";

/**
 * Společné pro routy anonymizace: přihlášení, oprávnění k souboru (stejná pravidla jako otevření
 * dokumentu zakázky), servisní klient s autorem. Bez servisního klíče anonymizace neběží
 * (DB strážce anon_* pouští jen náš server) — vrací 503 s vysvětlením.
 */

export const NO_SERVICE_KEY = "Chybí SUPABASE_SECRET_KEY — anonymizace výkresů běží jen se servisním klíčem.";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function tableParam(v: unknown): AnonTable {
  return v === "drawings" ? "drawings" : v === "drawing_anon_adhoc" || v === "adhoc" ? "drawing_anon_adhoc" : "job_files";
}

export interface AnonGuard {
  user: CurrentUser;
  access: Access;
  actor: ActorContext;
  db: AnonDb;
}

/** Přihlášený uživatel s funkcí (orders / drawings) + servisní klient s jeho autorstvím. */
export async function anonGuard(table: AnonTable = "job_files"): Promise<AnonGuard | NextResponse> {
  const g = await apiRequire(table === "drawings" ? "drawings" : "orders");
  if (g instanceof NextResponse) return g;
  if (!isSupabaseConfigured()) return json({ error: "Supabase není nakonfigurováno." }, 503);
  if (!hasServiceKey()) return json({ error: NO_SERVICE_KEY }, 503);
  const access = await getAccess();
  const actor = userActor(g.user, "rucne");
  return { user: g.user, access, actor, db: createAdminClient({ actor }) as AnonDb };
}

/** Načte řádek subjektu a ověří přístup (job_files: jako otevření dokumentu; adhoc: jen vlastník/super admin). */
export async function loadSubject(guard: AnonGuard, table: AnonTable, id: string, intent: "view" | "edit" | "send" = "view"): Promise<{ row: SubjectRow } | NextResponse> {
  if (!isUuid(id)) return json({ error: "Soubor nenalezen." }, 404);
  if (table === "job_files") {
    const chk = await assertJobFileAccess(guard.db as never, id, guard.access, intent);
    if (!chk.ok) return json({ error: chk.error }, chk.status);
  }
  const { data } = await guard.db.from(table).select(SUBJECT_SELECT[table]).eq("id", id).maybeSingle();
  const row = data as unknown as SubjectRow | null;
  if (!row) return json({ error: "Soubor nenalezen." }, 404);
  if (table === "drawing_anon_adhoc" && row.user_id !== guard.user.id && guard.user.role !== "super_admin") {
    return json({ error: "Soubor nenalezen." }, 404);
  }
  return { row };
}

/** Požadavek z vlastní aplikace (Origin = host). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** JSON tělo (stejný původ). */
export async function readBody(req: Request): Promise<Record<string, unknown> | NextResponse> {
  if (!sameOrigin(req)) return json({ error: "Požadavek z cizí stránky." }, 403);
  try {
    const b = (await req.json()) as unknown;
    if (!b || typeof b !== "object" || Array.isArray(b)) throw new Error("bad");
    return b as Record<string, unknown>;
  } catch {
    return json({ error: "Neplatný požadavek." }, 400);
  }
}

export function idList(v: unknown, max = 200): string[] {
  return (Array.isArray(v) ? v : []).filter(isUuid).slice(0, max);
}
