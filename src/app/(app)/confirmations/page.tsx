import Link from "next/link";
import { ArrowRight, PackageCheck, Mail } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { OrderStatusBadge } from "@/components/status-badge";
import { AiConfidence } from "@/components/ai-confidence";
import { getEmails, getOrders } from "@/lib/data/queries";
import { formatCZK, relativeTime } from "@/lib/utils";

export default async function ConfirmationsPage() {
  const [emails, orders] = await Promise.all([getEmails(), getOrders()]);
  const orderEmails = emails.filter(
    (e) => e.category === "Objednávka" || e.category === "Potvrzení objednávky",
  );
  const newOrders = orders.filter((o) => o.status === "Přijato");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Potvrzení objednávek"
        description="Objednávky z pošty a nové zakázky čekající na potvrzení. AI páruje objednávku s nabídkou a připraví potvrzení — ty jen zkontroluješ."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/orders">Pokračovat na Knihu zakázek <ArrowRight className="h-3.5 w-3.5" /></Link>
          </Button>
        }
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <PackageCheck className="h-4 w-4 text-muted-foreground" /> Nové zakázky k potvrzení
          </CardTitle>
          <CardDescription>Zakázky ve stavu Přijato — potvrzení odejde po schválení ve frontě.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Číslo</TableHead>
                <TableHead>Zákazník</TableHead>
                <TableHead>Popis</TableHead>
                <TableHead className="text-right">Hodnota</TableHead>
                <TableHead>Stav</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {newOrders.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    Nic nečeká na potvrzení.
                  </TableCell>
                </TableRow>
              )}
              {newOrders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.number}</TableCell>
                  <TableCell>{o.customer}</TableCell>
                  <TableCell className="max-w-[260px] truncate text-muted-foreground">{o.title}</TableCell>
                  <TableCell className="text-right font-medium">{formatCZK(o.value)}</TableCell>
                  <TableCell><OrderStatusBadge status={o.status} /></TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link href="/orders">Otevřít</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4 text-muted-foreground" /> Objednávky v poště
          </CardTitle>
          <CardDescription>E-maily, které AI rozpoznala jako objednávku či potvrzení objednávky.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 pt-0">
          {orderEmails.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">Žádné objednávkové e-maily.</p>
          )}
          {orderEmails.map((e) => (
            <Link
              key={e.id}
              href="/inbox"
              className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{e.from}</span>
                  <Badge variant="secondary">{e.category}</Badge>
                </div>
                <p className="truncate text-sm text-muted-foreground">{e.subject}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-xs text-muted-foreground">{relativeTime(e.receivedAt)}</span>
                <AiConfidence value={e.aiConfidence} />
              </div>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
