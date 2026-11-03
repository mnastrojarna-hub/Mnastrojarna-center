"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen, Settings } from "lucide-react";
import { Logo } from "@/components/logo";
import { activeNavHref, matchesNavPath, navForFeatures } from "@/lib/nav";
import type { Feature } from "@/lib/auth/permissions";
import type { BadgeCounts } from "@/lib/data/types";
import { cn } from "@/lib/utils";
import { useMailLive } from "@/components/mail/mail-live-provider";
import { useSharedUiPrefs } from "@/components/ui-prefs/use-ui-prefs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function isActivePath(pathname: string, href: string): boolean {
  return matchesNavPath(pathname, href);
}

/** Bez vlastní volby se menu v Poště pod touto šířkou okna samo sbalí na ikony (globals.css .app-sidebar). */
const AUTO_WIDE_QUERY = "(min-width: 1440px)";

/**
 * Stav menu: `collapsed` / `expanded` = volba uživatele (profiles.ui_prefs app.sidebarCollapsed), `auto` =
 * bez volby v Poště (sbalené pod 1440 px — řeší CSS, platí už při vykreslení na serveru); jinde bez volby
 * rozbalené.
 */
export function sidebarMode(pref: boolean | undefined, pathname: string): "collapsed" | "expanded" | "auto" {
  if (pref !== undefined) return pref ? "collapsed" : "expanded";
  return matchesNavPath(pathname, "/inbox") ? "auto" : "expanded";
}

function useWide(): boolean {
  const [hit, setHit] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(AUTO_WIDE_QUERY);
    const on = () => setHit(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return hit;
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
  const live = useMailLive(); // živý počet nepřečtené pošty (bez načtení stránky)
  const badgeCounts: Record<string, number | undefined> = { ...(counts ?? {}), ...(live.unread !== null ? { inbox: live.unread } : {}) };
  const sections = navForFeatures(features);
  const activeHref = activeNavHref(pathname, sections.flatMap((s) => s.items.map((i) => i.href)));
  // sbalení menu na ikony — uloží se hned pro uživatele (stejně jako rozložení Pošty)
  const [prefs, setPref] = useSharedUiPrefs(null, {});
  const mode = sidebarMode(prefs["app.sidebarCollapsed"], pathname);
  const wide = useWide();
  const collapsed = mode === "collapsed" || (mode === "auto" && !wide);
  const toggle = () => setPref("app.sidebarCollapsed", !collapsed);
  const toggleLabel = collapsed ? "Rozbalit menu" : "Sbalit menu na ikony";

  /** Sbalené menu: popisek položky jako bublina vpravo (místo textu vedle ikony). */
  const tip = (node: React.ReactElement, text: string) =>
    collapsed ? (
      <Tooltip>
        <TooltipTrigger asChild>{node}</TooltipTrigger>
        <TooltipContent side="right">{text}</TooltipContent>
      </Tooltip>
    ) : node;

  return (
    <aside
      className="app-sidebar hidden shrink-0 flex-col border-r bg-sidebar md:flex"
      data-sidebar={mode}
      data-collapsed={collapsed ? "1" : "0"}
      data-testid="app-sidebar"
    >
      <div className="sb-header flex h-14 items-center px-5">
        <Link href="/orders" aria-label="Kniha zakázek">
          <Logo subtitle="CNC Sales OS" className="sb-logo" />
        </Link>
      </div>

      <nav className="sb-nav flex-1 space-y-5 overflow-y-auto overflow-x-hidden scrollbar-thin px-3 py-3" aria-label="Hlavní menu">
        {sections.map((section, i) => (
          <div key={section.label ?? i} className="sb-section space-y-0.5">
            {section.label && (
              <div className="sb-section-label px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {section.label}
              </div>
            )}
            {section.items.map((item) => {
              const active = item.href === activeHref;
              const count = item.badgeKey ? badgeCounts[item.badgeKey] : undefined;
              return (
                <React.Fragment key={item.href}>
                  {tip(
                    <Link
                      href={item.href}
                      title={collapsed ? undefined : item.description}
                      aria-label={collapsed ? (count ? `${item.title} (${count})` : item.title) : undefined}
                      className={cn(
                        "sb-link group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
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
                      <span className="sb-label flex-1 truncate">{item.title}</span>
                      {count ? (
                        <span
                          className={cn(
                            "sb-count rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                            active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                          )}
                        >
                          {count}
                        </span>
                      ) : null}
                    </Link>,
                    count ? `${item.title} · ${count}` : item.title,
                  )}
                </React.Fragment>
              );
            })}
          </div>
        ))}
      </nav>

      {/* pb-11: na desktopu přes spodek obrazovky leží lišta Debug (fixed, ~36 px) — jinak by odkaz zakryla */}
      <div className="sb-footer space-y-1 border-t px-3 pb-11 pt-2">
        {tip(
          <button
            type="button"
            onClick={toggle}
            aria-label={toggleLabel}
            aria-pressed={collapsed}
            title={collapsed ? undefined : toggleLabel}
            className="sb-toggle flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            data-testid="sidebar-toggle"
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4 shrink-0" /> : <PanelLeftClose className="h-4 w-4 shrink-0" />}
            <span className="sb-label truncate">Sbalit menu</span>
          </button>,
          toggleLabel,
        )}
        {userName && tip(
          // Můj účet (heslo, schránka) — klik na jméno, ne jen menu pod avatarem
          <Link
            href="/account"
            title={collapsed ? undefined : "Můj účet — heslo, e-mailová schránka, podpis"}
            aria-label={collapsed ? `Můj účet — ${userName}` : undefined}
            data-testid="sidebar-account"
            className="sb-account flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs transition-colors hover:bg-accent"
          >
            <span className="sb-label min-w-0 flex-1">
              <span className="block truncate font-medium text-foreground">{userName}</span>
              {roleLabel && <span className="block text-muted-foreground">{roleLabel}</span>}
            </span>
            <Settings className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>,
          `Můj účet — ${userName}`,
        )}
      </div>
    </aside>
  );
}
