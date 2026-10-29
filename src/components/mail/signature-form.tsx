"use client";

import * as React from "react";
import { CheckCircle2, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { saveSignatureAction } from "@/app/actions/mail-compose";

/** Můj účet → podpis e-mailu (vloží se pod každou novou zprávu, odpověď i přeposlání). */
export function SignatureForm({ initial }: { initial: string }) {
  const [text, setText] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<{ ok: boolean; text: string } | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    const r = await saveSignatureAction(text).catch(() => ({ ok: false, error: "Spojení se nepovedlo." }));
    setBusy(false);
    setStatus(r.ok ? { ok: true, text: "Podpis uložen." } : { ok: false, text: r.error ?? "Uložení se nepovedlo." });
  };
  return (
    <form onSubmit={save} className="space-y-2" data-testid="signature-form">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={2000} placeholder={"Jan Novák\nobchod | Mnástrojárna s.r.o.\n+420 …"} aria-label="Podpis e-mailu" />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" variant="outline" disabled={busy || text === initial}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Uložit podpis
        </Button>
        {status && <span className={status.ok ? "inline-flex items-center gap-1 text-xs text-success" : "text-xs text-destructive"}>{status.ok && <CheckCircle2 className="h-3.5 w-3.5" />}{status.text}</span>}
      </div>
    </form>
  );
}
