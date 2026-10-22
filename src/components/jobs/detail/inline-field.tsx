"use client";

import * as React from "react";
import { Loader2, Pencil, Check, AlertCircle, type LucideIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { JobInput } from "@/lib/jobs/types";
import { cn } from "@/lib/utils";
import { useJobDetail } from "./detail-context";
import { decimalInput, parseDecimal, longDate, formatMoney } from "./detail-helpers";

/**
 * Pole upravitelné na místě: klik → políčko → Enter / opuštění uloží, Esc zruší.
 * Hodnota se ukáže hned (optimisticky), při chybě se vrátí a ukáže důvod.
 */

export type InlineKind = "text" | "email" | "tel" | "date" | "money" | "number" | "textarea";

export interface InlineEditorProps {
  label: string;
  /** Hodnota jako text (datum RRRR-MM-DD, číslo „1,5"). */
  value: string;
  onSave: (next: string) => Promise<string | null>;
  kind?: InlineKind;
  placeholder?: string;
  /** Zobrazení uložené hodnoty (formát data, odkaz…). */
  display?: (v: string) => React.ReactNode;
  readOnly?: boolean;
  hint?: string;
  icon?: LucideIcon;
  iconClass?: string;
  className?: string;
  /** Větší písmo (název zakázky v hlavičce). */
  size?: "sm" | "md" | "xl";
  /** Bez popisku (popisek jen pro čtečky). */
  hideLabel?: boolean;
  suffix?: string;
}

export function useOptimisticValue(value: string, saving: boolean) {
  const { refreshing } = useJobDetail();
  const [pending, setPending] = React.useState<string | undefined>(undefined);
  const [synced, setSynced] = React.useState(value);
  const [wasRefreshing, setWasRefreshing] = React.useState(refreshing);
  // nová hodnota ze serveru nebo konec obnovy stránky → zahodit optimistickou
  if (value !== synced) {
    setSynced(value);
    setPending(undefined);
  }
  if (refreshing !== wasRefreshing) {
    setWasRefreshing(refreshing);
    if (!refreshing && !saving) setPending(undefined);
  }
  return { shown: pending !== undefined ? pending : value, setPending };
}

export function InlineEditor({
  label, value, onSave, kind = "text", placeholder = "Doplnit", display, readOnly, hint, icon: Icon, iconClass,
  className, size = "sm", hideLabel, suffix,
}: InlineEditorProps) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savedFlash, setSavedFlash] = React.useState(false);
  const { shown, setPending } = useOptimisticValue(value, saving);
  const id = React.useId();
  // úprava běží — chrání před dvojím uložením (Enter + opuštění pole) a uložením po Esc
  const active = React.useRef(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  function start() {
    if (readOnly || saving) return;
    setDraft(shown);
    setError(null);
    active.current = true;
    setEditing(true);
  }

  async function commit() {
    if (!active.current) return;
    // rozepsané datum (prohlížeč vrací "") nesmí smazat uložený termín
    if (kind === "date" && inputRef.current?.validity.badInput) {
      active.current = false;
      setEditing(false);
      setError("Neúplné datum — nic jsem neuložil. Zadej celé datum, nebo pole vymaž.");
      return;
    }
    active.current = false;
    setEditing(false);
    const next = kind === "textarea" ? draft.replace(/\s+$/, "") : draft.trim();
    if (next === shown.trim()) return;
    if ((kind === "money" || kind === "number") && next && parseDecimal(next) === null) {
      setError("Zadej číslo (např. 1 250,50).");
      return;
    }
    setPending(next);
    setSaving(true);
    setError(null);
    const err = await onSave(next);
    setSaving(false);
    if (err) {
      setPending(undefined);
      setError(err);
      return;
    }
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1400);
  }

  function cancel() {
    active.current = false;
    setEditing(false);
    setDraft(shown);
    setError(null);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    } else if (e.key === "Enter" && (kind !== "textarea" || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void commit();
    }
  }

  const textCls = size === "xl" ? "text-xl font-semibold sm:text-2xl" : size === "md" ? "text-base font-medium" : "text-sm";
  const empty = !shown.trim();

  return (
    <div className={cn("group/field min-w-0", className)}>
      <div className={cn("mb-0.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground", hideLabel && "sr-only")}>
        {Icon && <Icon className={cn("h-3.5 w-3.5", iconClass)} />}
        <label htmlFor={editing ? id : undefined}>{label}</label>
        {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-label="Ukládám" />}
        {savedFlash && !saving && <Check className="h-3 w-3 text-green-600 dark:text-green-400" aria-label="Uloženo" />}
      </div>
      {editing ? (
        kind === "textarea" ? (
          <Textarea
            id={id}
            autoFocus
            value={draft}
            rows={Math.min(10, Math.max(3, draft.split("\n").length + 1))}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={onKey}
            placeholder={placeholder}
            className="text-sm"
          />
        ) : (
          <div className="flex items-center gap-1.5">
            <Input
              ref={inputRef}
              id={id}
              autoFocus
              type={kind === "date" ? "date" : kind === "email" ? "email" : kind === "tel" ? "tel" : "text"}
              inputMode={kind === "money" || kind === "number" ? "decimal" : kind === "tel" ? "tel" : undefined}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void commit()}
              onKeyDown={onKey}
              placeholder={placeholder}
              className={cn(size === "xl" && "h-11 text-lg font-semibold", kind === "money" && "text-right tabular-nums")}
            />
            {suffix && <span className="shrink-0 text-xs text-muted-foreground">{suffix}</span>}
          </div>
        )
      ) : (
        <button
          type="button"
          onClick={start}
          disabled={readOnly}
          aria-label={`${label}: ${empty ? "nevyplněno" : shown}${readOnly ? "" : " — upravit"}`}
          title={readOnly ? undefined : "Klikni a uprav"}
          className={cn(
            "flex w-full min-w-0 items-start gap-1.5 rounded-md text-left transition",
            !readOnly && "-mx-1.5 px-1.5 py-0.5 hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            readOnly && "cursor-default",
          )}
        >
          <span className={cn("min-w-0 flex-1 break-words", textCls, kind === "textarea" && "whitespace-pre-wrap", saving && "opacity-70")}>
            {empty ? (
              readOnly ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded border border-dashed border-muted-foreground/30 px-1.5 text-xs font-normal text-muted-foreground">
                  + {placeholder}
                </span>
              )
            ) : display ? (
              display(shown)
            ) : (
              <>
                {shown}
                {suffix && <span className="ml-1 text-xs text-muted-foreground">{suffix}</span>}
              </>
            )}
          </span>
          {!readOnly && !empty && (
            <Pencil className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover/field:opacity-100" />
          )}
        </button>
      )}
      {error && (
        <p role="alert" className="mt-1 flex items-start gap-1 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}
      {hint && !error && !editing && <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Pole zakázky — uloží se přímo přes updateJob. */
export function JobField({
  field, value, kind = "text", currency = "CZK", ...rest
}: Omit<InlineEditorProps, "value" | "onSave"> & {
  field: keyof JobInput;
  value: string | number | null | undefined;
  currency?: string;
}) {
  const { save } = useJobDetail();
  const text = value === null || value === undefined ? "" : typeof value === "number" ? decimalInput(value) : value;
  const display = rest.display ?? (
    kind === "date" ? (v: string) => longDate(v) ?? v
      : kind === "money" ? (v: string) => <span className="tabular-nums">{formatMoney(parseDecimal(v), currency)}</span>
      : undefined
  );
  return (
    <InlineEditor
      {...rest}
      kind={kind}
      value={text}
      display={display}
      onSave={(next) => {
        const patch: JobInput = {};
        const v = kind === "money" || kind === "number" ? parseDecimal(next) : next;
        (patch as Record<string, unknown>)[field] = v;
        return save(patch);
      }}
    />
  );
}

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

/** Výběr ze seznamu (osoby) — uloží se hned po změně. */
export function InlineSelect({
  label, value, options, onSave, emptyLabel = "— nikdo —", icon: Icon, iconClass, readOnly, hint, className, display,
}: {
  label: string;
  value: string | null;
  options: SelectOption[];
  onSave: (next: string | null) => Promise<string | null>;
  emptyLabel?: string;
  icon?: LucideIcon;
  iconClass?: string;
  readOnly?: boolean;
  hint?: string;
  className?: string;
  display?: (option: SelectOption | null) => React.ReactNode;
}) {
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const { shown, setPending } = useOptimisticValue(value ?? "", saving);
  const id = React.useId();
  const current = options.find((o) => o.value === shown) ?? null;

  async function change(next: string) {
    if (next === shown) return;
    setPending(next);
    setSaving(true);
    setError(null);
    const err = await onSave(next || null);
    setSaving(false);
    if (err) {
      setPending(undefined);
      setError(err);
    }
  }

  return (
    <div className={cn("min-w-0", className)}>
      <div className="mb-0.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {Icon && <Icon className={cn("h-3.5 w-3.5", iconClass)} />}
        <label htmlFor={id}>{label}</label>
        {saving && <Loader2 className="h-3 w-3 animate-spin" aria-label="Ukládám" />}
      </div>
      {readOnly ? (
        <div className="text-sm">{display ? display(current) : current?.label ?? <span className="text-muted-foreground">—</span>}</div>
      ) : (
        <div className="relative">
          <div className="pointer-events-none flex min-h-[28px] items-center gap-1.5 rounded-md py-0.5 text-sm">
            {display ? display(current) : current ? current.label : <span className="text-muted-foreground">{emptyLabel}</span>}
          </div>
          <select
            id={id}
            value={shown}
            disabled={saving}
            onChange={(e) => void change(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label={label}
          >
            <option value="">{emptyLabel}</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}{o.hint ? ` — ${o.hint}` : ""}
              </option>
            ))}
          </select>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 flex items-start gap-1 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}
      {hint && !error && <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ── Osoba (barevný kroužek s iniciálami) ────────────────────
const AVATAR_TONES = [
  "bg-sky-500", "bg-violet-500", "bg-amber-500", "bg-emerald-500", "bg-pink-500", "bg-cyan-600", "bg-orange-500", "bg-indigo-500",
];

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "")).toUpperCase();
}

export function PersonChip({ name, muted, className }: { name: string | null | undefined; muted?: boolean; className?: string }) {
  if (!name) return <span className={cn("text-sm text-muted-foreground", className)}>—</span>;
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-sm", className)}>
      <span
        aria-hidden
        className={cn(
          "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white",
          muted ? "bg-muted-foreground/50" : AVATAR_TONES[h % AVATAR_TONES.length],
        )}
      >
        {initials(name)}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}
