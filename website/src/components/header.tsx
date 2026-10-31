"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NAV, SITE } from "@/content/site";
import { cn } from "@/lib/cn";
import { Icon } from "./icons";
import { Logo } from "./logo";

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

  return (
    <header className={cn("fixed inset-x-0 top-0 z-50 transition-all duration-500", scrolled || open ? "py-2.5" : "py-5")}>
      <div className="container">
        <div
          className={cn(
            "flex items-center justify-between gap-6 rounded-full px-3 transition-all duration-500 md:px-4",
            scrolled || open ? "border border-ink-700/10 bg-white/85 py-2 shadow-[0_12px_40px_-20px_rgba(39,36,37,.35)] backdrop-blur-xl" : "border border-transparent py-1",
          )}
        >
          <Link href="/" aria-label="Mnástrojárna – úvod" className="shrink-0 pl-1">
            <Logo tone="dark" animate className="h-7 w-auto md:h-8" />
          </Link>

          <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Hlavní navigace">
            {NAV.map((n) => {
              const active = pathname === n.href || pathname.startsWith(n.href + "/");
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={cn(
                    "relative rounded-full px-4 py-2 text-[14px] font-medium transition-colors",
                    active ? "bg-ink-700/[0.06] text-ink-700" : "text-ink-700/65 hover:text-ink-700",
                  )}
                >
                  {n.label}
                </Link>
              );
            })}
            <Link
              href="/cad"
              className="ml-1 inline-flex items-center gap-2 rounded-full border border-ink-700/10 bg-white py-1.5 pl-1.5 pr-3.5 text-[14px] font-medium text-ink-700 transition hover:border-brand/40"
            >
              <span className="rounded-full bg-brand px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-white">Nové</span>
              Online CAD
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            <Link href="/poptavka" className="btn-primary hidden !px-5 !py-2.5 !text-[14px] sm:inline-flex">
              Poptat výrobu <Icon name="arrow" className="h-4 w-4" />
            </Link>
            <button
              type="button"
              className="rounded-full p-2.5 text-ink-700 lg:hidden"
              aria-label={open ? "Zavřít menu" : "Otevřít menu"}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              <Icon name={open ? "x" : "menu"} />
            </button>
          </div>
        </div>
      </div>

      {/* Mobilní menu */}
      <div className={cn("fixed inset-x-0 bottom-0 top-[72px] bg-white transition-all duration-500 lg:hidden", open ? "visible opacity-100" : "invisible opacity-0")}>
        <div className="bg-grid-light absolute inset-0" />
        <nav className="container relative flex h-full flex-col gap-1 pt-6" aria-label="Mobilní navigace">
          {[...NAV, { href: "/cad", label: "Online CAD" }].map((n, i) => (
            <Link
              key={n.href}
              href={n.href}
              style={{ transitionDelay: open ? `${80 + i * 50}ms` : "0ms" }}
              className={cn("h-display border-b border-ink-700/10 py-4 text-3xl text-ink-700 transition-all duration-500", open ? "translate-x-0 opacity-100" : "-translate-x-4 opacity-0")}
            >
              {n.label}
            </Link>
          ))}
          <Link href="/poptavka" className="btn-primary mt-8 w-full !py-4">
            Poptat výrobu <Icon name="arrow" className="h-4 w-4" />
          </Link>
          <p className="mt-6 font-mono text-xs uppercase tracking-widest text-ink-700/40">B2B zakázky od 50 000 Kč · {SITE.hours}</p>
        </nav>
      </div>
    </header>
  );
}
