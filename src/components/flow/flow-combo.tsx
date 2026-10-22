"use client";

import * as React from "react";
import { Check, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { matchesQuery } from "./flow-utils";

export interface ComboItem {
  id: string;
  label: string;
  sub?: string | null;
  /** Barevná tečka / proužek vlevo (třída Tailwindu). */
  dot?: string;
}

/**
 * Pole s našeptávačem: píšeš, vybíráš šipkami / klikem. `allowFree` = lze nechat
 * vlastní text (nový zákazník), jinak se musí vybrat položka ze seznamu.
 */
export function FlowCombo({
  id,
  items,
  text,
  selectedId,
  onChange,
  placeholder,
  allowFree = false,
  max = 8,
  autoFocus,
  className,
}: {
  id?: string;
  items: ComboItem[];
  text: string;
  selectedId: string | null;
  onChange: (text: string, id: string | null) => void;
  placeholder?: string;
  allowFree?: boolean;
  max?: number;
  autoFocus?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listId = React.useId();

  const results = React.useMemo(() => {
    const q = selectedId ? "" : text;
    return items.filter((it) => matchesQuery([it.label, it.sub], q)).slice(0, max);
  }, [items, text, selectedId, max]);

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

  function pick(it: ComboItem) {
    onChange(it.label, it.id);
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, Math.max(0, results.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" && open && results[active]) {
      e.preventDefault();
      pick(results[active]);
    } else if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
    }
  }

  const showList = open && results.length > 0;

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          autoFocus={autoFocus}
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value, null);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          className={cn(
            "flex h-10 w-full rounded-md border border-input bg-background py-1 pl-8 pr-8 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            selectedId && "border-green-300 bg-green-50/50 dark:border-green-500/40 dark:bg-green-500/10",
          )}
        />
        {selectedId ? (
          <Check aria-label="Vybráno" className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-green-600" />
        ) : text ? (
          <button
            type="button"
            aria-label="Vymazat"
            onClick={() => onChange("", null)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {results.map((it, i) => (
            <li
              key={it.id}
              role="option"
              aria-selected={it.id === selectedId}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(it)}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                i === active && "bg-accent",
              )}
            >
              {it.dot && <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", it.dot)} />}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{it.label}</span>
                {it.sub && <span className="block truncate text-[11px] text-muted-foreground">{it.sub}</span>}
              </span>
              {it.id === selectedId && <Check className="h-4 w-4 text-green-600" />}
            </li>
          ))}
        </ul>
      )}
      {allowFree && !selectedId && text.trim().length >= 2 && !showList && (
        <p className="mt-1 text-[11px] text-muted-foreground">Nový zákazník „{text.trim()}“ se založí automaticky.</p>
      )}
    </div>
  );
}
