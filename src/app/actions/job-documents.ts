"use server";

// DOČASNÝ STUB — plnou implementaci dodá modul „doklady zakázky" (fáze 2).
// Signatury jsou závazné: používá je detail zakázky i stránky obchodního toku.

import type { ActionResult } from "@/lib/jobs/types";

export type JobDocumentKind = "nabidka" | "potvrzeni" | "dodaci_list" | "faktura";

/**
 * Vygeneruje PDF doklad ze zakázky, uloží ho do Dokumentů zakázky (verzuje)
 * a vrátí id souboru. Nabídka vyžaduje quoteId (jinak poslední aktuální nabídka).
 */
export async function generateJobDocument(
  _jobId: string,
  _kind: JobDocumentKind,
  _opts?: { quoteId?: string; note?: string },
): Promise<ActionResult<{ fileId: string; number: string; filename: string }>> {
  return { ok: false, error: "Generování dokladů se právě dokončuje." };
}

/** Odešle uložený doklad zákazníkovi e-mailem (s PDF v příloze) z mé schránky. */
export async function sendJobDocument(
  _jobId: string,
  _fileId: string,
  _mail: { to: string; cc?: string; subject: string; body: string },
): Promise<ActionResult<{ sent: boolean }>> {
  return { ok: false, error: "Odesílání dokladů se právě dokončuje." };
}

/** Výchozí předmět a text e-mailu k dokladu (zákazník, čísla, termín). */
export async function draftJobDocumentEmail(
  _jobId: string,
  _fileId: string,
): Promise<ActionResult<{ to: string; subject: string; body: string }>> {
  return { ok: false, error: "Návrh e-mailu se právě dokončuje." };
}
