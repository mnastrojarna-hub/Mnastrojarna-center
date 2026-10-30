"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { nudgeAnonymize } from "@/lib/anonymize/nudge-client";

/**
 * Neviditelný pomocník stránek se seznamem výkresů (Poptávky, Archiv výkresů): čekají-li výkresy na
 * anonymizaci, šťouchne do fronty (zpracuje route na serveru — bez plánovače i bez CRON_SECRET) a po
 * chvíli obnoví stránku, nejvýš ~5× (pak už jen při další návštěvě). Nic nevykresluje.
 */
export function AnonQueueNudge({ table = "job_files", ids, intervalMs = 25_000, rounds = 5 }: {
  table?: "job_files" | "drawings";
  ids: string[];
  intervalMs?: number;
  rounds?: number;
}) {
  const router = useRouter();
  const key = ids.slice(0, 200).join(",");
  React.useEffect(() => {
    if (!key) return;
    const list = key.split(",");
    let n = 0;
    let cancelled = false;
    void nudgeAnonymize({ table, fileIds: list });
    const t = window.setInterval(() => {
      if (cancelled) return;
      n += 1;
      router.refresh();
      if (n >= rounds) window.clearInterval(t);
      else void nudgeAnonymize({ table, fileIds: list });
    }, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [key, table, intervalMs, rounds, router]);
  return null;
}
