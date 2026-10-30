import { NextResponse } from "next/server";
import { routeDeadline } from "@/lib/ai/ai-call";
import { captureBatchApply } from "@/lib/jobs/capture-batch-service";
import { fileIdsOf, processInBackground } from "@/lib/anonymize/runner";
import { readJsonBody, respond } from "../../request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Dávka: uložení všech dokladů (po skupinách, s deníkem; částečné uložení jde zopakovat). */
export async function POST(req: Request) {
  const start = Date.now();
  const parsed = await readJsonBody(req);
  if (parsed instanceof NextResponse) return parsed;
  const { body } = parsed;
  const res = await captureBatchApply({ captureId: typeof body.captureId === "string" ? body.captureId : "", state: body.state });
  // uložené výkresy dávky se hned anonymizují — v této funkci po odpovědi (zbytek času do maxDuration),
  // co se nestihne, převezme rozvětvení / otevření zakázky
  const ids = fileIdsOf(res);
  if (ids.length) processInBackground({ table: "job_files", ids, deadline: routeDeadline(start), maxFiles: 20, label: "dávka focení" });
  return respond(res);
}
