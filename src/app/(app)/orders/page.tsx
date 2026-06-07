import { Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { OrderStatusBadge } from "@/components/status-badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { orderStatusOrder } from "@/lib/mock-data";
import { getOrders } from "@/lib/data/queries";
import { formatCZK, formatDate } from "@/lib/utils";

export default async function OrdersPage() {
  const orders = await getOrders();
  const countByStatus = (status: string) => orders.filter((o) => o.status === status).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Objednávky"
        description="Zakázky napříč stavy výroby — AI je spárovala s nabídkami a zákazníky."
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

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Číslo</TableHead>
                <TableHead>Zákazník</TableHead>
                <TableHead>Zakázka</TableHead>
                <TableHead>Stav</TableHead>
                <TableHead className="text-right">Hodnota</TableHead>
                <TableHead>Termín</TableHead>
                <TableHead>Obchodník</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-medium">{order.number}</TableCell>
                  <TableCell>{order.customer}</TableCell>
                  <TableCell className="text-muted-foreground">{order.title}</TableCell>
                  <TableCell>
                    <OrderStatusBadge status={order.status} />
                  </TableCell>
                  <TableCell className="text-right font-medium">{formatCZK(order.value)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(order.dueDate)}</TableCell>
                  <TableCell className="text-muted-foreground">{order.owner}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
