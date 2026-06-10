import { NextResponse } from "next/server";
import { getOrders } from "@/lib/data/queries";
import { renderInvoicePdf, renderDeliveryNotePdf } from "@/lib/pdf/render";
import { supplierParty } from "@/lib/pdf/components";
import { DEFAULT_VAT_RATE, COMPANY } from "@/lib/company";
import { refreshCompanyFromSettings } from "@/lib/company-server";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const type = new URL(req.url).searchParams.get("type") ?? "faktura";

  await refreshCompanyFromSettings();
  const orders = await getOrders();
  const order = orders.find((o) => o.id === id);
  if (!order) return NextResponse.json({ error: "Zakázka nenalezena." }, { status: 404 });

  const qty = order.quantity && order.quantity > 0 ? order.quantity : 1;
  const today = new Date().toISOString().slice(0, 10);

  try {
    if (type === "dodaci-list") {
      const pdf = await renderDeliveryNotePdf({
        number: `DL-${order.number}`,
        issueDate: today,
        orderNumber: order.number,
        supplier: supplierParty(),
        customer: { name: order.customer },
        items: [{ description: `${order.title}${order.drawing ? ` (výkres ${order.drawing})` : ""}`, quantity: qty, unit: "ks" }],
        note: order.requirements ? `Specifikace: ${order.requirements}` : undefined,
      });
      return pdfResponse(pdf, `dodaci-list-${order.number}.pdf`);
    }

    const due = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    const pdf = await renderInvoicePdf({
      number: order.number.replace(/\D/g, "") || order.number,
      variableSymbol: order.number.replace(/\D/g, "") || order.number,
      issueDate: today,
      taxableDate: today,
      dueDate: due,
      paymentMethod: "Bankovní převod",
      currency: "CZK",
      supplier: supplierParty(),
      customer: { name: order.customer },
      bank: {
        accountNumber: COMPANY.bank.accountNumber,
        iban: COMPANY.bank.iban,
        bankName: COMPANY.bank.bankName,
      },
      items: [
        {
          description: `${order.title}${order.drawing ? ` — výkres ${order.drawing}` : ""}${order.material ? `, ${order.material}` : ""}`,
          quantity: qty,
          unit: "ks",
          unitPrice: Math.round((order.value / qty) * 100) / 100,
          vatRate: DEFAULT_VAT_RATE,
        },
      ],
      note: `Fakturujeme dle zakázky ${order.number}.`,
    });
    return pdfResponse(pdf, `faktura-${order.number}.pdf`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Chyba generování PDF";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function pdfResponse(buffer: Buffer, filename: string) {
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  });
}
