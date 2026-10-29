"use client";

import * as React from "react";
import { MessagesSquare } from "lucide-react";
import { getJobCommunicationAction } from "@/app/actions/mail-jobs";
import type { JobCommunication } from "@/lib/data/job-mail";

/**
 * Pošta B — data Komunikace zakázky pro kartu zakázky (záložka Komunikace, pokyny z e-mailu
 * v Položkách). Načte stránka; po akci se obnoví akcí getJobCommunicationAction.
 */

interface JobMailValue {
  data: JobCommunication | null;
  refresh: () => Promise<void>;
  loading: boolean;
}

const Ctx = React.createContext<JobMailValue | null>(null);

export function JobMailProvider({ jobId, initial, children }: { jobId: string; initial: JobCommunication | null; children: React.ReactNode }) {
  const [data, setData] = React.useState<JobCommunication | null>(initial);
  const [loading, setLoading] = React.useState(false);
  // nová data ze serveru (router.refresh) převzít
  const [lastInitial, setLastInitial] = React.useState(initial);
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setData(initial);
  }
  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const next = await getJobCommunicationAction(jobId);
      if (next) setData(next);
    } finally {
      setLoading(false);
    }
  }, [jobId]);
  const value = React.useMemo(() => ({ data, refresh, loading }), [data, refresh, loading]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Data Komunikace (mimo provider null — karta zakázky funguje i bez pošty). */
export function useJobMail(): JobMailValue | null {
  return React.useContext(Ctx);
}

/** Počet vláken k zakázce (odznak záložky). */
export function useJobMailCount(): number {
  const v = React.useContext(Ctx);
  return (v?.data?.threads.length ?? 0) + (v?.data?.suggestions.length ?? 0);
}

/** Záložka Komunikace v kartě zakázky (popisek, ikona, barvy — stejný tvar jako ostatní záložky). */
export const COMMUNICATION_TAB = {
  key: "komunikace" as const,
  label: "Komunikace",
  icon: MessagesSquare,
  tone: "text-fuchsia-600 dark:text-fuchsia-400",
  count: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/20 dark:text-fuchsia-300",
};
