import Link from "next/link";
import { CalendarClock, ReceiptText } from "lucide-react";
import { cn } from "@/lib/utils";

/** Záložky Faktur dodavatelů (jen super admin): Faktury · Platební plán. */
export function SupplierInvoiceTabs({ active }: { active: "faktury" | "plan" }) {
  const tabs = [
    { key: "faktury", href: "/supplier-invoices", label: "Faktury", icon: ReceiptText },
    { key: "plan", href: "/supplier-invoices/plan", label: "Platební plán", icon: CalendarClock },
  ] as const;
  return (
    <nav className="inline-flex rounded-xl border bg-muted/40 p-1" aria-label="Faktury dodavatelů" data-testid="invoice-tabs">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? "page" : undefined}
          className={cn(
            "inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition",
            active === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
          data-testid={`invoice-tab-${t.key}`}
        >
          <t.icon className="h-4 w-4" aria-hidden /> {t.label}
        </Link>
      ))}
    </nav>
  );
}
