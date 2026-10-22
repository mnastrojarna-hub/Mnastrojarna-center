"use client";

// DOČASNÝ STUB — záložku „Výroba" dodá modul výroby. Rozhraní (props) je závazné.

import type { JobDetail } from "@/lib/jobs/types";
import type { JobOperation, JobProductionSummary, JobClosingInfo } from "@/lib/jobs/production-types";

export interface JobProductionData {
  operations: JobOperation[];
  summary: JobProductionSummary;
  closing: JobClosingInfo | null;
}

export function ProductionTab({ data }: { job: JobDetail; data: JobProductionData | null }) {
  return (
    <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
      Výrobní postup: {data ? `${data.summary.done}/${data.summary.total} operací hotovo` : "bez dat"}.
    </div>
  );
}
