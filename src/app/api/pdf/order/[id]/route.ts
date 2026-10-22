import { NextResponse } from "next/server";
import { apiRequire } from "@/lib/auth/session";
import { isUuid } from "@/lib/jobs/mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Starší odkaz „faktura / dodací list ze zakázky" (?type=faktura|dodaci-list).
 * Doklady se dnes skládají z karty zakázky → přesměruje na /api/pdf/job/<id>,
 * který používá stejné šablony jako vystavené doklady.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiRequire("documents");
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Zakázka nenalezena." }, { status: 404 });
  const url = new URL(req.url);
  const raw = (url.searchParams.get("type") ?? "").replace("_", "-");
  const type = ["nabidka", "potvrzeni", "dodaci-list", "faktura"].includes(raw) ? raw : "faktura";
  const target = new URL(`/api/pdf/job/${id}`, url.origin);
  target.searchParams.set("type", type);
  if (url.searchParams.get("download") === "1") target.searchParams.set("download", "1");
  return NextResponse.redirect(target, 307);
}
