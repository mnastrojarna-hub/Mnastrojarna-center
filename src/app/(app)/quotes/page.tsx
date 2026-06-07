import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { QuoteStatusBadge } from "@/components/status-badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { getQuotes } from "@/lib/data/queries";
import { AiPricingPanel } from "@/components/ai-pricing-panel";
import { formatCZK, formatDate } from "@/lib/utils";

export default async function QuotesPage() {
  const quotes = await getQuotes();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Poptávky & Nabídky"
        description="AI z poptávky (i z přílohy) ocení a vytvoří nabídku — ty doplníš/schválíš."
      />

      <AiPricingPanel />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Číslo</TableHead>
                <TableHead>Zákazník</TableHead>
                <TableHead>Výkres</TableHead>
                <TableHead className="text-right">Ks</TableHead>
                <TableHead>Stav</TableHead>
                <TableHead className="text-right">Hodnota</TableHead>
                <TableHead>Vytvořeno</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {quotes.map((q) => (
                <TableRow key={q.id}>
                  <TableCell className="font-medium">{q.number}</TableCell>
                  <TableCell>{q.customer}</TableCell>
                  <TableCell>
                    <Link href="/drawings" className="text-primary hover:underline">
                      {q.drawing}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">{q.qty}</TableCell>
                  <TableCell>
                    <QuoteStatusBadge status={q.status} />
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {q.value ? formatCZK(q.value) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(q.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
