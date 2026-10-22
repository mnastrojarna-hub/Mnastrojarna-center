import type { Metadata } from "next";
import { AlertCircle } from "lucide-react";
import { requireFeature } from "@/lib/auth/session";
import { getCommissionOverview } from "@/lib/data/commissions";
import { CommissionsView } from "@/components/commissions/commissions-view";
import { parsePeriodParam } from "@/components/commissions/model";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Provize" };

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * Provize: obchodník vidí jen svou smlouvu a svá vyúčtování (getCommissionOverview
 * bez „commissions_all" vrací jen jeho data), super admin všechny — přepínač
 * obchodníka a výplata. Vše počítá DB, stránka jen zobrazuje.
 */
export default async function CommissionsPage({ searchParams }: { searchParams: Search }) {
  await requireFeature("commissions");
  const sp = await searchParams;
  const ownerParam = typeof sp.obchodnik === "string" ? sp.obchodnik : null;
  const month = parsePeriodParam(typeof sp.mesic === "string" ? sp.mesic : null);
  const overview = await getCommissionOverview({ ownerId: ownerParam, months: 12 });

  if (!overview) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Provize se nepodařilo načíst — zkontroluj připojení k databázi (Supabase).</span>
      </div>
    );
  }

  return <CommissionsView overview={overview} initialMonth={month} />;
}
