import { Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { OrderBook } from "@/components/order-book";
import { orderStatusOrder } from "@/lib/mock-data";
import { getOrders } from "@/lib/data/queries";

export default async function OrdersPage() {
  const orders = await getOrders();
  const countByStatus = (status: string) => orders.filter((o) => o.status === status).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kniha zakázek"
        description="Výrobní tok od přijetí po dodání — technologie, místo výroby, termíny a doklady na jednom místě."
        actions={
          <Button>
            <Plus className="h-4 w-4" /> Nová zakázka
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {orderStatusOrder.map((status) => (
          <Card key={status}>
            <CardContent className="p-3">
              <div className="text-2xl font-semibold">{countByStatus(status)}</div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">{status}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <OrderBook orders={orders} />
    </div>
  );
}
