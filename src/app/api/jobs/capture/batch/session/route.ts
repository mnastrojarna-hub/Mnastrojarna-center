import { NextResponse } from "next/server";
import { captureBatchSession } from "@/lib/jobs/capture-batch-service";
import { readJsonBody, respond } from "../../request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Dávka: obnova rozpracovaného focení (Pokračovat). */
export async function POST(req: Request) {
  const parsed = await readJsonBody(req);
  if (parsed instanceof NextResponse) return parsed;
  const { body } = parsed;
  return respond(await captureBatchSession({ captureId: typeof body.captureId === "string" ? body.captureId : "" }));
}
