import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { OrderBook } from "@/components/order-book";
import { QuickAddDialog } from "@/components/quick-add-dialog";
import { createOrder } from "@/app/actions/orders";
import { orderStatusOrder } from "@/lib/data/types";
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
          <QuickAddDialog
            triggerLabel="Nová zakázka"
            title="Nová zakázka"
            action={createOrder}
            fields={[
              { name: "title", label: "Název / popis", required: true, placeholder: "Frézované díly VK-2291" },
              { name: "customer", label: "Zákazník (firma)", placeholder: "Strojmetal a.s." },
              { name: "value", label: "Hodnota (Kč)", type: "number" },
              { name: "dueDate", label: "Termín dodání", type: "date" },
              { name: "technology", label: "Technologie", placeholder: "Frézování 5-osé" },
              { name: "requirements", label: "Specifické požadavky", placeholder: "Tolerance H7, kalení" },
            ]}
          />
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
