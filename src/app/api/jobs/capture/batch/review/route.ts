import { NextResponse } from "next/server";
import { captureBatchReview } from "@/lib/jobs/capture-batch-service";
import { readJsonBody, respond } from "../../request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Dávka: kontrola — skupiny zakázek, vzájemné doplnění, výchozí stav uložení. */
export async function POST(req: Request) {
  const parsed = await readJsonBody(req);
  if (parsed instanceof NextResponse) return parsed;
  const { body } = parsed;
  return respond(await captureBatchReview({
    captureId: typeof body.captureId === "string" ? body.captureId : "",
    sort: body.sort,
    assign: body.assign,
    targets: body.targets,
    customerConfirmed: body.customerConfirmed,
  }));
}
