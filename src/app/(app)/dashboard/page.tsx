import Link from "next/link";
import {
  ArrowRight, Inbox, FileText, ClipboardList, Wallet, AlertTriangle,
  CheckCircle2, Circle, Rocket, Mail,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ApprovalQueue } from "@/components/approval-queue";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CategoryBadge, OrderStatusBadge } from "@/components/status-badge";
import { AiConfidence } from "@/components/ai-confidence";
import { getEmails, getOrders, getApprovalQueue, getQuotes, getCommissions } from "@/lib/data/queries";
import { getSetupStatus } from "@/lib/setup/status";
import { getSetting } from "@/lib/settings";
import { cn, formatCZK, relativeTime } from "@/lib/utils";

export default async function DashboardPage() {
  const [emails, orders, approvals, quotes, commissions, setup, companyName] = await Promise.all([
    getEmails(),
    getOrders(),
    getApprovalQueue(),
    getQuotes(),
    getCommissions(),
    getSetupStatus(),
    getSetting("company_name"),
  ]);

  const recentEmails = emails.filter((e) => e.category !== "Spam").slice(0, 4);
  const activeOrdersAll = orders.filter((o) => o.status !== "Dokončeno");
  const activeOrders = activeOrdersAll.slice(0, 4);

  // Statistiky výhradně z reálných dat
  const inquiries = emails.filter((e) => e.category === "Poptávka").length;
  const unread = emails.filter((e) => e.unread && e.category !== "Spam").length;
  const quotesToApprove = quotes.filter((q) => q.status === "Ke schválení" || q.status === "Návrh AI").length;
  const activeValue = activeOrdersAll.reduce((s, o) => s + o.value, 0);
  const commissionTotal = commissions.reduce((s, c) => s + c.commission, 0);
  const reminders = emails.filter((e) => e.category === "Upomínka").length;

  const stats = [
    { label: "Nové poptávky", value: String(inquiries), hint: `${unread} nepřečtených e-mailů`, icon: Inbox, href: "/inbox" },
    { label: "Nabídky k vyřízení", value: String(quotesToApprove), hint: "čekají na cenu / schválení", icon: FileText, href: "/quotes" },
    { label: "Aktivní zakázky", value: String(activeOrdersAll.length), hint: formatCZK(activeValue), icon: ClipboardList, href: "/orders" },
    { label: "Provize tento měsíc", value: formatCZK(commissionTotal), hint: "aktuální měsíc", icon: Wallet, href: "/commissions" },
  ];

  // Kontrolní seznam zprovoznění — zobrazí se, dokud není systém kompletně nastaven
  const checklist = [
    { label: "Připojit Supabase databázi", done: setup.supabase.configured && setup.supabase.secretKeySet, href: "/setup" },
    { label: "Zapnout AI (Claude API klíč)", done: setup.aiConfigured, href: "/setup" },
    { label: "Přidat e-mailovou schránku (servery, porty, heslo)", done: setup.mailboxCount > 0, href: "/settings" },
    { label: "Vyplnit firemní údaje (jdou na nabídky a faktury)", done: Boolean(companyName), href: "/setup" },
  ];
  const setupDone = checklist.every((c) => c.done);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Přehled"
        description="Vše podstatné na jedné obrazovce. Zelená = informace. Červená = odešle e-mail ven."
      />

      {!setupDone && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Rocket className="h-4 w-4 text-primary" /> Dokonči zprovoznění — pak vše pojede samo
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {checklist.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
              >
                {item.done ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className={cn(item.done && "text-muted-foreground line-through")}>{item.label}</span>
                {!item.done && <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" />}
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href}>
            <Card className="h-full transition-colors hover:border-primary/40">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <stat.icon className="h-3.5 w-3.5" /> {stat.label}
                </div>
                <div className="mt-1.5 text-2xl font-semibold tracking-tight">{stat.value}</div>
                <div className="mt-1 text-xs font-medium text-success">{stat.hint}</div>
              </CardContent>
            </Card>
          </Link>
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
              {recentEmails.length === 0 && (
                <div className="space-y-2 py-6 text-center text-sm text-muted-foreground">
                  <Mail className="mx-auto h-7 w-7 opacity-40" />
                  <p>Žádná pošta. Přidej schránku v Nastavení a synchronizuj v Inboxu.</p>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/settings">Nastavit schránku</Link>
                  </Button>
                </div>
              )}
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
              {activeOrders.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Zatím žádné zakázky. Vzniknou automaticky z objednávek v poště,
                  nebo je založ ručně v Knize zakázek.
                </p>
              )}
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
                    AI připravila upomínky. Zkontroluj je výše ve frontě ke schválení.
                  </p>
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

          {/* Vysvětlení barev — ať se zorientuje opravdu každý */}
          <Card>
            <CardContent className="space-y-2 p-4 text-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Jak číst barvy
              </div>
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 shrink-0 rounded-full bg-success" />
                <span><b>Zelená</b> — informace a bezpečná potvrzení. Nic neodejde z firmy.</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 shrink-0 rounded-full bg-primary" />
                <span><b>Červená</b> — tlačítko odešle e-mail zákazníkovi či dodavateli.</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 shrink-0 rounded-full bg-warning" />
                <span><b>Oranžová</b> — čeká na tvoje rozhodnutí.</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
