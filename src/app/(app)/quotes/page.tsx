import Link from "next/link";
import { Plus, Sparkles, FileText } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { QuoteStatusBadge } from "@/components/status-badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { getQuotes } from "@/lib/data/queries";
import { formatCZK, formatDate } from "@/lib/utils";

export default async function QuotesPage() {
  const quotes = await getQuotes();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Poptávky & Nabídky"
        description="AI z poptávky vytvoří koncept nabídky — ty jen doplníš cenu a schválíš."
        actions={
          <Button>
            <Plus className="h-4 w-4" /> Nová nabídka
          </Button>
        }
      />

      <Card className="border-primary/30 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" /> AI právě připravila 1 nový koncept
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div className="text-sm text-muted-foreground">
            <b className="text-foreground">NAB-2026-119</b> pro Strojmetal a.s. — 50 ks dílu VK-2291,
            materiál 1.2379. Doplň cenu a odešli.
          </div>
          <Button size="sm">
            <FileText className="h-4 w-4" /> Otevřít koncept
          </Button>
        </CardContent>
      </Card>

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
                <TableRow key={q.id} className="cursor-pointer">
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
