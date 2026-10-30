"use server";

import { discardCapture as discardCaptureFiles, prepareCaptureUpload } from "@/lib/jobs/capture-service";
import type { ActionResult } from "@/lib/jobs/types";
import type { CaptureUploadPrep } from "@/lib/jobs/capture-review";

/**
 * „📷 Vyfotit doklad" — nahrání stránek přímo do Supabase Storage (Vercel omezuje tělo
 * požadavku) a zahození rozpracovaného dokladu. Čtení a uložení dokladu běží přes
 * /api/jobs/capture/* (delší limit pro AI). Oprávnění hlídá capture-service.
 */

export async function createCaptureUpload(input: {
  filename: string;
  size: number;
  mimeType?: string;
  /** Fotka v dávce: i podepsaná URL pro náhled roztřídění. */
  sortPreview?: boolean;
  /** Fotka: i podepsaná URL pro master v plném rozlišení (anonymizace výkresu). */
  master?: { size: number; mimeType: string } | null;
}): Promise<ActionResult<CaptureUploadPrep>> {
  return prepareCaptureUpload(input);
}

export async function discardCapture(input: { captureId?: string | null; paths?: string[] }): Promise<ActionResult> {
  return discardCaptureFiles(input);
}
