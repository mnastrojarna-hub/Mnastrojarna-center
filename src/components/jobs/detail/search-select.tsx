"use client";

import * as React from "react";
import { ChevronsUpDown, Loader2, Plus, Search, X, AlertCircle, Check, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { filterOptions } from "./detail-helpers";
import { useOptimisticValue } from "./inline-field";

export interface SearchOption {
  value: string;
  label: string;
  sub?: string | null;
}

/**
 * Výběr s hledáním (zákazníci, dodavatelé — může jich být tisíce).
 * Volitelně „Založit nového…" podle napsaného textu.
 */
export function SearchSelect({
  label, value, valueLabel, options, onSave, onCreate, createLabel = "Založit nového", emptyLabel = "Nevybráno",
  icon: Icon, iconClass, placeholder = "Hledej podle názvu, IČO…", allowClear = true, className,
}: {
  label: string;
  value: string | null;
  /** Název aktuální hodnoty (když ještě není v seznamu). */
  valueLabel?: string | null;
  options: SearchOption[];
  onSave: (next: string | null) => Promise<string | null>;
  onCreate?: (name: string) => Promise<string | null>;
  createLabel?: string;
  emptyLabel?: string;
  icon?: LucideIcon;
  iconClass?: string;
  placeholder?: string;
  allowClear?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [createdName, setCreatedName] = React.useState<string | null>(null);
  const { shown, setPending } = useOptimisticValue(value ?? "", saving);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listId = React.useId();

  const results = React.useMemo(() => filterOptions(options, query, 60), [options, query]);
  const exact = query.trim() && options.some((o) => o.label.trim().toLowerCase() === query.trim().toLowerCase());
  const canCreate = Boolean(onCreate && query.trim().length >= 2 && !exact);
  const current = options.find((o) => o.value === shown);
  const currentLabel = current?.label ?? (shown && shown === (value ?? "") ? valueLabel : null) ?? (createdName && !shown ? createdName : null);

  React.useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent | TouchEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
    };
  }, [open]);

  async function pick(next: string | null) {
    setOpen(false);
    setQuery("");
    if ((next ?? "") === shown) return;
    setPending(next ?? "");
    setCreatedName(null);
    setSaving(true);
    setError(null);
    const err = await onSave(next);
    setSaving(false);
    if (err) {
      setPending(undefined);
      setError(err);
    }
  }

  async function create() {
    if (!onCreate) return;
    const name = query.trim();
    setOpen(false);
    setQuery("");
    setCreatedName(name);
    setSaving(true);
    setError(null);
    const err = await onCreate(name);
    setSaving(false);
    if (err) {
      setCreatedName(null);
      setError(err);
    }
  }

  function onKey(e: React.KeyboardEvent) {
    const total = results.length + (canCreate ? 1 : 0);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(total - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active < results.length) void pick(results[active].value);
      else if (canCreate) void create();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className={cn("relative min-w-0", className)}>
      <div className="mb-0.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {Icon && <Icon className={cn("h-3.5 w-3.5", iconClass)} />}
        <span>{label}</span>
        {saving && <Loader2 className="h-3 w-3 animate-spin" aria-label="Ukládám" />}
      </div>
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setActive(0);
        }}
        disabled={saving}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="-mx-1.5 flex w-[calc(100%+0.75rem)] min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-sm transition hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className={cn("min-w-0 flex-1 truncate font-medium", !currentLabel && "font-normal text-muted-foreground")}>
          {currentLabel || emptyLabel}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 min-w-[16rem] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl animate-fade-in">
          <div className="flex items-center gap-2 border-b px-2.5">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKey}
              placeholder={placeholder}
              className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              role="combobox"
              aria-controls={listId}
              aria-expanded
            />
          </div>
          <ul id={listId} role="listbox" className="max-h-64 overflow-y-auto p-1">
            {allowClear && shown && !query && (
              <li>
                <button type="button" onClick={() => void pick(null)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent">
                  <X className="h-3.5 w-3.5" /> Zrušit výběr
                </button>
              </li>
            )}
            {results.map((o, i) => (
              <li key={o.value} role="option" aria-selected={o.value === shown}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => void pick(o.value)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                    i === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{o.label}</span>
                    {o.sub && <span className="block truncate text-[11px] text-muted-foreground">{o.sub}</span>}
                  </span>
                  {o.value === shown && <Check className="h-4 w-4 shrink-0 text-green-600" />}
                </button>
              </li>
            ))}
            {!results.length && !canCreate && (
              <li className="px-2 py-3 text-center text-xs text-muted-foreground">
                Nic nenalezeno{onCreate ? " — napiš celý název a založ nového." : "."}
              </li>
            )}
            {canCreate && (
              <li>
                <button
                  type="button"
                  onMouseEnter={() => setActive(results.length)}
                  onClick={() => void create()}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium text-green-700 dark:text-green-400",
                    active === results.length ? "bg-green-50 dark:bg-green-500/10" : "hover:bg-green-50 dark:hover:bg-green-500/10",
                  )}
                >
                  <Plus className="h-4 w-4" /> {createLabel} „{query.trim()}“
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 flex items-start gap-1 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}
    </div>
  );
}
