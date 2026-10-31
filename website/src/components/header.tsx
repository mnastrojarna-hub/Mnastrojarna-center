"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NAV, SITE } from "@/content/site";
import { cn } from "@/lib/cn";
import { Icon } from "./icons";
import { Logo } from "./logo";

/** Stránky s tmavým hero — hlavička na nich začíná průhledná se světlým logem. */
const DARK_HERO = (p: string) => p === "/" || p.startsWith("/sluzby") || p === "/strojovy-park" || p === "/3d-prohlizec" || p === "/kvalita" || p === "/o-nas" || p === "/kariera";

export function Header() {
  const pathname = usePathname() || "/";
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
  }, [open]);

  const dark = DARK_HERO(pathname) && !scrolled && !open;
  const solidDark = scrolled || open;

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-500",
        solidDark ? "border-b border-white/10 bg-ink/85 py-3 backdrop-blur-xl" : "py-5",
      )}
    >
      <div className="container flex items-center justify-between gap-6">
        <Link href="/" aria-label="Mnástrojárna – úvod" className="shrink-0">
          <Logo tone={dark || solidDark ? "light" : "dark"} animate glow={dark} className="h-7 w-auto md:h-8" />
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Hlavní navigace">
          {NAV.map((n) => {
            const active = pathname === n.href || pathname.startsWith(n.href + "/");
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "relative rounded-full px-4 py-2 text-[14px] font-medium transition-colors",
                  dark || solidDark ? "text-white/75 hover:text-white" : "text-ink-700/70 hover:text-ink-700",
                  active && (dark || solidDark ? "text-white" : "text-ink-700"),
                )}
              >
                {n.label}
                {active && <span className="absolute inset-x-4 -bottom-0.5 h-px bg-brand" />}
              </Link>
            );
          })}
          <Link
            href="/3d-prohlizec"
            className={cn(
              "ml-1 inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[14px] font-medium transition-colors",
              dark || solidDark ? "text-white/75 hover:text-white" : "text-ink-700/70 hover:text-ink-700",
            )}
          >
            <Icon name="cube" className="h-4 w-4 text-brand" /> 3D prohlížeč
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <Link href="/poptavka" className="btn-primary hidden !px-5 !py-2.5 !text-[14px] sm:inline-flex">
            Poptat výrobu <Icon name="arrow" className="h-4 w-4" />
          </Link>
          <button
            type="button"
            className={cn("rounded-full p-2.5 lg:hidden", dark || solidDark ? "text-white" : "text-ink-700")}
            aria-label={open ? "Zavřít menu" : "Otevřít menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <Icon name={open ? "x" : "menu"} />
          </button>
        </div>
      </div>

      {/* Mobilní menu */}
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 top-[60px] bg-ink transition-all duration-500 lg:hidden",
          open ? "visible opacity-100" : "invisible opacity-0",
        )}
      >
        <div className="bg-grid absolute inset-0 opacity-60" />
        <nav className="container relative flex h-full flex-col gap-1 pt-8" aria-label="Mobilní navigace">
          {[...NAV, { href: "/3d-prohlizec", label: "3D prohlížeč" }].map((n, i) => (
            <Link
              key={n.href}
              href={n.href}
              style={{ transitionDelay: open ? `${80 + i * 50}ms` : "0ms" }}
              className={cn(
                "h-display border-b border-white/10 py-4 text-3xl text-white transition-all duration-500",
                open ? "translate-x-0 opacity-100" : "-translate-x-4 opacity-0",
              )}
            >
              {n.label}
            </Link>
          ))}
          <Link href="/poptavka" className="btn-primary mt-8 w-full !py-4">
            Poptat výrobu <Icon name="arrow" className="h-4 w-4" />
          </Link>
          <p className="mt-6 font-mono text-xs uppercase tracking-widest text-white/40">B2B zakázky od 50 000 Kč · {SITE.hours}</p>
        </nav>
      </div>
    </header>
  );
}
