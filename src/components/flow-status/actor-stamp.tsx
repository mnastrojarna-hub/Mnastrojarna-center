"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  CAUSE_LABELS, VIA_META, actorKindIcon, actorName, relativeStampTime, stampWho, type ChangeStamp, type FlowCause,
} from "@/lib/jobs/flow-status";

/**
 * „kdo · kdy" — viditelný text na VŠECH šířkách (text-[11px], mobil M11), ťuknutím detail
 * v DropdownMenu (Radix funguje i na dotyk; nikdy jen Tooltip). Bez rodových sloves:
 * „<prefix> · <jméno> · <kdy>".
 */
export function ActorStamp({
  stamp, verb, short, now, className,
}: {
  stamp: ChangeStamp | null | undefined;
  /** Prefix (stav / krok), např. „Potvrzená", „DL potvrzen". */
  verb?: string;
  /** Zkrácené jméno „P. Obchodník" (úzké řádky). */
  short?: boolean;
  /** Pro testy / SSR stabilní čas. */
  now?: Date;
  className?: string;
}) {
  if (!stamp) return null;
  const who = stampWho(stamp, { short });
  const rel = relativeStampTime(stamp.at, now);
  const full = actorName(stamp);
  const KindIcon = actorKindIcon(stamp.kind);
  const via = stamp.via ? VIA_META[stamp.via] : null;
  const ViaIcon = via?.icon;
  const when = stamp.at ? new Date(stamp.at) : null;
  const dateOnly = Boolean(stamp.at && /^\d{4}-\d{2}-\d{2}$/.test(stamp.at));
  const exact = when && !Number.isNaN(when.getTime())
    ? new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague", dateStyle: "medium", ...(dateOnly ? {} : { timeStyle: "short" }) }).format(when)
    : null;
  const cause = stamp.cause ? CAUSE_LABELS[stamp.cause as FlowCause] ?? stamp.cause : null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex min-w-0 max-w-full items-center whitespace-pre rounded text-left text-[11px] leading-4 text-muted-foreground",
          "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        aria-label={`${verb ? `${verb}: ` : ""}${full}${rel ? `, ${rel}` : ""} — podrobnosti`}
      >
        {/* zkracuje se jen jméno, čas zůstane vždy celý */}
        <span className="min-w-0 truncate">{verb ? `${verb} · ${who}` : who}</span>
        {rel && <span className="shrink-0">{` · ${rel}`}</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel className="text-foreground">{verb ?? "Změna"}</DropdownMenuLabel>
        <dl className="space-y-1.5 px-2 pb-2 text-xs">
          <div className="flex items-start gap-2">
            <dt className="sr-only">Kdo</dt>
            <KindIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <dd className="font-medium">{full}</dd>
          </div>
          {exact && (
            <div className="flex gap-2"><dt className="w-16 shrink-0 text-muted-foreground">Kdy</dt><dd>{exact}</dd></div>
          )}
          {via && ViaIcon && (
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-muted-foreground">Způsob</dt>
              <dd className="inline-flex items-center gap-1"><ViaIcon className="size-3.5" aria-hidden />{via.label}</dd>
            </div>
          )}
          {cause && (
            <div className="flex gap-2"><dt className="w-16 shrink-0 text-muted-foreground">Příčina</dt><dd>{cause}</dd></div>
          )}
          {stamp.note && (
            <div className="flex gap-2"><dt className="w-16 shrink-0 text-muted-foreground">Poznámka</dt><dd className="whitespace-pre-wrap break-words">{stamp.note}</dd></div>
          )}
        </dl>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
