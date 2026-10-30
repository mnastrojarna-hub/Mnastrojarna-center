import { NextResponse } from "next/server";
import { routeDeadline } from "@/lib/ai/ai-call";
import { applyCapture } from "@/lib/jobs/capture-service";
import { fileIdsOf, processInBackground } from "@/lib/anonymize/runner";
import { readJsonBody, respond } from "../request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// uložení trvá vteřiny; zbytek času patří anonymizaci uloženého výkresu (after())
export const maxDuration = 300;

/** „Vyfotit doklad" krok 3: uloží zkontrolovaný formulář do Knihy zakázek. */
export async function POST(req: Request) {
  const start = Date.now();
  const parsed = await readJsonBody(req);
  if (parsed instanceof NextResponse) return parsed;
  const { body } = parsed;
  const res = await applyCapture({ captureId: typeof body.captureId === "string" ? body.captureId : "", state: body.state });
  // uložené stránky (externí doklad / výkres) se hned anonymizují — v této funkci po odpovědi, bez HTTP
  // volání sama sebe; výsledek nese jen první stránku → čekající soubory celé zakázky
  if (res.ok && res.jobId && fileIdsOf(res).length) {
    processInBackground({ table: "job_files", jobIds: [res.jobId], deadline: routeDeadline(start), maxFiles: 10, label: "focení dokladu" });
  }
  return respond(res);
}
