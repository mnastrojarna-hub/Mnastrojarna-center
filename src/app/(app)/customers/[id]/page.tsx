import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText, ClipboardList, Mail, FileBox, Users } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { OrderStatusBadge, QuoteStatusBadge, CategoryBadge } from "@/components/status-badge";
import { CustomerPricingProfile } from "@/components/customer-pricing-profile";
import { getCustomerDetail } from "@/lib/data/queries";
import { orderStatusLabel, quoteStatusLabel, emailCategoryLabel } from "@/lib/data/labels";
import { formatCZK, formatDate, relativeTime } from "@/lib/utils";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getCustomerDetail(id);
  if (!detail) notFound();
  const { customer, contacts, quotes, orders, emails, drawings } = detail;
  const revenue = orders.reduce((s, o) => s + Number(o.value ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={customer.name}
        description={`Kompletní historie zákazníka — nabídky, zakázky, komunikace i výkresy.`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/customers"><ArrowLeft className="h-4 w-4" /> Všichni zákazníci</Link>
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="p-4">
          <div className="text-xs font-medium text-muted-foreground">IČO / DIČ</div>
          <div className="mt-1 text-sm font-semibold">{customer.ico ?? "—"} / {customer.dic ?? "—"}</div>
          <div className="mt-1 text-xs text-muted-foreground">{customer.country}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs font-medium text-muted-foreground">Kontakt</div>
          <div className="mt-1 truncate text-sm font-semibold">{customer.email ?? "—"}</div>
          <div className="mt-1 text-xs text-muted-foreground">{customer.phone ?? ""}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs font-medium text-muted-foreground">Obrat (zakázky)</div>
          <div className="mt-1 text-sm font-semibold">{formatCZK(revenue)}</div>
          <div className="mt-1 text-xs text-muted-foreground">{orders.length} zakázek</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs font-medium text-muted-foreground">Obchodník</div>
          <div className="mt-1 text-sm font-semibold">{customer.profiles?.full_name ?? "—"}</div>
        </CardContent></Card>
      </div>

      <CustomerPricingProfile customer={customer} />

      {contacts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-muted-foreground" /> Kontaktní osoby
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {contacts.map((c) => (
              <div key={c.id} className="rounded-lg border p-3 text-sm">
                <div className="font-medium">{c.name}</div>
                <div className="text-xs text-muted-foreground">{[c.position, c.email, c.phone].filter(Boolean).join(" · ")}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-muted-foreground" /> Nabídky ({quotes.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Číslo</TableHead><TableHead>Stav</TableHead><TableHead className="text-right">Cena</TableHead><TableHead>Datum</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {quotes.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">Žádné nabídky.</TableCell></TableRow>
                )}
                {quotes.slice(0, 10).map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className="font-medium">{q.number}</TableCell>
                    <TableCell><QuoteStatusBadge status={quoteStatusLabel[q.status]} /></TableCell>
                    <TableCell className="text-right">{q.total ? formatCZK(Number(q.total)) : "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(q.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-4 w-4 text-muted-foreground" /> Zakázky ({orders.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Číslo</TableHead><TableHead>Stav</TableHead><TableHead className="text-right">Hodnota</TableHead><TableHead>Termín</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {orders.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">Žádné zakázky.</TableCell></TableRow>
                )}
                {orders.slice(0, 10).map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">{o.number}</TableCell>
                    <TableCell><OrderStatusBadge status={orderStatusLabel[o.status]} /></TableCell>
                    <TableCell className="text-right">{formatCZK(Number(o.value ?? 0))}</TableCell>
                    <TableCell className="text-muted-foreground">{o.due_date ? formatDate(o.due_date) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Mail className="h-4 w-4 text-muted-foreground" /> Komunikace ({emails.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 pt-0">
            {emails.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">Žádné propojené e-maily.</p>
            )}
            {emails.slice(0, 10).map((e) => (
              <Link key={e.id} href="/inbox" className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{e.from_name ?? e.from_email}</span>
                    {e.category && <CategoryBadge category={emailCategoryLabel[e.category]} />}
                  </div>
                  <p className="truncate text-sm text-muted-foreground">{e.subject}</p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(e.received_at)}</span>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileBox className="h-4 w-4 text-muted-foreground" /> Výkresy ({drawings.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 pt-0">
            {drawings.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">Žádné výkresy.</p>
            )}
            {drawings.slice(0, 10).map((d) => (
              <div key={d.id} className="flex items-center gap-3 rounded-lg px-2 py-2">
                <span className="text-sm font-medium">{d.drawing_number}</span>
                <Badge variant="secondary">rev. {d.revision}</Badge>
                <span className="text-xs text-muted-foreground">{d.material ?? ""}</span>
                <span className="ml-auto text-xs text-muted-foreground">{formatDate(d.created_at)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
