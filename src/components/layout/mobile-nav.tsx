"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, Inbox, MessageSquareQuote, Camera, Menu } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { navForFeatures } from "@/lib/nav";
import type { Feature } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";

/**
 * Spodní lišta na mobilu: Zakázky, Poptávky, VYFOTIT doklad (hlavní akce),
 * Pošta a Menu se všemi sekcemi, na které má uživatel právo.
 */
export function MobileNav({ features }: { features: Feature[] }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const sections = navForFeatures(features);

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
          const active = pathname.startsWith(item.href);
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
            className={cn(
              "flex flex-col items-center gap-1 px-3 py-1 text-[10px] font-medium",
              pathname.startsWith("/inbox") ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Inbox className="h-5 w-5" />
            Pošta
          </Link>
        )}

        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="flex flex-col items-center gap-1 px-3 py-1 text-[10px] font-medium text-muted-foreground"
        >
          <Menu className="h-5 w-5" />
          Menu
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
                  {section.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border p-2.5 text-sm font-medium",
                        pathname.startsWith(item.href) ? "border-primary/40 bg-primary/5 text-primary" : "hover:bg-accent",
                      )}
                    >
                      <item.icon className={cn("h-4 w-4 shrink-0", item.color)} />
                      <span className="truncate">{item.title}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
