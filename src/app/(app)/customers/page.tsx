import { Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { customers } from "@/lib/mock-data";
import { formatCZK } from "@/lib/utils";

export default function CustomersPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Zákazníci (CRM)"
        description="Firmy, kontakty a celá historie komunikace na jednom místě."
        actions={
          <Button>
            <Plus className="h-4 w-4" /> Nový zákazník
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Firma</TableHead>
                <TableHead>IČO</TableHead>
                <TableHead>Země</TableHead>
                <TableHead>Kontakt</TableHead>
                <TableHead className="text-right">Objednávky</TableHead>
                <TableHead className="text-right">Obrat</TableHead>
                <TableHead>Obchodník</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((c) => (
                <TableRow key={c.id} className="cursor-pointer">
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-muted-foreground">{c.ico}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{c.country}</Badge>
                  </TableCell>
                  <TableCell>
                    <div>{c.contact}</div>
                    <div className="text-xs text-muted-foreground">{c.email}</div>
                  </TableCell>
                  <TableCell className="text-right">{c.orders}</TableCell>
                  <TableCell className="text-right font-medium">{formatCZK(c.revenue)}</TableCell>
                  <TableCell className="text-muted-foreground">{c.owner}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
