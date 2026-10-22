import { NextResponse } from "next/server";
import { captureTarget } from "@/lib/jobs/capture-service";
import { readJsonBody, respond } from "../request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Kontrolní formulář: uživatel vybral jinou zakázku → návrh doplnění pro ni. */
export async function POST(req: Request) {
  const parsed = await readJsonBody(req);
  if (parsed instanceof NextResponse) return parsed;
  const { body } = parsed;
  const res = await captureTarget({
    captureId: typeof body.captureId === "string" ? body.captureId : "",
    jobId: typeof body.jobId === "string" ? body.jobId : "",
  });
  return respond(res);
}
