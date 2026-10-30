"use client";

import * as React from "react";
import { ShieldCheck } from "lucide-react";
import { useJobMail } from "./job-mail-context";
import { MailChangeCard } from "./mail-change-card";
import { useMailChangeActions } from "./use-mail-change-actions";

/**
 * Položky: pokyny zákazníka z e-mailu, které přebíjejí výkres (propsané i čekající návrhy) — u každé
 * odznak „Pokyn zákazníka z e-mailu {datum} — nadřazeno výkresu", hodnota výkresu přeškrtnutá, Vrátit.
 */
export function MailOverridesPanel() {
  const mail = useJobMail();
  const actions = useMailChangeActions();
  const list = (mail?.data?.changes ?? []).filter((c) => c.kind === "change" && (c.status === "applied" || c.status === "suggested"));
  if (!list.length) return null;
  return (
    <section className="space-y-2 rounded-xl border border-fuchsia-200 bg-fuchsia-50/40 p-3 dark:border-fuchsia-500/30 dark:bg-fuchsia-500/5" data-testid="mail-overrides">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-fuchsia-900 dark:text-fuchsia-200">
        <ShieldCheck className="h-4 w-4" /> Pokyny zákazníka z e-mailu — nadřazené výkresu
      </h3>
      <ul className="grid gap-2 lg:grid-cols-2">
        {list.map((c) => (
          <MailChangeCard
            key={c.id}
            c={c}
            compact
            busy={actions.busy === c.id}
            onUndo={() => void actions.undo(c.id)}
            onApply={() => void actions.apply(c.id)}
            onDismiss={() => void actions.dismiss(c.id)}
          />
        ))}
      </ul>
    </section>
  );
}
