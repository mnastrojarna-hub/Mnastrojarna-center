import { NextResponse } from "next/server";
import { applyCapture } from "@/lib/jobs/capture-service";
import { readJsonBody, respond } from "../request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** „Vyfotit doklad" krok 3: uloží zkontrolovaný formulář do Knihy zakázek. */
export async function POST(req: Request) {
  const parsed = await readJsonBody(req);
  if (parsed instanceof NextResponse) return parsed;
  const { body } = parsed;
  const res = await applyCapture({ captureId: typeof body.captureId === "string" ? body.captureId : "", state: body.state });
  return respond(res);
}
