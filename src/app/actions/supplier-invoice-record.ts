"use server";

import { revalidatePath } from "next/cache";
import { recordInvoiceFromEmailAttachment } from "@/lib/supplier-invoices/record-email";
import type { RecordInvoiceResult } from "@/lib/supplier-invoices/record-types";

/**
 * „Zanést fakturu" z přílohy e-mailu (Pošta → Zapsat fakturu dodavatele → stránka s předvybranou přílohou).
 * Smí každý, kdo e-mail vidí a smí nahrávat faktury; odpověď = potvrzení / duplicita / „není faktura".
 */
export async function recordEmailAttachmentInvoiceAction(
  emailId: string,
  attachmentId: string,
  force = false,
): Promise<(RecordInvoiceResult & { message: string }) | { ok: false; error: string }> {
  const res = await recordInvoiceFromEmailAttachment({ emailId, attachmentId, force });
  if (res.ok && res.kind === "recorded") {
    try {
      revalidatePath("/supplier-invoices");
    } catch {
      // mimo požadavek Next.js
    }
  }
  return res;
}
