"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, Inbox, MessageSquareQuote, Camera, Menu } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { activeNavHref, matchesNavPath, navForFeatures } from "@/lib/nav";
import type { Feature } from "@/lib/auth/permissions";
import type { BadgeCounts } from "@/lib/data/types";
import { cn } from "@/lib/utils";
import { useMailLive } from "@/components/mail/mail-live-provider";

/**
 * Číslo na „Menu“ (#25): super admin = vše, co čeká na jeho rozhodnutí (AI přehled: fronta AI + nabídky
 * kolegů ke schválení — „approvals“ je obsahuje bez dvojího počítání), ostatní = moje nabídky
 * (schválené k odeslání + vrácené k přepracování).
 */
export function mobileMenuCount(features: readonly Feature[], counts: Partial<BadgeCounts> | null | undefined): number {
  if (!counts) return 0;
  if (features.includes("quote_approval") && features.includes("dashboard")) return Math.max(0, counts.approvals ?? 0);
  return Math.max(0, counts.quotes ?? 0);
}

function CountBadge({ n, className }: { n: number; className?: string }) {
  if (!n) return null;
  return (
    <span className={cn("min-w-[1.125rem] rounded-full bg-primary px-1 text-center text-[10px] font-bold leading-[1.125rem] text-primary-foreground tabular-nums", className)}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

/**
 * Spodní lišta na mobilu: Zakázky, Poptávky, VYFOTIT doklad (hlavní akce),
 * Pošta a Menu se všemi sekcemi, na které má uživatel právo (s počty jako v postranním menu).
 */
export function MobileNav({ features, counts }: { features: Feature[]; counts?: Partial<BadgeCounts> | null }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const sections = navForFeatures(features);
  const activeHref = activeNavHref(pathname, sections.flatMap((s) => s.items.map((i) => i.href)));
  const live = useMailLive();
  const badgeCounts: Record<string, number | undefined> = { ...(counts ?? {}), ...(live.unread !== null ? { inbox: live.unread } : {}) };
  const menuCount = mobileMenuCount(features, counts);
  const unread = badgeCounts.inbox ?? 0;

  React.useEffect(() => setMenuOpen(false), [pathname]);

  const items = [
    { title: "Zakázky", href: "/orders", icon: ClipboardList, feature: "orders" as Feature },
    { title: "Poptávky", href: "/inquiries", icon: MessageSquareQuote, feature: "workflow" as Feature },
  ].filter((i) => features.includes(i.feature));
  const mail = features.includes("mail");

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-center justify-around border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
        {items.map((item) => {
          const active = matchesNavPath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-1 px-3 py-1 text-[10px] font-medium",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.title}
            </Link>
          );
        })}

        {features.includes("orders") && (
          <Link
            href="/orders?capture=1"
            aria-label="Vyfotit doklad"
            className="-mt-6 flex h-14 w-14 flex-col items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background"
          >
            <Camera className="h-6 w-6" />
          </Link>
        )}

        {mail && (
          <Link
            href="/inbox"
            aria-label={unread ? `Pošta — ${unread} nepřečtených` : "Pošta"}
            className={cn(
              "relative flex flex-col items-center gap-1 px-3 py-1 text-[10px] font-medium",
              pathname.startsWith("/inbox") ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Inbox className="h-5 w-5" />
            Pošta
            <CountBadge n={unread} className="absolute -top-0.5 right-0.5 ring-2 ring-background" />
          </Link>
        )}

        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label={menuCount ? `Menu — ${menuCount} čeká` : "Menu"}
          className="relative flex flex-col items-center gap-1 px-3 py-1 text-[10px] font-medium text-muted-foreground"
        >
          <Menu className="h-5 w-5" aria-hidden />
          Menu
          <CountBadge n={menuCount} className="absolute -top-0.5 right-0.5 ring-2 ring-background" />
        </button>
      </nav>

      <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
        <DialogContent className="bottom-0 top-auto max-h-[85vh] translate-y-0 overflow-y-auto rounded-b-none p-4 sm:bottom-auto sm:top-[10%] sm:rounded-b-xl">
          <DialogTitle className="mb-3">Menu</DialogTitle>
          <div className="space-y-4">
            {sections.map((section, i) => (
              <div key={section.label ?? i}>
                {section.label && (
                  <div className="pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    {section.label}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {section.items.map((item) => {
                    const n = item.badgeKey ? badgeCounts[item.badgeKey] ?? 0 : 0;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          "flex min-h-11 min-w-0 items-center gap-2 rounded-lg border p-2.5 text-sm font-medium",
                          item.href === activeHref ? "border-primary/40 bg-primary/5 text-primary" : "hover:bg-accent",
                        )}
                      >
                        <item.icon className={cn("h-4 w-4 shrink-0", item.color)} />
                        <span className="min-w-0 flex-1 truncate">{item.title}</span>
                        <CountBadge n={n} className="shrink-0" />
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
