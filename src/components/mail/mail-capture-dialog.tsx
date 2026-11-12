"use client";

import * as React from "react";
import { UserRound } from "lucide-react";
import { CaptureDialog } from "@/components/jobs/capture/capture-dialog";
import { finishMailCaptureAction } from "@/app/actions/mail-capture";
import type { MailCapturePlan } from "@/lib/email/mail-capture";
import type { BatchResult } from "@/lib/jobs/capture-batch-types";
import type { MailActionKey } from "@/lib/email/mail-actions";

/** Otevřené roztřídění příloh e-mailu (Pošta → Založit zakázku / Vytvořit nabídku / Přidat k zakázce). */
export interface MailCaptureRequest {
  threadId: string;
  emailId: string;
  key: MailActionKey;
  /** Přidat k zakázce: pevný cíl dávky. */
  jobId?: string | null;
  /** „Změnit": vlákno dnes patří k jiné zakázce — po uložení dávky se přesune k cíli. */
  relink?: boolean;
  plan: MailCapturePlan;
}

export interface MailCaptureFinished {
  threadId: string;
  key: MailActionKey;
  jobId: string;
  jobNumber?: string;
  created: boolean;
  ok: boolean;
  text: string;
}

/** Hlavní (první uložená) zakázka dávky — k ní patří vlákno e-mailu. */
export function primaryJobOf(res: Pick<BatchResult, "groups">): { jobId: string; jobNumber?: string; created: boolean } | null {
  const g = res.groups.find((x) => x.ok && x.jobId);
  return g?.jobId ? { jobId: g.jobId, jobNumber: g.jobNumber, created: Boolean(g.created) } : null;
}

/** Kontakt odesílatele nad kontrolou dávky: přidat do Karty zákazníka (předvybráno) / už tam je. */
export function SenderContactPanel({ plan, add, onAdd }: { plan: MailCapturePlan; add: boolean; onAdd: (v: boolean) => void }) {
  const s = plan.sender;
  if (!s.email) return null;
  // jméno z podpisu / hlavičky (nikdy surová adresa), pozice z podpisu
  const who = [s.name || "(jméno doplníš v kontrole)", s.position ? `(${s.position})` : "", `<${s.email}>`].filter(Boolean).join(" ");
  return (
    <div className="mb-3 space-y-1.5 rounded-xl border bg-muted/30 p-2.5 text-sm" data-testid="mail-capture-contact">
      <div className="flex items-start gap-2">
        <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        {s.status === "existing" ? (
          <p className="min-w-0">
            Kontaktní osoba zakázky: <strong>{who}</strong>{s.phone ? ` · ${s.phone}` : ""} — už je v Kartě zákazníka{plan.customer ? ` ${plan.customer.name}` : ""}.
          </p>
        ) : (
          <label className="flex min-w-0 cursor-pointer items-start gap-2">
            <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={add} onChange={(e) => onAdd(e.target.checked)} data-testid="mail-capture-add-contact" />
            <span className="min-w-0">
              Přidat odesílatele <strong>{who}</strong>{s.phone ? ` · ${s.phone}` : ""} do kontaktů zákazníka
              {plan.customer ? ` ${plan.customer.name}` : s.company ? ` ${s.company} (nový, z podpisu e-mailu)` : " zakázky"} a nastavit ho jako kontaktní osobu.
            </span>
          </label>
        )}
      </div>
      {plan.skipped.length > 0 && (
        <p className="pl-6 text-xs text-muted-foreground">
          Vynecháno: {plan.skipped.slice(0, 5).map((x) => `${x.filename} (${x.reason})`).join(", ")}{plan.skipped.length > 5 ? "…" : ""}
        </p>
      )}
    </div>
  );
}

/**
 * Roztřídění příloh e-mailu STEJNOU dávkou jako „Přidat doklad (foto)" (CaptureDialog se vstupem „z e-mailu"):
 * server zkopíruje přílohy (bez log z podpisu), AI je roztřídí, uživatel jen opraví návrh (zakázka nová /
 * navržená / jiná, zákazník, položky, výkresy) a uloží. Po uložení se vlákno přiřadí k zakázce a odesílatel
 * se přidá / propojí jako kontaktní osoba.
 */
export function MailCaptureDialog({
  request, onClose, onFinished,
}: {
  request: MailCaptureRequest;
  onClose: () => void;
  onFinished: (f: MailCaptureFinished) => void;
}) {
  const { plan } = request;
  const [addContact, setAddContact] = React.useState(plan.sender.status !== "existing");
  const addRef = React.useRef(addContact);
  addRef.current = addContact;
  const finished = React.useRef(new Set<string>());

  const onBatchSaved = React.useCallback((res: BatchResult, captureId: string) => {
    const main = primaryJobOf(res);
    if (!main) return;
    const key = `${captureId}:${main.jobId}`;
    if (finished.current.has(key)) return;
    finished.current.add(key);
    void finishMailCaptureAction({ emailId: request.emailId, captureId, jobId: main.jobId, created: main.created, addContact: addRef.current, relink: request.relink === true })
      .catch(() => ({ ok: false as const, error: "Spojení se nepovedlo — e-mail přiřaď k zakázce ručně." }))
      .then((r) => {
        const number = ("jobNumber" in r && r.jobNumber) || main.jobNumber;
        const contact = "contact" in r && r.contact === "added" ? " Odesílatel přidán do kontaktů zákazníka." : "";
        onFinished({
          threadId: request.threadId, key: request.key, jobId: main.jobId, jobNumber: number, created: main.created, ok: r.ok,
          text: r.ok
            ? `${main.created ? "Založena zakázka" : "Přílohy uloženy k zakázce"} ${number ?? ""} — ${request.relink ? "vlákno přesunuto" : "e-mail přiřazen"}.${contact}`.replace(/\s+—/, " —")
            : r.error ?? "E-mail se nepodařilo přiřadit k zakázce.",
        });
      });
  }, [request.emailId, request.threadId, request.key, request.relink, onFinished]);

  const mail = React.useMemo(() => ({
    emailId: request.emailId,
    subject: plan.subject,
    reviewHeader: <SenderContactPanel plan={plan} add={addContact} onAdd={setAddContact} />,
    onBatchSaved,
  }), [request.emailId, plan, addContact, onBatchSaved]);

  return (
    <CaptureDialog
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      jobId={request.jobId ?? undefined}
      mail={mail}
    />
  );
}
