import { NextResponse } from "next/server";
import { readJsonBody, respond } from "@/app/api/jobs/capture/request";
import { supplierFromInvoiceUpload } from "@/lib/supplier-invoices/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Dodavatelé → „Přiložit fakturu": AI přečte hlavičku → založí / doplní dodavatele, volitelně i fakturu. */
export async function POST(req: Request) {
  const parsed = await readJsonBody(req);
  if (parsed instanceof NextResponse) return parsed;
  const { body } = parsed;
  return respond(await supplierFromInvoiceUpload({ files: body.files, createInvoice: body.createInvoice === true }));
}
