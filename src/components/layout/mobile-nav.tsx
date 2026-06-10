"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Inbox, MessageSquareQuote, FileText, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { title: "Přehled", href: "/dashboard", icon: LayoutDashboard },
  { title: "Pošta", href: "/inbox", icon: Inbox },
  { title: "Poptávky", href: "/inquiries", icon: MessageSquareQuote },
  { title: "Nabídky", href: "/quotes", icon: FileText },
  { title: "Zakázky", href: "/orders", icon: ClipboardList },
];

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-center justify-around border-t bg-background/95 backdrop-blur-md md:hidden">
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
    </nav>
  );
}
