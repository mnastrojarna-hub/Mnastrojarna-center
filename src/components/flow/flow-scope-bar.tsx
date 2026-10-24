"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, BookOpen, Inbox, UserRound, Users } from "lucide-react";
import { FLOW_WHO_COOKIE, FLOW_WHO_COOKIE_DAYS, FLOW_WHO_PARAM, type FlowWho } from "@/lib/auth/flow-scope";
import { cn } from "@/lib/utils";
import { SCOPE_ERROR_TEXT, scopeNoteText, type FlowScopeBarData } from "./flow-scope-copy";

function writeCookie(who: FlowWho) {
  try {
    document.cookie = `${FLOW_WHO_COOKIE}=${who}; path=/; max-age=${FLOW_WHO_COOKIE_DAYS * 86_400}; samesite=lax`;
  } catch {
    // bez cookie platí aspoň parametr v adrese
  }
}

/**
 * Lišta rozsahu obchodního toku (#25): super admin přepíná „Všichni / Jen moje“ (zůstanou ostatní
 * parametry adresy, volba se pamatuje v cookie flow_kdo, adresa má přednost); ostatní vidí poznámku,
 * co je „moje“, a odkaz do Knihy zakázek. Chyba načtení „moje“ má vlastní text (seznam nevypadá prázdný).
 */
export function FlowScopeBar({ scope, className }: { scope: FlowScopeBarData | null | undefined; className?: string }) {
  if (!scope) return null;
  if (scope.error) {
    return (
      <div role="alert" className={cn("flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200", className)}>
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p className="min-w-0">{SCOPE_ERROR_TEXT}</p>
      </div>
    );
  }
  if (scope.canToggle) return <ScopeToggle who={scope.who} className={className} />;
  const hasMailbox = scope.mailboxEmails.length > 0;
  return (
    <div
      data-scope-note
      className={cn(
        "flex flex-col gap-2 rounded-xl border bg-background/70 px-3 py-2.5 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <p className="flex min-w-0 items-start gap-2">
        {hasMailbox ? <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden /> : <Inbox className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />}
        <span className="min-w-0 break-words">{scopeNoteText(scope.mailboxEmails)}</span>
      </p>
      <Link
        href="/orders"
        className="inline-flex min-h-11 shrink-0 items-center gap-1.5 self-start rounded-md px-2 text-sm font-medium text-foreground underline-offset-2 hover:underline sm:min-h-8 sm:self-auto"
      >
        <BookOpen className="h-4 w-4 text-muted-foreground" aria-hidden /> Kniha zakázek
      </Link>
    </div>
  );
}

function ScopeToggle({ who, className }: { who: FlowWho; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = React.useTransition();

  function pick(next: FlowWho) {
    if (next === who || pending) return;
    writeCookie(next);
    // ostatní parametry adresy (stav, filtr) zůstanou
    const sp = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
    if (next === "moje") sp.set(FLOW_WHO_PARAM, "moje");
    else sp.delete(FLOW_WHO_PARAM);
    const q = sp.toString();
    start(() => router.push(q ? `${pathname}?${q}` : pathname));
  }

  const options: { key: FlowWho; label: string; icon: typeof Users }[] = [
    { key: "vsichni", label: "Všichni", icon: Users },
    { key: "moje", label: "Jen moje", icon: UserRound },
  ];
  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between", className)}>
      <div role="radiogroup" aria-label="Koho zobrazit" className={cn("inline-flex w-full rounded-lg border bg-background/70 p-0.5 sm:w-auto", pending && "opacity-70")}>
        {options.map((o) => {
          const on = o.key === who;
          const Icon = o.icon;
          return (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={pending}
              onClick={() => pick(o.key)}
              className={cn(
                "inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8 sm:flex-none",
                on ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden /> {o.label}
            </button>
          );
        })}
      </div>
      {who === "moje" && (
        <button
          type="button"
          onClick={() => pick("vsichni")}
          className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-md px-1 text-left text-sm text-amber-800 underline-offset-2 hover:underline dark:text-amber-300 sm:min-h-8 sm:self-auto"
        >
          Zobrazuješ jen svoje — přepnout na Všichni
        </button>
      )}
    </div>
  );
}
