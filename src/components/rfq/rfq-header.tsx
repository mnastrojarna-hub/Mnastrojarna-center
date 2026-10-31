"use client";

import * as React from "react";
import Link from "next/link";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRfq } from "./rfq-context";

/** Fáze, ve kterých se poptává (zákazník čeká na naši nabídku). */
export const RFQ_STAGES = ["poptavka", "naceneni", "nabidka"];

/**
 * Hlavička karty zakázky vedle dalšího kroku: v poptávce / nacenění bez poptávky u dodavatelů výrazné
 * „Poptat dodavatele"; s kolem shrnutí „PD-… · Poptáno: 3 · odpověděli 1" (odkaz do Nákupu).
 */
export function RfqHeaderAction({ stage, className }: { stage: string; className?: string }) {
  const rfq = useRfq();
  if (!rfq?.canRfq || !RFQ_STAGES.includes(stage)) return null;
  if (rfq.summary) {
    return (
      <Link
        href={`/orders/${rfq.jobId}?tab=nakup`}
        className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-md border border-orange-300 bg-orange-50 px-3 text-sm font-medium text-orange-800 hover:bg-orange-100 sm:min-h-9 dark:border-orange-500/40 dark:bg-orange-500/10 dark:text-orange-200", className)}
        data-testid="rfq-header-summary"
      >
        <Send className="h-4 w-4" /> {rfq.summary.number} · {rfq.summary.text}
      </Link>
    );
  }
  return (
    <Button type="button" variant="outline" className={cn("min-h-11 border-orange-400 text-orange-800 hover:bg-orange-50 sm:min-h-9 dark:text-orange-200", className)} onClick={() => rfq.open()} data-testid="rfq-header-open">
      <Send className="h-4 w-4" /> Poptat dodavatele
    </Button>
  );
}
