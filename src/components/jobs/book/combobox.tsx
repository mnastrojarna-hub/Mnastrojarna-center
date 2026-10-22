"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Výběr s hledáním (zákazník, dodavatel…). Hledá bez diakritiky ve všech
 * slovech, ovládá se šipkami / Enter / Esc. Volitelně nabídne „+ Nový…".
 */

export interface ComboOption {
  value: string;
  label: string;
  /** Druhý řádek (číslo zákazníka, IČ…). */
  hint?: string;
  /** Další text pro hledání. */
  keywords?: string;
}

export function normalizeSearch(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function filterOptions(options: readonly ComboOption[], query: string, max = 60): ComboOption[] {
  const tokens = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return options.slice(0, max);
  const out: ComboOption[] = [];
  for (const o of options) {
    const h = normalizeSearch(`${o.label} ${o.hint ?? ""} ${o.keywords ?? ""}`);
    if (tokens.every((t) => h.includes(t))) {
      out.push(o);
      if (out.length >= max) break;
    }
  }
  return out;
}

export interface ComboboxProps {
  options: readonly ComboOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  id?: string;
  placeholder?: string;
  emptyText?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  className?: string;
  clearable?: boolean;
  disabled?: boolean;
  /** Nabídnout založení nové položky z napsaného textu. */
  onCreate?: (text: string) => void;
  createLabel?: (text: string) => string;
  /** Zvýraznit (aktivní filtr). */
  active?: boolean;
  icon?: React.ReactNode;
  maxResults?: number;
}

export function Combobox({
  options,
  value,
  onChange,
  id,
  placeholder = "Vyber…",
  emptyText = "Nic nenalezeno",
  className,
  clearable = true,
  disabled,
  onCreate,
  createLabel = (t) => `Přidat „${t}"`,
  active,
  icon,
  maxResults = 60,
  ...aria
}: ComboboxProps) {
  const autoId = React.useId();
  const inputId = id ?? `${autoId}-input`;
  const listId = `${autoId}-list`;
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  const selected = React.useMemo(() => options.find((o) => o.value === value) ?? null, [options, value]);
  const results = React.useMemo(() => filterOptions(options, query, maxResults), [options, query, maxResults]);
  const trimmed = query.trim();
  const exact = trimmed && options.some((o) => normalizeSearch(o.label) === normalizeSearch(trimmed));
  const showCreate = Boolean(onCreate && trimmed && !exact);
  const total = results.length + (showCreate ? 1 : 0);

  function close() {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }

  function pick(index: number) {
    if (index < results.length) {
      onChange(results[index].value);
      close();
    } else if (showCreate && onCreate) {
      onCreate(trimmed);
      close();
    }
  }

  React.useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActiveIndex((i) => (total ? (i + 1) % total : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (total ? (i - 1 + total) % total : 0));
    } else if (e.key === "Enter") {
      if (open && total) {
        e.preventDefault();
        pick(Math.min(activeIndex, total - 1));
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    } else if (e.key === "Tab") {
      close();
    }
  }

  return (
    <div className={cn("relative min-w-0", className)} data-combobox-open={open ? "true" : undefined}>
      <div className="relative flex items-center">
        <span className="pointer-events-none absolute left-2.5 flex items-center text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">
          {icon ?? <Search />}
        </span>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && total ? `${autoId}-opt-${activeIndex}` : undefined}
          aria-label={aria["aria-label"]}
          aria-invalid={aria["aria-invalid"]}
          disabled={disabled}
          value={open ? query : selected?.label ?? ""}
          placeholder={open && selected ? selected.label : placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => close()}
          onKeyDown={onKeyDown}
          className={cn(
            "flex h-9 w-full min-w-0 truncate rounded-md border border-input bg-background pl-8 text-sm shadow-sm transition-colors placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
            clearable && selected ? "pr-14" : "pr-8",
            active && !open && "border-primary/40 bg-accent font-medium text-accent-foreground",
            aria["aria-invalid"] && "border-red-500 focus-visible:ring-red-500",
          )}
        />
        {clearable && selected && !disabled && (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Zrušit výběr"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange(null);
              close();
            }}
            className="absolute right-7 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <ChevronsUpDown className="pointer-events-none absolute right-2.5 h-4 w-4 text-muted-foreground" />
      </div>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 min-w-[14rem] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg animate-fade-in"
        >
          {results.map((o, i) => (
            <li
              key={o.value}
              id={`${autoId}-opt-${i}`}
              data-index={i}
              role="option"
              aria-selected={o.value === value}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => pick(i)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                i === activeIndex && "bg-accent text-accent-foreground",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{o.label}</span>
                {o.hint && <span className="block truncate text-[11px] text-muted-foreground">{o.hint}</span>}
              </span>
              {o.value === value && <Check className="h-4 w-4 shrink-0 text-primary" />}
            </li>
          ))}
          {showCreate && (
            <li
              id={`${autoId}-opt-${results.length}`}
              data-index={results.length}
              role="option"
              aria-selected={false}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActiveIndex(results.length)}
              onClick={() => pick(results.length)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400",
                activeIndex === results.length && "bg-emerald-50 dark:bg-emerald-500/10",
              )}
            >
              <Plus className="h-4 w-4 shrink-0" />
              <span className="truncate">{createLabel(trimmed)}</span>
            </li>
          )}
          {!total && <li className="px-2 py-3 text-center text-sm text-muted-foreground">{emptyText}</li>}
        </ul>
      )}
    </div>
  );
}
