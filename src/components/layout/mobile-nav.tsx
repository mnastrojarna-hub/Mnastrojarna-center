"use client";

import * as React from "react";
import Link from "next/link";
import { RememberedLink } from "@/components/nav/remembered-link";
import { usePathname } from "next/navigation";
import { ClipboardList, Inbox, MessageSquareQuote, Camera, Menu, Moon, Sun, LogOut, Loader2 } from "lucide-react";
import { useTheme } from "next-themes";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { AutomationModeToggle } from "@/components/automation-mode-toggle";
import { signOutEverywhere } from "@/components/layout/sign-out";
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

/** Posun (px) jedním směrem, po kterém se lišta schová / ukáže, a pásmo nahoře, kde je vždy vidět. */
export const NAV_HIDE_AFTER = 24;
export const NAV_SHOW_AFTER = 12;
export const NAV_TOP_ZONE = 56;

export interface NavScrollState {
  hidden: boolean;
  /** Posun nasbíraný jedním směrem (+ dolů, − nahoru). */
  acc: number;
}

/**
 * Lišta při posunu (majitel 7. 11.: „dole mi furt překáží menu"): dolů → schovat, nahoru → ukázat,
 * nahoře na stránce vždy vidět. `top` = nová poloha posunu, `prevTop` = předchozí, `max` = konec obsahu
 * (pružení na konci stránky na iOS lištu nevrací).
 */
export function navScrollStep(state: NavScrollState, prevTop: number, top: number, max: number): NavScrollState {
  const t = Math.min(Math.max(0, top), Math.max(0, max));
  const p = Math.min(Math.max(0, prevTop), Math.max(0, max));
  if (t <= NAV_TOP_ZONE) return { hidden: false, acc: 0 };
  const d = t - p;
  if (d === 0) return state;
  const acc = Math.sign(d) === Math.sign(state.acc) ? state.acc + d : d;
  if (acc >= NAV_HIDE_AFTER) return { hidden: true, acc };
  if (acc <= -NAV_SHOW_AFTER) return { hidden: false, acc };
  return { hidden: state.hidden, acc };
}

/** Posun, který lištu neřídí: dialogy a vyskakovací menu (lištu stejně překrývají), malé vnitřní okénka. */
function ignoredScroller(el: Element): boolean {
  if (el.clientHeight < 160) return true;
  return Boolean(el.closest("[role=dialog], [role=alertdialog], [data-radix-popper-content-wrapper], [role=menu], [role=listbox], nav"));
}

/**
 * Schovávání lišty: poslouchá posun <main> i vnitřních panelů (zachycením — posun prvků nebublá),
 * schová ji i pod otevřeným dialogem / prohlížečem dokumentu (zámek posunu Radixu na <body>).
 * Stav je i na <html data-mobile-nav> (CSS proměnná --mn-nav-offset pro přilepené prvky nad lištou).
 */
export function useAutoHideNav(pathname: string): { hidden: boolean; overlay: boolean; show: () => void } {
  const [state, setState] = React.useState<NavScrollState>({ hidden: false, acc: 0 });
  const [overlay, setOverlay] = React.useState(false);
  const last = React.useRef(new WeakMap<Element, number>());

  React.useEffect(() => {
    const onScroll = (e: Event) => {
      const el = e.target;
      if (!(el instanceof Element) || ignoredScroller(el)) return;
      const top = el.scrollTop;
      const prev = last.current.get(el);
      last.current.set(el, top);
      if (prev === undefined || prev === top) return; // první událost prvku / jen vodorovný posun
      const max = el.scrollHeight - el.clientHeight;
      setState((s) => {
        const n = navScrollStep(s, prev, top, max);
        return n.hidden === s.hidden && n.acc === s.acc ? s : n;
      });
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", onScroll, { capture: true });
  }, []);

  // otevřený dialog / prohlížeč (Radix zamkne posun body) → lišta pryč
  React.useEffect(() => {
    const body = document.body;
    const sync = () => setOverlay(body.hasAttribute("data-scroll-locked"));
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(body, { attributes: true, attributeFilter: ["data-scroll-locked"] });
    return () => mo.disconnect();
  }, []);

  // jiná stránka → lišta zase vidět
  React.useEffect(() => {
    setState({ hidden: false, acc: 0 });
  }, [pathname]);

  const hidden = state.hidden || overlay;
  React.useEffect(() => {
    const root = document.documentElement;
    if (hidden) root.setAttribute("data-mobile-nav", "hidden");
    else root.removeAttribute("data-mobile-nav");
  }, [hidden]);
  React.useEffect(() => () => document.documentElement.removeAttribute("data-mobile-nav"), []);

  const show = React.useCallback(() => setState({ hidden: false, acc: 0 }), []);
  return { hidden, overlay, show };
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
 * Na konci Menu účet: kdo je přihlášen, motiv, režim AI (super admin) a Odhlásit — horní lišta
 * je na telefonu jen hledání (R072).
 */
export function MobileNav({ features, counts, user }: {
  features: Feature[];
  counts?: Partial<BadgeCounts> | null;
  user?: { fullName: string; roleLabel: string } | null;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const sections = navForFeatures(features);
  const activeHref = activeNavHref(pathname, sections.flatMap((s) => s.items.map((i) => i.href)));
  const live = useMailLive();
  const badgeCounts: Record<string, number | undefined> = { ...(counts ?? {}), ...(live.unread !== null ? { inbox: live.unread } : {}) };
  const menuCount = mobileMenuCount(features, counts);
  const unread = badgeCounts.inbox ?? 0;

  React.useEffect(() => setMenuOpen(false), [pathname]);
  const bar = useAutoHideNav(pathname);

  const items = [
    { title: "Zakázky", href: "/orders", icon: ClipboardList, feature: "orders" as Feature },
    { title: "Poptávky", href: "/inquiries", icon: MessageSquareQuote, feature: "workflow" as Feature },
  ].filter((i) => features.includes(i.feature));
  const mail = features.includes("mail");

  return (
    <>
      <nav
        className={cn(
          "fixed inset-x-0 bottom-0 z-30 flex h-[calc(4rem+env(safe-area-inset-bottom))] items-center justify-around border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden",
          "motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out",
          bar.hidden && "pointer-events-none translate-y-full",
        )}
        data-testid="mobile-nav"
        data-hidden={bar.hidden ? "1" : undefined}
        onFocusCapture={bar.show}
      >
        {items.map((item) => {
          const active = matchesNavPath(pathname, item.href);
          return (
            <RememberedLink
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-1 px-3 py-1 text-[10px] font-medium",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.title}
            </RememberedLink>
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
        <DialogContent className="bottom-0 top-auto max-h-[85dvh] translate-y-0 overflow-y-auto rounded-b-none p-4 sm:bottom-auto sm:top-[10%] sm:rounded-b-xl">
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
                      <RememberedLink
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
                      </RememberedLink>
                    );
                  })}
                </div>
              </div>
            ))}
            <MenuAccount user={user ?? null} automation={features.includes("dashboard")} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Konec mobilního Menu: přihlášený uživatel, motiv, režim AI (super admin), Odhlásit. */
function MenuAccount({ user, automation }: { user: { fullName: string; roleLabel: string } | null; automation: boolean }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const [leaving, start] = React.useTransition();
  const dark = mounted && resolvedTheme === "dark";
  return (
    <div className="space-y-2 border-t pt-3" data-testid="mobile-menu-account">
      <div className="pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">Účet</div>
      {user && (
        <p className="truncate text-sm">
          <span className="font-medium">{user.fullName}</span> <span className="text-muted-foreground">· {user.roleLabel}</span>
        </p>
      )}
      {automation && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">Režim AI</span>
          <AutomationModeToggle />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setTheme(dark ? "light" : "dark")}
          className="flex min-h-11 items-center gap-2 rounded-lg border p-2.5 text-sm font-medium hover:bg-accent"
          data-testid="mobile-menu-theme"
        >
          {dark ? <Sun className="h-4 w-4 shrink-0 text-amber-500" /> : <Moon className="h-4 w-4 shrink-0 text-indigo-500" />}
          <span className="truncate">{dark ? "Světlý motiv" : "Tmavý motiv"}</span>
        </button>
        <button
          type="button"
          onClick={() => start(signOutEverywhere)}
          disabled={leaving}
          className="flex min-h-11 items-center gap-2 rounded-lg border border-destructive/30 p-2.5 text-sm font-medium text-destructive hover:bg-destructive/5 disabled:opacity-60"
          data-testid="mobile-menu-signout"
        >
          {leaving ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <LogOut className="h-4 w-4 shrink-0" />}
          <span className="truncate">Odhlásit se</span>
        </button>
      </div>
    </div>
  );
}
