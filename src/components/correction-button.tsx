"use client";

import * as React from "react";
import { Wand2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { recordCorrection } from "@/app/actions/corrections";
import { cn } from "@/lib/utils";

/**
 * Znovupoužitelná korekce výstupu AI. Uloží opravu pro daného agenta,
 * která se vloží do promptů → AI stejnou chybu v plné automatice neudělá.
 */
export function CorrectionButton({
  agentKey,
  field,
  context,
  aiValue,
  label = "Oprav (AI se naučí)",
  multiline = false,
  className,
}: {
  agentKey: string;
  field: string;
  context: string;
  aiValue?: string;
  label?: string;
  multiline?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [corrected, setCorrected] = React.useState("");
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const save = async () => {
    if (!corrected.trim() && !note.trim()) {
      setError("Vyplň správnou hodnotu nebo pravidlo.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await recordCorrection({
      agentKey,
      field,
      context,
      aiValue,
      correctedValue: corrected.trim() || note.trim(),
      note: note.trim() || undefined,
    });
    setSaving(false);
    if (res.ok) {
      setDone(true);
      setOpen(false);
    } else {
      setError(res.error ?? "Chyba");
    }
  };

  if (done) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-xs text-success", className)}>
        <Check className="h-3.5 w-3.5" /> Korekce uložena — AI se poučí.
      </span>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary", className)}
      >
        <Wand2 className="h-3.5 w-3.5" /> {label}
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="text-xs font-medium">Oprava — AI si zapamatuje a nezopakuje</div>
      {multiline ? (
        <Textarea value={corrected} onChange={(e) => setCorrected(e.target.value)} placeholder="Správná hodnota / správné znění" className="min-h-[70px]" />
      ) : (
        <Input value={corrected} onChange={(e) => setCorrected(e.target.value)} placeholder="Správná hodnota" />
      )}
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Pravidlo k zapamatování (např. kalení vždy +15 %)" />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={saving}>Uložit korekci</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Zrušit</Button>
      </div>
    </div>
  );
}
