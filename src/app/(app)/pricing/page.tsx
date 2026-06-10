import Link from "next/link";
import { ArrowRight, Calculator, SlidersHorizontal, BrainCircuit } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { QuoteStatusBadge } from "@/components/status-badge";
import { IntegrationSettingsEditor } from "@/components/integration-settings-editor";
import { getQuotes } from "@/lib/data/queries";
import { getIntegrationSettingsMeta } from "@/lib/data/settings-data";
import { getRecentPricingCalculations } from "@/lib/data/pricing-data";
import { formatCZK, relativeTime } from "@/lib/utils";

export default async function PricingPage() {
  const [quotes, settings, calculations] = await Promise.all([
    getQuotes(),
    getIntegrationSettingsMeta(),
    getRecentPricingCalculations(15),
  ]);
  const waiting = quotes.filter((q) => q.status === "Návrh AI" || q.status === "Ke schválení");
  const pricingParams = settings.filter((s) => s.category === "pricing");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nacenění"
        description="AI nacení v plném rozsahu: polotovar, materiál, operace s časy, složitost, sériovost, strategie 1–10, termín i ochrana proti cenovým výkyvům. Ty kontroluješ a koriguješ — systém se učí."
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
            <BrainCircuit className="h-4 w-4 text-muted-foreground" /> Historie kalkulací (samoučení)
          </CardTitle>
          <CardDescription>
            Každé nacenění se ukládá. Korigované kalkulace mají při dalším nacenění stejného dílu přednost
            a drží cenu v pásmu (ochrana proti výkyvům).
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Výkres</TableHead>
                <TableHead>Zákazník</TableHead>
                <TableHead>Materiál</TableHead>
                <TableHead className="text-right">Kusů</TableHead>
                <TableHead className="text-right">Cena / ks</TableHead>
                <TableHead className="text-right">Marže</TableHead>
                <TableHead className="text-right">Termín</TableHead>
                <TableHead>Stav</TableHead>
                <TableHead>Kdy</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {calculations.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                    Zatím žádné kalkulace — první nacenění se sem uloží automaticky.
                  </TableCell>
                </TableRow>
              )}
              {calculations.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.drawing_number || "—"}</TableCell>
                  <TableCell>{c.customer_name || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{c.material || "—"}</TableCell>
                  <TableCell className="text-right">{c.quantity}</TableCell>
                  <TableCell className="text-right font-medium">
                    {c.corrected && c.user_unit_price
                      ? <>{formatCZK(Number(c.user_unit_price))} <span className="text-xs text-muted-foreground line-through">{c.unit_price ? formatCZK(Number(c.unit_price)) : ""}</span></>
                      : c.unit_price ? formatCZK(Number(c.unit_price)) : "—"}
                  </TableCell>
                  <TableCell className="text-right">{c.user_margin_percent ?? c.margin_percent ?? "—"} %</TableCell>
                  <TableCell className="text-right">{c.user_lead_time_days ?? c.lead_time_days ?? "—"} d</TableCell>
                  <TableCell>
                    {c.corrected
                      ? <Badge variant="warning">korigováno</Badge>
                      : <Badge variant="secondary">AI {c.confidence != null ? `${Math.round(Number(c.confidence) * 100)} %` : ""}</Badge>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{relativeTime(c.created_at)}</TableCell>
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
            Sazby (stroj, programování, seřizování, kontrola, manipulace), marže, cenová strategie 1–10, vytížení výroby,
            přirážky materiálu, limit cenového skoku a termínové přirážky. Změna platí okamžitě pro další nacenění.
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
