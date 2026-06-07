import { NextResponse } from "next/server";
import {
  renderInvoicePdf, renderQuotePdf, renderDeliveryNotePdf,
  sampleInvoice, sampleQuote, sampleDeliveryNote,
} from "@/lib/pdf/render";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ type: string }> },
) {
  const { type } = await params;
  try {
    let buffer: Buffer;
    let filename: string;
    switch (type) {
      case "faktura":
        buffer = await renderInvoicePdf(sampleInvoice());
        filename = "faktura-nahled.pdf";
        break;
      case "nabidka":
        buffer = await renderQuotePdf(sampleQuote());
        filename = "nabidka-nahled.pdf";
        break;
      case "dodaci-list":
        buffer = await renderDeliveryNotePdf(sampleDeliveryNote());
        filename = "dodaci-list-nahled.pdf";
        break;
      default:
        return NextResponse.json({ error: "Neznámý typ dokumentu." }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Chyba generování PDF";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
