import type { Metadata } from "next";
import { requireFeature } from "@/lib/auth/session";
import { listPurchaseOrders } from "@/lib/data/purchasing";
import { todayIso } from "@/lib/jobs/mapping";
import { fetchPurchaseOrderEvents } from "@/components/jobs/purchasing/activity-data";
import { PurchaseOrdersBoard } from "@/components/jobs/purchasing/purchase-orders-board";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Objednávky dodavatelům" };

type Search = Promise<Record<string, string | string[] | undefined>>;

/** Objednávky dodavatelům napříč zakázkami — stavy, hledání, PDF, odeslání. Jen s právem na nákupní ceny. */
export default async function PurchasingPage({ searchParams }: { searchParams: Search }) {
  await requireFeature("margins");
  const sp = await searchParams;
  const items = await listPurchaseOrders();
  const events = await fetchPurchaseOrderEvents(items.map((po) => po.id));
  return (
    <PurchaseOrdersBoard
      items={items}
      events={events}
      today={todayIso()}
      initialFilter={typeof sp.stav === "string" ? sp.stav : undefined}
      initialQuery={typeof sp.q === "string" ? sp.q : undefined}
    />
  );
}
