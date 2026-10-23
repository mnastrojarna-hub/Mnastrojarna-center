"use client";

import * as React from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveQuoteApprovalLimit } from "@/app/actions/integrations";

/** Volitelný limit schválení nabídek: nad částkou nabídku musí schválit člověk s právem (čtyři oči). */
export function ApprovalLimitCard({ initial }: { initial: number | null }) {
  const [value, setValue] = React.useState(initial ? String(initial) : "");
  const [saved, setSaved] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const parsed = value.trim() ? Number(value.replace(/\s/g, "").replace(",", ".")) : null;
  const invalid = parsed !== null && (!Number.isFinite(parsed) || parsed < 0);
  const dirty = (parsed ?? null) !== (saved ?? null);

  async function save(next: number | null) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await saveQuoteApprovalLimit(next);
      if (!res.ok) setMsg({ ok: false, text: res.error ?? "Uložení se nepovedlo." });
      else {
        setSaved(next);
        setValue(next ? String(next) : "");
        setMsg({ ok: true, text: next ? "Limit uložen — nové i upravené nabídky nad ním čekají na schválení." : "Limit vypnut." });
      }
    } catch {
      setMsg({ ok: false, text: "Spojení se nepovedlo — zkus to znovu." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) void save(parsed);
      }}
    >
      <label className="flex-1 space-y-1">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-violet-600" aria-hidden /> Limit schválení nabídky (Kč bez DPH)
        </span>
        <Input
          inputMode="decimal"
          value={value}
          onChange={(e) => { setValue(e.target.value); setMsg(null); }}
          placeholder="nevyplněno = vypnuto"
          aria-invalid={invalid || undefined}
          className="h-10 tabular-nums"
        />
        <span className="block text-[11px] text-muted-foreground">
          Nabídku nad limitem musí schválit obchodník s právem na marže; vlastní nabídku nad limitem jen super admin.
          AI nabídky v režimu „se schválením“ čekají na schválení vždy.
        </span>
        {msg && <span role="status" className={msg.ok ? "block text-xs text-emerald-700 dark:text-emerald-300" : "block text-xs text-red-600 dark:text-red-400"}>{msg.text}</span>}
      </label>
      <div className="flex gap-2">
        {saved ? (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void save(null)}>Vypnout</Button>
        ) : null}
        <Button type="submit" disabled={busy || invalid || !dirty} className="h-10">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Uložit limit
        </Button>
      </div>
    </form>
  );
}
