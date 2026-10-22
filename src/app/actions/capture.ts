"use server";

import { discardCapture as discardCaptureFiles, prepareCaptureUpload } from "@/lib/jobs/capture-service";
import type { ActionResult } from "@/lib/jobs/types";

/**
 * „📷 Vyfotit doklad" — nahrání stránek přímo do Supabase Storage (Vercel omezuje tělo
 * požadavku) a zahození rozpracovaného dokladu. Čtení a uložení dokladu běží přes
 * /api/jobs/capture/* (delší limit pro AI). Oprávnění hlídá capture-service.
 */

export async function createCaptureUpload(input: {
  filename: string;
  size: number;
  mimeType?: string;
}): Promise<ActionResult<{ path: string; token: string; bucket: string }>> {
  return prepareCaptureUpload(input);
}

export async function discardCapture(input: { captureId?: string | null; paths?: string[] }): Promise<ActionResult> {
  return discardCaptureFiles(input);
}
