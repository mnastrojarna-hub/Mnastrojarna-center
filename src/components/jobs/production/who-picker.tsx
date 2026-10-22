"use client";

import * as React from "react";
import { Building2, Home, Plus, Search, UserRoundPen, X, HelpCircle } from "lucide-react";
import { filterOptions } from "@/components/jobs/detail/detail-helpers";
import { searchNormalize } from "@/lib/jobs/mapping";
import { cn } from "@/lib/utils";
import { WHO_IN_HOUSE, WHO_NONE, whoLabel, type WhoValue } from "./production-helpers";

/**
 * Kdo operaci dělá: „U nás", dodavatel z adresáře (hledání), nebo firma, která
 * v adresáři ještě není (napsaný název). Zavřený stav = barevný chip + „Změnit".
 */

export function WhoIcon({ who, className }: { who: WhoValue; className?: string }) {
  if (who.type === "u_nas") return <Home className={cn("text-emerald-600 dark:text-emerald-400", className)} />;
  if (who.type === "supplier") return <Building2 className={cn("text-sky-600 dark:text-sky-400", className)} />;
  if (who.type === "free") return <UserRoundPen className={cn("text-violet-600 dark:text-violet-400", className)} />;
  return <HelpCircle className={cn("text-muted-foreground", className)} />;
}

export function WhoPicker({
  value, onChange, suppliers, label = "Kdo to dělá", allowNone = true, startOpen, className, id,
}: {
  value: WhoValue;
  onChange: (v: WhoValue) => void;
  suppliers: { id: string; name: string }[];
  label?: string;
  allowNone?: boolean;
  /** Otevřít rovnou hledání (nový výběr). */
  startOpen?: boolean;
  className?: string;
  id?: string;
}) {
  const [open, setOpen] = React.useState(Boolean(startOpen) || value.type === "none");
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const autoId = React.useId();
  const inputId = id ?? autoId;

  const options = React.useMemo(() => suppliers.map((s) => ({ value: s.id, label: s.name })), [suppliers]);
  const results = React.useMemo(() => filterOptions(options, query, 8), [options, query]);
  const q = query.trim();
  const exact = q !== "" && options.some((o) => searchNormalize(o.label.trim()) === searchNormalize(q));
  const canFree = q.length >= 2 && !exact;
  const total = results.length + (canFree ? 1 : 0);

  function pick(v: WhoValue) {
    onChange(v);
    setQuery("");
    setActive(0);
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(Math.max(0, total - 1), a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active < results.length && results[active]) {
        const r = results[active];
        pick({ type: "supplier", id: r.value, name: r.label });
      } else if (canFree) pick({ type: "free", name: q });
    } else if (e.key === "Escape" && value.type !== "none") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <div className={cn("min-w-0", className)}>
        {label && <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>}
        <div className="flex min-h-10 items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5">
          <WhoIcon who={value} className="h-4 w-4 shrink-0" />
          <span className={cn("min-w-0 flex-1 truncate text-sm font-medium", value.type === "none" && "font-normal text-muted-foreground")}>
            {whoLabel(value)}
          </span>
          {value.type === "free" && <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">mimo adresář</span>}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-sky-700 transition hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-500/10"
          >
            Změnit
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("min-w-0 space-y-2", className)}>
      {label && (
        <label htmlFor={inputId} className="block text-xs font-medium text-muted-foreground">
          {label}
        </label>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => pick(WHO_IN_HOUSE)}
          aria-pressed={value.type === "u_nas"}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition",
            value.type === "u_nas"
              ? "border-emerald-500 bg-emerald-500 text-white"
              : "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
          )}
        >
          <Home className="h-4 w-4" /> U nás
        </button>
        {allowNone && (
          <button
            type="button"
            onClick={() => pick(WHO_NONE)}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-dashed px-3 text-sm text-muted-foreground transition hover:bg-muted"
          >
            Zatím nevím
          </button>
        )}
        {value.type !== "none" && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="ml-auto inline-flex h-9 items-center gap-1 rounded-full px-2.5 text-xs text-muted-foreground hover:bg-muted"
            aria-label="Nechat beze změny"
          >
            <X className="h-3.5 w-3.5" /> Nechat {whoLabel(value)}
          </button>
        )}
      </div>
      <div className="overflow-hidden rounded-lg border bg-background">
        <div className="flex items-center gap-2 border-b px-2.5">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            id={inputId}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
            placeholder="Hledej dodavatele, nebo napiš název firmy…"
            autoComplete="off"
            className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <ul role="listbox" aria-label="Dodavatelé" className="max-h-48 overflow-y-auto p-1">
          {results.map((o, i) => (
            <li key={o.value} role="option" aria-selected={value.type === "supplier" && value.id === o.value}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => pick({ type: "supplier", id: o.value, name: o.label })}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm",
                  i === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                )}
              >
                <Building2 className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
                <span className="min-w-0 flex-1 truncate font-medium">{o.label}</span>
              </button>
            </li>
          ))}
          {canFree && (
            <li>
              <button
                type="button"
                onMouseEnter={() => setActive(results.length)}
                onClick={() => pick({ type: "free", name: q })}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium text-violet-700 dark:text-violet-300",
                  active === results.length ? "bg-violet-50 dark:bg-violet-500/10" : "hover:bg-violet-50 dark:hover:bg-violet-500/10",
                )}
              >
                <Plus className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">Firma mimo adresář: „{q}“</span>
              </button>
            </li>
          )}
          {!results.length && !canFree && (
            <li className="px-2 py-3 text-center text-xs text-muted-foreground">
              {options.length ? "Nic nenalezeno — napiš celý název firmy." : "Adresář dodavatelů je prázdný — napiš název firmy."}
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
