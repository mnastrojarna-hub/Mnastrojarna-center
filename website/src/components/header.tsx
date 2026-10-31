"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { Dict } from "@/content/cs";
import { LOCALES, LOCALE_META, alternates, href, resolvePath, type Locale } from "@/i18n/config";
import { cn } from "@/lib/cn";
import { Icon } from "./icons";
import { Logo } from "./logo";

/** Přepínač jazyků — vede na stejnou stránku v jiném jazyce (lokalizované adresy). */
function LangSwitch({ locale, label, className }: { locale: Locale; label: string; className?: string }) {
  const pathname = usePathname() || "/";
  const r = resolvePath(pathname);
  const alt = r ? alternates(r.key, r.serviceId ?? r.caseId) : alternates("home");
  return (
    <div className={cn("flex items-center rounded-full border border-ink-700/10 bg-white p-0.5", className)} role="navigation" aria-label={label}>
      {LOCALES.map((l) => (
        <a
          key={l}
          href={alt[l]}
          hrefLang={LOCALE_META[l].hreflang}
          lang={l}
          aria-current={l === locale ? "true" : undefined}
          title={LOCALE_META[l].label}
          className={cn("rounded-full px-2.5 py-1 font-mono text-[11px] font-medium transition", l === locale ? "bg-ink-700 text-white" : "text-ink-700/55 hover:text-ink-700")}
        >
          {LOCALE_META[l].short}
        </a>
      ))}
    </div>
  );
}

export function Header({ locale, t, note, mailHref, phone, phoneHref }: { locale: Locale; t: Dict["nav"]; note: string; mailHref: string; phone?: string; phoneHref?: string }) {
  const pathname = usePathname() || "/";
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const nav = [
    { href: href(locale, "services"), label: t.services },
    { href: href(locale, "cases"), label: t.cases },
    { href: href(locale, "machinery"), label: t.machinery },
    { href: href(locale, "references"), label: t.references },
    { href: href(locale, "about"), label: t.about },
    { href: href(locale, "contact"), label: t.contact },
  ];

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
            "flex items-center justify-between gap-4 rounded-full px-3 transition-all duration-500 md:px-4",
            scrolled || open ? "border border-ink-700/10 bg-white/85 py-2 shadow-[0_12px_40px_-20px_rgba(39,36,37,.35)] backdrop-blur-xl" : "border border-transparent py-1",
          )}
        >
          <Link href={href(locale, "home")} aria-label={t.homeAria} className="shrink-0 pl-1">
            <Logo tone="dark" animate className="h-7 w-auto md:h-8" />
          </Link>

          <nav className="hidden items-center gap-0.5 xl:flex" aria-label={t.main}>
            {nav.map((n) => {
              const active = pathname === n.href || pathname.startsWith(n.href + "/");
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={cn("relative rounded-full px-3.5 py-2 text-[14px] font-medium transition-colors", active ? "bg-ink-700/[0.06] text-ink-700" : "text-ink-700/65 hover:text-ink-700")}
                >
                  {n.label}
                </Link>
              );
            })}
            <Link href="/cad" className="ml-1 inline-flex items-center gap-2 rounded-full border border-ink-700/10 bg-white py-1.5 pl-1.5 pr-3.5 text-[14px] font-medium text-ink-700 transition hover:border-brand/40">
              <span className="rounded-full bg-brand px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-white">{t.cadBadge}</span>
              {t.cad}
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            <LangSwitch locale={locale} label={t.language} className="hidden sm:flex" />
            {phone && (
              <a href={phoneHref} className="hidden items-center gap-1.5 whitespace-nowrap px-2 font-mono text-[13px] text-ink-700/75 hover:text-brand 2xl:inline-flex">
                <Icon name="phone" className="h-4 w-4 text-brand" /> {phone}
              </a>
            )}
            <a href={mailHref} className="btn-primary hidden !px-5 !py-2.5 !text-[14px] md:inline-flex">
              {t.rfq} <Icon name="arrow" className="h-4 w-4" />
            </a>
            <button type="button" className="rounded-full p-2.5 text-ink-700 xl:hidden" aria-label={open ? t.closeMenu : t.openMenu} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              <Icon name={open ? "x" : "menu"} />
            </button>
          </div>
        </div>
      </div>

      {/* Mobilní menu */}
      <div className={cn("fixed inset-x-0 bottom-0 top-[72px] bg-white transition-all duration-500 xl:hidden", open ? "visible opacity-100" : "invisible opacity-0")}>
        <div className="bg-grid-light absolute inset-0" />
        <nav className="container relative flex h-full flex-col gap-1 overflow-y-auto pb-10 pt-6" aria-label={t.mobile}>
          {[...nav, { href: "/cad", label: t.cad }].map((n, i) => (
            <Link
              key={n.href}
              href={n.href}
              style={{ transitionDelay: open ? `${80 + i * 50}ms` : "0ms" }}
              className={cn("h-display border-b border-ink-700/10 py-4 text-3xl text-ink-700 transition-all duration-500", open ? "translate-x-0 opacity-100" : "-translate-x-4 opacity-0")}
            >
              {n.label}
            </Link>
          ))}
          <a href={mailHref} className="btn-primary mt-8 w-full !py-4">
            {t.rfq} <Icon name="arrow" className="h-4 w-4" />
          </a>
          {phone && (
            <a href={phoneHref} className="btn-ghost mt-3 w-full !py-4">
              <Icon name="phone" className="h-4 w-4 text-brand" /> {phone}
            </a>
          )}
          <LangSwitch locale={locale} label={t.language} className="mt-6 self-start" />
          <p className="mt-6 font-mono text-xs uppercase tracking-widest text-ink-700/40">{note}</p>
        </nav>
      </div>
    </header>
  );
}
