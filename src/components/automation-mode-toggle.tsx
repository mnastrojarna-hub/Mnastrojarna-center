"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bot, ShieldCheck } from "lucide-react";
import { useAutomation } from "@/components/automation-provider";
import { getGlobalModeAction, setGlobalMode } from "@/app/actions/automation";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

/**
 * Hlavní vypínač automatiky (automation_global). 16. 11.: stav se bere z DATABÁZE (dřív jen z paměti prohlížeče,
 * takže nahoře mohlo svítit „Se schválením", zatímco systém běžel na plnou automatiku); změnu smí jen super admin
 * a při chybě se přepínač vrátí a ukáže proč.
 */
export function AutomationModeToggle() {
  const { mode, setMode } = useAutomation();
  const router = useRouter();
  const [canChange, setCanChange] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    getGlobalModeAction()
      .then((r) => {
        if (!alive || !r.ok) return;
        setMode(r.mode);
        setCanChange(r.canChange);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [setMode]);

  const choose = async (m: "full" | "approval") => {
    if (m === mode || busy) return;
    if (!canChange) {
      setError("Režim automatiky mění jen super admin.");
      return;
    }
    const prev = mode;
    setMode(m);
    setBusy(true);
    setError(null);
    const res = await setGlobalMode(m).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : "Chyba" }));
    setBusy(false);
    if (!res.ok) {
      setMode(prev);
      setError(`Nepodařilo se uložit: ${res.error ?? "chyba"}`);
      return;
    }
    router.refresh();
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="inline-flex items-center rounded-lg border bg-card p-0.5 text-xs font-medium" data-testid="automation-global" data-mode={mode}>
          <button
            onClick={() => void choose("full")}
            disabled={busy}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors",
              mode === "full"
                ? "bg-success/15 text-success"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Bot className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Plná automatika</span>
            <span className="sm:hidden">Auto</span>
          </button>
          <button
            onClick={() => void choose("approval")}
            disabled={busy}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors",
              mode === "approval"
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Se schválením</span>
            <span className="sm:hidden">Schvál.</span>
          </button>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-[240px] text-center">
        {error
          ? error
          : mode === "full"
            ? "AI provádí akce samostatně podle nastavení modulů (Ladění → Automatizace). Ručně koriguješ jen výjimky."
            : "Hlavní vypínač: VŠE se schválením — AI připraví, ty jedním klikem schválíš nebo upravíš (platí pro všechny moduly)."}
      </TooltipContent>
    </Tooltip>
  );
}
