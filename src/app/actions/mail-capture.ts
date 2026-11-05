"use server";

import { finishMailCapture, mailCapturePlan, type FinishMailCaptureInput, type FinishMailCaptureResult, type MailCapturePlan } from "@/lib/email/mail-capture";

/**
 * Pošta → „Přidat doklad (foto)": plán dialogu (kolik příloh půjde do dávky, zákazník a kontakt
 * odesílatele — bez AI) a dokončení po uložení dávky (vlákno ↔ zakázka, přílohy ↔ dokumenty, pokyny
 * z textu e-mailu, kontaktní osoba). Roztřídění a uložení běží přes /api/jobs/capture/* (dávka focení).
 */

export async function mailCapturePlanAction(emailId: string, jobId?: string | null): Promise<MailCapturePlan | { ok: false; error: string }> {
  try {
    return await mailCapturePlan(String(emailId ?? ""), typeof jobId === "string" && jobId ? jobId.toLowerCase() : null);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Neočekávaná chyba." };
  }
}

export async function finishMailCaptureAction(input: FinishMailCaptureInput): Promise<FinishMailCaptureResult> {
  try {
    const o = (input ?? {}) as Partial<FinishMailCaptureInput>;
    return await finishMailCapture({
      emailId: String(o.emailId ?? ""), captureId: String(o.captureId ?? ""), jobId: String(o.jobId ?? ""),
      created: o.created === true, addContact: o.addContact === true, relink: o.relink === true,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Neočekávaná chyba." };
  }
}
