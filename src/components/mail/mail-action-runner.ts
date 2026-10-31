"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAccess } from "@/components/access-provider";
import { createJobFromEmail } from "@/app/actions/mail";
import { processOrderFromEmailAction, type OrderChoice } from "@/app/actions/mail-actions";
import { mailActionHref, type MailActionKey } from "@/lib/email/mail-actions";
import { flowActionHref } from "@/components/flow/flow-state";

/** Výsledek akce pro hlášku (volitelně s odkazem). */
export interface MailActionNotice {
  ok: boolean;
  text: string;
  href?: string;
  hrefLabel?: string;
}

export interface MailActionTarget {
  threadId: string;
  /** Zpráva, ke které akce patří (detail: poslední příchozí). */
  emailId: string;
  jobId?: string | null;
}

/**
 * Spuštění hlavní akce zprávy (Pošta → řádek i detail vlákna): Vytvořit nabídku (zakázka ve stavu
 * poptávka + editor nabídky), Zpracovat objednávku (spárovat / vybrat / založit), Zapsat fakturu
 * dodavatele, Založit zakázku, odkazy (Pokračovat v nabídce, Zapsat nabídku dodavatele, Otevřít zakázku).
 */
export function useMailActionRunner(opts: {
  onLinked: (threadId: string, jobId: string, jobNumber?: string) => void;
  onNotice: (n: MailActionNotice) => void;
  onChoices?: (threadId: string, choices: OrderChoice[]) => void;
}) {
  const router = useRouter();
  const { can } = useAccess();
  const [busy, setBusy] = React.useState<{ threadId: string; key: MailActionKey } | null>(null);
  const { onLinked, onNotice, onChoices } = opts;

  const run = React.useCallback(async (key: MailActionKey, t: MailActionTarget): Promise<void> => {
    const href = mailActionHref(key, t.jobId);
    if (href) {
      router.push(href);
      return;
    }
    if (key === "job.assign") return; // výběr zakázky dělá lišta zakázky (dialog)
    if (key === "invoice.record") {
      // 31. 10.: Zanést fakturu s přílohou e-mailu předvybranou → AI přečte → potvrzení s hlavičkou
      router.push(`/supplier-invoices/upload?email=${encodeURIComponent(t.emailId)}`);
      return;
    }
    setBusy({ threadId: t.threadId, key });
    let navigating = false;
    try {
      if (key === "quote.create" || key === "job.create") {
        const res = await createJobFromEmail(t.emailId);
        if (!res.ok || !res.id) return onNotice({ ok: false, text: res.error ?? "Zakázku se nepodařilo založit." });
        onLinked(t.threadId, res.id, res.number);
        navigating = true;
        // poptávka → rovnou editor nabídky (super admin přes Nacenění, ostatní karta zakázky → Nabídky)
        router.push(key === "quote.create" ? flowActionHref("quote.create", res.id, { canPrice: can("pricing") }) ?? `/orders/${res.id}` : `/orders/${res.id}`);
        return;
      }
      if (key === "order.process") {
        const r = await processOrderFromEmailAction(t.emailId);
        if (!r.ok) return onNotice({ ok: false, text: r.error });
        if (r.mode === "choose") {
          onChoices?.(t.threadId, r.choices);
          return onNotice({ ok: true, text: `Objednávka může patřit k ${r.choices.map((c) => c.number).join(", ")} — vyber zakázku, nebo založ novou.` });
        }
        onLinked(t.threadId, r.jobId, r.number);
        navigating = true;
        onNotice({
          ok: true,
          text: r.mode === "created" ? `Založena zakázka ${r.number ?? ""} z objednávky.` : `Objednávka přiřazena k ${r.number ?? "zakázce"}${r.reason ? ` (${r.reason})` : ""}.`,
        });
        router.push(`/orders/${r.jobId}`);
        return;
      }
    } catch {
      onNotice({ ok: false, text: "Spojení se nepovedlo — zkus to znovu." });
    } finally {
      if (!navigating) setBusy(null);
    }
  }, [router, can, onLinked, onNotice, onChoices]);

  return { busy, run };
}
