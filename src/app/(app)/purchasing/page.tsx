import type { Metadata } from "next";
import { requireFeature } from "@/lib/auth/session";
import { listPurchaseOrders } from "@/lib/data/purchasing";
import { flowWhoFrom, getFlowScope } from "@/lib/data/flow-scope";
import { todayIso } from "@/lib/jobs/mapping";
import { PurchaseOrdersBoard } from "@/components/jobs/purchasing/purchase-orders-board";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Objednávky dodavatelům" };

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * Objednávky dodavatelům napříč zakázkami — stavy, hledání, PDF, odeslání.
 * #25: jen „moje" (super admin všichni / „Jen moje"); bez práva na nákupní ceny server řádky
 * maskuje (bez cen, poznámek, PDF). Stránka se pro všechny („workflow") otevře až s přehledem
 * bez cen a akcí (25-C) — do té doby jen s právem na nákupní ceny.
 */
export default async function PurchasingPage({ searchParams }: { searchParams: Search }) {
  await requireFeature("margins");
  const sp = await searchParams;
  const scope = await getFlowScope(await flowWhoFrom(sp));
  const items = await listPurchaseOrders({}, { scope });
  return (
    <PurchaseOrdersBoard
      items={items}
      today={todayIso()}
      initialFilter={typeof sp.stav === "string" ? sp.stav : undefined}
      initialQuery={typeof sp.q === "string" ? sp.q : undefined}
    />
  );
}
