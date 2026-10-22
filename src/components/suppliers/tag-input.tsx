"use client";

import * as React from "react";
import { Star, X } from "lucide-react";
import { addTags, removeTag, tagTone } from "@/components/suppliers/model";
import { cn } from "@/lib/utils";

/**
 * Štítky (technologie, materiály, certifikace): Enter nebo čárka přidá,
 * Backspace v prázdném poli smaže poslední, ťuknutí na návrh ho přidá.
 */
export function TagInput({
  id,
  value,
  onChange,
  placeholder,
  suggestions = [],
  colored = true,
}: {
  id: string;
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
  /** Barevné štítky (technologie); jinak neutrální. */
  colored?: boolean;
}) {
  const [draft, setDraft] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  function commit(text: string) {
    if (!text.trim()) return;
    onChange(addTags(value, text));
    setDraft("");
  }

  const lower = new Set(value.map((t) => t.toLocaleLowerCase("cs")));
  const needle = draft.trim().toLocaleLowerCase("cs");
  const offer = suggestions
    .filter((s) => !lower.has(s.toLocaleLowerCase("cs")))
    .filter((s) => !needle || s.toLocaleLowerCase("cs").includes(needle))
    .slice(0, 8);

  return (
    <div className="space-y-1.5">
      <div
        className="flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-background px-1.5 py-1 shadow-sm focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-background"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((t) => (
          <span
            key={t}
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full py-0.5 pl-2 pr-1 text-xs font-medium",
              colored ? tagTone(t) : "bg-muted text-foreground",
            )}
          >
            {t}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange(removeTag(value, t));
              }}
              className="rounded-full p-0.5 opacity-70 hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
              aria-label={`Odebrat ${t}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            if (/[,;]/.test(v)) commit(v);
            else setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(draft);
            } else if (e.key === "Backspace" && !draft && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => commit(draft)}
          placeholder={value.length ? "" : placeholder}
          className="h-7 min-w-[8rem] flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      {offer.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {offer.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commit(s)}
              className="rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground transition hover:border-solid hover:bg-accent hover:text-foreground"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Hodnocení 1–5 hvězdiček (opětovné ťuknutí na stejnou hvězdu hodnocení zruší). */
export function StarRatingInput({ id, value, onChange }: { id: string; value: number; onChange: (v: number) => void }) {
  return (
    <div id={id} role="radiogroup" aria-label="Hodnocení dodavatele" className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} z 5`}
          onClick={() => onChange(value === n ? 0 : n)}
          className="rounded p-1 transition hover:scale-110"
        >
          <Star className={cn("h-6 w-6", n <= value ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")} />
        </button>
      ))}
      <span className="ml-2 text-xs text-muted-foreground">{value ? `${value} z 5` : "nehodnoceno"}</span>
    </div>
  );
}

/** Hvězdičky jen pro čtení. */
export function StarRating({ value, className }: { value: number | null; className?: string }) {
  if (!value) return <span className={cn("text-xs text-muted-foreground", className)}>nehodnoceno</span>;
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} title={`Hodnocení ${value} z 5`} aria-label={`Hodnocení ${value} z 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cn("h-3.5 w-3.5", n <= value ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30")} />
      ))}
    </span>
  );
}
