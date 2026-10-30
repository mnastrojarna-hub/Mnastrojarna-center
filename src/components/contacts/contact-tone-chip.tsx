"use client";

import * as React from "react";
import { Loader2, MessageCircleHeart, X } from "lucide-react";
import { saveToneAction } from "@/app/actions/contacts";
import { ToneToggle } from "@/components/contacts/tone-toggle";
import type { AddressForm } from "@/lib/contacts/tone";
import { cn } from "@/lib/utils";

/**
 * U kontaktní osoby: „Já a tento kontakt: Vykáme / Tykáme" — jedním klepnutím (vždy jen moje nastavení,
 * kolega si nastaví vlastní). „Oslovení…" otevře podrobnosti (tón, vlastní oslovení, návrh z pošty).
 */
export function ContactToneChip({
  email, name, initial, summary,
}: {
  email: string | null;
  name: string;
  /** Moje uložené nastavení (bez něj výchozí vykání). */
  initial?: AddressForm | null;
  summary?: string | null;
}) {
  const [address, setAddress] = React.useState<AddressForm>(initial ?? "vy");
  const [busy, setBusy] = React.useState(false);
  const [detail, setDetail] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => setAddress(initial ?? "vy"), [initial]);

  if (!email) {
    return <p className="text-[11px] text-muted-foreground">Tykání nastavíš po doplnění e-mailu.</p>;
  }

  async function set(a: AddressForm) {
    if (a === address || !email) return;
    setBusy(true);
    setError(null);
    const res = await saveToneAction(email, { address: a }, name).catch(() => null);
    setBusy(false);
    if (!res?.ok) setError(res?.error ?? "Uložení se nepovedlo.");
    else setAddress(a);
  }

  return (
    <div className="space-y-1.5" data-testid="contact-tone" data-email={email} data-address={address}>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="text-muted-foreground">Já a tento kontakt:</span>
        <div className="inline-flex rounded-full border bg-background p-0.5" role="group" aria-label={`Tykání s ${name}`}>
          {(["vy", "ty"] as const).map((a) => (
            <button
              key={a}
              type="button"
              disabled={busy}
              aria-pressed={address === a}
              onClick={() => void set(a)}
              className={cn("min-h-7 rounded-full px-2.5 font-medium", address === a ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
            >
              {a === "ty" ? "Tykáme" : "Vykáme"}
            </button>
          ))}
        </div>
        {busy && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        <button
          type="button"
          onClick={() => setDetail((d) => !d)}
          className="inline-flex items-center gap-0.5 rounded px-1 text-muted-foreground hover:text-foreground"
          aria-expanded={detail}
        >
          {detail ? <X className="h-3 w-3" /> : <MessageCircleHeart className="h-3 w-3" />} Oslovení…
        </button>
      </div>
      {!detail && summary && <p className="text-[11px] text-muted-foreground">{summary}</p>}
      {detail && (
        <ToneToggle
          email={email}
          nameHint={name}
          label="Oslovení"
          className="rounded-lg border bg-muted/30 p-2"
          onChange={(c) => setAddress(c.setting.address)}
        />
      )}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
