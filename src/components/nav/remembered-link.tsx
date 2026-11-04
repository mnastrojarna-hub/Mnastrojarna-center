"use client";

import * as React from "react";
import Link from "next/link";
import * as nav from "next/navigation";
import { rememberedHref } from "@/lib/nav/url-state";

/**
 * Odkaz v menu (a „Zpět do Knihy" v detailu) s posledním stavem cílové stránky ze sessionStorage:
 * „/orders" → „/orders?segment=vse&q=…". Server i hydratace vykreslí holý odkaz (shodné HTML), po připojení
 * se doplní; při kliknutí se paměť přečte znovu (mohla se mezitím změnit). Ctrl / ⌘ / prostřední tlačítko
 * otevře novou kartu s touž adresou.
 */
/** Hook z next/navigation, nebo náhrada (testy s vlastní náhradou modulu export nemusí mít; mimo router vrací null). */
function navHook<T>(name: "useSearchParams" | "usePathname", fallback: T): T {
  try {
    const f = (nav as unknown as Record<string, unknown>)[name];
    return typeof f === "function" ? (f as T) : fallback;
  } catch {
    return fallback;
  }
}
const usePathnameSafe = navHook<() => string | null>("usePathname", () => null);

export const RememberedLink = React.forwardRef<HTMLAnchorElement, React.ComponentPropsWithoutRef<typeof Link> & { href: string }>(
  function RememberedLink({ href, onClick, ...props }, ref) {
    const router = nav.useRouter();
    const pathname = usePathnameSafe();
    const [shown, setShown] = React.useState(href);
    // po každém přechodu stránky znovu z paměti (stav cílové stránky se mezitím mohl změnit)
    React.useEffect(() => {
      setShown(rememberedHref(href));
    }, [href, pathname]);
    return (
      <Link
        ref={ref}
        {...props}
        href={shown}
        onClick={(e) => {
          onClick?.(e);
          if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          const latest = rememberedHref(href);
          if (latest === shown) return;
          e.preventDefault();
          router.push(latest);
        }}
      />
    );
  },
);
