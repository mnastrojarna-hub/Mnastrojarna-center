"use client";

// DOČASNÝ STUB — záložku „Nákup & marže" dodá modul nákupu. Rozhraní (props) je závazné.

import type { JobDetail } from "@/lib/jobs/types";
import type { JobPurchasing } from "@/lib/jobs/purchasing-types";

export function PurchasingTab({ data }: { job: JobDetail; data: JobPurchasing }) {
  return (
    <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
      Nabídky dodavatelů: {data.supplierQuotes.length} · objednávky dodavatelům: {data.purchaseOrders.length}.
    </div>
  );
}
