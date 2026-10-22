import { NextResponse } from "next/server";
import {
  renderInvoicePdf, renderQuotePdf, renderDeliveryNotePdf, renderConfirmationPdf,
  sampleInvoice, sampleQuote, sampleDeliveryNote, sampleConfirmation,
} from "@/lib/pdf/render";
import { refreshCompanyFromSettings } from "@/lib/company-server";
import { apiRequire } from "@/lib/auth/session";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Ukázkové náhledy dokladů (vzhled šablon s firemními údaji z Nastavení). */
const PREVIEWS: Record<string, { filename: string; render: () => Promise<Buffer> }> = {
  nabidka: { filename: "nabidka-nahled.pdf", render: () => renderQuotePdf(sampleQuote()) },
  potvrzeni: { filename: "potvrzeni-objednavky-nahled.pdf", render: () => renderConfirmationPdf(sampleConfirmation()) },
  "dodaci-list": { filename: "dodaci-list-nahled.pdf", render: () => renderDeliveryNotePdf(sampleDeliveryNote()) },
  faktura: { filename: "faktura-nahled.pdf", render: () => renderInvoicePdf(sampleInvoice()) },
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ type: string }> },
) {
  const auth = await apiRequire("documents");
  if (auth instanceof NextResponse) return auth;

  const { type } = await params;
  const key = type === "dodaci_list" ? "dodaci-list" : type;
  const preview = Object.hasOwn(PREVIEWS, key) ? PREVIEWS[key] : undefined;
  if (!preview) return NextResponse.json({ error: "Neznámý typ dokumentu." }, { status: 404 });

  try {
    await refreshCompanyFromSettings();
    const buffer = await preview.render();
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${preview.filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Chyba generování PDF";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
