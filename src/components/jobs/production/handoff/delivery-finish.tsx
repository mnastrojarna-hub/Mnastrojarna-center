"use client";

import * as React from "react";
import { DeliveryDialog } from "@/components/jobs/production/delivery-dialog";
import { ProductionHandoffDialog } from "./handoff-dialog";

/**
 * „Zapsat dodání" u zakázky, která je ještě ve výrobě s otevřenými kroky (spec C.3): nejdřív „Ukončit
 * výrobu" (kroky hotové / přeskočené, neodeslané objednávky dalších kroků se zruší), pak dialog dodání.
 * Nikdy neblokuje: „Zapsat dodání bez ukončení kroků" otevře dodání rovnou (postaru).
 */
export function DeliveryAfterFinish({
  jobId, items, stepLabel, onClose, onDone, onSplitItems,
}: {
  jobId: string;
  items: React.ComponentProps<typeof DeliveryDialog>["items"];
  /** Aktuální krok výroby („Výroba · Frézy Novák") do upozornění. */
  stepLabel?: string | null;
  onClose: (open: boolean) => void;
  onDone: (message: string) => void;
  onSplitItems?: () => void;
}) {
  const [phase, setPhase] = React.useState<"finish" | "delivery">("finish");
  // přechod na dodání: zavření dialogu výroby nesmí zavřít celý tok
  const advancing = React.useRef(false);
  const toDelivery = React.useCallback(() => {
    advancing.current = true;
    setPhase("delivery");
  }, []);

  if (phase === "finish") {
    return (
      <ProductionHandoffDialog
        open
        onOpenChange={(o) => { if (!o && !advancing.current) onClose(false); }}
        jobId={jobId}
        kind="ukonceni"
        intro={(
          <>
            <p className="font-medium">Výroba ještě běží{stepLabel ? ` (${stepLabel})` : ""} — nejdřív ji ukonči, pak zapíšeš dodání zákazníkovi.</p>
            <p className="text-xs">Zbylé kroky se přeskočí a jejich neodeslané objednávky se zruší, aby je nikdo neposlal dodavateli.</p>
          </>
        )}
        plainAction={{ label: "Zapsat dodání bez ukončení kroků", run: toDelivery }}
        onDone={toDelivery}
      />
    );
  }
  return (
    <DeliveryDialog
      open
      onOpenChange={onClose}
      jobId={jobId}
      items={items}
      mode="record"
      onDone={onDone}
      onSplitItems={onSplitItems}
    />
  );
}
