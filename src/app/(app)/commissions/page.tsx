import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { commissions } from "@/lib/mock-data";
import { formatCZK } from "@/lib/utils";

export default function CommissionsPage() {
  const totalCommission = commissions.reduce((s, c) => s + c.commission, 0);
  const totalRevenue = commissions.reduce((s, c) => s + c.revenue, 0);
  const month = new Intl.DateTimeFormat("cs-CZ", { month: "long", year: "numeric" }).format(new Date());

  return (
    <div className="space-y-6">
      <PageHeader
        title="Provize obchodníků"
        description="Obrat, marže a provize se počítají automaticky dle smlouvy každého obchodníka."
        actions={<Badge variant="secondary">Období: {month}</Badge>}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-medium text-muted-foreground">Celkový obrat</div>
            <div className="mt-1.5 text-2xl font-semibold">{formatCZK(totalRevenue)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-medium text-muted-foreground">Provize celkem</div>
            <div className="mt-1.5 text-2xl font-semibold text-success">{formatCZK(totalCommission)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-medium text-muted-foreground">Obchodníků</div>
            <div className="mt-1.5 text-2xl font-semibold">{commissions.length}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Obchodník</TableHead>
                <TableHead className="text-right">Obrat</TableHead>
                <TableHead className="text-right">Marže</TableHead>
                <TableHead className="text-right">Sazba</TableHead>
                <TableHead className="text-right">Provize</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {commissions.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.owner}</TableCell>
                  <TableCell className="text-right">{formatCZK(c.revenue)}</TableCell>
                  <TableCell className="text-right">{Math.round(c.margin * 100)} %</TableCell>
                  <TableCell className="text-right">{(c.rate * 100).toFixed(1)} %</TableCell>
                  <TableCell className="text-right font-semibold text-success">{formatCZK(c.commission)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
