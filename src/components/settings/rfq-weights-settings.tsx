"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { saveRfqWeightsAction } from "@/app/actions/rfq";
import { DEFAULT_RFQ_WEIGHTS, normalizeWeights, type RfqWeights } from "@/lib/rfq/model";

/**
 * Nastavení → Doporučení dodavatele (poptávky dodavatelům): váhy ceny, termínu a kvality (super admin).
 * Součet vždy 100 % — ostatní dvě váhy se dorovnají v poměru.
 */
const LABELS: { key: keyof RfqWeights; label: string; hint: string }[] = [
  { key: "price", label: "Cena", hint: "proti nejlevnější nabídce pro poptané množství" },
  { key: "deadline", label: "Termín", hint: "stihne náš požadovaný termín, s jakou rezervou (pozdě = velká penalizace)" },
  { key: "quality", label: "Kvalita", hint: "hodnocení dodavatele, dodávky včas, zmetky a reklamace" },
];

export function RfqWeightsSettings({ initial }: { initial: RfqWeights }) {
  const [w, setW] = React.useState<RfqWeights>(initial);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  function change(key: keyof RfqWeights, value: number) {
    const others = LABELS.map((l) => l.key).filter((k) => k !== key);
    const rest = 100 - value;
    const sum = others.reduce((s, k) => s + w[k], 0);
    const next = { ...w, [key]: value } as RfqWeights;
    if (sum > 0) {
      next[others[0]] = Math.round((w[others[0]] / sum) * rest);
      next[others[1]] = rest - next[others[0]];
    } else {
      next[others[0]] = Math.round(rest / 2);
      next[others[1]] = rest - next[others[0]];
    }
    setW(normalizeWeights(next));
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await saveRfqWeightsAction(w);
      setMsg(r.ok ? { ok: true, text: "Uloženo — doporučení dodavatele počítá s novými váhami." } : { ok: false, text: r.error });
    } catch {
      setMsg({ ok: false, text: "Spojení se nepovedlo." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="rfq-weights">
      {LABELS.map((l) => (
        <label key={l.key} className="block space-y-1">
          <span className="flex items-baseline justify-between text-sm"><span className="font-medium">{l.label}</span><span className="tabular-nums font-semibold">{w[l.key]} %</span></span>
          <input type="range" min={0} max={100} step={5} value={w[l.key]} onChange={(e) => change(l.key, Number(e.target.value))} className="w-full accent-orange-600" aria-label={`Váha ${l.label}`} />
          <span className="block text-xs text-muted-foreground">{l.hint}</span>
        </label>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Uložit váhy</Button>
        <Button size="sm" variant="ghost" onClick={() => setW({ ...DEFAULT_RFQ_WEIGHTS })}>Výchozí 50 / 30 / 20</Button>
        {msg && <span className={msg.ok ? "text-xs text-emerald-700 dark:text-emerald-400" : "text-xs text-red-700 dark:text-red-300"}>{msg.text}</span>}
      </div>
    </div>
  );
}
