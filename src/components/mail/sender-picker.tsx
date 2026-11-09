"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { senderChoiceAction, senderSignatureAction } from "@/app/actions/mail-sender";
import type { SenderChoice } from "@/lib/email/sender-rules";
import { cn } from "@/lib/utils";

/**
 * „Odeslat z" v dialozích odeslání. Majitel 9. 11.: každý posílá ze své schránky — vidí jen „Odejde z: adresa";
 * super admin si vybere schránku (svou, firemní, kolegy), výchozí je jeho vlastní. Server volbu ověří znovu
 * (sender-rules.ts), takže ji nejde obejít.
 *
 * `value` null = výchozí (moje schránka; u odpovědi ta, kam e-mail přišel). `onSignatureChange` dostane
 * starý a nový podpis, když super admin přepne na schránku jiného vlastníka (dialog podpis v textu vymění).
 */
export function SenderPicker({
  value, onChange, onSignatureChange, sourceEmailId, className, disabled, compact, adminOnly, fromTestId,
}: {
  value: string | null;
  onChange: (mailboxId: string | null) => void;
  onSignatureChange?: (prev: string, next: string) => void;
  sourceEmailId?: string | null;
  className?: string;
  disabled?: boolean;
  /** Bez popisku „Odeslat z" (řádek fronty). */
  compact?: boolean;
  /** Ostatním nic neukazovat (dialog adresu odesílatele ukazuje sám). */
  adminOnly?: boolean;
  /** Pod výběrem i řádek „Odešle se z <adresa>" se zvolenou adresou (data-testid — nové okno e-mailu). */
  fromTestId?: string;
}) {
  const [choice, setChoice] = useState<SenderChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    senderChoiceAction({ sourceEmailId: sourceEmailId ?? null })
      .then((r) => {
        if (!alive.current) return;
        if (r.ok) setChoice(r.choice);
        else setError(r.error);
      })
      .catch(() => alive.current && setError("Odesílatele se nepodařilo zjistit."));
    return () => {
      alive.current = false;
    };
  }, [sourceEmailId]);

  if (adminOnly && (!choice || !choice.canChoose)) return null;
  if (error) return <p className={cn("text-xs text-destructive", className)}>{error}</p>;
  if (!choice) {
    return (
      <p className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
        <Loader2 className="h-3 w-3 animate-spin" /> Zjišťuji, odkud se odešle…
      </p>
    );
  }

  if (!choice.canChoose) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)} data-testid="sender-line">
        {choice.defaultEmail
          ? <>Odejde z: <b className="font-medium text-foreground">{choice.defaultEmail}</b></>
          : <span className="text-destructive">{choice.error ?? "Nemáš nastavenou schránku pro odesílání."}</span>}
      </p>
    );
  }

  const current = value ?? choice.defaultMailboxId ?? "";
  const hasDefault = choice.options.some((o) => o.id === choice.defaultMailboxId);

  async function pick(next: string) {
    const nextValue = !next || next === choice!.defaultMailboxId ? null : next;
    if (nextValue === value) return;
    if (onSignatureChange) {
      setBusy(true);
      try {
        const src = { sourceEmailId: sourceEmailId ?? null };
        const [a, b] = await Promise.all([senderSignatureAction(value, src), senderSignatureAction(nextValue, src)]);
        if (a.ok && b.ok && a.signature !== b.signature) onSignatureChange(a.signature, b.signature);
      } catch {
        // podpis je pohodlí — schránka se změní i tak
      } finally {
        setBusy(false);
      }
    }
    onChange(nextValue);
  }

  return (
    <label className={cn("flex flex-wrap items-center gap-2 text-xs text-muted-foreground", className)} data-testid="sender-picker">
      {!compact && <span className="shrink-0">Odeslat z:</span>}
      <select
        aria-label="Odeslat z"
        value={current}
        disabled={disabled || busy}
        onChange={(e) => void pick(e.target.value)}
        className="h-9 min-w-0 max-w-full flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground"
      >
        {!hasDefault && <option value={choice.defaultMailboxId ?? ""}>{choice.defaultEmail ? `${choice.defaultEmail} · výchozí` : "výchozí"}</option>}
        {choice.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {fromTestId && (() => {
        const email = choice.options.find((o) => o.id === current)?.email ?? choice.defaultEmail;
        return (
          <span className="basis-full" data-testid={fromTestId}>
            {email ? <>Odešle se z <b className="text-foreground">{email}</b></> : choice.error ?? "Odešle se přes firemní odesílání."}
          </span>
        );
      })()}
    </label>
  );
}

/** Vymění podpis v textu (je-li tam starý); jinak text nechá. */
export function swapSignature(body: string, prev: string, next: string): string {
  const p = prev.trim();
  if (!p || !body.includes(p)) return body;
  return body.replace(p, next.trim());
}
