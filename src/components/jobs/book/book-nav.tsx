"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { applyBookPatch, bookHref, canonicalBookHref, type BookParams, type BookPatch } from "@/components/jobs/book/book-params";

/**
 * Navigace knihy přes URL: filtry, záložky i řazení mění parametry adresy
 * v přechodu (transition) — stará data zůstanou vidět (ztlumená), dokud nedorazí
 * nová, takže nic neposkakuje. Výběr se ukáže hned (optimisticky).
 * Pojistka: když přechod routeru uvízne (nová stránka nedorazí do NAV_GUARD_MS),
 * adresa se načte klasicky — filtr tak vždy zabere.
 */

/** Do kdy musí dorazit nová stránka knihy, jinak klasické načtení adresy. */
export const NAV_GUARD_MS = 6000;

interface BookNav {
  /** Aktuální parametry (včetně právě požadovaných, ještě nenačtených). */
  params: BookParams;
  pending: boolean;
  navigate: (patch: BookPatch, opts?: { replace?: boolean }) => void;
  hrefFor: (patch: BookPatch) => string;
}

const BookNavContext = React.createContext<BookNav | null>(null);

export function BookNavProvider({ params, children }: { params: BookParams; children: React.ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [requested, setRequested] = React.useState<BookParams | null>(null);
  const requestedRef = React.useRef<BookParams | null>(null);
  const paramsRef = React.useRef(params);
  const guard = React.useRef<{ href: string; timer: number } | null>(null);

  React.useEffect(() => {
    paramsRef.current = params;
    // stránka s požadovanými parametry dorazila → pojistka není potřeba
    if (guard.current && bookHref(params) === guard.current.href) {
      window.clearTimeout(guard.current.timer);
      guard.current = null;
    }
  }, [params]);

  React.useEffect(() => () => {
    if (guard.current) window.clearTimeout(guard.current.timer);
  }, []);

  // po dokončení všech přechodů platí to, co přišlo ze serveru
  React.useEffect(() => {
    if (!pending) {
      requestedRef.current = null;
      setRequested(null);
    }
  }, [pending, params]);

  const navigate = React.useCallback(
    (patch: BookPatch, opts?: { replace?: boolean }) => {
      const base = requestedRef.current ?? paramsRef.current;
      const next = applyBookPatch(base, patch);
      const href = bookHref(next);
      requestedRef.current = next;
      setRequested(next);
      if (guard.current) window.clearTimeout(guard.current.timer);
      const target = canonicalBookHref(href);
      guard.current = bookHref(paramsRef.current) === target ? null : {
        href: target,
        timer: window.setTimeout(() => {
          if (guard.current?.href !== target) return;
          guard.current = null;
          if (opts?.replace) window.location.replace(href);
          else window.location.assign(href);
        }, NAV_GUARD_MS),
      };
      startTransition(() => {
        if (opts?.replace) router.replace(href, { scroll: false });
        else router.push(href, { scroll: false });
      });
    },
    [router],
  );

  const current = requested ?? params;
  const hrefFor = React.useCallback((patch: BookPatch) => bookHref(applyBookPatch(current, patch)), [current]);

  const value = React.useMemo<BookNav>(
    () => ({ params: current, pending, navigate, hrefFor }),
    [current, pending, navigate, hrefFor],
  );
  return <BookNavContext.Provider value={value}>{children}</BookNavContext.Provider>;
}

export function useBookNav(): BookNav {
  const ctx = React.useContext(BookNavContext);
  if (!ctx) throw new Error("useBookNav musí být uvnitř BookNavProvider.");
  return ctx;
}

/**
 * Odkaz, který změní parametry knihy. Běžné kliknutí jde přes přechod
 * (bez skoku nahoru), Ctrl/⌘/prostřední tlačítko otevře novou kartu.
 */
export const BookLink = React.forwardRef<
  HTMLAnchorElement,
  Omit<React.ComponentPropsWithoutRef<typeof Link>, "href"> & { patch: BookPatch; replace?: boolean }
>(function BookLink({ patch, replace, onClick, ...props }, ref) {
  const nav = useBookNav();
  return (
    <Link
      ref={ref}
      {...props}
      href={nav.hrefFor(patch)}
      scroll={false}
      prefetch={false}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        nav.navigate(patch, { replace });
      }}
    />
  );
});

/** Ztlumí výsledky během načítání nových (bez skeletonu → žádný posun). */
export function BookPending({ children, className }: { children: React.ReactNode; className?: string }) {
  const { pending } = useBookNav();
  return (
    <div aria-busy={pending} className={className}>
      <div
        aria-hidden
        className={
          "pointer-events-none h-0.5 w-full rounded-full bg-primary/60 transition-opacity duration-300 " +
          (pending ? "animate-pulse opacity-100" : "opacity-0")
        }
      />
      <div className={"transition-opacity duration-200 " + (pending ? "pointer-events-none opacity-60" : "opacity-100")}>
        {children}
      </div>
    </div>
  );
}
