import type { Metadata } from "next";
import { requireFeature } from "@/lib/auth/session";
import { listPurchaseOrders } from "@/lib/data/purchasing";
import { todayIso } from "@/lib/jobs/mapping";
import { PurchaseOrdersBoard } from "@/components/jobs/purchasing/purchase-orders-board";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Objednávky dodavatelům" };

type Search = Promise<Record<string, string | string[] | undefined>>;

/** Objednávky dodavatelům napříč zakázkami — stavy, hledání, PDF, odeslání. Jen s právem na nákupní ceny. */
export default async function PurchasingPage({ searchParams }: { searchParams: Search }) {
  await requireFeature("margins");
  const sp = await searchParams;
  const items = await listPurchaseOrders();
  return (
    <PurchaseOrdersBoard
      items={items}
      today={todayIso()}
      initialFilter={typeof sp.stav === "string" ? sp.stav : undefined}
      initialQuery={typeof sp.q === "string" ? sp.q : undefined}
    />
  );
}
