"use client";

import * as React from "react";
import { applyMailChangeAction, dismissMailChangeAction, undoMailChangeAction } from "@/app/actions/mail-jobs";
import { useJobDetail } from "@/components/jobs/detail/detail-context";
import { useJobMail } from "./job-mail-context";

/** Vrátit / potvrdit / zahodit změnu z e-mailu — po akci obnoví Komunikaci i kartu zakázky. */
export function useMailChangeActions() {
  const { notify, refresh } = useJobDetail();
  const mail = useJobMail();
  const [busy, setBusy] = React.useState<string | null>(null);
  const run = React.useCallback(async (id: string, fn: (id: string) => Promise<{ ok: boolean; error?: string }>, ok: string) => {
    setBusy(id);
    try {
      const r = await fn(id);
      if (!r.ok) {
        notify("error", r.error ?? "Nepodařilo se.");
        return;
      }
      notify("success", ok);
      await mail?.refresh();
      refresh();
    } catch {
      notify("error", "Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(null);
    }
  }, [mail, notify, refresh]);
  return {
    busy,
    undo: (id: string) => run(id, undoMailChangeAction, "Vráceno — položka má zase původní hodnotu."),
    apply: (id: string) => run(id, applyMailChangeAction, "Propsáno."),
    dismiss: (id: string) => run(id, dismissMailChangeAction, "Návrh zahozen."),
  };
}
