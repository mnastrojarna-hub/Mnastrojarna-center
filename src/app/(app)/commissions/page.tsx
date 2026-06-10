import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { getCommissions, type CommissionPeriod } from "@/lib/data/queries";
import { formatCZK, cn } from "@/lib/utils";

const PERIODS: { value: CommissionPeriod; label: string }[] = [
  { value: "month", label: "Měsíc" },
  { value: "quarter", label: "Kvartál" },
  { value: "year", label: "Rok" },
];

export default async function CommissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period: raw } = await searchParams;
  const period: CommissionPeriod = raw === "quarter" || raw === "year" ? raw : "month";
  const commissions = await getCommissions(period);
  const totalCommission = commissions.reduce((s, c) => s + c.commission, 0);
  const totalRevenue = commissions.reduce((s, c) => s + c.revenue, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Provize obchodníků"
        description="Obrat, marže a provize se počítají automaticky dle smlouvy každého obchodníka."
        actions={
          <div className="flex gap-1.5">
            {PERIODS.map((p) => (
              <Link
                key={p.value}
                href={`/commissions?period=${p.value}`}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  period === p.value
                    ? "border-primary bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {p.label}
              </Link>
            ))}
          </div>
        }
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
              {commissions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    Zatím žádné provize za toto období.
                  </TableCell>
                </TableRow>
              )}
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
