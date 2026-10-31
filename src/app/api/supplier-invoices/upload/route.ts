import { NextResponse } from "next/server";
import { readJsonBody, respond } from "@/app/api/jobs/capture/request";
import { uploadSupplierInvoice } from "@/lib/supplier-invoices/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// AI čtení běží po odpovědi (after) — do limitu route
export const maxDuration = 300;

/** „Zanést fakturu" (všichni): jeden soubor nahraný do capture/<já>/ → AI přečte → faktura zapsaná → potvrzení. */
export async function POST(req: Request) {
  const parsed = await readJsonBody(req);
  if (parsed instanceof NextResponse) return parsed;
  const { body } = parsed;
  return respond(await uploadSupplierInvoice({ files: body.files, source: body.source, force: body.force }));
}
