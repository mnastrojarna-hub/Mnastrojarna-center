import { NextResponse } from "next/server";
import { readJsonBody, respond } from "@/app/api/jobs/capture/request";
import { partyAutofill } from "@/lib/parties/autofill-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Zákazníci / Dodavatelé → „Vyplnit z dokladu": AI přečte jen firmu (+ ARES), vrátí návrh pro formulář.
 * Nic neukládá a nezakládá žádnou zakázku.
 */
export async function POST(req: Request) {
  const parsed = await readJsonBody(req);
  if (parsed instanceof NextResponse) return parsed;
  const { body } = parsed;
  return respond(await partyAutofill({ kind: body.kind, files: body.files, text: body.text, exceptId: body.exceptId }, req.signal));
}
