import type { Metadata } from "next";
import { getAccess, requireFeature } from "@/lib/auth/session";
import { listPurchaseOrders } from "@/lib/data/purchasing";
import { flowWhoFrom, getFlowScope } from "@/lib/data/flow-scope";
import { todayIso } from "@/lib/jobs/mapping";
import { PurchaseOrdersBoard } from "@/components/jobs/purchasing/purchase-orders-board";
import { FlowScopeBar } from "@/components/flow/flow-scope-bar";
import { scopeBarData } from "@/components/flow/flow-scope-copy";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Objednávky dodavatelům" };

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * Objednávky dodavatelům napříč zakázkami — stavy, hledání, PDF, odeslání.
 * #25: pro všechny (workflow), jen „moje" (super admin všichni / „Jen moje"); bez práva na nákupní
 * ceny server řádky maskuje (bez cen, poznámek, PDF) a přehled ukáže „—" bez PDF a akcí.
 */
export default async function PurchasingPage({ searchParams }: { searchParams: Search }) {
  await requireFeature("workflow");
  const { can } = await getAccess();
  const sp = await searchParams;
  const scope = await getFlowScope(await flowWhoFrom(sp));
  const items = await listPurchaseOrders({}, { scope });
  return (
    <PurchaseOrdersBoard
      items={scope?.error ? [] : items}
      today={todayIso()}
      initialFilter={typeof sp.stav === "string" ? sp.stav : undefined}
      initialQuery={typeof sp.q === "string" ? sp.q : undefined}
      canSeePrices={can("margins")}
      scopeBar={<FlowScopeBar scope={scopeBarData(scope)} className="relative mt-4" />}
    />
  );
}
