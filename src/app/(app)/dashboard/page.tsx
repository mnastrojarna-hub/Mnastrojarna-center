import Link from "next/link";
import { ArrowUpRight, ArrowRight, TrendingUp, Clock, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ApprovalQueue } from "@/components/approval-queue";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CategoryBadge, OrderStatusBadge } from "@/components/status-badge";
import { AiConfidence } from "@/components/ai-confidence";
import { getEmails, getOrders, getApprovalQueue, getQuotes, getCommissions } from "@/lib/data/queries";
import { cn, formatCZK, relativeTime } from "@/lib/utils";

export default async function DashboardPage() {
  const [emails, orders, approvals, quotes, commissions] = await Promise.all([
    getEmails(),
    getOrders(),
    getApprovalQueue(),
    getQuotes(),
    getCommissions(),
  ]);

  const recentEmails = emails.filter((e) => e.category !== "Spam").slice(0, 4);
  const activeOrdersAll = orders.filter((o) => o.status !== "Dokončeno");
  const activeOrders = activeOrdersAll.slice(0, 4);

  // Statistiky počítané z reálných dat (konzistentní s tím, co je vidět níže)
  const inquiries = emails.filter((e) => e.category === "Poptávka").length;
  const unread = emails.filter((e) => e.unread && e.category !== "Spam").length;
  const quotesToApprove = quotes.filter((q) => q.status === "Ke schválení").length;
  const activeValue = activeOrdersAll.reduce((s, o) => s + o.value, 0);
  const commissionTotal = commissions.reduce((s, c) => s + c.commission, 0);
  const reminders = emails.filter((e) => e.category === "Upomínka").length;

  const stats = [
    { key: "inquiries", label: "Nové poptávky", value: String(inquiries), delta: `${unread} nepřečtených`, positive: true },
    { key: "orders", label: "Aktivní zakázky", value: String(activeOrdersAll.length), delta: formatCZK(activeValue), positive: true },
    { key: "quotes", label: "Nabídky ke schválení", value: String(quotesToApprove), delta: "čeká na tebe", positive: false },
    { key: "commission", label: "Provize tento měsíc", value: formatCZK(commissionTotal), delta: "aktuální měsíc", positive: true },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Přehled"
        description="Vše podstatné na jedné obrazovce — AI už většinu připravila."
        actions={
          <Button asChild>
            <Link href="/quotes">Nová nabídka</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.key}>
            <CardContent className="p-4">
              <div className="text-xs font-medium text-muted-foreground">{stat.label}</div>
              <div className="mt-1.5 text-2xl font-semibold tracking-tight">{stat.value}</div>
              <div
                className={cn(
                  "mt-1 flex items-center gap-1 text-xs font-medium",
                  stat.positive ? "text-success" : "text-warning",
                )}
              >
                {stat.positive ? <TrendingUp className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                {stat.delta}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <ApprovalQueue initialItems={approvals} />

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Nejnovější pošta</CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link href="/inbox">
                  Otevřít inbox <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-1">
              {recentEmails.map((email) => (
                <Link
                  key={email.id}
                  href="/inbox"
                  className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn("truncate text-sm", email.unread ? "font-semibold" : "font-medium")}>
                        {email.from}
                      </span>
                      <CategoryBadge category={email.category} />
                    </div>
                    <p className="truncate text-sm text-muted-foreground">{email.subject}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-xs text-muted-foreground">{relativeTime(email.receivedAt)}</span>
                    <AiConfidence value={email.aiConfidence} />
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Aktivní zakázky</CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link href="/orders">
                  Vše <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {activeOrders.map((order) => (
                <Link
                  key={order.id}
                  href="/orders"
                  className="flex items-center justify-between gap-2 rounded-lg border p-3 transition-colors hover:border-primary/30"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{order.number}</span>
                      <OrderStatusBadge status={order.status} />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{order.customer}</p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold">{formatCZK(order.value)}</span>
                </Link>
              ))}
            </CardContent>
          </Card>

          {reminders > 0 ? (
            <Card className="border-warning/40 bg-warning/5">
              <CardContent className="flex items-start gap-3 p-4">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
                <div className="text-sm">
                  <div className="font-medium">
                    {reminders} {reminders === 1 ? "upomínka" : reminders < 5 ? "upomínky" : "upomínek"} ve frontě
                  </div>
                  <p className="text-muted-foreground">
                    AI připravila upomínky. Zkontroluj a odešli jedním klikem.
                  </p>
                  <Button asChild variant="link" size="sm" className="h-auto p-0 text-warning">
                    <Link href="/inbox">
                      Zobrazit <ArrowUpRight className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">✓</span>
                Žádné upomínky ani faktury po splatnosti.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
