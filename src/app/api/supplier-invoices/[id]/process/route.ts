import { NextResponse } from "next/server";
import { readJsonBody, respond } from "@/app/api/jobs/capture/request";
import { reprocessSupplierInvoice } from "@/lib/supplier-invoices/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** „Přečíst znovu" (AI) — jen kdo smí faktury upravovat. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = await readJsonBody(req);
  if (parsed instanceof NextResponse) return parsed;
  const { id } = await params;
  return respond(await reprocessSupplierInvoice(id));
}
