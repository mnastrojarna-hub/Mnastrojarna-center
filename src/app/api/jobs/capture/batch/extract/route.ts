import { NextResponse } from "next/server";
import { captureBatchExtract } from "@/lib/jobs/capture-batch-service";
import { readJsonBody, respond } from "../../request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Dávka: vytěžení jednoho dokladu (server dočte i po odchodu klienta, opakování je idempotentní). */
export async function POST(req: Request) {
  const parsed = await readJsonBody(req);
  if (parsed instanceof NextResponse) return parsed;
  const { body } = parsed;
  return respond(await captureBatchExtract({
    captureId: typeof body.captureId === "string" ? body.captureId : "",
    docId: typeof body.docId === "string" ? body.docId : "",
    type: typeof body.type === "string" ? body.type : "",
    pageIds: body.pageIds,
    force: body.force === true,
  }));
}
