"use client";

import * as React from "react";
import { CountChips } from "@/components/flow-status/count-chips";
import { useBookNav } from "@/components/jobs/book/book-nav";
import { chipsForTab } from "@/lib/jobs/flow-status";
import type { InquiryStatus } from "@/lib/supabase/database.types";

/**
 * Chipy podrobných stavů v Knize: segment Objednávky = doklad a plnění (Doručená · Rozpor ·
 * Aktualizovaná · Potvrzená · Ve výrobě · Částečně dodaná · Dokončená · Stornovaná), segment
 * Poptávky = stav poptávky. Počty z flow_counts (uzavřené stavy za posledních 30 dní).
 */
/** V Knize vedle záložek hlavního stavu („Ve výrobě", „Dokončené") jiná slova pro doklad a plnění. */
const BOOK_LABELS: Record<string, string> = {
  "order.potvrzena": "Doklad potvrzen",
  "fulfilment.ve_vyrobe": "Plnění: ve výrobě",
  "fulfilment.dokoncena": "Vše dodáno",
};

export function FlowFilterChips({ counts }: { counts: Record<string, number> }) {
  const { params, navigate } = useBookNav();
  if (params.segment === "objednavky") {
    const chips = chipsForTab("confirmations", counts).map((c) => ({ ...c, label: BOOK_LABELS[`${c.phase}.${c.key}`] ?? c.label }));
    return (
      <CountChips
        label="Stav objednávky"
        chips={chips}
        selected={params.order}
        onChange={(keys) => navigate({ order: keys })}
        sticky={false}
        className="-mx-1 px-1 py-0 sm:mx-0 sm:px-0"
      />
    );
  }
  if (params.segment === "poptavky") {
    return (
      <CountChips
        label="Stav poptávky"
        chips={chipsForTab("inquiries", counts)}
        selected={params.inquiry}
        onChange={(keys) => navigate({ inquiry: keys as InquiryStatus[] })}
        sticky={false}
        className="-mx-1 px-1 py-0 sm:mx-0 sm:px-0"
      />
    );
  }
  return null;
}
