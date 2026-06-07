"use client";

import * as React from "react";
import { Bot, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

type Mode = "full" | "approval";

const modules = [
  { key: "categorize", label: "Kategorizace e-mailů", desc: "Třídění příchozí pošty do kategorií", recommended: "full" },
  { key: "spam", label: "Filtrování spamu", desc: "Automatické odstranění spamu", recommended: "full" },
  { key: "reply", label: "Odpovědi na e-maily", desc: "Odesílání připravených odpovědí", recommended: "approval" },
  { key: "quote", label: "Generování nabídek", desc: "Vytvoření a odeslání nabídky", recommended: "approval" },
  { key: "supplier", label: "Poptávky dodavatelům", desc: "Odeslání poptávky materiálu", recommended: "approval" },
  { key: "order", label: "Párování objednávek", desc: "Spárování objednávky s nabídkou", recommended: "full" },
  { key: "drawing", label: "Extrakce z výkresů", desc: "Čtení metadat z PDF/STEP/DXF", recommended: "full" },
] as const;

export function AutomationSettings() {
  const [state, setState] = React.useState<Record<string, Mode>>(() =>
    Object.fromEntries(modules.map((m) => [m.key, m.recommended as Mode])),
  );

  return (
    <div className="divide-y">
      {modules.map((m) => (
        <div key={m.key} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
          <div className="min-w-0">
            <div className="text-sm font-medium">{m.label}</div>
            <div className="text-xs text-muted-foreground">{m.desc}</div>
          </div>
          <div className="inline-flex shrink-0 items-center rounded-lg border bg-card p-0.5 text-xs font-medium">
            <button
              onClick={() => setState((s) => ({ ...s, [m.key]: "full" }))}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors",
                state[m.key] === "full" ? "bg-success/15 text-success" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Bot className="h-3.5 w-3.5" /> 100 %
            </button>
            <button
              onClick={() => setState((s) => ({ ...s, [m.key]: "approval" }))}
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
