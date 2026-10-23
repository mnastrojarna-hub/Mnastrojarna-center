import { NextResponse } from "next/server";
import { captureBatchApply } from "@/lib/jobs/capture-batch-service";
import { readJsonBody, respond } from "../../request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Dávka: uložení všech dokladů (po skupinách, s deníkem; částečné uložení jde zopakovat). */
export async function POST(req: Request) {
  const parsed = await readJsonBody(req);
  if (parsed instanceof NextResponse) return parsed;
  const { body } = parsed;
  const res = await captureBatchApply({ captureId: typeof body.captureId === "string" ? body.captureId : "", state: body.state });
  return respond(res);
}
