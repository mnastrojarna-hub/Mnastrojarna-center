"use client";

import * as React from "react";
import { Check, ChevronDown, Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setEmailCategory } from "@/app/actions/mail";
import { CATEGORY_STYLE, INBOX_CATEGORIES, categoryCodeFromLabel, categoryStyle } from "@/lib/email/visibility";
import type { EmailCategory } from "@/lib/data/types";
import { cn } from "@/lib/utils";

export function CategoryPill({ category, className }: { category: EmailCategory; className?: string }) {
  const st = categoryStyle(category);
  const Icon = st.icon;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", st.chip, className)} data-testid="category-pill">
      <Icon className="h-3 w-3" />
      {st.label}
    </span>
  );
}

/** Kategorie, do kterých jde zprávu přeřadit (odeslaná nemůže být spam). */
export function pickableCategories(direction: "in" | "out"): EmailCategory[] {
  return direction === "out" ? INBOX_CATEGORIES.filter((c) => c !== "Spam") : INBOX_CATEGORIES;
}

/**
 * Štítek kategorie, který jde jedním ťuknutím opravit (přijatá i odeslaná zpráva): ťuk → seznam
 * kategorií → ťuk = uloženo (kdo a kdy, korekce pro AI). Okamžitě se přebarví, při chybě vrátí.
 */
export function CategoryPicker({ emailId, category, direction = "in", onChange, onError, className }: {
  emailId: string;
  category: EmailCategory;
  direction?: "in" | "out";
  /** Nová kategorie (hned, před uložením); při chybě se zavolá znovu s původní. */
  onChange: (c: EmailCategory) => void;
  onError?: (text: string) => void;
  className?: string;
}) {
  const [saving, setSaving] = React.useState(false);
  const st = categoryStyle(category);
  const Icon = st.icon;
  const choose = async (c: EmailCategory) => {
    const code = categoryCodeFromLabel(c);
    if (!code || c === category) return;
    const prev = category;
    onChange(c);
    setSaving(true);
    const res = await setEmailCategory(emailId, code).catch(() => ({ ok: false, error: "Spojení se nepovedlo — zkus to znovu." }));
    setSaving(false);
    if (!res.ok) {
      onChange(prev);
      onError?.(res.error ?? "Kategorii se nepodařilo uložit.");
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex min-h-7 shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            st.chip, className,
          )}
          aria-label={`Kategorie: ${st.label}. Změnit`}
          title="Změnit kategorii"
          data-testid="category-picker"
          data-category={st.label}
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
          {st.label}
          <ChevronDown className="h-3 w-3 opacity-60" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[70vh] min-w-[13rem] overflow-y-auto">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Do jaké kategorie zpráva patří?</DropdownMenuLabel>
        {pickableCategories(direction).map((c) => {
          const s = CATEGORY_STYLE[c];
          const I = s.icon;
          return (
            <DropdownMenuItem key={c} onSelect={() => void choose(c)} data-testid={`category-option-${categoryCodeFromLabel(c)}`} className="min-h-9">
              <span className={cn("flex h-6 w-6 items-center justify-center rounded-full border", s.chip)}><I className="h-3.5 w-3.5" /></span>
              <span className="flex-1">{c}</span>
              {c === category && <Check className="h-4 w-4 text-primary" aria-label="vybráno" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Super admin (AI přehled): k opravě kategorie může připsat pravidlo pro AI (uloží se jako korekce
 * s poznámkou — AI ho příště dostane v promptu). Samotnou kategorii mění štítek (CategoryPicker).
 */
export function CategoryEditor({ emailId, category, canAi, onSaved }: { emailId: string; category: EmailCategory; canAi: boolean; onSaved: (c: EmailCategory) => void }) {
  const [open, setOpen] = React.useState(false);
  const [cat, setCat] = React.useState<EmailCategory>(category);
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!canAi) return null;

  const save = async () => {
    const code = categoryCodeFromLabel(cat);
    if (!code) return;
    setSaving(true);
    setError(null);
    const res = await setEmailCategory(emailId, code, note);
    setSaving(false);
    if (res.ok) {
      setDone(true);
      setOpen(false);
      onSaved(cat);
    } else setError(res.error ?? "Chyba");
  };

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => { setCat(category); setNote(""); setDone(false); setOpen(true); }}
          className="inline-flex min-h-8 items-center gap-1 text-xs text-muted-foreground hover:text-primary"
          data-testid="category-rule-open"
        >
          <Wand2 className="h-3.5 w-3.5" /> Pravidlo pro AI k zařazení pošty
        </button>
        {done && (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <Check className="h-3.5 w-3.5" /> Uloženo — AI se z toho příště poučí.
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/60 p-3 dark:border-blue-500/30 dark:bg-blue-500/10">
      <div className="text-xs font-medium">Do jaké kategorie e-mail patří?</div>
      <div className="flex flex-wrap gap-1.5">
        {INBOX_CATEGORIES.map((c) => {
          const st = CATEGORY_STYLE[c];
          const Icon = st.icon;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setCat(c)}
              className={cn("inline-flex min-h-8 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-all", cat === c ? cn(st.active, "shadow-sm") : st.chip)}
            >
              <Icon className="h-3 w-3" /> {c}
            </button>
          );
        })}
      </div>
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Pravidlo pro AI (např. faktury od TDK jdou vždy do Faktura)" />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="success" onClick={save} disabled={saving || (cat === category && !note.trim())}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Uložit
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Zrušit</Button>
      </div>
    </div>
  );
}
