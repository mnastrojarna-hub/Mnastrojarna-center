"use client";

import * as React from "react";
import { Bot, ShieldCheck } from "lucide-react";
import { setModuleMode } from "@/app/actions/automation";
import { cn } from "@/lib/utils";

type Mode = "full" | "approval";

// Klíče odpovídají DB tabulce automation_settings (migrace 0006).
const modules = [
  { key: "categorize", label: "Kategorizace e-mailů", desc: "Třídění příchozí pošty do kategorií", recommended: "full" },
  { key: "spam", label: "Filtrování spamu", desc: "Automatické odstranění spamu", recommended: "full" },
  { key: "reply", label: "Odpovědi na e-maily", desc: "Odesílání připravených odpovědí", recommended: "approval" },
  { key: "quote", label: "Generování nabídek", desc: "Vytvoření a odeslání nabídky", recommended: "approval" },
  { key: "supplier_request", label: "Poptávky dodavatelům", desc: "Odeslání poptávky materiálu", recommended: "approval" },
  { key: "order_match", label: "Párování objednávek", desc: "Spárování objednávky s nabídkou", recommended: "full" },
  { key: "drawing_extract", label: "Extrakce z výkresů", desc: "Čtení metadat z PDF/STEP/DXF", recommended: "full" },
] as const;

export function AutomationSettings({ initial }: { initial?: Record<string, Mode> }) {
  const [state, setState] = React.useState<Record<string, Mode>>(() =>
    Object.fromEntries(modules.map((m) => [m.key, (initial?.[m.key] ?? m.recommended) as Mode])),
  );
  const [saved, setSaved] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const set = async (key: string, mode: Mode) => {
    setState((s) => ({ ...s, [key]: mode }));
    setError(null);
    const res = await setModuleMode(key, mode);
    if (res.ok) {
      setSaved(key);
      setTimeout(() => setSaved((k) => (k === key ? null : k)), 1500);
    } else {
      setError(res.error ?? "Nepodařilo se uložit.");
    }
  };

  return (
    <div className="divide-y">
      {error && <p className="pb-2 text-sm text-destructive">{error}</p>}
      {modules.map((m) => (
        <div key={m.key} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium">
              {m.label}
              {saved === m.key && <span className="text-xs text-success">uloženo</span>}
            </div>
            <div className="text-xs text-muted-foreground">{m.desc}</div>
          </div>
          <div className="inline-flex shrink-0 items-center rounded-lg border bg-card p-0.5 text-xs font-medium">
            <button
              onClick={() => set(m.key, "full")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors",
                state[m.key] === "full" ? "bg-success/15 text-success" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Bot className="h-3.5 w-3.5" /> 100 %
            </button>
            <button
              onClick={() => set(m.key, "approval")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors",
                state[m.key] === "approval" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <ShieldCheck className="h-3.5 w-3.5" /> Schválení
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
