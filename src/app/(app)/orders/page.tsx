import { PageHeader } from "@/components/page-header";
import { OrderBook } from "@/components/order-book";
import { getOrders } from "@/lib/data/queries";

// Dočasná podoba — nahradí ji nová Kniha zakázek (components/jobs).
export default async function OrdersPage() {
  const orders = await getOrders();
  return (
    <div className="space-y-6">
      <PageHeader title="Kniha zakázek" description="Všechny zakázky na jednom místě." />
      <OrderBook orders={orders} />
    </div>
  );
}
