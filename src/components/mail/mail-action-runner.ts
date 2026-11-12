"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAccess } from "@/components/access-provider";
import { createJobFromEmail, linkEmailToJob } from "@/app/actions/mail";
import { processOrderFromEmailAction, type OrderChoice } from "@/app/actions/mail-actions";
import { mailCapturePlanAction } from "@/app/actions/mail-capture";
import { setThreadJobAction, type JobPick } from "@/app/actions/mail-jobs";
import { mailActionHref, type MailActionKey } from "@/lib/email/mail-actions";
import { flowActionHref } from "@/components/flow/flow-state";
import { MailCaptureDialog, type MailCaptureFinished, type MailCaptureRequest } from "@/components/mail/mail-capture-dialog";

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

/** Akce, které s přílohami e-mailu běží přes roztřídění dávkou „Přidat doklad (foto)". */
export const CAPTURE_MAIL_ACTIONS: readonly MailActionKey[] = ["quote.create", "job.create", "order.process", "job.assign"];

/**
 * Spuštění hlavní akce zprávy (Pošta → řádek i detail vlákna): Vytvořit nabídku, Zpracovat objednávku,
 * Založit zakázku a Přidat k zakázce — e-mail s přílohami jde přes roztřídění dávkou „Přidat doklad (foto)"
 * (MailCaptureDialog: výkresy, objednávka, poptávka… se správnými druhy, kontrola, kontakt odesílatele);
 * bez příloh dnešní tok z textu e-mailu. Dál Zapsat fakturu dodavatele a odkazy (Pokračovat v nabídce,
 * Zapsat nabídku dodavatele, Otevřít zakázku). Dialog roztřídění vrací `dialog` — vykreslit vedle akcí.
 */
export function useMailActionRunner(opts: {
  onLinked: (threadId: string, jobId: string, jobNumber?: string) => void;
  onNotice: (n: MailActionNotice) => void;
  onChoices?: (threadId: string, choices: OrderChoice[]) => void;
}) {
  const router = useRouter();
  const { can } = useAccess();
  const [busy, setBusy] = React.useState<{ threadId: string; key: MailActionKey } | null>(null);
  const [capture, setCapture] = React.useState<MailCaptureRequest | null>(null);
  const navigateOnClose = React.useRef<string | null>(null);
  const { onLinked, onNotice, onChoices } = opts;

  /**
   * Přílohy k roztřídění? → dialog dávky (handled), jinak dnešní tok (plán vrací, kolik příloh u pevného cíle
   * už bylo — hláška). Chyba plánu = hláška a hotovo.
   */
  const openCapture = React.useCallback(async (key: MailActionKey, t: MailActionTarget, fixedJobId: string | null, relink = false): Promise<{ handled: boolean; alreadyStored: number }> => {
    const plan = await mailCapturePlanAction(t.emailId, fixedJobId);
    if (!plan.ok) {
      onNotice({ ok: false, text: plan.error });
      return { handled: true, alreadyStored: 0 };
    }
    const alreadyStored = plan.skipped.filter((x) => x.jobFileId).length;
    // už u zakázky (souběh) nebo bez (nových) příloh → dnešní tok
    if (plan.files === 0 || (plan.jobId && !fixedJobId)) return { handled: false, alreadyStored };
    navigateOnClose.current = null;
    setCapture({ threadId: t.threadId, emailId: t.emailId, key, jobId: fixedJobId, relink, plan });
    return { handled: true, alreadyStored };
  }, [onNotice]);

  const run = React.useCallback(async (key: MailActionKey, t: MailActionTarget): Promise<void> => {
    const href = mailActionHref(key, t.jobId);
    if (href) {
      router.push(href);
      return;
    }
    if (key === "job.assign") return; // výběr zakázky dělá lišta zakázky (dialog) → assign()
    if (key === "invoice.record") {
      // 31. 10.: Zanést fakturu s přílohou e-mailu předvybranou → AI přečte → potvrzení s hlavičkou
      router.push(`/supplier-invoices/upload?email=${encodeURIComponent(t.emailId)}`);
      return;
    }
    setBusy({ threadId: t.threadId, key });
    let navigating = false;
    try {
      // přílohy (výkresy, objednávka, poptávka…) → roztřídění dávkou focení s kontrolou
      if (CAPTURE_MAIL_ACTIONS.includes(key) && !t.jobId && (await openCapture(key, t, null)).handled) return;
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
  }, [router, can, onLinked, onNotice, onChoices, openCapture]);

  /**
   * „Přidat k zakázce" i „Změnit" (vybraná zakázka): přílohy e-mailu roztřídí dávka s pevným cílem — co už
   * u zakázky je (stejný obsah), se znovu neukládá; bez (nových) příloh jen přiřazení / přesun vlákna.
   * Hlášku pošle dokončení dialogu, nebo rovnou tato funkce.
   */
  const assign = React.useCallback(async (t: MailActionTarget, job: Pick<JobPick, "id" | "number">): Promise<void> => {
    setBusy({ threadId: t.threadId, key: "job.assign" });
    const relink = Boolean(t.jobId && t.jobId !== job.id);
    try {
      const cap = await openCapture("job.assign", t, job.id, relink);
      if (cap.handled) return;
      // bez vlákna (stránky toku) = přiřadit e-mail (vlákno se přiřadí s ním)
      const r = t.threadId
        ? await setThreadJobAction(t.threadId, job.id)
        : await linkEmailToJob(t.emailId, job.id).then((x) => ({ ...x, jobId: job.id, jobNumber: job.number, changes: 0 }));
      if (!r.ok) return onNotice({ ok: false, text: r.error ?? "E-mail se nepodařilo přiřadit." });
      onLinked(t.threadId, r.jobId ?? job.id, r.jobNumber ?? job.number);
      const stored = cap.alreadyStored ? ` — ${cap.alreadyStored === 1 ? "příloha už u zakázky je" : `přílohy už u zakázky jsou (${cap.alreadyStored})`}` : "";
      onNotice({ ok: true, text: `Vlákno ${relink ? "přesunuto" : "přiřazeno"} k ${r.jobNumber ?? job.number}${r.changes ? ` — z e-mailu zapsáno ${r.changes} změn(y)` : ""}${stored}.` });
    } catch {
      onNotice({ ok: false, text: "Spojení se nepovedlo — zkus to znovu." });
    } finally {
      setBusy(null);
    }
  }, [openCapture, onLinked, onNotice]);

  const finished = React.useCallback((f: MailCaptureFinished) => {
    if (f.ok) onLinked(f.threadId, f.jobId, f.jobNumber);
    onNotice({ ok: f.ok, text: f.text, href: `/orders/${f.jobId}`, hrefLabel: f.jobNumber ? `Otevřít ${f.jobNumber}` : "Otevřít zakázku" });
    // poptávka → po zavření rovnou editor nabídky (jako dřív)
    if (f.ok && f.key === "quote.create") navigateOnClose.current = flowActionHref("quote.create", f.jobId, { canPrice: can("pricing") }) ?? `/orders/${f.jobId}`;
  }, [onLinked, onNotice, can]);

  const close = React.useCallback(() => {
    setCapture(null);
    const go = navigateOnClose.current;
    navigateOnClose.current = null;
    if (go) router.push(go);
  }, [router]);

  const dialog = capture ? React.createElement(MailCaptureDialog, { key: `${capture.emailId}:${capture.jobId ?? "new"}`, request: capture, onClose: close, onFinished: finished }) : null;

  return { busy, run, assign, dialog };
}
