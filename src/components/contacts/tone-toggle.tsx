"use client";

import * as React from "react";
import { Check, Loader2, Pencil, Sparkles, X } from "lucide-react";
import { getToneAction, saveToneAction, type ToneView } from "@/app/actions/contacts";
import { TONE_LABEL, TONE_STYLES, salutationFor, type AddressForm, type ToneSetting, type ToneStyle } from "@/lib/contacts/tone";
import { cn } from "@/lib/utils";

export interface ToneChange {
  salutation: string;
  setting: ToneSetting;
  /** Uživatel právě změnil (ne jen načtení). */
  changed: boolean;
}

/**
 * „Já a tento kontakt: Tykáme / Vykáme" — jedním klepnutím uloží MOJE nastavení pro adresu (každý
 * uživatel má vlastní). Ukáže oslovení, které AI použije, a návrh z dřívější pošty („psal jsi Ahoj").
 */
export function ToneToggle({
  email, nameHint, onChange, label = "Oslovení", className, compact,
}: {
  email: string | null | undefined;
  nameHint?: string | null;
  onChange?: (c: ToneChange) => void;
  label?: string;
  className?: string;
  /** Jen přepínač a oslovení (okno psaní, dialog dokladu). */
  compact?: boolean;
}) {
  const [view, setView] = React.useState<ToneView | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<{ tone: ToneStyle; salutation: string }>({ tone: "formalni", salutation: "" });
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const target = (email ?? "").trim().toLowerCase();

  React.useEffect(() => {
    setView(null);
    setError(null);
    setEditing(false);
    if (!target || !target.includes("@")) return;
    let alive = true;
    void getToneAction(target, nameHint ?? null).then((r) => {
      if (!alive || !r.ok || !r.tone) return;
      const tone = r.tone;
      setView(tone);
      onChangeRef.current?.({ salutation: tone.salutation, setting: tone.setting, changed: false });
    }).catch(() => {});
    return () => { alive = false; };
  }, [target, nameHint]);

  if (!target || !target.includes("@")) return null;

  async function save(address: AddressForm, extra: { tone?: ToneStyle; salutation?: string | null; fromSuggestion?: boolean } = {}) {
    if (!view) return;
    setBusy(true);
    setError(null);
    const tone = extra.tone ?? (address === view.setting.address ? view.setting.tone : address === "ty" ? "pratelsky" : "formalni");
    // přepnutí ty ↔ vy zahodí vlastní oslovení („Ahoj Pavle" k vykání nesedí)
    const salutation = extra.salutation !== undefined ? extra.salutation : address === view.setting.address ? view.setting.salutation : null;
    const res = await saveToneAction(view.email, { address, tone, salutation, fromSuggestion: extra.fromSuggestion }, view.name).catch(() => null);
    setBusy(false);
    if (!res?.ok || !res.setting || res.salutation === undefined) {
      setError(res?.error ?? "Uložení se nepovedlo.");
      return;
    }
    const next: ToneView = { ...view, setting: res.setting, saved: true, salutation: res.salutation, suggestion: null };
    setView(next);
    setEditing(false);
    onChangeRef.current?.({ salutation: res.salutation, setting: res.setting, changed: true });
  }

  const current = view?.setting.address ?? "vy";
  return (
    <div className={cn("space-y-1.5", className)} data-testid="tone-toggle" data-address={view ? current : undefined}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <div className="inline-flex rounded-full border bg-background p-0.5" role="group" aria-label="Tykání nebo vykání">
          {(["vy", "ty"] as const).map((a) => (
            <button
              key={a}
              type="button"
              disabled={!view || busy}
              aria-pressed={current === a}
              onClick={() => current !== a && void save(a)}
              className={cn(
                "min-h-8 rounded-full px-3 text-xs font-medium transition",
                current === a ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {a === "ty" ? "Tykáme" : "Vykáme"}
            </button>
          ))}
        </div>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
        {view && (
          <span className="min-w-0 truncate text-muted-foreground" data-testid="tone-salutation">
            „{view.salutation}“{!compact && ` · ${TONE_LABEL[view.setting.tone]}`}
          </span>
        )}
        {view && !editing && (
          <button
            type="button"
            onClick={() => { setDraft({ tone: view.setting.tone, salutation: view.setting.salutation ?? "" }); setEditing(true); }}
            className="inline-flex items-center gap-0.5 rounded px-1 text-muted-foreground hover:text-foreground"
            aria-label="Upravit oslovení a tón"
            title="Upravit oslovení a tón"
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
      </div>
      {view?.suggestion && !view.saved && view.setting.address === "vy" && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-violet-50 px-2.5 py-1.5 text-xs text-violet-900 dark:bg-violet-500/10 dark:text-violet-200" data-testid="tone-suggestion">
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            Dřív jste si psali {view.suggestion.salutation ? <b>„{view.suggestion.salutation}“</b> : "s tykáním"} — tykáte si?
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save("ty", { tone: "pratelsky", salutation: view.suggestion?.salutation ?? null, fromSuggestion: true })}
            className="rounded-full bg-violet-600 px-2.5 py-1 font-medium text-white hover:bg-violet-700"
          >
            Ano, tykáme
          </button>
        </div>
      )}
      {editing && view && (
        <div className="space-y-2 rounded-lg border bg-muted/40 p-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground">Tón:</span>
            {TONE_STYLES.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={draft.tone === t}
                onClick={() => setDraft((d) => ({ ...d, tone: t }))}
                className={cn("min-h-8 rounded-full border px-2.5", draft.tone === t ? "border-foreground bg-foreground text-background" : "bg-background")}
              >
                {TONE_LABEL[t]}
              </button>
            ))}
          </div>
          <label className="block space-y-1">
            <span className="text-muted-foreground">Vlastní oslovení (nepovinné)</span>
            <input
              value={draft.salutation}
              onChange={(e) => setDraft((d) => ({ ...d, salutation: e.target.value }))}
              placeholder={salutationFor({ address: current, tone: draft.tone, salutation: null }, view.name)}
              maxLength={120}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              aria-label="Vlastní oslovení"
            />
          </label>
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => setEditing(false)} className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 hover:bg-background">
              <X className="h-3.5 w-3.5" /> Zrušit
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void save(current, { tone: draft.tone, salutation: draft.salutation.trim() || null })}
              className="inline-flex min-h-8 items-center gap-1 rounded-md bg-foreground px-2.5 font-medium text-background"
            >
              <Check className="h-3.5 w-3.5" /> Uložit
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
