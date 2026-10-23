"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { CalendarRange, Filter, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { entityLabel } from "./audit-model";

export interface AuditFilterValue {
  osoba: string;
  entita: string;
  od: string;
  do: string;
  obdobi: string;
}

const PERIODS: { key: string; label: string }[] = [
  { key: "dnes", label: "Dnes" },
  { key: "7d", label: "7 dní" },
  { key: "30d", label: "30 dní" },
  { key: "", label: "Vše" },
];

const SELECT = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Filtry auditu: osoba (i ✨ AI a Systém), entita, období jedním ťuknutím nebo od–do.
 * Změna hned přepíše adresu (stránka se načte na serveru) — sdílitelný odkaz na výřez auditu.
 */
export function AuditFilters({
  value, actors, entities,
}: {
  value: AuditFilterValue;
  actors: { id: string; name: string }[];
  entities: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = React.useTransition();

  function go(patch: Partial<AuditFilterValue>) {
    const next = { ...value, ...patch };
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) sp.set(k, v);
    start(() => router.replace(sp.size ? `${pathname}?${sp.toString()}` : pathname, { scroll: false }));
  }

  const active = Boolean(value.osoba || value.entita || value.od || value.do || value.obdobi);

  return (
    <section aria-label="Filtr auditu" className={cn("space-y-3 rounded-xl border bg-card p-3 shadow-sm", pending && "opacity-70")}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><UserRound className="h-3.5 w-3.5 text-sky-600" aria-hidden /> Kdo</span>
          <select className={SELECT} value={value.osoba} onChange={(e) => go({ osoba: e.target.value })} aria-label="Osoba">
            <option value="">Všichni</option>
            <option value="ai">✨ AI</option>
            <option value="system">Systém (plánovač, přímý zápis)</option>
            {actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Filter className="h-3.5 w-3.5 text-violet-600" aria-hidden /> Co</span>
          <select className={SELECT} value={value.entita} onChange={(e) => go({ entita: e.target.value })} aria-label="Entita">
            <option value="">Vše</option>
            {entities.map((e) => <option key={e} value={e}>{entityLabel(e)}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div role="group" aria-label="Období" className="flex flex-wrap gap-1.5">
          {PERIODS.map((p) => {
            const on = (value.obdobi || "") === p.key && !value.od && !value.do;
            return (
              <button
                key={p.key || "all"}
                type="button"
                aria-pressed={on}
                onClick={() => go({ obdobi: p.key, od: "", do: "" })}
                className={cn(
                  "min-h-9 rounded-full border px-3 text-sm transition",
                  on ? "border-sky-600 bg-sky-600 text-white" : "hover:bg-accent",
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-1 flex-wrap items-center gap-2 sm:justify-end">
          <CalendarRange className="h-4 w-4 text-muted-foreground" aria-hidden />
          <Input type="date" value={value.od} onChange={(e) => go({ od: e.target.value, obdobi: "" })} className="h-9 w-[9.5rem]" aria-label="Od" />
          <span className="text-muted-foreground" aria-hidden>–</span>
          <Input type="date" value={value.do} onChange={(e) => go({ do: e.target.value, obdobi: "" })} className="h-9 w-[9.5rem]" aria-label="Do" />
          {active && (
            <Button type="button" variant="ghost" size="sm" onClick={() => go({ osoba: "", entita: "", od: "", do: "", obdobi: "" })}>
              <X className="h-4 w-4" /> Zrušit filtr
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
