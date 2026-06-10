import Link from "next/link";
import { ArrowRight, Calculator, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { QuoteStatusBadge } from "@/components/status-badge";
import { IntegrationSettingsEditor } from "@/components/integration-settings-editor";
import { getQuotes } from "@/lib/data/queries";
import { getIntegrationSettingsMeta } from "@/lib/data/settings-data";
import { formatCZK, relativeTime } from "@/lib/utils";

export default async function PricingPage() {
  const [quotes, settings] = await Promise.all([getQuotes(), getIntegrationSettingsMeta()]);
  const waiting = quotes.filter((q) => q.status === "Návrh AI" || q.status === "Ke schválení");
  const pricingParams = settings.filter((s) => s.category === "pricing");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nacenění"
        description="Nabídky čekající na cenu. AI navrhne kalkulaci jako technolog — ty ji zkontroluješ, upravíš a AI se z opravy poučí."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/quotes">Pokračovat na Nabídky <ArrowRight className="h-3.5 w-3.5" /></Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Číslo</TableHead>
                <TableHead>Zákazník</TableHead>
                <TableHead>Výkres</TableHead>
                <TableHead className="text-right">Kusů</TableHead>
                <TableHead>Stav</TableHead>
                <TableHead className="text-right">Cena</TableHead>
                <TableHead>Vytvořeno</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {waiting.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                    <Calculator className="mx-auto mb-2 h-8 w-8 opacity-40" />
                    Nic nečeká na nacenění. Nové návrhy sem padají automaticky z poptávek.
                  </TableCell>
                </TableRow>
              )}
              {waiting.map((q) => (
                <TableRow key={q.id}>
                  <TableCell className="font-medium">{q.number}</TableCell>
                  <TableCell>{q.customer}</TableCell>
                  <TableCell className="text-muted-foreground">{q.drawing}</TableCell>
                  <TableCell className="text-right">{q.qty}</TableCell>
                  <TableCell><QuoteStatusBadge status={q.status} /></TableCell>
                  <TableCell className="text-right font-medium">
                    {q.value ? formatCZK(q.value) : <span className="text-warning">doplnit</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{relativeTime(q.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link href="/quotes">Nacenit</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <SlidersHorizontal className="h-4 w-4 text-muted-foreground" /> Parametry kalkulace
          </CardTitle>
          <CardDescription>
            Sazby a marže, se kterými AI počítá. Změna platí okamžitě pro další nacenění.
            Pravidla technologa a naučené korekce najdeš v{" "}
            <Link href="/tuning" className="text-primary hover:underline">Ladění &amp; korekce</Link>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <IntegrationSettingsEditor settings={pricingParams} />
        </CardContent>
      </Card>
    </div>
  );
}
