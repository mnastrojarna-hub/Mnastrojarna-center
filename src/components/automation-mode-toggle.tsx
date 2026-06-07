"use client";

import { Bot, ShieldCheck } from "lucide-react";
import { useAutomation } from "@/components/automation-provider";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

export function AutomationModeToggle() {
  const { mode, setMode } = useAutomation();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="inline-flex items-center rounded-lg border bg-card p-0.5 text-xs font-medium">
          <button
            onClick={() => setMode("full")}
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
            onClick={() => setMode("approval")}
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
      <TooltipContent className="max-w-[220px] text-center">
        {mode === "full"
          ? "AI provádí akce samostatně. Ručně koriguješ jen výjimky."
          : "AI vše připraví, ty jen jedním klikem schválíš nebo upravíš."}
      </TooltipContent>
    </Tooltip>
  );
}
