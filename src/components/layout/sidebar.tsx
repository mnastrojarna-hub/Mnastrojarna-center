"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/logo";
import { activeNavHref, matchesNavPath, navForFeatures } from "@/lib/nav";
import type { Feature } from "@/lib/auth/permissions";
import type { BadgeCounts } from "@/lib/data/types";
import { cn } from "@/lib/utils";

export function isActivePath(pathname: string, href: string): boolean {
  return matchesNavPath(pathname, href);
}

export function Sidebar({
  counts,
  features,
  userName,
  roleLabel,
}: {
  counts?: Partial<BadgeCounts>;
  features: Feature[];
  userName?: string;
  roleLabel?: string;
}) {
  const pathname = usePathname();
  const badgeCounts: Record<string, number | undefined> = counts ?? {};
  const sections = navForFeatures(features);
  const activeHref = activeNavHref(pathname, sections.flatMap((s) => s.items.map((i) => i.href)));

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r bg-sidebar md:flex">
      <div className="flex h-14 items-center px-5">
        <Link href="/orders" aria-label="Kniha zakázek">
          <Logo subtitle="CNC Sales OS" />
        </Link>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto scrollbar-thin px-3 py-3">
        {sections.map((section, i) => (
          <div key={section.label ?? i} className="space-y-0.5">
            {section.label && (
              <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {section.label}
              </div>
            )}
            {section.items.map((item) => {
              const active = item.href === activeHref;
              const count = item.badgeKey ? badgeCounts[item.badgeKey] : undefined;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.description}
                  className={cn(
                    "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    item.primary && !active && "bg-primary/5 text-foreground ring-1 ring-primary/15",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-sidebar-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
                      active ? "bg-primary/15" : "bg-background/60 group-hover:bg-background",
                    )}
                  >
                    <item.icon className={cn("h-4 w-4", item.color)} />
                  </span>
                  <span className="flex-1 truncate">{item.title}</span>
                  {count ? (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                        active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {count}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {userName && (
        <div className="border-t p-3">
          <div className="rounded-lg bg-muted/60 px-3 py-2 text-xs">
            <div className="truncate font-medium text-foreground">{userName}</div>
            {roleLabel && <div className="text-muted-foreground">{roleLabel}</div>}
          </div>
        </div>
      )}
    </aside>
  );
}
