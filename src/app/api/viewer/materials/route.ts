import { NextResponse } from "next/server";
import { apiRequire } from "@/lib/auth/session";
import { loadPricingCatalog } from "@/lib/data/pricing-data";
import { MATERIALS } from "@/lib/pricing/materials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Materiály pro výpočet hmotnosti v prohlížeči 3D: katalog z Nacenění (DB přepisuje výchozí).
 * Jen klíč, název, skupina a hustota — ceny se ven nedávají. Bez práva na DB katalog výchozí katalog.
 */
export async function GET() {
  const guard = await apiRequire();
  if (guard instanceof NextResponse) return guard;
  const { materials } = await loadPricingCatalog().catch(() => ({ materials: undefined }));
  const list = (materials?.length ? materials : MATERIALS).map((m) => ({ key: m.key, label: m.label, group: m.group, density: m.densityKgDm3 }));
  return NextResponse.json({ materials: list }, { headers: { "Cache-Control": "private, max-age=300" } });
}
