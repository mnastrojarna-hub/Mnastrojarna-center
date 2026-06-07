import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { QuickAddDialog } from "@/components/quick-add-dialog";
import { createCustomer } from "@/app/actions/crm";
import { getCustomers } from "@/lib/data/queries";
import { formatCZK } from "@/lib/utils";

export default async function CustomersPage() {
  const customers = await getCustomers();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Zákazníci (CRM)"
        description="Firmy, kontakty a celá historie komunikace na jednom místě."
        actions={
          <QuickAddDialog
            triggerLabel="Nový zákazník"
            title="Nový zákazník"
            action={createCustomer}
            fields={[
              { name: "name", label: "Název firmy", required: true, placeholder: "Strojmetal a.s." },
              { name: "ico", label: "IČO", placeholder: "45274649" },
              { name: "dic", label: "DIČ", placeholder: "CZ45274649" },
              { name: "country", label: "Země", placeholder: "CZ" },
              { name: "email", label: "E-mail", type: "email", placeholder: "nakup@firma.cz" },
              { name: "phone", label: "Telefon" },
            ]}
          />
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
              {customers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    Zatím žádní zákazníci. Přidej prvního přes tlačítko Nový zákazník.
                  </TableCell>
                </TableRow>
              )}
              {customers.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-muted-foreground">{c.ico}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{c.country}</Badge>
                  </TableCell>
                  <TableCell>
                    <div>{c.contact}</div>
                    {c.email && c.email !== c.contact && (
                      <div className="text-xs text-muted-foreground">{c.email}</div>
                    )}
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
