import { NextResponse } from "next/server";
import { apiRequire } from "@/lib/auth/session";
import { createOperatorClient } from "@/lib/supabase/server";
import { getJob } from "@/lib/data/jobs";
import {
  fetchProfileContact, fetchSupplierQuote, fetchSupplierRef, getPurchaseOrder,
} from "@/lib/data/purchasing";
import { draftToPurchaseOrderView, purchaseOrderFileName, validatePurchaseOrderDraft } from "@/lib/jobs/purchasing";
import { isUuid } from "@/lib/jobs/mapping";
import type { PurchaseOrderDraftInput, PurchaseOrderView } from "@/lib/jobs/purchasing-types";
import { buildPurchaseOrderDoc } from "@/lib/pdf/purchase-docs";
import { renderPurchaseOrderPdf } from "@/lib/pdf/render-purchase";
import type { CurrentUser } from "@/lib/data/current-user";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Náhled PDF objednávky vydané (nic se neukládá):
 *  GET  /api/pdf/purchase-order/<id>[?download=1] — uložená objednávka
 *  POST /api/pdf/purchase-order/draft  { jobId, draft } — návrh z dialogu „Vystavit objednávku"
 * Jen s právem „margins" (nákupní ceny).
 */

function pdfResponse(buffer: Buffer, filename: string, download = false) {
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

function errorResponse(err: unknown) {
  const msg = err instanceof Error ? err.message : "Chyba generování PDF";
  return NextResponse.json({ error: msg }, { status: 500 });
}

async function render(po: PurchaseOrderView, user: CurrentUser): Promise<Buffer | NextResponse> {
  const job = await getJob(po.jobId);
  if (!job) return NextResponse.json({ error: "Zakázka nenalezena." }, { status: 404 });
  const db = await createOperatorClient();
  const contact = await fetchProfileContact(db, po.createdBy?.id || user.id);
  const data = await buildPurchaseOrderDoc(job, po, po.supplier, {
    preparedBy: contact.name ?? po.createdBy?.name ?? user.fullName,
    contactEmail: contact.email,
    contactPhone: contact.phone,
  });
  return renderPurchaseOrderPdf(data);
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiRequire("margins");
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Objednávka nenalezena." }, { status: 404 });
  try {
    const po = await getPurchaseOrder(id);
    if (!po) return NextResponse.json({ error: "Objednávka nenalezena." }, { status: 404 });
    const out = await render(po, auth.user);
    if (out instanceof NextResponse) return out;
    const download = new URL(req.url).searchParams.get("download") === "1";
    return pdfResponse(out, purchaseOrderFileName(po.number), download);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiRequire("margins");
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (id !== "draft") return NextResponse.json({ error: "Náhled jen pro návrh (/draft)." }, { status: 404 });

  let body: { jobId?: string; draft?: PurchaseOrderDraftInput };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });
  }
  if (!body || !isUuid(body.jobId)) return NextResponse.json({ error: "Neplatná zakázka." }, { status: 400 });
  const valid = validatePurchaseOrderDraft(body.draft as PurchaseOrderDraftInput);
  if ("error" in valid) return NextResponse.json({ error: valid.error }, { status: 400 });

  try {
    const db = await createOperatorClient();
    const v = valid.value;
    const [supplier, quote] = await Promise.all([
      fetchSupplierRef(db, v.supplierId),
      v.supplierQuoteId ? fetchSupplierQuote(db, v.supplierQuoteId) : Promise.resolve(null),
    ]);
    const po = draftToPurchaseOrderView(v, {
      jobId: body.jobId as string,
      supplier,
      supplierQuote: quote && quote.jobId === body.jobId ? { id: quote.id, number: quote.number, quoteDate: quote.quoteDate } : null,
      createdBy: { id: auth.user.id, name: auth.user.fullName },
    });
    const out = await render(po, auth.user);
    if (out instanceof NextResponse) return out;
    return pdfResponse(out, "Objednavka_navrh.pdf");
  } catch (err) {
    return errorResponse(err);
  }
}
