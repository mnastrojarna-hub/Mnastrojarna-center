import { NextResponse } from "next/server";
import { captureBatchJobs } from "@/lib/jobs/capture-batch-service";
import { readJsonBody, respond } from "../../request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** Dávka: hledání zakázky pro „Jiná…" (min. 2 znaky, max. 20 výsledků). */
export async function POST(req: Request) {
  const parsed = await readJsonBody(req);
  if (parsed instanceof NextResponse) return parsed;
  const { body } = parsed;
  return respond(await captureBatchJobs({ q: typeof body.q === "string" ? body.q : "" }));
}
