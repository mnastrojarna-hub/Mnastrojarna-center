"use client";

import { Camera, FileText, ReceiptText, Truck } from "lucide-react";
import type { JobDetail } from "@/lib/jobs/types";
import type { JobFlowData } from "@/components/jobs/detail/job-detail-view";
import { useJobDetail } from "@/components/jobs/detail/detail-context";
import { DeliveryCard } from "./delivery-card";
import { ClosingCard } from "./closing-card";
import type { JobProductionData } from "./production-tab";

/**
 * Záložka „Dodání & faktura" (majitel 28. 11.: „práce s dodacím listem je v technologii dole, zapadnutá —
 * dodací list pro zákazníka v technologii nemá co dělat"). Celý konec zakázky na jednom místě a v pořadí:
 * zapsat dodání a vystavit DL → poslat / vytisknout k podpisu → vyfotit podepsaný DL → faktura → platba.
 * Dodací listy dodavatelů (dílčí výroba) zůstávají v Technologii / Nákupu.
 */
export function DeliveryTab({ job, data, flow }: { job: JobDetail; data: JobProductionData | null; flow: JobFlowData | null }) {
  const { perms } = useJobDetail();
  return (
    <div className="space-y-4">
      <ol className="grid gap-2 rounded-2xl border bg-card p-3 text-xs sm:grid-cols-4" aria-label="Postup dodání">
        {[
          { icon: Truck, title: "1. Zapsat dodání", text: "co odchází — vystaví se dodací list (PDF bez cen)" },
          { icon: FileText, title: "2. Poslat / vytisknout", text: "dodací list k podpisu při předání" },
          { icon: Camera, title: "3. Podepsaný DL", text: "vyfoť nebo nahraj — pak Dodáno zákazníkovi" },
          { icon: ReceiptText, title: "4. Faktura a platba", text: "faktura až po podepsaném DL" },
        ].map((s) => (
          <li key={s.title} className="flex items-start gap-2">
            <s.icon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
            <span><span className="font-semibold text-foreground">{s.title}</span><span className="block text-muted-foreground">{s.text}</span></span>
          </li>
        ))}
      </ol>
      <div className="grid gap-4 lg:grid-cols-2">
        <DeliveryCard job={job} />
        {data?.closing ? (
          <ClosingCard job={job} closing={data.closing} margins={perms.margins} payments={flow?.payments} stamps={flow?.stamps ?? null} />
        ) : (
          <p className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">Faktura a platba se ukážou, až bude zakázka objednaná.</p>
        )}
      </div>
    </div>
  );
}
