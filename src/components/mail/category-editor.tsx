"use client";

import * as React from "react";
import { Check, Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setEmailCategory } from "@/app/actions/mail";
import { CATEGORY_STYLE, INBOX_CATEGORIES, categoryCodeFromLabel, categoryStyle } from "@/lib/email/visibility";
import type { EmailCategory } from "@/lib/data/types";
import { cn } from "@/lib/utils";

export function CategoryPill({ category, className }: { category: EmailCategory; className?: string }) {
  const st = categoryStyle(category);
  const Icon = st.icon;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", st.chip, className)}>
      <Icon className="h-3 w-3" />
      {st.label}
    </span>
  );
}

/**
 * Kategorie e-mailu — ručně ji změní každý (bez AI se tak pošta roztřídí).
 * Super admin může přidat pravidlo; oprava kategorie od AI se uloží jako korekce.
 */
export function CategoryEditor({ emailId, category, canAi, onSaved }: { emailId: string; category: EmailCategory; canAi: boolean; onSaved: (c: EmailCategory) => void }) {
  const [open, setOpen] = React.useState(false);
  const [cat, setCat] = React.useState<EmailCategory>(category);
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const save = async () => {
    const code = categoryCodeFromLabel(cat);
    if (!code) return;
    setSaving(true);
    setError(null);
    const res = await setEmailCategory(emailId, code, canAi ? note : undefined);
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
        >
          <Wand2 className="h-3.5 w-3.5" /> {canAi ? "Změnit kategorii (AI se naučí)" : "Změnit kategorii"}
        </button>
        {done && (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <Check className="h-3.5 w-3.5" /> Uloženo{canAi ? " — AI se z toho příště poučí" : ""}.
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
      {canAi && <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Pravidlo pro AI (volitelné, např. faktury od TDK jdou vždy do Faktura)" />}
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
