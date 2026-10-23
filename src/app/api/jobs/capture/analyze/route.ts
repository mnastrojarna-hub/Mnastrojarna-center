import { NextResponse } from "next/server";
import { analyzeCapture, type CaptureFileRef } from "@/lib/jobs/capture-service";
import type { CaptureDocKind } from "@/lib/jobs/capture-types";
import { readJsonBody, respond } from "../request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// AI čtení vícestránkového dokladu může trvat i minutu
export const maxDuration = 300;

/**
 * „Vyfotit doklad" krok 2: AI přečte nahrané stránky — jeden doklad = kontrolní formulář { model },
 * víc dokladů / výkres / model = dávka { batch }. Zrušení klientem zastaví i volání AI.
 */
export async function POST(req: Request) {
  const parsed = await readJsonBody(req);
  if (parsed instanceof NextResponse) return parsed;
  const { body } = parsed;
  const res = await analyzeCapture({
    files: body.files as CaptureFileRef[],
    jobId: typeof body.jobId === "string" ? body.jobId : null,
    expectedKind: typeof body.expectedKind === "string" ? (body.expectedKind as CaptureDocKind) : null,
  }, req.signal);
  return respond(res);
}
